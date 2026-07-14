// NOTE: The submodules in continuation/ (equilibrium, periodic, problem)
// contain continuation problem implementations.

#[path = "continuation/problem.rs"]
pub mod problem;

#[path = "continuation/periodic.rs"]
pub mod periodic;

#[path = "continuation/periodic_schur.rs"]
mod periodic_schur;

#[path = "continuation/equilibrium.rs"]
pub mod equilibrium;

#[path = "continuation/types.rs"]
pub mod types;

#[path = "continuation/util.rs"]
pub mod util;

#[path = "continuation/codim1_curves/mod.rs"]
pub mod codim1_curves;

#[path = "continuation/lc_codim1_curves/mod.rs"]
pub mod lc_codim1_curves;

#[path = "continuation/homoclinic.rs"]
pub mod homoclinic;

#[path = "continuation/heteroclinic.rs"]
pub mod heteroclinic;

#[path = "continuation/heteroclinic_events.rs"]
pub mod heteroclinic_events;

#[path = "continuation/homoclinic_events.rs"]
pub mod homoclinic_events;

#[path = "continuation/homoclinic_init.rs"]
pub mod homoclinic_init;

#[path = "continuation/homoclinic_shooting.rs"]
pub mod homoclinic_shooting;

#[path = "continuation/homotopy_saddle.rs"]
pub mod homotopy_saddle;

#[path = "continuation/manifold.rs"]
pub mod manifold;

#[path = "continuation/map_normal_forms.rs"]
pub mod map_normal_forms;

#[path = "continuation/periodic_normal_forms.rs"]
pub mod periodic_normal_forms;

#[path = "continuation/packed_periodic_source.rs"]
pub mod packed_periodic_source;

// Re-export types needed for external use
pub use codim1_curves::{
    bogdanov_takens_curve_seeds, bogdanov_takens_homoclinic_seed, generalized_hopf_lpc_seed,
    hopf_hopf_equilibrium_curve_seeds, hopf_hopf_neimark_sacker_seeds, hopf_hopf_normal_form,
    refine_codim2_points, zero_hopf_equilibrium_curve_seeds, zero_hopf_neimark_sacker_seed,
    zero_hopf_normal_form, Codim2BranchSeed, Codim2BranchTarget, Codim2CurveProblem,
    Codim2TestFunctions, EquilibriumCodim2NormalFormDiagnostics, FoldCurveProblem,
    HomoclinicBranchSeed, HopfCurveProblem, HopfHopfNeimarkSackerPredictor, HopfHopfNormalForm,
    RefinedCodim2Event, ZeroHopfNormalForm,
};
pub use heteroclinic::{
    continue_heteroclinic_curve, decode_heteroclinic_state, extend_heteroclinic_curve,
    heteroclinic_setup_from_orbit, heteroclinic_setup_from_point, pack_heteroclinic_state,
    DecodedHeteroclinicState, HeteroclinicGuess, HeteroclinicOrbitSeed, HeteroclinicProblem,
    HeteroclinicSetupV1, HETEROCLINIC_SCHEMA_VERSION,
};
pub use heteroclinic_events::{
    build_heteroclinic_orbit_flip_data, compute_heteroclinic_event_diagnostics,
    HeteroclinicEndpointFlipData, HeteroclinicEventDiagnostics, HeteroclinicEventKind,
    HeteroclinicEventStatus, HeteroclinicEventValue, HeteroclinicOrbitFlipData,
};
pub use homoclinic::continue_homoclinic_curve;
pub use homoclinic_events::{
    compute_homoclinic_event_diagnostics, HomoclinicEventDiagnostics, HomoclinicEventKind,
    HomoclinicEventStatus, HomoclinicEventValue, HomoclinicOrbitFlipData, OrbitFlipSideData,
};
pub use homoclinic_init::{
    compute_homoclinic_basis, decode_homoclinic_state, homoclinic_setup_from_homoclinic_point,
    homoclinic_setup_from_homoclinic_point_on_mesh,
    homoclinic_setup_from_homoclinic_point_with_source_extras,
    homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh,
    homoclinic_setup_from_homotopy_saddle_point, homoclinic_setup_from_large_cycle,
    homoclinic_setup_from_large_cycle_on_mesh, homotopy_saddle_setup_from_equilibrium,
    pack_homoclinic_state, DecodedHomoclinicState, HomoclinicBasis, HomoclinicExtraFlags,
    HomoclinicFixedScalars, HomoclinicGuess, HomoclinicSetup, HomotopySaddleSetup,
};
pub use homoclinic_shooting::{
    continue_homoclinic_shooting_curve, decode_homoclinic_shooting_state,
    homoclinic_shooting_setup_from_collocation, homoclinic_shooting_setup_from_point,
    pack_homoclinic_shooting_state, DecodedHomoclinicShootingState, HomoclinicShootingGuess,
    HomoclinicShootingProblem, HomoclinicShootingSettings, HomoclinicShootingSetup,
};
pub use homotopy_saddle::{continue_homotopy_saddle_curve, homotopy_stage_d_to_homoclinic};
pub use lc_codim1_curves::{
    IsoperiodicCurveProblem, LPCCurveProblem, NSCurveProblem, PDCurveProblem,
};
pub use manifold::{
    continue_limit_cycle_manifold_2d, continue_limit_cycle_manifold_2d_with_progress,
    continue_limit_cycle_manifolds_2d, continue_manifold_eq_1d, continue_manifold_eq_1d_with_kind,
    continue_manifold_eq_1d_with_kind_and_periodicity, continue_manifold_eq_2d,
    continue_manifold_eq_2d_with_progress, extend_limit_cycle_manifold_2d,
    extend_limit_cycle_manifold_2d_with_progress, extend_manifold_eq_1d_with_kind_and_periodicity,
    extend_manifold_eq_2d, extend_manifold_eq_2d_with_progress,
};
pub use map_normal_forms::{
    map_branch_point_normal_form, map_neimark_sacker_normal_form, map_normal_form,
    map_period_doubling_normal_form, MapBranchPointKind, MapBranchPointNormalForm, MapCriticality,
    MapNeimarkSackerNormalForm, MapNormalForm, MapNormalFormConditioning, MapNormalFormType,
    MapPeriodDoublingNormalForm,
};
pub use packed_periodic_source::limit_cycle_setup_from_packed_state;
pub use periodic::{
    compute_limit_cycle_floquet_modes, compute_limit_cycle_floquet_modes_on_mesh,
    compute_limit_cycle_floquet_modes_on_mesh_with_backend,
    compute_limit_cycle_floquet_modes_with_backend, continue_limit_cycle_collocation,
    continue_limit_cycle_collocation_with_report, correct_limit_cycle_setup_adaptive,
    extend_limit_cycle_collocation, extend_limit_cycle_collocation_with_report,
    gauss_legendre_nodes, limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit,
    limit_cycle_setup_from_pd, limit_cycle_setup_from_pd_on_mesh, uniform_normalized_mesh,
    CollocationAdaptationReport, CollocationAdaptivitySettings, CollocationConfig,
    CollocationDefectEstimate, CollocationDefectTermination, CollocationDefectTerminationError,
    CollocationDefectTerminationReason, CollocationMeshAdaptationKind,
    CollocationRefinementAttempt, FloquetBackend, FloquetModeVectors, LimitCycleContinuationResult,
    LimitCycleGuess, LimitCycleSetup, OrbitTimeMode,
};
pub use periodic_normal_forms::{
    periodic_branch_point_normal_form, periodic_branch_point_normal_form_with_settings,
    periodic_branch_point_switch_setup, periodic_neimark_sacker_normal_form,
    periodic_neimark_sacker_normal_form_for_cosine_with_settings,
    periodic_neimark_sacker_normal_form_with_settings, periodic_orbit_normal_form,
    periodic_period_doubling_normal_form, periodic_period_doubling_normal_form_with_settings,
    periodic_plus_one_bifurcation_type, PeriodicOrbitBranchPointKind,
    PeriodicOrbitBranchPointNormalForm, PeriodicOrbitCriticality,
    PeriodicOrbitNeimarkSackerNormalForm, PeriodicOrbitNormalForm,
    PeriodicOrbitNormalFormConditioning, PeriodicOrbitNormalFormSettings,
    PeriodicOrbitNormalFormType, PeriodicOrbitPeriodDoublingNormalForm,
};
pub use problem::{
    PointDiagnostics, PostCorrectorReparameterization, ReparameterizationSeed, StepRejectionAction,
    TestFunctionValues,
};
pub use types::{
    BifurcationType, BranchType, Codim1CurveBranch, Codim1CurvePoint, Codim1CurveType,
    Codim2Bifurcation, Codim2BifurcationType, Codim2BranchSwitch, Codim2Certification,
    Codim2Coefficient, Codim2Conditioning, Codim2PointData, ContinuationBranch,
    ContinuationEndpointSeed, ContinuationPoint, ContinuationResumeState, ContinuationSettings,
    HeteroclinicConnectionSchemaV1, HomoclinicBasisSnapshot, HomoclinicDiscretization,
    HomoclinicResumeContext, HomotopyStage, Manifold1DSettings, Manifold2DSettings, ManifoldBounds,
    ManifoldCurveGeometry, ManifoldCurveResumeState, ManifoldCycle2DSettings, ManifoldDirection,
    ManifoldEigenKind, ManifoldGeometry, ManifoldHkoFiberResumeState, ManifoldMapDomainCursor,
    ManifoldRingDiagnostic, ManifoldStability, ManifoldSurfaceGeometry, ManifoldSurfaceResumeState,
    ManifoldTerminationCaps, StepResult,
};
pub use util::{
    compute_eigenvalues, compute_nullspace_tangent, continuation_point_to_aug, hopf_pair_count,
    hopf_test_function, neutral_saddle_test_function, real_eigenvalue_count,
};

use crate::equation_engine::EquationSystem;
use crate::equilibrium::{
    compute_map_cycle_points, compute_param_jacobian, compute_system_jacobian,
    evaluate_equilibrium_residual, SystemKind,
};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
pub use problem::ContinuationProblem;

// Generic continuation functions using ContinuationProblem trait

/// Continues from an initial point using pseudo-arclength continuation (PALC).
pub fn continue_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    initial_point: ContinuationPoint,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let mut dim = problem.dimension();

    // Build initial augmented state [p, x...]
    let mut prev_aug = DVector::zeros(dim + 1);
    prev_aug[0] = initial_point.param_value;
    for (i, &val) in initial_point.state.iter().enumerate() {
        if i < dim {
            prev_aug[i + 1] = val;
        }
    }

    // Initialize branch with starting point
    let initial_diag = problem.diagnostics(&prev_aug)?;
    let mut prev_diag = initial_diag.clone();
    let initial_homoclinic_events = if problem.detect_homoclinic_events_from_initial_seed() {
        problem.homoclinic_event_diagnostics(&prev_aug)?
    } else {
        None
    };
    let initial_heteroclinic_events = if problem.detect_heteroclinic_events_from_initial_seed() {
        problem.heteroclinic_event_diagnostics(&prev_aug)?
    } else {
        None
    };
    let mut prev_homoclinic_events = initial_homoclinic_events.clone();
    let mut prev_heteroclinic_events = initial_heteroclinic_events.clone();
    let mut branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: initial_point.state.clone(),
            param_value: initial_point.param_value,
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points.clone(),
            homoclinic_events: initial_homoclinic_events,
            heteroclinic_events: initial_heteroclinic_events,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: None,
    };

    // Compute initial tangent and orient it based on requested parameter direction.
    let mut prev_tangent = compute_tangent_from_problem(problem, &prev_aug)?;
    let forward_sign = if forward { 1.0 } else { -1.0 };

    // A sign flip preserves Jt = 0; changing one component does not. At a fold
    // the parameter component is legitimately zero, so leave it untouched.
    if prev_tangent[0] * forward_sign < 0.0 {
        prev_tangent = -prev_tangent;
    }

    // Set direction
    let direction_sign = 1.0; // Direction is now encoded in the oriented tangent
    let mut step_size = clamp_step_size(settings.step_size, settings);
    let mut current_index: i32 = 0;
    let mut consecutive_failures = 0;
    const MAX_CONSECUTIVE_FAILURES: usize = 20;

    let mut accepted_steps = 0usize;
    while accepted_steps < settings.max_steps {
        // Predictor: predict along tangent
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector: solve using Newton-like iteration
        let corrected_opt = correct_with_problem(
            problem,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            settings.corrector_steps,
            settings.corrector_tolerance,
            settings.step_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }

            if !problem.is_step_acceptable(&corrected_aug)? {
                match handle_rejected_trial(
                    problem,
                    &mut prev_aug,
                    &mut prev_tangent,
                    &mut prev_diag,
                    &mut prev_homoclinic_events,
                    &mut prev_heteroclinic_events,
                    &mut branch,
                    &corrected_aug,
                )? {
                    RejectedTrialDisposition::RetryTransferredStep => {
                        dim = problem.dimension();
                        continue;
                    }
                    RejectedTrialDisposition::Terminate => break,
                    RejectedTrialDisposition::ReduceStep => {
                        consecutive_failures += 1;
                        step_size *= 0.5;
                        if step_size < settings.min_step_size
                            || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                        {
                            break;
                        }
                        continue;
                    }
                }
            }

            let (corrected_aug, _) = apply_post_corrector_reparameterization(
                problem,
                &mut prev_aug,
                &mut prev_tangent,
                &mut prev_diag,
                &mut prev_homoclinic_events,
                &mut prev_heteroclinic_events,
                &mut branch,
                corrected_aug,
                &[],
            )?;

            // Update gauges/reference data before computing the next tangent;
            // the tangent must belong to the Jacobian used on the next step.
            problem.update_after_step(&corrected_aug)?;

            // Compute new tangent
            let new_tangent = compute_tangent_from_problem(problem, &corrected_aug)?;
            if !new_tangent.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }

            // Ensure tangent direction consistency (sign should match prev_tangent)
            let dot_product = palc_dot(problem, &corrected_aug, &new_tangent, &prev_tangent)?;
            let consistent_tangent = if dot_product < 0.0 {
                -new_tangent // Flip sign to maintain direction
            } else {
                new_tangent
            };

            // Reset failure counter on success
            consecutive_failures = 0;

            // Compute diagnostics for the new point
            let diagnostics = problem.diagnostics(&corrected_aug)?;
            let homoclinic_events = problem.homoclinic_event_diagnostics(&corrected_aug)?;
            let heteroclinic_events = problem.heteroclinic_event_diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let detected_type = detect_bifurcation_type(
                &prev_diag,
                &diagnostics,
                prev_homoclinic_events.as_ref(),
                homoclinic_events.as_ref(),
                prev_heteroclinic_events.as_ref(),
                heteroclinic_events.as_ref(),
            );

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if detected_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    problem,
                    &prev_aug,
                    &prev_diag,
                    prev_homoclinic_events.as_ref(),
                    prev_heteroclinic_events.as_ref(),
                    &corrected_aug,
                    &diagnostics,
                    homoclinic_events.as_ref(),
                    heteroclinic_events.as_ref(),
                    detected_type,
                    &prev_tangent,
                    settings.corrector_steps,
                    settings.corrector_tolerance,
                    settings.step_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diagnostics.clone()),
                }
            } else {
                (corrected_aug.clone(), diagnostics.clone())
            };

            let bifurcation_type = if detected_type != BifurcationType::None {
                let classified = problem.classify_bifurcation(&final_aug, detected_type)?;
                promote_verified_homoclinic_bt(&final_diag, classified)
            } else {
                BifurcationType::None
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let output_homoclinic_events = if output_aug == corrected_aug {
                homoclinic_events.clone()
            } else {
                problem.homoclinic_event_diagnostics(&output_aug)?
            };
            let output_heteroclinic_events = if output_aug == corrected_aug {
                heteroclinic_events.clone()
            } else {
                problem.heteroclinic_event_diagnostics(&output_aug)?
            };
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diagnostics.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            // Create new point
            current_index += forward_sign as i32;
            let new_point = ContinuationPoint {
                state: output_aug.rows(1, dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
                homoclinic_events: output_homoclinic_events,
                heteroclinic_events: output_heteroclinic_events,
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }

            branch.points.push(new_point);
            branch.indices.push(current_index);
            accepted_steps += 1;

            // Adaptive step size - increase on success
            step_size = (step_size * 1.2).min(settings.max_step_size);

            prev_aug = continuation_aug;
            prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, consistent_tangent)?;
            prev_diag = continuation_diag;
            prev_homoclinic_events = homoclinic_events;
            prev_heteroclinic_events = heteroclinic_events;
        } else {
            // Failed to converge, reduce step size
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size
                || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                break;
            }
        }
    }

    if let Some(seed) = build_resume_seed(current_index, &prev_aug, &prev_tangent, step_size) {
        let mut resume_state = ContinuationResumeState::default();
        if seed.endpoint_index <= 0 {
            resume_state.min_index_seed = Some(seed.clone());
        }
        if seed.endpoint_index >= 0 {
            resume_state.max_index_seed = Some(seed);
        }
        branch.resume_state = Some(resume_state);
    }

    Ok(branch)
}

// ============================================================================
// Stepping-Based Continuation API (for progress reporting)
// ============================================================================

const MAX_CONSECUTIVE_FAILURES: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SingleStepOutcome {
    Accepted,
    Retry,
    Terminated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RejectedTrialDisposition {
    ReduceStep,
    RetryTransferredStep,
    Terminate,
}

/// Replace persisted packed states after a discretization or coordinate-chart
/// transfer, then refresh any point payloads derived from those states.
///
/// Preparation happens on clones so a failed problem-specific refresh cannot
/// leave a branch with only part of its history converted.
pub fn apply_transferred_branch_states<P: ContinuationProblem>(
    problem: &P,
    points: &mut [ContinuationPoint],
    branch_states: Vec<Vec<f64>>,
) -> Result<()> {
    if branch_states.len() != points.len()
        || branch_states
            .iter()
            .any(|state| state.len() != problem.dimension())
    {
        bail!("Discretization transfer returned incompatible branch-state layouts");
    }

    let mut refreshed = Vec::with_capacity(points.len());
    for (point, state) in points.iter().zip(branch_states) {
        let mut point = point.clone();
        point.state = state;
        problem.refresh_persisted_point_after_state_transfer(&mut point)?;
        refreshed.push(point);
    }
    for (point, refreshed) in points.iter_mut().zip(refreshed) {
        *point = refreshed;
    }
    Ok(())
}

fn handle_rejected_trial<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &mut DVector<f64>,
    prev_tangent: &mut DVector<f64>,
    prev_diag: &mut PointDiagnostics,
    prev_homoclinic_events: &mut Option<HomoclinicEventDiagnostics>,
    prev_heteroclinic_events: &mut Option<HeteroclinicEventDiagnostics>,
    branch: &mut ContinuationBranch,
    rejected_aug: &DVector<f64>,
) -> Result<RejectedTrialDisposition> {
    let branch_states = branch
        .points
        .iter()
        .map(|point| point.state.clone())
        .collect::<Vec<_>>();
    match problem.handle_step_rejection(prev_aug, prev_tangent, rejected_aug, &branch_states)? {
        StepRejectionAction::ReduceStep => Ok(RejectedTrialDisposition::ReduceStep),
        StepRejectionAction::Terminate => Ok(RejectedTrialDisposition::Terminate),
        StepRejectionAction::Refined {
            accepted_aug,
            accepted_tangent,
            branch_states,
            branch_type,
        } => {
            let expected_aug_len = problem.dimension() + 1;
            if accepted_aug.len() != expected_aug_len || accepted_tangent.len() != expected_aug_len
            {
                bail!(
                    "Discretization refinement returned dimension {}, expected {}",
                    accepted_aug.len(),
                    expected_aug_len
                );
            }
            apply_transferred_branch_states(problem, &mut branch.points, branch_states)?;
            if let Some(branch_type) = branch_type {
                branch.branch_type = branch_type;
            }
            // Saved endpoint vectors belong to the old state dimension.  The
            // finalizer will rebuild the active frontier seed after adaptation.
            branch.resume_state = None;
            *prev_aug = accepted_aug;
            let transferred_tangent =
                normalize_tangent_or_compute(problem, prev_aug, accepted_tangent)?;
            problem.update_after_step(prev_aug)?;
            let mut refined_tangent = compute_tangent_from_problem(problem, prev_aug)?;
            if palc_dot(problem, prev_aug, &refined_tangent, &transferred_tangent)? < 0.0 {
                refined_tangent = -refined_tangent;
            }
            *prev_tangent = refined_tangent;
            *prev_diag = problem.diagnostics(prev_aug)?;
            if prev_homoclinic_events.is_some()
                || problem.detect_homoclinic_events_from_initial_seed()
            {
                *prev_homoclinic_events = problem.homoclinic_event_diagnostics(prev_aug)?;
            }
            if prev_heteroclinic_events.is_some()
                || problem.detect_heteroclinic_events_from_initial_seed()
            {
                *prev_heteroclinic_events = problem.heteroclinic_event_diagnostics(prev_aug)?;
            }
            Ok(RejectedTrialDisposition::RetryTransferredStep)
        }
    }
}

