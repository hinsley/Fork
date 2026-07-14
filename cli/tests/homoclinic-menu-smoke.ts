import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ContinuationBranchData,
  ContinuationObject,
  ContinuationPoint,
  SystemConfig
} from '../src/types';

type MenuValue = string | number | boolean;

async function withConfigMenu(
  edits: Array<[string, MenuValue]>,
  action: () => Promise<ContinuationObject | null>
): Promise<ContinuationObject | null> {
  const inquirer = require('inquirer') as {
    prompt: (question: { name: string; message?: string }) => Promise<Record<string, unknown>>;
  };
  const originalPrompt = inquirer.prompt;
  const queue = [...edits];
  let pending: [string, MenuValue] | undefined;

  inquirer.prompt = async (question) => {
    if (question.name === 'selection') {
      pending = queue.shift();
      return { selection: pending?.[0] ?? '__CONFIG_CONTINUE__' };
    }
    assert.ok(pending, `unexpected prompt: ${question.message ?? question.name}`);
    const [, value] = pending;
    pending = undefined;
    return { [question.name]: value };
  };

  try {
    const result = await action();
    assert.equal(queue.length, 0, `unused menu edits: ${JSON.stringify(queue)}`);
    assert.equal(pending, undefined, 'menu edit did not consume its value prompt');
    return result;
  } finally {
    inquirer.prompt = originalPrompt;
  }
}

function arithmeticGeometricMean(a: number, b: number): number {
  let left = a;
  let right = b;
  for (let index = 0; index < 64; index += 1) {
    const arithmetic = 0.5 * (left + right);
    const geometric = Math.sqrt(left * right);
    left = arithmetic;
    right = geometric;
    if (Math.abs(left - right) < 1e-15) break;
  }
  return left;
}

function duffingStateAt(time: number, amplitude: number): number[] {
  const steps = Math.max(1, Math.ceil(time / 1e-3));
  const step = time / steps;
  let x = amplitude;
  let y = 0;
  const flow = (u: number, v: number): [number, number] => [v, u - u ** 3];
  for (let index = 0; index < steps; index += 1) {
    const k1 = flow(x, y);
    const k2 = flow(x + 0.5 * step * k1[0], y + 0.5 * step * k1[1]);
    const k3 = flow(x + 0.5 * step * k2[0], y + 0.5 * step * k2[1]);
    const k4 = flow(x + step * k3[0], y + step * k3[1]);
    x += step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    y += step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
  }
  return [x, y];
}

function duffingLargeCycleState(
  ntst: number,
  ncol: number,
  normalizedMesh = Array.from({ length: ntst + 1 }, (_, index) => index / ntst)
): number[] {
  assert.equal(ncol, 2, 'Duffing menu fixture uses two Gauss stages');
  const modulus = 0.99;
  const frequency = 1 / Math.sqrt(2 - modulus ** 2);
  const amplitude = Math.sqrt(2) * frequency;
  const completeEllipticK = Math.PI / (
    2 * arithmeticGeometricMean(1, Math.sqrt(1 - modulus ** 2))
  );
  const period = 2 * completeEllipticK / frequency;
  const nodes = [(1 - 1 / Math.sqrt(3)) / 2, (1 + 1 / Math.sqrt(3)) / 2];
  const state: number[] = [];
  for (let interval = 0; interval < ntst; interval += 1) {
    state.push(...duffingStateAt(period * normalizedMesh[interval], amplitude));
  }
  for (let interval = 0; interval < ntst; interval += 1) {
    for (const node of nodes) {
      const left = normalizedMesh[interval];
      const right = normalizedMesh[interval + 1];
      state.push(...duffingStateAt(period * (left + node * (right - left)), amplitude));
    }
  }
  state.push(period);
  return state;
}

function homoclinicParam2(point: ContinuationPoint, ntst: number, ncol: number): number {
  const dimension = 2;
  const index = (ntst + 1) * dimension + ntst * ncol * dimension + dimension;
  const value = point.state[index];
  assert.ok(Number.isFinite(value), 'homoclinic point must encode nu');
  return value;
}

