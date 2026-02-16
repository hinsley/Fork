import { afterEach, describe, expect, it } from 'vitest'
import { OpfsSystemStore } from './opfs'
import { addBranch, addObject, createSystem, updateLayout, updateObject } from './model'
import type { ContinuationObject, ContinuationSettings, OrbitObject, System } from './types'
import { installMockOpfs } from '../test/opfsMock'
import { nowIso } from '../utils/determinism'

const SETTINGS: ContinuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-6,
  max_step_size: 0.1,
  max_steps: 100,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

type MockDirectoryHandle = {
  kind: 'directory'
  entries: Map<string, MockEntry>
}

type MockFileHandle = {
  kind: 'file'
  contents: string
  writeCount: number
}

type MockEntry = MockDirectoryHandle | MockFileHandle

function getMockFile(root: MockDirectoryHandle, path: string[]): MockFileHandle {
  let current: MockEntry = root
  for (const segment of path) {
    if (current.kind !== 'directory') {
      throw new Error(`Expected directory before "${segment}"`)
    }
    const next = current.entries.get(segment)
    if (!next) {
      throw new Error(`Missing mock entry at "${segment}"`)
    }
    current = next
  }
  if (current.kind !== 'file') {
    throw new Error(`Expected file at "${path.join('/')}"`)
  }
  return current
}

function createOpfsFixture(): {
  system: System
  orbitAId: string
  orbitBId: string
  branchId: string
} {
  const system = createSystem({ name: 'Opfs_System' })
  const orbitA: OrbitObject = {
    type: 'orbit',
    name: 'Orbit_A',
    systemName: system.config.name,
    data: [
      [0, 0, 0],
      [0.1, 0.2, 0.3],
    ],
    t_start: 0,
    t_end: 0.1,
    dt: 0.1,
    parameters: [...system.config.params],
  }
  const orbitB: OrbitObject = {
    type: 'orbit',
    name: 'Orbit_B',
    systemName: system.config.name,
    data: [
      [0, 1, 0],
      [0.1, 1.2, 0.2],
    ],
    t_start: 0,
    t_end: 0.1,
    dt: 0.1,
    parameters: [...system.config.params],
  }
  const withOrbitA = addObject(system, orbitA)
  const withOrbitB = addObject(withOrbitA.system, orbitB)

  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'eq_mu',
    systemName: withOrbitB.system.config.name,
    parameterName: 'mu',
    parentObjectId: withOrbitA.nodeId,
    startObjectId: withOrbitA.nodeId,
    parentObject: orbitA.name,
    startObject: orbitA.name,
    branchType: 'equilibrium',
    data: {
      points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
      bifurcations: [],
      indices: [0],
    },
    settings: SETTINGS,
    timestamp: nowIso(),
    params: [...withOrbitB.system.config.params],
  }
  const withBranch = addBranch(withOrbitB.system, branch, withOrbitA.nodeId)

  return {
    system: withBranch.system,
    orbitAId: withOrbitA.nodeId,
    orbitBId: withOrbitB.nodeId,
    branchId: withBranch.nodeId,
  }
}

let cleanup: (() => void) | null = null

afterEach(async () => {
  if (cleanup) {
    cleanup()
    cleanup = null
  }
})

