/**
 * Codim-1 Curve Continuation Module
 * 
 * Handles initiating two-parameter continuation of codim-1 bifurcation curves
 * (Fold and Hopf curves) from detected bifurcation points.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { ContinuationObject, ContinuationPoint } from '../types';
import {
  ConfigEntry,
  MENU_PAGE_SIZE,
  formatUnset,
  parseFloatOrDefault,
  parseIntOrDefault,
  runConfigMenu
} from '../menu';
import { printSuccess, printError, printInfo } from '../format';
import { isValidName, getBranchParams } from './utils';
import {
  runFoldCurveWithProgress,
  runHopfCurveWithProgress,
  runIsochroneCurveWithProgress,
  runLPCCurveWithProgress,
  runPDCurveWithProgress,
  runNSCurveWithProgress
} from './progress';

type EigenvalueWire = [number, number];

function normalizeEigenvalues(raw: ContinuationPoint['eigenvalues'] | undefined): Array<{ re: number; im: number }> {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((entry: any) => {
    if (Array.isArray(entry)) {
      const tuple = entry as EigenvalueWire;
      return { re: tuple[0] ?? 0, im: tuple[1] ?? 0 };
    }
    return {
      re: typeof entry?.re === 'number' ? entry.re : Number(entry?.re ?? 0),
      im: typeof entry?.im === 'number' ? entry.im : Number(entry?.im ?? 0),
    };
  });
}

function extractHopfOmega(point: ContinuationPoint): number {
  const eigenvalues = normalizeEigenvalues(point.eigenvalues);
  if (eigenvalues.length === 0) return 1.0;

  let maxAbsIm = 0;
  for (const eig of eigenvalues) {
    if (!Number.isFinite(eig.re) || !Number.isFinite(eig.im)) continue;
    maxAbsIm = Math.max(maxAbsIm, Math.abs(eig.im));
  }
  if (maxAbsIm <= 0) return 1.0;

  const minImag = maxAbsIm * 1e-3;
  let bestRe = Number.POSITIVE_INFINITY;
  let bestIm = 0;
  for (const eig of eigenvalues) {
    if (!Number.isFinite(eig.re) || !Number.isFinite(eig.im)) continue;
    const absIm = Math.abs(eig.im);
    if (absIm < minImag) continue;
    const absRe = Math.abs(eig.re);
    if (absRe < bestRe || (absRe === bestRe && absIm > Math.abs(bestIm))) {
      bestRe = absRe;
      bestIm = eig.im;
    }
  }

  if (bestIm === 0) {
    bestIm = maxAbsIm;
  }

  return Math.abs(bestIm) || 1.0;
}

/**
 * Initiates fold curve continuation from a Fold bifurcation point.
 * 
 * Tracks the fold bifurcation in two-parameter space, detecting
 * codim-2 bifurcations like Cusp, Bogdanov-Takens, and Zero-Hopf.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - Source equilibrium branch containing the fold point
 * @param foldPoint - The Fold bifurcation point (must have stability='Fold')
 * @param foldPointIndex - Array index of the fold point
 */
