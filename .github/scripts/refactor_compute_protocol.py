from pathlib import Path


PROTOCOL_SOURCE = """import type { ContinuationProgress, ForkCoreClient } from './ForkCoreClient'

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
  runEquilibriumContinuation: { reportsProgress: true },
  runContinuationExtension: { reportsProgress: true },
  runEquilibriumManifold1D: { reportsProgress: true },
  runEquilibriumManifold1DExtension: { reportsProgress: true },
  runManifold2DExtension: { reportsProgress: true },
  runEquilibriumManifold2D: { reportsProgress: true },
  runLimitCycleManifold2D: { reportsProgress: true },
  computeLimitCycleFloquetModes: { reportsProgress: false },
  runFoldCurveContinuation: { reportsProgress: true },
  runHopfCurveContinuation: { reportsProgress: true },
  runIsochroneCurveContinuation: { reportsProgress: true },
  runLimitCycleContinuationFromHopf: { reportsProgress: true },
  runLimitCycleContinuationFromOrbit: { reportsProgress: true },
  runLimitCycleContinuationFromPD: { reportsProgress: true },
  runHomoclinicFromLargeCycle: { reportsProgress: true },
  runHomoclinicFromHomoclinic: { reportsProgress: true },
  runHomotopySaddleFromEquilibrium: { reportsProgress: true },
  runHomoclinicFromHomotopySaddle: { reportsProgress: true },
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
"""


WASM_GENERIC_RUNNER = """  private runWorker<K extends ComputeOperationKind>(
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
"""


WORKER_DISPATCH = """const handlers = {
  simulateOrbit: runOrbit,
  sampleMap1DFunction: runSampleMap1DFunction,
  computeEventSeriesFromOrbit: runComputeEventSeriesFromOrbit,
  computeEventSeriesFromSamples: runComputeEventSeriesFromSamples,
  computeIsocline: runComputeIsocline,
  computeLyapunovExponents: runLyapunovExponents,
  computeCovariantLyapunovVectors: runCovariantLyapunovVectors,
  solveEquilibrium: runSolveEquilibrium,
  runEquilibriumContinuation,
  runContinuationExtension,
  runEquilibriumManifold1D,
  runEquilibriumManifold1DExtension,
  runManifold2DExtension,
  runEquilibriumManifold2D,
  runLimitCycleManifold2D,
  computeLimitCycleFloquetModes: runComputeLimitCycleFloquetModes,
  runFoldCurveContinuation,
  runHopfCurveContinuation,
  runIsochroneCurveContinuation,
  runLimitCycleContinuationFromHopf,
  runLimitCycleContinuationFromOrbit,
  runLimitCycleContinuationFromPD,
  runHomoclinicFromLargeCycle,
  runHomoclinicFromHomoclinic,
  runHomotopySaddleFromEquilibrium,
  runHomoclinicFromHomotopySaddle,
  runMapCycleContinuationFromPD,
  validateSystem: runValidateSystem,
} satisfies ComputeHandlerMap

const ctx = self as DedicatedWorkerGlobalScope

async function dispatchWorkerOperation<K extends ComputeOperationKind>(
  message: WorkerOperationRequest<K>,
  controller: AbortController
): Promise<void> {
  const handler = handlers[message.kind] as ComputeHandler<K>
  const result = await handler(message.payload, controller.signal, (progress) => {
    const response: WorkerResponse = { id: message.id, kind: 'progress', progress }
    ctx.postMessage(response)
  })
  ctx.postMessage(createWorkerSuccessResponse(message, result))
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.kind === 'cancel') {
    const controller = pendingControllers.get(message.id)
    if (controller) {
      controller.abort()
      pendingControllers.delete(message.id)
    }
    return
  }

  const controller = new AbortController()
  pendingControllers.set(message.id, controller)

  try {
    await dispatchWorkerOperation(message, controller)
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const response: WorkerResponse = {
      id: message.id,
      ok: false,
      error: error.message,
      aborted: error.name === 'AbortError',
    }
    ctx.postMessage(response)
  } finally {
    pendingControllers.delete(message.id)
  }
}
"""


