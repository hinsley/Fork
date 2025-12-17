use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, ContinuationBranch,
    ContinuationPoint, ContinuationSettings,
};
use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::linalg::SVD;
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

struct FlowContext<'a> {
    system: &'a mut EquationSystem,
    param_index: usize,
}

impl<'a> FlowContext<'a> {
    fn new(system: &'a mut EquationSystem, param_index: usize) -> Self {
        Self { system, param_index }
    }

    fn dimension(&self) -> usize {
        self.system.equations.len()
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

fn normalize_phase_data(
    dim: usize,
    anchor: Vec<f64>,
    direction: Vec<f64>,
) -> Result<(Vec<f64>, Vec<f64>)> {
    if anchor.len() != dim || direction.len() != dim {
        bail!("Phase anchor and direction must match system dimension");
    }
    let norm_sq: f64 = direction.iter().map(|v| v * v).sum();
    if norm_sq == 0.0 {
        bail!("Phase direction must be non-zero");
    }
    let normalized_direction: Vec<f64> = direction.into_iter().map(|v| v / norm_sq.sqrt()).collect();
    Ok((anchor, normalized_direction))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollocationConfig {
    pub mesh_points: usize,
    pub degree: usize,
    pub phase_anchor: Vec<f64>,
    pub phase_direction: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitCycleGuess {
    pub param_value: f64,
    pub period: f64,
    pub mesh_states: Vec<Vec<f64>>,
    pub stage_states: Vec<Vec<Vec<f64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitCycleSetup {
    pub guess: LimitCycleGuess,
    pub phase_anchor: Vec<f64>,
    pub phase_direction: Vec<f64>,
    pub mesh_points: usize,
    pub collocation_degree: usize,
}

impl LimitCycleSetup {
    pub fn collocation_config(&self) -> CollocationConfig {
        CollocationConfig {
            mesh_points: self.mesh_points,
            degree: self.collocation_degree,
            phase_anchor: self.phase_anchor.clone(),
            phase_direction: self.phase_direction.clone(),
        }
    }
}

pub fn limit_cycle_setup_from_hopf(
    system: &mut EquationSystem,
    param_index: usize,
    hopf_state: &[f64],
    hopf_param_value: f64,
    mesh_points: usize,
    degree: usize,
    amplitude: f64,
) -> Result<LimitCycleSetup> {
    if mesh_points < 3 {
        bail!("Limit cycle meshes require at least 3 points");
    }
    if amplitude <= 0.0 {
        bail!("Amplitude must be positive");
    }
    let dim = system.equations.len();
    if hopf_state.len() != dim {
        bail!("Hopf state dimension mismatch");
    }

    let old_param = system.params[param_index];
    system.params[param_index] = hopf_param_value;
    let jac = compute_jacobian(system, SystemKind::Flow, hopf_state)?;
    system.params[param_index] = old_param;
    let mat = DMatrix::from_row_slice(dim, dim, &jac);
    let eigenvalues = mat.clone().complex_eigenvalues();

    let mut hopf_idx = None;
    let mut best_freq = 0.0;
    for (idx, val) in eigenvalues.iter().enumerate() {
        if val.im <= 0.0 {
            continue;
        }
        if val.re.abs() > 1e-6 {
            continue;
        }
        if val.im > best_freq {
            best_freq = val.im;
            hopf_idx = Some(idx);
        }
    }
    let idx = hopf_idx.ok_or_else(|| anyhow!("Could not locate Hopf eigenpair"))?;
    let lambda = eigenvalues[idx];
    let eigenvector = compute_complex_eigenvector(&mat, lambda)?;

    let mut real_part = vec![0.0; dim];
    let mut imag_part = vec![0.0; dim];
    for i in 0..dim {
        real_part[i] = eigenvector[i].re;
        imag_part[i] = eigenvector[i].im;
    }
    let norm = real_part
        .iter()
        .chain(imag_part.iter())
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    if norm == 0.0 {
        bail!("Hopf eigenvector is degenerate");
    }
    for i in 0..dim {
        real_part[i] /= norm;
        imag_part[i] /= norm;
    }
    let dir_norm = real_part.iter().map(|v| v * v).sum::<f64>().sqrt();
    if dir_norm == 0.0 {
        bail!("Real part of Hopf eigenvector vanished; cannot define phase direction");
    }
    let phase_direction: Vec<f64> = real_part.iter().map(|v| v / dir_norm).collect();
    let phase_anchor = hopf_state.to_vec();

    let period = 2.0 * PI / lambda.im;
    let mut mesh_states = Vec::with_capacity(mesh_points);
    for k in 0..mesh_points {
        let theta = 2.0 * PI * (k as f64) / (mesh_points as f64);
        let mut state = vec![0.0; dim];
        for i in 0..dim {
            state[i] = hopf_state[i]
                + amplitude * (real_part[i] * theta.cos() - imag_part[i] * theta.sin());
        }
        mesh_states.push(state);
    }

    let coeffs = CollocationCoefficients::new(degree)?;
    let stage_states =
        build_stage_states_from_mesh(dim, mesh_points, degree, &coeffs.nodes, &mesh_states);

    let guess = LimitCycleGuess {
        param_value: hopf_param_value,
        period,
        mesh_states,
        stage_states,
    };

    Ok(LimitCycleSetup {
        guess,
        phase_anchor,
        phase_direction,
        mesh_points,
        collocation_degree: degree,
    })
}

struct PeriodicOrbitCollocationProblem<'a> {
    context: FlowContext<'a>,
    mesh_points: usize,
    degree: usize,
    coeffs: CollocationCoefficients,
    phase_anchor: Vec<f64>,
    phase_direction: Vec<f64>,
    work_stage_f: Vec<f64>,
    work_stage_jac: Vec<f64>,
    work_stage_param: Vec<f64>,
}

impl<'a> PeriodicOrbitCollocationProblem<'a> {
    pub fn new(
        system: &'a mut EquationSystem,
        param_index: usize,
        mesh_points: usize,
        degree: usize,
        phase_anchor: Vec<f64>,
        phase_direction: Vec<f64>,
    ) -> Result<Self> {
        if mesh_points < 2 {
            bail!("Collocation mesh must have at least 2 points");
        }
        let dim = system.equations.len();
        let (phase_anchor, phase_direction) =
            normalize_phase_data(dim, phase_anchor, phase_direction)?;
        let coeffs = CollocationCoefficients::new(degree)?;
        let stage_count = mesh_points * degree;
        Ok(Self {
            context: FlowContext::new(system, param_index),
            mesh_points,
            degree,
            coeffs,
            phase_anchor,
            phase_direction,
            work_stage_f: vec![0.0; stage_count * dim],
            work_stage_jac: vec![0.0; stage_count * dim * dim],
            work_stage_param: vec![0.0; stage_count * dim],
        })
    }

    fn state_dim(&self) -> usize {
        self.context.dimension()
    }

    fn stage_count(&self) -> usize {
        self.mesh_points * self.degree
    }

    fn unknowns(&self) -> usize {
        (self.mesh_points + self.stage_count()) * self.state_dim() + 1
    }

    fn stage_offset(&self) -> usize {
        1 + self.mesh_points * self.state_dim()
    }

    fn period_index(&self) -> usize {
        self.stage_offset() + self.stage_count() * self.state_dim()
    }

    fn mesh_state_slice<'b>(&self, aug: &'b DVector<f64>, idx: usize) -> &'b [f64] {
        let dim = self.state_dim();
        let start = 1 + idx * dim;
        let end = start + dim;
        &aug.as_slice()[start..end]
    }

    fn mesh_states<'b>(&self, aug: &'b DVector<f64>) -> Vec<&'b [f64]> {
        (0..self.mesh_points)
            .map(|i| self.mesh_state_slice(aug, i))
            .collect()
    }

