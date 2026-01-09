import { makeStableId, nowPerfMs } from '../utils/determinism'

export type JobTiming = {
  id: string
  label: string
  startedAt: number
  finishedAt: number
  durationMs: number
  status: 'completed' | 'cancelled' | 'failed'
}

export type JobHandle<T> = {
  id: string
  label: string
  promise: Promise<T>
  cancel: () => void
  signal: AbortSignal
}

type JobRunner<T> = (signal: AbortSignal) => Promise<T>

type InternalJob = {
  id: string
  label: string
  controller: AbortController
  runner: JobRunner<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

// Timing uses deterministic helpers so tests can assert stable durations.

function createAbortError(label: string) {
  const error = new Error(`Job "${label}" cancelled`)
  error.name = 'AbortError'
  return error
}

export class JobQueue {
  private queue: InternalJob[] = []
  private running = false
  private onTiming?: (timing: JobTiming) => void
  private scheduled = false

  constructor(onTiming?: (timing: JobTiming) => void) {
    this.onTiming = onTiming
  }

  enqueue<T>(label: string, runner: JobRunner<T>, opts?: { signal?: AbortSignal }): JobHandle<T> {
    const controller = new AbortController()
    const id = makeStableId('job')

    if (opts?.signal) {
      if (opts.signal.aborted) {
        controller.abort()
      } else {
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }
    }

    let resolve!: (value: T) => void
    let reject!: (error: Error) => void

    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    const wrappedRunner: JobRunner<unknown> = (signal) => runner(signal)
    const wrappedResolve = (value: unknown) => resolve(value as T)

    this.queue.push({ id, label, controller, runner: wrappedRunner, resolve: wrappedResolve, reject })
    this.scheduleRun()

    return {
      id,
      label,
      promise,
      cancel: () => controller.abort(),
      signal: controller.signal,
    }
  }

  private async runNext() {
    if (this.running) return
    this.running = true

    while (this.queue.length > 0) {
      const job = this.queue.shift()
      if (!job) break

      const startedAt = nowPerfMs()
      if (job.controller.signal.aborted) {
        const error = createAbortError(job.label)
        job.reject(error)
        this.emitTiming(job, startedAt, nowPerfMs(), 'cancelled')
        continue
      }

      try {
        const result = await job.runner(job.controller.signal)
        job.resolve(result)
        this.emitTiming(job, startedAt, nowPerfMs(), 'completed')
      } catch (err) {
        if (job.controller.signal.aborted) {
          const error = createAbortError(job.label)
          job.reject(error)
          this.emitTiming(job, startedAt, nowPerfMs(), 'cancelled')
          continue
        }
        const error = err instanceof Error ? err : new Error(String(err))
        job.reject(error)
        this.emitTiming(job, startedAt, nowPerfMs(), 'failed')
      }
    }

    this.running = false
  }

  private scheduleRun() {
    if (this.scheduled) return
    this.scheduled = true
    const run = () => {
      this.scheduled = false
      void this.runNext()
    }
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(run)
    } else {
      setTimeout(run, 0)
    }
  }

  private emitTiming(
    job: InternalJob,
    startedAt: number,
    finishedAt: number,
    status: JobTiming['status']
  ) {
    if (!this.onTiming) return
    this.onTiming({
      id: job.id,
      label: job.label,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      status,
    })
  }
}
