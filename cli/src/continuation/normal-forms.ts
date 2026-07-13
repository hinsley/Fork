import chalk from 'chalk';
import inquirer from 'inquirer';
import { printError, printSuccess } from '../format';
import type { ComputedNormalForm, NormalFormComplex, NormalFormProvenance } from '../normal-form-types';
import { Storage } from '../storage';
import type { ContinuationObject, ContinuationPoint } from '../types';
import { WasmBridge } from '../wasm';
import { runLimitCycleContinuationWithProgress } from './progress';
import { formatNumberFullPrecision, getBranchParams, isValidName } from './utils';

const branchSettings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 120,
  corrector_steps: 10,
  corrector_tolerance: 1e-8,
  step_tolerance: 1e-8,
};

function complex(value: NormalFormComplex): string {
  const sign = value.im < 0 ? '-' : '+';
  return `${formatNumberFullPrecision(value.re)} ${sign} ${formatNumberFullPrecision(Math.abs(value.im))}i`;
}

function printValue(label: string, value: unknown): void {
  if (typeof value === 'number') {
    console.log(`  ${label}: ${formatNumberFullPrecision(value)}`);
  } else if (typeof value === 'string' || typeof value === 'boolean') {
    console.log(`  ${label}: ${String(value)}`);
  } else if (
    value && typeof value === 'object' &&
    typeof (value as NormalFormComplex).re === 'number' &&
    typeof (value as NormalFormComplex).im === 'number'
  ) {
    console.log(`  ${label}: ${complex(value as NormalFormComplex)}`);
  }
}

export function printNormalForm(normalForm: ComputedNormalForm): void {
  console.log(chalk.white('\nComputed normal form:'));
  Object.entries(normalForm).forEach(([name, value]) => {
    if (name === 'conditioning' || name === 'diagnostics') return;
    if (name === 'state' || name === 'critical_mode' || name === 'gamma') return;
    printValue(name.replaceAll('_', ' '), value);
  });
  const diagnostics = 'conditioning' in normalForm
    ? normalForm.conditioning
    : normalForm.diagnostics;
  if (diagnostics) {
    console.log(chalk.white('  Conditioning and residuals:'));
    Object.entries(diagnostics).forEach(([name, value]) => {
      printValue(`  ${name.replaceAll('_', ' ')}`, value);
    });
  }
}

function branchParameterNames(branch: ContinuationObject): [string, string] {
  const branchType = branch.data.branch_type as {
    param1_name?: string;
    param2_name?: string;
  } | undefined;
  if (!branchType?.param1_name || !branchType.param2_name) {
    throw new Error('Codimension-two source curve parameter metadata is missing.');
  }
  return [branchType.param1_name, branchType.param2_name];
}

function coefficient(point: ContinuationPoint, name: string): number | undefined {
  return point.codim2?.coefficients.find((entry) => entry.name === name)?.value;
}

export function persistSourcePointNormalForm(
  sysName: string,
  branch: ContinuationObject,
  pointIndex: number,
  provenance: NormalFormProvenance
): void {
  const point = branch.data.points[pointIndex];
  if (!point) throw new Error(`Missing source point ${pointIndex}.`);
  point.normal_form = provenance;
  Storage.saveBranch(sysName, branch.parentObject, branch);
}

export function periodicBranchPointAmplitude(value: unknown): number {
  const amplitude = Number(value);
  if (!Number.isFinite(amplitude) || Math.abs(amplitude) <= 1e-10) {
    throw new Error('Predictor amplitude must be finite and nonzero.');
  }
  return amplitude;
}

