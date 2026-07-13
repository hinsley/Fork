use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, BranchType,
    ContinuationBranch, ContinuationPoint, ContinuationSettings,
};
#[allow(unused_imports)]
use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
use crate::equilibrium::{compute_jacobian, compute_param_jacobian, ComplexNumber, SystemKind};
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
    /// Whether this seed represents an already-existing cycle that must be
    /// corrected at fixed parameter before PALC starts.  Branch-switch
    /// predictors from Hopf/PD deliberately leave this false.
    #[serde(default)]
    pub requires_fixed_parameter_correction: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloquetModeVectors {
    pub ntst: usize,
    pub ncol: usize,
    pub multipliers: Vec<ComplexNumber>,
    pub vectors: Vec<Vec<Vec<ComplexNumber>>>,
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
    if param_index >= system.params.len() {
        bail!(
            "Continuation parameter index {} is out of bounds for {} parameters",
            param_index,
            system.params.len()
        );
    }
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
        requires_fixed_parameter_correction: false,
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
/// 1. Validate the sampled trajectory and its time coordinate
/// 2. Search backward through the settled tail for the first oriented return
/// 3. Extract that minimal cycle
/// 4. Remesh to the collocation grid using linear interpolation
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
    if orbit_times.len() != orbit_states.len() {
        bail!("orbit_times and orbit_states must have the same length");
    }
    if orbit_times.len() < 4 {
        bail!("Orbit too short - need at least 4 points");
    }
    if !tolerance.is_finite() || tolerance <= 0.0 {
        bail!("Cycle-detection tolerance must be finite and positive");
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
        if state.iter().any(|value| !value.is_finite()) {
            bail!("State {} contains a non-finite value", i);
        }
    }

    let effective_times: Vec<f64> = match time_mode {
        OrbitTimeMode::Continuous => {
            if orbit_times.iter().any(|time| !time.is_finite()) {
                bail!("Continuous orbit times must be finite");
            }
            if orbit_times.windows(2).any(|pair| pair[1] <= pair[0]) {
                bail!("Continuous orbit times must be strictly increasing");
            }
            orbit_times.to_vec()
        }
        OrbitTimeMode::Discrete => (0..orbit_states.len()).map(|i| i as f64).collect(),
    };

    // Work backward from the settled tail.  For each reference, wait until the
    // trajectory has actually left its tolerance ball, then accept the first
    // local minimum that re-enters it with the same orientation.  The
    // orientation check distinguishes two crossings of the same state (which is
    // essential for sparse scalar observations such as 0, 1, 0, -1).
    let n = effective_times.len();
    let mut detected_cycle = None;
    let mut closest_approach = f64::INFINITY;
    for ref_idx in (0..=n - 3).rev() {
        let mut departed = false;
        // Keep one sample after every candidate so a return must be a genuine
        // two-sided local minimum, not merely the closest point at a truncated
        // trajectory endpoint.
        for candidate in ref_idx + 1..n - 1 {
            let distance = orbit_state_distance(&orbit_states[ref_idx], &orbit_states[candidate]);
            if !departed {
                if distance > tolerance {
                    departed = true;
                }
                continue;
            }

            closest_approach = closest_approach.min(distance);
            if distance > tolerance
                || !oriented_orbit_return(orbit_states, &effective_times, ref_idx, candidate)
            {
                continue;
            }

            let previous =
                orbit_state_distance(&orbit_states[ref_idx], &orbit_states[candidate - 1]);
            let next = orbit_state_distance(&orbit_states[ref_idx], &orbit_states[candidate + 1]);
            if distance <= previous && distance <= next {
                detected_cycle = Some((ref_idx, candidate));
                break;
            }
        }
        if detected_cycle.is_some() {
            break;
        }
    }

    let (ref_idx, cycle_end) = detected_cycle.ok_or_else(|| {
        anyhow!(
            "No cycle detected: no oriented return within tolerance {}. \
                 Closest approach after departure: {:.6}. Try a larger tolerance or longer orbit.",
            tolerance,
            closest_approach,
        )
    })?;

    // Step 3: Extract one cycle (from ref_idx to cycle_end)
    let t_ref = effective_times[ref_idx];
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
        requires_fixed_parameter_correction: true,
    };

    Ok(LimitCycleSetup {
        guess,
        phase_anchor,
        phase_direction,
        mesh_points,
        collocation_degree: degree,
    })
}

fn orbit_state_distance(left: &[f64], right: &[f64]) -> f64 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| (a - b) * (a - b))
        .sum::<f64>()
        .sqrt()
}

fn orbit_direction_at(states: &[Vec<f64>], times: &[f64], index: usize) -> Vec<f64> {
    let dim = states[index].len();
    let difference = |left: usize, right: usize| {
        let dt = times[right] - times[left];
        (0..dim)
            .map(|component| (states[right][component] - states[left][component]) / dt)
            .collect::<Vec<_>>()
    };

    let mut candidates = Vec::with_capacity(3);
    if index > 0 && index + 1 < states.len() {
        candidates.push(difference(index - 1, index + 1));
    }
    if index > 0 {
        candidates.push(difference(index - 1, index));
    }
    if index + 1 < states.len() {
        candidates.push(difference(index, index + 1));
    }

    candidates
        .into_iter()
        .find(|direction| direction.iter().map(|value| value * value).sum::<f64>() > 1e-24)
        .unwrap_or_else(|| vec![0.0; dim])
}

fn oriented_orbit_return(
    states: &[Vec<f64>],
    times: &[f64],
    reference: usize,
    candidate: usize,
) -> bool {
    let reference_direction = orbit_direction_at(states, times, reference);
    let candidate_direction = orbit_direction_at(states, times, candidate);
    let reference_norm = reference_direction
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    let candidate_norm = candidate_direction
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    if reference_norm <= 1e-12 || candidate_norm <= 1e-12 {
        return false;
    }
    let cosine = reference_direction
        .iter()
        .zip(candidate_direction.iter())
        .map(|(left, right)| left * right)
        .sum::<f64>()
        / (reference_norm * candidate_norm);
    cosine > 0.0
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
/// At a period-doubling bifurcation, a Floquet multiplier mu = -1 indicates the birth
/// of a new limit cycle with twice the period. This function:
/// 1. Extracts the current LC data from the PD point state
/// 2. Reconstructs the raw antiperiodic mesh/stage mode from the collocation cocycle
/// 3. Constructs a doubled-period initial guess with opposite mode signs on each half
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
    if ntst < 2 {
        bail!("Period-doubling setup requires at least 2 mesh intervals");
    }
    if !amplitude.is_finite() || amplitude <= 0.0 {
        bail!("Period-doubling perturbation amplitude must be finite and positive");
    }

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

    // Keep the converged collocation stages from the PD point.  Rebuilding
    // these by linear interpolation discards part of the collocation solution
    // and gives a doubled seed that is not on the same discrete orbit.
    let mut stage_states = vec![vec![vec![0.0; dim]; ncol]; ntst];
    for (interval, stages) in stage_states.iter_mut().enumerate() {
        for (stage, state) in stages.iter_mut().enumerate() {
            let start = mesh_data_len + (interval * ncol + stage) * dim;
            state.copy_from_slice(&lc_state[start..start + dim]);
        }
    }

    // Extract original period
    let period = lc_state[mesh_data_len + stage_data_len];
    if !period.is_finite() || period <= 0.0 {
        bail!("Period-doubling source period must be finite and positive");
    }

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
    } else {
        phase_direction[0] = 1.0;
    }

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
    let multipliers = extract_multipliers_collocation(&jac, dim, ntst, ncol)?;
    let flip_distance = multipliers
        .iter()
        .map(|multiplier| (*multiplier + Complex::new(1.0, 0.0)).norm())
        .fold(f64::INFINITY, f64::min);
    const PD_MULTIPLIER_TOLERANCE: f64 = 1e-2;
    if !flip_distance.is_finite() || flip_distance > PD_MULTIPLIER_TOLERANCE {
        bail!(
            "Cannot initialize a doubled cycle: source is not at a period-doubling point (closest Floquet multiplier is {:.3e} from -1, tolerance {:.3e})",
            flip_distance,
            PD_MULTIPLIER_TOLERANCE
        );
    }

    // Compute the antiperiodic collocation eigenfunction directly:
    // 1. Modify the Jacobian to have flip BC [I, I] instead of periodic BC [I, -I]
    // 2. Take the smallest right singular vector of the state-only flip BVP
    // 3. Retain both its mesh and stage components, which are the eigenfunction
    //    propagated through every collocation interval
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

    let svd = SVD::new(jac_state, false, true);
    let (mode_index, smallest_singular_value) = svd.singular_values.iter().enumerate().fold(
        (0usize, f64::INFINITY),
        |(best_index, best_value), (index, &value)| {
            if value < best_value {
                (index, value)
            } else {
                (best_index, best_value)
            }
        },
    );
    let largest_singular_value = svd.singular_values.iter().copied().fold(0.0_f64, f64::max);
    let relative_singular_value =
        smallest_singular_value / largest_singular_value.max(f64::MIN_POSITIVE);
    const PD_RELATIVE_SINGULAR_TOLERANCE: f64 = 1e-3;
    if !relative_singular_value.is_finite()
        || relative_singular_value > PD_RELATIVE_SINGULAR_TOLERANCE
    {
        bail!(
            "Cannot initialize a doubled cycle: antiperiodic collocation mode is not singular enough at the period-doubling point (relative singular value {:.3e}, tolerance {:.3e})",
            relative_singular_value,
            PD_RELATIVE_SINGULAR_TOLERANCE
        );
    }
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("SVD failed for the PD antiperiodic eigenfunction"))?;
    let phi_state: Vec<f64> = v_t.row(mode_index).iter().copied().collect();

    let mut phi_mesh = vec![vec![0.0; dim]; ntst];
    for (interval, state) in phi_mesh.iter_mut().enumerate() {
        state.copy_from_slice(&phi_state[interval * dim..(interval + 1) * dim]);
    }
    let mut phi_stages = vec![vec![vec![0.0; dim]; ncol]; ntst];
    for (interval, stages) in phi_stages.iter_mut().enumerate() {
        for (stage, state) in stages.iter_mut().enumerate() {
            let start = mesh_data_len + (interval * ncol + stage) * dim;
            state.copy_from_slice(&phi_state[start..start + dim]);
        }
    }

    // Scale by the largest pointwise mode norm so `amplitude` remains a direct
    // bound on the state perturbation while preserving its phase dependence.
    let mode_scale = phi_mesh
        .iter()
        .chain(phi_stages.iter().flatten())
        .map(|state| state.iter().map(|value| value * value).sum::<f64>().sqrt())
        .fold(0.0_f64, f64::max);
    if !mode_scale.is_finite() || mode_scale <= 1e-12 {
        bail!("PD eigenfunction is nearly zero - not at a period-doubling point");
    }
    for state in phi_mesh.iter_mut().chain(phi_stages.iter_mut().flatten()) {
        for value in state {
            *value /= mode_scale;
        }
    }

    // Construct doubled-period mesh states
    // First half: original + h * phi
    // Second half: original - h * phi
    let new_ntst = 2 * ntst;
    let mut new_mesh_states: Vec<Vec<f64>> = Vec::with_capacity(new_ntst);

    // First half: original orbit + perturbation
    for i in 0..ntst {
        let mut state = mesh_states[i].clone();
        for d in 0..dim {
            state[d] += amplitude * phi_mesh[i][d];
        }
        new_mesh_states.push(state);
    }

    // Second half: original orbit - perturbation
    for i in 0..ntst {
        let mut state = mesh_states[i].clone();
        for d in 0..dim {
            state[d] -= amplitude * phi_mesh[i][d];
        }
        new_mesh_states.push(state);
    }

    // Double the stored stage solution with the phase-dependent antiperiodic
    // eigenfunction.  Its sign reversal across the seam is what makes this a
    // genuine period-doubled seed rather than two copies shifted uniformly.
    let mut new_stage_states = Vec::with_capacity(new_ntst);
    for sign in [1.0, -1.0] {
        for interval in 0..ntst {
            let mut stages = stage_states[interval].clone();
            for (stage, state) in stages.iter_mut().enumerate() {
                for (component, value) in state.iter_mut().enumerate() {
                    *value += sign * amplitude * phi_stages[interval][stage][component];
                }
            }
            new_stage_states.push(stages);
        }
    }

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
            requires_fixed_parameter_correction: false,
        },
        phase_anchor: new_phase_anchor,
        phase_direction: new_phase_direction,
        mesh_points: new_ntst,
        collocation_degree: ncol,
    })
}

pub struct PeriodicOrbitCollocationProblem<'a> {
    context: FlowContext<'a>,
    mesh_points: usize,
    degree: usize,
    coeffs: CollocationCoefficients,
    /// Stage profile used by the integral phase condition.  It is initialized
    /// lazily from the first state seen by the problem and replaced after each
    /// accepted continuation step.
    phase_reference_stages: Option<Vec<f64>>,
    /// Derivative of the reference profile with respect to normalized time,
    /// evaluated at the Gauss nodes.
    phase_reference_derivative: Option<Vec<f64>>,
    work_stage_f: Vec<f64>,
    work_stage_jac: Vec<f64>,
    work_stage_param: Vec<f64>,
}

const MAX_SCALED_COLLOCATION_DEFECT: f64 = 2.5e-2;
const MIN_RELATIVE_PROFILE_VARIATION: f64 = 1e-10;

