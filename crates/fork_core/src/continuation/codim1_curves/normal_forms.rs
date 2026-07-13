//! Local normal-form coefficients for equilibrium codimension-two points.
//!
//! The equation engine currently provides exact first derivatives through
//! forward-mode automatic differentiation.  The multilinear forms below use
//! centered differences of that Jacobian, which avoids differencing the vector
//! field itself and gives stable directional second- and third-order
//! derivatives without materializing dense derivative tensors.

use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

const MIN_DIRECTION_NORM: f64 = 1e-14;
const MIN_NULL_PAIRING: f64 = 1e-10;

/// Fold normal-form coefficients and basic nullspace conditioning diagnostics.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // Retained for refined-point diagnostics added by the codim-2 locator.
pub(crate) struct FoldNormalForm {
    /// Quadratic fold coefficient `a = 1/2 p^T B(q,q)`.
    pub quadratic_coefficient: f64,
    /// Cusp cubic coefficient `c = 1/6 p^T(C(q,q,q) + 3 B(q,h2))`.
    pub cubic_coefficient: f64,
    /// Absolute pairing of unit left/right nullvectors before `p^T q = 1` scaling.
    pub null_pairing: f64,
    /// Residual `||A q||` of the normalized right nullvector.
    pub right_null_residual: f64,
    /// Residual `||A^T p||` of the normalized left nullvector.
    pub left_null_residual: f64,
}

/// Hopf normal-form coefficient and basic eigenspace conditioning diagnostics.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // Retained for refined-point diagnostics added by the codim-2 locator.
pub(crate) struct HopfNormalForm {
    /// First Lyapunov coefficient, with no additional `1/omega` factor.
    pub first_lyapunov_coefficient: f64,
    /// Second Lyapunov coefficient used for generalized-Hopf nondegeneracy.
    pub second_lyapunov_coefficient: f64,
    /// Absolute Hermitian pairing before `p^* q = 1` scaling.
    pub null_pairing: f64,
    /// Residual `||(A-i*omega*I)q||`.
    pub right_null_residual: f64,
    /// Residual `||(A^T+i*omega*I)p||`.
    pub left_null_residual: f64,
    /// Residual of the `A h11 = -B(q,qbar)` homological solve.
    pub h11_residual: f64,
    /// Residual of the `(2 i omega I-A) h20 = B(q,q)` homological solve.
    pub h20_residual: f64,
}

/// Center-manifold data at a Bogdanov-Takens point.
#[derive(Debug, Clone)]
pub(crate) struct BogdanovTakensNormalForm {
    pub quadratic_coefficient: f64,
    pub mixed_coefficient: f64,
    pub q0: DVector<f64>,
    pub q1: DVector<f64>,
    pub p0: DVector<f64>,
    pub p1: DVector<f64>,
    pub chain_residual: f64,
    pub adjoint_chain_residual: f64,
}

fn jacobian_matrix(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
) -> Result<DMatrix<f64>> {
    let n = state.len();
    let jac = compute_jacobian(system, kind, state)?;
    Ok(DMatrix::from_row_slice(n, n, &jac))
}

fn shifted_state(state: &[f64], direction: &DVector<f64>, amount: f64) -> Vec<f64> {
    state
        .iter()
        .zip(direction.iter())
        .map(|(&x, &d)| x + amount * d)
        .collect()
}

fn mixed_shifted_state(
    state: &[f64],
    first: &DVector<f64>,
    first_amount: f64,
    second: &DVector<f64>,
    second_amount: f64,
) -> Vec<f64> {
    state
        .iter()
        .zip(first.iter())
        .zip(second.iter())
        .map(|((&x, &u), &v)| x + first_amount * u + second_amount * v)
        .collect()
}

fn directional_step(state: &[f64], direction: &DVector<f64>, exponent: f64) -> Result<f64> {
    let direction_norm = direction.norm();
    if !direction_norm.is_finite() || direction_norm <= MIN_DIRECTION_NORM {
        bail!("Normal-form direction is degenerate");
    }
    let state_norm = DVector::from_column_slice(state).norm();
    let displacement = f64::EPSILON.powf(exponent) * (1.0 + state_norm);
    Ok(displacement / direction_norm)
}

