import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppProvider } from './appState'
import { useAppContext } from './appContext'
import { MockForkCoreClient } from '../compute/mockClient'
import { MemorySystemStore } from '../system/store'
import { addBranch, addObject, addScene, createSystem } from '../system/model'
import {
  createLimitCycleManifoldSystem,
  createPeriodDoublingSystem,
} from '../system/fixtures'
import { normalizeBranchEigenvalues } from '../system/continuation'
import { buildSubsystemSnapshot } from '../system/subsystemGateway'
import { projectLimitCyclePackedStateForSnapshot } from '../system/limitCycleAnalysis'
import type {
  AnalysisObject,
  ContinuationObject,
  ContinuationPoint,
  ContinuationSettings,
  EquilibriumObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  System,
} from '../system/types'

const continuationSettings: ContinuationSettings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 12,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

function setupApp(
  initialSystem: System,
  clientOverride?: MockForkCoreClient,
  initialError?: string | null
) {
  const store = new MemorySystemStore()
  const client = clientOverride ?? new MockForkCoreClient(0)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider
      store={store}
      client={client}
      initialSystem={initialSystem}
      initialError={initialError}
    >
      {children}
    </AppProvider>
  )
  const { result } = renderHook(() => useAppContext(), { wrapper })

  const getContext = () => {
    if (!result.current) {
      throw new Error('Missing app context.')
    }
    return result.current
  }

  return { getContext }
}

function setupAppWithStore(
  store: MemorySystemStore,
  options: {
    initialSystem?: System | null
    clientOverride?: MockForkCoreClient
  } = {}
) {
  const client = options.clientOverride ?? new MockForkCoreClient(0)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider
      store={store}
      client={client}
      initialSystem={options.initialSystem ?? null}
      initialSystems={[]}
    >
      {children}
    </AppProvider>
  )
  const { result } = renderHook(() => useAppContext(), { wrapper })
  const getContext = () => {
    if (!result.current) {
      throw new Error('Missing app context.')
    }
    return result.current
  }
  return { getContext }
}

function findObjectIdByName(system: System, name: string): string {
  const match = Object.entries(system.objects).find(([, obj]) => obj.name === name)
  if (!match) {
    throw new Error(`Missing object ${name}`)
  }
  return match[0]
}

function findBranchIdByName(system: System, name: string): string {
  const match = Object.entries(system.branches).find(([, branch]) => branch.name === name)
  if (!match) {
    throw new Error(`Missing branch ${name}`)
  }
  return match[0]
}

function withParam(system: System, name: string, value: number): System {
  return {
    ...system,
    config: {
      ...system.config,
      paramNames: [name],
      params: [value],
    },
  }
}

