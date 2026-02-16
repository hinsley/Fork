//! Core types for continuation analysis.
//!
//! This module contains the fundamental data structures used throughout
//! the continuation analysis system.

use num_complex::Complex;
use serde::{Deserialize, Serialize};

fn default_homoclinic_time() -> f64 {
    1.0
}

fn default_homoclinic_eps() -> f64 {
    1e-2
}

fn default_manifold_max_steps() -> usize {
    2_000
}

fn default_manifold_max_points() -> usize {
    20_000
}

fn default_manifold_max_rings() -> usize {
    500
}

fn default_manifold_max_vertices() -> usize {
    200_000
}

fn default_manifold_max_time() -> f64 {
    1_000.0
}

fn default_manifold_radius() -> f64 {
    5.0
}

fn default_manifold_eps() -> f64 {
    1e-3
}

fn default_manifold_dt() -> f64 {
    1e-2
}

fn default_manifold_ring_points() -> usize {
    48
}

fn default_manifold_leaf_delta() -> f64 {
    2e-3
}

fn default_manifold_target_arclength() -> f64 {
    10.0
}

fn default_manifold_delta_min() -> f64 {
    1e-3
}

fn default_manifold_alpha_min() -> f64 {
    0.3
}

fn default_manifold_alpha_max() -> f64 {
    0.4
}

fn default_manifold_delta_alpha_min() -> f64 {
    0.1
}

fn default_manifold_delta_alpha_max() -> f64 {
    1.0
}

/// Stable/unstable selector for invariant manifold computations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ManifoldStability {
    Stable,
    Unstable,
}

/// Direction selector for one-dimensional manifolds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ManifoldDirection {
    Plus,
    Minus,
    Both,
}

/// Eigenspace kind selected for two-dimensional equilibrium manifolds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ManifoldEigenKind {
    RealPair,
    ComplexPair,
}

/// Parameter profile selector for 2D manifold workflows.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Manifold2DProfile {
    LocalPreview,
    LorenzGlobalKo,
}

/// Global stop criteria shared by manifold workflows.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ManifoldTerminationCaps {
    #[serde(default = "default_manifold_max_steps")]
    pub max_steps: usize,
    #[serde(default = "default_manifold_max_points")]
    pub max_points: usize,
    #[serde(default = "default_manifold_max_rings")]
    pub max_rings: usize,
    #[serde(default = "default_manifold_max_vertices")]
    pub max_vertices: usize,
    #[serde(default = "default_manifold_max_time")]
    pub max_time: f64,
}

impl Default for ManifoldTerminationCaps {
    fn default() -> Self {
        Self {
            max_steps: default_manifold_max_steps(),
            max_points: default_manifold_max_points(),
            max_rings: default_manifold_max_rings(),
            max_vertices: default_manifold_max_vertices(),
            max_time: default_manifold_max_time(),
        }
    }
}

/// Optional box bounds used to stop manifold growth outside a domain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifoldBounds {
    pub min: Vec<f64>,
    pub max: Vec<f64>,
}

/// Settings for 1D equilibrium manifold computation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifold1DSettings {
    pub stability: ManifoldStability,
    pub direction: ManifoldDirection,
    #[serde(default)]
    pub eig_index: Option<usize>,
    #[serde(default = "default_manifold_eps")]
    pub eps: f64,
    #[serde(default = "default_manifold_target_arclength")]
    pub target_arclength: f64,
    #[serde(default = "default_manifold_dt")]
    pub integration_dt: f64,
    #[serde(default)]
    pub caps: ManifoldTerminationCaps,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ManifoldBounds>,
}

impl Default for Manifold1DSettings {
    fn default() -> Self {
        Self {
            stability: ManifoldStability::Unstable,
            direction: ManifoldDirection::Both,
            eig_index: None,
            eps: default_manifold_eps(),
            target_arclength: default_manifold_target_arclength(),
            integration_dt: default_manifold_dt(),
            caps: ManifoldTerminationCaps::default(),
            bounds: None,
        }
    }
}

