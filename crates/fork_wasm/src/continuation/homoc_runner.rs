//! Homoclinic continuation runner.

use crate::system::build_system;
use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::{
    pack_homoclinic_state, BranchType, ContinuationPoint, ContinuationRunner,
    ContinuationSettings, HomoclinicSetup,
};
use fork_core::equation_engine::EquationSystem;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmHomoclinicRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<HomoclinicProblem<'static>>>,
}

#[wasm_bindgen]
impl WasmHomoclinicRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHomoclinicRunner, JsValue> {
        console_error_panic_hook::set_once();

        let setup: HomoclinicSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid homoclinic setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let system = build_system(equations, params, &param_names, &var_names)?;
        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;

        let problem = HomoclinicProblem::new(unsafe { &mut *system_ptr }, setup.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to create homoclinic problem: {}", e)))?;
        let problem: HomoclinicProblem<'static> = unsafe { std::mem::transmute(problem) };

        let initial_point = ContinuationPoint {
            state: pack_homoclinic_state(&setup),
            param_value: setup.guess.param1_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;
        runner.set_branch_type(BranchType::HomoclinicCurve {
            ntst: setup.ntst,
            ncol: setup.ncol,
            param1_name: setup.param1_name.clone(),
            param2_name: setup.param2_name.clone(),
            free_time: setup.extras.free_time,
            free_eps0: setup.extras.free_eps0,
            free_eps1: setup.extras.free_eps1,
        });

        Ok(WasmHomoclinicRunner {
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
        to_value(&runner.step_result())
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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

