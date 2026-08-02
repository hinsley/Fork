use crate::system::WasmSystem;
use fork_core::traits::DynamicalSystem;
use fork_core::transfer_operator::{
    box_index, BoxTransitionOperator, GrownCoverBuildPhase, GrownCoverTransferOperatorBuilder,
    StationaryDistributionState,
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

const MAX_FLOW_INTEGRATION_STEPS_PER_TRANSITION: usize = 1_000_000;
const TRANSFER_OPERATOR_BATCH_SIZE: usize = 128;

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
struct Progress {
    done: bool,
    current_step: usize,
    max_steps: usize,
    points_computed: usize,
    bifurcations_found: usize,
    current_param: f64,
    phase: &'static str,
    batch_size_hint: usize,
    discovered_boxes: usize,
    frontier_boxes: usize,
    edges_built: usize,
    residual: Option<f64>,
    tolerance: Option<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultData<'a> {
    total_boxes: usize,
    ambient_box_count: usize,
    cover_box_indices: &'a [usize],
    seed_box_index: usize,
    cover_growth_iterations: usize,
    column_offsets: &'a [usize],
    target_indices: &'a [usize],
    probabilities: &'a [f64],
    retained_mass: f64,
    zero_survivor_sources: usize,
    stationary_distribution: &'a [f64],
    dominant_eigenvalue: f64,
    residual: f64,
    stationary_iterations: usize,
}
struct State {
    system: WasmSystem,
    is_flow: bool,
    flow_map_time: f64,
    integration_step: f64,
    dynamics_steps_per_sample: usize,
    max_stationary_iterations: usize,
    tolerance: f64,
    builder: Option<GrownCoverTransferOperatorBuilder>,
    operator: Option<BoxTransitionOperator>,
    stationary: Option<StationaryDistributionState>,
    stationary_completion_reported: bool,
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
        let dynamics_steps_per_sample = if is_flow {
            flow_integration_step_count(time_step, integration_step)
                .map_err(|error| JsValue::from_str(&error.to_string()))?
        } else {
            iterations as usize
        };
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
        let builder = GrownCoverTransferOperatorBuilder::new(
            var_names.len(),
            &bounds,
            &resolution,
            samples_per_cell as usize,
            if is_flow { 1 } else { iterations as usize },
            &var_names,
            seed_box_index,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self {
            state: Some(State {
                system,
                is_flow,
                flow_map_time: time_step,
                integration_step,
                dynamics_steps_per_sample,
                max_stationary_iterations: max_stationary_iterations as usize,
                tolerance,
                builder: Some(builder),
                operator: None,
                stationary: None,
                stationary_completion_reported: false,
            }),
        })
    }
    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        if let Some(builder) = state.builder.as_mut() {
            let was_complete = builder.is_complete();
            if !was_complete {
                let is_flow = state.is_flow;
                let flow_map_time = state.flow_map_time;
                let integration_step = state.integration_step;
                let system = &mut state.system;
                builder
                    .advance(batch_size.max(1) as usize, &mut |_, _, _, sample, out| {
                        if is_flow {
                            advance_flow_map(system, sample, flow_map_time, integration_step)?;
                            out.copy_from_slice(sample);
                        } else {
                            system.system.apply(0.0, sample, out);
                        }
                        Ok(())
                    })
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
            }
            if was_complete {
                let builder = state.builder.take().expect("builder exists");
                let operator = builder
                    .into_operator()
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
                state.stationary = Some(
                    StationaryDistributionState::new(
                        &operator,
                        state.max_stationary_iterations,
                        state.tolerance,
                    )
                    .map_err(|error| JsValue::from_str(&error.to_string()))?,
                );
                state.operator = Some(operator);
            }
        } else {
            let operator = state
                .operator
                .as_ref()
                .ok_or_else(|| JsValue::from_str("Transfer operator is unavailable."))?;
            let stationary = state
                .stationary
                .as_mut()
                .ok_or_else(|| JsValue::from_str("Stationary solver is unavailable."))?;
            if stationary.is_done() {
                state.stationary_completion_reported = true;
            } else {
                stationary
                    .advance(operator, batch_size.max(1) as usize)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?;
            }
        }
        to_value(&progress(state)).map_err(|error| JsValue::from_str(&error.to_string()))
    }
    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        to_value(&progress(state)).map_err(|error| JsValue::from_str(&error.to_string()))
    }
    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized."))?;
        let operator = state
            .operator
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Transfer-operator calculation is not complete."))?;
        let stationary = state
            .stationary
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Stationary solver is unavailable."))?;
        if !stationary.is_done() || !state.stationary_completion_reported {
            return Err(JsValue::from_str(
                "Transfer-operator calculation is not complete.",
            ));
        }
        to_value(&ResultData {
            total_boxes: operator.total_boxes,
            ambient_box_count: operator.ambient_box_count,
            cover_box_indices: &operator.cover_box_indices,
            seed_box_index: operator.seed_box_index,
            cover_growth_iterations: operator.cover_growth_iterations,
            column_offsets: &operator.column_offsets,
            target_indices: &operator.target_indices,
            probabilities: &operator.probabilities,
            retained_mass: operator.retained_mass,
            zero_survivor_sources: operator.zero_survivor_sources,
            stationary_distribution: stationary.distribution(),
            dominant_eigenvalue: stationary.eigenvalue(),
            residual: stationary.residual().unwrap_or(0.0),
            stationary_iterations: stationary.iterations(),
        })
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

fn progress(state: &State) -> Progress {
    if let Some(builder) = state.builder.as_ref() {
        let build = builder.progress();
        return Progress {
            done: false,
            current_step: build.completed_source_boxes,
            max_steps: build.total_source_boxes.unwrap_or(0),
            points_computed: build
                .sampled_transitions
                .saturating_mul(state.dynamics_steps_per_sample),
            bifurcations_found: 0,
            current_param: build.discovered_boxes as f64,
            phase: match build.phase {
                GrownCoverBuildPhase::ExploringCover => "exploring_cover",
                GrownCoverBuildPhase::BuildingTransitions => "building_transitions",
                GrownCoverBuildPhase::Complete => "building_transitions",
            },
            batch_size_hint: TRANSFER_OPERATOR_BATCH_SIZE,
            discovered_boxes: build.discovered_boxes,
            frontier_boxes: build.frontier_boxes,
            edges_built: build.edges_built,
            residual: None,
            tolerance: None,
        };
    }
    let operator = state.operator.as_ref();
    let stationary = state.stationary.as_ref();
    let done = stationary.is_some_and(StationaryDistributionState::is_done)
        && state.stationary_completion_reported;
    Progress {
        done,
        current_step: stationary.map_or(0, StationaryDistributionState::iterations),
        max_steps: stationary.map_or(0, StationaryDistributionState::max_iterations),
        points_computed: stationary.map_or(0, StationaryDistributionState::iterations),
        bifurcations_found: 0,
        current_param: stationary
            .and_then(StationaryDistributionState::residual)
            .unwrap_or(0.0),
        phase: if done {
            "complete"
        } else {
            "solving_stationary"
        },
        batch_size_hint: TRANSFER_OPERATOR_BATCH_SIZE,
        discovered_boxes: operator.map_or(0, |value| value.total_boxes),
        frontier_boxes: 0,
        edges_built: operator.map_or(0, |value| value.target_indices.len()),
        residual: stationary.and_then(StationaryDistributionState::residual),
        tolerance: stationary.map(StationaryDistributionState::tolerance),
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
