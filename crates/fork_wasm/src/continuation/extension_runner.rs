//! Continuation branch extension runner.

use super::runner_boundary::static_system_ref;
use super::shared::{compute_tangent_from_problem, OwnedEquilibriumContinuationProblem};
use crate::system::build_system;
use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::homoclinic_init::decode_homoclinic_state_with_basis;
use fork_core::continuation::periodic::{
    uniform_normalized_mesh, CollocationAdaptationReport, CollocationAdaptivitySettings,
    PeriodicOrbitCollocationProblem,
};
use fork_core::continuation::{
    decode_homoclinic_shooting_state, heteroclinic_setup_from_point,
    heteroclinic_shooting_setup_from_point, homoclinic_setup_from_homoclinic_point,
    homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh,
    homoclinic_shooting_setup_from_point, orient_problem_tangent, pack_homoclinic_shooting_state,
    pack_homoclinic_state, palc_norm, BranchType, ContinuationBranch, ContinuationEndpointSeed,
    ContinuationPoint, ContinuationProblem, ContinuationResumeState, ContinuationRunner,
    ContinuationSettings, HeteroclinicProblem, HeteroclinicShootingProblem, HomoclinicBasis,
    HomoclinicBasisSnapshot, HomoclinicDiscretization, HomoclinicExtraFlags,
    HomoclinicFixedScalars, HomoclinicResumeContext, HomoclinicSetup, HomoclinicShootingProblem,
    HomoclinicShootingSettings, HomoclinicShootingSetup, ReparameterizationSeed,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::SystemKind;
use fork_core::traits::DynamicalSystem;
use nalgebra::DVector;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn validate_limit_cycle_extension_system_type(system_type: &str) -> Result<(), &'static str> {
    if system_type == "flow" {
        Ok(())
    } else {
        Err("Limit-cycle collocation is available for flow systems only.")
    }
}

fn transfer_external_resume_state<P: ContinuationProblem>(
    problem: &P,
    resume_state: &mut Option<ContinuationResumeState>,
) -> Result<(), JsValue> {
    let Some(resume) = resume_state.as_mut() else {
        return Ok(());
    };
    let mut locations = Vec::new();
    let mut seeds = Vec::new();
    for (is_min, seed) in [
        (true, resume.min_index_seed.as_ref()),
        (false, resume.max_index_seed.as_ref()),
    ] {
        if let Some(seed) = seed {
            locations.push(is_min);
            seeds.push(ReparameterizationSeed {
                aug_state: DVector::from_vec(seed.aug_state.clone()),
                tangent: DVector::from_vec(seed.tangent.clone()),
            });
        }
    }
    let transferred = problem
        .transfer_endpoint_seeds_to_current_coordinates(&seeds)
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to transfer homoclinic endpoint resume seeds: {}",
                error
            ))
        })?;
    if transferred.len() != locations.len() {
        return Err(JsValue::from_str(
            "Homoclinic coordinate transfer changed the number of endpoint resume seeds",
        ));
    }
    for (is_min, transferred) in locations.into_iter().zip(transferred) {
        let target = if is_min {
            resume.min_index_seed.as_mut()
        } else {
            resume.max_index_seed.as_mut()
        };
        if let Some(target) = target {
            target.aug_state = transferred.aug_state.as_slice().to_vec();
            target.tangent = transferred.tangent.as_slice().to_vec();
        }
    }
    Ok(())
}

