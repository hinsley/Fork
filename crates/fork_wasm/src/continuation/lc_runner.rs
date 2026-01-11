//! Limit cycle continuation runner and mesh helpers.

use crate::system::build_system;
use fork_core::continuation::periodic::{
    CollocationCoefficients, PeriodicOrbitCollocationProblem,
};
use fork_core::continuation::{
    BranchType, ContinuationPoint, ContinuationRunner, ContinuationSettings, LimitCycleSetup,
};
use fork_core::equation_engine::EquationSystem;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn validate_mesh_states(
    state_dim: usize,
    mesh_points: usize,
    states: &[Vec<f64>],
) -> anyhow::Result<()> {
    if states.len() != mesh_points {
        anyhow::bail!(
            "Initial guess must provide {} mesh states (got {})",
            mesh_points,
            states.len()
        );
    }
    for slice in states {
        if slice.len() != state_dim {
            anyhow::bail!(
                "State slice length {} does not match system dimension {}",
                slice.len(),
                state_dim
            );
        }
    }
    Ok(())
}

fn build_stage_states_from_mesh(
    dim: usize,
    mesh_points: usize,
    degree: usize,
    nodes: &[f64],
    mesh_states: &[Vec<f64>],
) -> Vec<Vec<Vec<f64>>> {
    let mut stage_states = Vec::with_capacity(mesh_points);
    for i in 0..mesh_points {
        let next = if i + 1 == mesh_points {
            &mesh_states[0]
        } else {
            &mesh_states[i + 1]
        };
        let current = &mesh_states[i];
        let mut stages = Vec::with_capacity(degree);
        for &node in nodes {
            let mut stage = vec![0.0; dim];
            for d in 0..dim {
                stage[d] = current[d] + node * (next[d] - current[d]);
            }
            stages.push(stage);
        }
        stage_states.push(stages);
    }
    stage_states
}

fn flatten_collocation_state(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    period: f64,
) -> Vec<f64> {
    let mesh_flat: Vec<f64> = mesh_states.iter().flatten().cloned().collect();
    let stage_flat: Vec<f64> = stage_states.iter().flatten().flatten().cloned().collect();
    let mut flat = Vec::with_capacity(mesh_flat.len() + stage_flat.len() + 1);
    flat.extend(mesh_flat);
    flat.extend(stage_flat);
    flat.push(period);
    flat
}

#[wasm_bindgen]
pub struct WasmLimitCycleRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<PeriodicOrbitCollocationProblem<'static>>>,
}

#[wasm_bindgen]
impl WasmLimitCycleRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        _system_type: &str,
        setup_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmLimitCycleRunner, JsValue> {
        console_error_panic_hook::set_once();

        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let system = build_system(equations, params, &param_names, &var_names)?;

        let param_index = *system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let config = setup.collocation_config();
        let dim = system.equations.len();
        validate_mesh_states(dim, config.mesh_points, &setup.guess.mesh_states)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let stage_states = if setup.guess.stage_states.is_empty() {
            let coeffs = CollocationCoefficients::new(config.degree)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            build_stage_states_from_mesh(
                dim,
                config.mesh_points,
                config.degree,
                &coeffs.nodes,
                &setup.guess.mesh_states,
            )
        } else {
            setup.guess.stage_states.clone()
        };

        let flat_state = flatten_collocation_state(
            &setup.guess.mesh_states,
            &stage_states,
            setup.guess.period,
        );

        let initial_point = ContinuationPoint {
            state: flat_state,
            param_value: setup.guess.param_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
        };

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = PeriodicOrbitCollocationProblem::new(
            unsafe { &mut *system_ptr },
            param_index,
            config.mesh_points,
            config.degree,
            config.phase_anchor,
            config.phase_direction,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create LC problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: PeriodicOrbitCollocationProblem<'static> =
            unsafe { std::mem::transmute(problem) };

        let mut runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;
        runner.set_branch_type(BranchType::LimitCycle {
            ntst: config.mesh_points,
            ncol: config.degree,
        });

        Ok(WasmLimitCycleRunner {
            system: boxed_system,
            runner: Some(runner),
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::{flatten_collocation_state, validate_mesh_states};

    #[test]
    fn validate_mesh_states_rejects_wrong_count() {
        let states = vec![vec![0.0]];
        let err = validate_mesh_states(1, 2, &states).expect_err("should reject count mismatch");
        let message = err.to_string();
        assert!(message.contains("mesh states"));
    }

    #[test]
    fn flatten_collocation_state_appends_period() {
        let mesh_states = vec![vec![1.0], vec![2.0]];
        let stage_states = vec![vec![vec![1.5]], vec![vec![2.5]]];
        let flat = flatten_collocation_state(&mesh_states, &stage_states, 3.0);

        assert_eq!(flat, vec![1.0, 2.0, 1.5, 2.5, 3.0]);
    }
}
