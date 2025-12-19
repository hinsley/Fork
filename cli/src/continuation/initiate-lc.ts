/**
 * Limit Cycle Initiation Module
 * 
 * Handles initiating limit cycle branches from Hopf bifurcations
 * and from points on existing LC branches.
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
import { normalizeBranchEigenvalues } from './serialization';
import { isValidName, getBranchParams } from './utils';
import { inspectBranch } from './inspect';

/**
 * Initiates limit cycle continuation from a Hopf bifurcation point.
 * 
 * This function:
 * 1. Presents a configuration menu for LC settings (amplitude, mesh, collocation)
 * 2. Uses the WASM bridge to initialize an LC guess from the Hopf normal form
 * 3. Runs orthogonal collocation continuation
 * 4. Opens the branch inspector to view results
 * 
 * The initial limit cycle is constructed using the Hopf normal form approximation
 * with user-specified amplitude perturbation.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - Source equilibrium branch containing the Hopf point
 * @param hopfPoint - The Hopf bifurcation point (must have stability='Hopf')
 */
export async function initiateLCFromHopf(
  sysName: string,
  branch: ContinuationObject,
  hopfPoint: ContinuationPoint
) {
  const sysConfig = Storage.loadSystem(sysName);

  // Configuration defaults - use lc_ prefix on source branch name (no need to add param again)
  let branchName = `lc_${branch.name}`;
  let amplitudeInput = '0.1';
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
      id: 'branchName',
      label: 'Branch name',
      section: 'Branch Settings',
      getDisplay: () => branchName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for this Limit Cycle Branch:',
          default: branchName,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
      }
    },
    {
      id: 'amplitude',
      label: 'Initial amplitude',
      section: 'Hopf Initialization',
      getDisplay: () => formatUnset(amplitudeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial amplitude (perturbation from equilibrium):',
          default: amplitudeInput
        });
        amplitudeInput = value;
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
    const result = await runConfigMenu('Initiate Limit Cycle from Hopf', entries);
    if (result === 'back') {
      return;
    }

    if (!branchName) {
      console.error(chalk.red('Please provide a branch name.'));
      continue;
    }

    if (Storage.listContinuations(sysName).includes(branchName)) {
      console.error(chalk.red(`Branch "${branchName}" already exists.`));
      continue;
    }

    break;
  }

  const amplitude = parseFloatOrDefault(amplitudeInput, 0.1);
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

  console.log(chalk.cyan("Initializing limit cycle from Hopf bifurcation..."));

  try {
    // Build system config with the parameter values from the source branch
    const runConfig = { ...sysConfig };

    // Get params from branch, falling back to source equilibrium if needed
    runConfig.params = getBranchParams(sysName, branch, sysConfig);

    // Update the source branch's continuation parameter to the Hopf point's value
    const sourceParamIdx = sysConfig.paramNames.indexOf(branch.parameterName);
    if (sourceParamIdx >= 0) {
      runConfig.params[sourceParamIdx] = hopfPoint.param_value;
    }

    const bridge = new WasmBridge(runConfig);

    // Initialize LC guess from Hopf point
    const guess = bridge.initLCFromHopf(
      hopfPoint.state,
      branch.parameterName,
      hopfPoint.param_value,
      amplitude,
      ntst,
      ncol
    );

    console.log(chalk.cyan("Running limit cycle continuation..."));

    // Run continuation
    const branchData = normalizeBranchEigenvalues(bridge.continueLimitCycle(
      guess,
      branch.parameterName,
      continuationSettings,
      directionForward
    ));

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: branch.parameterName,
      startObject: branch.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    Storage.saveContinuation(sysName, newBranch);
    console.log(chalk.green(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`));

    await inspectBranch(sysName, newBranch);

  } catch (e) {
    console.error(chalk.red("Limit Cycle Continuation Failed:"), e);
  }
}

/**
 * Initiates a new limit cycle continuation branch from a point on an existing LC branch.
 * 
 * Allows switching the continuation parameter to explore 2-parameter behavior.
 * Reconstructs the LC state from the stored flat representation using source
 * branch's collocation parameters (ntst/ncol).
 * 
 * Use cases:
 * - Two-parameter continuation (switching from one param to another)
 * - Branching off at periodic orbit bifurcations
 * - Exploring LC family in different parameter directions
 * 
 * @param sysName - Name of the dynamical system
 * @param sourceBranch - Source LC branch containing the starting point
 * @param point - The point to start from
 * @param arrayIdx - Array index of the point (for LC state reconstruction)
 * @returns true if branch was created successfully, false if cancelled
 */
export async function initiateLCBranchFromPoint(
  sysName: string,
  sourceBranch: ContinuationObject,
  point: ContinuationPoint,
  arrayIdx: number
): Promise<boolean> {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.paramNames.length === 0) {
    printError("System has no parameters to continue. Add at least one parameter first.");
    return false;
  }

  // Get LC metadata from the source branch's branch_type
  const branchTypeData = sourceBranch.data.branch_type;
  let sourceNtst = 20;
  let sourceNcol = 4;
  if (branchTypeData && typeof branchTypeData === 'object' && 'type' in branchTypeData) {
    const bt = branchTypeData as { type: string; ntst?: number; ncol?: number };
    if (bt.type === 'LimitCycle' && bt.ntst && bt.ncol) {
      sourceNtst = bt.ntst;
      sourceNcol = bt.ncol;
    }
  }

  let ntstInput = sourceNtst.toString();
  let ncolInput = sourceNcol.toString();


  // Default to a different parameter than the source branch if possible
  let selectedParamName = sysConfig.paramNames.find(p => p !== sourceBranch.parameterName)
    || sysConfig.paramNames[0];
  let branchName = '';
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
          message: 'Name for this Limit Cycle Branch:',
          default: branchName || `${sourceBranch.name}_${selectedParamName}`,
          validate: (val: string) => {
            const valid = isValidName(val);
            if (valid !== true) return valid;
            if (Storage.listContinuations(sysName).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
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
    const result = await runConfigMenu('Create Limit Cycle Branch from Point', entries);
    if (result === 'back') {
      return false;
    }

    if (!branchName) {
      printError('Please provide a branch name.');
      continue;
    }

    if (Storage.listContinuations(sysName).includes(branchName)) {
      printError(`Branch "${branchName}" already exists.`);
      continue;
    }

    break;
  }

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

  printInfo("Running Limit Cycle Continuation...");

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

    // For LC continuation from a point, we need to construct an LC guess from the point data
    // The point.state for LC points is flattened: [mesh_states..., stage_states..., period]
    // Unflatten using source branch's ntst/ncol (not the user-input values, since we're reading existing data)

    const dim = sysConfig.equations.length;
    const flatState = point.state;

    // Extract period from the end of the flat state
    const period = flatState[flatState.length - 1];

    // Calculate sizes based on source branch parameters
    // profile_states expects ntst*ncol + 1 profile points
    const profilePointCount = sourceNtst * sourceNcol + 1;

    // Extract profile_states: profilePointCount arrays of dim floats each
    // The flat state is [profile_point_0, ..., profile_point_N, period]
    const profileStates: number[][] = [];
    for (let i = 0; i < profilePointCount; i++) {
      const offset = i * dim;
      profileStates.push(flatState.slice(offset, offset + dim));
    }

    // Get the NEW continuation parameter's current value from runConfig
    const newParamIdx = sysConfig.paramNames.indexOf(selectedParamName);
    const newParamValue = newParamIdx >= 0 ? runConfig.params[newParamIdx] : point.param_value;

    // Need to wrap the raw guess in a LimitCycleSetup-like structure
    // The WASM expects mesh_points, collocation_degree, phase_anchor, phase_direction
    const lcSetup = {
      guess: {
        param_value: newParamValue,
        period: period,
        mesh_states: profileStates,
        stage_states: []  // Will be built by the core
      },
      mesh_points: ntst,
      collocation_degree: ncol,
      phase_anchor: profileStates[0] || [],
      phase_direction: profileStates.length > 1
        ? profileStates[1].map((v: number, i: number) => v - profileStates[0][i])
        : profileStates[0].map(() => 1.0)
    };

    const branchData = normalizeBranchEigenvalues(bridge.continueLimitCycle(
      lcSetup,
      selectedParamName,
      continuationSettings,
      directionForward
    ));

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: selectedParamName,
      startObject: sourceBranch.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    Storage.saveContinuation(sysName, newBranch);
    printSuccess(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`);

    await inspectBranch(sysName, newBranch);
    return true;

  } catch (e) {
    printError(`Limit Cycle Continuation Failed: ${e}`);
    return false;
  }
}
