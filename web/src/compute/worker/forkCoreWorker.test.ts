import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemConfig } from '../../system/types'

type WorkerScope = {
  postMessage: ReturnType<typeof vi.fn>
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null
}

const workerScope: WorkerScope = {
  postMessage: vi.fn(),
  onmessage: null,
}

const wasmState = {
  throwMode: 'none' as 'none' | 'validate' | 'abort',
  useCamelCaseIsoclineMethod: false,
  disableHomoclinicLargeCycleInit: false,
  disableHomoclinicShootingInit: false,
  disableHomoclinicShootingRunner: false,
  homoclinicLargeCycleInitCalls: 0,
  homoclinicLargeCycleMesh: null as number[] | null,
  homoclinicRestartSourceMesh: null as number[] | null,
  homoclinicShootingInitArgs: null as null | { intervals: number; steps: number },
  homoclinicShootingRestartArgs: null as null | {
    sourceIntervals: number
    targetIntervals: number
    steps: number
  },
  lastHomoclinicRunner: null as null | 'collocation' | 'shooting',
  disableIsoperiodicRunner: false,
  isoperiodicFallbackCalls: 0,
  lastRunStepsArg: null as number | null,
  lastSystemType: null as string | null,
  lastLimitCycleRunnerSystemType: null as string | null,
  lastCycleCurveRunner: null as string | null,
  lastCycleCurveInitialK: null as number | null,
  lastFloquetMesh: null as number[] | null,
  lastFloquetBackend: null as string | null,
  lastPdMesh: null as number[] | null,
  lastNsSeedState: null as number[] | null,
  lastEqManifoldPeriods: null as number[] | null,
  lastEqManifoldExtensionPeriods: null as number[] | null,
  lastEqManifoldExtensionPointCount: null as number | null,
  lastManifold2DExtensionPointCount: null as number | null,
  initPromise: Promise.resolve() as Promise<void>,
  initResolver: null as null | (() => void),
}

const baseSystem: SystemConfig = {
  name: 'Test System',
  equations: ['x'],
  params: [],
  paramNames: [],
  varNames: ['x'],
  solver: 'rk4',
  type: 'flow',
}

const continuationSettings = {
  step_size: 0.01,
  min_step_size: 0.001,
  max_step_size: 0.1,
  max_steps: 100,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
}

function requireHandler() {
  if (!workerScope.onmessage) {
    throw new Error('Worker handler not initialized')
  }
  return workerScope.onmessage
}