export function computeAndPersistNormalForm(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): ComputedNormalForm | null {
  try {
    const sysConfig = Storage.loadSystem(sysName);
    const params = getBranchParams(sysName, branch, sysConfig);
    const bridge = new WasmBridge({ ...sysConfig, params });
    let normalForm: ComputedNormalForm;
    let provenance: NormalFormProvenance;

    if (sysConfig.type === 'map' && branch.branchType === 'equilibrium') {
      const normalFormType = point.stability === 'Fold' || point.stability === 'BranchPoint'
        ? 'BranchPoint'
        : point.stability === 'PeriodDoubling'
          ? 'PeriodDoubling'
          : point.stability === 'NeimarkSacker'
            ? 'NeimarkSacker'
            : null;
      if (!normalFormType) throw new Error('Map normal forms are available at Fold/BP, PD, or NS points.');
      normalForm = bridge.computeMapNormalForm(
        point.state,
        branch.parameterName,
        point.param_value,
        branch.mapIterations ?? 1,
        normalFormType
      );
      provenance = {
        source_kind: 'Map',
        source_branch_id: branch.name,
        source_branch_name: branch.name,
        source_point_index: pointIndex,
        parameter_names: [branch.parameterName],
        parameter_values: [point.param_value],
        map_iterations: branch.mapIterations ?? 1,
        computed_at: new Date().toISOString(),
        normal_form: normalForm,
      };
    } else if (sysConfig.type === 'flow' && branch.branchType === 'limit_cycle') {
      const metadata = branch.data.branch_type;
      if (metadata?.type !== 'LimitCycle') throw new Error('Limit-cycle collocation metadata is missing.');
      const mesh = metadata.normalized_mesh;
      if (!mesh || mesh.length !== metadata.ntst + 1) {
        throw new Error('This legacy cycle has no persistent normalized mesh; recontinue it first.');
      }
      const normalFormType = point.stability === 'PeriodDoubling'
        ? 'PeriodDoubling'
        : point.stability === 'NeimarkSacker'
          ? 'NeimarkSacker'
          : point.stability === 'BranchPoint' || point.stability === 'CycleFold'
            ? 'BranchPoint'
            : null;
      if (!normalFormType) throw new Error('Periodic normal forms are available at BP, LPC, PD, or NS points.');
      normalForm = bridge.computePeriodicNormalFormFromPackedState(
        point.state,
        branch.parameterName,
        point.param_value,
        metadata.ncol,
        mesh,
        normalFormType
      );
      provenance = {
        source_kind: 'PeriodicOrbit',
        source_branch_id: branch.name,
        source_branch_name: branch.name,
        source_point_index: pointIndex,
        parameter_names: [branch.parameterName],
        parameter_values: [point.param_value],
        normalized_mesh: [...mesh],
        computed_at: new Date().toISOString(),
        normal_form: normalForm,
      };
    } else if (
      sysConfig.type === 'flow' &&
      (point.codim2?.type === 'ZeroHopf' || point.codim2?.type === 'DoubleHopf')
    ) {
      const [param1Name, param2Name] = branchParameterNames(branch);
      const param2Value = point.param2_value;
      if (!Number.isFinite(param2Value)) throw new Error('Second source parameter is missing.');
      const sourceFrequency = point.codim2.type === 'ZeroHopf'
        ? coefficient(point, 'omega')
        : coefficient(point, 'omega1');
      if (!Number.isFinite(sourceFrequency) || (sourceFrequency ?? 0) <= 0) {
        throw new Error('Codimension-two source frequency metadata is missing.');
      }
      normalForm = point.codim2.type === 'ZeroHopf'
        ? bridge.computeZeroHopfNormalForm(
            point.state, param1Name, param2Name, point.param_value,
            param2Value as number, sourceFrequency as number
          )
        : bridge.computeHopfHopfNormalForm(
            point.state, param1Name, param2Name, point.param_value,
            param2Value as number, sourceFrequency as number
          );
      provenance = {
        source_kind: point.codim2.type === 'ZeroHopf' ? 'ZeroHopf' : 'HopfHopf',
        source_branch_id: branch.name,
        source_branch_name: branch.name,
        source_point_index: pointIndex,
        parameter_names: [param1Name, param2Name],
        parameter_values: [point.param_value, param2Value as number],
        computed_at: new Date().toISOString(),
        normal_form: normalForm,
      };
    } else {
      throw new Error('The selected point does not expose a supported normal form.');
    }

    persistSourcePointNormalForm(sysName, branch, pointIndex, provenance);
    printNormalForm(normalForm);
    printSuccess('Normal-form coefficients and provenance saved on the branch point.');
    return normalForm;
  } catch (error) {
    printError(String(error));
    return null;
  }
}