function packHomoclinicSetup(setup: any): number[] {
  const packed = [
    ...setup.guess.mesh_states.flat(),
    ...setup.guess.stage_states.flat(2),
    ...setup.guess.x0,
    setup.guess.param2_value
  ];
  if (setup.extras.free_time) packed.push(setup.guess.time);
  if (setup.extras.free_eps0) packed.push(setup.guess.eps0);
  if (setup.extras.free_eps1) packed.push(setup.guess.eps1);
  packed.push(...setup.guess.yu, ...setup.guess.ys);
  return packed;
}

const certifiedMenuEdits: Array<[string, MenuValue]> = [
  ['freeTime', true],
  ['freeEps0', false],
  ['freeEps1', false],
  ['stepSize', '1e-4'],
  ['maxSteps', '3'],
  ['minStepSize', '1e-9'],
  ['maxStepSize', '1e-3'],
  ['correctorTolerance', '1e-8'],
  ['stepTolerance', '1e-8']
];

async function run(): Promise<void> {
  const originalCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-cli-homoclinic-menu-'));
  process.chdir(tempRoot);

  try {
    // Storage binds its data root at import time, after the isolated cwd is active.
    const { Storage } = require('../src/storage') as typeof import('../src/storage');
    const { WasmBridge } = require('../src/wasm') as typeof import('../src/wasm');
    const {
      initiateHomoclinicFromLargeCycle,
      initiateHomoclinicFromHomoclinic,
      initiateHomoclinicFromHomotopySaddle
    } = require('../src/continuation/initiate-homoclinic') as typeof import('../src/continuation/initiate-homoclinic');

    const systemName = 'duffing_homoclinic_menu_reference';
    const parentObject = 'duffing_reference_orbit';
    const sourceNtst = 32;
    const sourceNcol = 2;
    const targetNtst = 8;
    const targetNcol = 2;
    const sourceNormalizedMesh = Array.from(
      { length: sourceNtst + 1 },
      (_, index) => (index / sourceNtst) ** 1.2
    );
    const config: SystemConfig = {
      name: systemName,
      equations: ['y', 'x-x^3+(mu-nu)*y'],
      params: [0, 0],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow'
    };
    Storage.saveSystem(config);

    const largeCyclePoint: ContinuationPoint = {
      state: duffingLargeCycleState(sourceNtst, sourceNcol, sourceNormalizedMesh),
      param_value: 0,
      stability: 'None',
      eigenvalues: []
    };
    const limitCycleBranch: ContinuationObject = {
      type: 'continuation',
      name: 'duffing_large_cycle',
      systemName,
      parameterName: 'mu',
      parentObject,
      startObject: parentObject,
      branchType: 'limit_cycle',
      data: {
        points: [largeCyclePoint],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'LimitCycle',
          ntst: sourceNtst,
          ncol: sourceNcol,
          normalized_mesh: sourceNormalizedMesh
        }
      } as ContinuationBranchData,
      settings: {},
      timestamp: new Date(0).toISOString(),
      params: [0, 0]
    };

    const method1 = await withConfigMenu(
      [['targetNtst', `${targetNtst}`], ...certifiedMenuEdits],
      () => initiateHomoclinicFromLargeCycle(systemName, limitCycleBranch, largeCyclePoint, 0)
    );
    assert.ok(method1, 'Method 1 menu run must create a branch');

    const method1Shooting = await withConfigMenu(
      [
        ['curveName', 'duffing_homoclinic_shooting'],
        ['discretization', 'shooting'],
        ['targetNtst', `${targetNtst}`],
        ['shootingIntervals', `${targetNtst}`],
        ['integrationStepsPerSegment', '64'],
        ...certifiedMenuEdits
      ],
      () => initiateHomoclinicFromLargeCycle(systemName, limitCycleBranch, largeCyclePoint, 0)
    );
    assert.ok(method1Shooting, 'Method 1 shooting menu run must create a branch');
    assert.ok(
      method1Shooting.data.points.length > 1,
      'Method 1 shooting menu run must advance beyond its seed'
    );
    assert.equal(method1Shooting.data.branch_type?.type, 'HomoclinicCurve');
    if (method1Shooting.data.branch_type?.type === 'HomoclinicCurve') {
      assert.equal(method1Shooting.data.branch_type.ncol, 0);
      assert.equal(method1Shooting.data.branch_type.ntst, targetNtst);
      assert.deepEqual(method1Shooting.data.branch_type.discretization, {
        type: 'shooting',
        integration_steps_per_segment: 64
      });
    }
    assert.ok(method1.data.points.length > 1, 'Method 1 menu run must advance beyond its seed');

    const method1Point = method1.data.points[0];
    assert.ok(method1Point, 'Method 1 must retain an accepted restart point');
    const method2 = await withConfigMenu(certifiedMenuEdits, () =>
      initiateHomoclinicFromHomoclinic(systemName, method1, method1Point, 0)
    );
    assert.ok(method2, 'Method 2 menu run must create a branch');
    assert.ok(method2.data.points.length > 1, 'Method 2 menu run must advance beyond its seed');

    const method1Type = method1.data.branch_type;
    assert.equal(method1Type?.type, 'HomoclinicCurve');
    if (!method1Type || method1Type.type !== 'HomoclinicCurve') {
      throw new Error('Method 1 must persist homoclinic branch metadata');
    }
    assert.ok(
      Array.isArray(method1Type.normalized_mesh)
        && method1Type.normalized_mesh.length === method1Type.ntst + 1,
      'Method 1 must persist its adapted normalized mesh'
    );
    const nu = homoclinicParam2(method1Point, method1Type.ntst, method1Type.ncol);
    const sourceContext = method1.data.homoc_context;
    assert.ok(sourceContext, 'Method 1 must persist homoclinic fixed-scalar context');
    const stageBridge = new WasmBridge({
      ...config,
      params: [method1Point.param_value, nu]
    });
    const stageSetup = stageBridge.initHomoclinicFromHomoclinicOnMesh(
      method1Point.state,
      method1Type.ncol,
      method1Type.normalized_mesh,
      method1Type.free_time,
      method1Type.free_eps0,
      method1Type.free_eps1,
      sourceContext.fixed_time ?? 1,
      sourceContext.fixed_eps0 ?? 1e-2,
      sourceContext.fixed_eps1 ?? 1e-2,
      'mu',
      'nu',
      targetNcol,
      Array.from({ length: targetNtst + 1 }, (_, index) => index / targetNtst),
      true,
      false,
      true
    );
    const stageDPoint: ContinuationPoint = {
      state: packHomoclinicSetup(stageSetup),
      param_value: method1Point.param_value,
      param2_value: nu,
      stability: 'None',
      eigenvalues: []
    };
    const stageDBranch: ContinuationObject = {
      type: 'continuation',
      name: 'duffing_stage_d',
      systemName,
      parameterName: 'mu, nu',
      parentObject,
      startObject: method1.name,
      branchType: 'homotopy_saddle_curve',
      data: {
        points: [stageDPoint],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomotopySaddleCurve',
          ntst: targetNtst,
          ncol: targetNcol,
          param1_name: 'mu',
          param2_name: 'nu',
          stage: 'StageD'
        }
      } as ContinuationBranchData,
      settings: {},
      timestamp: new Date(0).toISOString(),
      params: [method1Point.param_value, nu]
    };

    const method4 = await withConfigMenu(certifiedMenuEdits, () =>
      initiateHomoclinicFromHomotopySaddle(systemName, stageDBranch, stageDPoint, 0)
    );
    assert.ok(method4, 'Method 4 menu run must create a branch');
    assert.ok(method4.data.points.length > 1, 'Method 4 menu run must advance beyond its seed');

    for (const [label, branch] of [
      ['Method 1', method1],
      ['Method 1 Shooting', method1Shooting],
      ['Method 2', method2],
      ['Method 4', method4]
    ] as const) {
      const stored = Storage.loadBranch(systemName, parentObject, branch.name);
      assert.equal(stored.type, 'continuation', `${label} persisted object type`);
      const storedBranch = stored as ContinuationObject;
      assert.equal(
        storedBranch.data.points.length,
        branch.data.points.length,
        `${label} persisted points`
      );
      assert.equal(storedBranch.branchType, 'homoclinic_curve', `${label} persisted branch type`);
    }

    console.log('PASS menu-driven homoclinic Methods 1 (collocation and shooting), 2, and 4');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