describe('OpfsSystemStore v3', () => {
  it('loads skeleton systems and hydrates entities on demand', async () => {
    const installed = installMockOpfs()
    cleanup = installed.cleanup
    const store = new OpfsSystemStore()
    const fixture = createOpfsFixture()
    await store.save(fixture.system)

    const skeleton = await store.load(fixture.system.id)
    expect(Object.keys(skeleton.index.objects).sort()).toEqual(
      Object.keys(fixture.system.index.objects).sort()
    )
    expect(Object.keys(skeleton.index.branches).sort()).toEqual(
      Object.keys(fixture.system.index.branches).sort()
    )
    expect(skeleton.objects).toEqual({})
    expect(skeleton.branches).toEqual({})

    const loaded = await store.loadEntities(
      fixture.system.id,
      [fixture.orbitAId],
      [fixture.branchId]
    )
    expect(Object.keys(loaded.objects)).toEqual([fixture.orbitAId])
    expect(Object.keys(loaded.branches)).toEqual([fixture.branchId])
    expect(loaded.objects[fixture.orbitAId].name).toBe('Orbit_A')
    expect(loaded.branches[fixture.branchId].parentObjectId).toBe(fixture.orbitAId)
  })

  it('saves only changed payload files for single-entity edits', async () => {
    const installed = installMockOpfs()
    cleanup = installed.cleanup
    const root = installed.root as unknown as MockDirectoryHandle
    const store = new OpfsSystemStore()
    const fixture = createOpfsFixture()
    await store.save(fixture.system)

    const objectAShard = fixture.system.index.objects[fixture.orbitAId].shard
    const objectBShard = fixture.system.index.objects[fixture.orbitBId].shard
    const branchShard = fixture.system.index.branches[fixture.branchId].shard

    const objectAPath = [
      'fork-systems-v3',
      fixture.system.id,
      'objects',
      objectAShard,
      `${fixture.orbitAId}.json`,
    ]
    const objectBPath = [
      'fork-systems-v3',
      fixture.system.id,
      'objects',
      objectBShard,
      `${fixture.orbitBId}.json`,
    ]
    const branchPath = [
      'fork-systems-v3',
      fixture.system.id,
      'branches',
      branchShard,
      `${fixture.branchId}.json`,
    ]

    const beforeObjectA = getMockFile(root, objectAPath).writeCount
    const beforeObjectB = getMockFile(root, objectBPath).writeCount
    const beforeBranch = getMockFile(root, branchPath).writeCount

    const edited = updateObject(fixture.system, fixture.orbitAId, { name: 'Orbit_A_Updated' })
    await store.save(edited)

    expect(getMockFile(root, objectAPath).writeCount).toBe(beforeObjectA + 1)
    expect(getMockFile(root, objectBPath).writeCount).toBe(beforeObjectB)
    expect(getMockFile(root, branchPath).writeCount).toBe(beforeBranch)
  })

  it('keeps payload files untouched for saveUi-only writes', async () => {
    const installed = installMockOpfs()
    cleanup = installed.cleanup
    const root = installed.root as unknown as MockDirectoryHandle
    const store = new OpfsSystemStore()
    const fixture = createOpfsFixture()
    await store.save(fixture.system)

    const objectAShard = fixture.system.index.objects[fixture.orbitAId].shard
    const objectBShard = fixture.system.index.objects[fixture.orbitBId].shard
    const branchShard = fixture.system.index.branches[fixture.branchId].shard
    const objectAPath = [
      'fork-systems-v3',
      fixture.system.id,
      'objects',
      objectAShard,
      `${fixture.orbitAId}.json`,
    ]
    const objectBPath = [
      'fork-systems-v3',
      fixture.system.id,
      'objects',
      objectBShard,
      `${fixture.orbitBId}.json`,
    ]
    const branchPath = [
      'fork-systems-v3',
      fixture.system.id,
      'branches',
      branchShard,
      `${fixture.branchId}.json`,
    ]

    const beforeObjectA = getMockFile(root, objectAPath).writeCount
    const beforeObjectB = getMockFile(root, objectBPath).writeCount
    const beforeBranch = getMockFile(root, branchPath).writeCount

    const uiOnly = updateLayout(fixture.system, {
      leftWidth: fixture.system.ui.layout.leftWidth + 25,
    })
    await store.saveUi(uiOnly)

    expect(getMockFile(root, objectAPath).writeCount).toBe(beforeObjectA)
    expect(getMockFile(root, objectBPath).writeCount).toBe(beforeObjectB)
    expect(getMockFile(root, branchPath).writeCount).toBe(beforeBranch)
  })
})
