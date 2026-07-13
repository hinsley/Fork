//! Shared continuation helpers.

pub(crate) use fork_core::continuation::compute_tangent_from_problem;
use fork_core::continuation::util::{neimark_sacker_test_function, period_doubling_test_function};
use fork_core::continuation::{
    compute_eigenvalues, hopf_test_function, map_branch_point_normal_form,
    neutral_saddle_test_function, BifurcationType, ContinuationProblem, MapBranchPointKind,
    PointDiagnostics, TestFunctionValues,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::{
    compute_map_cycle_points_with_periodicity, compute_param_jacobian, compute_system_jacobian,
    evaluate_equilibrium_residual_with_periodicity, SystemKind,
};
use fork_core::state_periodicity::StatePeriodicity;
use nalgebra::{DMatrix, DVector};

pub(crate) struct OwnedEquilibriumContinuationProblem {
    system: EquationSystem,
    kind: SystemKind,
    param_index: usize,
    periodicity: StatePeriodicity,
}

impl OwnedEquilibriumContinuationProblem {
    pub(crate) fn new(system: EquationSystem, kind: SystemKind, param_index: usize) -> Self {
        Self::new_with_periodicity(system, kind, param_index, StatePeriodicity::none())
    }

    pub(crate) fn new_with_periodicity(
        system: EquationSystem,
        kind: SystemKind,
        param_index: usize,
        periodicity: StatePeriodicity,
    ) -> Self {
        Self {
            system,
            kind,
            param_index,
            periodicity,
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
        let periodicity = self.periodicity.clone();

        self.with_param(param, |system| {
            evaluate_equilibrium_residual_with_periodicity(
                system,
                kind,
                &state,
                out.as_mut_slice(),
                &periodicity,
            )
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
            let param_jac = compute_param_jacobian(system, kind, &state, param_index)?;
            for i in 0..dim {
                j_ext[(i, 0)] = param_jac[i];
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
        let periodicity = self.periodicity.clone();

        let iterations = kind.map_iterations();
        let (residual_mat, eigen_mat, cycle_points) = self.with_param(param, |system| {
            let system_jac = compute_system_jacobian(system, kind, &state)?;
            let mut residual_jac = system_jac.clone();
            if kind.is_map() {
                for i in 0..dim {
                    residual_jac[i * dim + i] -= 1.0;
                }
            }
            let residual_mat = DMatrix::from_row_slice(dim, dim, &residual_jac);
            let eigen_mat = if kind.is_map() {
                DMatrix::from_row_slice(dim, dim, &system_jac)
            } else {
                residual_mat.clone()
            };
            let cycle_points = if kind.is_map() && iterations > 1 {
                Some(compute_map_cycle_points_with_periodicity(
                    system,
                    &state,
                    iterations,
                    &periodicity,
                ))
            } else {
                None
            };
            Ok((residual_mat, eigen_mat, cycle_points))
        })?;

        let fold = residual_mat.determinant();
        let eigenvalues = compute_eigenvalues(&eigen_mat)?;
        let (hopf, neutral) = if kind.is_flow() && dim >= 2 {
            (
                hopf_test_function(&eigenvalues).re,
                neutral_saddle_test_function(&eigenvalues),
            )
        } else {
            (0.0, 0.0)
        };

        let mut test_values = TestFunctionValues::equilibrium(fold, hopf, neutral);
        if kind.is_map() {
            // For a map, det(D Phi^k - I)=0 is the generic +1-multiplier
            // event. Classification below distinguishes saddle-node from a
            // transcritical or pitchfork branch point using the local normal form.
            test_values.fold = 1.0;
            test_values.branch_point = fold;
            test_values.period_doubling = period_doubling_test_function(&eigenvalues);
            test_values.neimark_sacker = neimark_sacker_test_function(&eigenvalues);
        }

        Ok(PointDiagnostics {
            test_values,
            eigenvalues,
            cycle_points,
        })
    }

    fn classify_bifurcation(
        &mut self,
        aug_state: &DVector<f64>,
        detected: BifurcationType,
    ) -> anyhow::Result<BifurcationType> {
        if !self.kind.is_map() || detected != BifurcationType::BranchPoint {
            return Ok(detected);
        }
        let dim = self.dimension();
        let state = aug_state.rows(1, dim).iter().copied().collect::<Vec<_>>();
        let normal_form = map_branch_point_normal_form(
            &mut self.system,
            &state,
            self.param_index,
            aug_state[0],
            self.kind.map_iterations(),
        )?;
        Ok(if normal_form.kind == MapBranchPointKind::Fold {
            BifurcationType::Fold
        } else {
            BifurcationType::BranchPoint
        })
    }
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
    fn equilibrium_problem_periodic_map_residual_and_cycle_points_wrap() {
        let system = build_system(
            vec!["x + a".to_string()],
            vec![1.0],
            &vec!["a".to_string()],
            &vec!["x".to_string()],
        )
        .expect("system");
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);
        let mut problem = OwnedEquilibriumContinuationProblem::new_with_periodicity(
            system,
            SystemKind::Map { iterations: 2 },
            0,
            periodicity,
        );

        let aug_state = DVector::from_vec(vec![1.0, 1.2]);
        let mut residual = DVector::zeros(1);
        problem
            .residual(&aug_state, &mut residual)
            .expect("residual");
        assert!(residual[0].abs() < 1e-12);

        let diagnostics = problem.diagnostics(&aug_state).expect("diagnostics");
        let cycle_points = diagnostics.cycle_points.expect("cycle points");
        assert_eq!(cycle_points.len(), 2);
        assert!((cycle_points[0][0] - 0.2).abs() < 1e-12);
        assert!((cycle_points[1][0] - 0.2).abs() < 1e-12);
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
        let mut problem =
            OwnedEquilibriumContinuationProblem::new(system, SystemKind::Map { iterations: 1 }, 0);

        let aug_state = DVector::from_vec(vec![2.0, 3.0]);
        let mut residual = DVector::zeros(1);

        problem
            .residual(&aug_state, &mut residual)
            .expect("residual");
        let expected = aug_state[0] * aug_state[1] - aug_state[1];
        assert!((residual[0] - expected).abs() < 1e-12);
        assert!((problem.system.params[0] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn equilibrium_problem_with_param_restores_after_error() {
        let system = build_linear_system(2.0);
        let mut problem = OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);

        let result: anyhow::Result<()> = problem.with_param(5.0, |_system| -> anyhow::Result<()> {
            anyhow::bail!("fail")
        });
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
        assert!((values.hopf - 1.0).abs() < 1e-12);
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
        let mut problem =
            OwnedEquilibriumContinuationProblem::new(system, SystemKind::Map { iterations: 1 }, 0);
        let aug_state = DVector::from_vec(vec![2.0, 0.5, -0.25]);

        let diagnostics = problem.diagnostics(&aug_state).expect("diagnostics");
        let values = diagnostics.test_values;
        assert!((values.fold - 1.0).abs() < 1e-12);
        assert!((values.branch_point - 2.0).abs() < 1e-12);
        assert!((values.period_doubling - 12.0).abs() < 1e-12);
        assert_eq!(values.hopf, 0.0);
        assert_eq!(values.neutral_saddle, 0.0);

        let mut eigenvalues: Vec<f64> = diagnostics.eigenvalues.iter().map(|v| v.re).collect();
        eigenvalues.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(eigenvalues.len(), 2);
        assert!((eigenvalues[0] - 2.0).abs() < 1e-12);
        assert!((eigenvalues[1] - 3.0).abs() < 1e-12);
    }

    #[test]
    fn stepped_map_problem_classifies_pitchfork_and_fold_plus_one_events() {
        let pitchfork = build_system(
            vec!["x + mu*a*x + c*x^3".to_string()],
            vec![0.0, -0.456, -1.234],
            &vec!["mu".to_string(), "a".to_string(), "c".to_string()],
            &vec!["x".to_string()],
        )
        .expect("pitchfork map");
        let mut pitchfork_problem = OwnedEquilibriumContinuationProblem::new(
            pitchfork,
            SystemKind::Map { iterations: 1 },
            0,
        );
        let pitchfork_aug = DVector::from_vec(vec![0.0, 0.0]);
        assert_eq!(
            pitchfork_problem
                .classify_bifurcation(
                    &pitchfork_aug,
                    fork_core::continuation::BifurcationType::BranchPoint,
                )
                .expect("pitchfork classification"),
            fork_core::continuation::BifurcationType::BranchPoint
        );

        let fold = build_system(
            vec!["x + mu - x^2".to_string()],
            vec![0.0],
            &vec!["mu".to_string()],
            &vec!["x".to_string()],
        )
        .expect("fold map");
        let mut fold_problem =
            OwnedEquilibriumContinuationProblem::new(fold, SystemKind::Map { iterations: 1 }, 0);
        let fold_aug = DVector::from_vec(vec![0.0, 0.0]);
        assert_eq!(
            fold_problem
                .classify_bifurcation(
                    &fold_aug,
                    fork_core::continuation::BifurcationType::BranchPoint,
                )
                .expect("fold classification"),
            fork_core::continuation::BifurcationType::Fold
        );
    }

    #[test]
    fn equilibrium_problem_diagnostics_map_neimark_sacker_crosses_unit_circle() {
        let equations = vec!["a * x - 0.5 * y".to_string(), "0.5 * x + a * y".to_string()];
        let params = vec![0.5];
        let param_names = vec!["a".to_string()];
        let var_names = vec!["x".to_string(), "y".to_string()];
        let system = build_system(equations, params, &param_names, &var_names).expect("system");
        let mut problem =
            OwnedEquilibriumContinuationProblem::new(system, SystemKind::Map { iterations: 1 }, 0);

        let aug_inside = DVector::from_vec(vec![0.5, 0.0, 0.0]);
        let inside = problem.diagnostics(&aug_inside).expect("diagnostics");
        assert!(
            inside.test_values.neimark_sacker < 0.0,
            "expected inside-unit-circle test to be negative, got {}",
            inside.test_values.neimark_sacker
        );

        let aug_outside = DVector::from_vec(vec![1.1, 0.0, 0.0]);
        let outside = problem.diagnostics(&aug_outside).expect("diagnostics");
        assert!(
            outside.test_values.neimark_sacker > 0.0,
            "expected outside-unit-circle test to be positive, got {}",
            outside.test_values.neimark_sacker
        );
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

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> anyhow::Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(0.0, 0.0, 0.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
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
        assert!(
            tangent[1].abs() > 0.0,
            "expected non-zero secondary component"
        );
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
    fn compute_tangent_rejects_a_rank_zero_jacobian() {
        let mut problem = DummyProblem {
            jac: DMatrix::from_row_slice(1, 2, &[0.0, 0.0]),
        };
        let aug_state = DVector::from_vec(vec![0.0, 0.0]);

        let error = compute_tangent_from_problem(&mut problem, &aug_state)
            .expect_err("a rank-zero Jacobian has no unique continuation tangent");
        assert!(
            error.to_string().contains("rank deficient"),
            "unexpected error: {error}"
        );
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
