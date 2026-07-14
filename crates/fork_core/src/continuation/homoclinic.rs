use super::homoclinic_events::{
    build_homoclinic_orbit_flip_data, compute_homoclinic_event_diagnostics,
    HomoclinicEventDiagnostics, DEFAULT_FOCUS_TOLERANCE,
};
use super::homoclinic_init::{
    compute_homoclinic_basis, decode_homoclinic_state_with_basis, pack_homoclinic_state,
    validate_homoclinic_extras, validate_homoclinic_parameter_plane, validate_homoclinic_scalars,
    HomoclinicChartTransform, HomoclinicSetup,
};
use super::periodic::{
    defect_weighted_normalized_mesh, integrate_polynomial, interpolate_local_profile,
    lagrange_coefficients, meshes_materially_different, propose_uniform_mesh_refinement,
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
    continue_with_problem, BifurcationType, BranchType, ContinuationBranch, ContinuationPoint,
    ContinuationSettings, HomoclinicBasisSnapshot, HomoclinicDiscretization,
    HomoclinicResumeContext,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

pub fn continue_homoclinic_curve(
    system: &mut EquationSystem,
    setup: HomoclinicSetup,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let initial_state = pack_homoclinic_state(&setup);
    let initial_point = ContinuationPoint {
        state: initial_state,
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
        homoclinic_events: None,
    };

    let mut problem = HomoclinicProblem::new(system, setup.clone())?;
    let mut branch = continue_with_problem(&mut problem, initial_point, settings, forward)?;
    branch.branch_type = problem.branch_type_metadata();
    branch.homoc_context = Some(problem.resume_context());
    Ok(branch)
}

pub struct HomoclinicProblem<'a> {
    system: &'a mut EquationSystem,
    setup: HomoclinicSetup,
    normalized_mesh: Vec<f64>,
    coeffs: CollocationCoefficients,
    phase_ref_stages: Vec<f64>,
    phase_ref_derivative: Vec<f64>,
    work_stage_f: Vec<f64>,
    adaptivity: CollocationAdaptivitySettings,
    adaptation_report: CollocationAdaptationReport,
    adaptation_transfer_start_index: usize,
    accepted_steps_since_projector_refresh: usize,
    chart_transforms: Vec<HomoclinicChartTransform>,
}

const PROJECTOR_REFRESH_ANGLE_THRESHOLD: f64 = std::f64::consts::PI / 9.0;

