use crate::{
    autodiff::Dual, equation_engine::EquationSystem, state_periodicity::StatePeriodicity,
    traits::DynamicalSystem,
};
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DeflationSettings {
    pub exponent: f64,
    pub shift: f64,
}

impl Default for DeflationSettings {
    fn default() -> Self {
        Self {
            exponent: 2.0,
            shift: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeflationTarget {
    pub root: Vec<f64>,
    pub settings: DeflationSettings,
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
    solve_equilibrium_with_periodicity(
        system,
        kind,
        initial_guess,
        settings,
        &StatePeriodicity::none(),
    )
}

pub fn solve_equilibrium_with_deflation(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
    deflated_roots: &[Vec<f64>],
    deflation: DeflationSettings,
) -> Result<EquilibriumResult> {
    let targets = deflated_roots
        .iter()
        .cloned()
        .map(|root| DeflationTarget {
            root,
            settings: deflation,
        })
        .collect::<Vec<_>>();
    solve_equilibrium_with_deflation_targets_and_periodicity(
        system,
        kind,
        initial_guess,
        settings,
        &targets,
        &StatePeriodicity::none(),
    )
}

pub fn solve_equilibrium_with_deflation_targets(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
    deflation_targets: &[DeflationTarget],
) -> Result<EquilibriumResult> {
    solve_equilibrium_with_deflation_targets_and_periodicity(
        system,
        kind,
        initial_guess,
        settings,
        deflation_targets,
        &StatePeriodicity::none(),
    )
}

pub fn solve_equilibrium_with_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
    periodicity: &StatePeriodicity,
) -> Result<EquilibriumResult> {
    solve_equilibrium_with_deflation_and_periodicity(
        system,
        kind,
        initial_guess,
        settings,
        &[],
        DeflationSettings::default(),
        periodicity,
    )
}

pub fn solve_equilibrium_with_deflation_and_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
    deflated_roots: &[Vec<f64>],
    deflation: DeflationSettings,
    periodicity: &StatePeriodicity,
) -> Result<EquilibriumResult> {
    let targets = deflated_roots
        .iter()
        .cloned()
        .map(|root| DeflationTarget {
            root,
            settings: deflation,
        })
        .collect::<Vec<_>>();
    solve_equilibrium_with_deflation_targets_and_periodicity(
        system,
        kind,
        initial_guess,
        settings,
        &targets,
        periodicity,
    )
}

pub fn solve_equilibrium_with_deflation_targets_and_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
    deflation_targets: &[DeflationTarget],
    periodicity: &StatePeriodicity,
) -> Result<EquilibriumResult> {
    let map_iterations = kind.checked_map_iterations()?;
    let dim = system.equations().len();
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
    validate_deflation_targets(deflation_targets, dim)?;

    let mut state = initial_guess.to_vec();
    periodicity.wrap_state(&mut state);
    let mut residual = vec![0.0; dim];
    evaluate_equilibrium_residual_with_periodicity(
        system,
        kind,
        &state,
        &mut residual,
        periodicity,
    )?;
    let mut residual_norm = l2_norm(&residual);
    let mut deflation_evaluation =
        evaluate_deflation(&state, &residual, deflation_targets, periodicity)?;
    let mut iterations = 0usize;

    loop {
        if deflation_evaluation.residual_norm <= settings.tolerance {
            break;
        }

        if iterations >= settings.max_steps {
            if deflation_targets.is_empty() {
                bail!(
                    "Newton solver failed to converge in {} steps (||f(x)|| = {}).",
                    settings.max_steps,
                    residual_norm
                );
            }
            bail!(
                "Deflated Newton solver failed to converge in {} steps (deflated residual = {}, original residual = {}).",
                settings.max_steps,
                deflation_evaluation.residual_norm,
                residual_norm
            );
        }

        let mut jacobian = compute_jacobian_with_periodicity(system, kind, &state, periodicity)?;
        apply_deflation_gradient(
            dim,
            &residual,
            &deflation_evaluation.log_gradient,
            &mut jacobian,
        );
        let delta = solve_linear_system(dim, &jacobian, &residual)
            .context("Failed to solve linear system during Newton iteration.")?;

        for i in 0..dim {
            state[i] -= settings.damping * delta[i];
        }
        periodicity.wrap_state(&mut state);

        iterations += 1;
        evaluate_equilibrium_residual_with_periodicity(
            system,
            kind,
            &state,
            &mut residual,
            periodicity,
        )?;
        residual_norm = l2_norm(&residual);
        deflation_evaluation =
            evaluate_deflation(&state, &residual, deflation_targets, periodicity)?;
    }

    let jacobian = compute_system_jacobian_with_periodicity(system, kind, &state, periodicity)?;
    let eigenpairs = compute_eigenpairs(dim, &jacobian)
        .context("Failed to compute eigenvalues/eigenvectors of Jacobian.")?;
    let cycle_points = if kind.is_map() && map_iterations > 1 {
        Some(compute_map_cycle_points_with_periodicity(
            system,
            &state,
            map_iterations,
            periodicity,
        ))
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

pub fn compute_deflated_residual_norm(
    state: &[f64],
    residual: &[f64],
    deflated_roots: &[Vec<f64>],
    deflation: DeflationSettings,
    periodicity: &StatePeriodicity,
) -> Result<f64> {
    let targets = deflated_roots
        .iter()
        .cloned()
        .map(|root| DeflationTarget {
            root,
            settings: deflation,
        })
        .collect::<Vec<_>>();
    compute_deflated_residual_norm_with_targets(state, residual, &targets, periodicity)
}

pub fn compute_deflated_residual_norm_with_targets(
    state: &[f64],
    residual: &[f64],
    deflation_targets: &[DeflationTarget],
    periodicity: &StatePeriodicity,
) -> Result<f64> {
    validate_deflation_targets(deflation_targets, state.len())?;
    if residual.len() != state.len() {
        bail!(
            "Residual dimension mismatch for deflation. Expected {}, got {}.",
            state.len(),
            residual.len()
        );
    }
    Ok(evaluate_deflation(state, residual, deflation_targets, periodicity)?.residual_norm)
}

pub fn apply_deflation_to_jacobian(
    state: &[f64],
    residual: &[f64],
    jacobian: &mut [f64],
    deflated_roots: &[Vec<f64>],
    deflation: DeflationSettings,
    periodicity: &StatePeriodicity,
) -> Result<()> {
    let targets = deflated_roots
        .iter()
        .cloned()
        .map(|root| DeflationTarget {
            root,
            settings: deflation,
        })
        .collect::<Vec<_>>();
    apply_deflation_targets_to_jacobian(state, residual, jacobian, &targets, periodicity)
}

pub fn apply_deflation_targets_to_jacobian(
    state: &[f64],
    residual: &[f64],
    jacobian: &mut [f64],
    deflation_targets: &[DeflationTarget],
    periodicity: &StatePeriodicity,
) -> Result<()> {
    validate_deflation_targets(deflation_targets, state.len())?;
    if residual.len() != state.len() {
        bail!(
            "Residual dimension mismatch for deflation. Expected {}, got {}.",
            state.len(),
            residual.len()
        );
    }
    if jacobian.len() != state.len() * state.len() {
        bail!(
            "Jacobian dimension mismatch for deflation. Expected {}, got {}.",
            state.len() * state.len(),
            jacobian.len()
        );
    }
    let evaluation = evaluate_deflation(state, residual, deflation_targets, periodicity)?;
    apply_deflation_gradient(state.len(), residual, &evaluation.log_gradient, jacobian);
    Ok(())
}

struct DeflationEvaluation {
    residual_norm: f64,
    log_gradient: Vec<f64>,
}

fn validate_deflation_settings(settings: DeflationSettings) -> Result<()> {
    if !settings.exponent.is_finite() || settings.exponent < 1.0 {
        bail!("Deflation exponent must be finite and at least 1.");
    }
    if !settings.shift.is_finite() || settings.shift < 0.0 {
        bail!("Deflation shift must be finite and non-negative.");
    }
    Ok(())
}

fn validate_deflation_targets(deflation_targets: &[DeflationTarget], dim: usize) -> Result<()> {
    for (index, target) in deflation_targets.iter().enumerate() {
        validate_deflation_settings(target.settings)?;
        if target.root.len() != dim {
            bail!(
                "Deflation target dimension mismatch at index {}. Expected {}, got {}.",
                index,
                dim,
                target.root.len()
            );
        }
        if target.root.iter().any(|value| !value.is_finite()) {
            bail!(
                "Deflation target at index {} contains a non-finite value.",
                index
            );
        }
    }
    Ok(())
}

fn evaluate_deflation(
    state: &[f64],
    residual: &[f64],
    deflation_targets: &[DeflationTarget],
    periodicity: &StatePeriodicity,
) -> Result<DeflationEvaluation> {
    let original_norm = l2_norm(residual);
    if deflation_targets.is_empty() {
        return Ok(DeflationEvaluation {
            residual_norm: original_norm,
            log_gradient: vec![0.0; state.len()],
        });
    }

    let mut log_multiplier = 0.0;
    let mut log_gradient = vec![0.0; state.len()];
    for (root_index, target) in deflation_targets.iter().enumerate() {
        let root = &target.root;
        let settings = target.settings;
        let deltas = state
            .iter()
            .zip(root)
            .enumerate()
            .map(|(index, (value, target))| periodicity.wrapped_delta(index, value - target))
            .collect::<Vec<_>>();
        let distance_squared = deltas.iter().map(|value| value * value).sum::<f64>();
        if distance_squared <= f64::MIN_POSITIVE {
            bail!(
                "Newton iterate coincides with deflation target {}. Change the initial guess slightly.",
                root_index + 1
            );
        }

        let log_distance = 0.5 * distance_squared.ln();
        let log_inverse_power = -settings.exponent * log_distance;
        let log_factor = if settings.shift == 0.0 {
            log_inverse_power
        } else {
            log_add_exp(log_inverse_power, settings.shift.ln())
        };
        log_multiplier += log_factor;

        let inverse_weight = if settings.shift == 0.0 {
            1.0
        } else {
            inverse_one_plus_exp(settings.shift.ln() - log_inverse_power)
        };
        let coefficient = -settings.exponent * inverse_weight / distance_squared;
        for (index, delta) in deltas.iter().enumerate() {
            log_gradient[index] += coefficient * delta;
        }
    }

    let residual_norm = if original_norm == 0.0 {
        0.0
    } else {
        let log_norm = original_norm.ln() + log_multiplier;
        if log_norm >= f64::MAX.ln() {
            f64::INFINITY
        } else {
            log_norm.exp()
        }
    };

    Ok(DeflationEvaluation {
        residual_norm,
        log_gradient,
    })
}

fn apply_deflation_gradient(
    dim: usize,
    residual: &[f64],
    log_gradient: &[f64],
    jacobian: &mut [f64],
) {
    for row in 0..dim {
        for col in 0..dim {
            jacobian[row * dim + col] += residual[row] * log_gradient[col];
        }
    }
}

fn log_add_exp(left: f64, right: f64) -> f64 {
    let maximum = left.max(right);
    maximum + ((left - maximum).exp() + (right - maximum).exp()).ln()
}

fn inverse_one_plus_exp(value: f64) -> f64 {
    if value >= 0.0 {
        let inverse = (-value).exp();
        inverse / (1.0 + inverse)
    } else {
        1.0 / (1.0 + value.exp())
    }
}

pub fn evaluate_equilibrium_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) -> Result<()> {
    evaluate_equilibrium_residual_with_periodicity(
        system,
        kind,
        state,
        out,
        &StatePeriodicity::none(),
    )
}

pub fn evaluate_equilibrium_residual_with_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
    periodicity: &StatePeriodicity,
) -> Result<()> {
    let iterations = kind.checked_map_iterations()?;
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map { .. } => {
            iterate_map_with_periodicity(system, state, iterations, out, periodicity);
            for i in 0..out.len() {
                out[i] = periodicity.wrapped_delta(i, out[i] - state[i]);
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
            let dim = system.equations().len();
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
    compute_jacobian_with_periodicity(system, kind, state, &StatePeriodicity::none())
}

pub fn compute_jacobian_with_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    periodicity: &StatePeriodicity,
) -> Result<Vec<f64>> {
    let dim = system.equations().len();
    let mut jacobian = compute_system_jacobian_with_periodicity(system, kind, state, periodicity)?;
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
    compute_system_jacobian_with_periodicity(system, kind, state, &StatePeriodicity::none())
}

pub fn compute_system_jacobian_with_periodicity(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    periodicity: &StatePeriodicity,
) -> Result<Vec<f64>> {
    let iterations = kind.checked_map_iterations()?;
    match kind {
        SystemKind::Flow => compute_single_step_jacobian(system, state),
        SystemKind::Map { .. } => {
            compute_map_iterate_jacobian(system, state, iterations, periodicity)
        }
    }
}

fn compute_single_step_jacobian(system: &EquationSystem, state: &[f64]) -> Result<Vec<f64>> {
    let dim = system.equations().len();
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

fn iterate_map_with_periodicity(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
    out: &mut [f64],
    periodicity: &StatePeriodicity,
) {
    let dim = out.len();
    let mut current = state.to_vec();
    periodicity.wrap_state(&mut current);
    let mut next = vec![0.0; dim];
    for _ in 0..iterations {
        system.apply(0.0, &current, &mut next);
        periodicity.wrap_state(&mut next);
        std::mem::swap(&mut current, &mut next);
    }
    out.copy_from_slice(&current);
}

pub fn compute_map_cycle_points(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
) -> Vec<Vec<f64>> {
    compute_map_cycle_points_with_periodicity(system, state, iterations, &StatePeriodicity::none())
}

pub fn compute_map_cycle_points_with_periodicity(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
    periodicity: &StatePeriodicity,
) -> Vec<Vec<f64>> {
    if iterations == 0 {
        return Vec::new();
    }
    let dim = system.equations().len();
    let mut points = Vec::with_capacity(iterations);
    let mut current = state.to_vec();
    periodicity.wrap_state(&mut current);
    let mut next = vec![0.0; dim];
    points.push(current.clone());
    for _ in 1..iterations {
        system.apply(0.0, &current, &mut next);
        periodicity.wrap_state(&mut next);
        std::mem::swap(&mut current, &mut next);
        points.push(current.clone());
    }
    points
}

fn compute_map_iterate_jacobian(
    system: &EquationSystem,
    state: &[f64],
    iterations: usize,
    periodicity: &StatePeriodicity,
) -> Result<Vec<f64>> {
    if iterations == 1 {
        return compute_single_step_jacobian(system, state);
    }

    let dim = system.equations().len();
    let mut total = vec![0.0; dim * dim];
    for i in 0..dim {
        total[i * dim + i] = 1.0;
    }

    let mut current = state.to_vec();
    periodicity.wrap_state(&mut current);
    let mut next_state = vec![0.0; dim];
    let mut next_total = vec![0.0; dim * dim];

    for _ in 0..iterations {
        let step = compute_single_step_jacobian(system, &current)?;
        mat_mul(dim, &step, &total, &mut next_total);
        total.copy_from_slice(&next_total);
        system.apply(0.0, &current, &mut next_state);
        periodicity.wrap_state(&mut next_state);
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
    let dim = system.equations().len();
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
        compute_deflated_residual_norm, compute_deflated_residual_norm_with_targets,
        compute_jacobian, compute_map_cycle_points, evaluate_equilibrium_residual_with_periodicity,
        solve_equilibrium, solve_equilibrium_with_deflation, solve_equilibrium_with_periodicity,
        DeflationSettings, DeflationTarget, NewtonSettings, SystemKind,
    };
    use crate::equation_engine::{parse, Compiler, EquationSystem};
    use crate::state_periodicity::StatePeriodicity;

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

    fn build_logistic_system(mu: f64) -> EquationSystem {
        let equation = "mu * x * (1 - x)";
        let param_names = vec!["mu".to_string()];
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("logistic equation should parse");
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

    fn build_scalar_system(equation: &str) -> EquationSystem {
        let param_names: Vec<String> = Vec::new();
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("scalar equation should parse");
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
    fn periodic_map_residual_uses_short_wrapped_displacement() {
        let system = build_constant_system(0.05);
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);
        let mut residual = vec![0.0];

        evaluate_equilibrium_residual_with_periodicity(
            &system,
            SystemKind::Map { iterations: 1 },
            &[0.95],
            &mut residual,
            &periodicity,
        )
        .expect("periodic residual should compute");

        assert!((residual[0] - 0.1_f64).abs() < 1e-12);
    }

    #[test]
    fn periodic_map_solve_wraps_state_and_cycle_points() {
        let equation = "x + 1";
        let param_names: Vec<String> = Vec::new();
        let var_names = vec!["x".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let expr = parse(equation).expect("map equation should parse");
        let bytecode = compiler.compile(&expr);
        let mut system = EquationSystem::new(vec![bytecode], Vec::new());
        system.set_maps(compiler.param_map, compiler.var_map);
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);

        let result = solve_equilibrium_with_periodicity(
            &system,
            SystemKind::Map { iterations: 2 },
            &[1.2],
            NewtonSettings::default(),
            &periodicity,
        )
        .expect("periodic identity map should converge");

        assert!((result.state[0] - 0.2).abs() < 1e-12);
        assert!(result.residual_norm < 1e-12);
        assert_eq!(result.cycle_points.as_ref().map(Vec::len), Some(2));
        let points = result.cycle_points.expect("cycle points");
        assert!((points[0][0] - 0.2).abs() < 1e-12);
        assert!((points[1][0] - 0.2).abs() < 1e-12);
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
    fn deflation_avoids_a_selected_flow_equilibrium() {
        let system = build_scalar_system("x^2 - 1");
        let settings = NewtonSettings::default();

        let ordinary = solve_equilibrium(&system, SystemKind::Flow, &[0.2], settings)
            .expect("ordinary solve should converge");
        assert!((ordinary.state[0] - 1.0).abs() < 1e-8);

        let deflated = solve_equilibrium_with_deflation(
            &system,
            SystemKind::Flow,
            &[0.2],
            settings,
            &[vec![1.0]],
            DeflationSettings::default(),
        )
        .expect("deflated solve should converge to the other equilibrium");

        assert!((deflated.state[0] + 1.0).abs() < 1e-8);
        assert!(deflated.residual_norm <= settings.tolerance);
    }

    #[test]
    fn deflation_applies_to_a_period_one_map_cycle() {
        let system = build_logistic_system(3.2);
        let settings = NewtonSettings {
            max_steps: 50,
            ..NewtonSettings::default()
        };

        let result = solve_equilibrium_with_deflation(
            &system,
            SystemKind::Map { iterations: 1 },
            &[0.2],
            settings,
            &[vec![0.0]],
            DeflationSettings::default(),
        )
        .expect("deflated period-one map solve should converge to the other cycle");

        assert!((result.state[0] - 0.6875).abs() < 1e-8);
        assert!(result.residual_norm <= settings.tolerance);
    }

    #[test]
    fn deflation_avoids_every_phase_of_a_selected_map_cycle() {
        let system = build_logistic_system(3.2);
        let settings = NewtonSettings {
            max_steps: 50,
            ..NewtonSettings::default()
        };
        let kind = SystemKind::Map { iterations: 2 };
        let selected_cycle = [vec![0.5130445095326298], vec![0.7994554904673701]];

        let result = solve_equilibrium_with_deflation(
            &system,
            kind,
            &[0.52],
            settings,
            &selected_cycle,
            DeflationSettings::default(),
        )
        .expect("deflated map solve should converge away from the selected cycle");

        assert!(result.residual_norm <= settings.tolerance);
        assert!(
            selected_cycle
                .iter()
                .all(|target| (result.state[0] - target[0]).abs() > 1e-5),
            "solver returned a phase of the selected cycle: {:?}",
            result.state
        );
    }

    #[test]
    fn deflation_rejects_invalid_settings_and_target_dimensions() {
        let system = build_mu_system(1.0);
        let settings = NewtonSettings::default();

        assert_err_contains(
            solve_equilibrium_with_deflation(
                &system,
                SystemKind::Flow,
                &[0.2],
                settings,
                &[vec![0.0, 1.0]],
                DeflationSettings::default(),
            ),
            "Deflation target dimension mismatch",
        );
        assert_err_contains(
            solve_equilibrium_with_deflation(
                &system,
                SystemKind::Flow,
                &[0.2],
                settings,
                &[vec![0.0]],
                DeflationSettings {
                    exponent: 0.5,
                    ..DeflationSettings::default()
                },
            ),
            "exponent",
        );
        assert_err_contains(
            solve_equilibrium_with_deflation(
                &system,
                SystemKind::Flow,
                &[0.2],
                settings,
                &[vec![0.0]],
                DeflationSettings {
                    shift: -1.0,
                    ..DeflationSettings::default()
                },
            ),
            "shift",
        );
    }

    #[test]
    fn deflation_defaults_use_a_shifted_squared_norm() {
        let defaults = DeflationSettings::default();
        assert_eq!(defaults.exponent, 2.0);
        assert_eq!(defaults.shift, 1.0);
    }

    #[test]
    fn deflation_uses_distinct_settings_for_each_target() {
        let norm = compute_deflated_residual_norm_with_targets(
            &[2.0],
            &[1.0],
            &[
                DeflationTarget {
                    root: vec![0.0],
                    settings: DeflationSettings {
                        exponent: 1.0,
                        shift: 1.0,
                    },
                },
                DeflationTarget {
                    root: vec![1.0],
                    settings: DeflationSettings {
                        exponent: 2.0,
                        shift: 2.0,
                    },
                },
            ],
            &StatePeriodicity::none(),
        )
        .expect("deflated residual norm");

        assert!((norm - 4.5).abs() < 1e-12);
    }

    #[test]
    fn deflation_distance_wraps_periodic_state_coordinates() {
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);
        let norm = compute_deflated_residual_norm(
            &[0.05],
            &[1.0],
            &[vec![0.95]],
            DeflationSettings::default(),
            &periodicity,
        )
        .expect("deflated residual norm");

        assert!((norm - 101.0).abs() < 1e-10);
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
