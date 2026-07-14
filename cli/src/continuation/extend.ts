/**
 * Branch Extension Module
 * 
 * Handles extending existing continuation branches.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import {
  ContinuationObject,
  EquilibriumManifold1DSettings,
  EquilibriumManifold2DSettings,
  LimitCycleManifold2DSettings,
  ManifoldDirection,
  ManifoldStability
} from '../types';
import { NavigationRequest } from '../navigation';
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
import { getBranchParams } from './utils';
import {
  runContinuationExtensionWithProgress,
  runEquilibriumManifold1DExtensionWithProgress,
  runManifold2DExtensionWithProgress
} from './progress';
import {
  buildCollocationAdaptivitySettings,
  collocationAdaptivityEntries,
  defaultCollocationAdaptivityInputs,
} from './collocation-adaptivity';

type ManifoldEq1DBranchMetadata = {
  type: 'ManifoldEq1D';
  stability: ManifoldStability;
  direction: ManifoldDirection;
  eig_index: number;
  map_iterations?: number;
};

export function supportsContinuationBranchExtension(
  branchType: ContinuationObject['branchType']
): boolean {
  return branchType !== 'homotopy_saddle_curve';
}

async function extendEquilibriumManifold1D(
  sysName: string,
  branch: ContinuationObject
): Promise<NavigationRequest | void> {
  const sysConfig = Storage.loadSystem(sysName);
  const defaults = branch.settings as Partial<EquilibriumManifold1DSettings>;
  const metadata = branch.data.branch_type as ManifoldEq1DBranchMetadata | undefined;
  if (!metadata || metadata.type !== 'ManifoldEq1D') {
    printError('The stored manifold is missing its numerical metadata.');
    return;
  }
  if (metadata.direction === 'Both') {
    printError('A stored manifold branch must contain one directed half-branch.');
    return;
  }

  const defaultCaps = defaults.caps;
  let targetArclengthInput = defaults.target_arclength?.toString() ?? '10';
  let integrationDtInput = defaults.integration_dt?.toString() ?? '0.01';
  let maxStepsInput = defaultCaps?.max_steps?.toString() ?? '2000';
  let maxPointsInput = defaultCaps?.max_points?.toString() ?? '20000';
  let maxTimeInput = defaultCaps?.max_time?.toString() ?? '1000';
  let maxIterationsInput = defaultCaps?.max_iterations?.toString() ?? '2000';

  const entries: ConfigEntry[] = [
    {
      id: 'targetArclength',
      label: 'Additional arclength',
      section: 'Extension Settings',
      getDisplay: () => formatUnset(targetArclengthInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Additional Arclength:',
          default: targetArclengthInput
        });
        targetArclengthInput = value;
      }
    },
    ...(sysConfig.type === 'flow'
      ? [{
          id: 'integrationDt',
          label: 'Integration dt',
          section: 'Extension Settings',
          getDisplay: () => formatUnset(integrationDtInput),
          edit: async () => {
            const { value } = await inquirer.prompt({
              name: 'value',
              message: 'Integration dt:',
              default: integrationDtInput
            });
            integrationDtInput = value;
          }
        } satisfies ConfigEntry]
      : []),
    {
      id: 'maxSteps',
      label: 'Max integration steps',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Integration Steps:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'maxPoints',
      label: 'Max points to add',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxPointsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Points to Add:',
          default: maxPointsInput
        });
        maxPointsInput = value;
      }
    },
    ...(sysConfig.type === 'map'
      ? [{
          id: 'maxIterations',
          label: 'Max map iterations',
          section: 'Resource Limits',
          getDisplay: () => formatUnset(maxIterationsInput),
          edit: async () => {
            const { value } = await inquirer.prompt({
              name: 'value',
              message: 'Max Map Iterations:',
              default: maxIterationsInput
            });
            maxIterationsInput = value;
          }
        } satisfies ConfigEntry]
      : [{
          id: 'maxTime',
          label: 'Max integration time',
          section: 'Resource Limits',
          getDisplay: () => formatUnset(maxTimeInput),
          edit: async () => {
            const { value } = await inquirer.prompt({
              name: 'value',
              message: 'Max Integration Time:',
              default: maxTimeInput
            });
            maxTimeInput = value;
          }
        } satisfies ConfigEntry])
  ];

  const result = await runConfigMenu(`Extend Manifold: ${branch.name}`, entries);
  if (result === 'back') return;

  const settings: EquilibriumManifold1DSettings = {
    stability: metadata.stability,
    direction: metadata.direction,
    eig_index: metadata.eig_index,
    eps: defaults.eps ?? 1e-3,
    target_arclength: parseFloatOrDefault(targetArclengthInput, 10),
    integration_dt:
      sysConfig.type === 'map' ? 1 : parseFloatOrDefault(integrationDtInput, 0.01),
    caps: {
      max_steps: parseIntOrDefault(maxStepsInput, 2000),
      max_points: parseIntOrDefault(maxPointsInput, 20000),
      max_rings: defaultCaps?.max_rings ?? 1,
      max_vertices: defaultCaps?.max_vertices ?? 1,
      max_time:
        sysConfig.type === 'map'
          ? defaultCaps?.max_time ?? 1000
          : parseFloatOrDefault(maxTimeInput, 1000),
      ...(sysConfig.type === 'map'
        ? { max_iterations: parseIntOrDefault(maxIterationsInput, 2000) }
        : {})
    },
    bounds: defaults.bounds
  };

  try {
    const runConfig = { ...sysConfig };
    runConfig.params = getBranchParams(sysName, branch, sysConfig);
    const bridge = new WasmBridge(runConfig);
    const mapIterations =
      sysConfig.type === 'map'
        ? branch.mapIterations ?? metadata.map_iterations ?? 1
        : 1;
    const previousPointCount = branch.data.points.length;
    const updatedData = runEquilibriumManifold1DExtensionWithProgress(
      bridge,
      serializeBranchDataForWasm(branch.data),
      settings,
      'Manifold Extension',
      mapIterations
    );
    if (updatedData.points.length <= previousPointCount) {
      throw new Error('No new points were produced. Increase the applicable limits.');
    }
    branch.data = normalizeBranchEigenvalues(updatedData);
    branch.settings = settings;
    branch.timestamp = new Date().toISOString();
    Storage.saveBranch(sysName, branch.parentObject, branch);
    printSuccess(`Manifold extension successful! Total points: ${branch.data.points.length}`);
    return await inspectBranch(sysName, branch);
  } catch (error) {
    printError(`Manifold Extension Failed: ${error}`);
    return;
  }
}

async function extendManifold2D(
  sysName: string,
  branch: ContinuationObject
): Promise<NavigationRequest | void> {
  const sysConfig = Storage.loadSystem(sysName);
  if (sysConfig.type === 'map') {
    printError('2D invariant-manifold extension is available for flows only.');
    return;
  }
  const metadata = branch.data.branch_type;
  const geometry = branch.data.manifold_geometry;
  if (
    !metadata ||
    (metadata.type !== 'ManifoldEq2D' && metadata.type !== 'ManifoldCycle2D')
  ) {
    printError('The stored 2D manifold is missing its numerical metadata.');
    return;
  }
  if (!geometry || geometry.type !== 'Surface' || !geometry.resume_state) {
    printError('This manifold predates resumable 2D state. Recompute it once before extending.');
    return;
  }
  const defaults = branch.settings as Partial<
    EquilibriumManifold2DSettings & LimitCycleManifold2DSettings
  >;
  if (
    defaults.initial_radius === undefined ||
    defaults.leaf_delta === undefined ||
    defaults.delta_min === undefined ||
    defaults.ring_points === undefined
  ) {
    printError('This manifold predates stored 2D settings. Recompute it once before extending.');
    return;
  }
  const defaultCaps = defaults.caps;
  let targetArclengthInput = defaults.target_arclength?.toString() ?? '1';
  let integrationDtInput = defaults.integration_dt?.toString() ?? '0.01';
  let maxStepsInput = defaultCaps?.max_steps?.toString() ?? '300';
  let maxRingsInput = defaultCaps?.max_rings?.toString() ?? '24';
  let maxVerticesInput = defaultCaps?.max_vertices?.toString() ?? '10000';
  let maxTimeInput = defaultCaps?.max_time?.toString() ?? '200';

  const entries: ConfigEntry[] = [
    {
      id: 'targetArclength',
      label: 'Additional arclength',
      section: 'Extension Settings',
      getDisplay: () => formatUnset(targetArclengthInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Additional Arclength:',
          default: targetArclengthInput
        });
        targetArclengthInput = value;
      }
    },
    {
      id: 'integrationDt',
      label: 'Integration dt',
      section: 'Extension Settings',
      getDisplay: () => formatUnset(integrationDtInput),
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
      label: 'Max integration/BVP steps',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxStepsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Steps:',
          default: maxStepsInput
        });
        maxStepsInput = value;
      }
    },
    {
      id: 'maxRings',
      label: 'Max rings to add',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxRingsInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Rings to Add:',
          default: maxRingsInput
        });
        maxRingsInput = value;
      }
    },
    {
      id: 'maxVertices',
      label: 'Max vertices to add',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxVerticesInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Vertices to Add:',
          default: maxVerticesInput
        });
        maxVerticesInput = value;
      }
    },
    {
      id: 'maxTime',
      label: 'Max integration time',
      section: 'Resource Limits',
      getDisplay: () => formatUnset(maxTimeInput),
      edit: async () => {
        const { value } = await inquirer.prompt({
          name: 'value',
          message: 'Max Integration Time:',
          default: maxTimeInput
        });
        maxTimeInput = value;
      }
    }
  ];

  const result = await runConfigMenu(`Extend Manifold: ${branch.name}`, entries);
  if (result === 'back') return;
  const targetArclength = parseFloatOrDefault(targetArclengthInput, 1);
  const integrationDt = parseFloatOrDefault(integrationDtInput, 0.01);
  const caps = {
    max_steps: parseIntOrDefault(maxStepsInput, 300),
    max_points: defaultCaps?.max_points ?? 8000,
    max_rings: parseIntOrDefault(maxRingsInput, 24),
    max_vertices: parseIntOrDefault(maxVerticesInput, 10000),
    max_time: parseFloatOrDefault(maxTimeInput, 200),
    ...(defaultCaps?.max_iterations !== undefined
      ? { max_iterations: defaultCaps.max_iterations }
      : {})
  };
  let settings: EquilibriumManifold2DSettings | LimitCycleManifold2DSettings;
  if (metadata.type === 'ManifoldEq2D') {
    settings = {
      ...(defaults as EquilibriumManifold2DSettings),
      stability: metadata.stability,
      eig_indices: metadata.eig_indices,
      target_arclength: targetArclength,
      integration_dt: integrationDt,
      caps
    };
  } else {
    const algorithm =
      defaults.algorithm ??
      (metadata.method === 'hko_fundamental_segment_bvp'
        ? 'IsochronFibers'
        : metadata.method === 'segmented_preimage_collocation'
          ? 'SegmentedPreimageFibers'
          : 'GeodesicRings');
    settings = {
      ...(defaults as LimitCycleManifold2DSettings),
      stability: metadata.stability,
      direction: metadata.direction ?? defaults.direction ?? 'Plus',
      algorithm,
      floquet_index: metadata.floquet_index,
      ntst: metadata.ntst,
      ncol: metadata.ncol,
      target_arclength: targetArclength,
      integration_dt: integrationDt,
      caps
    };
  }

  try {
    const runConfig = { ...sysConfig, params: getBranchParams(sysName, branch, sysConfig) };
    const bridge = new WasmBridge(runConfig);
    const previousPointCount = branch.data.points.length;
    const updatedData = runManifold2DExtensionWithProgress(
      bridge,
      serializeBranchDataForWasm(branch.data),
      settings,
      '2D Manifold Extension'
    );
    if (updatedData.points.length <= previousPointCount) {
      throw new Error('No new surface points were produced. Increase the applicable limits.');
    }
    branch.data = normalizeBranchEigenvalues(updatedData);
    branch.settings = settings;
    branch.timestamp = new Date().toISOString();
    Storage.saveBranch(sysName, branch.parentObject, branch);
    printSuccess(`Manifold extension successful! Total points: ${branch.data.points.length}`);
    return await inspectBranch(sysName, branch);
  } catch (error) {
    printError(`Manifold Extension Failed: ${error}`);
    return;
  }
}

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
export async function extendBranch(
  sysName: string,
  branch: ContinuationObject
): Promise<NavigationRequest | void> {
  if (branch.branchType === 'eq_manifold_1d') {
    return extendEquilibriumManifold1D(sysName, branch);
  }
  if (branch.branchType === 'eq_manifold_2d' || branch.branchType === 'cycle_manifold_2d') {
    return extendManifold2D(sysName, branch);
  }
  if (!supportsContinuationBranchExtension(branch.branchType)) {
    printError(
      'Homotopy-saddle branches use staged continuation and cannot be extended with the generic branch action.'
    );
    return;
  }
  const sysConfig = Storage.loadSystem(sysName);
  const defaults = branch.settings || {};

  // State for config menu
  let directionForward = true;
  let maxStepsInput = '300';
  let stepSizeInput = defaults.step_size?.toString() || '0.01';
  const supportsAdaptiveCollocation = [
    'limit_cycle',
    'lpc_curve',
    'isoperiodic_curve',
    'pd_curve',
    'ns_curve',
  ].includes(branch.branchType);
  const adaptivityInputs = defaultCollocationAdaptivityInputs();
  const storedAdaptivity = defaults.collocation_adaptivity;
  if (storedAdaptivity && typeof storedAdaptivity === 'object') {
    adaptivityInputs.enabled = storedAdaptivity.enabled ?? adaptivityInputs.enabled;
    adaptivityInputs.redistributionEnabled =
      storedAdaptivity.redistribution_enabled ?? adaptivityInputs.redistributionEnabled;
    adaptivityInputs.defectTolerance =
      storedAdaptivity.defect_tolerance?.toString() ?? adaptivityInputs.defectTolerance;
    adaptivityInputs.maxRefinements =
      storedAdaptivity.max_refinements?.toString() ?? adaptivityInputs.maxRefinements;
    adaptivityInputs.maxMeshPoints =
      storedAdaptivity.max_mesh_points?.toString() ?? adaptivityInputs.maxMeshPoints;
  }

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

  if (supportsAdaptiveCollocation) {
    entries.push(...collocationAdaptivityEntries(adaptivityInputs));
  }

  const result = await runConfigMenu(`Extend Branch: ${branch.name}`, entries);
  if (result === 'back') {
    return;
  }

  const continuationSettings = {
    step_size: parseFloatOrDefault(stepSizeInput, 0.01),
    min_step_size: defaults.min_step_size || 1e-5,
    max_step_size: defaults.max_step_size || 0.1,
    max_steps: parseIntOrDefault(maxStepsInput, 300),
    corrector_steps:
      branch.branchType === 'homoclinic_curve' ? 32 : defaults.corrector_steps || 4,
    corrector_tolerance: defaults.corrector_tolerance || 1e-6,
    step_tolerance: defaults.step_tolerance || 1e-6,
    ...(supportsAdaptiveCollocation
      ? { collocation_adaptivity: buildCollocationAdaptivitySettings(adaptivityInputs) }
      : {}),
  };

  console.log(chalk.cyan(`Extending branch ${directionForward ? 'forward' : 'backward'} (max ${continuationSettings.max_steps} points)...`));
  try {
    const runConfig = { ...sysConfig };
    runConfig.params = getBranchParams(sysName, branch, sysConfig);
    const bridge = new WasmBridge(runConfig);
    const mapIterations = sysConfig.type === 'map' ? branch.mapIterations ?? 1 : 1;

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
      let normalizedMesh: number[] | undefined;
      const branchTypeData = branch.data.branch_type as any;

      // Handle stored format: {"LimitCycle":{"ntst":20,"ncol":4}}
      if (branchTypeData?.LimitCycle) {
        ntst = branchTypeData.LimitCycle.ntst ?? 20;
        ncol = branchTypeData.LimitCycle.ncol ?? 4;
        normalizedMesh = branchTypeData.LimitCycle.normalized_mesh;
      }
      // Handle serde tagged format: {"type":"LimitCycle","ntst":20,"ncol":4}
      else if (branchTypeData?.type === 'LimitCycle') {
        ntst = branchTypeData.ntst ?? 20;
        ncol = branchTypeData.ncol ?? 4;
        normalizedMesh = branchTypeData.normalized_mesh;
      }

      // Set in serde tagged enum format (Rust expects this)
      branchDataToPass.branch_type = {
        type: 'LimitCycle',
        ntst,
        ncol,
        normalized_mesh: normalizedMesh
      };
    }

    const branchTypeMeta = branch.data.branch_type as
      | { param1_name?: string }
      | undefined;
    const extensionParameterName =
      typeof branchTypeMeta?.param1_name === 'string'
        ? branchTypeMeta.param1_name
        : branch.parameterName;

    const updatedData = runContinuationExtensionWithProgress(
      bridge,
      branchDataToPass,
      extensionParameterName,
      mapIterations,
      continuationSettings,
      directionForward,
      'Extension'
    );

    branch.data = normalizeBranchEigenvalues(updatedData);
    branch.settings = continuationSettings;

    Storage.saveBranch(sysName, branch.parentObject, branch);
    printSuccess(`Extension successful! Total points: ${branch.data.points.length}`);

    return await inspectBranch(sysName, branch);

  } catch (e) {
    printError(`Extension Failed: ${e}`);
    return;
  }
}
