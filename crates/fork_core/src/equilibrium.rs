use crate::{autodiff::Dual, equation_engine::EquationSystem, traits::DynamicalSystem};
use anyhow::{anyhow, bail, Context, Result};
use nalgebra::linalg::SVD;
use nalgebra::{Complex, DMatrix, DVector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SystemKind {
    Flow,
    Map,
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
}

pub fn solve_equilibrium(
    system: &EquationSystem<f64>,
    kind: SystemKind,
    initial_guess: &[f64],
    settings: NewtonSettings,
) -> Result<EquilibriumResult> {
    let dim = system.dimension();
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
    evaluate_residual(system, kind, &state, &mut residual);
    let mut residual_norm = l2_norm(&residual);
    let mut iterations = 0usize;

    loop {
        if residual_norm <= settings.tolerance {
            break;
        }

        if iterations >= settings.max_steps {
            bail!(
                "Newton solver failed to converge in {} steps (‖f(x)‖ = {}).",
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
        evaluate_residual(system, kind, &state, &mut residual);
        residual_norm = l2_norm(&residual);
    }

    let jacobian = compute_jacobian(system, kind, &state)?;
    let eigenpairs = compute_eigenpairs(dim, &jacobian)
        .context("Failed to compute eigenvalues/eigenvectors of Jacobian.")?;

    Ok(EquilibriumResult {
        state,
        residual_norm,
        iterations,
        jacobian,
        eigenpairs,
    })
}

fn evaluate_residual(
    system: &EquationSystem<f64>,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) {
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

fn compute_jacobian(
    system: &EquationSystem<f64>,
    kind: SystemKind,
    state: &[f64],
) -> Result<Vec<f64>> {
    let dim = system.dimension();
    let dual_params: Vec<Dual> = system.params.iter().map(|&p| Dual::new(p, 0.0)).collect();
    let dual_system = EquationSystem::new(system.equations.clone(), dual_params);

    let mut jacobian = vec![0.0; dim * dim];
    let mut dual_state = vec![Dual::new(0.0, 0.0); dim];
    let mut dual_out = vec![Dual::new(0.0, 0.0); dim];
    let t_dual = Dual::new(0.0, 0.0);

    for j in 0..dim {
        for i in 0..dim {
            dual_state[i] = Dual::new(state[i], if i == j { 1.0 } else { 0.0 });
        }
        dual_system.apply(t_dual, &dual_state, &mut dual_out);
        for i in 0..dim {
            let deriv = dual_out[i].eps;
            jacobian[i * dim + j] = match kind {
                SystemKind::Flow => deriv,
                SystemKind::Map => deriv - if i == j { 1.0 } else { 0.0 },
            };
        }
    }

    Ok(jacobian)
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
