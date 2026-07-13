//! Poincare-return-map normal forms for bifurcations of periodic orbits.
//!
//! The implementation follows the return-map route exposed by
//! BifurcationKit's periodic-orbit normal-form API.  A local section through
//! the first collocation mesh point removes the autonomous flow's trivial
//! `+1` multiplier.  Finite-difference multilinear forms of that reduced map
//! then provide PD, NS, and generic `+1` coefficients together with explicit
//! residual and conditioning diagnostics.

use super::periodic::{gauss_legendre_nodes, LimitCycleSetup};
use super::BifurcationType;
use crate::equation_engine::EquationSystem;
use crate::solvers::Tsit5;
use crate::traits::{DynamicalSystem, Steppable};
use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::SVD;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

const MIN_NORM: f64 = 1e-13;
const MIN_PAIRING: f64 = 1e-10;
const STRONG_RESONANCE_TOLERANCE: f64 = 1e-4;
type ComplexSpectralBasis = (
    Complex<f64>,
    DVector<Complex<f64>>,
    DVector<Complex<f64>>,
    f64,
);

/// Accuracy controls for periodic-orbit return-map normal forms.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PeriodicOrbitNormalFormSettings {
    /// Fixed fifth-order integration steps per source period.
    pub integration_steps: usize,
    /// Newton corrections of the local-section return time.
    pub return_time_iterations: usize,
    /// Physical displacement used for first derivatives.
    pub jacobian_step: f64,
    /// Physical displacement used for second derivatives.
    pub bilinear_step: f64,
    /// Physical displacement used for third derivatives.
    pub trilinear_step: f64,
    /// Parameter displacement used for parameter derivatives.
    pub parameter_step: f64,
    /// Accepted distance of a critical multiplier from its target set.
    pub multiplier_tolerance: f64,
}

impl Default for PeriodicOrbitNormalFormSettings {
    fn default() -> Self {
        Self {
            integration_steps: 2048,
            return_time_iterations: 4,
            jacobian_step: 2e-5,
            bilinear_step: 8e-4,
            trilinear_step: 4e-3,
            parameter_step: 2e-4,
            multiplier_tolerance: 2e-3,
        }
    }
}

/// Criticality of a PD or NS bifurcation of a periodic orbit.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PeriodicOrbitCriticality {
    Supercritical,
    Subcritical,
    Singular,
}

/// Local classification of the nontrivial `+1` Floquet multiplier.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PeriodicOrbitBranchPointKind {
    /// A fold of cycles: the parameter enters the reduced equation as a
    /// nonzero constant.  This is not a generic periodic branch point.
    LimitPointCycle,
    Transcritical,
    Pitchfork,
    Degenerate,
}

/// Residual and conditioning diagnostics shared by periodic normal forms.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PeriodicOrbitNormalFormConditioning {
    /// Norm of `P(0)` for the reduced Poincare map.
    pub return_map_residual: f64,
    /// Absolute section residual at the corrected return time.
    pub section_residual: f64,
    /// Absolute return-time correction relative to the supplied period.
    pub return_time_correction: f64,
    /// Absolute section transversality `<n, f(x0)>`.
    pub section_transversality: f64,
    /// Absolute left/right eigenvector pairing before adjoint rescaling.
    pub eigenvector_pairing: f64,
    pub right_residual: f64,
    pub left_residual: f64,
    pub homological_residual: f64,
}

/// Reduced normal form at a nontrivial `+1` Floquet multiplier.
///
/// The scalar center equation is
///
/// `xi -> xi + a01*dmu + b11*xi*dmu + b20*xi^2/2 + b30*xi^3/6`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeriodicOrbitBranchPointNormalForm {
    pub kind: PeriodicOrbitBranchPointKind,
    pub constant_parameter_coefficient: f64,
    pub linear_parameter_coefficient: f64,
    pub quadratic_coefficient: f64,
    pub cubic_coefficient: f64,
    /// Unit critical direction at the phase anchor, lifted from the local
    /// section to the full flow state.  It is the branch-switch predictor.
    pub critical_mode: Vec<f64>,
    pub conditioning: PeriodicOrbitNormalFormConditioning,
}

/// Period-doubling normal form `xi -> xi*(-1 + a*dmu + b3*xi^2)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeriodicOrbitPeriodDoublingNormalForm {
    pub multiplier: f64,
    pub parameter_coefficient: f64,
    pub cubic_coefficient: f64,
    pub criticality: PeriodicOrbitCriticality,
    pub critical_mode: Vec<f64>,
    pub conditioning: PeriodicOrbitNormalFormConditioning,
}

/// Neimark-Sacker normal form
/// `z -> exp(i*theta)*z*(1 + a*dmu + b*|z|^2)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PeriodicOrbitNeimarkSackerNormalForm {
    pub angle: f64,
    pub multiplier: Complex<f64>,
    pub parameter_coefficient: Complex<f64>,
    pub cubic_coefficient: Complex<f64>,
    pub criticality: PeriodicOrbitCriticality,
    pub conditioning: PeriodicOrbitNormalFormConditioning,
}

