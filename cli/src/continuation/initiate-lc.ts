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
import { ContinuationObject, ContinuationPoint, LimitCycleObject } from '../types';
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
import { runLimitCycleContinuationWithProgress } from './progress';

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
  hopfPoint: ContinuationPoint,
  hopfPointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);

  // Configuration defaults.
  let limitCycleObjectName = `lc_hopf_${branch.name}`;
  let branchName = `${limitCycleObjectName}_${branch.parameterName}`;
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
          branchName = `${limitCycleObjectName}_${branch.parameterName}`;
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
          default: branchName || `${limitCycleObjectName}_${branch.parameterName}`,
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
      return null;
    }

    if (!limitCycleObjectName) {
      console.error(chalk.red('Please provide a limit cycle object name.'));
      continue;
    }

    if (!branchName) {
      console.error(chalk.red('Please provide a branch name.'));
      continue;
    }

    if (Storage.listObjects(sysName).includes(limitCycleObjectName)) {
      console.error(chalk.red(`Object "${limitCycleObjectName}" already exists.`));
      continue;
    }

    if (Storage.listBranches(sysName, limitCycleObjectName).includes(branchName)) {
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

    console.log(chalk.cyan(`Running limit cycle continuation (max ${continuationSettings.max_steps} steps)...`));

    const branchData = normalizeBranchEigenvalues(
      runLimitCycleContinuationWithProgress(
        bridge,
        guess,
        branch.parameterName,
        continuationSettings,
        directionForward,
        'LC Continuation'
      )
    );

    // Ensure branch_type is included with mesh parameters for plotting scripts.
    branchData.branch_type = branchData.branch_type ?? { type: 'LimitCycle', ntst, ncol };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: branch.parameterName,
      parentObject: limitCycleObjectName,
      startObject: branch.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    const seedPoint = branchData.points[0];
    const seedState = seedPoint?.state ?? [];
    const seedPeriod = seedState.length > 0 ? seedState[seedState.length - 1] : NaN;

    const lcObj: LimitCycleObject = {
      type: 'limit_cycle',
      name: limitCycleObjectName,
      systemName: sysName,
      origin: {
        type: 'hopf',
        equilibriumObjectName: branch.parentObject,
        equilibriumBranchName: branch.name,
        pointIndex: hopfPointIndex,
      },
      ntst,
      ncol,
      period: seedPeriod,
      state: [...seedState],
      parameters: [...runConfig.params],
      parameterName: branch.parameterName,
      paramValue: seedPoint?.param_value,
      floquetMultipliers: seedPoint?.eigenvalues,
      createdAt: new Date().toISOString(),
    };

    Storage.saveObject(sysName, lcObj);
    Storage.saveBranch(sysName, limitCycleObjectName, newBranch);
    console.log(chalk.green(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`));
    return newBranch;

  } catch (e) {
    console.error(chalk.red("Limit Cycle Continuation Failed:"), e);
    return null;
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
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const parentObject = sourceBranch.parentObject;

  if (sysConfig.paramNames.length === 0) {
    printError("System has no parameters to continue. Add at least one parameter first.");
    return null;
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
            if (Storage.listBranches(sysName, parentObject).includes(val)) return "Branch name already exists.";
            return true;
          }
        });
        branchName = value;
      }
    },
    {
      id: 'mesh',
      label: 'Discretization (inherited)',
      section: 'Collocation Mesh',
      getDisplay: () => `${sourceNtst}×${sourceNcol}`,
      edit: async () => {
        printInfo("NTST/NCOL are inherited from the source branch for safety.");
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

  const ntst = sourceNtst;
  const ncol = sourceNcol;

  const continuationSettings = {
    step_size: Math.max(parseFloatOrDefault(stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(maxStepsInput, 50), 1),
    corrector_steps: Math.max(parseIntOrDefault(correctorStepsInput, 10), 1),
    corrector_tolerance: Math.max(parseFloatOrDefault(correctorToleranceInput, 1e-6), Number.EPSILON),
    step_tolerance: Math.max(parseFloatOrDefault(stepToleranceInput, 1e-6), Number.EPSILON)
  };

  printInfo(`Running LC continuation (max ${continuationSettings.max_steps} steps)...`);

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

    // Extract mesh states from the flattened collocation state.
    // Layout: [mesh_states (ntst points), stage_states (ntst*ncol points), period].
    const meshStates: number[][] = [];
    for (let i = 0; i < sourceNtst; i++) {
      const offset = i * dim;
      meshStates.push(flatState.slice(offset, offset + dim));
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
        mesh_states: meshStates,
        stage_states: []  // Will be built by the core
      },
      mesh_points: sourceNtst,
      collocation_degree: sourceNcol,
      phase_anchor: meshStates[0] || [],
      phase_direction: meshStates.length > 1
        ? meshStates[1].map((v: number, i: number) => v - meshStates[0][i])
        : (meshStates[0] || []).map(() => 1.0)
    };

    const branchData = normalizeBranchEigenvalues(
      runLimitCycleContinuationWithProgress(
        bridge,
        lcSetup,
        selectedParamName,
        continuationSettings,
        directionForward,
        'LC Continuation'
      )
    );

    // Ensure branch_type is present for plotting and for branch extensions.
    branchData.branch_type = branchData.branch_type ?? { type: 'LimitCycle', ntst: sourceNtst, ncol: sourceNcol };

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: selectedParamName,
      parentObject,
      startObject: sourceBranch.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    Storage.saveBranch(sysName, parentObject, newBranch);
    printSuccess(`Limit cycle continuation successful! Generated ${branchData.points.length} points.`);
    return newBranch;

  } catch (e) {
    printError(`Limit Cycle Continuation Failed: ${e}`);
    return null;
  }
}

/**
 * Initiates a period-doubled limit cycle branch from a period-doubling bifurcation.
 * 
 * This follows a standard period-doubling branching approach:
 * 1. Takes the LC state at the PD point.
 * 2. Prompts for perturbation amplitude (h) and continuation settings.
 * 3. Calls WASM to compute the PD eigenvector and build a doubled-period guess.
 * 4. Resumes continuation on the new branch.
 * 
 * @param sysName - Name of the dynamical system
 * @param sourceBranch - The LC branch where the PD was detected
 * @param pdPoint - The point data for the PD bifurcation
 * @param pdPointIdx - The array index of the point in sourceBranch
 */
export async function initiateLCFromPD(
  sysName: string,
  sourceBranch: ContinuationObject,
  pdPoint: ContinuationPoint,
  pdPointIdx: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const bridge = new WasmBridge(sysConfig);

  // Extract source ntst/ncol from branch metadata
  let sourceNtst = 20, sourceNcol = 4;
  const btData = sourceBranch.data.branch_type as any;
  if (btData?.type === 'LimitCycle' && btData.ntst && btData.ncol) {
    sourceNtst = btData.ntst;
    sourceNcol = btData.ncol;
  }

  // Configuration defaults
  let limitCycleObjectName = `lc_pd_${sourceBranch.name}_idx${pdPointIdx}`;
  let branchName = `${limitCycleObjectName}_${sourceBranch.parameterName}`;
  let amplitudeInput = '0.01'; // Default h=0.01 for PD branching
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
          message: 'Name for the new Period-Doubled Limit Cycle Object:',
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
          branchName = `${limitCycleObjectName}_${sourceBranch.parameterName}`;
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
          message: 'Name for the initial Period-Doubled Branch:',
          default: branchName || `${limitCycleObjectName}_${sourceBranch.parameterName}`,
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
      id: 'ntst',
      label: 'Mesh intervals (NTST)',
      section: 'Discretization (will be doubled)',
      getDisplay: () => `${sourceNtst} (-> ${sourceNtst * 2} in doubled cycle)`,
      edit: async () => {
        printInfo("NTST is inherited from the source branch and doubled for the new branch.");
      }
    },
    {
      id: 'ncol',
      label: 'Collocation degree (NCOL)',
      section: 'Discretization',
      getDisplay: () => sourceNcol.toString(),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Collocation degree:',
          default: sourceNcol.toString(),
        });
        sourceNcol = parseIntOrDefault(value, sourceNcol);
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

  const result = await runConfigMenu('Branch to Period-Doubled Limit Cycle', entries);
  if (result === 'back') return null;

  if (!limitCycleObjectName) {
    printError("Please provide a limit cycle object name.");
    return null;
  }

  if (Storage.listObjects(sysName).includes(limitCycleObjectName)) {
    printError(`Object "${limitCycleObjectName}" already exists.`);
    return null;
  }

  if (!branchName) {
    printError("Please provide a branch name.");
    return null;
  }

  if (Storage.listBranches(sysName, limitCycleObjectName).includes(branchName)) {
    printError(`Branch "${branchName}" already exists.`);
    return null;
  }

  const runConfig = {
    branchName,
    params: getBranchParams(sysName, sourceBranch, sysConfig),
    amplitude: parseFloatOrDefault(amplitudeInput, 0.01),
    settings: {
      step_size: parseFloatOrDefault(stepSizeInput, 0.01),
      max_steps: parseIntOrDefault(maxStepsInput, 50),
      min_step_size: parseFloatOrDefault(minStepSizeInput, 1e-5),
      max_step_size: parseFloatOrDefault(maxStepSizeInput, 0.1),
      corrector_steps: parseIntOrDefault(correctorStepsInput, 10),
      corrector_tolerance: parseFloatOrDefault(correctorToleranceInput, 1e-6),
      step_tolerance: parseFloatOrDefault(stepToleranceInput, 1e-6),
    }
  };

  // Update the source branch's continuation parameter to the PD point's value
  const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
  if (sourceParamIdx >= 0) {
    runConfig.params[sourceParamIdx] = pdPoint.param_value;
  }

  try {
    console.log(chalk.cyan("Initializing period-doubled limit cycle..."));

    // Call WASM to build the doubled-period setup
    const setup = bridge.initLCFromPD(
      pdPoint.state,
      sourceBranch.parameterName,
      pdPoint.param_value,
      sourceNtst,
      sourceNcol,
      runConfig.amplitude
    );

    console.log(chalk.cyan(`Running limit cycle continuation for doubled period (max ${runConfig.settings.max_steps} steps)...`));
    const branchData = normalizeBranchEigenvalues(
      runLimitCycleContinuationWithProgress(
        bridge,
        setup,
        sourceBranch.parameterName,
        runConfig.settings,
        directionForward,
        'PD Continuation'
      )
    );

    // Ensure branch_type is included with mesh parameters for plotting scripts.
    if (!branchData.branch_type) {
      branchData.branch_type = { type: 'LimitCycle', ntst: sourceNtst * 2, ncol: sourceNcol };
    }

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: sourceBranch.parameterName,
      parentObject: limitCycleObjectName,
      startObject: sourceBranch.name,
      branchType: 'limit_cycle',
      data: branchData,
      settings: runConfig.settings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    const seedPoint = branchData.points[0];
    const seedState = seedPoint?.state ?? [];
    const seedPeriod = seedState.length > 0 ? seedState[seedState.length - 1] : NaN;

    let objNtst = sourceNtst * 2;
    let objNcol = sourceNcol;
    const bt = branchData.branch_type as any;
    if (bt?.type === 'LimitCycle' && typeof bt.ntst === 'number' && typeof bt.ncol === 'number') {
      objNtst = bt.ntst;
      objNcol = bt.ncol;
    }

    const lcObj: LimitCycleObject = {
      type: 'limit_cycle',
      name: limitCycleObjectName,
      systemName: sysName,
      origin: {
        type: 'pd',
        sourceLimitCycleObjectName: sourceBranch.parentObject,
        sourceBranchName: sourceBranch.name,
        pointIndex: pdPointIdx,
      },
      ntst: objNtst,
      ncol: objNcol,
      period: seedPeriod,
      state: [...seedState],
      parameters: [...runConfig.params],
      parameterName: sourceBranch.parameterName,
      paramValue: seedPoint?.param_value,
      floquetMultipliers: seedPoint?.eigenvalues,
      createdAt: new Date().toISOString(),
    };

    Storage.saveObject(sysName, lcObj);
    Storage.saveBranch(sysName, limitCycleObjectName, newBranch);
    printSuccess(`PD Branching successful! Generated ${branchData.points.length} points.`);
    return newBranch;

  } catch (e) {
    printError(`PD Branching Failed: ${e}`);
    return null;
  }
}
