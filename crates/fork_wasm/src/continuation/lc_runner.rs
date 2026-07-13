//! Limit cycle continuation runner and mesh helpers.

use super::runner_boundary::{serialize_js, OwnedContinuationRunner};
use crate::system::build_system;
use fork_core::continuation::periodic::{
    correct_limit_cycle_setup, prepare_limit_cycle_setup, PeriodicOrbitCollocationProblem,
};
use fork_core::continuation::{
    BranchType, ContinuationPoint, ContinuationSettings, LimitCycleSetup,
};
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

fn validate_flow_system_type(system_type: &str) -> anyhow::Result<()> {
    if system_type != "flow" {
        anyhow::bail!("Limit-cycle collocation is available for flow systems only.");
    }
    Ok(())
}

#[cfg(test)]
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

#[cfg(test)]
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
    runner: OwnedContinuationRunner<PeriodicOrbitCollocationProblem<'static>>,
}

#[wasm_bindgen]
impl WasmLimitCycleRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        setup_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmLimitCycleRunner, JsValue> {
        console_error_panic_hook::set_once();

        validate_flow_system_type(system_type).map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;

        let param_index = *system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let (setup, flat_state) = if setup.guess.requires_fixed_parameter_correction {
            let correction_iterations = settings.corrector_steps.max(8);
            correct_limit_cycle_setup(
                &mut system,
                param_index,
                setup,
                settings.corrector_tolerance,
                correction_iterations,
            )
        } else {
            prepare_limit_cycle_setup(setup, system.equations.len())
        }
        .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let config = setup.collocation_config();
        let mesh_points = config.mesh_points;
        let degree = config.degree;
        let phase_anchor = config.phase_anchor.clone();
        let phase_direction = config.phase_direction.clone();

        let initial_point = ContinuationPoint {
            state: flat_state,
            param_value: setup.guess.param_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut runner = OwnedContinuationRunner::new(
            system,
            |system| {
                PeriodicOrbitCollocationProblem::new(
                    system,
                    param_index,
                    mesh_points,
                    degree,
                    phase_anchor,
                    phase_direction,
                )
            },
            initial_point,
            settings,
            forward,
            "LC",
        )?;
        runner
            .runner_mut()?
            .set_branch_type(BranchType::LimitCycle {
                ntst: mesh_points,
                ncol: degree,
            });

        Ok(WasmLimitCycleRunner { runner })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let branch = self.runner.take_result()?;
        serialize_js(&branch)
    }
}

#[cfg(test)]
mod tests {
    use super::{flatten_collocation_state, validate_flow_system_type, validate_mesh_states};

    #[test]
    fn limit_cycle_runner_rejects_map_systems() {
        let err = validate_flow_system_type("map").expect_err("maps must be rejected");
        assert!(err.to_string().contains("flow systems only"));
        validate_flow_system_type("flow").expect("flows must remain supported");
    }

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

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::WasmLimitCycleRunner;
    use fork_core::continuation::periodic::CollocationCoefficients;
    use fork_core::continuation::{
        BranchType, ContinuationBranch, ContinuationSettings, LimitCycleGuess, LimitCycleSetup,
    };
    use serde_wasm_bindgen::{from_value, to_value};
    use std::f64::consts::PI;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn settings_value(max_steps: usize) -> JsValue {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };
        to_value(&settings).expect("settings")
    }

    fn setup_value(mesh_points: usize, degree: usize) -> JsValue {
        let guess = LimitCycleGuess {
            param_value: 1.0,
            period: 1.0,
            mesh_states: vec![vec![0.0]; mesh_points],
            stage_states: Vec::new(),
            requires_fixed_parameter_correction: true,
        };
        let setup = LimitCycleSetup {
            guess,
            phase_anchor: vec![0.0],
            phase_direction: vec![1.0],
            mesh_points,
            collocation_degree: degree,
        };
        to_value(&setup).expect("setup")
    }

    fn periodic_setup_value(mesh_points: usize, degree: usize) -> JsValue {
        let period = 2.0 * PI;
        let mesh_states = (0..mesh_points)
            .map(|interval| {
                let phase = period * interval as f64 / mesh_points as f64;
                vec![phase.cos(), phase.sin()]
            })
            .collect::<Vec<_>>();
        let nodes = CollocationCoefficients::new(degree)
            .expect("collocation coefficients")
            .nodes;
        let stage_states = (0..mesh_points)
            .map(|interval| {
                nodes
                    .iter()
                    .map(|node| {
                        let phase = period * (interval as f64 + node) / mesh_points as f64;
                        vec![phase.cos(), phase.sin()]
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 1.0,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            mesh_points,
            collocation_degree: degree,
        };
        to_value(&setup).expect("periodic setup")
    }

    #[wasm_bindgen_test]
    fn limit_cycle_runner_rejects_unknown_parameter() {
        let result = WasmLimitCycleRunner::new(
            vec!["a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            setup_value(2, 1),
            "missing",
            settings_value(1),
            true,
        );

        assert!(result.is_err(), "should reject unknown parameter");
        let message = result
            .err()
            .and_then(|err| err.as_string())
            .unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }

    #[wasm_bindgen_test]
    fn limit_cycle_runner_rejects_map_systems() {
        let result = WasmLimitCycleRunner::new(
            vec!["a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "map",
            setup_value(2, 1),
            "a",
            settings_value(1),
            true,
        );

        let message = match result {
            Ok(_) => panic!("map limit-cycle continuation must be rejected"),
            Err(error) => error.as_string().unwrap_or_default(),
        };
        assert!(message.contains("flow systems only"));
    }

    #[wasm_bindgen_test]
    fn limit_cycle_runner_corrects_seed_before_runner_initialization() {
        let result = WasmLimitCycleRunner::new(
            vec!["1".to_string()],
            vec![0.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            setup_value(2, 1),
            "a",
            settings_value(0),
            true,
        );

        assert!(result.is_err(), "x'=1 has no positive-period orbit");
        let message = result
            .err()
            .and_then(|err| err.as_string())
            .unwrap_or_default();
        assert!(
            message.contains("Fixed-parameter limit-cycle correction failed"),
            "unexpected error: {message}"
        );
    }

    #[wasm_bindgen_test]
    fn limit_cycle_runner_sets_branch_type_and_state_shape() {
        let mesh_points = 8;
        let degree = 3;
        let mut runner = WasmLimitCycleRunner::new(
            vec!["-a * y".to_string(), "a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "flow",
            periodic_setup_value(mesh_points, degree),
            "a",
            settings_value(0),
            true,
        )
        .expect("runner");

        assert!(!runner.is_done());
        runner.run_steps(1).expect("run steps");
        assert!(runner.is_done());

        let result_val = runner.get_result().expect("result");
        let branch: ContinuationBranch = from_value(result_val).expect("branch");
        assert_eq!(
            branch.branch_type,
            BranchType::LimitCycle {
                ntst: mesh_points,
                ncol: degree,
            }
        );
        assert_eq!(branch.points.len(), 1);
        assert_eq!(branch.indices, vec![0]);
        let state = &branch.points[0].state;
        assert_eq!(state.len(), 2 * (mesh_points + mesh_points * degree) + 1);
        assert!(
            (state.last().copied().expect("period") - 2.0 * PI).abs() < 1e-3,
            "corrected rotation period should stay near 2pi"
        );
    }
}