struct ExtensionMergeContext {
    branch: ContinuationBranch,
    index_offset: i32,
    sign: i32,
    collocation_adaptation: Option<CollocationAdaptationReport>,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
struct ExtensionRunnerOptions {
    #[serde(default)]
    collocation_adaptivity: CollocationAdaptivitySettings,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PersistedExtensionMetadata {
    #[serde(default)]
    collocation_adaptation: Option<CollocationAdaptationReport>,
}

#[derive(Serialize)]
struct ExtensionBranchResult {
    #[serde(flatten)]
    branch: ContinuationBranch,
    #[serde(skip_serializing_if = "Option::is_none")]
    collocation_adaptation: Option<CollocationAdaptationReport>,
}

#[derive(Serialize)]
struct AtomicExtensionResult {
    branch: ContinuationBranch,
    collocation_adaptation: Option<CollocationAdaptationReport>,
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
    Heteroclinic {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<HeteroclinicProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    HeteroclinicShooting {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<HeteroclinicShootingProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    HomoclinicShooting {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<HomoclinicShootingProblem<'static>>,
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

    if tangent[0] * forward_sign < 0.0 {
        *tangent = -tangent.clone();
    }
}

fn normalized_problem_secant<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
    secant: DVector<f64>,
) -> anyhow::Result<(Option<DVector<f64>>, Option<f64>)> {
    let norm = palc_norm(problem, aug_state, &secant)?;
    if norm > 1e-12 {
        Ok((Some(secant / norm), Some(norm)))
    } else {
        Ok((None, None))
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
    endpoint_aug: &DVector<f64>,
) -> bool {
    if seed.endpoint_index != endpoint_index {
        return false;
    }
    if seed.aug_state.len() != endpoint_aug.len() || seed.tangent.len() != endpoint_aug.len() {
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
    if seed
        .aug_state
        .iter()
        .zip(endpoint_aug.iter())
        .any(|(saved, endpoint)| {
            let scale = 1.0 + saved.abs().max(endpoint.abs());
            (saved - endpoint).abs() > 1e-12 * scale
        })
    {
        return false;
    }
    DVector::from_vec(seed.tangent.clone()).norm() > 1e-12
}

fn select_resume_seed(
    branch: &ContinuationBranch,
    forward: bool,
    endpoint_index: i32,
    endpoint_aug: &DVector<f64>,
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
    if validate_resume_seed(&seed, endpoint_index, endpoint_aug) {
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
    let resume_aug = endpoint_aug.iter().copied().collect();

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

fn bounded_resume_step_size(
    seed: &ContinuationEndpointSeed,
    settings: ContinuationSettings,
) -> f64 {
    seed.step_size.min(settings.step_size)
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
    let Ok(decoded) = decode_homoclinic_state_with_basis(
        endpoint_state,
        dim,
        setup.ntst,
        setup.ncol,
        setup.extras,
        setup.guess.time,
        setup.guess.eps0,
        setup.guess.eps1,
        (setup.basis.nneg, setup.basis.npos),
    ) else {
        return false;
    };

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
        projector_refresh_interval: setup.projector_refresh_interval,
    }
}

fn homoc_context_from_shooting_setup(setup: &HomoclinicShootingSetup) -> HomoclinicResumeContext {
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
        projector_refresh_interval: setup.projector_refresh_interval,
    }
}

fn homoclinic_basis_from_context(
    context: &HomoclinicResumeContext,
    dim: usize,
    expected_param1_index: usize,
    expected_param2_index: usize,
    expected_param_count: usize,
    expected_y_size: usize,
) -> Option<HomoclinicBasis> {
    if context.param1_index != expected_param1_index
        || context.param2_index != expected_param2_index
        || context.param1_index >= context.base_params.len()
        || context.param2_index >= context.base_params.len()
        || context.base_params.len() != expected_param_count
    {
        return None;
    }
    if context.basis.dim != dim
        || context.basis.stable_q.len() != dim * dim
        || context.basis.unstable_q.len() != dim * dim
        || context
            .basis
            .stable_q
            .iter()
            .chain(&context.basis.unstable_q)
            .any(|value| !value.is_finite())
    {
        return None;
    }
    if context.basis.nneg == 0
        || context.basis.npos == 0
        || context.basis.nneg + context.basis.npos != dim
        || context.basis.nneg * context.basis.npos != expected_y_size
    {
        return None;
    }
    if !context.fixed_time.is_finite()
        || context.fixed_time <= 0.0
        || !context.fixed_eps0.is_finite()
        || context.fixed_eps0 <= 0.0
        || !context.fixed_eps1.is_finite()
        || context.fixed_eps1 <= 0.0
    {
        return None;
    }

    Some(HomoclinicBasis {
        stable_q: context.basis.stable_q.clone(),
        unstable_q: context.basis.unstable_q.clone(),
        dim: context.basis.dim,
        nneg: context.basis.nneg,
        npos: context.basis.npos,
    })
}

fn apply_homoc_context_to_setup(
    setup: &mut HomoclinicSetup,
    context: &HomoclinicResumeContext,
) -> bool {
    let dim = setup.guess.x0.len();
    if setup.guess.yu.len() != setup.guess.ys.len() {
        return false;
    }
    let Some(basis) = homoclinic_basis_from_context(
        context,
        dim,
        setup.param1_index,
        setup.param2_index,
        setup.base_params.len(),
        setup.guess.yu.len(),
    ) else {
        return false;
    };

    setup.base_params = context.base_params.clone();
    setup.basis = basis;
    setup.guess.time = context.fixed_time;
    setup.guess.eps0 = context.fixed_eps0;
    setup.guess.eps1 = context.fixed_eps1;
    setup.projector_refresh_interval = context.projector_refresh_interval;
    true
}

fn apply_homoc_context_to_shooting_setup(
    setup: &mut HomoclinicShootingSetup,
    context: &HomoclinicResumeContext,
) -> bool {
    let dim = setup.guess.x0.len();
    if setup.guess.yu.len() != setup.guess.ys.len() {
        return false;
    }
    let Some(basis) = homoclinic_basis_from_context(
        context,
        dim,
        setup.param1_index,
        setup.param2_index,
        setup.base_params.len(),
        setup.guess.yu.len(),
    ) else {
        return false;
    };

    setup.base_params = context.base_params.clone();
    setup.basis = basis;
    setup.guess.time = context.fixed_time;
    setup.guess.eps0 = context.fixed_eps0;
    setup.guess.eps1 = context.fixed_eps1;
    setup.projector_refresh_interval = context.projector_refresh_interval;
    true
}

fn hydrate_homoclinic_shooting_setup_from_endpoint(
    setup: &mut HomoclinicShootingSetup,
    endpoint_state: &[f64],
) -> bool {
    let Ok(decoded) = decode_homoclinic_shooting_state(endpoint_state, setup) else {
        return false;
    };
    setup.guess.nodes = decoded.nodes;
    setup.guess.x0 = decoded.x0;
    setup.guess.param2_value = decoded.param2_value;
    setup.guess.time = decoded.time;
    setup.guess.eps0 = decoded.eps0;
    setup.guess.eps1 = decoded.eps1;
    setup.guess.yu = decoded.yu;
    setup.guess.ys = decoded.ys;
    true
}

/// Restore the exact defining-system chart persisted with the branch before
/// interpreting its endpoint coordinates. A projector refresh can leave the
/// final accepted point in the chart installed on the preceding step, so a
/// fresh eigenspace calculation at that endpoint is not an equivalent decoder.
fn restore_homoclinic_extension_setup(
    setup: &mut HomoclinicSetup,
    context: &HomoclinicResumeContext,
    endpoint_state: &[f64],
    dim: usize,
) -> bool {
    if !apply_homoc_context_to_setup(setup, context)
        || !hydrate_homoclinic_setup_from_endpoint(setup, endpoint_state, dim)
    {
        return false;
    }
    setup.initial_seed_is_corrected = true;
    true
}

fn restore_homoclinic_shooting_extension_setup(
    setup: &mut HomoclinicShootingSetup,
    context: &HomoclinicResumeContext,
    endpoint_state: &[f64],
) -> bool {
    if !apply_homoc_context_to_shooting_setup(setup, context)
        || !hydrate_homoclinic_shooting_setup_from_endpoint(setup, endpoint_state)
    {
        return false;
    }
    setup.initial_seed_is_corrected = true;
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

#[allow(clippy::too_many_arguments)]
fn homoclinic_shooting_setup_for_point(
    system: &mut EquationSystem,
    point: &ContinuationPoint,
    source_intervals: usize,
    shooting: HomoclinicShootingSettings,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
    fixed: HomoclinicFixedScalars,
) -> anyhow::Result<HomoclinicShootingSetup> {
    let mut point_params = base_params.to_vec();
    if param1_index >= point_params.len() {
        anyhow::bail!("Homoclinic shooting parameter index out of range");
    }
    point_params[param1_index] = point.param_value;
    homoclinic_shooting_setup_from_point(
        system,
        &point.state,
        source_intervals,
        shooting,
        &point_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
        extras,
        fixed,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_homoclinic_shooting_extension(
    mut system: EquationSystem,
    merge: ExtensionMergeContext,
    endpoint: ContinuationPoint,
    endpoint_idx: usize,
    neighbor_idx: Option<usize>,
    last_index: i32,
    forward: bool,
    intervals: usize,
    integration_steps_per_segment: usize,
    param1_name: &str,
    param2_name: &str,
    free_time: bool,
    free_eps0: bool,
    free_eps1: bool,
    settings: ContinuationSettings,
) -> Result<ExtensionRunnerKind, JsValue> {
    let param1_index = *system
        .param_map
        .get(param1_name)
        .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
    let param2_index = *system
        .param_map
        .get(param2_name)
        .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
    let context = merge.branch.homoc_context.clone().ok_or_else(|| {
        JsValue::from_str(
            "Homoclinic shooting extension needs saved fixed time/endpoint-distance metadata. Recompute the branch with the current build and try extending again.",
        )
    })?;
    let mut base_params = context.base_params.clone();
    if param1_index >= base_params.len() || param2_index >= base_params.len() {
        return Err(JsValue::from_str(
            "Homoclinic shooting parameter index out of range",
        ));
    }
    base_params[param1_index] = endpoint.param_value;
    if let Some(param2_value) = extract_homoclinic_param2_from_packed_state(
        &endpoint.state,
        intervals,
        0,
        system.equations.len(),
    ) {
        base_params[param2_index] = param2_value;
    }

    let extras = HomoclinicExtraFlags {
        free_time,
        free_eps0,
        free_eps1,
    };
    let fixed = HomoclinicFixedScalars {
        time: context.fixed_time,
        eps0: context.fixed_eps0,
        eps1: context.fixed_eps1,
    };
    if !fixed.time.is_finite()
        || fixed.time <= 0.0
        || !fixed.eps0.is_finite()
        || fixed.eps0 <= 0.0
        || !fixed.eps1.is_finite()
        || fixed.eps1 <= 0.0
    {
        return Err(JsValue::from_str(
            "Homoclinic shooting extension has invalid fixed time/endpoint-distance metadata.",
        ));
    }
    let shooting = HomoclinicShootingSettings {
        intervals,
        integration_steps_per_segment,
    };

    let mut setup = homoclinic_shooting_setup_for_point(
        &mut system,
        &endpoint,
        intervals,
        shooting,
        &base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
        fixed,
    )
    .map_err(|error| {
        JsValue::from_str(&format!(
            "Failed to initialize homoclinic shooting extension: {}",
            error
        ))
    })?;
    if !restore_homoclinic_shooting_extension_setup(&mut setup, &context, &endpoint.state) {
        return Err(JsValue::from_str(
            "Saved homoclinic shooting chart is incompatible with the branch endpoint. Recompute the branch with the current build and try extending again.",
        ));
    }
    let packed_initial_state = pack_homoclinic_shooting_state(&setup);
    let extension_context = homoc_context_from_shooting_setup(&setup);

    let canonical_neighbor_state = neighbor_idx.and_then(|neighbor_pos| {
        merge.branch.points.get(neighbor_pos).and_then(|neighbor| {
            homoclinic_shooting_setup_for_point(
                &mut system,
                neighbor,
                intervals,
                shooting,
                &base_params,
                param1_index,
                param2_index,
                param1_name,
                param2_name,
                extras,
                fixed,
            )
            .ok()
            .and_then(|mut setup| {
                restore_homoclinic_shooting_extension_setup(&mut setup, &context, &neighbor.state)
                    .then(|| pack_homoclinic_shooting_state(&setup))
            })
        })
    });
    let second_neighbor_idx = if merge.branch.points.len() > 2 {
        let candidates = merge
            .branch
            .indices
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != endpoint_idx && Some(*index) != neighbor_idx);
        if forward {
            candidates
                .max_by_key(|(_, &index)| index)
                .map(|(index, _)| index)
        } else {
            candidates
                .min_by_key(|(_, &index)| index)
                .map(|(index, _)| index)
        }
    } else {
        None
    };
    let canonical_second_neighbor_state = second_neighbor_idx.and_then(|neighbor_pos| {
        merge.branch.points.get(neighbor_pos).and_then(|neighbor| {
            homoclinic_shooting_setup_for_point(
                &mut system,
                neighbor,
                intervals,
                shooting,
                &base_params,
                param1_index,
                param2_index,
                param1_name,
                param2_name,
                extras,
                fixed,
            )
            .ok()
            .and_then(|mut setup| {
                restore_homoclinic_shooting_extension_setup(&mut setup, &context, &neighbor.state)
                    .then(|| pack_homoclinic_shooting_state(&setup))
            })
        })
    });

    let system_dim = system.equations.len();
    let mut boxed_system = Box::new(system);
    let mut problem = HomoclinicShootingProblem::new(static_system_ref(&mut boxed_system), setup)
        .map_err(|error| {
        JsValue::from_str(&format!(
            "Failed to create homoclinic shooting extension problem: {}",
            error
        ))
    })?;
    let dimension = problem.dimension();
    if packed_initial_state.len() != dimension {
        return Err(JsValue::from_str(&format!(
            "Dimension mismatch: branch point state has length {}, problem expects {}",
            packed_initial_state.len(),
            dimension
        )));
    }

    let mut end_aug = DVector::zeros(dimension + 1);
    end_aug[0] = endpoint.param_value;
    for (index, value) in packed_initial_state.iter().copied().enumerate() {
        end_aug[index + 1] = value;
    }
    let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);
    let mut secant_direction = None;
    let mut secant_norm = None;
    let mut secant_param_norm = None;
    let mut bootstrap_direction = None;
    let p2_aug_index = 1 + (intervals + 1) * system_dim + system_dim;

    if let (Some(neighbor_pos), Some(neighbor_state)) =
        (neighbor_idx, canonical_neighbor_state.as_ref())
    {
        let neighbor = &merge.branch.points[neighbor_pos];
        let mut neighbor_aug = DVector::zeros(dimension + 1);
        neighbor_aug[0] = neighbor.param_value;
        for (index, value) in neighbor_state.iter().copied().enumerate() {
            neighbor_aug[index + 1] = value;
        }
        let secant = &end_aug - &neighbor_aug;
        let (direction, norm) =
            normalized_problem_secant(&problem, &end_aug, secant).map_err(|error| {
                JsValue::from_str(&format!(
                    "Failed to measure homoclinic shooting extension secant: {}",
                    error
                ))
            })?;
        secant_direction = direction;
        secant_norm = norm;
        bootstrap_direction = secant_direction.clone();
        if p2_aug_index < neighbor_aug.len() {
            let dp1 = end_aug[0] - neighbor_aug[0];
            let dp2 = end_aug[p2_aug_index] - neighbor_aug[p2_aug_index];
            secant_param_norm = Some((dp1 * dp1 + dp2 * dp2).sqrt());
        }

        if let (Some(second_pos), Some(second_state)) = (
            second_neighbor_idx,
            canonical_second_neighbor_state.as_ref(),
        ) {
            let second = &merge.branch.points[second_pos];
            let mut second_aug = DVector::zeros(dimension + 1);
            second_aug[0] = second.param_value;
            for (index, value) in second_state.iter().copied().enumerate() {
                second_aug[index + 1] = value;
            }
            let d1 = &end_aug - &neighbor_aug;
            let d2 = &neighbor_aug - &second_aug;
            let extrapolated = d1 * 1.5 - d2 * 0.5;
            if extrapolated.norm() > 1e-12 {
                bootstrap_direction = Some(extrapolated.normalize());
            }
        }
    }

    let mut settings = settings;
    cap_extension_step_size(&mut settings, secant_norm);
    problem.update_after_step(&end_aug).map_err(|error| {
        JsValue::from_str(&format!(
            "Failed to prepare homoclinic shooting extension phase reference: {}",
            error
        ))
    })?;
    let mut runner = if let Some(seed) = resume_seed {
        let mut resume_step_size = bounded_resume_step_size(&seed, settings);
        let (resume_aug, resume_tangent) =
            prepare_resume_seed_for_extension(seed, &end_aug, secant_direction.as_ref(), forward);
        let mut resume_tangent = DVector::from_vec(resume_tangent);
        if homoclinic_tangent_is_nonlocal_in_parameter_plane(
            &resume_tangent,
            secant_direction.as_ref(),
            secant_param_norm,
            p2_aug_index,
            resume_step_size,
        ) {
            if let Some(secant) = secant_direction.as_ref() {
                resume_tangent = secant.clone();
            }
        }
        cap_homoclinic_step_size_in_parameter_plane(
            &mut settings,
            &resume_tangent,
            secant_param_norm,
            p2_aug_index,
        );
        resume_step_size = resume_step_size.min(settings.step_size);
        ContinuationRunner::new_from_seed(
            problem,
            resume_aug,
            resume_tangent.iter().copied().collect(),
            resume_step_size,
            settings,
        )
        .map_err(|error| JsValue::from_str(&format!("Continuation init failed: {}", error)))?
    } else {
        if neighbor_idx.is_none() {
            return Err(JsValue::from_str(
                "Homoclinic shooting extension needs at least two branch points when resume metadata is unavailable.",
            ));
        }
        if canonical_neighbor_state.is_none() {
            return Err(JsValue::from_str(
                "Failed to decode neighboring homoclinic shooting point for local extension seed.",
            ));
        }
        let mut tangent = if let Some(bootstrap) = bootstrap_direction {
            bootstrap
        } else if let Some(secant) = secant_direction.as_ref() {
            secant.clone()
        } else {
            compute_tangent_from_problem(&mut problem, &end_aug)
                .map_err(|error| JsValue::from_str(&format!("{}", error)))?
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
            stability: endpoint.stability,
            eigenvalues: endpoint.eigenvalues,
            cycle_points: endpoint.cycle_points,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
            .map_err(|error| JsValue::from_str(&format!("Continuation init failed: {}", error)))?
    };
    runner.set_branch_type(merge.branch.branch_type.clone());
    runner.set_upoldp(merge.branch.upoldp.clone());
    runner.set_homoc_context(Some(extension_context));

    Ok(ExtensionRunnerKind::HomoclinicShooting {
        _system: boxed_system,
        runner,
        merge,
    })
}

fn build_heteroclinic_shooting_extension(
    system: EquationSystem,
    merge: ExtensionMergeContext,
    endpoint: ContinuationPoint,
    neighbor_idx: Option<usize>,
    last_index: i32,
    forward: bool,
    settings: ContinuationSettings,
) -> Result<ExtensionRunnerKind, JsValue> {
    let endpoint_heteroclinic_events = endpoint.heteroclinic_events.clone();
    let setup = heteroclinic_shooting_setup_from_point(&endpoint, &merge.branch.branch_type)
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to restore heteroclinic shooting endpoint: {error}"
            ))
        })?;
    let mut boxed_system = Box::new(system);
    let mut problem = HeteroclinicShootingProblem::new(static_system_ref(&mut boxed_system), setup)
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to create heteroclinic shooting extension problem: {error}"
            ))
        })?;
    let dim = problem.dimension();
    if endpoint.state.len() != dim {
        return Err(JsValue::from_str(&format!(
            "Dimension mismatch: heteroclinic shooting endpoint has length {}, problem expects {}",
            endpoint.state.len(),
            dim
        )));
    }
    let mut end_aug = DVector::zeros(dim + 1);
    end_aug[0] = endpoint.param_value;
    end_aug.as_mut_slice()[1..].copy_from_slice(&endpoint.state);
    let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);
    let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &merge.branch.points[neighbor_pos];
        let mut neighbor_aug = DVector::zeros(dim + 1);
        neighbor_aug[0] = neighbor.param_value;
        neighbor_aug.as_mut_slice()[1..].copy_from_slice(&neighbor.state);
        normalized_problem_secant(&problem, &end_aug, &end_aug - neighbor_aug).map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to measure heteroclinic shooting extension secant: {error}"
            ))
        })?
    } else {
        (None, None)
    };
    let mut settings = settings;
    cap_extension_step_size(&mut settings, secant_norm);
    let mut runner = if let Some(seed) = resume_seed {
        let resume_step_size = bounded_resume_step_size(&seed, settings);
        let (resume_aug, resume_tangent) =
            prepare_resume_seed_for_extension(seed, &end_aug, secant_direction.as_ref(), forward);
        ContinuationRunner::new_from_seed_with_heteroclinic_events(
            problem,
            resume_aug,
            resume_tangent,
            resume_step_size,
            endpoint_heteroclinic_events.clone(),
            settings,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Heteroclinic shooting extension initialization failed: {error}"
            ))
        })?
    } else {
        let mut tangent = if let Some(secant) = secant_direction.as_ref() {
            secant.clone()
        } else {
            compute_tangent_from_problem(&mut problem, &end_aug)
                .map_err(|error| JsValue::from_str(&format!("{error}")))?
        };
        orient_problem_tangent(
            &problem,
            &end_aug,
            &mut tangent,
            secant_direction.as_ref(),
            forward,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to orient heteroclinic shooting extension tangent: {error}"
            ))
        })?;
        let initial_point = ContinuationPoint {
            state: endpoint.state,
            param_value: endpoint.param_value,
            stability: endpoint.stability,
            eigenvalues: Vec::new(),
            cycle_points: endpoint.cycle_points,
            homoclinic_events: None,
            heteroclinic_events: endpoint_heteroclinic_events,
        };
        ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings).map_err(
            |error| {
                JsValue::from_str(&format!(
                    "Heteroclinic shooting extension initialization failed: {error}"
                ))
            },
        )?
    };
    runner.set_branch_type(merge.branch.branch_type.clone());
    Ok(ExtensionRunnerKind::HeteroclinicShooting {
        _system: boxed_system,
        runner,
        merge,
    })
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

        let options: ExtensionRunnerOptions = from_value(settings_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation options: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let persisted_metadata: PersistedExtensionMetadata = from_value(branch_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid branch metadata: {}", e)))?;
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
            collocation_adaptation: persisted_metadata.collocation_adaptation,
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

        let branch_type = merge.branch.branch_type.clone();
        let runner_kind = match &branch_type {
            BranchType::ForcedPeriodicResponse { .. } => {
                return Err(JsValue::from_str(
                    "Forced-response branches are extended with WasmForcedResponseRunner.",
                ));
            }
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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);

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
                    let resume_step_size = bounded_resume_step_size(&seed, settings);
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
                        resume_step_size,
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
                        homoclinic_events: None,
                        heteroclinic_events: None,
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
            BranchType::LimitCycle {
                ntst,
                ncol,
                normalized_mesh,
            } => {
                validate_limit_cycle_extension_system_type(system_type)
                    .map_err(JsValue::from_str)?;
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
                let normalized_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh_with_adaptivity(
                    static_system_ref(&mut boxed_system),
                    param_index,
                    *ncol,
                    phase_anchor,
                    phase_direction,
                    normalized_mesh,
                    options.collocation_adaptivity,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create LC problem: {}", e)))?;
                if let Some(report) = merge.collocation_adaptation.clone() {
                    problem.seed_adaptation_report(report).map_err(|e| {
                        JsValue::from_str(&format!(
                            "Failed to restore LC collocation adaptation report: {}",
                            e
                        ))
                    })?;
                }

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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);

                let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = &end_aug - &neighbor_aug;
                    normalized_problem_secant(&problem, &end_aug, secant).map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to measure LC extension secant: {}",
                            error
                        ))
                    })?
                } else {
                    (None, None)
                };

                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);
                let mut problem: PeriodicOrbitCollocationProblem<'static> = problem;
                let mut runner = if let Some(seed) = resume_seed {
                    let resume_step_size = bounded_resume_step_size(&seed, settings);
                    let (resume_aug, resume_tangent) = prepare_resume_seed_for_extension(
                        seed,
                        &end_aug,
                        secant_direction.as_ref(),
                        forward,
                    );
                    let mut resume_tangent = DVector::from_vec(resume_tangent);
                    orient_problem_tangent(
                        &problem,
                        &end_aug,
                        &mut resume_tangent,
                        secant_direction.as_ref(),
                        forward,
                    )
                    .map_err(|error| {
                        JsValue::from_str(&format!("Failed to orient LC resume tangent: {}", error))
                    })?;
                    ContinuationRunner::new_from_seed(
                        problem,
                        resume_aug,
                        resume_tangent.iter().copied().collect(),
                        resume_step_size,
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

                    orient_problem_tangent(
                        &problem,
                        &end_aug,
                        &mut tangent,
                        secant_direction.as_ref(),
                        forward,
                    )
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to orient LC extension tangent: {}",
                            error
                        ))
                    })?;
                    let initial_point = ContinuationPoint {
                        state: endpoint.state.clone(),
                        param_value: endpoint.param_value,
                        stability: endpoint.stability.clone(),
                        eigenvalues: endpoint.eigenvalues.clone(),
                        cycle_points: endpoint.cycle_points.clone(),
                        homoclinic_events: None,
                        heteroclinic_events: None,
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
            BranchType::HeteroclinicCurve {
                discretization: HomoclinicDiscretization::Shooting { .. },
                ..
            } => {
                if system_type != "flow" {
                    return Err(JsValue::from_str(
                        "Heteroclinic continuation is available only for flows",
                    ));
                }
                build_heteroclinic_shooting_extension(
                    system,
                    merge,
                    endpoint,
                    neighbor_idx,
                    last_index,
                    forward,
                    settings,
                )?
            }
            BranchType::HeteroclinicCurve {
                discretization: HomoclinicDiscretization::Collocation,
                ..
            } => {
                if system_type != "flow" {
                    return Err(JsValue::from_str(
                        "Heteroclinic continuation is available only for flows",
                    ));
                }
                let mut setup =
                    heteroclinic_setup_from_point(&endpoint, &branch_type).map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to restore heteroclinic endpoint: {error}"
                        ))
                    })?;
                setup.collocation_adaptivity = options.collocation_adaptivity;
                let mut boxed_system = Box::new(system);
                let mut problem =
                    HeteroclinicProblem::new(static_system_ref(&mut boxed_system), setup).map_err(
                        |error| {
                            JsValue::from_str(&format!(
                                "Failed to create heteroclinic extension problem: {error}"
                            ))
                        },
                    )?;
                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: heteroclinic endpoint has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }
                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                end_aug.as_mut_slice()[1..].copy_from_slice(&endpoint.state);
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);
                let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    neighbor_aug.as_mut_slice()[1..].copy_from_slice(&neighbor.state);
                    normalized_problem_secant(&problem, &end_aug, &end_aug - neighbor_aug).map_err(
                        |error| {
                            JsValue::from_str(&format!(
                                "Failed to measure heteroclinic extension secant: {error}"
                            ))
                        },
                    )?
                } else {
                    (None, None)
                };
                let mut settings = settings;
                cap_extension_step_size(&mut settings, secant_norm);
                let mut runner = if let Some(seed) = resume_seed {
                    let resume_step_size = bounded_resume_step_size(&seed, settings);
                    let (resume_aug, resume_tangent) = prepare_resume_seed_for_extension(
                        seed,
                        &end_aug,
                        secant_direction.as_ref(),
                        forward,
                    );
                    ContinuationRunner::new_from_seed_with_heteroclinic_events(
                        problem,
                        resume_aug,
                        resume_tangent,
                        resume_step_size,
                        endpoint.heteroclinic_events.clone(),
                        settings,
                    )
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Heteroclinic extension initialization failed: {error}"
                        ))
                    })?
                } else {
                    let mut tangent = if let Some(secant) = secant_direction.as_ref() {
                        secant.clone()
                    } else {
                        compute_tangent_from_problem(&mut problem, &end_aug)
                            .map_err(|error| JsValue::from_str(&format!("{error}")))?
                    };
                    orient_problem_tangent(
                        &problem,
                        &end_aug,
                        &mut tangent,
                        secant_direction.as_ref(),
                        forward,
                    )
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to orient heteroclinic extension tangent: {error}"
                        ))
                    })?;
                    let initial_point = ContinuationPoint {
                        state: endpoint.state.clone(),
                        param_value: endpoint.param_value,
                        stability: endpoint.stability.clone(),
                        eigenvalues: Vec::new(),
                        cycle_points: endpoint.cycle_points.clone(),
                        homoclinic_events: None,
                        heteroclinic_events: endpoint.heteroclinic_events.clone(),
                    };
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|error| {
                            JsValue::from_str(&format!(
                                "Heteroclinic extension initialization failed: {error}"
                            ))
                        })?
                };
                runner.set_branch_type(merge.branch.branch_type.clone());
                ExtensionRunnerKind::Heteroclinic {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
            BranchType::HomoclinicCurve {
                ntst,
                ncol: _,
                discretization:
                    HomoclinicDiscretization::Shooting {
                        integration_steps_per_segment,
                    },
                normalized_mesh: _,
                collocation_adaptivity: _,
                collocation_adaptation: _,
                param1_name,
                param2_name,
                free_time,
                free_eps0,
                free_eps1,
            } => build_homoclinic_shooting_extension(
                system,
                merge,
                endpoint,
                endpoint_idx,
                neighbor_idx,
                last_index,
                forward,
                *ntst,
                *integration_steps_per_segment,
                param1_name,
                param2_name,
                *free_time,
                *free_eps0,
                *free_eps1,
                settings,
            )?,
            BranchType::HomoclinicCurve {
                ntst,
                ncol,
                discretization: HomoclinicDiscretization::Collocation,
                normalized_mesh,
                collocation_adaptivity,
                collocation_adaptation,
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
                if let Some(context) = homoc_context.as_ref() {
                    base_params = context.base_params.clone();
                    if param1_index >= base_params.len() || param2_index >= base_params.len() {
                        return Err(JsValue::from_str(
                            "Saved homoclinic context has an incompatible parameter vector.",
                        ));
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
                }

                let source_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let source_fixed = homoc_context
                    .as_ref()
                    .map(|context| HomoclinicFixedScalars {
                        time: context.fixed_time,
                        eps0: context.fixed_eps0,
                        eps1: context.fixed_eps1,
                    });
                let system_dim = system.equations.len();
                let mut setup = homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh(
                    &mut system,
                    &endpoint.state,
                    *ncol,
                    source_mesh.clone(),
                    *ncol,
                    source_mesh,
                    &base_params,
                    param1_index,
                    param2_index,
                    param1_name,
                    param2_name,
                    extras,
                    extras,
                    source_fixed,
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to initialize homoclinic extension: {}", e))
                })?;
                if let Some(context) = homoc_context.as_ref() {
                    if !restore_homoclinic_extension_setup(
                        &mut setup,
                        context,
                        &endpoint.state,
                        system_dim,
                    ) {
                        return Err(JsValue::from_str(
                            "Saved homoclinic collocation chart is incompatible with the branch endpoint. Recompute the branch with the current build and try extending again.",
                        ));
                    }
                } else {
                    setup.initial_seed_is_corrected = true;
                }
                setup.collocation_adaptivity = *collocation_adaptivity;
                setup.collocation_adaptation = collocation_adaptation.clone();
                let packed_initial_state = pack_homoclinic_state(&setup);
                let secant_template = setup.clone();

                let mut boxed_system = Box::new(system);
                let problem = HomoclinicProblem::new(static_system_ref(&mut boxed_system), setup)
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
                let resume_seed = select_resume_seed(&merge.branch, forward, last_index, &end_aug);
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
                let mut problem: HomoclinicProblem<'static> = problem;
                problem.update_after_step(&end_aug).map_err(|e| {
                    JsValue::from_str(&format!(
                        "Failed to prepare homoclinic extension phase reference: {}",
                        e
                    ))
                })?;
                let mut runner = if let Some(seed) = resume_seed {
                    let mut resume_step_size = bounded_resume_step_size(&seed, settings);
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
                        resume_step_size,
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
                    resume_step_size = resume_step_size.min(settings.step_size);
                    ContinuationRunner::new_from_seed(
                        problem,
                        resume_aug,
                        resume_tangent_vec.iter().copied().collect(),
                        resume_step_size,
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
                        homoclinic_events: None,
                        heteroclinic_events: None,
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
            BranchType::ManifoldEq1D { .. }
            | BranchType::ManifoldEq2D { .. }
            | BranchType::ManifoldCycle2D { .. } => {
                return Err(JsValue::from_str(
                    "Branch extension for invariant manifold branches is not available yet.",
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
            Some(ExtensionRunnerKind::Heteroclinic { runner, .. }) => runner.is_done(),
            Some(ExtensionRunnerKind::HeteroclinicShooting { runner, .. }) => runner.is_done(),
            Some(ExtensionRunnerKind::HomoclinicShooting { runner, .. }) => runner.is_done(),
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
            Some(ExtensionRunnerKind::Heteroclinic { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(ExtensionRunnerKind::HeteroclinicShooting { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(ExtensionRunnerKind::HomoclinicShooting { runner, .. }) => runner
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
            Some(ExtensionRunnerKind::Heteroclinic { runner, .. }) => runner.step_result(),
            Some(ExtensionRunnerKind::HeteroclinicShooting { runner, .. }) => runner.step_result(),
            Some(ExtensionRunnerKind::HomoclinicShooting { runner, .. }) => runner.step_result(),
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        match self.runner.as_ref() {
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => {
                to_value(runner.problem().adaptation_report())
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
            }
            Some(ExtensionRunnerKind::Homoclinic { runner, .. }) => {
                to_value(runner.problem().adaptation_report())
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
            }
            Some(ExtensionRunnerKind::Heteroclinic { runner, .. }) => {
                to_value(runner.problem().adaptation_report())
                    .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
            }
            Some(ExtensionRunnerKind::HeteroclinicShooting { .. }) => Ok(JsValue::NULL),
            Some(ExtensionRunnerKind::HomoclinicShooting { .. }) => Ok(JsValue::NULL),
            _ => Ok(JsValue::NULL),
        }
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let completed = self.take_merged_result()?;
        to_value(&completed).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let completed = self.take_merged_result()?;
        to_value(&AtomicExtensionResult {
            branch: completed.branch,
            collocation_adaptation: completed.collocation_adaptation,
        })
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

impl WasmContinuationExtensionRunner {
    fn take_merged_result(&mut self) -> Result<ExtensionBranchResult, JsValue> {
        let runner_kind = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let (extension, merge) = match runner_kind {
            ExtensionRunnerKind::Equilibrium { runner, merge } => (runner.take_result(), merge),
            ExtensionRunnerKind::LimitCycle {
                runner, mut merge, ..
            } => {
                let (mut extension, problem) = runner.take_result_with_problem();
                let final_mesh = problem.normalized_mesh().to_vec();
                let final_ntst = final_mesh.len().saturating_sub(1);
                let final_ncol = problem.adaptation_report().degree;
                let prior_attempts = merge
                    .collocation_adaptation
                    .as_ref()
                    .map(|report| report.attempts.len())
                    .unwrap_or(0);
                let external_states = merge
                    .branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>();
                let transferred = problem
                    .transfer_branch_states_to_current_discretization(&external_states)
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to transfer existing LC extension history: {}",
                            error
                        ))
                    })?;
                if transferred.len() != merge.branch.points.len() {
                    return Err(JsValue::from_str(
                        "Adaptive LC extension changed the persisted branch length",
                    ));
                }
                fork_core::continuation::apply_transferred_branch_states(
                    &problem,
                    &mut merge.branch.points,
                    transferred,
                )
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Failed to refresh existing LC extension history: {}",
                        error
                    ))
                })?;
                let final_branch_type = BranchType::LimitCycle {
                    ntst: final_ntst,
                    ncol: final_ncol,
                    normalized_mesh: final_mesh,
                };
                extension.branch_type = final_branch_type.clone();
                merge.branch.branch_type = final_branch_type;
                let report = problem.adaptation_report().clone();
                if report.attempts.len() > prior_attempts {
                    // Saved endpoint tangents use the previous numerical layout.
                    // The completed extension contributes fresh final-layout seeds.
                    merge.branch.resume_state = None;
                }
                merge.collocation_adaptation = Some(report);
                (extension, merge)
            }
            ExtensionRunnerKind::Heteroclinic {
                runner, mut merge, ..
            } => {
                let (mut extension, problem) = runner.take_result_with_problem();
                let external_states = merge
                    .branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>();
                let transferred = problem
                    .transfer_branch_states_to_current_discretization(&external_states)
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to transfer existing heteroclinic extension history: {error}"
                        ))
                    })?;
                if transferred.len() != merge.branch.points.len() {
                    return Err(JsValue::from_str(
                        "Adaptive heteroclinic extension changed the persisted branch length",
                    ));
                }
                fork_core::continuation::apply_transferred_branch_states(
                    &problem,
                    &mut merge.branch.points,
                    transferred,
                )
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Failed to refresh existing heteroclinic extension history: {error}"
                    ))
                })?;
                transfer_external_resume_state(&problem, &mut merge.branch.resume_state)?;
                let final_branch_type = problem.branch_type_metadata();
                extension.branch_type = final_branch_type.clone();
                merge.branch.branch_type = final_branch_type;
                let report = problem.adaptation_report().clone();
                merge.collocation_adaptation = Some(report);
                (extension, merge)
            }
            ExtensionRunnerKind::HeteroclinicShooting {
                runner, mut merge, ..
            } => {
                let (mut extension, problem) = runner.take_result_with_problem();
                let external_states = merge
                    .branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>();
                let transferred = problem
                    .transfer_branch_states_to_current_discretization(&external_states)
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to transfer existing heteroclinic shooting history: {error}"
                        ))
                    })?;
                fork_core::continuation::apply_transferred_branch_states(
                    &problem,
                    &mut merge.branch.points,
                    transferred,
                )
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Failed to refresh existing heteroclinic shooting history: {error}"
                    ))
                })?;
                transfer_external_resume_state(&problem, &mut merge.branch.resume_state)?;
                let final_branch_type = problem.branch_type_metadata();
                extension.branch_type = final_branch_type.clone();
                merge.branch.branch_type = final_branch_type;
                merge.collocation_adaptation = None;
                (extension, merge)
            }
            ExtensionRunnerKind::Homoclinic {
                runner, mut merge, ..
            } => {
                let (mut extension, problem) = runner.take_result_with_problem();
                let external_states = merge
                    .branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>();
                let transferred = problem
                    .transfer_branch_states_to_current_discretization(&external_states)
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to transfer existing homoclinic extension history: {}",
                            error
                        ))
                    })?;
                if transferred.len() != merge.branch.points.len() {
                    return Err(JsValue::from_str(
                        "Adaptive homoclinic extension changed the persisted branch length",
                    ));
                }
                fork_core::continuation::apply_transferred_branch_states(
                    &problem,
                    &mut merge.branch.points,
                    transferred,
                )
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Failed to refresh existing homoclinic extension history: {}",
                        error
                    ))
                })?;
                transfer_external_resume_state(&problem, &mut merge.branch.resume_state)?;
                let context = problem.resume_context();
                let final_branch_type = problem.branch_type_metadata();
                extension.branch_type = final_branch_type.clone();
                extension.homoc_context = Some(context.clone());
                merge.branch.branch_type = final_branch_type;
                merge.branch.homoc_context = Some(context);
                let report = problem.adaptation_report().clone();
                merge.collocation_adaptation = Some(report);
                (extension, merge)
            }
            ExtensionRunnerKind::HomoclinicShooting {
                runner, mut merge, ..
            } => {
                let (mut extension, problem) = runner.take_result_with_problem();
                let setup = problem.setup();
                let external_states = merge
                    .branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>();
                let transferred = problem
                    .transfer_branch_states_to_current_discretization(&external_states)
                    .map_err(|error| {
                        JsValue::from_str(&format!(
                            "Failed to transfer existing shooting homoclinic extension history: {}",
                            error
                        ))
                    })?;
                if transferred.len() != merge.branch.points.len() {
                    return Err(JsValue::from_str(
                        "Shooting homoclinic extension changed the persisted branch length",
                    ));
                }
                fork_core::continuation::apply_transferred_branch_states(
                    &problem,
                    &mut merge.branch.points,
                    transferred,
                )
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Failed to refresh existing shooting homoclinic extension history: {}",
                        error
                    ))
                })?;
                transfer_external_resume_state(&problem, &mut merge.branch.resume_state)?;
                let final_branch_type = BranchType::HomoclinicCurve {
                    ntst: setup.shooting.intervals,
                    ncol: 0,
                    discretization: HomoclinicDiscretization::Shooting {
                        integration_steps_per_segment: setup.shooting.integration_steps_per_segment,
                    },
                    normalized_mesh: Vec::new(),
                    collocation_adaptivity: CollocationAdaptivitySettings::default(),
                    collocation_adaptation: None,
                    param1_name: setup.param1_name.clone(),
                    param2_name: setup.param2_name.clone(),
                    free_time: setup.extras.free_time,
                    free_eps0: setup.extras.free_eps0,
                    free_eps1: setup.extras.free_eps1,
                };
                let context = problem.resume_context();
                extension.branch_type = final_branch_type.clone();
                extension.homoc_context = Some(context.clone());
                merge.branch.branch_type = final_branch_type;
                merge.branch.homoc_context = Some(context);
                merge.collocation_adaptation = None;
                (extension, merge)
            }
        };

        let collocation_adaptation = merge.collocation_adaptation;
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

        Ok(ExtensionBranchResult {
            branch,
            collocation_adaptation,
        })
    }
}

