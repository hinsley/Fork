use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, ContinuationBranch,
    ContinuationPoint, ContinuationSettings,
};
use super::util::{hopf_test_function, neutral_saddle_test_function};
use crate::autodiff::Dual;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, compute_system_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

pub struct EquilibriumContinuationProblem<'a> {
    system: &'a mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
}

impl<'a> EquilibriumContinuationProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, kind: SystemKind, param_index: usize) -> Self {
        Self {
            system,
            kind,
            param_index,
        }
    }

    fn with_param<F, R>(&mut self, param: f64, mut f: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        let old = self.system.params[self.param_index];
        self.system.params[self.param_index] = param;
        let result = f(self.system);
        self.system.params[self.param_index] = old;
        result
    }
}

impl<'a> ContinuationProblem for EquilibriumContinuationProblem<'a> {
    fn dimension(&self) -> usize {
        self.system.equations.len()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let dim = self.dimension();
        if out.len() != dim {
            bail!("Residual buffer has incorrect dimension");
        }

        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        self.with_param(param, |system| {
            evaluate_residual(system, kind, &state, out.as_mut_slice());
            Ok(())
        })?;

        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
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

            let jac_x = compute_jacobian(system, kind, &state)?;
            for col in 0..dim {
                for row in 0..dim {
                    j_ext[(row, col + 1)] = jac_x[row * dim + col];
                }
            }
            Ok(())
        })?;

        Ok(j_ext)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let dim = self.dimension();
        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        let (residual_mat, eigen_mat) = self.with_param(param, |system| {
            let system_jac = compute_system_jacobian(system, &state)?;
            let mut residual_jac = system_jac.clone();
            if matches!(kind, SystemKind::Map) {
                for i in 0..dim {
                    residual_jac[i * dim + i] -= 1.0;
                }
            }
            let residual_mat = DMatrix::from_row_slice(dim, dim, &residual_jac);
            let eigen_mat = if matches!(kind, SystemKind::Map) {
                DMatrix::from_row_slice(dim, dim, &system_jac)
            } else {
                residual_mat.clone()
            };
            Ok((residual_mat, eigen_mat))
        })?;

        let fold = residual_mat.determinant();
        let eigenvalues = compute_eigenvalues(&eigen_mat)?;
        let (hopf, neutral) = if matches!(self.kind, SystemKind::Flow) && dim >= 2 {
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

pub fn continue_parameter(
    system: &mut EquationSystem,
    kind: SystemKind,
    initial_state: &[f64],
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let param_value = system.params[param_index];
    let mut problem = EquilibriumContinuationProblem::new(system, kind, param_index);
    if initial_state.len() != problem.dimension() {
        bail!("Initial state dimension mismatch");
    }

    let initial_point = ContinuationPoint {
        state: initial_state.to_vec(),
        param_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
    };

    continue_with_problem(&mut problem, initial_point, settings, forward)
}

pub fn extend_branch(
    system: &mut EquationSystem,
    kind: SystemKind,
    branch: ContinuationBranch,
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let mut problem = EquilibriumContinuationProblem::new(system, kind, param_index);
    extend_branch_with_problem(&mut problem, branch, settings, forward)
}

pub fn compute_eigenvalues_for_state(
    system: &mut EquationSystem,
    kind: SystemKind,
    state: &[f64],
    param_index: usize,
    param_value: f64,
) -> Result<Vec<Complex<f64>>> {
    let mut aug = DVector::zeros(state.len() + 1);
    aug[0] = param_value;
    for (i, &val) in state.iter().enumerate() {
        aug[i + 1] = val;
    }
    let mut problem = EquilibriumContinuationProblem::new(system, kind, param_index);
    let diagnostics = problem.diagnostics(&aug)?;
    Ok(diagnostics.eigenvalues)
}

fn evaluate_residual(system: &EquationSystem, kind: SystemKind, state: &[f64], out: &mut [f64]) {
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map => {
            system.apply(0.0, state, out);
            for i in 0..out.len() {
                out[i] -= state[i];
            }
        }
    }
}

fn compute_eigenvalues(mat: &DMatrix<f64>) -> Result<Vec<Complex<f64>>> {
    if mat.nrows() == 0 {
        return Ok(Vec::new());
    }

    let eigen = mat.clone().complex_eigenvalues();
    Ok(eigen.iter().cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};

    #[test]
    fn test_palc_simple_fold() {
        let mut ops = Vec::new();
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::LoadConst(2.0));
        ops.push(OpCode::Pow);
        ops.push(OpCode::LoadParam(0));
        ops.push(OpCode::Add);

        let eq = Bytecode { ops };
        let equations = vec![eq];
        let params = vec![-1.0];
        let mut system = EquationSystem::new(equations, params);

        let initial_state = vec![1.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.5,
            max_steps: 40,
            corrector_steps: 5,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let res = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true,
        );

        assert!(res.is_ok(), "Continuation failed: {:?}", res.err());
        let branch = res.unwrap();

        assert!(branch.points.len() > 1);
        assert!(branch.points[1].param_value > -1.0);
        assert!(branch.points[1].state[0] < 1.0);
    }

    #[test]
    fn test_equilibrium_bifurcation_detection() {
        // dx/dt = mu*x - y
        // dy/dt = x + mu*y
        // Hopf at mu = 0
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
        let params = vec![-0.5]; // Start at mu = -0.5
        let mut system = EquationSystem::new(equations, params);
        
        let initial_state = vec![0.0, 0.0];
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 20,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };
        
        let branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            0,
            settings,
            true, // Forward to mu = 0 and beyond
        ).expect("Continuation should succeed");
        
        println!("Branch has {} points", branch.points.len());
        println!("Bifurcations detected at indices: {:?}", branch.bifurcations);
        
        assert!(!branch.bifurcations.is_empty(), "No bifurcations detected!");
        
        let bif_idx = branch.bifurcations[0];
        let bif_point = &branch.points[bif_idx];
        
        assert_eq!(bif_point.stability, BifurcationType::Hopf);
        assert!(bif_point.param_value.abs() < 1e-3, "Hopf point {} too far from 0", bif_point.param_value);
    }
}
