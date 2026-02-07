//! Analysis helpers and Lyapunov/CLV runners.

use crate::system::{build_system, SolverType, WasmSystem};
use fork_core::analysis::{
    covariant_lyapunov_vectors as core_clv, lyapunov_exponents as core_lyapunov, LyapunovStepper,
};
use fork_core::autodiff::TangentSystem;
use fork_core::equation_engine::EquationSystem;
use fork_core::solvers::{DiscreteMap, Tsit5, RK4};
use fork_core::traits::Steppable;
use js_sys::Float64Array;
use nalgebra::linalg::QR;
use nalgebra::DMatrix;
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    pub fn compute_lyapunov_exponents(
        &self,
        start_state: Vec<f64>,
        start_time: f64,
        steps: u32,
        dt: f64,
        qr_stride: u32,
    ) -> Result<Float64Array, JsValue> {
        let dim = self.system.equations.len();
        if start_state.len() != dim {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }
        if steps == 0 {
            return Err(JsValue::from_str(
                "Lyapunov computation requires at least one step.",
            ));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        let stride = if qr_stride == 0 {
            1
        } else {
            qr_stride as usize
        };
        let step_count = steps as usize;
        let solver = match &self.solver {
            SolverType::RK4(_) => LyapunovStepper::Rk4,
            SolverType::Tsit5(_) => LyapunovStepper::Tsit5,
            SolverType::Discrete(_) => LyapunovStepper::Discrete,
        };

        let exponents = core_lyapunov(
            &self.system,
            solver,
            &start_state,
            start_time,
            step_count,
            dt,
            stride,
        )
        .map_err(|e| JsValue::from_str(&format!("Lyapunov computation failed: {}", e)))?;

        Ok(Float64Array::from(exponents.as_slice()))
    }

    pub fn compute_covariant_lyapunov_vectors(
        &self,
        start_state: Vec<f64>,
        start_time: f64,
        window_steps: u32,
        dt: f64,
        qr_stride: u32,
        forward_transient: u32,
        backward_transient: u32,
    ) -> Result<JsValue, JsValue> {
        let dim = self.system.equations.len();
        if start_state.len() != dim {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        if window_steps == 0 {
            return Err(JsValue::from_str(
                "Covariant Lyapunov computation requires a positive window.",
            ));
        }

        let solver = match &self.solver {
            SolverType::RK4(_) => LyapunovStepper::Rk4,
            SolverType::Tsit5(_) => LyapunovStepper::Tsit5,
            SolverType::Discrete(_) => LyapunovStepper::Discrete,
        };

        let result = core_clv(
            &self.system,
            solver,
            &start_state,
            start_time,
            dt,
            if qr_stride == 0 {
                1
            } else {
                qr_stride as usize
            },
            window_steps as usize,
            forward_transient as usize,
            backward_transient as usize,
        )
        .map_err(|e| JsValue::from_str(&format!("Covariant Lyapunov computation failed: {}", e)))?;

        let payload = CovariantVectorsPayload {
            dimension: result.dimension,
            checkpoints: result.checkpoints,
            times: result.times,
            vectors: result.vectors,
        };

        to_value(&payload).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[derive(Serialize)]
pub(crate) struct CovariantVectorsPayload {
    dimension: usize,
    checkpoints: usize,
    times: Vec<f64>,
    vectors: Vec<f64>,
}

fn apply_qr(phi_slice: &mut [f64], dim: usize, accum: &mut [f64]) -> anyhow::Result<()> {
    if phi_slice.len() != dim * dim {
        anyhow::bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, phi_slice);
    let qr = QR::new(matrix);
    let (q, r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)].abs();
        if diag <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        accum[i] += diag.ln();
    }
    for i in 0..dim {
        for j in 0..dim {
            phi_slice[i * dim + j] = q[(i, j)];
        }
    }
    Ok(())
}

fn thin_qr_positive(slice: &[f64], dim: usize) -> anyhow::Result<(DMatrix<f64>, DMatrix<f64>)> {
    if slice.len() != dim * dim {
        anyhow::bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, slice);
    let qr = QR::new(matrix);
    let (mut q, mut r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)];
        if diag.abs() <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        if diag < 0.0 {
            for row in 0..dim {
                q[(row, i)] = -q[(row, i)];
            }
            for col in i..dim {
                r[(i, col)] = -r[(i, col)];
            }
        }
    }
    Ok((q, r))
}

