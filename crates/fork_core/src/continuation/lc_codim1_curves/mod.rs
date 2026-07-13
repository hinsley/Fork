//! Codim-1 bifurcation curve continuation for limit cycles (two-parameter continuation).
//!
//! This module provides continuation of codim-1 bifurcation curves of limit cycles
//! in two-parameter space:
//! - LPC (Limit Point of Cycles) - fold bifurcation curve
//! - PD (Period Doubling) - flip bifurcation curve
//! - NS (Neimark-Sacker) - torus bifurcation curve

mod isoperiodic_curve;
mod lpc_curve;
#[cfg(test)]
mod nonlinear_benchmarks;
mod ns_curve;
mod pd_curve;

pub use isoperiodic_curve::IsoperiodicCurveProblem;
pub use lpc_curve::LPCCurveProblem;
pub use ns_curve::NSCurveProblem;
pub use pd_curve::PDCurveProblem;

use crate::equation_engine::EquationSystem;
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};

const MAX_SCALED_COLLOCATION_DEFECT: f64 = 2.5e-2;

/// Integral phase gauge evaluated on the complete Gauss collocation profile.
///
/// For a reference cycle `u_ref`, the gauge is
///
/// `integral_0^1 <u(tau) - u_ref(tau), u_ref'(tau)> d tau = 0`,
///
/// with `u_ref' = T_ref f(u_ref)`.  Storing the reference values and their
/// normalized-time derivatives makes the gauge affine during every Newton
/// correction.  The reference is replaced only by `update_after_step`, after a
/// trial has passed the independent collocation-defect check.
#[derive(Debug, Clone)]
struct FullProfilePhaseGauge {
    ntst: usize,
    ncol: usize,
    dim: usize,
    stage_weights: Vec<f64>,
    reference_stages: Option<Vec<f64>>,
    reference_derivative: Option<Vec<f64>>,
}

impl FullProfilePhaseGauge {
    fn new(ntst: usize, ncol: usize, dim: usize, gauss_weights: &[f64]) -> Result<Self> {
        if ntst < 2 || ncol == 0 || dim == 0 || gauss_weights.len() != ncol {
            bail!("Invalid collocation layout for the integral phase gauge");
        }
        let mut stage_weights = Vec::with_capacity(ncol);
        for &weight in gauss_weights {
            let normalized = weight / ntst as f64;
            if !normalized.is_finite() || normalized <= 0.0 {
                bail!("Integral phase gauge requires positive finite Gauss weights");
            }
            stage_weights.push(normalized);
        }
        Ok(Self {
            ntst,
            ncol,
            dim,
            stage_weights,
            reference_stages: None,
            reference_derivative: None,
        })
    }

    fn stage_count(&self) -> usize {
        self.ntst * self.ncol
    }

    fn is_initialized(&self) -> bool {
        self.reference_stages.is_some() && self.reference_derivative.is_some()
    }

