//! Equilibrium Zero-Hopf and Hopf-Hopf normal forms.
//!
//! The coefficient conventions follow Kuznetsov's multilinear-form
//! normalization and the predictors implemented by BifurcationKit.  In
//! particular, `B = D^2 F` and `C = D^3 F`; no factorials are hidden in the
//! multilinear forms.  The retained eigenvectors, homological residuals, and
//! unfolding condition numbers make every branch-switching decision
//! inspectable after serialization.

use super::normal_forms::{
    bilinear_complex, bilinear_real, complex_matrix_from_real, hermitian_inner, multilinear_complex,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, compute_param_jacobian, SystemKind};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

const MIN_VECTOR_NORM: f64 = 1e-13;
const MIN_PAIRING: f64 = 1e-9;
const MIN_FREQUENCY: f64 = 1e-8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EquilibriumCodim2NormalFormDiagnostics {
    pub jacobian_condition_number: f64,
    pub unfolding_condition_number: f64,
    pub minimum_eigenvector_pairing: f64,
    pub max_eigen_residual: f64,
    pub max_homological_residual: f64,
    /// Distance from the nearest low-order internal frequency resonance.
    pub resonance_distance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZeroHopfNormalForm {
    pub state: Vec<f64>,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_value: f64,
    pub param2_value: f64,
    pub frequency: f64,
    pub zero_eigenvalue: f64,
    pub q0: Vec<f64>,
    pub p0: Vec<f64>,
    pub q1: Vec<Complex<f64>>,
    pub p1: Vec<Complex<f64>>,
    /// `G200 = p0^T B(q0,q0)`.
    pub g200: f64,
    /// `G011 = p0^T B(q1,q1_bar)`.
    pub g011: f64,
    /// `G110 = p1^* B(q0,q1)`.
    pub g110: Complex<f64>,
    pub g111: Complex<f64>,
    pub g021: Complex<f64>,
    pub f200: f64,
    pub f011: f64,
    pub f111: f64,
    pub reduced_g021: Complex<f64>,
    /// Parameter directions used by the Zero-Hopf cycle predictor.
    pub v10: [f64; 2],
    pub v01: [f64; 2],
    pub h200: Vec<f64>,
    pub h110: Vec<Complex<f64>>,
    pub h020: Vec<Complex<f64>>,
    pub h011: Vec<f64>,
    pub h00010: Vec<Complex<f64>>,
    pub h00001: Vec<Complex<f64>>,
    /// Center displacement coefficient on the NS-of-cycles branch.
    pub ns_center_coefficient: f64,
    /// Reduced unfolding coefficients multiplying amplitude squared.
    pub ns_beta1: f64,
    pub ns_beta2: f64,
    pub has_neimark_sacker: bool,
    pub diagnostics: EquilibriumCodim2NormalFormDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HopfHopfNeimarkSackerPredictor {
    /// Oscillatory mode that generates the periodic orbit (1 or 2).
    pub periodic_mode: usize,
    /// `alpha` in `p = p_HH - alpha * amplitude^2`.
    pub parameter_quadratic: [f64; 2],
    pub frequency1_quadratic: f64,
    pub frequency2_quadratic: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HopfHopfNormalForm {
    pub state: Vec<f64>,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_value: f64,
    pub param2_value: f64,
    pub frequency1: f64,
    pub frequency2: f64,
    pub q1: Vec<Complex<f64>>,
    pub p1: Vec<Complex<f64>>,
    pub q2: Vec<Complex<f64>>,
    pub p2: Vec<Complex<f64>>,
    pub g2100: Complex<f64>,
    pub g0021: Complex<f64>,
    pub g1110: Complex<f64>,
    pub g1011: Complex<f64>,
    /// Parameter-to-modal-eigenvalue unfolding matrix, stored by rows.
    pub gamma: [[Complex<f64>; 2]; 2],
    pub h2000: Vec<Complex<f64>>,
    pub h0020: Vec<Complex<f64>>,
    pub h1100: Vec<Complex<f64>>,
    pub h0011: Vec<Complex<f64>>,
    pub parameter_state1: Vec<f64>,
    pub parameter_state2: Vec<f64>,
    pub neimark_sacker_predictors: Vec<HopfHopfNeimarkSackerPredictor>,
    pub diagnostics: EquilibriumCodim2NormalFormDiagnostics,
}

fn finite_difference_step(value: f64) -> f64 {
    f64::EPSILON.powf(1.0 / 3.0) * (1.0 + value.abs())
}

fn condition_number_real(matrix: &DMatrix<f64>) -> f64 {
    if matrix.nrows() == 0 || matrix.ncols() == 0 {
        return f64::NAN;
    }
    let svd = matrix.clone().svd(false, false);
    let largest = svd.singular_values.iter().copied().fold(0.0, f64::max);
    let smallest = svd
        .singular_values
        .iter()
        .copied()
        .filter(|value| *value > f64::EPSILON * largest.max(1.0))
        .fold(f64::INFINITY, f64::min);
    if smallest.is_finite() {
        largest / smallest
    } else {
        f64::INFINITY
    }
}

fn smallest_right_singular_vector(matrix: &DMatrix<f64>) -> Result<DVector<f64>> {
    let svd = matrix.clone().svd(false, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Codimension-two SVD omitted right singular vectors"))?;
    let mut vector = v_t.row(v_t.nrows() - 1).transpose().into_owned();
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_VECTOR_NORM {
        bail!("Codimension-two singular vector is degenerate");
    }
    vector /= norm;
    let pivot = vector
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    if vector[pivot] < 0.0 {
        vector = -vector;
    }
    Ok(vector)
}

fn complex_eigenvector(
    matrix: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<DVector<Complex<f64>>> {
    let n = matrix.nrows();
    let mut shifted = complex_matrix_from_real(matrix);
    for index in 0..n {
        shifted[(index, index)] -= eigenvalue;
    }
    let svd = shifted.svd(false, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Codimension-two eigensolve omitted right singular vectors"))?;
    let mut vector = DVector::from_iterator(n, (0..n).map(|i| v_t[(n - 1, i)].conj()));
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_VECTOR_NORM {
        bail!("Codimension-two complex eigenvector is degenerate");
    }
    vector /= Complex::new(norm, 0.0);
    Ok(vector)
}

#[allow(clippy::type_complexity)]
fn normalized_complex_eigenpair(
    matrix: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<(DVector<Complex<f64>>, DVector<Complex<f64>>, f64)> {
    let q = complex_eigenvector(matrix, eigenvalue)?;
    let mut p = complex_eigenvector(&matrix.transpose(), eigenvalue.conj())?;
    let pairing = hermitian_inner(&p, &q);
    if !pairing.norm().is_finite() || pairing.norm() <= MIN_PAIRING {
        bail!("Codimension-two left/right eigenvector pairing is singular");
    }
    let pairing_norm = pairing.norm();
    p /= pairing.conj();
    Ok((q, p, pairing_norm))
}

fn normalize_zero_eigenvectors(
    jacobian: &DMatrix<f64>,
) -> Result<(DVector<f64>, DVector<f64>, f64)> {
    let q0 = smallest_right_singular_vector(jacobian)?;
    let mut p0 = smallest_right_singular_vector(&jacobian.transpose())?;
    let pairing = p0.dot(&q0);
    if !pairing.is_finite() || pairing.abs() <= MIN_PAIRING {
        bail!("Zero-Hopf zero-mode left/right pairing is singular");
    }
    let pairing_norm = pairing.abs();
    p0 /= pairing;
    Ok((q0, p0, pairing_norm))
}

fn solve_bordered_real(
    matrix: &DMatrix<f64>,
    right: &DVector<f64>,
    left: &DVector<f64>,
    rhs: &DVector<f64>,
) -> Result<(DVector<f64>, f64)> {
    let n = matrix.nrows();
    let mut bordered = DMatrix::zeros(n + 1, n + 1);
    bordered.view_mut((0, 0), (n, n)).copy_from(matrix);
    bordered.view_mut((0, n), (n, 1)).copy_from(right);
    bordered
        .view_mut((n, 0), (1, n))
        .copy_from(&left.transpose());
    let mut extended_rhs = DVector::zeros(n + 1);
    extended_rhs.rows_mut(0, n).copy_from(rhs);
    let solution = bordered
        .lu()
        .solve(&extended_rhs)
        .ok_or_else(|| anyhow!("Zero-Hopf bordered homological solve is singular"))?;
    Ok((solution.rows(0, n).into_owned(), solution[n]))
}

fn solve_bordered_complex(
    matrix: &DMatrix<Complex<f64>>,
    right: &DVector<Complex<f64>>,
    left: &DVector<Complex<f64>>,
    rhs: &DVector<Complex<f64>>,
) -> Result<(DVector<Complex<f64>>, Complex<f64>)> {
    let n = matrix.nrows();
    let mut bordered = DMatrix::from_element(n + 1, n + 1, Complex::new(0.0, 0.0));
    bordered.view_mut((0, 0), (n, n)).copy_from(matrix);
    bordered.view_mut((0, n), (n, 1)).copy_from(right);
    for index in 0..n {
        bordered[(n, index)] = left[index].conj();
    }
    let mut extended_rhs = DVector::from_element(n + 1, Complex::new(0.0, 0.0));
    extended_rhs.rows_mut(0, n).copy_from(rhs);
    let solution = bordered
        .lu()
        .solve(&extended_rhs)
        .ok_or_else(|| anyhow!("Complex bordered homological solve is singular"))?;
    Ok((solution.rows(0, n).into_owned(), solution[n]))
}

fn solve_shifted(
    jacobian: &DMatrix<f64>,
    shift: Complex<f64>,
    rhs: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let mut matrix = -complex_matrix_from_real(jacobian);
    for index in 0..matrix.nrows() {
        matrix[(index, index)] += shift;
    }
    matrix
        .lu()
        .solve(rhs)
        .ok_or_else(|| anyhow!("Codimension-two shifted homological solve is singular"))
}

fn parameter_jacobian_derivative(
    system: &mut EquationSystem,
    state: &[f64],
    parameter_index: usize,
) -> Result<DMatrix<f64>> {
    let original = system.params[parameter_index];
    let step = finite_difference_step(original);
    system.params[parameter_index] = original + step;
    let plus = compute_jacobian(system, SystemKind::Flow, state)?;
    system.params[parameter_index] = original - step;
    let minus = compute_jacobian(system, SystemKind::Flow, state)?;
    system.params[parameter_index] = original;
    let n = state.len();
    Ok(
        (DMatrix::from_row_slice(n, n, &plus) - DMatrix::from_row_slice(n, n, &minus))
            / (2.0 * step),
    )
}

fn real_combination(
    first: &DVector<f64>,
    second: &DVector<f64>,
    weights: [f64; 2],
) -> DVector<f64> {
    first * weights[0] + second * weights[1]
}

fn complex_from_real(vector: &DVector<f64>) -> DVector<Complex<f64>> {
    vector.map(|value| Complex::new(value, 0.0))
}

#[allow(clippy::too_many_arguments)]
pub fn zero_hopf_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
    frequency_hint: f64,
) -> Result<ZeroHopfNormalForm> {
    if state.len() != system.equations.len() || state.len() < 3 {
        bail!("Zero-Hopf normal form requires a matching state of dimension at least three");
    }
    if param1_index == param2_index
        || param1_index >= system.params.len()
        || param2_index >= system.params.len()
    {
        bail!("Zero-Hopf normal form requires two distinct valid parameters");
    }
    let old_params = system.params.clone();
    system.params[param1_index] = param1_value;
    system.params[param2_index] = param2_value;
    let result = zero_hopf_normal_form_at_current_params(
        system,
        state,
        param1_index,
        param2_index,
        param1_value,
        param2_value,
        frequency_hint,
    );
    system.params = old_params;
    result
}

#[allow(clippy::too_many_arguments)]
fn zero_hopf_normal_form_at_current_params(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
    frequency_hint: f64,
) -> Result<ZeroHopfNormalForm> {
    let n = state.len();
    let jacobian =
        DMatrix::from_row_slice(n, n, &compute_jacobian(system, SystemKind::Flow, state)?);
    let eigenvalues: Vec<Complex<f64>> = jacobian
        .clone()
        .complex_eigenvalues()
        .iter()
        .copied()
        .collect();
    let zero_eigenvalue = eigenvalues
        .iter()
        .min_by(|left, right| left.norm().total_cmp(&right.norm()))
        .copied()
        .ok_or_else(|| anyhow!("Zero-Hopf Jacobian has no eigenvalues"))?;
    let frequency_target = frequency_hint.abs().max(MIN_FREQUENCY);
    let hopf_eigenvalue = eigenvalues
        .iter()
        .filter(|value| value.im > MIN_FREQUENCY)
        .min_by(|left, right| {
            let left_score = left.re.abs() + (left.im - frequency_target).abs();
            let right_score = right.re.abs() + (right.im - frequency_target).abs();
            left_score.total_cmp(&right_score)
        })
        .copied()
        .ok_or_else(|| anyhow!("Zero-Hopf point has no positive imaginary eigenvalue"))?;
    let omega = hopf_eigenvalue.im;
    if zero_eigenvalue.norm() > 1e-5 * (1.0 + jacobian.norm())
        || hopf_eigenvalue.re.abs() > 1e-5 * (1.0 + jacobian.norm())
    {
        bail!("Source is not a refined Zero-Hopf point");
    }

    let (q0, p0, zero_pairing) = normalize_zero_eigenvectors(&jacobian)?;
    let (q1, p1, hopf_pairing) = normalized_complex_eigenpair(&jacobian, hopf_eigenvalue)?;
    let q1_bar = q1.map(|value| value.conj());
    let a_complex = complex_matrix_from_real(&jacobian);

    let b_q0_q0 = bilinear_real(system, SystemKind::Flow, state, &q0, &q0)?;
    let b_q0_q1 = bilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &complex_from_real(&q0),
        &q1,
    )?;
    let b_q1_q1 = bilinear_complex(system, SystemKind::Flow, state, &q1, &q1)?;
    let b_q1_qbar = bilinear_complex(system, SystemKind::Flow, state, &q1, &q1_bar)?;
    let g200 = p0.dot(&b_q0_q0);
    let g110 = hermitian_inner(&p1, &b_q0_q1);
    let g011 = p0.dot(&b_q1_qbar.map(|value| value.re));

    let h200_rhs = -b_q0_q0.clone() + q0.clone() * g200;
    let (h200, _) = solve_bordered_real(&jacobian, &q0, &p0, &h200_rhs)?;
    let h020 = solve_shifted(&jacobian, Complex::new(0.0, 2.0 * omega), &b_q1_q1)?;
    let h110_rhs = -b_q0_q1.clone() + q1.clone() * g110;
    let mut resonant_matrix = a_complex.clone();
    for index in 0..n {
        resonant_matrix[(index, index)] -= Complex::new(0.0, omega);
    }
    let (h110, _) = solve_bordered_complex(&resonant_matrix, &q1, &p1, &h110_rhs)?;
    let h011_rhs_real = -b_q1_qbar.map(|value| value.re) + q0.clone() * g011;
    let (h011, _) = solve_bordered_real(&jacobian, &q0, &p0, &h011_rhs_real)?;

    let c_q0_q1_q1 = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[complex_from_real(&q0), q1.clone(), q1.clone()],
    )?;
    let tmp111 = c_q0_q1_q1
        + bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &complex_from_real(&q0),
            &complex_from_real(&h011),
        )?
        + bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &q1,
            &h110.map(|v| v.conj()),
        )?
        + bilinear_complex(system, SystemKind::Flow, state, &q1_bar, &h110)?;
    let g111 = Complex::new(p0.dot(&tmp111.map(|value| value.re)), 0.0);
    let c_q1_q1_qbar = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[q1.clone(), q1.clone(), q1_bar.clone()],
    )?;
    let tmp021 = c_q1_q1_qbar
        + bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &q1,
            &complex_from_real(&h011),
        )? * Complex::new(2.0, 0.0)
        + bilinear_complex(system, SystemKind::Flow, state, &q1_bar, &h020)?;
    let g021_full = hermitian_inner(&p1, &tmp021);

    let f200 = g200 / 2.0;
    if f200.abs() <= 1e-10 {
        bail!("Zero-Hopf quadratic zero-mode coefficient is degenerate");
    }
    let f011 = g011;
    let f111 = g111.re;
    let reduced_g021 = g021_full / Complex::new(2.0, 0.0);

    let f_p1 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param1_index,
    )?);
    let f_p2 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param2_index,
    )?);
    let a_p1 = parameter_jacobian_derivative(system, state, param1_index)?;
    let a_p2 = parameter_jacobian_derivative(system, state, param2_index)?;
    let source_projection = [p0.dot(&f_p1), p0.dot(&f_p2)];
    let projection_norm_squared = source_projection[0].powi(2) + source_projection[1].powi(2);
    if projection_norm_squared <= 1e-16 {
        bail!("Zero-Hopf parameter unfolding has no zero-mode forcing direction");
    }
    let s1 = [
        source_projection[0] / projection_norm_squared,
        source_projection[1] / projection_norm_squared,
    ];
    let s2 = [-s1[1], s1[0]];
    let j_s1 = real_combination(&f_p1, &f_p2, s1);
    let j_s2 = real_combination(&f_p1, &f_p2, s2);
    let (r1, _) = solve_bordered_real(&jacobian, &q0, &p0, &(q0.clone() - j_s1.clone()))?;
    let (r2, _) = solve_bordered_real(&jacobian, &q0, &p0, &j_s2)?;
    let a_s1 = &a_p1 * s1[0] + &a_p2 * s1[1];
    let a_s2 = &a_p1 * s2[0] + &a_p2 * s2[1];
    let ll00 = p0.dot(&(bilinear_real(system, SystemKind::Flow, state, &q0, &r2)? + &a_s2 * &q0));
    let ll10 = hermitian_inner(
        &p1,
        &(bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &q1,
            &complex_from_real(&r2),
        )? + complex_from_real(&(&a_s2 * &q1.map(|value| value.re)))
            + complex_from_real(&(&a_s2 * &q1.map(|value| value.im))) * Complex::new(0.0, 1.0)),
    );
    let ll = DMatrix::from_row_slice(2, 2, &[ll00, 2.0 * f200, ll10.re, g110.re]);
    let rr0 = -p0.dot(&(bilinear_real(system, SystemKind::Flow, state, &q0, &r1)? + &a_s1 * &q0));
    let a_s1_q1 = complex_from_real(&(&a_s1 * &q1.map(|value| value.re)))
        + complex_from_real(&(&a_s1 * &q1.map(|value| value.im))) * Complex::new(0.0, 1.0);
    let rr1 = -hermitian_inner(
        &p1,
        &(bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &q1,
            &complex_from_real(&r1),
        )? + a_s1_q1),
    )
    .re;
    let lu = ll.clone().lu();
    let delta13 = lu
        .solve(&DVector::from_vec(vec![rr0, rr1]))
        .ok_or_else(|| anyhow!("Zero-Hopf unfolding matrix is singular"))?;
    let delta24 = lu
        .solve(&DVector::from_vec(vec![0.0, 1.0]))
        .ok_or_else(|| anyhow!("Zero-Hopf unfolding normalization is singular"))?;
    let v10 = [s1[0] + delta13[0] * s2[0], s1[1] + delta13[0] * s2[1]];
    let v01 = [delta24[0] * s2[0], delta24[0] * s2[1]];
    let h00010 = complex_from_real(&(r1.clone() + r2.clone() * delta13[0]))
        + q1.clone() * Complex::new(delta13[1], 0.0);
    let h00001 =
        complex_from_real(&(r2.clone() * delta24[0])) + q1.clone() * Complex::new(delta24[1], 0.0);

    let ns_center_coefficient = -(f111 + 2.0 * reduced_g021.re) / (2.0 * f200);
    let ns_beta1 = -f011;
    let ns_beta2 = (2.0 * reduced_g021.re * (g110.re - f200) + g110.re * f111) / (2.0 * f200);
    let has_neimark_sacker = g110.re * f011 < 0.0;

    let q0_residual = (&jacobian * &q0).norm();
    let p0_residual = (jacobian.transpose() * &p0).norm();
    let q1_residual = (&a_complex * &q1 - q1.clone() * Complex::new(0.0, omega)).norm();
    let p1_residual = (a_complex.transpose() * &p1 - p1.clone() * Complex::new(0.0, -omega)).norm();
    let h200_residual = (&jacobian * &h200 - h200_rhs).norm();
    let h020_residual =
        (-&a_complex * &h020 + h020.clone() * Complex::new(0.0, 2.0 * omega) - b_q1_q1).norm();
    let h110_residual = (&resonant_matrix * &h110 - h110_rhs).norm();
    let h011_residual = (&jacobian * &h011 - h011_rhs_real).norm();

    Ok(ZeroHopfNormalForm {
        state: state.to_vec(),
        param1_index,
        param2_index,
        param1_value,
        param2_value,
        frequency: omega,
        zero_eigenvalue: zero_eigenvalue.re,
        q0: q0.iter().copied().collect(),
        p0: p0.iter().copied().collect(),
        q1: q1.iter().copied().collect(),
        p1: p1.iter().copied().collect(),
        g200,
        g011,
        g110,
        g111,
        g021: g021_full,
        f200,
        f011,
        f111,
        reduced_g021,
        v10,
        v01,
        h200: h200.iter().copied().collect(),
        h110: h110.iter().copied().collect(),
        h020: h020.iter().copied().collect(),
        h011: h011.iter().copied().collect(),
        h00010: h00010.iter().copied().collect(),
        h00001: h00001.iter().copied().collect(),
        ns_center_coefficient,
        ns_beta1,
        ns_beta2,
        has_neimark_sacker,
        diagnostics: EquilibriumCodim2NormalFormDiagnostics {
            jacobian_condition_number: condition_number_real(&jacobian),
            unfolding_condition_number: condition_number_real(&ll),
            minimum_eigenvector_pairing: zero_pairing.min(hopf_pairing),
            max_eigen_residual: q0_residual
                .max(p0_residual)
                .max(q1_residual)
                .max(p1_residual),
            max_homological_residual: h200_residual
                .max(h020_residual)
                .max(h110_residual)
                .max(h011_residual),
            resonance_distance: omega,
        },
    })
}

