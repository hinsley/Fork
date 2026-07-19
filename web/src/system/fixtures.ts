import { addBranch, addObject, addScene, createSystem } from './model'
import { nowIso } from '../utils/determinism'
import { normalizeBranchEigenvalues } from './continuation'
import { MockForkCoreClient } from '../compute/mockClient'
import type {
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  ContinuationProgress,
  HomoclinicContinuationResult,
  HomoclinicFromLargeCycleRequest,
} from '../compute/ForkCoreClient'
import type {
  ContinuationObject,
  ContinuationPoint,
  ContinuationSettings,
  HomoclinicEventDiagnostics,
  LimitCycleObject,
  OrbitObject,
  System,
} from './types'

export const HOMOCLINIC_PRODUCT_E2E_FIXTURE = 'homoclinic-product'
export const HOMOCLINIC_PRODUCT_E2E_SYSTEM_NAME = 'Homoclinic_Product_E2E'
export const CODIM2_GH_E2E_FIXTURE = 'codim2-generalized-hopf'

function homoclinicFixtureDiagnostics(
  primary: 'NNS' | 'NSF'
): HomoclinicEventDiagnostics {
  const neutralSaddle = primary === 'NNS'
  return {
    stable_dimension: 1,
    unstable_dimension: 1,
    discarded_eigenvalues: 0,
    events: [
      {
        kind: primary,
        name: neutralSaddle ? 'Neutral saddle' : 'Neutral saddle-focus',
        value: neutralSaddle ? -0.125 : 0.03125,
        status: 'available',
        reason: null,
      },
      {
        kind: neutralSaddle ? 'IFU' : 'IFS',
        name: neutralSaddle
          ? 'Inclination flip (unstable manifold)'
          : 'Inclination flip (stable manifold)',
        value: null,
        status: 'unsupported',
        reason: 'adjoint continuation is unavailable',
      },
    ],
  }
}

/**
 * Deterministic UI-only client for the homoclinic Playwright fixture.
 *
 * The real numerical boundary remains the analytic Duffing Node-WASM smoke in
 * `cli/tests/wasm-smoke.ts`. This client exists only behind the explicit
 * `?fixture=homoclinic-product` URL and makes browser persistence, rendering,
 * extension, and diagnostic presentation reproducible.
 */
export class HomoclinicProductE2EClient extends MockForkCoreClient {
  override async runHomoclinicFromLargeCycle(
    request: HomoclinicFromLargeCycleRequest,
    opts?: {
      signal?: AbortSignal
      onProgress?: (progress: ContinuationProgress) => void
    }
  ): Promise<HomoclinicContinuationResult> {
    const branch = await super.runHomoclinicFromLargeCycle(request, opts)
    const param2Index = request.system.paramNames.indexOf(request.param2Name)
    const param2Value = param2Index >= 0 ? request.system.params[param2Index] ?? 0 : 0
    branch.points = branch.points.map((point, index) => ({
      ...point,
      param2_value: param2Value,
      ...(index === branch.points.length - 1
        ? {
            stability: 'HomoclinicNeutralSaddle',
            homoclinic_events: homoclinicFixtureDiagnostics('NNS'),
          }
        : {}),
    }))
    branch.bifurcations = branch.points.length > 0 ? [branch.points.length - 1] : []
    branch.homoc_context = {
      base_params: [...request.system.params],
      param1_index: request.system.paramNames.indexOf(request.parameterName),
      param2_index: param2Index,
      basis: {
        stable_q: [1, 0, 0, 1],
        unstable_q: [1, 0, 0, 1],
        dim: 2,
        nneg: 1,
        npos: 1,
      },
      fixed_time: 1,
      fixed_eps0: 0.01,
      fixed_eps1: 0.01,
      projector_refresh_interval: 2,
    }
    return branch
  }

