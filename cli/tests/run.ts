import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SystemConfig } from '../src/types';

type TestCase = { name: string; fn: () => void | Promise<void> };

const tests: TestCase[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function captureOutput(fn: () => void) {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWrite = process.stdout.write.bind(process.stdout);

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  (process.stdout.write as any) = (chunk: unknown) => {
    logs.push(String(chunk));
    return true;
  };

  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    (process.stdout.write as any) = originalWrite;
  }

  return { logs, errors };
}

let systemCounter = 0;

function nextSystemName() {
  systemCounter += 1;
  return `test_system_${systemCounter}`;
}

function makeSystemConfig(name: string, params: number[] = [1, 2]): SystemConfig {
  return {
    name,
    equations: ['x'],
    params,
    paramNames: params.map((_, idx) => `p${idx}`),
    varNames: ['x'],
    solver: 'rk4',
    type: 'flow'
  };
}

function makeContinuationBranch(options: { name: string; systemName: string; parentObject: string; params?: number[] }) {
  return {
    type: 'continuation',
    name: options.name,
    systemName: options.systemName,
    parameterName: 'p0',
    parentObject: options.parentObject,
    startObject: options.parentObject,
    branchType: 'equilibrium',
    data: {
      points: [],
      bifurcations: [],
      indices: []
    },
    settings: {},
    timestamp: new Date(0).toISOString(),
    params: options.params
  };
}

function makeLimitCycleObject(name: string, systemName: string, branchName: string) {
  return {
    type: 'limit_cycle',
    name,
    systemName,
    origin: {
      type: 'hopf',
      equilibriumObjectName: 'eq_seed',
      equilibriumBranchName: branchName,
      pointIndex: 0
    },
    ntst: 1,
    ncol: 1,
    period: 1,
    state: [],
    createdAt: new Date(0).toISOString()
  };
}