fn apply_post_corrector_reparameterization<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &mut DVector<f64>,
    prev_tangent: &mut DVector<f64>,
    prev_diag: &mut PointDiagnostics,
    prev_homoclinic_events: &mut Option<HomoclinicEventDiagnostics>,
    prev_heteroclinic_events: &mut Option<HeteroclinicEventDiagnostics>,
    branch: &mut ContinuationBranch,
    corrected_aug: DVector<f64>,
    active_seeds: &[ReparameterizationSeed],
) -> Result<(DVector<f64>, Vec<ReparameterizationSeed>)> {
    let active_seed_count = active_seeds.len();
    let mut carried_seeds = active_seeds.to_vec();
    let mut carried_min_resume = false;
    let mut carried_max_resume = false;
    if let Some(resume) = branch.resume_state.as_ref() {
        if let Some(seed) = resume.min_index_seed.as_ref() {
            carried_seeds.push(ReparameterizationSeed {
                aug_state: DVector::from_vec(seed.aug_state.clone()),
                tangent: DVector::from_vec(seed.tangent.clone()),
            });
            carried_min_resume = true;
        }
        if let Some(seed) = resume.max_index_seed.as_ref() {
            carried_seeds.push(ReparameterizationSeed {
                aug_state: DVector::from_vec(seed.aug_state.clone()),
                tangent: DVector::from_vec(seed.tangent.clone()),
            });
            carried_max_resume = true;
        }
    }
    let branch_states = branch
        .points
        .iter()
        .map(|point| point.state.clone())
        .collect::<Vec<_>>();
    let Some(change) = problem.reparameterize_after_step(
        prev_aug,
        &corrected_aug,
        prev_tangent,
        &branch_states,
        &carried_seeds,
    )?
    else {
        return Ok((corrected_aug, active_seeds.to_vec()));
    };

    let expected_aug_len = problem.dimension() + 1;
    if change.previous_aug.len() != expected_aug_len
        || change.corrected_aug.len() != expected_aug_len
        || change.previous_tangent.len() != expected_aug_len
    {
        bail!("Post-corrector reparameterization returned an incompatible frontier layout");
    }
    if change.branch_states.len() != branch.points.len()
        || change
            .branch_states
            .iter()
            .any(|state| state.len() != problem.dimension())
    {
        bail!("Post-corrector reparameterization returned incompatible branch-state layouts");
    }
    if change.active_seeds.len() != carried_seeds.len()
        || change.active_seeds.iter().any(|seed| {
            seed.aug_state.len() != expected_aug_len || seed.tangent.len() != expected_aug_len
        })
    {
        bail!("Post-corrector reparameterization returned incompatible endpoint seeds");
    }

    apply_transferred_branch_states(problem, &mut branch.points, change.branch_states)?;
    *prev_aug = change.previous_aug;
    *prev_tangent = normalize_tangent_or_compute(problem, prev_aug, change.previous_tangent)?;

    let mut seed_iter = change.active_seeds.into_iter();
    let transformed_active = seed_iter
        .by_ref()
        .take(active_seed_count)
        .collect::<Vec<_>>();
    if let Some(resume) = branch.resume_state.as_mut() {
        if carried_min_resume {
            let transformed = seed_iter
                .next()
                .ok_or_else(|| anyhow!("Missing transformed minimum resume seed"))?;
            if let Some(seed) = resume.min_index_seed.as_mut() {
                seed.aug_state = transformed.aug_state.iter().copied().collect();
                seed.tangent = transformed.tangent.iter().copied().collect();
            }
        }
        if carried_max_resume {
            let transformed = seed_iter
                .next()
                .ok_or_else(|| anyhow!("Missing transformed maximum resume seed"))?;
            if let Some(seed) = resume.max_index_seed.as_mut() {
                seed.aug_state = transformed.aug_state.iter().copied().collect();
                seed.tangent = transformed.tangent.iter().copied().collect();
            }
        }
    }

    // The problem chart has changed. Recompute the previous endpoint's
    // diagnostics in that chart before any sign-change test or bisection.
    *prev_diag = problem.diagnostics(prev_aug)?;
    if prev_homoclinic_events.is_some() || problem.detect_homoclinic_events_from_initial_seed() {
        *prev_homoclinic_events = problem.homoclinic_event_diagnostics(prev_aug)?;
    }
    if prev_heteroclinic_events.is_some() || problem.detect_heteroclinic_events_from_initial_seed()
    {
        *prev_heteroclinic_events = problem.heteroclinic_event_diagnostics(prev_aug)?;
    }
    Ok((change.corrected_aug, transformed_active))
}

fn clamp_step_size(step_size: f64, settings: ContinuationSettings) -> f64 {
    let mut clamped = if step_size.is_finite() && step_size > 0.0 {
        step_size
    } else {
        settings.step_size
    };
    clamped = clamped.max(settings.min_step_size);
    clamped = clamped.min(settings.max_step_size);
    clamped
}

fn normalize_tangent_or_compute<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    mut tangent: DVector<f64>,
) -> Result<DVector<f64>> {
    if tangent.iter().any(|value| !value.is_finite()) {
        bail!("Cannot normalize a tangent containing non-finite values");
    }
    if tangent.norm_squared() < 1e-24 {
        tangent = compute_tangent_from_problem(problem, prev_aug)?;
    }
    normalize_palc_tangent(problem, prev_aug, tangent)
}

fn validated_palc_weights<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
) -> Result<DVector<f64>> {
    let weights = problem.palc_metric_weights(aug_state)?;
    let expected_len = problem.dimension() + 1;
    if weights.len() != expected_len {
        bail!(
            "PALC metric has {} weights, expected {}",
            weights.len(),
            expected_len
        );
    }
    if weights
        .iter()
        .any(|weight| !weight.is_finite() || *weight <= 0.0)
    {
        bail!("PALC metric weights must be finite and strictly positive");
    }
    Ok(weights)
}

/// Weighted inner product used by pseudo-arclength continuation.
pub fn palc_dot<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
    lhs: &DVector<f64>,
    rhs: &DVector<f64>,
) -> Result<f64> {
    let weights = validated_palc_weights(problem, aug_state)?;
    if lhs.len() != weights.len() || rhs.len() != weights.len() {
        bail!("PALC inner-product vector dimension mismatch");
    }
    Ok(lhs.dot(&weights.component_mul(rhs)))
}

/// Norm induced by a continuation problem's pseudo-arclength metric.
pub fn palc_norm<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
    vector: &DVector<f64>,
) -> Result<f64> {
    let norm_squared = palc_dot(problem, aug_state, vector, vector)?;
    if !norm_squared.is_finite() || norm_squared < 0.0 {
        bail!("PALC metric produced an invalid squared norm");
    }
    Ok(norm_squared.sqrt())
}

fn normalize_palc_tangent<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
    tangent: DVector<f64>,
) -> Result<DVector<f64>> {
    let norm = palc_norm(problem, aug_state, &tangent)?;
    if norm <= 1e-12 {
        bail!("Failed to normalize a zero PALC tangent");
    }
    Ok(tangent / norm)
}

fn build_resume_seed(
    endpoint_index: i32,
    aug_state: &DVector<f64>,
    tangent: &DVector<f64>,
    step_size: f64,
) -> Option<ContinuationEndpointSeed> {
    if !step_size.is_finite() || step_size <= 0.0 {
        return None;
    }
    if aug_state.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if tangent.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if tangent.norm() <= 1e-12 {
        return None;
    }
    let tangent_norm = tangent / tangent.norm();
    Some(ContinuationEndpointSeed {
        endpoint_index,
        aug_state: aug_state.iter().cloned().collect(),
        tangent: tangent_norm.iter().cloned().collect(),
        step_size,
    })
}

/// A runner that holds continuation state and allows stepped execution for progress reporting.
///
/// Use this when you need to report progress during continuation:
/// ```ignore
/// let mut runner = ContinuationRunner::new(problem, initial_point, settings, forward)?;
/// while !runner.is_done() {
///     runner.run_steps(5)?;
///     println!("Progress: {}/{}", runner.current_step(), runner.max_steps());
/// }
/// let branch = runner.take_result();
/// ```
pub struct ContinuationRunner<P: ContinuationProblem> {
    problem: P,
    prev_aug: DVector<f64>,
    prev_tangent: DVector<f64>,
    initial_aug: DVector<f64>,
    initial_tangent: DVector<f64>,
    initial_step_size: f64,
    prev_diag: PointDiagnostics,
    prev_homoclinic_events: Option<HomoclinicEventDiagnostics>,
    prev_heteroclinic_events: Option<HeteroclinicEventDiagnostics>,
    step_size: f64,
    current_index: i32,
    index_step: i32,
    consecutive_failures: usize,
    current_step: usize,
    max_steps: usize,
    settings: ContinuationSettings,
    branch: ContinuationBranch,
    done: bool,
    dim: usize,
}

impl<P: ContinuationProblem> ContinuationRunner<P> {
    fn init_branch_from_aug(
        problem: &mut P,
        prev_aug: &DVector<f64>,
        dim: usize,
    ) -> Result<(
        PointDiagnostics,
        Option<HomoclinicEventDiagnostics>,
        Option<HeteroclinicEventDiagnostics>,
        ContinuationBranch,
    )> {
        let initial_diag = problem.diagnostics(prev_aug)?;
        let initial_homoclinic_events = if problem.detect_homoclinic_events_from_initial_seed() {
            problem.homoclinic_event_diagnostics(prev_aug)?
        } else {
            None
        };
        let initial_heteroclinic_events = if problem.detect_heteroclinic_events_from_initial_seed()
        {
            problem.heteroclinic_event_diagnostics(prev_aug)?
        } else {
            None
        };
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: prev_aug.rows(1, dim).iter().cloned().collect(),
                param_value: prev_aug[0],
                stability: BifurcationType::None,
                eigenvalues: initial_diag.eigenvalues.clone(),
                cycle_points: initial_diag.cycle_points.clone(),
                homoclinic_events: initial_homoclinic_events.clone(),
                heteroclinic_events: initial_heteroclinic_events.clone(),
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        Ok((
            initial_diag,
            initial_homoclinic_events,
            initial_heteroclinic_events,
            branch,
        ))
    }

