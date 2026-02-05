use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use super::util::{
    hopf_test_function, neimark_sacker_test_function, neutral_saddle_test_function,
    period_doubling_test_function,
};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, ContinuationBranch,
    ContinuationPoint, ContinuationSettings,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{
    compute_jacobian, compute_map_cycle_points, compute_param_jacobian, compute_system_jacobian,
    evaluate_equilibrium_residual, SystemKind,
};
use anyhow::{bail, Result};
use nalgebra::linalg::SVD;
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
            evaluate_equilibrium_residual(system, kind, &state, out.as_mut_slice())
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
            let param_jac = compute_param_jacobian(system, kind, &state, param_index)?;
            for i in 0..dim {
                j_ext[(i, 0)] = param_jac[i];
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
                Some(compute_map_cycle_points(system, &state, iterations))
            } else {
                None
            };
            Ok((residual_mat, eigen_mat, cycle_points))
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

        let mut test_values = TestFunctionValues::equilibrium(fold, hopf, neutral);
        if self.kind.is_map() {
            test_values.period_doubling = period_doubling_test_function(&eigenvalues);
            test_values.neimark_sacker = neimark_sacker_test_function(&eigenvalues);
        }

        Ok(PointDiagnostics {
            test_values,
            eigenvalues,
            cycle_points,
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
        cycle_points: None,
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

pub fn map_cycle_seed_from_pd(
    system: &mut EquationSystem,
    param_index: usize,
    pd_state: &[f64],
    param_value: f64,
    map_iterations: usize,
    amplitude: f64,
) -> Result<Vec<f64>> {
    if map_iterations == 0 {
        bail!("Map iteration count must be greater than zero.");
    }
    if amplitude == 0.0 {
        bail!("Amplitude must be non-zero.");
    }
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System has zero dimension.");
    }
    if pd_state.len() != dim {
        bail!(
            "PD state dimension mismatch. Expected {}, got {}.",
            dim,
            pd_state.len()
        );
    }
    if param_index >= system.params.len() {
        bail!("Parameter index out of bounds.");
    }

    let old_param = system.params[param_index];
    system.params[param_index] = param_value;

    let seed = (|| {
        let jac = compute_system_jacobian(
            system,
            SystemKind::Map {
                iterations: map_iterations,
            },
            pd_state,
        )?;
        let mut shifted = DMatrix::from_row_slice(dim, dim, &jac);
        for i in 0..dim {
            shifted[(i, i)] += 1.0;
        }

        let svd = SVD::new(shifted, false, true);
        let v_t = svd
            .v_t
            .ok_or_else(|| anyhow::anyhow!("SVD failed to compute eigenvector basis"))?;
        let (min_idx, _) = svd.singular_values.iter().enumerate().fold(
            (0usize, f64::INFINITY),
            |(idx_min, val_min), (idx, &val)| {
                if val < val_min {
                    (idx, val)
                } else {
                    (idx_min, val_min)
                }
            },
        );

        let mut eigenvector: Vec<f64> = v_t.row(min_idx).iter().copied().collect();
        let norm = eigenvector.iter().map(|v| v * v).sum::<f64>().sqrt();
        if norm <= 1e-12 {
            bail!("PD eigenvector is nearly zero - not at a period-doubling point.");
        }
        for v in &mut eigenvector {
            *v /= norm;
        }

        let seed: Vec<f64> = pd_state
            .iter()
            .zip(eigenvector.iter())
            .map(|(x, v)| x + amplitude * v)
            .collect();

        Ok(seed)
    })();

    system.params[param_index] = old_param;
    seed
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
    use crate::equation_engine::{parse, Bytecode, Compiler, EquationSystem, OpCode};
    use crate::equilibrium::{solve_equilibrium, NewtonSettings};
    use crate::traits::DynamicalSystem;

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
        )
        .expect("Continuation should succeed");

        println!("Branch has {} points", branch.points.len());
        println!(
            "Bifurcations detected at indices: {:?}",
            branch.bifurcations
        );

        assert!(!branch.bifurcations.is_empty(), "No bifurcations detected!");

        let bif_idx = branch.bifurcations[0];
        let bif_point = &branch.points[bif_idx];

        assert_eq!(bif_point.stability, BifurcationType::Hopf);
        assert!(
            bif_point.param_value.abs() < 1e-3,
            "Hopf point {} too far from 0",
            bif_point.param_value
        );
    }

    #[test]
    fn test_rossler_backward_continuation_single_hopf() {
        // Regression: ensure complex-conjugate eigenpairs colliding into real values
        // do not create spurious Hopf/neutral-saddle detections in backward continuation.
        // Matches the Rossler default system in web/src/system/defaultSystems.ts.
        let equations = vec!["-y - z", "x + a * y", "b + z * (x - c)"];
        let param_names = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let var_names = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::with_capacity(equations.len());
        for equation in &equations {
            let expr = parse(equation).expect("Rossler equation should parse");
            bytecodes.push(compiler.compile(&expr));
        }

        let mut system = EquationSystem::new(bytecodes, vec![0.2, 0.2, 5.7]);
        system.set_maps(compiler.param_map, compiler.var_map);

        let equilibrium = solve_equilibrium(
            &system,
            SystemKind::Flow,
            &[0.0, 0.0, 0.0],
            NewtonSettings::default(),
        )
        .expect("Rossler equilibrium should converge");

        let settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-5,
            max_step_size: 0.1,
            max_steps: 100,
            corrector_steps: 4,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &equilibrium.state,
            0,
            settings,
            false,
        )
        .expect("Rossler backward continuation should succeed");

        let hopf_indices: Vec<i32> = branch
            .points
            .iter()
            .zip(branch.indices.iter())
            .filter(|(pt, _)| pt.stability == BifurcationType::Hopf)
            .map(|(_, idx)| *idx)
            .collect();

        assert_eq!(
            hopf_indices,
            vec![-9],
            "expected only Hopf at index -9, got {hopf_indices:?}"
        );
    }

    #[test]
    fn test_rossler_backward_extension_keeps_local_parameter_direction() {
        let equations = vec!["-y - z", "x + a * y", "b + z * (x - c)"];
        let param_names = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let var_names = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::with_capacity(equations.len());
        for equation in &equations {
            let expr = parse(equation).expect("Rossler equation should parse");
            bytecodes.push(compiler.compile(&expr));
        }

        let mut system = EquationSystem::new(bytecodes, vec![0.2, 0.2, 5.7]);
        system.set_maps(compiler.param_map, compiler.var_map);

        let equilibrium = solve_equilibrium(
            &system,
            SystemKind::Flow,
            &[0.0, 0.0, 0.0],
            NewtonSettings::default(),
        )
        .expect("Rossler equilibrium should converge");

        let settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-5,
            max_step_size: 0.1,
            max_steps: 40,
            corrector_steps: 4,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let seed_branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &equilibrium.state,
            0,
            settings,
            false,
        )
        .expect("Rossler backward continuation should succeed");

        let old_min_idx = *seed_branch.indices.iter().min().expect("minimum index");
        let endpoint_pos = seed_branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, idx)| *idx)
            .map(|(pos, _)| pos)
            .expect("endpoint position");
        let neighbor_pos = seed_branch
            .indices
            .iter()
            .enumerate()
            .filter(|(pos, _)| *pos != endpoint_pos)
            .min_by_key(|(_, idx)| *idx)
            .map(|(pos, _)| pos)
            .expect("neighbor position");

        let endpoint_param = seed_branch.points[endpoint_pos].param_value;
        let neighbor_param = seed_branch.points[neighbor_pos].param_value;
        let secant_param = endpoint_param - neighbor_param;
        assert!(
            secant_param.abs() > 1e-10,
            "Expected non-degenerate endpoint secant"
        );

        let extension = extend_branch(
            &mut system,
            SystemKind::Flow,
            seed_branch,
            0,
            ContinuationSettings {
                max_steps: 20,
                ..settings
            },
            false,
        )
        .expect("Rossler backward extension should succeed");

        let new_min_idx = *extension
            .indices
            .iter()
            .min()
            .expect("extended minimum index");
        assert!(
            new_min_idx < old_min_idx,
            "Expected backward extension to decrease minimum index"
        );

        let first_new_pos = extension
            .indices
            .iter()
            .position(|idx| *idx == old_min_idx - 1)
            .expect("first extended point index");
        let first_new_param = extension.points[first_new_pos].param_value;
        let first_delta = first_new_param - endpoint_param;
        assert!(
            first_delta * secant_param > 0.0,
            "First backward extension step doubled back: secant={}, delta={}",
            secant_param,
            first_delta
        );

        let mut side: Vec<(i32, f64)> = extension
            .indices
            .iter()
            .zip(extension.points.iter())
            .filter(|(idx, _)| **idx <= old_min_idx)
            .map(|(idx, pt)| (*idx, pt.param_value))
            .collect();
        side.sort_by(|a, b| b.0.cmp(&a.0));

        for window in side.windows(2) {
            let prev = window[0];
            let next = window[1];
            let step_delta = next.1 - prev.1;
            assert!(
                step_delta * secant_param >= -1e-9,
                "Backward extension changed direction between idx {} and {}: secant={}, step_delta={}",
                prev.0,
                next.0,
                secant_param,
                step_delta
            );
        }
    }

    #[test]
    fn test_rossler_forward_initialized_branch_extends_backward_from_min_index_side() {
        let equations = vec!["-y - z", "x + a * y", "b + z * (x - c)"];
        let param_names = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let var_names = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::with_capacity(equations.len());
        for equation in &equations {
            let expr = parse(equation).expect("Rossler equation should parse");
            bytecodes.push(compiler.compile(&expr));
        }

        let mut system = EquationSystem::new(bytecodes, vec![0.2, 0.2, 5.7]);
        system.set_maps(compiler.param_map, compiler.var_map);

        let equilibrium = solve_equilibrium(
            &system,
            SystemKind::Flow,
            &[0.0, 0.0, 0.0],
            NewtonSettings::default(),
        )
        .expect("Rossler equilibrium should converge");

        let settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-5,
            max_step_size: 0.1,
            max_steps: 120,
            corrector_steps: 4,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let forward_branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &equilibrium.state,
            0,
            settings,
            true,
        )
        .expect("Rossler forward continuation should succeed");

        let old_min_idx = *forward_branch.indices.iter().min().expect("minimum index");
        let old_max_idx = *forward_branch.indices.iter().max().expect("maximum index");
        assert_eq!(
            old_min_idx, 0,
            "forward-initialized branch should start at index 0"
        );

        let endpoint_pos = forward_branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, idx)| *idx)
            .map(|(pos, _)| pos)
            .expect("endpoint position");
        let neighbor_pos = forward_branch
            .indices
            .iter()
            .enumerate()
            .filter(|(pos, _)| *pos != endpoint_pos)
            .min_by_key(|(_, idx)| *idx)
            .map(|(pos, _)| pos)
            .expect("neighbor position");

        let endpoint_param = forward_branch.points[endpoint_pos].param_value;
        let neighbor_param = forward_branch.points[neighbor_pos].param_value;
        let secant_param = endpoint_param - neighbor_param;
        assert!(
            secant_param.abs() > 1e-10,
            "Expected non-degenerate endpoint secant"
        );

        let extended = extend_branch(
            &mut system,
            SystemKind::Flow,
            forward_branch,
            0,
            ContinuationSettings {
                max_steps: 40,
                ..settings
            },
            false,
        )
        .expect("Backward extension should succeed from forward-initialized branch");

        let new_min_idx = *extended
            .indices
            .iter()
            .min()
            .expect("extended minimum index");
        let new_max_idx = *extended
            .indices
            .iter()
            .max()
            .expect("extended maximum index");
        assert!(
            new_min_idx < old_min_idx,
            "Backward extension should decrease min index (old={}, new={})",
            old_min_idx,
            new_min_idx
        );
        assert_eq!(
            new_max_idx, old_max_idx,
            "Backward extension should preserve max index side"
        );

        let first_new_pos = extended
            .indices
            .iter()
            .position(|idx| *idx == old_min_idx - 1)
            .expect("first extended point index");
        let first_new_param = extended.points[first_new_pos].param_value;
        let first_delta = first_new_param - endpoint_param;
        assert!(
            first_delta * secant_param > 0.0,
            "Backward extension from forward-initialized branch doubled back: secant={}, delta={}",
            secant_param,
            first_delta
        );
    }

    #[test]
    fn test_map_neimark_sacker_detection() {
        let omega = 0.5;

        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0));
        ops0.push(OpCode::LoadVar(0));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::LoadConst(omega));
        ops0.push(OpCode::LoadVar(1));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::Sub);

        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadConst(omega));
        ops1.push(OpCode::LoadVar(0));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::LoadParam(0));
        ops1.push(OpCode::LoadVar(1));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::Add);

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let mut system = EquationSystem::new(equations, vec![0.5]);
        let mut problem =
            EquilibriumContinuationProblem::new(&mut system, SystemKind::Map { iterations: 1 }, 0);

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
    fn test_map_period_doubling_detection() {
        let mut ops = Vec::new();
        ops.push(OpCode::LoadParam(0));
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::Mul);

        let equations = vec![Bytecode { ops }];
        let mut system = EquationSystem::new(equations, vec![-0.5]);
        let mut problem =
            EquilibriumContinuationProblem::new(&mut system, SystemKind::Map { iterations: 1 }, 0);

        let aug_inside = DVector::from_vec(vec![-0.5, 0.0]);
        let inside = problem.diagnostics(&aug_inside).expect("diagnostics");
        assert!(
            inside.test_values.period_doubling > 0.0,
            "expected PD test to be positive before crossing, got {}",
            inside.test_values.period_doubling
        );

        let aug_outside = DVector::from_vec(vec![-1.5, 0.0]);
        let outside = problem.diagnostics(&aug_outside).expect("diagnostics");
        assert!(
            outside.test_values.period_doubling < 0.0,
            "expected PD test to be negative after crossing, got {}",
            outside.test_values.period_doubling
        );
    }

    #[test]
    fn test_map_pd_seed_doubles_cycle() {
        let mut ops = Vec::new();
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::Neg);

        let equations = vec![Bytecode { ops }];
        let mut system = EquationSystem::new(equations, vec![0.0]);
        let base_state = vec![0.0];

        let seed = map_cycle_seed_from_pd(&mut system, 0, &base_state, 0.0, 1, 0.2)
            .expect("PD map seed should build");
        assert!(
            seed[0].abs() > 1e-6,
            "expected nontrivial PD seed, got {:?}",
            seed
        );

        let mut next = vec![0.0];
        system.apply(0.0, &seed, &mut next);
        assert!(
            (next[0] - seed[0]).abs() > 1e-6,
            "expected 2-cycle to move after one iteration"
        );

        let mut next2 = vec![0.0];
        system.apply(0.0, &next, &mut next2);
        assert!(
            (next2[0] - seed[0]).abs() < 1e-6,
            "expected 2-cycle to return after two iterations"
        );
    }

    #[test]
    fn test_map_neimark_sacker_not_duplicated() {
        let omega = 0.5;

        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0));
        ops0.push(OpCode::LoadVar(0));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::LoadConst(omega));
        ops0.push(OpCode::LoadVar(1));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::Sub);

        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadConst(omega));
        ops1.push(OpCode::LoadVar(0));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::LoadParam(0));
        ops1.push(OpCode::LoadVar(1));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::Add);

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let mut system = EquationSystem::new(equations, vec![0.5]);

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 30,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &[0.0, 0.0],
            0,
            settings,
            true,
        )
        .expect("continuation should succeed");

        let ns_indices: Vec<usize> = branch
            .bifurcations
            .iter()
            .copied()
            .filter(|&idx| branch.points[idx].stability == BifurcationType::NeimarkSacker)
            .collect();

        assert_eq!(
            ns_indices.len(),
            1,
            "expected single Neimark-Sacker detection, got indices {ns_indices:?}"
        );
    }

    #[test]
    fn test_logistic_map_period_doubling_detection() {
        let equation = "r * x * (1 - x)";
        let param_names = vec!["r".to_string()];
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("logistic map equation should parse");
        let bytecode = compiler.compile(&expr);

        let mut system = EquationSystem::new(vec![bytecode], vec![2.5]);
        system.set_maps(compiler.param_map, compiler.var_map);

        let equilibrium = solve_equilibrium(
            &system,
            SystemKind::Map { iterations: 1 },
            &[1.0],
            NewtonSettings::default(),
        )
        .expect("logistic map fixed point should converge");

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 30,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Map { iterations: 1 },
            &equilibrium.state,
            0,
            settings,
            true,
        )
        .expect("continuation should succeed");

        let pd_indices: Vec<usize> = branch
            .bifurcations
            .iter()
            .copied()
            .filter(|&idx| branch.points[idx].stability == BifurcationType::PeriodDoubling)
            .collect();

        assert_eq!(
            pd_indices.len(),
            1,
            "expected single PD detection, got indices {pd_indices:?}"
        );

        let pd_param = branch.points[pd_indices[0]].param_value;
        assert!(
            (pd_param - 3.0).abs() < 1e-2,
            "expected PD near r=3, got r={}",
            pd_param
        );
    }
}
