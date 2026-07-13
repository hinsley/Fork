import inquirer from 'inquirer';
import { Storage } from '../storage';
import { WasmBridge } from '../wasm';
import type { ContinuationObject, ContinuationPoint } from '../types';
import { printError, printInfo, printSuccess } from '../format';
import { getBranchParams } from './utils';
import {
  runFoldCurveWithProgress,
  runHomoclinicContinuationWithProgress,
  runHopfCurveWithProgress,
  runLPCCurveWithProgress
} from './progress';

export type Codim2SwitchTarget = 'Fold' | 'Hopf' | 'LimitPointCycle' | 'Homoclinic';

const settings = {
  step_size: 0.01,
  min_step_size: 1e-5,
  max_step_size: 0.1,
  max_steps: 300,
  corrector_steps: 10,
  corrector_tolerance: 1e-8,
  step_tolerance: 1e-8
};

function curveBranchData(curve: any, target: Codim2SwitchTarget, param1Name: string, param2Name: string, ntst: number, ncol: number) {
  return {
    points: (curve.points ?? []).map((entry: any) => ({
      state: entry.state ?? [],
      param_value: entry.param1_value,
      param2_value: entry.param2_value,
      stability: entry.codim2_type ?? 'None',
      eigenvalues: entry.eigenvalues ?? [],
      auxiliary: entry.auxiliary,
      codim2: entry.codim2
    })),
    bifurcations: (curve.codim2_bifurcations ?? []).map((entry: any) => entry.index),
    indices: curve.indices ?? (curve.points ?? []).map((_: unknown, index: number) => index),
    branch_type: {
      type: target === 'Fold' ? 'FoldCurve' : target === 'Hopf' ? 'HopfCurve' : 'LPCCurve',
      param1_name: param1Name,
      param2_name: param2Name,
      ...(target === 'LimitPointCycle' ? { ntst, ncol } : {})
    }
  };
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
  if (sourceType !== 'GeneralizedHopf' && sourceType !== 'BogdanovTakens') {
    printError('This codimension-two point does not support branch switching.');
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
    perturbation: target === 'LimitPointCycle' ? 0.05 : 0.02,
    ntst: 20,
    ncol: 4,
    forward: true
  };
  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'New branch name:', default: defaults.name },
    { type: 'number', name: 'perturbation', message: target === 'LimitPointCycle' ? 'Cycle amplitude:' : 'Predictor perturbation:', default: defaults.perturbation },
    { type: 'number', name: 'ntst', message: 'Mesh intervals:', default: defaults.ntst, when: target === 'LimitPointCycle' || target === 'Homoclinic' },
    { type: 'number', name: 'ncol', message: 'Collocation degree:', default: defaults.ncol, when: target === 'LimitPointCycle' || target === 'Homoclinic' },
    { type: 'confirm', name: 'forward', message: 'Continue forward?', default: true }
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
    if (sourceType === 'GeneralizedHopf') {
      const segment = codim2.source_segment;
      const neighborIndex = segment[0] === pointIndex ? segment[1] : segment[0];
      const neighbor = branch.data.points[neighborIndex];
      if (!neighbor) throw new Error('Source-segment neighbor is missing.');
      const neighborL1 = segment[0] === neighborIndex
        ? codim2.source_test_values[0]
        : codim2.source_test_values[1];
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
        tolerance
      });
      result = runLPCCurveWithProgress(
        bridge, seed.state, seed.period, param1Name, seed.param1_value,
        param2Name, seed.param2_value, ntst, ncol, settings, answers.forward, 'LPC Curve'
      );
    } else if (target === 'Homoclinic') {
      seed = bridge.initHomoclinicFromBogdanovTakens(
        point.state, param1Name, param2Name, point.param_value, point.param2_value as number,
        perturbation, ntst, ncol, tolerance
      );
      result = runHomoclinicContinuationWithProgress(
        bridge, seed.setup, settings, answers.forward, 'Homoclinic Branch'
      );
    } else {
      const seeds = bridge.initCurvesFromBogdanovTakens(
        point.state, param1Name, param2Name, point.param_value, point.param2_value as number,
        perturbation, tolerance
      );
      seed = target === 'Fold' ? seeds[0] : seeds[1];
      result = target === 'Fold'
        ? runFoldCurveWithProgress(
            bridge, seed.state, param1Name, seed.param1_value, param2Name,
            seed.param2_value, 1, settings, answers.forward, 'Fold Curve'
          )
        : runHopfCurveWithProgress(
            bridge, seed.state, Math.sqrt(seed.auxiliary), param1Name, seed.param1_value,
            param2Name, seed.param2_value, 1, settings, answers.forward, 'Hopf Curve'
          );
    }
    if (!result?.points?.length) throw new Error('Branch continuation returned no points.');
    const data = target === 'Homoclinic'
      ? result
      : curveBranchData(result, target, param1Name, param2Name, ntst, ncol);
    data.codim2_seed = {
      source_type: sourceType,
      source_branch: branch.name,
      source_point_index: pointIndex,
      target,
      perturbation,
      predictor_residual: seed.predictor_residual,
      corrected_residual: seed.corrected_residual,
      correction_iterations: seed.correction_iterations
    };
    const newBranch: ContinuationObject = {
      type: 'continuation',
      name: answers.name,
      systemName: sysName,
      parameterName: `${param1Name}, ${param2Name}`,
      parentObject: branch.parentObject,
      startObject: branch.name,
      branchType: target === 'Fold' ? 'fold_curve' : target === 'Hopf' ? 'hopf_curve' : target === 'LimitPointCycle' ? 'lpc_curve' : 'homoclinic_curve',
      data,
      settings,
      timestamp: new Date().toISOString(),
      params
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