/// Apply the symmetric bilinear form `B = D^2 F` to two real directions.
pub(super) fn bilinear_real(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<f64>,
    second: &DVector<f64>,
) -> Result<DVector<f64>> {
    let n = state.len();
    if first.len() != n || second.len() != n {
        bail!("Bilinear-form direction dimension mismatch");
    }
    if first.norm() <= MIN_DIRECTION_NORM || second.norm() <= MIN_DIRECTION_NORM {
        return Ok(DVector::zeros(n));
    }

    // For a centered first difference, h ~ eps^(1/3) balances truncation and
    // roundoff.  Differentiate J in `first` and apply it to `second`.
    let step = directional_step(state, first, 1.0 / 3.0)?;
    let plus = shifted_state(state, first, step);
    let minus = shifted_state(state, first, -step);
    let jac_plus = jacobian_matrix(system, kind, &plus)?;
    let jac_minus = jacobian_matrix(system, kind, &minus)?;
    Ok((jac_plus - jac_minus) * second / (2.0 * step))
}

/// Apply the symmetric trilinear form `C = D^3 F` to three real directions.
pub(super) fn trilinear_real(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<f64>,
    second: &DVector<f64>,
    third: &DVector<f64>,
) -> Result<DVector<f64>> {
    let n = state.len();
    if first.len() != n || second.len() != n || third.len() != n {
        bail!("Trilinear-form direction dimension mismatch");
    }
    if first.norm() <= MIN_DIRECTION_NORM
        || second.norm() <= MIN_DIRECTION_NORM
        || third.norm() <= MIN_DIRECTION_NORM
    {
        return Ok(DVector::zeros(n));
    }

    // For a centered second difference, h ~ eps^(1/4).  The mixed stencil
    // computes D^2 J[first,second] applied to `third`.
    let first_step = directional_step(state, first, 0.25)?;
    let second_step = directional_step(state, second, 0.25)?;
    let pp = mixed_shifted_state(state, first, first_step, second, second_step);
    let pm = mixed_shifted_state(state, first, first_step, second, -second_step);
    let mp = mixed_shifted_state(state, first, -first_step, second, second_step);
    let mm = mixed_shifted_state(state, first, -first_step, second, -second_step);

    let numerator = jacobian_matrix(system, kind, &pp)?
        - jacobian_matrix(system, kind, &pm)?
        - jacobian_matrix(system, kind, &mp)?
        + jacobian_matrix(system, kind, &mm)?;
    Ok(numerator * third / (4.0 * first_step * second_step))
}

/// Apply a fourth- or fifth-order real multilinear form by taking a centered
/// mixed difference of the exact first derivative. Keeping the final
/// direction outside the stencil materially reduces cancellation compared
/// with differencing the vector field itself.
fn higher_multilinear_real(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    directions: &[DVector<f64>],
) -> Result<DVector<f64>> {
    let order = directions.len();
    if !(4..=5).contains(&order) {
        bail!("Higher multilinear form must have order four or five");
    }
    let n = state.len();
    if directions.iter().any(|direction| direction.len() != n) {
        bail!("Multilinear-form direction dimension mismatch");
    }
    if directions
        .iter()
        .any(|direction| direction.norm() <= MIN_DIRECTION_NORM)
    {
        return Ok(DVector::zeros(n));
    }

    let stencil_directions = &directions[..order - 1];
    let applied_direction = &directions[order - 1];
    let exponent = 1.0 / (order as f64 + 1.0);
    let steps: Vec<f64> = stencil_directions
        .iter()
        .map(|direction| directional_step(state, direction, exponent))
        .collect::<Result<_>>()?;
    let combinations = 1usize << stencil_directions.len();
    let mut result = DVector::zeros(n);

    for mask in 0..combinations {
        let mut shifted = state.to_vec();
        let mut sign_product = 1.0;
        for (index, direction) in stencil_directions.iter().enumerate() {
            let sign = if mask & (1usize << index) == 0 {
                -1.0
            } else {
                1.0
            };
            sign_product *= sign;
            for row in 0..n {
                shifted[row] += sign * steps[index] * direction[row];
            }
        }
        result += jacobian_matrix(system, kind, &shifted)? * applied_direction * sign_product;
    }

    let denominator =
        2f64.powi(stencil_directions.len() as i32) * steps.iter().copied().product::<f64>();
    Ok(result / denominator)
}

fn normalize_fold_nullvectors(
    right_seed: &DVector<f64>,
    left_seed: &DVector<f64>,
) -> Result<(DVector<f64>, DVector<f64>, f64)> {
    let right_norm = right_seed.norm();
    let left_norm = left_seed.norm();
    if !right_norm.is_finite()
        || !left_norm.is_finite()
        || right_norm <= MIN_DIRECTION_NORM
        || left_norm <= MIN_DIRECTION_NORM
    {
        bail!("Fold nullvector seed is degenerate");
    }

    let mut q = right_seed / right_norm;
    let pivot = q
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    if q[pivot] < 0.0 {
        q = -q;
    }
    let p_unit = left_seed / left_norm;
    let pairing = p_unit.dot(&q);
    if !pairing.is_finite() || pairing.abs() <= MIN_NULL_PAIRING {
        bail!("Fold left/right nullvector pairing is singular");
    }
    let p = p_unit / pairing;
    Ok((q, p, pairing.abs()))
}

