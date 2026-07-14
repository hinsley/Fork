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
  'WasmIsoperiodicCurveRunner',
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

const mapNormalFormSystem = new wasm.WasmSystem(
  ['(-1+mu*a)*x+c*x^3'],
  new Float64Array([0, 0.456, -1.234]),
  ['mu', 'a', 'c'],
  ['x'],
  'discrete',
  'map'
);
const mapPdNormalForm = mapNormalFormSystem.compute_map_normal_form(
  new Float64Array([0]),
  0,
  0,
  1,
  'periodDoubling'
);
assert.equal(mapPdNormalForm.type, 'PeriodDoubling');
assert.ok(Math.abs(mapPdNormalForm.parameter_coefficient - 0.456) < 1e-5);
assert.ok(Math.abs(mapPdNormalForm.cubic_coefficient + 1.234) < 5e-4);
assert.equal(mapPdNormalForm.criticality, 'Subcritical');

const mapFoldNormalFormSystem = new wasm.WasmSystem(
  ['x+mu-x^2'],
  new Float64Array([0]),
  ['mu'],
  ['x'],
  'discrete',
  'map'
);
const mapFoldNormalForm = mapFoldNormalFormSystem.compute_map_normal_form(
  new Float64Array([0]),
  0,
  0,
  1,
  'branchPoint'
);
assert.equal(mapFoldNormalForm.type, 'BranchPoint');
assert.equal(mapFoldNormalForm.kind, 'Fold');
assert.ok(Math.abs(mapFoldNormalForm.quadratic_coefficient + 2) < 2e-5);

const zeroHopfEquations = [
  'beta1+x^2-u^2-v^2',
  'beta2*u-v+x*u-u*(u^2+v^2)',
  'u+beta2*v+x*v-v*(u^2+v^2)',
];
const zeroHopfSystem = new wasm.WasmSystem(
  zeroHopfEquations,
  new Float64Array([0, 0]),
  ['beta1', 'beta2'],
  ['x', 'u', 'v'],
  'tsit5',
  'flow'
);
const zeroHopfNormalForm = zeroHopfSystem.compute_zero_hopf_normal_form(
  new Float64Array([0, 0, 0]), 0, 1, 0, 0, 1
);
assert.equal(zeroHopfNormalForm.has_neimark_sacker, true);
assert.ok(zeroHopfNormalForm.diagnostics.max_eigen_residual < 1e-8);
const zeroHopfSwitch = zeroHopfSystem.switch_from_zero_hopf(
  new Float64Array([0, 0, 0]), 0, 1, 0, 0, 1, 0.02, 0.08, 8, 2, 5e-7
);
assert.equal(zeroHopfSwitch.equilibriumCurveSeeds.length, 4);
assert.ok(zeroHopfSwitch.neimarkSackerSeed);
const zeroHopfFoldSeed = zeroHopfSwitch.equilibriumCurveSeeds.find(
  (seed: any) => seed.target === 'Fold' && seed.perturbation > 0
);
assert.ok(zeroHopfFoldSeed);
const zeroHopfFoldRunner = new wasm.WasmFoldCurveRunner(
  zeroHopfEquations,
  new Float64Array([zeroHopfFoldSeed.param1_value, zeroHopfFoldSeed.param2_value]),
  ['beta1', 'beta2'],
  ['x', 'u', 'v'],
  'flow',
  1,
  new Float64Array(zeroHopfFoldSeed.state),
  'beta1',
  zeroHopfFoldSeed.param1_value,
  'beta2',
  zeroHopfFoldSeed.param2_value,
  {
    step_size: 0.005,
    min_step_size: 1e-7,
    max_step_size: 0.02,
    max_steps: 3,
    corrector_steps: 10,
    corrector_tolerance: 1e-9,
    step_tolerance: 1e-9,
  },
  true
);
while (!zeroHopfFoldRunner.get_progress().done) zeroHopfFoldRunner.run_steps(1);
assert.ok(zeroHopfFoldRunner.get_result().points.length > 1);