/// Serializable union returned by [`periodic_orbit_normal_form`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum PeriodicOrbitNormalForm {
    BranchPoint(PeriodicOrbitBranchPointNormalForm),
    PeriodDoubling(PeriodicOrbitPeriodDoublingNormalForm),
    NeimarkSacker(PeriodicOrbitNeimarkSackerNormalForm),
}

/// Requested critical multiplier for [`periodic_orbit_normal_form`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PeriodicOrbitNormalFormType {
    BranchPoint,
    PeriodDoubling,
    NeimarkSacker,
}

#[derive(Debug, Clone, Copy)]
struct ReturnDiagnostics {
    section_residual: f64,
    return_time: f64,
}

struct LocalPoincareMap<'a> {
    system: &'a mut EquationSystem,
    param_index: usize,
    anchor: DVector<f64>,
    section_normal: DVector<f64>,
    transverse_basis: DMatrix<f64>,
    period: f64,
    settings: PeriodicOrbitNormalFormSettings,
    transversality: f64,
}

impl<'a> LocalPoincareMap<'a> {
    fn new(
        system: &'a mut EquationSystem,
        setup: &LimitCycleSetup,
        param_index: usize,
        settings: PeriodicOrbitNormalFormSettings,
    ) -> Result<Self> {
        validate_inputs(system, setup, param_index, settings)?;
        let anchor = DVector::from_column_slice(&setup.guess.mesh_states[0]);
        let mut section_normal = DVector::from_column_slice(&setup.phase_direction);
        section_normal /= section_normal.norm();
        let transverse_basis = orthonormal_complement(&section_normal)?;

        let old_param = system.params[param_index];
        system.params[param_index] = setup.guess.param_value;
        let mut vector_field = vec![0.0; anchor.len()];
        system.apply(0.0, anchor.as_slice(), &mut vector_field);
        system.params[param_index] = old_param;
        let transversality = section_normal.dot(&DVector::from_vec(vector_field)).abs();
        if !transversality.is_finite() || transversality <= 1e-8 {
            bail!(
                "Periodic normal form requires a transverse phase section; |<n,f(x0)>|={transversality:.3e}"
            );
        }

        Ok(Self {
            system,
            param_index,
            anchor,
            section_normal,
            transverse_basis,
            period: setup.guess.period,
            settings,
            transversality,
        })
    }

    fn reduced_dimension(&self) -> usize {
        self.transverse_basis.ncols()
    }

    fn lift(&self, reduced: &DVector<f64>) -> DVector<f64> {
        &self.anchor + &self.transverse_basis * reduced
    }

    fn lift_mode(&self, reduced: &DVector<f64>) -> Vec<f64> {
        (&self.transverse_basis * reduced).iter().copied().collect()
    }

    fn evaluate(
        &mut self,
        reduced: &DVector<f64>,
        parameter: f64,
    ) -> Result<(DVector<f64>, ReturnDiagnostics)> {
        if reduced.len() != self.reduced_dimension() {
            bail!("Reduced Poincare-map state has the wrong dimension");
        }
        let initial = self.lift(reduced);
        let old_param = self.system.params[self.param_index];
        self.system.params[self.param_index] = parameter;
        let result = self.evaluate_with_current_parameter(initial.as_slice());
        self.system.params[self.param_index] = old_param;
        result
    }

    fn evaluate_with_current_parameter(
        &self,
        initial: &[f64],
    ) -> Result<(DVector<f64>, ReturnDiagnostics)> {
        let mut return_time = self.period;
        let lower = 0.5 * self.period;
        let upper = 1.5 * self.period;
        let mut returned = integrate_flow(
            self.system,
            initial,
            return_time,
            self.settings.integration_steps,
            self.period,
        )?;
        for _ in 0..self.settings.return_time_iterations {
            let delta = DVector::from_column_slice(&returned) - &self.anchor;
            let section_value = self.section_normal.dot(&delta);
            if section_value.abs() <= 5e-13 {
                break;
            }
            let mut vector_field = vec![0.0; returned.len()];
            self.system.apply(return_time, &returned, &mut vector_field);
            let slope = self.section_normal.dot(&DVector::from_vec(vector_field));
            if !slope.is_finite() || slope.abs() <= 1e-10 {
                bail!("Poincare return-time correction lost section transversality");
            }
            return_time = (return_time - section_value / slope).clamp(lower, upper);
            returned = integrate_flow(
                self.system,
                initial,
                return_time,
                self.settings.integration_steps,
                self.period,
            )?;
        }
        let delta = DVector::from_vec(returned) - &self.anchor;
        let section_residual = self.section_normal.dot(&delta).abs();
        let reduced_return = self.transverse_basis.transpose() * delta;
        Ok((
            reduced_return,
            ReturnDiagnostics {
                section_residual,
                return_time,
            },
        ))
    }

    fn value(&mut self, state: &DVector<f64>, parameter: f64) -> Result<DVector<f64>> {
        self.evaluate(state, parameter).map(|(value, _)| value)
    }

