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

use super::{Codim2TestFunctions};
use crate::autodiff::Dual;
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
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

        // Compute RED = A*A + κ*I
        let red = jac * jac + DMatrix::identity(n, n) * kappa;

        // Build bordered matrix [RED, w; v', 0_{2x2}]
        let mut bordered = DMatrix::zeros(n + 2, n + 2);
        bordered.view_mut((0, 0), (n, n)).copy_from(&red);
        for i in 0..n {
            bordered[(i, n)] = self.w[(i, 0)];
            bordered[(i, n + 1)] = self.w[(i, 1)];
            bordered[(n, i)] = self.v[(i, 0)];
            bordered[(n + 1, i)] = self.v[(i, 1)];
        }

        // RHS = [zeros(n,2); eye(2)]
        let mut rhs = DMatrix::zeros(n + 2, 2);
        rhs[(n, 0)] = 1.0;
        rhs[(n + 1, 1)] = 1.0;

        // Solve Bord * vext = rhs
        let lu = bordered.clone().lu();
        if let Some(vext) = lu.solve(&rhs) {
            // Apply QR to vext, extract orthonormal basis
            let qr = vext.qr();
            let q = qr.q();
            // Take first n rows of first 2 columns
            self.v = q.view((0, 0), (n, 2)).into();
        }

        // Solve Bord' * wext = rhs
        let lu_t = bordered.transpose().lu();
        if let Some(wext) = lu_t.solve(&rhs) {
            // Apply QR to wext, extract orthonormal basis
            let qr = wext.qr();
            let q = qr.q();
            // Take first n rows of first 2 columns
            self.w = q.view((0, 0), (n, 2)).into();
        }

        Ok(())
    }
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

        // Initialize κ = ω²
        let kappa = hopf_omega * hopf_omega;

        // Initialize borders from eigenvectors of critical eigenvalue pair
        let (v, w, idx1, idx2) = initialize_hopf_borders(&jac_mat, kappa)?;
        let mut borders = HopfBorders::new(v, w);
        borders.index1 = idx1;
        borders.index2 = idx2;

        Ok(Self {
            system,
            kind,
            param1_index,
            param2_index,
            borders,
            cached_jacobian: None,
            codim2_tests: Codim2TestFunctions::default(),
        })
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

    /// Evaluate the Hopf singularity functions (g1, g2) using bordered system.
    fn eval_singularity(&mut self, jac: &DMatrix<f64>, kappa: f64) -> Result<(f64, f64)> {
        let n = self.nphase();

        // Compute RED = A*A + κ*I
        let red = jac * jac + DMatrix::identity(n, n) * kappa;

        // Build bordered matrix [RED, w; v', 0₂ₓ₂]
        let mut bordered = DMatrix::zeros(n + 2, n + 2);
        bordered.view_mut((0, 0), (n, n)).copy_from(&red);
        for i in 0..n {
            bordered[(i, n)] = self.borders.w[(i, 0)];
            bordered[(i, n + 1)] = self.borders.w[(i, 1)];
            bordered[(n, i)] = self.borders.v[(i, 0)];
            bordered[(n + 1, i)] = self.borders.v[(i, 1)];
        }

        // Solve for vext where bordered * vext = [0..0, I₂]
        let mut rhs = DMatrix::zeros(n + 2, 2);
        rhs[(n, 0)] = 1.0;
        rhs[(n + 1, 1)] = 1.0;

        let lu = bordered.lu();
        if let Some(solution) = lu.solve(&rhs) {
            // Extract g values from the selected indices in the 2x2 lower-right block
            // index1/index2 are 0-based indices into the 2x2 block, so row = n + index.0
            let g1 = solution[(n + self.borders.index1.0, self.borders.index1.1)];
            let g2 = solution[(n + self.borders.index2.0, self.borders.index2.1)];
            Ok((g1, g2))
        } else {
            bail!("Bordered system singular in Hopf curve")
        }
    }

    /// Compute codim-2 test functions for the Hopf curve.
    fn compute_codim2_tests(&mut self, jac: &DMatrix<f64>, kappa: f64) -> Result<Codim2TestFunctions> {
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
                SystemKind::Map => {
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
        // Use numerical differentiation
        let eps = 1e-7;
        let (g1_0, g2_0) = self.eval_singularity(&jac, kappa)?;

        // dg/dp1
        let jac_p1 = self.with_params(p1 + eps, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let (g1_p1, g2_p1) = self.eval_singularity(&jac_p1, kappa)?;
        jext[(n, 0)] = (g1_p1 - g1_0) / eps;
        jext[(n + 1, 0)] = (g2_p1 - g2_0) / eps;

        // dg/dp2
        let jac_p2 = self.with_params(p1, p2 + eps, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let (g1_p2, g2_p2) = self.eval_singularity(&jac_p2, kappa)?;
        jext[(n, 1)] = (g1_p2 - g1_0) / eps;
        jext[(n + 1, 1)] = (g2_p2 - g2_0) / eps;

        // dg/dx_i
        for i in 0..n {
            let mut state_pert = state.clone();
            state_pert[i] += eps;
            let jac_xi = self.with_params(p1, p2, |system| {
                let j = compute_jacobian(system, kind, &state_pert)?;
                Ok(DMatrix::from_row_slice(n, n, &j))
            })?;
            let (g1_xi, g2_xi) = self.eval_singularity(&jac_xi, kappa)?;
            jext[(n, i + 2)] = (g1_xi - g1_0) / eps;
            jext[(n + 1, i + 2)] = (g2_xi - g2_0) / eps;
        }

        // dg/dκ
        let (g1_k, g2_k) = self.eval_singularity(&jac, kappa + eps)?;
        jext[(n, n + 2)] = (g1_k - g1_0) / eps;
        jext[(n + 1, n + 2)] = (g2_k - g2_0) / eps;

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
        let eigenvalues: Vec<Complex<f64>> = jac.clone().complex_eigenvalues().iter().cloned().collect();

        // Compute codim-2 test functions
        self.codim2_tests = self.compute_codim2_tests(&jac, kappa)?;

        // Standard test functions
        let hopf = kappa; // Should be O(ω²)

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, hopf, 1.0),
            eigenvalues,
        })
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        let n = self.nphase();
        let kappa = aug_state[n + 2];
        if let Some(ref jac) = self.cached_jacobian {
            self.borders.update(jac, kappa)?;
        }
        Ok(())
    }
}

