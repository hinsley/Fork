//! Standard single- and multiple-shooting for genuine two-equilibrium
//! heteroclinic curves.
//!
//! This formulation intentionally owns a separate versioned setup from the
//! one-saddle homoclinic path. It stores `M + 1` orbit nodes, two independent
//! equilibria, and two independent invariant-subspace charts. `M = 1` is
//! single shooting and `M > 1` is multiple shooting.

use super::heteroclinic::{
    basis_matrix, build_stable_normals, build_unstable_normals, invariant_graph_frame,
    riccati_coeff, HeteroclinicChartTransform, HeteroclinicSetupV1, HETEROCLINIC_SCHEMA_VERSION,
};
use super::heteroclinic_events::{
    build_heteroclinic_orbit_flip_data, compute_heteroclinic_event_diagnostics,
    HeteroclinicEventDiagnostics, DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
};
use super::heteroclinic_transport::{
    transport_source_inclination, transport_target_inclination, InclinationFrameData,
};
use super::homoclinic_init::{
    compute_homoclinic_basis, validate_homoclinic_extras, validate_homoclinic_parameter_plane,
    validate_homoclinic_scalars, HomoclinicBasis, HomoclinicExtraFlags,
    DEFAULT_PROJECTOR_REFRESH_INTERVAL,
};
use super::periodic::CollocationCoefficients;
use super::problem::{
    ContinuationProblem, PointDiagnostics, PostCorrectorReparameterization, ReparameterizationSeed,
    TestFunctionValues,
};
use super::{
    continue_with_problem, extend_branch_with_problem, BifurcationType, BranchType,
    ContinuationBranch, ContinuationPoint, ContinuationSettings, HeteroclinicConnectionSchemaV1,
    HomoclinicBasisSnapshot, HomoclinicDiscretization,
};
use crate::autodiff::TangentSystem;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::solvers::Tsit5;
use crate::traits::{DynamicalSystem, Steppable};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

const DEFAULT_STEPS_PER_SEGMENT: usize = 64;
const PROJECTOR_REFRESH_ANGLE_THRESHOLD: f64 = std::f64::consts::PI / 9.0;

fn default_steps_per_segment() -> usize {
    DEFAULT_STEPS_PER_SEGMENT
}

