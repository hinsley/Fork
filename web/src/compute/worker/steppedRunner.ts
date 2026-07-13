import type { ContinuationProgress } from '../ForkCoreClient'

const DEFAULT_PROGRESS_UPDATES = 50

export type SteppedRunner<TResult> = {
  get_progress: () => ContinuationProgress
  run_steps: (batchSize: number) => ContinuationProgress
  get_result: () => TResult
}

type AdaptiveSteppedRunner<TBranch, TReport> = SteppedRunner<TBranch> & {
  get_adaptation_report?: () => TReport | null
  get_result_with_report?: () => {
    branch: TBranch
    collocation_adaptation?: TReport | null
  }
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
  onProgress: (progress: ContinuationProgress) => void,
  terminalGetter?: (runner: SteppedRunner<TResult>) => TResult
): TResult {
  let progress = runner.get_progress()
  onProgress(progress)

  const batchSize = computeBatchSize(progress.max_steps)
  while (!progress.done) {
    abortIfNeeded(signal)
    progress = runner.run_steps(batchSize)
    onProgress(progress)
  }

  return terminalGetter ? terminalGetter(runner) : runner.get_result()
}

export function runAdaptiveSteppedRunnerToCompletion<
  TBranch extends object,
  TReport,
>(
  runner: AdaptiveSteppedRunner<TBranch, TReport>,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): TBranch & { collocation_adaptation?: TReport } {
  return runSteppedRunnerToCompletion(
    runner,
    signal,
    onProgress,
    (completed) => {
      const adaptive = completed as AdaptiveSteppedRunner<TBranch, TReport>
      if (typeof adaptive.get_result_with_report === 'function') {
        const result = adaptive.get_result_with_report()
        return result.collocation_adaptation
          ? { ...result.branch, collocation_adaptation: result.collocation_adaptation }
          : result.branch
      }

      // RunnerHandle::get_result consumes the inner runner. Capture the optional
      // report first for older WASM packages that do not expose the atomic getter.
      const report = typeof adaptive.get_adaptation_report === 'function'
        ? adaptive.get_adaptation_report()
        : null
      const branch = adaptive.get_result()
      return report ? { ...branch, collocation_adaptation: report } : branch
    }
  )
}