beforeAll(async () => {
  vi.stubGlobal('self', workerScope)
  vi.doMock('@fork-wasm', () => {
    class MockWasmSystem {
      private state = new Float64Array([0])
      private t = 0

      constructor(...args: unknown[]) {
        const systemType = args[5]
        wasmState.lastSystemType = typeof systemType === 'string' ? systemType : null
        const equations = (args[0] as string[]) ?? []
        if (wasmState.useCamelCaseIsoclineMethod) {
          ;(
            this as {
              compute_isocline?: unknown
              computeIsocline?: () => {
                geometry: string
                dim: number
                points: number[]
                segments: number[]
              }
            }
          ).compute_isocline = undefined
        }
        if (wasmState.throwMode === 'abort') {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        if (wasmState.disableHomoclinicLargeCycleInit) {
          ;(this as { init_homoclinic_from_large_cycle?: unknown }).init_homoclinic_from_large_cycle =
            undefined
        }
        if (wasmState.disableHomoclinicShootingInit) {
          ;(
            this as { init_homoclinic_shooting_from_collocation?: unknown }
          ).init_homoclinic_shooting_from_collocation = undefined
        }
        if (wasmState.throwMode !== 'validate') return
        if (equations.length > 1) {
          throw new Error('full system failed')
        }
        if (equations[0]?.includes('bad')) {
          throw new Error('bad equation')
        }
      }
      set_periods() {}
      set_state(state: Float64Array) {
        this.state = new Float64Array(state)
      }
      get_state() {
        return this.state
      }
      set_t(t: number) {
        this.t = t
      }
      get_t() {
        return this.t
      }
      step(dt = 1) {
        this.t += dt
        this.state = new Float64Array(Array.from(this.state, (value) => value + dt))
      }
      solve_equilibrium() {
        return {
          state: [1],
          residual_norm: 0.1,
          iterations: 2,
          jacobian: [],
          eigenpairs: [],
        }
      }
      compute_lyapunov_exponents() {
        return new Float64Array([1, 2, 3])
      }
      compute_covariant_lyapunov_vectors() {
        return { dimension: 2, checkpoints: 1, times: [0], vectors: [] }
      }
      compute_isocline() {
        return {
          geometry: 'segments',
          dim: 2,
          points: [0, 0, 1, 1],
          segments: [0, 1],
        }
      }
      computeIsocline() {
        return {
          geometry: 'segments',
          dim: 2,
          points: [0, 0, 1, 1],
          segments: [0, 1],
        }
      }
      init_lc_from_hopf() {
        return {}
      }
      init_lc_from_orbit() {
        return {}
      }
      init_lc_from_pd() {
        return {}
      }
      init_lc_from_pd_on_mesh(...args: unknown[]) {
        wasmState.lastPdMesh = Array.from(args[4] as Float64Array)
        return {}
      }
      compute_limit_cycle_floquet_modes_on_mesh(...args: unknown[]) {
        wasmState.lastFloquetMesh = Array.from(args[2] as Float64Array)
        return {
          ntst: 2,
          ncol: 2,
          multipliers: [{ re: 1, im: 0 }],
          vectors: [],
        }
      }
      compute_limit_cycle_floquet_modes_on_mesh_with_backend(...args: unknown[]) {
        wasmState.lastFloquetMesh = Array.from(args[2] as Float64Array)
        wasmState.lastFloquetBackend = args[4] as string
        return {
          ntst: 2,
          ncol: 2,
          backend: args[4] === 'block_cyclic' ? 'block_cyclic' : 'periodic_schur',
          multipliers: [{ re: 1, im: 0 }],
          vectors: [],
        }
      }
      switch_from_hopf_hopf() {
        return {
          normalForm: { frequency1: 1, frequency2: 2 },
          equilibriumCurveSeeds: [],
          hopfCurveSeeds: [],
          neimarkSackerSeeds: [
            {
              target: 'NeimarkSacker',
              state: [1],
              param1_value: 0.1,
              param2_value: 0.2,
              perturbation: 0.01,
              auxiliary: 0.25,
              period: 6,
              ntst: 2,
              ncol: 2,
            },
            {
              target: 'NeimarkSacker',
              state: [-2],
              param1_value: -0.1,
              param2_value: -0.2,
              perturbation: -0.01,
              auxiliary: 0.5,
              period: 3,
              ntst: 2,
              ncol: 2,
            },
          ],
        }
      }
      init_homoclinic_from_large_cycle() {
        wasmState.homoclinicLargeCycleInitCalls += 1
        return { discretization: 'collocation' }
      }
      init_homoclinic_from_large_cycle_on_mesh(...args: unknown[]) {
        wasmState.homoclinicLargeCycleInitCalls += 1
        wasmState.homoclinicLargeCycleMesh = Array.from(args[2] as Float64Array)
        return { discretization: 'collocation' }
      }
      init_homoclinic_shooting_from_collocation(
        _setup: unknown,
        intervals: number,
        steps: number
      ) {
        wasmState.homoclinicShootingInitArgs = { intervals, steps }
        return { discretization: 'shooting', intervals, steps }
      }
      init_homoclinic_from_homoclinic() {
        return {}
      }
      init_homoclinic_from_homoclinic_on_mesh(...args: unknown[]) {
        wasmState.homoclinicRestartSourceMesh = Array.from(args[2] as Float64Array)
        return {}
      }
      init_homoclinic_shooting_from_shooting(...args: unknown[]) {
        wasmState.homoclinicShootingRestartArgs = {
          sourceIntervals: args[1] as number,
          targetIntervals: args[10] as number,
          steps: args[11] as number,
        }
        return { discretization: 'shooting' }
      }
      init_homotopy_saddle_from_equilibrium() {
        return {}
      }
      init_homoclinic_from_homotopy_saddle() {
        return {}
      }
      continue_isoperiodic_curve() {
        wasmState.isoperiodicFallbackCalls += 1
        return {
          curve_type: 'Isoperiodic',
          param1_index: 0,
          param2_index: 1,
          points: [],
          codim2_bifurcations: [],
          indices: [],
        }
      }
      extend_manifold_2d_with_progress(
        branch: Record<string, unknown>,
        _settings: Record<string, unknown>,
        onProgress: (progress: Record<string, unknown>) => void
      ) {
        const points = (branch.points as unknown[]) ?? []
        wasmState.lastManifold2DExtensionPointCount = points.length
        onProgress({
          done: false,
          current_step: 0,
          max_steps: 1,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: 0,
          rings_computed: 0,
        })
        onProgress({
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: 8,
          bifurcations_found: 0,
          current_param: 1,
          rings_computed: 1,
        })
        return branch
      }
    }

    class MockWasmEquilibriumRunner {
      private progress = {
        done: false,
        current_step: 0,
        max_steps: 100,
        points_computed: 0,
        bifurcations_found: 0,
        current_param: 0,
      }

      run_steps(batchSize: number) {
        wasmState.lastRunStepsArg = batchSize
        this.progress = {
          ...this.progress,
          done: true,
          current_step: this.progress.max_steps,
          points_computed: 1,
        }
        return this.progress
      }
      get_progress() {
        return this.progress
      }
      get_result() {
        return { points: [], bifurcations: [], indices: [] }
      }
    }

    type MockRunnerPoint = {
      state: number[]
      param_value: number
      stability: string
      eigenvalues: unknown[]
    }

    type MockRunnerResult = {
      points: MockRunnerPoint[]
      bifurcations?: number[]
      indices?: number[]
      branch_type?: { type: string; [key: string]: unknown }
      homoc_context?: {
        base_params: number[]
        param1_index: number
        param2_index: number
        fixed_time: number
        fixed_eps0: number
        fixed_eps1: number
        basis: {
          stable_q: number[]
          unstable_q: number[]
          dim: number
          nneg: number
          npos: number
        }
      }
      resume_state?: {
        min_index_seed?: {
          endpoint_index: number
          aug_state: number[]
          tangent: number[]
          step_size: number
        }
        max_index_seed?: {
          endpoint_index: number
          aug_state: number[]
          tangent: number[]
          step_size: number
        }
      }
    }

    class MockContinuationRunner {
      private progress = {
        done: true,
        current_step: 0,
        max_steps: 1,
        points_computed: 0,
        bifurcations_found: 0,
        current_param: 0,
      }

      run_steps() {
        return this.progress
      }
      get_progress() {
        return this.progress
      }
      get_result(): MockRunnerResult {
        return { points: [] }
      }
    }

    class MockLPCCurveRunner extends MockContinuationRunner {
      constructor() {
        super()
        wasmState.lastCycleCurveRunner = 'LimitPointCycle'
      }
    }

    class MockPDCurveRunner extends MockContinuationRunner {
      constructor() {
        super()
        wasmState.lastCycleCurveRunner = 'PeriodDoubling'
      }
    }

    class MockNSCurveRunner extends MockContinuationRunner {
      constructor(...args: unknown[]) {
        super()
        wasmState.lastCycleCurveRunner = 'NeimarkSacker'
        wasmState.lastCycleCurveInitialK = args[10] as number
        wasmState.lastNsSeedState = Array.from(args[4] as Float64Array)
      }
    }

    class MockEqManifold1DRunner {
      private progress = {
        done: false,
        current_step: 0,
        max_steps: 2,
        points_computed: 0,
        bifurcations_found: 0,
        current_param: 0,
      }

      constructor(...args: unknown[]) {
        wasmState.lastEqManifoldPeriods = Array.from(args[8] as Float64Array)
      }

      run_steps() {
        this.progress = {
          ...this.progress,
          done: true,
          current_step: 2,
          points_computed: 2,
        }
        return this.progress
      }

      get_progress() {
        return this.progress
      }

      get_result() {
        return []
      }
    }

    class MockEqManifold1DExtensionRunner {
      private readonly branch: Record<string, unknown>
      private progress = {
        done: false,
        current_step: 0,
        max_steps: 2,
        points_computed: 0,
        bifurcations_found: 0,
        current_param: 0,
      }

      constructor(...args: unknown[]) {
        this.branch = args[6] as Record<string, unknown>
        const points = (this.branch.points as unknown[]) ?? []
        wasmState.lastEqManifoldExtensionPointCount = points.length
        wasmState.lastEqManifoldExtensionPeriods = Array.from(args[8] as Float64Array)
      }

      run_steps() {
        this.progress = {
          ...this.progress,
          done: true,
          current_step: 2,
          points_computed: 1,
        }
        return this.progress
      }

      get_progress() {
        return this.progress
      }

      get_result() {
        return this.branch
      }
    }

    class MockManifold2DExtensionRunner {
      private readonly branch: Record<string, unknown>
      private readonly progress = {
        done: true,
        current_step: 1,
        max_steps: 1,
        points_computed: 8,
        bifurcations_found: 0,
        current_param: 1,
        rings_computed: 1,
      }

      constructor(...args: unknown[]) {
        this.branch = args[5] as Record<string, unknown>
        const points = (this.branch.points as unknown[]) ?? []
        wasmState.lastManifold2DExtensionPointCount = points.length
      }

      run_steps() {
        return this.progress
      }

      get_progress() {
        return this.progress
      }

      get_result() {
        return this.branch
      }
    }

    class MockHomoclinicRunner extends MockContinuationRunner {
      constructor() {
        super()
        wasmState.lastHomoclinicRunner = 'collocation'
      }

      override get_result(): MockRunnerResult {
        return {
          points: [
            {
              state: [0, 0],
              param_value: 0.1,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: [1, 1],
              param_value: 0.2,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: [2, 2],
              param_value: 0.3,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [0, 1, 2],
          indices: [10, 11, 12],
          branch_type: { type: 'HomoclinicCurve' },
          homoc_context: {
            base_params: [0.1, 0.2],
            param1_index: 0,
            param2_index: 1,
            fixed_time: 1.0,
            fixed_eps0: 0.01,
            fixed_eps1: 0.02,
            basis: {
              stable_q: [1, 0, 0, 1],
              unstable_q: [1, 0, 0, 1],
              dim: 2,
              nneg: 1,
              npos: 1,
            },
          },
          resume_state: {
            max_index_seed: {
              endpoint_index: 12,
              aug_state: [0.3, 2, 2],
              tangent: [1, 0, 0],
              step_size: 0.01,
            },
          },
        }
      }
    }

    class MockHomoclinicShootingRunner extends MockHomoclinicRunner {
      constructor() {
        super()
        wasmState.lastHomoclinicRunner = 'shooting'
      }

      override get_result(): MockRunnerResult {
        return {
          ...super.get_result(),
          branch_type: {
            type: 'HomoclinicCurve',
            ntst: 6,
            ncol: 0,
            param1_name: 'mu',
            param2_name: 'nu',
            free_time: true,
            free_eps0: true,
            free_eps1: false,
            discretization: { type: 'shooting', integration_steps_per_segment: 96 },
          },
        }
      }
    }

    class MockLimitCycleRunner extends MockContinuationRunner {
      constructor(...args: unknown[]) {
        super()
        const systemType = args[4]
        wasmState.lastLimitCycleRunnerSystemType =
          typeof systemType === 'string' ? systemType : null
      }
    }

    return {
      default: vi.fn(() => wasmState.initPromise ?? Promise.resolve()),
      WasmSystem: MockWasmSystem,
      WasmEquilibriumRunner: MockWasmEquilibriumRunner,
      WasmEqManifold1DRunner: MockEqManifold1DRunner,
      WasmEqManifold1DExtensionRunner: MockEqManifold1DExtensionRunner,
      WasmManifold2DExtensionRunner: MockManifold2DExtensionRunner,
      WasmFoldCurveRunner: MockContinuationRunner,
      WasmHopfCurveRunner: MockContinuationRunner,
      WasmLPCCurveRunner: MockLPCCurveRunner,
      WasmPDCurveRunner: MockPDCurveRunner,
      WasmNSCurveRunner: MockNSCurveRunner,
      get WasmIsoperiodicCurveRunner() {
        return wasmState.disableIsoperiodicRunner ? undefined : MockContinuationRunner
      },
      WasmLimitCycleRunner: MockLimitCycleRunner,
      WasmHomoclinicRunner: MockHomoclinicRunner,
      get WasmHomoclinicShootingRunner() {
        return wasmState.disableHomoclinicShootingRunner
          ? undefined
          : MockHomoclinicShootingRunner
      },
      WasmHomotopySaddleRunner: MockContinuationRunner,
      WasmContinuationExtensionRunner: MockContinuationRunner,
      WasmCodim1CurveExtensionRunner: MockContinuationRunner,
    }
  })
  await import('./forkCoreWorker')
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

beforeEach(() => {
  workerScope.postMessage.mockClear()
  wasmState.throwMode = 'none'
  wasmState.useCamelCaseIsoclineMethod = false
  wasmState.disableHomoclinicLargeCycleInit = false
  wasmState.disableHomoclinicShootingInit = false
  wasmState.disableHomoclinicShootingRunner = false
  wasmState.homoclinicLargeCycleInitCalls = 0
  wasmState.homoclinicLargeCycleMesh = null
  wasmState.homoclinicRestartSourceMesh = null
  wasmState.homoclinicShootingInitArgs = null
  wasmState.homoclinicShootingRestartArgs = null
  wasmState.lastHomoclinicRunner = null
  wasmState.disableIsoperiodicRunner = false
  wasmState.isoperiodicFallbackCalls = 0
  wasmState.lastRunStepsArg = null
  wasmState.lastSystemType = null
  wasmState.lastLimitCycleRunnerSystemType = null
  wasmState.lastCycleCurveRunner = null
  wasmState.lastCycleCurveInitialK = null
  wasmState.lastFloquetMesh = null
  wasmState.lastFloquetBackend = null
  wasmState.lastPdMesh = null
  wasmState.lastNsSeedState = null
  wasmState.lastEqManifoldPeriods = null
  wasmState.lastEqManifoldExtensionPeriods = null
  wasmState.lastEqManifoldExtensionPointCount = null
  wasmState.lastManifold2DExtensionPointCount = null
  wasmState.initPromise = Promise.resolve()
  wasmState.initResolver = null
})

describe('forkCoreWorker', () => {
  it('posts progress updates and results for equilibrium continuation', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-1',
      kind: 'runEquilibriumContinuation',
      payload: {
        system: baseSystem,
        equilibriumState: [0],
        parameterName: 'p1',
        settings: continuationSettings,
        forward: true,
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastRunStepsArg).toBe(2)
    expect(workerScope.postMessage).toHaveBeenCalledTimes(3)
    const [first, second, third] = workerScope.postMessage.mock.calls.map(
      ([payload]) => payload as Record<string, unknown>
    )

    expect(first).toMatchObject({
      id: 'job-1',
      kind: 'progress',
      progress: { done: false },
    })
    expect(second).toMatchObject({
      id: 'job-1',
      kind: 'progress',
      progress: { done: true },
    })
    expect(third).toMatchObject({
      id: 'job-1',
      ok: true,
      result: { points: [], bifurcations: [], indices: [] },
    })
  })

  it('runs limit cycle continuation from orbit for map systems', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-lc-orbit-map',
      kind: 'runLimitCycleContinuationFromOrbit',
      payload: {
        system: {
          ...baseSystem,
          type: 'map',
          solver: 'discrete',
          paramNames: ['r'],
          params: [3.2],
        },
        orbitTimes: [0, 1, 2],
        orbitStates: [[0.1], [0.2], [0.1]],
        parameterName: 'r',
        paramValue: 3.2,
        tolerance: 0.1,
        ntst: 10,
        ncol: 4,
        settings: continuationSettings,
        forward: true,
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastSystemType).toBe('map')
    expect(wasmState.lastLimitCycleRunnerSystemType).toBe('map')
    const response = workerScope.postMessage.mock.calls
      .map(([payload]) => payload as { ok?: boolean; result?: { points: unknown[] } })
      .find((payload) => payload.ok === true)
    if (!response) {
      throw new Error('Expected an ok response for limit cycle continuation.')
    }
    expect(response.ok).toBe(true)
    if (!response.result) {
      throw new Error('Expected a continuation result payload.')
    }
    expect(response.result.points).toEqual([])
  })

  it('passes an exact nonuniform mesh to Floquet-mode computation', async () => {
    const handler = requireHandler()
    const normalizedMesh = [0, 0.2, 1]

    await handler({
      data: {
        id: 'job-floquet-exact-mesh',
        kind: 'computeLimitCycleFloquetModes',
        payload: {
          system: { ...baseSystem, params: [0], paramNames: ['mu'] },
          cycleState: [0, 1, 0, 1],
          ntst: 2,
          ncol: 2,
          normalizedMesh,
          parameterName: 'mu',
          backend: 'periodic_schur',
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastFloquetMesh).toEqual(normalizedMesh)
    expect(wasmState.lastFloquetBackend).toBe('periodic_schur')
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-floquet-exact-mesh',
      ok: true,
      result: { ntst: 2, ncol: 2 },
    })
  })

  it('passes an exact nonuniform source mesh to period-doubled cycle initialization', async () => {
    const handler = requireHandler()
    const normalizedMesh = [0, 0.15, 1]

    await handler({
      data: {
        id: 'job-pd-exact-mesh',
        kind: 'runLimitCycleContinuationFromPD',
        payload: {
          system: { ...baseSystem, params: [0], paramNames: ['mu'] },
          lcState: [0, 1, 0, 1],
          parameterName: 'mu',
          paramValue: 0,
          ntst: 2,
          ncol: 2,
          normalizedMesh,
          amplitude: 0.01,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastPdMesh).toEqual(normalizedMesh)
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-pd-exact-mesh',
      ok: true,
    })
  })

  it('rejects a nonuniform mesh instead of silently uniformizing cycle manifolds', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-cycle-manifold-nonuniform',
        kind: 'runLimitCycleManifold2D',
        payload: {
          system: { ...baseSystem, params: [0], paramNames: ['mu'] },
          cycleState: [0, 1, 0, 1],
          ntst: 2,
          ncol: 2,
          normalizedMesh: [0, 0.2, 1],
          floquetMultipliers: [{ re: 2, im: 0 }],
          settings: {},
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-cycle-manifold-nonuniform',
      ok: false,
      error: expect.stringContaining('does not yet support an explicit nonuniform'),
    })
  })

  it('selects the requested Hopf-Hopf NS mode before constructing the curve runner', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-hh-ns-mode-2',
        kind: 'runCodim2BranchSwitch',
        payload: {
          system: { ...baseSystem, params: [0, 0], paramNames: ['mu', 'nu'] },
          sourceType: 'DoubleHopf',
          target: 'NeimarkSacker',
          state: [0],
          param1Name: 'mu',
          param1Value: 0,
          param2Name: 'nu',
          param2Value: 0,
          frequency: 1,
          perturbation: 0.01,
          cycleAmplitude: 0.01,
          mode: 2,
          ntst: 2,
          ncol: 2,
          tolerance: 1e-8,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastNsSeedState).toEqual([-2])
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-hh-ns-mode-2',
      ok: true,
      result: {
        target: 'NeimarkSacker',
        seed: { perturbation: -0.01, state: [-2] },
      },
    })
  })

  it('runs homoclinic and homotopy continuation handlers', async () => {
    const handler = requireHandler()
    const payloadBase = {
      system: {
        ...baseSystem,
        params: [0.2, 0.1],
        paramNames: ['mu', 'nu'],
      },
      settings: continuationSettings,
      forward: true,
    }

    await handler({
      data: {
        id: 'job-h1',
        kind: 'runHomoclinicFromLargeCycle',
        payload: {
          ...payloadBase,
          lcState: [0, 1, 1, 0, 2],
          sourceNtst: 4,
          sourceNcol: 2,
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(
      workerScope.postMessage.mock.calls.some(
        ([payload]) =>
          (payload as { id?: string; ok?: boolean }).id === 'job-h1' &&
          (payload as { id?: string; ok?: boolean }).ok === true
      )
    ).toBe(true)
    const h1Response = workerScope.postMessage.mock.calls
      .map(
        ([payload]) =>
          payload as {
            id?: string
            ok?: boolean
            result?: {
              points?: Array<{ state?: number[]; param_value?: number }>
              indices?: number[]
              bifurcations?: number[]
              upoldp?: number[][]
              resume_state?: {
                min_index_seed?: {
                  endpoint_index?: number
                  step_size?: number
                }
                max_index_seed?: {
                  endpoint_index?: number
                  step_size?: number
                }
              }
              homoc_context?: {
                basis?: {
                  dim?: number
                }
              }
            }
          }
      )
      .find((payload) => payload.id === 'job-h1' && payload.ok === true)
    expect(h1Response?.result?.points?.length).toBe(2)
    expect(h1Response?.result?.indices).toEqual([0, 1])
    expect(h1Response?.result?.bifurcations).toEqual([0, 1])
    expect(h1Response?.result?.upoldp?.length).toBe(1)
    const firstSeed = h1Response?.result?.upoldp?.[0] ?? []
    expect(firstSeed[0]).toBe(0.1)
    expect(firstSeed.slice(1)).toEqual([0, 0])
    expect(h1Response?.result?.resume_state?.min_index_seed?.endpoint_index).toBe(0)
    expect(h1Response?.result?.resume_state?.min_index_seed?.step_size).toBe(0.01)
    expect(h1Response?.result?.resume_state?.max_index_seed?.endpoint_index).toBe(1)
    expect(h1Response?.result?.resume_state?.max_index_seed?.step_size).toBe(0.01)
    expect(h1Response?.result?.homoc_context?.basis?.dim).toBe(2)
    expect(wasmState.homoclinicLargeCycleInitCalls).toBe(1)
    expect(wasmState.homoclinicShootingInitArgs).toBeNull()
    expect(wasmState.lastHomoclinicRunner).toBe('collocation')

    workerScope.postMessage.mockClear()

    await handler({
      data: {
        id: 'job-h2',
        kind: 'runHomoclinicFromHomoclinic',
        payload: {
          ...payloadBase,
          pointState: new Array(80).fill(0),
          sourceNtst: 8,
          sourceNcol: 2,
          sourceNormalizedMesh: [0, 0.04, 0.12, 0.24, 0.4, 0.6, 0.78, 0.91, 1],
          sourceFreeTime: true,
          sourceFreeEps0: true,
          sourceFreeEps1: false,
          sourceFixedTime: 20,
          sourceFixedEps0: 0.01,
          sourceFixedEps1: 0.1,
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(
      workerScope.postMessage.mock.calls.some(
        ([payload]) =>
          (payload as { id?: string; ok?: boolean }).id === 'job-h2' &&
          (payload as { id?: string; ok?: boolean }).ok === true
      )
    ).toBe(true)
    const h2Response = workerScope.postMessage.mock.calls
      .map(
        ([payload]) =>
          payload as {
            id?: string
            ok?: boolean
            result?: { points?: unknown[]; indices?: number[]; bifurcations?: number[] }
          }
      )
      .find((payload) => payload.id === 'job-h2' && payload.ok === true)
    expect(h2Response?.result?.points?.length).toBe(3)
    expect(h2Response?.result?.indices).toEqual([10, 11, 12])
    expect(h2Response?.result?.bifurcations).toEqual([0, 1, 2])
    expect(wasmState.homoclinicRestartSourceMesh).toEqual([
      0, 0.04, 0.12, 0.24, 0.4, 0.6, 0.78, 0.91, 1,
    ])

    workerScope.postMessage.mockClear()

    await handler({
      data: {
        id: 'job-h5',
        kind: 'runHomotopySaddleFromEquilibrium',
        payload: {
          ...payloadBase,
          equilibriumState: [0, 0],
          parameterName: 'mu',
          param2Name: 'nu',
          ntst: 8,
          ncol: 2,
          eps0: 0.01,
          eps1: 0.1,
          time: 20,
          eps1Tol: 1e-4,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(
      workerScope.postMessage.mock.calls.some(
        ([payload]) =>
          (payload as { id?: string; ok?: boolean }).id === 'job-h5' &&
          (payload as { id?: string; ok?: boolean }).ok === true
      )
    ).toBe(true)

    workerScope.postMessage.mockClear()

    await handler({
      data: {
        id: 'job-h4',
        kind: 'runHomoclinicFromHomotopySaddle',
        payload: {
          ...payloadBase,
          stageDState: new Array(80).fill(0),
          sourceNtst: 8,
          sourceNcol: 2,
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(
      workerScope.postMessage.mock.calls.some(
        ([payload]) =>
          (payload as { id?: string; ok?: boolean }).id === 'job-h4' &&
          (payload as { id?: string; ok?: boolean }).ok === true
      )
    ).toBe(true)
    const h4Response = workerScope.postMessage.mock.calls
      .map(
        ([payload]) =>
          payload as {
            id?: string
            ok?: boolean
            result?: { points?: unknown[]; indices?: number[]; bifurcations?: number[] }
          }
      )
      .find((payload) => payload.id === 'job-h4' && payload.ok === true)
    expect(h4Response?.result?.points?.length).toBe(3)
    expect(h4Response?.result?.indices).toEqual([10, 11, 12])
    expect(h4Response?.result?.bifurcations).toEqual([0, 1, 2])
  })

  it('converts the Method 1 collocation seed and runs standard shooting', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-h1-shooting',
        kind: 'runHomoclinicFromLargeCycle',
        payload: {
          system: {
            ...baseSystem,
            params: [0.2, 0.1],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0, 2],
          sourceNtst: 4,
          sourceNcol: 2,
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
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.homoclinicLargeCycleInitCalls).toBe(1)
    expect(wasmState.homoclinicShootingInitArgs).toEqual({ intervals: 6, steps: 96 })
    expect(wasmState.lastHomoclinicRunner).toBe('shooting')
    const response = workerScope.postMessage.mock.calls
      .map(([payload]) => payload as { id?: string; ok?: boolean; result?: Record<string, unknown> })
      .find((payload) => payload.id === 'job-h1-shooting' && payload.ok === true)
    expect(response?.result?.branch_type).toMatchObject({
      type: 'HomoclinicCurve',
      ntst: 6,
      ncol: 0,
      discretization: { type: 'shooting', integration_steps_per_segment: 96 },
    })
  })

  it('passes the exact nonuniform source mesh to Method 1 initialization', async () => {
    const handler = requireHandler()
    await handler({
      data: {
        id: 'job-h1-nonuniform',
        kind: 'runHomoclinicFromLargeCycle',
        payload: {
          system: {
            ...baseSystem,
            params: [0.2, 0.1],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0, 2],
          sourceNtst: 2,
          sourceNcol: 2,
          sourceNormalizedMesh: [0, 0.2, 1],
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.homoclinicLargeCycleMesh).toEqual([0, 0.2, 1])
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-h1-nonuniform',
      ok: true,
    })
  })

  it('restarts a standard-shooting homoclinic branch with a new shooting mesh', async () => {
    const handler = requireHandler()
    await handler({
      data: {
        id: 'job-h2-shooting',
        kind: 'runHomoclinicFromHomoclinic',
        payload: {
          system: {
            ...baseSystem,
            params: [0.2, 0.1],
            paramNames: ['mu', 'nu'],
          },
          pointState: new Array(40).fill(0),
          sourceNtst: 6,
          sourceNcol: 0,
          sourceDiscretization: 'shooting',
          sourceFreeTime: true,
          sourceFreeEps0: true,
          sourceFreeEps1: false,
          sourceFixedTime: 20,
          sourceFixedEps0: 0.01,
          sourceFixedEps1: 0.1,
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          discretization: 'shooting',
          shootingIntervals: 9,
          integrationStepsPerSegment: 72,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.homoclinicShootingRestartArgs).toEqual({
      sourceIntervals: 6,
      targetIntervals: 9,
      steps: 72,
    })
    expect(wasmState.lastHomoclinicRunner).toBe('shooting')
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'job-h2-shooting',
      ok: true,
      result: {
        branch_type: {
          type: 'HomoclinicCurve',
          ncol: 0,
          discretization: { type: 'shooting' },
        },
      },
    })
  })

  it('reports an actionable error when the shooting binding is unavailable', async () => {
    const handler = requireHandler()
    wasmState.disableHomoclinicShootingInit = true

    await handler({
      data: {
        id: 'job-h1-shooting-missing',
        kind: 'runHomoclinicFromLargeCycle',
        payload: {
          system: {
            ...baseSystem,
            params: [0.2, 0.1],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0, 2],
          sourceNtst: 4,
          sourceNcol: 2,
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
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    const response = workerScope.postMessage.mock.calls
      .map(([payload]) => payload as { id?: string; ok?: boolean; error?: string })
      .find((payload) => payload.id === 'job-h1-shooting-missing' && payload.ok === false)
    expect(response?.error).toContain('standard shooting')
    expect(response?.error).toContain('Rebuild fork_wasm pkg-web')
  })

  it('returns a clear error when homoclinic methods are missing from the wasm build', async () => {
    const handler = requireHandler()
    wasmState.disableHomoclinicLargeCycleInit = true

    await handler({
      data: {
        id: 'job-h-missing-method',
        kind: 'runHomoclinicFromLargeCycle',
        payload: {
          system: {
            ...baseSystem,
            params: [0.2, 0.1],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0, 2],
          sourceNtst: 4,
          sourceNcol: 2,
          parameterName: 'mu',
          param2Name: 'nu',
          targetNtst: 8,
          targetNcol: 2,
          freeTime: true,
          freeEps0: true,
          freeEps1: false,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    const errorResponse = workerScope.postMessage.mock.calls
      .map(([payload]) => payload as { id?: string; ok?: boolean; error?: string })
      .find(
        (payload) =>
          payload.id === 'job-h-missing-method' && payload.ok === false && !!payload.error
      )

    expect(errorResponse?.error).toContain('Rebuild fork_wasm pkg-web')
  })

  it('simulates orbits and returns time series data', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-orbit',
      kind: 'simulateOrbit',
      payload: {
        system: baseSystem,
        initialState: [1, 2],
        steps: 2,
        dt: 0.5,
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    expect(workerScope.postMessage).toHaveBeenCalledTimes(1)
    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { data: number[][]; t_end: number }
    }
    expect(response.ok).toBe(true)
    expect(response.result.data).toHaveLength(3)
    expect(response.result.data[0]).toEqual([0, 1, 2])
    expect(response.result.data[2]).toEqual([1, 2, 3])
    expect(response.result.t_end).toBe(1)
  })

  it('samples 1D map functions for map systems', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-map',
      kind: 'sampleMap1DFunction',
      payload: {
        system: {
          ...baseSystem,
          type: 'map',
          solver: 'discrete',
          varNames: ['x'],
        },
        min: 0,
        max: 2,
        samples: 3,
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { x: number[]; y: number[] }
    }
    expect(response.ok).toBe(true)
    expect(response.result).toEqual({ x: [0, 1, 2], y: [1, 2, 3] })
  })

  it('computes isoclines', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-isocline',
      kind: 'computeIsocline',
      payload: {
        system: {
          ...baseSystem,
          equations: ['x + y', 'x - y'],
          varNames: ['x', 'y'],
        },
        expression: 'x + y',
        level: 0,
        axes: [
          { variableName: 'x', min: -2, max: 2, samples: 16 },
          { variableName: 'y', min: -2, max: 2, samples: 16 },
        ],
        frozenState: [0, 0],
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { geometry: string; dim: number; segments?: number[] }
    }
    expect(response.ok).toBe(true)
    expect(response.result.geometry).toBe('segments')
    expect(response.result.dim).toBe(2)
    expect(response.result.segments).toEqual([0, 1])
  })

  it('computes isoclines when wasm exposes computeIsocline', async () => {
    wasmState.useCamelCaseIsoclineMethod = true
    const handler = requireHandler()
    const message = {
      id: 'job-isocline-camel',
      kind: 'computeIsocline',
      payload: {
        system: {
          ...baseSystem,
          equations: ['x + y', 'x - y'],
          varNames: ['x', 'y'],
        },
        expression: 'x + y',
        level: 0,
        axes: [
          { variableName: 'x', min: -2, max: 2, samples: 16 },
          { variableName: 'y', min: -2, max: 2, samples: 16 },
        ],
        frozenState: [0, 0],
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { geometry: string; dim: number; segments?: number[] }
    }
    expect(response.ok).toBe(true)
    expect(response.result.geometry).toBe('segments')
    expect(response.result.dim).toBe(2)
    expect(response.result.segments).toEqual([0, 1])
  })

  it('returns empty map samples for invalid requests', async () => {
    const handler = requireHandler()
    const message = {
      id: 'job-map-invalid',
      kind: 'sampleMap1DFunction',
      payload: {
        system: baseSystem,
        min: Number.NaN,
        max: 1,
        samples: 3,
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { x: number[]; y: number[] }
    }
    expect(response.ok).toBe(true)
    expect(response.result).toEqual({ x: [], y: [] })
  })

  it('handles compute and solve requests', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-lyap',
        kind: 'computeLyapunovExponents',
        payload: {
          system: baseSystem,
          startState: [0],
          startTime: 0,
          steps: 10,
          dt: 0.1,
          qrStride: 2,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    const lyapResponse = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: number[]
    }
    expect(lyapResponse.ok).toBe(true)
    expect(lyapResponse.result).toEqual([1, 2, 3])

    workerScope.postMessage.mockClear()

    await handler({
      data: {
        id: 'job-clv',
        kind: 'computeCovariantLyapunovVectors',
        payload: {
          system: baseSystem,
          startState: [0],
          startTime: 0,
          windowSteps: 5,
          dt: 0.1,
          qrStride: 2,
          forwardTransient: 1,
          backwardTransient: 1,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    const covariantResponse = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { dimension: number; checkpoints: number; times: number[]; vectors: number[] }
    }
    expect(covariantResponse.ok).toBe(true)
    expect(covariantResponse.result.dimension).toBe(2)

    workerScope.postMessage.mockClear()

    await handler({
      data: {
        id: 'job-eq',
        kind: 'solveEquilibrium',
        payload: {
          system: baseSystem,
          initialGuess: [0],
          maxSteps: 10,
          dampingFactor: 0.5,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    const equilibriumResponse = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { state: number[]; residual_norm: number; iterations: number }
    }
    expect(equilibriumResponse.ok).toBe(true)
    expect(equilibriumResponse.result.state).toEqual([1])
  })

  it('posts progress and results for continuation runners', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-extension',
        kind: 'runContinuationExtension',
        payload: {
          system: baseSystem,
          branchData: { points: [], bifurcations: [], indices: [] },
          parameterName: 'p1',
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(workerScope.postMessage).toHaveBeenCalledTimes(2)
    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 'job-extension',
      kind: 'progress',
    })
    expect(workerScope.postMessage.mock.calls[1][0]).toMatchObject({
      id: 'job-extension',
      ok: true,
      result: { points: [] },
    })
  })

  it('passes periodic coordinates to the stepped 1D manifold runner', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-manifold-1d',
        kind: 'runEquilibriumManifold1D',
        payload: {
          system: {
            ...baseSystem,
            periodicVariables: [{ enabled: true, period: 6.25 }],
          },
          equilibriumState: [0],
          settings: {
            stability: 'Unstable',
            direction: 'Both',
            eig_index: 0,
            eps: 1e-4,
            target_arclength: 1,
            integration_dt: 0.01,
            caps: {
              max_steps: 20,
              max_points: 100,
              max_rings: 1,
              max_vertices: 1,
              max_time: 2,
            },
          },
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastEqManifoldPeriods).toEqual([6.25])
    expect(workerScope.postMessage.mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job-manifold-1d',
          kind: 'progress',
          progress: expect.objectContaining({ done: false }),
        }),
        expect.objectContaining({ id: 'job-manifold-1d', ok: true, result: [] }),
      ])
    )
  })

  it('passes stored branches and periodic coordinates to the manifold extension runner', async () => {
    const handler = requireHandler()
    const branchData = {
      points: [
        { state: [0], param_value: 0, stability: 'None', eigenvalues: [] },
        { state: [0.1], param_value: 0.1, stability: 'None', eigenvalues: [] },
      ],
      bifurcations: [],
      indices: [0, 1],
    }

    await handler({
      data: {
        id: 'job-manifold-1d-extension',
        kind: 'runEquilibriumManifold1DExtension',
        payload: {
          system: {
            ...baseSystem,
            periodicVariables: [{ enabled: true, period: 4.5 }],
          },
          branchData,
          settings: {
            stability: 'Unstable',
            direction: 'Plus',
            eig_index: 0,
            eps: 1e-4,
            target_arclength: 1,
            integration_dt: 0.01,
            caps: {
              max_steps: 20,
              max_points: 100,
              max_rings: 1,
              max_vertices: 1,
              max_time: 2,
            },
          },
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastEqManifoldExtensionPeriods).toEqual([4.5])
    expect(wasmState.lastEqManifoldExtensionPointCount).toBe(2)
    expect(workerScope.postMessage.mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job-manifold-1d-extension',
          kind: 'progress',
          progress: expect.objectContaining({ done: false }),
        }),
        expect.objectContaining({
          id: 'job-manifold-1d-extension',
          ok: true,
          result: branchData,
        }),
      ])
    )
  })

  it('passes persisted 2D surface state to the 2D manifold extension runner', async () => {
    const handler = requireHandler()
    const branchData = {
      points: [{ state: [0, 0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
      bifurcations: [],
      indices: [0],
      branch_type: {
        type: 'ManifoldEq2D',
        stability: 'Unstable',
        eig_kind: 'RealPair',
        eig_indices: [0, 1],
        method: 'krauskopf_osinga_geodesic_leaf_continuation',
        caps: {},
      },
      manifold_geometry: {
        type: 'Surface',
        dim: 3,
        vertices_flat: [0, 0, 0],
        triangles: [],
        ring_offsets: [0],
        resume_state: {
          type: 'GeodesicRings',
          version: 1,
          outer_ring: [[0, 0, 0]],
          inward_anchors: [[0, 0, 0]],
          current_leaf_delta: 0.01,
          accumulated_arclength: 0,
        },
      },
    }

    await handler({
      data: {
        id: 'job-manifold-2d-extension',
        kind: 'runManifold2DExtension',
        payload: {
          system: { ...baseSystem, equations: ['x', 'y', '-z'], varNames: ['x', 'y', 'z'] },
          branchData,
          settings: {
            stability: 'Unstable',
            target_arclength: 1,
            integration_dt: 0.01,
            caps: {
              max_steps: 20,
              max_points: 100,
              max_rings: 10,
              max_vertices: 100,
              max_time: 2,
            },
          },
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastManifold2DExtensionPointCount).toBe(1)
    expect(workerScope.postMessage.mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job-manifold-2d-extension',
          kind: 'progress',
          progress: expect.objectContaining({ done: false }),
        }),
        expect.objectContaining({
          id: 'job-manifold-2d-extension',
          kind: 'progress',
          progress: expect.objectContaining({ done: true, rings_computed: 1 }),
        }),
        expect.objectContaining({
          id: 'job-manifold-2d-extension',
          ok: true,
          result: branchData,
        }),
      ])
    )
  })

  it('posts progress and results for isoperiodic curve continuation runners', async () => {
    const handler = requireHandler()

    await handler({
      data: {
        id: 'job-isoperiodic',
        kind: 'runIsoperiodicCurveContinuation',
        payload: {
          system: {
            ...baseSystem,
            params: [0.1, 0.2],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0],
          period: 6,
          param1Name: 'mu',
          param1Value: 0.1,
          param2Name: 'nu',
          param2Value: 0.2,
          ntst: 2,
          ncol: 2,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(workerScope.postMessage).toHaveBeenCalledTimes(2)
    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 'job-isoperiodic',
      kind: 'progress',
    })
    expect(workerScope.postMessage.mock.calls[1][0]).toMatchObject({
      id: 'job-isoperiodic',
      ok: true,
      result: { points: [] },
    })
  })

  it.each([
    ['LimitPointCycle', undefined],
    ['PeriodDoubling', undefined],
    ['NeimarkSacker', 0.25],
  ] as const)('runs the existing %s limit-cycle curve runner', async (curveType, initialK) => {
    const handler = requireHandler()

    await handler({
      data: {
        id: `job-cycle-curve-${curveType}`,
        kind: 'runLimitCycleCodim1CurveContinuation',
        payload: {
          system: {
            ...baseSystem,
            params: [0.1, 0.2],
            paramNames: ['mu', 'nu'],
          },
          curveType,
          lcState: [0, 1, 1, 0],
          period: 6,
          param1Name: 'mu',
          param1Value: 0.1,
          param2Name: 'nu',
          param2Value: 0.2,
          initialK,
          ntst: 2,
          ncol: 2,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.lastCycleCurveRunner).toBe(curveType)
    if (curveType === 'NeimarkSacker') {
      expect(wasmState.lastCycleCurveInitialK).toBe(initialK)
    }
    expect(workerScope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      id: `job-cycle-curve-${curveType}`,
      ok: true,
      result: { points: [] },
    })
  })

  it('falls back to WasmSystem isoperiodic curve continuation when runner constructor is unavailable', async () => {
    const handler = requireHandler()
    wasmState.disableIsoperiodicRunner = true

    await handler({
      data: {
        id: 'job-isoperiodic-fallback',
        kind: 'runIsoperiodicCurveContinuation',
        payload: {
          system: {
            ...baseSystem,
            params: [0.1, 0.2],
            paramNames: ['mu', 'nu'],
          },
          lcState: [0, 1, 1, 0],
          period: 6,
          param1Name: 'mu',
          param1Value: 0.1,
          param2Name: 'nu',
          param2Value: 0.2,
          ntst: 2,
          ncol: 2,
          settings: continuationSettings,
          forward: true,
        },
      },
    } as unknown as MessageEvent<Record<string, unknown>>)

    expect(wasmState.isoperiodicFallbackCalls).toBe(1)
    expect(workerScope.postMessage).toHaveBeenCalledTimes(3)
    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 'job-isoperiodic-fallback',
      kind: 'progress',
      progress: { done: false },
    })
    expect(workerScope.postMessage.mock.calls[1][0]).toMatchObject({
      id: 'job-isoperiodic-fallback',
      kind: 'progress',
      progress: { done: true },
    })
    expect(workerScope.postMessage.mock.calls[2][0]).toMatchObject({
      id: 'job-isoperiodic-fallback',
      ok: true,
      result: { points: [] },
    })
  })

  it('marks requests as aborted when canceled', async () => {
    const handler = requireHandler()
    wasmState.initPromise = new Promise((resolve) => {
      wasmState.initResolver = resolve
    })

    const message = {
      id: 'job-cancel',
      kind: 'simulateOrbit',
      payload: {
        system: baseSystem,
        initialState: [0],
        steps: 3,
        dt: 0.1,
      },
    }

    const runPromise = handler({
      data: message,
    } as unknown as MessageEvent<Record<string, unknown>>)

    await Promise.resolve()

    await handler({
      data: { id: 'job-cancel', kind: 'cancel' },
    } as unknown as MessageEvent<Record<string, unknown>>)

    wasmState.initResolver?.()
    await runPromise

    expect(workerScope.postMessage).toHaveBeenCalledTimes(1)
    expect(workerScope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 'job-cancel',
      ok: false,
      aborted: true,
    })
  })

  it('returns equation-level errors when validation fails', async () => {
    wasmState.throwMode = 'validate'
    const handler = requireHandler()
    const message = {
      id: 'job-2',
      kind: 'validateSystem',
      payload: {
        system: {
          ...baseSystem,
          equations: ['x', 'bad_equation'],
        },
      },
    }

    await handler({ data: message } as unknown as MessageEvent<Record<string, unknown>>)

    expect(workerScope.postMessage).toHaveBeenCalledTimes(1)
    const response = workerScope.postMessage.mock.calls[0][0] as {
      ok: boolean
      result: { ok: boolean; equationErrors: Array<string | null>; message?: string }
    }

    expect(response.ok).toBe(true)
    expect(response.result.ok).toBe(false)
    expect(response.result.equationErrors).toEqual([null, 'bad equation'])
    expect(response.result.message).toBeUndefined()
  })
})