    fn jacobian(&mut self, state: &DVector<f64>, parameter: f64) -> Result<DMatrix<f64>> {
        let n = state.len();
        let mut jacobian = DMatrix::zeros(n, n);
        let step = self.settings.jacobian_step;
        for column in 0..n {
            let mut plus = state.clone();
            let mut minus = state.clone();
            plus[column] += step;
            minus[column] -= step;
            let derivative =
                (self.value(&plus, parameter)? - self.value(&minus, parameter)?) / (2.0 * step);
            jacobian.set_column(column, &derivative);
        }
        Ok(jacobian)
    }

    fn parameter_derivative(
        &mut self,
        state: &DVector<f64>,
        parameter: f64,
    ) -> Result<DVector<f64>> {
        let step = self.settings.parameter_step * (1.0 + parameter.abs());
        Ok(
            (self.value(state, parameter + step)? - self.value(state, parameter - step)?)
                / (2.0 * step),
        )
    }

    fn jacobian_parameter_derivative(
        &mut self,
        state: &DVector<f64>,
        parameter: f64,
    ) -> Result<DMatrix<f64>> {
        let step = self.settings.parameter_step * (1.0 + parameter.abs());
        Ok(
            (self.jacobian(state, parameter + step)? - self.jacobian(state, parameter - step)?)
                / (2.0 * step),
        )
    }

    fn bilinear(
        &mut self,
        state: &DVector<f64>,
        parameter: f64,
        first: &DVector<f64>,
        second: &DVector<f64>,
    ) -> Result<DVector<f64>> {
        if first.norm() <= MIN_NORM || second.norm() <= MIN_NORM {
            return Ok(DVector::zeros(state.len()));
        }
        let first_step = self.settings.bilinear_step / first.norm().max(1.0);
        let second_step = self.settings.bilinear_step / second.norm().max(1.0);
        let pp = state + first * first_step + second * second_step;
        let pm = state + first * first_step - second * second_step;
        let mp = state - first * first_step + second * second_step;
        let mm = state - first * first_step - second * second_step;
        Ok((self.value(&pp, parameter)?
            - self.value(&pm, parameter)?
            - self.value(&mp, parameter)?
            + self.value(&mm, parameter)?)
            / (4.0 * first_step * second_step))
    }

    fn trilinear(
        &mut self,
        state: &DVector<f64>,
        parameter: f64,
        first: &DVector<f64>,
        second: &DVector<f64>,
        third: &DVector<f64>,
    ) -> Result<DVector<f64>> {
        if first.norm() <= MIN_NORM || second.norm() <= MIN_NORM || third.norm() <= MIN_NORM {
            return Ok(DVector::zeros(state.len()));
        }
        let steps = [
            self.settings.trilinear_step / first.norm().max(1.0),
            self.settings.trilinear_step / second.norm().max(1.0),
            self.settings.trilinear_step / third.norm().max(1.0),
        ];
        let directions = [first, second, third];
        let mut result = DVector::zeros(state.len());
        for mask in 0..8usize {
            let mut shifted = state.clone();
            let mut sign = 1.0;
            for index in 0..3 {
                let direction_sign = if mask & (1usize << index) == 0 {
                    -1.0
                } else {
                    1.0
                };
                shifted += directions[index] * (direction_sign * steps[index]);
                sign *= direction_sign;
            }
            result += self.value(&shifted, parameter)? * sign;
        }
        Ok(result / (8.0 * steps[0] * steps[1] * steps[2]))
    }
}

fn validate_inputs(
    system: &EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    settings: PeriodicOrbitNormalFormSettings,
) -> Result<()> {
    let dim = system.equations.len();
    if dim < 2 {
        bail!("Periodic normal forms require a flow dimension of at least two");
    }
    if param_index >= system.params.len() {
        bail!("Periodic normal-form parameter index is out of bounds");
    }
    if setup.guess.mesh_states.is_empty()
        || setup.guess.mesh_states[0].len() != dim
        || setup.phase_direction.len() != dim
    {
        bail!("Periodic normal-form cycle setup has inconsistent dimensions");
    }
    if !setup.guess.period.is_finite() || setup.guess.period <= 0.0 {
        bail!("Periodic normal forms require a positive finite period");
    }
    let phase_norm = DVector::from_column_slice(&setup.phase_direction).norm();
    if !phase_norm.is_finite() || phase_norm <= MIN_NORM {
        bail!("Periodic normal forms require a nonzero phase direction");
    }
    if settings.integration_steps < 8
        || settings.return_time_iterations == 0
        || settings.jacobian_step <= 0.0
        || settings.bilinear_step <= 0.0
        || settings.trilinear_step <= 0.0
        || settings.parameter_step <= 0.0
        || settings.multiplier_tolerance <= 0.0
    {
        bail!("Periodic normal-form accuracy settings are invalid");
    }
    Ok(())
}