/// Compute fold and cusp coefficients from bordered nullvector seeds.
///
/// The seeds are intentionally supplied by the curve problem's bordered solves,
/// preserving their local orientation along the continued branch.
pub(crate) fn fold_normal_form(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    jac: &DMatrix<f64>,
    right_seed: &DVector<f64>,
    left_seed: &DVector<f64>,
) -> Result<FoldNormalForm> {
    let n = state.len();
    if jac.nrows() != n || jac.ncols() != n {
        bail!("Fold Jacobian dimension mismatch");
    }
    let (q, p, null_pairing) = normalize_fold_nullvectors(right_seed, left_seed)?;
    let b_qq = bilinear_real(system, kind, state, &q, &q)?;
    let quadratic_coefficient = 0.5 * p.dot(&b_qq);

    // At a cusp B(q,q) lies in range(A).  The bordered solve selects h2 with
    // p^T h2 = 0 and remains regular in a neighborhood of the cusp.
    let mut bordered = DMatrix::zeros(n + 1, n + 1);
    bordered.view_mut((0, 0), (n, n)).copy_from(jac);
    bordered.view_mut((0, n), (n, 1)).copy_from(&q);
    bordered.view_mut((n, 0), (1, n)).copy_from(&p.transpose());
    let mut rhs = DVector::zeros(n + 1);
    rhs.rows_mut(0, n).copy_from(&(-&b_qq));
    let solution = bordered
        .lu()
        .solve(&rhs)
        .ok_or_else(|| anyhow!("Cusp homological bordered solve is singular"))?;
    let h2 = solution.rows(0, n).into_owned();

    let c_qqq = trilinear_real(system, kind, state, &q, &q, &q)?;
    let b_q_h2 = bilinear_real(system, kind, state, &q, &h2)?;
    let cubic_coefficient = p.dot(&(c_qqq + b_q_h2 * 3.0)) / 6.0;

    Ok(FoldNormalForm {
        quadratic_coefficient,
        cubic_coefficient,
        null_pairing,
        right_null_residual: (jac * &q).norm(),
        left_null_residual: (jac.transpose() * &p).norm(),
    })
}

pub(super) fn complex_matrix_from_real(real: &DMatrix<f64>) -> DMatrix<Complex<f64>> {
    real.map(|value| Complex::new(value, 0.0))
}

fn split_complex(vector: &DVector<Complex<f64>>) -> (DVector<f64>, DVector<f64>) {
    (vector.map(|value| value.re), vector.map(|value| value.im))
}

fn join_complex(real: DVector<f64>, imag: DVector<f64>) -> DVector<Complex<f64>> {
    DVector::from_iterator(
        real.len(),
        real.iter()
            .zip(imag.iter())
            .map(|(&re, &im)| Complex::new(re, im)),
    )
}

pub(super) fn hermitian_inner(
    left: &DVector<Complex<f64>>,
    right: &DVector<Complex<f64>>,
) -> Complex<f64> {
    left.iter()
        .zip(right.iter())
        .map(|(p, q)| p.conj() * q)
        .sum()
}

pub(super) fn bilinear_complex(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<Complex<f64>>,
    second: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let (first_re, first_im) = split_complex(first);
    let (second_re, second_im) = split_complex(second);
    let real = bilinear_real(system, kind, state, &first_re, &second_re)?
        - bilinear_real(system, kind, state, &first_im, &second_im)?;
    let imag = bilinear_real(system, kind, state, &first_re, &second_im)?
        + bilinear_real(system, kind, state, &first_im, &second_re)?;
    Ok(join_complex(real, imag))
}

fn trilinear_q_q_qbar(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    q: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let (q_re, q_im) = split_complex(q);
    // By real symmetric trilinearity:
    // C(q,q,qbar) = C(r,r,r) + C(r,i,i)
    //               + i [C(r,r,i) + C(i,i,i)].
    let real = trilinear_real(system, kind, state, &q_re, &q_re, &q_re)?
        + trilinear_real(system, kind, state, &q_re, &q_im, &q_im)?;
    let imag = trilinear_real(system, kind, state, &q_re, &q_re, &q_im)?
        + trilinear_real(system, kind, state, &q_im, &q_im, &q_im)?;
    Ok(join_complex(real, imag))
}

