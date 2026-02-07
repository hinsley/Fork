//! Hopf bifurcation curve continuation.
//!
//! Continues a Hopf bifurcation curve in two-parameter space using a bordered
//! system approach. The defining system is:
//!
//! ```text
//! F(x, α) = 0                    (equilibrium condition)
//! g₁(x, α, κ) = vext₁ = 0        (singularity via bordered system)
//! g₂(x, α, κ) = vext₂ = 0        (second singularity condition)
//! ```
//!
//! where κ = ω² is the squared Hopf frequency, and we use the matrix
//! RED = A·A + κ·I with 2x2 border structure.

use super::Codim2TestFunctions;
use crate::autodiff::Dual;
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

/// Hopf curve borders: 2 border vectors each for left and right.
#[derive(Debug, Clone)]
pub struct HopfBorders {
    /// Right border vectors (n x 2)
    pub v: DMatrix<f64>,
    /// Left border vectors (n x 2)
    pub w: DMatrix<f64>,
    /// Indices for selecting which 2x2 submatrix to use
    pub index1: (usize, usize),
    pub index2: (usize, usize),
}

impl HopfBorders {
    /// Create new Hopf borders from eigenvectors of the critical eigenvalue pair.
    pub fn new(v: DMatrix<f64>, w: DMatrix<f64>) -> Self {
        Self {
            v,
            w,
            index1: (0, 0),
            index2: (1, 1),
        }
    }

    /// Update borders and indices after a continuation step.
    ///
    /// Algorithm (matches reference):
    /// 1. Build bordered matrix [RED, w; v', 0_{2x2}]
    /// 2. Solve Bord * vext = [0; I_2] with 2 RHS columns
    /// 3. Apply QR to vext, take first n rows of Q's first 2 columns
    /// 4. Same for transposed system
    pub fn update(&mut self, jac: &DMatrix<f64>, kappa: f64) -> Result<()> {
        let n = jac.nrows();
        if n == 0 {
            return Ok(());
        }

        let (vext, wext) = match solve_bordered(jac, kappa, self) {
            Ok(val) => val,
            Err(_) => return Ok(()),
        };

        let qr_v = vext.qr();
        let q_v = qr_v.q();
        self.v = q_v.view((0, 0), (n, 2)).into();

        let qr_w = wext.qr();
        let q_w = qr_w.q();
        self.w = q_w.view((0, 0), (n, 2)).into();

        Ok(())
    }
}

fn finite_diff_step(value: f64) -> f64 {
    let scale = value.abs().max(1.0);
    1e-6 * scale
}

fn build_bordered_matrix(jac: &DMatrix<f64>, kappa: f64, borders: &HopfBorders) -> DMatrix<f64> {
    let n = jac.nrows();
    let red = jac * jac + DMatrix::identity(n, n) * kappa;

    let mut bordered = DMatrix::zeros(n + 2, n + 2);
    bordered.view_mut((0, 0), (n, n)).copy_from(&red);
    for i in 0..n {
        bordered[(i, n)] = borders.w[(i, 0)];
        bordered[(i, n + 1)] = borders.w[(i, 1)];
        bordered[(n, i)] = borders.v[(i, 0)];
        bordered[(n + 1, i)] = borders.v[(i, 1)];
    }

    bordered
}

fn solve_bordered(
    jac: &DMatrix<f64>,
    kappa: f64,
    borders: &HopfBorders,
) -> Result<(DMatrix<f64>, DMatrix<f64>)> {
    let n = jac.nrows();
    let bordered = build_bordered_matrix(jac, kappa, borders);

    let mut rhs = DMatrix::zeros(n + 2, 2);
    rhs[(n, 0)] = 1.0;
    rhs[(n + 1, 1)] = 1.0;

    let vext = bordered
        .clone()
        .lu()
        .solve(&rhs)
        .ok_or_else(|| anyhow!("Bordered system singular in Hopf curve"))?;

    let wext = bordered
        .transpose()
        .lu()
        .solve(&rhs)
        .ok_or_else(|| anyhow!("Bordered system singular in Hopf curve"))?;

    Ok((vext, wext))
}