fn orthonormal_complement(normal: &DVector<f64>) -> Result<DMatrix<f64>> {
    let n = normal.len();
    let mut basis: Vec<DVector<f64>> = Vec::with_capacity(n.saturating_sub(1));
    for coordinate in 0..n {
        let mut vector = DVector::zeros(n);
        vector[coordinate] = 1.0;
        vector -= normal * normal[coordinate];
        for previous in &basis {
            vector -= previous * previous.dot(&vector);
        }
        let norm = vector.norm();
        if norm > 1e-10 {
            basis.push(vector / norm);
        }
        if basis.len() + 1 == n {
            break;
        }
    }
    if basis.len() + 1 != n {
        bail!("Failed to construct the local Poincare section basis");
    }
    Ok(DMatrix::from_columns(&basis))
}

fn integrate_flow(
    system: &EquationSystem,
    initial: &[f64],
    duration: f64,
    steps_per_period: usize,
    period: f64,
) -> Result<Vec<f64>> {
    if !duration.is_finite() || duration < 0.0 {
        bail!("Periodic return-map integration duration is invalid");
    }
    if duration == 0.0 {
        return Ok(initial.to_vec());
    }
    let steps = ((steps_per_period as f64 * duration / period).ceil() as usize).max(1);
    let dt = duration / steps as f64;
    let mut solver = Tsit5::new(initial.len());
    let mut time = 0.0;
    let mut state = initial.to_vec();
    for _ in 0..steps {
        solver.step(system, &mut time, &mut state, dt);
        if state.iter().any(|value| !value.is_finite()) {
            bail!("Periodic return-map integration produced a non-finite state");
        }
    }
    Ok(state)
}

fn real_nullvectors(
    jacobian: &DMatrix<f64>,
    target: f64,
    tolerance: f64,
) -> Result<(DVector<f64>, DVector<f64>, f64)> {
    let n = jacobian.nrows();
    let shifted = jacobian - DMatrix::identity(n, n).scale(target);
    let right_svd = SVD::new(shifted.clone(), false, true);
    let left_svd = SVD::new(shifted.transpose(), false, true);
    let right_vt = right_svd
        .v_t
        .ok_or_else(|| anyhow!("Periodic normal form omitted right singular vectors"))?;
    let left_vt = left_svd
        .v_t
        .ok_or_else(|| anyhow!("Periodic normal form omitted left singular vectors"))?;
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
        bail!("Periodic normal-form left/right eigenvector pairing is singular");
    }
    p /= pairing;
    let residual = (&shifted * &q)
        .norm()
        .max((shifted.transpose() * &p).norm());
    if residual > tolerance * (1.0 + jacobian.norm()) {
        bail!("Periodic orbit does not have a multiplier sufficiently close to {target}");
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
        .ok_or_else(|| anyhow!("Periodic normal form omitted complex singular vectors"))?;
    let row = v_t.row(v_t.nrows() - 1);
    let mut vector = DVector::from_iterator(n, row.iter().map(|value| value.conj()));
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_NORM {
        bail!("Periodic normal-form complex eigenvector is degenerate");
    }
    vector /= Complex::new(norm, 0.0);
    Ok(vector)
}

fn hermitian_inner(left: &DVector<Complex<f64>>, right: &DVector<Complex<f64>>) -> Complex<f64> {
    left.iter()
        .zip(right.iter())
        .map(|(p, q)| p.conj() * q)
        .sum()
}

fn complex_nullvectors(
    jacobian: &DMatrix<f64>,
    tolerance: f64,
    target_cosine: Option<f64>,
) -> Result<ComplexSpectralBasis> {
    if let Some(target_cosine) = target_cosine {
        if !target_cosine.is_finite() || !(-1.0..=1.0).contains(&target_cosine) {
            bail!("Periodic-orbit NS target cosine must be finite and lie in [-1, 1]");
        }
    }
    let eigenvalues = jacobian.clone().complex_eigenvalues();
    let eligible = eigenvalues
        .iter()
        .copied()
        .filter(|value| value.im > 1e-8)
        .filter(|value| (value.norm() - 1.0).abs() <= tolerance)
        .collect::<Vec<_>>();
    let multiplier = eligible
        .into_iter()
        .min_by(|left, right| match target_cosine {
            Some(target) => {
                let left_cosine = left.re / left.norm();
                let right_cosine = right.re / right.norm();
                (left_cosine - target)
                    .abs()
                    .total_cmp(&(right_cosine - target).abs())
                    .then_with(|| {
                        (left.norm() - 1.0)
                            .abs()
                            .total_cmp(&(right.norm() - 1.0).abs())
                    })
            }
            None => (left.norm() - 1.0)
                .abs()
                .total_cmp(&(right.norm() - 1.0).abs()),
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
                || anyhow!("Periodic orbit has no complex Floquet pair"),
                |order| anyhow!("Periodic-orbit NS multiplier is at a strong 1:{order} resonance"),
            )
        })?;
    for order in 1..=4_u32 {
        if (multiplier.powu(order) - Complex::new(1.0, 0.0)).norm() < STRONG_RESONANCE_TOLERANCE {
            bail!("Periodic-orbit NS multiplier is at a strong 1:{order} resonance");
        }
    }
    let q = complex_eigenvector(jacobian, multiplier)?;
    let mut p = complex_eigenvector(&jacobian.transpose(), multiplier.conj())?;
    let pairing = hermitian_inner(&p, &q);
    if pairing.norm() <= MIN_PAIRING {
        bail!("Periodic NS left/right eigenvector pairing is singular");
    }
    p /= pairing.conj();
    Ok((multiplier, q, p, pairing.norm()))
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
        .ok_or_else(|| anyhow!("Periodic normal-form bordered range solve is singular"))?;
    Ok(solution.rows(0, n).into_owned())
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
    map: &mut LocalPoincareMap<'_>,
    state: &DVector<f64>,
    parameter: f64,
    first: &DVector<Complex<f64>>,
    second: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let (first_re, first_im) = split_complex(first);
    let (second_re, second_im) = split_complex(second);
    let real = map.bilinear(state, parameter, &first_re, &second_re)?
        - map.bilinear(state, parameter, &first_im, &second_im)?;
    let imag = map.bilinear(state, parameter, &first_re, &second_im)?
        + map.bilinear(state, parameter, &first_im, &second_re)?;
    Ok(join_complex(real, imag))
}