pub(super) fn multilinear_complex(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    directions: &[DVector<Complex<f64>>],
) -> Result<DVector<Complex<f64>>> {
    let order = directions.len();
    if !(3..=5).contains(&order) {
        bail!("Complex multilinear form must have order three through five");
    }
    let n = state.len();
    if directions.iter().any(|direction| direction.len() != n) {
        bail!("Complex multilinear-form direction dimension mismatch");
    }

    let split: Vec<(DVector<f64>, DVector<f64>)> = directions.iter().map(split_complex).collect();
    let mut result = DVector::from_element(n, Complex::new(0.0, 0.0));

    for mask in 0..(1usize << order) {
        let imaginary_count = mask.count_ones();
        let factor = match imaginary_count % 4 {
            0 => Complex::new(1.0, 0.0),
            1 => Complex::new(0.0, 1.0),
            2 => Complex::new(-1.0, 0.0),
            _ => Complex::new(0.0, -1.0),
        };
        let real_directions: Vec<DVector<f64>> = split
            .iter()
            .enumerate()
            .map(|(index, (real, imag))| {
                if mask & (1usize << index) == 0 {
                    real.clone()
                } else {
                    imag.clone()
                }
            })
            .collect();
        if real_directions
            .iter()
            .any(|direction| direction.norm() <= MIN_DIRECTION_NORM)
        {
            continue;
        }
        let value = match order {
            3 => trilinear_real(
                system,
                kind,
                state,
                &real_directions[0],
                &real_directions[1],
                &real_directions[2],
            )?,
            4 | 5 => higher_multilinear_real(system, kind, state, &real_directions)?,
            _ => unreachable!(),
        };
        result += value.map(|entry| factor * entry);
    }
    Ok(result)
}

fn conjugate(vector: &DVector<Complex<f64>>) -> DVector<Complex<f64>> {
    vector.map(|value| value.conj())
}

fn real_part(vector: &DVector<Complex<f64>>) -> DVector<Complex<f64>> {
    vector.map(|value| Complex::new(value.re, 0.0))
}

fn shifted_complex_matrix(
    jac: &DMatrix<Complex<f64>>,
    real_scale: f64,
    imaginary_shift: f64,
) -> DMatrix<Complex<f64>> {
    let mut matrix = jac * Complex::new(real_scale, 0.0);
    for index in 0..matrix.nrows() {
        matrix[(index, index)] += Complex::new(0.0, imaginary_shift);
    }
    matrix
}

fn normalize_hopf_eigenvectors(
    jac: &DMatrix<f64>,
    omega: f64,
    right_seed: &DVector<f64>,
    left_seed: &DVector<f64>,
) -> Result<(DVector<Complex<f64>>, DVector<Complex<f64>>, f64)> {
    if !omega.is_finite() || omega <= 0.0 {
        bail!("Hopf frequency must be positive");
    }
    let right_norm = right_seed.norm();
    let left_norm = left_seed.norm();
    if right_norm <= MIN_DIRECTION_NORM || left_norm <= MIN_DIRECTION_NORM {
        bail!("Hopf nullvector seed is degenerate");
    }

    // If u lies in ker(A^2+omega^2 I), then
    // q = u - i A u / omega satisfies A q = i omega q.  The analogous
    // construction from the transposed bordered solve gives the adjoint p.
    let u = right_seed / right_norm;
    let s = left_seed / left_norm;
    let au = jac * &u;
    let ats = jac.transpose() * &s;
    let mut q = DVector::from_iterator(
        u.len(),
        u.iter()
            .zip(au.iter())
            .map(|(&real, &image_source)| Complex::new(real, -image_source / omega)),
    );
    let mut p = DVector::from_iterator(
        s.len(),
        s.iter()
            .zip(ats.iter())
            .map(|(&real, &image_source)| Complex::new(real, image_source / omega)),
    );

    let q_norm = q.norm();
    let p_norm = p.norm();
    if q_norm <= MIN_DIRECTION_NORM || p_norm <= MIN_DIRECTION_NORM {
        bail!("Constructed Hopf eigenvector is degenerate");
    }
    q /= Complex::new(q_norm, 0.0);
    p /= Complex::new(p_norm, 0.0);

    let pairing = hermitian_inner(&p, &q);
    if !pairing.re.is_finite() || !pairing.im.is_finite() || pairing.norm() <= MIN_NULL_PAIRING {
        bail!("Hopf left/right eigenvector pairing is singular");
    }
    p /= pairing.conj();
    Ok((q, p, pairing.norm()))
}

