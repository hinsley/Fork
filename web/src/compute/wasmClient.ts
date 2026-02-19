import type {
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  Codim1CurveBranch,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumManifold1DRequest,
  EquilibriumManifold1DResult,
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
  IsochroneCurveContinuationRequest,
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

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'sampleMap1DFunction'; payload: SampleMap1DFunctionRequest }
  | { id: string; kind: 'computeIsocline'; payload: ComputeIsoclineRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'runContinuationExtension'; payload: ContinuationExtensionRequest }
  | { id: string; kind: 'runEquilibriumManifold1D'; payload: EquilibriumManifold1DRequest }
  | { id: string; kind: 'runEquilibriumManifold2D'; payload: EquilibriumManifold2DRequest }
  | { id: string; kind: 'runLimitCycleManifold2D'; payload: LimitCycleManifold2DRequest }
  | { id: string; kind: 'computeLimitCycleFloquetModes'; payload: LimitCycleFloquetModesRequest }
  | { id: string; kind: 'runFoldCurveContinuation'; payload: FoldCurveContinuationRequest }
  | { id: string; kind: 'runHopfCurveContinuation'; payload: HopfCurveContinuationRequest }
  | {
      id: string
      kind: 'runIsochroneCurveContinuation'
      payload: IsochroneCurveContinuationRequest
    }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromHopf'
      payload: LimitCycleContinuationFromHopfRequest
    }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromOrbit'
      payload: LimitCycleContinuationFromOrbitRequest
    }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromPD'
      payload: LimitCycleContinuationFromPDRequest
    }
  | {
      id: string
      kind: 'runMapCycleContinuationFromPD'
      payload: MapCycleContinuationFromPDRequest
    }
  | {
      id: string
      kind: 'runHomoclinicFromLargeCycle'
      payload: HomoclinicFromLargeCycleRequest
    }
  | {
      id: string
      kind: 'runHomoclinicFromHomoclinic'
      payload: HomoclinicFromHomoclinicRequest
    }
  | {
      id: string
      kind: 'runHomotopySaddleFromEquilibrium'
      payload: HomotopySaddleFromEquilibriumRequest
    }
  | {
      id: string
      kind: 'runHomoclinicFromHomotopySaddle'
      payload: HomoclinicFromHomotopySaddleRequest
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
        | ComputeIsoclineResult
        | number[]
        | CovariantLyapunovResponse
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
        | ContinuationExtensionResult
        | EquilibriumManifold1DResult
        | EquilibriumManifold2DResult
        | LimitCycleManifold2DResult
        | LimitCycleFloquetModesResult
        | Codim1CurveBranch
        | LimitCycleContinuationResult
        | HomoclinicContinuationResult
        | HomotopySaddleContinuationResult
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
          | ComputeIsoclineResult
          | number[]
          | CovariantLyapunovResponse
          | SolveEquilibriumResult
          | ValidateSystemResult
          | EquilibriumContinuationResult
          | ContinuationExtensionResult
          | EquilibriumManifold1DResult
          | EquilibriumManifold2DResult
          | LimitCycleManifold2DResult
          | LimitCycleFloquetModesResult
          | Codim1CurveBranch
          | LimitCycleContinuationResult
          | HomoclinicContinuationResult
          | HomotopySaddleContinuationResult
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

  async runIsochroneCurveContinuation(
    request: IsochroneCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runIsochroneCurveContinuation',
      (signal) =>
        this.runWorker(
          'runIsochroneCurveContinuation',
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
    kind: 'computeIsocline',
    payload: ComputeIsoclineRequest,
    signal: AbortSignal
  ): Promise<ComputeIsoclineResult>
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
    kind: 'runEquilibriumManifold1D',
    payload: EquilibriumManifold1DRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<EquilibriumManifold1DResult>
  private runWorker(
    kind: 'runEquilibriumManifold2D',
    payload: EquilibriumManifold2DRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<EquilibriumManifold2DResult>
  private runWorker(
    kind: 'runLimitCycleManifold2D',
    payload: LimitCycleManifold2DRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<LimitCycleManifold2DResult>
  private runWorker(
    kind: 'computeLimitCycleFloquetModes',
    payload: LimitCycleFloquetModesRequest,
    signal: AbortSignal
  ): Promise<LimitCycleFloquetModesResult>
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
    kind: 'runIsochroneCurveContinuation',
    payload: IsochroneCurveContinuationRequest,
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
    kind: 'runLimitCycleContinuationFromOrbit',
    payload: LimitCycleContinuationFromOrbitRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<LimitCycleContinuationResult>
  private runWorker(
    kind: 'runLimitCycleContinuationFromPD',
    payload: LimitCycleContinuationFromPDRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<LimitCycleContinuationResult>
  private runWorker(
    kind: 'runMapCycleContinuationFromPD',
    payload: MapCycleContinuationFromPDRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<EquilibriumContinuationResult>
  private runWorker(
    kind: 'runHomoclinicFromLargeCycle',
    payload: HomoclinicFromLargeCycleRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<HomoclinicContinuationResult>
  private runWorker(
    kind: 'runHomoclinicFromHomoclinic',
    payload: HomoclinicFromHomoclinicRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<HomoclinicContinuationResult>
  private runWorker(
    kind: 'runHomotopySaddleFromEquilibrium',
    payload: HomotopySaddleFromEquilibriumRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<HomotopySaddleContinuationResult>
  private runWorker(
    kind: 'runHomoclinicFromHomotopySaddle',
    payload: HomoclinicFromHomotopySaddleRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<HomoclinicContinuationResult>
  private runWorker(
    kind: 'validateSystem',
    payload: ValidateSystemRequest,
    signal: AbortSignal
  ): Promise<ValidateSystemResult>
  private runWorker(
    kind:
      | 'simulateOrbit'
      | 'sampleMap1DFunction'
      | 'computeIsocline'
      | 'computeLyapunovExponents'
      | 'computeCovariantLyapunovVectors'
      | 'solveEquilibrium'
      | 'runEquilibriumContinuation'
      | 'runContinuationExtension'
      | 'runEquilibriumManifold1D'
      | 'runEquilibriumManifold2D'
      | 'runLimitCycleManifold2D'
      | 'computeLimitCycleFloquetModes'
      | 'runFoldCurveContinuation'
      | 'runHopfCurveContinuation'
      | 'runIsochroneCurveContinuation'
      | 'runLimitCycleContinuationFromHopf'
      | 'runLimitCycleContinuationFromOrbit'
      | 'runLimitCycleContinuationFromPD'
      | 'runMapCycleContinuationFromPD'
      | 'runHomoclinicFromLargeCycle'
      | 'runHomoclinicFromHomoclinic'
      | 'runHomotopySaddleFromEquilibrium'
      | 'runHomoclinicFromHomotopySaddle'
      | 'validateSystem',
    payload:
      | SimulateOrbitRequest
      | SampleMap1DFunctionRequest
      | ComputeIsoclineRequest
      | LyapunovExponentsRequest
      | CovariantLyapunovRequest
      | SolveEquilibriumRequest
      | EquilibriumContinuationRequest
      | ContinuationExtensionRequest
      | EquilibriumManifold1DRequest
      | EquilibriumManifold2DRequest
      | LimitCycleManifold2DRequest
      | LimitCycleFloquetModesRequest
      | FoldCurveContinuationRequest
      | HopfCurveContinuationRequest
      | IsochroneCurveContinuationRequest
      | LimitCycleContinuationFromHopfRequest
      | LimitCycleContinuationFromOrbitRequest
      | LimitCycleContinuationFromPDRequest
      | MapCycleContinuationFromPDRequest
      | HomoclinicFromLargeCycleRequest
      | HomoclinicFromHomoclinicRequest
      | HomotopySaddleFromEquilibriumRequest
      | HomoclinicFromHomotopySaddleRequest
      | ValidateSystemRequest,
    signal: AbortSignal,
    onProgress?: (progress: ContinuationProgress) => void
  ): Promise<
    | SimulateOrbitResult
    | SampleMap1DFunctionResult
    | ComputeIsoclineResult
    | number[]
    | CovariantLyapunovResponse
    | SolveEquilibriumResult
    | ValidateSystemResult
    | EquilibriumContinuationResult
    | ContinuationExtensionResult
    | EquilibriumManifold1DResult
    | EquilibriumManifold2DResult
    | LimitCycleManifold2DResult
    | LimitCycleFloquetModesResult
    | Codim1CurveBranch
    | LimitCycleContinuationResult
    | HomoclinicContinuationResult
    | HomotopySaddleContinuationResult
  > {
    const id = makeStableId('req')
    const message: WorkerRequest =
      kind === 'simulateOrbit'
        ? { id, kind, payload: payload as SimulateOrbitRequest }
        : kind === 'sampleMap1DFunction'
          ? { id, kind, payload: payload as SampleMap1DFunctionRequest }
          : kind === 'computeIsocline'
            ? { id, kind, payload: payload as ComputeIsoclineRequest }
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
              : kind === 'runEquilibriumManifold1D'
                ? { id, kind, payload: payload as EquilibriumManifold1DRequest }
                : kind === 'runEquilibriumManifold2D'
                ? { id, kind, payload: payload as EquilibriumManifold2DRequest }
                  : kind === 'runLimitCycleManifold2D'
                    ? { id, kind, payload: payload as LimitCycleManifold2DRequest }
                    : kind === 'computeLimitCycleFloquetModes'
                      ? { id, kind, payload: payload as LimitCycleFloquetModesRequest }
              : kind === 'runFoldCurveContinuation'
                ? { id, kind, payload: payload as FoldCurveContinuationRequest }
        : kind === 'runHopfCurveContinuation'
          ? { id, kind, payload: payload as HopfCurveContinuationRequest }
          : kind === 'runIsochroneCurveContinuation'
            ? { id, kind, payload: payload as IsochroneCurveContinuationRequest }
          : kind === 'runLimitCycleContinuationFromHopf'
            ? { id, kind, payload: payload as LimitCycleContinuationFromHopfRequest }
            : kind === 'runLimitCycleContinuationFromOrbit'
              ? { id, kind, payload: payload as LimitCycleContinuationFromOrbitRequest }
              : kind === 'runLimitCycleContinuationFromPD'
                ? { id, kind, payload: payload as LimitCycleContinuationFromPDRequest }
                : kind === 'runMapCycleContinuationFromPD'
                  ? { id, kind, payload: payload as MapCycleContinuationFromPDRequest }
                  : kind === 'runHomoclinicFromLargeCycle'
                    ? { id, kind, payload: payload as HomoclinicFromLargeCycleRequest }
                    : kind === 'runHomoclinicFromHomoclinic'
                      ? { id, kind, payload: payload as HomoclinicFromHomoclinicRequest }
                      : kind === 'runHomotopySaddleFromEquilibrium'
                        ? {
                            id,
                            kind,
                            payload: payload as HomotopySaddleFromEquilibriumRequest,
                          }
                        : kind === 'runHomoclinicFromHomotopySaddle'
                          ? {
                              id,
                              kind,
                              payload: payload as HomoclinicFromHomotopySaddleRequest,
                            }
                  : { id, kind, payload: payload as ValidateSystemRequest }

    const promise = new Promise<
      | SimulateOrbitResult
      | SampleMap1DFunctionResult
      | ComputeIsoclineResult
      | number[]
      | CovariantLyapunovResponse
      | SolveEquilibriumResult
      | ValidateSystemResult
      | EquilibriumContinuationResult
      | ContinuationExtensionResult
      | EquilibriumManifold1DResult
      | EquilibriumManifold2DResult
      | LimitCycleManifold2DResult
      | LimitCycleFloquetModesResult
      | Codim1CurveBranch
      | LimitCycleContinuationResult
      | HomoclinicContinuationResult
      | HomotopySaddleContinuationResult
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
