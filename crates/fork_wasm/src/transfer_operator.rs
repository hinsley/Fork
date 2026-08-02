use crate::system::WasmSystem;
use fork_core::traits::DynamicalSystem;
use fork_core::transfer_operator::{
    box_index, sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step,
    stationary_distribution,
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

const MAX_FLOW_INTEGRATION_STEPS_PER_TRANSITION: usize = 1_000_000;

fn flow_integration_step_count(flow_map_time: f64, integration_step: f64) -> anyhow::Result<usize> {
    if !flow_map_time.is_finite()
        || flow_map_time <= 0.0
        || !integration_step.is_finite()
        || integration_step <= 0.0
    {
        anyhow::bail!("Flow-map time and integration step must be positive.");
    }
    let step_count = (flow_map_time / integration_step).ceil();
    if !step_count.is_finite() || step_count > MAX_FLOW_INTEGRATION_STEPS_PER_TRANSITION as f64 {
        anyhow::bail!(
            "Flow-map integration requires at most {} steps per sampled transition.",
            MAX_FLOW_INTEGRATION_STEPS_PER_TRANSITION
        );
    }
    Ok((step_count as usize).max(1))
}

fn advance_flow_map(
    system: &mut WasmSystem,
    state: &mut [f64],
    flow_map_time: f64,
    integration_step: f64,
) -> anyhow::Result<()> {
    let step_count = flow_integration_step_count(flow_map_time, integration_step)?;
    let mut solver_time = 0.0;
    for step in 0..step_count {
        let elapsed = step as f64 * integration_step;
        let step_size = integration_step.min(flow_map_time - elapsed);
        if step_size <= 0.0 {
            break;
        }
        system.step_state(&mut solver_time, state, step_size);
    }
    Ok(())
}

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
    flow_map_time: f64,
    integration_step: f64,
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
        integration_step: f64,
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
            || !integration_step.is_finite()
            || integration_step <= 0.
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
        if is_flow {
            flow_integration_step_count(time_step, integration_step)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
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
                iterations: if is_flow { 1 } else { iterations as usize },
                is_flow,
                flow_map_time: time_step,
                integration_step,
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
        let op = sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step(
            state.axis_names.len(),
            &state.bounds,
            &state.resolution,
            state.samples_per_cell,
            state.iterations,
            &state.axis_names,
            state.seed_box_index,
            |_, _, _, sample, out| {
                if state.is_flow {
                    advance_flow_map(
                        &mut state.system,
                        sample,
                        state.flow_map_time,
                        state.integration_step,
                    )?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_map_duration_is_split_into_bounded_integration_steps() {
        assert_eq!(flow_integration_step_count(1.0, 0.01).unwrap(), 100);
        assert_eq!(flow_integration_step_count(1.0, 0.3).unwrap(), 4);
        assert!(flow_integration_step_count(1.0, 0.0).is_err());
    }

    #[test]
    fn flow_map_advances_over_the_full_duration() {
        let mut system = WasmSystem::new(
            vec!["1".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "rk4",
            "flow",
        )
        .unwrap();
        let mut state = [0.0_f64];

        advance_flow_map(&mut system, &mut state, 1.0, 0.01).unwrap();

        assert!((state[0] - 1.0).abs() < 1.0e-12);
    }

    #[test]
    fn langford_time_one_map_leaves_the_reported_seed_cell() {
        let mut system = WasmSystem::new(
            vec![
                "(z - b) * x - d * y".to_string(),
                "d * x + (z - b) * y".to_string(),
                "c + a * z - z^3 / 3 - (x^2 + y^2) * (1 + e * z) + f * z * x^3".to_string(),
            ],
            vec![0.95, 0.7, 0.6, 3.5, 0.25, 0.1],
            vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string(),
                "e".to_string(),
                "f".to_string(),
            ],
            vec!["x".to_string(), "y".to_string(), "z".to_string()],
            "rk4",
            "flow",
        )
        .unwrap();
        let bounds = [(-2.0, 2.0), (-2.0, 2.0), (-1.0, 2.0)];
        let resolution = [50, 50, 50];
        let seed = box_index(&[0.0, 0.0, 0.5], &bounds, &resolution).unwrap();
        let mut targets = Vec::new();

        for sample_index in 0..4 {
            let mut sample = fork_core::transfer_operator::stratified_cell_sample(
                &bounds,
                &resolution,
                seed,
                sample_index,
                4,
            )
            .unwrap();
            advance_flow_map(&mut system, &mut sample, 1.0, 0.01).unwrap();
            targets.push(box_index(&sample, &bounds, &resolution));
        }

        assert!(targets.into_iter().any(|target| target != Some(seed)));
    }
}
