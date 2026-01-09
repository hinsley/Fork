import type {
  ContinuationProgress,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  ForkCoreClient,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from './ForkCoreClient'
import { JobQueue } from './jobQueue'
import { isDeterministicMode } from '../utils/determinism'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export class MockForkCoreClient implements ForkCoreClient {
  private queue: JobQueue
  private delayMs: number

  constructor(delayMs = isDeterministicMode() ? 0 : 5) {
    this.queue = new JobQueue()
    this.delayMs = delayMs
  }

  async simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult> {
    const job = this.queue.enqueue(
      'simulateOrbit',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const data: number[][] = []
        let t = 0
        data.push([t, ...request.initialState])
        for (let i = 0; i < request.steps; i += 1) {
          t += request.dt
          const x = Math.cos(t)
          const y = Math.sin(t)
          data.push([t, x, y])
        }
        return {
          data,
          t_start: 0,
          t_end: t,
          dt: request.dt,
        }
      },
      opts
    )
    return await job.promise
  }

  async validateSystem(
    request: ValidateSystemRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ValidateSystemResult> {
    const job = this.queue.enqueue(
      'validateSystem',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const equationErrors = request.system.equations.map((eq) =>
          eq.includes('INVALID') ? 'Mock parse error.' : null
        )
        const hasErrors = equationErrors.some((entry) => entry)
        return {
          ok: !hasErrors,
          equationErrors,
          message: hasErrors ? 'Mock parse error.' : undefined,
        }
      },
      opts
    )
    return await job.promise
  }

  async solveEquilibrium(
    request: SolveEquilibriumRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SolveEquilibriumResult> {
    const job = this.queue.enqueue(
      'solveEquilibrium',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        return {
          state: request.initialGuess,
          residual_norm: 0,
          iterations: 1,
          jacobian: [],
          eigenpairs: [],
        }
      },
      opts
    )
    return await job.promise
  }

  async runEquilibriumContinuation(
    request: EquilibriumContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumContinuationResult> {
    const job = this.queue.enqueue(
      'runEquilibriumContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.system.params[0] ?? 0,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 3
        opts?.onProgress?.({ ...progress })

        return {
          points: [
            {
              state: request.equilibriumState,
              param_value: request.system.params[0] ?? 0,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0],
        }
      },
      opts
    )
    return await job.promise
  }
}
