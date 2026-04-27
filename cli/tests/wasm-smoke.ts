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

console.log('PASS real WASM node boundary smoke');
