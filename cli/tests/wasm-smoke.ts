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
  'WasmEqManifold1DExtensionRunner',
  'WasmEqManifold2DRunner',
  'WasmCycleManifold2DRunner',
  'WasmManifold2DExtensionRunner',
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

const storedBranch = manifoldBranches[0];
const storedPointCount = storedBranch.points.length;
const manifoldExtensionRunner = new wasm.WasmEqManifold1DExtensionRunner(
  ['x'],
  new Float64Array(),
  [],
  ['x'],
  'flow',
  1,
  storedBranch,
  {
    stability: 'Unstable',
    direction: storedBranch.branch_type.direction,
    eig_index: 0,
    eps: 1e-4,
    target_arclength: 0.005,
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
assert.equal(manifoldExtensionRunner.get_progress().done, false);
while (!manifoldExtensionRunner.get_progress().done) {
  manifoldExtensionRunner.run_steps(10);
}
const extendedManifold = manifoldExtensionRunner.get_result();
assert.ok(extendedManifold.points.length > storedPointCount);
assert.equal(extendedManifold.manifold_geometry.solver_diagnostics.extension_count, 1);

const timeCappedExtensionRunner = new wasm.WasmEqManifold1DExtensionRunner(
  ['x'],
  new Float64Array(),
  [],
  ['x'],
  'flow',
  1,
  storedBranch,
  {
    stability: 'Unstable',
    direction: storedBranch.branch_type.direction,
    eig_index: 0,
    eps: 1e-4,
    target_arclength: 1,
    integration_dt: 0.1,
    caps: {
      max_steps: 100,
      max_points: 100,
      max_rings: 1,
      max_vertices: 1,
      max_time: 0.15,
    },
  },
  new Float64Array([0])
);
while (!timeCappedExtensionRunner.get_progress().done) {
  timeCappedExtensionRunner.run_steps(1);
}
const timeCappedManifold = timeCappedExtensionRunner.get_result();
assert.equal(timeCappedManifold.manifold_geometry.solver_diagnostics.target_reached, false);
assert.equal(timeCappedManifold.manifold_geometry.solver_diagnostics.termination_reason, 'max_time');

const cycleNtst = 8;
const cycleNcol = 2;
const cycleState: number[] = [];
for (let interval = 0; interval < cycleNtst; interval += 1) {
  const theta = interval * Math.PI * 2 / cycleNtst;
  cycleState.push(Math.cos(theta), Math.sin(theta), 0);
}
for (let interval = 0; interval < cycleNtst; interval += 1) {
  for (let stage = 0; stage < cycleNcol; stage += 1) {
    const fraction = (stage + 1) / (cycleNcol + 1);
    const theta = (interval + fraction) * Math.PI * 2 / cycleNtst;
    cycleState.push(Math.cos(theta), Math.sin(theta), 0);
  }
}
cycleState.push(Math.PI * 2);

const hkoRunner = new wasm.WasmCycleManifold2DRunner(
  ['-y', 'x', 'lambda*z'],
  new Float64Array([0.2]),
  ['lambda'],
  ['x', 'y', 'z'],
  'flow',
  new Float64Array(cycleState),
  cycleNtst,
  cycleNcol,
  [
    { re: Math.exp(0.2 * Math.PI * 2), im: 0 },
    { re: 1, im: 0 },
  ],
  {
    stability: 'Unstable',
    direction: 'Plus',
    algorithm: 'IsochronFibers',
    floquet_index: 0,
    initial_radius: 1e-3,
    leaf_delta: 5e-3,
    delta_min: 5e-4,
    ring_points: 8,
    min_spacing: 1e-3,
    max_spacing: 1e-2,
    alpha_min: 0.3,
    alpha_max: 0.4,
    delta_alpha_min: 0.1,
    delta_alpha_max: 1,
    integration_dt: 2e-2,
    target_arclength: 1e-2,
    ntst: cycleNtst,
    ncol: cycleNcol,
    caps: {
      max_steps: 100,
      max_points: 1000,
      max_rings: 6,
      max_vertices: 256,
      max_time: 20,
    },
  }
);
const hkoBranch = hkoRunner.get_result();
assert.equal(hkoBranch.branch_type.method, 'hko_fundamental_segment_bvp');
assert.equal(hkoBranch.manifold_geometry.type, 'Surface');
assert.equal(hkoBranch.manifold_geometry.solver_diagnostics.termination_reason, 'target_arclength');
assert.match(
  hkoBranch.manifold_geometry.solver_diagnostics.termination_detail,
  /fundamental_solves=/
);

const hkoExtensionSettings = {
  stability: 'Unstable',
  direction: 'Plus',
  algorithm: 'IsochronFibers',
  floquet_index: 0,
  initial_radius: 1e-3,
  leaf_delta: 5e-3,
  delta_min: 5e-4,
  ring_points: 8,
  min_spacing: 1e-3,
  max_spacing: 1e-2,
  alpha_min: 0.3,
  alpha_max: 0.4,
  delta_alpha_min: 0.1,
  delta_alpha_max: 1,
  integration_dt: 2e-2,
  target_arclength: 5e-3,
  ntst: cycleNtst,
  ncol: cycleNcol,
  caps: {
    max_steps: 100,
    max_points: 1000,
    max_rings: 4,
    max_vertices: 256,
    max_time: 20,
  },
};
const hkoExtensionSystem = new wasm.WasmSystem(
  ['-y', 'x', 'lambda*z'],
  new Float64Array([0.2]),
  ['lambda'],
  ['x', 'y', 'z'],
  'rk4',
  'flow'
);
const hkoExtensionProgress: Array<{ done: boolean; rings_computed?: number }> = [];
const progressedHkoBranch = hkoExtensionSystem.extend_manifold_2d_with_progress(
  hkoBranch,
  hkoExtensionSettings,
  (progress: { done: boolean; rings_computed?: number }) => hkoExtensionProgress.push(progress)
);
assert.equal(hkoExtensionProgress[0]?.done, false);
assert.ok(
  hkoExtensionProgress.some(
    (progress) => !progress.done && (progress.rings_computed ?? 0) > 0
  )
);
assert.equal(hkoExtensionProgress.at(-1)?.done, true);
assert.ok(
  progressedHkoBranch.manifold_geometry.ring_offsets.length >
    hkoBranch.manifold_geometry.ring_offsets.length
);

const hkoVerticesBefore = [...hkoBranch.manifold_geometry.vertices_flat];
const hkoTrianglesBefore = [...hkoBranch.manifold_geometry.triangles];
const hkoRingsBefore = [...hkoBranch.manifold_geometry.ring_offsets];
const hkoExtensionRunner = new wasm.WasmManifold2DExtensionRunner(
  ['-y', 'x', 'lambda*z'],
  new Float64Array([0.2]),
  ['lambda'],
  ['x', 'y', 'z'],
  'flow',
  hkoBranch,
  hkoExtensionSettings
);
const extendedHkoBranch = hkoExtensionRunner.get_result();
assert.deepEqual(
  extendedHkoBranch.manifold_geometry.vertices_flat.slice(0, hkoVerticesBefore.length),
  hkoVerticesBefore
);
assert.deepEqual(
  extendedHkoBranch.manifold_geometry.triangles.slice(0, hkoTrianglesBefore.length),
  hkoTrianglesBefore
);
assert.deepEqual(
  extendedHkoBranch.manifold_geometry.ring_offsets.slice(0, hkoRingsBefore.length),
  hkoRingsBefore
);
assert.ok(extendedHkoBranch.manifold_geometry.ring_offsets.length > hkoRingsBefore.length);
assert.equal(extendedHkoBranch.manifold_geometry.solver_diagnostics.extension_count, 1);

const generalizedHopfSystem = new wasm.WasmSystem(
  [
    'mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2',
    'x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2',
  ],
  new Float64Array([0, 0]),
  ['mu', 'beta'],
  ['x', 'y'],
  'rk4',
  'flow'
);
const generalizedHopfSeed = generalizedHopfSystem.init_lpc_from_generalized_hopf(
  new Float64Array([0, 0]),
  new Float64Array([0, 0]),
  'mu',
  'beta',
  0,
  0,
  0,
  -0.1,
  1,
  1,
  -0.2,
  4,
  0.1,
  8,
  2,
  1e-7
);
assert.equal(generalizedHopfSeed.target, 'LimitPointCycle');
assert.ok(generalizedHopfSeed.corrected_residual < 1e-5);
assert.ok(Math.abs(generalizedHopfSeed.param2_value + 0.04) < 5e-3);
const generalizedHopfLpcRunner = new wasm.WasmLPCCurveRunner(
  [
    'mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2',
    'x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2',
  ],
  new Float64Array([0, 0]),
  ['mu', 'beta'],
  ['x', 'y'],
  new Float64Array(generalizedHopfSeed.state),
  generalizedHopfSeed.period,
  'mu',
  generalizedHopfSeed.param1_value,
  'beta',
  generalizedHopfSeed.param2_value,
  8,
  2,
  {
    step_size: 1e-3,
    min_step_size: 1e-7,
    max_step_size: 1e-2,
    max_steps: 4,
    corrector_steps: 10,
    corrector_tolerance: 1e-7,
    step_tolerance: 1e-8,
  },
  true
);
while (!generalizedHopfLpcRunner.get_progress().done) {
  generalizedHopfLpcRunner.run_steps(2);
}
assert.ok(generalizedHopfLpcRunner.get_result().points.length > 1);

const bogdanovTakensSystem = new wasm.WasmSystem(
  ['y', 'mu1+mu2*y+x^2+x*y'],
  new Float64Array([0, 0]),
  ['mu1', 'mu2'],
  ['x', 'y'],
  'rk4',
  'flow'
);
const bogdanovTakensSeeds = bogdanovTakensSystem.init_curves_from_bogdanov_takens(
  new Float64Array([0, 0]),
  'mu1',
  'mu2',
  0,
  0,
  0.05,
  1e-9
);
assert.equal(bogdanovTakensSeeds[0].target, 'Fold');
assert.equal(bogdanovTakensSeeds[1].target, 'Hopf');
assert.ok(bogdanovTakensSeeds[0].corrected_residual < 1e-7);
assert.ok(bogdanovTakensSeeds[1].corrected_residual < 1e-7);
const codim2CurveSettings = {
  step_size: 1e-3,
  min_step_size: 1e-7,
  max_step_size: 1e-2,
  max_steps: 3,
  corrector_steps: 10,
  corrector_tolerance: 1e-8,
  step_tolerance: 1e-8,
};
const bogdanovTakensFoldRunner = new wasm.WasmFoldCurveRunner(
  ['y', 'mu1+mu2*y+x^2+x*y'],
  new Float64Array([0, 0]),
  ['mu1', 'mu2'],
  ['x', 'y'],
  'flow',
  1,
  new Float64Array(bogdanovTakensSeeds[0].state),
  'mu1',
  bogdanovTakensSeeds[0].param1_value,
  'mu2',
  bogdanovTakensSeeds[0].param2_value,
  codim2CurveSettings,
  true
);
while (!bogdanovTakensFoldRunner.get_progress().done) {
  bogdanovTakensFoldRunner.run_steps(2);
}
assert.ok(bogdanovTakensFoldRunner.get_result().points.length > 1);
const bogdanovTakensHopfRunner = new wasm.WasmHopfCurveRunner(
  ['y', 'mu1+mu2*y+x^2+x*y'],
  new Float64Array([0, 0]),
  ['mu1', 'mu2'],
  ['x', 'y'],
  'flow',
  1,
  new Float64Array(bogdanovTakensSeeds[1].state),
  Math.sqrt(bogdanovTakensSeeds[1].auxiliary),
  'mu1',
  bogdanovTakensSeeds[1].param1_value,
  'mu2',
  bogdanovTakensSeeds[1].param2_value,
  codim2CurveSettings,
  true
);
while (!bogdanovTakensHopfRunner.get_progress().done) {
  bogdanovTakensHopfRunner.run_steps(2);
}
assert.ok(bogdanovTakensHopfRunner.get_result().points.length > 1);
const bogdanovTakensHomoclinic = bogdanovTakensSystem.init_homoclinic_from_bogdanov_takens(
  new Float64Array([0, 0]),
  'mu1',
  'mu2',
  0,
  0,
  0.05,
  8,
  2,
  1e-6
);
assert.equal(bogdanovTakensHomoclinic.setup.guess.mesh_states.length, 9);
assert.ok(Number.isFinite(bogdanovTakensHomoclinic.corrected_residual));
const bogdanovTakensHomoclinicRunner = new wasm.WasmHomoclinicRunner(
  ['y', 'mu1+mu2*y+x^2+x*y'],
  new Float64Array([0, 0]),
  ['mu1', 'mu2'],
  ['x', 'y'],
  bogdanovTakensHomoclinic.setup,
  { ...codim2CurveSettings, max_steps: 2 },
  true
);
assert.equal(bogdanovTakensHomoclinicRunner.get_progress().done, false);

console.log('PASS real WASM node boundary smoke');
