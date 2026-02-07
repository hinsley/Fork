/**
 * Equilibrium Branch Initiation Module
 * 
 * Handles initiating new equilibrium branches from points on existing branches.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { ContinuationObject, ContinuationPoint, EquilibriumObject } from '../types';
import {
  ConfigEntry,
  MENU_PAGE_SIZE,
  formatUnset,
  parseFloatOrDefault,
  parseIntOrDefault,
  runConfigMenu
} from '../menu';
import { printSuccess, printError, printInfo } from '../format';
import { normalizeBranchEigenvalues } from './serialization';
import { isValidName, getBranchParams } from './utils';
import { runEquilibriumContinuationWithProgress } from './progress';
import { formatEquilibriumLabel } from '../labels';

/**
 * Initiates a new equilibrium continuation branch from a point on an existing branch.
 * 
 * Allows switching the continuation parameter to explore 2-parameter behavior.
 * The new branch starts from the equilibrium state at the selected point,
 * with all other parameters inherited from the source branch.
 * 
 * Use cases:
 * - Two-parameter continuation (switching from one param to another)
 * - Branching off at fold/transcritical bifurcations
 * - Exploring equilibrium manifold in different parameter directions
 * 
 * @param sysName - Name of the dynamical system
 * @param sourceBranch - Source equilibrium branch containing the starting point
 * @param point - The equilibrium point to start from
 * @returns true if branch was created successfully, false if cancelled
 */