    #[allow(clippy::too_many_arguments)]
    fn set_reference(
        &mut self,
        system: &mut EquationSystem,
        param1_index: usize,
        param2_index: usize,
        param1: f64,
        param2: f64,
        period: f64,
        stages: &[f64],
    ) -> Result<()> {
        if param1_index >= system.params.len() || param2_index >= system.params.len() {
            bail!("Integral phase gauge parameter index is out of bounds");
        }
        if !param1.is_finite() || !param2.is_finite() {
            bail!("Integral phase gauge parameters must be finite");
        }
        if !period.is_finite() || period <= 0.0 {
            bail!("Integral phase gauge period must be positive and finite");
        }
        if stages.len() != self.stage_count() * self.dim
            || stages.iter().any(|value| !value.is_finite())
        {
            bail!("Integral phase gauge stage profile has invalid dimensions or values");
        }

        system.params[param1_index] = param1;
        system.params[param2_index] = param2;
        let reference_stages = stages.to_vec();
        let mut reference_derivative = vec![0.0; self.stage_count() * self.dim];
        let mut flow = vec![0.0; self.dim];
        for (stage_index, stage) in stages.chunks_exact(self.dim).enumerate() {
            system.apply(0.0, stage, &mut flow);
            if flow.iter().any(|value| !value.is_finite()) {
                bail!("Integral phase gauge reference flow is non-finite");
            }
            for component in 0..self.dim {
                reference_derivative[stage_index * self.dim + component] = period * flow[component];
            }
        }

        let mut norm_squared = 0.0;
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_index = interval * self.ncol + stage;
                for component in 0..self.dim {
                    let value = reference_derivative[stage_index * self.dim + component];
                    norm_squared += self.stage_weights[stage] * value * value;
                }
            }
        }
        if !norm_squared.is_finite() || norm_squared <= 1e-28 {
            bail!("Integral phase condition is singular: reference profile has zero flow");
        }

        self.reference_stages = Some(reference_stages);
        self.reference_derivative = Some(reference_derivative);
        Ok(())
    }

    fn residual(&self, stages: &[f64]) -> Result<f64> {
        let reference = self
            .reference_stages
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase reference is not initialized"))?;
        let derivative = self
            .reference_derivative
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase derivative is not initialized"))?;
        if stages.len() != self.stage_count() * self.dim {
            bail!("Integral phase gauge stage profile has invalid dimensions");
        }

        let mut phase = 0.0;
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_index = interval * self.ncol + stage;
                for component in 0..self.dim {
                    let index = stage_index * self.dim + component;
                    phase += self.stage_weights[stage]
                        * (stages[index] - reference[index])
                        * derivative[index];
                }
            }
        }
        if !phase.is_finite() {
            bail!("Integral phase residual is non-finite");
        }
        Ok(phase)
    }

    fn write_jacobian_row(
        &self,
        jac: &mut DMatrix<f64>,
        row: usize,
        stage_col_start: usize,
    ) -> Result<()> {
        let derivative = self
            .reference_derivative
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase derivative is not initialized"))?;
        let stage_columns = self.stage_count() * self.dim;
        if row >= jac.nrows() || stage_col_start + stage_columns > jac.ncols() {
            bail!("Integral phase Jacobian row does not fit the collocation layout");
        }
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_index = interval * self.ncol + stage;
                for component in 0..self.dim {
                    let index = stage_index * self.dim + component;
                    jac[(row, stage_col_start + index)] =
                        self.stage_weights[stage] * derivative[index];
                }
            }
        }
        Ok(())
    }

    #[cfg(test)]
    fn reference_derivative(&self) -> Option<&[f64]> {
        self.reference_derivative.as_deref()
    }
}

/// Build mesh-independent diagonal PALC weights for an explicitly closed
/// collocation profile. `mesh_0` and `mesh_ntst` represent the same periodic
/// node, so they split that node's weight equally.
fn explicit_profile_palc_weights(
    augmented_len: usize,
    ntst: usize,
    ncol: usize,
    dim: usize,
    nodes: &[f64],
    mesh_start: usize,
    stage_start: usize,
) -> Result<DVector<f64>> {
    if ntst < 2 || ncol == 0 || dim == 0 || nodes.len() != ncol {
        bail!("Invalid explicit collocation layout for PALC metric");
    }
    let mesh_end = mesh_start + (ntst + 1) * dim;
    let stage_end = stage_start + ntst * ncol * dim;
    if mesh_end > augmented_len || stage_end > augmented_len {
        bail!("Explicit collocation layout exceeds augmented PALC state");
    }

    let mut positions = Vec::with_capacity(ncol + 1);
    positions.push(0.0);
    positions.extend(nodes.iter().copied());
    let mut node_weights = Vec::with_capacity(positions.len());
    for index in 0..positions.len() {
        let previous = if index == 0 {
            positions[positions.len() - 1] - 1.0
        } else {
            positions[index - 1]
        };
        let next = if index + 1 == positions.len() {
            1.0
        } else {
            positions[index + 1]
        };
        let weight = 0.5 * (next - previous) / ntst as f64;
        if !weight.is_finite() || weight <= 0.0 {
            bail!("Collocation nodes do not define a positive PALC quadrature metric");
        }
        node_weights.push(weight);
    }

    let mut weights = DVector::from_element(augmented_len, 1.0);
    let mesh_weight = node_weights[0];
    for mesh in 0..=ntst {
        let endpoint_factor = if mesh == 0 || mesh == ntst { 0.5 } else { 1.0 };
        for component in 0..dim {
            weights[mesh_start + mesh * dim + component] = endpoint_factor * mesh_weight;
        }
    }
    for interval in 0..ntst {
        for stage in 0..ncol {
            let weight = node_weights[stage + 1];
            let stage_index = interval * ncol + stage;
            for component in 0..dim {
                weights[stage_start + stage_index * dim + component] = weight;
            }
        }
    }
    Ok(weights)
}

