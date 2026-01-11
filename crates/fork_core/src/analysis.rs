use crate::{
    autodiff::{Dual, TangentSystem},
    solvers::{DiscreteMap, Tsit5, RK4},
    traits::{DynamicalSystem, Steppable},
};
use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::QR;
use nalgebra::DMatrix;
use serde::Serialize;

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

#[derive(Debug, Clone, Serialize)]
pub struct CovariantLyapunovResult {
    pub dimension: usize,
    pub checkpoints: usize,
    pub times: Vec<f64>,
    pub vectors: Vec<f64>,
}

pub fn covariant_lyapunov_vectors<S>(
    system: S,
    solver: LyapunovStepper,
    initial_state: &[f64],
    initial_time: f64,
    dt: f64,
    qr_stride: usize,
    window_steps: usize,
    forward_transient: usize,
    backward_transient: usize,
) -> Result<CovariantLyapunovResult>
where
    S: DynamicalSystem<f64> + DynamicalSystem<Dual>,
{
    if initial_state.is_empty() {
        bail!("Initial state must have positive dimension.");
    }
    if dt <= 0.0 {
        bail!("Step size dt must be positive.");
    }
    if qr_stride == 0 {
        bail!("qr_stride must be at least 1.");
    }
    if window_steps == 0 {
        bail!("Window size must be at least one step.");
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
    let mut t = initial_time;
    let mut steps_done = 0usize;
    let mut since_last_qr = 0usize;
    let total_steps = forward_transient
        .checked_add(window_steps)
        .and_then(|v| v.checked_add(backward_transient))
        .ok_or_else(|| anyhow!("Requested durations overflow usize."))?;
    if total_steps == 0 {
        bail!("Total integration steps must be positive.");
    }

    let mut q_history: Vec<f64> = Vec::new();
    let mut r_history: Vec<f64> = Vec::new();
    let mut time_history: Vec<f64> = Vec::new();
    let mut window_accum = 0usize;
    let mut backward_accum = 0usize;

    while steps_done < total_steps {
        stepper.step(&tangent_system, &mut t, &mut augmented_state, dt);
        steps_done += 1;
        since_last_qr += 1;

        if since_last_qr == qr_stride || steps_done == total_steps {
            let block_steps = since_last_qr;
            since_last_qr = 0;

            let phi_slice = &mut augmented_state[dim..];
            let (q_matrix, r_matrix) = thin_qr_positive(phi_slice, dim)?;
            overwrite_slice_with_matrix(phi_slice, &q_matrix);

            if steps_done <= forward_transient {
                continue;
            }

            let mut stored = false;
            if window_accum < window_steps {
                append_matrix_row_major(&mut q_history, &q_matrix);
                append_matrix_row_major(&mut r_history, &r_matrix);
                time_history.push(t);
                window_accum = window_accum.saturating_add(block_steps).min(window_steps);
                stored = true;
            } else if backward_accum < backward_transient {
                append_matrix_row_major(&mut r_history, &r_matrix);
                backward_accum = backward_accum
                    .saturating_add(block_steps)
                    .min(backward_transient);
                stored = true;
            }

            if !stored && window_accum < window_steps {
                return Err(anyhow!("Failed to store Gram-Schmidt data for the requested window. Consider reducing qr_stride."));
            }

            if window_accum == window_steps && backward_accum == backward_transient {
                // All required data gathered; remaining integration (if any) is redundant.
                break;
            }
        }
    }

    let dim_sq = dim * dim;
    if q_history.is_empty() {
        bail!("No CLV data stored. Ensure window duration exceeds qr_stride.");
    }
    if q_history.len() % dim_sq != 0 || r_history.len() % dim_sq != 0 {
        bail!("Internal storage size mismatch while assembling CLVs.");
    }

    let window_count = q_history.len() / dim_sq;
    let total_r_count = r_history.len() / dim_sq;
    if total_r_count < window_count {
        bail!("Insufficient R-history for backward pass.");
    }

    let mut c_matrix = unit_upper_triangular(dim);
    for idx in (window_count..total_r_count).rev() {
        let r_slice = &r_history[idx * dim_sq..(idx + 1) * dim_sq];
        c_matrix = solve_upper(r_slice, &c_matrix, dim)?;
        normalize_columns(&mut c_matrix, dim)?;
    }

    let mut clv_vectors = vec![0.0; q_history.len()];
    let mut c_current = c_matrix;

    for idx in (0..window_count).rev() {
        let q_slice = &q_history[idx * dim_sq..(idx + 1) * dim_sq];
        let r_slice = &r_history[idx * dim_sq..(idx + 1) * dim_sq];
        let dest = &mut clv_vectors[idx * dim_sq..(idx + 1) * dim_sq];
        matmul_row_major(q_slice, &c_current, dest, dim);
        let next_c = solve_upper(r_slice, &c_current, dim)?;
        c_current = next_c;
        normalize_columns(&mut c_current, dim)?;
    }

    Ok(CovariantLyapunovResult {
        dimension: dim,
        checkpoints: window_count,
        times: time_history,
        vectors: clv_vectors,
    })
}

fn thin_qr_positive(slice: &[f64], dim: usize) -> Result<(DMatrix<f64>, DMatrix<f64>)> {
    if slice.len() != dim * dim {
        bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, slice);
    let qr = QR::new(matrix);
    let (mut q, mut r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)];
        if diag.abs() <= f64::EPSILON {
            return Err(anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        if diag < 0.0 {
            for row in 0..dim {
                q[(row, i)] = -q[(row, i)];
            }
            for col in i..dim {
                r[(i, col)] = -r[(i, col)];
            }
        }
    }
    Ok((q, r))
}

fn overwrite_slice_with_matrix(slice: &mut [f64], matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            slice[i * dim + j] = matrix[(i, j)];
        }
    }
}

