use crate::{expansion_entropy_worker_count, system::build_system_with_context};
use fork_core::{
    equation_engine::{EquationSystem, ExpressionContext},
    expansion_entropy::{
        ExpansionEntropyConfig, ExpansionEntropyExecutionMode, ExpansionEntropyExecutor,
        ExpansionEntropyStepper,
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
    execution_mode: &'static str,
    worker_count: usize,
}

struct ExpansionEntropyRunnerState {
    horizon_kind: &'static str,
    executor: ExpansionEntropyExecutor<EquationSystem>,
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
        #[cfg(feature = "wasm-threads")]
        let execution_mode = ExpansionEntropyExecutionMode::Parallel;
        #[cfg(not(feature = "wasm-threads"))]
        let execution_mode = ExpansionEntropyExecutionMode::Serial;
        let executor = ExpansionEntropyExecutor::new(
            system,
            ExpansionEntropyConfig {
                solver,
                bounds,
                resolution,
                initial_time,
                steps: steps as usize,
                dt,
                checkpoint_stride: checkpoint_stride as usize,
                stabilization_stride: stabilization_stride as usize,
            },
            execution_mode,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

        Ok(Self {
            state: Some(ExpansionEntropyRunnerState {
                horizon_kind,
                executor,
            }),
        })
    }

    pub fn advance(&mut self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        state
            .executor
            .advance()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        to_value(&progress(state))
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        self.advance()
    }

    pub fn cancel(&self) -> Result<(), JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        state.executor.cancel();
        Ok(())
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
        let aggregate = state
            .executor
            .result()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let checkpoints = aggregate.checkpoints;
        let entropy_estimates = aggregate.entropy_estimates;
        let survivor_counts = aggregate.survivor_counts;
        let log_mean_expansion = checkpoints
            .iter()
            .zip(&entropy_estimates)
            .map(|(horizon, estimate)| horizon * estimate)
            .collect();
        let survivor_fractions = survivor_counts
            .iter()
            .map(|count| *count as f64 / aggregate.total_samples as f64)
            .collect();
        to_value(&ExpansionEntropyResult {
            checkpoints,
            horizon_kind: state.horizon_kind,
            log_mean_expansion,
            entropy_estimates,
            survivor_counts,
            survivor_fractions,
            total_samples: aggregate.total_samples,
            max_log_condition_number: aggregate.max_log_condition_number,
            conditioning_warning: aggregate.conditioning_warning,
            execution_mode: if expansion_entropy_worker_count() > 0 {
                "parallel"
            } else {
                "serial"
            },
            worker_count: expansion_entropy_worker_count(),
        })
        .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}

fn progress(state: &ExpansionEntropyRunnerState) -> ExpansionEntropyProgress {
    let samples_done = state.executor.samples_done();
    let total_samples = state.executor.total_samples();
    ExpansionEntropyProgress {
        done: state.executor.is_done(),
        current_step: samples_done,
        max_steps: total_samples,
        points_computed: samples_done,
        bifurcations_found: 0,
        current_param: samples_done as f64,
    }
}
