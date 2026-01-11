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
  throwMode: 'none' as 'none' | 'validate',
  lastRunStepsArg: null as number | null,
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
      constructor(equations: string[]) {
        if (wasmState.throwMode !== 'validate') return
        if (equations.length > 1) {
          throw new Error('full system failed')
        }
        if (equations[0]?.includes('bad')) {
          throw new Error('bad equation')
        }
      }
      set_state() {}
      get_state() {
        return new Float64Array([0])
      }
      set_t() {}
      get_t() {
        return 0
      }
      step() {}
      solve_equilibrium() {
        return { state: [], residual_norm: 0, iterations: 0, jacobian: [], eigenpairs: [] }
      }
      compute_lyapunov_exponents() {
        return new Float64Array([0])
      }
      compute_covariant_lyapunov_vectors() {
        return { dimension: 0, checkpoints: 0, times: [], vectors: [] }
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

    return {
      default: vi.fn(() => Promise.resolve()),
      WasmSystem: MockWasmSystem,
      WasmEquilibriumRunner: MockWasmEquilibriumRunner,
      WasmFoldCurveRunner: MockContinuationRunner,
      WasmHopfCurveRunner: MockContinuationRunner,
      WasmContinuationExtensionRunner: MockContinuationRunner,
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
  wasmState.lastRunStepsArg = null
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
