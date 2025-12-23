//! Codim-1 bifurcation curve continuation (two-parameter continuation).
//!
//! This module provides continuation of codim-1 bifurcation curves in
//! two-parameter space, with detection of codim-2 bifurcation points.

mod fold_curve;
mod hopf_curve;

pub use fold_curve::FoldCurveProblem;
pub use hopf_curve::HopfCurveProblem;

use super::types::Codim2BifurcationType;
use anyhow::Result;
use nalgebra::DVector;
use serde::{Deserialize, Serialize};

/// Test function values for codim-2 bifurcation detection on codim-1 curves.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Codim2TestFunctions {
    // Equilibrium codim-2
    pub cusp: f64,
    pub bogdanov_takens: f64,
    pub zero_hopf: f64,
    pub double_hopf: f64,
    pub generalized_hopf: f64,
    // LC codim-2
    pub cusp_cycles: f64,
    pub fold_flip: f64,
    pub fold_ns: f64,
    pub flip_ns: f64,
    pub double_ns: f64,
    pub gpd: f64,
    pub chenciner: f64,
    pub resonance_1_1: f64,
    pub resonance_1_2: f64,
    pub resonance_1_3: f64,
    pub resonance_1_4: f64,
}

impl Codim2TestFunctions {
    /// Returns the test function value for a specific codim-2 type.
    pub fn value_for(&self, bif_type: Codim2BifurcationType) -> f64 {
        match bif_type {
            Codim2BifurcationType::None => 0.0,
            Codim2BifurcationType::Cusp => self.cusp,
            Codim2BifurcationType::BogdanovTakens => self.bogdanov_takens,
            Codim2BifurcationType::ZeroHopf => self.zero_hopf,
            Codim2BifurcationType::DoubleHopf => self.double_hopf,
            Codim2BifurcationType::GeneralizedHopf => self.generalized_hopf,
            Codim2BifurcationType::CuspOfCycles => self.cusp_cycles,
            Codim2BifurcationType::FoldFlip => self.fold_flip,
            Codim2BifurcationType::FoldNeimarkSacker => self.fold_ns,
            Codim2BifurcationType::FlipNeimarkSacker => self.flip_ns,
            Codim2BifurcationType::DoubleNeimarkSacker => self.double_ns,
            Codim2BifurcationType::GeneralizedPeriodDoubling => self.gpd,
            Codim2BifurcationType::Chenciner => self.chenciner,
            Codim2BifurcationType::Resonance1_1 => self.resonance_1_1,
            Codim2BifurcationType::Resonance1_2 => self.resonance_1_2,
            Codim2BifurcationType::Resonance1_3 => self.resonance_1_3,
            Codim2BifurcationType::Resonance1_4 => self.resonance_1_4,
        }
    }

    /// Check which test functions have changed sign between two points.
    pub fn detect_sign_changes(&self, prev: &Self) -> Vec<Codim2BifurcationType> {
        let mut detected = Vec::new();
        
        let checks = [
            (self.cusp, prev.cusp, Codim2BifurcationType::Cusp),
            (self.bogdanov_takens, prev.bogdanov_takens, Codim2BifurcationType::BogdanovTakens),
            (self.zero_hopf, prev.zero_hopf, Codim2BifurcationType::ZeroHopf),
            (self.double_hopf, prev.double_hopf, Codim2BifurcationType::DoubleHopf),
            (self.generalized_hopf, prev.generalized_hopf, Codim2BifurcationType::GeneralizedHopf),
            (self.cusp_cycles, prev.cusp_cycles, Codim2BifurcationType::CuspOfCycles),
            (self.fold_flip, prev.fold_flip, Codim2BifurcationType::FoldFlip),
            (self.fold_ns, prev.fold_ns, Codim2BifurcationType::FoldNeimarkSacker),
            (self.flip_ns, prev.flip_ns, Codim2BifurcationType::FlipNeimarkSacker),
            (self.double_ns, prev.double_ns, Codim2BifurcationType::DoubleNeimarkSacker),
            (self.gpd, prev.gpd, Codim2BifurcationType::GeneralizedPeriodDoubling),
            (self.chenciner, prev.chenciner, Codim2BifurcationType::Chenciner),
            (self.resonance_1_1, prev.resonance_1_1, Codim2BifurcationType::Resonance1_1),
            (self.resonance_1_2, prev.resonance_1_2, Codim2BifurcationType::Resonance1_2),
            (self.resonance_1_3, prev.resonance_1_3, Codim2BifurcationType::Resonance1_3),
            (self.resonance_1_4, prev.resonance_1_4, Codim2BifurcationType::Resonance1_4),
        ];

        for (current, previous, bif_type) in checks {
            // Check for sign change (both values finite and different signs)
            if current.is_finite() && previous.is_finite() 
                && current * previous < 0.0 
            {
                detected.push(bif_type);
            }
        }

        detected
    }
}

/// Borders for the bordered linear system used in fold/Hopf curve continuation.
#[derive(Debug, Clone)]
pub struct Borders {
    /// Left border vector(s) - spans nullspace of A
    pub v: DVector<f64>,
    /// Right border vector(s) - spans nullspace of A^T
    pub w: DVector<f64>,
}

impl Borders {
    /// Create new borders from approximate null vectors.
    pub fn new(v: DVector<f64>, w: DVector<f64>) -> Self {
        Self { v, w }
    }

    /// Update borders after a continuation step to maintain regularity.
    /// 
    /// Algorithm (matches reference):
    /// 1. Build bordered matrix [A, w; v', 0]
    /// 2. Solve Bord * vext = [0; 1] to get new v
    /// 3. Solve Bord' * wext = [0; 1] to get new w
    /// 4. Extract first n components and normalize
    pub fn update(&mut self, jac: &nalgebra::DMatrix<f64>) -> Result<()> {
        let n = jac.nrows();
        if n == 0 {
            return Ok(());
        }

        // Build bordered matrix [A, w; v', 0]
        let mut bordered = nalgebra::DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);
        for i in 0..n {
            bordered[(i, n)] = self.w[i];
            bordered[(n, i)] = self.v[i];
        }
        bordered[(n, n)] = 0.0;

        // RHS = [0; ...; 0; 1]
        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        // Solve Bord * vext = rhs
        let lu = bordered.clone().lu();
        if let Some(vext) = lu.solve(&rhs) {
            let v_new: DVector<f64> = vext.rows(0, n).into();
            let v_norm = v_new.norm();
            if v_norm > 1e-12 {
                self.v = v_new / v_norm;
            }
        }

        // Solve Bord' * wext = rhs
        let lu_t = bordered.transpose().lu();
        if let Some(wext) = lu_t.solve(&rhs) {
            let w_new: DVector<f64> = wext.rows(0, n).into();
            let w_norm = w_new.norm();
            if w_norm > 1e-12 {
                self.w = w_new / w_norm;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codim2_sign_change_detection() {
        let prev = Codim2TestFunctions {
            cusp: 1.0,
            bogdanov_takens: -0.5,
            zero_hopf: 0.1,
            ..Default::default()
        };

        let curr = Codim2TestFunctions {
            cusp: -0.5, // Sign change
            bogdanov_takens: -0.2, // No sign change
            zero_hopf: -0.1, // Sign change
            ..Default::default()
        };

        let detected = curr.detect_sign_changes(&prev);
        assert!(detected.contains(&Codim2BifurcationType::Cusp));
        assert!(detected.contains(&Codim2BifurcationType::ZeroHopf));
        assert!(!detected.contains(&Codim2BifurcationType::BogdanovTakens));
    }
}
