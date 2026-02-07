//! Fold (saddle-node) bifurcation curve continuation.
//!
//! Continues a fold bifurcation curve in two-parameter space using a bordered
//! system approach. The defining system is:
//!
//! ```text
//! F(x, α) = 0                    (equilibrium condition)
//! g(x, α) = vext[n] = 0          (singularity via bordered determinant)
//! ```
//!
//! where vext is the solution of [A, w; v', 0] * [vext; g] = [0; 1].

use super::{Borders, Codim2TestFunctions};
use crate::autodiff::Dual;
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

/// Continuation problem for fold (LP) bifurcation curves.
pub struct FoldCurveProblem<'a> {
    system: &'a mut EquationSystem,
    kind: SystemKind,
    /// First active parameter index
    param1_index: usize,
    /// Second active parameter index
    param2_index: usize,
    /// Border vectors for regularity
    borders: Borders,
    /// Cached Jacobian for efficiency
    cached_jacobian: Option<DMatrix<f64>>,
    /// Last computed codim-2 test functions
    pub codim2_tests: Codim2TestFunctions,
}

impl<'a> FoldCurveProblem<'a> {
    /// Create a new fold curve problem from a known fold point.
    ///
    /// # Arguments
    /// * `system` - The dynamical system
    /// * `kind` - Flow or Map
    /// * `fold_state` - State at the fold point
    /// * `param1_index` - First parameter to vary
    /// * `param2_index` - Second parameter to vary
    pub fn new(
        system: &'a mut EquationSystem,
        kind: SystemKind,
        fold_state: &[f64],
        param1_index: usize,
        param2_index: usize,
    ) -> Result<Self> {
        let n = system.equations.len();
        if fold_state.len() != n {
            bail!("Fold state dimension mismatch");
        }

        // Compute Jacobian at fold point
        let jac = compute_jacobian(system, kind, fold_state)?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);

        // Initialize borders from eigenvector of smallest eigenvalue
        let (v, w) = initialize_fold_borders(&jac_mat)?;

        Ok(Self {
            system,
            kind,
            param1_index,
            param2_index,
            borders: Borders::new(v, w),
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

    /// Evaluate the fold singularity function g using bordered system.
    fn eval_singularity(&mut self, jac: &DMatrix<f64>) -> Result<f64> {
        let n = self.nphase();

        // Build bordered matrix [A, w; v', 0]
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);
        for i in 0..n {
            bordered[(i, n)] = self.borders.w[i];
            bordered[(n, i)] = self.borders.v[i];
        }
        bordered[(n, n)] = 0.0;

        // Solve for vext where [A, w; v', 0] * [vext; g] = [0; 1]
        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        let lu = bordered.lu();
        let solution = lu.solve(&rhs);

        match solution {
            Some(sol) => Ok(sol[n]), // g = last component
            None => bail!("Bordered system singular"),
        }
    }

    /// Compute codim-2 test functions for the fold curve.
    fn compute_codim2_tests(&mut self, jac: &DMatrix<f64>) -> Result<Codim2TestFunctions> {
        let n = self.nphase();
        let mut tests = Codim2TestFunctions::default();

        // Build bordered matrix and solve for null vectors
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);
        for i in 0..n {
            bordered[(i, n)] = self.borders.w[i];
            bordered[(n, i)] = self.borders.v[i];
        }
        bordered[(n, n)] = 0.0;

        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        let lu = bordered.clone().lu();
        if let (Some(vext), Some(wext)) = (lu.solve(&rhs), bordered.transpose().lu().solve(&rhs)) {
            let v = vext.rows(0, n);
            let w = wext.rows(0, n);

            // BT test: v' * w (inner product of null vectors)
            tests.bogdanov_takens = v.dot(&w);

            // ZH test: bialternate product determinant
            // For n >= 3, compute det(A^{[2]}) where A^{[2]} is bialternate product
            if n >= 3 {
                tests.zero_hopf = compute_bialternate_determinant(jac);
            }

            // CP test: quadratic normal form coefficient
            // a = w' * D²F(x)[v,v] / (w'*v) where D²F is Hessian
            // This requires computing second derivatives - simplified here
            tests.cusp = 1.0; // Placeholder - full implementation needs Hessians
        }

        Ok(tests)
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }
}