fn default_projector_refresh_interval() -> usize {
    DEFAULT_PROJECTOR_REFRESH_INTERVAL
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct HeteroclinicShootingSettings {
    /// Number of equal-duration shooting segments. One is single shooting.
    pub intervals: usize,
    /// Fixed Tsitouras-5 steps used for each segment flow map.
    pub integration_steps_per_segment: usize,
}

impl Default for HeteroclinicShootingSettings {
    fn default() -> Self {
        Self {
            intervals: 8,
            integration_steps_per_segment: default_steps_per_segment(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeteroclinicShootingGuess {
    pub nodes: Vec<Vec<f64>>,
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
pub struct HeteroclinicShootingSetupV1 {
    pub schema_version: u32,
    pub guess: HeteroclinicShootingGuess,
    #[serde(default)]
    pub initial_seed_is_corrected: bool,
    pub shooting: HeteroclinicShootingSettings,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_name: String,
    pub param2_name: String,
    pub base_params: Vec<f64>,
    pub extras: HomoclinicExtraFlags,
    pub source_basis: HomoclinicBasis,
    pub target_basis: HomoclinicBasis,
    #[serde(default = "default_projector_refresh_interval")]
    pub projector_refresh_interval: usize,
}

impl HeteroclinicShootingSetupV1 {
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

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedHeteroclinicShootingState {
    pub nodes: Vec<Vec<f64>>,
    pub source_equilibrium: Vec<f64>,
    pub target_equilibrium: Vec<f64>,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub source_yu: Vec<f64>,
    pub target_ys: Vec<f64>,
}

pub fn pack_heteroclinic_shooting_state(setup: &HeteroclinicShootingSetupV1) -> Vec<f64> {
    let mut state = Vec::new();
    state.extend(setup.guess.nodes.iter().flatten().copied());
    state.extend_from_slice(&setup.guess.source_equilibrium);
    state.extend_from_slice(&setup.guess.target_equilibrium);
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
    state.extend_from_slice(&setup.guess.source_yu);
    state.extend_from_slice(&setup.guess.target_ys);
    state
}

pub fn decode_heteroclinic_shooting_state(
    state: &[f64],
    setup: &HeteroclinicShootingSetupV1,
) -> Result<DecodedHeteroclinicShootingState> {
    let dim = setup.source_basis.dim;
    let node_len = (setup.shooting.intervals + 1) * dim;
    let source_size = setup.source_basis.nneg * setup.source_basis.npos;
    let target_size = setup.target_basis.nneg * setup.target_basis.npos;
    let expected = node_len + 2 * dim + 1 + setup.extras.free_count() + source_size + target_size;
    if state.len() != expected {
        bail!(
            "Invalid heteroclinic shooting state length: expected {}, got {}",
            expected,
            state.len()
        );
    }
    let mut offset = 0usize;
    let nodes = state[offset..offset + node_len]
        .chunks(dim)
        .map(|node| node.to_vec())
        .collect();
    offset += node_len;
    let source_equilibrium = state[offset..offset + dim].to_vec();
    offset += dim;
    let target_equilibrium = state[offset..offset + dim].to_vec();
    offset += dim;
    let param2_value = state[offset];
    offset += 1;
    let time = if setup.extras.free_time {
        let value = state[offset];
        offset += 1;
        value
    } else {
        setup.guess.time
    };
    let eps0 = if setup.extras.free_eps0 {
        let value = state[offset];
        offset += 1;
        value
    } else {
        setup.guess.eps0
    };
    let eps1 = if setup.extras.free_eps1 {
        let value = state[offset];
        offset += 1;
        value
    } else {
        setup.guess.eps1
    };
    let source_yu = state[offset..offset + source_size].to_vec();
    offset += source_size;
    let target_ys = state[offset..offset + target_size].to_vec();
    validate_homoclinic_scalars(time, eps0, eps1)?;
    Ok(DecodedHeteroclinicShootingState {
        nodes,
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

pub fn heteroclinic_shooting_setup_from_collocation(
    source: &HeteroclinicSetupV1,
    shooting: HeteroclinicShootingSettings,
) -> Result<HeteroclinicShootingSetupV1> {
    validate_shooting_settings(shooting)?;
    if source.guess.mesh_states.len() != source.ntst + 1
        || source.guess.stage_states.len() != source.ntst
    {
        bail!("Source heteroclinic collocation profile is incomplete");
    }
    let coefficients = CollocationCoefficients::new(source.ncol)?;
    let mesh = source.resolved_normalized_mesh()?;
    let mut times = vec![0.0];
    let mut states = vec![source.guess.mesh_states[0].clone()];
    for interval in 0..source.ntst {
        if source.guess.stage_states[interval].len() != source.ncol {
            bail!("Source heteroclinic collocation stages are incomplete");
        }
        let left = mesh[interval];
        let width = mesh[interval + 1] - left;
        for (stage, node) in coefficients.nodes.iter().copied().enumerate() {
            times.push(left + width * node);
            states.push(source.guess.stage_states[interval][stage].clone());
        }
        times.push(mesh[interval + 1]);
        states.push(source.guess.mesh_states[interval + 1].clone());
    }
    let nodes = (0..=shooting.intervals)
        .map(|index| interpolate_state(index as f64 / shooting.intervals as f64, &times, &states))
        .collect::<Result<Vec<_>>>()?;
    Ok(HeteroclinicShootingSetupV1 {
        schema_version: source.schema_version,
        guess: HeteroclinicShootingGuess {
            nodes,
            source_equilibrium: source.guess.source_equilibrium.clone(),
            target_equilibrium: source.guess.target_equilibrium.clone(),
            param1_value: source.guess.param1_value,
            param2_value: source.guess.param2_value,
            time: source.guess.time,
            eps0: source.guess.eps0,
            eps1: source.guess.eps1,
            source_yu: source.guess.source_yu.clone(),
            target_ys: source.guess.target_ys.clone(),
        },
        initial_seed_is_corrected: source.initial_seed_is_corrected,
        shooting,
        param1_index: source.param1_index,
        param2_index: source.param2_index,
        param1_name: source.param1_name.clone(),
        param2_name: source.param2_name.clone(),
        base_params: source.base_params.clone(),
        extras: source.extras,
        source_basis: source.source_basis.clone(),
        target_basis: source.target_basis.clone(),
        projector_refresh_interval: source.projector_refresh_interval,
    })
}

pub fn heteroclinic_shooting_setup_from_point(
    point: &ContinuationPoint,
    branch_type: &BranchType,
) -> Result<HeteroclinicShootingSetupV1> {
    let BranchType::HeteroclinicCurve {
        schema,
        ntst,
        ncol,
        discretization,
        param1_name,
        param2_name,
        free_time,
        free_eps0,
        free_eps1,
        ..
    } = branch_type
    else {
        bail!("Heteroclinic shooting restart requires HeteroclinicCurve metadata");
    };
    let HomoclinicDiscretization::Shooting {
        integration_steps_per_segment,
    } = discretization
    else {
        bail!("Heteroclinic shooting restart requires shooting metadata");
    };
    if *ncol != 0 || *ntst == 0 {
        bail!("Heteroclinic shooting metadata has an invalid node layout");
    }
    if schema.schema_version != HETEROCLINIC_SCHEMA_VERSION {
        bail!(
            "Unsupported heteroclinic schema version {}",
            schema.schema_version
        );
    }
    validate_homoclinic_parameter_plane(
        schema.base_params.len(),
        schema.param1_index,
        schema.param2_index,
    )?;
    let source_basis = basis_from_snapshot(&schema.source_basis);
    let target_basis = basis_from_snapshot(&schema.target_basis);
    let extras = HomoclinicExtraFlags {
        free_time: *free_time,
        free_eps0: *free_eps0,
        free_eps1: *free_eps1,
    };
    let mut setup = HeteroclinicShootingSetupV1 {
        schema_version: schema.schema_version,
        guess: HeteroclinicShootingGuess {
            nodes: Vec::new(),
            source_equilibrium: Vec::new(),
            target_equilibrium: Vec::new(),
            param1_value: point.param_value,
            param2_value: schema.base_params[schema.param2_index],
            time: schema.fixed_time,
            eps0: schema.fixed_eps0,
            eps1: schema.fixed_eps1,
            source_yu: Vec::new(),
            target_ys: Vec::new(),
        },
        initial_seed_is_corrected: true,
        shooting: HeteroclinicShootingSettings {
            intervals: *ntst,
            integration_steps_per_segment: *integration_steps_per_segment,
        },
        param1_index: schema.param1_index,
        param2_index: schema.param2_index,
        param1_name: param1_name.clone(),
        param2_name: param2_name.clone(),
        base_params: schema.base_params.clone(),
        extras,
        source_basis,
        target_basis,
        projector_refresh_interval: schema.projector_refresh_interval,
    };
    let decoded = decode_heteroclinic_shooting_state(&point.state, &setup)?;
    setup.guess = HeteroclinicShootingGuess {
        nodes: decoded.nodes,
        source_equilibrium: decoded.source_equilibrium,
        target_equilibrium: decoded.target_equilibrium,
        param1_value: point.param_value,
        param2_value: decoded.param2_value,
        time: decoded.time,
        eps0: decoded.eps0,
        eps1: decoded.eps1,
        source_yu: decoded.source_yu,
        target_ys: decoded.target_ys,
    };
    Ok(setup)
}

pub fn continue_heteroclinic_shooting_curve(
    system: &mut EquationSystem,
    setup: HeteroclinicShootingSetupV1,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let initial_point = ContinuationPoint {
        state: pack_heteroclinic_shooting_state(&setup),
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: Some(setup.guess.nodes.clone()),
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut problem = HeteroclinicShootingProblem::new(system, setup)?;
    let mut branch = continue_with_problem(&mut problem, initial_point, settings, forward)?;
    branch.branch_type = problem.branch_type_metadata();
    Ok(branch)
}

pub fn extend_heteroclinic_shooting_curve(
    system: &mut EquationSystem,
    branch: ContinuationBranch,
    settings: ContinuationSettings,
    extend_forward: bool,
) -> Result<ContinuationBranch> {
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
    .ok_or_else(|| anyhow!("Cannot extend an empty heteroclinic shooting branch"))?;
    let setup =
        heteroclinic_shooting_setup_from_point(&branch.points[endpoint], &branch.branch_type)?;
    let mut problem = HeteroclinicShootingProblem::new(system, setup)?;
    let mut extended = extend_branch_with_problem(&mut problem, branch, settings, extend_forward)?;
    extended.branch_type = problem.branch_type_metadata();
    Ok(extended)
}

pub struct HeteroclinicShootingProblem<'a> {
    system: &'a mut EquationSystem,
    setup: HeteroclinicShootingSetupV1,
    section_index: usize,
    section_center: Vec<f64>,
    section_normal: Vec<f64>,
    accepted_steps_since_projector_refresh: usize,
    chart_transforms: Vec<HeteroclinicChartTransform>,
}

impl<'a> HeteroclinicShootingProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, setup: HeteroclinicShootingSetupV1) -> Result<Self> {
        validate_setup(system, &setup)?;
        let params = resolved_params(&setup, setup.guess.param1_value, setup.guess.param2_value)?;
        let section_index = max_flow_node_index(system, &params, &setup.guess.nodes)?;
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

    pub fn setup(&self) -> &HeteroclinicShootingSetupV1 {
        &self.setup
    }

    pub fn branch_type_metadata(&self) -> BranchType {
        BranchType::HeteroclinicCurve {
            schema: self.setup.connection_schema(),
            ntst: self.setup.shooting.intervals,
            ncol: 0,
            discretization: HomoclinicDiscretization::Shooting {
                integration_steps_per_segment: self.setup.shooting.integration_steps_per_segment,
            },
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            param1_name: self.setup.param1_name.clone(),
            param2_name: self.setup.param2_name.clone(),
            free_time: self.setup.extras.free_time,
            free_eps0: self.setup.extras.free_eps0,
            free_eps1: self.setup.extras.free_eps1,
        }
    }

    fn dim(&self) -> usize {
        self.setup.source_basis.dim
    }

    fn source_riccati_size(&self) -> usize {
        self.setup.source_basis.nneg * self.setup.source_basis.npos
    }

    fn target_riccati_size(&self) -> usize {
        self.setup.target_basis.nneg * self.setup.target_basis.npos
    }

    fn params(&self, p1: f64, p2: f64) -> Result<Vec<f64>> {
        resolved_params(&self.setup, p1, p2)
    }

    fn decode(&self, augmented: &DVector<f64>) -> Result<DecodedHeteroclinicShootingState> {
        decode_heteroclinic_shooting_state(&augmented.as_slice()[1..], &self.setup)
    }

    fn with_params<F, R>(&mut self, params: &[f64], mut operation: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        let old = self.system.params.clone();
        if old.len() != params.len() {
            bail!("Heteroclinic shooting parameter vector length mismatch");
        }
        self.system.params.copy_from_slice(params);
        let result = operation(self.system);
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

    fn jacobian_at(&mut self, state: &[f64], params: &[f64]) -> Result<DMatrix<f64>> {
        let dim = self.dim();
        let values = self.with_params(params, |system| {
            compute_jacobian(system, SystemKind::Flow, state)
        })?;
        Ok(DMatrix::from_row_slice(dim, dim, &values))
    }

    fn inclination_frames(
        &mut self,
        decoded: &DecodedHeteroclinicShootingState,
        params: &[f64],
    ) -> Result<(Option<InclinationFrameData>, Option<InclinationFrameData>)> {
        let dim = self.dim();
        let source_unstable_q = basis_matrix(&self.setup.source_basis.unstable_q, dim)?;
        let source_yu = DMatrix::from_row_slice(
            self.setup.source_basis.nneg,
            self.setup.source_basis.npos,
            &decoded.source_yu,
        );
        let source_unstable =
            invariant_graph_frame(&source_unstable_q, self.setup.source_basis.npos, &source_yu)?;
        let target_stable_q = basis_matrix(&self.setup.target_basis.stable_q, dim)?;
        let target_ys = DMatrix::from_row_slice(
            self.setup.target_basis.npos,
            self.setup.target_basis.nneg,
            &decoded.target_ys,
        );
        let target_stable =
            invariant_graph_frame(&target_stable_q, self.setup.target_basis.nneg, &target_ys)?;
        let target_unstable_q = basis_matrix(&self.setup.target_basis.unstable_q, dim)?;
        let source_stable_q = basis_matrix(&self.setup.source_basis.stable_q, dim)?;
        let source_endpoint = decoded
            .nodes
            .first()
            .ok_or_else(|| anyhow!("Heteroclinic shooting nodes are empty"))?;
        let target_endpoint = decoded
            .nodes
            .last()
            .ok_or_else(|| anyhow!("Heteroclinic shooting nodes are empty"))?;
        let source_flow = DVector::from_vec(flow_at(self.system, params, source_endpoint)?);
        let target_flow = DVector::from_vec(flow_at(self.system, params, target_endpoint)?);
        let segment_duration = 2.0 * decoded.time / self.setup.shooting.intervals as f64;
        let (maps, residuals) = heteroclinic_shooting_interval_maps(
            self.system,
            &decoded.nodes,
            segment_duration,
            self.setup.shooting.integration_steps_per_segment,
            params,
        )?;

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

    fn projector_chart_angle(&self, decoded: &DecodedHeteroclinicShootingState) -> f64 {
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
        matrix_norm(&source).max(matrix_norm(&target)).atan()
    }

    fn transform_seed(
        transform: &HeteroclinicChartTransform,
        seed: &ReparameterizationSeed,
    ) -> Result<ReparameterizationSeed> {
        Ok(ReparameterizationSeed {
            aug_state: DVector::from_vec(transform.transform_values(seed.aug_state.as_slice())?),
            tangent: transform.transform_tangent(&seed.aug_state, &seed.tangent)?,
        })
    }
}

impl ContinuationProblem for HeteroclinicShootingProblem<'_> {
    fn dimension(&self) -> usize {
        (self.setup.shooting.intervals + 1) * self.dim()
            + 2 * self.dim()
            + 1
            + self.setup.extras.free_count()
            + self.source_riccati_size()
            + self.target_riccati_size()
    }

    fn residual(&mut self, augmented: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        if out.len() != self.dimension() {
            bail!("Heteroclinic shooting residual length mismatch");
        }
        let decoded = self.decode(augmented)?;
        let params = self.params(augmented[0], decoded.param2_value)?;
        let dim = self.dim();
        let segment_duration = 2.0 * decoded.time / self.setup.shooting.intervals as f64;
        let mut row = 0usize;

        for segment in 0..self.setup.shooting.intervals {
            let flowed =
                self.integrate_segment(&decoded.nodes[segment], segment_duration, &params)?;
            for component in 0..dim {
                out[row] = flowed[component] - decoded.nodes[segment + 1][component];
                row += 1;
            }
        }

        for equilibrium in [&decoded.source_equilibrium, &decoded.target_equilibrium] {
            let flow = self.with_params(&params, |system| {
                let mut output = vec![0.0; dim];
                system.apply(0.0, equilibrium, &mut output);
                Ok(output)
            })?;
            for value in flow {
                out[row] = value;
                row += 1;
            }
        }

        if self.setup.extras.free_count() == 2 {
            let node = &decoded.nodes[self.section_index.min(decoded.nodes.len() - 1)];
            out[row] = dot(
                &vector_sub(node, &self.section_center),
                &self.section_normal,
            );
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

        let source_delta = vector_sub(&decoded.nodes[0], &decoded.source_equilibrium);
        let source_normals = build_unstable_normals(&source_q, &source_yu)?;
        for normal in source_normals.column_iter().rev() {
            out[row] = dot(&source_delta, normal.as_slice());
            row += 1;
        }
        let target_delta = vector_sub(
            decoded
                .nodes
                .last()
                .ok_or_else(|| anyhow!("Heteroclinic shooting target node is missing"))?,
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
                "Heteroclinic shooting residual assembly mismatch: filled {}, expected {}",
                row,
                out.len()
            );
        }
        Ok(())
    }

    fn extended_jacobian(&mut self, augmented: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dimension = self.dimension();
        let mut baseline = DVector::zeros(dimension);
        self.residual(augmented, &mut baseline)?;
        let mut jacobian = DMatrix::zeros(dimension, dimension + 1);
        let mut shifted_augmented = augmented.clone();
        for column in 0..=dimension {
            let base = augmented[column];
            let step = 1.0e-7_f64.max(1.0e-7 * base.abs());
            shifted_augmented[column] = base + step;
            let mut shifted = DVector::zeros(dimension);
            self.residual(&shifted_augmented, &mut shifted)?;
            for row in 0..dimension {
                jacobian[(row, column)] = (shifted[row] - baseline[row]) / step;
            }
            shifted_augmented[column] = base;
        }
        Ok(jacobian)
    }

    fn diagnostics(&mut self, augmented: &DVector<f64>) -> Result<PointDiagnostics> {
        let decoded = self.decode(augmented)?;
        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues: Vec::new(),
            cycle_points: Some(decoded.nodes),
        })
    }

    fn heteroclinic_event_diagnostics(
        &mut self,
        augmented: &DVector<f64>,
    ) -> Result<Option<HeteroclinicEventDiagnostics>> {
        let decoded = self.decode(augmented)?;
        let params = self.params(augmented[0], decoded.param2_value)?;
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
            .nodes
            .first()
            .ok_or_else(|| anyhow!("Heteroclinic shooting nodes are empty"))?;
        let target_endpoint = decoded
            .nodes
            .last()
            .ok_or_else(|| anyhow!("Heteroclinic shooting nodes are empty"))?;
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
                    .map(|seed| Self::transform_seed(&transform, seed))
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
        let mut augmented = DVector::zeros(self.dimension() + 1);
        augmented[0] = point.param_value;
        augmented.as_mut_slice()[1..].copy_from_slice(&point.state);
        point.cycle_points = Some(self.decode(&augmented)?.nodes);
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

    fn update_after_step(&mut self, augmented: &DVector<f64>) -> Result<()> {
        let decoded = self.decode(augmented)?;
        let params = self.params(augmented[0], decoded.param2_value)?;
        self.section_index = max_flow_node_index(self.system, &params, &decoded.nodes)?;
        self.section_center = decoded.nodes[self.section_index].clone();
        self.section_normal = flow_at(self.system, &params, &self.section_center)?;
        normalize_in_place(&mut self.section_normal)?;
        self.setup.guess = HeteroclinicShootingGuess {
            nodes: decoded.nodes,
            source_equilibrium: decoded.source_equilibrium,
            target_equilibrium: decoded.target_equilibrium,
            param1_value: augmented[0],
            param2_value: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            source_yu: decoded.source_yu,
            target_ys: decoded.target_ys,
        };
        Ok(())
    }
}

fn validate_setup(system: &EquationSystem, setup: &HeteroclinicShootingSetupV1) -> Result<()> {
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
    validate_shooting_settings(setup.shooting)?;
    let dim = system.equations.len();
    if setup.source_basis.dim != dim
        || setup.target_basis.dim != dim
        || setup.source_basis.npos + setup.target_basis.nneg != dim
    {
        bail!("Heteroclinic shooting setup violates the codimension-one index condition");
    }
    if setup.guess.nodes.len() != setup.shooting.intervals + 1
        || setup.guess.nodes.iter().any(|node| node.len() != dim)
        || setup.guess.source_equilibrium.len() != dim
        || setup.guess.target_equilibrium.len() != dim
    {
        bail!("Heteroclinic shooting nodes or equilibria have invalid dimensions");
    }
    let source_size = setup.source_basis.nneg * setup.source_basis.npos;
    let target_size = setup.target_basis.nneg * setup.target_basis.npos;
    if setup.guess.source_yu.len() != source_size || setup.guess.target_ys.len() != target_size {
        bail!("Heteroclinic shooting Riccati state has invalid dimensions");
    }
    Ok(())
}

fn validate_shooting_settings(settings: HeteroclinicShootingSettings) -> Result<()> {
    if settings.intervals == 0 || settings.integration_steps_per_segment == 0 {
        bail!("Heteroclinic shooting interval and integration counts must be positive");
    }
    Ok(())
}

fn resolved_params(setup: &HeteroclinicShootingSetupV1, p1: f64, p2: f64) -> Result<Vec<f64>> {
    let mut params = setup.base_params.clone();
    if setup.param1_index == setup.param2_index
        || setup.param1_index >= params.len()
        || setup.param2_index >= params.len()
    {
        bail!("Invalid heteroclinic shooting parameter plane");
    }
    params[setup.param1_index] = p1;
    params[setup.param2_index] = p2;
    Ok(params)
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

fn basis_from_snapshot(snapshot: &HomoclinicBasisSnapshot) -> HomoclinicBasis {
    HomoclinicBasis {
        stable_q: snapshot.stable_q.clone(),
        unstable_q: snapshot.unstable_q.clone(),
        dim: snapshot.dim,
        nneg: snapshot.nneg,
        npos: snapshot.npos,
    }
}

/// Construct one forward state-transition matrix per shooting interval by
/// integrating the same Tsitouras-5 segment trajectory used by the nonlinear
/// shooting residual. Each residual combines segment continuity with the
/// flow-covariance identity `Phi f(x0) = f(Phi_t(x0))`.
pub(crate) fn heteroclinic_shooting_interval_maps(
    system: &mut EquationSystem,
    nodes: &[Vec<f64>],
    segment_duration: f64,
    integration_steps_per_segment: usize,
    params: &[f64],
) -> Result<(Vec<DMatrix<f64>>, Vec<f64>)> {
    if nodes.len() < 2
        || nodes.iter().any(|node| node.len() != nodes[0].len())
        || nodes[0].is_empty()
        || !segment_duration.is_finite()
        || segment_duration <= 0.0
        || integration_steps_per_segment == 0
    {
        bail!("Heteroclinic shooting interval-map inputs are invalid");
    }
    if system.params.len() != params.len() {
        bail!("Heteroclinic shooting parameter vector length mismatch");
    }
    let previous_params = system.params.clone();
    system.params.copy_from_slice(params);
    let result = (|| {
        let dim = nodes[0].len();
        let mut maps = Vec::with_capacity(nodes.len() - 1);
        let mut residuals = Vec::with_capacity(nodes.len() - 1);
        for interval in 0..nodes.len() - 1 {
            let (endpoint, map) = integrate_fixed_with_tangent(
                system,
                &nodes[interval],
                segment_duration,
                integration_steps_per_segment,
            )?;
            let mut source_flow = vec![0.0; dim];
            let mut endpoint_flow = vec![0.0; dim];
            system.apply(0.0, &nodes[interval], &mut source_flow);
            system.apply(segment_duration, &endpoint, &mut endpoint_flow);
            let transported_flow = &map * DVector::from_vec(source_flow.clone());
            let endpoint_flow = DVector::from_vec(endpoint_flow);
            let covariance_residual = (&transported_flow - &endpoint_flow).norm()
                / (map.norm() * l2_norm(&source_flow) + endpoint_flow.norm()).max(1.0);
            let continuity_residual = vector_sub(&endpoint, &nodes[interval + 1])
                .iter()
                .map(|value| value * value)
                .sum::<f64>()
                .sqrt()
                / (l2_norm(&endpoint) + l2_norm(&nodes[interval + 1])).max(1.0);
            let residual = covariance_residual.max(continuity_residual);
            if map.iter().any(|value| !value.is_finite()) || !residual.is_finite() {
                bail!("Heteroclinic shooting variational integration is non-finite");
            }
            maps.push(map);
            residuals.push(residual);
        }
        Ok((maps, residuals))
    })();
    system.params = previous_params;
    result
}

fn integrate_fixed_with_tangent(
    system: &EquationSystem,
    initial: &[f64],
    duration: f64,
    steps: usize,
) -> Result<(Vec<f64>, DMatrix<f64>)> {
    if initial.is_empty() || !duration.is_finite() || duration <= 0.0 || steps == 0 {
        bail!("Heteroclinic shooting tangent duration and step count must be positive");
    }
    let dim = initial.len();
    let mut augmented = vec![0.0; dim + dim * dim];
    augmented[..dim].copy_from_slice(initial);
    for index in 0..dim {
        augmented[dim + index * dim + index] = 1.0;
    }
    let tangent_system = TangentSystem::new(system, dim);
    let mut solver = Tsit5::new(augmented.len());
    let mut time = 0.0;
    let dt = duration / steps as f64;
    for _ in 0..steps {
        solver.step(&tangent_system, &mut time, &mut augmented, dt);
        if augmented.iter().any(|value| !value.is_finite()) {
            bail!("Heteroclinic shooting tangent integration produced a non-finite value");
        }
    }
    Ok((
        augmented[..dim].to_vec(),
        DMatrix::from_row_slice(dim, dim, &augmented[dim..]),
    ))
}

fn integrate_fixed(
    system: &EquationSystem,
    initial: &[f64],
    duration: f64,
    steps: usize,
) -> Result<Vec<f64>> {
    if !duration.is_finite() || duration <= 0.0 || steps == 0 {
        bail!("Heteroclinic shooting duration and step count must be positive");
    }
    let dt = duration / steps as f64;
    let mut solver = Tsit5::new(initial.len());
    let mut time = 0.0;
    let mut state = initial.to_vec();
    for _ in 0..steps {
        solver.step(system, &mut time, &mut state, dt);
        if state.iter().any(|value| !value.is_finite()) {
            bail!("Heteroclinic shooting integration produced a non-finite state");
        }
    }
    Ok(state)
}

fn interpolate_state(tau: f64, times: &[f64], states: &[Vec<f64>]) -> Result<Vec<f64>> {
    if times.is_empty() || times.len() != states.len() {
        bail!("Invalid heteroclinic shooting interpolation data");
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
    let alpha = if width.abs() > 1.0e-14 {
        ((tau - times[lower]) / width).clamp(0.0, 1.0)
    } else {
        0.0
    };
    if states[lower].len() != states[upper].len() {
        bail!("Heteroclinic interpolation states have inconsistent dimensions");
    }
    Ok(states[lower]
        .iter()
        .zip(&states[upper])
        .map(|(left, right)| left * (1.0 - alpha) + right * alpha)
        .collect())
}

fn flow_at(system: &mut EquationSystem, params: &[f64], state: &[f64]) -> Result<Vec<f64>> {
    if system.params.len() != params.len() {
        bail!("Heteroclinic shooting parameter vector length mismatch");
    }
    let old = system.params.clone();
    system.params.copy_from_slice(params);
    let mut flow = vec![0.0; state.len()];
    system.apply(0.0, state, &mut flow);
    system.params = old;
    Ok(flow)
}

fn max_flow_node_index(
    system: &mut EquationSystem,
    params: &[f64],
    nodes: &[Vec<f64>],
) -> Result<usize> {
    let mut best = None;
    for (index, node) in nodes.iter().enumerate() {
        let norm = l2_norm(&flow_at(system, params, node)?);
        if best.is_none_or(|(_, best_norm)| norm > best_norm) {
            best = Some((index, norm));
        }
    }
    Ok(best.map(|(index, _)| index).unwrap_or(0))
}

fn normalize_in_place(values: &mut [f64]) -> Result<()> {
    let norm = l2_norm(values);
    if !norm.is_finite() || norm <= 1.0e-14 {
        bail!("Cannot define a heteroclinic shooting phase section from zero flow");
    }
    for value in values {
        *value /= norm;
    }
    Ok(())
}

fn matrix_norm(matrix: &DMatrix<f64>) -> f64 {
    matrix
        .clone()
        .svd(false, false)
        .singular_values
        .iter()
        .copied()
        .fold(0.0_f64, f64::max)
}

fn vector_sub(left: &[f64], right: &[f64]) -> Vec<f64> {
    left.iter().zip(right).map(|(a, b)| a - b).collect()
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::heteroclinic::{heteroclinic_setup_from_orbit, HeteroclinicOrbitSeed};
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

    fn collocation_setup(system: &mut EquationSystem) -> HeteroclinicSetupV1 {
        let times = (-20..=20)
            .map(|index| index as f64 / 4.0)
            .collect::<Vec<_>>();
        let states = times.iter().map(|time| vec![time.tanh(), 0.0]).collect();
        heteroclinic_setup_from_orbit(
            system,
            &HeteroclinicOrbitSeed {
                times,
                states,
                source_equilibrium: vec![-1.0, 0.0],
                target_equilibrium: vec![1.0, 0.0],
            },
            8,
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
        .expect("collocation setup")
    }

    fn manufactured_four_dimensional_setup(
        system: &mut EquationSystem,
        intervals: usize,
    ) -> HeteroclinicShootingSetupV1 {
        let sample_count = 161usize;
        let time = 5.0;
        let times = (0..sample_count)
            .map(|index| -time + 2.0 * time * index as f64 / (sample_count - 1) as f64)
            .collect::<Vec<_>>();
        let states = times
            .iter()
            .map(|time| vec![time.tanh(), 0.0, 0.0, 0.0])
            .collect::<Vec<_>>();
        let collocation = heteroclinic_setup_from_orbit(
            system,
            &HeteroclinicOrbitSeed {
                times,
                states,
                source_equilibrium: vec![-1.0, 0.0, 0.0, 0.0],
                target_equilibrium: vec![1.0, 0.0, 0.0, 0.0],
            },
            24,
            3,
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
        .expect("manufactured collocation setup");
        let mut setup = heteroclinic_shooting_setup_from_collocation(
            &collocation,
            HeteroclinicShootingSettings {
                intervals,
                integration_steps_per_segment: 1024,
            },
        )
        .expect("manufactured shooting setup");
        setup.guess.nodes = (0..=intervals)
            .map(|index| {
                let time =
                    -setup.guess.time + 2.0 * setup.guess.time * index as f64 / intervals as f64;
                vec![time.tanh(), 0.0, 0.0, 0.0]
            })
            .collect();
        setup
    }

    fn manufactured_four_dimensional_system() -> EquationSystem {
        let variables = vec![
            "x".to_owned(),
            "y".to_owned(),
            "z".to_owned(),
            "w".to_owned(),
        ];
        let parameters = vec!["mu".to_owned(), "nu".to_owned()];
        let compiler = Compiler::new(&variables, &parameters);
        let equations = ["1-x^2", "(2+x)*y+(mu-nu)*(1-x^2)", "(-2+x)*z", "2*x*w"];
        let bytecode = equations
            .iter()
            .map(|equation| compiler.compile(&parse(equation).expect("parse manufactured model")))
            .collect();
        let mut system = EquationSystem::new(bytecode, vec![0.0, 0.0]);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    #[test]
    fn shooting_state_round_trips_two_independent_endpoints() {
        let mut system = analytic_system();
        let source = collocation_setup(&mut system);
        let setup = heteroclinic_shooting_setup_from_collocation(
            &source,
            HeteroclinicShootingSettings {
                intervals: 3,
                integration_steps_per_segment: 32,
            },
        )
        .expect("shooting setup");
        let decoded =
            decode_heteroclinic_shooting_state(&pack_heteroclinic_shooting_state(&setup), &setup)
                .expect("round trip");
        assert_eq!(decoded.nodes.len(), 4);
        assert_eq!(decoded.source_equilibrium, vec![-1.0, 0.0]);
        assert_eq!(decoded.target_equilibrium, vec![1.0, 0.0]);
    }

    #[test]
    fn one_segment_is_single_shooting_and_multiple_segments_share_its_flow() {
        let system = analytic_system();
        let initial = vec![-0.8, 0.0];
        let one = integrate_fixed(&system, &initial, 2.0, 256).expect("single flow");
        let mut multiple = initial;
        for _ in 0..4 {
            multiple = integrate_fixed(&system, &multiple, 0.5, 64).expect("segment flow");
        }
        assert!((one[0] - multiple[0]).abs() < 1.0e-11);
        assert!((one[1] - multiple[1]).abs() < 1.0e-11);
    }

    #[test]
    fn restart_rejects_an_out_of_range_parameter_plane_without_panicking() {
        let mut system = analytic_system();
        let source = collocation_setup(&mut system);
        let setup = heteroclinic_shooting_setup_from_collocation(
            &source,
            HeteroclinicShootingSettings {
                intervals: 1,
                integration_steps_per_segment: 32,
            },
        )
        .expect("shooting setup");
        let mut schema = setup.connection_schema();
        schema.param2_index = schema.base_params.len();
        let branch_type = BranchType::HeteroclinicCurve {
            schema,
            ntst: 1,
            ncol: 0,
            discretization: HomoclinicDiscretization::Shooting {
                integration_steps_per_segment: 32,
            },
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            param1_name: "mu".to_owned(),
            param2_name: "nu".to_owned(),
            free_time: setup.extras.free_time,
            free_eps0: setup.extras.free_eps0,
            free_eps1: setup.extras.free_eps1,
        };
        let point = ContinuationPoint {
            state: pack_heteroclinic_shooting_state(&setup),
            param_value: setup.guess.param1_value,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let error = heteroclinic_shooting_setup_from_point(&point, &branch_type)
            .expect_err("invalid restart metadata must be rejected");
        assert!(error.to_string().contains("out of range"));
    }

    #[test]
    fn manufactured_four_dimensional_interval_maps_match_the_analytic_cocycle() {
        let mut system = manufactured_four_dimensional_system();
        let setup = manufactured_four_dimensional_setup(&mut system, 4);
        let segment_duration = 2.0 * setup.guess.time / setup.shooting.intervals as f64;
        let (maps, residuals) = heteroclinic_shooting_interval_maps(
            &mut system,
            &setup.guess.nodes,
            segment_duration,
            setup.shooting.integration_steps_per_segment,
            &setup.base_params,
        )
        .expect("shooting interval maps");

        assert_eq!(maps.len(), 4);
        assert!(
            residuals.iter().all(|residual| *residual < 1.0e-8),
            "interval residuals: {residuals:?}"
        );
        for (interval, map) in maps.iter().enumerate() {
            let left = -setup.guess.time + interval as f64 * segment_duration;
            let right = left + segment_duration;
            let cosh_ratio = right.cosh() / left.cosh();
            let expected = [
                (1.0 / right.cosh()).powi(2) / (1.0 / left.cosh()).powi(2),
                (2.0 * segment_duration).exp() * cosh_ratio,
                (-2.0 * segment_duration).exp() * cosh_ratio,
                cosh_ratio * cosh_ratio,
            ];
            for row in 0..4 {
                for column in 0..4 {
                    let target = if row == column { expected[row] } else { 0.0 };
                    let scale = target.abs().max(1.0);
                    assert!(
                        (map[(row, column)] - target).abs() < 2.0e-7 * scale,
                        "interval={interval}, entry=({row},{column}), actual={}, expected={target}",
                        map[(row, column)]
                    );
                }
            }
        }
    }

    #[test]
    fn manufactured_four_dimensional_shooting_frames_have_oriented_sif_and_tif() {
        let mut system = manufactured_four_dimensional_system();
        let setup = manufactured_four_dimensional_setup(&mut system, 4);
        let augmented = DVector::from_vec({
            let mut values = vec![setup.guess.param1_value];
            values.extend(pack_heteroclinic_shooting_state(&setup));
            values
        });
        let mut problem = HeteroclinicShootingProblem::new(&mut system, setup)
            .expect("manufactured shooting problem");
        let decoded = problem
            .decode(&augmented)
            .expect("decode manufactured state");
        let params = problem
            .params(augmented[0], decoded.param2_value)
            .expect("manufactured parameters");
        let (source, target) = problem
            .inclination_frames(&decoded, &params)
            .expect("shooting inclination frames");
        assert!(source.is_some(), "source inclination frame is unavailable");
        assert!(target.is_some(), "target inclination frame is unavailable");
        let source = source.expect("checked source inclination frame");
        let target = target.expect("checked target inclination frame");

        let source_value = source.signed_test().expect("SIF");
        let target_value = target.signed_test().expect("TIF");
        assert!((source_value + 1.0).abs() < 1.0e-8, "SIF={source_value}");
        assert!((target_value + 1.0).abs() < 1.0e-8, "TIF={target_value}");
        for frame in [&source, &target] {
            assert_eq!(frame.transported_frame.shape(), (4, 1));
            assert_eq!(frame.reference_frame.shape(), (4, 1));
            assert!(frame.minimum_overlap_singular_value > 0.999_999);
            assert!(frame.relative_transport_residual < 1.0e-8);
        }
    }
}
