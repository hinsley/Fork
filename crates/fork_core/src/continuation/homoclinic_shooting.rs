//! Standard single- and multiple-shooting formulation for homoclinic curves.
//!
//! The collocation formulation in [`super::homoclinic`] stores polynomial
//! stages.  Standard shooting instead stores the `M + 1` segment endpoints
//! and constrains every adjacent pair with the time-`2T/M` flow map.  Keeping
//! this as a separate continuation problem makes the packed-state contract
//! explicit and makes `M = 1` the genuine single-shooting special case.

use super::homoclinic_events::{
    build_homoclinic_orbit_flip_data, compute_homoclinic_event_diagnostics,
    HomoclinicEventDiagnostics, DEFAULT_FOCUS_TOLERANCE,
};
use super::homoclinic_init::{
    compute_homoclinic_basis, HomoclinicBasis, HomoclinicChartTransform, HomoclinicExtraFlags,
    HomoclinicFixedScalars, HomoclinicSetup, DEFAULT_PROJECTOR_REFRESH_INTERVAL,
};
use super::periodic::CollocationCoefficients;
use super::problem::{
    ContinuationProblem, PointDiagnostics, PostCorrectorReparameterization, ReparameterizationSeed,
    TestFunctionValues,
};
use super::{
    continue_with_problem, BifurcationType, BranchType, ContinuationBranch, ContinuationPoint,
    ContinuationSettings, HomoclinicBasisSnapshot, HomoclinicDiscretization,
    HomoclinicResumeContext,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::solvers::Tsit5;
use crate::traits::{DynamicalSystem, Steppable};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

const DEFAULT_STEPS_PER_SEGMENT: usize = 64;

fn default_steps_per_segment() -> usize {
    DEFAULT_STEPS_PER_SEGMENT
}

/// Integration controls for the standard-shooting flow maps.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct HomoclinicShootingSettings {
    /// Number of equal-duration shooting segments. `1` is single shooting.
    pub intervals: usize,
    /// Fixed Tsitouras-5 steps used for every segment flow map.
    pub integration_steps_per_segment: usize,
}

impl Default for HomoclinicShootingSettings {
    fn default() -> Self {
        Self {
            intervals: 8,
            integration_steps_per_segment: default_steps_per_segment(),
        }
    }
}

/// Initial state for a homoclinic standard-shooting problem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicShootingGuess {
    /// Shooting nodes including both truncated-orbit endpoints (`M + 1`).
    pub nodes: Vec<Vec<f64>>,
    pub x0: Vec<f64>,
    pub param1_value: f64,
    pub param2_value: f64,
    /// Half of the total truncated-orbit duration, matching Fork collocation.
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub yu: Vec<f64>,
    pub ys: Vec<f64>,
}

/// Complete standard-shooting setup.  It deliberately mirrors the model and
/// invariant-subspace metadata of `HomoclinicSetup` without pretending that a
/// shooting node is a collocation mesh/stage tuple.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicShootingSetup {
    pub guess: HomoclinicShootingGuess,
    /// Whether `guess` is a corrected homoclinic point and may participate in
    /// first-step special-point bracketing. Missing legacy fields default to
    /// the safe approximate-seed behavior.
    #[serde(default)]
    pub initial_seed_is_corrected: bool,
    pub shooting: HomoclinicShootingSettings,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_name: String,
    pub param2_name: String,
    pub base_params: Vec<f64>,
    pub extras: HomoclinicExtraFlags,
    pub basis: HomoclinicBasis,
    /// Accepted-step cadence for chart-safe projector refreshes. `0` disables
    /// refreshes; the serde default matches HBK's default cadence of 2.
    #[serde(default = "default_projector_refresh_interval")]
    pub projector_refresh_interval: usize,
}

fn default_projector_refresh_interval() -> usize {
    DEFAULT_PROJECTOR_REFRESH_INTERVAL
}

/// Continue a homoclinic connection with standard single/multiple shooting.
pub fn continue_homoclinic_shooting_curve(
    system: &mut EquationSystem,
    setup: HomoclinicShootingSetup,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let initial_state = pack_homoclinic_shooting_state(&setup);
    let initial_point = ContinuationPoint {
        state: initial_state,
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: Some(setup.guess.nodes.clone()),
        homoclinic_events: None,
    };
    let mut problem = HomoclinicShootingProblem::new(system, setup.clone())?;
    let mut branch = continue_with_problem(&mut problem, initial_point, settings, forward)?;
    // `ncol = 0` is the backwards-compatible wire discriminator for standard
    // shooting until the branch schema carries an explicit method tag.
    branch.branch_type = BranchType::HomoclinicCurve {
        ntst: setup.shooting.intervals,
        ncol: 0,
        discretization: HomoclinicDiscretization::Shooting {
            integration_steps_per_segment: setup.shooting.integration_steps_per_segment,
        },
        normalized_mesh: Vec::new(),
        collocation_adaptivity: Default::default(),
        collocation_adaptation: None,
        param1_name: setup.param1_name.clone(),
        param2_name: setup.param2_name.clone(),
        free_time: setup.extras.free_time,
        free_eps0: setup.extras.free_eps0,
        free_eps1: setup.extras.free_eps1,
    };
    branch.homoc_context = Some(problem.resume_context());
    Ok(branch)
}

