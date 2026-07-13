//! NS (Neimark-Sacker) curve continuation.
//!
//! Continues Neimark-Sacker (torus) bifurcations of limit cycles in two-parameter space.
//! The defining system is:
//! - Standard BVP for the limit cycle: F(u, T, p) = 0
//! - Two singularity conditions: G1 = 0, G2 = 0 (complex pair on unit circle)
//!
//! Key differences from LPC/PD:
//! - Extra auxiliary variable k = cos(θ) where θ is the angle of critical multiplier
//! - Two border vector pairs (for 2D complex eigenspace)
//! - Bordered Jacobian includes rotation by e^{iθ}

use super::{
    collocation_profile_is_acceptable, explicit_profile_palc_weights, FullProfilePhaseGauge,
    LCBorders,
};
use crate::continuation::codim1_curves::Codim2TestFunctions;
use crate::continuation::periodic::{
    extract_collocation_transfers_from_jacobian, extract_multipliers_collocation,
    CollocationCoefficients,
};
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};

/// Build the real doubled-period variational operator used for the NS
/// minimally extended system.
///
/// Each interval transfer comes from the orthogonal-collocation equations. On
/// the doubled interval the final boundary row imposes
///
/// `v(0) - 2 k v(1) + v(2) = 0`,
///
/// so the operator has a two-dimensional real nullspace exactly when the
/// one-period Floquet map has a conjugate pair satisfying
/// `mu^2 - 2 k mu + 1 = 0`. This is the real polynomial form of the complex
/// rotation boundary condition and remains regular at `k = +/-1`.
fn build_ns_boundary_operator(transfers: &[DMatrix<f64>], k: f64) -> Result<DMatrix<f64>> {
    if !k.is_finite() || !(-1.0..=1.0).contains(&k) {
        bail!("NS rotation parameter k must be finite and lie in [-1, 1]");
    }
    let first = transfers
        .first()
        .ok_or_else(|| anyhow!("NS continuation requires interval transfer matrices"))?;
    let dim = first.nrows();
    if dim == 0 || first.ncols() != dim {
        bail!("NS interval transfer matrices must be square and non-empty");
    }
    if transfers
        .iter()
        .any(|transfer| transfer.nrows() != dim || transfer.ncols() != dim)
    {
        bail!("NS interval transfer matrices must have a common square dimension");
    }

    let period_block_dim = transfers
        .len()
        .checked_mul(dim)
        .ok_or_else(|| anyhow!("NS boundary-operator dimension overflow"))?;
    let operator_dim = period_block_dim
        .checked_mul(2)
        .ok_or_else(|| anyhow!("NS doubled boundary-operator dimension overflow"))?;
    let doubled_intervals = transfers.len() * 2;
    let mut operator = DMatrix::<f64>::zeros(operator_dim, operator_dim);

    for interval in 0..doubled_intervals {
        let row = interval * dim;
        let current_col = interval * dim;
        let transfer = &transfers[interval % transfers.len()];
        operator
            .view_mut((row, current_col), (dim, dim))
            .copy_from(transfer);

        if interval + 1 < doubled_intervals {
            let next_col = (interval + 1) * dim;
            for component in 0..dim {
                operator[(row + component, next_col + component)] -= 1.0;
            }
        } else {
            // T_last v_(2N-1) - 2 k v_N + v_0 = 0.
            for component in 0..dim {
                operator[(row + component, component)] += 1.0;
                operator[(row + component, period_block_dim + component)] -= 2.0 * k;
            }
        }
    }

    Ok(operator)
}

/// NS curve continuation problem.
///
/// Augmented state layout: [p1, stages..., meshes..., T, p2, k]
/// where k = cos(θ) and θ is the argument of the critical Floquet multiplier.
///
/// The additional variable k tracks the angle through its cosine.
pub struct NSCurveProblem<'a> {
    /// The dynamical system
    system: &'a mut EquationSystem,
    /// Index of first active parameter
    param1_index: usize,
    /// Index of second active parameter  
    param2_index: usize,
    /// State dimension
    dim: usize,
    /// Number of mesh intervals
    ntst: usize,
    /// Collocation degree
    ncol: usize,
    /// Collocation coefficients
    coeffs: CollocationCoefficients,
    /// Integral phase condition on the complete Gauss collocation profile.
    phase_gauge: FullProfilePhaseGauge,
    /// Border vectors for first singularity (real part)
    borders1: LCBorders,
    /// Border vectors for second singularity (imaginary part)  
    borders2: LCBorders,
    /// Indices for selecting singularity functions from bordered solve
    index1: (usize, usize),
    /// Indices for selecting singularity functions from bordered solve
    index2: (usize, usize),
    /// Cached BVP Jacobian
    cached_jac: Option<DMatrix<f64>>,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
    /// Codim-2 test function values
    codim2_tests: Codim2TestFunctions,
}