    /// Create a new continuation runner initialized from a starting point.
    pub fn new(
        mut problem: P,
        initial_point: ContinuationPoint,
        settings: ContinuationSettings,
        forward: bool,
    ) -> Result<Self> {
        let dim = problem.dimension();

        // Build initial augmented state [p, x...]
        let mut prev_aug = DVector::zeros(dim + 1);
        prev_aug[0] = initial_point.param_value;
        for (i, &val) in initial_point.state.iter().enumerate() {
            if i < dim {
                prev_aug[i + 1] = val;
            }
        }

        let (prev_diag, prev_homoclinic_events, prev_heteroclinic_events, branch) =
            Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;

        // Compute initial tangent and orient it based on requested parameter direction.
        let mut prev_tangent = compute_tangent_from_problem(&mut problem, &prev_aug)?;
        let forward_sign = if forward { 1.0 } else { -1.0 };

        if prev_tangent[0] * forward_sign < 0.0 {
            prev_tangent = -prev_tangent;
        }

        let index_step = if forward { 1 } else { -1 };

        let step_size = clamp_step_size(settings.step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            prev_homoclinic_events,
            prev_heteroclinic_events,
            step_size,
            current_index: 0,
            index_step,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Create a new continuation runner with a user-specified initial tangent.
    ///
    /// This is intended for branch extension where the tangent is derived from
    /// the existing branch or a secant direction.
    pub fn new_with_tangent(
        mut problem: P,
        initial_point: ContinuationPoint,
        initial_tangent: DVector<f64>,
        settings: ContinuationSettings,
    ) -> Result<Self> {
        let dim = problem.dimension();

        // Build initial augmented state [p, x...]
        let mut prev_aug = DVector::zeros(dim + 1);
        prev_aug[0] = initial_point.param_value;
        for (i, &val) in initial_point.state.iter().enumerate() {
            if i < dim {
                prev_aug[i + 1] = val;
            }
        }

        let (prev_diag, prev_homoclinic_events, prev_heteroclinic_events, branch) =
            Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;
        let prev_tangent = normalize_tangent_or_compute(&mut problem, &prev_aug, initial_tangent)?;

        let step_size = clamp_step_size(settings.step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            prev_homoclinic_events,
            prev_heteroclinic_events,
            step_size,
            current_index: 0,
            index_step: 1,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Create a continuation runner from a saved endpoint seed.
    ///
    /// This resumes from the accepted augmented state/tangent/step size
    /// captured at an endpoint of a previous run.
    pub fn new_from_seed(
        mut problem: P,
        aug_state: Vec<f64>,
        tangent: Vec<f64>,
        seed_step_size: f64,
        settings: ContinuationSettings,
    ) -> Result<Self> {
        let dim = problem.dimension();
        if aug_state.len() != dim + 1 {
            bail!(
                "Resume seed dimension mismatch: expected {} values, got {}",
                dim + 1,
                aug_state.len()
            );
        }
        if tangent.len() != dim + 1 {
            bail!(
                "Resume seed tangent dimension mismatch: expected {} values, got {}",
                dim + 1,
                tangent.len()
            );
        }

        let prev_aug = DVector::from_vec(aug_state);
        let seed_tangent = DVector::from_vec(tangent);
        let prev_tangent = normalize_tangent_or_compute(&mut problem, &prev_aug, seed_tangent)?;
        let (prev_diag, prev_homoclinic_events, prev_heteroclinic_events, branch) =
            Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;

        let step_size = clamp_step_size(seed_step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            prev_homoclinic_events,
            prev_heteroclinic_events,
            step_size,
            current_index: 0,
            index_step: 1,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Run a batch of continuation steps, returning progress information.
    pub fn run_steps(&mut self, batch_size: usize) -> Result<StepResult> {
        if self.done {
            return Ok(self.step_result());
        }

        let mut accepted_in_batch = 0usize;
        while accepted_in_batch < batch_size {
            if self.current_step >= self.max_steps {
                self.done = true;
                break;
            }

            match self.single_step()? {
                SingleStepOutcome::Accepted => {
                    self.current_step += 1;
                    accepted_in_batch += 1;
                }
                SingleStepOutcome::Retry => {}
                SingleStepOutcome::Terminated => {
                    self.done = true;
                    break;
                }
            }
        }

        if self.current_step >= self.max_steps {
            self.done = true;
        }

        Ok(self.step_result())
    }

    /// Borrow the active problem for read-only solver-specific progress data.
    pub fn problem(&self) -> &P {
        &self.problem
    }

    /// Execute one continuation attempt. Rejected trials request a retry and
    /// do not consume the accepted-step progress budget.
    fn single_step(&mut self) -> Result<SingleStepOutcome> {
        // Predictor: predict along tangent
        let direction_sign = 1.0;
        let pred_aug = &self.prev_aug + &self.prev_tangent * (self.step_size * direction_sign);

        // Corrector: solve using Newton-like iteration
        let corrected_opt = correct_with_problem(
            &mut self.problem,
            &pred_aug,
            &self.prev_aug,
            &self.prev_tangent,
            self.settings.corrector_steps,
            self.settings.corrector_tolerance,
            self.settings.step_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                self.consecutive_failures += 1;
                self.step_size *= 0.5;
                if self.step_size < self.settings.min_step_size
                    || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    return Ok(SingleStepOutcome::Terminated);
                }
                return Ok(SingleStepOutcome::Retry);
            }
            if !self.problem.is_step_acceptable(&corrected_aug)? {
                match handle_rejected_trial(
                    &mut self.problem,
                    &mut self.prev_aug,
                    &mut self.prev_tangent,
                    &mut self.prev_diag,
                    &mut self.prev_homoclinic_events,
                    &mut self.prev_heteroclinic_events,
                    &mut self.branch,
                    &corrected_aug,
                )? {
                    RejectedTrialDisposition::RetryTransferredStep => {
                        self.dim = self.problem.dimension();
                        if self.initial_aug.len() != self.dim + 1 {
                            self.initial_aug = self.prev_aug.clone();
                            self.initial_tangent = self.prev_tangent.clone();
                        }
                        return Ok(SingleStepOutcome::Retry);
                    }
                    RejectedTrialDisposition::Terminate => {
                        return Ok(SingleStepOutcome::Terminated);
                    }
                    RejectedTrialDisposition::ReduceStep => {
                        self.consecutive_failures += 1;
                        self.step_size *= 0.5;
                        if self.step_size < self.settings.min_step_size
                            || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                        {
                            return Ok(SingleStepOutcome::Terminated);
                        }
                        return Ok(SingleStepOutcome::Retry);
                    }
                }
            }

            let active_seeds = [ReparameterizationSeed {
                aug_state: self.initial_aug.clone(),
                tangent: self.initial_tangent.clone(),
            }];
            let (corrected_aug, transformed_seeds) = apply_post_corrector_reparameterization(
                &mut self.problem,
                &mut self.prev_aug,
                &mut self.prev_tangent,
                &mut self.prev_diag,
                &mut self.prev_homoclinic_events,
                &mut self.prev_heteroclinic_events,
                &mut self.branch,
                corrected_aug,
                &active_seeds,
            )?;
            if let Some(seed) = transformed_seeds.into_iter().next() {
                self.initial_aug = seed.aug_state;
                self.initial_tangent = seed.tangent;
            }
            // Update gauges/reference data before computing the next tangent;
            // the tangent must belong to the Jacobian used on the next step.
            self.problem.update_after_step(&corrected_aug)?;

            // Compute new tangent
            let new_tangent = compute_tangent_from_problem(&mut self.problem, &corrected_aug)?;
            if !new_tangent.iter().all(|v| v.is_finite()) {
                self.consecutive_failures += 1;
                self.step_size *= 0.5;
                if self.step_size < self.settings.min_step_size
                    || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    return Ok(SingleStepOutcome::Terminated);
                }
                return Ok(SingleStepOutcome::Retry);
            }

            // Ensure tangent direction consistency
            let dot_product = palc_dot(
                &self.problem,
                &corrected_aug,
                &new_tangent,
                &self.prev_tangent,
            )?;
            let consistent_tangent = if dot_product < 0.0 {
                -new_tangent
            } else {
                new_tangent
            };

            // Reset failure counter on success
            self.consecutive_failures = 0;

            // Compute diagnostics for the new point
            let diagnostics = self.problem.diagnostics(&corrected_aug)?;
            let homoclinic_events = self.problem.homoclinic_event_diagnostics(&corrected_aug)?;
            let heteroclinic_events = self
                .problem
                .heteroclinic_event_diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let detected_type = detect_bifurcation_type(
                &self.prev_diag,
                &diagnostics,
                self.prev_homoclinic_events.as_ref(),
                homoclinic_events.as_ref(),
                self.prev_heteroclinic_events.as_ref(),
                heteroclinic_events.as_ref(),
            );

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if detected_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    &mut self.problem,
                    &self.prev_aug,
                    &self.prev_diag,
                    self.prev_homoclinic_events.as_ref(),
                    self.prev_heteroclinic_events.as_ref(),
                    &corrected_aug,
                    &diagnostics,
                    homoclinic_events.as_ref(),
                    heteroclinic_events.as_ref(),
                    detected_type,
                    &self.prev_tangent,
                    self.settings.corrector_steps,
                    self.settings.corrector_tolerance,
                    self.settings.step_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diagnostics.clone()),
                }
            } else {
                (corrected_aug.clone(), diagnostics.clone())
            };

            let bifurcation_type = if detected_type != BifurcationType::None {
                let classified = self
                    .problem
                    .classify_bifurcation(&final_aug, detected_type)?;
                promote_verified_homoclinic_bt(&final_diag, classified)
            } else {
                BifurcationType::None
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let output_homoclinic_events = if output_aug == corrected_aug {
                homoclinic_events.clone()
            } else {
                self.problem.homoclinic_event_diagnostics(&output_aug)?
            };
            let output_heteroclinic_events = if output_aug == corrected_aug {
                heteroclinic_events.clone()
            } else {
                self.problem.heteroclinic_event_diagnostics(&output_aug)?
            };
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diagnostics.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            self.current_index += self.index_step;

            let new_point = ContinuationPoint {
                state: output_aug.rows(1, self.dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
                homoclinic_events: output_homoclinic_events,
                heteroclinic_events: output_heteroclinic_events,
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                self.branch.bifurcations.push(self.branch.points.len());
            }

            self.branch.points.push(new_point);
            self.branch.indices.push(self.current_index);

            // Adaptive step size - increase on success
            self.step_size = (self.step_size * 1.2).min(self.settings.max_step_size);

            self.prev_aug = continuation_aug;
            self.prev_tangent = normalize_tangent_or_compute(
                &mut self.problem,
                &self.prev_aug,
                consistent_tangent,
            )?;
            self.prev_diag = continuation_diag;
            self.prev_homoclinic_events = homoclinic_events;
            self.prev_heteroclinic_events = heteroclinic_events;
            return Ok(SingleStepOutcome::Accepted);
        } else {
            // Failed to converge, reduce step size
            self.consecutive_failures += 1;
            self.step_size *= 0.5;
            if self.step_size < self.settings.min_step_size
                || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                return Ok(SingleStepOutcome::Terminated);
            }
        }

        Ok(SingleStepOutcome::Retry)
    }

    /// Check if continuation is complete.
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Get current step number.
    pub fn current_step(&self) -> usize {
        self.current_step
    }

    /// Get max steps.
    pub fn max_steps(&self) -> usize {
        self.max_steps
    }

    /// Get step result for progress reporting.
    pub fn step_result(&self) -> StepResult {
        StepResult::new(
            self.done,
            self.current_step,
            self.max_steps,
            self.branch.points.len(),
            self.branch.bifurcations.len(),
            self.prev_aug[0],
        )
    }

    fn finalize_resume_state(&mut self) {
        let mut resume_state = self.branch.resume_state.take().unwrap_or_default();

        // Prefer boundary secants from accepted points for endpoint seeds.
        // The initial predictor tangent can be stale after early correction and
        // can produce nonlocal extension starts, especially for homoclinic
        // branches when extending from the minimum-index side.
        let start_seed = build_resume_seed_from_branch_endpoint(
            &self.branch,
            0,
            -self.index_step,
            self.initial_step_size,
        )
        .or_else(|| {
            build_resume_seed(
                0,
                &self.initial_aug,
                &self.initial_tangent,
                self.initial_step_size,
            )
        });
        if let Some(seed) = start_seed {
            assign_seed_to_resume_state(&mut resume_state, seed);
        }

        let current_seed = build_resume_seed(
            self.current_index,
            &self.prev_aug,
            &self.prev_tangent,
            self.step_size,
        )
        .or_else(|| {
            build_resume_seed_from_branch_endpoint(
                &self.branch,
                self.current_index,
                self.index_step,
                self.step_size,
            )
        });

        if let Some(seed) = current_seed {
            assign_seed_to_resume_state(&mut resume_state, seed);
        }

        if resume_state.min_index_seed.is_some() || resume_state.max_index_seed.is_some() {
            self.branch.resume_state = Some(resume_state);
        }
    }

    /// Take the final branch result, consuming the runner.
    pub fn take_result(mut self) -> ContinuationBranch {
        self.finalize_resume_state();
        self.branch
    }

    /// Take the branch together with its continuation problem.
    ///
    /// Codimension-two post-processing uses the same continuously oriented
    /// border vectors that generated the curve instead of reconstructing a
    /// fresh problem from serialized points.
    pub fn take_result_with_problem(mut self) -> (ContinuationBranch, P) {
        self.finalize_resume_state();
        (self.branch, self.problem)
    }

    pub fn settings(&self) -> ContinuationSettings {
        self.settings
    }

    /// Get a reference to the branch.
    pub fn branch(&self) -> &ContinuationBranch {
        &self.branch
    }

    /// Set the branch type (used for limit cycle continuation).
    pub fn set_branch_type(&mut self, branch_type: BranchType) {
        self.branch.branch_type = branch_type;
    }

    /// Set the upoldp field (used for limit cycle continuation).
    pub fn set_upoldp(&mut self, upoldp: Option<Vec<Vec<f64>>>) {
        self.branch.upoldp = upoldp;
    }

    /// Set homoclinic extension context metadata.
    pub fn set_homoc_context(&mut self, homoc_context: Option<HomoclinicResumeContext>) {
        self.branch.homoc_context = homoc_context;
    }

    /// Set extension resume metadata.
    pub fn set_resume_state(&mut self, resume_state: Option<ContinuationResumeState>) {
        self.branch.resume_state = resume_state;
    }
}

fn assign_seed_to_resume_state(
    resume_state: &mut ContinuationResumeState,
    seed: ContinuationEndpointSeed,
) {
    if seed.endpoint_index <= 0 {
        resume_state.min_index_seed = Some(seed.clone());
    }
    if seed.endpoint_index >= 0 {
        resume_state.max_index_seed = Some(seed);
    }
}

fn build_resume_seed_from_branch_endpoint(
    branch: &ContinuationBranch,
    endpoint_index: i32,
    index_step: i32,
    step_size: f64,
) -> Option<ContinuationEndpointSeed> {
    if !step_size.is_finite() || step_size <= 0.0 {
        return None;
    }
    let endpoint_pos = branch
        .indices
        .iter()
        .position(|&idx| idx == endpoint_index)?;
    let endpoint = branch.points.get(endpoint_pos)?;
    if endpoint.state.iter().any(|v| !v.is_finite()) || !endpoint.param_value.is_finite() {
        return None;
    }

    let mut aug_state = Vec::with_capacity(endpoint.state.len() + 1);
    aug_state.push(endpoint.param_value);
    aug_state.extend(endpoint.state.iter().copied());

    let neighbor_index = endpoint_index - index_step;
    let tangent = if let Some(neighbor_pos) = branch
        .indices
        .iter()
        .position(|&idx| idx == neighbor_index)
        .and_then(|pos| branch.points.get(pos).map(|pt| (pos, pt)))
    {
        let (_, neighbor) = neighbor_pos;
        if neighbor.state.len() == endpoint.state.len()
            && neighbor.state.iter().all(|v| v.is_finite())
            && neighbor.param_value.is_finite()
        {
            let mut secant = DVector::zeros(aug_state.len());
            secant[0] = endpoint.param_value - neighbor.param_value;
            for i in 0..endpoint.state.len() {
                secant[i + 1] = endpoint.state[i] - neighbor.state[i];
            }
            if secant.norm() > 1e-12 {
                secant.normalize().iter().copied().collect::<Vec<f64>>()
            } else {
                return None;
            }
        } else {
            return None;
        }
    } else {
        return None;
    };

    Some(ContinuationEndpointSeed {
        endpoint_index,
        aug_state,
        tangent,
        step_size,
    })
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

/// Orient a continuation tangent without changing its direction.
///
/// A tangent may only be multiplied by `-1`: changing an individual
/// component would generally move it out of the extended Jacobian nullspace.
pub fn orient_problem_tangent<P: ContinuationProblem>(
    problem: &P,
    aug_state: &DVector<f64>,
    tangent: &mut DVector<f64>,
    secant: Option<&DVector<f64>>,
    forward: bool,
) -> Result<()> {
    if let Some(secant) = secant {
        if palc_dot(problem, aug_state, tangent, secant)? < 0.0 {
            *tangent = -tangent.clone();
        }
    } else {
        let forward_sign = if forward { 1.0 } else { -1.0 };
        if tangent[0] * forward_sign < 0.0 {
            *tangent = -tangent.clone();
        }
    }
    Ok(())
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
    if seed.step_size <= 0.0 || !seed.step_size.is_finite() {
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
    let tangent_norm = DVector::from_vec(seed.tangent.clone()).norm();
    tangent_norm > 1e-12
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

/// Extends an existing branch using pseudo-arclength continuation.
/// Uses a secant predictor from the last two points to determine the continuation direction.
pub fn extend_branch_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    mut branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    if branch.points.is_empty() {
        bail!("Cannot extend empty branch");
    }

    if branch.indices.len() != branch.points.len() {
        branch.indices = (0..branch.points.len() as i32).collect();
    }

    // Get the endpoint to continue from based on forward/backward
    // forward=true means append to the end (max index), forward=false means prepend (min index)
    let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
        let max_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .max_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        // Find the previous point (second highest index)
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
            .unwrap()
            .0;
        // Find the next point (second lowest index)
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

    let endpoint = &branch.points[endpoint_idx];

    // Build augmented state for endpoint
    let dim = problem.dimension();
    let mut end_aug = DVector::zeros(dim + 1);
    if endpoint.state.len() != dim {
        anyhow::bail!(
            "Dimension mismatch: branch point state has length {}, problem expects {}",
            endpoint.state.len(),
            dim
        );
    }
    end_aug[0] = endpoint.param_value;
    for (i, &v) in endpoint.state.iter().enumerate() {
        end_aug[i + 1] = v;
    }

    // Compute secant direction from neighbor to endpoint if we have two points.
    // Secant from interior neighbor to selected endpoint preserves outward continuation
    // on the requested signed-index side.
    let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &branch.points[neighbor_pos];
        let mut neighbor_aug = DVector::zeros(dim + 1);
        neighbor_aug[0] = neighbor.param_value;
        for (i, &v) in neighbor.state.iter().enumerate() {
            neighbor_aug[i + 1] = v;
        }

        let secant = &end_aug - &neighbor_aug;
        let norm = palc_norm(problem, &end_aug, &secant)?;
        if norm > 1e-12 {
            (Some(secant / norm), Some(norm))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let mut settings = settings;
    cap_extension_step_size(&mut settings, secant_norm);
    let resume_seed = select_resume_seed(&branch, forward, last_index, &end_aug);

    let extension = if let Some(seed) = resume_seed {
        let mut resume_settings = settings;
        resume_settings.step_size =
            clamp_step_size(seed.step_size.min(settings.step_size), settings);
        let initial_point = ContinuationPoint {
            state: endpoint.state.clone(),
            param_value: endpoint.param_value,
            stability: endpoint.stability,
            eigenvalues: endpoint.eigenvalues.clone(),
            cycle_points: endpoint.cycle_points.clone(),
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        continue_with_initial_tangent(
            problem,
            initial_point,
            DVector::from_vec(seed.tangent),
            resume_settings,
        )?
    } else {
        // With at least two points, secant provides a robust outward direction.
        let mut tangent = if let Some(secant) = secant_direction.as_ref() {
            secant.clone()
        } else {
            compute_tangent_from_problem(problem, &end_aug)?
        };

        orient_problem_tangent(
            problem,
            &end_aug,
            &mut tangent,
            secant_direction.as_ref(),
            forward,
        )?;

        // Now run continuation with the correctly oriented tangent
        let initial_point = ContinuationPoint {
            state: endpoint.state.clone(),
            param_value: endpoint.param_value,
            stability: endpoint.stability,
            eigenvalues: endpoint.eigenvalues.clone(),
            cycle_points: endpoint.cycle_points.clone(),
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        continue_with_initial_tangent(problem, initial_point, tangent.clone(), settings)?
    };

    let external_states = branch
        .points
        .iter()
        .map(|point| point.state.clone())
        .collect::<Vec<_>>();
    let transferred = problem.transfer_branch_states_to_current_discretization(&external_states)?;
    if transferred.len() != branch.points.len()
        || transferred
            .iter()
            .any(|state| state.len() != problem.dimension())
    {
        bail!("Continuation transfer lost or corrupted external branch points during extension");
    }
    apply_transferred_branch_states(problem, &mut branch.points, transferred)?;

    if let Some(resume) = branch.resume_state.as_mut() {
        let mut seeds = Vec::new();
        let has_min = resume.min_index_seed.is_some();
        let has_max = resume.max_index_seed.is_some();
        if let Some(seed) = resume.min_index_seed.as_ref() {
            seeds.push(ReparameterizationSeed {
                aug_state: DVector::from_vec(seed.aug_state.clone()),
                tangent: DVector::from_vec(seed.tangent.clone()),
            });
        }
        if let Some(seed) = resume.max_index_seed.as_ref() {
            seeds.push(ReparameterizationSeed {
                aug_state: DVector::from_vec(seed.aug_state.clone()),
                tangent: DVector::from_vec(seed.tangent.clone()),
            });
        }
        let mut transferred_seeds = problem
            .transfer_endpoint_seeds_to_current_coordinates(&seeds)?
            .into_iter();
        if has_min {
            let transformed = transferred_seeds
                .next()
                .ok_or_else(|| anyhow!("Continuation transfer lost the minimum endpoint seed"))?;
            if let Some(seed) = resume.min_index_seed.as_mut() {
                seed.aug_state = transformed.aug_state.iter().copied().collect();
                seed.tangent = transformed.tangent.iter().copied().collect();
            }
        }
        if has_max {
            let transformed = transferred_seeds
                .next()
                .ok_or_else(|| anyhow!("Continuation transfer lost the maximum endpoint seed"))?;
            if let Some(seed) = resume.max_index_seed.as_mut() {
                seed.aug_state = transformed.aug_state.iter().copied().collect();
                seed.tangent = transformed.tangent.iter().copied().collect();
            }
        }
    }

    if extension.branch_type != BranchType::Equilibrium {
        branch.branch_type = extension.branch_type.clone();
    }

    // Merge extension into main branch (skip first point as it's the endpoint)
    let index_offset = last_index;
    let sign = if is_append { 1 } else { -1 };
    let orig_count = branch.points.len();
    for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
        branch.points.push(pt);
        let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
        branch.indices.push(index_offset + idx * sign);
    }

    // Merge bifurcation indices (adjusting for new positions in merged branch)
    // extension.bifurcations contains indices into extension.points (before skip)
    // After merging, extension point i maps to branch.points[orig_count + i - 1] (skipping first)
    for ext_bif_idx in extension.bifurcations {
        if ext_bif_idx > 0 {
            // Map to new position: orig_count + (ext_bif_idx - 1)
            branch.bifurcations.push(orig_count + ext_bif_idx - 1);
        }
        // ext_bif_idx == 0 is the overlap point which already exists in branch, skip it
    }

    if let Some(ext_resume) = extension.resume_state {
        let mut merged_resume = branch.resume_state.take().unwrap_or_default();
        if let Some(seed) = ext_resume.max_index_seed {
            let mapped_index = index_offset + seed.endpoint_index * sign;
            let mapped_seed = ContinuationEndpointSeed {
                endpoint_index: mapped_index,
                aug_state: seed.aug_state,
                tangent: seed.tangent,
                step_size: seed.step_size,
            };
            if sign > 0 {
                merged_resume.max_index_seed = Some(mapped_seed);
            } else {
                merged_resume.min_index_seed = Some(mapped_seed);
            }
        }
        if let Some(seed) = ext_resume.min_index_seed {
            let mapped_index = index_offset + seed.endpoint_index * sign;
            let mapped_seed = ContinuationEndpointSeed {
                endpoint_index: mapped_index,
                aug_state: seed.aug_state,
                tangent: seed.tangent,
                step_size: seed.step_size,
            };
            if sign > 0 {
                merged_resume.max_index_seed = Some(mapped_seed);
            } else {
                merged_resume.min_index_seed = Some(mapped_seed);
            }
        }
        branch.resume_state = Some(merged_resume);
    }

    Ok(branch)
}

/// Continues from an initial point with a given initial tangent direction.
pub fn continue_with_initial_tangent<P: ContinuationProblem>(
    problem: &mut P,
    initial_point: ContinuationPoint,
    initial_tangent: DVector<f64>,
    settings: ContinuationSettings,
) -> Result<ContinuationBranch> {
    let mut dim = problem.dimension();

    // Build initial augmented state
    let mut prev_aug = DVector::zeros(dim + 1);
    prev_aug[0] = initial_point.param_value;
    for (i, &v) in initial_point.state.iter().enumerate() {
        prev_aug[i + 1] = v;
    }

    let initial_diag = problem.diagnostics(&prev_aug)?;
    let mut prev_diag = initial_diag.clone();
    let initial_homoclinic_events = if problem.detect_homoclinic_events_from_initial_seed() {
        problem.homoclinic_event_diagnostics(&prev_aug)?
    } else {
        None
    };
    let initial_heteroclinic_events = if problem.detect_heteroclinic_events_from_initial_seed() {
        problem.heteroclinic_event_diagnostics(&prev_aug)?
    } else {
        None
    };
    let mut prev_homoclinic_events = initial_homoclinic_events.clone();
    let mut prev_heteroclinic_events = initial_heteroclinic_events.clone();
    let mut branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: initial_point.state.clone(),
            param_value: initial_point.param_value,
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points.clone(),
            homoclinic_events: initial_homoclinic_events,
            heteroclinic_events: initial_heteroclinic_events,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: None,
    };

    // Use provided tangent (already oriented correctly)
    let mut prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, initial_tangent)?;

    let mut step_size = clamp_step_size(settings.step_size, settings);
    let mut current_index: i32 = 0;
    let mut consecutive_failures = 0;
    const MAX_CONSECUTIVE_FAILURES: usize = 20;

    let mut accepted_steps = 0usize;
    while accepted_steps < settings.max_steps {
        // Predictor: always step in positive tangent direction (tangent is already oriented)
        let pred_aug = &prev_aug + &prev_tangent * step_size;

        // Corrector
        let corrected_opt = correct_with_problem(
            problem,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            settings.corrector_steps,
            settings.corrector_tolerance,
            settings.step_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }
            if !problem.is_step_acceptable(&corrected_aug)? {
                match handle_rejected_trial(
                    problem,
                    &mut prev_aug,
                    &mut prev_tangent,
                    &mut prev_diag,
                    &mut prev_homoclinic_events,
                    &mut prev_heteroclinic_events,
                    &mut branch,
                    &corrected_aug,
                )? {
                    RejectedTrialDisposition::RetryTransferredStep => {
                        dim = problem.dimension();
                        continue;
                    }
                    RejectedTrialDisposition::Terminate => break,
                    RejectedTrialDisposition::ReduceStep => {
                        consecutive_failures += 1;
                        step_size *= 0.5;
                        if step_size < settings.min_step_size
                            || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                        {
                            break;
                        }
                        continue;
                    }
                }
            }
            consecutive_failures = 0;

            let (corrected_aug, _) = apply_post_corrector_reparameterization(
                problem,
                &mut prev_aug,
                &mut prev_tangent,
                &mut prev_diag,
                &mut prev_homoclinic_events,
                &mut prev_heteroclinic_events,
                &mut branch,
                corrected_aug,
                &[],
            )?;

            // Update gauges/reference data before computing the next tangent;
            // the tangent must belong to the Jacobian used on the next step.
            problem.update_after_step(&corrected_aug)?;

            // Compute new tangent and orient it to match previous direction
            let mut new_tangent = compute_tangent_from_problem(problem, &corrected_aug)?;
            if palc_dot(problem, &corrected_aug, &new_tangent, &prev_tangent)? < 0.0 {
                new_tangent = -new_tangent;
            }

            // Compute diagnostics
            let diag = problem.diagnostics(&corrected_aug)?;
            let homoclinic_events = problem.homoclinic_event_diagnostics(&corrected_aug)?;
            let heteroclinic_events = problem.heteroclinic_event_diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let detected_type = detect_bifurcation_type(
                &prev_diag,
                &diag,
                prev_homoclinic_events.as_ref(),
                homoclinic_events.as_ref(),
                prev_heteroclinic_events.as_ref(),
                heteroclinic_events.as_ref(),
            );

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if detected_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    problem,
                    &prev_aug,
                    &prev_diag,
                    prev_homoclinic_events.as_ref(),
                    prev_heteroclinic_events.as_ref(),
                    &corrected_aug,
                    &diag,
                    homoclinic_events.as_ref(),
                    heteroclinic_events.as_ref(),
                    detected_type,
                    &prev_tangent,
                    settings.corrector_steps,
                    settings.corrector_tolerance,
                    settings.step_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diag.clone()),
                }
            } else {
                (corrected_aug.clone(), diag.clone())
            };

            let bifurcation_type = if detected_type != BifurcationType::None {
                let classified = problem.classify_bifurcation(&final_aug, detected_type)?;
                promote_verified_homoclinic_bt(&final_diag, classified)
            } else {
                BifurcationType::None
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let output_homoclinic_events = if output_aug == corrected_aug {
                homoclinic_events.clone()
            } else {
                problem.homoclinic_event_diagnostics(&output_aug)?
            };
            let output_heteroclinic_events = if output_aug == corrected_aug {
                heteroclinic_events.clone()
            } else {
                problem.heteroclinic_event_diagnostics(&output_aug)?
            };
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diag.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            // Create new point with potentially refined state
            let new_pt = ContinuationPoint {
                state: output_aug.rows(1, dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
                homoclinic_events: output_homoclinic_events,
                heteroclinic_events: output_heteroclinic_events,
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }

            branch.points.push(new_pt);
            branch.indices.push(current_index + 1);
            current_index += 1;
            accepted_steps += 1;

            prev_aug = continuation_aug;
            prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, new_tangent)?;
            prev_diag = continuation_diag;
            prev_homoclinic_events = homoclinic_events;
            prev_heteroclinic_events = heteroclinic_events;

            // Adaptive step size
            step_size = (step_size * 1.2).min(settings.max_step_size);
        } else {
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size
                || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                break;
            }
        }
    }

    if let Some(seed) = build_resume_seed(current_index, &prev_aug, &prev_tangent, step_size) {
        let mut resume_state = ContinuationResumeState::default();
        if seed.endpoint_index <= 0 {
            resume_state.min_index_seed = Some(seed.clone());
        }
        if seed.endpoint_index >= 0 {
            resume_state.max_index_seed = Some(seed);
        }
        branch.resume_state = Some(resume_state);
    }

    Ok(branch)
}

/// Refines a bifurcation point using bisection.
fn refine_bifurcation_bisection<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    prev_diag: &problem::PointDiagnostics,
    prev_homoclinic: Option<&HomoclinicEventDiagnostics>,
    prev_heteroclinic: Option<&HeteroclinicEventDiagnostics>,
    new_aug: &DVector<f64>,
    new_diag: &problem::PointDiagnostics,
    new_homoclinic: Option<&HomoclinicEventDiagnostics>,
    new_heteroclinic: Option<&HeteroclinicEventDiagnostics>,
    bif_type: BifurcationType,
    tangent: &DVector<f64>,
    corrector_steps: usize,
    residual_tolerance: f64,
    step_tolerance: f64,
) -> Result<(DVector<f64>, problem::PointDiagnostics)> {
    const MAX_BISECTION_ITERS: usize = 10;
    const TEST_TOLERANCE: f64 = 1e-6;

    let mut lo_aug = prev_aug.clone();
    let mut hi_aug = new_aug.clone();
    let mut lo_diag = prev_diag.clone();
    let mut hi_diag = new_diag.clone();
    let localization = homoclinic_localization_bracket(prev_diag, new_diag, bif_type);
    let mut lo_position = 0.0;
    let mut hi_position = 1.0;
    let mut lo_test = homoclinic_aware_bifurcation_test_value(
        prev_diag,
        prev_homoclinic,
        prev_heteroclinic,
        bif_type,
        localization,
        lo_position,
    )
    .ok_or_else(|| anyhow!("Previous bifurcation test value is unavailable"))?;
    let mut hi_test = homoclinic_aware_bifurcation_test_value(
        new_diag,
        new_homoclinic,
        new_heteroclinic,
        bif_type,
        localization,
        hi_position,
    )
    .ok_or_else(|| anyhow!("Current bifurcation test value is unavailable"))?;

    if lo_test.abs() < TEST_TOLERANCE {
        return Ok((lo_aug, lo_diag));
    }
    if hi_test.abs() < TEST_TOLERANCE {
        return Ok((hi_aug, hi_diag));
    }
    if lo_test * hi_test >= 0.0 {
        bail!("Bifurcation refinement requires a finite sign-changing bracket");
    }

    // Ensure lo_test < 0, hi_test > 0 for consistent bisection
    if lo_test > hi_test {
        std::mem::swap(&mut lo_aug, &mut hi_aug);
        std::mem::swap(&mut lo_diag, &mut hi_diag);
        std::mem::swap(&mut lo_test, &mut hi_test);
        std::mem::swap(&mut lo_position, &mut hi_position);
    }

    let (mut best_aug, mut best_diag, mut best_abs) = if lo_test.abs() < hi_test.abs() {
        (lo_aug.clone(), lo_diag.clone(), lo_test.abs())
    } else {
        (hi_aug.clone(), hi_diag.clone(), hi_test.abs())
    };

    for _ in 0..MAX_BISECTION_ITERS {
        // Linear interpolation to estimate zero crossing
        let denom = hi_test - lo_test;
        let s = if denom.abs() > 1e-12 {
            (-lo_test / denom).clamp(0.1, 0.9) // Avoid extreme ends
        } else {
            0.5
        };
        let mid_position = lo_position + (hi_position - lo_position) * s;

        let mid_aug = &lo_aug + (&hi_aug - &lo_aug) * s;

        // Correct back to solution manifold
        let corrected = correct_with_problem(
            problem,
            &mid_aug,
            &lo_aug,
            tangent,
            corrector_steps,
            residual_tolerance,
            step_tolerance,
        )?;

        let corrected_aug = match corrected {
            Some(aug) => aug,
            None => {
                // Correction failed, try midpoint without correction
                mid_aug
            }
        };

        // Compute diagnostics at corrected point
        let diag = problem.diagnostics(&corrected_aug)?;
        let homoclinic = problem.homoclinic_event_diagnostics(&corrected_aug)?;
        let heteroclinic = problem.heteroclinic_event_diagnostics(&corrected_aug)?;
        let mid_test = homoclinic_aware_bifurcation_test_value(
            &diag,
            homoclinic.as_ref(),
            heteroclinic.as_ref(),
            bif_type,
            localization,
            mid_position,
        )
        .ok_or_else(|| anyhow!("Bifurcation test value became unavailable during refinement"))?;

        // Check convergence
        if mid_test.abs() < TEST_TOLERANCE {
            return Ok((corrected_aug, diag));
        }

        // Update bracket
        if mid_test < 0.0 {
            lo_aug = corrected_aug.clone();
            lo_test = mid_test;
            lo_position = mid_position;
        } else {
            hi_aug = corrected_aug.clone();
            hi_test = mid_test;
            hi_position = mid_position;
        }

        // Track best (closest to zero)
        if mid_test.abs() < best_abs {
            best_aug = corrected_aug;
            best_diag = diag;
            best_abs = mid_test.abs();
        }
    }

    // Return best found even if not fully converged
    Ok((best_aug, best_diag))
}

