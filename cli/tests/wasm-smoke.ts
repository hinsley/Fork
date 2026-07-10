import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const wasmEntry = path.resolve(__dirname, '../../crates/fork_wasm/pkg/fork_wasm.js');
const requireWasm = createRequire(__filename);

assert.ok(
  fs.existsSync(wasmEntry),
  'Expected generated Node WASM bindings at crates/fork_wasm/pkg/fork_wasm.js. Run `npm run wasm:node` first.'
);

const wasm = requireWasm(wasmEntry);

const requiredExports = [
  'WasmSystem',
  'WasmEquilibriumRunner',
  'WasmContinuationExtensionRunner',
  'WasmCodim1CurveExtensionRunner',
  'WasmFoldCurveRunner',
  'WasmHomoclinicRunner',
  'WasmHomotopySaddleRunner',
  'WasmHopfCurveRunner',
  'WasmLPCCurveRunner',
  'WasmLimitCycleRunner',
  'WasmNSCurveRunner',
  'WasmPDCurveRunner',
  'WasmEqManifold1DRunner',
  'WasmEqManifold2DRunner',
  'WasmCycleManifold2DRunner',
  'WasmIsochroneCurveRunner',
  'WasmLyapunovRunner',
  'WasmCovariantLyapunovRunner',
  'WasmEquilibriumSolverRunner',
];

for (const exportName of requiredExports) {
  assert.equal(typeof wasm[exportName], 'function', `Missing generated WASM export: ${exportName}`);
}

const system = new wasm.WasmSystem(
  ['1'],
  new Float64Array(),
  [],
  ['x'],
  'rk4',
  'flow'
);

system.set_state(new Float64Array([0]));
system.set_t(0);
system.step(0.25);

const state = Array.from(system.get_state() as Float64Array);
assert.equal(state.length, 1);
assert.ok(Math.abs(state[0] - 0.25) < 1e-10, `Expected x ~= 0.25 after one step, got ${state[0]}`);
assert.ok(Math.abs(system.get_t() - 0.25) < 1e-12, `Expected t ~= 0.25, got ${system.get_t()}`);

const manifoldRunner = new wasm.WasmEqManifold1DRunner(
  ['x'],
  new Float64Array(),
  [],
  ['x'],
  'flow',
  1,
  new Float64Array([0]),
  {
    stability: 'Unstable',
    direction: 'Both',
    eig_index: 0,
    eps: 1e-4,
    target_arclength: 0.01,
    integration_dt: 0.1,
    caps: {
      max_steps: 100,
      max_points: 100,
      max_rings: 1,
      max_vertices: 1,
      max_time: 10,
    },
  },
  new Float64Array([0])
);
assert.equal(manifoldRunner.get_progress().done, false);
assert.equal(manifoldRunner.run_steps(1).done, false);
assert.equal(manifoldRunner.run_steps(1).done, true);
const manifoldBranches = manifoldRunner.get_result();
assert.equal(manifoldBranches.length, 2);
for (const branch of manifoldBranches) {
  assert.equal(branch.manifold_geometry.type, 'Curve');
  assert.equal(branch.manifold_geometry.solver_diagnostics.target_reached, true);
}

console.log('PASS real WASM node boundary smoke');