impl<'a> PeriodicOrbitCollocationProblem<'a> {
    pub fn new(
        system: &'a mut EquationSystem,
        param_index: usize,
        mesh_points: usize,
        degree: usize,
        phase_anchor: Vec<f64>,
        phase_direction: Vec<f64>,
    ) -> Result<Self> {
        if param_index >= system.params.len() {
            bail!(
                "Continuation parameter index {} is out of bounds for {} parameters",
                param_index,
                system.params.len()
            );
        }
        if mesh_points < 2 {
            bail!("Collocation mesh must have at least 2 points");
        }
        let dim = system.equations.len();
        // Keep validating the serialized seed data for backwards compatibility.
        // The actual gauge is the mesh-independent integral phase condition,
        // initialized from the complete collocation profile on first use.
        let _ = normalize_phase_data(dim, phase_anchor, phase_direction)?;
        let coeffs = CollocationCoefficients::new(degree)?;
        let stage_count = mesh_points * degree;
        Ok(Self {
            context: FlowContext::new(system, param_index),
            mesh_points,
            degree,
            coeffs,
            phase_reference_stages: None,
            phase_reference_derivative: None,
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
        let param_index = self.context.param_index;
        let output = &mut self.work_stage_param;
        self.context.with_param(param, |system| {
            for (idx, state) in stage_states.iter().enumerate() {
                let derivative =
                    compute_param_jacobian(system, SystemKind::Flow, state, param_index)?;
                output[idx * dim..(idx + 1) * dim].copy_from_slice(&derivative);
            }
            Ok(())
        })
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

    fn set_phase_reference(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        if aug_state.len() != self.dimension() + 1 {
            bail!(
                "Phase reference state has length {}, expected {}",
                aug_state.len(),
                self.dimension() + 1
            );
        }
        let period = aug_state[self.period_index()];
        if !period.is_finite() || period <= 0.0 {
            bail!("Phase reference period must be positive and finite");
        }
        let param = aug_state[0];
        let stages = self
            .stage_states(aug_state)
            .into_iter()
            .map(|stage| stage.to_vec())
            .collect::<Vec<_>>();
        let dim = self.state_dim();
        let mut derivative = vec![0.0; stages.len() * dim];
        self.context.with_param(param, |system| {
            let mut flow = vec![0.0; dim];
            for (index, stage) in stages.iter().enumerate() {
                system.apply(0.0, stage, &mut flow);
                for component in 0..dim {
                    // x_ref'(tau) = T_ref f(x_ref(tau)).
                    derivative[index * dim + component] = period * flow[component];
                }
            }
            Ok(())
        })?;
        let derivative_norm = derivative
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        if !derivative_norm.is_finite() || derivative_norm <= 1e-14 {
            bail!("Integral phase condition is singular: reference profile has zero flow");
        }
        self.phase_reference_stages = Some(stages.into_iter().flatten().collect());
        self.phase_reference_derivative = Some(derivative);
        Ok(())
    }

    fn ensure_phase_reference(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        if self.phase_reference_stages.is_none() || self.phase_reference_derivative.is_none() {
            self.set_phase_reference(aug_state)?;
        }
        Ok(())
    }

    fn integral_phase_residual(&self, aug_state: &DVector<f64>) -> Result<f64> {
        let reference = self
            .phase_reference_stages
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase reference is not initialized"))?;
        let derivative = self
            .phase_reference_derivative
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase derivative is not initialized"))?;
        let dim = self.state_dim();
        let mut phase = 0.0;
        for interval in 0..self.mesh_points {
            for stage in 0..self.degree {
                let stage_index = interval * self.degree + stage;
                let current = self.stage_state_slice(aug_state, interval, stage);
                let weight = self.coeffs.b[stage] / self.mesh_points as f64;
                for component in 0..dim {
                    let index = stage_index * dim + component;
                    phase += weight * (current[component] - reference[index]) * derivative[index];
                }
            }
        }
        Ok(phase)
    }

    fn profile_metric_node_weights(&self) -> Result<Vec<f64>> {
        let mut positions = Vec::with_capacity(self.degree + 1);
        positions.push(0.0);
        positions.extend(self.coeffs.nodes.iter().copied());
        let mut weights = Vec::with_capacity(positions.len());
        for index in 0..positions.len() {
            let previous = if index == 0 {
                positions[positions.len() - 1] - 1.0
            } else {
                positions[index - 1]
            };
            let next = if index + 1 == positions.len() {
                1.0
            } else {
                positions[index + 1]
            };
            let weight = 0.5 * (next - previous) / self.mesh_points as f64;
            if !weight.is_finite() || weight <= 0.0 {
                bail!("Collocation nodes do not define a positive PALC quadrature metric");
            }
            weights.push(weight);
        }
        Ok(weights)
    }

    /// A posteriori collocation defect sampled between the Gauss nodes.
    ///
    /// The collocation equations vanish at their nodes by construction, so a
    /// residual-only convergence check can miss an under-resolved orbit.  This
    /// evaluates the collocation polynomial and its derivative at independent
    /// check points and compares the latter with the vector field.
    pub fn scaled_collocation_defect(&mut self, aug_state: &DVector<f64>) -> Result<f64> {
        let dim = self.state_dim();
        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        if !period.is_finite() || period <= 0.0 {
            bail!("Cannot estimate collocation defect for a nonpositive period");
        }
        let h = period / self.mesh_points as f64;
        let mesh_states = self
            .mesh_states(aug_state)
            .into_iter()
            .map(|state| state.to_vec())
            .collect::<Vec<_>>();
        let stage_states = self
            .stage_states(aug_state)
            .into_iter()
            .map(|state| state.to_vec())
            .collect::<Vec<_>>();
        let stage_refs = stage_states.iter().map(Vec::as_slice).collect::<Vec<_>>();
        self.evaluate_stages(param, &stage_refs)?;
        let stage_flows = self.work_stage_f.clone();
        let lagrange = lagrange_coefficients(&self.coeffs.nodes)?;
        let check_count = self.degree + 1;
        let mut max_defect = 0.0_f64;

        self.context.with_param(param, |system| {
            let mut state = vec![0.0; dim];
            let mut actual_flow = vec![0.0; dim];
            for interval in 0..self.mesh_points {
                for check in 0..check_count {
                    // Midpoints of an independent, uniformly spaced check grid
                    // avoid evaluating at either endpoints or Gauss nodes.
                    let tau = (check as f64 + 0.5) / check_count as f64;
                    let mut basis = vec![0.0; self.degree];
                    let mut integrals = vec![0.0; self.degree];
                    for stage in 0..self.degree {
                        let mut power = 1.0;
                        for (degree, coefficient) in lagrange[stage].iter().enumerate() {
                            basis[stage] += coefficient * power;
                            integrals[stage] += coefficient * power * tau / (degree + 1) as f64;
                            power *= tau;
                        }
                    }

                    state.copy_from_slice(&mesh_states[interval]);
                    for component in 0..dim {
                        for stage in 0..self.degree {
                            let index = (interval * self.degree + stage) * dim + component;
                            state[component] += h * integrals[stage] * stage_flows[index];
                        }
                    }
                    system.apply(0.0, &state, &mut actual_flow);

                    for component in 0..dim {
                        let mut polynomial_flow = 0.0;
                        for stage in 0..self.degree {
                            let index = (interval * self.degree + stage) * dim + component;
                            polynomial_flow += basis[stage] * stage_flows[index];
                        }
                        let scale = 1.0 + actual_flow[component].abs().max(polynomial_flow.abs());
                        max_defect = max_defect
                            .max((polynomial_flow - actual_flow[component]).abs() / scale);
                    }
                }
            }
            Ok(())
        })?;
        if !max_defect.is_finite() {
            bail!("Collocation defect estimate is non-finite");
        }
        Ok(max_defect)
    }

    fn validate_collocation_defect(&mut self, aug_state: &DVector<f64>) -> Result<f64> {
        let defect = self.scaled_collocation_defect(aug_state)?;
        if defect > MAX_SCALED_COLLOCATION_DEFECT {
            bail!(
                "Limit-cycle collocation mesh is under-resolved (scaled defect {:.3e} > {:.3e}); increase NTST or NCOL",
                defect,
                MAX_SCALED_COLLOCATION_DEFECT
            );
        }
        Ok(defect)
    }
}

impl<'a> ContinuationProblem for PeriodicOrbitCollocationProblem<'a> {
    fn dimension(&self) -> usize {
        self.unknowns()
    }

    fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
        let dim = self.state_dim();
        let node_weights = self.profile_metric_node_weights()?;
        let mut weights = DVector::from_element(self.dimension() + 1, 1.0);

        // Parameter and period retain unit weights.  Profile entries use a
        // periodic Voronoi quadrature over mesh and Gauss nodes, normalized so
        // a constant profile has the same norm for every NTST/NCOL.
        let mesh_weight = node_weights[0];
        for interval in 0..self.mesh_points {
            for component in 0..dim {
                weights[1 + interval * dim + component] = mesh_weight;
            }
        }
        let stage_start = self.stage_offset();
        for interval in 0..self.mesh_points {
            for stage in 0..self.degree {
                let weight = node_weights[stage + 1];
                let stage_index = interval * self.degree + stage;
                for component in 0..dim {
                    weights[stage_start + stage_index * dim + component] = weight;
                }
            }
        }
        weights[self.period_index()] = 1.0;
        Ok(weights)
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let dim = self.state_dim();
        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        if period <= 0.0 {
            bail!("Period must be positive");
        }
        self.ensure_phase_reference(aug_state)?;
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

        out_slice[phase_index] = self.integral_phase_residual(aug_state)?;
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
        self.ensure_phase_reference(aug_state)?;
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

        // Integral phase condition row:
        // integral <x - x_ref, x_ref'> d tau = 0.
        let phase_row = continuity_offset + self.mesh_points * dim_state;
        let phase_derivative = self
            .phase_reference_derivative
            .as_ref()
            .ok_or_else(|| anyhow!("Integral phase derivative is not initialized"))?;
        for interval in 0..self.mesh_points {
            for stage in 0..self.degree {
                let stage_index = interval * self.degree + stage;
                let col_start = stage_col_start + stage_index * dim_state;
                let weight = self.coeffs.b[stage] / self.mesh_points as f64;
                for component in 0..dim_state {
                    jac[(phase_row, col_start + component)] =
                        weight * phase_derivative[stage_index * dim_state + component];
                }
            }
        }

        Ok(jac)
    }

    fn is_step_acceptable(&mut self, aug_state: &DVector<f64>) -> Result<bool> {
        Ok(self.scaled_collocation_defect(aug_state)? <= MAX_SCALED_COLLOCATION_DEFECT)
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        self.set_phase_reference(aug_state)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        // Get the full BVP Jacobian
        let jac = self.extended_jacobian(aug_state)?;

        let multipliers =
            extract_multipliers_collocation(&jac, self.state_dim(), self.mesh_points, self.degree)?;

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

#[derive(Debug, Clone)]
pub(crate) struct MonodromyData {
    pub transfers: Vec<DMatrix<f64>>,
    pub stage_sensitivities: Vec<DMatrix<f64>>,
    pub multipliers: Vec<Complex<f64>>,
    floquet_roots: Vec<Complex<f64>>,
}

#[derive(Debug, Clone)]
struct CyclicFloquetMode {
    multiplier: Complex<f64>,
    root: Complex<f64>,
    cyclic_vector: Vec<Complex<f64>>,
}

fn complex_pow_usize(mut base: Complex<f64>, mut exponent: usize) -> Complex<f64> {
    let mut result = Complex::new(1.0, 0.0);
    while exponent > 0 {
        if exponent & 1 == 1 {
            result *= base;
        }
        exponent >>= 1;
        if exponent > 0 {
            base *= base;
        }
    }
    result
}

fn wrapped_angle(mut angle: f64) -> f64 {
    angle %= 2.0 * PI;
    if angle <= -PI {
        angle += 2.0 * PI;
    } else if angle > PI {
        angle -= 2.0 * PI;
    }
    angle
}

fn build_block_cyclic_transfer_operator(transfers: &[DMatrix<f64>]) -> Result<DMatrix<f64>> {
    let first = transfers
        .first()
        .ok_or_else(|| anyhow!("Floquet extraction requires at least one transfer matrix."))?;
    let dim = first.nrows();
    if dim == 0 || first.ncols() != dim {
        bail!("Floquet transfer matrices must be square and non-empty.");
    }
    if transfers
        .iter()
        .any(|transfer| transfer.nrows() != dim || transfer.ncols() != dim)
    {
        bail!("Floquet transfer matrices must have a common square dimension.");
    }

    let block_dim = transfers
        .len()
        .checked_mul(dim)
        .ok_or_else(|| anyhow!("Floquet block-cyclic operator dimension overflow."))?;
    // nalgebra does not currently expose a periodic real-Schur decomposition.
    // Refuse pathological dense allocations instead of exhausting the process;
    // practical collocation profiles are far below this limit.
    const MAX_DENSE_CYCLIC_DIMENSION: usize = 2048;
    if block_dim > MAX_DENSE_CYCLIC_DIMENSION {
        bail!(
            "Floquet block-cyclic operator dimension {} exceeds the supported dense limit {}.",
            block_dim,
            MAX_DENSE_CYCLIC_DIMENSION
        );
    }
    let mut cyclic = DMatrix::<f64>::zeros(block_dim, block_dim);
    for (interval, transfer) in transfers.iter().enumerate() {
        let next = (interval + 1) % transfers.len();
        let row_start = next * dim;
        let col_start = interval * dim;
        cyclic
            .view_mut((row_start, col_start), (dim, dim))
            .copy_from(transfer);
    }
    Ok(cyclic)
}

fn canonical_root_score(root: Complex<f64>, interval_count: usize) -> f64 {
    if root.norm() == 0.0 {
        return 0.0;
    }
    let theta = root.arg();
    let multiplier_angle = wrapped_angle(theta * interval_count as f64);
    let canonical_angle = multiplier_angle / interval_count as f64;
    wrapped_angle(theta - canonical_angle).abs()
}

fn multiplier_from_cyclic_root(root: Complex<f64>, interval_count: usize) -> Complex<f64> {
    let modulus = root.norm();
    if modulus == 0.0 {
        return Complex::new(0.0, 0.0);
    }
    let log_modulus = interval_count as f64 * modulus.ln();
    let angle = wrapped_angle(interval_count as f64 * root.arg());
    let magnitude = if log_modulus >= f64::MAX.ln() {
        f64::MAX
    } else if log_modulus <= f64::MIN_POSITIVE.ln() {
        0.0
    } else {
        log_modulus.exp()
    };
    if magnitude == 0.0 {
        Complex::new(0.0, 0.0)
    } else {
        Complex::new(magnitude * angle.cos(), magnitude * angle.sin())
    }
}

fn selected_cyclic_roots(
    cyclic: &DMatrix<f64>,
    dim: usize,
    interval_count: usize,
) -> Result<Vec<(Complex<f64>, Complex<f64>)>> {
    let mut remaining = cyclic
        .complex_eigenvalues()
        .iter()
        .copied()
        .collect::<Vec<_>>();
    if remaining.len() != dim * interval_count {
        bail!(
            "Floquet block-cyclic spectrum returned {} roots; expected {}.",
            remaining.len(),
            dim * interval_count
        );
    }
    if remaining
        .iter()
        .any(|root| !root.re.is_finite() || !root.im.is_finite())
    {
        bail!("Floquet block-cyclic spectrum contains non-finite values.");
    }

    // Partition the N*d roots into rotational families.  This is more robust
    // than simply taking the d roots in a principal sector: a zero multiplier
    // contributes an entire family at the origin, and those roots would all
    // otherwise have the same sector score.
    let mut selected = Vec::with_capacity(dim);
    for _ in 0..dim {
        let seed_index = remaining
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.norm_sqr().total_cmp(&b.norm_sqr()))
            .map(|(index, _)| index)
            .ok_or_else(|| anyhow!("Floquet root-family partition ended early."))?;
        let seed = remaining.swap_remove(seed_index);
        let mut family = Vec::with_capacity(interval_count);
        family.push(seed);
        for rotation_index in 1..interval_count {
            let angle = 2.0 * PI * rotation_index as f64 / interval_count as f64;
            let target = seed * Complex::from_polar(1.0, angle);
            let closest_index = remaining
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    (**a - target)
                        .norm_sqr()
                        .total_cmp(&(**b - target).norm_sqr())
                })
                .map(|(index, _)| index)
                .ok_or_else(|| anyhow!("Floquet root family is incomplete."))?;
            family.push(remaining.swap_remove(closest_index));
        }

        let has_exact_zero = family.iter().any(|root| root.norm() == 0.0);
        family.sort_by(|a, b| {
            canonical_root_score(*a, interval_count)
                .total_cmp(&canonical_root_score(*b, interval_count))
                // Prefer the +pi/N representative at the negative-real boundary.
                .then_with(|| b.im.total_cmp(&a.im))
                .then_with(|| a.re.total_cmp(&b.re))
        });
        let root = if has_exact_zero {
            Complex::new(0.0, 0.0)
        } else {
            family[0]
        };
        let multiplier = if has_exact_zero {
            Complex::new(0.0, 0.0)
        } else {
            multiplier_from_cyclic_root(root, interval_count)
        };
        selected.push((root, multiplier));
    }
    if !remaining.is_empty() {
        bail!(
            "Floquet root-family partition left {} roots unassigned.",
            remaining.len()
        );
    }
    selected.sort_by(|a, b| {
        a.1.re
            .total_cmp(&b.1.re)
            .then_with(|| a.1.im.total_cmp(&b.1.im))
            .then_with(|| a.0.re.total_cmp(&b.0.re))
            .then_with(|| a.0.im.total_cmp(&b.0.im))
    });
    Ok(selected)
}

fn cyclic_floquet_spectrum(
    transfers: &[DMatrix<f64>],
) -> Result<(DMatrix<f64>, Vec<Complex<f64>>, Vec<Complex<f64>>)> {
    let cyclic = build_block_cyclic_transfer_operator(transfers)?;
    let dim = transfers[0].nrows();
    let selected = selected_cyclic_roots(&cyclic, dim, transfers.len())?;
    let roots = selected.iter().map(|(root, _)| *root).collect();
    let multipliers = selected.iter().map(|(_, multiplier)| *multiplier).collect();
    Ok((cyclic, roots, multipliers))
}

fn normalize_cyclic_mode_at_first_mesh(
    cyclic_vector: &mut [Complex<f64>],
    dim: usize,
) -> Result<()> {
    let first = cyclic_vector
        .get(..dim)
        .ok_or_else(|| anyhow!("Floquet cyclic eigenvector is shorter than one mesh block."))?;
    let norm = first
        .iter()
        .map(|value| value.norm_sqr())
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= 1e-14 {
        bail!("Floquet cyclic eigenvector vanishes at the phase-anchor mesh point.");
    }
    let pivot = first
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.norm_sqr().total_cmp(&b.norm_sqr()))
        .map(|(_, value)| *value)
        .unwrap_or_else(|| Complex::new(1.0, 0.0));
    let phase = if pivot.norm() > 0.0 {
        pivot.conj() / pivot.norm()
    } else {
        Complex::new(1.0, 0.0)
    };
    let scale = phase / norm;
    for value in cyclic_vector {
        *value *= scale;
    }
    Ok(())
}

