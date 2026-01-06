//! Shared continuation helpers.

use fork_core::autodiff::Dual;
use fork_core::continuation::{
    compute_eigenvalues, hopf_test_function, neutral_saddle_test_function,
    ContinuationProblem, PointDiagnostics, TestFunctionValues,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::SystemKind;
use fork_core::traits::DynamicalSystem;
use nalgebra::{DMatrix, DVector};

pub(crate) struct OwnedEquilibriumContinuationProblem {
    system: EquationSystem,
    kind: SystemKind,
    param_index: usize,
}

impl OwnedEquilibriumContinuationProblem {
    pub(crate) fn new(system: EquationSystem, kind: SystemKind, param_index: usize) -> Self {
        Self {
            system,
            kind,
            param_index,
        }
    }

    fn with_param<F, R>(&mut self, param: f64, f: F) -> anyhow::Result<R>
    where
        F: FnOnce(&mut EquationSystem) -> anyhow::Result<R>,
    {
        let old = self.system.params[self.param_index];
        self.system.params[self.param_index] = param;
        let result = f(&mut self.system);
        self.system.params[self.param_index] = old;
        result
    }
}

impl ContinuationProblem for OwnedEquilibriumContinuationProblem {
    fn dimension(&self) -> usize {
        self.system.equations.len()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> anyhow::Result<()> {
        let dim = self.dimension();
        if out.len() != dim {
            anyhow::bail!("Residual buffer has incorrect dimension");
        }

        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        self.with_param(param, |system| {
            match kind {
                SystemKind::Flow => system.apply(0.0, &state, out.as_mut_slice()),
                SystemKind::Map => {
                    system.apply(0.0, &state, out.as_mut_slice());
                    for i in 0..out.len() {
                        out[i] -= state[i];
                    }
                }
            }
            Ok(())
        })?;

        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> anyhow::Result<DMatrix<f64>> {
        let dim = self.dimension();
        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;
        let param_index = self.param_index;

        let mut j_ext = DMatrix::zeros(dim, dim + 1);

        self.with_param(param, |system| {
            let mut f_dual = vec![Dual::new(0.0, 0.0); dim];
            system.evaluate_dual_wrt_param(&state, param_index, &mut f_dual);
            for i in 0..dim {
                j_ext[(i, 0)] = f_dual[i].eps;
            }

            let jac_x = fork_core::equilibrium::compute_jacobian(system, kind, &state)?;
            for col in 0..dim {
                for row in 0..dim {
                    j_ext[(row, col + 1)] = jac_x[row * dim + col];
                }
            }

            Ok(())
        })?;

        Ok(j_ext)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> anyhow::Result<PointDiagnostics> {
        let dim = self.dimension();
        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        let mat = self.with_param(param, |system| {
            let jac = fork_core::equilibrium::compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(dim, dim, &jac))
        })?;

        let fold = mat.determinant();
        let eigenvalues = compute_eigenvalues(&mat)?;
        let (hopf, neutral) = if matches!(kind, SystemKind::Flow) && dim >= 2 {
            (
                hopf_test_function(&eigenvalues).re,
                neutral_saddle_test_function(&eigenvalues),
            )
        } else {
            (0.0, 0.0)
        };

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(fold, hopf, neutral),
            eigenvalues,
        })
    }
}

pub(crate) fn compute_tangent_from_problem<P: ContinuationProblem>(
    problem: &mut P,
    aug_state: &DVector<f64>,
) -> anyhow::Result<DVector<f64>> {
    let dim = problem.dimension();
    let jac = problem.extended_jacobian(aug_state)?;

    if jac.nrows() != dim || jac.ncols() != dim + 1 {
        anyhow::bail!(
            "Jacobian has unexpected dimensions: {}x{}, expected {}x{}",
            jac.nrows(),
            jac.ncols(),
            dim,
            dim + 1
        );
    }

    let bordering_candidates = [0, dim, 1];
    for &idx in &bordering_candidates {
        let mut c = DVector::zeros(dim + 1);
        c[idx.min(dim)] = 1.0;

        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        for i in 0..dim {
            for j in 0..dim + 1 {
                bordered[(i, j)] = jac[(i, j)];
            }
        }
        for j in 0..dim + 1 {
            bordered[(dim, j)] = c[j];
        }

        let mut rhs = DVector::zeros(dim + 1);
        rhs[dim] = 1.0;

        let lu = bordered.lu();
        if let Some(sol) = lu.solve(&rhs) {
            let norm = sol.norm();
            if norm > 1e-10 && sol.iter().all(|v| v.is_finite()) {
                return Ok(sol / norm);
            }
        }
    }

    let mut tangent = DVector::zeros(dim + 1);
    tangent[0] = 1.0;
    Ok(tangent)
}
