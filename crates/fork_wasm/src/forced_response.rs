//! Live-context forced periodic response solving and continuation.

use crate::continuation::runner_boundary::{serialize_js, OwnedContinuationRunner};
use crate::system::{build_system_with_context, SolverType, SystemType, WasmSystem};
use fork_core::continuation::{
    BifurcationType, BranchType, ContinuationPoint, ContinuationSettings,
};
use fork_core::equation_engine::ExpressionContext;
use fork_core::equilibrium::NewtonSettings;
use fork_core::forced_response::{
    solve_forced_response, FlowIntegrator, ForcedResponseContinuationProblem, PeriodicForcing,
    StroboscopicMap, StroboscopicSettings,
};
use fork_core::state_periodicity::StatePeriodicity;
use js_sys::{Array, Reflect};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn forcing_for_type(
    system_type: &SystemType,
    parameter_names: &[String],
    period_expression: &str,
    iteration_period: u32,
) -> anyhow::Result<PeriodicForcing> {
    match system_type {
        SystemType::Flow => {
            if period_expression.trim().is_empty() {
                anyhow::bail!("Flow stroboscopic analysis requires a forcing-period expression");
            }
            PeriodicForcing::flow(period_expression, parameter_names)
        }
        SystemType::Map => PeriodicForcing::map(iteration_period as usize),
    }
}

fn integrator_for_solver(solver: &SolverType) -> FlowIntegrator {
    match solver {
        SolverType::RK4(_) => FlowIntegrator::Rk4,
        SolverType::Tsit5(_) | SolverType::Discrete(_) => FlowIntegrator::Tsit5,
    }
}

fn branch_type(
    forcing: &PeriodicForcing,
    integrator: FlowIntegrator,
    stroboscopic: StroboscopicSettings,
) -> BranchType {
    BranchType::ForcedPeriodicResponse {
        symbol: if matches!(forcing, PeriodicForcing::Flow { .. }) {
            "t"
        } else {
            "n"
        }
        .to_string(),
        period_expression: forcing.period_expression().map(ToString::to_string),
        iteration_period: forcing.iteration_period(),
        phase: stroboscopic.phase,
        response_multiple: stroboscopic.response_multiple,
        steps_per_forcing_period: stroboscopic.steps_per_forcing_period,
        integrator: match integrator {
            FlowIntegrator::Rk4 => "rk4",
            FlowIntegrator::Tsit5 => "tsit5",
        }
        .to_string(),
    }
}

