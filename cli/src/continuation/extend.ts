/**
 * Branch Extension Module
 * 
 * Handles extending existing continuation branches.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { ContinuationObject } from '../types';
import {
  ConfigEntry,
  MENU_PAGE_SIZE,
  formatUnset,
  parseFloatOrDefault,
  parseIntOrDefault,
  runConfigMenu
} from '../menu';
import { printSuccess, printError } from '../format';
import { serializeBranchDataForWasm, normalizeBranchEigenvalues } from './serialization';
import { inspectBranch } from './inspect';

/**
 * Extends an existing continuation branch in either the forward or backward direction.
 * 
 * Presents a configuration menu allowing the user to:
 * - Choose extension direction (forward/backward)
 * - Set max points to add
 * - Configure step size
 * 
 * The new points are appended (forward) or prepended (backward) to the branch.
 * Uses the branch's existing settings as defaults.
 * 
 * @param sysName - Name of the dynamical system
 * @param branch - The continuation branch object to extend
 */
export async function extendBranch(sysName: string, branch: ContinuationObject) {
  const sysConfig = Storage.loadSystem(sysName);
  const defaults = branch.settings || {};

  // State for config menu
  let directionForward = true;
  let maxStepsInput = '50';
  let stepSizeInput = defaults.step_size?.toString() || '0.01';

  const directionLabel = (forward: boolean) =>
    forward ? 'Forward (Append)' : 'Backward (Prepend)';

  const entries: ConfigEntry[] = [
    {
      id: 'direction',
      label: 'Direction',
      section: 'Extension Settings',
      getDisplay: () => directionLabel(directionForward),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Extension Direction:',
          choices: [
            { name: 'Forward (Append)', value: true },
            { name: 'Backward (Prepend)', value: false }
          ],
          default: directionForward ? 0 : 1,
          pageSize: MENU_PAGE_SIZE
        });
        directionForward = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points to add',
      section: 'Extension Settings',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points to Add:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Step size',
      section: 'Extension Settings',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Step Size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    }
  ];

  const result = await runConfigMenu(`Extend Branch: ${branch.name}`, entries);
  if (result === 'back') {
    return;
  }

  const continuationSettings = {
    step_size: parseFloatOrDefault(stepSizeInput, 0.01),
    min_step_size: defaults.min_step_size || 1e-5,
    max_step_size: defaults.max_step_size || 0.1,
    max_steps: parseIntOrDefault(maxStepsInput, 50),
    corrector_steps: defaults.corrector_steps || 4,
    corrector_tolerance: defaults.corrector_tolerance || 1e-6,
    step_tolerance: defaults.step_tolerance || 1e-6
  };

  console.log(chalk.cyan(`Extending Branch ${directionForward ? 'Forward' : 'Backward'}...`));

  try {
    const bridge = new WasmBridge(sysConfig);

    // If indices are missing, fill them (migration)
    if (!branch.data.indices) {
      branch.data.indices = branch.data.points.map((_, i) => i);
    }


    // PATCH: Ensure branch_type is correct for Limit Cycles
    // The stored branch data might have "Equilibrium" or missing branch_type due to legacy bugs,
    // but the container `branch.branchType` is correct.
    // 
    // Rust BranchType uses #[serde(tag = "type")] tagged enum format:
    // - {"type": "Equilibrium"}
    // - {"type": "LimitCycle", "ntst": 20, "ncol": 4}
    const branchDataToPass = serializeBranchDataForWasm(branch.data);
    if (branch.branchType === 'limit_cycle') {
      // Get ntst/ncol from the existing branch_type data
      let ntst = 20;
      let ncol = 4;
      const branchTypeData = branch.data.branch_type as any;

      // Handle stored format: {"LimitCycle":{"ntst":20,"ncol":4}}
      if (branchTypeData?.LimitCycle) {
        ntst = branchTypeData.LimitCycle.ntst ?? 20;
        ncol = branchTypeData.LimitCycle.ncol ?? 4;
      }
      // Handle serde tagged format: {"type":"LimitCycle","ntst":20,"ncol":4}
      else if (branchTypeData?.type === 'LimitCycle') {
        ntst = branchTypeData.ntst ?? 20;
        ncol = branchTypeData.ncol ?? 4;
      }

      // Set in serde tagged enum format (Rust expects this)
      branchDataToPass.branch_type = { type: 'LimitCycle', ntst, ncol };
    }


    const updatedData = bridge.extend_continuation(
      branchDataToPass,
      branch.parameterName,
      continuationSettings,
      directionForward
    );

    branch.data = normalizeBranchEigenvalues(updatedData);
    branch.settings = continuationSettings;

    Storage.saveContinuation(sysName, branch);
    printSuccess(`Extension successful! Total points: ${branch.data.points.length}`);

    await inspectBranch(sysName, branch);

  } catch (e) {
    printError(`Extension Failed: ${e}`);
  }
}
