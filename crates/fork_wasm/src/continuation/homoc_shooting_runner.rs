//! Standard single/multiple-shooting homoclinic continuation runner.

use super::runner_boundary::{serialize_js, OwnedContinuationRunner};
use crate::system::build_system;
use fork_core::continuation::homoclinic_shooting::{
    pack_homoclinic_shooting_state, HomoclinicShootingProblem, HomoclinicShootingSetup,
};
use fork_core::continuation::{
    BifurcationType, BranchType, ContinuationPoint, ContinuationSettings, HomoclinicBasisSnapshot,
    HomoclinicDiscretization, HomoclinicResumeContext,
};
use serde::Deserialize;
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmHomoclinicShootingRunner {
    runner: OwnedContinuationRunner<HomoclinicShootingProblem<'static>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
struct HomoclinicShootingRunnerOptions {
    #[serde(default)]
    projector_refresh_interval: Option<usize>,
}

#[wasm_bindgen]
impl WasmHomoclinicShootingRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHomoclinicShootingRunner, JsValue> {
        console_error_panic_hook::set_once();
        let mut setup: HomoclinicShootingSetup = from_value(setup_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid homoclinic shooting setup: {error}"))
        })?;
        let options: HomoclinicShootingRunnerOptions =
            from_value(settings_val.clone()).map_err(|error| {
                JsValue::from_str(&format!("Invalid homoclinic shooting options: {error}"))
            })?;
        if let Some(interval) = options.projector_refresh_interval {
            setup.projector_refresh_interval = interval;
        }
        let settings: ContinuationSettings = from_value(settings_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid continuation settings: {error}"))
        })?;
        let system = build_system(equations, params, &param_names, &var_names)?;
        let initial_point = ContinuationPoint {
            state: pack_homoclinic_shooting_state(&setup),
            param_value: setup.guess.param1_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: Some(setup.guess.nodes.clone()),
            homoclinic_events: None,
        };
        let mut runner = OwnedContinuationRunner::new(
            system,
            |system| HomoclinicShootingProblem::new(system, setup.clone()),
            initial_point,
            settings,
            forward,
            "homoclinic shooting",
        )?;
        runner
            .runner_mut()?
            .set_branch_type(BranchType::HomoclinicCurve {
                ntst: setup.shooting.intervals,
                ncol: 0,
                discretization: HomoclinicDiscretization::Shooting {
                    integration_steps_per_segment: setup.shooting.integration_steps_per_segment,
                },
                normalized_mesh: Vec::new(),
                collocation_adaptivity: Default::default(),
                collocation_adaptation: None,
                param1_name: setup.param1_name.clone(),
                param2_name: setup.param2_name.clone(),
                free_time: setup.extras.free_time,
                free_eps0: setup.extras.free_eps0,
                free_eps1: setup.extras.free_eps1,
            });
        runner
            .runner_mut()?
            .set_homoc_context(Some(HomoclinicResumeContext {
                base_params: setup.base_params.clone(),
                param1_index: setup.param1_index,
                param2_index: setup.param2_index,
                basis: HomoclinicBasisSnapshot {
                    stable_q: setup.basis.stable_q.clone(),
                    unstable_q: setup.basis.unstable_q.clone(),
                    dim: setup.basis.dim,
                    nneg: setup.basis.nneg,
                    npos: setup.basis.npos,
                },
                fixed_time: setup.guess.time,
                fixed_eps0: setup.guess.eps0,
                fixed_eps1: setup.guess.eps1,
                projector_refresh_interval: setup.projector_refresh_interval,
            }));
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
        branch.homoc_context = Some(problem.resume_context());
        serialize_js(&branch)
    }
}