    fn stage_state_slice<'b>(&self, aug: &'b DVector<f64>, interval: usize, stage: usize) -> &'b [f64] {
        let dim = self.state_dim();
        let index = interval * self.degree + stage;
        let start = self.stage_offset() + index * dim;
        let end = start + dim;
        &aug.as_slice()[start..end]
    }

    fn stage_states<'b>(&self, aug: &'b DVector<f64>) -> Vec<&'b [f64]> {
        (0..self.mesh_points)
            .flat_map(|i| (0..self.degree).map(move |j| self.stage_state_slice(aug, i, j)))
            .collect()
    }

    fn collocation_nodes(&self) -> &[f64] {
        &self.coeffs.nodes
    }

    fn evaluate_stages(&mut self, param: f64, stage_states: &[&[f64]]) -> Result<()> {
        let dim = self.state_dim();
        let buffer = &mut self.work_stage_f;
        self.context.with_param(param, |system| {
            for (idx, state) in stage_states.iter().enumerate() {
                let start = idx * dim;
                let end = start + dim;
                system.apply(0.0, state, &mut buffer[start..end]);
            }
            Ok(())
        })
    }

    fn evaluate_stage_jacobians(&mut self, param: f64, stage_states: &[&[f64]]) -> Result<()> {
        let dim = self.state_dim();
        self.context.with_param(param, |system| {
            for (idx, state) in stage_states.iter().enumerate() {
                let jac = compute_jacobian(system, SystemKind::Flow, state)?;
                let start = idx * dim * dim;
                self.work_stage_jac[start..start + dim * dim].copy_from_slice(&jac);
            }
            Ok(())
        })
    }

    fn evaluate_stage_param_sensitivities(
        &mut self,
        param: f64,
        stage_states: &[&[f64]],
    ) -> Result<()> {
        let dim = self.state_dim();
        let delta = 1e-6f64.max(1e-6 * param.abs());
        let mut plus = vec![0.0; dim];
        let mut minus = vec![0.0; dim];

        for (idx, state) in stage_states.iter().enumerate() {
            self.context.with_param(param + delta, |system| {
                system.apply(0.0, state, &mut plus);
                Ok(())
            })?;
            self.context.with_param(param - delta, |system| {
                system.apply(0.0, state, &mut minus);
                Ok(())
            })?;
            for r in 0..dim {
                self.work_stage_param[idx * dim + r] = (plus[r] - minus[r]) / (2.0 * delta);
            }
        }

        Ok(())
    }

    fn stage_function(&self, stage_idx: usize) -> &[f64] {
        let dim = self.state_dim();
        let start = stage_idx * dim;
        &self.work_stage_f[start..start + dim]
    }

    fn stage_jacobian(&self, stage_idx: usize) -> &[f64] {
        let dim = self.state_dim();
        let start = stage_idx * dim * dim;
        &self.work_stage_jac[start..start + dim * dim]
    }

    fn stage_param_sensitivity(&self, stage_idx: usize) -> &[f64] {
        let dim = self.state_dim();
        let start = stage_idx * dim;
        &self.work_stage_param[start..start + dim]
    }
}

