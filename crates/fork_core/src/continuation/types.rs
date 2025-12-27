//! Core types for continuation analysis.
//!
//! This module contains the fundamental data structures used throughout
//! the continuation analysis system.

use num_complex::Complex;
use serde::{Deserialize, Serialize};

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
}

/// Type of continuation branch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum BranchType {
    Equilibrium,
    LimitCycle { ntst: usize, ncol: usize },
}

impl Default for BranchType {
    fn default() -> Self {
        BranchType::Equilibrium
    }
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// Whether continuation is complete
    pub done: bool,
    /// Current step number
    pub current_step: usize,
    /// Maximum steps configured
    pub max_steps: usize,
    /// Number of points computed so far
    pub points_computed: usize,
    /// Number of bifurcations found so far
    pub bifurcations_found: usize,
    /// Current parameter value (for live display)
    pub current_param: f64,
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
        }
    }
}
