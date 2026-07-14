use super::periodic_normal_forms::{
    periodic_branch_point_normal_form, periodic_plus_one_bifurcation_type,
};
use super::periodic_schur::periodic_schur_floquet_spectrum;
use super::problem::{
    ContinuationProblem, PointDiagnostics, StepRejectionAction, TestFunctionValues,
};
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

pub fn uniform_normalized_mesh(mesh_points: usize) -> Vec<f64> {
    if mesh_points == 0 {
        return Vec::new();
    }
    (0..=mesh_points)
        .map(|index| index as f64 / mesh_points as f64)
        .collect()
}

pub(crate) fn validated_normalized_mesh(mesh_points: usize, mesh: &[f64]) -> Result<Vec<f64>> {
    if mesh_points < 2 {
        bail!("Collocation mesh must have at least 2 intervals");
    }
    let mut normalized = if mesh.is_empty() {
        uniform_normalized_mesh(mesh_points)
    } else {
        mesh.to_vec()
    };
    if normalized.len() != mesh_points + 1 {
        bail!(
            "Normalized collocation mesh has {} coordinates; expected {}",
            normalized.len(),
            mesh_points + 1
        );
    }
    if normalized.iter().any(|value| !value.is_finite()) {
        bail!("Normalized collocation mesh must contain only finite coordinates");
    }
    let endpoint_tolerance = 64.0 * f64::EPSILON;
    if normalized[0].abs() > endpoint_tolerance
        || (normalized[mesh_points] - 1.0).abs() > endpoint_tolerance
    {
        bail!("Normalized collocation mesh must start at 0 and end at 1");
    }
    normalized[0] = 0.0;
    normalized[mesh_points] = 1.0;
    if normalized
        .windows(2)
        .any(|pair| pair[1] <= pair[0] || pair[1] - pair[0] <= 1e-12)
    {
        bail!("Normalized collocation mesh coordinates must be strictly increasing");
    }
    Ok(normalized)
}

/// Equidistribute interval-local collocation defects on a normalized mesh.
///
/// The monitor exponent follows the local collocation order.  A small monitor
/// floor prevents nearly defect-free intervals from collapsing, while the
/// cumulative-mass inversion works for both redistribution at fixed NTST and
/// bounded NTST growth.
pub fn defect_weighted_normalized_mesh(
    source_mesh: &[f64],
    interval_scaled_defects: &[f64],
    degree: usize,
    target_intervals: usize,
) -> Result<Vec<f64>> {
    if degree == 0 {
        bail!("Defect-weighted collocation redistribution requires positive NCOL");
    }
    if target_intervals < 2 {
        bail!("Defect-weighted collocation redistribution requires at least 2 intervals");
    }
    let source_intervals = interval_scaled_defects.len();
    let source_mesh = validated_normalized_mesh(source_intervals, source_mesh)?;
    if interval_scaled_defects
        .iter()
        .any(|defect| !defect.is_finite() || *defect < 0.0)
    {
        bail!("Collocation defect indicators must be finite and nonnegative");
    }

    let maximum = interval_scaled_defects
        .iter()
        .copied()
        .fold(0.0_f64, f64::max);
    if maximum <= f64::MIN_POSITIVE {
        return Ok(uniform_normalized_mesh(target_intervals));
    }

    let exponent = 1.0 / (degree as f64 + 1.0);
    let monitor = interval_scaled_defects
        .iter()
        .map(|defect| ((*defect / maximum).max(0.02)).powf(exponent))
        .collect::<Vec<_>>();
    let mut cumulative_mass = Vec::with_capacity(source_intervals + 1);
    cumulative_mass.push(0.0);
    for interval in 0..source_intervals {
        let width = source_mesh[interval + 1] - source_mesh[interval];
        cumulative_mass.push(cumulative_mass[interval] + width * monitor[interval]);
    }
    let total_mass = *cumulative_mass
        .last()
        .ok_or_else(|| anyhow!("Defect monitor is empty"))?;
    if !total_mass.is_finite() || total_mass <= 0.0 {
        bail!("Defect-weighted collocation monitor has nonpositive mass");
    }

    let mut redistributed = Vec::with_capacity(target_intervals + 1);
    redistributed.push(0.0);
    let mut source_interval = 0usize;
    for target_index in 1..target_intervals {
        let desired_mass = total_mass * target_index as f64 / target_intervals as f64;
        while source_interval + 1 < source_intervals
            && cumulative_mass[source_interval + 1] < desired_mass
        {
            source_interval += 1;
        }
        let local_mass = desired_mass - cumulative_mass[source_interval];
        let coordinate = source_mesh[source_interval] + local_mass / monitor[source_interval];
        redistributed.push(coordinate);
    }
    redistributed.push(1.0);
    validated_normalized_mesh(target_intervals, &redistributed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollocationConfig {
    pub mesh_points: usize,
    pub degree: usize,
    pub phase_anchor: Vec<f64>,
    pub phase_direction: Vec<f64>,
    /// Strictly increasing normalized interval boundaries.  An empty vector
    /// is the backwards-compatible encoding of a uniform mesh.
    #[serde(default)]
    pub normalized_mesh: Vec<f64>,
}

/// A-posteriori defect data for a periodic collocation profile.
///
/// The maximum retains the existing scalar acceptance contract, while the
/// interval-local values drive deterministic mesh refinement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollocationDefectEstimate {
    pub max_scaled_defect: f64,
    pub interval_scaled_defects: Vec<f64>,
}

/// Core-only controls for dimension-changing periodic-orbit mesh refinement.
///
/// These defaults intentionally bound both retry count and state growth.  The
/// type is public so WASM/web settings can be wired without changing the core
/// refinement contract later.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CollocationAdaptivitySettings {
    pub enabled: bool,
    pub redistribution_enabled: bool,
    pub defect_tolerance: f64,
    pub max_refinements: usize,
    pub max_mesh_points: usize,
}