function createCodimCycleAnalysisSystem(): {
  system: System
  limitCycleId: string
  selectedBranchId: string
  expectedCycleState: number[]
  frozenRuntimeParameterName: string
} {
  const base = createSystem({
    name: 'Codim_Cycle_Analysis',
    config: {
      name: 'Codim_Cycle_Analysis',
      equations: ['y', '-x + mu*x', 'z + nu'],
      params: [0.1, 0.2],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    },
  })
  const objectSnapshot = buildSubsystemSnapshot(base.config, {
    frozenValuesByVarName: { z: 0.2 },
  })
  const limitCycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'LC_Codim_Analysis',
    systemName: base.config.name,
    origin: { type: 'orbit', orbitName: 'Orbit_Codim_Analysis' },
    ntst: 2,
    ncol: 1,
    period: 6,
    // Standard limit-cycle storage: implicit mesh first, then stages, then period.
    state: [10, 11, 12, 20, 21, 22, 100, 101, 102, 110, 111, 112, 6],
    parameters: [0.1, 0.2],
    parameterName: 'mu',
    parameterRef: { kind: 'native_param', name: 'mu' },
    paramValue: 0.1,
    floquetMultipliers: [{ re: 7, im: 0 }],
    frozenVariables: { frozenValuesByVarName: { z: 0.2 } },
    subsystemSnapshot: objectSnapshot,
    createdAt: new Date().toISOString(),
  }
  const withObject = addObject(base, limitCycle)
  const branchSnapshot = buildSubsystemSnapshot(base.config, {
    frozenValuesByVarName: { z: 0.4 },
  })
  const selectedBranch: ContinuationObject = {
    type: 'continuation',
    name: 'lpc_selected_z_nu',
    systemName: base.config.name,
    parameterName: 'var:z, nu',
    parameterRef: { kind: 'frozen_var', variableName: 'z' },
    parameter2Ref: { kind: 'native_param', name: 'nu' },
    parentObjectId: withObject.nodeId,
    startObjectId: withObject.nodeId,
    parentObject: limitCycle.name,
    startObject: limitCycle.name,
    branchType: 'lpc_curve',
    data: {
      points: [
        {
          // LPC/NS/isoperiodic storage: stages first, then an explicit mesh closure.
          state: [
            100, 101, 102, 110, 111, 112,
            10, 11, 12, 20, 21, 22, 10, 11, 12,
            6,
          ],
          param_value: 0.7,
          param2_value: 1.3,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [],
      indices: [0],
      branch_type: {
        type: 'LPCCurve',
        param1_name: 'var:z',
        param2_name: 'nu',
        param1_ref: { kind: 'frozen_var', variableName: 'z' },
        param2_ref: { kind: 'native_param', name: 'nu' },
        ntst: 2,
        ncol: 1,
        normalized_mesh: [0, 0.3, 1],
      },
    },
    settings: continuationSettings,
    timestamp: '2026-01-01T00:00:00.000Z',
    params: [0.15, 0.25],
    subsystemSnapshot: branchSnapshot,
  }
  const withSelectedBranch = addBranch(withObject.system, selectedBranch, withObject.nodeId)

  // A deliberately newer, different state with a bogus spectrum. Manifold analysis
  // must never borrow this when the selected LPC point has no eigenvalues.
  const unrelatedBranch: ContinuationObject = {
    ...selectedBranch,
    name: 'lc_unrelated_newer',
    branchType: 'limit_cycle',
    parameterName: 'mu',
    parameterRef: { kind: 'native_param', name: 'mu' },
    parameter2Ref: undefined,
    data: {
      points: [
        {
          state: [...limitCycle.state],
          param_value: 0.9,
          stability: 'None',
          eigenvalues: [{ re: 99, im: 0 }],
        },
      ],
      bifurcations: [],
      indices: [0],
      branch_type: { type: 'LimitCycle', ntst: 2, ncol: 1 },
    },
    timestamp: '2099-01-01T00:00:00.000Z',
    subsystemSnapshot: objectSnapshot,
  }
  const withUnrelatedBranch = addBranch(
    withSelectedBranch.system,
    unrelatedBranch,
    withObject.nodeId
  )

  return {
    system: withUnrelatedBranch.system,
    limitCycleId: withObject.nodeId,
    selectedBranchId: withSelectedBranch.nodeId,
    expectedCycleState: [
      10, 11, 20, 21, 10, 11,
      100, 101, 110, 111,
      6,
    ],
    frozenRuntimeParameterName: branchSnapshot.frozenParameterNamesByVarName.z,
  }
}

describe('appState limit-cycle state projection', () => {
  it('uses the known explicit layout when reduced and full packed lengths collide', () => {
    const config = createSystem({
      name: 'Packed_Layout_Collision',
      config: {
        name: 'Packed_Layout_Collision',
        equations: ['0', '0', '0', '0', '0', '0', '0'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'frozen'],
        solver: 'rk4',
        type: 'flow',
      },
    }).config
    const snapshot = buildSubsystemSnapshot(config, {
      frozenValuesByVarName: { frozen: 0.25 },
    })
    // ntst=2, ncol=2 gives 7 explicit reduced points * 6 coordinates,
    // which collides with 6 implicit full points * 7 coordinates.
    const reducedExplicitState = Array.from({ length: 43 }, (_, index) => index + 0.5)

    expect(
      projectLimitCyclePackedStateForSnapshot(
        snapshot,
        reducedExplicitState,
        2,
        2,
        'Collision state',
        'explicit'
      )
    ).toEqual(reducedExplicitState)
  })
})

describe('appState initialization', () => {
  it('supports initial error messaging', () => {
    const base = createSystem({ name: 'Init_Error' })
    const { getContext } = setupApp(base, undefined, 'Storage unavailable.')
    expect(getContext().state.error).toBe('Storage unavailable.')
  })
})

describe('appState selection', () => {
  it('does not update the system when selecting the same node twice', async () => {
    const base = createSystem({ name: 'Select_Test' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_1',
      systemName: base.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [...base.config.params],
    }
    const { system, nodeId } = addObject(base, orbit)
    const { getContext } = setupApp(system)

    await act(async () => {
      getContext().actions.selectNode(nodeId)
    })

    const firstSystem = getContext().state.system

    await act(async () => {
      getContext().actions.selectNode(nodeId)
    })

    const secondSystem = getContext().state.system
    expect(secondSystem).toBe(firstSystem)
  })
})

describe('appState lazy hydration', () => {
  class LazyHydrationStore extends MemorySystemStore {
    loadEntitiesCalls: Array<{ systemId: string; objectIds: string[]; branchIds: string[] }> = []
    private readonly fullSystems: Record<string, System>

    constructor(systems: System[]) {
      super()
      this.fullSystems = Object.fromEntries(systems.map((system) => [system.id, structuredClone(system)]))
    }

    override async load(id: string): Promise<System> {
      const full = this.fullSystems[id]
      if (!full) {
        throw new Error(`System "${id}" not found`)
      }
      return {
        ...structuredClone(full),
        objects: {},
        branches: {},
      }
    }

    override async loadEntities(
      systemId: string,
      objectIds: string[],
      branchIds: string[]
    ): Promise<{ objects: Record<string, AnalysisObject>; branches: Record<string, ContinuationObject> }> {
      this.loadEntitiesCalls.push({ systemId, objectIds: [...objectIds], branchIds: [...branchIds] })
      const full = this.fullSystems[systemId]
      if (!full) {
        throw new Error(`System "${systemId}" not found`)
      }
      const objects = Object.fromEntries(
        objectIds
          .map((id) => (full.objects[id] ? [id, structuredClone(full.objects[id])] : null))
          .filter((entry): entry is [string, AnalysisObject] => Boolean(entry))
      )
      const branches = Object.fromEntries(
        branchIds
          .map((id) => (full.branches[id] ? [id, structuredClone(full.branches[id])] : null))
          .filter((entry): entry is [string, ContinuationObject] => Boolean(entry))
      )
      return { objects, branches }
    }
  }

  it('hydrates selected entities when opening skeleton systems', async () => {
    const base = createSystem({ name: 'Lazy_Select' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_Lazy',
      systemName: base.config.name,
      data: [[0, 0, 0]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [...base.config.params],
    }
    const withOrbit = addObject(base, orbit)
    withOrbit.system.nodes[withOrbit.nodeId].visibility = false
    const store = new LazyHydrationStore([withOrbit.system])
    const { getContext } = setupAppWithStore(store)

    await act(async () => {
      await getContext().actions.openSystem(withOrbit.system.id)
    })

    expect(getContext().state.system?.objects[withOrbit.nodeId]).toBeUndefined()
    expect(store.loadEntitiesCalls).toHaveLength(0)

    await act(async () => {
      getContext().actions.selectNode(withOrbit.nodeId)
    })

    await waitFor(() => {
      const loaded = getContext().state.system?.objects[withOrbit.nodeId]
      expect(loaded).toBeDefined()
      expect(getContext().state.error).toBeNull()
    })
    expect(
      store.loadEntitiesCalls.some((call) => call.objectIds.includes(withOrbit.nodeId))
    ).toBe(true)
  })

  it('auto-hydrates equilibrium payloads before solve actions', async () => {
    const base = createSystem({ name: 'Lazy_Solve' })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Lazy',
      systemName: base.config.name,
      solution: {
        state: [0, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [1, 0, 0, 1],
        eigenpairs: [],
      },
      parameters: [...base.config.params],
    }
    const withEquilibrium = addObject(base, equilibrium)
    withEquilibrium.system.nodes[withEquilibrium.nodeId].visibility = false
    const store = new LazyHydrationStore([withEquilibrium.system])
    const { getContext } = setupAppWithStore(store, {
      clientOverride: new MockForkCoreClient(0),
    })

    await act(async () => {
      await getContext().actions.openSystem(withEquilibrium.system.id)
    })

    expect(getContext().state.system?.objects[withEquilibrium.nodeId]).toBeUndefined()

    await act(async () => {
      await getContext().actions.solveEquilibrium({
        equilibriumId: withEquilibrium.nodeId,
        initialGuess: [0.1, -0.2],
        maxSteps: 10,
        dampingFactor: 1,
      })
    })

    await waitFor(() => {
      const loaded = getContext().state.system?.objects[withEquilibrium.nodeId]
      expect(loaded).toBeDefined()
      expect(getContext().state.error).toBeNull()
    })
    expect(
      store.loadEntitiesCalls.some((call) => call.objectIds.includes(withEquilibrium.nodeId))
    ).toBe(true)
  })

  it('hydrates limit-cycle render-target branches even when branch nodes are hidden', async () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = findBranchIdByName(system, 'lc_pd_mu')
    const lcId = findObjectIdByName(system, 'LC_PD')
    const hidden = structuredClone(system)
    hidden.nodes[lcId].expanded = false
    hidden.ui.limitCycleRenderTargets = {
      [lcId]: { type: 'branch', branchId, pointIndex: 1 },
    }
    const store = new LazyHydrationStore([hidden])
    const { getContext } = setupAppWithStore(store)

    await act(async () => {
      await getContext().actions.openSystem(hidden.id)
    })

    await waitFor(() => {
      expect(getContext().state.system?.branches[branchId]).toBeDefined()
      expect(getContext().state.error).toBeNull()
    })
    expect(
      store.loadEntitiesCalls.some((call) => call.branchIds.includes(branchId))
    ).toBe(true)
  })

  it('warms cached isocline geometry after lazy entity hydration', async () => {
    const base = createSystem({ name: 'Lazy_Isocline_Warmup' })
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Lazy',
      systemName: base.config.name,
      source: { kind: 'custom', expression: 'x' },
      level: 0,
      axes: [
        { variableName: 'x', min: -2, max: 2, samples: 24 },
        { variableName: 'y', min: -2, max: 2, samples: 24 },
      ],
      frozenState: [0, 0],
      parameters: [...base.config.params],
      lastComputed: {
        source: { kind: 'custom', expression: 'x + y' },
        expression: 'x + y',
        level: 1.25,
        axes: [
          { variableName: 'x', min: -1, max: 1, samples: 16 },
          { variableName: 'y', min: -1, max: 1, samples: 16 },
        ],
        frozenState: [0, 0],
        parameters: [...base.config.params],
        computedAt: '2026-02-06T00:00:00.000Z',
      },
    }
    const added = addObject(base, isocline)
    const store = new LazyHydrationStore([added.system])
    const client = new MockForkCoreClient(0)
    const captured: Array<{ expression: string; level: number }> = []
    client.computeIsocline = async (request) => {
      captured.push({ expression: request.expression, level: request.level })
      return {
        geometry: 'segments',
        dim: request.system.varNames.length,
        points: [0, 0, 1, 1],
        segments: [0, 1],
      }
    }
    const { getContext } = setupAppWithStore(store, { clientOverride: client })

    await act(async () => {
      await getContext().actions.openSystem(added.system.id)
    })

    await waitFor(() => {
      expect(getContext().state.system?.objects[added.nodeId]).toBeDefined()
      expect(getContext().state.error).toBeNull()
    })
    await waitFor(() => {
      expect(getContext().state.isoclineGeometryCache[added.nodeId]).toBeDefined()
    })
    expect(captured).toEqual([{ expression: 'x + y', level: 1.25 }])
    expect(
      store.loadEntitiesCalls.some((call) => call.objectIds.includes(added.nodeId))
    ).toBe(true)
  })
})

describe('appState rename persistence routing', () => {
  class SpySystemStore extends MemorySystemStore {
    saveCount = 0
    saveUiCount = 0

    override async save(system: System): Promise<void> {
      this.saveCount += 1
      await super.save(system)
    }

    override async saveUi(system: System): Promise<void> {
      this.saveUiCount += 1
      await super.saveUi(system)
    }
  }

  it('keeps selection unsaved, routes style updates to saveUi, and routes object renames to save', async () => {
    const base = createSystem({ name: 'Rename_Routing' })
    const withScene = addScene(base, 'Scene_For_Rename')
    const sceneId = withScene.nodeId
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_For_Rename',
      systemName: base.config.name,
      data: [[0, 0, 0, 0]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [...base.config.params],
    }
    const withOrbit = addObject(withScene.system, orbit)
    const store = new SpySystemStore()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppProvider store={store} client={new MockForkCoreClient(0)} initialSystem={withOrbit.system}>
        {children}
      </AppProvider>
    )
    const { result } = renderHook(() => useAppContext(), { wrapper })
    const getContext = () => {
      if (!result.current) {
        throw new Error('Missing app context.')
      }
      return result.current
    }

    await act(async () => {
      getContext().actions.renameNode(sceneId, 'Scene_Renamed')
    })

    await waitFor(() => {
      expect(store.saveUiCount).toBe(1)
      expect(store.saveCount).toBe(0)
    })

    await act(async () => {
      getContext().actions.selectNode(withOrbit.nodeId)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(store.saveUiCount).toBe(1)
    expect(store.saveCount).toBe(0)

    await act(async () => {
      getContext().actions.updateRender(withOrbit.nodeId, { lineWidth: 4, color: '#ff0000' })
    })

    await waitFor(() => {
      expect(store.saveUiCount).toBe(2)
      expect(store.saveCount).toBe(0)
    })

    await act(async () => {
      getContext().actions.renameNode(withOrbit.nodeId, 'Orbit_Renamed')
    })

    await waitFor(() => {
      expect(store.saveCount).toBe(1)
      expect(store.saveUiCount).toBe(2)
    })
  })
})

describe('appState limit cycle render targets', () => {
  it('uses the last computed point after continuing from an orbit', async () => {
    const base = createSystem({ name: 'Orbit_LC' })
    const configured = withParam(base, 'mu', 0.1)
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit Seed',
      systemName: configured.config.name,
      data: [
        [0, 0, 1],
        [0.1, 0.1, 0.99],
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [...configured.config.params],
    }
    const { system, nodeId: orbitId } = addObject(configured, orbit)
    const client = new MockForkCoreClient(0)
    client.runLimitCycleContinuationFromOrbit = async (request) => {
      const state = new Array(request.system.varNames.length + 1).fill(0)
      state[state.length - 1] = 2
      return normalizeBranchEigenvalues({
        points: [
          {
            state,
            param_value: request.paramValue,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state,
            param_value: request.paramValue + request.settings.step_size,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: request.ntst, ncol: request.ncol },
      })
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.createLimitCycleFromOrbit({
        orbitId,
        limitCycleName: 'LC_Orbit',
        branchName: 'lc_orbit_mu',
        parameterName: 'mu',
        tolerance: 1e-6,
        ntst: 10,
        ncol: 4,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const { state } = getContext()
      expect(state.error).toBeNull()
      const next = state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_Orbit')
      const branchId = findBranchIdByName(next!, 'lc_orbit_mu')
      const lastIndex = next!.branches[branchId].data.points.length - 1
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: lastIndex,
      })
    })
  })

  it('rejects flow limit-cycle continuation from map Orbit objects', async () => {
    const base = createSystem({ name: 'Orbit_Map' })
    const configured = withParam(
      {
        ...base,
        config: {
          ...base.config,
          type: 'map',
          solver: 'discrete',
        },
      },
      'mu',
      0.1
    )
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Map Orbit',
      systemName: configured.config.name,
      data: [
        [0, 0.2],
        [1, 0.3],
      ],
      t_start: 0,
      t_end: 1,
      dt: 1,
      parameters: [...configured.config.params],
    }
    const { system, nodeId: orbitId } = addObject(configured, orbit)
    const client = new MockForkCoreClient(0)
    let capturedSystemType: string | null = null
    client.runLimitCycleContinuationFromOrbit = async (request) => {
      capturedSystemType = request.system.type
      const state = new Array(request.system.varNames.length + 1).fill(0)
      state[state.length - 1] = 2
      return normalizeBranchEigenvalues({
        points: [
          {
            state,
            param_value: request.paramValue,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state,
            param_value: request.paramValue + request.settings.step_size,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: request.ntst, ncol: request.ncol },
      })
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.createLimitCycleFromOrbit({
        orbitId,
        limitCycleName: 'LC_Map',
        branchName: 'lc_map_mu',
        parameterName: 'mu',
        tolerance: 1e-6,
        ntst: 10,
        ncol: 4,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const { state } = getContext()
      expect(state.error).toMatch(/flow systems only/)
      expect(capturedSystemType).toBeNull()
      expect(Object.values(state.system!.objects).some((obj) => obj.name === 'LC_Map')).toBe(false)
    })
  })

  it('uses the last computed point after continuing from Hopf', async () => {
    const base = createSystem({ name: 'Hopf_LC' })
    const configured = withParam(base, 'mu', 0.0)
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_H',
      systemName: configured.config.name,
      parameters: [...configured.config.params],
    }
    const added = addObject(configured, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_hopf_mu',
      systemName: configured.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'Hopf',
            eigenvalues: [
              { re: 0, im: 1 },
              { re: 0, im: -1 },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...configured.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const { getContext } = setupApp(branchResult.system)

    await act(async () => {
      await getContext().actions.createLimitCycleFromHopf({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        parameterName: 'mu',
        limitCycleName: 'LC_Hopf',
        branchName: 'lc_hopf_mu',
        amplitude: 0.2,
        ntst: 10,
        ncol: 4,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_Hopf')
      const branchId = findBranchIdByName(next!, 'lc_hopf_mu')
      const lastIndex = next!.branches[branchId].data.points.length - 1
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: lastIndex,
      })
    })
  })

  it('uses the last computed point after continuing from a PD point', async () => {
    const { system } = createPeriodDoublingSystem()
    const { getContext } = setupApp(system)

    const sourceBranchId = findBranchIdByName(system, 'lc_pd_mu')

    await act(async () => {
      await getContext().actions.createLimitCycleFromPD({
        branchId: sourceBranchId,
        pointIndex: 1,
        limitCycleName: 'LC_PD_New',
        branchName: 'lc_pd_new_mu',
        amplitude: 0.1,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_PD_New')
      const branchId = findBranchIdByName(next!, 'lc_pd_new_mu')
      const lastIndex = next!.branches[branchId].data.points.length - 1
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: lastIndex,
      })
    })
  })

  it('updates the target when extending a limit cycle branch', async () => {
    const { system } = createPeriodDoublingSystem()
    const { getContext } = setupApp(system)

    const branchId = findBranchIdByName(system, 'lc_pd_mu')
    const parentName = system.branches[branchId].parentObject
    const lcId = findObjectIdByName(system, parentName)

    await act(async () => {
      await getContext().actions.extendBranch({
        branchId,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lastIndex = next!.branches[branchId].data.points.length - 1
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: lastIndex,
      })
    })
  })

  it('updates limit-cycle object parameters when selecting a branch render target point', async () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = findBranchIdByName(system, 'lc_pd_mu')
    const lcId = findObjectIdByName(system, 'LC_PD')
    const seededLimitCycle = system.objects[lcId]
    if (!seededLimitCycle || seededLimitCycle.type !== 'limit_cycle') {
      throw new Error('Expected limit cycle object.')
    }
    seededLimitCycle.floquetMultipliers = [{ re: 0.9, im: 0 }]
    seededLimitCycle.floquetModes = {
      ntst: seededLimitCycle.ntst,
      ncol: seededLimitCycle.ncol,
      multipliers: [{ re: 0.9, im: 0 }],
      vectors: [
        [
          [
            { re: 1, im: 0 },
            { re: 0, im: 0 },
          ],
        ],
      ],
      computedAt: new Date().toISOString(),
    }
    const { getContext } = setupApp(system)

    await act(async () => {
      getContext().actions.setLimitCycleRenderTarget(lcId, {
        type: 'branch',
        branchId,
        pointIndex: 1,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const limitCycle = next!.objects[lcId]
      if (!limitCycle || limitCycle.type !== 'limit_cycle') {
        throw new Error('Expected limit cycle object.')
      }
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: 1,
      })
      expect(limitCycle.parameters?.[0]).toBeCloseTo(0.25, 12)
      expect(limitCycle.customParameters?.[0]).toBeCloseTo(0.25, 12)
      expect(limitCycle.paramValue).toBeCloseTo(0.25, 12)
      expect(limitCycle.floquetMultipliers).toEqual([{ re: -1, im: 0 }])
      expect(limitCycle.floquetModes).toBeUndefined()
    })
  })

  it('uses the selected branch render target point when computing Floquet modes', async () => {
    const { system } = createPeriodDoublingSystem()
    const branchId = findBranchIdByName(system, 'lc_pd_mu')
    const lcId = findObjectIdByName(system, 'LC_PD')
    const client = new MockForkCoreClient(0)
    let capturedRequest:
      | {
          cycleState: number[]
          systemParams: number[]
          ntst: number
          ncol: number
          normalizedMesh: number[]
        }
      | null = null
    const originalCompute = client.computeLimitCycleFloquetModes.bind(client)
    client.computeLimitCycleFloquetModes = async (request, opts) => {
      capturedRequest = {
        cycleState: [...request.cycleState],
        systemParams: [...request.system.params],
        ntst: request.ntst,
        ncol: request.ncol,
        normalizedMesh: [...request.normalizedMesh],
      }
      return originalCompute(request, opts)
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      getContext().actions.setLimitCycleRenderTarget(lcId, {
        type: 'branch',
        branchId,
        pointIndex: 1,
      })
      await getContext().actions.computeLimitCycleFloquetModes({ limitCycleId: lcId })
    })

    await waitFor(() => {
      expect(capturedRequest).not.toBeNull()
      expect(capturedRequest!.cycleState).toEqual(system.branches[branchId].data.points[1].state)
      expect(capturedRequest!.systemParams[0]).toBeCloseTo(0.25, 12)
      expect(capturedRequest!.ntst).toBe(4)
      expect(capturedRequest!.ncol).toBe(2)
      expect(capturedRequest!.normalizedMesh).toEqual([0, 0.25, 0.5, 0.75, 1])
      expect(getContext().state.error).toBeNull()
    })
  })

  it('canonicalizes and projects selected codim1 cycle states for Floquet analysis', async () => {
    const fixture = createCodimCycleAnalysisSystem()
    const client = new MockForkCoreClient(0)
    let capturedRequest:
      | {
          cycleState: number[]
          systemParams: number[]
          parameterName: string
          normalizedMesh: number[]
        }
      | null = null
    client.computeLimitCycleFloquetModes = async (request) => {
      capturedRequest = {
        cycleState: [...request.cycleState],
        systemParams: [...request.system.params],
        parameterName: request.parameterName,
        normalizedMesh: [...request.normalizedMesh],
      }
      return {
        ntst: request.ntst,
        ncol: request.ncol,
        backend: 'periodic_schur',
        multipliers: [
          { re: 1, im: 0 },
          { re: 2, im: 0 },
        ],
        vectors: [],
      }
    }
    const { getContext } = setupApp(fixture.system, client)

    await act(async () => {
      getContext().actions.setLimitCycleRenderTarget(fixture.limitCycleId, {
        type: 'branch',
        branchId: fixture.selectedBranchId,
        pointIndex: 0,
      })
    })
    await waitFor(() => {
      expect(
        getContext().state.system?.ui.limitCycleRenderTargets?.[fixture.limitCycleId]
      ).toEqual({
        type: 'branch',
        branchId: fixture.selectedBranchId,
        pointIndex: 0,
      })
    })

    await act(async () => {
      await getContext().actions.computeLimitCycleFloquetModes({
        limitCycleId: fixture.limitCycleId,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      expect(capturedRequest).not.toBeNull()
      expect(capturedRequest!.cycleState).toEqual(fixture.expectedCycleState)
      expect(capturedRequest!.systemParams).toEqual([0.15, 1.3, 0.7])
      expect(capturedRequest!.parameterName).toBe(fixture.frozenRuntimeParameterName)
      expect(capturedRequest!.normalizedMesh).toEqual([0, 0.3, 1])
      const object = getContext().state.system?.objects[fixture.limitCycleId]
      expect(object?.type === 'limit_cycle' ? object.floquetModes?.backend : undefined).toBe(
        'periodic_schur'
      )
    })
  })

  it('recomputes the exact selected cycle spectrum before manifold analysis and extension', async () => {
    const fixture = createCodimCycleAnalysisSystem()
    fixture.system.branches[fixture.selectedBranchId].data.points[0].eigenvalues = [
      { re: 88, im: 0 },
      { re: Number.NaN, im: 0 },
    ]
    const client = new MockForkCoreClient(0)
    const computedMultipliers = [
      { re: 1, im: 0 },
      { re: 2, im: 0 },
    ]
    let floquetRequest:
      | Parameters<MockForkCoreClient['computeLimitCycleFloquetModes']>[0]
      | null = null
    let manifoldRequest:
      | Parameters<MockForkCoreClient['runLimitCycleManifold2D']>[0]
      | null = null
    client.computeLimitCycleFloquetModes = async (request) => {
      floquetRequest = structuredClone(request)
      return {
        ntst: request.ntst,
        ncol: request.ncol,
        backend: 'periodic_schur',
        multipliers: computedMultipliers,
        vectors: [],
      }
    }
    const originalRunManifold = client.runLimitCycleManifold2D.bind(client)
    client.runLimitCycleManifold2D = async (request, options) => {
      manifoldRequest = structuredClone(request)
      const result = await originalRunManifold(request, options)
      const geometry = result.manifold_geometry
      if (geometry?.type === 'Surface' && !('Surface' in geometry)) {
        geometry.resume_state = {
          type: 'GeodesicRings',
          version: 1,
          outer_ring: [
            [0.1, 0],
            [0, 0.1],
            [-0.1, 0],
            [0, -0.1],
          ],
          inward_anchors: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          current_leaf_delta: request.settings.leaf_delta,
          accumulated_arclength: request.settings.target_arclength,
          center: [0, 0],
        }
      }
      return result
    }
    const { getContext } = setupApp(fixture.system, client)

    await act(async () => {
      getContext().actions.setLimitCycleRenderTarget(fixture.limitCycleId, {
        type: 'branch',
        branchId: fixture.selectedBranchId,
        pointIndex: 0,
      })
    })
    await waitFor(() => {
      expect(
        getContext().state.system?.ui.limitCycleRenderTargets?.[fixture.limitCycleId]
      ).toEqual({
        type: 'branch',
        branchId: fixture.selectedBranchId,
        pointIndex: 0,
      })
    })

    await act(async () => {
      await getContext().actions.createLimitCycleManifold2D({
        limitCycleId: fixture.limitCycleId,
        name: 'cycle_manifold_selected',
        settings: {
          stability: 'Unstable',
          direction: 'Plus',
          algorithm: 'GeodesicRings',
          floquet_index: 1,
          initial_radius: 0.01,
          leaf_delta: 0.05,
          delta_min: 0.01,
          ring_points: 8,
          min_spacing: 0.01,
          max_spacing: 0.2,
          alpha_min: 0.1,
          alpha_max: 1,
          delta_alpha_min: 0.01,
          delta_alpha_max: 0.2,
          integration_dt: 0.01,
          target_arclength: 0.5,
          caps: {
            max_steps: 40,
            max_points: 120,
            max_rings: 40,
            max_vertices: 120,
            max_time: 10,
          },
        },
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      expect(floquetRequest).not.toBeNull()
      expect(manifoldRequest).not.toBeNull()
      expect(floquetRequest!.cycleState).toEqual(fixture.expectedCycleState)
      expect(floquetRequest!.system.params).toEqual([0.15, 1.3, 0.7])
      expect(floquetRequest!.parameterName).toBe(fixture.frozenRuntimeParameterName)
      expect(floquetRequest!.normalizedMesh).toEqual([0, 0.3, 1])
      expect(manifoldRequest!.cycleState).toEqual(fixture.expectedCycleState)
      expect(manifoldRequest!.system.params).toEqual([0.15, 1.3, 0.7])
      expect(manifoldRequest!.floquetMultipliers).toEqual(computedMultipliers)
      expect(manifoldRequest!.normalizedMesh).toEqual([0, 0.3, 1])
      expect(manifoldRequest!.floquetMultipliers).not.toContainEqual({ re: 88, im: 0 })
      expect(manifoldRequest!.floquetMultipliers).not.toContainEqual({ re: 99, im: 0 })
      expect(
        manifoldRequest!.floquetMultipliers.every(
          (value) => Number.isFinite(value.re) && Number.isFinite(value.im)
        )
      ).toBe(true)
      expect(manifoldRequest!.settings.parameter_index).toBe(2)

      const createdBranchId = findBranchIdByName(
        getContext().state.system!,
        'cycle_manifold_selected'
      )
      const createdBranch = getContext().state.system!.branches[createdBranchId]
      expect(createdBranch.params).toEqual([0.15, 1.3])
      expect(createdBranch.subsystemSnapshot?.frozenValuesByVarName.z).toBe(0.7)
      expect(createdBranch.subsystemSnapshot?.hash).not.toBe(
        fixture.system.branches[fixture.selectedBranchId].subsystemSnapshot?.hash
      )
      expect(
        createdBranch.manifoldSettings && 'parameter_index' in createdBranch.manifoldSettings
          ? createdBranch.manifoldSettings.parameter_index
          : undefined
      ).toBe(2)
    })

    const createdBranchId = findBranchIdByName(
      getContext().state.system!,
      'cycle_manifold_selected'
    )
    let extensionSystemParams: number[] | null = null
    client.runManifold2DExtension = async (request) => {
      extensionSystemParams = [...request.system.params]
      return normalizeBranchEigenvalues({
        ...request.branchData,
        points: [
          ...request.branchData.points,
          { state: [0.2, 0], param_value: 5, stability: 'None', eigenvalues: [] },
        ],
        indices: [...request.branchData.indices, request.branchData.points.length],
      })
    }

    await act(async () => {
      await getContext().actions.extendManifold2D({
        branchId: createdBranchId,
        targetArclength: 0.1,
        integrationDt: 0.01,
        caps: {
          max_steps: 40,
          max_points: 160,
          max_rings: 50,
          max_vertices: 160,
          max_time: 10,
        },
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      expect(extensionSystemParams).toEqual([0.15, 1.3, 0.7])
    })
  })

  it('stores reduced-subsystem Floquet vectors in full display coordinates', async () => {
    const { system } = createLimitCycleManifoldSystem()
    const lcId = findObjectIdByName(system, 'LC_3D')
    const limitCycle = system.objects[lcId]
    if (!limitCycle || limitCycle.type !== 'limit_cycle') {
      throw new Error('Expected limit cycle object.')
    }
    limitCycle.frozenVariables = { frozenValuesByVarName: { z: 0 } }
    limitCycle.subsystemSnapshot = buildSubsystemSnapshot(
      system.config,
      limitCycle.frozenVariables
    )
    const { getContext } = setupApp(system, new MockForkCoreClient(0))

    await act(async () => {
      await getContext().actions.computeLimitCycleFloquetModes({ limitCycleId: lcId })
    })

    await waitFor(() => {
      const updated = getContext().state.system?.objects[lcId]
      if (!updated || updated.type !== 'limit_cycle') {
        throw new Error('Expected updated limit cycle object.')
      }
      expect(getContext().state.error).toBeNull()
      expect(updated.floquetModes?.vectors.length).toBeGreaterThan(0)
      for (const pointVectors of updated.floquetModes?.vectors ?? []) {
        for (const modeVector of pointVectors) {
          expect(modeVector).toHaveLength(3)
          expect(modeVector[2]).toEqual({ re: 0, im: 0 })
        }
      }
    })
  })

  it('uses runtime frozen-parameter names when extending codim1 curves', async () => {
    const base = createSystem({
      name: 'Codim1_Extend_Frozen',
      config: {
        name: 'Codim1_Extend_Frozen',
        equations: ['v', '0', '0'],
        params: [0.1],
        paramNames: ['mu'],
        varNames: ['v', 'h1', 'h2'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const snapshot = buildSubsystemSnapshot(base.config, {
      frozenValuesByVarName: { h1: 0.2, h2: 0.4 },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_F',
      systemName: base.config.name,
      parameters: [...base.config.params],
      frozenVariables: { frozenValuesByVarName: { h1: 0.2, h2: 0.4 } },
      subsystemSnapshot: snapshot,
    }
    const withObject = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'hopf_curve_frozen',
      systemName: base.config.name,
      parameterName: 'var:h1, var:h2',
      parameterRef: { kind: 'frozen_var', variableName: 'h1' },
      parameter2Ref: { kind: 'frozen_var', variableName: 'h2' },
      parentObject: equilibrium.name,
      startObject: 'eq_branch_seed',
      branchType: 'hopf_curve',
      data: {
        points: [
          {
            state: [0.1],
            param_value: 0.2,
            param2_value: 0.4,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.15],
            param_value: 0.25,
            param2_value: 0.45,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'HopfCurve',
          param1_name: 'var:h1',
          param2_name: 'var:h2',
          param1_ref: { kind: 'frozen_var', variableName: 'h1' },
          param2_ref: { kind: 'frozen_var', variableName: 'h2' },
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
      subsystemSnapshot: snapshot,
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedParamName = ''
    let capturedParam1Name = ''
    let capturedParam2Name = ''
    client.runContinuationExtension = async (request) => {
      capturedParamName = request.parameterName
      const branchType = request.branchData.branch_type
      if (
        branchType &&
        typeof branchType === 'object' &&
        'param1_name' in branchType &&
        'param2_name' in branchType
      ) {
        capturedParam1Name = branchType.param1_name
        capturedParam2Name = branchType.param2_name
      }
      const seed = request.branchData.points[request.branchData.points.length - 1]
      const responseBranchType =
        branchType &&
        typeof branchType === 'object' &&
        'param1_name' in branchType &&
        'param2_name' in branchType
          ? (() => {
              const stripped = { ...branchType }
              delete stripped.param1_ref
              delete stripped.param2_ref
              return stripped
            })()
          : branchType
      return normalizeBranchEigenvalues(
        {
          ...request.branchData,
          branch_type: responseBranchType,
          points: [
            ...request.branchData.points,
            {
              ...seed,
              param_value: seed.param_value + request.settings.step_size,
              param2_value: seed.param2_value,
            },
          ],
          indices: [0, 1, 2],
        },
        { stateDimension: request.system.varNames.length }
      )
    }
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.extendBranch({
        branchId: withBranch.nodeId,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      expect(capturedParamName).toBe('fv__h1')
      expect(capturedParam1Name).toBe('fv__h1')
      expect(capturedParam2Name).toBe('fv__h2')
      const updated = getContext().state.system!.branches[withBranch.nodeId]
      expect(updated.data.points.length).toBe(3)
      expect(updated.data.points.map((point) => point.param2_value)).toEqual([0.4, 0.45, 0.45])
      expect(updated.data.branch_type).toMatchObject({
        type: 'HopfCurve',
        param1_name: 'var:h1',
        param2_name: 'var:h2',
        param1_ref: { kind: 'frozen_var', variableName: 'h1' },
        param2_ref: { kind: 'frozen_var', variableName: 'h2' },
      })
    })
  })

  it('uses continuation extension when continuing a limit cycle from a selected point', async () => {
    const base = createSystem({ name: 'LC_From_Point' })
    const configured = withParam(base, 'mu', 0.2)
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Seed',
      systemName: configured.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Seed' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      parameters: [...configured.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(configured, limitCycle)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_seed_mu',
      systemName: configured.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...configured.config.params],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedSeedPointCount: number | null = null
    let capturedSeedParamValue: number | null = null
    client.runContinuationExtension = async (request) => {
      capturedSeedPointCount = request.branchData.points.length
      const seed = request.branchData.points[0]
      if (!seed) {
        throw new Error('Expected a seed point for continuation extension.')
      }
      capturedSeedParamValue = seed.param_value
      return normalizeBranchEigenvalues({
        ...request.branchData,
        points: [
          seed,
          {
            ...seed,
            param_value: seed.param_value + request.settings.step_size,
          },
        ],
        bifurcations: [],
        indices: [0, 1],
      })
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createBranchFromPoint({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'lc_restart_mu',
        parameterName: 'mu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(getContext().state.error).toBeNull()
      expect(capturedSeedPointCount).toBe(1)
      expect(capturedSeedParamValue).toBeCloseTo(0.2, 12)
      const branchId = findBranchIdByName(next!, 'lc_restart_mu')
      expect(next!.branches[branchId].branchType).toBe('limit_cycle')
      expect(next!.branches[branchId].data.points[0]?.param_value).toBeCloseTo(0.2, 12)
      expect(next!.branches[branchId].data.points[1]?.param_value).toBeCloseTo(
        0.2 + continuationSettings.step_size,
        12
      )
      const lcId = findObjectIdByName(next!, 'LC_Seed')
      const lastIndex = next!.branches[branchId].data.points.length - 1
      expect(next!.ui.limitCycleRenderTargets?.[lcId]).toEqual({
        type: 'branch',
        branchId,
        pointIndex: lastIndex,
      })
    })
  })

  it('creates an isoperiodic curve branch from a selected limit-cycle point', async () => {
    const base = createSystem({
      name: 'Isoperiodic_From_Point',
      config: {
        name: 'Isoperiodic_From_Point',
        equations: ['y', '-x + mu'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Iso',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Iso' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      parameters: [...base.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const withObject = addObject(base, limitCycle)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_iso_mu',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedPeriod: number | null = null
    client.runIsoperiodicCurveContinuation = async (request) => {
      capturedPeriod = request.period
      return {
        points: [
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value,
            param2_value: request.param2Value,
            codim2_type: 'None',
            eigenvalues: [],
          },
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value + request.settings.step_size,
            param2_value: request.param2Value,
            codim2_type: 'None',
            eigenvalues: [],
          },
        ],
        codim2_bifurcations: [],
        indices: [0, 1],
      }
    }
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createIsoperiodicCurveFromPoint({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        name: 'iso_curve_nu_mu',
        parameterName: 'nu',
        param2Name: 'mu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(getContext().state.error).toBeNull()
      expect(capturedPeriod).toBeCloseTo(6, 12)
      const branchId = findBranchIdByName(next!, 'iso_curve_nu_mu')
      const created = next!.branches[branchId]
      expect(created.branchType).toBe('isoperiodic_curve')
      expect(created.parentObject).toBe('LC_Iso')
      expect(created.data.branch_type).toMatchObject({
        type: 'IsoperiodicCurve',
        param1_name: 'nu',
        param2_name: 'mu',
      })
      expect(created.data.points[0]?.state.at(-1)).toBeCloseTo(6, 12)
    })
  })

  it('creates an isoperiodic curve branch from a selected isoperiodic curve point', async () => {
    const base = createSystem({
      name: 'Isoperiodic_From_Isoperiodic_Point',
      config: {
        name: 'Isoperiodic_From_Isoperiodic_Point',
        equations: ['y', '-x + mu + nu + kappa'],
        params: [0.2, 0.1, 0.3],
        paramNames: ['mu', 'nu', 'kappa'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Iso_Source',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Iso_Source' },
      ntst: 1,
      ncol: 1,
      period: 6,
      state: [0.2, 0.3, 0.2, 0.3, 6],
      parameters: [...base.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const withObject = addObject(base, limitCycle)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'iso_seed_mu_nu',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'isoperiodic_curve',
      data: {
        points: [
          {
            state: [0.5, -0.1, 0.2, 0.3, 0.2, 0.3, 6],
            param_value: 0.25,
            param2_value: 0.35,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'IsoperiodicCurve',
          param1_name: 'mu',
          param2_name: 'nu',
          ntst: 1,
          ncol: 1,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedRequest:
      | Parameters<NonNullable<MockForkCoreClient['runIsoperiodicCurveContinuation']>>[0]
      | null = null
    client.runIsoperiodicCurveContinuation = async (request) => {
      capturedRequest = request
      return {
        points: [
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value,
            param2_value: request.param2Value,
            codim2_type: 'None',
            eigenvalues: [],
          },
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value + request.settings.step_size,
            param2_value: request.param2Value,
            codim2_type: 'None',
            eigenvalues: [],
          },
        ],
        codim2_bifurcations: [],
        indices: [0, 1],
      }
    }
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createIsoperiodicCurveFromPoint({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        name: 'iso_curve_kappa_mu',
        parameterName: 'kappa',
        param2Name: 'mu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(getContext().state.error).toBeNull()
      expect(capturedRequest).not.toBeNull()
      expect(capturedRequest?.param1Name).toBe('kappa')
      expect(capturedRequest?.param1Value).toBeCloseTo(0.3, 12)
      expect(capturedRequest?.param2Name).toBe('mu')
      expect(capturedRequest?.param2Value).toBeCloseTo(0.25, 12)
      expect(capturedRequest?.system.params[1]).toBeCloseTo(0.35, 12)
      const branchId = findBranchIdByName(next!, 'iso_curve_kappa_mu')
      const created = next!.branches[branchId]
      expect(created.branchType).toBe('isoperiodic_curve')
      expect(created.data.branch_type).toMatchObject({
        type: 'IsoperiodicCurve',
        param1_name: 'kappa',
        param2_name: 'mu',
      })
    })
  })

  it('uses negative logical indices for backward isoperiodic curve continuation', async () => {
    const base = createSystem({
      name: 'Isoperiodic_Backward_Indices',
      config: {
        name: 'Isoperiodic_Backward_Indices',
        equations: ['y', '-x + mu + nu'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Backward_Idx',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Backward_Idx' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      parameters: [...base.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      createdAt: new Date().toISOString(),
    }
    const withObject = addObject(base, limitCycle)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_seed_mu',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    client.runIsoperiodicCurveContinuation = async (request) => ({
      points: [
        {
          state: [...request.lcState, request.period],
          param1_value: request.param1Value,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
        },
        {
          state: [...request.lcState, request.period],
          param1_value: request.param1Value - request.settings.step_size,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
        },
        {
          state: [...request.lcState, request.period],
          param1_value: request.param1Value - 2 * request.settings.step_size,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
        },
      ],
      codim2_bifurcations: [],
    })
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createIsoperiodicCurveFromPoint({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        name: 'iso_curve_backward_indices',
        parameterName: 'mu',
        param2Name: 'nu',
        settings: continuationSettings,
        forward: false,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(getContext().state.error).toBeNull()
      const branchId = findBranchIdByName(next!, 'iso_curve_backward_indices')
      const created = next!.branches[branchId]
      expect(created.branchType).toBe('isoperiodic_curve')
      expect(created.data.indices).toEqual([0, -1, -2])
    })
  })

  it('does not continue limit-cycle branches from a point for map systems', async () => {
    const base = createSystem({
      name: 'Map_LC_From_Point',
      config: {
        name: 'Map_LC_From_Point',
        equations: ['mu * x * (1 - x)'],
        params: [2.9],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'Map_LC_Seed',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Map_Orbit_Seed' },
      ntst: 4,
      ncol: 2,
      period: 2,
      state: [0.2, 0.8, 2],
      parameters: [...base.config.params],
      parameterName: 'mu',
      paramValue: 2.9,
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, limitCycle)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'map_lc_seed_mu',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0.2, 0.8, 2],
            param_value: 2.9,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const { getContext } = setupApp(branchResult.system)

    await act(async () => {
      await getContext().actions.createBranchFromPoint({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'map_lc_restart_mu',
        parameterName: 'mu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toContain('Branch continuation is only available')
      const branchNames = Object.values(getContext().state.system!.branches).map((b) => b.name)
      expect(branchNames).not.toContain('map_lc_restart_mu')
    })
  })
})

describe('appState heteroclinic continuation', () => {
  it('creates a versioned two-equilibrium branch from an orbit seed', async () => {
    const base = createSystem({ name: 'Heteroclinic_Reference' })
    const configured = {
      ...base,
      config: {
        ...base.config,
        paramNames: ['mu', 'nu'],
        params: [0.2, 0.2],
      },
    }
    configured.config = {
      ...configured.config,
      type: 'flow',
      solver: 'rk4',
      varNames: ['x', 'y'],
      equations: ['1-x*x', 'x*y+(mu-nu)*(1-x*x)'],
    }
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Connecting_Orbit',
      systemName: configured.config.name,
      data: [
        [-4, -0.999, 0],
        [0, 0, 0],
        [4, 0.999, 0],
      ],
      t_start: -4,
      t_end: 4,
      dt: 4,
      parameters: [...configured.config.params],
    }
    const source: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Source_Saddle',
      systemName: configured.config.name,
      parameters: [...configured.config.params],
      solution: {
        state: [-1, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
    }
    const target: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Target_Saddle',
      systemName: configured.config.name,
      parameters: [...configured.config.params],
      solution: {
        state: [1, 0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
    }
    const withOrbit = addObject(configured, orbit)
    const withSource = addObject(withOrbit.system, source)
    const withTarget = addObject(withSource.system, target)
    const client = new MockForkCoreClient(0)
    let captured: Parameters<typeof client.runHeteroclinicFromOrbit>[0] | null = null
    client.runHeteroclinicFromOrbit = async (request) => {
      captured = request
      const basis = {
        stable_q: [1, 0, 0, 1],
        unstable_q: [1, 0, 0, 1],
        dim: 2,
        nneg: 1,
        npos: 1,
      }
      const state = new Array(24).fill(0)
      return {
        points: [
          { state, param_value: 0.2, stability: 'None', eigenvalues: [] },
          { state, param_value: 0.21, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'HeteroclinicCurve',
          schema: {
            schema_version: 1,
            base_params: [0.2, 0.2],
            param1_index: 0,
            param2_index: 1,
            source_basis: basis,
            target_basis: basis,
            fixed_time: 8,
            fixed_eps0: 0.01,
            fixed_eps1: 0.01,
            projector_refresh_interval: 1,
          },
          ntst: 1,
          ncol: 0,
          discretization: {
            type: 'shooting',
            integration_steps_per_segment: 96,
          },
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: false,
          free_eps0: true,
          free_eps1: true,
        },
      }
    }
    const { getContext } = setupApp(withTarget.system, client)

    await act(async () => {
      await getContext().actions.createHeteroclinicFromOrbit({
        orbitId: withOrbit.nodeId,
        sourceEquilibriumId: withSource.nodeId,
        targetEquilibriumId: withTarget.nodeId,
        name: 'heteroc_Source_to_Target',
        parameterName: 'mu',
        param2Name: 'nu',
        ntst: 2,
        ncol: 1,
        discretization: 'shooting',
        shootingIntervals: 1,
        integrationStepsPerSegment: 96,
        freeTime: false,
        freeEps0: true,
        freeEps1: true,
        projectorRefreshInterval: 1,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(captured).toMatchObject({
      orbitTimes: [-4, 0, 4],
      orbitStates: [[-0.999, 0], [0, 0], [0.999, 0]],
      sourceEquilibrium: [-1, 0],
      targetEquilibrium: [1, 0],
      parameterName: 'mu',
      param2Name: 'nu',
      discretization: 'shooting',
      shootingIntervals: 1,
      integrationStepsPerSegment: 96,
    })
    const created = Object.values(getContext().state.system!.branches).find(
      (branch) => branch.name === 'heteroc_Source_to_Target'
    )
    expect(getContext().state.error).toBeNull()
    expect(created).toMatchObject({
      branchType: 'heteroclinic_curve',
      parentObjectId: withOrbit.nodeId,
      heteroclinicEndpoints: {
        sourceObjectId: withSource.nodeId,
        targetObjectId: withTarget.nodeId,
      },
      data: {
        branch_type: {
          type: 'HeteroclinicCurve',
          schema: { schema_version: 1 },
          discretization: {
            type: 'shooting',
            integration_steps_per_segment: 96,
          },
        },
      },
    })
    if (!created) throw new Error('Expected a stored heteroclinic branch.')
    const createdId = Object.entries(getContext().state.system!.branches).find(
      ([, branch]) => branch === created
    )?.[0]
    if (!createdId) throw new Error('Expected a heteroclinic branch id.')
    let extensionBranchType: unknown = null
    client.runContinuationExtension = async (request) => {
      extensionBranchType = request.branchData.branch_type
      return {
        ...created.data,
        points: [
          ...created.data.points,
          {
            ...created.data.points.at(-1)!,
            param_value: created.data.points.at(-1)!.param_value + 0.01,
          },
        ],
        indices: [0, 1, 2],
      }
    }
    await act(async () => {
      await getContext().actions.extendBranch({
        branchId: createdId,
        settings: continuationSettings,
        forward: true,
      })
    })
    expect(extensionBranchType).toMatchObject({
      type: 'HeteroclinicCurve',
      schema: { schema_version: 1 },
      discretization: { type: 'shooting' },
    })
    expect(getContext().state.system!.branches[createdId].data.points).toHaveLength(3)
  })
})

describe('appState Hopf curve continuation', () => {
  it('continues a Hopf curve after renaming the parent equilibrium', async () => {
    const base = createSystem({
      name: 'Hopf_Curve_Rename',
      config: {
        name: 'Hopf_Curve_Rename',
        equations: ['p1*x - y', 'x + p1*y'],
        params: [0, 0.5],
        paramNames: ['p1', 'p2'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_H',
      systemName: base.config.name,
      parameters: [...base.config.params],
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_hopf_p1',
      systemName: base.config.name,
      parameterName: 'p1',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'Hopf',
            eigenvalues: [
              { re: 0, im: 1 },
              { re: 0, im: -1 },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const client = new MockForkCoreClient(0)
    const codim2: NonNullable<ContinuationPoint['codim2']> = {
      type: 'GeneralizedHopf',
      refined: true,
      candidate: false,
      test_function: 'first_lyapunov_coefficient',
      test_function_value: 2e-11,
      residual_norm: 3e-10,
      iterations: 5,
      tolerance: 1e-9,
      source_segment: [3, 4],
      source_test_values: [-0.2, 0.1],
      method: 'bracketed_newton',
      coefficients: [{ name: 'l1', value: 2e-11 }],
      conditioning: {
        bordered_condition_number: 120,
        jacobian_condition_number: 80,
      },
    }
    const simultaneousCodim2: NonNullable<ContinuationPoint['codim2']> = {
      ...codim2,
      type: 'DoubleHopf',
      test_function: 'hopf_pair_collision',
      test_function_value: -3e-11,
    }
    client.runHopfCurveContinuation = async (request) => ({
      points: [
        {
          state: request.hopfState,
          param1_value: request.param1Value,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.hopfOmega * request.hopfOmega,
          codim2,
          codim2_events: [codim2, simultaneousCodim2],
        },
        {
          state: request.hopfState,
          param1_value: request.param1Value + request.settings.step_size,
          param2_value: request.param2Value + request.settings.step_size,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.hopfOmega * request.hopfOmega,
        },
      ],
      codim2_bifurcations: [],
      indices: [0, 1],
    })
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      getContext().actions.renameNode(added.nodeId, 'EQ_H_RENAMED')
    })

    await act(async () => {
      await getContext().actions.createHopfCurveFromPoint({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'hopf_curve_p1_p2',
        param2Name: 'p2',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(getContext().state.error).toBeNull()
      const hopfCurveId = findBranchIdByName(next!, 'hopf_curve_p1_p2')
      expect(next!.branches[hopfCurveId].parentObject).toBe('EQ_H_RENAMED')
      expect(next!.branches[hopfCurveId].data.points[0].codim2).toEqual(codim2)
      expect(next!.branches[hopfCurveId].data.points[0].codim2_events).toEqual([
        codim2,
        simultaneousCodim2,
      ])
    })
  })
})

describe('appState flow limit-cycle codim-1 curve continuation', () => {
  const cases = [
    {
      stability: 'CycleFold' as const,
      curveType: 'LimitPointCycle' as const,
      branchType: 'lpc_curve' as const,
      metadataType: 'LPCCurve' as const,
    },
    {
      stability: 'PeriodDoubling' as const,
      curveType: 'PeriodDoubling' as const,
      branchType: 'pd_curve' as const,
      metadataType: 'PDCurve' as const,
    },
    {
      stability: 'NeimarkSacker' as const,
      curveType: 'NeimarkSacker' as const,
      branchType: 'ns_curve' as const,
      metadataType: 'NSCurve' as const,
    },
  ]

  it.each(cases)(
    'continues $stability points with the $curveType runner',
    async ({ stability, curveType, branchType, metadataType }) => {
      const base = createSystem({
        name: `Flow_${stability}_Curve`,
        config: {
          name: `Flow_${stability}_Curve`,
          equations: ['-y + mu*x', 'x + nu*y'],
          params: [0.2, 0.4],
          paramNames: ['mu', 'nu'],
          varNames: ['x', 'y'],
          solver: 'rk4',
          type: 'flow',
        },
      })
      const limitCycle: LimitCycleObject = {
        type: 'limit_cycle',
        name: `LC_${stability}`,
        systemName: base.config.name,
        origin: { type: 'orbit', orbitName: 'Orbit_1' },
        ntst: 1,
        ncol: 1,
        period: 6,
        state: [1, 0, 0, 1, 6],
        parameters: [...base.config.params],
        parameterName: 'mu',
        paramValue: 0.2,
        floquetMultipliers: [],
        createdAt: new Date().toISOString(),
      }
      const withObject = addObject(base, limitCycle)
      const sourceBranch: ContinuationObject = {
        type: 'continuation',
        name: `lc_${stability}_mu`,
        systemName: base.config.name,
        parameterName: 'mu',
        parentObject: limitCycle.name,
        startObject: limitCycle.name,
        branchType: 'limit_cycle',
        data: {
          points: [
            {
              state: [1, 0, 0, 1, 6],
              param_value: 0.25,
              stability,
              eigenvalues:
                stability === 'NeimarkSacker'
                  ? [
                      { re: 0.5, im: Math.sqrt(3) / 2 },
                      { re: 0.5, im: -Math.sqrt(3) / 2 },
                    ]
                  : [],
            },
          ],
          bifurcations: [0],
          indices: [0],
          branch_type: { type: 'LimitCycle', ntst: 1, ncol: 1 },
        },
        settings: continuationSettings,
        timestamp: new Date().toISOString(),
        params: [...base.config.params],
      }
      const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
      const client = new MockForkCoreClient(0)
      const runCurve = vi.fn(async (request) => ({
        curve_type: request.curveType,
        points: [
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value,
            param2_value: request.param2Value,
            codim2_type: 'None',
            eigenvalues: [],
            auxiliary: request.initialK,
          },
          {
            state: [...request.lcState, request.period],
            param1_value: request.param1Value + 0.01,
            param2_value: request.param2Value + 0.02,
            codim2_type: 'None',
            eigenvalues: [],
            auxiliary: request.initialK,
          },
        ],
        codim2_bifurcations: [],
        indices: [0, 1],
      }))
      client.runLimitCycleCodim1CurveContinuation = runCurve
      const { getContext } = setupApp(withBranch.system, client)

      await act(async () => {
        await getContext().actions.createLimitCycleCodim1CurveFromPoint({
          branchId: withBranch.nodeId,
          pointIndex: 0,
          curveType,
          name: `${branchType}_mu_nu`,
          param2Name: 'nu',
          settings: continuationSettings,
          forward: true,
        })
      })

      await waitFor(() => {
        expect(getContext().state.error).toBeNull()
        const next = getContext().state.system!
        const curveId = findBranchIdByName(next, `${branchType}_mu_nu`)
        const curve = next.branches[curveId]
        expect(curve.branchType).toBe(branchType)
        expect(curve.data.branch_type).toMatchObject({
          type: metadataType,
          param1_name: 'mu',
          param2_name: 'nu',
          ntst: 1,
          ncol: 1,
        })
        expect(curve.data.points).toHaveLength(2)
      })

      expect(runCurve).toHaveBeenCalledWith(
        expect.objectContaining({
          curveType,
          lcState: [1, 0, 0, 1],
          period: 6,
          param1Name: 'mu',
          param1Value: 0.25,
          param2Name: 'nu',
          param2Value: 0.4,
          initialK: curveType === 'NeimarkSacker' ? 0.5 : undefined,
          ntst: 1,
          ncol: 1,
        }),
        expect.objectContaining({ onProgress: expect.any(Function) })
      )
    }
  )

  it('switches an NSNS point to the adjacent NS curve with its secondary cosine and final mesh', async () => {
    const base = createSystem({
      name: 'Flow_NSNS_Adjacent_Curve',
      config: {
        name: 'Flow_NSNS_Adjacent_Curve',
        equations: ['-y + mu*x', 'x + nu*y'],
        params: [0.2, 0.4],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_NSNS',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_1' },
      ntst: 1,
      ncol: 1,
      period: 6,
      state: [1, 0, 0, 1, 6],
      parameters: [...base.config.params],
      parameterName: 'mu',
      paramValue: 0.2,
      floquetMultipliers: [],
      createdAt: new Date().toISOString(),
    }
    const withObject = addObject(base, limitCycle)
    const codim2: NonNullable<ContinuationPoint['codim2']> = {
      type: 'DoubleNeimarkSacker',
      refined: true,
      candidate: false,
      test_function: 'secondary_unit_pair_modulus',
      test_function_value: 0,
      residual_norm: 2e-9,
      iterations: 4,
      tolerance: 1e-8,
      source_segment: [0, 1],
      source_test_values: [-0.1, 0.1],
      method: 'bracketed_newton',
      coefficients: [{ name: 'secondary_unit_pair_cosine', value: 0.25 }],
      conditioning: {},
      branch_switches: [
        { target: 'NeimarkSacker', available: true, target_auxiliary: 0.25 },
      ],
    }
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'ns_curve_mu_nu',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parameterRef: { kind: 'native_param', name: 'mu' },
      parameter2Ref: { kind: 'native_param', name: 'nu' },
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'ns_curve',
      data: {
        points: [
          {
            // Stage-first explicit: stage, mesh_0, mesh_1, period.
            state: [10, 11, 20, 21, 20, 21, 6],
            param_value: 0.25,
            param2_value: 0.45,
            stability: 'DoubleNeimarkSacker',
            eigenvalues: [
              { re: 0.8, im: 0.6 },
              { re: 0.8, im: -0.6 },
              { re: 0.25, im: Math.sqrt(1 - 0.25 ** 2) },
              { re: 0.25, im: -Math.sqrt(1 - 0.25 ** 2) },
            ],
            codim2,
            codim2_events: [codim2],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'NSCurve',
          param1_name: 'mu',
          param2_name: 'nu',
          ntst: 1,
          ncol: 1,
          normalized_mesh: [0, 1],
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    const adaptation = {
      initial_mesh_points: 1,
      current_mesh_points: 2,
      degree: 1,
      defect_tolerance: 1e-7,
      refinement_budget: 1,
      max_mesh_points: 4,
      initial_normalized_mesh: [0, 1],
      current_normalized_mesh: [0, 0.25, 1],
      attempts: [],
    }
    const runCurve = vi.fn(async (request) => ({
      curve_type: request.curveType,
      ntst: 2,
      ncol: 1,
      normalized_mesh: [0, 0.25, 1],
      collocation_adaptation: adaptation,
      points: [
        {
          state: [...request.lcState, request.period],
          param1_value: request.param1Value,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.initialK,
          codim2_events: [],
        },
        {
          state: [...request.lcState, request.period],
          param1_value: request.param1Value + 0.01,
          param2_value: request.param2Value + 0.02,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.initialK,
          codim2_events: [],
        },
      ],
      codim2_bifurcations: [],
      indices: [0, 1],
    }))
    client.runLimitCycleCodim1CurveContinuation = runCurve
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createLimitCycleCodim1CurveFromPoint({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        curveType: 'NeimarkSacker',
        targetAuxiliary: 0.25,
        name: 'nsns_secondary',
        param2Name: 'nu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      const next = getContext().state.system!
      const curve = next.branches[findBranchIdByName(next, 'nsns_secondary')]
      expect(curve.branchType).toBe('ns_curve')
      expect(curve.data.branch_type).toMatchObject({
        type: 'NSCurve',
        ntst: 2,
        ncol: 1,
        normalized_mesh: [0, 0.25, 1],
      })
      expect(curve.data.collocation_adaptation).toEqual(adaptation)
      expect(curve.data.points[0].codim2_events).toEqual([])
    })

    expect(runCurve).toHaveBeenCalledWith(
      expect.objectContaining({
        curveType: 'NeimarkSacker',
        // Adjacent switching canonicalizes the stage-first explicit source and
        // removes the duplicate closing mesh point before entering the runner.
        lcState: [20, 21, 10, 11],
        period: 6,
        param1Name: 'mu',
        param1Value: 0.25,
        param2Name: 'nu',
        param2Value: 0.45,
        initialK: 0.25,
        ntst: 1,
        ncol: 1,
        normalizedMesh: [0, 1],
      }),
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
  })
})

describe('appState map Neimark-Sacker curve continuation', () => {
  it('runs the map Hopf defining system and stores a two-parameter curve', async () => {
    const base = createSystem({
      name: 'Map_NS_Curve',
      config: {
        name: 'Map_NS_Curve',
        equations: [
          '(1+mu)*(cos(nu)*x-sin(nu)*y)',
          '(1+mu)*(sin(nu)*x+cos(nu)*y)',
        ],
        params: [-0.1, 0.7],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const fixedPoint: EquilibriumObject = {
      type: 'equilibrium',
      name: 'FP_NS',
      systemName: base.config.name,
      parameters: [...base.config.params],
    }
    const withObject = addObject(base, fixedPoint)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'fp_ns_mu',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: fixedPoint.name,
      startObject: fixedPoint.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0,
            stability: 'NeimarkSacker',
            eigenvalues: [
              { re: Math.cos(0.7), im: Math.sin(0.7) },
              { re: Math.cos(0.7), im: -Math.sin(0.7) },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
      mapIterations: 1,
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    const runHopf = vi.fn(async (request) => ({
      points: [
        {
          state: request.hopfState,
          param1_value: request.param1Value,
          param2_value: request.param2Value,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.hopfOmega * request.hopfOmega,
        },
        {
          state: request.hopfState,
          param1_value: request.param1Value + 0.01,
          param2_value: request.param2Value + 0.01,
          codim2_type: 'None',
          eigenvalues: [],
          auxiliary: request.hopfOmega * request.hopfOmega,
        },
      ],
      codim2_bifurcations: [],
      indices: [0, 1],
    }))
    client.runHopfCurveContinuation = runHopf
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createNSCurveFromPoint({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        name: 'ns_map_mu_nu',
        param2Name: 'nu',
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      const next = getContext().state.system!
      const curve = next.branches[findBranchIdByName(next, 'ns_map_mu_nu')]
      expect(curve.branchType).toBe('hopf_curve')
      expect(curve.mapIterations).toBe(1)
      expect(curve.data.points).toHaveLength(2)
    })
    expect(runHopf).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.objectContaining({ type: 'map' }),
        hopfState: [0, 0],
        hopfOmega: expect.any(Number),
        param1Name: 'mu',
        param1Value: 0,
        param2Name: 'nu',
        param2Value: 0.7,
        mapIterations: 1,
      }),
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
  })
})

describe('appState isocline computation', () => {
  it('creates 3D isoclines with all variables active by default', async () => {
    const base = createSystem({
      name: 'Iso_Default_3D',
      config: {
        name: 'Iso_Default_3D',
        equations: ['x + y', 'y - z', 'z - x'],
        params: [],
        paramNames: [],
        varNames: ['x', 'y', 'z'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const { getContext } = setupApp(base, new MockForkCoreClient(0))

    let isoclineId: string | null = null
    await act(async () => {
      isoclineId = await getContext().actions.createIsoclineObject('Iso_Default')
    })

    expect(isoclineId).not.toBeNull()
    if (!isoclineId) {
      throw new Error('Expected isocline id to be created.')
    }

    const next = getContext().state.system
    expect(next).not.toBeNull()
    if (!next) {
      throw new Error('Expected system to remain loaded.')
    }
    const object = next.objects[isoclineId] as IsoclineObject
    expect(object.axes.map((axis) => axis.variableName)).toEqual(['x', 'y', 'z'])
  })

  it('preserves parseable but semantically invalid axis settings until compute', async () => {
    const base = createSystem({ name: 'Iso_Invalid_Preserved' })
    const client = new MockForkCoreClient(0)
    let capturedRequest:
      | {
          min: number
          max: number
          samples: number
        }
      | null = null
    client.computeIsocline = async (request) => {
      capturedRequest = {
        min: request.axes[0]?.min ?? Number.NaN,
        max: request.axes[0]?.max ?? Number.NaN,
        samples: request.axes[0]?.samples ?? Number.NaN,
      }
      return {
        geometry: 'segments',
        dim: request.system.varNames.length,
        points: [0, 0, 1, 1],
        segments: [0, 1],
      }
    }
    const { getContext } = setupApp(base, client)

    let isoclineId: string | null = null
    await act(async () => {
      isoclineId = await getContext().actions.createIsoclineObject('Iso_Invalid')
    })
    expect(isoclineId).not.toBeNull()
    if (!isoclineId) {
      throw new Error('Expected isocline id to be created.')
    }

    await act(async () => {
      getContext().actions.updateIsoclineObject(isoclineId!, {
        axes: [
          { variableName: 'x', min: 5, max: -5, samples: 1 },
          { variableName: 'y', min: -2, max: 2, samples: 8 },
        ],
      })
    })

    await act(async () => {
      await getContext().actions.computeIsocline({ isoclineId: isoclineId! })
    })

    const next = getContext().state.system
    expect(next).not.toBeNull()
    if (!next) {
      throw new Error('Expected system to remain loaded.')
    }
    const object = next.objects[isoclineId] as IsoclineObject
    expect(object.axes[0]).toMatchObject({ variableName: 'x', min: 5, max: -5, samples: 1 })
    expect(capturedRequest).toEqual({ min: 5, max: -5, samples: 1 })
  })

  it('computes with current settings and stores last-computed snapshot/cache', async () => {
    const base = createSystem({ name: 'Iso_Current' })
    const client = new MockForkCoreClient(0)
    const captured: Array<{ expression: string; level: number }> = []
    client.computeIsocline = async (request) => {
      captured.push({ expression: request.expression, level: request.level })
      return {
        geometry: 'segments',
        dim: request.system.varNames.length,
        points: [0, 0, 1, 1],
        segments: [0, 1],
      }
    }
    const { getContext } = setupApp(base, client)

    let isoclineId: string | null = null
    await act(async () => {
      isoclineId = await getContext().actions.createIsoclineObject('Iso_1')
    })
    expect(isoclineId).not.toBeNull()
    if (!isoclineId) {
      throw new Error('Expected isocline id to be created.')
    }
    const createdIsoclineId = isoclineId

    await act(async () => {
      getContext().actions.updateIsoclineObject(createdIsoclineId, {
        source: { kind: 'custom', expression: 'x + y' },
        level: 1.5,
        axes: [
          { variableName: 'x', min: -1, max: 1, samples: 32 },
          { variableName: 'y', min: -2, max: 2, samples: 48 },
        ],
        frozenState: [0, 0],
      })
    })

    await act(async () => {
      await getContext().actions.computeIsocline({ isoclineId: createdIsoclineId })
    })

    const next = getContext().state.system
    expect(next).not.toBeNull()
    if (!next) {
      throw new Error('Expected system to remain loaded.')
    }
    const object = next.objects[createdIsoclineId] as IsoclineObject
    expect(captured).toEqual([{ expression: 'x + y', level: 1.5 }])
    expect(object.lastComputed?.expression).toBe('x + y')
    expect(object.lastComputed?.level).toBe(1.5)
    expect(getContext().state.isoclineGeometryCache[createdIsoclineId]).toBeDefined()
  })

  it('uses last-computed settings when requested explicitly', async () => {
    const base = createSystem({ name: 'Iso_Last' })
    const client = new MockForkCoreClient(0)
    const capturedLevels: number[] = []
    client.computeIsocline = async (request) => {
      capturedLevels.push(request.level)
      return {
        geometry: 'segments',
        dim: request.system.varNames.length,
        points: [0, 0, 1, 1],
        segments: [0, 1],
      }
    }
    const { getContext } = setupApp(base, client)

    let isoclineId: string | null = null
    await act(async () => {
      isoclineId = await getContext().actions.createIsoclineObject('Iso_2')
    })
    expect(isoclineId).not.toBeNull()
    if (!isoclineId) {
      throw new Error('Expected isocline id to be created.')
    }
    const createdIsoclineId = isoclineId

    await act(async () => {
      getContext().actions.updateIsoclineObject(createdIsoclineId, {
        source: { kind: 'custom', expression: 'x - y' },
        level: 0,
      })
    })

    await act(async () => {
      await getContext().actions.computeIsocline({ isoclineId: createdIsoclineId })
    })

    await act(async () => {
      getContext().actions.updateIsoclineObject(createdIsoclineId, { level: 9 })
    })

    await act(async () => {
      await getContext().actions.computeIsocline({
        isoclineId: createdIsoclineId,
        useLastComputedSettings: true,
      })
    })

    const next = getContext().state.system
    expect(next).not.toBeNull()
    if (!next) {
      throw new Error('Expected system to remain loaded.')
    }
    const object = next.objects[createdIsoclineId] as IsoclineObject
    expect(capturedLevels).toEqual([0, 0])
    expect(object.level).toBe(9)
    expect(object.lastComputed?.level).toBe(0)
  })

  it('rehydrates cached geometry from last-computed snapshots on load', async () => {
    const base = createSystem({ name: 'Iso_Load' })
    const object: IsoclineObject = {
      type: 'isocline',
      name: 'Iso_Seed',
      systemName: base.config.name,
      source: { kind: 'custom', expression: 'x' },
      level: 4,
      axes: [
        { variableName: 'x', min: -4, max: 4, samples: 24 },
        { variableName: 'y', min: -4, max: 4, samples: 24 },
      ],
      frozenState: [0, 0],
      parameters: [...base.config.params],
      lastComputed: {
        source: { kind: 'custom', expression: 'x + y' },
        expression: 'x + y',
        level: -2,
        axes: [
          { variableName: 'x', min: -1, max: 1, samples: 16 },
          { variableName: 'y', min: -1, max: 1, samples: 16 },
        ],
        frozenState: [0, 0],
        parameters: [...base.config.params],
        computedAt: '2026-02-06T00:00:00.000Z',
      },
    }
    const added = addObject(base, object)
    const client = new MockForkCoreClient(0)
    const captured: Array<{ expression: string; level: number }> = []
    client.computeIsocline = async (request) => {
      captured.push({ expression: request.expression, level: request.level })
      return {
        geometry: 'segments',
        dim: request.system.varNames.length,
        points: [0, 0, 1, 1],
        segments: [0, 1],
      }
    }
    const { getContext } = setupApp(added.system, client)

    await waitFor(() => {
      expect(getContext().state.isoclineGeometryCache[added.nodeId]).toBeDefined()
    })
    expect(captured).toEqual([{ expression: 'x + y', level: -2 }])
  })
})

describe('appState Lyapunov analysis parameters', () => {
  function makeOrbit(parameters?: number[]): OrbitObject {
    return {
      type: 'orbit',
      name: 'Lyapunov Orbit',
      systemName: 'Lyapunov_System',
      data: [
        [0, 0, 0],
        [0.1, 0.1, 0.1],
        [0.2, 0.2, 0.2],
      ],
      t_start: 0,
      t_end: 0.2,
      dt: 0.1,
      parameters,
    }
  }

  it('uses recorded orbit parameters for Lyapunov exponents', async () => {
    const base = createSystem({ name: 'Lyapunov_System' })
    const configured = withParam(base, 'mu', 2)
    const orbit = makeOrbit([1])
    const { system, nodeId: orbitId } = addObject(configured, orbit)
    const client = new MockForkCoreClient(0)
    let capturedParams: number[] | null = null
    client.computeLyapunovExponents = async (request) => {
      capturedParams = [...request.system.params]
      return request.system.varNames.map(() => -0.1)
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.computeLyapunovExponents({
        orbitId,
        transient: 0,
        qrStride: 1,
      })
    })

    expect(capturedParams).toEqual([1])
  })

  it('uses recorded orbit parameters for covariant Lyapunov vectors', async () => {
    const base = createSystem({ name: 'Lyapunov_System' })
    const configured = withParam(base, 'mu', 2)
    const orbit = makeOrbit([1])
    const { system, nodeId: orbitId } = addObject(configured, orbit)
    const client = new MockForkCoreClient(0)
    let capturedParams: number[] | null = null
    client.computeCovariantLyapunovVectors = async (request) => {
      capturedParams = [...request.system.params]
      const dimension = request.system.varNames.length
      return {
        dimension,
        checkpoints: 1,
        times: [request.startTime],
        vectors: new Array(dimension * dimension).fill(0),
      }
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.computeCovariantLyapunovVectors({
        orbitId,
        transient: 0,
        forward: 0,
        backward: 0,
        qrStride: 1,
      })
    })

    expect(capturedParams).toEqual([1])
  })

  it('rejects Lyapunov analysis when orbit parameters are missing', async () => {
    const base = createSystem({ name: 'Lyapunov_System' })
    const configured = withParam(base, 'mu', 2)
    const orbit = makeOrbit(undefined)
    const { system, nodeId: orbitId } = addObject(configured, orbit)
    const client = new MockForkCoreClient(0)
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.computeLyapunovExponents({
        orbitId,
        transient: 0,
        qrStride: 1,
      })
    })

    expect(getContext().state.error).toBe(
      'Orbit parameters are unavailable. Run the orbit again to compute Lyapunov data.'
    )
  })
})

describe('appState branch-point object parameter inheritance', () => {
  it('stores inherited custom parameters when creating a limit cycle from a Hopf point', async () => {
    const base = createSystem({
      name: 'Hopf_Custom_Inheritance',
      config: {
        name: 'Hopf_Custom_Inheritance',
        equations: ['y', '-x + mu'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const inheritedParams = [2.4, 3.1]
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_Source',
      systemName: base.config.name,
      parameters: [...inheritedParams],
      customParameters: [...inheritedParams],
    }
    const withObject = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_hopf_custom',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: inheritedParams[0],
            stability: 'Hopf',
            eigenvalues: [
              { re: 0, im: 1 },
              { re: 0, im: -1 },
            ],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...inheritedParams],
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    client.runLimitCycleContinuationFromHopf = async (request) =>
      normalizeBranchEigenvalues({
        points: [
          {
            state: [0, 0, 6],
            param_value: request.paramValue,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.1, 0.1, 6.1],
            param_value: request.paramValue + request.settings.step_size,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: { type: 'LimitCycle', ntst: request.ntst, ncol: request.ncol },
      })
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createLimitCycleFromHopf({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        parameterName: 'mu',
        limitCycleName: 'LC_Hopf_Custom',
        branchName: 'lc_hopf_custom_mu',
        amplitude: 0.2,
        ntst: 10,
        ncol: 4,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_Hopf_Custom')
      const lc = next!.objects[lcId] as LimitCycleObject
      expect(lc.parameters).toEqual(inheritedParams)
      expect(lc.customParameters).toEqual(inheritedParams)
    })
  })

  it('stores inherited custom parameters when creating a map cycle from a PD point', async () => {
    const base = createSystem({
      name: 'Map_PD_Custom_Inheritance',
      config: {
        name: 'Map_PD_Custom_Inheritance',
        equations: ['x + mu', 'y + nu'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const inheritedParams = [2.4, 3.1]
    const cycleSeed: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Cycle_Seed',
      systemName: base.config.name,
      parameters: [...inheritedParams],
      customParameters: [...inheritedParams],
    }
    const withObject = addObject(base, cycleSeed)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'cycle_pd_seed',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: cycleSeed.name,
      startObject: cycleSeed.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0.1, 0.2],
            param_value: inheritedParams[0],
            stability: 'PeriodDoubling',
            eigenvalues: [{ re: -1, im: 0 }],
          },
        ],
        bifurcations: [0],
        indices: [0],
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...inheritedParams],
      mapIterations: 2,
    }
    const withBranch = addBranch(withObject.system, sourceBranch, withObject.nodeId)
    const client = new MockForkCoreClient(0)
    client.runMapCycleContinuationFromPD = async (request) =>
      normalizeBranchEigenvalues({
        points: [
          {
            state: [0.2, 0.3],
            param_value: request.paramValue,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [0.25, 0.35],
            param_value: request.paramValue + request.settings.step_size,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
      })
    const { getContext } = setupApp(withBranch.system, client)

    await act(async () => {
      await getContext().actions.createCycleFromPD({
        branchId: withBranch.nodeId,
        pointIndex: 0,
        cycleName: 'Cycle_PD_Custom',
        branchName: 'cycle_pd_custom_mu',
        amplitude: 0.01,
        settings: continuationSettings,
        forward: true,
        solverParams: {
          maxSteps: 25,
          dampingFactor: 1,
          mapIterations: 4,
        },
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const cycleId = findObjectIdByName(next!, 'Cycle_PD_Custom')
      const cycle = next!.objects[cycleId] as EquilibriumObject
      expect(cycle.parameters).toEqual(inheritedParams)
      expect(cycle.customParameters).toEqual(inheritedParams)
    })
  })

  it('stores inherited custom parameters when creating a limit cycle from a PD point', async () => {
    const { system } = createPeriodDoublingSystem()
    const sourceBranchId = findBranchIdByName(system, 'lc_pd_mu')
    const sourceBranch = system.branches[sourceBranchId]
    const sourceObjectId = findObjectIdByName(system, sourceBranch.parentObject)
    const inheritedParams = [2.4]

    const seededSystem: System = {
      ...system,
      objects: {
        ...system.objects,
        [sourceObjectId]: {
          ...(system.objects[sourceObjectId] as LimitCycleObject),
          parameters: [...inheritedParams],
          customParameters: [...inheritedParams],
        },
      },
      branches: {
        ...system.branches,
        [sourceBranchId]: {
          ...sourceBranch,
          params: [...inheritedParams],
        },
      },
    }
    const { getContext } = setupApp(seededSystem)

    await act(async () => {
      await getContext().actions.createLimitCycleFromPD({
        branchId: sourceBranchId,
        pointIndex: 1,
        limitCycleName: 'LC_PD_Custom',
        branchName: 'lc_pd_custom_mu',
        amplitude: 0.1,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_PD_Custom')
      const lc = next!.objects[lcId] as LimitCycleObject
      expect(lc.parameters).toEqual(inheritedParams)
      expect(lc.customParameters).toEqual(inheritedParams)
    })
  })

  it('preserves the exact source and adapted meshes when branching a cycle at PD', async () => {
    const { system } = createPeriodDoublingSystem()
    const sourceBranchId = findBranchIdByName(system, 'lc_pd_mu')
    const sourceBranch = system.branches[sourceBranchId]
    if (sourceBranch.data.branch_type?.type !== 'LimitCycle') {
      throw new Error('Expected a limit-cycle branch fixture.')
    }
    sourceBranch.data.branch_type.normalized_mesh = [0, 0.1, 0.35, 0.8, 1]
    const client = new MockForkCoreClient(0)
    let receivedSourceMesh: number[] | null = null
    client.runLimitCycleContinuationFromPD = async (request) => {
      receivedSourceMesh = [...request.normalizedMesh]
      return normalizeBranchEigenvalues({
        points: [
          {
            state: [...request.lcState],
            param_value: request.paramValue,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [...request.lcState],
            param_value: request.paramValue + request.settings.step_size,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'LimitCycle',
          ntst: 3,
          ncol: 2,
          normalized_mesh: [0, 0.2, 0.7, 1],
        },
      })
    }
    const { getContext } = setupApp(system, client)

    await act(async () => {
      await getContext().actions.createLimitCycleFromPD({
        branchId: sourceBranchId,
        pointIndex: 1,
        limitCycleName: 'LC_PD_Mesh',
        branchName: 'lc_pd_mesh_mu',
        amplitude: 0.1,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(receivedSourceMesh).toEqual([0, 0.1, 0.35, 0.8, 1])
      const lcId = findObjectIdByName(next!, 'LC_PD_Mesh')
      const lc = next!.objects[lcId] as LimitCycleObject
      expect({ ntst: lc.ntst, ncol: lc.ncol, mesh: lc.normalized_mesh }).toEqual({
        ntst: 3,
        ncol: 2,
        mesh: [0, 0.2, 0.7, 1],
      })
    })
  })

  it('does not store custom parameters when inherited params match system defaults', async () => {
    const { system } = createPeriodDoublingSystem()
    const sourceBranchId = findBranchIdByName(system, 'lc_pd_mu')
    const { getContext } = setupApp(system)

    await act(async () => {
      await getContext().actions.createLimitCycleFromPD({
        branchId: sourceBranchId,
        pointIndex: 1,
        limitCycleName: 'LC_PD_Defaults',
        branchName: 'lc_pd_defaults_mu',
        amplitude: 0.1,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      const lcId = findObjectIdByName(next!, 'LC_PD_Defaults')
      const lc = next!.objects[lcId] as LimitCycleObject
      expect(lc.parameters).toEqual(next!.config.params)
      expect(lc.customParameters).toBeUndefined()
    })
  })
})

describe('appState homoclinic and homotopy actions', () => {
  function makeTwoParamSystem(name: string): System {
    return createSystem({
      name,
      config: {
        name,
        equations: ['y', '-x'],
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
  }

  it('creates a standard-shooting homoclinic branch from a limit-cycle branch point', async () => {
    const base = makeTwoParamSystem('Homoc_App_M1')
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_A',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 4,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, -1, 0, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedDiscretization: string | undefined
    let capturedShootingIntervals: number | undefined
    let capturedIntegrationSteps: number | undefined
    client.runHomoclinicFromLargeCycle = async (request) => {
      capturedDiscretization = request.discretization
      capturedShootingIntervals = request.shootingIntervals
      capturedIntegrationSteps = request.integrationStepsPerSegment
      return normalizeBranchEigenvalues({
        points: [
          {
            state: [0, 0, 0.5, 0.5],
            param_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [1, 1, 0.6, 0.6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [2, 2, 0.7, 0.7],
            param_value: 0.3,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0, 2],
        indices: [0, 11, 12],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 6,
          ncol: 0,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
        resume_state: {
          min_index_seed: {
            endpoint_index: 0,
            aug_state: [0.1, 0, 0],
            tangent: [1, 0, 0],
            step_size: 0.01,
          },
          max_index_seed: {
            endpoint_index: 12,
            aug_state: [0.3, 2, 2],
            tangent: [1, 0, 0],
            step_size: 0.02,
          },
        },
      })
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromLargeCycle({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_m1',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 8,
        targetNcol: 2,
        discretization: 'shooting',
        shootingIntervals: 6,
        integrationStepsPerSegment: 96,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const branchId = findBranchIdByName(getContext().state.system!, 'homoc_m1')
      expect(branchId).toBeTruthy()
      const created = getContext().state.system!.branches[branchId]
      expect(
        created.branchType
      ).toBe('homoclinic_curve')
      expect(capturedDiscretization).toBe('shooting')
      expect(capturedShootingIntervals).toBe(6)
      expect(capturedIntegrationSteps).toBe(96)
      expect(created.data.branch_type).toMatchObject({ ntst: 6, ncol: 0 })
      expect(created.data.indices).toEqual([0, 1])
      expect(created.data.resume_state?.min_index_seed?.endpoint_index).toBe(0)
      expect(created.data.resume_state?.min_index_seed?.step_size).toBe(0.01)
      expect(created.data.resume_state?.max_index_seed?.endpoint_index).toBe(1)
      expect(created.data.resume_state?.max_index_seed?.step_size).toBe(0.02)
    })
  })

  it('forwards an exact nonuniform large-cycle mesh to homoclinic initialization', async () => {
    const base = makeTwoParamSystem('Homoc_App_M1_Nonuniform')
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Nonuniform',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 2,
      ncol: 2,
      period: 6,
      state: [0, 1, 1, 0, 0, -1, 6],
      normalized_mesh: [0, 0.2, 1],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch_nonuniform',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 1, 1, 0, 0, -1, 6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'LimitCycle',
          ntst: 2,
          ncol: 2,
          normalized_mesh: [0, 0.2, 1],
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedMesh: number[] | undefined
    client.runHomoclinicFromLargeCycle = async (request) => {
      capturedMesh = request.sourceNormalizedMesh
      return {
        points: [
          { state: [0, 0], param_value: 0.2, stability: 'None', eigenvalues: [] },
          { state: [0.1, 0], param_value: 0.21, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: request.targetNtst,
          ncol: request.targetNcol,
          param1_name: request.parameterName,
          param2_name: request.param2Name,
          free_time: request.freeTime,
          free_eps0: request.freeEps0,
          free_eps1: request.freeEps1,
          discretization: { type: 'collocation' },
        },
      }
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromLargeCycle({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_nonuniform',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 8,
        targetNcol: 2,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(capturedMesh).toEqual([0, 0.2, 1])
    expect(findBranchIdByName(getContext().state.system!, 'homoc_nonuniform')).toBeTruthy()
    expect(getContext().state.error).toBeNull()
  })

  it('creates a homoclinic branch from a frozen large-cycle point with reduced packed state', async () => {
    const base = createSystem({
      name: 'Homoc_App_M1_Frozen_Reduced',
      config: {
        name: 'Homoc_App_M1_Frozen_Reduced',
        equations: ['v', '0', '0'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['v', 'h1', 'h2'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const snapshot = buildSubsystemSnapshot(base.config, {
      frozenValuesByVarName: { h1: 0.3, h2: 0.4 },
    })
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Frozen',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_A' },
      ntst: 3,
      ncol: 2,
      period: 12,
      state: [0.2],
      createdAt: new Date().toISOString(),
      frozenVariables: { frozenValuesByVarName: { h1: 0.3, h2: 0.4 } },
      subsystemSnapshot: snapshot,
    }
    const added = addObject(base, limitCycle)
    const pointCount = 3 * (2 + 1)
    const reducedPackedState = Array.from({ length: pointCount }, (_, index) => index + 0.25)
    reducedPackedState.push(12)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch_frozen',
      systemName: base.config.name,
      parameterName: 'var:h1',
      parameterRef: { kind: 'frozen_var', variableName: 'h1' },
      parentObject: limitCycle.name,
      startObject: limitCycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: reducedPackedState,
            param_value: 0.31,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 3, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2],
      subsystemSnapshot: snapshot,
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedLcState: number[] = []
    client.runHomoclinicFromLargeCycle = async (request) => {
      capturedLcState = [...request.lcState]
      return normalizeBranchEigenvalues({
        points: [
          {
            state: [0, 0, 0.5, 0.5],
            param_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [1, 1, 0.6, 0.6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 6,
          ncol: 2,
          param1_name: 'var:h1',
          param2_name: 'var:h2',
          param1_ref: { kind: 'frozen_var', variableName: 'h1' },
          param2_ref: { kind: 'frozen_var', variableName: 'h2' },
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      })
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromLargeCycle({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_frozen_reduced',
        parameterName: 'var:h1',
        param2Name: 'var:h2',
        targetNtst: 6,
        targetNcol: 2,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(getContext().state.error).toBeNull()
      expect(capturedLcState).toEqual(reducedPackedState)
      const createdId = findBranchIdByName(getContext().state.system!, 'homoc_frozen_reduced')
      expect(createdId).toBeTruthy()
    })
  })

  it('creates a homotopy-saddle branch from an equilibrium branch point', async () => {
    const base = makeTwoParamSystem('Homoc_App_M5')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'eq_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'equilibrium',
      data: {
        points: [
          {
            state: [0, 0],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'Equilibrium' },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const { getContext } = setupApp(branchResult.system)

    await act(async () => {
      await getContext().actions.createHomotopySaddleFromEquilibrium({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homotopy_m5',
        parameterName: 'mu',
        param2Name: 'nu',
        ntst: 8,
        ncol: 2,
        eps0: 0.01,
        eps1: 0.1,
        time: 20,
        eps1Tol: 1e-4,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(findBranchIdByName(getContext().state.system!, 'homotopy_m5')).toBeTruthy()
      expect(
        getContext().state.system!.branches[
          findBranchIdByName(getContext().state.system!, 'homotopy_m5')
        ].branchType
      ).toBe('homotopy_saddle_curve')
    })
  })

  it('does not double-trim already normalized homoclinic large-cycle results', async () => {
    const base = makeTwoParamSystem('Homoc_App_M1_NoDoubleTrim')
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Seed',
      systemName: base.config.name,
      origin: {
        type: 'hopf',
        equilibriumObjectName: 'EQ_A',
        equilibriumBranchName: 'eq_branch',
        pointIndex: 0,
      },
      ntst: 4,
      ncol: 2,
      period: 10,
      state: [0.2, -0.1, 10],
      parameters: [0.2, 0.1],
      parameterName: 'mu',
      paramValue: 0.2,
      floquetMultipliers: [],
      createdAt: new Date().toISOString(),
    }
    const added = addObject(base, limitCycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: limitCycle.name,
      startObject: 'eq_branch',
      branchType: 'limit_cycle',
      data: {
        points: [
          {
            state: [0, 0, 0.5, 0.5],
            param_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: { type: 'LimitCycle', ntst: 4, ncol: 2 },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, branch, added.nodeId)
    const client = new MockForkCoreClient(0)
    client.runHomoclinicFromLargeCycle = async () =>
      normalizeBranchEigenvalues({
        points: [
          {
            state: [1, 1, 0.6, 0.6],
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: [2, 2, 0.7, 0.7],
            param_value: 0.3,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0, 1],
        indices: [0, 1],
        upoldp: [[0.1, 0, 0, 0.5, 0.5]],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 8,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
        resume_state: {
          max_index_seed: {
            endpoint_index: 1,
            aug_state: [0.3, 2, 2],
            tangent: [1, 0, 0],
            step_size: 0.02,
          },
        },
      })
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromLargeCycle({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_no_double_trim',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 8,
        targetNcol: 2,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const branchId = findBranchIdByName(getContext().state.system!, 'homoc_no_double_trim')
      expect(branchId).toBeTruthy()
      const created = getContext().state.system!.branches[branchId]
      expect(created.data.indices).toEqual([0, 1])
      expect(created.data.points).toHaveLength(2)
      expect(created.data.resume_state?.max_index_seed?.endpoint_index).toBe(1)
    })
  })

  it('creates a homoclinic restart branch from a homoclinic branch point', async () => {
    const base = makeTwoParamSystem('Homoc_App_M2')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(80).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 8,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const { getContext } = setupApp(branchResult.system)

    await act(async () => {
      await getContext().actions.createHomoclinicFromHomoclinic({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_m2',
        parameterName: 'nu',
        param2Name: 'mu',
        targetNtst: 8,
        targetNcol: 2,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      const branchId = findBranchIdByName(getContext().state.system!, 'homoc_m2')
      expect(branchId).toBeTruthy()
      const created = getContext().state.system!.branches[branchId]
      expect(created.branchType).toBe('homoclinic_curve')
      expect(created.parameterName).toBe('nu, mu')
      const branchType = created.data.branch_type as {
        type: 'HomoclinicCurve'
        param1_name: string
        param2_name: string
      }
      expect(branchType.type).toBe('HomoclinicCurve')
      expect(branchType.param1_name).toBe('nu')
      expect(branchType.param2_name).toBe('mu')
    })
  })

  it('creates a homoclinic branch from a StageD homotopy-saddle point', async () => {
    const base = makeTwoParamSystem('Homoc_App_M4')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homotopy_source',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homotopy_saddle_curve',
      data: {
        points: [
          {
            state: new Array(80).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomotopySaddleCurve',
          ntst: 8,
          ncol: 2,
          param1_name: 'mu',
          param2_name: 'nu',
          stage: 'StageD',
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const { getContext } = setupApp(branchResult.system)

    await act(async () => {
      await getContext().actions.createHomoclinicFromHomotopySaddle({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_m4',
        targetNtst: 8,
        targetNcol: 2,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    await waitFor(() => {
      expect(findBranchIdByName(getContext().state.system!, 'homoc_m4')).toBeTruthy()
      expect(
        getContext().state.system!.branches[
          findBranchIdByName(getContext().state.system!, 'homoc_m4')
        ].branchType
      ).toBe('homoclinic_curve')
    })
  })

  it('extends homoclinic branches via generic extension when available', async () => {
    const base = makeTwoParamSystem('Homoc_Extend')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const p2 = 0.25
    const packedState = [
      0, 0, 1, 1, 2, 2, // mesh
      0.5, 0.5, 1.5, 1.5, // stages
      0, 0, // x0
      p2, // p2
      8, 0.01, 0, 0, // extras + Riccati tail
    ]

    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: packedState,
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [0],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, p2],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)

    const client = new MockForkCoreClient(0)
    let continuationExtensionCalled = false
    client.runContinuationExtension = async (request) => {
      continuationExtensionCalled = true
      return normalizeBranchEigenvalues(
        {
          ...request.branchData,
          points: [
            ...request.branchData.points,
            {
              state: packedState,
              param_value: 0.21,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          indices: [0, 1],
        },
        { stateDimension: request.system.varNames.length }
      )
    }
    let capturedParameterName = ''
    let capturedPointState: number[] = []
    client.runHomoclinicFromHomoclinic = async (request) => {
      capturedParameterName = request.parameterName
      capturedPointState = [...request.pointState]
      return normalizeBranchEigenvalues(
        {
          points: [
            {
              state: packedState,
              param_value: 0.2,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: packedState,
              param_value: 0.21,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: sourceBranch.data.branch_type,
        },
        { stateDimension: request.system.varNames.length }
      )
    }

    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.extendBranch({
        branchId: branchResult.nodeId,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(continuationExtensionCalled).toBe(true)
    expect(capturedParameterName).toBe('')
    expect(capturedPointState).toEqual([])
    const updated = getContext().state.system!.branches[branchResult.nodeId]
    expect(updated.data.points[0].param2_value).toBeCloseTo(p2, 12)
    expect(updated.data.points[1].param2_value).toBeCloseTo(p2, 12)
  })

  it('extends homoclinic branches backward via generic extension', async () => {
    const base = makeTwoParamSystem('Homoc_Extend_Backward_Success')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const p2 = 0.3
    const packedState = [
      0, 0, 1, 1, 2, 2, // mesh
      0.5, 0.5, 1.5, 1.5, // stages
      0, 0, // x0
      p2, // p2
      8, 0.01, 0, 0, // extras + Riccati tail
    ]

    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source_backward',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: packedState,
            param_value: 0.19,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: packedState,
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, p2],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)

    const client = new MockForkCoreClient(0)
    let receivedBackward = false
    client.runContinuationExtension = async (request) => {
      receivedBackward = request.forward === false
      return normalizeBranchEigenvalues(
        {
          ...request.branchData,
          points: [
            {
              state: packedState,
              param_value: 0.18,
              stability: 'None',
              eigenvalues: [],
            },
            ...request.branchData.points,
          ],
          indices: [-1, 0, 1],
        },
        { stateDimension: request.system.varNames.length }
      )
    }

    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.extendBranch({
        branchId: branchResult.nodeId,
        settings: continuationSettings,
        forward: false,
      })
    })

    expect(receivedBackward).toBe(true)
    const updated = getContext().state.system!.branches[branchResult.nodeId]
    expect(updated.data.points.length).toBe(3)
    expect(updated.data.indices).toEqual([-1, 0, 1])
    expect(updated.data.points[0].param2_value).toBeCloseTo(p2, 12)
  })

  it('does not auto-restart homoc extension when the extension runner cannot advance', async () => {
    const base = makeTwoParamSystem('Homoc_Extend_Backward')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const p2 = 0.25
    const packedState0 = [
      0, 0, 1, 1, 2, 2,
      0.5, 0.5, 1.5, 1.5,
      0, 0,
      p2,
      8, 0.01, 0, 0,
    ]
    const packedState1 = [
      10, 10, 11, 11, 12, 12,
      10.5, 10.5, 11.5, 11.5,
      0, 0,
      p2,
      8, 0.01, 0, 0,
    ]
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: packedState0,
            param_value: 0.2,
            stability: 'None',
            eigenvalues: [],
          },
          {
            state: packedState1,
            param_value: 0.21,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [1],
        indices: [0, 1],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, p2],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let restartCalled = false
    const attemptedStepSizes: number[] = []
    client.runContinuationExtension = async (request) => {
      attemptedStepSizes.push(request.settings.step_size)
      return normalizeBranchEigenvalues(
        {
          ...request.branchData,
        },
        { stateDimension: request.system.varNames.length }
      )
    }
    client.runHomoclinicFromHomoclinic = async () => {
      restartCalled = true
      throw new Error('restart should not be called from extension')
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.extendBranch({
        branchId: branchResult.nodeId,
        settings: continuationSettings,
        forward: false,
      })
    })

    expect(getContext().state.error).toContain('Homoclinic extension stopped at the endpoint')
    expect(attemptedStepSizes).toEqual([continuationSettings.step_size])
    expect(restartCalled).toBe(false)
    const updated = getContext().state.system!.branches[branchResult.nodeId]
    expect(updated.data.points.length).toBe(2)
    expect(updated.data.indices).toEqual([0, 1])
  })

  it('uses packed homoc state for explicit homoc restart when point.state is display-trimmed', async () => {
    const base = makeTwoParamSystem('Homoc_Extend_Packed_State')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const p2 = 0.25
    const packedState = [
      0, 0, 1, 1, 2, 2,
      0.5, 0.5, 1.5, 1.5,
      0, 0,
      p2,
      8, 0.01, 0, 0,
    ]

    const displayState = [0, 0]
    const point = {
      state: displayState,
      packedState,
      param_value: 0.2,
      stability: 'None',
      eigenvalues: [],
    } as unknown as ContinuationPoint

    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [point],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, p2],
    }

    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedPointState: number[] = []
    client.runHomoclinicFromHomoclinic = async (request) => {
      capturedPointState = [...request.pointState]
      return normalizeBranchEigenvalues(
        {
          points: [
            {
              state: packedState,
              param_value: 0.2,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: packedState,
              param_value: 0.21,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: sourceBranch.data.branch_type,
        },
        { stateDimension: base.config.varNames.length }
      )
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromHomoclinic({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_restart',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 2,
        targetNcol: 1,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(capturedPointState).toEqual(packedState)
  })

  it('passes source homoc encoding metadata into Method 2 requests', async () => {
    const base = makeTwoParamSystem('Homoc_M2_Source_Metadata')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source_meta',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(40).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 4,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: false,
          free_eps0: true,
          free_eps1: true,
        },
        homoc_context: {
          base_params: [0.2, 0.1],
          param1_index: 0,
          param2_index: 1,
          basis: {
            stable_q: [1, 0, 0, 1],
            unstable_q: [1, 0, 0, 1],
            dim: 2,
            nneg: 1,
            npos: 1,
          },
          fixed_time: 12.5,
          fixed_eps0: 0.02,
          fixed_eps1: 0.03,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const client = new MockForkCoreClient(0)
    let capturedSourceFreeTime: boolean | undefined
    let capturedSourceFreeEps0: boolean | undefined
    let capturedSourceFreeEps1: boolean | undefined
    let capturedSourceFixedTime: number | undefined
    let capturedSourceFixedEps0: number | undefined
    let capturedSourceFixedEps1: number | undefined
    client.runHomoclinicFromHomoclinic = async (request) => {
      capturedSourceFreeTime = request.sourceFreeTime
      capturedSourceFreeEps0 = request.sourceFreeEps0
      capturedSourceFreeEps1 = request.sourceFreeEps1
      capturedSourceFixedTime = request.sourceFixedTime
      capturedSourceFixedEps0 = request.sourceFixedEps0
      capturedSourceFixedEps1 = request.sourceFixedEps1
      return normalizeBranchEigenvalues(
        {
          points: [
            {
              state: new Array(40).fill(0),
              param_value: 0.2,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: new Array(40).fill(0),
              param_value: 0.21,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: sourceBranch.data.branch_type,
        },
        { stateDimension: base.config.varNames.length }
      )
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromHomoclinic({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_restart_meta',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 4,
        targetNcol: 1,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(capturedSourceFreeTime).toBe(false)
    expect(capturedSourceFreeEps0).toBe(true)
    expect(capturedSourceFreeEps1).toBe(true)
    expect(capturedSourceFixedTime).toBeCloseTo(12.5, 8)
    expect(capturedSourceFixedEps0).toBeCloseTo(0.02, 8)
    expect(capturedSourceFixedEps1).toBeCloseTo(0.03, 8)
  })

  it('fails Method 2 early when fixed-time source metadata is missing', async () => {
    const base = makeTwoParamSystem('Homoc_M2_Missing_Fixed_Time')
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ_A',
      systemName: base.config.name,
    }
    const added = addObject(base, equilibrium)
    const sourceBranch: ContinuationObject = {
      type: 'continuation',
      name: 'homoc_source_missing_meta',
      systemName: base.config.name,
      parameterName: 'mu, nu',
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'homoclinic_curve',
      data: {
        points: [
          {
            state: new Array(40).fill(0),
            param_value: 0.2,
            param2_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 4,
          ncol: 1,
          param1_name: 'mu',
          param2_name: 'nu',
          free_time: false,
          free_eps0: true,
          free_eps1: true,
        },
      },
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [0.2, 0.1],
    }
    const branchResult = addBranch(added.system, sourceBranch, added.nodeId)
    const client = new MockForkCoreClient(0)
    const homocSpy = vi.fn()
    client.runHomoclinicFromHomoclinic = async () => {
      homocSpy()
      return {
        points: [],
        bifurcations: [],
        indices: [],
      }
    }
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.createHomoclinicFromHomoclinic({
        branchId: branchResult.nodeId,
        pointIndex: 0,
        name: 'homoc_restart_should_fail',
        parameterName: 'mu',
        param2Name: 'nu',
        targetNtst: 4,
        targetNcol: 1,
        freeTime: true,
        freeEps0: true,
        freeEps1: false,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(homocSpy).not.toHaveBeenCalled()
    expect(getContext().state.error).toContain('missing fixed time metadata')
  })
})

describe('appState equilibrium manifold actions', () => {
  const manifoldCaps = {
    max_steps: 40,
    max_points: 120,
    max_rings: 40,
    max_vertices: 120,
    max_time: 10,
  }

  function createStoredFlowManifold(manifoldFingerprint?: string) {
    const base = createSystem({
      name: 'Stored_Flow_Manifold',
      config: {
        name: 'Stored_Flow_Manifold',
        equations: ['x'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Stored',
      systemName: base.config.name,
      parameters: [...base.config.params],
    }
    const withEquilibrium = addObject(base, equilibrium)
    const manifoldSettings = {
      stability: 'Unstable' as const,
      direction: 'Plus' as const,
      eig_index: 0,
      eps: 1e-3,
      target_arclength: 0.1,
      integration_dt: 0.01,
      caps: manifoldCaps,
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'stored_manifold_plus',
      systemName: base.config.name,
      parameterName: 'manifold',
      parentObjectId: withEquilibrium.nodeId,
      startObjectId: withEquilibrium.nodeId,
      parentObject: equilibrium.name,
      startObject: equilibrium.name,
      branchType: 'eq_manifold_1d',
      data: {
        points: [
          { state: [0.001], param_value: 0, stability: 'None', eigenvalues: [] },
          { state: [0.101], param_value: 0.1, stability: 'None', eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'ManifoldEq1D',
          stability: 'Unstable',
          direction: 'Plus',
          eig_index: 0,
          method: 'test',
          caps: manifoldCaps,
        },
        manifold_geometry: {
          type: 'Curve',
          dim: 1,
          points_flat: [0.001, 0.101],
          arclength: [0, 0.1],
          direction: 'Plus',
          resume_state: { type: 'Flow', version: 1, endpoint: [0.101] },
        },
      },
      settings: continuationSettings,
      manifoldSettings,
      manifoldFingerprint,
      timestamp: new Date().toISOString(),
      params: [...base.config.params],
    }
    return addBranch(withEquilibrium.system, branch, withEquilibrium.nodeId)
  }

  it('extends a stored 1D manifold in place and forwards its serialized branch', async () => {
    const fixture = createStoredFlowManifold()
    const client = new MockForkCoreClient(0)
    let capturedPointCount = 0
    let finishExtension!: () => void
    const { getContext } = setupApp(fixture.system, client)
    client.runEquilibriumManifold1DExtension = (request) => {
      capturedPointCount = request.branchData.points.length
      return new Promise((resolve) => {
        finishExtension = () =>
          resolve(
            normalizeBranchEigenvalues({
              ...request.branchData,
              points: [
                ...request.branchData.points,
                {
                  state: [0.151],
                  param_value: 0.15,
                  stability: 'None',
                  eigenvalues: [],
                },
              ],
              indices: [...request.branchData.indices, 2],
            })
          )
      })
    }

    let extensionPromise!: Promise<void>
    act(() => {
      extensionPromise = getContext().actions.extendEquilibriumManifold1D({
        branchId: fixture.nodeId,
        settings: {
          ...fixture.system.branches[fixture.nodeId].manifoldSettings!,
          stability: 'Unstable',
          direction: 'Plus',
          eig_index: 0,
          eps: 1e-3,
          integration_dt: 0.01,
          target_arclength: 0.05,
          caps: { ...manifoldCaps },
        },
      })
    })

    expect(getContext().state.continuationProgress).toEqual({
      label: 'Extend Invariant Manifold (1D)',
      progress: expect.objectContaining({ done: false, current_step: 0 }),
    })

    await act(async () => {
      finishExtension()
      await extensionPromise
    })

    await waitFor(() => {
      expect(capturedPointCount).toBe(2)
      expect(Object.keys(getContext().state.system!.branches)).toHaveLength(1)
      expect(getContext().state.system!.branches[fixture.nodeId].data.points).toHaveLength(3)
      expect(getContext().state.system!.ui.selectedNodeId).toBe(fixture.nodeId)
    })
  })

  it('rejects extension when the stored manifold fingerprint is stale', async () => {
    const fixture = createStoredFlowManifold('stale-fingerprint')
    const client = new MockForkCoreClient(0)
    const extensionSpy = vi.spyOn(client, 'runEquilibriumManifold1DExtension')
    const { getContext } = setupApp(fixture.system, client)

    await act(async () => {
      await getContext().actions.extendEquilibriumManifold1D({
        branchId: fixture.nodeId,
        settings: {
          ...fixture.system.branches[fixture.nodeId].manifoldSettings!,
          stability: 'Unstable',
          direction: 'Plus',
          eig_index: 0,
          eps: 1e-3,
          integration_dt: 0.01,
          target_arclength: 0.05,
          caps: { ...manifoldCaps },
        },
      })
    })

    expect(extensionSpy).not.toHaveBeenCalled()
    expect(getContext().state.error).toContain('different system or parameter state')
  })

  function createStoredSurfaceManifold() {
    const fixture = createStoredFlowManifold()
    const branch = fixture.system.branches[fixture.nodeId]
    branch.branchType = 'eq_manifold_2d'
    branch.manifoldFingerprint = undefined
    branch.data.branch_type = {
      type: 'ManifoldEq2D',
      stability: 'Unstable',
      eig_kind: 'RealPair',
      eig_indices: [0, 1],
      method: 'krauskopf_osinga_geodesic_leaf_continuation',
      caps: manifoldCaps,
    }
    branch.data.manifold_geometry = {
      type: 'Surface',
      dim: 1,
      vertices_flat: [0.001, 0.101],
      triangles: [],
      ring_offsets: [0, 1],
      resume_state: {
        type: 'GeodesicRings',
        version: 1,
        outer_ring: [[0.101], [0.102], [0.103], [0.104]],
        inward_anchors: [[0], [0], [0], [0]],
        current_leaf_delta: 0.01,
        accumulated_arclength: 0.1,
        center: [0],
      },
    }
    branch.manifoldSettings = {
      stability: 'Unstable',
      eig_indices: [0, 1],
      initial_radius: 1e-3,
      leaf_delta: 0.01,
      delta_min: 0.001,
      ring_points: 4,
      min_spacing: 0.001,
      max_spacing: 0.02,
      alpha_min: 0.3,
      alpha_max: 0.4,
      delta_alpha_min: 0.1,
      delta_alpha_max: 1,
      integration_dt: 0.01,
      target_radius: 1,
      target_arclength: 0.1,
      caps: manifoldCaps,
    }
    return fixture
  }

  it('extends a stored 2D manifold in place through the dedicated worker path', async () => {
    const fixture = createStoredSurfaceManifold()
    const client = new MockForkCoreClient(0)
    let capturedResumeType: string | undefined
    let finishExtension!: () => void
    const { getContext } = setupApp(fixture.system, client)
    client.runManifold2DExtension = (request) => {
      const geometry = request.branchData.manifold_geometry
      const surface = geometry?.type === 'Surface' && !('Surface' in geometry) ? geometry : null
      capturedResumeType = surface?.resume_state?.type
      return new Promise((resolve) => {
        finishExtension = () =>
          resolve(
            normalizeBranchEigenvalues({
              ...request.branchData,
              points: [
                ...request.branchData.points,
                { state: [0.151], param_value: 2, stability: 'None', eigenvalues: [] },
              ],
              indices: [...request.branchData.indices, 2],
            })
          )
      })
    }

    let extensionPromise!: Promise<void>
    act(() => {
      extensionPromise = getContext().actions.extendManifold2D({
        branchId: fixture.nodeId,
        targetArclength: 0.05,
        integrationDt: 0.01,
        caps: { ...manifoldCaps },
      })
    })

    expect(getContext().state.continuationProgress).toEqual({
      label: 'Extend Invariant Manifold (2D)',
      progress: expect.objectContaining({ done: false, current_step: 0, rings_computed: 0 }),
    })

    await act(async () => {
      finishExtension()
      await extensionPromise
    })

    expect(capturedResumeType).toBe('GeodesicRings')
    expect(getContext().state.system!.branches[fixture.nodeId].data.points).toHaveLength(3)
  })

  it('keeps the original 2D surface unchanged when extension fails', async () => {
    const fixture = createStoredSurfaceManifold()
    const client = new MockForkCoreClient(0)
    client.runManifold2DExtension = async () => {
      throw new Error('collocation failed')
    }
    const before = structuredClone(fixture.system.branches[fixture.nodeId].data)
    const { getContext } = setupApp(fixture.system, client)

    await act(async () => {
      await getContext().actions.extendManifold2D({
        branchId: fixture.nodeId,
        targetArclength: 0.05,
        integrationDt: 0.01,
        caps: { ...manifoldCaps },
      })
    })

    expect(getContext().state.system!.branches[fixture.nodeId].data).toEqual(before)
    expect(getContext().state.error).toContain('collocation failed')
  })

  it('forwards map iterations and applies cycle-point naming for map 1D manifolds', async () => {
    const base = createSystem({
      name: 'Map_Manifold_AppState',
      config: {
        name: 'Map_Manifold_AppState',
        equations: ['mu * x * (1 - x)'],
        params: [3.2],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Map',
      systemName: base.config.name,
      solution: {
        state: [0.2],
        residual_norm: 0,
        iterations: 2,
        jacobian: [1.2],
        eigenpairs: [{ value: { re: 1.2, im: 0 }, vector: [{ re: 1, im: 0 }] }],
        cycle_points: [[0.2], [0.7]],
      },
      lastSolverParams: {
        initialGuess: [0.2],
        maxSteps: 20,
        dampingFactor: 1,
        mapIterations: 3,
      },
      solutionProvenance: {
        fingerprint: JSON.stringify({
          type: base.config.type,
          equations: base.config.equations,
          params: base.config.params,
          paramNames: base.config.paramNames,
          varNames: base.config.varNames,
          periodicVariables: base.config.periodicVariables ?? [],
          mapIterations: 2,
        }),
        mapIterations: 2,
      },
      parameters: [...base.config.params],
    }
    const added = addObject(base, equilibrium)
    const client = new MockForkCoreClient(0)
    let capturedMapIterations: number | undefined
    let capturedMaxIterations: number | undefined
    client.runEquilibriumManifold1D = async (request) => {
      capturedMapIterations = request.mapIterations
      capturedMaxIterations = request.settings.caps.max_iterations
      const makeBranch = (direction: 'Plus' | 'Minus', cyclePointIndex: number) => {
        const sign = direction === 'Plus' ? 1 : -1
        const offset = cyclePointIndex * 0.1
        return {
          points: [
            {
              state: [0.2 + offset],
              param_value: 0,
              stability: 'None' as const,
              eigenvalues: [],
            },
            {
              state: [0.2 + offset + sign * 0.05],
              param_value: 0.05,
              stability: 'None' as const,
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'ManifoldEq1D' as const,
            stability: 'Unstable' as const,
            direction,
            eig_index: 0,
            method: 'test',
            caps: manifoldCaps,
            map_iterations: 2,
            cycle_point_index: cyclePointIndex,
          },
          manifold_geometry: {
            type: 'Curve' as const,
            dim: 1,
            points_flat: [0.2 + offset, 0.2 + offset + sign * 0.05],
            arclength: [0, 0.05],
            direction,
          },
        }
      }
      return [
        makeBranch('Plus', 0),
        makeBranch('Minus', 0),
        makeBranch('Plus', 1),
        makeBranch('Minus', 1),
      ]
    }
    const { getContext } = setupApp(added.system, client)

    await act(async () => {
      await getContext().actions.createEquilibriumManifold1D({
        equilibriumId: added.nodeId,
        name: 'map_branch',
        settings: {
          stability: 'Unstable',
          direction: 'Both',
          eig_index: 0,
          eps: 1e-3,
          target_arclength: 0.05,
          integration_dt: 1,
          caps: manifoldCaps,
        },
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(capturedMapIterations).toBe(2)
      expect(capturedMaxIterations).toBe(manifoldCaps.max_steps)
      const expectedNames = [
        'map_branch_p1_plus',
        'map_branch_p1_minus',
        'map_branch_p2_plus',
        'map_branch_p2_minus',
      ]
      for (const name of expectedNames) {
        const branchId = findBranchIdByName(next!, name)
        expect(next!.branches[branchId].mapIterations).toBe(2)
        expect(next!.branches[branchId].manifoldSettings?.target_arclength).toBe(0.05)
      }
    })
  })

  it('keeps flow 1D manifold naming unchanged', async () => {
    const base = createSystem({
      name: 'Flow_Manifold_AppState',
      config: {
        name: 'Flow_Manifold_AppState',
        equations: ['x'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq_Flow',
      systemName: base.config.name,
      solution: {
        state: [0],
        residual_norm: 0,
        iterations: 1,
        jacobian: [1],
        eigenpairs: [{ value: { re: 1.1, im: 0 }, vector: [{ re: 1, im: 0 }] }],
      },
      parameters: [...base.config.params],
    }
    const added = addObject(base, equilibrium)
    const client = new MockForkCoreClient(0)
    client.runEquilibriumManifold1D = async () => [
      {
        points: [
          { state: [0], param_value: 0, stability: 'None' as const, eigenvalues: [] },
          { state: [0.05], param_value: 0.05, stability: 'None' as const, eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'ManifoldEq1D' as const,
          stability: 'Unstable' as const,
          direction: 'Plus' as const,
          eig_index: 0,
          method: 'test',
          caps: manifoldCaps,
        },
        manifold_geometry: {
          type: 'Curve' as const,
          dim: 1,
          points_flat: [0, 0.05],
          arclength: [0, 0.05],
          direction: 'Plus' as const,
        },
      },
      {
        points: [
          { state: [0], param_value: 0, stability: 'None' as const, eigenvalues: [] },
          { state: [-0.05], param_value: 0.05, stability: 'None' as const, eigenvalues: [] },
        ],
        bifurcations: [],
        indices: [0, 1],
        branch_type: {
          type: 'ManifoldEq1D' as const,
          stability: 'Unstable' as const,
          direction: 'Minus' as const,
          eig_index: 0,
          method: 'test',
          caps: manifoldCaps,
        },
        manifold_geometry: {
          type: 'Curve' as const,
          dim: 1,
          points_flat: [0, -0.05],
          arclength: [0, 0.05],
          direction: 'Minus' as const,
        },
      },
    ]
    const { getContext } = setupApp(added.system, client)

    await act(async () => {
      await getContext().actions.createEquilibriumManifold1D({
        equilibriumId: added.nodeId,
        name: 'flow_branch',
        settings: {
          stability: 'Unstable',
          direction: 'Both',
          eig_index: 0,
          eps: 1e-3,
          target_arclength: 0.05,
          integration_dt: 1,
          caps: manifoldCaps,
        },
      })
    })

    await waitFor(() => {
      const next = getContext().state.system
      expect(next).not.toBeNull()
      expect(findBranchIdByName(next!, 'flow_branch_plus')).toBeTruthy()
      expect(findBranchIdByName(next!, 'flow_branch_minus')).toBeTruthy()
    })
  })

  it('computes and persists the +1 map normal form at a Fold point', async () => {
    const base = createSystem({
      name: 'Map_Fold_Normal_Form',
      config: {
        name: 'Map_Fold_Normal_Form',
        equations: ['x + mu - x^2'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x'],
        solver: 'rk4',
        type: 'map',
      },
    })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'FP',
      systemName: base.config.name,
      parameters: [0],
    }
    const added = addObject(base, equilibrium)
    const branchResult = addBranch(
      added.system,
      {
        type: 'continuation',
        name: 'fixed_points',
        systemName: base.config.name,
        parameterName: 'mu',
        parentObjectId: added.nodeId,
        parentObject: equilibrium.name,
        startObject: equilibrium.name,
        branchType: 'equilibrium',
        data: {
          points: [{ state: [0], param_value: 0, stability: 'Fold' }],
          bifurcations: [0],
          indices: [0],
          branch_type: { type: 'Equilibrium' },
        },
        settings: continuationSettings,
        timestamp: new Date().toISOString(),
        params: [0],
        mapIterations: 3,
      },
      added.nodeId
    )
    const client = new MockForkCoreClient(0)
    const compute = vi.fn(async () => ({
      normalForm: {
        type: 'BranchPoint' as const,
        kind: 'Fold' as const,
        constant_parameter_coefficient: 1,
        linear_parameter_coefficient: 0,
        quadratic_coefficient: -1,
        cubic_coefficient: 0,
        conditioning: {
          eigenvector_pairing: 1,
          right_residual: 0,
          left_residual: 0,
          homological_residual: 0,
        },
      },
    }))
    client.computeNormalForm = compute
    const { getContext } = setupApp(branchResult.system, client)

    await act(async () => {
      await getContext().actions.computeNormalFormAtPoint({
        branchId: branchResult.nodeId,
        pointIndex: 0,
      })
    })

    expect(compute).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'Map',
      normalFormType: 'BranchPoint',
      mapIterations: 3,
    }))
    const stored = getContext().state.system?.branches[branchResult.nodeId]
      ?.data.points[0].normal_form
    expect(stored?.normal_form).toEqual(expect.objectContaining({
      type: 'BranchPoint',
      kind: 'Fold',
      quadratic_coefficient: -1,
    }))
  })
})