fn append_matrix_row_major(target: &mut Vec<f64>, matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            target.push(matrix[(i, j)]);
        }
    }
}

fn solve_upper(r: &[f64], rhs: &[f64], dim: usize) -> Result<Vec<f64>> {
    let mut result = vec![0.0; dim * dim];
    for col in 0..dim {
        for row in (0..dim).rev() {
            let mut value = rhs[row * dim + col];
            for k in row + 1..dim {
                value -= r[row * dim + k] * result[k * dim + col];
            }
            let diag = r[row * dim + row];
            if diag.abs() <= f64::EPSILON {
                return Err(anyhow!(
                    "Encountered near-singular R matrix during backward substitution."
                ));
            }
            result[row * dim + col] = value / diag;
        }
    }
    Ok(result)
}

fn normalize_columns(matrix: &mut [f64], dim: usize) -> Result<()> {
    for col in 0..dim {
        let mut norm = 0.0;
        for row in 0..dim {
            let value = matrix[row * dim + col];
            norm += value * value;
        }
        norm = norm.sqrt();
        if norm <= f64::EPSILON {
            return Err(anyhow!(
                "Encountered degenerate CLV column during normalization."
            ));
        }
        for row in 0..dim {
            matrix[row * dim + col] /= norm;
        }
    }
    Ok(())
}

fn matmul_row_major(a: &[f64], b: &[f64], dest: &mut [f64], dim: usize) {
    for i in 0..dim {
        for j in 0..dim {
            let mut accum = 0.0;
            for k in 0..dim {
                accum += a[i * dim + k] * b[k * dim + j];
            }
            dest[i * dim + j] = accum;
        }
    }
}

fn unit_upper_triangular(dim: usize) -> Vec<f64> {
    let mut matrix = vec![0.0; dim * dim];
    for i in 0..dim {
        for j in i..dim {
            matrix[i * dim + j] = if i == j { 1.0 } else { 0.0 };
        }
    }
    matrix
}

#[cfg(test)]
mod tests {
    use super::{
        apply_qr, covariant_lyapunov_vectors, kaplan_yorke, lyapunov_exponents, LyapunovStepper,
    };
    use crate::autodiff::Dual;
    use crate::traits::DynamicalSystem;
    use nalgebra::linalg::QR;
    use nalgebra::DMatrix;

    #[derive(Clone, Copy)]
    struct LinearSystem {
        rate: f64,
    }