impl<'a> ContinuationProblem for PeriodicOrbitCollocationProblem<'a> {
    fn dimension(&self) -> usize {
        self.unknowns()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let dim = self.state_dim();
        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        if period <= 0.0 {
            bail!("Period must be positive");
        }
        let mesh_states = self.mesh_states(aug_state);
        let stage_states = self.stage_states(aug_state);
        self.evaluate_stages(param, &stage_states)?;
        let h = period / self.mesh_points as f64;
        let out_slice = out.as_mut_slice();
        let stage_len = self.stage_count() * dim;
        let continuity_offset = stage_len;
        let phase_index = continuity_offset + self.mesh_points * dim;

        for interval in 0..self.mesh_points {
            let base = mesh_states[interval];
            for stage in 0..self.degree {
                let stage_idx = interval * self.degree + stage;
                let z = stage_states[stage_idx];
                let dest = &mut out_slice[stage_idx * dim..(stage_idx + 1) * dim];
                for r in 0..dim {
                    let mut sum = 0.0;
                    for k in 0..self.degree {
                        let f_idx = (interval * self.degree + k) * dim + r;
                        sum += self.coeffs.a[stage][k] * self.work_stage_f[f_idx];
                    }
                    dest[r] = z[r] - base[r] - h * sum;
                }
            }
        }

        for interval in 0..self.mesh_points {
            let base = mesh_states[interval];
            let next = if interval + 1 == self.mesh_points {
                mesh_states[0]
            } else {
                mesh_states[interval + 1]
            };
            let dest = &mut out_slice[continuity_offset + interval * dim
                ..continuity_offset + (interval + 1) * dim];
            for r in 0..dim {
                let mut sum = 0.0;
                for k in 0..self.degree {
                    let f_idx = (interval * self.degree + k) * dim + r;
                    sum += self.coeffs.b[k] * self.work_stage_f[f_idx];
                }
                dest[r] = next[r] - base[r] - h * sum;
            }
        }

        let mut phase = 0.0;
        let x0 = mesh_states[0];
        for j in 0..dim {
            phase += (x0[j] - self.phase_anchor[j]) * self.phase_direction[j];
        }
        out_slice[phase_index] = phase;
        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dim_state = self.state_dim();
        let total_unknowns = self.dimension();
        let mut jac = DMatrix::zeros(total_unknowns, total_unknowns + 1);

        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        if period <= 0.0 {
            bail!("Period must be positive");
        }
        let stage_states = self.stage_states(aug_state);
        self.evaluate_stages(param, &stage_states)?;
        self.evaluate_stage_jacobians(param, &stage_states)?;
        self.evaluate_stage_param_sensitivities(param, &stage_states)?;

        let mesh_col_start = 1usize;
        let mesh_var_count = self.mesh_points * dim_state;
        let stage_col_start = mesh_col_start + mesh_var_count;
        let stage_var_count = self.stage_count() * dim_state;
        let period_col = stage_col_start + stage_var_count;
        let h = period / self.mesh_points as f64;

        // Stage residuals
        for interval in 0..self.mesh_points {
            for stage in 0..self.degree {
                let stage_idx = interval * self.degree + stage;
                let row_base = stage_idx * dim_state;

                for r in 0..dim_state {
                    // Parameter column
                    let mut param_sum = 0.0;
                    for k in 0..self.degree {
                        let stage_k_idx = interval * self.degree + k;
                        param_sum +=
                            self.coeffs.a[stage][k] * self.stage_param_sensitivity(stage_k_idx)[r];
                    }
                    jac[(row_base + r, 0)] = -h * param_sum;

                    // Mesh base column
                    let mesh_col = mesh_col_start + interval * dim_state + r;
                    jac[(row_base + r, mesh_col)] -= 1.0;

                    // Stage columns
                    for col_stage in 0..self.degree {
                        let stage_col_idx = interval * self.degree + col_stage;
                        let col_start = stage_col_start + stage_col_idx * dim_state;
                        let jac_slice = self.stage_jacobian(stage_col_idx);
                        for c in 0..dim_state {
                            let mut value = -h
                                * self.coeffs.a[stage][col_stage]
                                * jac_slice[r * dim_state + c];
                            if stage == col_stage && r == c {
                                value += 1.0;
                            }
                            jac[(row_base + r, col_start + c)] += value;
                        }
                    }

                    // Period column
                    let mut period_sum = 0.0;
                    for k in 0..self.degree {
                        let stage_k_idx = interval * self.degree + k;
                        period_sum += self.coeffs.a[stage][k] * self.stage_function(stage_k_idx)[r];
                    }
                    jac[(row_base + r, period_col)] = -(period_sum) / (self.mesh_points as f64);
                }
            }
        }

        // Continuity rows
        let continuity_offset = self.stage_count() * dim_state;
        for interval in 0..self.mesh_points {
            let row_base = continuity_offset + interval * dim_state;
            for r in 0..dim_state {
                let mut param_sum = 0.0;
                for k in 0..self.degree {
                    let stage_idx = interval * self.degree + k;
                    param_sum += self.coeffs.b[k] * self.stage_param_sensitivity(stage_idx)[r];
                }
                jac[(row_base + r, 0)] = -h * param_sum;

                let mesh_col = mesh_col_start + interval * dim_state + r;
                jac[(row_base + r, mesh_col)] -= 1.0;
                let next_idx = if interval + 1 == self.mesh_points {
                    0
                } else {
                    interval + 1
                };
                let next_col = mesh_col_start + next_idx * dim_state + r;
                jac[(row_base + r, next_col)] += 1.0;

                for k in 0..self.degree {
                    let stage_idx = interval * self.degree + k;
                    let col_start = stage_col_start + stage_idx * dim_state;
                    let jac_slice = self.stage_jacobian(stage_idx);
                    for c in 0..dim_state {
                        jac[(row_base + r, col_start + c)] -=
                            h * self.coeffs.b[k] * jac_slice[r * dim_state + c];
                    }
                }

                let mut period_sum = 0.0;
                for k in 0..self.degree {
                    let stage_idx = interval * self.degree + k;
                    period_sum += self.coeffs.b[k] * self.stage_function(stage_idx)[r];
                }
                jac[(row_base + r, period_col)] = -(period_sum) / (self.mesh_points as f64);
            }
        }

        // Phase condition row
        let phase_row = continuity_offset + self.mesh_points * dim_state;
        for r in 0..dim_state {
            let col = mesh_col_start + r;
            jac[(phase_row, col)] = self.phase_direction[r];
        }

        Ok(jac)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        let mesh_states = self.mesh_states(aug_state);
        let monodromy =
            compute_trapezoid_monodromy(&mut self.context, param, &mesh_states, period)?;
        let multipliers_vec: Vec<Complex<f64>> =
            monodromy.clone().complex_eigenvalues().iter().cloned().collect();
        let (cycle_fold, period_doubling, neimark, eig_vals) = cycle_tests(&multipliers_vec);

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(
                cycle_fold,
                period_doubling,
                neimark,
            ),
            eigenvalues: eig_vals,
        })
    }
}

