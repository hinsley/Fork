import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { downloadSystem, readSystemFile } from './importExport'
import { buildSystemArchiveBytes } from './archive'
import {
  addBifurcationDiagram,
  addBranch,
  addObject,
  addScene,
  createSystem,
  selectNode,
  updateLayout,
  updateNodeRender,
  updateViewportHeights,
} from './model'
import type {
  ContinuationObject,
  ContinuationSettings,
  EquilibriumObject,
  LimitCycleObject,
  OrbitObject,
  System,
} from './types'
import { IndexedDbSystemStore } from './indexedDb'
import { OpfsSystemStore } from './opfs'
import { installMockOpfs } from '../test/opfsMock'
import { nowIso } from '../utils/determinism'

const BASE_SETTINGS: ContinuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-6,
  max_step_size: 0.1,
  max_steps: 100,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

function ensureUrlHelpers() {
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => '',
      writable: true,
    })
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      writable: true,
    })
  }
}

async function exportSystem(system: System) {
  ensureUrlHelpers()
  let capturedBlob: Blob | null = null
  const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    capturedBlob = blob as Blob
    return 'blob:mock-url'
  })
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const removeSpy = vi.spyOn(HTMLAnchorElement.prototype, 'remove').mockImplementation(() => {})
  const appendSpy = vi.spyOn(document.body, 'appendChild')
  downloadSystem(system)
  const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement | undefined
  if (!anchor) {
    throw new Error('Export did not append a download anchor.')
  }
  if (!capturedBlob) {
    throw new Error('Export did not create a blob.')
  }
  return {
    anchor,
    blob: capturedBlob as Blob,
    spies: {
      appendSpy,
      clickSpy,
      createObjectUrlSpy,
      removeSpy,
      revokeSpy,
    },
  }
}

async function roundTripSystem(system: System): Promise<System> {
  const bytes = buildSystemArchiveBytes(system)
  return await readSystemFile(bytesToFile(bytes, `${system.name}.zip`))
}

async function decodeZip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return unzipSync(bytes)
}

function decodeJson<T>(entries: Record<string, Uint8Array>, path: string): T {
  const normalized = path.replace(/^\/+/, '')
  const file =
    entries[path] ??
    entries[normalized] ??
    entries[`/${normalized}`] ??
    entries[`./${normalized}`]
  if (!file) {
    throw new Error(`Missing archive entry: ${path}`)
  }
  return JSON.parse(strFromU8(file)) as T
}

function hasEntry(entries: Record<string, Uint8Array>, path: string): boolean {
  const normalized = path.replace(/^\/+/, '')
  return Boolean(
    entries[path] ??
      entries[normalized] ??
      entries[`/${normalized}`] ??
      entries[`./${normalized}`]
  )
}

function bytesToFile(bytes: Uint8Array, name: string): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return {
    name,
    type: 'application/zip',
    arrayBuffer: async () => buffer,
    text: async () => String.fromCharCode(...bytes),
  } as File
}

