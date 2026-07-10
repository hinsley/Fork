from pathlib import Path
import re

worker_path = Path('web/src/compute/worker/forkCoreWorker.ts')
source = worker_path.read_text()

import_anchor = "import type { SystemConfig } from '../../system/types'\n"
if source.count(import_anchor) != 1:
    raise SystemExit('Expected one SystemConfig import anchor')
source = source.replace(
    import_anchor,
    import_anchor + "import { runSteppedRunnerToCompletion } from './steppedRunner'\n",
    1,
)

batch_helpers = """
const DEFAULT_PROGRESS_UPDATES = 50

function computeBatchSize(maxSteps: number): number {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) return 1
  return Math.max(1, Math.ceil(maxSteps / DEFAULT_PROGRESS_UPDATES))
}
"""
if source.count(batch_helpers) != 1:
    raise SystemExit('Expected one local batch helper block')
source = source.replace(batch_helpers, '', 1)

loop_prefix = (
    r"  let progress = runner\.get_progress\(\)\n"
    r"  onProgress\(progress\)\n"
    r"\n?"
    r"  const batchSize = computeBatchSize\(progress\.max_steps\)\n"
    r"  while \(!progress\.done\) \{\n"
    r"    abortIfNeeded\(signal\)\n"
    r"    progress = runner\.run_steps\(batchSize\)\n"
    r"    onProgress\(progress\)\n"
    r"  \}\n"
    r"\n?"
)
direct_pattern = re.compile(loop_prefix + r"  return runner\.get_result\(\)")
source, direct_count = direct_pattern.subn(
    '  return runSteppedRunnerToCompletion(runner, signal, onProgress)',
    source,
)
if direct_count != 15:
    raise SystemExit(f'Expected 15 direct runner loops, replaced {direct_count}')

transformed_pattern = re.compile(
    loop_prefix
    + r"  return discardHomoclinicInitialApproximationPoint\(runner\.get_result\(\)\)"
)
source, transformed_count = transformed_pattern.subn(
    "  return discardHomoclinicInitialApproximationPoint(\n"
    "    runSteppedRunnerToCompletion(runner, signal, onProgress)\n"
    "  )",
    source,
)
if transformed_count != 1:
    raise SystemExit(f'Expected one transformed runner loop, replaced {transformed_count}')

if 'computeBatchSize' in source:
    raise SystemExit('Local batch helper references remain')
if 'let progress = runner.get_progress()' in source:
    raise SystemExit('Duplicated stepped runner loops remain')
worker_path.write_text(source)

Path('web/src/compute/worker/steppedRunner.ts').write_text("""import type { ContinuationProgress } from '../ForkCoreClient'

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
""")

Path('web/src/compute/worker/steppedRunner.test.ts').write_text("""import { describe, expect, it, vi } from 'vitest'
import type { ContinuationProgress } from '../ForkCoreClient'
import { runSteppedRunnerToCompletion } from './steppedRunner'

function makeProgress(
  currentStep: number,
  maxSteps: number,
  done: boolean
): ContinuationProgress {
  return {
    done,
    current_step: currentStep,
    max_steps: maxSteps,
    points_computed: currentStep,
    bifurcations_found: 0,
    current_param: currentStep,
  }
}

describe('runSteppedRunnerToCompletion', () => {
  it('drains the runner with bounded batches and reports every progress value', () => {
    let currentStep = 0
    const runSteps = vi.fn((batchSize: number) => {
      currentStep = Math.min(100, currentStep + batchSize)
      return makeProgress(currentStep, 100, currentStep === 100)
    })
    const getResult = vi.fn(() => ({ points: 100 }))
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 100, false)),
      run_steps: runSteps,
      get_result: getResult,
    }
    const onProgress = vi.fn()

    const result = runSteppedRunnerToCompletion(
      runner,
      new AbortController().signal,
      onProgress
    )

    expect(result).toEqual({ points: 100 })
    expect(runSteps).toHaveBeenCalledTimes(50)
    expect(runSteps).toHaveBeenNthCalledWith(1, 2)
    expect(onProgress).toHaveBeenCalledTimes(51)
    expect(onProgress.mock.calls[0]?.[0]).toEqual(makeProgress(0, 100, false))
    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual(makeProgress(100, 100, true))
    expect(getResult).toHaveBeenCalledTimes(1)
  })

  it('uses a batch size of one when max steps is not positive', () => {
    const runSteps = vi.fn(() => makeProgress(1, 0, true))
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 0, false)),
      run_steps: runSteps,
      get_result: vi.fn(() => 'complete'),
    }

    expect(
      runSteppedRunnerToCompletion(
        runner,
        new AbortController().signal,
        vi.fn()
      )
    ).toBe('complete')
    expect(runSteps).toHaveBeenCalledTimes(1)
    expect(runSteps).toHaveBeenCalledWith(1)
  })

  it('returns immediately when the runner is already done', () => {
    const runSteps = vi.fn()
    const getResult = vi.fn(() => 'complete')
    const onProgress = vi.fn()
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 0, true)),
      run_steps: runSteps,
      get_result: getResult,
    }

    expect(
      runSteppedRunnerToCompletion(
        runner,
        new AbortController().signal,
        onProgress
      )
    ).toBe('complete')
    expect(runSteps).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(makeProgress(0, 0, true))
    expect(getResult).toHaveBeenCalledTimes(1)
  })

  it('checks cancellation before running the next batch', () => {
    const controller = new AbortController()
    const runSteps = vi.fn(() => makeProgress(1, 10, true))
    const getResult = vi.fn(() => 'complete')
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 10, false)),
      run_steps: runSteps,
      get_result: getResult,
    }
    let thrown: unknown

    try {
      runSteppedRunnerToCompletion(runner, controller.signal, () => {
        controller.abort()
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('AbortError')
    expect(runSteps).not.toHaveBeenCalled()
    expect(getResult).not.toHaveBeenCalled()
  })
})
""")