export async function initiatePeriodicBranchPointSwitch(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number
): Promise<ContinuationObject | null> {
  const metadata = branch.data.branch_type;
  if (branch.branchType !== 'limit_cycle' || metadata?.type !== 'LimitCycle') {
    printError('Select a branch point on a limit-cycle branch.');
    return null;
  }
  if (!metadata.normalized_mesh || metadata.normalized_mesh.length !== metadata.ntst + 1) {
    printError('This legacy cycle has no persistent normalized mesh; recontinue it first.');
    return null;
  }
  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Secondary branch name:', default: `${branch.name}_bp_${pointIndex}` },
    { type: 'number', name: 'amplitude', message: 'Predictor amplitude:', default: 0.05 },
    { type: 'confirm', name: 'forward', message: 'Continue forward?', default: true },
  ]);
  const nameError = isValidName(String(answers.name));
  if (nameError !== true) {
    printError(String(nameError));
    return null;
  }

  try {
    const amplitude = periodicBranchPointAmplitude(answers.amplitude);
    const sysConfig = Storage.loadSystem(sysName);
    const params = getBranchParams(sysName, branch, sysConfig);
    const paramIndex = sysConfig.paramNames.indexOf(branch.parameterName);
    if (paramIndex < 0) throw new Error(`Unknown parameter ${branch.parameterName}.`);
    params[paramIndex] = point.param_value;
    const bridge = new WasmBridge({ ...sysConfig, params });
    const switched = bridge.switchPeriodicBranchFromPackedState(
      point.state,
      branch.parameterName,
      point.param_value,
      metadata.ncol,
      metadata.normalized_mesh,
      amplitude
    );
    if (
      switched.normalForm.type !== 'BranchPoint' ||
      (switched.normalForm.kind !== 'Transcritical' && switched.normalForm.kind !== 'Pitchfork')
    ) {
      throw new Error('The +1 normal form is not a generic transcritical or pitchfork branch point.');
    }
    const data = runLimitCycleContinuationWithProgress(
      bridge,
      switched.setup,
      branch.parameterName,
      branchSettings,
      Boolean(answers.forward),
      'Periodic BP Branch'
    );
    if (data.points.length <= 1) throw new Error('Secondary continuation stopped at the corrected seed.');
    const provenance: NormalFormProvenance = {
      source_kind: 'PeriodicOrbit',
      source_branch_id: branch.name,
      source_branch_name: branch.name,
      source_point_index: pointIndex,
      parameter_names: [branch.parameterName],
      parameter_values: [point.param_value],
      normalized_mesh: [...metadata.normalized_mesh],
      computed_at: new Date().toISOString(),
      normal_form: switched.normalForm,
    };
    persistSourcePointNormalForm(sysName, branch, pointIndex, provenance);
    data.normal_form_provenance = provenance;
    const child: ContinuationObject = {
      type: 'continuation',
      name: String(answers.name),
      systemName: sysName,
      parameterName: branch.parameterName,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: 'limit_cycle',
      data,
      settings: branchSettings,
      timestamp: new Date().toISOString(),
      params,
    };
    Storage.saveBranch(sysName, branch.parentObject, child);
    printNormalForm(switched.normalForm);
    printSuccess(`Saved corrected secondary periodic branch ${child.name} (${data.points.length} points).`);
    return child;
  } catch (error) {
    printError(String(error));
    return null;
  }
}
