use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::SVD;
use nalgebra::DMatrix;
use num_complex::Complex;

use crate::continuation::periodic::compute_cycle_monodromy_data;
use crate::continuation::types::{
    default_manifold_alpha_max, default_manifold_alpha_min, default_manifold_delta_alpha_max,
    default_manifold_delta_alpha_min, default_manifold_delta_min, default_manifold_dt,
    default_manifold_eps, default_manifold_leaf_delta, default_manifold_ring_points,
    BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, Manifold1DSettings,
    Manifold2DProfile, Manifold2DSettings, ManifoldBounds, ManifoldCurveGeometry,
    ManifoldCycle2DSettings, ManifoldDirection, ManifoldEigenKind, ManifoldGeometry,
    ManifoldRingDiagnostic, ManifoldStability, ManifoldSurfaceGeometry,
    ManifoldSurfaceSolverDiagnostics, ManifoldTerminationCaps,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{
    compute_jacobian, compute_map_cycle_points, compute_system_jacobian, solve_equilibrium,
    NewtonSettings, SystemKind,
};
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
const LEAF_TAU_NEWTON_MAX_ITERS: usize = 24;
const LEAF_TAU_NEWTON_MAX_STEP: f64 = 0.25;
const LEAF_TAU_DERIV_FD_EPS: f64 = 1e-4;
const LEAF_PLANE_DERIV_EPS: f64 = 1e-12;
const LEAF_FIRST_HIT_BISECT_ITERS: usize = 24;
const LEAF_PLANE_BISECT_ITERS: usize = 16;
const LEAF_PLANE_TOL_FACTOR: f64 = 1e-2;
const LEAF_DISTANCE_TOL_FACTOR: f64 = 1e-2;
const LEAF_TAU_MIN_FACTOR: f64 = 1e-4;
const LEAF_TAU_INIT_ABS: f64 = 1e-2;
const LEAF_TAU_MAX_ABS: f64 = 0.5;
const LEAF_TAU_MAX_TIME_FACTOR: f64 = 0.1;
const LEAF_MAX_TIME_GROWTH: f64 = 2.0;
const LEAF_MAX_TIME_RETRIES: usize = 2;
const LEAF_DT_SHRINK: f64 = 0.5;
const LEAF_DT_RETRIES: usize = 3;
const LEAF_DT_MIN_FACTOR: f64 = 1e-3;
const LEAF_RETRY_MAX_FAILURES: usize = 4;
const LEAF_SEGMENT_SWITCH_EPS: f64 = 1e-4;
const LEAF_SEGMENT_SWITCH_MAX: usize = 64;
const RING_ADAPT_POINT_FACTOR: usize = 4;
const RING_TURN_REPARAM_TRIGGER_RAD: f64 = 170.0_f64.to_radians();
#[cfg(test)]
const RING_OUTLIER_DISPLACEMENT_FACTOR: f64 = 4.0;
#[cfg(test)]
const RING_OUTLIER_MIN_SCALE: f64 = 8.0;
#[cfg(test)]
const RING_OUTLIER_MAX_SCALE: f64 = 64.0;
#[cfg(test)]
const RING_OUTLIER_PASSES: usize = 2;
const STRIP_ARCLENGTH_TRIM_FRAC: f64 = 0.1;
const TAU_SWITCH_EPS: f64 = 1e-6;
const LEAF_SIGN_EPS_SCALE: f64 = 1e-14;
#[cfg(test)]
const SOURCE_PARAM_MONO_EPS: f64 = 1e-6;
const MANIFOLD_1D_ARCLENGTH_TOL: f64 = 1e-8;
const MANIFOLD_1D_ARCLENGTH_MAX_ITERS: usize = 96;
const MAP_MANIFOLD_REAL_TOL: f64 = 1e-8;
const MAP_MANIFOLD_SIDE_TOL: f64 = 1e-6;
const MAP_PREIMAGE_NEWTON_TOL: f64 = 1e-10;
const MAP_PREIMAGE_NEWTON_MAX_ITERS: usize = 24;
const MAP_DOMAIN_ALPHA_MAX: f64 = 0.3;
const MAP_DOMAIN_DELTA_MAX_FACTOR: f64 = 1.5;
const MAP_DOMAIN_MAX_REFINEMENT_PASSES: usize = 12;
const MAP_DOMAIN_MAX_INSERTIONS_PER_PASS: usize = 256;

#[derive(Clone)]
struct RealEigenMode {
    index: usize,
    vector: Vec<f64>,
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
    continue_manifold_eq_1d_with_kind(system, SystemKind::Flow, equilibrium_state, settings)
}

/// Compute one-dimensional stable/unstable manifolds of a flow equilibrium or map cycle.
pub fn continue_manifold_eq_1d_with_kind(
    system: &mut EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
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
            continue_manifold_eq_1d_flow(system, equilibrium_state, settings, &directions)
        }
        SystemKind::Map { iterations } => continue_manifold_eq_1d_map(
            system,
            equilibrium_state,
            settings,
            iterations,
            &directions,
        ),
    }
}

fn continue_manifold_eq_1d_flow(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
    directions: &[ManifoldDirection],
) -> Result<Vec<ContinuationBranch>> {
    let dim = system.equations.len();
    let eig = select_real_eigenmode_with_kind(
        system,
        SystemKind::Flow,
        equilibrium_state,
        settings.stability,
        settings.eig_index,
    )?;

    let sigma = stability_sigma(settings.stability);
    let mut branches = Vec::new();
    for direction in directions.iter().copied() {
        let sign = if direction == ManifoldDirection::Minus {
            -1.0
        } else {
            1.0
        };
        let mut seed = equilibrium_state.to_vec();
        for i in 0..dim {
            seed[i] += sign * settings.eps * eig.vector[i];
        }

        let mut points = vec![seed.clone()];
        let mut arclength = vec![0.0];
        let target_arclength = settings.target_arclength.max(0.0);
        let dt = settings.integration_dt.abs().max(1e-9);
        let max_time = settings.caps.max_time.max(dt);
        let solved = solve_arclength_hit_bvp(
            system,
            &seed,
            target_arclength,
            sigma,
            dt,
            max_time,
            0.0,
            MANIFOLD_1D_ARCLENGTH_TOL,
            MANIFOLD_1D_ARCLENGTH_MAX_ITERS,
            settings.bounds.as_ref(),
        )?;
        let (terminal_point, terminal_time, terminal_arclength) =
            if let Some((point, hit_time)) = solved {
                (point, hit_time, target_arclength)
            } else if let Some((point, reachable_arc)) = integrate_flow_with_arclength(
                system,
                &seed,
                sigma,
                max_time,
                dt,
                settings.bounds.as_ref(),
            ) {
                (point, max_time, reachable_arc)
            } else {
                (seed.clone(), 0.0, 0.0)
            };

        let (sampled_points, sampled_arclength) = integrate_trajectory_samples(
            system,
            &seed,
            sigma,
            terminal_time,
            dt,
            settings.caps.max_steps.max(1),
            settings.caps.max_points.max(2),
            settings.bounds.as_ref(),
        );
        if sampled_points.len() > 1 && sampled_arclength.len() == sampled_points.len() {
            points = sampled_points;
            arclength = sampled_arclength;
        }
        if let Some(last_point) = points.last_mut() {
            *last_point = terminal_point;
        }
        let previous_arc = if arclength.len() >= 2 {
            arclength[arclength.len() - 2]
        } else {
            0.0
        };
        if let Some(last_arc) = arclength.last_mut() {
            *last_arc = terminal_arclength.max(previous_arc);
        }

        branches.push(build_eq_1d_branch(
            &points,
            &arclength,
            settings.stability,
            direction,
            eig.index,
            settings.caps,
            "shooting_bvp",
            None,
            None,
        ));
    }
    Ok(branches)
}

