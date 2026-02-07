import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import { ContinuationBranchData, ContinuationObject, ContinuationPoint } from '../types';
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
import { runHomoclinicContinuationWithProgress } from './progress';

type HomoclinicBranchTypeData = {
  type: 'HomoclinicCurve';
  ntst: number;
  ncol: number;
  param1_name: string;
  param2_name: string;
  free_time: boolean;
  free_eps0: boolean;
  free_eps1: boolean;
};

type HomotopyBranchTypeData = {
  type: 'HomotopySaddleCurve';
  ntst: number;
  ncol: number;
  param1_name: string;
  param2_name: string;
  stage: 'StageA' | 'StageB' | 'StageC' | 'StageD';
};

type EndpointSeed = NonNullable<
  ContinuationBranchData['resume_state']
>[keyof NonNullable<ContinuationBranchData['resume_state']>];

function buildAugmentedState(point: { param_value: number; state: number[] }): number[] | null {
  if (!Number.isFinite(point.param_value)) return null;
  if (!Array.isArray(point.state) || point.state.length === 0) return null;
  if (point.state.some((value) => !Number.isFinite(value))) return null;
  return [point.param_value, ...point.state];
}

function normalizeVector(values: number[]): number[] | null {
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm <= 1e-12) return null;
  return values.map((value) => value / norm);
}

function buildTrimmedBoundarySeed(
  originalPoints: ContinuationBranchData['points'],
  trimmedPoints: ContinuationBranchData['points'],
  stepSizeHint: number
): EndpointSeed | undefined {
  const retained = trimmedPoints[0];
  if (!retained) return undefined;

  const retainedAug = buildAugmentedState(retained);
  if (!retainedAug) return undefined;

  let tangent: number[] | null = null;
  const prev = originalPoints[0];
  const next = originalPoints[2];
  if (prev && next) {
    const prevAug = buildAugmentedState(prev);
    const nextAug = buildAugmentedState(next);
    if (
      prevAug &&
      nextAug &&
      prevAug.length === retainedAug.length &&
      nextAug.length === retainedAug.length
    ) {
      const centered = nextAug.map((value, index) => value - prevAug[index]);
      tangent = normalizeVector(centered);
    }
  }

  if (!tangent && trimmedPoints[1]) {
    const neighborAug = buildAugmentedState(trimmedPoints[1]);
    if (neighborAug && neighborAug.length === retainedAug.length) {
      const secant = retainedAug.map((value, index) => value - neighborAug[index]);
      tangent = normalizeVector(secant);
    }
  }

  if (!tangent) return undefined;

  const step_size =
    Number.isFinite(stepSizeHint) && stepSizeHint > 0 ? stepSizeHint : 0.01;

  return {
    endpoint_index: 0,
    aug_state: retainedAug,
    tangent,
    step_size,
  };
}

function remapTrimmedEndpointSeed(
  seed: EndpointSeed | undefined,
  indexBase: number,
  validIndices: Set<number>
): EndpointSeed | undefined {
  if (!seed || !Number.isFinite(seed.endpoint_index)) {
    return undefined;
  }
  const endpoint_index = seed.endpoint_index - indexBase;
  if (!validIndices.has(endpoint_index)) {
    return undefined;
  }
  return {
    ...seed,
    endpoint_index,
  };
}

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
    min_step_size: Math.max(parseFloatOrDefault(inputs.minStepSizeInput, 1e-5), 1e-12),
    max_step_size: Math.max(parseFloatOrDefault(inputs.maxStepSizeInput, 0.1), 1e-9),
    max_steps: Math.max(parseIntOrDefault(inputs.maxStepsInput, 300), 1),
    corrector_steps: Math.max(parseIntOrDefault(inputs.correctorStepsInput, 32), 1),
    corrector_tolerance: Math.max(
      parseFloatOrDefault(inputs.correctorToleranceInput, 1e-7),
      Number.EPSILON
    ),
    step_tolerance: Math.max(parseFloatOrDefault(inputs.stepToleranceInput, 1e-7), Number.EPSILON)
  };
}

