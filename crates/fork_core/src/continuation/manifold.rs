use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::SVD;
use nalgebra::DMatrix;
use num_complex::Complex;

use crate::continuation::periodic::{
    compute_cycle_monodromy_data, floquet_real_eigenvector_from_transfers, CollocationCoefficients,
};
use crate::continuation::types::{
    default_manifold_alpha_max, default_manifold_alpha_min, default_manifold_delta_alpha_max,
    default_manifold_delta_alpha_min, default_manifold_delta_min, default_manifold_dt,
    default_manifold_eps, default_manifold_leaf_delta, default_manifold_ring_points,
    BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, Manifold1DSettings,
    Manifold2DProfile, Manifold2DSettings, ManifoldBounds, ManifoldCurveGeometry,
    ManifoldCurveResumeState, ManifoldCurveSolverDiagnostics, ManifoldCycle2DAlgorithm,
    ManifoldCycle2DSettings, ManifoldDirection, ManifoldEigenKind, ManifoldGeometry,
    ManifoldHkoFiberResumeState, ManifoldMapDomainCursor, ManifoldRingDiagnostic,
    ManifoldStability, ManifoldSurfaceGeometry, ManifoldSurfaceResumeState,
    ManifoldSurfaceSolverDiagnostics, ManifoldTerminationCaps,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{
    compute_jacobian, compute_system_jacobian_with_periodicity, solve_equilibrium,
    solve_equilibrium_with_periodicity, NewtonSettings, SystemKind,
};
use crate::state_periodicity::StatePeriodicity;
use crate::traits::DynamicalSystem;

const EIG_IM_TOL: f64 = 1e-8;
const NORM_EPS: f64 = 1e-12;
const DEFAULT_MESH_MIN_EDGE_FACTOR: f64 = 0.25;
const DEFAULT_MESH_MAX_EDGE_FACTOR: f64 = 1.0;
const DEFAULT_GEODESIC_ALPHA_MIN: f64 = 0.3;
const DEFAULT_GEODESIC_ALPHA_MAX: f64 = 0.4;
const DEFAULT_GEODESIC_DELTA_ALPHA_MIN: f64 = 0.1;
const DEFAULT_GEODESIC_DELTA_ALPHA_MAX: f64 = 1.0;
const LEAF_DELTA_SHRINK: f64 = 0.5;
const LEAF_DELTA_GROW: f64 = 2.0;
const LEAF_REFINE_ATTEMPTS: usize = 12;
#[cfg(test)]
const LEAF_TAU_NEWTON_MAX_ITERS: usize = 24;
#[cfg(test)]
const LEAF_TAU_NEWTON_MAX_STEP: f64 = 0.25;
#[cfg(test)]
const LEAF_TAU_DERIV_FD_EPS: f64 = 1e-4;
const LEAF_PLANE_DERIV_EPS: f64 = 1e-12;
#[cfg(test)]
const LEAF_PLANE_BISECT_ITERS: usize = 16;
const LEAF_CONTINUATION_NEWTON_MAX_ITERS: usize = 16;
const LEAF_CONTINUATION_EVENT_MAX_ITERS: usize = 24;
const LEAF_CONTINUATION_MIN_STEP: f64 = 1e-6;
const LEAF_CONTINUATION_MAX_STEP: f64 = 5e-2;
const LEAF_CONTINUATION_GROWTH: f64 = 1.35;
const LEAF_DT_SHRINK: f64 = 0.5;
const LEAF_DT_RETRIES: usize = 3;
const LEAF_DT_MIN_FACTOR: f64 = 1e-3;
const LEAF_RETRY_MAX_FAILURES: usize = 4;
const LEAF_SEGMENT_SWITCH_EPS: f64 = 1e-4;
#[cfg(test)]
const LEAF_SEGMENT_SWITCH_MAX: usize = 64;
const RING_TURN_REPARAM_TRIGGER_RAD: f64 = 170.0_f64.to_radians();
#[cfg(test)]
const RING_OUTLIER_DISPLACEMENT_FACTOR: f64 = 4.0;
#[cfg(test)]
const RING_OUTLIER_MIN_SCALE: f64 = 8.0;
#[cfg(test)]
const RING_OUTLIER_MAX_SCALE: f64 = 64.0;
#[cfg(test)]
const RING_OUTLIER_PASSES: usize = 2;
#[cfg(test)]
const TAU_SWITCH_EPS: f64 = 1e-6;
const LEAF_SIGN_EPS_SCALE: f64 = 1e-14;
const SOURCE_PARAM_MONO_EPS: f64 = 1e-6;
const MAP_MANIFOLD_REAL_TOL: f64 = 1e-8;
const MAP_MANIFOLD_SIDE_TOL: f64 = 1e-6;
const MAP_PREIMAGE_NEWTON_TOL: f64 = 1e-10;
const MAP_PREIMAGE_NEWTON_MAX_ITERS: usize = 24;
const MAP_DOMAIN_ALPHA_MAX: f64 = 0.3;
const MAP_DOMAIN_DELTA_MAX_FACTOR: f64 = 1.5;
const MAP_DOMAIN_MAX_REFINEMENT_PASSES: usize = 12;
const MAP_DOMAIN_MAX_INSERTIONS_PER_PASS: usize = 256;
const ISOCHRON_BVP_NEWTON_TOL: f64 = 1e-8;
const ISOCHRON_BVP_NEWTON_MAX_ITERS: usize = 8;
const ISOCHRON_BVP_LINE_SEARCH_STEPS: usize = 8;
const ISOCHRON_MAX_SEGMENT_EXPANSION: f64 = 1.25;
const ISOCHRON_MAX_RETURN_SEGMENTS: usize = 256;

#[derive(Clone)]
struct RealEigenMode {
    index: usize,
    value: Complex<f64>,
    vector: Vec<f64>,
}

#[derive(Clone)]
struct PreparedManifold1DSource {
    state: Vec<f64>,
    cycle_points: Vec<Vec<f64>>,
    mode: RealEigenMode,
    correction_norm: f64,
    least_period: Option<usize>,
}

struct ManifoldCurveSolve {
    points: Vec<Vec<f64>>,
    arclength: Vec<f64>,
    diagnostics: ManifoldCurveSolverDiagnostics,
    resume_state: Option<ManifoldCurveResumeState>,
}

#[derive(Clone)]
struct ComplexEigenMode {
    index: usize,
    value: Complex<f64>,
    vector: Vec<Complex<f64>>,
}

/// Compute one-dimensional stable/unstable manifolds of a flow equilibrium.
pub fn continue_manifold_eq_1d(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
) -> Result<Vec<ContinuationBranch>> {
    continue_manifold_eq_1d_with_kind_and_periodicity(
        system,
        SystemKind::Flow,
        equilibrium_state,
        settings,
        &StatePeriodicity::none(),
    )
}

/// Compute one-dimensional stable/unstable manifolds of a flow equilibrium or map cycle.
pub fn continue_manifold_eq_1d_with_kind(
    system: &mut EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
) -> Result<Vec<ContinuationBranch>> {
    continue_manifold_eq_1d_with_kind_and_periodicity(
        system,
        kind,
        equilibrium_state,
        settings,
        &StatePeriodicity::none(),
    )
}

/// Compute a one-dimensional stable/unstable manifold with periodic state metadata.
pub fn continue_manifold_eq_1d_with_kind_and_periodicity(
    system: &mut EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
    periodicity: &StatePeriodicity,
) -> Result<Vec<ContinuationBranch>> {
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System dimension must be greater than zero.");
    }
    if equilibrium_state.len() != dim {
        bail!(
            "Equilibrium dimension mismatch: expected {}, got {}.",
            dim,
            equilibrium_state.len()
        );
    }
    validate_manifold_1d_settings(dim, kind, &settings)?;

    let source = prepare_manifold_1d_source(
        system,
        kind,
        equilibrium_state,
        settings.stability,
        settings.eig_index,
        periodicity,
    )?;
    let mut directions = Vec::new();
    match settings.direction {
        ManifoldDirection::Both => {
            directions.push(ManifoldDirection::Plus);
            directions.push(ManifoldDirection::Minus);
        }
        ManifoldDirection::Plus => directions.push(ManifoldDirection::Plus),
        ManifoldDirection::Minus => directions.push(ManifoldDirection::Minus),
    }

    match kind {
        SystemKind::Flow => {
            continue_manifold_eq_1d_flow(system, &source, settings, &directions, periodicity)
        }
        SystemKind::Map { iterations } => continue_manifold_eq_1d_map(
            system,
            &source,
            settings,
            iterations,
            &directions,
            periodicity,
        ),
    }
}

/// Extend an existing one-dimensional manifold branch by an additional arclength.
pub fn extend_manifold_eq_1d_with_kind_and_periodicity(
    system: &mut EquationSystem,
    kind: SystemKind,
    branch: ContinuationBranch,
    mut settings: Manifold1DSettings,
    periodicity: &StatePeriodicity,
) -> Result<ContinuationBranch> {
    let dim = system.equations.len();
    validate_manifold_1d_settings(dim, kind, &settings)?;
    let (branch_stability, branch_direction, branch_eig_index, map_iterations, cycle_point_index) =
        match &branch.branch_type {
            BranchType::ManifoldEq1D {
                stability,
                direction,
                eig_index,
                map_iterations,
                cycle_point_index,
                ..
            } => (
                *stability,
                *direction,
                *eig_index,
                *map_iterations,
                *cycle_point_index,
            ),
            _ => bail!("Only a 1D equilibrium manifold branch can be extended."),
        };
    if settings.stability != branch_stability {
        bail!("Extension stability must match the existing manifold branch.");
    }
    if settings.direction != branch_direction {
        bail!("Extension direction must match the existing manifold branch.");
    }
    if settings.direction == ManifoldDirection::Both {
        bail!("A stored 1D manifold branch must have a single directed half-branch.");
    }
    if settings
        .eig_index
        .is_some_and(|eig_index| eig_index != branch_eig_index)
    {
        bail!("Extension eigen index must match the existing manifold branch.");
    }
    settings.eig_index = Some(branch_eig_index);
    match (kind, map_iterations) {
        (SystemKind::Flow, None) => {}
        (SystemKind::Flow, Some(_)) => {
            bail!("Extension system kind does not match the existing map manifold branch.");
        }
        (SystemKind::Map { iterations }, Some(stored_iterations))
            if iterations == stored_iterations => {}
        (SystemKind::Map { .. }, _) => {
            bail!("Extension map cycle length does not match the existing branch.");
        }
    }
    if branch.points.len() < 2 {
        bail!("A manifold branch needs at least two points before it can be extended.");
    }

    match kind {
        SystemKind::Flow => {
            let endpoint = branch
                .points
                .last()
                .map(|point| point.state.clone())
                .ok_or_else(|| anyhow!("Manifold branch has no endpoint."))?;
            let solved = build_flow_manifold_extension(
                system,
                &endpoint,
                settings.stability,
                &settings,
                periodicity,
            )?;
            merge_manifold_curve_extension(branch, solved, None)
        }
        SystemKind::Map { .. } => {
            let mut branch = branch;
            let resume_state = match branch.manifold_geometry.as_ref() {
                Some(ManifoldGeometry::Curve(geometry)) => geometry.resume_state.clone(),
                _ => None,
            };
            let resume_state = match resume_state {
                Some(state @ ManifoldCurveResumeState::Map { .. }) => state,
                _ => {
                    replay_map_manifold_resume_state(system, kind, &branch, &settings, periodicity)?
                }
            };
            let endpoint = branch
                .points
                .last()
                .map(|point| point.state.clone())
                .ok_or_else(|| anyhow!("Map manifold branch has no endpoint."))?;
            let solved = build_map_manifold_extension(
                system,
                &endpoint,
                settings.stability,
                &settings,
                periodicity,
                resume_state,
            )?;
            let local_source_arclength = solved.arclength.clone();
            let source_extension = if cycle_point_index.unwrap_or(0) > 0 {
                if let Some(ManifoldGeometry::Curve(geometry)) = branch.manifold_geometry.as_mut() {
                    geometry.source_arclength = None;
                }
                None
            } else {
                Some(local_source_arclength)
            };
            merge_manifold_curve_extension(branch, solved, source_extension)
        }
    }
}

fn validate_manifold_1d_settings(
    dim: usize,
    kind: SystemKind,
    settings: &Manifold1DSettings,
) -> Result<()> {
    if !settings.eps.is_finite() || settings.eps <= 0.0 {
        bail!("Manifold epsilon must be a finite positive number.");
    }
    if !settings.target_arclength.is_finite() || settings.target_arclength <= 0.0 {
        bail!("Target arclength must be a finite positive number.");
    }
    if kind.is_flow() && (!settings.integration_dt.is_finite() || settings.integration_dt == 0.0) {
        bail!("Integration dt must be finite and non-zero.");
    }
    if settings.caps.max_steps == 0 {
        bail!("Manifold max_steps must be greater than zero.");
    }
    if settings.caps.max_points < 2 {
        bail!("Manifold max_points must be at least two.");
    }
    if kind.is_flow() && (!settings.caps.max_time.is_finite() || settings.caps.max_time <= 0.0) {
        bail!("Manifold max_time must be a finite positive number.");
    }
    if kind.is_map() && settings.caps.max_iterations == Some(0) {
        bail!("Map manifold max_iterations must be greater than zero.");
    }
    if let Some(bounds) = settings.bounds.as_ref() {
        if bounds.min.len() != dim || bounds.max.len() != dim {
            bail!(
                "Manifold bounds dimension mismatch: expected {}, got min={} and max={}.",
                dim,
                bounds.min.len(),
                bounds.max.len()
            );
        }
        for index in 0..dim {
            if !bounds.min[index].is_finite() || !bounds.max[index].is_finite() {
                bail!("Manifold bounds must be finite.");
            }
            if bounds.min[index] > bounds.max[index] {
                bail!(
                    "Manifold bound min exceeds max at coordinate {}.",
                    index + 1
                );
            }
        }
    }
    Ok(())
}

fn continue_manifold_eq_1d_flow(
    system: &mut EquationSystem,
    source: &PreparedManifold1DSource,
    settings: Manifold1DSettings,
    directions: &[ManifoldDirection],
    periodicity: &StatePeriodicity,
) -> Result<Vec<ContinuationBranch>> {
    let mut branches = Vec::new();
    for direction in directions.iter().copied() {
        let solved = build_flow_manifold_curve(system, source, direction, &settings, periodicity)?;

        branches.push(build_eq_1d_branch(
            &solved.points,
            &solved.arclength,
            None,
            Some(solved.diagnostics),
            solved.resume_state,
            settings.stability,
            direction,
            source.mode.index,
            settings.caps,
            "trajectory_arclength_event",
            None,
            None,
        ));
    }
    Ok(branches)
}

fn continue_manifold_eq_1d_map(
    system: &mut EquationSystem,
    source: &PreparedManifold1DSource,
    settings: Manifold1DSettings,
    map_iterations: usize,
    directions: &[ManifoldDirection],
    periodicity: &StatePeriodicity,
) -> Result<Vec<ContinuationBranch>> {
    if map_iterations == 0 {
        bail!("Map iteration count must be greater than zero.");
    }

    if source.cycle_points.is_empty() {
        bail!("Map cycle seed generation failed: no cycle points available.");
    }
    let dim = system.equations.len();
    let representative = &source.state;
    let growth_iterations = if source.mode.value.re < 0.0 {
        map_iterations
            .checked_mul(2)
            .ok_or_else(|| anyhow!("Map manifold growth iteration count overflow."))?
    } else {
        map_iterations
    };
    let mut branches = Vec::new();
    for direction in directions.iter().copied() {
        let sign = if direction == ManifoldDirection::Minus {
            -1.0
        } else {
            1.0
        };
        let mut seed = representative.clone();
        for i in 0..dim {
            seed[i] += sign * settings.eps * source.mode.vector[i];
        }
        periodicity.wrap_state(&mut seed);

        let base = build_map_manifold_curve(
            system,
            &seed,
            representative,
            settings.stability,
            growth_iterations,
            settings.target_arclength,
            settings.caps,
            settings.bounds.as_ref(),
            periodicity,
            source.correction_norm,
            source.least_period,
        )?;

        for cycle_point_index in 0..map_iterations {
            let points = if cycle_point_index == 0 {
                base.points.clone()
            } else {
                propagate_curve_by_map_steps(
                    system,
                    &base.points,
                    cycle_point_index,
                    settings.bounds.as_ref(),
                    periodicity,
                )
                .ok_or_else(|| {
                    anyhow!(
                        "Map manifold phase {} could not be propagated.",
                        cycle_point_index + 1
                    )
                })?
            };
            if points.len() < 2 {
                bail!(
                    "Map manifold phase {} contains no meaningful growth.",
                    cycle_point_index + 1
                );
            }
            let arclength = cumulative_polyline_arclength(&points, periodicity);
            let source_arclength = cycle_component_arclength(&base.arclength, points.len());
            let mut diagnostics = base.diagnostics.clone();
            diagnostics.achieved_arclength = *arclength.last().unwrap_or(&0.0);
            let resume_state = if cycle_point_index == 0 {
                base.resume_state.clone()
            } else {
                propagate_map_resume_state(
                    system,
                    base.resume_state.as_ref(),
                    cycle_point_index,
                    periodicity,
                )?
            };

            branches.push(build_eq_1d_branch(
                &points,
                &arclength,
                Some(&source_arclength),
                Some(diagnostics),
                resume_state,
                settings.stability,
                direction,
                source.mode.index,
                settings.caps,
                "map_fundamental_domain",
                Some(map_iterations),
                Some(cycle_point_index),
            ));
        }
    }
    Ok(branches)
}

fn propagate_map_resume_state(
    system: &EquationSystem,
    resume_state: Option<&ManifoldCurveResumeState>,
    steps: usize,
    periodicity: &StatePeriodicity,
) -> Result<Option<ManifoldCurveResumeState>> {
    let Some(ManifoldCurveResumeState::Map {
        version,
        cycle_anchor,
        active_domain,
        pending_points,
        cursor,
        spacing_target,
        map_step_iterations,
        growth_iterations,
    }) = resume_state
    else {
        return Ok(None);
    };
    let propagate_point = |point: &[f64]| -> Result<Vec<f64>> {
        apply_map_iterates_with_periodicity(system, point, steps, periodicity)
            .ok_or_else(|| anyhow!("Map manifold resume state propagation was non-finite."))
    };
    let propagated_anchor = propagate_point(cycle_anchor)?;
    let propagated_domain = active_domain
        .iter()
        .map(|point| propagate_point(point))
        .collect::<Result<Vec<_>>>()?;
    let propagated_pending = pending_points
        .as_ref()
        .map(|points| {
            points
                .iter()
                .map(|point| propagate_point(point))
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?;
    Ok(Some(ManifoldCurveResumeState::Map {
        version: *version,
        cycle_anchor: propagated_anchor,
        active_domain: propagated_domain,
        pending_points: propagated_pending,
        cursor: cursor.clone(),
        spacing_target: *spacing_target,
        map_step_iterations: *map_step_iterations,
        growth_iterations: *growth_iterations,
    }))
}

fn build_eq_1d_branch(
    points: &[Vec<f64>],
    arclength: &[f64],
    source_arclength: Option<&[f64]>,
    solver_diagnostics: Option<ManifoldCurveSolverDiagnostics>,
    resume_state: Option<ManifoldCurveResumeState>,
    stability: ManifoldStability,
    direction: ManifoldDirection,
    eig_index: usize,
    caps: ManifoldTerminationCaps,
    method: &str,
    map_iterations: Option<usize>,
    cycle_point_index: Option<usize>,
) -> ContinuationBranch {
    let dim = points.first().map_or(0, |point| point.len());
    let branch_points: Vec<ContinuationPoint> = points
        .iter()
        .enumerate()
        .map(|(idx, point)| ContinuationPoint {
            state: point.clone(),
            param_value: arclength.get(idx).copied().unwrap_or(0.0),
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        })
        .collect();
    let geometry = ManifoldGeometry::Curve(ManifoldCurveGeometry {
        dim,
        points_flat: flatten_points(points),
        arclength: arclength.to_vec(),
        direction,
        source_arclength: source_arclength.map(|values| values.to_vec()),
        solver_diagnostics,
        resume_state,
    });
    let indices: Vec<i32> = (0..branch_points.len() as i32).collect();
    ContinuationBranch {
        points: branch_points,
        bifurcations: Vec::new(),
        indices,
        branch_type: BranchType::ManifoldEq1D {
            stability,
            direction,
            eig_index,
            method: method.to_string(),
            caps,
            map_iterations,
            cycle_point_index,
        },
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: Some(geometry),
    }
}

fn profile_f64_matches(value: f64, baseline_default: f64) -> bool {
    let baseline_tol = baseline_default.abs().max(1.0) * 1e-12;
    value.is_finite() && (value - baseline_default).abs() <= baseline_tol
}

fn eq_2d_settings_use_baseline_profile_defaults(settings: &Manifold2DSettings) -> bool {
    profile_f64_matches(settings.initial_radius, default_manifold_eps())
        && profile_f64_matches(settings.leaf_delta, default_manifold_leaf_delta())
        && profile_f64_matches(settings.delta_min, default_manifold_delta_min())
        && settings.ring_points == default_manifold_ring_points()
        && settings.min_spacing <= 0.0
        && settings.max_spacing <= 0.0
        && profile_f64_matches(settings.alpha_min, default_manifold_alpha_min())
        && profile_f64_matches(settings.alpha_max, default_manifold_alpha_max())
        && profile_f64_matches(settings.delta_alpha_min, default_manifold_delta_alpha_min())
        && profile_f64_matches(settings.delta_alpha_max, default_manifold_delta_alpha_max())
        && profile_f64_matches(settings.integration_dt, default_manifold_dt())
}

fn cycle_2d_settings_use_baseline_profile_defaults(settings: &ManifoldCycle2DSettings) -> bool {
    profile_f64_matches(settings.initial_radius, default_manifold_eps())
        && profile_f64_matches(settings.leaf_delta, default_manifold_leaf_delta())
        && profile_f64_matches(settings.delta_min, default_manifold_delta_min())
        && settings.ring_points == default_manifold_ring_points()
        && settings.min_spacing <= 0.0
        && settings.max_spacing <= 0.0
        && profile_f64_matches(settings.alpha_min, default_manifold_alpha_min())
        && profile_f64_matches(settings.alpha_max, default_manifold_alpha_max())
        && profile_f64_matches(settings.delta_alpha_min, default_manifold_delta_alpha_min())
        && profile_f64_matches(settings.delta_alpha_max, default_manifold_delta_alpha_max())
        && profile_f64_matches(settings.integration_dt, default_manifold_dt())
}

fn apply_profile_f64(
    slot: &mut f64,
    baseline_default: f64,
    profile_value: f64,
    replace_baseline_defaults: bool,
) {
    if !slot.is_finite()
        || *slot <= 0.0
        || (replace_baseline_defaults && profile_f64_matches(*slot, baseline_default))
    {
        *slot = profile_value;
    }
}

fn apply_profile_usize(
    slot: &mut usize,
    baseline_default: usize,
    profile_value: usize,
    replace_baseline_defaults: bool,
) {
    if *slot == 0 || (replace_baseline_defaults && *slot == baseline_default) {
        *slot = profile_value;
    }
}

fn apply_eq_2d_profile(settings: &mut Manifold2DSettings) {
    let Some(profile) = settings.profile else {
        return;
    };
    let replace_baseline_defaults = eq_2d_settings_use_baseline_profile_defaults(settings);
    let apply = |slot: &mut f64, baseline_default: f64, profile_value: f64| {
        apply_profile_f64(
            slot,
            baseline_default,
            profile_value,
            replace_baseline_defaults,
        );
    };
    let apply_usize = |slot: &mut usize, baseline_default: usize, profile_value: usize| {
        apply_profile_usize(
            slot,
            baseline_default,
            profile_value,
            replace_baseline_defaults,
        );
    };
    match profile {
        Manifold2DProfile::LocalPreview => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 1e-3);
            apply(
                &mut settings.leaf_delta,
                default_manifold_leaf_delta(),
                2e-3,
            );
            apply(&mut settings.delta_min, default_manifold_delta_min(), 1e-3);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                48,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 1e-2);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.00134;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.004;
            }
            apply(
                &mut settings.alpha_min,
                default_manifold_alpha_min(),
                DEFAULT_GEODESIC_ALPHA_MIN,
            );
            apply(
                &mut settings.alpha_max,
                default_manifold_alpha_max(),
                DEFAULT_GEODESIC_ALPHA_MAX,
            );
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                DEFAULT_GEODESIC_DELTA_ALPHA_MIN,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                DEFAULT_GEODESIC_DELTA_ALPHA_MAX,
            );
        }
        Manifold2DProfile::AdaptiveGlobal => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 0.2);
            apply(&mut settings.leaf_delta, default_manifold_leaf_delta(), 0.2);
            apply(&mut settings.delta_min, default_manifold_delta_min(), 0.001);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                32,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 5e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.05;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.5;
            }
            apply(&mut settings.alpha_min, default_manifold_alpha_min(), 0.3);
            apply(&mut settings.alpha_max, default_manifold_alpha_max(), 0.4);
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                0.01,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                1.0,
            );
            settings.caps.max_steps = settings.caps.max_steps.max(1500);
            settings.caps.max_time = settings.caps.max_time.max(100.0);
        }
        Manifold2DProfile::LorenzGlobalKo => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 1.0);
            apply(&mut settings.leaf_delta, default_manifold_leaf_delta(), 1.0);
            apply(&mut settings.delta_min, default_manifold_delta_min(), 0.01);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                20,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 1e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.25;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 2.0;
            }
            apply(&mut settings.alpha_min, default_manifold_alpha_min(), 0.3);
            apply(&mut settings.alpha_max, default_manifold_alpha_max(), 0.4);
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                0.01,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                1.0,
            );
            settings.caps.max_steps = settings.caps.max_steps.max(150);
            settings.caps.max_time = settings.caps.max_time.max(50.0);
        }
    }
}

fn apply_cycle_2d_profile(settings: &mut ManifoldCycle2DSettings) {
    let Some(profile) = settings.profile else {
        return;
    };
    let replace_baseline_defaults = cycle_2d_settings_use_baseline_profile_defaults(settings);
    let apply = |slot: &mut f64, baseline_default: f64, profile_value: f64| {
        apply_profile_f64(
            slot,
            baseline_default,
            profile_value,
            replace_baseline_defaults,
        );
    };
    let apply_usize = |slot: &mut usize, baseline_default: usize, profile_value: usize| {
        apply_profile_usize(
            slot,
            baseline_default,
            profile_value,
            replace_baseline_defaults,
        );
    };
    match profile {
        Manifold2DProfile::LocalPreview => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 1e-3);
            apply(
                &mut settings.leaf_delta,
                default_manifold_leaf_delta(),
                2e-3,
            );
            apply(&mut settings.delta_min, default_manifold_delta_min(), 1e-3);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                48,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 1e-2);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.00134;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.004;
            }
            apply(
                &mut settings.alpha_min,
                default_manifold_alpha_min(),
                DEFAULT_GEODESIC_ALPHA_MIN,
            );
            apply(
                &mut settings.alpha_max,
                default_manifold_alpha_max(),
                DEFAULT_GEODESIC_ALPHA_MAX,
            );
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                DEFAULT_GEODESIC_DELTA_ALPHA_MIN,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                DEFAULT_GEODESIC_DELTA_ALPHA_MAX,
            );
        }
        Manifold2DProfile::AdaptiveGlobal => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 0.2);
            apply(&mut settings.leaf_delta, default_manifold_leaf_delta(), 0.2);
            apply(&mut settings.delta_min, default_manifold_delta_min(), 0.001);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                32,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 5e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.05;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.5;
            }
            apply(&mut settings.alpha_min, default_manifold_alpha_min(), 0.3);
            apply(&mut settings.alpha_max, default_manifold_alpha_max(), 0.4);
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                0.01,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                1.0,
            );
            settings.caps.max_steps = settings.caps.max_steps.max(1500);
            settings.caps.max_time = settings.caps.max_time.max(100.0);
        }
        Manifold2DProfile::LorenzGlobalKo => {
            apply(&mut settings.initial_radius, default_manifold_eps(), 1.0);
            apply(&mut settings.leaf_delta, default_manifold_leaf_delta(), 1.0);
            apply(&mut settings.delta_min, default_manifold_delta_min(), 0.01);
            apply_usize(
                &mut settings.ring_points,
                default_manifold_ring_points(),
                20,
            );
            apply(&mut settings.integration_dt, default_manifold_dt(), 1e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.25;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 2.0;
            }
            apply(&mut settings.alpha_min, default_manifold_alpha_min(), 0.3);
            apply(&mut settings.alpha_max, default_manifold_alpha_max(), 0.4);
            apply(
                &mut settings.delta_alpha_min,
                default_manifold_delta_alpha_min(),
                0.01,
            );
            apply(
                &mut settings.delta_alpha_max,
                default_manifold_delta_alpha_max(),
                1.0,
            );
            settings.caps.max_steps = settings.caps.max_steps.max(150);
            settings.caps.max_time = settings.caps.max_time.max(50.0);
        }
    }
}

fn growth_controls_from_eq_settings(settings: &Manifold2DSettings) -> SurfaceGrowthControls {
    let delta = settings.leaf_delta.max(1e-12);
    let min_spacing = if settings.min_spacing > 0.0 {
        settings.min_spacing
    } else {
        DEFAULT_MESH_MIN_EDGE_FACTOR * delta
    };
    let max_spacing = if settings.max_spacing > 0.0 {
        settings.max_spacing.max(min_spacing * 1.1)
    } else {
        DEFAULT_MESH_MAX_EDGE_FACTOR * delta
    };
    SurfaceGrowthControls {
        delta_min: settings.delta_min.max(1e-12),
        min_spacing,
        max_spacing,
        alpha_min: settings.alpha_min.max(1e-6),
        alpha_max: settings.alpha_max.max(settings.alpha_min.max(1e-6) + 1e-6),
        delta_alpha_min: settings.delta_alpha_min.max(1e-6),
        delta_alpha_max: settings
            .delta_alpha_max
            .max(settings.delta_alpha_min.max(1e-6) + 1e-6),
    }
}

fn growth_controls_from_cycle_settings(
    settings: &ManifoldCycle2DSettings,
) -> SurfaceGrowthControls {
    let delta = settings.leaf_delta.max(1e-12);
    let min_spacing = if settings.min_spacing > 0.0 {
        settings.min_spacing
    } else {
        DEFAULT_MESH_MIN_EDGE_FACTOR * delta
    };
    let max_spacing = if settings.max_spacing > 0.0 {
        settings.max_spacing.max(min_spacing * 1.1)
    } else {
        DEFAULT_MESH_MAX_EDGE_FACTOR * delta
    };
    SurfaceGrowthControls {
        delta_min: settings.delta_min.max(1e-12),
        min_spacing,
        max_spacing,
        alpha_min: settings.alpha_min.max(1e-6),
        alpha_max: settings.alpha_max.max(settings.alpha_min.max(1e-6) + 1e-6),
        delta_alpha_min: settings.delta_alpha_min.max(1e-6),
        delta_alpha_max: settings
            .delta_alpha_max
            .max(settings.delta_alpha_min.max(1e-6) + 1e-6),
    }
}

/// Compute a two-dimensional stable/unstable manifold of a flow equilibrium.
pub fn continue_manifold_eq_2d(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    settings: Manifold2DSettings,
) -> Result<ContinuationBranch> {
    continue_manifold_eq_2d_with_progress(system, equilibrium_state, settings, None)
}

/// Compute a two-dimensional stable/unstable manifold of a flow equilibrium,
/// emitting optional progress updates after each accepted ring.
pub fn continue_manifold_eq_2d_with_progress(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    settings: Manifold2DSettings,
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    let mut settings = settings;
    apply_eq_2d_profile(&mut settings);
    let dim = system.equations.len();
    if dim < 3 {
        bail!("2D manifold computation requires ambient dimension n >= 3.");
    }
    if equilibrium_state.len() != dim {
        bail!(
            "Equilibrium dimension mismatch: expected {}, got {}.",
            dim,
            equilibrium_state.len()
        );
    }
    let basis = select_2d_equilibrium_basis(
        system,
        equilibrium_state,
        settings.stability,
        settings.eig_indices,
    )?;
    let corrected_equilibrium = &basis.center;
    let initial_ring = build_equilibrium_initial_ring(
        corrected_equilibrium,
        &basis.e1,
        &basis.e2,
        settings.initial_radius.max(1e-9),
        settings.ring_points.max(8),
    );
    let controls = growth_controls_from_eq_settings(&settings);
    let sigma = stability_sigma(settings.stability);
    let surface = grow_surface_from_ring(
        system,
        initial_ring,
        sigma,
        settings.leaf_delta.max(1e-9),
        controls,
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_points.max(8),
        settings.caps.max_rings.max(1),
        settings.caps.max_vertices.max(64),
        settings.caps.max_time.max(1e-9),
        settings.target_radius.max(0.0),
        settings.target_arclength.max(0.0),
        Some(corrected_equilibrium),
        None,
        settings.bounds.as_ref(),
        on_ring_progress,
    );
    let surface = add_equilibrium_center_cap(surface, corrected_equilibrium);
    let points = surface_points_to_branch_points(&surface.vertices, &surface.ring_offsets);
    let indices: Vec<i32> = (0..points.len() as i32).collect();
    Ok(ContinuationBranch {
        points,
        bifurcations: Vec::new(),
        indices,
        branch_type: BranchType::ManifoldEq2D {
            stability: settings.stability,
            eig_kind: basis.kind,
            eig_indices: basis.indices,
            method: "krauskopf_osinga_geodesic_leaf_continuation".to_string(),
            caps: settings.caps,
        },
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: Some(ManifoldGeometry::Surface(ManifoldSurfaceGeometry {
            dim,
            vertices_flat: flatten_points(&surface.vertices),
            triangles: surface.triangles,
            ring_offsets: surface.ring_offsets,
            ring_diagnostics: surface.ring_diagnostics,
            solver_diagnostics: Some(surface.solver_diagnostics),
            resume_state: surface.resume_state.map(Box::new),
        })),
    })
}

/// Extend a computed two-dimensional equilibrium manifold by additional
/// geodesic arclength while retaining the accepted mesh as an exact prefix.
pub fn extend_manifold_eq_2d(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: Manifold2DSettings,
) -> Result<ContinuationBranch> {
    extend_manifold_eq_2d_with_progress(system, branch, settings, None)
}

/// Progress-reporting variant of [`extend_manifold_eq_2d`].
pub fn extend_manifold_eq_2d_with_progress(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    mut settings: Manifold2DSettings,
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    apply_eq_2d_profile(&mut settings);
    if !settings.target_arclength.is_finite() || settings.target_arclength <= 0.0 {
        bail!("2D manifold extension arclength must be a finite positive number.");
    }
    let (stability, eig_indices, method) = match &branch.branch_type {
        BranchType::ManifoldEq2D {
            stability,
            eig_indices,
            method,
            ..
        } => (*stability, *eig_indices, method.as_str()),
        _ => bail!("Only a 2D equilibrium manifold branch can be extended here."),
    };
    if method != "krauskopf_osinga_geodesic_leaf_continuation" {
        bail!("The stored equilibrium manifold backend does not support geodesic extension.");
    }
    if settings.stability != stability {
        bail!("Extension stability must match the existing 2D manifold branch.");
    }
    if settings
        .eig_indices
        .is_some_and(|requested| requested != eig_indices)
    {
        bail!("Extension eigen indices must match the existing 2D manifold branch.");
    }
    let resume = geodesic_surface_resume_state(&branch)?;
    let accumulated_arclength = resume.accumulated_arclength;
    let outer_ring = resume.outer_ring;
    let controls = growth_controls_from_eq_settings(&settings);
    let extension = grow_surface_from_geodesic_seed(
        system,
        GeodesicGrowthSeed {
            outer_ring: outer_ring.clone(),
            inward_anchors: resume.inward_anchors,
            current_leaf_delta: resume.current_leaf_delta,
            accumulated_arclength,
            global_ring_index: surface_ring_count(&branch)?.saturating_sub(1),
            center: resume.center,
        },
        stability_sigma(stability),
        controls,
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_points.max(8),
        settings.caps.max_rings.saturating_add(1).max(2),
        outer_ring
            .len()
            .saturating_add(settings.caps.max_vertices.max(1)),
        settings.caps.max_time.max(1e-9),
        f64::INFINITY,
        accumulated_arclength + settings.target_arclength,
        settings.bounds.as_ref(),
        on_ring_progress,
    );
    merge_manifold_surface_extension(branch, extension)
}

fn surface_ring_count(branch: &ContinuationBranch) -> Result<usize> {
    match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(geometry)) if !geometry.ring_offsets.is_empty() => {
            Ok(geometry.ring_offsets.len())
        }
        Some(ManifoldGeometry::Surface(_)) => bail!("Stored manifold surface has no rings."),
        _ => bail!("Manifold branch is missing surface geometry."),
    }
}

struct GeodesicResumeData {
    outer_ring: Vec<Vec<f64>>,
    inward_anchors: Vec<Vec<f64>>,
    current_leaf_delta: f64,
    accumulated_arclength: f64,
    center: Option<Vec<f64>>,
}

fn geodesic_surface_resume_state(branch: &ContinuationBranch) -> Result<GeodesicResumeData> {
    let state = match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(geometry)) => geometry.resume_state.as_deref(),
        _ => None,
    };
    match state {
        Some(ManifoldSurfaceResumeState::GeodesicRings {
            version: 1,
            outer_ring,
            inward_anchors,
            current_leaf_delta,
            accumulated_arclength,
            center,
        }) if outer_ring.len() >= 4 && outer_ring.len() == inward_anchors.len() => {
            Ok(GeodesicResumeData {
                outer_ring: outer_ring.clone(),
                inward_anchors: inward_anchors.clone(),
                current_leaf_delta: *current_leaf_delta,
                accumulated_arclength: *accumulated_arclength,
                center: center.clone(),
            })
        }
        Some(ManifoldSurfaceResumeState::GeodesicRings { version, .. }) => {
            bail!("Unsupported or inconsistent geodesic resume state version {version}.")
        }
        Some(_) => bail!("Stored 2D manifold resume state belongs to a different backend."),
        None => bail!(
            "This 2D manifold predates resumable surface state; recompute it once before extending."
        ),
    }
}

fn merge_manifold_surface_extension(
    mut branch: ContinuationBranch,
    extension: SurfaceGrowthResult,
) -> Result<ContinuationBranch> {
    if extension.ring_offsets.len() < 2 {
        bail!("2D manifold extension produced no new accepted ring.");
    }
    let local_seam_start = extension.ring_offsets[0];
    let local_seam_end = extension.ring_offsets[1];
    if local_seam_start != 0 || local_seam_end == 0 {
        bail!("2D manifold extension returned an inconsistent seam ring.");
    }
    let seam_len = local_seam_end;
    let old_point_count = branch.points.len();
    let geometry = match branch.manifold_geometry.as_mut() {
        Some(ManifoldGeometry::Surface(geometry)) => geometry,
        _ => bail!("Manifold branch is missing surface geometry."),
    };
    let dim = geometry.dim;
    if dim == 0 || geometry.vertices_flat.len() % dim != 0 {
        bail!("Stored manifold surface vertex data is inconsistent.");
    }
    let old_vertex_count = geometry.vertices_flat.len() / dim;
    let old_outer_start = *geometry
        .ring_offsets
        .last()
        .ok_or_else(|| anyhow!("Stored manifold surface has no outer ring."))?;
    let old_outer_len = old_vertex_count.saturating_sub(old_outer_start);
    if old_outer_len != seam_len
        || extension.vertices[..seam_len]
            .iter()
            .any(|point| point.len() != dim)
    {
        bail!("Stored manifold outer ring does not match its numerical resume frontier.");
    }

    for point in extension.vertices.iter().skip(seam_len) {
        if point.len() != dim {
            bail!("2D manifold extension vertex dimension mismatch.");
        }
        geometry.vertices_flat.extend_from_slice(point);
    }
    for &index in &extension.triangles {
        let mapped = if index < seam_len {
            old_outer_start + index
        } else {
            old_vertex_count + index - seam_len
        };
        geometry.triangles.push(mapped);
    }
    for offset in extension.ring_offsets.iter().skip(1) {
        geometry
            .ring_offsets
            .push(old_vertex_count + offset.saturating_sub(seam_len));
    }
    geometry.ring_diagnostics.extend(extension.ring_diagnostics);
    let mut diagnostics = extension.solver_diagnostics;
    let previous = geometry.solver_diagnostics.take().unwrap_or_default();
    diagnostics.ring_attempts += previous.ring_attempts;
    diagnostics.build_failures += previous.build_failures;
    diagnostics.spacing_failures += previous.spacing_failures;
    diagnostics.reject_ring_quality += previous.reject_ring_quality;
    diagnostics.reject_geodesic_quality += previous.reject_geodesic_quality;
    diagnostics.reject_too_small += previous.reject_too_small;
    diagnostics.leaf_fail_plane_no_convergence += previous.leaf_fail_plane_no_convergence;
    diagnostics.leaf_fail_plane_root_not_bracketed += previous.leaf_fail_plane_root_not_bracketed;
    diagnostics.leaf_fail_segment_switch_limit += previous.leaf_fail_segment_switch_limit;
    diagnostics.leaf_fail_integrator_non_finite += previous.leaf_fail_integrator_non_finite;
    diagnostics.leaf_fail_no_first_hit_within_max_time +=
        previous.leaf_fail_no_first_hit_within_max_time;
    diagnostics.local_leaf_shrinks += previous.local_leaf_shrinks;
    diagnostics.extension_count = previous.extension_count + 1;
    geometry.solver_diagnostics = Some(diagnostics);
    geometry.resume_state = extension.resume_state.map(Box::new);

    let old_ring_count = geometry
        .ring_offsets
        .len()
        .saturating_sub(extension.ring_offsets.len().saturating_sub(1));
    for local_ring_index in 1..extension.ring_offsets.len() {
        let start = extension.ring_offsets[local_ring_index];
        let end = extension
            .ring_offsets
            .get(local_ring_index + 1)
            .copied()
            .unwrap_or(extension.vertices.len());
        let param_value = (old_ring_count + local_ring_index - 1) as f64;
        for point in &extension.vertices[start..end] {
            branch.points.push(ContinuationPoint {
                state: point.clone(),
                param_value,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
            });
            branch
                .indices
                .push(branch.indices.last().copied().unwrap_or(-1) + 1);
        }
    }
    if branch.points.len() == old_point_count {
        bail!("2D manifold extension produced no new surface vertices.");
    }
    Ok(branch)
}

fn add_equilibrium_center_cap(
    mut surface: SurfaceGrowthResult,
    equilibrium_state: &[f64],
) -> SurfaceGrowthResult {
    if equilibrium_state.is_empty() {
        return surface;
    }

    surface.vertices.insert(0, equilibrium_state.to_vec());
    for offset in &mut surface.ring_offsets {
        *offset += 1;
    }
    for index in &mut surface.triangles {
        *index += 1;
    }

    let Some(first_ring_start) = surface.ring_offsets.first().copied() else {
        return surface;
    };
    let first_ring_len = if surface.ring_offsets.len() > 1 {
        surface.ring_offsets[1].saturating_sub(first_ring_start)
    } else {
        surface.vertices.len().saturating_sub(first_ring_start)
    };
    if first_ring_len >= 3 {
        for i in 0..first_ring_len {
            let a = first_ring_start + i;
            let b = first_ring_start + ((i + 1) % first_ring_len);
            surface.triangles.extend_from_slice(&[0, a, b]);
        }
    }
    surface
}

/// Compute a two-dimensional stable/unstable manifold of a limit cycle.
///
/// For an orientable manifold, `Both` returns the two components of the
/// manifold with the periodic orbit removed as independent surface branches.
/// For a negative multiplier the transverse line bundle is nonorientable, so
/// one doubled-cover branch represents the complete local manifold.
pub fn continue_limit_cycle_manifolds_2d(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    floquet_multipliers: &[Complex<f64>],
    settings: ManifoldCycle2DSettings,
) -> Result<Vec<ContinuationBranch>> {
    if settings.direction != ManifoldDirection::Both {
        return Ok(vec![continue_limit_cycle_manifold_2d(
            system,
            cycle_state,
            ntst,
            ncol,
            floquet_multipliers,
            settings,
        )?]);
    }
    let (_, multiplier) = select_floquet_multiplier(
        floquet_multipliers,
        settings.stability,
        settings.floquet_index,
    )?;
    if multiplier.re < 0.0 {
        let mut doubled = settings;
        doubled.direction = ManifoldDirection::Plus;
        return Ok(vec![continue_limit_cycle_manifold_2d(
            system,
            cycle_state,
            ntst,
            ncol,
            floquet_multipliers,
            doubled,
        )?]);
    }

    let mut plus_settings = settings.clone();
    plus_settings.direction = ManifoldDirection::Plus;
    let plus = continue_limit_cycle_manifold_2d(
        system,
        cycle_state,
        ntst,
        ncol,
        floquet_multipliers,
        plus_settings,
    )?;
    let mut minus_settings = settings;
    minus_settings.direction = ManifoldDirection::Minus;
    let minus = continue_limit_cycle_manifold_2d(
        system,
        cycle_state,
        ntst,
        ncol,
        floquet_multipliers,
        minus_settings,
    )?;
    Ok(vec![plus, minus])
}

/// Compute one connected sheet of a two-dimensional stable/unstable manifold
/// of a limit cycle.
pub fn continue_limit_cycle_manifold_2d(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    floquet_multipliers: &[Complex<f64>],
    settings: ManifoldCycle2DSettings,
) -> Result<ContinuationBranch> {
    continue_limit_cycle_manifold_2d_with_progress(
        system,
        cycle_state,
        ntst,
        ncol,
        floquet_multipliers,
        settings,
        None,
    )
}

/// Compute a two-dimensional stable/unstable manifold of a limit cycle,
/// emitting optional progress updates after each accepted ring.
pub fn continue_limit_cycle_manifold_2d_with_progress(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    floquet_multipliers: &[Complex<f64>],
    settings: ManifoldCycle2DSettings,
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    let mut settings = settings;
    apply_cycle_2d_profile(&mut settings);
    let dim = system.equations.len();
    if dim < 3 {
        bail!("2D manifold computation requires ambient dimension n >= 3.");
    }
    let cycle_profile = decode_cycle_profile_points(cycle_state, dim, ntst, ncol);
    if cycle_profile.points.len() < 4 {
        bail!("Cycle profile must contain at least 4 points.");
    }
    let (floquet_index, multiplier) = select_floquet_multiplier(
        floquet_multipliers,
        settings.stability,
        settings.floquet_index,
    )?;
    if settings.direction == ManifoldDirection::Both && multiplier.re >= 0.0 {
        bail!(
            "A positive Floquet multiplier has two orientable manifold sheets; use continue_limit_cycle_manifolds_2d to compute Both without joining them."
        );
    }
    if settings.direction == ManifoldDirection::Both {
        settings.direction = ManifoldDirection::Plus;
    }
    match settings.algorithm {
        ManifoldCycle2DAlgorithm::IsochronFibers => {
            return continue_limit_cycle_manifold_2d_hko(
                system,
                cycle_state,
                ntst,
                ncol,
                &cycle_profile,
                floquet_index,
                multiplier,
                &settings,
                on_ring_progress,
            );
        }
        ManifoldCycle2DAlgorithm::SegmentedPreimageFibers => {
            return continue_limit_cycle_manifold_2d_segmented_preimage(
                system,
                cycle_state,
                ntst,
                ncol,
                &cycle_profile,
                floquet_index,
                multiplier,
                &settings,
                on_ring_progress,
            );
        }
        ManifoldCycle2DAlgorithm::GeodesicRings => {}
    }

    let (cycle, floquet_dirs, multiplier) = build_cycle_floquet_seed(
        system,
        cycle_state,
        &cycle_profile,
        ntst,
        ncol,
        settings.parameter_index,
        multiplier,
        settings.ring_points.max(8),
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_time.max(1e-9),
    )?;
    if cycle.len() != floquet_dirs.len() || cycle.len() < 4 {
        bail!("Cycle manifold initialization failed to build a valid Floquet seed ring.");
    }

    let mut initial_ring = Vec::with_capacity(cycle.len() * 2);
    let mut initial_in_anchors = Vec::with_capacity(initial_ring.capacity());
    let radius = settings.initial_radius.max(1e-9);
    let push_seed_sheet =
        |sign: f64, initial_ring: &mut Vec<Vec<f64>>, initial_in_anchors: &mut Vec<Vec<f64>>| {
            for (point, direction) in cycle.iter().zip(floquet_dirs.iter()) {
                let mut seed = point.clone();
                for i in 0..dim {
                    seed[i] += sign * radius * direction[i];
                }
                initial_ring.push(seed);
                initial_in_anchors.push(point.clone());
            }
        };
    if multiplier.re < 0.0 {
        // Negative multipliers are anti-periodic; keep the double cover to avoid
        // forcing a discontinuous direction field around the cycle. Direction
        // still controls which sheet is seeded first.
        if settings.direction == ManifoldDirection::Minus {
            push_seed_sheet(-1.0, &mut initial_ring, &mut initial_in_anchors);
            push_seed_sheet(1.0, &mut initial_ring, &mut initial_in_anchors);
        } else {
            push_seed_sheet(1.0, &mut initial_ring, &mut initial_in_anchors);
            push_seed_sheet(-1.0, &mut initial_ring, &mut initial_in_anchors);
        }
    } else {
        match settings.direction {
            ManifoldDirection::Plus => {
                push_seed_sheet(1.0, &mut initial_ring, &mut initial_in_anchors);
            }
            ManifoldDirection::Minus => {
                push_seed_sheet(-1.0, &mut initial_ring, &mut initial_in_anchors);
            }
            ManifoldDirection::Both => {
                push_seed_sheet(1.0, &mut initial_ring, &mut initial_in_anchors);
                push_seed_sheet(-1.0, &mut initial_ring, &mut initial_in_anchors);
            }
        }
    }
    let sigma = stability_sigma(settings.stability);
    let controls = growth_controls_from_cycle_settings(&settings);
    let surface = grow_surface_from_ring(
        system,
        initial_ring,
        sigma,
        settings.leaf_delta.max(1e-9),
        controls,
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_points.max(8),
        settings.caps.max_rings.max(1),
        settings.caps.max_vertices.max(64),
        settings.caps.max_time.max(1e-9),
        f64::INFINITY,
        settings.target_arclength.max(0.0),
        None,
        Some(&initial_in_anchors),
        settings.bounds.as_ref(),
        on_ring_progress,
    );
    build_cycle_manifold_branch(
        dim,
        surface,
        &settings,
        floquet_index,
        ntst,
        ncol,
        "krauskopf_osinga_geodesic_leaf_continuation",
    )
}

/// Extend one computed two-dimensional limit-cycle manifold sheet by
/// additional common fiber/geodesic arclength.
pub fn extend_limit_cycle_manifold_2d(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: ManifoldCycle2DSettings,
) -> Result<ContinuationBranch> {
    extend_limit_cycle_manifold_2d_with_progress(system, branch, settings, None)
}

/// Progress-reporting variant of [`extend_limit_cycle_manifold_2d`].
pub fn extend_limit_cycle_manifold_2d_with_progress(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    mut settings: ManifoldCycle2DSettings,
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    apply_cycle_2d_profile(&mut settings);
    if !settings.target_arclength.is_finite() || settings.target_arclength <= 0.0 {
        bail!("2D manifold extension arclength must be a finite positive number.");
    }
    let (stability, direction, floquet_index, ntst, ncol, method) = match &branch.branch_type {
        BranchType::ManifoldCycle2D {
            stability,
            direction,
            floquet_index,
            ntst,
            ncol,
            method,
            ..
        } => (
            *stability,
            *direction,
            *floquet_index,
            *ntst,
            *ncol,
            method.clone(),
        ),
        _ => bail!("Only a 2D limit-cycle manifold branch can be extended here."),
    };
    if settings.stability != stability {
        bail!("Extension stability must match the existing 2D manifold branch.");
    }
    if settings.direction != direction {
        bail!("Extension direction must match the existing 2D manifold sheet.");
    }
    if settings
        .floquet_index
        .is_some_and(|requested| requested != floquet_index)
    {
        bail!("Extension Floquet index must match the existing 2D manifold branch.");
    }
    if settings.ntst > 0 && settings.ntst != ntst || settings.ncol > 0 && settings.ncol != ncol {
        bail!("Extension collocation mesh must match the existing 2D manifold branch.");
    }
    let expected_method = match settings.algorithm {
        ManifoldCycle2DAlgorithm::GeodesicRings => "krauskopf_osinga_geodesic_leaf_continuation",
        ManifoldCycle2DAlgorithm::IsochronFibers => "hko_fundamental_segment_bvp",
        ManifoldCycle2DAlgorithm::SegmentedPreimageFibers => "segmented_preimage_collocation",
    };
    if method != expected_method {
        bail!("Extension algorithm must match the existing 2D manifold backend.");
    }

    match settings.algorithm {
        ManifoldCycle2DAlgorithm::GeodesicRings => {
            let resume = geodesic_surface_resume_state(&branch)?;
            if resume.center.is_some() {
                bail!("Cycle geodesic resume state unexpectedly contains an equilibrium center.");
            }
            let accumulated_arclength = resume.accumulated_arclength;
            let outer_ring = resume.outer_ring;
            let extension = grow_surface_from_geodesic_seed(
                system,
                GeodesicGrowthSeed {
                    outer_ring: outer_ring.clone(),
                    inward_anchors: resume.inward_anchors,
                    current_leaf_delta: resume.current_leaf_delta,
                    accumulated_arclength,
                    global_ring_index: surface_ring_count(&branch)?.saturating_sub(1),
                    center: None,
                },
                stability_sigma(stability),
                growth_controls_from_cycle_settings(&settings),
                settings.integration_dt.abs().max(1e-9),
                settings.caps.max_steps.max(2),
                settings.caps.max_points.max(8),
                settings.caps.max_rings.saturating_add(1).max(2),
                outer_ring
                    .len()
                    .saturating_add(settings.caps.max_vertices.max(1)),
                settings.caps.max_time.max(1e-9),
                f64::INFINITY,
                accumulated_arclength + settings.target_arclength,
                settings.bounds.as_ref(),
                on_ring_progress,
            );
            merge_manifold_surface_extension(branch, extension)
        }
        ManifoldCycle2DAlgorithm::IsochronFibers => {
            extend_limit_cycle_manifold_2d_hko(system, branch, &settings, on_ring_progress)
        }
        ManifoldCycle2DAlgorithm::SegmentedPreimageFibers => {
            extend_limit_cycle_manifold_2d_segmented_preimage(
                system,
                branch,
                &settings,
                on_ring_progress,
            )
        }
    }
}

fn build_cycle_manifold_branch(
    dim: usize,
    surface: SurfaceGrowthResult,
    settings: &ManifoldCycle2DSettings,
    floquet_index: usize,
    ntst: usize,
    ncol: usize,
    method: &str,
) -> Result<ContinuationBranch> {
    let points = surface_points_to_branch_points(&surface.vertices, &surface.ring_offsets);
    let indices: Vec<i32> = (0..points.len() as i32).collect();
    Ok(ContinuationBranch {
        points,
        bifurcations: Vec::new(),
        indices,
        branch_type: BranchType::ManifoldCycle2D {
            stability: settings.stability,
            direction: settings.direction,
            floquet_index,
            ntst: if settings.ntst > 0 {
                settings.ntst
            } else {
                ntst
            },
            ncol: if settings.ncol > 0 {
                settings.ncol
            } else {
                ncol
            },
            method: method.to_string(),
            caps: settings.caps,
        },
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: Some(ManifoldGeometry::Surface(ManifoldSurfaceGeometry {
            dim,
            vertices_flat: flatten_points(&surface.vertices),
            triangles: surface.triangles,
            ring_offsets: surface.ring_offsets,
            ring_diagnostics: surface.ring_diagnostics,
            solver_diagnostics: Some(surface.solver_diagnostics),
            resume_state: surface.resume_state.map(Box::new),
        })),
    })
}

#[derive(Clone)]
struct HkoFundamentalSegment {
    inner: Vec<f64>,
    outer: Vec<f64>,
    solution: IsochronBvpSolution,
    lift_off: f64,
}

fn extend_limit_cycle_manifold_2d_hko(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: &ManifoldCycle2DSettings,
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    let state = match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(geometry)) => geometry.resume_state.as_deref().cloned(),
        _ => None,
    };
    let (
        version,
        mut fibers,
        emitted_arclength,
        sigma,
        return_time,
        bvp_intervals,
        bvp_degree,
    ) = match state {
        Some(ManifoldSurfaceResumeState::HkoIsochronFibers {
            version,
            fibers,
            emitted_arclength,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
        }) => (
            version,
            fibers,
            emitted_arclength,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
        ),
        Some(_) => bail!("Stored 2D manifold resume state belongs to a different backend."),
        None => bail!(
            "This HKO manifold predates resumable surface state; recompute it once before extending."
        ),
    };
    if version != 1 || fibers.len() < 4 || !emitted_arclength.is_finite() {
        bail!("Stored HKO surface resume state is unsupported or inconsistent.");
    }
    if (sigma + stability_sigma(settings.stability)).abs() > 1e-12 {
        bail!("Stored HKO time direction does not match extension stability.");
    }
    let target_arclength = emitted_arclength + settings.target_arclength;
    let dt = settings.integration_dt.abs().max(1e-9);
    let max_steps = settings.caps.max_steps.max(2);
    let max_time = settings.caps.max_time.max(return_time).max(1e-9);
    let mut stats = IsochronBvpStats::default();
    let mut bounds_exit = false;
    for (phase_index, fiber) in fibers.iter_mut().enumerate() {
        let max_total_points = fiber
            .fiber
            .len()
            .saturating_add(settings.caps.max_steps.max(16));
        let (continued, fiber_bounds_exit) = continue_hko_isochron_resume_state(
            system,
            phase_index,
            fiber.clone(),
            settings,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
            dt,
            max_steps,
            max_time,
            target_arclength,
            max_total_points,
            &mut stats,
        )?;
        *fiber = continued;
        bounds_exit |= fiber_bounds_exit;
    }
    let min_fiber_arclength = fibers
        .iter()
        .map(|fiber| open_curve_arclength(&fiber.fiber))
        .fold(f64::INFINITY, f64::min);
    if !min_fiber_arclength.is_finite() || min_fiber_arclength <= emitted_arclength + NORM_EPS {
        bail!("HKO extension did not advance the common fiber frontier.");
    }
    let usable_arclength = target_arclength.min(min_fiber_arclength);
    let phase_count = fibers.len();
    let leaf_delta = settings.leaf_delta.max(1e-9);
    let requested_new_rings =
        (((usable_arclength - emitted_arclength) / leaf_delta).ceil() as usize).max(1);
    let max_new_rings = settings.caps.max_rings.max(1);
    let max_new_by_vertices = (settings.caps.max_vertices / phase_count.max(1)).max(1);
    let new_ring_count = requested_new_rings
        .min(max_new_rings)
        .min(max_new_by_vertices)
        .max(1);
    let mut rings = Vec::with_capacity(new_ring_count + 1);
    let mut ring_diagnostics = Vec::with_capacity(new_ring_count);
    let global_ring_index = surface_ring_count(&branch)?.saturating_sub(1);
    for local_ring_index in 0..=new_ring_count {
        let arclength = emitted_arclength
            + (usable_arclength - emitted_arclength) * (local_ring_index as f64)
                / (new_ring_count as f64);
        let ring = fibers
            .iter()
            .map(|fiber| sample_open_curve_at_arclength(&fiber.fiber, arclength))
            .collect::<Vec<_>>();
        if local_ring_index > 0 {
            ring_diagnostics.push(ManifoldRingDiagnostic {
                ring_index: global_ring_index + local_ring_index,
                radius_estimate: arclength,
                point_count: ring.len(),
            });
            if let Some(callback) = on_ring_progress.as_deref_mut() {
                callback(
                    global_ring_index + local_ring_index + 1,
                    local_ring_index * ring.len(),
                    arclength,
                    arclength,
                );
            }
        }
        rings.push(ring);
    }
    let mut vertices = Vec::new();
    let mut ring_offsets = Vec::with_capacity(rings.len());
    for ring in &rings {
        ring_offsets.push(vertices.len());
        vertices.extend(ring.iter().cloned());
    }
    let uniform_parent_anchors = (0..rings.len())
        .map(|ring_index| {
            if ring_index == 0 {
                Vec::new()
            } else {
                (0..phase_count)
                    .map(|index| (index as f64) / (phase_count as f64))
                    .collect()
            }
        })
        .collect::<Vec<Vec<f64>>>();
    let triangles =
        triangulate_ring_bands_with_parent_anchors(&rings, &ring_offsets, &uniform_parent_anchors);
    let target_reached = min_fiber_arclength + 1e-8 >= target_arclength;
    let termination_reason = if bounds_exit {
        SurfaceTerminationReason::BoundsExit
    } else if !target_reached {
        SurfaceTerminationReason::MaxSteps
    } else if requested_new_rings > max_new_by_vertices && max_new_by_vertices <= max_new_rings {
        SurfaceTerminationReason::MaxVertices
    } else if requested_new_rings > max_new_rings {
        SurfaceTerminationReason::MaxRings
    } else {
        SurfaceTerminationReason::TargetArclength
    };
    let solver_diagnostics = ManifoldSurfaceSolverDiagnostics {
        termination_reason: termination_reason.as_str().to_string(),
        termination_detail: Some(format!(
            "HKO extension: phases={}, new_rings={}, from_arclength={:.6e}, achieved_arclength={:.6e}, target_arclength={:.6e}, continuation_solves={}, rejected_nonconverged={}, max_residual={:.3e}",
            phase_count,
            new_ring_count,
            emitted_arclength,
            usable_arclength,
            target_arclength,
            stats.continuation_solves,
            stats.nonconverged,
            stats.max_residual,
        )),
        final_leaf_delta: leaf_delta,
        ring_attempts: stats.solves,
        build_failures: stats.nonconverged,
        leaf_delta_floor: settings.delta_min.max(1e-12),
        ..ManifoldSurfaceSolverDiagnostics::default()
    };
    merge_manifold_surface_extension(
        branch,
        SurfaceGrowthResult {
            vertices,
            triangles,
            ring_offsets,
            ring_diagnostics,
            solver_diagnostics,
            resume_state: Some(ManifoldSurfaceResumeState::HkoIsochronFibers {
                version: 1,
                fibers,
                emitted_arclength: usable_arclength,
                sigma,
                return_time,
                bvp_intervals,
                bvp_degree,
            }),
        },
    )
}

fn extend_limit_cycle_manifold_2d_segmented_preimage(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: &ManifoldCycle2DSettings,
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    let state = match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(geometry)) => geometry.resume_state.as_deref().cloned(),
        _ => None,
    };
    let (
        version,
        fibers,
        current_ring,
        arclengths,
        emitted_arclength,
        sigma,
        segment_duration,
        phase_shift_per_segment,
        bvp_intervals,
        bvp_degree,
    ) = match state {
        Some(ManifoldSurfaceResumeState::SegmentedPreimageFibers {
            version,
            fibers,
            current_ring,
            arclengths,
            emitted_arclength,
            sigma,
            segment_duration,
            phase_shift_per_segment,
            bvp_intervals,
            bvp_degree,
        }) => (
            version,
            fibers,
            current_ring,
            arclengths,
            emitted_arclength,
            sigma,
            segment_duration,
            phase_shift_per_segment,
            bvp_intervals,
            bvp_degree,
        ),
        Some(_) => bail!("Stored 2D manifold resume state belongs to a different backend."),
        None => bail!(
            "This segmented-preimage manifold predates resumable surface state; recompute it once before extending."
        ),
    };
    if version != 1 || fibers.len() < 4 || !emitted_arclength.is_finite() {
        bail!("Stored segmented-preimage resume state is unsupported or inconsistent.");
    }
    if (sigma + stability_sigma(settings.stability)).abs() > 1e-12 {
        bail!("Stored segmented-preimage time direction does not match extension stability.");
    }
    let target_arclength = emitted_arclength + settings.target_arclength;
    let dt = settings.integration_dt.abs().max(1e-9);
    let max_steps_per_segment = settings
        .caps
        .max_steps
        .max((segment_duration / dt).ceil() as usize + 2)
        .max(2);
    let max_time = settings.caps.max_time.max(segment_duration).max(1e-9);
    let per_phase_segment_cap = settings.caps.max_steps.max(settings.caps.max_rings).max(2);
    let mut stats = IsochronBvpStats::default();
    let (fibers, current_ring, arclengths, bounds_exit) = continue_isochron_segmented_fibers(
        system,
        fibers,
        current_ring,
        arclengths,
        target_arclength,
        settings,
        sigma,
        segment_duration,
        phase_shift_per_segment,
        bvp_intervals,
        bvp_degree,
        dt,
        max_steps_per_segment,
        max_time,
        per_phase_segment_cap,
        &mut stats,
    )?;
    let min_fiber_arclength = arclengths.iter().copied().fold(f64::INFINITY, f64::min);
    if !min_fiber_arclength.is_finite() || min_fiber_arclength <= emitted_arclength + NORM_EPS {
        bail!("Segmented-preimage extension did not advance the common fiber frontier.");
    }
    let usable_arclength = target_arclength.min(min_fiber_arclength);
    let phase_count = fibers.len();
    let leaf_delta = settings.leaf_delta.max(1e-9);
    let requested_new_rings =
        (((usable_arclength - emitted_arclength) / leaf_delta).ceil() as usize).max(1);
    let max_new_rings = settings.caps.max_rings.max(1);
    let max_new_by_vertices = (settings.caps.max_vertices / phase_count.max(1)).max(1);
    let new_ring_count = requested_new_rings
        .min(max_new_rings)
        .min(max_new_by_vertices)
        .max(1);
    let global_ring_index = surface_ring_count(&branch)?.saturating_sub(1);
    let mut rings = Vec::with_capacity(new_ring_count + 1);
    let mut ring_diagnostics = Vec::with_capacity(new_ring_count);
    for local_ring_index in 0..=new_ring_count {
        let arclength = emitted_arclength
            + (usable_arclength - emitted_arclength) * (local_ring_index as f64)
                / (new_ring_count as f64);
        let ring = fibers
            .iter()
            .map(|fiber| sample_open_curve_at_arclength(fiber, arclength))
            .collect::<Vec<_>>();
        if local_ring_index > 0 {
            ring_diagnostics.push(ManifoldRingDiagnostic {
                ring_index: global_ring_index + local_ring_index,
                radius_estimate: arclength,
                point_count: ring.len(),
            });
            if let Some(callback) = on_ring_progress.as_deref_mut() {
                callback(
                    global_ring_index + local_ring_index + 1,
                    local_ring_index * ring.len(),
                    arclength,
                    leaf_delta,
                );
            }
        }
        rings.push(ring);
    }
    let mut vertices = Vec::new();
    let mut ring_offsets = Vec::with_capacity(rings.len());
    for ring in &rings {
        ring_offsets.push(vertices.len());
        vertices.extend(ring.iter().cloned());
    }
    let triangles = triangulate_ring_bands(&rings, &ring_offsets);
    let target_reached = min_fiber_arclength + 1e-8 >= target_arclength;
    let termination_reason = if bounds_exit {
        SurfaceTerminationReason::BoundsExit
    } else if !target_reached {
        SurfaceTerminationReason::MaxSteps
    } else if requested_new_rings > max_new_by_vertices && max_new_by_vertices <= max_new_rings {
        SurfaceTerminationReason::MaxVertices
    } else if requested_new_rings > max_new_rings {
        SurfaceTerminationReason::MaxRings
    } else {
        SurfaceTerminationReason::TargetArclength
    };
    let solver_diagnostics = ManifoldSurfaceSolverDiagnostics {
        termination_reason: termination_reason.as_str().to_string(),
        termination_detail: Some(format!(
            "segmented-preimage extension: phases={}, new_rings={}, from_arclength={:.6e}, achieved_arclength={:.6e}, target_arclength={:.6e}, bvp_solves={}, rejected_nonconverged={}, max_residual={:.3e}",
            phase_count,
            new_ring_count,
            emitted_arclength,
            usable_arclength,
            target_arclength,
            stats.solves,
            stats.nonconverged,
            stats.max_residual,
        )),
        final_leaf_delta: leaf_delta,
        ring_attempts: stats.solves,
        build_failures: stats.nonconverged,
        leaf_delta_floor: settings.delta_min.max(1e-12),
        ..ManifoldSurfaceSolverDiagnostics::default()
    };
    merge_manifold_surface_extension(
        branch,
        SurfaceGrowthResult {
            vertices,
            triangles,
            ring_offsets,
            ring_diagnostics,
            solver_diagnostics,
            resume_state: Some(ManifoldSurfaceResumeState::SegmentedPreimageFibers {
                version: 1,
                fibers,
                current_ring,
                arclengths,
                emitted_arclength: usable_arclength,
                sigma,
                segment_duration,
                phase_shift_per_segment,
                bvp_intervals,
                bvp_degree,
            }),
        },
    )
}

fn record_isochron_bvp_attempt(
    stats: &mut IsochronBvpStats,
    solve: &IsochronBvpSolution,
    phase_index: usize,
    fundamental: bool,
) {
    stats.solves += 1;
    if fundamental {
        stats.fundamental_solves += 1;
    } else {
        stats.continuation_solves += 1;
    }
    stats.max_residual = stats.max_residual.max(solve.residual_norm);
    stats.max_iterations = stats.max_iterations.max(solve.iterations);
    if !solve.converged {
        stats.nonconverged += 1;
        stats.last_nonconverged_phase = Some(phase_index + 1);
    }
}

fn hko_departure_components(
    system: &EquationSystem,
    point: &[f64],
    origin: &[f64],
    direction: &[f64],
) -> (f64, f64) {
    if point.len() != origin.len() || point.len() != direction.len() {
        return (f64::INFINITY, f64::INFINITY);
    }
    let direction = normalize(direction.to_vec()).unwrap_or_else(|_| vec![0.0; point.len()]);
    let mut offset = subtract(point, origin);
    let projection = dot(&offset, &direction);
    for index in 0..offset.len() {
        offset[index] -= projection * direction[index];
    }
    let mut phase_axis = vec![0.0; origin.len()];
    system.apply(0.0, origin, &mut phase_axis);
    let phase_projection = dot(&phase_axis, &direction);
    for index in 0..phase_axis.len() {
        phase_axis[index] -= phase_projection * direction[index];
    }
    let phase_axis = normalize(phase_axis).unwrap_or_else(|_| vec![0.0; point.len()]);
    let signed_phase_shear = dot(&offset, &phase_axis);
    for index in 0..offset.len() {
        offset[index] -= signed_phase_shear * phase_axis[index];
    }
    (signed_phase_shear.abs(), l2_norm(&offset))
}

#[allow(clippy::too_many_arguments)]
fn construct_hko_fundamental_segment(
    system: &EquationSystem,
    phase_point: &[f64],
    floquet_direction: &[f64],
    phase_index: usize,
    target_segment_length: f64,
    sigma: f64,
    return_time: f64,
    bvp_intervals: usize,
    bvp_degree: usize,
    dt: f64,
    max_steps: usize,
    max_time: f64,
    stats: &mut IsochronBvpStats,
) -> Result<HkoFundamentalSegment> {
    let direction = normalize(floquet_direction.to_vec())?;
    let initial = solve_isochron_return_preimage_bvp_with_guess(
        system,
        phase_point,
        sigma,
        return_time,
        bvp_intervals,
        bvp_degree,
        dt,
        max_steps,
        max_time,
        None,
    )?;
    record_isochron_bvp_attempt(stats, &initial, phase_index, true);
    require_converged_isochron_bvp(
        &initial,
        &format!(
            "HKO fundamental-segment initialization at phase {}",
            phase_index + 1
        ),
    )?;

    let target_segment_length = target_segment_length.max(1e-9);
    let lift_off_limit = (target_segment_length * target_segment_length).max(1e-12);
    let (baseline_phase_shear, baseline_lift_off) =
        hko_departure_components(system, &initial.start, phase_point, &direction);
    let minimum_eta_step = (target_segment_length * 1e-6).max(1e-12);
    let mut eta = 0.0;
    let mut eta_step = (0.25 * target_segment_length).max(1e-9);
    let mut previous = initial;

    for _ in 0..128 {
        let candidate_eta = eta + eta_step;
        let mut endpoint = phase_point.to_vec();
        for index in 0..endpoint.len() {
            endpoint[index] += candidate_eta * direction[index];
        }
        let candidate = solve_isochron_return_preimage_bvp_with_guess(
            system,
            &endpoint,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
            dt,
            max_steps,
            max_time,
            Some(&previous.unknown),
        )?;
        record_isochron_bvp_attempt(stats, &candidate, phase_index, true);
        if !candidate.converged {
            eta_step *= 0.5;
            if eta_step < minimum_eta_step {
                bail!(
                    "HKO fundamental-segment continuation failed at phase {}: residual {:.3e} after {} Newton iterations.",
                    phase_index + 1,
                    candidate.residual_norm,
                    candidate.iterations
                );
            }
            continue;
        }
        let segment_length = l2_distance(&endpoint, &candidate.start);
        let (phase_shear, lift_off) =
            hko_departure_components(system, &candidate.start, phase_point, &direction);
        let nonlinear_phase_shear = (phase_shear - baseline_phase_shear).max(0.0);
        let nonlinear_lift_off = (lift_off - baseline_lift_off).max(0.0);
        if !segment_length.is_finite() || !lift_off.is_finite() {
            bail!("HKO fundamental-segment continuation produced non-finite geometry.");
        }
        let lift_event_ratio = if segment_length >= 0.25 * target_segment_length {
            nonlinear_phase_shear.hypot(nonlinear_lift_off) / lift_off_limit
        } else {
            0.0
        };
        let event_ratio = (segment_length / target_segment_length).max(lift_event_ratio);
        if event_ratio >= 1.0 {
            if event_ratio > 1.25 && eta_step > minimum_eta_step {
                eta_step *= 0.5;
                continue;
            }
            stats.max_fundamental_lift_off = stats.max_fundamental_lift_off.max(nonlinear_lift_off);
            stats.max_fundamental_phase_shear =
                stats.max_fundamental_phase_shear.max(nonlinear_phase_shear);
            return Ok(HkoFundamentalSegment {
                inner: endpoint,
                outer: candidate.start.clone(),
                solution: candidate,
                lift_off: nonlinear_lift_off,
            });
        }
        eta = candidate_eta;
        previous = candidate;
        eta_step *= 1.5;
    }
    bail!(
        "HKO fundamental-segment continuation did not reach its local accuracy event at phase {}.",
        phase_index + 1
    )
}

#[allow(clippy::too_many_arguments)]
fn continue_hko_isochron_from_fundamental_segment(
    system: &EquationSystem,
    phase_point: &[f64],
    phase_index: usize,
    fundamental: HkoFundamentalSegment,
    settings: &ManifoldCycle2DSettings,
    sigma: f64,
    return_time: f64,
    bvp_intervals: usize,
    bvp_degree: usize,
    dt: f64,
    max_steps: usize,
    max_time: f64,
    stats: &mut IsochronBvpStats,
) -> Result<(ManifoldHkoFiberResumeState, bool)> {
    let mut fiber = vec![phase_point.to_vec()];
    for point in [&fundamental.inner, &fundamental.outer] {
        if l2_distance(fiber.last().expect("fiber seed"), point) > NORM_EPS {
            fiber.push(point.clone());
        }
    }
    let resume = ManifoldHkoFiberResumeState {
        phase_point: phase_point.to_vec(),
        fiber,
        inner: fundamental.inner,
        outer: fundamental.outer,
        solution_start: fundamental.solution.start,
        solution_unknown: fundamental.solution.unknown,
        lift_off: fundamental.lift_off,
        family_parameter: 0.0,
        family_step: 0.25,
    };
    continue_hko_isochron_resume_state(
        system,
        phase_index,
        resume,
        settings,
        sigma,
        return_time,
        bvp_intervals,
        bvp_degree,
        dt,
        max_steps,
        max_time,
        settings
            .target_arclength
            .max(settings.initial_radius.max(1e-9)),
        settings.caps.max_steps.max(16),
        stats,
    )
}

#[allow(clippy::too_many_arguments)]
fn continue_hko_isochron_resume_state(
    system: &EquationSystem,
    phase_index: usize,
    mut resume: ManifoldHkoFiberResumeState,
    settings: &ManifoldCycle2DSettings,
    sigma: f64,
    return_time: f64,
    bvp_intervals: usize,
    bvp_degree: usize,
    dt: f64,
    max_steps: usize,
    max_time: f64,
    target_arclength: f64,
    max_total_points: usize,
    stats: &mut IsochronBvpStats,
) -> Result<(ManifoldHkoFiberResumeState, bool)> {
    if resume.fiber.is_empty()
        || resume.inner.len() != resume.phase_point.len()
        || resume.outer.len() != resume.phase_point.len()
        || resume.solution_start.len() != resume.phase_point.len()
    {
        bail!(
            "Stored HKO fiber resume state is inconsistent at phase {}.",
            phase_index + 1
        );
    }
    let target_spacing = settings.leaf_delta.max(1e-9);
    let mut arclength = open_curve_arclength(&resume.fiber);
    let mut bounds_exit = false;
    let mut accepted_points = resume.fiber.len();
    let accepted_point_cap = max_total_points.max(accepted_points);
    const MIN_FAMILY_STEP: f64 = 1e-5;

    while arclength < target_arclength && accepted_points < accepted_point_cap {
        if resume.family_parameter >= 1.0 - 1e-12 {
            resume.inner = resume.outer.clone();
            resume.outer = resume.solution_start.clone();
            resume.family_parameter = 0.0;
            resume.family_step = 0.25;
        }
        let candidate_parameter =
            (resume.family_parameter + resume.family_step.max(MIN_FAMILY_STEP)).min(1.0);
        let endpoint = lerp(&resume.inner, &resume.outer, candidate_parameter);
        let candidate = solve_isochron_return_preimage_bvp_with_guess(
            system,
            &endpoint,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
            dt,
            max_steps,
            max_time,
            Some(&resume.solution_unknown),
        )?;
        record_isochron_bvp_attempt(stats, &candidate, phase_index, false);
        if !candidate.converged {
            resume.family_step *= 0.5;
            if resume.family_step < MIN_FAMILY_STEP {
                bail!(
                    "HKO isochron continuation failed at phase {} and family parameter {:.6}: residual {:.3e} after {} Newton iterations.",
                    phase_index + 1,
                    candidate_parameter,
                    candidate.residual_norm,
                    candidate.iterations
                );
            }
            continue;
        }
        let spatial_step = l2_distance(resume.fiber.last().expect("fiber point"), &candidate.start);
        if spatial_step > 1.5 * target_spacing {
            if resume.family_step > MIN_FAMILY_STEP {
                resume.family_step *= 0.5;
                continue;
            }
            bail!(
                "HKO isochron continuation could not meet arclength spacing at phase {}: step {:.3e} exceeds target {:.3e}.",
                phase_index + 1,
                spatial_step,
                target_spacing
            );
        }
        if !spatial_step.is_finite() || candidate.start.iter().any(|value| !value.is_finite()) {
            bail!("HKO isochron continuation produced non-finite geometry.");
        }
        if let Some(bounds) = settings.bounds.as_ref() {
            if !inside_bounds(&candidate.start, bounds) {
                bounds_exit = true;
                break;
            }
        }
        if spatial_step > NORM_EPS {
            resume.fiber.push(candidate.start.clone());
            arclength += spatial_step;
            accepted_points += 1;
        }
        resume.family_parameter = candidate_parameter;
        resume.solution_start = candidate.start;
        resume.solution_unknown = candidate.unknown;
        if spatial_step < 0.5 * target_spacing && resume.family_parameter < 1.0 - 1e-12 {
            resume.family_step = (resume.family_step * 1.5).min(1.0 - resume.family_parameter);
        }
    }
    Ok((resume, bounds_exit))
}

#[allow(clippy::too_many_arguments)]
fn continue_limit_cycle_manifold_2d_hko(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    cycle_profile: &DecodedCycleProfile,
    floquet_index: usize,
    multiplier: Complex<f64>,
    settings: &ManifoldCycle2DSettings,
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    if settings.direction == ManifoldDirection::Both {
        bail!("HKO isochron manifolds require one orientable sheet at a time.");
    }
    if multiplier.im.abs() > EIG_IM_TOL {
        bail!("HKO isochron manifolds require a real Floquet multiplier.");
    }
    let period = cycle_profile.period;
    if !period.is_finite() || period <= 0.0 {
        bail!("HKO isochron manifolds require a positive limit-cycle period.");
    }
    let dim = system.equations.len();
    let phase_points = settings.ring_points.max(8);
    let (cycle, floquet_dirs, multiplier) = build_cycle_floquet_seed(
        system,
        cycle_state,
        cycle_profile,
        ntst,
        ncol,
        settings.parameter_index,
        multiplier,
        phase_points,
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_time.max(period).max(1e-9),
    )?;
    let (phase_cycle, phase_dirs, return_time) = build_isochron_phase_cover(
        &cycle,
        &floquet_dirs,
        multiplier.re,
        settings.direction,
        period,
    )?;
    let sigma = -stability_sigma(settings.stability);
    // HKO continuation relies on a numerically closed return segment at each
    // phase. A low-order source cycle mesh is therefore refined before it is
    // used as the baseline BVP rather than allowing closure error to masquerade
    // as nonlinear lift-off.
    let bvp_intervals = effective_isochron_bvp_intervals(settings, ntst).max(12);
    let bvp_degree = effective_isochron_bvp_degree(settings, ncol).max(3);
    let dt = settings.integration_dt.abs().max(1e-9);
    let max_steps = settings.caps.max_steps.max(2);
    let max_time = settings.caps.max_time.max(return_time).max(1e-9);
    let mut stats = IsochronBvpStats::default();
    let mut fibers = Vec::with_capacity(phase_cycle.len());
    let mut fiber_resume_states = Vec::with_capacity(phase_cycle.len());
    let mut bounds_exit = false;
    for (phase_index, (phase_point, direction)) in
        phase_cycle.iter().zip(phase_dirs.iter()).enumerate()
    {
        let fundamental = construct_hko_fundamental_segment(
            system,
            phase_point,
            direction,
            phase_index,
            settings.initial_radius.max(1e-9),
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
            dt,
            max_steps,
            max_time,
            &mut stats,
        )?;
        let (fiber_resume, fiber_bounds_exit) = continue_hko_isochron_from_fundamental_segment(
            system,
            phase_point,
            phase_index,
            fundamental,
            settings,
            sigma,
            return_time,
            bvp_intervals,
            bvp_degree,
            dt,
            max_steps,
            max_time,
            &mut stats,
        )?;
        bounds_exit |= fiber_bounds_exit;
        fibers.push(fiber_resume.fiber.clone());
        fiber_resume_states.push(fiber_resume);
    }

    let target_arclength = settings
        .target_arclength
        .max(settings.initial_radius.max(1e-9));
    let min_fiber_arclength = fibers
        .iter()
        .map(|fiber| open_curve_arclength(fiber))
        .fold(f64::INFINITY, f64::min);
    if !min_fiber_arclength.is_finite() || min_fiber_arclength <= NORM_EPS {
        bail!("HKO continuation did not produce a valid common fiber length.");
    }
    let usable_arclength = target_arclength.min(min_fiber_arclength);
    let max_rings = settings.caps.max_rings.max(2);
    let max_vertices = settings.caps.max_vertices.max(phase_cycle.len() * 2);
    let max_rings_by_vertices = (max_vertices / phase_cycle.len().max(1)).max(2);
    let requested_rings = ((usable_arclength / settings.leaf_delta.max(1e-9)).ceil() as usize)
        .saturating_add(1)
        .max(2);
    let ring_count = requested_rings
        .min(max_rings)
        .min(max_rings_by_vertices)
        .max(2);
    let mut rings = Vec::with_capacity(ring_count);
    let mut ring_diagnostics = Vec::with_capacity(ring_count);
    for ring_index in 0..ring_count {
        let arclength = usable_arclength * (ring_index as f64) / ((ring_count - 1) as f64);
        let ring = fibers
            .iter()
            .map(|fiber| sample_open_curve_at_arclength(fiber, arclength))
            .collect::<Vec<_>>();
        ring_diagnostics.push(ManifoldRingDiagnostic {
            ring_index,
            radius_estimate: arclength,
            point_count: ring.len(),
        });
        if let Some(callback) = on_ring_progress.as_deref_mut() {
            callback(
                ring_index + 1,
                (ring_index + 1) * ring.len(),
                arclength,
                arclength,
            );
        }
        rings.push(ring);
    }
    let mut vertices = Vec::new();
    let mut ring_offsets = Vec::with_capacity(rings.len());
    for ring in &rings {
        ring_offsets.push(vertices.len());
        vertices.extend(ring.iter().cloned());
    }
    let uniform_parent_anchors = (0..rings.len())
        .map(|ring_index| {
            if ring_index == 0 {
                Vec::new()
            } else {
                (0..phase_cycle.len())
                    .map(|index| (index as f64) / (phase_cycle.len() as f64))
                    .collect()
            }
        })
        .collect::<Vec<Vec<f64>>>();
    let triangles =
        triangulate_ring_bands_with_parent_anchors(&rings, &ring_offsets, &uniform_parent_anchors);
    let termination_reason = fiber_surface_termination_reason(
        bounds_exit,
        min_fiber_arclength + 1e-8 >= target_arclength,
        requested_rings,
        max_rings,
        max_rings_by_vertices,
    );
    let solver_diagnostics = ManifoldSurfaceSolverDiagnostics {
        termination_reason: termination_reason.as_str().to_string(),
        termination_detail: Some(format!(
            "HKO fundamental-segment continuation: phases={}, rings={}, achieved_arclength={:.6e}, target_arclength={:.6e}, return_time={:.6e}, bvp_intervals={}, ncol={}, fundamental_solves={}, continuation_solves={}, rejected_nonconverged={}, max_residual={:.3e}, max_iterations={}, max_phase_shear={:.3e}, max_lift_off={:.3e}",
            phase_cycle.len(),
            ring_count,
            usable_arclength,
            target_arclength,
            return_time,
            bvp_intervals,
            bvp_degree,
            stats.fundamental_solves,
            stats.continuation_solves,
            stats.nonconverged,
            stats.max_residual,
            stats.max_iterations,
            stats.max_fundamental_phase_shear,
            stats.max_fundamental_lift_off
        )),
        final_leaf_delta: settings.leaf_delta.max(1e-9),
        ring_attempts: stats.solves,
        build_failures: stats.nonconverged,
        leaf_delta_floor: settings.delta_min.max(1e-12),
        min_leaf_delta_reached: false,
        ..ManifoldSurfaceSolverDiagnostics::default()
    };
    build_cycle_manifold_branch(
        dim,
        SurfaceGrowthResult {
            vertices,
            triangles,
            ring_offsets,
            ring_diagnostics,
            solver_diagnostics,
            resume_state: Some(ManifoldSurfaceResumeState::HkoIsochronFibers {
                version: 1,
                fibers: fiber_resume_states,
                emitted_arclength: usable_arclength,
                sigma,
                return_time,
                bvp_intervals,
                bvp_degree,
            }),
        },
        settings,
        floquet_index,
        ntst,
        ncol,
        "hko_fundamental_segment_bvp",
    )
}

#[allow(clippy::too_many_arguments)]
fn continue_limit_cycle_manifold_2d_segmented_preimage(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    cycle_profile: &DecodedCycleProfile,
    floquet_index: usize,
    multiplier: Complex<f64>,
    settings: &ManifoldCycle2DSettings,
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> Result<ContinuationBranch> {
    if settings.direction == ManifoldDirection::Both {
        bail!(
            "Isochron-fiber cycle manifolds require Plus or Minus direction; compute the two sheets separately."
        );
    }
    if !multiplier.im.abs().is_finite() || multiplier.im.abs() > EIG_IM_TOL {
        bail!("Isochron-fiber cycle manifolds require a real Floquet multiplier.");
    }
    let period = cycle_profile.period;
    if !period.is_finite() || period <= 0.0 {
        bail!("Isochron-fiber cycle manifolds require a positive limit-cycle period.");
    }

    let dim = system.equations.len();
    let phase_points = settings.ring_points.max(8);
    let (cycle, floquet_dirs, multiplier) = build_cycle_floquet_seed(
        system,
        cycle_state,
        cycle_profile,
        ntst,
        ncol,
        settings.parameter_index,
        multiplier,
        phase_points,
        settings.integration_dt.abs().max(1e-9),
        settings.caps.max_steps.max(2),
        settings.caps.max_time.max(period).max(1e-9),
    )?;
    if cycle.len() != floquet_dirs.len() || cycle.len() < 4 {
        bail!("Cycle manifold initialization failed to build a valid Floquet seed ring.");
    }

    let (phase_cycle, phase_dirs, return_time) = build_isochron_phase_cover(
        &cycle,
        &floquet_dirs,
        multiplier.re,
        settings.direction,
        period,
    )?;
    let sigma = -stability_sigma(settings.stability);
    let leaf_delta = settings.leaf_delta.max(1e-9);
    let target_arclength = settings
        .target_arclength
        .max(settings.initial_radius.max(1e-9));
    let max_rings = settings.caps.max_rings.max(2);
    let max_vertices = settings.caps.max_vertices.max(phase_cycle.len() * 2);
    let max_rings_by_vertices = (max_vertices / phase_cycle.len().max(1)).max(2);
    let bvp_intervals = effective_isochron_bvp_intervals(settings, ntst);
    let bvp_degree = effective_isochron_bvp_degree(settings, ncol);
    let dt = settings.integration_dt.abs().max(1e-9);
    let return_segments =
        effective_isochron_return_segments(multiplier.re, phase_cycle.len().max(1));
    let segment_duration = return_time / (return_segments as f64);
    let phase_shift_per_segment = sigma / (return_segments as f64);
    let max_steps_per_segment = settings
        .caps
        .max_steps
        .max((segment_duration / dt).ceil() as usize + 2)
        .max(2);
    let max_time = settings.caps.max_time.max(segment_duration).max(1e-9);
    let per_phase_segment_cap = settings.caps.max_steps.max(max_rings).max(2);

    let mut stats = IsochronBvpStats::default();
    let (fibers, current_ring, arclengths, bounds_exit) = build_isochron_segmented_fibers(
        system,
        &phase_cycle,
        &phase_dirs,
        settings,
        sigma,
        segment_duration,
        phase_shift_per_segment,
        bvp_intervals,
        bvp_degree,
        dt,
        max_steps_per_segment,
        max_time,
        per_phase_segment_cap,
        &mut stats,
    )?;

    let min_fiber_arclength = fibers
        .iter()
        .map(|fiber| open_curve_arclength(fiber))
        .fold(f64::INFINITY, f64::min);
    if !min_fiber_arclength.is_finite() || min_fiber_arclength <= NORM_EPS {
        bail!("Isochron-fiber cycle manifold did not produce a valid fiber length.");
    }
    let usable_arclength = target_arclength.min(min_fiber_arclength);
    let requested_rings = ((usable_arclength / leaf_delta).ceil() as usize)
        .saturating_add(1)
        .max(2);
    let ring_count = requested_rings
        .min(max_rings)
        .min(max_rings_by_vertices)
        .max(2);
    let mut rings: Vec<Vec<Vec<f64>>> = Vec::with_capacity(ring_count);
    let mut ring_diagnostics = Vec::with_capacity(ring_count);
    for ring_index in 0..ring_count {
        let s = if ring_count <= 1 {
            0.0
        } else {
            usable_arclength * (ring_index as f64) / ((ring_count - 1) as f64)
        };
        let ring = fibers
            .iter()
            .map(|fiber| sample_open_curve_at_arclength(fiber, s))
            .collect::<Vec<_>>();
        ring_diagnostics.push(ManifoldRingDiagnostic {
            ring_index,
            radius_estimate: s,
            point_count: ring.len(),
        });
        if let Some(callback) = on_ring_progress.as_deref_mut() {
            callback(ring_index + 1, ring_count, s, leaf_delta);
        }
        rings.push(ring);
    }

    let mut vertices = Vec::new();
    let mut ring_offsets = Vec::with_capacity(rings.len());
    for ring in &rings {
        ring_offsets.push(vertices.len());
        for point in ring {
            vertices.push(point.clone());
        }
    }
    let triangles = triangulate_ring_bands(&rings, &ring_offsets);

    let termination_reason = fiber_surface_termination_reason(
        bounds_exit,
        min_fiber_arclength + 1e-8 >= target_arclength,
        requested_rings,
        max_rings,
        max_rings_by_vertices,
    );
    let mut solver_diagnostics = ManifoldSurfaceSolverDiagnostics {
        termination_reason: termination_reason.as_str().to_string(),
        termination_detail: Some(format!(
            "segmented preimage fibers: phases={}, rings={}, return_time={:.6e}, return_segments={}, segment_time={:.6e}, bvp_intervals={}, ncol={}, bvp_solves={}, rejected_nonconverged={}, max_residual={:.3e}, max_iterations={}",
            phase_cycle.len(),
            ring_count,
            return_time,
            return_segments,
            segment_duration,
            bvp_intervals,
            bvp_degree,
            stats.solves,
            stats.nonconverged,
            stats.max_residual,
            stats.max_iterations
        )),
        final_leaf_delta: leaf_delta,
        ring_attempts: stats.solves,
        build_failures: stats.nonconverged,
        leaf_delta_floor: settings.delta_min.max(1e-12),
        min_leaf_delta_reached: leaf_delta <= settings.delta_min.max(1e-12) + 1e-15,
        ..ManifoldSurfaceSolverDiagnostics::default()
    };
    if stats.last_nonconverged_phase.is_some() {
        solver_diagnostics.last_leaf_failure_reason =
            Some("isochron_bvp_nonconvergence".to_string());
        solver_diagnostics.last_leaf_failure_point = stats.last_nonconverged_phase;
    }

    build_cycle_manifold_branch(
        dim,
        SurfaceGrowthResult {
            vertices,
            triangles,
            ring_offsets,
            ring_diagnostics,
            solver_diagnostics,
            resume_state: Some(ManifoldSurfaceResumeState::SegmentedPreimageFibers {
                version: 1,
                fibers,
                current_ring,
                arclengths,
                emitted_arclength: usable_arclength,
                sigma,
                segment_duration,
                phase_shift_per_segment,
                bvp_intervals,
                bvp_degree,
            }),
        },
        settings,
        floquet_index,
        ntst,
        ncol,
        "segmented_preimage_collocation",
    )
}

fn effective_isochron_bvp_intervals(settings: &ManifoldCycle2DSettings, ntst: usize) -> usize {
    let requested = if settings.ntst > 0 {
        settings.ntst
    } else {
        ntst
    };
    requested.max(2).clamp(2, 16)
}

fn effective_isochron_bvp_degree(settings: &ManifoldCycle2DSettings, ncol: usize) -> usize {
    let requested = if settings.ncol > 0 {
        settings.ncol
    } else {
        ncol
    };
    requested.max(1).clamp(1, 4)
}

fn effective_isochron_return_segments(multiplier: f64, phase_count: usize) -> usize {
    let mu = multiplier.abs().max(1e-300);
    let by_growth = if mu.is_finite() {
        (mu.ln().abs() / ISOCHRON_MAX_SEGMENT_EXPANSION.ln()).ceil() as usize
    } else {
        ISOCHRON_MAX_RETURN_SEGMENTS
    };
    by_growth
        .max(1)
        .max(phase_count / 2)
        .min(ISOCHRON_MAX_RETURN_SEGMENTS)
}

fn build_isochron_phase_cover(
    cycle: &[Vec<f64>],
    floquet_dirs: &[Vec<f64>],
    multiplier: f64,
    direction: ManifoldDirection,
    period: f64,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>, f64)> {
    if cycle.len() != floquet_dirs.len() || cycle.is_empty() {
        bail!("Cycle and Floquet direction samples must have matching nonzero length.");
    }
    let first_sign = match direction {
        ManifoldDirection::Plus => 1.0,
        ManifoldDirection::Minus => -1.0,
        ManifoldDirection::Both => {
            bail!("Isochron-fiber cycle manifolds require Plus or Minus direction.")
        }
    };
    let mut out_cycle = Vec::with_capacity(if multiplier < 0.0 {
        cycle.len() * 2
    } else {
        cycle.len()
    });
    let mut out_dirs = Vec::with_capacity(out_cycle.capacity());
    for (point, direction) in cycle.iter().zip(floquet_dirs.iter()) {
        out_cycle.push(point.clone());
        out_dirs.push(scaled_unit_direction(direction, first_sign)?);
    }
    if multiplier < 0.0 {
        for (point, direction) in cycle.iter().zip(floquet_dirs.iter()) {
            out_cycle.push(point.clone());
            out_dirs.push(scaled_unit_direction(direction, -first_sign)?);
        }
        Ok((out_cycle, out_dirs, 2.0 * period))
    } else {
        Ok((out_cycle, out_dirs, period))
    }
}

fn scaled_unit_direction(direction: &[f64], sign: f64) -> Result<Vec<f64>> {
    let mut unit = normalize(direction.to_vec())?;
    for value in &mut unit {
        *value *= sign;
    }
    Ok(unit)
}

#[derive(Default)]
struct IsochronBvpStats {
    solves: usize,
    fundamental_solves: usize,
    continuation_solves: usize,
    nonconverged: usize,
    max_residual: f64,
    max_iterations: usize,
    max_fundamental_phase_shear: f64,
    max_fundamental_lift_off: f64,
    last_nonconverged_phase: Option<usize>,
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn build_isochron_segmented_fibers(
    system: &EquationSystem,
    phase_cycle: &[Vec<f64>],
    phase_dirs: &[Vec<f64>],
    settings: &ManifoldCycle2DSettings,
    sigma: f64,
    segment_duration: f64,
    phase_shift_per_segment: f64,
    bvp_intervals: usize,
    bvp_degree: usize,
    dt: f64,
    max_steps_per_segment: usize,
    max_time: f64,
    per_phase_segment_cap: usize,
    stats: &mut IsochronBvpStats,
) -> Result<(Vec<Vec<Vec<f64>>>, Vec<Vec<f64>>, Vec<f64>, bool)> {
    if phase_cycle.len() != phase_dirs.len() || phase_cycle.is_empty() {
        bail!("Isochron phase cycle and direction samples must match.");
    }
    let dim = phase_cycle[0].len();
    let radius = settings.initial_radius.max(1e-9);
    let mut fibers = Vec::with_capacity(phase_cycle.len());
    let mut current_ring = Vec::with_capacity(phase_cycle.len());
    for (phase_point, direction) in phase_cycle.iter().zip(phase_dirs.iter()) {
        if phase_point.len() != dim || direction.len() != dim {
            bail!("Isochron fiber seed dimension mismatch.");
        }
        let mut seed = phase_point.clone();
        for i in 0..dim {
            seed[i] += radius * direction[i];
        }
        fibers.push(vec![phase_point.clone(), seed.clone()]);
        current_ring.push(seed);
    }

    let arclengths = fibers
        .iter()
        .map(|fiber| open_curve_arclength(fiber))
        .collect::<Vec<_>>();
    continue_isochron_segmented_fibers(
        system,
        fibers,
        current_ring,
        arclengths,
        settings.target_arclength.max(radius),
        settings,
        sigma,
        segment_duration,
        phase_shift_per_segment,
        bvp_intervals,
        bvp_degree,
        dt,
        max_steps_per_segment,
        max_time,
        per_phase_segment_cap,
        stats,
    )
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn continue_isochron_segmented_fibers(
    system: &EquationSystem,
    mut fibers: Vec<Vec<Vec<f64>>>,
    mut current_ring: Vec<Vec<f64>>,
    mut arclengths: Vec<f64>,
    target_arclength: f64,
    settings: &ManifoldCycle2DSettings,
    sigma: f64,
    segment_duration: f64,
    phase_shift_per_segment: f64,
    bvp_intervals: usize,
    bvp_degree: usize,
    dt: f64,
    max_steps_per_segment: usize,
    max_time: f64,
    per_phase_segment_cap: usize,
    stats: &mut IsochronBvpStats,
) -> Result<(Vec<Vec<Vec<f64>>>, Vec<Vec<f64>>, Vec<f64>, bool)> {
    if fibers.is_empty() || fibers.len() != current_ring.len() || fibers.len() != arclengths.len() {
        bail!("Stored segmented-preimage fiber frontier is inconsistent.");
    }
    let mut bounds_exit = false;
    let segment_cap = per_phase_segment_cap.max(2);
    for _segment_index in 0..segment_cap {
        let min_arclength = arclengths.iter().copied().fold(f64::INFINITY, f64::min);
        if min_arclength.is_finite() && min_arclength >= target_arclength {
            break;
        }
        let mut next_ring = Vec::with_capacity(current_ring.len());
        for phase_index in 0..current_ring.len() {
            let phase = (phase_index as f64) / (current_ring.len() as f64);
            let endpoint = sample_ring_uniform(&current_ring, phase + phase_shift_per_segment);
            let solve = solve_isochron_return_preimage_bvp(
                system,
                &endpoint,
                sigma,
                segment_duration,
                bvp_intervals,
                bvp_degree,
                dt,
                max_steps_per_segment,
                max_time,
            )?;
            stats.solves += 1;
            stats.max_residual = stats.max_residual.max(solve.residual_norm);
            stats.max_iterations = stats.max_iterations.max(solve.iterations);
            if !solve.converged {
                stats.nonconverged += 1;
                stats.last_nonconverged_phase = Some(phase_index);
                require_converged_isochron_bvp(
                    &solve,
                    &format!(
                        "Segmented preimage collocation at phase {}",
                        phase_index + 1
                    ),
                )?;
            }
            let next = solve.start;
            if next.iter().any(|value| !value.is_finite()) {
                bail!("Isochron BVP produced a non-finite fiber point.");
            }
            if let Some(bounds) = settings.bounds.as_ref() {
                if !inside_bounds(&next, bounds) {
                    bounds_exit = true;
                }
            }
            next_ring.push(next);
        }
        let mut made_progress = false;
        for phase_index in 0..next_ring.len() {
            let step = l2_distance(&current_ring[phase_index], &next_ring[phase_index]);
            if step > NORM_EPS && step.is_finite() {
                arclengths[phase_index] += step;
                made_progress = true;
            }
            fibers[phase_index].push(next_ring[phase_index].clone());
        }
        current_ring = next_ring;
        if bounds_exit || !made_progress {
            break;
        }
    }
    Ok((fibers, current_ring, arclengths, bounds_exit))
}

#[derive(Clone)]
struct IsochronBvpSolution {
    start: Vec<f64>,
    unknown: Vec<f64>,
    residual_norm: f64,
    iterations: usize,
    converged: bool,
}

fn require_converged_isochron_bvp(solve: &IsochronBvpSolution, context: &str) -> Result<()> {
    if solve.converged && solve.residual_norm.is_finite() {
        return Ok(());
    }
    bail!(
        "{} did not converge: residual {:.3e} after {} Newton iterations.",
        context,
        solve.residual_norm,
        solve.iterations
    )
}

fn solve_isochron_return_preimage_bvp(
    system: &EquationSystem,
    endpoint: &[f64],
    sigma: f64,
    duration: f64,
    intervals: usize,
    degree: usize,
    dt: f64,
    max_steps: usize,
    max_time: f64,
) -> Result<IsochronBvpSolution> {
    solve_isochron_return_preimage_bvp_with_guess(
        system, endpoint, sigma, duration, intervals, degree, dt, max_steps, max_time, None,
    )
}

#[allow(clippy::too_many_arguments)]
fn solve_isochron_return_preimage_bvp_with_guess(
    system: &EquationSystem,
    endpoint: &[f64],
    sigma: f64,
    duration: f64,
    intervals: usize,
    degree: usize,
    dt: f64,
    max_steps: usize,
    max_time: f64,
    initial_guess: Option<&[f64]>,
) -> Result<IsochronBvpSolution> {
    let intervals = intervals.max(1);
    let degree = degree.max(1);
    let coeffs = CollocationCoefficients::new(degree)?;
    let expected_unknowns = isochron_unknown_count(intervals, coeffs.nodes.len(), endpoint.len());
    let mut unknown =
        if let Some(guess) = initial_guess.filter(|guess| guess.len() == expected_unknowns) {
            let mut guess = guess.to_vec();
            let final_offset = isochron_mesh_offset(intervals, endpoint.len());
            let shift = endpoint
                .iter()
                .enumerate()
                .map(|(index, value)| value - guess[final_offset + index])
                .collect::<Vec<_>>();
            for mesh in 0..=intervals {
                let weight = (mesh as f64) / (intervals as f64);
                let offset = isochron_mesh_offset(mesh, endpoint.len());
                for index in 0..endpoint.len() {
                    guess[offset + index] += weight * shift[index];
                }
            }
            for interval in 0..intervals {
                for (stage, node) in coeffs.nodes.iter().enumerate() {
                    let weight = ((interval as f64) + *node) / (intervals as f64);
                    let offset = isochron_stage_offset(
                        interval,
                        stage,
                        intervals,
                        coeffs.nodes.len(),
                        endpoint.len(),
                    );
                    for index in 0..endpoint.len() {
                        guess[offset + index] += weight * shift[index];
                    }
                }
            }
            guess
        } else {
            build_isochron_open_orbit_initial_guess(
                system, endpoint, sigma, duration, intervals, &coeffs, dt, max_steps, max_time,
            )?
        };
    let unknowns = unknown.len();
    let mut residual = vec![0.0; unknowns];
    evaluate_isochron_open_orbit_residual(
        system,
        &unknown,
        endpoint,
        sigma,
        duration,
        intervals,
        &coeffs,
        &mut residual,
    )?;
    let mut residual_norm = l2_norm(&residual);
    if residual_norm <= ISOCHRON_BVP_NEWTON_TOL {
        return Ok(IsochronBvpSolution {
            start: unknown[..endpoint.len()].to_vec(),
            unknown,
            residual_norm,
            iterations: 0,
            converged: true,
        });
    }

    let mut converged = false;
    let mut iterations = 0usize;
    for iter in 0..ISOCHRON_BVP_NEWTON_MAX_ITERS {
        iterations = iter + 1;
        let jac = build_isochron_open_orbit_jacobian(
            system,
            &unknown,
            sigma,
            duration,
            intervals,
            &coeffs,
            endpoint.len(),
        )?;
        let rhs = residual.iter().map(|value| -value).collect::<Vec<_>>();
        let Some(delta) = solve_dense_linear_system(unknowns, &jac, &rhs) else {
            break;
        };
        let mut accepted = false;
        let mut damping = 1.0;
        for _ in 0..ISOCHRON_BVP_LINE_SEARCH_STEPS {
            let candidate = unknown
                .iter()
                .zip(delta.iter())
                .map(|(value, step)| value + damping * step)
                .collect::<Vec<_>>();
            if candidate.iter().any(|value| !value.is_finite()) {
                damping *= 0.5;
                continue;
            }
            let mut candidate_residual = vec![0.0; unknowns];
            evaluate_isochron_open_orbit_residual(
                system,
                &candidate,
                endpoint,
                sigma,
                duration,
                intervals,
                &coeffs,
                &mut candidate_residual,
            )?;
            let candidate_norm = l2_norm(&candidate_residual);
            if candidate_norm.is_finite() && candidate_norm < residual_norm {
                unknown = candidate;
                residual = candidate_residual;
                residual_norm = candidate_norm;
                accepted = true;
                break;
            }
            damping *= 0.5;
        }
        if residual_norm <= ISOCHRON_BVP_NEWTON_TOL {
            converged = true;
            break;
        }
        if !accepted {
            break;
        }
    }

    Ok(IsochronBvpSolution {
        start: unknown[..endpoint.len()].to_vec(),
        unknown,
        residual_norm,
        iterations,
        converged,
    })
}

fn build_isochron_open_orbit_initial_guess(
    system: &EquationSystem,
    endpoint: &[f64],
    sigma: f64,
    duration: f64,
    intervals: usize,
    coeffs: &CollocationCoefficients,
    dt: f64,
    max_steps: usize,
    max_time: f64,
) -> Result<Vec<f64>> {
    let dim = endpoint.len();
    let start = integrate_state_only(system, endpoint, duration, -sigma, dt, max_steps, max_time)
        .ok_or_else(|| {
        anyhow!("Isochron BVP preimage integration produced a non-finite state.")
    })?;
    let total_points = intervals + 1 + intervals * coeffs.nodes.len();
    let mut unknown = vec![0.0; total_points * dim];
    for mesh in 0..=intervals {
        let tau = duration * (mesh as f64) / (intervals as f64);
        let point = integrate_state_only(system, &start, tau, sigma, dt, max_steps, max_time)
            .ok_or_else(|| anyhow!("Isochron BVP mesh initialization failed."))?;
        let offset = isochron_mesh_offset(mesh, dim);
        unknown[offset..offset + dim].copy_from_slice(&point);
    }
    for interval in 0..intervals {
        for (stage, node) in coeffs.nodes.iter().enumerate() {
            let tau = duration * ((interval as f64) + *node) / (intervals as f64);
            let point = integrate_state_only(system, &start, tau, sigma, dt, max_steps, max_time)
                .ok_or_else(|| anyhow!("Isochron BVP stage initialization failed."))?;
            let offset = isochron_stage_offset(interval, stage, intervals, coeffs.nodes.len(), dim);
            unknown[offset..offset + dim].copy_from_slice(&point);
        }
    }
    Ok(unknown)
}

fn evaluate_isochron_open_orbit_residual(
    system: &EquationSystem,
    unknown: &[f64],
    endpoint: &[f64],
    sigma: f64,
    duration: f64,
    intervals: usize,
    coeffs: &CollocationCoefficients,
    out: &mut [f64],
) -> Result<()> {
    let dim = endpoint.len();
    let degree = coeffs.nodes.len();
    let expected = isochron_unknown_count(intervals, degree, dim);
    if unknown.len() != expected || out.len() != expected {
        bail!("Isochron BVP residual dimension mismatch.");
    }
    let h = duration / (intervals as f64);
    let mut stage_f = vec![vec![0.0; dim]; degree];
    for interval in 0..intervals {
        for stage in 0..degree {
            let stage_offset = isochron_stage_offset(interval, stage, intervals, degree, dim);
            system.apply(
                0.0,
                &unknown[stage_offset..stage_offset + dim],
                &mut stage_f[stage],
            );
            for value in &mut stage_f[stage] {
                *value *= sigma;
            }
        }
        let base_offset = isochron_mesh_offset(interval, dim);
        for stage in 0..degree {
            let row_offset = (interval * degree + stage) * dim;
            let stage_offset = isochron_stage_offset(interval, stage, intervals, degree, dim);
            for r in 0..dim {
                let mut sum = 0.0;
                for k in 0..degree {
                    sum += coeffs.a[stage][k] * stage_f[k][r];
                }
                out[row_offset + r] =
                    unknown[stage_offset + r] - unknown[base_offset + r] - h * sum;
            }
        }
        let continuity_offset = intervals * degree * dim + interval * dim;
        let next_offset = isochron_mesh_offset(interval + 1, dim);
        for r in 0..dim {
            let mut sum = 0.0;
            for k in 0..degree {
                sum += coeffs.b[k] * stage_f[k][r];
            }
            out[continuity_offset + r] =
                unknown[next_offset + r] - unknown[base_offset + r] - h * sum;
        }
    }
    let terminal_offset = intervals * degree * dim + intervals * dim;
    let final_mesh_offset = isochron_mesh_offset(intervals, dim);
    for r in 0..dim {
        out[terminal_offset + r] = unknown[final_mesh_offset + r] - endpoint[r];
    }
    Ok(())
}

fn build_isochron_open_orbit_jacobian(
    system: &EquationSystem,
    unknown: &[f64],
    sigma: f64,
    duration: f64,
    intervals: usize,
    coeffs: &CollocationCoefficients,
    dim: usize,
) -> Result<Vec<f64>> {
    let degree = coeffs.nodes.len();
    let unknowns = isochron_unknown_count(intervals, degree, dim);
    if unknown.len() != unknowns {
        bail!("Isochron BVP Jacobian dimension mismatch.");
    }
    let h = duration / (intervals as f64);
    let mut matrix = vec![0.0; unknowns * unknowns];
    for interval in 0..intervals {
        let mut stage_jacs = Vec::with_capacity(degree);
        for stage in 0..degree {
            let offset = isochron_stage_offset(interval, stage, intervals, degree, dim);
            let mut jac =
                compute_jacobian(system, SystemKind::Flow, &unknown[offset..offset + dim])?;
            for value in &mut jac {
                *value *= sigma;
            }
            stage_jacs.push(jac);
        }

        let mesh_col = isochron_mesh_offset(interval, dim);
        let next_mesh_col = isochron_mesh_offset(interval + 1, dim);
        for stage in 0..degree {
            let row = (interval * degree + stage) * dim;
            let stage_col = isochron_stage_offset(interval, stage, intervals, degree, dim);
            for r in 0..dim {
                matrix[(row + r) * unknowns + mesh_col + r] -= 1.0;
                matrix[(row + r) * unknowns + stage_col + r] += 1.0;
                for col_stage in 0..degree {
                    let col = isochron_stage_offset(interval, col_stage, intervals, degree, dim);
                    let jac = &stage_jacs[col_stage];
                    for c in 0..dim {
                        matrix[(row + r) * unknowns + col + c] -=
                            h * coeffs.a[stage][col_stage] * jac[r * dim + c];
                    }
                }
            }
        }

        let row = intervals * degree * dim + interval * dim;
        for r in 0..dim {
            matrix[(row + r) * unknowns + mesh_col + r] -= 1.0;
            matrix[(row + r) * unknowns + next_mesh_col + r] += 1.0;
            for stage in 0..degree {
                let col = isochron_stage_offset(interval, stage, intervals, degree, dim);
                let jac = &stage_jacs[stage];
                for c in 0..dim {
                    matrix[(row + r) * unknowns + col + c] -=
                        h * coeffs.b[stage] * jac[r * dim + c];
                }
            }
        }
    }
    let terminal_row = intervals * degree * dim + intervals * dim;
    let final_mesh_col = isochron_mesh_offset(intervals, dim);
    for r in 0..dim {
        matrix[(terminal_row + r) * unknowns + final_mesh_col + r] = 1.0;
    }
    Ok(matrix)
}

fn isochron_unknown_count(intervals: usize, degree: usize, dim: usize) -> usize {
    (intervals + 1 + intervals * degree) * dim
}

fn isochron_mesh_offset(mesh: usize, dim: usize) -> usize {
    mesh * dim
}

fn isochron_stage_offset(
    interval: usize,
    stage: usize,
    intervals: usize,
    degree: usize,
    dim: usize,
) -> usize {
    (intervals + 1 + interval * degree + stage) * dim
}

struct SurfaceGrowthResult {
    vertices: Vec<Vec<f64>>,
    triangles: Vec<usize>,
    ring_offsets: Vec<usize>,
    ring_diagnostics: Vec<ManifoldRingDiagnostic>,
    solver_diagnostics: ManifoldSurfaceSolverDiagnostics,
    resume_state: Option<ManifoldSurfaceResumeState>,
}

#[derive(Clone, Copy)]
struct SurfaceGrowthControls {
    delta_min: f64,
    min_spacing: f64,
    max_spacing: f64,
    alpha_min: f64,
    alpha_max: f64,
    delta_alpha_min: f64,
    delta_alpha_max: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SurfaceTerminationReason {
    MaxSteps,
    MaxRings,
    MaxVertices,
    TargetRadius,
    TargetArclength,
    BoundsExit,
    RingTooSmall,
    RingBuildFailed,
    RingSpacingFailed,
    RingQualityRejected,
    GeodesicQualityRejected,
    RingCandidateTooSmall,
}

impl SurfaceTerminationReason {
    fn as_str(self) -> &'static str {
        match self {
            SurfaceTerminationReason::MaxSteps => "max_steps",
            SurfaceTerminationReason::MaxRings => "max_rings",
            SurfaceTerminationReason::MaxVertices => "max_vertices",
            SurfaceTerminationReason::TargetRadius => "target_radius",
            SurfaceTerminationReason::TargetArclength => "target_arclength",
            SurfaceTerminationReason::BoundsExit => "bounds_exit",
            SurfaceTerminationReason::RingTooSmall => "ring_too_small",
            SurfaceTerminationReason::RingBuildFailed => "ring_build_failed",
            SurfaceTerminationReason::RingSpacingFailed => "ring_spacing_failed",
            SurfaceTerminationReason::RingQualityRejected => "ring_quality_rejected",
            SurfaceTerminationReason::GeodesicQualityRejected => "geodesic_quality_rejected",
            SurfaceTerminationReason::RingCandidateTooSmall => "ring_candidate_too_small",
        }
    }
}

fn fiber_surface_termination_reason(
    bounds_exit: bool,
    fiber_target_reached: bool,
    requested_rings: usize,
    max_rings: usize,
    max_rings_by_vertices: usize,
) -> SurfaceTerminationReason {
    if bounds_exit {
        SurfaceTerminationReason::BoundsExit
    } else if !fiber_target_reached {
        SurfaceTerminationReason::MaxSteps
    } else if requested_rings > max_rings_by_vertices && max_rings_by_vertices <= max_rings {
        SurfaceTerminationReason::MaxVertices
    } else if requested_rings > max_rings {
        SurfaceTerminationReason::MaxRings
    } else {
        SurfaceTerminationReason::TargetArclength
    }
}

#[derive(Clone, Copy, Default)]
struct RingQuality {
    max_turn_angle: f64,
    max_distance_angle: f64,
}

#[derive(Clone, Debug)]
struct RingSolve {
    points: Vec<Vec<f64>>,
    base_anchors: Vec<f64>,
    in_anchors: Vec<Vec<f64>>,
    leaf_deltas: Vec<f64>,
}

#[derive(Clone)]
struct RingLayer {
    points: Vec<Vec<f64>>,
    in_anchors: Vec<Vec<f64>>,
    parent_anchors: Vec<f64>,
}

struct GeodesicGrowthSeed {
    outer_ring: Vec<Vec<f64>>,
    inward_anchors: Vec<Vec<f64>>,
    current_leaf_delta: f64,
    accumulated_arclength: f64,
    global_ring_index: usize,
    center: Option<Vec<f64>>,
}

#[derive(Clone, Copy, Debug)]
struct RingBuildFailure {
    solved_points: usize,
    reason: LeafFailureKind,
    point_index: usize,
    last_time: f64,
    last_segment: usize,
    last_tau: f64,
}

#[derive(Clone, Copy, Debug)]
enum RingSpacingFailure {
    InvalidCandidate,
    PointCapExceeded,
    InsertionDidNotSplitEdge,
    InsertionLeafFailed(LeafFailureKind),
}

impl RingSpacingFailure {
    fn as_str(self) -> &'static str {
        match self {
            RingSpacingFailure::InvalidCandidate => "invalid_candidate",
            RingSpacingFailure::PointCapExceeded => "point_cap_exceeded",
            RingSpacingFailure::InsertionDidNotSplitEdge => "insertion_did_not_split_edge",
            RingSpacingFailure::InsertionLeafFailed(_) => "insertion_leaf_failed",
        }
    }
}

#[derive(Clone)]
struct LeafHit {
    point: Vec<f64>,
    tau_hit: f64,
    base_anchor: f64,
    in_anchor: Vec<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LeafFailureKind {
    PlaneSolveNoConvergence,
    PlaneRootNotBracketed,
    #[allow(dead_code)]
    SegmentSwitchLimitExceeded,
    IntegratorNonFinite,
    NoFirstHitWithinMaxTime,
}

impl LeafFailureKind {
    fn as_str(self) -> &'static str {
        match self {
            LeafFailureKind::PlaneSolveNoConvergence => "PlaneSolveNoConvergence",
            LeafFailureKind::PlaneRootNotBracketed => "PlaneRootNotBracketed",
            LeafFailureKind::SegmentSwitchLimitExceeded => "SegmentSwitchLimitExceeded",
            LeafFailureKind::IntegratorNonFinite => "IntegratorNonFinite",
            LeafFailureKind::NoFirstHitWithinMaxTime => "NoFirstHitWithinMaxTime",
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct LeafFailure {
    kind: LeafFailureKind,
    last_time: f64,
    last_segment: usize,
    last_tau: f64,
}

#[derive(Clone, Copy, Default)]
struct GeodesicQuality {
    max_angle: f64,
    max_delta_angle: f64,
}

fn geodesic_quality_exceeds(quality: GeodesicQuality, controls: SurfaceGrowthControls) -> bool {
    quality.max_angle > controls.alpha_max || quality.max_delta_angle > controls.delta_alpha_max
}

fn record_leaf_failure_diagnostics(
    diagnostics: &mut ManifoldSurfaceSolverDiagnostics,
    reason: LeafFailureKind,
) {
    match reason {
        LeafFailureKind::PlaneSolveNoConvergence => diagnostics.leaf_fail_plane_no_convergence += 1,
        LeafFailureKind::PlaneRootNotBracketed => {
            diagnostics.leaf_fail_plane_root_not_bracketed += 1
        }
        LeafFailureKind::SegmentSwitchLimitExceeded => {
            diagnostics.leaf_fail_segment_switch_limit += 1
        }
        LeafFailureKind::IntegratorNonFinite => diagnostics.leaf_fail_integrator_non_finite += 1,
        LeafFailureKind::NoFirstHitWithinMaxTime => {
            diagnostics.leaf_fail_no_first_hit_within_max_time += 1
        }
    }
}

#[derive(Clone)]
struct Basis2D {
    center: Vec<f64>,
    e1: Vec<f64>,
    e2: Vec<f64>,
    kind: ManifoldEigenKind,
    indices: [usize; 2],
}

fn prepare_manifold_1d_source(
    system: &EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    stability: ManifoldStability,
    requested_index: Option<usize>,
    periodicity: &StatePeriodicity,
) -> Result<PreparedManifold1DSource> {
    let result = solve_equilibrium_with_periodicity(
        system,
        kind,
        equilibrium_state,
        NewtonSettings {
            max_steps: 25,
            damping: 1.0,
            tolerance: 1e-10,
        },
        periodicity,
    )?;

    let side_indices: Vec<usize> = result
        .eigenpairs
        .iter()
        .enumerate()
        .filter_map(|(index, pair)| {
            matches_stability_for_kind(Complex::new(pair.value.re, pair.value.im), kind, stability)
                .then_some(index)
        })
        .collect();
    if side_indices.len() != 1 {
        bail!(
            "Selected {} manifold dimension is {}; the 1D manifold solver requires dimension 1.",
            match stability {
                ManifoldStability::Stable => "stable",
                ManifoldStability::Unstable => "unstable",
            },
            side_indices.len()
        );
    }

    let selected_index = side_indices[0];
    if let Some(index) = requested_index {
        if index != selected_index {
            bail!(
                "Requested eigen index {} is not an eligible real mode.",
                index.saturating_add(1)
            );
        }
    }
    let pair = &result.eigenpairs[selected_index];
    if pair.value.im.abs() > EIG_IM_TOL {
        bail!("The one-dimensional manifold direction is not a real eigenmode.");
    }
    let vector = canonical_real_eigenvector(pair)?;
    let mode = RealEigenMode {
        index: selected_index,
        value: Complex::new(pair.value.re, pair.value.im),
        vector,
    };

    if matches!(stability, ManifoldStability::Stable) && kind.is_map() {
        let jacobian =
            compute_system_jacobian_with_periodicity(system, kind, &result.state, periodicity)?;
        let dim = result.state.len();
        let matrix = DMatrix::from_row_slice(dim, dim, &jacobian);
        let singular_values = SVD::new(matrix, false, false).singular_values;
        let largest = singular_values.iter().copied().fold(0.0_f64, f64::max);
        let smallest = singular_values
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        if !smallest.is_finite() || smallest <= 1e-10 * largest.max(1.0) {
            bail!(
                "Stable map manifold growth requires a locally invertible return map (smallest singular value {}).",
                smallest
            );
        }
    }

    let map_iterations = kind.map_iterations();
    let least_period = if kind.is_map() {
        let mut period = map_iterations;
        for divisor in 1..map_iterations {
            if map_iterations % divisor != 0 {
                continue;
            }
            let mapped =
                apply_map_iterates_with_periodicity(system, &result.state, divisor, periodicity)
                    .ok_or_else(|| {
                        anyhow!("Map cycle period validation produced a non-finite state.")
                    })?;
            let scale = 1.0 + l2_norm(&result.state).max(l2_norm(&mapped));
            if periodic_l2_distance(&mapped, &result.state, periodicity) <= 1e-8 * scale {
                period = divisor;
                break;
            }
        }
        if period != map_iterations {
            bail!(
                "Requested map cycle period is not minimal; least period is {}.",
                period
            );
        }
        Some(period)
    } else {
        None
    };

    let cycle_points = if kind.is_map() && map_iterations > 1 {
        result
            .cycle_points
            .clone()
            .unwrap_or_else(|| vec![result.state.clone()])
    } else {
        vec![result.state.clone()]
    };
    let correction_norm = periodic_l2_distance(equilibrium_state, &result.state, periodicity);

    Ok(PreparedManifold1DSource {
        state: result.state,
        cycle_points,
        mode,
        correction_norm,
        least_period,
    })
}

fn canonical_real_eigenvector(pair: &crate::equilibrium::EigenPair) -> Result<Vec<f64>> {
    let mut vector: Vec<Complex<f64>> = pair
        .vector
        .iter()
        .map(|entry| Complex::new(entry.re, entry.im))
        .collect();
    let pivot = vector
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.norm().total_cmp(&right.norm()))
        .map(|(_, value)| *value)
        .ok_or_else(|| anyhow!("Eigenvector is empty."))?;
    if pivot.norm() <= NORM_EPS {
        bail!("Eigenvector norm is too small.");
    }
    let phase = pivot.conj() / pivot.norm();
    for value in &mut vector {
        *value *= phase;
    }
    let imaginary_norm = vector
        .iter()
        .map(|entry| entry.im * entry.im)
        .sum::<f64>()
        .sqrt();
    let real = vector.iter().map(|entry| entry.re).collect::<Vec<_>>();
    let real_norm = l2_norm(&real);
    if real_norm <= NORM_EPS || imaginary_norm > 1e-7 * real_norm.max(1.0) {
        bail!("Failed to recover a real eigenvector for the selected real eigenvalue.");
    }
    normalize(real)
}

#[allow(dead_code)]
fn select_real_eigenmode_with_kind(
    system: &EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    stability: ManifoldStability,
    requested_index: Option<usize>,
) -> Result<RealEigenMode> {
    Ok(prepare_manifold_1d_source(
        system,
        kind,
        equilibrium_state,
        stability,
        requested_index,
        &StatePeriodicity::none(),
    )?
    .mode)
}

fn select_2d_equilibrium_basis(
    system: &EquationSystem,
    equilibrium_state: &[f64],
    stability: ManifoldStability,
    requested_indices: Option<[usize; 2]>,
) -> Result<Basis2D> {
    let result = solve_equilibrium(
        system,
        SystemKind::Flow,
        equilibrium_state,
        NewtonSettings {
            max_steps: 8,
            damping: 1.0,
            tolerance: 1e-10,
        },
    )?;
    let side_dimension = result
        .eigenpairs
        .iter()
        .filter(|pair| matches_stability(pair.value.re, stability))
        .count();
    if side_dimension != 2 {
        bail!(
            "Selected {} manifold dimension is {}; the 2D manifold solver requires the full selected side to have dimension 2.",
            match stability {
                ManifoldStability::Stable => "stable",
                ManifoldStability::Unstable => "unstable",
            },
            side_dimension
        );
    }

    if let Some(indices) = requested_indices {
        let mode_a = result.eigenpairs.get(indices[0]).ok_or_else(|| {
            anyhow!(
                "Requested eigen index {} is out of range.",
                indices[0].saturating_add(1)
            )
        })?;
        let mode_b = result.eigenpairs.get(indices[1]).ok_or_else(|| {
            anyhow!(
                "Requested eigen index {} is out of range.",
                indices[1].saturating_add(1)
            )
        })?;
        if !matches_stability(mode_a.value.re, stability)
            || !matches_stability(mode_b.value.re, stability)
        {
            bail!("Requested eigen indices do not match the selected stability.");
        }
        let lambda_a = Complex::new(mode_a.value.re, mode_a.value.im);
        let lambda_b = Complex::new(mode_b.value.re, mode_b.value.im);
        let a_is_complex = lambda_a.im.abs() > EIG_IM_TOL;
        let b_is_complex = lambda_b.im.abs() > EIG_IM_TOL;

        if a_is_complex || b_is_complex {
            let source_mode = if indices[0] == indices[1] {
                if !a_is_complex {
                    bail!("Requested duplicate eigen index does not define a 2D eigenspace.");
                }
                mode_a
            } else {
                if !(a_is_complex && b_is_complex) {
                    bail!("Requested indices must both belong to the same complex-conjugate pair.");
                }
                let conjugate_mismatch = (lambda_a - lambda_b.conj()).norm();
                if conjugate_mismatch > 1e-6 {
                    bail!("Requested complex indices do not form a conjugate pair.");
                }
                if lambda_a.im >= 0.0 {
                    mode_a
                } else {
                    mode_b
                }
            };

            let vector: Vec<Complex<f64>> = source_mode
                .vector
                .iter()
                .map(|entry| Complex::new(entry.re, entry.im))
                .collect();
            let (e1, e2) = orthonormal_complex_pair_basis(&vector)?;
            return Ok(Basis2D {
                center: result.state.clone(),
                e1,
                e2,
                kind: ManifoldEigenKind::ComplexPair,
                indices,
            });
        }

        if indices[0] == indices[1] {
            bail!("Requested duplicate eigen index does not define a real 2D eigenspace.");
        }
        let e1 = normalize(mode_a.vector.iter().map(|entry| entry.re).collect())?;
        let e2_raw: Vec<f64> = mode_b.vector.iter().map(|entry| entry.re).collect();
        let e2 = orthonormalize_or_fallback(&e2_raw, &e1)?;
        return Ok(Basis2D {
            center: result.state.clone(),
            e1,
            e2,
            kind: ManifoldEigenKind::RealPair,
            indices,
        });
    }

    let mut real_modes = Vec::new();
    let mut complex_modes = Vec::new();
    for (idx, pair) in result.eigenpairs.iter().enumerate() {
        if !matches_stability(pair.value.re, stability) {
            continue;
        }
        if pair.value.im.abs() <= EIG_IM_TOL {
            let vector: Vec<f64> = pair.vector.iter().map(|entry| entry.re).collect();
            if l2_norm(&vector) > NORM_EPS {
                real_modes.push(RealEigenMode {
                    index: idx,
                    value: Complex::new(pair.value.re, pair.value.im),
                    vector: normalize(vector)?,
                });
            }
            continue;
        }
        complex_modes.push(ComplexEigenMode {
            index: idx,
            value: Complex::new(pair.value.re, pair.value.im),
            vector: pair
                .vector
                .iter()
                .map(|entry| Complex::new(entry.re, entry.im))
                .collect(),
        });
    }

    if real_modes.len() >= 2 {
        let mut selected = real_modes;
        selected.sort_by_key(|mode| mode.index);
        let e1 = selected[0].vector.clone();
        let e2 = orthonormalize_or_fallback(&selected[1].vector, &e1)?;
        return Ok(Basis2D {
            center: result.state.clone(),
            e1,
            e2,
            kind: ManifoldEigenKind::RealPair,
            indices: [selected[0].index, selected[1].index],
        });
    }

    let complex_mode = complex_modes
        .into_iter()
        .find(|mode| mode.value.im > 0.0)
        .ok_or_else(|| anyhow!("No eligible 2D eigenspace found for manifold initialization."))?;
    let (e1, e2) = orthonormal_complex_pair_basis(&complex_mode.vector)?;
    Ok(Basis2D {
        center: result.state,
        e1,
        e2,
        kind: ManifoldEigenKind::ComplexPair,
        indices: [complex_mode.index, complex_mode.index],
    })
}

fn orthonormal_complex_pair_basis(vector: &[Complex<f64>]) -> Result<(Vec<f64>, Vec<f64>)> {
    if vector.is_empty() {
        bail!("Complex eigenvector is empty.");
    }

    // Rotate Q -> Q * exp(i*phi) so Re(Q) and Im(Q) are orthogonal before normalization.
    let mut d = 0.0;
    let mut s = 0.0;
    let mut r = 0.0;
    for entry in vector {
        let vr = entry.re;
        let vi = entry.im;
        d += vr * vr;
        s += vi * vi;
        r += vr * vi;
    }
    let phi = 0.5 * (2.0 * r).atan2(s - d);
    let (sin_phi, cos_phi) = phi.sin_cos();

    let mut real_part = Vec::with_capacity(vector.len());
    let mut imag_part = Vec::with_capacity(vector.len());
    for entry in vector {
        let vr = entry.re;
        let vi = entry.im;
        real_part.push(vr * cos_phi - vi * sin_phi);
        imag_part.push(vr * sin_phi + vi * cos_phi);
    }

    let e1 = normalize(real_part)?;
    let e2 = orthonormalize_or_fallback(&imag_part, &e1)?;
    Ok((e1, e2))
}

fn build_equilibrium_initial_ring(
    center: &[f64],
    e1: &[f64],
    e2: &[f64],
    radius: f64,
    points: usize,
) -> Vec<Vec<f64>> {
    let mut ring = Vec::with_capacity(points);
    for i in 0..points {
        let theta = ((i as f64) + 0.5) * std::f64::consts::TAU / (points as f64);
        let mut x = center.to_vec();
        let c = theta.cos();
        let s = theta.sin();
        for d in 0..x.len() {
            x[d] += radius * (c * e1[d] + s * e2[d]);
        }
        ring.push(x);
    }
    ring
}

fn grow_surface_from_ring(
    system: &EquationSystem,
    initial_ring: Vec<Vec<f64>>,
    sigma: f64,
    leaf_delta: f64,
    controls: SurfaceGrowthControls,
    integration_dt: f64,
    max_steps_per_leaf: usize,
    max_ring_points: usize,
    max_rings: usize,
    max_vertices: usize,
    max_time: f64,
    target_radius: f64,
    target_arclength: f64,
    center: Option<&[f64]>,
    initial_in_anchors: Option<&[Vec<f64>]>,
    bounds: Option<&ManifoldBounds>,
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> SurfaceGrowthResult {
    let initial_inward = if let Some(anchors) = initial_in_anchors {
        anchors.to_vec()
    } else if let Some(center_state) = center {
        vec![center_state.to_vec(); initial_ring.len()]
    } else {
        initial_ring.clone()
    };
    let (initial_ring, initial_inward) = resample_closed_ring_with_anchors_arclength(
        &initial_ring,
        &initial_inward,
        initial_ring.len().max(4),
    );
    grow_surface_from_geodesic_seed(
        system,
        GeodesicGrowthSeed {
            outer_ring: initial_ring,
            inward_anchors: initial_inward,
            current_leaf_delta: leaf_delta,
            accumulated_arclength: 0.0,
            global_ring_index: 0,
            center: center.map(<[f64]>::to_vec),
        },
        sigma,
        controls,
        integration_dt,
        max_steps_per_leaf,
        max_ring_points,
        max_rings,
        max_vertices,
        max_time,
        target_radius,
        target_arclength,
        bounds,
        on_ring_progress,
    )
}

#[allow(clippy::too_many_arguments)]
fn grow_surface_from_geodesic_seed(
    system: &EquationSystem,
    seed: GeodesicGrowthSeed,
    sigma: f64,
    controls: SurfaceGrowthControls,
    integration_dt: f64,
    max_steps_per_leaf: usize,
    max_ring_points: usize,
    max_rings: usize,
    max_vertices: usize,
    max_time: f64,
    target_radius: f64,
    target_arclength: f64,
    bounds: Option<&ManifoldBounds>,
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
) -> SurfaceGrowthResult {
    let center = seed.center.as_deref();
    let global_ring_offset = seed.global_ring_index;
    let mut rings = vec![RingLayer {
        points: seed.outer_ring,
        in_anchors: seed.inward_anchors,
        parent_anchors: Vec::new(),
    }];
    let mut ring_diagnostics = Vec::new();
    let mut accumulated_arc = seed.accumulated_arclength;
    let mut ring_index = 0usize;
    let mut current_leaf_delta = seed.current_leaf_delta.max(1e-9);
    let delta_min = controls.delta_min.max(1e-12);
    if current_leaf_delta < delta_min {
        current_leaf_delta = delta_min;
    }
    let target_scale = target_radius
        .max(target_arclength)
        .max(current_leaf_delta)
        .max(1e-6);
    let max_leaf_delta = (target_scale * 0.25).max(current_leaf_delta * 4.0);
    let mut solver_diagnostics = ManifoldSurfaceSolverDiagnostics::default();
    solver_diagnostics.leaf_delta_floor = delta_min;
    solver_diagnostics.min_leaf_delta_reached = current_leaf_delta <= delta_min + 1e-12;
    let mut reported_leaf_delta = current_leaf_delta;
    let mut termination_reason: Option<SurfaceTerminationReason> = None;
    let mut termination_detail: Option<String> = None;

    if let Some(progress) = on_ring_progress.as_deref_mut() {
        let initial_vertices = rings.first().map_or(0, |ring| ring.points.len());
        let initial_radius = if let Some(center_state) = center {
            if initial_vertices == 0 {
                0.0
            } else {
                let mut sum = 0.0;
                for point in &rings[0].points {
                    sum += l2_distance(point, center_state);
                }
                sum / (initial_vertices as f64)
            }
        } else {
            0.0
        };
        progress(
            global_ring_offset + rings.len(),
            initial_vertices,
            accumulated_arc,
            initial_radius,
        );
    }

    while ring_index + 1 < max_rings {
        let prev_layer = rings.last().expect("ring exists");
        let prev = &prev_layer.points;
        if prev.len() < 4 {
            termination_reason = Some(SurfaceTerminationReason::RingTooSmall);
            termination_detail = Some(format!(
                "ring={} has only {} points",
                ring_index,
                prev.len()
            ));
            break;
        }
        let prev_in_anchors = &prev_layer.in_anchors;

        let mut accepted_ring: Option<RingSolve> = None;
        let mut accepted_geodesic = GeodesicQuality::default();
        let mut accepted_attempt = 0usize;
        let mut used_delta = current_leaf_delta;
        let mut last_failure: Option<(SurfaceTerminationReason, String)> = None;
        for attempt in 0..LEAF_REFINE_ATTEMPTS {
            reported_leaf_delta = used_delta;
            solver_diagnostics.ring_attempts += 1;
            let raw_next = match build_next_ring(
                system,
                prev,
                prev_in_anchors,
                sigma,
                used_delta,
                delta_min,
                integration_dt,
                max_steps_per_leaf,
                max_time,
            ) {
                Ok(raw_next) => raw_next,
                Err(failure) => {
                    solver_diagnostics.build_failures += 1;
                    record_leaf_failure_diagnostics(&mut solver_diagnostics, failure.reason);
                    solver_diagnostics.failed_ring = Some(ring_index + 1);
                    solver_diagnostics.failed_attempt = Some(attempt + 1);
                    solver_diagnostics.failed_leaf_points = Some(failure.solved_points);
                    solver_diagnostics.last_leaf_failure_reason =
                        Some(failure.reason.as_str().to_string());
                    solver_diagnostics.last_leaf_failure_point = Some(failure.point_index + 1);
                    solver_diagnostics.last_leaf_failure_time = Some(failure.last_time);
                    solver_diagnostics.last_leaf_failure_segment = Some(failure.last_segment + 1);
                    solver_diagnostics.last_leaf_failure_tau = Some(failure.last_tau);
                    last_failure = Some((
                        SurfaceTerminationReason::RingBuildFailed,
                        format!(
                            "ring={} attempt={} delta={:.6e}: could not solve all leaf points (solved {} of {}), reason={} point={} time={:.6e} tau={:.6e}",
                            ring_index,
                            attempt,
                            used_delta,
                            failure.solved_points,
                            prev.len(),
                            failure.reason.as_str(),
                            failure.point_index + 1,
                            failure.last_time,
                            failure.last_tau
                        ),
                    ));
                    if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                        used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                        reported_leaf_delta = used_delta;
                        if used_delta <= delta_min + 1e-12 {
                            solver_diagnostics.min_leaf_delta_reached = true;
                        }
                        continue;
                    }
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    break;
                }
            };
            let raw_quality = evaluate_ring_quality(&raw_next.points);
            let geodesic_raw =
                evaluate_geodesic_quality_for_solve(prev, prev_in_anchors, &raw_next);
            solver_diagnostics.last_ring_max_turn_angle = raw_quality.max_turn_angle;
            solver_diagnostics.last_ring_max_distance_angle = raw_quality.max_distance_angle;
            solver_diagnostics.last_geodesic_max_angle = geodesic_raw.max_angle;
            solver_diagnostics.last_geodesic_max_distance_angle = geodesic_raw.max_delta_angle;

            if geodesic_quality_exceeds(geodesic_raw, controls) {
                solver_diagnostics.reject_geodesic_quality += 1;
                solver_diagnostics.failed_ring = Some(ring_index + 1);
                solver_diagnostics.failed_attempt = Some(attempt + 1);
                last_failure = Some((
                    SurfaceTerminationReason::GeodesicQualityRejected,
                    format!(
                        "ring={} attempt={} delta={:.6e}: angle={:.4e} distance_angle={:.4e}",
                        ring_index,
                        attempt,
                        used_delta,
                        geodesic_raw.max_angle,
                        geodesic_raw.max_delta_angle
                    ),
                ));
                if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                    used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                    reported_leaf_delta = used_delta;
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    continue;
                }
                if used_delta <= delta_min + 1e-12 {
                    solver_diagnostics.min_leaf_delta_reached = true;
                    // At the configured numerical floor, a large raw angle can
                    // be retained only when its distance-weighted error remains
                    // inside the K-O bound. This lets a resolved small strip
                    // pass a sharp turn without accepting a large spatial error.
                    if geodesic_raw.max_delta_angle > controls.delta_alpha_max {
                        break;
                    }
                } else {
                    break;
                }
            }

            let next = match adapt_ring_spacing(
                system,
                prev,
                prev_in_anchors,
                raw_next,
                sigma,
                used_delta,
                delta_min,
                controls.min_spacing,
                controls.max_spacing,
                integration_dt,
                max_steps_per_leaf,
                max_time,
                max_ring_points,
            ) {
                Ok(next) => next,
                Err(reason) => {
                    solver_diagnostics.spacing_failures += 1;
                    if let RingSpacingFailure::InsertionLeafFailed(kind) = reason {
                        record_leaf_failure_diagnostics(&mut solver_diagnostics, kind);
                    }
                    solver_diagnostics.failed_ring = Some(ring_index + 1);
                    solver_diagnostics.failed_attempt = Some(attempt + 1);
                    last_failure = Some((
                        SurfaceTerminationReason::RingSpacingFailed,
                        format!(
                            "ring={} attempt={} delta={:.6e}: spacing adaptation failed ({}, point_cap={}, previous_ring_points={})",
                            ring_index,
                            attempt,
                            used_delta,
                            match reason {
                                RingSpacingFailure::InsertionLeafFailed(kind) => kind.as_str(),
                                _ => reason.as_str(),
                            },
                            max_ring_points,
                            prev.len(),
                        ),
                    ));
                    if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                        used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                        reported_leaf_delta = used_delta;
                        if used_delta <= delta_min + 1e-12 {
                            solver_diagnostics.min_leaf_delta_reached = true;
                        }
                        continue;
                    }
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    break;
                }
            };
            let adapted_quality = evaluate_ring_quality(&next.points);
            solver_diagnostics.last_ring_max_turn_angle = adapted_quality.max_turn_angle;
            solver_diagnostics.last_ring_max_distance_angle = adapted_quality.max_distance_angle;
            let edge_ratio = ring_edge_ratio(&next.points);
            if !edge_ratio.is_finite()
                || adapted_quality.max_turn_angle > RING_TURN_REPARAM_TRIGGER_RAD
            {
                solver_diagnostics.reject_ring_quality += 1;
                solver_diagnostics.failed_ring = Some(ring_index + 1);
                solver_diagnostics.failed_attempt = Some(attempt + 1);
                last_failure = Some((
                    SurfaceTerminationReason::RingQualityRejected,
                    format!(
                        "ring={} attempt={} delta={:.6e}: reparameterized ring quality trigger (edge_ratio={:.3}, turn_angle={:.3} rad)",
                        ring_index,
                        attempt,
                        used_delta,
                        edge_ratio,
                        adapted_quality.max_turn_angle
                    ),
                ));
                if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                    used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                    reported_leaf_delta = used_delta;
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    continue;
                }
                if used_delta <= delta_min + 1e-12 {
                    solver_diagnostics.min_leaf_delta_reached = true;
                }
                break;
            }
            let geodesic_adapt = evaluate_geodesic_quality_for_solve(prev, prev_in_anchors, &next);
            solver_diagnostics.last_geodesic_max_angle = geodesic_adapt.max_angle;
            solver_diagnostics.last_geodesic_max_distance_angle = geodesic_adapt.max_delta_angle;
            if geodesic_quality_exceeds(geodesic_adapt, controls) {
                solver_diagnostics.reject_geodesic_quality += 1;
                solver_diagnostics.failed_ring = Some(ring_index + 1);
                solver_diagnostics.failed_attempt = Some(attempt + 1);
                last_failure = Some((
                    SurfaceTerminationReason::GeodesicQualityRejected,
                    format!(
                        "ring={} attempt={} delta={:.6e}: post-spacing geodesic reject angle={:.4e} distance_angle={:.4e}",
                        ring_index,
                        attempt,
                        used_delta,
                        geodesic_adapt.max_angle,
                        geodesic_adapt.max_delta_angle
                    ),
                ));
                if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                    used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                    reported_leaf_delta = used_delta;
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    continue;
                }
                if used_delta <= delta_min + 1e-12 {
                    solver_diagnostics.min_leaf_delta_reached = true;
                    // Apply the same floor rule after mesh adaptation so a
                    // reparameterized ring cannot bypass the weighted bound.
                    if geodesic_adapt.max_delta_angle > controls.delta_alpha_max {
                        break;
                    }
                } else {
                    break;
                }
            }

            if next.points.len() < 4 {
                solver_diagnostics.reject_too_small += 1;
                solver_diagnostics.failed_ring = Some(ring_index + 1);
                solver_diagnostics.failed_attempt = Some(attempt + 1);
                last_failure = Some((
                    SurfaceTerminationReason::RingCandidateTooSmall,
                    format!(
                        "ring={} attempt={} delta={:.6e}: candidate ring has {} points",
                        ring_index,
                        attempt,
                        used_delta,
                        next.points.len()
                    ),
                ));
                if used_delta > delta_min + 1e-12 && attempt + 1 < LEAF_REFINE_ATTEMPTS {
                    used_delta = (used_delta * LEAF_DELTA_SHRINK).max(delta_min);
                    reported_leaf_delta = used_delta;
                    if used_delta <= delta_min + 1e-12 {
                        solver_diagnostics.min_leaf_delta_reached = true;
                    }
                    continue;
                }
                if used_delta <= delta_min + 1e-12 {
                    solver_diagnostics.min_leaf_delta_reached = true;
                }
                break;
            }
            accepted_geodesic = geodesic_adapt;
            accepted_ring = Some(next);
            accepted_attempt = attempt;
            break;
        }
        let Some(next_solve) = accepted_ring else {
            if let Some((reason, detail)) = last_failure {
                termination_reason = Some(reason);
                termination_detail = Some(detail);
            } else {
                termination_reason = Some(SurfaceTerminationReason::RingBuildFailed);
                termination_detail = Some(format!(
                    "ring={} failed without a recoverable candidate",
                    ring_index
                ));
            }
            break;
        };
        solver_diagnostics.failed_ring = None;
        solver_diagnostics.failed_attempt = None;
        solver_diagnostics.failed_leaf_points = None;
        let accepted_step = next_solve
            .leaf_deltas
            .iter()
            .copied()
            .filter(|value| value.is_finite() && *value > 0.0)
            .fold(used_delta, f64::min);
        solver_diagnostics.local_leaf_shrinks += next_solve
            .leaf_deltas
            .iter()
            .filter(|delta| **delta + 1e-12 < used_delta)
            .count();
        let used_local_shrink = accepted_step + 1e-12 < used_delta;
        let next = next_solve.points;
        let next_in_anchors = next_solve.in_anchors;
        let next_parent_anchors = next_solve.base_anchors;
        current_leaf_delta = used_delta;
        reported_leaf_delta = used_delta;
        if accepted_attempt == 0
            && !used_local_shrink
            && accepted_geodesic.max_angle < controls.alpha_min
            && accepted_geodesic.max_delta_angle < controls.delta_alpha_min
        {
            current_leaf_delta = (current_leaf_delta * LEAF_DELTA_GROW).min(max_leaf_delta);
        }

        if let Some(box_bounds) = bounds {
            if next.iter().all(|point| !inside_bounds(point, box_bounds)) {
                termination_reason = Some(SurfaceTerminationReason::BoundsExit);
                termination_detail = Some(format!(
                    "ring={} lies entirely outside bounds",
                    ring_index + 1
                ));
                break;
            }
        }

        accumulated_arc += accepted_step;

        let radius_estimate = if let Some(center_state) = center {
            let mut sum = 0.0;
            for point in &next {
                sum += l2_distance(point, center_state);
            }
            sum / (next.len() as f64)
        } else {
            accumulated_arc
        };
        ring_diagnostics.push(ManifoldRingDiagnostic {
            ring_index: global_ring_offset + ring_index + 1,
            radius_estimate,
            point_count: next.len(),
        });

        rings.push(RingLayer {
            points: next,
            in_anchors: next_in_anchors,
            parent_anchors: next_parent_anchors,
        });
        ring_index += 1;

        let total_vertices: usize = rings.iter().map(|ring| ring.points.len()).sum();
        if let Some(progress) = on_ring_progress.as_deref_mut() {
            progress(
                global_ring_offset + rings.len(),
                total_vertices,
                accumulated_arc,
                radius_estimate,
            );
        }
        if total_vertices >= max_vertices {
            termination_reason = Some(SurfaceTerminationReason::MaxVertices);
            termination_detail = Some(format!(
                "total vertices {} reached max_vertices {}",
                total_vertices, max_vertices
            ));
            break;
        }
        if target_radius.is_finite() && radius_estimate >= target_radius {
            termination_reason = Some(SurfaceTerminationReason::TargetRadius);
            termination_detail = Some(format!(
                "radius {:.6e} reached target_radius {:.6e}",
                radius_estimate, target_radius
            ));
            break;
        }
        if target_arclength > 0.0 && accumulated_arc >= target_arclength {
            termination_reason = Some(SurfaceTerminationReason::TargetArclength);
            termination_detail = Some(format!(
                "arclength {:.6e} reached target_arclength {:.6e}",
                accumulated_arc, target_arclength
            ));
            break;
        }
    }

    if termination_reason.is_none() {
        termination_reason = Some(SurfaceTerminationReason::MaxRings);
        termination_detail = Some(format!("max_rings {} reached", max_rings));
    }
    solver_diagnostics.termination_reason = termination_reason
        .unwrap_or(SurfaceTerminationReason::MaxRings)
        .as_str()
        .to_string();
    solver_diagnostics.termination_detail = termination_detail;
    solver_diagnostics.final_leaf_delta = reported_leaf_delta;

    let mut vertices = Vec::new();
    let mut ring_offsets = Vec::with_capacity(rings.len());
    for ring in &rings {
        ring_offsets.push(vertices.len());
        for point in &ring.points {
            vertices.push(point.clone());
        }
    }
    let parent_anchors = rings
        .iter()
        .map(|ring| ring.parent_anchors.clone())
        .collect::<Vec<_>>();
    let resume_layer = rings.last().cloned();
    let ring_points: Vec<Vec<Vec<f64>>> = rings.into_iter().map(|ring| ring.points).collect();
    let triangles =
        triangulate_ring_bands_with_parent_anchors(&ring_points, &ring_offsets, &parent_anchors);
    let resume_state = resume_layer.map(|layer| ManifoldSurfaceResumeState::GeodesicRings {
        version: 1,
        outer_ring: layer.points,
        inward_anchors: layer.in_anchors,
        current_leaf_delta,
        accumulated_arclength: accumulated_arc,
        center: seed.center,
    });
    SurfaceGrowthResult {
        vertices,
        triangles,
        ring_offsets,
        ring_diagnostics,
        solver_diagnostics,
        resume_state,
    }
}

fn build_next_ring(
    system: &EquationSystem,
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    sigma: f64,
    leaf_delta: f64,
    leaf_delta_floor: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<RingSolve, RingBuildFailure> {
    let m = prev_ring.len();
    let mut hits = vec![None; m];
    let mut hit_deltas = vec![leaf_delta; m];
    let mut failures: Vec<(usize, LeafFailure)> = Vec::new();
    for i in 0..m {
        let s = (i as f64) / (m as f64);
        let base_point = &prev_ring[i];
        let base_in_anchor = prev_in_anchors.get(i).unwrap_or(base_point);
        let tangent = ring_tangent_neighbor_average(prev_ring, i);
        let outward = outward_from_in_anchor(base_point, base_in_anchor, &tangent)
            .or_else(|_| canonical_orthogonal_unit(&tangent))
            .unwrap_or_else(|_| {
                let mut fallback = vec![0.0; base_point.len()];
                if let Some(first) = fallback.first_mut() {
                    *first = 1.0;
                }
                fallback
            });
        match solve_leaf_point_with_local_floor(
            system,
            prev_ring,
            base_point,
            s,
            &tangent,
            &outward,
            leaf_delta,
            leaf_delta_floor,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            None,
        ) {
            Ok((hit, achieved_delta)) => {
                hits[i] = Some(hit);
                hit_deltas[i] = achieved_delta;
                continue;
            }
            Err(failure) => {
                if std::env::var("FORK_MANIFOLD_DEBUG").is_ok() {
                    eprintln!(
                        "leaf failure: i={} s={:.6} leaf_delta={:.6e} max_time={:.3} dt={:.3e} reason={}",
                        i,
                        s,
                        leaf_delta,
                        max_time,
                        dt,
                        failure.kind.as_str()
                    );
                }
                failures.push((i, failure));
            }
        };
    }

    if !failures.is_empty() {
        let mut unresolved: Vec<(usize, LeafFailure)> = Vec::new();
        let retry_failure_budget = LEAF_RETRY_MAX_FAILURES
            .max((m / 3).max(1))
            .min(m.saturating_sub(4).max(1));
        if failures.len() <= retry_failure_budget {
            for (i, _failure) in failures {
                let s = (i as f64) / (m as f64);
                let base_point = &prev_ring[i];
                let base_in_anchor = prev_in_anchors.get(i).unwrap_or(base_point);
                let tangent = ring_tangent_neighbor_average(prev_ring, i);
                let outward_default = outward_from_in_anchor(base_point, base_in_anchor, &tangent)
                    .or_else(|_| canonical_orthogonal_unit(&tangent))
                    .unwrap_or_else(|_| {
                        let mut fallback = vec![0.0; base_point.len()];
                        if let Some(first) = fallback.first_mut() {
                            *first = 1.0;
                        }
                        fallback
                    });
                let outward = leaf_outward_hint_from_neighbors(&hits, prev_ring, i, &tangent)
                    .unwrap_or_else(|| outward_default.clone());
                match solve_leaf_point_with_local_floor(
                    system,
                    prev_ring,
                    base_point,
                    s,
                    &tangent,
                    &outward,
                    leaf_delta,
                    leaf_delta_floor,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                    None,
                ) {
                    Ok((hit, achieved_delta)) => {
                        hits[i] = Some(hit);
                        hit_deltas[i] = achieved_delta;
                    }
                    Err(retry_failure) => {
                        unresolved.push((i, retry_failure));
                    }
                }
            }
        } else {
            unresolved = failures;
        }
        unresolved.retain(|(idx, _)| match hits.get(*idx) {
            Some(Some(_)) => false,
            _ => true,
        });
        if !unresolved.is_empty() || hits.iter().any(|hit| hit.is_none()) {
            let (point_index, failure) = unresolved.first().copied().unwrap_or_else(|| {
                for (idx, hit) in hits.iter().enumerate() {
                    if hit.is_none() {
                        return (
                            idx,
                            LeafFailure {
                                kind: LeafFailureKind::PlaneSolveNoConvergence,
                                last_time: 0.0,
                                last_segment: 0,
                                last_tau: 0.0,
                            },
                        );
                    }
                }
                (
                    0,
                    LeafFailure {
                        kind: LeafFailureKind::PlaneSolveNoConvergence,
                        last_time: 0.0,
                        last_segment: 0,
                        last_tau: 0.0,
                    },
                )
            });
            let solved_points = hits.iter().filter(|hit| hit.is_some()).count();
            return Err(RingBuildFailure {
                solved_points,
                reason: failure.kind,
                point_index,
                last_time: failure.last_time,
                last_segment: failure.last_segment,
                last_tau: failure.last_tau,
            });
        }
    }

    let mut next = Vec::with_capacity(m);
    let mut base_anchors = Vec::with_capacity(m);
    let mut in_anchors = Vec::with_capacity(m);
    let mut leaf_deltas = Vec::with_capacity(m);
    for (index, hit) in hits.into_iter().enumerate() {
        let hit = hit.ok_or(RingBuildFailure {
            solved_points: next.len(),
            reason: LeafFailureKind::PlaneSolveNoConvergence,
            point_index: next.len(),
            last_time: 0.0,
            last_segment: 0,
            last_tau: 0.0,
        })?;
        let _tau_hit = hit.tau_hit;
        next.push(hit.point);
        base_anchors.push(hit.base_anchor);
        in_anchors.push(hit.in_anchor);
        leaf_deltas.push(hit_deltas[index]);
    }
    if next.len() < 4 || base_anchors.len() != next.len() || in_anchors.len() != next.len() {
        return Err(RingBuildFailure {
            solved_points: next.len(),
            reason: LeafFailureKind::PlaneSolveNoConvergence,
            point_index: next.len(),
            last_time: 0.0,
            last_segment: 0,
            last_tau: 0.0,
        });
    }
    Ok(RingSolve {
        points: next,
        base_anchors,
        in_anchors,
        leaf_deltas,
    })
}

fn nearest_successful_leaf_index(
    hits: &[Option<LeafHit>],
    start: usize,
    forward: bool,
) -> Option<usize> {
    if hits.is_empty() {
        return None;
    }
    let m = hits.len();
    let mut idx = start % m;
    for _ in 0..m {
        idx = if forward {
            (idx + 1) % m
        } else {
            (idx + m - 1) % m
        };
        if hits[idx].is_some() {
            return Some(idx);
        }
    }
    None
}

fn averaged_neighbor_displacement(
    hits: &[Option<LeafHit>],
    prev_ring: &[Vec<f64>],
    index: usize,
) -> Option<Vec<f64>> {
    let dim = prev_ring.get(index)?.len();
    if dim == 0 {
        return None;
    }
    let prev_idx = nearest_successful_leaf_index(hits, index, false);
    let next_idx = nearest_successful_leaf_index(hits, index, true);
    let mut displacement = vec![0.0; dim];
    let mut samples = 0usize;
    for idx in [prev_idx, next_idx].into_iter().flatten() {
        let hit = hits.get(idx)?.as_ref()?;
        if prev_ring.get(idx)?.len() != dim || hit.point.len() != dim {
            continue;
        }
        let local_disp = subtract(&hit.point, &prev_ring[idx]);
        if !local_disp.iter().all(|value| value.is_finite()) {
            continue;
        }
        for d in 0..dim {
            displacement[d] += local_disp[d];
        }
        samples += 1;
    }
    if samples == 0 {
        return None;
    }
    for value in &mut displacement {
        *value /= samples as f64;
    }
    if !displacement.iter().all(|value| value.is_finite()) {
        return None;
    }
    Some(displacement)
}

fn leaf_outward_hint_from_neighbors(
    hits: &[Option<LeafHit>],
    prev_ring: &[Vec<f64>],
    index: usize,
    tangent: &[f64],
) -> Option<Vec<f64>> {
    let mut hint = averaged_neighbor_displacement(hits, prev_ring, index)?;
    if tangent.len() == hint.len() {
        if let Ok(tangent_unit) = normalize(tangent.to_vec()) {
            let projection = dot(&hint, &tangent_unit);
            for d in 0..hint.len() {
                hint[d] -= projection * tangent_unit[d];
            }
        }
    }
    if l2_norm(&hint) <= NORM_EPS {
        return None;
    }
    normalize(hint).ok()
}

fn adapt_ring_spacing(
    system: &EquationSystem,
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    raw_next: RingSolve,
    sigma: f64,
    leaf_delta: f64,
    leaf_delta_floor: f64,
    min_spacing: f64,
    max_spacing: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    max_ring_points: usize,
) -> Result<RingSolve, RingSpacingFailure> {
    // The configured per-ring point budget is the real K-O mesh cap. A fixed
    // multiple of the previous ring can reject a valid strongly stretched
    // strip even when the caller deliberately provided ample point and vertex
    // budgets.
    let adaptive_point_cap = adaptive_ring_point_cap(max_ring_points);

    if raw_next.points.len() < 4
        || raw_next.base_anchors.len() != raw_next.points.len()
        || raw_next.in_anchors.len() != raw_next.points.len()
        || raw_next.leaf_deltas.len() != raw_next.points.len()
        || !anchor_params_strictly_monotone_cyclic(&raw_next.base_anchors)
    {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    if raw_next.points.len() > adaptive_point_cap {
        return Err(RingSpacingFailure::PointCapExceeded);
    }

    let mut ring = raw_next;
    let min_spacing = min_spacing.max(1e-12);
    let max_spacing = max_spacing.max(min_spacing * 1.1);
    const ADAPT_MAX_PASSES: usize = 8;
    for _pass in 0..ADAPT_MAX_PASSES {
        let mut changed = false;

        let mut i = 0usize;
        while ring.points.len() > 4 && i < ring.points.len() {
            let m = ring.points.len();
            let j = (i + 1) % m;
            let spacing = l2_distance(&ring.points[i], &ring.points[j]);
            if spacing < min_spacing {
                ring.points.remove(j);
                ring.base_anchors.remove(j);
                ring.in_anchors.remove(j);
                ring.leaf_deltas.remove(j);
                changed = true;
                continue;
            }
            i += 1;
        }
        if ring.points.len() < 4 {
            return Err(RingSpacingFailure::InvalidCandidate);
        }

        let m = ring.points.len();
        let mut points = Vec::with_capacity((m * 2).min(adaptive_point_cap));
        let mut base_anchors = Vec::with_capacity((m * 2).min(adaptive_point_cap));
        let mut in_anchors = Vec::with_capacity((m * 2).min(adaptive_point_cap));
        let mut leaf_deltas = Vec::with_capacity((m * 2).min(adaptive_point_cap));
        let mut insertion_budget_exhausted = false;
        for i in 0..m {
            let j = (i + 1) % m;
            points.push(ring.points[i].clone());
            base_anchors.push(ring.base_anchors[i]);
            in_anchors.push(ring.in_anchors[i].clone());
            leaf_deltas.push(ring.leaf_deltas[i]);

            let spacing = l2_distance(&ring.points[i], &ring.points[j]);
            let needs_insert = spacing > max_spacing;
            if !needs_insert {
                continue;
            }
            let remaining_originals = m.saturating_sub(i + 1);
            if points.len() + 1 + remaining_originals > adaptive_point_cap {
                insertion_budget_exhausted = true;
                continue;
            }
            let hit = solve_spacing_insertion_leaf(
                system,
                prev_ring,
                prev_in_anchors,
                &ring.points[i],
                &ring.points[j],
                ring.base_anchors[i],
                ring.base_anchors[j],
                leaf_delta,
                leaf_delta_floor,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            );
            match hit {
                Ok((hit, achieved_delta)) => {
                    points.push(hit.point);
                    base_anchors.push(hit.base_anchor);
                    in_anchors.push(hit.in_anchor);
                    leaf_deltas.push(achieved_delta);
                }
                Err(failure) => {
                    return Err(failure);
                }
            }
            changed = true;
        }

        ring = RingSolve {
            points,
            base_anchors,
            in_anchors,
            leaf_deltas,
        };
        if insertion_budget_exhausted {
            return Err(RingSpacingFailure::PointCapExceeded);
        }
        if !changed {
            if !anchor_params_strictly_monotone_cyclic(&ring.base_anchors) {
                return Err(RingSpacingFailure::InvalidCandidate);
            }
            return Ok(ring);
        }
    }

    if ring.points.len() < 4 {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    if !anchor_params_strictly_monotone_cyclic(&ring.base_anchors) {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    if ring.points.iter().enumerate().any(|(index, point)| {
        l2_distance(point, &ring.points[(index + 1) % ring.points.len()]) > max_spacing
    }) {
        return Err(RingSpacingFailure::PointCapExceeded);
    }
    Ok(ring)
}

fn adaptive_ring_point_cap(max_ring_points: usize) -> usize {
    max_ring_points.max(4)
}

fn circular_lerp_parameter(a: f64, b: f64, fraction: f64) -> f64 {
    let width = (b - a).rem_euclid(1.0);
    (a + fraction.clamp(0.0, 1.0) * width).rem_euclid(1.0)
}

fn anchor_strictly_between_cyclic(a: f64, b: f64, candidate: f64) -> bool {
    let width = (b - a).rem_euclid(1.0);
    if width <= SOURCE_PARAM_MONO_EPS {
        return false;
    }
    let offset = (candidate - a).rem_euclid(1.0);
    offset > SOURCE_PARAM_MONO_EPS && offset + SOURCE_PARAM_MONO_EPS < width
}

#[allow(clippy::too_many_arguments)]
fn solve_spacing_insertion_leaf(
    system: &EquationSystem,
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    edge_start: &[f64],
    edge_end: &[f64],
    anchor_start: f64,
    anchor_end: f64,
    leaf_delta: f64,
    leaf_delta_floor: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<(LeafHit, f64), RingSpacingFailure> {
    const CANDIDATE_FRACTIONS: [f64; 15] = [
        0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875, 0.0625, 0.1875, 0.3125, 0.4375, 0.5625,
        0.6875, 0.8125, 0.9375,
    ];
    let original_spacing = l2_distance(edge_start, edge_end);
    let mut best: Option<(LeafHit, f64, f64)> = None;
    let mut last_failure = None;

    for fraction in CANDIDATE_FRACTIONS {
        let base_s = circular_lerp_parameter(anchor_start, anchor_end, fraction);
        let base_point = sample_ring_uniform(prev_ring, base_s);
        let base_in_anchor = sample_ring_uniform(prev_in_anchors, base_s);
        let tangent = ring_tangent_uniform(prev_ring, base_s);
        let outward = outward_from_in_anchor(&base_point, &base_in_anchor, &tangent)
            .or_else(|_| canonical_orthogonal_unit(&tangent))
            .unwrap_or_else(|_| {
                let mut fallback = vec![0.0; base_point.len()];
                if let Some(first) = fallback.first_mut() {
                    *first = 1.0;
                }
                fallback
            });
        match solve_leaf_point_with_local_floor(
            system,
            prev_ring,
            &base_point,
            base_s,
            &tangent,
            &outward,
            leaf_delta,
            leaf_delta_floor,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            None,
        ) {
            Ok((hit, achieved_delta))
                if anchor_strictly_between_cyclic(anchor_start, anchor_end, hit.base_anchor) =>
            {
                let score =
                    l2_distance(edge_start, &hit.point).max(l2_distance(&hit.point, edge_end));
                if score.is_finite()
                    && best
                        .as_ref()
                        .is_none_or(|(_, _, best_score)| score < *best_score)
                {
                    best = Some((hit, achieved_delta, score));
                    if score <= 0.75 * original_spacing {
                        break;
                    }
                }
            }
            Ok(_) => {}
            Err(failure) => last_failure = Some(failure),
        }
    }

    if let Some((hit, achieved_delta, score)) = best {
        if score + 1e-12 < original_spacing {
            return Ok((hit, achieved_delta));
        }
        return Err(RingSpacingFailure::InsertionDidNotSplitEdge);
    }
    Err(RingSpacingFailure::InsertionLeafFailed(
        last_failure
            .map(|failure| failure.kind)
            .unwrap_or(LeafFailureKind::PlaneSolveNoConvergence),
    ))
}

#[cfg(test)]
fn median_finite(values: &[f64]) -> Option<f64> {
    let mut finite: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if finite.is_empty() {
        return None;
    }
    finite.sort_by(|a, b| a.total_cmp(b));
    let n = finite.len();
    if n % 2 == 1 {
        Some(finite[n / 2])
    } else {
        Some(0.5 * (finite[n / 2 - 1] + finite[n / 2]))
    }
}

#[cfg(test)]
fn regularize_ring_correspondence_outliers(
    prev_ring: &[Vec<f64>],
    next_ring: &mut [Vec<f64>],
    leaf_delta: f64,
) {
    if prev_ring.len() != next_ring.len() || prev_ring.len() < 4 {
        return;
    }
    let displacements: Vec<f64> = prev_ring
        .iter()
        .zip(next_ring.iter())
        .map(|(prev, next)| l2_distance(prev, next))
        .collect();
    let Some(median_disp) = median_finite(&displacements) else {
        return;
    };
    let leaf_scale = leaf_delta.abs().max(1e-9);
    let threshold = (median_disp * RING_OUTLIER_DISPLACEMENT_FACTOR)
        .clamp(
            leaf_scale * RING_OUTLIER_MIN_SCALE,
            leaf_scale * RING_OUTLIER_MAX_SCALE,
        )
        .max(1e-9);

    let m = next_ring.len();
    for _ in 0..RING_OUTLIER_PASSES {
        let mut changed = false;
        for i in 0..m {
            if l2_distance(&prev_ring[i], &next_ring[i]) <= threshold {
                continue;
            }
            let left = &next_ring[(i + m - 1) % m];
            let right = &next_ring[(i + 1) % m];
            if left.len() != right.len() || left.len() != prev_ring[i].len() {
                continue;
            }
            let mut candidate = lerp(left, right, 0.5);
            let offset = subtract(&candidate, &prev_ring[i]);
            let norm = l2_norm(&offset);
            if norm.is_finite() && norm > threshold {
                if let Ok(unit) = normalize(offset) {
                    for d in 0..candidate.len() {
                        candidate[d] = prev_ring[i][d] + threshold * unit[d];
                    }
                }
            }
            if !candidate.iter().all(|value| value.is_finite()) {
                continue;
            }
            next_ring[i] = candidate;
            changed = true;
        }
        if !changed {
            break;
        }
    }
}

fn evaluate_ring_quality(ring: &[Vec<f64>]) -> RingQuality {
    let mut quality = RingQuality::default();
    if ring.is_empty() {
        return quality;
    }

    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        let spacing = l2_distance(&ring[i], &ring[j]);
        let angle = ring_vertex_angle(ring, i);
        quality.max_turn_angle = quality.max_turn_angle.max(angle);
        quality.max_distance_angle = quality.max_distance_angle.max(spacing * angle);
    }

    quality
}

#[cfg(test)]
fn evaluate_geodesic_quality(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next_ring: &[Vec<f64>],
    leaf_delta: f64,
) -> GeodesicQuality {
    if next_ring.len() != prev_ring.len() {
        return GeodesicQuality::default();
    }
    let base_anchors: Vec<f64> = (0..next_ring.len())
        .map(|idx| (idx as f64) / (next_ring.len().max(1) as f64))
        .collect();
    evaluate_geodesic_quality_with_anchors(
        prev_ring,
        prev_in_anchors,
        next_ring,
        &base_anchors,
        &vec![leaf_delta; next_ring.len()],
    )
}

fn evaluate_geodesic_quality_for_solve(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next: &RingSolve,
) -> GeodesicQuality {
    if next.points.len() != next.base_anchors.len() || next.points.len() != next.leaf_deltas.len() {
        return GeodesicQuality::default();
    }
    evaluate_geodesic_quality_with_anchors(
        prev_ring,
        prev_in_anchors,
        &next.points,
        &next.base_anchors,
        &next.leaf_deltas,
    )
}

fn evaluate_geodesic_quality_with_anchors(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next_ring: &[Vec<f64>],
    base_anchors: &[f64],
    leaf_deltas: &[f64],
) -> GeodesicQuality {
    if prev_ring.is_empty()
        || prev_in_anchors.len() != prev_ring.len()
        || next_ring.len() != base_anchors.len()
        || next_ring.len() != leaf_deltas.len()
    {
        return GeodesicQuality::default();
    }
    let mut quality = GeodesicQuality::default();
    for idx in 0..next_ring.len() {
        let s = base_anchors[idx];
        if !s.is_finite() {
            continue;
        }
        let p = sample_ring_uniform(prev_in_anchors, s);
        let r = sample_ring_uniform(prev_ring, s);
        let b = &next_ring[idx];
        if p.len() != r.len() || r.len() != b.len() || r.is_empty() {
            continue;
        }
        let v_prev = subtract(&r, &p);
        let v_next = subtract(b, &r);
        let n_prev = l2_norm(&v_prev);
        let n_next = l2_norm(&v_next);
        if n_prev <= NORM_EPS || n_next <= NORM_EPS {
            continue;
        }
        let cos_theta = (dot(&v_prev, &v_next) / (n_prev * n_next)).clamp(-1.0, 1.0);
        let alpha = cos_theta.acos();
        quality.max_angle = quality.max_angle.max(alpha);
        quality.max_delta_angle = quality.max_delta_angle.max(alpha * leaf_deltas[idx].abs());
    }

    quality
}

fn ring_vertex_angle(ring: &[Vec<f64>], index: usize) -> f64 {
    if ring.len() < 3 {
        return 0.0;
    }
    let m = ring.len();
    let prev = &ring[(index + m - 1) % m];
    let curr = &ring[index % m];
    let next = &ring[(index + 1) % m];
    let v1 = subtract(curr, prev);
    let v2 = subtract(next, curr);
    let n1 = l2_norm(&v1);
    let n2 = l2_norm(&v2);
    if n1 <= NORM_EPS || n2 <= NORM_EPS {
        return 0.0;
    }
    let cos_theta = (dot(&v1, &v2) / (n1 * n2)).clamp(-1.0, 1.0);
    cos_theta.acos()
}

fn sample_ring_uniform(ring: &[Vec<f64>], s: f64) -> Vec<f64> {
    if ring.is_empty() {
        return Vec::new();
    }
    if ring.len() == 1 {
        return ring[0].clone();
    }
    let wrapped = s.rem_euclid(1.0) * (ring.len() as f64);
    let i0 = (wrapped.floor() as usize) % ring.len();
    let alpha = wrapped - (i0 as f64);
    let i1 = (i0 + 1) % ring.len();
    lerp(&ring[i0], &ring[i1], alpha)
}

fn ring_tangent_uniform(ring: &[Vec<f64>], s: f64) -> Vec<f64> {
    if ring.is_empty() {
        return Vec::new();
    }
    let ds = 1.0 / (ring.len() as f64);
    let prev = sample_ring_uniform(ring, s - ds);
    let next = sample_ring_uniform(ring, s + ds);
    normalize(subtract(&next, &prev)).unwrap_or_else(|_| {
        let mut fallback = vec![0.0; ring[0].len()];
        if !fallback.is_empty() {
            fallback[0] = 1.0;
        }
        fallback
    })
}

fn ring_tangent_neighbor_average(ring: &[Vec<f64>], index: usize) -> Vec<f64> {
    if ring.len() < 3 {
        return ring_tangent_uniform(ring, (index as f64) / (ring.len().max(1) as f64));
    }
    let m = ring.len();
    let prev = &ring[(index + m - 1) % m];
    let next = &ring[(index + 1) % m];
    let tangent = subtract(next, prev);
    normalize(tangent).unwrap_or_else(|_| ring_tangent_uniform(ring, (index as f64) / (m as f64)))
}

#[cfg(test)]
fn sample_anchor_param(anchor_params: &[f64], s: f64) -> f64 {
    if anchor_params.is_empty() {
        return s.rem_euclid(1.0);
    }
    if anchor_params.len() == 1 {
        return anchor_params[0].rem_euclid(1.0);
    }
    let m = anchor_params.len();
    let wrapped = s.rem_euclid(1.0) * (m as f64);
    let i0 = (wrapped.floor() as usize) % m;
    let alpha = wrapped - (i0 as f64);
    let i1 = (i0 + 1) % m;
    circular_lerp(anchor_params[i0], anchor_params[i1], alpha)
}

fn anchor_params_strictly_monotone_cyclic(anchor_params: &[f64]) -> bool {
    let n = anchor_params.len();
    if n < 3 {
        return true;
    }
    for start in 0..n {
        let mut prev = anchor_params[start].rem_euclid(1.0);
        let mut ok = true;
        for offset in 1..n {
            let idx = (start + offset) % n;
            let mut current = anchor_params[idx].rem_euclid(1.0);
            while current < prev {
                current += 1.0;
            }
            let advance = current - prev;
            if advance <= SOURCE_PARAM_MONO_EPS {
                ok = false;
                break;
            }
            prev = current;
        }
        if !ok {
            continue;
        }
        let mut wrap_advance = anchor_params[start].rem_euclid(1.0) + 1.0 - prev;
        while wrap_advance < 0.0 {
            wrap_advance += 1.0;
        }
        if wrap_advance > SOURCE_PARAM_MONO_EPS {
            return true;
        }
    }
    false
}

fn outward_from_in_anchor(
    base_point: &[f64],
    in_anchor: &[f64],
    tangent: &[f64],
) -> Result<Vec<f64>> {
    if base_point.len() != in_anchor.len() || base_point.len() != tangent.len() {
        bail!(
            "dimension mismatch in outward_from_in_anchor: base={}, in_anchor={}, tangent={}",
            base_point.len(),
            in_anchor.len(),
            tangent.len()
        );
    }
    let mut outward = subtract(base_point, in_anchor);
    if let Ok(tangent_unit) = normalize(tangent.to_vec()) {
        let projection = dot(&outward, &tangent_unit);
        for idx in 0..outward.len() {
            outward[idx] -= projection * tangent_unit[idx];
        }
    }
    if l2_norm(&outward) <= NORM_EPS {
        bail!("degenerate inward-anchor direction for leaf orientation");
    }
    normalize(outward)
}

#[cfg(test)]
fn half_plane_direction(
    prev_prev_ring: Option<&[Vec<f64>]>,
    prev_parent_anchors: Option<&[f64]>,
    prev_ring: &[Vec<f64>],
    base_point: &[f64],
    s: f64,
    center: Option<&[f64]>,
    initial_orientation: Option<&[Vec<f64>]>,
    tangent: &[f64],
) -> Vec<f64> {
    let mut direction = Vec::new();
    if let Some(previous) = prev_prev_ring {
        let parent_s = match prev_parent_anchors {
            Some(parent_map) => sample_anchor_param(parent_map, s),
            None => s,
        };
        let reference = sample_ring_uniform(previous, parent_s);
        if !reference.is_empty() {
            direction = subtract(base_point, &reference);
        }
    }
    if l2_norm(&direction) <= NORM_EPS {
        if let Some(center_state) = center {
            direction = subtract(base_point, center_state);
        }
    }
    if l2_norm(&direction) <= NORM_EPS {
        if let Some(initial) = initial_orientation {
            direction = sample_ring_uniform(initial, s);
        }
    }
    let tangent_unit = normalize(tangent.to_vec()).ok();
    if let Some(tangent_axis) = tangent_unit.as_ref() {
        let projection = dot(&direction, tangent_axis);
        for i in 0..direction.len() {
            direction[i] -= projection * tangent_axis[i];
        }
    }
    if l2_norm(&direction) <= NORM_EPS {
        direction = canonical_orthogonal_unit(tangent).unwrap_or_else(|_| {
            let mut fallback = vec![0.0; prev_ring[0].len()];
            if !fallback.is_empty() {
                fallback[0] = 1.0;
            }
            fallback
        });
    }
    normalize(direction).unwrap_or_else(|_| {
        let mut fallback = vec![0.0; prev_ring[0].len()];
        if !fallback.is_empty() {
            fallback[0] = 1.0;
        }
        fallback
    })
}

fn uniform_s_to_segment_tau(ring_len: usize, s: f64) -> (usize, f64) {
    if ring_len == 0 {
        return (0, 0.0);
    }
    let scaled = s.rem_euclid(1.0) * (ring_len as f64);
    let i0 = (scaled.floor() as usize) % ring_len;
    let alpha = scaled - (i0 as f64);
    if alpha <= LEAF_SEGMENT_SWITCH_EPS {
        return (i0, 0.0);
    }
    if (1.0 - alpha) <= LEAF_SEGMENT_SWITCH_EPS {
        return ((i0 + 1) % ring_len, 0.0);
    }
    let seg_index = (i0 + 1) % ring_len;
    let tau = (1.0 - alpha).clamp(0.0, 1.0);
    (seg_index, tau)
}

#[cfg(test)]
fn segment_point_with_derivative(
    ring: &[Vec<f64>],
    seg_index: usize,
    tau: f64,
) -> (Vec<f64>, Vec<f64>) {
    if ring.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let m = ring.len();
    let curr = &ring[seg_index % m];
    let prev = &ring[(seg_index + m - 1) % m];
    let point = lerp(curr, prev, tau);
    let derivative = subtract(prev, curr);
    (point, derivative)
}

#[cfg(test)]
fn eval_plane_residual_and_derivative_on_segment(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    leaf_normal: &[f64],
    segment_index: usize,
    tau_time: f64,
    tau_segment: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<(f64, f64, Vec<f64>, Vec<f64>), LeafFailureKind> {
    if ring.is_empty() {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    if !tau_segment.is_finite() || tau_segment < 0.0 || tau_segment > 1.0 {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let (start, dldt) = segment_point_with_derivative(ring, segment_index, tau_segment);
    let (point, mut deriv) = if let Some((point_var, phi)) = integrate_state_and_variational(
        system,
        &start,
        tau_time,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    ) {
        let deriv_var = mat_vec_mul_row_major(&phi, &dldt)
            .map(|transported| dot(leaf_normal, &transported))
            .unwrap_or(0.0);
        (point_var, deriv_var)
    } else {
        let point = integrate_state_only(
            system,
            &start,
            tau_time,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
        )
        .ok_or(LeafFailureKind::IntegratorNonFinite)?;
        (point, 0.0)
    };
    let residual = dot(leaf_normal, &subtract(&point, base_point));

    if !deriv.is_finite() || deriv.abs() <= LEAF_PLANE_DERIV_EPS {
        let residual_at = |tau_seg: f64| -> Option<f64> {
            let (seed, _dseed) = segment_point_with_derivative(ring, segment_index, tau_seg);
            let point = integrate_state_only(
                system,
                &seed,
                tau_time,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            )?;
            Some(dot(leaf_normal, &subtract(&point, base_point)))
        };
        let fd_eps = LEAF_TAU_DERIV_FD_EPS.max(1e-6);
        let forward_tau = (tau_segment + fd_eps).min(1.0);
        let backward_tau = (tau_segment - fd_eps).max(0.0);
        deriv = if forward_tau - tau_segment > 1e-12 {
            if let Some(h_forward) = residual_at(forward_tau) {
                (h_forward - residual) / (forward_tau - tau_segment)
            } else {
                0.0
            }
        } else if tau_segment - backward_tau > 1e-12 {
            if let Some(h_backward) = residual_at(backward_tau) {
                (residual - h_backward) / (tau_segment - backward_tau)
            } else {
                0.0
            }
        } else {
            0.0
        };
    }
    if !deriv.is_finite() {
        deriv = 0.0;
    }
    if !residual.is_finite()
        || !point.iter().all(|value| value.is_finite())
        || !start.iter().all(|value| value.is_finite())
    {
        return Err(LeafFailureKind::IntegratorNonFinite);
    }
    Ok((residual, deriv, start, point))
}

#[cfg(test)]
fn canonicalize_segment_tau(tau: f64) -> f64 {
    if tau <= TAU_SWITCH_EPS {
        0.0
    } else if tau >= 1.0 - TAU_SWITCH_EPS {
        1.0
    } else {
        tau.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
fn try_solve_plane_root_on_segment(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    leaf_normal: &[f64],
    segment_index: usize,
    tau_time: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
) -> Result<Option<(f64, Vec<f64>, Vec<f64>)>, LeafFailureKind> {
    let (h0, dh0, start0, end0) = eval_plane_residual_and_derivative_on_segment(
        system,
        ring,
        base_point,
        leaf_normal,
        segment_index,
        tau_time,
        0.0,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    )?;
    if h0.abs() <= plane_tol {
        return Ok(Some((0.0, start0, end0)));
    }

    let (h1, dh1, start1, end1) = eval_plane_residual_and_derivative_on_segment(
        system,
        ring,
        base_point,
        leaf_normal,
        segment_index,
        tau_time,
        1.0,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    )?;
    if h1.abs() <= plane_tol {
        return Ok(Some((1.0, start1, end1)));
    }

    if h0 * h1 <= 0.0 {
        let mut left_tau = 0.0;
        let mut right_tau = 1.0;
        let mut left_h = h0;
        let mut right_h = h1;
        let mut left_start = start0.clone();
        let mut left_end = end0.clone();
        let mut right_start = start1.clone();
        let mut right_end = end1.clone();

        for _ in 0..LEAF_PLANE_BISECT_ITERS {
            let mid_tau = 0.5 * (left_tau + right_tau);
            let (mid_h, _mid_dh, mid_start, mid_end) =
                eval_plane_residual_and_derivative_on_segment(
                    system,
                    ring,
                    base_point,
                    leaf_normal,
                    segment_index,
                    tau_time,
                    mid_tau,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                )?;
            if mid_h.abs() <= plane_tol {
                return Ok(Some((mid_tau, mid_start, mid_end)));
            }
            if left_h * mid_h <= 0.0 {
                right_tau = mid_tau;
                right_h = mid_h;
                right_start = mid_start;
                right_end = mid_end;
            } else {
                left_tau = mid_tau;
                left_h = mid_h;
                left_start = mid_start;
                left_end = mid_end;
            }
        }

        if left_h.abs() <= right_h.abs() {
            return Ok(Some((left_tau, left_start, left_end)));
        }
        return Ok(Some((right_tau, right_start, right_end)));
    }

    if dh0 * dh1 <= 0.0 {
        let mut left_tau = 0.0;
        let mut right_tau = 1.0;
        let mut left_dh = dh0;

        let mut best_abs_h = h0.abs();
        let mut best_tau = 0.0;
        let mut best_start = start0;
        let mut best_end = end0;
        if h1.abs() < best_abs_h {
            best_abs_h = h1.abs();
            best_tau = 1.0;
            best_start = start1;
            best_end = end1;
        }

        for _ in 0..LEAF_PLANE_BISECT_ITERS {
            let mid_tau = 0.5 * (left_tau + right_tau);
            let (mid_h, mid_dh, mid_start, mid_end) =
                eval_plane_residual_and_derivative_on_segment(
                    system,
                    ring,
                    base_point,
                    leaf_normal,
                    segment_index,
                    tau_time,
                    mid_tau,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                )?;
            if mid_h.abs() < best_abs_h {
                best_abs_h = mid_h.abs();
                best_tau = mid_tau;
                best_start = mid_start.clone();
                best_end = mid_end.clone();
            }
            if mid_dh.abs() <= LEAF_PLANE_DERIV_EPS {
                if mid_h.abs() <= plane_tol {
                    return Ok(Some((mid_tau, mid_start, mid_end)));
                }
                break;
            }
            if left_dh * mid_dh <= 0.0 {
                right_tau = mid_tau;
            } else {
                left_tau = mid_tau;
                left_dh = mid_dh;
            }
        }

        let stationary_tau = 0.5 * (left_tau + right_tau);
        let (stationary_h, _stationary_dh, stationary_start, stationary_end) =
            eval_plane_residual_and_derivative_on_segment(
                system,
                ring,
                base_point,
                leaf_normal,
                segment_index,
                tau_time,
                stationary_tau,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            )?;
        if stationary_h.abs() <= plane_tol {
            return Ok(Some((stationary_tau, stationary_start, stationary_end)));
        }
        if best_abs_h <= plane_tol {
            return Ok(Some((best_tau, best_start, best_end)));
        }
    }

    Ok(None)
}

#[cfg(test)]
fn solve_plane_root_polygon(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    leaf_normal: &[f64],
    tau_time: f64,
    seed_seg: usize,
    seed_tau: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
) -> Result<(usize, f64, Vec<f64>, Vec<f64>), LeafFailureKind> {
    solve_plane_root_polygon_with_switch_cap(
        system,
        ring,
        base_point,
        leaf_normal,
        tau_time,
        seed_seg,
        seed_tau,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
        plane_tol,
        None,
    )
}

#[cfg(test)]
fn solve_plane_root_polygon_with_switch_cap(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    leaf_normal: &[f64],
    tau_time: f64,
    seed_seg: usize,
    seed_tau: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
    max_switch_override: Option<usize>,
) -> Result<(usize, f64, Vec<f64>, Vec<f64>), LeafFailureKind> {
    if ring.is_empty() {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let m = ring.len();
    let max_switch = max_switch_override
        .unwrap_or_else(|| m.saturating_add(8).max(LEAF_SEGMENT_SWITCH_MAX).min(4096))
        .max(1);
    let mut seg = seed_seg % m;
    let mut tau = canonicalize_segment_tau(seed_tau.clamp(0.0, 1.0));
    let mut switch_count = 0usize;

    'newton: loop {
        for _ in 0..LEAF_TAU_NEWTON_MAX_ITERS {
            let (h, dh, start, end) = eval_plane_residual_and_derivative_on_segment(
                system,
                ring,
                base_point,
                leaf_normal,
                seg,
                tau_time,
                tau,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            )?;
            if h.abs() <= plane_tol {
                return Ok((seg, canonicalize_segment_tau(tau), start, end));
            }
            if dh.abs() <= LEAF_PLANE_DERIV_EPS {
                break;
            }
            let step = (h / dh).clamp(-LEAF_TAU_NEWTON_MAX_STEP, LEAF_TAU_NEWTON_MAX_STEP);
            let tau_next = tau - step;
            if tau_next < -TAU_SWITCH_EPS {
                seg = (seg + 1) % m;
                tau = canonicalize_segment_tau(tau_next + 1.0);
                switch_count += 1;
                if switch_count >= max_switch {
                    break 'newton;
                }
                continue 'newton;
            }
            if tau_next < 0.0 {
                tau = 0.0;
                continue;
            }
            if tau_next > 1.0 + TAU_SWITCH_EPS {
                seg = (seg + m - 1) % m;
                tau = canonicalize_segment_tau(tau_next - 1.0);
                switch_count += 1;
                if switch_count >= max_switch {
                    break 'newton;
                }
                continue 'newton;
            }
            if tau_next > 1.0 {
                tau = 1.0;
                continue;
            }
            tau = canonicalize_segment_tau(tau_next);
        }
        break;
    }

    let seg0 = seg;
    let scan_limit = m.min(max_switch).max(1);
    for k in 0..scan_limit {
        let forward = (seg0 + k) % m;
        if let Some((tau_root, start, end)) = try_solve_plane_root_on_segment(
            system,
            ring,
            base_point,
            leaf_normal,
            forward,
            tau_time,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            plane_tol,
        )? {
            return Ok((forward, canonicalize_segment_tau(tau_root), start, end));
        }
        if k == 0 {
            continue;
        }
        let backward = (seg0 + m - (k % m)) % m;
        if backward == forward {
            continue;
        }
        if let Some((tau_root, start, end)) = try_solve_plane_root_on_segment(
            system,
            ring,
            base_point,
            leaf_normal,
            backward,
            tau_time,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            plane_tol,
        )? {
            return Ok((backward, canonicalize_segment_tau(tau_root), start, end));
        }
    }

    Err(LeafFailureKind::PlaneSolveNoConvergence)
}

fn solve_leaf_point_with_retries(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    base_s: f64,
    tangent: &[f64],
    outward: &[f64],
    leaf_delta: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    center: Option<&[f64]>,
) -> Result<LeafHit, LeafFailure> {
    let time_cap = max_time.max(dt.max(1e-9));
    let mut dt_try = dt.max(1e-9);
    let dt_min = (dt.abs() * LEAF_DT_MIN_FACTOR).max(1e-9);
    let mut dt_retries = 0usize;
    loop {
        match shoot_leaf_point(
            system,
            ring,
            base_point,
            base_s,
            tangent,
            outward,
            leaf_delta,
            sigma,
            dt_try,
            max_steps_per_leaf,
            time_cap,
            center,
        ) {
            Ok(hit) => return Ok(hit),
            Err(failure) => {
                if failure.kind == LeafFailureKind::IntegratorNonFinite
                    && dt_retries < LEAF_DT_RETRIES
                    && dt_try > dt_min + 1e-12
                {
                    dt_try = (dt_try * LEAF_DT_SHRINK).max(dt_min);
                    dt_retries += 1;
                    continue;
                }
                return Err(failure);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn solve_leaf_point_with_local_floor(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    base_s: f64,
    tangent: &[f64],
    outward: &[f64],
    leaf_delta: f64,
    leaf_delta_floor: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    center: Option<&[f64]>,
) -> Result<(LeafHit, f64), LeafFailure> {
    let floor = leaf_delta_floor.max(1e-12).min(leaf_delta);
    let mut local_delta = leaf_delta;
    let mut last_failure = None;
    for _ in 0..LEAF_REFINE_ATTEMPTS {
        match solve_leaf_point_with_retries(
            system,
            ring,
            base_point,
            base_s,
            tangent,
            outward,
            local_delta,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            center,
        ) {
            Ok(hit) => return Ok((hit, local_delta)),
            Err(failure) => {
                let can_shrink = failure.kind == LeafFailureKind::NoFirstHitWithinMaxTime
                    && local_delta > floor + 1e-12;
                last_failure = Some(failure);
                if !can_shrink {
                    break;
                }
                local_delta = (local_delta * LEAF_DELTA_SHRINK).max(floor);
            }
        }
    }
    Err(last_failure.unwrap_or(LeafFailure {
        kind: LeafFailureKind::NoFirstHitWithinMaxTime,
        last_time: 0.0,
        last_segment: 0,
        last_tau: 0.0,
    }))
}

#[derive(Clone)]
struct LeafContinuationSample {
    source_s: f64,
    time: f64,
    point: Vec<f64>,
    point_source_derivative: Vec<f64>,
    point_time_derivative: Vec<f64>,
    plane_residual: f64,
    radial_distance: f64,
    outward_distance: f64,
}

fn sample_ring_parameter_with_derivative(ring: &[Vec<f64>], source_s: f64) -> (Vec<f64>, Vec<f64>) {
    if ring.is_empty() {
        return (Vec::new(), Vec::new());
    }
    if ring.len() == 1 {
        return (ring[0].clone(), vec![0.0; ring[0].len()]);
    }
    let count = ring.len();
    let scaled = source_s.rem_euclid(1.0) * (count as f64);
    let index = (scaled.floor() as usize) % count;
    let alpha = scaled - scaled.floor();
    let next = (index + 1) % count;
    let point = lerp(&ring[index], &ring[next], alpha);
    let mut derivative = subtract(&ring[next], &ring[index]);
    for value in &mut derivative {
        *value *= count as f64;
    }
    (point, derivative)
}

#[allow(clippy::too_many_arguments)]
fn evaluate_leaf_continuation_sample(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    plane_normal: &[f64],
    outward: &[f64],
    source_s: f64,
    time: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<LeafContinuationSample, LeafFailureKind> {
    if !source_s.is_finite() || !time.is_finite() || time < 0.0 || time > max_time + 1e-12 {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let (start, start_source_derivative) = sample_ring_parameter_with_derivative(ring, source_s);
    if start.len() != base_point.len() || start_source_derivative.len() != base_point.len() {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let (point, phi) = integrate_state_and_variational(
        system,
        &start,
        time,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    )
    .ok_or(LeafFailureKind::IntegratorNonFinite)?;
    let point_source_derivative = mat_vec_mul_row_major(&phi, &start_source_derivative)
        .ok_or(LeafFailureKind::PlaneSolveNoConvergence)?;
    let mut point_time_derivative = vec![0.0; point.len()];
    system.apply(0.0, &point, &mut point_time_derivative);
    for value in &mut point_time_derivative {
        *value *= sigma;
    }
    if point.iter().any(|value| !value.is_finite())
        || point_source_derivative
            .iter()
            .any(|value| !value.is_finite())
        || point_time_derivative.iter().any(|value| !value.is_finite())
    {
        return Err(LeafFailureKind::IntegratorNonFinite);
    }
    let offset = subtract(&point, base_point);
    Ok(LeafContinuationSample {
        source_s,
        time,
        plane_residual: dot(plane_normal, &offset),
        radial_distance: l2_norm(&offset),
        outward_distance: signed_distance_with_direction(outward, &offset),
        point,
        point_source_derivative,
        point_time_derivative,
    })
}

fn leaf_continuation_tangent(
    sample: &LeafContinuationSample,
    plane_normal: &[f64],
    previous: Option<[f64; 2]>,
) -> Option<[f64; 2]> {
    let gradient_source = dot(plane_normal, &sample.point_source_derivative);
    let gradient_time = dot(plane_normal, &sample.point_time_derivative);
    let norm = gradient_source.hypot(gradient_time);
    if !norm.is_finite() || norm <= LEAF_PLANE_DERIV_EPS {
        return None;
    }
    let mut tangent = [-gradient_time / norm, gradient_source / norm];
    if let Some(previous) = previous {
        if tangent[0] * previous[0] + tangent[1] * previous[1] < 0.0 {
            tangent[0] = -tangent[0];
            tangent[1] = -tangent[1];
        }
    } else if tangent[1] < 0.0 {
        tangent[0] = -tangent[0];
        tangent[1] = -tangent[1];
    }
    Some(tangent)
}

#[allow(clippy::too_many_arguments)]
fn correct_leaf_continuation_predictor(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    plane_normal: &[f64],
    outward: &[f64],
    predictor: [f64; 2],
    tangent: [f64; 2],
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
) -> Result<(LeafContinuationSample, usize), LeafFailureKind> {
    let mut source_s = predictor[0];
    let mut time = predictor[1];
    for iteration in 0..LEAF_CONTINUATION_NEWTON_MAX_ITERS {
        let sample = evaluate_leaf_continuation_sample(
            system,
            ring,
            base_point,
            plane_normal,
            outward,
            source_s,
            time,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
        )?;
        let pseudo_residual =
            (source_s - predictor[0]) * tangent[0] + (time - predictor[1]) * tangent[1];
        if sample.plane_residual.abs() <= plane_tol && pseudo_residual.abs() <= plane_tol {
            return Ok((sample, iteration + 1));
        }
        let gradient_source = dot(plane_normal, &sample.point_source_derivative);
        let gradient_time = dot(plane_normal, &sample.point_time_derivative);
        let determinant = gradient_source * tangent[1] - gradient_time * tangent[0];
        if !determinant.is_finite() || determinant.abs() <= LEAF_PLANE_DERIV_EPS {
            return Err(LeafFailureKind::PlaneSolveNoConvergence);
        }
        let delta_source =
            (-sample.plane_residual * tangent[1] + gradient_time * pseudo_residual) / determinant;
        let delta_time =
            (-gradient_source * pseudo_residual + sample.plane_residual * tangent[0]) / determinant;
        if !delta_source.is_finite() || !delta_time.is_finite() {
            return Err(LeafFailureKind::PlaneSolveNoConvergence);
        }
        let mut damping = 1.0;
        while time + damping * delta_time < 0.0 || time + damping * delta_time > max_time + 1e-12 {
            damping *= 0.5;
            if damping < 1.0 / 256.0 {
                return Err(LeafFailureKind::PlaneSolveNoConvergence);
            }
        }
        source_s += damping * delta_source;
        time += damping * delta_time;
    }
    Err(LeafFailureKind::PlaneSolveNoConvergence)
}

#[allow(clippy::too_many_arguments)]
fn solve_leaf_distance_event(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    plane_normal: &[f64],
    outward: &[f64],
    initial_source_s: f64,
    initial_time: f64,
    leaf_delta: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
    distance_tol: f64,
) -> Result<LeafContinuationSample, LeafFailureKind> {
    let mut source_s = initial_source_s;
    let mut time = initial_time;
    for _ in 0..LEAF_CONTINUATION_EVENT_MAX_ITERS {
        let sample = evaluate_leaf_continuation_sample(
            system,
            ring,
            base_point,
            plane_normal,
            outward,
            source_s,
            time,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
        )?;
        let distance_residual = sample.radial_distance - leaf_delta;
        if sample.plane_residual.abs() <= plane_tol && distance_residual.abs() <= distance_tol {
            return Ok(sample);
        }
        if sample.radial_distance <= NORM_EPS {
            return Err(LeafFailureKind::PlaneRootNotBracketed);
        }
        let offset = subtract(&sample.point, base_point);
        let plane_source = dot(plane_normal, &sample.point_source_derivative);
        let plane_time = dot(plane_normal, &sample.point_time_derivative);
        let distance_source =
            dot(&offset, &sample.point_source_derivative) / sample.radial_distance;
        let distance_time = dot(&offset, &sample.point_time_derivative) / sample.radial_distance;
        let determinant = plane_source * distance_time - plane_time * distance_source;
        if !determinant.is_finite() || determinant.abs() <= LEAF_PLANE_DERIV_EPS {
            return Err(LeafFailureKind::PlaneRootNotBracketed);
        }
        let delta_source =
            (-sample.plane_residual * distance_time + plane_time * distance_residual) / determinant;
        let delta_time = (-plane_source * distance_residual
            + sample.plane_residual * distance_source)
            / determinant;
        if !delta_source.is_finite() || !delta_time.is_finite() {
            return Err(LeafFailureKind::PlaneRootNotBracketed);
        }

        let scaled_residual = (sample.plane_residual / plane_tol.max(1e-14))
            .hypot(distance_residual / distance_tol.max(1e-14));
        let mut accepted = false;
        let mut damping = 1.0;
        for _ in 0..8 {
            let candidate_source = source_s + damping * delta_source;
            let candidate_time = time + damping * delta_time;
            if candidate_time < 0.0 || candidate_time > max_time + 1e-12 {
                damping *= 0.5;
                continue;
            }
            let candidate = evaluate_leaf_continuation_sample(
                system,
                ring,
                base_point,
                plane_normal,
                outward,
                candidate_source,
                candidate_time,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            )?;
            let candidate_residual = (candidate.plane_residual / plane_tol.max(1e-14))
                .hypot((candidate.radial_distance - leaf_delta) / distance_tol.max(1e-14));
            if candidate_residual.is_finite() && candidate_residual < scaled_residual {
                source_s = candidate_source;
                time = candidate_time;
                accepted = true;
                break;
            }
            damping *= 0.5;
        }
        if !accepted {
            return Err(LeafFailureKind::PlaneRootNotBracketed);
        }
    }
    Err(LeafFailureKind::PlaneRootNotBracketed)
}

fn shoot_leaf_point(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    base_s: f64,
    tangent: &[f64],
    outward: &[f64],
    leaf_delta: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    _center: Option<&[f64]>,
) -> Result<LeafHit, LeafFailure> {
    if ring.is_empty() || dt <= 0.0 || max_time <= 0.0 {
        return Err(LeafFailure {
            kind: LeafFailureKind::PlaneSolveNoConvergence,
            last_time: 0.0,
            last_segment: 0,
            last_tau: 0.0,
        });
    }
    let leaf_normal = leaf_plane_normal(tangent).ok_or(LeafFailure {
        kind: LeafFailureKind::PlaneSolveNoConvergence,
        last_time: 0.0,
        last_segment: 0,
        last_tau: 0.0,
    })?;
    let signed_direction = normalize(outward.to_vec()).unwrap_or_else(|_| {
        canonical_orthogonal_unit(tangent).unwrap_or_else(|_| {
            let mut fallback = vec![0.0; base_point.len()];
            if let Some(first) = fallback.first_mut() {
                *first = 1.0;
            }
            fallback
        })
    });
    let plane_tol = (leaf_delta * 1e-8).max(1e-10);
    let distance_tol = (leaf_delta * 1e-8).max(1e-10);
    let outward_tol = (leaf_delta * 1e-6).max(1e-10);
    let mut current = evaluate_leaf_continuation_sample(
        system,
        ring,
        base_point,
        &leaf_normal,
        &signed_direction,
        base_s,
        0.0,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    )
    .map_err(|kind| LeafFailure {
        kind,
        last_time: 0.0,
        last_segment: 0,
        last_tau: 0.0,
    })?;
    let mut continuation_tangent =
        leaf_continuation_tangent(&current, &leaf_normal, None).ok_or(LeafFailure {
            kind: LeafFailureKind::PlaneSolveNoConvergence,
            last_time: 0.0,
            last_segment: 0,
            last_tau: 0.0,
        })?;
    let mut continuation_step = (2.0 * dt).clamp(1e-3, LEAF_CONTINUATION_MAX_STEP);
    let mut last_failure_kind = LeafFailureKind::NoFirstHitWithinMaxTime;
    let max_attempts = max_steps_per_leaf.max(64).saturating_mul(8);

    for _ in 0..max_attempts {
        if current.time >= max_time - 1e-12 {
            break;
        }
        let predictor = [
            current.source_s + continuation_step * continuation_tangent[0],
            current.time + continuation_step * continuation_tangent[1],
        ];
        if predictor[1] < 0.0 || predictor[1] > max_time + 1e-12 {
            continuation_step *= 0.5;
            if continuation_step < LEAF_CONTINUATION_MIN_STEP {
                break;
            }
            continue;
        }
        let (next, corrector_iterations) = match correct_leaf_continuation_predictor(
            system,
            ring,
            base_point,
            &leaf_normal,
            &signed_direction,
            predictor,
            continuation_tangent,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            plane_tol,
        ) {
            Ok(next) => next,
            Err(reason) => {
                last_failure_kind = reason;
                continuation_step *= 0.5;
                if continuation_step >= LEAF_CONTINUATION_MIN_STEP {
                    continue;
                }
                break;
            }
        };

        let previous_event = current.radial_distance - leaf_delta;
        let next_event = next.radial_distance - leaf_delta;
        if previous_event * next_event <= 0.0 && next.radial_distance > NORM_EPS {
            let denominator = next.radial_distance - current.radial_distance;
            let alpha = if denominator.abs() <= NORM_EPS {
                0.5
            } else {
                ((leaf_delta - current.radial_distance) / denominator).clamp(0.0, 1.0)
            };
            let source_seed = current.source_s + alpha * (next.source_s - current.source_s);
            let time_seed = current.time + alpha * (next.time - current.time);
            match solve_leaf_distance_event(
                system,
                ring,
                base_point,
                &leaf_normal,
                &signed_direction,
                source_seed,
                time_seed,
                leaf_delta,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
                plane_tol,
                distance_tol,
            ) {
                Ok(hit)
                    if hit.outward_distance >= -outward_tol
                        && hit.plane_residual.abs() <= plane_tol
                        && (hit.radial_distance - leaf_delta).abs() <= distance_tol =>
                {
                    let solved_source_s = hit.source_s.rem_euclid(1.0);
                    let (solved_source, _) =
                        sample_ring_parameter_with_derivative(ring, solved_source_s);
                    return Ok(LeafHit {
                        point: hit.point,
                        tau_hit: hit.time,
                        base_anchor: solved_source_s,
                        in_anchor: solved_source,
                    });
                }
                Ok(_) => {}
                Err(reason) => last_failure_kind = reason,
            }
        }

        let Some(next_tangent) =
            leaf_continuation_tangent(&next, &leaf_normal, Some(continuation_tangent))
        else {
            last_failure_kind = LeafFailureKind::PlaneSolveNoConvergence;
            continuation_step *= 0.5;
            if continuation_step < LEAF_CONTINUATION_MIN_STEP {
                break;
            }
            continue;
        };
        current = next;
        continuation_tangent = next_tangent;
        if corrector_iterations <= 4 {
            continuation_step =
                (continuation_step * LEAF_CONTINUATION_GROWTH).min(LEAF_CONTINUATION_MAX_STEP);
        } else if corrector_iterations >= 10 {
            continuation_step = (continuation_step * 0.5).max(LEAF_CONTINUATION_MIN_STEP);
        }
    }
    let (last_segment, last_tau) = uniform_s_to_segment_tau(ring.len(), current.source_s);
    Err(LeafFailure {
        kind: if current.time >= max_time - 1e-12 {
            LeafFailureKind::NoFirstHitWithinMaxTime
        } else {
            last_failure_kind
        },
        last_time: current.time,
        last_segment,
        last_tau,
    })
}

fn integrate_state_and_variational(
    system: &EquationSystem,
    initial_state: &[f64],
    tau: f64,
    sigma: f64,
    dt: f64,
    max_steps: usize,
    max_time: f64,
) -> Option<(Vec<f64>, Vec<f64>)> {
    let n = initial_state.len();
    if n == 0 {
        return None;
    }
    let clamped_tau = tau.clamp(0.0, max_time);
    let mut state = initial_state.to_vec();
    let mut phi = vec![0.0; n * n];
    for i in 0..n {
        phi[i * n + i] = 1.0;
    }
    if clamped_tau <= 0.0 {
        return Some((state, phi));
    }
    let max_steps = max_steps.max(2);
    let h_min = (clamped_tau / (max_steps as f64)).max(1e-12);
    let h_max = (clamped_tau / 2.0).max(h_min);
    let nominal_h = dt.max(1e-9).clamp(h_min, h_max);
    let mut t = 0.0;
    while t + 1e-15 < clamped_tau {
        let h = (clamped_tau - t).min(nominal_h);
        rk4_state_variational_step(system, &mut state, &mut phi, h, sigma)?;
        if state.iter().any(|value| !value.is_finite())
            || phi.iter().any(|value| !value.is_finite())
        {
            return None;
        }
        t += h;
    }
    Some((state, phi))
}

fn integrate_state_only(
    system: &EquationSystem,
    initial_state: &[f64],
    tau: f64,
    sigma: f64,
    dt: f64,
    max_steps: usize,
    max_time: f64,
) -> Option<Vec<f64>> {
    let n = initial_state.len();
    if n == 0 {
        return None;
    }
    let clamped_tau = tau.clamp(0.0, max_time);
    let mut state = initial_state.to_vec();
    if clamped_tau <= 0.0 {
        return Some(state);
    }
    let max_steps = max_steps.max(2);
    let h_min = (clamped_tau / (max_steps as f64)).max(1e-12);
    let h_max = (clamped_tau / 2.0).max(h_min);
    let nominal_h = dt.max(1e-9).clamp(h_min, h_max);
    let mut t = 0.0;
    while t + 1e-15 < clamped_tau {
        let h = (clamped_tau - t).min(nominal_h);
        rk4_step(system, &mut state, h, sigma);
        if state.iter().any(|value| !value.is_finite()) {
            return None;
        }
        t += h;
    }
    Some(state)
}

fn rk4_state_variational_step(
    system: &EquationSystem,
    state: &mut [f64],
    phi: &mut [f64],
    dt: f64,
    sigma: f64,
) -> Option<()> {
    let n = state.len();
    if phi.len() != n * n {
        return None;
    }

    let (k1_x, k1_phi) = state_variational_rhs(system, state, phi, sigma)?;

    let mut x2 = state.to_vec();
    let mut phi2 = phi.to_vec();
    for i in 0..n {
        x2[i] += 0.5 * dt * k1_x[i];
    }
    for i in 0..(n * n) {
        phi2[i] += 0.5 * dt * k1_phi[i];
    }
    let (k2_x, k2_phi) = state_variational_rhs(system, &x2, &phi2, sigma)?;

    let mut x3 = state.to_vec();
    let mut phi3 = phi.to_vec();
    for i in 0..n {
        x3[i] += 0.5 * dt * k2_x[i];
    }
    for i in 0..(n * n) {
        phi3[i] += 0.5 * dt * k2_phi[i];
    }
    let (k3_x, k3_phi) = state_variational_rhs(system, &x3, &phi3, sigma)?;

    let mut x4 = state.to_vec();
    let mut phi4 = phi.to_vec();
    for i in 0..n {
        x4[i] += dt * k3_x[i];
    }
    for i in 0..(n * n) {
        phi4[i] += dt * k3_phi[i];
    }
    let (k4_x, k4_phi) = state_variational_rhs(system, &x4, &phi4, sigma)?;

    for i in 0..n {
        state[i] += dt * (k1_x[i] + 2.0 * k2_x[i] + 2.0 * k3_x[i] + k4_x[i]) / 6.0;
    }
    for i in 0..(n * n) {
        phi[i] += dt * (k1_phi[i] + 2.0 * k2_phi[i] + 2.0 * k3_phi[i] + k4_phi[i]) / 6.0;
    }
    Some(())
}

fn state_variational_rhs(
    system: &EquationSystem,
    state: &[f64],
    phi: &[f64],
    sigma: f64,
) -> Option<(Vec<f64>, Vec<f64>)> {
    let n = state.len();
    if phi.len() != n * n {
        return None;
    }
    let mut f = vec![0.0; n];
    system.apply(0.0, state, &mut f);
    for value in &mut f {
        *value *= sigma;
    }
    let mut jac = compute_jacobian(system, SystemKind::Flow, state).ok()?;
    for value in &mut jac {
        *value *= sigma;
    }
    let mut phi_dot = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..n {
            let mut sum = 0.0;
            for k in 0..n {
                sum += jac[i * n + k] * phi[k * n + j];
            }
            phi_dot[i * n + j] = sum;
        }
    }
    Some((f, phi_dot))
}

fn mat_vec_mul_row_major(matrix: &[f64], vector: &[f64]) -> Option<Vec<f64>> {
    let n = vector.len();
    if matrix.len() != n * n {
        return None;
    }
    let mut out = vec![0.0; n];
    for i in 0..n {
        let mut sum = 0.0;
        for j in 0..n {
            sum += matrix[i * n + j] * vector[j];
        }
        out[i] = sum;
    }
    Some(out)
}

#[cfg(test)]
fn circular_lerp(a: f64, b: f64, alpha: f64) -> f64 {
    let mut rhs = b;
    if rhs - a > 0.5 {
        rhs -= 1.0;
    } else if rhs - a < -0.5 {
        rhs += 1.0;
    }
    (a + alpha.clamp(0.0, 1.0) * (rhs - a)).rem_euclid(1.0)
}

fn circular_delta(from: f64, to: f64) -> f64 {
    let mut delta = to - from;
    if delta > 0.5 {
        delta -= 1.0;
    } else if delta < -0.5 {
        delta += 1.0;
    }
    delta
}

fn signed_distance_with_direction(direction: &[f64], offset: &[f64]) -> f64 {
    let distance = l2_norm(offset);
    if distance <= NORM_EPS {
        return -distance;
    }
    let alignment = dot(direction, offset);
    let sign_eps = LEAF_SIGN_EPS_SCALE * l2_norm(direction) * distance.max(1.0);
    if alignment <= sign_eps {
        -distance
    } else {
        distance
    }
}

fn leaf_plane_normal(tangent: &[f64]) -> Option<Vec<f64>> {
    normalize(tangent.to_vec())
        .ok()
        .or_else(|| canonical_orthogonal_unit(tangent).ok())
}

fn triangulate_ring_bands(rings: &[Vec<Vec<f64>>], ring_offsets: &[usize]) -> Vec<usize> {
    triangulate_ring_bands_with_parent_anchors(rings, ring_offsets, &[])
}

fn triangulate_ring_bands_with_parent_anchors(
    rings: &[Vec<Vec<f64>>],
    ring_offsets: &[usize],
    parent_anchors: &[Vec<f64>],
) -> Vec<usize> {
    if rings.len() < 2 {
        return Vec::new();
    }
    let mut triangles = Vec::new();
    for band in 0..(rings.len() - 1) {
        let a_ring = &rings[band];
        let b_ring = &rings[band + 1];
        if a_ring.len() < 2 || b_ring.len() < 2 {
            continue;
        }
        let a0 = ring_offsets[band];
        let b0 = ring_offsets[band + 1];
        let m = a_ring.len();
        let n = b_ring.len();
        let valid_parent_anchors = parent_anchors.get(band + 1).filter(|anchors| {
            anchors.len() == n && anchor_params_strictly_monotone_cyclic(anchors)
        });
        let (a_params, b_params, best_i, best_j) = if let Some(anchors) = valid_parent_anchors {
            let a_params = (0..m)
                .map(|index| (index as f64) / (m as f64))
                .collect::<Vec<_>>();
            let b_params = anchors
                .iter()
                .map(|anchor| anchor.rem_euclid(1.0))
                .collect::<Vec<_>>();
            let mut best_i = 0usize;
            let mut best_j = 0usize;
            let mut best_distance = f64::INFINITY;
            for (i, a_param) in a_params.iter().enumerate() {
                for (j, b_param) in b_params.iter().enumerate() {
                    let distance = circular_delta(*a_param, *b_param).abs();
                    if distance < best_distance {
                        best_distance = distance;
                        best_i = i;
                        best_j = j;
                    }
                }
            }
            (a_params, b_params, best_i, best_j)
        } else {
            let mut best_i = 0usize;
            let mut best_j = 0usize;
            let mut best_distance = f64::INFINITY;
            for (i, a_point) in a_ring.iter().enumerate() {
                for (j, b_point) in b_ring.iter().enumerate() {
                    let distance = l2_distance(a_point, b_point);
                    if distance < best_distance {
                        best_distance = distance;
                        best_i = i;
                        best_j = j;
                    }
                }
            }
            (
                normalized_ring_arclength_params(a_ring),
                normalized_ring_arclength_params(b_ring),
                best_i,
                best_j,
            )
        };

        let a_order: Vec<usize> = (0..m).map(|step| (best_i + step) % m).collect();
        let b_order: Vec<usize> = (0..n).map(|step| (best_j + step) % n).collect();
        let a_alpha = ring_progress_from_start(&a_params, best_i);
        let b_beta = ring_progress_from_start(&b_params, best_j);

        let mut advanced_a = 0usize;
        let mut advanced_b = 0usize;
        while advanced_a < m || advanced_b < n {
            let a_i = a0 + a_order[advanced_a % m];
            let b_j = b0 + b_order[advanced_b % n];
            let advance_a = if advanced_a >= m {
                false
            } else if advanced_b >= n {
                true
            } else {
                a_alpha[advanced_a + 1] < b_beta[advanced_b + 1]
            };
            if advance_a {
                let i_next = a_order[(advanced_a + 1) % m];
                triangles.extend_from_slice(&[a_i, b_j, a0 + i_next]);
                advanced_a += 1;
            } else {
                let j_next = b_order[(advanced_b + 1) % n];
                triangles.extend_from_slice(&[a_i, b_j, b0 + j_next]);
                advanced_b += 1;
            }
        }
    }
    triangles
}

fn ring_progress_from_start(params: &[f64], start: usize) -> Vec<f64> {
    if params.is_empty() {
        return Vec::new();
    }
    let len = params.len();
    let base = params[start % len];
    let mut progress = Vec::with_capacity(len + 1);
    for step in 0..=len {
        if step == len {
            progress.push(1.0);
            continue;
        }
        let index = (start + step) % len;
        let mut value = params[index] - base;
        if value < -NORM_EPS {
            value += 1.0;
        }
        progress.push(value.clamp(0.0, 1.0));
    }
    progress
}

fn normalized_ring_arclength_params(ring: &[Vec<f64>]) -> Vec<f64> {
    if ring.is_empty() {
        return Vec::new();
    }
    if ring.len() == 1 {
        return vec![0.0];
    }
    let mut cumulative = vec![0.0; ring.len()];
    for i in 1..ring.len() {
        cumulative[i] = cumulative[i - 1] + l2_distance(&ring[i - 1], &ring[i]);
    }
    let total = cumulative[ring.len() - 1] + l2_distance(&ring[ring.len() - 1], &ring[0]);
    if total <= NORM_EPS {
        return (0..ring.len())
            .map(|i| (i as f64) / (ring.len() as f64))
            .collect();
    }
    cumulative.into_iter().map(|s| s / total).collect()
}

fn surface_points_to_branch_points(
    vertices: &[Vec<f64>],
    ring_offsets: &[usize],
) -> Vec<ContinuationPoint> {
    let mut points = Vec::with_capacity(vertices.len());
    for (idx, point) in vertices.iter().enumerate() {
        let mut param = 0.0;
        for (ring_index, offset) in ring_offsets.iter().enumerate() {
            if idx >= *offset {
                param = ring_index as f64;
            } else {
                break;
            }
        }
        points.push(ContinuationPoint {
            state: point.clone(),
            param_value: param,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        });
    }
    points
}

#[derive(Clone, Default)]
struct DecodedCycleProfile {
    mesh_points: Vec<Vec<f64>>,
    points: Vec<Vec<f64>>,
    /// Normalized cycle phases aligned with `points`.
    phases: Vec<f64>,
    period: f64,
}

fn decode_cycle_profile_points(
    state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> DecodedCycleProfile {
    if state.is_empty() || dim == 0 {
        return DecodedCycleProfile::default();
    }

    let raw_len = state.len().saturating_sub(1);
    let raw = &state[..raw_len];
    let period = state[state.len() - 1];
    if raw.len() == dim {
        return DecodedCycleProfile {
            mesh_points: vec![raw.to_vec()],
            points: vec![raw.to_vec()],
            phases: vec![0.0],
            period,
        };
    }

    let stage_count = ntst.saturating_mul(ncol);
    let stage_len = stage_count.saturating_mul(dim);
    let implicit_mesh_count = ntst;
    let explicit_mesh_count = ntst.saturating_add(1);
    let implicit_total = implicit_mesh_count
        .saturating_mul(dim)
        .saturating_add(stage_len);
    let explicit_total = explicit_mesh_count
        .saturating_mul(dim)
        .saturating_add(stage_len);

    let (mesh_points, stage_points): (Vec<Vec<f64>>, Vec<Vec<f64>>) =
        if raw.len() >= explicit_total && explicit_mesh_count > 0 {
            let mesh_len = explicit_mesh_count * dim;
            let mesh_slice = &raw[..mesh_len];
            let mesh_points = mesh_slice
                .chunks(dim)
                .take(ntst.max(1))
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            let stage_slice = &raw[mesh_len..raw.len().min(mesh_len + stage_len)];
            let stage_points = stage_slice
                .chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            (mesh_points, stage_points)
        } else if raw.len() >= implicit_total && implicit_mesh_count > 0 {
            let mesh_len = implicit_mesh_count * dim;
            let mesh_slice = &raw[..mesh_len];
            let mesh_points = mesh_slice
                .chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            let stage_slice = &raw[mesh_len..raw.len().min(mesh_len + stage_len)];
            let stage_points = stage_slice
                .chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            (mesh_points, stage_points)
        } else if raw.len() >= implicit_mesh_count.saturating_mul(dim) && implicit_mesh_count > 0 {
            let mesh_len = implicit_mesh_count * dim;
            let mesh_points = raw[..mesh_len]
                .chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            (mesh_points, Vec::new())
        } else {
            let mesh_points = raw
                .chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect::<Vec<Vec<f64>>>();
            (mesh_points, Vec::new())
        };

    let (mut points, mut phases) =
        build_phase_ordered_cycle_profile(&mesh_points, &stage_points, ncol);
    if points.len() < 4 {
        points = if mesh_points.len() >= 4 {
            mesh_points.clone()
        } else {
            raw.chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect()
        };
        phases = (0..points.len())
            .map(|index| index as f64 / points.len().max(1) as f64)
            .collect();
    }

    DecodedCycleProfile {
        mesh_points,
        points,
        phases,
        period,
    }
}

fn build_phase_ordered_cycle_profile(
    mesh_points: &[Vec<f64>],
    stage_points: &[Vec<f64>],
    ncol: usize,
) -> (Vec<Vec<f64>>, Vec<f64>) {
    if mesh_points.is_empty() {
        let phases = (0..stage_points.len())
            .map(|index| index as f64 / stage_points.len().max(1) as f64)
            .collect();
        return (stage_points.to_vec(), phases);
    }
    if mesh_points.len() == 1 {
        return (mesh_points.to_vec(), vec![0.0]);
    }

    let mut points = Vec::with_capacity(mesh_points.len().saturating_mul(ncol.saturating_add(1)));
    let mut phases = Vec::with_capacity(points.capacity());
    let stage_nodes = CollocationCoefficients::new(ncol)
        .map(|coefficients| coefficients.nodes)
        .unwrap_or_else(|_| {
            (0..ncol)
                .map(|stage| (stage + 1) as f64 / (ncol + 1) as f64)
                .collect()
        });
    let mesh_count = mesh_points.len() as f64;
    points.push(mesh_points[0].clone());
    phases.push(0.0);
    for interval in 0..mesh_points.len() {
        let stage_offset = interval.saturating_mul(ncol);
        for stage in 0..ncol {
            if let Some(point) = stage_points.get(stage_offset + stage) {
                points.push(point.clone());
                phases.push((interval as f64 + stage_nodes[stage]) / mesh_count);
            }
        }
        if interval + 1 < mesh_points.len() {
            points.push(mesh_points[interval + 1].clone());
            phases.push((interval + 1) as f64 / mesh_count);
        }
    }
    if points.len() < mesh_points.len() {
        let phases = (0..mesh_points.len())
            .map(|index| index as f64 / mesh_points.len() as f64)
            .collect();
        (mesh_points.to_vec(), phases)
    } else {
        (points, phases)
    }
}

fn resample_closed_ring(ring: &[Vec<f64>], points: usize) -> Vec<Vec<f64>> {
    if ring.is_empty() {
        return Vec::new();
    }
    if ring.len() == points {
        return ring.to_vec();
    }
    (0..points)
        .map(|i| {
            let s = (i as f64) / (points as f64);
            sample_ring_uniform(ring, s)
        })
        .collect()
}

fn compute_ring_cumulative_lengths(ring: &[Vec<f64>]) -> (Vec<f64>, f64) {
    if ring.is_empty() {
        return (Vec::new(), 0.0);
    }
    let mut cumulative = vec![0.0; ring.len()];
    for i in 1..ring.len() {
        cumulative[i] = cumulative[i - 1] + l2_distance(&ring[i - 1], &ring[i]);
    }
    let total = if ring.len() > 1 {
        cumulative[ring.len() - 1] + l2_distance(&ring[ring.len() - 1], &ring[0])
    } else {
        0.0
    };
    (cumulative, total)
}

fn ring_segment_at_arclength(cumulative: &[f64], total: f64, s: f64) -> (usize, f64) {
    if cumulative.is_empty() {
        return (0, 0.0);
    }
    if cumulative.len() == 1 || total <= NORM_EPS {
        return (0, 0.0);
    }
    let target = s.rem_euclid(1.0) * total;
    let n = cumulative.len();
    for i in 0..n {
        let start = cumulative[i];
        let end = if i + 1 < n { cumulative[i + 1] } else { total };
        let seg_len = (end - start).max(0.0);
        if target <= end || i + 1 == n {
            let alpha = if seg_len <= NORM_EPS {
                0.0
            } else {
                ((target - start) / seg_len).clamp(0.0, 1.0)
            };
            return (i, alpha);
        }
    }
    (n - 1, 0.0)
}

fn resample_closed_ring_with_anchors_arclength(
    ring: &[Vec<f64>],
    anchors: &[Vec<f64>],
    points: usize,
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>) {
    if ring.is_empty() || points == 0 {
        return (Vec::new(), Vec::new());
    }
    if ring.len() == 1 {
        let anchor = anchors.first().cloned().unwrap_or_else(|| ring[0].clone());
        return (vec![ring[0].clone(); points], vec![anchor; points]);
    }
    let (cumulative, total) = compute_ring_cumulative_lengths(ring);
    let mut resampled_ring = Vec::with_capacity(points);
    let mut resampled_anchors = Vec::with_capacity(points);
    for i in 0..points {
        let s = (i as f64) / (points as f64);
        let (seg, alpha) = ring_segment_at_arclength(&cumulative, total, s);
        let next = (seg + 1) % ring.len();
        let point = lerp(&ring[seg], &ring[next], alpha);
        let anchor = if anchors.len() == ring.len()
            && anchors[seg].len() == point.len()
            && anchors[next].len() == point.len()
        {
            lerp(&anchors[seg], &anchors[next], alpha)
        } else {
            sample_ring_uniform(anchors, s)
        };
        resampled_ring.push(point);
        resampled_anchors.push(anchor);
    }
    (resampled_ring, resampled_anchors)
}

fn orient_direction_field_continuous(directions: &mut [Vec<f64>]) {
    for idx in 0..directions.len() {
        if let Ok(normalized) = normalize(directions[idx].clone()) {
            directions[idx] = normalized;
        }
        if idx == 0 {
            continue;
        }
        if dot(&directions[idx], &directions[idx - 1]) < 0.0 {
            for value in directions[idx].iter_mut() {
                *value = -*value;
            }
        }
    }
}

fn resample_closed_ring_and_vectors_arclength(
    ring: &[Vec<f64>],
    vectors: &[Vec<f64>],
    points: usize,
    antiperiodic: bool,
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>) {
    if ring.is_empty() || vectors.is_empty() || points == 0 {
        return (Vec::new(), Vec::new());
    }
    if ring.len() != vectors.len() {
        let ring_resampled = resample_closed_ring(ring, points);
        let mut vec_resampled = (0..points)
            .map(|index| {
                let position = index as f64 * vectors.len() as f64 / points as f64;
                let segment = (position.floor() as usize).min(vectors.len() - 1);
                let next = (segment + 1) % vectors.len();
                let alpha = position - segment as f64;
                let next_vector = if antiperiodic && next == 0 {
                    vectors[next]
                        .iter()
                        .map(|value| -*value)
                        .collect::<Vec<_>>()
                } else {
                    vectors[next].clone()
                };
                let direction = lerp(&vectors[segment], &next_vector, alpha);
                normalize(direction.clone()).unwrap_or(direction)
            })
            .collect::<Vec<_>>();
        orient_direction_field_continuous(&mut vec_resampled);
        return (ring_resampled, vec_resampled);
    }
    let (cumulative, total) = compute_ring_cumulative_lengths(ring);
    let mut resampled_ring = Vec::with_capacity(points);
    let mut resampled_vectors = Vec::with_capacity(points);
    for i in 0..points {
        let s = (i as f64) / (points as f64);
        let (seg, alpha) = ring_segment_at_arclength(&cumulative, total, s);
        let next = (seg + 1) % ring.len();
        resampled_ring.push(lerp(&ring[seg], &ring[next], alpha));
        let next_vector = if antiperiodic && next == 0 {
            vectors[next]
                .iter()
                .map(|value| -*value)
                .collect::<Vec<_>>()
        } else {
            vectors[next].clone()
        };
        let mut direction = lerp(&vectors[seg], &next_vector, alpha);
        if let Ok(unit) = normalize(direction.clone()) {
            direction = unit;
        }
        resampled_vectors.push(direction);
    }
    orient_direction_field_continuous(&mut resampled_vectors);
    (resampled_ring, resampled_vectors)
}

fn apply_real_matrix_to_vector(matrix: &DMatrix<f64>, vector: &[f64]) -> Option<Vec<f64>> {
    if matrix.ncols() != vector.len() {
        return None;
    }
    let mut output = vec![0.0; matrix.nrows()];
    for row in 0..matrix.nrows() {
        let mut sum = 0.0;
        for col in 0..matrix.ncols() {
            sum += matrix[(row, col)] * vector[col];
        }
        output[row] = sum;
    }
    Some(output)
}

fn apply_stage_sensitivity_to_vector(
    ds_dx: &DMatrix<f64>,
    stage: usize,
    dim: usize,
    vector: &[f64],
) -> Option<Vec<f64>> {
    let row_start = stage.checked_mul(dim)?;
    if row_start + dim > ds_dx.nrows() || ds_dx.ncols() != vector.len() {
        return None;
    }
    let mut output = vec![0.0; dim];
    for row in 0..dim {
        let mut sum = 0.0;
        for col in 0..ds_dx.ncols() {
            sum += ds_dx[(row_start + row, col)] * vector[col];
        }
        output[row] = sum;
    }
    Some(output)
}

fn floquet_real_vector_from_monodromy(
    monodromy: &DMatrix<f64>,
    multiplier: f64,
) -> Result<Vec<f64>> {
    if monodromy.nrows() == 0 || monodromy.nrows() != monodromy.ncols() {
        bail!("Monodromy matrix must be square and non-empty.");
    }
    let dim = monodromy.nrows();
    let mut shifted = monodromy.clone();
    for i in 0..dim {
        shifted[(i, i)] -= multiplier;
    }
    let svd = SVD::new(shifted, false, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Failed to compute Floquet seed vector (SVD V^T missing)."))?;
    let row = v_t.nrows().saturating_sub(1);
    let mut vector = Vec::with_capacity(dim);
    for i in 0..dim {
        vector.push(v_t[(row, i)]);
    }
    normalize(vector)
}

fn transport_mesh_floquet_directions(
    v0: &[f64],
    transfers: &[DMatrix<f64>],
    mesh_count: usize,
) -> Vec<Vec<f64>> {
    if mesh_count == 0 {
        return Vec::new();
    }
    let mut mesh_dirs = vec![v0.to_vec()];
    for interval in 0..mesh_count.saturating_sub(1) {
        let previous = mesh_dirs.last().cloned().unwrap_or_else(|| v0.to_vec());
        let mut next = transfers
            .get(interval)
            .and_then(|transfer| apply_real_matrix_to_vector(transfer, &previous))
            .unwrap_or(previous);
        if let Ok(unit) = normalize(next.clone()) {
            next = unit;
        }
        if dot(&next, mesh_dirs.last().unwrap()) < 0.0 {
            for value in next.iter_mut() {
                *value = -*value;
            }
        }
        mesh_dirs.push(next);
    }
    mesh_dirs
}

fn build_profile_floquet_directions(
    mesh_dirs: &[Vec<f64>],
    stage_sensitivities: &[DMatrix<f64>],
    mesh_count: usize,
    ncol: usize,
    dim: usize,
) -> Vec<Vec<f64>> {
    if mesh_dirs.is_empty() {
        return Vec::new();
    }
    if mesh_count <= 1 {
        return vec![mesh_dirs[0].clone()];
    }
    let mut profile_dirs = Vec::with_capacity(mesh_count.saturating_mul(ncol.saturating_add(1)));
    profile_dirs.push(mesh_dirs[0].clone());
    for interval in 0..mesh_count {
        for stage in 0..ncol {
            let stage_vec = stage_sensitivities
                .get(interval)
                .and_then(|ds_dx| {
                    apply_stage_sensitivity_to_vector(ds_dx, stage, dim, &mesh_dirs[interval])
                })
                .unwrap_or_else(|| mesh_dirs[interval].clone());
            profile_dirs.push(stage_vec);
        }
        if interval + 1 < mesh_count {
            profile_dirs.push(mesh_dirs[interval + 1].clone());
        }
    }
    orient_direction_field_continuous(&mut profile_dirs);
    profile_dirs
}

fn validate_requested_floquet_multiplier(
    actual_multipliers: &[Complex<f64>],
    requested: Complex<f64>,
) -> Result<Complex<f64>> {
    if !requested.re.is_finite() || !requested.im.is_finite() {
        bail!("Requested Floquet multiplier is not finite.");
    }
    let real_tolerance = 1e-8 * requested.norm().max(1.0);
    if requested.im.abs() > real_tolerance {
        bail!("The 2D cycle-manifold solver requires a real Floquet multiplier.");
    }
    let stability = if requested.norm() < 1.0 - 1e-6 {
        ManifoldStability::Stable
    } else if requested.norm() > 1.0 + 1e-6 {
        ManifoldStability::Unstable
    } else {
        bail!("Requested Floquet multiplier is too close to the unit circle.");
    };
    let (_, actual) = select_floquet_multiplier(actual_multipliers, stability, None).map_err(
        |error| {
            anyhow!(
                "Requested Floquet multiplier {:?} does not match an eligible multiplier in the recomputed spectrum: {}",
                requested,
                error
            )
        },
    )?;
    let scale = requested.norm().max(actual.norm()).max(1.0);
    let tolerance = 1e-3 + 1e-2 * scale;
    let error = (actual - requested).norm();
    if !error.is_finite() || error > tolerance {
        bail!(
            "Requested Floquet multiplier {:?} does not match the recomputed multiplier {:?} (error {:.3e}, tolerance {:.3e}).",
            requested,
            actual,
            error,
            tolerance
        );
    }
    let sign_tolerance = 1e-10 * scale;
    if requested.re.abs() > sign_tolerance
        && actual.re.abs() > sign_tolerance
        && requested.re.signum() != actual.re.signum()
    {
        bail!(
            "Requested Floquet multiplier {:?} does not match the recomputed multiplier {:?}: orientability changed.",
            requested,
            actual
        );
    }
    Ok(actual)
}

fn build_cycle_floquet_seed_from_collocation(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    profile: &DecodedCycleProfile,
    ntst: usize,
    ncol: usize,
    parameter_index: usize,
    multiplier: Complex<f64>,
    ring_points: usize,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>, Complex<f64>)> {
    let monodromy_data =
        compute_cycle_monodromy_data(system, parameter_index, cycle_state, ntst, ncol)?;
    let matched_multiplier =
        validate_requested_floquet_multiplier(&monodromy_data.multipliers, multiplier)?;
    let (_, v0) =
        floquet_real_eigenvector_from_transfers(&monodromy_data.transfers, matched_multiplier)?;
    let mesh_count = profile.mesh_points.len().max(1).min(ntst.max(1));
    let mesh_dirs = transport_mesh_floquet_directions(&v0, &monodromy_data.transfers, mesh_count);
    let mut profile_dirs = build_profile_floquet_directions(
        &mesh_dirs,
        &monodromy_data.stage_sensitivities,
        mesh_count,
        ncol,
        v0.len(),
    );
    if profile_dirs.len() != profile.points.len() {
        profile_dirs = resample_closed_ring(&profile_dirs, profile.points.len().max(1));
        orient_direction_field_continuous(&mut profile_dirs);
    }
    let (ring, dirs) = resample_closed_ring_and_vectors_arclength(
        &profile.points,
        &profile_dirs,
        ring_points.max(4),
        matched_multiplier.re < 0.0,
    );
    Ok((ring, dirs, matched_multiplier))
}

fn build_cycle_floquet_seed_variational(
    system: &EquationSystem,
    profile: &DecodedCycleProfile,
    multiplier: Complex<f64>,
    ring_points: usize,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>, Complex<f64>)> {
    if profile.points.is_empty() {
        bail!("Cycle profile is empty.");
    }
    let start = profile
        .mesh_points
        .first()
        .cloned()
        .unwrap_or_else(|| profile.points[0].clone());
    let period = if profile.period.is_finite() && profile.period > 0.0 {
        profile.period
    } else {
        max_time.max(dt).max(1e-6)
    };
    // Surface-growth caps must not truncate the one-period variational solve
    // used to identify the invariant bundle.
    let variational_max_steps =
        max_steps_per_leaf.max((period / dt.max(1e-9)).ceil().max(1.0) as usize + 2);
    let (_, phi_t) = integrate_state_and_variational(
        system,
        &start,
        period,
        1.0,
        dt.max(1e-9),
        variational_max_steps,
        period,
    )
    .ok_or_else(|| anyhow!("Variational fallback failed to integrate monodromy."))?;
    let dim = start.len();
    let monodromy = DMatrix::from_row_slice(dim, dim, &phi_t);
    let actual_multipliers = monodromy
        .complex_eigenvalues()
        .iter()
        .copied()
        .collect::<Vec<_>>();
    let matched_multiplier =
        validate_requested_floquet_multiplier(&actual_multipliers, multiplier)?;
    let v0 = floquet_real_vector_from_monodromy(&monodromy, matched_multiplier.re)?;
    let mut profile_dirs = Vec::with_capacity(profile.points.len());
    for i in 0..profile.points.len() {
        let normalized_phase = profile
            .phases
            .get(i)
            .copied()
            .filter(|phase| phase.is_finite())
            .unwrap_or_else(|| i as f64 / profile.points.len().max(1) as f64)
            .rem_euclid(1.0);
        let tau = period * normalized_phase;
        let (_, phi_tau) = integrate_state_and_variational(
            system,
            &start,
            tau,
            1.0,
            dt.max(1e-9),
            variational_max_steps,
            period,
        )
        .ok_or_else(|| {
            anyhow!("Variational fallback failed while transporting Floquet direction.")
        })?;
        let direction = mat_vec_mul_row_major(&phi_tau, &v0).ok_or_else(|| {
            anyhow!("Variational fallback produced invalid Floquet transport matrix.")
        })?;
        profile_dirs.push(direction);
    }
    orient_direction_field_continuous(&mut profile_dirs);
    let (ring, dirs) = resample_closed_ring_and_vectors_arclength(
        &profile.points,
        &profile_dirs,
        ring_points.max(4),
        matched_multiplier.re < 0.0,
    );
    Ok((ring, dirs, matched_multiplier))
}

fn build_cycle_floquet_seed(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    profile: &DecodedCycleProfile,
    ntst: usize,
    ncol: usize,
    parameter_index: Option<usize>,
    multiplier: Complex<f64>,
    ring_points: usize,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>, Complex<f64>)> {
    if let Some(index) = parameter_index {
        if index >= system.params.len() {
            bail!("Cycle manifold parameter index is out of bounds.");
        }
        return build_cycle_floquet_seed_from_collocation(
            system,
            cycle_state,
            profile,
            ntst,
            ncol,
            index,
            multiplier,
            ring_points,
        )
        .map_err(|error| anyhow!("Collocation Floquet seed construction failed: {error}"));
    }

    // Legacy callers without parameter provenance cannot rebuild the
    // collocation Jacobian.  Keep the integration path explicit for that case;
    // never use it to hide a failed collocation calculation.
    build_cycle_floquet_seed_variational(
        system,
        profile,
        multiplier,
        ring_points,
        dt,
        max_steps_per_leaf,
        max_time,
    )
}

fn ring_edge_ratio(ring: &[Vec<f64>]) -> f64 {
    if ring.len() < 2 {
        return 1.0;
    }
    let mut min_edge = f64::INFINITY;
    let mut max_edge: f64 = 0.0;
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        let edge = l2_distance(&ring[i], &ring[j]);
        min_edge = min_edge.min(edge);
        max_edge = max_edge.max(edge);
    }
    if !min_edge.is_finite() || min_edge <= NORM_EPS {
        return f64::INFINITY;
    }
    max_edge / min_edge
}

fn select_floquet_multiplier(
    multipliers: &[Complex<f64>],
    stability: ManifoldStability,
    requested_index: Option<usize>,
) -> Result<(usize, Complex<f64>)> {
    let transverse_dimension = multipliers
        .iter()
        .filter(|value| {
            if (value.re - 1.0).abs() <= 1e-3 && value.im.abs() <= 1e-3 {
                return false;
            }
            let modulus = value.norm();
            match stability {
                ManifoldStability::Unstable => modulus > 1.0 + 1e-6,
                ManifoldStability::Stable => modulus < 1.0 - 1e-6,
            }
        })
        .count();
    if transverse_dimension != 1 {
        bail!(
            "Selected {} cycle manifold dimension is {}; the 2D cycle-manifold solver requires exactly one transverse mode on the selected side.",
            match stability {
                ManifoldStability::Stable => "stable",
                ManifoldStability::Unstable => "unstable",
            },
            transverse_dimension + 1
        );
    }
    let mut candidates = Vec::new();
    for (idx, value) in multipliers.iter().copied().enumerate() {
        if value.im.abs() > 1e-8 {
            continue;
        }
        if (value.re - 1.0).abs() <= 1e-3 {
            continue;
        }
        let modulus = value.norm();
        let matches = match stability {
            ManifoldStability::Unstable => modulus > 1.0 + 1e-6,
            ManifoldStability::Stable => modulus < 1.0 - 1e-6,
        };
        if matches {
            candidates.push((idx, value));
        }
    }
    if candidates.is_empty() {
        bail!("No real nontrivial Floquet multiplier matches selected manifold stability.");
    }
    if let Some(index) = requested_index {
        if let Some(found) = candidates.into_iter().find(|(idx, _)| *idx == index) {
            return Ok(found);
        }
        bail!(
            "Requested Floquet index {} is not eligible.",
            index.saturating_add(1)
        );
    }
    Ok(candidates[0])
}

fn stability_sigma(stability: ManifoldStability) -> f64 {
    match stability {
        ManifoldStability::Unstable => 1.0,
        ManifoldStability::Stable => -1.0,
    }
}

fn matches_stability(real_part: f64, stability: ManifoldStability) -> bool {
    match stability {
        ManifoldStability::Unstable => real_part > 1e-9,
        ManifoldStability::Stable => real_part < -1e-9,
    }
}

fn matches_stability_map(multiplier: Complex<f64>, stability: ManifoldStability) -> bool {
    if multiplier.im.abs() > MAP_MANIFOLD_REAL_TOL {
        return false;
    }
    let modulus = multiplier.norm();
    match stability {
        ManifoldStability::Unstable => modulus > 1.0 + MAP_MANIFOLD_SIDE_TOL,
        ManifoldStability::Stable => modulus < 1.0 - MAP_MANIFOLD_SIDE_TOL,
    }
}

fn matches_stability_for_kind(
    eigenvalue: Complex<f64>,
    kind: SystemKind,
    stability: ManifoldStability,
) -> bool {
    match kind {
        SystemKind::Flow => matches_stability(eigenvalue.re, stability),
        SystemKind::Map { .. } => matches_stability_map(eigenvalue, stability),
    }
}

fn build_flow_manifold_curve(
    system: &EquationSystem,
    source: &PreparedManifold1DSource,
    direction: ManifoldDirection,
    settings: &Manifold1DSettings,
    periodicity: &StatePeriodicity,
) -> Result<ManifoldCurveSolve> {
    let sign = if direction == ManifoldDirection::Minus {
        -1.0
    } else {
        1.0
    };
    let sigma = stability_sigma(settings.stability);
    let mut anchor = source.state.clone();
    periodicity.wrap_state(&mut anchor);
    let mut seed_lifted = source.state.clone();
    for (value, direction_value) in seed_lifted.iter_mut().zip(source.mode.vector.iter()) {
        *value += sign * settings.eps * direction_value;
    }
    let mut seed_wrapped = seed_lifted.clone();
    periodicity.wrap_state(&mut seed_wrapped);

    if let Some(bounds) = settings.bounds.as_ref() {
        if !inside_bounds(&anchor, bounds) {
            bail!("The corrected equilibrium lies outside the configured manifold bounds.");
        }
        if !inside_bounds(&seed_wrapped, bounds) {
            bail!("The local manifold seed lies outside the configured manifold bounds.");
        }
    }

    let target = settings.target_arclength;
    let seed_arc = periodic_l2_distance(&anchor, &seed_lifted, periodicity);
    let mut lifted_points = vec![source.state.clone()];
    let mut arclength = vec![0.0];
    if target <= seed_arc && seed_arc > NORM_EPS {
        let alpha = (target / seed_arc).clamp(0.0, 1.0);
        lifted_points.push(lerp(&source.state, &seed_lifted, alpha));
        arclength.push(target);
        let (points, arclength) = resample_and_wrap_curve(
            &lifted_points,
            &arclength,
            settings.caps.max_points,
            periodicity,
        );
        return Ok(ManifoldCurveSolve {
            resume_state: points
                .last()
                .cloned()
                .map(|endpoint| ManifoldCurveResumeState::Flow {
                    version: 1,
                    endpoint,
                }),
            points,
            arclength,
            diagnostics: ManifoldCurveSolverDiagnostics {
                termination_reason: "target_arclength".to_string(),
                requested_arclength: target,
                achieved_arclength: target,
                target_reached: true,
                source_correction_norm: source.correction_norm,
                least_period: source.least_period,
                ..ManifoldCurveSolverDiagnostics::default()
            },
        });
    }

    lifted_points.push(seed_lifted.clone());
    arclength.push(seed_arc);
    let mut state = seed_lifted;
    let mut cumulative = seed_arc;
    let mut elapsed = 0.0;
    let dt = settings.integration_dt.abs();
    let mut integration_steps = 0usize;
    let mut termination_reason = "max_steps".to_string();
    let mut termination_detail = None;
    let mut target_reached = false;

    while integration_steps < settings.caps.max_steps {
        if elapsed >= settings.caps.max_time {
            termination_reason = "max_time".to_string();
            break;
        }
        let h = dt.min(settings.caps.max_time - elapsed);
        if h <= 0.0 {
            termination_reason = "max_time".to_string();
            break;
        }
        let mut next = state.clone();
        rk4_step_with_periodicity(system, &mut next, h, sigma, periodicity);
        integration_steps += 1;
        elapsed += h;

        if next.iter().any(|value| !value.is_finite()) {
            termination_reason = "non_finite_state".to_string();
            termination_detail = Some(format!(
                "non-finite state after integration step {}",
                integration_steps
            ));
            break;
        }
        let mut next_wrapped = next.clone();
        periodicity.wrap_state(&mut next_wrapped);
        if let Some(bounds) = settings.bounds.as_ref() {
            if !inside_bounds(&next_wrapped, bounds) {
                termination_reason = "bounds_exit".to_string();
                termination_detail = Some(format!(
                    "left configured bounds after integration step {}",
                    integration_steps
                ));
                break;
            }
        }

        let step_arc = periodic_l2_distance(&state, &next, periodicity);
        if !step_arc.is_finite() {
            termination_reason = "non_finite_arclength".to_string();
            break;
        }
        if cumulative + step_arc >= target && step_arc > NORM_EPS {
            let alpha = ((target - cumulative) / step_arc).clamp(0.0, 1.0);
            lifted_points.push(lerp(&state, &next, alpha));
            arclength.push(target);
            termination_reason = "target_arclength".to_string();
            target_reached = true;
            break;
        }

        cumulative += step_arc;
        lifted_points.push(next.clone());
        arclength.push(cumulative);
        state = next;
    }

    let (points, arclength) = resample_and_wrap_curve(
        &lifted_points,
        &arclength,
        settings.caps.max_points,
        periodicity,
    );
    let achieved_arclength = *arclength.last().unwrap_or(&0.0);
    Ok(ManifoldCurveSolve {
        resume_state: points
            .last()
            .cloned()
            .map(|endpoint| ManifoldCurveResumeState::Flow {
                version: 1,
                endpoint,
            }),
        points,
        arclength,
        diagnostics: ManifoldCurveSolverDiagnostics {
            termination_reason,
            termination_detail,
            requested_arclength: target,
            achieved_arclength,
            target_reached,
            integration_steps,
            source_correction_norm: source.correction_norm,
            least_period: source.least_period,
            ..ManifoldCurveSolverDiagnostics::default()
        },
    })
}

fn build_flow_manifold_extension(
    system: &EquationSystem,
    endpoint: &[f64],
    stability: ManifoldStability,
    settings: &Manifold1DSettings,
    periodicity: &StatePeriodicity,
) -> Result<ManifoldCurveSolve> {
    if endpoint.len() != system.equations.len() {
        bail!("Flow manifold extension endpoint dimension mismatch.");
    }
    let mut start = endpoint.to_vec();
    periodicity.wrap_state(&mut start);
    if let Some(bounds) = settings.bounds.as_ref() {
        if !inside_bounds(&start, bounds) {
            bail!("The manifold extension endpoint lies outside configured bounds.");
        }
    }

    let target = settings.target_arclength;
    let sigma = stability_sigma(stability);
    let dt = settings.integration_dt.abs();
    let mut lifted_points = vec![start.clone()];
    let mut local_arclength = vec![0.0];
    let mut state = start;
    let mut cumulative = 0.0;
    let mut elapsed = 0.0;
    let mut integration_steps = 0usize;
    let mut termination_reason = "max_steps".to_string();
    let mut termination_detail = None;
    let mut target_reached = false;

    while integration_steps < settings.caps.max_steps {
        if elapsed >= settings.caps.max_time {
            termination_reason = "max_time".to_string();
            break;
        }
        let h = dt.min(settings.caps.max_time - elapsed);
        if h <= 0.0 {
            termination_reason = "max_time".to_string();
            break;
        }
        let mut next = state.clone();
        rk4_step_with_periodicity(system, &mut next, h, sigma, periodicity);
        integration_steps += 1;
        elapsed += h;
        if next.iter().any(|value| !value.is_finite()) {
            termination_reason = "non_finite_state".to_string();
            termination_detail = Some(format!(
                "non-finite state after extension step {}",
                integration_steps
            ));
            break;
        }
        let mut next_wrapped = next.clone();
        periodicity.wrap_state(&mut next_wrapped);
        if let Some(bounds) = settings.bounds.as_ref() {
            if !inside_bounds(&next_wrapped, bounds) {
                termination_reason = "bounds_exit".to_string();
                termination_detail = Some(format!(
                    "left configured bounds after extension step {}",
                    integration_steps
                ));
                break;
            }
        }
        let step_arc = periodic_l2_distance(&state, &next, periodicity);
        if !step_arc.is_finite() {
            termination_reason = "non_finite_arclength".to_string();
            break;
        }
        if cumulative + step_arc >= target && step_arc > NORM_EPS {
            let alpha = ((target - cumulative) / step_arc).clamp(0.0, 1.0);
            lifted_points.push(lerp(&state, &next, alpha));
            local_arclength.push(target);
            termination_reason = "target_arclength".to_string();
            target_reached = true;
            break;
        }
        cumulative += step_arc;
        lifted_points.push(next.clone());
        local_arclength.push(cumulative);
        state = next;
    }

    let (points, arclength) = resample_and_wrap_curve(
        &lifted_points,
        &local_arclength,
        settings.caps.max_points,
        periodicity,
    );
    let achieved_arclength = *arclength.last().unwrap_or(&0.0);
    Ok(ManifoldCurveSolve {
        resume_state: points
            .last()
            .cloned()
            .map(|endpoint| ManifoldCurveResumeState::Flow {
                version: 1,
                endpoint,
            }),
        points,
        arclength,
        diagnostics: ManifoldCurveSolverDiagnostics {
            termination_reason,
            termination_detail,
            requested_arclength: target,
            achieved_arclength,
            target_reached,
            integration_steps,
            ..ManifoldCurveSolverDiagnostics::default()
        },
    })
}

fn merge_manifold_curve_extension(
    mut branch: ContinuationBranch,
    extension: ManifoldCurveSolve,
    source_arclength: Option<Vec<f64>>,
) -> Result<ContinuationBranch> {
    if extension.points.len() < 2 || extension.arclength.len() != extension.points.len() {
        bail!("Manifold extension produced no new curve segment.");
    }
    let old_total = branch
        .points
        .last()
        .map(|point| point.param_value)
        .unwrap_or(0.0);
    let old_count = branch.points.len();
    for (point, local_s) in extension
        .points
        .iter()
        .zip(extension.arclength.iter())
        .skip(1)
    {
        branch.points.push(ContinuationPoint {
            state: point.clone(),
            param_value: old_total + local_s,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
        });
        branch
            .indices
            .push(branch.indices.last().copied().unwrap_or(-1) + 1);
    }

    let ManifoldGeometry::Curve(geometry) = branch
        .manifold_geometry
        .as_mut()
        .ok_or_else(|| anyhow!("Manifold branch is missing curve geometry."))?
    else {
        bail!("Manifold branch geometry is not a curve.");
    };
    if geometry.dim == 0 || geometry.points_flat.len() != old_count * geometry.dim {
        bail!("Stored manifold curve geometry is inconsistent with branch points.");
    }
    for point in extension.points.iter().skip(1) {
        geometry.points_flat.extend_from_slice(point);
    }
    geometry.arclength.extend(
        extension
            .arclength
            .iter()
            .skip(1)
            .map(|local_s| old_total + local_s),
    );
    if let Some(source_extension) = source_arclength {
        let source_offset = geometry
            .source_arclength
            .as_ref()
            .and_then(|values| values.last())
            .copied()
            .unwrap_or(old_total);
        geometry
            .source_arclength
            .get_or_insert_with(|| geometry.arclength[..old_count].to_vec())
            .extend(
                source_extension
                    .iter()
                    .skip(1)
                    .map(|local_s| source_offset + local_s),
            );
    }
    let mut diagnostics = geometry.solver_diagnostics.take().unwrap_or_default();
    diagnostics.requested_arclength = old_total + extension.diagnostics.requested_arclength;
    diagnostics.achieved_arclength = old_total + extension.diagnostics.achieved_arclength;
    diagnostics.target_reached = extension.diagnostics.target_reached;
    diagnostics.termination_reason = extension.diagnostics.termination_reason;
    diagnostics.termination_detail = extension.diagnostics.termination_detail;
    diagnostics.integration_steps += extension.diagnostics.integration_steps;
    diagnostics.map_growth_iterations += extension.diagnostics.map_growth_iterations;
    diagnostics.preimage_failures += extension.diagnostics.preimage_failures;
    diagnostics.refinement_failures += extension.diagnostics.refinement_failures;
    diagnostics.extension_count += 1;
    geometry.solver_diagnostics = Some(diagnostics);
    geometry.resume_state = extension.resume_state;
    Ok(branch)
}

fn resample_and_wrap_curve(
    lifted_points: &[Vec<f64>],
    arclength: &[f64],
    max_points: usize,
    periodicity: &StatePeriodicity,
) -> (Vec<Vec<f64>>, Vec<f64>) {
    if lifted_points.is_empty() || arclength.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let count = lifted_points.len().min(arclength.len());
    let output_count = count.min(max_points.max(2));
    let total = arclength[count - 1];
    let mut points = Vec::with_capacity(output_count);
    let mut output_arclength = Vec::with_capacity(output_count);
    let mut segment = 0usize;
    for output_index in 0..output_count {
        let target = if output_count <= 1 {
            0.0
        } else {
            total * (output_index as f64) / ((output_count - 1) as f64)
        };
        while segment + 1 < count && arclength[segment + 1] < target {
            segment += 1;
        }
        let mut point = if segment + 1 < count {
            let left = arclength[segment];
            let right = arclength[segment + 1];
            let alpha = if right > left {
                ((target - left) / (right - left)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            lerp(&lifted_points[segment], &lifted_points[segment + 1], alpha)
        } else {
            lifted_points[count - 1].clone()
        };
        periodicity.wrap_state(&mut point);
        points.push(point);
        output_arclength.push(target);
    }
    (points, output_arclength)
}

fn apply_flow_with_periodicity(
    system: &EquationSystem,
    state: &[f64],
    out: &mut [f64],
    periodicity: &StatePeriodicity,
) {
    let mut wrapped = state.to_vec();
    periodicity.wrap_state(&mut wrapped);
    system.apply(0.0, &wrapped, out);
}

fn rk4_step_with_periodicity(
    system: &EquationSystem,
    state: &mut [f64],
    dt: f64,
    sigma: f64,
    periodicity: &StatePeriodicity,
) {
    let dim = state.len();
    let mut k1 = vec![0.0; dim];
    let mut k2 = vec![0.0; dim];
    let mut k3 = vec![0.0; dim];
    let mut k4 = vec![0.0; dim];
    let mut tmp = vec![0.0; dim];

    apply_flow_with_periodicity(system, state, &mut k1, periodicity);
    for i in 0..dim {
        k1[i] *= sigma;
        tmp[i] = state[i] + 0.5 * dt * k1[i];
    }
    apply_flow_with_periodicity(system, &tmp, &mut k2, periodicity);
    for i in 0..dim {
        k2[i] *= sigma;
        tmp[i] = state[i] + 0.5 * dt * k2[i];
    }
    apply_flow_with_periodicity(system, &tmp, &mut k3, periodicity);
    for i in 0..dim {
        k3[i] *= sigma;
        tmp[i] = state[i] + dt * k3[i];
    }
    apply_flow_with_periodicity(system, &tmp, &mut k4, periodicity);
    for i in 0..dim {
        k4[i] *= sigma;
        state[i] += dt * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0;
    }
}

fn periodic_l2_distance(a: &[f64], b: &[f64], periodicity: &StatePeriodicity) -> f64 {
    a.iter()
        .zip(b.iter())
        .enumerate()
        .map(|(index, (left, right))| {
            let delta = periodicity.wrapped_delta(index, right - left);
            delta * delta
        })
        .sum::<f64>()
        .sqrt()
}

fn periodic_difference(from: &[f64], to: &[f64], periodicity: &StatePeriodicity) -> Vec<f64> {
    from.iter()
        .zip(to.iter())
        .enumerate()
        .map(|(index, (left, right))| periodicity.wrapped_delta(index, right - left))
        .collect()
}

fn periodic_lerp(from: &[f64], to: &[f64], alpha: f64, periodicity: &StatePeriodicity) -> Vec<f64> {
    let delta = periodic_difference(from, to, periodicity);
    let mut point = from
        .iter()
        .zip(delta.iter())
        .map(|(value, offset)| value + alpha * offset)
        .collect::<Vec<_>>();
    periodicity.wrap_state(&mut point);
    point
}

fn cumulative_polyline_arclength(points: &[Vec<f64>], periodicity: &StatePeriodicity) -> Vec<f64> {
    if points.is_empty() {
        return Vec::new();
    }
    let mut arclength = Vec::with_capacity(points.len());
    arclength.push(0.0);
    for pair in points.windows(2) {
        let next = arclength.last().copied().unwrap_or(0.0)
            + periodic_l2_distance(&pair[0], &pair[1], periodicity);
        arclength.push(next);
    }
    arclength
}

#[derive(Clone)]
struct ResumableMapManifoldState {
    version: usize,
    cycle_anchor: Vec<f64>,
    active_domain: Vec<Vec<f64>>,
    pending_points: Option<Vec<Vec<f64>>>,
    cursor: Option<ManifoldMapDomainCursor>,
    spacing_target: f64,
    map_step_iterations: usize,
    growth_iterations: usize,
}

impl ResumableMapManifoldState {
    fn from_resume(resume: ManifoldCurveResumeState) -> Result<Self> {
        let ManifoldCurveResumeState::Map {
            version,
            cycle_anchor,
            active_domain,
            pending_points,
            cursor,
            spacing_target,
            map_step_iterations,
            growth_iterations,
        } = resume
        else {
            bail!("Stored manifold resume state is not a map state.");
        };
        if version != 1 {
            bail!("Unsupported map manifold resume-state version {}.", version);
        }
        if active_domain.len() < 2 || map_step_iterations == 0 {
            bail!("Stored map manifold resume state is incomplete.");
        }
        if !spacing_target.is_finite() || spacing_target <= 0.0 {
            bail!("Stored map manifold spacing target is invalid.");
        }
        if let Some(cursor) = cursor.as_ref() {
            let pending_len = pending_points
                .as_ref()
                .map(|points| points.len())
                .unwrap_or(active_domain.len());
            if cursor.segment_index + 1 >= pending_len {
                bail!("Stored map manifold output cursor is out of range.");
            }
        }
        Ok(Self {
            version,
            cycle_anchor,
            active_domain,
            pending_points,
            cursor,
            spacing_target,
            map_step_iterations,
            growth_iterations,
        })
    }

    fn to_resume(&self) -> ManifoldCurveResumeState {
        ManifoldCurveResumeState::Map {
            version: self.version,
            cycle_anchor: self.cycle_anchor.clone(),
            active_domain: self.active_domain.clone(),
            pending_points: self.pending_points.clone(),
            cursor: self.cursor.clone(),
            spacing_target: self.spacing_target,
            map_step_iterations: self.map_step_iterations,
            growth_iterations: self.growth_iterations,
        }
    }
}

fn build_map_manifold_extension(
    system: &EquationSystem,
    endpoint: &[f64],
    stability: ManifoldStability,
    settings: &Manifold1DSettings,
    periodicity: &StatePeriodicity,
    resume: ManifoldCurveResumeState,
) -> Result<ManifoldCurveSolve> {
    let mut state = ResumableMapManifoldState::from_resume(resume)?;
    let dim = endpoint.len();
    if state.cycle_anchor.len() != dim
        || state
            .active_domain
            .iter()
            .any(|point| point.len() != dim || point.iter().any(|value| !value.is_finite()))
    {
        bail!("Stored map manifold resume state has inconsistent dimensions.");
    }
    let target = settings.target_arclength;
    let max_points = settings.caps.max_points;
    let step_limit = settings
        .caps
        .max_iterations
        .unwrap_or(settings.caps.max_steps);
    let mut start = endpoint.to_vec();
    periodicity.wrap_state(&mut start);
    if let Some(bounds) = settings.bounds.as_ref() {
        if !inside_bounds(&start, bounds) {
            bail!("The map manifold extension endpoint lies outside configured bounds.");
        }
    }

    let mut points = vec![start.clone()];
    let mut arclength = vec![0.0];
    let mut cumulative = 0.0;
    let mut growth_steps = 0usize;
    let mut termination_reason = "max_iterations".to_string();
    let mut termination_detail = None;
    let mut target_reached = false;
    let mut preimage_failures = 0usize;

    loop {
        if let Some(mut cursor) = state.cursor.clone() {
            let pending = state
                .pending_points
                .as_ref()
                .unwrap_or(&state.active_domain)
                .clone();
            let mut current = points.last().cloned().unwrap_or_else(|| start.clone());
            while cursor.segment_index + 1 < pending.len() {
                let next_index = cursor.segment_index + 1;
                let candidate = &pending[next_index];
                if let Some(bounds) = settings.bounds.as_ref() {
                    if !inside_bounds(candidate, bounds) {
                        termination_reason = "bounds_exit".to_string();
                        termination_detail =
                            Some("pending fundamental domain left bounds".to_string());
                        state.cursor = Some(cursor);
                        return Ok(map_extension_solve(
                            points,
                            arclength,
                            target,
                            termination_reason,
                            termination_detail,
                            false,
                            growth_steps,
                            preimage_failures,
                            &state,
                        ));
                    }
                }
                let step_arc = periodic_l2_distance(&current, candidate, periodicity);
                if !step_arc.is_finite() {
                    bail!("Map manifold extension arclength became non-finite.");
                }
                if step_arc <= NORM_EPS {
                    current = candidate.clone();
                    cursor = ManifoldMapDomainCursor {
                        segment_index: next_index,
                        alpha: 0.0,
                    };
                    continue;
                }
                if cumulative + step_arc >= target && step_arc > NORM_EPS {
                    let fraction = ((target - cumulative) / step_arc).clamp(0.0, 1.0);
                    points.push(periodic_lerp(&current, candidate, fraction, periodicity));
                    arclength.push(target);
                    cursor.alpha = fraction;
                    state.cursor = Some(cursor);
                    termination_reason = "target_arclength".to_string();
                    target_reached = true;
                    return Ok(map_extension_solve(
                        points,
                        arclength,
                        target,
                        termination_reason,
                        None,
                        target_reached,
                        growth_steps,
                        preimage_failures,
                        &state,
                    ));
                }
                cumulative += step_arc;
                points.push(candidate.clone());
                arclength.push(cumulative);
                current = candidate.clone();
                cursor = ManifoldMapDomainCursor {
                    segment_index: next_index,
                    alpha: 0.0,
                };
                if points.len() >= max_points {
                    state.cursor = (next_index + 1 < pending.len()).then_some(cursor);
                    if state.cursor.is_none() {
                        state.pending_points = None;
                    }
                    termination_reason = "max_points".to_string();
                    return Ok(map_extension_solve(
                        points,
                        arclength,
                        target,
                        termination_reason,
                        None,
                        false,
                        growth_steps,
                        preimage_failures,
                        &state,
                    ));
                }
            }
            state.cursor = None;
            state.pending_points = None;
        }

        if growth_steps >= step_limit {
            break;
        }
        let current_endpoint = points.last().cloned().unwrap_or_else(|| start.clone());
        match grow_map_manifold_domain(
            system,
            &mut state.active_domain,
            &state.cycle_anchor,
            stability,
            state.map_step_iterations,
            state.spacing_target,
            max_points.saturating_sub(points.len()).max(2),
            settings.bounds.as_ref(),
            periodicity,
        )? {
            MapDomainGrowth::Accepted(mut next_domain) => {
                if let Some(first) = next_domain.first_mut() {
                    *first = current_endpoint;
                }
                state.active_domain = next_domain;
                state.cursor = Some(ManifoldMapDomainCursor {
                    segment_index: 0,
                    alpha: 0.0,
                });
                state.growth_iterations += 1;
                growth_steps += 1;
            }
            MapDomainGrowth::Stopped { reason, detail } => {
                if reason == "preimage_failed" {
                    preimage_failures += 1;
                }
                termination_reason = reason;
                termination_detail = detail;
                break;
            }
        }
    }

    Ok(map_extension_solve(
        points,
        arclength,
        target,
        termination_reason,
        termination_detail,
        target_reached,
        growth_steps,
        preimage_failures,
        &state,
    ))
}

enum MapDomainGrowth {
    Accepted(Vec<Vec<f64>>),
    Stopped {
        reason: String,
        detail: Option<String>,
    },
}

fn grow_map_manifold_domain(
    system: &EquationSystem,
    domain_samples: &mut Vec<Vec<f64>>,
    cycle_anchor: &[f64],
    stability: ManifoldStability,
    map_step_iterations: usize,
    spacing_target: f64,
    max_domain_samples: usize,
    bounds: Option<&ManifoldBounds>,
    periodicity: &StatePeriodicity,
) -> Result<MapDomainGrowth> {
    let mut next_samples = Vec::with_capacity(domain_samples.len());
    let mut previous_q: Option<Vec<f64>> = None;
    let mut previous_mapped: Option<Vec<f64>> = None;
    for (sample_index, q) in domain_samples.iter().enumerate() {
        let mapped = match stability {
            ManifoldStability::Unstable => {
                let Some(value) = apply_map_iterates_with_periodicity(
                    system,
                    q,
                    map_step_iterations,
                    periodicity,
                ) else {
                    return Ok(MapDomainGrowth::Stopped {
                        reason: "non_finite_image".to_string(),
                        detail: Some("map image was non-finite during extension".to_string()),
                    });
                };
                value
            }
            ManifoldStability::Stable => {
                let guess = if sample_index == 0 {
                    domain_samples.last().cloned().unwrap_or_else(|| q.clone())
                } else if let (Some(prev_q), Some(prev_mapped)) =
                    (previous_q.as_ref(), previous_mapped.as_ref())
                {
                    let offset = periodic_difference(prev_q, q, periodicity);
                    let mut guess = prev_mapped
                        .iter()
                        .zip(offset.iter())
                        .map(|(value, delta)| value + delta)
                        .collect::<Vec<_>>();
                    periodicity.wrap_state(&mut guess);
                    guess
                } else {
                    domain_samples.last().cloned().unwrap_or_else(|| q.clone())
                };
                let Some(value) = solve_map_preimage_newton(
                    system,
                    q,
                    &guess,
                    cycle_anchor,
                    cycle_anchor,
                    map_step_iterations,
                    periodicity,
                )?
                else {
                    return Ok(MapDomainGrowth::Stopped {
                        reason: "preimage_failed".to_string(),
                        detail: Some("map preimage solve failed during extension".to_string()),
                    });
                };
                value
            }
        };
        if mapped.iter().any(|value| !value.is_finite()) {
            return Ok(MapDomainGrowth::Stopped {
                reason: "non_finite_image".to_string(),
                detail: None,
            });
        }
        if let Some(bounds) = bounds {
            if !inside_bounds(&mapped, bounds) {
                return Ok(MapDomainGrowth::Stopped {
                    reason: "bounds_exit".to_string(),
                    detail: Some("mapped fundamental domain left bounds".to_string()),
                });
            }
        }
        previous_q = Some(q.clone());
        previous_mapped = Some(mapped.clone());
        next_samples.push(mapped);
    }
    let max_domain_samples = max_domain_samples.max(next_samples.len());
    refine_map_domain_samples(
        system,
        domain_samples,
        &mut next_samples,
        cycle_anchor,
        stability,
        map_step_iterations,
        spacing_target,
        max_domain_samples,
        bounds,
        periodicity,
    )?;
    Ok(MapDomainGrowth::Accepted(next_samples))
}

fn map_extension_solve(
    points: Vec<Vec<f64>>,
    arclength: Vec<f64>,
    requested_arclength: f64,
    termination_reason: String,
    termination_detail: Option<String>,
    target_reached: bool,
    map_growth_iterations: usize,
    preimage_failures: usize,
    state: &ResumableMapManifoldState,
) -> ManifoldCurveSolve {
    let achieved_arclength = *arclength.last().unwrap_or(&0.0);
    ManifoldCurveSolve {
        points,
        arclength,
        resume_state: Some(state.to_resume()),
        diagnostics: ManifoldCurveSolverDiagnostics {
            termination_reason,
            termination_detail,
            requested_arclength,
            achieved_arclength,
            target_reached,
            map_growth_iterations,
            preimage_failures,
            ..ManifoldCurveSolverDiagnostics::default()
        },
    }
}

fn replay_map_manifold_resume_state(
    system: &mut EquationSystem,
    kind: SystemKind,
    branch: &ContinuationBranch,
    settings: &Manifold1DSettings,
    periodicity: &StatePeriodicity,
) -> Result<ManifoldCurveResumeState> {
    let (stability, eig_index, stored_caps) = match &branch.branch_type {
        BranchType::ManifoldEq1D {
            stability,
            eig_index,
            caps,
            ..
        } => (*stability, *eig_index, *caps),
        _ => bail!("Legacy replay requires a 1D manifold branch."),
    };
    let anchor = branch
        .points
        .first()
        .map(|point| point.state.clone())
        .ok_or_else(|| anyhow!("Legacy manifold branch has no anchor."))?;
    let endpoint = branch
        .points
        .last()
        .map(|point| point.state.clone())
        .ok_or_else(|| anyhow!("Legacy manifold branch has no endpoint."))?;
    let old_arclength = branch
        .points
        .last()
        .map(|point| point.param_value)
        .unwrap_or(0.0);
    if !old_arclength.is_finite() || old_arclength <= 0.0 {
        bail!("Legacy manifold branch has invalid arclength metadata.");
    }

    let mut replay_settings = settings.clone();
    replay_settings.stability = stability;
    replay_settings.direction = ManifoldDirection::Both;
    replay_settings.eig_index = Some(eig_index);
    replay_settings.target_arclength = old_arclength;
    replay_settings.caps = stored_caps;
    replay_settings.caps.max_points = replay_settings
        .caps
        .max_points
        .max(branch.points.len().saturating_mul(2))
        .max(64);
    let previous_growth = match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Curve(geometry)) => geometry
            .solver_diagnostics
            .as_ref()
            .map(|diagnostics| diagnostics.map_growth_iterations)
            .unwrap_or(0),
        _ => 0,
    };
    replay_settings.caps.max_iterations = Some(
        replay_settings
            .caps
            .max_iterations
            .unwrap_or(replay_settings.caps.max_steps)
            .max(previous_growth.saturating_add(2)),
    );

    let replayed = continue_manifold_eq_1d_with_kind_and_periodicity(
        system,
        kind,
        &anchor,
        replay_settings,
        periodicity,
    )?;
    let reference_near = branch
        .points
        .get(1)
        .map(|point| point.state.as_slice())
        .unwrap_or(endpoint.as_slice());
    let mut candidates = replayed
        .into_iter()
        .filter(|candidate| {
            matches!(
                candidate.branch_type,
                BranchType::ManifoldEq1D {
                    cycle_point_index: Some(0),
                    ..
                }
            )
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let left_distance = left
            .points
            .get(1)
            .map(|point| periodic_l2_distance(&point.state, reference_near, periodicity))
            .unwrap_or(f64::INFINITY);
        let right_distance = right
            .points
            .get(1)
            .map(|point| periodic_l2_distance(&point.state, reference_near, periodicity))
            .unwrap_or(f64::INFINITY);
        left_distance.total_cmp(&right_distance)
    });
    let replay = candidates
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Legacy map manifold replay produced no matching direction."))?;
    let replay_endpoint = replay
        .points
        .last()
        .map(|point| point.state.as_slice())
        .ok_or_else(|| anyhow!("Legacy map manifold replay produced no endpoint."))?;
    let endpoint_error = periodic_l2_distance(replay_endpoint, &endpoint, periodicity);
    let endpoint_tolerance = 1e-4 * (1.0 + old_arclength + l2_norm(&endpoint));
    if endpoint_error > endpoint_tolerance {
        bail!(
            "Legacy map manifold replay did not reproduce the stored endpoint (error {}). Rebuild this branch before extending it.",
            endpoint_error
        );
    }
    match replay.manifold_geometry {
        Some(ManifoldGeometry::Curve(geometry)) => geometry.resume_state.ok_or_else(|| {
            anyhow!("Legacy map manifold replay did not produce resumable solver state.")
        }),
        _ => bail!("Legacy map manifold replay did not produce curve geometry."),
    }
}

fn build_map_manifold_curve(
    system: &EquationSystem,
    seed: &[f64],
    representative_point: &[f64],
    stability: ManifoldStability,
    map_step_iterations: usize,
    target_arclength: f64,
    caps: ManifoldTerminationCaps,
    bounds: Option<&ManifoldBounds>,
    periodicity: &StatePeriodicity,
    source_correction_norm: f64,
    least_period: Option<usize>,
) -> Result<ManifoldCurveSolve> {
    if representative_point.len() != seed.len() {
        bail!("Map manifold representative point dimension mismatch.");
    }
    if map_step_iterations == 0 {
        bail!("Map manifold step iterations must be greater than zero.");
    }

    let target = target_arclength;
    let max_points = caps.max_points;
    let step_limit = caps.max_iterations.unwrap_or(caps.max_steps);
    let domain_subdivisions = ((max_points as f64).sqrt().round() as usize).clamp(8, 32);

    let domain_end = match stability {
        ManifoldStability::Unstable => {
            apply_map_iterates_with_periodicity(system, seed, map_step_iterations, periodicity)
                .ok_or_else(|| anyhow!("Map manifold initial image is non-finite."))?
        }
        ManifoldStability::Stable => {
            let preimage = solve_map_preimage_newton(
                system,
                seed,
                representative_point,
                representative_point,
                representative_point,
                map_step_iterations,
                periodicity,
            )?;
            preimage.ok_or_else(|| {
                anyhow!("Stable map manifold could not construct its initial inverse domain.")
            })?
        }
    };
    if domain_end.iter().any(|value| !value.is_finite()) {
        bail!("Map manifold initial fundamental domain is non-finite.");
    }

    let mut domain_samples = Vec::with_capacity(domain_subdivisions + 1);
    for sub in 0..=domain_subdivisions {
        let alpha = (sub as f64) / (domain_subdivisions as f64);
        domain_samples.push(periodic_lerp(seed, &domain_end, alpha, periodicity));
    }
    let initial_domain_arc = polyline_arclength(&domain_samples, periodicity);
    let mut spacing_target = if target > 0.0 && max_points > 2 {
        // Reserve roughly half the output budget for domain overlaps, the
        // anchor/seed, and curvature-driven insertions. Using target/(N-1)
        // consumes the entire budget on ideal straight segments and can stop
        // short solely because fundamental domains share boundary points.
        target / ((max_points.saturating_sub(2) / 2).max(1) as f64)
    } else {
        initial_domain_arc / (domain_subdivisions as f64)
    };
    if !spacing_target.is_finite() || spacing_target <= NORM_EPS {
        spacing_target = (initial_domain_arc / (domain_subdivisions as f64)).max(1e-6);
    }
    spacing_target = spacing_target.max(1e-9);

    let mut anchor = representative_point.to_vec();
    periodicity.wrap_state(&mut anchor);
    let mut seed = seed.to_vec();
    periodicity.wrap_state(&mut seed);
    let mut points = vec![anchor.clone()];
    let mut arclength = vec![0.0];
    if let Some(box_bounds) = bounds {
        if !inside_bounds(&anchor, box_bounds) || !inside_bounds(&seed, box_bounds) {
            bail!("Map manifold source or local seed lies outside configured bounds.");
        }
    }
    let seed_arc = periodic_l2_distance(&anchor, &seed, periodicity);
    if target <= seed_arc && seed_arc > NORM_EPS {
        points.push(periodic_lerp(
            &anchor,
            &seed,
            target / seed_arc,
            periodicity,
        ));
        arclength.push(target);
        let mut pending_points = vec![anchor.clone(), seed.clone()];
        pending_points.extend(domain_samples.iter().skip(1).cloned());
        return Ok(map_curve_solve(
            points,
            arclength,
            target,
            "target_arclength",
            None,
            true,
            0,
            source_correction_norm,
            least_period,
            Some(map_resume_state(
                &anchor,
                domain_samples.clone(),
                Some(pending_points),
                Some(ManifoldMapDomainCursor {
                    segment_index: 0,
                    alpha: (target / seed_arc).clamp(0.0, 1.0),
                }),
                spacing_target,
                map_step_iterations,
                0,
            )),
        ));
    }
    points.push(seed);
    arclength.push(seed_arc);
    let mut cumulative_arc = seed_arc;
    let mut map_growth_steps = 0usize;
    let mut termination_reason = "max_iterations".to_string();
    let mut termination_detail = None;

    for (sample_index, sample) in domain_samples.iter().enumerate().skip(1) {
        if sample.iter().any(|value| !value.is_finite()) {
            bail!("Map manifold initial domain contains a non-finite sample.");
        }
        if let Some(box_bounds) = bounds {
            if !inside_bounds(sample, box_bounds) {
                termination_reason = "bounds_exit".to_string();
                termination_detail = Some("initial fundamental domain left bounds".to_string());
                return Ok(map_curve_solve(
                    points,
                    arclength,
                    target,
                    &termination_reason,
                    termination_detail,
                    false,
                    map_growth_steps,
                    source_correction_norm,
                    least_period,
                    Some(map_resume_state(
                        &anchor,
                        domain_samples.clone(),
                        None,
                        Some(ManifoldMapDomainCursor {
                            segment_index: sample_index - 1,
                            alpha: 0.0,
                        }),
                        spacing_target,
                        map_step_iterations,
                        map_growth_steps,
                    )),
                ));
            }
        }
        let last_point = points.last().cloned().unwrap_or_else(|| sample.clone());
        let step_arc = periodic_l2_distance(&last_point, sample, periodicity);
        if !step_arc.is_finite() {
            bail!("Map manifold arclength became non-finite.");
        }
        if target > 0.0 && cumulative_arc + step_arc >= target && step_arc > NORM_EPS {
            let alpha_hit = ((target - cumulative_arc) / step_arc).clamp(0.0, 1.0);
            points.push(periodic_lerp(&last_point, sample, alpha_hit, periodicity));
            arclength.push(target);
            return Ok(map_curve_solve(
                points,
                arclength,
                target,
                "target_arclength",
                None,
                true,
                map_growth_steps,
                source_correction_norm,
                least_period,
                Some(map_resume_state(
                    &anchor,
                    domain_samples.clone(),
                    None,
                    Some(ManifoldMapDomainCursor {
                        segment_index: sample_index - 1,
                        alpha: alpha_hit,
                    }),
                    spacing_target,
                    map_step_iterations,
                    map_growth_steps,
                )),
            ));
        }
        cumulative_arc += step_arc;
        points.push(sample.clone());
        arclength.push(cumulative_arc);
        if points.len() >= max_points || (target > 0.0 && cumulative_arc >= target) {
            return Ok(map_curve_solve(
                points,
                arclength,
                target,
                if cumulative_arc >= target {
                    "target_arclength"
                } else {
                    "max_points"
                },
                None,
                cumulative_arc >= target,
                map_growth_steps,
                source_correction_norm,
                least_period,
                Some(map_resume_state(
                    &anchor,
                    domain_samples.clone(),
                    None,
                    (sample_index + 1 < domain_samples.len()).then_some(ManifoldMapDomainCursor {
                        segment_index: sample_index,
                        alpha: 0.0,
                    }),
                    spacing_target,
                    map_step_iterations,
                    map_growth_steps,
                )),
            ));
        }
    }

    for _ in 1..step_limit {
        map_growth_steps += 1;
        if points.len() >= max_points || (target > 0.0 && cumulative_arc >= target) {
            break;
        }

        let mut next_samples = Vec::with_capacity(domain_samples.len());
        let mut previous_q: Option<Vec<f64>> = None;
        let mut previous_mapped: Option<Vec<f64>> = None;
        let mut failed = false;

        for (sample_index, q) in domain_samples.iter().enumerate() {
            let mapped = match stability {
                ManifoldStability::Unstable => {
                    let Some(value) = apply_map_iterates_with_periodicity(
                        system,
                        q,
                        map_step_iterations,
                        periodicity,
                    ) else {
                        failed = true;
                        termination_reason = "non_finite_image".to_string();
                        break;
                    };
                    value
                }
                ManifoldStability::Stable => {
                    let guess = if sample_index == 0 {
                        domain_samples.last().cloned().unwrap_or_else(|| q.clone())
                    } else if let (Some(prev_q), Some(prev_mapped)) =
                        (previous_q.as_ref(), previous_mapped.as_ref())
                    {
                        let offset = periodic_difference(prev_q, q, periodicity);
                        let mut guess = prev_mapped
                            .iter()
                            .zip(offset.iter())
                            .map(|(value, delta)| value + delta)
                            .collect::<Vec<_>>();
                        periodicity.wrap_state(&mut guess);
                        guess
                    } else {
                        domain_samples.last().cloned().unwrap_or_else(|| q.clone())
                    };
                    let preimage = solve_map_preimage_newton(
                        system,
                        q,
                        &guess,
                        representative_point,
                        representative_point,
                        map_step_iterations,
                        periodicity,
                    )?;
                    let Some(value) = preimage else {
                        failed = true;
                        termination_reason = "preimage_failed".to_string();
                        break;
                    };
                    value
                }
            };

            if mapped.iter().any(|value| !value.is_finite()) {
                failed = true;
                break;
            }
            if let Some(box_bounds) = bounds {
                if !inside_bounds(&mapped, box_bounds) {
                    failed = true;
                    termination_reason = "bounds_exit".to_string();
                    break;
                }
            }

            previous_q = Some(q.clone());
            previous_mapped = Some(mapped.clone());
            next_samples.push(mapped);
        }

        if failed || next_samples.len() != domain_samples.len() {
            termination_detail = Some(format!(
                "map growth stopped on fundamental-domain step {}",
                map_growth_steps
            ));
            break;
        }
        if let Some(last_point) = points.last() {
            if !next_samples.is_empty() {
                next_samples[0] = last_point.clone();
            }
        }

        let remaining_room = max_points.saturating_sub(points.len());
        if remaining_room > 1 {
            let base_add = next_samples.len().saturating_sub(1);
            let extra_capacity = remaining_room.saturating_sub(base_add);
            let max_domain_samples = next_samples
                .len()
                .saturating_add(extra_capacity.min(MAP_DOMAIN_MAX_INSERTIONS_PER_PASS * 2));
            refine_map_domain_samples(
                system,
                &mut domain_samples,
                &mut next_samples,
                representative_point,
                stability,
                map_step_iterations,
                spacing_target,
                max_domain_samples,
                bounds,
                periodicity,
            )?;
        }

        for (mapped_index, mapped) in next_samples.iter().enumerate().skip(1) {
            let last_point = points.last().cloned().unwrap_or_else(|| mapped.clone());
            let step_arc = periodic_l2_distance(&last_point, mapped, periodicity);
            if !step_arc.is_finite() {
                failed = true;
                break;
            }
            if target > 0.0 && cumulative_arc + step_arc >= target && step_arc > NORM_EPS {
                let alpha_hit = ((target - cumulative_arc) / step_arc).clamp(0.0, 1.0);
                points.push(periodic_lerp(&last_point, mapped, alpha_hit, periodicity));
                arclength.push(target);
                return Ok(map_curve_solve(
                    points,
                    arclength,
                    target,
                    "target_arclength",
                    None,
                    true,
                    map_growth_steps,
                    source_correction_norm,
                    least_period,
                    Some(map_resume_state(
                        &anchor,
                        next_samples.clone(),
                        None,
                        Some(ManifoldMapDomainCursor {
                            segment_index: mapped_index - 1,
                            alpha: alpha_hit,
                        }),
                        spacing_target,
                        map_step_iterations,
                        map_growth_steps,
                    )),
                ));
            }
            cumulative_arc += step_arc;
            points.push(mapped.clone());
            arclength.push(cumulative_arc);
            if points.len() >= max_points || (target > 0.0 && cumulative_arc >= target) {
                return Ok(map_curve_solve(
                    points,
                    arclength,
                    target,
                    if cumulative_arc >= target {
                        "target_arclength"
                    } else {
                        "max_points"
                    },
                    None,
                    cumulative_arc >= target,
                    map_growth_steps,
                    source_correction_norm,
                    least_period,
                    Some(map_resume_state(
                        &anchor,
                        next_samples.clone(),
                        None,
                        (mapped_index + 1 < next_samples.len()).then_some(
                            ManifoldMapDomainCursor {
                                segment_index: mapped_index,
                                alpha: 0.0,
                            },
                        ),
                        spacing_target,
                        map_step_iterations,
                        map_growth_steps,
                    )),
                ));
            }
        }
        if failed {
            break;
        }

        if target <= 0.0 && next_samples.len() >= 2 {
            let current_avg = polyline_arclength(&next_samples, periodicity)
                / ((next_samples.len().saturating_sub(1)) as f64);
            if current_avg.is_finite() && current_avg > 0.0 {
                spacing_target = spacing_target.max(0.5 * current_avg);
            }
        }

        domain_samples = next_samples;
    }

    if points.len() < 3 {
        bail!("Map manifold computation produced no meaningful growth.");
    }
    if points.len() >= max_points {
        termination_reason = "max_points".to_string();
    }
    Ok(map_curve_solve(
        points,
        arclength,
        target,
        &termination_reason,
        termination_detail,
        false,
        map_growth_steps,
        source_correction_norm,
        least_period,
        Some(map_resume_state(
            &anchor,
            domain_samples,
            None,
            None,
            spacing_target,
            map_step_iterations,
            map_growth_steps,
        )),
    ))
}

fn map_resume_state(
    cycle_anchor: &[f64],
    active_domain: Vec<Vec<f64>>,
    pending_points: Option<Vec<Vec<f64>>>,
    cursor: Option<ManifoldMapDomainCursor>,
    spacing_target: f64,
    map_step_iterations: usize,
    growth_iterations: usize,
) -> ManifoldCurveResumeState {
    ManifoldCurveResumeState::Map {
        version: 1,
        cycle_anchor: cycle_anchor.to_vec(),
        active_domain,
        pending_points,
        cursor,
        spacing_target,
        map_step_iterations,
        growth_iterations,
    }
}

fn map_curve_solve(
    points: Vec<Vec<f64>>,
    arclength: Vec<f64>,
    requested_arclength: f64,
    termination_reason: &str,
    termination_detail: Option<String>,
    target_reached: bool,
    map_growth_iterations: usize,
    source_correction_norm: f64,
    least_period: Option<usize>,
    resume_state: Option<ManifoldCurveResumeState>,
) -> ManifoldCurveSolve {
    let achieved_arclength = *arclength.last().unwrap_or(&0.0);
    ManifoldCurveSolve {
        points,
        arclength,
        resume_state,
        diagnostics: ManifoldCurveSolverDiagnostics {
            termination_reason: termination_reason.to_string(),
            termination_detail,
            requested_arclength,
            achieved_arclength,
            target_reached,
            map_growth_iterations,
            preimage_failures: usize::from(termination_reason == "preimage_failed"),
            source_correction_norm,
            least_period,
            ..ManifoldCurveSolverDiagnostics::default()
        },
    }
}

fn refine_map_domain_samples(
    system: &EquationSystem,
    domain_samples: &mut Vec<Vec<f64>>,
    mapped_samples: &mut Vec<Vec<f64>>,
    representative_point: &[f64],
    stability: ManifoldStability,
    map_step_iterations: usize,
    spacing_target: f64,
    max_domain_samples: usize,
    bounds: Option<&ManifoldBounds>,
    periodicity: &StatePeriodicity,
) -> Result<()> {
    if mapped_samples.len() < 2 || domain_samples.len() != mapped_samples.len() {
        return Ok(());
    }
    let delta_max = (MAP_DOMAIN_DELTA_MAX_FACTOR * spacing_target.max(1e-9)).max(1e-12);
    let delta_alpha_max = (delta_max * MAP_DOMAIN_ALPHA_MAX).max(1e-12);

    for _ in 0..MAP_DOMAIN_MAX_REFINEMENT_PASSES {
        if mapped_samples.len() >= max_domain_samples {
            break;
        }
        let mut insertion_indices = collect_map_refinement_intervals(
            mapped_samples,
            delta_max,
            MAP_DOMAIN_ALPHA_MAX,
            delta_alpha_max,
            periodicity,
        );
        if insertion_indices.is_empty() {
            break;
        }
        if insertion_indices.len() > MAP_DOMAIN_MAX_INSERTIONS_PER_PASS {
            insertion_indices.truncate(MAP_DOMAIN_MAX_INSERTIONS_PER_PASS);
        }
        let available = max_domain_samples.saturating_sub(mapped_samples.len());
        if available == 0 {
            break;
        }
        if insertion_indices.len() > available {
            insertion_indices.truncate(available);
        }
        if insertion_indices.is_empty() {
            break;
        }

        let mut offset = 0usize;
        let mut inserted = 0usize;
        let mut failed_required_insertions = 0usize;
        for idx in insertion_indices {
            let insert_at = idx + offset;
            if insert_at + 1 >= domain_samples.len() || insert_at + 1 >= mapped_samples.len() {
                continue;
            }
            let q_mid = periodic_lerp(
                &domain_samples[insert_at],
                &domain_samples[insert_at + 1],
                0.5,
                periodicity,
            );
            let mapped_mid = match stability {
                ManifoldStability::Unstable => {
                    let Some(value) = apply_map_iterates_with_periodicity(
                        system,
                        &q_mid,
                        map_step_iterations,
                        periodicity,
                    ) else {
                        failed_required_insertions += 1;
                        continue;
                    };
                    value
                }
                ManifoldStability::Stable => {
                    let guess = periodic_lerp(
                        &mapped_samples[insert_at],
                        &mapped_samples[insert_at + 1],
                        0.5,
                        periodicity,
                    );
                    let preimage = solve_map_preimage_newton(
                        system,
                        &q_mid,
                        &guess,
                        representative_point,
                        representative_point,
                        map_step_iterations,
                        periodicity,
                    )?;
                    let Some(value) = preimage else {
                        failed_required_insertions += 1;
                        continue;
                    };
                    value
                }
            };
            if mapped_mid.iter().any(|value| !value.is_finite()) {
                failed_required_insertions += 1;
                continue;
            }
            if let Some(box_bounds) = bounds {
                if !inside_bounds(&mapped_mid, box_bounds) {
                    failed_required_insertions += 1;
                    continue;
                }
            }
            domain_samples.insert(insert_at + 1, q_mid);
            mapped_samples.insert(insert_at + 1, mapped_mid);
            offset += 1;
            inserted += 1;
        }
        if failed_required_insertions > 0 {
            bail!(
                "Map manifold refinement failed to solve {} required midpoint sample(s).",
                failed_required_insertions
            );
        }
        if inserted == 0 {
            break;
        }
    }
    Ok(())
}

fn collect_map_refinement_intervals(
    mapped_samples: &[Vec<f64>],
    delta_max: f64,
    alpha_max: f64,
    delta_alpha_max: f64,
    periodicity: &StatePeriodicity,
) -> Vec<usize> {
    if mapped_samples.len() < 2 {
        return Vec::new();
    }
    let mut intervals = Vec::new();
    for i in 0..(mapped_samples.len() - 1) {
        let delta = periodic_l2_distance(&mapped_samples[i], &mapped_samples[i + 1], periodicity);
        if delta.is_finite() && delta > delta_max {
            intervals.push(i);
        }
    }
    if mapped_samples.len() >= 3 {
        for i in 1..(mapped_samples.len() - 1) {
            let delta_prev =
                periodic_l2_distance(&mapped_samples[i - 1], &mapped_samples[i], periodicity);
            let delta_next =
                periodic_l2_distance(&mapped_samples[i], &mapped_samples[i + 1], periodicity);
            if !delta_prev.is_finite() || !delta_next.is_finite() {
                continue;
            }
            if delta_prev <= NORM_EPS || delta_next <= NORM_EPS {
                continue;
            }
            let alpha = map_turn_angle(
                &mapped_samples[i - 1],
                &mapped_samples[i],
                &mapped_samples[i + 1],
                periodicity,
            );
            if !alpha.is_finite() {
                continue;
            }
            if alpha > alpha_max
                || delta_prev * alpha > delta_alpha_max
                || delta_next * alpha > delta_alpha_max
            {
                intervals.push(if delta_prev >= delta_next { i - 1 } else { i });
            }
        }
    }
    intervals.sort_unstable();
    intervals.dedup();
    intervals
}

fn map_turn_angle(
    prev: &[f64],
    current: &[f64],
    next: &[f64],
    periodicity: &StatePeriodicity,
) -> f64 {
    let v0 = periodic_difference(prev, current, periodicity);
    let v1 = periodic_difference(current, next, periodicity);
    let n0 = l2_norm(&v0);
    let n1 = l2_norm(&v1);
    if n0 <= NORM_EPS || n1 <= NORM_EPS {
        return 0.0;
    }
    let cos_theta = (dot(&v0, &v1) / (n0 * n1)).clamp(-1.0, 1.0);
    cos_theta.acos()
}

fn polyline_arclength(points: &[Vec<f64>], periodicity: &StatePeriodicity) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }
    points
        .windows(2)
        .map(|segment| periodic_l2_distance(&segment[0], &segment[1], periodicity))
        .sum()
}

fn cycle_component_arclength(reference_arclength: &[f64], point_count: usize) -> Vec<f64> {
    if point_count == 0 {
        return Vec::new();
    }
    if reference_arclength.is_empty() {
        return vec![0.0; point_count];
    }

    let take = reference_arclength.len().min(point_count);
    let mut arclength = reference_arclength[..take].to_vec();
    if arclength.len() < point_count {
        let last = *arclength.last().unwrap_or(&0.0);
        arclength.resize(point_count, last);
    }
    arclength
}

fn apply_map_iterates_with_periodicity(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
    periodicity: &StatePeriodicity,
) -> Option<Vec<f64>> {
    if iterations == 0 {
        let mut state = state.to_vec();
        periodicity.wrap_state(&mut state);
        return Some(state);
    }
    let mut current = state.to_vec();
    periodicity.wrap_state(&mut current);
    let mut mapped = vec![0.0; state.len()];
    for _ in 0..iterations {
        system.apply(0.0, &current, &mut mapped);
        if mapped.iter().any(|value| !value.is_finite()) {
            return None;
        }
        periodicity.wrap_state(&mut mapped);
        std::mem::swap(&mut current, &mut mapped);
    }
    Some(current)
}

fn propagate_curve_by_map_steps(
    system: &EquationSystem,
    base_points: &[Vec<f64>],
    steps: usize,
    bounds: Option<&ManifoldBounds>,
    periodicity: &StatePeriodicity,
) -> Option<Vec<Vec<f64>>> {
    if base_points.is_empty() {
        return Some(Vec::new());
    }
    if steps == 0 {
        return Some(base_points.to_vec());
    }
    let mut out = Vec::with_capacity(base_points.len());
    for point in base_points {
        let mapped = apply_map_iterates_with_periodicity(system, point, steps, periodicity)?;
        if let Some(box_bounds) = bounds {
            if !inside_bounds(&mapped, box_bounds) {
                break;
            }
        }
        out.push(mapped);
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn solve_map_preimage_newton(
    system: &EquationSystem,
    target: &[f64],
    initial_guess: &[f64],
    prev_cycle_point: &[f64],
    current_cycle_point: &[f64],
    map_iterations: usize,
    periodicity: &StatePeriodicity,
) -> Result<Option<Vec<f64>>> {
    if target.len() != initial_guess.len()
        || target.len() != prev_cycle_point.len()
        || target.len() != current_cycle_point.len()
    {
        bail!("Map preimage solve dimension mismatch.");
    }
    let dim = target.len();
    if dim == 0 {
        return Ok(Some(Vec::new()));
    }
    let map_iterations = map_iterations.max(1);

    let step_jacobian = compute_system_jacobian_with_periodicity(
        system,
        SystemKind::Map {
            iterations: map_iterations,
        },
        prev_cycle_point,
        periodicity,
    )?;
    let rhs = periodic_difference(current_cycle_point, target, periodicity);
    let mut linearized_guess =
        if let Some(offset) = solve_dense_linear_system(dim, &step_jacobian, &rhs) {
            prev_cycle_point
                .iter()
                .zip(offset.iter())
                .map(|(base, delta)| base + delta)
                .collect::<Vec<_>>()
        } else {
            prev_cycle_point.to_vec()
        };
    periodicity.wrap_state(&mut linearized_guess);
    let mut guess = if initial_guess.iter().all(|value| value.is_finite()) {
        initial_guess.to_vec()
    } else {
        linearized_guess.clone()
    };
    periodicity.wrap_state(&mut guess);

    let initial_residual =
        apply_map_iterates_with_periodicity(system, &guess, map_iterations, periodicity)
            .map(|value| l2_norm(&periodic_difference(target, &value, periodicity)))
            .unwrap_or(f64::INFINITY);
    let linearized_residual =
        apply_map_iterates_with_periodicity(system, &linearized_guess, map_iterations, periodicity)
            .map(|value| l2_norm(&periodic_difference(target, &value, periodicity)))
            .unwrap_or(f64::INFINITY);
    if linearized_residual < initial_residual {
        guess = linearized_guess;
    }

    let mut map_value = vec![0.0; dim];
    let tolerance = MAP_PREIMAGE_NEWTON_TOL * (1.0 + l2_norm(target));
    for _ in 0..MAP_PREIMAGE_NEWTON_MAX_ITERS {
        let Some(value) =
            apply_map_iterates_with_periodicity(system, &guess, map_iterations, periodicity)
        else {
            return Ok(None);
        };
        map_value = value;
        let residual = periodic_difference(target, &map_value, periodicity);
        let residual_norm = l2_norm(&residual);
        if residual_norm <= tolerance {
            return Ok(Some(guess));
        }

        let jacobian = compute_system_jacobian_with_periodicity(
            system,
            SystemKind::Map {
                iterations: map_iterations,
            },
            &guess,
            periodicity,
        )?;
        let Some(delta) = solve_dense_linear_system(dim, &jacobian, &residual) else {
            return Ok(None);
        };
        let mut step_scale = 1.0f64;
        let mut accepted = false;
        while step_scale >= 1e-4 {
            let candidate: Vec<f64> = guess
                .iter()
                .zip(delta.iter())
                .map(|(x, d)| x - step_scale * d)
                .collect();
            let mut candidate = candidate;
            if candidate.iter().any(|value| !value.is_finite()) {
                step_scale *= 0.5;
                continue;
            }
            periodicity.wrap_state(&mut candidate);
            let Some(value) = apply_map_iterates_with_periodicity(
                system,
                &candidate,
                map_iterations,
                periodicity,
            ) else {
                step_scale *= 0.5;
                continue;
            };
            map_value = value;
            let candidate_residual = l2_norm(&periodic_difference(target, &map_value, periodicity));
            if candidate_residual + 1e-14 < residual_norm {
                guess = candidate;
                accepted = true;
                break;
            }
            step_scale *= 0.5;
        }
        if !accepted {
            return Ok(None);
        }
    }

    let Some(value) =
        apply_map_iterates_with_periodicity(system, &guess, map_iterations, periodicity)
    else {
        return Ok(None);
    };
    map_value = value;
    let residual_norm = l2_norm(&periodic_difference(target, &map_value, periodicity));
    if residual_norm <= 1e-8 * (1.0 + l2_norm(target)) {
        Ok(Some(guess))
    } else {
        Ok(None)
    }
}

fn solve_dense_linear_system(dim: usize, matrix: &[f64], rhs: &[f64]) -> Option<Vec<f64>> {
    if dim == 0 {
        return Some(Vec::new());
    }
    if matrix.len() != dim * dim || rhs.len() != dim {
        return None;
    }
    let a = DMatrix::from_row_slice(dim, dim, matrix);
    let b = nalgebra::DVector::from_column_slice(rhs);
    a.lu()
        .solve(&b)
        .map(|solution| solution.iter().copied().collect())
}

fn rk4_step(system: &EquationSystem, state: &mut [f64], dt: f64, sigma: f64) {
    let dim = state.len();
    let mut k1 = vec![0.0; dim];
    let mut k2 = vec![0.0; dim];
    let mut k3 = vec![0.0; dim];
    let mut k4 = vec![0.0; dim];
    let mut tmp = vec![0.0; dim];

    system.apply(0.0, state, &mut k1);
    for i in 0..dim {
        k1[i] *= sigma;
        tmp[i] = state[i] + 0.5 * dt * k1[i];
    }

    system.apply(0.0, &tmp, &mut k2);
    for i in 0..dim {
        k2[i] *= sigma;
        tmp[i] = state[i] + 0.5 * dt * k2[i];
    }

    system.apply(0.0, &tmp, &mut k3);
    for i in 0..dim {
        k3[i] *= sigma;
        tmp[i] = state[i] + dt * k3[i];
    }

    system.apply(0.0, &tmp, &mut k4);
    for i in 0..dim {
        k4[i] *= sigma;
        state[i] += dt * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0;
    }
}

fn inside_bounds(point: &[f64], bounds: &ManifoldBounds) -> bool {
    if bounds.min.len() != point.len() || bounds.max.len() != point.len() {
        return true;
    }
    point
        .iter()
        .enumerate()
        .all(|(i, value)| *value >= bounds.min[i] && *value <= bounds.max[i])
}

fn flatten_points(points: &[Vec<f64>]) -> Vec<f64> {
    let mut out = Vec::new();
    for point in points {
        out.extend_from_slice(point);
    }
    out
}

fn l2_norm(v: &[f64]) -> f64 {
    v.iter().map(|value| value * value).sum::<f64>().sqrt()
}

fn l2_distance(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y) * (x - y))
        .sum::<f64>()
        .sqrt()
}

fn open_curve_arclength(curve: &[Vec<f64>]) -> f64 {
    curve
        .windows(2)
        .map(|pair| l2_distance(&pair[0], &pair[1]))
        .sum()
}

fn sample_open_curve_at_arclength(curve: &[Vec<f64>], target: f64) -> Vec<f64> {
    if curve.is_empty() {
        return Vec::new();
    }
    if curve.len() == 1 || target <= 0.0 {
        return curve[0].clone();
    }
    let mut remaining = target.max(0.0);
    for pair in curve.windows(2) {
        let segment = l2_distance(&pair[0], &pair[1]);
        if segment <= NORM_EPS {
            continue;
        }
        if remaining <= segment {
            return lerp(&pair[0], &pair[1], (remaining / segment).clamp(0.0, 1.0));
        }
        remaining -= segment;
    }
    curve.last().cloned().unwrap_or_default()
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn subtract(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b.iter()).map(|(x, y)| x - y).collect()
}

fn normalize(mut v: Vec<f64>) -> Result<Vec<f64>> {
    let norm = l2_norm(&v);
    if norm <= NORM_EPS {
        bail!("Cannot normalize near-zero vector.");
    }
    for value in &mut v {
        *value /= norm;
    }
    Ok(v)
}

fn orthonormalize_against(v: &[f64], basis: &[f64]) -> Result<Vec<f64>> {
    let projection = dot(v, basis);
    let mut out = v
        .iter()
        .zip(basis.iter())
        .map(|(value, base)| value - projection * base)
        .collect::<Vec<_>>();
    normalize(std::mem::take(&mut out))
}

fn canonical_orthogonal_unit(basis: &[f64]) -> Result<Vec<f64>> {
    if basis.is_empty() {
        bail!("Cannot build orthogonal direction from empty basis.");
    }
    let mut best: Option<(f64, Vec<f64>)> = None;
    for axis in 0..basis.len() {
        let mut candidate = vec![0.0; basis.len()];
        candidate[axis] = 1.0;
        let projection = dot(&candidate, basis);
        for i in 0..basis.len() {
            candidate[i] -= projection * basis[i];
        }
        let norm = l2_norm(&candidate);
        if norm <= NORM_EPS {
            continue;
        }
        match &best {
            Some((best_norm, _)) if *best_norm >= norm => {}
            _ => best = Some((norm, candidate)),
        }
    }
    let (_, candidate) = best.ok_or_else(|| anyhow!("Could not build orthogonal basis vector."))?;
    normalize(candidate)
}

fn orthonormalize_or_fallback(v: &[f64], basis: &[f64]) -> Result<Vec<f64>> {
    match orthonormalize_against(v, basis) {
        Ok(value) => Ok(value),
        Err(_) => canonical_orthogonal_unit(basis),
    }
}

fn lerp(a: &[f64], b: &[f64], alpha: f64) -> Vec<f64> {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| x + (y - x) * alpha)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::ManifoldTerminationCaps;
    use crate::equation_engine::{parse, Compiler};
    use nalgebra::DVector;
    use std::f64::consts::PI;

    fn build_system(equations: &[&str], vars: &[&str], params: &[(&str, f64)]) -> EquationSystem {
        let var_names: Vec<String> = vars.iter().map(|name| (*name).to_string()).collect();
        let param_names: Vec<String> = params.iter().map(|(name, _)| (*name).to_string()).collect();
        let param_values: Vec<f64> = params.iter().map(|(_, value)| *value).collect();
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for equation in equations {
            let expr = parse(equation).expect("parse");
            bytecodes.push(compiler.compile(&expr));
        }
        let mut system = EquationSystem::new(bytecodes, param_values);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    #[test]
    fn cycle_manifold_floquet_seed_preserves_a_stiff_contracting_direction() {
        let ntst = 20usize;
        let rotation = |angle: f64| {
            DMatrix::from_row_slice(2, 2, &[angle.cos(), -angle.sin(), angle.sin(), angle.cos()])
        };
        let local = DMatrix::from_diagonal(&DVector::from_vec(vec![
            (128.0 / ntst as f64).exp(),
            (-128.0 / ntst as f64).exp(),
        ]));
        let transfers = (0..ntst)
            .map(|interval| {
                let current = 2.0 * PI * interval as f64 / ntst as f64;
                let next = 2.0 * PI * (interval + 1) as f64 / ntst as f64;
                rotation(next) * &local * rotation(current).transpose()
            })
            .collect::<Vec<_>>();
        let target = Complex::new((-128.0f64).exp(), 0.0);
        let (multiplier, direction) = floquet_real_eigenvector_from_transfers(&transfers, target)
            .expect("robust manifold Floquet seed");
        assert!((multiplier.norm().ln() + 128.0).abs() < 2e-8);
        assert!(direction[0].abs() < 1e-8, "direction={direction:?}");
        assert!((direction[1].abs() - 1.0).abs() < 1e-8);
    }

    #[test]
    fn cycle_manifold_does_not_hide_a_collocation_floquet_failure() {
        let mut system = build_system(&["-x", "-2*y"], &["x", "y"], &[("a", 0.0)]);
        let profile = DecodedCycleProfile {
            mesh_points: vec![vec![1.0, 0.0]],
            points: vec![
                vec![1.0, 0.0],
                vec![0.0, 1.0],
                vec![-1.0, 0.0],
                vec![0.0, -1.0],
            ],
            phases: vec![0.0, 0.25, 0.5, 0.75],
            period: 1.0,
        };
        // This legacy one-point state is sufficient for the integration
        // fallback but is not a valid ntst=4, ncol=2 collocation profile.
        let error = build_cycle_floquet_seed(
            &mut system,
            &[1.0, 0.0, 1.0],
            &profile,
            4,
            2,
            Some(0),
            Complex::new((-1.0_f64).exp(), 0.0),
            8,
            0.01,
            200,
            1.0,
        )
        .expect_err("collocation failures must propagate when provenance is available");
        assert!(
            error
                .to_string()
                .contains("Collocation Floquet seed construction failed"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn cycle_manifold_rejects_a_stale_collocation_multiplier() {
        let ntst = 8usize;
        let ncol = 2usize;
        let mut system = build_system(&["-y", "x", "-0.2*z"], &["x", "y", "z"], &[("unused", 0.0)]);
        let cycle_state = circular_cycle_state(ntst, ncol, 1.0);
        let profile = decode_cycle_profile_points(&cycle_state, 3, ntst, ncol);
        let error = build_cycle_floquet_seed_from_collocation(
            &mut system,
            &cycle_state,
            &profile,
            ntst,
            ncol,
            0,
            Complex::new(-1.3, 0.0),
            16,
        )
        .expect_err("a stale multiplier must not select an unrelated Floquet bundle");
        assert!(
            error.to_string().contains("does not match"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn cycle_manifold_variational_fallback_rejects_a_non_eigenvalue() {
        let ntst = 8usize;
        let ncol = 2usize;
        let system = build_system(&["-y", "x", "-0.2*z"], &["x", "y", "z"], &[]);
        let cycle_state = circular_cycle_state(ntst, ncol, 1.0);
        let profile = decode_cycle_profile_points(&cycle_state, 3, ntst, ncol);
        let error = build_cycle_floquet_seed_variational(
            &system,
            &profile,
            Complex::new(-1.3, 0.0),
            16,
            0.01,
            2_000,
            std::f64::consts::TAU,
        )
        .expect_err("the fallback must verify the requested multiplier");
        assert!(
            error.to_string().contains("does not match"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn antiperiodic_floquet_resampling_uses_the_negative_closure_vector() {
        let ring = vec![
            vec![1.0, 0.0],
            vec![0.0, 1.0],
            vec![-1.0, 0.0],
            vec![0.0, -1.0],
        ];
        let half = std::f64::consts::FRAC_PI_4;
        let vectors = vec![
            vec![1.0, 0.0],
            vec![half.cos(), half.sin()],
            vec![0.0, 1.0],
            vec![-half.cos(), half.sin()],
        ];
        let (_, resampled) = resample_closed_ring_and_vectors_arclength(&ring, &vectors, 8, true);
        let last = resampled.last().expect("last resampled direction");
        assert!(
            last[0] < -0.8 && last[1] > 0.2,
            "antiperiodic closure interpolated toward +v(0): {last:?}"
        );
        assert!(
            resampled.iter().all(|direction| l2_norm(direction) > 0.99),
            "antiperiodic interpolation produced a degenerate direction"
        );
    }

    fn logistic_period_two_point(r: f64) -> f64 {
        (r + 1.0 - ((r - 3.0) * (r + 1.0)).sqrt()) / (2.0 * r)
    }

    fn extension_test_settings(
        stability: ManifoldStability,
        target_arclength: f64,
    ) -> Manifold1DSettings {
        Manifold1DSettings {
            stability,
            direction: ManifoldDirection::Plus,
            eig_index: Some(0),
            eps: 1e-3,
            target_arclength,
            integration_dt: 1e-3,
            caps: ManifoldTerminationCaps {
                max_steps: 20_000,
                max_points: 512,
                max_time: 20.0,
                max_iterations: Some(64),
                ..ManifoldTerminationCaps::default()
            },
            bounds: None,
        }
    }

    fn map_extension_test_settings(
        stability: ManifoldStability,
        target_arclength: f64,
    ) -> Manifold1DSettings {
        let mut settings = extension_test_settings(stability, target_arclength);
        settings.integration_dt = 1.0;
        settings.caps.max_points = 64;
        settings
    }

    fn assert_extension_matches_one_shot(
        extended: &ContinuationBranch,
        one_shot: &ContinuationBranch,
        tolerance: f64,
    ) {
        let extended_end = extended.points.last().expect("extended endpoint");
        let one_shot_end = one_shot.points.last().expect("one-shot endpoint");
        assert!(
            l2_distance(&extended_end.state, &one_shot_end.state) <= tolerance,
            "extended={:?}, one_shot={:?}",
            extended_end.state,
            one_shot_end.state
        );
        assert!(
            (extended_end.param_value - one_shot_end.param_value).abs() <= 1e-9,
            "extended s={}, one-shot s={}",
            extended_end.param_value,
            one_shot_end.param_value
        );
        assert!(extended
            .points
            .windows(2)
            .all(|pair| pair[1].param_value > pair[0].param_value));
    }

    #[test]
    fn manifold_eq_1d_extension_matches_one_shot_unstable_flow() {
        let mut system = build_system(&["x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Unstable, 0.04),
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            initial,
            extension_test_settings(ManifoldStability::Unstable, 0.06),
            &StatePeriodicity::none(),
        )
        .expect("flow extension");
        let one_shot = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Unstable, 0.10),
        )
        .unwrap()
        .remove(0);
        assert_extension_matches_one_shot(&extended, &one_shot, 2e-5);
    }

    #[test]
    fn manifold_eq_1d_extension_matches_one_shot_stable_flow() {
        let mut system = build_system(&["-x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Stable, 0.03),
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            initial,
            extension_test_settings(ManifoldStability::Stable, 0.05),
            &StatePeriodicity::none(),
        )
        .expect("stable flow extension");
        let one_shot = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Stable, 0.08),
        )
        .unwrap()
        .remove(0);
        assert_extension_matches_one_shot(&extended, &one_shot, 2e-5);
    }

    #[test]
    fn manifold_eq_1d_extension_rejects_a_different_eigen_index() {
        let mut system = build_system(&["x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Unstable, 0.04),
        )
        .unwrap()
        .remove(0);
        let mut settings = extension_test_settings(ManifoldStability::Unstable, 0.04);
        settings.eig_index = Some(1);
        let error = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            initial,
            settings,
            &StatePeriodicity::none(),
        )
        .expect_err("mismatched eigen index should be rejected");
        assert!(error.to_string().contains("eigen index"));
    }

    #[test]
    fn manifold_eq_1d_extension_rejects_map_branch_with_flow_kind() {
        let mut system = build_system(&["2*x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Unstable, 0.04),
        )
        .unwrap()
        .remove(0);
        let error = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            initial,
            extension_test_settings(ManifoldStability::Unstable, 0.04),
            &StatePeriodicity::none(),
        )
        .expect_err("map branch must not be integrated as a flow");
        assert!(error.to_string().contains("system kind"));
    }

    #[test]
    fn manifold_eq_1d_extension_matches_one_shot_negative_map_multiplier() {
        let mut system = build_system(&["-2*x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Unstable, 0.05),
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            initial,
            map_extension_test_settings(ManifoldStability::Unstable, 0.08),
            &StatePeriodicity::none(),
        )
        .expect("negative-multiplier map extension");
        let one_shot = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Unstable, 0.13),
        )
        .unwrap()
        .remove(0);
        assert_extension_matches_one_shot(&extended, &one_shot, 1e-9);
    }

    #[test]
    fn manifold_eq_1d_extension_matches_one_shot_stable_map() {
        let mut system = build_system(&["0.5*x"], &["x"], &[]);
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Stable, 0.04),
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            initial,
            map_extension_test_settings(ManifoldStability::Stable, 0.07),
            &StatePeriodicity::none(),
        )
        .expect("stable map extension");
        let one_shot = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Stable, 0.11),
        )
        .unwrap()
        .remove(0);
        assert_extension_matches_one_shot(&extended, &one_shot, 1e-9);
    }

    #[test]
    fn manifold_eq_1d_extension_matches_one_shot_map_cycle() {
        let r = 3.5;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let initial_branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            map_extension_test_settings(ManifoldStability::Unstable, 0.004),
        )
        .unwrap();
        let initial = initial_branches
            .into_iter()
            .find(|branch| {
                matches!(
                    branch.branch_type,
                    BranchType::ManifoldEq1D {
                        cycle_point_index: Some(0),
                        ..
                    }
                )
            })
            .unwrap();
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 2 },
            initial,
            map_extension_test_settings(ManifoldStability::Unstable, 0.004),
            &StatePeriodicity::none(),
        )
        .expect("map-cycle phase extension");
        let one_shot = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            map_extension_test_settings(ManifoldStability::Unstable, 0.008),
        )
        .unwrap()
        .into_iter()
        .find(|branch| {
            matches!(
                branch.branch_type,
                BranchType::ManifoldEq1D {
                    cycle_point_index: Some(0),
                    ..
                }
            )
        })
        .unwrap();
        assert_extension_matches_one_shot(&extended, &one_shot, 2e-7);
    }

    #[test]
    fn manifold_eq_1d_extension_advances_propagated_map_cycle_phase() {
        let r = 3.5;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let mut settings = map_extension_test_settings(ManifoldStability::Unstable, 0.04);
        settings.caps.max_points = 256;
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            settings,
        )
        .unwrap()
        .into_iter()
        .find(|branch| {
            matches!(
                branch.branch_type,
                BranchType::ManifoldEq1D {
                    cycle_point_index: Some(1),
                    ..
                }
            )
        })
        .unwrap();
        let old_count = initial.points.len();
        let old_arclength = initial.points.last().unwrap().param_value;
        let mut extension_settings = map_extension_test_settings(ManifoldStability::Unstable, 0.01);
        extension_settings.caps.max_points = 256;
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 2 },
            initial,
            extension_settings,
            &StatePeriodicity::none(),
        )
        .expect("propagated map-cycle phase extension");
        assert!(extended.points.len() > old_count);
        assert!(extended.points.last().unwrap().param_value > old_arclength);
        let Some(ManifoldGeometry::Curve(geometry)) = extended.manifold_geometry.as_ref() else {
            panic!("expected curve geometry");
        };
        assert!(matches!(
            geometry.resume_state,
            Some(ManifoldCurveResumeState::Map { .. })
        ));
        assert!(
            geometry.source_arclength.is_none(),
            "an independently extended cycle phase no longer has representative-source alignment"
        );
    }

    #[test]
    fn manifold_eq_1d_extension_replays_legacy_map_branch_without_resume_state() {
        let mut system = build_system(&["-2*x"], &["x"], &[]);
        let mut initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Unstable, 0.03),
        )
        .unwrap()
        .remove(0);
        let Some(ManifoldGeometry::Curve(geometry)) = initial.manifold_geometry.as_mut() else {
            panic!("expected curve geometry");
        };
        geometry.resume_state = None;
        let old_arclength = initial.points.last().unwrap().param_value;
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            initial,
            map_extension_test_settings(ManifoldStability::Unstable, 0.02),
            &StatePeriodicity::none(),
        )
        .expect("legacy map replay extension");
        assert!(extended.points.last().unwrap().param_value > old_arclength);
    }

    #[test]
    fn manifold_eq_1d_extension_preserves_periodic_flow_coordinates() {
        let periodicity = StatePeriodicity::from_periods(&[std::f64::consts::TAU], 1);
        let mut system = build_system(&["sin(theta)"], &["theta"], &[]);
        let initial = continue_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            &[0.0],
            extension_test_settings(ManifoldStability::Unstable, 0.1),
            &periodicity,
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            initial,
            extension_test_settings(ManifoldStability::Unstable, 0.1),
            &periodicity,
        )
        .expect("periodic flow extension");
        assert!(extended
            .points
            .iter()
            .all(|point| { point.state[0] >= 0.0 && point.state[0] < std::f64::consts::TAU }));
    }

    #[test]
    fn manifold_eq_1d_extension_preserves_periodic_map_coordinates() {
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);
        let mut system = build_system(&["2*theta"], &["theta"], &[]);
        let initial = continue_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            map_extension_test_settings(ManifoldStability::Unstable, 0.1),
            &periodicity,
        )
        .unwrap()
        .remove(0);
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            initial,
            map_extension_test_settings(ManifoldStability::Unstable, 0.1),
            &periodicity,
        )
        .expect("periodic map extension");
        assert!(extended
            .points
            .iter()
            .all(|point| point.state[0] >= 0.0 && point.state[0] < 1.0));
    }

    #[test]
    fn manifold_eq_1d_extension_advances_stable_map_cycle() {
        let r = 3.2;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let mut settings = map_extension_test_settings(ManifoldStability::Stable, 0.01);
        settings.caps.max_points = 256;
        let initial = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            settings,
        )
        .unwrap()
        .into_iter()
        .find(|branch| {
            matches!(
                branch.branch_type,
                BranchType::ManifoldEq1D {
                    cycle_point_index: Some(0),
                    ..
                }
            )
        })
        .unwrap();
        let old_count = initial.points.len();
        let mut extension_settings = map_extension_test_settings(ManifoldStability::Stable, 0.01);
        extension_settings.caps.max_points = 256;
        let extended = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 2 },
            initial,
            extension_settings,
            &StatePeriodicity::none(),
        )
        .expect("stable map-cycle extension");
        assert!(extended.points.len() > old_count);
    }

    fn circular_cycle_state(ntst: usize, ncol: usize, radius: f64) -> Vec<f64> {
        let mut state = Vec::new();
        let nodes = CollocationCoefficients::new(ncol)
            .expect("collocation nodes")
            .nodes;
        for i in 0..ntst {
            let theta = (i as f64) * std::f64::consts::TAU / (ntst as f64);
            state.push(radius * theta.cos());
            state.push(radius * theta.sin());
            state.push(0.0);
        }
        for interval in 0..ntst {
            for stage in 0..ncol {
                let theta =
                    (interval as f64 + nodes[stage]) * std::f64::consts::TAU / (ntst as f64);
                state.push(radius * theta.cos());
                state.push(radius * theta.sin());
                state.push(0.0);
            }
        }
        state.push(std::f64::consts::TAU);
        state
    }

    #[test]
    fn manifold_eq_1d_computes_both_directions() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Both,
                target_arclength: 0.5,
                eps: 1e-3,
                integration_dt: 1e-2,
                ..Manifold1DSettings::default()
            },
        )
        .expect("manifold");
        assert_eq!(branches.len(), 2);
        for branch in &branches {
            assert!(matches!(
                branch.branch_type,
                BranchType::ManifoldEq1D { .. }
            ));
            assert!(branch.points.len() >= 3);
            assert!(branch
                .manifold_geometry
                .as_ref()
                .is_some_and(|geom| matches!(geom, ManifoldGeometry::Curve(_))));
        }
    }

    #[test]
    fn manifold_eq_1d_default_like_settings_progress_beyond_seed() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength: 0.2,
                caps: ManifoldTerminationCaps {
                    max_points: 64,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("default-like manifold");
        assert_eq!(branches.len(), 1);
        assert!(
            branches[0].points.len() > 2,
            "expected solver to continue beyond seed with default-like settings"
        );
    }

    #[test]
    fn manifold_eq_1d_uses_newton_corrected_equilibrium_as_anchor() {
        let mut system = build_system(&["x-1", "-2*(y-2)"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[1.01, 2.01],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eig_index: Some(0),
                eps: 1e-3,
                target_arclength: 0.05,
                ..Manifold1DSettings::default()
            },
        )
        .expect("corrected-anchor manifold");

        let anchor = &branches[0].points[0].state;
        assert!(
            l2_distance(anchor, &[1.0, 2.0]) <= 1e-10,
            "anchor={anchor:?}"
        );
        assert!(branches[0]
            .points
            .iter()
            .all(|point| (point.state[1] - 2.0).abs() <= 1e-9));
    }

    #[test]
    fn manifold_eq_1d_wraps_periodic_flow_anchor_and_output() {
        let mut system = build_system(&["sin(theta)"], &["theta"], &[]);
        let periodicity = StatePeriodicity::from_periods(&[std::f64::consts::TAU], 1);
        let branches = continue_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Flow,
            &[std::f64::consts::TAU + 1e-3],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength: 0.2,
                ..Manifold1DSettings::default()
            },
            &periodicity,
        )
        .expect("periodic flow manifold");

        assert!(branches[0].points[0].state[0].abs() <= 1e-10);
        assert!(branches[0]
            .points
            .iter()
            .all(|point| { point.state[0] >= 0.0 && point.state[0] < std::f64::consts::TAU }));
    }

    #[test]
    fn manifold_eq_1d_wraps_periodic_map_anchor_and_output() {
        let mut system = build_system(&["2*theta"], &["theta"], &[]);
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);
        let branches = continue_manifold_eq_1d_with_kind_and_periodicity(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[1.001],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.2,
                caps: ManifoldTerminationCaps {
                    max_iterations: Some(16),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
            &periodicity,
        )
        .expect("periodic map manifold");

        assert!(branches[0].points[0].state[0].abs() <= 1e-10);
        assert!(branches[0]
            .points
            .iter()
            .all(|point| point.state[0] >= 0.0 && point.state[0] < 1.0));
    }

    #[test]
    fn manifold_eq_1d_records_dense_trajectory_samples() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength: 2.0,
                integration_dt: 1e-2,
                caps: ManifoldTerminationCaps {
                    max_time: 8.0,
                    max_points: 10_000,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("dense manifold");
        assert_eq!(branches.len(), 1);
        assert!(
            branches[0].points.len() > 200,
            "expected dense trajectory sampling between radius targets"
        );
    }

    #[test]
    fn manifold_eq_1d_stops_when_time_cap_is_reached_before_target_arclength() {
        let mut system = build_system(&["x*(1-x*x)", "-y"], &["x", "y"], &[]);
        let target_arclength = 5.0;
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength,
                integration_dt: 0.01,
                caps: ManifoldTerminationCaps {
                    max_time: 0.2,
                    max_points: 512,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("capped manifold");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        assert!(branch.points.len() > 2);
        let final_arclength = branch
            .points
            .last()
            .map(|point| point.param_value)
            .unwrap_or(0.0);
        assert!(
            final_arclength + 1e-9 < target_arclength,
            "trajectory should stop short of the requested arclength when max_time is too small"
        );
    }

    #[test]
    fn manifold_eq_1d_max_steps_caps_integration_work() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-3,
                target_arclength: 1.0,
                integration_dt: 1e-2,
                caps: ManifoldTerminationCaps {
                    max_steps: 3,
                    max_points: 100,
                    max_time: 100.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("step-capped manifold");
        let branch = &branches[0];
        assert!(branch.points.len() <= 5, "points={}", branch.points.len());
        let achieved = branch
            .points
            .last()
            .map(|point| point.param_value)
            .unwrap_or(0.0);
        assert!(
            achieved < 0.1,
            "max_steps did not cap integration: s={achieved}"
        );
        let ManifoldGeometry::Curve(geometry) = branch.manifold_geometry.as_ref().unwrap() else {
            panic!("expected curve geometry");
        };
        let diagnostics = geometry.solver_diagnostics.as_ref().unwrap();
        assert_eq!(diagnostics.termination_reason, "max_steps");
        assert_eq!(diagnostics.integration_steps, 3);
        assert!(!diagnostics.target_reached);
    }

    #[test]
    fn manifold_eq_1d_bounds_exit_keeps_valid_prefix() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-3,
                target_arclength: 1.0,
                integration_dt: 1e-3,
                caps: ManifoldTerminationCaps {
                    max_steps: 10_000,
                    max_points: 1_000,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                bounds: Some(ManifoldBounds {
                    min: vec![-1.0, -1.0],
                    max: vec![0.01, 1.0],
                }),
                ..Manifold1DSettings::default()
            },
        )
        .expect("bounded manifold");
        let branch = &branches[0];
        assert!(
            branch.points.len() > 3,
            "valid in-bounds prefix was discarded"
        );
        assert!(branch
            .points
            .iter()
            .all(|point| point.state[0] <= 0.01 + 1e-10));
        assert!(branch.points.last().unwrap().param_value > 0.0);
        let ManifoldGeometry::Curve(geometry) = branch.manifold_geometry.as_ref().unwrap() else {
            panic!("expected curve geometry");
        };
        assert_eq!(
            geometry
                .solver_diagnostics
                .as_ref()
                .unwrap()
                .termination_reason,
            "bounds_exit"
        );
    }

    #[test]
    fn manifold_eq_1d_lorenz_trajectory_has_no_large_jumps() {
        let mut system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength: 120.0,
                integration_dt: 5e-3,
                caps: ManifoldTerminationCaps {
                    max_time: 50.0,
                    max_points: 20_000,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("lorenz manifold");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        assert!(branch.points.len() > 120);
        let mut max_jump = 0.0_f64;
        for pair in branch.points.windows(2) {
            let jump = l2_distance(&pair[0].state, &pair[1].state);
            max_jump = max_jump.max(jump);
        }
        assert!(
            max_jump < 2.5,
            "unexpectedly large trajectory jump detected: {max_jump}"
        );
    }

    #[test]
    fn manifold_eq_1d_error_reports_one_based_eigen_index() {
        let mut system = build_system(&["-x", "y"], &["x", "y"], &[]);
        let error = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eig_index: Some(0),
                ..Manifold1DSettings::default()
            },
        )
        .expect_err("expected invalid eig index to fail");
        let text = format!("{error:#}");
        assert!(
            text.contains("Requested eigen index 1 is not an eligible real mode."),
            "unexpected error text: {text}"
        );
    }

    #[test]
    fn manifold_eq_1d_rejects_mode_inside_higher_dimensional_side() {
        let mut system = build_system(&["x", "2*y", "-z"], &["x", "y", "z"], &[]);
        let error = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eig_index: Some(0),
                target_arclength: 0.05,
                ..Manifold1DSettings::default()
            },
        )
        .expect_err("a two-dimensional unstable side is not a 1D manifold");
        assert!(format!("{error:#}").contains("dimension is 2"));
    }

    #[test]
    fn manifold_cycle_2d_error_reports_one_based_floquet_index() {
        let mut system = build_system(&["-x", "0*y", "-z"], &["x", "y", "z"], &[]);
        let cycle_state = vec![
            1.0, 0.0, 0.0, // mesh 0
            0.0, 1.0, 0.0, // mesh 1
            -1.0, 0.0, 0.0, // mesh 2
            1.0, 0.0, 0.0, // closing mesh 3
            1.0, // period
        ];
        let multipliers = [Complex::new(1.0, 0.0), Complex::new(1.4, 0.0)];
        let error = continue_limit_cycle_manifold_2d(
            &mut system,
            &cycle_state,
            3,
            1,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                floquet_index: Some(0),
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect_err("expected invalid floquet index to fail");
        let text = format!("{error:#}");
        assert!(
            text.contains("Requested Floquet index 1 is not eligible."),
            "unexpected error text: {text}"
        );
    }

    #[test]
    fn manifold_cycle_2d_floquet_stability_uses_multiplier_modulus() {
        let multipliers = [
            Complex::new(-1.4, 0.0),
            Complex::new(-0.6, 0.0),
            Complex::new(1.0, 0.0),
        ];
        let unstable = select_floquet_multiplier(&multipliers, ManifoldStability::Unstable, None)
            .expect("unstable multiplier should be found");
        let stable = select_floquet_multiplier(&multipliers, ManifoldStability::Stable, None)
            .expect("stable multiplier should be found");

        assert_eq!(unstable.0, 0, "expected |mu|>1 mode to be unstable");
        assert_eq!(stable.0, 1, "expected |mu|<1 mode to be stable");
    }

    #[test]
    fn manifold_cycle_2d_rejects_a_selected_side_with_more_than_one_transverse_mode() {
        let error = select_floquet_multiplier(
            &[
                Complex::new(2.0, 0.0),
                Complex::new(3.0, 0.0),
                Complex::new(1.0, 0.0),
            ],
            ManifoldStability::Unstable,
            Some(0),
        )
        .expect_err("two transverse modes define a three-dimensional cycle manifold");
        assert!(
            error.to_string().contains("dimension is 3"),
            "unexpected dimension error: {error:#}"
        );
    }

    #[test]
    fn manifold_eq_1d_directed_mode_returns_single_branch() {
        let mut system = build_system(&["x", "-y"], &["x", "y"], &[]);
        let branches = continue_manifold_eq_1d(
            &mut system,
            &[0.0, 0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                target_arclength: 0.3,
                ..Manifold1DSettings::default()
            },
        )
        .expect("directed manifold");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        let BranchType::ManifoldEq1D { direction, .. } = branch.branch_type else {
            panic!("expected 1D manifold branch type");
        };
        assert_eq!(direction, ManifoldDirection::Plus);
        let ManifoldGeometry::Curve(curve) = branch.manifold_geometry.clone().expect("geometry")
        else {
            panic!("expected curve geometry");
        };
        assert_eq!(curve.direction, ManifoldDirection::Plus);
    }

    #[test]
    fn manifold_eq_1d_map_fixed_point_records_map_metadata() {
        let mut system = build_system(&["2*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-3,
                target_arclength: 0.05,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 16,
                    max_points: 64,
                    max_time: 16.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("map manifold");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        assert!(branch.points.len() >= 2);
        let BranchType::ManifoldEq1D {
            map_iterations,
            cycle_point_index,
            ..
        } = &branch.branch_type
        else {
            panic!("expected 1D map manifold branch type");
        };
        assert_eq!(*map_iterations, Some(1));
        assert_eq!(*cycle_point_index, Some(0));
    }

    #[test]
    fn manifold_eq_1d_map_uses_corrected_fixed_point_as_anchor() {
        let mut system = build_system(&["1.5*x + 0.1"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.05,
                ..Manifold1DSettings::default()
            },
        )
        .expect("corrected map anchor");
        assert!((branches[0].points[0].state[0] + 0.2).abs() <= 1e-10);
    }

    #[test]
    fn manifold_eq_1d_map_stable_uses_inverse_preimage_steps() {
        let mut system = build_system(&["0.5*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Stable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.2,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 16,
                    max_points: 64,
                    max_time: 16.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("stable map manifold");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        assert!(
            branch.points.len() >= 3,
            "expected multiple inverse iterations for stable map manifold"
        );
        let first_abs = branch
            .points
            .first()
            .map(|point| point.state[0].abs())
            .unwrap_or(0.0);
        let last_abs = branch
            .points
            .last()
            .map(|point| point.state[0].abs())
            .unwrap_or(0.0);
        assert!(
            last_abs > first_abs + 1e-8,
            "expected inverse map stepping to move away from the cycle: first={first_abs}, last={last_abs}"
        );
    }

    #[test]
    fn manifold_eq_1d_map_stable_rejects_noninvertible_return_map() {
        let mut system = build_system(&["0*x"], &["x"], &[]);
        let error = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Stable,
                direction: ManifoldDirection::Plus,
                target_arclength: 0.1,
                ..Manifold1DSettings::default()
            },
        )
        .expect_err("noninvertible stable-map growth must not report success");
        assert!(format!("{error:#}").contains("invertible"));
    }

    #[test]
    fn manifold_eq_1d_map_cycle_fanout_emits_per_point_and_direction() {
        let r = 3.5;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Both,
                eps: 1e-4,
                target_arclength: 0.1,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 8,
                    max_points: 64,
                    max_time: 8.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("map cycle manifold");
        assert_eq!(branches.len(), 4);
        let mut seen_plus = [false; 2];
        let mut seen_minus = [false; 2];
        for branch in &branches {
            let BranchType::ManifoldEq1D {
                direction,
                map_iterations,
                cycle_point_index,
                ..
            } = &branch.branch_type
            else {
                panic!("expected 1D manifold branch type");
            };
            assert_eq!(*map_iterations, Some(2));
            let idx = cycle_point_index.expect("map manifold branch should include cycle index");
            assert!(idx < 2);
            match direction {
                ManifoldDirection::Plus => seen_plus[idx] = true,
                ManifoldDirection::Minus => seen_minus[idx] = true,
                ManifoldDirection::Both => panic!("unexpected Both direction for emitted branch"),
            }
        }
        for idx in 0..2 {
            assert!(seen_plus[idx], "missing plus branch for cycle point {idx}");
            assert!(
                seen_minus[idx],
                "missing minus branch for cycle point {idx}"
            );
        }
    }

    #[test]
    fn manifold_eq_1d_map_rejects_nonminimal_cycle_period() {
        let mut system = build_system(&["2*x"], &["x"], &[]);
        let error = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 3 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                ..Manifold1DSettings::default()
            },
        )
        .expect_err("fixed point must not be emitted as a 3-cycle");
        let text = format!("{error:#}");
        assert!(
            text.contains("least period is 1"),
            "unexpected error: {text}"
        );
    }

    #[test]
    fn manifold_eq_1d_map_cycle_branches_propagate_from_representative_curve() {
        let r = 3.5;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.25,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 32,
                    max_points: 512,
                    max_time: 1.0,
                    max_iterations: Some(6),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("map cycle manifold");
        assert_eq!(branches.len(), 2, "expected one branch per cycle point");
        let mut rep_branch: Option<&ContinuationBranch> = None;
        let mut propagated_branch: Option<&ContinuationBranch> = None;
        for branch in &branches {
            let BranchType::ManifoldEq1D {
                cycle_point_index, ..
            } = &branch.branch_type
            else {
                panic!("expected 1D manifold branch type");
            };
            match cycle_point_index {
                Some(0) => rep_branch = Some(branch),
                Some(1) => propagated_branch = Some(branch),
                _ => {}
            }
        }
        let rep_branch = rep_branch.expect("missing representative branch");
        let propagated_branch = propagated_branch.expect("missing propagated branch");
        assert!(
            rep_branch.points.len() > 8,
            "expected representative branch to contain enough points"
        );
        assert_eq!(
            rep_branch.points.len(),
            propagated_branch.points.len(),
            "propagated branch should preserve representative sampling"
        );

        for (rep_point, propagated_point) in rep_branch
            .points
            .iter()
            .zip(propagated_branch.points.iter())
        {
            let mut mapped = vec![0.0; rep_point.state.len()];
            system.apply(0.0, &rep_point.state, &mut mapped);
            assert!(
                l2_distance(&mapped, &propagated_point.state) <= 1e-10,
                "expected cycle phase branch to be one map iterate of representative branch"
            );
        }
        let ManifoldGeometry::Curve(rep_geometry) = rep_branch
            .manifold_geometry
            .as_ref()
            .expect("representative geometry")
        else {
            panic!("expected curve geometry");
        };
        let ManifoldGeometry::Curve(propagated_geometry) = propagated_branch
            .manifold_geometry
            .as_ref()
            .expect("propagated geometry")
        else {
            panic!("expected curve geometry");
        };
        assert_eq!(
            propagated_geometry.source_arclength.as_deref(),
            Some(rep_geometry.arclength.as_slice())
        );
        assert_ne!(
            propagated_geometry.arclength.last(),
            rep_geometry.arclength.last(),
            "non-isometric phase propagation should record physical arclength"
        );
    }

    #[test]
    fn manifold_eq_1d_map_cycle_stable_branches_record_source_and_physical_arclength() {
        let r = 3.2;
        let cycle_point = logistic_period_two_point(r);
        let mut system = build_system(&["r*x*(1-x)"], &["x"], &[("r", r)]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[cycle_point],
            Manifold1DSettings {
                stability: ManifoldStability::Stable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.25,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 32,
                    max_points: 512,
                    max_time: 1.0,
                    max_iterations: Some(6),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("stable map cycle manifold");
        assert_eq!(branches.len(), 2, "expected one branch per cycle point");
        let rep_branch = branches
            .iter()
            .find(|branch| {
                matches!(
                    &branch.branch_type,
                    BranchType::ManifoldEq1D {
                        cycle_point_index: Some(0),
                        ..
                    }
                )
            })
            .expect("missing representative branch");
        let propagated_branch = branches
            .iter()
            .find(|branch| {
                matches!(
                    &branch.branch_type,
                    BranchType::ManifoldEq1D {
                        cycle_point_index: Some(1),
                        ..
                    }
                )
            })
            .expect("missing propagated branch");
        assert_eq!(
            rep_branch.points.len(),
            propagated_branch.points.len(),
            "propagated stable branch should preserve representative sampling"
        );
        let ManifoldGeometry::Curve(rep_geometry) = rep_branch
            .manifold_geometry
            .as_ref()
            .expect("representative geometry")
        else {
            panic!("expected curve geometry");
        };
        let ManifoldGeometry::Curve(propagated_geometry) = propagated_branch
            .manifold_geometry
            .as_ref()
            .expect("propagated geometry")
        else {
            panic!("expected curve geometry");
        };
        assert_eq!(
            propagated_geometry.source_arclength.as_deref(),
            Some(rep_geometry.arclength.as_slice())
        );
        assert_eq!(
            propagated_geometry.arclength,
            cumulative_polyline_arclength(
                &propagated_branch
                    .points
                    .iter()
                    .map(|point| point.state.clone())
                    .collect::<Vec<_>>(),
                &StatePeriodicity::none()
            )
        );
    }

    #[test]
    fn manifold_eq_1d_map_stability_uses_multiplier_modulus() {
        let mut unstable_system = build_system(&["-1.4*x"], &["x"], &[]);
        let unstable = continue_manifold_eq_1d_with_kind(
            &mut unstable_system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.05,
                integration_dt: 1.0,
                ..Manifold1DSettings::default()
            },
        )
        .expect("modulus-unstable map manifold");
        assert_eq!(unstable.len(), 1);

        let mut stable_system = build_system(&["-0.6*x"], &["x"], &[]);
        let stable = continue_manifold_eq_1d_with_kind(
            &mut stable_system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Stable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 0.05,
                integration_dt: 1.0,
                ..Manifold1DSettings::default()
            },
        )
        .expect("modulus-stable map manifold");
        assert_eq!(stable.len(), 1);
    }

    #[test]
    fn manifold_eq_1d_map_negative_multiplier_preserves_directed_half_branch() {
        let mut system = build_system(&["-1.4*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-3,
                target_arclength: 0.05,
                caps: ManifoldTerminationCaps {
                    max_points: 200,
                    max_iterations: Some(8),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("negative-multiplier manifold");
        let nonzero: Vec<f64> = branches[0]
            .points
            .iter()
            .map(|point| point.state[0])
            .filter(|value| value.abs() > 1e-12)
            .collect();
        let sign = nonzero[0].signum();
        assert!(
            nonzero.iter().all(|value| value.signum() == sign),
            "directed half-branch crossed the fixed point: {nonzero:?}"
        );
    }

    #[test]
    fn manifold_eq_1d_map_uses_max_iterations_cap() {
        let mut system = build_system(&["2*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 10.0,
                integration_dt: 1e-6,
                caps: ManifoldTerminationCaps {
                    max_steps: 128,
                    max_points: 128,
                    max_time: 1e-12,
                    max_iterations: Some(2),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("map manifold with iteration cap");
        assert_eq!(branches.len(), 1);
        let branch = &branches[0];
        assert!(branch.points.len() > 3);
        let seed = branch
            .points
            .get(1)
            .map(|point| point.state[0])
            .unwrap_or(0.0);
        let terminal = branch
            .points
            .last()
            .map(|point| point.state[0])
            .unwrap_or(0.0);
        assert!(
            (terminal - 4.0 * seed).abs() <= 1e-10,
            "expected two map-domain growth steps when max_iterations=2: seed={seed}, terminal={terminal}"
        );
    }

    #[test]
    fn manifold_eq_1d_map_densifies_between_iterates() {
        let mut system = build_system(&["10*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                eps: 1e-3,
                target_arclength: 1.0,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 8,
                    max_points: 200,
                    max_time: 1.0,
                    max_iterations: Some(8),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("map manifold with densified samples");
        let branch = &branches[0];
        assert!(
            (branch.points.last().unwrap().param_value - 1.0).abs() <= 1e-9,
            "expected target attainment, got s={} with {} points",
            branch.points.last().unwrap().param_value,
            branch.points.len(),
        );
        let ManifoldGeometry::Curve(geometry) = branch.manifold_geometry.as_ref().unwrap() else {
            panic!("expected curve geometry");
        };
        let diagnostics = geometry.solver_diagnostics.as_ref().unwrap();
        assert_eq!(diagnostics.termination_reason, "target_arclength");
        assert!(diagnostics.target_reached);
    }

    #[test]
    fn map_turn_angle_is_zero_for_forward_collinear_points() {
        let angle = map_turn_angle(
            &[-1.0, 0.0],
            &[0.0, 0.0],
            &[1.0, 0.0],
            &StatePeriodicity::none(),
        );
        assert!(angle.abs() <= 1e-12, "straight-line turn angle={angle}");
    }

    #[test]
    fn manifold_eq_1d_map_stable_refines_far_field_spacing() {
        let mut system = build_system(&["0.4*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            Manifold1DSettings {
                stability: ManifoldStability::Stable,
                direction: ManifoldDirection::Plus,
                eps: 1e-4,
                target_arclength: 1.0,
                integration_dt: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 32,
                    max_points: 1_200,
                    max_time: 1.0,
                    max_iterations: Some(12),
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold1DSettings::default()
            },
        )
        .expect("stable map manifold with adaptive refinement");
        let branch = &branches[0];
        assert!(
            branch.points.len() > 100,
            "expected dense stable manifold sampling, got {} points",
            branch.points.len()
        );
        let max_jump = branch
            .points
            .windows(2)
            .map(|pair| l2_distance(&pair[0].state, &pair[1].state))
            .fold(0.0_f64, f64::max);
        assert!(
            max_jump < 0.02,
            "expected bounded far-field spacing from adaptive refinement, max jump={max_jump}"
        );
    }

    #[test]
    fn manifold_eq_2d_builds_surface_geometry() {
        let mut system = build_system(&["1.5*x", "0.8*y", "-z"], &["x", "y", "z"], &[]);
        let equilibrium = [0.0, 0.0, 0.0];
        let branch = continue_manifold_eq_2d(
            &mut system,
            &equilibrium,
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.02,
                leaf_delta: 0.03,
                ring_points: 24,
                target_radius: 0.5,
                target_arclength: 2.0,
                caps: ManifoldTerminationCaps {
                    max_rings: 8,
                    max_vertices: 512,
                    max_time: 1.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("surface manifold");
        assert!(matches!(
            branch.branch_type,
            BranchType::ManifoldEq2D { .. }
        ));
        let geometry = branch.manifold_geometry.expect("geometry");
        let ManifoldGeometry::Surface(surface) = geometry else {
            panic!("expected surface geometry");
        };
        assert_eq!(surface.dim, 3);
        assert!(!surface.vertices_flat.is_empty());
        assert!(!surface.triangles.is_empty());
        assert_eq!(surface.vertices_flat.len() % 3, 0);
        let first_vertex = &surface.vertices_flat[0..3];
        assert!(
            l2_distance(first_vertex, &equilibrium) < 1e-12,
            "expected equilibrium center as first surface vertex, got {first_vertex:?}"
        );
        assert_eq!(surface.ring_offsets.first().copied(), Some(1));
        if let (Some(first), Some(last)) = (
            surface.ring_diagnostics.first(),
            surface.ring_diagnostics.last(),
        ) {
            let max_radius = surface
                .ring_diagnostics
                .iter()
                .map(|ring| ring.radius_estimate)
                .fold(0.0_f64, f64::max);
            assert!(
                last.radius_estimate >= first.radius_estimate - 1e-9
                    || max_radius >= first.radius_estimate + 1e-6,
                "expected nontrivial outward growth in ring diagnostics"
            );
        }
    }

    #[test]
    fn manifold_eq_2d_uses_newton_corrected_equilibrium_as_center() {
        let mut system = build_system(&["x-1", "2*(y+2)", "-z"], &["x", "y", "z"], &[]);
        let corrected = [1.0, -2.0, 0.0];
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[1.1, -2.1, 0.1],
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.01,
                leaf_delta: 0.01,
                ring_points: 12,
                target_radius: 0.0,
                target_arclength: 0.0,
                caps: ManifoldTerminationCaps {
                    max_rings: 1,
                    max_vertices: 128,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("corrected equilibrium surface");

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        assert!(
            l2_distance(&surface.vertices_flat[..3], &corrected) <= 1e-10,
            "surface center should use the Newton-corrected equilibrium, got {:?}",
            &surface.vertices_flat[..3]
        );
    }

    #[test]
    fn manifold_eq_2d_lorenz_stable_builds_centered_surface_with_multiple_rings() {
        let mut system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Stable,
                initial_radius: 1e-3,
                leaf_delta: 0.002,
                ring_points: 48,
                integration_dt: 1e-2,
                target_radius: 0.05,
                target_arclength: 0.1,
                caps: ManifoldTerminationCaps {
                    max_rings: 8,
                    max_vertices: 1_200,
                    max_time: 1.5,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("lorenz stable manifold");

        let BranchType::ManifoldEq2D { stability, .. } = branch.branch_type else {
            panic!("expected 2D manifold branch type");
        };
        assert_eq!(stability, ManifoldStability::Stable);

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diag = surface
            .solver_diagnostics
            .as_ref()
            .map(|d| (d.termination_reason.clone(), d.termination_detail.clone()));
        assert_eq!(surface.dim, 3);
        assert!(!surface.triangles.is_empty());
        assert_eq!(surface.ring_offsets.first().copied(), Some(1));
        assert!(
            surface.ring_offsets.len() >= 2,
            "expected at least initial + one grown ring, got {} rings and {} vertices, diagnostics={diag:?}",
            surface.ring_offsets.len(),
            surface.vertices_flat.len() / 3
        );
        let max_radius = surface
            .vertices_flat
            .chunks(3)
            .map(|point| l2_norm(point))
            .fold(0.0_f64, f64::max);
        assert!(
            max_radius > 0.002,
            "surface did not grow away from equilibrium (max radius {max_radius}, ring count {}, vertex count {})",
            surface.ring_offsets.len(),
            surface.vertices_flat.len() / 3
        );
    }

    #[test]
    fn manifold_eq_2d_requested_complex_indices_use_complex_pair_basis() {
        let system = build_system(
            &["-y-z", "x+a*y", "b+z*(x-c)"],
            &["x", "y", "z"],
            &[("a", 0.2), ("b", 0.2), ("c", 5.7)],
        );

        let a = 0.2_f64;
        let b = 0.2_f64;
        let c = 5.7_f64;
        let disc = (c * c - 4.0 * a * b).sqrt();
        let z = (c - disc) / (2.0 * a);
        let equilibrium = [a * z, -z, z];

        let solved = solve_equilibrium(
            &system,
            SystemKind::Flow,
            &equilibrium,
            NewtonSettings {
                max_steps: 8,
                damping: 1.0,
                tolerance: 1e-10,
            },
        )
        .expect("equilibrium");

        let mut complex_unstable_indices = Vec::new();
        for (idx, pair) in solved.eigenpairs.iter().enumerate() {
            if pair.value.re > 0.0 && pair.value.im.abs() > EIG_IM_TOL {
                complex_unstable_indices.push(idx);
            }
        }
        assert!(
            complex_unstable_indices.len() >= 2,
            "expected unstable complex-conjugate pair, got indices={complex_unstable_indices:?}"
        );
        let requested = [complex_unstable_indices[0], complex_unstable_indices[1]];

        let basis = select_2d_equilibrium_basis(
            &system,
            &equilibrium,
            ManifoldStability::Unstable,
            Some(requested),
        )
        .expect("requested basis");

        assert_eq!(
            basis.kind,
            ManifoldEigenKind::ComplexPair,
            "requested conjugate pair should initialize as ComplexPair"
        );
        assert!(
            (l2_norm(&basis.e1) - 1.0).abs() < 1e-10,
            "e1 should be unit norm"
        );
        assert!(
            (l2_norm(&basis.e2) - 1.0).abs() < 1e-10,
            "e2 should be unit norm"
        );
        assert!(
            dot(&basis.e1, &basis.e2).abs() < 1e-8,
            "e1/e2 should be near-orthogonal"
        );
    }

    #[test]
    fn manifold_eq_2d_rejects_a_selected_side_with_dimension_greater_than_two() {
        let mut system = build_system(&["x", "2*y", "3*z", "-w"], &["x", "y", "z", "w"], &[]);
        let error = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                ..Manifold2DSettings::default()
            },
        )
        .expect_err("an arbitrary pair is not the full three-dimensional unstable manifold");
        assert!(
            error.to_string().contains("dimension is 3"),
            "unexpected dimensionality error: {error:#}"
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_solve_finds_first_ring_hit_for_lorenz_stable_origin() {
        let system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let equilibrium = [0.0, 0.0, 0.0];
        let basis =
            select_2d_equilibrium_basis(&system, &equilibrium, ManifoldStability::Stable, None)
                .expect("basis");
        let ring = build_equilibrium_initial_ring(&equilibrium, &basis.e1, &basis.e2, 1e-3, 48);
        let leaf_delta = 0.002;
        let point = (0..ring.len()).find_map(|i| {
            let s = (i as f64) / (ring.len() as f64);
            let base = &ring[i];
            let tangent = ring_tangent_uniform(&ring, s);
            let outward = outward_from_in_anchor(base, &equilibrium, &tangent).ok()?;
            shoot_leaf_point(
                &system,
                &ring,
                base,
                s,
                &tangent,
                &outward,
                leaf_delta,
                -1.0,
                0.01,
                150,
                1.0,
                Some(&equilibrium),
            )
            .ok()
            .map(|hit| (base.clone(), outward, hit))
        });
        assert!(
            point.is_some(),
            "expected a valid leaf intersection for Lorenz stable manifold"
        );
        let (base, outward, hit) = point.expect("leaf hit");
        let offset = subtract(&hit.point, &base);
        let distance = l2_norm(&offset);
        assert!(
            (distance - leaf_delta).abs() <= leaf_delta * 1e-2,
            "leaf hit should control Euclidean distance: got {distance}, target {leaf_delta}"
        );
        assert!(
            signed_distance_with_direction(&outward, &offset) >= -1e-9,
            "leaf hit should remain in the outward half-leaf"
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_solve_success_ratio_for_lorenz_stable_origin() {
        let system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let equilibrium = [0.0, 0.0, 0.0];
        let basis =
            select_2d_equilibrium_basis(&system, &equilibrium, ManifoldStability::Stable, None)
                .expect("basis");
        let ring = build_equilibrium_initial_ring(&equilibrium, &basis.e1, &basis.e2, 1e-3, 48);
        let mut success = 0usize;
        for i in 0..ring.len() {
            let s = (i as f64) / (ring.len() as f64);
            let base = &ring[i];
            let tangent = ring_tangent_uniform(&ring, s);
            let outward = outward_from_in_anchor(base, &equilibrium, &tangent).expect("outward");
            let point = shoot_leaf_point(
                &system,
                &ring,
                base,
                s,
                &tangent,
                &outward,
                0.002,
                -1.0,
                0.01,
                150,
                1.0,
                Some(&equilibrium),
            );
            if point.is_ok() {
                success += 1;
            }
        }
        assert!(
            success >= 40,
            "expected most Lorenz leaves to solve, but only {success}/{} succeeded",
            ring.len()
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_never_accepts_an_off_plane_fallback() {
        let system = build_system(&["1", "1", "0"], &["x", "y", "z"], &[]);
        let samples = 64usize;
        let ring = (0..samples)
            .map(|index| {
                let theta = std::f64::consts::TAU * (index as f64) / (samples as f64);
                vec![theta.cos(), theta.sin(), 0.0]
            })
            .collect::<Vec<_>>();
        let base = ring[0].clone();
        let tangent = ring_tangent_neighbor_average(&ring, 0);
        let outward = vec![1.0, 0.0, 0.0];

        let failure = match shoot_leaf_point(
            &system, &ring, &base, 0.0, &tangent, &outward, 0.8, 1.0, 0.01, 2_000, 2.0, None,
        ) {
            Ok(_) => panic!("the local plane-intersection branch ends before distance 0.8"),
            Err(failure) => failure,
        };

        assert!(
            matches!(
                failure.kind,
                LeafFailureKind::PlaneSolveNoConvergence | LeafFailureKind::NoFirstHitWithinMaxTime
            ),
            "unexpected leaf failure: {:?}",
            failure.kind
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_can_shrink_locally_near_finite_arclength() {
        let system = build_system(&["1", "1", "0"], &["x", "y", "z"], &[]);
        let samples = 64usize;
        let ring = (0..samples)
            .map(|index| {
                let theta = std::f64::consts::TAU * (index as f64) / (samples as f64);
                vec![theta.cos(), theta.sin(), 0.0]
            })
            .collect::<Vec<_>>();
        let base = ring[0].clone();
        let tangent = ring_tangent_neighbor_average(&ring, 0);
        let (hit, achieved_delta) = solve_leaf_point_with_local_floor(
            &system,
            &ring,
            &base,
            0.0,
            &tangent,
            &[1.0, 0.0, 0.0],
            0.8,
            0.2,
            1.0,
            0.01,
            2_000,
            2.0,
            None,
        )
        .expect("a smaller local leaf step should remain available");
        assert!(achieved_delta < 0.8 && achieved_delta >= 0.2);
        assert!(
            (l2_distance(&hit.point, &base) - achieved_delta).abs() <= 1e-8,
            "locally reduced leaf must still satisfy its exact distance event"
        );
        let normal = leaf_plane_normal(&tangent).expect("leaf normal");
        assert!(
            dot(&normal, &subtract(&hit.point, &base)).abs() <= 1e-8,
            "locally reduced leaf must remain in its exact plane"
        );
    }

    #[test]
    fn manifold_eq_2d_plane_root_polygon_switches_forward_from_unbracketed_seed_segment() {
        let system = build_system(&["0", "-1", "0"], &["x", "y", "z"], &[]);
        let ring = vec![
            vec![1.0, 0.0, 0.0],  // r0
            vec![0.0, 1.0, 0.0],  // r1
            vec![-1.0, 0.0, 0.0], // r2
            vec![0.0, -1.0, 0.0], // r3
        ];
        let base_point = &ring[0];
        let plane_normal = vec![0.0, 1.0, 0.0];
        let plane_tol = 1e-12;

        let (seg, tau, start, end) = solve_plane_root_polygon(
            &system,
            &ring,
            base_point,
            &plane_normal,
            0.5,
            0,
            0.0,
            1.0,
            1e-2,
            8,
            10.0,
            plane_tol,
        )
        .expect("plane root should switch to neighboring segment");

        assert_eq!(seg, 1, "expected forward segment switch to segment 1");
        assert!((tau - 0.5).abs() < 1e-12, "expected tau=0.5, got {tau}");
        assert!(tau >= 0.0 && tau <= 1.0, "tau must remain in [0,1]");
        assert!(l2_distance(&start, &[0.5, 0.5, 0.0]) < 1e-12);

        let curr = &ring[seg];
        let prev = &ring[(seg + ring.len() - 1) % ring.len()];
        let combo = lerp(curr, prev, tau);
        assert!(
            l2_distance(&start, &combo) < 1e-12,
            "startpoint must be on segment convex combination"
        );
        let residual = dot(&plane_normal, &subtract(&end, base_point));
        assert!(
            residual.abs() <= plane_tol,
            "plane residual should satisfy tolerance, got {residual}"
        );
    }

    #[test]
    fn manifold_eq_2d_plane_root_polygon_switch_cap_falls_back_to_segment_scan() {
        let system = build_system(&["0", "-1", "0"], &["x", "y", "z"], &[]);
        let ring = vec![
            vec![1.0, 0.0, 0.0],  // r0
            vec![0.0, 1.0, 0.0],  // r1
            vec![-1.0, 0.0, 0.0], // r2
            vec![0.0, -1.0, 0.0], // r3
        ];
        let base_point = &ring[0];
        let plane_normal = vec![0.0, 1.0, 0.0];
        let plane_tol = 1e-12;

        let (seg, tau, _start, end) = solve_plane_root_polygon_with_switch_cap(
            &system,
            &ring,
            base_point,
            &plane_normal,
            0.5,
            0,
            0.0,
            1.0,
            1e-2,
            8,
            10.0,
            plane_tol,
            Some(1),
        )
        .expect("switch-cap fallback should recover root via segment scan");
        assert_eq!(
            seg, 1,
            "expected scan fallback to find forward segment root"
        );
        assert!((tau - 0.5).abs() < 1e-12, "expected tau=0.5, got {tau}");
        let residual = dot(&plane_normal, &subtract(&end, base_point));
        assert!(
            residual.abs() <= plane_tol,
            "plane residual should satisfy tolerance, got {residual}"
        );
    }

    #[test]
    fn manifold_eq_2d_plane_root_polygon_reports_failure_without_relaxed_projection() {
        let system = build_system(&["0", "0", "0"], &["x", "y", "z"], &[]);
        let ring = vec![
            vec![1.0, 0.0, 0.0],  // r0
            vec![0.0, 1.0, 0.0],  // r1
            vec![-1.0, 0.0, 0.0], // r2
            vec![0.0, -1.0, 0.0], // r3
        ];
        let base_point = vec![10.0, 0.0, 0.0];
        let plane_normal = vec![1.0, 0.0, 0.0];
        let plane_tol = 1e-12;

        let failure = solve_plane_root_polygon_with_switch_cap(
            &system,
            &ring,
            &base_point,
            &plane_normal,
            0.5,
            0,
            0.0,
            1.0,
            1e-2,
            8,
            10.0,
            plane_tol,
            Some(1),
        )
        .expect_err("strict plane solver should not accept an unscanned far segment");
        assert_eq!(failure, LeafFailureKind::PlaneSolveNoConvergence);
    }

    #[test]
    fn manifold_eq_2d_plane_root_polygon_switches_backward_and_avoids_extrapolated_startpoints() {
        let system = build_system(&["1", "0", "0"], &["x", "y", "z"], &[]);
        let ring = vec![
            vec![1.0, 0.0, 0.0],  // r0
            vec![0.0, 1.0, 0.0],  // r1
            vec![-1.0, 0.0, 0.0], // r2
            vec![0.0, -1.0, 0.0], // r3
        ];
        let base_point = &ring[0];
        let plane_normal = vec![1.0, 0.0, 0.0];
        let plane_tol = 1e-12;

        let (seg, tau, start, end) = solve_plane_root_polygon(
            &system,
            &ring,
            base_point,
            &plane_normal,
            1.5,
            0,
            0.0,
            1.0,
            1e-2,
            8,
            10.0,
            plane_tol,
        )
        .expect("plane root should switch to neighboring segment without extrapolation");

        assert_eq!(seg, 3, "expected backward segment switch to segment 3");
        assert!((tau - 0.5).abs() < 1e-12, "expected tau=0.5, got {tau}");
        assert!(tau >= 0.0 && tau <= 1.0, "tau must remain in [0,1]");
        assert!(l2_distance(&start, &[-0.5, -0.5, 0.0]) < 1e-12);

        let curr = &ring[seg];
        let prev = &ring[(seg + ring.len() - 1) % ring.len()];
        let combo = lerp(curr, prev, tau);
        assert!(
            l2_distance(&start, &combo) < 1e-12,
            "startpoint must be on segment convex combination"
        );
        let residual = dot(&plane_normal, &subtract(&end, base_point));
        assert!(
            residual.abs() <= plane_tol,
            "plane residual should satisfy tolerance, got {residual}"
        );
    }

    #[test]
    fn manifold_eq_2d_records_base_anchors_for_geodesic_quality() {
        let system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let equilibrium = [0.0, 0.0, 0.0];
        let basis =
            select_2d_equilibrium_basis(&system, &equilibrium, ManifoldStability::Stable, None)
                .expect("basis");
        let ring = build_equilibrium_initial_ring(&equilibrium, &basis.e1, &basis.e2, 1e-3, 48);
        let prev_in_anchors = vec![equilibrium.to_vec(); ring.len()];
        let solve = build_next_ring(
            &system,
            &ring,
            &prev_in_anchors,
            -1.0,
            0.00075,
            0.00075,
            0.01,
            150,
            2.0,
        )
        .expect("next ring");
        assert_eq!(solve.points.len(), solve.base_anchors.len());
        let valid_range = solve
            .base_anchors
            .iter()
            .all(|s| s.is_finite() && *s >= 0.0 && *s < 1.0);
        assert!(
            valid_range,
            "expected base anchors to remain valid unit-interval parameters"
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_records_the_solved_source_anchor_after_phase_shear() {
        let system = build_system(&["x-y", "x+y", "0"], &["x", "y", "z"], &[]);
        let ring_points = 64usize;
        let ring = (0..ring_points)
            .map(|index| {
                let angle = std::f64::consts::TAU * (index as f64) / (ring_points as f64);
                vec![angle.cos(), angle.sin(), 0.0]
            })
            .collect::<Vec<_>>();
        let base_s = 0.0;
        let base = &ring[0];
        let tangent = subtract(&ring[1], &ring[ring_points - 1]);
        let outward = vec![1.0, 0.0, 0.0];

        let hit = shoot_leaf_point(
            &system, &ring, base, base_s, &tangent, &outward, 0.1, 1.0, 1e-3, 2000, 1.0, None,
        )
        .expect("rotating radial leaf hit");

        let circular_shift = hit.base_anchor.min(1.0 - hit.base_anchor);
        assert!(
            circular_shift > 1e-3,
            "the solved source must move around the ring under phase shear; anchor={}",
            hit.base_anchor
        );
        let (solved_source, _) = sample_ring_parameter_with_derivative(&ring, hit.base_anchor);
        assert!(l2_distance(&hit.in_anchor, &solved_source) <= 1e-12);
        assert!(l2_distance(&hit.in_anchor, base) > 1e-3);
    }

    #[test]
    fn manifold_eq_2d_reports_missing_leaf_without_synthesis() {
        let system = build_system(&["0", "0", "0"], &["x", "y", "z"], &[]);
        let prev_ring = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let prev_in_anchors = vec![vec![0.0, 0.0, 0.0]; prev_ring.len()];
        let failure = build_next_ring(
            &system,
            &prev_ring,
            &prev_in_anchors,
            1.0,
            0.1,
            0.1,
            1e-2,
            8,
            0.2,
        )
        .expect_err("stationary flow should report unsolved leaves");
        assert_eq!(failure.solved_points, 0);
        assert_eq!(failure.reason, LeafFailureKind::NoFirstHitWithinMaxTime);
    }

    #[test]
    fn manifold_eq_2d_spacing_adaptation_keeps_inserted_solved_leaves() {
        let system = build_system(&["x", "y", "0"], &["x", "y", "z"], &[]);
        let prev_ring = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let prev_in_anchors = vec![vec![0.0, 0.0, 0.0]; prev_ring.len()];
        let raw_next = RingSolve {
            points: vec![
                vec![1.1, 0.0, 0.0],
                vec![0.0, 1.1, 0.0],
                vec![-1.1, 0.0, 0.0],
                vec![0.0, -1.1, 0.0],
            ],
            base_anchors: vec![0.0, 0.25, 0.5, 0.75],
            in_anchors: prev_ring.clone(),
            leaf_deltas: vec![0.1; 4],
        };
        let adapted = adapt_ring_spacing(
            &system,
            &prev_ring,
            &prev_in_anchors,
            raw_next,
            1.0,
            0.1,
            0.1,
            0.01,
            1.0,
            1e-2,
            64,
            2.0,
            16,
        )
        .expect("spacing insertion should solve exact leaves");
        assert!(
            adapted.points.len() > prev_ring.len(),
            "expected spacing adaptation to keep inserted points, got {}",
            adapted.points.len()
        );
        assert_eq!(adapted.points.len(), adapted.base_anchors.len());
        assert_eq!(adapted.points.len(), adapted.in_anchors.len());
        assert!(
            adapted
                .base_anchors
                .iter()
                .any(|anchor| (*anchor - 0.125).abs() < 1e-8),
            "expected inserted midpoint source anchor to be retained: {:?}",
            adapted.base_anchors
        );
    }

    #[test]
    fn manifold_eq_2d_spacing_adaptation_never_accepts_unresolved_long_edges_at_cap() {
        let system = build_system(&["x", "y", "0"], &["x", "y", "z"], &[]);
        let prev_ring = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let raw_next = RingSolve {
            points: vec![
                vec![1.1, 0.0, 0.0],
                vec![0.0, 1.1, 0.0],
                vec![-1.1, 0.0, 0.0],
                vec![0.0, -1.1, 0.0],
            ],
            base_anchors: vec![0.0, 0.25, 0.5, 0.75],
            in_anchors: prev_ring.clone(),
            leaf_deltas: vec![0.1; 4],
        };
        let result = adapt_ring_spacing(
            &system, &prev_ring, &prev_ring, raw_next, 1.0, 0.1, 0.1, 0.01, 0.2, 1e-2, 64, 2.0, 4,
        );
        assert!(
            matches!(result, Err(RingSpacingFailure::PointCapExceeded)),
            "a ring with unresolved long edges must not be accepted at the point cap"
        );
    }

    #[test]
    fn manifold_eq_2d_spacing_adaptation_uses_the_configured_point_budget() {
        assert_eq!(adaptive_ring_point_cap(256), 256);
        assert_eq!(adaptive_ring_point_cap(3), 4);
    }

    #[test]
    fn manifold_eq_2d_regularizes_correspondence_outlier() {
        let prev = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let mut next = vec![
            vec![1.0, 0.0, 0.01],
            vec![0.0, 1.0, 0.01],
            vec![-1.0, 0.0, 50.0],
            vec![0.0, -1.0, 0.01],
        ];
        let before = l2_distance(&prev[2], &next[2]);
        regularize_ring_correspondence_outliers(&prev, &mut next, 1e-3);
        let after = l2_distance(&prev[2], &next[2]);
        assert!(after < before, "expected outlier displacement to shrink");
        assert!(
            next[2].iter().all(|value| value.is_finite()),
            "regularized point must stay finite"
        );
    }

    #[test]
    fn manifold_eq_2d_geodesic_quality_uses_distance_scaled_metric() {
        let m = 24usize;
        let make_rings = |scale: f64| {
            let mut prev_prev = Vec::with_capacity(m);
            let mut prev = Vec::with_capacity(m);
            let mut next = Vec::with_capacity(m);
            for i in 0..m {
                let theta = (i as f64) * std::f64::consts::TAU / (m as f64);
                let c = theta.cos();
                let s = theta.sin();
                prev_prev.push(vec![scale * c, scale * s, 0.0]);
                prev.push(vec![1.2 * scale * c, 1.2 * scale * s, 0.0]);
                next.push(vec![
                    1.4 * scale * c,
                    1.4 * scale * s,
                    0.25 * scale * (2.0 * theta).sin(),
                ]);
            }
            (prev_prev, prev, next)
        };

        let (prev_prev_a, prev_a, next_a) = make_rings(1.0);
        let (prev_prev_b, prev_b, next_b) = make_rings(3.0);
        let qa = evaluate_geodesic_quality(&prev_a, &prev_prev_a, &next_a, 0.2);
        let qb = evaluate_geodesic_quality(&prev_b, &prev_prev_b, &next_b, 0.6);
        assert!(qa.max_angle > 0.0);
        assert!(qa.max_delta_angle > 0.0);
        assert!(
            (qa.max_angle - qb.max_angle).abs() <= 1e-10,
            "expected angular criterion to be scale-invariant: qa={}, qb={}",
            qa.max_angle,
            qb.max_angle
        );
        let ratio = qb.max_delta_angle / qa.max_delta_angle;
        assert!(
            (ratio - 3.0).abs() < 1e-8,
            "expected distance-angle metric to scale with geometric strip distance, got ratio={ratio}"
        );
    }

    #[test]
    fn manifold_eq_2d_delta_alpha_uses_candidate_delta_not_previous_strip_length() {
        let prev = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let next = prev
            .iter()
            .map(|point| vec![1.1 * point[0], 1.1 * point[1], 0.1])
            .collect::<Vec<_>>();
        let short_previous = prev
            .iter()
            .map(|point| vec![0.9 * point[0], 0.9 * point[1], 0.0])
            .collect::<Vec<_>>();
        let long_previous = prev
            .iter()
            .map(|point| vec![-9.0 * point[0], -9.0 * point[1], 0.0])
            .collect::<Vec<_>>();

        let short = evaluate_geodesic_quality(&prev, &short_previous, &next, 0.2);
        let long = evaluate_geodesic_quality(&prev, &long_previous, &next, 0.2);
        assert!(short.max_angle > 0.0);
        assert!(
            (short.max_delta_angle - 0.2 * short.max_angle).abs() <= 1e-12,
            "delta-alpha must equal candidate delta times alpha"
        );
        assert!(
            (short.max_delta_angle - long.max_delta_angle).abs() <= 1e-12,
            "previous strip length must not change delta-alpha"
        );
    }

    #[test]
    fn manifold_eq_2d_adaptive_global_profile_replaces_baseline_defaults() {
        let mut settings = Manifold2DSettings {
            profile: Some(Manifold2DProfile::AdaptiveGlobal),
            ..Manifold2DSettings::default()
        };
        apply_eq_2d_profile(&mut settings);
        assert!((settings.initial_radius - 0.2).abs() <= 1e-12);
        assert!((settings.leaf_delta - 0.2).abs() <= 1e-12);
        assert_eq!(settings.ring_points, 32);
        assert!((settings.integration_dt - 5e-3).abs() <= 1e-12);
        assert!((settings.min_spacing - 0.05).abs() <= 1e-12);
        assert!((settings.max_spacing - 0.5).abs() <= 1e-12);
        assert!((settings.delta_alpha_min - 0.01).abs() <= 1e-12);

        settings.ring_points = 48;
        settings.initial_radius = 0.2;
        settings.leaf_delta = 0.2;
        settings.delta_min = 0.001;
        settings.min_spacing = 0.05;
        settings.max_spacing = 0.5;
        settings.delta_alpha_min = 0.01;
        apply_eq_2d_profile(&mut settings);
        assert_eq!(
            settings.ring_points, 48,
            "profile application should preserve explicit nonbaseline overrides"
        );
    }

    #[test]
    fn manifold_eq_2d_leaf_delta_floor_prevents_unbounded_shrink() {
        let mut system = build_system(&["1.5*x", "0.8*y", "-z"], &["x", "y", "z"], &[]);
        let delta_min = 1e-2;
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 5e-2,
                leaf_delta: 1e-6,
                delta_min,
                ring_points: 8,
                integration_dt: 1e-2,
                target_radius: 0.08,
                target_arclength: 0.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 40,
                    max_rings: 2,
                    max_vertices: 128,
                    max_time: 0.1,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("surface manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface.solver_diagnostics.expect("solver diagnostics");
        assert!(
            (diagnostics.leaf_delta_floor - delta_min).abs() <= 1e-12,
            "expected configured minimum leaf-delta floor of {delta_min}, got {}",
            diagnostics.leaf_delta_floor
        );
        assert!(
            diagnostics.final_leaf_delta + 1e-12 >= diagnostics.leaf_delta_floor,
            "final leaf delta {} must respect floor {}",
            diagnostics.final_leaf_delta,
            diagnostics.leaf_delta_floor
        );
        assert!(
            diagnostics.min_leaf_delta_reached,
            "expected solver to flag min leaf-delta reached when requested delta starts below floor"
        );
    }

    #[test]
    fn manifold_eq_2d_never_accepts_a_weighted_geodesic_violation_at_the_delta_floor() {
        let mut system = build_system(&["2*x", "0.5*y", "-z"], &["x", "y", "z"], &[]);
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.1,
                leaf_delta: 0.05,
                delta_min: 0.05,
                ring_points: 12,
                min_spacing: 1e-4,
                max_spacing: 1.0,
                alpha_min: 1e-8,
                alpha_max: 1e-7,
                delta_alpha_min: 1e-8,
                delta_alpha_max: 1e-7,
                integration_dt: 1e-3,
                target_radius: 1.0,
                target_arclength: 1.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 500,
                    max_rings: 3,
                    max_vertices: 128,
                    max_time: 2.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("strict-quality surface result");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface.solver_diagnostics.expect("diagnostics");

        assert_eq!(diagnostics.termination_reason, "geodesic_quality_rejected");
        assert_eq!(
            surface.ring_offsets.len(),
            1,
            "a distance-weighted threshold violation at the configured floor must not enter the mesh"
        );
    }

    #[test]
    fn manifold_eq_2d_failure_diagnostics_record_floor_and_optional_failure_context() {
        let mut system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Stable,
                initial_radius: 1e-3,
                leaf_delta: 0.25,
                ring_points: 24,
                integration_dt: 1e-2,
                target_radius: 128.0,
                target_arclength: 50.0,
                caps: ManifoldTerminationCaps {
                    max_rings: 16,
                    max_vertices: 8_000,
                    max_time: 1e-4,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("lorenz stable manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface.solver_diagnostics.expect("solver diagnostics");
        assert!(
            diagnostics.termination_reason == "ring_build_failed"
                || diagnostics.termination_reason == "max_rings",
            "unexpected termination reason {}",
            diagnostics.termination_reason
        );
        if diagnostics.termination_reason == "ring_build_failed" {
            assert!(
                diagnostics.failed_ring.is_some(),
                "expected failed ring diagnostics"
            );
            assert!(
                diagnostics.failed_attempt.is_some(),
                "expected failed attempt diagnostics"
            );
            assert!(
                diagnostics.failed_leaf_points.is_some(),
                "expected failed leaf-point diagnostics"
            );
        }
        assert!(
            diagnostics.final_leaf_delta + 1e-12 >= diagnostics.leaf_delta_floor,
            "final leaf delta {} must respect floor {}",
            diagnostics.final_leaf_delta,
            diagnostics.leaf_delta_floor
        );
    }

    #[test]
    fn manifold_eq_2d_source_param_monotonicity_accepts_wrapped_order() {
        let params = vec![0.72, 0.80, 0.88, 0.96, 0.04, 0.12, 0.20];
        assert!(
            anchor_params_strictly_monotone_cyclic(&params),
            "wrapped source-parameter ordering should be accepted"
        );
    }

    #[test]
    fn manifold_eq_2d_source_param_monotonicity_rejects_backtracking() {
        let params = vec![0.05, 0.13, 0.13, 0.21, 0.29, 0.37];
        assert!(
            !anchor_params_strictly_monotone_cyclic(&params),
            "duplicate/backtracking source parameters must be rejected"
        );
    }

    #[test]
    fn manifold_eq_2d_half_plane_direction_uses_parent_correspondence_map() {
        let m = 24usize;
        let phase_shift = 0.125;
        let mut prev_prev = Vec::with_capacity(m);
        let mut prev = Vec::with_capacity(m);
        let mut source_params = Vec::with_capacity(m);
        for i in 0..m {
            let s = (i as f64) / (m as f64);
            let theta = std::f64::consts::TAU * s;
            prev_prev.push(vec![theta.cos(), theta.sin(), 0.0]);
            let parent_s = (s + phase_shift).rem_euclid(1.0);
            source_params.push(parent_s);
            let parent_theta = std::f64::consts::TAU * parent_s;
            prev.push(vec![parent_theta.cos(), parent_theta.sin(), 0.15]);
        }
        let i = 5usize;
        let s = (i as f64) / (m as f64);
        let base = &prev[i];
        let tangent = ring_tangent_neighbor_average(&prev, i);
        let mapped = half_plane_direction(
            Some(&prev_prev),
            Some(&source_params),
            &prev,
            base,
            s,
            None,
            None,
            &tangent,
        );
        let nominal =
            half_plane_direction(Some(&prev_prev), None, &prev, base, s, None, None, &tangent);
        let parent = sample_ring_uniform(&prev_prev, source_params[i]);
        let parent_dir = normalize(subtract(base, &parent)).expect("parent direction");
        let mapped_alignment = dot(&mapped, &parent_dir);
        let nominal_alignment = dot(&nominal, &parent_dir);
        assert!(
            mapped_alignment > nominal_alignment + 0.1,
            "expected correspondence-mapped outward direction to align better with parent geodesic: mapped={}, nominal={}",
            mapped_alignment,
            nominal_alignment
        );
    }

    #[test]
    fn triangulate_ring_bands_handles_mismatched_ring_sizes() {
        let ring_a = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
            vec![0.7, -0.7, 0.0],
        ];
        let ring_b = vec![
            vec![2.0, 0.0, 0.0],
            vec![1.4, 1.4, 0.0],
            vec![0.0, 2.0, 0.0],
            vec![-1.4, 1.4, 0.0],
            vec![-2.0, 0.0, 0.0],
            vec![-1.4, -1.4, 0.0],
            vec![0.0, -2.0, 0.0],
            vec![1.4, -1.4, 0.0],
        ];
        let rings = vec![ring_a, ring_b];
        let offsets = vec![0usize, 5usize];
        let triangles = triangulate_ring_bands(&rings, &offsets);
        assert!(!triangles.is_empty());
        assert!(triangles.len() % 3 == 0);
        assert!(triangles.iter().all(|index| *index < 13));
    }

    #[test]
    fn triangulate_ring_bands_interleaves_by_circular_phase_not_ring_density() {
        fn circle_ring(radius: f64, count: usize) -> Vec<Vec<f64>> {
            (0..count)
                .map(|index| {
                    let theta = (index as f64) * std::f64::consts::TAU / (count as f64);
                    vec![radius * theta.cos(), radius * theta.sin(), 0.0]
                })
                .collect()
        }

        fn phase_distance(a: f64, b: f64) -> f64 {
            circular_delta(a, b).abs()
        }

        let dense_count = 8usize;
        let sparse_count = 4usize;
        let rings = vec![
            circle_ring(1.0, dense_count),
            circle_ring(2.0, sparse_count),
        ];
        let offsets = vec![0usize, dense_count];
        let triangles = triangulate_ring_bands(&rings, &offsets);
        assert_eq!(triangles.len() / 3, dense_count + sparse_count);

        let max_cross_ring_phase_gap = triangles
            .chunks_exact(3)
            .flat_map(|tri| [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])])
            .filter_map(|(a, b)| {
                let a_ring = if a < dense_count { 0 } else { 1 };
                let b_ring = if b < dense_count { 0 } else { 1 };
                if a_ring == b_ring {
                    return None;
                }
                let a_phase = if a_ring == 0 {
                    (a as f64) / (dense_count as f64)
                } else {
                    ((a - dense_count) as f64) / (sparse_count as f64)
                };
                let b_phase = if b_ring == 0 {
                    (b as f64) / (dense_count as f64)
                } else {
                    ((b - dense_count) as f64) / (sparse_count as f64)
                };
                Some(phase_distance(a_phase, b_phase))
            })
            .fold(0.0, f64::max);

        assert!(
            max_cross_ring_phase_gap <= 0.25 + 1e-12,
            "triangulation made long cross-ring chords: max phase gap {max_cross_ring_phase_gap}"
        );
    }

    #[test]
    fn triangulate_ring_bands_uses_leaf_parent_anchors_on_folded_geometry() {
        let previous_count = 8usize;
        let next_count = 4usize;
        let previous = (0..previous_count)
            .map(|index| {
                let phase = (index as f64) / (previous_count as f64);
                vec![phase, (4.0 * std::f64::consts::PI * phase).sin(), 0.0]
            })
            .collect::<Vec<_>>();
        // Deliberately make ambient proximity uninformative; correspondence must come
        // from the leaf planes that generated these points.
        let next = (0..next_count)
            .map(|index| vec![1e-6 * (index as f64), 0.0, 0.1])
            .collect::<Vec<_>>();
        let parent_anchors = vec![0.125, 0.375, 0.625, 0.875];
        let rings = vec![previous, next];
        let offsets = vec![0usize, previous_count];
        let anchors = vec![Vec::new(), parent_anchors.clone()];
        let triangles = triangulate_ring_bands_with_parent_anchors(&rings, &offsets, &anchors);

        let max_parent_gap = triangles
            .chunks_exact(3)
            .flat_map(|triangle| {
                [
                    (triangle[0], triangle[1]),
                    (triangle[1], triangle[2]),
                    (triangle[2], triangle[0]),
                ]
            })
            .filter_map(|(left, right)| {
                let left_is_previous = left < previous_count;
                let right_is_previous = right < previous_count;
                if left_is_previous == right_is_previous {
                    return None;
                }
                let (previous_index, next_index) = if left_is_previous {
                    (left, right - previous_count)
                } else {
                    (right, left - previous_count)
                };
                Some(
                    circular_delta(
                        (previous_index as f64) / (previous_count as f64),
                        parent_anchors[next_index],
                    )
                    .abs(),
                )
            })
            .fold(0.0_f64, f64::max);
        assert!(
            max_parent_gap <= 0.125 + 1e-12,
            "triangles must follow leaf genealogy, max parent gap={max_parent_gap}"
        );
    }

    #[test]
    fn manifold_cycle_2d_builds_surface_geometry() {
        let mut system = build_system(&["-y", "x", "0.1*z"], &["x", "y", "z"], &[]);
        let ntst = 8usize;
        let ncol = 2usize;
        let dim = 3usize;
        let mesh_count = ntst;
        let stage_count = ntst * ncol;
        let mut state = Vec::new();
        for i in 0..mesh_count {
            let theta = (i as f64) * std::f64::consts::TAU / (ntst as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
        }
        for i in 0..stage_count {
            let theta = ((i as f64) + 0.5) * std::f64::consts::TAU / (stage_count as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
        }
        assert_eq!(state.len(), (mesh_count + stage_count) * dim);
        state.push(std::f64::consts::TAU);

        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &[
                Complex::new((0.1 * std::f64::consts::TAU).exp(), 0.0),
                Complex::new(1.0, 0.0),
            ],
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.02,
                leaf_delta: 0.03,
                ring_points: mesh_count,
                target_arclength: 1.0,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_rings: 1,
                    max_vertices: 512,
                    max_time: 1.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("cycle manifold");
        assert!(matches!(
            branch.branch_type,
            BranchType::ManifoldCycle2D { .. }
        ));
        let geometry = branch.manifold_geometry.expect("geometry");
        let ManifoldGeometry::Surface(surface) = geometry else {
            panic!("expected surface geometry");
        };
        assert_eq!(surface.dim, 3);
        assert!(!surface.vertices_flat.is_empty());
    }

    #[test]
    fn manifold_cycle_2d_respects_floquet_sheet_direction_selection() {
        let mut system = build_system(&["-y", "x", "0.1*z"], &["x", "y", "z"], &[]);
        let ntst = 8usize;
        let ncol = 2usize;
        let dim = 3usize;
        let mesh_count = ntst;
        let stage_count = ntst * ncol;
        let mut state = Vec::new();
        for i in 0..mesh_count {
            let theta = (i as f64) * std::f64::consts::TAU / (ntst as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
        }
        for i in 0..stage_count {
            let theta = ((i as f64) + 0.5) * std::f64::consts::TAU / (stage_count as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
        }
        state.push(std::f64::consts::TAU);

        let mut run = |direction: ManifoldDirection| {
            continue_limit_cycle_manifold_2d(
                &mut system,
                &state,
                ntst,
                ncol,
                &[
                    Complex::new((0.1 * std::f64::consts::TAU).exp(), 0.0),
                    Complex::new(1.0, 0.0),
                ],
                ManifoldCycle2DSettings {
                    stability: ManifoldStability::Unstable,
                    direction,
                    initial_radius: 0.02,
                    leaf_delta: 0.03,
                    ring_points: 10,
                    target_arclength: 0.0,
                    ntst,
                    ncol,
                    caps: ManifoldTerminationCaps {
                        max_rings: 1,
                        max_vertices: 1024,
                        max_time: 1.0,
                        ..ManifoldTerminationCaps::default()
                    },
                    ..ManifoldCycle2DSettings::default()
                },
            )
            .expect("cycle manifold")
        };

        let plus = run(ManifoldDirection::Plus);
        let minus = run(ManifoldDirection::Minus);
        let both = continue_limit_cycle_manifolds_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &[
                Complex::new((0.1 * std::f64::consts::TAU).exp(), 0.0),
                Complex::new(1.0, 0.0),
            ],
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Both,
                initial_radius: 0.02,
                leaf_delta: 0.03,
                ring_points: 10,
                target_arclength: 0.0,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_rings: 1,
                    max_vertices: 1024,
                    max_time: 1.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("both orientable cycle sheets");

        let get_first_ring_count = |branch: &ContinuationBranch| -> usize {
            let ManifoldGeometry::Surface(surface) =
                branch.manifold_geometry.clone().expect("geometry")
            else {
                panic!("expected surface geometry");
            };
            if surface.ring_offsets.len() >= 2 {
                surface.ring_offsets[1] - surface.ring_offsets[0]
            } else {
                surface.vertices_flat.len() / dim
            }
        };

        let plus_count = get_first_ring_count(&plus);
        let minus_count = get_first_ring_count(&minus);
        assert_eq!(plus_count, 10, "plus should seed one sheet");
        assert_eq!(minus_count, 10, "minus should seed one sheet");
        assert_eq!(both.len(), 2, "both should return two independent sheets");
        assert!(
            both.iter().all(|branch| get_first_ring_count(branch) == 10),
            "each orientable sheet must retain its own closed seed circle"
        );
    }

    #[test]
    fn manifold_cycle_2d_negative_multiplier_uses_double_cover_initial_ring() {
        // In the rotating transverse frame, the two real exponents are +/-0.1.
        // The frame itself turns by pi over one cycle, so the genuine Floquet
        // multipliers are -exp(+/-0.1*TAU), one on either side of the unit circle.
        let mut system = build_system(
            &[
                "-y",
                "x",
                "0.1*x*z + (0.1*y - 0.5)*w",
                "(0.1*y + 0.5)*z - 0.1*x*w",
            ],
            &["x", "y", "z", "w"],
            &[],
        );
        let ntst = 8usize;
        let ncol = 2usize;
        let dim = 4usize;
        let mesh_count = ntst;
        let stage_count = ntst * ncol;
        let mut state = Vec::new();
        for i in 0..mesh_count {
            let theta = (i as f64) * std::f64::consts::TAU / (ntst as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
            state.push(0.0);
        }
        for i in 0..stage_count {
            let theta = ((i as f64) + 0.5) * std::f64::consts::TAU / (stage_count as f64);
            state.push(theta.cos());
            state.push(theta.sin());
            state.push(0.0);
            state.push(0.0);
        }
        assert_eq!(state.len(), (mesh_count + stage_count) * dim);
        state.push(std::f64::consts::TAU);

        let settings = ManifoldCycle2DSettings {
            stability: ManifoldStability::Unstable,
            initial_radius: 0.02,
            leaf_delta: 0.005,
            ring_points: 10,
            target_arclength: 0.5,
            ntst,
            ncol,
            caps: ManifoldTerminationCaps {
                max_rings: 1,
                max_vertices: 1_024,
                max_time: 2.0,
                ..ManifoldTerminationCaps::default()
            },
            ..ManifoldCycle2DSettings::default()
        };

        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &[
                Complex::new((0.1 * std::f64::consts::TAU).exp(), 0.0),
                Complex::new((-0.1 * std::f64::consts::TAU).exp(), 0.0),
                Complex::new(1.0, 0.0),
                Complex::new(1.0, 0.0),
            ]
            .map(|value| {
                if (value.re - 1.0).abs() > 1e-12 {
                    -value
                } else {
                    value
                }
            }),
            settings,
        )
        .expect("cycle manifold with negative multiplier");

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let vertex_count = surface.vertices_flat.len() / dim;
        let first_ring_count = if surface.ring_offsets.len() >= 2 {
            surface.ring_offsets[1] - surface.ring_offsets[0]
        } else {
            vertex_count
        };
        assert_eq!(
            first_ring_count, 20,
            "expected doubled initial ring (20 points), got {first_ring_count} (total vertices {vertex_count})"
        );
    }

    #[test]
    fn manifold_cycle_2d_decode_profile_preserves_phase_order_for_implicit_and_explicit_mesh_layouts(
    ) {
        let dim = 2usize;
        let ntst = 3usize;
        let ncol = 2usize;
        let mesh = vec![vec![10.0, 10.5], vec![20.0, 20.5], vec![30.0, 30.5]];
        let stages = vec![
            vec![11.0, 11.5],
            vec![12.0, 12.5],
            vec![21.0, 21.5],
            vec![22.0, 22.5],
            vec![31.0, 31.5],
            vec![32.0, 32.5],
        ];
        let expected = vec![
            vec![10.0, 10.5],
            vec![11.0, 11.5],
            vec![12.0, 12.5],
            vec![20.0, 20.5],
            vec![21.0, 21.5],
            vec![22.0, 22.5],
            vec![30.0, 30.5],
            vec![31.0, 31.5],
            vec![32.0, 32.5],
        ];

        let mut implicit = Vec::new();
        for point in &mesh {
            implicit.extend_from_slice(point);
        }
        for stage in &stages {
            implicit.extend_from_slice(stage);
        }
        implicit.push(std::f64::consts::TAU);
        let decoded_implicit = decode_cycle_profile_points(&implicit, dim, ntst, ncol);
        assert_eq!(decoded_implicit.mesh_points, mesh);
        assert_eq!(decoded_implicit.points, expected);
        let nodes = CollocationCoefficients::new(ncol)
            .expect("collocation nodes")
            .nodes;
        let expected_phases = vec![
            0.0,
            nodes[0] / 3.0,
            nodes[1] / 3.0,
            1.0 / 3.0,
            (1.0 + nodes[0]) / 3.0,
            (1.0 + nodes[1]) / 3.0,
            2.0 / 3.0,
            (2.0 + nodes[0]) / 3.0,
            (2.0 + nodes[1]) / 3.0,
        ];
        assert_eq!(decoded_implicit.phases.len(), expected_phases.len());
        for (actual, expected) in decoded_implicit.phases.iter().zip(&expected_phases) {
            assert!((actual - expected).abs() <= 1e-14);
        }

        let mut explicit = Vec::new();
        for point in &mesh {
            explicit.extend_from_slice(point);
        }
        explicit.extend_from_slice(&mesh[0]);
        for stage in &stages {
            explicit.extend_from_slice(stage);
        }
        explicit.push(std::f64::consts::TAU);
        let decoded_explicit = decode_cycle_profile_points(&explicit, dim, ntst, ncol);
        assert_eq!(decoded_explicit.mesh_points, mesh);
        assert_eq!(decoded_explicit.points, expected);
        assert_eq!(decoded_explicit.phases, decoded_implicit.phases);
    }

    #[test]
    fn manifold_cycle_2d_hopf_benchmark_builds_multiple_rings_for_stable_and_unstable() {
        let mu = 0.1_f64;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &[
                "mu*x - y - x*(x*x + y*y)",
                "x + mu*y - y*(x*x + y*y)",
                "lambda*z",
            ],
            &["x", "y", "z"],
            &[("mu", mu), ("lambda", lambda)],
        );
        let ntst = 16usize;
        let ncol = 3usize;
        let radius = mu.sqrt();
        let mut state = Vec::new();
        for i in 0..ntst {
            let theta = (i as f64) * std::f64::consts::TAU / (ntst as f64);
            state.push(radius * theta.cos());
            state.push(radius * theta.sin());
            state.push(0.0);
        }
        let nodes = CollocationCoefficients::new(ncol)
            .expect("collocation nodes")
            .nodes;
        for interval in 0..ntst {
            for stage in 0..ncol {
                let theta =
                    (interval as f64 + nodes[stage]) * std::f64::consts::TAU / (ntst as f64);
                state.push(radius * theta.cos());
                state.push(radius * theta.sin());
                state.push(0.0);
            }
        }
        state.push(std::f64::consts::TAU);

        let unstable_mu = (lambda * std::f64::consts::TAU).exp();
        let stable_mu = ((-2.0 * mu) * std::f64::consts::TAU).exp();
        let multipliers = [
            Complex::new(unstable_mu, 0.0),
            Complex::new(stable_mu, 0.0),
            Complex::new(1.0, 0.0),
        ];

        let unstable_branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                floquet_index: Some(0),
                parameter_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 1e-3,
                delta_min: 2e-4,
                ring_points: 24,
                min_spacing: 0.25,
                max_spacing: 2.0,
                integration_dt: 2e-2,
                target_arclength: 0.02,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 300,
                    max_points: 3_000,
                    max_rings: 2,
                    max_vertices: 6_000,
                    max_time: 30.0,
                    max_iterations: None,
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("unstable cycle manifold");
        let ManifoldGeometry::Surface(unstable_surface) = unstable_branch
            .manifold_geometry
            .expect("unstable geometry")
        else {
            panic!("expected unstable surface geometry");
        };
        let unstable_diag = unstable_surface.solver_diagnostics.as_ref().map(|diag| {
            (
                diag.termination_reason.clone(),
                diag.termination_detail.clone(),
            )
        });
        assert!(
            unstable_surface.ring_offsets.len() > 1,
            "expected unstable manifold to build beyond seed ring, diagnostics={unstable_diag:?}"
        );
        if let Some(diag) = unstable_surface.solver_diagnostics.as_ref() {
            assert_ne!(
                diag.termination_reason, "ring_build_failed",
                "unexpected unstable ring-build failure detail={:?}",
                diag.termination_detail
            );
        }

        let stable_branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Stable,
                floquet_index: Some(1),
                parameter_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 1e-3,
                delta_min: 2e-4,
                ring_points: 24,
                min_spacing: 0.25,
                max_spacing: 2.0,
                integration_dt: 2e-2,
                target_arclength: 0.02,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 300,
                    max_points: 3_000,
                    max_rings: 2,
                    max_vertices: 6_000,
                    max_time: 30.0,
                    max_iterations: None,
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("stable cycle manifold");
        let ManifoldGeometry::Surface(stable_surface) =
            stable_branch.manifold_geometry.expect("stable geometry")
        else {
            panic!("expected stable surface geometry");
        };
        let stable_diag = stable_surface.solver_diagnostics.as_ref().map(|diag| {
            (
                diag.termination_reason.clone(),
                diag.termination_detail.clone(),
            )
        });
        assert!(
            stable_surface.ring_offsets.len() > 1,
            "expected stable manifold to build beyond seed ring, diagnostics={stable_diag:?}"
        );
        if let Some(diag) = stable_surface.solver_diagnostics.as_ref() {
            assert_ne!(
                diag.termination_reason, "ring_build_failed",
                "unexpected stable ring-build failure detail={:?}",
                diag.termination_detail
            );
        }
    }

    #[test]
    fn manifold_cycle_2d_isochron_fibers_builds_unstable_linear_cylinder() {
        let ntst = 8usize;
        let ncol = 2usize;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &["-y", "x", "lambda*z"],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let state = circular_cycle_state(ntst, ncol, 1.0);
        let multipliers = [
            Complex::new((lambda * std::f64::consts::TAU).exp(), 0.0),
            Complex::new(1.0, 0.0),
        ];
        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                algorithm: ManifoldCycle2DAlgorithm::IsochronFibers,
                floquet_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 5e-3,
                ring_points: 12,
                integration_dt: 2e-2,
                target_arclength: 2e-2,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 120,
                    max_rings: 8,
                    max_vertices: 512,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("unstable HKO isochron manifold");

        let BranchType::ManifoldCycle2D { method, .. } = &branch.branch_type else {
            panic!("expected cycle manifold branch");
        };
        assert_eq!(method, "hko_fundamental_segment_bvp");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        assert!(
            surface.ring_offsets.len() >= 4,
            "expected arclength-resampled HKO surface rings"
        );
        assert!(!surface.triangles.is_empty(), "expected surface triangles");
        let vertices = surface.vertices_flat.chunks_exact(3).collect::<Vec<_>>();
        let max_radial_error = vertices
            .iter()
            .map(|point| ((point[0] * point[0] + point[1] * point[1]).sqrt() - 1.0).abs())
            .fold(0.0, f64::max);
        assert!(
            max_radial_error < 2e-2,
            "unstable linear cylinder should stay near LC radius; max error={max_radial_error}"
        );
        let max_abs_z = vertices
            .iter()
            .map(|point| point[2].abs())
            .fold(0.0, f64::max);
        assert!(
            max_abs_z > 1e-3,
            "expected the unstable sheet to grow in z, max_abs_z={max_abs_z}"
        );
        let diagnostics = surface.solver_diagnostics.expect("diagnostics");
        assert_eq!(diagnostics.termination_reason, "target_arclength");
        assert!(
            diagnostics
                .termination_detail
                .as_deref()
                .unwrap_or_default()
                .contains("HKO fundamental-segment continuation"),
            "expected HKO diagnostics detail"
        );
        assert!(
            diagnostics
                .termination_detail
                .as_deref()
                .unwrap_or_default()
                .contains("fundamental_solves="),
            "expected fundamental-segment diagnostics detail"
        );
    }

    #[test]
    fn manifold_cycle_2d_hko_reports_max_steps_when_the_common_fiber_is_short() {
        let ntst = 8usize;
        let ncol = 2usize;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &["-y", "x", "lambda*z"],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let state = circular_cycle_state(ntst, ncol, 1.0);
        let multipliers = [
            Complex::new((lambda * std::f64::consts::TAU).exp(), 0.0),
            Complex::new(1.0, 0.0),
        ];
        let target_arclength = 100.0;
        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                algorithm: ManifoldCycle2DAlgorithm::IsochronFibers,
                floquet_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 0.1,
                ring_points: 8,
                integration_dt: 2e-2,
                target_arclength,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 2,
                    max_rings: 100,
                    max_vertices: 10_000,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("point-capped HKO manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface.solver_diagnostics.expect("diagnostics");
        let achieved = surface
            .ring_diagnostics
            .last()
            .map(|ring| ring.radius_estimate)
            .unwrap_or(0.0);

        assert!(achieved + 1e-8 < target_arclength);
        assert_eq!(diagnostics.termination_reason, "max_steps");
    }

    #[test]
    fn manifold_cycle_2d_fiber_caps_report_only_actual_truncation() {
        assert_eq!(
            fiber_surface_termination_reason(false, true, 8, 8, 8),
            SurfaceTerminationReason::TargetArclength,
            "an exactly filled ring/vertex budget still reaches the target"
        );
        assert_eq!(
            fiber_surface_termination_reason(false, true, 9, 10, 8),
            SurfaceTerminationReason::MaxVertices
        );
        assert_eq!(
            fiber_surface_termination_reason(false, true, 9, 8, 10),
            SurfaceTerminationReason::MaxRings
        );
        assert_eq!(
            fiber_surface_termination_reason(false, false, 2, 10, 10),
            SurfaceTerminationReason::MaxSteps
        );
    }

    #[test]
    fn manifold_surface_ring_quality_has_a_distinct_termination_label() {
        assert_eq!(
            SurfaceTerminationReason::RingQualityRejected.as_str(),
            "ring_quality_rejected"
        );
        assert_ne!(
            SurfaceTerminationReason::RingQualityRejected.as_str(),
            SurfaceTerminationReason::GeodesicQualityRejected.as_str()
        );
    }

    #[test]
    fn manifold_cycle_2d_isochron_fibers_builds_stable_linear_cylinder() {
        let ntst = 8usize;
        let ncol = 2usize;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &["-y", "x", "-lambda*z"],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let state = circular_cycle_state(ntst, ncol, 1.0);
        let multipliers = [
            Complex::new((-lambda * std::f64::consts::TAU).exp(), 0.0),
            Complex::new(1.0, 0.0),
        ];
        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Stable,
                algorithm: ManifoldCycle2DAlgorithm::IsochronFibers,
                floquet_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 5e-3,
                ring_points: 12,
                integration_dt: 2e-2,
                target_arclength: 2e-2,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 120,
                    max_rings: 8,
                    max_vertices: 512,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("stable HKO isochron manifold");

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        assert!(surface.ring_offsets.len() >= 4);
        let vertices = surface.vertices_flat.chunks_exact(3).collect::<Vec<_>>();
        let max_radial_error = vertices
            .iter()
            .map(|point| ((point[0] * point[0] + point[1] * point[1]).sqrt() - 1.0).abs())
            .fold(0.0, f64::max);
        assert!(
            max_radial_error < 2e-2,
            "stable linear cylinder should stay near LC radius; max error={max_radial_error}"
        );
        let max_abs_z = surface
            .vertices_flat
            .chunks_exact(3)
            .map(|point| point[2].abs())
            .fold(0.0, f64::max);
        assert!(
            max_abs_z > 1e-3,
            "expected the stable sheet to grow outward in the reversed-time z direction, max_abs_z={max_abs_z}"
        );
    }

    #[test]
    fn manifold_cycle_2d_hko_separates_phase_shear_from_normal_lift_off() {
        let system = build_system(&["-y", "x", "0.2*z", "-w"], &["x", "y", "z", "w"], &[]);
        let origin = [1.0, 0.0, 0.0, 0.0];
        let floquet_direction = [0.0, 0.0, 1.0, 0.0];
        let point = [1.0, 3.0, 2.0, 4.0];

        let (phase_shear, normal_lift_off) =
            hko_departure_components(&system, &point, &origin, &floquet_direction);

        assert!((phase_shear - 3.0).abs() <= 1e-12);
        assert!((normal_lift_off - 4.0).abs() <= 1e-12);
    }

    #[test]
    fn manifold_cycle_2d_hko_constructs_nonlinear_fundamental_segments() {
        let ntst = 8usize;
        let ncol = 2usize;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &[
                "-y + x*(1-x*x-y*y) + 5*z*z",
                "x + y*(1-x*x-y*y)",
                "lambda*z",
            ],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let state = circular_cycle_state(ntst, ncol, 1.0);
        let multipliers = [
            Complex::new((lambda * std::f64::consts::TAU).exp(), 0.0),
            Complex::new((-2.0 * std::f64::consts::TAU).exp(), 0.0),
            Complex::new(1.0, 0.0),
        ];
        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &multipliers,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                algorithm: ManifoldCycle2DAlgorithm::IsochronFibers,
                floquet_index: Some(0),
                direction: ManifoldDirection::Plus,
                initial_radius: 1e-3,
                leaf_delta: 2e-3,
                ring_points: 8,
                integration_dt: 2e-2,
                target_arclength: 1e-2,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 100,
                    max_rings: 8,
                    max_vertices: 512,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("nonlinear HKO manifold");

        let BranchType::ManifoldCycle2D { method, .. } = &branch.branch_type else {
            panic!("expected cycle manifold branch");
        };
        assert_eq!(method, "hko_fundamental_segment_bvp");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let max_radial_lift = surface
            .vertices_flat
            .chunks_exact(3)
            .map(|point| ((point[0] * point[0] + point[1] * point[1]).sqrt() - 1.0).abs())
            .fold(0.0_f64, f64::max);
        assert!(
            max_radial_lift > 1e-8,
            "nonlinear coupling should lift the fundamental segment away from the linear Floquet cylinder"
        );
        let diagnostics = surface.solver_diagnostics.expect("diagnostics");
        assert_eq!(diagnostics.build_failures, 0);
        assert!(
            diagnostics
                .termination_detail
                .as_deref()
                .unwrap_or_default()
                .contains("max_lift_off="),
            "HKO diagnostics should expose nonlinear lift-off"
        );
        assert!(
            diagnostics
                .termination_detail
                .as_deref()
                .unwrap_or_default()
                .contains("max_phase_shear="),
            "HKO diagnostics should expose phase shear"
        );
    }

    #[test]
    fn manifold_cycle_2d_never_accepts_a_nonconverged_collocation_solution() {
        let nonconverged = IsochronBvpSolution {
            start: vec![1.0, 2.0, 3.0],
            unknown: vec![1.0, 2.0, 3.0],
            residual_norm: 1e-2,
            iterations: ISOCHRON_BVP_NEWTON_MAX_ITERS,
            converged: false,
        };
        let error = require_converged_isochron_bvp(&nonconverged, "test phase")
            .expect_err("nonconverged collocation output must be rejected");
        assert!(error.to_string().contains("did not converge"));
    }

    #[test]
    fn manifold_cycle_2d_segmented_preimage_backend_remains_available_by_name() {
        let ntst = 8usize;
        let ncol = 2usize;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &["-y", "x", "lambda*z"],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let state = circular_cycle_state(ntst, ncol, 1.0);
        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &state,
            ntst,
            ncol,
            &[
                Complex::new((lambda * std::f64::consts::TAU).exp(), 0.0),
                Complex::new(1.0, 0.0),
            ],
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                algorithm: ManifoldCycle2DAlgorithm::SegmentedPreimageFibers,
                floquet_index: Some(0),
                initial_radius: 1e-3,
                leaf_delta: 5e-3,
                ring_points: 8,
                target_arclength: 1e-2,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_steps: 80,
                    max_rings: 6,
                    max_vertices: 256,
                    max_time: 20.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("segmented preimage manifold");
        let BranchType::ManifoldCycle2D { method, .. } = branch.branch_type else {
            panic!("expected cycle manifold branch");
        };
        assert_eq!(method, "segmented_preimage_collocation");
    }

    #[test]
    fn manifold_cycle_2d_isochron_phase_cover_preserves_negative_multiplier_double_cover() {
        let cycle = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![-1.0, 0.0, 0.0],
            vec![0.0, -1.0, 0.0],
        ];
        let dirs = vec![vec![0.0, 0.0, 1.0]; cycle.len()];
        let (cover, cover_dirs, return_time) =
            build_isochron_phase_cover(&cycle, &dirs, -0.5, ManifoldDirection::Plus, 3.0)
                .expect("phase cover");
        assert_eq!(cover.len(), cycle.len() * 2);
        assert_eq!(cover_dirs.len(), cycle.len() * 2);
        assert!((return_time - 6.0).abs() <= 1e-12);
        for idx in 0..cycle.len() {
            assert_eq!(cover[idx], cover[idx + cycle.len()]);
            assert!(cover_dirs[idx][2] > 0.0);
            assert!(cover_dirs[idx + cycle.len()][2] < 0.0);
        }
    }

    #[test]
    fn manifold_cycle_2d_isochron_return_segments_limit_step_expansion() {
        let mild = effective_isochron_return_segments(1.25, 8);
        let strong_unstable = effective_isochron_return_segments(1.0e8, 8);
        let strong_stable = effective_isochron_return_segments(1.0e-8, 8);
        assert!(mild >= 4, "phase resolution should set a modest floor");
        assert!(
            strong_unstable > mild,
            "large unstable multipliers should split the return map"
        );
        assert_eq!(
            strong_unstable, strong_stable,
            "stable and unstable growth rates should use symmetric splitting"
        );
        assert!(
            effective_isochron_return_segments(f64::INFINITY, 8) <= ISOCHRON_MAX_RETURN_SEGMENTS
        );
    }

    #[test]
    fn manifold_eq_2d_lorenz_stable_global_parameters_expand_beyond_local_patch() {
        let mut system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Stable,
                profile: Some(Manifold2DProfile::LorenzGlobalKo),
                initial_radius: 1.0,
                leaf_delta: 1.0,
                delta_min: 0.01,
                ring_points: 20,
                min_spacing: 0.25,
                max_spacing: 2.0,
                alpha_min: 0.3,
                alpha_max: 0.4,
                delta_alpha_min: 0.01,
                delta_alpha_max: 1.0,
                integration_dt: 1e-3,
                target_radius: 8.0,
                target_arclength: 20.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 2000,
                    max_rings: 60,
                    max_vertices: 100_000,
                    max_time: 80.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("lorenz stable manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let mut max_radius = 0.0_f64;
        for point in surface.vertices_flat.chunks(3) {
            max_radius = max_radius.max(l2_norm(point));
        }
        assert!(
            max_radius > 0.5,
            "expected global-scale Lorenz manifold growth, got max_radius={max_radius}, rings={}, vertices={}",
            surface.ring_offsets.len(),
            surface.vertices_flat.len() / 3
        );
        assert!(
            surface.ring_offsets.len() >= 3,
            "expected multiple grown rings for global Lorenz run, got {}",
            surface.ring_offsets.len()
        );
    }

    #[test]
    fn manifold_eq_2d_lorenz_stable_global_run_does_not_end_ring_build_failed_for_reference_profile(
    ) {
        let mut system = build_system(
            &["sigma*(y-x)", "x*(rho-z)-y", "x*y-beta*z"],
            &["x", "y", "z"],
            &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0)],
        );
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Stable,
                profile: Some(Manifold2DProfile::LorenzGlobalKo),
                initial_radius: 1.0,
                leaf_delta: 1.0,
                delta_min: 0.01,
                ring_points: 20,
                min_spacing: 0.25,
                max_spacing: 2.0,
                alpha_min: 0.3,
                alpha_max: 0.4,
                delta_alpha_min: 0.01,
                delta_alpha_max: 1.0,
                integration_dt: 1e-3,
                target_radius: 8.0,
                target_arclength: 20.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 150,
                    max_rings: 60,
                    max_vertices: 100_000,
                    max_time: 50.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("lorenz stable manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface
            .solver_diagnostics
            .expect("expected solver diagnostics on 2D manifold geometry");
        assert!(
            diagnostics.termination_reason != "ring_build_failed"
                && diagnostics.termination_reason != "ring_quality_rejected"
                && diagnostics.termination_reason != "geodesic_quality_rejected",
            "Lorenz global profile terminated by quality/build failure: reason={} detail={:?}",
            diagnostics.termination_reason,
            diagnostics.termination_detail
        );
        assert!(
            diagnostics.final_leaf_delta > 0.01 + 1e-12,
            "Lorenz global profile should recover from any floor trial instead of collapsing there: final_delta={} geodesic_rejects={} ring_rejects={} local_shrinks={} detail={:?}",
            diagnostics.final_leaf_delta,
            diagnostics.reject_geodesic_quality,
            diagnostics.reject_ring_quality,
            diagnostics.local_leaf_shrinks,
            diagnostics.termination_detail,
        );
        assert!(
            surface.ring_offsets.len() >= 5,
            "Lorenz global profile should build a nontrivial ring stack, got {} rings",
            surface.ring_offsets.len()
        );
        let max_z = surface
            .vertices_flat
            .chunks(3)
            .map(|point| point[2].abs())
            .fold(0.0_f64, f64::max);
        assert!(
            max_z >= 2.0,
            "Lorenz global profile should leave the tiny local patch (max |z|={max_z})"
        );
    }

    #[test]
    fn manifold_eq_2d_adaptive_global_grows_shimizu_morioka_stable_surface() {
        let mut system = build_system(
            &["y", "x*(1-z)-lambda*y", "-alpha*z+x*x"],
            &["x", "y", "z"],
            &[("lambda", 0.75), ("alpha", 0.375)],
        );
        let branch = continue_manifold_eq_2d(
            &mut system,
            &[0.0, 0.0, 0.0],
            Manifold2DSettings {
                stability: ManifoldStability::Stable,
                profile: Some(Manifold2DProfile::AdaptiveGlobal),
                target_radius: 0.7,
                target_arclength: 2.0,
                caps: ManifoldTerminationCaps {
                    max_rings: 16,
                    max_vertices: 20_000,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("Shimizu-Morioka stable manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface
            .solver_diagnostics
            .expect("expected solver diagnostics on 2D manifold geometry");
        assert!(
            diagnostics.termination_reason != "ring_build_failed"
                && diagnostics.termination_reason != "ring_spacing_failed"
                && diagnostics.termination_reason != "geodesic_quality_rejected",
            "adaptive profile terminated by solver failure: reason={} detail={:?}",
            diagnostics.termination_reason,
            diagnostics.termination_detail
        );
        assert!(
            surface.ring_offsets.len() >= 3,
            "expected a nontrivial Shimizu-Morioka ring stack, got {} rings",
            surface.ring_offsets.len()
        );
    }

    #[test]
    fn manifold_eq_2d_rossler_unstable_no_segment_switch_limit_failures() {
        let mut system = build_system(
            &["-y-z", "x+a*y", "b+z*(x-c)"],
            &["x", "y", "z"],
            &[("a", 0.2), ("b", 0.2), ("c", 5.7)],
        );
        let guesses = [
            vec![0.0, 0.0, 0.0],
            vec![0.1, -0.1, 0.1],
            vec![6.0, -28.0, 28.0],
        ];
        let mut equilibrium = None;
        for guess in guesses {
            let Ok(solution) = solve_equilibrium(
                &system,
                SystemKind::Flow,
                &guess,
                NewtonSettings {
                    max_steps: 80,
                    damping: 1.0,
                    tolerance: 1e-10,
                },
            ) else {
                continue;
            };
            let unstable_count = solution
                .eigenpairs
                .iter()
                .filter(|pair| pair.value.re > 1e-9)
                .count();
            if unstable_count == 2 {
                equilibrium = Some(solution.state);
                break;
            }
        }
        let equilibrium = equilibrium.expect("expected Rossler equilibrium with 2D unstable side");

        let branch = continue_manifold_eq_2d(
            &mut system,
            &equilibrium,
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.02,
                leaf_delta: 0.02,
                delta_min: 1e-3,
                ring_points: 12,
                min_spacing: 0.005,
                max_spacing: 0.05,
                alpha_min: 0.3,
                alpha_max: 0.4,
                delta_alpha_min: 0.1,
                delta_alpha_max: 1.0,
                integration_dt: 5e-3,
                target_radius: 0.2,
                target_arclength: 0.3,
                caps: ManifoldTerminationCaps {
                    max_steps: 80,
                    max_points: 400,
                    max_rings: 4,
                    max_vertices: 2_000,
                    max_time: 1.0,
                    max_iterations: None,
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("Rossler unstable manifold");
        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let diagnostics = surface
            .solver_diagnostics
            .expect("expected solver diagnostics on 2D manifold geometry");
        assert_eq!(
            diagnostics.leaf_fail_segment_switch_limit, 0,
            "Rossler run should avoid segment-switch-limit failures; detail={:?}",
            diagnostics.termination_detail
        );
    }

    fn assert_surface_extension_appends_without_rewriting(
        original: &ContinuationBranch,
        extended: &ContinuationBranch,
    ) {
        let ManifoldGeometry::Surface(original_surface) = original
            .manifold_geometry
            .as_ref()
            .expect("original surface geometry")
        else {
            panic!("expected original surface geometry");
        };
        let ManifoldGeometry::Surface(extended_surface) = extended
            .manifold_geometry
            .as_ref()
            .expect("extended surface geometry")
        else {
            panic!("expected extended surface geometry");
        };
        assert!(
            extended_surface
                .vertices_flat
                .starts_with(&original_surface.vertices_flat),
            "extension must preserve every existing surface vertex"
        );
        assert!(
            extended_surface
                .triangles
                .starts_with(&original_surface.triangles),
            "extension must preserve every existing surface triangle"
        );
        assert!(
            extended_surface
                .ring_offsets
                .starts_with(&original_surface.ring_offsets),
            "extension must preserve existing ring offsets"
        );
        assert!(
            extended_surface.vertices_flat.len() > original_surface.vertices_flat.len(),
            "extension must append new vertices"
        );
        assert!(
            extended_surface.ring_offsets.len() > original_surface.ring_offsets.len(),
            "extension must append at least one ring"
        );
        assert!(extended_surface.resume_state.is_some());
        assert_eq!(
            extended_surface
                .solver_diagnostics
                .as_ref()
                .expect("surface diagnostics")
                .extension_count,
            1
        );
        assert_eq!(
            &extended.points[..original.points.len()]
                .iter()
                .map(|point| (&point.state, point.param_value))
                .collect::<Vec<_>>(),
            &original
                .points
                .iter()
                .map(|point| (&point.state, point.param_value))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn manifold_eq_2d_extension_resumes_the_outer_geodesic_ring() {
        for (equations, stability) in [
            (["1.5*x", "0.8*y", "-z"], ManifoldStability::Unstable),
            (["-1.5*x", "-0.8*y", "z"], ManifoldStability::Stable),
        ] {
            let mut system = build_system(&equations, &["x", "y", "z"], &[]);
            let initial = continue_manifold_eq_2d(
                &mut system,
                &[0.0, 0.0, 0.0],
                Manifold2DSettings {
                    stability,
                    initial_radius: 0.02,
                    leaf_delta: 0.02,
                    delta_min: 1e-4,
                    ring_points: 12,
                    target_radius: f64::INFINITY,
                    target_arclength: 1.0,
                    caps: ManifoldTerminationCaps {
                        max_rings: 2,
                        max_vertices: 256,
                        max_time: 2.0,
                        ..ManifoldTerminationCaps::default()
                    },
                    ..Manifold2DSettings::default()
                },
            )
            .expect("initial equilibrium surface");
            let original = initial.clone();

            let extended = extend_manifold_eq_2d(
                &mut system,
                initial,
                Manifold2DSettings {
                    stability,
                    leaf_delta: 0.02,
                    delta_min: 1e-4,
                    target_arclength: 0.04,
                    caps: ManifoldTerminationCaps {
                        max_rings: 3,
                        max_vertices: 256,
                        max_time: 2.0,
                        ..ManifoldTerminationCaps::default()
                    },
                    ..Manifold2DSettings::default()
                },
            )
            .expect("extended equilibrium surface");

            assert_surface_extension_appends_without_rewriting(&original, &extended);
        }
    }

    #[test]
    fn manifold_cycle_2d_extension_resumes_geodesic_rings() {
        let ntst = 8;
        let ncol = 2;
        let mut system = build_system(&["x", "y", "-z"], &["x", "y", "z"], &[]);
        let ring = build_equilibrium_initial_ring(
            &[0.0, 0.0, 0.0],
            &[1.0, 0.0, 0.0],
            &[0.0, 1.0, 0.0],
            0.02,
            12,
        );
        let initial = ContinuationBranch {
            points: surface_points_to_branch_points(&ring, &[0]),
            bifurcations: Vec::new(),
            indices: (0..ring.len() as i32).collect(),
            branch_type: BranchType::ManifoldCycle2D {
                stability: ManifoldStability::Unstable,
                direction: ManifoldDirection::Plus,
                floquet_index: 0,
                ntst,
                ncol,
                method: "krauskopf_osinga_geodesic_leaf_continuation".to_string(),
                caps: ManifoldTerminationCaps::default(),
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: Some(ManifoldGeometry::Surface(ManifoldSurfaceGeometry {
                dim: 3,
                vertices_flat: flatten_points(&ring),
                triangles: Vec::new(),
                ring_offsets: vec![0],
                ring_diagnostics: Vec::new(),
                solver_diagnostics: Some(ManifoldSurfaceSolverDiagnostics::default()),
                resume_state: Some(Box::new(ManifoldSurfaceResumeState::GeodesicRings {
                    version: 1,
                    outer_ring: ring.clone(),
                    inward_anchors: vec![vec![0.0, 0.0, 0.0]; ring.len()],
                    current_leaf_delta: 0.02,
                    accumulated_arclength: 0.0,
                    center: None,
                })),
            })),
        };
        let original = initial.clone();

        let extended = extend_limit_cycle_manifold_2d(
            &mut system,
            initial,
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                floquet_index: Some(0),
                leaf_delta: 0.02,
                delta_min: 1e-4,
                target_arclength: 0.04,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_rings: 3,
                    max_vertices: 256,
                    max_time: 2.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..ManifoldCycle2DSettings::default()
            },
        )
        .expect("extended geodesic cycle surface");

        assert_surface_extension_appends_without_rewriting(&original, &extended);
    }

    fn assert_cycle_fiber_backend_extends(algorithm: ManifoldCycle2DAlgorithm) {
        let ntst = 8;
        let ncol = 2;
        let lambda = 0.2_f64;
        let mut system = build_system(
            &["-y", "x", "lambda*z"],
            &["x", "y", "z"],
            &[("lambda", lambda)],
        );
        let cycle = circular_cycle_state(ntst, ncol, 1.0);
        let mut settings = ManifoldCycle2DSettings {
            stability: ManifoldStability::Unstable,
            algorithm,
            floquet_index: Some(0),
            initial_radius: 1e-3,
            leaf_delta: 2e-3,
            ring_points: 8,
            integration_dt: 2e-2,
            target_arclength: 6e-3,
            ntst,
            ncol,
            caps: ManifoldTerminationCaps {
                max_steps: 100,
                max_rings: 6,
                max_vertices: 256,
                max_time: 20.0,
                ..ManifoldTerminationCaps::default()
            },
            ..ManifoldCycle2DSettings::default()
        };
        let initial = continue_limit_cycle_manifold_2d(
            &mut system,
            &cycle,
            ntst,
            ncol,
            &[
                Complex::new((lambda * std::f64::consts::TAU).exp(), 0.0),
                Complex::new(1.0, 0.0),
            ],
            settings.clone(),
        )
        .expect("initial fiber surface");
        let original = initial.clone();
        settings.target_arclength = 4e-3;
        settings.caps.max_rings = 4;

        let extended = extend_limit_cycle_manifold_2d(&mut system, initial, settings)
            .expect("extended fiber surface");

        assert_surface_extension_appends_without_rewriting(&original, &extended);
    }

    #[test]
    fn manifold_cycle_2d_extension_resumes_hko_fundamental_segments() {
        assert_cycle_fiber_backend_extends(ManifoldCycle2DAlgorithm::IsochronFibers);
    }

    #[test]
    fn manifold_cycle_2d_extension_resumes_segmented_preimage_fibers() {
        assert_cycle_fiber_backend_extends(ManifoldCycle2DAlgorithm::SegmentedPreimageFibers);
    }
}
