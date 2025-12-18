//! Utility functions for continuation analysis.
//!
//! This module contains helper functions for tangent computation,
//! eigenvalue analysis, and test functions for bifurcation detection.

use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector, SymmetricEigen};
use num_complex::Complex;

use super::types::ContinuationPoint;

/// Computes the null space tangent from an extended Jacobian matrix.
/// 
/// Uses Gram-Schmidt eigenvalue decomposition first, falling back to
/// bordered linear solve if that fails.
pub fn compute_nullspace_tangent(j_ext: &DMatrix<f64>) -> Result<DVector<f64>> {
    if let Some(vec) = try_gram_eigen(j_ext) {
        return Ok(vec);
    }
    compute_tangent_linear_solve(j_ext)
}

/// Attempts to compute the tangent via Gram matrix eigendecomposition.
fn try_gram_eigen(j_ext: &DMatrix<f64>) -> Option<DVector<f64>> {
    if j_ext.ncols() == 0 {
        return None;
    }

    let gram = j_ext.transpose() * j_ext;
    if gram.iter().any(|v| !v.is_finite()) {
        return None;
    }

    let identity = DMatrix::identity(gram.nrows(), gram.ncols());
    let mut epsilon = 0.0;

    for _ in 0..5 {
        let adjusted = if epsilon == 0.0 {
            gram.clone()
        } else {
            &gram + identity.scale(epsilon)
        };

        let eig = SymmetricEigen::new(adjusted.clone());
        if eig.eigenvalues.is_empty() {
            return None;
        }

        let mut min_idx = 0;
        let mut min_val = eig.eigenvalues[0];
        for (i, &val) in eig.eigenvalues.iter().enumerate().skip(1) {
            if !val.is_finite() {
                continue;
            }
            if val < min_val {
                min_val = val;
                min_idx = i;
            }
        }

        if !min_val.is_finite() {
            epsilon = if epsilon == 0.0 {
                1e-12
            } else {
                epsilon * 10.0
            };
            continue;
        }

        let vec = eig.eigenvectors.column(min_idx).into_owned();
        if vec.norm_squared() == 0.0 || vec.iter().any(|v| !v.is_finite()) {
            return None;
        }
        return Some(vec);
    }

    None
}

/// Computes the tangent via bordered linear system solve.
fn compute_tangent_linear_solve(j_ext: &DMatrix<f64>) -> Result<DVector<f64>> {
    let dim = j_ext.nrows();
    if dim == 0 {
        bail!("Failed to compute tangent: zero-dimensional system");
    }

    let mut a = DMatrix::zeros(dim + 1, dim + 1);
    a.view_mut((0, 0), (dim, dim + 1)).copy_from(j_ext);
    let mut rhs = DVector::zeros(dim + 1);
    rhs[dim] = 1.0;

    for col in 0..=dim {
        for j in 0..=dim {
            a[(dim, j)] = 0.0;
        }
        a[(dim, col)] = 1.0;

        if let Some(solution) = a.clone().lu().solve(&rhs) {
            if solution.iter().all(|v| v.is_finite()) && solution.norm_squared() != 0.0 {
                return Ok(solution);
            }
        }
    }

    bail!("Failed to compute tangent: all bordered solves singular")
}

/// Converts a ContinuationPoint to an augmented state vector [p, x...].
pub fn continuation_point_to_aug(point: &ContinuationPoint) -> DVector<f64> {
    let mut aug = DVector::zeros(point.state.len() + 1);
    aug[0] = point.param_value;
    for (i, &val) in point.state.iter().enumerate() {
        aug[i + 1] = val;
    }
    aug
}

/// Computes eigenvalues from a matrix.
pub fn compute_eigenvalues(mat: &DMatrix<f64>) -> Result<Vec<Complex<f64>>> {
    if mat.nrows() == 0 {
        return Ok(Vec::new());
    }

    let eigen = mat.clone().complex_eigenvalues();
    Ok(eigen.iter().cloned().collect())
}

/// Hopf test function: product of pairwise eigenvalue sums.
/// Zero crossing indicates a Hopf bifurcation.
pub fn hopf_test_function(eigenvalues: &[Complex<f64>]) -> Complex<f64> {
    let mut product = Complex::new(1.0, 0.0);
    for i in 0..eigenvalues.len() {
        for j in (i + 1)..eigenvalues.len() {
            product *= eigenvalues[i] + eigenvalues[j];
        }
    }
    product
}

/// Neutral saddle test function: product of pairwise real eigenvalue sums.
/// Zero crossing indicates a neutral saddle (heteroclinic connection).
pub fn neutral_saddle_test_function(eigenvalues: &[Complex<f64>]) -> f64 {
    const IMAG_EPS: f64 = 1e-8;
    let mut product = 1.0;
    let mut found_pair = false;

    for i in 0..eigenvalues.len() {
        if eigenvalues[i].im.abs() >= IMAG_EPS {
            continue;
        }
        for j in (i + 1)..eigenvalues.len() {
            if eigenvalues[j].im.abs() >= IMAG_EPS {
                continue;
            }
            found_pair = true;
            product *= eigenvalues[i].re + eigenvalues[j].re;
        }
    }

    if found_pair {
        product
    } else {
        1.0
    }
}
