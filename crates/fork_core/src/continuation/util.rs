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
    let dim = j_ext.nrows();
    if dim == 0 {
        bail!("Failed to compute tangent: zero-dimensional system");
    }
    if j_ext.ncols() != dim + 1 {
        bail!(
            "Failed to compute tangent: expected {} columns, got {}",
            dim + 1,
            j_ext.ncols()
        );
    }
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
    if j_ext.ncols() != dim + 1 {
        bail!(
            "Failed to compute tangent: expected {} columns, got {}",
            dim + 1,
            j_ext.ncols()
        );
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

/// Hopf test function: product of sums for conjugate eigenpairs.
/// Zero crossing of the real part indicates a Hopf bifurcation.
pub fn hopf_test_function(eigenvalues: &[Complex<f64>]) -> Complex<f64> {
    const IMAG_EPS: f64 = 1e-8;
    let mut product = Complex::new(1.0, 0.0);
    let mut found_pair = false;

    for i in 0..eigenvalues.len() {
        let eig_i = eigenvalues[i];
        if eig_i.im.abs() < IMAG_EPS {
            continue;
        }
        for j in (i + 1)..eigenvalues.len() {
            let eig_j = eigenvalues[j];
            if eig_j.im.abs() < IMAG_EPS {
                continue;
            }
            if eig_i.im.signum() == eig_j.im.signum() {
                continue;
            }
            found_pair = true;
            product *= eig_i + eig_j;
        }
    }

    if found_pair {
        product
    } else {
        Complex::new(1.0, 0.0)
    }
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

#[cfg(test)]
mod tests_additional {
    use super::{
        compute_eigenvalues, compute_nullspace_tangent, continuation_point_to_aug,
        hopf_test_function, neutral_saddle_test_function,
    };
    use crate::continuation::types::{BifurcationType, ContinuationPoint};
    use nalgebra::DMatrix;
    use num_complex::Complex;

    #[test]
    fn compute_nullspace_tangent_finds_null_vector() {
        let mat = DMatrix::from_row_slice(2, 3, &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        let tangent = compute_nullspace_tangent(&mat).expect("tangent should compute");
        let residual = &mat * &tangent;
        assert!(tangent.norm() > 0.0);
        assert!(residual.iter().all(|v| v.abs() < 1e-9));
    }

    #[test]
    fn continuation_point_to_aug_places_param_first() {
        let point = ContinuationPoint {
            state: vec![1.0, 2.0],
            param_value: 3.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
        };
        let aug = continuation_point_to_aug(&point);
        assert_eq!(aug.as_slice(), &[3.0, 1.0, 2.0]);
    }

    #[test]
    fn compute_eigenvalues_handles_diagonal_matrix() {
        let mat = DMatrix::from_row_slice(2, 2, &[1.0, 0.0, 0.0, 2.0]);
        let mut eigenvalues = compute_eigenvalues(&mat).expect("eigenvalues should compute");
        eigenvalues.sort_by(|a, b| a.re.partial_cmp(&b.re).unwrap());
        assert!((eigenvalues[0].re - 1.0).abs() < 1e-12);
        assert!((eigenvalues[1].re - 2.0).abs() < 1e-12);
    }

    #[test]
    fn hopf_test_function_zero_for_canceling_pair() {
        let eigenvalues = vec![Complex::new(1.0, 0.0), Complex::new(-1.0, 0.0)];
        let value = hopf_test_function(&eigenvalues);
        assert!((value.re - 1.0).abs() < 1e-12);
    }

    #[test]
    fn neutral_saddle_test_function_defaults_when_no_real_pairs() {
        let eigenvalues = vec![Complex::new(0.0, 1.0), Complex::new(0.0, -1.0)];
        let value = neutral_saddle_test_function(&eigenvalues);
        assert!((value - 1.0).abs() < 1e-12);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::types::{BifurcationType, ContinuationPoint};
    use nalgebra::{DMatrix, DVector};
    use num_complex::Complex;

    fn assert_err_contains<T: std::fmt::Debug>(result: Result<T>, needle: &str) {
        let err = result.expect_err("expected error");
        let message = format!("{err}");
        assert!(
            message.contains(needle),
            "expected error to contain \"{needle}\", got \"{message}\""
        );
    }

    #[test]
    fn continuation_point_to_aug_puts_param_first() {
        let point = ContinuationPoint {
            state: vec![1.0, 2.0],
            param_value: 3.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
        };

        let aug = continuation_point_to_aug(&point);

        assert_eq!(aug.len(), 3);
        assert_eq!(aug[0], 3.0);
        assert_eq!(aug[1], 1.0);
        assert_eq!(aug[2], 2.0);
    }

    #[test]
    fn compute_eigenvalues_handles_empty_and_real() {
        let empty = DMatrix::<f64>::zeros(0, 0);
        let values = compute_eigenvalues(&empty).expect("empty eigenvalues should be ok");
        assert!(values.is_empty());

        let mat = DMatrix::from_diagonal(&DVector::from_vec(vec![1.0, 2.0]));
        let mut values = compute_eigenvalues(&mat).expect("eigenvalues should compute");
        values.sort_by(|a, b| a.re.partial_cmp(&b.re).unwrap());
        assert!((values[0].re - 1.0).abs() < 1e-12);
        assert!((values[1].re - 2.0).abs() < 1e-12);
        assert!(values.iter().all(|v| v.im.abs() < 1e-12));
    }

    #[test]
    fn compute_nullspace_tangent_returns_null_vector() {
        let j_ext = DMatrix::from_row_slice(1, 2, &[1.0, 2.0]);
        let tangent = compute_nullspace_tangent(&j_ext).expect("tangent should compute");
        let residual = 1.0 * tangent[0] + 2.0 * tangent[1];
        assert!(residual.abs() < 1e-8);
    }

    #[test]
    fn compute_nullspace_tangent_rejects_invalid_shape() {
        let j_ext = DMatrix::from_row_slice(2, 2, &[1.0, 0.0, 0.0, 1.0]);
        let err = compute_nullspace_tangent(&j_ext).expect_err("expected shape error");
        let message = format!("{err}");
        assert!(message.contains("expected 3 columns"));
    }

    #[test]
    fn compute_tangent_linear_solve_returns_null_vector() {
        let j_ext = DMatrix::from_row_slice(1, 2, &[1.0, 2.0]);
        let tangent = compute_tangent_linear_solve(&j_ext).expect("tangent should compute");
        let residual = 1.0 * tangent[0] + 2.0 * tangent[1];
        assert!(residual.abs() < 1e-8);
    }

    #[test]
    fn compute_nullspace_tangent_errors_on_empty_matrix() {
        let j_ext = DMatrix::<f64>::zeros(0, 0);
        assert_err_contains(
            compute_nullspace_tangent(&j_ext),
            "zero-dimensional system",
        );
    }

    #[test]
    fn compute_tangent_linear_solve_errors_on_singular_system() {
        let j_ext = DMatrix::<f64>::zeros(1, 2);
        assert_err_contains(compute_tangent_linear_solve(&j_ext), "all bordered solves");
    }

    #[test]
    fn hopf_test_function_zero_crossing() {
        let eigenvalues = vec![Complex::new(0.0, 1.0), Complex::new(0.0, -1.0)];
        let value = hopf_test_function(&eigenvalues);
        assert!(value.norm() < 1e-12);
    }

    #[test]
    fn neutral_saddle_test_function_handles_real_and_complex_pairs() {
        let real_pair = vec![Complex::new(1.0, 0.0), Complex::new(-1.0, 0.0)];
        let real_value = neutral_saddle_test_function(&real_pair);
        assert!(real_value.abs() < 1e-12);

        let complex_pair = vec![Complex::new(0.0, 1.0), Complex::new(0.0, -1.0)];
        let complex_value = neutral_saddle_test_function(&complex_pair);
        assert!((complex_value - 1.0).abs() < 1e-12);
    }
}
