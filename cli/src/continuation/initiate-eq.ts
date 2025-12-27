/**
 * Equilibrium Branch Initiation Module
 * 
 * Handles initiating new equilibrium branches from points on existing branches.
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
import { printSuccess, printError, printInfo, printProgressComplete } from '../format';
import { normalizeBranchEigenvalues } from './serialization';
import { isValidName, getBranchParams } from './utils';

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
  let maxStepsInput = '100';
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
    const result = await runConfigMenu('Create Equilibrium Branch from Point', entries);
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
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 100), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 4), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
    step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
  };

  printInfo(`Computing continuation (max ${continuationSettings.max_steps} steps)...`);
  process.stdout.write('  Computing...');

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
    const branchData = normalizeBranchEigenvalues(bridge.compute_continuation(
      point.state,
      selectedParamName,
      continuationSettings,
      directionForward
    ));

    printProgressComplete('Continuation');

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
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    Storage.saveBranch(sysName, parentObject, newBranch);
    printSuccess(`Continuation successful! Generated ${branchData.points.length} points.`);
    return newBranch;

  } catch (e) {
    printError(`Continuation Failed: ${e}`);
    return null;
  }
}
