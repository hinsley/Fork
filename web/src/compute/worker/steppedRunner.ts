import type { ContinuationProgress } from '../ForkCoreClient'

const DEFAULT_PROGRESS_UPDATES = 50

export type SteppedRunner<TResult> = {
  get_progress: () => ContinuationProgress
  run_steps: (batchSize: number) => ContinuationProgress
  get_result: () => TResult
}

function computeBatchSize(maxSteps: number): number {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) return 1
  return Math.max(1, Math.ceil(maxSteps / DEFAULT_PROGRESS_UPDATES))
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('cancelled')
  error.name = 'AbortError'
  throw error
}

export function runSteppedRunnerToCompletion<TResult>(
  runner: SteppedRunner<TResult>,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): TResult {
  let progress = runner.get_progress()
  onProgress(progress)

  const batchSize = computeBatchSize(progress.max_steps)
  while (!progress.done) {
    abortIfNeeded(signal)
    progress = runner.run_steps(batchSize)
    onProgress(progress)
  }

  return runner.get_result()
}