fn trilinear_complex(
    map: &mut LocalPoincareMap<'_>,
    state: &DVector<f64>,
    parameter: f64,
    first: &DVector<Complex<f64>>,
    second: &DVector<Complex<f64>>,
    third: &DVector<Complex<f64>>,
) -> Result<DVector<Complex<f64>>> {
    let split = [first, second, third].map(split_complex);
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
            .any(|direction| direction.norm() <= MIN_NORM)
        {
            continue;
        }
        result += map
            .trilinear(state, parameter, selected[0], selected[1], selected[2])?
            .map(|value| factor * value);
    }
    Ok(result)
}

fn base_conditioning(
    map: &mut LocalPoincareMap<'_>,
    parameter: f64,
    pairing: f64,
    right_residual: f64,
    left_residual: f64,
    homological_residual: f64,
) -> Result<PeriodicOrbitNormalFormConditioning> {
    let zero = DVector::zeros(map.reduced_dimension());
    let (returned, diagnostics) = map.evaluate(&zero, parameter)?;
    Ok(PeriodicOrbitNormalFormConditioning {
        return_map_residual: returned.norm(),
        section_residual: diagnostics.section_residual,
        return_time_correction: (diagnostics.return_time - map.period).abs(),
        section_transversality: map.transversality,
        eigenvector_pairing: pairing,
        right_residual,
        left_residual,
        homological_residual,
    })
}

/// Compute one of the supported Poincare-return-map normal forms for a
/// corrected periodic orbit.
pub fn periodic_orbit_normal_form(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    normal_form_type: PeriodicOrbitNormalFormType,
) -> Result<PeriodicOrbitNormalForm> {
    match normal_form_type {
        PeriodicOrbitNormalFormType::BranchPoint => {
            periodic_branch_point_normal_form(system, setup, param_index)
                .map(PeriodicOrbitNormalForm::BranchPoint)
        }
        PeriodicOrbitNormalFormType::PeriodDoubling => {
            periodic_period_doubling_normal_form(system, setup, param_index)
                .map(PeriodicOrbitNormalForm::PeriodDoubling)
        }
        PeriodicOrbitNormalFormType::NeimarkSacker => {
            periodic_neimark_sacker_normal_form(system, setup, param_index)
                .map(PeriodicOrbitNormalForm::NeimarkSacker)
        }
    }
}

/// Compute and classify the nontrivial `+1` Floquet normal form.
pub fn periodic_branch_point_normal_form(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
) -> Result<PeriodicOrbitBranchPointNormalForm> {
    periodic_branch_point_normal_form_with_settings(
        system,
        setup,
        param_index,
        PeriodicOrbitNormalFormSettings::default(),
    )
}

