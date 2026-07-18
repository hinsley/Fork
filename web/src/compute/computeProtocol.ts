import type { ContinuationProgress, ForkCoreClient } from './ForkCoreClient'

export type ComputeOperationKind = Exclude<keyof ForkCoreClient, 'close'>

type ComputeMethodContract<K extends ComputeOperationKind> = NonNullable<
  ForkCoreClient[K]
> extends (request: infer Request, opts?: infer Options) => Promise<infer Result>
  ? { request: Request; result: Result; options: Options }
  : never

export type ComputeOperationMap = {
  [K in ComputeOperationKind]: ComputeMethodContract<K>
}

export type ComputeRequest<K extends ComputeOperationKind> = ComputeOperationMap[K] extends {
  request: infer Request
}
  ? Request
  : never

export type ComputeResult<K extends ComputeOperationKind> = ComputeOperationMap[K] extends {
  result: infer Result
}
  ? Result
  : never

type ComputeOptions<K extends ComputeOperationKind> = ComputeOperationMap[K] extends {
  options: infer Options
}
  ? NonNullable<Options>
  : never

export type ProgressOperationKind = {
  [K in ComputeOperationKind]: 'onProgress' extends keyof ComputeOptions<K> ? K : never
}[ComputeOperationKind]

type ComputeOperationMetadata = {
  [K in ComputeOperationKind]: {
    reportsProgress: K extends ProgressOperationKind ? true : false
  }
}

export const computeOperationMetadata = {
  simulateOrbit: { reportsProgress: false },
  sampleMap1DFunction: { reportsProgress: false },
  computeEventSeriesFromOrbit: { reportsProgress: false },
  computeEventSeriesFromSamples: { reportsProgress: false },
  computeIsocline: { reportsProgress: false },
  computeLyapunovExponents: { reportsProgress: false },
  computeCovariantLyapunovVectors: { reportsProgress: false },
  solveEquilibrium: { reportsProgress: false },
  solveForcedPeriodicResponse: { reportsProgress: false },
  runForcedPeriodicResponseContinuation: { reportsProgress: true },
  runEquilibriumContinuation: { reportsProgress: true },
  runContinuationExtension: { reportsProgress: true },
  runEquilibriumManifold1D: { reportsProgress: true },
  runEquilibriumManifold1DExtension: { reportsProgress: true },
  runEquilibriumManifold1DGroupExtension: { reportsProgress: true },
  runManifold2DExtension: { reportsProgress: true },
  runEquilibriumManifold2D: { reportsProgress: true },
  runLimitCycleManifold2D: { reportsProgress: true },
  computeLimitCycleFloquetModes: { reportsProgress: false },
  computeNormalForm: { reportsProgress: false },
  runPeriodicBranchPointSwitch: { reportsProgress: true },
  runFoldCurveContinuation: { reportsProgress: true },
  runHopfCurveContinuation: { reportsProgress: true },
  runCodim2BranchSwitch: { reportsProgress: true },
  runIsoperiodicCurveContinuation: { reportsProgress: true },
  runLimitCycleCodim1CurveContinuation: { reportsProgress: true },
  runLimitCycleContinuationFromHopf: { reportsProgress: true },
  runLimitCycleContinuationFromOrbit: { reportsProgress: true },
  runLimitCycleContinuationFromPD: { reportsProgress: true },
  runHomoclinicFromLargeCycle: { reportsProgress: true },
  runHomoclinicFromHomoclinic: { reportsProgress: true },
  runHomotopySaddleFromEquilibrium: { reportsProgress: true },
  runHomoclinicFromHomotopySaddle: { reportsProgress: true },
  runHeteroclinicFromOrbit: { reportsProgress: true },
  runMapCycleContinuationFromPD: { reportsProgress: true },
  validateSystem: { reportsProgress: false },
} as const satisfies ComputeOperationMetadata

export const computeOperationKinds = Object.freeze(
  Object.keys(computeOperationMetadata) as ComputeOperationKind[]
)

export const progressOperationKinds = Object.freeze(
  computeOperationKinds.filter(
    (kind): kind is ProgressOperationKind => computeOperationMetadata[kind].reportsProgress
  )
)

export type WorkerOperationRequest<
  K extends ComputeOperationKind = ComputeOperationKind,
> = {
  [Operation in K]: {
    id: string
    kind: Operation
    payload: ComputeRequest<Operation>
  }
}[K]

export type WorkerCancelRequest = { id: string; kind: 'cancel' }
export type WorkerRequest = WorkerOperationRequest | WorkerCancelRequest

export type WorkerSuccessResponse<
  K extends ComputeOperationKind = ComputeOperationKind,
> = {
  [Operation in K]: {
    id: string
    ok: true
    result: ComputeResult<Operation>
  }
}[K]

export type WorkerErrorResponse = {
  id: string
  ok: false
  error: string
  aborted?: boolean
}

export type WorkerProgressResponse = {
  id: string
  kind: 'progress'
  progress: ContinuationProgress
}

export type WorkerResponse =
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerProgressResponse

export type ComputeHandler<K extends ComputeOperationKind> = (
  request: ComputeRequest<K>,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
) => ComputeResult<K> | Promise<ComputeResult<K>>

export type ComputeHandlerMap = {
  [K in ComputeOperationKind]: ComputeHandler<K>
}

export function getComputeHandler<K extends ComputeOperationKind>(
  handlers: ComputeHandlerMap,
  kind: K
): ComputeHandler<K> {
  return handlers[kind]
}

export function createWorkerRequest<K extends ComputeOperationKind>(
  id: string,
  kind: K,
  payload: ComputeRequest<K>
): WorkerOperationRequest<K> {
  return { id, kind, payload } as WorkerOperationRequest<K>
}

export function createWorkerSuccessResponse<K extends ComputeOperationKind>(
  request: WorkerOperationRequest<K>,
  result: ComputeResult<K>
): WorkerSuccessResponse<K> {
  return { id: request.id, ok: true, result } as WorkerSuccessResponse<K>
}