async function run() {
  const originalCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-cli-tests-'));

  // Storage module uses process.cwd() at import time.
  process.chdir(tempRoot);

  const { Storage } = require('../src/storage') as typeof import('../src/storage');
  const naming = require('../src/naming') as typeof import('../src/naming');
  const serialization = require('../src/continuation/serialization') as typeof import('../src/continuation/serialization');
  const metrics = require('../src/continuation/metrics') as typeof import('../src/continuation/metrics');
  const lcFromOrbit = require('../src/continuation/initiate-lc-from-orbit') as typeof import('../src/continuation/initiate-lc-from-orbit');
  const homocInit = require('../src/continuation/initiate-homoclinic') as typeof import('../src/continuation/initiate-homoclinic');
  const homocExtras = require('../src/continuation/homoclinic-extras') as typeof import('../src/continuation/homoclinic-extras');
  const homotopyInit = require('../src/continuation/initiate-homotopy-saddle') as typeof import('../src/continuation/initiate-homotopy-saddle');
  const heteroclinicInit = require('../src/continuation/initiate-heteroclinic') as typeof import('../src/continuation/initiate-heteroclinic');
  const branchExtension = require('../src/continuation/extend') as typeof import('../src/continuation/extend');
  const wasmBridge = require('../src/wasm') as typeof import('../src/wasm');
  const utils = require('../src/continuation/utils') as typeof import('../src/continuation/utils');
  const format = require('../src/format') as typeof import('../src/format');
  const labels = require('../src/labels') as typeof import('../src/labels');
  const normalForms = require('../src/continuation/normal-forms') as typeof import('../src/continuation/normal-forms');
  const inspect = require('../src/continuation/inspect') as typeof import('../src/continuation/inspect');
  const collocationAdaptivity = require('../src/continuation/collocation-adaptivity') as typeof import('../src/continuation/collocation-adaptivity');
  const chalk = require('chalk');

  chalk.level = 0;

  test('homoclinic forms require one or two free extras', () => {
    assert.equal(homocExtras.homoclinicExtraSelectionError(false, true, false), null);
    assert.equal(homocExtras.homoclinicExtraSelectionError(true, false, true), null);
    assert.match(
      homocExtras.homoclinicExtraSelectionError(false, false, false) ?? '',
      /at least one/i
    );
    assert.match(
      homocExtras.homoclinicExtraSelectionError(true, true, true) ?? '',
      /at most two/i
    );
  });

  test('homoclinic standard-shooting controls require positive integer counts', () => {
    assert.equal(
      homocExtras.homoclinicShootingSettingsError('collocation', 0, 0),
      null
    );
    assert.equal(
      homocExtras.homoclinicShootingSettingsError('shooting', 6, 96),
      null
    );
    assert.match(
      homocExtras.homoclinicShootingSettingsError('shooting', 0, 96) ?? '',
      /intervals.*positive integer/i
    );
    assert.match(
      homocExtras.homoclinicShootingSettingsError('shooting', 6, 1.5) ?? '',
      /integration steps.*positive integer/i
    );
  });

  test('CLI bridge exposes standard-shooting initialization and runner creation', () => {
    assert.equal(
      typeof wasmBridge.WasmBridge.prototype.initHomoclinicShootingFromCollocation,
      'function'
    );
    assert.equal(
      typeof wasmBridge.WasmBridge.prototype.createHomoclinicShootingContinuationRunner,
      'function'
    );
  });

  test('CLI bridge and eligibility expose genuine two-equilibrium heteroclinics', () => {
    assert.equal(
      typeof wasmBridge.WasmBridge.prototype.initHeteroclinicFromOrbit,
      'function'
    );
    assert.equal(
      typeof wasmBridge.WasmBridge.prototype.createHeteroclinicContinuationRunner,
      'function'
    );
    const config: SystemConfig = {
      name: 'heteroclinic_reference',
      equations: ['1-x*x', 'x*y+(mu-nu)*(1-x*x)'],
      params: [0, 0],
      paramNames: ['mu', 'nu'],
      varNames: ['x', 'y'],
      solver: 'rk4',
      type: 'flow',
    };
    const orbit = {
      type: 'orbit' as const,
      name: 'connection',
      systemName: config.name,
      data: [[-1, -0.76, 0], [1, 0.76, 0]],
      t_start: -1,
      t_end: 1,
      dt: 2,
      parameters: [0, 0],
    };
    const equilibrium = (name: string, state: number[]) => ({
      type: 'equilibrium' as const,
      name,
      systemName: config.name,
      parameters: [0, 0],
      solution: {
        state,
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
    });
    assert.equal(
      heteroclinicInit.heteroclinicEligibilityError(config, orbit, [
        equilibrium('source', [-1, 0]),
        equilibrium('target', [1, 0]),
      ]),
      null
    );
    assert.match(
      heteroclinicInit.heteroclinicEligibilityError(
        { ...config, type: 'map', solver: 'discrete' },
        orbit,
        [equilibrium('source', [-1, 0]), equilibrium('target', [1, 0])]
      ) ?? '',
      /flows only/i
    );
  });

  test('CLI diagnostics decode standard-shooting homoclinic packed states', () => {
    const point = {
      state: [
        0, 0, 1, 0, 2, 0,
        0.1, -0.2,
        0.37,
        8,
        0, 0,
      ],
      param_value: 0.2,
      stability: 'None',
      eigenvalues: []
    } as import('../src/types').ContinuationPoint;
    const decoded = inspect.decodePackedHomoclinicPoint(
      point,
      2,
      2,
      0,
      true,
      false,
      false
    );
    assert.ok(decoded);
    assert.equal(decoded.time, 8);
    assert.ok(Math.abs((decoded.startDistance ?? 0) - Math.hypot(0.1, -0.2)) < 1e-12);
    assert.ok(Math.abs((decoded.endDistance ?? 0) - Math.hypot(1.9, 0.2)) < 1e-12);
  });

  test('CLI homoclinic diagnostics display persisted HBK values, statuses, and reasons', () => {
    const point = {
      homoclinic_events: {
        stable_dimension: 2,
        unstable_dimension: 1,
        discarded_eigenvalues: 1,
        events: [
          {
            kind: 'NNS',
            name: 'Neutral saddle',
            value: -0.125,
            status: 'available',
            reason: null,
          },
          {
            kind: 'IFU',
            name: 'Inclination flip (unstable manifold)',
            value: null,
            status: 'unsupported',
            reason: 'adjoint continuation is unavailable',
          },
        ],
      },
    } as Pick<import('../src/types').ContinuationPoint, 'homoclinic_events'>;
    const lines = inspect.formatHomoclinicEventDiagnosticLines(point);
    assert.match(lines[0], /stable=2.*unstable=1.*discarded eigenvalues=1/);
    assert.match(lines[1], /NNS.*status=available.*value=-0\.125.*reason=—/);
    assert.match(
      lines[2],
      /IFU.*status=unsupported.*value=unavailable.*adjoint continuation is unavailable/
    );

    const serialized = serialization.serializeBranchDataForWasm({
      points: [
        {
          state: [0],
          param_value: 0,
          stability: 'None',
          eigenvalues: [],
          ...point,
        },
      ],
      bifurcations: [],
      indices: [0],
    });
    assert.deepEqual(serialized.points[0].homoclinic_events, point.homoclinic_events);
  });

  test('homoclinic CLI method labels match the documented numbering', () => {
    assert.match(homotopyInit.HOMOTOPY_SADDLE_MENU_TITLE, /^Method 3:/);
    assert.match(homocInit.HOMOCLINIC_FROM_HOMOTOPY_MENU_TITLE, /^Method 4:/);
  });

  test('homotopy-saddle branches do not expose unsupported extension', () => {
    assert.equal(branchExtension.supportsContinuationBranchExtension('homotopy_saddle_curve'), false);
    assert.equal(branchExtension.supportsContinuationBranchExtension('homoclinic_curve'), true);
    assert.equal(branchExtension.supportsContinuationBranchExtension('limit_cycle'), true);
  });

  test('periodic codim2 menu exposes only available adjacent curve switches', () => {
    const point = {
      state: [],
      param_value: 0.25,
      param2_value: 0.45,
      stability: 'DoubleNeimarkSacker',
      codim2_events: [
        {
          refined: true,
          candidate: false,
          branch_switches: [
            {
              target: 'NeimarkSacker',
              available: true,
              target_auxiliary: 0.25,
            },
            {
              target: 'LimitPointCycle',
              available: true,
            },
            {
              target: 'PeriodDoubling',
              available: true,
            },
            {
              target: 'Homoclinic',
              available: false,
              reason: 'Higher-order predictor unavailable.',
            },
          ],
        },
      ],
    } as any;
    assert.deepEqual(inspect.periodicCodim2CurveActionsForPoint('ns_curve', point), [
      {
        action: 'SWITCH_PERIODIC_CODIM2_NS',
        label: 'Switch to Adjacent NS Curve',
        target: 'NeimarkSacker',
        targetAuxiliary: 0.25,
      },
      {
        action: 'SWITCH_PERIODIC_CODIM2_LPC',
        label: 'Switch to Adjacent LPC Curve',
        target: 'LimitPointCycle',
        targetAuxiliary: undefined,
      },
      {
        action: 'SWITCH_PERIODIC_CODIM2_PD',
        label: 'Switch to Adjacent PD Curve',
        target: 'PeriodDoubling',
        targetAuxiliary: undefined,
      },
    ]);
    assert.deepEqual(inspect.periodicCodim2CurveActionsForPoint('limit_cycle', point), []);
    const unavailablePoint = {
      ...point,
      codim2_events: [
        {
          refined: true,
          candidate: false,
          branch_switches: [
            {
              target: 'LimitPointCycle',
              available: false,
              reason: 'A higher-order predictor is required.',
            },
          ],
        },
      ],
    } as any;
    assert.deepEqual(
      inspect.periodicCodim2CurveActionsForPoint('lpc_curve', unavailablePoint),
      []
    );
  });

  test('collocation adaptivity validates exact integers and disabled subordinate fields', () => {
    const defaults = collocationAdaptivity.defaultCollocationAdaptivityInputs();
    assert.deepEqual(
      collocationAdaptivity.buildCollocationAdaptivitySettings({
        ...defaults,
        maxRefinements: '0'
      }),
      {
        enabled: true,
        redistribution_enabled: true,
        defect_tolerance: 0.025,
        max_refinements: 0,
        max_mesh_points: 512
      }
    );
    assert.throws(
      () => collocationAdaptivity.buildCollocationAdaptivitySettings({
        ...defaults,
        maxRefinements: '3.7'
      }),
      /nonnegative integer/
    );
    assert.throws(
      () => collocationAdaptivity.buildCollocationAdaptivitySettings({
        ...defaults,
        maxMeshPoints: 'invalid'
      }),
      /integer of at least 2/
    );
    assert.deepEqual(
      collocationAdaptivity.buildCollocationAdaptivitySettings({
        ...defaults,
        enabled: false,
        defectTolerance: 'invalid',
        maxRefinements: '3.7',
        maxMeshPoints: 'invalid'
      }),
      {
        enabled: false,
        redistribution_enabled: true,
        defect_tolerance: 0.025,
        max_refinements: 3,
        max_mesh_points: 512
      }
    );
  });

  test('large-cycle homoclinic mesh guard distinguishes uniform and nonuniform meshes', () => {
    assert.equal(
      collocationAdaptivity.isUniformNormalizedCollocationMesh([0, 0.25, 0.5, 0.75, 1]),
      true
    );
    assert.equal(
      collocationAdaptivity.isUniformNormalizedCollocationMesh([0, 0.1, 0.5, 0.75, 1]),
      false
    );
  });

  test('limit-cycle stability removes exactly one credible trivial +1 multiplier', () => {
    assert.equal(
      metrics.interpretLCStability([
        { re: 1, im: 0 },
        { re: -1.005, im: 0 }
      ]),
      'unstable (1D)'
    );
    assert.equal(
      metrics.interpretLCStability([
        { re: 1.001, im: 0 },
        { re: 1.005, im: 0 }
      ]),
      'unstable (1D)'
    );
    assert.equal(metrics.interpretLCStability([{ re: 1, im: 0.2 }]), 'unknown');
  });

  test('limit-cycle continuation from Orbit rejects map systems at the CLI entry', () => {
    assert.equal(lcFromOrbit.limitCycleFromOrbitSystemTypeError('flow'), null);
    assert.match(
      lcFromOrbit.limitCycleFromOrbitSystemTypeError('map') ?? '',
      /flow systems only/
    );
  });

  const dataDir = path.join(process.cwd(), 'data');
  const systemsDir = path.join(dataDir, 'systems');

  test('naming validates names', () => {
    assert.equal(naming.isValidName(''), 'Name cannot be empty.');
    assert.equal(
      naming.isValidName('bad name'),
      'Name must contain only alphanumeric characters and underscores (no spaces).'
    );
    assert.equal(naming.isValidName('ok_name_123'), true);
  });

  test('serialization converts eigenvalues for wasm and back', () => {
    const data = {
      points: [
        {
          state: [0],
          param_value: 1,
          stability: 'None',
          eigenvalues: [{ re: 1, im: 2 }, [3, 4]]
        }
      ],
      bifurcations: [],
      indices: [],
      resume_state: {
        max_index_seed: {
          endpoint_index: 1,
          aug_state: [1, 0],
          tangent: [1, 0],
          step_size: 0.02
        }
      }
    };

    const serialized = serialization.serializeBranchDataForWasm(data as any);
    assert.deepEqual(serialized.points[0].eigenvalues, [
      [1, 2],
      [3, 4]
    ]);
    assert.equal(serialized.resume_state.max_index_seed.step_size, 0.02);

    const normalized = serialization.normalizeBranchEigenvalues(serialized as any);
    assert.deepEqual(normalized.points[0].eigenvalues, [
      { re: 1, im: 2 },
      { re: 3, im: 4 }
    ]);
    assert.equal(
      normalized.resume_state?.max_index_seed?.endpoint_index,
      1
    );
  });

  test('homoclinic seed trim remaps resume_state endpoint indices', () => {
    const data = {
      points: [
        {
          state: [0, 0],
          param_value: 0.1,
          stability: 'None',
          eigenvalues: []
        },
        {
          state: [1, 1],
          param_value: 0.2,
          stability: 'None',
          eigenvalues: []
        },
        {
          state: [2, 2],
          param_value: 0.3,
          stability: 'None',
          eigenvalues: []
        }
      ],
      bifurcations: [0, 2],
      indices: [10, 11, 12],
      resume_state: {
        min_index_seed: {
          endpoint_index: 11,
          aug_state: [0.2, 1, 1],
          tangent: [1, 0, 0],
          step_size: 0.01
        },
        max_index_seed: {
          endpoint_index: 12,
          aug_state: [0.3, 2, 2],
          tangent: [1, 0, 0],
          step_size: 0.02
        }
      }
    } as any;

    const trimmed = homocInit.discardInitialApproximationPoint(data);
    assert.deepEqual(trimmed.indices, [0, 1]);
    assert.equal(trimmed.resume_state?.min_index_seed?.endpoint_index, 0);
    assert.equal(trimmed.resume_state?.max_index_seed?.endpoint_index, 1);
    assert.equal(trimmed.resume_state?.max_index_seed?.step_size, 0.02);
  });

  test('homoclinic seed trim synthesizes boundary seed when min seed is dropped', () => {
    const data = {
      points: [
        {
          state: [0, 0],
          param_value: 0.1,
          stability: 'None',
          eigenvalues: []
        },
        {
          state: [1, 1],
          param_value: 0.2,
          stability: 'None',
          eigenvalues: []
        },
        {
          state: [2, 2],
          param_value: 0.3,
          stability: 'None',
          eigenvalues: []
        }
      ],
      bifurcations: [0, 1, 2],
      indices: [0, 1, 2],
      resume_state: {
        max_index_seed: {
          endpoint_index: 2,
          aug_state: [0.3, 2, 2],
          tangent: [1, 0, 0],
          step_size: 0.02
        }
      }
    } as any;

    const trimmed = homocInit.discardInitialApproximationPoint(data);
    assert.deepEqual(trimmed.indices, [0, 1]);
    assert.equal(trimmed.resume_state?.min_index_seed?.endpoint_index, 0);
    assert.equal(trimmed.resume_state?.max_index_seed?.endpoint_index, 1);
    assert.ok(
      (trimmed.resume_state?.min_index_seed?.tangent?.length ?? 0) > 0,
      'expected synthesized boundary tangent'
    );
  });

  test('homoclinic seed trim preserves homoc_context metadata', () => {
    const data = {
      points: [
        {
          state: [0, 0],
          param_value: 0.1,
          stability: 'None',
          eigenvalues: []
        },
        {
          state: [1, 1],
          param_value: 0.2,
          stability: 'None',
          eigenvalues: []
        }
      ],
      bifurcations: [0],
      indices: [5, 6],
      homoc_context: {
        base_params: [0.1, 0.2],
        param1_index: 0,
        param2_index: 1,
        fixed_time: 1.0,
        fixed_eps0: 0.01,
        fixed_eps1: 0.02,
        basis: {
          stable_q: [1, 0, 0, 1],
          unstable_q: [1, 0, 0, 1],
          dim: 2,
          nneg: 1,
          npos: 1
        }
      }
    } as any;

    const trimmed = homocInit.discardInitialApproximationPoint(data);
    assert.deepEqual(trimmed.indices, [0]);
    assert.deepEqual(trimmed.homoc_context, data.homoc_context);
  });

  test('serialization normalizes raw eigenvalue arrays', () => {
    assert.deepEqual(serialization.normalizeEigenvalueArray(null), []);

    const normalized = serialization.normalizeEigenvalueArray([
      null,
      { re: '5', im: 6 }
    ]);
    assert.deepEqual(normalized, [
      { re: 0, im: 0 },
      { re: 5, im: 6 }
    ]);
  });

  test('utils handles indices and ordering', () => {
    const branch = {
      data: {
        points: [{}, {}],
        indices: []
      }
    };
    assert.deepEqual(utils.ensureBranchIndices(branch as any), [0, 1]);
    assert.deepEqual(branch.data.indices, [0, 1]);

    const branchMismatch = {
      data: {
        points: [{}, {}],
        indices: [5]
      }
    };
    assert.deepEqual(utils.ensureBranchIndices(branchMismatch as any), [0, 1]);

    assert.deepEqual(utils.buildSortedArrayOrder([2, 0, 1]), [1, 2, 0]);
  });

  test('utils formats numbers and arrays', () => {
    assert.equal(utils.formatNumber(12.3456), '12.346');
    assert.ok(utils.formatNumber(0.0000002).includes('e'));
    assert.ok(utils.formatNumber(20000).includes('e'));

    assert.equal(utils.formatNumberFullPrecision(123.45), '123.45');
    assert.ok(utils.formatNumberFullPrecision(0.0000002).includes('e'));

    assert.equal(utils.formatNumberSafe(undefined), 'NaN');
    assert.equal(utils.formatNumberSafe(Number.NaN), 'NaN');
    assert.equal(utils.formatNumberSafe(5), '5.000');

    assert.equal(utils.formatArray([]), '[]');
    assert.equal(utils.formatArray([1.2345, 2]), '[1.234, 2.000]');
  });

  test('utils summarizes eigenvalues', () => {
    const point = {
      eigenvalues: [
        { re: 1, im: 2 },
        { re: 3, im: 4 },
        { re: 5, im: 6 },
        { re: 7, im: 8 }
      ]
    };
    const summary = utils.summarizeEigenvalues(point as any);
    assert.ok(summary.startsWith('Eigenvalues:'));
    assert.ok(summary.includes('1.000+2.000i'));

    const multipliers = utils.summarizeEigenvalues(point as any, 'limit_cycle');
    assert.ok(multipliers.startsWith('Multipliers:'));
  });

  test('labels format homoclinic and homotopy branch types', () => {
    const homoc = makeContinuationBranch({
      name: 'homoc_branch',
      systemName: 'S',
      parentObject: 'eq_seed'
    }) as any;
    homoc.branchType = 'homoclinic_curve';
    const homotopy = makeContinuationBranch({
      name: 'homotopy_branch',
      systemName: 'S',
      parentObject: 'eq_seed'
    }) as any;
    homotopy.branchType = 'homotopy_saddle_curve';

    assert.equal(labels.formatBranchTypeLabel('flow', homoc), 'homoclinic curve');
    assert.equal(labels.formatBranchTypeLabel('flow', homotopy), 'homotopy saddle curve');
  });

  test('labels homoclinic events with HclinicBifurcationKit codes', () => {
    assert.equal(
      labels.formatBifurcationType('HomoclinicNeutralSaddle'),
      'NNS - Neutral Saddle'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicOrbitFlipStable'),
      'OFS - Orbit Flip Stable'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicThreeLeadingStable'),
      'TLS - Three Leading Stable'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicThreeLeadingUnstable'),
      'TLU - Three Leading Unstable'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicNonCentral'),
      'NCH - Non-Central Homoclinic'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicShilnikovHopf'),
      'SH - Shilnikov-Hopf'
    );
    assert.equal(
      labels.formatBifurcationType('HomoclinicBogdanovTakens'),
      'BT - Bogdanov-Takens'
    );
    assert.equal(labels.formatBifurcationType('None'), 'Unknown');
  });

  test('utils selects branch params', () => {
    const sysName = nextSystemName();
    const sysConfig = makeSystemConfig(sysName, [1, 2]);
    Storage.saveSystem(sysConfig);

    const directBranch = makeContinuationBranch({
      name: 'branch_params',
      systemName: sysName,
      parentObject: 'eq1',
      params: [9, 8]
    });
    const directParams = utils.getBranchParams(sysName, directBranch as any, sysConfig);
    assert.deepEqual(directParams, [9, 8]);
    assert.notStrictEqual(directParams, directBranch.params);

    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq1',
      systemName: sysName,
      parameters: [3, 4]
    } as any);

    const parentParamsBranch = makeContinuationBranch({
      name: 'branch_parent',
      systemName: sysName,
      parentObject: 'eq1',
      params: [1]
    });
    assert.deepEqual(utils.getBranchParams(sysName, parentParamsBranch as any, sysConfig), [3, 4]);

    const fallbackBranch = makeContinuationBranch({
      name: 'branch_fallback',
      systemName: sysName,
      parentObject: 'missing'
    });
    assert.deepEqual(utils.getBranchParams(sysName, fallbackBranch as any, sysConfig), [1, 2]);
  });

  test('format outputs and numeric formatting', () => {
    const output = captureOutput(() => {
      format.printHeader('Title', 'Subtitle');
      format.printDivider();
      format.printField('Value', 123);
      format.printFieldRow([
        { label: 'A', value: 1 },
        { label: 'B', value: 'two' }
      ]);
      format.printArray('Values', [1.2345, 2], 3);
      format.printSuccess('ok');
      format.printError('err');
      format.printWarning('warn');
      format.printInfo('info');
      format.printProgress(1, 4, 'Run');
      format.printProgressComplete('Run');
      format.printBlank();
    });

    assert.ok(output.logs.some(line => line.includes('Title')));
    assert.ok(output.logs.some(line => line.includes('Subtitle')));
    assert.ok(output.logs.some(line => line.includes('Value')));
    assert.ok(output.errors.some(line => line.includes('err')));

    assert.equal(format.formatNum(1.2345, 3), '1.23');
    assert.ok(format.formatNum(0.0000002).includes('e'));
  });

  test('storage saves and loads systems', () => {
    const sysName = nextSystemName();
    const config = makeSystemConfig(sysName);
    Storage.saveSystem(config);

    const systems = Storage.listSystems();
    assert.ok(systems.includes(sysName));
    assert.deepEqual(Storage.loadSystem(sysName), config);
  });

  test('storage loads legacy system file', () => {
    const legacyName = nextSystemName();
    const config = makeSystemConfig(legacyName);
    fs.writeFileSync(path.join(systemsDir, `${legacyName}.json`), JSON.stringify(config, null, 2));

    assert.deepEqual(Storage.loadSystem(legacyName), config);
  });

  test('storage deletes system directories and legacy files', () => {
    const sysName = nextSystemName();
    const config = makeSystemConfig(sysName);
    Storage.saveSystem(config);

    const legacyPath = path.join(systemsDir, `${sysName}.json`);
    fs.writeFileSync(legacyPath, JSON.stringify(config, null, 2));

    Storage.deleteSystem(sysName);
    assert.equal(fs.existsSync(path.join(systemsDir, sysName)), false);
    assert.equal(fs.existsSync(legacyPath), false);
  });

  test('storage saves, loads, and deletes objects', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq1',
      systemName: sysName
    } as any);

    assert.ok(Storage.listObjects(sysName).includes('eq1'));
    assert.equal(Storage.loadObject(sysName, 'eq1').name, 'eq1');

    const objDir = path.join(systemsDir, sysName, 'objects', 'eq1', 'branches');
    fs.mkdirSync(objDir, { recursive: true });
    Storage.deleteObject(sysName, 'eq1');
    assert.equal(fs.existsSync(path.join(systemsDir, sysName, 'objects', 'eq1.json')), false);
    assert.equal(fs.existsSync(path.join(systemsDir, sysName, 'objects', 'eq1')), false);
  });

  test('storage renames objects and updates branch parent', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq_old',
      systemName: sysName
    } as any);

    const branch = makeContinuationBranch({
      name: 'branch1',
      systemName: sysName,
      parentObject: 'eq_old'
    });
    Storage.saveBranch(sysName, 'eq_old', branch as any);

    Storage.renameObject(sysName, 'eq_old', 'eq_new');

    assert.ok(Storage.listObjects(sysName).includes('eq_new'));
    assert.equal(fs.existsSync(path.join(systemsDir, sysName, 'objects', 'eq_old.json')), false);

    const renamedBranch = Storage.loadBranch(sysName, 'eq_new', 'branch1') as any;
    assert.equal(renamedBranch.parentObject, 'eq_new');
  });

  test('storage renames branches and updates limit-cycle provenance', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq_seed',
      systemName: sysName
    } as any);

    const branch = makeContinuationBranch({
      name: 'branch_old',
      systemName: sysName,
      parentObject: 'eq_seed'
    });
    Storage.saveBranch(sysName, 'eq_seed', branch as any);

    Storage.saveObject(sysName, makeLimitCycleObject('lc1', sysName, 'branch_old') as any);

    Storage.renameBranch(sysName, 'eq_seed', 'branch_old', 'branch_new');

    const renamed = Storage.loadBranch(sysName, 'eq_seed', 'branch_new') as any;
    assert.equal(renamed.name, 'branch_new');
    assert.equal(renamed.parentObject, 'eq_seed');
    assert.ok(!Storage.listBranches(sysName, 'eq_seed').includes('branch_old'));

    const updatedLc = Storage.loadObject(sysName, 'lc1') as any;
    assert.equal(updatedLc.origin.equilibriumBranchName, 'branch_new');
  });

  test('storage saves and deletes branches', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq_seed',
      systemName: sysName
    } as any);

    const branch = makeContinuationBranch({
      name: 'branch1',
      systemName: sysName,
      parentObject: 'eq_seed'
    });
    Storage.saveBranch(sysName, 'eq_seed', branch as any);

    assert.ok(Storage.listBranches(sysName, 'eq_seed').includes('branch1'));
    assert.equal((Storage.loadBranch(sysName, 'eq_seed', 'branch1') as any).name, 'branch1');

    Storage.deleteBranch(sysName, 'eq_seed', 'branch1');
    assert.equal(Storage.listBranches(sysName, 'eq_seed').length, 0);
  });

  test('storage purges legacy branch layouts', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    const legacyDir = path.join(systemsDir, sysName, 'branches');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'legacy.json'), '{}');

    const objectsDir = path.join(systemsDir, sysName, 'objects');
    fs.mkdirSync(objectsDir, { recursive: true });
    fs.writeFileSync(
      path.join(objectsDir, 'legacy.json'),
      JSON.stringify(makeContinuationBranch({ name: 'legacy', systemName: sysName, parentObject: 'legacy' }), null, 2)
    );

    const objBranchesDir = path.join(objectsDir, 'seed', 'branches');
    fs.mkdirSync(objBranchesDir, { recursive: true });
    fs.writeFileSync(path.join(objBranchesDir, 'branch.json'), '{}');

    assert.equal(Storage.purgeLegacyBranches(sysName), true);
    assert.equal(fs.existsSync(legacyDir), false);
    assert.equal(fs.existsSync(path.join(objectsDir, 'legacy.json')), false);
    assert.equal(fs.existsSync(objBranchesDir), false);
  });

  test('storage purge legacy branches returns false when clean', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));

    assert.equal(Storage.purgeLegacyBranches(sysName), false);
  });

  test('normal-form provenance persists only on the selected source point', () => {
    const sysName = nextSystemName();
    Storage.saveSystem(makeSystemConfig(sysName));
    Storage.saveObject(sysName, {
      type: 'equilibrium',
      name: 'eq_seed',
      systemName: sysName
    } as any);
    const branch = makeContinuationBranch({
      name: 'branch1',
      systemName: sysName,
      parentObject: 'eq_seed'
    }) as any;
    branch.data.points = [
      { state: [0], param_value: 0, stability: 'Fold' },
      { state: [0.1], param_value: 0.1, stability: 'None' }
    ];
    branch.data.indices = [0, 1];
    const provenance = {
      source_kind: 'Map' as const,
      source_branch_id: 'branch1',
      source_branch_name: 'branch1',
      source_point_index: 0,
      parameter_names: ['p0'],
      parameter_values: [0],
      map_iterations: 1,
      computed_at: new Date(0).toISOString(),
      normal_form: {
        type: 'BranchPoint' as const,
        kind: 'Fold' as const,
        constant_parameter_coefficient: 1,
        linear_parameter_coefficient: 0,
        quadratic_coefficient: -2,
        cubic_coefficient: 0,
        conditioning: {
          eigenvector_pairing: 1,
          right_residual: 0,
          left_residual: 0,
          homological_residual: 0
        }
      }
    };

    normalForms.persistSourcePointNormalForm(sysName, branch, 0, provenance);
    const stored = Storage.loadBranch(sysName, 'eq_seed', 'branch1') as any;
    assert.equal(stored.data.points[0].normal_form.source_branch_id, 'branch1');
    assert.equal(stored.data.points[1].normal_form, undefined);
    assert.equal(stored.data.normal_form_provenance, undefined);
  });

  test('periodic branch-point predictor amplitude preserves branch orientation', () => {
    assert.equal(normalForms.periodicBranchPointAmplitude(-0.05), -0.05);
    assert.equal(normalForms.periodicBranchPointAmplitude(0.05), 0.05);
    assert.throws(
      () => normalForms.periodicBranchPointAmplitude(0),
      /finite and nonzero/
    );
    assert.throws(
      () => normalForms.periodicBranchPointAmplitude(Number.NaN),
      /finite and nonzero/
    );
  });

  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }

  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });

  if (failures > 0) {
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error('FAIL test runner crashed');
  console.error(error);
  process.exitCode = 1;
});
