//! Equilibrium solver runner and helpers.

use crate::system::{build_system, SystemType, WasmSystem};
use fork_core::equilibrium::{
    compute_system_jacobian, solve_equilibrium as core_equilibrium_solver, EigenPair,
    EquilibriumResult, NewtonSettings, SystemKind,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::traits::DynamicalSystem;
use nalgebra::linalg::SVD;
use nalgebra::{Complex, DMatrix, DVector};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    pub fn solve_equilibrium(
        &self,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
    ) -> Result<JsValue, JsValue> {
        let settings = NewtonSettings {
            max_steps: max_steps as usize,
            damping,
            ..NewtonSettings::default()
        };

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let result = core_equilibrium_solver(&self.system, kind, &initial_guess, settings)
            .map_err(|e| JsValue::from_str(&format!("Equilibrium solve failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

/// Progress payload for the stepped equilibrium solver.
#[derive(Serialize)]
struct EquilibriumSolveProgress {
    done: bool,
    iterations: usize,
    max_steps: usize,
    residual_norm: f64,
}

struct EquilibriumSolverState {
    system: EquationSystem,
    kind: SystemKind,
    state: Vec<f64>,
    residual: Vec<f64>,
    residual_norm: f64,
    iterations: usize,
    settings: NewtonSettings,
    done: bool,
}

#[wasm_bindgen]
pub struct WasmEquilibriumSolverRunner {
    state: Option<EquilibriumSolverState>,
}

#[wasm_bindgen]
impl WasmEquilibriumSolverRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
    ) -> Result<WasmEquilibriumSolverRunner, JsValue> {
        console_error_panic_hook::set_once();

        let system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let settings = NewtonSettings {
            max_steps: max_steps as usize,
            damping,
            ..NewtonSettings::default()
        };

        let dim = system.equations.len();
        if dim == 0 {
            return Err(JsValue::from_str("System has zero dimension."));
        }
        if initial_guess.len() != dim {
            return Err(JsValue::from_str("Initial guess dimension mismatch."));
        }

        let state = initial_guess;
        let mut residual = vec![0.0; dim];
        evaluate_equilibrium_residual(&system, kind, &state, &mut residual);
        let residual_norm = l2_norm(&residual);

        Ok(WasmEquilibriumSolverRunner {
            state: Some(EquilibriumSolverState {
                system,
                kind,
                state,
                residual,
                residual_norm,
                iterations: 0,
                settings,
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
            let progress = EquilibriumSolveProgress {
                done: true,
                iterations: state.iterations,
                max_steps: state.settings.max_steps,
                residual_norm: state.residual_norm,
            };
            return to_value(&progress)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }

        for _ in 0..batch_size {
            if state.residual_norm <= state.settings.tolerance {
                state.done = true;
                break;
            }

            if state.iterations >= state.settings.max_steps {
                return Err(JsValue::from_str(&format!(
                    "Newton solver failed to converge in {} steps (‖f(x)‖ = {}).",
                    state.settings.max_steps,
                    state.residual_norm
                )));
            }

            let jacobian = fork_core::equilibrium::compute_jacobian(
                &state.system,
                state.kind,
                &state.state,
            )
            .map_err(|e| JsValue::from_str(&format!("Jacobian failed: {}", e)))?;
            let delta = solve_linear_system(state.system.equations.len(), &jacobian, &state.residual)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

            for i in 0..state.state.len() {
                state.state[i] -= state.settings.damping * delta[i];
            }

            state.iterations += 1;
            evaluate_equilibrium_residual(&state.system, state.kind, &state.state, &mut state.residual);
            state.residual_norm = l2_norm(&state.residual);
        }

        let progress = EquilibriumSolveProgress {
            done: state.done,
            iterations: state.iterations,
            max_steps: state.settings.max_steps,
            residual_norm: state.residual_norm,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = EquilibriumSolveProgress {
            done: state.done,
            iterations: state.iterations,
            max_steps: state.settings.max_steps,
            residual_norm: state.residual_norm,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.residual_norm > state.settings.tolerance {
            return Err(JsValue::from_str("Equilibrium solver has not converged yet."));
        }

        let jacobian = compute_system_jacobian(&state.system, &state.state)
            .map_err(|e| JsValue::from_str(&format!("Jacobian failed: {}", e)))?;
        let eigenpairs = compute_equilibrium_eigenpairs(state.system.equations.len(), &jacobian)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let result = EquilibriumResult {
            state: state.state.clone(),
            residual_norm: state.residual_norm,
            iterations: state.iterations,
            jacobian,
            eigenpairs,
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

fn evaluate_equilibrium_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) {
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map => {
            system.apply(0.0, state, out);
            for i in 0..out.len() {
                out[i] -= state[i];
            }
        }
    }
}

fn solve_linear_system(dim: usize, jacobian: &[f64], residual: &[f64]) -> anyhow::Result<Vec<f64>> {
    let j_matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let rhs = DVector::from_column_slice(residual);
    j_matrix
        .lu()
        .solve(&rhs)
        .map(|v| v.iter().cloned().collect())
        .ok_or_else(|| anyhow::anyhow!("Jacobian is singular."))
}

fn compute_equilibrium_eigenpairs(
    dim: usize,
    jacobian: &[f64],
) -> anyhow::Result<Vec<EigenPair>> {
    let matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let eigenvalues = matrix.complex_eigenvalues();
    let complex_matrix = matrix.map(|v| Complex::new(v, 0.0));

    let mut pairs = Vec::with_capacity(dim);
    for idx in 0..dim {
        let lambda = eigenvalues[idx];

        let mut shifted = complex_matrix.clone();
        for i in 0..dim {
            shifted[(i, i)] -= lambda;
        }

        let svd = SVD::new(shifted, true, true);
        let v_t = svd
            .v_t
            .ok_or_else(|| anyhow::anyhow!("Failed to compute eigenvector for eigenvalue index {}", idx))?;
        let row_index = v_t.nrows().saturating_sub(1);
        let row = v_t.row(row_index);
        let mut vector: Vec<Complex<f64>> = row.iter().map(|c| *c).collect();
        normalize_complex_vector(&mut vector);

        pairs.push(EigenPair {
            value: fork_core::equilibrium::ComplexNumber::from(lambda),
            vector: vector
                .into_iter()
                .map(fork_core::equilibrium::ComplexNumber::from)
                .collect(),
        });
    }
    Ok(pairs)
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|v| v * v).sum::<f64>().sqrt()
}

fn normalize_complex_vector(vec: &mut [Complex<f64>]) {
    let norm = vec.iter().map(|c| c.norm_sqr()).sum::<f64>().sqrt();
    if norm > 0.0 {
        for entry in vec {
            *entry /= norm;
        }
    }
}