fn lagrange_coefficients(nodes: &[f64]) -> Result<Vec<Vec<f64>>> {
    let degree = nodes.len();
    if degree == 0 {
        bail!("Collocation defect requires at least one collocation node");
    }
    let mut vandermonde = DMatrix::zeros(degree, degree);
    for (row, &node) in nodes.iter().enumerate() {
        let mut power = 1.0;
        for column in 0..degree {
            vandermonde[(row, column)] = power;
            power *= node;
        }
    }
    let lu = vandermonde.lu();
    if !lu.is_invertible() {
        bail!("Failed to invert collocation Vandermonde matrix");
    }
    let mut coefficients = Vec::with_capacity(degree);
    for basis_index in 0..degree {
        let mut rhs = DVector::zeros(degree);
        rhs[basis_index] = 1.0;
        coefficients.push(
            lu.solve(&rhs)
                .ok_or_else(|| anyhow!("Failed to solve for collocation Lagrange basis"))?
                .iter()
                .copied()
                .collect(),
        );
    }
    Ok(coefficients)
}

#[allow(clippy::too_many_arguments)]
fn scaled_collocation_defect(
    system: &mut EquationSystem,
    param1_index: usize,
    param2_index: usize,
    param1: f64,
    param2: f64,
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<f64>],
    period: f64,
    ntst: usize,
    ncol: usize,
    nodes: &[f64],
) -> Result<f64> {
    if !period.is_finite() || period <= 0.0 {
        bail!("Cannot estimate collocation defect for a nonpositive period");
    }
    if ntst < 2 || ncol == 0 || nodes.len() != ncol || mesh_states.len() < ntst {
        bail!("Invalid collocation profile for defect estimation");
    }
    let dim = system.equations.len();
    if dim == 0
        || stage_states.len() != ntst * ncol
        || mesh_states
            .iter()
            .take(ntst)
            .any(|state| state.len() != dim)
        || stage_states.iter().any(|state| state.len() != dim)
    {
        bail!("Collocation profile dimensions do not match the flow system");
    }
    if param1_index >= system.params.len() || param2_index >= system.params.len() {
        bail!("Collocation defect parameter index is out of bounds");
    }
    system.params[param1_index] = param1;
    system.params[param2_index] = param2;

    let h = period / ntst as f64;
    let mut stage_flows = vec![0.0; stage_states.len() * dim];
    let mut flow = vec![0.0; dim];
    for (index, state) in stage_states.iter().enumerate() {
        system.apply(0.0, state, &mut flow);
        stage_flows[index * dim..(index + 1) * dim].copy_from_slice(&flow);
    }

    let lagrange = lagrange_coefficients(nodes)?;
    let check_count = ncol + 1;
    let mut check_bases = Vec::with_capacity(check_count);
    for check in 0..check_count {
        let tau = (check as f64 + 0.5) / check_count as f64;
        let mut basis = vec![0.0; ncol];
        let mut integrals = vec![0.0; ncol];
        for stage in 0..ncol {
            let mut power = 1.0;
            for (degree, coefficient) in lagrange[stage].iter().enumerate() {
                basis[stage] += coefficient * power;
                integrals[stage] += coefficient * power * tau / (degree + 1) as f64;
                power *= tau;
            }
        }
        check_bases.push((basis, integrals));
    }

    let mut max_defect = 0.0_f64;
    let mut state = vec![0.0; dim];
    let mut actual_flow = vec![0.0; dim];
    for (interval, mesh_state) in mesh_states.iter().take(ntst).enumerate() {
        for (basis, integrals) in &check_bases {
            state.copy_from_slice(mesh_state);
            for component in 0..dim {
                for stage in 0..ncol {
                    let index = (interval * ncol + stage) * dim + component;
                    state[component] += h * integrals[stage] * stage_flows[index];
                }
            }
            system.apply(0.0, &state, &mut actual_flow);
            for component in 0..dim {
                let mut polynomial_flow = 0.0;
                for stage in 0..ncol {
                    let index = (interval * ncol + stage) * dim + component;
                    polynomial_flow += basis[stage] * stage_flows[index];
                }
                let scale = 1.0 + actual_flow[component].abs().max(polynomial_flow.abs());
                max_defect =
                    max_defect.max((polynomial_flow - actual_flow[component]).abs() / scale);
            }
        }
    }
    if !max_defect.is_finite() {
        bail!("Collocation defect estimate is non-finite");
    }
    Ok(max_defect)
}

