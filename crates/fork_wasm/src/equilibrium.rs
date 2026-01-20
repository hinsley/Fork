//! Equilibrium solver runner and helpers.

use crate::system::{build_system, SystemType, WasmSystem};
use fork_core::traits::DynamicalSystem;
use fork_core::equilibrium::{
    compute_system_jacobian, evaluate_equilibrium_residual,
    solve_equilibrium as core_equilibrium_solver, EigenPair, EquilibriumResult, NewtonSettings,
    SystemKind,
};
use fork_core::equation_engine::EquationSystem;
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
        map_iterations: u32,
    ) -> Result<JsValue, JsValue> {
        let settings = NewtonSettings {
            max_steps: max_steps as usize,
            damping,
            ..NewtonSettings::default()
        };

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
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
        map_iterations: u32,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
    ) -> Result<WasmEquilibriumSolverRunner, JsValue> {
        console_error_panic_hook::set_once();

        let system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
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
        evaluate_equilibrium_residual(&system, kind, &state, &mut residual)
            .map_err(|e| JsValue::from_str(&format!("Residual failed: {}", e)))?;
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
            evaluate_equilibrium_residual(
                &state.system,
                state.kind,
                &state.state,
                &mut state.residual,
            )
            .map_err(|e| JsValue::from_str(&format!("Residual failed: {}", e)))?;
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

        let jacobian = compute_system_jacobian(&state.system, state.kind, &state.state)
            .map_err(|e| JsValue::from_str(&format!("Jacobian failed: {}", e)))?;
        let eigenpairs = compute_equilibrium_eigenpairs(state.system.equations.len(), &jacobian)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
        let cycle_points = match state.kind {
            SystemKind::Map { iterations } if iterations > 1 => {
                Some(compute_map_cycle_points(&state.system, &state.state, iterations))
            }
            _ => None,
        };

        let result = EquilibriumResult {
            state: state.state.clone(),
            residual_norm: state.residual_norm,
            iterations: state.iterations,
            jacobian,
            eigenpairs,
            cycle_points,
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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

fn compute_map_cycle_points(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
) -> Vec<Vec<f64>> {
    let dim = system.equations.len();
    let mut points = Vec::with_capacity(iterations.max(1));
    points.push(state.to_vec());
    if iterations <= 1 {
        return points;
    }

    let mut current = state.to_vec();
    let mut next = vec![0.0; dim];
    for _ in 1..iterations {
        system.apply(0.0, &current, &mut next);
        points.push(next.clone());
        std::mem::swap(&mut current, &mut next);
    }
    points
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

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_wrapper_tests {
    use super::*;

    #[test]
    fn runner_rejects_zero_dimension_system() {
        let result = WasmEquilibriumSolverRunner::new(
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            "flow",
            1,
            Vec::new(),
            10,
            1.0,
        );

        assert!(result.is_err(), "expected error for zero-dimension system");
    }

    #[test]
    fn runner_rejects_initial_guess_dimension_mismatch() {
        let result = WasmEquilibriumSolverRunner::new(
            vec!["x".to_string()],
            Vec::new(),
            Vec::new(),
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0, 1.0],
            10,
            1.0,
        );

        assert!(result.is_err(), "expected error for initial guess mismatch");
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn runner_progresses_and_completes() {
        let mut runner = WasmEquilibriumSolverRunner::new(
            vec!["x".to_string()],
            Vec::new(),
            Vec::new(),
            vec!["x".to_string()],
            "flow",
            1,
            vec![1.0],
            10,
            1.0,
        )
        .expect("runner");

        assert!(runner.get_result().is_err(), "expected not converged yet");

        let state = runner.state.as_ref().expect("state");
        assert!(!state.done);
        assert!(state.residual_norm > 0.0);

        runner.run_steps(1).expect("run steps");
        let state = runner.state.as_ref().expect("state");
        assert_eq!(state.iterations, 1);
        assert!(state.residual_norm <= state.settings.tolerance);
        assert!(!state.done);

        runner.run_steps(1).expect("run steps");
        let state = runner.state.as_ref().expect("state");
        assert!(state.done);
        assert!(runner.is_done());

        assert!(runner.get_result().is_ok(), "expected converged result");
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_value_tests {
    use super::WasmEquilibriumSolverRunner;
    use crate::system::WasmSystem;
    use fork_core::equilibrium::EquilibriumResult;
    use serde_wasm_bindgen::from_value;

    fn build_linear_system() -> WasmSystem {
        WasmSystem::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "rk4",
            "flow",
        )
        .expect("system should build")
    }

    fn build_identity_map_system() -> WasmSystem {
        WasmSystem::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "discrete",
            "map",
        )
        .expect("system should build")
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn solve_equilibrium_converges_for_linear_system() {
        let system = build_linear_system();
        let result_val = system
            .solve_equilibrium(vec![1.0], 8, 1.0, 1)
            .expect("solve equilibrium");
        let result: EquilibriumResult = from_value(result_val).expect("decode result");

        assert!(result.state[0].abs() < 1e-6);
        assert!(result.iterations <= 8);
    }

    #[test]
    fn solve_equilibrium_reports_core_errors() {
        let system = build_linear_system();
        let err = system
            .solve_equilibrium(vec![1.0], 0, 1.0, 1)
            .expect_err("expected error");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Equilibrium solve failed"));
        assert!(message.contains("max_steps must be greater than zero"));
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn solve_equilibrium_converges_for_identity_map() {
        let system = build_identity_map_system();
        let result_val = system
            .solve_equilibrium(vec![2.0], 4, 1.0, 1)
            .expect("solve fixed point");
        let result: EquilibriumResult = from_value(result_val).expect("decode result");

        assert!(result.residual_norm.abs() < 1e-12);
        assert_eq!(result.iterations, 0);
    }

    #[test]
    fn equilibrium_runner_rejects_dimension_mismatch() {
        let result = WasmEquilibriumSolverRunner::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "flow",
            1,
            vec![1.0, 2.0],
            5,
            1.0,
        );

        assert!(result.is_err(), "should error on dimension mismatch");
        let message = result.err().and_then(|err| err.as_string()).unwrap_or_default();
        assert!(message.contains("Initial guess dimension mismatch"));
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn equilibrium_runner_requires_convergence_for_result() {
        let runner = WasmEquilibriumSolverRunner::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "flow",
            1,
            vec![1.0],
            5,
            1.0,
        )
        .expect("runner");

        let err = match runner.get_result() {
            Ok(_) => panic!("expected convergence error before get_result"),
            Err(err) => err,
        };
        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("not converged"));
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn equilibrium_runner_marks_done_when_residual_is_small() {
        let mut runner = WasmEquilibriumSolverRunner::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            5,
            1.0,
        )
        .expect("runner");

        assert!(!runner.is_done(), "runner should start as not done");
        runner.run_steps(1).expect("run steps");
        assert!(runner.is_done(), "runner should mark done after step");
    }
}
