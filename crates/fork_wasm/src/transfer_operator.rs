use crate::system::WasmSystem;
use fork_core::traits::DynamicalSystem;
use fork_core::transfer_operator::{
    box_index, sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step,
    stationary_distribution,
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
    ambient_box_count: usize,
    cover_box_indices: Vec<usize>,
    seed_box_index: usize,
    cover_growth_iterations: usize,
    column_offsets: Vec<usize>,
    target_indices: Vec<usize>,
    probabilities: Vec<f64>,
    retained_mass: f64,
    zero_survivor_sources: usize,
    stationary_distribution: Vec<f64>,
    dominant_eigenvalue: f64,
    residual: f64,
    stationary_iterations: usize,
}
struct State {
    system: WasmSystem,
    axis_names: Vec<String>,
    bounds: Vec<(f64, f64)>,
    resolution: Vec<usize>,
    seed_box_index: usize,
    samples_per_cell: usize,
    iterations: usize,
    is_flow: bool,
    time_step: f64,
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
        solver_name: String,
        system_type: String,
        minimums: Vec<f64>,
        maximums: Vec<f64>,
        resolution: Vec<u32>,
        starting_point: Vec<f64>,
        samples_per_cell: u32,
        iterations: u32,
        max_stationary_iterations: u32,
        tolerance: f64,
        time_step: f64,
    ) -> Result<Self, JsValue> {
        if var_names.is_empty()
            || minimums.len() != var_names.len()
            || maximums.len() != var_names.len()
            || resolution.len() != var_names.len()
            || starting_point.len() != var_names.len()
            || samples_per_cell == 0
            || iterations == 0
            || max_stationary_iterations == 0
            || !tolerance.is_finite()
            || tolerance <= 0.
            || !time_step.is_finite()
            || time_step <= 0.
        {
            return Err(JsValue::from_str("Transfer-operator settings are invalid."));
        }
        let is_flow = match system_type.as_str() {
            "flow" => true,
            "map" => false,
            _ => return Err(JsValue::from_str("Unknown dynamical-system type.")),
        };
        let solver_supported = if is_flow {
            matches!(solver_name.as_str(), "rk4" | "tsit5")
        } else {
            solver_name == "discrete"
        };
        if !solver_supported {
            return Err(JsValue::from_str(
                "Transfer operator requires RK4 or Tsit5 for flows and the discrete solver for maps.",
            ));
        }
        let bounds: Vec<_> = minimums.into_iter().zip(maximums).collect();
        if bounds.iter().zip(&resolution).any(|((a, b), count)| {
            !a.is_finite() || !b.is_finite() || a > b || *count == 0 || (a == b && *count != 1)
        }) {
            return Err(JsValue::from_str(
                "State Grid bounds and resolution are invalid.",
            ));
        }
        let resolution: Vec<usize> = resolution.into_iter().map(|x| x as usize).collect();
        let seed_box_index = box_index(&starting_point, &bounds, &resolution).ok_or_else(|| {
            JsValue::from_str("The starting point must lie inside the State Grid.")
        })?;
        let system = WasmSystem::new(
            equations,
            params,
            param_names,
            var_names.clone(),
            &solver_name,
            &system_type,
        )?;
        if is_flow {
            system.require_autonomous("State Grid invariant-measure calculation")?;
        }
        Ok(Self {
            state: Some(State {
                system,
                axis_names: var_names,
                bounds,
                resolution,
                seed_box_index,
                samples_per_cell: samples_per_cell as usize,
                iterations: iterations as usize,
                is_flow,
                time_step,
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
    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        if !state.done {
            return Err(JsValue::from_str(
                "Transfer-operator calculation is not complete.",
            ));
        }
        let mut flow_time = 0.0;
        let op = sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step(
            state.axis_names.len(),
            &state.bounds,
            &state.resolution,
            state.samples_per_cell,
            state.iterations,
            &state.axis_names,
            state.seed_box_index,
            |_, _, iteration, sample, out| {
                if state.is_flow {
                    if iteration == 0 {
                        flow_time = 0.0;
                    }
                    state
                        .system
                        .step_state(&mut flow_time, sample, state.time_step);
                    out.copy_from_slice(sample);
                } else {
                    state.system.system.apply(0.0, sample, out);
                }
                Ok(())
            },
        )
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (p, dominant_eigenvalue, residual, stationary_iterations) =
            stationary_distribution(&op, state.max_stationary_iterations, state.tolerance)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
        to_value(&ResultData {
            total_boxes: op.total_boxes,
            ambient_box_count: op.ambient_box_count,
            cover_box_indices: op.cover_box_indices,
            seed_box_index: op.seed_box_index,
            cover_growth_iterations: op.cover_growth_iterations,
            column_offsets: op.column_offsets,
            target_indices: op.target_indices,
            probabilities: op.probabilities,
            retained_mass: op.retained_mass,
            zero_survivor_sources: op.zero_survivor_sources,
            stationary_distribution: p,
            dominant_eigenvalue,
            residual,
            stationary_iterations,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
