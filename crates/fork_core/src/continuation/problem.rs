use anyhow::Result;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

use super::BifurcationType;

/// Generic diagnostics reported by a continuation problem at a given point.
#[derive(Debug, Clone)]
pub struct PointDiagnostics {
    pub test_values: TestFunctionValues,
    pub eigenvalues: Vec<Complex<f64>>,
    pub cycle_points: Option<Vec<Vec<f64>>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TestFunctionValues {
    pub fold: f64,
    pub hopf: f64,
    pub neutral_saddle: f64,
    pub cycle_fold: f64,
    pub period_doubling: f64,
    pub neimark_sacker: f64,
}

impl TestFunctionValues {
    pub fn equilibrium(fold: f64, hopf: f64, neutral_saddle: f64) -> Self {
        Self {
            fold,
            hopf,
            neutral_saddle,
            cycle_fold: 1.0,
            period_doubling: 1.0,
            neimark_sacker: 1.0,
        }
    }

    pub fn limit_cycle(cycle_fold: f64, period_doubling: f64, neimark_sacker: f64) -> Self {
        Self {
            fold: 1.0,
            hopf: 1.0,
            neutral_saddle: 1.0,
            cycle_fold,
            period_doubling,
            neimark_sacker,
        }
    }

    pub fn value_for(&self, kind: BifurcationType) -> f64 {
        match kind {
            BifurcationType::Fold => self.fold,
            BifurcationType::Hopf => self.hopf,
            BifurcationType::NeutralSaddle => self.neutral_saddle,
            BifurcationType::CycleFold => self.cycle_fold,
            BifurcationType::PeriodDoubling => self.period_doubling,
            BifurcationType::NeimarkSacker => self.neimark_sacker,
            BifurcationType::None => 0.0,
        }
    }

    pub fn is_finite(&self) -> bool {
        self.fold.is_finite()
            && self.hopf.is_finite()
            && self.neutral_saddle.is_finite()
            && self.cycle_fold.is_finite()
            && self.period_doubling.is_finite()
            && self.neimark_sacker.is_finite()
    }
}

/// Core interface implemented by any system that can be continued via PALC.
pub trait ContinuationProblem {
    /// Number of state variables (excluding the continuation parameter).
    fn dimension(&self) -> usize;

    /// Evaluate the residual F(aug_state) and write into `out`.
    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()>;

    /// Compute the extended Jacobian (derivative of F w.r.t. [p, x]).
    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>>;

    /// Diagonal weights for the pseudo-arclength inner product on `[p, x]`.
    ///
    /// The default is the Euclidean metric. Discretized problems should override
    /// this with quadrature weights so that tangent normalization and corrector
    /// hyperplanes do not change when the mesh is refined. Every weight must be
    /// finite and strictly positive.
    fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
        Ok(DVector::from_element(self.dimension() + 1, 1.0))
    }

    /// Return diagnostics (test functions, eigenvalues, etc.) for bifurcation detection.
    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics>;

    /// Check whether a converged trial point is accurate enough to accept.
    ///
    /// Discretized problems can reject an under-resolved point here without
    /// aborting the continuation or mutating reference/gauge state. A rejected
    /// trial is retried with a smaller pseudo-arclength step.
    fn is_step_acceptable(&mut self, _aug_state: &DVector<f64>) -> Result<bool> {
        Ok(true)
    }

    /// Optional hook called after each successful continuation step.
    /// Used by some problems to update internal state (e.g., phase conditions for LCs).
    fn update_after_step(&mut self, _aug_state: &DVector<f64>) -> Result<()> {
        Ok(()) // Default no-op
    }
}