impl<'a> NSCurveProblem<'a> {
    /// Create a new NS curve problem from a detected NS point.
    ///
    /// The initial k value should be cos(θ) where θ = arg(μ) for the critical
    /// Floquet multiplier μ on the unit circle.
    pub fn new(
        system: &'a mut EquationSystem,
        lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        initial_k: f64, // cos(θ) for the NS multiplier angle
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        let dim = system.equations.len();
        if dim == 0 || ntst < 2 {
            bail!("NS continuation requires a positive state dimension and at least two mesh intervals");
        }
        if !period.is_finite() || period <= 0.0 {
            bail!("NS continuation requires a finite positive period");
        }
        if !initial_k.is_finite() || !(-1.0..=1.0).contains(&initial_k) {
            bail!("NS rotation parameter k must be finite and lie in [-1, 1]");
        }
        let coeffs = CollocationCoefficients::new(ncol)?;

        let stage_count = ntst * ncol;
        let ncoords = stage_count * dim + (ntst + 1) * dim;
        if lc_state.len() != ncoords {
            bail!(
                "NS collocation seed has length {}, expected {}",
                lc_state.len(),
                ncoords
            );
        }

        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];

        let phase_gauge = FullProfilePhaseGauge::new(ntst, ncol, dim, &coeffs.b)?;

        // The NS characteristic operator is defined on a doubled period after
        // eliminating collocation stages, hence 2 * ntst * dim unknowns.
        // Temporary coordinate borders are replaced below by singular vectors
        // of the seed operator.
        let ns_dimension = 2 * ntst * dim;
        let mut phi1 = DVector::zeros(ns_dimension);
        phi1[0] = 1.0;
        let mut phi2 = DVector::zeros(ns_dimension);
        phi2[1] = 1.0;
        let borders1 = LCBorders::new(phi1.clone(), phi1);
        let borders2 = LCBorders::new(phi2.clone(), phi2);

        // Default indices for singularity function extraction
        // The reduced real 2x2 border block represents one complex scalar.
        // Its two diagonal entries carry the same real condition (up to sign),
        // so use one diagonal and one off-diagonal entry to retain independent
        // real and imaginary characteristic equations.
        let index1 = (0, 0);
        let index2 = (0, 1);

        let mut problem = Self {
            system,
            param1_index,
            param2_index,
            dim,
            ntst,
            ncol,
            coeffs,
            phase_gauge,
            borders1,
            borders2,
            index1,
            index2,
            cached_jac: None,
            work_f,
            work_j,
            codim2_tests: Codim2TestFunctions::default(),
        };

        let mut initial_aug = Vec::with_capacity(problem.aug_dim());
        initial_aug.push(param1_value);
        initial_aug.extend_from_slice(&lc_state);
        initial_aug.push(period);
        initial_aug.push(param2_value);
        initial_aug.push(initial_k);
        let initial_aug = DVector::from_vec(initial_aug);
        let seed_jac = problem.build_periodic_jac(&initial_aug)?;
        let seed_operator = problem.ns_operator_from_bvp_jac(&seed_jac, initial_k)?;
        problem.set_ns_borders_from_operator(&seed_operator)?;