fn g_matrix_from_vext(vext: &DMatrix<f64>, n: usize) -> DMatrix<f64> {
    vext.view((n, 0), (2, 2)).into()
}

fn g_values_from_matrix(
    g: &DMatrix<f64>,
    index1: (usize, usize),
    index2: (usize, usize),
) -> (f64, f64) {
    let idx1 = (index1.0.min(1), index1.1.min(1));
    let idx2 = (index2.0.min(1), index2.1.min(1));
    (g[idx1], g[idx2])
}

fn flatten_g_matrix(g: &DMatrix<f64>) -> [f64; 4] {
    [g[(0, 0)], g[(0, 1)], g[(1, 0)], g[(1, 1)]]
}

fn select_hopf_pair(eigenvalues: &[Complex<f64>]) -> Option<(usize, usize)> {
    if eigenvalues.len() < 2 {
        return None;
    }

    let mut best = None;
    let mut best_sum = f64::MAX;
    let mut best_im = 0.0;

    for i in 0..eigenvalues.len() {
        for j in (i + 1)..eigenvalues.len() {
            let sum = eigenvalues[i] + eigenvalues[j];
            let score = sum.norm();
            let im_score = eigenvalues[i].im.abs().max(eigenvalues[j].im.abs());
            if score < best_sum - 1e-12 || ((score - best_sum).abs() < 1e-12 && im_score > best_im)
            {
                best_sum = score;
                best_im = im_score;
                best = Some((i, j));
            }
        }
    }

    best
}

pub fn estimate_hopf_kappa_from_jacobian(jac: &DMatrix<f64>) -> Option<f64> {
    let eigenvalues = jac.clone().complex_eigenvalues();
    let eigen_slice = eigenvalues.as_slice();
    let (i, j) = select_hopf_pair(eigen_slice)?;
    let kappa = (eigen_slice[i] * eigen_slice[j]).re;
    if kappa.is_finite() {
        Some(kappa)
    } else {
        None
    }
}

fn select_hopf_indices_from_jres(jres: &DMatrix<f64>) -> Option<((usize, usize), (usize, usize))> {
    if jres.ncols() < 2 {
        return None;
    }

    let mut best_first = None;
    let mut best_first_norm = -1.0_f64;
    for col in 0..jres.ncols() {
        let norm = jres.column(col).norm();
        if norm.is_finite() && norm > best_first_norm {
            best_first_norm = norm;
            best_first = Some(col);
        }
    }

    let first = best_first?;
    let first_col = jres.column(first).clone_owned();
    let first_norm_sq = first_col.dot(&first_col);

    let mut best_second = None;
    let mut best_second_norm = -1.0_f64;
    for col in 0..jres.ncols() {
        if col == first {
            continue;
        }
        let col_vec = jres.column(col).clone_owned();
        let residual = if first_norm_sq > 0.0 {
            let proj = col_vec.dot(&first_col) / first_norm_sq;
            col_vec - first_col.clone() * proj
        } else {
            col_vec
        };
        let norm = residual.norm();
        if norm.is_finite() && norm > best_second_norm {
            best_second_norm = norm;
            best_second = Some(col);
        }
    }

    let second = best_second?;
    let mapping = [(0, 0), (0, 1), (1, 0), (1, 1)];
    let idx1 = mapping.get(first).copied()?;
    let idx2 = mapping.get(second).copied()?;
    Some((idx1, idx2))
}

/// Continuation problem for Hopf bifurcation curves.
pub struct HopfCurveProblem<'a> {
    system: &'a mut EquationSystem,
    kind: SystemKind,
    /// First active parameter index
    param1_index: usize,
    /// Second active parameter index
    param2_index: usize,
    /// Border vectors for regularity
    borders: HopfBorders,
    /// Cached Jacobian
    cached_jacobian: Option<DMatrix<f64>>,
    /// Last computed codim-2 test functions
    pub codim2_tests: Codim2TestFunctions,
}

