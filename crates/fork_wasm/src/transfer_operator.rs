use crate::system::build_system_with_context;
use fork_core::{
    equation_engine::{EquationSystem, ExpressionContext},
    transfer_operator::{sampled_box_transition_operator, stationary_distribution},
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: bool,
    current_step: usize,
    max_steps: usize,
    points_computed: usize,
    bifurcations_found: usize,
    current_param: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultData {
    total_boxes: usize,
    column_offsets: Vec<usize>,
    target_indices: Vec<usize>,
    probabilities: Vec<f64>,
    retained_mass: f64,
    zero_survivor_sources: usize,
    stationary_distribution: Vec<f64>,
    residual: f64,
    stationary_iterations: usize,
}
struct State {
    system: EquationSystem,
    bounds: Vec<(f64, f64)>,
    resolution: Vec<usize>,
    samples_per_cell: usize,
    iterations: usize,
    max_stationary_iterations: usize,
    tolerance: f64,
    done: bool,
}
#[wasm_bindgen]
pub struct WasmTransferOperatorRunner {
    state: Option<State>,
}
#[wasm_bindgen]
impl WasmTransferOperatorRunner {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        minimums: Vec<f64>,
        maximums: Vec<f64>,
        resolution: Vec<u32>,
        samples_per_cell: u32,
        iterations: u32,
        max_stationary_iterations: u32,
        tolerance: f64,
    ) -> Result<Self, JsValue> {
        if var_names.is_empty()
            || minimums.len() != var_names.len()
            || maximums.len() != var_names.len()
            || resolution.len() != var_names.len()
            || samples_per_cell == 0
            || iterations == 0
            || max_stationary_iterations == 0
            || !tolerance.is_finite()
            || tolerance <= 0.
        {
            return Err(JsValue::from_str("Transfer-operator settings are invalid."));
        }
        let bounds: Vec<_> = minimums.into_iter().zip(maximums).collect();
        if bounds
            .iter()
            .any(|(a, b)| !a.is_finite() || !b.is_finite() || a >= b)
            || resolution.contains(&0)
        {
            return Err(JsValue::from_str(
                "State Grid bounds and resolution are invalid.",
            ));
        }
        let system = build_system_with_context(
            equations,
            params,
            &param_names,
            &var_names,
            ExpressionContext::MapIteration,
        )?;
        Ok(Self {
            state: Some(State {
                system,
                bounds,
                resolution: resolution.into_iter().map(|x| x as usize).collect(),
                samples_per_cell: samples_per_cell as usize,
                iterations: iterations as usize,
                max_stationary_iterations: max_stationary_iterations as usize,
                tolerance,
                done: false,
            }),
        })
    }
    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        state.done = true;
        to_value(&Progress {
            done: true,
            current_step: 1,
            max_steps: 1,
            points_computed: 1,
            bifurcations_found: 0,
            current_param: 1.,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        to_value(&Progress {
            done: state.done,
            current_step: usize::from(state.done),
            max_steps: 1,
            points_computed: usize::from(state.done),
            bifurcations_found: 0,
            current_param: usize::from(state.done) as f64,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        if !state.done {
            return Err(JsValue::from_str(
                "Transfer-operator calculation is not complete.",
            ));
        }
        let op = sampled_box_transition_operator(
            &state.system,
            &state.bounds,
            &state.resolution,
            state.samples_per_cell,
            state.iterations,
        )
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (p, residual, stationary_iterations) =
            stationary_distribution(&op, state.max_stationary_iterations, state.tolerance)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
        to_value(&ResultData {
            total_boxes: op.total_boxes,
            column_offsets: op.column_offsets,
            target_indices: op.target_indices,
            probabilities: op.probabilities,
            retained_mass: op.retained_mass,
            zero_survivor_sources: op.zero_survivor_sources,
            stationary_distribution: p,
            residual,
            stationary_iterations,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