def replace_between(source: str, start_marker: str, end_marker: str, replacement: str) -> str:
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f'Missing start marker: {start_marker!r}')
    end = source.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'Missing end marker: {end_marker!r}')
    return source[:start] + replacement + source[end:]


def update_wasm_client() -> None:
    path = Path('web/src/compute/wasmClient.ts')
    source = path.read_text()

    import_anchor = "import { makeStableId } from '../utils/determinism'\n"
    protocol_import = """import { createWorkerRequest } from './computeProtocol'
import type {
  ComputeOperationKind,
  ComputeRequest,
  ComputeResult,
  WorkerRequest,
  WorkerResponse,
} from './computeProtocol'
"""
    if source.count(import_anchor) != 1:
        raise RuntimeError('Expected one wasm client import anchor')
    source = source.replace(import_anchor, import_anchor + protocol_import, 1)

    source = replace_between(
        source,
        'type WorkerRequest =',
        'export class WasmForkCoreClient',
        '',
    )

    pending_start = source.find('  private pending = new Map<')
    constructor_start = source.find('\n\n  constructor(', pending_start)
    if pending_start < 0 or constructor_start < 0:
        raise RuntimeError('Could not locate pending map')
    pending = """  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      onProgress?: (progress: ContinuationProgress) => void
    }
  >()"""
    source = source[:pending_start] + pending + source[constructor_start:]

    overload_start = source.find("  private runWorker(\n    kind: 'simulateOrbit',")
    class_end = source.rfind('\n}')
    if overload_start < 0 or class_end < 0 or class_end <= overload_start:
        raise RuntimeError('Could not locate runWorker overload block')
    source = source[:overload_start] + WASM_GENERIC_RUNNER + source[class_end:]

    if 'type WorkerRequest =' in source:
        raise RuntimeError('Local WorkerRequest declaration remains in wasm client')
    if "kind: 'sampleMap1DFunction',\n    payload:" in source:
        raise RuntimeError('runWorker overloads remain in wasm client')
    if "kind === 'simulateOrbit'" in source:
        raise RuntimeError('Nested request construction remains in wasm client')

    path.write_text(source)


def update_worker() -> None:
    path = Path('web/src/compute/worker/forkCoreWorker.ts')
    source = path.read_text()

    import_anchor = "import { runSteppedRunnerToCompletion } from './steppedRunner'\n"
    protocol_import = """import { createWorkerSuccessResponse } from '../computeProtocol'
import type {
  ComputeHandler,
  ComputeHandlerMap,
  ComputeOperationKind,
  WorkerOperationRequest,
  WorkerRequest,
  WorkerResponse,
} from '../computeProtocol'
"""
    if source.count(import_anchor) != 1:
        raise RuntimeError('Expected one worker import anchor')
    source = source.replace(import_anchor, import_anchor + protocol_import, 1)

    source = replace_between(source, 'type WorkerRequest =', 'type WasmModule =', '')

    dispatch_start = source.find('const ctx = self as DedicatedWorkerGlobalScope')
    if dispatch_start < 0:
        raise RuntimeError('Could not locate worker dispatch block')
    source = source[:dispatch_start] + WORKER_DISPATCH

    if 'type WorkerRequest =' in source:
        raise RuntimeError('Local WorkerRequest declaration remains in worker')
    if "if (message.kind === 'simulateOrbit')" in source:
        raise RuntimeError('Worker dispatch ladder remains')

    path.write_text(source)


def main() -> None:
    Path('web/src/compute/computeProtocol.ts').write_text(PROTOCOL_SOURCE)
    update_wasm_client()
    update_worker()


if __name__ == '__main__':
    main()
