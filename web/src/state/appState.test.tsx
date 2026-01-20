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
