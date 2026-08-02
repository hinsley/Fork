import { describe, expect, it, vi } from 'vitest'
import type { ContinuationProgress } from '../ForkCoreClient'
import {
  runAdaptiveSteppedRunnerToCompletion,
  runRustScheduledRunnerToCompletionAsync,
  runSteppedRunnerToCompletion,
  runSteppedRunnerToCompletionAsync,
} from './steppedRunner'

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

  it('uses a runner batch hint when the current phase has no known total', () => {
    let calls = 0
    const runSteps = vi.fn((batchSize: number) => {
      calls += 1
      return {
        ...makeProgress(calls * batchSize, 0, calls === 2),
        batch_size_hint: 128,
      }
    })
    const runner = {
      get_progress: vi.fn(() => ({
        ...makeProgress(0, 0, false),
        phase: 'exploring_cover' as const,
        batch_size_hint: 128,
      })),
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
    expect(runSteps).toHaveBeenCalledTimes(2)
    expect(runSteps).toHaveBeenCalledWith(128)
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

  it('yields between async batches so a running worker can be cancelled', async () => {
    const controller = new AbortController()
    let currentStep = 0
    const runSteps = vi.fn((batchSize: number) => {
      currentStep += batchSize
      return makeProgress(currentStep, 100, false)
    })
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 100, false)),
      run_steps: runSteps,
      get_result: vi.fn(() => 'complete'),
    }

    await expect(
      runSteppedRunnerToCompletionAsync(runner, controller.signal, (progress) => {
        if (progress.current_step > 0) controller.abort()
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(runSteps).toHaveBeenCalledTimes(1)
    expect(runner.get_result).not.toHaveBeenCalled()
  })

  it('cancels a dynamically growing hinted runner before another batch or result', async () => {
    const controller = new AbortController()
    const runSteps = vi.fn(() => ({
      ...makeProgress(128, 0, false),
      phase: 'exploring_cover' as const,
      batch_size_hint: 128,
    }))
    const runner = {
      get_progress: vi.fn(() => ({
        ...makeProgress(0, 0, false),
        phase: 'exploring_cover' as const,
        batch_size_hint: 128,
      })),
      run_steps: runSteps,
      get_result: vi.fn(() => 'late result'),
    }

    await expect(
      runSteppedRunnerToCompletionAsync(runner, controller.signal, (progress) => {
        if (progress.current_step > 0) controller.abort()
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(runSteps).toHaveBeenCalledTimes(1)
    expect(runSteps).toHaveBeenCalledWith(128)
    expect(runner.get_result).not.toHaveBeenCalled()
  })

  it('lets a Rust-scheduled runner choose each unit of work', async () => {
    let currentStep = 0
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 257, false)),
      advance: vi.fn(() => {
        currentStep = Math.min(257, currentStep + 128)
        return makeProgress(currentStep, 257, currentStep === 257)
      }),
      cancel: vi.fn(),
      get_result: vi.fn(() => 'complete'),
    }

    await expect(runRustScheduledRunnerToCompletionAsync(
      runner,
      new AbortController().signal,
      vi.fn()
    )).resolves.toBe('complete')
    expect(runner.advance).toHaveBeenCalledTimes(3)
    expect(runner.cancel).not.toHaveBeenCalled()
  })

  it('cancels a Rust-scheduled runner and never publishes a late result', async () => {
    const controller = new AbortController()
    const runner = {
      get_progress: vi.fn(() => makeProgress(0, 256, false)),
      advance: vi.fn(() => makeProgress(128, 256, false)),
      cancel: vi.fn(),
      get_result: vi.fn(() => 'late result'),
    }

    await expect(runRustScheduledRunnerToCompletionAsync(
      runner,
      controller.signal,
      (progress) => {
        if (progress.current_step > 0) controller.abort()
      }
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(runner.cancel).toHaveBeenCalledTimes(1)
    expect(runner.advance).toHaveBeenCalledTimes(1)
    expect(runner.get_result).not.toHaveBeenCalled()
  })

  it('captures the adaptation report before a consuming legacy get_result call', () => {
    let consumed = false
    const callOrder: string[] = []
    const runner = {
      get_progress: () => makeProgress(0, 0, true),
      run_steps: vi.fn(),
      get_adaptation_report: () => {
        callOrder.push('report')
        if (consumed) throw new Error('runner already consumed')
        return { current_mesh_points: 8 }
      },
      get_result: () => {
        callOrder.push('result')
        consumed = true
        return { points: [1, 2] }
      },
    }

    expect(runAdaptiveSteppedRunnerToCompletion(
      runner,
      new AbortController().signal,
      vi.fn()
    )).toEqual({
      points: [1, 2],
      collocation_adaptation: { current_mesh_points: 8 },
    })
    expect(callOrder).toEqual(['report', 'result'])
  })

  it('uses the atomic result-with-report getter when available', () => {
    const runner = {
      get_progress: () => makeProgress(0, 0, true),
      run_steps: vi.fn(),
      get_result: vi.fn(() => ({ points: [] })),
      get_adaptation_report: vi.fn(() => ({ current_mesh_points: 4 })),
      get_result_with_report: vi.fn(() => ({
        branch: { points: [1, 2, 3] },
        collocation_adaptation: { current_mesh_points: 12 },
      })),
    }

    expect(runAdaptiveSteppedRunnerToCompletion(
      runner,
      new AbortController().signal,
      vi.fn()
    )).toEqual({
      points: [1, 2, 3],
      collocation_adaptation: { current_mesh_points: 12 },
    })
    expect(runner.get_result_with_report).toHaveBeenCalledTimes(1)
    expect(runner.get_adaptation_report).not.toHaveBeenCalled()
    expect(runner.get_result).not.toHaveBeenCalled()
  })
})