fn build_zero_multiplier_boundary_operator(transfers: &[DMatrix<f64>]) -> Result<DMatrix<f64>> {
    let dim = transfers
        .first()
        .ok_or_else(|| anyhow!("Zero-multiplier mode requires transfer matrices."))?
        .nrows();
    let block_dim = transfers.len() * dim;
    let mut boundary = DMatrix::<f64>::zeros(block_dim, block_dim);
    for (interval, transfer) in transfers.iter().enumerate() {
        let row_start = interval * dim;
        let col_start = interval * dim;
        boundary
            .view_mut((row_start, col_start), (dim, dim))
            .copy_from(transfer);
        if interval + 1 < transfers.len() {
            let next_col = (interval + 1) * dim;
            for component in 0..dim {
                boundary[(row_start + component, next_col + component)] = -1.0;
            }
        }
    }
    Ok(boundary)
}

fn cyclic_floquet_modes_from_selected_roots(
    cyclic: &DMatrix<f64>,
    transfers: &[DMatrix<f64>],
    roots: &[Complex<f64>],
    multipliers: &[Complex<f64>],
) -> Result<Vec<CyclicFloquetMode>> {
    let dim = transfers
        .first()
        .ok_or_else(|| anyhow!("Floquet mode reconstruction requires transfer matrices."))?
        .nrows();
    if roots.len() != dim || multipliers.len() != dim {
        bail!(
            "Floquet mode reconstruction received {} roots and {} multipliers for dimension {}.",
            roots.len(),
            multipliers.len(),
            dim
        );
    }
    let mut modes = vec![None; dim];
    let zero_indices = roots
        .iter()
        .enumerate()
        .filter(|(_, root)| root.norm() == 0.0)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if !zero_indices.is_empty() {
        // gamma=0 makes the balanced cyclic reconstruction singular.  Solve
        // the physical cocycle directly instead:
        // T_i y_i-y_(i+1)=0 and T_(N-1)y_(N-1)=0.
        let boundary = build_zero_multiplier_boundary_operator(transfers)?;
        let zero_vectors =
            compute_complex_eigenvectors(&boundary, Complex::new(0.0, 0.0), zero_indices.len())?;
        for (&index, mut physical_vector) in zero_indices.iter().zip(zero_vectors) {
            normalize_cyclic_mode_at_first_mesh(&mut physical_vector, dim)?;
            modes[index] = Some(CyclicFloquetMode {
                multiplier: Complex::new(0.0, 0.0),
                // `physical_vector` already stores y_i, so no gamma^i scaling.
                root: Complex::new(1.0, 0.0),
                cyclic_vector: physical_vector,
            });
        }
    }
    for mode_index in 0..dim {
        if modes[mode_index].is_some() {
            continue;
        }
        let root = roots[mode_index];
        let root_scale = root.norm().max(1e-12);
        let nearby_group = (mode_index..dim)
            .filter(|&candidate| {
                modes[candidate].is_none()
                    && (roots[candidate] - root).norm()
                        <= 1e-8 * root_scale.max(roots[candidate].norm())
            })
            .collect::<Vec<_>>();
        // A repeated semisimple root can be split by the dense eigensolver at
        // roundoff scale.  Share one orthogonal nullspace basis only when the
        // shifted cyclic operator actually has the requested geometric
        // multiplicity at this root.  Otherwise the nearby roots are distinct
        // and each must be solved at its own eigenvalue.
        let (group, eigenvectors) =
            match compute_complex_eigenvectors(cyclic, root, nearby_group.len()) {
                Ok(vectors) => (nearby_group, vectors),
                Err(nearby_error) => {
                    let exact_group = nearby_group
                        .iter()
                        .copied()
                        .filter(|&candidate| roots[candidate] == root)
                        .collect::<Vec<_>>();
                    if exact_group.len() > 1 {
                        // An algebraically repeated but defective root cannot be
                        // represented by fake extra eigenvectors.
                        return Err(nearby_error);
                    }
                    (
                        vec![mode_index],
                        compute_complex_eigenvectors(cyclic, root, 1)?,
                    )
                }
            };
        let canonical_multiplier = multiplier_from_cyclic_root(root, transfers.len());
        for (&index, mut cyclic_vector) in group.iter().zip(eigenvectors) {
            normalize_cyclic_mode_at_first_mesh(&mut cyclic_vector, dim)?;
            modes[index] = Some(CyclicFloquetMode {
                multiplier: canonical_multiplier,
                root,
                cyclic_vector,
            });
        }
    }
    modes
        .into_iter()
        .map(|mode| mode.ok_or_else(|| anyhow!("Floquet eigenmode assignment is incomplete.")))
        .collect()
}

fn cyclic_mode_mesh_vector(
    mode: &CyclicFloquetMode,
    mesh_index: usize,
    dim: usize,
) -> Result<Vec<Complex<f64>>> {
    let start = mesh_index
        .checked_mul(dim)
        .ok_or_else(|| anyhow!("Floquet mesh-vector index overflow."))?;
    let block = mode.cyclic_vector.get(start..start + dim).ok_or_else(|| {
        anyhow!(
            "Floquet cyclic eigenvector is missing mesh block {}.",
            mesh_index
        )
    })?;
    let scale = complex_pow_usize(mode.root, mesh_index);
    Ok(block.iter().map(|value| *value * scale).collect())
}

pub(crate) fn floquet_real_eigenvector_from_transfers(
    transfers: &[DMatrix<f64>],
    target_multiplier: Complex<f64>,
) -> Result<(Complex<f64>, Vec<f64>)> {
    let (cyclic, roots, multipliers) = cyclic_floquet_spectrum(transfers)?;
    let mode_index = multipliers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            (**a - target_multiplier)
                .norm_sqr()
                .total_cmp(&(**b - target_multiplier).norm_sqr())
        })
        .map(|(index, _)| index)
        .ok_or_else(|| anyhow!("Floquet spectrum is empty."))?;
    let root = roots[mode_index];
    let dim = transfers[0].nrows();
    let (mode_root, mut cyclic_vector) = if root.norm() == 0.0 {
        let boundary = build_zero_multiplier_boundary_operator(transfers)?;
        (
            Complex::new(1.0, 0.0),
            compute_complex_eigenvector(&boundary, Complex::new(0.0, 0.0))?,
        )
    } else {
        (root, compute_complex_eigenvector(&cyclic, root)?)
    };
    normalize_cyclic_mode_at_first_mesh(&mut cyclic_vector, dim)?;
    let mode = CyclicFloquetMode {
        multiplier: multipliers[mode_index],
        root: mode_root,
        cyclic_vector,
    };
    let mesh_vector = cyclic_mode_mesh_vector(&mode, 0, dim)?;
    let imaginary_norm = mesh_vector
        .iter()
        .map(|value| value.im * value.im)
        .sum::<f64>()
        .sqrt();
    if imaginary_norm > 1e-6 {
        bail!(
            "Selected Floquet mode is not real (imaginary norm {:.3e}).",
            imaginary_norm
        );
    }
    let mut real = mesh_vector.iter().map(|value| value.re).collect::<Vec<_>>();
    let norm = real.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !norm.is_finite() || norm <= 1e-14 {
        bail!("Selected Floquet mode has zero real norm.");
    }
    for value in &mut real {
        *value /= norm;
    }
    Ok((mode.multiplier, real))
}

fn extract_collocation_transfer_data_from_jacobian(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<(Vec<DMatrix<f64>>, Vec<DMatrix<f64>>)> {
    // Our Jacobian layout:
    // - Rows 0 to ntst*ncol*dim - 1: Stage residuals (collocation equations)
    // - Rows ntst*ncol*dim to ntst*ncol*dim + ntst*dim - 1: Continuity equations
    // - Last row: Phase condition
    //
    // - Column 0: Parameter
    // - Columns 1 to ntst*dim: Mesh states (x_0, x_1, ..., x_{ntst-1})
    // - Columns ntst*dim+1 to ntst*dim + ntst*ncol*dim: Stages
    // - Last column: Period

    if dim == 0 || ntst == 0 || ncol == 0 {
        bail!("Floquet extraction requires positive dim, ntst, and ncol.");
    }
    let expected_rows = ntst * ncol * dim + ntst * dim + 1;
    let expected_cols = 1 + ntst * dim + ntst * ncol * dim + 1;
    if jac.nrows() < expected_rows || jac.ncols() != expected_cols {
        bail!(
            "Unexpected collocation Jacobian shape {}x{}; expected at least {} rows and exactly {} columns.",
            jac.nrows(),
            jac.ncols(),
            expected_rows,
            expected_cols
        );
    }

    let ncol_coord = ncol * dim;
    let mesh_col_start = 1;
    let stage_col_start = mesh_col_start + ntst * dim;
    let continuity_row_start = ntst * ncol * dim;

    let mut transfers = Vec::with_capacity(ntst);
    let mut stage_sensitivities = Vec::with_capacity(ntst);

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

        stage_sensitivities.push(ds_dx);
        transfers.push(t_i);
    }

    Ok((transfers, stage_sensitivities))
}

