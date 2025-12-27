/**
 * Limit Cycle Initiation from Orbit Module
 * 
 * Handles initiating limit cycle branches from computed orbit objects
 * that have converged to a stable limit cycle.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { LimitCycleObject, OrbitObject, ContinuationObject } from '../types';
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
import { isValidName } from './utils';
import { inspectBranch } from './inspect';

export type InitiateLcFromOrbitOptions = {
  autoInspect?: boolean;
};

/**
 * Initiates limit cycle continuation from a computed orbit.
 * 
 * This function:
 * 1. Detects a cycle in the orbit (finds where it returns to start)
 * 2. Extracts one period and remeshes to collocation grid
 * 3. Runs orthogonal collocation continuation
 * 4. Opens the branch inspector to view results
 * 
 * The orbit should have converged to a stable limit cycle.
 * 
 * @param sysName - Name of the dynamical system
 * @param orbit - The orbit object to initialize from
 * @returns true if a branch was created, false if cancelled
 */
export async function initiateLCFromOrbit(
  sysName: string,
  orbit: OrbitObject,
  opts: InitiateLcFromOrbitOptions = {}
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const autoInspect = opts.autoInspect ?? true;

  if (sysConfig.paramNames.length === 0) {
    printError("System has no parameters to continue. Add at least one parameter first.");
    return null;
  }

  if (sysConfig.type === 'map') {
    printError("Limit cycle continuation is only available for flow (ODE) systems.");
    return null;
  }

  // Configuration defaults
  let limitCycleObjectName = `lc_${orbit.name}`;
  let branchName = '';
  let selectedParamName = sysConfig.paramNames[0];
  let toleranceInput = '0.1';
  let ntstInput = '20';
  let ncolInput = '4';
  let stepSizeInput = '0.01';
  let maxStepsInput = '50';
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
      id: 'limitCycleObjectName',
      label: 'Limit cycle object name',
      section: 'Branch Settings',
      getDisplay: () => limitCycleObjectName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for the new Limit Cycle Object:',
          default: limitCycleObjectName,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (Storage.listObjects(sysName).includes(val)) return "Object name already exists.";
            return true;
          }
        });
        limitCycleObjectName = value;
        if (!branchName) {
          branchName = `${limitCycleObjectName}_${selectedParamName}`;
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
          message: 'Name for the initial Limit Cycle Branch:',
          default: branchName || `${limitCycleObjectName}_${selectedParamName}`,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (!limitCycleObjectName) return "Select a limit cycle object name first.";
            if (Storage.listBranches(sysName, limitCycleObjectName).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
      }
    },
    {
      id: 'parameter',
      label: 'Continuation parameter',
      section: 'Branch Settings',
      getDisplay: () => selectedParamName,
      edit: async () => {
        const choices = sysConfig.paramNames.map(p => ({
          name: p,
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
        if (branchName.trim().length === 0 && limitCycleObjectName.trim().length > 0) {
          branchName = `${limitCycleObjectName}_${selectedParamName}`;
        }
      }
    },
    {
      id: 'tolerance',
      label: 'Cycle detection tolerance',
      section: 'Cycle Detection',
      getDisplay: () => formatUnset(toleranceInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Tolerance for detecting cycle (orbit recurrence):',
          default: toleranceInput
        });
        toleranceInput = value;
      }
    },
    {
      id: 'ntst',
      label: 'Mesh intervals (ntst)',
      section: 'Collocation Mesh',
      getDisplay: () => formatUnset(ntstInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Number of mesh intervals:',
          default: ntstInput
        });
        ntstInput = value;
      }
    },
    {
      id: 'ncol',
      label: 'Collocation points (ncol)',
      section: 'Collocation Mesh',
      getDisplay: () => formatUnset(ncolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Collocation points per interval (2-7):',
          default: ncolInput
        });
        ncolInput = value;
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

  while (true) {
    const result = await runConfigMenu('Initiate Limit Cycle from Orbit', entries);
    if (result === 'back') {
      return null;
    }

    if (!limitCycleObjectName) {
      printError('Please provide a limit cycle object name.');
      continue;
    }

    if (!branchName) {
      printError('Please provide a branch name.');
      continue;
    }

    if (Storage.listBranches(sysName, limitCycleObjectName).includes(branchName)) {
      printError(`Branch "${branchName}" already exists.`);
      continue;
    }

    break;
  }

  const tolerance = parseFloatOrDefault(toleranceInput, 1e-4);
  const ntst = parseIntOrDefault(ntstInput, 20);
  const ncol = parseIntOrDefault(ncolInput, 4);

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 50), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
    step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
  };

  console.log(chalk.cyan("Initializing limit cycle from orbit..."));

  try {
    // Use orbit's stored parameters if available, otherwise system defaults
    const runConfig = { ...sysConfig };
    if (orbit.parameters && orbit.parameters.length === sysConfig.params.length) {
      runConfig.params = [...orbit.parameters];
    }

    const bridge = new WasmBridge(runConfig);

    // Extract orbit times and states from orbit.data
    // orbit.data is [[t, x, y, ...], [t, x, y, ...], ...]
    const orbitTimes = orbit.data.map(pt => pt[0]);
    const orbitStates = orbit.data.map(pt => pt.slice(1));

    // Get current value of the continuation parameter
    const paramIdx = sysConfig.paramNames.indexOf(selectedParamName);
    const paramValue = paramIdx >= 0 ? runConfig.params[paramIdx] : 0;

    // Initialize LC guess from orbit
    printInfo("Detecting cycle in orbit...");
    const guess = bridge.initLCFromOrbit(
      orbitTimes,
      orbitStates,
      paramValue,
      ntst,
      ncol,
      tolerance
    );

    console.log(chalk.cyan(`Running limit cycle continuation (max ${continuationSettings.max_steps} steps)...`));
    process.stdout.write('  Computing...');

    // Run continuation
    const branchData = normalizeBranchEigenvalues(bridge.continueLimitCycle(
      guess,
      selectedParamName,
      continuationSettings,
      directionForward
    ));

    printProgressComplete('LC Continuation');

    // Ensure branch_type is included with mesh parameters for plotting scripts.
    branchData.branch_type = branchData.branch_type ?? { type: 'LimitCycle', ntst, ncol };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: selectedParamName,
      parentObject: limitCycleObjectName,
      startObject: orbit.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    const seedPoint = branchData.points[0];
    const seedState = seedPoint?.state ?? [];
    const seedPeriod = seedState.length > 0 ? seedState[seedState.length - 1] : NaN;

    const lcObj: LimitCycleObject = {
      type: 'limit_cycle',
      name: limitCycleObjectName,
      systemName: sysName,
      origin: { type: 'orbit', orbitName: orbit.name },
      ntst,
      ncol,
      period: seedPeriod,
      state: [...seedState],
      parameters: [...runConfig.params],
      parameterName: selectedParamName,
      paramValue: seedPoint?.param_value,
      floquetMultipliers: seedPoint?.eigenvalues,
      createdAt: new Date().toISOString(),
    };

    Storage.saveObject(sysName, lcObj);
    Storage.saveBranch(sysName, limitCycleObjectName, newBranch);
    printSuccess(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`);

    if (autoInspect) {
      await inspectBranch(sysName, newBranch);
    }
    return newBranch;

  } catch (e) {
    printError(`Limit Cycle Initialization Failed: ${e}`);
    return null;
  }
}