fn overwrite_slice_with_matrix(slice: &mut [f64], matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            slice[i * dim + j] = matrix[(i, j)];
        }
    }
}

fn append_matrix_row_major(target: &mut Vec<f64>, matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            target.push(matrix[(i, j)]);
        }
    }
}

fn solve_upper(r: &[f64], rhs: &[f64], dim: usize) -> anyhow::Result<Vec<f64>> {
    let mut result = vec![0.0; dim * dim];
    for col in 0..dim {
        for row in (0..dim).rev() {
            let mut value = rhs[row * dim + col];
            for k in row + 1..dim {
                value -= r[row * dim + k] * result[k * dim + col];
            }
            let diag = r[row * dim + row];
            if diag.abs() <= f64::EPSILON {
                return Err(anyhow::anyhow!(
                    "Encountered near-singular R matrix during backward substitution."
                ));
            }
            result[row * dim + col] = value / diag;
        }
    }
    Ok(result)
}

fn normalize_columns(matrix: &mut [f64], dim: usize) -> anyhow::Result<()> {
    for col in 0..dim {
        let mut norm = 0.0;
        for row in 0..dim {
            let value = matrix[row * dim + col];
            norm += value * value;
        }
        norm = norm.sqrt();
        if norm <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered degenerate CLV column during normalization."
            ));
        }
        for row in 0..dim {
            matrix[row * dim + col] /= norm;
        }
    }
    Ok(())
}

fn matmul_row_major(a: &[f64], b: &[f64], dest: &mut [f64], dim: usize) {
    for i in 0..dim {
        for j in 0..dim {
            let mut accum = 0.0;
            for k in 0..dim {
                accum += a[i * dim + k] * b[k * dim + j];
            }
            dest[i * dim + j] = accum;
        }
    }
}

fn unit_upper_triangular(dim: usize) -> Vec<f64> {
    let mut matrix = vec![0.0; dim * dim];
    for i in 0..dim {
        for j in i..dim {
            matrix[i * dim + j] = if i == j { 1.0 } else { 0.0 };
        }
    }
    matrix
}

/// Progress payload for analysis-style runners (Lyapunov, CLV).
#[derive(Serialize)]
struct AnalysisProgress {
    done: bool,
    current_step: usize,
    max_steps: usize,
}