    impl DynamicalSystem<f64> for LinearSystem {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = self.rate * x[0];
        }
    }

    impl DynamicalSystem<Dual> for LinearSystem {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: Dual, x: &[Dual], out: &mut [Dual]) {
            out[0] = Dual::new(self.rate, 0.0) * x[0];
        }
    }

    fn assert_err_contains<T: std::fmt::Debug>(result: anyhow::Result<T>, needle: &str) {
        let err = result.expect_err("expected error");
        let message = format!("{err}");
        assert!(
            message.contains(needle),
            "expected error to contain \"{needle}\", got \"{message}\""
        );
    }

    #[test]
    fn lyapunov_exponents_rejects_invalid_inputs() {
        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            lyapunov_exponents(system, LyapunovStepper::Rk4, &[], 0.0, 10, 0.1, 1),
            "Initial state",
        );
        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            lyapunov_exponents(system, LyapunovStepper::Rk4, &[1.0], 0.0, 0, 0.1, 1),
            "at least one integration step",
        );
        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            lyapunov_exponents(system, LyapunovStepper::Rk4, &[1.0], 0.0, 10, 0.0, 1),
            "dt must be positive",
        );
        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            lyapunov_exponents(system, LyapunovStepper::Rk4, &[1.0], 0.0, 10, 0.1, 0),
            "qr_stride",
        );
    }

    #[test]
    fn lyapunov_exponents_discrete_map_matches_log_growth() {
        let system = LinearSystem { rate: 2.0 };
        let exponents =
            lyapunov_exponents(system, LyapunovStepper::Discrete, &[1.0], 0.0, 8, 1.0, 1)
                .expect("lyapunov exponents should compute");
        let expected = 2.0_f64.ln();
        assert!((exponents[0] - expected).abs() < 1e-12);
    }

    #[test]
    fn lyapunov_exponents_tracks_linear_rate() {
        let system = LinearSystem { rate: -1.0 };
        let exponents =
            lyapunov_exponents(system, LyapunovStepper::Rk4, &[1.0], 0.0, 100, 0.05, 1)
                .expect("lyapunov exponents should compute");
        assert!((exponents[0] + 1.0).abs() < 1e-2);
    }

    #[test]
    fn apply_qr_writes_q_row_major_and_accumulates_logs() {
        let dim = 2;
        let mut phi = vec![1.0, 2.0, 3.0, 4.0];
        let original = phi.clone();
        let mut accum = vec![0.0; dim];

        apply_qr(&mut phi, dim, &mut accum).expect("QR should succeed");

        let matrix = DMatrix::from_row_slice(dim, dim, &original);
        let qr = QR::new(matrix);
        let (q, r) = qr.unpack();

        for i in 0..dim {
            for j in 0..dim {
                assert!((phi[i * dim + j] - q[(i, j)]).abs() < 1e-12);
            }
            let expected = r[(i, i)].abs().ln();
            assert!((accum[i] - expected).abs() < 1e-12);
        }
    }

    #[test]
    fn apply_qr_rejects_near_singular_matrix() {
        let dim = 2;
        let mut phi = vec![0.0; dim * dim];
        let mut accum = vec![0.0; dim];

        assert_err_contains(
            apply_qr(&mut phi, dim, &mut accum),
            "near-singular R matrix",
        );
    }

    #[test]
    fn covariant_lyapunov_vectors_rejects_invalid_inputs() {
        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            covariant_lyapunov_vectors(
                system,
                LyapunovStepper::Rk4,
                &[],
                0.0,
                0.1,
                1,
                1,
                0,
                0,
            ),
            "Initial state",
        );

        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            covariant_lyapunov_vectors(
                system,
                LyapunovStepper::Rk4,
                &[1.0],
                0.0,
                0.0,
                1,
                1,
                0,
                0,
            ),
            "dt must be positive",
        );

        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            covariant_lyapunov_vectors(
                system,
                LyapunovStepper::Rk4,
                &[1.0],
                0.0,
                0.1,
                0,
                1,
                0,
                0,
            ),
            "qr_stride",
        );

        let system = LinearSystem { rate: 1.0 };
        assert_err_contains(
            covariant_lyapunov_vectors(
                system,
                LyapunovStepper::Rk4,
                &[1.0],
                0.0,
                0.1,
                1,
                0,
                0,
                0,
            ),
            "Window size",
        );
    }

    #[test]
    fn covariant_lyapunov_vectors_returns_normalized_vectors() {
        let system = LinearSystem { rate: -0.4 };
        let result = covariant_lyapunov_vectors(
            system,
            LyapunovStepper::Rk4,
            &[1.0],
            0.0,
            0.1,
            1,
            2,
            0,
            1,
        )
        .expect("covariant lyapunov vectors should compute");
        assert_eq!(result.dimension, 1);
        assert_eq!(result.checkpoints, 2);
        assert_eq!(result.times.len(), 2);
        assert_eq!(result.vectors.len(), 2);
        for value in result.vectors {
            assert!((value.abs() - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn kaplan_yorke_handles_empty_and_partial_sum() {
        assert_eq!(kaplan_yorke(&[]), 0.0);
        let result = kaplan_yorke(&[0.1, 0.0, -1.0]);
        assert!((result - 2.1).abs() < 1e-12);
    }
}
