import type {
  ForkCoreClient,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from './ForkCoreClient'
import { JobQueue } from './jobQueue'

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerResponse =
  | { id: string; ok: true; result: SimulateOrbitResult | ValidateSystemResult }
  | { id: string; ok: false; error: string; aborted?: boolean }

export class WasmForkCoreClient implements ForkCoreClient {
  private worker: Worker
  private queue: JobQueue
  private pending = new Map<
    string,
    {
      resolve: (value: SimulateOrbitResult | ValidateSystemResult) => void
      reject: (error: Error) => void
    }
  >()

  constructor(queue?: JobQueue) {
    this.queue = queue ?? new JobQueue()
    this.worker = new Worker(new URL('./worker/forkCoreWorker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
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
    kind: 'validateSystem',
    payload: ValidateSystemRequest,
    signal: AbortSignal
  ): Promise<ValidateSystemResult>
  private runWorker(
    kind: 'simulateOrbit' | 'validateSystem',
    payload: SimulateOrbitRequest | ValidateSystemRequest,
    signal: AbortSignal
  ): Promise<SimulateOrbitResult | ValidateSystemResult> {
    const id = `req_${Math.random().toString(36).slice(2, 10)}`
    const message: WorkerRequest =
      kind === 'simulateOrbit'
        ? { id, kind, payload: payload as SimulateOrbitRequest }
        : { id, kind, payload: payload as ValidateSystemRequest }

    const promise = new Promise<SimulateOrbitResult | ValidateSystemResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
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