enum LyapunovInternalStepper {
    RK4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

impl LyapunovInternalStepper {
    fn step(
        &mut self,
        system: &TangentSystem<EquationSystem>,
        t: &mut f64,
        state: &mut [f64],
        dt: f64,
    ) {
        match self {
            LyapunovInternalStepper::RK4(s) => s.step(system, t, state, dt),
            LyapunovInternalStepper::Tsit5(s) => s.step(system, t, state, dt),
            LyapunovInternalStepper::Discrete(s) => s.step(system, t, state, dt),
        }
    }
}

struct LyapunovRunnerState {
    tangent_system: TangentSystem<EquationSystem>,
    stepper: LyapunovInternalStepper,
    augmented_state: Vec<f64>,
    accum: Vec<f64>,
    t: f64,
    steps_done: usize,
    since_last_qr: usize,
    total_time: f64,
    dim: usize,
    dt: f64,
    steps: usize,
    qr_stride: usize,
    done: bool,
}

#[wasm_bindgen]
pub struct WasmLyapunovRunner {
    state: Option<LyapunovRunnerState>,
}

#[wasm_bindgen]
impl WasmLyapunovRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        initial_state: Vec<f64>,
        initial_time: f64,
        steps: u32,
        dt: f64,
        qr_stride: u32,
    ) -> Result<WasmLyapunovRunner, JsValue> {
        console_error_panic_hook::set_once();

        if initial_state.is_empty() {
            return Err(JsValue::from_str(
                "Initial state must have positive dimension.",
            ));
        }
        if steps == 0 {
            return Err(JsValue::from_str(
                "Lyapunov computation requires at least one step.",
            ));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        let stride = if qr_stride == 0 {
            1
        } else {
            qr_stride as usize
        };

        let system = build_system(equations, params, &param_names, &var_names)?;
        let dim = initial_state.len();
        if dim != system.equations.len() {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }

        let stepper = match solver_name {
            "rk4" => LyapunovInternalStepper::RK4(RK4::new(dim + dim * dim)),
            "tsit5" => LyapunovInternalStepper::Tsit5(Tsit5::new(dim + dim * dim)),
            "discrete" => LyapunovInternalStepper::Discrete(DiscreteMap::new(dim + dim * dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        let aug_dim = dim + dim * dim;
        let mut augmented_state = vec![0.0; aug_dim];
        augmented_state[..dim].copy_from_slice(&initial_state);
        for i in 0..dim {
            for j in 0..dim {
                augmented_state[dim + i * dim + j] = if i == j { 1.0 } else { 0.0 };
            }
        }

        let tangent_system = TangentSystem::new(system, dim);

        Ok(WasmLyapunovRunner {
            state: Some(LyapunovRunnerState {
                tangent_system,
                stepper,
                augmented_state,
                accum: vec![0.0; dim],
                t: initial_time,
                steps_done: 0,
                since_last_qr: 0,
                total_time: 0.0,
                dim,
                dt,
                steps: steps as usize,
                qr_stride: stride,
                done: false,
            }),
        })
    }

    pub fn is_done(&self) -> bool {
        self.state.as_ref().map_or(true, |state| state.done)
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.done {
            let progress = AnalysisProgress {
                done: true,
                current_step: state.steps_done,
                max_steps: state.steps,
            };
            return to_value(&progress)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }

        for _ in 0..batch_size {
            if state.steps_done >= state.steps {
                state.done = true;
                break;
            }

            state.stepper.step(
                &state.tangent_system,
                &mut state.t,
                &mut state.augmented_state,
                state.dt,
            );
            state.steps_done += 1;
            state.since_last_qr += 1;
            state.total_time += state.dt;

            if state.since_last_qr == state.qr_stride || state.steps_done == state.steps {
                apply_qr(
                    &mut state.augmented_state[state.dim..],
                    state.dim,
                    &mut state.accum,
                )
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                state.since_last_qr = 0;
            }
        }

        if state.steps_done >= state.steps {
            state.done = true;
        }

        let progress = AnalysisProgress {
            done: state.done || state.steps_done >= state.steps,
            current_step: state.steps_done,
            max_steps: state.steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = AnalysisProgress {
            done: state.done,
            current_step: state.steps_done,
            max_steps: state.steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.total_time <= 0.0 {
            return Err(JsValue::from_str(
                "Total integration time is zero; cannot normalize exponents.",
            ));
        }

        let mut exponents = state.accum.clone();
        for value in &mut exponents {
            *value /= state.total_time;
        }

        to_value(&exponents).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

struct CovariantRunnerState {
    tangent_system: TangentSystem<EquationSystem>,
    stepper: LyapunovInternalStepper,
    augmented_state: Vec<f64>,
    t: f64,
    steps_done: usize,
    since_last_qr: usize,
    total_steps: usize,
    dt: f64,
    qr_stride: usize,
    window_steps: usize,
    forward_transient: usize,
    backward_transient: usize,
    q_history: Vec<f64>,
    r_history: Vec<f64>,
    time_history: Vec<f64>,
    window_accum: usize,
    backward_accum: usize,
    done: bool,
}

fn advance_covariant_runner(
    state: &mut CovariantRunnerState,
    batch_size: usize,
) -> Result<AnalysisProgress, JsValue> {
    if state.done {
        return Ok(AnalysisProgress {
            done: true,
            current_step: state.steps_done,
            max_steps: state.total_steps,
        });
    }

    let dim = state.tangent_system.dimension;
    for _ in 0..batch_size {
        if state.steps_done >= state.total_steps {
            state.done = true;
            break;
        }

        state.stepper.step(
            &state.tangent_system,
            &mut state.t,
            &mut state.augmented_state,
            state.dt,
        );
        state.steps_done += 1;
        state.since_last_qr += 1;

        if state.since_last_qr == state.qr_stride || state.steps_done == state.total_steps {
            let block_steps = state.since_last_qr;
            state.since_last_qr = 0;

            let phi_slice = &mut state.augmented_state[dim..];
            let (q_matrix, r_matrix) = thin_qr_positive(phi_slice, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            overwrite_slice_with_matrix(phi_slice, &q_matrix);

            if state.steps_done <= state.forward_transient {
                continue;
            }
            let post_transient_steps = state
                .steps_done
                .saturating_sub(state.forward_transient)
                .min(block_steps);

            let mut stored = false;
            if state.window_accum < state.window_steps {
                append_matrix_row_major(&mut state.q_history, &q_matrix);
                append_matrix_row_major(&mut state.r_history, &r_matrix);
                state.time_history.push(state.t);
                state.window_accum = state
                    .window_accum
                    .saturating_add(post_transient_steps)
                    .min(state.window_steps);
                stored = true;
            } else if state.backward_accum < state.backward_transient {
                append_matrix_row_major(&mut state.r_history, &r_matrix);
                state.backward_accum = state
                    .backward_accum
                    .saturating_add(post_transient_steps)
                    .min(state.backward_transient);
                stored = true;
            }

            if !stored && state.window_accum < state.window_steps {
                return Err(JsValue::from_str(
                    "Failed to store Gram-Schmidt data for the requested window.",
                ));
            }

            if state.window_accum == state.window_steps
                && state.backward_accum == state.backward_transient
            {
                state.done = true;
                break;
            }
        }
    }

    if state.steps_done >= state.total_steps {
        state.done = true;
    }

    Ok(AnalysisProgress {
        done: state.done,
        current_step: state.steps_done,
        max_steps: state.total_steps,
    })
}

#[wasm_bindgen]
pub struct WasmCovariantLyapunovRunner {
    state: Option<CovariantRunnerState>,
}

#[wasm_bindgen]
impl WasmCovariantLyapunovRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        initial_state: Vec<f64>,
        initial_time: f64,
        dt: f64,
        qr_stride: u32,
        window_steps: u32,
        forward_transient: u32,
        backward_transient: u32,
    ) -> Result<WasmCovariantLyapunovRunner, JsValue> {
        #[cfg(target_arch = "wasm32")]
        console_error_panic_hook::set_once();

        if initial_state.is_empty() {
            return Err(JsValue::from_str(
                "Initial state must have positive dimension.",
            ));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        if window_steps == 0 {
            return Err(JsValue::from_str("Window size must be at least one step."));
        }
        let stride = if qr_stride == 0 {
            1
        } else {
            qr_stride as usize
        };

        let total_steps =
            forward_transient as usize + window_steps as usize + backward_transient as usize;
        if total_steps == 0 {
            return Err(JsValue::from_str(
                "Total integration steps must be positive.",
            ));
        }

        let system = build_system(equations, params, &param_names, &var_names)?;
        let dim = initial_state.len();
        if dim != system.equations.len() {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }

        let stepper = match solver_name {
            "rk4" => LyapunovInternalStepper::RK4(RK4::new(dim + dim * dim)),
            "tsit5" => LyapunovInternalStepper::Tsit5(Tsit5::new(dim + dim * dim)),
            "discrete" => LyapunovInternalStepper::Discrete(DiscreteMap::new(dim + dim * dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        let aug_dim = dim + dim * dim;
        let mut augmented_state = vec![0.0; aug_dim];
        augmented_state[..dim].copy_from_slice(&initial_state);
        for i in 0..dim {
            for j in 0..dim {
                augmented_state[dim + i * dim + j] = if i == j { 1.0 } else { 0.0 };
            }
        }

        let tangent_system = TangentSystem::new(system, dim);

        Ok(WasmCovariantLyapunovRunner {
            state: Some(CovariantRunnerState {
                tangent_system,
                stepper,
                augmented_state,
                t: initial_time,
                steps_done: 0,
                since_last_qr: 0,
                total_steps,
                dt,
                qr_stride: stride,
                window_steps: window_steps as usize,
                forward_transient: forward_transient as usize,
                backward_transient: backward_transient as usize,
                q_history: Vec::new(),
                r_history: Vec::new(),
                time_history: Vec::new(),
                window_accum: 0,
                backward_accum: 0,
                done: false,
            }),
        })
    }

    pub fn is_done(&self) -> bool {
        self.state.as_ref().map_or(true, |state| state.done)
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        let progress = advance_covariant_runner(state, batch_size as usize)?;
        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = AnalysisProgress {
            done: state.done,
            current_step: state.steps_done,
            max_steps: state.total_steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let dim = state.tangent_system.dimension;
        let dim_sq = dim * dim;
        if state.q_history.is_empty() {
            return Err(JsValue::from_str(
                "No CLV data stored. Ensure window duration exceeds qr_stride.",
            ));
        }
        if state.q_history.len() % dim_sq != 0 || state.r_history.len() % dim_sq != 0 {
            return Err(JsValue::from_str(
                "Internal storage size mismatch while assembling CLVs.",
            ));
        }

        let window_count = state.q_history.len() / dim_sq;
        let total_r_count = state.r_history.len() / dim_sq;
        if total_r_count < window_count {
            return Err(JsValue::from_str(
                "Insufficient R-history for backward pass.",
            ));
        }

        let mut c_matrix = unit_upper_triangular(dim);
        for idx in (window_count..total_r_count).rev() {
            let r_slice = &state.r_history[idx * dim_sq..(idx + 1) * dim_sq];
            c_matrix = solve_upper(r_slice, &c_matrix, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            normalize_columns(&mut c_matrix, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
        }

        let mut clv_vectors = vec![0.0; state.q_history.len()];
        let mut c_current = c_matrix;

        for idx in (0..window_count).rev() {
            let q_slice = &state.q_history[idx * dim_sq..(idx + 1) * dim_sq];
            let r_slice = &state.r_history[idx * dim_sq..(idx + 1) * dim_sq];
            let dest = &mut clv_vectors[idx * dim_sq..(idx + 1) * dim_sq];
            matmul_row_major(q_slice, &c_current, dest, dim);
            let next_c = solve_upper(r_slice, &c_current, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            c_current = next_c;
            normalize_columns(&mut c_current, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
        }

        let payload = CovariantVectorsPayload {
            dimension: dim,
            checkpoints: window_count,
            times: state.time_history.clone(),
            vectors: clv_vectors,
        };

        to_value(&payload).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clv_runner_does_not_finish_before_post_transient_window() {
        let mut runner = WasmCovariantLyapunovRunner::new(
            vec!["x".to_string()],
            Vec::new(),
            Vec::new(),
            vec!["x".to_string()],
            "discrete",
            vec![1.0],
            0.0,
            1.0,
            10,
            10,
            5,
            0,
        )
        .expect("runner");

        let state = runner.state.as_mut().expect("state");
        let _ = advance_covariant_runner(state, 100).expect("advance");

        let state = runner.state.as_ref().expect("state");
        assert!(state.done, "runner should finish");
        assert_eq!(
            state.steps_done, state.total_steps,
            "runner should integrate the full post-transient window"
        );
    }
}