fn continue_manifold_eq_1d_map(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    settings: Manifold1DSettings,
    map_iterations: usize,
    directions: &[ManifoldDirection],
) -> Result<Vec<ContinuationBranch>> {
    if map_iterations == 0 {
        bail!("Map iteration count must be greater than zero.");
    }

    let cycle_points = if map_iterations > 1 {
        compute_map_cycle_points(system, equilibrium_state, map_iterations)
    } else {
        vec![equilibrium_state.to_vec()]
    };
    if cycle_points.is_empty() {
        bail!("Map cycle seed generation failed: no cycle points available.");
    }
    let dim = system.equations.len();
    let representative = &cycle_points[0];
    let eig = select_real_eigenmode_with_kind(
        system,
        SystemKind::Map {
            iterations: map_iterations,
        },
        representative,
        settings.stability,
        settings.eig_index,
    )?;
    let mut branches = Vec::new();
    for direction in directions.iter().copied() {
        let sign = if direction == ManifoldDirection::Minus {
            -1.0
        } else {
            1.0
        };
        let mut seed = representative.clone();
        for i in 0..dim {
            seed[i] += sign * settings.eps * eig.vector[i];
        }

        let (base_points, base_arclength) = build_map_manifold_curve(
            system,
            &seed,
            representative,
            settings.stability,
            map_iterations,
            settings.target_arclength,
            settings.caps,
            settings.bounds.as_ref(),
        )?;

        let mut propagated_points = base_points.clone();
        for cycle_point_index in 0..map_iterations {
            let points = if cycle_point_index == 0 {
                propagated_points.clone()
            } else {
                let mapped = propagate_curve_by_map_steps(
                    system,
                    &propagated_points,
                    1,
                    settings.bounds.as_ref(),
                )
                .or_else(|| {
                    propagate_curve_by_map_steps(
                        system,
                        &base_points,
                        cycle_point_index,
                        settings.bounds.as_ref(),
                    )
                });
                let Some(points) = mapped else {
                    continue;
                };
                propagated_points = points.clone();
                points
            };
            let arclength = cycle_component_arclength(&base_arclength, points.len());

            branches.push(build_eq_1d_branch(
                &points,
                &arclength,
                settings.stability,
                direction,
                eig.index,
                settings.caps,
                "map_iterate_bvp",
                Some(map_iterations),
                Some(cycle_point_index),
            ));
        }
    }
    Ok(branches)
}

fn build_eq_1d_branch(
    points: &[Vec<f64>],
    arclength: &[f64],
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
        })
        .collect();
    let geometry = ManifoldGeometry::Curve(ManifoldCurveGeometry {
        dim,
        points_flat: flatten_points(points),
        arclength: arclength.to_vec(),
        direction,
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
    let initial_ring = build_equilibrium_initial_ring(
        equilibrium_state,
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
        Some(equilibrium_state),
        None,
        settings.bounds.as_ref(),
        on_ring_progress,
    );
    let surface = add_equilibrium_center_cap(surface, equilibrium_state);
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
            method: "leaf_shooting_bvp".to_string(),
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
        })),
    })
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
    let (cycle, floquet_dirs) = build_cycle_floquet_seed(
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
            method: "leaf_shooting_bvp".to_string(),
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
        })),
    })
}