impl<'a> HopfCurveProblem<'a> {
    /// Create a new Hopf curve problem from a known Hopf point.
    ///
    /// # Arguments
    /// * `system` - The dynamical system
    /// * `kind` - Flow or Map
    /// * `hopf_state` - State at the Hopf point
    /// * `hopf_omega` - Hopf frequency ω (imaginary part of critical eigenvalue)
    /// * `param1_index` - First parameter to vary
    /// * `param2_index` - Second parameter to vary
    pub fn new(
        system: &'a mut EquationSystem,
        kind: SystemKind,
        hopf_state: &[f64],
        hopf_omega: f64,
        param1_index: usize,
        param2_index: usize,
    ) -> Result<Self> {
        let n = system.equations.len();
        if hopf_state.len() != n {
            bail!("Hopf state dimension mismatch");
        }

        // Compute Jacobian at Hopf point
        let jac = compute_jacobian(system, kind, hopf_state)?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);

        let kappa_seed =
            estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(hopf_omega * hopf_omega);
        let kappa = if kappa_seed.is_finite() && kappa_seed > 0.0 {
            kappa_seed
        } else {
            hopf_omega * hopf_omega
        };

        // Initialize borders from the nullspace of A^2 + κI
        let (v, w) = initialize_hopf_borders(&jac_mat, kappa)?;
        let borders = HopfBorders::new(v, w);

        let mut problem = Self {
            system,
            kind,
            param1_index,
            param2_index,
            borders,
            cached_jacobian: Some(jac_mat.clone()),
            codim2_tests: Codim2TestFunctions::default(),
        };

        let p1 = problem.system.params[param1_index];
        let p2 = problem.system.params[param2_index];
        if let Err(_) = problem.update_indices(hopf_state, p1, p2, kappa, &jac_mat) {
            // Keep default indices when selection fails.
        }

