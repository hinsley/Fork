import type {
  Codim1CurveBranch,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  FoldCurveContinuationRequest,
  ForkCoreClient,
  HopfCurveContinuationRequest,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleContinuationResult,
  LyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
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
  | { id: string; kind: 'sampleMap1DFunction'; payload: SampleMap1DFunctionRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'runContinuationExtension'; payload: ContinuationExtensionRequest }
  | { id: string; kind: 'runFoldCurveContinuation'; payload: FoldCurveContinuationRequest }
  | { id: string; kind: 'runHopfCurveContinuation'; payload: HopfCurveContinuationRequest }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromHopf'
      payload: LimitCycleContinuationFromHopfRequest
    }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerProgress = { id: string; kind: 'progress'; progress: ContinuationProgress }

type WorkerResponse =
  | {
      id: string
      ok: true
      result:
        | SimulateOrbitResult
        | SampleMap1DFunctionResult
        | number[]
        | CovariantLyapunovResponse
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
        | ContinuationExtensionResult
        | Codim1CurveBranch
        | LimitCycleContinuationResult
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
          | SampleMap1DFunctionResult
          | number[]
          | CovariantLyapunovResponse
          | SolveEquilibriumResult
          | ValidateSystemResult
          | EquilibriumContinuationResult
          | ContinuationExtensionResult
          | Codim1CurveBranch
          | LimitCycleContinuationResult
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

  async sampleMap1DFunction(
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SampleMap1DFunctionResult> {
    const job = this.queue.enqueue(
      'sampleMap1DFunction',
      (signal) => this.runWorker('sampleMap1DFunction', request, signal),
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

  async runContinuationExtension(
    request: ContinuationExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<ContinuationExtensionResult> {
    const job = this.queue.enqueue(
      'runContinuationExtension',
      (signal) => this.runWorker('runContinuationExtension', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runFoldCurveContinuation(
    request: FoldCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runFoldCurveContinuation',
      (signal) =>
        this.runWorker('runFoldCurveContinuation', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runHopfCurveContinuation(
    request: HopfCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runHopfCurveContinuation',
      (signal) =>
        this.runWorker('runHopfCurveContinuation', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runLimitCycleContinuationFromHopf(
    request: LimitCycleContinuationFromHopfRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromHopf',
      (signal) =>
        this.runWorker(
          'runLimitCycleContinuationFromHopf',
          request,
          signal,
          opts?.onProgress
        ),
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
    kind: 'sampleMap1DFunction',
    payload: SampleMap1DFunctionRequest,
    signal: AbortSignal
  ): Promise<SampleMap1DFunctionResult>
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
    kind: 'runContinuationExtension',
    payload: ContinuationExtensionRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<ContinuationExtensionResult>
  private runWorker(
    kind: 'runFoldCurveContinuation',
    payload: FoldCurveContinuationRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<Codim1CurveBranch>
  private runWorker(
    kind: 'runHopfCurveContinuation',
    payload: HopfCurveContinuationRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<Codim1CurveBranch>
  private runWorker(
    kind: 'runLimitCycleContinuationFromHopf',
    payload: LimitCycleContinuationFromHopfRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<LimitCycleContinuationResult>
  private runWorker(
    kind: 'validateSystem',
    payload: ValidateSystemRequest,
    signal: AbortSignal
  ): Promise<ValidateSystemResult>
  private runWorker(
    kind:
      | 'simulateOrbit'
      | 'sampleMap1DFunction'
      | 'computeLyapunovExponents'
      | 'computeCovariantLyapunovVectors'
      | 'solveEquilibrium'
      | 'runEquilibriumContinuation'
      | 'runContinuationExtension'
      | 'runFoldCurveContinuation'
      | 'runHopfCurveContinuation'
      | 'runLimitCycleContinuationFromHopf'
      | 'validateSystem',
    payload:
      | SimulateOrbitRequest
      | SampleMap1DFunctionRequest
      | LyapunovExponentsRequest
      | CovariantLyapunovRequest
      | SolveEquilibriumRequest
      | EquilibriumContinuationRequest
      | ContinuationExtensionRequest
      | FoldCurveContinuationRequest
      | HopfCurveContinuationRequest
      | LimitCycleContinuationFromHopfRequest
      | ValidateSystemRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<
    | SimulateOrbitResult
    | SampleMap1DFunctionResult
    | number[]
    | CovariantLyapunovResponse
    | SolveEquilibriumResult
    | ValidateSystemResult
    | EquilibriumContinuationResult
    | ContinuationExtensionResult
    | Codim1CurveBranch
    | LimitCycleContinuationResult
  > {
    const id = makeStableId('req')
    const message: WorkerRequest =
      kind === 'simulateOrbit'
        ? { id, kind, payload: payload as SimulateOrbitRequest }
        : kind === 'sampleMap1DFunction'
          ? { id, kind, payload: payload as SampleMap1DFunctionRequest }
        : kind === 'computeLyapunovExponents'
          ? { id, kind, payload: payload as LyapunovExponentsRequest }
          : kind === 'computeCovariantLyapunovVectors'
            ? { id, kind, payload: payload as CovariantLyapunovRequest }
        : kind === 'solveEquilibrium'
          ? { id, kind, payload: payload as SolveEquilibriumRequest }
          : kind === 'runEquilibriumContinuation'
            ? { id, kind, payload: payload as EquilibriumContinuationRequest }
            : kind === 'runContinuationExtension'
              ? { id, kind, payload: payload as ContinuationExtensionRequest }
              : kind === 'runFoldCurveContinuation'
                ? { id, kind, payload: payload as FoldCurveContinuationRequest }
        : kind === 'runHopfCurveContinuation'
          ? { id, kind, payload: payload as HopfCurveContinuationRequest }
          : kind === 'runLimitCycleContinuationFromHopf'
            ? { id, kind, payload: payload as LimitCycleContinuationFromHopfRequest }
            : { id, kind, payload: payload as ValidateSystemRequest }

    const promise = new Promise<
      | SimulateOrbitResult
      | SampleMap1DFunctionResult
      | number[]
      | CovariantLyapunovResponse
      | SolveEquilibriumResult
      | ValidateSystemResult
      | EquilibriumContinuationResult
      | ContinuationExtensionResult
      | Codim1CurveBranch
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