/// Settings for 2D equilibrium manifolds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifold2DSettings {
    pub stability: ManifoldStability,
    #[serde(default)]
    pub eig_indices: Option<[usize; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<Manifold2DProfile>,
    #[serde(default = "default_manifold_eps")]
    pub initial_radius: f64,
    #[serde(default = "default_manifold_leaf_delta")]
    pub leaf_delta: f64,
    #[serde(default = "default_manifold_delta_min")]
    pub delta_min: f64,
    #[serde(default = "default_manifold_ring_points")]
    pub ring_points: usize,
    /// Minimum accepted spacing between adjacent ring vertices.
    /// Non-positive values enable adaptive defaults based on `leaf_delta`.
    #[serde(default)]
    pub min_spacing: f64,
    /// Maximum accepted spacing between adjacent ring vertices.
    /// Non-positive values enable adaptive defaults based on `leaf_delta`.
    #[serde(default)]
    pub max_spacing: f64,
    #[serde(default = "default_manifold_alpha_min")]
    pub alpha_min: f64,
    #[serde(default = "default_manifold_alpha_max")]
    pub alpha_max: f64,
    #[serde(default = "default_manifold_delta_alpha_min")]
    pub delta_alpha_min: f64,
    #[serde(default = "default_manifold_delta_alpha_max")]
    pub delta_alpha_max: f64,
    #[serde(default = "default_manifold_dt")]
    pub integration_dt: f64,
    #[serde(default = "default_manifold_radius")]
    pub target_radius: f64,
    #[serde(default = "default_manifold_target_arclength")]
    pub target_arclength: f64,
    #[serde(default)]
    pub caps: ManifoldTerminationCaps,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ManifoldBounds>,
}

impl Default for Manifold2DSettings {
    fn default() -> Self {
        Self {
            stability: ManifoldStability::Unstable,
            eig_indices: None,
            profile: None,
            initial_radius: default_manifold_eps(),
            leaf_delta: default_manifold_leaf_delta(),
            delta_min: default_manifold_delta_min(),
            ring_points: default_manifold_ring_points(),
            min_spacing: 0.0,
            max_spacing: 0.0,
            alpha_min: default_manifold_alpha_min(),
            alpha_max: default_manifold_alpha_max(),
            delta_alpha_min: default_manifold_delta_alpha_min(),
            delta_alpha_max: default_manifold_delta_alpha_max(),
            integration_dt: default_manifold_dt(),
            target_radius: default_manifold_radius(),
            target_arclength: default_manifold_target_arclength(),
            caps: ManifoldTerminationCaps::default(),
            bounds: None,
        }
    }
}

/// Settings for 2D limit-cycle manifold computations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifoldCycle2DSettings {
    pub stability: ManifoldStability,
    #[serde(default)]
    pub floquet_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<Manifold2DProfile>,
    #[serde(default = "default_manifold_eps")]
    pub initial_radius: f64,
    #[serde(default = "default_manifold_leaf_delta")]
    pub leaf_delta: f64,
    #[serde(default = "default_manifold_delta_min")]
    pub delta_min: f64,
    #[serde(default = "default_manifold_ring_points")]
    pub ring_points: usize,
    #[serde(default)]
    pub min_spacing: f64,
    #[serde(default)]
    pub max_spacing: f64,
    #[serde(default = "default_manifold_alpha_min")]
    pub alpha_min: f64,
    #[serde(default = "default_manifold_alpha_max")]
    pub alpha_max: f64,
    #[serde(default = "default_manifold_delta_alpha_min")]
    pub delta_alpha_min: f64,
    #[serde(default = "default_manifold_delta_alpha_max")]
    pub delta_alpha_max: f64,
    #[serde(default = "default_manifold_dt")]
    pub integration_dt: f64,
    #[serde(default = "default_manifold_target_arclength")]
    pub target_arclength: f64,
    #[serde(default)]
    pub ntst: usize,
    #[serde(default)]
    pub ncol: usize,
    #[serde(default)]
    pub caps: ManifoldTerminationCaps,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ManifoldBounds>,
}

