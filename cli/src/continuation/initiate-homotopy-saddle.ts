import inquirer from 'inquirer';
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
import { printError, printInfo, printSuccess } from '../format';
import { normalizeBranchEigenvalues } from './serialization';
import { getBranchParams, isValidName } from './utils';
import { runHomotopySaddleContinuationWithProgress } from './progress';

type HomotopyBranchTypeData = {
  type: 'HomotopySaddleCurve';
  ntst: number;
  ncol: number;
  param1_name: string;
  param2_name: string;
  stage: 'StageA' | 'StageB' | 'StageC' | 'StageD';
};

function continuationSettingsFromInputs(inputs: {
  stepSizeInput: string;
  maxStepsInput: string;
  minStepSizeInput: string;
  maxStepSizeInput: string;
  correctorStepsInput: string;
  correctorToleranceInput: string;
  stepToleranceInput: string;
}) {
  return {
    step_size: Math.max(parseFloatOrDefault(inputs.stepSizeInput, 0.01), 1e-9),
    min_step_size: Math.max(parseFloatOrDefault(inputs.minStepSizeInput, 1e-6), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(inputs.maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(inputs.maxStepsInput, 120), 1),
    corrector_steps: Math.max(parseIntOrDefault(inputs.correctorStepsInput, 8), 1),
    corrector_tolerance: Math.max(
      parseFloatOrDefault(inputs.correctorToleranceInput, 1e-7),
      Number.EPSILON
    ),
    step_tolerance: Math.max(parseFloatOrDefault(inputs.stepToleranceInput, 1e-7), Number.EPSILON)
  };
}

function ensureHomotopyBranchType(
  branchData: ContinuationObject['data'],
  fallback: HomotopyBranchTypeData
): ContinuationObject['data'] {
  if ((branchData.branch_type as any)?.type === 'HomotopySaddleCurve') {
    return branchData;
  }
  return {
    ...branchData,
    branch_type: fallback
  };
}

export async function initiateHomotopySaddleFromEquilibrium(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.type === 'map') {
    printError('Homotopy-saddle continuation is only available for flow systems.');
    return null;
  }

  if (branch.branchType !== 'equilibrium') {
    printError('Method 5 requires an equilibrium branch point.');
    return null;
  }

  if (sysConfig.paramNames.length < 2) {
    printError('Method 5 requires at least two system parameters.');
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  let curveName = `homotopy_saddle_${branch.name}`;
  let param1Name =
    sysConfig.paramNames.includes(branch.parameterName) ? branch.parameterName : sysConfig.paramNames[0];
  let param2Name =
    sysConfig.paramNames.find((name) => name !== param1Name) || sysConfig.paramNames[0];
  let ntstInput = '40';
  let ncolInput = '4';
  let eps0Input = '0.01';
  let eps1Input = '0.1';
  let timeInput = '40';
  let eps1TolInput = '1e-4';
  let stepSizeInput = '0.01';
  let maxStepsInput = '120';
  let minStepSizeInput = '1e-6';
  let maxStepSizeInput = '0.1';
  let correctorStepsInput = '8';
  let correctorToleranceInput = '1e-7';
  let stepToleranceInput = '1e-7';
  let directionForward = true;

  const directionLabel = (forward: boolean) => (forward ? 'Forward' : 'Backward');

  const entries: ConfigEntry[] = [
    {
      id: 'curveName',
      label: 'Branch name',
      section: 'Output',
      getDisplay: () => curveName || '(required)',
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Homotopy-saddle branch name:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'param1',
      label: 'First parameter',
      section: 'Parameters',
      getDisplay: () => param1Name,
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select first continuation parameter:',
          choices: sysConfig.paramNames,
          default: param1Name,
          pageSize: MENU_PAGE_SIZE
        });
        param1Name = value;
        if (param2Name === param1Name) {
          param2Name =
            sysConfig.paramNames.find((name) => name !== param1Name) || param2Name;
        }
      }
    },
    {
      id: 'param2',
      label: 'Second parameter',
      section: 'Parameters',
      getDisplay: () => param2Name,
      edit: async () => {
        const choices = sysConfig.paramNames.filter((name) => name !== param1Name);
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select second continuation parameter:',
          choices,
          default: choices.includes(param2Name) ? param2Name : choices[0],
          pageSize: MENU_PAGE_SIZE
        });
        param2Name = value;
      }
    },
    {
      id: 'ntst',
      label: 'NTST',
      section: 'Initialization',
      getDisplay: () => formatUnset(ntstInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Mesh intervals (NTST):',
          default: ntstInput
        });
        ntstInput = value;
      }
    },
    {
      id: 'ncol',
      label: 'NCOL',
      section: 'Initialization',
      getDisplay: () => formatUnset(ncolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Collocation points (NCOL):',
          default: ncolInput
        });
        ncolInput = value;
      }
    },
    {
      id: 'eps0',
      label: 'eps0',
      section: 'Initialization',
      getDisplay: () => formatUnset(eps0Input),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Unstable endpoint distance eps0:',
          default: eps0Input
        });
        eps0Input = value;
      }
    },
    {
      id: 'eps1',
      label: 'eps1',
      section: 'Initialization',
      getDisplay: () => formatUnset(eps1Input),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Stable endpoint distance eps1:',
          default: eps1Input
        });
        eps1Input = value;
      }
    },
    {
      id: 'time',
      label: 'Time T',
      section: 'Initialization',
      getDisplay: () => formatUnset(timeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial homoclinic time T:',
          default: timeInput
        });
        timeInput = value;
      }
    },
    {
      id: 'eps1Tol',
      label: 'eps1 tolerance',
      section: 'Initialization',
      getDisplay: () => formatUnset(eps1TolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'StageD target eps1 tolerance:',
          default: eps1TolInput
        });
        eps1TolInput = value;
      }
    },
    {
      id: 'direction',
      label: 'Direction',
      section: 'Predictor',
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
          default: directionForward ? 0 : 1
        });
        directionForward = value;
      }
    },
    {
      id: 'stepSize',
      label: 'Initial step size',
      section: 'Predictor',
      getDisplay: () => formatUnset(stepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial step size:',
          default: stepSizeInput
        });
        stepSizeInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Max points',
      section: 'Predictor',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max points:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'minStepSize',
      label: 'Min step size',
      section: 'Predictor',
      getDisplay: () => formatUnset(minStepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Min step size:',
          default: minStepSizeInput
        });
        minStepSizeInput = value;
      }
    },
    {
      id: 'maxStepSize',
      label: 'Max step size',
      section: 'Predictor',
      getDisplay: () => formatUnset(maxStepSizeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max step size:',
          default: maxStepSizeInput
        });
        maxStepSizeInput = value;
      }
    },
    {
      id: 'correctorSteps',
      label: 'Corrector steps',
      section: 'Corrector',
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
      section: 'Corrector',
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
      section: 'Corrector',
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

  const menuResult = await runConfigMenu('Method 5: Homotopy-Saddle from Equilibrium', entries);
  if (menuResult === 'back') {
    return null;
  }

  const nameValidation = isValidName(curveName);
  if (nameValidation !== true) {
    printError(String(nameValidation));
    return null;
  }

  if (Storage.listBranches(sysName, branch.parentObject).includes(curveName)) {
    printError(`Branch "${curveName}" already exists.`);
    return null;
  }

  if (param1Name === param2Name) {
    printError('First and second parameters must differ.');
    return null;
  }

  const ntst = Math.max(parseIntOrDefault(ntstInput, 40), 2);
  const ncol = Math.max(parseIntOrDefault(ncolInput, 4), 1);
  const eps0 = Math.max(parseFloatOrDefault(eps0Input, 0.01), 1e-12);
  const eps1 = Math.max(parseFloatOrDefault(eps1Input, 0.1), 1e-12);
  const time = Math.max(parseFloatOrDefault(timeInput, 40), 1e-9);
  const eps1Tol = Math.max(parseFloatOrDefault(eps1TolInput, 1e-4), 1e-12);

  const continuationSettings = continuationSettingsFromInputs({
    stepSizeInput,
    maxStepsInput,
    minStepSizeInput,
    maxStepSizeInput,
    correctorStepsInput,
    correctorToleranceInput,
    stepToleranceInput
  });

  printInfo(`Initializing homotopy-saddle setup from point ${pointIndex}...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    const p1Idx = sysConfig.paramNames.indexOf(param1Name);
    if (p1Idx >= 0) {
      runConfig.params[p1Idx] = point.param_value;
    }

    const bridge = new WasmBridge(runConfig);
    const setup = bridge.initHomotopySaddleFromEquilibrium(
      point.state,
      param1Name,
      param2Name,
      ntst,
      ncol,
      eps0,
      eps1,
      time,
      eps1Tol
    );

    const rawData = runHomotopySaddleContinuationWithProgress(
      bridge,
      setup,
      continuationSettings,
      directionForward,
      'Homotopy-Saddle Continuation'
    );

    const normalized = normalizeBranchEigenvalues(rawData);
    const branchData = ensureHomotopyBranchType(normalized, {
      type: 'HomotopySaddleCurve',
      ntst,
      ncol,
      param1_name: param1Name,
      param2_name: param2Name,
      stage: 'StageD'
    });

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysConfig.name,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'homotopy_saddle_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params],
      mapIterations: branch.mapIterations
    };

    Storage.saveBranch(sysName, newBranch.parentObject, newBranch);
    printSuccess(`Homotopy-saddle branch complete: ${newBranch.data.points.length} points.`);

    return newBranch;
  } catch (error) {
    printError(`Method 5 failed: ${error}`);
    return null;
  }
}