/// Computes the tangent vector using the Jacobian null space.
pub fn compute_tangent_from_problem<P: ContinuationProblem>(
    problem: &mut P,
    aug_state: &DVector<f64>,
) -> Result<DVector<f64>> {
    let dim = problem.dimension();
    let jac = problem.extended_jacobian(aug_state)?;

    // Validate Jacobian dimensions
    if jac.nrows() != dim || jac.ncols() != dim + 1 {
        bail!(
            "Jacobian has unexpected dimensions: {}x{}, expected {}x{}",
            jac.nrows(),
            jac.ncols(),
            dim,
            dim + 1
        );
    }

    if jac.iter().any(|value| !value.is_finite()) {
        bail!("Cannot compute tangent from a non-finite extended Jacobian");
    }

    // A bordered solve is much more accurate than forming J'J for regular
    // problems. Try the parameter, final-state, and first-state borders; if a
    // formulation has an additional gauge null direction, fall back to an
    // explicitly computed null vector rather than fabricating a parameter basis.
    let jacobian_scale = jac.norm().max(1.0);
    let mut tangent = None;
    for border_index in [0, dim, 1] {
        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        bordered.view_mut((0, 0), (dim, dim + 1)).copy_from(&jac);
        bordered[(dim, border_index.min(dim))] = 1.0;
        let mut rhs = DVector::zeros(dim + 1);
        rhs[dim] = 1.0;
        if let Some(candidate) = bordered.lu().solve(&rhs) {
            if candidate.iter().all(|value| value.is_finite()) && candidate.norm_squared() > 1e-24 {
                let relative_residual =
                    (&jac * &candidate).norm() / (jacobian_scale * candidate.norm().max(1.0));
                if relative_residual <= 1e-10 {
                    tangent = Some(candidate);
                    break;
                }
            }
        }
    }
    let tangent = match tangent {
        Some(tangent) => tangent,
        None => {
            // Only pay for the SVD on the exceptional path. It distinguishes
            // a genuine computed null vector from the old silent parameter-axis
            // fallback when no bordered system can be solved.
            let singular_values = jac.clone().svd(false, false).singular_values;
            let largest = singular_values.iter().copied().fold(0.0_f64, f64::max);
            let rank_tolerance = 64.0 * f64::EPSILON * (dim + 1) as f64 * largest.max(1.0);
            let numerical_rank = singular_values
                .iter()
                .filter(|value| value.is_finite() && **value > rank_tolerance)
                .count();
            if numerical_rank == 0 {
                bail!(
                    "Cannot compute PALC tangent: extended Jacobian is rank deficient (numerical rank zero)"
                );
            }
            preferred_nullspace_tangent(&jac, numerical_rank)?
        }
    };
    let tangent = normalize_palc_tangent(problem, aug_state, tangent)?;

    let null_residual = &jac * &tangent;
    let residual_tolerance = 1e-9 * jacobian_scale * tangent.norm().max(1.0);
    if !null_residual.norm().is_finite() || null_residual.norm() > residual_tolerance {
        bail!(
            "Computed PALC tangent does not satisfy Jt = 0 (residual {:.3e}, tolerance {:.3e})",
            null_residual.norm(),
            residual_tolerance
        );
    }

    Ok(tangent)
}

/// Select a genuine Jacobian-null direction when the solution set has more
/// than one numerical tangent at a singular branch seed.
///
/// Projecting coordinate directions into the complete nullspace gives a
/// deterministic branch choice while preserving `Jt = 0`; unlike the former
/// parameter-axis fallback, it never fabricates a non-tangent component.
fn preferred_nullspace_tangent(jac: &DMatrix<f64>, numerical_rank: usize) -> Result<DVector<f64>> {
    let column_count = jac.ncols();
    let nullity = column_count.saturating_sub(numerical_rank);
    if nullity == 0 {
        bail!("Cannot compute PALC tangent: extended Jacobian has no numerical nullspace");
    }

    let gram = jac.transpose() * jac;
    if gram.iter().any(|value| !value.is_finite()) {
        bail!("Cannot compute PALC tangent from a non-finite Gram matrix");
    }
    let eig = nalgebra::linalg::SymmetricEigen::new(gram);
    let mut eigen_indices = (0..column_count).collect::<Vec<_>>();
    eigen_indices.sort_by(|left, right| eig.eigenvalues[*left].total_cmp(&eig.eigenvalues[*right]));
    let null_indices = &eigen_indices[..nullity.min(eigen_indices.len())];

    let mut preferred_indices = vec![0, column_count - 1];
    if column_count > 1 {
        preferred_indices.push(1);
    }
    preferred_indices.sort_unstable();
    preferred_indices.dedup();
    // Retain the semantic preference order: parameter, final state/period,
    // then first state component.
    preferred_indices.sort_by_key(|index| {
        if *index == 0 {
            0
        } else if *index == column_count - 1 {
            1
        } else {
            2
        }
    });

    for preferred in preferred_indices {
        let mut candidate = DVector::zeros(column_count);
        for &eigen_index in null_indices {
            let basis = eig.eigenvectors.column(eigen_index);
            candidate += basis * basis[preferred];
        }
        if candidate.norm_squared() > 1e-24 && candidate.iter().all(|value| value.is_finite()) {
            return Ok(candidate);
        }
    }

    let fallback_index = *null_indices
        .first()
        .ok_or_else(|| anyhow!("Cannot compute PALC tangent: empty numerical nullspace basis"))?;
    Ok(eig.eigenvectors.column(fallback_index).into_owned())
}

/// Corrects a predicted point using a pseudo-arclength correction.
///
/// This uses a bordered pseudo-arclength corrector: solve the bordered system
/// `[J; (Wv)'] delta = [-F; 0]`, which keeps the correction perpendicular
/// to the tangent in the problem's PALC metric. Both state and parameter are corrected.
fn correct_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    prediction: &DVector<f64>,
    prev_aug: &DVector<f64>,
    prev_tangent: &DVector<f64>,
    max_iters: usize,
    residual_tolerance: f64,
    step_tolerance: f64,
) -> Result<Option<DVector<f64>>> {
    let dim = problem.dimension();
    let mut current = prediction.clone();

    if !residual_tolerance.is_finite() || residual_tolerance <= 0.0 {
        bail!("Corrector residual tolerance must be finite and strictly positive");
    }
    if !step_tolerance.is_finite() || step_tolerance <= 0.0 {
        bail!("Corrector step tolerance must be finite and strictly positive");
    }

    let residual_norm = |residual: &DVector<f64>| {
        if residual.is_empty() {
            0.0
        } else {
            residual.norm() / (residual.len() as f64).sqrt()
        }
    };

    for _iter in 0..max_iters {
        // Compute residual F(x)
        let mut residual = DVector::zeros(dim);
        problem.residual(&current, &mut residual)?;

        let res_norm = residual_norm(&residual);

        // Check convergence: F(x) should be small.
        if res_norm <= residual_tolerance {
            return Ok(Some(current));
        }
        if !res_norm.is_finite() {
            return Ok(None);
        }

        // Get the extended Jacobian [dF/dp | dF/dx], dim x (dim+1)
        let jac = problem.extended_jacobian(&current)?;

        // Build bordered Jacobian: [J; v'] is (dim+1) x (dim+1)
        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        for i in 0..dim {
            for j in 0..(dim + 1) {
                bordered[(i, j)] = jac[(i, j)];
            }
        }
        let weights = validated_palc_weights(problem, prev_aug)?;
        for j in 0..(dim + 1) {
            bordered[(dim, j)] = weights[j] * prev_tangent[j];
        }

        // Build extended RHS: [-F; 0] to keep Newton corrections orthogonal
        // to the continuation tangent row (Moore-Penrose style corrector).
        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -residual[i];
        }
        rhs[dim] = 0.0;

        // Solve bordered system
        let lu = bordered.lu();
        if let Some(delta) = lu.solve(&rhs) {
            let delta_norm = palc_norm(problem, &current, &delta)?;

            if !delta_norm.is_finite() {
                return Ok(None);
            }

            // Damping for large steps
            let damping = if delta_norm > 1.0 {
                0.5 / delta_norm
            } else {
                1.0
            };

            // Update ALL components including parameter (clone delta for later use)
            let applied_delta = damping * &delta;
            let applied_delta_norm = palc_norm(problem, &current, &applied_delta)?;
            current += &applied_delta;

            if applied_delta_norm <= step_tolerance {
                let mut updated_residual = DVector::zeros(dim);
                problem.residual(&current, &mut updated_residual)?;
                let updated_norm = residual_norm(&updated_residual);
                return Ok((updated_norm <= residual_tolerance).then_some(current));
            }
        } else {
            return Ok(None);
        }
    }

    // Final convergence check
    let mut final_res = DVector::zeros(dim);
    problem.residual(&current, &mut final_res)?;
    let final_norm = residual_norm(&final_res);

    if final_norm <= residual_tolerance {
        Ok(Some(current))
    } else {
        Ok(None)
    }
}

// Types (ContinuationSettings, BifurcationType, ContinuationPoint, BranchType, ContinuationBranch)
// are now in the types module and re-exported above.

pub fn extend_branch(
    system: &mut EquationSystem,
    kind: SystemKind,
    branch: ContinuationBranch,
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    equilibrium::extend_branch(system, kind, branch, param_index, settings, forward)
}

#[allow(dead_code)]
fn extend_branch_legacy(
    system: &mut EquationSystem,
    kind: SystemKind,
    mut branch: ContinuationBranch,
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = system.equations.len();
    if branch.points.is_empty() {
        bail!("Cannot extend empty branch");
    }

    if branch.indices.len() != branch.points.len() {
        branch.indices = (0..branch.points.len() as i32).collect();
    }

    let (endpoint_idx, last_index, is_append) = if forward {
        let max_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .max_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        (max_idx_pos, branch.indices[max_idx_pos], true)
    } else {
        let min_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        (min_idx_pos, branch.indices[min_idx_pos], false)
    };
    let mut prev_point = branch.points[endpoint_idx].clone();

    // Find the neighbor point for secant computation
    let neighbor_idx = if forward {
        // Find second highest index
        if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_idx)
                .max_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        }
    } else {
        // Find second lowest index
        if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_idx)
                .min_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        }
    };

    let start_param = system.params[param_index];

    let mut prev_aug = continuation_point_to_aug(&prev_point);
    let mut prev_tangent = tangent_for_point(system, kind, param_index, &prev_point)?;

    // Compute secant from neighbor to endpoint and orient tangent accordingly
    if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &branch.points[neighbor_pos];
        let neighbor_aug = continuation_point_to_aug(neighbor);

        // Secant from interior neighbor to selected endpoint.
        // This preserves outward continuation on the requested signed-index side.
        let secant = &prev_aug - &neighbor_aug;

        if secant.norm() > 1e-12 {
            prev_tangent = secant.normalize();
            orient_extension_tangent(&mut prev_tangent, Some(&secant), forward);
        }
    } else {
        orient_extension_tangent(&mut prev_tangent, None, forward);
    }

    let mut prev_diag = diagnostics_from_point(system, kind, param_index, &prev_point)?;

    let mut step_size = settings.step_size;
    // Direction is now encoded in the tangent, always step forward
    let direction_sign = 1.0;

    let mut new_points_data: Vec<(ContinuationPoint, i32)> = Vec::new();

    let mut current_index = last_index;

    for _step in 0..settings.max_steps {
        // Predictor: step in tangent direction (tangent is already oriented correctly)
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector (PALC only)
        let corrected_opt = solve_palc(
            system,
            kind,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            param_index,
            settings,
        )?;

        if let Some((corrected_aug, new_tangent)) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite())
                || !new_tangent.iter().all(|v| v.is_finite())
            {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }

            // Converged
            system.params[param_index] = corrected_aug[0];
            let mut diagnostics =
                compute_point_diagnostics(system, kind, &corrected_aug, param_index)?;

            if !diagnostics.test_values.is_finite() {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }

            let mut new_pt = ContinuationPoint {
                state: corrected_aug.rows(1, dim).iter().cloned().collect(),
                param_value: corrected_aug[0],
                stability: BifurcationType::None,
                eigenvalues: diagnostics.eigenvalues.clone(),
                cycle_points: diagnostics.cycle_points.clone(),
                homoclinic_events: None,
                heteroclinic_events: None,
            };

            let prev_tests = prev_diag.test_values;
            let fold_crossed =
                scalar_test_crossed_or_reached(prev_tests.fold, diagnostics.test_values.fold);
            let branch_point_crossed = scalar_test_crossed_or_reached(
                prev_tests.branch_point,
                diagnostics.test_values.branch_point,
            );
            let period_doubling_crossed = scalar_test_crossed_or_reached(
                prev_tests.period_doubling,
                diagnostics.test_values.period_doubling,
            );
            let neimark_sacker_crossed =
                neimark_sacker_crossed_with_complex_pairs(&prev_diag, &diagnostics);
            let hopf_crossed = hopf_crossed_with_complex_pairs(&prev_diag, &diagnostics);
            let neutral_crossed = neutral_saddle_crossed_with_real_pairs(&prev_diag, &diagnostics);

            let mut current_tangent = new_tangent.clone();

            if branch_point_crossed {
                new_pt.stability = BifurcationType::BranchPoint;
            } else if fold_crossed {
                match refine_fold_point(
                    system,
                    kind,
                    param_index,
                    settings,
                    &prev_point,
                    &prev_tests,
                    &new_pt,
                    &diagnostics.test_values,
                    &prev_tangent,
                ) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        new_pt.stability = BifurcationType::Fold;
                    }
                }
                new_pt.stability = BifurcationType::Fold;
            } else if period_doubling_crossed {
                new_pt.stability = BifurcationType::PeriodDoubling;
            } else if neimark_sacker_crossed {
                new_pt.stability = BifurcationType::NeimarkSacker;
            } else if hopf_crossed && !neutral_crossed {
                match refine_hopf_point(
                    system,
                    kind,
                    param_index,
                    settings,
                    &prev_point,
                    &prev_tests,
                    &new_pt,
                    &diagnostics.test_values,
                    &prev_tangent,
                ) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        new_pt.stability = BifurcationType::Hopf;
                    }
                }
                new_pt.stability = BifurcationType::Hopf;
            } else if hopf_crossed && neutral_crossed {
                // Detected Hopf and neutral saddle simultaneously; suppress Hopf.
            }

            current_index += if is_append { 1 } else { -1 };
            prev_aug = continuation_point_to_aug(&new_pt);
            prev_tangent = current_tangent.clone();
            prev_diag = diagnostics;
            prev_point = new_pt.clone();
            new_points_data.push((new_pt, current_index));
        } else {
            step_size *= 0.5;
            if step_size < settings.min_step_size {
                break;
            }
            continue;
        }
    }

    system.params[param_index] = start_param;

    if is_append {
        for (pt, idx) in new_points_data {
            if pt.stability != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }
            branch.points.push(pt);
            branch.indices.push(idx);
        }
    } else {
        let shift = new_points_data.len();
        for bif_idx in &mut branch.bifurcations {
            *bif_idx += shift;
        }

        for (pt, idx) in new_points_data.into_iter().rev() {
            branch.points.insert(0, pt);
            branch.indices.insert(0, idx);
        }

        branch.bifurcations.clear();
        for i in 1..branch.points.len() {
            if branch.points[i].stability != BifurcationType::None {
                branch.bifurcations.push(i);
            }
        }
    }

    Ok(branch)
}

pub fn continue_parameter(
    system: &mut EquationSystem,
    kind: SystemKind,
    initial_state: &[f64],
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = system.equations.len();
    if initial_state.len() != dim {
        bail!("Initial state dimension mismatch");
    }

    let start_param = system.params[param_index];

    let mut current_aug = DVector::zeros(dim + 1);
    current_aug[0] = start_param;
    for i in 0..dim {
        current_aug[i + 1] = initial_state[i];
    }

    let initial_diag = compute_point_diagnostics(system, kind, &current_aug, param_index)?;

    let branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: current_aug.rows(1, dim).iter().cloned().collect(),
            param_value: current_aug[0],
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points,
            homoclinic_events: None,
            heteroclinic_events: None,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::Equilibrium,
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: None,
    };

    extend_branch(system, kind, branch, param_index, settings, forward)
}

fn tangent_for_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    point: &ContinuationPoint,
) -> Result<DVector<f64>> {
    let aug = continuation_point_to_aug(point);
    let j_ext = compute_extended_jacobian(system, kind, &aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent[0] < 0.0 {
        tangent = -tangent;
    }
    Ok(tangent)
}

fn diagnostics_from_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    point: &ContinuationPoint,
) -> Result<PointDiagnostics> {
    let aug = continuation_point_to_aug(point);
    compute_point_diagnostics(system, kind, &aug, param_index)
}

// Tangent computation functions (compute_nullspace_tangent, try_gram_eigen,
// compute_tangent_linear_solve) and continuation_point_to_aug are now in util module.

fn refine_fold_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = system.equations.len();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_fold_newton(
        system,
        kind,
        &prev_aug,
        prev_tests.fold,
        &new_aug,
        new_tests.fold,
        param_index,
        settings,
    )?;

    let start_param = system.params[param_index];
    system.params[param_index] = refined_aug[0];
    let diagnostics = compute_point_diagnostics(system, kind, &refined_aug, param_index)?;
    let j_ext = compute_extended_jacobian(system, kind, &refined_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }
    system.params[param_index] = start_param;

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Fold,
        eigenvalues: diagnostics.eigenvalues.clone(),
        cycle_points: diagnostics.cycle_points.clone(),
        homoclinic_events: None,
        heteroclinic_events: None,
    };

    Ok((point, diagnostics, tangent))
}

fn refine_hopf_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = system.equations.len();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_hopf_newton(
        system,
        kind,
        &prev_aug,
        prev_tests.hopf,
        &new_aug,
        new_tests.hopf,
        param_index,
        settings,
    )?;

    let start_param = system.params[param_index];
    system.params[param_index] = refined_aug[0];
    let diagnostics = compute_point_diagnostics(system, kind, &refined_aug, param_index)?;
    let j_ext = compute_extended_jacobian(system, kind, &refined_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }
    system.params[param_index] = start_param;

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Hopf,
        eigenvalues: diagnostics.eigenvalues.clone(),
        cycle_points: diagnostics.cycle_points.clone(),
        homoclinic_events: None,
        heteroclinic_events: None,
    };

    Ok((point, diagnostics, tangent))
}

fn solve_fold_newton(
    system: &mut EquationSystem,
    kind: SystemKind,
    prev_aug: &DVector<f64>,
    prev_fold: f64,
    new_aug: &DVector<f64>,
    new_fold: f64,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut current = prev_aug.clone();
    let denom = prev_fold - new_fold;
    if denom.abs() > 1e-12 {
        let mut s = prev_fold / denom;
        if !s.is_finite() {
            s = 0.5;
        }
        s = s.clamp(0.0, 1.0);
        current = prev_aug + (new_aug - prev_aug) * s;
    }

    let start_param = system.params[param_index];

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current, param_index)?;
        let current_param = current[0];
        let current_state: Vec<f64> = current.rows(1, dim).iter().cloned().collect();

        let old_param = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_param;

        let diag = compute_point_diagnostics(system, kind, &current, param_index)?;
        let test_val = diag.test_values.fold;
        let f_norm = DVector::from_vec(f_val.clone()).norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }

        let grad = compute_test_gradient(system, kind, &current, param_index, &|vals| vals.fold)?;

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = grad[i];
        }

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -test_val;

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Fold refinement linear solve failed"))?;
        current += &delta;

        if delta.norm() < settings.step_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }
    }

    system.params[param_index] = start_param;
    Err(anyhow!("Fold refinement did not converge"))
}

fn solve_hopf_newton(
    system: &mut EquationSystem,
    kind: SystemKind,
    prev_aug: &DVector<f64>,
    prev_hopf: f64,
    new_aug: &DVector<f64>,
    new_hopf: f64,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut current = prev_aug.clone();
    let denom = prev_hopf - new_hopf;
    if denom.abs() > 1e-12 {
        let mut s = prev_hopf / denom;
        if !s.is_finite() {
            s = 0.5;
        }
        s = s.clamp(0.0, 1.0);
        current = prev_aug + (new_aug - prev_aug) * s;
    }

    let start_param = system.params[param_index];

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current, param_index)?;
        let current_param = current[0];
        let current_state: Vec<f64> = current.rows(1, dim).iter().cloned().collect();

        let old_param = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_param;

        let diag = compute_point_diagnostics(system, kind, &current, param_index)?;
        let test_val = diag.test_values.hopf;
        let f_norm = DVector::from_vec(f_val.clone()).norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }

        let grad = compute_test_gradient(system, kind, &current, param_index, &|vals| vals.hopf)?;

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = grad[i];
        }

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -test_val;

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Hopf refinement linear solve failed"))?;
        current += &delta;

        if delta.norm() < settings.step_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }
    }

    system.params[param_index] = start_param;
    Err(anyhow!("Hopf refinement did not converge"))
}

fn compute_test_gradient(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
    selector: &dyn Fn(&TestFunctionValues) -> f64,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut grad = DVector::zeros(dim + 1);
    let base_eps = 1e-6;

    for i in 0..dim + 1 {
        let mut perturbed = aug_state.clone();
        let step = base_eps * (1.0 + aug_state[i].abs());
        perturbed[i] += step;
        let plus_diag = compute_point_diagnostics(system, kind, &perturbed, param_index)?;
        let plus = selector(&plus_diag.test_values);
        perturbed[i] -= 2.0 * step;
        let minus_diag = compute_point_diagnostics(system, kind, &perturbed, param_index)?;
        let minus = selector(&minus_diag.test_values);
        grad[i] = (plus - minus) / (2.0 * step);
    }

    Ok(grad)
}

