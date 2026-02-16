use anyhow::{anyhow, bail, Result};
use num_complex::Complex;

use crate::continuation::types::{
    BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, Manifold1DSettings,
    Manifold2DProfile, Manifold2DSettings, ManifoldBounds, ManifoldCurveGeometry,
    ManifoldCycle2DSettings, ManifoldDirection, ManifoldEigenKind, ManifoldGeometry,
    ManifoldRingDiagnostic, ManifoldStability, ManifoldSurfaceGeometry,
    ManifoldSurfaceSolverDiagnostics,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, solve_equilibrium, NewtonSettings, SystemKind};
use crate::traits::DynamicalSystem;

const EIG_IM_TOL: f64 = 1e-8;
const NORM_EPS: f64 = 1e-12;
const DEFAULT_MESH_MIN_EDGE_FACTOR: f64 = 0.25;
const DEFAULT_MESH_MAX_EDGE_FACTOR: f64 = 1.0;
const DEFAULT_GEODESIC_ALPHA_MIN: f64 = 0.3;
const DEFAULT_GEODESIC_ALPHA_MAX: f64 = 0.4;
const DEFAULT_GEODESIC_DELTA_ALPHA_MIN: f64 = 0.1;
const DEFAULT_GEODESIC_DELTA_ALPHA_MAX: f64 = 1.0;
const LOW_TURN_ANGLE_RAD: f64 = 0.15;
const LOW_DISTANCE_ANGLE: f64 = 0.02;
const LEAF_DELTA_SHRINK: f64 = 0.5;
const LEAF_DELTA_GROW: f64 = 2.0;
const LEAF_REFINE_ATTEMPTS: usize = 12;
const LEAF_TAU_NEWTON_MAX_ITERS: usize = 24;
const LEAF_TAU_NEWTON_MAX_STEP: f64 = 0.25;
const LEAF_PLANE_DERIV_EPS: f64 = 1e-12;
const LEAF_FIRST_HIT_BISECT_ITERS: usize = 24;
const LEAF_PLANE_BISECT_ITERS: usize = 16;
const LEAF_PLANE_TOL_FACTOR: f64 = 1e-2;
const LEAF_DISTANCE_TOL_FACTOR: f64 = 1e-2;
const LEAF_TAU_MIN_FACTOR: f64 = 1e-4;
const LEAF_TAU_INIT_ABS: f64 = 1e-2;
const LEAF_TAU_MAX_ABS: f64 = 0.5;
const LEAF_TAU_MAX_TIME_FACTOR: f64 = 0.1;
const LEAF_SEGMENT_SWITCH_EPS: f64 = 1e-4;
const LEAF_SEGMENT_SWITCH_MAX: usize = 64;
const LEAF_SIGN_EPS_SCALE: f64 = 1e-14;
#[cfg(test)]
const SOURCE_PARAM_MONO_EPS: f64 = 1e-6;
const MANIFOLD_1D_ARCLENGTH_TOL: f64 = 1e-8;
const MANIFOLD_1D_ARCLENGTH_MAX_ITERS: usize = 96;

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
    let eig = select_real_eigenmode(
        system,
        equilibrium_state,
        settings.stability,
        settings.eig_index,
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

    let sigma = stability_sigma(settings.stability);
    let mut branches = Vec::new();
    for direction in directions {
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

        let branch_points: Vec<ContinuationPoint> = points
            .iter()
            .enumerate()
            .map(|(idx, point)| ContinuationPoint {
                state: point.clone(),
                param_value: arclength[idx],
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
            .collect();
        let geometry = ManifoldGeometry::Curve(ManifoldCurveGeometry {
            dim,
            points_flat: flatten_points(&points),
            arclength,
            direction,
        });
        let indices: Vec<i32> = (0..branch_points.len() as i32).collect();
        branches.push(ContinuationBranch {
            points: branch_points,
            bifurcations: Vec::new(),
            indices,
            branch_type: BranchType::ManifoldEq1D {
                stability: settings.stability,
                direction,
                eig_index: eig.index,
                method: "shooting_bvp".to_string(),
                caps: settings.caps,
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: Some(geometry),
        });
    }
    Ok(branches)
}

fn apply_eq_2d_profile(settings: &mut Manifold2DSettings) {
    let Some(profile) = settings.profile else {
        return;
    };
    let apply = |slot: &mut f64, value: f64| {
        if !slot.is_finite() || *slot <= 0.0 {
            *slot = value;
        }
    };
    match profile {
        Manifold2DProfile::LocalPreview => {
            apply(&mut settings.initial_radius, 1e-3);
            apply(&mut settings.leaf_delta, 2e-3);
            apply(&mut settings.delta_min, 1e-3);
            if settings.ring_points == 0 {
                settings.ring_points = 48;
            }
            apply(&mut settings.integration_dt, 1e-2);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.00134;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.004;
            }
            apply(&mut settings.alpha_min, DEFAULT_GEODESIC_ALPHA_MIN);
            apply(&mut settings.alpha_max, DEFAULT_GEODESIC_ALPHA_MAX);
            apply(
                &mut settings.delta_alpha_min,
                DEFAULT_GEODESIC_DELTA_ALPHA_MIN,
            );
            apply(
                &mut settings.delta_alpha_max,
                DEFAULT_GEODESIC_DELTA_ALPHA_MAX,
            );
        }
        Manifold2DProfile::LorenzGlobalKo => {
            apply(&mut settings.initial_radius, 1.0);
            apply(&mut settings.leaf_delta, 1.0);
            apply(&mut settings.delta_min, 0.01);
            if settings.ring_points == 0 {
                settings.ring_points = 20;
            }
            apply(&mut settings.integration_dt, 1e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.25;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 2.0;
            }
            apply(&mut settings.alpha_min, 0.3);
            apply(&mut settings.alpha_max, 0.4);
            apply(&mut settings.delta_alpha_min, 0.1);
            apply(&mut settings.delta_alpha_max, 1.0);
            settings.caps.max_steps = settings.caps.max_steps.max(150);
            settings.caps.max_time = settings.caps.max_time.max(50.0);
        }
    }
}

fn apply_cycle_2d_profile(settings: &mut ManifoldCycle2DSettings) {
    let Some(profile) = settings.profile else {
        return;
    };
    let apply = |slot: &mut f64, value: f64| {
        if !slot.is_finite() || *slot <= 0.0 {
            *slot = value;
        }
    };
    match profile {
        Manifold2DProfile::LocalPreview => {
            apply(&mut settings.initial_radius, 1e-3);
            apply(&mut settings.leaf_delta, 2e-3);
            apply(&mut settings.delta_min, 1e-3);
            if settings.ring_points == 0 {
                settings.ring_points = 48;
            }
            apply(&mut settings.integration_dt, 1e-2);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.00134;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 0.004;
            }
            apply(&mut settings.alpha_min, DEFAULT_GEODESIC_ALPHA_MIN);
            apply(&mut settings.alpha_max, DEFAULT_GEODESIC_ALPHA_MAX);
            apply(
                &mut settings.delta_alpha_min,
                DEFAULT_GEODESIC_DELTA_ALPHA_MIN,
            );
            apply(
                &mut settings.delta_alpha_max,
                DEFAULT_GEODESIC_DELTA_ALPHA_MAX,
            );
        }
        Manifold2DProfile::LorenzGlobalKo => {
            apply(&mut settings.initial_radius, 1.0);
            apply(&mut settings.leaf_delta, 1.0);
            apply(&mut settings.delta_min, 0.01);
            if settings.ring_points == 0 {
                settings.ring_points = 20;
            }
            apply(&mut settings.integration_dt, 1e-3);
            if settings.min_spacing <= 0.0 {
                settings.min_spacing = 0.25;
            }
            if settings.max_spacing <= 0.0 {
                settings.max_spacing = 2.0;
            }
            apply(&mut settings.alpha_min, 0.3);
            apply(&mut settings.alpha_max, 0.4);
            apply(&mut settings.delta_alpha_min, 0.1);
            apply(&mut settings.delta_alpha_max, 1.0);
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
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64)>,
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
    on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64)>,
) -> Result<ContinuationBranch> {
    let mut settings = settings;
    apply_cycle_2d_profile(&mut settings);
    let dim = system.equations.len();
    if dim < 3 {
        bail!("2D manifold computation requires ambient dimension n >= 3.");
    }
    let mut cycle = decode_cycle_mesh_points(cycle_state, dim, ntst, ncol);
    if cycle.len() < 4 {
        bail!("Cycle profile must contain at least 4 points.");
    }
    let (floquet_index, multiplier) = select_floquet_multiplier(
        floquet_multipliers,
        settings.stability,
        settings.floquet_index,
    )?;
    cycle = resample_closed_ring(&cycle, settings.ring_points.max(8));

    let normals = cycle_normals(&cycle);
    let mut initial_ring =
        Vec::with_capacity(cycle.len() * if multiplier.re < 0.0 { 2 } else { 1 });
    let mut initial_in_anchors = Vec::with_capacity(initial_ring.capacity());
    let radius = settings.initial_radius.max(1e-9);
    for (point, normal) in cycle.iter().zip(normals.iter()) {
        let mut seed = point.clone();
        for i in 0..dim {
            seed[i] += radius * normal[i];
        }
        initial_ring.push(seed);
        initial_in_anchors.push(point.clone());
    }
    if multiplier.re < 0.0 {
        // Negative multipliers are anti-periodic; use a doubled cover to avoid
        // forcing a discontinuous direction field around the cycle.
        for (point, normal) in cycle.iter().zip(normals.iter()) {
            let mut seed = point.clone();
            for i in 0..dim {
                seed[i] -= radius * normal[i];
            }
            initial_ring.push(seed);
            initial_in_anchors.push(point.clone());
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

#[derive(Clone)]
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
    TooManyPoints,
    InsertionLeafFailed(LeafFailureKind),
    NoConvergence,
}

impl RingSpacingFailure {
    fn as_str(self) -> &'static str {
        match self {
            RingSpacingFailure::InvalidCandidate => "invalid_candidate",
            RingSpacingFailure::TooManyPoints => "too_many_points",
            RingSpacingFailure::InsertionLeafFailed(_) => "insertion_leaf_failed",
            RingSpacingFailure::NoConvergence => "no_convergence",
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
    signed_distance: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LeafFailureKind {
    PlaneSolveNoConvergence,
    SegmentSwitchLimitExceeded,
    IntegratorNonFinite,
    NoFirstHitWithinMaxTime,
}

impl LeafFailureKind {
    fn as_str(self) -> &'static str {
        match self {
            LeafFailureKind::PlaneSolveNoConvergence => "PlaneSolveNoConvergence",
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

fn select_real_eigenmode(
    system: &EquationSystem,
    equilibrium_state: &[f64],
    stability: ManifoldStability,
    requested_index: Option<usize>,
) -> Result<RealEigenMode> {
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
    let mut candidates = Vec::new();
    for (idx, pair) in result.eigenpairs.iter().enumerate() {
        if pair.value.im.abs() > EIG_IM_TOL {
            continue;
        }
        if !matches_stability(pair.value.re, stability) {
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
    mut on_ring_progress: Option<&mut dyn FnMut(usize, usize, f64)>,
) -> SurfaceGrowthResult {
    let initial_inward = if let Some(anchors) = initial_in_anchors {
        anchors.to_vec()
    } else if let Some(center_state) = center {
        vec![center_state.to_vec(); initial_ring.len()]
    } else {
        initial_ring.clone()
    };
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
        progress(rings.len(), initial_vertices, 0.0);
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
            let geodesic_raw = evaluate_geodesic_quality(prev, prev_in_anchors, &raw_next.points);
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
            accepted_geodesic = geodesic_raw;
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
            progress(rings.len(), total_vertices, accumulated_arc);
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
    let mut next = Vec::with_capacity(m);
    let mut base_anchors = Vec::with_capacity(m);
    let mut in_anchors = Vec::with_capacity(m);
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
        let hit = match solve_leaf_point_with_retries(
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
            Ok(hit) => hit,
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
                return Err(RingBuildFailure {
                    solved_points: next.len(),
                    reason: failure.kind,
                    point_index: i,
                    last_time: failure.last_time,
                    last_segment: failure.last_segment,
                    last_tau: failure.last_tau,
                });
            }
        };
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
    if raw_next.points.len() < 4
        || raw_next.base_anchors.len() != raw_next.points.len()
        || raw_next.in_anchors.len() != raw_next.points.len()
    {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    if raw_next.points.len() > max_ring_points {
        return Err(RingSpacingFailure::TooManyPoints);
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
            let angle_j = ring_vertex_angle(&ring.points, j);
            if spacing < min_spacing
                && angle_j < LOW_TURN_ANGLE_RAD
                && spacing * angle_j < LOW_DISTANCE_ANGLE
            {
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
        let mut points = Vec::with_capacity((m * 2).min(max_ring_points));
        let mut base_anchors = Vec::with_capacity((m * 2).min(max_ring_points));
        let mut in_anchors = Vec::with_capacity((m * 2).min(max_ring_points));
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
            if points.len() >= max_ring_points {
                return Err(RingSpacingFailure::TooManyPoints);
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
            )
            .map_err(|failure| RingSpacingFailure::InsertionLeafFailed(failure.kind))?;
            points.push(hit.point);
            base_anchors.push(hit.base_anchor);
            in_anchors.push(hit.in_anchor);
            changed = true;
        }

        if points.len() > max_ring_points {
            return Err(RingSpacingFailure::TooManyPoints);
        }
        ring = RingSolve {
            points,
            base_anchors,
            in_anchors,
        };
        if !changed {
            return Ok(ring);
        }
    }

    if ring.points.len() > max_ring_points {
        return Err(RingSpacingFailure::TooManyPoints);
    }
    if ring.points.len() < 4 {
        return Err(RingSpacingFailure::InvalidCandidate);
    }
    Err(RingSpacingFailure::NoConvergence)
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

fn evaluate_geodesic_quality(
    prev_ring: &[Vec<f64>],
    prev_in_anchors: &[Vec<f64>],
    next_ring: &[Vec<f64>],
) -> GeodesicQuality {
    if prev_ring.is_empty()
        || prev_in_anchors.len() != prev_ring.len()
        || next_ring.len() != prev_ring.len()
    {
        return GeodesicQuality::default();
    }

    let mut quality = GeodesicQuality::default();
    for idx in 0..prev_ring.len() {
        let p = &prev_in_anchors[idx];
        let r = &prev_ring[idx];
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
    let mut sum = 0.0;
    for i in 0..samples {
        let s = (i as f64) / (samples as f64);
        let p_prev = sample_ring_uniform(prev_ring, s);
        let p_next = sample_ring_uniform(next_ring, s);
        sum += l2_distance(&p_prev, &p_next);
    }
    sum / (samples as f64)
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
    let (point, phi) = integrate_state_and_variational(
        system,
        &start,
        tau_time,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
    )
    .ok_or(LeafFailureKind::IntegratorNonFinite)?;
    let residual = dot(leaf_normal, &subtract(&point, base_point));
    let transported =
        mat_vec_mul_row_major(&phi, &dldt).ok_or(LeafFailureKind::IntegratorNonFinite)?;
    let deriv = dot(leaf_normal, &transported);
    if !residual.is_finite()
        || !deriv.is_finite()
        || point.iter().any(|value| !value.is_finite())
        || start.iter().any(|value| !value.is_finite())
    {
        return Err(LeafFailureKind::IntegratorNonFinite);
    }
    Ok((residual, deriv, start, point))
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
    if ring.is_empty() {
        return Err(LeafFailureKind::PlaneSolveNoConvergence);
    }
    let m = ring.len();
    let mut seg = seed_seg % m;
    let mut tau = seed_tau.clamp(0.0, 1.0);
    let mut switch_count = 0usize;

    'outer: while switch_count < LEAF_SEGMENT_SWITCH_MAX {
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
                return Ok((seg, tau, start, end));
            }
            if dh.abs() <= LEAF_PLANE_DERIV_EPS {
                break;
            }
            let step = (h / dh).clamp(-LEAF_TAU_NEWTON_MAX_STEP, LEAF_TAU_NEWTON_MAX_STEP);
            let tau_next = tau - step;
            if tau_next < 0.0 {
                seg = (seg + 1) % m;
                tau = (tau_next + 1.0).clamp(0.0, 1.0);
                switch_count += 1;
                continue 'outer;
            }
            if tau_next > 1.0 {
                seg = (seg + m - 1) % m;
                tau = (tau_next - 1.0).clamp(0.0, 1.0);
                switch_count += 1;
                continue 'outer;
            }
            tau = tau_next.clamp(0.0, 1.0);
        }

        let tau_samples = [0.0_f64, 0.5_f64, 1.0_f64];
        let mut samples: Vec<(f64, f64, Vec<f64>, Vec<f64>)> =
            Vec::with_capacity(tau_samples.len());
        for &tau_sample in &tau_samples {
            let sample = eval_plane_residual_and_derivative_on_segment(
                system,
                ring,
                base_point,
                leaf_normal,
                seg,
                tau_time,
                tau_sample,
                sigma,
                dt,
                max_steps_per_leaf,
                max_time,
            )?;
            if sample.0.abs() <= plane_tol {
                return Ok((seg, tau_sample, sample.2, sample.3));
            }
            samples.push((tau_sample, sample.0, sample.2, sample.3));
        }

        for pair in samples.windows(2) {
            let (tau_l, h_l, _, _) = &pair[0];
            let (tau_r, h_r, _, _) = &pair[1];
            if *h_l * *h_r > 0.0 {
                continue;
            }
            let mut left_tau = *tau_l;
            let mut right_tau = *tau_r;
            let mut left_h = *h_l;
            for _ in 0..LEAF_PLANE_BISECT_ITERS {
                let mid_tau = 0.5 * (left_tau + right_tau);
                let (mid_h, _mid_dh, mid_start, mid_end) =
                    eval_plane_residual_and_derivative_on_segment(
                        system,
                        ring,
                        base_point,
                        leaf_normal,
                        seg,
                        tau_time,
                        mid_tau,
                        sigma,
                        dt,
                        max_steps_per_leaf,
                        max_time,
                    )?;
                if mid_h.abs() <= plane_tol {
                    return Ok((seg, mid_tau, mid_start, mid_end));
                }
                if left_h * mid_h <= 0.0 {
                    right_tau = mid_tau;
                } else {
                    left_tau = mid_tau;
                    left_h = mid_h;
                }
            }
            let root_tau = 0.5 * (left_tau + right_tau);
            let (_root_h, _root_dh, root_start, root_end) =
                eval_plane_residual_and_derivative_on_segment(
                    system,
                    ring,
                    base_point,
                    leaf_normal,
                    seg,
                    tau_time,
                    root_tau,
                    sigma,
                    dt,
                    max_steps_per_leaf,
                    max_time,
                )?;
            return Ok((seg, root_tau, root_start, root_end));
        }

        let mut best_idx = 0usize;
        let mut best_abs = samples[0].1.abs();
        for (idx, sample) in samples.iter().enumerate().skip(1) {
            let value = sample.1.abs();
            if value < best_abs {
                best_abs = value;
                best_idx = idx;
            }
        }
        if best_abs <= plane_tol {
            let (tau_best, _h_best, start_best, end_best) = samples.remove(best_idx);
            return Ok((seg, tau_best, start_best, end_best));
        }

        let h0 = samples[0].1.abs();
        let h1 = samples[samples.len() - 1].1.abs();
        if h0 < h1 {
            seg = (seg + 1) % m;
            tau = 1.0;
        } else {
            seg = (seg + m - 1) % m;
            tau = 0.0;
        }
        switch_count += 1;
        continue;
    }

    Err(LeafFailureKind::SegmentSwitchLimitExceeded)
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
    let (seg_index, seg_tau, _start, point) = solve_plane_root_polygon(
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
    )?;
    let offset = subtract(&point, base_point);
    let uz = signed_distance_with_direction(signed_direction, &offset);
    Ok(LeafSample {
        point,
        seg_index,
        seg_tau,
        signed_distance: uz,
    })
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
    shoot_leaf_point(
        system,
        ring,
        base_point,
        base_s,
        tangent,
        outward,
        leaf_delta,
        sigma,
        dt,
        max_steps_per_leaf,
        max_time,
        center,
    )
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
    let mut prev_time = 0.0;
    let mut prev_sample = LeafSample {
        point: base_point.to_vec(),
        seg_index: seg_idx,
        seg_tau,
        signed_distance: signed_distance_with_direction(
            &signed_direction,
            &vec![0.0; base_point.len()],
        ),
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
                if reason != LeafFailureKind::IntegratorNonFinite && tau_step > min_tau_step {
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

        if prev_sample.signed_distance < leaf_delta && curr_sample.signed_distance >= leaf_delta {
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

                if mid_sample.signed_distance >= leaf_delta {
                    right_time = mid_time;
                    right_sample = mid_sample.clone();
                } else {
                    left_time = mid_time;
                    left_sample = mid_sample.clone();
                }

                if (mid_sample.signed_distance - leaf_delta).abs() <= dist_tol {
                    return Ok(LeafHit {
                        point: mid_sample.point,
                        tau_hit: mid_time,
                        base_anchor: base_s.rem_euclid(1.0),
                        in_anchor: base_point.to_vec(),
                    });
                }
            }

            if right_sample.signed_distance >= leaf_delta
                && (right_sample.signed_distance - leaf_delta).abs() <= 10.0 * dist_tol
            {
                return Ok(LeafHit {
                    point: right_sample.point,
                    tau_hit: right_time,
                    base_anchor: base_s.rem_euclid(1.0),
                    in_anchor: base_point.to_vec(),
                });
            }
            return Err(LeafFailure {
                kind: LeafFailureKind::PlaneSolveNoConvergence,
                last_time: right_time,
                last_segment: right_sample.seg_index,
                last_tau: right_sample.seg_tau,
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

        let a_alpha = normalized_ring_arclength_params(a_ring);
        let b_beta = normalized_ring_arclength_params(b_ring);

        let mut i = best_i;
        let mut j = best_j;
        let mut advanced_a = 0usize;
        let mut advanced_b = 0usize;
        while advanced_a < m || advanced_b < n {
            let a_i = a0 + i;
            let b_j = b0 + j;
            let advance_a = if advanced_a >= m {
                false
            } else if advanced_b >= n {
                true
            } else {
                let a_step = circular_delta(a_alpha[i], a_alpha[(i + 1) % m]).abs();
                let b_step = circular_delta(b_beta[j], b_beta[(j + 1) % n]).abs();
                a_step <= b_step
            };
            if advance_a {
                let i_next = (i + 1) % m;
                triangles.extend_from_slice(&[a_i, b_j, a0 + i_next]);
                i = i_next;
                advanced_a += 1;
            } else {
                let j_next = (j + 1) % n;
                triangles.extend_from_slice(&[a_i, b_j, b0 + j_next]);
                j = j_next;
                advanced_b += 1;
            }
        }
    }
    triangles
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

fn decode_cycle_mesh_points(state: &[f64], dim: usize, ntst: usize, ncol: usize) -> Vec<Vec<f64>> {
    if state.is_empty() || dim == 0 {
        return Vec::new();
    }
    let raw_len = state.len().saturating_sub(1);
    let raw = &state[..raw_len];
    if raw.len() == dim {
        return vec![raw.to_vec()];
    }

    let mesh_count = ntst.saturating_add(1);
    let stage_count = ntst.saturating_mul(ncol);
    let mesh_len = mesh_count.saturating_mul(dim);
    let stage_len = stage_count.saturating_mul(dim);

    if raw.len() >= mesh_len + stage_len && mesh_len > 0 {
        let mesh = &raw[..mesh_len];
        return mesh
            .chunks(dim)
            .filter(|chunk| chunk.len() == dim)
            .map(|chunk| chunk.to_vec())
            .collect();
    }
    if raw.len() >= mesh_len && mesh_len > 0 {
        return raw[..mesh_len]
            .chunks(dim)
            .filter(|chunk| chunk.len() == dim)
            .map(|chunk| chunk.to_vec())
            .collect();
    }
    raw.chunks(dim)
        .filter(|chunk| chunk.len() == dim)
        .map(|chunk| chunk.to_vec())
        .collect()
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
        let matches = match stability {
            ManifoldStability::Unstable => value.re > 1.0 + 1e-6,
            ManifoldStability::Stable => value.re < 1.0 - 1e-6,
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

fn cycle_normals(cycle: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let dim = cycle[0].len();
    let mut normals = Vec::with_capacity(cycle.len());
    for i in 0..cycle.len() {
        let prev = if i == 0 {
            &cycle[cycle.len() - 1]
        } else {
            &cycle[i - 1]
        };
        let curr = &cycle[i];
        let next = &cycle[(i + 1) % cycle.len()];
        let tangent = normalize(subtract(next, prev)).unwrap_or_else(|_| {
            let mut fallback = vec![0.0; dim];
            if !fallback.is_empty() {
                fallback[0] = 1.0;
            }
            fallback
        });
        let mut normal = vec![0.0; dim];
        let mut chosen = false;
        for axis in 0..dim {
            normal.fill(0.0);
            normal[axis] = 1.0;
            let proj = dot(&normal, &tangent);
            for j in 0..dim {
                normal[j] -= proj * tangent[j];
            }
            if l2_norm(&normal) > 1e-8 {
                chosen = true;
                break;
            }
        }
        if !chosen {
            if !normal.is_empty() {
                normal[0] = 1.0;
            }
        }
        normals.push(normalize(normal).unwrap_or_else(|_| vec![1.0; dim]));
        let _ = curr;
    }
    normals
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
    fn manifold_eq_2d_rossler_unstable_focus_pair_initialization_produces_surface_geometry() {
        let mut system = build_system(
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

        let branch = continue_manifold_eq_2d(
            &mut system,
            &equilibrium,
            Manifold2DSettings {
                stability: ManifoldStability::Unstable,
                initial_radius: 1e-4,
                leaf_delta: 1e-4,
                ring_points: 32,
                integration_dt: 1e-2,
                target_radius: 2e-3,
                target_arclength: 2e-3,
                caps: ManifoldTerminationCaps {
                    max_rings: 3,
                    max_vertices: 800,
                    max_time: 1.0,
                    ..ManifoldTerminationCaps::default()
                },
                ..Manifold2DSettings::default()
            },
        )
        .expect("rossler unstable manifold");

        let BranchType::ManifoldEq2D {
            stability,
            eig_kind,
            ..
        } = branch.branch_type
        else {
            panic!("expected 2D manifold branch type");
        };
        assert_eq!(stability, ManifoldStability::Unstable);
        assert_eq!(eig_kind, ManifoldEigenKind::ComplexPair);

        let ManifoldGeometry::Surface(surface) = branch.manifold_geometry.expect("geometry") else {
            panic!("expected surface geometry");
        };
        assert!(!surface.triangles.is_empty());
        assert_eq!(surface.ring_offsets.first().copied(), Some(1));
        assert!(
            surface.vertices_flat.len() >= 3 * 33,
            "unexpectedly small surface payload: {} coordinates",
            surface.vertices_flat.len()
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
                0.002,
                -1.0,
                0.01,
                150,
                1.0,
                Some(&equilibrium),
            )
            .ok()
        });
        assert!(
            point.is_some(),
            "expected a valid leaf intersection for Lorenz stable manifold"
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
    fn manifold_eq_2d_failure_diagnostics_include_failed_ring_attempt_and_floor_flags() {
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
        assert_eq!(diagnostics.termination_reason, "ring_build_failed");
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
    fn manifold_cycle_2d_builds_surface_geometry() {
        let mut system = build_system(&["-y", "x", "0.1*z"], &["x", "y", "z"], &[]);
        let ntst = 8usize;
        let ncol = 2usize;
        let dim = 3usize;
        let mesh_count = ntst + 1;
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
    fn manifold_cycle_2d_negative_multiplier_uses_double_cover_initial_ring() {
        let mut system = build_system(&["-y", "x", "-0.2*z"], &["x", "y", "z"], &[]);
        let ntst = 8usize;
        let ncol = 2usize;
        let dim = 3usize;
        let mesh_count = ntst + 1;
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
            stability: ManifoldStability::Stable,
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
                delta_alpha_min: 0.1,
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
                delta_alpha_min: 0.1,
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
    fn manifold_eq_2d_lorenz_large_target_run_reports_stop_diagnostics() {
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
                leaf_delta: 2e-3,
                ring_points: 48,
                integration_dt: 1e-2,
                target_radius: 128.0,
                target_arclength: 50.0,
                caps: ManifoldTerminationCaps {
                    max_rings: 500,
                    max_vertices: 200_000,
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
            !diagnostics.termination_reason.trim().is_empty(),
            "expected a non-empty termination reason"
        );
        assert!(
            diagnostics.ring_attempts > 0,
            "expected at least one ring attempt"
        );
        assert!(
            diagnostics.termination_detail.is_some(),
            "expected detailed termination context, got {:?}",
            diagnostics.termination_detail
        );
    }

    #[test]
    fn manifold_eq_2d_lorenz_global_default_scale_avoids_ring_build_failure_and_reaches_twenty_rings(
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
                initial_radius: 1.0,
                leaf_delta: 1.0,
                delta_min: 0.01,
                ring_points: 20,
                min_spacing: 0.25,
                max_spacing: 2.0,
                alpha_min: 0.3,
                alpha_max: 0.4,
                delta_alpha_min: 0.1,
                delta_alpha_max: 1.0,
                integration_dt: 1e-3,
                target_radius: 40.0,
                target_arclength: 100.0,
                caps: ManifoldTerminationCaps {
                    max_steps: 2000,
                    max_points: 8000,
                    max_rings: 60,
                    max_vertices: 200_000,
                    max_time: 200.0,
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
                && diagnostics.termination_reason != "ring_spacing_failed"
                && diagnostics.termination_reason != "integrator_failure",
            "unexpected Lorenz global termination reason={} detail={:?}",
            diagnostics.termination_reason,
            diagnostics.termination_detail
        );
        assert!(
            surface.ring_offsets.len() >= 20 || diagnostics.termination_reason == "target_radius",
            "expected >=20 rings or target-radius termination, got rings={} reason={} detail={:?}",
            surface.ring_offsets.len(),
            diagnostics.termination_reason,
            diagnostics.termination_detail
        );
        if diagnostics.termination_reason == "target_radius" {
            let max_radius = surface
                .vertices_flat
                .chunks(3)
                .map(l2_norm)
                .fold(0.0_f64, f64::max);
            assert!(
                max_radius >= 39.0,
                "target-radius run terminated early without reaching large radius (max_radius={max_radius})"
            );
        }
        assert_eq!(
            diagnostics.leaf_fail_plane_root_not_bracketed, 0,
            "PlaneRootNotBracketed should be recovered via segment switching"
        );
    }
}