/// Extract just the interval transfer matrices from a collocation Jacobian.
///
/// This is used by defining systems that need the smooth variational cocycle
/// but not its eigendecomposition at every residual evaluation.
pub(crate) fn extract_collocation_transfers_from_jacobian(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<Vec<DMatrix<f64>>> {
    extract_collocation_transfer_data_from_jacobian(jac, dim, ntst, ncol)
        .map(|(transfers, _)| transfers)
}

pub(crate) fn extract_monodromy_data_from_collocation_jacobian(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<MonodromyData> {
    let (transfers, stage_sensitivities) =
        extract_collocation_transfer_data_from_jacobian(jac, dim, ntst, ncol)?;
    let (_, floquet_roots, multipliers) = cyclic_floquet_spectrum(&transfers)?;

    Ok(MonodromyData {
        transfers,
        stage_sensitivities,
        multipliers,
        floquet_roots,
    })
}

/// Floquet multiplier extraction from the orthogonal-collocation Jacobian.
///
/// For each interval, we eliminate stages using collocation equations and get the
/// mesh-to-mesh transfer from continuity:
/// T_i = -C_{next}^{-1} * (C_x + C_s * ds_dx)
///
/// The multipliers are then obtained from a block-cyclic eigenproblem rather than
/// an explicitly chained transfer product.  This preserves strongly contracting
/// modes when a cycle is long or stiff.
pub fn extract_multipliers_collocation(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<Vec<Complex<f64>>> {
    let monodromy_data = extract_monodromy_data_from_collocation_jacobian(jac, dim, ntst, ncol)?;
    Ok(monodromy_data.multipliers)
}

/// Backward-compatible name for collocation-based Floquet extraction.
///
/// This function no longer performs shooting or forms a monodromy product for
/// its spectrum; use [`extract_multipliers_collocation`] in new code.
pub fn extract_multipliers_shooting(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<Vec<Complex<f64>>> {
    extract_multipliers_collocation(jac, dim, ntst, ncol)
}

fn decode_cycle_collocation_state(
    cycle_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<f64>>, f64, Vec<f64>)> {
    let stage_len = ntst * ncol * dim;
    let implicit_mesh_len = ntst * dim;
    let explicit_mesh_len = ntst.saturating_add(1) * dim;
    let implicit_len = implicit_mesh_len + stage_len + 1;
    let explicit_len = explicit_mesh_len + stage_len + 1;
    if cycle_state.len() != implicit_len && cycle_state.len() != explicit_len {
        bail!(
            "Invalid limit-cycle state length for Floquet mode computation: expected {} or {}, got {}.",
            implicit_len,
            explicit_len,
            cycle_state.len()
        );
    }
    let period = cycle_state[cycle_state.len() - 1];
    if !period.is_finite() || period <= 0.0 {
        bail!("Cycle period must be a positive finite number.");
    }

    let mesh_count = if cycle_state.len() == explicit_len {
        ntst + 1
    } else {
        ntst
    };
    let mesh_len = mesh_count * dim;
    let raw = &cycle_state[..cycle_state.len() - 1];
    let stage_offset = mesh_len;

    let mut mesh_states = Vec::with_capacity(ntst);
    for interval in 0..ntst {
        let start = interval * dim;
        mesh_states.push(raw[start..start + dim].to_vec());
    }
    let mut stage_states = Vec::with_capacity(ntst * ncol);
    for stage_index in 0..(ntst * ncol) {
        let start = stage_offset + stage_index * dim;
        stage_states.push(raw[start..start + dim].to_vec());
    }

    let mut packed_implicit = Vec::with_capacity(implicit_len);
    for point in &mesh_states {
        packed_implicit.extend_from_slice(point);
    }
    for point in &stage_states {
        packed_implicit.extend_from_slice(point);
    }
    packed_implicit.push(period);

    Ok((mesh_states, stage_states, period, packed_implicit))
}

fn build_cycle_phase_direction(mesh_states: &[Vec<f64>], dim: usize) -> Vec<f64> {
    let mut phase_direction = if mesh_states.len() > 1 {
        mesh_states[1]
            .iter()
            .zip(mesh_states[0].iter())
            .map(|(a, b)| a - b)
            .collect::<Vec<_>>()
    } else {
        vec![0.0; dim]
    };
    let phase_norm = phase_direction.iter().map(|v| v * v).sum::<f64>().sqrt();
    if phase_norm > 1e-12 {
        for value in phase_direction.iter_mut() {
            *value /= phase_norm;
        }
    } else {
        phase_direction = vec![0.0; dim];
        phase_direction[0] = 1.0;
    }
    phase_direction
}

pub(crate) fn compute_cycle_monodromy_data(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
) -> Result<MonodromyData> {
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System has zero dimension.");
    }
    if ntst < 2 {
        bail!("Monodromy extraction requires ntst >= 2.");
    }
    if ncol == 0 {
        bail!("Monodromy extraction requires ncol >= 1.");
    }
    if param_index >= system.params.len() {
        bail!("Parameter index out of bounds for monodromy extraction.");
    }

    let (mesh_states, _stage_states, _period, packed_implicit) =
        decode_cycle_collocation_state(cycle_state, dim, ntst, ncol)?;
    let phase_anchor = mesh_states[0].clone();
    let phase_direction = build_cycle_phase_direction(&mesh_states, dim);

    let param_value = system.params[param_index];
    let mut problem = PeriodicOrbitCollocationProblem::new(
        system,
        param_index,
        ntst,
        ncol,
        phase_anchor,
        phase_direction,
    )?;

    let mut aug_state = DVector::zeros(1 + packed_implicit.len());
    aug_state[0] = param_value;
    for (index, value) in packed_implicit.iter().enumerate() {
        aug_state[index + 1] = *value;
    }
    let jac = problem.extended_jacobian(&aug_state)?;
    extract_monodromy_data_from_collocation_jacobian(&jac, dim, ntst, ncol)
}

pub fn compute_limit_cycle_floquet_modes(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
) -> Result<FloquetModeVectors> {
    let dim = system.equations.len();
    if dim == 0 {
        bail!("System has zero dimension.");
    }
    if ntst < 2 {
        bail!("Floquet mode computation requires ntst >= 2.");
    }
    if ncol == 0 {
        bail!("Floquet mode computation requires ncol >= 1.");
    }
    if param_index >= system.params.len() {
        bail!("Parameter index out of bounds for Floquet mode computation.");
    }

    let (mesh_states, _stage_states, _period, packed_implicit) =
        decode_cycle_collocation_state(cycle_state, dim, ntst, ncol)?;
    let phase_anchor = mesh_states[0].clone();
    let phase_direction = build_cycle_phase_direction(&mesh_states, dim);

    let param_value = system.params[param_index];
    let mut problem = PeriodicOrbitCollocationProblem::new(
        system,
        param_index,
        ntst,
        ncol,
        phase_anchor,
        phase_direction,
    )?;

    let mut aug_state = DVector::zeros(1 + packed_implicit.len());
    aug_state[0] = param_value;
    for (index, value) in packed_implicit.iter().enumerate() {
        aug_state[index + 1] = *value;
    }
    let jac = problem.extended_jacobian(&aug_state)?;
    let monodromy_data = extract_monodromy_data_from_collocation_jacobian(&jac, dim, ntst, ncol)?;
    let cyclic = build_block_cyclic_transfer_operator(&monodromy_data.transfers)?;
    let modes = cyclic_floquet_modes_from_selected_roots(
        &cyclic,
        &monodromy_data.transfers,
        &monodromy_data.floquet_roots,
        &monodromy_data.multipliers,
    )?;
    if modes.is_empty() {
        bail!("Floquet mode computation failed: no multipliers returned.");
    }

    let mut vectors: Vec<Vec<Vec<ComplexNumber>>> = Vec::with_capacity(ntst * (ncol + 1) + 1);
    let initial_vectors = modes
        .iter()
        .map(|mode| cyclic_mode_mesh_vector(mode, 0, dim))
        .collect::<Result<Vec<_>>>()?;
    vectors.push(
        initial_vectors
            .into_iter()
            .map(|mode| mode.into_iter().map(ComplexNumber::from).collect())
            .collect(),
    );

    for interval in 0..ntst {
        let ds_dx = &monodromy_data.stage_sensitivities[interval];
        let mesh_mode_vectors = modes
            .iter()
            .map(|mode| cyclic_mode_mesh_vector(mode, interval, dim))
            .collect::<Result<Vec<_>>>()?;

        for stage in 0..ncol {
            let mode_vectors = mesh_mode_vectors
                .iter()
                .map(|mode| {
                    let stage_vector =
                        apply_stage_transfer_to_complex_vector(ds_dx, stage, dim, mode);
                    stage_vector
                        .into_iter()
                        .map(ComplexNumber::from)
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>();
            vectors.push(mode_vectors);
        }

        let next_mesh_vectors = if interval + 1 < ntst {
            modes
                .iter()
                .map(|mode| cyclic_mode_mesh_vector(mode, interval + 1, dim))
                .collect::<Result<Vec<_>>>()?
        } else {
            modes
                .iter()
                .map(|mode| {
                    let first = cyclic_mode_mesh_vector(mode, 0, dim)?;
                    Ok(first
                        .into_iter()
                        .map(|value| value * mode.multiplier)
                        .collect::<Vec<_>>())
                })
                .collect::<Result<Vec<_>>>()?
        };
        vectors.push(
            next_mesh_vectors
                .into_iter()
                .map(|mode| mode.into_iter().map(ComplexNumber::from).collect())
                .collect(),
        );
    }

    Ok(FloquetModeVectors {
        ntst,
        ncol,
        multipliers: modes
            .iter()
            .map(|mode| ComplexNumber::from(mode.multiplier))
            .collect(),
        vectors,
    })
}

/// Bifurcation tests from Floquet multipliers with sanity check.
///
/// Returns (cycle_fold, period_doubling, neimark_sacker, eigenvalues).
pub(crate) fn cycle_tests_from_multipliers(
    multipliers: &[Complex<f64>],
) -> (f64, f64, f64, Vec<Complex<f64>>) {
    if multipliers.is_empty() {
        return (1.0, 1.0, 1.0, Vec::new());
    }

    let values = multipliers.to_vec();
    if values
        .iter()
        .any(|value| !value.re.is_finite() || !value.im.is_finite())
    {
        return (f64::NAN, f64::NAN, f64::NAN, values);
    }

    let (trivial_idx, trivial_distance) = values
        .iter()
        .enumerate()
        .map(|(index, value)| (index, (*value - Complex::new(1.0, 0.0)).norm()))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .expect("non-empty Floquet spectrum");
    const TRIVIAL_TOLERANCE: f64 = 1e-2;
    if trivial_distance > TRIVIAL_TOLERANCE {
        // An autonomous flow must have one credible multiplier at +1.  Refuse
        // bifurcation flags when the collocation profile is too inaccurate to
        // identify it.
        return (f64::NAN, f64::NAN, f64::NAN, values);
    }

    let saturated_product = |accumulator: f64, factor: f64| {
        let product = accumulator * factor;
        if product.is_finite() {
            product
        } else {
            f64::MAX.copysign(accumulator.signum() * factor.signum())
        }
    };

    let mut cf_test = 1.0;
    let mut pd_test = 1.0;
    let mut ns_test = 1.0;
    for (idx, mu) in values.iter().enumerate() {
        if idx == trivial_idx {
            continue;
        }
        let real_tolerance = 1e-8 * mu.norm().max(1.0);
        if mu.im.abs() <= real_tolerance {
            cf_test = saturated_product(cf_test, mu.re - 1.0);
            pd_test = saturated_product(pd_test, mu.re + 1.0);
        } else if mu.im > real_tolerance {
            // Count one representative of each conjugate pair.
            ns_test = saturated_product(ns_test, mu.norm_sqr() - 1.0);
        }
    }

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

fn validate_stage_states(
    state_dim: usize,
    mesh_points: usize,
    degree: usize,
    stage_states: &[Vec<Vec<f64>>],
) -> Result<()> {
    if stage_states.len() != mesh_points {
        bail!(
            "Initial guess must provide {} stage-state intervals (got {})",
            mesh_points,
            stage_states.len()
        );
    }
    for (interval, stages) in stage_states.iter().enumerate() {
        if stages.len() != degree {
            bail!(
                "Initial guess interval {} must provide {} stage states (got {})",
                interval,
                degree,
                stages.len()
            );
        }
        for (stage, state) in stages.iter().enumerate() {
            if state.len() != state_dim {
                bail!(
                    "Stage state ({}, {}) has dimension {} but expected {}",
                    interval,
                    stage,
                    state.len(),
                    state_dim
                );
            }
        }
    }
    Ok(())
}

fn write_flat_state_to_setup(
    setup: &mut LimitCycleSetup,
    state_dim: usize,
    flat_state: &[f64],
) -> Result<()> {
    let mesh_len = setup.mesh_points * state_dim;
    let stage_len = setup.mesh_points * setup.collocation_degree * state_dim;
    let expected_len = mesh_len + stage_len + 1;
    if flat_state.len() != expected_len {
        bail!(
            "Corrected collocation state has length {} but expected {}",
            flat_state.len(),
            expected_len
        );
    }

    let mut cursor = 0;
    for mesh_state in setup.guess.mesh_states.iter_mut() {
        mesh_state.copy_from_slice(&flat_state[cursor..cursor + state_dim]);
        cursor += state_dim;
    }
    for interval in setup.guess.stage_states.iter_mut() {
        for stage_state in interval.iter_mut() {
            stage_state.copy_from_slice(&flat_state[cursor..cursor + state_dim]);
            cursor += state_dim;
        }
    }
    setup.guess.period = flat_state[cursor];
    Ok(())
}

/// Validate a limit-cycle setup, populate missing collocation stages, and
/// return its canonical flat `[mesh, stages, period]` representation without
/// changing the orbit.
pub fn prepare_limit_cycle_setup(
    mut setup: LimitCycleSetup,
    state_dim: usize,
) -> Result<(LimitCycleSetup, Vec<f64>)> {
    if !setup.guess.param_value.is_finite() {
        bail!("Initial continuation parameter must be finite");
    }
    if !setup.guess.period.is_finite() || setup.guess.period <= 0.0 {
        bail!("Initial period must be finite and positive");
    }
    validate_mesh_states(state_dim, setup.mesh_points, &setup.guess.mesh_states)?;
    if setup.guess.stage_states.is_empty() {
        let coeffs = CollocationCoefficients::new(setup.collocation_degree)?;
        setup.guess.stage_states = build_stage_states_from_mesh(
            state_dim,
            setup.mesh_points,
            setup.collocation_degree,
            &coeffs.nodes,
            &setup.guess.mesh_states,
        );
    }
    validate_stage_states(
        state_dim,
        setup.mesh_points,
        setup.collocation_degree,
        &setup.guess.stage_states,
    )?;
    if setup
        .guess
        .mesh_states
        .iter()
        .flatten()
        .chain(setup.guess.stage_states.iter().flatten().flatten())
        .any(|value| !value.is_finite())
    {
        bail!("Initial collocation state must contain only finite values");
    }
    let flat_state = flatten_collocation_state(
        &setup.guess.mesh_states,
        &setup.guess.stage_states,
        setup.guess.period,
    );
    Ok((setup, flat_state))
}

/// Reject the equilibrium solution family that is embedded in the periodic
/// collocation equations.  Without an amplitude/nontriviality condition, a
/// fixed-parameter Newton solve can converge to a constant equilibrium with
/// an arbitrary positive period and report it as a limit cycle.
fn validate_nontrivial_cycle_profile(
    problem: &PeriodicOrbitCollocationProblem<'_>,
    aug: &DVector<f64>,
) -> Result<()> {
    let dim = problem.state_dim();
    let interval_weight = 1.0 / problem.mesh_points as f64;
    let mut mean = vec![0.0; dim];
    let mut mean_square_norm = 0.0;

    // Gauss weights give a mesh-independent L2 measure over normalized time.
    for interval in 0..problem.mesh_points {
        for stage in 0..problem.degree {
            let weight = interval_weight * problem.coeffs.b[stage];
            let state = problem.stage_state_slice(aug, interval, stage);
            for component in 0..dim {
                mean[component] += weight * state[component];
                mean_square_norm += weight * state[component] * state[component];
            }
        }
    }

    let mut variation_squared = 0.0;
    for interval in 0..problem.mesh_points {
        for stage in 0..problem.degree {
            let weight = interval_weight * problem.coeffs.b[stage];
            let state = problem.stage_state_slice(aug, interval, stage);
            for component in 0..dim {
                let centered = state[component] - mean[component];
                variation_squared += weight * centered * centered;
            }
        }
    }

    let variation = variation_squared.max(0.0).sqrt();
    let state_scale = 1.0 + mean_square_norm.max(0.0).sqrt();
    let minimum_variation = MIN_RELATIVE_PROFILE_VARIATION * state_scale;
    if !variation.is_finite() || variation <= minimum_variation {
        bail!(
            "Fixed-parameter limit-cycle correction failed: converged to an equilibrium or numerically constant profile (RMS variation {:.3e}, required > {:.3e})",
            variation,
            minimum_variation
        );
    }
    Ok(())
}

/// Correct a limit-cycle collocation seed at a fixed continuation parameter.
///
/// Newton updates include all mesh values, all collocation-stage values, and
/// the period. The parameter component is held fixed by dropping its column
/// from the extended collocation Jacobian. The returned flat state has layout
/// `[mesh, stages, period]` and exactly matches the corrected setup.
pub fn correct_limit_cycle_setup(
    system: &mut EquationSystem,
    param_index: usize,
    setup: LimitCycleSetup,
    tolerance: f64,
    max_iterations: usize,
) -> Result<(LimitCycleSetup, Vec<f64>)> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        bail!("Fixed-parameter correction tolerance must be finite and positive");
    }
    if max_iterations == 0 {
        bail!("Fixed-parameter correction requires at least one Newton iteration");
    }
    if param_index >= system.params.len() {
        bail!("Continuation parameter index is out of bounds");
    }
    let state_dim = system.equations.len();
    let (mut setup, flat_state) = prepare_limit_cycle_setup(setup, state_dim)?;
    let mut current = DVector::zeros(flat_state.len() + 1);
    current[0] = setup.guess.param_value;
    current.as_mut_slice()[1..].copy_from_slice(&flat_state);

    let mut problem = setup.to_problem(system, param_index)?;
    let unknown_count = problem.dimension();
    if flat_state.len() != unknown_count {
        bail!(
            "Initial collocation state has length {} but problem expects {}",
            flat_state.len(),
            unknown_count
        );
    }
    validate_nontrivial_cycle_profile(&problem, &current)?;

    let residual_rms = |value: &DVector<f64>| {
        if value.is_empty() {
            0.0
        } else {
            value.norm() / (value.len() as f64).sqrt()
        }
    };

    let mut residual = DVector::zeros(unknown_count);
    problem.residual(&current, &mut residual).map_err(|error| {
        anyhow!("Fixed-parameter limit-cycle correction failed to evaluate residual: {error}")
    })?;
    let initial_norm = residual_rms(&residual);
    if !initial_norm.is_finite() {
        bail!("Fixed-parameter limit-cycle correction failed: non-finite initial residual");
    }

    let mut residual_norm = initial_norm;
    for iteration in 0..=max_iterations {
        if residual_norm <= tolerance {
            validate_nontrivial_cycle_profile(&problem, &current)?;
            problem.validate_collocation_defect(&current).map_err(|error| {
                anyhow!(
                    "Fixed-parameter limit-cycle correction converged algebraically but failed mesh validation: {error}"
                )
            })?;
            let corrected_flat = current.as_slice()[1..].to_vec();
            drop(problem);
            write_flat_state_to_setup(&mut setup, state_dim, &corrected_flat)?;
            setup.guess.requires_fixed_parameter_correction = false;
            return Ok((setup, corrected_flat));
        }
        if iteration == max_iterations {
            break;
        }

        let extended_jacobian = problem.extended_jacobian(&current).map_err(|error| {
            anyhow!(
                "Fixed-parameter limit-cycle correction failed to evaluate Jacobian at iteration {}: {}",
                iteration + 1,
                error
            )
        })?;
        let state_period_jacobian = extended_jacobian
            .view((0, 1), (unknown_count, unknown_count))
            .into_owned();
        let newton_step = state_period_jacobian
            .lu()
            .solve(&(-&residual))
            .ok_or_else(|| {
                anyhow!(
                    "Fixed-parameter limit-cycle correction failed: singular state-period Jacobian at iteration {} (residual {:.3e})",
                    iteration + 1,
                    residual_norm
                )
            })?;
        if newton_step.iter().any(|value| !value.is_finite()) {
            bail!(
                "Fixed-parameter limit-cycle correction failed: non-finite Newton step at iteration {}",
                iteration + 1
            );
        }

        let mut accepted = None;
        let mut step_scale = 1.0;
        for _ in 0..24 {
            let mut trial = current.clone();
            for index in 0..unknown_count {
                trial[index + 1] += step_scale * newton_step[index];
            }
            let trial_period = trial[trial.len() - 1];
            if trial_period.is_finite() && trial_period > 0.0 {
                let mut trial_residual = DVector::zeros(unknown_count);
                if problem.residual(&trial, &mut trial_residual).is_ok() {
                    let trial_norm = residual_rms(&trial_residual);
                    if trial_norm.is_finite()
                        && trial_norm <= residual_norm * (1.0 - 1e-4 * step_scale)
                    {
                        accepted = Some((trial, trial_residual, trial_norm));
                        break;
                    }
                }
            }
            step_scale *= 0.5;
        }

        let Some((trial, trial_residual, trial_norm)) = accepted else {
            bail!(
                "Fixed-parameter limit-cycle correction failed: line search could not reduce residual {:.3e} at iteration {}",
                residual_norm,
                iteration + 1
            );
        };
        current = trial;
        residual = trial_residual;
        residual_norm = trial_norm;
    }

    bail!(
        "Fixed-parameter limit-cycle correction failed to converge in {} iterations: residual {:.3e} (initial {:.3e}, tolerance {:.3e})",
        max_iterations,
        residual_norm,
        initial_norm,
        tolerance
    )
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
    let m = n.div_ceil(2);
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

fn compute_complex_eigenvector(
    mat: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<Vec<Complex<f64>>> {
    compute_complex_eigenvectors(mat, eigenvalue, 1).map(|mut vectors| vectors.remove(0))
}

fn compute_complex_eigenvectors(
    mat: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
    count: usize,
) -> Result<Vec<Vec<Complex<f64>>>> {
    let dim = mat.nrows();
    if dim == 0 || mat.ncols() != dim || count == 0 || count > dim {
        bail!("Invalid matrix or eigenspace dimension for Floquet eigenvectors.");
    }
    let mut shifted = mat.map(|v| Complex::new(v, 0.0));
    for i in 0..dim {
        shifted[(i, i)] -= eigenvalue;
    }
    let svd = SVD::new(shifted, true, true);
    let null_tolerance =
        256.0 * f64::EPSILON * dim as f64 * (mat.norm() + eigenvalue.norm()).max(1.0);
    let geometric_multiplicity = svd
        .singular_values
        .iter()
        .filter(|singular_value| **singular_value <= null_tolerance)
        .count();
    if geometric_multiplicity < count {
        bail!(
            "Floquet root {:?} has geometric multiplicity {}, but {} independent eigenvectors were requested.",
            eigenvalue,
            geometric_multiplicity,
            count
        );
    }
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Failed to compute Floquet eigenvector basis"))?;
    let mut vectors = Vec::with_capacity(count);
    for basis_index in 0..count {
        let row_index = v_t.nrows() - 1 - basis_index;
        let mut vector = Vec::with_capacity(dim);
        for i in 0..dim {
            vector.push(v_t[(row_index, i)].conj());
        }
        vectors.push(vector);
    }
    Ok(vectors)
}

fn apply_stage_transfer_to_complex_vector(
    ds_dx: &DMatrix<f64>,
    stage: usize,
    dim: usize,
    vector: &[Complex<f64>],
) -> Vec<Complex<f64>> {
    let row_start = stage * dim;
    let mut output = vec![Complex::new(0.0, 0.0); dim];
    for row in 0..dim {
        let mut sum = Complex::new(0.0, 0.0);
        for col in 0..dim {
            sum += ds_dx[(row_start + row, col)] * vector[col];
        }
        output[row] = sum;
    }
    output
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
    let setup = LimitCycleSetup {
        guess,
        phase_anchor: config.phase_anchor,
        phase_direction: config.phase_direction,
        mesh_points: config.mesh_points,
        collocation_degree: config.degree,
    };
    let (setup, flat_state) = if setup.guess.requires_fixed_parameter_correction {
        let correction_iterations = settings.corrector_steps.max(8);
        correct_limit_cycle_setup(
            system,
            param_index,
            setup,
            settings.corrector_tolerance,
            correction_iterations,
        )?
    } else {
        prepare_limit_cycle_setup(setup, system.equations.len())?
    };
    let mut problem = setup.to_problem(system, param_index)?;
    let point = ContinuationPoint {
        state: flat_state,
        param_value: setup.guess.param_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
    };

    let mut branch = continue_with_problem(&mut problem, point, settings, forward)?;
    branch.branch_type = BranchType::LimitCycle {
        ntst: setup.mesh_points,
        ncol: setup.collocation_degree,
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

    fn stuart_landau_system() -> EquationSystem {
        // x' = x(1 - x^2 - y^2) - y
        let x_equation = Bytecode {
            ops: vec![
                OpCode::LoadVar(0),
                OpCode::LoadConst(1.0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::Sub,
            ],
        };
        // y' = y(1 - x^2 - y^2) + x
        let y_equation = Bytecode {
            ops: vec![
                OpCode::LoadVar(1),
                OpCode::LoadConst(1.0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::Mul,
                OpCode::LoadVar(0),
                OpCode::Add,
            ],
        };
        EquationSystem::new(vec![x_equation, y_equation], vec![0.0])
    }

    fn parameterized_stuart_landau_system(parameter: f64) -> EquationSystem {
        // x' = x(p - x^2 - y^2) - y
        let x_equation = Bytecode {
            ops: vec![
                OpCode::LoadVar(0),
                OpCode::LoadParam(0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::Sub,
            ],
        };
        // y' = y(p - x^2 - y^2) + x
        let y_equation = Bytecode {
            ops: vec![
                OpCode::LoadVar(1),
                OpCode::LoadParam(0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::Mul,
                OpCode::LoadVar(0),
                OpCode::Add,
            ],
        };
        EquationSystem::new(vec![x_equation, y_equation], vec![parameter])
    }

    fn setup_residual_norm(
        system: &mut EquationSystem,
        param_index: usize,
        setup: &LimitCycleSetup,
    ) -> f64 {
        let mut problem = setup
            .to_problem(system, param_index)
            .expect("collocation problem");
        let aug = setup.guess.to_aug(problem.dimension());
        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(&aug, &mut residual).expect("residual");
        residual.norm()
    }

    fn constant_flow_system() -> EquationSystem {
        EquationSystem::new(
            vec![Bytecode {
                ops: vec![OpCode::LoadConst(1.0)],
            }],
            vec![0.0],
        )
    }

    #[test]
    fn periodic_palc_metric_is_mesh_independent() {
        fn constant_profile_norm(mesh_points: usize, degree: usize) -> f64 {
            let mut system = constant_flow_system();
            let problem = PeriodicOrbitCollocationProblem::new(
                &mut system,
                0,
                mesh_points,
                degree,
                vec![0.0],
                vec![1.0],
            )
            .expect("problem");
            let aug = DVector::zeros(problem.dimension() + 1);
            let weights = problem.palc_metric_weights(&aug).expect("metric");
            let mut profile = DVector::zeros(problem.dimension() + 1);
            for interval in 0..mesh_points {
                profile[1 + interval] = 1.0;
            }
            for stage_index in 0..mesh_points * degree {
                profile[problem.stage_offset() + stage_index] = 1.0;
            }
            profile.dot(&weights.component_mul(&profile)).sqrt()
        }

        let coarse = constant_profile_norm(4, 2);
        let fine = constant_profile_norm(40, 5);
        assert!((coarse - 1.0).abs() < 1e-12, "coarse norm={coarse}");
        assert!((fine - 1.0).abs() < 1e-12, "fine norm={fine}");
        assert!((coarse - fine).abs() < 1e-12);
    }

    #[test]
    fn periodic_collocation_problem_rejects_an_invalid_parameter_index() {
        let mut system = constant_flow_system();
        let error =
            PeriodicOrbitCollocationProblem::new(&mut system, 1, 4, 2, vec![0.0], vec![1.0])
                .err()
                .expect("out-of-range parameter index must be rejected");
        assert!(
            error.to_string().contains("parameter index"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn hopf_limit_cycle_setup_rejects_an_invalid_parameter_index() {
        let mut system = stuart_landau_system();
        let error = limit_cycle_setup_from_hopf(&mut system, 1, &[0.0, 0.0], 0.0, 10, 3, 1e-2)
            .expect_err("out-of-range Hopf parameter index must be rejected");
        assert!(
            error.to_string().contains("parameter index"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn integral_phase_condition_uses_and_updates_the_full_profile() {
        let mut system = constant_flow_system();
        let mut problem =
            PeriodicOrbitCollocationProblem::new(&mut system, 0, 3, 2, vec![0.0], vec![1.0])
                .expect("problem");
        let mut reference = DVector::zeros(problem.dimension() + 1);
        reference[problem.period_index()] = 1.0;
        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&reference, &mut residual)
            .expect("reference residual");
        let phase_row = problem.stage_count() + problem.mesh_points;
        assert!(residual[phase_row].abs() < 1e-14);

        let mut shifted = reference.clone();
        for stage_index in 0..problem.stage_count() {
            shifted[problem.stage_offset() + stage_index] += 0.25;
        }
        problem
            .residual(&shifted, &mut residual)
            .expect("shifted residual");
        assert!(
            (residual[phase_row] - 0.25).abs() < 1e-12,
            "integral phase={}",
            residual[phase_row]
        );

        let jacobian = problem.extended_jacobian(&shifted).expect("Jacobian");
        let stage_row_sum = (0..problem.stage_count())
            .map(|stage_index| jacobian[(phase_row, problem.stage_offset() + stage_index)])
            .sum::<f64>();
        assert!((stage_row_sum - 1.0).abs() < 1e-12);
        for mesh_index in 0..problem.mesh_points {
            assert_eq!(jacobian[(phase_row, 1 + mesh_index)], 0.0);
        }

        problem.update_after_step(&shifted).expect("update phase");
        problem
            .residual(&shifted, &mut residual)
            .expect("updated residual");
        assert!(residual[phase_row].abs() < 1e-14);
    }

    #[test]
    fn collocation_parameter_column_uses_automatic_differentiation() {
        // x' = 1 + p^3 x.  At tiny p, the old fixed finite-difference step
        // produced a derivative dominated by the step squared.
        let equation = Bytecode {
            ops: vec![
                OpCode::LoadConst(1.0),
                OpCode::LoadParam(0),
                OpCode::LoadParam(0),
                OpCode::Mul,
                OpCode::LoadParam(0),
                OpCode::Mul,
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
            ],
        };
        let parameter = 1e-8;
        let mut system = EquationSystem::new(vec![equation], vec![parameter]);
        let mut problem =
            PeriodicOrbitCollocationProblem::new(&mut system, 0, 2, 1, vec![0.0], vec![1.0])
                .expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = parameter;
        aug[problem.stage_offset()] = 2.0;
        aug[problem.stage_offset() + 1] = 3.0;
        aug[problem.period_index()] = 2.0;
        let jacobian = problem.extended_jacobian(&aug).expect("Jacobian");
        let expected = -3.0 * parameter * parameter;
        assert!(
            (jacobian[(0, 0)] - expected).abs() < 1e-28,
            "parameter column={}, expected={expected}",
            jacobian[(0, 0)]
        );
    }

    #[test]
    fn full_collocation_jacobian_matches_finite_differences() {
        // x' = 1 + p x + x^2 exercises parameter, state, period, continuity,
        // stage, and integral-phase derivatives in one compact BVP.
        let equation = Bytecode {
            ops: vec![
                OpCode::LoadConst(1.0),
                OpCode::LoadParam(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
            ],
        };
        let mut system = EquationSystem::new(vec![equation], vec![0.3]);
        let mut problem =
            PeriodicOrbitCollocationProblem::new(&mut system, 0, 3, 2, vec![0.0], vec![1.0])
                .expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = 0.3;
        aug[1] = -0.2;
        aug[2] = 0.4;
        aug[3] = 0.1;
        for (slot, value) in [-0.1, 0.05, 0.2, 0.3, 0.15, -0.05].into_iter().enumerate() {
            aug[problem.stage_offset() + slot] = value;
        }
        aug[problem.period_index()] = 1.7;

        let analytic = problem.extended_jacobian(&aug).expect("analytic Jacobian");
        for column in 0..analytic.ncols() {
            let epsilon = 1e-7 * (1.0 + aug[column].abs());
            let mut plus = aug.clone();
            let mut minus = aug.clone();
            plus[column] += epsilon;
            minus[column] -= epsilon;
            let mut plus_residual = DVector::zeros(problem.dimension());
            let mut minus_residual = DVector::zeros(problem.dimension());
            problem
                .residual(&plus, &mut plus_residual)
                .expect("positive perturbation");
            problem
                .residual(&minus, &mut minus_residual)
                .expect("negative perturbation");
            let finite_difference = (plus_residual - minus_residual) / (2.0 * epsilon);
            let analytic_column = analytic.column(column).into_owned();
            let scale = 1.0_f64
                .max(finite_difference.norm())
                .max(analytic_column.norm());
            let relative_error = (&finite_difference - analytic_column).norm() / scale;
            assert!(
                relative_error < 2e-7,
                "column {column} relative error {relative_error:.3e}"
            );
        }
    }

    #[test]
    fn collocation_defect_detects_an_underresolved_profile() {
        let equation = Bytecode {
            ops: vec![
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadConst(1.0),
                OpCode::Add,
            ],
        };
        let mut system = EquationSystem::new(vec![equation], vec![0.0]);
        let mut problem =
            PeriodicOrbitCollocationProblem::new(&mut system, 0, 2, 1, vec![1.0], vec![1.0])
                .expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[1] = 1.0;
        aug[2] = 2.0;
        aug[problem.stage_offset()] = 8.0;
        aug[problem.stage_offset() + 1] = 0.25;
        aug[problem.period_index()] = 5.0;
        let defect = problem
            .scaled_collocation_defect(&aug)
            .expect("defect estimate");
        assert!(defect > 0.1, "expected large defect, got {defect:.3e}");
        assert!(
            !problem
                .is_step_acceptable(&aug)
                .expect("step acceptance check"),
            "an under-resolved collocation point must be rejected for a smaller retry"
        );
    }

    #[test]
    fn fixed_parameter_correction_solves_sampled_stuart_landau_cycle() {
        let mesh_points = 20;
        let degree = 4;
        let period = 2.0 * PI;
        let mesh_states = (0..mesh_points)
            .map(|index| {
                let theta = period * index as f64 / mesh_points as f64;
                vec![theta.cos(), theta.sin()]
            })
            .collect::<Vec<_>>();
        let coeffs = CollocationCoefficients::new(degree).expect("coefficients");
        let stage_states =
            build_stage_states_from_mesh(2, mesh_points, degree, &coeffs.nodes, &mesh_states);
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            mesh_points,
            collocation_degree: degree,
        };
        let mut system = stuart_landau_system();
        let initial_residual = setup_residual_norm(&mut system, 0, &setup);
        assert!(
            initial_residual > 1e-3,
            "sampled seed should require correction, residual={initial_residual:.3e}"
        );

        let (corrected, flat_state) = correct_limit_cycle_setup(&mut system, 0, setup, 1e-10, 12)
            .expect("fixed-parameter correction");
        let corrected_residual = setup_residual_norm(&mut system, 0, &corrected);
        assert!(
            corrected_residual <= 1e-10,
            "corrected residual {corrected_residual:.3e} exceeds tolerance"
        );
        assert_eq!(
            flat_state,
            flatten_collocation_state(
                &corrected.guess.mesh_states,
                &corrected.guess.stage_states,
                corrected.guess.period,
            ),
            "returned flat state must preserve the corrected stage variables"
        );
        assert!((corrected.guess.period - period).abs() < 1e-4);

        let corrected_radii = corrected
            .guess
            .mesh_states
            .iter()
            .map(|state| state[0].hypot(state[1]))
            .collect::<Vec<_>>();
        let maximum_radius_error = corrected_radii
            .iter()
            .map(|radius| (radius - 1.0).abs())
            .fold(0.0_f64, f64::max);
        assert!(
            maximum_radius_error < 1e-6,
            "corrected profile left the unit cycle by {maximum_radius_error:.3e}"
        );
        let x_span = corrected
            .guess
            .mesh_states
            .iter()
            .map(|state| state[0])
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), value| {
                (min.min(value), max.max(value))
            });
        assert!(
            x_span.1 - x_span.0 > 1.9,
            "corrected cycle collapsed to an almost-constant profile"
        );

        let (corrected_again, flat_again) =
            correct_limit_cycle_setup(&mut system, 0, corrected, 1e-10, 12)
                .expect("idempotent correction");
        assert_eq!(flat_again, flat_state);
        assert!(setup_residual_norm(&mut system, 0, &corrected_again) <= 1e-10);
    }

    #[test]
    fn fixed_parameter_correction_rejects_an_equilibrium_profile() {
        let mut system = EquationSystem::new(
            vec![Bytecode {
                ops: vec![OpCode::LoadConst(0.0)],
            }],
            vec![0.0],
        );
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period: 2.0,
                mesh_states: vec![vec![3.0]; 4],
                stage_states: vec![vec![vec![3.0]; 2]; 4],
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![3.0],
            phase_direction: vec![1.0],
            mesh_points: 4,
            collocation_degree: 2,
        };

        let error = correct_limit_cycle_setup(&mut system, 0, setup, 1e-10, 8)
            .expect_err("an equilibrium must not be accepted as a limit cycle");
        let message = error.to_string();
        assert!(
            message.contains("constant profile") || message.contains("zero flow"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn continuation_rejects_nonexistent_periodic_orbit_during_seed_correction() {
        let mut system = EquationSystem::new(
            vec![Bytecode {
                ops: vec![OpCode::LoadConst(1.0)],
            }],
            vec![0.0],
        );
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period: 1.0,
                mesh_states: vec![vec![0.0]; 4],
                stage_states: vec![vec![vec![0.0]; 2]; 4],
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![0.0],
            phase_direction: vec![1.0],
            mesh_points: 4,
            collocation_degree: 2,
        };

        let config = setup.collocation_config();
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 0,
            corrector_steps: 8,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        };
        let error =
            continue_limit_cycle_collocation(&mut system, 0, config, setup.guess, settings, true)
                .expect_err("x'=1 has no positive-period orbit");
        assert!(
            error
                .to_string()
                .contains("Fixed-parameter limit-cycle correction failed"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn limit_cycle_setup_from_orbit_uses_discrete_steps_for_time() {
        let orbit_times: Vec<f64> = (0..41).map(|i| i as f64 * 0.5).collect();
        let orbit_states: Vec<Vec<f64>> = (0..41)
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

        let expected_period_steps = 4.0;
        assert!(
            (setup.guess.period - expected_period_steps).abs() < 1e-12,
            "expected discrete period {} but got {}",
            expected_period_steps,
            setup.guess.period
        );
    }

    #[test]
    fn limit_cycle_setup_from_orbit_finds_minimal_continuous_return_after_transient() {
        let mut orbit_times = Vec::new();
        let mut orbit_states = Vec::new();

        // A short non-recurrent transient followed by a circle sampled only four
        // times per period.  The physical period is 2.0 time units.
        for (index, state) in [[4.0, 0.0], [2.5, 0.5], [1.5, -0.25]]
            .into_iter()
            .enumerate()
        {
            orbit_times.push(index as f64 * 0.5);
            orbit_states.push(state.to_vec());
        }
        for sample in 0..=16 {
            let phase = 2.0 * PI * (sample % 4) as f64 / 4.0;
            orbit_times.push((sample + 3) as f64 * 0.5);
            orbit_states.push(vec![phase.cos(), phase.sin()]);
        }

        let setup = limit_cycle_setup_from_orbit(
            &orbit_times,
            &orbit_states,
            0.0,
            12,
            3,
            1e-8,
            OrbitTimeMode::Continuous,
        )
        .expect("continuous orbit setup should succeed");

        assert!(
            (setup.guess.period - 2.0).abs() < 1e-12,
            "expected the first 2.0-time-unit return, got {}",
            setup.guess.period
        );
    }

    #[test]
    fn limit_cycle_setup_from_orbit_rejects_invalid_continuous_times() {
        let states: Vec<Vec<f64>> = (0..8)
            .map(|index| {
                let phase = 2.0 * PI * (index % 4) as f64 / 4.0;
                vec![phase.cos(), phase.sin()]
            })
            .collect();

        let non_increasing = vec![0.0, 0.5, 1.0, 1.5, 1.5, 2.5, 3.0, 3.5];
        let error = limit_cycle_setup_from_orbit(
            &non_increasing,
            &states,
            0.0,
            8,
            3,
            1e-8,
            OrbitTimeMode::Continuous,
        )
        .expect_err("duplicate continuous times must be rejected");
        assert!(error.to_string().contains("strictly increasing"));

        let mut non_finite = vec![0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
        non_finite[3] = f64::NAN;
        let error = limit_cycle_setup_from_orbit(
            &non_finite,
            &states,
            0.0,
            8,
            3,
            1e-8,
            OrbitTimeMode::Continuous,
        )
        .expect_err("non-finite continuous times must be rejected");
        assert!(error.to_string().contains("finite"));
    }

    #[test]
    fn stable_orbit_seed_is_corrected_continued_and_has_exact_floquet_data() {
        let samples_per_period = 40usize;
        let sample_count = 4 * samples_per_period + 1;
        let dt = 2.0 * PI / samples_per_period as f64;
        let orbit_times = (0..sample_count)
            .map(|index| index as f64 * dt)
            .collect::<Vec<_>>();
        let orbit_states = orbit_times
            .iter()
            .map(|time| vec![time.cos(), time.sin()])
            .collect::<Vec<_>>();
        let setup = limit_cycle_setup_from_orbit(
            &orbit_times,
            &orbit_states,
            1.0,
            20,
            4,
            0.2,
            OrbitTimeMode::Continuous,
        )
        .expect("stable Orbit seed");
        assert!((setup.guess.period - 2.0 * PI).abs() < 1e-12);

        let config = setup.collocation_config();
        let ntst = config.mesh_points;
        let settings = ContinuationSettings {
            step_size: 0.02,
            min_step_size: 1e-4,
            max_step_size: 0.02,
            max_steps: 3,
            corrector_steps: 10,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        };
        let mut system = parameterized_stuart_landau_system(1.0);
        let branch =
            continue_limit_cycle_collocation(&mut system, 0, config, setup.guess, settings, true)
                .expect("Orbit-seeded collocation continuation");
        assert!(
            branch.points.len() >= 2,
            "continuation did not leave the seed"
        );
        assert!(branch.points[1].param_value > branch.points[0].param_value);

        for point in &branch.points {
            let expected_radius = point.param_value.sqrt();
            let maximum_radius_error = (0..ntst)
                .map(|mesh_index| {
                    let offset = mesh_index * 2;
                    point.state[offset].hypot(point.state[offset + 1])
                })
                .map(|radius| (radius - expected_radius).abs())
                .fold(0.0_f64, f64::max);
            assert!(
                maximum_radius_error < 2e-6,
                "p={} profile radius error={maximum_radius_error:.3e}",
                point.param_value
            );
            assert!((point.state.last().copied().expect("period") - 2.0 * PI).abs() < 2e-6);
            assert_eq!(point.eigenvalues.len(), 2);
            let trivial_index = point
                .eigenvalues
                .iter()
                .enumerate()
                .min_by(|(_, left), (_, right)| {
                    (**left - Complex::new(1.0, 0.0))
                        .norm_sqr()
                        .total_cmp(&(**right - Complex::new(1.0, 0.0)).norm_sqr())
                })
                .map(|(index, _)| index)
                .expect("trivial multiplier");
            assert!((point.eigenvalues[trivial_index] - Complex::new(1.0, 0.0)).norm() < 2e-6);
            let transverse = point.eigenvalues[1 - trivial_index];
            let expected_transverse = (-4.0 * PI * point.param_value).exp();
            assert!(transverse.im.abs() < 1e-8);
            assert!(
                (transverse.re - expected_transverse).abs() < 2e-8,
                "p={} transverse multiplier {:?}, expected {expected_transverse:.9e}",
                point.param_value,
                transverse
            );
            assert!(
                transverse.norm() < 1.0,
                "the continued cycle must remain stable"
            );
        }
    }

    fn synthetic_scalar_collocation_jacobian() -> DMatrix<f64> {
        let dim = 1usize;
        let ntst = 2usize;
        let ncol = 1usize;
        let rows = ntst * ncol * dim + ntst * dim + 1;
        let cols = 1 + ntst * dim + ntst * ncol * dim + 1;
        let mut jac = DMatrix::<f64>::zeros(rows, cols);

        // Interval 0 blocks:
        // ds/dx = -g_x / g_s = -1/2 = -0.5
        jac[(0, 1)] = 1.0; // G_x
        jac[(0, 3)] = 2.0; // G_s
                           // T0 = - (c_x + c_s * ds/dx) / c_next = -(1.2 + 0.4 * -0.5) / 2 = -0.5
        jac[(2, 1)] = 1.2; // C_x
        jac[(2, 3)] = 0.4; // C_s
        jac[(2, 2)] = 2.0; // C_next

        // Interval 1 blocks:
        // ds/dx = -g_x / g_s = -(-2)/4 = 0.5
        jac[(1, 2)] = -2.0; // G_x
        jac[(1, 4)] = 4.0; // G_s
                           // T1 = - (c_x + c_s * ds/dx) / c_next = -(0.6 + 0.8 * 0.5) / 1 = -1.0
        jac[(3, 2)] = 0.6; // C_x
        jac[(3, 4)] = 0.8; // C_s
        jac[(3, 1)] = 1.0; // C_next (wrap to x_0)

        jac
    }

    #[test]
    fn collocation_condensation_extracts_expected_scalar_transfers_and_spectrum() {
        let dim = 1usize;
        let ntst = 2usize;
        let ncol = 1usize;
        let jac = synthetic_scalar_collocation_jacobian();

        let data = extract_monodromy_data_from_collocation_jacobian(&jac, dim, ntst, ncol)
            .expect("collocation transfer extraction should succeed");

        assert_eq!(data.transfers.len(), ntst);
        assert_eq!(data.stage_sensitivities.len(), ntst);

        let ds0 = data.stage_sensitivities[0][(0, 0)];
        let ds1 = data.stage_sensitivities[1][(0, 0)];
        assert!((ds0 + 0.5).abs() < 1e-12, "expected ds0=-0.5, got {}", ds0);
        assert!((ds1 - 0.5).abs() < 1e-12, "expected ds1=0.5, got {}", ds1);

        let t0 = data.transfers[0][(0, 0)];
        let t1 = data.transfers[1][(0, 0)];
        assert!((t0 + 0.5).abs() < 1e-12, "expected T0=-0.5, got {}", t0);
        assert!((t1 + 1.0).abs() < 1e-12, "expected T1=-1.0, got {}", t1);

        assert_eq!(data.multipliers.len(), 1);
        assert!(data.multipliers[0].im.abs() < 1e-12);
        assert!((data.multipliers[0].re - 0.5).abs() < 1e-12);
    }

    #[test]
    fn public_collocation_multiplier_api_matches_condensed_spectrum() {
        let dim = 1usize;
        let ntst = 2usize;
        let ncol = 1usize;
        let jac = synthetic_scalar_collocation_jacobian();
        let data = extract_monodromy_data_from_collocation_jacobian(&jac, dim, ntst, ncol)
            .expect("collocation transfer extraction should succeed");
        let multipliers =
            extract_multipliers_collocation(&jac, dim, ntst, ncol).expect("multiplier extraction");

        assert_eq!(multipliers.len(), dim);
        let lambda = multipliers[0];
        assert!(
            lambda.im.abs() < 1e-12,
            "expected real multiplier, got {:?}",
            lambda
        );
        assert!((lambda - data.multipliers[0]).norm() < 1e-12);
    }

    fn rotation_matrix(angle: f64) -> DMatrix<f64> {
        DMatrix::from_row_slice(2, 2, &[angle.cos(), -angle.sin(), angle.sin(), angle.cos()])
    }

    #[test]
    fn block_cyclic_spectrum_matches_scalar_and_complex_transfer_products() {
        let scalar_transfers = vec![
            DMatrix::from_element(1, 1, 2.0),
            DMatrix::from_element(1, 1, 0.25),
            DMatrix::from_element(1, 1, 3.0),
        ];
        let (_, _, scalar_multipliers) =
            cyclic_floquet_spectrum(&scalar_transfers).expect("scalar cyclic spectrum");
        assert_eq!(scalar_multipliers.len(), 1);
        assert!((scalar_multipliers[0].re - 1.5).abs() < 1e-12);
        assert!(scalar_multipliers[0].im.abs() < 1e-12);

        let negative_transfers = vec![
            DMatrix::from_element(1, 1, -0.5),
            DMatrix::from_element(1, 1, 2.0),
            DMatrix::from_element(1, 1, 1.0),
        ];
        let (_, _, negative_multipliers) =
            cyclic_floquet_spectrum(&negative_transfers).expect("negative cyclic spectrum");
        assert!((negative_multipliers[0].re + 1.0).abs() < 1e-12);
        assert!(negative_multipliers[0].im.abs() < 1e-12);
        let (_, negative_mode) =
            floquet_real_eigenvector_from_transfers(&negative_transfers, Complex::new(-1.0, 0.0))
                .expect("negative real Floquet mode");
        assert!((negative_mode[0].abs() - 1.0).abs() < 1e-12);

        let ntst = 7usize;
        let expected_radius = 1.7f64;
        let expected_angle = 0.8f64;
        let local =
            rotation_matrix(expected_angle / ntst as f64) * expected_radius.powf(1.0 / ntst as f64);
        let transfers = vec![local; ntst];
        let (_, _, multipliers) =
            cyclic_floquet_spectrum(&transfers).expect("complex cyclic spectrum");
        assert_eq!(multipliers.len(), 2);
        for multiplier in multipliers {
            assert!((multiplier.norm() - expected_radius).abs() < 2e-11);
            assert!((multiplier.im.abs() - expected_radius * expected_angle.sin()).abs() < 2e-11);
        }
    }

    #[test]
    fn block_cyclic_spectrum_preserves_stiff_rotating_directions() {
        let ntst = 20usize;
        let local_growth = (128.0 / ntst as f64).exp();
        let local_decay = (-128.0 / ntst as f64).exp();
        let local_diagonal =
            DMatrix::from_diagonal(&DVector::from_vec(vec![local_growth, local_decay]));
        let mut transfers = Vec::with_capacity(ntst);
        for interval in 0..ntst {
            let current_angle = 2.0 * PI * interval as f64 / ntst as f64;
            let next_angle = 2.0 * PI * (interval + 1) as f64 / ntst as f64;
            transfers.push(
                rotation_matrix(next_angle)
                    * &local_diagonal
                    * rotation_matrix(current_angle).transpose(),
            );
        }

        let (_, _, multipliers) =
            cyclic_floquet_spectrum(&transfers).expect("stiff cyclic spectrum");
        assert_eq!(multipliers.len(), 2);
        let mut log_moduli = multipliers
            .iter()
            .map(|multiplier| multiplier.norm().ln())
            .collect::<Vec<_>>();
        log_moduli.sort_by(f64::total_cmp);
        assert!(
            (log_moduli[0] + 128.0).abs() < 2e-8,
            "contracting log multiplier was {}",
            log_moduli[0]
        );
        assert!(
            (log_moduli[1] - 128.0).abs() < 2e-8,
            "expanding log multiplier was {}",
            log_moduli[1]
        );
    }

    #[test]
    fn block_cyclic_spectrum_collapses_zero_root_families_once() {
        let transfers = vec![
            DMatrix::from_diagonal(&DVector::from_vec(vec![0.0, 2.0])),
            DMatrix::identity(2, 2),
            DMatrix::identity(2, 2),
        ];
        let (_, _, multipliers) =
            cyclic_floquet_spectrum(&transfers).expect("singular cyclic spectrum");
        assert_eq!(multipliers.len(), 2);
        assert!(multipliers.iter().any(|value| value.norm() == 0.0));
        assert!(multipliers
            .iter()
            .any(|value| (value.re - 2.0).abs() < 1e-12 && value.im.abs() < 1e-12));
        let (cyclic, roots, _) =
            cyclic_floquet_spectrum(&transfers).expect("singular cyclic roots");
        let modes =
            cyclic_floquet_modes_from_selected_roots(&cyclic, &transfers, &roots, &multipliers)
                .expect("zero-multiplier raw mode");
        let zero_mode = modes
            .iter()
            .find(|mode| mode.multiplier.norm() == 0.0)
            .expect("zero mode");
        for interval in 0..transfers.len() - 1 {
            let current = cyclic_mode_mesh_vector(zero_mode, interval, 2).expect("current mesh");
            let next = cyclic_mode_mesh_vector(zero_mode, interval + 1, 2).expect("next mesh");
            for row in 0..2 {
                let transported = (0..2).fold(Complex::new(0.0, 0.0), |sum, col| {
                    sum + transfers[interval][(row, col)] * current[col]
                });
                assert!((transported - next[row]).norm() < 1e-10);
            }
        }
        let last = cyclic_mode_mesh_vector(zero_mode, transfers.len() - 1, 2).expect("last mesh");
        for row in 0..2 {
            let closure = (0..2).fold(Complex::new(0.0, 0.0), |sum, col| {
                sum + transfers.last().unwrap()[(row, col)] * last[col]
            });
            assert!(closure.norm() < 1e-10);
        }
    }

    #[test]
    fn block_cyclic_modes_keep_repeated_multiplier_eigenvectors_independent() {
        let transfers = vec![DMatrix::identity(2, 2); 3];
        let (cyclic, roots, multipliers) =
            cyclic_floquet_spectrum(&transfers).expect("repeated cyclic spectrum");
        let modes =
            cyclic_floquet_modes_from_selected_roots(&cyclic, &transfers, &roots, &multipliers)
                .expect("repeated Floquet modes");
        assert_eq!(modes.len(), 2);
        let first = cyclic_mode_mesh_vector(&modes[0], 0, 2).expect("first mode");
        let second = cyclic_mode_mesh_vector(&modes[1], 0, 2).expect("second mode");
        let inner_product = first
            .iter()
            .zip(second.iter())
            .map(|(left, right)| left.conj() * *right)
            .sum::<Complex<f64>>();
        assert!(
            inner_product.norm() < 1e-10,
            "repeated modes were not independent: <v1,v2>={inner_product:?}"
        );
    }

    #[test]
    fn nearby_distinct_roots_keep_eigenvectors_at_their_own_root() {
        let separation = 5e-9;
        let cyclic = DMatrix::from_row_slice(2, 2, &[1.0, 1.0, 0.0, 1.0 + separation]);
        let transfers = vec![cyclic.clone()];
        let roots = vec![Complex::new(1.0, 0.0), Complex::new(1.0 + separation, 0.0)];
        let modes = cyclic_floquet_modes_from_selected_roots(&cyclic, &transfers, &roots, &roots)
            .expect("nearby but distinct Floquet modes");

        for mode in modes {
            let vector = DVector::from_vec(mode.cyclic_vector);
            let residual =
                cyclic.map(|value| Complex::new(value, 0.0)) * &vector - vector * mode.root;
            assert!(
                residual.norm() < 1e-11,
                "mode labeled by {:?} has cyclic residual {}",
                mode.root,
                residual.norm()
            );
        }
    }

    #[test]
    fn defective_repeated_root_is_not_reported_with_fake_eigenvectors() {
        let cyclic = DMatrix::from_row_slice(2, 2, &[1.0, 1.0, 0.0, 1.0]);
        let transfers = vec![cyclic.clone()];
        let roots = vec![Complex::new(1.0, 0.0); 2];
        let error = cyclic_floquet_modes_from_selected_roots(&cyclic, &transfers, &roots, &roots)
            .expect_err("a defective root has only one genuine eigenvector");
        assert!(
            error.to_string().contains("geometric multiplicity"),
            "unexpected error: {error}"
        );
    }

    fn stuart_landau_with_transverse_pair(decay: f64, frequency: f64) -> EquationSystem {
        let base = stuart_landau_system();
        let mut equations = base.equations;
        equations.push(Bytecode {
            ops: vec![
                OpCode::LoadConst(decay),
                OpCode::LoadVar(2),
                OpCode::Mul,
                OpCode::LoadConst(frequency),
                OpCode::LoadVar(3),
                OpCode::Mul,
                OpCode::Sub,
            ],
        });
        equations.push(Bytecode {
            ops: vec![
                OpCode::LoadConst(frequency),
                OpCode::LoadVar(2),
                OpCode::Mul,
                OpCode::LoadConst(decay),
                OpCode::LoadVar(3),
                OpCode::Mul,
                OpCode::Add,
            ],
        });
        EquationSystem::new(equations, vec![0.0])
    }

    #[test]
    fn analytic_transverse_rotating_pair_has_complex_raw_floquet_modes() {
        let ntst = 16usize;
        let ncol = 4usize;
        let period = 2.0 * PI;
        let decay = -0.1;
        let frequency = 0.3;
        let mesh_states = (0..ntst)
            .map(|interval| {
                let phase = 2.0 * PI * interval as f64 / ntst as f64;
                vec![phase.cos(), phase.sin(), 0.0, 0.0]
            })
            .collect::<Vec<_>>();
        let coeffs = CollocationCoefficients::new(ncol).expect("collocation coefficients");
        let stage_states = build_stage_states_from_mesh(4, ntst, ncol, &coeffs.nodes, &mesh_states);
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![1.0, 0.0, 0.0, 0.0],
            phase_direction: vec![0.0, 1.0, 0.0, 0.0],
            mesh_points: ntst,
            collocation_degree: ncol,
        };
        let mut system = stuart_landau_with_transverse_pair(decay, frequency);
        let (_, cycle_state) = correct_limit_cycle_setup(&mut system, 0, setup, 1e-11, 12)
            .expect("corrected four-dimensional cycle");
        let modes = compute_limit_cycle_floquet_modes(&mut system, 0, &cycle_state, ntst, ncol)
            .expect("four-dimensional Floquet modes");

        let expected_radius = (decay * period).exp();
        let expected_imaginary = expected_radius * (frequency * period).sin().abs();
        let pair_indices = modes
            .multipliers
            .iter()
            .enumerate()
            .filter(|(_, multiplier)| multiplier.im.abs() > 1e-4)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        assert_eq!(pair_indices.len(), 2);
        for &index in &pair_indices {
            let multiplier = &modes.multipliers[index];
            assert!((multiplier.re.hypot(multiplier.im) - expected_radius).abs() < 2e-8);
            assert!((multiplier.im.abs() - expected_imaginary).abs() < 2e-8);
            let vector = &modes.vectors[0][index];
            let base_norm = vector[0]
                .re
                .hypot(vector[0].im)
                .hypot(vector[1].re.hypot(vector[1].im));
            let transverse_norm = vector[2]
                .re
                .hypot(vector[2].im)
                .hypot(vector[3].re.hypot(vector[3].im));
            assert!(base_norm < 1e-7, "base contamination was {base_norm:.3e}");
            assert!(transverse_norm > 0.999999);
        }
        let negative_index = pair_indices
            .iter()
            .copied()
            .find(|&index| modes.multipliers[index].im < 0.0)
            .expect("negative-imaginary mode");
        let positive_index = pair_indices
            .iter()
            .copied()
            .find(|&index| modes.multipliers[index].im > 0.0)
            .expect("positive-imaginary mode");
        for component in 0..4 {
            let negative = Complex::new(
                modes.vectors[0][negative_index][component].re,
                modes.vectors[0][negative_index][component].im,
            );
            let positive = Complex::new(
                modes.vectors[0][positive_index][component].re,
                modes.vectors[0][positive_index][component].im,
            );
            assert!(
                (negative - positive.conj()).norm() < 2e-7,
                "complex Floquet modes were not conjugate at component {component}"
            );
        }
    }

    #[test]
    fn stuart_landau_floquet_modes_are_raw_and_satisfy_the_collocation_cocycle() {
        let ntst = 20usize;
        let ncol = 4usize;
        let period = 2.0 * PI;
        let coeffs = CollocationCoefficients::new(ncol).expect("collocation coefficients");
        let mesh_states = (0..ntst)
            .map(|interval| {
                let phase = 2.0 * PI * interval as f64 / ntst as f64;
                vec![phase.cos(), phase.sin()]
            })
            .collect::<Vec<_>>();
        let stage_states = build_stage_states_from_mesh(2, ntst, ncol, &coeffs.nodes, &mesh_states);
        let setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            mesh_points: ntst,
            collocation_degree: ncol,
        };
        let mut system = stuart_landau_system();
        let (_corrected, cycle_state) = correct_limit_cycle_setup(&mut system, 0, setup, 1e-11, 12)
            .expect("corrected Stuart-Landau cycle");
        let modes = compute_limit_cycle_floquet_modes(&mut system, 0, &cycle_state, ntst, ncol)
            .expect("Stuart-Landau Floquet modes");
        assert_eq!(modes.multipliers.len(), 2);
        assert_eq!(modes.vectors.len(), ntst * (ncol + 1) + 1);

        let multipliers = modes
            .multipliers
            .iter()
            .map(|value| Complex::new(value.re, value.im))
            .collect::<Vec<_>>();
        let trivial_index = multipliers
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                (**a - Complex::new(1.0, 0.0))
                    .norm_sqr()
                    .total_cmp(&(**b - Complex::new(1.0, 0.0)).norm_sqr())
            })
            .map(|(index, _)| index)
            .expect("trivial mode");
        let transverse_index = 1 - trivial_index;
        assert!((multipliers[trivial_index] - Complex::new(1.0, 0.0)).norm() < 2e-6);
        let expected_transverse = (-4.0 * PI).exp();
        assert!(
            (multipliers[transverse_index].re - expected_transverse).abs() < 2e-8,
            "transverse multiplier was {:?}, expected {}",
            multipliers[transverse_index],
            expected_transverse
        );

        // At (1,0), the phase mode is parallel to the flow (0,1).  The old
        // rendering projection annihilated this vector; the backend must return
        // the raw variational mode instead.
        let phase_vector = &modes.vectors[0][trivial_index];
        let phase_norm = phase_vector
            .iter()
            .map(|value| value.re * value.re + value.im * value.im)
            .sum::<f64>()
            .sqrt();
        assert!((phase_norm - 1.0).abs() < 1e-10);
        assert!(
            phase_vector[0].re.hypot(phase_vector[0].im) < 5e-4,
            "phase vector at anchor was {:?}; multipliers were {:?}",
            phase_vector,
            multipliers
        );
        assert!(phase_vector[1].re.hypot(phase_vector[1].im) > 0.999);

        let mut system_for_transfers = stuart_landau_system();
        let data =
            compute_cycle_monodromy_data(&mut system_for_transfers, 0, &cycle_state, ntst, ncol)
                .expect("collocation transfer data");
        for interval in 0..ntst {
            let current_index = interval * (ncol + 1);
            let next_index = (interval + 1) * (ncol + 1);
            for mode_index in 0..2 {
                let current = modes.vectors[current_index][mode_index]
                    .iter()
                    .map(|value| Complex::new(value.re, value.im))
                    .collect::<Vec<_>>();
                let expected_next = (0..2)
                    .map(|row| {
                        (0..2).fold(Complex::new(0.0, 0.0), |sum, col| {
                            sum + data.transfers[interval][(row, col)] * current[col]
                        })
                    })
                    .collect::<Vec<_>>();
                let actual_next = &modes.vectors[next_index][mode_index];
                for component in 0..2 {
                    let actual = Complex::new(actual_next[component].re, actual_next[component].im);
                    assert!(
                        (actual - expected_next[component]).norm() < 2e-7,
                        "cocycle mismatch at interval {}, mode {}, component {}",
                        interval,
                        mode_index,
                        component
                    );
                }
                for stage in 0..ncol {
                    let expected_stage = (0..2)
                        .map(|row| {
                            (0..2).fold(Complex::new(0.0, 0.0), |sum, col| {
                                sum + data.stage_sensitivities[interval][(stage * 2 + row, col)]
                                    * current[col]
                            })
                        })
                        .collect::<Vec<_>>();
                    let actual_stage = &modes.vectors[current_index + stage + 1][mode_index];
                    for component in 0..2 {
                        let actual =
                            Complex::new(actual_stage[component].re, actual_stage[component].im);
                        assert!(
                            (actual - expected_stage[component]).norm() < 2e-7,
                            "stage cocycle mismatch at interval {}, stage {}, mode {}, component {}",
                            interval,
                            stage,
                            mode_index,
                            component
                        );
                    }
                }
            }
        }
        let final_index = ntst * (ncol + 1);
        for (mode_index, multiplier) in multipliers.iter().enumerate() {
            for component in 0..2 {
                let initial = Complex::new(
                    modes.vectors[0][mode_index][component].re,
                    modes.vectors[0][mode_index][component].im,
                );
                let final_value = Complex::new(
                    modes.vectors[final_index][mode_index][component].re,
                    modes.vectors[final_index][mode_index][component].im,
                );
                assert!((final_value - *multiplier * initial).norm() < 2e-10);
            }
        }
    }

    #[test]
    fn cycle_tests_remove_one_trivial_mode_and_detect_lpc_pd_and_ns() {
        let lpc_before = [Complex::new(1.0, 0.0), Complex::new(0.98, 0.0)];
        let lpc_after = [Complex::new(1.0, 0.0), Complex::new(1.02, 0.0)];
        let (lpc_left, _, _, _) = cycle_tests_from_multipliers(&lpc_before);
        let (lpc_right, _, _, _) = cycle_tests_from_multipliers(&lpc_after);
        assert!(lpc_left * lpc_right < 0.0);
        let (lpc_exact, _, _, _) =
            cycle_tests_from_multipliers(&[Complex::new(1.0, 0.0), Complex::new(1.0, 0.0)]);
        assert_eq!(lpc_exact, 0.0, "only one +1 mode may be discarded");

        let (_, pd_left, _, _) =
            cycle_tests_from_multipliers(&[Complex::new(1.0, 0.0), Complex::new(-0.99, 0.0)]);
        let (_, pd_right, _, _) =
            cycle_tests_from_multipliers(&[Complex::new(1.0, 0.0), Complex::new(-1.01, 0.0)]);
        assert!(pd_left * pd_right < 0.0);

        let pair_inside = Complex::from_polar(0.99, 0.4);
        let pair_outside = Complex::from_polar(1.01, 0.4);
        let (_, _, ns_inside, _) = cycle_tests_from_multipliers(&[
            Complex::new(1.0, 0.0),
            pair_inside,
            pair_inside.conj(),
        ]);
        let (_, _, ns_outside, _) = cycle_tests_from_multipliers(&[
            Complex::new(1.0, 0.0),
            pair_outside,
            pair_outside.conj(),
        ]);
        assert!(ns_inside * ns_outside < 0.0);

        let (cf, pd, ns, _) =
            cycle_tests_from_multipliers(&[Complex::new(0.5, 0.0), Complex::new(-0.5, 0.0)]);
        assert!(cf.is_nan() && pd.is_nan() && ns.is_nan());
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
        let (_, pd_before, _, _) = cycle_tests_from_multipliers(&multipliers_before);

        // Case 2: At/After bifurcation (Unstable, multiplier past -1)
        // Triv: 1.0, Unstable: -1.01
        let multipliers_after = vec![
            Complex::new(1.0, 0.0),
            Complex::new(-1.01, 1e-16),
            Complex::new(0.01, 0.0),
        ];
        let (_, pd_after, _, _) = cycle_tests_from_multipliers(&multipliers_after);

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
        let (_, pd_exact, _, _) = cycle_tests_from_multipliers(&multipliers_exact);
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

    #[test]
    fn pd_seed_uses_stored_stages_and_phase_dependent_antiperiodic_mode() {
        let ntst = 10;
        let ncol = 3;
        let dim = 4;
        let base_period = 2.0 * PI;
        let amplitude = 0.05;
        let mut system = pd_test_system(0.0);

        let mesh_states: Vec<Vec<f64>> = (0..ntst)
            .map(|interval| {
                let phase = base_period * interval as f64 / ntst as f64;
                vec![phase.cos(), phase.sin(), 0.0, 0.0]
            })
            .collect();
        let coeffs = CollocationCoefficients::new(ncol).expect("coefficients should build");
        let mut stage_states =
            build_stage_states_from_mesh(dim, ntst, ncol, &coeffs.nodes, &mesh_states);

        // Sentinels make the stored stages observably different from stages
        // reconstructed from the mesh.  The transverse variational subsystem is
        // independent of x/y, so these do not change its -1 multiplier.
        for (interval, stages) in stage_states.iter_mut().enumerate() {
            for (stage, state) in stages.iter_mut().enumerate() {
                state[0] += 1e-3 * (1 + interval * ncol + stage) as f64;
                state[1] -= 5e-4 * (1 + interval * ncol + stage) as f64;
            }
        }

        let lc_state = flatten_collocation_state(&mesh_states, &stage_states, base_period);
        let setup =
            limit_cycle_setup_from_pd(&mut system, 0, &lc_state, 0.0, ntst, ncol, amplitude)
                .expect("PD setup should succeed");

        assert_eq!(setup.guess.mesh_states.len(), 2 * ntst);
        assert_eq!(setup.guess.stage_states.len(), 2 * ntst);

        for interval in 0..ntst {
            for component in 0..dim {
                let plus = setup.guess.mesh_states[interval][component];
                let minus = setup.guess.mesh_states[interval + ntst][component];
                let base = mesh_states[interval][component];
                assert!(
                    (0.5 * (plus + minus) - base).abs() < 1e-10,
                    "the doubled mesh halves must carry opposite perturbations"
                );
            }
        }

        let mut stage_perturbations = Vec::new();
        for interval in 0..ntst {
            for stage in 0..ncol {
                for component in 0..dim {
                    let plus = setup.guess.stage_states[interval][stage][component];
                    let minus = setup.guess.stage_states[interval + ntst][stage][component];
                    let base = stage_states[interval][stage][component];
                    assert!(
                        (0.5 * (plus + minus) - base).abs() < 1e-10,
                        "doubled stages must retain stored stage ({interval}, {stage}, {component})"
                    );
                    assert!(
                        ((plus - base) + (minus - base)).abs() < 1e-10,
                        "the two halves must carry opposite stage perturbations"
                    );
                }
                stage_perturbations.push([
                    setup.guess.stage_states[interval][stage][2] - stage_states[interval][stage][2],
                    setup.guess.stage_states[interval][stage][3] - stage_states[interval][stage][3],
                ]);
            }
        }

        let first = stage_perturbations[0];
        assert!(
            stage_perturbations.iter().skip(1).any(|value| {
                ((value[0] - first[0]).powi(2) + (value[1] - first[1]).powi(2)).sqrt()
                    > amplitude * 0.1
            }),
            "the PD eigenfunction must vary with collocation phase"
        );
    }

    #[test]
    fn pd_seed_rejects_a_cycle_without_a_flip_multiplier() {
        let ntst = 10;
        let ncol = 3;
        let dim = 4;
        let base_period = 2.0 * PI;
        let mut system = pd_test_system(-0.2);
        let mesh_states = (0..ntst)
            .map(|interval| {
                let phase = base_period * interval as f64 / ntst as f64;
                vec![phase.cos(), phase.sin(), 0.0, 0.0]
            })
            .collect::<Vec<_>>();
        let coeffs = CollocationCoefficients::new(ncol).expect("collocation coefficients");
        let stage_states =
            build_stage_states_from_mesh(dim, ntst, ncol, &coeffs.nodes, &mesh_states);
        let lc_state = flatten_collocation_state(&mesh_states, &stage_states, base_period);

        let error = limit_cycle_setup_from_pd(&mut system, 0, &lc_state, -0.2, ntst, ncol, 0.05)
            .expect_err("an ordinary cycle must not produce a period-doubled seed");
        assert!(
            error.to_string().contains("period-doubling point"),
            "unexpected error: {error}"
        );
    }
}
