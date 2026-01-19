import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSystem, readSystemFile } from './importExport'
import { serializeSystem, SYSTEM_PROJECT_SCHEMA_VERSION } from './serialization'
import {
  addBifurcationDiagram,
  addBranch,
  addObject,
  addScene,
  createSystem,
  normalizeSystem,
  selectNode,
  toggleNodeExpanded,
  toggleNodeVisibility,
  updateBifurcationDiagram,
  updateLayout,
  updateLimitCycleRenderTarget,
  updateNodeRender,
  updateScene,
  updateViewportHeights,
} from './model'
import { createDemoSystem } from './fixtures'
import { IndexedDbSystemStore } from './indexedDb'
import { OpfsSystemStore } from './opfs'
import type {
  BranchType,
  ContinuationObject,
  ContinuationSettings,
  EquilibriumObject,
  LimitCycleObject,
  LimitCycleOrigin,
  OrbitObject,
  System,
  SystemConfig,
} from './types'
import { installMockOpfs } from '../test/opfsMock'
import { nowIso } from '../utils/determinism'

let storeCounter = 0

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

  const createObjectUrlSpy = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation((blob) => {
      capturedBlob = blob as Blob
      return 'blob:mock-url'
    })
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  const removeSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'remove')
    .mockImplementation(() => {})
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
    blob: capturedBlob,
    spies: {
      appendSpy,
      clickSpy,
      createObjectUrlSpy,
      removeSpy,
      revokeSpy,
    },
  }
}

function makeTextFile(text: string, name = 'system.json'): File {
  return { text: async () => text, name } as File
}

function makeBundleFile(bundle: unknown, name = 'system.json') {
  return makeTextFile(JSON.stringify(bundle), name)
}

async function readBlobText(blob: Blob): Promise<string> {
  if ('text' in blob && typeof blob.text === 'function') {
    return await blob.text()
  }
  if ('arrayBuffer' in blob && typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer()
    return new TextDecoder().decode(buffer)
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () =>
        reject(reader.error ?? new Error('Failed to read blob contents'))
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.readAsText(blob)
    })
  }
  throw new Error('Blob text not supported in this environment.')
}

async function roundTripSystem(system: System): Promise<System> {
  const { blob, anchor } = await exportSystem(system)
  const file = makeTextFile(await readBlobText(blob), anchor.download)
  return await readSystemFile(file)
}

function makeIndexedDbStore() {
  storeCounter += 1
  return new IndexedDbSystemStore({ name: `fork-test-${storeCounter}` })
}

function createLargeSystem(): System {
  let system = createSystem({ name: 'Large_System' })
  const points = Array.from({ length: 2000 }, (_, index) => [
    index * 0.05,
    Math.sin(index / 10),
    Math.cos(index / 10),
  ])
  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Large_Orbit',
    systemName: system.config.name,
    data: points,
    t_start: 0,
    t_end: points[points.length - 1][0],
    dt: 0.05,
  }
  system = addObject(system, orbit).system
  return system
}

const BASE_PARAMS = [0.1, 0.2]
const BASE_SETTINGS: ContinuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-6,
  max_step_size: 0.1,
  max_steps: 50,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}
const LIMIT_CYCLE_STATE = [1, 0, 0, 1, 2]

function makeConfig(
  name: string,
  type: SystemConfig['type'] = 'flow'
): SystemConfig {
  return {
    name,
    equations:
      type === 'map' ? ['x + mu', 'y + nu', 'z + mu'] : ['y', 'z', '-x'],
    params: [...BASE_PARAMS],
    paramNames: ['mu', 'nu'],
    varNames: ['x', 'y', 'z'],
    solver: 'rk4',
    type,
  }
}

function createConfiguredSystem(
  name: string,
  type: SystemConfig['type'] = 'flow'
): System {
  return createSystem({ name, config: makeConfig(name, type) })
}

