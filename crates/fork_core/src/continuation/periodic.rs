use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, BranchType,
    ContinuationBranch, ContinuationPoint, ContinuationSettings,
};
#[allow(unused_imports)]
use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
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
        Self {
            system,
            param_index,
        }
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
    let normalized_direction: Vec<f64> =
        direction.into_iter().map(|v| v / norm_sq.sqrt()).collect();
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

impl LimitCycleGuess {
    pub fn to_aug(&self, _dim: usize) -> DVector<f64> {
        let flat = flatten_collocation_state(&self.mesh_states, &self.stage_states, self.period);
        let mut aug = DVector::zeros(flat.len() + 1);
        aug[0] = self.param_value;
        for (i, &v) in flat.iter().enumerate() {
            aug[i + 1] = v;
        }
        aug
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitCycleSetup {
    pub guess: LimitCycleGuess,
    pub phase_anchor: Vec<f64>,
    pub phase_direction: Vec<f64>,
    pub mesh_points: usize,
    pub collocation_degree: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum OrbitTimeMode {
    Continuous,
    Discrete,
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

    pub fn to_problem<'a>(
        &self,
        system: &'a mut EquationSystem,
        param_index: usize,
    ) -> Result<PeriodicOrbitCollocationProblem<'a>> {
        PeriodicOrbitCollocationProblem::new(
            system,
            param_index,
            self.mesh_points,
            self.collocation_degree,
            self.phase_anchor.clone(),
            self.phase_direction.clone(),
        )
    }
}

fn select_hopf_pair(eigenvalues: &[Complex<f64>]) -> Option<(usize, usize)> {
    if eigenvalues.len() < 2 {
        return None;
    }
    let mut best_idx1 = 0usize;
    let mut best_idx2 = 1usize;
    let mut best_sum = f64::INFINITY;
    for j in 0..eigenvalues.len() - 1 {
        let base = eigenvalues[j];
        for k in (j + 1)..eigenvalues.len() {
            let sum = base + eigenvalues[k];
            let value = sum.norm();
            if value < best_sum {
                best_sum = value;
                best_idx1 = j;
                best_idx2 = k;
            }
        }
    }
    Some((best_idx1, best_idx2))
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

    // Pick the eigenpair with smallest sum (closest conjugates).
    let (idx1, idx2) = select_hopf_pair(eigenvalues.as_slice())
        .ok_or_else(|| anyhow!("Could not locate Hopf eigenpair"))?;
    let eig1 = eigenvalues[idx1];
    let eig2 = eigenvalues[idx2];
    if eig1.im.abs() <= 1e-12 && eig2.im.abs() <= 1e-12 {
        bail!("Neutral saddle");
    }
    let omega = eig1.im.abs().max(eig2.im.abs());
    if omega <= 0.0 {
        bail!("Neutral saddle");
    }
    let lambda = eig1;
    let eigenvector = compute_complex_eigenvector(&mat, lambda)?;

    // Orthogonalize real and imaginary parts by rotating Q -> Q * exp(i*phi).
    // This makes Re(Q) orthogonal to Im(Q).
    let mut d = 0.0;
    let mut s = 0.0;
    let mut r = 0.0;
    for i in 0..dim {
        let vr = eigenvector[i].re;
        let vi = eigenvector[i].im;
        d += vr * vr;
        s += vi * vi;
        r += vr * vi;
    }
    let phi = 0.5 * (2.0 * r).atan2(s - d);
    let (sin_phi, cos_phi) = phi.sin_cos();

    let mut real_part = vec![0.0; dim];
    let mut imag_part = vec![0.0; dim];
    for i in 0..dim {
        let vr = eigenvector[i].re;
        let vi = eigenvector[i].im;
        real_part[i] = vr * cos_phi - vi * sin_phi;
        imag_part[i] = vr * sin_phi + vi * cos_phi;
    }

    // Normalize real part to define state perturbation and mesh
    let norm_real = real_part.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm_real == 0.0 {
        bail!("Rotated real part of Hopf eigenvector is degenerate");
    }
    for i in 0..dim {
        real_part[i] /= norm_real;
        imag_part[i] /= norm_real; // Keep relative scaling for imag part (velocity)
    }

    // Set phase direction to (normalized) imag part
    let norm_imag = imag_part.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm_imag == 0.0 {
        bail!("Rotated imaginary part of Hopf eigenvector is degenerate");
    }
    let phase_direction: Vec<f64> = imag_part.iter().map(|v| v / norm_imag).collect();
    let phase_anchor = hopf_state.to_vec();

    let period = 2.0 * PI / omega;
    let coeffs = CollocationCoefficients::new(degree)?;
    let mut mesh_states = Vec::with_capacity(mesh_points);
    let mut stage_states = Vec::with_capacity(mesh_points);

    for k in 0..mesh_points {
        // Sample mesh point at tau = k / mesh_points
        let theta_mesh = 2.0 * PI * (k as f64) / (mesh_points as f64);
        let mut m_state = vec![0.0; dim];
        for i in 0..dim {
            m_state[i] = hopf_state[i]
                + amplitude * (real_part[i] * theta_mesh.cos() - imag_part[i] * theta_mesh.sin());
        }
        mesh_states.push(m_state);

        // Sample stage states within interval k at tau = (k + zeta_j) / mesh_points
        let mut interval_stages = Vec::with_capacity(degree);
        for &zeta in &coeffs.nodes {
            let theta_stage = 2.0 * PI * (k as f64 + zeta) / (mesh_points as f64);
            let mut s_state = vec![0.0; dim];
            for i in 0..dim {
                s_state[i] = hopf_state[i]
                    + amplitude
                        * (real_part[i] * theta_stage.cos() - imag_part[i] * theta_stage.sin());
            }
            interval_stages.push(s_state);
        }
        stage_states.push(interval_stages);
    }

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

/// Initializes a limit cycle continuation from a computed orbit.
///
/// Algorithm overview:
/// 1. Skip 1/3 of the orbit as transient
/// 2. Find where the orbit returns close to the starting point (within tolerance)
/// 3. Extract one cycle
/// 4. Remesh to collocation grid using linear interpolation
///
/// # Arguments
/// * `orbit_times` - Time values from the orbit (should be monotonically increasing)
/// * `orbit_states` - State vectors at each time point (each should have `dim` elements)
/// * `param_value` - Current value of the continuation parameter
/// * `mesh_points` - Number of mesh intervals (ntst)
/// * `degree` - Collocation degree (ncol)
/// * `tolerance` - Tolerance for detecting when orbit returns to starting point
pub fn limit_cycle_setup_from_orbit(
    orbit_times: &[f64],
    orbit_states: &[Vec<f64>],
    param_value: f64,
    mesh_points: usize,
    degree: usize,
    tolerance: f64,
    time_mode: OrbitTimeMode,
) -> Result<LimitCycleSetup> {
    if mesh_points < 3 {
        bail!("Limit cycle meshes require at least 3 points");
    }
    if orbit_times.len() < 10 {
        bail!("Orbit too short - need at least 10 points");
    }
    if orbit_times.len() != orbit_states.len() {
        bail!("orbit_times and orbit_states must have the same length");
    }
    let dim = orbit_states[0].len();
    if dim == 0 {
        bail!("State dimension must be positive");
    }
    for (i, state) in orbit_states.iter().enumerate() {
        if state.len() != dim {
            bail!(
                "State {} has dimension {} but expected {}",
                i,
                state.len(),
                dim
            );
        }
    }

    let effective_times: Vec<f64> = match time_mode {
        OrbitTimeMode::Continuous => orbit_times.to_vec(),
        OrbitTimeMode::Discrete => (0..orbit_states.len()).map(|i| i as f64).collect(),
    };

    // Algorithm adapted for orbits that start off the attractor:
    // 1. Use point at 1/3 as reference (after transient decay)
    // 2. Search forward for the FIRST local minimum of distance (first return)
    let n = effective_times.len();
    let ref_idx = n / 3;
    let x_ref = &orbit_states[ref_idx];
    let t_ref = effective_times[ref_idx];

    // Skip a small portion after reference to avoid matching ourselves
    // Use a small fixed skip (not percentage-based) to avoid skipping past the first return
    let skip_start = ref_idx + 10;

    // Compute distances from x_ref to all points after skip_start
    let mut distances: Vec<f64> = Vec::new();
    for i in skip_start..n {
        let x = &orbit_states[i];
        let dist: f64 = x.iter().zip(x_ref.iter()).map(|(a, b)| (a - b).abs()).sum();
        distances.push(dist);
    }

    if distances.len() < 3 {
        bail!("Not enough points after transient for cycle detection");
    }

    // Find the FIRST local minimum that's within tolerance
    // A local minimum is where distances[i-1] > distances[i] < distances[i+1]
    let mut cycle_end = None;
    for i in 1..distances.len() - 1 {
        if distances[i] < distances[i - 1] && distances[i] < distances[i + 1] {
            // This is a local minimum
            if distances[i] < tolerance {
                cycle_end = Some(skip_start + i);
                break;
            }
        }
    }

    // If no local minimum found within tolerance, find the overall minimum
    let min_dist = distances.iter().fold(f64::INFINITY, |a, &b| a.min(b));

    let cycle_end = cycle_end.ok_or_else(|| {
        anyhow!(
            "No cycle detected: no local minimum within tolerance {}. \
                 Closest approach: {:.6}. Try tolerance > {:.4} or longer orbit.",
            tolerance,
            min_dist,
            min_dist * 1.2
        )
    })?;

    // Step 3: Extract one cycle (from ref_idx to cycle_end)
    let period = effective_times[cycle_end] - t_ref;
    if period <= 0.0 {
        bail!("Computed period is non-positive: {}", period);
    }

    // Normalize times to [0, 1] for this cycle
    let cycle_times: Vec<f64> = effective_times[ref_idx..=cycle_end]
        .iter()
        .map(|t| (t - t_ref) / period)
        .collect();
    let cycle_states: Vec<&Vec<f64>> = orbit_states[ref_idx..=cycle_end].iter().collect();

    // Step 4: Remesh to collocation grid
    // We need mesh_points mesh states at uniform intervals: tau = 0, 1/ntst, 2/ntst, ..., (ntst-1)/ntst
    let mut mesh_states = Vec::with_capacity(mesh_points);
    for k in 0..mesh_points {
        let tau = k as f64 / mesh_points as f64;
        let interpolated = interpolate_orbit_state(tau, &cycle_times, &cycle_states, dim)?;
        mesh_states.push(interpolated);
    }

    // Phase condition: use first mesh point and direction of flow at that point
    // For simplicity, we use the initial direction (x1 - x0) normalized
    let phase_anchor = mesh_states[0].clone();
    let dx: Vec<f64> = mesh_states[1]
        .iter()
        .zip(mesh_states[0].iter())
        .map(|(a, b)| a - b)
        .collect();
    let dx_norm: f64 = dx.iter().map(|v| v * v).sum::<f64>().sqrt();
    let phase_direction = if dx_norm > 1e-12 {
        dx.iter().map(|v| v / dx_norm).collect()
    } else {
        // Fallback: use a unit vector in first component
        let mut dir = vec![0.0; dim];
        dir[0] = 1.0;
        dir
    };

    // Build stage states via interpolation
    let coeffs = CollocationCoefficients::new(degree)?;
    let stage_states =
        build_stage_states_from_mesh(dim, mesh_points, degree, &coeffs.nodes, &mesh_states);

    let guess = LimitCycleGuess {
        param_value,
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

/// Linearly interpolate orbit state at normalized time tau in [0, 1]
fn interpolate_orbit_state(
    tau: f64,
    times: &[f64],
    states: &[&Vec<f64>],
    dim: usize,
) -> Result<Vec<f64>> {
    // Find the interval containing tau
    let mut lower = 0;
    for i in 0..times.len() - 1 {
        if times[i] <= tau && tau <= times[i + 1] {
            lower = i;
            break;
        }
        if i == times.len() - 2 {
            // tau is at or past the end
            lower = times.len() - 2;
        }
    }

    let t0 = times[lower];
    let t1 = times[lower + 1];
    let dt = t1 - t0;

    if dt.abs() < 1e-15 {
        // Degenerate interval, just return the state
        return Ok(states[lower].clone());
    }

    let alpha = (tau - t0) / dt;
    let alpha = alpha.clamp(0.0, 1.0);

    let mut result = vec![0.0; dim];
    for i in 0..dim {
        result[i] = states[lower][i] * (1.0 - alpha) + states[lower + 1][i] * alpha;
    }

    Ok(result)
}

/// Initializes a limit cycle continuation from a Period-Doubling bifurcation.
///
/// At a period-doubling bifurcation, a Floquet multiplier ╬╝ = -1 indicates the birth
/// of a new limit cycle with twice the period. This function:
/// 1. Extracts the current LC data from the PD point state
/// 2. Computes the PD eigenvector (null vector of M + I where M is monodromy)
/// 3. Constructs a doubled-period initial guess by perturbing with ┬▒h*eigenvector
///
/// # Arguments
/// * `system` - The equation system
/// * `param_index` - Index of the continuation parameter
/// * `lc_state` - Flattened collocation state at the PD point [mesh, stages, period]
/// * `param_value` - Parameter value at the PD point
/// * `ntst` - Number of mesh intervals in the source LC
/// * `ncol` - Collocation degree
/// * `amplitude` - Perturbation amplitude (h) for stepping onto the new branch
pub fn limit_cycle_setup_from_pd(
    system: &mut EquationSystem,
    param_index: usize,
    lc_state: &[f64],
    param_value: f64,
    ntst: usize,
    ncol: usize,
    amplitude: f64,
) -> Result<LimitCycleSetup> {
    let dim = system.equations.len();

    // Parse the LC state to extract mesh, stages, period
    let mesh_data_len = ntst * dim;
    let stage_data_len = ntst * ncol * dim;
    let expected_len = mesh_data_len + stage_data_len + 1;

    if lc_state.len() != expected_len {
        bail!(
            "Invalid LC state length: expected {} got {}",
            expected_len,
            lc_state.len()
        );
    }

    // Extract original mesh states
    let mut mesh_states: Vec<Vec<f64>> = Vec::with_capacity(ntst);
    for i in 0..ntst {
        let start = i * dim;
        mesh_states.push(lc_state[start..start + dim].to_vec());
    }

    // Extract original period
    let period = lc_state[mesh_data_len + stage_data_len];

    // Build the collocation problem to get the Jacobian for monodromy
    let coeffs = CollocationCoefficients::new(ncol)?;

    // Create phase condition from original cycle
    let phase_anchor = mesh_states[0].clone();
    let mut phase_direction = vec![0.0; dim];
    for d in 0..dim {
        phase_direction[d] = mesh_states[1][d] - mesh_states[0][d];
    }
    let norm = phase_direction.iter().map(|v| v * v).sum::<f64>().sqrt();
    if norm > 1e-12 {
        for d in 0..dim {
            phase_direction[d] /= norm;
        }
    }

    // Build stage states from mesh for creating the problem
    let stage_states = build_stage_states_from_mesh(dim, ntst, ncol, &coeffs.nodes, &mesh_states);

    // Create the collocation problem
    let mut problem = PeriodicOrbitCollocationProblem::new(
        system,
        param_index,
        ntst,
        ncol,
        phase_anchor.clone(),
        phase_direction.clone(),
    )?;

    // Build the augmented state vector [param, mesh, stages, period]
    let aug_len = 1 + mesh_data_len + stage_data_len + 1;
    let mut aug_state = DVector::zeros(aug_len);
    aug_state[0] = param_value;

    // Copy mesh states
    for i in 0..ntst {
        for d in 0..dim {
            aug_state[1 + i * dim + d] = mesh_states[i][d];
        }
    }

    // Copy stage states
    let stage_offset = 1 + mesh_data_len;
    for i in 0..ntst {
        for j in 0..ncol {
            for d in 0..dim {
                let idx = stage_offset + (i * ncol + j) * dim + d;
                aug_state[idx] = stage_states[i][j][d];
            }
        }
    }

    // Period
    aug_state[aug_len - 1] = period;

    // Get the extended Jacobian (with periodic BC [I, -I])
    let jac = problem.extended_jacobian(&aug_state)?;

    // ========== OPTIMIZED: Direct bordered solve for PD eigenvector ==========
    // Instead of computing the full monodromy matrix, we use a bordered-solve approach:
    // 1. Modify the Jacobian to have flip BC [I, I] instead of periodic BC [I, -I]
    // 2. Use bordered linear solve to find the null vector
    // 3. Extract PD eigenvector from the mesh-state portion
    //
    // The flip BC changes the continuity equation from x(T) - x(0) = 0 to x(T) + x(0) = 0
    // In the Jacobian, this means changing the coefficient on x(0) from -I to +I.

    // Jacobian layout (from extended_jacobian):
    // - Rows 0 to ntst*ncol*dim - 1: Collocation equations
    // - Rows ntst*ncol*dim to ntst*ncol*dim + ntst*dim - 1: Continuity equations
    // - Last row: Phase condition
    // - Column 0: Parameter derivatives
    // - Columns 1 to 1+ntst*dim: Mesh states (x_0, ..., x_{ntst-1})
    // - Columns 1+ntst*dim to end-1: Stage states
    // - Last column: Period

    let ncol_coord = ncol * dim;
    let continuity_row_start = ntst * ncol_coord;
    let mesh_col_start = 1; // Skip parameter column

    // Create a copy of the Jacobian and modify BC for flip condition
    // The last continuity block links x_{ntst-1} to x_0
    // For periodic: C_{next} * dx_0 = -... (i.e., coefficient is -I on x_0)
    // For flip: C_{next} * dx_0 = +... (coefficient is +I on x_0)
    //
    // We need to change the sign of the x_0 column in the last continuity equation
    let mut jac_flip = jac.clone();

    // The last continuity equation is at row continuity_row_start + (ntst-1)*dim
    // and has coefficients w.r.t. x_0 at columns mesh_col_start to mesh_col_start+dim
    let last_cont_row = continuity_row_start + (ntst - 1) * dim;
    for r in 0..dim {
        for c in 0..dim {
            // Change sign: x(T) - x(0) = 0 becomes x(T) + x(0) = 0
            // The coefficient on x_0 changes from -1 on diagonal to +1
            let col_idx = mesh_col_start + c;
            let row_idx = last_cont_row + r;
            jac_flip[(row_idx, col_idx)] = -jac_flip[(row_idx, col_idx)];
        }
    }

    // Remove parameter and period columns for the bordered system
    // We only need the state part of the Jacobian (mesh + stages)
    let state_dim = ntst * dim + ntst * ncol * dim; // mesh + stages (no param, no period)
    let n_rows = jac_flip.nrows() - 1; // Exclude phase condition row

    // Extract the state-only part of the Jacobian (skip param col 0 and period col at end)
    let mut jac_state = DMatrix::<f64>::zeros(n_rows, state_dim);
    for r in 0..n_rows {
        for c in 0..state_dim {
            jac_state[(r, c)] = jac_flip[(r, c + 1)]; // Skip param column
        }
    }

    // Create bordered system: [J, b; b^T, 0] where b is a random-ish vector
    // We use a simple bordering vector with some structure
    let bordered_size = n_rows + 1;
    let mut bordered = DMatrix::<f64>::zeros(bordered_size, state_dim + 1);

    // Copy Jacobian into bordered matrix
    for r in 0..n_rows {
        for c in 0..state_dim {
            bordered[(r, c)] = jac_state[(r, c)];
        }
    }

    // Add bordering column (use alternating pattern for numerical stability)
    for r in 0..n_rows {
        bordered[(r, state_dim)] = if r % 2 == 0 { 1.0 } else { -1.0 };
    }

    // Add bordering row
    for c in 0..state_dim {
        bordered[(n_rows, c)] = if c % 3 == 0 { 1.0 } else { 0.0 };
    }
    bordered[(n_rows, state_dim)] = 0.0;

    // RHS: [0, 0, ..., 0, 1]
    let mut rhs = DVector::<f64>::zeros(bordered_size);
    rhs[bordered_size - 1] = 1.0;

    // Solve the bordered system
    let phi_full = bordered
        .clone()
        .lu()
        .solve(&rhs)
        .ok_or_else(|| anyhow!("Bordered solve failed for PD eigenvector"))?;

    // Extract the mesh-state portion (first ntst*dim components)
    // This is the PD eigenvector projected onto mesh points
    let mesh_portion_len = ntst * dim;
    let phi_mesh: Vec<f64> = phi_full.iter().take(mesh_portion_len).cloned().collect();

    // Reconstruct the eigenvector at x(0) - this is what we apply as the perturbation
    // The phi_mesh contains the eigenvector at each mesh point; use the first one
    let pd_eigenvector: Vec<f64> = phi_mesh[0..dim].to_vec();

    // Normalize the eigenvector
    let eig_norm = pd_eigenvector.iter().map(|v| v * v).sum::<f64>().sqrt();
    let pd_eigenvector: Vec<f64> = if eig_norm > 1e-12 {
        pd_eigenvector.iter().map(|v| v / eig_norm).collect()
    } else {
        bail!("PD eigenvector is nearly zero - not at a period-doubling point");
    };

    // Construct doubled-period mesh states
    // First half: original + h * phi
    // Second half: original - h * phi
    let new_ntst = 2 * ntst;
    let mut new_mesh_states: Vec<Vec<f64>> = Vec::with_capacity(new_ntst);

    // First half: original orbit + perturbation
    for i in 0..ntst {
        let mut state = mesh_states[i].clone();
        for d in 0..dim {
            state[d] += amplitude * pd_eigenvector[d];
        }
        new_mesh_states.push(state);
    }

    // Second half: original orbit - perturbation
    for i in 0..ntst {
        let mut state = mesh_states[i].clone();
        for d in 0..dim {
            state[d] -= amplitude * pd_eigenvector[d];
        }
        new_mesh_states.push(state);
    }

    // Build new stage states for doubled mesh
    let new_stage_states =
        build_stage_states_from_mesh(dim, new_ntst, ncol, &coeffs.nodes, &new_mesh_states);

    // New period is double the original
    let new_period = 2.0 * period;

    // Phase condition from first point of new cycle
    let new_phase_anchor = new_mesh_states[0].clone();
    let mut new_phase_direction = vec![0.0; dim];
    for d in 0..dim {
        new_phase_direction[d] = new_mesh_states[1][d] - new_mesh_states[0][d];
    }
    let norm = new_phase_direction
        .iter()
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    if norm > 1e-12 {
        for d in 0..dim {
            new_phase_direction[d] /= norm;
        }
    }

    Ok(LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value,
            period: new_period,
            mesh_states: new_mesh_states,
            stage_states: new_stage_states,
        },
        phase_anchor: new_phase_anchor,
        phase_direction: new_phase_direction,
        mesh_points: new_ntst,
        collocation_degree: ncol,
    })
}

/// Helper function to compute the monodromy matrix from the collocation Jacobian.
/// This extracts M using the shooting-based method.
#[allow(dead_code)]
fn compute_monodromy_matrix(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<DMatrix<f64>> {
    let ncol_coord = ncol * dim;
    let mesh_col_start = 1;
    let stage_col_start = mesh_col_start + ntst * dim;
    let continuity_row_start = ntst * ncol * dim;

    let mut monodromy = DMatrix::<f64>::identity(dim, dim);

    for interval in 0..ntst {
        let cont_row = continuity_row_start + interval * dim;
        let coll_row_start = interval * ncol_coord;
        let stage_col = stage_col_start + interval * ncol_coord;
        let mesh_col = mesh_col_start + interval * dim;
        let next_mesh_col = mesh_col_start + ((interval + 1) % ntst) * dim;

        // Extract G_x, G_s
        let mut g_x = DMatrix::<f64>::zeros(ncol_coord, dim);
        for r in 0..ncol_coord {
            for c in 0..dim {
                g_x[(r, c)] = jac[(coll_row_start + r, mesh_col + c)];
            }
        }

        let mut g_s = DMatrix::<f64>::zeros(ncol_coord, ncol_coord);
        for r in 0..ncol_coord {
            for c in 0..ncol_coord {
                g_s[(r, c)] = jac[(coll_row_start + r, stage_col + c)];
            }
        }

        let ds_dx = match g_s.clone().lu().solve(&-&g_x) {
            Some(sol) => sol,
            None => bail!("Monodromy: singular stage block at interval {}", interval),
        };

        // Extract C_x, C_s, C_next
        let mut c_x = DMatrix::<f64>::zeros(dim, dim);
        for r in 0..dim {
            for c in 0..dim {
                c_x[(r, c)] = jac[(cont_row + r, mesh_col + c)];
            }
        }

        let mut c_s = DMatrix::<f64>::zeros(dim, ncol_coord);
        for r in 0..dim {
            for c in 0..ncol_coord {
                c_s[(r, c)] = jac[(cont_row + r, stage_col + c)];
            }
        }

        let mut c_next = DMatrix::<f64>::zeros(dim, dim);
        for r in 0..dim {
            for c in 0..dim {
                c_next[(r, c)] = jac[(cont_row + r, next_mesh_col + c)];
            }
        }

        let effective_c_x = &c_x + &c_s * &ds_dx;

        let t_i = match c_next.clone().lu().solve(&-&effective_c_x) {
            Some(t) => t,
            None => bail!("Monodromy: singular C_next at interval {}", interval),
        };

        monodromy = &t_i * &monodromy;
    }

    Ok(monodromy)
}

pub struct PeriodicOrbitCollocationProblem<'a> {
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

    fn stage_state_slice<'b>(
        &self,
        aug: &'b DVector<f64>,
        interval: usize,
        stage: usize,
    ) -> &'b [f64] {
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
            let dest = &mut out_slice
                [continuity_offset + interval * dim..continuity_offset + (interval + 1) * dim];
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
                            let mut value =
                                -h * self.coeffs.a[stage][col_stage] * jac_slice[r * dim_state + c];
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
        // Get the full BVP Jacobian
        let jac = self.extended_jacobian(aug_state)?;

        // Extract multipliers using shooting-based monodromy from Jacobian
        let multipliers =
            extract_multipliers_shooting(&jac, self.state_dim(), self.mesh_points, self.degree)?;

        // Compute test functions from multipliers
        let (cycle_fold, period_doubling, neimark, eig_vals) =
            cycle_tests_from_multipliers(&multipliers);

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(cycle_fold, period_doubling, neimark),
            eigenvalues: eig_vals,
            cycle_points: None,
        })
    }
}