  override async runContinuationExtension(
    request: ContinuationExtensionRequest,
    opts?: {
      signal?: AbortSignal
      onProgress?: (progress: ContinuationProgress) => void
    }
  ): Promise<ContinuationExtensionResult> {
    if (opts?.signal?.aborted) {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    }

    const branch = normalizeBranchEigenvalues(structuredClone(request.branchData))
    const endpoint = request.forward ? branch.points.at(-1) : branch.points[0]
    if (!endpoint) return branch

    opts?.onProgress?.({
      done: false,
      current_step: 0,
      max_steps: request.settings.max_steps,
      points_computed: branch.points.length,
      bifurcations_found: branch.bifurcations.length,
      current_param: endpoint.param_value,
    })

    const step = Math.abs(request.settings.step_size || 0.01)
    const nextPoint: ContinuationPoint = {
      ...endpoint,
      state: endpoint.state.map((value, index) => (index === 0 ? value + 0.1 : value)),
      param_value: endpoint.param_value + (request.forward ? step : -step),
      stability: 'HomoclinicNeutralSaddleFocus',
      homoclinic_events: homoclinicFixtureDiagnostics('NSF'),
    }
    const nextLogicalIndex = request.forward
      ? Math.max(...branch.indices, -1) + 1
      : Math.min(...branch.indices, 1) - 1
    if (request.forward) {
      const nextArrayIndex = branch.points.length
      branch.points.push(nextPoint)
      branch.indices.push(nextLogicalIndex)
      branch.bifurcations.push(nextArrayIndex)
    } else {
      branch.points.unshift(nextPoint)
      branch.indices.unshift(nextLogicalIndex)
      branch.bifurcations = [0, ...branch.bifurcations.map((index) => index + 1)]
    }

    opts?.onProgress?.({
      done: true,
      current_step: 1,
      max_steps: request.settings.max_steps,
      points_computed: branch.points.length,
      bifurcations_found: branch.bifurcations.length,
      current_param: nextPoint.param_value,
    })
    return branch
  }
}

export function createDemoSystem(): {
  system: System
  objectNodeId: string
  branchNodeId: string
} {
  let system = createSystem({ name: 'Demo_System' })
  const defaultSettings: ContinuationSettings = {
    step_size: 0.01,
    min_step_size: 1e-5,
    max_step_size: 0.1,
    max_steps: 100,
    corrector_steps: 4,
    corrector_tolerance: 1e-6,
    step_tolerance: 1e-6,
  }

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit A',
    systemName: system.config.name,
    data: [
      [0, 0, 1],
      [0.1, 0.1, 0.99],
      [0.2, 0.2, 0.96],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
    parameters: [],
  }

  const result = addObject(system, orbit)
  system = result.system

  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'eq_branch',
    systemName: system.config.name,
    parameterName: 'p1',
    parentObject: orbit.name,
    startObject: orbit.name,
    branchType: 'equilibrium',
    data: {
      points: [
        {
          state: [0, 0],
          param_value: 0,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [],
      indices: [0],
    },
    settings: defaultSettings,
    timestamp: nowIso(),
    params: [],
  }

  const branchResult = addBranch(system, branch, result.nodeId)
  system = branchResult.system

  return {
    system,
    objectNodeId: result.nodeId,
    branchNodeId: branchResult.nodeId,
  }
}

/**
 * Analytic generalized-Hopf source data for the real-WASM LPC switch test.
 * The fixture removes equilibrium and Hopf-curve construction from browser
 * setup while leaving the WASM predictor, corrector, and LPC continuation real.
 */
export function createCodim2GeneralizedHopfE2ESystem(): { system: System } {
  const config = {
    name: 'Codim2_Switch_E2E',
    equations: [
      'mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2',
      'x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2',
    ],
    params: [0, 0],
    paramNames: ['mu', 'beta'],
    varNames: ['x', 'y'],
    solver: 'rk4',
    type: 'flow' as const,
  }
  const base = createSystem({ name: config.name, config })
  const equilibrium = addObject(base, {
    type: 'equilibrium',
    name: 'Equilibrium_GH',
    systemName: config.name,
    parameters: [...config.params],
  })
  const codim2: NonNullable<ContinuationPoint['codim2']> = {
    type: 'GeneralizedHopf',
    refined: true,
    candidate: false,
    test_function: 'first_lyapunov_coefficient',
    test_function_value: 0,
    residual_norm: 0,
    iterations: 0,
    tolerance: 1e-10,
    source_segment: [0, 1],
    source_test_values: [-0.002, 0.002],
    method: 'analytic_fixture',
    coefficients: [
      { name: 'l1', value: 0 },
      { name: 'l2', value: 1 },
    ],
    conditioning: {},
    certification: {
      defining_conditions_verified: true,
      nondegeneracy_evaluated: true,
      nondegenerate: true,
      reason: 'Analytic radial generalized-Hopf normal form.',
    },
  }
  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'hopf_codim2_fixture',
    systemName: config.name,
    parameterName: 'mu, beta',
    parentObject: 'Equilibrium_GH',
    startObject: 'Equilibrium_GH',
    branchType: 'hopf_curve',
    data: {
      points: [
        {
          state: [0, 0],
          param_value: 0,
          param2_value: -0.002,
          stability: 'None',
          eigenvalues: [{ re: 0, im: 1 }, { re: 0, im: -1 }],
          auxiliary: 1,
        },
        {
          state: [0, 0],
          param_value: 0,
          param2_value: 0,
          stability: 'GeneralizedHopf',
          eigenvalues: [{ re: 0, im: 1 }, { re: 0, im: -1 }],
          auxiliary: 1,
          codim2,
        },
      ],
      bifurcations: [1],
      indices: [0, 1],
      branch_type: {
        type: 'HopfCurve',
        param1_name: 'mu',
        param2_name: 'beta',
      },
    },
    settings: {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 50,
      corrector_steps: 10,
      corrector_tolerance: 1e-8,
      step_tolerance: 1e-8,
    },
    timestamp: nowIso(),
    params: [...config.params],
  }
  return { system: addBranch(equilibrium.system, branch, equilibrium.nodeId).system }
}

