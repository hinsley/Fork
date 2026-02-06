//! Homotopy-saddle continuation runner.

use crate::system::build_system;
use fork_core::continuation::{
    continue_homotopy_saddle_curve, ContinuationBranch, ContinuationSettings, HomotopySaddleSetup,
    StepResult,
};
use fork_core::equation_engine::EquationSystem;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmHomotopySaddleRunner {
    system: Option<EquationSystem>,
    setup: Option<HomotopySaddleSetup>,
    settings: ContinuationSettings,
    forward: bool,
    result: Option<ContinuationBranch>,
    current_step: usize,
    done: bool,
}

#[wasm_bindgen]
impl WasmHomotopySaddleRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHomotopySaddleRunner, JsValue> {
        console_error_panic_hook::set_once();
        let setup: HomotopySaddleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid homotopy-saddle setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;
        let system = build_system(equations, params, &param_names, &var_names)?;

        Ok(WasmHomotopySaddleRunner {
            system: Some(system),
            setup: Some(setup),
            settings,
            forward,
            result: None,
            current_step: 0,
            done: false,
        })
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        if self.done {
            return self.get_progress();
        }
        let mut system = self
            .system
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        let setup = self
            .setup
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        let branch = continue_homotopy_saddle_curve(
            &mut system,
            setup,
            self.settings,
            self.forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Homotopy-saddle continuation failed: {}", e)))?;
        self.current_step = self.settings.max_steps;
        self.done = true;
        self.result = Some(branch);
        self.system = Some(system);
        self.get_progress()
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let (points, bifs, current_param) = match self.result.as_ref() {
            Some(branch) => {
                let param = branch
                    .points
                    .last()
                    .map(|point| point.param_value)
                    .unwrap_or(0.0);
                (branch.points.len(), branch.bifurcations.len(), param)
            }
            None => (0usize, 0usize, 0.0),
        };

        let progress = StepResult::new(
            self.done,
            self.current_step,
            self.settings.max_steps,
            points,
            bifs,
            current_param,
        );
        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let branch = self
            .result
            .take()
            .ok_or_else(|| JsValue::from_str("Continuation result is not available yet"))?;
        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

