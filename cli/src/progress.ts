import { printProgress, printProgressComplete } from './format';
import { AnalysisProgress, EquilibriumSolveProgress, EquilibriumSolution } from './types';
import { AnalysisRunner, EquilibriumSolverRunner } from './wasm';

const DEFAULT_PROGRESS_UPDATES = 50;

function computeBatchSize(maxSteps: number): number {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(maxSteps / DEFAULT_PROGRESS_UPDATES));
}

export function runAnalysisWithProgress<T>(
  runner: AnalysisRunner<T>,
  label: string
): T {
  let progress: AnalysisProgress = runner.get_progress();
  const batchSize = computeBatchSize(progress.max_steps);

  printProgress(progress.current_step, progress.max_steps, label);

  while (!progress.done) {
    progress = runner.run_steps(batchSize);
    printProgress(progress.current_step, progress.max_steps, label);
  }

  printProgressComplete(label);

  return runner.get_result();
}

export function runEquilibriumSolveWithProgress(
  runner: EquilibriumSolverRunner,
  label: string
): EquilibriumSolution {
  let progress: EquilibriumSolveProgress = runner.get_progress();
  const batchSize = computeBatchSize(progress.max_steps);

  printProgress(progress.iterations, progress.max_steps, label);

  while (!progress.done) {
    progress = runner.run_steps(batchSize);
    printProgress(progress.iterations, progress.max_steps, label);
  }

  printProgressComplete(label);

  return runner.get_result();
}