impl Default for ManifoldCycle2DSettings {
    fn default() -> Self {
        Self {
            stability: ManifoldStability::Unstable,
            floquet_index: None,
            profile: None,
            initial_radius: default_manifold_eps(),
            leaf_delta: default_manifold_leaf_delta(),
            delta_min: default_manifold_delta_min(),
            ring_points: default_manifold_ring_points(),
            min_spacing: 0.0,
            max_spacing: 0.0,
            alpha_min: default_manifold_alpha_min(),
            alpha_max: default_manifold_alpha_max(),
            delta_alpha_min: default_manifold_delta_alpha_min(),
            delta_alpha_max: default_manifold_delta_alpha_max(),
            integration_dt: default_manifold_dt(),
            target_arclength: default_manifold_target_arclength(),
            ntst: 0,
            ncol: 0,
            caps: ManifoldTerminationCaps::default(),
            bounds: None,
        }
    }
}

/// Geometry payload for a 1D manifold.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifoldCurveGeometry {
    pub dim: usize,
    pub points_flat: Vec<f64>,
    pub arclength: Vec<f64>,
    pub direction: ManifoldDirection,
}

/// Per-ring diagnostics for 2D manifold growth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifoldRingDiagnostic {
    pub ring_index: usize,
    pub radius_estimate: f64,
    pub point_count: usize,
}

/// Solver-level diagnostics for 2D manifold growth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ManifoldSurfaceSolverDiagnostics {
    #[serde(default)]
    pub termination_reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub termination_detail: Option<String>,
    #[serde(default)]
    pub final_leaf_delta: f64,
    #[serde(default)]
    pub ring_attempts: usize,
    #[serde(default)]
    pub build_failures: usize,
    #[serde(default)]
    pub spacing_failures: usize,
    #[serde(default)]
    pub reject_ring_quality: usize,
    #[serde(default)]
    pub reject_geodesic_quality: usize,
    #[serde(default)]
    pub reject_too_small: usize,
    #[serde(default)]
    pub leaf_fail_plane_no_convergence: usize,
    #[serde(default)]
    pub leaf_fail_plane_root_not_bracketed: usize,
    #[serde(default)]
    pub leaf_fail_segment_switch_limit: usize,
    #[serde(default)]
    pub leaf_fail_integrator_non_finite: usize,
    #[serde(default)]
    pub leaf_fail_no_first_hit_within_max_time: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_ring: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_attempt: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_leaf_points: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_leaf_failure_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_leaf_failure_point: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_leaf_failure_time: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_leaf_failure_segment: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_leaf_failure_tau: Option<f64>,
    #[serde(default)]
    pub leaf_delta_floor: f64,
    #[serde(default)]
    pub min_leaf_delta_reached: bool,
    #[serde(default)]
    pub last_ring_max_turn_angle: f64,
    #[serde(default)]
    pub last_ring_max_distance_angle: f64,
    #[serde(default)]
    pub last_geodesic_max_angle: f64,
    #[serde(default)]
    pub last_geodesic_max_distance_angle: f64,
}

/// Geometry payload for 2D manifold surfaces.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifoldSurfaceGeometry {
    pub dim: usize,
    pub vertices_flat: Vec<f64>,
    pub triangles: Vec<usize>,
    pub ring_offsets: Vec<usize>,
    #[serde(default)]
    pub ring_diagnostics: Vec<ManifoldRingDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solver_diagnostics: Option<ManifoldSurfaceSolverDiagnostics>,
}

/// Persisted manifold geometry attached to a continuation branch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ManifoldGeometry {
    Curve(ManifoldCurveGeometry),
    Surface(ManifoldSurfaceGeometry),
}

/// Settings controlling the pseudo-arclength continuation algorithm.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ContinuationSettings {
    pub step_size: f64,
    pub min_step_size: f64,
    pub max_step_size: f64,
    pub max_steps: usize,
    pub corrector_steps: usize,
    pub corrector_tolerance: f64,
    pub step_tolerance: f64,
}

/// Classification of bifurcation types detected during continuation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum BifurcationType {
    None,
    Fold,
    Hopf,
    NeutralSaddle,
    CycleFold,
    PeriodDoubling,
    NeimarkSacker,
}

/// A single point on a continuation branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationPoint {
    pub state: Vec<f64>,
    pub param_value: f64,
    pub stability: BifurcationType,
    #[serde(default)]
    pub eigenvalues: Vec<Complex<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cycle_points: Option<Vec<Vec<f64>>>,
}

