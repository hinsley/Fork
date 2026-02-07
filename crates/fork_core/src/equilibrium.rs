use crate::{autodiff::Dual, equation_engine::EquationSystem, traits::DynamicalSystem};
use anyhow::{anyhow, bail, Context, Result};
use nalgebra::linalg::SVD;
use nalgebra::{Complex, DMatrix, DVector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SystemKind {
    Flow,
    Map { iterations: usize },
}

impl SystemKind {
    pub fn is_flow(&self) -> bool {
        matches!(self, SystemKind::Flow)
    }

    pub fn is_map(&self) -> bool {
        matches!(self, SystemKind::Map { .. })
    }

    pub fn map_iterations(&self) -> usize {
        match self {
            SystemKind::Map { iterations } => *iterations,
            SystemKind::Flow => 1,
        }
    }

    pub fn checked_map_iterations(&self) -> Result<usize> {
        let iterations = self.map_iterations();
        if self.is_map() && iterations == 0 {
            bail!("Map iteration count must be greater than zero.");
        }
        Ok(iterations)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NewtonSettings {
    pub max_steps: usize,
    pub damping: f64,
    pub tolerance: f64,
}

impl Default for NewtonSettings {
    fn default() -> Self {
        Self {
            max_steps: 25,
            damping: 1.0,
            tolerance: 1e-9,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplexNumber {
    pub re: f64,
    pub im: f64,
}

impl From<Complex<f64>> for ComplexNumber {
    fn from(value: Complex<f64>) -> Self {
        Self {
            re: value.re,
            im: value.im,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EigenPair {
    pub value: ComplexNumber,
    pub vector: Vec<ComplexNumber>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquilibriumResult {
    pub state: Vec<f64>,
    pub residual_norm: f64,
    pub iterations: usize,
    pub jacobian: Vec<f64>,
    pub eigenpairs: Vec<EigenPair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cycle_points: Option<Vec<Vec<f64>>>,
}

pub fn solve_equilibrium(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
) -> Result<EquilibriumResult> {
    let map_iterations = kind.checked_map_iterations()?;
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System has zero dimension.");
    }
    if initial_guess.len() != dim {
        bail!(
            "Initial guess dimension mismatch. Expected {}, got {}.",
            dim,
            initial_guess.len()
        );
    }
    if settings.max_steps == 0 {
        bail!("max_steps must be greater than zero.");
    }
    if settings.damping <= 0.0 {
        bail!("damping must be positive.");
    }
    if settings.tolerance <= 0.0 {
        bail!("tolerance must be positive.");
    }

    let mut state = initial_guess.to_vec();
    let mut residual = vec![0.0; dim];
    evaluate_equilibrium_residual(system, kind, &state, &mut residual)?;
    let mut residual_norm = l2_norm(&residual);
    let mut iterations = 0usize;

    loop {
        if residual_norm <= settings.tolerance {
            break;
        }

        if iterations >= settings.max_steps {
            bail!(
                "Newton solver failed to converge in {} steps (||f(x)|| = {}).",
                settings.max_steps,
                residual_norm
            );
        }

        let jacobian = compute_jacobian(system, kind, &state)?;
        let delta = solve_linear_system(dim, &jacobian, &residual)
            .context("Failed to solve linear system during Newton iteration.")?;

        for i in 0..dim {
            state[i] -= settings.damping * delta[i];
        }

        iterations += 1;
        evaluate_equilibrium_residual(system, kind, &state, &mut residual)?;
        residual_norm = l2_norm(&residual);
    }

    let jacobian = compute_system_jacobian(system, kind, &state)?;
    let eigenpairs = compute_eigenpairs(dim, &jacobian)
        .context("Failed to compute eigenvalues/eigenvectors of Jacobian.")?;
    let cycle_points = if kind.is_map() && map_iterations > 1 {
        Some(compute_map_cycle_points(system, &state, map_iterations))
    } else {
        None
    };

    Ok(EquilibriumResult {
        state,
        residual_norm,
        iterations,
        jacobian,
        eigenpairs,
        cycle_points,
    })
}

pub fn evaluate_equilibrium_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) -> Result<()> {
    let iterations = kind.checked_map_iterations()?;
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map { .. } => {
            iterate_map(system, state, iterations, out);
            for i in 0..out.len() {
                out[i] -= state[i];
            }
        }
    }
    Ok(())
}

pub fn compute_param_jacobian(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    param_index: usize,
) -> Result<Vec<f64>> {
    let iterations = kind.checked_map_iterations()?;
    match kind {
        SystemKind::Flow => {
            let dim = system.equations.len();
            let mut f_dual = vec![Dual::new(0.0, 0.0); dim];
            system.evaluate_dual_wrt_param(state, param_index, &mut f_dual);
            Ok(f_dual.iter().map(|value| value.eps).collect())
        }
        SystemKind::Map { .. } => {
            compute_map_iterate_param_jacobian(system, state, param_index, iterations)
        }
    }
}

pub fn compute_jacobian(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
) -> Result<Vec<f64>> {
    let dim = system.equations.len();
    let mut jacobian = compute_system_jacobian(system, kind, state)?;
    if kind.is_map() {
        for i in 0..dim {
            jacobian[i * dim + i] -= 1.0;
        }
    }

    Ok(jacobian)
}

pub fn compute_system_jacobian(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
) -> Result<Vec<f64>> {
    let iterations = kind.checked_map_iterations()?;
    match kind {
        SystemKind::Flow => compute_single_step_jacobian(system, state),
        SystemKind::Map { .. } => compute_map_iterate_jacobian(system, state, iterations),
    }
}

fn compute_single_step_jacobian(system: &EquationSystem, state: &[f64]) -> Result<Vec<f64>> {
    let dim = system.equations.len();
    let mut jacobian = vec![0.0; dim * dim];
    let mut dual_state = vec![Dual::new(0.0, 0.0); dim];
    let mut dual_out = vec![Dual::new(0.0, 0.0); dim];
    let t_dual = Dual::new(0.0, 0.0);

    for j in 0..dim {
        for i in 0..dim {
            dual_state[i] = Dual::new(state[i], if i == j { 1.0 } else { 0.0 });
        }
        system.apply(t_dual, &dual_state, &mut dual_out);
        for i in 0..dim {
            jacobian[i * dim + j] = dual_out[i].eps;
        }
    }

    Ok(jacobian)
}

fn iterate_map(system: &EquationSystem, state: &[f64], iterations: usize, out: &mut [f64]) {
    let dim = out.len();
    let mut current = state.to_vec();
    let mut next = vec![0.0; dim];
    for _ in 0..iterations {
        system.apply(0.0, &current, &mut next);
        std::mem::swap(&mut current, &mut next);
    }
    out.copy_from_slice(&current);
}

pub(crate) fn compute_map_cycle_points(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
) -> Vec<Vec<f64>> {
    if iterations == 0 {
        return Vec::new();
    }
    let dim = system.equations.len();
    let mut points = Vec::with_capacity(iterations);
    let mut current = state.to_vec();
    let mut next = vec![0.0; dim];
    points.push(current.clone());
    for _ in 1..iterations {
        system.apply(0.0, &current, &mut next);
        std::mem::swap(&mut current, &mut next);
        points.push(current.clone());
    }
    points
}

fn compute_map_iterate_jacobian(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
) -> Result<Vec<f64>> {
    if iterations == 1 {
        return compute_single_step_jacobian(system, state);
    }

    let dim = system.equations.len();
    let mut total = vec![0.0; dim * dim];
    for i in 0..dim {
        total[i * dim + i] = 1.0;
    }

    let mut current = state.to_vec();
    let mut next_state = vec![0.0; dim];
    let mut next_total = vec![0.0; dim * dim];

    for _ in 0..iterations {
        let step = compute_single_step_jacobian(system, &current)?;
        mat_mul(dim, &step, &total, &mut next_total);
        total.copy_from_slice(&next_total);
        system.apply(0.0, &current, &mut next_state);
        std::mem::swap(&mut current, &mut next_state);
    }

    Ok(total)
}

fn compute_map_iterate_param_jacobian(
    system: &EquationSystem,
    state: &[f64],
    param_index: usize,
    iterations: usize,
) -> Result<Vec<f64>> {
    let dim = system.equations.len();
    let mut sensitivity = vec![0.0; dim];
    let mut current = state.to_vec();
    let mut next_state = vec![0.0; dim];
    let mut next_sensitivity = vec![0.0; dim];
    let mut f_dual = vec![Dual::new(0.0, 0.0); dim];

    for _ in 0..iterations {
        system.evaluate_dual_wrt_param(&current, param_index, &mut f_dual);
        let step_param: Vec<f64> = f_dual.iter().map(|value| value.eps).collect();
        let step_jac = compute_single_step_jacobian(system, &current)?;
        mat_vec_mul(dim, &step_jac, &sensitivity, &mut next_sensitivity);
        for i in 0..dim {
            next_sensitivity[i] += step_param[i];
        }
        sensitivity.copy_from_slice(&next_sensitivity);
        system.apply(0.0, &current, &mut next_state);
        std::mem::swap(&mut current, &mut next_state);
    }

    Ok(sensitivity)
}

fn mat_mul(dim: usize, left: &[f64], right: &[f64], out: &mut [f64]) {
    for row in 0..dim {
        for col in 0..dim {
            let mut sum = 0.0;
            for k in 0..dim {
                sum += left[row * dim + k] * right[k * dim + col];
            }
            out[row * dim + col] = sum;
        }
    }
}

fn mat_vec_mul(dim: usize, mat: &[f64], vec: &[f64], out: &mut [f64]) {
    for row in 0..dim {
        let mut sum = 0.0;
        for col in 0..dim {
            sum += mat[row * dim + col] * vec[col];
        }
        out[row] = sum;
    }
}

fn solve_linear_system(dim: usize, jacobian: &[f64], residual: &[f64]) -> Result<Vec<f64>> {
    let j_matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let rhs = DVector::from_column_slice(residual);
    j_matrix
        .lu()
        .solve(&rhs)
        .map(|v| v.iter().cloned().collect())
        .ok_or_else(|| anyhow!("Jacobian is singular."))
}

fn compute_eigenpairs(dim: usize, jacobian: &[f64]) -> Result<Vec<EigenPair>> {
    let matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let eigenvalues = matrix.complex_eigenvalues();
    let complex_matrix = matrix.map(|v| Complex::new(v, 0.0));

    let mut pairs = Vec::with_capacity(dim);
    for idx in 0..dim {
        let lambda = eigenvalues[idx];

        let mut shifted = complex_matrix.clone();
        for i in 0..dim {
            shifted[(i, i)] -= lambda;
        }

        let svd = SVD::new(shifted, true, true);
        let v_t = svd
            .v_t
            .ok_or_else(|| anyhow!("Failed to compute eigenvector for eigenvalue index {}", idx))?;
        let row_index = v_t.nrows().saturating_sub(1);
        let row = v_t.row(row_index);
        let mut vector: Vec<Complex<f64>> = row.iter().map(|c| *c).collect();
        normalize_complex_vector(&mut vector);

        pairs.push(EigenPair {
            value: ComplexNumber::from(lambda),
            vector: vector.into_iter().map(ComplexNumber::from).collect(),
        });
    }
    Ok(pairs)
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|v| v * v).sum::<f64>().sqrt()
}

fn normalize_complex_vector(vec: &mut [Complex<f64>]) {
    let norm = vec.iter().map(|c| c.norm_sqr()).sum::<f64>().sqrt();
    if norm > 0.0 {
        for entry in vec {
            *entry /= norm;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_jacobian, compute_map_cycle_points, solve_equilibrium, NewtonSettings, SystemKind,
    };
    use crate::equation_engine::{parse, Compiler, EquationSystem};

    fn assert_err_contains<T: std::fmt::Debug>(result: anyhow::Result<T>, needle: &str) {
        let err = result.expect_err("expected error");
        let messages: Vec<String> = err.chain().map(|cause| cause.to_string()).collect();
        let found = messages.iter().any(|message| message.contains(needle));
        assert!(
            found,
            "expected error to contain \"{needle}\", got {messages:?}"
        );
    }

    fn build_mu_system(mu: f64) -> EquationSystem {
        let equation = "mu * x";
        let param_names = vec!["mu".to_string()];
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("simple equation should parse");
        let bytecode = compiler.compile(&expr);

        let mut system = EquationSystem::new(vec![bytecode], vec![mu]);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    fn build_constant_system(value: f64) -> EquationSystem {
        let equation = format!("{value}");
        let param_names: Vec<String> = Vec::new();
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(&equation).expect("constant equation should parse");
        let bytecode = compiler.compile(&expr);

        let mut system = EquationSystem::new(vec![bytecode], Vec::new());
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    #[test]
    fn tent_map_default_system_eigenvalue_matches_map_jacobian() {
        // Matches the TentMap entry in web/src/system/defaultSystems.ts.
        let equation = "mu * (0.5 - (((x - 0.5) ^ 2) ^ 0.5))";
        let param_names = vec!["mu".to_string()];
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("tent map equation should parse");
        let bytecode = compiler.compile(&expr);

        let mut system = EquationSystem::new(vec![bytecode], vec![2.0]);
        system.set_maps(compiler.param_map, compiler.var_map);

        let result = solve_equilibrium(
            &system,
            SystemKind::Map { iterations: 1 },
            &[0.6],
            NewtonSettings::default(),
        )
        .expect("tent map fixed point should converge");

        assert_eq!(result.eigenpairs.len(), 1);
        let eig = result.eigenpairs[0].value.re;
        assert!(
            (eig + 2.0).abs() < 1e-9,
            "expected eigenvalue near -2, got {}",
            eig
        );
    }

    #[test]
    fn compute_jacobian_adjusts_map_identity() {
        let system = build_mu_system(2.0);

        let flow_jac = compute_jacobian(&system, SystemKind::Flow, &[1.0])
            .expect("flow jacobian should compute");
        let map_jac = compute_jacobian(&system, SystemKind::Map { iterations: 1 }, &[1.0])
            .expect("map jacobian should compute");

        assert!((flow_jac[0] - 2.0).abs() < 1e-12);
        assert!((map_jac[0] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn compute_map_cycle_points_tracks_iterates() {
        let equation = "1 - x";
        let param_names: Vec<String> = Vec::new();
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("map equation should parse");
        let bytecode = compiler.compile(&expr);

        let mut system = EquationSystem::new(vec![bytecode], Vec::new());
        system.set_maps(compiler.param_map, compiler.var_map);

        let points = compute_map_cycle_points(&system, &[0.2], 3);
        assert_eq!(points.len(), 3);
        assert!((points[0][0] - 0.2).abs() < 1e-12);
        assert!((points[1][0] - 0.8).abs() < 1e-12);
        assert!((points[2][0] - 0.2).abs() < 1e-12);
    }

    #[test]
    fn solve_equilibrium_rejects_invalid_settings() {
        let system = build_mu_system(2.0);
        assert_err_contains(
            solve_equilibrium(
                &system,
                SystemKind::Flow,
                &[1.0, 2.0],
                NewtonSettings::default(),
            ),
            "dimension mismatch",
        );
        assert_err_contains(
            solve_equilibrium(
                &system,
                SystemKind::Flow,
                &[1.0],
                NewtonSettings {
                    max_steps: 0,
                    ..NewtonSettings::default()
                },
            ),
            "max_steps",
        );
        assert_err_contains(
            solve_equilibrium(
                &system,
                SystemKind::Flow,
                &[1.0],
                NewtonSettings {
                    damping: 0.0,
                    ..NewtonSettings::default()
                },
            ),
            "damping",
        );
        assert_err_contains(
            solve_equilibrium(
                &system,
                SystemKind::Flow,
                &[1.0],
                NewtonSettings {
                    tolerance: 0.0,
                    ..NewtonSettings::default()
                },
            ),
            "tolerance",
        );
    }

    #[test]
    fn solve_equilibrium_converges_for_linear_flow() {
        let system = build_mu_system(1.0);
        let result =
            solve_equilibrium(&system, SystemKind::Flow, &[0.2], NewtonSettings::default())
                .expect("linear flow equilibrium should converge");
        assert_eq!(result.state.len(), 1);
        assert!(result.state[0].abs() < 1e-9);
        assert!(result.residual_norm <= 1e-9);
        assert_eq!(result.iterations, 1);
    }

    #[test]
    fn solve_equilibrium_rejects_zero_dimension_system() {
        let system = EquationSystem::new(Vec::new(), Vec::new());
        assert_err_contains(
            solve_equilibrium(&system, SystemKind::Flow, &[], NewtonSettings::default()),
            "zero dimension",
        );
    }

    #[test]
    fn solve_equilibrium_rejects_singular_jacobian() {
        let system = build_constant_system(1.0);
        assert_err_contains(
            solve_equilibrium(&system, SystemKind::Flow, &[0.0], NewtonSettings::default()),
            "Jacobian is singular",
        );
    }
}
