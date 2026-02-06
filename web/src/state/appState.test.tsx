import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AppProvider } from './appState'
import { useAppContext } from './appContext'
import { MockForkCoreClient } from '../compute/mockClient'
import { MemorySystemStore } from '../system/store'
import { addBranch, addObject, createSystem } from '../system/model'
import { createPeriodDoublingSystem } from '../system/fixtures'
import { normalizeBranchEigenvalues } from '../system/continuation'
import type {
  ContinuationObject,
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
    const { getContext } = setupApp(branchResult.system)

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
      expect(findBranchIdByName(getContext().state.system!, 'homoc_m1')).toBeTruthy()
      expect(
        getContext().state.system!.branches[
          findBranchIdByName(getContext().state.system!, 'homoc_m1')
        ].branchType
      ).toBe('homoclinic_curve')
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
      expect(findBranchIdByName(getContext().state.system!, 'homoc_m2')).toBeTruthy()
      expect(
        getContext().state.system!.branches[
          findBranchIdByName(getContext().state.system!, 'homoc_m2')
        ].branchType
      ).toBe('homoclinic_curve')
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
})
