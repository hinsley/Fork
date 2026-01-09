/* tslint:disable */
/* eslint-disable */
export class WasmContinuationExtensionRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, branch_val: any, parameter_name: string, settings_val: any, forward: boolean);
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
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, equilibrium_state: Float64Array, parameter_name: string, settings_val: any, forward: boolean);
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
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, initial_guess: Float64Array, max_steps: number, damping: number);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmFoldCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, fold_state: Float64Array, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmHopfCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], system_type: string, hopf_state: Float64Array, hopf_omega: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmLPCCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmLimitCycleRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], _system_type: string, setup_val: any, parameter_name: string, settings_val: any, forward: boolean);
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
export class WasmNSCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, initial_k: number, ntst: number, ncol: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmPDCurveRunner {
  free(): void;
  [Symbol.dispose](): void;
  get_result(): any;
  get_progress(): any;
  constructor(equations: string[], params: Float64Array, param_names: string[], var_names: string[], lc_state: Float64Array, period: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, ntst: number, ncol: number, settings_val: any, forward: boolean);
  is_done(): boolean;
  run_steps(batch_size: number): any;
}
export class WasmSystem {
  free(): void;
  [Symbol.dispose](): void;
  solve_equilibrium(initial_guess: Float64Array, max_steps: number, damping: number): any;
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
  continue_fold_curve(fold_state: Float64Array, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean): any;
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
  continue_hopf_curve(hopf_state: Float64Array, hopf_omega: number, param1_name: string, param1_value: number, param2_name: string, param2_value: number, settings_val: any, forward: boolean): any;
  extend_continuation(branch_val: any, parameter_name: string, settings_val: any, forward: boolean): any;
  compute_continuation(equilibrium_state: Float64Array, parameter_name: string, settings_val: any, forward: boolean): any;
  /**
   * Compute equilibrium continuation with progress reporting capability.
   * Returns a serialized StepResult after running the specified number of steps.
   *
   * This is a convenience method that runs the full continuation but returns
   * progress information. For true stepped execution, use WasmEquilibriumRunner.
   */
  compute_continuation_stepped(equilibrium_state: Float64Array, parameter_name: string, settings_val: any, forward: boolean, _batch_size: number): any;
  compute_equilibrium_eigenvalues(state: Float64Array, parameter_name: string, param_value: number): any;
  /**
   * Computes limit cycle continuation from an initial setup (from init_lc_from_hopf).
   */
  compute_limit_cycle_continuation(setup_val: any, parameter_name: string, settings_val: any, forward: boolean): any;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmequilibriumsolverrunner_free: (a: number, b: number) => void;
  readonly wasmequilibriumsolverrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_get_result: (a: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_is_done: (a: number) => number;
  readonly wasmequilibriumsolverrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number];
  readonly wasmequilibriumsolverrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_compute_continuation: (a: number, b: number, c: number, d: number, e: number, f: any, g: number) => [number, number, number];
  readonly wasmsystem_compute_continuation_stepped: (a: number, b: number, c: number, d: number, e: number, f: any, g: number, h: number) => [number, number, number];
  readonly wasmsystem_compute_equilibrium_eigenvalues: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly wasmsystem_compute_limit_cycle_continuation: (a: number, b: any, c: number, d: number, e: any, f: number) => [number, number, number];
  readonly wasmsystem_continue_fold_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any, k: number) => [number, number, number];
  readonly wasmsystem_continue_hopf_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: number) => [number, number, number];
  readonly wasmsystem_continue_lpc_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
  readonly wasmsystem_continue_ns_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: any, o: number) => [number, number, number];
  readonly wasmsystem_continue_pd_curve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any, n: number) => [number, number, number];
  readonly wasmsystem_extend_continuation: (a: number, b: any, c: number, d: number, e: any, f: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_hopf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_orbit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_init_lc_from_pd: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_solve_equilibrium: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly __wbg_wasmfoldcurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmhopfcurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlpccurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmnscurverunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmpdcurverunner_free: (a: number, b: number) => void;
  readonly wasmfoldcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmfoldcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmfoldcurverunner_is_done: (a: number) => number;
  readonly wasmfoldcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: any, t: number) => [number, number, number];
  readonly wasmfoldcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmhopfcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmhopfcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmhopfcurverunner_is_done: (a: number) => number;
  readonly wasmhopfcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: any, u: number) => [number, number, number];
  readonly wasmhopfcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlpccurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmlpccurverunner_is_done: (a: number) => number;
  readonly wasmlpccurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: any, u: number) => [number, number, number];
  readonly wasmlpccurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmnscurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmnscurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmnscurverunner_is_done: (a: number) => number;
  readonly wasmnscurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: any, v: number) => [number, number, number];
  readonly wasmnscurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmpdcurverunner_get_progress: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_get_result: (a: number) => [number, number, number];
  readonly wasmpdcurverunner_is_done: (a: number) => number;
  readonly wasmpdcurverunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: any, u: number) => [number, number, number];
  readonly wasmpdcurverunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbg_wasmsystem_free: (a: number, b: number) => void;
  readonly wasmsystem_compute_jacobian: (a: number) => [number, number];
  readonly wasmsystem_get_state: (a: number) => [number, number];
  readonly wasmsystem_get_t: (a: number) => number;
  readonly wasmsystem_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
  readonly wasmsystem_set_state: (a: number, b: number, c: number) => void;
  readonly wasmsystem_set_t: (a: number, b: number) => void;
  readonly wasmsystem_step: (a: number, b: number) => void;
  readonly __wbg_wasmcovariantlyapunovrunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlimitcyclerunner_free: (a: number, b: number) => void;
  readonly __wbg_wasmlyapunovrunner_free: (a: number, b: number) => void;
  readonly wasmcovariantlyapunovrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_get_result: (a: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_is_done: (a: number) => number;
  readonly wasmcovariantlyapunovrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
  readonly wasmcovariantlyapunovrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_get_result: (a: number) => [number, number, number];
  readonly wasmlimitcyclerunner_is_done: (a: number) => number;
  readonly wasmlimitcyclerunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: number, m: number, n: any, o: number) => [number, number, number];
  readonly wasmlimitcyclerunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmlyapunovrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmlyapunovrunner_get_result: (a: number) => [number, number, number];
  readonly wasmlyapunovrunner_is_done: (a: number) => number;
  readonly wasmlyapunovrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number];
  readonly wasmlyapunovrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly wasmsystem_compute_covariant_lyapunov_vectors: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
  readonly wasmsystem_compute_lyapunov_exponents: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly __wbg_wasmequilibriumrunner_free: (a: number, b: number) => void;
  readonly wasmequilibriumrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmequilibriumrunner_get_result: (a: number) => [number, number, number];
  readonly wasmequilibriumrunner_is_done: (a: number) => number;
  readonly wasmequilibriumrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any, p: number) => [number, number, number];
  readonly wasmequilibriumrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbg_wasmcontinuationextensionrunner_free: (a: number, b: number) => void;
  readonly wasmcontinuationextensionrunner_get_progress: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_get_result: (a: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_is_done: (a: number) => number;
  readonly wasmcontinuationextensionrunner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: any, l: number, m: number, n: any, o: number) => [number, number, number];
  readonly wasmcontinuationextensionrunner_run_steps: (a: number, b: number) => [number, number, number];
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