fn scalar_test_reached(prev: f64, new: f64) -> bool {
    if !prev.is_finite() || !new.is_finite() {
        return false;
    }
    let tolerance = 1024.0 * f64::EPSILON * prev.abs().max(new.abs()).max(1.0);
    new.abs() <= tolerance && prev.abs() > tolerance
}

fn scalar_test_crossed_or_reached(prev: f64, new: f64) -> bool {
    prev.is_finite() && new.is_finite() && (prev * new < 0.0 || scalar_test_reached(prev, new))
}

const HOMOCLINIC_SPECTRAL_IMAG_TOLERANCE: f64 = homoclinic_events::DEFAULT_FOCUS_TOLERANCE;
const HOMOCLINIC_BT_CENTER_TOLERANCE: f64 = 1.0e-5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackedSpectralModeKind {
    Real,
    ComplexPair,
}

#[derive(Debug, Clone, Copy)]
struct TrackedSpectralMode {
    kind: TrackedSpectralModeKind,
    value: Complex<f64>,
}

#[derive(Debug, Clone, Copy)]
struct TrackedCenterCrossing {
    kind: TrackedSpectralModeKind,
    previous: Complex<f64>,
    current: Complex<f64>,
    fraction: f64,
}

fn tracked_spectral_modes(eigenvalues: &[Complex<f64>]) -> Vec<TrackedSpectralMode> {
    let mut modes = eigenvalues
        .iter()
        .copied()
        .filter(|value| value.re.is_finite() && value.im.is_finite())
        .filter_map(|value| {
            if value.im.abs() < HOMOCLINIC_SPECTRAL_IMAG_TOLERANCE {
                return Some(TrackedSpectralMode {
                    kind: TrackedSpectralModeKind::Real,
                    value: Complex::new(value.re, 0.0),
                });
            }
            if value.im <= 0.0 {
                return None;
            }
            let partner = eigenvalues.iter().copied().find(|candidate| {
                let scale = 1.0_f64.max(value.norm()).max(candidate.norm());
                candidate.im < -HOMOCLINIC_SPECTRAL_IMAG_TOLERANCE
                    && (candidate.re - value.re).abs() <= 1.0e-7 * scale
                    && (candidate.im + value.im).abs() <= 1.0e-7 * scale
            })?;
            Some(TrackedSpectralMode {
                kind: TrackedSpectralModeKind::ComplexPair,
                value: Complex::new(
                    0.5 * (value.re + partner.re),
                    0.5 * (value.im.abs() + partner.im.abs()),
                ),
            })
        })
        .collect::<Vec<_>>();
    modes.sort_by(|left, right| {
        (left.kind as u8)
            .cmp(&(right.kind as u8))
            .then_with(|| left.value.re.total_cmp(&right.value.re))
            .then_with(|| left.value.im.total_cmp(&right.value.im))
    });
    modes
}

fn normalized_spectral_distance(left: Complex<f64>, right: Complex<f64>) -> f64 {
    (left - right).norm() / (1.0 + left.norm() + right.norm())
}

fn tracked_center_crossings(
    previous: &[Complex<f64>],
    current: &[Complex<f64>],
) -> Vec<TrackedCenterCrossing> {
    let previous_modes = tracked_spectral_modes(previous);
    let current_modes = tracked_spectral_modes(current);
    let mut candidates = Vec::new();
    for (previous_index, previous_mode) in previous_modes.iter().enumerate() {
        for (current_index, current_mode) in current_modes.iter().enumerate() {
            if previous_mode.kind == current_mode.kind {
                candidates.push((
                    normalized_spectral_distance(previous_mode.value, current_mode.value),
                    previous_index,
                    current_index,
                ));
            }
        }
    }
    candidates.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });

    let mut used_previous = vec![false; previous_modes.len()];
    let mut used_current = vec![false; current_modes.len()];
    let mut crossings = Vec::new();
    for (_, previous_index, current_index) in candidates {
        if used_previous[previous_index] || used_current[current_index] {
            continue;
        }
        used_previous[previous_index] = true;
        used_current[current_index] = true;
        let previous_mode = previous_modes[previous_index];
        let current_mode = current_modes[current_index];
        if !scalar_test_crossed_or_reached(previous_mode.value.re, current_mode.value.re) {
            continue;
        }
        let denominator = current_mode.value.re - previous_mode.value.re;
        let fraction = if denominator.abs() > f64::EPSILON {
            (-previous_mode.value.re / denominator).clamp(0.0, 1.0)
        } else {
            1.0
        };
        crossings.push(TrackedCenterCrossing {
            kind: previous_mode.kind,
            previous: previous_mode.value,
            current: current_mode.value,
            fraction,
        });
    }
    crossings.sort_by(|left, right| left.fraction.total_cmp(&right.fraction));
    crossings
}

fn three_leading_signed_value(eigenvalues: &[Complex<f64>], stable: bool) -> Option<f64> {
    let modes = tracked_spectral_modes(eigenvalues);
    let on_side = |value: Complex<f64>| {
        if stable {
            value.re < 0.0
        } else {
            value.re > 0.0
        }
    };
    let choose_leading = |kind: TrackedSpectralModeKind| {
        let candidates = modes
            .iter()
            .filter(|mode| mode.kind == kind && on_side(mode.value))
            .map(|mode| mode.value);
        if stable {
            candidates.max_by(|left, right| left.re.total_cmp(&right.re))
        } else {
            candidates.min_by(|left, right| left.re.total_cmp(&right.re))
        }
    };
    let real = choose_leading(TrackedSpectralModeKind::Real)?;
    let pair = choose_leading(TrackedSpectralModeKind::ComplexPair)?;
    Some(real.re - pair.re)
}

fn tracked_homoclinic_event_crossing(
    previous: &PointDiagnostics,
    current: &PointDiagnostics,
) -> Option<BifurcationType> {
    if let Some(crossing) = tracked_center_crossings(&previous.eigenvalues, &current.eigenvalues)
        .into_iter()
        .next()
    {
        return Some(match crossing.kind {
            TrackedSpectralModeKind::Real => BifurcationType::HomoclinicNonCentral,
            TrackedSpectralModeKind::ComplexPair => BifurcationType::HomoclinicShilnikovHopf,
        });
    }

    for (stable, bifurcation) in [
        (true, BifurcationType::HomoclinicThreeLeadingStable),
        (false, BifurcationType::HomoclinicThreeLeadingUnstable),
    ] {
        if let (Some(previous_value), Some(current_value)) = (
            three_leading_signed_value(&previous.eigenvalues, stable),
            three_leading_signed_value(&current.eigenvalues, stable),
        ) {
            if scalar_test_crossed_or_reached(previous_value, current_value) {
                return Some(bifurcation);
            }
        }
    }
    None
}

#[derive(Debug, Clone, Copy)]
enum HomoclinicLocalizationBracket {
    ThreeLeading {
        stable: bool,
    },
    CenterMode {
        kind: TrackedSpectralModeKind,
        previous: Complex<f64>,
        current: Complex<f64>,
    },
}

impl HomoclinicLocalizationBracket {
    fn value(self, diagnostics: &PointDiagnostics, position: f64) -> Option<f64> {
        match self {
            Self::ThreeLeading { stable } => {
                three_leading_signed_value(&diagnostics.eigenvalues, stable)
            }
            Self::CenterMode {
                kind,
                previous,
                current,
            } => {
                let position = position.clamp(0.0, 1.0);
                let expected = previous + (current - previous) * position;
                tracked_spectral_modes(&diagnostics.eigenvalues)
                    .into_iter()
                    .filter(|mode| mode.kind == kind)
                    .min_by(|left, right| {
                        normalized_spectral_distance(left.value, expected)
                            .total_cmp(&normalized_spectral_distance(right.value, expected))
                    })
                    .map(|mode| mode.value.re)
            }
        }
    }
}

fn homoclinic_localization_bracket(
    previous: &PointDiagnostics,
    current: &PointDiagnostics,
    bifurcation: BifurcationType,
) -> Option<HomoclinicLocalizationBracket> {
    match bifurcation {
        BifurcationType::HomoclinicThreeLeadingStable => {
            Some(HomoclinicLocalizationBracket::ThreeLeading { stable: true })
        }
        BifurcationType::HomoclinicThreeLeadingUnstable => {
            Some(HomoclinicLocalizationBracket::ThreeLeading { stable: false })
        }
        BifurcationType::HomoclinicNonCentral | BifurcationType::HomoclinicBogdanovTakens => {
            tracked_center_crossings(&previous.eigenvalues, &current.eigenvalues)
                .into_iter()
                .find(|crossing| crossing.kind == TrackedSpectralModeKind::Real)
                .map(|crossing| HomoclinicLocalizationBracket::CenterMode {
                    kind: crossing.kind,
                    previous: crossing.previous,
                    current: crossing.current,
                })
        }
        BifurcationType::HomoclinicShilnikovHopf => {
            tracked_center_crossings(&previous.eigenvalues, &current.eigenvalues)
                .into_iter()
                .find(|crossing| crossing.kind == TrackedSpectralModeKind::ComplexPair)
                .map(|crossing| HomoclinicLocalizationBracket::CenterMode {
                    kind: crossing.kind,
                    previous: crossing.previous,
                    current: crossing.current,
                })
        }
        _ => None,
    }
}

fn homoclinic_aware_bifurcation_test_value(
    diagnostics: &PointDiagnostics,
    homoclinic: Option<&HomoclinicEventDiagnostics>,
    heteroclinic: Option<&HeteroclinicEventDiagnostics>,
    bifurcation: BifurcationType,
    localization: Option<HomoclinicLocalizationBracket>,
    position: f64,
) -> Option<f64> {
    localization
        .and_then(|bracket| bracket.value(diagnostics, position))
        .or_else(|| bifurcation_test_value(diagnostics, homoclinic, heteroclinic, bifurcation))
}

fn promote_verified_homoclinic_bt(
    diagnostics: &PointDiagnostics,
    bifurcation: BifurcationType,
) -> BifurcationType {
    if !matches!(
        bifurcation,
        BifurcationType::HomoclinicNonCentral
            | BifurcationType::HomoclinicShilnikovHopf
            | BifurcationType::HomoclinicBogdanovTakens
    ) {
        return bifurcation;
    }
    let center_multiplicity = diagnostics
        .eigenvalues
        .iter()
        .filter(|value| {
            value.re.is_finite()
                && value.im.is_finite()
                && value.norm() <= HOMOCLINIC_BT_CENTER_TOLERANCE
        })
        .count();
    if center_multiplicity >= 2 {
        BifurcationType::HomoclinicBogdanovTakens
    } else {
        bifurcation
    }
}

fn map_homoclinic_event_to_bifurcation(event: HomoclinicEventKind) -> Option<BifurcationType> {
    match event {
        HomoclinicEventKind::NeutralSaddle => Some(BifurcationType::HomoclinicNeutralSaddle),
        HomoclinicEventKind::NeutralSaddleFocus => {
            Some(BifurcationType::HomoclinicNeutralSaddleFocus)
        }
        HomoclinicEventKind::NeutralBiFocus => Some(BifurcationType::HomoclinicNeutralBiFocus),
        HomoclinicEventKind::DoubleRealStable => Some(BifurcationType::HomoclinicDoubleRealStable),
        HomoclinicEventKind::DoubleRealUnstable => {
            Some(BifurcationType::HomoclinicDoubleRealUnstable)
        }
        HomoclinicEventKind::NeutrallyDivergentStable => {
            Some(BifurcationType::HomoclinicNeutrallyDivergentStable)
        }
        HomoclinicEventKind::NeutrallyDivergentUnstable => {
            Some(BifurcationType::HomoclinicNeutrallyDivergentUnstable)
        }
        HomoclinicEventKind::ThreeLeadingStable => {
            Some(BifurcationType::HomoclinicThreeLeadingStable)
        }
        HomoclinicEventKind::ThreeLeadingUnstable => {
            Some(BifurcationType::HomoclinicThreeLeadingUnstable)
        }
        HomoclinicEventKind::NonCentralHomoclinic => Some(BifurcationType::HomoclinicNonCentral),
        HomoclinicEventKind::ShilnikovHopf => Some(BifurcationType::HomoclinicShilnikovHopf),
        HomoclinicEventKind::BogdanovTakens => Some(BifurcationType::HomoclinicBogdanovTakens),
        HomoclinicEventKind::OrbitFlipUnstable => {
            Some(BifurcationType::HomoclinicOrbitFlipUnstable)
        }
        HomoclinicEventKind::OrbitFlipStable => Some(BifurcationType::HomoclinicOrbitFlipStable),
        HomoclinicEventKind::InclinationFlipUnstable
        | HomoclinicEventKind::InclinationFlipStable => None,
    }
}

fn homoclinic_event_for_bifurcation(bifurcation: BifurcationType) -> Option<HomoclinicEventKind> {
    match bifurcation {
        BifurcationType::HomoclinicNeutralSaddle => Some(HomoclinicEventKind::NeutralSaddle),
        BifurcationType::HomoclinicNeutralSaddleFocus => {
            Some(HomoclinicEventKind::NeutralSaddleFocus)
        }
        BifurcationType::HomoclinicNeutralBiFocus => Some(HomoclinicEventKind::NeutralBiFocus),
        BifurcationType::HomoclinicDoubleRealStable => Some(HomoclinicEventKind::DoubleRealStable),
        BifurcationType::HomoclinicDoubleRealUnstable => {
            Some(HomoclinicEventKind::DoubleRealUnstable)
        }
        BifurcationType::HomoclinicNeutrallyDivergentStable => {
            Some(HomoclinicEventKind::NeutrallyDivergentStable)
        }
        BifurcationType::HomoclinicNeutrallyDivergentUnstable => {
            Some(HomoclinicEventKind::NeutrallyDivergentUnstable)
        }
        BifurcationType::HomoclinicThreeLeadingStable => {
            Some(HomoclinicEventKind::ThreeLeadingStable)
        }
        BifurcationType::HomoclinicThreeLeadingUnstable => {
            Some(HomoclinicEventKind::ThreeLeadingUnstable)
        }
        BifurcationType::HomoclinicNonCentral => Some(HomoclinicEventKind::NonCentralHomoclinic),
        BifurcationType::HomoclinicShilnikovHopf => Some(HomoclinicEventKind::ShilnikovHopf),
        BifurcationType::HomoclinicBogdanovTakens => Some(HomoclinicEventKind::BogdanovTakens),
        BifurcationType::HomoclinicOrbitFlipUnstable => {
            Some(HomoclinicEventKind::OrbitFlipUnstable)
        }
        BifurcationType::HomoclinicOrbitFlipStable => Some(HomoclinicEventKind::OrbitFlipStable),
        BifurcationType::None
        | BifurcationType::Fold
        | BifurcationType::BranchPoint
        | BifurcationType::Hopf
        | BifurcationType::NeutralSaddle
        | BifurcationType::CycleFold
        | BifurcationType::PeriodDoubling
        | BifurcationType::NeimarkSacker
        | BifurcationType::HeteroclinicSourceHyperbolicityLoss
        | BifurcationType::HeteroclinicTargetHyperbolicityLoss
        | BifurcationType::HeteroclinicSourceLeadingCollision
        | BifurcationType::HeteroclinicTargetLeadingCollision
        | BifurcationType::HeteroclinicSourceOrbitFlip
        | BifurcationType::HeteroclinicTargetOrbitFlip => None,
    }
}

fn available_homoclinic_event_value(
    diagnostics: &HomoclinicEventDiagnostics,
    kind: HomoclinicEventKind,
) -> Option<f64> {
    diagnostics
        .events
        .iter()
        .find(|event| event.kind == kind && event.status == HomoclinicEventStatus::Available)
        .and_then(|event| event.value)
        .filter(|value| value.is_finite())
}

fn map_heteroclinic_event_to_bifurcation(event: HeteroclinicEventKind) -> Option<BifurcationType> {
    match event {
        HeteroclinicEventKind::SourceHyperbolicityLoss => {
            Some(BifurcationType::HeteroclinicSourceHyperbolicityLoss)
        }
        HeteroclinicEventKind::TargetHyperbolicityLoss => {
            Some(BifurcationType::HeteroclinicTargetHyperbolicityLoss)
        }
        HeteroclinicEventKind::SourceLeadingCollision => {
            Some(BifurcationType::HeteroclinicSourceLeadingCollision)
        }
        HeteroclinicEventKind::TargetLeadingCollision => {
            Some(BifurcationType::HeteroclinicTargetLeadingCollision)
        }
        HeteroclinicEventKind::SourceOrbitFlip => {
            Some(BifurcationType::HeteroclinicSourceOrbitFlip)
        }
        HeteroclinicEventKind::TargetOrbitFlip => {
            Some(BifurcationType::HeteroclinicTargetOrbitFlip)
        }
        HeteroclinicEventKind::CrossEndpointResonance
        | HeteroclinicEventKind::SourceInclinationFlip
        | HeteroclinicEventKind::TargetInclinationFlip => None,
    }
}

fn heteroclinic_event_for_bifurcation(
    bifurcation: BifurcationType,
) -> Option<HeteroclinicEventKind> {
    match bifurcation {
        BifurcationType::HeteroclinicSourceHyperbolicityLoss => {
            Some(HeteroclinicEventKind::SourceHyperbolicityLoss)
        }
        BifurcationType::HeteroclinicTargetHyperbolicityLoss => {
            Some(HeteroclinicEventKind::TargetHyperbolicityLoss)
        }
        BifurcationType::HeteroclinicSourceLeadingCollision => {
            Some(HeteroclinicEventKind::SourceLeadingCollision)
        }
        BifurcationType::HeteroclinicTargetLeadingCollision => {
            Some(HeteroclinicEventKind::TargetLeadingCollision)
        }
        BifurcationType::HeteroclinicSourceOrbitFlip => {
            Some(HeteroclinicEventKind::SourceOrbitFlip)
        }
        BifurcationType::HeteroclinicTargetOrbitFlip => {
            Some(HeteroclinicEventKind::TargetOrbitFlip)
        }
        _ => None,
    }
}

fn available_heteroclinic_event_value(
    diagnostics: &HeteroclinicEventDiagnostics,
    kind: HeteroclinicEventKind,
) -> Option<f64> {
    diagnostics
        .events
        .iter()
        .find(|event| event.kind == kind && event.status == HeteroclinicEventStatus::Available)
        .and_then(|event| event.value)
        .filter(|value| value.is_finite())
}

fn heteroclinic_event_crossing(
    previous: Option<&HeteroclinicEventDiagnostics>,
    current: Option<&HeteroclinicEventDiagnostics>,
) -> Option<BifurcationType> {
    let (Some(previous), Some(current)) = (previous, current) else {
        return None;
    };
    [
        HeteroclinicEventKind::SourceHyperbolicityLoss,
        HeteroclinicEventKind::TargetHyperbolicityLoss,
        HeteroclinicEventKind::SourceLeadingCollision,
        HeteroclinicEventKind::TargetLeadingCollision,
        HeteroclinicEventKind::SourceOrbitFlip,
        HeteroclinicEventKind::TargetOrbitFlip,
    ]
    .into_iter()
    .find_map(|kind| {
        let bifurcation = map_heteroclinic_event_to_bifurcation(kind)?;
        let previous = available_heteroclinic_event_value(previous, kind)?;
        let current = available_heteroclinic_event_value(current, kind)?;
        scalar_test_crossed_or_reached(previous, current).then_some(bifurcation)
    })
}

fn homoclinic_event_crossing(
    previous_diagnostics: &PointDiagnostics,
    current_diagnostics: &PointDiagnostics,
    previous: Option<&HomoclinicEventDiagnostics>,
    current: Option<&HomoclinicEventDiagnostics>,
) -> Option<BifurcationType> {
    if let Some(tracked) =
        tracked_homoclinic_event_crossing(previous_diagnostics, current_diagnostics)
    {
        return Some(tracked);
    }
    let (Some(previous), Some(current)) = (previous, current) else {
        return None;
    };
    [
        HomoclinicEventKind::NeutralSaddle,
        HomoclinicEventKind::NeutralSaddleFocus,
        HomoclinicEventKind::NeutralBiFocus,
        HomoclinicEventKind::DoubleRealStable,
        HomoclinicEventKind::DoubleRealUnstable,
        HomoclinicEventKind::NeutrallyDivergentStable,
        HomoclinicEventKind::NeutrallyDivergentUnstable,
        HomoclinicEventKind::OrbitFlipUnstable,
        HomoclinicEventKind::OrbitFlipStable,
    ]
    .into_iter()
    .find_map(|kind| {
        let bifurcation = map_homoclinic_event_to_bifurcation(kind)?;
        let previous = available_homoclinic_event_value(previous, kind)?;
        let current = available_homoclinic_event_value(current, kind)?;
        scalar_test_crossed_or_reached(previous, current).then_some(bifurcation)
    })
}

fn detect_bifurcation_type(
    previous: &PointDiagnostics,
    current: &PointDiagnostics,
    previous_homoclinic: Option<&HomoclinicEventDiagnostics>,
    current_homoclinic: Option<&HomoclinicEventDiagnostics>,
    previous_heteroclinic: Option<&HeteroclinicEventDiagnostics>,
    current_heteroclinic: Option<&HeteroclinicEventDiagnostics>,
) -> BifurcationType {
    let previous_tests = &previous.test_values;
    let current_tests = &current.test_values;

    if scalar_test_crossed_or_reached(previous_tests.fold, current_tests.fold) {
        BifurcationType::Fold
    } else if scalar_test_crossed_or_reached(
        previous_tests.branch_point,
        current_tests.branch_point,
    ) {
        BifurcationType::BranchPoint
    } else if hopf_crossed_with_complex_pairs(previous, current) {
        BifurcationType::Hopf
    } else if scalar_test_crossed_or_reached(previous_tests.cycle_fold, current_tests.cycle_fold) {
        BifurcationType::CycleFold
    } else if scalar_test_crossed_or_reached(
        previous_tests.period_doubling,
        current_tests.period_doubling,
    ) {
        BifurcationType::PeriodDoubling
    } else if neimark_sacker_crossed_with_complex_pairs(previous, current) {
        BifurcationType::NeimarkSacker
    } else if neutral_saddle_crossed_with_real_pairs(previous, current) {
        BifurcationType::NeutralSaddle
    } else {
        homoclinic_event_crossing(previous, current, previous_homoclinic, current_homoclinic)
            .or_else(|| heteroclinic_event_crossing(previous_heteroclinic, current_heteroclinic))
            .unwrap_or(BifurcationType::None)
    }
}