export function discardInitialApproximationPoint(data: ContinuationBranchData): ContinuationBranchData {
  if (!Array.isArray(data.points) || data.points.length <= 1) {
    return data;
  }
  const seed = data.points[0];
  const seedAnchor =
    seed &&
    Array.isArray(seed.state) &&
    seed.state.length > 0 &&
    Number.isFinite(seed.param_value)
      ? [seed.param_value, ...seed.state]
      : null;
  const points = data.points.slice(1);
  const rawIndices =
    Array.isArray(data.indices) && data.indices.length === data.points.length
      ? data.indices.slice(1)
      : points.map((_, index) => index);
  const indexBase = rawIndices.length > 0 ? rawIndices[0] : 0;
  const indices = rawIndices.map((value, index) =>
    Number.isFinite(value) ? value - indexBase : index
  );
  const validIndices = new Set(indices.filter((idx) => Number.isFinite(idx)));
  const bifurcations = (data.bifurcations ?? [])
    .filter((idx) => idx > 0)
    .map((idx) => idx - 1)
    .filter((idx) => idx >= 0 && idx < points.length);
  const minSeed = remapTrimmedEndpointSeed(
    data.resume_state?.min_index_seed,
    indexBase,
    validIndices
  );
  const maxSeed = remapTrimmedEndpointSeed(
    data.resume_state?.max_index_seed,
    indexBase,
    validIndices
  );
  const finiteIndices = indices.filter((idx) => Number.isFinite(idx));
  const minLogicalIndex = finiteIndices.length > 0 ? Math.min(...finiteIndices) : 0;
  const maxLogicalIndex = finiteIndices.length > 0 ? Math.max(...finiteIndices) : 0;
  const boundaryStepHint =
    data.resume_state?.min_index_seed?.step_size ??
    data.resume_state?.max_index_seed?.step_size ??
    0.01;
  const synthesizedBoundarySeed =
    points.length > 1 ? buildTrimmedBoundarySeed(data.points, points, boundaryStepHint) : undefined;
  const minBoundarySeed =
    !minSeed && synthesizedBoundarySeed && minLogicalIndex === 0
      ? synthesizedBoundarySeed
      : minSeed;
  const maxBoundarySeed =
    !maxSeed && synthesizedBoundarySeed && maxLogicalIndex === 0
      ? synthesizedBoundarySeed
      : maxSeed;
  const normalized: ContinuationBranchData & { upoldp?: number[][] } = {
    ...data,
    points,
    indices,
    bifurcations,
    resume_state: minBoundarySeed || maxBoundarySeed
      ? {
          min_index_seed: minBoundarySeed,
          max_index_seed: maxBoundarySeed,
        }
      : undefined,
  };
  if (seedAnchor && seedAnchor.every(Number.isFinite)) {
    normalized.upoldp = [seedAnchor];
  }
  return normalized;
}

function ensureHomoclinicBranchType(
  data: ContinuationBranchData,
  fallback: HomoclinicBranchTypeData
): ContinuationBranchData {
  if ((data.branch_type as any)?.type === 'HomoclinicCurve') {
    return data;
  }
  return {
    ...data,
    branch_type: fallback
  };
}

function resolveLimitCycleMesh(branch: ContinuationObject): { ntst: number; ncol: number } {
  const branchType = branch.data.branch_type as any;
  if (branchType?.type === 'LimitCycle') {
    return {
      ntst: Math.max(2, Number(branchType.ntst) || 20),
      ncol: Math.max(1, Number(branchType.ncol) || 4)
    };
  }
  return { ntst: 20, ncol: 4 };
}

