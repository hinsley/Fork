import inquirer from 'inquirer';
import { printError, printInfo, printSuccess } from '../format';
import type { NormalFormProvenance } from '../normal-form-types';
import { Storage } from '../storage';
import type { ContinuationObject, ContinuationPoint } from '../types';
import { WasmBridge } from '../wasm';
import {
  runFoldCurveWithProgress,
  runHomoclinicContinuationWithProgress,
  runHopfCurveWithProgress,
  runLPCCurveWithProgress,
  runNSCurveWithProgress,
} from './progress';
import { getBranchParams } from './utils';

export type Codim2SwitchTarget =
  | 'Fold'
  | 'Hopf'
  | 'LimitPointCycle'
  | 'NeimarkSacker'
  | 'Homoclinic';

const settings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 300,
  corrector_steps: 10,
  corrector_tolerance: 1e-8,
  step_tolerance: 1e-8,
};

function uniformMesh(ntst: number): number[] {
  return Array.from({ length: ntst + 1 }, (_, index) => index / ntst);
}

function curveBranchData(
  curve: any,
  target: Codim2SwitchTarget,
  param1Name: string,
  param2Name: string,
  ntst: number,
  ncol: number
) {
  const outputNtst = curve.ntst ?? ntst;
  const outputNcol = curve.ncol ?? ncol;
  const normalizedMesh = curve.normalized_mesh ?? uniformMesh(outputNtst);
  return {
    points: (curve.points ?? []).map((entry: any) => ({
      state: entry.state ?? [],
      param_value: entry.param1_value,
      param2_value: entry.param2_value,
      stability: entry.codim2_type ?? 'None',
      eigenvalues: entry.eigenvalues ?? [],
      auxiliary: entry.auxiliary,
      codim2: entry.codim2,
      codim2_events: entry.codim2_events,
    })),
    bifurcations: (curve.codim2_bifurcations ?? []).map((entry: any) => entry.index),
    indices: curve.indices ?? (curve.points ?? []).map((_: unknown, index: number) => index),
    branch_type: {
      type: target === 'Fold'
        ? 'FoldCurve'
        : target === 'Hopf'
          ? 'HopfCurve'
          : target === 'NeimarkSacker'
            ? 'NSCurve'
            : 'LPCCurve',
      param1_name: param1Name,
      param2_name: param2Name,
      ...(target === 'LimitPointCycle' || target === 'NeimarkSacker'
        ? { ntst: outputNtst, ncol: outputNcol, normalized_mesh: normalizedMesh }
        : {}),
    },
    collocation_adaptation: curve.collocation_adaptation,
  };
}

function sourceFrequency(point: ContinuationPoint): number | undefined {
  const name = point.codim2?.type === 'ZeroHopf' ? 'omega' : 'omega1';
  return point.codim2?.coefficients.find((entry) => entry.name === name)?.value;
}