fn bifurcation_test_value(
    diagnostics: &PointDiagnostics,
    homoclinic: Option<&HomoclinicEventDiagnostics>,
    heteroclinic: Option<&HeteroclinicEventDiagnostics>,
    bifurcation: BifurcationType,
) -> Option<f64> {
    if let Some(kind) = homoclinic_event_for_bifurcation(bifurcation) {
        return homoclinic.and_then(|events| available_homoclinic_event_value(events, kind));
    }
    if let Some(kind) = heteroclinic_event_for_bifurcation(bifurcation) {
        return heteroclinic.and_then(|events| available_heteroclinic_event_value(events, kind));
    }
    let value = match bifurcation {
        BifurcationType::Fold => diagnostics.test_values.fold,
        BifurcationType::BranchPoint => diagnostics.test_values.branch_point,
        BifurcationType::Hopf => diagnostics.test_values.hopf,
        BifurcationType::NeutralSaddle => diagnostics.test_values.neutral_saddle,
        BifurcationType::CycleFold => diagnostics.test_values.cycle_fold,
        BifurcationType::PeriodDoubling => diagnostics.test_values.period_doubling,
        BifurcationType::NeimarkSacker => diagnostics.test_values.neimark_sacker,
        BifurcationType::None
        | BifurcationType::HomoclinicNeutralSaddle
        | BifurcationType::HomoclinicNeutralSaddleFocus
        | BifurcationType::HomoclinicNeutralBiFocus
        | BifurcationType::HomoclinicDoubleRealStable
        | BifurcationType::HomoclinicDoubleRealUnstable
        | BifurcationType::HomoclinicNeutrallyDivergentStable
        | BifurcationType::HomoclinicNeutrallyDivergentUnstable
        | BifurcationType::HomoclinicThreeLeadingStable
        | BifurcationType::HomoclinicThreeLeadingUnstable
        | BifurcationType::HomoclinicNonCentral
        | BifurcationType::HomoclinicShilnikovHopf
        | BifurcationType::HomoclinicBogdanovTakens
        | BifurcationType::HomoclinicOrbitFlipUnstable
        | BifurcationType::HomoclinicOrbitFlipStable
        | BifurcationType::HeteroclinicSourceHyperbolicityLoss
        | BifurcationType::HeteroclinicTargetHyperbolicityLoss
        | BifurcationType::HeteroclinicSourceLeadingCollision
        | BifurcationType::HeteroclinicTargetLeadingCollision
        | BifurcationType::HeteroclinicSourceOrbitFlip
        | BifurcationType::HeteroclinicTargetOrbitFlip => return None,
    };
    value.is_finite().then_some(value)
}

fn hopf_crossed_with_complex_pairs(
    prev_diag: &PointDiagnostics,
    new_diag: &PointDiagnostics,
) -> bool {
    let prev_pairs = hopf_pair_count(&prev_diag.eigenvalues);
    let new_pairs = hopf_pair_count(&new_diag.eigenvalues);
    scalar_test_crossed_or_reached(prev_diag.test_values.hopf, new_diag.test_values.hopf)
        && prev_pairs > 0
        && new_pairs > 0
        && prev_pairs == new_pairs
}

fn neimark_sacker_crossed_with_complex_pairs(
    prev_diag: &PointDiagnostics,
    new_diag: &PointDiagnostics,
) -> bool {
    let prev_pairs = hopf_pair_count(&prev_diag.eigenvalues);
    let new_pairs = hopf_pair_count(&new_diag.eigenvalues);
    let prev_outside = prev_diag
        .eigenvalues
        .iter()
        .filter(|eigenvalue| eigenvalue.im > 1.0e-8 && eigenvalue.norm_sqr() > 1.0)
        .count();
    let new_outside = new_diag
        .eigenvalues
        .iter()
        .filter(|eigenvalue| eigenvalue.im > 1.0e-8 && eigenvalue.norm_sqr() > 1.0)
        .count();
    let reached = scalar_test_reached(
        prev_diag.test_values.neimark_sacker,
        new_diag.test_values.neimark_sacker,
    );
    scalar_test_crossed_or_reached(
        prev_diag.test_values.neimark_sacker,
        new_diag.test_values.neimark_sacker,
    ) && prev_pairs > 0
        && new_pairs > 0
        && prev_pairs == new_pairs
        && (prev_outside != new_outside || reached)
}

fn neutral_saddle_crossed_with_real_pairs(
    prev_diag: &PointDiagnostics,
    new_diag: &PointDiagnostics,
) -> bool {
    let prev_real = real_eigenvalue_count(&prev_diag.eigenvalues);
    let new_real = real_eigenvalue_count(&new_diag.eigenvalues);
    scalar_test_crossed_or_reached(
        prev_diag.test_values.neutral_saddle,
        new_diag.test_values.neutral_saddle,
    ) && prev_real >= 2
        && new_real >= 2
        && prev_real == new_real
}