export async function initiateHomoclinicFromLargeCycle(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.type === 'map') {
    printError('Homoclinic continuation is only available for flow systems.');
    return null;
  }

  if (branch.branchType !== 'limit_cycle') {
    printError('Method 1 requires a limit cycle branch point.');
    return null;
  }

  if (sysConfig.paramNames.length < 2) {
    printError('Method 1 requires at least two system parameters.');
    return null;
  }

  const mesh = resolveLimitCycleMesh(branch);
  const branchParams = getBranchParams(sysName, branch, sysConfig);

  let curveName = `homoc_${branch.name}`;
  let param1Name =
    sysConfig.paramNames.includes(branch.parameterName) ? branch.parameterName : sysConfig.paramNames[0];
  let param2Name =
    sysConfig.paramNames.find((name) => name !== param1Name) || sysConfig.paramNames[0];
  let targetNtstInput = `${Math.max(mesh.ntst, 40)}`;
  let targetNcolInput = `${mesh.ncol}`;
  let freeTime = false;
  let freeEps0 = true;
  let freeEps1 = true;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let correctorStepsInput = '32';
  let correctorToleranceInput = '1e-8';
  let stepToleranceInput = '1e-8';
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
          message: 'Homoclinic branch name:',
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
      id: 'targetNtst',
      label: 'Target NTST',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNtstInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target mesh intervals (NTST):',
          default: targetNtstInput
        });
        targetNtstInput = value;
      }
    },
    {
      id: 'targetNcol',
      label: 'Target NCOL',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNcolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target collocation points (NCOL):',
          default: targetNcolInput
        });
        targetNcolInput = value;
      }
    },
    {
      id: 'freeTime',
      label: 'Free T',
      section: 'Initialization',
      getDisplay: () => (freeTime ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free time variable T?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeTime ? 0 : 1
        });
        freeTime = value;
      }
    },
    {
      id: 'freeEps0',
      label: 'Free eps0',
      section: 'Initialization',
      getDisplay: () => (freeEps0 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps0?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps0 ? 0 : 1
        });
        freeEps0 = value;
      }
    },
    {
      id: 'freeEps1',
      label: 'Free eps1',
      section: 'Initialization',
      getDisplay: () => (freeEps1 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps1?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps1 ? 0 : 1
        });
        freeEps1 = value;
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

  const menuResult = await runConfigMenu('Method 1: Homoclinic from Large Cycle', entries);
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

  if (!freeTime && !freeEps0 && !freeEps1) {
    printError('At least one of T, eps0, or eps1 must be free.');
    return null;
  }

  const targetNtst = Math.max(parseIntOrDefault(targetNtstInput, 40), 2);
  const targetNcol = Math.max(parseIntOrDefault(targetNcolInput, 4), 1);
  const continuationSettings = continuationSettingsFromInputs({
    stepSizeInput,
    maxStepsInput,
    minStepSizeInput,
    maxStepSizeInput,
    correctorStepsInput,
    correctorToleranceInput,
    stepToleranceInput
  });

  printInfo(`Initializing homoclinic setup from branch point ${pointIndex}...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    const p1Idx = sysConfig.paramNames.indexOf(param1Name);
    if (p1Idx >= 0) {
      runConfig.params[p1Idx] = point.param_value;
    }

    const bridge = new WasmBridge(runConfig);
    const setup = bridge.initHomoclinicFromLargeCycle(
      point.state,
      mesh.ntst,
      mesh.ncol,
      param1Name,
      param2Name,
      targetNtst,
      targetNcol,
      freeTime,
      freeEps0,
      freeEps1
    );

    const rawData = runHomoclinicContinuationWithProgress(
      bridge,
      setup,
      continuationSettings,
      directionForward,
      'Homoclinic Continuation'
    );

    const branchData = ensureHomoclinicBranchType(
      discardInitialApproximationPoint(normalizeBranchEigenvalues(rawData)),
      {
        type: 'HomoclinicCurve',
        ntst: targetNtst,
        ncol: targetNcol,
        param1_name: param1Name,
        param2_name: param2Name,
        free_time: freeTime,
        free_eps0: freeEps0,
        free_eps1: freeEps1
      }
    );

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysConfig.name,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'homoclinic_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    Storage.saveBranch(sysName, newBranch.parentObject, newBranch);
    printSuccess(`Homoclinic branch complete: ${newBranch.data.points.length} points.`);

    return newBranch;
  } catch (error) {
    printError(`Method 1 failed: ${error}`);
    return null;
  }
}

export async function initiateHomoclinicFromHomoclinic(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.type === 'map') {
    printError('Homoclinic continuation is only available for flow systems.');
    return null;
  }

  if (branch.branchType !== 'homoclinic_curve') {
    printError('Method 2 requires an existing homoclinic branch.');
    return null;
  }

  const source = branch.data.branch_type as HomoclinicBranchTypeData | undefined;
  if (!source || source.type !== 'HomoclinicCurve') {
    printError('Source homoclinic branch metadata is missing.');
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  let curveName = `homoc_${branch.name}_restart`;
  let targetNtstInput = `${source.ntst}`;
  let targetNcolInput = `${source.ncol}`;
  let freeTime = source.free_time;
  let freeEps0 = source.free_eps0;
  let freeEps1 = source.free_eps1;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let correctorStepsInput = '32';
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
          message: 'Homoclinic branch name:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'targetNtst',
      label: 'Target NTST',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNtstInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target mesh intervals (NTST):',
          default: targetNtstInput
        });
        targetNtstInput = value;
      }
    },
    {
      id: 'targetNcol',
      label: 'Target NCOL',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNcolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target collocation points (NCOL):',
          default: targetNcolInput
        });
        targetNcolInput = value;
      }
    },
    {
      id: 'freeTime',
      label: 'Free T',
      section: 'Initialization',
      getDisplay: () => (freeTime ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free time variable T?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeTime ? 0 : 1
        });
        freeTime = value;
      }
    },
    {
      id: 'freeEps0',
      label: 'Free eps0',
      section: 'Initialization',
      getDisplay: () => (freeEps0 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps0?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps0 ? 0 : 1
        });
        freeEps0 = value;
      }
    },
    {
      id: 'freeEps1',
      label: 'Free eps1',
      section: 'Initialization',
      getDisplay: () => (freeEps1 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps1?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps1 ? 0 : 1
        });
        freeEps1 = value;
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

  const menuResult = await runConfigMenu('Method 2: Homoclinic from Homoclinic', entries);
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

  if (!freeTime && !freeEps0 && !freeEps1) {
    printError('At least one of T, eps0, or eps1 must be free.');
    return null;
  }

  const targetNtst = Math.max(parseIntOrDefault(targetNtstInput, source.ntst), 2);
  const targetNcol = Math.max(parseIntOrDefault(targetNcolInput, source.ncol), 1);
  const continuationSettings = continuationSettingsFromInputs({
    stepSizeInput,
    maxStepsInput,
    minStepSizeInput,
    maxStepSizeInput,
    correctorStepsInput,
    correctorToleranceInput,
    stepToleranceInput
  });

  printInfo(`Re-initializing homoclinic setup from point ${pointIndex}...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    const p1Idx = sysConfig.paramNames.indexOf(source.param1_name);
    if (p1Idx >= 0) {
      runConfig.params[p1Idx] = point.param_value;
    }

    const bridge = new WasmBridge(runConfig);
    const setup = bridge.initHomoclinicFromHomoclinic(
      point.state,
      source.ntst,
      source.ncol,
      source.param1_name,
      source.param2_name,
      targetNtst,
      targetNcol,
      freeTime,
      freeEps0,
      freeEps1
    );

    const rawData = runHomoclinicContinuationWithProgress(
      bridge,
      setup,
      continuationSettings,
      directionForward,
      'Homoclinic Continuation'
    );

    const branchData = ensureHomoclinicBranchType(
      normalizeBranchEigenvalues(rawData),
      {
        type: 'HomoclinicCurve',
        ntst: targetNtst,
        ncol: targetNcol,
        param1_name: source.param1_name,
        param2_name: source.param2_name,
        free_time: freeTime,
        free_eps0: freeEps0,
        free_eps1: freeEps1
      }
    );

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysConfig.name,
      parameterName: `${source.param1_name}, ${source.param2_name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'homoclinic_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    Storage.saveBranch(sysName, newBranch.parentObject, newBranch);
    printSuccess(`Homoclinic branch complete: ${newBranch.data.points.length} points.`);

    return newBranch;
  } catch (error) {
    printError(`Method 2 failed: ${error}`);
    return null;
  }
}

export async function initiateHomoclinicFromHomotopySaddle(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);

  if (sysConfig.type === 'map') {
    printError('Homoclinic continuation is only available for flow systems.');
    return null;
  }

  if (branch.branchType !== 'homotopy_saddle_curve') {
    printError('Method 4 requires a homotopy-saddle branch.');
    return null;
  }

  const source = branch.data.branch_type as HomotopyBranchTypeData | undefined;
  if (!source || source.type !== 'HomotopySaddleCurve') {
    printError('Source homotopy-saddle metadata is missing.');
    return null;
  }

  if (source.stage !== 'StageD') {
    printError('Method 4 can only initialize from StageD points.');
    return null;
  }

  const branchParams = getBranchParams(sysName, branch, sysConfig);

  let curveName = `homoc_${branch.name}_stage_d`;
  let targetNtstInput = `${source.ntst}`;
  let targetNcolInput = `${source.ncol}`;
  let freeTime = false;
  let freeEps0 = true;
  let freeEps1 = true;
  let stepSizeInput = '0.01';
  let maxStepsInput = '300';
  let minStepSizeInput = '1e-5';
  let maxStepSizeInput = '0.1';
  let correctorStepsInput = '32';
  let correctorToleranceInput = '1e-8';
  let stepToleranceInput = '1e-8';
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
          message: 'Homoclinic branch name:',
          default: curveName,
          validate: (val: string) => isValidName(val)
        });
        curveName = value;
      }
    },
    {
      id: 'targetNtst',
      label: 'Target NTST',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNtstInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target mesh intervals (NTST):',
          default: targetNtstInput
        });
        targetNtstInput = value;
      }
    },
    {
      id: 'targetNcol',
      label: 'Target NCOL',
      section: 'Initialization',
      getDisplay: () => formatUnset(targetNcolInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target collocation points (NCOL):',
          default: targetNcolInput
        });
        targetNcolInput = value;
      }
    },
    {
      id: 'freeTime',
      label: 'Free T',
      section: 'Initialization',
      getDisplay: () => (freeTime ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free time variable T?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeTime ? 0 : 1
        });
        freeTime = value;
      }
    },
    {
      id: 'freeEps0',
      label: 'Free eps0',
      section: 'Initialization',
      getDisplay: () => (freeEps0 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps0?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps0 ? 0 : 1
        });
        freeEps0 = value;
      }
    },
    {
      id: 'freeEps1',
      label: 'Free eps1',
      section: 'Initialization',
      getDisplay: () => (freeEps1 ? 'Yes' : 'No'),
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Free eps1?',
          choices: [
            { name: 'Yes', value: true },
            { name: 'No', value: false }
          ],
          default: freeEps1 ? 0 : 1
        });
        freeEps1 = value;
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

  const menuResult = await runConfigMenu('Method 4: Homoclinic from Homotopy-Saddle', entries);
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

  if (!freeTime && !freeEps0 && !freeEps1) {
    printError('At least one of T, eps0, or eps1 must be free.');
    return null;
  }

  const targetNtst = Math.max(parseIntOrDefault(targetNtstInput, source.ntst), 2);
  const targetNcol = Math.max(parseIntOrDefault(targetNcolInput, source.ncol), 1);
  const continuationSettings = continuationSettingsFromInputs({
    stepSizeInput,
    maxStepsInput,
    minStepSizeInput,
    maxStepSizeInput,
    correctorStepsInput,
    correctorToleranceInput,
    stepToleranceInput
  });

  printInfo(`Initializing homoclinic setup from StageD point ${pointIndex}...`);

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = [...branchParams];

    const p1Idx = sysConfig.paramNames.indexOf(source.param1_name);
    if (p1Idx >= 0) {
      runConfig.params[p1Idx] = point.param_value;
    }

    const bridge = new WasmBridge(runConfig);
    const setup = bridge.initHomoclinicFromHomotopySaddle(
      point.state,
      source.ntst,
      source.ncol,
      source.param1_name,
      source.param2_name,
      targetNtst,
      targetNcol,
      freeTime,
      freeEps0,
      freeEps1
    );

    const rawData = runHomoclinicContinuationWithProgress(
      bridge,
      setup,
      continuationSettings,
      directionForward,
      'Homoclinic Continuation'
    );

    const branchData = ensureHomoclinicBranchType(
      normalizeBranchEigenvalues(rawData),
      {
        type: 'HomoclinicCurve',
        ntst: targetNtst,
        ncol: targetNcol,
        param1_name: source.param1_name,
        param2_name: source.param2_name,
        free_time: freeTime,
        free_eps0: freeEps0,
        free_eps1: freeEps1
      }
    );

    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: curveName,
      systemName: sysConfig.name,
      parameterName: `${source.param1_name}, ${source.param2_name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'homoclinic_curve',
      data: branchData,
      settings: continuationSettings,
      timestamp: new Date().toISOString(),
      params: [...runConfig.params]
    };

    Storage.saveBranch(sysName, newBranch.parentObject, newBranch);
    printSuccess(`Homoclinic branch complete: ${newBranch.data.points.length} points.`);

    return newBranch;
  } catch (error) {
    printError(`Method 4 failed: ${error}`);
    return null;
  }
}