export function createPeriodDoublingSystem(): { system: System } {
  let system = createSystem({
    name: 'Period_Doubling_Fixture',
    config: {
      name: 'Period_Doubling_Fixture',
      equations: ['y', '-x'],
      params: [0.2],
      paramNames: ['mu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const ntst = 4
  const ncol = 2
  const period = 6
  const buildLimitCycleState = (radius: number) => {
    const state: number[] = []
    // Standard continuation storage is mesh-first with an implicit periodic
    // closure, followed by every collocation stage and the period.
    for (let interval = 0; interval < ntst; interval += 1) {
      const theta = (interval / ntst) * Math.PI * 2
      state.push(radius * Math.cos(theta), radius * Math.sin(theta))
    }
    for (let interval = 0; interval < ntst; interval += 1) {
      for (let stage = 0; stage < ncol; stage += 1) {
        const fraction = (stage + 1) / (ncol + 1)
        const theta = ((interval + fraction) / ntst) * Math.PI * 2
        state.push(radius * Math.cos(theta), radius * Math.sin(theta))
      }
    }
    state.push(period)
    return state
  }
  const baseState = buildLimitCycleState(1)
  const pdState = buildLimitCycleState(1.25)

  const limitCycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'LC_PD',
    systemName: system.config.name,
    origin: { type: 'orbit', orbitName: 'Orbit PD' },
    ntst,
    ncol,
    period,
    state: baseState,
    parameters: [...system.config.params],
    parameterName: 'mu',
    paramValue: 0.2,
    createdAt: nowIso(),
  }

  const added = addObject(system, limitCycle)
  system = added.system

  const branch: ContinuationObject = {
    type: 'continuation',
    name: 'lc_pd_mu',
    systemName: system.config.name,
    parameterName: 'mu',
    parentObject: limitCycle.name,
    startObject: limitCycle.name,
    branchType: 'limit_cycle',
    data: {
      points: [
        {
          state: baseState,
          param_value: 0.2,
          stability: 'None',
          eigenvalues: [],
        },
        {
          state: pdState,
          param_value: 0.25,
          stability: 'PeriodDoubling',
          eigenvalues: [{ re: -1, im: 0 }],
        },
      ],
      bifurcations: [1],
      indices: [0, 1],
      branch_type: { type: 'LimitCycle', ntst, ncol },
    },
    settings: {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 50,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: nowIso(),
    params: [...system.config.params],
  }

  const branchResult = addBranch(system, branch, added.nodeId)
  system = branchResult.system

  return { system }
}

export function createLimitCycleManifoldSystem(): { system: System } {
  let system = createSystem({
    name: 'Limit_Cycle_Manifold_Fixture',
    config: {
      name: 'Limit_Cycle_Manifold_Fixture',
      equations: ['-y', 'x', 'lambda*z'],
      params: [0.2],
      paramNames: ['lambda'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const ntst = 4
  const ncol = 2
  const period = Math.PI * 2
  const state: number[] = []
  for (let i = 0; i < ntst; i += 1) {
    const theta = (i / ntst) * Math.PI * 2
    state.push(Math.cos(theta), Math.sin(theta), 0)
  }
  for (let interval = 0; interval < ntst; interval += 1) {
    for (let stage = 0; stage < ncol; stage += 1) {
      const frac = (stage + 1) / (ncol + 1)
      const theta = ((interval + frac) / ntst) * Math.PI * 2
      state.push(Math.cos(theta), Math.sin(theta), 0)
    }
  }
  state.push(period)

  const limitCycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'LC_3D',
    systemName: system.config.name,
    origin: { type: 'orbit', orbitName: 'Orbit LC' },
    ntst,
    ncol,
    period,
    state,
    parameters: [...system.config.params],
    parameterName: 'lambda',
    paramValue: 0.2,
    floquetMultipliers: [
      { re: Math.exp(0.2 * period), im: 0 },
      { re: 1, im: 0 },
    ],
    createdAt: nowIso(),
  }

  const added = addObject(system, limitCycle)
  system = added.system
  return { system }
}

/** Seed-only half of the deterministic homoclinic product E2E fixture. */
export function createHomoclinicProductE2ESystem(): { system: System } {
  let system = createSystem({
    name: HOMOCLINIC_PRODUCT_E2E_SYSTEM_NAME,
    config: {
      name: HOMOCLINIC_PRODUCT_E2E_SYSTEM_NAME,
      equations: ['y', 'x-x^3+(mu-nu)*y'],
      params: [0, 0],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const ntst = 4
  const ncol = 2
  const period = 12
  const normalizedMesh = Array.from({ length: ntst + 1 }, (_, index) => index / ntst)
  const state: number[] = []
  for (let interval = 0; interval < ntst; interval += 1) {
    const theta = (interval / ntst) * Math.PI * 2
    state.push(1.35 * Math.cos(theta), 1.35 * Math.sin(theta))
  }
  for (let interval = 0; interval < ntst; interval += 1) {
    for (let stage = 0; stage < ncol; stage += 1) {
      const fraction = (stage + 1) / (ncol + 1)
      const theta = ((interval + fraction) / ntst) * Math.PI * 2
      state.push(1.35 * Math.cos(theta), 1.35 * Math.sin(theta))
    }
  }
  state.push(period)

  const cycle: LimitCycleObject = {
    type: 'limit_cycle',
    name: 'Duffing_Large_Cycle',
    systemName: system.config.name,
    origin: { type: 'orbit', orbitName: 'Duffing_Seed' },
    ntst,
    ncol,
    period,
    state,
    parameters: [...system.config.params],
    parameterName: 'mu',
    paramValue: 0,
    createdAt: nowIso(),
  }
  const cycleResult = addObject(system, cycle)
  system = cycleResult.system

  const settings: ContinuationSettings = {
    step_size: 0.001,
    min_step_size: 1e-7,
    max_step_size: 0.01,
    max_steps: 3,
    corrector_steps: 16,
    corrector_tolerance: 1e-9,
    step_tolerance: 1e-9,
  }
  const sourceBranch: ContinuationObject = {
    type: 'continuation',
    name: 'duffing_large_cycle',
    systemName: system.config.name,
    parameterName: 'mu',
    parentObject: cycle.name,
    startObject: cycle.name,
    branchType: 'limit_cycle',
    data: {
      points: [
        {
          state,
          param_value: 0,
          stability: 'None',
          eigenvalues: [],
        },
      ],
      bifurcations: [],
      indices: [0],
      branch_type: {
        type: 'LimitCycle',
        ntst,
        ncol,
        normalized_mesh: normalizedMesh,
      },
    },
    settings,
    timestamp: nowIso(),
    params: [...system.config.params],
  }
  system = addBranch(system, sourceBranch, cycleResult.nodeId).system
  system = addScene(system, 'Homoclinic Scene').system
  return { system }
}

export function createAxisPickerSystem(): { system: System } {
  let system = createSystem({
    name: 'Axis_Picker_Fixture',
    config: {
      name: 'Axis_Picker_Fixture',
      equations: ['y', '-x', 'w', 'x - z'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'rk4',
      type: 'flow',
    },
  })

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit Axes',
    systemName: system.config.name,
    data: [
      [0, 0, 1, 2, 3],
      [0.1, 0.2, 1.1, 2.1, 3.1],
      [0.2, 0.4, 1.2, 2.2, 3.2],
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1,
  }

  const added = addObject(system, orbit)
  system = added.system
  system = addScene(system, 'Scene A').system
  system = addScene(system, 'Scene B').system
  return { system }
}

export function createAxisPickerMapSystem(): { system: System } {
  let system = createSystem({
    name: 'Axis_Picker_Map_Fixture',
    config: {
      name: 'Axis_Picker_Map_Fixture',
      equations: ['x + y', 'y + z', 'z + w', 'w + x'],
      params: [],
      paramNames: [],
      varNames: ['x', 'y', 'z', 'w'],
      solver: 'discrete',
      type: 'map',
    },
  })

  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit Map Axes',
    systemName: system.config.name,
    data: [
      [0, 0, 1, 2, 3],
      [1, 0.2, 1.1, 2.1, 3.1],
      [2, 0.35, 1.25, 2.2, 3.25],
      [3, 0.5, 1.4, 2.35, 3.3],
    ],
    t_start: 0,
    t_end: 3,
    dt: 1,
    parameters: [],
  }

  const added = addObject(system, orbit)
  system = added.system
  system = addScene(system, 'Map Scene A').system
  system = addScene(system, 'Map Scene B').system
  return { system }
}