const hopfHopfEquations = [
  'beta1*x1-1.7*y1-x1*(x1^2+y1^2)-2*x1*(x2^2+y2^2)',
  '1.7*x1+beta1*y1-y1*(x1^2+y1^2)-2*y1*(x2^2+y2^2)',
  'beta2*x2-y2-3*x2*(x1^2+y1^2)-4*x2*(x2^2+y2^2)',
  'x2+beta2*y2-3*y2*(x1^2+y1^2)-4*y2*(x2^2+y2^2)',
];
const hopfHopfSystem = new wasm.WasmSystem(
  hopfHopfEquations,
  new Float64Array([0, 0]),
  ['beta1', 'beta2'],
  ['x1', 'y1', 'x2', 'y2'],
  'tsit5',
  'flow'
);
const hopfHopfSwitch = hopfHopfSystem.switch_from_hopf_hopf(
  new Float64Array([0, 0, 0, 0]), 0, 1, 0, 0, 1.7, 0.02, 0.07, 8, 2, 5e-7
);
assert.equal(hopfHopfSwitch.normalForm.neimark_sacker_predictors.length, 2);
assert.equal(hopfHopfSwitch.hopfCurveSeeds.length, 4);
assert.equal(hopfHopfSwitch.neimarkSackerSeeds.length, 2);

const periodicNormalFormNtst = 8;
const periodicNormalFormNcol = 2;
const periodicNormalFormNodes = [
  (1 - 1 / Math.sqrt(3)) / 2,
  (1 + 1 / Math.sqrt(3)) / 2,
];
const periodicNormalFormState = (time: number): number[] => [Math.cos(time), Math.sin(time), 0];
const periodicNormalFormMesh = [0, 0.06, 0.15, 0.27, 0.4, 0.56, 0.7, 0.84, 1];
const periodicNormalFormMeshStates = periodicNormalFormMesh.slice(0, -1).map((phase) =>
  periodicNormalFormState(2 * Math.PI * phase)
);
const periodicNormalFormStageStates = periodicNormalFormMesh.slice(0, -1).flatMap((phase, interval) => {
  const intervalWidth = periodicNormalFormMesh[interval + 1] - phase;
  return periodicNormalFormNodes.map((node) =>
    periodicNormalFormState(2 * Math.PI * (phase + node * intervalWidth))
  );
});
const periodicNormalFormPackedState = [
  ...periodicNormalFormMeshStates.flat(),
  ...periodicNormalFormStageStates.flat(),
  2 * Math.PI,
];
const periodicNormalFormSystem = new wasm.WasmSystem(
  [
    '-y+x*(1-x^2-y^2)',
    'x+y*(1-x^2-y^2)',
    'a*mu*z+b*z^2',
  ],
  new Float64Array([0, 0.7, -1.2]),
  ['mu', 'a', 'b'],
  ['x', 'y', 'z'],
  'tsit5',
  'flow'
);
const periodicBranchPointNormalForm = periodicNormalFormSystem.compute_periodic_normal_form_from_packed_state(
  new Float64Array(periodicNormalFormPackedState),
  0,
  0,
  periodicNormalFormNcol,
  new Float64Array(periodicNormalFormMesh),
  'branchPoint'
);
assert.equal(periodicBranchPointNormalForm.type, 'BranchPoint');
assert.equal(periodicBranchPointNormalForm.kind, 'Transcritical');
assert.ok(periodicBranchPointNormalForm.conditioning.return_map_residual < 1e-8);
const periodicBranchSwitch = periodicNormalFormSystem.switch_periodic_branch_from_packed_state(
  new Float64Array(periodicNormalFormPackedState),
  0,
  0,
  periodicNormalFormNcol,
  new Float64Array(periodicNormalFormMesh),
  0.03
);
assert.equal(periodicBranchSwitch.normalForm.kind, 'Transcritical');
assert.ok(Math.abs(periodicBranchSwitch.setup.guess.param_value - 1.2 * 0.03 / 0.7) < 5e-4);
assert.equal(periodicBranchSwitch.setup.guess.requires_fixed_parameter_correction, true);
assert.deepEqual(periodicBranchSwitch.setup.normalized_mesh, periodicNormalFormMesh);