#[allow(clippy::too_many_arguments)]
fn collocation_profile_is_acceptable(
    system: &mut EquationSystem,
    param1_index: usize,
    param2_index: usize,
    param1: f64,
    param2: f64,
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<f64>],
    period: f64,
    ntst: usize,
    ncol: usize,
    nodes: &[f64],
) -> Result<bool> {
    Ok(scaled_collocation_defect(
        system,
        param1_index,
        param2_index,
        param1,
        param2,
        mesh_states,
        stage_states,
        period,
        ntst,
        ncol,
        nodes,
    )? <= MAX_SCALED_COLLOCATION_DEFECT)
}

/// Border vectors for LC bifurcation curve continuation.
///
/// These represent the null vectors of the singular BVP Jacobian that define
/// the bifurcation condition. For LPC and PD, this is a single pair (φ, ψ).
/// For NS, two pairs are needed for the complex eigenspace.
#[derive(Debug, Clone)]
pub struct LCBorders {
    /// Right-null/bottom-row border φ (spans the Jacobian nullspace)
    pub phi: DVector<f64>,
    /// Left-null/last-column border ψ (spans the adjoint nullspace)
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
        if n == 0 || jac.ncols() != n {
            bail!("LC border initialization requires a nonempty square Jacobian");
        }
        if jac.iter().any(|value| !value.is_finite()) {
            bail!("LC border initialization Jacobian contains non-finite values");
        }

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
        let phi_solution = lu
            .solve(&rhs)
            .ok_or_else(|| anyhow!("LC right-border initialization solve is singular"))?;
        if phi_solution.iter().any(|value| !value.is_finite()) {
            bail!("LC right-border initialization solve returned non-finite values");
        }
        let phi_raw: DVector<f64> = phi_solution.rows(0, n).into();
        let phi = normalized_border_vector(phi_raw, "right initialization")?;

        // Solve for ψ using transpose
        let lu_t = bordered.transpose().lu();
        let psi_solution = lu_t
            .solve(&rhs)
            .ok_or_else(|| anyhow!("LC left-border initialization solve is singular"))?;
        if psi_solution.iter().any(|value| !value.is_finite()) {
            bail!("LC left-border initialization solve returned non-finite values");
        }
        let psi_raw: DVector<f64> = psi_solution.rows(0, n).into();
        let psi = normalized_border_vector(psi_raw, "left initialization")?;