export async function initiateFoldCurve(
  sysName: string,
  branch: ContinuationObject,
  foldPoint: ContinuationPoint,
  foldPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const mapIterations = sysConfig.type === 'map' ? branch.mapIterations ?? 1 : 1;
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters. Add another parameter first.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  // Param1 is the continuation parameter from the source branch
  const param1Name = branch.parameterName;
  const param1Value = foldPoint.param_value;

  // Select param2 (default to first parameter that isn't param1)
  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  const param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  // Configuration
  let curveName = `fold_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        const idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[idx];
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the fold curve:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('Fold Curve Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking fold bifurcation in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure Fold Curve Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running Fold Curve Continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    // Build system config with the parameter values from the source branch
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    // Set param1 to the fold point value
    const idx1 = paramNames.indexOf(param1Name);
    if (idx1 >= 0) runConfig.params[idx1] = param1Value;

    const bridge = new WasmBridge(runConfig);

    const curveData = runFoldCurveWithProgress(
      bridge,
      foldPoint.state,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      mapIterations,
      continuationSettings,
      directionForward,
      'Fold Curve'
    );

    const numPoints = curveData?.points?.length ?? 0;
    const numCodim2 = curveData?.codim2_bifurcations?.length ?? 0;

    printSuccess(`Fold curve continuation complete! ${numPoints} points, ${numCodim2} codim-2 bifurcations detected.`);

    if (numCodim2 > 0) {
      console.log(chalk.yellow('\nDetected Codim-2 Bifurcations:'));
      curveData.codim2_bifurcations.forEach((bif: any, i: number) => {
        console.log(`  ${i + 1}. ${bif.type || 'Unknown'} at index ${bif.index ?? '?'}`);
      });
    }

    // Convert WASM curve data to ContinuationBranchData format for storage
    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || foldPoint.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          // Handle both array format [re, im] and object format {re, im}
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        })
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices: curveData.points.map((_: any, i: number) => i),
      branch_type: {
        type: 'FoldCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name
      }
    };

    // Create the continuation branch object
    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,  // Two-parameter notation
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'fold_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
      mapIterations: sysConfig.type === 'map' ? mapIterations : undefined
    };

    // Save the branch
    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved fold curve branch: ${curveName}`);

    return newBranch;

  } catch (e) {
    printError(`Fold Curve Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates Hopf curve continuation from a Hopf bifurcation point.
 * 
 * Tracks the Hopf bifurcation in two-parameter space, detecting
 * codim-2 bifurcations like Bogdanov-Takens, Zero-Hopf, Double-Hopf, 
 * and Generalized Hopf (Bautin).
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - Source equilibrium branch containing the Hopf point
 * @param hopfPoint - The Hopf bifurcation point (must have stability='Hopf')
 * @param hopfPointIndex - Array index of the Hopf point
 */
export async function initiateHopfCurve(
  sysName: string,
  branch: ContinuationObject,
  hopfPoint: ContinuationPoint,
  hopfPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const mapIterations = sysConfig.type === 'map' ? branch.mapIterations ?? 1 : 1;
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters. Add another parameter first.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  // Extract Hopf frequency from eigenvalues
  const hopfOmega = extractHopfOmega(hopfPoint);

  // Param1 is the continuation parameter from the source branch
  const param1Name = branch.parameterName;
  const param1Value = hopfPoint.param_value;

  // Select param2 (default to first parameter that isn't param1)
  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  const param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  // Configuration
  let curveName = `hopf_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        const idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[idx];
      }
    },
    {
      id: 'hopfFreq',
      label: 'Hopf frequency (ω)',
      section: 'Two-Parameter Setup',
      getDisplay: () => hopfOmega.toFixed(6),
      edit: async () => {
        printInfo(`Hopf frequency extracted from eigenvalues: ω = ${hopfOmega.toFixed(6)}`);
        printInfo("This is automatically computed and typically should not be changed.");
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the Hopf curve:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('Hopf Curve Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking Hopf bifurcation in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}, ω=${hopfOmega.toFixed(4)}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure Hopf Curve Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running Hopf Curve Continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    // Build system config with the parameter values from the source branch
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    // Set param1 to the Hopf point value
    const idx1 = paramNames.indexOf(param1Name);
    if (idx1 >= 0) runConfig.params[idx1] = param1Value;

    const bridge = new WasmBridge(runConfig);

    const curveData = runHopfCurveWithProgress(
      bridge,
      hopfPoint.state,
      hopfOmega,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      mapIterations,
      continuationSettings,
      directionForward,
      'Hopf Curve'
    );

    // For now, just log results since we don't have a viewer for 2D curves yet
    const numPoints = curveData?.points?.length ?? 0;
    const numCodim2 = curveData?.codim2_bifurcations?.length ?? 0;

    printSuccess(`Hopf curve continuation complete! ${numPoints} points, ${numCodim2} codim-2 bifurcations detected.`);

    if (numCodim2 > 0) {
      console.log(chalk.yellow('\nDetected Codim-2 Bifurcations:'));
      curveData.codim2_bifurcations.forEach((bif: any, i: number) => {
        console.log(`  ${i + 1}. ${bif.type || 'Unknown'} at index ${bif.index ?? '?'}`);
      });
    }

    // Debug: log first point's raw data
    if (curveData.points && curveData.points.length > 0) {
      const firstPt = curveData.points[0];
      console.log(chalk.gray('\n[DEBUG] First point raw data:'));
      console.log(chalk.gray(`  state: [${firstPt.state?.join(', ')}]`));
      console.log(chalk.gray(`  param1_value: ${firstPt.param1_value}`));
      console.log(chalk.gray(`  param2_value: ${firstPt.param2_value}`));
      console.log(chalk.gray(`  eigenvalues: ${JSON.stringify(firstPt.eigenvalues)}`));
    }

    // Convert WASM curve data to ContinuationBranchData format for storage
    // Note: eigenvalues come as [re, im] arrays from WASM, convert to {re, im} objects
    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || hopfPoint.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          // Handle both array format [re, im] and object format {re, im}
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        }),
        auxiliary: pt.auxiliary
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices: curveData.points.map((_: any, i: number) => i),
      branch_type: {
        type: 'HopfCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name
      }
    };

    // Create the continuation branch object
    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,  // Two-parameter notation
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'hopf_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
      mapIterations: sysConfig.type === 'map' ? mapIterations : undefined
    };

    // Save the branch
    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved Hopf curve branch: ${curveName}`);

    return newBranch;

  } catch (e) {
    printError(`Hopf Curve Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates LPC (Limit Point of Cycles) curve continuation from a CycleFold point.
 */