const periodicBpRunner = new wasm.WasmLimitCycleRunner(
  [
    '-y+x*(1-x^2-y^2)',
    'x+y*(1-x^2-y^2)',
    'a*mu*z+b*z^2',
  ],
  new Float64Array([0, 0.7, -1.2]),
  ['mu', 'a', 'b'],
  ['x', 'y', 'z'],
  'flow',
  periodicBranchSwitch.setup,
  'mu',
  {
    step_size: 0.003,
    min_step_size: 1e-7,
    max_step_size: 0.01,
    max_steps: 4,
    corrector_steps: 12,
    corrector_tolerance: 1e-9,
    step_tolerance: 1e-9,
  },
  true
);
while (!periodicBpRunner.get_progress().done) periodicBpRunner.run_steps(1);
const periodicBpResult = periodicBpRunner.get_result_with_report();
assert.ok(periodicBpResult.branch.points.length > 1, 'Expected a continued secondary periodic branch');
assert.deepEqual(periodicBpResult.branch.branch_type.normalized_mesh, periodicNormalFormMesh);

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
// For r' = mu*r + beta*r^3 + r^5, the cycle-fold locus is
// beta = -2*r^2 and mu = r^4.  Validate the corrected cycle instead of the
// normal-form predictor, which need not lie on the nonlinear collocation
// curve before correction.
const generalizedHopfFirstMesh = 8 * 2 * 2;
const generalizedHopfRadiusSquared =
  generalizedHopfSeed.state[generalizedHopfFirstMesh] ** 2 +
  generalizedHopfSeed.state[generalizedHopfFirstMesh + 1] ** 2;
assert.ok(
  Math.abs(generalizedHopfSeed.param2_value + 2 * generalizedHopfRadiusSquared) < 5e-4
);
assert.ok(
  Math.abs(generalizedHopfSeed.param1_value - generalizedHopfRadiusSquared ** 2) < 2e-4
);
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
  new Float64Array(Array.from({ length: 9 }, (_, index) => index / 8)),
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

// Nonlinear NS suspension benchmark.  The Stuart-Landau unit cycle has a
// transverse pair exp((mu-beta^2 +/- i*(0.2+0.1*beta))*T), so the torus
// bifurcation curve is exactly mu=beta^2 and k=cos((0.2+0.1*beta)*T).
// First pass the analytically sampled cycle through the real WASM
// fixed-parameter collocation corrector; the NS runner then receives the
// corrected implicit profile and the discrete Floquet value of k.
const nsNtst = 4;
const nsNcol = 3;
const nsDim = 4;
const nsBeta = 0.3;
const nsMu = nsBeta ** 2;
const nsPeriod = Math.PI * 2;
const nsEquations = [
  '-y+x*(1-x^2-y^2)',
  'x+y*(1-x^2-y^2)',
  '(mu-beta^2)*u-(0.2+0.1*beta)*v-(u^2+v^2)*u',
  '(0.2+0.1*beta)*u+(mu-beta^2)*v-(u^2+v^2)*v',
];
const nsParams = new Float64Array([nsMu, nsBeta]);
const nsParamNames = ['mu', 'beta'];
const nsVarNames = ['x', 'y', 'u', 'v'];
const nsComplexParts = (value: { re: number; im: number } | [number, number]) =>
  Array.isArray(value) ? { re: value[0], im: value[1] } : value;
