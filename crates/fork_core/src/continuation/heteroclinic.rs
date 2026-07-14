use super::heteroclinic_events::{
    build_heteroclinic_orbit_flip_data, compute_heteroclinic_event_diagnostics,
    HeteroclinicEventDiagnostics, DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
};
use super::heteroclinic_transport::{
    transport_source_inclination, transport_target_inclination, InclinationFrameData,
};
use super::homoclinic::{
    open_profile_palc_weights, transfer_homoclinic_aug, transfer_homoclinic_state,
};
use super::homoclinic_init::{
    compute_homoclinic_basis, validate_homoclinic_extras, validate_homoclinic_parameter_plane,
    validate_homoclinic_scalars, HomoclinicBasis, HomoclinicExtraFlags,
    DEFAULT_PROJECTOR_REFRESH_INTERVAL,
};
use super::periodic::{
    defect_weighted_normalized_mesh, integrate_polynomial, lagrange_coefficients,
    meshes_materially_different, propose_uniform_mesh_refinement, uniform_normalized_mesh,
    validated_normalized_mesh, CollocationAdaptationReport, CollocationAdaptivitySettings,
    CollocationCoefficients, CollocationDefectEstimate, CollocationDefectTermination,
    CollocationDefectTerminationReason, CollocationMeshAdaptationKind,
    CollocationRefinementAttempt,
};
use super::problem::{
    ContinuationProblem, PointDiagnostics, PostCorrectorReparameterization, ReparameterizationSeed,
    StepRejectionAction, TestFunctionValues,
};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, BranchType,
    ContinuationBranch, ContinuationPoint, ContinuationSettings, HeteroclinicConnectionSchemaV1,
    HomoclinicBasisSnapshot, HomoclinicDiscretization,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

