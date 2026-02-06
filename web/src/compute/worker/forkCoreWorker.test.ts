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
  lastRunStepsArg: null as number | null,
  lastSystemType: null as string | null,
  lastLimitCycleRunnerSystemType: null as string | null,
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
        if (wasmState.throwMode !== 'validate') return
        if (equations.length > 1) {
          throw new Error('full system failed')
        }
        if (equations[0]?.includes('bad')) {
          throw new Error('bad equation')
        }
      }
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
      init_homoclinic_from_large_cycle() {
        return {}
      }
      init_homoclinic_from_homoclinic() {
        return {}
      }
      init_homotopy_saddle_from_equilibrium() {
        return {}
      }
      init_homoclinic_from_homotopy_saddle() {
        return {}
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
      get_result() {
        return { points: [] }
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
      WasmFoldCurveRunner: MockContinuationRunner,
      WasmHopfCurveRunner: MockContinuationRunner,
      WasmLimitCycleRunner: MockLimitCycleRunner,
      WasmHomoclinicRunner: MockContinuationRunner,
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
  wasmState.lastRunStepsArg = null
  wasmState.lastSystemType = null
  wasmState.lastLimitCycleRunnerSystemType = null
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