impl Default for CollocationAdaptivitySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            redistribution_enabled: true,
            defect_tolerance: MAX_SCALED_COLLOCATION_DEFECT,
            max_refinements: 3,
            max_mesh_points: 512,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollocationDefectTerminationReason {
    AdaptivityDisabled,
    RefinementBudgetExhausted,
    MeshPointLimitReached,
    RefinementStalled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollocationDefectTermination {
    pub reason: CollocationDefectTerminationReason,
    pub measured_defect: f64,
    pub tolerance: f64,
    pub mesh_points: usize,
    pub degree: usize,
    /// Number of adaptations attempted in the continuation invocation that
    /// produced this termination. The enclosing report retains cumulative
    /// attempts across restarts.
    pub refinements_attempted: usize,
    pub refinement_budget: usize,
    pub max_mesh_points: usize,
    pub normalized_mesh: Vec<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollocationMeshAdaptationKind {
    Redistribution,
    Refinement,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollocationRefinementAttempt {
    pub sequence: usize,
    pub kind: CollocationMeshAdaptationKind,
    pub old_mesh_points: usize,
    pub new_mesh_points: usize,
    pub degree: usize,
    pub trigger_defect: f64,
    pub tolerance: f64,
    pub interval_scaled_defects: Vec<f64>,
    pub old_normalized_mesh: Vec<f64>,
    pub new_normalized_mesh: Vec<f64>,
}

/// Structured refinement/termination provenance for one collocation run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollocationAdaptationReport {
    pub initial_mesh_points: usize,
    pub current_mesh_points: usize,
    pub degree: usize,
    pub defect_tolerance: f64,
    pub refinement_budget: usize,
    pub max_mesh_points: usize,
    pub initial_normalized_mesh: Vec<f64>,
    pub current_normalized_mesh: Vec<f64>,
    pub attempts: Vec<CollocationRefinementAttempt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub termination: Option<CollocationDefectTermination>,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("limit-cycle collocation mesh remained under-resolved: {termination:?}")]
pub struct CollocationDefectTerminationError {
    pub termination: CollocationDefectTermination,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LimitCycleContinuationResult {
    pub branch: ContinuationBranch,
    pub collocation_adaptation: CollocationAdaptationReport,
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
    /// Normalized interval boundaries for this profile.  Empty is accepted
    /// only as a legacy serialized uniform mesh.
    #[serde(default)]
    pub normalized_mesh: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloquetModeVectors {
    pub ntst: usize,
    pub ncol: usize,
    #[serde(default)]
    pub normalized_mesh: Vec<f64>,
    #[serde(default)]
    pub backend: FloquetBackend,
    pub multipliers: Vec<ComplexNumber>,
    pub vectors: Vec<Vec<Vec<ComplexNumber>>>,
}

/// Floquet eigensolver used for a collocation transfer sequence.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FloquetBackend {
    /// Use the dense block-cyclic reference for small systems and periodic
    /// Schur for large meshes, with a safe reference fallback when possible.
    #[default]
    Auto,
    /// Product-free periodic Hessenberg/QR (periodic Schur) backend.
    PeriodicSchur,
    /// Dense `(ntst * dimension)` block-cyclic reference backend.
    BlockCyclic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum OrbitTimeMode {
    Continuous,
    Discrete,
}

impl LimitCycleSetup {
    pub fn resolved_normalized_mesh(&self) -> Result<Vec<f64>> {
        validated_normalized_mesh(self.mesh_points, &self.normalized_mesh)
    }

    pub fn collocation_config(&self) -> CollocationConfig {
        CollocationConfig {
            mesh_points: self.mesh_points,
            degree: self.collocation_degree,
            phase_anchor: self.phase_anchor.clone(),
            phase_direction: self.phase_direction.clone(),
            normalized_mesh: if self.normalized_mesh.is_empty() {
                uniform_normalized_mesh(self.mesh_points)
            } else {
                self.normalized_mesh.clone()
            },
        }
    }

    pub fn to_problem<'a>(
        &self,
        system: &'a mut EquationSystem,
        param_index: usize,
    ) -> Result<PeriodicOrbitCollocationProblem<'a>> {
        PeriodicOrbitCollocationProblem::new_on_mesh(
            system,
            param_index,
            self.collocation_degree,
            self.phase_anchor.clone(),
            self.phase_direction.clone(),
            self.resolved_normalized_mesh()?,
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
        normalized_mesh: uniform_normalized_mesh(mesh_points),
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
        normalized_mesh: uniform_normalized_mesh(mesh_points),
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
    limit_cycle_setup_from_pd_on_mesh(
        system,
        param_index,
        lc_state,
        param_value,
        ncol,
        uniform_normalized_mesh(ntst),
        amplitude,
    )
}

pub fn limit_cycle_setup_from_pd_on_mesh(
    system: &mut EquationSystem,
    param_index: usize,
    lc_state: &[f64],
    param_value: f64,
    ncol: usize,
    normalized_mesh: Vec<f64>,
    amplitude: f64,
) -> Result<LimitCycleSetup> {
    let ntst = normalized_mesh.len().saturating_sub(1);
    let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
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
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
        system,
        param_index,
        ncol,
        phase_anchor.clone(),
        phase_direction.clone(),
        normalized_mesh.clone(),
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
    let mut doubled_normalized_mesh = normalized_mesh
        .iter()
        .map(|coordinate| 0.5 * coordinate)
        .collect::<Vec<_>>();
    doubled_normalized_mesh.extend(
        normalized_mesh
            .iter()
            .skip(1)
            .map(|coordinate| 0.5 + 0.5 * coordinate),
    );

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
        normalized_mesh: doubled_normalized_mesh,
    })
}

pub struct PeriodicOrbitCollocationProblem<'a> {
    context: FlowContext<'a>,
    mesh_points: usize,
    normalized_mesh: Vec<f64>,
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
    adaptivity: CollocationAdaptivitySettings,
    adaptation_report: CollocationAdaptationReport,
    /// Attempts before this offset were already reflected in a restarted
    /// branch's persisted states and must not be replayed during extension.
    adaptation_transfer_start_index: usize,
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
        Self::new_with_adaptivity(
            system,
            param_index,
            mesh_points,
            degree,
            phase_anchor,
            phase_direction,
            CollocationAdaptivitySettings::default(),
        )
    }

    pub fn new_with_adaptivity(
        system: &'a mut EquationSystem,
        param_index: usize,
        mesh_points: usize,
        degree: usize,
        phase_anchor: Vec<f64>,
        phase_direction: Vec<f64>,
        adaptivity: CollocationAdaptivitySettings,
    ) -> Result<Self> {
        Self::new_on_mesh_with_adaptivity(
            system,
            param_index,
            degree,
            phase_anchor,
            phase_direction,
            uniform_normalized_mesh(mesh_points),
            adaptivity,
        )
    }

    pub fn new_on_mesh(
        system: &'a mut EquationSystem,
        param_index: usize,
        degree: usize,
        phase_anchor: Vec<f64>,
        phase_direction: Vec<f64>,
        normalized_mesh: Vec<f64>,
    ) -> Result<Self> {
        Self::new_on_mesh_with_adaptivity(
            system,
            param_index,
            degree,
            phase_anchor,
            phase_direction,
            normalized_mesh,
            CollocationAdaptivitySettings::default(),
        )
    }

    pub fn new_on_mesh_with_adaptivity(
        system: &'a mut EquationSystem,
        param_index: usize,
        degree: usize,
        phase_anchor: Vec<f64>,
        phase_direction: Vec<f64>,
        normalized_mesh: Vec<f64>,
        adaptivity: CollocationAdaptivitySettings,
    ) -> Result<Self> {
        if param_index >= system.params.len() {
            bail!(
                "Continuation parameter index {} is out of bounds for {} parameters",
                param_index,
                system.params.len()
            );
        }
        let mesh_points = normalized_mesh.len().saturating_sub(1);
        let normalized_mesh = validated_normalized_mesh(mesh_points, &normalized_mesh)?;
        if !adaptivity.defect_tolerance.is_finite() || adaptivity.defect_tolerance <= 0.0 {
            bail!("Collocation defect tolerance must be finite and positive");
        }
        if adaptivity.max_mesh_points < 2 {
            bail!("Adaptive collocation requires a mesh-point cap of at least 2");
        }
        if adaptivity.max_mesh_points < mesh_points {
            bail!(
                "Adaptive collocation mesh-point cap {} is below the active mesh size {}",
                adaptivity.max_mesh_points,
                mesh_points
            );
        }
        let dim = system.equations.len();
        // Keep validating the serialized seed data for backwards compatibility.
        // The actual gauge is the mesh-independent integral phase condition,
        // initialized from the complete collocation profile on first use.
        let _ = normalize_phase_data(dim, phase_anchor, phase_direction)?;
        let coeffs = CollocationCoefficients::new(degree)?;
        let stage_count = mesh_points * degree;
        let initial_normalized_mesh = normalized_mesh.clone();
        Ok(Self {
            context: FlowContext::new(system, param_index),
            mesh_points,
            normalized_mesh,
            degree,
            coeffs,
            phase_reference_stages: None,
            phase_reference_derivative: None,
            work_stage_f: vec![0.0; stage_count * dim],
            work_stage_jac: vec![0.0; stage_count * dim * dim],
            work_stage_param: vec![0.0; stage_count * dim],
            adaptivity,
            adaptation_report: CollocationAdaptationReport {
                initial_mesh_points: mesh_points,
                current_mesh_points: mesh_points,
                degree,
                defect_tolerance: adaptivity.defect_tolerance,
                refinement_budget: adaptivity.max_refinements,
                max_mesh_points: adaptivity.max_mesh_points,
                initial_normalized_mesh: initial_normalized_mesh.clone(),
                current_normalized_mesh: initial_normalized_mesh,
                attempts: Vec::new(),
                termination: None,
            },
            adaptation_transfer_start_index: 0,
        })
    }

    pub fn adaptation_report(&self) -> &CollocationAdaptationReport {
        &self.adaptation_report
    }

    pub fn seed_adaptation_report(
        &mut self,
        mut report: CollocationAdaptationReport,
    ) -> Result<()> {
        if report.current_mesh_points != self.mesh_points
            || meshes_materially_different(&report.current_normalized_mesh, &self.normalized_mesh)
        {
            bail!("Collocation adaptation report does not match the active mesh");
        }
        self.adaptation_transfer_start_index = report.attempts.len();
        report.defect_tolerance = self.adaptivity.defect_tolerance;
        report.refinement_budget = self.adaptivity.max_refinements;
        report.max_mesh_points = self.adaptivity.max_mesh_points;
        report.termination = None;
        self.adaptation_report = report;
        Ok(())
    }

    pub fn normalized_mesh(&self) -> &[f64] {
        &self.normalized_mesh
    }

    fn interval_width(&self, interval: usize) -> f64 {
        self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]
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

    fn normal_form_setup(&mut self, aug_state: &DVector<f64>) -> Result<LimitCycleSetup> {
        if aug_state.len() != self.dimension() + 1 {
            bail!("Periodic normal-form state has the wrong collocation dimension");
        }
        let dim = self.state_dim();
        let mesh_states = self
            .mesh_states(aug_state)
            .into_iter()
            .map(|state| state.to_vec())
            .collect::<Vec<_>>();
        let mut stage_states = vec![vec![vec![0.0; dim]; self.degree]; self.mesh_points];
        for (interval, stages) in stage_states.iter_mut().enumerate() {
            for (stage, state) in stages.iter_mut().enumerate() {
                state.copy_from_slice(self.stage_state_slice(aug_state, interval, stage));
            }
        }
        let period = aug_state[self.period_index()];
        if !period.is_finite() || period <= 0.0 {
            bail!("Periodic normal-form source period must be positive and finite");
        }
        let parameter = aug_state[0];
        let phase_anchor = mesh_states[0].clone();
        let mut phase_direction = vec![0.0; dim];
        self.context.with_param(parameter, |system| {
            system.apply(0.0, &phase_anchor, &mut phase_direction);
            Ok(())
        })?;
        let phase_norm = phase_direction
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        if !phase_norm.is_finite() || phase_norm <= 1e-12 {
            bail!("Periodic normal-form phase direction is singular");
        }
        for value in &mut phase_direction {
            *value /= phase_norm;
        }
        Ok(LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: parameter,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: false,
            },
            phase_anchor,
            phase_direction,
            mesh_points: self.mesh_points,
            collocation_degree: self.degree,
            normalized_mesh: self.normalized_mesh.clone(),
        })
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
                let weight = self.interval_width(interval) * self.coeffs.b[stage];
                for component in 0..dim {
                    let index = stage_index * dim + component;
                    phase += weight * (current[component] - reference[index]) * derivative[index];
                }
            }
        }
        Ok(phase)
    }

    fn profile_metric_node_weights(&self) -> Result<Vec<f64>> {
        let node_count = self.mesh_points * (self.degree + 1);
        let mut positions = Vec::with_capacity(node_count);
        for interval in 0..self.mesh_points {
            let left = self.normalized_mesh[interval];
            let width = self.interval_width(interval);
            positions.push(left);
            positions.extend(self.coeffs.nodes.iter().map(|node| left + width * node));
        }
        let mut weights = Vec::with_capacity(node_count);
        for index in 0..node_count {
            let previous = if index == 0 {
                positions[node_count - 1] - 1.0
            } else {
                positions[index - 1]
            };
            let next = if index + 1 == node_count {
                positions[0] + 1.0
            } else {
                positions[index + 1]
            };
            let weight = 0.5 * (next - previous);
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
    pub fn scaled_collocation_defect_estimate(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<CollocationDefectEstimate> {
        let dim = self.state_dim();
        let param = aug_state[0];
        let period = aug_state[self.period_index()];
        if !period.is_finite() || period <= 0.0 {
            bail!("Cannot estimate collocation defect for a nonpositive period");
        }
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
        let mut interval_scaled_defects = vec![0.0_f64; self.mesh_points];
        let interval_widths = self
            .normalized_mesh
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .collect::<Vec<_>>();

        self.context.with_param(param, |system| {
            let mut state = vec![0.0; dim];
            let mut actual_flow = vec![0.0; dim];
            for interval in 0..self.mesh_points {
                let h = period * interval_widths[interval];
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
                        interval_scaled_defects[interval] = interval_scaled_defects[interval]
                            .max((polynomial_flow - actual_flow[component]).abs() / scale);
                    }
                }
            }
            Ok(())
        })?;
        let max_scaled_defect = interval_scaled_defects
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        if !max_scaled_defect.is_finite()
            || interval_scaled_defects
                .iter()
                .any(|defect| !defect.is_finite())
        {
            bail!("Collocation defect estimate is non-finite");
        }
        Ok(CollocationDefectEstimate {
            max_scaled_defect,
            interval_scaled_defects,
        })
    }

    pub fn scaled_collocation_defect(&mut self, aug_state: &DVector<f64>) -> Result<f64> {
        Ok(self
            .scaled_collocation_defect_estimate(aug_state)?
            .max_scaled_defect)
    }

    fn validate_collocation_defect(&mut self, aug_state: &DVector<f64>) -> Result<f64> {
        let defect = self.scaled_collocation_defect(aug_state)?;
        if defect > self.adaptivity.defect_tolerance {
            bail!(
                "Limit-cycle collocation mesh is under-resolved (scaled defect {:.3e} > {:.3e}); increase NTST or NCOL",
                defect,
                self.adaptivity.defect_tolerance
            );
        }
        Ok(defect)
    }

    fn record_defect_termination(
        &mut self,
        reason: CollocationDefectTerminationReason,
        measured_defect: f64,
    ) {
        self.adaptation_report.termination = Some(CollocationDefectTermination {
            reason,
            measured_defect,
            tolerance: self.adaptivity.defect_tolerance,
            mesh_points: self.mesh_points,
            degree: self.degree,
            refinements_attempted: self
                .adaptation_report
                .attempts
                .len()
                .saturating_sub(self.adaptation_transfer_start_index),
            refinement_budget: self.adaptivity.max_refinements,
            max_mesh_points: self.adaptivity.max_mesh_points,
            normalized_mesh: self.normalized_mesh.clone(),
        });
    }

    fn replace_mesh(&mut self, normalized_mesh: Vec<f64>) -> Result<()> {
        let mesh_points = normalized_mesh.len().saturating_sub(1);
        self.normalized_mesh = validated_normalized_mesh(mesh_points, &normalized_mesh)?;
        self.mesh_points = mesh_points;
        let stage_count = self.stage_count();
        let dim = self.state_dim();
        self.phase_reference_stages = None;
        self.phase_reference_derivative = None;
        self.work_stage_f = vec![0.0; stage_count * dim];
        self.work_stage_jac = vec![0.0; stage_count * dim * dim];
        self.work_stage_param = vec![0.0; stage_count * dim];
        self.adaptation_report.current_mesh_points = mesh_points;
        self.adaptation_report.current_normalized_mesh = self.normalized_mesh.clone();
        self.adaptation_report.termination = None;
        Ok(())
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
        for interval in 0..self.mesh_points {
            let mesh_weight = node_weights[interval * (self.degree + 1)];
            for component in 0..dim {
                weights[1 + interval * dim + component] = mesh_weight;
            }
        }
        let stage_start = self.stage_offset();
        for interval in 0..self.mesh_points {
            for stage in 0..self.degree {
                let weight = node_weights[interval * (self.degree + 1) + stage + 1];
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
        let out_slice = out.as_mut_slice();
        let stage_len = self.stage_count() * dim;
        let continuity_offset = stage_len;
        let phase_index = continuity_offset + self.mesh_points * dim;

        for interval in 0..self.mesh_points {
            let h = period * self.interval_width(interval);
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
            let h = period * self.interval_width(interval);
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
        // Stage residuals
        for interval in 0..self.mesh_points {
            let interval_width = self.interval_width(interval);
            let h = period * interval_width;
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
                    jac[(row_base + r, period_col)] = -interval_width * period_sum;
                }
            }
        }

        // Continuity rows
        let continuity_offset = self.stage_count() * dim_state;
        for interval in 0..self.mesh_points {
            let interval_width = self.interval_width(interval);
            let h = period * interval_width;
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
                jac[(row_base + r, period_col)] = -interval_width * period_sum;
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
                let weight = self.interval_width(interval) * self.coeffs.b[stage];
                for component in 0..dim_state {
                    jac[(phase_row, col_start + component)] =
                        weight * phase_derivative[stage_index * dim_state + component];
                }
            }
        }

        Ok(jac)
    }

    fn classify_bifurcation(
        &mut self,
        aug_state: &DVector<f64>,
        detected: BifurcationType,
    ) -> Result<BifurcationType> {
        if detected != BifurcationType::CycleFold {
            return Ok(detected);
        }
        let setup = self.normal_form_setup(aug_state)?;
        let param_index = self.context.param_index;
        let normal_form =
            periodic_branch_point_normal_form(self.context.system, &setup, param_index)?;
        Ok(periodic_plus_one_bifurcation_type(&normal_form))
    }

    fn is_step_acceptable(&mut self, aug_state: &DVector<f64>) -> Result<bool> {
        Ok(self.scaled_collocation_defect(aug_state)? <= self.adaptivity.defect_tolerance)
    }

    fn handle_step_rejection(
        &mut self,
        accepted_aug: &DVector<f64>,
        accepted_tangent: &DVector<f64>,
        rejected_aug: &DVector<f64>,
        branch_states: &[Vec<f64>],
    ) -> Result<StepRejectionAction> {
        let estimate = self.scaled_collocation_defect_estimate(rejected_aug)?;
        if estimate.max_scaled_defect <= self.adaptivity.defect_tolerance {
            return Ok(StepRejectionAction::ReduceStep);
        }
        if !self.adaptivity.enabled {
            self.record_defect_termination(
                CollocationDefectTerminationReason::AdaptivityDisabled,
                estimate.max_scaled_defect,
            );
            return Ok(StepRejectionAction::Terminate);
        }
        let current_run_attempts = &self.adaptation_report.attempts[self
            .adaptation_transfer_start_index
            .min(self.adaptation_report.attempts.len())..];
        if current_run_attempts.len() >= self.adaptivity.max_refinements {
            self.record_defect_termination(
                CollocationDefectTerminationReason::RefinementBudgetExhausted,
                estimate.max_scaled_defect,
            );
            return Ok(StepRejectionAction::Terminate);
        }

        let old_mesh_points = self.mesh_points;
        let old_normalized_mesh = self.normalized_mesh.clone();
        let already_redistributed = current_run_attempts
            .iter()
            .any(|attempt| attempt.kind == CollocationMeshAdaptationKind::Redistribution);
        let redistribution = if self.adaptivity.redistribution_enabled && !already_redistributed {
            let candidate = defect_weighted_normalized_mesh(
                &old_normalized_mesh,
                &estimate.interval_scaled_defects,
                self.degree,
                old_mesh_points,
            )?;
            meshes_materially_different(&candidate, &old_normalized_mesh).then_some(candidate)
        } else {
            None
        };
        let (kind, new_normalized_mesh) = if let Some(candidate) = redistribution {
            (CollocationMeshAdaptationKind::Redistribution, candidate)
        } else {
            if old_mesh_points >= self.adaptivity.max_mesh_points {
                self.record_defect_termination(
                    CollocationDefectTerminationReason::MeshPointLimitReached,
                    estimate.max_scaled_defect,
                );
                return Ok(StepRejectionAction::Terminate);
            }
            let Some(new_mesh_points) = propose_uniform_mesh_refinement(
                &estimate.interval_scaled_defects,
                self.degree,
                self.adaptivity.defect_tolerance,
                self.adaptivity.max_mesh_points,
            ) else {
                self.record_defect_termination(
                    CollocationDefectTerminationReason::RefinementStalled,
                    estimate.max_scaled_defect,
                );
                return Ok(StepRejectionAction::Terminate);
            };
            (
                CollocationMeshAdaptationKind::Refinement,
                defect_weighted_normalized_mesh(
                    &old_normalized_mesh,
                    &estimate.interval_scaled_defects,
                    self.degree,
                    new_mesh_points,
                )?,
            )
        };
        let new_mesh_points = new_normalized_mesh.len() - 1;

        let dim = self.state_dim();
        let nodes = self.coeffs.nodes.clone();
        let transferred_aug = transfer_collocation_aug(
            accepted_aug,
            &old_normalized_mesh,
            &new_normalized_mesh,
            self.degree,
            dim,
            &nodes,
        )?;
        let transferred_tangent = transfer_collocation_aug(
            accepted_tangent,
            &old_normalized_mesh,
            &new_normalized_mesh,
            self.degree,
            dim,
            &nodes,
        )?;
        let transferred_branch_states = branch_states
            .iter()
            .map(|state| {
                transfer_collocation_state(
                    state,
                    &old_normalized_mesh,
                    &new_normalized_mesh,
                    self.degree,
                    dim,
                    &nodes,
                )
            })
            .collect::<Result<Vec<_>>>()?;

        self.adaptation_report
            .attempts
            .push(CollocationRefinementAttempt {
                sequence: self.adaptation_report.attempts.len() + 1,
                kind,
                old_mesh_points,
                new_mesh_points,
                degree: self.degree,
                trigger_defect: estimate.max_scaled_defect,
                tolerance: self.adaptivity.defect_tolerance,
                interval_scaled_defects: estimate.interval_scaled_defects,
                old_normalized_mesh,
                new_normalized_mesh: new_normalized_mesh.clone(),
            });
        self.replace_mesh(new_normalized_mesh)?;

        Ok(StepRejectionAction::Refined {
            accepted_aug: transferred_aug,
            accepted_tangent: transferred_tangent,
            branch_states: transferred_branch_states,
            branch_type: Some(BranchType::LimitCycle {
                ntst: new_mesh_points,
                ncol: self.degree,
                normalized_mesh: self.normalized_mesh.clone(),
            }),
        })
    }

    fn transfer_branch_states_to_current_discretization(
        &self,
        branch_states: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        let dim = self.state_dim();
        let nodes = &self.coeffs.nodes;
        let mut transferred = branch_states.to_vec();
        for attempt in &self.adaptation_report.attempts[self
            .adaptation_transfer_start_index
            .min(self.adaptation_report.attempts.len())..]
        {
            transferred = transferred
                .iter()
                .map(|state| {
                    transfer_collocation_state(
                        state,
                        &attempt.old_normalized_mesh,
                        &attempt.new_normalized_mesh,
                        self.degree,
                        dim,
                        nodes,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
        }
        if transferred
            .iter()
            .any(|state| state.len() != self.dimension())
        {
            bail!("Adaptive collocation failed to transfer an external branch to the final mesh");
        }
        Ok(transferred)
    }

    fn refresh_persisted_point_after_state_transfer(
        &self,
        point: &mut ContinuationPoint,
    ) -> Result<()> {
        // Limit-cycle rendering decodes the authoritative packed collocation
        // state using BranchType mesh metadata. A legacy auxiliary payload is
        // tied to the old mesh, so retaining it would expose stale geometry.
        point.cycle_points = None;
        Ok(())
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
    pub floquet_backend: FloquetBackend,
}

#[derive(Debug, Clone)]
struct CyclicFloquetMode {
    #[allow(dead_code)]
    multiplier: Complex<f64>,
    root: Complex<f64>,
    cyclic_vector: Vec<Complex<f64>>,
}

#[derive(Debug, Clone)]
struct FloquetComputation {
    multipliers: Vec<Complex<f64>>,
    mesh_vectors: Vec<Vec<Vec<Complex<f64>>>>,
    backend: FloquetBackend,
}

const MAX_DENSE_CYCLIC_DIMENSION: usize = 2048;
const AUTO_PERIODIC_SCHUR_DIMENSION: usize = 96;

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

fn block_cyclic_floquet_computation(
    transfers: &[DMatrix<f64>],
    compute_vectors: bool,
) -> Result<FloquetComputation> {
    let (cyclic, roots, multipliers) = cyclic_floquet_spectrum(transfers)?;
    let mesh_vectors = if compute_vectors {
        let dim = transfers[0].nrows();
        let modes =
            cyclic_floquet_modes_from_selected_roots(&cyclic, transfers, &roots, &multipliers)?;
        (0..transfers.len())
            .map(|mesh_index| {
                modes
                    .iter()
                    .map(|mode| cyclic_mode_mesh_vector(mode, mesh_index, dim))
                    .collect::<Result<Vec<_>>>()
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        Vec::new()
    };
    Ok(FloquetComputation {
        multipliers,
        mesh_vectors,
        backend: FloquetBackend::BlockCyclic,
    })
}

fn periodic_schur_floquet_computation(
    transfers: &[DMatrix<f64>],
    compute_vectors: bool,
) -> Result<FloquetComputation> {
    let spectrum = periodic_schur_floquet_spectrum(transfers, compute_vectors)?;
    Ok(FloquetComputation {
        multipliers: spectrum.multipliers,
        mesh_vectors: spectrum.mesh_vectors,
        backend: FloquetBackend::PeriodicSchur,
    })
}

fn floquet_computation(
    transfers: &[DMatrix<f64>],
    backend: FloquetBackend,
    compute_vectors: bool,
) -> Result<FloquetComputation> {
    let dim = transfers
        .first()
        .ok_or_else(|| anyhow!("Floquet extraction requires transfer matrices."))?
        .nrows();
    let block_dimension = transfers
        .len()
        .checked_mul(dim)
        .ok_or_else(|| anyhow!("Floquet operator dimension overflow."))?;
    match backend {
        FloquetBackend::PeriodicSchur => {
            periodic_schur_floquet_computation(transfers, compute_vectors)
        }
        FloquetBackend::BlockCyclic => block_cyclic_floquet_computation(transfers, compute_vectors),
        FloquetBackend::Auto if block_dimension <= AUTO_PERIODIC_SCHUR_DIMENSION => {
            match block_cyclic_floquet_computation(transfers, compute_vectors) {
                Ok(result) => Ok(result),
                Err(reference_error) => {
                    periodic_schur_floquet_computation(transfers, compute_vectors).map_err(
                        |schur_error| {
                            anyhow!(
                        "Both Floquet backends failed (block-cyclic: {}; periodic Schur: {}).",
                        reference_error,
                        schur_error
                    )
                        },
                    )
                }
            }
        }
        FloquetBackend::Auto => {
            match periodic_schur_floquet_computation(transfers, compute_vectors) {
                Ok(result) => Ok(result),
                Err(schur_error) if block_dimension <= MAX_DENSE_CYCLIC_DIMENSION => {
                    block_cyclic_floquet_computation(transfers, compute_vectors).map_err(
                        |reference_error| {
                            anyhow!(
                                "Both Floquet backends failed (periodic Schur: {}; block-cyclic: {}).",
                                schur_error,
                                reference_error
                            )
                        },
                    )
                }
                Err(schur_error) => Err(schur_error.context(format!(
                    "Periodic Schur was required because the dense block dimension {} exceeds {}",
                    block_dimension, MAX_DENSE_CYCLIC_DIMENSION
                ))),
            }
        }
    }
}

pub(crate) fn floquet_real_eigenvector_from_transfers(
    transfers: &[DMatrix<f64>],
    target_multiplier: Complex<f64>,
) -> Result<(Complex<f64>, Vec<f64>)> {
    let computation = floquet_computation(transfers, FloquetBackend::Auto, true)?;
    let mode_index = computation
        .multipliers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            (**a - target_multiplier)
                .norm_sqr()
                .total_cmp(&(**b - target_multiplier).norm_sqr())
        })
        .map(|(index, _)| index)
        .ok_or_else(|| anyhow!("Floquet spectrum is empty."))?;
    let mesh_vector = computation
        .mesh_vectors
        .first()
        .and_then(|vectors| vectors.get(mode_index))
        .ok_or_else(|| anyhow!("Floquet backend did not return an anchor mode vector."))?;
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
    Ok((computation.multipliers[mode_index], real))
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
    extract_monodromy_data_from_collocation_jacobian_with_backend(
        jac,
        dim,
        ntst,
        ncol,
        FloquetBackend::Auto,
    )
}

fn extract_monodromy_data_from_collocation_jacobian_with_backend(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
    backend: FloquetBackend,
) -> Result<MonodromyData> {
    let (transfers, stage_sensitivities) =
        extract_collocation_transfer_data_from_jacobian(jac, dim, ntst, ncol)?;
    let spectrum = floquet_computation(&transfers, backend, false)?;

    Ok(MonodromyData {
        transfers,
        stage_sensitivities,
        multipliers: spectrum.multipliers,
        floquet_backend: spectrum.backend,
    })
}

/// Floquet multiplier extraction from the orthogonal-collocation Jacobian.
///
/// For each interval, we eliminate stages using collocation equations and get the
/// mesh-to-mesh transfer from continuity:
/// T_i = -C_{next}^{-1} * (C_x + C_s * ds_dx)
///
/// `Auto` uses the dense block-cyclic reference for small discretizations and a
/// product-free periodic Schur decomposition for large meshes.  Neither path
/// explicitly chains a monodromy product, preserving strongly contracting modes
/// when a cycle is long or stiff.
pub fn extract_multipliers_collocation(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<Vec<Complex<f64>>> {
    let monodromy_data = extract_monodromy_data_from_collocation_jacobian(jac, dim, ntst, ncol)?;
    Ok(monodromy_data.multipliers)
}

/// Floquet multiplier extraction with an explicit backend selection.
///
/// The returned backend is concrete (`PeriodicSchur` or `BlockCyclic`) even
/// when `Auto` was requested, so callers can surface the numerical provenance.
pub fn extract_multipliers_collocation_with_backend(
    jac: &DMatrix<f64>,
    dim: usize,
    ntst: usize,
    ncol: usize,
    backend: FloquetBackend,
) -> Result<(Vec<Complex<f64>>, FloquetBackend)> {
    let data = extract_monodromy_data_from_collocation_jacobian_with_backend(
        jac, dim, ntst, ncol, backend,
    )?;
    Ok((data.multipliers, data.floquet_backend))
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
    compute_cycle_monodromy_data_on_mesh(
        system,
        param_index,
        cycle_state,
        ncol,
        uniform_normalized_mesh(ntst),
    )
}

pub(crate) fn compute_cycle_monodromy_data_on_mesh(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ncol: usize,
    normalized_mesh: Vec<f64>,
) -> Result<MonodromyData> {
    let ntst = normalized_mesh.len().saturating_sub(1);
    let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
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
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
        system,
        param_index,
        ncol,
        phase_anchor,
        phase_direction,
        normalized_mesh,
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
    compute_limit_cycle_floquet_modes_with_backend(
        system,
        param_index,
        cycle_state,
        ntst,
        ncol,
        FloquetBackend::Auto,
    )
}

pub fn compute_limit_cycle_floquet_modes_with_backend(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ntst: usize,
    ncol: usize,
    backend: FloquetBackend,
) -> Result<FloquetModeVectors> {
    compute_limit_cycle_floquet_modes_on_mesh_with_backend(
        system,
        param_index,
        cycle_state,
        ncol,
        uniform_normalized_mesh(ntst),
        backend,
    )
}

pub fn compute_limit_cycle_floquet_modes_on_mesh(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ncol: usize,
    normalized_mesh: Vec<f64>,
) -> Result<FloquetModeVectors> {
    compute_limit_cycle_floquet_modes_on_mesh_with_backend(
        system,
        param_index,
        cycle_state,
        ncol,
        normalized_mesh,
        FloquetBackend::Auto,
    )
}

pub fn compute_limit_cycle_floquet_modes_on_mesh_with_backend(
    system: &mut EquationSystem,
    param_index: usize,
    cycle_state: &[f64],
    ncol: usize,
    normalized_mesh: Vec<f64>,
    backend: FloquetBackend,
) -> Result<FloquetModeVectors> {
    let ntst = normalized_mesh.len().saturating_sub(1);
    let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
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
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
        system,
        param_index,
        ncol,
        phase_anchor,
        phase_direction,
        normalized_mesh.clone(),
    )?;

    let mut aug_state = DVector::zeros(1 + packed_implicit.len());
    aug_state[0] = param_value;
    for (index, value) in packed_implicit.iter().enumerate() {
        aug_state[index + 1] = *value;
    }
    let jac = problem.extended_jacobian(&aug_state)?;
    let (transfers, stage_sensitivities) =
        extract_collocation_transfer_data_from_jacobian(&jac, dim, ntst, ncol)?;
    let computation = floquet_computation(&transfers, backend, true)?;
    if computation.multipliers.is_empty() || computation.mesh_vectors.len() != ntst {
        bail!("Floquet mode computation failed: no multipliers returned.");
    }

    let mut vectors: Vec<Vec<Vec<ComplexNumber>>> = Vec::with_capacity(ntst * (ncol + 1) + 1);
    vectors.push(
        computation.mesh_vectors[0]
            .iter()
            .map(|mode| mode.iter().copied().map(ComplexNumber::from).collect())
            .collect(),
    );

    for (interval, ds_dx) in stage_sensitivities.iter().enumerate() {
        let mesh_mode_vectors = &computation.mesh_vectors[interval];

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
            computation.mesh_vectors[interval + 1].clone()
        } else {
            computation.mesh_vectors[0]
                .iter()
                .zip(&computation.multipliers)
                .map(|(first, multiplier)| {
                    first
                        .iter()
                        .map(|value| *value * *multiplier)
                        .collect::<Vec<_>>()
                })
                .collect()
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
        normalized_mesh,
        backend: computation.backend,
        multipliers: computation
            .multipliers
            .iter()
            .copied()
            .map(ComplexNumber::from)
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
    let mut nontrivial = Vec::with_capacity(values.len().saturating_sub(1));
    for (idx, mu) in values.iter().enumerate() {
        if idx == trivial_idx {
            continue;
        }
        nontrivial.push(*mu);
        let real_tolerance = 1e-8 * mu.norm().max(1.0);
        if mu.im.abs() <= real_tolerance {
            cf_test = saturated_product(cf_test, mu.re - 1.0);
            pd_test = saturated_product(pd_test, mu.re + 1.0);
        }
    }

    // The NS condition is the bialternate-product determinant
    //
    //     product_{i < j} (mu_i * mu_j - 1),
    //
    // after removing the autonomous trivial multiplier.  For a conjugate
    // pair this contains |mu|^2 - 1, but unlike selecting only currently
    // complex pairs it is continuous when two stable real multipliers collide
    // and leave the real axis.  A spectrum with fewer than two nontrivial
    // multipliers cannot contain an NS pair and uses a fixed positive sentinel.
    let ns_test = if nontrivial.len() < 2 {
        1.0
    } else {
        const MAX_COMPLEX_PRODUCT_NORM: f64 = 1.0e150;
        let shifted_multiplier_product = |left: Complex<f64>, right: Complex<f64>| {
            let left_norm = left.norm();
            let right_norm = right.norm();
            if left_norm == 0.0 || right_norm == 0.0 {
                return Complex::new(-1.0, 0.0);
            }
            if !left_norm.is_finite() || !right_norm.is_finite() {
                return Complex::new(f64::NAN, f64::NAN);
            }
            if left_norm > MAX_COMPLEX_PRODUCT_NORM / right_norm {
                let phase = (left / left_norm) * (right / right_norm);
                return phase / phase.norm() * MAX_COMPLEX_PRODUCT_NORM;
            }
            left * right - Complex::new(1.0, 0.0)
        };
        let saturated_complex_product = |accumulator: Complex<f64>, factor: Complex<f64>| {
            let accumulator_norm = accumulator.norm();
            let factor_norm = factor.norm();
            if accumulator_norm == 0.0 || factor_norm == 0.0 {
                return Complex::new(0.0, 0.0);
            }
            if !accumulator_norm.is_finite() || !factor_norm.is_finite() {
                return Complex::new(f64::NAN, f64::NAN);
            }
            let phase = (accumulator / accumulator_norm) * (factor / factor_norm);
            let phase_norm = phase.norm();
            if !phase_norm.is_finite() || phase_norm == 0.0 {
                return Complex::new(f64::NAN, f64::NAN);
            }
            let magnitude = if accumulator_norm > MAX_COMPLEX_PRODUCT_NORM / factor_norm {
                MAX_COMPLEX_PRODUCT_NORM
            } else {
                (accumulator_norm * factor_norm).min(MAX_COMPLEX_PRODUCT_NORM)
            };
            phase / phase_norm * magnitude
        };

        let mut product = Complex::new(1.0, 0.0);
        for left in 0..nontrivial.len() - 1 {
            for right in left + 1..nontrivial.len() {
                let factor = shifted_multiplier_product(nontrivial[left], nontrivial[right]);
                product = saturated_complex_product(product, factor);
            }
        }
        if !product.re.is_finite() || !product.im.is_finite() {
            f64::NAN
        } else {
            // A real dynamical system has a conjugation-closed Floquet
            // spectrum, so the complete bialternate product is real.  Refuse
            // an NS flag if a badly resolved spectrum violates that invariant.
            let reality_tolerance = 1e-7 * product.norm().max(1.0);
            if product.im.abs() > reality_tolerance {
                f64::NAN
            } else {
                product.re
            }
        }
    };

    (cf_test, pd_test, ns_test, values)
}

pub(crate) fn propose_uniform_mesh_refinement(
    interval_scaled_defects: &[f64],
    degree: usize,
    tolerance: f64,
    max_mesh_points: usize,
) -> Option<usize> {
    let current_mesh_points = interval_scaled_defects.len();
    if current_mesh_points == 0
        || degree == 0
        || !tolerance.is_finite()
        || tolerance <= 0.0
        || max_mesh_points <= current_mesh_points
    {
        return None;
    }

    // Estimate the number of uniform subintervals represented by each old
    // interval.  The target is deliberately below the hard tolerance so one
    // remesh has room for interpolation and Newton-correction error.
    let target = 0.5 * tolerance;
    let convergence_order = (degree + 1) as f64;
    let requested = interval_scaled_defects
        .iter()
        .map(|defect| {
            if !defect.is_finite() || *defect <= target {
                1usize
            } else {
                ((*defect / target).powf(1.0 / convergence_order).ceil() as usize).max(1)
            }
        })
        .sum::<usize>();

    // Bound a single dimension change to 2x.  Repeated refinements are
    // controlled separately by the retry budget.  A 1.5x floor prevents a
    // nearly-threshold hot interval from causing a sequence of ineffective
    // one-point global refinements when the storage mesh is uniform.
    let minimum_growth = current_mesh_points.saturating_mul(3).saturating_add(1) / 2;
    let growth_cap = current_mesh_points.saturating_mul(2);
    let proposed = requested
        .max(minimum_growth)
        .min(growth_cap)
        .min(max_mesh_points);
    (proposed > current_mesh_points).then_some(proposed)
}

pub(crate) fn meshes_materially_different(left: &[f64], right: &[f64]) -> bool {
    left.len() != right.len()
        || left
            .iter()
            .zip(right)
            .any(|(lhs, rhs)| (lhs - rhs).abs() > 1e-8)
}

pub(crate) fn interpolate_local_profile(
    local_nodes: &[f64],
    local_values: &[f64],
    tau: f64,
) -> Result<f64> {
    if local_nodes.len() != local_values.len() || local_nodes.is_empty() {
        bail!("Collocation profile interpolation layout mismatch");
    }
    for (node, value) in local_nodes.iter().zip(local_values) {
        if (tau - node).abs() <= 8.0 * f64::EPSILON {
            return Ok(*value);
        }
    }
    let mut result = 0.0;
    for (index, node) in local_nodes.iter().enumerate() {
        let mut basis = 1.0;
        for (other_index, other_node) in local_nodes.iter().enumerate() {
            if index == other_index {
                continue;
            }
            let denominator = node - other_node;
            if denominator.abs() <= f64::EPSILON {
                bail!("Collocation interpolation nodes must be distinct");
            }
            basis *= (tau - other_node) / denominator;
        }
        result += basis * local_values[index];
    }
    Ok(result)
}

fn sample_collocation_component(
    aug: &DVector<f64>,
    normalized_mesh: &[f64],
    degree: usize,
    dim: usize,
    nodes: &[f64],
    normalized_time: f64,
    component: usize,
) -> Result<f64> {
    let mesh_points = normalized_mesh.len().saturating_sub(1);
    let expected_len = 1 + mesh_points * (degree + 1) * dim + 1;
    if aug.len() != expected_len || nodes.len() != degree || component >= dim {
        bail!("Collocation profile transfer layout mismatch");
    }
    let wrapped = normalized_time.rem_euclid(1.0);
    let interval = normalized_mesh
        .partition_point(|coordinate| *coordinate <= wrapped)
        .saturating_sub(1)
        .min(mesh_points - 1);
    let width = normalized_mesh[interval + 1] - normalized_mesh[interval];
    let tau = (wrapped - normalized_mesh[interval]) / width;
    let stage_offset = 1 + mesh_points * dim;
    let mut local_nodes = Vec::with_capacity(degree + 1);
    let mut local_values = Vec::with_capacity(degree + 1);
    local_nodes.push(0.0);
    local_values.push(aug[1 + interval * dim + component]);
    for (stage, node) in nodes.iter().enumerate() {
        local_nodes.push(*node);
        let stage_index = interval * degree + stage;
        local_values.push(aug[stage_offset + stage_index * dim + component]);
    }
    interpolate_local_profile(&local_nodes, &local_values, tau)
}

pub(crate) fn transfer_collocation_aug(
    aug: &DVector<f64>,
    source_mesh: &[f64],
    destination_mesh: &[f64],
    degree: usize,
    dim: usize,
    nodes: &[f64],
) -> Result<DVector<f64>> {
    let old_mesh_points = source_mesh.len().saturating_sub(1);
    let new_mesh_points = destination_mesh.len().saturating_sub(1);
    let source_mesh = validated_normalized_mesh(old_mesh_points, source_mesh)?;
    let destination_mesh = validated_normalized_mesh(new_mesh_points, destination_mesh)?;
    let expected_old_len = 1 + old_mesh_points * (degree + 1) * dim + 1;
    if aug.len() != expected_old_len {
        bail!(
            "Cannot transfer collocation vector of length {}; expected {}",
            aug.len(),
            expected_old_len
        );
    }
    if new_mesh_points < 2 {
        bail!("Refined collocation mesh must have at least 2 points");
    }
    let new_len = 1 + new_mesh_points * (degree + 1) * dim + 1;
    let mut transferred = DVector::zeros(new_len);
    transferred[0] = aug[0];
    for interval in 0..new_mesh_points {
        let mesh_time = destination_mesh[interval];
        for component in 0..dim {
            transferred[1 + interval * dim + component] = sample_collocation_component(
                aug,
                &source_mesh,
                degree,
                dim,
                nodes,
                mesh_time,
                component,
            )?;
        }
    }
    let new_stage_offset = 1 + new_mesh_points * dim;
    for interval in 0..new_mesh_points {
        let left = destination_mesh[interval];
        let width = destination_mesh[interval + 1] - left;
        for (stage, node) in nodes.iter().enumerate() {
            let stage_time = left + width * node;
            let stage_index = interval * degree + stage;
            for component in 0..dim {
                transferred[new_stage_offset + stage_index * dim + component] =
                    sample_collocation_component(
                        aug,
                        &source_mesh,
                        degree,
                        dim,
                        nodes,
                        stage_time,
                        component,
                    )?;
            }
        }
    }
    transferred[new_len - 1] = aug[expected_old_len - 1];
    if transferred.iter().any(|value| !value.is_finite()) {
        bail!("Collocation profile transfer produced a non-finite value");
    }
    Ok(transferred)
}

fn transfer_collocation_state(
    state: &[f64],
    source_mesh: &[f64],
    destination_mesh: &[f64],
    degree: usize,
    dim: usize,
    nodes: &[f64],
) -> Result<Vec<f64>> {
    let mut aug = DVector::zeros(state.len() + 1);
    aug.as_mut_slice()[1..].copy_from_slice(state);
    Ok(
        transfer_collocation_aug(&aug, source_mesh, destination_mesh, degree, dim, nodes)?
            .as_slice()[1..]
            .to_vec(),
    )
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
    setup.normalized_mesh = setup.resolved_normalized_mesh()?;
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
    let mut mean = vec![0.0; dim];
    let mut mean_square_norm = 0.0;

    // Gauss weights give a mesh-independent L2 measure over normalized time.
    for interval in 0..problem.mesh_points {
        for stage in 0..problem.degree {
            let weight = problem.interval_width(interval) * problem.coeffs.b[stage];
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
            let weight = problem.interval_width(interval) * problem.coeffs.b[stage];
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
    correct_limit_cycle_setup_impl(
        system,
        param_index,
        setup,
        tolerance,
        max_iterations,
        true,
        None,
    )
}

fn correct_limit_cycle_setup_impl(
    system: &mut EquationSystem,
    param_index: usize,
    setup: LimitCycleSetup,
    tolerance: f64,
    max_iterations: usize,
    validate_defect: bool,
    normalized_mesh: Option<&[f64]>,
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

    let problem_mesh = normalized_mesh
        .map(ToOwned::to_owned)
        .map(Ok)
        .unwrap_or_else(|| setup.resolved_normalized_mesh())?;
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
        system,
        param_index,
        setup.collocation_degree,
        setup.phase_anchor.clone(),
        setup.phase_direction.clone(),
        problem_mesh,
    )?;
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
            if validate_defect {
                problem.validate_collocation_defect(&current).map_err(|error| {
                    anyhow!(
                        "Fixed-parameter limit-cycle correction converged algebraically but failed mesh validation: {error}"
                    )
                })?;
            }
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

fn correction_termination(
    report: &CollocationAdaptationReport,
    reason: CollocationDefectTerminationReason,
    measured_defect: f64,
) -> CollocationDefectTermination {
    CollocationDefectTermination {
        reason,
        measured_defect,
        tolerance: report.defect_tolerance,
        mesh_points: report.current_mesh_points,
        degree: report.degree,
        refinements_attempted: report.attempts.len(),
        refinement_budget: report.refinement_budget,
        max_mesh_points: report.max_mesh_points,
        normalized_mesh: report.current_normalized_mesh.clone(),
    }
}

/// Correct a sampled cycle and adapt its collocation mesh until the
/// independent defect check passes or the explicit refinement budget is
/// exhausted.
pub fn correct_limit_cycle_setup_adaptive(
    system: &mut EquationSystem,
    param_index: usize,
    setup: LimitCycleSetup,
    tolerance: f64,
    max_iterations: usize,
    adaptivity: CollocationAdaptivitySettings,
) -> Result<(LimitCycleSetup, Vec<f64>, CollocationAdaptationReport)> {
    if !adaptivity.defect_tolerance.is_finite() || adaptivity.defect_tolerance <= 0.0 {
        bail!("Collocation defect tolerance must be finite and positive");
    }
    if adaptivity.max_mesh_points < 2 {
        bail!("Adaptive collocation requires a mesh-point cap of at least 2");
    }

    let state_dim = system.equations.len();
    let initial_mesh_points = setup.mesh_points;
    let initial_normalized_mesh = setup.resolved_normalized_mesh()?;
    let degree = setup.collocation_degree;
    let mut report = CollocationAdaptationReport {
        initial_mesh_points,
        current_mesh_points: initial_mesh_points,
        degree,
        defect_tolerance: adaptivity.defect_tolerance,
        refinement_budget: adaptivity.max_refinements,
        max_mesh_points: adaptivity.max_mesh_points,
        initial_normalized_mesh: initial_normalized_mesh.clone(),
        current_normalized_mesh: initial_normalized_mesh.clone(),
        attempts: Vec::new(),
        termination: None,
    };
    let mut current_setup = setup;
    let mut current_normalized_mesh = initial_normalized_mesh;

    loop {
        let (mut corrected_setup, corrected_state) = correct_limit_cycle_setup_impl(
            system,
            param_index,
            current_setup,
            tolerance,
            max_iterations,
            false,
            Some(&current_normalized_mesh),
        )?;
        let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh_with_adaptivity(
            system,
            param_index,
            corrected_setup.collocation_degree,
            corrected_setup.phase_anchor.clone(),
            corrected_setup.phase_direction.clone(),
            current_normalized_mesh.clone(),
            adaptivity,
        )?;
        let mut corrected_aug = DVector::zeros(corrected_state.len() + 1);
        corrected_aug[0] = corrected_setup.guess.param_value;
        corrected_aug.as_mut_slice()[1..].copy_from_slice(&corrected_state);
        let estimate = problem.scaled_collocation_defect_estimate(&corrected_aug)?;
        drop(problem);
        if estimate.max_scaled_defect <= adaptivity.defect_tolerance {
            report.current_mesh_points = corrected_setup.mesh_points;
            report.current_normalized_mesh = current_normalized_mesh;
            return Ok((corrected_setup, corrected_state, report));
        }

        if !adaptivity.enabled {
            let termination = correction_termination(
                &report,
                CollocationDefectTerminationReason::AdaptivityDisabled,
                estimate.max_scaled_defect,
            );
            report.termination = Some(termination.clone());
            return Err(CollocationDefectTerminationError { termination }.into());
        }

        if report.attempts.len() >= adaptivity.max_refinements {
            let termination = correction_termination(
                &report,
                CollocationDefectTerminationReason::RefinementBudgetExhausted,
                estimate.max_scaled_defect,
            );
            report.termination = Some(termination.clone());
            return Err(CollocationDefectTerminationError { termination }.into());
        }
        let old_mesh_points = corrected_setup.mesh_points;
        let old_normalized_mesh = current_normalized_mesh.clone();
        let already_redistributed = report
            .attempts
            .iter()
            .any(|attempt| attempt.kind == CollocationMeshAdaptationKind::Redistribution);
        let redistribution = if adaptivity.redistribution_enabled && !already_redistributed {
            let candidate = defect_weighted_normalized_mesh(
                &old_normalized_mesh,
                &estimate.interval_scaled_defects,
                degree,
                old_mesh_points,
            )?;
            meshes_materially_different(&candidate, &old_normalized_mesh).then_some(candidate)
        } else {
            None
        };
        let (kind, new_normalized_mesh) = if let Some(candidate) = redistribution {
            (CollocationMeshAdaptationKind::Redistribution, candidate)
        } else {
            let Some(new_mesh_points) = propose_uniform_mesh_refinement(
                &estimate.interval_scaled_defects,
                degree,
                adaptivity.defect_tolerance,
                adaptivity.max_mesh_points,
            ) else {
                let reason = if old_mesh_points >= adaptivity.max_mesh_points {
                    CollocationDefectTerminationReason::MeshPointLimitReached
                } else {
                    CollocationDefectTerminationReason::RefinementStalled
                };
                let termination =
                    correction_termination(&report, reason, estimate.max_scaled_defect);
                report.termination = Some(termination.clone());
                return Err(CollocationDefectTerminationError { termination }.into());
            };
            (
                CollocationMeshAdaptationKind::Refinement,
                defect_weighted_normalized_mesh(
                    &old_normalized_mesh,
                    &estimate.interval_scaled_defects,
                    degree,
                    new_mesh_points,
                )?,
            )
        };
        let new_mesh_points = new_normalized_mesh.len() - 1;

        let coeffs = CollocationCoefficients::new(degree)?;
        let transferred = transfer_collocation_aug(
            &corrected_aug,
            &old_normalized_mesh,
            &new_normalized_mesh,
            degree,
            state_dim,
            &coeffs.nodes,
        )?;
        report.attempts.push(CollocationRefinementAttempt {
            sequence: report.attempts.len() + 1,
            kind,
            old_mesh_points,
            new_mesh_points,
            degree,
            trigger_defect: estimate.max_scaled_defect,
            tolerance: adaptivity.defect_tolerance,
            interval_scaled_defects: estimate.interval_scaled_defects,
            old_normalized_mesh,
            new_normalized_mesh: new_normalized_mesh.clone(),
        });
        report.current_mesh_points = new_mesh_points;
        report.current_normalized_mesh = new_normalized_mesh.clone();
        current_normalized_mesh = new_normalized_mesh;

        corrected_setup.mesh_points = new_mesh_points;
        corrected_setup.normalized_mesh = current_normalized_mesh.clone();
        corrected_setup.guess.mesh_states = vec![vec![0.0; state_dim]; new_mesh_points];
        corrected_setup.guess.stage_states =
            vec![vec![vec![0.0; state_dim]; degree]; new_mesh_points];
        write_flat_state_to_setup(
            &mut corrected_setup,
            state_dim,
            &transferred.as_slice()[1..],
        )?;
        corrected_setup.guess.requires_fixed_parameter_correction = true;
        current_setup = corrected_setup;
    }
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

pub(crate) fn lagrange_coefficients(nodes: &[f64]) -> Result<Vec<Vec<f64>>> {
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

pub(crate) fn integrate_polynomial(coeffs: &[f64], upper: f64) -> f64 {
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
    Ok(continue_limit_cycle_collocation_with_report(
        system,
        param_index,
        config,
        guess,
        settings,
        forward,
        CollocationAdaptivitySettings::default(),
    )?
    .branch)
}

pub fn continue_limit_cycle_collocation_with_report(
    system: &mut EquationSystem,
    param_index: usize,
    config: CollocationConfig,
    guess: LimitCycleGuess,
    settings: ContinuationSettings,
    forward: bool,
    adaptivity: CollocationAdaptivitySettings,
) -> Result<LimitCycleContinuationResult> {
    if guess.period <= 0.0 {
        bail!("Initial period must be positive");
    }
    let setup = LimitCycleSetup {
        guess,
        phase_anchor: config.phase_anchor,
        phase_direction: config.phase_direction,
        mesh_points: config.mesh_points,
        collocation_degree: config.degree,
        normalized_mesh: config.normalized_mesh,
    };
    let (setup, flat_state, correction_report) = if setup.guess.requires_fixed_parameter_correction
    {
        let correction_iterations = settings.corrector_steps.max(8);
        correct_limit_cycle_setup_adaptive(
            system,
            param_index,
            setup,
            settings.corrector_tolerance,
            correction_iterations,
            adaptivity,
        )?
    } else {
        let initial_mesh_points = setup.mesh_points;
        let degree = setup.collocation_degree;
        let (setup, flat_state) = prepare_limit_cycle_setup(setup, system.equations.len())?;
        let initial_normalized_mesh = setup.resolved_normalized_mesh()?;
        (
            setup,
            flat_state,
            CollocationAdaptationReport {
                initial_mesh_points,
                current_mesh_points: initial_mesh_points,
                degree,
                defect_tolerance: adaptivity.defect_tolerance,
                refinement_budget: adaptivity.max_refinements,
                max_mesh_points: adaptivity.max_mesh_points,
                initial_normalized_mesh: initial_normalized_mesh.clone(),
                current_normalized_mesh: initial_normalized_mesh,
                attempts: Vec::new(),
                termination: None,
            },
        )
    };
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh_with_adaptivity(
        system,
        param_index,
        setup.collocation_degree,
        setup.phase_anchor.clone(),
        setup.phase_direction.clone(),
        setup.resolved_normalized_mesh()?,
        adaptivity,
    )?;
    problem.adaptation_report = correction_report;
    let point = ContinuationPoint {
        state: flat_state,
        param_value: setup.guess.param_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
        homoclinic_events: None,
    };

    let mut branch = continue_with_problem(&mut problem, point, settings, forward)?;
    branch.branch_type = BranchType::LimitCycle {
        ntst: problem.mesh_points,
        ncol: problem.degree,
        normalized_mesh: problem.normalized_mesh.clone(),
    };
    Ok(LimitCycleContinuationResult {
        branch,
        collocation_adaptation: problem.adaptation_report().clone(),
    })
}

pub fn extend_limit_cycle_collocation(
    system: &mut EquationSystem,
    param_index: usize,
    config: CollocationConfig,
    branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    Ok(extend_limit_cycle_collocation_with_report(
        system,
        param_index,
        config,
        branch,
        settings,
        forward,
        CollocationAdaptivitySettings::default(),
    )?
    .branch)
}

pub fn extend_limit_cycle_collocation_with_report(
    system: &mut EquationSystem,
    param_index: usize,
    config: CollocationConfig,
    branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
    adaptivity: CollocationAdaptivitySettings,
) -> Result<LimitCycleContinuationResult> {
    let normalized_mesh = validated_normalized_mesh(config.mesh_points, &config.normalized_mesh)?;
    let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh_with_adaptivity(
        system,
        param_index,
        config.degree,
        config.phase_anchor,
        config.phase_direction,
        normalized_mesh,
        adaptivity,
    )?;
    let mut result = extend_branch_with_problem(&mut problem, branch, settings, forward)?;
    result.branch_type = BranchType::LimitCycle {
        ntst: problem.mesh_points,
        ncol: problem.degree,
        normalized_mesh: problem.normalized_mesh.clone(),
    };
    Ok(LimitCycleContinuationResult {
        branch: result,
        collocation_adaptation: problem.adaptation_report().clone(),
    })
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
    fn nonuniform_collocation_jacobian_matches_finite_differences() {
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
        let normalized_mesh = vec![0.0, 0.12, 0.58, 1.0];
        let mut system = EquationSystem::new(vec![equation], vec![0.3]);
        let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
            &mut system,
            0,
            2,
            vec![0.0],
            vec![1.0],
            normalized_mesh,
        )
        .expect("nonuniform problem");
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
            problem.residual(&plus, &mut plus_residual).expect("plus");
            problem
                .residual(&minus, &mut minus_residual)
                .expect("minus");
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
    fn nonuniform_palc_metric_integrates_a_constant_profile_to_one() {
        let normalized_mesh = vec![0.0, 0.05, 0.2, 0.7, 1.0];
        let mut system = constant_flow_system();
        let problem = PeriodicOrbitCollocationProblem::new_on_mesh(
            &mut system,
            0,
            3,
            vec![0.0],
            vec![1.0],
            normalized_mesh,
        )
        .expect("nonuniform problem");
        let aug = DVector::zeros(problem.dimension() + 1);
        let weights = problem.palc_metric_weights(&aug).expect("metric");
        let mut profile = DVector::zeros(problem.dimension() + 1);
        for interval in 0..problem.mesh_points {
            profile[1 + interval] = 1.0;
        }
        for stage_index in 0..problem.stage_count() {
            profile[problem.stage_offset() + stage_index] = 1.0;
        }
        let norm = profile.dot(&weights.component_mul(&profile)).sqrt();
        assert!((norm - 1.0).abs() < 1e-12, "constant-profile norm={norm}");
    }

    #[test]
    fn defect_weighted_mesh_concentrates_intervals_at_the_hot_spot() {
        let source_mesh = uniform_normalized_mesh(6);
        let indicators = vec![1e-4, 1e-4, 2e-1, 4e-1, 1e-4, 1e-4];
        let redistributed = defect_weighted_normalized_mesh(&source_mesh, &indicators, 3, 6)
            .expect("redistributed mesh");
        assert_eq!(redistributed.len(), source_mesh.len());
        assert_eq!(redistributed[0], 0.0);
        assert_eq!(redistributed[6], 1.0);
        let widths = redistributed
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .collect::<Vec<_>>();
        assert!(
            widths.iter().copied().fold(f64::INFINITY, f64::min)
                < 0.6 * widths.iter().copied().fold(0.0_f64, f64::max)
        );
        assert!(redistributed.windows(2).all(|pair| pair[1] > pair[0]));
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
    fn collocation_defect_estimate_identifies_the_hot_interval() {
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
            PeriodicOrbitCollocationProblem::new(&mut system, 0, 3, 1, vec![1.0], vec![1.0])
                .expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        for interval in 0..3 {
            aug[1 + interval] = 1.0;
            aug[problem.stage_offset() + interval] = 1.0;
        }
        aug[problem.stage_offset() + 1] = 12.0;
        aug[problem.period_index()] = 3.0;

        let estimate = problem
            .scaled_collocation_defect_estimate(&aug)
            .expect("defect estimate");
        assert_eq!(estimate.interval_scaled_defects.len(), 3);
        assert_eq!(
            estimate
                .interval_scaled_defects
                .iter()
                .enumerate()
                .max_by(|(_, left), (_, right)| left.total_cmp(right))
                .map(|(index, _)| index),
            Some(1)
        );
        assert_eq!(
            estimate.max_scaled_defect,
            estimate.interval_scaled_defects[1]
        );
    }

    #[test]
    fn refinement_target_is_deterministic_and_uses_local_defects() {
        let localized = propose_uniform_mesh_refinement(
            &[1.0e-3, 2.0e-1, 1.0e-3, 1.0e-3],
            3,
            MAX_SCALED_COLLOCATION_DEFECT,
            32,
        )
        .expect("localized refinement");
        let uniform =
            propose_uniform_mesh_refinement(&[2.0e-1; 4], 3, MAX_SCALED_COLLOCATION_DEFECT, 32)
                .expect("uniform refinement");
        assert!(localized > 4);
        assert!(uniform > localized);
        assert_eq!(
            localized,
            propose_uniform_mesh_refinement(
                &[1.0e-3, 2.0e-1, 1.0e-3, 1.0e-3],
                3,
                MAX_SCALED_COLLOCATION_DEFECT,
                32,
            )
            .expect("repeat refinement")
        );
    }

    #[test]
    fn rejected_trial_redistributes_and_transfers_the_accepted_frontier() {
        use crate::continuation::problem::StepRejectionAction;

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
        let adaptivity = CollocationAdaptivitySettings {
            max_refinements: 2,
            max_mesh_points: 16,
            ..CollocationAdaptivitySettings::default()
        };
        let mut problem = PeriodicOrbitCollocationProblem::new_with_adaptivity(
            &mut system,
            0,
            2,
            1,
            vec![1.0],
            vec![1.0],
            adaptivity,
        )
        .expect("problem");
        let mut accepted = DVector::zeros(problem.dimension() + 1);
        accepted[0] = 0.25;
        accepted[1] = 1.0;
        accepted[2] = 1.0;
        accepted[problem.stage_offset()] = 1.0;
        accepted[problem.stage_offset() + 1] = 1.0;
        accepted[problem.period_index()] = 5.0;
        let accepted_state = accepted.as_slice()[1..].to_vec();
        let mut rejected = accepted.clone();
        rejected[1] = 1.0;
        rejected[2] = 2.0;
        rejected[problem.stage_offset()] = 8.0;
        rejected[problem.stage_offset() + 1] = 0.25;
        let mut tangent = DVector::zeros(problem.dimension() + 1);
        tangent[0] = 1.0;

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[accepted_state])
            .expect("adaptive rejection handler");
        let StepRejectionAction::Refined {
            accepted_aug,
            accepted_tangent,
            branch_states,
            branch_type,
        } = action
        else {
            panic!("under-resolved trial should trigger refinement");
        };
        let report = problem.adaptation_report();
        assert_eq!(report.attempts.len(), 1);
        assert_eq!(report.attempts[0].old_mesh_points, 2);
        assert_eq!(
            report.attempts[0].kind,
            CollocationMeshAdaptationKind::Redistribution
        );
        assert_eq!(report.attempts[0].new_mesh_points, 2);
        assert!(meshes_materially_different(
            &report.attempts[0].old_normalized_mesh,
            &report.attempts[0].new_normalized_mesh
        ));
        assert_eq!(
            report.current_mesh_points,
            report.attempts[0].new_mesh_points
        );
        assert!(report.termination.is_none());
        assert_eq!(accepted_aug.len(), problem.dimension() + 1);
        assert_eq!(accepted_tangent.len(), problem.dimension() + 1);
        assert_eq!(branch_states, vec![accepted_aug.as_slice()[1..].to_vec()]);
        assert_eq!(
            branch_type,
            Some(BranchType::LimitCycle {
                ntst: report.current_mesh_points,
                ncol: 1,
                normalized_mesh: report.current_normalized_mesh.clone(),
            })
        );
        assert_eq!(accepted_aug[0], 0.25);
        assert_eq!(accepted_aug[problem.period_index()], 5.0);
        assert!(accepted_aug.as_slice()[1..problem.period_index()]
            .iter()
            .all(|value| (*value - 1.0).abs() < 1e-12));
    }

    #[test]
    fn restarted_extension_transfers_only_attempts_appended_after_seed_report() {
        use crate::continuation::problem::StepRejectionAction;

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
        let previous_mesh = vec![0.0, 0.5, 1.0];
        let current_mesh = vec![0.0, 0.2, 1.0];
        let adaptivity = CollocationAdaptivitySettings {
            enabled: true,
            redistribution_enabled: false,
            defect_tolerance: 1.0e-12,
            max_refinements: 3,
            max_mesh_points: 8,
        };
        let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh_with_adaptivity(
            &mut system,
            0,
            1,
            vec![1.0],
            vec![1.0],
            current_mesh.clone(),
            adaptivity,
        )
        .expect("restarted periodic problem");
        problem
            .seed_adaptation_report(CollocationAdaptationReport {
                initial_mesh_points: 2,
                current_mesh_points: 2,
                degree: 1,
                defect_tolerance: 0.5,
                refinement_budget: 99,
                max_mesh_points: 128,
                initial_normalized_mesh: previous_mesh.clone(),
                current_normalized_mesh: current_mesh.clone(),
                attempts: (1..=3)
                    .map(|sequence| CollocationRefinementAttempt {
                        sequence,
                        kind: CollocationMeshAdaptationKind::Redistribution,
                        old_mesh_points: 2,
                        new_mesh_points: 2,
                        degree: 1,
                        trigger_defect: 0.25,
                        tolerance: 0.5,
                        interval_scaled_defects: vec![0.25, 0.1],
                        old_normalized_mesh: previous_mesh.clone(),
                        new_normalized_mesh: current_mesh.clone(),
                    })
                    .collect(),
                termination: Some(CollocationDefectTermination {
                    reason: CollocationDefectTerminationReason::RefinementBudgetExhausted,
                    measured_defect: 0.5,
                    tolerance: 0.5,
                    mesh_points: 2,
                    degree: 1,
                    refinements_attempted: 3,
                    refinement_budget: 99,
                    max_mesh_points: 128,
                    normalized_mesh: current_mesh.clone(),
                }),
            })
            .expect("seed historical adaptation report");
        assert_eq!(problem.adaptation_report().defect_tolerance, 1.0e-12);
        assert_eq!(problem.adaptation_report().refinement_budget, 3);
        assert_eq!(problem.adaptation_report().max_mesh_points, 8);
        assert!(problem.adaptation_report().termination.is_none());

        let mut accepted = DVector::zeros(problem.dimension() + 1);
        accepted[0] = 0.1;
        accepted[1] = 1.0;
        accepted[2] = 3.0;
        accepted[problem.stage_offset()] = 1.5;
        accepted[problem.stage_offset() + 1] = -0.75;
        accepted[problem.period_index()] = 4.0;
        let persisted_before_extension = accepted.as_slice()[1..].to_vec();
        let mut rejected = accepted.clone();
        rejected[1] = 1.0;
        rejected[2] = 12.0;
        rejected[problem.stage_offset()] = -9.0;
        rejected[problem.stage_offset() + 1] = 7.0;
        let mut tangent = DVector::zeros(problem.dimension() + 1);
        tangent[0] = 1.0;

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[])
            .expect("new adaptive retry");
        assert!(matches!(action, StepRejectionAction::Refined { .. }));
        assert_eq!(problem.adaptation_report().attempts.len(), 4);
        let new_attempt = problem
            .adaptation_report()
            .attempts
            .last()
            .expect("new attempt");
        let expected = transfer_collocation_state(
            &persisted_before_extension,
            &current_mesh,
            &new_attempt.new_normalized_mesh,
            1,
            1,
            &problem.coeffs.nodes,
        )
        .expect("single current-to-final transfer");
        let transferred = problem
            .transfer_branch_states_to_current_discretization(&[persisted_before_extension])
            .expect("extension history transfer");

        assert_eq!(transferred.len(), 1);
        assert_eq!(transferred[0].len(), expected.len());
        for (actual, expected) in transferred[0].iter().zip(expected) {
            assert!((actual - expected).abs() < 1.0e-12);
        }
    }

    #[test]
    fn exhausted_refinement_budget_returns_structured_termination() {
        use crate::continuation::problem::StepRejectionAction;

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
        let adaptivity = CollocationAdaptivitySettings {
            max_refinements: 0,
            max_mesh_points: 8,
            ..CollocationAdaptivitySettings::default()
        };
        let mut problem = PeriodicOrbitCollocationProblem::new_with_adaptivity(
            &mut system,
            0,
            2,
            1,
            vec![1.0],
            vec![1.0],
            adaptivity,
        )
        .expect("problem");
        let mut accepted = DVector::zeros(problem.dimension() + 1);
        accepted[problem.period_index()] = 5.0;
        let mut rejected = accepted.clone();
        rejected[1] = 1.0;
        rejected[2] = 2.0;
        rejected[problem.stage_offset()] = 8.0;
        rejected[problem.stage_offset() + 1] = 0.25;
        let tangent = DVector::from_element(problem.dimension() + 1, 1.0);

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[])
            .expect("adaptive rejection handler");
        assert!(matches!(action, StepRejectionAction::Terminate));
        let termination = problem
            .adaptation_report()
            .termination
            .as_ref()
            .expect("structured termination");
        assert_eq!(
            termination.reason,
            CollocationDefectTerminationReason::RefinementBudgetExhausted
        );
        assert!(termination.measured_defect > termination.tolerance);
        assert_eq!(termination.mesh_points, 2);
        assert_eq!(termination.degree, 1);
        assert_eq!(termination.refinements_attempted, 0);
        assert_eq!(termination.refinement_budget, 0);
    }

    #[test]
    fn coarse_analytic_cycle_is_corrected_refined_and_revalidated() {
        let mesh_points = 4;
        let degree = 2;
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
            normalized_mesh: uniform_normalized_mesh(mesh_points),
        };
        let adaptivity = CollocationAdaptivitySettings {
            max_refinements: 4,
            max_mesh_points: 64,
            ..CollocationAdaptivitySettings::default()
        };
        let mut system = stuart_landau_system();
        let (corrected, flat_state, report) =
            correct_limit_cycle_setup_adaptive(&mut system, 0, setup, 1e-10, 14, adaptivity)
                .expect("adaptive fixed-parameter correction");

        assert!(!report.attempts.is_empty(), "coarse mesh should refine");
        assert!(corrected.mesh_points > mesh_points);
        assert_eq!(report.current_mesh_points, corrected.mesh_points);
        assert!(report.termination.is_none());
        let mut problem = corrected
            .to_problem(&mut system, 0)
            .expect("refined problem");
        let mut aug = DVector::zeros(flat_state.len() + 1);
        aug[0] = corrected.guess.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&flat_state);
        let defect = problem
            .scaled_collocation_defect(&aug)
            .expect("refined defect");
        assert!(
            defect <= adaptivity.defect_tolerance,
            "refined defect {defect:.3e} exceeds {:.3e}",
            adaptivity.defect_tolerance
        );
        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(&aug, &mut residual).expect("residual");
        assert!(
            residual.norm() / (residual.len() as f64).sqrt() <= 1e-10,
            "refined algebraic residual={:.3e}",
            residual.norm() / (residual.len() as f64).sqrt()
        );
    }

    #[test]
    fn analytic_slow_fast_cycle_refines_from_a_coarse_temporal_mesh() {
        // The unit circle is invariant while theta' = a + b cos(theta), with
        // a=(1+eps)/2 and b=(1-eps)/2.  Small eps creates a long slow passage
        // near (-1, 0) and a sharp transition elsewhere, but the exact period
        // and normalized-time profile remain available analytically.
        let epsilon: f64 = 0.02;
        let a = 0.5 * (1.0 + epsilon);
        let b = 0.5 * (1.0 - epsilon);
        let x_equation = Bytecode {
            ops: vec![
                OpCode::LoadConst(1.0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadConst(a),
                OpCode::LoadConst(b),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Sub,
            ],
        };
        let y_equation = Bytecode {
            ops: vec![
                OpCode::LoadConst(1.0),
                OpCode::LoadVar(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::Add,
                OpCode::Sub,
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::LoadConst(a),
                OpCode::LoadConst(b),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::Add,
            ],
        };
        let mut system = EquationSystem::new(vec![x_equation, y_equation], vec![0.0]);
        let period = 2.0 * PI / epsilon.sqrt();
        let profile = |normalized_time: f64| {
            let half_phase = PI * normalized_time;
            let theta = 2.0 * ((half_phase.sin() / epsilon.sqrt()).atan2(half_phase.cos()));
            vec![theta.cos(), theta.sin()]
        };
        let mesh_points = 6;
        let degree = 3;
        let coeffs = CollocationCoefficients::new(degree).expect("coefficients");
        let mesh_states = (0..mesh_points)
            .map(|interval| profile(interval as f64 / mesh_points as f64))
            .collect::<Vec<_>>();
        let stage_states = (0..mesh_points)
            .map(|interval| {
                coeffs
                    .nodes
                    .iter()
                    .map(|node| profile((interval as f64 + node) / mesh_points as f64))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
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
            normalized_mesh: uniform_normalized_mesh(mesh_points),
        };
        let (uniform_setup, uniform_flat) =
            prepare_limit_cycle_setup(setup.clone(), 2).expect("uniform analytic setup");
        let mut uniform_problem = uniform_setup
            .to_problem(&mut system, 0)
            .expect("uniform analytic problem");
        let mut uniform_aug = DVector::zeros(uniform_flat.len() + 1);
        uniform_aug[0] = uniform_setup.guess.param_value;
        uniform_aug.as_mut_slice()[1..].copy_from_slice(&uniform_flat);
        let uniform_estimate = uniform_problem
            .scaled_collocation_defect_estimate(&uniform_aug)
            .expect("uniform analytic defect");
        drop(uniform_problem);

        let redistributed_mesh = defect_weighted_normalized_mesh(
            &uniform_setup.normalized_mesh,
            &uniform_estimate.interval_scaled_defects,
            degree,
            mesh_points,
        )
        .expect("redistributed analytic mesh");
        let redistributed_widths = redistributed_mesh
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .collect::<Vec<_>>();
        let minimum_width = redistributed_widths
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let maximum_width = redistributed_widths.iter().copied().fold(0.0_f64, f64::max);
        assert!(minimum_width < 0.75 * maximum_width);

        let redistributed_mesh_states = redistributed_mesh[..mesh_points]
            .iter()
            .map(|time| profile(*time))
            .collect::<Vec<_>>();
        let redistributed_stage_states = (0..mesh_points)
            .map(|interval| {
                let left = redistributed_mesh[interval];
                let width = redistributed_mesh[interval + 1] - left;
                coeffs
                    .nodes
                    .iter()
                    .map(|node| profile(left + width * node))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let redistributed_setup = LimitCycleSetup {
            guess: LimitCycleGuess {
                param_value: 0.0,
                period,
                mesh_states: redistributed_mesh_states,
                stage_states: redistributed_stage_states,
                requires_fixed_parameter_correction: false,
            },
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            mesh_points,
            collocation_degree: degree,
            normalized_mesh: redistributed_mesh,
        };
        let (redistributed_setup, redistributed_flat) =
            prepare_limit_cycle_setup(redistributed_setup, 2).expect("redistributed setup");
        let mut redistributed_problem = redistributed_setup
            .to_problem(&mut system, 0)
            .expect("redistributed analytic problem");
        let mut redistributed_aug = DVector::zeros(redistributed_flat.len() + 1);
        redistributed_aug[0] = redistributed_setup.guess.param_value;
        redistributed_aug.as_mut_slice()[1..].copy_from_slice(&redistributed_flat);
        let redistributed_defect = redistributed_problem
            .scaled_collocation_defect(&redistributed_aug)
            .expect("redistributed analytic defect");
        assert!(
            redistributed_defect < uniform_estimate.max_scaled_defect,
            "same-size redistributed defect {redistributed_defect:.3e} did not improve uniform defect {:.3e}",
            uniform_estimate.max_scaled_defect
        );
        drop(redistributed_problem);

        let adaptivity = CollocationAdaptivitySettings {
            max_refinements: 3,
            max_mesh_points: 96,
            ..CollocationAdaptivitySettings::default()
        };
        let (corrected, flat_state, report) =
            correct_limit_cycle_setup_adaptive(&mut system, 0, setup, 1e-9, 18, adaptivity)
                .expect("slow-fast cycle refinement");
        assert!(!report.attempts.is_empty());
        assert_eq!(
            report.attempts[0].kind,
            CollocationMeshAdaptationKind::Redistribution
        );
        assert_eq!(
            report.attempts[0].old_mesh_points,
            report.attempts[0].new_mesh_points
        );
        assert!(corrected.mesh_points > mesh_points);
        let relative_period_error = (corrected.guess.period - period).abs() / period;
        assert!(
            relative_period_error < 2e-2,
            "relative period error={relative_period_error:.3e}"
        );
        let maximum_radius_error = corrected
            .guess
            .mesh_states
            .iter()
            .map(|state| (state[0].hypot(state[1]) - 1.0).abs())
            .fold(0.0_f64, f64::max);
        assert!(
            maximum_radius_error < 1e-2,
            "radius error={maximum_radius_error:.3e}"
        );
        let mut problem = corrected.to_problem(&mut system, 0).expect("problem");
        let mut aug = DVector::zeros(flat_state.len() + 1);
        aug[0] = corrected.guess.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&flat_state);
        let estimate = problem
            .scaled_collocation_defect_estimate(&aug)
            .expect("defect estimate");
        assert!(estimate.max_scaled_defect <= adaptivity.defect_tolerance);
        assert!(
            report.attempts[0]
                .interval_scaled_defects
                .iter()
                .copied()
                .fold(0.0_f64, f64::max)
                > adaptivity.defect_tolerance
        );
    }

    #[test]
    fn underresolved_continuation_trial_refines_without_consuming_the_step() {
        let mesh_points = 4;
        let degree = 2;
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
                param_value: 1.0,
                period,
                mesh_states,
                stage_states,
                requires_fixed_parameter_correction: true,
            },
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            mesh_points,
            collocation_degree: degree,
            normalized_mesh: uniform_normalized_mesh(mesh_points),
        };
        let mut system = parameterized_stuart_landau_system(1.0);
        let (mut coarse, _) =
            correct_limit_cycle_setup_impl(&mut system, 0, setup, 1e-10, 14, false, None)
                .expect("algebraic coarse correction");
        coarse.guess.requires_fixed_parameter_correction = false;
        let coarse_guess = coarse.guess.clone();
        let config = coarse.collocation_config();
        let settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-5,
            max_step_size: 0.01,
            max_steps: 1,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        };
        let adaptivity = CollocationAdaptivitySettings {
            max_refinements: 4,
            max_mesh_points: 64,
            ..CollocationAdaptivitySettings::default()
        };
        let result = continue_limit_cycle_collocation_with_report(
            &mut system,
            0,
            config.clone(),
            coarse_guess.clone(),
            settings,
            true,
            adaptivity,
        )
        .expect("adaptive continuation");

        assert_eq!(result.branch.points.len(), 2);
        assert!(!result.collocation_adaptation.attempts.is_empty());
        assert!(result.collocation_adaptation.termination.is_none());
        let final_ntst = result.collocation_adaptation.current_mesh_points;
        assert!(final_ntst > mesh_points);
        assert_eq!(
            result.branch.branch_type,
            BranchType::LimitCycle {
                ntst: final_ntst,
                ncol: degree,
                normalized_mesh: result
                    .collocation_adaptation
                    .current_normalized_mesh
                    .clone(),
            }
        );
        let expected_state_len = final_ntst * (degree + 1) * 2 + 1;
        assert!(result
            .branch
            .points
            .iter()
            .all(|point| point.state.len() == expected_state_len));
        let final_point = result.branch.points.last().expect("accepted point");
        let mut problem = PeriodicOrbitCollocationProblem::new_on_mesh(
            &mut system,
            0,
            degree,
            vec![1.0, 0.0],
            vec![0.0, 1.0],
            result
                .collocation_adaptation
                .current_normalized_mesh
                .clone(),
        )
        .expect("final problem");
        let mut aug = DVector::zeros(final_point.state.len() + 1);
        aug[0] = final_point.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&final_point.state);
        let defect = problem
            .scaled_collocation_defect(&aug)
            .expect("final defect");
        assert!(defect <= adaptivity.defect_tolerance);

        drop(problem);
        let mut capped_system = parameterized_stuart_landau_system(1.0);
        let capped = continue_limit_cycle_collocation_with_report(
            &mut capped_system,
            0,
            config,
            coarse_guess,
            settings,
            true,
            CollocationAdaptivitySettings {
                max_refinements: 0,
                max_mesh_points: 64,
                ..CollocationAdaptivitySettings::default()
            },
        )
        .expect("structured partial result");
        assert_eq!(capped.branch.points.len(), 1);
        let termination = capped
            .collocation_adaptation
            .termination
            .expect("defect termination");
        assert_eq!(
            termination.reason,
            CollocationDefectTerminationReason::RefinementBudgetExhausted
        );
        assert!(termination.measured_defect > termination.tolerance);
    }

    #[test]
    fn adaptive_extension_transfers_the_preexisting_branch_before_merge() {
        let mesh_points = 4;
        let degree = 2;
        let period = 2.0 * PI;
        let coeffs = CollocationCoefficients::new(degree).expect("coefficients");
        let mut system = parameterized_stuart_landau_system(1.0);
        let corrected_point = |system: &mut EquationSystem, parameter: f64| {
            let radius = parameter.sqrt();
            let mesh_states = (0..mesh_points)
                .map(|index| {
                    let theta = period * index as f64 / mesh_points as f64;
                    vec![radius * theta.cos(), radius * theta.sin()]
                })
                .collect::<Vec<_>>();
            let stage_states = (0..mesh_points)
                .map(|interval| {
                    coeffs
                        .nodes
                        .iter()
                        .map(|node| {
                            let theta = period * (interval as f64 + node) / mesh_points as f64;
                            vec![radius * theta.cos(), radius * theta.sin()]
                        })
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>();
            let setup = LimitCycleSetup {
                guess: LimitCycleGuess {
                    param_value: parameter,
                    period,
                    mesh_states,
                    stage_states,
                    requires_fixed_parameter_correction: true,
                },
                phase_anchor: vec![radius, 0.0],
                phase_direction: vec![0.0, 1.0],
                mesh_points,
                collocation_degree: degree,
                normalized_mesh: uniform_normalized_mesh(mesh_points),
            };
            let (_, state) =
                correct_limit_cycle_setup_impl(system, 0, setup, 1e-10, 14, false, None)
                    .expect("coarse algebraic point");
            ContinuationPoint {
                state,
                param_value: parameter,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: Some(vec![vec![-999.0; 2]]),
                homoclinic_events: None,
            }
        };
        let branch = ContinuationBranch {
            points: vec![
                corrected_point(&mut system, 1.0),
                corrected_point(&mut system, 1.01),
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::LimitCycle {
                ntst: mesh_points,
                ncol: degree,
                normalized_mesh: uniform_normalized_mesh(mesh_points),
            },
            upoldp: Some(vec![vec![0.0, 1.0]]),
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        let config = CollocationConfig {
            mesh_points,
            degree,
            phase_anchor: vec![1.0, 0.0],
            phase_direction: vec![0.0, 1.0],
            normalized_mesh: uniform_normalized_mesh(mesh_points),
        };
        let settings = ContinuationSettings {
            step_size: 0.005,
            min_step_size: 1e-5,
            max_step_size: 0.005,
            max_steps: 1,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        };
        let result = extend_limit_cycle_collocation_with_report(
            &mut system,
            0,
            config,
            branch,
            settings,
            true,
            CollocationAdaptivitySettings {
                max_refinements: 3,
                max_mesh_points: 64,
                ..CollocationAdaptivitySettings::default()
            },
        )
        .expect("adaptive extension");
        assert_eq!(result.branch.points.len(), 3);
        assert!(!result.collocation_adaptation.attempts.is_empty());
        let final_ntst = result.collocation_adaptation.current_mesh_points;
        let expected_state_len = final_ntst * (degree + 1) * 2 + 1;
        assert!(result
            .branch
            .points
            .iter()
            .all(|point| point.state.len() == expected_state_len));
        assert!(
            result
                .branch
                .points
                .iter()
                .all(|point| point.cycle_points.is_none()),
            "mesh transfer must discard legacy cycle geometry tied to the old layout"
        );
        assert_eq!(
            result.branch.branch_type,
            BranchType::LimitCycle {
                ntst: final_ntst,
                ncol: degree,
                normalized_mesh: result
                    .collocation_adaptation
                    .current_normalized_mesh
                    .clone(),
            }
        );

        let serialized = serde_json::to_string(&result.branch).expect("serialize adapted branch");
        let reloaded: ContinuationBranch =
            serde_json::from_str(&serialized).expect("reload adapted branch");
        let (reloaded_ntst, reloaded_ncol, reloaded_mesh) = match &reloaded.branch_type {
            BranchType::LimitCycle {
                ntst,
                ncol,
                normalized_mesh,
            } => (*ntst, *ncol, normalized_mesh.clone()),
            other => panic!("expected reloaded limit-cycle branch, got {other:?}"),
        };
        assert!(!meshes_materially_different(
            &reloaded_mesh,
            &result.collocation_adaptation.current_normalized_mesh
        ));
        let reloaded_point_count = reloaded.points.len();
        let reload_anchor = reloaded.points.last().expect("reloaded endpoint").state[..2].to_vec();
        let resumed = extend_limit_cycle_collocation_with_report(
            &mut system,
            0,
            CollocationConfig {
                mesh_points: reloaded_ntst,
                degree: reloaded_ncol,
                phase_anchor: reload_anchor,
                phase_direction: vec![0.0, 1.0],
                normalized_mesh: reloaded_mesh.clone(),
            },
            reloaded,
            settings,
            true,
            CollocationAdaptivitySettings {
                max_refinements: 3,
                max_mesh_points: 64,
                ..CollocationAdaptivitySettings::default()
            },
        )
        .expect("extend reloaded adapted branch");
        assert!(resumed.branch.points.len() > reloaded_point_count);
        let resumed_mesh = match &resumed.branch.branch_type {
            BranchType::LimitCycle {
                normalized_mesh, ..
            } => normalized_mesh,
            _ => panic!("expected resumed limit-cycle branch"),
        };
        assert!(!meshes_materially_different(
            resumed_mesh,
            &resumed.collocation_adaptation.current_normalized_mesh
        ));
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
            normalized_mesh: uniform_normalized_mesh(mesh_points),
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
    fn public_fixed_parameter_correction_preserves_a_nonuniform_mesh() {
        let mesh_points = 20;
        let degree = 4;
        let period = 2.0 * PI;
        let normalized_mesh = (0..=mesh_points)
            .map(|index| (index as f64 / mesh_points as f64).powf(1.35))
            .collect::<Vec<_>>();
        let coeffs = CollocationCoefficients::new(degree).expect("coefficients");
        let mesh_states = normalized_mesh[..mesh_points]
            .iter()
            .map(|time| {
                let theta = period * time;
                vec![theta.cos(), theta.sin()]
            })
            .collect::<Vec<_>>();
        let stage_states = (0..mesh_points)
            .map(|interval| {
                let left = normalized_mesh[interval];
                let width = normalized_mesh[interval + 1] - left;
                coeffs
                    .nodes
                    .iter()
                    .map(|node| {
                        let theta = period * (left + width * node);
                        vec![theta.cos(), theta.sin()]
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
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
            normalized_mesh: normalized_mesh.clone(),
        };
        let mut system = stuart_landau_system();
        let (corrected, flat_state) = correct_limit_cycle_setup(&mut system, 0, setup, 1e-10, 12)
            .expect("nonuniform fixed-parameter correction");
        assert_eq!(corrected.normalized_mesh, normalized_mesh);
        let mut problem = corrected
            .to_problem(&mut system, 0)
            .expect("corrected problem");
        let mut aug = DVector::zeros(flat_state.len() + 1);
        aug[0] = corrected.guess.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&flat_state);
        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut residual)
            .expect("corrected residual");
        assert!(residual.norm() / (residual.len() as f64).sqrt() <= 1e-10);
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
            normalized_mesh: uniform_normalized_mesh(4),
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
            normalized_mesh: uniform_normalized_mesh(4),
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
    fn auto_floquet_backend_switches_by_block_dimension() {
        let small = vec![DMatrix::identity(2, 2); 8];
        let small_result = floquet_computation(&small, FloquetBackend::Auto, false)
            .expect("small automatic Floquet spectrum");
        assert_eq!(small_result.backend, FloquetBackend::BlockCyclic);

        let large = vec![DMatrix::identity(2, 2); 49];
        let large_result = floquet_computation(&large, FloquetBackend::Auto, false)
            .expect("large automatic Floquet spectrum");
        assert_eq!(large_result.backend, FloquetBackend::PeriodicSchur);
        assert_eq!(large_result.multipliers.len(), 2);
    }

    #[test]
    fn auto_periodic_schur_returns_zero_mode_beyond_dense_fallback_limit() {
        let interval_count = 1100usize;
        let mut transfers = vec![DMatrix::identity(2, 2); interval_count];
        transfers[517][(0, 0)] = 0.0;

        let result = floquet_computation(&transfers, FloquetBackend::Auto, true)
            .expect("automatic large singular Floquet modes");
        assert_eq!(result.backend, FloquetBackend::PeriodicSchur);
        let zero_index = result
            .multipliers
            .iter()
            .position(|value| value.norm() == 0.0)
            .expect("zero multiplier");
        assert!((result.mesh_vectors[0][zero_index][0].norm() - 1.0).abs() < 1e-12);
        assert!(result.mesh_vectors[518][zero_index]
            .iter()
            .all(|value| value.norm() < 1e-12));
        assert!(result.mesh_vectors[interval_count - 1][zero_index]
            .iter()
            .all(|value| value.norm() < 1e-12));
    }

    #[test]
    fn periodic_schur_and_block_cyclic_match_on_nonuniform_cocycle() {
        let interval_count = 23usize;
        let mut expected_logs = [0.0f64, 0.0f64];
        let mut transfers = Vec::with_capacity(interval_count);
        for interval in 0..interval_count {
            let fraction = interval as f64 / interval_count as f64;
            let next_fraction = (interval + 1) as f64 / interval_count as f64;
            let first_log = 0.12 * (1.0 + 0.35 * (2.0 * PI * fraction).sin());
            let second_log = -0.09 * (1.0 + 0.25 * (4.0 * PI * fraction).cos());
            expected_logs[0] += first_log;
            expected_logs[1] += second_log;
            let local =
                DMatrix::from_diagonal(&DVector::from_vec(vec![first_log.exp(), second_log.exp()]));
            transfers.push(
                rotation_matrix(1.3 * (2.0 * PI * next_fraction).sin())
                    * local
                    * rotation_matrix(1.3 * (2.0 * PI * fraction).sin()).transpose(),
            );
        }

        let reference = floquet_computation(&transfers, FloquetBackend::BlockCyclic, false)
            .expect("block-cyclic nonuniform spectrum");
        let schur = floquet_computation(&transfers, FloquetBackend::PeriodicSchur, true)
            .expect("periodic-Schur nonuniform spectrum and modes");
        assert_eq!(reference.multipliers.len(), 2);
        assert_eq!(schur.multipliers.len(), 2);
        let mut reference_logs = reference
            .multipliers
            .iter()
            .map(|value| value.norm().ln())
            .collect::<Vec<_>>();
        let mut schur_logs = schur
            .multipliers
            .iter()
            .map(|value| value.norm().ln())
            .collect::<Vec<_>>();
        reference_logs.sort_by(f64::total_cmp);
        schur_logs.sort_by(f64::total_cmp);
        expected_logs.sort_by(f64::total_cmp);
        for index in 0..2 {
            assert!((reference_logs[index] - schur_logs[index]).abs() < 2e-9);
            assert!((schur_logs[index] - expected_logs[index]).abs() < 2e-9);
        }

        for interval in 0..interval_count {
            for mode_index in 0..2 {
                let current = DVector::from_vec(schur.mesh_vectors[interval][mode_index].clone());
                let transported =
                    transfers[interval].map(|value| Complex::new(value, 0.0)) * current;
                let expected = if interval + 1 < interval_count {
                    schur.mesh_vectors[interval + 1][mode_index].clone()
                } else {
                    schur.mesh_vectors[0][mode_index]
                        .iter()
                        .map(|value| *value * schur.multipliers[mode_index])
                        .collect()
                };
                let residual = transported
                    .iter()
                    .zip(&expected)
                    .map(|(actual, expected)| (*actual - *expected).norm_sqr())
                    .sum::<f64>()
                    .sqrt();
                let scale = transported
                    .iter()
                    .chain(&expected)
                    .map(|value| value.norm_sqr())
                    .sum::<f64>()
                    .sqrt()
                    .max(f64::MIN_POSITIVE);
                assert!(
                    residual / scale < 2e-9,
                    "relative cocycle residual={}",
                    residual / scale
                );
            }
        }
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
            normalized_mesh: uniform_normalized_mesh(ntst),
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
            normalized_mesh: uniform_normalized_mesh(ntst),
        };
        let mut system = stuart_landau_system();
        let (_corrected, cycle_state) = correct_limit_cycle_setup(&mut system, 0, setup, 1e-11, 12)
            .expect("corrected Stuart-Landau cycle");
        let modes = compute_limit_cycle_floquet_modes_with_backend(
            &mut system,
            0,
            &cycle_state,
            ntst,
            ncol,
            FloquetBackend::PeriodicSchur,
        )
        .expect("Stuart-Landau periodic-Schur Floquet modes");
        assert_eq!(modes.backend, FloquetBackend::PeriodicSchur);
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
    fn ns_test_does_not_cross_at_a_stable_real_to_complex_transition() {
        // A real pair may collide and leave the real axis while remaining
        // strictly inside the unit disk.  That spectral-type transition is
        // not a Neimark-Sacker bifurcation, so the NS test must keep its sign.
        let (_, _, real_pair_test, _) = cycle_tests_from_multipliers(&[
            Complex::new(1.0, 0.0),
            Complex::new(0.4, 0.0),
            Complex::new(0.6, 0.0),
        ]);
        let complex_pair = Complex::from_polar(0.5, 0.2);
        let (_, _, complex_pair_test, _) = cycle_tests_from_multipliers(&[
            Complex::new(1.0, 0.0),
            complex_pair,
            complex_pair.conj(),
        ]);

        assert!(
            real_pair_test * complex_pair_test > 0.0,
            "stable real and complex pairs must stay on the same side of the NS condition: {real_pair_test}, {complex_pair_test}"
        );
    }

    #[test]
    fn ns_test_remains_finite_for_a_stiff_floquet_spectrum() {
        let inside_pair = Complex::from_polar(0.99, 0.4);
        let outside_pair = Complex::from_polar(1.01, 0.4);
        let spectrum = |pair: Complex<f64>| {
            vec![
                Complex::new(1.0, 0.0),
                pair,
                pair.conj(),
                Complex::new(1.0e200, 0.0),
                Complex::new(2.0e-200, 0.0),
            ]
        };

        let (_, _, inside_test, _) = cycle_tests_from_multipliers(&spectrum(inside_pair));
        let (_, _, outside_test, _) = cycle_tests_from_multipliers(&spectrum(outside_pair));
        assert!(inside_test.is_finite(), "inside test={inside_test}");
        assert!(outside_test.is_finite(), "outside test={outside_test}");
        assert!(
            inside_test * outside_test < 0.0,
            "the critical complex pair must still change the NS sign: {inside_test}, {outside_test}"
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
            BranchType::LimitCycle { ntst, ncol, .. } => (ntst, ncol),
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
