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

#[cfg(test)]
mod problem_tests {
    use super::*;
    use crate::system::build_system;

    fn build_linear_system(param_value: f64) -> EquationSystem {
        build_system(
            vec!["a * x".to_string()],
            vec![param_value],
            &vec!["a".to_string()],
            &vec!["x".to_string()],
        )
        .expect("system")
    }

    fn build_two_param_system(a_value: f64, b_value: f64) -> EquationSystem {
        build_system(
            vec!["a * x".to_string(), "b * y".to_string()],
            vec![a_value, b_value],
            &vec!["a".to_string(), "b".to_string()],
            &vec!["x".to_string(), "y".to_string()],
        )
        .expect("system")
    }

    #[test]
    fn equilibrium_problem_residual_and_jacobian() {
        let system = build_linear_system(2.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);

        let aug_state = DVector::from_vec(vec![2.0, 3.0]);
        let mut residual = DVector::zeros(1);

        problem
            .residual(&aug_state, &mut residual)
            .expect("residual");
        assert!((residual[0] - 6.0).abs() < 1e-12);

        let jac = problem.extended_jacobian(&aug_state).expect("jacobian");
        assert_eq!(jac.nrows(), 1);
        assert_eq!(jac.ncols(), 2);
        assert!((jac[(0, 0)] - 3.0).abs() < 1e-12);
        assert!((jac[(0, 1)] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn equilibrium_problem_residual_rejects_wrong_buffer_size() {
        let system = build_linear_system(2.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);

        let aug_state = DVector::from_vec(vec![2.0, 3.0]);
        let mut residual = DVector::zeros(2);

        let err = problem
            .residual(&aug_state, &mut residual)
            .expect_err("should reject mismatched residual buffer");
        assert!(err.to_string().contains("incorrect dimension"));
    }

    #[test]
    fn equilibrium_problem_residual_map_restores_param() {
        let system = build_linear_system(1.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Map, 0);

        let aug_state = DVector::from_vec(vec![2.0, 3.0]);
        let mut residual = DVector::zeros(1);

        problem
            .residual(&aug_state, &mut residual)
            .expect("residual");
        assert!((residual[0] - 3.0).abs() < 1e-12);
        assert!((problem.system.params[0] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn equilibrium_problem_with_param_restores_after_error() {
        let system = build_linear_system(2.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);

        let result: anyhow::Result<()> =
            problem.with_param(5.0, |_system| anyhow::bail!("fail"));
        assert!(result.is_err());
        assert!((problem.system.params[0] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn equilibrium_problem_diagnostics_flow_reports_bifurcations() {
        let system = build_two_param_system(2.0, 3.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);
        let aug_state = DVector::from_vec(vec![2.0, 0.5, -0.25]);

        let diagnostics = problem.diagnostics(&aug_state).expect("diagnostics");
        let values = diagnostics.test_values;
        assert!((values.fold - 6.0).abs() < 1e-12);
        assert!((values.hopf - 5.0).abs() < 1e-12);
        assert!((values.neutral_saddle - 5.0).abs() < 1e-12);

        let mut eigenvalues: Vec<f64> = diagnostics.eigenvalues.iter().map(|v| v.re).collect();
        eigenvalues.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(eigenvalues.len(), 2);
        assert!((eigenvalues[0] - 2.0).abs() < 1e-12);
        assert!((eigenvalues[1] - 3.0).abs() < 1e-12);
    }

    #[test]
    fn equilibrium_problem_diagnostics_map_zeroes_hopf_and_neutral() {
        let system = build_two_param_system(2.0, 3.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Map, 0);
        let aug_state = DVector::from_vec(vec![2.0, 0.5, -0.25]);

        let diagnostics = problem.diagnostics(&aug_state).expect("diagnostics");
        let values = diagnostics.test_values;
        assert!((values.fold - 2.0).abs() < 1e-12);
        assert_eq!(values.hopf, 0.0);
        assert_eq!(values.neutral_saddle, 0.0);

        let mut eigenvalues: Vec<f64> = diagnostics.eigenvalues.iter().map(|v| v.re).collect();
        eigenvalues.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(eigenvalues.len(), 2);
        assert!((eigenvalues[0] - 1.0).abs() < 1e-12);
        assert!((eigenvalues[1] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn compute_tangent_returns_unit_vector() {
        let system = build_linear_system(1.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);
        let aug_state = DVector::from_vec(vec![1.0, 0.0]);

        let tangent = compute_tangent_from_problem(&mut problem, &aug_state).expect("tangent");
        assert_eq!(tangent.len(), 2);
        let norm = tangent.norm();
        assert!((norm - 1.0).abs() < 1e-12);
        assert!(tangent.iter().all(|v| v.is_finite()));
    }
}

#[cfg(test)]
mod tangent_tests {
    use super::compute_tangent_from_problem;
    use fork_core::continuation::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
    use nalgebra::{DMatrix, DVector};

    struct DummyProblem {
        jac: DMatrix<f64>,
    }

    impl ContinuationProblem for DummyProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(
            &mut self,
            _aug_state: &DVector<f64>,
            out: &mut DVector<f64>,
        ) -> anyhow::Result<()> {
            if out.len() != 1 {
                anyhow::bail!("Unexpected residual size");
            }
            out[0] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> anyhow::Result<DMatrix<f64>> {
            Ok(self.jac.clone())
        }

        fn diagnostics(
            &mut self,
            _aug_state: &DVector<f64>,
        ) -> anyhow::Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(0.0, 0.0, 0.0),
                eigenvalues: Vec::new(),
            })
        }
    }

    #[test]
    fn compute_tangent_solves_bordered_system() {
        let mut problem = DummyProblem {
            jac: DMatrix::from_row_slice(1, 2, &[1.0, 0.0]),
        };
        let aug_state = DVector::from_vec(vec![0.0, 0.0]);

        let tangent = compute_tangent_from_problem(&mut problem, &aug_state).expect("tangent");
        assert_eq!(tangent.len(), 2);
        assert!((tangent.norm() - 1.0).abs() < 1e-8);
        assert!(tangent[1].abs() > 0.0, "expected non-zero secondary component");
    }

    #[test]
    fn compute_tangent_reports_mismatched_jacobian_dims() {
        let mut problem = DummyProblem {
            jac: DMatrix::from_row_slice(2, 2, &[1.0, 0.0, 0.0, 1.0]),
        };
        let aug_state = DVector::from_vec(vec![0.0, 0.0]);

        let err = compute_tangent_from_problem(&mut problem, &aug_state)
            .expect_err("expected Jacobian dimension error");
        let message = format!("{err}");
        assert!(
            message.contains("Jacobian has unexpected dimensions"),
            "unexpected error message: {message}"
        );
    }

    #[test]
    fn compute_tangent_falls_back_on_singular_system() {
        let mut problem = DummyProblem {
            jac: DMatrix::from_row_slice(1, 2, &[0.0, 0.0]),
        };
        let aug_state = DVector::from_vec(vec![0.0, 0.0]);

        let tangent = compute_tangent_from_problem(&mut problem, &aug_state).expect("tangent");
        assert_eq!(tangent.len(), 2);
        assert_eq!(tangent[0], 1.0);
        assert_eq!(tangent[1], 0.0);
    }

    #[test]
    fn compute_tangent_rejects_mismatched_jacobian_dimensions() {
        let mut problem = DummyProblem {
            jac: DMatrix::from_row_slice(2, 2, &[1.0, 0.0, 0.0, 1.0]),
        };
        let aug_state = DVector::from_vec(vec![0.0, 0.0]);

        let err = compute_tangent_from_problem(&mut problem, &aug_state)
            .expect_err("should reject unexpected Jacobian dimensions");
        assert!(err.to_string().contains("unexpected dimensions"));
    }
}
