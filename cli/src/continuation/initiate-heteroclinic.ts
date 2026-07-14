import chalk from 'chalk';
import inquirer from 'inquirer';
import { printError, printInfo, printSuccess } from '../format';
import { MENU_PAGE_SIZE } from '../menu';
import { Storage } from '../storage';
import type {
  ContinuationObject,
  EquilibriumObject,
  OrbitObject,
  SystemConfig,
} from '../types';
import { WasmBridge } from '../wasm';
import { buildCollocationAdaptivitySettings } from './collocation-adaptivity';
import { inspectBranch } from './inspect';
import { runHeteroclinicContinuationWithProgress } from './progress';
import { normalizeBranchEigenvalues } from './serialization';
import { isValidName } from './utils';

type InitiateHeteroclinicOptions = { autoInspect?: boolean };

function sameParameters(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        Number.isFinite(value) &&
        Number.isFinite(right[index]) &&
        Math.abs(value - right[index]) <= 1e-10 * (1 + Math.abs(right[index]))
    )
  );
}

export function heteroclinicEligibilityError(
  system: SystemConfig,
  orbit: OrbitObject,
  equilibria: EquilibriumObject[]
): string | null {
  if (system.type !== 'flow') return 'Heteroclinic continuation is available for flows only.';
  if (system.paramNames.length < 2) return 'Add at least two system parameters first.';
  if (orbit.data.length < 2) return 'The seed orbit must contain at least two samples.';
  if (equilibria.length < 2) return 'Solve two distinct equilibrium objects first.';
  const orbitParams =
    orbit.parameters?.length === system.params.length ? orbit.parameters : system.params;
  const compatible = equilibria.filter((equilibrium) => {
    const params =
      equilibrium.parameters?.length === system.params.length
        ? equilibrium.parameters
        : system.params;
    return sameParameters(params, orbitParams);
  });
  return compatible.length >= 2
    ? null
    : 'Two solved equilibria must share the orbit parameter snapshot.';
}

