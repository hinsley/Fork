//! Continuation branch extension runner.

use super::shared::{compute_tangent_from_problem, OwnedEquilibriumContinuationProblem};
use crate::system::build_system;
use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::periodic::PeriodicOrbitCollocationProblem;
use fork_core::continuation::{
    decode_homoclinic_state, homoclinic_setup_from_homoclinic_point, pack_homoclinic_state,
    BranchType, ContinuationBranch, ContinuationEndpointSeed, ContinuationPoint,
    ContinuationProblem, ContinuationResumeState, ContinuationRunner, ContinuationSettings,
    HomoclinicBasis, HomoclinicBasisSnapshot, HomoclinicExtraFlags, HomoclinicResumeContext,
    HomoclinicSetup,
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
        return;
    }

    let tangent_norm = tangent.norm();
    let param_component_threshold = 0.01 * tangent_norm;

    if tangent[0].abs() < param_component_threshold {
        tangent[0] = param_component_threshold * forward_sign;
        let norm = tangent.norm();
        if norm > 1e-12 {
            *tangent = &*tangent / norm;
        }
    } else if tangent[0] * forward_sign < 0.0 {
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

fn cap_homoclinic_step_size_in_parameter_plane(
    settings: &mut ContinuationSettings,
    tangent: &DVector<f64>,
    secant_param_norm: Option<f64>,
    p2_aug_index: usize,
) {
    let Some(local_param_span) = secant_param_norm else {
        return;
    };
    if !local_param_span.is_finite() || local_param_span <= 1e-12 {
        return;
    }
    if p2_aug_index >= tangent.len() {
        return;
    }

    let tangent_param_norm =
        (tangent[0] * tangent[0] + tangent[p2_aug_index] * tangent[p2_aug_index]).sqrt();
    if !tangent_param_norm.is_finite() || tangent_param_norm <= 1e-12 {
        return;
    }

    let capped = ((2.0 * local_param_span) / tangent_param_norm)
        .clamp(settings.min_step_size, settings.max_step_size);
    if settings.step_size > capped {
        settings.step_size = capped;
    }
}

fn homoclinic_tangent_is_nonlocal_in_parameter_plane(
    tangent: &DVector<f64>,
    secant_direction: Option<&DVector<f64>>,
    secant_param_norm: Option<f64>,
    p2_aug_index: usize,
    step_size: f64,
) -> bool {
    let Some(secant) = secant_direction else {
        return false;
    };
    let Some(local_param_span) = secant_param_norm else {
        return false;
    };
    if p2_aug_index >= tangent.len() || p2_aug_index >= secant.len() {
        return false;
    }
    if !local_param_span.is_finite()
        || local_param_span <= 1e-12
        || !step_size.is_finite()
        || step_size <= 0.0
    {
        return false;
    }

    let t0 = tangent[0];
    let tp2 = tangent[p2_aug_index];
    let tangent_param_norm = (t0 * t0 + tp2 * tp2).sqrt();
    if !tangent_param_norm.is_finite() || tangent_param_norm <= 1e-12 {
        return false;
    }

    let s0 = secant[0];
    let sp2 = secant[p2_aug_index];
    let secant_param_dir_norm = (s0 * s0 + sp2 * sp2).sqrt();
    if !secant_param_dir_norm.is_finite() || secant_param_dir_norm <= 1e-12 {
        return false;
    }

    let alignment = ((t0 * s0 + tp2 * sp2) / (tangent_param_norm * secant_param_dir_norm)).abs();
    let predicted_jump = tangent_param_norm * step_size;

    alignment < 0.6 || predicted_jump > 3.0 * local_param_span
}

fn validate_resume_seed(
    seed: &ContinuationEndpointSeed,
    endpoint_index: i32,
    expected_aug_len: usize,
) -> bool {
    if seed.endpoint_index != endpoint_index {
        return false;
    }
    if seed.aug_state.len() != expected_aug_len || seed.tangent.len() != expected_aug_len {
        return false;
    }
    if seed.aug_state.iter().any(|v| !v.is_finite()) {
        return false;
    }
    if seed.tangent.iter().any(|v| !v.is_finite()) {
        return false;
    }
    if !seed.step_size.is_finite() || seed.step_size <= 0.0 {
        return false;
    }
    DVector::from_vec(seed.tangent.clone()).norm() > 1e-12
}

fn select_resume_seed(
    branch: &ContinuationBranch,
    forward: bool,
    endpoint_index: i32,
    expected_aug_len: usize,
) -> Option<ContinuationEndpointSeed> {
    let seed = if forward {
        branch
            .resume_state
            .as_ref()
            .and_then(|state| state.max_index_seed.clone())
    } else {
        branch
            .resume_state
            .as_ref()
            .and_then(|state| state.min_index_seed.clone())
    }?;
    if validate_resume_seed(&seed, endpoint_index, expected_aug_len) {
        Some(seed)
    } else {
        None
    }
}

fn prepare_resume_seed_for_extension(
    seed: ContinuationEndpointSeed,
    endpoint_aug: &DVector<f64>,
    secant_direction: Option<&DVector<f64>>,
    forward: bool,
) -> (Vec<f64>, Vec<f64>) {
    let resume_aug = if seed.aug_state.len() == endpoint_aug.len() {
        seed.aug_state
    } else {
        endpoint_aug.iter().copied().collect()
    };

    let mut resume_tangent = DVector::from_vec(seed.tangent);
    if let Some(secant) = secant_direction {
        orient_extension_tangent(&mut resume_tangent, Some(secant), forward);
    } else {
        orient_extension_tangent(&mut resume_tangent, None, forward);
    }

    if resume_tangent.norm() <= 1e-12 {
        let mut fallback = DVector::zeros(endpoint_aug.len());
        fallback[0] = if forward { 1.0 } else { -1.0 };
        resume_tangent = fallback;
    }

    (resume_aug, resume_tangent.iter().copied().collect())
}

fn merge_extension_resume_state(
    base_resume: Option<ContinuationResumeState>,
    extension_resume: Option<ContinuationResumeState>,
    index_offset: i32,
    sign: i32,
    merged_indices: &[i32],
) -> Option<ContinuationResumeState> {
    let mut merged_resume = base_resume.unwrap_or_default();
    let Some(extension_resume) = extension_resume else {
        return if merged_resume.min_index_seed.is_some() || merged_resume.max_index_seed.is_some() {
            Some(merged_resume)
        } else {
            None
        };
    };

    let min_index = merged_indices.iter().copied().min();
    let max_index = merged_indices.iter().copied().max();

    let mut assign_mapped_seed = |mapped_seed: ContinuationEndpointSeed| {
        if let (Some(min_index), Some(max_index)) = (min_index, max_index) {
            if mapped_seed.endpoint_index <= min_index {
                merged_resume.min_index_seed = Some(mapped_seed);
                return;
            }
            if mapped_seed.endpoint_index >= max_index {
                merged_resume.max_index_seed = Some(mapped_seed);
                return;
            }
            // Interior seeds are stale carry-over metadata from the source branch;
            // extension should only update boundary seeds.
            return;
        }

        if sign > 0 {
            merged_resume.max_index_seed = Some(mapped_seed);
        } else {
            merged_resume.min_index_seed = Some(mapped_seed);
        }
    };

    if let Some(seed) = extension_resume.max_index_seed {
        assign_mapped_seed(ContinuationEndpointSeed {
            endpoint_index: index_offset + seed.endpoint_index * sign,
            aug_state: seed.aug_state,
            tangent: seed.tangent,
            step_size: seed.step_size,
        });
    }
    if let Some(seed) = extension_resume.min_index_seed {
        assign_mapped_seed(ContinuationEndpointSeed {
            endpoint_index: index_offset + seed.endpoint_index * sign,
            aug_state: seed.aug_state,
            tangent: seed.tangent,
            step_size: seed.step_size,
        });
    }

    if merged_resume.min_index_seed.is_some() || merged_resume.max_index_seed.is_some() {
        Some(merged_resume)
    } else {
        None
    }
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

fn homoc_context_from_setup(setup: &HomoclinicSetup) -> HomoclinicResumeContext {
    HomoclinicResumeContext {
        base_params: setup.base_params.clone(),
        param1_index: setup.param1_index,
        param2_index: setup.param2_index,
        basis: HomoclinicBasisSnapshot {
            stable_q: setup.basis.stable_q.clone(),
            unstable_q: setup.basis.unstable_q.clone(),
            dim: setup.basis.dim,
            nneg: setup.basis.nneg,
            npos: setup.basis.npos,
        },
        fixed_time: setup.guess.time,
        fixed_eps0: setup.guess.eps0,
        fixed_eps1: setup.guess.eps1,
    }
}

fn apply_homoc_context_to_setup(
    setup: &mut HomoclinicSetup,
    context: &HomoclinicResumeContext,
) -> bool {
    if context.param1_index >= context.base_params.len()
        || context.param2_index >= context.base_params.len()
    {
        return false;
    }
    let dim = setup.guess.x0.len();
    if context.basis.dim != dim {
        return false;
    }
    if context.basis.stable_q.len() != dim * dim || context.basis.unstable_q.len() != dim * dim {
        return false;
    }
    if context.basis.nneg == 0
        || context.basis.npos == 0
        || context.basis.nneg + context.basis.npos != dim
    {
        return false;
    }
    if !context.fixed_time.is_finite() || context.fixed_time <= 0.0 {
        return false;
    }
    if !context.fixed_eps0.is_finite() || context.fixed_eps0 <= 0.0 {
        return false;
    }
    if !context.fixed_eps1.is_finite() || context.fixed_eps1 <= 0.0 {
        return false;
    }
    let y_size = context.basis.nneg * context.basis.npos;
    if setup.guess.yu.len() != y_size || setup.guess.ys.len() != y_size {
        return false;
    }

    setup.base_params = context.base_params.clone();
    setup.param1_index = context.param1_index;
    setup.param2_index = context.param2_index;
    setup.basis = HomoclinicBasis {
        stable_q: context.basis.stable_q.clone(),
        unstable_q: context.basis.unstable_q.clone(),
        dim: context.basis.dim,
        nneg: context.basis.nneg,
        npos: context.basis.npos,
    };
    setup.guess.time = context.fixed_time;
    setup.guess.eps0 = context.fixed_eps0;
    setup.guess.eps1 = context.fixed_eps1;
    true
}

fn synthesize_homoc_context_from_branch_seed(
    system: &mut EquationSystem,
    branch: &ContinuationBranch,
    ntst: usize,
    ncol: usize,
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Option<HomoclinicResumeContext> {
    let mut endpoint_state: Option<Vec<f64>> = None;
    let mut param1_value: Option<f64> = None;

    if let Some(seed) = branch
        .resume_state
        .as_ref()
        .and_then(|state| state.min_index_seed.as_ref())
        .or_else(|| {
            branch
                .resume_state
                .as_ref()
                .and_then(|state| state.max_index_seed.as_ref())
        })
    {
        if seed.aug_state.len() > 1 {
            endpoint_state = Some(seed.aug_state[1..].to_vec());
            param1_value = Some(seed.aug_state[0]);
        }
    }

    let seed_pos = branch
        .indices
        .iter()
        .enumerate()
        .min_by_key(|(_, &idx)| idx)
        .map(|(pos, _)| pos)?;
    let seed_point = branch.points.get(seed_pos)?;

    let endpoint_state = endpoint_state.unwrap_or_else(|| seed_point.state.clone());
    let param1_value = param1_value.unwrap_or(seed_point.param_value);

    let mut base_params = system.params.clone();
    if param1_index >= base_params.len() || param2_index >= base_params.len() {
        return None;
    }
    base_params[param1_index] = param1_value;
    let dim = system.equations.len();
    if let Some(param2_value) =
        extract_homoclinic_param2_from_packed_state(&endpoint_state, ntst, ncol, dim)
    {
        base_params[param2_index] = param2_value;
    }

    let mut setup = homoclinic_setup_from_homoclinic_point(
        system,
        &endpoint_state,
        ntst,
        ncol,
        ntst,
        ncol,
        &base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
    )
    .ok()?;

    let dim = system.equations.len();
    if !hydrate_homoclinic_setup_from_endpoint(&mut setup, &endpoint_state, dim) {
        return None;
    }

    Some(homoc_context_from_setup(&setup))
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

fn extract_homoclinic_param2_from_packed_state(
    point_state: &[f64],
    ntst: usize,
    ncol: usize,
    dim: usize,
) -> Option<f64> {
    if dim == 0 {
        return None;
    }
    let mesh_len = (ntst + 1).checked_mul(dim)?;
    let stage_len = ntst.checked_mul(ncol)?.checked_mul(dim)?;
    let x0_len = dim;
    let param2_index = mesh_len.checked_add(stage_len)?.checked_add(x0_len)?;
    let value = *point_state.get(param2_index)?;
    if value.is_finite() {
        Some(value)
    } else {
        None
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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, dim + 1);

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

                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);
                let mut runner = if let Some(seed) = resume_seed {
                    let (resume_aug, resume_tangent) = prepare_resume_seed_for_extension(
                        seed,
                        &end_aug,
                        secant_direction.as_ref(),
                        forward,
                    );
                    ContinuationRunner::new_from_seed(
                        problem,
                        resume_aug,
                        resume_tangent,
                        settings.step_size,
                        settings,
                    )
                    .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?
                } else {
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

                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?
                };
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
                let problem = PeriodicOrbitCollocationProblem::new(
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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, dim + 1);

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

                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);
                // SAFETY: The problem borrows the boxed system allocation, which lives
                // for the lifetime of the runner.
                let mut problem: PeriodicOrbitCollocationProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut runner = if let Some(seed) = resume_seed {
                    let (resume_aug, resume_tangent) = prepare_resume_seed_for_extension(
                        seed,
                        &end_aug,
                        secant_direction.as_ref(),
                        forward,
                    );
                    ContinuationRunner::new_from_seed(
                        problem,
                        resume_aug,
                        resume_tangent,
                        settings.step_size,
                        settings,
                    )
                    .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?
                } else {
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

                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?
                };
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
                if let Some(param2_value) = extract_homoclinic_param2_from_packed_state(
                    &endpoint.state,
                    *ntst,
                    *ncol,
                    system.equations.len(),
                ) {
                    base_params[param2_index] = param2_value;
                }
                let extras = HomoclinicExtraFlags {
                    free_time: *free_time,
                    free_eps0: *free_eps0,
                    free_eps1: *free_eps1,
                };
                let has_saved_homoc_context = merge.branch.homoc_context.is_some();
                if !has_saved_homoc_context && (!free_time || !free_eps0 || !free_eps1) {
                    return Err(JsValue::from_str(
                        "Homoclinic extension needs saved fixed time/endpoint-distance metadata. Recompute the homoclinic branch with the current build and try extending again.",
                    ));
                }
                let homoc_context = merge.branch.homoc_context.clone().or_else(|| {
                    synthesize_homoc_context_from_branch_seed(
                        &mut system,
                        &merge.branch,
                        *ntst,
                        *ncol,
                        param1_index,
                        param2_index,
                        param1_name,
                        param2_name,
                        extras,
                    )
                });

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
                    extras,
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to initialize homoclinic extension: {}", e))
                })?;
                let system_dim = system.equations.len();
                if !hydrate_homoclinic_setup_from_endpoint(&mut setup, &endpoint.state, system_dim)
                {
                    return Err(JsValue::from_str(
                        "Failed to decode the homoclinic endpoint state for extension. Use explicit Homoclinic from Homoclinic with a valid packed point.",
                    ));
                }
                if let Some(context) = homoc_context.as_ref() {
                    if !apply_homoc_context_to_setup(&mut setup, context) {
                        return Err(JsValue::from_str(
                            "Homoclinic extension context is incompatible with this endpoint state. Recompute the branch from the original initialization and try extending again.",
                        ));
                    }
                }
                let packed_initial_state = pack_homoclinic_state(&setup);
                let secant_template = setup.clone();

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem =
                    HomoclinicProblem::new(unsafe { &mut *system_ptr }, setup).map_err(|e| {
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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, dim + 1);
                let mut secant_direction: Option<DVector<f64>> = None;
                let mut secant_norm: Option<f64> = None;
                let mut secant_param_norm: Option<f64> = None;
                let mut bootstrap_direction: Option<DVector<f64>> = None;
                let mut canonical_neighbor_state: Option<Vec<f64>> = None;
                let second_neighbor_idx = if merge.branch.points.len() > 2 {
                    let candidates = merge
                        .branch
                        .indices
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| *i != endpoint_idx && Some(*i) != neighbor_idx);
                    if forward {
                        candidates.max_by_key(|(_, &idx)| idx).map(|(i, _)| i)
                    } else {
                        candidates.min_by_key(|(_, &idx)| idx).map(|(i, _)| i)
                    }
                } else {
                    None
                };
                let p2_aug_index =
                    1 + ((*ntst + 1) * system_dim + *ntst * *ncol * system_dim + system_dim);
                if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    if let Some(neighbor_state) = canonicalize_homoclinic_point_state(
                        &secant_template,
                        &neighbor.state,
                        system_dim,
                    ) {
                        let mut neighbor_aug = DVector::zeros(dim + 1);
                        neighbor_aug[0] = neighbor.param_value;
                        for (i, &v) in neighbor_state.iter().enumerate() {
                            neighbor_aug[i + 1] = v;
                        }
                        let secant = &end_aug - &neighbor_aug;
                        let norm = secant.norm();
                        if norm > 1e-12 {
                            secant_direction = Some(secant.normalize());
                            secant_norm = Some(norm);
                            bootstrap_direction = secant_direction.clone();
                            if p2_aug_index < neighbor_aug.len() && p2_aug_index < end_aug.len() {
                                let dp1 = end_aug[0] - neighbor_aug[0];
                                let dp2 = end_aug[p2_aug_index] - neighbor_aug[p2_aug_index];
                                secant_param_norm = Some((dp1 * dp1 + dp2 * dp2).sqrt());
                            }
                        }
                        canonical_neighbor_state = Some(neighbor_state);

                        if let Some(second_pos) = second_neighbor_idx {
                            let second = &merge.branch.points[second_pos];
                            if let Some(second_state) = canonicalize_homoclinic_point_state(
                                &secant_template,
                                &second.state,
                                system_dim,
                            ) {
                                let mut second_aug = DVector::zeros(dim + 1);
                                second_aug[0] = second.param_value;
                                for (i, &v) in second_state.iter().enumerate() {
                                    second_aug[i + 1] = v;
                                }

                                let d1 = &end_aug - &neighbor_aug;
                                let d2 = &neighbor_aug - &second_aug;
                                let extrapolated = d1 * 1.5 - d2 * 0.5;
                                if extrapolated.norm() > 1e-12 {
                                    bootstrap_direction = Some(extrapolated.normalize());
                                }
                            }
                        }
                    }
                }

                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);
                let mut problem: HomoclinicProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let phase_reference_aug = resume_seed
                    .as_ref()
                    .and_then(|seed| {
                        if seed.aug_state.len() == dim + 1 {
                            Some(DVector::from_vec(seed.aug_state.clone()))
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| end_aug.clone());
                problem
                    .update_after_step(&phase_reference_aug)
                    .map_err(|e| {
                        JsValue::from_str(&format!(
                            "Failed to prepare homoclinic extension phase reference: {}",
                            e
                        ))
                    })?;
                let mut runner = if let Some(seed) = resume_seed {
                    let (resume_aug, resume_tangent) = prepare_resume_seed_for_extension(
                        seed,
                        &end_aug,
                        secant_direction.as_ref(),
                        forward,
                    );
                    let mut resume_tangent_vec = DVector::from_vec(resume_tangent);
                    if homoclinic_tangent_is_nonlocal_in_parameter_plane(
                        &resume_tangent_vec,
                        secant_direction.as_ref(),
                        secant_param_norm,
                        p2_aug_index,
                        settings.step_size,
                    ) {
                        if let Some(secant) = secant_direction.as_ref() {
                            resume_tangent_vec = secant.clone();
                        }
                    }
                    cap_homoclinic_step_size_in_parameter_plane(
                        &mut settings,
                        &resume_tangent_vec,
                        secant_param_norm,
                        p2_aug_index,
                    );
                    ContinuationRunner::new_from_seed(
                        problem,
                        resume_aug,
                        resume_tangent_vec.iter().copied().collect(),
                        settings.step_size,
                        settings,
                    )
                    .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?
                } else {
                    if neighbor_idx.is_none() {
                        return Err(JsValue::from_str(
                            "Homoclinic extension needs at least two branch points when resume metadata is unavailable.",
                        ));
                    }
                    if canonical_neighbor_state.is_none() {
                        return Err(JsValue::from_str(
                            "Failed to decode neighboring homoclinic point for local extension seed.",
                        ));
                    }

                    let mut tangent = if let Some(bootstrap) = bootstrap_direction.as_ref() {
                        bootstrap.clone()
                    } else if let Some(secant) = secant_direction.as_ref() {
                        secant.clone()
                    } else {
                        compute_tangent_from_problem(&mut problem, &end_aug)
                            .map_err(|e| JsValue::from_str(&format!("{}", e)))?
                    };

                    orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);
                    cap_homoclinic_step_size_in_parameter_plane(
                        &mut settings,
                        &tangent,
                        secant_param_norm,
                        p2_aug_index,
                    );

                    let initial_point = ContinuationPoint {
                        state: packed_initial_state,
                        param_value: endpoint.param_value,
                        stability: endpoint.stability.clone(),
                        eigenvalues: endpoint.eigenvalues.clone(),
                        cycle_points: endpoint.cycle_points.clone(),
                    };

                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?
                };
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());
                let homoc_context =
                    homoc_context.or_else(|| Some(homoc_context_from_setup(&secant_template)));
                runner.set_homoc_context(homoc_context);

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

        branch.resume_state = merge_extension_resume_state(
            branch.resume_state.take(),
            extension.resume_state,
            index_offset,
            sign,
            &branch.indices,
        );
        if branch.homoc_context.is_none() {
            branch.homoc_context = extension.homoc_context;
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
    fn extension_runner_caps_resume_seed_first_step_to_local_scale() {
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
                    state: vec![1.01],
                    param_value: 1.01,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: Some(fork_core::continuation::ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(fork_core::continuation::ContinuationEndpointSeed {
                    endpoint_index: 1,
                    aug_state: vec![1.01, 1.01],
                    tangent: vec![1.0, 1.0],
                    step_size: 0.2,
                }),
            }),
        };
        let branch_val = to_value(&branch).expect("branch");

        let settings = ContinuationSettings {
            step_size: 1.0,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 1,
            corrector_steps: 8,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        };

        let mut runner = WasmContinuationExtensionRunner::new(
            vec!["x - a".to_string()],
            vec![1.01],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            to_value(&settings).expect("settings"),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let result_val = runner.get_result().expect("result");
        let result_branch: ContinuationBranch = from_value(result_val).expect("branch");
        let endpoint = result_branch.points[1].param_value;
        let next = result_branch.points[2].param_value;
        let delta = (next - endpoint).abs();
        assert!(
            delta < 0.05,
            "resume-seeded extension should stay local to endpoint secant scale, got {}",
            delta
        );
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

    #[wasm_bindgen_test]
    fn homoclinic_extension_requires_saved_fixed_metadata_when_extras_not_free() {
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::HomoclinicCurve {
                ntst: 2,
                ncol: 1,
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let err = WasmContinuationExtensionRunner::new(
            vec!["x".to_string()],
            vec![0.0, 0.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(1),
            true,
        )
        .expect_err("legacy branch should require fixed metadata");

        let msg = err
            .as_string()
            .unwrap_or_else(|| "missing error message".to_string());
        assert!(
            msg.contains("saved fixed time/endpoint-distance metadata"),
            "unexpected error message: {}",
            msg
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
        apply_homoc_context_to_setup, canonicalize_homoclinic_point_state, cap_extension_step_size,
        cap_homoclinic_step_size_in_parameter_plane,
        homoclinic_tangent_is_nonlocal_in_parameter_plane, hydrate_homoclinic_setup_from_endpoint,
        orient_extension_tangent, prepare_resume_seed_for_extension,
    };
    use fork_core::continuation::{
        pack_homoclinic_state, BifurcationType, BranchType, ContinuationBranch,
        ContinuationEndpointSeed, ContinuationPoint, ContinuationResumeState, ContinuationSettings,
        HomoclinicBasis, HomoclinicBasisSnapshot, HomoclinicExtraFlags, HomoclinicGuess,
        HomoclinicResumeContext, HomoclinicSetup,
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
    fn orient_extension_tangent_with_secant_keeps_tiny_parameter_component() {
        let mut tangent = DVector::from_vec(vec![1e-12, 1.0, 0.0]);
        let secant = DVector::from_vec(vec![-0.1, -2.0, 0.0]);

        orient_extension_tangent(&mut tangent, Some(&secant), true);

        assert!(
            tangent[0].abs() < 1e-9,
            "secant-oriented tangent should preserve the parameter component, got {}",
            tangent[0]
        );
        assert!(
            tangent.dot(&secant) > 0.0,
            "tangent must stay aligned with secant"
        );
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
    fn apply_homoc_context_restores_fixed_scalars() {
        let mut setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![0.0, 0.0], vec![0.5, 0.0], vec![1.0, 0.0]],
                stage_states: vec![vec![vec![0.25, 0.0]], vec![vec![0.75, 0.0]]],
                x0: vec![0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 1.0,
                eps0: 1e-2,
                eps1: 1e-2,
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
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
            basis: HomoclinicBasis {
                stable_q: vec![1.0, 0.0, 0.0, 1.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
        };

        let context = HomoclinicResumeContext {
            base_params: vec![0.2, 0.1],
            param1_index: 0,
            param2_index: 1,
            basis: HomoclinicBasisSnapshot {
                stable_q: vec![1.0, 0.0, 0.0, 1.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
            fixed_time: 42.0,
            fixed_eps0: 0.03,
            fixed_eps1: 0.04,
        };

        assert!(apply_homoc_context_to_setup(&mut setup, &context));
        assert_eq!(setup.guess.time, 42.0);
        assert_eq!(setup.guess.eps0, 0.03);
        assert_eq!(setup.guess.eps1, 0.04);
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
    fn cap_homoclinic_step_size_limits_parameter_plane_jump() {
        let mut settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 10,
            corrector_steps: 8,
            corrector_tolerance: 1e-7,
            step_tolerance: 1e-7,
        };
        let tangent = DVector::from_vec(vec![0.0, 0.0, 5.0]);

        cap_homoclinic_step_size_in_parameter_plane(&mut settings, &tangent, Some(0.001), 2);

        assert!(settings.step_size < 0.01, "expected step size clamp");
        assert!(settings.step_size >= settings.min_step_size);
    }

    #[test]
    fn homoclinic_tangent_nonlocal_detector_flags_large_parameter_jump() {
        let tangent = DVector::from_vec(vec![0.0, 0.0, 3.0]);
        let secant = DVector::from_vec(vec![0.1, 0.0, 0.1]);
        let nonlocal = homoclinic_tangent_is_nonlocal_in_parameter_plane(
            &tangent,
            Some(&secant),
            Some(0.001),
            2,
            0.01,
        );
        assert!(nonlocal, "expected nonlocal tangent detection");
    }

    #[test]
    fn prepare_resume_seed_keeps_saved_aug_state_and_orients_tangent() {
        let seed = ContinuationEndpointSeed {
            endpoint_index: 5,
            aug_state: vec![0.0, 10.0, -10.0],
            tangent: vec![0.0, 1.0, 0.0],
            step_size: 0.01,
        };
        let endpoint_aug = DVector::from_vec(vec![1.0, 2.0, 3.0]);
        let secant = DVector::from_vec(vec![1.0, 0.0, 0.0]);
        let (resume_aug, resume_tangent) =
            prepare_resume_seed_for_extension(seed, &endpoint_aug, Some(&secant), true);

        assert_eq!(resume_aug, vec![0.0, 10.0, -10.0]);
        assert!(
            (resume_tangent[0] - 0.0).abs() < 1e-12
                && (resume_tangent[1] - 1.0).abs() < 1e-12
                && resume_tangent[2].abs() < 1e-12,
            "expected saved tangent orientation to be preserved, got {:?}",
            resume_tangent
        );
    }

    #[test]
    fn prepare_resume_seed_keeps_local_seed_alignment() {
        let seed = ContinuationEndpointSeed {
            endpoint_index: 5,
            aug_state: vec![1.001, 2.001, 3.001],
            tangent: vec![0.0, 1.0, 0.1],
            step_size: 0.01,
        };
        let endpoint_aug = DVector::from_vec(vec![1.0, 2.0, 3.0]);
        let secant = DVector::from_vec(vec![0.0, 1.0, 0.0]);
        let (resume_aug, resume_tangent) =
            prepare_resume_seed_for_extension(seed, &endpoint_aug, Some(&secant), true);

        assert_eq!(resume_aug, vec![1.001, 2.001, 3.001]);
        assert!(
            resume_tangent[1] > 0.0,
            "aligned tangent should preserve local direction"
        );
    }

    #[test]
    fn select_resume_seed_prefers_requested_side_and_validates_dimensions() {
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![3],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: Some(fork_core::continuation::ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(fork_core::continuation::ContinuationEndpointSeed {
                    endpoint_index: 3,
                    aug_state: vec![0.2, 0.0],
                    tangent: vec![1.0, 0.0],
                    step_size: 0.02,
                }),
            }),
        };

        let seed = super::select_resume_seed(&branch, true, 3, 2).expect("seed");
        assert_eq!(seed.step_size, 0.02);
        assert!(super::select_resume_seed(&branch, true, 4, 2).is_none());
    }

    #[test]
    fn merge_extension_resume_state_keeps_new_boundary_seed_when_stale_interior_seed_exists() {
        let base = Some(ContinuationResumeState {
            min_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: -3,
                aug_state: vec![0.0],
                tangent: vec![1.0],
                step_size: 0.01,
            }),
            max_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: 5,
                aug_state: vec![0.0],
                tangent: vec![1.0],
                step_size: 0.01,
            }),
        });
        let extension = Some(ContinuationResumeState {
            // New extension endpoint from runner-local index 2 maps to branch index 7.
            max_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: 2,
                aug_state: vec![1.0],
                tangent: vec![1.0],
                step_size: 0.02,
            }),
            // Stale carry-over seed would map to interior index 2 and must be ignored.
            min_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: -3,
                aug_state: vec![2.0],
                tangent: vec![-1.0],
                step_size: 0.03,
            }),
        });

        let merged = super::merge_extension_resume_state(
            base,
            extension,
            5,
            1,
            &[-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7],
        )
        .expect("merged resume state");

        let max = merged.max_index_seed.expect("max seed");
        assert_eq!(max.endpoint_index, 7);
        assert_eq!(max.aug_state, vec![1.0]);
        let min = merged.min_index_seed.expect("min seed");
        assert_eq!(min.endpoint_index, -3);
    }
}
