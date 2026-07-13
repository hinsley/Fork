//! Local normal forms for fixed points and cycles of discrete maps.
//!
//! The formulas follow the map conventions used by BifurcationKit and
//! Kuznetsov: the supplied [`EquationSystem`] represents the map itself, not
//! the fixed-point residual.  Passing `map_iterations > 1` applies the same
//! formulas to the corresponding iterate, so the API also covers map cycles.

use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_param_jacobian, compute_system_jacobian, SystemKind};
use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::SVD;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

const MIN_DIRECTION_NORM: f64 = 1e-14;
const MIN_PAIRING: f64 = 1e-10;
const EIGENVALUE_TOLERANCE: f64 = 1e-5;
const STRONG_RESONANCE_TOLERANCE: f64 = 1e-4;

/// Criticality of a period-doubling or Neimark-Sacker normal form.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MapCriticality {
    Supercritical,
    Subcritical,
    Singular,
}

/// Local classification of a simple `+1` multiplier for a map.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MapBranchPointKind {
    Fold,
    Transcritical,
    Pitchfork,
    Degenerate,
}

/// Conditioning diagnostics shared by the three map normal forms.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct MapNormalFormConditioning {
    /// Absolute left/right eigenvector pairing before adjoint rescaling.
    pub eigenvector_pairing: f64,
    /// `||(L-lambda I)q||` for the normalized right eigenvector.
    pub right_residual: f64,
    /// `||(L^T-conj(lambda)I)p||` for the normalized adjoint eigenvector.
    pub left_residual: f64,
    /// Largest residual among the homological equations used by the form.
    pub homological_residual: f64,
}

/// Normal form at a simple map fixed point with multiplier `+1`.
///
/// In the center coordinate `xi` and parameter displacement `dmu`, Fork uses
///
/// `xi -> xi + a01*dmu + b11*xi*dmu + b20*xi^2/2 + b30*xi^3/6`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MapBranchPointNormalForm {
    pub kind: MapBranchPointKind,
    pub constant_parameter_coefficient: f64,
    pub linear_parameter_coefficient: f64,
    pub quadratic_coefficient: f64,
    pub cubic_coefficient: f64,
    pub conditioning: MapNormalFormConditioning,
}

/// Period-doubling normal form `xi -> xi*(-1 + a*dmu + b3*xi^2)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MapPeriodDoublingNormalForm {
    pub parameter_coefficient: f64,
    pub cubic_coefficient: f64,
    pub criticality: MapCriticality,
    pub conditioning: MapNormalFormConditioning,
}

/// Neimark-Sacker normal form
/// `z -> exp(i*theta)*z*(1 + a*dmu + b*|z|^2)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MapNeimarkSackerNormalForm {
    pub angle: f64,
    pub multiplier: Complex<f64>,
    pub parameter_coefficient: Complex<f64>,
    pub cubic_coefficient: Complex<f64>,
    pub criticality: MapCriticality,
    pub conditioning: MapNormalFormConditioning,
}

/// Serializable union returned by [`map_normal_form`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum MapNormalForm {
    BranchPoint(MapBranchPointNormalForm),
    PeriodDoubling(MapPeriodDoublingNormalForm),
    NeimarkSacker(MapNeimarkSackerNormalForm),
}

/// Requested critical multiplier for [`map_normal_form`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MapNormalFormType {
    BranchPoint,
    PeriodDoubling,
    NeimarkSacker,
}

/// Compute one of the supported local map normal forms.
pub fn map_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param_index: usize,
    param_value: f64,
    map_iterations: usize,
    normal_form_type: MapNormalFormType,
) -> Result<MapNormalForm> {
    match normal_form_type {
        MapNormalFormType::BranchPoint => {
            map_branch_point_normal_form(system, state, param_index, param_value, map_iterations)
                .map(MapNormalForm::BranchPoint)
        }
        MapNormalFormType::PeriodDoubling => {
            map_period_doubling_normal_form(system, state, param_index, param_value, map_iterations)
                .map(MapNormalForm::PeriodDoubling)
        }
        MapNormalFormType::NeimarkSacker => {
            map_neimark_sacker_normal_form(system, state, param_index, param_value, map_iterations)
                .map(MapNormalForm::NeimarkSacker)
        }
    }
}

