/**
 * Branch Creation Module
 * 
 * Handles creating new continuation branches from equilibrium points or orbits.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import {
  ContinuationObject,
  EquilibriumObject,
  OrbitObject
} from '../types';
import {
  ConfigEntry,
  MENU_PAGE_SIZE,
  formatUnset,
  parseFloatOrDefault,
  parseIntOrDefault,
  runConfigMenu
} from '../menu';
import { normalizeBranchEigenvalues } from './serialization';
import { isValidName } from './utils';
import { inspectBranch } from './inspect';
import { initiateLCFromOrbit } from './initiate-lc-from-orbit';

/**
 * Entry point for creating a new continuation branch.
 * 
 * Prompts user to select branch type (Equilibrium or Limit Cycle), then
 * routes to the appropriate creation flow.
 * 
 * @param sysName - Name of the dynamical system
 */
export async function createBranch(sysName: string) {
  const { branchType } = await inquirer.prompt({
    type: 'rawlist',
    name: 'branchType',
    message: 'Select Branch Type:',
    choices: [
      { name: 'Equilibrium Branch', value: 'equilibrium' },
      { name: 'Limit Cycle Branch', value: 'limit_cycle' },
      new inquirer.Separator(),
      { name: 'Back', value: 'back' }
    ],
    pageSize: MENU_PAGE_SIZE
  });

  if (branchType === 'back') return;

  if (branchType === 'equilibrium') {
    await createEquilibriumBranch(sysName);
  } else if (branchType === 'limit_cycle') {
    await createLimitCycleBranch(sysName);
  }
}

/**
 * Creates a Limit Cycle branch from an orbit object.
 * 
 * Lists available orbit objects and prompts user to select one,
 * then calls the LC-from-orbit initialization flow.
 * 
 * @param sysName - Name of the dynamical system
 */
async function createLimitCycleBranch(sysName: string) {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.type === 'map') {
    console.log(chalk.red("Limit cycle continuation is only available for flow (ODE) systems."));
    return;
  }

  const orbits = Storage.listObjects(sysName)
    .map(name => Storage.loadObject(sysName, name))
    .filter((obj): obj is OrbitObject => obj.type === 'orbit');

  if (orbits.length === 0) {
    console.log(chalk.red("No orbit objects found. Compute an orbit that converges to a limit cycle first."));
    return;
  }

  const choices = orbits.map(o => ({
    name: `${o.name} (${o.data.length} points, t=[${o.t_start.toFixed(2)}, ${o.t_end.toFixed(2)}])`,
    value: o.name
  }));
  choices.push(new (inquirer as any).Separator());
  choices.push({ name: 'Back', value: 'BACK' });

  const { selectedOrbit } = await inquirer.prompt({
    type: 'rawlist',
    name: 'selectedOrbit',
    message: 'Select Orbit for Limit Cycle:',
    choices,
    pageSize: MENU_PAGE_SIZE
  });

  if (selectedOrbit === 'BACK') return;

  const orbit = orbits.find(o => o.name === selectedOrbit);
  if (!orbit) {
    console.log(chalk.red("Selected orbit not found."));
    return;
  }

  await initiateLCFromOrbit(sysName, orbit);
}

/**
 * Creates a new equilibrium continuation branch from a converged equilibrium point.
 * 
 * Presents a configuration menu allowing the user to:
 * - Select the starting equilibrium
 * - Choose the continuation parameter
 * - Set branch name and continuation settings (step sizes, tolerances, direction)
 * 
 * After configuration, runs PALC continuation using the WASM bridge and
 * automatically opens the branch inspector to view results.
 * 
 * @param sysName - Name of the dynamical system
 */
async function createEquilibriumBranch(sysName: string) {
  const sysConfig = Storage.loadSystem(sysName);

  const objects = Storage.listObjects(sysName)
    .map(name => Storage.loadObject(sysName, name))
    .filter((obj): obj is EquilibriumObject => obj.type === 'equilibrium' && !!obj.solution);

  if (objects.length === 0) {
    console.log(chalk.red("No converged equilibrium objects found. Create and solve an equilibrium first."));
    return;
  }

  if (sysConfig.paramNames.length === 0) {
    console.log(chalk.red("System has no parameters to continue. Add at least one parameter first."));
    return;
  }

  let selectedEqName = objects[0]?.name ?? '';
  let selectedParamName = sysConfig.paramNames[0] ?? '';
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
      id: 'equilibrium',
      label: 'Starting equilibrium',
      section: 'Branch Settings',
      getDisplay: () => selectedEqName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select Starting Equilibrium:',
          choices: objects.map(o => ({
            name: `${o.name} (${o.solution ? 'solved' : 'unsolved'})`,
            value: o.name
          })),
          default: selectedEqName,
          pageSize: MENU_PAGE_SIZE
        });
        selectedEqName = value;
      }
    },
    {
      id: 'parameter',
      label: 'Continuation parameter',
      section: 'Branch Settings',
      getDisplay: () => selectedParamName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select Continuation Parameter:',
          choices: sysConfig.paramNames,
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
          default: branchName || `${selectedEqName || 'branch'}_${selectedParamName || 'param'}`,
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
          default: correctorStepsInput,
          validate: (input: string) => {
            const parsed = parseInt(input, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              return 'Enter a positive integer.';
            }
            return true;
          }
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
          default: correctorToleranceInput,
          validate: (input: string) => {
            const parsed = parseFloat(input);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              return 'Enter a positive number.';
            }
            return true;
          }
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
          default: stepToleranceInput,
          validate: (input: string) => {
            const parsed = parseFloat(input);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              return 'Enter a positive number.';
            }
            return true;
          }
        });
        stepToleranceInput = value;
      }
    }
  ];

  while (true) {
    const result = await runConfigMenu('Create Continuation Branch', entries);
    if (result === 'back') {
      return;
    }

    if (!selectedEqName) {
      console.error(chalk.red('Please select a starting equilibrium.'));
      continue;
    }

    if (!selectedParamName) {
      console.error(chalk.red('Please select a continuation parameter.'));
      continue;
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

  const eqObj = objects.find(o => o.name === selectedEqName);
  if (!eqObj) {
    console.error(chalk.red('Selected equilibrium could not be found. Aborting.'));
    return;
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

  const forward = directionForward;

  // 5. Run
  console.log(chalk.cyan("Running Continuation..."));
  try {
    // IMPORTANT: Restore parameters from the equilibrium object if available
    // This ensures we start from the state the equilibrium was found at.
    const runConfig = { ...sysConfig };
    if (eqObj.parameters && eqObj.parameters.length === sysConfig.params.length) {
      runConfig.params = [...eqObj.parameters];
    }

    const bridge = new WasmBridge(runConfig);
    const branchData = normalizeBranchEigenvalues(bridge.compute_continuation(
      eqObj.solution!.state,
      selectedParamName,
      continuationSettings,
      forward
    ));

    const branch: ContinuationObject = {
      type: 'continuation',
      name: branchName,
      systemName: sysName,
      parameterName: selectedParamName,
      startObject: selectedEqName,
      branchType: 'equilibrium',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]  // Store full parameter snapshot
    };

    Storage.saveContinuation(sysName, branch);
    console.log(chalk.green(`Continuation successful! Generated ${branchData.points.length} points.`));

    await inspectBranch(sysName, branch);

  } catch (e) {
    console.error(chalk.red("Continuation Failed:"), e);
  }
}