const nsGaussNodes = [
  (1 - Math.sqrt(3 / 5)) / 2,
  0.5,
  (1 + Math.sqrt(3 / 5)) / 2,
];
const nsCycleState = (angle: number): number[] => [
  Math.cos(angle),
  Math.sin(angle),
  0,
  0,
];
const nsSetup = {
  guess: {
    param_value: nsMu,
    period: nsPeriod,
    mesh_states: Array.from({ length: nsNtst }, (_, mesh) =>
      nsCycleState(nsPeriod * mesh / nsNtst)
    ),
    stage_states: Array.from({ length: nsNtst }, (_, interval) =>
      nsGaussNodes.map((node) => nsCycleState(nsPeriod * (interval + node) / nsNtst))
    ),
    requires_fixed_parameter_correction: true,
  },
  phase_anchor: [1, 0, 0, 0],
  phase_direction: [0, 1, 0, 0],
  mesh_points: nsNtst,
  collocation_degree: nsNcol,
};
const nsSeedRunner = new wasm.WasmLimitCycleRunner(
  nsEquations,
  nsParams,
  nsParamNames,
  nsVarNames,
  'flow',
  nsSetup,
  'mu',
  {
    step_size: 2e-3,
    min_step_size: 1e-7,
    max_step_size: 5e-3,
    max_steps: 0,
    corrector_steps: 12,
    corrector_tolerance: 1e-10,
    step_tolerance: 1e-10,
  },
  true
);
assert.equal(nsSeedRunner.run_steps(1).done, true);
const nsSeedBranch = nsSeedRunner.get_result();
assert.equal(nsSeedBranch.points.length, 1);
const nsCorrectedState = nsSeedBranch.points[0].state as number[];
const nsImplicitCoordinateCount = nsNtst * (nsNcol + 1) * nsDim;
assert.equal(nsCorrectedState.length, nsImplicitCoordinateCount + 1);
const nsCorrectedPeriod = nsCorrectedState.at(-1) as number;
assert.ok(
  Math.abs(nsCorrectedPeriod - nsPeriod) < 2e-3,
  `Corrected NS period mismatch: ${nsCorrectedPeriod}`
);

// An adaptive ordinary-cycle extension must preserve cumulative provenance,
// append only new attempts, and return branch+report atomically.
const nsPriorMesh = [0, 0.1, 0.4, 0.75, 1];
const nsCurrentMesh = Array.from(
  { length: nsNtst + 1 },
  (_, index) => index / nsNtst
);
const nsPriorAdaptation = {
  initial_mesh_points: nsNtst,
  current_mesh_points: nsNtst,
  degree: nsNcol,
  defect_tolerance: 1e-14,
  refinement_budget: 4,
  max_mesh_points: 24,
  initial_normalized_mesh: nsPriorMesh,
  current_normalized_mesh: nsCurrentMesh,
  attempts: [
    {
      sequence: 1,
      kind: 'redistribution',
      old_mesh_points: nsNtst,
      new_mesh_points: nsNtst,
      degree: nsNcol,
      trigger_defect: 0.1,
      tolerance: 1e-14,
      interval_scaled_defects: [0.1, 0.02, 0.03, 0.04],
      old_normalized_mesh: nsPriorMesh,
      new_normalized_mesh: nsCurrentMesh,
    },
  ],
};
const nsExtensionRunner = new wasm.WasmContinuationExtensionRunner(
  nsEquations,
  nsParams,
  nsParamNames,
  nsVarNames,
  'flow',
  1,
  { ...nsSeedBranch, collocation_adaptation: nsPriorAdaptation },
  'mu',
  {
    step_size: 1e-3,
    min_step_size: 1e-7,
    max_step_size: 2e-3,
    max_steps: 1,
    corrector_steps: 10,
    corrector_tolerance: 1e-9,
    step_tolerance: 1e-10,
    collocation_adaptivity: {
      enabled: true,
      redistribution_enabled: false,
      defect_tolerance: 1e-14,
      max_refinements: 4,
      max_mesh_points: 24,
    },
  },
  true
);
while (!nsExtensionRunner.get_progress().done) {
  nsExtensionRunner.run_steps(1);
}
const nsExtensionResult = nsExtensionRunner.get_result_with_report();
assert.ok(nsExtensionResult.collocation_adaptation);
assert.equal(nsExtensionResult.collocation_adaptation.attempts[0].sequence, 1);
assert.ok(
  nsExtensionResult.collocation_adaptation.attempts.length >
    nsPriorAdaptation.attempts.length,
  'Expected the extension to append a new mesh adaptation'
);
assert.equal(
  nsExtensionResult.branch.branch_type.ntst,
  nsExtensionResult.collocation_adaptation.current_mesh_points
);
const nsExtensionStateLength =
  nsExtensionResult.branch.branch_type.ntst *
    (nsExtensionResult.branch.branch_type.ncol + 1) *
    nsDim +
  1;