fn strongest_column(matrix: &DMatrix<f64>) -> Result<DVector<f64>> {
    let mut best: Option<DVector<f64>> = None;
    let mut best_norm = 0.0;
    for column in matrix.column_iter() {
        let owned = column.into_owned();
        let norm = owned.norm();
        if norm.is_finite() && norm > best_norm {
            best_norm = norm;
            best = Some(owned);
        }
    }
    best.filter(|_| best_norm > MIN_DIRECTION_NORM)
        .ok_or_else(|| anyhow!("Bordered Hopf nullspace has no usable column"))
}

fn smallest_right_singular_vector(matrix: &DMatrix<f64>) -> Result<DVector<f64>> {
    let decomposition = matrix.clone().svd(false, true);
    let v_t = decomposition
        .v_t
        .ok_or_else(|| anyhow!("Singular-vector decomposition omitted right vectors"))?;
    if v_t.nrows() == 0 {
        bail!("Singular-vector decomposition is empty");
    }
    let vector = v_t.row(v_t.nrows() - 1).transpose().into_owned();
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_DIRECTION_NORM {
        bail!("Smallest singular vector is degenerate");
    }
    Ok(vector / norm)
}

/// Compute the nilpotent chains and quadratic center-manifold coefficients at
/// a Bogdanov-Takens point.
pub(crate) fn bogdanov_takens_normal_form(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    jac: &DMatrix<f64>,
) -> Result<BogdanovTakensNormalForm> {
    if !kind.is_flow() {
        bail!("Bogdanov-Takens normal forms are only defined for flows");
    }
    let n = state.len();
    if jac.nrows() != n || jac.ncols() != n || n < 2 {
        bail!("Bogdanov-Takens Jacobian dimension mismatch");
    }

    let mut q0 = smallest_right_singular_vector(jac)?;
    let mut p1 = smallest_right_singular_vector(&jac.transpose())?;
    if q0[0].abs() > MIN_DIRECTION_NORM && q0[0] < 0.0 {
        q0 = -q0;
    }
    let p1_pivot = p1
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    if p1[p1_pivot] < 0.0 {
        p1 = -p1;
    }

    let mut bordered = DMatrix::zeros(n + 1, n + 1);
    bordered.view_mut((0, 0), (n, n)).copy_from(jac);
    bordered.view_mut((0, n), (n, 1)).copy_from(&p1);
    bordered.view_mut((n, 0), (1, n)).copy_from(&q0.transpose());

    let mut q1_rhs = DVector::zeros(n + 1);
    q1_rhs.rows_mut(0, n).copy_from(&q0);
    let q1_solution = bordered
        .clone()
        .lu()
        .solve(&q1_rhs)
        .ok_or_else(|| anyhow!("Bogdanov-Takens generalized right-chain solve is singular"))?;
    let mut q1 = q1_solution.rows(0, n).into_owned();

    let mut p0_rhs = DVector::zeros(n + 1);
    p0_rhs.rows_mut(0, n).copy_from(&p1);
    let p0_solution =
        bordered.transpose().lu().solve(&p0_rhs).ok_or_else(|| {
            anyhow!("Bogdanov-Takens generalized adjoint-chain solve is singular")
        })?;
    let mut p0 = p0_solution.rows(0, n).into_owned();

    let q0_norm = q0.norm();
    q0 /= q0_norm;
    q1 /= q0_norm;
    q1 -= q0.clone() * q0.dot(&q1);
    let pairing = q0.dot(&p0);
    if !pairing.is_finite() || pairing.abs() <= MIN_NULL_PAIRING {
        bail!("Bogdanov-Takens chain pairing is singular");
    }
    p1 /= pairing;
    p0 -= p1.clone() * p0.dot(&q1);
    p0 /= pairing;

    let b_q0_q0 = bilinear_real(system, kind, state, &q0, &q0)?;
    let b_q0_q1 = bilinear_real(system, kind, state, &q0, &q1)?;
    let quadratic_coefficient = 0.5 * p1.dot(&b_q0_q0);
    let mixed_coefficient = p1.dot(&b_q0_q1) + p0.dot(&b_q0_q0);
    let chain_residual = (jac * &q1 - &q0).norm().max((jac * &q0).norm());
    let adjoint_chain_residual = (jac.transpose() * &p0 - &p1)
        .norm()
        .max((jac.transpose() * &p1).norm());

    Ok(BogdanovTakensNormalForm {
        quadratic_coefficient,
        mixed_coefficient,
        q0,
        q1,
        p0,
        p1,
        chain_residual,
        adjoint_chain_residual,
    })
}