function makeOrbit(systemName: string, name = 'Orbit_A'): OrbitObject {
  return {
    type: 'orbit',
    name,
    systemName,
    data: [
      [0, 0, 1],
      [0.1, 0.2, 0.9],
      [0.2, 0.4, 0.8],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
    lyapunovExponents: [0.12, -0.04],
    covariantVectors: {
      dim: 2,
      times: [0, 1],
      vectors: [
        [
          [1, 0],
          [0, 1],
        ],
        [
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
      ],
    },
    parameters: [...BASE_PARAMS],
    customParameters: [0.5],
  }
}

function makeEquilibrium(systemName: string, name = 'Equilibrium_A'): EquilibriumObject {
  return {
    type: 'equilibrium',
    name,
    systemName,
    solution: {
      state: [0.1, 0.2, 0.3],
      residual_norm: 1e-6,
      iterations: 3,
      jacobian: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      eigenpairs: [
        {
          value: { re: -1, im: 0 },
          vector: [
            { re: 1, im: 0 },
            { re: 0, im: 0 },
            { re: 0, im: 0 },
          ],
        },
        {
          value: { re: -0.2, im: 0.5 },
          vector: [
            { re: 0, im: 1 },
            { re: 1, im: 0 },
            { re: 0, im: 0 },
          ],
        },
      ],
    },
    lastSolverParams: {
      initialGuess: [0, 0, 0],
      maxSteps: 15,
      dampingFactor: 0.8,
    },
    lastRun: {
      timestamp: nowIso(),
      success: true,
      residual_norm: 1e-6,
      iterations: 3,
    },
    parameters: [...BASE_PARAMS],
    customParameters: [0.4],
  }
}

function makeLimitCycle(
  systemName: string,
  origin: LimitCycleOrigin,
  name = 'LimitCycle_A'
): LimitCycleObject {
  return {
    type: 'limit_cycle',
    name,
    systemName,
    origin,
    ntst: 4,
    ncol: 3,
    period: 2,
    state: [...LIMIT_CYCLE_STATE],
    parameters: [...BASE_PARAMS],
    customParameters: [0.8],
    parameterName: 'mu',
    paramValue: 0.2,
    floquetMultipliers: [{ re: -1, im: 0 }, { re: 0.3, im: 0.4 }],
    createdAt: nowIso(),
  }
}

function makeContinuationBranch(options: {
  name: string
  systemName: string
  parentObject: string
  startObject: string
  parameterName: string
  branchType: ContinuationObject['branchType']
  branchTypeData?: BranchType
  stability?: string
  state?: number[]
}): ContinuationObject {
  const baseState = options.state ?? [0, 0, 1]
  const nextState = baseState.map((value) => value + 0.1)
  return {
    type: 'continuation',
    name: options.name,
    systemName: options.systemName,
    parameterName: options.parameterName,
    parentObject: options.parentObject,
    startObject: options.startObject,
    branchType: options.branchType,
    data: {
      points: [
        {
          state: baseState,
          param_value: 0.1,
          stability: 'None',
          eigenvalues: [{ re: -1, im: 0 }],
        },
        {
          state: nextState,
          param_value: 0.2,
          stability: options.stability ?? 'None',
          eigenvalues: [{ re: 0.1, im: 0.2 }],
        },
      ],
      bifurcations: [1],
      indices: [0, 1],
      branch_type: options.branchTypeData,
    },
    settings: BASE_SETTINGS,
    timestamp: nowIso(),
    params: [...BASE_PARAMS],
  }
}

const objectCases: Array<{ name: string; build: () => System }> = [
  {
    name: 'orbit',
    build: () => {
      const system = createConfiguredSystem('Orbit_Object_System')
      return addObject(system, makeOrbit(system.config.name)).system
    },
  },
  {
    name: 'equilibrium',
    build: () => {
      const system = createConfiguredSystem('Equilibrium_Object_System')
      return addObject(system, makeEquilibrium(system.config.name)).system
    },
  },
  {
    name: 'limit_cycle (orbit origin)',
    build: () => {
      let system = createConfiguredSystem('LimitCycle_Orbit_System')
      const orbit = makeOrbit(system.config.name, 'Orbit_Source')
      const orbitResult = addObject(system, orbit)
      system = orbitResult.system
      const limitCycle = makeLimitCycle(system.config.name, {
        type: 'orbit',
        orbitName: orbit.name,
      })
      system = addObject(system, limitCycle).system
      return system
    },
  },
  {
    name: 'limit_cycle (hopf origin)',
    build: () => {
      let system = createConfiguredSystem('LimitCycle_Hopf_System')
      const equilibrium = makeEquilibrium(system.config.name, 'Eq_Source')
      const equilibriumResult = addObject(system, equilibrium)
      system = equilibriumResult.system
      const hopfBranch = makeContinuationBranch({
        name: 'eq_hopf_branch',
        systemName: system.config.name,
        parentObject: equilibrium.name,
        startObject: equilibrium.name,
        parameterName: 'mu',
        branchType: 'equilibrium',
        branchTypeData: { type: 'Equilibrium' },
        stability: 'Hopf',
      })
      system = addBranch(system, hopfBranch, equilibriumResult.nodeId).system
      const limitCycle = makeLimitCycle(system.config.name, {
        type: 'hopf',
        equilibriumObjectName: equilibrium.name,
        equilibriumBranchName: hopfBranch.name,
        pointIndex: 0,
      })
      system = addObject(system, limitCycle).system
      return system
    },
  },
  {
    name: 'limit_cycle (pd origin)',
    build: () => {
      let system = createConfiguredSystem('LimitCycle_PD_System')
      const orbit = makeOrbit(system.config.name, 'Orbit_Source')
      const orbitResult = addObject(system, orbit)
      system = orbitResult.system
      const baseCycle = makeLimitCycle(system.config.name, {
        type: 'orbit',
        orbitName: orbit.name,
      })
      const baseCycleResult = addObject(system, baseCycle)
      system = baseCycleResult.system
      const pdBranch = makeContinuationBranch({
        name: 'lc_pd_branch',
        systemName: system.config.name,
        parentObject: baseCycle.name,
        startObject: baseCycle.name,
        parameterName: 'mu',
        branchType: 'limit_cycle',
        branchTypeData: { type: 'LimitCycle', ntst: 4, ncol: 3 },
        stability: 'PeriodDoubling',
        state: LIMIT_CYCLE_STATE,
      })
      system = addBranch(system, pdBranch, baseCycleResult.nodeId).system
      const derivedCycle = makeLimitCycle(system.config.name, {
        type: 'pd',
        sourceLimitCycleObjectName: baseCycle.name,
        sourceBranchName: pdBranch.name,
        pointIndex: 1,
      })
      system = addObject(system, derivedCycle).system
      return system
    },
  },
]

const branchCases: Array<{
  name: string
  branchType: ContinuationObject['branchType']
  branchTypeData: BranchType
  parentKind: 'equilibrium' | 'limit_cycle'
  stability: string
}> = [
  {
    name: 'equilibrium',
    branchType: 'equilibrium',
    branchTypeData: { type: 'Equilibrium' },
    parentKind: 'equilibrium',
    stability: 'Fold',
  },
  {
    name: 'limit_cycle',
    branchType: 'limit_cycle',
    branchTypeData: { type: 'LimitCycle', ntst: 5, ncol: 4 },
    parentKind: 'limit_cycle',
    stability: 'PeriodDoubling',
  },
  {
    name: 'fold_curve',
    branchType: 'fold_curve',
    branchTypeData: { type: 'FoldCurve', param1_name: 'mu', param2_name: 'nu' },
    parentKind: 'equilibrium',
    stability: 'Fold',
  },
  {
    name: 'hopf_curve',
    branchType: 'hopf_curve',
    branchTypeData: { type: 'HopfCurve', param1_name: 'mu', param2_name: 'nu' },
    parentKind: 'equilibrium',
    stability: 'Hopf',
  },
  {
    name: 'lpc_curve',
    branchType: 'lpc_curve',
    branchTypeData: { type: 'LPCCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 },
    parentKind: 'limit_cycle',
    stability: 'CycleFold',
  },
  {
    name: 'pd_curve',
    branchType: 'pd_curve',
    branchTypeData: { type: 'PDCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 },
    parentKind: 'limit_cycle',
    stability: 'PeriodDoubling',
  },
  {
    name: 'ns_curve',
    branchType: 'ns_curve',
    branchTypeData: { type: 'NSCurve', param1_name: 'mu', param2_name: 'nu', ntst: 4, ncol: 2 },
    parentKind: 'limit_cycle',
    stability: 'NeimarkSacker',
  },
]

function buildSystemWithBranch(caseInfo: (typeof branchCases)[number]): System {
  let system = createConfiguredSystem(`Branch_${caseInfo.name}`)
  let parentName = ''
  let parentNodeId = ''

  if (caseInfo.parentKind === 'equilibrium') {
    const equilibrium = makeEquilibrium(system.config.name, 'Branch_Eq')
    const equilibriumResult = addObject(system, equilibrium)
    system = equilibriumResult.system
    parentName = equilibrium.name
    parentNodeId = equilibriumResult.nodeId
  } else {
    const orbit = makeOrbit(system.config.name, 'Branch_Orbit')
    const orbitResult = addObject(system, orbit)
    system = orbitResult.system
    const limitCycle = makeLimitCycle(system.config.name, {
      type: 'orbit',
      orbitName: orbit.name,
    })
    const limitCycleResult = addObject(system, limitCycle)
    system = limitCycleResult.system
    parentName = limitCycle.name
    parentNodeId = limitCycleResult.nodeId
  }

  const branch = makeContinuationBranch({
    name: `branch_${caseInfo.name}`,
    systemName: system.config.name,
    parentObject: parentName,
    startObject: parentName,
    parameterName: 'mu',
    branchType: caseInfo.branchType,
    branchTypeData: caseInfo.branchTypeData,
    stability: caseInfo.stability,
    state: caseInfo.parentKind === 'limit_cycle' ? LIMIT_CYCLE_STATE : undefined,
  })

  return addBranch(system, branch, parentNodeId).system
}

function buildUiConfigSystem(): System {
  let system = createConfiguredSystem('UI_Config_System')
  const orbit = makeOrbit(system.config.name, 'UI_Orbit')
  const orbitResult = addObject(system, orbit)
  system = orbitResult.system

  const equilibrium = makeEquilibrium(system.config.name, 'UI_Equilibrium')
  const equilibriumResult = addObject(system, equilibrium)
  system = equilibriumResult.system

  const limitCycleBranchOrigin = makeLimitCycle(system.config.name, {
    type: 'orbit',
    orbitName: orbit.name,
  }, 'UI_LC_Branch')
  const limitCycleBranchResult = addObject(system, limitCycleBranchOrigin)
  system = limitCycleBranchResult.system

  const limitCycleObjectOrigin = makeLimitCycle(system.config.name, {
    type: 'orbit',
    orbitName: orbit.name,
  }, 'UI_LC_Object')
  const limitCycleObjectResult = addObject(system, limitCycleObjectOrigin)
  system = limitCycleObjectResult.system

  const branch = makeContinuationBranch({
    name: 'UI_LC_Branch_Mu',
    systemName: system.config.name,
    parentObject: limitCycleBranchOrigin.name,
    startObject: limitCycleBranchOrigin.name,
    parameterName: 'mu',
    branchType: 'limit_cycle',
    branchTypeData: { type: 'LimitCycle', ntst: 4, ncol: 3 },
    stability: 'PeriodDoubling',
    state: LIMIT_CYCLE_STATE,
  })
  const branchResult = addBranch(system, branch, limitCycleBranchResult.nodeId)
  system = branchResult.system

  const sceneResult = addScene(system, 'Scene_UI')
  system = sceneResult.system
  const diagramResult = addBifurcationDiagram(system, 'Diagram_UI')
  system = diagramResult.system

  system = updateScene(system, sceneResult.nodeId, {
    camera: {
      eye: { x: 2, y: 1, z: 0.5 },
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    axisRanges: { x: [-1, 1], y: [-2, 2], z: [0, 3] },
    axisVariables: { x: 'x', y: 'y', z: 'z' },
    selectedNodeIds: [orbitResult.nodeId, branchResult.nodeId],
    display: 'selection',
    viewRevision: 2,
  })
  system = updateBifurcationDiagram(system, diagramResult.nodeId, {
    selectedBranchIds: [branchResult.nodeId],
    xAxis: { kind: 'parameter', name: 'mu' },
    yAxis: { kind: 'state', name: 'x' },
    axisRanges: { x: [0, 1], y: [-1, 1] },
    viewRevision: 1,
  })

  system = updateLayout(system, {
    leftWidth: 220,
    rightWidth: 340,
    objectsOpen: false,
    inspectorOpen: true,
    branchViewerOpen: false,
  })
  system = updateViewportHeights(system, {
    [sceneResult.nodeId]: 240,
    [diagramResult.nodeId]: 180,
  })
  system = selectNode(system, equilibriumResult.nodeId)

  system = updateNodeRender(system, orbitResult.nodeId, {
    color: '#00aa00',
    lineWidth: 3,
    lineStyle: 'dashed',
    pointSize: 6,
    clv: {
      enabled: true,
      stride: 2,
      lengthScale: 1.2,
      headScale: 0.8,
      thickness: 1,
      vectorIndices: [0, 1],
      colors: ['#ff0000', '#00ff00'],
      colorOverrides: { 1: '#0000ff' },
    },
  })
  system = updateNodeRender(system, equilibriumResult.nodeId, {
    color: '#3300ff',
    lineWidth: 2,
    lineStyle: 'dotted',
    equilibriumEigenvectors: {
      enabled: true,
      vectorIndices: [0],
      colors: ['#ffaa00'],
      lineLengthScale: 1.5,
      lineThickness: 2,
      discRadiusScale: 1.2,
      discThickness: 1.1,
      colorOverrides: { 0: '#000000' },
    },
  })

  system = toggleNodeVisibility(system, equilibriumResult.nodeId)
  system = toggleNodeExpanded(system, branchResult.nodeId)

  system = updateLimitCycleRenderTarget(system, limitCycleBranchResult.nodeId, {
    type: 'branch',
    branchId: branchResult.nodeId,
    pointIndex: 1,
  })
  system = updateLimitCycleRenderTarget(system, limitCycleObjectResult.nodeId, {
    type: 'object',
  })

  return system
}

describe('system import/export', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a system bundle from a file', async () => {
    const system = createSystem({ name: 'Example' })
    const bundle = serializeSystem(system)
    const file = makeBundleFile(bundle)

    const restored = await readSystemFile(file)

    expect(restored).toEqual(normalizeSystem(system))
  })

  it('reads a legacy system bundle from a file', async () => {
    const system = createSystem({ name: 'Legacy_System' })
    const bundle = {
      schemaVersion: SYSTEM_PROJECT_SCHEMA_VERSION,
      system,
    }
    const file = makeBundleFile(bundle)

    const restored = await readSystemFile(file)

    expect(restored).toEqual(normalizeSystem(system))
  })

  it('rejects unsupported schema versions', async () => {
    const system = createSystem({ name: 'Versioned_System' })
    const bundle = {
      ...serializeSystem(system),
      schemaVersion: SYSTEM_PROJECT_SCHEMA_VERSION + 1,
    }
    const file = makeBundleFile(bundle)

    await expect(readSystemFile(file)).rejects.toThrow(
      `Unsupported system schema version: ${SYSTEM_PROJECT_SCHEMA_VERSION + 1}`
    )
  })

  it('downloads a system bundle as JSON', async () => {
    const system = createSystem({ name: 'My_System' })
    const { anchor, blob, spies } = await exportSystem(system)
    const payload = JSON.parse(await readBlobText(blob))

    expect(spies.createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(spies.revokeSpy).toHaveBeenCalledWith('blob:mock-url')
    expect(spies.clickSpy).toHaveBeenCalledTimes(1)
    expect(spies.removeSpy).toHaveBeenCalledTimes(1)
    expect(spies.appendSpy).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('My_System.json')
    expect(anchor.href).toBe('blob:mock-url')
    expect(payload).toEqual(serializeSystem(system))
  })

  it('round-trips export/import for a demo system', async () => {
    const { system } = createDemoSystem()
    const { blob, anchor } = await exportSystem(system)
    const file = makeTextFile(await readBlobText(blob), anchor.download)

    const restored = await readSystemFile(file)

    expect(restored).toEqual(normalizeSystem(system))
  })

  it('round-trips export/import for large systems', async () => {
    const system = createLargeSystem()
    const { blob, anchor } = await exportSystem(system)
    const file = makeTextFile(await readBlobText(blob), anchor.download)

    const restored = await readSystemFile(file)

    expect(restored).toEqual(normalizeSystem(system))
  })

  it.each(objectCases)('round-trips $name objects', async ({ build }) => {
    const system = build()
    const restored = await roundTripSystem(system)
    expect(restored).toEqual(normalizeSystem(system))
  })

  it.each(branchCases)('round-trips $name continuation branches', async (caseInfo) => {
    const system = buildSystemWithBranch(caseInfo)
    const restored = await roundTripSystem(system)
    expect(restored).toEqual(normalizeSystem(system))
  })

  it('round-trips full UI configuration', async () => {
    const system = buildUiConfigSystem()
    const restored = await roundTripSystem(system)
    const normalized = normalizeSystem(system)

    expect(restored.ui).toEqual(normalized.ui)
    expect(restored.nodes).toEqual(normalized.nodes)
    expect(restored.rootIds).toEqual(normalized.rootIds)
    expect(restored.scenes).toEqual(normalized.scenes)
    expect(restored.bifurcationDiagrams).toEqual(normalized.bifurcationDiagrams)
  })

  it('moves exports between opfs and indexeddb stores', async () => {
    const { cleanup } = installMockOpfs()
    const opfsStore = new OpfsSystemStore()
    const indexedDbStore = makeIndexedDbStore()
    const { system } = createDemoSystem()

    try {
      await opfsStore.save(system)
      const stored = await opfsStore.load(system.id)
      const { blob, anchor } = await exportSystem(stored)
      const file = makeTextFile(await readBlobText(blob), anchor.download)
      const imported = await readSystemFile(file)

      await indexedDbStore.save(imported)
      const loaded = await indexedDbStore.load(imported.id)
      expect(loaded).toEqual(normalizeSystem(system))

      await indexedDbStore.save(system)
      const indexedStored = await indexedDbStore.load(system.id)
      const indexedExport = await exportSystem(indexedStored)
      const indexedFile = makeTextFile(
        await readBlobText(indexedExport.blob),
        indexedExport.anchor.download
      )
      const opfsImported = await readSystemFile(indexedFile)
      await opfsStore.save(opfsImported)
      const opfsLoaded = await opfsStore.load(opfsImported.id)
      expect(opfsLoaded).toEqual(normalizeSystem(system))
    } finally {
      await opfsStore.clear()
      await indexedDbStore.clear()
      cleanup()
    }
  })
})