export async function initiateCodim2Branch(
  sysName: string,
  branch: ContinuationObject,
  point: ContinuationPoint,
  pointIndex: number,
  target: Codim2SwitchTarget
): Promise<ContinuationObject | null> {
  const codim2 = point.codim2;
  if (!codim2 || !codim2.refined || codim2.candidate) {
    printError('Select a refined codimension-two point that passed its nondegeneracy checks.');
    return null;
  }
  const sourceType = codim2.type;
  if (!['GeneralizedHopf', 'BogdanovTakens', 'ZeroHopf', 'DoubleHopf'].includes(sourceType)) {
    printError('This codimension-two point does not support branch switching.');
    return null;
  }
  if (sourceType === 'ZeroHopf' && !['Fold', 'Hopf', 'NeimarkSacker'].includes(target)) {
    printError('Zero-Hopf points switch to fold, Hopf, or periodic NS curves.');
    return null;
  }
  if (sourceType === 'DoubleHopf' && !['Hopf', 'NeimarkSacker'].includes(target)) {
    printError('Hopf-Hopf points switch to Hopf or periodic NS curves.');
    return null;
  }
  const branchType = branch.data.branch_type as any;
  const param1Name = branchType?.param1_name;
  const param2Name = branchType?.param2_name;
  if (!param1Name || !param2Name) {
    printError('Source curve parameter metadata is missing.');
    return null;
  }

  const defaults = {
    name: `${branch.name}_${target.toLowerCase()}_${pointIndex}`,
    perturbation: target === 'LimitPointCycle' || target === 'NeimarkSacker' ? 0.05 : 0.02,
    ntst: 20,
    ncol: 4,
  };
  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'New branch name:', default: defaults.name },
    { type: 'number', name: 'perturbation', message: target === 'NeimarkSacker' ? 'Cycle amplitude:' : 'Predictor perturbation:', default: defaults.perturbation },
    { type: 'number', name: 'ntst', message: 'Mesh intervals:', default: defaults.ntst, when: ['LimitPointCycle', 'NeimarkSacker', 'Homoclinic'].includes(target) },
    { type: 'number', name: 'ncol', message: 'Collocation degree:', default: defaults.ncol, when: ['LimitPointCycle', 'NeimarkSacker', 'Homoclinic'].includes(target) },
    { type: 'list', name: 'orientation', message: 'Predictor orientation:', choices: ['Positive', 'Negative'], default: 'Positive', when: (sourceType === 'ZeroHopf' && target !== 'NeimarkSacker') || (sourceType === 'DoubleHopf' && target === 'Hopf') },
    { type: 'list', name: 'mode', message: 'Hopf mode:', choices: [1, 2], default: 1, when: sourceType === 'DoubleHopf' },
    { type: 'confirm', name: 'forward', message: 'Continue forward?', default: true },
  ]);

  const sysConfig = Storage.loadSystem(sysName);
  const params = getBranchParams(sysName, branch, sysConfig);
  const param1Index = sysConfig.paramNames.indexOf(param1Name);
  const param2Index = sysConfig.paramNames.indexOf(param2Name);
  if (param1Index < 0 || param2Index < 0) {
    printError('Source curve parameters are not defined in the system.');
    return null;
  }
  params[param1Index] = point.param_value;
  params[param2Index] = point.param2_value ?? params[param2Index];
  const bridge = new WasmBridge({ ...sysConfig, params });
  const ntst = Math.max(3, Math.trunc(answers.ntst ?? defaults.ntst));
  const ncol = Math.max(1, Math.trunc(answers.ncol ?? defaults.ncol));
  const perturbation = Math.max(Number(answers.perturbation), 1e-6);
  const tolerance = 1e-7;

  try {
    let seed: any;
    let result: any;
    let normalForm: any;

    if (sourceType === 'ZeroHopf' || sourceType === 'DoubleHopf') {
      const frequency = sourceFrequency(point);
      if (!Number.isFinite(frequency) || (frequency ?? 0) <= 0) {
        throw new Error('Codimension-two source frequency metadata is missing.');
      }
      const switched = bridge.switchFromEquilibriumCodim2(
        sourceType,
        point.state,
        param1Name,
        param2Name,
        point.param_value,
        point.param2_value as number,
        frequency as number,
        perturbation,
        perturbation,
        ntst,
        ncol,
        tolerance
      );
      normalForm = {
        ...switched.normalForm,
        type: sourceType === 'ZeroHopf' ? 'ZeroHopf' : 'HopfHopf',
      };
      const orientationSign = answers.orientation === 'Negative' ? -1 : 1;
      if (sourceType === 'ZeroHopf') {
        seed = target === 'NeimarkSacker'
          ? switched.neimarkSackerSeed
          : switched.equilibriumCurveSeeds?.find(
              (candidate: any) => candidate.target === target && Math.sign(candidate.perturbation) === orientationSign
            );
      } else if (target === 'Hopf') {
        const modeFrequency = answers.mode === 2 ? normalForm.frequency2 : normalForm.frequency1;
        seed = switched.hopfCurveSeeds?.find(
          (candidate: any) => Math.sign(candidate.perturbation) === orientationSign &&
            Math.abs((candidate.auxiliary ?? 0) - modeFrequency ** 2) <= 1e-6 * Math.max(1, modeFrequency ** 2)
        );
      } else {
        const modeSign = answers.mode === 2 ? -1 : 1;
        seed = switched.neimarkSackerSeeds?.find(
          (candidate: any) => Math.sign(candidate.perturbation) === modeSign
        );
      }
      if (!seed) throw new Error(`No corrected ${target} seed is available for this orientation/mode.`);
      if (target === 'Fold') {
        result = runFoldCurveWithProgress(bridge, seed.state, param1Name, seed.param1_value, param2Name, seed.param2_value, 1, settings, answers.forward, 'Fold Curve');
      } else if (target === 'Hopf') {
        result = runHopfCurveWithProgress(bridge, seed.state, Math.sqrt(seed.auxiliary), param1Name, seed.param1_value, param2Name, seed.param2_value, 1, settings, answers.forward, 'Hopf Curve');
      } else {
        const seedNtst = seed.ntst ?? ntst;
        const seedNcol = seed.ncol ?? ncol;
        result = runNSCurveWithProgress(
          bridge, seed.state, seed.period, param1Name, seed.param1_value,
          param2Name, seed.param2_value, seed.auxiliary, seedNtst, seedNcol,
          uniformMesh(seedNtst), settings, answers.forward, 'NS Curve'
        );
      }
    } else if (sourceType === 'GeneralizedHopf') {
      const segment = codim2.source_segment;
      const neighborIndex = segment[0] === pointIndex ? segment[1] : segment[0];
      const neighbor = branch.data.points[neighborIndex];
      if (!neighbor) throw new Error('Source-segment neighbor is missing.');
      const neighborL1 = segment[0] === neighborIndex ? codim2.source_test_values[0] : codim2.source_test_values[1];
      const secondLyapunov = codim2.coefficients.find((entry) => entry.name === 'l2')?.value;
      if (!Number.isFinite(secondLyapunov)) throw new Error('Second Lyapunov coefficient is missing.');
      seed = bridge.initLPCFromGeneralizedHopf({
        ghState: point.state,
        neighborState: neighbor.state,
        param1Name,
        param2Name,
        ghParam1: point.param_value,
        ghParam2: point.param2_value as number,
        neighborParam1: neighbor.param_value,
        neighborParam2: neighbor.param2_value as number,
        ghKappa: point.auxiliary as number,
        neighborKappa: neighbor.auxiliary as number,
        neighborL1,
        secondLyapunov: secondLyapunov as number,
        amplitude: perturbation,
        ntst,
        ncol,
        tolerance,
      });
      result = runLPCCurveWithProgress(
        bridge, seed.state, seed.period, param1Name, seed.param1_value,
        param2Name, seed.param2_value, ntst, ncol, uniformMesh(ntst),
        settings, answers.forward, 'LPC Curve'
      );
    } else if (target === 'Homoclinic') {
      seed = bridge.initHomoclinicFromBogdanovTakens(
        point.state, param1Name, param2Name, point.param_value, point.param2_value as number,
        perturbation, ntst, ncol, tolerance
      );
      result = runHomoclinicContinuationWithProgress(bridge, seed.setup, settings, answers.forward, 'Homoclinic Branch');
    } else {
      const seeds = bridge.initCurvesFromBogdanovTakens(
        point.state, param1Name, param2Name, point.param_value, point.param2_value as number,
        perturbation, tolerance
      );
      seed = target === 'Fold' ? seeds[0] : seeds[1];
      result = target === 'Fold'
        ? runFoldCurveWithProgress(bridge, seed.state, param1Name, seed.param1_value, param2Name, seed.param2_value, 1, settings, answers.forward, 'Fold Curve')
        : runHopfCurveWithProgress(bridge, seed.state, Math.sqrt(seed.auxiliary), param1Name, seed.param1_value, param2Name, seed.param2_value, 1, settings, answers.forward, 'Hopf Curve');
    }

    if (!result?.points?.length) throw new Error('Branch continuation returned no points.');
    const data = target === 'Homoclinic'
      ? result
      : curveBranchData(result, target, param1Name, param2Name, ntst, ncol);
    if (normalForm) {
      const provenance: NormalFormProvenance = {
        source_kind: sourceType === 'ZeroHopf' ? 'ZeroHopf' : 'HopfHopf',
        source_branch_id: branch.name,
        source_branch_name: branch.name,
        source_point_index: pointIndex,
        parameter_names: [param1Name, param2Name],
        parameter_values: [point.param_value, point.param2_value as number],
        computed_at: new Date().toISOString(),
        normal_form: normalForm,
      };
      point.normal_form = provenance;
      data.normal_form_provenance = provenance;
      Storage.saveBranch(sysName, branch.parentObject, branch);
    }
    data.codim2_seed = {
      source_type: sourceType,
      source_branch: branch.name,
      source_point_index: pointIndex,
      target,
      perturbation,
      predictor_residual: seed.predictor_residual,
      corrected_residual: seed.corrected_residual,
      correction_iterations: seed.correction_iterations,
    };
    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: answers.name,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: target === 'Fold'
        ? 'fold_curve'
        : target === 'Hopf'
          ? 'hopf_curve'
          : target === 'LimitPointCycle'
            ? 'lpc_curve'
            : target === 'NeimarkSacker'
              ? 'ns_curve'
              : 'homoclinic_curve',
      data,
      settings,
      timestamp: new Date().toISOString(),
      params,
    };
    Storage.saveBranch(sysName, branch.parentObject, newBranch);
    printSuccess(`Saved ${target} branch: ${answers.name}`);
    return newBranch;
  } catch (error) {
    printInfo('Codimension-two predictor stopped before creating a branch.');
    printError(String(error));
    return null;
  }
}
