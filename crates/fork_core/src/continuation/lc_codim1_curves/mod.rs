//! Codim-1 bifurcation curve continuation for limit cycles (two-parameter continuation).
//!
//! This module provides continuation of codim-1 bifurcation curves of limit cycles
//! in two-parameter space:
//! - LPC (Limit Point of Cycles) - fold bifurcation curve
//! - PD (Period Doubling) - flip bifurcation curve
//! - NS (Neimark-Sacker) - torus bifurcation curve

mod lpc_curve;
mod ns_curve;
mod pd_curve;

pub use lpc_curve::LPCCurveProblem;
pub use ns_curve::NSCurveProblem;
pub use pd_curve::PDCurveProblem;

use anyhow::Result;
use nalgebra::{DMatrix, DVector};

/// Border vectors for LC bifurcation curve continuation.
///
/// These represent the null vectors of the singular BVP Jacobian that define
/// the bifurcation condition. For LPC and PD, this is a single pair (φ, ψ).
/// For NS, two pairs are needed for the complex eigenspace.
#[derive(Debug, Clone)]
pub struct LCBorders {
    /// Left null vector φ (spans nullspace of singular Jacobian)
    pub phi: DVector<f64>,
    /// Right null vector ψ (spans nullspace of adjoint)
    pub psi: DVector<f64>,
}

impl LCBorders {
    /// Create new LC borders from null vectors.
    pub fn new(phi: DVector<f64>, psi: DVector<f64>) -> Self {
        Self { phi, psi }
    }

    /// Initialize borders from a singular BVP Jacobian.
    ///
    /// Uses random bordering to find initial null vectors.
    #[allow(dead_code)]
    pub fn initialize_from_jacobian(jac: &DMatrix<f64>) -> Result<Self> {
        let n = jac.nrows();

        // Build bordered system with random vectors
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);

        // Use random border vectors for initial solve
        for i in 0..n {
            bordered[(i, n)] = rand_val(i);
            bordered[(n, i)] = rand_val(i + n);
        }
        bordered[(n, n)] = 0.0;

        // RHS = [0, ..., 0, 1]
        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        // Solve for φ
        let lu = bordered.clone().lu();
        let phi = if let Some(sol) = lu.solve(&rhs) {
            let phi_raw: DVector<f64> = sol.rows(0, n).into();
            let norm = phi_raw.norm();
            if norm > 1e-12 {
                phi_raw / norm
            } else {
                DVector::zeros(n)
            }
        } else {
            DVector::zeros(n)
        };

        // Solve for ψ using transpose
        let lu_t = bordered.transpose().lu();
        let psi = if let Some(sol) = lu_t.solve(&rhs) {
            let psi_raw: DVector<f64> = sol.rows(0, n).into();
            let norm = psi_raw.norm();
            if norm > 1e-12 {
                psi_raw / norm
            } else {
                DVector::zeros(n)
            }
        } else {
            DVector::zeros(n)
        };

        Ok(Self { phi, psi })
    }

    /// Update borders after a step using current φ/ψ as bordering.
    ///
    /// This follows the standard adapt() pattern.
    pub fn update(&mut self, jac: &DMatrix<f64>) -> Result<()> {
        let n = jac.nrows();
        if n == 0 {
            return Ok(());
        }

        // Build bordered matrix [J, ψ; φ', 0]
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);
        for i in 0..n {
            bordered[(i, n)] = self.psi[i];
            bordered[(n, i)] = self.phi[i];
        }
        bordered[(n, n)] = 0.0;

        // RHS = [0, ..., 0, 1]
        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        // Solve Bord * ext = rhs for new φ
        let lu = bordered.clone().lu();
        if let Some(ext) = lu.solve(&rhs) {
            let phi_new: DVector<f64> = ext.rows(0, n).into();
            let norm = phi_new.norm();
            if norm > 1e-12 {
                self.phi = phi_new / norm;
            }
        }

        // Solve Bord' * ext = rhs for new ψ
        let lu_t = bordered.transpose().lu();
        if let Some(ext) = lu_t.solve(&rhs) {
            let psi_new: DVector<f64> = ext.rows(0, n).into();
            let norm = psi_new.norm();
            if norm > 1e-12 {
                self.psi = psi_new / norm;
            }
        }

        Ok(())
    }
}

/// Simple pseudo-random value generator for initialization.
/// Uses a fixed seed pattern for reproducibility.
fn rand_val(i: usize) -> f64 {
    let x = ((i as f64 + 1.0) * 0.618033988749895) % 1.0;
    2.0 * x - 1.0 // Map to [-1, 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lc_borders_creation() {
        let phi = DVector::from_vec(vec![1.0, 0.0, 0.0]);
        let psi = DVector::from_vec(vec![0.0, 1.0, 0.0]);
        let borders = LCBorders::new(phi.clone(), psi.clone());
        assert_eq!(borders.phi, phi);
        assert_eq!(borders.psi, psi);
    }
}