        Ok(problem)
    }

    fn ncoords(&self) -> usize {
        self.ntst * self.ncol * self.dim + (self.ntst + 1) * self.dim
    }

    fn period_index(&self) -> usize {
        1 + self.ncoords()
    }

    fn param2_idx(&self) -> usize {
        self.period_index() + 1
    }

    /// Index of k (cos θ) in augmented state
    fn k_index(&self) -> usize {
        self.param2_idx() + 1
    }

    #[allow(dead_code)]
    fn aug_dim(&self) -> usize {
        // p1 + coords + T + p2 + k
        1 + self.ncoords() + 1 + 1 + 1
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }

    /// Number of residual equations
    fn n_eqs(&self) -> usize {
        // collocation + continuity + explicit periodic BC + phase + G1 + G2
        self.ntst * self.ncol * self.dim + self.ntst * self.dim + self.dim + 1 + 2
    }

    fn get_p1(&self, aug: &DVector<f64>) -> f64 {
        aug[0]
    }

    fn get_p2(&self, aug: &DVector<f64>) -> f64 {
        aug[self.param2_idx()]
    }

    fn get_period(&self, aug: &DVector<f64>) -> f64 {
        aug[self.period_index()]
    }

    fn get_k(&self, aug: &DVector<f64>) -> f64 {
        aug[self.k_index()]
    }

    fn stage_slice<'b>(&self, aug: &'b [f64], interval: usize, stage: usize) -> &'b [f64] {
        let idx = interval * self.ncol + stage;
        let start = 1 + idx * self.dim;
        &aug[start..start + self.dim]
    }

    fn mesh_slice<'b>(&self, aug: &'b [f64], idx: usize) -> &'b [f64] {
        let actual = idx % (self.ntst + 1);
        let mesh_offset = 1 + self.ntst * self.ncol * self.dim;
        let start = mesh_offset + actual * self.dim;
        &aug[start..start + self.dim]
    }

    fn stage_profile<'b>(&self, aug: &'b DVector<f64>) -> &'b [f64] {
        let stage_len = self.ntst * self.ncol * self.dim;
        &aug.as_slice()[1..1 + stage_len]
    }

    fn set_phase_reference(&mut self, aug: &DVector<f64>) -> Result<()> {
        let stages = self.stage_profile(aug);
        self.phase_gauge.set_reference(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug),
            self.get_period(aug),
            stages,
        )
    }

    fn ensure_phase_reference(&mut self, aug: &DVector<f64>) -> Result<()> {
        if !self.phase_gauge.is_initialized() {
            self.set_phase_reference(aug)?;
        }
        Ok(())
    }

    fn eval_f(&mut self, state: &[f64], p1: f64, p2: f64) -> Vec<f64> {
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;

        let mut result = vec![0.0; self.dim];
        self.system.apply(0.0, state, &mut result);
        result
    }

    fn eval_jac(&mut self, state: &[f64], p1: f64, p2: f64) -> Result<Vec<f64>> {
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;
        compute_jacobian(self.system, SystemKind::Flow, state)
    }

    /// Compute the two singularity functions from a two-column bordered solve
    /// of the doubled-period characteristic operator.
    fn compute_ns_singularities(&self, operator: &DMatrix<f64>) -> Result<(f64, f64)> {
        let n = operator.nrows();
        if n == 0 || operator.ncols() != n {
            bail!("NS characteristic operator must be square and non-empty");
        }
        if self.borders1.phi.len() != n
            || self.borders1.psi.len() != n
            || self.borders2.phi.len() != n
            || self.borders2.psi.len() != n
        {
            bail!("NS border dimensions do not match the characteristic operator");
        }

        // [L  W; V' 0], where W contains left-nullspace borders and V
        // contains right-nullspace borders. The selected entries of the lower
        // right inverse block vanish when L has corank two.
        let mut bordered = DMatrix::zeros(n + 2, n + 2);
        bordered.view_mut((0, 0), (n, n)).copy_from(operator);

        // Border columns
        for i in 0..n.min(self.borders1.psi.len()) {
            bordered[(i, n)] = self.borders1.psi[i];
        }
        for i in 0..n.min(self.borders2.psi.len()) {
            bordered[(i, n + 1)] = self.borders2.psi[i];
        }

        // Border rows
        for i in 0..n.min(self.borders1.phi.len()) {
            bordered[(n, i)] = self.borders1.phi[i];
        }
        for i in 0..n.min(self.borders2.phi.len()) {
            bordered[(n + 1, i)] = self.borders2.phi[i];
        }

        // RHS: 2 columns, identity in the border block
        let mut rhs = DMatrix::zeros(n + 2, 2);
        rhs[(n, 0)] = 1.0;
        rhs[(n + 1, 1)] = 1.0;

        let sol = bordered
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("NS bordered characteristic system is singular"))?;
        let g1 = sol[(n + self.index1.0, self.index1.1)];
        let g2 = sol[(n + self.index2.0, self.index2.1)];
        if !g1.is_finite() || !g2.is_finite() {
            bail!("NS bordered characteristic solve returned non-finite values");
        }
        Ok((g1, g2))
    }

    fn ns_operator_from_bvp_jac(&self, jac: &DMatrix<f64>, k: f64) -> Result<DMatrix<f64>> {
        let remapped_jac = self.remap_jac_for_multiplier_extraction(jac);
        let transfers = extract_collocation_transfers_from_jacobian(
            &remapped_jac,
            self.dim,
            self.ntst,
            self.ncol,
        )?;
        build_ns_boundary_operator(&transfers, k)
    }

    /// Adapt the two coupled border pairs from the two smallest singular
    /// directions of the current characteristic operator.
    fn set_ns_borders_from_operator(&mut self, operator: &DMatrix<f64>) -> Result<()> {
        let n = operator.nrows();
        if n < 2 || operator.ncols() != n {
            bail!("NS characteristic operator must be at least 2 by 2");
        }
        let svd = operator.clone().svd(true, true);
        let u = svd
            .u
            .ok_or_else(|| anyhow!("NS border adaptation did not return left singular vectors"))?;
        let v_t = svd
            .v_t
            .ok_or_else(|| anyhow!("NS border adaptation did not return right singular vectors"))?;

        let right1: DVector<f64> = v_t.row(n - 1).transpose().into();
        let right2: DVector<f64> = v_t.row(n - 2).transpose().into();
        let left1: DVector<f64> = u.column(n - 1).into();
        let left2: DVector<f64> = u.column(n - 2).into();
        self.borders1 = LCBorders::new(right1, left1);
        self.borders2 = LCBorders::new(right2, left2);
        Ok(())
    }

    /// Build the standard periodic BVP Jacobian for multiplier extraction.
    fn build_periodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        self.ensure_phase_reference(aug)?;
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();

        let n_stages = self.ntst * self.ncol;
        let n_eqs = n_stages * self.dim + self.ntst * self.dim + self.dim + 1;
        let n_vars = self.ncoords() + 1;
        let period_col = n_vars - 1;
        let dh_dperiod = 1.0 / self.ntst as f64;

        let mut jac = DMatrix::<f64>::zeros(n_eqs, n_vars);

        // Evaluate stage vector fields and Jacobians. The vector fields provide
        // the derivative with respect to the unknown time-rescaling period.
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let j = self.eval_jac(&z, p1, p2)?;
                let idx = interval * self.ncol + stage;
                let f_start = idx * self.dim;
                self.work_f[f_start..f_start + self.dim].copy_from_slice(&f);
                let start = idx * self.dim * self.dim;
                if start + self.dim * self.dim <= self.work_j.len() {
                    self.work_j[start..start + self.dim * self.dim].copy_from_slice(&j);
                }
            }
        }

        // Collocation equations
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_idx = interval * self.ncol + stage;
                let row = stage_idx * self.dim;

                for d in 0..self.dim {
                    let col = stage_idx * self.dim + d;
                    jac[(row + d, col)] = 1.0;
                }

                let mesh_col = n_stages * self.dim + interval * self.dim;
                for d in 0..self.dim {
                    jac[(row + d, mesh_col + d)] = -1.0;
                }

                for k in 0..self.ncol {
                    let k_idx = interval * self.ncol + k;
                    let k_col = k_idx * self.dim;
                    let jac_start = k_idx * self.dim * self.dim;
                    let a = self.coeffs.a[stage][k];

                    for r in 0..self.dim {
                        for c in 0..self.dim {
                            let jv = self.work_j[jac_start + r * self.dim + c];
                            jac[(row + r, k_col + c)] -= h * a * jv;
                        }
                        jac[(row + r, period_col)] -=
                            dh_dperiod * a * self.work_f[k_idx * self.dim + r];
                    }
                }
            }
        }

        // Continuity equations
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let row = cont_row + interval * self.dim;
            let mesh_col = n_stages * self.dim + interval * self.dim;
            let next_col = n_stages * self.dim + ((interval + 1) % (self.ntst + 1)) * self.dim;

            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
                jac[(row + d, next_col + d)] = 1.0;
            }

            for k_stage in 0..self.ncol {
                let k_idx = interval * self.ncol + k_stage;
                let k_col = k_idx * self.dim;
                let jac_start = k_idx * self.dim * self.dim;
                let b = self.coeffs.b[k_stage];

                for r in 0..self.dim {
                    for c in 0..self.dim {
                        let jv = self.work_j[jac_start + r * self.dim + c];
                        jac[(row + r, k_col + c)] -= h * b * jv;
                    }
                    jac[(row + r, period_col)] -=
                        dh_dperiod * b * self.work_f[k_idx * self.dim + r];
                }
            }
        }

        // Explicit periodic boundary condition mesh_ntst = mesh_0.
        let periodic_row = cont_row + self.ntst * self.dim;
        let mesh0_col = n_stages * self.dim;
        let mesh_end_col = n_stages * self.dim + self.ntst * self.dim;
        for d in 0..self.dim {
            jac[(periodic_row + d, mesh0_col + d)] = -1.0;
            jac[(periodic_row + d, mesh_end_col + d)] = 1.0;
        }

        // Integral phase condition on all Gauss stages.
        let phase_row = periodic_row + self.dim;
        self.phase_gauge
            .write_jacobian_row(&mut jac, phase_row, 0)?;

        Ok(jac)
    }

    /// Remap the stage-first BVP Jacobian with an explicit closing mesh point
    /// to the mesh-first, implicitly periodic layout used by the collocation
    /// Floquet extractor.
    fn remap_jac_for_multiplier_extraction(&self, jac: &DMatrix<f64>) -> DMatrix<f64> {
        let stage_cols = self.ntst * self.ncol * self.dim;
        let explicit_mesh_cols = (self.ntst + 1) * self.dim;
        let current_mesh_start = stage_cols;
        let current_period_col = stage_cols + explicit_mesh_cols;

        let implicit_mesh_cols = self.ntst * self.dim;
        let expected_stage_start = 1 + implicit_mesh_cols;
        let expected_period_col = expected_stage_start + stage_cols;
        let expected_cols = expected_period_col + 1;
        let expected_rows = stage_cols + implicit_mesh_cols + 1;
        let source_phase_row = stage_cols + implicit_mesh_cols + self.dim;
        let expected_phase_row = stage_cols + implicit_mesh_cols;
        let mut remapped = DMatrix::<f64>::zeros(expected_rows, expected_cols);

        for expected_row in 0..expected_rows {
            // Drop the now-redundant explicit periodic-BC rows after folding the
            // closing mesh point into mesh_0.
            let source_row = if expected_row == expected_phase_row {
                source_phase_row
            } else {
                expected_row
            };
            for stage_col in 0..stage_cols {
                remapped[(expected_row, expected_stage_start + stage_col)] =
                    jac[(source_row, stage_col)];
            }
            for interval in 0..self.ntst {
                for component in 0..self.dim {
                    let source_col = current_mesh_start + interval * self.dim + component;
                    let expected_col = 1 + interval * self.dim + component;
                    remapped[(expected_row, expected_col)] += jac[(source_row, source_col)];
                }
            }
            for component in 0..self.dim {
                let source_col = current_mesh_start + self.ntst * self.dim + component;
                let expected_col = 1 + component;
                remapped[(expected_row, expected_col)] += jac[(source_row, source_col)];
            }
            remapped[(expected_row, expected_period_col)] = jac[(source_row, current_period_col)];
        }

        remapped
    }
}