/// Sample an existing homoclinic collocation setup onto equal-duration shooting
/// nodes.  This gives long-cycle and BT initializers a common, corrected seed
/// path for both numerical discretizations.
pub fn homoclinic_shooting_setup_from_collocation(
    source: &HomoclinicSetup,
    shooting: HomoclinicShootingSettings,
) -> Result<HomoclinicShootingSetup> {
    if shooting.intervals == 0 || shooting.integration_steps_per_segment == 0 {
        bail!("Homoclinic shooting interval and integration counts must be positive");
    }
    if source.guess.mesh_states.len() != source.ntst + 1
        || source.guess.stage_states.len() != source.ntst
    {
        bail!("Source homoclinic collocation profile is incomplete");
    }
    let coefficients = CollocationCoefficients::new(source.ncol)?;
    let normalized_mesh = source.resolved_normalized_mesh()?;
    let mut times = Vec::new();
    let mut states = Vec::new();
    times.push(0.0);
    states.push(source.guess.mesh_states[0].clone());
    for interval in 0..source.ntst {
        if source.guess.stage_states[interval].len() != source.ncol {
            bail!("Source homoclinic collocation stages are incomplete");
        }
        let left = normalized_mesh[interval];
        let width = normalized_mesh[interval + 1] - left;
        for (stage, node) in coefficients.nodes.iter().copied().enumerate() {
            times.push(left + width * node);
            states.push(source.guess.stage_states[interval][stage].clone());
        }
        times.push(normalized_mesh[interval + 1]);
        states.push(source.guess.mesh_states[interval + 1].clone());
    }
    let nodes = (0..=shooting.intervals)
        .map(|index| interpolate_state(index as f64 / shooting.intervals as f64, &times, &states))
        .collect::<Result<Vec<_>>>()?;
    Ok(HomoclinicShootingSetup {
        guess: HomoclinicShootingGuess {
            nodes,
            x0: source.guess.x0.clone(),
            param1_value: source.guess.param1_value,
            param2_value: source.guess.param2_value,
            time: source.guess.time,
            eps0: source.guess.eps0,
            eps1: source.guess.eps1,
            yu: source.guess.yu.clone(),
            ys: source.guess.ys.clone(),
        },
        initial_seed_is_corrected: source.initial_seed_is_corrected,
        shooting,
        param1_index: source.param1_index,
        param2_index: source.param2_index,
        param1_name: source.param1_name.clone(),
        param2_name: source.param2_name.clone(),
        base_params: source.base_params.clone(),
        extras: source.extras,
        basis: source.basis.clone(),
        projector_refresh_interval: source.projector_refresh_interval,
    })
}

