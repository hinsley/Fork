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