pub fn periodic_branch_point_normal_form_with_settings(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    settings: PeriodicOrbitNormalFormSettings,
) -> Result<PeriodicOrbitBranchPointNormalForm> {
    let parameter = setup.guess.param_value;
    let mut map = LocalPoincareMap::new(system, setup, param_index, settings)?;
    let n = map.reduced_dimension();
    let zero = DVector::zeros(n);
    let jacobian = map.jacobian(&zero, parameter)?;
    let (q, p, pairing) = real_nullvectors(&jacobian, 1.0, settings.multiplier_tolerance)?;
    let identity_minus_jacobian = DMatrix::identity(n, n) - &jacobian;

    let r01 = map.parameter_derivative(&zero, parameter)?;
    let a01 = p.dot(&r01);
    let projected_r01 = &r01 - &q * a01;
    let psi01 = bordered_range_solve(&identity_minus_jacobian, &q, &p, &projected_r01)?;
    let r11 = map.jacobian_parameter_derivative(&zero, parameter)? * &q;
    let b11 = p.dot(&(r11 + map.bilinear(&zero, parameter, &q, &psi01)?));

    let b_qq = map.bilinear(&zero, parameter, &q, &q)?;
    let b20 = p.dot(&b_qq);
    let projected_b_qq = &b_qq - &q * b20;
    let h20 = bordered_range_solve(&identity_minus_jacobian, &q, &p, &projected_b_qq)?;
    let b30 = p.dot(
        &(map.trilinear(&zero, parameter, &q, &q, &q)?
            + map.bilinear(&zero, parameter, &q, &h20)? * 3.0),
    );

    let (base_return, _) = map.evaluate(&zero, parameter)?;
    let fold_threshold = (1000.0 * base_return.norm()).max(1e-5);
    let kind = if a01.abs() > fold_threshold {
        PeriodicOrbitBranchPointKind::LimitPointCycle
    } else if 100.0 * (0.5 * b20).abs() < (b30 / 6.0).abs() {
        PeriodicOrbitBranchPointKind::Pitchfork
    } else if b20.abs() > 1e-8 || b11.abs() > 1e-8 {
        PeriodicOrbitBranchPointKind::Transcritical
    } else {
        PeriodicOrbitBranchPointKind::Degenerate
    };

    let right_residual = (&jacobian * &q - &q).norm();
    let left_residual = (jacobian.transpose() * &p - &p).norm();
    let homological_residual = (&identity_minus_jacobian * &psi01 - projected_r01)
        .norm()
        .max((&identity_minus_jacobian * &h20 - projected_b_qq).norm());
    let conditioning = base_conditioning(
        &mut map,
        parameter,
        pairing,
        right_residual,
        left_residual,
        homological_residual,
    )?;
    Ok(PeriodicOrbitBranchPointNormalForm {
        kind,
        constant_parameter_coefficient: a01,
        linear_parameter_coefficient: b11,
        quadratic_coefficient: b20,
        cubic_coefficient: b30,
        critical_mode: map.lift_mode(&q),
        conditioning,
    })
}

/// Convert the local `+1` classification to Fork's branch label.
pub fn periodic_plus_one_bifurcation_type(
    normal_form: &PeriodicOrbitBranchPointNormalForm,
) -> BifurcationType {
    if normal_form.kind == PeriodicOrbitBranchPointKind::LimitPointCycle {
        BifurcationType::CycleFold
    } else {
        BifurcationType::BranchPoint
    }
}

/// Compute the periodic-orbit period-doubling normal form.
pub fn periodic_period_doubling_normal_form(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
) -> Result<PeriodicOrbitPeriodDoublingNormalForm> {
    periodic_period_doubling_normal_form_with_settings(
        system,
        setup,
        param_index,
        PeriodicOrbitNormalFormSettings::default(),
    )
}

pub fn periodic_period_doubling_normal_form_with_settings(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    settings: PeriodicOrbitNormalFormSettings,
) -> Result<PeriodicOrbitPeriodDoublingNormalForm> {
    let parameter = setup.guess.param_value;
    let mut map = LocalPoincareMap::new(system, setup, param_index, settings)?;
    let n = map.reduced_dimension();
    let zero = DVector::zeros(n);
    let jacobian = map.jacobian(&zero, parameter)?;
    let (q, p, pairing) = real_nullvectors(&jacobian, -1.0, settings.multiplier_tolerance)?;
    let identity_minus_jacobian = DMatrix::identity(n, n) - &jacobian;
    let r01 = map.parameter_derivative(&zero, parameter)?;
    let psi01 = identity_minus_jacobian
        .clone()
        .lu()
        .solve(&r01)
        .ok_or_else(|| anyhow!("Periodic PD parameter homological solve is singular"))?;
    let r11 = map.jacobian_parameter_derivative(&zero, parameter)? * &q;
    let parameter_coefficient = p.dot(&(r11 + map.bilinear(&zero, parameter, &q, &psi01)?));

    let b_qq = map.bilinear(&zero, parameter, &q, &q)?;
    let h20 = identity_minus_jacobian
        .clone()
        .lu()
        .solve(&b_qq)
        .ok_or_else(|| anyhow!("Periodic PD quadratic homological solve is singular"))?;
    let cubic_vector = map.trilinear(&zero, parameter, &q, &q, &q)?
        + map.bilinear(&zero, parameter, &q, &h20)? * 3.0;
    let cubic_coefficient = p.dot(&cubic_vector) / 6.0;
    let criticality = if cubic_coefficient > 1e-10 {
        PeriodicOrbitCriticality::Supercritical
    } else if cubic_coefficient < -1e-10 {
        PeriodicOrbitCriticality::Subcritical
    } else {
        PeriodicOrbitCriticality::Singular
    };
    let multiplier = p.dot(&(&jacobian * &q));
    let right_residual = (&jacobian * &q + &q).norm();
    let left_residual = (jacobian.transpose() * &p + &p).norm();
    let homological_residual = (&identity_minus_jacobian * &psi01 - r01)
        .norm()
        .max((&identity_minus_jacobian * &h20 - b_qq).norm());
    let conditioning = base_conditioning(
        &mut map,
        parameter,
        pairing,
        right_residual,
        left_residual,
        homological_residual,
    )?;
    Ok(PeriodicOrbitPeriodDoublingNormalForm {
        multiplier,
        parameter_coefficient,
        cubic_coefficient,
        criticality,
        critical_mode: map.lift_mode(&q),
        conditioning,
    })
}

