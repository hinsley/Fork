//! Stepped runner wrapper for 1D equilibrium manifolds.

use fork_core::continuation::{
    continue_manifold_eq_1d, ContinuationBranch, Manifold1DSettings, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEqManifold1DRunner {
    progress: StepResult,
    result: Option<Vec<ContinuationBranch>>,
}

#[wasm_bindgen]
impl WasmEqManifold1DRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        equilibrium_state: Vec<f64>,
        settings_val: JsValue,
    ) -> Result<WasmEqManifold1DRunner, JsValue> {
        console_error_panic_hook::set_once();
        if system_type == "map" {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }

        let settings: Manifold1DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            bytecodes.push(compiler.compile(&expr));
        }
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let branches = continue_manifold_eq_1d(&mut system, &equilibrium_state, settings)
            .map_err(|e| JsValue::from_str(&format!("1D manifold computation failed: {}", e)))?;
        let points = branches.iter().map(|branch| branch.points.len()).sum();
        let last_param = branches
            .iter()
            .flat_map(|branch| branch.points.last().map(|point| point.param_value))
            .fold(0.0, f64::max);
        let progress = StepResult::new(true, 1, 1, points, 0, last_param);
        Ok(WasmEqManifold1DRunner {
            progress,
            result: Some(branches),
        })
    }

    pub fn is_done(&self) -> bool {
        true
    }

    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let result = self
            .result
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
