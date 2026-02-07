//! Continuation branch extension runner.

use super::shared::{compute_tangent_from_problem, OwnedEquilibriumContinuationProblem};
use crate::system::build_system;
use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::periodic::PeriodicOrbitCollocationProblem;
use fork_core::continuation::{
    decode_homoclinic_state, homoclinic_setup_from_homoclinic_point, pack_homoclinic_state,
    BranchType, ContinuationBranch, ContinuationPoint, ContinuationProblem, ContinuationRunner,
    ContinuationSettings, HomoclinicExtraFlags, HomoclinicSetup,
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
    let forward_sign = if forward { 1.0 } else { -1.0 };

    if let Some(secant) = secant {
        if tangent.dot(secant) < 0.0 {
            *tangent = -tangent.clone();
        }
    }

    let tangent_norm = tangent.norm();
    let param_component_threshold = 0.01 * tangent_norm;

    if tangent[0].abs() < param_component_threshold {
        let desired_param_sign = secant
            .and_then(|v| {
                if v[0].abs() > 1e-12 {
                    Some(v[0].signum())
                } else {
                    None
                }
            })
            .unwrap_or(forward_sign);
        tangent[0] = param_component_threshold * desired_param_sign;
        let norm = tangent.norm();
        if norm > 1e-12 {
            *tangent = &*tangent / norm;
        }
    } else if secant.is_none() && tangent[0] * forward_sign < 0.0 {
        *tangent = -tangent.clone();
    }
}

fn cap_extension_step_size(settings: &mut ContinuationSettings, secant_norm: Option<f64>) {
    let Some(secant_norm) = secant_norm else {
        return;
    };
    if !secant_norm.is_finite() || secant_norm <= 1e-12 {
        return;
    }

    if settings.step_size > secant_norm {
        settings.step_size = secant_norm;
    }
    if settings.max_step_size < settings.step_size {
        settings.max_step_size = settings.step_size;
    }
    if settings.min_step_size > settings.step_size {
        settings.min_step_size = settings.step_size;
    }
}

fn seed_anchor_aug_from_upoldp(
    branch: &ContinuationBranch,
    expected_aug_len: usize,
) -> Option<DVector<f64>> {
    let candidate = branch.upoldp.as_ref()?.first()?;
    if candidate.len() != expected_aug_len {
        return None;
    }
    if candidate.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some(DVector::from_vec(candidate.clone()))
}

fn try_warm_start_homoclinic_riccati(setup: &mut HomoclinicSetup, endpoint_state: &[f64]) -> bool {
    let dim = setup.guess.x0.len();
    let Ok(decoded) = decode_homoclinic_state(
        endpoint_state,
        dim,
        setup.ntst,
        setup.ncol,
        setup.extras,
        setup.guess.time,
        setup.guess.eps0,
        setup.guess.eps1,
    ) else {
        return false;
    };

    if decoded.yu.len() != setup.guess.yu.len() || decoded.ys.len() != setup.guess.ys.len() {
        return false;
    }

    setup.guess.yu = decoded.yu;
    setup.guess.ys = decoded.ys;
    true
}

fn hydrate_homoclinic_setup_from_endpoint(
    setup: &mut HomoclinicSetup,
    endpoint_state: &[f64],
    dim: usize,
) -> bool {
    let Ok(decoded) = decode_homoclinic_state(
        endpoint_state,
        dim,
        setup.ntst,
        setup.ncol,
        setup.extras,
        setup.guess.time,
        setup.guess.eps0,
        setup.guess.eps1,
    ) else {
        return false;
    };

    if decoded.nneg != setup.basis.nneg || decoded.npos != setup.basis.npos {
        return false;
    }

    setup.guess.mesh_states = decoded.mesh_states;
    setup.guess.stage_states = decoded.stage_states;
    setup.guess.x0 = decoded.x0;
    setup.guess.param2_value = decoded.param2_value;
    setup.guess.time = decoded.time;
    setup.guess.eps0 = decoded.eps0;
    setup.guess.eps1 = decoded.eps1;
    if decoded.yu.len() == setup.guess.yu.len() && decoded.ys.len() == setup.guess.ys.len() {
        setup.guess.yu = decoded.yu;
        setup.guess.ys = decoded.ys;
    }
    true
}