for (const point of nsExtensionResult.branch.points) {
  assert.equal(point.state.length, nsExtensionStateLength);
}

const nsFloquetSystem = new wasm.WasmSystem(
  nsEquations,
  nsParams,
  nsParamNames,
  nsVarNames,
  'rk4',
  'flow'
);
const nsSeedModes = nsFloquetSystem.compute_limit_cycle_floquet_modes(
  new Float64Array(nsCorrectedState),
  nsNtst,
  nsNcol,
  'mu'
);
const nsSeedSchurModes = nsFloquetSystem.compute_limit_cycle_floquet_modes_with_backend(
  new Float64Array(nsCorrectedState),
  nsNtst,
  nsNcol,
  'mu',
  'periodic_schur'
);
assert.equal(nsSeedSchurModes.backend, 'periodic_schur');
assert.equal(nsSeedSchurModes.multipliers.length, nsSeedModes.multipliers.length);
const nsSeedCritical = (nsSeedModes.multipliers as Array<{ re: number; im: number }>)
  .filter((value) => value.im > 0.05)
  .sort(
    (left, right) =>
      Math.abs(Math.hypot(left.re, left.im) - 1) -
      Math.abs(Math.hypot(right.re, right.im) - 1)
  )[0];
assert.ok(nsSeedCritical, 'Expected a nonreal Floquet multiplier in the corrected NS seed');
assert.ok(Math.abs(Math.hypot(nsSeedCritical.re, nsSeedCritical.im) - 1) < 3e-3);

// NSNS switching must use the refined second unit-pair cosine carried by the
// branch-switch metadata, not whichever complex multiplier appears first.
const nsnsSecondaryCosine = nsSeedCritical.re > 0 ? -0.75 : 0.75;
const nsnsSwitchMetadata = {
  type: 'DoubleNeimarkSacker',
  refined: true,
  candidate: false,
  branch_switches: [
    {
      target: 'NeimarkSacker',
      available: true,
      target_auxiliary: nsnsSecondaryCosine,
    },
  ],
};
const nsnsSwitch = nsnsSwitchMetadata.branch_switches.find(
  (entry) => entry.target === 'NeimarkSacker' && entry.available
);
assert.ok(nsnsSwitch);
assert.ok(Math.abs(nsnsSwitch.target_auxiliary - nsSeedCritical.re) > 0.5);
const nsnsCurveRunner = new wasm.WasmNSCurveRunner(
  nsEquations,
  nsParams,
  nsParamNames,
  nsVarNames,
  new Float64Array(nsCorrectedState.slice(0, -1)),
  nsCorrectedPeriod,
  'mu',
  nsMu,
  'beta',
  nsBeta,
  nsnsSwitch.target_auxiliary,
  nsNtst,
  nsNcol,
  new Float64Array(Array.from({ length: nsNtst + 1 }, (_, index) => index / nsNtst)),
  {
    step_size: 2e-3,
    min_step_size: 1e-7,
    max_step_size: 5e-3,
    max_steps: 0,
    corrector_steps: 10,
    corrector_tolerance: 1e-8,
    step_tolerance: 1e-10,
  },
  true
);
const nsnsCurve = nsnsCurveRunner.get_result();
assert.equal(nsnsCurve.points.length, 1);
assert.equal(nsnsCurve.points[0].auxiliary, nsnsSecondaryCosine);