        Ok(problem)
    }

    /// Number of phase variables.
    fn nphase(&self) -> usize {
        self.system.equations.len()
    }

    /// Set parameters temporarily and execute a function.
    fn with_params<F, R>(&mut self, p1: f64, p2: f64, f: F) -> Result<R>
    where
        F: FnOnce(&mut EquationSystem) -> Result<R>,
    {
        let old1 = self.system.params[self.param1_index];
        let old2 = self.system.params[self.param2_index];
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;
        let result = f(self.system);
        self.system.params[self.param1_index] = old1;
        self.system.params[self.param2_index] = old2;
        result
    }

    fn compute_g_matrix(&self, jac: &DMatrix<f64>, kappa: f64) -> Result<DMatrix<f64>> {
        let n = self.nphase();
        let (vext, _) = solve_bordered(jac, kappa, &self.borders)?;
        Ok(g_matrix_from_vext(&vext, n))
    }

    fn compute_g_derivatives(
        &mut self,
        state: &[f64],
        p1: f64,
        p2: f64,
        kappa: f64,
        jac: &DMatrix<f64>,
    ) -> Result<DMatrix<f64>> {
        let n = self.nphase();
        let kind = self.kind;
        let g0 = self.compute_g_matrix(jac, kappa)?;
        let g0_flat = flatten_g_matrix(&g0);

        let mut g_deriv = DMatrix::zeros(4, n + 3);

        // Derivatives w.r.t. state variables
        for i in 0..n {
            let step = finite_diff_step(state[i]);
            let mut state_pert = state.to_vec();
            state_pert[i] += step;
            let jac_pert = self.with_params(p1, p2, |system| {
                let j = compute_jacobian(system, kind, &state_pert)?;
                Ok(DMatrix::from_row_slice(n, n, &j))
            })?;
            let g_pert = self.compute_g_matrix(&jac_pert, kappa)?;
            let g_pert_flat = flatten_g_matrix(&g_pert);
            for row in 0..4 {
                g_deriv[(row, i)] = (g_pert_flat[row] - g0_flat[row]) / step;
            }
        }

        // Derivatives w.r.t. parameters
        let step_p1 = finite_diff_step(p1);
        let jac_p1 = self.with_params(p1 + step_p1, p2, |system| {
            let j = compute_jacobian(system, kind, state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p1 = self.compute_g_matrix(&jac_p1, kappa)?;
        let g_p1_flat = flatten_g_matrix(&g_p1);
        for row in 0..4 {
            g_deriv[(row, n)] = (g_p1_flat[row] - g0_flat[row]) / step_p1;
        }

        let step_p2 = finite_diff_step(p2);
        let jac_p2 = self.with_params(p1, p2 + step_p2, |system| {
            let j = compute_jacobian(system, kind, state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p2 = self.compute_g_matrix(&jac_p2, kappa)?;
        let g_p2_flat = flatten_g_matrix(&g_p2);
        for row in 0..4 {
            g_deriv[(row, n + 1)] = (g_p2_flat[row] - g0_flat[row]) / step_p2;
        }

        // Derivative w.r.t. kappa
        let step_k = finite_diff_step(kappa);
        let g_k = self.compute_g_matrix(jac, kappa + step_k)?;
        let g_k_flat = flatten_g_matrix(&g_k);
        for row in 0..4 {
            g_deriv[(row, n + 2)] = (g_k_flat[row] - g0_flat[row]) / step_k;
        }

        Ok(g_deriv)
    }

    fn update_indices(
        &mut self,
        state: &[f64],
        p1: f64,
        p2: f64,
        kappa: f64,
        jac: &DMatrix<f64>,
    ) -> Result<()> {
        let n = self.nphase();

        // Build A = [J, dF/dp1, dF/dp2, 0]
        let mut a = DMatrix::zeros(n, n + 3);
        for row in 0..n {
            for col in 0..n {
                a[(row, col)] = jac[(row, col)];
            }
        }

        let mut f_dual = vec![Dual::new(0.0, 0.0); n];
        let param1_index = self.param1_index;
        self.with_params(p1, p2, |system| {
            system.evaluate_dual_wrt_param(state, param1_index, &mut f_dual);
            Ok(())
        })?;
        for row in 0..n {
            a[(row, n)] = f_dual[row].eps;
        }

        let param2_index = self.param2_index;
        self.with_params(p1, p2, |system| {
            system.evaluate_dual_wrt_param(state, param2_index, &mut f_dual);
            Ok(())
        })?;
        for row in 0..n {
            a[(row, n + 1)] = f_dual[row].eps;
        }

        // Column n + 2 (kappa) stays zero for F.
        let g_deriv = match self.compute_g_derivatives(state, p1, p2, kappa, jac) {
            Ok(val) => val,
            Err(_) => return Ok(()),
        };

        let q = a.transpose().qr().q();
        if q.ncols() < n + 3 {
            return Ok(());
        }
        let null_basis = q.columns(n, 3).into_owned();
        let g_proj = g_deriv * null_basis;
        let jres = g_proj.transpose();
        if !jres.iter().all(|v| v.is_finite()) {
            return Ok(());
        }
        if let Some((idx1, idx2)) = select_hopf_indices_from_jres(&jres) {
            self.borders.index1 = idx1;
            self.borders.index2 = idx2;
        }

        Ok(())
    }
    /// Evaluate the Hopf singularity functions (g1, g2) using bordered system.
    fn eval_singularity(&mut self, jac: &DMatrix<f64>, kappa: f64) -> Result<(f64, f64)> {
        let n = self.nphase();
        let (vext, _) = solve_bordered(jac, kappa, &self.borders)?;
        let g = g_matrix_from_vext(&vext, n);
        Ok(g_values_from_matrix(
            &g,
            self.borders.index1,
            self.borders.index2,
        ))
    }

    /// Compute codim-2 test functions for the Hopf curve.
    fn compute_codim2_tests(
        &mut self,
        jac: &DMatrix<f64>,
        kappa: f64,
    ) -> Result<Codim2TestFunctions> {
        let mut tests = Codim2TestFunctions::default();

        // BT test: κ → 0 (Hopf frequency collapses)
        tests.bogdanov_takens = kappa;

        // ZH test: det(A) → 0 (zero eigenvalue appears)
        tests.zero_hopf = jac.determinant();

        // HH test: bialternate product for second pair of pure imaginary eigenvalues
        // This requires computing det(A^{[2]} - λI) at λ = -kappa
        let n = jac.nrows();
        if n >= 4 {
            let bialt_n = n * (n - 1) / 2;
            let bialt = compute_bialternate_matrix(jac);
            let bialt_shifted = bialt - DMatrix::identity(bialt_n, bialt_n) * (-kappa);
            tests.double_hopf = bialt_shifted.determinant();
        }

        // GH test: first Lyapunov coefficient
        // This requires computing normal form coefficients - simplified here
        tests.generalized_hopf = 1.0; // Placeholder

        Ok(tests)
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }
}

impl<'a> ContinuationProblem for HopfCurveProblem<'a> {
    fn dimension(&self) -> usize {
        // n state variables + 2 parameters + 1 auxiliary (κ) = n+3 unknowns
        // n equations + 2 singularity conditions = n+2 equations
        self.nphase() + 2
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let n = self.nphase();
        if aug_state.len() != n + 3 {
            bail!("Augmented state has wrong dimension for Hopf curve");
        }
        if out.len() != n + 2 {
            bail!("Output buffer has incorrect dimension");
        }

        // Unpack: [p1, p2, x1, ..., xn, κ]
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();
        let kappa = aug_state[n + 2];

        // Evaluate residual of equilibrium equations
        let kind = self.kind;
        let mut f_out = vec![0.0; n];
        self.with_params(p1, p2, |system| {
            match kind {
                SystemKind::Flow => system.apply(0.0, &state, &mut f_out),
                SystemKind::Map { .. } => {
                    system.apply(0.0, &state, &mut f_out);
                    for i in 0..n {
                        f_out[i] -= state[i];
                    }
                }
            }
            Ok(())
        })?;

        // Copy equilibrium residual
        for i in 0..n {
            out[i] = f_out[i];
        }

        // Compute Jacobian and singularity functions
        let jac = self.with_params(p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;

        let (g1, g2) = self.eval_singularity(&jac, kappa)?;
        out[n] = g1;
        out[n + 1] = g2;

        self.cached_jacobian = Some(jac);
        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let n = self.nphase();
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();
        let kappa = aug_state[n + 2];

        let kind = self.kind;
        let param1_idx = self.param1_index;
        let param2_idx = self.param2_index;

        // Extended Jacobian is (n+2) x (n+3): derivatives w.r.t. [p1, p2, x1..xn, κ]
        let mut jext = DMatrix::zeros(n + 2, n + 3);

        // dF/dp1
        let mut f_dual = vec![Dual::new(0.0, 0.0); n];
        self.with_params(p1, p2, |system| {
            system.evaluate_dual_wrt_param(&state, param1_idx, &mut f_dual);
            Ok(())
        })?;
        for i in 0..n {
            jext[(i, 0)] = f_dual[i].eps;
        }

        // dF/dp2
        self.with_params(p1, p2, |system| {
            system.evaluate_dual_wrt_param(&state, param2_idx, &mut f_dual);
            Ok(())
        })?;
        for i in 0..n {
            jext[(i, 1)] = f_dual[i].eps;
        }

        // dF/dx (state Jacobian)
        let jac = self.with_params(p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        for row in 0..n {
            for col in 0..n {
                jext[(row, col + 2)] = jac[(row, col)];
            }
        }

        // dF/dκ = 0 (equilibrium doesn't depend on κ)
        // Already zero

        // Derivatives of singularity functions (g1, g2)
        let g0 = self.compute_g_matrix(&jac, kappa)?;
        let (g1_0, g2_0) = g_values_from_matrix(&g0, self.borders.index1, self.borders.index2);

        // dg/dp1
        let step_p1 = finite_diff_step(p1);
        let jac_p1 = self.with_params(p1 + step_p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p1 = self.compute_g_matrix(&jac_p1, kappa)?;
        let (g1_p1, g2_p1) = g_values_from_matrix(&g_p1, self.borders.index1, self.borders.index2);
        jext[(n, 0)] = (g1_p1 - g1_0) / step_p1;
        jext[(n + 1, 0)] = (g2_p1 - g2_0) / step_p1;

        // dg/dp2
        let step_p2 = finite_diff_step(p2);
        let jac_p2 = self.with_params(p1, p2 + step_p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p2 = self.compute_g_matrix(&jac_p2, kappa)?;
        let (g1_p2, g2_p2) = g_values_from_matrix(&g_p2, self.borders.index1, self.borders.index2);
        jext[(n, 1)] = (g1_p2 - g1_0) / step_p2;
        jext[(n + 1, 1)] = (g2_p2 - g2_0) / step_p2;

        // dg/dx_i
        for i in 0..n {
            let step = finite_diff_step(state[i]);
            let mut state_pert = state.clone();
            state_pert[i] += step;
            let jac_xi = self.with_params(p1, p2, |system| {
                let j = compute_jacobian(system, kind, &state_pert)?;
                Ok(DMatrix::from_row_slice(n, n, &j))
            })?;
            let g_xi = self.compute_g_matrix(&jac_xi, kappa)?;
            let (g1_xi, g2_xi) =
                g_values_from_matrix(&g_xi, self.borders.index1, self.borders.index2);
            jext[(n, i + 2)] = (g1_xi - g1_0) / step;
            jext[(n + 1, i + 2)] = (g2_xi - g2_0) / step;
        }

        // dg/dκ
        let step_k = finite_diff_step(kappa);
        let g_k = self.compute_g_matrix(&jac, kappa + step_k)?;
        let (g1_k, g2_k) = g_values_from_matrix(&g_k, self.borders.index1, self.borders.index2);
        jext[(n, n + 2)] = (g1_k - g1_0) / step_k;
        jext[(n + 1, n + 2)] = (g2_k - g2_0) / step_k;

        self.cached_jacobian = Some(jac);
        Ok(jext)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let n = self.nphase();
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();
        let kappa = aug_state[n + 2];

        let kind = self.kind;
        let jac = self.with_params(p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;

        // Compute eigenvalues
        let eigenvalues: Vec<Complex<f64>> =
            jac.clone().complex_eigenvalues().iter().cloned().collect();

        // Compute codim-2 test functions
        self.codim2_tests = self.compute_codim2_tests(&jac, kappa)?;

        // Standard test functions
        let hopf = kappa; // Should be O(ω²)

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, hopf, 1.0),
            eigenvalues,
            cycle_points: None,
        })
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        let n = self.nphase();
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();
        let kappa = aug_state[n + 2];
        let kind = self.kind;

        let jac = match self.cached_jacobian.clone() {
            Some(cached) => cached,
            None => self.with_params(p1, p2, |system| {
                let j = compute_jacobian(system, kind, &state)?;
                Ok(DMatrix::from_row_slice(n, n, &j))
            })?,
        };

        self.borders.update(&jac, kappa)?;
        let _ = self.update_indices(&state, p1, p2, kappa, &jac);
        Ok(())
    }
}

/// Initialize Hopf curve borders from eigenvectors of critical eigenvalue pair.
fn initialize_hopf_borders(jac: &DMatrix<f64>, kappa: f64) -> Result<(DMatrix<f64>, DMatrix<f64>)> {
    let n = jac.nrows();
    if n < 2 {
        bail!("Hopf requires at least 2D system");
    }

    // Use RED = A*A + κ*I which should be nearly singular at Hopf
    let red = jac * jac + DMatrix::identity(n, n) * kappa;
    let svd = red.svd(true, true);

    let mut v = DMatrix::zeros(n, 2);
    let mut w = DMatrix::zeros(n, 2);

    if let (Some(u), Some(vt)) = (svd.u, svd.v_t) {
        // Take the two singular vectors corresponding to smallest singular values
        v.set_column(0, &vt.row(n - 1).transpose());
        v.set_column(1, &vt.row(n - 2).transpose());
        w.set_column(0, &u.column(n - 1));
        w.set_column(1, &u.column(n - 2));

        // Orthonormalize with QR
        let qr_v = v.clone().qr();
        v = qr_v.q();
        let qr_w = w.clone().qr();
        w = qr_w.q();
    } else {
        // Fallback
        v[(0, 0)] = 1.0;
        v[(1, 1)] = 1.0;
        w[(0, 0)] = 1.0;
        w[(1, 1)] = 1.0;
    }

    Ok((v, w))
}

/// Compute the bialternate product matrix A^{[2]}.
fn compute_bialternate_matrix(jac: &DMatrix<f64>) -> DMatrix<f64> {
    let n = jac.nrows();
    if n < 2 {
        return DMatrix::zeros(0, 0);
    }

    let m = n * (n - 1) / 2;
    let mut bialt = DMatrix::zeros(m, m);

    let mut row = 0;
    for i in 0..n {
        for j in (i + 1)..n {
            let mut col = 0;
            for k in 0..n {
                for l in (k + 1)..n {
                    let d_jl = if j == l { 1.0 } else { 0.0 };
                    let d_jk = if j == k { 1.0 } else { 0.0 };
                    let d_il = if i == l { 1.0 } else { 0.0 };
                    let d_ik = if i == k { 1.0 } else { 0.0 };

                    bialt[(row, col)] = jac[(i, k)] * d_jl - jac[(i, l)] * d_jk
                        + jac[(j, l)] * d_ik
                        - jac[(j, k)] * d_il;
                    col += 1;
                }
            }
            row += 1;
        }
    }

    bialt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::{
        continue_parameter, continue_with_problem, BifurcationType, ContinuationPoint,
        ContinuationSettings,
    };
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use crate::equilibrium::{compute_jacobian, SystemKind};
    use nalgebra::DMatrix;

    fn extract_hopf_omega(point: &ContinuationPoint) -> f64 {
        if point.eigenvalues.is_empty() {
            return 1.0;
        }

        let mut max_abs_im: f64 = 0.0;
        for eig in &point.eigenvalues {
            if !eig.re.is_finite() || !eig.im.is_finite() {
                continue;
            }
            max_abs_im = max_abs_im.max(eig.im.abs());
        }
        if max_abs_im <= 0.0 {
            return 1.0;
        }

        let min_imag = max_abs_im * 1e-3;
        let mut best_re: f64 = f64::INFINITY;
        let mut best_im: f64 = 0.0;
        for eig in &point.eigenvalues {
            if !eig.re.is_finite() || !eig.im.is_finite() {
                continue;
            }
            let abs_im = eig.im.abs();
            if abs_im < min_imag {
                continue;
            }
            let abs_re = eig.re.abs();
            if abs_re < best_re || (abs_re == best_re && abs_im > best_im.abs()) {
                best_re = abs_re;
                best_im = eig.im;
            }
        }

        if best_im == 0.0 {
            best_im = max_abs_im;
        }

        best_im.abs()
    }

    #[test]
    fn test_hopf_curve_dimension() {
        // 2D Hopf normal form: dx/dt = μx - y, dy/dt = x + μy
        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0));
        ops0.push(OpCode::LoadVar(0));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::LoadVar(1));
        ops0.push(OpCode::Sub);

        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadVar(0));
        ops1.push(OpCode::LoadParam(0));
        ops1.push(OpCode::LoadVar(1));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::Add);

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let params = vec![0.0, 0.0]; // [μ, ν]
        let mut system = EquationSystem::new(equations, params);

        let problem = HopfCurveProblem::new(
            &mut system,
            SystemKind::Flow,
            &[0.0, 0.0],
            1.0, // ω = 1 at μ = 0
            0,
            1,
        );

        assert!(problem.is_ok());
        let problem = problem.unwrap();
        // n=2 state + 2 singularity = 4 equations
        assert_eq!(problem.dimension(), 4);
    }

    #[test]
    fn test_estimate_hopf_kappa_from_jacobian() {
        let jac = DMatrix::from_row_slice(2, 2, &[0.0, -2.0, 2.0, 0.0]);
        let kappa = estimate_hopf_kappa_from_jacobian(&jac).expect("kappa estimate");
        assert!(
            (kappa - 4.0).abs() < 1e-8,
            "expected kappa ~4, got {}",
            kappa
        );
    }

    #[test]
    fn test_select_hopf_indices_from_jres() {
        let jres = DMatrix::from_row_slice(
            3,
            4,
            &[2.0, 0.1, 0.0, 0.0, 0.0, 0.0, 1.0, 0.05, 0.0, 0.0, 0.0, 0.0],
        );
        let (idx1, idx2) = select_hopf_indices_from_jres(&jres).expect("index selection");
        assert_eq!(idx1, (0, 0));
        assert_eq!(idx2, (1, 0));
    }

    #[test]
    fn test_detect_hopf_then_continue_curve() {
        // Two-parameter Hopf normal form with mu = p1 + p2.
        // Hopf curve is p1 + p2 = 0.
        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0));
        ops0.push(OpCode::LoadParam(1));
        ops0.push(OpCode::Add);
        ops0.push(OpCode::LoadVar(0));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::LoadVar(1));
        ops0.push(OpCode::Sub);

        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadVar(0));
        ops1.push(OpCode::LoadParam(0));
        ops1.push(OpCode::LoadParam(1));
        ops1.push(OpCode::Add);
        ops1.push(OpCode::LoadVar(1));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::Add);

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let p2_value = 0.25;
        let params = vec![-0.5, p2_value]; // p1 start, p2 fixed
        let mut system = EquationSystem::new(equations, params);

        let settings = ContinuationSettings {
            step_size: 0.05,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 40,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &[0.0, 0.0],
            0,
            settings,
            true,
        )
        .expect("Equilibrium continuation should succeed");

        let hopf_point = branch
            .points
            .iter()
            .find(|pt| pt.stability == BifurcationType::Hopf)
            .cloned()
            .expect("Should detect a Hopf point");

        assert!(
            (hopf_point.param_value + p2_value).abs() < 0.1,
            "Hopf should be near p1 = -p2"
        );

        let hopf_omega = extract_hopf_omega(&hopf_point);

        system.params[0] = hopf_point.param_value;
        system.params[1] = p2_value;

        let jac = compute_jacobian(&mut system, SystemKind::Flow, &hopf_point.state)
            .expect("Jacobian should compute");
        let n = hopf_point.state.len();
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);
        let kappa_seed =
            estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(hopf_omega * hopf_omega);
        let kappa = if kappa_seed.is_finite() && kappa_seed > 0.0 {
            kappa_seed
        } else {
            hopf_omega * hopf_omega
        };

        let mut problem = HopfCurveProblem::new(
            &mut system,
            SystemKind::Flow,
            &hopf_point.state,
            hopf_omega,
            0,
            1,
        )
        .expect("Hopf curve problem should initialize");

        let mut augmented_state = Vec::with_capacity(hopf_point.state.len() + 2);
        augmented_state.push(p2_value);
        augmented_state.extend_from_slice(&hopf_point.state);
        augmented_state.push(kappa);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: hopf_point.param_value,
            stability: BifurcationType::Hopf,
            eigenvalues: hopf_point.eigenvalues.clone(),
            cycle_points: None,
        };

        let curve_settings = ContinuationSettings {
            step_size: 0.02,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 20,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let curve = continue_with_problem(&mut problem, initial_point, curve_settings, true)
            .expect("Hopf curve continuation should succeed");

        assert!(
            curve.points.len() > 1,
            "Hopf curve continuation should generate multiple points"
        );

        let first = &curve.points[0];
        let last = curve.points.last().expect("Hopf curve has points");
        let p1_delta = (last.param_value - first.param_value).abs();
        let p2_delta = (last.state[0] - first.state[0]).abs();
        assert!(
            p1_delta > 1e-6 || p2_delta > 1e-6,
            "Hopf curve continuation did not advance in parameter space"
        );
    }
}
