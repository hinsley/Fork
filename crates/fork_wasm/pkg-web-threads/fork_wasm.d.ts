/* tslint:disable */
/* eslint-disable */
export function init_fork_thread_pool(): Promise<any>;
export function initThreadPool(num_threads: number): Promise<any>;
export function wbg_rayon_start_worker(receiver: number): void;
export class WasmCodim1CurveExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, branch_val: any, _parameter_name: string, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmContinuationExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  get_linear_solver_stats(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, branch_val: any, parameter_name: string, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmCovariantLyapunovRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, initial_state: Float64Array, initial_time: number, dt: number, qr_stride: number, window_steps: number, forward_transient: number, backward_transient: number);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmCycleManifold2DRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, cycle_state: Float64Array, ntst: number, ncol: number, floquet_multipliers_val: any, settings_val: any);
  is_done(): boolean;
  run_steps(_batch_size: number): any;
}
export class WasmEqManifold1DExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, branch_val: any, settings_val: any, periods: Float64Array);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmEqManifold1DGroupExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, branches_val: any, settings_val: any, periods: Float64Array);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmEqManifold1DRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, equilibrium_state: Float64Array, settings_val: any, periods: Float64Array);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmEqManifold2DRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, equilibrium_state: Float64Array, settings_val: any);
  is_done(): boolean;
  run_steps(_batch_size: number): any;
}
/**
 * WASM-exported runner for stepped equilibrium continuation.
 * Allows progress reporting by running batches of steps at a time.
 */