const nsCurveRunner = new wasm.WasmNSCurveRunner(
  nsEquations,
  nsParams,
  nsParamNames,
  nsVarNames,
  new Float64Array(nsCorrectedState.slice(0, -1)),
  nsCorrectedPeriod,
  'mu',
  nsMu,
  'beta',
  nsBeta,
  nsSeedCritical.re,
  nsNtst,
  nsNcol,
  new Float64Array(Array.from({ length: nsNtst + 1 }, (_, index) => index / nsNtst)),
  {
    step_size: 2e-3,
    min_step_size: 1e-7,
    max_step_size: 5e-3,
    max_steps: 3,
    corrector_steps: 10,
    corrector_tolerance: 1e-8,
    step_tolerance: 1e-10,
  },
  true
);
while (!nsCurveRunner.get_progress().done) {
  nsCurveRunner.run_steps(1);
}
const nsCurveProgress = nsCurveRunner.get_progress();
assert.equal(nsCurveProgress.current_step, 3, 'Expected three accepted NS continuation steps');
const nsCurveResult = nsCurveRunner.get_result_with_report();
const nsCurve = nsCurveResult.branch;
assert.equal(nsCurveResult.collocation_adaptation.current_mesh_points, nsCurve.ntst);
assert.equal(nsCurve.curve_type, 'NeimarkSacker');
assert.equal(nsCurve.points.length, 4);
const nsExplicitCoordinateCount = nsNtst * nsNcol * nsDim + (nsNtst + 1) * nsDim;
for (const point of nsCurve.points) {
  assert.ok(
    Math.abs(point.param1_value - point.param2_value ** 2) < 4e-4,
    `NS locus mismatch: mu=${point.param1_value}, beta=${point.param2_value}`
  );
  assert.equal(point.state.length, nsExplicitCoordinateCount + 1);
  const period = point.state.at(-1) as number;
  const expectedK = Math.cos((0.2 + 0.1 * point.param2_value) * period);
  const multipliers = (point.eigenvalues as Array<
    { re: number; im: number } | [number, number]
  >).map(nsComplexParts);
  const positive = multipliers
    .filter((value) => value.im > 0.05)
    .sort(
      (left, right) =>
        Math.abs(Math.hypot(left.re, left.im) - 1) -
        Math.abs(Math.hypot(right.re, right.im) - 1)
    )[0];
  const negative = multipliers
    .filter((value) => value.im < -0.05)
    .sort(
      (left, right) =>
        Math.abs(Math.hypot(left.re, left.im) - 1) -
        Math.abs(Math.hypot(right.re, right.im) - 1)
    )[0];
  assert.ok(positive && negative, `Expected a complex-conjugate Floquet pair: ${JSON.stringify(multipliers)}`);
  assert.ok(Math.abs(Math.hypot(positive.re, positive.im) - 1) < 4e-3);
  assert.ok(Math.abs(Math.hypot(negative.re, negative.im) - 1) < 4e-3);
  assert.ok(Math.abs(positive.re - negative.re) < 4e-3);
  assert.ok(Math.abs(positive.im + negative.im) < 4e-3);
  assert.ok(Math.abs(point.auxiliary - positive.re) < 4e-3);
  assert.ok(Math.abs(point.auxiliary - expectedK) < 4e-3);
}

const mapNsRunner = new wasm.WasmHopfCurveRunner(
  [
    '(1+p1+p2)*(0.5*x-0.8660254037844386*y)',
    '(1+p1+p2)*(0.8660254037844386*x+0.5*y)',
  ],
  new Float64Array([-0.2, 0.2]),
  ['p1', 'p2'],
  ['x', 'y'],
  'map',
  1,
  new Float64Array([0, 0]),
  0.8660254037844386,
  'p1',
  -0.2,
  'p2',
  0.2,
  {
    step_size: 0.02,
    min_step_size: 1e-7,
    max_step_size: 0.04,
    max_steps: 4,
    corrector_steps: 10,
    corrector_tolerance: 1e-10,
    step_tolerance: 1e-10,
  },
  true
);
while (!mapNsRunner.get_progress().done) {
  mapNsRunner.run_steps(1);
}
const mapNsCurve = mapNsRunner.get_result();
assert.equal(mapNsCurve.curve_type, 'NeimarkSacker');
assert.ok(mapNsCurve.points.length >= 3, 'Expected multiple map NS curve points');
for (const point of mapNsCurve.points) {
  assert.ok(
    Math.abs(point.param1_value + point.param2_value) < 1e-4,
    `Map NS locus mismatch: p1=${point.param1_value}, p2=${point.param2_value}`
  );
  assert.ok(Math.abs(point.auxiliary - 0.5) < 3e-4);
  const multipliers = (point.eigenvalues as Array<
    { re: number; im: number } | [number, number]
  >).map(nsComplexParts);
  assert.equal(multipliers.length, 2);
  assert.ok(
    multipliers.every((value) => Math.abs(Math.hypot(value.re, value.im) - 1) < 1e-4)
  );
}

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

