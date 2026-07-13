import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  Codim1CurveBranch,
  Codim2BranchSwitchRequest,
  Codim2BranchSwitchResult,
  EventSeriesResult,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumManifold1DRequest,
  EquilibriumManifold1DResult,
  EquilibriumManifold1DExtensionRequest,
  EquilibriumManifold1DExtensionResult,
  EquilibriumManifold2DRequest,
  EquilibriumManifold2DResult,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  FoldCurveContinuationRequest,
  ForkCoreClient,
  HomoclinicContinuationResult,
  HomoclinicFromHomoclinicRequest,
  HomoclinicFromHomotopySaddleRequest,
  HomoclinicFromLargeCycleRequest,
  HopfCurveContinuationRequest,
  IsoperiodicCurveContinuationRequest,
  HomotopySaddleContinuationResult,
  HomotopySaddleFromEquilibriumRequest,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleContinuationFromOrbitRequest,
  LimitCycleContinuationFromPDRequest,
  LimitCycleContinuationResult,
  LimitCycleFloquetModesRequest,
  LimitCycleFloquetModesResult,
  LimitCycleManifold2DRequest,
  LimitCycleManifold2DResult,
  Manifold2DExtensionRequest,
  Manifold2DExtensionResult,
  MapCycleContinuationFromPDRequest,
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
import { createWorkerRequest } from './computeProtocol'
import type {
  ComputeOperationKind,
  ComputeRequest,
  ComputeResult,
  WorkerRequest,
  WorkerResponse,
} from './computeProtocol'

export class WasmForkCoreClient implements ForkCoreClient {
  private worker: Worker
  private queue: JobQueue
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
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

  async computeEventSeriesFromOrbit(
    request: ComputeEventSeriesFromOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<EventSeriesResult> {
    const job = this.queue.enqueue(
      'computeEventSeriesFromOrbit',
      (signal) => this.runWorker('computeEventSeriesFromOrbit', request, signal),
      opts
    )
    return await job.promise
  }

  async computeEventSeriesFromSamples(
    request: ComputeEventSeriesFromSamplesRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<EventSeriesResult> {
    const job = this.queue.enqueue(
      'computeEventSeriesFromSamples',
      (signal) => this.runWorker('computeEventSeriesFromSamples', request, signal),
      opts
    )
    return await job.promise
  }

  async computeIsocline(
    request: ComputeIsoclineRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ComputeIsoclineResult> {
    const job = this.queue.enqueue(
      'computeIsocline',
      (signal) => this.runWorker('computeIsocline', request, signal),
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

  async runEquilibriumManifold1D(
    request: EquilibriumManifold1DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold1DResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold1D',
      (signal) =>
        this.runWorker('runEquilibriumManifold1D', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runEquilibriumManifold1DExtension(
    request: EquilibriumManifold1DExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold1DExtensionResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold1DExtension',
      (signal) =>
        this.runWorker(
          'runEquilibriumManifold1DExtension',
          request,
          signal,
          opts?.onProgress
        ),
      opts
    )
    return await job.promise
  }

  async runManifold2DExtension(
    request: Manifold2DExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Manifold2DExtensionResult> {
    const job = this.queue.enqueue(
      'runManifold2DExtension',
      (signal) =>
        this.runWorker('runManifold2DExtension', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runEquilibriumManifold2D(
    request: EquilibriumManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold2DResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold2D',
      (signal) =>
        this.runWorker('runEquilibriumManifold2D', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runLimitCycleManifold2D(
    request: LimitCycleManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleManifold2DResult> {
    const job = this.queue.enqueue(
      'runLimitCycleManifold2D',
      (signal) =>
        this.runWorker('runLimitCycleManifold2D', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async computeLimitCycleFloquetModes(
    request: LimitCycleFloquetModesRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<LimitCycleFloquetModesResult> {
    const job = this.queue.enqueue(
      'computeLimitCycleFloquetModes',
      (signal) => this.runWorker('computeLimitCycleFloquetModes', request, signal),
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

  async runCodim2BranchSwitch(
    request: Codim2BranchSwitchRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim2BranchSwitchResult> {
    const job = this.queue.enqueue(
      'runCodim2BranchSwitch',
      (signal) =>
        this.runWorker('runCodim2BranchSwitch', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runIsoperiodicCurveContinuation(
    request: IsoperiodicCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runIsoperiodicCurveContinuation',
      (signal) =>
        this.runWorker(
          'runIsoperiodicCurveContinuation',
          request,
          signal,
          opts?.onProgress
        ),
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

  async runLimitCycleContinuationFromOrbit(
    request: LimitCycleContinuationFromOrbitRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromOrbit',
      (signal) =>
        this.runWorker(
          'runLimitCycleContinuationFromOrbit',
          request,
          signal,
          opts?.onProgress
        ),
      opts
    )
    return await job.promise
  }

  async runLimitCycleContinuationFromPD(
    request: LimitCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromPD',
      (signal) =>
        this.runWorker(
          'runLimitCycleContinuationFromPD',
          request,
          signal,
          opts?.onProgress
        ),
      opts
    )
    return await job.promise
  }

  async runMapCycleContinuationFromPD(
    request: MapCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumContinuationResult> {
    const job = this.queue.enqueue(
      'runMapCycleContinuationFromPD',
      (signal) =>
        this.runWorker(
          'runMapCycleContinuationFromPD',
          request,
          signal,
          opts?.onProgress
        ),
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromLargeCycle(
    request: HomoclinicFromLargeCycleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromLargeCycle',
      (signal) =>
        this.runWorker('runHomoclinicFromLargeCycle', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromHomoclinic(
    request: HomoclinicFromHomoclinicRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromHomoclinic',
      (signal) =>
        this.runWorker('runHomoclinicFromHomoclinic', request, signal, opts?.onProgress),
      opts
    )
    return await job.promise
  }

  async runHomotopySaddleFromEquilibrium(
    request: HomotopySaddleFromEquilibriumRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomotopySaddleContinuationResult> {
    const job = this.queue.enqueue(
      'runHomotopySaddleFromEquilibrium',
      (signal) =>
        this.runWorker(
          'runHomotopySaddleFromEquilibrium',
          request,
          signal,
          opts?.onProgress
        ),
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromHomotopySaddle(
    request: HomoclinicFromHomotopySaddleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromHomotopySaddle',
      (signal) =>
        this.runWorker(
          'runHomoclinicFromHomotopySaddle',
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

  private runWorker<K extends ComputeOperationKind>(
    kind: K,
    payload: ComputeRequest<K>,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<ComputeResult<K>> {
    const id = makeStableId('req')
    const message = createWorkerRequest(id, kind, payload)
    const promise = new Promise<ComputeResult<K>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as ComputeResult<K>),
        reject,
        onProgress,
      })
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