fn validate_mesh_states(
    state_dim: usize,
    mesh_points: usize,
    states: &[Vec<f64>],
) -> Result<()> {
    if states.len() != mesh_points {
        bail!(
            "Initial guess must provide {} mesh states (got {})",
            mesh_points,
            states.len()
        );
    }
    for slice in states {
        if slice.len() != state_dim {
            bail!(
                "State slice length {} does not match system dimension {}",
                slice.len(),
                state_dim
            );
        }
    }
    Ok(())
}

fn build_stage_states_from_mesh(
    dim: usize,
    mesh_points: usize,
    degree: usize,
    nodes: &[f64],
    mesh_states: &[Vec<f64>],
) -> Vec<Vec<Vec<f64>>> {
    let mut stage_states = Vec::with_capacity(mesh_points);
    for i in 0..mesh_points {
        let next = if i + 1 == mesh_points {
            &mesh_states[0]
        } else {
            &mesh_states[i + 1]
        };
        let current = &mesh_states[i];
        let mut stages = Vec::with_capacity(degree);
        for &node in nodes {
            let mut stage = vec![0.0; dim];
            for d in 0..dim {
                stage[d] = current[d] + node * (next[d] - current[d]);
            }
            stages.push(stage);
        }
        stage_states.push(stages);
    }
    stage_states
}

