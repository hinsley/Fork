use super::periodic::{
    uniform_normalized_mesh, validated_normalized_mesh, CollocationAdaptationReport,
    CollocationAdaptivitySettings, CollocationCoefficients,
};
use super::types::HomotopyStage;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, solve_equilibrium, NewtonSettings, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

const HOMOTOPY_SADDLE_EXTRAS: HomoclinicExtraFlags = HomoclinicExtraFlags {
    free_time: true,
    free_eps0: false,
    free_eps1: true,
};

const HYPERBOLICITY_RELATIVE_TOLERANCE: f64 = 1e-8;
pub const DEFAULT_PROJECTOR_REFRESH_INTERVAL: usize = 2;

fn default_projector_refresh_interval() -> usize {
    DEFAULT_PROJECTOR_REFRESH_INTERVAL
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct HomoclinicExtraFlags {
    pub free_time: bool,
    pub free_eps0: bool,
    pub free_eps1: bool,
}

impl HomoclinicExtraFlags {
    pub fn free_count(self) -> usize {
        let mut count = 0usize;
        if self.free_time {
            count += 1;
        }
        if self.free_eps0 {
            count += 1;
        }
        if self.free_eps1 {
            count += 1;
        }
        count
    }
}

pub(crate) fn validate_homoclinic_extras(extras: HomoclinicExtraFlags) -> Result<()> {
    match extras.free_count() {
        0 => bail!("At least one free homoclinic extra parameter is required"),
        1 | 2 => Ok(()),
        _ => bail!(
            "Homoclinic continuation supports at most two free extras; choose at most two of T, eps0, and eps1"
        ),
    }
}

pub(crate) fn validate_homoclinic_parameter_plane(
    parameter_count: usize,
    param1_index: usize,
    param2_index: usize,
) -> Result<()> {
    if param1_index >= parameter_count || param2_index >= parameter_count {
        bail!("Parameter index out of range");
    }
    if param1_index == param2_index {
        bail!("Homoclinic continuation requires two distinct parameters");
    }
    Ok(())
}

pub(crate) fn validate_homoclinic_scalars(time: f64, eps0: f64, eps1: f64) -> Result<()> {
    validate_positive_finite("Homoclinic time", time)?;
    validate_positive_finite("Homoclinic eps0", eps0)?;
    validate_positive_finite("Homoclinic eps1", eps1)
}

fn validate_positive_finite(label: &str, value: f64) -> Result<()> {
    if !value.is_finite() || value <= 0.0 {
        bail!("{} must be finite and strictly positive", label);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicBasis {
    pub stable_q: Vec<f64>,
    pub unstable_q: Vec<f64>,
    pub dim: usize,
    pub nneg: usize,
    pub npos: usize,
}

const RICCATI_CHART_RELATIVE_RANK_TOLERANCE: f64 = 1e-10;
const RICCATI_CHART_MAX_CONDITION: f64 = 1e10;

/// Exact graph-coordinate change between two homoclinic invariant-subspace
/// reference frames. The physical normal spaces are unchanged; only their
/// Riccati coordinates are replaced.
#[derive(Debug, Clone)]
pub(crate) struct HomoclinicChartTransform {
    old_basis: HomoclinicBasis,
    new_basis: HomoclinicBasis,
}

impl HomoclinicChartTransform {
    pub(crate) fn new(old_basis: &HomoclinicBasis, new_basis: &HomoclinicBasis) -> Result<Self> {
        if old_basis.dim != new_basis.dim
            || old_basis.nneg != new_basis.nneg
            || old_basis.npos != new_basis.npos
            || old_basis.nneg == 0
            || old_basis.npos == 0
            || old_basis.nneg + old_basis.npos != old_basis.dim
        {
            bail!("Homoclinic chart refresh changed invariant-subspace dimensions");
        }
        for basis in [old_basis, new_basis] {
            if basis.stable_q.len() != basis.dim * basis.dim
                || basis.unstable_q.len() != basis.dim * basis.dim
                || basis
                    .stable_q
                    .iter()
                    .chain(&basis.unstable_q)
                    .any(|value| !value.is_finite())
            {
                bail!("Homoclinic chart basis is incomplete or non-finite");
            }
        }
        Ok(Self {
            old_basis: old_basis.clone(),
            new_basis: new_basis.clone(),
        })
    }

    pub(crate) fn new_basis(&self) -> &HomoclinicBasis {
        &self.new_basis
    }

    pub(crate) fn transform_values(&self, values: &[f64]) -> Result<Vec<f64>> {
        let y_size = self.old_basis.nneg * self.old_basis.npos;
        if values.len() < 2 * y_size {
            bail!("Homoclinic state is too short for a Riccati chart refresh");
        }
        let tail = values.len() - 2 * y_size;
        let yu = DMatrix::from_row_slice(
            self.old_basis.nneg,
            self.old_basis.npos,
            &values[tail..tail + y_size],
        );
        let ys = DMatrix::from_row_slice(
            self.old_basis.npos,
            self.old_basis.nneg,
            &values[tail + y_size..],
        );
        let old_u = basis_matrix(&self.old_basis.unstable_q, self.old_basis.dim)?;
        let new_u = basis_matrix(&self.new_basis.unstable_q, self.new_basis.dim)?;
        let old_s = basis_matrix(&self.old_basis.stable_q, self.old_basis.dim)?;
        let new_s = basis_matrix(&self.new_basis.stable_q, self.new_basis.dim)?;
        let transformed_yu = transform_graph_coordinates(
            &old_u,
            &new_u,
            &yu,
            self.old_basis.npos,
            self.old_basis.nneg,
        )?;
        let transformed_ys = transform_graph_coordinates(
            &old_s,
            &new_s,
            &ys,
            self.old_basis.nneg,
            self.old_basis.npos,
        )?;

        let mut transformed = values.to_vec();
        let mut index = tail;
        for row in 0..transformed_yu.nrows() {
            for column in 0..transformed_yu.ncols() {
                transformed[index] = transformed_yu[(row, column)];
                index += 1;
            }
        }
        for row in 0..transformed_ys.nrows() {
            for column in 0..transformed_ys.ncols() {
                transformed[index] = transformed_ys[(row, column)];
                index += 1;
            }
        }
        Ok(transformed)
    }

    /// Directional derivative of the exact chart map. Non-Riccati components
    /// are copied analytically; a centered difference is used only for the
    /// small rational graph-coordinate block.
    pub(crate) fn transform_tangent(
        &self,
        aug_state: &DVector<f64>,
        tangent: &DVector<f64>,
    ) -> Result<DVector<f64>> {
        if aug_state.len() != tangent.len() {
            bail!("Homoclinic chart tangent dimension mismatch");
        }
        let y_size = self.old_basis.nneg * self.old_basis.npos;
        if aug_state.len() < 2 * y_size {
            bail!("Homoclinic tangent is too short for a Riccati chart refresh");
        }
        let tail = aug_state.len() - 2 * y_size;
        let y_direction_norm = tangent.rows(tail, 2 * y_size).norm().max(1.0);
        let step = 1e-6 / y_direction_norm;
        let mut plus = aug_state.clone();
        let mut minus = aug_state.clone();
        for index in tail..aug_state.len() {
            plus[index] += step * tangent[index];
            minus[index] -= step * tangent[index];
        }
        let plus = self.transform_values(plus.as_slice())?;
        let minus = self.transform_values(minus.as_slice())?;
        let mut transformed = tangent.clone();
        for index in tail..aug_state.len() {
            transformed[index] = (plus[index] - minus[index]) / (2.0 * step);
        }
        if transformed.iter().any(|value| !value.is_finite()) {
            bail!("Homoclinic chart produced a non-finite tangent");
        }
        Ok(transformed)
    }
}

fn basis_matrix(values: &[f64], dim: usize) -> Result<DMatrix<f64>> {
    if values.len() != dim * dim {
        bail!("Homoclinic basis matrix has invalid dimensions");
    }
    Ok(DMatrix::from_column_slice(dim, dim, values))
}

fn transform_graph_coordinates(
    old_q: &DMatrix<f64>,
    new_q: &DMatrix<f64>,
    old_y: &DMatrix<f64>,
    leading_dim: usize,
    trailing_dim: usize,
) -> Result<DMatrix<f64>> {
    let dim = leading_dim + trailing_dim;
    if old_q.shape() != (dim, dim)
        || new_q.shape() != (dim, dim)
        || old_y.shape() != (trailing_dim, leading_dim)
    {
        bail!("Riccati graph-coordinate dimensions do not match their bases");
    }
    let mut graph = DMatrix::zeros(dim, trailing_dim);
    for row in 0..leading_dim {
        for column in 0..trailing_dim {
            graph[(row, column)] = -old_y[(column, row)];
        }
    }
    for index in 0..trailing_dim {
        graph[(leading_dim + index, index)] = 1.0;
    }
    let in_new_chart = new_q.transpose() * old_q * graph;
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
        || smallest <= RICCATI_CHART_RELATIVE_RANK_TOLERANCE * largest.max(1.0)
        || largest / smallest > RICCATI_CHART_MAX_CONDITION
    {
        bail!(
            "Riccati chart refresh is rank-deficient or ill-conditioned (sigma_min={smallest:.3e}, sigma_max={largest:.3e})"
        );
    }
    // X = top * bottom^{-1}; solve bottom^T X^T = top^T without forming an inverse.
    let solved_transpose = bottom
        .transpose()
        .lu()
        .solve(&top.transpose())
        .ok_or_else(|| anyhow!("Riccati chart refresh graph solve failed"))?;
    Ok(-solved_transpose.transpose())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicGuess {
    pub mesh_states: Vec<Vec<f64>>,
    pub stage_states: Vec<Vec<Vec<f64>>>,
    pub x0: Vec<f64>,
    pub param1_value: f64,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub yu: Vec<f64>,
    pub ys: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicSetup {
    pub guess: HomoclinicGuess,
    /// Whether `guess` is a corrected point on the homoclinic branch.
    ///
    /// Approximate large-cycle, BT, and initial homotopy profiles must leave
    /// this false so their seed-to-first-corrected transition cannot create a
    /// spurious special-point bracket. Saved corrected endpoints set it true,
    /// including restart and extension seeds. Missing legacy wire fields are
    /// conservatively treated as approximate.
    #[serde(default)]
    pub initial_seed_is_corrected: bool,
    pub ntst: usize,
    pub ncol: usize,
    /// Strictly increasing normalized interval boundaries. Empty preserves the
    /// legacy uniform-mesh wire representation.
    #[serde(default)]
    pub normalized_mesh: Vec<f64>,
    /// Fixed-NTST defect-control settings for homoclinic collocation.
    #[serde(default)]
    pub collocation_adaptivity: CollocationAdaptivitySettings,
    /// Optional persisted adaptation provenance used when restarting or
    /// extending an existing curve.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collocation_adaptation: Option<CollocationAdaptationReport>,
    /// Accepted-step cadence for recomputing the stable/unstable reference
    /// frames. `0` disables refreshes; the default matches HBK's cadence of 2.
    #[serde(default = "default_projector_refresh_interval")]
    pub projector_refresh_interval: usize,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_name: String,
    pub param2_name: String,
    pub base_params: Vec<f64>,
    pub extras: HomoclinicExtraFlags,
    pub basis: HomoclinicBasis,
}

impl HomoclinicSetup {
    pub fn resolved_normalized_mesh(&self) -> Result<Vec<f64>> {
        validated_normalized_mesh(self.ntst, &self.normalized_mesh)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomotopySaddleSetup {
    pub stage: HomotopyStage,
    pub eps1_tol: f64,
    pub setup: HomoclinicSetup,
    pub u_params: Vec<f64>,
    pub s_params: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct DecodedHomoclinicState {
    pub mesh_states: Vec<Vec<f64>>,
    pub stage_states: Vec<Vec<Vec<f64>>>,
    pub x0: Vec<f64>,
    pub param2_value: f64,
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
    pub yu: Vec<f64>,
    pub ys: Vec<f64>,
    pub nneg: usize,
    pub npos: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct HomoclinicFixedScalars {
    pub time: f64,
    pub eps0: f64,
    pub eps1: f64,
}

pub fn pack_homoclinic_state(setup: &HomoclinicSetup) -> Vec<f64> {
    let mut flat = Vec::new();
    flat.extend(setup.guess.mesh_states.iter().flatten().copied());
    flat.extend(
        setup
            .guess
            .stage_states
            .iter()
            .flat_map(|interval| interval.iter().flatten())
            .copied(),
    );
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

pub fn decode_homoclinic_state(
    flat_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
    extras: HomoclinicExtraFlags,
    fixed_time: f64,
    fixed_eps0: f64,
    fixed_eps1: f64,
) -> Result<DecodedHomoclinicState> {
    decode_homoclinic_state_impl(
        flat_state, dim, ntst, ncol, extras, fixed_time, fixed_eps0, fixed_eps1, None,
    )
}

pub fn decode_homoclinic_state_with_basis(
    flat_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
    extras: HomoclinicExtraFlags,
    fixed_time: f64,
    fixed_eps0: f64,
    fixed_eps1: f64,
    basis_dims: (usize, usize),
) -> Result<DecodedHomoclinicState> {
    decode_homoclinic_state_impl(
        flat_state,
        dim,
        ntst,
        ncol,
        extras,
        fixed_time,
        fixed_eps0,
        fixed_eps1,
        Some(basis_dims),
    )
}

fn decode_homoclinic_state_impl(
    flat_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
    extras: HomoclinicExtraFlags,
    fixed_time: f64,
    fixed_eps0: f64,
    fixed_eps1: f64,
    basis_dims: Option<(usize, usize)>,
) -> Result<DecodedHomoclinicState> {
    if dim == 0 {
        bail!("State dimension must be positive");
    }
    let mesh_len = (ntst + 1) * dim;
    let stage_len = ntst * ncol * dim;
    let header = mesh_len + stage_len + dim + 1;
    let free_extras = extras.free_count();
    if flat_state.len() < header + free_extras {
        bail!("Homoclinic state is too short for configured mesh and extras");
    }

    let mut index = 0usize;
    let mesh_states = reshape_rows(&flat_state[index..index + mesh_len], dim);
    index += mesh_len;

    let mut stage_states = Vec::with_capacity(ntst);
    for _ in 0..ntst {
        let interval = reshape_rows(&flat_state[index..index + ncol * dim], dim);
        stage_states.push(interval);
        index += ncol * dim;
    }

    let x0 = flat_state[index..index + dim].to_vec();
    index += dim;
    let param2_value = flat_state[index];
    index += 1;

    let mut time = fixed_time;
    let mut eps0 = fixed_eps0;
    let mut eps1 = fixed_eps1;
    if extras.free_time {
        time = flat_state[index];
        index += 1;
    }
    if extras.free_eps0 {
        eps0 = flat_state[index];
        index += 1;
    }
    if extras.free_eps1 {
        eps1 = flat_state[index];
        index += 1;
    }

    let remaining = flat_state.len().saturating_sub(index);
    let (nneg, npos) = if let Some((expected_nneg, expected_npos)) = basis_dims {
        if expected_nneg + expected_npos != dim {
            bail!("Configured Riccati basis dimensions do not match state dimension");
        }
        (expected_nneg, expected_npos)
    } else {
        deduce_subspace_dims(remaining, dim)?
    };
    let y_size = nneg * npos;
    if remaining != 2 * y_size {
        bail!("Unable to decode Riccati state from homoclinic point");
    }

    let yu = flat_state[index..index + y_size].to_vec();
    index += y_size;
    let ys = flat_state[index..index + y_size].to_vec();

    Ok(DecodedHomoclinicState {
        mesh_states,
        stage_states,
        x0,
        param2_value,
        time,
        eps0,
        eps1,
        yu,
        ys,
        nneg,
        npos,
    })
}

pub fn homoclinic_setup_from_large_cycle(
    system: &mut EquationSystem,
    lc_state: &[f64],
    lc_ntst: usize,
    lc_ncol: usize,
    target_ntst: usize,
    target_ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HomoclinicSetup> {
    homoclinic_setup_from_large_cycle_on_mesh(
        system,
        lc_state,
        lc_ncol,
        uniform_normalized_mesh(lc_ntst),
        target_ntst,
        target_ncol,
        base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
    )
}

/// Initialize homoclinic collocation from a periodic orbit carried on an
/// explicit normalized source mesh. The legacy entry point above delegates to
/// this function with a uniform mesh.
#[allow(clippy::too_many_arguments)]
pub fn homoclinic_setup_from_large_cycle_on_mesh(
    system: &mut EquationSystem,
    lc_state: &[f64],
    lc_ncol: usize,
    lc_normalized_mesh: Vec<f64>,
    target_ntst: usize,
    target_ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HomoclinicSetup> {
    validate_homoclinic_extras(extras)?;
    validate_homoclinic_parameter_plane(base_params.len(), param1_index, param2_index)?;
    let lc_ntst = lc_normalized_mesh.len().saturating_sub(1);
    let lc_normalized_mesh = validated_normalized_mesh(lc_ntst, &lc_normalized_mesh)?;
    if lc_ntst < 3 {
        bail!("Large-cycle initialization requires at least 3 mesh intervals");
    }
    if target_ntst < 2 {
        bail!("Homoclinic meshes require at least 2 intervals");
    }
    if target_ncol == 0 {
        bail!("Collocation degree must be positive");
    }

    let dim = system.equations.len();
    let (mesh_states, stage_states, period) =
        parse_limit_cycle_state(lc_state, dim, lc_ntst, lc_ncol)?;
    validate_positive_finite("Large-cycle period", period)?;
    let (seed_x0, _seed_seam) =
        locate_cycle_equilibrium_seed(system, base_params, &mesh_states, &stage_states)?;
    let mut x0 = refine_equilibrium_seed(system, base_params, &seed_x0)?;
    let seam_interval = locate_cycle_seam_by_distance(&mesh_states, &stage_states, &x0);
    let reduced = rotate_and_drop_interval(&mesh_states, &stage_states, seam_interval)?;
    let (reduced_normalized_mesh, retained_fraction) =
        rotated_open_normalized_mesh(&lc_normalized_mesh, seam_interval)?;
    let reduced_period = period * retained_fraction;
    let target_normalized_mesh = uniform_normalized_mesh(target_ntst);

    let remeshed = remesh_open_orbit_on_mesh(
        &reduced.mesh_states,
        &reduced.stage_states,
        reduced_period,
        &reduced_normalized_mesh,
        &target_normalized_mesh,
        target_ncol,
    )?;

    let mut eps0 = l2_distance(&remeshed.mesh_states[0], &x0);
    let mut eps1 = l2_distance(
        remeshed
            .mesh_states
            .last()
            .ok_or_else(|| anyhow!("Homoclinic mesh is empty"))?,
        &x0,
    );
    if eps0 <= 1e-10 || eps1 <= 1e-10 {
        for value in &mut x0 {
            *value += 1e-4;
        }
        eps0 = l2_distance(&remeshed.mesh_states[0], &x0);
        eps1 = l2_distance(
            remeshed
                .mesh_states
                .last()
                .ok_or_else(|| anyhow!("Homoclinic mesh is empty"))?,
            &x0,
        );
    }
    eps0 = eps0.max(1e-8);
    eps1 = eps1.max(1e-8);
    validate_homoclinic_scalars(remeshed.period * 0.5, eps0, eps1)?;

    let params = base_params.to_vec();
    let param1_value = params[param1_index];
    let param2_value = params[param2_index];

    let basis = compute_homoclinic_basis(system, &x0, &params)?;
    let y_size = basis.nneg * basis.npos;

    Ok(HomoclinicSetup {
        guess: HomoclinicGuess {
            mesh_states: remeshed.mesh_states,
            stage_states: remeshed.stage_states,
            x0,
            param1_value,
            param2_value,
            time: remeshed.period * 0.5,
            eps0,
            eps1,
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        initial_seed_is_corrected: false,
        ntst: target_ntst,
        ncol: target_ncol,
        normalized_mesh: Vec::new(),
        collocation_adaptivity: CollocationAdaptivitySettings::default(),
        collocation_adaptation: None,
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: params,
        extras,
        basis,
    })
}

pub fn homoclinic_setup_from_homoclinic_point(
    system: &mut EquationSystem,
    point_state: &[f64],
    source_ntst: usize,
    source_ncol: usize,
    target_ntst: usize,
    target_ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HomoclinicSetup> {
    homoclinic_setup_from_homoclinic_point_on_mesh(
        system,
        point_state,
        source_ncol,
        uniform_normalized_mesh(source_ntst),
        target_ncol,
        uniform_normalized_mesh(target_ntst),
        base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
    )
}

/// Restart a homoclinic collocation point carried on explicit source and
/// destination meshes. This is the mesh-preserving Method 2 entry point for
/// adaptive branches; the legacy initializer above delegates with uniform
/// source and destination coordinates.
#[allow(clippy::too_many_arguments)]
pub fn homoclinic_setup_from_homoclinic_point_on_mesh(
    system: &mut EquationSystem,
    point_state: &[f64],
    source_ncol: usize,
    source_normalized_mesh: Vec<f64>,
    target_ncol: usize,
    target_normalized_mesh: Vec<f64>,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HomoclinicSetup> {
    homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh(
        system,
        point_state,
        source_ncol,
        source_normalized_mesh,
        target_ncol,
        target_normalized_mesh,
        base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
        extras,
        None,
    )
}

pub fn homoclinic_setup_from_homoclinic_point_with_source_extras(
    system: &mut EquationSystem,
    point_state: &[f64],
    source_ntst: usize,
    source_ncol: usize,
    target_ntst: usize,
    target_ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    target_extras: HomoclinicExtraFlags,
    source_extras: HomoclinicExtraFlags,
    source_fixed: Option<HomoclinicFixedScalars>,
) -> Result<HomoclinicSetup> {
    homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh(
        system,
        point_state,
        source_ncol,
        uniform_normalized_mesh(source_ntst),
        target_ncol,
        uniform_normalized_mesh(target_ntst),
        base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        target_extras,
        source_extras,
        source_fixed,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh(
    system: &mut EquationSystem,
    point_state: &[f64],
    source_ncol: usize,
    source_normalized_mesh: Vec<f64>,
    target_ncol: usize,
    target_normalized_mesh: Vec<f64>,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    target_extras: HomoclinicExtraFlags,
    source_extras: HomoclinicExtraFlags,
    source_fixed: Option<HomoclinicFixedScalars>,
) -> Result<HomoclinicSetup> {
    validate_homoclinic_extras(target_extras)?;
    validate_homoclinic_extras(source_extras)?;
    validate_homoclinic_parameter_plane(base_params.len(), param1_index, param2_index)?;
    let source_ntst = source_normalized_mesh.len().saturating_sub(1);
    let source_normalized_mesh = validated_normalized_mesh(source_ntst, &source_normalized_mesh)?;
    let target_ntst = target_normalized_mesh.len().saturating_sub(1);
    let target_normalized_mesh = validated_normalized_mesh(target_ntst, &target_normalized_mesh)?;
    if source_ntst < 2 || target_ntst < 2 {
        bail!("Homoclinic restart meshes require at least 2 intervals");
    }
    if source_ncol == 0 || target_ncol == 0 {
        bail!("Homoclinic restart collocation degrees must be positive");
    }
    let dim = system.equations.len();
    let inferred = infer_fixed_homoclinic_extras(point_state, dim, source_ntst, source_ncol);
    let source_scalars = source_fixed.unwrap_or(HomoclinicFixedScalars {
        time: inferred.time,
        eps0: inferred.eps0,
        eps1: inferred.eps1,
    });

    if !source_extras.free_time && (!source_scalars.time.is_finite() || source_scalars.time <= 0.0)
    {
        bail!("Homoclinic restart requires finite positive source time for fixed-time seeds");
    }
    if !source_extras.free_eps0 && (!source_scalars.eps0.is_finite() || source_scalars.eps0 <= 0.0)
    {
        bail!("Homoclinic restart requires finite positive source eps0 for fixed-eps0 seeds");
    }
    if !source_extras.free_eps1 && (!source_scalars.eps1.is_finite() || source_scalars.eps1 <= 0.0)
    {
        bail!("Homoclinic restart requires finite positive source eps1 for fixed-eps1 seeds");
    }

    let decoded = decode_homoclinic_state(
        point_state,
        dim,
        source_ntst,
        source_ncol,
        source_extras,
        source_scalars.time,
        source_scalars.eps0,
        source_scalars.eps1,
    )?;
    validate_homoclinic_scalars(decoded.time, decoded.eps0, decoded.eps1)?;

    let remeshed = remesh_open_orbit_on_mesh(
        &decoded.mesh_states,
        &decoded.stage_states,
        decoded.time * 2.0,
        &source_normalized_mesh,
        &target_normalized_mesh,
        target_ncol,
    )?;

    let params = base_params.to_vec();
    let param1_value = params[param1_index];
    let param2_value = params[param2_index];

    let basis = compute_homoclinic_basis(system, &decoded.x0, &params)?;
    let y_size = basis.nneg * basis.npos;

    Ok(HomoclinicSetup {
        guess: HomoclinicGuess {
            mesh_states: remeshed.mesh_states,
            stage_states: remeshed.stage_states,
            x0: decoded.x0,
            param1_value,
            param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        initial_seed_is_corrected: true,
        ntst: target_ntst,
        ncol: target_ncol,
        normalized_mesh: target_normalized_mesh,
        collocation_adaptivity: CollocationAdaptivitySettings::default(),
        collocation_adaptation: None,
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: params,
        extras: target_extras,
        basis,
    })
}

#[derive(Debug, Clone, Copy)]
struct InferredHomoclinicExtras {
    time: f64,
    eps0: f64,
    eps1: f64,
}

fn infer_fixed_homoclinic_extras(
    point_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> InferredHomoclinicExtras {
    let defaults = InferredHomoclinicExtras {
        time: 1.0,
        eps0: 1e-2,
        eps1: 1e-2,
    };

    if dim == 0 {
        return defaults;
    }

    let mesh_len = (ntst + 1) * dim;
    let stage_len = ntst * ncol * dim;
    let x0_start = mesh_len + stage_len;
    let x0_end = x0_start + dim;
    if point_state.len() < x0_end || mesh_len < dim {
        return defaults;
    }

    let first_mesh = &point_state[0..dim];
    let last_mesh = &point_state[mesh_len - dim..mesh_len];
    let x0 = &point_state[x0_start..x0_end];

    let eps0 = l2_distance(first_mesh, x0).max(1e-8);
    let eps1 = l2_distance(last_mesh, x0).max(1e-8);

    InferredHomoclinicExtras {
        time: defaults.time,
        eps0,
        eps1,
    }
}

pub fn homotopy_saddle_setup_from_equilibrium(
    system: &mut EquationSystem,
    equilibrium_state: &[f64],
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    ntst: usize,
    ncol: usize,
    eps0: f64,
    eps1: f64,
    time: f64,
    eps1_tol: f64,
) -> Result<HomotopySaddleSetup> {
    validate_homoclinic_parameter_plane(base_params.len(), param1_index, param2_index)?;
    validate_homoclinic_scalars(time, eps0, eps1)?;
    validate_positive_finite("Homotopy-saddle eps1 tolerance", eps1_tol)?;
    if ntst < 2 || ncol == 0 {
        bail!("Invalid homotopy-saddle mesh configuration");
    }

    let params = base_params.to_vec();
    let param1_value = params[param1_index];
    let param2_value = params[param2_index];

    let basis = compute_homoclinic_basis(system, equilibrium_state, &params)?;
    if basis.nneg == 0 || basis.npos == 0 {
        bail!("Cannot initialize homotopy-saddle when one invariant subspace has dimension zero");
    }

    let unstable_seed = first_basis_vector(&basis.unstable_q, basis.dim);
    let stable_seed = first_basis_vector(&basis.stable_q, basis.dim);
    let start = add_scaled(equilibrium_state, &unstable_seed, eps0);
    let end = add_scaled(equilibrium_state, &stable_seed, eps1);
    let mesh_states = linear_open_mesh(&start, &end, ntst)?;
    let coeffs = CollocationCoefficients::new(ncol)?;
    let stage_states = build_stage_states_open(&mesh_states, &coeffs.nodes);

    let y_size = basis.nneg * basis.npos;
    let setup = HomoclinicSetup {
        guess: HomoclinicGuess {
            mesh_states,
            stage_states,
            x0: equilibrium_state.to_vec(),
            param1_value,
            param2_value,
            time,
            eps0,
            eps1,
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        initial_seed_is_corrected: false,
        ntst,
        ncol,
        normalized_mesh: Vec::new(),
        collocation_adaptivity: CollocationAdaptivitySettings::default(),
        collocation_adaptation: None,
        projector_refresh_interval: DEFAULT_PROJECTOR_REFRESH_INTERVAL,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: params,
        extras: HOMOTOPY_SADDLE_EXTRAS,
        basis,
    };

    let npos = setup.basis.npos;
    Ok(HomotopySaddleSetup {
        stage: HomotopyStage::StageA,
        eps1_tol,
        setup,
        u_params: vec![0.0; npos],
        s_params: vec![0.0; npos],
    })
}

pub fn homoclinic_setup_from_homotopy_saddle_point(
    system: &mut EquationSystem,
    stage_d_state: &[f64],
    source_ntst: usize,
    source_ncol: usize,
    target_ntst: usize,
    target_ncol: usize,
    base_params: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    extras: HomoclinicExtraFlags,
) -> Result<HomoclinicSetup> {
    let mut setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
        system,
        stage_d_state,
        source_ntst,
        source_ncol,
        target_ntst,
        target_ncol,
        base_params,
        param1_index,
        param2_index,
        param1_name,
        param2_name,
        extras,
        HOMOTOPY_SADDLE_EXTRAS,
        None,
    )?;
    // Method 3 currently produces a staged heuristic profile. A StageD label
    // alone is not certification that the seed lies on the corrected HomHS
    // curve, so Method 4 must suppress seed-to-first event bracketing just like
    // the large-cycle and BT predictors. The first accepted HomHS correction
    // establishes the trusted frontier for subsequent steps.
    setup.initial_seed_is_corrected = false;
    Ok(setup)
}

pub fn compute_homoclinic_basis(
    system: &mut EquationSystem,
    x0: &[f64],
    params: &[f64],
) -> Result<HomoclinicBasis> {
    if x0.is_empty() {
        bail!("Equilibrium seed must be non-empty");
    }
    if system.params.len() != params.len() {
        bail!("Parameter vector length mismatch");
    }

    let old_params = system.params.clone();
    system.params.copy_from_slice(params);
    let jac_data = compute_jacobian(system, SystemKind::Flow, x0)?;
    system.params = old_params;

    let dim = x0.len();
    let jac = DMatrix::from_row_slice(dim, dim, &jac_data);
    let eigenvalues: Vec<Complex<f64>> =
        jac.clone().complex_eigenvalues().iter().copied().collect();
    let spectral_scale = jac.norm().max(1.0);
    let hyperbolicity_tolerance = HYPERBOLICITY_RELATIVE_TOLERANCE * spectral_scale;
    if let Some(center) = eigenvalues.iter().find(|ev| {
        !ev.re.is_finite() || !ev.im.is_finite() || ev.re.abs() <= hyperbolicity_tolerance
    }) {
        bail!(
            "Homoclinic saddle is not sufficiently hyperbolic: eigenvalue {} + {}i has real part within {:.3e} of zero",
            center.re,
            center.im,
            hyperbolicity_tolerance
        );
    }
    let nneg = eigenvalues.iter().filter(|ev| ev.re < 0.0).count();
    let npos = dim.saturating_sub(nneg);
    if nneg == 0 || npos == 0 {
        bail!("Cannot build homoclinic basis with zero-dimensional stable or unstable subspace");
    }

    let unstable_q = compute_real_subspace_basis(&jac, &eigenvalues, false, npos)?;
    let stable_q = compute_real_subspace_basis(&jac, &eigenvalues, true, nneg)?;

    Ok(HomoclinicBasis {
        stable_q,
        unstable_q,
        dim,
        nneg,
        npos,
    })
}

const EIGENVALUE_CLUSTER_RELATIVE_TOLERANCE: f64 = 1.0e-9;
const EIGENSPACE_NULL_RELATIVE_TOLERANCE: f64 = 1.0e-8;
const REAL_SUBSPACE_RANK_RELATIVE_TOLERANCE: f64 = 1.0e-10;

#[derive(Debug, Clone, Copy)]
struct EigenvalueCluster {
    lambda: Complex<f64>,
    algebraic_count: usize,
}

fn compute_real_subspace_basis(
    jac: &DMatrix<f64>,
    eigenvalues: &[Complex<f64>],
    stable: bool,
    target_dim: usize,
) -> Result<Vec<f64>> {
    let dim = jac.nrows();
    if dim == 0 || jac.ncols() != dim || target_dim == 0 || target_dim > dim {
        bail!("Invalid matrix or target dimension for a homoclinic invariant subspace");
    }
    let selected = eigenvalues
        .iter()
        .copied()
        .filter(|eigenvalue| {
            if stable {
                eigenvalue.re < 0.0
            } else {
                eigenvalue.re > 0.0
            }
        })
        .collect::<Vec<_>>();
    if selected.len() != target_dim {
        bail!(
            "Homoclinic invariant-subspace spectrum has rank {}, expected {}",
            selected.len(),
            target_dim
        );
    }
    let spectral_scale = selected
        .iter()
        .map(|value| value.norm())
        .fold(jac.norm().max(1.0), f64::max);
    let cluster_tolerance = EIGENVALUE_CLUSTER_RELATIVE_TOLERANCE * spectral_scale;
    let mut clusters = Vec::<EigenvalueCluster>::new();
    for eigenvalue in selected {
        let canonical = Complex::new(
            eigenvalue.re,
            if eigenvalue.im.abs() <= cluster_tolerance {
                0.0
            } else {
                eigenvalue.im.abs()
            },
        );
        if let Some(cluster) = clusters
            .iter_mut()
            .find(|cluster| (cluster.lambda - canonical).norm() <= cluster_tolerance)
        {
            cluster.algebraic_count += 1;
        } else {
            clusters.push(EigenvalueCluster {
                lambda: canonical,
                algebraic_count: 1,
            });
        }
    }
    clusters.sort_by(|left, right| {
        let real_order = if stable {
            right.lambda.re.total_cmp(&left.lambda.re)
        } else {
            left.lambda.re.total_cmp(&right.lambda.re)
        };
        real_order.then_with(|| right.lambda.im.total_cmp(&left.lambda.im))
    });

    let mut invariant_columns = Vec::<DVector<f64>>::with_capacity(target_dim);
    for cluster in clusters {
        let nonreal = cluster.lambda.im > cluster_tolerance;
        let complex_multiplicity = if nonreal {
            if cluster.algebraic_count % 2 != 0 {
                bail!(
                    "Homoclinic invariant-subspace spectrum has an unpaired eigenvalue {} + {}i",
                    cluster.lambda.re,
                    cluster.lambda.im
                );
            }
            cluster.algebraic_count / 2
        } else {
            cluster.algebraic_count
        };
        let expected_real_rank = cluster.algebraic_count;
        let cluster_start = invariant_columns.len();
        let eigenspace = complex_eigenspace_vectors(jac, cluster.lambda, complex_multiplicity)?;
        for eigenvector in eigenspace {
            let candidates = [
                DVector::from_iterator(dim, eigenvector.iter().map(|value| value.re)),
                DVector::from_iterator(dim, eigenvector.iter().map(|value| value.im)),
            ];
            for candidate in candidates {
                if invariant_columns.len() - cluster_start >= expected_real_rank {
                    break;
                }
                push_rank_revealing_column(&mut invariant_columns, candidate);
            }
        }
        let actual_real_rank = invariant_columns.len() - cluster_start;
        if actual_real_rank != expected_real_rank {
            bail!(
                "Homoclinic invariant eigenspace at {} + {}i has real rank {}, expected {}",
                cluster.lambda.re,
                cluster.lambda.im,
                actual_real_rank,
                expected_real_rank
            );
        }
    }
    if invariant_columns.len() != target_dim {
        bail!(
            "Homoclinic invariant-subspace construction produced rank {}, expected {}",
            invariant_columns.len(),
            target_dim
        );
    }

    let invariant = DMatrix::from_columns(&invariant_columns);
    let image = jac * &invariant;
    let transverse = &image - &invariant * (invariant.transpose() * &image);
    let invariance_tolerance = 1.0e-7 * jac.norm().max(1.0) * (target_dim as f64).sqrt();
    if !transverse.norm().is_finite() || transverse.norm() > invariance_tolerance {
        bail!(
            "Homoclinic invariant-subspace residual {:.3e} exceeds tolerance {:.3e}",
            transverse.norm(),
            invariance_tolerance
        );
    }

    let mut full_columns = invariant_columns;
    for coordinate in 0..dim {
        if full_columns.len() == dim {
            break;
        }
        let mut axis = DVector::zeros(dim);
        axis[coordinate] = 1.0;
        push_rank_revealing_column(&mut full_columns, axis);
    }
    if full_columns.len() != dim {
        bail!("Failed to complete the homoclinic invariant basis orthogonally");
    }
    Ok(DMatrix::from_columns(&full_columns).as_slice().to_vec())
}

fn complex_eigenspace_vectors(
    jac: &DMatrix<f64>,
    lambda: Complex<f64>,
    multiplicity: usize,
) -> Result<Vec<DVector<Complex<f64>>>> {
    if multiplicity == 0 || multiplicity > jac.nrows() {
        bail!("Invalid homoclinic eigenspace multiplicity {multiplicity}");
    }
    let dim = jac.nrows();
    let mut shifted = jac.map(|value| Complex::new(value, 0.0));
    for index in 0..dim {
        shifted[(index, index)] -= lambda;
    }
    let decomposition = shifted.svd(false, true);
    let v_t = decomposition
        .v_t
        .ok_or_else(|| anyhow!("Failed to build homoclinic eigenspace from shifted matrix"))?;
    let singular_scale = decomposition
        .singular_values
        .iter()
        .copied()
        .fold(jac.norm().max(1.0), f64::max);
    let null_tolerance = EIGENSPACE_NULL_RELATIVE_TOLERANCE * singular_scale;
    let mut vectors = Vec::with_capacity(multiplicity);
    for offset in 0..multiplicity {
        let row = v_t.nrows() - 1 - offset;
        let singular_value = decomposition.singular_values[row];
        if !singular_value.is_finite() || singular_value > null_tolerance {
            bail!(
                "Homoclinic eigenspace at {} + {}i has geometric rank below multiplicity {} (singular value {:.3e})",
                lambda.re,
                lambda.im,
                multiplicity,
                singular_value
            );
        }
        let mut vector =
            DVector::from_iterator(dim, (0..dim).map(|column| v_t[(row, column)].conj()));
        orient_complex_vector(&mut vector)?;
        vectors.push(vector);
    }
    Ok(vectors)
}

fn orient_complex_vector(vector: &mut DVector<Complex<f64>>) -> Result<()> {
    let (pivot, norm) = vector
        .iter()
        .enumerate()
        .map(|(index, value)| (index, value.norm()))
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| right.0.cmp(&left.0))
        })
        .ok_or_else(|| anyhow!("Cannot orient an empty homoclinic eigenvector"))?;
    if !norm.is_finite() || norm <= REAL_SUBSPACE_RANK_RELATIVE_TOLERANCE {
        bail!("Homoclinic eigenvector is numerically zero");
    }
    let phase = vector[pivot].conj() / norm;
    for value in vector.iter_mut() {
        *value *= phase;
    }
    Ok(())
}

fn push_rank_revealing_column(columns: &mut Vec<DVector<f64>>, candidate: DVector<f64>) -> bool {
    if candidate.iter().any(|value| !value.is_finite()) {
        return false;
    }
    let candidate_norm = candidate.norm();
    if !candidate_norm.is_finite() || candidate_norm <= REAL_SUBSPACE_RANK_RELATIVE_TOLERANCE {
        return false;
    }
    let mut orthogonal = candidate;
    // Reorthogonalization makes the rank decision reliable for clustered and
    // strongly non-normal eigenspaces.
    for _ in 0..2 {
        for column in columns.iter() {
            let projection = column.dot(&orthogonal);
            orthogonal -= column * projection;
        }
    }
    let norm = orthogonal.norm();
    if !norm.is_finite() || norm <= REAL_SUBSPACE_RANK_RELATIVE_TOLERANCE * candidate_norm.max(1.0)
    {
        return false;
    }
    orthogonal /= norm;
    let pivot = orthogonal
        .iter()
        .enumerate()
        .max_by(|left, right| {
            left.1
                .abs()
                .total_cmp(&right.1.abs())
                .then_with(|| right.0.cmp(&left.0))
        })
        .map(|(index, _)| index)
        .expect("non-empty orthogonal column");
    if orthogonal[pivot] < 0.0 {
        orthogonal = -orthogonal;
    }
    columns.push(orthogonal);
    true
}

#[derive(Debug, Clone)]
struct OpenOrbit {
    mesh_states: Vec<Vec<f64>>,
    stage_states: Vec<Vec<Vec<f64>>>,
    period: f64,
}

fn parse_limit_cycle_state(
    lc_state: &[f64],
    dim: usize,
    ntst: usize,
    ncol: usize,
) -> Result<(Vec<Vec<f64>>, Vec<Vec<Vec<f64>>>, f64)> {
    let mesh_len = ntst * dim;
    let stage_len = ntst * ncol * dim;
    let expected = mesh_len + stage_len + 1;
    if lc_state.len() != expected {
        bail!(
            "Invalid limit-cycle state length: expected {}, got {}",
            expected,
            lc_state.len()
        );
    }

    let mut index = 0usize;
    let mesh_states = reshape_rows(&lc_state[index..index + mesh_len], dim);
    index += mesh_len;
    let mut stage_states = Vec::with_capacity(ntst);
    for _ in 0..ntst {
        let interval = reshape_rows(&lc_state[index..index + ncol * dim], dim);
        stage_states.push(interval);
        index += ncol * dim;
    }
    let period = lc_state[index];
    Ok((mesh_states, stage_states, period))
}

fn locate_cycle_equilibrium_seed(
    system: &mut EquationSystem,
    params: &[f64],
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
) -> Result<(Vec<f64>, usize)> {
    let old_params = system.params.clone();
    if old_params.len() != params.len() {
        bail!("Parameter vector length mismatch");
    }
    system.params.copy_from_slice(params);

    let mut best_norm = f64::INFINITY;
    let mut best_state = mesh_states
        .first()
        .cloned()
        .ok_or_else(|| anyhow!("Limit-cycle mesh is empty"))?;
    let mut seam_interval = 0usize;
    let dim = best_state.len();
    let mut work = vec![0.0; dim];

    for (interval_idx, state) in mesh_states.iter().enumerate() {
        system.apply(0.0, state, &mut work);
        let norm = l2_norm(&work);
        if norm < best_norm {
            best_norm = norm;
            best_state = state.clone();
            seam_interval = interval_idx % mesh_states.len();
        }
    }

    for (interval_idx, interval) in stage_states.iter().enumerate() {
        for stage in interval {
            system.apply(0.0, stage, &mut work);
            let norm = l2_norm(&work);
            if norm < best_norm {
                best_norm = norm;
                best_state = stage.clone();
                seam_interval = interval_idx;
            }
        }
    }

    system.params = old_params;
    Ok((best_state, seam_interval))
}

fn refine_equilibrium_seed(
    system: &mut EquationSystem,
    params: &[f64],
    seed: &[f64],
) -> Result<Vec<f64>> {
    if seed.is_empty() {
        bail!("Equilibrium seed must be non-empty");
    }
    if system.params.len() != params.len() {
        bail!("Parameter vector length mismatch");
    }

    let old_params = system.params.clone();
    system.params.copy_from_slice(params);

    let mut seed_flow = vec![0.0; seed.len()];
    system.apply(0.0, seed, &mut seed_flow);
    let initial_norm = l2_norm(&seed_flow);

    let attempts = [
        NewtonSettings {
            max_steps: 40,
            damping: 1.0,
            tolerance: 1e-11,
        },
        NewtonSettings {
            max_steps: 60,
            damping: 0.5,
            tolerance: 1e-10,
        },
        NewtonSettings {
            max_steps: 80,
            damping: 0.25,
            tolerance: 1e-9,
        },
    ];

    let mut best_state = seed.to_vec();
    let mut best_norm = initial_norm;

    for settings in attempts {
        if let Ok(solution) = solve_equilibrium(system, SystemKind::Flow, seed, settings) {
            if solution.residual_norm < best_norm {
                best_norm = solution.residual_norm;
                best_state = solution.state;
            }
            if best_norm <= 1e-10 {
                break;
            }
        }
    }

    system.params = old_params;

    if best_norm > 1e-5 {
        bail!(
            "Failed to refine equilibrium seed from large cycle (initial ||f|| = {:.3e}, best ||f|| = {:.3e}).",
            initial_norm,
            best_norm
        );
    }

    Ok(best_state)
}

fn locate_cycle_seam_by_distance(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    target: &[f64],
) -> usize {
    let mut best_dist = f64::INFINITY;
    let mut seam_interval = 0usize;

    for (interval_idx, state) in mesh_states.iter().enumerate() {
        let dist = l2_distance(state, target);
        if dist < best_dist {
            best_dist = dist;
            seam_interval = interval_idx % mesh_states.len();
        }
    }

    for (interval_idx, interval) in stage_states.iter().enumerate() {
        for stage in interval {
            let dist = l2_distance(stage, target);
            if dist < best_dist {
                best_dist = dist;
                seam_interval = interval_idx;
            }
        }
    }

    seam_interval
}

fn rotate_and_drop_interval(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    seam_interval: usize,
) -> Result<OpenOrbit> {
    let ntst = mesh_states.len();
    if ntst < 3 {
        bail!("Need at least 3 intervals to rotate and drop one interval");
    }
    if stage_states.len() != ntst {
        bail!("Stage-state interval count does not match mesh count");
    }
    let keep = ntst - 1;
    let start = (seam_interval + 1) % ntst;

    let mut new_mesh = Vec::with_capacity(keep + 1);
    let mut new_stage = Vec::with_capacity(keep);
    new_mesh.push(mesh_states[start].clone());
    for k in 0..keep {
        let old_interval = (start + k) % ntst;
        let old_next = (old_interval + 1) % ntst;
        new_stage.push(stage_states[old_interval].clone());
        new_mesh.push(mesh_states[old_next].clone());
    }

    Ok(OpenOrbit {
        mesh_states: new_mesh,
        stage_states: new_stage,
        period: 1.0,
    })
}

fn rotated_open_normalized_mesh(
    source_mesh: &[f64],
    seam_interval: usize,
) -> Result<(Vec<f64>, f64)> {
    let source_ntst = source_mesh.len().saturating_sub(1);
    let source_mesh = validated_normalized_mesh(source_ntst, source_mesh)?;
    if source_ntst < 3 {
        bail!("Need at least 3 intervals to rotate and drop one interval");
    }
    let seam_interval = seam_interval % source_ntst;
    let dropped_width = source_mesh[seam_interval + 1] - source_mesh[seam_interval];
    let retained_fraction = 1.0 - dropped_width;
    if !retained_fraction.is_finite() || retained_fraction <= 1e-12 {
        bail!("Dropping the large-cycle seam leaves no positive orbit duration");
    }

    let keep = source_ntst - 1;
    let start = (seam_interval + 1) % source_ntst;
    let mut rotated = Vec::with_capacity(keep + 1);
    rotated.push(0.0);
    let mut elapsed = 0.0;
    for offset in 0..keep {
        let interval = (start + offset) % source_ntst;
        elapsed += source_mesh[interval + 1] - source_mesh[interval];
        rotated.push(elapsed / retained_fraction);
    }
    if let Some(endpoint) = rotated.last_mut() {
        *endpoint = 1.0;
    }
    Ok((
        validated_normalized_mesh(keep, &rotated)?,
        retained_fraction,
    ))
}

fn remesh_open_orbit_on_mesh(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    period: f64,
    source_normalized_mesh: &[f64],
    target_normalized_mesh: &[f64],
    target_ncol: usize,
) -> Result<OpenOrbit> {
    if mesh_states.len() < 2 {
        bail!("Open orbit needs at least two mesh points");
    }
    let source_ntst = mesh_states.len() - 1;
    let source_normalized_mesh = validated_normalized_mesh(source_ntst, source_normalized_mesh)?;
    let target_ntst = target_normalized_mesh.len().saturating_sub(1);
    let target_normalized_mesh = validated_normalized_mesh(target_ntst, target_normalized_mesh)?;
    if stage_states.len() != source_ntst {
        bail!("Stage-state interval count does not match source mesh");
    }

    let source_ncol = stage_states
        .first()
        .map(|interval| interval.len())
        .ok_or_else(|| anyhow!("Missing stage states"))?;
    let source_coeffs = CollocationCoefficients::new(source_ncol)?;
    let mut source_times = Vec::new();
    let mut source_points = Vec::new();
    source_times.push(0.0);
    source_points.push(mesh_states[0].clone());
    for i in 0..source_ntst {
        let left = source_normalized_mesh[i];
        let width = source_normalized_mesh[i + 1] - left;
        for (j, node) in source_coeffs.nodes.iter().copied().enumerate() {
            source_times.push(left + width * node);
            source_points.push(stage_states[i][j].clone());
        }
        source_times.push(source_normalized_mesh[i + 1]);
        source_points.push(mesh_states[i + 1].clone());
    }

    let target_coeffs = CollocationCoefficients::new(target_ncol)?;
    let mut target_mesh = Vec::with_capacity(target_ntst + 1);
    let mut target_stage = Vec::with_capacity(target_ntst);
    for &tau in &target_normalized_mesh {
        target_mesh.push(interpolate_state(tau, &source_times, &source_points)?);
    }
    for i in 0..target_ntst {
        let left = target_normalized_mesh[i];
        let width = target_normalized_mesh[i + 1] - left;
        let mut interval = Vec::with_capacity(target_ncol);
        for node in target_coeffs.nodes.iter().copied() {
            let tau = left + width * node;
            interval.push(interpolate_state(tau, &source_times, &source_points)?);
        }
        target_stage.push(interval);
    }

    Ok(OpenOrbit {
        mesh_states: target_mesh,
        stage_states: target_stage,
        period,
    })
}

fn interpolate_state(tau: f64, times: &[f64], states: &[Vec<f64>]) -> Result<Vec<f64>> {
    if times.is_empty() || states.is_empty() || times.len() != states.len() {
        bail!("Invalid interpolation data");
    }
    if tau <= times[0] {
        return Ok(states[0].clone());
    }
    if tau >= times[times.len() - 1] {
        return Ok(states[times.len() - 1].clone());
    }
    let mut lower = 0usize;
    for i in 0..(times.len() - 1) {
        if times[i] <= tau && tau <= times[i + 1] {
            lower = i;
            break;
        }
    }
    let t0 = times[lower];
    let t1 = times[lower + 1];
    let alpha = if (t1 - t0).abs() > 1e-14 {
        ((tau - t0) / (t1 - t0)).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let dim = states[0].len();
    let mut out = vec![0.0; dim];
    for i in 0..dim {
        out[i] = states[lower][i] * (1.0 - alpha) + states[lower + 1][i] * alpha;
    }
    Ok(out)
}

fn build_stage_states_open(mesh_states: &[Vec<f64>], nodes: &[f64]) -> Vec<Vec<Vec<f64>>> {
    let mut out = Vec::with_capacity(mesh_states.len().saturating_sub(1));
    for i in 0..mesh_states.len().saturating_sub(1) {
        let left = &mesh_states[i];
        let right = &mesh_states[i + 1];
        let dim = left.len();
        let mut interval = Vec::with_capacity(nodes.len());
        for node in nodes.iter().copied() {
            let mut stage = vec![0.0; dim];
            for d in 0..dim {
                stage[d] = left[d] + node * (right[d] - left[d]);
            }
            interval.push(stage);
        }
        out.push(interval);
    }
    out
}

fn deduce_subspace_dims(remaining: usize, dim: usize) -> Result<(usize, usize)> {
    if remaining == 0 {
        return Ok((0, dim));
    }
    for nneg in 1..dim {
        let npos = dim - nneg;
        if 2 * nneg * npos == remaining {
            return Ok((nneg, npos));
        }
    }
    bail!(
        "Cannot infer invariant-subspace dimensions from trailing state length {}",
        remaining
    )
}

fn reshape_rows(flat: &[f64], row_len: usize) -> Vec<Vec<f64>> {
    flat.chunks(row_len).map(|chunk| chunk.to_vec()).collect()
}

fn linear_open_mesh(start: &[f64], end: &[f64], ntst: usize) -> Result<Vec<Vec<f64>>> {
    if start.len() != end.len() {
        bail!("Linear mesh endpoints must share the same dimension");
    }
    let dim = start.len();
    let mut mesh = Vec::with_capacity(ntst + 1);
    for i in 0..=ntst {
        let alpha = i as f64 / ntst as f64;
        let mut point = vec![0.0; dim];
        for d in 0..dim {
            point[d] = start[d] * (1.0 - alpha) + end[d] * alpha;
        }
        mesh.push(point);
    }
    Ok(mesh)
}

fn first_basis_vector(q_flat: &[f64], dim: usize) -> Vec<f64> {
    q_flat.iter().take(dim).copied().collect()
}

fn add_scaled(base: &[f64], dir: &[f64], scale: f64) -> Vec<f64> {
    base.iter()
        .zip(dir.iter())
        .map(|(b, d)| b + scale * d)
        .collect()
}

fn l2_distance(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| {
            let d = x - y;
            d * d
        })
        .sum::<f64>()
        .sqrt()
}

fn l2_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, OpCode};

    fn linear_system() -> EquationSystem {
        // x' = p0 * x
        // y' = -y + p1
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

    fn non_diagonal_saddle_system() -> EquationSystem {
        // x' = y, y' = x. The unstable and stable eigendirections are
        // (1, 1) and (1, -1), respectively, so extracting a matrix row in
        // place of its first column swaps the two endpoint directions.
        let eq1 = Bytecode {
            ops: vec![OpCode::LoadVar(1)],
        };
        let eq2 = Bytecode {
            ops: vec![OpCode::LoadVar(0)],
        };
        let mut system = EquationSystem::new(vec![eq1, eq2], vec![0.2, 0.1]);
        system.param_map.insert("mu".to_string(), 0);
        system.param_map.insert("nu".to_string(), 1);
        system.var_map.insert("x".to_string(), 0);
        system.var_map.insert("y".to_string(), 1);
        system
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
    fn large_cycle_setup_builds_finite_guess() {
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

        assert_eq!(setup.ntst, 5);
        assert_eq!(setup.ncol, 2);
        assert_eq!(setup.guess.mesh_states.len(), 6);
        assert!(setup.guess.time.is_finite());
        assert!(setup.guess.eps0.is_finite());
        assert!(setup.guess.eps1.is_finite());
        assert!(setup.basis.nneg > 0);
        assert!(setup.basis.npos > 0);
    }

    #[test]
    fn rotated_open_mesh_preserves_retained_nonuniform_interval_widths() {
        let source = vec![0.0, 0.1, 0.4, 0.9, 1.0];
        let (rotated, retained_fraction) =
            rotated_open_normalized_mesh(&source, 1).expect("rotated mesh");
        assert!((retained_fraction - 0.7).abs() < 1e-14);
        let expected = [0.0, 5.0 / 7.0, 6.0 / 7.0, 1.0];
        for (actual, expected) in rotated.iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-14);
        }
    }

    #[test]
    fn open_orbit_remesh_uses_explicit_source_and_destination_coordinates() {
        let remeshed = remesh_open_orbit_on_mesh(
            &[vec![0.0], vec![0.2], vec![1.0]],
            &[vec![vec![0.1]], vec![vec![0.6]]],
            3.0,
            &[0.0, 0.2, 1.0],
            &[0.0, 0.5, 1.0],
            1,
        )
        .expect("nonuniform remesh");
        assert!((remeshed.mesh_states[1][0] - 0.5).abs() < 1e-14);
        assert!((remeshed.stage_states[0][0][0] - 0.25).abs() < 1e-14);
        assert!((remeshed.stage_states[1][0][0] - 0.75).abs() < 1e-14);
        assert_eq!(remeshed.period, 3.0);
    }

    #[test]
    fn large_cycle_setup_accepts_a_nonuniform_source_mesh() {
        let mut system = linear_system();
        let source_mesh = vec![0.0, 0.08, 0.22, 0.48, 0.76, 0.92, 1.0];
        let coeffs = CollocationCoefficients::new(2).expect("coefficients");
        let mut state = Vec::new();
        for &tau in source_mesh.iter().take(source_mesh.len() - 1) {
            state.push((std::f64::consts::TAU * tau).cos());
            state.push((std::f64::consts::TAU * tau).sin());
        }
        for interval in 0..source_mesh.len() - 1 {
            let left = source_mesh[interval];
            let width = source_mesh[interval + 1] - left;
            for &node in &coeffs.nodes {
                let tau = left + width * node;
                state.push((std::f64::consts::TAU * tau).cos());
                state.push((std::f64::consts::TAU * tau).sin());
            }
        }
        state.push(std::f64::consts::TAU);

        let setup = homoclinic_setup_from_large_cycle_on_mesh(
            &mut system,
            &state,
            2,
            source_mesh,
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
        .expect("nonuniform large-cycle setup");
        assert_eq!(setup.ntst, 5);
        assert_eq!(
            setup.resolved_normalized_mesh().unwrap(),
            vec![0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
        );
        assert!(setup.guess.time.is_finite() && setup.guess.time > 0.0);
    }

    #[test]
    fn homoclinic_restart_preserves_an_adaptive_source_mesh() {
        let mut system = linear_system();
        let source_mesh = vec![0.0, 0.1, 0.7, 1.0];
        let profile = |tau: f64| vec![0.2 + tau, 0.1 + 2.0 * tau];
        let mesh_states = source_mesh.iter().copied().map(profile).collect::<Vec<_>>();
        let stage_states = source_mesh
            .windows(2)
            .map(|interval| vec![profile(0.5 * (interval[0] + interval[1]))])
            .collect::<Vec<_>>();
        let basis =
            compute_homoclinic_basis(&mut system, &[0.0, 0.1], &[0.2, 0.1]).expect("source basis");
        let source = HomoclinicSetup {
            guess: HomoclinicGuess {
                mesh_states: mesh_states.clone(),
                stage_states: stage_states.clone(),
                x0: vec![0.0, 0.1],
                param1_value: 0.2,
                param2_value: 0.1,
                time: 3.0,
                eps0: 0.2,
                eps1: 5.0_f64.sqrt(),
                yu: vec![0.0],
                ys: vec![0.0],
            },
            initial_seed_is_corrected: true,
            ntst: 3,
            ncol: 1,
            normalized_mesh: source_mesh.clone(),
            collocation_adaptivity: Default::default(),
            collocation_adaptation: None,
            projector_refresh_interval: 2,
            param1_index: 0,
            param2_index: 1,
            param1_name: "mu".into(),
            param2_name: "nu".into(),
            base_params: vec![0.2, 0.1],
            extras: HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
            basis,
        };
        let packed = pack_homoclinic_state(&source);
        let restarted = homoclinic_setup_from_homoclinic_point_on_mesh(
            &mut system,
            &packed,
            1,
            source_mesh.clone(),
            1,
            source_mesh.clone(),
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            source.extras,
        )
        .expect("adaptive homoclinic restart");

        assert!(
            restarted.initial_seed_is_corrected,
            "a saved corrected homoclinic endpoint must be trusted for first-step events"
        );
        let round_tripped: HomoclinicSetup = serde_json::from_str(
            &serde_json::to_string(&restarted).expect("serialize trusted restart"),
        )
        .expect("deserialize trusted restart");
        assert!(round_tripped.initial_seed_is_corrected);
        assert_eq!(restarted.normalized_mesh, source_mesh);
        for (actual, expected) in restarted.guess.mesh_states.iter().zip(&mesh_states) {
            assert!(
                (DVector::from_vec(actual.clone()) - DVector::from_vec(expected.clone())).norm()
                    < 1e-13
            );
        }
        for (actual, expected) in restarted.guess.stage_states.iter().zip(&stage_states) {
            assert!(
                (DVector::from_vec(actual[0].clone()) - DVector::from_vec(expected[0].clone()))
                    .norm()
                    < 1e-13
            );
        }
    }

    #[test]
    fn legacy_homoclinic_setup_deserializes_with_an_untrusted_seed() {
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
        .expect("large-cycle setup");
        let mut legacy = serde_json::to_value(&setup).expect("serialize setup");
        legacy
            .as_object_mut()
            .expect("setup object")
            .remove("initial_seed_is_corrected");
        let reloaded: HomoclinicSetup =
            serde_json::from_value(legacy).expect("deserialize legacy setup");
        assert!(!reloaded.initial_seed_is_corrected);
    }

    #[test]
    fn large_cycle_setup_refines_equilibrium_seed() {
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

        let mut f = vec![0.0; 2];
        let old_params = system.params.clone();
        system.params = vec![0.2, 0.1];
        system.apply(0.0, &setup.guess.x0, &mut f);
        system.params = old_params;

        let residual_norm = l2_norm(&f);
        assert!(
            residual_norm < 1e-8,
            "expected equilibrium seed residual < 1e-8, got {}",
            residual_norm
        );
    }

    #[test]
    fn pack_and_decode_round_trip() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 5, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            5,
            2,
            4,
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
        let flat = pack_homoclinic_state(&setup);
        let decoded = decode_homoclinic_state(
            &flat,
            2,
            setup.ntst,
            setup.ncol,
            setup.extras,
            setup.guess.time,
            setup.guess.eps0,
            setup.guess.eps1,
        )
        .expect("decode");

        assert_eq!(decoded.mesh_states.len(), setup.ntst + 1);
        assert_eq!(decoded.stage_states.len(), setup.ntst);
        assert_eq!(decoded.x0.len(), 2);
        assert!(decoded.eps0.is_finite());
        assert!(decoded.eps1.is_finite());
    }

    #[test]
    fn homotopy_saddle_setup_starts_at_stage_a() {
        let mut system = linear_system();
        let setup = homotopy_saddle_setup_from_equilibrium(
            &mut system,
            &[0.0, 0.1],
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            6,
            2,
            0.01,
            0.2,
            5.0,
            1e-3,
        )
        .expect("setup");

        assert_eq!(setup.stage, HomotopyStage::StageA);
        assert_eq!(setup.setup.ntst, 6);
        assert_eq!(setup.setup.ncol, 2);
        assert!(setup.setup.guess.eps1 > setup.setup.guess.eps0);
    }

    #[test]
    fn homotopy_saddle_setup_uses_first_basis_columns_for_non_diagonal_saddle() {
        let mut system = non_diagonal_saddle_system();
        let setup = homotopy_saddle_setup_from_equilibrium(
            &mut system,
            &[0.0, 0.0],
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            6,
            2,
            0.01,
            0.02,
            5.0,
            1e-3,
        )
        .expect("non-diagonal homotopy-saddle setup");

        let start = &setup.setup.guess.mesh_states[0];
        let end = setup.setup.guess.mesh_states.last().expect("end point");
        // A(x,y)=(y,x). Unstable directions satisfy Av=v; stable directions
        // satisfy Av=-v.
        assert!((start[1] - start[0]).abs() < 1e-10, "start={start:?}");
        assert!((end[1] + end[0]).abs() < 1e-10, "end={end:?}");
    }

    #[test]
    fn homoclinic_initializers_reject_aliased_parameter_plane() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let result = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            0,
            "mu",
            "mu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        );
        assert!(result.is_err(), "aliased continuation parameters must fail");
    }

    #[test]
    fn homoclinic_initializers_reject_three_free_extras() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let result = homoclinic_setup_from_large_cycle(
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
                free_eps0: true,
                free_eps1: true,
            },
        );
        let error = result.expect_err("three free extras must fail");
        assert!(error.to_string().contains("at most two"), "{error:#}");
    }

    #[test]
    fn homotopy_saddle_initializer_rejects_invalid_positive_scalars() {
        let invalid_cases = [
            (f64::NAN, 0.2, 5.0, 1e-3),
            (0.01, f64::INFINITY, 5.0, 1e-3),
            (0.01, 0.2, 0.0, 1e-3),
            (0.01, 0.2, 5.0, -1.0),
        ];
        for (eps0, eps1, time, eps1_tol) in invalid_cases {
            let mut system = linear_system();
            let result = homotopy_saddle_setup_from_equilibrium(
                &mut system,
                &[0.0, 0.1],
                &[0.2, 0.1],
                0,
                1,
                "mu",
                "nu",
                6,
                2,
                eps0,
                eps1,
                time,
                eps1_tol,
            );
            assert!(
                result.is_err(),
                "invalid scalars must fail: eps0={eps0}, eps1={eps1}, time={time}, eps1_tol={eps1_tol}"
            );
        }
    }

    #[test]
    fn homoclinic_basis_rejects_non_hyperbolic_equilibrium() {
        let mut system = linear_system();
        let result = compute_homoclinic_basis(&mut system, &[0.0, 0.1], &[0.0, 0.1]);
        assert!(
            result.is_err(),
            "a center eigenvalue must fail hyperbolicity"
        );
    }

    #[test]
    fn real_subspace_basis_keeps_the_full_saddle_focus_stable_space() {
        let jac = DMatrix::from_row_slice(
            4,
            4,
            &[
                0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.4, -1.3, 0.0, 0.0, 1.3, -0.4,
            ],
        );
        let eigenvalues = jac
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let basis = compute_real_subspace_basis(&jac, &eigenvalues, true, 3)
            .expect("three-dimensional stable basis");
        let q = DMatrix::from_column_slice(4, 4, &basis);
        let stable = q.columns(0, 3).into_owned();
        let image = &jac * &stable;
        let transverse = &image - &stable * (stable.transpose() * &image);
        assert!(
            transverse.norm() < 1.0e-12,
            "stable-subspace invariance residual = {}",
            transverse.norm()
        );
        assert!((stable.transpose() * stable - DMatrix::identity(3, 3)).norm() < 1.0e-12);
    }

    #[test]
    fn chart_refresh_preserves_non_diagonal_parameter_varying_riccati_spaces() {
        let basis_at = |theta: f64| {
            let unstable = DVector::from_vec(vec![theta.cos(), theta.sin()]);
            let stable = DVector::from_vec(vec![-theta.sin(), theta.cos()]);
            let unstable_q = DMatrix::from_columns(&[unstable.clone(), stable.clone()]);
            let stable_q = DMatrix::from_columns(&[stable, unstable]);
            HomoclinicBasis {
                stable_q: stable_q.iter().copied().collect(),
                unstable_q: unstable_q.iter().copied().collect(),
                dim: 2,
                nneg: 1,
                npos: 1,
            }
        };
        let old_basis = basis_at(0.0);
        let parameter = 0.43_f64;
        let new_basis = basis_at(parameter);
        let rotation = basis_matrix(&new_basis.unstable_q, 2).expect("rotation");
        let jacobian = &rotation
            * DMatrix::from_diagonal(&DVector::from_vec(vec![2.0, -1.0]))
            * rotation.transpose();

        // Start with Y=0 in the exact current eigenspace chart, express that
        // same physical pair in the old chart, then refresh back.
        let new_to_old =
            HomoclinicChartTransform::new(&new_basis, &old_basis).expect("backward chart map");
        let old_values = new_to_old
            .transform_values(&[7.0, 0.0, 0.0])
            .expect("old graph coordinates");
        let old_yu = DMatrix::from_element(1, 1, old_values[1]);
        let old_ys = DMatrix::from_element(1, 1, old_values[2]);
        let riccati = |q: &DMatrix<f64>, y: &DMatrix<f64>| {
            let transformed = q.transpose() * &jacobian * q;
            transformed[(1, 1)] * y[(0, 0)] - y[(0, 0)] * transformed[(0, 0)] + transformed[(1, 0)]
                - y[(0, 0)] * transformed[(0, 1)] * y[(0, 0)]
        };
        let old_u = basis_matrix(&old_basis.unstable_q, 2).expect("old unstable chart");
        let old_s = basis_matrix(&old_basis.stable_q, 2).expect("old stable chart");
        assert!(riccati(&old_u, &old_yu).abs() < 1e-12);
        assert!(riccati(&old_s, &old_ys).abs() < 1e-12);

        let refresh =
            HomoclinicChartTransform::new(&old_basis, &new_basis).expect("forward refresh");
        let refreshed = refresh
            .transform_values(&old_values)
            .expect("refreshed coordinates");
        assert_eq!(refreshed[0], 7.0);
        assert!(refreshed[1].abs() < 1e-12);
        assert!(refreshed[2].abs() < 1e-12);
        let new_u = basis_matrix(&new_basis.unstable_q, 2).expect("new unstable chart");
        let new_s = basis_matrix(&new_basis.stable_q, 2).expect("new stable chart");
        assert!(riccati(&new_u, &DMatrix::from_element(1, 1, refreshed[1])).abs() < 1e-12);
        assert!(riccati(&new_s, &DMatrix::from_element(1, 1, refreshed[2])).abs() < 1e-12);

        let physical_normal = |q: &DMatrix<f64>, y: f64| {
            let mut normal = q * DVector::from_vec(vec![-y, 1.0]);
            normal.normalize_mut();
            normal
        };
        assert!(
            physical_normal(&old_u, old_values[1])
                .dot(&physical_normal(&new_u, refreshed[1]))
                .abs()
                > 1.0 - 1e-12
        );
        assert!(
            physical_normal(&old_s, old_values[2])
                .dot(&physical_normal(&new_s, refreshed[2]))
                .abs()
                > 1.0 - 1e-12
        );
    }

    #[test]
    fn chart_refresh_rejects_a_singular_graph_block() {
        let old = HomoclinicBasis {
            stable_q: vec![0.0, 1.0, 1.0, 0.0],
            unstable_q: vec![1.0, 0.0, 0.0, 1.0],
            dim: 2,
            nneg: 1,
            npos: 1,
        };
        let rotated = HomoclinicBasis {
            stable_q: vec![-1.0, 0.0, 0.0, 1.0],
            unstable_q: vec![0.0, 1.0, -1.0, 0.0],
            dim: 2,
            nneg: 1,
            npos: 1,
        };
        let transform = HomoclinicChartTransform::new(&old, &rotated).expect("chart metadata");
        let error = transform
            .transform_values(&[0.0, 0.0])
            .expect_err("ninety-degree graph change must be rejected");
        assert!(error.to_string().contains("rank-deficient"), "{error:#}");
    }

    #[test]
    fn real_subspace_basis_uses_repeated_nullspace_and_rejects_defective_rank() {
        let semisimple = DMatrix::from_diagonal(&DVector::from_vec(vec![-1.0, -1.0, 1.0]));
        let semisimple_eigenvalues = semisimple
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let basis = compute_real_subspace_basis(&semisimple, &semisimple_eigenvalues, true, 2)
            .expect("semisimple repeated stable eigenspace");
        let q = DMatrix::from_column_slice(3, 3, &basis);
        let stable = q.columns(0, 2).into_owned();
        let image = &semisimple * &stable;
        assert!((&image - &stable * (stable.transpose() * &image)).norm() < 1.0e-12);

        let defective =
            DMatrix::from_row_slice(3, 3, &[-1.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0]);
        let defective_eigenvalues = defective
            .clone()
            .complex_eigenvalues()
            .iter()
            .copied()
            .collect::<Vec<_>>();
        let error = compute_real_subspace_basis(&defective, &defective_eigenvalues, true, 2)
            .expect_err("defective algebraic multiplicity must not be coordinate-padded");
        assert!(error.to_string().contains("geometric rank"), "{error:#}");
    }

    #[test]
    fn homoclinic_restart_infers_fixed_endpoint_distances() {
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
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
        )
        .expect("setup");

        let point_state = pack_homoclinic_state(&setup);
        let expected_eps1 = l2_distance(
            setup.guess.mesh_states.last().expect("last mesh point"),
            &setup.guess.x0,
        );

        let restarted = homoclinic_setup_from_homoclinic_point(
            &mut system,
            &point_state,
            setup.ntst,
            setup.ncol,
            setup.ntst,
            setup.ncol,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
        )
        .expect("restart");

        assert!(
            (restarted.guess.eps1 - expected_eps1).abs() < 1e-6,
            "expected eps1 to be inferred from endpoint distance, got {} vs {}",
            restarted.guess.eps1,
            expected_eps1
        );
        assert!(
            (restarted.guess.eps1 - 1e-2).abs() > 1e-3,
            "eps1 should not fall back to placeholder defaults"
        );
    }

    #[test]
    fn homoclinic_restart_uses_selected_parameter_plane_values() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.4, 0.2],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
        )
        .expect("setup");

        let point_state = pack_homoclinic_state(&setup);
        let restarted = homoclinic_setup_from_homoclinic_point(
            &mut system,
            &point_state,
            setup.ntst,
            setup.ncol,
            setup.ntst,
            setup.ncol,
            &[0.4, 0.2],
            1,
            0,
            "nu",
            "mu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
        )
        .expect("restart");

        assert!(
            (restarted.guess.param1_value - 0.2).abs() < 1e-12,
            "expected selected first parameter value from base params"
        );
        assert!(
            (restarted.guess.param2_value - 0.4).abs() < 1e-12,
            "expected selected second parameter value from base params"
        );
    }

    #[test]
    fn homoclinic_restart_decodes_source_state_using_source_extras() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let source_setup = homoclinic_setup_from_large_cycle(
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
        .expect("source setup");

        let point_state = pack_homoclinic_state(&source_setup);
        let restarted = homoclinic_setup_from_homoclinic_point_with_source_extras(
            &mut system,
            &point_state,
            source_setup.ntst,
            source_setup.ncol,
            source_setup.ntst,
            source_setup.ncol,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: true,
                free_eps1: false,
            },
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
            Some(HomoclinicFixedScalars {
                time: source_setup.guess.time,
                eps0: source_setup.guess.eps0,
                eps1: source_setup.guess.eps1,
            }),
        )
        .expect("restart");

        assert!(
            (restarted.guess.time - source_setup.guess.time).abs() < 1e-8,
            "expected restart guess to preserve source fixed-time scalar"
        );
        assert!(
            restarted.extras.free_time,
            "target extras should be applied"
        );
    }

    #[test]
    fn homotopy_saddle_conversion_decodes_source_extras_before_applying_target() {
        let mut system = linear_system();
        let source = homotopy_saddle_setup_from_equilibrium(
            &mut system,
            &[0.0, 0.1],
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            6,
            2,
            0.01,
            0.2,
            5.0,
            1e-3,
        )
        .expect("homotopy-saddle setup");
        assert!(
            !source.setup.initial_seed_is_corrected,
            "the initial staged profile is not yet a corrected homoclinic endpoint"
        );
        let point_state = pack_homoclinic_state(&source.setup);

        let converted = homoclinic_setup_from_homotopy_saddle_point(
            &mut system,
            &point_state,
            source.setup.ntst,
            source.setup.ncol,
            source.setup.ntst,
            source.setup.ncol,
            &source.setup.base_params,
            source.setup.param1_index,
            source.setup.param2_index,
            &source.setup.param1_name,
            &source.setup.param2_name,
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("StageD conversion");

        assert!(
            !converted.initial_seed_is_corrected,
            "a StageD label does not certify the staged heuristic as a corrected HomHS point"
        );
        assert!(
            (converted.guess.time - source.setup.guess.time).abs() < 1e-12,
            "StageD conversion must decode the source free-time value before applying target flags"
        );
        assert_eq!(
            converted.extras,
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            }
        );
    }
}