export async function initiateEquilibriumBranchFromPoint(
  sysName: string,
  sourceBranch: ContinuationObject,
  point: ContinuationPoint
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const equilibriumLabel = formatEquilibriumLabel(sysConfig.type, {
    mapIterations: sourceBranch.mapIterations,
  });
  const parentObject = sourceBranch.parentObject;

  if (sysConfig.paramNames.length === 0) {
    printError("System has no parameters to continue. Add at least one parameter first.");
    return null;
  }

  // Default to a different parameter than the source branch if possible
  let selectedParamName = sysConfig.paramNames.find(p => p !== sourceBranch.parameterName)
    || sysConfig.paramNames[0];
  let branchName = '';
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '4';
  let correctorToleranceInput = '1e-6';
  let stepToleranceInput = '1e-6';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

  const entries: ConfigEntry[] = [
    {
      id: 'parameter',
      label: 'Continuation parameter',
      section: 'Branch Settings',
      getDisplay: () => {
        const isSame = selectedParamName === sourceBranch.parameterName;
        return isSame ? `${selectedParamName} (same as source)` : selectedParamName;
      },
      edit: async () => {
        const choices = sysConfig.paramNames.map(p => ({
          name: p === sourceBranch.parameterName ? `${p} (current branch param)` : p,
          value: p
        }));
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select Continuation Parameter:',
          choices,
          default: selectedParamName,
          pageSize: MENU_PAGE_SIZE
        });
        selectedParamName = value;
      }
    },
    {
      id: 'branchName',
      label: 'Branch name',
      section: 'Branch Settings',
      getDisplay: () => formatUnset(branchName),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for this Continuation Branch:',
          default: branchName || `${sourceBranch.name}_${selectedParamName}`,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (Storage.listBranches(sysName, parentObject).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Predictor Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Direction:',
          choices: [
            { name: 'Forward (Increasing Param)', value: true },
            { name: 'Backward (Decreasing Param)', value: false }
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
      section: 'Predictor Settings',
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
      section: 'Predictor Settings',
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
      id: 'minStep',
      label: 'Min step size',
      section: 'Predictor Settings',
      getDisplay: () => formatUnset(minStepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Min Step Size:',
          default: minStepSizeInput
        });
        minStepSizeInput = value;
      }
    },
    {
      id: 'maxStep',
      label: 'Max step size',
      section: 'Predictor Settings',
      getDisplay: () => formatUnset(maxStepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Step Size:',
          default: maxStepSizeInput
        });
        maxStepSizeInput = value;
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
    },
    {
      id: 'stepTolerance',
      label: 'Step tolerance',
      section: 'Corrector Settings',
      getDisplay: () => formatUnset(stepToleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Step tolerance:',
          default: stepToleranceInput
        });
        stepToleranceInput = value;
      }
    }
  ];

  while (true) {
    const result = await runConfigMenu(
      `Create ${equilibriumLabel} Branch from Point`,
      entries
    );
    if (result === 'back') {
      return null;
    }

    if (!branchName) {
      printError('Please provide a branch name.');
      continue;
    }

    if (Storage.listBranches(sysName, parentObject).includes(branchName)) {
      printError(`Branch "${branchName}" already exists.`);
      continue;
    }

    break;
  }

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 4), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
    step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
  };

  printInfo(`Computing continuation (max ${continuationSettings.max_steps} steps)...`);
  try {
    // Build system config with the parameter values from the source branch
    const runConfig = { ...sysConfig };

    // Get params from branch, falling back to source equilibrium if needed
    runConfig.params = getBranchParams(sysName, sourceBranch, sysConfig);

    // Update the source branch's continuation parameter to the value at this point
    const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
    if (sourceParamIdx >= 0) {
      runConfig.params[sourceParamIdx] = point.param_value;
    }

    const bridge = new WasmBridge(runConfig);
    const mapIterations = sysConfig.type === 'map'
      ? sourceBranch.mapIterations ?? 1
      : 1;
    const branchData = normalizeBranchEigenvalues(
      runEquilibriumContinuationWithProgress(
        bridge,
        point.state,
        selectedParamName,
        mapIterations,
        continuationSettings,
        directionForward,
        'Continuation'
      )
    );

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: selectedParamName,
      parentObject,
      startObject: sourceBranch.name,
      branchType: 'equilibrium',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],  // Store full parameter snapshot
      mapIterations: sysConfig.type === 'map' ? mapIterations : undefined
    };

    Storage.saveBranch(sysName, parentObject, newBranch);
    printSuccess(`Continuation successful! Generated ${branchData.points.length} points.`);
    return newBranch;

  } catch (e) {
    printError(`Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates a period-doubled cycle branch for map systems from a PD point.
 */
export async function initiateMapCycleFromPD(
  sysName: string,
  sourceBranch: ContinuationObject,
  pdPoint: ContinuationPoint,
  pdPointIdx: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  if (sysConfig.type !== 'map') {
    printError('Period-doubling cycle branching is only available for map systems.');
    return null;
  }

  const sourceIterations = Math.max(
    sourceBranch.mapIterations ?? pdPoint.cycle_points?.length ?? 1,
    1
  );
  const doubledIterations = sourceIterations * 2;

  const sourceLabel = formatEquilibriumLabel(sysConfig.type, {
    mapIterations: sourceIterations
  });
  const targetLabel = formatEquilibriumLabel(sysConfig.type, {
    mapIterations: doubledIterations
  });

  let cycleObjectName = `cycle_pd_${sourceBranch.name}_idx${pdPointIdx}`;
  let branchName = `${cycleObjectName}_${sourceBranch.parameterName}`;
  let amplitudeInput = '0.01';
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let directionForward = true;
  let correctorStepsInput = '10';
  let correctorToleranceInput = '1e-6';
  let stepToleranceInput = '1e-6';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward (Increasing Param)' : 'Backward (Decreasing Param)';

  const entries: ConfigEntry[] = [
    {
      id: 'cycleObjectName',
      label: `${targetLabel} object name`,
      section: 'Branch Settings',
      getDisplay: () => cycleObjectName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: `Name for the new ${targetLabel} Object:`,
          default: cycleObjectName,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (Storage.listObjects(sysName).includes(val)) return "Object name already exists.";
            return true;
          }
        });
        cycleObjectName = value;
        if (!branchName) {
          branchName = `${cycleObjectName}_${sourceBranch.parameterName}`;
        }
      }
    },
    {
      id: 'branchName',
      label: 'Branch name',
      section: 'Branch Settings',
      getDisplay: () => branchName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: `Name for the ${targetLabel} Branch:`,
          default: branchName || `${cycleObjectName}_${sourceBranch.parameterName}`,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (!cycleObjectName) return "Select a cycle object name first.";
            if (Storage.listBranches(sysName, cycleObjectName).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
      }
    },
    {
      id: 'amplitude',
      label: 'Perturbation Amplitude (h)',
      section: 'PD Initialization',
      getDisplay: () => amplitudeInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Enter perturbation amplitude (e.g., 0.01):',
          default: amplitudeInput,
        });
        amplitudeInput = value;
      }
    },
    {
      id: 'iterations',
      label: 'Cycle length (doubled)',
      section: 'Cycle Settings',
      getDisplay: () => `${sourceLabel} -> ${targetLabel}`,
      edit: async () => {
        printInfo("Cycle length is inherited from the source branch and doubled for PD branching.");
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Continuation Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'list',
          name: 'value',
          message: 'Select parameter direction:',
          choices: [
            { name: directionLabel(true), value: true },
            { name: directionLabel(false), value: false }
          ],
          default: directionForward
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Algorithm Parameters',
      getDisplay: () => stepSizeInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial step size:',
          default: stepSizeInput,
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max steps',
      section: 'Algorithm Parameters',
      getDisplay: () => maxStepsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum continuation steps:',
          default: maxStepsInput,
        });
        maxStepsInput = value;
      }
    }
  ];

  const result = await runConfigMenu(`Branch to Period-Doubled ${targetLabel}`, entries);
  if (result === 'back') return null;

  if (!cycleObjectName) {
    printError(`Please provide a ${targetLabel} object name.`);
    return null;
  }

  if (Storage.listObjects(sysName).includes(cycleObjectName)) {
    printError(`Object "${cycleObjectName}" already exists.`);
    return null;
  }

  if (!branchName) {
    printError("Please provide a branch name.");
    return null;
  }

  if (Storage.listBranches(sysName, cycleObjectName).includes(branchName)) {
    printError(`Branch "${branchName}" already exists.`);
    return null;
  }

  const runConfig = {
    branchName,
    params: getBranchParams(sysName, sourceBranch, sysConfig),
    amplitude: parseFloatOrDefault(amplitudeInput, 0.01),
    settings: {
      step_size: parseFloatOrDefault(stepSizeInput, 0.01),
      max_steps: parseIntOrDefault(maxStepsInput, 300),
      min_step_size: parseFloatOrDefault(minStepSizeInput, 1e-5),
      max_step_size: parseFloatOrDefault(maxStepSizeInput, 0.1),
      corrector_steps: parseIntOrDefault(correctorStepsInput, 10),
      corrector_tolerance: parseFloatOrDefault(correctorToleranceInput, 1e-6),
      step_tolerance: parseFloatOrDefault(stepToleranceInput, 1e-6),
    }
  };

  const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
  if (sourceParamIdx >= 0) {
    runConfig.params[sourceParamIdx] = pdPoint.param_value;
  }

  try {
    console.log(chalk.cyan(`Initializing period-doubled ${targetLabel}...`));
    const bridge = new WasmBridge(sysConfig);
    const seedState = bridge.initMapCycleFromPD(
      pdPoint.state,
      sourceBranch.parameterName,
      pdPoint.param_value,
      sourceIterations,
      runConfig.amplitude
    );

    console.log(chalk.cyan(`Running ${targetLabel} continuation (max ${runConfig.settings.max_steps} steps)...`));
    const branchData = normalizeBranchEigenvalues(
      runEquilibriumContinuationWithProgress(
        bridge,
        seedState,
        sourceBranch.parameterName,
        doubledIterations,
        runConfig.settings,
        directionForward,
        'PD Cycle Continuation'
      )
    );

    const seedPoint = branchData.points[0];
    const solution = seedPoint
      ? {
          state: seedPoint.state,
          residual_norm: 0,
          iterations: 0,
          jacobian: [],
          eigenpairs: (seedPoint.eigenvalues ?? []).map((eig) => ({
            value: eig,
            vector: [],
          })),
          cycle_points: seedPoint.cycle_points,
        }
      : undefined;

    const eqObj: EquilibriumObject = {
      type: 'equilibrium',
      name: cycleObjectName,
      systemName: sysName,
      solution,
      parameters: [...runConfig.params],
      lastSolverParams: {
        initialGuess: seedState,
        maxSteps: 25,
        dampingFactor: 1,
        mapIterations: doubledIterations
      }
    };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: sourceBranch.parameterName,
      parentObject: cycleObjectName,
      startObject: sourceBranch.name,
      branchType: 'equilibrium',
      data: branchData,
      settings: runConfig.settings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
      mapIterations: doubledIterations
    };

    Storage.saveObject(sysName, eqObj);
    Storage.saveBranch(sysName, cycleObjectName, newBranch);
    printSuccess(`Period-doubled ${targetLabel} branching successful! Generated ${branchData.points.length} points.`);
    return newBranch;
  } catch (e) {
    printError(`Period-doubled ${targetLabel} branching failed: ${e}`);
    return null;
  }
}