function arithmeticGeometricMean(left: number, right: number): number {
  for (let iteration = 0; iteration < 32; iteration += 1) {
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

function duffingLargeCycleState(ntst: number, ncol: number): number[] {
  assert.equal(ncol, 2, 'Duffing reference fixture uses two Gauss stages');
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
    state.push(...duffingStateAt(period * interval / ntst, amplitude));
  }
  for (let interval = 0; interval < ntst; interval += 1) {
    for (const node of nodes) {
      state.push(...duffingStateAt(period * (interval + node) / ntst, amplitude));
    }
  }
  state.push(period);
  return state;
}

function packHomoclinicSetup(setup: any): number[] {
  const packed = [
    ...setup.guess.mesh_states.flat(),
    ...setup.guess.stage_states.flat(2),
    ...setup.guess.x0,
    setup.guess.param2_value,
  ];
  if (setup.extras.free_time) packed.push(setup.guess.time);
  if (setup.extras.free_eps0) packed.push(setup.guess.eps0);
  if (setup.extras.free_eps1) packed.push(setup.guess.eps1);
  packed.push(...setup.guess.yu, ...setup.guess.ys);
  return packed;
}

function runDuffingHomoclinic(setup: any, params: number[]): any {
  const runner = new wasm.WasmHomoclinicRunner(
    ['y', 'x-x^3+(mu-nu)*y'],
    new Float64Array(params),
    ['mu', 'nu'],
    ['x', 'y'],
    setup,
    {
      step_size: 1e-4,
      min_step_size: 1e-9,
      max_step_size: 1e-3,
      max_steps: 3,
      corrector_steps: 32,
      corrector_tolerance: 1e-8,
      step_tolerance: 1e-8,
    },
    true
  );
  while (!runner.get_progress().done) runner.run_steps(1);
  return runner.get_result();
}

function duffingPointParams(setup: any, point: any): [number, number] {
  const dim = 2;
  const freeScalarCount = Number(setup.extras.free_time)
    + Number(setup.extras.free_eps0)
    + Number(setup.extras.free_eps1);
  const fixedStateCount = 2 * dim + 1 + freeScalarCount
    + setup.guess.yu.length + setup.guess.ys.length;
  const ntst = (point.state.length - fixedStateCount) / (dim * (setup.ncol + 1));
  assert.ok(Number.isInteger(ntst) && ntst > 0, 'Duffing point has an invalid adaptive mesh layout');
  const param2Index = (ntst + 1) * dim + ntst * setup.ncol * dim + dim;
  return [point.param_value, point.state[param2Index]];
}

function assertDuffingHomoclinicBranch(label: string, setup: any, branch: any): void {
  assert.ok(branch.points.length > 1, `${label} must advance beyond the seed point`);
  const accepted = branch.points.slice(1);
  const gaps = accepted.map((point: any) => {
    const [mu, nu] = duffingPointParams(setup, point);
    assert.ok(Number.isFinite(mu) && Number.isFinite(nu));
    return mu - nu;
  });
  assert.ok(
    Math.max(...gaps) - Math.min(...gaps) < 1e-8,
    `${label} left the analytic mu=nu Duffing locus: ${JSON.stringify(gaps)}`
  );
  assert.ok(Math.abs(gaps[0]) < 5e-4, `${label} Duffing locus drift is too large: ${gaps[0]}`);
  assert.ok(
    Math.abs(accepted.at(-1).param_value - accepted[0].param_value) > 5e-5,
    `${label} did not move measurably along the homoclinic locus`
  );
}

const duffingEquations = ['y', 'x-x^3+(mu-nu)*y'];
const duffingParamNames = ['mu', 'nu'];
const duffingVarNames = ['x', 'y'];
const duffingSourceNtst = 32;
const duffingSourceNcol = 2;
const duffingTargetNtst = 8;
const duffingTargetNcol = 2;
const duffingSystem = new wasm.WasmSystem(
  duffingEquations,
  new Float64Array([0, 0]),
  duffingParamNames,
  duffingVarNames,
  'rk4',
  'flow'
);
const duffingMethod1Setup = duffingSystem.init_homoclinic_from_large_cycle(
  new Float64Array(duffingLargeCycleState(duffingSourceNtst, duffingSourceNcol)),
  duffingSourceNtst,
  duffingSourceNcol,
  'mu',
  'nu',
  duffingTargetNtst,
  duffingTargetNcol,
  true,
  false,
  false
);
const duffingMethod1Branch = runDuffingHomoclinic(duffingMethod1Setup, [0, 0]);
assertDuffingHomoclinicBranch('Method 1', duffingMethod1Setup, duffingMethod1Branch);

const duffingSourcePoint = duffingMethod1Branch.points[1];
const duffingSourceParams = duffingPointParams(duffingMethod1Setup, duffingSourcePoint);
const duffingSourceBranchType = duffingMethod1Branch.branch_type;
assert.equal(duffingSourceBranchType.type, 'HomoclinicCurve');
assert.equal(duffingSourceBranchType.discretization.type, 'collocation');
assert.equal(
  duffingSourceBranchType.normalized_mesh.length,
  duffingSourceBranchType.ntst + 1
);
const duffingTargetMesh = Array.from(
  { length: duffingTargetNtst + 1 },
  (_, index) => index / duffingTargetNtst
);
const duffingRestartSystem = new wasm.WasmSystem(
  duffingEquations,
  new Float64Array(duffingSourceParams),
  duffingParamNames,
  duffingVarNames,
  'rk4',
  'flow'
);
const duffingMethod2Setup = duffingRestartSystem.init_homoclinic_from_homoclinic_on_mesh(
  new Float64Array(duffingSourcePoint.state),
  duffingSourceBranchType.ncol,
  new Float64Array(duffingSourceBranchType.normalized_mesh),
  duffingSourceBranchType.free_time,
  duffingSourceBranchType.free_eps0,
  duffingSourceBranchType.free_eps1,
  duffingMethod1Setup.guess.time,
  duffingMethod1Setup.guess.eps0,
  duffingMethod1Setup.guess.eps1,
  'mu',
  'nu',
  duffingTargetNcol,
  new Float64Array(duffingTargetMesh),
  true,
  false,
  false
);
const duffingMethod2Branch = runDuffingHomoclinic(duffingMethod2Setup, duffingSourceParams);
assertDuffingHomoclinicBranch('Method 2', duffingMethod2Setup, duffingMethod2Branch);

const duffingStageDSetup = duffingRestartSystem.init_homoclinic_from_homoclinic_on_mesh(
  new Float64Array(duffingSourcePoint.state),
  duffingSourceBranchType.ncol,
  new Float64Array(duffingSourceBranchType.normalized_mesh),
  duffingSourceBranchType.free_time,
  duffingSourceBranchType.free_eps0,
  duffingSourceBranchType.free_eps1,
  duffingMethod1Setup.guess.time,
  duffingMethod1Setup.guess.eps0,
  duffingMethod1Setup.guess.eps1,
  'mu',
  'nu',
  duffingTargetNcol,
  new Float64Array(duffingTargetMesh),
  true,
  false,
  true
);
const duffingMethod4Setup = duffingRestartSystem.init_homoclinic_from_homotopy_saddle(
  new Float64Array(packHomoclinicSetup(duffingStageDSetup)),
  duffingTargetNtst,
  duffingTargetNcol,
  'mu',
  'nu',
  duffingTargetNtst,
  duffingTargetNcol,
  true,
  false,
  false
);
const duffingMethod4Branch = runDuffingHomoclinic(duffingMethod4Setup, duffingSourceParams);
assertDuffingHomoclinicBranch('Method 4', duffingMethod4Setup, duffingMethod4Branch);

console.log('PASS real WASM node boundary smoke');
