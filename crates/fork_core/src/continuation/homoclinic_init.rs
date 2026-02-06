use super::periodic::CollocationCoefficients;
use super::types::HomotopyStage;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, solve_equilibrium, NewtonSettings, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicBasis {
    pub stable_q: Vec<f64>,
    pub unstable_q: Vec<f64>,
    pub dim: usize,
    pub nneg: usize,
    pub npos: usize,
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
    pub ntst: usize,
    pub ncol: usize,
    pub param1_index: usize,
    pub param2_index: usize,
    pub param1_name: String,
    pub param2_name: String,
    pub base_params: Vec<f64>,
    pub extras: HomoclinicExtraFlags,
    pub basis: HomoclinicBasis,
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
    let (nneg, npos) = deduce_subspace_dims(remaining, dim)?;
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
    let (seed_x0, _seed_seam) =
        locate_cycle_equilibrium_seed(system, base_params, &mesh_states, &stage_states)?;
    let mut x0 = refine_equilibrium_seed(system, base_params, &seed_x0)?;
    let seam_interval = locate_cycle_seam_by_distance(&mesh_states, &stage_states, &x0);
    let reduced = rotate_and_drop_interval(&mesh_states, &stage_states, seam_interval)?;
    let reduced_period = period * (reduced.mesh_states.len() as f64 - 1.0) / (lc_ntst as f64);

    let remeshed = remesh_open_orbit(
        &reduced.mesh_states,
        &reduced.stage_states,
        reduced_period,
        target_ntst,
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

    let mut params = base_params.to_vec();
    if param1_index >= params.len() || param2_index >= params.len() {
        bail!("Parameter index out of range");
    }
    let param1_value = params[param1_index];
    let param2_value = params[param2_index];
    params[param1_index] = param1_value;
    params[param2_index] = param2_value;

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
        ntst: target_ntst,
        ncol: target_ncol,
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
    let dim = system.equations.len();
    let decoded = decode_homoclinic_state(
        point_state,
        dim,
        source_ntst,
        source_ncol,
        extras,
        1.0,
        1e-2,
        1e-2,
    )?;

    let remeshed = remesh_open_orbit(
        &decoded.mesh_states,
        &decoded.stage_states,
        decoded.time * 2.0,
        target_ntst,
        target_ncol,
    )?;

    let mut params = base_params.to_vec();
    if param1_index >= params.len() || param2_index >= params.len() {
        bail!("Parameter index out of range");
    }
    let param1_value = params[param1_index];
    params[param2_index] = decoded.param2_value;

    let basis = compute_homoclinic_basis(system, &decoded.x0, &params)?;
    let y_size = basis.nneg * basis.npos;

    Ok(HomoclinicSetup {
        guess: HomoclinicGuess {
            mesh_states: remeshed.mesh_states,
            stage_states: remeshed.stage_states,
            x0: decoded.x0,
            param1_value,
            param2_value: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            yu: vec![0.0; y_size],
            ys: vec![0.0; y_size],
        },
        ntst: target_ntst,
        ncol: target_ncol,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: params,
        extras,
        basis,
    })
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
    if eps0 <= 0.0 || eps1 <= 0.0 {
        bail!("Endpoint distances must be positive");
    }
    if ntst < 2 || ncol == 0 {
        bail!("Invalid homotopy-saddle mesh configuration");
    }

    let params = base_params.to_vec();
    if param1_index >= params.len() || param2_index >= params.len() {
        bail!("Parameter index out of range");
    }
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
        ntst,
        ncol,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: params,
        extras: HomoclinicExtraFlags {
            free_time: true,
            free_eps0: false,
            free_eps1: true,
        },
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
    homoclinic_setup_from_homoclinic_point(
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
    )
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
    let eigenvalues: Vec<Complex<f64>> = jac.clone().complex_eigenvalues().iter().copied().collect();
    let mut nneg = eigenvalues.iter().filter(|ev| ev.re < 0.0).count();
    if nneg == dim && eigenvalues.iter().any(|ev| ev.re.abs() < 1e-2) {
        nneg = nneg.saturating_sub(1);
    }
    if nneg == 0 && eigenvalues.iter().any(|ev| ev.re.abs() < 1e-2) {
        nneg = 1;
    }
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

fn compute_real_subspace_basis(
    jac: &DMatrix<f64>,
    eigenvalues: &[Complex<f64>],
    stable: bool,
    target_dim: usize,
) -> Result<Vec<f64>> {
    let dim = jac.nrows();
    let mut entries: Vec<(f64, Complex<f64>)> = eigenvalues
        .iter()
        .copied()
        .filter(|ev| if stable { ev.re < 0.0 } else { ev.re > 0.0 })
        .map(|ev| (ev.re, ev))
        .collect();

    if stable {
        entries.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    } else {
        entries.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    }

    let mut basis_cols: Vec<DVector<f64>> = Vec::new();
    for (_, lambda) in entries {
        if basis_cols.len() >= target_dim {
            break;
        }
        let vec = complex_eigenvector(jac, lambda)?;
        let real = DVector::from_vec(vec.iter().map(|z| z.re).collect());
        if real.norm() > 1e-10 {
            basis_cols.push(real);
        }
        if basis_cols.len() >= target_dim {
            break;
        }
        let imag = DVector::from_vec(vec.iter().map(|z| z.im).collect());
        if imag.norm() > 1e-10 {
            basis_cols.push(imag);
        }
    }

    for i in 0..dim {
        if basis_cols.len() >= target_dim {
            break;
        }
        let mut e = DVector::zeros(dim);
        e[i] = 1.0;
        basis_cols.push(e);
    }

    let mut first_block = DMatrix::zeros(dim, target_dim);
    for (j, col) in basis_cols.iter().take(target_dim).enumerate() {
        for i in 0..dim {
            first_block[(i, j)] = col[i];
        }
    }

    let mut full = DMatrix::zeros(dim, dim);
    for j in 0..target_dim {
        for i in 0..dim {
            full[(i, j)] = first_block[(i, j)];
        }
    }
    let mut next_col = target_dim;
    for i in 0..dim {
        if next_col >= dim {
            break;
        }
        let mut e = DVector::zeros(dim);
        e[i] = 1.0;
        for r in 0..dim {
            full[(r, next_col)] = e[r];
        }
        next_col += 1;
    }

    let qr = full.qr();
    let q = qr.q();
    Ok(q.iter().copied().collect())
}

fn complex_eigenvector(jac: &DMatrix<f64>, lambda: Complex<f64>) -> Result<Vec<Complex<f64>>> {
    let dim = jac.nrows();
    let mut shifted = jac.map(|v| Complex::new(v, 0.0));
    for i in 0..dim {
        shifted[(i, i)] -= lambda;
    }
    let svd = shifted.svd(true, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Failed to build eigenvector from shifted matrix"))?;
    let row = v_t.nrows().saturating_sub(1);
    let mut vec = Vec::with_capacity(dim);
    for i in 0..dim {
        vec.push(v_t[(row, i)].conj());
    }
    Ok(vec)
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

fn remesh_open_orbit(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    period: f64,
    target_ntst: usize,
    target_ncol: usize,
) -> Result<OpenOrbit> {
    if mesh_states.len() < 2 {
        bail!("Open orbit needs at least two mesh points");
    }
    let source_ntst = mesh_states.len() - 1;
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
        for (j, node) in source_coeffs.nodes.iter().copied().enumerate() {
            source_times.push((i as f64 + node) / (source_ntst as f64));
            source_points.push(stage_states[i][j].clone());
        }
        source_times.push((i + 1) as f64 / (source_ntst as f64));
        source_points.push(mesh_states[i + 1].clone());
    }

    let target_coeffs = CollocationCoefficients::new(target_ncol)?;
    let mut target_mesh = Vec::with_capacity(target_ntst + 1);
    let mut target_stage = Vec::with_capacity(target_ntst);
    for i in 0..=target_ntst {
        let tau = i as f64 / (target_ntst as f64);
        target_mesh.push(interpolate_state(tau, &source_times, &source_points)?);
    }
    for i in 0..target_ntst {
        let mut interval = Vec::with_capacity(target_ncol);
        for node in target_coeffs.nodes.iter().copied() {
            let tau = (i as f64 + node) / (target_ntst as f64);
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
    let mut out = vec![0.0; dim];
    for i in 0..dim {
        out[i] = q_flat[i * dim];
    }
    out
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
}