#[wasm_bindgen]
impl WasmSystem {
    pub fn validate_periodic_forcing(
        &self,
        period_expression: &str,
        iteration_period: u32,
    ) -> Result<f64, JsValue> {
        if !self.system.uses_context() {
            return Err(JsValue::from_str(
                "Periodic forcing can only be declared when equations use the contextual t/n symbol.",
            ));
        }
        forcing_for_type(
            &self.system_type,
            &self.param_names,
            period_expression,
            iteration_period,
        )
        .and_then(|forcing| forcing.resolved_period(&self.system.params))
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn advance_forced_response_seed(
        &self,
        period_expression: &str,
        iteration_period: u32,
        phase: f64,
        steps_per_forcing_period: u32,
        initial_context: f64,
        initial_state: Vec<f64>,
    ) -> Result<JsValue, JsValue> {
        if !self.system.uses_context() {
            return Err(JsValue::from_str(
                "Periodic forcing can only be declared when equations use the contextual t/n symbol.",
            ));
        }
        let forcing = forcing_for_type(
            &self.system_type,
            &self.param_names,
            period_expression,
            iteration_period,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let map = StroboscopicMap::new(
            &self.system,
            forcing,
            integrator_for_solver(&self.solver),
            StroboscopicSettings {
                phase,
                response_multiple: 1,
                steps_per_forcing_period: steps_per_forcing_period as usize,
            },
            self.periodicity.clone(),
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let advanced = map
            .advance_seed_to_strobe(initial_context, &initial_state)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        to_value(&advanced)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn solve_forced_response(
        &self,
        period_expression: &str,
        iteration_period: u32,
        phase: f64,
        response_multiple: u32,
        steps_per_forcing_period: u32,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        if !self.system.uses_context() {
            return Err(JsValue::from_str(
                "Periodic forcing can only be declared when equations use the contextual t/n symbol.",
            ));
        }
        let forcing = forcing_for_type(
            &self.system_type,
            &self.param_names,
            period_expression,
            iteration_period,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let stroboscopic = StroboscopicSettings {
            phase,
            response_multiple: response_multiple as usize,
            steps_per_forcing_period: steps_per_forcing_period as usize,
        };
        let result = solve_forced_response(
            &self.system,
            forcing,
            integrator_for_solver(&self.solver),
            stroboscopic,
            &initial_guess,
            NewtonSettings {
                max_steps: max_steps as usize,
                damping,
                tolerance,
            },
            &self.periodicity,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Forced periodic response solve failed: {error}"))
        })?;
        to_value(&result)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}

#[wasm_bindgen]
pub struct WasmForcedResponseRunner {
    runner: OwnedContinuationRunner<ForcedResponseContinuationProblem<'static>>,
    branch_type: BranchType,
}

#[wasm_bindgen]
impl WasmForcedResponseRunner {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        system_type: &str,
        period_expression: &str,
        iteration_period: u32,
        phase: f64,
        response_multiple: u32,
        steps_per_forcing_period: u32,
        initial_state: Vec<f64>,
        parameter_name: &str,
        settings_value: JsValue,
        forward: bool,
        periods: Vec<f64>,
    ) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        let (system_kind, context) = match system_type {
            "map" => (SystemType::Map, ExpressionContext::MapIteration),
            _ => (SystemType::Flow, ExpressionContext::FlowTime),
        };
        let system =
            build_system_with_context(equations, params, &param_names, &var_names, context)?;
        if !system.uses_context() {
            return Err(JsValue::from_str(
                "Periodic forcing can only be declared when equations use the contextual t/n symbol.",
            ));
        }
        let forcing = forcing_for_type(
            &system_kind,
            &param_names,
            period_expression,
            iteration_period,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let parameter_index = *system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {parameter_name}")))?;
        let continuation: ContinuationSettings = from_value(settings_value).map_err(|error| {
            JsValue::from_str(&format!("Invalid continuation settings: {error}"))
        })?;
        let integrator = match (system_type, solver_name) {
            ("map", _) => FlowIntegrator::Tsit5,
            (_, "rk4") => FlowIntegrator::Rk4,
            (_, "tsit5") => FlowIntegrator::Tsit5,
            _ => return Err(JsValue::from_str("Unknown flow integrator")),
        };
        let stroboscopic = StroboscopicSettings {
            phase,
            response_multiple: response_multiple as usize,
            steps_per_forcing_period: steps_per_forcing_period as usize,
        };
        let periodicity = StatePeriodicity::from_periods(&periods, var_names.len());
        let mut initial_state = initial_state;
        periodicity.wrap_state(&mut initial_state);
        let initial_point = ContinuationPoint {
            state: initial_state,
            param_value: system.params[parameter_index],
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let stored_branch_type = branch_type(&forcing, integrator, stroboscopic);
        let forcing_for_problem = forcing.clone();
        let periodicity_for_problem = periodicity.clone();
        let mut runner = OwnedContinuationRunner::new(
            system,
            move |system| {
                ForcedResponseContinuationProblem::new(
                    system,
                    forcing_for_problem,
                    parameter_index,
                    integrator,
                    stroboscopic,
                    periodicity_for_problem,
                )
            },
            initial_point,
            continuation,
            forward,
            "forced-response",
        )?;
        runner
            .runner_mut()?
            .set_branch_type(stored_branch_type.clone());
        Ok(Self {
            runner,
            branch_type: stored_branch_type,
        })
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
        let (mut branch, mut problem) = self.runner.take_result_with_problem()?;
        branch.branch_type = self.branch_type.clone();
        let metadata = branch
            .points
            .iter()
            .map(|point| {
                let point_count = point.cycle_points.as_ref().map_or(0, Vec::len);
                problem
                    .trajectory_metadata_at_parameter(point.param_value, point_count)
                    .map_err(|error| JsValue::from_str(&error.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let value = serialize_js(&branch)?;
        let points = Array::from(&Reflect::get(&value, &JsValue::from_str("points"))?);
        for (index, point_metadata) in metadata.iter().enumerate() {
            let point = points.get(index as u32);
            Reflect::set(
                &point,
                &JsValue::from_str("cycle_contexts"),
                &to_value(&point_metadata.contexts)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?,
            )?;
            Reflect::set(
                &point,
                &JsValue::from_str("forcing_period"),
                &JsValue::from_f64(point_metadata.forcing_period),
            )?;
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::forcing_for_type;
    use crate::system::SystemType;

    #[test]
    fn forcing_declarations_follow_system_type() {
        let params = vec!["omega".to_string()];
        let flow = forcing_for_type(&SystemType::Flow, &params, "tau / omega", 0).unwrap();
        assert_eq!(flow.period_expression(), Some("tau / omega"));
        let map = forcing_for_type(&SystemType::Map, &params, "", 3).unwrap();
        assert_eq!(map.iteration_period(), Some(3));
        assert!(forcing_for_type(&SystemType::Map, &params, "", 0).is_err());
    }
}