fn flatten_collocation_state(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    period: f64,
) -> Vec<f64> {
    let mesh_flat: Vec<f64> = mesh_states.iter().flatten().cloned().collect();
    let stage_flat: Vec<f64> = stage_states.iter().flatten().flatten().cloned().collect();
    let mut flat = Vec::with_capacity(mesh_flat.len() + stage_flat.len() + 1);
    flat.extend(mesh_flat);
    flat.extend(stage_flat);
    flat.push(period);
    flat
}

#[derive(Debug, Clone)]
struct CollocationCoefficients {
    nodes: Vec<f64>,
    a: Vec<Vec<f64>>,
    b: Vec<f64>,
}

impl CollocationCoefficients {
    fn new(degree: usize) -> Result<Self> {
        if degree == 0 {
            bail!("Collocation degree must be at least 1");
        }
        let nodes = gauss_legendre_nodes(degree)?;
        let poly_coeffs = lagrange_coefficients(&nodes)?;
        let mut a = vec![vec![0.0; degree]; degree];
        let mut b = vec![0.0; degree];
        for j in 0..degree {
            b[j] = integrate_polynomial(&poly_coeffs[j], 1.0);
        }
        for i in 0..degree {
            for j in 0..degree {
                a[i][j] = integrate_polynomial(&poly_coeffs[j], nodes[i]);
            }
        }
        Ok(Self { nodes, a, b })
    }
}