/// Restart or remesh a saved standard-shooting point.
#[allow(clippy::too_many_arguments)]
pub fn homoclinic_shooting_setup_from_point(
    system: &mut EquationSystem,
    point_state: &[f64],
    source_intervals: usize,
    target_shooting: HomoclinicShootingSettings,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    target_extras: HomoclinicExtraFlags,
    source_extras: HomoclinicExtraFlags,
    source_fixed: HomoclinicFixedScalars,
) -> Result<HomoclinicShootingSetup> {
    if source_intervals == 0 || target_shooting.intervals == 0 {
        bail!("Homoclinic shooting restart requires positive source and target interval counts");
    }
    if param1_index == param2_index
        || param1_index >= base_params.len()
        || param2_index >= base_params.len()
    {
        bail!("Invalid homoclinic shooting restart parameter plane");
    }
    let dim = system.equations.len();
    let node_len = (source_intervals + 1) * dim;
    let header_len = node_len + dim + 1 + source_extras.free_count();
    if point_state.len() < header_len {
        bail!("Saved homoclinic shooting point is too short");
    }
    let x0 = point_state[node_len..node_len + dim].to_vec();
    let p2_index = node_len + dim;
    let p2 = point_state[p2_index];
    let mut params = base_params.to_vec();
    params[param2_index] = p2;
    let basis = compute_homoclinic_basis(system, &x0, &params)?;
    let y_size = basis.nneg * basis.npos;
    let expected = header_len + 2 * y_size;
    if point_state.len() != expected {
        bail!(
            "Saved homoclinic shooting point has length {}; expected {}",
            point_state.len(),
            expected
        );
    }

    let source_setup = HomoclinicShootingSetup {
        guess: HomoclinicShootingGuess {
            nodes: point_state[..node_len]
                .chunks(dim)
                .map(|node| node.to_vec())
                .collect(),
            x0,
            param1_value: params[param1_index],
            param2_value: p2,
            time: source_fixed.time,
            eps0: source_fixed.eps0,
            eps1: source_fixed.eps1,
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        initial_seed_is_corrected: true,
        shooting: HomoclinicShootingSettings {
            intervals: source_intervals,
            integration_steps_per_segment: target_shooting.integration_steps_per_segment,
        },
        param1_index,
        param2_index,
        param1_name: param1_name.to_owned(),
        param2_name: param2_name.to_owned(),
        base_params: params.clone(),
        extras: source_extras,
        basis: basis.clone(),
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
    };
    let decoded = decode_homoclinic_shooting_state(point_state, &source_setup)?;
    let source_times = (0..=source_intervals)
        .map(|index| index as f64 / source_intervals as f64)
        .collect::<Vec<_>>();
    let nodes = (0..=target_shooting.intervals)
        .map(|index| {
            interpolate_state(
                index as f64 / target_shooting.intervals as f64,
                &source_times,
                &decoded.nodes,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(HomoclinicShootingSetup {
        guess: HomoclinicShootingGuess {
            nodes,
            x0: decoded.x0,
            param1_value: params[param1_index],
            param2_value: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            // The restart basis is recomputed exactly at the saved saddle.
            // Riccati coordinates belong to the old chart, so carrying them
            // into this new basis would misrepresent the invariant spaces.
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        initial_seed_is_corrected: true,
        shooting: target_shooting,
        param1_index,
        param2_index,
        param1_name: param1_name.to_owned(),
        param2_name: param2_name.to_owned(),
        base_params: params,
        extras: target_extras,
        basis,
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedHomoclinicShootingState {
    pub nodes: Vec<Vec<f64>>,
    pub x0: Vec<f64>,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub yu: Vec<f64>,
    pub ys: Vec<f64>,
}

pub fn pack_homoclinic_shooting_state(setup: &HomoclinicShootingSetup) -> Vec<f64> {
    let mut flat = Vec::new();
    flat.extend(setup.guess.nodes.iter().flatten().copied());
    flat.extend_from_slice(&setup.guess.x0);
    flat.push(setup.guess.param2_value);
    if setup.extras.free_time {
        flat.push(setup.guess.time);
    }
    if setup.extras.free_eps0 {
        flat.push(setup.guess.eps0);
    }
    if setup.extras.free_eps1 {
        flat.push(setup.guess.eps1);
    }
    flat.extend_from_slice(&setup.guess.yu);
    flat.extend_from_slice(&setup.guess.ys);
    flat
}

pub fn decode_homoclinic_shooting_state(
    flat: &[f64],
    setup: &HomoclinicShootingSetup,
) -> Result<DecodedHomoclinicShootingState> {
    let dim = setup.basis.dim;
    let intervals = setup.shooting.intervals;
    let node_len = (intervals + 1) * dim;
    let y_size = setup.basis.nneg * setup.basis.npos;
    let expected = node_len + dim + 1 + setup.extras.free_count() + 2 * y_size;
    if flat.len() != expected {
        bail!(
            "Invalid homoclinic shooting state length: expected {}, got {}",
            expected,
            flat.len()
        );
    }

    let mut index = 0usize;
    let nodes = flat[index..index + node_len]
        .chunks(dim)
        .map(|row| row.to_vec())
        .collect::<Vec<_>>();
    index += node_len;
    let x0 = flat[index..index + dim].to_vec();
    index += dim;
    let param2_value = flat[index];
    index += 1;

    let mut time = setup.guess.time;
    let mut eps0 = setup.guess.eps0;
    let mut eps1 = setup.guess.eps1;
    if setup.extras.free_time {
        time = flat[index];
        index += 1;
    }
    if setup.extras.free_eps0 {
        eps0 = flat[index];
        index += 1;
    }
    if setup.extras.free_eps1 {
        eps1 = flat[index];
        index += 1;
    }
    let yu = flat[index..index + y_size].to_vec();
    index += y_size;
    let ys = flat[index..index + y_size].to_vec();

    Ok(DecodedHomoclinicShootingState {
        nodes,
        x0,
        param2_value,
        time,
        eps0,
        eps1,
        yu,
        ys,
    })
}

pub struct HomoclinicShootingProblem<'a> {
    system: &'a mut EquationSystem,
    setup: HomoclinicShootingSetup,
    section_index: usize,
    section_center: Vec<f64>,
    section_normal: Vec<f64>,
    accepted_steps_since_projector_refresh: usize,
    chart_transforms: Vec<HomoclinicChartTransform>,
}

const PROJECTOR_REFRESH_ANGLE_THRESHOLD: f64 = std::f64::consts::PI / 9.0;

impl<'a> HomoclinicShootingProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, setup: HomoclinicShootingSetup) -> Result<Self> {
        validate_setup(system, &setup)?;
        let params = resolved_params(&setup, setup.guess.param1_value, setup.guess.param2_value)?;
        let section_index = max_norm_node_index(&setup.guess.nodes);
        let section_center = setup.guess.nodes[section_index].clone();
        let mut section_normal = flow_at(system, &params, &section_center)?;
        normalize_in_place(&mut section_normal)?;
        Ok(Self {
            system,
            setup,
            section_index,
            section_center,
            section_normal,
            accepted_steps_since_projector_refresh: 0,
            chart_transforms: Vec::new(),
        })
    }

    pub fn setup(&self) -> &HomoclinicShootingSetup {
        &self.setup
    }

    pub fn projector_refresh_count(&self) -> usize {
        self.chart_transforms.len()
    }

    pub fn resume_context(&self) -> HomoclinicResumeContext {
        HomoclinicResumeContext {
            base_params: self.setup.base_params.clone(),
            param1_index: self.setup.param1_index,
            param2_index: self.setup.param2_index,
            basis: HomoclinicBasisSnapshot {
                stable_q: self.setup.basis.stable_q.clone(),
                unstable_q: self.setup.basis.unstable_q.clone(),
                dim: self.setup.basis.dim,
                nneg: self.setup.basis.nneg,
                npos: self.setup.basis.npos,
            },
            fixed_time: self.setup.guess.time,
            fixed_eps0: self.setup.guess.eps0,
            fixed_eps1: self.setup.guess.eps1,
            projector_refresh_interval: self.setup.projector_refresh_interval,
        }
    }

    fn projector_chart_angle(&self, decoded: &DecodedHomoclinicShootingState) -> f64 {
        let yu = DMatrix::from_row_slice(self.setup.basis.nneg, self.setup.basis.npos, &decoded.yu);
        let ys = DMatrix::from_row_slice(self.setup.basis.npos, self.setup.basis.nneg, &decoded.ys);
        let yu_sigma = yu
            .svd(false, false)
            .singular_values
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        let ys_sigma = ys
            .svd(false, false)
            .singular_values
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        yu_sigma.max(ys_sigma).atan()
    }

    fn transform_seed(
        transform: &HomoclinicChartTransform,
        seed: &ReparameterizationSeed,
    ) -> Result<ReparameterizationSeed> {
        let tangent = transform.transform_tangent(&seed.aug_state, &seed.tangent)?;
        let aug_state = DVector::from_vec(transform.transform_values(seed.aug_state.as_slice())?);
        Ok(ReparameterizationSeed { aug_state, tangent })
    }

    fn dim(&self) -> usize {
        self.setup.basis.dim
    }

    fn y_size(&self) -> usize {
        self.setup.basis.nneg * self.setup.basis.npos
    }

    fn decode(&self, aug: &DVector<f64>) -> Result<DecodedHomoclinicShootingState> {
        decode_homoclinic_shooting_state(&aug.as_slice()[1..], &self.setup)
    }

    fn params(&self, p1: f64, p2: f64) -> Result<Vec<f64>> {
        resolved_params(&self.setup, p1, p2)
    }

    fn with_params<F, R>(&mut self, params: &[f64], mut f: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        let old = self.system.params.clone();
        if old.len() != params.len() {
            bail!("Parameter vector length mismatch");
        }
        self.system.params.copy_from_slice(params);
        let result = f(self.system);
        self.system.params = old;
        result
    }

    fn integrate_segment(
        &mut self,
        initial: &[f64],
        duration: f64,
        params: &[f64],
    ) -> Result<Vec<f64>> {
        let steps = self.setup.shooting.integration_steps_per_segment;
        self.with_params(params, |system| {
            integrate_fixed(system, initial, duration, steps)
        })
    }

    fn basis_matrix(flat: &[f64], dim: usize) -> Result<DMatrix<f64>> {
        if flat.len() != dim * dim {
            bail!("Basis matrix has invalid size");
        }
        Ok(DMatrix::from_column_slice(dim, dim, flat))
    }

    fn saddle_jacobian(
        &mut self,
        aug: &DVector<f64>,
    ) -> Result<(DecodedHomoclinicShootingState, DMatrix<f64>)> {
        let decoded = self.decode(aug)?;
        let params = self.params(aug[0], decoded.param2_value)?;
        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let jac = DMatrix::from_row_slice(self.dim(), self.dim(), &jac_data);
        Ok((decoded, jac))
    }
}

impl<'a> ContinuationProblem for HomoclinicShootingProblem<'a> {
    fn dimension(&self) -> usize {
        let dim = self.dim();
        (self.setup.shooting.intervals + 1) * dim
            + dim
            + 1
            + self.setup.extras.free_count()
            + 2 * self.y_size()
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        if out.len() != self.dimension() {
            bail!(
                "Homoclinic shooting residual length mismatch: expected {}, got {}",
                self.dimension(),
                out.len()
            );
        }
        let decoded = self.decode(aug)?;
        if !decoded.time.is_finite() || decoded.time <= 0.0 {
            bail!("Homoclinic time must be finite and positive");
        }
        if !decoded.eps0.is_finite()
            || !decoded.eps1.is_finite()
            || decoded.eps0 <= 0.0
            || decoded.eps1 <= 0.0
        {
            bail!("Homoclinic endpoint distances must be finite and positive");
        }

        let dim = self.dim();
        let params = self.params(aug[0], decoded.param2_value)?;
        let segment_duration = 2.0 * decoded.time / self.setup.shooting.intervals as f64;
        let mut row = 0usize;

        // Standard multiple-shooting continuity.  M=1 is single shooting.
        for segment in 0..self.setup.shooting.intervals {
            let flowed =
                self.integrate_segment(&decoded.nodes[segment], segment_duration, &params)?;
            for component in 0..dim {
                out[row] = flowed[component] - decoded.nodes[segment + 1][component];
                row += 1;
            }
        }

        let equilibrium_flow = self.with_params(&params, |system| {
            let mut f = vec![0.0; dim];
            system.apply(0.0, &decoded.x0, &mut f);
            Ok(f)
        })?;
        for value in equilibrium_flow {
            out[row] = value;
            row += 1;
        }

        if self.setup.extras.free_count() == 2 {
            let node = &decoded.nodes[self.section_index.min(decoded.nodes.len() - 1)];
            out[row] = dot(
                &vector_sub(node, &self.section_center),
                &self.section_normal,
            );
            row += 1;
        }

        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let jac = DMatrix::from_row_slice(dim, dim, &jac_data);
        let q0u = Self::basis_matrix(&self.setup.basis.unstable_q, dim)?;
        let q0s = Self::basis_matrix(&self.setup.basis.stable_q, dim)?;
        let yu = unpack_row_major(&decoded.yu, self.setup.basis.nneg, self.setup.basis.npos);
        let ys = unpack_row_major(&decoded.ys, self.setup.basis.npos, self.setup.basis.nneg);

        if self.y_size() > 0 {
            let ru = riccati_residual(&q0u, &jac, self.setup.basis.npos, &yu)?;
            for value in ru.iter() {
                out[row] = *value;
                row += 1;
            }
            let rs = riccati_residual(&q0s, &jac, self.setup.basis.nneg, &ys)?;
            for value in rs.iter() {
                out[row] = *value;
                row += 1;
            }
        }

        let start_delta = vector_sub(&decoded.nodes[0], &decoded.x0);
        let end_delta = vector_sub(
            decoded
                .nodes
                .last()
                .ok_or_else(|| anyhow!("Homoclinic shooting nodes are empty"))?,
            &decoded.x0,
        );
        let q1u = build_q1_unstable(&q0u, &yu)?;
        for index in 0..self.setup.basis.nneg {
            let column = self.setup.basis.nneg - 1 - index;
            out[row] = dot(&start_delta, q1u.column(column).as_slice());
            row += 1;
        }
        let q1s = build_q1_stable(&q0s, &ys)?;
        for index in 0..self.setup.basis.npos {
            let column = self.setup.basis.npos - 1 - index;
            out[row] = dot(&end_delta, q1s.column(column).as_slice());
            row += 1;
        }
        out[row] = l2_norm(&start_delta) - decoded.eps0;
        row += 1;
        out[row] = l2_norm(&end_delta) - decoded.eps1;
        row += 1;

        if row != out.len() {
            bail!(
                "Homoclinic shooting residual assembly mismatch: filled {}, expected {}",
                row,
                out.len()
            );
        }
        Ok(())
    }

    fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dimension = self.dimension();
        let mut baseline = DVector::zeros(dimension);
        self.residual(aug, &mut baseline)?;
        let mut jac = DMatrix::zeros(dimension, dimension + 1);
        let mut shifted_aug = aug.clone();
        for column in 0..=dimension {
            let base = aug[column];
            let step = 1e-7_f64.max(1e-7 * base.abs());
            shifted_aug[column] = base + step;
            let mut shifted = DVector::zeros(dimension);
            self.residual(&shifted_aug, &mut shifted)?;
            for row in 0..dimension {
                jac[(row, column)] = (shifted[row] - baseline[row]) / step;
            }
            shifted_aug[column] = base;
        }
        Ok(jac)
    }

    fn diagnostics(&mut self, aug: &DVector<f64>) -> Result<PointDiagnostics> {
        let (decoded, jac) = self.saddle_jacobian(aug)?;
        let eigenvalues: Vec<Complex<f64>> = jac.complex_eigenvalues().iter().copied().collect();
        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues,
            cycle_points: Some(decoded.nodes),
        })
    }

    fn homoclinic_event_diagnostics(
        &mut self,
        aug: &DVector<f64>,
    ) -> Result<Option<HomoclinicEventDiagnostics>> {
        let (decoded, jac) = self.saddle_jacobian(aug)?;
        let eigenvalues = jac
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let start = decoded
            .nodes
            .first()
            .ok_or_else(|| anyhow!("Homoclinic shooting nodes are empty"))?;
        let end = decoded
            .nodes
            .last()
            .ok_or_else(|| anyhow!("Homoclinic shooting nodes are empty"))?;
        let unstable_displacement = vector_sub(start, &decoded.x0);
        let stable_displacement = vector_sub(end, &decoded.x0);

        // Adjoint construction is a soft capability: a defective leading
        // eigenspace must not suppress the spectrum-backed event channels.
        // The affected orbit-flip side is reported as unavailable instead.
        let orbit_flip = build_homoclinic_orbit_flip_data(
            &jac,
            &eigenvalues,
            unstable_displacement,
            stable_displacement,
        );

        Ok(Some(compute_homoclinic_event_diagnostics(
            &eigenvalues,
            Some(&orbit_flip),
            DEFAULT_FOCUS_TOLERANCE,
        )))
    }

    fn detect_homoclinic_events_from_initial_seed(&self) -> bool {
        self.setup.initial_seed_is_corrected
    }

    fn reparameterize_after_step(
        &mut self,
        previous_aug: &DVector<f64>,
        corrected_aug: &DVector<f64>,
        previous_tangent: &DVector<f64>,
        branch_states: &[Vec<f64>],
        active_seeds: &[ReparameterizationSeed],
    ) -> Result<Option<PostCorrectorReparameterization>> {
        if self.setup.projector_refresh_interval == 0 {
            return Ok(None);
        }
        self.accepted_steps_since_projector_refresh += 1;
        let decoded = self.decode(corrected_aug)?;
        let cadence_due =
            self.accepted_steps_since_projector_refresh >= self.setup.projector_refresh_interval;
        let angle_due = self.projector_chart_angle(&decoded) >= PROJECTOR_REFRESH_ANGLE_THRESHOLD;
        if !cadence_due && !angle_due {
            return Ok(None);
        }

        let params = self.params(corrected_aug[0], decoded.param2_value)?;
        let Ok(new_basis) = compute_homoclinic_basis(self.system, &decoded.x0, &params) else {
            return Ok(None);
        };
        let Ok(transform) = HomoclinicChartTransform::new(&self.setup.basis, &new_basis) else {
            return Ok(None);
        };
        let prepared = (|| -> Result<PostCorrectorReparameterization> {
            let transformed_previous =
                DVector::from_vec(transform.transform_values(previous_aug.as_slice())?);
            let transformed_corrected =
                DVector::from_vec(transform.transform_values(corrected_aug.as_slice())?);
            let transformed_tangent =
                transform.transform_tangent(previous_aug, previous_tangent)?;
            let transformed_states = branch_states
                .iter()
                .map(|state| transform.transform_values(state))
                .collect::<Result<Vec<_>>>()?;
            let transformed_seeds = active_seeds
                .iter()
                .map(|seed| Self::transform_seed(&transform, seed))
                .collect::<Result<Vec<_>>>()?;
            Ok(PostCorrectorReparameterization {
                previous_aug: transformed_previous,
                corrected_aug: transformed_corrected,
                previous_tangent: transformed_tangent,
                branch_states: transformed_states,
                active_seeds: transformed_seeds,
            })
        })();
        let Ok(prepared) = prepared else {
            return Ok(None);
        };

        self.setup.basis = transform.new_basis().clone();
        self.chart_transforms.push(transform);
        self.accepted_steps_since_projector_refresh = 0;
        Ok(Some(prepared))
    }

    fn transfer_branch_states_to_current_discretization(
        &self,
        branch_states: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        let mut transferred = branch_states.to_vec();
        for transform in &self.chart_transforms {
            transferred = transferred
                .iter()
                .map(|state| transform.transform_values(state))
                .collect::<Result<Vec<_>>>()?;
        }
        Ok(transferred)
    }

    fn refresh_persisted_point_after_state_transfer(
        &self,
        point: &mut ContinuationPoint,
    ) -> Result<()> {
        let mut aug = DVector::zeros(self.dimension() + 1);
        aug[0] = point.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&point.state);
        point.cycle_points = Some(self.decode(&aug)?.nodes);
        Ok(())
    }

    fn transfer_endpoint_seeds_to_current_coordinates(
        &self,
        seeds: &[ReparameterizationSeed],
    ) -> Result<Vec<ReparameterizationSeed>> {
        let mut transferred = seeds.to_vec();
        for transform in &self.chart_transforms {
            transferred = transferred
                .iter()
                .map(|seed| Self::transform_seed(transform, seed))
                .collect::<Result<Vec<_>>>()?;
        }
        Ok(transferred)
    }

    fn update_after_step(&mut self, aug: &DVector<f64>) -> Result<()> {
        let decoded = self.decode(aug)?;
        let params = self.params(aug[0], decoded.param2_value)?;
        self.section_index = max_norm_node_index(&decoded.nodes);
        self.section_center = decoded.nodes[self.section_index].clone();
        let section_center = self.section_center.clone();
        self.section_normal = self.with_params(&params, |system| {
            let mut f = vec![0.0; section_center.len()];
            system.apply(0.0, &section_center, &mut f);
            Ok(f)
        })?;
        normalize_in_place(&mut self.section_normal)?;
        self.setup.guess.nodes = decoded.nodes;
        self.setup.guess.x0 = decoded.x0;
        self.setup.guess.param1_value = aug[0];
        self.setup.guess.param2_value = decoded.param2_value;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.setup.guess.yu = decoded.yu;
        self.setup.guess.ys = decoded.ys;
        Ok(())
    }
}

fn validate_setup(system: &EquationSystem, setup: &HomoclinicShootingSetup) -> Result<()> {
    let dim = system.equations.len();
    if setup.param1_index == setup.param2_index {
        bail!("Homoclinic continuation requires two distinct model parameters");
    }
    if setup.param1_index >= setup.base_params.len()
        || setup.param2_index >= setup.base_params.len()
    {
        bail!("Parameter index out of range in homoclinic shooting setup");
    }
    if setup.extras.free_count() == 0 || setup.extras.free_count() > 2 {
        bail!("Homoclinic shooting requires one or two free quantities among T, eps0, and eps1");
    }
    if setup.shooting.intervals == 0 {
        bail!("Homoclinic shooting requires at least one interval");
    }
    if setup.shooting.integration_steps_per_segment == 0 {
        bail!("Homoclinic shooting requires at least one integration step per segment");
    }
    if setup.basis.dim != dim
        || setup.basis.nneg + setup.basis.npos != dim
        || setup.basis.nneg == 0
        || setup.basis.npos == 0
    {
        bail!("Homoclinic shooting basis dimensions are invalid");
    }
    if setup.guess.nodes.len() != setup.shooting.intervals + 1
        || setup.guess.nodes.iter().any(|node| node.len() != dim)
        || setup.guess.x0.len() != dim
    {
        bail!("Homoclinic shooting nodes or equilibrium have invalid dimensions");
    }
    if !setup.guess.time.is_finite()
        || setup.guess.time <= 0.0
        || !setup.guess.eps0.is_finite()
        || setup.guess.eps0 <= 0.0
        || !setup.guess.eps1.is_finite()
        || setup.guess.eps1 <= 0.0
    {
        bail!("Homoclinic shooting T, eps0, and eps1 must be finite and positive");
    }
    let y_size = setup.basis.nneg * setup.basis.npos;
    if setup.guess.yu.len() != y_size || setup.guess.ys.len() != y_size {
        bail!("Homoclinic shooting Riccati state has invalid dimensions");
    }
    Ok(())
}

fn resolved_params(setup: &HomoclinicShootingSetup, p1: f64, p2: f64) -> Result<Vec<f64>> {
    let mut params = setup.base_params.clone();
    if setup.param1_index == setup.param2_index
        || setup.param1_index >= params.len()
        || setup.param2_index >= params.len()
    {
        bail!("Invalid homoclinic shooting parameter plane");
    }
    params[setup.param1_index] = p1;
    params[setup.param2_index] = p2;
    Ok(params)
}

fn integrate_fixed(
    system: &EquationSystem,
    initial: &[f64],
    duration: f64,
    steps: usize,
) -> Result<Vec<f64>> {
    if !duration.is_finite() || duration <= 0.0 || steps == 0 {
        bail!("Shooting integration duration and step count must be positive");
    }
    let dt = duration / steps as f64;
    let mut solver = Tsit5::new(initial.len());
    let mut time = 0.0;
    let mut state = initial.to_vec();
    for _ in 0..steps {
        solver.step(system, &mut time, &mut state, dt);
        if state.iter().any(|value| !value.is_finite()) {
            bail!("Homoclinic shooting integration produced a non-finite state");
        }
    }
    Ok(state)
}

fn interpolate_state(tau: f64, times: &[f64], states: &[Vec<f64>]) -> Result<Vec<f64>> {
    if times.is_empty() || times.len() != states.len() {
        bail!("Invalid homoclinic shooting interpolation data");
    }
    if tau <= times[0] {
        return Ok(states[0].clone());
    }
    if tau >= times[times.len() - 1] {
        return Ok(states[states.len() - 1].clone());
    }
    let upper = times
        .partition_point(|value| *value < tau)
        .min(times.len() - 1);
    let lower = upper.saturating_sub(1);
    let width = times[upper] - times[lower];
    let alpha = if width.abs() > 1e-14 {
        ((tau - times[lower]) / width).clamp(0.0, 1.0)
    } else {
        0.0
    };
    if states[lower].len() != states[upper].len() {
        bail!("Homoclinic interpolation states have inconsistent dimensions");
    }
    Ok(states[lower]
        .iter()
        .zip(&states[upper])
        .map(|(left, right)| left * (1.0 - alpha) + right * alpha)
        .collect())
}

fn flow_at(system: &mut EquationSystem, params: &[f64], state: &[f64]) -> Result<Vec<f64>> {
    if system.params.len() != params.len() {
        bail!("Parameter vector length mismatch");
    }
    let old = system.params.clone();
    system.params.copy_from_slice(params);
    let mut flow = vec![0.0; state.len()];
    system.apply(0.0, state, &mut flow);
    system.params = old;
    Ok(flow)
}

fn max_norm_node_index(nodes: &[Vec<f64>]) -> usize {
    nodes
        .iter()
        .enumerate()
        .max_by(|(_, lhs), (_, rhs)| {
            l2_norm(lhs)
                .partial_cmp(&l2_norm(rhs))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn normalize_in_place(vector: &mut [f64]) -> Result<()> {
    let norm = l2_norm(vector);
    if !norm.is_finite() || norm <= 1e-14 {
        bail!("Cannot define a shooting phase section from a zero flow vector");
    }
    for value in vector {
        *value /= norm;
    }
    Ok(())
}

fn unpack_row_major(values: &[f64], rows: usize, cols: usize) -> DMatrix<f64> {
    DMatrix::from_row_slice(rows, cols, values)
}

fn riccati_residual(
    q0: &DMatrix<f64>,
    jac: &DMatrix<f64>,
    leading_dim: usize,
    y: &DMatrix<f64>,
) -> Result<DMatrix<f64>> {
    let transformed = q0.transpose() * jac * q0;
    if leading_dim > transformed.nrows() {
        bail!("Invalid invariant-subspace dimension");
    }
    let trailing = transformed.nrows() - leading_dim;
    let t11 = transformed.view((0, 0), (leading_dim, leading_dim));
    let t12 = transformed.view((0, leading_dim), (leading_dim, trailing));
    let t21 = transformed.view((leading_dim, 0), (trailing, leading_dim));
    let t22 = transformed.view((leading_dim, leading_dim), (trailing, trailing));
    Ok(t22 * y - y * t11 + t21 - y * t12 * y)
}

fn build_q1_unstable(q0u: &DMatrix<f64>, yu: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    let nneg = yu.nrows();
    let npos = yu.ncols();
    if q0u.nrows() != nneg + npos || q0u.ncols() != nneg + npos {
        bail!("Unstable basis dimensions do not match Riccati state");
    }
    let mut block = DMatrix::zeros(nneg + npos, nneg);
    for row in 0..npos {
        for column in 0..nneg {
            block[(row, column)] = -yu[(column, row)];
        }
    }
    for index in 0..nneg {
        block[(npos + index, index)] = 1.0;
    }
    Ok(q0u * block)
}

fn build_q1_stable(q0s: &DMatrix<f64>, ys: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    let npos = ys.nrows();
    let nneg = ys.ncols();
    if q0s.nrows() != nneg + npos || q0s.ncols() != nneg + npos {
        bail!("Stable basis dimensions do not match Riccati state");
    }
    let mut block = DMatrix::zeros(nneg + npos, npos);
    for row in 0..nneg {
        for column in 0..npos {
            block[(row, column)] = -ys[(column, row)];
        }
    }
    for index in 0..npos {
        block[(nneg + index, index)] = 1.0;
    }
    Ok(q0s * block)
}

fn vector_sub(lhs: &[f64], rhs: &[f64]) -> Vec<f64> {
    lhs.iter().zip(rhs).map(|(a, b)| a - b).collect()
}

fn dot(lhs: &[f64], rhs: &[f64]) -> f64 {
    lhs.iter().zip(rhs).map(|(a, b)| a * b).sum()
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::homoclinic_events::{HomoclinicEventKind, HomoclinicEventStatus};
    use crate::equation_engine::{Bytecode, OpCode};

    fn saddle_system() -> EquationSystem {
        // x' = p0*x, y' = -p1*y
        let x = Bytecode {
            ops: vec![OpCode::LoadParam(0), OpCode::LoadVar(0), OpCode::Mul],
        };
        let y = Bytecode {
            ops: vec![
                OpCode::LoadConst(-1.0),
                OpCode::LoadParam(1),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::Mul,
            ],
        };
        EquationSystem::new(vec![x, y], vec![1.0, 1.0])
    }

    fn defective_saddle_system() -> EquationSystem {
        // J = [-1 1 0; 0 -1 0; 0 0 1]. The repeated stable eigenvalue is
        // defective, so its left/right eigenvectors have zero pairing.
        let x = Bytecode {
            ops: vec![
                OpCode::LoadConst(-1.0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::Add,
            ],
        };
        let y = Bytecode {
            ops: vec![OpCode::LoadConst(-1.0), OpCode::LoadVar(1), OpCode::Mul],
        };
        let z = Bytecode {
            ops: vec![OpCode::LoadVar(2)],
        };
        EquationSystem::new(vec![x, y, z], vec![0.0, 0.0])
    }

    fn setup(intervals: usize, extras: HomoclinicExtraFlags) -> HomoclinicShootingSetup {
        let time = 0.5;
        let mut nodes = Vec::with_capacity(intervals + 1);
        for index in 0..=intervals {
            let t = index as f64 / intervals as f64;
            nodes.push(vec![0.2 * t.exp(), 0.3 * (-t).exp()]);
        }
        HomoclinicShootingSetup {
            guess: HomoclinicShootingGuess {
                nodes,
                x0: vec![0.0, 0.0],
                param1_value: 1.0,
                param2_value: 1.0,
                time,
                eps0: (0.2_f64.powi(2) + 0.3_f64.powi(2)).sqrt(),
                eps1: ((0.2 * std::f64::consts::E).powi(2) + (0.3 / std::f64::consts::E).powi(2))
                    .sqrt(),
                yu: vec![0.0],
                ys: vec![0.0],
            },
            initial_seed_is_corrected: false,
            shooting: HomoclinicShootingSettings {
                intervals,
                integration_steps_per_segment: 64,
            },
            param1_index: 0,
            param2_index: 1,
            param1_name: "a".into(),
            param2_name: "b".into(),
            base_params: vec![1.0, 1.0],
            extras,
            basis: HomoclinicBasis {
                // stable basis starts with y; unstable basis starts with x.
                stable_q: vec![0.0, 1.0, 1.0, 0.0],
                unstable_q: vec![1.0, 0.0, 0.0, 1.0],
                dim: 2,
                nneg: 1,
                npos: 1,
            },
            projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        }
    }

    fn defective_setup() -> HomoclinicShootingSetup {
        HomoclinicShootingSetup {
            guess: HomoclinicShootingGuess {
                nodes: vec![vec![0.1, 0.1, 0.1], vec![0.2, 0.05, 0.2]],
                x0: vec![0.0; 3],
                param1_value: 0.0,
                param2_value: 0.0,
                time: 0.5,
                eps0: 3.0_f64.sqrt() * 0.1,
                eps1: (0.2_f64.powi(2) + 0.05_f64.powi(2) + 0.2_f64.powi(2)).sqrt(),
                yu: vec![0.0; 2],
                ys: vec![0.0; 2],
            },
            initial_seed_is_corrected: false,
            shooting: HomoclinicShootingSettings {
                intervals: 1,
                integration_steps_per_segment: 16,
            },
            param1_index: 0,
            param2_index: 1,
            param1_name: "a".into(),
            param2_name: "b".into(),
            base_params: vec![0.0, 0.0],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
            basis: HomoclinicBasis {
                stable_q: vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                unstable_q: vec![0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                dim: 3,
                nneg: 2,
                npos: 1,
            },
            projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        }
    }

    #[test]
    fn shooting_state_round_trips_for_one_and_two_free_quantities() {
        for extras in [
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
        ] {
            let setup = setup(3, extras);
            let packed = pack_homoclinic_shooting_state(&setup);
            let decoded = decode_homoclinic_shooting_state(&packed, &setup).unwrap();
            assert_eq!(decoded.nodes, setup.guess.nodes);
            assert_eq!(decoded.x0, setup.guess.x0);
            assert_eq!(decoded.time, setup.guess.time);
            assert_eq!(decoded.eps0, setup.guess.eps0);
            assert_eq!(decoded.eps1, setup.guess.eps1);
        }
    }

    #[test]
    fn multiple_shooting_continuity_matches_the_linear_flow() {
        let mut system = saddle_system();
        let setup = setup(
            4,
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        );
        let packed = pack_homoclinic_shooting_state(&setup);
        let mut aug = DVector::zeros(packed.len() + 1);
        aug[0] = setup.guess.param1_value;
        aug.as_mut_slice()[1..].copy_from_slice(&packed);
        let mut problem = HomoclinicShootingProblem::new(&mut system, setup).unwrap();
        assert!(
            !problem.detect_homoclinic_events_from_initial_seed(),
            "fresh shooting profiles must suppress seed-to-first event bracketing"
        );
        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(&aug, &mut residual).unwrap();
        let continuity_rows = 4 * 2;
        let continuity = residual
            .rows(0, continuity_rows)
            .iter()
            .copied()
            .collect::<Vec<_>>();
        assert!(
            l2_norm(&continuity) < 1e-8,
            "continuity residual = {continuity:?}",
        );
    }

    #[test]
    fn one_segment_is_the_single_shooting_special_case() {
        let one = saddle_system();
        let four = saddle_system();
        let initial = vec![0.2, 0.3];
        let endpoint_one = integrate_fixed(&one, &initial, 1.0, 256).unwrap();
        let mut endpoint_four = initial;
        for _ in 0..4 {
            endpoint_four = integrate_fixed(&four, &endpoint_four, 0.25, 64).unwrap();
        }
        assert!((endpoint_one[0] - endpoint_four[0]).abs() < 1e-11);
        assert!((endpoint_one[1] - endpoint_four[1]).abs() < 1e-11);
    }

    #[test]
    fn shooting_state_hook_exposes_supported_orbit_flip_channels() {
        let mut system = saddle_system();
        let setup = setup(
            2,
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        );
        let packed = pack_homoclinic_shooting_state(&setup);
        let mut aug = DVector::zeros(packed.len() + 1);
        aug[0] = setup.guess.param1_value;
        aug.as_mut_slice()[1..].copy_from_slice(&packed);
        let mut problem = HomoclinicShootingProblem::new(&mut system, setup).unwrap();

        let diagnostics = problem
            .homoclinic_event_diagnostics(&aug)
            .expect("shooting event diagnostics")
            .expect("shooting problem must expose homoclinic events");
        let neutral = diagnostics.event(HomoclinicEventKind::NeutralSaddle);
        assert_eq!(neutral.status, HomoclinicEventStatus::Available);
        assert!(neutral.value.unwrap().abs() < 1.0e-12);
        for kind in [
            HomoclinicEventKind::OrbitFlipUnstable,
            HomoclinicEventKind::OrbitFlipStable,
        ] {
            let event = diagnostics.event(kind);
            assert_eq!(event.status, HomoclinicEventStatus::Available);
            assert!(event.value.is_some_and(f64::is_finite));
        }
    }

    #[test]
    fn defective_adjoint_pairing_only_disables_the_affected_orbit_flip_side() {
        let mut system = defective_saddle_system();
        let setup = defective_setup();
        let packed = pack_homoclinic_shooting_state(&setup);
        let mut aug = DVector::zeros(packed.len() + 1);
        aug[0] = setup.guess.param1_value;
        aug.as_mut_slice()[1..].copy_from_slice(&packed);
        let mut problem = HomoclinicShootingProblem::new(&mut system, setup).unwrap();

        let diagnostics = problem
            .homoclinic_event_diagnostics(&aug)
            .expect("shooting event diagnostics")
            .expect("shooting problem must expose homoclinic events");
        assert_eq!(
            diagnostics
                .event(HomoclinicEventKind::OrbitFlipStable)
                .status,
            HomoclinicEventStatus::Unavailable
        );
        assert_eq!(
            diagnostics
                .event(HomoclinicEventKind::OrbitFlipUnstable)
                .status,
            HomoclinicEventStatus::Available
        );
    }

    #[test]
    fn rejects_three_free_quantities_and_same_parameter_axis() {
        let mut system = saddle_system();
        let all_free = setup(
            2,
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: true,
            },
        );
        let all_free_error = HomoclinicShootingProblem::new(&mut system, all_free)
            .err()
            .expect("three free quantities must fail");
        assert!(all_free_error.to_string().contains("one or two"));

        let mut same_axis = setup(
            2,
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        );
        same_axis.param2_index = same_axis.param1_index;
        let same_axis_error = HomoclinicShootingProblem::new(&mut system, same_axis)
            .err()
            .expect("same parameter axis must fail");
        assert!(same_axis_error.to_string().contains("distinct"));
    }

    #[test]
    fn saved_shooting_point_restarts_on_a_new_segment_mesh() {
        let extras = HomoclinicExtraFlags {
            free_time: true,
            free_eps0: false,
            free_eps1: false,
        };
        let mut source = setup(3, extras);
        source.guess.yu.fill(0.37);
        source.guess.ys.fill(-0.42);
        let state = pack_homoclinic_shooting_state(&source);
        let fixed = HomoclinicFixedScalars {
            time: source.guess.time,
            eps0: source.guess.eps0,
            eps1: source.guess.eps1,
        };
        let mut system = saddle_system();
        let restarted = homoclinic_shooting_setup_from_point(
            &mut system,
            &state,
            3,
            HomoclinicShootingSettings {
                intervals: 5,
                integration_steps_per_segment: 96,
            },
            &[1.0, 1.0],
            0,
            1,
            "a",
            "b",
            extras,
            extras,
            fixed,
        )
        .expect("shooting restart");
        assert!(
            restarted.initial_seed_is_corrected,
            "a saved corrected shooting endpoint must be trusted for first-step events"
        );
        let round_tripped: HomoclinicShootingSetup = serde_json::from_str(
            &serde_json::to_string(&restarted).expect("serialize trusted shooting restart"),
        )
        .expect("deserialize trusted shooting restart");
        assert!(round_tripped.initial_seed_is_corrected);
        let problem = HomoclinicShootingProblem::new(&mut system, restarted.clone())
            .expect("restarted shooting problem");
        assert!(problem.detect_homoclinic_events_from_initial_seed());
        assert_eq!(restarted.guess.nodes.len(), 6);
        assert_eq!(restarted.guess.nodes[0], source.guess.nodes[0]);
        assert_eq!(restarted.guess.nodes[5], source.guess.nodes[3]);
        assert_eq!(restarted.guess.time, source.guess.time);
        assert_eq!(restarted.guess.eps0, source.guess.eps0);
        assert_eq!(restarted.guess.eps1, source.guess.eps1);
        assert!(restarted.guess.yu.iter().all(|value| value.abs() < 1e-14));
        assert!(restarted.guess.ys.iter().all(|value| value.abs() < 1e-14));
    }

    #[test]
    fn legacy_shooting_setup_deserializes_with_an_untrusted_seed() {
        let setup = setup(
            2,
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        );
        let mut legacy = serde_json::to_value(&setup).expect("serialize setup");
        legacy
            .as_object_mut()
            .expect("setup object")
            .remove("initial_seed_is_corrected");
        let reloaded: HomoclinicShootingSetup =
            serde_json::from_value(legacy).expect("deserialize legacy setup");
        assert!(!reloaded.initial_seed_is_corrected);
    }
}