pub const HETEROCLINIC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeteroclinicOrbitSeed {
    pub times: Vec<f64>,
    pub states: Vec<Vec<f64>>,
    pub source_equilibrium: Vec<f64>,
    pub target_equilibrium: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeteroclinicGuess {
    pub mesh_states: Vec<Vec<f64>>,
    pub stage_states: Vec<Vec<Vec<f64>>>,
    pub source_equilibrium: Vec<f64>,
    pub target_equilibrium: Vec<f64>,
    pub param1_value: f64,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub source_yu: Vec<f64>,
    pub target_ys: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeteroclinicSetupV1 {
    pub schema_version: u32,
    pub guess: HeteroclinicGuess,
    #[serde(default)]
    pub initial_seed_is_corrected: bool,
    pub ntst: usize,
    pub ncol: usize,
    #[serde(default)]
    pub normalized_mesh: Vec<f64>,
    #[serde(default)]
    pub collocation_adaptivity: CollocationAdaptivitySettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collocation_adaptation: Option<CollocationAdaptationReport>,
    #[serde(default = "default_projector_refresh_interval")]
    pub projector_refresh_interval: usize,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_name: String,
    pub param2_name: String,
    pub base_params: Vec<f64>,
    pub extras: HomoclinicExtraFlags,
    pub source_basis: HomoclinicBasis,
    pub target_basis: HomoclinicBasis,
}

fn default_projector_refresh_interval() -> usize {
    DEFAULT_PROJECTOR_REFRESH_INTERVAL
}

impl HeteroclinicSetupV1 {
    pub fn resolved_normalized_mesh(&self) -> Result<Vec<f64>> {
        validated_normalized_mesh(self.ntst, &self.normalized_mesh)
    }

    pub fn connection_schema(&self) -> HeteroclinicConnectionSchemaV1 {
        HeteroclinicConnectionSchemaV1 {
            schema_version: self.schema_version,
            base_params: self.base_params.clone(),
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            source_basis: basis_snapshot(&self.source_basis),
            target_basis: basis_snapshot(&self.target_basis),
            fixed_time: self.guess.time,
            fixed_eps0: self.guess.eps0,
            fixed_eps1: self.guess.eps1,
            projector_refresh_interval: self.projector_refresh_interval,
        }
    }
}

fn basis_snapshot(basis: &HomoclinicBasis) -> HomoclinicBasisSnapshot {
    HomoclinicBasisSnapshot {
        stable_q: basis.stable_q.clone(),
        unstable_q: basis.unstable_q.clone(),
        dim: basis.dim,
        nneg: basis.nneg,
        npos: basis.npos,
    }
}

#[derive(Debug, Clone)]
pub struct DecodedHeteroclinicState {
    pub mesh_states: Vec<Vec<f64>>,
    pub stage_states: Vec<Vec<Vec<f64>>>,
    pub source_equilibrium: Vec<f64>,
    pub target_equilibrium: Vec<f64>,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub source_yu: Vec<f64>,
    pub target_ys: Vec<f64>,
}

pub fn pack_heteroclinic_state(setup: &HeteroclinicSetupV1) -> Vec<f64> {
    let mut state = Vec::new();
    state.extend(setup.guess.mesh_states.iter().flatten().copied());
    state.extend(
        setup
            .guess
            .stage_states
            .iter()
            .flat_map(|interval| interval.iter().flatten())
            .copied(),
    );
    state.extend(setup.guess.source_equilibrium.iter().copied());
    state.extend(setup.guess.target_equilibrium.iter().copied());
    state.push(setup.guess.param2_value);
    if setup.extras.free_time {
        state.push(setup.guess.time);
    }
    if setup.extras.free_eps0 {
        state.push(setup.guess.eps0);
    }
    if setup.extras.free_eps1 {
        state.push(setup.guess.eps1);
    }
    state.extend(setup.guess.source_yu.iter().copied());
    state.extend(setup.guess.target_ys.iter().copied());
    state
}

#[allow(clippy::too_many_arguments)]
pub fn decode_heteroclinic_state(
    state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
    extras: HomoclinicExtraFlags,
    fixed_time: f64,
    fixed_eps0: f64,
    fixed_eps1: f64,
    source_dims: (usize, usize),
    target_dims: (usize, usize),
) -> Result<DecodedHeteroclinicState> {
    if dim == 0 || ntst < 2 || ncol == 0 {
        bail!("Invalid heteroclinic collocation layout");
    }
    let source_riccati_size = source_dims.0 * source_dims.1;
    let target_riccati_size = target_dims.0 * target_dims.1;
    let profile_len = ((ntst + 1) + ntst * ncol) * dim;
    let expected =
        profile_len + 2 * dim + 1 + extras.free_count() + source_riccati_size + target_riccati_size;
    if state.len() != expected {
        bail!(
            "Heteroclinic state length mismatch: expected {}, got {}",
            expected,
            state.len()
        );
    }

    let mut offset = 0usize;
    let mut mesh_states = Vec::with_capacity(ntst + 1);
    for _ in 0..=ntst {
        mesh_states.push(state[offset..offset + dim].to_vec());
        offset += dim;
    }
    let mut stage_states = Vec::with_capacity(ntst);
    for _ in 0..ntst {
        let mut interval = Vec::with_capacity(ncol);
        for _ in 0..ncol {
            interval.push(state[offset..offset + dim].to_vec());
            offset += dim;
        }
        stage_states.push(interval);
    }
    let source_equilibrium = state[offset..offset + dim].to_vec();
    offset += dim;
    let target_equilibrium = state[offset..offset + dim].to_vec();
    offset += dim;
    let param2_value = state[offset];
    offset += 1;
    let time = if extras.free_time {
        let value = state[offset];
        offset += 1;
        value
    } else {
        fixed_time
    };
    let eps0 = if extras.free_eps0 {
        let value = state[offset];
        offset += 1;
        value
    } else {
        fixed_eps0
    };
    let eps1 = if extras.free_eps1 {
        let value = state[offset];
        offset += 1;
        value
    } else {
        fixed_eps1
    };
    let source_yu = state[offset..offset + source_riccati_size].to_vec();
    offset += source_riccati_size;
    let target_ys = state[offset..offset + target_riccati_size].to_vec();

    validate_homoclinic_scalars(time, eps0, eps1)?;
    Ok(DecodedHeteroclinicState {
        mesh_states,
        stage_states,
        source_equilibrium,
        target_equilibrium,
        param2_value,
        time,
        eps0,
        eps1,
        source_yu,
        target_ys,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn heteroclinic_setup_from_orbit(
    system: &mut EquationSystem,
    seed: &HeteroclinicOrbitSeed,
    ntst: usize,
    ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HeteroclinicSetupV1> {
    validate_homoclinic_extras(extras)?;
    validate_homoclinic_parameter_plane(base_params.len(), param1_index, param2_index)?;
    if base_params.len() != system.params.len() {
        bail!("Heteroclinic base parameter vector length mismatch");
    }
    if ntst < 2 || ncol == 0 {
        bail!("Heteroclinic collocation requires at least two intervals and positive degree");
    }
    let dim = system.equations.len();
    validate_orbit_seed(seed, dim)?;
    if l2_norm(&vector_sub(
        &seed.source_equilibrium,
        &seed.target_equilibrium,
    )) <= 1.0e-8
    {
        bail!("Heteroclinic source and target equilibria must be distinct");
    }

    let source_basis = compute_homoclinic_basis(system, &seed.source_equilibrium, base_params)?;
    let target_basis = compute_homoclinic_basis(system, &seed.target_equilibrium, base_params)?;
    if source_basis.npos + target_basis.nneg != dim {
        bail!(
            "Heteroclinic codimension-one index condition requires source unstable dimension plus target stable dimension to equal {}, got {} + {}",
            dim,
            source_basis.npos,
            target_basis.nneg
        );
    }

    let normalized_mesh = uniform_normalized_mesh(ntst);
    let coefficients = CollocationCoefficients::new(ncol)?;
    let first_time = seed.times[0];
    let last_time = *seed
        .times
        .last()
        .ok_or_else(|| anyhow!("Heteroclinic orbit seed is empty"))?;
    let duration = last_time - first_time;
    let time = 0.5 * duration;
    let mesh_states = normalized_mesh
        .iter()
        .map(|coordinate| sample_orbit_seed(seed, first_time + duration * coordinate))
        .collect::<Result<Vec<_>>>()?;
    let stage_states = (0..ntst)
        .map(|interval| {
            let left = normalized_mesh[interval];
            let width = normalized_mesh[interval + 1] - left;
            coefficients
                .nodes
                .iter()
                .map(|node| sample_orbit_seed(seed, first_time + duration * (left + width * node)))
                .collect::<Result<Vec<_>>>()
        })
        .collect::<Result<Vec<_>>>()?;
    let eps0 = l2_norm(&vector_sub(
        mesh_states
            .first()
            .ok_or_else(|| anyhow!("Heteroclinic source endpoint is missing"))?,
        &seed.source_equilibrium,
    ));
    let eps1 = l2_norm(&vector_sub(
        mesh_states
            .last()
            .ok_or_else(|| anyhow!("Heteroclinic target endpoint is missing"))?,
        &seed.target_equilibrium,
    ));
    validate_homoclinic_scalars(time, eps0, eps1)?;

    Ok(HeteroclinicSetupV1 {
        schema_version: HETEROCLINIC_SCHEMA_VERSION,
        guess: HeteroclinicGuess {
            mesh_states,
            stage_states,
            source_equilibrium: seed.source_equilibrium.clone(),
            target_equilibrium: seed.target_equilibrium.clone(),
            param1_value: base_params[param1_index],
            param2_value: base_params[param2_index],
            time,
            eps0,
            eps1,
            source_yu: vec![0.0; source_basis.nneg * source_basis.npos],
            target_ys: vec![0.0; target_basis.nneg * target_basis.npos],
        },
        initial_seed_is_corrected: false,
        ntst,
        ncol,
        normalized_mesh,
        collocation_adaptivity: CollocationAdaptivitySettings::default(),
        collocation_adaptation: None,
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        param1_index,
        param2_index,
        param1_name: param1_name.to_owned(),
        param2_name: param2_name.to_owned(),
        base_params: base_params.to_vec(),
        extras,
        source_basis,
        target_basis,
    })
}

fn validate_orbit_seed(seed: &HeteroclinicOrbitSeed, dim: usize) -> Result<()> {
    if seed.times.len() != seed.states.len() || seed.times.len() < 3 {
        bail!("Heteroclinic orbit seed requires at least three time-aligned states");
    }
    if seed.source_equilibrium.len() != dim
        || seed.target_equilibrium.len() != dim
        || seed.states.iter().any(|state| state.len() != dim)
    {
        bail!("Heteroclinic orbit and equilibrium dimensions do not match the system");
    }
    if seed.times.iter().any(|time| !time.is_finite())
        || seed.times.windows(2).any(|pair| pair[1] <= pair[0])
        || seed.states.iter().flatten().any(|value| !value.is_finite())
    {
        bail!("Heteroclinic orbit samples must be finite and strictly time ordered");
    }
    Ok(())
}

fn sample_orbit_seed(seed: &HeteroclinicOrbitSeed, time: f64) -> Result<Vec<f64>> {
    if time <= seed.times[0] {
        return Ok(seed.states[0].clone());
    }
    let last = seed.times.len() - 1;
    if time >= seed.times[last] {
        return Ok(seed.states[last].clone());
    }
    let right = seed.times.partition_point(|candidate| *candidate < time);
    let left = right - 1;
    let span = seed.times[right] - seed.times[left];
    let fraction = (time - seed.times[left]) / span;
    Ok(seed.states[left]
        .iter()
        .zip(&seed.states[right])
        .map(|(left, right)| left + fraction * (right - left))
        .collect())
}

pub fn continue_heteroclinic_curve(
    system: &mut EquationSystem,
    setup: HeteroclinicSetupV1,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let initial_point = ContinuationPoint {
        state: pack_heteroclinic_state(&setup),
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut problem = HeteroclinicProblem::new(system, setup)?;
    let mut branch = continue_with_problem(&mut problem, initial_point, settings, forward)?;
    branch.branch_type = problem.branch_type_metadata();
    Ok(branch)
}

pub fn heteroclinic_setup_from_point(
    point: &ContinuationPoint,
    branch_type: &BranchType,
) -> Result<HeteroclinicSetupV1> {
    let BranchType::HeteroclinicCurve {
        schema,
        ntst,
        ncol,
        discretization,
        normalized_mesh,
        collocation_adaptivity,
        collocation_adaptation,
        param1_name,
        param2_name,
        free_time,
        free_eps0,
        free_eps1,
    } = branch_type
    else {
        bail!("Heteroclinic restart requires HeteroclinicCurve metadata");
    };
    if *discretization != HomoclinicDiscretization::Collocation {
        bail!("Heteroclinic collocation restart requires collocation metadata");
    }
    if schema.schema_version != HETEROCLINIC_SCHEMA_VERSION {
        bail!(
            "Unsupported heteroclinic schema version {}",
            schema.schema_version
        );
    }
    let extras = HomoclinicExtraFlags {
        free_time: *free_time,
        free_eps0: *free_eps0,
        free_eps1: *free_eps1,
    };
    let source_basis = basis_from_snapshot(&schema.source_basis);
    let target_basis = basis_from_snapshot(&schema.target_basis);
    let decoded = decode_heteroclinic_state(
        &point.state,
        source_basis.dim,
        *ntst,
        *ncol,
        extras,
        schema.fixed_time,
        schema.fixed_eps0,
        schema.fixed_eps1,
        (source_basis.nneg, source_basis.npos),
        (target_basis.nneg, target_basis.npos),
    )?;
    Ok(HeteroclinicSetupV1 {
        schema_version: schema.schema_version,
        guess: HeteroclinicGuess {
            mesh_states: decoded.mesh_states,
            stage_states: decoded.stage_states,
            source_equilibrium: decoded.source_equilibrium,
            target_equilibrium: decoded.target_equilibrium,
            param1_value: point.param_value,
            param2_value: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            source_yu: decoded.source_yu,
            target_ys: decoded.target_ys,
        },
        initial_seed_is_corrected: true,
        ntst: *ntst,
        ncol: *ncol,
        normalized_mesh: normalized_mesh.clone(),
        collocation_adaptivity: *collocation_adaptivity,
        collocation_adaptation: collocation_adaptation.clone(),
        projector_refresh_interval: schema.projector_refresh_interval,
        param1_index: schema.param1_index,
        param2_index: schema.param2_index,
        param1_name: param1_name.clone(),
        param2_name: param2_name.clone(),
        base_params: schema.base_params.clone(),
        extras,
        source_basis,
        target_basis,
    })
}

pub fn extend_heteroclinic_curve(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: ContinuationSettings,
    extend_forward: bool,
) -> Result<ContinuationBranch> {
    if matches!(
        branch.branch_type,
        BranchType::HeteroclinicCurve {
            discretization: HomoclinicDiscretization::Shooting { .. },
            ..
        }
    ) {
        return super::heteroclinic_shooting::extend_heteroclinic_shooting_curve(
            system,
            branch,
            settings,
            extend_forward,
        );
    }
    let endpoint = if extend_forward {
        branch
            .indices
            .iter()
            .enumerate()
            .max_by_key(|(_, index)| **index)
            .map(|(position, _)| position)
    } else {
        branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, index)| **index)
            .map(|(position, _)| position)
    }
    .ok_or_else(|| anyhow!("Cannot extend an empty heteroclinic branch"))?;
    let setup = heteroclinic_setup_from_point(&branch.points[endpoint], &branch.branch_type)?;
    let mut problem = HeteroclinicProblem::new(system, setup)?;
    let mut extended = extend_branch_with_problem(&mut problem, branch, settings, extend_forward)?;
    extended.branch_type = problem.branch_type_metadata();
    Ok(extended)
}

fn basis_from_snapshot(snapshot: &HomoclinicBasisSnapshot) -> HomoclinicBasis {
    HomoclinicBasis {
        stable_q: snapshot.stable_q.clone(),
        unstable_q: snapshot.unstable_q.clone(),
        dim: snapshot.dim,
        nneg: snapshot.nneg,
        npos: snapshot.npos,
    }
}

pub struct HeteroclinicProblem<'a> {
    system: &'a mut EquationSystem,
    setup: HeteroclinicSetupV1,
    normalized_mesh: Vec<f64>,
    coefficients: CollocationCoefficients,
    phase_reference: Vec<f64>,
    phase_derivative: Vec<f64>,
    stage_flow: Vec<f64>,
    adaptivity: CollocationAdaptivitySettings,
    adaptation_report: CollocationAdaptationReport,
    adaptation_transfer_start_index: usize,
    accepted_steps_since_projector_refresh: usize,
    chart_transforms: Vec<HeteroclinicChartTransform>,
}

const PROJECTOR_REFRESH_ANGLE_THRESHOLD: f64 = std::f64::consts::PI / 9.0;

impl<'a> HeteroclinicProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, setup: HeteroclinicSetupV1) -> Result<Self> {
        validate_setup(system, &setup)?;
        let normalized_mesh = setup.resolved_normalized_mesh()?;
        let coefficients = CollocationCoefficients::new(setup.ncol)?;
        let adaptivity = setup.collocation_adaptivity;
        if !adaptivity.defect_tolerance.is_finite() || adaptivity.defect_tolerance <= 0.0 {
            bail!("Heteroclinic collocation defect tolerance must be finite and positive");
        }
        if adaptivity.max_mesh_points < setup.ntst {
            bail!("Heteroclinic adaptive mesh cap is below the active interval count");
        }
        let adaptation_report = CollocationAdaptationReport {
            initial_mesh_points: setup.ntst,
            current_mesh_points: setup.ntst,
            degree: setup.ncol,
            defect_tolerance: adaptivity.defect_tolerance,
            refinement_budget: adaptivity.max_refinements,
            max_mesh_points: adaptivity.max_mesh_points,
            initial_normalized_mesh: normalized_mesh.clone(),
            current_normalized_mesh: normalized_mesh.clone(),
            attempts: Vec::new(),
            termination: None,
        };
        let persisted_report = setup.collocation_adaptation.clone();
        let mut problem = Self {
            system,
            setup,
            normalized_mesh,
            coefficients,
            phase_reference: Vec::new(),
            phase_derivative: Vec::new(),
            stage_flow: Vec::new(),
            adaptivity,
            adaptation_report,
            adaptation_transfer_start_index: 0,
            accepted_steps_since_projector_refresh: 0,
            chart_transforms: Vec::new(),
        };
        let params = problem.current_params(
            problem.setup.guess.param1_value,
            problem.setup.guess.param2_value,
        )?;
        let stages = problem.setup.guess.stage_states.clone();
        problem.set_phase_reference(&stages, &params, problem.setup.guess.time)?;
        if let Some(report) = persisted_report {
            problem.seed_adaptation_report(report)?;
        }
        Ok(problem)
    }

    fn dim(&self) -> usize {
        self.system.equations.len()
    }

    pub fn projector_refresh_count(&self) -> usize {
        self.chart_transforms.len()
    }

    pub fn normalized_mesh(&self) -> &[f64] {
        &self.normalized_mesh
    }

    pub fn adaptation_report(&self) -> &CollocationAdaptationReport {
        &self.adaptation_report
    }

    fn orbit_unknown_count(&self) -> usize {
        ((self.setup.ntst + 1) + self.setup.ntst * self.setup.ncol) * self.dim()
    }

    fn source_riccati_size(&self) -> usize {
        self.setup.source_basis.nneg * self.setup.source_basis.npos
    }

    fn target_riccati_size(&self) -> usize {
        self.setup.target_basis.nneg * self.setup.target_basis.npos
    }

    fn current_params(&self, p1: f64, p2: f64) -> Result<Vec<f64>> {
        let mut params = self.setup.base_params.clone();
        params[self.setup.param1_index] = p1;
        params[self.setup.param2_index] = p2;
        Ok(params)
    }

    fn decode(&self, aug_state: &DVector<f64>) -> Result<DecodedHeteroclinicState> {
        decode_heteroclinic_state(
            &aug_state.as_slice()[1..],
            self.dim(),
            self.setup.ntst,
            self.setup.ncol,
            self.setup.extras,
            self.setup.guess.time,
            self.setup.guess.eps0,
            self.setup.guess.eps1,
            (self.setup.source_basis.nneg, self.setup.source_basis.npos),
            (self.setup.target_basis.nneg, self.setup.target_basis.npos),
        )
    }

    fn with_params<F, R>(&mut self, params: &[f64], mut operation: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        let old = self.system.params.clone();
        self.system.params.copy_from_slice(params);
        let result = operation(self.system);
        self.system.params = old;
        result
    }

    fn evaluate_stage_flow(&mut self, stages: &[Vec<Vec<f64>>], params: &[f64]) -> Result<()> {
        let dim = self.dim();
        let mut values = vec![0.0; self.setup.ntst * self.setup.ncol * dim];
        self.with_params(params, |system| {
            let mut offset = 0usize;
            for interval in stages {
                for stage in interval {
                    system.apply(0.0, stage, &mut values[offset..offset + dim]);
                    offset += dim;
                }
            }
            Ok(())
        })?;
        self.stage_flow = values;
        Ok(())
    }

    fn stage_flow(&self, interval: usize, stage: usize) -> &[f64] {
        let dim = self.dim();
        let start = (interval * self.setup.ncol + stage) * dim;
        &self.stage_flow[start..start + dim]
    }

    fn interval_width(&self, interval: usize) -> f64 {
        self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]
    }

    fn flow_at(&mut self, state: &[f64], params: &[f64]) -> Result<Vec<f64>> {
        let mut output = vec![0.0; self.dim()];
        self.with_params(params, |system| {
            system.apply(0.0, state, &mut output);
            Ok(())
        })?;
        Ok(output)
    }

    fn jacobian_at(&mut self, state: &[f64], params: &[f64]) -> Result<DMatrix<f64>> {
        let dim = self.dim();
        let values = self.with_params(params, |system| {
            compute_jacobian(system, SystemKind::Flow, state)
        })?;
        Ok(DMatrix::from_row_slice(dim, dim, &values))
    }

    fn collocation_interval_maps(
        &mut self,
        decoded: &DecodedHeteroclinicState,
        params: &[f64],
    ) -> Result<(Vec<DMatrix<f64>>, Vec<f64>)> {
        let dim = self.dim();
        let stages = self.setup.ncol;
        let duration = 2.0 * decoded.time;
        let mut maps = Vec::with_capacity(self.setup.ntst);
        let mut residuals = Vec::with_capacity(self.setup.ntst);
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            let mut jacobians = Vec::with_capacity(stages);
            for stage in 0..stages {
                jacobians.push(self.jacobian_at(
                    &decoded.stage_states[interval][stage],
                    params,
                )?);
            }

            // Linearize the converged implicit Runge--Kutta stage equations:
            // Z_i = I + h sum_j a_ij A_j Z_j.
            let block_dimension = dim * stages;
            let mut system = DMatrix::zeros(block_dimension, block_dimension);
            let mut rhs = DMatrix::zeros(block_dimension, dim);
            for i in 0..stages {
                for row in 0..dim {
                    system[(i * dim + row, i * dim + row)] = 1.0;
                    rhs[(i * dim + row, row)] = 1.0;
                }
                for j in 0..stages {
                    let scale = h * self.coefficients.a[i][j];
                    for row in 0..dim {
                        for column in 0..dim {
                            system[(i * dim + row, j * dim + column)] -=
                                scale * jacobians[j][(row, column)];
                        }
                    }
                }
            }
            let stage_variations = system
                .clone()
                .lu()
                .solve(&rhs)
                .ok_or_else(|| anyhow!("Heteroclinic collocation tangent-stage solve failed"))?;
            let residual = (&system * &stage_variations - &rhs).norm()
                / (system.norm() * stage_variations.norm() + rhs.norm()).max(1.0);
            if !residual.is_finite() {
                bail!("Heteroclinic collocation tangent-stage residual is non-finite");
            }

            let mut map = DMatrix::identity(dim, dim);
            for stage in 0..stages {
                let variation = stage_variations.rows(stage * dim, dim).into_owned();
                map += h * self.coefficients.b[stage] * &jacobians[stage] * variation;
            }
            if map.iter().any(|value| !value.is_finite()) {
                bail!("Heteroclinic collocation tangent map is non-finite");
            }
            maps.push(map);
            residuals.push(residual);
        }
        Ok((maps, residuals))
    }

    fn inclination_frames(
        &mut self,
        decoded: &DecodedHeteroclinicState,
        params: &[f64],
    ) -> Result<(Option<InclinationFrameData>, Option<InclinationFrameData>)> {
        let dim = self.dim();
        let source_unstable_q = basis_matrix(&self.setup.source_basis.unstable_q, dim)?;
        let source_yu = DMatrix::from_row_slice(
            self.setup.source_basis.nneg,
            self.setup.source_basis.npos,
            &decoded.source_yu,
        );
        let source_unstable = invariant_graph_frame(
            &source_unstable_q,
            self.setup.source_basis.npos,
            &source_yu,
        )?;
        let target_stable_q = basis_matrix(&self.setup.target_basis.stable_q, dim)?;
        let target_ys = DMatrix::from_row_slice(
            self.setup.target_basis.npos,
            self.setup.target_basis.nneg,
            &decoded.target_ys,
        );
        let target_stable = invariant_graph_frame(
            &target_stable_q,
            self.setup.target_basis.nneg,
            &target_ys,
        )?;

        let target_unstable_q = basis_matrix(&self.setup.target_basis.unstable_q, dim)?;
        let source_stable_q = basis_matrix(&self.setup.source_basis.stable_q, dim)?;

        let source_endpoint = decoded
            .mesh_states
            .first()
            .ok_or_else(|| anyhow!("Heteroclinic collocation mesh is empty"))?;
        let target_endpoint = decoded
            .mesh_states
            .last()
            .ok_or_else(|| anyhow!("Heteroclinic collocation mesh is empty"))?;
        let source_flow = DVector::from_vec(self.flow_at(source_endpoint, params)?);
        let target_flow = DVector::from_vec(self.flow_at(target_endpoint, params)?);
        let (maps, residuals) = self.collocation_interval_maps(decoded, params)?;
        let source = if self.setup.source_basis.npos >= 2
            && self.setup.target_basis.npos == self.setup.source_basis.npos
        {
                let reference = target_unstable_q
                    .columns(1, self.setup.target_basis.npos - 1)
                    .into_owned();
                transport_source_inclination(
                    &maps,
                    &residuals,
                    &source_unstable,
                    &target_flow,
                    &reference,
                )
                .ok()
        } else {
            None
        };
        let target = if self.setup.target_basis.nneg >= 2
            && self.setup.source_basis.nneg == self.setup.target_basis.nneg
        {
                let reference = source_stable_q
                    .columns(1, self.setup.source_basis.nneg - 1)
                    .into_owned();
                transport_target_inclination(
                    &maps,
                    &residuals,
                    &target_stable,
                    &source_flow,
                    &reference,
                )
                .ok()
        } else {
            None
        };
        Ok((source, target))
    }

    fn set_phase_reference(
        &mut self,
        stages: &[Vec<Vec<f64>>],
        params: &[f64],
        time: f64,
    ) -> Result<()> {
        self.evaluate_stage_flow(stages, params)?;
        self.phase_reference = stages
            .iter()
            .flat_map(|interval| interval.iter().flatten())
            .copied()
            .collect();
        self.phase_derivative = self
            .stage_flow
            .iter()
            .map(|value| 2.0 * time * value)
            .collect();
        Ok(())
    }

    fn phase_residual(&self, stages: &[Vec<Vec<f64>>]) -> Result<f64> {
        let mut residual = 0.0;
        let dim = self.dim();
        for interval in 0..self.setup.ntst {
            for stage in 0..self.setup.ncol {
                let stage_index = interval * self.setup.ncol + stage;
                let weight = self.interval_width(interval) * self.coefficients.b[stage];
                for component in 0..dim {
                    let index = stage_index * dim + component;
                    residual += weight
                        * (stages[interval][stage][component] - self.phase_reference[index])
                        * self.phase_derivative[index];
                }
            }
        }
        if !residual.is_finite() {
            bail!("Heteroclinic phase residual is non-finite");
        }
        Ok(residual)
    }

    fn seed_adaptation_report(&mut self, mut report: CollocationAdaptationReport) -> Result<()> {
        if report.current_mesh_points != self.setup.ntst
            || report.degree != self.setup.ncol
            || meshes_materially_different(&report.current_normalized_mesh, &self.normalized_mesh)
        {
            bail!("Heteroclinic adaptation report does not match the active mesh");
        }
        self.adaptation_transfer_start_index = report.attempts.len();
        report.defect_tolerance = self.adaptivity.defect_tolerance;
        report.refinement_budget = self.adaptivity.max_refinements;
        report.max_mesh_points = self.adaptivity.max_mesh_points;
        report.termination = None;
        self.adaptation_report = report;
        Ok(())
    }

    fn collocation_defect_estimate(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<CollocationDefectEstimate> {
        let decoded = self.decode(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.param2_value)?;
        self.evaluate_stage_flow(&decoded.stage_states, &params)?;
        let polynomial_coefficients = lagrange_coefficients(&self.coefficients.nodes)?;
        let check_count = self.setup.ncol + 1;
        let checks = (0..check_count)
            .map(|check| {
                let tau = (check as f64 + 0.5) / check_count as f64;
                let basis = polynomial_coefficients
                    .iter()
                    .map(|coefficients| {
                        coefficients
                            .iter()
                            .rev()
                            .fold(0.0, |value, coefficient| value * tau + coefficient)
                    })
                    .collect::<Vec<_>>();
                let integrals = polynomial_coefficients
                    .iter()
                    .map(|coefficients| integrate_polynomial(coefficients, tau))
                    .collect::<Vec<_>>();
                (basis, integrals)
            })
            .collect::<Vec<_>>();

        let dim = self.dim();
        let duration = 2.0 * decoded.time;
        let mut interval_scaled_defects = vec![0.0_f64; self.setup.ntst];
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            for (basis, integrals) in &checks {
                let mut reconstructed = decoded.mesh_states[interval].clone();
                for component in 0..dim {
                    for stage in 0..self.setup.ncol {
                        reconstructed[component] +=
                            h * integrals[stage] * self.stage_flow(interval, stage)[component];
                    }
                }
                let actual_flow = self.flow_at(&reconstructed, &params)?;
                for component in 0..dim {
                    let polynomial_flow = (0..self.setup.ncol)
                        .map(|stage| basis[stage] * self.stage_flow(interval, stage)[component])
                        .sum::<f64>();
                    let scale = 1.0 + actual_flow[component].abs().max(polynomial_flow.abs());
                    interval_scaled_defects[interval] = interval_scaled_defects[interval]
                        .max((polynomial_flow - actual_flow[component]).abs() / scale);
                }
            }
        }
        let max_scaled_defect = interval_scaled_defects
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        if !max_scaled_defect.is_finite() {
            bail!("Heteroclinic collocation defect estimate is non-finite");
        }
        Ok(CollocationDefectEstimate {
            max_scaled_defect,
            interval_scaled_defects,
        })
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
            mesh_points: self.setup.ntst,
            degree: self.setup.ncol,
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

    fn replace_mesh(
        &mut self,
        normalized_mesh: Vec<f64>,
        transferred_aug: &DVector<f64>,
    ) -> Result<()> {
        let new_ntst = normalized_mesh.len().saturating_sub(1);
        self.normalized_mesh = validated_normalized_mesh(new_ntst, &normalized_mesh)?;
        self.setup.ntst = new_ntst;
        self.setup.normalized_mesh = self.normalized_mesh.clone();
        self.adaptation_report.current_mesh_points = new_ntst;
        self.adaptation_report.current_normalized_mesh = self.normalized_mesh.clone();
        self.adaptation_report.termination = None;
        let decoded = self.decode(transferred_aug)?;
        let params = self.current_params(transferred_aug[0], decoded.param2_value)?;
        self.setup.guess.mesh_states = decoded.mesh_states.clone();
        self.setup.guess.stage_states = decoded.stage_states.clone();
        self.setup.guess.source_equilibrium = decoded.source_equilibrium;
        self.setup.guess.target_equilibrium = decoded.target_equilibrium;
        self.setup.guess.param1_value = transferred_aug[0];
        self.setup.guess.param2_value = decoded.param2_value;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.setup.guess.source_yu = decoded.source_yu;
        self.setup.guess.target_ys = decoded.target_ys;
        self.set_phase_reference(&decoded.stage_states, &params, decoded.time)
    }

    fn projector_chart_angle(&self, decoded: &DecodedHeteroclinicState) -> f64 {
        let source = DMatrix::from_row_slice(
            self.setup.source_basis.nneg,
            self.setup.source_basis.npos,
            &decoded.source_yu,
        );
        let target = DMatrix::from_row_slice(
            self.setup.target_basis.npos,
            self.setup.target_basis.nneg,
            &decoded.target_ys,
        );
        let source_norm = source
            .svd(false, false)
            .singular_values
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        let target_norm = target
            .svd(false, false)
            .singular_values
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        source_norm.max(target_norm).atan()
    }

    pub fn branch_type_metadata(&self) -> BranchType {
        let mut schema = self.setup.connection_schema();
        schema.source_basis = basis_snapshot(&self.setup.source_basis);
        schema.target_basis = basis_snapshot(&self.setup.target_basis);
        BranchType::HeteroclinicCurve {
            schema,
            ntst: self.setup.ntst,
            ncol: self.setup.ncol,
            discretization: HomoclinicDiscretization::Collocation,
            normalized_mesh: self.normalized_mesh.clone(),
            collocation_adaptivity: self.setup.collocation_adaptivity,
            collocation_adaptation: Some(self.adaptation_report.clone()),
            param1_name: self.setup.param1_name.clone(),
            param2_name: self.setup.param2_name.clone(),
            free_time: self.setup.extras.free_time,
            free_eps0: self.setup.extras.free_eps0,
            free_eps1: self.setup.extras.free_eps1,
        }
    }
}

fn validate_setup(system: &EquationSystem, setup: &HeteroclinicSetupV1) -> Result<()> {
    if setup.schema_version != HETEROCLINIC_SCHEMA_VERSION {
        bail!(
            "Unsupported heteroclinic schema version {}",
            setup.schema_version
        );
    }
    validate_homoclinic_extras(setup.extras)?;
    validate_homoclinic_parameter_plane(
        setup.base_params.len(),
        setup.param1_index,
        setup.param2_index,
    )?;
    validate_homoclinic_scalars(setup.guess.time, setup.guess.eps0, setup.guess.eps1)?;
    let dim = system.equations.len();
    if setup.source_basis.dim != dim
        || setup.target_basis.dim != dim
        || setup.source_basis.npos + setup.target_basis.nneg != dim
    {
        bail!("Heteroclinic setup violates the codimension-one index condition");
    }
    if setup.guess.mesh_states.len() != setup.ntst + 1
        || setup.guess.stage_states.len() != setup.ntst
        || setup
            .guess
            .stage_states
            .iter()
            .any(|interval| interval.len() != setup.ncol)
    {
        bail!("Heteroclinic profile layout does not match NTST/NCOL");
    }
    Ok(())
}

impl ContinuationProblem for HeteroclinicProblem<'_> {
    fn dimension(&self) -> usize {
        self.orbit_unknown_count()
            + 2 * self.dim()
            + 1
            + self.setup.extras.free_count()
            + self.source_riccati_size()
            + self.target_riccati_size()
    }

    fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
        open_profile_palc_weights(
            self.dimension() + 1,
            &self.normalized_mesh,
            self.setup.ncol,
            self.dim(),
            &self.coefficients.nodes,
        )
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        if out.len() != self.dimension() {
            bail!("Heteroclinic residual length mismatch");
        }
        let dim = self.dim();
        let decoded = self.decode(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.param2_value)?;
        self.evaluate_stage_flow(&decoded.stage_states, &params)?;
        let duration = 2.0 * decoded.time;
        let mut row = 0usize;

        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            for stage in 0..self.setup.ncol {
                for component in 0..dim {
                    let sum = (0..self.setup.ncol)
                        .map(|other| {
                            self.coefficients.a[stage][other]
                                * self.stage_flow(interval, other)[component]
                        })
                        .sum::<f64>();
                    out[row] = decoded.stage_states[interval][stage][component]
                        - decoded.mesh_states[interval][component]
                        - h * sum;
                    row += 1;
                }
            }
        }
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            for component in 0..dim {
                let sum = (0..self.setup.ncol)
                    .map(|stage| {
                        self.coefficients.b[stage] * self.stage_flow(interval, stage)[component]
                    })
                    .sum::<f64>();
                out[row] = decoded.mesh_states[interval + 1][component]
                    - decoded.mesh_states[interval][component]
                    - h * sum;
                row += 1;
            }
        }

        for value in self.flow_at(&decoded.source_equilibrium, &params)? {
            out[row] = value;
            row += 1;
        }
        for value in self.flow_at(&decoded.target_equilibrium, &params)? {
            out[row] = value;
            row += 1;
        }

        let phase_constraints = self.setup.extras.free_count().saturating_sub(1);
        if phase_constraints > 0 {
            out[row] = self.phase_residual(&decoded.stage_states)?;
            row += 1;
        }

        let source_jacobian = self.jacobian_at(&decoded.source_equilibrium, &params)?;
        let source_q = basis_matrix(&self.setup.source_basis.unstable_q, dim)?;
        let source_yu = DMatrix::from_row_slice(
            self.setup.source_basis.nneg,
            self.setup.source_basis.npos,
            &decoded.source_yu,
        );
        let source_coeff =
            riccati_coeff(&source_q, &source_jacobian, self.setup.source_basis.npos)?;
        let source_residual = &source_coeff.t22 * &source_yu - &source_yu * &source_coeff.t11
            + &source_coeff.e21
            - &source_yu * &source_coeff.t12 * &source_yu;
        for value in source_residual.iter() {
            out[row] = *value;
            row += 1;
        }

        let target_jacobian = self.jacobian_at(&decoded.target_equilibrium, &params)?;
        let target_q = basis_matrix(&self.setup.target_basis.stable_q, dim)?;
        let target_ys = DMatrix::from_row_slice(
            self.setup.target_basis.npos,
            self.setup.target_basis.nneg,
            &decoded.target_ys,
        );
        let target_coeff =
            riccati_coeff(&target_q, &target_jacobian, self.setup.target_basis.nneg)?;
        let target_residual = &target_coeff.t22 * &target_ys - &target_ys * &target_coeff.t11
            + &target_coeff.e21
            - &target_ys * &target_coeff.t12 * &target_ys;
        for value in target_residual.iter() {
            out[row] = *value;
            row += 1;
        }

        let source_delta = vector_sub(&decoded.mesh_states[0], &decoded.source_equilibrium);
        let source_normals = build_unstable_normals(&source_q, &source_yu)?;
        for normal in source_normals.column_iter().rev() {
            out[row] = dot(&source_delta, normal.as_slice());
            row += 1;
        }
        let target_delta = vector_sub(
            decoded
                .mesh_states
                .last()
                .ok_or_else(|| anyhow!("Heteroclinic target endpoint is missing"))?,
            &decoded.target_equilibrium,
        );
        let target_normals = build_stable_normals(&target_q, &target_ys)?;
        for normal in target_normals.column_iter().rev() {
            out[row] = dot(&target_delta, normal.as_slice());
            row += 1;
        }
        out[row] = l2_norm(&source_delta) - decoded.eps0;
        row += 1;
        out[row] = l2_norm(&target_delta) - decoded.eps1;
        row += 1;

        if row != out.len() {
            bail!(
                "Heteroclinic residual assembly mismatch: filled {}, expected {}",
                row,
                out.len()
            );
        }
        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dim = self.dimension();
        let mut baseline = DVector::zeros(dim);
        self.residual(aug_state, &mut baseline)?;
        let mut jacobian = DMatrix::zeros(dim, dim + 1);
        let mut perturbed = aug_state.clone();
        for column in 0..=dim {
            let base = aug_state[column];
            let step = 1.0e-7_f64.max(1.0e-7 * base.abs());
            perturbed[column] = base + step;
            let mut shifted = DVector::zeros(dim);
            self.residual(&perturbed, &mut shifted)?;
            for row in 0..dim {
                jacobian[(row, column)] = (shifted[row] - baseline[row]) / step;
            }
            perturbed[column] = base;
        }
        Ok(jacobian)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let decoded = self.decode(aug_state)?;
        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            // Heteroclinic endpoint spectra are distinct. Keeping this generic
            // slot empty prevents one-saddle bifurcation tests from combining
            // modes that belong to different equilibria.
            eigenvalues: Vec::new(),
            cycle_points: Some(decoded.mesh_states),
        })
    }

    fn heteroclinic_event_diagnostics(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<Option<HeteroclinicEventDiagnostics>> {
        let decoded = self.decode(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.param2_value)?;
        let source_jacobian = self.jacobian_at(&decoded.source_equilibrium, &params)?;
        let target_jacobian = self.jacobian_at(&decoded.target_equilibrium, &params)?;
        let source_eigenvalues = source_jacobian
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let target_eigenvalues = target_jacobian
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let source_endpoint = decoded
            .mesh_states
            .first()
            .ok_or_else(|| anyhow!("Heteroclinic collocation mesh is empty"))?;
        let target_endpoint = decoded
            .mesh_states
            .last()
            .ok_or_else(|| anyhow!("Heteroclinic collocation mesh is empty"))?;
        let orbit_flip = build_heteroclinic_orbit_flip_data(
            &source_jacobian,
            &source_eigenvalues,
            vector_sub(source_endpoint, &decoded.source_equilibrium),
            &target_jacobian,
            &target_eigenvalues,
            vector_sub(target_endpoint, &decoded.target_equilibrium),
        );
        Ok(Some(compute_heteroclinic_event_diagnostics(
            &source_eigenvalues,
            &target_eigenvalues,
            Some(&orbit_flip),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        )))
    }

    fn detect_heteroclinic_events_from_initial_seed(&self) -> bool {
        self.setup.initial_seed_is_corrected
    }

    fn is_step_acceptable(&mut self, aug_state: &DVector<f64>) -> Result<bool> {
        Ok(self
            .collocation_defect_estimate(aug_state)?
            .max_scaled_defect
            <= self.adaptivity.defect_tolerance)
    }

    fn handle_step_rejection(
        &mut self,
        accepted_aug: &DVector<f64>,
        accepted_tangent: &DVector<f64>,
        rejected_aug: &DVector<f64>,
        branch_states: &[Vec<f64>],
    ) -> Result<StepRejectionAction> {
        let estimate = self.collocation_defect_estimate(rejected_aug)?;
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
        let current_attempts = self
            .adaptation_report
            .attempts
            .len()
            .saturating_sub(self.adaptation_transfer_start_index);
        if current_attempts >= self.adaptivity.max_refinements {
            self.record_defect_termination(
                CollocationDefectTerminationReason::RefinementBudgetExhausted,
                estimate.max_scaled_defect,
            );
            return Ok(StepRejectionAction::Terminate);
        }
        let old_ntst = self.setup.ntst;
        let old_mesh = self.normalized_mesh.clone();
        let current_run_attempts = &self.adaptation_report.attempts[self
            .adaptation_transfer_start_index
            .min(self.adaptation_report.attempts.len())..];
        let already_redistributed = current_run_attempts
            .iter()
            .any(|attempt| attempt.kind == CollocationMeshAdaptationKind::Redistribution);
        let redistribution = if self.adaptivity.redistribution_enabled && !already_redistributed {
            let candidate = defect_weighted_normalized_mesh(
                &old_mesh,
                &estimate.interval_scaled_defects,
                self.setup.ncol,
                old_ntst,
            )?;
            meshes_materially_different(&candidate, &old_mesh).then_some(candidate)
        } else {
            None
        };
        let (kind, new_mesh) = if let Some(candidate) = redistribution {
            (CollocationMeshAdaptationKind::Redistribution, candidate)
        } else {
            if old_ntst >= self.adaptivity.max_mesh_points {
                self.record_defect_termination(
                    CollocationDefectTerminationReason::MeshPointLimitReached,
                    estimate.max_scaled_defect,
                );
                return Ok(StepRejectionAction::Terminate);
            }
            let Some(new_ntst) = propose_uniform_mesh_refinement(
                &estimate.interval_scaled_defects,
                self.setup.ncol,
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
                    &old_mesh,
                    &estimate.interval_scaled_defects,
                    self.setup.ncol,
                    new_ntst,
                )?,
            )
        };
        let new_ntst = new_mesh.len() - 1;
        let transferred_aug = transfer_homoclinic_aug(
            accepted_aug,
            &old_mesh,
            &new_mesh,
            self.setup.ncol,
            self.dim(),
            &self.coefficients.nodes,
        )?;
        let transferred_tangent = transfer_homoclinic_aug(
            accepted_tangent,
            &old_mesh,
            &new_mesh,
            self.setup.ncol,
            self.dim(),
            &self.coefficients.nodes,
        )?;
        let transferred_branch_states = branch_states
            .iter()
            .map(|state| {
                transfer_homoclinic_state(
                    state,
                    &old_mesh,
                    &new_mesh,
                    self.setup.ncol,
                    self.dim(),
                    &self.coefficients.nodes,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        self.adaptation_report
            .attempts
            .push(CollocationRefinementAttempt {
                sequence: self.adaptation_report.attempts.len() + 1,
                kind,
                old_mesh_points: old_ntst,
                new_mesh_points: new_ntst,
                degree: self.setup.ncol,
                trigger_defect: estimate.max_scaled_defect,
                tolerance: self.adaptivity.defect_tolerance,
                interval_scaled_defects: estimate.interval_scaled_defects,
                old_normalized_mesh: old_mesh,
                new_normalized_mesh: new_mesh.clone(),
            });
        self.replace_mesh(new_mesh, &transferred_aug)?;
        Ok(StepRejectionAction::Refined {
            accepted_aug: transferred_aug,
            accepted_tangent: transferred_tangent,
            branch_states: transferred_branch_states,
            branch_type: Some(self.branch_type_metadata()),
        })
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
        let params = self.current_params(corrected_aug[0], decoded.param2_value)?;
        let Ok(source_basis) =
            compute_homoclinic_basis(self.system, &decoded.source_equilibrium, &params)
        else {
            return Ok(None);
        };
        let Ok(target_basis) =
            compute_homoclinic_basis(self.system, &decoded.target_equilibrium, &params)
        else {
            return Ok(None);
        };
        let Ok(transform) = HeteroclinicChartTransform::new(
            &self.setup.source_basis,
            &source_basis,
            &self.setup.target_basis,
            &target_basis,
        ) else {
            return Ok(None);
        };
        let prepared = (|| -> Result<PostCorrectorReparameterization> {
            Ok(PostCorrectorReparameterization {
                previous_aug: DVector::from_vec(
                    transform.transform_values(previous_aug.as_slice())?,
                ),
                corrected_aug: DVector::from_vec(
                    transform.transform_values(corrected_aug.as_slice())?,
                ),
                previous_tangent: transform.transform_tangent(previous_aug, previous_tangent)?,
                branch_states: branch_states
                    .iter()
                    .map(|state| transform.transform_values(state))
                    .collect::<Result<Vec<_>>>()?,
                active_seeds: active_seeds
                    .iter()
                    .map(|seed| {
                        Ok(ReparameterizationSeed {
                            aug_state: DVector::from_vec(
                                transform.transform_values(seed.aug_state.as_slice())?,
                            ),
                            tangent: transform.transform_tangent(&seed.aug_state, &seed.tangent)?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?,
            })
        })();
        let Ok(prepared) = prepared else {
            return Ok(None);
        };
        self.setup.source_basis = source_basis;
        self.setup.target_basis = target_basis;
        self.chart_transforms.push(transform);
        self.accepted_steps_since_projector_refresh = 0;
        Ok(Some(prepared))
    }

    fn transfer_branch_states_to_current_discretization(
        &self,
        branch_states: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        let attempts = &self.adaptation_report.attempts[self
            .adaptation_transfer_start_index
            .min(self.adaptation_report.attempts.len())..];
        let mut transferred = branch_states.to_vec();
        for attempt in attempts {
            transferred = transferred
                .iter()
                .map(|state| {
                    transfer_homoclinic_state(
                        state,
                        &attempt.old_normalized_mesh,
                        &attempt.new_normalized_mesh,
                        self.setup.ncol,
                        self.dim(),
                        &self.coefficients.nodes,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
        }
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
        let mut augmented = DVector::zeros(self.dimension() + 1);
        augmented[0] = point.param_value;
        augmented.as_mut_slice()[1..].copy_from_slice(&point.state);
        point.cycle_points = Some(self.decode(&augmented)?.mesh_states);
        Ok(())
    }

    fn transfer_endpoint_seeds_to_current_coordinates(
        &self,
        seeds: &[ReparameterizationSeed],
    ) -> Result<Vec<ReparameterizationSeed>> {
        let attempts = &self.adaptation_report.attempts[self
            .adaptation_transfer_start_index
            .min(self.adaptation_report.attempts.len())..];
        let mut transferred = seeds.to_vec();
        for attempt in attempts {
            transferred = transferred
                .iter()
                .map(|seed| {
                    Ok(ReparameterizationSeed {
                        aug_state: transfer_homoclinic_aug(
                            &seed.aug_state,
                            &attempt.old_normalized_mesh,
                            &attempt.new_normalized_mesh,
                            self.setup.ncol,
                            self.dim(),
                            &self.coefficients.nodes,
                        )?,
                        tangent: transfer_homoclinic_aug(
                            &seed.tangent,
                            &attempt.old_normalized_mesh,
                            &attempt.new_normalized_mesh,
                            self.setup.ncol,
                            self.dim(),
                            &self.coefficients.nodes,
                        )?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
        }
        for transform in &self.chart_transforms {
            transferred = transferred
                .iter()
                .map(|seed| {
                    Ok(ReparameterizationSeed {
                        aug_state: DVector::from_vec(
                            transform.transform_values(seed.aug_state.as_slice())?,
                        ),
                        tangent: transform.transform_tangent(&seed.aug_state, &seed.tangent)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
        }
        Ok(transferred)
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        let decoded = self.decode(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.param2_value)?;
        self.set_phase_reference(&decoded.stage_states, &params, decoded.time)?;
        self.setup.guess.mesh_states = decoded.mesh_states;
        self.setup.guess.stage_states = decoded.stage_states;
        self.setup.guess.source_equilibrium = decoded.source_equilibrium;
        self.setup.guess.target_equilibrium = decoded.target_equilibrium;
        self.setup.guess.param1_value = aug_state[0];
        self.setup.guess.param2_value = decoded.param2_value;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.setup.guess.source_yu = decoded.source_yu;
        self.setup.guess.target_ys = decoded.target_ys;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HeteroclinicChartTransform {
    old_source: HomoclinicBasis,
    new_source: HomoclinicBasis,
    old_target: HomoclinicBasis,
    new_target: HomoclinicBasis,
}

impl HeteroclinicChartTransform {
    pub(crate) fn new(
        old_source: &HomoclinicBasis,
        new_source: &HomoclinicBasis,
        old_target: &HomoclinicBasis,
        new_target: &HomoclinicBasis,
    ) -> Result<Self> {
        for (label, old, new) in [
            ("source", old_source, new_source),
            ("target", old_target, new_target),
        ] {
            if old.dim != new.dim
                || old.nneg != new.nneg
                || old.npos != new.npos
                || old.nneg == 0
                || old.npos == 0
            {
                bail!("Heteroclinic {label} chart changed invariant-subspace dimensions");
            }
        }
        Ok(Self {
            old_source: old_source.clone(),
            new_source: new_source.clone(),
            old_target: old_target.clone(),
            new_target: new_target.clone(),
        })
    }

    pub(crate) fn transform_values(&self, values: &[f64]) -> Result<Vec<f64>> {
        let source_size = self.old_source.nneg * self.old_source.npos;
        let target_size = self.old_target.nneg * self.old_target.npos;
        if values.len() < source_size + target_size {
            bail!("Heteroclinic state is too short for a two-endpoint chart refresh");
        }
        let tail = values.len() - source_size - target_size;
        let source_yu = DMatrix::from_row_slice(
            self.old_source.nneg,
            self.old_source.npos,
            &values[tail..tail + source_size],
        );
        let target_ys = DMatrix::from_row_slice(
            self.old_target.npos,
            self.old_target.nneg,
            &values[tail + source_size..],
        );
        let transformed_source = transform_graph_coordinates(
            &basis_matrix(&self.old_source.unstable_q, self.old_source.dim)?,
            &basis_matrix(&self.new_source.unstable_q, self.new_source.dim)?,
            &source_yu,
            self.old_source.npos,
            self.old_source.nneg,
        )?;
        let transformed_target = transform_graph_coordinates(
            &basis_matrix(&self.old_target.stable_q, self.old_target.dim)?,
            &basis_matrix(&self.new_target.stable_q, self.new_target.dim)?,
            &target_ys,
            self.old_target.nneg,
            self.old_target.npos,
        )?;
        let mut transformed = values.to_vec();
        let mut index = tail;
        for row in 0..transformed_source.nrows() {
            for column in 0..transformed_source.ncols() {
                transformed[index] = transformed_source[(row, column)];
                index += 1;
            }
        }
        for row in 0..transformed_target.nrows() {
            for column in 0..transformed_target.ncols() {
                transformed[index] = transformed_target[(row, column)];
                index += 1;
            }
        }
        Ok(transformed)
    }

    pub(crate) fn transform_tangent(
        &self,
        augmented: &DVector<f64>,
        tangent: &DVector<f64>,
    ) -> Result<DVector<f64>> {
        if augmented.len() != tangent.len() {
            bail!("Heteroclinic chart tangent dimension mismatch");
        }
        let source_size = self.old_source.nneg * self.old_source.npos;
        let target_size = self.old_target.nneg * self.old_target.npos;
        let tail = augmented
            .len()
            .checked_sub(source_size + target_size)
            .ok_or_else(|| anyhow!("Heteroclinic tangent is too short for chart refresh"))?;
        let direction_norm = tangent
            .rows(tail, source_size + target_size)
            .norm()
            .max(1.0);
        let step = 1.0e-6 / direction_norm;
        let mut plus = augmented.clone();
        let mut minus = augmented.clone();
        for index in tail..augmented.len() {
            plus[index] += step * tangent[index];
            minus[index] -= step * tangent[index];
        }
        let plus = self.transform_values(plus.as_slice())?;
        let minus = self.transform_values(minus.as_slice())?;
        let mut transformed = tangent.clone();
        for index in tail..augmented.len() {
            transformed[index] = (plus[index] - minus[index]) / (2.0 * step);
        }
        if transformed.iter().any(|value| !value.is_finite()) {
            bail!("Heteroclinic chart produced a non-finite tangent");
        }
        Ok(transformed)
    }
}

fn transform_graph_coordinates(
    old_basis: &DMatrix<f64>,
    new_basis: &DMatrix<f64>,
    old_graph: &DMatrix<f64>,
    leading_dim: usize,
    trailing_dim: usize,
) -> Result<DMatrix<f64>> {
    let dim = leading_dim + trailing_dim;
    if old_basis.shape() != (dim, dim)
        || new_basis.shape() != (dim, dim)
        || old_graph.shape() != (trailing_dim, leading_dim)
    {
        bail!("Heteroclinic graph-coordinate dimensions do not match their endpoint basis");
    }
    let mut graph = DMatrix::zeros(dim, trailing_dim);
    for row in 0..leading_dim {
        for column in 0..trailing_dim {
            graph[(row, column)] = -old_graph[(column, row)];
        }
    }
    for index in 0..trailing_dim {
        graph[(leading_dim + index, index)] = 1.0;
    }
    let in_new_chart = new_basis.transpose() * old_basis * graph;
    let top = in_new_chart.rows(0, leading_dim).into_owned();
    let bottom = in_new_chart.rows(leading_dim, trailing_dim).into_owned();
    let singular_values = bottom.clone().svd(false, false).singular_values;
    let largest = singular_values.iter().copied().fold(0.0_f64, f64::max);
    let smallest = singular_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    if !largest.is_finite()
        || !smallest.is_finite()
        || smallest <= 1.0e-10 * largest.max(1.0)
        || largest / smallest > 1.0e10
    {
        bail!("Heteroclinic endpoint chart refresh is rank-deficient or ill-conditioned");
    }
    let solved = bottom
        .transpose()
        .lu()
        .solve(&top.transpose())
        .ok_or_else(|| anyhow!("Heteroclinic graph-coordinate solve failed"))?;
    Ok(-solved.transpose())
}

pub(crate) struct RiccatiCoefficients {
    pub(crate) t11: DMatrix<f64>,
    pub(crate) t12: DMatrix<f64>,
    pub(crate) e21: DMatrix<f64>,
    pub(crate) t22: DMatrix<f64>,
}

pub(crate) fn basis_matrix(values: &[f64], dim: usize) -> Result<DMatrix<f64>> {
    if values.len() != dim * dim {
        bail!("Heteroclinic basis matrix has invalid dimensions");
    }
    Ok(DMatrix::from_column_slice(dim, dim, values))
}

pub(crate) fn riccati_coeff(
    basis: &DMatrix<f64>,
    jacobian: &DMatrix<f64>,
    invariant_dim: usize,
) -> Result<RiccatiCoefficients> {
    let transformed = basis.transpose() * jacobian * basis;
    if invariant_dim == 0 || invariant_dim >= transformed.nrows() {
        bail!("Heteroclinic invariant-subspace dimension is invalid");
    }
    Ok(RiccatiCoefficients {
        t11: transformed
            .view((0, 0), (invariant_dim, invariant_dim))
            .into_owned(),
        t12: transformed
            .view(
                (0, invariant_dim),
                (invariant_dim, transformed.ncols() - invariant_dim),
            )
            .into_owned(),
        e21: transformed
            .view(
                (invariant_dim, 0),
                (transformed.nrows() - invariant_dim, invariant_dim),
            )
            .into_owned(),
        t22: transformed
            .view(
                (invariant_dim, invariant_dim),
                (
                    transformed.nrows() - invariant_dim,
                    transformed.ncols() - invariant_dim,
                ),
            )
            .into_owned(),
    })
}

pub(crate) fn build_unstable_normals(
    basis: &DMatrix<f64>,
    yu: &DMatrix<f64>,
) -> Result<DMatrix<f64>> {
    let stable_dim = yu.nrows();
    let unstable_dim = yu.ncols();
    if basis.shape() != (stable_dim + unstable_dim, stable_dim + unstable_dim) {
        bail!("Heteroclinic source basis dimensions do not match its Riccati state");
    }
    let mut graph = DMatrix::zeros(stable_dim + unstable_dim, stable_dim);
    for row in 0..unstable_dim {
        for column in 0..stable_dim {
            graph[(row, column)] = -yu[(column, row)];
        }
    }
    for index in 0..stable_dim {
        graph[(unstable_dim + index, index)] = 1.0;
    }
    Ok(basis * graph)
}

pub(crate) fn build_stable_normals(
    basis: &DMatrix<f64>,
    ys: &DMatrix<f64>,
) -> Result<DMatrix<f64>> {
    let unstable_dim = ys.nrows();
    let stable_dim = ys.ncols();
    if basis.shape() != (stable_dim + unstable_dim, stable_dim + unstable_dim) {
        bail!("Heteroclinic target basis dimensions do not match its Riccati state");
    }
    let mut graph = DMatrix::zeros(stable_dim + unstable_dim, unstable_dim);
    for row in 0..stable_dim {
        for column in 0..unstable_dim {
            graph[(row, column)] = -ys[(column, row)];
        }
    }
    for index in 0..unstable_dim {
        graph[(stable_dim + index, index)] = 1.0;
    }
    Ok(basis * graph)
}

pub(crate) fn invariant_graph_frame(
    basis: &DMatrix<f64>,
    invariant_dim: usize,
    graph_coordinates: &DMatrix<f64>,
) -> Result<DMatrix<f64>> {
    let dim = basis.nrows();
    if dim == 0
        || basis.ncols() != dim
        || invariant_dim == 0
        || invariant_dim >= dim
        || graph_coordinates.shape() != (dim - invariant_dim, invariant_dim)
    {
        bail!("Heteroclinic invariant graph dimensions are inconsistent");
    }
    let mut graph = DMatrix::zeros(dim, invariant_dim);
    for index in 0..invariant_dim {
        graph[(index, index)] = 1.0;
    }
    graph
        .view_mut((invariant_dim, 0), (dim - invariant_dim, invariant_dim))
        .copy_from(graph_coordinates);
    Ok(basis * graph)
}

fn vector_sub(left: &[f64], right: &[f64]) -> Vec<f64> {
    left.iter()
        .zip(right)
        .map(|(left, right)| left - right)
        .collect()
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum()
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{parse, Compiler};

    fn analytic_system() -> EquationSystem {
        let variables = vec!["x".to_owned(), "y".to_owned()];
        let parameters = vec!["mu".to_owned(), "nu".to_owned()];
        let compiler = Compiler::new(&variables, &parameters);
        let equations = ["1-x^2", "x*y+(mu-nu)*(1-x^2)"];
        let bytecode = equations
            .iter()
            .map(|equation| compiler.compile(&parse(equation).expect("parse oracle")))
            .collect();
        let mut system = EquationSystem::new(bytecode, vec![0.0, 0.0]);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    fn analytic_seed() -> HeteroclinicOrbitSeed {
        let times = (-20..=20)
            .map(|index| index as f64 / 4.0)
            .collect::<Vec<_>>();
        let states = times.iter().map(|time| vec![time.tanh(), 0.0]).collect();
        HeteroclinicOrbitSeed {
            times,
            states,
            source_equilibrium: vec![-1.0, 0.0],
            target_equilibrium: vec![1.0, 0.0],
        }
    }

    #[test]
    fn source_and_target_projector_charts_refresh_atomically() {
        let mut system = analytic_system();
        let mut setup = heteroclinic_setup_from_orbit(
            &mut system,
            &analytic_seed(),
            4,
            2,
            &[0.0, 0.0],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        )
        .expect("heteroclinic setup");
        setup.projector_refresh_interval = 1;
        let state = pack_heteroclinic_state(&setup);
        let mut augmented = DVector::zeros(state.len() + 1);
        augmented.as_mut_slice()[1..].copy_from_slice(&state);
        let tangent = DVector::zeros(augmented.len());
        let mut problem = HeteroclinicProblem::new(&mut system, setup).expect("problem");

        let refreshed = problem
            .reparameterize_after_step(
                &augmented,
                &augmented,
                &tangent,
                std::slice::from_ref(&state),
                &[],
            )
            .expect("chart refresh")
            .expect("refresh should be due");
        assert_eq!(problem.projector_refresh_count(), 1);
        assert_eq!(refreshed.branch_states.len(), 1);
        assert!(refreshed
            .corrected_aug
            .iter()
            .all(|value| value.is_finite()));
    }
}
