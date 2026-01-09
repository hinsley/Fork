import type {
  ContinuationProgress,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  ForkCoreClient,
  LyapunovExponentsRequest,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from './ForkCoreClient'
import { JobQueue } from './jobQueue'
import { makeStableId } from '../utils/determinism'

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerProgress = { id: string; kind: 'progress'; progress: ContinuationProgress }

type WorkerResponse =
  | {
      id: string
      ok: true
      result:
        | SimulateOrbitResult
        | number[]
        | CovariantLyapunovResponse
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
    }
  | { id: string; ok: false; error: string; aborted?: boolean }
  | WorkerProgress

export class WasmForkCoreClient implements ForkCoreClient {
  private worker: Worker
  private queue: JobQueue
  private pending = new Map<
    string,
    {
      resolve: (
        value:
          | SimulateOrbitResult
          | number[]
          | CovariantLyapunovResponse
          | SolveEquilibriumResult
          | ValidateSystemResult
          | EquilibriumContinuationResult
      ) => void
      reject: (error: Error) => void
      onProgress?: (progress: ContinuationProgress) => void
    }
  >()

  constructor(queue?: JobQueue) {
    this.queue = queue ?? new JobQueue()
    this.worker = new Worker(new URL('./worker/forkCoreWorker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if ('kind' in message && message.kind === 'progress') {
        const entry = this.pending.get(message.id)
        entry?.onProgress?.(message.progress)
        return
      }
      if (!('ok' in message)) return
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.ok) {
        entry.resolve(message.result)
      } else {
        const error = new Error(message.error)
        if (message.aborted) error.name = 'AbortError'
        entry.reject(error)
      }
    }
  }

  async simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult> {
    const job = this.queue.enqueue(
      'simulateOrbit',
      (signal) => this.runWorker('simulateOrbit', request, signal),
      opts
    )
    return await job.promise
  }

  async computeLyapunovExponents(
    request: LyapunovExponentsRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<number[]> {
    const job = this.queue.enqueue(
      'computeLyapunovExponents',
      (signal) => this.runWorker('computeLyapunovExponents', request, signal),
      opts
    )
    return await job.promise
  }

  async computeCovariantLyapunovVectors(
    request: CovariantLyapunovRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<CovariantLyapunovResponse> {
    const job = this.queue.enqueue(
      'computeCovariantLyapunovVectors',
      (signal) => this.runWorker('computeCovariantLyapunovVectors', request, signal),
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
      (signal) => this.runWorker('solveEquilibrium', request, signal),
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
      (signal) => this.runWorker('runEquilibriumContinuation', request, signal, opts?.onProgress),
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
      (signal) => this.runWorker('validateSystem', request, signal),
      opts
    )
    return await job.promise
  }

  async close() {
    this.worker.terminate()
  }

  private runWorker(
    kind: 'simulateOrbit',
    payload: SimulateOrbitRequest,
    signal: AbortSignal
  ): Promise<SimulateOrbitResult>
  private runWorker(
    kind: 'computeLyapunovExponents',
    payload: LyapunovExponentsRequest,
    signal: AbortSignal
  ): Promise<number[]>
  private runWorker(
    kind: 'computeCovariantLyapunovVectors',
    payload: CovariantLyapunovRequest,
    signal: AbortSignal
  ): Promise<CovariantLyapunovResponse>
  private runWorker(
    kind: 'solveEquilibrium',
    payload: SolveEquilibriumRequest,
    signal: AbortSignal
  ): Promise<SolveEquilibriumResult>
  private runWorker(
    kind: 'runEquilibriumContinuation',
    payload: EquilibriumContinuationRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<EquilibriumContinuationResult>
  private runWorker(
    kind: 'validateSystem',
    payload: ValidateSystemRequest,
    signal: AbortSignal
  ): Promise<ValidateSystemResult>
  private runWorker(
    kind:
      | 'simulateOrbit'
      | 'computeLyapunovExponents'
      | 'computeCovariantLyapunovVectors'
      | 'solveEquilibrium'
      | 'runEquilibriumContinuation'
      | 'validateSystem',
    payload:
      | SimulateOrbitRequest
      | LyapunovExponentsRequest
      | CovariantLyapunovRequest
      | SolveEquilibriumRequest
      | EquilibriumContinuationRequest
      | ValidateSystemRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<
    | SimulateOrbitResult
    | number[]
    | CovariantLyapunovResponse
    | SolveEquilibriumResult
    | ValidateSystemResult
    | EquilibriumContinuationResult
  > {
    const id = makeStableId('req')
    const message: WorkerRequest =
      kind === 'simulateOrbit'
        ? { id, kind, payload: payload as SimulateOrbitRequest }
        : kind === 'computeLyapunovExponents'
          ? { id, kind, payload: payload as LyapunovExponentsRequest }
          : kind === 'computeCovariantLyapunovVectors'
            ? { id, kind, payload: payload as CovariantLyapunovRequest }
        : kind === 'solveEquilibrium'
          ? { id, kind, payload: payload as SolveEquilibriumRequest }
          : kind === 'runEquilibriumContinuation'
            ? { id, kind, payload: payload as EquilibriumContinuationRequest }
            : { id, kind, payload: payload as ValidateSystemRequest }

    const promise = new Promise<
      | SimulateOrbitResult
      | number[]
      | CovariantLyapunovResponse
      | SolveEquilibriumResult
      | ValidateSystemResult
      | EquilibriumContinuationResult
    >((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
    })

    if (signal.aborted) {
      this.worker.postMessage({ id, kind: 'cancel' } satisfies WorkerRequest)
    } else {
      signal.addEventListener(
        'abort',
        () => {
          this.worker.postMessage({ id, kind: 'cancel' } satisfies WorkerRequest)
        },
        { once: true }
      )
    }

    this.worker.postMessage(message)
    return promise
  }
}