impl<'a> HomoclinicProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, setup: HomoclinicSetup) -> Result<Self> {
        validate_homoclinic_extras(setup.extras)?;
        if setup.base_params.len() != system.params.len() {
            bail!("Homoclinic base parameter vector length mismatch");
        }
        validate_homoclinic_parameter_plane(
            setup.base_params.len(),
            setup.param1_index,
            setup.param2_index,
        )?;
        validate_homoclinic_scalars(setup.guess.time, setup.guess.eps0, setup.guess.eps1)?;
        if setup.ntst < 2 {
            bail!("Homoclinic continuation requires at least 2 intervals");
        }
        if setup.ncol == 0 {
            bail!("Collocation degree must be positive");
        }
        if setup.guess.mesh_states.len() != setup.ntst + 1 {
            bail!("Homoclinic mesh must contain ntst+1 points");
        }
        if setup.guess.stage_states.len() != setup.ntst {
            bail!("Homoclinic stage-state interval count mismatch");
        }

        let normalized_mesh = setup.resolved_normalized_mesh()?;
        let adaptivity = setup.collocation_adaptivity;
        if !adaptivity.defect_tolerance.is_finite() || adaptivity.defect_tolerance <= 0.0 {
            bail!("Collocation defect tolerance must be finite and positive");
        }
        if adaptivity.max_mesh_points < setup.ntst {
            bail!(
                "Adaptive collocation mesh-point cap {} is below the active homoclinic mesh size {}",
                adaptivity.max_mesh_points,
                setup.ntst
            );
        }
        let coeffs = CollocationCoefficients::new(setup.ncol)?;
        let initial_report = CollocationAdaptationReport {
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
        let mut setup = setup;
        setup.normalized_mesh = normalized_mesh.clone();
        let mut problem = Self {
            system,
            setup,
            normalized_mesh,
            coeffs,
            phase_ref_stages: Vec::new(),
            phase_ref_derivative: Vec::new(),
            work_stage_f: Vec::new(),
            adaptivity,
            adaptation_report: initial_report,
            adaptation_transfer_start_index: 0,
            accepted_steps_since_projector_refresh: 0,
            chart_transforms: Vec::new(),
        };
        let phase_params = problem.current_params(
            problem.setup.guess.param1_value,
            problem.setup.guess.param2_value,
        )?;
        let phase_stages = problem.setup.guess.stage_states.clone();
        problem.set_phase_reference(&phase_stages, &phase_params, problem.setup.guess.time)?;
        if let Some(report) = persisted_report {
            problem.seed_adaptation_report(report)?;
        }
        Ok(problem)
    }

    pub fn normalized_mesh(&self) -> &[f64] {
        &self.normalized_mesh
    }

    pub fn adaptation_report(&self) -> &CollocationAdaptationReport {
        &self.adaptation_report
    }

    pub fn adaptivity_settings(&self) -> CollocationAdaptivitySettings {
        self.adaptivity
    }

    pub fn projector_refresh_count(&self) -> usize {
        self.chart_transforms.len()
    }

    pub fn branch_type_metadata(&self) -> BranchType {
        BranchType::HomoclinicCurve {
            ntst: self.setup.ntst,
            ncol: self.setup.ncol,
            discretization: HomoclinicDiscretization::Collocation,
            normalized_mesh: self.normalized_mesh.clone(),
            collocation_adaptivity: self.adaptivity,
            collocation_adaptation: Some(self.adaptation_report.clone()),
            param1_name: self.setup.param1_name.clone(),
            param2_name: self.setup.param2_name.clone(),
            free_time: self.setup.extras.free_time,
            free_eps0: self.setup.extras.free_eps0,
            free_eps1: self.setup.extras.free_eps1,
        }
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

    fn projector_chart_angle(&self, decoded: &DecodedState) -> f64 {
        let yu = Self::unpack_riccati(&decoded.yu, self.setup.basis.nneg, self.setup.basis.npos);
        let ys = Self::unpack_riccati(&decoded.ys, self.setup.basis.npos, self.setup.basis.nneg);
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

    pub fn seed_adaptation_report(
        &mut self,
        mut report: CollocationAdaptationReport,
    ) -> Result<()> {
        if report.current_mesh_points != self.setup.ntst
            || report.degree != self.setup.ncol
            || meshes_materially_different(&report.current_normalized_mesh, &self.normalized_mesh)
        {
            bail!("Collocation adaptation report does not match the active homoclinic mesh");
        }
        self.adaptation_transfer_start_index = report.attempts.len();
        report.defect_tolerance = self.adaptivity.defect_tolerance;
        report.refinement_budget = self.adaptivity.max_refinements;
        report.max_mesh_points = self.adaptivity.max_mesh_points;
        report.termination = None;
        self.adaptation_report = report;
        Ok(())
    }

    fn dim(&self) -> usize {
        self.system.equations.len()
    }

    fn orbit_unknown_count(&self) -> usize {
        let dim = self.dim();
        ((self.setup.ntst + 1) + self.setup.ntst * self.setup.ncol) * dim
    }

    fn riccati_size(&self) -> usize {
        self.setup.basis.nneg * self.setup.basis.npos
    }

    fn free_extra_count(&self) -> usize {
        self.setup.extras.free_count()
    }

    fn current_params(&self, p1: f64, p2: f64) -> Result<Vec<f64>> {
        let mut params = self.setup.base_params.clone();
        if self.setup.param1_index >= params.len() || self.setup.param2_index >= params.len() {
            bail!("Parameter index out of range in homoclinic setup");
        }
        params[self.setup.param1_index] = p1;
        params[self.setup.param2_index] = p2;
        Ok(params)
    }

    fn decode_state(&self, aug_state: &DVector<f64>) -> Result<DecodedState> {
        let decoded = decode_homoclinic_state_with_basis(
            &aug_state.as_slice()[1..],
            self.dim(),
            self.setup.ntst,
            self.setup.ncol,
            self.setup.extras,
            self.setup.guess.time,
            self.setup.guess.eps0,
            self.setup.guess.eps1,
            (self.setup.basis.nneg, self.setup.basis.npos),
        )?;
        Ok(DecodedState {
            mesh_states: decoded.mesh_states,
            stage_states: decoded.stage_states,
            x0: decoded.x0,
            p2: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            yu: decoded.yu,
            ys: decoded.ys,
            nneg: decoded.nneg,
            npos: decoded.npos,
        })
    }

    fn with_params<F, R>(&mut self, params: &[f64], mut f: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        if self.system.params.len() != params.len() {
            bail!("Parameter vector length mismatch");
        }
        let old = self.system.params.clone();
        self.system.params.copy_from_slice(params);
        let result = f(self.system);
        self.system.params = old;
        result
    }

    fn evaluate_stage_flow(
        &mut self,
        stage_states: &[Vec<Vec<f64>>],
        params: &[f64],
    ) -> Result<()> {
        let dim = self.dim();
        let stage_count = self.setup.ntst * self.setup.ncol;
        let expected = stage_count * dim;
        if self.work_stage_f.len() != expected {
            self.work_stage_f.resize(expected, 0.0);
        }
        let mut stage_f = vec![0.0; expected];
        self.with_params(params, |system| {
            let mut offset = 0usize;
            for interval in stage_states {
                for stage in interval {
                    system.apply(0.0, stage, &mut stage_f[offset..offset + dim]);
                    offset += dim;
                }
            }
            Ok(())
        })?;
        self.work_stage_f = stage_f;
        Ok(())
    }

    fn stage_flow_slice(&self, interval: usize, stage: usize) -> &[f64] {
        let dim = self.dim();
        let idx = interval * self.setup.ncol + stage;
        let start = idx * dim;
        &self.work_stage_f[start..start + dim]
    }

    fn interval_width(&self, interval: usize) -> f64 {
        self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]
    }

    fn set_phase_reference(
        &mut self,
        stage_states: &[Vec<Vec<f64>>],
        params: &[f64],
        time: f64,
    ) -> Result<()> {
        validate_homoclinic_scalars(time, self.setup.guess.eps0, self.setup.guess.eps1)?;
        self.evaluate_stage_flow(stage_states, params)?;
        self.phase_ref_stages = stage_states
            .iter()
            .flat_map(|interval| interval.iter().flatten())
            .copied()
            .collect();
        let duration = 2.0 * time;
        self.phase_ref_derivative = self
            .work_stage_f
            .iter()
            .map(|value| duration * value)
            .collect();
        Ok(())
    }

    fn flow_at_state(&mut self, state: &[f64], params: &[f64], out: &mut [f64]) -> Result<()> {
        self.with_params(params, |system| {
            system.apply(0.0, state, out);
            Ok(())
        })
    }

    fn basis_matrix(flat: &[f64], dim: usize) -> Result<DMatrix<f64>> {
        if flat.len() != dim * dim {
            bail!("Basis matrix has invalid size");
        }
        Ok(DMatrix::from_column_slice(dim, dim, flat))
    }

    fn unpack_riccati(vec: &[f64], rows: usize, cols: usize) -> DMatrix<f64> {
        if rows == 0 || cols == 0 {
            return DMatrix::zeros(rows, cols);
        }
        DMatrix::from_row_slice(rows, cols, vec)
    }

    fn riccati_coeff(q0: &DMatrix<f64>, a: &DMatrix<f64>, nsub: usize) -> Result<RiccatiCoeff> {
        let th = q0.transpose() * a * q0;
        if nsub > th.nrows() {
            bail!("Invalid invariant-subspace dimension");
        }
        let t11 = th.view((0, 0), (nsub, nsub)).into_owned();
        let t12 = th.view((0, nsub), (nsub, th.ncols() - nsub)).into_owned();
        let e21 = th.view((nsub, 0), (th.nrows() - nsub, nsub)).into_owned();
        let t22 = th
            .view((nsub, nsub), (th.nrows() - nsub, th.ncols() - nsub))
            .into_owned();
        Ok(RiccatiCoeff { t11, t12, e21, t22 })
    }

    fn integral_phase_residual(&self, stage_states: &[Vec<Vec<f64>>]) -> Result<f64> {
        let expected = self.setup.ntst * self.setup.ncol * self.dim();
        if self.phase_ref_stages.len() != expected || self.phase_ref_derivative.len() != expected {
            bail!("Homoclinic integral phase reference has invalid dimensions");
        }
        let mut phase = 0.0;
        let dim = self.dim();
        for interval in 0..self.setup.ntst {
            for stage in 0..self.setup.ncol {
                let stage_index = interval * self.setup.ncol + stage;
                let weight = self.interval_width(interval) * self.coeffs.b[stage];
                for component in 0..dim {
                    let flat_index = stage_index * dim + component;
                    phase += weight
                        * (stage_states[interval][stage][component]
                            - self.phase_ref_stages[flat_index])
                        * self.phase_ref_derivative[flat_index];
                }
            }
        }
        if !phase.is_finite() {
            bail!("Homoclinic integral phase residual is non-finite");
        }
        Ok(phase)
    }

    fn collocation_defect_estimate(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<CollocationDefectEstimate> {
        let decoded = self.decode_state(aug_state)?;
        validate_homoclinic_scalars(decoded.time, decoded.eps0, decoded.eps1)?;
        let params = self.current_params(aug_state[0], decoded.p2)?;
        self.evaluate_stage_flow(&decoded.stage_states, &params)?;

        let polynomial_coefficients = lagrange_coefficients(&self.coeffs.nodes)?;
        let check_count = self.setup.ncol + 1;
        let mut checks = Vec::with_capacity(check_count);
        for check in 0..check_count {
            // Midpoints of an independent uniform partition avoid every Gauss
            // collocation node, including the NCOL=1 node at 1/2.
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
            checks.push((basis, integrals));
        }

        let dim = self.dim();
        let duration = 2.0 * decoded.time;
        let mut interval_scaled_defects = vec![0.0_f64; self.setup.ntst];
        let mut reconstructed = vec![0.0; dim];
        let mut actual_flow = vec![0.0; dim];
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            for (basis, integrals) in &checks {
                reconstructed.copy_from_slice(&decoded.mesh_states[interval]);
                for component in 0..dim {
                    for stage in 0..self.setup.ncol {
                        reconstructed[component] += h
                            * integrals[stage]
                            * self.stage_flow_slice(interval, stage)[component];
                    }
                }
                self.flow_at_state(&reconstructed, &params, &mut actual_flow)?;
                for component in 0..dim {
                    let mut polynomial_flow = 0.0;
                    for stage in 0..self.setup.ncol {
                        polynomial_flow +=
                            basis[stage] * self.stage_flow_slice(interval, stage)[component];
                    }
                    let scale = 1.0 + actual_flow[component].abs().max(polynomial_flow.abs());
                    let defect = (polynomial_flow - actual_flow[component]).abs() / scale;
                    interval_scaled_defects[interval] =
                        interval_scaled_defects[interval].max(defect);
                }
            }
        }
        let max_scaled_defect = interval_scaled_defects
            .iter()
            .copied()
            .fold(0.0_f64, f64::max);
        if !max_scaled_defect.is_finite()
            || interval_scaled_defects
                .iter()
                .any(|defect| !defect.is_finite())
        {
            bail!("Homoclinic collocation defect estimate is non-finite");
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
        transferred_accepted_aug: &DVector<f64>,
    ) -> Result<()> {
        let new_ntst = normalized_mesh.len().saturating_sub(1);
        self.normalized_mesh = validated_normalized_mesh(new_ntst, &normalized_mesh)?;
        self.setup.ntst = new_ntst;
        self.setup.normalized_mesh = self.normalized_mesh.clone();
        self.adaptation_report.current_mesh_points = new_ntst;
        self.adaptation_report.current_normalized_mesh = self.normalized_mesh.clone();
        self.adaptation_report.termination = None;

        let decoded = self.decode_state(transferred_accepted_aug)?;
        let params = self.current_params(transferred_accepted_aug[0], decoded.p2)?;
        self.setup.guess.mesh_states = decoded.mesh_states.clone();
        self.setup.guess.stage_states = decoded.stage_states.clone();
        self.setup.guess.x0 = decoded.x0.clone();
        self.setup.guess.param1_value = transferred_accepted_aug[0];
        self.setup.guess.param2_value = decoded.p2;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.set_phase_reference(&decoded.stage_states, &params, decoded.time)
    }

    fn saddle_jacobian(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<(DecodedState, DMatrix<f64>)> {
        let decoded = self.decode_state(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.p2)?;
        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let jac = DMatrix::from_row_slice(self.dim(), self.dim(), &jac_data);
        Ok((decoded, jac))
    }
}

fn open_profile_palc_weights(
    augmented_len: usize,
    normalized_mesh: &[f64],
    ncol: usize,
    dim: usize,
    nodes: &[f64],
) -> Result<DVector<f64>> {
    let ntst = normalized_mesh.len().saturating_sub(1);
    let normalized_mesh = validated_normalized_mesh(ntst, normalized_mesh)?;
    if ncol == 0 || dim == 0 || nodes.len() != ncol {
        bail!("Invalid homoclinic collocation layout for PALC metric");
    }
    let mesh_start = 1usize;
    let mesh_len = (ntst + 1) * dim;
    let stage_start = mesh_start + mesh_len;
    let stage_len = ntst * ncol * dim;
    if stage_start + stage_len > augmented_len {
        bail!("Homoclinic collocation layout exceeds augmented PALC state");
    }

    let mut positions = Vec::with_capacity(ntst * (ncol + 1) + 1);
    let mut profile_slots = Vec::with_capacity(positions.capacity());
    for interval in 0..ntst {
        let left = normalized_mesh[interval];
        let width = normalized_mesh[interval + 1] - left;
        positions.push(left);
        profile_slots.push(mesh_start + interval * dim);
        for (stage, node) in nodes.iter().enumerate() {
            positions.push(left + width * node);
            profile_slots.push(stage_start + (interval * ncol + stage) * dim);
        }
    }
    positions.push(1.0);
    profile_slots.push(mesh_start + ntst * dim);

    let mut weights = DVector::from_element(augmented_len, 1.0);
    for index in 0..positions.len() {
        let left_boundary = if index == 0 {
            0.0
        } else {
            0.5 * (positions[index - 1] + positions[index])
        };
        let right_boundary = if index + 1 == positions.len() {
            1.0
        } else {
            0.5 * (positions[index] + positions[index + 1])
        };
        let weight = right_boundary - left_boundary;
        if !weight.is_finite() || weight <= 0.0 {
            bail!("Homoclinic collocation nodes do not define a positive PALC metric");
        }
        for component in 0..dim {
            weights[profile_slots[index] + component] = weight;
        }
    }
    Ok(weights)
}

fn sample_open_collocation_component(
    aug: &DVector<f64>,
    normalized_mesh: &[f64],
    degree: usize,
    dim: usize,
    nodes: &[f64],
    normalized_time: f64,
    component: usize,
) -> Result<f64> {
    let ntst = normalized_mesh.len().saturating_sub(1);
    if degree == 0 || nodes.len() != degree || component >= dim {
        bail!("Homoclinic profile transfer layout mismatch");
    }
    let mesh_start = 1usize;
    let stage_start = mesh_start + (ntst + 1) * dim;
    if normalized_time <= 8.0 * f64::EPSILON {
        return Ok(aug[mesh_start + component]);
    }
    if normalized_time >= 1.0 - 8.0 * f64::EPSILON {
        return Ok(aug[mesh_start + ntst * dim + component]);
    }
    for (mesh_index, coordinate) in normalized_mesh.iter().enumerate() {
        if (normalized_time - coordinate).abs() <= 8.0 * f64::EPSILON {
            return Ok(aug[mesh_start + mesh_index * dim + component]);
        }
    }

    let interval = normalized_mesh
        .partition_point(|coordinate| *coordinate < normalized_time)
        .saturating_sub(1)
        .min(ntst - 1);
    let width = normalized_mesh[interval + 1] - normalized_mesh[interval];
    let tau = (normalized_time - normalized_mesh[interval]) / width;
    let mut local_nodes = Vec::with_capacity(degree + 1);
    let mut local_values = Vec::with_capacity(degree + 1);
    local_nodes.push(0.0);
    local_values.push(aug[mesh_start + interval * dim + component]);
    for (stage, node) in nodes.iter().enumerate() {
        local_nodes.push(*node);
        let stage_index = interval * degree + stage;
        local_values.push(aug[stage_start + stage_index * dim + component]);
    }
    interpolate_local_profile(&local_nodes, &local_values, tau)
}

fn transfer_homoclinic_aug(
    aug: &DVector<f64>,
    source_mesh: &[f64],
    destination_mesh: &[f64],
    degree: usize,
    dim: usize,
    nodes: &[f64],
) -> Result<DVector<f64>> {
    let source_ntst = source_mesh.len().saturating_sub(1);
    let destination_ntst = destination_mesh.len().saturating_sub(1);
    let source_mesh = validated_normalized_mesh(source_ntst, source_mesh)?;
    let destination_mesh = validated_normalized_mesh(destination_ntst, destination_mesh)?;
    let source_profile_len = ((source_ntst + 1) + source_ntst * degree) * dim;
    if aug.len() <= 1 + source_profile_len || nodes.len() != degree {
        bail!("Homoclinic profile transfer layout mismatch");
    }
    let tail_len = aug.len() - 1 - source_profile_len;
    let destination_profile_len = ((destination_ntst + 1) + destination_ntst * degree) * dim;

    let mut transferred = DVector::zeros(1 + destination_profile_len + tail_len);
    transferred[0] = aug[0];
    let mesh_start = 1usize;
    let stage_start = mesh_start + (destination_ntst + 1) * dim;
    for (mesh_index, coordinate) in destination_mesh.iter().copied().enumerate() {
        for component in 0..dim {
            transferred[mesh_start + mesh_index * dim + component] =
                sample_open_collocation_component(
                    aug,
                    &source_mesh,
                    degree,
                    dim,
                    nodes,
                    coordinate,
                    component,
                )?;
        }
    }
    for interval in 0..destination_ntst {
        let left = destination_mesh[interval];
        let width = destination_mesh[interval + 1] - left;
        for (stage, node) in nodes.iter().enumerate() {
            let coordinate = left + width * node;
            let stage_index = interval * degree + stage;
            for component in 0..dim {
                transferred[stage_start + stage_index * dim + component] =
                    sample_open_collocation_component(
                        aug,
                        &source_mesh,
                        degree,
                        dim,
                        nodes,
                        coordinate,
                        component,
                    )?;
            }
        }
    }
    transferred.as_mut_slice()[1 + destination_profile_len..]
        .copy_from_slice(&aug.as_slice()[1 + source_profile_len..]);
    if transferred.iter().any(|value| !value.is_finite()) {
        bail!("Homoclinic collocation transfer produced a non-finite value");
    }
    Ok(transferred)
}

fn transfer_homoclinic_state(
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
        transfer_homoclinic_aug(&aug, source_mesh, destination_mesh, degree, dim, nodes)?
            .as_slice()[1..]
            .to_vec(),
    )
}

impl<'a> ContinuationProblem for HomoclinicProblem<'a> {
    fn dimension(&self) -> usize {
        let dim = self.dim();
        self.orbit_unknown_count() + dim + 1 + self.free_extra_count() + 2 * self.riccati_size()
    }

    fn palc_metric_weights(&self, _aug_state: &DVector<f64>) -> Result<DVector<f64>> {
        open_profile_palc_weights(
            self.dimension() + 1,
            &self.normalized_mesh,
            self.setup.ncol,
            self.dim(),
            &self.coeffs.nodes,
        )
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        if out.len() != self.dimension() {
            bail!(
                "Homoclinic residual length mismatch: expected {}, got {}",
                self.dimension(),
                out.len()
            );
        }

        let dim = self.dim();
        let decoded = self.decode_state(aug_state)?;
        if decoded.nneg != self.setup.basis.nneg || decoded.npos != self.setup.basis.npos {
            bail!("Decoded Riccati dimensions do not match setup basis");
        }
        validate_homoclinic_scalars(decoded.time, decoded.eps0, decoded.eps1)?;

        let params = self.current_params(aug_state[0], decoded.p2)?;
        self.evaluate_stage_flow(&decoded.stage_states, &params)?;

        let mut row = 0usize;
        let duration = 2.0 * decoded.time;

        // Collocation equations
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            let base = &decoded.mesh_states[interval];
            for stage in 0..self.setup.ncol {
                let z = &decoded.stage_states[interval][stage];
                for r in 0..dim {
                    let mut sum = 0.0;
                    for k in 0..self.setup.ncol {
                        sum += self.coeffs.a[stage][k] * self.stage_flow_slice(interval, k)[r];
                    }
                    out[row] = z[r] - base[r] - h * sum;
                    row += 1;
                }
            }
        }

        // Continuity equations (open orbit, no wrap)
        for interval in 0..self.setup.ntst {
            let h = duration * self.interval_width(interval);
            let base = &decoded.mesh_states[interval];
            let next = &decoded.mesh_states[interval + 1];
            for r in 0..dim {
                let mut sum = 0.0;
                for k in 0..self.setup.ncol {
                    sum += self.coeffs.b[k] * self.stage_flow_slice(interval, k)[r];
                }
                out[row] = next[r] - base[r] - h * sum;
                row += 1;
            }
        }

        // Equilibrium constraint at x0
        let mut f_x0 = vec![0.0; dim];
        self.flow_at_state(&decoded.x0, &params, &mut f_x0)?;
        for value in f_x0 {
            out[row] = value;
            row += 1;
        }

        // Phase constraints: count = free_extra_count - 1
        let phase_constraints = self.free_extra_count().saturating_sub(1);
        if phase_constraints > 0 {
            out[row] = self.integral_phase_residual(&decoded.stage_states)?;
            row += 1;
            for _ in 1..phase_constraints {
                out[row] = 0.0;
                row += 1;
            }
        }

        // Riccati equations
        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let a = DMatrix::from_row_slice(dim, dim, &jac_data);
        let q0u = Self::basis_matrix(&self.setup.basis.unstable_q, dim)?;
        let q0s = Self::basis_matrix(&self.setup.basis.stable_q, dim)?;
        let yu = Self::unpack_riccati(&decoded.yu, self.setup.basis.nneg, self.setup.basis.npos);
        let ys = Self::unpack_riccati(&decoded.ys, self.setup.basis.npos, self.setup.basis.nneg);

        if self.setup.basis.nneg > 0 && self.setup.basis.npos > 0 {
            let coeff_u = Self::riccati_coeff(&q0u, &a, self.setup.basis.npos)?;
            let ru =
                &coeff_u.t22 * &yu - &yu * &coeff_u.t11 + &coeff_u.e21 - &yu * &coeff_u.t12 * &yu;
            for i in 0..ru.nrows() {
                for j in 0..ru.ncols() {
                    out[row] = ru[(i, j)];
                    row += 1;
                }
            }

            let coeff_s = Self::riccati_coeff(&q0s, &a, self.setup.basis.nneg)?;
            let rs =
                &coeff_s.t22 * &ys - &ys * &coeff_s.t11 + &coeff_s.e21 - &ys * &coeff_s.t12 * &ys;
            for i in 0..rs.nrows() {
                for j in 0..rs.ncols() {
                    out[row] = rs[(i, j)];
                    row += 1;
                }
            }
        }

        // Endpoint manifold constraints
        let start_delta = vector_sub(&decoded.mesh_states[0], &decoded.x0);
        let end_delta = vector_sub(
            decoded
                .mesh_states
                .last()
                .ok_or_else(|| anyhow!("Empty homoclinic mesh"))?,
            &decoded.x0,
        );

        let q1u = build_q1_unstable(&q0u, &yu)?;
        for i in 0..self.setup.basis.nneg {
            let col = self.setup.basis.nneg - 1 - i;
            out[row] = dot(&start_delta, q1u.column(col).as_slice());
            row += 1;
        }
        let q1s = build_q1_stable(&q0s, &ys)?;
        for i in 0..self.setup.basis.npos {
            let col = self.setup.basis.npos - 1 - i;
            out[row] = dot(&end_delta, q1s.column(col).as_slice());
            row += 1;
        }

        // Endpoint distances
        out[row] = l2_norm(&start_delta) - decoded.eps0;
        row += 1;
        out[row] = l2_norm(&end_delta) - decoded.eps1;
        row += 1;

        if row != out.len() {
            bail!(
                "Homoclinic residual assembly mismatch: filled {} entries, expected {}",
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

        let mut jac = DMatrix::zeros(dim, dim + 1);
        let mut perturbed = aug_state.clone();

        for col in 0..=dim {
            let base = aug_state[col];
            let step = (1e-7f64).max(1e-7 * base.abs());
            perturbed[col] = base + step;
            let mut shifted = DVector::zeros(dim);
            self.residual(&perturbed, &mut shifted)?;
            for row in 0..dim {
                jac[(row, col)] = (shifted[row] - baseline[row]) / step;
            }
            perturbed[col] = base;
        }

        Ok(jac)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let (decoded, jac) = self.saddle_jacobian(aug_state)?;
        let eigenvalues: Vec<Complex<f64>> = jac.complex_eigenvalues().iter().copied().collect();

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues,
            cycle_points: Some(decoded.mesh_states),
        })
    }

    fn homoclinic_event_diagnostics(
        &mut self,
        aug_state: &DVector<f64>,
    ) -> Result<Option<HomoclinicEventDiagnostics>> {
        let (decoded, jac) = self.saddle_jacobian(aug_state)?;
        let eigenvalues = jac
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let start = decoded
            .mesh_states
            .first()
            .ok_or_else(|| anyhow!("Homoclinic collocation mesh is empty"))?;
        let end = decoded
            .mesh_states
            .last()
            .ok_or_else(|| anyhow!("Homoclinic collocation mesh is empty"))?;
        let orbit_flip = build_homoclinic_orbit_flip_data(
            &jac,
            &eigenvalues,
            vector_sub(start, &decoded.x0),
            vector_sub(end, &decoded.x0),
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
            &self.coeffs.nodes,
        )?;
        let transferred_tangent = transfer_homoclinic_aug(
            accepted_tangent,
            &old_mesh,
            &new_mesh,
            self.setup.ncol,
            self.dim(),
            &self.coeffs.nodes,
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
                    &self.coeffs.nodes,
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
        let decoded = self.decode_state(corrected_aug)?;
        let cadence_due =
            self.accepted_steps_since_projector_refresh >= self.setup.projector_refresh_interval;
        let angle_due = self.projector_chart_angle(&decoded) >= PROJECTOR_REFRESH_ANGLE_THRESHOLD;
        if !cadence_due && !angle_due {
            return Ok(None);
        }

        let params = self.current_params(corrected_aug[0], decoded.p2)?;
        let Ok(new_basis) = compute_homoclinic_basis(self.system, &decoded.x0, &params) else {
            // Near a localized loss of hyperbolicity, retain the last valid
            // chart so event detection can finish instead of mutating midway.
            return Ok(None);
        };
        let Ok(transform) = HomoclinicChartTransform::new(&self.setup.basis, &new_basis) else {
            return Ok(None);
        };

        // Prepare every conversion before replacing the basis. A single
        // rank/conditioning failure leaves the old chart completely intact.
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
                        &self.coeffs.nodes,
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
        let mut aug = DVector::zeros(self.dimension() + 1);
        aug[0] = point.param_value;
        aug.as_mut_slice()[1..].copy_from_slice(&point.state);
        point.cycle_points = Some(self.decode_state(&aug)?.mesh_states);
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
                            &self.coeffs.nodes,
                        )?,
                        tangent: transfer_homoclinic_aug(
                            &seed.tangent,
                            &attempt.old_normalized_mesh,
                            &attempt.new_normalized_mesh,
                            self.setup.ncol,
                            self.dim(),
                            &self.coeffs.nodes,
                        )?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
        }
        for transform in &self.chart_transforms {
            transferred = transferred
                .iter()
                .map(|seed| Self::transform_seed(transform, seed))
                .collect::<Result<Vec<_>>>()?;
        }
        Ok(transferred)
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        let decoded = self.decode_state(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.p2)?;
        self.set_phase_reference(&decoded.stage_states, &params, decoded.time)?;
        self.setup.guess.mesh_states = decoded.mesh_states;
        self.setup.guess.stage_states = decoded.stage_states;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.setup.guess.param1_value = aug_state[0];
        self.setup.guess.param2_value = decoded.p2;
        self.setup.guess.x0 = decoded.x0;
        self.setup.guess.yu = decoded.yu;
        self.setup.guess.ys = decoded.ys;
        Ok(())
    }
}