/// Type of continuation branch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum BranchType {
    Equilibrium,
    LimitCycle {
        ntst: usize,
        ncol: usize,
    },
    HomoclinicCurve {
        ntst: usize,
        ncol: usize,
        param1_name: String,
        param2_name: String,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    },
    HomotopySaddleCurve {
        ntst: usize,
        ncol: usize,
        param1_name: String,
        param2_name: String,
        stage: HomotopyStage,
    },
    ManifoldEq1D {
        stability: ManifoldStability,
        direction: ManifoldDirection,
        eig_index: usize,
        method: String,
        caps: ManifoldTerminationCaps,
    },
    ManifoldEq2D {
        stability: ManifoldStability,
        eig_kind: ManifoldEigenKind,
        eig_indices: [usize; 2],
        method: String,
        caps: ManifoldTerminationCaps,
    },
    ManifoldCycle2D {
        stability: ManifoldStability,
        floquet_index: usize,
        ntst: usize,
        ncol: usize,
        method: String,
        caps: ManifoldTerminationCaps,
    },
}

impl Default for BranchType {
    fn default() -> Self {
        BranchType::Equilibrium
    }
}

/// Stage label for the homotopy-saddle workflow.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HomotopyStage {
    #[serde(rename = "StageA")]
    StageA,
    #[serde(rename = "StageB")]
    StageB,
    #[serde(rename = "StageC")]
    StageC,
    #[serde(rename = "StageD")]
    StageD,
}

/// A complete continuation branch containing multiple points.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationBranch {
    pub points: Vec<ContinuationPoint>,
    /// Indices of points where bifurcation was detected
    pub bifurcations: Vec<usize>,
    /// Explicit indices relative to start point (0)
    pub indices: Vec<i32>,
    /// Type of branch (equilibrium or limit cycle)
    #[serde(default)]
    pub branch_type: BranchType,
    /// LC-specific: velocity profile for phase condition
    #[serde(default)]
    pub upoldp: Option<Vec<Vec<f64>>>,
    /// Optional homoclinic extension context needed to resume with the
    /// same defining-system basis across branch extension runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homoc_context: Option<HomoclinicResumeContext>,
    /// Optional extension resume metadata for min/max signed-index endpoints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume_state: Option<ContinuationResumeState>,
    /// Optional persisted geometry for invariant-manifold branches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifold_geometry: Option<ManifoldGeometry>,
}

/// Basis snapshot for homoclinic continuation restart/extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomoclinicBasisSnapshot {
    pub stable_q: Vec<f64>,
    pub unstable_q: Vec<f64>,
    pub dim: usize,
    pub nneg: usize,
    pub npos: usize,
}

/// Persisted homoclinic context used to reconstruct extension problems
/// without recomputing a different saddle basis.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomoclinicResumeContext {
    pub base_params: Vec<f64>,
    pub param1_index: usize,
    pub param2_index: usize,
    pub basis: HomoclinicBasisSnapshot,
    #[serde(default = "default_homoclinic_time")]
    pub fixed_time: f64,
    #[serde(default = "default_homoclinic_eps")]
    pub fixed_eps0: f64,
    #[serde(default = "default_homoclinic_eps")]
    pub fixed_eps1: f64,
}

/// Resume seed for a specific branch endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContinuationEndpointSeed {
    /// Signed branch index of the endpoint this seed belongs to.
    pub endpoint_index: i32,
    /// Augmented state [parameter, packed_state...].
    pub aug_state: Vec<f64>,
    /// Normalized tangent at the endpoint.
    pub tangent: Vec<f64>,
    /// Adaptive step size at the endpoint.
    pub step_size: f64,
}

/// Optional resume seeds for each signed-index side of a branch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ContinuationResumeState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_index_seed: Option<ContinuationEndpointSeed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_index_seed: Option<ContinuationEndpointSeed>,
}

// ============================================================================
// Codim-1 Bifurcation Curve Types (Two-Parameter Continuation)
// ============================================================================

/// Type of codim-1 bifurcation curve being continued in two-parameter space.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Codim1CurveType {
    /// Fold (saddle-node) curve for equilibria
    Fold,
    /// Hopf curve for equilibria
    Hopf,
    /// Isochrone curve for limit cycles (fixed period)
    Isochrone,
    /// Limit point of cycles (fold of limit cycles)
    LimitPointCycle,
    /// Period-doubling curve
    PeriodDoubling,
    /// Neimark-Sacker curve
    NeimarkSacker,
}