#[cfg(test)]
mod limit_cycle_system_type_tests {
    use super::validate_limit_cycle_extension_system_type;

    #[test]
    fn limit_cycle_extension_accepts_flows_and_rejects_maps() {
        assert!(validate_limit_cycle_extension_system_type("flow").is_ok());
        let error = validate_limit_cycle_extension_system_type("map")
            .expect_err("map limit-cycle extension must be rejected");
        assert!(error.contains("flow systems only"));
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
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
    fn extension_runner_rejects_limit_cycle_branches_for_map_systems() {
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![1.0, 1.0, 2.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
                heteroclinic_events: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::LimitCycle {
                ntst: 1,
                ncol: 1,
                normalized_mesh: vec![0.0, 1.0],
            },
            upoldp: Some(vec![vec![1.0]]),
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let result = WasmContinuationExtensionRunner::new(
            vec!["x + a".to_string()],
            vec![0.0],
            vec!["a".to_string()],
            vec!["x".to_string()],
            "map",
            1,
            branch_val,
            "a",
            settings_value(1),
            true,
        );

        let message = match result {
            Ok(_) => panic!("map limit-cycle extension must be rejected"),
            Err(error) => error.as_string().unwrap_or_default(),
        };
        assert!(message.contains("flow systems only"));
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
                homoclinic_events: None,
                heteroclinic_events: None,
            }],
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![1.1],
                    param_value: 1.1,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![1.01],
                    param_value: 1.01,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
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
            manifold_geometry: None,
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
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.21],
                    param_value: 0.21,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.1],
                    param_value: 0.1,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.3],
                    param_value: 0.3,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -1, 1],
            branch_type: BranchType::Equilibrium,
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
                homoclinic_events: None,
                heteroclinic_events: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::HomoclinicCurve {
                ntst: 2,
                ncol: 1,
                discretization: fork_core::continuation::HomoclinicDiscretization::Collocation,
                normalized_mesh: Vec::new(),
                collocation_adaptivity: Default::default(),
                collocation_adaptation: None,
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let result = WasmContinuationExtensionRunner::new(
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
        );
        let err = match result {
            Ok(_) => panic!("legacy branch should require fixed metadata"),
            Err(err) => err,
        };

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
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![2.0, 20.0, 3.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![30.0, 300.0, 5.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -1, 2],
            branch_type: BranchType::LimitCycle {
                ntst: 1,
                ncol: 1,
                normalized_mesh: vec![0.0, 1.0],
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
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
        apply_homoc_context_to_setup, bounded_resume_step_size,
        canonicalize_homoclinic_point_state, cap_extension_step_size,
        cap_homoclinic_step_size_in_parameter_plane, homoc_context_from_setup,
        homoc_context_from_shooting_setup, homoclinic_tangent_is_nonlocal_in_parameter_plane,
        hydrate_homoclinic_setup_from_endpoint, normalized_problem_secant,
        orient_extension_tangent, prepare_resume_seed_for_extension,
        restore_homoclinic_extension_setup, restore_homoclinic_shooting_extension_setup,
        transfer_external_resume_state, HomoclinicProblem,
    };
    use fork_core::continuation::{
        compute_homoclinic_basis, orient_problem_tangent, pack_homoclinic_shooting_state,
        pack_homoclinic_state, BifurcationType, BranchType, ContinuationBranch,
        ContinuationEndpointSeed, ContinuationPoint, ContinuationProblem, ContinuationResumeState,
        ContinuationSettings, HomoclinicBasis, HomoclinicBasisSnapshot, HomoclinicExtraFlags,
        HomoclinicGuess, HomoclinicResumeContext, HomoclinicSetup, HomoclinicShootingGuess,
        HomoclinicShootingProblem, HomoclinicShootingSettings, HomoclinicShootingSetup,
        PointDiagnostics, ReparameterizationSeed, TestFunctionValues,
    };
    use fork_core::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::{DMatrix, DVector};

    struct WeightedMetricProblem;

    fn moving_saddle_system() -> EquationSystem {
        // A(a) = [1 a; 0 -1]. The stable eigenspace rotates with `a`, so a
        // context saved on the previous (even) refresh step is intentionally
        // different from a basis freshly computed at the following odd step.
        let x = Bytecode {
            ops: vec![
                OpCode::LoadVar(0),
                OpCode::LoadParam(0),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
            ],
        };
        let y = Bytecode {
            ops: vec![OpCode::LoadConst(-1.0), OpCode::LoadVar(1), OpCode::Mul],
        };
        let mut system = EquationSystem::new(vec![x, y], vec![1.0, 0.0]);
        system.param_map.insert("a".to_string(), 0);
        system.param_map.insert("b".to_string(), 1);
        system.var_map.insert("x".to_string(), 0);
        system.var_map.insert("y".to_string(), 1);
        system
    }

    fn odd_step_saved_collocation_setup(system: &mut EquationSystem) -> HomoclinicSetup {
        let basis = compute_homoclinic_basis(system, &[0.0, 0.0], &[0.0, 0.0])
            .expect("saved even-step basis");
        HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![vec![0.1, 0.0], vec![0.05, 0.05], vec![0.0, 0.1]],
                stage_states: vec![vec![vec![0.075, 0.025]], vec![vec![0.025, 0.075]]],
                x0: vec![0.0, 0.0],
                param1_value: 1.0,
                param2_value: 0.0,
                time: 2.0,
                eps0: 0.1,
                eps1: 0.1,
                // This also forces an immediate angle-triggered refresh in
                // the extension problem, independent of the cadence reset.
                yu: vec![0.5],
                ys: vec![-0.45],
            },
            ntst: 2,
            ncol: 1,
            normalized_mesh: vec![0.0, 0.5, 1.0],
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            initial_seed_is_corrected: true,
            param1_index: 0,
            param2_index: 1,
            param1_name: "a".to_string(),
            param2_name: "b".to_string(),
            base_params: vec![0.0, 0.0],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            basis,
        }
    }

    fn odd_step_saved_shooting_setup(system: &mut EquationSystem) -> HomoclinicShootingSetup {
        let collocation = odd_step_saved_collocation_setup(system);
        HomoclinicShootingSetup {
            guess: HomoclinicShootingGuess {
                nodes: collocation.guess.mesh_states.clone(),
                x0: collocation.guess.x0.clone(),
                param1_value: collocation.guess.param1_value,
                param2_value: collocation.guess.param2_value,
                time: collocation.guess.time,
                eps0: collocation.guess.eps0,
                eps1: collocation.guess.eps1,
                yu: collocation.guess.yu.clone(),
                ys: collocation.guess.ys.clone(),
            },
            shooting: HomoclinicShootingSettings {
                intervals: 2,
                integration_steps_per_segment: 8,
            },
            param1_index: collocation.param1_index,
            param2_index: collocation.param2_index,
            param1_name: collocation.param1_name,
            param2_name: collocation.param2_name,
            base_params: collocation.base_params,
            extras: collocation.extras,
            basis: collocation.basis,
            projector_refresh_interval: collocation.projector_refresh_interval,
            initial_seed_is_corrected: true,
        }
    }

    fn augmented(parameter: f64, state: &[f64]) -> DVector<f64> {
        let mut aug = DVector::zeros(state.len() + 1);
        aug[0] = parameter;
        aug.as_mut_slice()[1..].copy_from_slice(state);
        aug
    }

    fn assert_vectors_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        let error = actual
            .iter()
            .zip(expected)
            .map(|(lhs, rhs)| (lhs - rhs).abs())
            .fold(0.0_f64, f64::max);
        assert!(error < 1e-10, "vector mismatch: max error={error:.3e}");
    }

    impl ContinuationProblem for WeightedMetricProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(
            &mut self,
            _aug_state: &DVector<f64>,
            out: &mut DVector<f64>,
        ) -> anyhow::Result<()> {
            out[0] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> anyhow::Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[1.0, 0.0]))
        }

        fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> anyhow::Result<DVector<f64>> {
            Ok(DVector::from_vec(vec![1.0, 100.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> anyhow::Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

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
    fn orient_extension_tangent_preserves_a_fold_tangent_without_a_secant() {
        // J = [1, 0, 0], so this is a genuine J-null tangent at a parameter
        // fold. Orientation may change its sign, but must not manufacture a
        // parameter component and move it out of ker(J).
        let mut tangent = DVector::from_vec(vec![0.0, 1.0, -0.5]);
        let jacobian_row = DVector::from_vec(vec![1.0, 0.0, 0.0]);
        let original = tangent.clone();

        orient_extension_tangent(&mut tangent, None, true);

        assert_eq!(tangent, original);
        assert_eq!(jacobian_row.dot(&tangent), 0.0);
    }

    #[test]
    fn limit_cycle_extension_uses_the_problem_palc_metric_for_secants() {
        let problem = WeightedMetricProblem;
        let aug_state = DVector::zeros(2);
        let raw_secant = DVector::from_vec(vec![10.0, 2.0]);
        let euclidean_norm = raw_secant.norm();
        let (direction, norm) =
            normalized_problem_secant(&problem, &aug_state, raw_secant).expect("weighted secant");
        let direction = direction.expect("nonzero direction");
        let norm = norm.expect("nonzero norm");

        assert!((norm - 500.0_f64.sqrt()).abs() < 1e-12);
        assert!((norm - euclidean_norm).abs() > 1.0);
        let weights = problem
            .palc_metric_weights(&aug_state)
            .expect("PALC weights");
        assert!((direction.dot(&weights.component_mul(&direction)) - 1.0).abs() < 1e-12);

        // Euclidean and PALC orientation disagree for this pair. The LC path
        // must follow the PALC sign used by its corrector hyperplane.
        let mut tangent = DVector::from_vec(vec![10.0, -1.0]);
        assert!(tangent.dot(&direction) > 0.0);
        assert!(tangent.dot(&weights.component_mul(&direction)) < 0.0);
        orient_problem_tangent(&problem, &aug_state, &mut tangent, Some(&direction), true)
            .expect("weighted orientation");
        assert!(tangent.dot(&weights.component_mul(&direction)) > 0.0);
        assert_eq!(tangent, DVector::from_vec(vec![-10.0, 1.0]));
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
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            initial_seed_is_corrected: false,
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
            normalized_mesh: setup.normalized_mesh.clone(),
            collocation_adaptivity: setup.collocation_adaptivity,
            collocation_adaptation: setup.collocation_adaptation.clone(),
            projector_refresh_interval: setup.projector_refresh_interval,
            initial_seed_is_corrected: true,
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
    fn hydrate_setup_from_endpoint_uses_basis_dims_for_ambiguous_3d_riccati_size() {
        let mut setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![
                    vec![9.0, 9.0, 9.0],
                    vec![9.0, 9.0, 9.0],
                    vec![9.0, 9.0, 9.0],
                ],
                stage_states: vec![vec![vec![9.0, 9.0, 9.0]], vec![vec![9.0, 9.0, 9.0]]],
                x0: vec![9.0, 9.0, 9.0],
                param1_value: 0.2,
                param2_value: 0.9,
                time: 9.0,
                eps0: 9.0,
                eps1: 9.0,
                yu: vec![0.0, 0.0],
                ys: vec![0.0, 0.0],
            },
            ntst: 2,
            ncol: 1,
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            initial_seed_is_corrected: false,
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
                stable_q: vec![
                    1.0, 0.0, 0.0, //
                    0.0, 1.0, 0.0, //
                    0.0, 0.0, 1.0,
                ],
                unstable_q: vec![
                    1.0, 0.0, 0.0, //
                    0.0, 1.0, 0.0, //
                    0.0, 0.0, 1.0,
                ],
                dim: 3,
                nneg: 2,
                npos: 1,
            },
        };

        let endpoint_setup = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![
                    vec![0.0, 0.0, 0.0],
                    vec![0.5, 0.0, 0.0],
                    vec![1.0, 0.0, 0.0],
                ],
                stage_states: vec![vec![vec![0.25, 0.0, 0.0]], vec![vec![0.75, 0.0, 0.0]]],
                x0: vec![0.0, 0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 2.0,
                eps0: 0.1,
                eps1: 0.2,
                yu: vec![0.3, 0.31],
                ys: vec![0.4, 0.41],
            },
            ntst: setup.ntst,
            ncol: setup.ncol,
            normalized_mesh: setup.normalized_mesh.clone(),
            collocation_adaptivity: setup.collocation_adaptivity,
            collocation_adaptation: setup.collocation_adaptation.clone(),
            projector_refresh_interval: setup.projector_refresh_interval,
            initial_seed_is_corrected: true,
            param1_index: setup.param1_index,
            param2_index: setup.param2_index,
            param1_name: setup.param1_name.clone(),
            param2_name: setup.param2_name.clone(),
            base_params: setup.base_params.clone(),
            extras: setup.extras,
            basis: setup.basis.clone(),
        };
        let endpoint_state = pack_homoclinic_state(&endpoint_setup);

        let hydrated = hydrate_homoclinic_setup_from_endpoint(&mut setup, &endpoint_state, 3);
        assert!(
            hydrated,
            "expected basis-aware endpoint decode to hydrate setup"
        );
        assert_eq!(setup.guess.mesh_states, endpoint_setup.guess.mesh_states);
        assert_eq!(setup.guess.stage_states, endpoint_setup.guess.stage_states);
        assert_eq!(setup.guess.x0, endpoint_setup.guess.x0);
        assert_eq!(setup.guess.param2_value, endpoint_setup.guess.param2_value);
        assert_eq!(setup.guess.time, endpoint_setup.guess.time);
        assert_eq!(setup.guess.eps0, endpoint_setup.guess.eps0);
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
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            initial_seed_is_corrected: false,
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
            projector_refresh_interval: 1,
        };

        assert!(apply_homoc_context_to_setup(&mut setup, &context));
        assert_eq!(setup.guess.time, 42.0);
        assert_eq!(setup.guess.eps0, 0.03);
        assert_eq!(setup.guess.eps1, 0.04);
        assert_eq!(setup.projector_refresh_interval, 1);
    }

    #[test]
    fn collocation_extension_restores_odd_step_chart_and_transfers_retained_history_and_seed() {
        let mut system = moving_saddle_system();
        let saved_setup = odd_step_saved_collocation_setup(&mut system);
        let context = homoc_context_from_setup(&saved_setup);
        let endpoint_state = pack_homoclinic_state(&saved_setup);

        // This is what endpoint reconstruction computes before the persisted
        // chart is applied: the basis at a=1 differs from the saved a=0 chart.
        let fresh_basis = compute_homoclinic_basis(&mut system, &[0.0, 0.0], &[1.0, 0.0])
            .expect("fresh endpoint basis");
        assert_ne!(fresh_basis.stable_q, saved_setup.basis.stable_q);
        let mut reconstructed = saved_setup.clone();
        reconstructed.basis = fresh_basis;
        reconstructed.base_params = vec![1.0, 0.0];
        reconstructed.guess.time = 99.0;
        reconstructed.guess.yu.fill(0.0);
        reconstructed.guess.ys.fill(0.0);

        assert!(restore_homoclinic_extension_setup(
            &mut reconstructed,
            &context,
            &endpoint_state,
            2,
        ));
        assert_eq!(reconstructed.basis.stable_q, saved_setup.basis.stable_q);
        assert_eq!(reconstructed.guess.yu, saved_setup.guess.yu);
        assert_eq!(reconstructed.guess.ys, saved_setup.guess.ys);
        assert_eq!(pack_homoclinic_state(&reconstructed), endpoint_state);

        let mut history_setup = saved_setup.clone();
        history_setup.guess.mesh_states[0][0] = 0.12;
        history_setup.guess.stage_states[0][0][0] = 0.06;
        history_setup.guess.yu[0] = 0.42;
        history_setup.guess.ys[0] = -0.38;
        let history_state = pack_homoclinic_state(&history_setup);
        let endpoint_aug = augmented(1.0, &endpoint_state);
        let history_aug = augmented(0.9, &history_state);
        let mut tangent = DVector::zeros(endpoint_aug.len());
        tangent[0] = 1.0;
        tangent[endpoint_aug.len() - 2] = 0.2;
        let seeds = vec![
            ReparameterizationSeed {
                aug_state: history_aug.clone(),
                tangent: tangent.clone(),
            },
            ReparameterizationSeed {
                aug_state: endpoint_aug.clone(),
                tangent: tangent.clone(),
            },
        ];

        let mut problem = HomoclinicProblem::new(&mut system, reconstructed)
            .expect("restored collocation extension problem");
        let reparameterized = problem
            .reparameterize_after_step(
                &endpoint_aug,
                &endpoint_aug,
                &tangent,
                &[history_state.clone(), endpoint_state.clone()],
                &seeds,
            )
            .expect("chart refresh")
            .expect("angle-triggered odd-step chart refresh");
        assert_eq!(problem.projector_refresh_count(), 1);

        let transferred_history = problem
            .transfer_branch_states_to_current_discretization(&[
                history_state.clone(),
                endpoint_state.clone(),
            ])
            .expect("transfer retained history");
        assert_eq!(transferred_history, reparameterized.branch_states);
        assert!(
            transferred_history[0]
                .iter()
                .zip(&history_state)
                .any(|(new, old)| (new - old).abs() > 1e-8),
            "retained history must actually move into the refreshed chart"
        );

        let mut persisted_resume = Some(ContinuationResumeState {
            min_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: -4,
                aug_state: history_aug.as_slice().to_vec(),
                tangent: tangent.as_slice().to_vec(),
                step_size: 0.01,
            }),
            max_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: 3,
                aug_state: endpoint_aug.as_slice().to_vec(),
                tangent: tangent.as_slice().to_vec(),
                step_size: 0.02,
            }),
        });
        transfer_external_resume_state(&problem, &mut persisted_resume)
            .expect("transfer both retained endpoint seeds");
        let retained_opposite = persisted_resume
            .expect("resume state")
            .min_index_seed
            .expect("opposite-side seed");
        assert_eq!(retained_opposite.endpoint_index, -4);
        assert_vectors_close(
            &retained_opposite.aug_state,
            reparameterized.active_seeds[0].aug_state.as_slice(),
        );
        assert_vectors_close(
            &retained_opposite.tangent,
            reparameterized.active_seeds[0].tangent.as_slice(),
        );
    }

    #[test]
    fn shooting_extension_restores_odd_step_chart_and_transfers_retained_history_and_seed() {
        let mut system = moving_saddle_system();
        let saved_setup = odd_step_saved_shooting_setup(&mut system);
        let context = homoc_context_from_shooting_setup(&saved_setup);
        let endpoint_state = pack_homoclinic_shooting_state(&saved_setup);

        let fresh_basis = compute_homoclinic_basis(&mut system, &[0.0, 0.0], &[1.0, 0.0])
            .expect("fresh endpoint basis");
        assert_ne!(fresh_basis.stable_q, saved_setup.basis.stable_q);
        let mut reconstructed = saved_setup.clone();
        reconstructed.basis = fresh_basis;
        reconstructed.base_params = vec![1.0, 0.0];
        reconstructed.guess.time = 99.0;
        reconstructed.guess.yu.fill(0.0);
        reconstructed.guess.ys.fill(0.0);

        assert!(restore_homoclinic_shooting_extension_setup(
            &mut reconstructed,
            &context,
            &endpoint_state,
        ));
        assert_eq!(reconstructed.basis.stable_q, saved_setup.basis.stable_q);
        assert_eq!(reconstructed.guess.yu, saved_setup.guess.yu);
        assert_eq!(reconstructed.guess.ys, saved_setup.guess.ys);
        assert_eq!(
            pack_homoclinic_shooting_state(&reconstructed),
            endpoint_state
        );

        let mut history_setup = saved_setup.clone();
        history_setup.guess.nodes[0][0] = 0.12;
        history_setup.guess.yu[0] = 0.42;
        history_setup.guess.ys[0] = -0.38;
        let history_state = pack_homoclinic_shooting_state(&history_setup);
        let endpoint_aug = augmented(1.0, &endpoint_state);
        let history_aug = augmented(0.9, &history_state);
        let mut tangent = DVector::zeros(endpoint_aug.len());
        tangent[0] = 1.0;
        tangent[endpoint_aug.len() - 2] = 0.2;
        let seeds = vec![
            ReparameterizationSeed {
                aug_state: history_aug.clone(),
                tangent: tangent.clone(),
            },
            ReparameterizationSeed {
                aug_state: endpoint_aug.clone(),
                tangent: tangent.clone(),
            },
        ];

        let mut problem = HomoclinicShootingProblem::new(&mut system, reconstructed)
            .expect("restored shooting extension problem");
        let reparameterized = problem
            .reparameterize_after_step(
                &endpoint_aug,
                &endpoint_aug,
                &tangent,
                &[history_state.clone(), endpoint_state.clone()],
                &seeds,
            )
            .expect("chart refresh")
            .expect("angle-triggered odd-step chart refresh");
        assert_eq!(problem.projector_refresh_count(), 1);

        let transferred_history = problem
            .transfer_branch_states_to_current_discretization(&[
                history_state.clone(),
                endpoint_state,
            ])
            .expect("transfer retained shooting history");
        assert_eq!(transferred_history, reparameterized.branch_states);
        assert!(
            transferred_history[0]
                .iter()
                .zip(&history_state)
                .any(|(new, old)| (new - old).abs() > 1e-8),
            "retained shooting history must actually move into the refreshed chart"
        );

        let mut persisted_resume = Some(ContinuationResumeState {
            min_index_seed: Some(ContinuationEndpointSeed {
                endpoint_index: -6,
                aug_state: history_aug.as_slice().to_vec(),
                tangent: tangent.as_slice().to_vec(),
                step_size: 0.01,
            }),
            max_index_seed: None,
        });
        transfer_external_resume_state(&problem, &mut persisted_resume)
            .expect("transfer retained shooting endpoint seed");
        let retained_opposite = persisted_resume
            .expect("resume state")
            .min_index_seed
            .expect("opposite-side seed");
        assert_eq!(retained_opposite.endpoint_index, -6);
        assert_vectors_close(
            &retained_opposite.aug_state,
            reparameterized.active_seeds[0].aug_state.as_slice(),
        );
        assert_vectors_close(
            &retained_opposite.tangent,
            reparameterized.active_seeds[0].tangent.as_slice(),
        );
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
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            initial_seed_is_corrected: true,
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
    fn prepare_resume_seed_uses_the_visible_endpoint_and_orients_tangent() {
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

        assert_eq!(resume_aug, vec![1.0, 2.0, 3.0]);
        assert!(
            (resume_tangent[0] - 0.0).abs() < 1e-12
                && (resume_tangent[1] - 1.0).abs() < 1e-12
                && resume_tangent[2].abs() < 1e-12,
            "expected saved tangent orientation to be preserved, got {:?}",
            resume_tangent
        );
    }

    #[test]
    fn prepare_resume_seed_keeps_local_tangent_alignment_at_the_visible_endpoint() {
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

        assert_eq!(resume_aug, vec![1.0, 2.0, 3.0]);
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
                homoclinic_events: None,
                heteroclinic_events: None,
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
                    aug_state: vec![0.0, 0.0],
                    tangent: vec![1.0, 0.0],
                    step_size: 0.02,
                }),
            }),
            manifold_geometry: None,
        };

        let endpoint_aug = DVector::from_vec(vec![0.0, 0.0]);
        let seed = super::select_resume_seed(&branch, true, 3, &endpoint_aug).expect("seed");
        assert_eq!(seed.step_size, 0.02);
        assert!(super::select_resume_seed(&branch, true, 4, &endpoint_aug).is_none());

        let stale_endpoint = DVector::from_vec(vec![0.2, 0.0]);
        assert!(
            super::select_resume_seed(&branch, true, 3, &stale_endpoint).is_none(),
            "a seed for a hidden unrefined state must not be attached to the visible endpoint"
        );
    }

    #[test]
    fn saved_resume_step_survives_fresh_settings_but_not_a_smaller_local_cap() {
        let seed = ContinuationEndpointSeed {
            endpoint_index: 2,
            aug_state: vec![0.0, 0.0],
            tangent: vec![1.0, 0.0],
            step_size: 0.03,
        };
        let mut settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-4,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        assert!((bounded_resume_step_size(&seed, settings) - 0.03).abs() < 1e-12);
        cap_extension_step_size(&mut settings, Some(0.02));
        assert!((bounded_resume_step_size(&seed, settings) - 0.02).abs() < 1e-12);
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
