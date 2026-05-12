//! Event-series extraction helpers for analysis viewports.

use crate::system::{SolverType, WasmSystem};
use fork_core::event_series::{
    compile_event_series_expressions, compute_event_series_from_orbit,
    extract_event_series_from_samples, EventSeriesMode, EventSeriesResult, EventSeriesStepper,
    OrderedSample,
};
use serde::Deserialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
struct OrbitEventSeriesRequest {
    var_names: Vec<String>,
    param_names: Vec<String>,
    initial_state: Vec<f64>,
    start_time: f64,
    steps: usize,
    dt: f64,
    mode: EventSeriesMode,
    event_expression: String,
    event_level: f64,
    observable_expressions: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SampledEventSeriesRequest {
    var_names: Vec<String>,
    param_names: Vec<String>,
    samples: Vec<OrderedSample>,
    mode: EventSeriesMode,
    event_expression: String,
    event_level: f64,
    observable_expressions: Vec<String>,
}

fn to_stepper(solver: &SolverType) -> EventSeriesStepper {
    match solver {
        SolverType::RK4(_) => EventSeriesStepper::Rk4,
        SolverType::Tsit5(_) => EventSeriesStepper::Tsit5,
        SolverType::Discrete(_) => EventSeriesStepper::Discrete,
    }
}

fn serialize_result(result: EventSeriesResult) -> Result<JsValue, JsValue> {
    to_value(&result).map_err(|err| JsValue::from_str(&format!("Serialization error: {err}")))
}

#[wasm_bindgen]
impl WasmSystem {
    pub fn compute_event_series_from_orbit(
        &self,
        request_val: JsValue,
    ) -> Result<JsValue, JsValue> {
        let request: OrbitEventSeriesRequest = from_value(request_val)
            .map_err(|err| JsValue::from_str(&format!("Invalid event series request: {err}")))?;
        let compiled = compile_event_series_expressions(
            &request.event_expression,
            &request.observable_expressions,
            &request.var_names,
            &request.param_names,
        )
        .map_err(|err| JsValue::from_str(&format!("Event expression error: {err}")))?;

        let result = compute_event_series_from_orbit(
            &self.system,
            to_stepper(&self.solver),
            self.system.params.as_slice(),
            &request.initial_state,
            request.start_time,
            request.steps,
            request.dt,
            &compiled,
            request.mode,
            request.event_level,
        )
        .map_err(|err| JsValue::from_str(&format!("Event series extraction failed: {err}")))?;

        serialize_result(result)
    }

    pub fn compute_event_series_from_samples(
        &self,
        request_val: JsValue,
    ) -> Result<JsValue, JsValue> {
        let request: SampledEventSeriesRequest = from_value(request_val)
            .map_err(|err| JsValue::from_str(&format!("Invalid sampled event request: {err}")))?;
        let compiled = compile_event_series_expressions(
            &request.event_expression,
            &request.observable_expressions,
            &request.var_names,
            &request.param_names,
        )
        .map_err(|err| JsValue::from_str(&format!("Event expression error: {err}")))?;

        let result = extract_event_series_from_samples(
            self.system.params.as_slice(),
            &request.samples,
            &compiled,
            request.mode,
            request.event_level,
        )
        .map_err(|err| JsValue::from_str(&format!("Sampled event extraction failed: {err}")))?;

        serialize_result(result)
    }
}