fn gauss_legendre_nodes(degree: usize) -> Result<Vec<f64>> {
    if degree == 0 {
        bail!("Collocation degree must be positive");
    }
    let n = degree;
    let m = (n + 1) / 2;
    let mut nodes = vec![0.0; n];
    for i in 0..m {
        let mut x = f64::cos(PI * (i as f64 + 0.75) / (n as f64 + 0.5));
        for _ in 0..50 {
            let (p, dp) = legendre_eval(n, x);
            let dx = -p / dp;
            x += dx;
            if dx.abs() < 1e-14 {
                break;
            }
        }
        let t = 0.5 * (x + 1.0);
        nodes[i] = t;
        nodes[n - i - 1] = 1.0 - t;
    }
    nodes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Ok(nodes)
}

fn legendre_eval(n: usize, x: f64) -> (f64, f64) {
    if n == 0 {
        return (1.0, 0.0);
    }
    let mut p0 = 1.0;
    let mut p1 = x;
    if n == 1 {
        return (p1, 1.0);
    }
    for k in 2..=n {
        let kf = k as f64;
        let pn = ((2.0 * kf - 1.0) * x * p1 - (kf - 1.0) * p0) / kf;
        p0 = p1;
        p1 = pn;
    }
    let dp = (n as f64) * (x * p1 - p0) / (x * x - 1.0);
    (p1, dp)
}

fn lagrange_coefficients(nodes: &[f64]) -> Result<Vec<Vec<f64>>> {
    let degree = nodes.len();
    let mut vandermonde = DMatrix::zeros(degree, degree);
    for (i, &node) in nodes.iter().enumerate() {
        let mut power = 1.0;
        for j in 0..degree {
            vandermonde[(i, j)] = power;
            power *= node;
        }
    }
    let lu = vandermonde.lu();
    if !lu.is_invertible() {
        bail!("Failed to invert Vandermonde matrix for collocation coefficients");
    }
    let mut coeffs = Vec::with_capacity(degree);
    for j in 0..degree {
        let mut rhs = DVector::zeros(degree);
        rhs[j] = 1.0;
        let sol = lu
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Failed to solve for Lagrange coefficients"))?;
        coeffs.push(sol.iter().cloned().collect());
    }
    Ok(coeffs)
}

fn integrate_polynomial(coeffs: &[f64], upper: f64) -> f64 {
    let mut sum = 0.0;
    for (deg, &c) in coeffs.iter().enumerate() {
        let power = upper.powi((deg + 1) as i32);
        sum += c * power / ((deg + 1) as f64);
    }
    sum
}

fn compute_trapezoid_monodromy(
    context: &mut FlowContext<'_>,
    param: f64,
    states: &[&[f64]],
    period: f64,
) -> Result<DMatrix<f64>> {
    let dim = context.dimension();
    let mesh_points = states.len();
    let h = period / mesh_points as f64;

    let mut jacobians: Vec<DMatrix<f64>> = Vec::with_capacity(mesh_points);
    context.with_param(param, |system| {
        for state in states {
            let jac = compute_jacobian(system, SystemKind::Flow, state)?;
            jacobians.push(DMatrix::from_row_slice(dim, dim, &jac));
        }
        Ok(())
    })?;

    let identity = DMatrix::identity(dim, dim);
    let mut monodromy = DMatrix::identity(dim, dim);

    for i in 0..mesh_points {
        let next = (i + 1) % mesh_points;
        let lhs = &identity - jacobians[next].clone().scale(0.5 * h);
        let rhs = &identity + jacobians[i].clone().scale(0.5 * h);
        let step = lhs
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Failed to invert trapezoid step matrix"))?;
        monodromy = step * monodromy;
    }

    Ok(monodromy)
}

