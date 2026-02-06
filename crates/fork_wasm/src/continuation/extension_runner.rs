//! Continuation branch extension runner.

use super::shared::{compute_tangent_from_problem, OwnedEquilibriumContinuationProblem};
use crate::system::build_system;
use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::periodic::PeriodicOrbitCollocationProblem;
use fork_core::continuation::{
    homoclinic_setup_from_homoclinic_point, BranchType, ContinuationBranch, ContinuationPoint,
    ContinuationProblem, ContinuationRunner, ContinuationSettings, HomoclinicExtraFlags,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::SystemKind;
use fork_core::traits::DynamicalSystem;
use nalgebra::DVector;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

struct ExtensionMergeContext {
    branch: ContinuationBranch,
    index_offset: i32,
    sign: i32,
}

enum ExtensionRunnerKind {
    Equilibrium {
        runner: ContinuationRunner<OwnedEquilibriumContinuationProblem>,
        merge: ExtensionMergeContext,
    },
    LimitCycle {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<PeriodicOrbitCollocationProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    Homoclinic {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<HomoclinicProblem<'static>>,
        merge: ExtensionMergeContext,
    },
}

fn orient_extension_tangent(
    tangent: &mut DVector<f64>,
    secant: Option<&DVector<f64>>,
    forward: bool,
) {
    if let Some(secant) = secant {
        if tangent.dot(secant) < 0.0 {
            *tangent = -tangent.clone();
        }
    } else {
        let forward_sign = if forward { 1.0 } else { -1.0 };
        if tangent[0] * forward_sign < 0.0 {
            *tangent = -tangent.clone();
        }
    }
}

#[wasm_bindgen]
pub struct WasmContinuationExtensionRunner {
    runner: Option<ExtensionRunnerKind>,
}

#[wasm_bindgen]
impl WasmContinuationExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        branch_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmContinuationExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

        if branch.indices.len() != branch.points.len() {
            branch.indices = (0..branch.points.len() as i32).collect();
        }

        let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
            let max_idx_pos = branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
            let prev_idx_pos = if branch.points.len() > 1 {
                branch
                    .indices
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != max_idx_pos)
                    .max_by_key(|(_, &idx)| idx)
                    .map(|(i, _)| i)
            } else {
                None
            };
            (max_idx_pos, branch.indices[max_idx_pos], prev_idx_pos, true)
        } else {
            let min_idx_pos = branch
                .indices
                .iter()
                .enumerate()
                .min_by_key(|(_, &idx)| idx)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
            let next_idx_pos = if branch.points.len() > 1 {
                branch
                    .indices
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != min_idx_pos)
                    .min_by_key(|(_, &idx)| idx)
                    .map(|(i, _)| i)
            } else {
                None
            };
            (
                min_idx_pos,
                branch.indices[min_idx_pos],
                next_idx_pos,
                false,
            )
        };

        let sign = if is_append { 1 } else { -1 };
        let mut merge = ExtensionMergeContext {
            branch,
            index_offset: last_index,
            sign,
        };
        let endpoint = merge
            .branch
            .points
            .get(endpoint_idx)
            .cloned()
            .ok_or_else(|| JsValue::from_str("Branch endpoint missing"))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param_index = *system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let runner_kind = match &merge.branch.branch_type {
            BranchType::Equilibrium => {
                let kind = match system_type {
                    "map" => SystemKind::Map {
                        iterations: map_iterations as usize,
                    },
                    _ => SystemKind::Flow,
                };

                let mut problem =
                    OwnedEquilibriumContinuationProblem::new(system, kind, param_index);
                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in endpoint.state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    if secant.norm() > 1e-12 {
                        Some(secant.normalize())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: endpoint.state.clone(),
                    param_value: endpoint.param_value,
                    stability: endpoint.stability.clone(),
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: endpoint.cycle_points.clone(),
                };

                let mut runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());

                ExtensionRunnerKind::Equilibrium { runner, merge }
            }
            BranchType::LimitCycle { ntst, ncol } => {
                if merge.branch.upoldp.is_none() {
                    let dim = system.equations.len();
                    if endpoint.state.len() > dim {
                        let x0 = &endpoint.state[0..dim];
                        let period = *endpoint.state.last().unwrap_or(&1.0);
                        let mut work = vec![0.0; dim];
                        system.apply(0.0, x0, &mut work);
                        let u0: Vec<f64> = work.iter().map(|&v| v * period).collect();
                        merge.branch.upoldp = Some(vec![u0]);
                    }
                }

                let upoldp =
                    merge.branch.upoldp.clone().ok_or_else(|| {
                        JsValue::from_str("Limit cycle branch missing upoldp data")
                    })?;

                let phase_direction = if !upoldp.is_empty() && !upoldp[0].is_empty() {
                    let dir_norm: f64 = upoldp[0].iter().map(|v| v * v).sum::<f64>().sqrt();
                    if dir_norm > 1e-12 {
                        upoldp[0].iter().map(|v| v / dir_norm).collect()
                    } else {
                        upoldp[0].clone()
                    }
                } else {
                    vec![1.0]
                };

                let dim = system.equations.len();
                let phase_anchor: Vec<f64> = endpoint.state.iter().take(dim).cloned().collect();

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let mut problem = PeriodicOrbitCollocationProblem::new(
                    unsafe { &mut *system_ptr },
                    param_index,
                    *ntst,
                    *ncol,
                    phase_anchor,
                    phase_direction,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create LC problem: {}", e)))?;

                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in endpoint.state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    if secant.norm() > 1e-12 {
                        Some(secant.normalize())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: endpoint.state.clone(),
                    param_value: endpoint.param_value,
                    stability: endpoint.stability.clone(),
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: endpoint.cycle_points.clone(),
                };

                // SAFETY: The problem borrows the boxed system allocation, which lives
                // for the lifetime of the runner.
                let problem: PeriodicOrbitCollocationProblem<'static> =
                    unsafe { std::mem::transmute(problem) };

                let mut runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());

                ExtensionRunnerKind::LimitCycle {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
            BranchType::HomoclinicCurve {
                ntst,
                ncol,
                param1_name,
                param2_name,
                free_time,
                free_eps0,
                free_eps1,
            } => {
                let param1_index = *system.param_map.get(param1_name).ok_or_else(|| {
                    JsValue::from_str(&format!("Unknown parameter: {}", param1_name))
                })?;
                let param2_index = *system.param_map.get(param2_name).ok_or_else(|| {
                    JsValue::from_str(&format!("Unknown parameter: {}", param2_name))
                })?;
                let mut base_params = system.params.clone();
                if param1_index >= base_params.len() || param2_index >= base_params.len() {
                    return Err(JsValue::from_str("Homoclinic parameter index out of range"));
                }
                base_params[param1_index] = endpoint.param_value;

                let setup = homoclinic_setup_from_homoclinic_point(
                    &mut system,
                    &endpoint.state,
                    *ntst,
                    *ncol,
                    *ntst,
                    *ncol,
                    &base_params,
                    param1_index,
                    param2_index,
                    param1_name,
                    param2_name,
                    HomoclinicExtraFlags {
                        free_time: *free_time,
                        free_eps0: *free_eps0,
                        free_eps1: *free_eps1,
                    },
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to initialize homoclinic extension: {}", e))
                })?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let mut problem = HomoclinicProblem::new(unsafe { &mut *system_ptr }, setup)
                    .map_err(|e| {
                        JsValue::from_str(&format!(
                            "Failed to create homoclinic extension problem: {}",
                            e
                        ))
                    })?;

                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in endpoint.state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    if secant.norm() > 1e-12 {
                        Some(secant.normalize())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: endpoint.state.clone(),
                    param_value: endpoint.param_value,
                    stability: endpoint.stability.clone(),
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: endpoint.cycle_points.clone(),
                };

                let problem: HomoclinicProblem<'static> = unsafe { std::mem::transmute(problem) };
                let mut runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());

                ExtensionRunnerKind::Homoclinic {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
            BranchType::HomotopySaddleCurve { .. } => {
                return Err(JsValue::from_str(
                    "Branch extension for homotopy-saddle curves is not available yet.",
                ))
            }
        };

        Ok(WasmContinuationExtensionRunner {
            runner: Some(runner_kind),
        })
    }

    pub fn is_done(&self) -> bool {
        match self.runner.as_ref() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner.is_done(),
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner.is_done(),
            Some(ExtensionRunnerKind::Homoclinic { runner, .. }) => runner.is_done(),
            None => true,
        }
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_mut() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(ExtensionRunnerKind::Homoclinic { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_ref() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner.step_result(),
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner.step_result(),
            Some(ExtensionRunnerKind::Homoclinic { runner, .. }) => runner.step_result(),
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner_kind = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let (extension, merge) = match runner_kind {
            ExtensionRunnerKind::Equilibrium { runner, merge } => (runner.take_result(), merge),
            ExtensionRunnerKind::LimitCycle { runner, merge, .. } => (runner.take_result(), merge),
            ExtensionRunnerKind::Homoclinic { runner, merge, .. } => {
                (runner.take_result(), merge)
            }
        };

        let mut branch = merge.branch;
        let orig_count = branch.points.len();
        let ExtensionMergeContext {
            index_offset, sign, ..
        } = merge;

        for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
            branch.points.push(pt);
            let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
            branch.indices.push(index_offset + idx * sign);
        }

        for ext_bif_idx in extension.bifurcations {
            if ext_bif_idx > 0 {
                branch.bifurcations.push(orig_count + ext_bif_idx - 1);
            }
        }

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::WasmContinuationExtensionRunner;
    use fork_core::continuation::{
        BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, ContinuationSettings,
    };
    use serde_wasm_bindgen::{from_value, to_value};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn settings_value(max_steps: usize) -> wasm_bindgen::JsValue {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-6,
        };
        to_value(&settings).expect("settings")
    }

    #[wasm_bindgen_test]
    fn extension_runner_rejects_empty_branch() {
        let branch = ContinuationBranch {
            points: Vec::new(),
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::Equilibrium,
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let result = WasmContinuationExtensionRunner::new(
            vec!["x".to_string()],
            vec![],
            vec![],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "p",
            settings_value(3),
            true,
        );

        assert!(result.is_err(), "should reject empty branch");
        let message = result
            .err()
            .and_then(|err| err.as_string())
            .unwrap_or_default();
        assert!(message.contains("Branch has no indices"));
    }

    #[wasm_bindgen_test]
    fn extension_runner_fills_missing_indices() {
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            }],
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::Equilibrium,
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![0.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");
        assert_eq!(result_branch.points.len(), 1);
        assert_eq!(result_branch.indices, vec![0]);
    }

    #[wasm_bindgen_test]
    fn extension_runner_merges_indices_after_step() {
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![1.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![1.1],
                    param_value: 1.1,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![1.1],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(1),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");
        assert_eq!(result_branch.indices.len(), 3);
        assert_eq!(result_branch.indices.last().copied(), Some(2));
    }

    #[wasm_bindgen_test]
    fn backward_extension_from_forward_initialized_branch_moves_param_outward_on_min_index_side() {
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.2],
                    param_value: 0.2,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![0.21],
                    param_value: 0.21,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![0.2],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(1),
            false,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");

        let new_pos = result_branch
            .indices
            .iter()
            .position(|idx| *idx == -1)
            .expect("new backward index");
        let new_param = result_branch.points[new_pos].param_value;
        assert!(
            new_param < 0.2,
            "expected backward extension from min-index side to decrease parameter, got {}",
            new_param
        );
    }

    #[test]
    fn backward_extension_uses_signed_min_index_when_points_are_out_of_array_order() {
        // Intentional non-monotonic storage order:
        // array position is [idx 0, idx -1, idx +1]. Endpoint selection must use signed indices,
        // not first/last array position.
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.2],
                    param_value: 0.2,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![0.1],
                    param_value: 0.1,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![0.3],
                    param_value: 0.3,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -1, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![0.2],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(1),
            false,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");

        let new_pos = result_branch
            .indices
            .iter()
            .position(|idx| *idx == -2)
            .expect("new backward index");
        let new_param = result_branch.points[new_pos].param_value;
        let endpoint_param = 0.1;
        let neighbor_param = 0.2;
        let secant_param = endpoint_param - neighbor_param;
        let param_delta = new_param - endpoint_param;

        assert!(
            param_delta * secant_param > 0.0,
            "expected extension away from selected signed-index endpoint (delta={}, secant={})",
            param_delta,
            secant_param
        );
    }

    #[test]
    fn limit_cycle_extension_recovers_upoldp_from_signed_index_endpoint() {
        // Intentional non-monotonic storage order:
        // ensure endpoint-derived phase data (upoldp/anchor direction inputs) comes from
        // the signed min-index side for backward extension, not from array position.
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![10.0, 100.0, 7.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![2.0, 20.0, 3.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![30.0, 300.0, 5.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -1, 2],
            branch_type: BranchType::LimitCycle { ntst: 1, ncol: 1 },
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![0.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(0),
            false,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");
        let recovered_upoldp = result_branch
            .upoldp
            .and_then(|values| values.first().cloned())
            .and_then(|dir| dir.first().copied())
            .expect("recovered upoldp");

        let expected_endpoint_upoldp = 6.0;
        assert!(
            (recovered_upoldp - expected_endpoint_upoldp).abs() < 1e-9,
            "expected endpoint-derived upoldp {}, got {}",
            expected_endpoint_upoldp,
            recovered_upoldp
        );
        assert!(
            (recovered_upoldp - 70.0).abs() > 1e-6 && (recovered_upoldp - 150.0).abs() > 1e-6,
            "upoldp should come from selected signed-index endpoint, got {}",
            recovered_upoldp
        );
    }
}

#[cfg(test)]
mod orientation_tests {
    use super::orient_extension_tangent;
    use nalgebra::DVector;

    #[test]
    fn orient_extension_tangent_aligns_with_secant_by_dot() {
        let mut tangent = DVector::from_vec(vec![0.2, 1.0, 0.0]);
        let secant = DVector::from_vec(vec![-0.1, -1.0, 0.0]);
        assert!(tangent.dot(&secant) < 0.0, "setup should require a flip");

        orient_extension_tangent(&mut tangent, Some(&secant), false);

        assert!(
            tangent.dot(&secant) > 0.0,
            "tangent should align with secant by dot product"
        );
    }

    #[test]
    fn orient_extension_tangent_falls_back_to_requested_direction_without_secant() {
        let mut tangent = DVector::from_vec(vec![1.0, 0.0, 0.0]);

        orient_extension_tangent(&mut tangent, None, false);

        assert!(
            tangent[0] < 0.0,
            "without secant, backward direction should enforce negative parameter component"
        );
    }
}