fn compute_point_diagnostics(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<PointDiagnostics> {
    let dim = system.equations.len();
    let param = aug_state[0];
    let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();

    let old_param = system.params[param_index];
    system.params[param_index] = param;
    let evaluated = (|| {
        let system_jac = compute_system_jacobian(system, kind, &state)?;
        let cycle_points = (kind.is_map() && kind.map_iterations() > 1)
            .then(|| compute_map_cycle_points(system, &state, kind.map_iterations()));
        Ok::<_, anyhow::Error>((system_jac, cycle_points))
    })();
    system.params[param_index] = old_param;
    let (system_jac, cycle_points) = evaluated?;

    let mut residual_jac = system_jac.clone();
    if kind.is_map() {
        for i in 0..dim {
            residual_jac[i * dim + i] -= 1.0;
        }
    }

    let residual_mat = DMatrix::from_row_slice(dim, dim, &residual_jac);
    let fold = residual_mat.determinant();

    let eigen_mat = if kind.is_map() {
        DMatrix::from_row_slice(dim, dim, &system_jac)
    } else {
        residual_mat.clone()
    };

    let eigenvalues = compute_eigenvalues(&eigen_mat)?;
    let (hopf, neutral) = if kind.is_flow() && dim >= 2 {
        (
            hopf_test_function(&eigenvalues).re,
            neutral_saddle_test_function(&eigenvalues),
        )
    } else {
        (0.0, 0.0)
    };

    let mut test_values = TestFunctionValues::equilibrium(fold, hopf, neutral);
    if kind.is_map() {
        test_values.fold = 1.0;
        test_values.branch_point = fold;
        test_values.period_doubling = util::period_doubling_test_function(&eigenvalues);
        test_values.neimark_sacker = util::neimark_sacker_test_function(&eigenvalues);
    }

    Ok(PointDiagnostics {
        test_values,
        eigenvalues,
        cycle_points,
    })
}

pub fn compute_eigenvalues_for_state(
    system: &mut EquationSystem,
    kind: SystemKind,
    state: &[f64],
    param_index: usize,
    param_value: f64,
) -> Result<Vec<Complex<f64>>> {
    let mut aug = DVector::zeros(state.len() + 1);
    aug[0] = param_value;
    for (i, &val) in state.iter().enumerate() {
        aug[i + 1] = val;
    }
    let diagnostics = compute_point_diagnostics(system, kind, &aug, param_index)?;
    Ok(diagnostics.eigenvalues)
}

// Eigenvalue and bifurcation test functions (compute_eigenvalues, hopf_test_function,
// neutral_saddle_test_function) are now in util module.

fn compute_extended_jacobian(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<DMatrix<f64>> {
    let dim = system.equations.len();
    let param = aug_state[0];
    let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();

    let mut j_ext = DMatrix::zeros(dim, dim + 1);

    let old_param = system.params[param_index];
    system.params[param_index] = param;

    let param_jac = compute_param_jacobian(system, kind, &state, param_index)?;
    for i in 0..dim {
        j_ext[(i, 0)] = param_jac[i];
    }

    system.params[param_index] = old_param;

    let jac_x = crate::equilibrium::compute_jacobian(system, kind, &state)?;
    for col in 0..dim {
        for row in 0..dim {
            // Fix: Row-Major from compute_jacobian
            j_ext[(row, col + 1)] = jac_x[row * dim + col];
        }
    }

    Ok(j_ext)
}

fn evaluate_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) -> Result<()> {
    evaluate_equilibrium_residual(system, kind, state, out)
}

fn solve_palc(
    system: &mut EquationSystem,
    kind: SystemKind,
    pred_aug: &DVector<f64>,
    _prev_aug: &DVector<f64>,
    prev_tangent: &DVector<f64>,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<Option<(DVector<f64>, DVector<f64>)>> {
    let dim = system.equations.len();
    let mut current_aug = pred_aug.clone();

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current_aug, param_index)?;

        let current_param = current_aug[0];
        let current_state: Vec<f64> = current_aug.rows(1, dim).iter().cloned().collect();

        let old_p = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_p;

        let diff = &current_aug - pred_aug;
        let constraint_val = prev_tangent.dot(&diff);

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -constraint_val;

        if rhs.norm() < settings.corrector_tolerance {
            let j_ext_final = compute_extended_jacobian(system, kind, &current_aug, param_index)?;
            let mut new_tangent = compute_nullspace_tangent(&j_ext_final)?;

            if new_tangent.norm() > 0.0 {
                new_tangent.normalize_mut();
            }

            let oriented_tangent = if new_tangent.dot(prev_tangent) < 0.0 {
                -new_tangent
            } else {
                new_tangent
            };

            return Ok(Some((current_aug, oriented_tangent)));
        }

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = prev_tangent[i];
        }

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Singular matrix in PALC corrector"))?;

        current_aug += &delta;

        if delta.norm() < settings.step_tolerance {}
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::homoclinic_events::{
        compute_homoclinic_event_diagnostics, HomoclinicEventKind, DEFAULT_FOCUS_TOLERANCE,
    };
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::{DMatrix, DVector};

    fn cycle_diagnostics(ns_test: f64, eigenvalues: Vec<Complex<f64>>) -> PointDiagnostics {
        PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(1.0, 1.0, ns_test),
            eigenvalues,
            cycle_points: None,
        }
    }

    #[test]
    fn ns_crossing_guard_rejects_a_stable_real_to_complex_transition() {
        let real = cycle_diagnostics(
            0.4 * 0.6 - 1.0,
            vec![
                Complex::new(1.0, 0.0),
                Complex::new(0.4, 0.0),
                Complex::new(0.6, 0.0),
            ],
        );
        let pair = Complex::from_polar(0.5, 0.2);
        let complex = cycle_diagnostics(
            pair.norm_sqr() - 1.0,
            vec![Complex::new(1.0, 0.0), pair, pair.conj()],
        );
        assert!(!neimark_sacker_crossed_with_complex_pairs(&real, &complex));
    }

    #[test]
    fn ns_crossing_guard_accepts_a_genuine_complex_unit_circle_crossing() {
        let inside_pair = Complex::from_polar(0.99, 0.4);
        let outside_pair = Complex::from_polar(1.01, 0.4);
        let inside = cycle_diagnostics(
            inside_pair.norm_sqr() - 1.0,
            vec![Complex::new(1.0, 0.0), inside_pair, inside_pair.conj()],
        );
        let outside = cycle_diagnostics(
            outside_pair.norm_sqr() - 1.0,
            vec![Complex::new(1.0, 0.0), outside_pair, outside_pair.conj()],
        );
        assert!(neimark_sacker_crossed_with_complex_pairs(&inside, &outside));
    }

    #[test]
    fn ns_crossing_guard_accepts_a_step_that_lands_on_the_unit_circle() {
        let inside_pair = Complex::from_polar(0.95, 0.4);
        let unit_pair = Complex::from_polar(1.0, 0.4);
        let inside = cycle_diagnostics(
            inside_pair.norm_sqr() - 1.0,
            vec![Complex::new(1.0, 0.0), inside_pair, inside_pair.conj()],
        );
        let on_circle = cycle_diagnostics(
            unit_pair.norm_sqr() - 1.0,
            vec![Complex::new(1.0, 0.0), unit_pair, unit_pair.conj()],
        );
        assert!(neimark_sacker_crossed_with_complex_pairs(
            &inside, &on_circle
        ));
    }

    #[test]
    fn ns_crossing_guard_rejects_a_reciprocal_real_pair_crossing() {
        let below = cycle_diagnostics(
            0.4 * 2.4 - 1.0,
            vec![
                Complex::new(1.0, 0.0),
                Complex::new(0.4, 0.0),
                Complex::new(2.4, 0.0),
            ],
        );
        let above = cycle_diagnostics(
            0.4 * 2.6 - 1.0,
            vec![
                Complex::new(1.0, 0.0),
                Complex::new(0.4, 0.0),
                Complex::new(2.6, 0.0),
            ],
        );
        assert!(!neimark_sacker_crossed_with_complex_pairs(&below, &above));
    }

    #[test]
    fn ns_crossing_guard_rejects_a_reciprocal_real_pair_with_an_unrelated_complex_pair() {
        let stable_pair = Complex::from_polar(0.5, 0.4);
        let below = cycle_diagnostics(
            -0.04,
            vec![
                Complex::new(1.0, 0.0),
                stable_pair,
                stable_pair.conj(),
                Complex::new(0.4, 0.0),
                Complex::new(2.4, 0.0),
            ],
        );
        let above = cycle_diagnostics(
            0.04,
            vec![
                Complex::new(1.0, 0.0),
                stable_pair,
                stable_pair.conj(),
                Complex::new(0.4, 0.0),
                Complex::new(2.6, 0.0),
            ],
        );
        assert!(!neimark_sacker_crossed_with_complex_pairs(&below, &above));
    }

    #[test]
    fn test_palc_simple_fold() {
        let mut ops = Vec::new();
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::LoadConst(2.0));
        ops.push(OpCode::Pow);
        ops.push(OpCode::LoadParam(0));
        ops.push(OpCode::Add);

        let eq = Bytecode { ops };
        let equations = vec![eq];
        let params = vec![-1.0];
        let mut system = EquationSystem::new(equations, params);

        let initial_state = vec![1.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.5,
            max_steps: 40,
            corrector_steps: 5,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let res = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true,
        );

        assert!(res.is_ok(), "Continuation failed: {:?}", res.err());
        let branch = res.unwrap();

        assert!(branch.points.len() > 1);
        assert!(branch.points[1].param_value > -1.0);
        assert!(branch.points[1].state[0] < 1.0);
    }

    /// Test Hopf normal form: dx/dt = μx - y, dy/dt = x + μy
    /// Linear part has eigenvalues μ ± i, so Hopf bifurcation at μ = 0.
    #[test]
    fn test_hopf_normal_form() {
        // Build: dx/dt = mu*x - y (equation 0)
        //        dy/dt = x + mu*y (equation 1)
        // Equilibrium at origin for all mu.
        // Eigenvalues: mu ± i => Hopf at mu = 0

        // Equation 0: mu*x - y = LoadParam(0)*LoadVar(0) - LoadVar(1)
        let eq0_ops = vec![
            OpCode::LoadParam(0), // mu
            OpCode::LoadVar(0),   // x
            OpCode::Mul,          // mu*x
            OpCode::LoadVar(1),   // y
            OpCode::Sub,          // mu*x - y
        ];

        // Equation 1: x + mu*y = LoadVar(0) + LoadParam(0)*LoadVar(1)
        let eq1_ops = vec![
            OpCode::LoadVar(0),   // x
            OpCode::LoadParam(0), // mu
            OpCode::LoadVar(1),   // y
            OpCode::Mul,          // mu*y
            OpCode::Add,          // x + mu*y
        ];

        let equations = vec![Bytecode { ops: eq0_ops }, Bytecode { ops: eq1_ops }];
        let params = vec![-0.5]; // Start at mu = -0.5 (stable)
        let mut system = EquationSystem::new(equations, params);

        // Equilibrium is at origin
        let initial_state = vec![0.0, 0.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.05,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 50,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let res = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true, // Forward: -0.5 -> positive
        );

        assert!(res.is_ok(), "Hopf NF continuation failed: {:?}", res.err());
        let branch = res.unwrap();

        // Check that we found a Hopf bifurcation
        let hopf_points: Vec<_> = branch
            .points
            .iter()
            .enumerate()
            .filter(|(_, pt)| pt.stability == BifurcationType::Hopf)
            .collect();

        // We should find at least one Hopf bifurcation
        assert!(!hopf_points.is_empty(), "Should detect Hopf bifurcation");

        // The Hopf should be near mu = 0
        let hopf_param = hopf_points[0].1.param_value;
        assert!(
            hopf_param.abs() < 0.1,
            "Hopf should be near mu=0, found at mu={:.6}",
            hopf_param
        );
    }

    #[test]
    fn test_no_hopf_when_complex_pair_becomes_real() {
        // dx/dt = -x + y
        // dy/dt = mu*x - y
        // Jacobian [[-1, 1], [mu, -1]] has eigenvalues -1 ± sqrt(mu).
        // For mu < 0: complex pair with negative real part.
        // For mu > 0: real eigenvalues with negative real parts (no Hopf).
        let eq0_ops = vec![
            OpCode::LoadConst(-1.0),
            OpCode::LoadVar(0),
            OpCode::Mul,
            OpCode::LoadVar(1),
            OpCode::Add,
        ];
        let eq1_ops = vec![
            OpCode::LoadParam(0),
            OpCode::LoadVar(0),
            OpCode::Mul,
            OpCode::LoadConst(-1.0),
            OpCode::LoadVar(1),
            OpCode::Mul,
            OpCode::Add,
        ];

        let equations = vec![Bytecode { ops: eq0_ops }, Bytecode { ops: eq1_ops }];
        let params = vec![-0.5];
        let mut system = EquationSystem::new(equations, params);

        let initial_state = vec![0.0, 0.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 30,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true,
        )
        .expect("Continuation should succeed");

        assert!(
            branch.points.iter().any(|pt| pt.param_value > 0.0),
            "Continuation should cross into positive mu"
        );

        let hopf_points: Vec<_> = branch
            .points
            .iter()
            .filter(|pt| pt.stability == BifurcationType::Hopf)
            .collect();

        assert!(
            hopf_points.is_empty(),
            "Should not detect Hopf when complex pair becomes real"
        );

        let neutral_points: Vec<_> = branch
            .points
            .iter()
            .filter(|pt| pt.stability == BifurcationType::NeutralSaddle)
            .collect();

        assert!(
            neutral_points.is_empty(),
            "Should not detect neutral saddle when complex pair becomes real"
        );
    }

    #[derive(Default)]
    struct ZeroResidualProblem;

    impl ContinuationProblem for ZeroResidualProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, _aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    #[derive(Default)]
    struct LinearRelationProblem;

    impl ContinuationProblem for LinearRelationProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    struct SimpleFoldProblem;

    impl ContinuationProblem for SimpleFoldProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] * aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 2.0 * aug_state[1]]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    struct AveragedProfileProblem {
        dimension: usize,
    }

    impl ContinuationProblem for AveragedProfileProblem {
        fn dimension(&self) -> usize {
            self.dimension
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            for i in 0..self.dimension {
                out[i] = aug_state[i + 1] - aug_state[0];
            }
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            let mut jac = DMatrix::zeros(self.dimension, self.dimension + 1);
            for i in 0..self.dimension {
                jac[(i, 0)] = -1.0;
                jac[(i, i + 1)] = 1.0;
            }
            Ok(jac)
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }

        fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
            let mut weights =
                DVector::from_element(self.dimension + 1, 1.0 / self.dimension as f64);
            weights[0] = 1.0;
            Ok(weights)
        }
    }

    struct InexactJacobianProblem {
        residual_calls: usize,
    }

    impl ContinuationProblem for InexactJacobianProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            self.residual_calls += 1;
            out[0] = aug_state[1];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            // Deliberately inexact so Newton stagnation is observable.
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 2.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            unreachable!("corrector regression does not request diagnostics")
        }
    }

    struct RejectingStepProblem {
        rejected_steps: usize,
        largest_accepted_parameter: f64,
    }

    impl ContinuationProblem for RejectingStepProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }

        fn is_step_acceptable(&mut self, aug_state: &DVector<f64>) -> Result<bool> {
            let accepted = aug_state[0].abs() <= self.largest_accepted_parameter;
            if !accepted {
                self.rejected_steps += 1;
            }
            Ok(accepted)
        }
    }

    struct SingularTangentProblem;

    impl ContinuationProblem for SingularTangentProblem {
        fn dimension(&self) -> usize {
            2
        }

        fn residual(&mut self, _aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out.fill(0.0);
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::zeros(2, 3))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            unreachable!("tangent failure should happen before diagnostics")
        }
    }

    struct MultiTangentProblem;

    impl ContinuationProblem for MultiTangentProblem {
        fn dimension(&self) -> usize {
            2
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[0];
            out[1] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(
                2,
                3,
                &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            unreachable!("only tangent selection is exercised")
        }
    }

    struct UpdatingGaugeProblem {
        anchor_x: f64,
        anchor_y: f64,
        rotated: bool,
    }

    impl ContinuationProblem for UpdatingGaugeProblem {
        fn dimension(&self) -> usize {
            2
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            let (a, b) = if self.rotated { (0.0, 1.0) } else { (1.0, 0.0) };
            out[0] = aug_state[1] - aug_state[0];
            out[1] = a * (aug_state[1] - self.anchor_x) + b * (aug_state[2] - self.anchor_y);
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            let (a, b) = if self.rotated { (0.0, 1.0) } else { (1.0, 0.0) };
            Ok(DMatrix::from_row_slice(2, 3, &[-1.0, 1.0, 0.0, 0.0, a, b]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }

        fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
            self.anchor_x = aug_state[1];
            self.anchor_y = aug_state[2];
            self.rotated = aug_state[2] > 0.05;
            Ok(())
        }
    }

    fn constant_settings(max_steps: usize) -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.1,
            min_step_size: 0.1,
            max_step_size: 0.1,
            max_steps,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        }
    }

    struct SyntheticHomoclinicEventProblem {
        detect_from_initial_seed: bool,
    }

    impl Default for SyntheticHomoclinicEventProblem {
        fn default() -> Self {
            Self {
                detect_from_initial_seed: true,
            }
        }
    }

    impl ContinuationProblem for SyntheticHomoclinicEventProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: vec![
                    Complex::new(-1.0, 0.0),
                    Complex::new(1.0 + aug_state[0], 0.0),
                ],
                cycle_points: None,
            })
        }

        fn homoclinic_event_diagnostics(
            &mut self,
            aug_state: &DVector<f64>,
        ) -> Result<Option<crate::continuation::homoclinic_events::HomoclinicEventDiagnostics>>
        {
            Ok(Some(compute_homoclinic_event_diagnostics(
                &[
                    Complex::new(-1.0, 0.0),
                    Complex::new(1.0 + aug_state[0], 0.0),
                ],
                None,
                DEFAULT_FOCUS_TOLERANCE,
            )))
        }

        fn detect_homoclinic_events_from_initial_seed(&self) -> bool {
            self.detect_from_initial_seed
        }
    }

    struct SyntheticHeteroclinicEventProblem;

    impl ContinuationProblem for SyntheticHeteroclinicEventProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                // Two-equilibrium spectra deliberately stay out of this
                // one-saddle slot.
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }

        fn heteroclinic_event_diagnostics(
            &mut self,
            aug_state: &DVector<f64>,
        ) -> Result<Option<HeteroclinicEventDiagnostics>> {
            let parameter = aug_state[0];
            Ok(Some(compute_heteroclinic_event_diagnostics(
                &[
                    Complex::new(-2.0, 0.0),
                    Complex::new(1.0, 0.0),
                    Complex::new(1.0 + parameter, 1.0),
                    Complex::new(1.0 + parameter, -1.0),
                ],
                &[
                    Complex::new(-1.0, 0.0),
                    Complex::new(2.0, 0.0),
                    Complex::new(3.0, 0.0),
                    Complex::new(4.0, 0.0),
                ],
                None,
                heteroclinic_events::DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
            )))
        }
    }

    #[test]
    fn localizes_a_sign_bracketed_two_equilibrium_source_spectral_collision() {
        let initial = ContinuationPoint {
            state: vec![-0.1],
            param_value: -0.1,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let branch = continue_with_problem(
            &mut SyntheticHeteroclinicEventProblem,
            initial,
            ContinuationSettings {
                step_size: 0.4,
                min_step_size: 0.4,
                max_step_size: 0.4,
                max_steps: 1,
                corrector_steps: 8,
                corrector_tolerance: 1.0e-11,
                step_tolerance: 1.0e-11,
            },
            true,
        )
        .expect("synthetic heteroclinic event continuation");

        assert_eq!(branch.bifurcations, vec![1]);
        let event = &branch.points[1];
        assert_eq!(
            event.stability,
            BifurcationType::HeteroclinicSourceLeadingCollision
        );
        assert!(event.param_value.abs() < 1.0e-6);
        assert!(event.homoclinic_events.is_none());
        let diagnostics = event
            .heteroclinic_events
            .as_ref()
            .expect("localized point must serialize its independent endpoint diagnostics");
        assert!(
            diagnostics
                .event(HeteroclinicEventKind::SourceLeadingCollision)
                .value
                .expect("SLC value")
                .abs()
                < 1.0e-6
        );
        assert_eq!(
            diagnostics
                .event(HeteroclinicEventKind::CrossEndpointResonance)
                .status,
            HeteroclinicEventStatus::Unsupported
        );
    }

    #[derive(Clone, Copy)]
    enum TrackedHomoclinicSpectrum {
        ThreeLeadingStable,
        ThreeLeadingUnstable,
        NonCentral,
        ShilnikovHopf,
        BogdanovTakens,
    }

    impl TrackedHomoclinicSpectrum {
        fn eigenvalues(self, parameter: f64) -> Vec<Complex<f64>> {
            match self {
                Self::ThreeLeadingStable => vec![
                    Complex::new(-1.0 + parameter, 0.0),
                    Complex::new(-1.0 - parameter, 1.0),
                    Complex::new(-1.0 - parameter, -1.0),
                    Complex::new(2.0, 0.0),
                ],
                Self::ThreeLeadingUnstable => vec![
                    Complex::new(-2.0, 0.0),
                    Complex::new(1.0 + parameter, 0.0),
                    Complex::new(1.0 - parameter, 1.0),
                    Complex::new(1.0 - parameter, -1.0),
                ],
                Self::NonCentral => vec![
                    Complex::new(-2.0, 0.0),
                    Complex::new(parameter, 0.0),
                    Complex::new(2.0, 0.0),
                ],
                Self::ShilnikovHopf => vec![
                    Complex::new(-2.0, 0.0),
                    Complex::new(parameter, 1.0),
                    Complex::new(parameter, -1.0),
                    Complex::new(2.0, 0.0),
                ],
                Self::BogdanovTakens => vec![
                    Complex::new(-2.0, 0.0),
                    Complex::new(parameter, 0.0),
                    Complex::new(2.0 * parameter, 0.0),
                    Complex::new(2.0, 0.0),
                ],
            }
        }
    }

    struct SyntheticTrackedHomoclinicEventProblem {
        spectrum: TrackedHomoclinicSpectrum,
    }

    impl ContinuationProblem for SyntheticTrackedHomoclinicEventProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: self.spectrum.eigenvalues(aug_state[0]),
                cycle_points: None,
            })
        }

        fn homoclinic_event_diagnostics(
            &mut self,
            aug_state: &DVector<f64>,
        ) -> Result<Option<HomoclinicEventDiagnostics>> {
            Ok(Some(compute_homoclinic_event_diagnostics(
                &self.spectrum.eigenvalues(aug_state[0]),
                None,
                DEFAULT_FOCUS_TOLERANCE,
            )))
        }
    }

    fn homoclinic_event_initial_point() -> ContinuationPoint {
        ContinuationPoint {
            state: vec![-0.1],
            param_value: -0.1,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        }
    }

    fn homoclinic_event_settings() -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.4,
            min_step_size: 0.4,
            max_step_size: 0.4,
            max_steps: 1,
            corrector_steps: 8,
            corrector_tolerance: 1.0e-11,
            step_tolerance: 1.0e-11,
        }
    }

    fn assert_localized_homoclinic_neutral_saddle(branch: &ContinuationBranch) {
        assert_eq!(branch.points.len(), 2);
        assert_eq!(branch.bifurcations, vec![1]);
        let event = &branch.points[1];
        assert_eq!(event.stability, BifurcationType::HomoclinicNeutralSaddle);
        assert!(
            event.param_value.abs() < 1.0e-6,
            "homoclinic event was not localized: {}",
            event.param_value
        );

        let diagnostics = event
            .homoclinic_events
            .as_ref()
            .expect("localized point should persist exact homoclinic diagnostics");
        assert_eq!(diagnostics.events.len(), HomoclinicEventKind::ALL.len());

        let neutral_saddle = diagnostics.event(HomoclinicEventKind::NeutralSaddle);
        assert_eq!(neutral_saddle.status, HomoclinicEventStatus::Available);
        let neutral_saddle_value = neutral_saddle
            .value
            .expect("neutral-saddle test function should be available");
        assert!(
            neutral_saddle_value.abs() < 1.0e-6,
            "localized NNS value was not near zero: {neutral_saddle_value}"
        );
        assert!(
            (neutral_saddle_value - event.param_value).abs() < 1.0e-12,
            "persisted NNS value must be evaluated at the localized point"
        );

        for kind in [
            HomoclinicEventKind::InclinationFlipUnstable,
            HomoclinicEventKind::InclinationFlipStable,
        ] {
            let inclination_flip = diagnostics.event(kind);
            assert_eq!(inclination_flip.status, HomoclinicEventStatus::Unsupported);
            assert_eq!(inclination_flip.value, None);
        }
    }

    fn diagnostics_with_single_homoclinic_event(
        kind: HomoclinicEventKind,
        value: f64,
    ) -> HomoclinicEventDiagnostics {
        HomoclinicEventDiagnostics {
            events: HomoclinicEventKind::ALL
                .into_iter()
                .map(|candidate| {
                    let available = candidate == kind;
                    HomoclinicEventValue {
                        kind: candidate,
                        name: candidate.name().to_owned(),
                        value: available.then_some(value),
                        status: if available {
                            HomoclinicEventStatus::Available
                        } else if matches!(
                            candidate,
                            HomoclinicEventKind::InclinationFlipUnstable
                                | HomoclinicEventKind::InclinationFlipStable
                        ) {
                            HomoclinicEventStatus::Unsupported
                        } else {
                            HomoclinicEventStatus::Unavailable
                        },
                        reason: (!available).then(|| "not active in this test".to_owned()),
                    }
                })
                .collect(),
            stable_dimension: 3,
            unstable_dimension: 3,
            discarded_eigenvalues: 0,
        }
    }

    #[test]
    fn homoclinic_event_mappings_cover_tracked_and_direct_crossing_channels() {
        let mappings = [
            (
                HomoclinicEventKind::NeutralSaddle,
                BifurcationType::HomoclinicNeutralSaddle,
            ),
            (
                HomoclinicEventKind::NeutralSaddleFocus,
                BifurcationType::HomoclinicNeutralSaddleFocus,
            ),
            (
                HomoclinicEventKind::NeutralBiFocus,
                BifurcationType::HomoclinicNeutralBiFocus,
            ),
            (
                HomoclinicEventKind::DoubleRealStable,
                BifurcationType::HomoclinicDoubleRealStable,
            ),
            (
                HomoclinicEventKind::DoubleRealUnstable,
                BifurcationType::HomoclinicDoubleRealUnstable,
            ),
            (
                HomoclinicEventKind::NeutrallyDivergentStable,
                BifurcationType::HomoclinicNeutrallyDivergentStable,
            ),
            (
                HomoclinicEventKind::NeutrallyDivergentUnstable,
                BifurcationType::HomoclinicNeutrallyDivergentUnstable,
            ),
            (
                HomoclinicEventKind::ThreeLeadingStable,
                BifurcationType::HomoclinicThreeLeadingStable,
            ),
            (
                HomoclinicEventKind::ThreeLeadingUnstable,
                BifurcationType::HomoclinicThreeLeadingUnstable,
            ),
            (
                HomoclinicEventKind::NonCentralHomoclinic,
                BifurcationType::HomoclinicNonCentral,
            ),
            (
                HomoclinicEventKind::ShilnikovHopf,
                BifurcationType::HomoclinicShilnikovHopf,
            ),
            (
                HomoclinicEventKind::BogdanovTakens,
                BifurcationType::HomoclinicBogdanovTakens,
            ),
            (
                HomoclinicEventKind::OrbitFlipUnstable,
                BifurcationType::HomoclinicOrbitFlipUnstable,
            ),
            (
                HomoclinicEventKind::OrbitFlipStable,
                BifurcationType::HomoclinicOrbitFlipStable,
            ),
        ];

        for (event, stability) in mappings {
            assert_eq!(map_homoclinic_event_to_bifurcation(event), Some(stability));
            assert_eq!(homoclinic_event_for_bifurcation(stability), Some(event));

            if !matches!(
                event,
                HomoclinicEventKind::ThreeLeadingStable
                    | HomoclinicEventKind::ThreeLeadingUnstable
                    | HomoclinicEventKind::NonCentralHomoclinic
                    | HomoclinicEventKind::ShilnikovHopf
                    | HomoclinicEventKind::BogdanovTakens
            ) {
                let point = PointDiagnostics {
                    test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                };
                let before = diagnostics_with_single_homoclinic_event(event, -1.0);
                let after = diagnostics_with_single_homoclinic_event(event, 1.0);
                assert_eq!(
                    detect_bifurcation_type(
                        &point,
                        &point,
                        Some(&before),
                        Some(&after),
                        None,
                        None,
                    ),
                    stability,
                    "failed to detect the {} channel",
                    event.code()
                );
            }
        }
        assert_eq!(
            map_homoclinic_event_to_bifurcation(HomoclinicEventKind::InclinationFlipUnstable),
            None
        );
        assert_eq!(
            map_homoclinic_event_to_bifurcation(HomoclinicEventKind::InclinationFlipStable),
            None
        );
        assert_eq!(
            homoclinic_event_for_bifurcation(BifurcationType::Fold),
            None
        );
    }

    fn assert_tracked_homoclinic_event_localizes(
        spectrum: TrackedHomoclinicSpectrum,
        expected: BifurcationType,
        raw_kind: HomoclinicEventKind,
    ) {
        let mut problem = SyntheticTrackedHomoclinicEventProblem { spectrum };
        let branch = continue_with_problem(
            &mut problem,
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("tracked homoclinic event continuation");
        assert_eq!(branch.bifurcations, vec![1]);
        let point = &branch.points[1];
        assert_eq!(point.stability, expected);
        assert!(
            point.param_value.abs() < 1.0e-6,
            "tracked event was not localized: {}",
            point.param_value
        );
        let raw = point
            .homoclinic_events
            .as_ref()
            .expect("localized tracked diagnostics")
            .event(raw_kind);
        assert_eq!(raw.status, HomoclinicEventStatus::Available);
        assert!(raw.value.expect("localized raw value").abs() < 1.0e-6);
    }

    #[test]
    fn tracked_three_leading_events_localize_the_touching_raw_gap() {
        assert_tracked_homoclinic_event_localizes(
            TrackedHomoclinicSpectrum::ThreeLeadingStable,
            BifurcationType::HomoclinicThreeLeadingStable,
            HomoclinicEventKind::ThreeLeadingStable,
        );
        assert_tracked_homoclinic_event_localizes(
            TrackedHomoclinicSpectrum::ThreeLeadingUnstable,
            BifurcationType::HomoclinicThreeLeadingUnstable,
            HomoclinicEventKind::ThreeLeadingUnstable,
        );
    }

    #[test]
    fn tracked_center_modes_localize_nch_sh_and_verify_bt() {
        assert_tracked_homoclinic_event_localizes(
            TrackedHomoclinicSpectrum::NonCentral,
            BifurcationType::HomoclinicNonCentral,
            HomoclinicEventKind::NonCentralHomoclinic,
        );
        assert_tracked_homoclinic_event_localizes(
            TrackedHomoclinicSpectrum::ShilnikovHopf,
            BifurcationType::HomoclinicShilnikovHopf,
            HomoclinicEventKind::ShilnikovHopf,
        );
        assert_tracked_homoclinic_event_localizes(
            TrackedHomoclinicSpectrum::BogdanovTakens,
            BifurcationType::HomoclinicBogdanovTakens,
            HomoclinicEventKind::BogdanovTakens,
        );
    }

    #[test]
    fn center_mode_identity_tracking_rejects_a_nearest_mode_swap() {
        let point = |eigenvalues| PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues,
            cycle_points: None,
        };
        let previous = point(vec![Complex::new(-0.1, 0.0), Complex::new(0.2, 0.0)]);
        let current = point(vec![Complex::new(-0.2, 0.0), Complex::new(0.1, 0.0)]);
        assert_eq!(
            tracked_homoclinic_event_crossing(&previous, &current),
            None,
            "switching which side is closest to zero is not an eigenvalue crossing"
        );
    }

    #[test]
    fn stepped_and_initial_tangent_runners_localize_tracked_spectral_events() {
        let mut runner = ContinuationRunner::new(
            SyntheticTrackedHomoclinicEventProblem {
                spectrum: TrackedHomoclinicSpectrum::ThreeLeadingUnstable,
            },
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("tracked stepped runner");
        runner.run_steps(1).expect("tracked stepped event");
        let stepped = runner.take_result();
        assert_eq!(
            stepped.points[1].stability,
            BifurcationType::HomoclinicThreeLeadingUnstable
        );
        assert!(stepped.points[1].param_value.abs() < 1.0e-6);

        let mut problem = SyntheticTrackedHomoclinicEventProblem {
            spectrum: TrackedHomoclinicSpectrum::ShilnikovHopf,
        };
        let initialized = continue_with_initial_tangent(
            &mut problem,
            homoclinic_event_initial_point(),
            DVector::from_vec(vec![1.0, 1.0]),
            homoclinic_event_settings(),
        )
        .expect("tracked initial-tangent event");
        assert_eq!(
            initialized.points[1].stability,
            BifurcationType::HomoclinicShilnikovHopf
        );
        assert!(initialized.points[1].param_value.abs() < 1.0e-6);
    }

    #[test]
    fn localized_tracked_event_marker_and_raw_diagnostics_survive_json() {
        let mut problem = SyntheticTrackedHomoclinicEventProblem {
            spectrum: TrackedHomoclinicSpectrum::BogdanovTakens,
        };
        let branch = continue_with_problem(
            &mut problem,
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("tracked BT branch");
        let encoded = serde_json::to_string(&branch).expect("serialize tracked BT branch");
        let decoded: ContinuationBranch =
            serde_json::from_str(&encoded).expect("deserialize tracked BT branch");
        assert_eq!(
            decoded.points[1].stability,
            BifurcationType::HomoclinicBogdanovTakens
        );
        let bt = decoded.points[1]
            .homoclinic_events
            .as_ref()
            .expect("persisted tracked diagnostics")
            .event(HomoclinicEventKind::BogdanovTakens);
        assert_eq!(bt.status, HomoclinicEventStatus::Available);
        assert!(bt.value.expect("persisted BT value").abs() < 1.0e-6);
    }

    #[test]
    fn tracked_spectral_events_localize_in_reverse_continuation() {
        let initial = ContinuationPoint {
            state: vec![0.1],
            param_value: 0.1,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        for (spectrum, expected) in [
            (
                TrackedHomoclinicSpectrum::ThreeLeadingStable,
                BifurcationType::HomoclinicThreeLeadingStable,
            ),
            (
                TrackedHomoclinicSpectrum::NonCentral,
                BifurcationType::HomoclinicNonCentral,
            ),
        ] {
            let mut problem = SyntheticTrackedHomoclinicEventProblem { spectrum };
            let branch = continue_with_problem(
                &mut problem,
                initial.clone(),
                homoclinic_event_settings(),
                false,
            )
            .expect("reverse tracked event continuation");
            assert_eq!(branch.points[1].stability, expected);
            assert!(branch.points[1].param_value.abs() < 1.0e-6);
        }
    }

    #[test]
    fn tracked_spectral_events_are_not_duplicated_after_localization() {
        for spectrum in [
            TrackedHomoclinicSpectrum::ThreeLeadingStable,
            TrackedHomoclinicSpectrum::NonCentral,
        ] {
            let mut settings = homoclinic_event_settings();
            settings.max_steps = 2;
            let mut problem = SyntheticTrackedHomoclinicEventProblem { spectrum };
            let branch = continue_with_problem(
                &mut problem,
                homoclinic_event_initial_point(),
                settings,
                true,
            )
            .expect("tracked event continuation past the localized point");

            assert_eq!(branch.points.len(), 3);
            assert_eq!(branch.bifurcations, vec![1]);
            assert_eq!(branch.points[2].stability, BifurcationType::None);
        }
    }

    #[test]
    fn bt_promotion_requires_two_co_localized_zero_modes() {
        let diagnostics = PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues: vec![
                Complex::new(0.0, 0.0),
                Complex::new(1.0e-3, 0.0),
                Complex::new(2.0, 0.0),
            ],
            cycle_points: None,
        };

        assert_eq!(
            promote_verified_homoclinic_bt(&diagnostics, BifurcationType::HomoclinicNonCentral,),
            BifurcationType::HomoclinicNonCentral
        );
    }

    #[test]
    fn continue_with_problem_localizes_homoclinic_events() {
        let mut problem = SyntheticHomoclinicEventProblem::default();
        let branch = continue_with_problem(
            &mut problem,
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("homoclinic event continuation");
        assert_localized_homoclinic_neutral_saddle(&branch);
    }

    #[test]
    fn localized_homoclinic_event_diagnostics_survive_json_round_trip() {
        let mut problem = SyntheticHomoclinicEventProblem::default();
        let branch = continue_with_problem(
            &mut problem,
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("homoclinic event continuation");

        let serialized = serde_json::to_string(&branch).expect("serialize continuation branch");
        let serialized_value: serde_json::Value =
            serde_json::from_str(&serialized).expect("inspect serialized continuation branch");
        assert_eq!(
            serialized_value["points"][1]["homoclinic_events"]["events"]
                .as_array()
                .expect("serialized homoclinic event array")
                .len(),
            HomoclinicEventKind::ALL.len()
        );

        let reloaded: ContinuationBranch =
            serde_json::from_str(&serialized).expect("reload continuation branch");
        assert_localized_homoclinic_neutral_saddle(&reloaded);
        assert_eq!(
            reloaded.points[1].homoclinic_events,
            branch.points[1].homoclinic_events
        );

        let mut legacy_point =
            serde_json::to_value(&branch.points[1]).expect("serialize continuation point");
        legacy_point
            .as_object_mut()
            .expect("continuation point object")
            .remove("homoclinic_events");
        let legacy_point: ContinuationPoint =
            serde_json::from_value(legacy_point).expect("load legacy continuation point");
        assert!(legacy_point.homoclinic_events.is_none());
    }

    #[test]
    fn stepped_runner_localizes_homoclinic_events() {
        let mut runner = ContinuationRunner::new(
            SyntheticHomoclinicEventProblem::default(),
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("homoclinic event runner");
        runner.run_steps(1).expect("homoclinic event step");
        assert_localized_homoclinic_neutral_saddle(&runner.take_result());
    }

    #[test]
    fn initial_tangent_runner_localizes_homoclinic_events() {
        let mut problem = SyntheticHomoclinicEventProblem::default();
        let branch = continue_with_initial_tangent(
            &mut problem,
            homoclinic_event_initial_point(),
            DVector::from_vec(vec![1.0, 1.0]),
            homoclinic_event_settings(),
        )
        .expect("initial-tangent homoclinic event continuation");
        assert_localized_homoclinic_neutral_saddle(&branch);
    }

    #[test]
    fn trusted_saved_endpoint_localizes_and_persists_a_first_step_homoclinic_event() {
        let initial = homoclinic_event_initial_point();
        let mut runner = ContinuationRunner::new_from_seed(
            SyntheticHomoclinicEventProblem {
                detect_from_initial_seed: true,
            },
            vec![initial.param_value, initial.state[0]],
            vec![1.0, 1.0],
            homoclinic_event_settings().step_size,
            homoclinic_event_settings(),
        )
        .expect("trusted saved-endpoint runner");
        runner
            .run_steps(1)
            .expect("trusted saved-endpoint first step");
        let branch = runner.take_result();
        assert!(
            branch.points[0].homoclinic_events.is_some(),
            "trusted corrected endpoints must persist their starting diagnostics"
        );
        assert_localized_homoclinic_neutral_saddle(&branch);
    }

    #[test]
    fn homoclinic_event_hook_can_skip_only_the_initial_seed_transition() {
        let mut problem = SyntheticHomoclinicEventProblem {
            detect_from_initial_seed: false,
        };
        let branch = continue_with_problem(
            &mut problem,
            homoclinic_event_initial_point(),
            homoclinic_event_settings(),
            true,
        )
        .expect("suppressed initial homoclinic event continuation");
        assert_eq!(branch.points.len(), 2);
        assert!(branch.bifurcations.is_empty());
        assert!(
            branch.points[0].homoclinic_events.is_none(),
            "an untrusted approximate seed must not persist diagnostics"
        );
        assert_eq!(branch.points[1].stability, BifurcationType::None);
        assert!(branch.points[1].param_value > 0.0);
    }

    #[test]
    fn test_runner_indices_ignore_tangent_sign_flips() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            true,
        )
        .expect("runner init");

        assert_eq!(
            runner.single_step().expect("first step"),
            SingleStepOutcome::Accepted
        );
        runner.prev_tangent[0] = -runner.prev_tangent[0];
        assert_eq!(
            runner.single_step().expect("second step"),
            SingleStepOutcome::Accepted
        );

        assert_eq!(runner.branch.indices, vec![0, 1, 2]);
    }

    #[test]
    fn test_extend_branch_with_problem_normalizes_missing_indices() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = ZeroResidualProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.2,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };

        let extended = extend_branch_with_problem(&mut problem, branch, settings, true)
            .expect("extend branch with missing indices");

        assert_eq!(extended.points.len(), 3);
        assert_eq!(extended.indices, vec![0, 1, 2]);
    }

    #[test]
    fn test_orient_extension_tangent_preserves_small_parameter_component_without_secant() {
        let mut forward_tangent = DVector::from_vec(vec![1e-12, 1.0]);
        orient_extension_tangent(&mut forward_tangent, None, true);
        assert!(
            (forward_tangent[0] - 1e-12).abs() < 1e-15,
            "Expected forward tangent parameter component to be preserved, got {}",
            forward_tangent[0]
        );

        let mut backward_tangent = DVector::from_vec(vec![1e-12, 1.0]);
        orient_extension_tangent(&mut backward_tangent, None, false);
        assert!(
            (backward_tangent[0] + 1e-12).abs() < 1e-15,
            "Expected backward tangent to be sign-oriented without parameter injection, got {}",
            backward_tangent[0]
        );
    }

    #[test]
    fn test_initial_fold_tangent_remains_in_extended_jacobian_nullspace() {
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let runner =
            ContinuationRunner::new(SimpleFoldProblem, initial_point, constant_settings(1), true)
                .expect("runner init at fold");

        let jac = DMatrix::from_row_slice(1, 2, &[-1.0, 0.0]);
        let null_residual = jac * &runner.prev_tangent;
        assert!(
            null_residual.norm() < 1e-12,
            "fold tangent left the nullspace: residual {}",
            null_residual.norm()
        );
        assert!(
            runner.prev_tangent[0].abs() < 1e-12,
            "fold tangent must have zero parameter component, got {}",
            runner.prev_tangent[0]
        );
    }

    #[test]
    fn test_palc_metric_makes_profile_tangent_normalization_mesh_independent() {
        for dimension in [1, 100] {
            let mut problem = AveragedProfileProblem { dimension };
            let aug_state = DVector::zeros(dimension + 1);
            let tangent = compute_tangent_from_problem(&mut problem, &aug_state)
                .expect("regular profile tangent");

            assert!(
                (tangent[0].abs() - 1.0 / 2.0_f64.sqrt()).abs() < 1e-10,
                "dimension {} changed parameter scaling: {}",
                dimension,
                tangent[0]
            );
            let jac = problem.extended_jacobian(&aug_state).expect("jacobian");
            assert!((jac * tangent).norm() < 1e-10);
        }
    }

    #[test]
    fn test_palc_predictor_step_is_mesh_independent() {
        let mut parameter_steps = Vec::new();
        for dimension in [1, 100] {
            let initial_point = ContinuationPoint {
                state: vec![0.0; dimension],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
                heteroclinic_events: None,
            };
            let mut problem = AveragedProfileProblem { dimension };
            let branch =
                continue_with_problem(&mut problem, initial_point, constant_settings(1), true)
                    .expect("profile continuation");
            parameter_steps.push(branch.points[1].param_value - branch.points[0].param_value);
        }

        assert!(
            (parameter_steps[0] - parameter_steps[1]).abs() < 1e-10,
            "mesh refinement changed the PALC parameter step: {:?}",
            parameter_steps
        );
        assert!((parameter_steps[0] - 0.1 / 2.0_f64.sqrt()).abs() < 1e-10);
    }

    #[test]
    fn test_palc_corrector_uses_metric_orthogonality() {
        let mut problem = AveragedProfileProblem { dimension: 2 };
        let reference = DVector::zeros(3);
        let tangent = compute_tangent_from_problem(&mut problem, &reference)
            .expect("regular profile tangent");
        let prediction = DVector::from_vec(vec![0.1, 0.0, 0.2]);
        let corrected = correct_with_problem(
            &mut problem,
            &prediction,
            &reference,
            &tangent,
            2,
            1e-12,
            1e-12,
        )
        .expect("corrector result")
        .expect("corrector convergence");

        let correction = &corrected - &prediction;
        assert!(
            palc_dot(&problem, &reference, &tangent, &correction)
                .expect("metric dot")
                .abs()
                < 1e-12
        );
        let mut residual = DVector::zeros(2);
        problem
            .residual(&corrected, &mut residual)
            .expect("residual");
        assert!(residual.norm() < 1e-12);
    }

    #[test]
    fn test_palc_corrector_damping_is_mesh_independent() {
        let mut corrected_points = Vec::new();
        for dimension in [1, 100] {
            let mut problem = AveragedProfileProblem { dimension };
            let reference = DVector::zeros(dimension + 1);
            let tangent = compute_tangent_from_problem(&mut problem, &reference)
                .expect("regular profile tangent");
            let mut prediction = DVector::from_element(dimension + 1, 2.0);
            prediction[0] = 0.0;
            let corrected = correct_with_problem(
                &mut problem,
                &prediction,
                &reference,
                &tangent,
                4,
                1e-12,
                1e-12,
            )
            .expect("corrector result")
            .expect("mesh-independent convergence");
            corrected_points.push((corrected[0], corrected[1]));
        }

        assert!((corrected_points[0].0 - corrected_points[1].0).abs() < 1e-12);
        assert!((corrected_points[0].1 - corrected_points[1].1).abs() < 1e-12);
    }

    #[test]
    fn test_palc_corrector_uses_step_tolerance_to_detect_stagnation() {
        let prediction = DVector::from_vec(vec![0.0, 1.0]);
        let reference = DVector::zeros(2);
        let tangent = DVector::from_vec(vec![1.0, 0.0]);

        let mut loose = InexactJacobianProblem { residual_calls: 0 };
        let loose_result = correct_with_problem(
            &mut loose,
            &prediction,
            &reference,
            &tangent,
            10,
            1e-12,
            0.3,
        )
        .expect("loose corrector result");
        assert!(loose_result.is_none(), "stagnation must not be accepted");

        let mut strict = InexactJacobianProblem { residual_calls: 0 };
        let strict_result = correct_with_problem(
            &mut strict,
            &prediction,
            &reference,
            &tangent,
            10,
            1e-12,
            1e-12,
        )
        .expect("strict corrector result");
        assert!(strict_result.is_none());
        assert!(
            loose.residual_calls < strict.residual_calls,
            "step tolerance should stop a stagnating correction early (loose {}, strict {})",
            loose.residual_calls,
            strict.residual_calls
        );
    }

    #[test]
    fn test_rejected_step_reduces_step_size_and_preserves_branch_prefix() {
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let mut problem = RejectingStepProblem {
            rejected_steps: 0,
            largest_accepted_parameter: 0.04,
        };
        let settings = ContinuationSettings {
            step_size: 0.2,
            min_step_size: 0.01,
            max_step_size: 0.2,
            max_steps: 5,
            corrector_steps: 4,
            corrector_tolerance: 1e-12,
            step_tolerance: 1e-12,
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, true)
            .expect("a rejected trial should not abort continuation");
        assert!(problem.rejected_steps >= 2);
        assert!(
            branch.points.len() == 2,
            "one accepted-step budget must still retry rejected trials"
        );
        assert!(branch.points[1].param_value.abs() <= 0.04);
    }

    #[test]
    fn test_runner_progress_counts_accepted_steps_not_rejected_attempts() {
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let problem = RejectingStepProblem {
            rejected_steps: 0,
            largest_accepted_parameter: 0.04,
        };
        let settings = ContinuationSettings {
            step_size: 0.2,
            min_step_size: 0.01,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-12,
            step_tolerance: 1e-12,
        };
        let mut runner = ContinuationRunner::new(problem, initial_point, settings, true)
            .expect("runner initialization");

        let progress = runner.run_steps(1).expect("one accepted step");
        assert!(runner.problem.rejected_steps >= 2);
        assert_eq!(progress.current_step, 1);
        assert!(progress.done);
        assert_eq!(runner.branch().points.len(), 2);
        assert!(runner.branch().points[1].param_value.abs() <= 0.04);
    }

    #[test]
    fn test_rank_deficient_extended_jacobian_returns_tangent_error() {
        let mut problem = SingularTangentProblem;
        let err = compute_tangent_from_problem(&mut problem, &DVector::zeros(3))
            .expect_err("non-regular solution set must not get a fabricated tangent");
        assert!(
            err.to_string().contains("rank deficient"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_nonzero_rank_multidimensional_nullspace_selects_a_true_tangent() {
        let mut problem = MultiTangentProblem;
        let aug = DVector::zeros(3);
        let tangent = compute_tangent_from_problem(&mut problem, &aug)
            .expect("nonzero-rank singular seed should select a null direction");
        let jacobian = problem.extended_jacobian(&aug).expect("Jacobian");
        assert!(
            (&jacobian * &tangent).norm() < 1e-12,
            "selected direction must remain in the full Jacobian nullspace"
        );
        assert!(tangent[0].abs() < 1e-12);
    }

    #[test]
    fn test_retained_tangent_uses_the_updated_problem_gauge() {
        let initial_point = ContinuationPoint {
            state: vec![0.0, 0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };
        let problem = UpdatingGaugeProblem {
            anchor_x: 0.0,
            anchor_y: 0.0,
            rotated: false,
        };
        let mut runner =
            ContinuationRunner::new(problem, initial_point, constant_settings(1), true)
                .expect("runner");
        runner.run_steps(1).expect("continuation step");
        assert!(
            runner.problem.rotated,
            "test gauge should rotate after acceptance"
        );
        let jacobian = runner
            .problem
            .extended_jacobian(&runner.prev_aug)
            .expect("updated Jacobian");
        assert!(
            (&jacobian * &runner.prev_tangent).norm() < 1e-12,
            "retained tangent must satisfy the updated-gauge Jacobian"
        );
    }

    #[test]
    fn test_orient_extension_tangent_with_secant_keeps_orientation_without_param_bias() {
        let mut tangent = DVector::from_vec(vec![1e-12, 1.0, 0.0]);
        let secant = DVector::from_vec(vec![-0.5, -2.0, 0.0]);

        orient_extension_tangent(&mut tangent, Some(&secant), true);

        assert!(
            tangent[0].abs() < 1e-9,
            "Expected secant-oriented tangent to preserve tiny parameter component, got {}",
            tangent[0]
        );
        assert!(
            tangent.dot(&secant) > 0.0,
            "Expected tangent to remain aligned with secant orientation"
        );
    }

    #[test]
    fn test_continuation_runner_emits_resume_state_for_endpoint() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 2,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            true,
        )
        .expect("runner init");
        runner.run_steps(2).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, 0);
        assert_eq!(min_seed.aug_state.len(), 2);
        assert_eq!(min_seed.tangent.len(), 2);
        assert!(min_seed.step_size > 0.0);

        let seed = resume.max_index_seed.expect("max seed");
        assert_eq!(seed.endpoint_index, 2);
        assert_eq!(seed.aug_state.len(), 2);
        assert_eq!(seed.tangent.len(), 2);
        assert!(seed.step_size > 0.0);
    }

    #[test]
    fn test_continuation_runner_backward_preserves_start_boundary_seed() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 2,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            false,
        )
        .expect("runner init");
        runner.run_steps(2).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, -2);
        let max_seed = resume.max_index_seed.expect("max seed");
        assert_eq!(max_seed.endpoint_index, 0);
        assert!(max_seed.step_size > 0.0);
    }

    #[test]
    fn test_continuation_runner_start_seed_uses_boundary_secant() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        // Deliberately choose an initial tangent that is not tangent to x = p.
        let initial_tangent = DVector::from_vec(vec![1.0, 0.0]);
        let mut runner = ContinuationRunner::new_with_tangent(
            LinearRelationProblem::default(),
            initial_point,
            initial_tangent,
            settings,
        )
        .expect("runner init");
        runner.run_steps(1).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, 0);

        // Expected boundary secant at minimum endpoint: point(0) - point(1)
        let p0 = &branch.points[0];
        let p1 = &branch.points[1];
        let mut secant = DVector::from_vec(vec![
            p0.param_value - p1.param_value,
            p0.state[0] - p1.state[0],
        ]);
        secant = secant.normalize();
        let seed_tangent = DVector::from_vec(min_seed.tangent);
        let alignment = seed_tangent.dot(&secant);
        assert!(
            alignment > 0.999,
            "expected min boundary seed tangent to follow accepted boundary secant, got alignment {}",
            alignment
        );
    }

    #[test]
    fn test_extension_uses_resume_seed_before_secant_fallback() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = ZeroResidualProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: Some(ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(ContinuationEndpointSeed {
                    endpoint_index: 1,
                    aug_state: vec![1.0, 0.0],
                    tangent: vec![-1.0, 0.0],
                    step_size: 0.05,
                }),
            }),
            manifold_geometry: None,
        };

        let extended = extend_branch_with_problem(&mut problem, branch, settings, true)
            .expect("extension with resume seed");
        let new_param = extended.points.last().expect("new point").param_value;
        assert!(
            (new_param - 0.95).abs() < 1e-12,
            "the saved 0.05 adaptive step should override the fresh 0.1 setting, got param {}",
            new_param
        );
    }

    #[test]
    fn test_extension_rejects_a_resume_seed_from_a_hidden_unrefined_state() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = ZeroResidualProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: Some(ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(ContinuationEndpointSeed {
                    endpoint_index: 1,
                    // This can arise when the displayed endpoint is a refined
                    // bifurcation but the saved runner state is the unrefined
                    // accepted point beyond it.
                    aug_state: vec![0.9, 0.0],
                    tangent: vec![-1.0, 0.0],
                    step_size: 0.05,
                }),
            }),
            manifold_geometry: None,
        };

        let extended = extend_branch_with_problem(&mut problem, branch, settings, true)
            .expect("secant fallback from the visible endpoint");
        let new_param = extended.points.last().expect("new point").param_value;
        assert!(
            new_param > 1.0,
            "a stale hidden-state seed must not continue from behind the visible endpoint: {}",
            new_param
        );
    }

    #[test]
    fn test_cap_extension_step_size_limits_predictor_to_local_secant_scale() {
        let mut settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 20,
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
    fn test_resume_extension_caps_first_step_to_local_secant_scale() {
        let settings = ContinuationSettings {
            step_size: 1.0,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 1,
            corrector_steps: 8,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        };

        let mut problem = LinearRelationProblem::default();
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
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: Some(ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(ContinuationEndpointSeed {
                    endpoint_index: 1,
                    aug_state: vec![1.01, 1.01],
                    tangent: vec![1.0, 1.0],
                    step_size: 0.2,
                }),
            }),
            manifold_geometry: None,
        };

        let extended =
            extend_branch_with_problem(&mut problem, branch, settings, true).expect("extension");
        let endpoint = extended.points[1].param_value;
        let next = extended.points[2].param_value;
        let delta = (next - endpoint).abs();
        assert!(
            delta < 0.05,
            "resume-seeded extension should stay local to endpoint secant scale, got {}",
            delta
        );
    }

    #[test]
    fn test_extension_first_step_locality_guard_prevents_large_nonlocal_jump() {
        let settings = ContinuationSettings {
            step_size: 1.0,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let mut problem = LinearRelationProblem::default();
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
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };

        let extended =
            extend_branch_with_problem(&mut problem, branch, settings, true).expect("extension");
        let endpoint = extended.points[1].param_value;
        let next = extended.points[2].param_value;
        let delta = (next - endpoint).abs();
        assert!(
            delta < 0.05,
            "first extension step should remain local to the endpoint secant scale, got {}",
            delta
        );
    }

    #[test]
    fn test_extend_branch_matches_longer_continuation() {
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let mut full_problem = LinearRelationProblem::default();
        let full_branch = continue_with_problem(
            &mut full_problem,
            initial_point.clone(),
            constant_settings(4),
            true,
        )
        .expect("full continuation");

        let mut short_problem = LinearRelationProblem::default();
        let short_branch = continue_with_problem(
            &mut short_problem,
            initial_point,
            constant_settings(2),
            true,
        )
        .expect("short continuation");

        let mut extend_problem = LinearRelationProblem::default();
        let extended_branch = extend_branch_with_problem(
            &mut extend_problem,
            short_branch,
            constant_settings(2),
            true,
        )
        .expect("extended continuation");

        assert_eq!(extended_branch.points.len(), full_branch.points.len());
        assert_eq!(extended_branch.indices, full_branch.indices);

        for (idx, (extended, full)) in extended_branch
            .points
            .iter()
            .zip(full_branch.points.iter())
            .enumerate()
        {
            let param_delta = (extended.param_value - full.param_value).abs();
            assert!(
                param_delta < 1e-10,
                "param mismatch at point {}: {} vs {}",
                idx,
                extended.param_value,
                full.param_value
            );
            assert_eq!(extended.state.len(), full.state.len());
            for (state_idx, (lhs, rhs)) in extended.state.iter().zip(full.state.iter()).enumerate()
            {
                let state_delta = (lhs - rhs).abs();
                assert!(
                    state_delta < 1e-10,
                    "state mismatch at point {} idx {}: {} vs {}",
                    idx,
                    state_idx,
                    lhs,
                    rhs
                );
            }
        }
    }

    fn side_endpoint_and_neighbor(branch: &ContinuationBranch, forward: bool) -> (usize, usize) {
        let endpoint_pos = if forward {
            branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("endpoint")
        } else {
            branch
                .indices
                .iter()
                .enumerate()
                .min_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("endpoint")
        };

        let neighbor_pos = if forward {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_pos)
                .max_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("neighbor")
        } else {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_pos)
                .min_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("neighbor")
        };

        (endpoint_pos, neighbor_pos)
    }

    #[test]
    fn test_extend_branch_respects_signed_index_side_for_all_direction_combinations() {
        let cases = [
            ("init-forward/extend-forward", true, true),
            ("init-forward/extend-backward", true, false),
            ("init-backward/extend-forward", false, true),
            ("init-backward/extend-backward", false, false),
        ];

        for (label, init_forward, extend_forward) in cases {
            let initial_point = ContinuationPoint {
                state: vec![0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
                heteroclinic_events: None,
            };

            let mut init_problem = LinearRelationProblem::default();
            let seed = continue_with_problem(
                &mut init_problem,
                initial_point,
                constant_settings(2),
                init_forward,
            )
            .unwrap_or_else(|err| panic!("{}: init continuation failed: {}", label, err));

            let orig_len = seed.points.len();
            let orig_min = *seed.indices.iter().min().expect("min index");
            let orig_max = *seed.indices.iter().max().expect("max index");
            let (endpoint_pos, neighbor_pos) = side_endpoint_and_neighbor(&seed, extend_forward);
            let endpoint_param = seed.points[endpoint_pos].param_value;
            let neighbor_param = seed.points[neighbor_pos].param_value;
            let secant_param = endpoint_param - neighbor_param;
            assert!(
                secant_param.abs() > 1e-12,
                "{}: expected non-degenerate secant",
                label
            );

            let mut extend_problem = LinearRelationProblem::default();
            let extended = extend_branch_with_problem(
                &mut extend_problem,
                seed,
                constant_settings(1),
                extend_forward,
            )
            .unwrap_or_else(|err| panic!("{}: extension failed: {}", label, err));

            assert_eq!(
                extended.points.len(),
                orig_len + 1,
                "{}: expected exactly one new point",
                label
            );
            assert_eq!(
                extended.indices.len(),
                orig_len + 1,
                "{}: index count should track point count",
                label
            );

            let new_pos = orig_len;
            let new_index = extended.indices[new_pos];
            let new_param = extended.points[new_pos].param_value;
            let param_delta = new_param - endpoint_param;

            if extend_forward {
                assert_eq!(
                    new_index,
                    orig_max + 1,
                    "{}: forward extension should target max-index side",
                    label
                );
                assert_eq!(
                    *extended.indices.iter().min().expect("min index"),
                    orig_min,
                    "{}: forward extension should preserve min index bound",
                    label
                );
            } else {
                assert_eq!(
                    new_index,
                    orig_min - 1,
                    "{}: backward extension should target min-index side",
                    label
                );
                assert_eq!(
                    *extended.indices.iter().max().expect("max index"),
                    orig_max,
                    "{}: backward extension should preserve max index bound",
                    label
                );
            }

            assert!(
                param_delta * secant_param > 0.0,
                "{}: extension doubled back (delta={}, secant={})",
                label,
                param_delta,
                secant_param
            );
        }
    }
}
