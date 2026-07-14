//! Genuine two-equilibrium heteroclinic continuation runner.

use super::runner_boundary::{serialize_js, OwnedContinuationRunner};
use crate::system::build_system;
use fork_core::continuation::periodic::CollocationAdaptivitySettings;
use fork_core::continuation::{
    pack_heteroclinic_state, BifurcationType, BranchType, ContinuationPoint, ContinuationSettings,
    HeteroclinicProblem, HeteroclinicSetupV1,
};
use serde::Deserialize;
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, Deserialize, Default)]
struct HeteroclinicRunnerOptions {
    #[serde(default)]
    collocation_adaptivity: Option<CollocationAdaptivitySettings>,
    #[serde(default)]
    projector_refresh_interval: Option<usize>,
}

#[wasm_bindgen]
pub struct WasmHeteroclinicRunner {
    runner: OwnedContinuationRunner<HeteroclinicProblem<'static>>,
}

#[wasm_bindgen]
impl WasmHeteroclinicRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHeteroclinicRunner, JsValue> {
        console_error_panic_hook::set_once();
        let mut setup: HeteroclinicSetupV1 = from_value(setup_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid heteroclinic setup: {error}")))?;
        let options: HeteroclinicRunnerOptions =
            from_value(settings_val.clone()).map_err(|error| {
                JsValue::from_str(&format!("Invalid heteroclinic options: {error}"))
            })?;
        if let Some(adaptivity) = options.collocation_adaptivity {
            setup.collocation_adaptivity = adaptivity;
        }
        if let Some(interval) = options.projector_refresh_interval {
            setup.projector_refresh_interval = interval;
        }
        let settings: ContinuationSettings = from_value(settings_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid continuation settings: {error}"))
        })?;
        let system = build_system(equations, params, &param_names, &var_names)?;
        let initial_point = ContinuationPoint {
            state: pack_heteroclinic_state(&setup),
            param_value: setup.guess.param1_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        };
        let initial_branch_type = BranchType::HeteroclinicCurve {
            schema: setup.connection_schema(),
            ntst: setup.ntst,
            ncol: setup.ncol,
            normalized_mesh: setup.resolved_normalized_mesh().map_err(|error| {
                JsValue::from_str(&format!("Invalid heteroclinic mesh: {error}"))
            })?,
            collocation_adaptivity: setup.collocation_adaptivity,
            collocation_adaptation: setup.collocation_adaptation.clone(),
            param1_name: setup.param1_name.clone(),
            param2_name: setup.param2_name.clone(),
            free_time: setup.extras.free_time,
            free_eps0: setup.extras.free_eps0,
            free_eps1: setup.extras.free_eps1,
        };
        let mut runner = OwnedContinuationRunner::new(
            system,
            |system| HeteroclinicProblem::new(system, setup.clone()),
            initial_point,
            settings,
            forward,
            "heteroclinic",
        )?;
        runner.runner_mut()?.set_branch_type(initial_branch_type);
        Ok(Self { runner })
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
        let (mut branch, problem) = self.runner.take_result_with_problem()?;
        branch.branch_type = problem.branch_type_metadata();
        serialize_js(&branch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heteroclinic_options_support_partial_overrides() {
        let options: HeteroclinicRunnerOptions = serde_json::from_value(serde_json::json!({
            "projector_refresh_interval": 1,
            "collocation_adaptivity": { "enabled": false }
        }))
        .expect("partial heteroclinic options");
        assert_eq!(options.projector_refresh_interval, Some(1));
        assert!(!options.collocation_adaptivity.expect("adaptivity").enabled);
    }
}