struct SurfaceGrowthResult {
    vertices: Vec<Vec<f64>>,
    triangles: Vec<usize>,
    ring_offsets: Vec<usize>,
    ring_diagnostics: Vec<ManifoldRingDiagnostic>,
    solver_diagnostics: ManifoldSurfaceSolverDiagnostics,
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

#[derive(Clone, Copy)]
enum SurfaceTerminationReason {
    MaxRings,
    MaxVertices,
    TargetRadius,
    TargetArclength,
    BoundsExit,
    RingTooSmall,
    RingBuildFailed,
    RingSpacingFailed,
    GeodesicQualityRejected,
    RingCandidateTooSmall,
}

impl SurfaceTerminationReason {
    fn as_str(self) -> &'static str {
        match self {
            SurfaceTerminationReason::MaxRings => "max_rings",
            SurfaceTerminationReason::MaxVertices => "max_vertices",
            SurfaceTerminationReason::TargetRadius => "target_radius",
            SurfaceTerminationReason::TargetArclength => "target_arclength",
            SurfaceTerminationReason::BoundsExit => "bounds_exit",
            SurfaceTerminationReason::RingTooSmall => "ring_too_small",
            SurfaceTerminationReason::RingBuildFailed => "ring_build_failed",
            SurfaceTerminationReason::RingSpacingFailed => "ring_spacing_failed",
            SurfaceTerminationReason::GeodesicQualityRejected => "geodesic_quality_rejected",
            SurfaceTerminationReason::RingCandidateTooSmall => "ring_candidate_too_small",
        }
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
}

#[derive(Clone)]
struct RingLayer {
    points: Vec<Vec<f64>>,
    in_anchors: Vec<Vec<f64>>,
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
    InsertionLeafFailed(LeafFailureKind),
}

impl RingSpacingFailure {
    fn as_str(self) -> &'static str {
        match self {
            RingSpacingFailure::InvalidCandidate => "invalid_candidate",
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

#[derive(Clone)]
struct LeafSample {
    point: Vec<f64>,
    seg_index: usize,
    seg_tau: f64,
    radial_distance: f64,
    outward_distance: f64,
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
    e1: Vec<f64>,
    e2: Vec<f64>,
    kind: ManifoldEigenKind,
    indices: [usize; 2],
}

fn select_real_eigenmode_with_kind(
    system: &EquationSystem,
    kind: SystemKind,
    equilibrium_state: &[f64],
    stability: ManifoldStability,
    requested_index: Option<usize>,
) -> Result<RealEigenMode> {
    let result = solve_equilibrium(
        system,
        kind,
        equilibrium_state,
        NewtonSettings {
            max_steps: 8,
            damping: 1.0,
            tolerance: 1e-10,
        },
    )?;
    let mut candidates = Vec::new();
    for (idx, pair) in result.eigenpairs.iter().enumerate() {
        if pair.value.im.abs() > EIG_IM_TOL {
            continue;
        }
        if !matches_stability_for_kind(Complex::new(pair.value.re, pair.value.im), kind, stability)
        {
            continue;
        }
        let vector: Vec<f64> = pair.vector.iter().map(|entry| entry.re).collect();
        if l2_norm(&vector) <= NORM_EPS {
            continue;
        }
        candidates.push(RealEigenMode {
            index: idx,
            vector: normalize(vector)?,
        });
    }
    if candidates.is_empty() {
        bail!("No real eigenmode matches the requested manifold stability.");
    }
    if requested_index.is_none() && candidates.len() != 1 {
        bail!(
            "Expected exactly one real eigenmode for 1D manifold, found {}.",
            candidates.len()
        );
    }
    if let Some(index) = requested_index {
        if let Some(found) = candidates.into_iter().find(|mode| mode.index == index) {
            return Ok(found);
        }
        bail!(
            "Requested eigen index {} is not an eligible real mode.",
            index.saturating_add(1)
        );
    }
    Ok(candidates.remove(0))
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
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64, f64)>,
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
    let mut rings = vec![RingLayer {
        points: initial_ring,
        in_anchors: initial_inward,
    }];
    let mut ring_diagnostics = Vec::new();
    let mut accumulated_arc = 0.0;
    let mut ring_index = 0usize;
    let mut current_leaf_delta = leaf_delta.max(1e-9);
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
        progress(rings.len(), initial_vertices, 0.0, initial_radius);
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

            if geodesic_raw.max_angle > controls.alpha_max
                || geodesic_raw.max_delta_angle > controls.delta_alpha_max
            {
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
                            "ring={} attempt={} delta={:.6e}: spacing adaptation failed ({})",
                            ring_index,
                            attempt,
                            used_delta,
                            match reason {
                                RingSpacingFailure::InsertionLeafFailed(kind) => kind.as_str(),
                                _ => reason.as_str(),
                            }
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
                    SurfaceTerminationReason::GeodesicQualityRejected,
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
            if geodesic_adapt.max_delta_angle > controls.delta_alpha_max {
                solver_diagnostics.reject_geodesic_quality += 1;
                solver_diagnostics.failed_ring = Some(ring_index + 1);
                solver_diagnostics.failed_attempt = Some(attempt + 1);
                last_failure = Some((
                    SurfaceTerminationReason::GeodesicQualityRejected,
                    format!(
                        "ring={} attempt={} delta={:.6e}: post-spacing geodesic reject distance_angle={:.4e}",
                        ring_index,
                        attempt,
                        used_delta,
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
                }
                break;
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
        let next = next_solve.points;
        let next_in_anchors = next_solve.in_anchors;
        current_leaf_delta = used_delta;
        reported_leaf_delta = used_delta;
        if accepted_attempt == 0
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

        let strip_avg = average_strip_distance(prev, &next);
        accumulated_arc += strip_avg;

        let radius_estimate = if let Some(center_state) = center {
            let mut sum = 0.0;
            for point in &next {
                sum += l2_distance(point, center_state);
            }
            sum / (next.len() as f64)
        } else {
            strip_avg * ((ring_index + 1) as f64)
        };
        ring_diagnostics.push(ManifoldRingDiagnostic {
            ring_index: ring_index + 1,
            radius_estimate,
            point_count: next.len(),
        });

        rings.push(RingLayer {
            points: next,
            in_anchors: next_in_anchors,
        });
        ring_index += 1;

        let total_vertices: usize = rings.iter().map(|ring| ring.points.len()).sum();
        if let Some(progress) = on_ring_progress.as_deref_mut() {
            progress(
                rings.len(),
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
    let ring_points: Vec<Vec<Vec<f64>>> = rings.into_iter().map(|ring| ring.points).collect();
    let triangles = triangulate_ring_bands(&ring_points, &ring_offsets);
    SurfaceGrowthResult {
        vertices,
        triangles,
        ring_offsets,
        ring_diagnostics,
        solver_diagnostics,
    }
}

fn build_next_ring(
    system: &EquationSystem,
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    sigma: f64,
    leaf_delta: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<RingSolve, RingBuildFailure> {
    let m = prev_ring.len();
    let mut hits = vec![None; m];
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
        match solve_leaf_point_with_retries(
            system,
            prev_ring,
            base_point,
            s,
            &tangent,
            &outward,
            leaf_delta,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            None,
        ) {
            Ok(hit) => {
                hits[i] = Some(hit);
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
                match solve_leaf_point_with_retries(
                    system,
                    prev_ring,
                    base_point,
                    s,
                    &tangent,
                    &outward,
                    leaf_delta,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                    None,
                ) {
                    Ok(hit) => {
                        hits[i] = Some(hit);
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
    for hit in hits.into_iter() {
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
    min_spacing: f64,
    max_spacing: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    max_ring_points: usize,
) -> Result<RingSolve, RingSpacingFailure> {
    let adaptive_point_cap = max_ring_points
        .min(
            prev_ring
                .len()
                .saturating_mul(RING_ADAPT_POINT_FACTOR)
                .max(8),
        )
        .max(4);

    if raw_next.points.len() < 4
        || raw_next.base_anchors.len() != raw_next.points.len()
        || raw_next.in_anchors.len() != raw_next.points.len()
    {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    if raw_next.points.len() > adaptive_point_cap {
        return Ok(raw_next);
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
        let mut insertion_budget_exhausted = false;
        for i in 0..m {
            let j = (i + 1) % m;
            points.push(ring.points[i].clone());
            base_anchors.push(ring.base_anchors[i]);
            in_anchors.push(ring.in_anchors[i].clone());

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
            let base_s_mid = circular_midpoint(ring.base_anchors[i], ring.base_anchors[j]);
            let base_point = sample_ring_uniform(prev_ring, base_s_mid);
            let base_in_anchor = sample_ring_uniform(prev_in_anchors, base_s_mid);
            let tangent = ring_tangent_uniform(prev_ring, base_s_mid);
            let outward = outward_from_in_anchor(&base_point, &base_in_anchor, &tangent)
                .or_else(|_| canonical_orthogonal_unit(&tangent))
                .unwrap_or_else(|_| {
                    let mut fallback = vec![0.0; base_point.len()];
                    if let Some(first) = fallback.first_mut() {
                        *first = 1.0;
                    }
                    fallback
                });
            let hit = solve_leaf_point_with_retries(
                system,
                prev_ring,
                &base_point,
                base_s_mid,
                &tangent,
                &outward,
                leaf_delta,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
                None,
            );
            match hit {
                Ok(hit) => {
                    points.push(hit.point);
                    base_anchors.push(hit.base_anchor);
                    in_anchors.push(hit.in_anchor);
                }
                Err(failure) => {
                    return Err(RingSpacingFailure::InsertionLeafFailed(failure.kind));
                }
            }
            changed = true;
        }

        ring = RingSolve {
            points,
            base_anchors,
            in_anchors,
        };
        if insertion_budget_exhausted {
            return Ok(ring);
        }
        if !changed {
            return Ok(ring);
        }
    }

    if ring.points.len() < 4 {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    Ok(ring)
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
) -> GeodesicQuality {
    if next_ring.len() != prev_ring.len() {
        return GeodesicQuality::default();
    }
    let base_anchors: Vec<f64> = (0..next_ring.len())
        .map(|idx| (idx as f64) / (next_ring.len().max(1) as f64))
        .collect();
    evaluate_geodesic_quality_with_anchors(prev_ring, prev_in_anchors, next_ring, &base_anchors)
}

fn evaluate_geodesic_quality_for_solve(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next: &RingSolve,
) -> GeodesicQuality {
    if next.points.len() != next.base_anchors.len() {
        return GeodesicQuality::default();
    }
    evaluate_geodesic_quality_with_anchors(
        prev_ring,
        prev_in_anchors,
        &next.points,
        &next.base_anchors,
    )
}

fn evaluate_geodesic_quality_with_anchors(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next_ring: &[Vec<f64>],
    base_anchors: &[f64],
) -> GeodesicQuality {
    if prev_ring.is_empty()
        || prev_in_anchors.len() != prev_ring.len()
        || next_ring.len() != base_anchors.len()
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
        let strip_scale = 0.5 * (n_prev + n_next);
        quality.max_delta_angle = quality.max_delta_angle.max(alpha * strip_scale);
    }

    quality
}

fn circular_midpoint(a: f64, b: f64) -> f64 {
    let mut rhs = b;
    if rhs < a {
        rhs += 1.0;
    }
    (0.5 * (a + rhs)).rem_euclid(1.0)
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

fn average_strip_distance(prev_ring: &[Vec<f64>], next_ring: &[Vec<f64>]) -> f64 {
    if prev_ring.is_empty() || next_ring.is_empty() {
        return 0.0;
    }
    let samples = prev_ring.len().max(next_ring.len()).max(8);
    let mut distances = Vec::with_capacity(samples);
    for i in 0..samples {
        let s = (i as f64) / (samples as f64);
        let p_prev = sample_ring_uniform(prev_ring, s);
        let p_next = sample_ring_uniform(next_ring, s);
        distances.push(l2_distance(&p_prev, &p_next));
    }
    let mut finite: Vec<f64> = distances
        .into_iter()
        .filter(|value| value.is_finite())
        .collect();
    if finite.is_empty() {
        return 0.0;
    }
    finite.sort_by(|a, b| a.total_cmp(b));
    let trim = ((finite.len() as f64) * STRIP_ARCLENGTH_TRIM_FRAC) as usize;
    if trim.saturating_mul(2) >= finite.len() {
        return finite.iter().sum::<f64>() / (finite.len() as f64);
    }
    let core = &finite[trim..(finite.len() - trim)];
    core.iter().sum::<f64>() / (core.len() as f64)
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
    let curr = &ring[index % m];
    let next = &ring[(index + 1) % m];
    let left = normalize(subtract(curr, prev)).unwrap_or_else(|_| vec![0.0; curr.len()]);
    let right = normalize(subtract(next, curr)).unwrap_or_else(|_| vec![0.0; curr.len()]);
    let mut tangent = vec![0.0; curr.len()];
    for d in 0..curr.len() {
        tangent[d] = left[d] + right[d];
    }
    if l2_norm(&tangent) <= NORM_EPS {
        tangent = subtract(next, prev);
    }
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

#[cfg(test)]
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

fn canonicalize_segment_tau(tau: f64) -> f64 {
    if tau <= TAU_SWITCH_EPS {
        0.0
    } else if tau >= 1.0 - TAU_SWITCH_EPS {
        1.0
    } else {
        tau.clamp(0.0, 1.0)
    }
}

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

fn evaluate_leaf_sample_at_time(
    system: &EquationSystem,
    ring: &[Vec<f64>],
    base_point: &[f64],
    leaf_normal: &[f64],
    signed_direction: &[f64],
    tau_time: f64,
    segment_index: usize,
    segment_tau_seed: f64,
    sigma: f64,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
    plane_tol: f64,
) -> Result<LeafSample, LeafFailureKind> {
    if ring.is_empty() {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let (seg_index, seg_tau, point) = match solve_plane_root_polygon(
        system,
        ring,
        base_point,
        leaf_normal,
        tau_time,
        segment_index,
        segment_tau_seed,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
        plane_tol,
    ) {
        Ok((seg, tau, _start, point)) => (seg, tau, point),
        Err(LeafFailureKind::PlaneSolveNoConvergence) => {
            // Fallback for first-ring robustness: if strict projection fails, keep the
            // seeded segment parameterization and evaluate the leaf from that startpoint.
            let seg = segment_index % ring.len();
            let tau = canonicalize_segment_tau(segment_tau_seed.clamp(0.0, 1.0));
            let (start, _dldt) = segment_point_with_derivative(ring, seg, tau);
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
            (seg, tau, point)
        }
        Err(reason) => return Err(reason),
    };
    let offset = subtract(&point, base_point);
    let radial_distance = l2_norm(&offset);
    let outward_distance = signed_distance_with_direction(signed_direction, &offset);
    Ok(LeafSample {
        point,
        seg_index,
        seg_tau,
        radial_distance,
        outward_distance,
    })
}

fn leaf_sample_reaches_delta(sample: &LeafSample, leaf_delta: f64, outward_tol: f64) -> bool {
    sample.radial_distance >= leaf_delta && sample.outward_distance >= -outward_tol
}

fn leaf_delta_error(sample: &LeafSample, leaf_delta: f64) -> f64 {
    (sample.radial_distance - leaf_delta).abs()
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
    let mut time_cap = max_time.max(dt.max(1e-9));
    let max_time_cap = max_time.max(dt.max(1e-9)) * 8.0;
    let mut dt_try = dt.max(1e-9);
    let dt_min = (dt.abs() * LEAF_DT_MIN_FACTOR).max(1e-9);
    let mut time_retries = 0usize;
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
                if failure.kind == LeafFailureKind::NoFirstHitWithinMaxTime
                    && time_retries < LEAF_MAX_TIME_RETRIES
                    && time_cap + 1e-12 < max_time_cap
                {
                    time_cap = (time_cap * LEAF_MAX_TIME_GROWTH)
                        .max(time_cap + dt_try.max(1e-9))
                        .min(max_time_cap);
                    time_retries += 1;
                    continue;
                }
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
    let min_tau_step = (dt * LEAF_TAU_MIN_FACTOR).max(1e-9);
    let tau_step_cap = (max_time * LEAF_TAU_MAX_TIME_FACTOR)
        .max(LEAF_TAU_INIT_ABS)
        .min(LEAF_TAU_MAX_ABS);
    let mut tau_step = dt.max(LEAF_TAU_INIT_ABS).min(tau_step_cap);
    let (mut seg_idx, mut seg_tau) = uniform_s_to_segment_tau(ring.len(), base_s);
    let plane_tol = (leaf_delta * LEAF_PLANE_TOL_FACTOR).max(1e-8);
    let dist_tol = (leaf_delta * LEAF_DISTANCE_TOL_FACTOR).max(1e-8);
    let outward_tol = (leaf_delta * 1e-6).max(1e-10);
    let mut prev_time = 0.0;
    let mut prev_sample = LeafSample {
        point: base_point.to_vec(),
        seg_index: seg_idx,
        seg_tau,
        radial_distance: 0.0,
        outward_distance: 0.0,
    };

    while prev_time < max_time {
        let tau_time = (prev_time + tau_step).min(max_time);
        let curr_sample = match evaluate_leaf_sample_at_time(
            system,
            ring,
            base_point,
            &leaf_normal,
            &signed_direction,
            tau_time,
            seg_idx,
            seg_tau,
            sigma,
            dt,
            max_steps_per_leaf,
            max_time,
            plane_tol,
        ) {
            Ok(sample) => sample,
            Err(reason) => {
                if tau_step > min_tau_step {
                    tau_step = (tau_step * 0.5).max(min_tau_step);
                    continue;
                }
                return Err(LeafFailure {
                    kind: reason,
                    last_time: tau_time,
                    last_segment: seg_idx,
                    last_tau: seg_tau,
                });
            }
        };

        if !leaf_sample_reaches_delta(&prev_sample, leaf_delta, outward_tol)
            && leaf_sample_reaches_delta(&curr_sample, leaf_delta, outward_tol)
        {
            let mut left_time = prev_time;
            let mut right_time = tau_time;
            let mut left_sample = prev_sample.clone();
            let mut right_sample = curr_sample.clone();

            for _ in 0..LEAF_FIRST_HIT_BISECT_ITERS {
                let mid_time = 0.5 * (left_time + right_time);
                let alpha = if right_time > left_time {
                    (mid_time - left_time) / (right_time - left_time)
                } else {
                    0.5
                };
                let (seed_seg, seed_tau) = if alpha < 0.5 {
                    (left_sample.seg_index, left_sample.seg_tau)
                } else {
                    (right_sample.seg_index, right_sample.seg_tau)
                };
                let mid_sample = match evaluate_leaf_sample_at_time(
                    system,
                    ring,
                    base_point,
                    &leaf_normal,
                    &signed_direction,
                    mid_time,
                    seed_seg,
                    seed_tau,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                    plane_tol,
                ) {
                    Ok(sample) => sample,
                    Err(_) => {
                        right_time = mid_time;
                        continue;
                    }
                };

                if leaf_sample_reaches_delta(&mid_sample, leaf_delta, outward_tol) {
                    right_time = mid_time;
                    right_sample = mid_sample.clone();
                } else {
                    left_time = mid_time;
                    left_sample = mid_sample.clone();
                }

                if leaf_sample_reaches_delta(&mid_sample, leaf_delta, outward_tol)
                    && leaf_delta_error(&mid_sample, leaf_delta) <= dist_tol
                {
                    return Ok(LeafHit {
                        point: mid_sample.point,
                        tau_hit: mid_time,
                        base_anchor: base_s.rem_euclid(1.0),
                        in_anchor: base_point.to_vec(),
                    });
                }
            }

            if leaf_sample_reaches_delta(&right_sample, leaf_delta, outward_tol)
                && leaf_delta_error(&right_sample, leaf_delta) <= 10.0 * dist_tol
            {
                return Ok(LeafHit {
                    point: right_sample.point,
                    tau_hit: right_time,
                    base_anchor: base_s.rem_euclid(1.0),
                    in_anchor: base_point.to_vec(),
                });
            }
            // Robust fallback: if we bracketed the first outward Euclidean hit but
            // refinement could not satisfy a tight distance tolerance, keep the
            // reached endpoint rather than accepting a below-delta point.
            if leaf_sample_reaches_delta(&right_sample, leaf_delta, outward_tol) {
                return Ok(LeafHit {
                    point: right_sample.point,
                    tau_hit: right_time,
                    base_anchor: base_s.rem_euclid(1.0),
                    in_anchor: base_point.to_vec(),
                });
            }
            return Err(LeafFailure {
                kind: LeafFailureKind::PlaneRootNotBracketed,
                last_time: left_time,
                last_segment: left_sample.seg_index,
                last_tau: left_sample.seg_tau,
            });
        }

        prev_time = tau_time;
        seg_idx = curr_sample.seg_index;
        seg_tau = curr_sample.seg_tau;
        prev_sample = curr_sample;
        tau_step = (tau_step * 1.25).min(tau_step_cap);
        if tau_time >= max_time {
            break;
        }
    }
    Err(LeafFailure {
        kind: LeafFailureKind::NoFirstHitWithinMaxTime,
        last_time: prev_time,
        last_segment: seg_idx,
        last_tau: seg_tau,
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

#[cfg(test)]
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
        let mut best_i = 0usize;
        let mut best_j = 0usize;
        let mut best_dist = f64::INFINITY;
        for (i, a_point) in a_ring.iter().enumerate() {
            for (j, b_point) in b_ring.iter().enumerate() {
                let distance = l2_distance(a_point, b_point);
                if distance < best_dist {
                    best_dist = distance;
                    best_i = i;
                    best_j = j;
                }
            }
        }

        let a_order: Vec<usize> = (0..m).map(|step| (best_i + step) % m).collect();
        let b_order: Vec<usize> = (0..n).map(|step| (best_j + step) % n).collect();
        let a_alpha = ring_progress_from_start(&normalized_ring_arclength_params(a_ring), best_i);
        let b_beta = ring_progress_from_start(&normalized_ring_arclength_params(b_ring), best_j);

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
                a_alpha[advanced_a + 1] <= b_beta[advanced_b + 1]
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
        });
    }
    points
}

#[derive(Clone, Default)]
struct DecodedCycleProfile {
    mesh_points: Vec<Vec<f64>>,
    points: Vec<Vec<f64>>,
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

    let mut points = build_phase_ordered_cycle_profile(&mesh_points, &stage_points, ncol);
    if points.len() < 4 {
        points = if mesh_points.len() >= 4 {
            mesh_points.clone()
        } else {
            raw.chunks(dim)
                .filter(|chunk| chunk.len() == dim)
                .map(|chunk| chunk.to_vec())
                .collect()
        };
    }

    DecodedCycleProfile {
        mesh_points,
        points,
        period,
    }
}

fn build_phase_ordered_cycle_profile(
    mesh_points: &[Vec<f64>],
    stage_points: &[Vec<f64>],
    ncol: usize,
) -> Vec<Vec<f64>> {
    if mesh_points.is_empty() {
        return stage_points.to_vec();
    }
    if mesh_points.len() == 1 {
        return mesh_points.to_vec();
    }

    let mut points = Vec::with_capacity(mesh_points.len().saturating_mul(ncol.saturating_add(1)));
    points.push(mesh_points[0].clone());
    for interval in 0..mesh_points.len() {
        let stage_offset = interval.saturating_mul(ncol);
        for stage in 0..ncol {
            if let Some(point) = stage_points.get(stage_offset + stage) {
                points.push(point.clone());
            }
        }
        if interval + 1 < mesh_points.len() {
            points.push(mesh_points[interval + 1].clone());
        }
    }
    if points.len() < mesh_points.len() {
        mesh_points.to_vec()
    } else {
        points
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
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>) {
    if ring.is_empty() || vectors.is_empty() || points == 0 {
        return (Vec::new(), Vec::new());
    }
    if ring.len() != vectors.len() {
        let ring_resampled = resample_closed_ring(ring, points);
        let mut vec_resampled = resample_closed_ring(vectors, points);
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
        let mut direction = lerp(&vectors[seg], &vectors[next], alpha);
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

fn build_cycle_floquet_seed_from_monodromy(
    system: &mut EquationSystem,
    cycle_state: &[f64],
    profile: &DecodedCycleProfile,
    ntst: usize,
    ncol: usize,
    parameter_index: usize,
    multiplier: Complex<f64>,
    ring_points: usize,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>)> {
    let monodromy_data =
        compute_cycle_monodromy_data(system, parameter_index, cycle_state, ntst, ncol)?;
    let closest_mu_error = monodromy_data
        .monodromy
        .complex_eigenvalues()
        .iter()
        .map(|value| (*value - multiplier).norm())
        .fold(f64::INFINITY, f64::min);
    let mu_scale = multiplier.norm().max(1.0);
    let mu_tol = 1e-3 + 1e-2 * mu_scale;
    if closest_mu_error.is_finite()
        && closest_mu_error > mu_tol
        && std::env::var("FORK_MANIFOLD_DEBUG").is_ok()
    {
        eprintln!(
            "cycle manifold warning: selected multiplier {:.6e}+{:.6e}i differs from extracted monodromy spectrum (closest error {:.3e}, tol {:.3e})",
            multiplier.re,
            multiplier.im,
            closest_mu_error,
            mu_tol
        );
    }
    let v0 = floquet_real_vector_from_monodromy(&monodromy_data.monodromy, multiplier.re)?;
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
    );
    Ok((ring, dirs))
}

fn build_cycle_floquet_seed_variational(
    system: &EquationSystem,
    profile: &DecodedCycleProfile,
    multiplier: Complex<f64>,
    ring_points: usize,
    dt: f64,
    max_steps_per_leaf: usize,
    max_time: f64,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>)> {
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
    let (_, phi_t) = integrate_state_and_variational(
        system,
        &start,
        period,
        1.0,
        dt.max(1e-9),
        max_steps_per_leaf.max(2),
        period,
    )
    .ok_or_else(|| anyhow!("Variational fallback failed to integrate monodromy."))?;
    let dim = start.len();
    let monodromy = DMatrix::from_row_slice(dim, dim, &phi_t);
    let v0 = floquet_real_vector_from_monodromy(&monodromy, multiplier.re)?;
    let mut profile_dirs = Vec::with_capacity(profile.points.len());
    for i in 0..profile.points.len() {
        let tau = period * (i as f64) / (profile.points.len() as f64);
        let (_, phi_tau) = integrate_state_and_variational(
            system,
            &start,
            tau,
            1.0,
            dt.max(1e-9),
            max_steps_per_leaf.max(2),
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
    );
    Ok((ring, dirs))
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
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>)> {
    if let Some(index) = parameter_index {
        if index < system.params.len() {
            if let Ok(seed) = build_cycle_floquet_seed_from_monodromy(
                system,
                cycle_state,
                profile,
                ntst,
                ncol,
                index,
                multiplier,
                ring_points,
            ) {
                return Ok(seed);
            }
        }
    }
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

fn integrate_flow_with_arclength(
    system: &EquationSystem,
    initial_state: &[f64],
    sigma: f64,
    time: f64,
    dt: f64,
    bounds: Option<&ManifoldBounds>,
) -> Option<(Vec<f64>, f64)> {
    if time <= 0.0 {
        return Some((initial_state.to_vec(), 0.0));
    }
    let steps = (time / dt.max(1e-9)).ceil().max(1.0) as usize;
    let h = time / (steps as f64);
    let mut state = initial_state.to_vec();
    let mut arc = 0.0;
    for _ in 0..steps {
        let prev = state.clone();
        rk4_step(system, &mut state, h, sigma);
        if state.iter().any(|value| !value.is_finite()) {
            return None;
        }
        if let Some(box_bounds) = bounds {
            if !inside_bounds(&state, box_bounds) {
                return None;
            }
        }
        arc += l2_distance(&prev, &state);
    }
    Some((state, arc))
}

fn integrate_trajectory_samples(
    system: &EquationSystem,
    initial_state: &[f64],
    sigma: f64,
    time: f64,
    dt: f64,
    max_steps: usize,
    max_points: usize,
    bounds: Option<&ManifoldBounds>,
) -> (Vec<Vec<f64>>, Vec<f64>) {
    let mut points = vec![initial_state.to_vec()];
    let mut arclength = vec![0.0];
    if time <= 0.0 || max_points <= 1 {
        return (points, arclength);
    }

    let nominal_steps = (time / dt.max(1e-9)).ceil().max(1.0) as usize;
    let step_cap = max_steps.max(1).min(max_points.saturating_sub(1).max(1));
    let steps = nominal_steps.min(step_cap).max(1);
    let h = time / (steps as f64);

    let mut state = initial_state.to_vec();
    let mut cumulative = 0.0;
    for _ in 0..steps {
        let prev = state.clone();
        rk4_step(system, &mut state, h, sigma);
        if state.iter().any(|value| !value.is_finite()) {
            break;
        }
        if let Some(box_bounds) = bounds {
            if !inside_bounds(&state, box_bounds) {
                break;
            }
        }
        cumulative += l2_distance(&prev, &state);
        points.push(state.clone());
        arclength.push(cumulative);
        if points.len() >= max_points {
            break;
        }
    }
    (points, arclength)
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
) -> Result<(Vec<Vec<f64>>, Vec<f64>)> {
    if representative_point.len() != seed.len() {
        bail!("Map manifold representative point dimension mismatch.");
    }
    if map_step_iterations == 0 {
        bail!("Map manifold step iterations must be greater than zero.");
    }

    let target = target_arclength.max(0.0);
    let max_points = caps.max_points.max(2);
    let step_limit = caps.max_iterations.unwrap_or(caps.max_steps).max(1);
    let domain_subdivisions = ((max_points as f64).sqrt().round() as usize).clamp(8, 32);

    let domain_end = match stability {
        ManifoldStability::Unstable => {
            match apply_map_iterates(system, seed, map_step_iterations) {
                Some(mapped) => mapped,
                None => return Ok((vec![seed.to_vec()], vec![0.0])),
            }
        }
        ManifoldStability::Stable => {
            let preimage = solve_map_preimage_newton(
                system,
                seed,
                representative_point,
                representative_point,
                representative_point,
                map_step_iterations,
            )?;
            let Some(value) = preimage else {
                return Ok((vec![seed.to_vec()], vec![0.0]));
            };
            value
        }
    };
    if domain_end.iter().any(|value| !value.is_finite()) {
        return Ok((vec![seed.to_vec()], vec![0.0]));
    }

    let mut domain_samples = Vec::with_capacity(domain_subdivisions + 1);
    for sub in 0..=domain_subdivisions {
        let alpha = (sub as f64) / (domain_subdivisions as f64);
        domain_samples.push(lerp(seed, &domain_end, alpha));
    }
    let initial_domain_arc = polyline_arclength(&domain_samples);
    let mut spacing_target = if target > 0.0 && max_points > 1 {
        target / ((max_points - 1) as f64)
    } else {
        initial_domain_arc / (domain_subdivisions as f64)
    };
    if !spacing_target.is_finite() || spacing_target <= NORM_EPS {
        spacing_target = (initial_domain_arc / (domain_subdivisions as f64)).max(1e-6);
    }
    spacing_target = spacing_target.max(1e-9);

    let mut points = vec![domain_samples[0].clone()];
    let mut arclength = vec![0.0];
    if let Some(box_bounds) = bounds {
        if !inside_bounds(&points[0], box_bounds) {
            return Ok((points, arclength));
        }
    }
    let mut cumulative_arc = 0.0;

    for sample in domain_samples.iter().skip(1) {
        if sample.iter().any(|value| !value.is_finite()) {
            return Ok((points, arclength));
        }
        if let Some(box_bounds) = bounds {
            if !inside_bounds(sample, box_bounds) {
                return Ok((points, arclength));
            }
        }
        let last_point = points.last().cloned().unwrap_or_else(|| sample.clone());
        let step_arc = l2_distance(&last_point, sample);
        if !step_arc.is_finite() {
            return Ok((points, arclength));
        }
        if target > 0.0 && cumulative_arc + step_arc >= target && step_arc > NORM_EPS {
            let alpha_hit = ((target - cumulative_arc) / step_arc).clamp(0.0, 1.0);
            points.push(lerp(&last_point, sample, alpha_hit));
            arclength.push(target);
            return Ok((points, arclength));
        }
        cumulative_arc += step_arc;
        points.push(sample.clone());
        arclength.push(cumulative_arc);
        if points.len() >= max_points || (target > 0.0 && cumulative_arc >= target) {
            return Ok((points, arclength));
        }
    }

    for _ in 1..step_limit {
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
                    let Some(value) = apply_map_iterates(system, q, map_step_iterations) else {
                        failed = true;
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
                        prev_mapped
                            .iter()
                            .zip(q.iter().zip(prev_q.iter()))
                            .map(|(value, (q_value, prev_q_value))| {
                                value + (q_value - prev_q_value)
                            })
                            .collect::<Vec<_>>()
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
                    )?;
                    let Some(value) = preimage else {
                        failed = true;
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
                    break;
                }
            }

            previous_q = Some(q.clone());
            previous_mapped = Some(mapped.clone());
            next_samples.push(mapped);
        }

        if failed || next_samples.len() != domain_samples.len() {
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
            )?;
        }

        for mapped in next_samples.iter().skip(1) {
            let last_point = points.last().cloned().unwrap_or_else(|| mapped.clone());
            let step_arc = l2_distance(&last_point, mapped);
            if !step_arc.is_finite() {
                failed = true;
                break;
            }
            if target > 0.0 && cumulative_arc + step_arc >= target && step_arc > NORM_EPS {
                let alpha_hit = ((target - cumulative_arc) / step_arc).clamp(0.0, 1.0);
                points.push(lerp(&last_point, mapped, alpha_hit));
                arclength.push(target);
                return Ok((points, arclength));
            }
            cumulative_arc += step_arc;
            points.push(mapped.clone());
            arclength.push(cumulative_arc);
            if points.len() >= max_points || (target > 0.0 && cumulative_arc >= target) {
                return Ok((points, arclength));
            }
        }
        if failed {
            break;
        }

        if target <= 0.0 && next_samples.len() >= 2 {
            let current_avg =
                polyline_arclength(&next_samples) / ((next_samples.len().saturating_sub(1)) as f64);
            if current_avg.is_finite() && current_avg > 0.0 {
                spacing_target = spacing_target.max(0.5 * current_avg);
            }
        }

        domain_samples = next_samples;
    }

    Ok((points, arclength))
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
        for idx in insertion_indices {
            let insert_at = idx + offset;
            if insert_at + 1 >= domain_samples.len() || insert_at + 1 >= mapped_samples.len() {
                continue;
            }
            let q_mid = lerp(
                &domain_samples[insert_at],
                &domain_samples[insert_at + 1],
                0.5,
            );
            let mapped_mid = match stability {
                ManifoldStability::Unstable => {
                    let Some(value) = apply_map_iterates(system, &q_mid, map_step_iterations)
                    else {
                        continue;
                    };
                    value
                }
                ManifoldStability::Stable => {
                    let guess = lerp(
                        &mapped_samples[insert_at],
                        &mapped_samples[insert_at + 1],
                        0.5,
                    );
                    let preimage = solve_map_preimage_newton(
                        system,
                        &q_mid,
                        &guess,
                        representative_point,
                        representative_point,
                        map_step_iterations,
                    )?;
                    let Some(value) = preimage else {
                        continue;
                    };
                    value
                }
            };
            if mapped_mid.iter().any(|value| !value.is_finite()) {
                continue;
            }
            if let Some(box_bounds) = bounds {
                if !inside_bounds(&mapped_mid, box_bounds) {
                    continue;
                }
            }
            domain_samples.insert(insert_at + 1, q_mid);
            mapped_samples.insert(insert_at + 1, mapped_mid);
            offset += 1;
            inserted += 1;
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
) -> Vec<usize> {
    if mapped_samples.len() < 2 {
        return Vec::new();
    }
    let mut intervals = Vec::new();
    for i in 0..(mapped_samples.len() - 1) {
        let delta = l2_distance(&mapped_samples[i], &mapped_samples[i + 1]);
        if delta.is_finite() && delta > delta_max {
            intervals.push(i);
        }
    }
    if mapped_samples.len() >= 3 {
        for i in 1..(mapped_samples.len() - 1) {
            let delta_prev = l2_distance(&mapped_samples[i - 1], &mapped_samples[i]);
            let delta_next = l2_distance(&mapped_samples[i], &mapped_samples[i + 1]);
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

fn map_turn_angle(prev: &[f64], current: &[f64], next: &[f64]) -> f64 {
    let v0 = subtract(prev, current);
    let v1 = subtract(next, current);
    let n0 = l2_norm(&v0);
    let n1 = l2_norm(&v1);
    if n0 <= NORM_EPS || n1 <= NORM_EPS {
        return 0.0;
    }
    let cos_theta = (dot(&v0, &v1) / (n0 * n1)).clamp(-1.0, 1.0);
    cos_theta.acos()
}

fn polyline_arclength(points: &[Vec<f64>]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }
    points
        .windows(2)
        .map(|segment| l2_distance(&segment[0], &segment[1]))
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

fn apply_map_iterates(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
) -> Option<Vec<f64>> {
    if iterations == 0 {
        return Some(state.to_vec());
    }
    let mut current = state.to_vec();
    let mut mapped = vec![0.0; state.len()];
    for _ in 0..iterations {
        system.apply(0.0, &current, &mut mapped);
        if mapped.iter().any(|value| !value.is_finite()) {
            return None;
        }
        std::mem::swap(&mut current, &mut mapped);
    }
    Some(current)
}

fn propagate_curve_by_map_steps(
    system: &EquationSystem,
    base_points: &[Vec<f64>],
    steps: usize,
    bounds: Option<&ManifoldBounds>,
) -> Option<Vec<Vec<f64>>> {
    if base_points.is_empty() {
        return Some(Vec::new());
    }
    if steps == 0 {
        return Some(base_points.to_vec());
    }
    let mut out = Vec::with_capacity(base_points.len());
    for point in base_points {
        let mapped = apply_map_iterates(system, point, steps)?;
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

    let step_jacobian = compute_system_jacobian(
        system,
        SystemKind::Map {
            iterations: map_iterations,
        },
        prev_cycle_point,
    )?;
    let rhs = subtract(target, current_cycle_point);
    let linearized_guess =
        if let Some(offset) = solve_dense_linear_system(dim, &step_jacobian, &rhs) {
            prev_cycle_point
                .iter()
                .zip(offset.iter())
                .map(|(base, delta)| base + delta)
                .collect::<Vec<_>>()
        } else {
            prev_cycle_point.to_vec()
        };
    let mut guess = if initial_guess.iter().all(|value| value.is_finite()) {
        initial_guess.to_vec()
    } else {
        linearized_guess
    };

    let mut map_value = vec![0.0; dim];
    for _ in 0..MAP_PREIMAGE_NEWTON_MAX_ITERS {
        let Some(value) = apply_map_iterates(system, &guess, map_iterations) else {
            return Ok(None);
        };
        map_value = value;
        let residual: Vec<f64> = map_value
            .iter()
            .zip(target.iter())
            .map(|(value, target_value)| value - target_value)
            .collect();
        let residual_norm = l2_norm(&residual);
        if residual_norm <= MAP_PREIMAGE_NEWTON_TOL {
            return Ok(Some(guess));
        }

        let jacobian = compute_system_jacobian(
            system,
            SystemKind::Map {
                iterations: map_iterations,
            },
            &guess,
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
            if candidate.iter().any(|value| !value.is_finite()) {
                step_scale *= 0.5;
                continue;
            }
            let Some(value) = apply_map_iterates(system, &candidate, map_iterations) else {
                step_scale *= 0.5;
                continue;
            };
            map_value = value;
            let candidate_residual = map_value
                .iter()
                .zip(target.iter())
                .map(|(value, target_value)| (value - target_value) * (value - target_value))
                .sum::<f64>()
                .sqrt();
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

    let Some(value) = apply_map_iterates(system, &guess, map_iterations) else {
        return Ok(None);
    };
    map_value = value;
    let residual_norm = map_value
        .iter()
        .zip(target.iter())
        .map(|(value, target_value)| (value - target_value) * (value - target_value))
        .sum::<f64>()
        .sqrt();
    if residual_norm <= 1e-7 {
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

fn solve_arclength_hit_bvp(
    system: &EquationSystem,
    seed: &[f64],
    target_arclength: f64,
    sigma: f64,
    dt: f64,
    max_time: f64,
    min_time: f64,
    tolerance: f64,
    max_iterations: usize,
    bounds: Option<&ManifoldBounds>,
) -> Result<Option<(Vec<f64>, f64)>> {
    let target_arclength = target_arclength.max(0.0);
    let min_time = min_time.max(0.0).min(max_time);
    let Some((mut x_lo, arc_lo)) =
        integrate_flow_with_arclength(system, seed, sigma, min_time, dt, bounds)
    else {
        return Ok(None);
    };
    let mut t_lo = min_time;
    let mut g_lo = arc_lo - target_arclength;
    if g_lo >= 0.0 {
        return Ok(Some((x_lo, t_lo)));
    }

    let mut t_hi = (t_lo + dt.max(1e-6)).min(max_time);
    if t_hi <= t_lo {
        return Ok(None);
    }
    let Some((mut x_hi, arc_hi)) =
        integrate_flow_with_arclength(system, seed, sigma, t_hi, dt, bounds)
    else {
        return Ok(None);
    };
    let mut g_hi = arc_hi - target_arclength;
    let mut bracketed = g_hi >= 0.0;
    while !bracketed && t_hi < max_time {
        t_lo = t_hi;
        x_lo = x_hi;
        g_lo = g_hi;
        t_hi = (t_hi * 2.0).min(max_time);
        let Some((next_x_hi, next_arc_hi)) =
            integrate_flow_with_arclength(system, seed, sigma, t_hi, dt, bounds)
        else {
            return Ok(None);
        };
        x_hi = next_x_hi;
        g_hi = next_arc_hi - target_arclength;
        bracketed = g_hi >= 0.0;
    }
    if !bracketed {
        return Ok(None);
    }

    let tol = tolerance.max(1e-10);
    for _ in 0..max_iterations.max(8) {
        let t_mid = 0.5 * (t_lo + t_hi);
        let Some((x_mid, arc_mid)) =
            integrate_flow_with_arclength(system, seed, sigma, t_mid, dt, bounds)
        else {
            return Ok(None);
        };
        let g_mid = arc_mid - target_arclength;
        if g_mid.abs() <= tol || (t_hi - t_lo).abs() <= tol {
            return Ok(Some((x_mid, t_mid)));
        }
        if g_lo * g_mid <= 0.0 {
            t_hi = t_mid;
            x_hi = x_mid;
            g_hi = g_mid;
        } else {
            t_lo = t_mid;
            x_lo = x_mid;
            g_lo = g_mid;
        }
    }

    if g_hi.abs() < g_lo.abs() {
        Ok(Some((x_hi, t_hi)))
    } else {
        Ok(Some((x_lo, t_lo)))
    }
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
    fn manifold_eq_1d_map_cycle_fanout_emits_per_point_and_direction() {
        let mut system = build_system(&["2*x"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 3 },
            &[0.0],
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
        assert_eq!(branches.len(), 6);
        let mut seen_plus = [false; 3];
        let mut seen_minus = [false; 3];
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
            assert_eq!(*map_iterations, Some(3));
            let idx = cycle_point_index.expect("map manifold branch should include cycle index");
            assert!(idx < 3);
            match direction {
                ManifoldDirection::Plus => seen_plus[idx] = true,
                ManifoldDirection::Minus => seen_minus[idx] = true,
                ManifoldDirection::Both => panic!("unexpected Both direction for emitted branch"),
            }
        }
        for idx in 0..3 {
            assert!(seen_plus[idx], "missing plus branch for cycle point {idx}");
            assert!(
                seen_minus[idx],
                "missing minus branch for cycle point {idx}"
            );
        }
    }

    #[test]
    fn manifold_eq_1d_map_cycle_branches_propagate_from_representative_curve() {
        let mut system = build_system(&["1.5*x + 0.1"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[0.0],
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
            assert!(
                (rep_point.param_value - propagated_point.param_value).abs() <= 1e-12,
                "expected cycle phase branch to reuse representative arclength parameterization"
            );
        }
    }

    #[test]
    fn manifold_eq_1d_map_cycle_stable_branches_reuse_representative_arclength() {
        let mut system = build_system(&["0.6*x + 0.1"], &["x"], &[]);
        let branches = continue_manifold_eq_1d_with_kind(
            &mut system,
            SystemKind::Map { iterations: 2 },
            &[0.0],
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
        for (rep_point, propagated_point) in rep_branch
            .points
            .iter()
            .zip(propagated_branch.points.iter())
        {
            assert!(
                (rep_point.param_value - propagated_point.param_value).abs() <= 1e-12,
                "expected stable cycle phase branch to reuse representative arclength parameterization"
            );
        }
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
            .first()
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
            branch.points.len() > 20,
            "expected dense map sampling between iterates, got {} points",
            branch.points.len()
        );
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
        };
        let adapted = adapt_ring_spacing(
            &system,
            &prev_ring,
            &prev_in_anchors,
            raw_next,
            1.0,
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
        let qa = evaluate_geodesic_quality(&prev_a, &prev_prev_a, &next_a);
        let qb = evaluate_geodesic_quality(&prev_b, &prev_prev_b, &next_b);
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
            &[Complex::new(1.25, 0.0), Complex::new(1.0, 0.0)],
            ManifoldCycle2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 0.02,
                leaf_delta: 0.03,
                ring_points: mesh_count,
                target_arclength: 1.0,
                ntst,
                ncol,
                caps: ManifoldTerminationCaps {
                    max_rings: 6,
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
                &[Complex::new(1.25, 0.0), Complex::new(1.0, 0.0)],
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
        let both = run(ManifoldDirection::Both);

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
        let both_count = get_first_ring_count(&both);
        assert_eq!(plus_count, 10, "plus should seed one sheet");
        assert_eq!(minus_count, 10, "minus should seed one sheet");
        assert_eq!(both_count, 20, "both should seed both sheets");
    }

    #[test]
    fn manifold_cycle_2d_negative_multiplier_uses_double_cover_initial_ring() {
        let mut system = build_system(&["-y", "x", "-0.2*z"], &["x", "y", "z"], &[]);
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

        let settings = ManifoldCycle2DSettings {
            stability: ManifoldStability::Unstable,
            initial_radius: 0.02,
            leaf_delta: 0.005,
            ring_points: 10,
            target_arclength: 0.5,
            ntst,
            ncol,
            caps: ManifoldTerminationCaps {
                max_rings: 2,
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
            &[Complex::new(-1.3, 0.0), Complex::new(1.0, 0.0)],
            settings,
        )
        .expect("cycle manifold with negative multiplier");

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        let vertex_count = surface.vertices_flat.len() / 3;
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
        for interval in 0..ntst {
            for stage in 0..ncol {
                let frac = (stage as f64 + 1.0) / ((ncol + 1) as f64);
                let theta = (interval as f64 + frac) * std::f64::consts::TAU / (ntst as f64);
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
            !diagnostics.min_leaf_delta_reached,
            "Lorenz global profile should not collapse to the leaf-delta floor: detail={:?}",
            diagnostics.termination_detail
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
}