export async function initiateHeteroclinicFromOrbit(
  sysName: string,
  orbit: OrbitObject,
  options: InitiateHeteroclinicOptions = {}
): Promise<ContinuationObject | null> {
  const system = Storage.loadSystem(sysName);
  const equilibria = Storage.listObjects(sysName)
    .map((name) => Storage.loadObject(sysName, name))
    .filter(
      (object): object is EquilibriumObject =>
        object.type === 'equilibrium' && Boolean(object.solution)
    );
  const eligibilityError = heteroclinicEligibilityError(system, orbit, equilibria);
  if (eligibilityError) {
    printError(eligibilityError);
    return null;
  }
  const orbitParams =
    orbit.parameters?.length === system.params.length ? [...orbit.parameters] : [...system.params];
  const compatibleEquilibria = equilibria.filter((equilibrium) => {
    const params =
      equilibrium.parameters?.length === system.params.length
        ? equilibrium.parameters
        : system.params;
    return sameParameters(params, orbitParams);
  });
  const defaultSource = compatibleEquilibria[0]?.name ?? '';
  const defaultTarget = compatibleEquilibria[1]?.name ?? '';
  const defaultParam1 = system.paramNames[0] ?? '';
  const defaultParam2 = system.paramNames[1] ?? '';

  const answers: any = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'sourceName',
      message: 'Source equilibrium:',
      choices: compatibleEquilibria.map((equilibrium) => equilibrium.name),
      default: defaultSource,
      pageSize: MENU_PAGE_SIZE,
    },
    {
      type: 'rawlist',
      name: 'targetName',
      message: 'Target equilibrium:',
      choices: (current: { sourceName?: string }) =>
        compatibleEquilibria
          .filter((equilibrium) => equilibrium.name !== current.sourceName)
          .map((equilibrium) => equilibrium.name),
      default: defaultTarget,
      pageSize: MENU_PAGE_SIZE,
    },
    {
      type: 'rawlist',
      name: 'parameterName',
      message: 'Continuation parameter:',
      choices: system.paramNames,
      default: defaultParam1,
      pageSize: MENU_PAGE_SIZE,
    },
    {
      type: 'rawlist',
      name: 'param2Name',
      message: 'Second parameter:',
      choices: (current: { parameterName?: string }) =>
        system.paramNames.filter((name) => name !== current.parameterName),
      default: defaultParam2,
      pageSize: MENU_PAGE_SIZE,
    },
    {
      name: 'branchName',
      message: 'Heteroclinic branch name:',
      default: (current: { sourceName?: string; targetName?: string }) =>
        `heteroc_${current.sourceName ?? 'source'}_to_${current.targetName ?? 'target'}`,
      validate: (value: string) => {
        const validity = isValidName(value);
        if (validity !== true) return validity;
        return Storage.listBranches(sysName, orbit.name).includes(value)
          ? 'Branch name already exists.'
          : true;
      },
    },
    {
      type: 'rawlist',
      name: 'discretization',
      message: 'Connection method:',
      choices: [
        { name: 'Orthogonal Collocation (default)', value: 'collocation' },
        { name: 'Standard Shooting', value: 'shooting' },
      ],
      default: 'collocation',
      pageSize: MENU_PAGE_SIZE,
    },
    { type: 'number', name: 'ntst', message: 'Mesh intervals (NTST):', default: 40 },
    { type: 'number', name: 'ncol', message: 'Collocation degree (NCOL):', default: 4 },
    {
      type: 'number',
      name: 'shootingIntervals',
      message: 'Shooting intervals (1 = single shooting):',
      default: 8,
      when: (current: { discretization?: string }) => current.discretization === 'shooting',
    },
    {
      type: 'number',
      name: 'integrationStepsPerSegment',
      message: 'Integration steps per shooting segment:',
      default: 64,
      when: (current: { discretization?: string }) => current.discretization === 'shooting',
    },
    { type: 'confirm', name: 'freeTime', message: 'Free flight time T?', default: false },
    { type: 'confirm', name: 'freeEps0', message: 'Free source radius eps0?', default: true },
    { type: 'confirm', name: 'freeEps1', message: 'Free target radius eps1?', default: true },
    {
      type: 'number',
      name: 'projectorRefreshInterval',
      message: 'Accepted steps between projector refreshes:',
      default: 2,
    },
    { type: 'number', name: 'stepSize', message: 'Initial step size:', default: 0.01 },
    { type: 'number', name: 'minStepSize', message: 'Minimum step size:', default: 1e-5 },
    { type: 'number', name: 'maxStepSize', message: 'Maximum step size:', default: 0.1 },
    { type: 'number', name: 'maxSteps', message: 'Maximum points:', default: 300 },
    { type: 'number', name: 'correctorSteps', message: 'Corrector steps:', default: 32 },
    {
      type: 'number',
      name: 'correctorTolerance',
      message: 'Corrector tolerance:',
      default: 1e-8,
    },
    { type: 'number', name: 'stepTolerance', message: 'Step tolerance:', default: 1e-8 },
    {
      type: 'confirm',
      name: 'adaptiveCollocationEnabled',
      message: 'Enable adaptive collocation mesh?',
      default: true,
      when: (current: { discretization?: string }) => current.discretization !== 'shooting',
    },
    {
      type: 'confirm',
      name: 'adaptiveRedistributionEnabled',
      message: 'Allow mesh redistribution?',
      default: true,
      when: (current: { adaptiveCollocationEnabled?: boolean; discretization?: string }) =>
        current.discretization !== 'shooting' && current.adaptiveCollocationEnabled,
    },
    {
      type: 'number',
      name: 'adaptiveDefectTolerance',
      message: 'Collocation defect tolerance:',
      default: 0.025,
      when: (current: { adaptiveCollocationEnabled?: boolean; discretization?: string }) =>
        current.discretization !== 'shooting' && current.adaptiveCollocationEnabled,
    },
    {
      type: 'number',
      name: 'adaptiveMaxRefinements',
      message: 'Maximum mesh adaptations:',
      default: 3,
      when: (current: { adaptiveCollocationEnabled?: boolean; discretization?: string }) =>
        current.discretization !== 'shooting' && current.adaptiveCollocationEnabled,
    },
    {
      type: 'number',
      name: 'adaptiveMaxMeshPoints',
      message: 'Maximum mesh intervals:',
      default: 512,
      when: (current: { adaptiveCollocationEnabled?: boolean; discretization?: string }) =>
        current.discretization !== 'shooting' && current.adaptiveCollocationEnabled,
    },
    {
      type: 'rawlist',
      name: 'forward',
      message: 'Continuation direction:',
      choices: [
        { name: 'Forward', value: true },
        { name: 'Backward', value: false },
      ],
      default: true,
      pageSize: MENU_PAGE_SIZE,
    },
  ]);

  const freeCount = Number(answers.freeTime) + Number(answers.freeEps0) + Number(answers.freeEps1);
  if (freeCount < 1 || freeCount > 2) {
    printError('Choose one or two free quantities among T, eps0, and eps1.');
    return null;
  }
  if (!Number.isInteger(answers.ntst) || answers.ntst < 2) {
    printError('NTST must be an integer of at least 2.');
    return null;
  }
  if (!Number.isInteger(answers.ncol) || answers.ncol < 1) {
    printError('NCOL must be a positive integer.');
    return null;
  }
  if (
    answers.discretization === 'shooting' &&
    (!Number.isInteger(answers.shootingIntervals) || answers.shootingIntervals < 1)
  ) {
    printError('Shooting intervals must be a positive integer (1 selects single shooting).');
    return null;
  }
  if (
    answers.discretization === 'shooting' &&
    (!Number.isInteger(answers.integrationStepsPerSegment) ||
      answers.integrationStepsPerSegment < 1)
  ) {
    printError('Integration steps per shooting segment must be a positive integer.');
    return null;
  }
  if (!Number.isInteger(answers.projectorRefreshInterval) || answers.projectorRefreshInterval < 1) {
    printError('Projector refresh interval must be a positive integer.');
    return null;
  }
  const source = compatibleEquilibria.find((equilibrium) => equilibrium.name === answers.sourceName);
  const target = compatibleEquilibria.find((equilibrium) => equilibrium.name === answers.targetName);
  if (!source?.solution || !target?.solution || source.name === target.name) {
    printError('Select two distinct solved equilibrium objects.');
    return null;
  }

  const adaptivityInputs = {
    enabled: Boolean(answers.adaptiveCollocationEnabled),
    redistributionEnabled: answers.adaptiveRedistributionEnabled !== false,
    defectTolerance: String(answers.adaptiveDefectTolerance ?? 0.025),
    maxRefinements: String(answers.adaptiveMaxRefinements ?? 3),
    maxMeshPoints: String(answers.adaptiveMaxMeshPoints ?? 512),
  };
  const settings = {
    step_size: Math.max(Number(answers.stepSize), 1e-12),
    min_step_size: Math.max(Number(answers.minStepSize), 1e-14),
    max_step_size: Math.max(Number(answers.maxStepSize), 1e-12),
    max_steps: Math.max(Math.trunc(Number(answers.maxSteps)), 1),
    corrector_steps: Math.max(Math.trunc(Number(answers.correctorSteps)), 1),
    corrector_tolerance: Math.max(Number(answers.correctorTolerance), Number.EPSILON),
    step_tolerance: Math.max(Number(answers.stepTolerance), Number.EPSILON),
    collocation_adaptivity: buildCollocationAdaptivitySettings(adaptivityInputs),
    projector_refresh_interval: answers.projectorRefreshInterval,
  };

  try {
    printInfo('Initializing independent source and target projector charts...');
    const bridge = new WasmBridge({ ...system, params: orbitParams });
    const collocationSetup = bridge.initHeteroclinicFromOrbit(
      orbit.data.map((row) => row[0]),
      orbit.data.map((row) => row.slice(1)),
      source.solution.state,
      target.solution.state,
      answers.parameterName,
      answers.param2Name,
      answers.ntst,
      answers.ncol,
      answers.freeTime,
      answers.freeEps0,
      answers.freeEps1
    );
    const setup = answers.discretization === 'shooting'
      ? bridge.initHeteroclinicShootingFromCollocation(
          collocationSetup,
          answers.shootingIntervals,
          answers.integrationStepsPerSegment
        )
      : collocationSetup;
    const data = normalizeBranchEigenvalues(
      runHeteroclinicContinuationWithProgress(
        bridge,
        setup,
        settings,
        answers.forward,
        'Heteroclinic continuation',
        answers.discretization
      )
    );
    if (data.points.length <= 1) {
      throw new Error('Continuation stopped at the seed point.');
    }
    if (data.branch_type?.type !== 'HeteroclinicCurve') {
      throw new Error('The continuation result is missing heteroclinic schema metadata.');
    }
    const branch: ContinuationObject = {
      type: 'continuation',
      name: answers.branchName,
      systemName: sysName,
      parameterName: `${answers.parameterName}, ${answers.param2Name}`,
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'heteroclinic_curve',
      data,
      settings,
      timestamp: new Date().toISOString(),
      params: orbitParams,
      heteroclinicEndpoints: {
        sourceObjectName: source.name,
        targetObjectName: target.name,
      },
    };
    Storage.saveBranch(sysName, orbit.name, branch);
    printSuccess(
      `Heteroclinic continuation generated ${data.points.length} points (${source.name} -> ${target.name}).`
    );
    if (options.autoInspect ?? true) await inspectBranch(sysName, branch);
    return branch;
  } catch (error) {
    printError(`Heteroclinic initialization failed: ${error}`);
    console.log(chalk.gray('Check endpoint Morse indices and improve the connecting-orbit seed.'));
    return null;
  }
}