fn validate_inputs(
    system: &EquationSystem,
    state: &[f64],
    param_index: usize,
    map_iterations: usize,
) -> Result<SystemKind> {
    if state.len() != system.equations.len() || state.is_empty() {
        bail!(
            "Map normal-form state dimension mismatch: expected {}, got {}",
            system.equations.len(),
            state.len()
        );
    }
    if param_index >= system.params.len() {
        bail!("Map normal-form parameter index is out of bounds");
    }
    if map_iterations == 0 {
        bail!("Map normal forms require at least one map iteration");
    }
    Ok(SystemKind::Map {
        iterations: map_iterations,
    })
}

fn with_parameter<T>(
    system: &mut EquationSystem,
    param_index: usize,
    param_value: f64,
    operation: impl FnOnce(&mut EquationSystem) -> Result<T>,
) -> Result<T> {
    let old_param = system.params[param_index];
    system.params[param_index] = param_value;
    let result = operation(system);
    system.params[param_index] = old_param;
    result
}

fn jacobian_matrix(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
) -> Result<DMatrix<f64>> {
    let n = state.len();
    Ok(DMatrix::from_row_slice(
        n,
        n,
        &compute_system_jacobian(system, kind, state)?,
    ))
}

fn shifted_state(state: &[f64], direction: &DVector<f64>, amount: f64) -> Vec<f64> {
    state
        .iter()
        .zip(direction.iter())
        .map(|(&value, &delta)| value + amount * delta)
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
        .map(|((&value, &u), &v)| value + first_amount * u + second_amount * v)
        .collect()
}

fn directional_step(state: &[f64], direction: &DVector<f64>, exponent: f64) -> Result<f64> {
    let direction_norm = direction.norm();
    if !direction_norm.is_finite() || direction_norm <= MIN_DIRECTION_NORM {
        bail!("Map normal-form direction is degenerate");
    }
    let state_norm = DVector::from_column_slice(state).norm();
    Ok(f64::EPSILON.powf(exponent) * (1.0 + state_norm) / direction_norm)
}

fn bilinear_real(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<f64>,
    second: &DVector<f64>,
) -> Result<DVector<f64>> {
    let n = state.len();
    if first.len() != n || second.len() != n {
        bail!("Map bilinear-form direction dimension mismatch");
    }
    if first.norm() <= MIN_DIRECTION_NORM || second.norm() <= MIN_DIRECTION_NORM {
        return Ok(DVector::zeros(n));
    }
    let step = directional_step(state, first, 1.0 / 3.0)?;
    let plus = shifted_state(state, first, step);
    let minus = shifted_state(state, first, -step);
    Ok(
        (jacobian_matrix(system, kind, &plus)? - jacobian_matrix(system, kind, &minus)?) * second
            / (2.0 * step),
    )
}