/// Compute the periodic-orbit Neimark-Sacker normal form.
pub fn periodic_neimark_sacker_normal_form(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
) -> Result<PeriodicOrbitNeimarkSackerNormalForm> {
    periodic_neimark_sacker_normal_form_with_settings(
        system,
        setup,
        param_index,
        PeriodicOrbitNormalFormSettings::default(),
    )
}

pub fn periodic_neimark_sacker_normal_form_with_settings(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    settings: PeriodicOrbitNormalFormSettings,
) -> Result<PeriodicOrbitNeimarkSackerNormalForm> {
    periodic_neimark_sacker_normal_form_selected(system, setup, param_index, settings, None)
}

/// Compute the periodic-orbit Neimark-Sacker normal form for the complex
/// Floquet pair whose normalized real part is closest to `target_cosine`.
///
/// A continued NS curve already carries `k = cos(theta)` in its augmented
/// state.  Supplying that value prevents a nearby secondary unit-modulus pair
/// from being mistaken for the pair defining the curve.
pub fn periodic_neimark_sacker_normal_form_for_cosine_with_settings(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    target_cosine: f64,
    settings: PeriodicOrbitNormalFormSettings,
) -> Result<PeriodicOrbitNeimarkSackerNormalForm> {
    periodic_neimark_sacker_normal_form_selected(
        system,
        setup,
        param_index,
        settings,
        Some(target_cosine),
    )
}

fn periodic_neimark_sacker_normal_form_selected(
    system: &mut EquationSystem,
    setup: &LimitCycleSetup,
    param_index: usize,
    settings: PeriodicOrbitNormalFormSettings,
    target_cosine: Option<f64>,
) -> Result<PeriodicOrbitNeimarkSackerNormalForm> {
    let parameter = setup.guess.param_value;
    let mut map = LocalPoincareMap::new(system, setup, param_index, settings)?;
    let n = map.reduced_dimension();
    let zero = DVector::zeros(n);
    let jacobian_real = map.jacobian(&zero, parameter)?;
    let jacobian = jacobian_real.map(|value| Complex::new(value, 0.0));
    let (multiplier, q, p, pairing) =
        complex_nullvectors(&jacobian_real, settings.multiplier_tolerance, target_cosine)?;
    let qbar = q.map(|value| value.conj());

    let r01 = map
        .parameter_derivative(&zero, parameter)?
        .map(|value| Complex::new(value, 0.0));
    let identity_minus_jacobian =
        DMatrix::identity(n, n).map(|value| Complex::new(value, 0.0)) - &jacobian;
    let psi001 = identity_minus_jacobian
        .clone()
        .lu()
        .solve(&r01)
        .ok_or_else(|| anyhow!("Periodic NS parameter homological solve is singular"))?;
    let jacobian_parameter = map
        .jacobian_parameter_derivative(&zero, parameter)?
        .map(|value| Complex::new(value, 0.0));
    let parameter_vector =
        &jacobian_parameter * &q + bilinear_complex(&mut map, &zero, parameter, &q, &psi001)?;
    let parameter_coefficient = hermitian_inner(&p, &parameter_vector) / multiplier;

    let b_q_q = bilinear_complex(&mut map, &zero, parameter, &q, &q)?;
    let mut lambda2_minus_jacobian = -&jacobian;
    for index in 0..n {
        lambda2_minus_jacobian[(index, index)] += multiplier * multiplier;
    }
    let psi200 = lambda2_minus_jacobian
        .clone()
        .lu()
        .solve(&b_q_q)
        .ok_or_else(|| anyhow!("Periodic NS second-harmonic solve is singular"))?;
    let b_q_qbar = bilinear_complex(&mut map, &zero, parameter, &q, &qbar)?;
    let psi110 = identity_minus_jacobian
        .clone()
        .lu()
        .solve(&b_q_qbar)
        .ok_or_else(|| anyhow!("Periodic NS mean homological solve is singular"))?;
    // Kuznetsov's Poincare-map convention:
    // d = e^(-i theta)/2 <p, C(q,q,qbar) + 2B(q,h11) + B(qbar,h20)>.
    let cubic_vector = trilinear_complex(&mut map, &zero, parameter, &q, &q, &qbar)?
        + bilinear_complex(&mut map, &zero, parameter, &q, &psi110)? * Complex::new(2.0, 0.0)
        + bilinear_complex(&mut map, &zero, parameter, &qbar, &psi200)?;
    let cubic_coefficient =
        hermitian_inner(&p, &cubic_vector) / multiplier / Complex::new(2.0, 0.0);
    let criticality = if cubic_coefficient.re < -1e-10 {
        PeriodicOrbitCriticality::Supercritical
    } else if cubic_coefficient.re > 1e-10 {
        PeriodicOrbitCriticality::Subcritical
    } else {
        PeriodicOrbitCriticality::Singular
    };
    let right_target = &q * multiplier;
    let left_target = &p * multiplier.conj();
    let right_residual = (&jacobian * &q - right_target).norm();
    let left_residual = (jacobian.transpose() * &p - left_target).norm();
    let homological_residual = (&identity_minus_jacobian * &psi001 - r01)
        .norm()
        .max((&lambda2_minus_jacobian * &psi200 - b_q_q).norm())
        .max((&identity_minus_jacobian * &psi110 - b_q_qbar).norm());
    let conditioning = base_conditioning(
        &mut map,
        parameter,
        pairing,
        right_residual,
        left_residual,
        homological_residual,
    )?;
    Ok(PeriodicOrbitNeimarkSackerNormalForm {
        angle: multiplier.arg(),
        multiplier,
        parameter_coefficient,
        cubic_coefficient,
        criticality,
        conditioning,
    })
}