/// Initialize Hopf curve borders from eigenvectors of critical eigenvalue pair.
fn initialize_hopf_borders(
    jac: &DMatrix<f64>,
    kappa: f64,
) -> Result<(DMatrix<f64>, DMatrix<f64>, (usize, usize), (usize, usize))> {
    let n = jac.nrows();
    if n < 2 {
        bail!("Hopf requires at least 2D system");
    }

    // Find the pair of complex eigenvalues closest to pure imaginary ±iω
    let eigenvalues = jac.clone().complex_eigenvalues();
    let target_omega = kappa.sqrt();

    let mut _best_idx1 = 0;
    let mut _best_idx2 = 1;
    let mut best_diff = f64::MAX;

    for i in 0..n {
        for j in (i + 1)..n {
            // Check if this pair sums to ~0 (conjugate pair)
            let sum_re = (eigenvalues[i].re + eigenvalues[j].re).abs();
            let diff_im = (eigenvalues[i].im.abs() - target_omega).abs();
            let score = sum_re + diff_im;
            if score < best_diff {
                best_diff = score;
                _best_idx1 = i;
                _best_idx2 = j;
            }
        }
    }

    // Compute eigenvectors for the critical pair
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

    // Default indices - 0-based into the 2x2 lower-right block
    // Row indices are 0 or 1 (offset by n when accessing solution)
    // Column indices are 0 or 1 (columns of the 2-column rhs/solution)
    let idx1 = (0, 0);  // First diagonal element
    let idx2 = (1, 1);  // Second diagonal element

    Ok((v, w, idx1, idx2))
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
                                      + jac[(j, l)] * d_ik - jac[(j, k)] * d_il;
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
    use crate::equation_engine::{Bytecode, OpCode};

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
}
