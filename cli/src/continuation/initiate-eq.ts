/**
 * Equilibrium Branch Initiation Module
 * 
 * Handles initiating new equilibrium branches from points on existing branches.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import {
  ContinuationBranchData,
  ContinuationObject,
  ContinuationPoint,
  EquilibriumManifold1DSettings,
  EquilibriumManifold2DSettings,
  EquilibriumObject,
  ManifoldDirection,
  ManifoldTerminationCaps
} from '../types';
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
import {
  runEquilibriumContinuationWithProgress,
  runEquilibriumManifold1DWithProgress,
  runEquilibriumManifold2DWithProgress
} from './progress';
import { formatEquilibriumLabel } from '../labels';

const DEFAULT_MANIFOLD_CAPS: ManifoldTerminationCaps = {
  max_steps: 2000,
  max_points: 2000,
  max_rings: 256,
  max_vertices: 20000,
  max_time: 100
};

function parseOptionalIndex(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseOptionalPair(input: string): [number, number] | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const parts = trimmed.split(',').map(part => parseInt(part.trim(), 10));
  if (parts.length !== 2 || parts.some(value => !Number.isFinite(value) || value < 0)) {
    return undefined;
  }
  return [parts[0], parts[1]];
}

function manifold1DBranchName(baseName: string, direction: ManifoldDirection, requestDirection: ManifoldDirection): string {
  if (requestDirection === 'Both') {
    return `${baseName}_${direction.toLowerCase()}`;
  }
  return baseName;
}

function manifoldDirectionFromBranchData(branchData: ContinuationBranchData): ManifoldDirection | undefined {
  const branchType = branchData.branch_type as any;
  if (branchType?.type === 'ManifoldEq1D' && typeof branchType.direction === 'string') {
    if (branchType.direction === 'Plus' || branchType.direction === 'Minus' || branchType.direction === 'Both') {
      return branchType.direction;
    }
  }
  const geometry = branchData.manifold_geometry as any;
  if (geometry?.type === 'Curve' && typeof geometry.direction === 'string') {
    if (geometry.direction === 'Plus' || geometry.direction === 'Minus' || geometry.direction === 'Both') {
      return geometry.direction;
    }
  }
  return undefined;
}

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

export async function initiateEquilibriumManifold1DFromPoint(
  sysName: string,
  sourceBranch: ContinuationObject,
  point: ContinuationPoint,
  pointIdx: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const parentObject = sourceBranch.parentObject;

  if (sysConfig.type !== 'flow') {
    printError('Equilibrium manifold continuation is only available for flow systems.');
    return null;
  }

  let branchName = `eqm1d_${sourceBranch.name}_idx${pointIdx}`;
  let stability: 'Stable' | 'Unstable' = 'Unstable';
  let direction: ManifoldDirection = 'Both';
  let eigIndexInput = '';
  let epsInput = '1e-4';
  let targetArclengthInput = '10';
  let integrationDtInput = '1e-2';
  let maxStepsInput = DEFAULT_MANIFOLD_CAPS.max_steps.toString();
  let maxPointsInput = DEFAULT_MANIFOLD_CAPS.max_points.toString();
  let maxRingsInput = DEFAULT_MANIFOLD_CAPS.max_rings.toString();
  let maxVerticesInput = DEFAULT_MANIFOLD_CAPS.max_vertices.toString();
  let maxTimeInput = DEFAULT_MANIFOLD_CAPS.max_time.toString();
  const eligibleRealEigenIndices = (): number[] => {
    const eigenvalues = point.eigenvalues ?? [];
    return eigenvalues
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => Math.abs(value.im ?? 0) <= 1e-8)
      .filter(({ value }) =>
        stability === 'Unstable' ? (value.re ?? 0) > 1e-9 : (value.re ?? 0) < -1e-9
      )
      .map(({ index }) => index);
  };

  const entries: ConfigEntry[] = [
    {
      id: 'branchName',
      label: 'Branch name',
      section: 'Branch Settings',
      getDisplay: () => formatUnset(branchName),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for this 1D manifold branch:',
          default: branchName,
        });
        branchName = value;
      }
    },
    {
      id: 'stability',
      label: 'Manifold stability',
      section: 'Manifold Selection',
      getDisplay: () => stability,
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select manifold stability:',
          choices: [
            { name: 'Unstable', value: 'Unstable' },
            { name: 'Stable', value: 'Stable' }
          ],
          default: stability
        });
        stability = value;
      }
    },
    {
      id: 'direction',
      label: 'Stage 1 direction',
      section: 'Manifold Selection',
      getDisplay: () => direction,
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select stage 1 direction mode:',
          choices: [
            { name: 'Both (plus and minus)', value: 'Both' },
            { name: 'Plus', value: 'Plus' },
            { name: 'Minus', value: 'Minus' }
          ],
          default: direction
        });
        direction = value;
      }
    },
    {
      id: 'eigIndex',
      label: 'Eigen index (optional)',
      section: 'Manifold Selection',
      getDisplay: () => {
        const parsed = parseOptionalIndex(eigIndexInput);
        if (parsed === undefined) {
          return formatUnset(eigIndexInput);
        }
        return (parsed + 1).toString();
      },
      edit: async () => {
        const eligible = eligibleRealEigenIndices();
        const choices = [
          { name: 'Auto', value: '' },
          ...eligible.map((index) => ({
            name: `${index + 1}`,
            value: index.toString(),
          })),
        ];
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Eigen index (eligible for selected stability):',
          choices,
          default: eigIndexInput.trim().length > 0 ? eigIndexInput : '',
        });
        eigIndexInput = value;
      }
    },
    {
      id: 'eps',
      label: 'Seed epsilon',
      section: 'Numerics',
      getDisplay: () => epsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Seed epsilon:',
          default: epsInput
        });
        epsInput = value;
      }
    },
    {
      id: 'targetArclength',
      label: 'Target arclength',
      section: 'Numerics',
      getDisplay: () => targetArclengthInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target arclength:',
          default: targetArclengthInput
        });
        targetArclengthInput = value;
      }
    },
    {
      id: 'integrationDt',
      label: 'Integration dt',
      section: 'Numerics',
      getDisplay: () => integrationDtInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Integration dt:',
          default: integrationDtInput
        });
        integrationDtInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Caps: max steps',
      section: 'Termination Caps',
      getDisplay: () => maxStepsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum solver steps:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'maxPoints',
      label: 'Caps: max points',
      section: 'Termination Caps',
      getDisplay: () => maxPointsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum points:',
          default: maxPointsInput
        });
        maxPointsInput = value;
      }
    },
    {
      id: 'maxRings',
      label: 'Caps: max rings',
      section: 'Termination Caps',
      getDisplay: () => maxRingsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum rings:',
          default: maxRingsInput
        });
        maxRingsInput = value;
      }
    },
    {
      id: 'maxVertices',
      label: 'Caps: max vertices',
      section: 'Termination Caps',
      getDisplay: () => maxVerticesInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum vertices:',
          default: maxVerticesInput
        });
        maxVerticesInput = value;
      }
    },
    {
      id: 'maxTime',
      label: 'Caps: max time',
      section: 'Termination Caps',
      getDisplay: () => maxTimeInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum integration time:',
          default: maxTimeInput
        });
        maxTimeInput = value;
      }
    }
  ];

  while (true) {
    const result = await runConfigMenu('Compute 1D Equilibrium Manifold', entries);
    if (result === 'back') {
      return null;
    }

    if (!branchName) {
      printError('Please provide a branch name.');
      continue;
    }
    const validName = isValidName(branchName);
    if (validName !== true) {
      printError(typeof validName === 'string' ? validName : 'Invalid branch name.');
      continue;
    }

    const eigIndex = parseOptionalIndex(eigIndexInput);
    if (eigIndexInput.trim().length > 0 && eigIndex === undefined) {
      printError('Eigen index must be a non-negative integer.');
      continue;
    }
    const eligible = eligibleRealEigenIndices();
    if (eligible.length === 0) {
      printError(`No eligible real ${stability.toLowerCase()} eigenmodes at this point.`);
      continue;
    }
    if (eigIndex !== undefined && !eligible.includes(eigIndex)) {
      const allowed = eligible.map((index) => (index + 1).toString()).join(', ');
      printError(`Eigen index must match eligible ${stability.toLowerCase()} modes: ${allowed}.`);
      continue;
    }
    const targetArclength = parseFloatOrDefault(targetArclengthInput, 10.0);
    if (!Number.isFinite(targetArclength) || targetArclength <= 0) {
      printError('Target arclength must be a positive number.');
      continue;
    }

    const directions: ManifoldDirection[] =
      direction === 'Both' ? ['Plus', 'Minus'] : [direction];
    const existing = new Set(Storage.listBranches(sysName, parentObject));
    const names = directions.map(dir => manifold1DBranchName(branchName, dir, direction));
    const duplicate = names.find(name => existing.has(name));
    if (duplicate) {
      printError(`Branch "${duplicate}" already exists.`);
      continue;
    }

    const settings: EquilibriumManifold1DSettings = {
      stability,
      direction,
      eig_index: eigIndex ?? eligible[0],
      eps: Math.max(parseFloatOrDefault(epsInput, 1e-4), Number.EPSILON),
      target_arclength: Math.max(targetArclength, Number.EPSILON),
      integration_dt: Math.max(parseFloatOrDefault(integrationDtInput, 1e-2), Number.EPSILON),
      caps: {
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, DEFAULT_MANIFOLD_CAPS.max_steps), 1),
        max_points: Math.max(parseIntOrDefault(maxPointsInput, DEFAULT_MANIFOLD_CAPS.max_points), 2),
        max_rings: Math.max(parseIntOrDefault(maxRingsInput, DEFAULT_MANIFOLD_CAPS.max_rings), 1),
        max_vertices: Math.max(parseIntOrDefault(maxVerticesInput, DEFAULT_MANIFOLD_CAPS.max_vertices), 3),
        max_time: Math.max(parseFloatOrDefault(maxTimeInput, DEFAULT_MANIFOLD_CAPS.max_time), Number.EPSILON)
      }
    };

    try {
      const runConfig = { ...sysConfig };
      runConfig.params = getBranchParams(sysName, sourceBranch, sysConfig);
      const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
      if (sourceParamIdx >= 0) {
        runConfig.params[sourceParamIdx] = point.param_value;
      }

      printInfo('Computing 1D equilibrium manifold...');
      const bridge = new WasmBridge(runConfig);
      const manifoldBranchesRaw = runEquilibriumManifold1DWithProgress(
        bridge,
        point.state,
        settings,
        'Eq Manifold 1D'
      );

      if (!Array.isArray(manifoldBranchesRaw) || manifoldBranchesRaw.length === 0) {
        printError('Manifold continuation returned no branches.');
        return null;
      }

      const branches = manifoldBranchesRaw.map(branch => normalizeBranchEigenvalues(branch));
      const branchByDirection = new Map<ManifoldDirection, ContinuationBranchData>();
      const unsorted: ContinuationBranchData[] = [];
      for (const branchData of branches) {
        const dir = manifoldDirectionFromBranchData(branchData);
        if (dir === 'Plus' || dir === 'Minus') {
          branchByDirection.set(dir, branchData);
        } else {
          unsorted.push(branchData);
        }
      }

      const requestedDirections: ManifoldDirection[] =
        direction === 'Both' ? ['Plus', 'Minus'] : [direction];

      const savedBranches: ContinuationObject[] = [];
      const existingNames = new Set(Storage.listBranches(sysName, parentObject));
      for (let i = 0; i < requestedDirections.length; i++) {
        const requestedDirection = requestedDirections[i];
        const branchData =
          branchByDirection.get(requestedDirection) ??
          unsorted[i] ??
          branches[i];
        if (!branchData) continue;

        const resolvedDirection =
          manifoldDirectionFromBranchData(branchData) ??
          requestedDirection;
        const resolvedName = manifold1DBranchName(branchName, resolvedDirection, direction);
        if (existingNames.has(resolvedName)) {
          printError(`Branch "${resolvedName}" already exists.`);
          return null;
        }

        branchData.branch_type = branchData.branch_type ?? {
          type: 'ManifoldEq1D',
          stability: settings.stability,
          direction: resolvedDirection,
          eig_index: settings.eig_index ?? 0,
          method: 'shooting_bvp',
          caps: settings.caps
        };

        const branchSettings: EquilibriumManifold1DSettings = {
          ...settings,
          direction: resolvedDirection
        };

        const continuation: ContinuationObject = {
          type: 'continuation',
          name: resolvedName,
          systemName: sysName,
          parameterName: sourceBranch.parameterName,
          parentObject,
          startObject: sourceBranch.name,
          branchType: 'eq_manifold_1d',
          data: branchData,
          settings: branchSettings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params]
        };
        Storage.saveBranch(sysName, parentObject, continuation);
        existingNames.add(resolvedName);
        savedBranches.push(continuation);
      }

      if (savedBranches.length === 0) {
        printError('Manifold continuation returned no savable branches.');
        return null;
      }

      if (savedBranches.length === 1) {
        printSuccess(`1D equilibrium manifold saved as "${savedBranches[0].name}".`);
      } else {
        printSuccess(`1D equilibrium manifold saved as ${savedBranches.map(branch => `"${branch.name}"`).join(', ')}.`);
      }
      return savedBranches[0];
    } catch (e) {
      printError(`1D equilibrium manifold failed: ${e}`);
      return null;
    }
  }
}

export async function initiateEquilibriumManifold2DFromPoint(
  sysName: string,
  sourceBranch: ContinuationObject,
  point: ContinuationPoint,
  pointIdx: number
): Promise<ContinuationObject | null> {
  const sysConfig = Storage.loadSystem(sysName);
  const parentObject = sourceBranch.parentObject;

  if (sysConfig.type !== 'flow') {
    printError('Equilibrium manifold continuation is only available for flow systems.');
    return null;
  }
  if (sysConfig.equations.length < 3) {
    printError('2D equilibrium manifolds require at least 3 state dimensions.');
    return null;
  }

  let branchName = `eqm2d_${sourceBranch.name}_idx${pointIdx}`;
  let stability: 'Stable' | 'Unstable' = 'Stable';
  let profile: 'LocalPreview' | 'LorenzGlobalKo' = 'LorenzGlobalKo';
  let eigIndicesInput = '';
  let initialRadiusInput = '1.0';
  let leafDeltaInput = '1.0';
  let deltaMinInput = '0.01';
  let ringPointsInput = '20';
  let minSpacingInput = '0.25';
  let maxSpacingInput = '2.0';
  let alphaMinInput = '0.3';
  let alphaMaxInput = '0.4';
  let deltaAlphaMinInput = '0.1';
  let deltaAlphaMaxInput = '1.0';
  let integrationDtInput = '1e-3';
  let targetRadiusInput = '40';
  let targetArclengthInput = '100';
  let maxStepsInput = '2000';
  let maxPointsInput = '8000';
  let maxRingsInput = '200';
  let maxVerticesInput = '200000';
  let maxTimeInput = '200';

  const applyProfileDefaults = (nextProfile: 'LocalPreview' | 'LorenzGlobalKo') => {
    profile = nextProfile;
    if (nextProfile === 'LocalPreview') {
      initialRadiusInput = '1e-3';
      leafDeltaInput = '0.002';
      deltaMinInput = '0.001';
      ringPointsInput = '48';
      minSpacingInput = '0.00134';
      maxSpacingInput = '0.004';
      alphaMinInput = '0.3';
      alphaMaxInput = '0.4';
      deltaAlphaMinInput = '0.1';
      deltaAlphaMaxInput = '1.0';
      integrationDtInput = '1e-2';
      targetRadiusInput = '5';
      targetArclengthInput = '10';
      maxStepsInput = '300';
      maxPointsInput = '8000';
      maxRingsInput = '240';
      maxVerticesInput = '50000';
      maxTimeInput = '200';
      return;
    }
    initialRadiusInput = '1.0';
    leafDeltaInput = '1.0';
    deltaMinInput = '0.01';
    ringPointsInput = '20';
    minSpacingInput = '0.25';
    maxSpacingInput = '2.0';
    alphaMinInput = '0.3';
    alphaMaxInput = '0.4';
    deltaAlphaMinInput = '0.1';
    deltaAlphaMaxInput = '1.0';
    integrationDtInput = '1e-3';
    targetRadiusInput = '40';
    targetArclengthInput = '100';
    maxStepsInput = '2000';
    maxPointsInput = '8000';
    maxRingsInput = '200';
    maxVerticesInput = '200000';
    maxTimeInput = '200';
  };

  const entries: ConfigEntry[] = [
    {
      id: 'branchName',
      label: 'Branch name',
      section: 'Branch Settings',
      getDisplay: () => formatUnset(branchName),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Name for this 2D manifold branch:',
          default: branchName
        });
        branchName = value;
      }
    },
    {
      id: 'stability',
      label: 'Manifold stability',
      section: 'Manifold Selection',
      getDisplay: () => stability,
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Select manifold stability:',
          choices: [
            { name: 'Unstable', value: 'Unstable' },
            { name: 'Stable', value: 'Stable' }
          ],
          default: stability
        });
        stability = value;
      }
    },
    {
      id: 'eigIndices',
      label: 'Eigen indices (optional)',
      section: 'Manifold Selection',
      getDisplay: () => formatUnset(eigIndicesInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Eigen indices (i,j) or blank for auto:',
          default: eigIndicesInput
        });
        eigIndicesInput = value;
      }
    },
    {
      id: 'profile',
      label: 'Profile',
      section: 'Numerics',
      getDisplay: () => profile === 'LorenzGlobalKo' ? 'Lorenz (global K-O)' : 'Local preview',
      edit: async () => {
        const { value } = await inquirer.prompt({
          type: 'rawlist',
          name: 'value',
          message: 'Choose numeric profile:',
          choices: [
            { name: 'Lorenz (global K-O)', value: 'LorenzGlobalKo' },
            { name: 'Local preview', value: 'LocalPreview' }
          ],
          default: profile
        });
        applyProfileDefaults(value);
      }
    },
    {
      id: 'initialRadius',
      label: 'Initial radius',
      section: 'Numerics',
      getDisplay: () => initialRadiusInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Initial radius:',
          default: initialRadiusInput
        });
        initialRadiusInput = value;
      }
    },
    {
      id: 'leafDelta',
      label: 'Leaf delta',
      section: 'Numerics',
      getDisplay: () => leafDeltaInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Leaf delta:',
          default: leafDeltaInput
        });
        leafDeltaInput = value;
      }
    },
    {
      id: 'deltaMin',
      label: 'Delta min',
      section: 'Numerics',
      getDisplay: () => deltaMinInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Minimum leaf delta (delta_min):',
          default: deltaMinInput
        });
        deltaMinInput = value;
      }
    },
    {
      id: 'ringPoints',
      label: 'Ring points',
      section: 'Numerics',
      getDisplay: () => ringPointsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Ring points (minimum 8):',
          default: ringPointsInput
        });
        ringPointsInput = value;
      }
    },
    {
      id: 'minSpacing',
      label: 'Min spacing',
      section: 'Numerics',
      getDisplay: () => minSpacingInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Minimum edge spacing (δF):',
          default: minSpacingInput
        });
        minSpacingInput = value;
      }
    },
    {
      id: 'maxSpacing',
      label: 'Max spacing',
      section: 'Numerics',
      getDisplay: () => maxSpacingInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum edge spacing (ΔF):',
          default: maxSpacingInput
        });
        maxSpacingInput = value;
      }
    },
    {
      id: 'alphaMin',
      label: 'Alpha min',
      section: 'Numerics',
      getDisplay: () => alphaMinInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Alpha min:',
          default: alphaMinInput
        });
        alphaMinInput = value;
      }
    },
    {
      id: 'alphaMax',
      label: 'Alpha max',
      section: 'Numerics',
      getDisplay: () => alphaMaxInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Alpha max:',
          default: alphaMaxInput
        });
        alphaMaxInput = value;
      }
    },
    {
      id: 'deltaAlphaMin',
      label: 'Delta-alpha min',
      section: 'Numerics',
      getDisplay: () => deltaAlphaMinInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Delta-alpha min:',
          default: deltaAlphaMinInput
        });
        deltaAlphaMinInput = value;
      }
    },
    {
      id: 'deltaAlphaMax',
      label: 'Delta-alpha max',
      section: 'Numerics',
      getDisplay: () => deltaAlphaMaxInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Delta-alpha max:',
          default: deltaAlphaMaxInput
        });
        deltaAlphaMaxInput = value;
      }
    },
    {
      id: 'integrationDt',
      label: 'Integration dt',
      section: 'Numerics',
      getDisplay: () => integrationDtInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Integration dt:',
          default: integrationDtInput
        });
        integrationDtInput = value;
      }
    },
    {
      id: 'targetRadius',
      label: 'Target radius',
      section: 'Numerics',
      getDisplay: () => targetRadiusInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target radius:',
          default: targetRadiusInput
        });
        targetRadiusInput = value;
      }
    },
    {
      id: 'targetArclength',
      label: 'Target arclength',
      section: 'Numerics',
      getDisplay: () => targetArclengthInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Target arclength:',
          default: targetArclengthInput
        });
        targetArclengthInput = value;
      }
    },
    {
      id: 'maxSteps',
      label: 'Caps: max steps',
      section: 'Termination Caps',
      getDisplay: () => maxStepsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum solver steps:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'maxPoints',
      label: 'Caps: max points',
      section: 'Termination Caps',
      getDisplay: () => maxPointsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum points:',
          default: maxPointsInput
        });
        maxPointsInput = value;
      }
    },
    {
      id: 'maxRings',
      label: 'Caps: max rings',
      section: 'Termination Caps',
      getDisplay: () => maxRingsInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum rings:',
          default: maxRingsInput
        });
        maxRingsInput = value;
      }
    },
    {
      id: 'maxVertices',
      label: 'Caps: max vertices',
      section: 'Termination Caps',
      getDisplay: () => maxVerticesInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum vertices:',
          default: maxVerticesInput
        });
        maxVerticesInput = value;
      }
    },
    {
      id: 'maxTime',
      label: 'Caps: max time',
      section: 'Termination Caps',
      getDisplay: () => maxTimeInput,
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Maximum integration time:',
          default: maxTimeInput
        });
        maxTimeInput = value;
      }
    }
  ];

  while (true) {
    const result = await runConfigMenu('Compute 2D Equilibrium Manifold', entries);
    if (result === 'back') {
      return null;
    }

    if (!branchName) {
      printError('Please provide a branch name.');
      continue;
    }
    const validName = isValidName(branchName);
    if (validName !== true) {
      printError(typeof validName === 'string' ? validName : 'Invalid branch name.');
      continue;
    }
    if (Storage.listBranches(sysName, parentObject).includes(branchName)) {
      printError(`Branch "${branchName}" already exists.`);
      continue;
    }

    const eigIndices = parseOptionalPair(eigIndicesInput);
    if (eigIndicesInput.trim().length > 0 && !eigIndices) {
      printError('Eigen indices must be entered as "i,j" using non-negative integers.');
      continue;
    }

    const ringPoints = parseIntOrDefault(ringPointsInput, 20);
    if (!Number.isFinite(ringPoints) || ringPoints < 8) {
      printError('Ring points must be an integer greater than or equal to 8.');
      continue;
    }

    const initialRadius = parseFloatOrDefault(initialRadiusInput, 1.0);
    const leafDelta = parseFloatOrDefault(leafDeltaInput, 1.0);
    const deltaMin = parseFloatOrDefault(deltaMinInput, 0.01);
    const minSpacing = parseFloatOrDefault(minSpacingInput, 0.25);
    const maxSpacing = parseFloatOrDefault(maxSpacingInput, 2.0);
    const alphaMin = parseFloatOrDefault(alphaMinInput, 0.3);
    const alphaMax = parseFloatOrDefault(alphaMaxInput, 0.4);
    const deltaAlphaMin = parseFloatOrDefault(deltaAlphaMinInput, 0.1);
    const deltaAlphaMax = parseFloatOrDefault(deltaAlphaMaxInput, 1.0);
    const targetRadius = parseFloatOrDefault(targetRadiusInput, 40.0);
    if (!Number.isFinite(initialRadius) || initialRadius <= 0) {
      printError('Initial radius must be a positive number.');
      continue;
    }
    if (!Number.isFinite(leafDelta) || leafDelta <= 0) {
      printError('Leaf delta must be a positive number.');
      continue;
    }
    if (!Number.isFinite(deltaMin) || deltaMin <= 0 || deltaMin > leafDelta) {
      printError('Delta min must be positive and no greater than leaf delta.');
      continue;
    }
    if (!Number.isFinite(minSpacing) || minSpacing <= 0) {
      printError('Min spacing must be a positive number.');
      continue;
    }
    if (!Number.isFinite(maxSpacing) || maxSpacing <= minSpacing) {
      printError('Max spacing must be greater than min spacing.');
      continue;
    }
    if (!Number.isFinite(alphaMin) || alphaMin <= 0) {
      printError('Alpha min must be a positive number.');
      continue;
    }
    if (!Number.isFinite(alphaMax) || alphaMax <= alphaMin) {
      printError('Alpha max must be greater than alpha min.');
      continue;
    }
    if (!Number.isFinite(deltaAlphaMin) || deltaAlphaMin <= 0) {
      printError('Delta-alpha min must be a positive number.');
      continue;
    }
    if (!Number.isFinite(deltaAlphaMax) || deltaAlphaMax <= deltaAlphaMin) {
      printError('Delta-alpha max must be greater than delta-alpha min.');
      continue;
    }
    if (!Number.isFinite(targetRadius) || targetRadius <= 0) {
      printError('Target radius must be a positive number.');
      continue;
    }

    const settings: EquilibriumManifold2DSettings = {
      stability,
      profile,
      eig_indices: eigIndices,
      initial_radius: Math.max(initialRadius, Number.EPSILON),
      leaf_delta: Math.max(leafDelta, Number.EPSILON),
      delta_min: Math.max(deltaMin, Number.EPSILON),
      ring_points: Math.max(ringPoints, 8),
      min_spacing: Math.max(minSpacing, Number.EPSILON),
      max_spacing: Math.max(maxSpacing, Number.EPSILON),
      alpha_min: Math.max(alphaMin, Number.EPSILON),
      alpha_max: Math.max(alphaMax, Number.EPSILON),
      delta_alpha_min: Math.max(deltaAlphaMin, Number.EPSILON),
      delta_alpha_max: Math.max(deltaAlphaMax, Number.EPSILON),
      integration_dt: Math.max(parseFloatOrDefault(integrationDtInput, 1e-3), Number.EPSILON),
      target_radius: Math.max(targetRadius, Number.EPSILON),
      target_arclength: Math.max(parseFloatOrDefault(targetArclengthInput, 100.0), Number.EPSILON),
      caps: {
        max_steps: Math.max(parseIntOrDefault(maxStepsInput, DEFAULT_MANIFOLD_CAPS.max_steps), 1),
        max_points: Math.max(parseIntOrDefault(maxPointsInput, DEFAULT_MANIFOLD_CAPS.max_points), 2),
        max_rings: Math.max(parseIntOrDefault(maxRingsInput, DEFAULT_MANIFOLD_CAPS.max_rings), 1),
        max_vertices: Math.max(parseIntOrDefault(maxVerticesInput, DEFAULT_MANIFOLD_CAPS.max_vertices), 3),
        max_time: Math.max(parseFloatOrDefault(maxTimeInput, DEFAULT_MANIFOLD_CAPS.max_time), Number.EPSILON)
      }
    };

    try {
      const runConfig = { ...sysConfig };
      runConfig.params = getBranchParams(sysName, sourceBranch, sysConfig);
      const sourceParamIdx = sysConfig.paramNames.indexOf(sourceBranch.parameterName);
      if (sourceParamIdx >= 0) {
        runConfig.params[sourceParamIdx] = point.param_value;
      }

      printInfo('Computing 2D equilibrium manifold...');
      const bridge = new WasmBridge(runConfig);
      const branchData = normalizeBranchEigenvalues(
        runEquilibriumManifold2DWithProgress(
          bridge,
          point.state,
          settings,
          'Eq Manifold 2D'
        )
      );

      branchData.branch_type = branchData.branch_type ?? {
        type: 'ManifoldEq2D',
        stability: settings.stability,
        eig_kind: 'RealPair',
        eig_indices: settings.eig_indices ?? [0, 1],
        method: 'leaf_shooting_bvp',
        caps: settings.caps
      };

      const continuation: ContinuationObject = {
        type: 'continuation',
        name: branchName,
        systemName: sysName,
        parameterName: sourceBranch.parameterName,
        parentObject,
        startObject: sourceBranch.name,
        branchType: 'eq_manifold_2d',
        data: branchData,
        settings,
        timestamp: new Date().toISOString(),
        params: [...runConfig.params]
      };

      Storage.saveBranch(sysName, parentObject, continuation);
      printSuccess(`2D equilibrium manifold saved as "${continuation.name}".`);
      return continuation;
    } catch (e) {
      printError(`2D equilibrium manifold failed: ${e}`);
      return null;
    }
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
    const bridge = new WasmBridge({
      ...sysConfig,
      params: [...runConfig.params],
    });
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