/// Compute the first two Lyapunov coefficients from bordered real nullspaces.
///
/// `right_nullspace` and `left_nullspace` contain the phase rows from the two
/// bordered solves for `A^2 + kappa I` and its transpose, respectively.
pub(crate) fn hopf_normal_form(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    jac: &DMatrix<f64>,
    omega: f64,
    right_nullspace: &DMatrix<f64>,
    left_nullspace: &DMatrix<f64>,
    compute_second: bool,
) -> Result<HopfNormalForm> {
    if !kind.is_flow() {
        bail!("Generalized Hopf normal forms are only defined for flows");
    }
    let n = state.len();
    if jac.nrows() != n
        || jac.ncols() != n
        || right_nullspace.nrows() != n
        || left_nullspace.nrows() != n
    {
        bail!("Hopf normal-form dimension mismatch");
    }

    let right_seed = strongest_column(right_nullspace)?;
    let left_seed = strongest_column(left_nullspace)?;
    let (q, p, null_pairing) = normalize_hopf_eigenvectors(jac, omega, &right_seed, &left_seed)?;
    let qbar = q.map(|value| value.conj());
    let a = complex_matrix_from_real(jac);

    let b_q_qbar = bilinear_complex(system, kind, state, &q, &qbar)?;
    let h11_rhs = -b_q_qbar.clone();
    let h11 = a
        .clone()
        .lu()
        .solve(&h11_rhs)
        .ok_or_else(|| anyhow!("Hopf h11 homological solve is singular"))?;

    let b_q_q = bilinear_complex(system, kind, state, &q, &q)?;
    let mut h20_matrix = -a.clone();
    for i in 0..n {
        h20_matrix[(i, i)] += Complex::new(0.0, 2.0 * omega);
    }
    let h20 = h20_matrix
        .clone()
        .lu()
        .solve(&b_q_q)
        .ok_or_else(|| anyhow!("Hopf h20 homological solve is singular"))?;

    let c_q_q_qbar = trilinear_q_q_qbar(system, kind, state, &q)?;
    let b_q_h11 = bilinear_complex(system, kind, state, &q, &h11)?;
    let b_qbar_h20 = bilinear_complex(system, kind, state, &qbar, &h20)?;
    let k21 = c_q_q_qbar + b_q_h11 * Complex::new(2.0, 0.0) + b_qbar_h20;
    let g21 = hermitian_inner(&p, &k21) / Complex::new(2.0, 0.0);
    let first_lyapunov_coefficient = g21.re;

    let a_q = &a * &q;
    let right_target = q.map(|value| Complex::new(0.0, omega) * value);
    let at_p = a.transpose() * &p;
    let left_target = p.map(|value| Complex::new(0.0, -omega) * value);
    let build_result = |second_lyapunov_coefficient| HopfNormalForm {
        first_lyapunov_coefficient,
        second_lyapunov_coefficient,
        null_pairing,
        right_null_residual: (&a_q - &right_target).norm(),
        left_null_residual: (&at_p - &left_target).norm(),
        h11_residual: (&a * &h11 - &h11_rhs).norm(),
        h20_residual: (&h20_matrix * &h20 - &b_q_q).norm(),
    };
    if !compute_second {
        return Ok(build_result(f64::NAN));
    }

    let c_q_q_q = multilinear_complex(system, kind, state, &[q.clone(), q.clone(), q.clone()])?;
    let b_q_h20 = bilinear_complex(system, kind, state, &q, &h20)?;
    let h30_rhs = c_q_q_q + b_q_h20 * Complex::new(3.0, 0.0);
    let h30_matrix = shifted_complex_matrix(&a, -1.0, 3.0 * omega);
    let h30 = h30_matrix
        .lu()
        .solve(&h30_rhs)
        .ok_or_else(|| anyhow!("Hopf h30 homological solve is singular"))?;

    let mut h21_bordered = DMatrix::from_element(n + 1, n + 1, Complex::new(0.0, 0.0));
    let h21_matrix = shifted_complex_matrix(&a, 1.0, -omega);
    h21_bordered.view_mut((0, 0), (n, n)).copy_from(&h21_matrix);
    for index in 0..n {
        h21_bordered[(index, n)] = q[index];
        h21_bordered[(n, index)] = p[index].conj();
    }
    let mut h21_rhs = DVector::from_element(n + 1, Complex::new(0.0, 0.0));
    let projected_k21 = q.clone() * (g21 * Complex::new(2.0, 0.0)) - &k21;
    h21_rhs.rows_mut(0, n).copy_from(&projected_k21);
    let h21_solution = h21_bordered
        .lu()
        .solve(&h21_rhs)
        .ok_or_else(|| anyhow!("Hopf h21 bordered solve is singular"))?;
    let h21 = h21_solution.rows(0, n).into_owned();

    let d_q_q_q_qbar = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), q.clone(), q.clone(), qbar.clone()],
    )?;
    let c_q_q_h11 = multilinear_complex(system, kind, state, &[q.clone(), q.clone(), h11.clone()])?;
    let c_q_qbar_h20 =
        multilinear_complex(system, kind, state, &[q.clone(), qbar.clone(), h20.clone()])?;
    let b_h20_h11 = bilinear_complex(system, kind, state, &h20, &h11)?;
    let b_h21_q = bilinear_complex(system, kind, state, &h21, &q)?;
    let b_h30_qbar = bilinear_complex(system, kind, state, &h30, &qbar)?;
    let h31_rhs = d_q_q_q_qbar
        + c_q_q_h11 * Complex::new(3.0, 0.0)
        + c_q_qbar_h20 * Complex::new(3.0, 0.0)
        + b_h20_h11 * Complex::new(3.0, 0.0)
        + b_h21_q * Complex::new(3.0, 0.0)
        + b_h30_qbar
        - h20.clone() * (g21 * Complex::new(6.0, 0.0));
    let h31_matrix = shifted_complex_matrix(&a, -1.0, 2.0 * omega);
    let h31 = h31_matrix
        .lu()
        .solve(&h31_rhs)
        .ok_or_else(|| anyhow!("Hopf h31 homological solve is singular"))?;

    let d_q_q_qbar_qbar = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), q.clone(), qbar.clone(), qbar.clone()],
    )?;
    let c_q_qbar_h11 =
        multilinear_complex(system, kind, state, &[q.clone(), qbar.clone(), h11.clone()])?;
    let c_qbar_qbar_h20 = multilinear_complex(
        system,
        kind,
        state,
        &[qbar.clone(), qbar.clone(), h20.clone()],
    )?;
    let b_h21_qbar = bilinear_complex(system, kind, state, &h21, &qbar)?;
    let b_h11_h11 = bilinear_complex(system, kind, state, &h11, &h11)?;
    let b_h20_h20bar = bilinear_complex(system, kind, state, &h20, &conjugate(&h20))?;
    let h22_rhs = d_q_q_qbar_qbar
        + c_q_qbar_h11 * Complex::new(4.0, 0.0)
        + real_part(&c_qbar_qbar_h20) * Complex::new(2.0, 0.0)
        + real_part(&b_h21_qbar) * Complex::new(4.0, 0.0)
        + b_h11_h11 * Complex::new(2.0, 0.0)
        + b_h20_h20bar;
    let h22 = shifted_complex_matrix(&a, -1.0, 0.0)
        .lu()
        .solve(&h22_rhs)
        .ok_or_else(|| anyhow!("Hopf h22 homological solve is singular"))?;

    let h20bar = conjugate(&h20);
    let h21bar = conjugate(&h21);
    let e_q_q_q_qbar_qbar = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), q.clone(), q.clone(), qbar.clone(), qbar.clone()],
    )?;
    let d_q_q_qbar_h11 = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), q.clone(), qbar.clone(), h11.clone()],
    )?;
    let d_qbar_qbar_q_h20 = multilinear_complex(
        system,
        kind,
        state,
        &[qbar.clone(), qbar.clone(), q.clone(), h20.clone()],
    )?;
    let d_q_q_q_h20bar = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), q.clone(), q.clone(), h20bar.clone()],
    )?;
    let c_h11_h11_q =
        multilinear_complex(system, kind, state, &[h11.clone(), h11.clone(), q.clone()])?;
    let c_qbar_h20_h11 = multilinear_complex(
        system,
        kind,
        state,
        &[qbar.clone(), h20.clone(), h11.clone()],
    )?;
    let c_qbar_q_h21 =
        multilinear_complex(system, kind, state, &[qbar.clone(), q.clone(), h21.clone()])?;
    let c_q_h20_h20bar = multilinear_complex(
        system,
        kind,
        state,
        &[q.clone(), h20.clone(), h20bar.clone()],
    )?;
    let c_q_q_h21bar =
        multilinear_complex(system, kind, state, &[q.clone(), q.clone(), h21bar.clone()])?;
    let c_qbar_qbar_h30 = multilinear_complex(
        system,
        kind,
        state,
        &[qbar.clone(), qbar.clone(), h30.clone()],
    )?;
    let h32 = e_q_q_q_qbar_qbar
        + d_q_q_qbar_h11 * Complex::new(6.0, 0.0)
        + d_qbar_qbar_q_h20 * Complex::new(3.0, 0.0)
        + d_q_q_q_h20bar
        + c_h11_h11_q * Complex::new(6.0, 0.0)
        + c_qbar_h20_h11 * Complex::new(6.0, 0.0)
        + c_qbar_q_h21 * Complex::new(6.0, 0.0)
        + c_q_h20_h20bar * Complex::new(3.0, 0.0)
        + c_q_q_h21bar * Complex::new(3.0, 0.0)
        + c_qbar_qbar_h30
        + bilinear_complex(system, kind, state, &h21, &h11)? * Complex::new(6.0, 0.0)
        + bilinear_complex(system, kind, state, &h22, &q)? * Complex::new(3.0, 0.0)
        + bilinear_complex(system, kind, state, &h20, &h21bar)? * Complex::new(3.0, 0.0)
        + bilinear_complex(system, kind, state, &h31, &qbar)? * Complex::new(2.0, 0.0)
        + bilinear_complex(system, kind, state, &h30, &h20bar)?;
    let second_lyapunov_coefficient = hermitian_inner(&p, &h32).re / 12.0;

    Ok(build_result(second_lyapunov_coefficient))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{parse, Bytecode, Compiler, OpCode};

    fn compile_system(equations: &[&str], params: Vec<f64>) -> EquationSystem {
        let vars = vec!["x".to_string(), "y".to_string()];
        let names = vec!["mu".to_string(), "beta".to_string()];
        let compiler = Compiler::new(&vars, &names);
        let bytecode = equations
            .iter()
            .map(|equation| compiler.compile(&parse(equation).expect("parse equation")))
            .collect();
        EquationSystem::new(bytecode, params)
    }

    #[test]
    fn scalar_cusp_has_unit_cubic_coefficient() {
        let equation = Bytecode {
            ops: vec![OpCode::LoadVar(0), OpCode::LoadConst(3.0), OpCode::Pow],
        };
        let system = EquationSystem::new(vec![equation], vec![]);
        let jac = DMatrix::zeros(1, 1);
        let unit = DVector::from_element(1, 1.0);

        let normal_form = fold_normal_form(&system, SystemKind::Flow, &[0.0], &jac, &unit, &unit)
            .expect("scalar cusp normal form");

        assert!(normal_form.quadratic_coefficient.abs() < 1e-8);
        assert!((normal_form.cubic_coefficient - 1.0).abs() < 1e-6);
        assert!((normal_form.null_pairing - 1.0).abs() < 1e-12);
        assert!(normal_form.right_null_residual < 1e-12);
        assert!(normal_form.left_null_residual < 1e-12);
    }

    #[test]
    fn generalized_hopf_normal_form_rejects_maps() {
        let equation = Bytecode {
            ops: vec![OpCode::LoadVar(0)],
        };
        let system = EquationSystem::new(vec![equation], vec![]);
        let jac = DMatrix::zeros(1, 1);
        let nullspace = DMatrix::from_element(1, 1, 1.0);

        let error = hopf_normal_form(
            &system,
            SystemKind::Map { iterations: 1 },
            &[0.0],
            &jac,
            1.0,
            &nullspace,
            &nullspace,
            true,
        )
        .expect_err("map GH calculation must be rejected");

        assert!(error.to_string().contains("only defined for flows"));
    }

    #[test]
    fn radial_quintic_has_nonzero_second_lyapunov_coefficient() {
        let system = compile_system(
            &[
                "mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2",
                "x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2",
            ],
            vec![0.0, 0.0],
        );
        let jac = DMatrix::from_row_slice(2, 2, &[0.0, -1.0, 1.0, 0.0]);
        let nullspace = DMatrix::identity(2, 2);

        let normal_form = hopf_normal_form(
            &system,
            SystemKind::Flow,
            &[0.0, 0.0],
            &jac,
            1.0,
            &nullspace,
            &nullspace,
            true,
        )
        .expect("quintic generalized Hopf normal form");

        assert!(normal_form.first_lyapunov_coefficient.abs() < 1e-6);
        assert!(
            (normal_form.second_lyapunov_coefficient - 4.0).abs() < 5e-2,
            "expected l2=4, got {}",
            normal_form.second_lyapunov_coefficient
        );
    }

    #[test]
    fn bogdanov_takens_coefficients_match_quadratic_normal_form() {
        let system = compile_system(&["y", "mu+x^2+beta*y+2*x*y"], vec![0.0, 0.0]);
        let jac = DMatrix::from_row_slice(2, 2, &[0.0, 1.0, 0.0, 0.0]);

        let normal_form = bogdanov_takens_normal_form(&system, SystemKind::Flow, &[0.0, 0.0], &jac)
            .expect("Bogdanov-Takens normal form");

        assert!((normal_form.quadratic_coefficient - 1.0).abs() < 1e-5);
        assert!((normal_form.mixed_coefficient - 2.0).abs() < 1e-5);
        assert!(normal_form.chain_residual < 1e-8);
        assert!(normal_form.adjoint_chain_residual < 1e-8);
    }
}