        Ok(Self { phi, psi })
    }

    /// Update borders after a step using current φ/ψ as bordering.
    ///
    /// This follows the standard adapt() pattern.
    pub fn update(&mut self, jac: &DMatrix<f64>) -> Result<()> {
        let n = jac.nrows();
        if n == 0 || jac.ncols() != n {
            bail!("LC border update requires a nonempty square Jacobian");
        }
        if self.phi.len() != n || self.psi.len() != n {
            bail!("LC border dimensions do not match the Jacobian");
        }
        if jac.iter().any(|value| !value.is_finite()) {
            bail!("LC border update Jacobian contains non-finite values");
        }
        if self.phi.iter().any(|value| !value.is_finite())
            || self.psi.iter().any(|value| !value.is_finite())
        {
            bail!("LC border update received non-finite border vectors");
        }
        if self.phi.norm() <= 1e-12 || self.psi.norm() <= 1e-12 {
            bail!("LC border update received a near-zero border vector");
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
        let phi_solution = lu
            .solve(&rhs)
            .ok_or_else(|| anyhow!("LC right-border update solve is singular"))?;
        if phi_solution.iter().any(|value| !value.is_finite()) {
            bail!("LC right-border update solve returned non-finite values");
        }
        let phi_new: DVector<f64> = phi_solution.rows(0, n).into();
        let phi_new = normalized_border_vector(phi_new, "right update")?;

        // Solve Bord' * ext = rhs for new ψ
        let lu_t = bordered.transpose().lu();
        let psi_solution = lu_t
            .solve(&rhs)
            .ok_or_else(|| anyhow!("LC left-border update solve is singular"))?;
        if psi_solution.iter().any(|value| !value.is_finite()) {
            bail!("LC left-border update solve returned non-finite values");
        }
        let psi_new: DVector<f64> = psi_solution.rows(0, n).into();
        let psi_new = normalized_border_vector(psi_new, "left update")?;

        // Commit atomically only after both bordered solves have produced valid
        // normalized vectors.
        self.phi = phi_new;
        self.psi = psi_new;

        Ok(())
    }
}

