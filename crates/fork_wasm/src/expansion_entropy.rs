use crate::system::build_system_with_context;
use fork_core::{
    equation_engine::{EquationSystem, ExpressionContext},
    expansion_entropy::{
        cartesian_cell_center, expansion_entropy_convergence, expansion_entropy_sample,
        ExpansionEntropySampleResult, ExpansionEntropyStepper,
    },
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct ExpansionEntropyProgress {
    done: bool,
    current_step: usize,
    max_steps: usize,
    points_computed: usize,
    bifurcations_found: usize,
    current_param: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpansionEntropyResult {
    checkpoints: Vec<f64>,
    horizon_kind: &'static str,
    log_mean_expansion: Vec<f64>,
    entropy_estimates: Vec<f64>,
    survivor_counts: Vec<usize>,
    survivor_fractions: Vec<f64>,
    total_samples: usize,
    max_log_condition_number: f64,
    conditioning_warning: bool,
}

struct ExpansionEntropyRunnerState {
    system: EquationSystem,
    solver: ExpansionEntropyStepper,
    horizon_kind: &'static str,
    bounds: Vec<(f64, f64)>,
    resolution: Vec<usize>,
    initial_time: f64,
    steps: usize,
    dt: f64,
    checkpoint_stride: usize,
    stabilization_stride: usize,
    total_samples: usize,
    samples_done: usize,
    sample_results: Vec<ExpansionEntropySampleResult>,
}

#[wasm_bindgen]
pub struct WasmExpansionEntropyRunner {
    state: Option<ExpansionEntropyRunnerState>,
}

#[wasm_bindgen]
impl WasmExpansionEntropyRunner {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        minimums: Vec<f64>,
        maximums: Vec<f64>,
        resolution: Vec<u32>,
        initial_time: f64,
        steps: u32,
        dt: f64,
        checkpoint_stride: u32,
        stabilization_stride: u32,
    ) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        if var_names.is_empty()
            || minimums.len() != var_names.len()
            || maximums.len() != var_names.len()
            || resolution.len() != var_names.len()
        {
            return Err(JsValue::from_str(
                "State Grid bounds and resolution must match the system dimension.",
            ));
        }
        if steps == 0 || checkpoint_stride == 0 || stabilization_stride == 0 {
            return Err(JsValue::from_str(
                "Steps and checkpoint/stabilization strides must be positive.",
            ));
        }
        if !dt.is_finite() || dt <= 0.0 {
            return Err(JsValue::from_str("Step size must be finite and positive."));
        }
        let (solver, expression_context, horizon_kind) = match solver_name {
            "rk4" => (
                ExpansionEntropyStepper::Rk4,
                ExpressionContext::FlowTime,
                "time",
            ),
            "tsit5" => (
                ExpansionEntropyStepper::Tsit5,
                ExpressionContext::FlowTime,
                "time",
            ),
            "discrete" => (
                ExpansionEntropyStepper::Discrete,
                ExpressionContext::MapIteration,
                "iteration",
            ),
            _ => {
                return Err(JsValue::from_str(
                    "Expansion entropy supports RK4/Tsit5 flows and discrete maps.",
                ))
            }
        };
        let system = build_system_with_context(
            equations,
            params,
            &param_names,
            &var_names,
            expression_context,
        )?;
        let bounds: Vec<(f64, f64)> = minimums.into_iter().zip(maximums).collect();
        let resolution: Vec<usize> = resolution.into_iter().map(|value| value as usize).collect();
        let mut total_samples = 1usize;
        for count in &resolution {
            if *count == 0 {
                return Err(JsValue::from_str(
                    "Each State Grid resolution must be at least 1.",
                ));
            }
            total_samples = total_samples
                .checked_mul(*count)
                .ok_or_else(|| JsValue::from_str("State Grid point count overflows usize."))?;
        }
        cartesian_cell_center(&bounds, &resolution, 0)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;

        Ok(Self {
            state: Some(ExpansionEntropyRunnerState {
                system,
                solver,
                horizon_kind,
                bounds,
                resolution,
                initial_time,
                steps: steps as usize,
                dt,
                checkpoint_stride: checkpoint_stride as usize,
                stabilization_stride: stabilization_stride as usize,
                total_samples,
                samples_done: 0,
                sample_results: Vec::with_capacity(total_samples),
            }),
        })
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        for _ in 0..batch_size.max(1) {
            if state.samples_done >= state.total_samples {
                break;
            }
            let initial_state =
                cartesian_cell_center(&state.bounds, &state.resolution, state.samples_done)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
            let result = expansion_entropy_sample(
                state.system.clone(),
                state.solver,
                &initial_state,
                &state.bounds,
                state.initial_time,
                state.steps,
                state.dt,
                state.checkpoint_stride,
                state.stabilization_stride,
            )
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
            state.sample_results.push(result);
            state.samples_done += 1;
        }
        to_value(&progress(state))
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        to_value(&progress(state))
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        if state.samples_done != state.total_samples {
            return Err(JsValue::from_str(
                "Expansion entropy calculation is not complete.",
            ));
        }
        let (checkpoints, entropy_estimates, survivor_counts) =
            expansion_entropy_convergence(&state.sample_results)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let log_mean_expansion = checkpoints
            .iter()
            .zip(&entropy_estimates)
            .map(|(horizon, estimate)| horizon * estimate)
            .collect();
        let survivor_fractions = survivor_counts
            .iter()
            .map(|count| *count as f64 / state.total_samples as f64)
            .collect();
        let max_log_condition_number = state
            .sample_results
            .iter()
            .map(|sample| sample.max_log_condition_number)
            .fold(0.0, f64::max);
        let conditioning_warning = state
            .sample_results
            .iter()
            .any(|sample| sample.conditioning_warning);
        to_value(&ExpansionEntropyResult {
            checkpoints,
            horizon_kind: state.horizon_kind,
            log_mean_expansion,
            entropy_estimates,
            survivor_counts,
            survivor_fractions,
            total_samples: state.total_samples,
            max_log_condition_number,
            conditioning_warning,
        })
        .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}

fn progress(state: &ExpansionEntropyRunnerState) -> ExpansionEntropyProgress {
    ExpansionEntropyProgress {
        done: state.samples_done >= state.total_samples,
        current_step: state.samples_done,
        max_steps: state.total_samples,
        points_computed: state.samples_done,
        bifurcations_found: 0,
        current_param: state.samples_done as f64,
    }
}