impl<'a> ContinuationProblem for FoldCurveProblem<'a> {
    fn dimension(&self) -> usize {
        // n state variables + 2 parameters = n+2 unknowns
        // n equations + 1 singularity condition = n+1 equations
        // For PALC, we have n+1 equations in n+2 unknowns
        self.nphase() + 1
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let n = self.nphase();
        if aug_state.len() != n + 2 {
            bail!("Augmented state has wrong dimension for fold curve");
        }
        if out.len() != n + 1 {
            bail!("Output buffer has incorrect dimension");
        }

        // Unpack: [p1, p2, x1, ..., xn]
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();

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

        // Compute singularity function g
        let jac = self.with_params(p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;

        let g = self.eval_singularity(&jac)?;
        out[n] = g;

        // Cache jacobian for efficiency
        self.cached_jacobian = Some(jac);

        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let n = self.nphase();
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();

        let kind = self.kind;
        let param1_idx = self.param1_index;
        let param2_idx = self.param2_index;

        // Extended Jacobian is (n+1) x (n+2): derivatives w.r.t. [p1, p2, x1..xn]
        let mut jext = DMatrix::zeros(n + 1, n + 2);

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

        // Derivatives of singularity function g
        // dg/dp1, dg/dp2, dg/dx require computing derivatives of bordered solve
        // For now, use numerical differentiation
        let eps = 1e-7;
        let g0 = self.eval_singularity(&jac)?;

        // dg/dp1
        let jac_p1 = self.with_params(p1 + eps, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p1 = self.eval_singularity(&jac_p1)?;
        jext[(n, 0)] = (g_p1 - g0) / eps;

        // dg/dp2
        let jac_p2 = self.with_params(p1, p2 + eps, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;
        let g_p2 = self.eval_singularity(&jac_p2)?;
        jext[(n, 1)] = (g_p2 - g0) / eps;

        // dg/dx_i
        for i in 0..n {
            let mut state_pert = state.clone();
            state_pert[i] += eps;
            let jac_xi = self.with_params(p1, p2, |system| {
                let j = compute_jacobian(system, kind, &state_pert)?;
                Ok(DMatrix::from_row_slice(n, n, &j))
            })?;
            let g_xi = self.eval_singularity(&jac_xi)?;
            jext[(n, i + 2)] = (g_xi - g0) / eps;
        }

        self.cached_jacobian = Some(jac);
        Ok(jext)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let n = self.nphase();
        let p1 = aug_state[0];
        let p2 = aug_state[1];
        let state: Vec<f64> = aug_state.rows(2, n).iter().cloned().collect();

        let kind = self.kind;
        let jac = self.with_params(p1, p2, |system| {
            let j = compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(n, n, &j))
        })?;

        // Compute eigenvalues
        let eigenvalues: Vec<Complex<f64>> =
            jac.clone().complex_eigenvalues().iter().cloned().collect();

        // Compute codim-2 test functions
        self.codim2_tests = self.compute_codim2_tests(&jac)?;

        // For the standard test functions, use fold = det(A) which should be ~0 on the curve
        let fold = jac.determinant();

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(fold, 1.0, 1.0),
            eigenvalues,
            cycle_points: None,
        })
    }

    fn update_after_step(&mut self, _aug_state: &DVector<f64>) -> Result<()> {
        // Update borders after each step to maintain regularity
        if let Some(ref jac) = self.cached_jacobian {
            self.borders.update(jac)?;
        }
        Ok(())
    }
}

/// Initialize fold curve borders from eigenvectors of smallest eigenvalue.
fn initialize_fold_borders(jac: &DMatrix<f64>) -> Result<(DVector<f64>, DVector<f64>)> {
    let n = jac.nrows();
    if n == 0 {
        bail!("Cannot initialize borders for empty Jacobian");
    }

    // Compute eigenvalues to find the one closest to zero
    let eigenvalues = jac.clone().complex_eigenvalues();
    let mut _min_idx = 0;
    let mut min_abs = f64::MAX;
    for (i, ev) in eigenvalues.iter().enumerate() {
        let abs = ev.norm();
        if abs < min_abs {
            min_abs = abs;
            _min_idx = i;
        }
    }

    // Use SVD to get right null vector (v) and left null vector (w)
    let svd = jac.clone().svd(true, true);

    if let (Some(u), Some(vt)) = (svd.u, svd.v_t) {
        // v = last column of V (right singular vector for smallest singular value)
        let v: DVector<f64> = vt.row(n - 1).transpose().into();
        // w = last column of U (left singular vector for smallest singular value)
        let w: DVector<f64> = u.column(n - 1).into();
        // Compute norms before dividing to avoid move issues
        let v_norm = v.norm();
        let w_norm = w.norm();
        Ok((v / v_norm, w / w_norm))
    } else {
        // Fallback: use random vectors
        let v = DVector::from_element(n, 1.0 / (n as f64).sqrt());
        let w = v.clone();
        Ok((v, w))
    }
}

/// Compute determinant of bialternate product matrix for ZH detection.
/// The bialternate product A^{[2]} has dimension n(n-1)/2 x n(n-1)/2.
fn compute_bialternate_determinant(jac: &DMatrix<f64>) -> f64 {
    let n = jac.nrows();
    if n < 3 {
        return 1.0; // Not applicable for n < 3
    }

    let m = n * (n - 1) / 2;
    let mut bialt = DMatrix::zeros(m, m);

    // Build bialternate product: (A^{[2]})_{(i,j),(k,l)} = A_{ik}*δ_{jl} - A_{il}*δ_{jk} + A_{jl}*δ_{ik} - A_{jk}*δ_{il}
    // Simplified: use the formula from reference implementation
    let mut row = 0;
    for i in 0..n {
        for j in (i + 1)..n {
            let mut col = 0;
            for k in 0..n {
                for l in (k + 1)..n {
                    // Kronecker deltas
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

    bialt.determinant()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, OpCode};

    #[test]
    fn test_fold_curve_residual_dimension() {
        // Simple 1D fold: dx/dt = x^2 + a
        let mut ops = Vec::new();
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::LoadConst(2.0));
        ops.push(OpCode::Pow);
        ops.push(OpCode::LoadParam(0));
        ops.push(OpCode::Add);

        let eq = Bytecode { ops };
        let params = vec![0.0, 0.0]; // [a, b] - two parameters
        let mut system = EquationSystem::new(vec![eq], params);

        let problem = FoldCurveProblem::new(
            &mut system,
            SystemKind::Flow,
            &[0.0], // x = 0 is fold when a = 0
            0,
            1,
        );

        assert!(problem.is_ok());
        let problem = problem.unwrap();
        assert_eq!(problem.dimension(), 2); // n+1 = 1+1 = 2 equations
    }
}