export class WasmEquilibriumRunner {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the final branch result.
   */
  get_result(): any;
  /**
   * Get progress information.
   */
  get_progress(): any;
  /**
   * Create a new stepped equilibrium continuation runner.
   */
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, equilibrium_state: Float64Array, parameter_name: string, settings_val: any, forward: boolean, periods: Float64Array);
  /**
   * Check if the continuation is complete.
   */
  is_done(): boolean;
  /**
   * Run a batch of continuation steps and return progress.
   */
  run_steps(batch_size: number): any;
}
export class WasmEquilibriumSolverRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  set_deflation(flattened_roots: Float64Array, exponent: number, shift: number): void;
  set_deflation_targets(flattened_roots: Float64Array, exponents: Float64Array, shifts: Float64Array): void;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, initial_guess: Float64Array, max_steps: number, damping: number, periods: Float64Array);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmExpansionEntropyRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, minimums: Float64Array, maximums: Float64Array, resolution: Uint32Array, initial_time: number, steps: number, dt: number, checkpoint_stride: number, stabilization_stride: number);
  cancel(): void;
  advance(): any;
  run_steps(_batch_size: number): any;
}
export class WasmFoldCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, fold_state: Float64Array, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmForcedResponseRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, system_type: string, period_expression: string, iteration_period: number, phase: number, response_multiple: number, steps_per_forcing_period: number, initial_state: Float64Array, parameter_name: string, settings_value: any, forward: boolean, periods: Float64Array);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHeteroclinicRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], setup_val: any, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHeteroclinicShootingRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], setup_val: any, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHomoclinicRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], setup_val: any, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHomoclinicShootingRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], setup_val: any, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHomotopySaddleRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], setup_val: any, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(_batch_size: number): any;
}
export class WasmHopfCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, map_iterations: number, hopf_state: Float64Array, hopf_omega: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmIsoperiodicCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, normalized_mesh: Float64Array, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmLPCCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, normalized_mesh: Float64Array, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmLimitCycleRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  get_linear_solver_stats(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, setup_val: any, parameter_name: string, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmLyapunovRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, initial_state: Float64Array, initial_time: number, steps: number, dt: number, qr_stride: number);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmManifold2DExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, branch_val: any, settings_val: any);
  is_done(): boolean;
  run_steps(_batch_size: number): any;
}
export class WasmNSCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, initial_k: number, ntst: number, ncol: number, normalized_mesh: Float64Array, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmPDCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  get_adaptation_report(): any;
  get_result_with_report(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, normalized_mesh: Float64Array, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmSystem {
  free(): void;
  [Symbol.dispose](): void;
  solve_equilibrium(initial_guess: Float64Array, max_steps: number, damping: number, map_iterations: number): any;
  solve_equilibrium_deflated(initial_guess: Float64Array, max_steps: number, damping: number, map_iterations: number, flattened_roots: Float64Array, exponent: number, shift: number): any;
  solve_equilibrium_deflated_targets(initial_guess: Float64Array, max_steps: number, damping: number, map_iterations: number, flattened_roots: Float64Array, exponents: Float64Array, shifts: Float64Array): any;
  compute_event_series_from_orbit(request_val: any): any;
  compute_event_series_from_samples(request_val: any): any;
  /**
   * Initializes a period-doubled limit cycle from a period-doubling bifurcation.
   * Takes the LC state at the PD point and constructs a doubled-period initial guess
   * by computing the PD eigenvector and perturbing the original orbit.
   */
  init_lc_from_pd(lc_state: Float64Array, param_name: string, param_value: number, ntst: number, ncol: number, amplitude: number): any;
  /**
   * Continues an NS (Neimark-Sacker) bifurcation curve in two-parameter space.
   */
  continue_ns_curve(lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, initial_k: number, ntst: number, ncol: number, settings_val: any, forward: boolean): any;
  /**
   * Continues a PD (Period-Doubling) bifurcation curve in two-parameter space.
   */
  continue_pd_curve(lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, settings_val: any, forward: boolean): any;
  /**
   * Initializes a limit cycle guess from a Hopf bifurcation point.
   * Returns the LimitCycleSetup as a serialized JsValue.
   */
  init_lc_from_hopf(hopf_state: Float64Array, parameter_name: string, param_value: number, amplitude: number, ntst: number, ncol: number): any;
  /**
   * Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
   *
   * # Arguments
   * * `lc_state` - Flattened LC collocation state at the LPC point
   * * `period` - Period at the LPC point
   * * `param1_name` - Name of first active parameter
   * * `param1_value` - Value of first parameter at LPC point
   * * `param2_name` - Name of second active parameter
   * * `param2_value` - Value of second parameter at LPC point
   * * `ntst` - Number of mesh intervals in collocation
   * * `ncol` - Collocation degree
   * * `settings_val` - Continuation settings as JsValue
   * * `forward` - Direction of continuation
   */
  continue_lpc_curve(lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, settings_val: any, forward: boolean): any;
  /**
   * Initializes a limit cycle guess from a computed orbit.
   * The orbit should have converged to a stable limit cycle.
   * Returns the LimitCycleSetup as a serialized JsValue.
   */
  init_lc_from_orbit(orbit_times: Float64Array, orbit_states_flat: Float64Array, param_value: number, ntst: number, ncol: number, tolerance: number): any;
  /**
   * Continues a fold (saddle-node) bifurcation curve in two-parameter space.
   *
   * # Arguments
   * * `fold_state` - State vector at the fold bifurcation point
   * * `param1_name` - Name of first active parameter
   * * `param1_value` - Value of first parameter at fold point
   * * `param2_name` - Name of second active parameter
   * * `param2_value` - Value of second parameter at fold point
   * * `settings_val` - Continuation settings (step size, max steps, etc.)
   * * `forward` - Direction of continuation
   *
   * # Returns
   * A `Codim1CurveBranch` containing the fold curve and detected codim-2 bifurcations
   */
  continue_fold_curve(fold_state: Float64Array, param1_name: string, param1_value: number, param2_name: string, param2_value: number, map_iterations: number, settings_val: any, forward: boolean): any;
  /**
   * Continues a Hopf bifurcation curve in two-parameter space.
   *
   * # Arguments
   * * `hopf_state` - State vector at the Hopf bifurcation point
   * * `hopf_omega` - Hopf frequency (imaginary part of critical eigenvalue)
   * * `param1_name` - Name of first active parameter
   * * `param1_value` - Value of first parameter at Hopf point
   * * `param2_name` - Name of second active parameter
   * * `param2_value` - Value of second parameter at Hopf point
   * * `settings_val` - Continuation settings
   * * `forward` - Direction of continuation
   *
   * # Returns
   * A `Codim1CurveBranch` containing the Hopf curve and detected codim-2 bifurcations
   */
  continue_hopf_curve(hopf_state: Float64Array, hopf_omega: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, map_iterations: number, settings_val: any, forward: boolean): any;
  extend_continuation(branch_val: any, parameter_name: string, map_iterations: number, settings_val: any, forward: boolean): any;
  compute_continuation(equilibrium_state: Float64Array, parameter_name: string, map_iterations: number, settings_val: any, forward: boolean): any;
  compute_eq_manifold_1d(equilibrium_state: Float64Array, map_iterations: number, settings_val: any): any;
  compute_eq_manifold_2d(equilibrium_state: Float64Array, settings_val: any): any;
  /**
   * Initializes a period-doubled map cycle seed from a period-doubling bifurcation.
   * Takes the cycle state at the PD point and returns a perturbed seed for the doubled cycle.
   */
  init_map_cycle_from_pd(pd_state: Float64Array, param_name: string, param_value: number, map_iterations: number, amplitude: number): any;
  init_lc_from_pd_on_mesh(lc_state: Float64Array, param_name: string, param_value: number, ncol: number, normalized_mesh: Float64Array, amplitude: number): any;
  compute_cycle_manifold_2d(cycle_state: Float64Array, ntst: number, ncol: number, floquet_multipliers_val: any, settings_val: any): any;
  /**
   * Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
   *
   * # Arguments
   * * `lc_state` - Flattened LC collocation state at the LPC point
   * * `period` - Period at the LPC point
   * * `param1_name` - Name of first active parameter
   * * `param1_value` - Value of first parameter at LPC point
   * * `param2_name` - Name of second active parameter
   * * `param2_value` - Value of second parameter at LPC point
   * * `ntst` - Number of mesh intervals in collocation
   * * `ncol` - Collocation degree
   * * `settings_val` - Continuation settings as JsValue
   * * `forward` - Direction of continuation
   */
  continue_isoperiodic_curve(lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, settings_val: any, forward: boolean): any;
  /**
   * Compute equilibrium continuation with progress reporting capability.
   * Returns a serialized StepResult after running the specified number of steps.
   *
   * This is a convenience method that runs the full continuation but returns
   * progress information. For true stepped execution, use WasmEquilibriumRunner.
   */
  compute_continuation_stepped(equilibrium_state: Float64Array, parameter_name: string, map_iterations: number, settings_val: any, forward: boolean, _batch_size: number): any;
  init_heteroclinic_from_orbit(seed_val: any, parameter_name: string, param2_name: string, target_ntst: number, target_ncol: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  init_lpc_from_generalized_hopf(gh_state: Float64Array, neighbor_state: Float64Array, param1_name: string, param2_name: string, gh_param1: number, gh_param2: number, neighbor_param1: number, neighbor_param2: number, gh_kappa: number, neighbor_kappa: number, neighbor_l1: number, second_lyapunov: number, amplitude: number, ntst: number, ncol: number, tolerance: number): any;
  compute_equilibrium_eigenvalues(state: Float64Array, parameter_name: string, map_iterations: number, param_value: number): any;
  compute_homoclinic_continuation(setup_val: any, settings_val: any, forward: boolean): any;
  init_homoclinic_from_homoclinic(point_state: Float64Array, source_ntst: number, source_ncol: number, source_free_time: boolean, source_free_eps0: boolean, source_free_eps1: boolean, source_fixed_time: number, source_fixed_eps0: number, source_fixed_eps1: number, parameter_name: string, param2_name: string, target_ntst: number, target_ncol: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  /**
   * Computes limit cycle continuation from an initial setup (from init_lc_from_hopf).
   */
  compute_limit_cycle_continuation(setup_val: any, parameter_name: string, settings_val: any, forward: boolean): any;
  extend_heteroclinic_continuation(branch_val: any, settings_val: any, extend_forward: boolean): any;
  /**
   * Extend a persisted 2D manifold while reporting each accepted new ring.
   */
  extend_manifold_2d_with_progress(branch_val: any, settings_val: any, progress_callback: Function): any;
  init_curves_from_bogdanov_takens(state: Float64Array, param1_name: string, param2_name: string, param1_value: number, param2_value: number, perturbation: number, tolerance: number): any;
  init_homoclinic_from_large_cycle(lc_state: Float64Array, source_ntst: number, source_ncol: number, parameter_name: string, param2_name: string, target_ntst: number, target_ncol: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  compute_heteroclinic_continuation(setup_val: any, settings_val: any, forward: boolean): any;
  compute_limit_cycle_floquet_modes(cycle_state: Float64Array, ntst: number, ncol: number, parameter_name: string): any;
  compute_eq_manifold_2d_with_progress(equilibrium_state: Float64Array, settings_val: any, progress_callback: Function): any;
  compute_homotopy_saddle_continuation(setup_val: any, settings_val: any, forward: boolean): any;
  init_homoclinic_from_bogdanov_takens(state: Float64Array, param1_name: string, param2_name: string, param1_value: number, param2_value: number, perturbation: number, ntst: number, ncol: number, tolerance: number): any;
  init_homoclinic_from_homotopy_saddle(stage_d_state: Float64Array, source_ntst: number, source_ncol: number, parameter_name: string, param2_name: string, target_ntst: number, target_ncol: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  init_homotopy_saddle_from_equilibrium(equilibrium_state: Float64Array, parameter_name: string, param2_name: string, ntst: number, ncol: number, eps0: number, eps1: number, time: number, eps1_tol: number): any;
  compute_cycle_manifold_2d_with_progress(cycle_state: Float64Array, ntst: number, ncol: number, floquet_multipliers_val: any, settings_val: any, progress_callback: Function): any;
  /**
   * Mesh-aware Method 2 initializer for restarting an adaptive homoclinic
   * collocation point without first pretending its source mesh is uniform.
   */
  init_homoclinic_from_homoclinic_on_mesh(point_state: Float64Array, source_ncol: number, source_normalized_mesh: Float64Array, source_free_time: boolean, source_free_eps0: boolean, source_free_eps1: boolean, source_fixed_time: number, source_fixed_eps0: number, source_fixed_eps1: number, parameter_name: string, param2_name: string, target_ncol: number, target_normalized_mesh: Float64Array, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  /**
   * Nonuniform-mesh counterpart of `init_homoclinic_from_large_cycle`.
   * `source_normalized_mesh` contains the source LC interval boundaries;
   * source NTST is inferred from its length.
   */
  init_homoclinic_from_large_cycle_on_mesh(lc_state: Float64Array, source_ncol: number, source_normalized_mesh: Float64Array, parameter_name: string, param2_name: string, target_ntst: number, target_ncol: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  compute_limit_cycle_floquet_modes_on_mesh(cycle_state: Float64Array, ncol: number, normalized_mesh: Float64Array, parameter_name: string): any;
  compute_limit_cycle_floquet_modes_with_backend(cycle_state: Float64Array, ntst: number, ncol: number, parameter_name: string, backend: string): any;
  compute_limit_cycle_floquet_modes_on_mesh_with_backend(cycle_state: Float64Array, ncol: number, normalized_mesh: Float64Array, parameter_name: string, backend: string): any;
  /**
   * Compute local normal-form coefficients at a refined map bifurcation.
   *
   * `normal_form_type` accepts `branchPoint`, `periodDoubling`, or
   * `neimarkSacker`. The returned object is tagged by its `type` field and
   * includes coefficient and conditioning diagnostics.
   */
  compute_map_normal_form(state: Float64Array, param_index: number, param_value: number, map_iterations: number, normal_form_type: string): any;
  /**
   * Produce corrected Hopf-Hopf switches to both orientations of both Hopf
   * curves and to both periodic-orbit Neimark-Sacker curves.
   */
  switch_from_hopf_hopf(state: Float64Array, param1_index: number, param2_index: number, param1_value: number, param2_value: number, source_frequency: number, curve_perturbation: number, cycle_amplitude: number, ntst: number, ncol: number, tolerance: number): any;
  /**
   * Produce corrected Zero-Hopf switches to both fold/Hopf orientations
   * and, when the coefficient sign condition permits it, the periodic-orbit
   * Neimark-Sacker curve.
   */
  switch_from_zero_hopf(state: Float64Array, param1_index: number, param2_index: number, param1_value: number, param2_value: number, frequency: number, curve_perturbation: number, cycle_amplitude: number, ntst: number, ncol: number, tolerance: number): any;
  /**
   * Compute detailed, serializable nonresonant Hopf-Hopf coefficients and
   * both NS unfolding predictors.
   */
  compute_hopf_hopf_normal_form(state: Float64Array, param1_index: number, param2_index: number, param1_value: number, param2_value: number, source_frequency: number): any;
  /**
   * Compute detailed, serializable Zero-Hopf coefficients and numerical
   * conditioning diagnostics at a refined equilibrium codimension-two
   * point.
   */
  compute_zero_hopf_normal_form(state: Float64Array, param1_index: number, param2_index: number, param1_value: number, param2_value: number, frequency: number): any;
  /**
   * Construct a collocation predictor on the periodic branch emanating
   * from a generic periodic branch point.
   */
  switch_periodic_orbit_branch(setup_val: any, param_index: number, normal_form_val: any, amplitude: number): any;
  /**
   * Compute a Poincare-return-map normal form at a corrected limit cycle.
   *
   * The returned tagged object contains PD, NS, or generic `+1`
   * coefficients and residual/conditioning diagnostics.  A `+1` form is
   * explicitly classified as either an LPC or a generic periodic branch
   * point.
   */
  compute_periodic_orbit_normal_form(setup_val: any, param_index: number, normal_form_type: string): any;
  init_homoclinic_shooting_from_shooting(point_state: Float64Array, source_intervals: number, source_free_time: boolean, source_free_eps0: boolean, source_free_eps1: boolean, source_fixed_time: number, source_fixed_eps0: number, source_fixed_eps1: number, param1_name: string, param2_name: string, target_intervals: number, integration_steps_per_segment: number, free_time: boolean, free_eps0: boolean, free_eps1: boolean): any;
  /**
   * Blocking standard-shooting continuation, retained for CLI compatibility.
   */
  compute_homoclinic_shooting_continuation(setup_val: any, settings_val: any, forward: boolean): any;
  /**
   * Convert any existing collocation homoclinic seed (including large-cycle
   * and BT predictors) into standard single/multiple-shooting nodes.
   */
  init_homoclinic_shooting_from_collocation(setup_val: any, intervals: number, integration_steps_per_segment: number): any;
  /**
   * Compute the generic `+1` normal form and construct its secondary-cycle
   * predictor directly from a saved branch point.
   */
  switch_periodic_branch_from_packed_state(packed_state: Float64Array, param_index: number, param_value: number, collocation_degree: number, normalized_mesh: Float64Array, amplitude: number): any;
  /**
   * Compute a periodic-orbit normal form directly from the full persisted
   * collocation state.  The exact saved mesh is mandatory; the setup and
   * phase direction are reconstructed inside Rust.
   */
  compute_periodic_normal_form_from_packed_state(packed_state: Float64Array, param_index: number, param_value: number, collocation_degree: number, normalized_mesh: Float64Array, normal_form_type: string): any;
  /**
   * Blocking entry point retained for the Node CLI.
   */
  compute_heteroclinic_shooting_continuation(setup_val: any, settings_val: any, forward: boolean): any;
  init_heteroclinic_shooting_from_collocation(setup_val: any, intervals: number, integration_steps_per_segment: number): any;
  solve_forced_response(period_expression: string, iteration_period: number, phase: number, response_multiple: number, steps_per_forcing_period: number, initial_guess: Float64Array, max_steps: number, damping: number, tolerance: number): any;
  validate_periodic_forcing(period_expression: string, iteration_period: number): number;
  advance_forced_response_seed(period_expression: string, iteration_period: number, phase: number, steps_per_forcing_period: number, initial_context: number, initial_state: Float64Array): any;
  set_periods(periods: Float64Array): void;
  uses_context(): boolean;
  context_symbol(): string | undefined;
  compute_isocline(expression: string, level: number, axis_indices: Uint32Array, axis_mins: Float64Array, axis_maxs: Float64Array, axis_samples: Uint32Array, frozen_state: Float64Array, var_names: string[], param_names: string[]): any;
  compute_jacobian(): Float64Array;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, system_type: string);
  step(dt: number): void;
  get_t(): number;
  set_t(t: number): void;
  get_state(): Float64Array;
  set_state(state: Float64Array): void;
  compute_lyapunov_exponents(start_state: Float64Array, start_time: number, steps: number, dt: number, qr_stride: number): Float64Array;
  compute_covariant_lyapunov_vectors(start_state: Float64Array, start_time: number, window_steps: number, dt: number, qr_stride: number, forward_transient: number, backward_transient: number): any;
}
export class WasmTransferOperatorRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], solver_name: string, system_type: string, minimums: Float64Array, maximums: Float64Array, resolution: Uint32Array, starting_point: Float64Array, samples_per_cell: number, iterations: number, max_stationary_iterations: number, tolerance: number, time_step: number);
  run_steps(_batch_size: number): any;
}
export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  numThreads(): number;
  build(): void;
  receiver(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly __wbg_wasmequilibriumrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmequilibriumsolverrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmexpansionentropyrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmfoldcurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmhopfcurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmisoperiodiccurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlpccurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmmanifold2dextensionrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmnscurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmpdcurverunner_free: (a: number, b: number) => void;
  readonly wasmequilibriumrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmequilibriumrunner_get_result: (a: number) => [number, number, number];
  readonly wasmequilibriumrunner_is_done: (a: number) => number;
  readonly wasmequilibriumrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: any, q: number, r: number, s: number) => [number, number, number];
  readonly wasmequilibriumrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_get_result: (a: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_is_done: (a: number) => number;
  readonly wasmequilibriumsolverrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_set_deflation: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly wasmequilibriumsolverrunner_set_deflation_targets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
  readonly wasmexpansionentropyrunner_advance: (a: number) => [number, number, number];
  readonly wasmexpansionentropyrunner_cancel: (a: number) => [number, number];
  readonly wasmexpansionentropyrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmexpansionentropyrunner_get_result: (a: number) => [number, number, number];
  readonly wasmexpansionentropyrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => [number, number, number];
  readonly wasmexpansionentropyrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmfoldcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmfoldcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmfoldcurverunner_is_done: (a: number) => number;
  readonly wasmfoldcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: any, u: number) => [number, number, number];
  readonly wasmfoldcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmhopfcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmhopfcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmhopfcurverunner_is_done: (a: number) => number;
  readonly wasmhopfcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: any, v: number) => [number, number, number];
  readonly wasmhopfcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_is_done: (a: number) => number;
  readonly wasmisoperiodiccurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: any, w: number) => [number, number, number];
  readonly wasmisoperiodiccurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlpccurverunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_is_done: (a: number) => number;
  readonly wasmlpccurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: any, w: number) => [number, number, number];
  readonly wasmlpccurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmmanifold2dextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmmanifold2dextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmmanifold2dextensionrunner_is_done: (a: number) => number;
  readonly wasmmanifold2dextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: any) => [number, number, number];
  readonly wasmmanifold2dextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmnscurverunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmnscurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmnscurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmnscurverunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmnscurverunner_is_done: (a: number) => number;
  readonly wasmnscurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: any, x: number) => [number, number, number];
  readonly wasmnscurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmpdcurverunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_is_done: (a: number) => number;
  readonly wasmpdcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: any, w: number) => [number, number, number];
  readonly wasmpdcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_compute_event_series_from_orbit: (a: number, b: any) => [number, number, number];
  readonly wasmsystem_compute_event_series_from_samples: (a: number, b: any) => [number, number, number];
  readonly wasmsystem_solve_equilibrium: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly wasmsystem_solve_equilibrium_deflated: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly wasmsystem_solve_equilibrium_deflated_targets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
  readonly __wbg_wasmcontinuationextensionrunner_free: (a: number, b: number) => void;
  readonly wasmcontinuationextensionrunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_get_linear_solver_stats: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_is_done: (a: number) => number;
  readonly wasmcontinuationextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number, n: number, o: any, p: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbg_wasmheteroclinicrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmheteroclinicshootingrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmhomoclinicrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmhomoclinicshootingrunner_free: (a: number, b: number) => void;
  readonly wasmheteroclinicrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmheteroclinicrunner_get_result: (a: number) => [number, number, number];
  readonly wasmheteroclinicrunner_is_done: (a: number) => number;
  readonly wasmheteroclinicrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any, j: any, k: number) => [number, number, number];
  readonly wasmheteroclinicrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmheteroclinicshootingrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmheteroclinicshootingrunner_get_result: (a: number) => [number, number, number];
  readonly wasmheteroclinicshootingrunner_is_done: (a: number) => number;
  readonly wasmheteroclinicshootingrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any, j: any, k: number) => [number, number, number];
  readonly wasmheteroclinicshootingrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmhomoclinicrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmhomoclinicrunner_get_result: (a: number) => [number, number, number];
  readonly wasmhomoclinicrunner_is_done: (a: number) => number;
  readonly wasmhomoclinicrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any, j: any, k: number) => [number, number, number];
  readonly wasmhomoclinicrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmhomoclinicshootingrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmhomoclinicshootingrunner_get_result: (a: number) => [number, number, number];
  readonly wasmhomoclinicshootingrunner_is_done: (a: number) => number;
  readonly wasmhomoclinicshootingrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any, j: any, k: number) => [number, number, number];
  readonly wasmhomoclinicshootingrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbg_wasmcodim1curveextensionrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmhomotopysaddlerunner_free: (a: number, b: number) => void;
  readonly wasmcodim1curveextensionrunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmcodim1curveextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcodim1curveextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmcodim1curveextensionrunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmcodim1curveextensionrunner_is_done: (a: number) => number;
  readonly wasmcodim1curveextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number, n: number, o: any, p: number) => [number, number, number];
  readonly wasmcodim1curveextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmhomotopysaddlerunner_get_progress: (a: number) => [number, number, number];
  readonly wasmhomotopysaddlerunner_get_result: (a: number) => [number, number, number];
  readonly wasmhomotopysaddlerunner_is_done: (a: number) => number;
  readonly wasmhomotopysaddlerunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any, j: any, k: number) => [number, number, number];
  readonly wasmhomotopysaddlerunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_compute_continuation: (a: number, b: number, c: number, d: number, e: number, f: number, g: any, h: number) => [number, number, number];
  readonly wasmsystem_compute_continuation_stepped: (a: number, b: number, c: number, d: number, e: number, f: number, g: any, h: number, i: number) => [number, number, number];
  readonly wasmsystem_compute_cycle_manifold_2d: (a: number, b: number, c: number, d: number, e: number, f: any, g: any) => [number, number, number];
  readonly wasmsystem_compute_cycle_manifold_2d_with_progress: (a: number, b: number, c: number, d: number, e: number, f: any, g: any, h: any) => [number, number, number];
  readonly wasmsystem_compute_eq_manifold_1d: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
  readonly wasmsystem_compute_eq_manifold_2d: (a: number, b: number, c: number, d: any) => [number, number, number];
  readonly wasmsystem_compute_eq_manifold_2d_with_progress: (a: number, b: number, c: number, d: any, e: any) => [number, number, number];
  readonly wasmsystem_compute_equilibrium_eigenvalues: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly wasmsystem_compute_heteroclinic_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_compute_homoclinic_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_compute_homotopy_saddle_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_continuation: (a: number, b: any, c: number, d: number, e: any, f: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_floquet_modes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_floquet_modes_on_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_floquet_modes_on_mesh_with_backend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_floquet_modes_with_backend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_continue_fold_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: number) => [number, number, number];
  readonly wasmsystem_continue_hopf_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: number) => [number, number, number];
  readonly wasmsystem_continue_isoperiodic_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
  readonly wasmsystem_continue_lpc_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
  readonly wasmsystem_continue_ns_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any, o: number) => [number, number, number];
  readonly wasmsystem_continue_pd_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
  readonly wasmsystem_extend_continuation: (a: number, b: any, c: number, d: number, e: number, f: any, g: number) => [number, number, number];
  readonly wasmsystem_extend_heteroclinic_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_extend_manifold_2d_with_progress: (a: number, b: any, c: any, d: any) => [number, number, number];
  readonly wasmsystem_init_curves_from_bogdanov_takens: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
  readonly wasmsystem_init_heteroclinic_from_orbit: (a: number, b: any, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_bogdanov_takens: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_homoclinic: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_homoclinic_on_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_homotopy_saddle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_large_cycle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_from_large_cycle_on_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number, number];
  readonly wasmsystem_init_homotopy_saddle_from_equilibrium: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_hopf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_orbit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_pd: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_pd_on_mesh: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly wasmsystem_init_lpc_from_generalized_hopf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => [number, number, number];
  readonly wasmsystem_init_map_cycle_from_pd: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly __wbg_wasmforcedresponserunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlimitcyclerunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmtransferoperatorrunner_free: (a: number, b: number) => void;
  readonly wasmforcedresponserunner_get_progress: (a: number) => [number, number, number];
  readonly wasmforcedresponserunner_get_result: (a: number) => [number, number, number];
  readonly wasmforcedresponserunner_is_done: (a: number) => number;
  readonly wasmforcedresponserunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: any, x: number, y: number, z: number) => [number, number, number];
  readonly wasmforcedresponserunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_adaptation_report: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_linear_solver_stats: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_result: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_result_with_report: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_is_done: (a: number) => number;
  readonly wasmlimitcyclerunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: number, m: number, n: any, o: number) => [number, number, number];
  readonly wasmlimitcyclerunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_advance_forced_response_seed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_compute_heteroclinic_shooting_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_compute_homoclinic_shooting_continuation: (a: number, b: any, c: any, d: number) => [number, number, number];
  readonly wasmsystem_compute_hopf_hopf_normal_form: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly wasmsystem_compute_map_normal_form: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly wasmsystem_compute_periodic_normal_form_from_packed_state: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly wasmsystem_compute_periodic_orbit_normal_form: (a: number, b: any, c: number, d: number, e: number) => [number, number, number];
  readonly wasmsystem_compute_zero_hopf_normal_form: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly wasmsystem_init_heteroclinic_shooting_from_collocation: (a: number, b: any, c: number, d: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_shooting_from_collocation: (a: number, b: any, c: number, d: number) => [number, number, number];
  readonly wasmsystem_init_homoclinic_shooting_from_shooting: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => [number, number, number];
  readonly wasmsystem_solve_forced_response: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
  readonly wasmsystem_switch_from_hopf_hopf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
  readonly wasmsystem_switch_from_zero_hopf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
  readonly wasmsystem_switch_periodic_branch_from_packed_state: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_switch_periodic_orbit_branch: (a: number, b: any, c: number, d: any, e: number) => [number, number, number];
  readonly wasmsystem_validate_periodic_forcing: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly wasmtransferoperatorrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmtransferoperatorrunner_get_result: (a: number) => [number, number, number];
  readonly wasmtransferoperatorrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number) => [number, number, number];
  readonly wasmtransferoperatorrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbg_wasmsystem_free: (a: number, b: number) => void;
  readonly wasmsystem_compute_isocline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
  readonly wasmsystem_compute_jacobian: (a: number) => [number, number];
  readonly wasmsystem_context_symbol: (a: number) => [number, number];
  readonly wasmsystem_get_state: (a: number) => [number, number];
  readonly wasmsystem_get_t: (a: number) => number;
  readonly wasmsystem_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
  readonly wasmsystem_set_periods: (a: number, b: number, c: number) => void;
  readonly wasmsystem_set_state: (a: number, b: number, c: number) => void;
  readonly wasmsystem_set_t: (a: number, b: number) => void;
  readonly wasmsystem_step: (a: number, b: number) => void;
  readonly wasmsystem_uses_context: (a: number) => number;
  readonly __wbg_wasmcovariantlyapunovrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlyapunovrunner_free: (a: number, b: number) => void;
  readonly wasmcovariantlyapunovrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_get_result: (a: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_is_done: (a: number) => number;
  readonly wasmcovariantlyapunovrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlyapunovrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlyapunovrunner_get_result: (a: number) => [number, number, number];
  readonly wasmlyapunovrunner_is_done: (a: number) => number;
  readonly wasmlyapunovrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number];
  readonly wasmlyapunovrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_compute_covariant_lyapunov_vectors: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_compute_lyapunov_exponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly __wbg_wasmcyclemanifold2drunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmeqmanifold1dextensionrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmeqmanifold1dgroupextensionrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmeqmanifold1drunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmeqmanifold2drunner_free: (a: number, b: number) => void;
  readonly init_fork_thread_pool: () => any;
  readonly wasmcyclemanifold2drunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcyclemanifold2drunner_get_result: (a: number) => [number, number, number];
  readonly wasmcyclemanifold2drunner_is_done: (a: number) => number;
  readonly wasmcyclemanifold2drunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any, p: any) => [number, number, number];
  readonly wasmcyclemanifold2drunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmeqmanifold1dextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmeqmanifold1dextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmeqmanifold1dextensionrunner_is_done: (a: number) => number;
  readonly wasmeqmanifold1dextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: any, n: number, o: number) => [number, number, number];
  readonly wasmeqmanifold1dextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmeqmanifold1dgroupextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmeqmanifold1dgroupextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmeqmanifold1dgroupextensionrunner_is_done: (a: number) => number;
  readonly wasmeqmanifold1dgroupextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: any, n: number, o: number) => [number, number, number];
  readonly wasmeqmanifold1dgroupextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmeqmanifold1drunner_get_progress: (a: number) => [number, number, number];
  readonly wasmeqmanifold1drunner_get_result: (a: number) => [number, number, number];
  readonly wasmeqmanifold1drunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any, o: number, p: number) => [number, number, number];
  readonly wasmeqmanifold1drunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmeqmanifold2drunner_get_progress: (a: number) => [number, number, number];
  readonly wasmeqmanifold2drunner_get_result: (a: number) => [number, number, number];
  readonly wasmeqmanifold2drunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any) => [number, number, number];
  readonly wasmeqmanifold2drunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmeqmanifold1drunner_is_done: (a: number) => number;
  readonly wasmeqmanifold2drunner_is_done: (a: number) => number;
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
