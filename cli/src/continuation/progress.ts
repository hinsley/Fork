import { printProgress, printProgressComplete } from '../format';
import { ContinuationBranchData, ContinuationProgress } from '../types';
import { WasmBridge } from '../wasm';

const DEFAULT_PROGRESS_UPDATES = 50;

/**
 * Choose a batch size that keeps progress updates bounded without
 * forcing excessive cross-language calls.
 */
function computeBatchSize(maxSteps: number): number {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(maxSteps / DEFAULT_PROGRESS_UPDATES));
}

type ContinuationRunner<T> = {
  run_steps(batchSize: number): ContinuationProgress;
  get_progress(): ContinuationProgress;
  get_result(): T;
};

/**
 * Run a stepped continuation runner and render a progress bar.
 */
function runContinuationRunnerWithProgress<T>(
  runner: ContinuationRunner<T>,
  label: string
): T {
  let progress: ContinuationProgress = runner.get_progress();
  const batchSize = computeBatchSize(progress.max_steps);

  printProgress(progress.current_step, progress.max_steps, label);

  while (!progress.done) {
    progress = runner.run_steps(batchSize);
    printProgress(progress.current_step, progress.max_steps, label);
  }

  printProgressComplete(label);

  return runner.get_result();
}

/**
 * Continue equilibria with stepped progress updates.
 */
export function runEquilibriumContinuationWithProgress(
  bridge: WasmBridge,
  equilibriumState: number[],
  parameterName: string,
  mapIterations: number,
  settings: any,
  forward: boolean,
  label: string
): ContinuationBranchData {
  const runner = bridge.createEquilibriumContinuationRunner(
    equilibriumState,
    parameterName,
    mapIterations,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue limit cycles with stepped progress updates.
 */
export function runLimitCycleContinuationWithProgress(
  bridge: WasmBridge,
  setup: any,
  parameterName: string,
  settings: any,
  forward: boolean,
  label: string
): ContinuationBranchData {
  const runner = bridge.createLimitCycleContinuationRunner(
    setup,
    parameterName,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue a homoclinic curve with stepped progress updates.
 */
export function runHomoclinicContinuationWithProgress(
  bridge: WasmBridge,
  setup: any,
  settings: any,
  forward: boolean,
  label: string
): ContinuationBranchData {
  const runner = bridge.createHomoclinicContinuationRunner(
    setup,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue a homotopy-saddle curve with stepped progress updates.
 */
export function runHomotopySaddleContinuationWithProgress(
  bridge: WasmBridge,
  setup: any,
  settings: any,
  forward: boolean,
  label: string
): ContinuationBranchData {
  const runner = bridge.createHomotopySaddleContinuationRunner(
    setup,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Extend an existing branch while reporting progress.
 */
export function runContinuationExtensionWithProgress(
  bridge: WasmBridge,
  branchData: ContinuationBranchData,
  parameterName: string,
  mapIterations: number,
  settings: any,
  forward: boolean,
  label: string
): ContinuationBranchData {
  const runner = bridge.createContinuationExtensionRunner(
    branchData,
    parameterName,
    mapIterations,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue a fold curve with stepped progress updates.
 */
export function runFoldCurveWithProgress(
  bridge: WasmBridge,
  foldState: number[],
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  mapIterations: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createFoldCurveRunner(
    foldState,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    mapIterations,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue a Hopf curve with stepped progress updates.
 */
export function runHopfCurveWithProgress(
  bridge: WasmBridge,
  hopfState: number[],
  hopfOmega: number,
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  mapIterations: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createHopfCurveRunner(
    hopfState,
    hopfOmega,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    mapIterations,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue an LPC curve with stepped progress updates.
 */
export function runLPCCurveWithProgress(
  bridge: WasmBridge,
  lcState: number[],
  period: number,
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  ntst: number,
  ncol: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createLPCCurveRunner(
    lcState,
    period,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    ntst,
    ncol,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue an isochrone curve with stepped progress updates.
 */
export function runIsochroneCurveWithProgress(
  bridge: WasmBridge,
  lcState: number[],
  period: number,
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  ntst: number,
  ncol: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createIsochroneCurveRunner(
    lcState,
    period,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    ntst,
    ncol,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue a PD curve with stepped progress updates.
 */
export function runPDCurveWithProgress(
  bridge: WasmBridge,
  lcState: number[],
  period: number,
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  ntst: number,
  ncol: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createPDCurveRunner(
    lcState,
    period,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    ntst,
    ncol,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}

/**
 * Continue an NS curve with stepped progress updates.
 */
export function runNSCurveWithProgress(
  bridge: WasmBridge,
  lcState: number[],
  period: number,
  param1Name: string,
  param1Value: number,
  param2Name: string,
  param2Value: number,
  initialK: number,
  ntst: number,
  ncol: number,
  settings: any,
  forward: boolean,
  label: string
): any {
  const runner = bridge.createNSCurveRunner(
    lcState,
    period,
    param1Name,
    param1Value,
    param2Name,
    param2Value,
    initialK,
    ntst,
    ncol,
    settings,
    forward
  );

  return runContinuationRunnerWithProgress(runner, label);
}
