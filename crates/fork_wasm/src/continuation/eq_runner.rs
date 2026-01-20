//! Stepped equilibrium continuation runner.

use super::shared::OwnedEquilibriumContinuationProblem;
use fork_core::continuation::{ContinuationPoint, ContinuationRunner, ContinuationSettings};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;


/// WASM-exported runner for stepped equilibrium continuation.
/// Allows progress reporting by running batches of steps at a time.
#[wasm_bindgen]
pub struct WasmEquilibriumRunner {
    runner: Option<ContinuationRunner<OwnedEquilibriumContinuationProblem>>,
}

#[wasm_bindgen]
impl WasmEquilibriumRunner {
    /// Create a new stepped equilibrium continuation runner.
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmEquilibriumRunner, JsValue> {
        console_error_panic_hook::set_once();

        // Parse equations and create system
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            let code = compiler.compile(&expr);
            bytecodes.push(code);
        }

        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
            _ => SystemKind::Flow,
        };

        let param_index = *system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let initial_point = ContinuationPoint {
            state: equilibrium_state,
            param_value: system.params[param_index],
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let problem = OwnedEquilibriumContinuationProblem::new(system, kind, param_index);

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmEquilibriumRunner {
            runner: Some(runner),
        })
    }

    /// Check if the continuation is complete.
    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    /// Run a batch of continuation steps and return progress.
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

    /// Get progress information.
    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Get the final branch result.
    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use fork_core::continuation::ContinuationSettings;

    fn settings_with_max_steps(max_steps: usize) -> JsValue {
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

    fn build_runner(max_steps: usize) -> WasmEquilibriumRunner {
        WasmEquilibriumRunner::new(
            vec!["a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "a",
            settings_with_max_steps(max_steps),
            true,
        )
        .expect("runner")
    }

    #[test]
    fn equilibrium_runner_handles_zero_steps() {
        let settings_val = settings_with_max_steps(0);
        let mut runner = WasmEquilibriumRunner::new(
            vec!["a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "a",
            settings_val,
            true,
        )
        .expect("runner");

        assert!(!runner.is_done());
        runner.run_steps(1).expect("run steps");
        assert!(runner.is_done());
        assert!(runner.get_result().is_ok());
    }

    #[test]
    fn equilibrium_runner_rejects_unknown_parameter() {
        let result = WasmEquilibriumRunner::new(
            vec!["x".to_string()],
            vec![1.0],
            vec!["p".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "missing",
            settings_with_max_steps(3),
            true,
        );

        assert!(result.is_err(), "should reject unknown parameter");
        let message = result.err().and_then(|err| err.as_string()).unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }

    #[test]
    fn equilibrium_runner_rejects_invalid_settings() {
        let result = WasmEquilibriumRunner::new(
            vec!["a * x".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "a",
            JsValue::from_str("nope"),
            true,
        );

        assert!(result.is_err(), "should reject invalid settings");
        let message = result.err().and_then(|err| err.as_string()).unwrap_or_default();
        assert!(message.contains("Invalid continuation settings"));
    }

    #[test]
    fn equilibrium_runner_rejects_invalid_equation() {
        let result = WasmEquilibriumRunner::new(
            vec!["1 +".to_string()],
            vec![1.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "a",
            settings_with_max_steps(1),
            true,
        );

        assert!(result.is_err(), "should reject invalid equation");
        let message = result.err().and_then(|err| err.as_string()).unwrap_or_default();
        assert!(message.contains("Unexpected token"));
    }

    #[test]
    fn equilibrium_runner_errors_after_result_taken() {
        let mut runner = build_runner(0);
        runner.run_steps(1).expect("run steps");
        runner.get_result().expect("result");

        let err = runner.run_steps(1).expect_err("runner should be consumed");
        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Runner not initialized"));
    }
}
