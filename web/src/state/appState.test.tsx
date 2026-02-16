import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AppProvider } from './appState'
import { useAppContext } from './appContext'
import { MockForkCoreClient } from '../compute/mockClient'
import { MemorySystemStore } from '../system/store'
import { addBranch, addObject, addScene, createSystem } from '../system/model'
import { createPeriodDoublingSystem } from '../system/fixtures'
import { normalizeBranchEigenvalues } from '../system/continuation'
import { buildSubsystemSnapshot } from '../system/subsystemGateway'
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

  it('continues from orbit for map systems', async () => {
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
      expect(state.error).toBeNull()
      expect(capturedSystemType).toBe('map')
      const lcId = findObjectIdByName(state.system!, 'LC_Map')
      expect(state.system!.objects[lcId].type).toBe('limit_cycle')
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
        ncol: 4,
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

  it('creates an isochrone branch from a selected limit-cycle point', async () => {
    const base = createSystem({
      name: 'Isochrone_From_Point',
      config: {
        name: 'Isochrone_From_Point',
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
    client.runIsochroneCurveContinuation = async (request) => {
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
      await getContext().actions.createIsochroneCurveFromPoint({
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
      expect(created.branchType).toBe('isochrone_curve')
      expect(created.parentObject).toBe('LC_Iso')
      expect(created.data.branch_type).toMatchObject({
        type: 'IsochroneCurve',
        param1_name: 'nu',
        param2_name: 'mu',
      })
      expect(created.data.points[0]?.state.at(-1)).toBeCloseTo(6, 12)
    })
  })

  it('creates an isochrone branch from a selected isochrone point', async () => {
    const base = createSystem({
      name: 'Isochrone_From_Isochrone_Point',
      config: {
        name: 'Isochrone_From_Isochrone_Point',
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
      branchType: 'isochrone_curve',
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
          type: 'IsochroneCurve',
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
      | Parameters<NonNullable<MockForkCoreClient['runIsochroneCurveContinuation']>>[0]
      | null = null
    client.runIsochroneCurveContinuation = async (request) => {
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
      await getContext().actions.createIsochroneCurveFromPoint({
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
      expect(created.branchType).toBe('isochrone_curve')
      expect(created.data.branch_type).toMatchObject({
        type: 'IsochroneCurve',
        param1_name: 'kappa',
        param2_name: 'mu',
      })
    })
  })

  it('uses negative logical indices for backward isochrone continuation', async () => {
    const base = createSystem({
      name: 'Isochrone_Backward_Indices',
      config: {
        name: 'Isochrone_Backward_Indices',
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
    client.runIsochroneCurveContinuation = async (request) => ({
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
      await getContext().actions.createIsochroneCurveFromPoint({
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
      expect(created.branchType).toBe('isochrone_curve')
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
    client.runHopfCurveContinuation = async (request) => ({
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
    })
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
        ncol: 4,
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
        ncol: 4,
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

  it('creates a homoclinic branch from a limit-cycle branch point', async () => {
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
    client.runHomoclinicFromLargeCycle = async () =>
      normalizeBranchEigenvalues({
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
          ntst: 8,
          ncol: 2,
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
      expect(created.data.indices).toEqual([0, 1])
      expect(created.data.resume_state?.min_index_seed?.endpoint_index).toBe(0)
      expect(created.data.resume_state?.min_index_seed?.step_size).toBe(0.01)
      expect(created.data.resume_state?.max_index_seed?.endpoint_index).toBe(1)
      expect(created.data.resume_state?.max_index_seed?.step_size).toBe(0.02)
    })
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
        freeEps1: true,
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
        freeEps1: true,
        settings: continuationSettings,
        forward: true,
      })
    })

    expect(homocSpy).not.toHaveBeenCalled()
    expect(getContext().state.error).toContain('missing fixed time metadata')
  })
})