function createRichSystem(): {
  system: System
  orbitId: string
  equilibriumId: string
  equilibriumBranchId: string
  limitCycleId: string
  limitCycleBranchId: string
} {
  let system = createSystem({
    name: 'Zip_Roundtrip_System',
    config: {
      name: 'Zip_Roundtrip_System',
      equations: ['y', '-x + mu'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit_A',
    systemName: system.config.name,
    data: [
      [0, 0.1, -0.1],
      [0.1, 0.2, -0.15],
      [0.2, 0.25, -0.2],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
    parameters: [0.2],
  }
  const orbitAdded = addObject(system, orbit)
  system = orbitAdded.system

  const equilibrium: EquilibriumObject = {
    type: 'equilibrium',
    name: 'EQ_A',
    systemName: system.config.name,
    solution: {
      state: [0, 0],
      residual_norm: 0,
      iterations: 2,
      jacobian: [0, 1, -1, 0],
      eigenpairs: [],
    },
    parameters: [0.2],
  }
  const equilibriumAdded = addObject(system, equilibrium)
  system = equilibriumAdded.system

  const equilibriumBranch: ContinuationObject = {
    type: 'continuation',
    name: 'eq_mu',
    systemName: system.config.name,
    parameterName: 'mu',
    parentObjectId: equilibriumAdded.nodeId,
    startObjectId: equilibriumAdded.nodeId,
    parentObject: equilibrium.name,
    startObject: equilibrium.name,
    branchType: 'equilibrium',
    data: {
      points: [{ state: [0, 0], param_value: 0.2, stability: 'Hopf', eigenvalues: [] }],
      bifurcations: [0],
      indices: [0],
    },
    settings: BASE_SETTINGS,
    timestamp: nowIso(),
    params: [0.2],
  }
  const equilibriumBranchAdded = addBranch(system, equilibriumBranch, equilibriumAdded.nodeId)
  system = equilibriumBranchAdded.system

  const limitCycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'LC_A',
    systemName: system.config.name,
    origin: {
      type: 'hopf',
      equilibriumObjectId: equilibriumAdded.nodeId,
      equilibriumBranchId: equilibriumBranchAdded.nodeId,
      equilibriumObjectName: equilibrium.name,
      equilibriumBranchName: equilibriumBranch.name,
      pointIndex: 0,
    },
    ntst: 20,
    ncol: 4,
    period: 6,
    state: [0, 1, 0, -1, 6],
    parameters: [0.2],
    parameterName: 'mu',
    paramValue: 0.2,
    createdAt: nowIso(),
  }
  const limitCycleAdded = addObject(system, limitCycle)
  system = limitCycleAdded.system

  const limitCycleBranch: ContinuationObject = {
    type: 'continuation',
    name: 'lc_mu',
    systemName: system.config.name,
    parameterName: 'mu',
    parentObjectId: limitCycleAdded.nodeId,
    startObjectId: equilibriumBranchAdded.nodeId,
    parentObject: limitCycle.name,
    startObject: equilibriumBranch.name,
    branchType: 'limit_cycle',
    data: {
      points: [
        {
          state: [0, 1, 0, -1, 6],
          param_value: 0.2,
          stability: 'None',
          eigenvalues: [{ re: 0.8, im: 0.1 }],
        },
      ],
      bifurcations: [],
      indices: [0],
    },
    settings: BASE_SETTINGS,
    timestamp: nowIso(),
    params: [0.2],
  }
  const limitCycleBranchAdded = addBranch(system, limitCycleBranch, limitCycleAdded.nodeId)
  system = limitCycleBranchAdded.system

  system = addScene(system, 'Scene_A').system
  system = addBifurcationDiagram(system, 'Diagram_A').system
  system = updateLayout(system, { leftWidth: 310, rightWidth: 360 })
  system = updateViewportHeights(system, { [limitCycleAdded.nodeId]: 520 })
  system = updateNodeRender(system, limitCycleAdded.nodeId, {
    lineWidth: 3,
    pointSize: 6,
    color: '#00aa66',
  })
  system = selectNode(system, limitCycleBranchAdded.nodeId)

  return {
    system,
    orbitId: orbitAdded.nodeId,
    equilibriumId: equilibriumAdded.nodeId,
    equilibriumBranchId: equilibriumBranchAdded.nodeId,
    limitCycleId: limitCycleAdded.nodeId,
    limitCycleBranchId: limitCycleBranchAdded.nodeId,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('system import/export (zip)', () => {
  it('downloads zip archives with v3 layout entries', async () => {
    const { system } = createRichSystem()
    const { anchor, blob, spies } = await exportSystem(system)

    expect(anchor.download).toBe('Zip_Roundtrip_System.zip')
    expect(blob.type).toBe('application/zip')
    expect(spies.createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(spies.revokeSpy).toHaveBeenCalledTimes(1)
    expect(spies.clickSpy).toHaveBeenCalledTimes(1)
    expect(spies.removeSpy).toHaveBeenCalledTimes(1)

    const entries = await decodeZip(buildSystemArchiveBytes(system))
    expect(Object.keys(entries)).toContain('manifest.json')
    expect(hasEntry(entries, 'system.json')).toBe(true)
    expect(hasEntry(entries, 'ui.json')).toBe(true)
    expect(hasEntry(entries, 'index/objects.json')).toBe(true)
    expect(hasEntry(entries, 'index/branches.json')).toBe(true)

    const objectIndex = decodeJson<Record<string, { shard: string }>>(entries, 'index/objects.json')
    const branchIndex = decodeJson<Record<string, { shard: string }>>(entries, 'index/branches.json')
    Object.keys(objectIndex).forEach((id) => {
      const shard = objectIndex[id]?.shard
      expect(hasEntry(entries, `objects/${shard}/${id}.json`)).toBe(true)
    })
    Object.keys(branchIndex).forEach((id) => {
      const shard = branchIndex[id]?.shard
      expect(hasEntry(entries, `branches/${shard}/${id}.json`)).toBe(true)
    })
  })

  it('round-trips full system data, ui state, and id references', async () => {
    const ids = createRichSystem()
    const restored = await roundTripSystem(ids.system)

    expect(restored.id).toBe(ids.system.id)
    expect(restored.name).toBe(ids.system.name)
    expect(restored.config).toEqual(ids.system.config)
    expect(restored.ui.layout).toEqual(ids.system.ui.layout)
    expect(restored.ui.viewportHeights).toEqual(ids.system.ui.viewportHeights)
    expect(restored.ui.selectedNodeId).toBe(ids.system.ui.selectedNodeId)
    expect(restored.nodes).toEqual(ids.system.nodes)
    expect(restored.rootIds).toEqual(ids.system.rootIds)
    expect(restored.scenes).toEqual(ids.system.scenes)
    expect(restored.bifurcationDiagrams).toEqual(ids.system.bifurcationDiagrams)
    expect(Object.keys(restored.index.objects).sort()).toEqual(
      Object.keys(ids.system.index.objects).sort()
    )
    expect(Object.keys(restored.index.branches).sort()).toEqual(
      Object.keys(ids.system.index.branches).sort()
    )

    expect(restored.branches[ids.equilibriumBranchId].parentObjectId).toBe(ids.equilibriumId)
    expect(restored.branches[ids.equilibriumBranchId].startObjectId).toBe(ids.equilibriumId)
    expect(restored.branches[ids.limitCycleBranchId].parentObjectId).toBe(ids.limitCycleId)
    expect(restored.branches[ids.limitCycleBranchId].startObjectId).toBe(ids.equilibriumBranchId)

    const restoredCycle = restored.objects[ids.limitCycleId]
    expect(restoredCycle.type).toBe('limit_cycle')
    if (restoredCycle.type === 'limit_cycle') {
      expect(restoredCycle.origin.type).toBe('hopf')
      if (restoredCycle.origin.type === 'hopf') {
        expect(restoredCycle.origin.equilibriumObjectId).toBe(ids.equilibriumId)
        expect(restoredCycle.origin.equilibriumBranchId).toBe(ids.equilibriumBranchId)
      }
    }
  })

  it('transfers archives between IndexedDB and OPFS stores', async () => {
    const opfsInstall = installMockOpfs()
    const idb = new IndexedDbSystemStore({
      name: `fork-test-idb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    })
    const opfs = new OpfsSystemStore()
    const ids = createRichSystem()

    try {
      await idb.save(ids.system)
      const exportMeta = await idb.exportSystemArchive(ids.system.id)
      expect(exportMeta.filename.endsWith('.zip')).toBe(true)

      const skeleton = await idb.load(ids.system.id)
      const entities = await idb.loadEntities(
        ids.system.id,
        Object.keys(skeleton.index.objects),
        Object.keys(skeleton.index.branches)
      )
      const bytes = buildSystemArchiveBytes({
        ...skeleton,
        objects: entities.objects,
        branches: entities.branches,
      })
      const imported = await opfs.importSystemArchive(
        bytesToFile(bytes, `${ids.system.name}.zip`)
      )
      const loaded = await opfs.load(imported.id)

      expect(loaded.name).toBe(ids.system.name)
      expect(Object.keys(loaded.index.objects).sort()).toEqual(
        Object.keys(ids.system.index.objects).sort()
      )
      expect(Object.keys(loaded.index.branches).sort()).toEqual(
        Object.keys(ids.system.index.branches).sort()
      )
    } finally {
      await idb.clear()
      await opfs.clear()
      opfsInstall.cleanup()
    }
  })
})