#[derive(Debug)]
struct DecodedState {
    mesh_states: Vec<Vec<f64>>,
    stage_states: Vec<Vec<Vec<f64>>>,
    x0: Vec<f64>,
    p2: f64,
    time: f64,
    eps0: f64,
    eps1: f64,
    yu: Vec<f64>,
    ys: Vec<f64>,
    nneg: usize,
    npos: usize,
}

struct RiccatiCoeff {
    t11: DMatrix<f64>,
    t12: DMatrix<f64>,
    e21: DMatrix<f64>,
    t22: DMatrix<f64>,
}

fn build_q1_unstable(q0u: &DMatrix<f64>, yu: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    let nneg = yu.nrows();
    let npos = yu.ncols();
    if q0u.nrows() != nneg + npos || q0u.ncols() != nneg + npos {
        bail!("Unstable basis dimensions do not match Riccati state");
    }

    let mut block = DMatrix::zeros(nneg + npos, nneg);
    for r in 0..npos {
        for c in 0..nneg {
            block[(r, c)] = -yu[(c, r)];
        }
    }
    for i in 0..nneg {
        block[(npos + i, i)] = 1.0;
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
    for r in 0..nneg {
        for c in 0..npos {
            block[(r, c)] = -ys[(c, r)];
        }
    }
    for i in 0..npos {
        block[(nneg + i, i)] = 1.0;
    }
    Ok(q0s * block)
}

fn vector_sub(lhs: &[f64], rhs: &[f64]) -> Vec<f64> {
    lhs.iter().zip(rhs.iter()).map(|(a, b)| a - b).collect()
}

fn dot(lhs: &[f64], rhs: &[f64]) -> f64 {
    lhs.iter().zip(rhs.iter()).map(|(a, b)| a * b).sum()
}

fn l2_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::homoclinic_events::{HomoclinicEventKind, HomoclinicEventStatus};
    use crate::continuation::homoclinic_init::{
        homoclinic_setup_from_homoclinic_point, homoclinic_setup_from_large_cycle, HomoclinicBasis,
        HomoclinicExtraFlags, HomoclinicGuess, HomoclinicSetup,
    };
    use crate::equation_engine::{Bytecode, OpCode};

    fn linear_system() -> EquationSystem {
        let eq1 = Bytecode {
            ops: vec![OpCode::LoadParam(0), OpCode::LoadVar(0), OpCode::Mul],
        };
        let eq2 = Bytecode {
            ops: vec![
                OpCode::LoadConst(-1.0),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::LoadParam(1),
                OpCode::Add,
            ],
        };
        let mut system = EquationSystem::new(vec![eq1, eq2], vec![0.2, 0.1]);
        system.param_map.insert("mu".to_string(), 0);
        system.param_map.insert("nu".to_string(), 1);
        system.var_map.insert("x".to_string(), 0);
        system.var_map.insert("y".to_string(), 1);
        system
    }

    fn linear_system_3d() -> EquationSystem {
        let eq1 = Bytecode {
            ops: vec![OpCode::LoadConst(-1.0), OpCode::LoadVar(0), OpCode::Mul],
        };
        let eq2 = Bytecode {
            ops: vec![OpCode::LoadConst(-2.0), OpCode::LoadVar(1), OpCode::Mul],
        };
        let eq3 = Bytecode {
            ops: vec![OpCode::LoadVar(2)],
        };
        let mut system = EquationSystem::new(vec![eq1, eq2, eq3], vec![0.2, 0.1]);
        system.param_map.insert("mu".to_string(), 0);
        system.param_map.insert("nu".to_string(), 1);
        system.var_map.insert("x".to_string(), 0);
        system.var_map.insert("y".to_string(), 1);
        system.var_map.insert("z".to_string(), 2);
        system
    }

    fn identity_column_major(dim: usize) -> Vec<f64> {
        let mut flat = Vec::with_capacity(dim * dim);
        for col in 0..dim {
            for row in 0..dim {
                flat.push(if row == col { 1.0 } else { 0.0 });
            }
        }
        flat
    }

    fn diagonal_saddle_setup_3d() -> HomoclinicSetup {
        HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: vec![
                    vec![0.5, 0.2, 0.1],
                    vec![0.3, 0.1, 0.2],
                    vec![0.1, 0.0, 0.3],
                ],
                stage_states: vec![vec![vec![0.4, 0.15, 0.15]], vec![vec![0.2, 0.05, 0.25]]],
                x0: vec![0.0, 0.0, 0.0],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 2.0,
                eps0: 0.05,
                eps1: 0.08,
                yu: vec![0.0, 0.0],
                ys: vec![0.0, 0.0],
            },
            initial_seed_is_corrected: false,
            ntst: 2,
            ncol: 1,
            normalized_mesh: Vec::new(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            param1_index: 0,
            param2_index: 1,
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            base_params: vec![0.2, 0.1],
            extras: HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
            basis: HomoclinicBasis {
                stable_q: identity_column_major(3),
                unstable_q: identity_column_major(3),
                dim: 3,
                nneg: 2,
                npos: 1,
            },
        }
    }

    fn synthetic_lc_state(dim: usize, ntst: usize, ncol: usize) -> Vec<f64> {
        let mut flat = Vec::new();
        for i in 0..ntst {
            let t = i as f64 / ntst as f64;
            flat.push((2.0 * std::f64::consts::PI * t).cos());
            flat.push((2.0 * std::f64::consts::PI * t).sin());
        }
        for i in 0..ntst {
            for j in 0..ncol {
                let t = (i as f64 + (j as f64 + 1.0) / (ncol as f64 + 1.0)) / ntst as f64;
                flat.push((2.0 * std::f64::consts::PI * t).cos());
                flat.push((2.0 * std::f64::consts::PI * t).sin());
            }
        }
        let period = 2.0 * std::f64::consts::PI;
        flat.push(period);
        assert_eq!(flat.len(), ntst * dim + ntst * ncol * dim + 1);
        flat
    }

    #[test]
    fn residual_dimension_matches_problem_dimension() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");

        assert!(
            !setup.initial_seed_is_corrected,
            "a fresh large-cycle profile is only an approximate homoclinic seed"
        );

        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        assert!(
            !problem.detect_homoclinic_events_from_initial_seed(),
            "approximate large-cycle seeds must suppress seed-to-first event bracketing"
        );
        let dim = problem.dimension();
        let mut aug = DVector::zeros(dim + 1);
        aug[0] = setup.guess.param1_value;
        let packed = pack_homoclinic_state(&setup);
        for (i, value) in packed.iter().copied().enumerate() {
            aug[i + 1] = value;
        }
        let mut residual = DVector::zeros(dim);
        problem.residual(&aug, &mut residual).expect("residual");
        assert_eq!(residual.len(), dim);
        assert!(residual.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn corrected_collocation_restart_enables_first_step_event_bracketing() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let approximate = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("approximate setup");
        let corrected_state = pack_homoclinic_state(&approximate);
        let restarted = homoclinic_setup_from_homoclinic_point(
            &mut system,
            &corrected_state,
            approximate.ntst,
            approximate.ncol,
            approximate.ntst,
            approximate.ncol,
            &approximate.base_params,
            approximate.param1_index,
            approximate.param2_index,
            &approximate.param1_name,
            &approximate.param2_name,
            approximate.extras,
        )
        .expect("corrected restart setup");
        assert!(restarted.initial_seed_is_corrected);
        let problem = HomoclinicProblem::new(&mut system, restarted).expect("restart problem");
        assert!(problem.detect_homoclinic_events_from_initial_seed());
    }

    #[test]
    fn problem_rejects_three_free_extras() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        setup.extras = HomoclinicExtraFlags {
            free_time: true,
            free_eps0: true,
            free_eps1: true,
        };

        let error = HomoclinicProblem::new(&mut system, setup)
            .err()
            .expect("three free extras must fail");
        assert!(error.to_string().contains("at most two"), "{error:#}");
    }

    #[test]
    fn problem_rejects_aliased_parameters_and_invalid_scalars() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");

        let mut aliased = setup.clone();
        aliased.param2_index = aliased.param1_index;
        assert!(HomoclinicProblem::new(&mut system, aliased).is_err());

        for mutate in [
            |setup: &mut HomoclinicSetup| setup.guess.time = 0.0,
            |setup: &mut HomoclinicSetup| setup.guess.eps0 = f64::NAN,
            |setup: &mut HomoclinicSetup| setup.guess.eps1 = f64::INFINITY,
        ] {
            let mut invalid = setup.clone();
            mutate(&mut invalid);
            assert!(HomoclinicProblem::new(&mut system, invalid).is_err());
        }
    }

    #[test]
    fn phase_constraint_is_enabled_for_two_free_extras() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup_two = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup two");
        let setup_one = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
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
        .expect("setup one");

        let dim_two = HomoclinicProblem::new(&mut system, setup_two)
            .expect("problem two")
            .dimension();
        let dim_one = HomoclinicProblem::new(&mut system, setup_one)
            .expect("problem one")
            .dimension();
        assert_eq!(dim_two, dim_one + 1);
    }

    #[test]
    fn jacobian_shape_matches_continuation_trait_contract() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let dim = problem.dimension();

        let mut aug = DVector::zeros(dim + 1);
        aug[0] = setup.guess.param1_value;
        for (i, value) in packed.iter().copied().enumerate() {
            aug[i + 1] = value;
        }

        let jac = problem.extended_jacobian(&aug).expect("jacobian");
        assert_eq!(jac.nrows(), dim);
        assert_eq!(jac.ncols(), dim + 1);
        assert!(jac.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn residual_uses_setup_riccati_dims_for_ambiguous_tail_shapes() {
        let mut system = linear_system_3d();
        let setup = diagonal_saddle_setup_3d();

        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let dim = problem.dimension();
        let mut aug = DVector::zeros(dim + 1);
        aug[0] = setup.guess.param1_value;
        for (i, value) in packed.iter().copied().enumerate() {
            aug[i + 1] = value;
        }
        let mut residual = DVector::zeros(dim);
        problem.residual(&aug, &mut residual).expect("residual");
        assert!(residual.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn collocation_event_hook_uses_packed_endpoints_for_orbit_flip_tests() {
        let mut system = linear_system_3d();
        let setup = diagonal_saddle_setup_3d();
        let mut packed = pack_homoclinic_state(&setup);
        packed[2] = 0.37;
        packed[2 * 3] = 0.23;
        let mut problem = HomoclinicProblem::new(&mut system, setup).expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = 0.2;
        aug.as_mut_slice()[1..].copy_from_slice(&packed);

        let diagnostics = problem
            .homoclinic_event_diagnostics(&aug)
            .expect("collocation homoclinic diagnostics")
            .expect("collocation problem must expose homoclinic events");
        for (kind, expected) in [
            (HomoclinicEventKind::OrbitFlipUnstable, 0.37),
            (HomoclinicEventKind::OrbitFlipStable, 0.23),
        ] {
            let event = diagnostics.event(kind);
            assert_eq!(event.status, HomoclinicEventStatus::Available);
            assert!(
                (event.value.expect("available orbit-flip value") - expected).abs() < 1.0e-12,
                "unexpected {kind:?} projection: {:?}",
                event.value
            );
        }
    }

    #[test]
    fn nonuniform_mesh_scales_each_collocation_interval_by_its_width() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            2,
            1,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        setup.normalized_mesh = vec![0.0, 0.25, 1.0];

        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = setup.guess.param1_value;
        aug.as_mut_slice()[1..].copy_from_slice(&packed);
        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(&aug, &mut residual).expect("residual");

        let decoded = problem.decode_state(&aug).expect("decoded state");
        let params = problem
            .current_params(aug[0], decoded.p2)
            .expect("parameters");
        problem
            .evaluate_stage_flow(&decoded.stage_states, &params)
            .expect("stage flow");
        let dim = problem.dim();
        for interval in 0..2 {
            let width = setup.normalized_mesh[interval + 1] - setup.normalized_mesh[interval];
            let h = 2.0 * decoded.time * width;
            for component in 0..dim {
                let expected = decoded.stage_states[interval][0][component]
                    - decoded.mesh_states[interval][component]
                    - h * problem.coeffs.a[0][0] * problem.stage_flow_slice(interval, 0)[component];
                assert!(
                    (residual[interval * dim + component] - expected).abs() < 1e-12,
                    "interval {interval}, component {component}"
                );
            }
        }
    }

    #[test]
    fn open_profile_palc_metric_uses_nonuniform_voronoi_weights() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            2,
            1,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        setup.normalized_mesh = vec![0.0, 0.25, 1.0];
        let problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let weights = problem
            .palc_metric_weights(&DVector::zeros(problem.dimension() + 1))
            .expect("PALC metric");

        let dim = problem.dim();
        let mesh_start = 1;
        let stage_start = mesh_start + (setup.ntst + 1) * dim;
        let expected_mesh = [0.0625, 0.25, 0.1875];
        let expected_stage = [0.125, 0.375];
        for (index, expected) in expected_mesh.into_iter().enumerate() {
            assert!((weights[mesh_start + index * dim] - expected).abs() < 1e-12);
        }
        for (index, expected) in expected_stage.into_iter().enumerate() {
            assert!((weights[stage_start + index * dim] - expected).abs() < 1e-12);
        }
    }

    #[test]
    fn fixed_ntst_transfer_interpolates_open_profile_and_preserves_tail() {
        let source_mesh = vec![0.0, 0.5, 1.0];
        let destination_mesh = vec![0.0, 0.2, 1.0];
        let nodes = vec![0.5];
        // [p1 | mesh_0..mesh_2 | stage_0..stage_1 | arbitrary tail]
        let aug = DVector::from_vec(vec![9.0, 0.0, 0.5, 1.0, 0.25, 0.75, 7.0, 8.0, 9.0]);
        let transferred =
            transfer_homoclinic_aug(&aug, &source_mesh, &destination_mesh, 1, 1, &nodes)
                .expect("open-profile transfer");

        assert_eq!(transferred.len(), aug.len());
        assert_eq!(transferred[0], 9.0);
        for (actual, expected) in transferred.as_slice()[1..6]
            .iter()
            .zip([0.0, 0.2, 1.0, 0.1, 0.6])
        {
            assert!((actual - expected).abs() < 1e-12);
        }
        assert_eq!(&transferred.as_slice()[6..], &[7.0, 8.0, 9.0]);
    }

    #[test]
    fn defect_rejection_redistributes_without_changing_layout_or_tail() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            2,
            1,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        setup.collocation_adaptivity = CollocationAdaptivitySettings {
            defect_tolerance: 1e-12,
            max_refinements: 2,
            max_mesh_points: setup.ntst,
            ..CollocationAdaptivitySettings::default()
        };
        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let mut accepted = DVector::zeros(problem.dimension() + 1);
        accepted[0] = setup.guess.param1_value;
        accepted.as_mut_slice()[1..].copy_from_slice(&packed);
        let accepted_state = packed.clone();
        let mut rejected = accepted.clone();
        let stage_start = 1 + (setup.ntst + 1) * problem.dim();
        rejected[stage_start] = 100.0;
        rejected[stage_start + 1] = -50.0;
        let mut tangent = DVector::zeros(problem.dimension() + 1);
        tangent[0] = 1.0;
        let old_tail_start = 1 + problem.orbit_unknown_count();
        let old_tail = accepted.as_slice()[old_tail_start..].to_vec();

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[accepted_state])
            .expect("adaptive rejection");
        let StepRejectionAction::Refined {
            accepted_aug,
            accepted_tangent,
            branch_states,
            branch_type,
        } = action
        else {
            panic!("under-resolved profile should redistribute");
        };

        assert_eq!(accepted_aug.len(), accepted.len());
        assert_eq!(accepted_tangent.len(), tangent.len());
        assert_eq!(branch_states, vec![accepted_aug.as_slice()[1..].to_vec()]);
        assert_eq!(accepted_aug.as_slice()[old_tail_start..], old_tail);
        let report = problem.adaptation_report();
        assert_eq!(report.attempts.len(), 1);
        assert_eq!(
            report.attempts[0].kind,
            CollocationMeshAdaptationKind::Redistribution
        );
        assert_eq!(report.attempts[0].old_mesh_points, setup.ntst);
        assert_eq!(report.attempts[0].new_mesh_points, setup.ntst);
        assert!(meshes_materially_different(
            &report.attempts[0].old_normalized_mesh,
            &report.attempts[0].new_normalized_mesh
        ));
        assert_eq!(branch_type, Some(problem.branch_type_metadata()));
        let serialized = serde_json::to_string(&branch_type).expect("serialize branch metadata");
        let mut reloaded: Option<BranchType> =
            serde_json::from_str(&serialized).expect("reload branch metadata");
        let mut expected = branch_type.clone();
        let take_defects = |metadata: &mut Option<BranchType>| -> Vec<Vec<f64>> {
            let Some(BranchType::HomoclinicCurve {
                collocation_adaptation: Some(report),
                ..
            }) = metadata
            else {
                return Vec::new();
            };
            report
                .attempts
                .iter_mut()
                .map(|attempt| std::mem::take(&mut attempt.interval_scaled_defects))
                .collect()
        };
        let expected_defects = take_defects(&mut expected);
        let reloaded_defects = take_defects(&mut reloaded);
        assert_eq!(reloaded, expected);
        assert_eq!(reloaded_defects.len(), expected_defects.len());
        for (reloaded_attempt, expected_attempt) in reloaded_defects.iter().zip(&expected_defects) {
            assert_eq!(reloaded_attempt.len(), expected_attempt.len());
            for (&actual, &expected) in reloaded_attempt.iter().zip(expected_attempt) {
                assert!((actual - expected).abs() <= 1e-14 * expected.abs().max(1.0));
            }
        }
    }

    #[test]
    fn adaptive_transfer_keeps_persisted_cycle_profile_in_sync_with_state() {
        for redistribution_enabled in [true, false] {
            let mut system = linear_system();
            let state = synthetic_lc_state(2, 6, 2);
            let mut setup = homoclinic_setup_from_large_cycle(
                &mut system,
                &state,
                6,
                2,
                2,
                1,
                &[0.2, 0.1],
                0,
                1,
                "mu",
                "nu",
                HomoclinicExtraFlags {
                    free_time: false,
                    free_eps0: true,
                    free_eps1: true,
                },
            )
            .expect("setup");
            setup.collocation_adaptivity = CollocationAdaptivitySettings {
                redistribution_enabled,
                defect_tolerance: 1e-12,
                max_refinements: 2,
                max_mesh_points: if redistribution_enabled {
                    setup.ntst
                } else {
                    8
                },
                ..CollocationAdaptivitySettings::default()
            };

            let packed = pack_homoclinic_state(&setup);
            let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
            let mut accepted = DVector::zeros(problem.dimension() + 1);
            accepted[0] = setup.guess.param1_value;
            accepted.as_mut_slice()[1..].copy_from_slice(&packed);
            let mut rejected = accepted.clone();
            let stage_start = 1 + (setup.ntst + 1) * problem.dim();
            rejected[stage_start] = 100.0;
            rejected[stage_start + 1] = -50.0;
            let mut tangent = DVector::zeros(problem.dimension() + 1);
            tangent[0] = 1.0;
            let mut diagnostics = problem.diagnostics(&accepted).expect("initial diagnostics");
            let stale_cycle = vec![vec![-999.0; problem.dim()]];
            let mut branch = ContinuationBranch {
                points: vec![ContinuationPoint {
                    state: packed,
                    param_value: accepted[0],
                    stability: BifurcationType::None,
                    eigenvalues: diagnostics.eigenvalues.clone(),
                    cycle_points: Some(stale_cycle.clone()),
                    homoclinic_events: None,
                }],
                bifurcations: Vec::new(),
                indices: vec![0],
                branch_type: BranchType::default(),
                upoldp: None,
                homoc_context: None,
                resume_state: None,
                manifold_geometry: None,
            };
            let mut events = None;

            let disposition = super::super::handle_rejected_trial(
                &mut problem,
                &mut accepted,
                &mut tangent,
                &mut diagnostics,
                &mut events,
                &mut branch,
                &rejected,
            )
            .expect("adaptive transfer");
            assert_eq!(
                disposition,
                super::super::RejectedTrialDisposition::RetryTransferredStep
            );

            let point = &branch.points[0];
            assert_ne!(point.cycle_points.as_ref(), Some(&stale_cycle));
            let mut point_aug = DVector::zeros(problem.dimension() + 1);
            point_aug[0] = point.param_value;
            point_aug.as_mut_slice()[1..].copy_from_slice(&point.state);
            let decoded = problem.decode_state(&point_aug).expect("transferred state");
            assert_eq!(point.cycle_points.as_ref(), Some(&decoded.mesh_states));
            assert_eq!(branch.branch_type, problem.branch_type_metadata());

            let BranchType::HomoclinicCurve { ntst, .. } = &branch.branch_type else {
                panic!("expected homoclinic branch metadata");
            };
            if redistribution_enabled {
                assert_eq!(*ntst, setup.ntst);
            } else {
                assert!(*ntst > setup.ntst);
            }
        }
    }

    #[test]
    fn legacy_homoclinic_branch_metadata_defaults_to_uniform_collocation() {
        let legacy = r#"{
            "type":"HomoclinicCurve",
            "ntst":4,
            "ncol":2,
            "param1_name":"mu",
            "param2_name":"nu",
            "free_time":false,
            "free_eps0":true,
            "free_eps1":true
        }"#;
        let branch_type: BranchType = serde_json::from_str(legacy).expect("legacy metadata");
        let BranchType::HomoclinicCurve {
            discretization,
            normalized_mesh,
            collocation_adaptivity,
            collocation_adaptation,
            ..
        } = branch_type
        else {
            panic!("expected homoclinic metadata");
        };
        assert_eq!(discretization, HomoclinicDiscretization::Collocation);
        assert!(normalized_mesh.is_empty());
        assert_eq!(
            collocation_adaptivity,
            CollocationAdaptivitySettings::default()
        );
        assert!(collocation_adaptation.is_none());
    }

    #[test]
    fn restarted_problem_transfers_only_new_redistributions() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            2,
            1,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        let old_mesh = vec![0.0, 0.5, 1.0];
        let current_mesh = vec![0.0, 0.2, 1.0];
        setup.normalized_mesh = current_mesh.clone();
        setup.collocation_adaptivity = CollocationAdaptivitySettings {
            defect_tolerance: 1e-12,
            max_refinements: 2,
            max_mesh_points: setup.ntst,
            ..CollocationAdaptivitySettings::default()
        };
        setup.collocation_adaptation = Some(CollocationAdaptationReport {
            initial_mesh_points: 2,
            current_mesh_points: 2,
            degree: 1,
            defect_tolerance: 0.25,
            refinement_budget: 9,
            max_mesh_points: 32,
            initial_normalized_mesh: old_mesh.clone(),
            current_normalized_mesh: current_mesh.clone(),
            attempts: vec![CollocationRefinementAttempt {
                sequence: 1,
                kind: CollocationMeshAdaptationKind::Redistribution,
                old_mesh_points: 2,
                new_mesh_points: 2,
                degree: 1,
                trigger_defect: 0.5,
                tolerance: 0.25,
                interval_scaled_defects: vec![0.5, 0.1],
                old_normalized_mesh: old_mesh,
                new_normalized_mesh: current_mesh.clone(),
            }],
            termination: None,
        });

        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let mut accepted = DVector::zeros(problem.dimension() + 1);
        accepted[0] = setup.guess.param1_value;
        accepted.as_mut_slice()[1..].copy_from_slice(&packed);
        let persisted_before_extension = packed;
        let mut rejected = accepted.clone();
        let stage_start = 1 + (setup.ntst + 1) * problem.dim();
        rejected[stage_start] = 100.0;
        rejected[stage_start + 1] = -50.0;
        let mut tangent = DVector::zeros(problem.dimension() + 1);
        tangent[0] = 1.0;

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[])
            .expect("new redistribution");
        assert!(matches!(action, StepRejectionAction::Refined { .. }));
        assert_eq!(problem.adaptation_report().attempts.len(), 2);
        let new_mesh = problem.normalized_mesh().to_vec();
        let expected = transfer_homoclinic_state(
            &persisted_before_extension,
            &current_mesh,
            &new_mesh,
            setup.ncol,
            problem.dim(),
            &problem.coeffs.nodes,
        )
        .expect("single current-to-final transfer");
        let transferred = problem
            .transfer_branch_states_to_current_discretization(&[persisted_before_extension])
            .expect("extension-history transfer");
        assert_eq!(transferred, vec![expected]);
    }

    #[test]
    fn ntst_growth_relocates_tail_and_every_external_vector() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let mut setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            2,
            1,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        setup.collocation_adaptivity = CollocationAdaptivitySettings {
            redistribution_enabled: false,
            defect_tolerance: 1e-12,
            max_refinements: 2,
            max_mesh_points: 8,
            ..CollocationAdaptivitySettings::default()
        };
        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let old_dimension = problem.dimension();
        let mut accepted = DVector::zeros(old_dimension + 1);
        accepted[0] = setup.guess.param1_value;
        accepted.as_mut_slice()[1..].copy_from_slice(&packed);
        let old_tail_start = 1 + problem.orbit_unknown_count();
        let old_tail = accepted.as_slice()[old_tail_start..].to_vec();
        let mut rejected = accepted.clone();
        let stage_start = 1 + (setup.ntst + 1) * problem.dim();
        rejected[stage_start] = 100.0;
        rejected[stage_start + 1] = -50.0;
        let mut tangent = DVector::zeros(old_dimension + 1);
        tangent[0] = 1.0;

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &rejected, &[packed])
            .expect("dimension-changing refinement");
        let StepRejectionAction::Refined {
            accepted_aug,
            accepted_tangent,
            branch_states,
            branch_type,
        } = action
        else {
            panic!("under-resolved profile should grow NTST");
        };
        assert!(problem.dimension() > old_dimension);
        assert_eq!(accepted_aug.len(), problem.dimension() + 1);
        assert_eq!(accepted_tangent.len(), problem.dimension() + 1);
        assert_eq!(branch_states.len(), 1);
        assert_eq!(branch_states[0].len(), problem.dimension());
        let new_tail_start = 1 + problem.orbit_unknown_count();
        assert_eq!(accepted_aug.as_slice()[new_tail_start..], old_tail);
        assert_eq!(
            problem.adaptation_report().attempts[0].kind,
            CollocationMeshAdaptationKind::Refinement
        );
        let BranchType::HomoclinicCurve { ntst, .. } = branch_type.expect("branch metadata") else {
            panic!("expected homoclinic metadata");
        };
        assert_eq!(ntst, problem.normalized_mesh().len() - 1);
    }
}
