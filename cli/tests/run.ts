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
  const homocInit = require('../src/continuation/initiate-homoclinic') as typeof import('../src/continuation/initiate-homoclinic');
  const utils = require('../src/continuation/utils') as typeof import('../src/continuation/utils');
  const format = require('../src/format') as typeof import('../src/format');
  const labels = require('../src/labels') as typeof import('../src/labels');
  const chalk = require('chalk');

  chalk.level = 0;

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