impl<'a> ContinuationProblem for NSCurveProblem<'a> {
    fn dimension(&self) -> usize {
        self.n_eqs()
    }

    fn palc_metric_weights(&self, _aug: &DVector<f64>) -> Result<DVector<f64>> {
        let stage_dim = self.ntst * self.ncol * self.dim;
        explicit_profile_palc_weights(
            self.dimension() + 1,
            self.ntst,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            1 + stage_dim,
            1,
        )
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let k = self.get_k(aug);

        if period <= 0.0 {
            bail!("Period must be positive");
        }
        if !k.is_finite() || !(-1.0..=1.0).contains(&k) {
            bail!("NS rotation parameter k must be finite and lie in [-1, 1]");
        }
        self.ensure_phase_reference(aug)?;

        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();
        let n_stages = self.ntst * self.ncol;

        // Evaluate stage functions
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let start = (interval * self.ncol + stage) * self.dim;
                self.work_f[start..start + self.dim].copy_from_slice(&f);
            }
        }

        // Collocation equations
        for interval in 0..self.ntst {
            let mesh = self.mesh_slice(aug_slice, interval);
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage);
                let row = (interval * self.ncol + stage) * self.dim;

                for d in 0..self.dim {
                    let mut sum = 0.0;
                    for k_stage in 0..self.ncol {
                        let f_idx = (interval * self.ncol + k_stage) * self.dim + d;
                        sum += self.coeffs.a[stage][k_stage] * self.work_f[f_idx];
                    }
                    out[row + d] = z[d] - mesh[d] - h * sum;
                }
            }
        }

        // Continuity equations
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let mesh_i = self.mesh_slice(aug_slice, interval);
            let mesh_next = self.mesh_slice(aug_slice, interval + 1);
            let row = cont_row + interval * self.dim;

            for d in 0..self.dim {
                let mut sum = 0.0;
                for k_stage in 0..self.ncol {
                    let f_idx = (interval * self.ncol + k_stage) * self.dim + d;
                    sum += self.coeffs.b[k_stage] * self.work_f[f_idx];
                }
                out[row + d] = mesh_next[d] - mesh_i[d] - h * sum;
            }
        }

        // Explicit periodic boundary condition.
        let periodic_row = cont_row + self.ntst * self.dim;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mesh_end = self.mesh_slice(aug_slice, self.ntst);
        for d in 0..self.dim {
            out[periodic_row + d] = mesh_end[d] - mesh0[d];
        }

        // Integral phase condition on all Gauss stages.
        let phase_row = periodic_row + self.dim;
        out[phase_row] = self.phase_gauge.residual(self.stage_profile(aug))?;

        // Two NS singularity conditions
        let jac = self.build_periodic_jac(aug)?;
        let ns_operator = self.ns_operator_from_bvp_jac(&jac, k)?;
        let (g1, g2) = self.compute_ns_singularities(&ns_operator)?;
        out[phase_row + 1] = g1;
        out[phase_row + 2] = g2;

        self.cached_jac = Some(jac);
        Ok(())
    }

    fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        // Numerical differentiation
        let n = self.dimension();
        let m = aug.len();
        let eps = 1e-7;

        let mut jac = DMatrix::zeros(n, m);
        let mut res_base = DVector::zeros(n);
        self.residual(aug, &mut res_base)?;

        for j in 0..m {
            let mut aug_p = aug.clone();
            let use_backward_difference = j == self.k_index() && aug[j] + eps > 1.0;
            aug_p[j] += if use_backward_difference { -eps } else { eps };
            let mut res_p = DVector::zeros(n);
            self.residual(&aug_p, &mut res_p)?;

            for i in 0..n {
                jac[(i, j)] = if use_backward_difference {
                    (res_base[i] - res_p[i]) / eps
                } else {
                    (res_p[i] - res_base[i]) / eps
                };
            }
        }

        Ok(jac)
    }

    fn diagnostics(&mut self, aug: &DVector<f64>) -> Result<PointDiagnostics> {
        let k = self.get_k(aug);

        let jac = if let Some(ref j) = self.cached_jac {
            j.clone()
        } else {
            self.build_periodic_jac(aug)?
        };

        let remapped_jac = self.remap_jac_for_multiplier_extraction(&jac);
        let multipliers =
            extract_multipliers_collocation(&remapped_jac, self.dim, self.ntst, self.ncol)?;

        // Codim-2 test functions for NS curve
        // R1, R2, R3, R4: strong resonances at k = 1, -1, -1/2, 0
        // LPNS, CH, PDNS, NSNS
        let mut tests = Codim2TestFunctions::default();
        tests.resonance_1_1 = k - 1.0; // R1: k = cos(0) = 1
        tests.resonance_1_2 = k + 1.0; // R2: k = cos(π) = -1
        tests.resonance_1_3 = k + 0.5; // R3: k = cos(2π/3) = -1/2
        tests.resonance_1_4 = k; // R4: k = cos(π/2) = 0
        tests.fold_ns = 1.0; // LPNS placeholder
        tests.chenciner = 1.0; // CH placeholder
        tests.flip_ns = 1.0; // PDNS placeholder
        tests.double_ns = 1.0; // NSNS placeholder
        self.codim2_tests = tests;

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
            eigenvalues: multipliers,
            cycle_points: None,
        })
    }

    fn is_step_acceptable(&mut self, aug: &DVector<f64>) -> Result<bool> {
        let aug_slice = aug.as_slice();
        let mesh_states = (0..=self.ntst)
            .map(|mesh| self.mesh_slice(aug_slice, mesh).to_vec())
            .collect::<Vec<_>>();
        let stage_states = (0..self.ntst)
            .flat_map(|interval| {
                (0..self.ncol)
                    .map(|stage| self.stage_slice(aug_slice, interval, stage).to_vec())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        collocation_profile_is_acceptable(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug),
            &mesh_states,
            &stage_states,
            self.get_period(aug),
            self.ntst,
            self.ncol,
            &self.coeffs.nodes,
        )
    }

    fn update_after_step(&mut self, aug: &DVector<f64>) -> Result<()> {
        self.set_phase_reference(aug)?;
        let k = self.get_k(aug);
        let jac = self.build_periodic_jac(aug)?;
        let ns_operator = self.ns_operator_from_bvp_jac(&jac, k)?;
        self.set_ns_borders_from_operator(&ns_operator)?;
        self.cached_jac = Some(jac);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::{
        BifurcationType, ContinuationPoint, ContinuationRunner, ContinuationSettings,
    };
    use crate::equation_engine::{Bytecode, OpCode};

    fn linear_growth_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![OpCode::LoadVar(0)],
                },
                Bytecode {
                    ops: vec![OpCode::LoadVar(1)],
                },
            ],
            vec![0.0, 0.0],
        )
    }

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

    fn parameterized_growth_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(1.0),
                        OpCode::LoadParam(1),
                        OpCode::Add,
                        OpCode::LoadVar(0),
                        OpCode::Mul,
                    ],
                },
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(2.0),
                        OpCode::LoadParam(1),
                        OpCode::Add,
                        OpCode::LoadVar(1),
                        OpCode::Mul,
                    ],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    fn nonstationary_stage_first_state(ntst: usize, ncol: usize, dim: usize) -> Vec<f64> {
        let mut state = vec![0.0; ntst * ncol * dim + (ntst + 1) * dim];
        for stage in 0..ntst * ncol {
            state[stage * dim] = 1.0;
        }
        state
    }

    #[test]
    fn doubled_period_ns_operator_detects_a_unit_complex_pair() {
        let theta = 0.7_f64;
        let k = theta.cos();
        let transfer =
            DMatrix::from_row_slice(2, 2, &[theta.cos(), -theta.sin(), theta.sin(), theta.cos()]);

        let at_ns =
            build_ns_boundary_operator(&[transfer.clone()], k).expect("doubled-period NS operator");
        let mut singular_values = at_ns.svd(false, false).singular_values.as_slice().to_vec();
        singular_values.sort_by(f64::total_cmp);
        assert!(singular_values[0] < 1e-12);
        assert!(singular_values[1] < 1e-12);
        assert!(singular_values[2] > 1e-2);

        let away = build_ns_boundary_operator(&[transfer], k + 0.15)
            .expect("off-NS doubled-period operator");
        let mut away_singular_values = away.svd(false, false).singular_values.as_slice().to_vec();
        away_singular_values.sort_by(f64::total_cmp);
        assert!(away_singular_values[0] > 1e-2);
        assert!(away_singular_values[1] > 1e-2);
    }

    #[test]
    fn bordered_ns_functions_vanish_for_the_critical_pair() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");

        let theta = 0.7_f64;
        let k = theta.cos();
        let transfer =
            DMatrix::from_row_slice(2, 2, &[theta.cos(), -theta.sin(), theta.sin(), theta.cos()]);
        let at_ns = build_ns_boundary_operator(&[transfer.clone()], k)
            .expect("critical characteristic operator");
        problem
            .set_ns_borders_from_operator(&at_ns)
            .expect("critical borders");
        let (g1, g2) = problem
            .compute_ns_singularities(&at_ns)
            .expect("critical bordered solve");
        assert!(g1.abs() < 1e-12, "G1={g1}");
        assert!(g2.abs() < 1e-12, "G2={g2}");

        let away = build_ns_boundary_operator(&[transfer], k + 0.15)
            .expect("off-NS characteristic operator");
        let (away_g1, away_g2) = problem
            .compute_ns_singularities(&away)
            .expect("off-NS bordered solve");
        assert!(away_g1.abs() > 1e-3, "off-NS G1={away_g1}");
        assert!(away_g2.abs() > 1e-3, "off-NS G2={away_g2}");
    }

    #[test]
    fn bordered_ns_functions_resolve_two_independent_real_conditions() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");

        let theta = 0.7_f64;
        let k = theta.cos();
        let rotation = |scale: f64| {
            DMatrix::from_row_slice(
                2,
                2,
                &[
                    scale * theta.cos(),
                    -scale * theta.sin(),
                    scale * theta.sin(),
                    scale * theta.cos(),
                ],
            )
        };
        let critical = build_ns_boundary_operator(&[rotation(1.0)], k)
            .expect("critical characteristic operator");
        problem
            .set_ns_borders_from_operator(&critical)
            .expect("critical borders");

        let eps = 1e-5;
        let evaluate = |problem: &NSCurveProblem<'_>, scale: f64, cosine: f64| {
            let operator = build_ns_boundary_operator(&[rotation(scale)], cosine)
                .expect("perturbed characteristic operator");
            problem
                .compute_ns_singularities(&operator)
                .expect("bordered NS values")
        };
        let radial_plus = evaluate(&problem, 1.0 + eps, k);
        let radial_minus = evaluate(&problem, 1.0 - eps, k);
        let angular_plus = evaluate(&problem, 1.0, k + eps);
        let angular_minus = evaluate(&problem, 1.0, k - eps);
        let d_scale = (
            (radial_plus.0 - radial_minus.0) / (2.0 * eps),
            (radial_plus.1 - radial_minus.1) / (2.0 * eps),
        );
        let d_k = (
            (angular_plus.0 - angular_minus.0) / (2.0 * eps),
            (angular_plus.1 - angular_minus.1) / (2.0 * eps),
        );
        let determinant = d_scale.0 * d_k.1 - d_scale.1 * d_k.0;
        assert!(
            determinant.abs() > 1e-3,
            "NS defining functions are not independent: d_scale={d_scale:?}, d_k={d_k:?}"
        );
    }

    #[test]
    fn collocation_rotation_seed_satisfies_both_ns_conditions() {
        let mut system = rotation_system();
        let ntst = 2;
        let ncol = 1;
        let period = 1.0;
        let interval_angle = 2.0 * (period / ntst as f64 / 2.0).atan();
        let k = (ntst as f64 * interval_angle).cos();
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            period,
            0,
            1,
            0.0,
            0.0,
            k,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.aug_dim());
        aug[problem.period_index()] = period;
        aug[problem.k_index()] = k;
        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut residual)
            .expect("NS defining residual");

        assert!(residual.norm() < 1e-10, "residual={residual:?}");
    }

    #[test]
    fn bvp_period_column_matches_finite_difference() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.aug_dim());
        aug[1] = 1.0;
        aug[2] = -2.0;
        aug[3] = 3.0;
        aug[4] = 4.0;
        aug[problem.period_index()] = 1.25;
        aug[problem.k_index()] = 0.5;

        let bvp_jac = problem.build_periodic_jac(&aug).expect("BVP Jacobian");
        let period_col = problem.ncoords();
        assert!(bvp_jac.column(period_col).norm() > 1e-6);

        let eps = 1e-6;
        let mut aug_plus = aug.clone();
        aug_plus[problem.period_index()] += eps;
        let mut residual_plus = DVector::zeros(problem.dimension());
        problem
            .residual(&aug_plus, &mut residual_plus)
            .expect("positive period perturbation");

        let mut aug_minus = aug;
        aug_minus[problem.period_index()] -= eps;
        let mut residual_minus = DVector::zeros(problem.dimension());
        problem
            .residual(&aug_minus, &mut residual_minus)
            .expect("negative period perturbation");

        for row in 0..bvp_jac.nrows() {
            let finite_difference = (residual_plus[row] - residual_minus[row]) / (2.0 * eps);
            assert!(
                (bvp_jac[(row, period_col)] - finite_difference).abs() < 1e-8,
                "period derivative mismatch at row {row}: analytic={}, finite_difference={finite_difference}",
                bvp_jac[(row, period_col)],
            );
        }
    }

    #[test]
    fn ns_phase_gauge_uses_all_stages_and_refreshes_after_acceptance() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let lc_state = nonstationary_stage_first_state(ntst, ncol, dim);
        let mut problem = NSCurveProblem::new(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug.as_mut_slice()[1..1 + lc_state.len()].copy_from_slice(&lc_state);
        aug[problem.period_index()] = 1.0;
        aug[problem.k_index()] = 0.5;

        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(&aug, &mut residual).expect("NS residual");
        let phase_row = ntst * ncol * dim + ntst * dim + dim;
        assert!(residual[phase_row].abs() < 1e-14);

        let derivative_index = problem
            .phase_gauge
            .reference_derivative()
            .expect("NS reference derivative")
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
            .map(|(index, _)| index)
            .expect("nonempty derivative");
        let mut accepted = aug;
        accepted[1 + derivative_index] += 1e-3;
        problem
            .residual(&accepted, &mut residual)
            .expect("shifted NS residual");
        assert!(residual[phase_row].abs() > 1e-6);

        problem
            .update_after_step(&accepted)
            .expect("accepted NS reference update");
        problem
            .residual(&accepted, &mut residual)
            .expect("updated NS residual");
        assert!(residual[phase_row].abs() < 1e-14);
    }

    #[test]
    fn rejects_out_of_range_rotation_parameter() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let result = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            1.01,
            ntst,
            ncol,
        );
        let error = result
            .err()
            .expect("out-of-range NS rotation parameter must be rejected");
        assert!(error.to_string().contains("lie in [-1, 1]"));
    }

    #[test]
    fn seed_layout_is_stage_first_with_an_explicit_closing_mesh() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let lc_state = vec![
            30.0, 31.0, // stage 0
            40.0, 41.0, // stage 1
            10.0, 11.0, // mesh 0
            20.0, 21.0, // mesh 1
            10.0, 11.0, // explicit closing mesh
        ];
        let problem = NSCurveProblem::new(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = vec![0.0];
        aug.extend_from_slice(&lc_state);
        aug.extend_from_slice(&[1.0, 0.0, 0.5]);

        assert_eq!(problem.stage_slice(&aug, 0, 0), &[30.0, 31.0]);
        assert_eq!(problem.stage_slice(&aug, 1, 0), &[40.0, 41.0]);
        assert_eq!(problem.mesh_slice(&aug, 0), &[10.0, 11.0]);
        assert_eq!(problem.mesh_slice(&aug, 1), &[20.0, 21.0]);
        assert_eq!(problem.mesh_slice(&aug, 2), &[10.0, 11.0]);
    }

    #[test]
    fn diagnostics_remap_dim_two_returns_collocation_multipliers() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.aug_dim());
        aug[problem.period_index()] = 1.0;
        aug[problem.k_index()] = 0.5;

        let diagnostics = problem
            .diagnostics(&aug)
            .expect("canonical Floquet extraction");
        assert_eq!(diagnostics.test_values.neimark_sacker, 1.0);
        assert_eq!(diagnostics.eigenvalues.len(), 2);
        for multiplier in diagnostics.eigenvalues {
            assert!(multiplier.im.abs() < 1e-12);
            assert!((multiplier.re - 25.0 / 9.0).abs() < 1e-10);
        }
    }

    #[test]
    fn diagnostics_at_base_point_are_unchanged_by_extended_jacobian_evaluation() {
        // The auxiliary k coordinate is differentiated last and does not enter
        // the periodic BVP Jacobian. This regression protects that cache
        // invariant if the augmented layout or NS operator is changed.
        let mut system = parameterized_growth_system();
        let ntst = 2;
        let ncol = 1;
        let lc_state = nonstationary_stage_first_state(ntst, ncol, 2);
        let mut problem = NSCurveProblem::new(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.2,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.aug_dim());
        aug.as_mut_slice()[1..1 + lc_state.len()].copy_from_slice(&lc_state);
        aug[problem.period_index()] = 1.0;
        aug[problem.param2_idx()] = 0.2;
        aug[problem.k_index()] = 0.5;

        let before = problem
            .diagnostics(&aug)
            .expect("base-point NS diagnostics")
            .eigenvalues;
        problem
            .extended_jacobian(&aug)
            .expect("finite-difference NS Jacobian");
        let after = problem
            .diagnostics(&aug)
            .expect("post-Jacobian NS diagnostics")
            .eigenvalues;

        assert_eq!(before.len(), after.len());
        for expected in before {
            let error = after
                .iter()
                .map(|actual| (*actual - expected).norm())
                .fold(f64::INFINITY, f64::min);
            assert!(
                error < 1.0e-12,
                "NS diagnostics reused a perturbed cached Jacobian: error={error:.3e}"
            );
        }
    }

    #[test]
    fn dim_two_defining_system_is_square_and_runner_initializes() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        assert_eq!(problem.dimension() + 1, problem.aug_dim());

        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[problem.period_index()] = 1.0;
        aug[problem.k_index()] = 0.5;
        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut residual)
            .expect("square NS residual");
        assert_eq!(residual.len(), problem.dimension());

        let initial_point = ContinuationPoint {
            state: aug.as_slice()[1..].to_vec(),
            param_value: aug[0],
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };
        let settings = ContinuationSettings {
            step_size: 1e-3,
            min_step_size: 1e-6,
            max_step_size: 1e-2,
            max_steps: 0,
            corrector_steps: 4,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };
        let runner = ContinuationRunner::new(problem, initial_point, settings, true)
            .expect("NS continuation runner should initialize without a layout panic");
        assert_eq!(runner.branch().points.len(), 1);
    }

    #[test]
    fn rejects_single_interval_layout() {
        let mut system = linear_growth_system();
        let ntst = 1;
        let ncol = 1;
        let result = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        );
        let error = result
            .err()
            .expect("single-interval NS layout must be rejected");
        assert!(error.to_string().contains("at least two mesh intervals"));
    }

    #[test]
    fn palc_metric_normalizes_the_explicit_collocation_profile() {
        let mut system = linear_growth_system();
        let ntst = 3;
        let ncol = 2;
        let dim = 2;
        let problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let aug = DVector::zeros(problem.dimension() + 1);
        let weights = problem.palc_metric_weights(&aug).expect("PALC weights");
        let stage_dim = ntst * ncol * dim;
        let mesh_start = 1 + stage_dim;
        let mut component_weight = 0.0;
        for interval in 0..ntst {
            for stage in 0..ncol {
                component_weight += weights[1 + (interval * ncol + stage) * dim];
            }
        }
        for mesh in 0..=ntst {
            component_weight += weights[mesh_start + mesh * dim];
        }
        assert!((component_weight - 1.0).abs() < 1e-12);
        assert!((weights[mesh_start] - weights[mesh_start + ntst * dim]).abs() < 1e-15);
    }

    #[test]
    fn rejects_an_independently_underresolved_profile() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let mut problem = NSCurveProblem::new(
            &mut system,
            nonstationary_stage_first_state(ntst, ncol, 2),
            1.0,
            0,
            1,
            0.0,
            0.0,
            0.5,
            ntst,
            ncol,
        )
        .expect("NS problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[problem.period_index()] = 1.0;
        aug[problem.k_index()] = 0.5;
        assert!(problem.is_step_acceptable(&aug).expect("resolved profile"));
        let mesh_start = 1 + ntst * ncol * dim;
        aug[mesh_start] = 10.0;
        assert!(!problem
            .is_step_acceptable(&aug)
            .expect("under-resolved profile"));
    }
}