fn cycle_tests(multipliers: &[Complex<f64>]) -> (f64, f64, f64, Vec<Complex<f64>>) {
    if multipliers.is_empty() {
        return (1.0, 1.0, 1.0, Vec::new());
    }

    let values = multipliers.to_vec();
    let trivial_idx = values
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let da = (*a - Complex::new(1.0, 0.0)).norm_sqr();
            let db = (*b - Complex::new(1.0, 0.0)).norm_sqr();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(idx, _)| idx);

    let mut cycle_fold = 1.0;
    let mut period_doubling = 1.0;
    let mut neimark = 1.0;
    const IMAG_EPS: f64 = 1e-5;

    for (idx, mu) in values.iter().enumerate() {
        if Some(idx) == trivial_idx {
            continue;
        }
        if mu.im.abs() < IMAG_EPS {
            cycle_fold *= mu.re - 1.0;
            period_doubling *= mu.re + 1.0;
        } else if mu.im > 0.0 {
            neimark *= mu.norm_sqr() - 1.0;
        }
    }

    (cycle_fold, period_doubling, neimark, values)
}

fn compute_complex_eigenvector(
    mat: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<Vec<Complex<f64>>> {
    let dim = mat.nrows();
    let mut shifted = mat.map(|v| Complex::new(v, 0.0));
    for i in 0..dim {
        shifted[(i, i)] -= eigenvalue;
    }
    let svd = SVD::new(shifted, true, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Failed to compute eigenvector for Hopf mode"))?;
    let row_index = v_t.nrows().saturating_sub(1);
    let mut vector = Vec::with_capacity(dim);
    for i in 0..dim {
        vector.push(v_t[(row_index, i)]);
    }
    Ok(vector)
}

pub fn continue_limit_cycle_collocation(
    system: &mut EquationSystem,
    param_index: usize,
    config: CollocationConfig,
    guess: LimitCycleGuess,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    if guess.period <= 0.0 {
        bail!("Initial period must be positive");
    }
    let mut problem = PeriodicOrbitCollocationProblem::new(
        system,
        param_index,
        config.mesh_points,
        config.degree,
        config.phase_anchor,
        config.phase_direction,
    )?;
    let dim = problem.state_dim();
    validate_mesh_states(dim, problem.mesh_points, &guess.mesh_states)?;
    let stage_states = if guess.stage_states.is_empty() {
        build_stage_states_from_mesh(
            dim,
            problem.mesh_points,
            problem.degree,
            problem.collocation_nodes(),
            &guess.mesh_states,
        )
    } else {
        guess.stage_states.clone()
    };
    let flat_state = flatten_collocation_state(&guess.mesh_states, &stage_states, guess.period);
    let point = ContinuationPoint {
        state: flat_state,
        param_value: guess.param_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
    };

    continue_with_problem(&mut problem, point, settings, forward)
}

pub fn extend_limit_cycle_collocation(
    system: &mut EquationSystem,
    param_index: usize,
    config: CollocationConfig,
    branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let mut problem = PeriodicOrbitCollocationProblem::new(
        system,
        param_index,
        config.mesh_points,
        config.degree,
        config.phase_anchor,
        config.phase_direction,
    )?;
    extend_branch_with_problem(&mut problem, branch, settings, forward)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_period_doubling_detection() {
        // Case 1: Before bifurcation (Stable, multipliers inside)
        // Triv: 1.0, Stable: -0.99
        let multipliers_before = vec![
            Complex::new(1.0, 0.0),
            Complex::new(-0.99, 1e-16),
            Complex::new(0.01, 0.0),
        ];
        let (_, pd_before, _, _) = cycle_tests(&multipliers_before);
        
        // Case 2: At/After bifurcation (Unstable, multiplier past -1)
        // Triv: 1.0, Unstable: -1.01
        let multipliers_after = vec![
            Complex::new(1.0, 0.0),
            Complex::new(-1.01, 1e-16),
            Complex::new(0.01, 0.0),
        ];
        let (_, pd_after, _, _) = cycle_tests(&multipliers_after);

        println!("PD Before: {}, PD After: {}", pd_before, pd_after);
        assert!(pd_before * pd_after < 0.0, "Period doubling test function should change sign");
        
        // Case 3: Exact hit
        let multipliers_exact = vec![
            Complex::new(1.0, 0.0),
            Complex::new(-1.0, 1e-16),
            Complex::new(0.01, 0.0),
        ];
        let (_, pd_exact, _, _) = cycle_tests(&multipliers_exact);
        println!("PD Exact: {}", pd_exact);
        assert!(pd_before * pd_exact <= 0.0, "Period doubling test should be zero or cross at exact hit");
    }
}