/// Classification of codim-2 bifurcation types detected on codim-1 curves.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Codim2BifurcationType {
    None,
    // Equilibrium codim-2 (on Fold/Hopf curves)
    /// Cusp point (on fold curve)
    Cusp,
    /// Bogdanov-Takens point (fold-Hopf intersection)
    BogdanovTakens,
    /// Zero-Hopf point (Hopf with zero eigenvalue)
    ZeroHopf,
    /// Double-Hopf point (two pairs of pure imaginary eigenvalues)
    DoubleHopf,
    /// Generalized Hopf (Bautin, first Lyapunov coefficient = 0)
    GeneralizedHopf,
    // Limit cycle codim-2 (on LPC/PD/NS curves)
    /// Cusp of cycles
    CuspOfCycles,
    /// Fold-flip (LPC meets PD)
    FoldFlip,
    /// Fold-Neimark-Sacker (LPC meets NS)
    FoldNeimarkSacker,
    /// Flip-Neimark-Sacker (PD meets NS)
    FlipNeimarkSacker,
    /// Double Neimark-Sacker
    DoubleNeimarkSacker,
    /// Generalized period-doubling
    GeneralizedPeriodDoubling,
    /// Chenciner (generalized Neimark-Sacker)
    Chenciner,
    /// 1:1 Strong resonance
    Resonance1_1,
    /// 1:2 Strong resonance
    Resonance1_2,
    /// 1:3 Strong resonance
    Resonance1_3,
    /// 1:4 Strong resonance
    Resonance1_4,
}

/// A point on a codim-1 bifurcation curve (in two-parameter space).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Codim1CurvePoint {
    /// State vector at the bifurcation point
    pub state: Vec<f64>,
    /// Value of first active parameter
    pub param1_value: f64,
    /// Value of second active parameter
    pub param2_value: f64,
    /// Detected codim-2 bifurcation type (None if regular point)
    pub codim2_type: Codim2BifurcationType,
    /// Auxiliary variable (e.g., κ=ω² for Hopf, θ for NS)
    #[serde(default)]
    pub auxiliary: Option<f64>,
    /// Eigenvalues at this point
    #[serde(default)]
    pub eigenvalues: Vec<Complex<f64>>,
}

/// A complete codim-1 bifurcation curve branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Codim1CurveBranch {
    /// Type of curve being continued
    pub curve_type: Codim1CurveType,
    /// Index of first active parameter
    pub param1_index: usize,
    /// Index of second active parameter
    pub param2_index: usize,
    /// Points on the curve
    pub points: Vec<Codim1CurvePoint>,
    /// Indices of points where codim-2 bifurcations were detected
    pub codim2_bifurcations: Vec<usize>,
    /// Arclength indices relative to start (0)
    pub indices: Vec<i32>,
}

// ============================================================================
// Streaming Progress Types
// ============================================================================

/// Result of a stepping operation for progress reporting.
///
/// This is designed for streaming updates from long-running continuation
/// loops without exposing internal solver state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// Whether continuation is complete
    pub done: bool,
    /// Current step number (0-based)
    pub current_step: usize,
    /// Maximum steps configured
    pub max_steps: usize,
    /// Number of points computed so far
    pub points_computed: usize,
    /// Number of bifurcations found so far
    pub bifurcations_found: usize,
    /// Current parameter value (for live display)
    pub current_param: f64,
    /// Number of manifold rings accepted so far (when applicable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rings_computed: Option<usize>,
}

impl StepResult {
    pub fn new(
        done: bool,
        current_step: usize,
        max_steps: usize,
        points_computed: usize,
        bifurcations_found: usize,
        current_param: f64,
    ) -> Self {
        Self {
            done,
            current_step,
            max_steps,
            points_computed,
            bifurcations_found,
            current_param,
            rings_computed: None,
        }
    }

    pub fn with_rings_computed(mut self, rings_computed: usize) -> Self {
        self.rings_computed = Some(rings_computed);
        self
    }
}