fn trilinear_real(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<f64>,
    second: &DVector<f64>,
    third: &DVector<f64>,
) -> Result<DVector<f64>> {
    let n = state.len();
    if first.len() != n || second.len() != n || third.len() != n {
        bail!("Map trilinear-form direction dimension mismatch");
    }
    if first.norm() <= MIN_DIRECTION_NORM
        || second.norm() <= MIN_DIRECTION_NORM
        || third.norm() <= MIN_DIRECTION_NORM
    {
        return Ok(DVector::zeros(n));
    }
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

fn bilinear_complex(
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

fn trilinear_complex(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    first: &DVector<Complex<f64>>,
    second: &DVector<Complex<f64>>,
    third: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let directions = [first, second, third];
    let split = directions.map(split_complex);
    let mut result = DVector::from_element(state.len(), Complex::new(0.0, 0.0));
    for mask in 0..8usize {
        let imaginary_count = mask.count_ones();
        let factor = match imaginary_count % 4 {
            0 => Complex::new(1.0, 0.0),
            1 => Complex::new(0.0, 1.0),
            2 => Complex::new(-1.0, 0.0),
            _ => Complex::new(0.0, -1.0),
        };
        let selected = split
            .iter()
            .enumerate()
            .map(|(index, (real, imag))| {
                if mask & (1usize << index) == 0 {
                    real
                } else {
                    imag
                }
            })
            .collect::<Vec<_>>();
        if selected
            .iter()
            .any(|direction| direction.norm() <= MIN_DIRECTION_NORM)
        {
            continue;
        }
        result += trilinear_real(system, kind, state, selected[0], selected[1], selected[2])?
            .map(|value| factor * value);
    }
    Ok(result)
}

fn hermitian_inner(left: &DVector<Complex<f64>>, right: &DVector<Complex<f64>>) -> Complex<f64> {
    left.iter()
        .zip(right.iter())
        .map(|(p, q)| p.conj() * q)
        .sum()
}

fn real_nullvectors(
    jacobian: &DMatrix<f64>,
    target: f64,
) -> Result<(DVector<f64>, DVector<f64>, f64)> {
    let n = jacobian.nrows();
    let shifted = jacobian - DMatrix::identity(n, n).scale(target);
    let right_svd = SVD::new(shifted.clone(), false, true);
    let left_svd = SVD::new(shifted.transpose(), false, true);
    let right_vt = right_svd
        .v_t
        .ok_or_else(|| anyhow!("Map normal form omitted right singular vectors"))?;
    let left_vt = left_svd
        .v_t
        .ok_or_else(|| anyhow!("Map normal form omitted left singular vectors"))?;
    let mut q = right_vt.row(right_vt.nrows() - 1).transpose().into_owned();
    let mut p = left_vt.row(left_vt.nrows() - 1).transpose().into_owned();
    q /= q.norm();
    p /= p.norm();
    let pivot = q
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    if q[pivot] < 0.0 {
        q = -q;
    }
    let pairing = p.dot(&q);
    if !pairing.is_finite() || pairing.abs() <= MIN_PAIRING {
        bail!("Map normal-form left/right eigenvector pairing is singular");
    }
    p /= pairing;
    let residual = (&shifted * &q)
        .norm()
        .max((shifted.transpose() * &p).norm());
    if residual > EIGENVALUE_TOLERANCE * (1.0 + jacobian.norm()) {
        bail!("Map does not have a sufficiently accurate multiplier at {target}");
    }
    Ok((q, p, pairing.abs()))
}

fn complex_eigenvector(
    matrix: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<DVector<Complex<f64>>> {
    let n = matrix.nrows();
    let mut shifted = matrix.map(|value| Complex::new(value, 0.0));
    for index in 0..n {
        shifted[(index, index)] -= eigenvalue;
    }
    let decomposition = SVD::new(shifted, false, true);
    let v_t = decomposition
        .v_t
        .ok_or_else(|| anyhow!("Map normal form omitted complex singular vectors"))?;
    let row = v_t.row(v_t.nrows() - 1);
    let mut vector = DVector::from_iterator(n, row.iter().map(|value| value.conj()));
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_DIRECTION_NORM {
        bail!("Map normal-form complex eigenvector is degenerate");
    }
    vector /= Complex::new(norm, 0.0);
    Ok(vector)
}

fn complex_nullvectors(
    jacobian: &DMatrix<f64>,
) -> Result<(
    Complex<f64>,
    DVector<Complex<f64>>,
    DVector<Complex<f64>>,
    f64,
)> {
    let eigenvalues = jacobian.clone().complex_eigenvalues();
    let multiplier = eigenvalues
        .iter()
        .copied()
        .filter(|value| value.im > 1e-8)
        .filter(|value| (value.norm() - 1.0).abs() <= EIGENVALUE_TOLERANCE)
        .min_by(|left, right| {
            (left.norm() - 1.0)
                .abs()
                .total_cmp(&(right.norm() - 1.0).abs())
        })
        .ok_or_else(|| {
            let repeated_real_resonance = [
                (Complex::new(1.0, 0.0), 1_u32),
                (Complex::new(-1.0, 0.0), 2_u32),
            ]
            .into_iter()
            .find(|(target, _)| {
                eigenvalues
                    .iter()
                    .filter(|value| (**value - *target).norm() < STRONG_RESONANCE_TOLERANCE)
                    .count()
                    >= 2
            })
            .map(|(_, order)| order);
            repeated_real_resonance.map_or_else(
                || {
                    anyhow!(
                        "Map has no unit-modulus complex multiplier pair for a Neimark-Sacker form"
                    )
                },
                |order| anyhow!("Map Neimark-Sacker multiplier is at a strong 1:{order} resonance"),
            )
        })?;
    for order in 1..=4_u32 {
        if (multiplier.powu(order) - Complex::new(1.0, 0.0)).norm() < STRONG_RESONANCE_TOLERANCE {
            bail!("Map Neimark-Sacker multiplier is at a strong 1:{order} resonance");
        }
    }
    let q = complex_eigenvector(jacobian, multiplier)?;
    let mut p = complex_eigenvector(&jacobian.transpose(), multiplier.conj())?;
    let pairing = hermitian_inner(&p, &q);
    if !pairing.re.is_finite() || !pairing.im.is_finite() || pairing.norm() <= MIN_PAIRING {
        bail!("Map Neimark-Sacker left/right eigenvector pairing is singular");
    }
    p /= pairing.conj();
    Ok((multiplier, q, p, pairing.norm()))
}

fn parameter_jacobian_derivative(
    system: &mut EquationSystem,
    kind: SystemKind,
    state: &[f64],
    param_index: usize,
) -> Result<DMatrix<f64>> {
    let parameter = system.params[param_index];
    let step = f64::EPSILON.powf(1.0 / 3.0) * (1.0 + parameter.abs());
    system.params[param_index] = parameter + step;
    let plus = jacobian_matrix(system, kind, state);
    system.params[param_index] = parameter - step;
    let minus = jacobian_matrix(system, kind, state);
    system.params[param_index] = parameter;
    Ok((plus? - minus?) / (2.0 * step))
}

fn bordered_range_solve(
    matrix: &DMatrix<f64>,
    q: &DVector<f64>,
    p: &DVector<f64>,
    rhs: &DVector<f64>,
) -> Result<DVector<f64>> {
    let n = matrix.nrows();
    let mut bordered = DMatrix::zeros(n + 1, n + 1);
    bordered.view_mut((0, 0), (n, n)).copy_from(matrix);
    bordered.view_mut((0, n), (n, 1)).copy_from(q);
    bordered.view_mut((n, 0), (1, n)).copy_from(&p.transpose());
    let mut bordered_rhs = DVector::zeros(n + 1);
    bordered_rhs.rows_mut(0, n).copy_from(rhs);
    let solution = bordered
        .lu()
        .solve(&bordered_rhs)
        .ok_or_else(|| anyhow!("Map normal-form bordered range solve is singular"))?;
    Ok(solution.rows(0, n).into_owned())
}

/// Compute the simple `+1` multiplier normal form of a map or map iterate.
pub fn map_branch_point_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param_index: usize,
    param_value: f64,
    map_iterations: usize,
) -> Result<MapBranchPointNormalForm> {
    let kind = validate_inputs(system, state, param_index, map_iterations)?;
    with_parameter(system, param_index, param_value, |system| {
        let n = state.len();
        let jacobian = jacobian_matrix(system, kind, state)?;
        let (q, p, pairing) = real_nullvectors(&jacobian, 1.0)?;
        let identity_minus_jacobian = DMatrix::identity(n, n) - &jacobian;

        let r01 = DVector::from_vec(compute_param_jacobian(system, kind, state, param_index)?);
        let a01 = p.dot(&r01);
        let projected_r01 = &r01 - &q * a01;
        let psi01 = bordered_range_solve(&identity_minus_jacobian, &q, &p, &projected_r01)?;
        let r11 = parameter_jacobian_derivative(system, kind, state, param_index)? * &q;
        let b_q_psi01 = bilinear_real(system, kind, state, &q, &psi01)?;
        let b11 = p.dot(&(r11 + b_q_psi01));

        let b_qq = bilinear_real(system, kind, state, &q, &q)?;
        let b20 = p.dot(&b_qq);
        let projected_b_qq = &b_qq - &q * b20;
        let h20 = bordered_range_solve(&identity_minus_jacobian, &q, &p, &projected_b_qq)?;
        let c_qqq = trilinear_real(system, kind, state, &q, &q, &q)?;
        let b30 = p.dot(&(c_qqq + bilinear_real(system, kind, state, &q, &h20)? * 3.0));

        let kind_classification = if a01.abs() > 1e-5 {
            MapBranchPointKind::Fold
        } else if 100.0 * (0.5 * b20).abs() < (b30 / 6.0).abs() {
            MapBranchPointKind::Pitchfork
        } else if b20.abs() > 1e-8 || b11.abs() > 1e-8 {
            MapBranchPointKind::Transcritical
        } else {
            MapBranchPointKind::Degenerate
        };

        Ok(MapBranchPointNormalForm {
            kind: kind_classification,
            constant_parameter_coefficient: a01,
            linear_parameter_coefficient: b11,
            quadratic_coefficient: b20,
            cubic_coefficient: b30,
            conditioning: MapNormalFormConditioning {
                eigenvector_pairing: pairing,
                right_residual: (&jacobian * &q - &q).norm(),
                left_residual: (jacobian.transpose() * &p - &p).norm(),
                homological_residual: (&identity_minus_jacobian * &psi01 - projected_r01)
                    .norm()
                    .max((&identity_minus_jacobian * &h20 - projected_b_qq).norm()),
            },
        })
    })
}

/// Compute the `-1` multiplier (period-doubling) normal form.
pub fn map_period_doubling_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param_index: usize,
    param_value: f64,
    map_iterations: usize,
) -> Result<MapPeriodDoublingNormalForm> {
    let kind = validate_inputs(system, state, param_index, map_iterations)?;
    with_parameter(system, param_index, param_value, |system| {
        let n = state.len();
        let jacobian = jacobian_matrix(system, kind, state)?;
        let (q, p, pairing) = real_nullvectors(&jacobian, -1.0)?;
        let identity_minus_jacobian = DMatrix::identity(n, n) - &jacobian;
        let r01 = DVector::from_vec(compute_param_jacobian(system, kind, state, param_index)?);
        let psi01 = identity_minus_jacobian
            .clone()
            .lu()
            .solve(&r01)
            .ok_or_else(|| anyhow!("Map PD parameter homological solve is singular"))?;
        let r11 = parameter_jacobian_derivative(system, kind, state, param_index)? * &q;
        let a = p.dot(&(r11 + bilinear_real(system, kind, state, &q, &psi01)?));

        let b_qq = bilinear_real(system, kind, state, &q, &q)?;
        let h20 = identity_minus_jacobian
            .clone()
            .lu()
            .solve(&b_qq)
            .ok_or_else(|| anyhow!("Map PD quadratic homological solve is singular"))?;
        let cubic_vector = trilinear_real(system, kind, state, &q, &q, &q)?
            + bilinear_real(system, kind, state, &q, &h20)? * 3.0;
        let b3 = p.dot(&cubic_vector) / 6.0;
        let criticality = if b3 > 1e-12 {
            MapCriticality::Supercritical
        } else if b3 < -1e-12 {
            MapCriticality::Subcritical
        } else {
            MapCriticality::Singular
        };

        Ok(MapPeriodDoublingNormalForm {
            parameter_coefficient: a,
            cubic_coefficient: b3,
            criticality,
            conditioning: MapNormalFormConditioning {
                eigenvector_pairing: pairing,
                right_residual: (&jacobian * &q + &q).norm(),
                left_residual: (jacobian.transpose() * &p + &p).norm(),
                homological_residual: (&identity_minus_jacobian * &psi01 - r01)
                    .norm()
                    .max((&identity_minus_jacobian * &h20 - b_qq).norm()),
            },
        })
    })
}

/// Compute the unit-complex-pair (Neimark-Sacker) normal form.
pub fn map_neimark_sacker_normal_form(
    system: &mut EquationSystem,
    state: &[f64],
    param_index: usize,
    param_value: f64,
    map_iterations: usize,
) -> Result<MapNeimarkSackerNormalForm> {
    let kind = validate_inputs(system, state, param_index, map_iterations)?;
    with_parameter(system, param_index, param_value, |system| {
        let n = state.len();
        let jacobian_real = jacobian_matrix(system, kind, state)?;
        let jacobian = jacobian_real.map(|value| Complex::new(value, 0.0));
        let (multiplier, q, p, pairing) = complex_nullvectors(&jacobian_real)?;
        let qbar = q.map(|value| value.conj());

        let r01 = DVector::from_vec(compute_param_jacobian(system, kind, state, param_index)?)
            .map(|value| Complex::new(value, 0.0));
        let identity_minus_jacobian =
            DMatrix::identity(n, n).map(|value| Complex::new(value, 0.0)) - &jacobian;
        let psi001 = identity_minus_jacobian
            .clone()
            .lu()
            .solve(&r01)
            .ok_or_else(|| anyhow!("Map NS parameter homological solve is singular"))?;

        let jacobian_parameter = parameter_jacobian_derivative(system, kind, state, param_index)?
            .map(|value| Complex::new(value, 0.0));
        let parameter_vector =
            &jacobian_parameter * &q + bilinear_complex(system, kind, state, &q, &psi001)?;
        let parameter_coefficient = hermitian_inner(&p, &parameter_vector) / multiplier;

        let b_q_q = bilinear_complex(system, kind, state, &q, &q)?;
        let mut lambda2_minus_jacobian = -&jacobian;
        for index in 0..n {
            lambda2_minus_jacobian[(index, index)] += multiplier * multiplier;
        }
        let psi200 = lambda2_minus_jacobian
            .clone()
            .lu()
            .solve(&b_q_q)
            .ok_or_else(|| anyhow!("Map NS second-harmonic homological solve is singular"))?;

        let b_q_qbar = bilinear_complex(system, kind, state, &q, &qbar)?;
        let psi110 = identity_minus_jacobian
            .clone()
            .lu()
            .solve(&b_q_qbar)
            .ok_or_else(|| anyhow!("Map NS mean homological solve is singular"))?;

        // Kuznetsov's Poincare-map convention:
        // d = e^(-i theta)/2 <p, C(q,q,qbar) + 2B(q,h11) + B(qbar,h20)>.
        let cubic_vector = trilinear_complex(system, kind, state, &q, &q, &qbar)?
            + bilinear_complex(system, kind, state, &q, &psi110)? * Complex::new(2.0, 0.0)
            + bilinear_complex(system, kind, state, &qbar, &psi200)?;
        let cubic_coefficient =
            hermitian_inner(&p, &cubic_vector) / multiplier / Complex::new(2.0, 0.0);
        let criticality = if cubic_coefficient.re < -1e-12 {
            MapCriticality::Supercritical
        } else if cubic_coefficient.re > 1e-12 {
            MapCriticality::Subcritical
        } else {
            MapCriticality::Singular
        };

        let right_target = &q * multiplier;
        let left_target = &p * multiplier.conj();
        Ok(MapNeimarkSackerNormalForm {
            angle: multiplier.arg(),
            multiplier,
            parameter_coefficient,
            cubic_coefficient,
            criticality,
            conditioning: MapNormalFormConditioning {
                eigenvector_pairing: pairing,
                right_residual: (&jacobian * &q - right_target).norm(),
                left_residual: (jacobian.transpose() * &p - left_target).norm(),
                homological_residual: (&identity_minus_jacobian * &psi001 - r01)
                    .norm()
                    .max((&lambda2_minus_jacobian * &psi200 - b_q_q).norm())
                    .max((&identity_minus_jacobian * &psi110 - b_q_qbar).norm()),
            },
        })
    })
}