export async function initiateLPCCurve(
  sysName: string,
  branch: ContinuationObject,
  lpcPoint: ContinuationPoint,
  lpcPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  // Extract ntst/ncol from branch type
  const bt = branch.branchType;
  if (bt !== 'limit_cycle' || !branch.data?.branch_type) {
    printError("LPC curve requires a limit cycle branch");
    return null;
  }
  const lcBranchType = branch.data.branch_type as { type: 'LimitCycle'; ntst: number; ncol: number };
  const ntst = lcBranchType.ntst || 20;
  const ncol = lcBranchType.ncol || 4;

  // Param1 is the continuation parameter from the source branch
  const param1Name = branch.parameterName;
  const param1Value = lpcPoint.param_value;
  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  let param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  // Configuration variables
  let curveName = `lpc_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        param2Idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[param2Idx];
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the LPC curve:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('LPC Curve Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking fold of limit cycles in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure LPC Curve Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running LPC curve continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];
    runConfig.params[paramNames.indexOf(param1Name)] = param1Value;

    const bridge = new WasmBridge(runConfig);

    // Extract period from end of state, and LC coords without period
    const lcPeriod = lpcPoint.state[lpcPoint.state.length - 1];
    const lcCoords = lpcPoint.state.slice(0, -1);

    const curveData = runLPCCurveWithProgress(
      bridge,
      lcCoords,
      lcPeriod,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      ntst,
      ncol,
      continuationSettings,
      directionForward,
      'LPC Curve'
    );

    if (!curveData || !curveData.points || curveData.points.length === 0) {
      printError('LPC curve returned no points');
      return null;
    }

    printSuccess(`LPC curve computed: ${curveData.points.length} points`);

    // Convert to branch data
    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || lpcPoint.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        }),
        auxiliary: pt.auxiliary
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices: curveData.points.map((_: any, i: number) => i),
      branch_type: {
        type: 'LPCCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name,
        ntst,
        ncol
      }
    };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'lpc_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved LPC curve branch: ${curveName}`);
    return newBranch;

  } catch (e) {
    printError(`LPC Curve Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates isochrone continuation from a limit-cycle or isochrone point.
 */
export async function initiateIsochroneCurve(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  const bt = branch.branchType;
  if ((bt !== 'limit_cycle' && bt !== 'isochrone_curve') || !branch.data?.branch_type) {
    printError("Isochrone continuation requires a limit cycle or isochrone branch");
    return null;
  }
  const lcBranchType = branch.data.branch_type as
    | { type: 'LimitCycle'; ntst: number; ncol: number }
    | {
        type: 'IsochroneCurve';
        param1_name: string;
        param2_name: string;
        ntst: number;
        ncol: number;
      };
  if (lcBranchType.type !== 'LimitCycle' && lcBranchType.type !== 'IsochroneCurve') {
    printError('Limit cycle mesh metadata is missing for this branch');
    return null;
  }
  const ntst = lcBranchType.ntst || 20;
  const ncol = lcBranchType.ncol || 4;

  const sourceParam1Name =
    lcBranchType.type === 'IsochroneCurve' ? lcBranchType.param1_name : branch.parameterName;
  if (!paramNames.includes(sourceParam1Name)) {
    printError('Source continuation parameter is not defined in this system.');
    return null;
  }

  const sourceParam1Idx = paramNames.indexOf(sourceParam1Name);
  if (sourceParam1Idx >= 0) {
    branchParams[sourceParam1Idx] = point.param_value;
  }
  if (lcBranchType.type === 'IsochroneCurve' && Number.isFinite(point.param2_value)) {
    const sourceParam2Idx = paramNames.indexOf(lcBranchType.param2_name);
    if (sourceParam2Idx >= 0) {
      branchParams[sourceParam2Idx] = point.param2_value as number;
    }
  }

  let param1Name = sourceParam1Name;
  let param1Idx = paramNames.indexOf(param1Name);
  let param1Value = branchParams[param1Idx];

  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  let param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  const period = point.state[point.state.length - 1];
  if (!Number.isFinite(period) || period <= 0) {
    printError("Selected point has no valid period");
    return null;
  }

  // Configuration variables
  let curveName = `isochrone_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param1',
      label: 'First parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param1Name} = ${param1Value}`,
      edit: async () => {
        const choices = paramNames.map(p => {
          const idx = paramNames.indexOf(p);
          return { name: `${p} (current: ${branchParams[idx]})`, value: p };
        });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select first continuation parameter:',
          choices,
          default: param1Name,
          pageSize: MENU_PAGE_SIZE
        });
        param1Name = value;
        param1Idx = paramNames.indexOf(param1Name);
        param1Value = branchParams[param1Idx];
        if (param2Name === param1Name) {
          param2Name = paramNames.find(p => p !== param1Name) || param1Name;
        }
        param2Idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[param2Idx];
      }
    },
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        param2Idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[param2Idx];
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the isochrone curve:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('Isochrone Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking fixed-period curve in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}, period=${period}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure Isochrone Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    break;
  }

  if (param1Name === param2Name) {
    printError('Second parameter must be different from the first continuation parameter.');
    return null;
  }
  if (!Number.isFinite(param1Value)) {
    printError('Selected first continuation parameter has no valid value.');
    return null;
  }
  if (!Number.isFinite(param2Value)) {
    printError('Selected second continuation parameter has no valid value.');
    return null;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running isochrone continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];
    runConfig.params[param1Idx] = param1Value;
    runConfig.params[param2Idx] = param2Value;

    const bridge = new WasmBridge(runConfig);
    const lcCoords = point.state.slice(0, -1);

    const curveData = runIsochroneCurveWithProgress(
      bridge,
      lcCoords,
      period,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      ntst,
      ncol,
      continuationSettings,
      directionForward,
      'Isochrone'
    );

    if (!curveData || !curveData.points || curveData.points.length === 0) {
      printError('Isochrone continuation returned no points');
      return null;
    }

    printSuccess(`Isochrone computed: ${curveData.points.length} points`);

    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || point.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        }),
        auxiliary: pt.auxiliary
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices:
        Array.isArray(curveData.indices) && curveData.indices.length === curveData.points.length
          ? curveData.indices
          : curveData.points.map((_: any, i: number) => (directionForward || i === 0 ? i : -i)),
      branch_type: {
        type: 'IsochroneCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name,
        ntst,
        ncol
      }
    };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'isochrone_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved isochrone curve branch: ${curveName}`);
    return newBranch;

  } catch (e) {
    printError(`Isochrone Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates PD (Period-Doubling) curve continuation from a PeriodDoubling point.
 */
export async function initiatePDCurve(
  sysName: string,
  branch: ContinuationObject,
  pdPoint: ContinuationPoint,
  pdPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  const bt = branch.branchType;
  if (bt !== 'limit_cycle' || !branch.data?.branch_type) {
    printError("PD curve requires a limit cycle branch");
    return null;
  }
  const lcBranchType = branch.data.branch_type as { type: 'LimitCycle'; ntst: number; ncol: number };
  const ntst = lcBranchType.ntst || 20;
  const ncol = lcBranchType.ncol || 4;

  const param1Name = branch.parameterName;
  const param1Value = pdPoint.param_value;
  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  let param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  // Configuration variables
  let curveName = `pd_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        param2Idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[param2Idx];
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        // Get existing branches for uniqueness check
        const existingBranches = Storage.listBranches(sysName, branch.parentObject);
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the PD curve:',
          default: curveName,
          validate: (val: string) => {
            if (!isValidName(val)) return 'Invalid name format';
            if (existingBranches.includes(val) && val !== curveName) {
              return `A branch named "${val}" already exists for this limit cycle`;
            }
            return true;
          }
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('PD Curve Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking period-doubling in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure PD Curve Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    // Check for duplicate branch name under the LC object
    const existingBranches = Storage.listBranches(sysName, branch.parentObject);
    if (existingBranches.includes(curveName)) {
      printError(`A branch named "${curveName}" already exists for this limit cycle. Please choose a different name.`);
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running PD curve continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];
    runConfig.params[paramNames.indexOf(param1Name)] = param1Value;

    const bridge = new WasmBridge(runConfig);

    // Extract period from end of state, and LC coords without period suffix
    // pdPoint.state from ContinuationPoint = [mesh, stages, T] (NO param prefix)
    // param_value is stored separately in ContinuationPoint
    const lcPeriod = pdPoint.state[pdPoint.state.length - 1];
    const lcCoords = pdPoint.state.slice(0, -1);  // Just strip period at end

    const curveData = runPDCurveWithProgress(
      bridge,
      lcCoords,
      lcPeriod,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      ntst,
      ncol,
      continuationSettings,
      directionForward,
      'PD Curve'
    );

    if (!curveData || !curveData.points || curveData.points.length === 0) {
      printError('PD curve returned no points');
      return null;
    }

    printSuccess(`PD curve computed: ${curveData.points.length} points`);

    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || pdPoint.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        }),
        auxiliary: pt.auxiliary
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices: curveData.points.map((_: any, i: number) => i),
      branch_type: {
        type: 'PDCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name,
        ntst,
        ncol
      }
    };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,  // LC object is the parent
      startObject: branch.name,
      branchType: 'pd_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
    };

    Storage.saveBranch(sysName, branch.parentObject, newBranch);  // Save under LC object
    printSuccess(`Saved PD curve branch: ${curveName}`);
    return newBranch;

  } catch (e) {
    printError(`PD Curve Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates NS (Neimark-Sacker) curve continuation from a NeimarkSacker point.
 */
export async function initiateNSCurve(
  sysName: string,
  branch: ContinuationObject,
  nsPoint: ContinuationPoint,
  nsPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const paramNames = sysConfig.paramNames;

  if (paramNames.length < 2) {
    printError("Two-parameter continuation requires at least 2 parameters.");
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  const bt = branch.branchType;
  if (bt !== 'limit_cycle' || !branch.data?.branch_type) {
    printError("NS curve requires a limit cycle branch");
    return null;
  }
  const lcBranchType = branch.data.branch_type as { type: 'LimitCycle'; ntst: number; ncol: number };
  const ntst = lcBranchType.ntst || 20;
  const ncol = lcBranchType.ncol || 4;

  const param1Name = branch.parameterName;
  const param1Value = nsPoint.param_value;
  let param2Name = paramNames.find(p => p !== param1Name) || paramNames[0];
  let param2Idx = paramNames.indexOf(param2Name);
  let param2Value = branchParams[param2Idx];

  // Configuration variables
  let curveName = `ns_curve_${branch.name}`;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-8';

  // Calculate initial k from NS eigenvalues if available
  let initialK = 0.0;
  if (nsPoint.eigenvalues && nsPoint.eigenvalues.length > 0) {
    // Find the complex eigenvalue pair on the unit circle
    for (const eig of nsPoint.eigenvalues) {
      if (Math.abs(eig.im) > 1e-6) {
        // k = cos(theta) where theta = atan2(im, re)
        const theta = Math.atan2(eig.im, eig.re);
        initialK = Math.cos(theta);
        break;
      }
    }
  }

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward' : 'Backward';

  const entries: ConfigEntry[] = [
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Two-Parameter Setup',
      getDisplay: () => `${param2Name} = ${param2Value}`,
      edit: async () => {
        const choices = paramNames
          .filter(p => p !== param1Name)
          .map(p => {
            const idx = paramNames.indexOf(p);
            return { name: `${p} (current: ${branchParams[idx]})`, value: p };
          });
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: param2Name,
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
        param2Idx = paramNames.indexOf(param2Name);
        param2Value = branchParams[param2Idx];
      }
    },
    {
      id: 'curveName',
      label: 'Curve name',
      section: 'Output Settings',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the NS curve:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward', value: true },
            { name: 'Backward', value: false }
          ],
          default: directionForward,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Continuation Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector steps:',
          default: correctorStepsInput
        });
        correctorStepsInput = value;
      }
    },
    {
      id: 'correctorTolerance',
      label: 'Corrector tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(correctorToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Corrector tolerance:',
          default: correctorToleranceInput
        });
        correctorToleranceInput = value;
      }
    }
  ];

  // Show info header
  console.log('');
  console.log(chalk.yellow('NS Curve Continuation (Two-Parameter)'));
  console.log(chalk.gray(`Tracking Neimark-Sacker in (${param1Name}, ${param2Name}) space`));
  console.log(chalk.gray(`Starting point: ${param1Name}=${param1Value}`));
  console.log(chalk.gray(`Initial k (cos θ): ${initialK.toFixed(4)}`));
  console.log('');

  while (true) {
    const result = await runConfigMenu('Configure NS Curve Continuation', entries);
    if (result === 'back') {
      return null;
    }

    if (!curveName) {
      printError('Please provide a curve name.');
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-8), Number.EPSILON),
    step_tolerance: 1e-8
  };

  printInfo(`Running NS curve continuation (max ${continuationSettings.max_steps} steps)...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];
    runConfig.params[paramNames.indexOf(param1Name)] = param1Value;

    const bridge = new WasmBridge(runConfig);

    // Extract period from end of state, and LC coords without period
    const lcPeriod = nsPoint.state[nsPoint.state.length - 1];
    const lcCoords = nsPoint.state.slice(0, -1);

    const curveData = runNSCurveWithProgress(
      bridge,
      lcCoords,
      lcPeriod,
      param1Name,
      param1Value,
      param2Name,
      param2Value,
      initialK,
      ntst,
      ncol,
      continuationSettings,
      directionForward,
      'NS Curve'
    );

    if (!curveData || !curveData.points || curveData.points.length === 0) {
      printError('NS curve returned no points');
      return null;
    }

    printSuccess(`NS curve computed: ${curveData.points.length} points`);

    const branchData = {
      points: curveData.points.map((pt: any) => ({
        state: pt.state || nsPoint.state,
        param_value: pt.param1_value,
        param2_value: pt.param2_value,
        stability: pt.codim2_type || 'None',
        eigenvalues: (pt.eigenvalues || []).map((eig: any) => {
          if (Array.isArray(eig)) {
            return { re: eig[0] ?? 0, im: eig[1] ?? 0 };
          }
          return eig;
        }),
        auxiliary: pt.auxiliary  // Contains k = cos(θ)
      })),
      bifurcations: curveData.codim2_bifurcations?.map((b: any) => b.index) || [],
      indices: curveData.points.map((_: any, i: number) => i),
      branch_type: {
        type: 'NSCurve' as const,
        param1_name: param1Name,
        param2_name: param2Name,
        ntst,
        ncol
      }
    };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'ns_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
    };

    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved NS curve branch: ${curveName}`);
    return newBranch;

  } catch (e) {
    printError(`NS Curve Continuation Failed: ${e}`);
    return null;
  }
}