/// Build a collocation predictor on the periodic branch emanating from a
/// generic transcritical or pitchfork branch point.
pub fn periodic_branch_point_switch_setup(
    system: &mut EquationSystem,
    source: &LimitCycleSetup,
    param_index: usize,
    normal_form: &PeriodicOrbitBranchPointNormalForm,
    amplitude: f64,
) -> Result<LimitCycleSetup> {
    if !amplitude.is_finite() || amplitude.abs() <= 1e-10 {
        bail!("Periodic branch switching requires a nonzero finite amplitude");
    }
    if param_index >= system.params.len() {
        bail!("Periodic branch-switch parameter index is out of bounds");
    }
    if source.guess.mesh_states.is_empty()
        || source.guess.mesh_states[0].len() != system.equations.len()
        || source.mesh_points == 0
    {
        bail!("Periodic branch-switch source setup has inconsistent dimensions");
    }
    if normal_form.critical_mode.len() != system.equations.len() {
        bail!("Periodic branch-point mode dimension does not match the system");
    }
    let parameter_displacement = match normal_form.kind {
        PeriodicOrbitBranchPointKind::Transcritical => {
            if normal_form.linear_parameter_coefficient.abs() <= 1e-10 {
                bail!("Transcritical periodic branch point has singular parameter coefficient");
            }
            -normal_form.quadratic_coefficient * amplitude
                / (2.0 * normal_form.linear_parameter_coefficient)
        }
        PeriodicOrbitBranchPointKind::Pitchfork => {
            if normal_form.linear_parameter_coefficient.abs() <= 1e-10 {
                bail!("Pitchfork periodic branch point has singular parameter coefficient");
            }
            -normal_form.cubic_coefficient * amplitude * amplitude
                / (6.0 * normal_form.linear_parameter_coefficient)
        }
        PeriodicOrbitBranchPointKind::LimitPointCycle => {
            bail!("A limit point of cycles does not have an emanating periodic branch")
        }
        PeriodicOrbitBranchPointKind::Degenerate => {
            bail!("Degenerate periodic branch point has no reliable branch predictor")
        }
    };
    let predicted_parameter = source.guess.param_value + parameter_displacement;
    let mut initial = source.guess.mesh_states[0].clone();
    for (value, mode) in initial.iter_mut().zip(normal_form.critical_mode.iter()) {
        *value += amplitude * mode;
    }

    let nodes = gauss_legendre_nodes(source.collocation_degree)?;
    let normalized_mesh = source.resolved_normalized_mesh()?;
    let old_param = system.params[param_index];
    system.params[param_index] = predicted_parameter;
    let period = source.guess.period;
    let mesh_states_result = (0..source.mesh_points)
        .map(|interval| {
            integrate_flow(
                system,
                &initial,
                period * normalized_mesh[interval],
                PeriodicOrbitNormalFormSettings::default().integration_steps,
                period,
            )
        })
        .collect::<Result<Vec<_>>>();
    let stage_states_result = (0..source.mesh_points)
        .map(|interval| {
            let left = normalized_mesh[interval];
            let width = normalized_mesh[interval + 1] - left;
            nodes
                .iter()
                .map(|node| {
                    integrate_flow(
                        system,
                        &initial,
                        period * (left + node * width),
                        PeriodicOrbitNormalFormSettings::default().integration_steps,
                        period,
                    )
                })
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>();
    system.params[param_index] = old_param;
    let mesh_states = mesh_states_result?;
    let stage_states = stage_states_result?;

    let mut switched = source.clone();
    switched.guess.param_value = predicted_parameter;
    switched.guess.mesh_states = mesh_states;
    switched.guess.stage_states = stage_states;
    switched.guess.requires_fixed_parameter_correction = true;
    Ok(switched)
}
