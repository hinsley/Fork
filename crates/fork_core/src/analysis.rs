use crate::{
    autodiff::{Dual, TangentSystem},
    solvers::{DiscreteMap, RK4, Tsit5},
    traits::{DynamicalSystem, Steppable},
};
use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::QR;
use nalgebra::DMatrix;

#[derive(Debug, Clone, Copy)]
pub enum LyapunovStepper {
    Rk4,
    Tsit5,
    Discrete,
}

impl LyapunovStepper {
    fn build(self, dim: usize) -> InternalStepper {
        match self {
            LyapunovStepper::Rk4 => InternalStepper::Rk4(RK4::new(dim)),
            LyapunovStepper::Tsit5 => InternalStepper::Tsit5(Tsit5::new(dim)),
            LyapunovStepper::Discrete => InternalStepper::Discrete(DiscreteMap::new(dim)),
        }
    }
}

enum InternalStepper {
    Rk4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

impl InternalStepper {
    fn step(
        &mut self,
        system: &impl DynamicalSystem<f64>,
        t: &mut f64,
        state: &mut [f64],
        dt: f64,
    ) {
        match self {
            InternalStepper::Rk4(s) => s.step(system, t, state, dt),
            InternalStepper::Tsit5(s) => s.step(system, t, state, dt),
            InternalStepper::Discrete(s) => s.step(system, t, state, dt),
        }
    }
}

pub fn lyapunov_exponents<S>(
    system: S,
    solver: LyapunovStepper,
    initial_state: &[f64],
    initial_time: f64,
    steps: usize,
    dt: f64,
    qr_stride: usize,
) -> Result<Vec<f64>>
where
    S: DynamicalSystem<f64> + DynamicalSystem<Dual>,
{
    if initial_state.is_empty() {
        bail!("Initial state must have positive dimension.");
    }
    if steps == 0 {
        bail!("Lyapunov computation requires at least one integration step.");
    }
    if dt <= 0.0 {
        bail!("Step size dt must be positive.");
    }
    if qr_stride == 0 {
        bail!("qr_stride must be at least 1.");
    }

    let dim = initial_state.len();
    let aug_dim = dim + dim * dim;
    let mut augmented_state = vec![0.0; aug_dim];
    augmented_state[..dim].copy_from_slice(initial_state);
    for i in 0..dim {
        for j in 0..dim {
            augmented_state[dim + i * dim + j] = if i == j { 1.0 } else { 0.0 };
        }
    }

    let tangent_system = TangentSystem::new(system, dim);
    let mut stepper = solver.build(aug_dim);
    let mut accum = vec![0.0; dim];
    let mut t = initial_time;
    let mut steps_done = 0usize;
    let mut since_last_qr = 0usize;
    let mut total_time = 0.0;

    while steps_done < steps {
        stepper.step(&tangent_system, &mut t, &mut augmented_state, dt);
        steps_done += 1;
        since_last_qr += 1;
        total_time += dt;

        if since_last_qr == qr_stride || steps_done == steps {
            apply_qr(&mut augmented_state[dim..], dim, &mut accum)?;
            since_last_qr = 0;
        }
    }

    if total_time <= 0.0 {
        bail!("Total integration time is zero; cannot normalize exponents.");
    }

    for value in &mut accum {
        *value /= total_time;
    }

    Ok(accum)
}

fn apply_qr(phi_slice: &mut [f64], dim: usize, accum: &mut [f64]) -> Result<()> {
    if phi_slice.len() != dim * dim {
        bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, phi_slice);
    let qr = QR::new(matrix);
    let (q, r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)].abs();
        if diag <= f64::EPSILON {
            return Err(anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        accum[i] += diag.ln();
    }
    // FIX: Write Q back to phi_slice in ROW-MAJOR order.
    // nalgebra stores data in column-major, so q.as_slice() would return transposed data relative to our layout.
    for i in 0..dim {
        for j in 0..dim {
            phi_slice[i * dim + j] = q[(i, j)];
        }
    }
    Ok(())
}

pub fn kaplan_yorke(exponents: &[f64]) -> f64 {
    if exponents.is_empty() {
        return 0.0;
    }
    let mut sorted = exponents.to_vec();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

    let mut partial = 0.0;
    let mut k = 0usize;
    for (idx, &lambda) in sorted.iter().enumerate() {
        let new_sum = partial + lambda;
        if new_sum >= 0.0 {
            partial = new_sum;
            k = idx + 1;
        } else {
            if lambda.abs() <= f64::EPSILON {
                return k as f64;
            }
            return k as f64 + partial / lambda.abs();
        }
    }

    k as f64
}