fn canonicalize_homoclinic_point_state(
    template: &HomoclinicSetup,
    point_state: &[f64],
    dim: usize,
) -> Option<Vec<f64>> {
    let mut setup = template.clone();
    if !hydrate_homoclinic_setup_from_endpoint(&mut setup, point_state, dim) {
        return None;
    }
    Some(pack_homoclinic_state(&setup))
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

                let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    let norm = secant.norm();
                    if norm > 1e-12 {
                        (Some(secant.normalize()), Some(norm))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);
                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);

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

                let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    let norm = secant.norm();
                    if norm > 1e-12 {
                        (Some(secant.normalize()), Some(norm))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);
                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);

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

                let mut setup = homoclinic_setup_from_homoclinic_point(
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
                let system_dim = system.equations.len();
                // Keep the extension seed aligned with the selected endpoint.
                // This avoids introducing a phase-reference mismatch before the first step.
                let hydrated =
                    hydrate_homoclinic_setup_from_endpoint(&mut setup, &endpoint.state, system_dim);
                if !hydrated {
                    // Fallback: preserve Riccati state from the endpoint when full decode fails.
                    let _ = try_warm_start_homoclinic_riccati(&mut setup, &endpoint.state);
                }
                let packed_initial_state = pack_homoclinic_state(&setup);
                let secant_template = setup.clone();

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
                if packed_initial_state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        packed_initial_state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in packed_initial_state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let seed_anchor_aug = if neighbor_idx.is_none() {
                    seed_anchor_aug_from_upoldp(&merge.branch, dim + 1)
                } else {
                    None
                };
                let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let neighbor_state = canonicalize_homoclinic_point_state(
                        &secant_template,
                        &neighbor.state,
                        system_dim,
                    )
                    .unwrap_or_else(|| neighbor.state.clone());
                    if neighbor_state.len() != dim {
                        (None, None)
                    } else {
                        let mut neighbor_aug = DVector::zeros(dim + 1);
                        neighbor_aug[0] = neighbor.param_value;
                        for (i, &v) in neighbor_state.iter().enumerate() {
                            neighbor_aug[i + 1] = v;
                        }
                        let secant = &end_aug - &neighbor_aug;
                        let norm = secant.norm();
                        if norm > 1e-12 {
                            (Some(secant.normalize()), Some(norm))
                        } else {
                            (None, None)
                        }
                    }
                } else if let Some(anchor_aug) = seed_anchor_aug {
                    let secant = &end_aug - &anchor_aug;
                    let norm = secant.norm();
                    if norm > 1e-12 {
                        (Some(secant.normalize()), Some(norm))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

                let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                    secant.clone()
                } else {
                    compute_tangent_from_problem(&mut problem, &end_aug)
                        .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                };

                orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);
                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);

                let initial_point = ContinuationPoint {
                    state: packed_initial_state,
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
            ExtensionRunnerKind::Homoclinic { runner, merge, .. } => (runner.take_result(), merge),
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
    use super::{
        canonicalize_homoclinic_point_state, cap_extension_step_size,
        hydrate_homoclinic_setup_from_endpoint, orient_extension_tangent,
        seed_anchor_aug_from_upoldp, try_warm_start_homoclinic_riccati,
    };
    use fork_core::continuation::{
        pack_homoclinic_state, BifurcationType, BranchType, ContinuationBranch, ContinuationPoint,
        ContinuationSettings, HomoclinicBasis, HomoclinicExtraFlags, HomoclinicGuess,
        HomoclinicSetup,
    };
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

    #[test]
    fn orient_extension_tangent_with_secant_biases_tiny_parameter_component() {
        let mut tangent = DVector::from_vec(vec![1e-12, 1.0, 0.0]);
        let secant = DVector::from_vec(vec![-0.1, -2.0, 0.0]);

        orient_extension_tangent(&mut tangent, Some(&secant), true);

        assert!(
            tangent[0] < -1e-3,
            "secant-oriented tangent should get a non-trivial parameter component, got {}",
            tangent[0]
        );
        assert!(
            tangent.dot(&secant) > 0.0,
            "tangent must stay aligned with secant"
        );
    }

    #[test]
    fn warm_start_homoclinic_riccati_recovers_endpoint_values() {
        let mut setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![0.0, 0.0], vec![0.5, 0.0], vec![1.0, 0.0]],
                stage_states: vec![vec![vec![0.25, 0.0]], vec![vec![0.75, 0.0]]],
                x0: vec![0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 2.0,
                eps0: 0.1,
                eps1: 0.2,
                yu: vec![0.3],
                ys: vec![0.4],
            },
            ntst: 2,
            ncol: 1,
            param1_index: 0,
            param2_index: 1,
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            base_params: vec![0.2, 0.1],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            basis: HomoclinicBasis {
                stable_q: vec![1.0, 0.0, 0.0, 1.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
        };

        let endpoint_state = pack_homoclinic_state(&setup);
        setup.guess.yu = vec![0.0];
        setup.guess.ys = vec![0.0];

        let warmed = try_warm_start_homoclinic_riccati(&mut setup, &endpoint_state);
        assert!(warmed, "expected warm-start to decode endpoint state");
        assert_eq!(setup.guess.yu, vec![0.3]);
        assert_eq!(setup.guess.ys, vec![0.4]);
    }

    #[test]
    fn hydrate_setup_from_endpoint_recovers_endpoint_mesh_and_riccati() {
        let mut setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![9.0, 9.0], vec![9.0, 9.0], vec![9.0, 9.0]],
                stage_states: vec![vec![vec![9.0, 9.0]], vec![vec![9.0, 9.0]]],
                x0: vec![9.0, 9.0],
                param1_value: 0.2,
                param2_value: 0.9,
                time: 9.0,
                eps0: 9.0,
                eps1: 9.0,
                yu: vec![0.0],
                ys: vec![0.0],
            },
            ntst: 2,
            ncol: 1,
            param1_index: 0,
            param2_index: 1,
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            base_params: vec![0.2, 0.1],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            basis: HomoclinicBasis {
                stable_q: vec![1.0, 0.0, 0.0, 1.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
        };

        let endpoint_setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![0.0, 0.0], vec![0.5, 0.0], vec![1.0, 0.0]],
                stage_states: vec![vec![vec![0.25, 0.0]], vec![vec![0.75, 0.0]]],
                x0: vec![0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 2.0,
                eps0: 0.1,
                eps1: 0.2,
                yu: vec![0.3],
                ys: vec![0.4],
            },
            ntst: setup.ntst,
            ncol: setup.ncol,
            param1_index: setup.param1_index,
            param2_index: setup.param2_index,
            param1_name: setup.param1_name.clone(),
            param2_name: setup.param2_name.clone(),
            base_params: setup.base_params.clone(),
            extras: setup.extras,
            basis: setup.basis.clone(),
        };
        let endpoint_state = pack_homoclinic_state(&endpoint_setup);

        let hydrated = hydrate_homoclinic_setup_from_endpoint(&mut setup, &endpoint_state, 2);
        assert!(hydrated, "expected endpoint decode to hydrate setup");
        assert_eq!(setup.guess.mesh_states, endpoint_setup.guess.mesh_states);
        assert_eq!(setup.guess.stage_states, endpoint_setup.guess.stage_states);
        assert_eq!(setup.guess.x0, endpoint_setup.guess.x0);
        assert_eq!(setup.guess.param2_value, endpoint_setup.guess.param2_value);
        assert_eq!(setup.guess.time, endpoint_setup.guess.time);
        assert_eq!(setup.guess.eps0, endpoint_setup.guess.eps0);
        // free_eps1 is disabled in this setup, so eps1 remains at the configured fixed value.
        assert_eq!(setup.guess.eps1, 9.0);
        assert_eq!(setup.guess.yu, endpoint_setup.guess.yu);
        assert_eq!(setup.guess.ys, endpoint_setup.guess.ys);
    }

    #[test]
    fn canonicalize_homoclinic_point_state_round_trips_valid_state() {
        let setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![0.0, 0.0], vec![0.5, 0.0], vec![1.0, 0.0]],
                stage_states: vec![vec![vec![0.25, 0.0]], vec![vec![0.75, 0.0]]],
                x0: vec![0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 2.0,
                eps0: 0.1,
                eps1: 0.2,
                yu: vec![0.3],
                ys: vec![0.4],
            },
            ntst: 2,
            ncol: 1,
            param1_index: 0,
            param2_index: 1,
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            base_params: vec![0.2, 0.1],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            basis: HomoclinicBasis {
                stable_q: vec![1.0, 0.0, 0.0, 1.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
        };

        let state = pack_homoclinic_state(&setup);
        let canonical =
            canonicalize_homoclinic_point_state(&setup, &state, 2).expect("canonical state");
        assert_eq!(canonical, state);
    }

    #[test]
    fn cap_extension_step_size_limits_predictor_to_local_secant_scale() {
        let mut settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 10,
            corrector_steps: 8,
            corrector_tolerance: 1e-7,
            step_tolerance: 1e-7,
        };

        cap_extension_step_size(&mut settings, Some(0.003));

        assert!((settings.step_size - 0.003).abs() < 1e-12);
        assert!(settings.max_step_size >= settings.step_size);
        assert!(settings.min_step_size <= settings.step_size);
    }

    #[test]
    fn seed_anchor_aug_from_upoldp_reads_single_augmented_seed() {
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![1.0, 2.0],
                param_value: 0.5,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::HomoclinicCurve {
                ntst: 2,
                ncol: 1,
                param1_name: "mu".to_string(),
                param2_name: "nu".to_string(),
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            upoldp: Some(vec![vec![0.4, 1.0, 2.0]]),
        };

        let anchor = seed_anchor_aug_from_upoldp(&branch, 3).expect("seed anchor");
        assert_eq!(anchor.as_slice(), &[0.4, 1.0, 2.0]);
    }
}