/// Shooting-based Floquet multiplier extraction from Jacobian.
///
/// We compute the monodromy by chaining local transfer matrices through each interval:
/// M = T_{ntst-1} * T_{ntst-2} * ... * T_1 * T_0
///
/// For each interval, we eliminate stages using collocation equations and get the
/// mesh-to-mesh transfer from continuity:
/// T_i = -C_{next}^{-1} * (C_x + C_s * ds_dx)
///
/// This approach correctly handles our implicit periodicity BVP where last continuity
/// equation wraps to x_0.
pub fn extract_multipliers_shooting(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<Vec<Complex<f64>>> {
    // Our Jacobian layout:
    // - Rows 0 to ntst*ncol*dim - 1: Stage residuals (collocation equations)
    // - Rows ntst*ncol*dim to ntst*ncol*dim + ntst*dim - 1: Continuity equations
    // - Last row: Phase condition
    //
    // - Column 0: Parameter
    // - Columns 1 to ntst*dim: Mesh states (x_0, x_1, ..., x_{ntst-1})
    // - Columns ntst*dim+1 to ntst*dim + ntst*ncol*dim: Stages
    // - Last column: Period

    let ncol_coord = ncol * dim;
    let mesh_col_start = 1;
    let stage_col_start = mesh_col_start + ntst * dim;
    let continuity_row_start = ntst * ncol * dim;

    // Build monodromy by chaining local transfer matrices
    let mut monodromy = DMatrix::<f64>::identity(dim, dim);

    for interval in 0..ntst {
        let cont_row = continuity_row_start + interval * dim;
        let coll_row_start = interval * ncol_coord;
        let stage_col = stage_col_start + interval * ncol_coord;
        let mesh_col = mesh_col_start + interval * dim;

        // For the last interval, next mesh wraps to x_0
        let next_mesh_col = mesh_col_start + ((interval + 1) % ntst) * dim;

        // Extract G_x (collocation w.r.t. current mesh)
        let mut g_x = DMatrix::<f64>::zeros(ncol_coord, dim);
        for r in 0..ncol_coord {
            for c in 0..dim {
                g_x[(r, c)] = jac[(coll_row_start + r, mesh_col + c)];
            }
        }

        // Extract G_s (collocation w.r.t. stages)
        let mut g_s = DMatrix::<f64>::zeros(ncol_coord, ncol_coord);
        for r in 0..ncol_coord {
            for c in 0..ncol_coord {
                g_s[(r, c)] = jac[(coll_row_start + r, stage_col + c)];
            }
        }

        // Solve: ds_dx = -G_s^{-1} * G_x
        let ds_dx = match g_s.clone().lu().solve(&-&g_x) {
            Some(sol) => sol,
            None => bail!("Monodromy: singular stage block at interval {}", interval),
        };

        // Extract C_x (continuity w.r.t. current mesh)
        let mut c_x = DMatrix::<f64>::zeros(dim, dim);
        for r in 0..dim {
            for c in 0..dim {
                c_x[(r, c)] = jac[(cont_row + r, mesh_col + c)];
            }
        }

        // Extract C_s (continuity w.r.t. stages)
        let mut c_s = DMatrix::<f64>::zeros(dim, ncol_coord);
        for r in 0..dim {
            for c in 0..ncol_coord {
                c_s[(r, c)] = jac[(cont_row + r, stage_col + c)];
            }
        }

        // Extract C_next (continuity w.r.t. next mesh)
        let mut c_next = DMatrix::<f64>::zeros(dim, dim);
        for r in 0..dim {
            for c in 0..dim {
                c_next[(r, c)] = jac[(cont_row + r, next_mesh_col + c)];
            }
        }

        // Effective coefficient: C_x + C_s * ds_dx
        let effective_c_x = &c_x + &c_s * &ds_dx;

        // Transfer matrix: T_i = -C_next^{-1} * effective_c_x
        let t_i = match c_next.clone().lu().solve(&-&effective_c_x) {
            Some(t) => t,
            None => bail!("Monodromy: singular C_next at interval {}", interval),
        };

        // Chain: M = T_i * M
        monodromy = &t_i * &monodromy;
    }

    let eigenvalues: Vec<Complex<f64>> = monodromy.complex_eigenvalues().iter().cloned().collect();
    Ok(eigenvalues)
}

/// Bifurcation tests from Floquet multipliers with sanity check.
///
/// Returns (cycle_fold, period_doubling, neimark_sacker, eigenvalues).
fn cycle_tests_from_multipliers(
    multipliers: &[Complex<f64>],
) -> (f64, f64, f64, Vec<Complex<f64>>) {
    if multipliers.is_empty() {
        return (1.0, 1.0, 1.0, Vec::new());
    }

    let values = multipliers.to_vec();

    // Find the trivial multiplier (should be closest to 1.0)
    let mut trivial_idx = None;
    let mut min_dist = f64::INFINITY;
    for (idx, mu) in values.iter().enumerate() {
        let dist = (mu - Complex::new(1.0, 0.0)).norm();
        if dist < min_dist {
            min_dist = dist;
            trivial_idx = Some(idx);
        }
    }

    const TRIVIAL_TOLERANCE: f64 = 0.5;
    if min_dist > TRIVIAL_TOLERANCE {
        // Multipliers are garbage - return NaN test values to avoid false sign crossings
        return (f64::NAN, f64::NAN, f64::NAN, values);
    }

    // Period Doubling test: product of (╬╝ + 1) for non-trivial real multipliers
    let mut pd_test = 1.0;
    for (idx, mu) in values.iter().enumerate() {
        if Some(idx) == trivial_idx {
            continue;
        }
        if mu.im.abs() < 1e-8 {
            pd_test *= mu.re + 1.0;
        }
    }

    // Neimark-Sacker test: product of (|╬╝|┬▓ - 1) for complex pairs
    let mut ns_test = 1.0;
    for (idx, mu) in values.iter().enumerate() {
        if Some(idx) == trivial_idx {
            continue;
        }
        if mu.im > 1e-8 {
            ns_test *= mu.norm_sqr() - 1.0;
        }
    }

    // Cycle Fold: disabled (set to 1.0)
    let cf_test = 1.0;

    (cf_test, pd_test, ns_test, values)
}

fn validate_mesh_states(state_dim: usize, mesh_points: usize, states: &[Vec<f64>]) -> Result<()> {
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
pub struct CollocationCoefficients {
    pub nodes: Vec<f64>,
    pub a: Vec<Vec<f64>>,
    pub b: Vec<f64>,
}

impl CollocationCoefficients {
    pub fn new(degree: usize) -> Result<Self> {
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

pub fn gauss_legendre_nodes(degree: usize) -> Result<Vec<f64>> {
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

#[allow(dead_code)]
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

#[allow(dead_code)]
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
        vector.push(v_t[(row_index, i)].conj());
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
        cycle_points: None,
    };

    let mut branch = continue_with_problem(&mut problem, point, settings, forward)?;
    branch.branch_type = BranchType::LimitCycle {
        ntst: config.mesh_points,
        ncol: config.degree,
    };
    Ok(branch)
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
    let mut result = extend_branch_with_problem(&mut problem, branch, settings, forward)?;
    result.branch_type = BranchType::LimitCycle {
        ntst: config.mesh_points,
        ncol: config.degree,
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_cycle_setup_from_orbit_uses_discrete_steps_for_time() {
        let orbit_times: Vec<f64> = (0..40).map(|i| i as f64 * 0.5).collect();
        let orbit_states: Vec<Vec<f64>> = (0..40)
            .map(|i| match i % 4 {
                0 => vec![0.0],
                1 => vec![1.0],
                2 => vec![0.0],
                _ => vec![-1.0],
            })
            .collect();

        let setup = limit_cycle_setup_from_orbit(
            &orbit_times,
            &orbit_states,
            0.0,
            10,
            3,
            0.5,
            OrbitTimeMode::Discrete,
        )
        .expect("setup should succeed");

        let expected_period_steps = 12.0;
        assert!(
            (setup.guess.period - expected_period_steps).abs() < 1e-12,
            "expected discrete period {} but got {}",
            expected_period_steps,
            setup.guess.period
        );
    }

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
        assert!(
            pd_before * pd_after < 0.0,
            "Period doubling test function should change sign"
        );

        // Case 3: Exact hit
        let multipliers_exact = vec![
            Complex::new(1.0, 0.0),
            Complex::new(-1.0, 1e-16),
            Complex::new(0.01, 0.0),
        ];
        let (_, pd_exact, _, _) = cycle_tests(&multipliers_exact);
        println!("PD Exact: {}", pd_exact);
        assert!(
            pd_before * pd_exact <= 0.0,
            "Period doubling test should be zero or cross at exact hit"
        );
    }

    #[test]
    fn test_hopf_initialization_accuracy() {
        // Linear Hopf system:
        // dx/dt = mu*x - y
        // dy/dt = x + mu*y
        // Hopf at mu = 0, omega = 1

        // Eq 0: mu*x - y -> LoadParam(0) * LoadVar(0) - LoadVar(1)
        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0));
        ops0.push(OpCode::LoadVar(0));
        ops0.push(OpCode::Mul);
        ops0.push(OpCode::LoadVar(1));
        ops0.push(OpCode::Sub);

        // Eq 1: x + mu*y -> LoadVar(0) + LoadParam(0) * LoadVar(1)
        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadVar(0));
        ops1.push(OpCode::LoadParam(0));
        ops1.push(OpCode::LoadVar(1));
        ops1.push(OpCode::Mul);
        ops1.push(OpCode::Add);

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let params = vec![0.0]; // mu = 0
        let mut system = EquationSystem::new(equations, params);

        let hopf_state = vec![0.0, 0.0];
        let mu_index = 0;
        let mu_value = 0.0;
        let amplitude = 1e-4;
        let ntst = 10;
        let ncol = 4;

        let setup = limit_cycle_setup_from_hopf(
            &mut system,
            mu_index,
            &hopf_state,
            mu_value,
            ntst,
            ncol,
            amplitude,
        )
        .expect("Setup should succeed");

        // Correct the phase anchor to satisfy the point phase condition exactly at start
        let mut setup = setup;
        setup.phase_anchor = setup.guess.mesh_states[0].clone();

        // Residual check
        let mut problem = PeriodicOrbitCollocationProblem::new(
            &mut system,
            mu_index,
            ntst,
            ncol,
            setup.phase_anchor.clone(),
            setup.phase_direction.clone(),
        )
        .expect("Problem creation should succeed");

        let flat_state = flatten_collocation_state(
            &setup.guess.mesh_states,
            &setup.guess.stage_states,
            setup.guess.period,
        );
        let mut aug_state = DVector::zeros(problem.dimension() + 1);
        aug_state[0] = mu_value;
        for (i, &v) in flat_state.iter().enumerate() {
            aug_state[i + 1] = v;
        }

        let mut res = DVector::zeros(problem.dimension());
        problem
            .residual(&aug_state, &mut res)
            .expect("Residual evaluation should succeed");

        let res_norm = res.norm();

        assert!(
            res_norm < 1e-8,
            "Residual norm {} is too high for linear Hopf",
            res_norm
        );
    }

    #[test]
    fn test_hopf_continuation_direction() {
        // Supercritical Hopf Normal Form:
        // dx/dt = mu*x - y - x*(x^2 + y^2)
        // dy/dt = x + mu*y - y*(x^2 + y^2)
        // Hopf at mu = 0. Stable LC exists for mu > 0 with radius sqrt(mu).

        // Bytecode for x equation: mu*x - y - x*(x^2 + y^2)
        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadParam(0)); // mu
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::Mul); // mu*x
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::Sub); // mu*x - y
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::Mul); // x^2
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::Mul); // y^2
        ops0.push(OpCode::Add); // x^2 + y^2
        ops0.push(OpCode::Mul); // x*(x^2 + y^2)
        ops0.push(OpCode::Sub); // mu*x - y - x*(x^2 + y^2)

        // Bytecode for y equation: x + mu*y - y*(x^2 + y^2)
        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::LoadParam(0)); // mu
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::Mul); // mu*y
        ops1.push(OpCode::Add); // x + mu*y
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::Mul); // x^2
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::Mul); // y^2
        ops1.push(OpCode::Add); // x^2 + y^2
        ops1.push(OpCode::Mul); // y*(x^2 + y^2)
        ops1.push(OpCode::Sub); // x + mu*y - y*(x^2 + y^2)

        let equations = vec![Bytecode { ops: ops0 }, Bytecode { ops: ops1 }];
        let params = vec![0.0]; // Start at Hopf point mu = 0
        let mut system = EquationSystem::new(equations, params);

        let ntst = 10;
        let ncol = 4;
        let amplitude = 1e-4;

        // 1. Setup LC guess from Hopf point at mu=0
        let setup =
            limit_cycle_setup_from_hopf(&mut system, 0, &[0.0, 0.0], 0.0, ntst, ncol, amplitude)
                .expect("LC setup should succeed");

        // 2. Run forward continuation (should increase mu)
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-4,
            max_step_size: 0.2,
            max_steps: 50,
            corrector_steps: 5,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = setup.to_problem(&mut system, 0).expect("to_problem failed");
        let initial_aug = setup.guess.to_aug(problem.dimension());
        let initial_tangent =
            super::super::compute_tangent_from_problem(&mut problem, &initial_aug)
                .expect("tangent failed");
        println!("Initial tangent[0] (mu): {}", initial_tangent[0]);

        let branch = continue_limit_cycle_collocation(
            &mut system,
            0,
            setup.collocation_config(),
            setup.guess,
            settings,
            true, // Forward (should be mu > 0)
        )
        .expect("Continuation should succeed");

        assert!(
            branch.points.len() > 1,
            "Should have generated more than one point"
        );
        let last_point = branch.points.last().unwrap();

        println!(
            "Initial mu: {}, Final mu: {}",
            branch.points[0].param_value, last_point.param_value
        );
        assert!(
            last_point.param_value > branch.points[0].param_value,
            "Continuation moved backward! Initial mu: {}, Final mu: {}",
            branch.points[0].param_value,
            last_point.param_value
        );
    }

    fn pd_test_system(mu: f64) -> EquationSystem {
        // Base limit cycle: x' = -y + x*(1 - r^2), y' = x + y*(1 - r^2)
        let mut ops0 = Vec::new();
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::LoadConst(1.0));
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::LoadVar(0)); // x
        ops0.push(OpCode::Mul); // x^2
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::Mul); // y^2
        ops0.push(OpCode::Add); // x^2 + y^2
        ops0.push(OpCode::Sub); // 1 - r^2
        ops0.push(OpCode::Mul); // x*(1 - r^2)
        ops0.push(OpCode::LoadVar(1)); // y
        ops0.push(OpCode::Sub); // x*(1 - r^2) - y

        let mut ops1 = Vec::new();
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::LoadConst(1.0));
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::Mul); // x^2
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::LoadVar(1)); // y
        ops1.push(OpCode::Mul); // y^2
        ops1.push(OpCode::Add); // x^2 + y^2
        ops1.push(OpCode::Sub); // 1 - r^2
        ops1.push(OpCode::Mul); // y*(1 - r^2)
        ops1.push(OpCode::LoadVar(0)); // x
        ops1.push(OpCode::Add); // y*(1 - r^2) + x

        // Transverse subsystem with PD multiplier at mu=0 (omega = 0.5)
        let mut ops2 = Vec::new();
        ops2.push(OpCode::LoadParam(0)); // mu
        ops2.push(OpCode::LoadVar(2)); // z1
        ops2.push(OpCode::Mul); // mu*z1
        ops2.push(OpCode::LoadConst(0.5));
        ops2.push(OpCode::LoadVar(3)); // z2
        ops2.push(OpCode::Mul); // 0.5*z2
        ops2.push(OpCode::Sub); // mu*z1 - 0.5*z2
        ops2.push(OpCode::LoadVar(2)); // z1
        ops2.push(OpCode::LoadVar(2)); // z1
        ops2.push(OpCode::Mul); // z1^2
        ops2.push(OpCode::LoadVar(3)); // z2
        ops2.push(OpCode::LoadVar(3)); // z2
        ops2.push(OpCode::Mul); // z2^2
        ops2.push(OpCode::Add); // z1^2 + z2^2
        ops2.push(OpCode::LoadVar(2)); // z1
        ops2.push(OpCode::Mul); // (z1^2 + z2^2) * z1
        ops2.push(OpCode::Sub); // mu*z1 - 0.5*z2 - r_z^2*z1

        let mut ops3 = Vec::new();
        ops3.push(OpCode::LoadConst(0.5));
        ops3.push(OpCode::LoadVar(2)); // z1
        ops3.push(OpCode::Mul); // 0.5*z1
        ops3.push(OpCode::LoadParam(0)); // mu
        ops3.push(OpCode::LoadVar(3)); // z2
        ops3.push(OpCode::Mul); // mu*z2
        ops3.push(OpCode::Add); // 0.5*z1 + mu*z2
        ops3.push(OpCode::LoadVar(2)); // z1
        ops3.push(OpCode::LoadVar(2)); // z1
        ops3.push(OpCode::Mul); // z1^2
        ops3.push(OpCode::LoadVar(3)); // z2
        ops3.push(OpCode::LoadVar(3)); // z2
        ops3.push(OpCode::Mul); // z2^2
        ops3.push(OpCode::Add); // z1^2 + z2^2
        ops3.push(OpCode::LoadVar(3)); // z2
        ops3.push(OpCode::Mul); // (z1^2 + z2^2) * z2
        ops3.push(OpCode::Sub); // 0.5*z1 + mu*z2 - r_z^2*z2

        let equations = vec![
            Bytecode { ops: ops0 },
            Bytecode { ops: ops1 },
            Bytecode { ops: ops2 },
            Bytecode { ops: ops3 },
        ];
        EquationSystem::new(equations, vec![mu])
    }

    #[test]
    fn test_pd_branch_is_period_doubled() {
        let ntst = 10;
        let ncol = 3;
        let base_period = 2.0 * PI;
        let amplitude = 0.1;
        let mut system = pd_test_system(0.0);

        let mut mesh_states = Vec::with_capacity(ntst);
        for i in 0..ntst {
            let t = base_period * (i as f64) / (ntst as f64);
            mesh_states.push(vec![t.cos(), t.sin(), 0.0, 0.0]);
        }
        let coeffs = CollocationCoefficients::new(ncol).expect("coeffs should build");
        let stage_states = build_stage_states_from_mesh(4, ntst, ncol, &coeffs.nodes, &mesh_states);
        let lc_state = flatten_collocation_state(&mesh_states, &stage_states, base_period);

        let setup =
            limit_cycle_setup_from_pd(&mut system, 0, &lc_state, 0.0, ntst, ncol, amplitude)
                .expect("PD setup should succeed");

        let settings = ContinuationSettings {
            step_size: 0.05,
            min_step_size: 1e-4,
            max_step_size: 0.1,
            max_steps: 3,
            corrector_steps: 5,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let branch = continue_limit_cycle_collocation(
            &mut system,
            0,
            setup.collocation_config(),
            setup.guess,
            settings,
            true,
        )
        .expect("PD continuation should succeed");

        assert!(
            branch.points.len() > 1,
            "PD continuation should advance beyond the seed point"
        );

        let (mesh_points, collocation_degree) = match branch.branch_type {
            BranchType::LimitCycle { ntst, ncol } => (ntst, ncol),
            _ => panic!("Expected limit cycle branch"),
        };
        assert_eq!(
            mesh_points % 2,
            0,
            "Doubled mesh should have even point count"
        );

        let target_point = branch
            .points
            .iter()
            .rev()
            .find(|point| point.param_value.abs() > 1e-4)
            .expect("Continuation did not move away from PD point");

        let dim = system.equations.len();
        let mesh_data_len = mesh_points * dim;
        let stage_data_len = mesh_points * collocation_degree * dim;
        let expected_len = mesh_data_len + stage_data_len + 1;
        assert_eq!(
            target_point.state.len(),
            expected_len,
            "Unexpected state length"
        );

        let half_idx = mesh_points / 2;
        let state0 = &target_point.state[0..dim];
        let state_half = &target_point.state[half_idx * dim..(half_idx + 1) * dim];

        let z_dist =
            ((state_half[2] - state0[2]).powi(2) + (state_half[3] - state0[3]).powi(2)).sqrt();

        assert!(
            z_dist > 1e-2,
            "Period-doubled branch should not return near initial condition at half period; z_dist={}",
            z_dist
        );
    }
}