fn normalized_border_vector(vector: DVector<f64>, context: &str) -> Result<DVector<f64>> {
    if vector.iter().any(|value| !value.is_finite()) {
        bail!("LC {context} border vector contains non-finite values");
    }
    let norm = vector.norm();
    if !norm.is_finite() || norm <= 1e-12 {
        bail!("LC {context} border vector is near zero");
    }
    Ok(vector / norm)
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
    use crate::equation_engine::{Bytecode, OpCode};

    fn rotation_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![OpCode::LoadVar(1), OpCode::Neg],
                },
                Bytecode {
                    ops: vec![OpCode::LoadVar(0)],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    #[test]
    fn full_profile_phase_gauge_uses_gauss_quadrature_and_exact_jacobian() {
        let mut system = rotation_system();
        let mut gauge =
            FullProfilePhaseGauge::new(2, 2, 2, &[0.5, 0.5]).expect("valid phase gauge");
        let reference = vec![1.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0, -1.0];
        gauge
            .set_reference(
                &mut system,
                0,
                1,
                0.0,
                0.0,
                std::f64::consts::TAU,
                &reference,
            )
            .expect("phase reference");

        assert!(gauge.residual(&reference).expect("seed phase").abs() < 1e-14);

        let derivative = gauge
            .reference_derivative()
            .expect("reference derivative")
            .to_vec();
        let alpha = 0.125;
        let mut shifted = reference.clone();
        for (value, direction) in shifted.iter_mut().zip(&derivative) {
            *value += alpha * direction;
        }
        let phase = gauge.residual(&shifted).expect("shifted phase");
        assert!((phase - alpha * std::f64::consts::TAU.powi(2)).abs() < 1e-12);

        let mut jac = DMatrix::zeros(1, 11);
        gauge.write_jacobian_row(&mut jac, 0, 3).expect("phase row");
        let eps = 1e-7;
        for stage in 0..4 {
            for component in 0..2 {
                let mut perturbed = shifted.clone();
                perturbed[stage * 2 + component] += eps;
                let finite_difference = (gauge.residual(&perturbed).unwrap() - phase) / eps;
                assert!(
                    (jac[(0, 3 + stage * 2 + component)] - finite_difference).abs() < 1e-8,
                    "stage {stage}, component {component}"
                );
            }
        }
    }

    #[test]
    fn full_profile_phase_gauge_honors_nonuniform_three_point_gauss_weights() {
        let ntst = 2;
        let ncol = 3;
        let dim = 2;
        let alpha = 0.125;
        let period = std::f64::consts::TAU;
        let coeffs = crate::continuation::periodic::CollocationCoefficients::new(ncol)
            .expect("three-point collocation coefficients");
        let reference = (0..ntst)
            .flat_map(|interval| {
                coeffs.nodes.iter().flat_map(move |node| {
                    let angle = period * (interval as f64 + node) / ntst as f64;
                    [angle.cos(), angle.sin()]
                })
            })
            .collect::<Vec<_>>();
        let mut system = rotation_system();
        let mut gauge = FullProfilePhaseGauge::new(ntst, ncol, dim, &coeffs.b)
            .expect("nonuniform three-point phase gauge");
        gauge
            .set_reference(&mut system, 0, 1, 0.0, 0.0, period, &reference)
            .expect("phase reference");
        let derivative = gauge
            .reference_derivative()
            .expect("reference derivative")
            .to_vec();

        for stage in 0..ncol {
            let stage_index = stage;
            let mut shifted = reference.clone();
            for component in 0..dim {
                let index = stage_index * dim + component;
                shifted[index] += alpha * derivative[index];
            }
            let phase = gauge.residual(&shifted).expect("localized phase residual");
            let expected = alpha * coeffs.b[stage] / ntst as f64 * period.powi(2);
            assert!(
                (phase - expected).abs() < 1.0e-13,
                "stage {stage} used the wrong Gauss weight: phase={phase:.16e}, expected={expected:.16e}"
            );
        }
    }

    #[test]
    fn full_profile_phase_gauge_moves_only_after_an_accepted_step() {
        let mut system = rotation_system();
        let mut gauge = FullProfilePhaseGauge::new(2, 1, 2, &[1.0]).expect("valid phase gauge");
        let reference = vec![1.0, 0.0, 0.0, 1.0];
        gauge
            .set_reference(
                &mut system,
                0,
                1,
                0.0,
                0.0,
                std::f64::consts::TAU,
                &reference,
            )
            .expect("phase reference");

        let accepted = vec![1.0, 0.25, 0.0, 1.25];
        assert!(gauge.residual(&accepted).unwrap().abs() > 1e-3);
        gauge
            .set_reference(
                &mut system,
                0,
                1,
                0.0,
                0.0,
                std::f64::consts::TAU,
                &accepted,
            )
            .expect("accepted phase reference");
        assert!(gauge.residual(&accepted).unwrap().abs() < 1e-14);
    }

    #[test]
    fn full_profile_phase_gauge_is_invariant_under_collocation_refinement() {
        let alpha = 0.075;
        let mut residuals = Vec::new();
        for (ntst, ncol) in [(4, 2), (9, 4)] {
            let coeffs = crate::continuation::periodic::CollocationCoefficients::new(ncol)
                .expect("collocation coefficients");
            let reference = (0..ntst)
                .flat_map(|interval| {
                    coeffs.nodes.iter().flat_map(move |node| {
                        let angle = std::f64::consts::TAU * (interval as f64 + node) / ntst as f64;
                        [angle.cos(), angle.sin()]
                    })
                })
                .collect::<Vec<_>>();
            let mut system = rotation_system();
            let mut gauge =
                FullProfilePhaseGauge::new(ntst, ncol, 2, &coeffs.b).expect("refined phase gauge");
            gauge
                .set_reference(
                    &mut system,
                    0,
                    1,
                    0.0,
                    0.0,
                    std::f64::consts::TAU,
                    &reference,
                )
                .expect("refined phase reference");
            let derivative = gauge.reference_derivative().expect("reference derivative");
            let shifted = reference
                .iter()
                .zip(derivative)
                .map(|(value, direction)| value + alpha * direction)
                .collect::<Vec<_>>();
            residuals.push(gauge.residual(&shifted).expect("refined phase residual"));
        }

        let expected = alpha * std::f64::consts::TAU.powi(2);
        for residual in &residuals {
            assert!((residual - expected).abs() < 2e-13, "residual={residual}");
        }
        assert!((residuals[0] - residuals[1]).abs() < 2e-13);
    }

    #[test]
    fn test_lc_borders_creation() {
        let phi = DVector::from_vec(vec![1.0, 0.0, 0.0]);
        let psi = DVector::from_vec(vec![0.0, 1.0, 0.0]);
        let borders = LCBorders::new(phi.clone(), psi.clone());
        assert_eq!(borders.phi, phi);
        assert_eq!(borders.psi, psi);
    }

    #[test]
    fn border_initialization_rejects_nonsquare_and_degenerate_operators() {
        let nonsquare = DMatrix::zeros(2, 3);
        assert!(LCBorders::initialize_from_jacobian(&nonsquare).is_err());

        let corank_two = DMatrix::zeros(2, 2);
        assert!(LCBorders::initialize_from_jacobian(&corank_two).is_err());

        let nonfinite = DMatrix::from_row_slice(1, 1, &[f64::NAN]);
        assert!(LCBorders::initialize_from_jacobian(&nonfinite).is_err());
    }

    #[test]
    fn border_initialization_returns_finite_normalized_null_vectors() {
        let jac = DMatrix::from_diagonal(&DVector::from_vec(vec![0.0, 2.0]));
        let borders = LCBorders::initialize_from_jacobian(&jac).expect("valid corank-one border");
        assert!(borders.phi.iter().all(|value| value.is_finite()));
        assert!(borders.psi.iter().all(|value| value.is_finite()));
        assert!((borders.phi.norm() - 1.0).abs() < 1e-12);
        assert!((borders.psi.norm() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn border_update_rejects_bad_dimensions_solves_and_vectors() {
        let jac = DMatrix::from_diagonal(&DVector::from_vec(vec![0.0, 2.0]));

        let mut rectangular_borders = LCBorders::new(
            DVector::from_vec(vec![1.0, 0.0]),
            DVector::from_vec(vec![1.0, 0.0]),
        );
        assert!(rectangular_borders.update(&DMatrix::zeros(2, 3)).is_err());

        let mut wrong_dimension =
            LCBorders::new(DVector::from_element(1, 1.0), DVector::from_element(1, 1.0));
        assert!(wrong_dimension.update(&jac).is_err());

        let mut zero_borders = LCBorders::new(DVector::zeros(2), DVector::zeros(2));
        assert!(zero_borders.update(&jac).is_err());

        let mut nonfinite_borders = LCBorders::new(
            DVector::from_vec(vec![f64::NAN, 0.0]),
            DVector::from_vec(vec![1.0, 0.0]),
        );
        assert!(nonfinite_borders.update(&jac).is_err());

        let mut valid_borders = LCBorders::new(
            DVector::from_vec(vec![1.0, 0.0]),
            DVector::from_vec(vec![1.0, 0.0]),
        );
        let corank_two = DMatrix::zeros(2, 2);
        assert!(valid_borders.update(&corank_two).is_err());
    }

    #[test]
    fn border_update_replaces_both_vectors_with_finite_normalized_values() {
        let jac = DMatrix::from_diagonal(&DVector::from_vec(vec![0.0, 2.0]));
        let mut borders = LCBorders::new(
            DVector::from_vec(vec![1.0, 0.0]),
            DVector::from_vec(vec![1.0, 0.0]),
        );
        borders.update(&jac).expect("valid border update");
        assert!(borders.phi.iter().all(|value| value.is_finite()));
        assert!(borders.psi.iter().all(|value| value.is_finite()));
        assert!((borders.phi.norm() - 1.0).abs() < 1e-12);
        assert!((borders.psi.norm() - 1.0).abs() < 1e-12);
    }
}