#[allow(clippy::too_many_arguments)]
pub fn hopf_hopf_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
    source_frequency_hint: f64,
) -> Result<HopfHopfNormalForm> {
    if state.len() != system.equations.len() || state.len() < 4 {
        bail!("Hopf-Hopf normal form requires a matching state of dimension at least four");
    }
    if param1_index == param2_index
        || param1_index >= system.params.len()
        || param2_index >= system.params.len()
    {
        bail!("Hopf-Hopf normal form requires two distinct valid parameters");
    }
    let old_params = system.params.clone();
    system.params[param1_index] = param1_value;
    system.params[param2_index] = param2_value;
    let result = hopf_hopf_normal_form_at_current_params(
        system,
        state,
        param1_index,
        param2_index,
        param1_value,
        param2_value,
        source_frequency_hint,
    );
    system.params = old_params;
    result
}

#[allow(clippy::too_many_arguments)]
fn hopf_hopf_normal_form_at_current_params(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
    source_frequency_hint: f64,
) -> Result<HopfHopfNormalForm> {
    let n = state.len();
    let jacobian =
        DMatrix::from_row_slice(n, n, &compute_jacobian(system, SystemKind::Flow, state)?);
    let mut positive: Vec<Complex<f64>> = jacobian
        .clone()
        .complex_eigenvalues()
        .iter()
        .filter(|value| value.im > MIN_FREQUENCY)
        .copied()
        .collect();
    positive.sort_by(|left, right| {
        let left_hint = (left.im - source_frequency_hint.abs()).abs();
        let right_hint = (right.im - source_frequency_hint.abs()).abs();
        (left.re.abs() + 1e-3 * left_hint).total_cmp(&(right.re.abs() + 1e-3 * right_hint))
    });
    if positive.len() < 2 {
        bail!("Hopf-Hopf point has fewer than two positive imaginary eigenvalues");
    }
    let source = positive[0];
    let second = positive
        .iter()
        .skip(1)
        .filter(|value| (value.im - source.im).abs() > 1e-6 * (1.0 + source.im))
        .min_by(|left, right| left.re.abs().total_cmp(&right.re.abs()))
        .copied()
        .ok_or_else(|| anyhow!("Hopf-Hopf point has no distinct second frequency"))?;
    if source.re.abs().max(second.re.abs()) > 1e-5 * (1.0 + jacobian.norm()) {
        bail!("Source is not a refined Hopf-Hopf point");
    }
    let (lambda1, lambda2) = if source.im >= second.im {
        (source, second)
    } else {
        (second, source)
    };
    let omega1 = lambda1.im;
    let omega2 = lambda2.im;
    let resonance_distance = [
        (omega1 - omega2).abs(),
        (omega1 - 2.0 * omega2).abs(),
        (2.0 * omega1 - omega2).abs(),
    ]
    .into_iter()
    .fold(f64::INFINITY, f64::min);
    if resonance_distance <= 1e-7 * (1.0 + omega1.max(omega2)) {
        bail!("Hopf-Hopf normal form is in a low-order internal resonance");
    }

    let (q1, p1, pairing1) = normalized_complex_eigenpair(&jacobian, lambda1)?;
    let (q2, p2, pairing2) = normalized_complex_eigenpair(&jacobian, lambda2)?;
    let q1_bar = q1.map(|value| value.conj());
    let q2_bar = q2.map(|value| value.conj());
    let b_q1_q1 = bilinear_complex(system, SystemKind::Flow, state, &q1, &q1)?;
    let b_q2_q2 = bilinear_complex(system, SystemKind::Flow, state, &q2, &q2)?;
    let b_q1_q2 = bilinear_complex(system, SystemKind::Flow, state, &q1, &q2)?;
    let b_q1_q2bar = bilinear_complex(system, SystemKind::Flow, state, &q1, &q2_bar)?;
    let b_q1_q1bar = bilinear_complex(system, SystemKind::Flow, state, &q1, &q1_bar)?;
    let b_q2_q2bar = bilinear_complex(system, SystemKind::Flow, state, &q2, &q2_bar)?;
    let h2000 = solve_shifted(&jacobian, Complex::new(0.0, 2.0 * omega1), &b_q1_q1)?;
    let h0020 = solve_shifted(&jacobian, Complex::new(0.0, 2.0 * omega2), &b_q2_q2)?;
    let h1010 = solve_shifted(&jacobian, Complex::new(0.0, omega1 + omega2), &b_q1_q2)?;
    let h1001 = solve_shifted(&jacobian, Complex::new(0.0, omega1 - omega2), &b_q1_q2bar)?;
    let h1100 = complex_matrix_from_real(&jacobian)
        .lu()
        .solve(&(-b_q1_q1bar.clone()))
        .ok_or_else(|| anyhow!("Hopf-Hopf h1100 solve is singular"))?;
    let h0011 = complex_matrix_from_real(&jacobian)
        .lu()
        .solve(&(-b_q2_q2bar.clone()))
        .ok_or_else(|| anyhow!("Hopf-Hopf h0011 solve is singular"))?;

    let c2100 = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[q1.clone(), q1.clone(), q1_bar.clone()],
    )?;
    let tmp2100 = c2100
        + bilinear_complex(system, SystemKind::Flow, state, &h2000, &q1_bar)?
        + bilinear_complex(system, SystemKind::Flow, state, &h1100, &q1)? * Complex::new(2.0, 0.0);
    let g2100 = hermitian_inner(&p1, &tmp2100);
    let c0021 = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[q2.clone(), q2.clone(), q2_bar.clone()],
    )?;
    let tmp0021 = c0021
        + bilinear_complex(system, SystemKind::Flow, state, &h0020, &q2_bar)?
        + bilinear_complex(system, SystemKind::Flow, state, &h0011, &q2)? * Complex::new(2.0, 0.0);
    let g0021 = hermitian_inner(&p2, &tmp0021);
    let c1110 = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[q1.clone(), q1_bar.clone(), q2.clone()],
    )?;
    let tmp1110 = c1110
        + bilinear_complex(system, SystemKind::Flow, state, &h1100, &q2)?
        + bilinear_complex(system, SystemKind::Flow, state, &h1010, &q1_bar)?
        + bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            &h1001.map(|value| value.conj()),
            &q1,
        )?;
    let g1110 = hermitian_inner(&p2, &tmp1110);
    let c1011 = multilinear_complex(
        system,
        SystemKind::Flow,
        state,
        &[q1.clone(), q2.clone(), q2_bar.clone()],
    )?;
    let tmp1011 = c1011
        + bilinear_complex(system, SystemKind::Flow, state, &h1010, &q2_bar)?
        + bilinear_complex(system, SystemKind::Flow, state, &h1001, &q2)?
        + bilinear_complex(system, SystemKind::Flow, state, &h0011, &q1)?;
    let g1011 = hermitian_inner(&p1, &tmp1011);

    let f_p1 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param1_index,
    )?);
    let f_p2 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param2_index,
    )?);
    let parameter_state1 = jacobian
        .clone()
        .lu()
        .solve(&(-f_p1))
        .ok_or_else(|| anyhow!("Hopf-Hopf first parameter state solve is singular"))?;
    let parameter_state2 = jacobian
        .clone()
        .lu()
        .solve(&(-f_p2))
        .ok_or_else(|| anyhow!("Hopf-Hopf second parameter state solve is singular"))?;
    let a_p1 = parameter_jacobian_derivative(system, state, param1_index)?;
    let a_p2 = parameter_jacobian_derivative(system, state, param2_index)?;
    let parameter_modal = |q: &DVector<Complex<f64>>,
                           p: &DVector<Complex<f64>>,
                           state_response: &DVector<f64>,
                           derivative: &DMatrix<f64>|
     -> Result<Complex<f64>> {
        let nonlinear = bilinear_complex(
            system,
            SystemKind::Flow,
            state,
            q,
            &complex_from_real(state_response),
        )?;
        let derivative_q = complex_from_real(&(derivative * &q.map(|value| value.re)))
            + complex_from_real(&(derivative * &q.map(|value| value.im))) * Complex::new(0.0, 1.0);
        Ok(hermitian_inner(p, &(nonlinear + derivative_q)))
    };
    let gamma11 = parameter_modal(&q1, &p1, &parameter_state1, &a_p1)?;
    let gamma12 = parameter_modal(&q1, &p1, &parameter_state2, &a_p2)?;
    let gamma21 = parameter_modal(&q2, &p2, &parameter_state1, &a_p1)?;
    let gamma22 = parameter_modal(&q2, &p2, &parameter_state2, &a_p2)?;
    let gamma_real =
        DMatrix::from_row_slice(2, 2, &[gamma11.re, gamma12.re, gamma21.re, gamma22.re]);
    let gamma_imag =
        DMatrix::from_row_slice(2, 2, &[gamma11.im, gamma12.im, gamma21.im, gamma22.im]);
    let gamma_lu = gamma_real.clone().lu();
    let alpha1 = gamma_lu
        .solve(&DVector::from_vec(vec![g2100.re / 2.0, g1110.re]))
        .ok_or_else(|| anyhow!("Hopf-Hopf modal unfolding matrix is singular"))?;
    let alpha2 = gamma_lu
        .solve(&DVector::from_vec(vec![g1011.re, g0021.re / 2.0]))
        .ok_or_else(|| anyhow!("Hopf-Hopf modal unfolding matrix is singular"))?;
    let correction1 = DVector::from_vec(vec![g2100.im / 2.0, g1110.im]) - &gamma_imag * &alpha1;
    let correction2 = DVector::from_vec(vec![g1011.im, g0021.im / 2.0]) - &gamma_imag * &alpha2;
    let predictors = vec![
        HopfHopfNeimarkSackerPredictor {
            periodic_mode: 1,
            parameter_quadratic: [alpha1[0], alpha1[1]],
            frequency1_quadratic: correction1[0],
            frequency2_quadratic: correction1[1],
        },
        HopfHopfNeimarkSackerPredictor {
            periodic_mode: 2,
            parameter_quadratic: [alpha2[0], alpha2[1]],
            frequency1_quadratic: correction2[0],
            frequency2_quadratic: correction2[1],
        },
    ];

    let a_complex = complex_matrix_from_real(&jacobian);
    let q1_residual = (&a_complex * &q1 - q1.clone() * Complex::new(0.0, omega1)).norm();
    let p1_residual =
        (a_complex.transpose() * &p1 - p1.clone() * Complex::new(0.0, -omega1)).norm();
    let q2_residual = (&a_complex * &q2 - q2.clone() * Complex::new(0.0, omega2)).norm();
    let p2_residual =
        (a_complex.transpose() * &p2 - p2.clone() * Complex::new(0.0, -omega2)).norm();
    let residual = |h: &DVector<Complex<f64>>, shift: f64, rhs: &DVector<Complex<f64>>| {
        (-&a_complex * h + h.clone() * Complex::new(0.0, shift) - rhs).norm()
    };
    let h1100_residual = (&a_complex * &h1100 + b_q1_q1bar).norm();
    let h0011_residual = (&a_complex * &h0011 + b_q2_q2bar).norm();

    Ok(HopfHopfNormalForm {
        state: state.to_vec(),
        param1_index,
        param2_index,
        param1_value,
        param2_value,
        frequency1: omega1,
        frequency2: omega2,
        q1: q1.iter().copied().collect(),
        p1: p1.iter().copied().collect(),
        q2: q2.iter().copied().collect(),
        p2: p2.iter().copied().collect(),
        g2100,
        g0021,
        g1110,
        g1011,
        gamma: [[gamma11, gamma12], [gamma21, gamma22]],
        h2000: h2000.iter().copied().collect(),
        h0020: h0020.iter().copied().collect(),
        h1100: h1100.iter().copied().collect(),
        h0011: h0011.iter().copied().collect(),
        parameter_state1: parameter_state1.iter().copied().collect(),
        parameter_state2: parameter_state2.iter().copied().collect(),
        neimark_sacker_predictors: predictors,
        diagnostics: EquilibriumCodim2NormalFormDiagnostics {
            jacobian_condition_number: condition_number_real(&jacobian),
            unfolding_condition_number: condition_number_real(&gamma_real),
            minimum_eigenvector_pairing: pairing1.min(pairing2),
            max_eigen_residual: q1_residual
                .max(p1_residual)
                .max(q2_residual)
                .max(p2_residual),
            max_homological_residual: residual(&h2000, 2.0 * omega1, &b_q1_q1)
                .max(residual(&h0020, 2.0 * omega2, &b_q2_q2))
                .max(residual(&h1010, omega1 + omega2, &b_q1_q2))
                .max(residual(&h1001, omega1 - omega2, &b_q1_q2bar))
                .max(h1100_residual)
                .max(h0011_residual),
            resonance_distance,
        },
    })
}
