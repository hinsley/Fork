use super::homoclinic_init::{
    homoclinic_setup_from_homotopy_saddle_point, pack_homoclinic_state, HomoclinicExtraFlags,
    HomoclinicSetup, HomotopySaddleSetup,
};
use super::types::HomotopyStage;
use super::{
    BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, ContinuationSettings,
};
use crate::equation_engine::EquationSystem;
use anyhow::{anyhow, bail, Result};

const STAGE_A_TO_B_TOL: f64 = 1e-3;
const STAGE_B_TO_C_TOL: f64 = 1e-6;

pub fn continue_homotopy_saddle_curve(
    _system: &mut EquationSystem,
    mut setup: HomotopySaddleSetup,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    if settings.max_steps == 0 {
        bail!("Homotopy-saddle continuation requires max_steps > 0");
    }
    let mut branch = ContinuationBranch {
        points: vec![state_to_point(&setup)],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::HomotopySaddleCurve {
            ntst: setup.setup.ntst,
            ncol: setup.setup.ncol,
            param1_name: setup.setup.param1_name.clone(),
            param2_name: setup.setup.param2_name.clone(),
            stage: setup.stage,
        },
        upoldp: None,
        homoc_context: None,
        resume_state: None,
        manifold_geometry: None,
    };

    let sign = if forward { 1.0 } else { -1.0 };
    let mut logical_index: i32 = 0;

    for _ in 0..settings.max_steps {
        if setup.stage == HomotopyStage::StageD {
            break;
        }
        let previous_stage = setup.stage;
        advance_stage(&mut setup, settings.step_size * sign)?;
        logical_index += if forward { 1 } else { -1 };
        branch.points.push(state_to_point(&setup));
        branch.indices.push(logical_index);
        if previous_stage != setup.stage {
            branch.bifurcations.push(branch.points.len() - 1);
        }
    }

    branch.branch_type = BranchType::HomotopySaddleCurve {
        ntst: setup.setup.ntst,
        ncol: setup.setup.ncol,
        param1_name: setup.setup.param1_name.clone(),
        param2_name: setup.setup.param2_name.clone(),
        stage: setup.stage,
    };

    Ok(branch)
}

pub fn homotopy_stage_d_to_homoclinic(
    system: &mut EquationSystem,
    setup: &HomotopySaddleSetup,
    point_state: &[f64],
    target_ntst: usize,
    target_ncol: usize,
) -> Result<HomoclinicSetup> {
    if setup.stage != HomotopyStage::StageD {
        bail!("Method 4 conversion requires a StageD homotopy-saddle point");
    }
    homoclinic_setup_from_homotopy_saddle_point(
        system,
        point_state,
        setup.setup.ntst,
        setup.setup.ncol,
        target_ntst,
        target_ncol,
        &setup.setup.base_params,
        setup.setup.param1_index,
        setup.setup.param2_index,
        &setup.setup.param1_name,
        &setup.setup.param2_name,
        HomoclinicExtraFlags {
            free_time: setup.setup.extras.free_time,
            free_eps0: setup.setup.extras.free_eps0,
            free_eps1: setup.setup.extras.free_eps1,
        },
    )
}

fn state_to_point(setup: &HomotopySaddleSetup) -> ContinuationPoint {
    ContinuationPoint {
        state: pack_homoclinic_state(&setup.setup),
        param_value: setup.setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: Some(setup.setup.guess.mesh_states.clone()),
    }
}

fn advance_stage(setup: &mut HomotopySaddleSetup, signed_step: f64) -> Result<()> {
    if setup.setup.guess.mesh_states.is_empty() {
        bail!("Homotopy-saddle setup has no mesh states");
    }
    let step = signed_step.abs().max(1e-12);
    setup.setup.guess.param1_value += signed_step;

    match setup.stage {
        HomotopyStage::StageA => {
            relax_connection_parameters(&mut setup.s_params, 0.8);
            relax_connection_parameters(&mut setup.u_params, 0.95);
            setup.setup.guess.eps1 *= 0.92;
            setup.setup.guess.time = (setup.setup.guess.time + 0.25 * step).max(1e-6);
            reshape_endpoint_distances(&mut setup.setup)?;
            if stage_ab_trigger(&setup.s_params, STAGE_A_TO_B_TOL) {
                setup.stage = HomotopyStage::StageB;
            }
        }
        HomotopyStage::StageB => {
            relax_connection_parameters(&mut setup.s_params, 0.7);
            setup.setup.guess.eps1 *= 0.88;
            setup.setup.guess.time = (setup.setup.guess.time + 0.35 * step).max(1e-6);
            reshape_endpoint_distances(&mut setup.setup)?;
            if stage_ab_trigger(&setup.s_params, STAGE_B_TO_C_TOL) {
                setup.stage = HomotopyStage::StageC;
            }
        }
        HomotopyStage::StageC => {
            setup.setup.guess.eps1 *= 0.75;
            setup.setup.guess.time = (setup.setup.guess.time + 0.5 * step).max(1e-6);
            reshape_endpoint_distances(&mut setup.setup)?;
            if setup.setup.guess.eps1 <= setup.eps1_tol {
                setup.stage = HomotopyStage::StageD;
            }
        }
        HomotopyStage::StageD => {}
    }

    Ok(())
}

fn relax_connection_parameters(values: &mut [f64], factor: f64) {
    for value in values {
        *value *= factor;
    }
}

fn stage_ab_trigger(stable_params: &[f64], threshold: f64) -> bool {
    if stable_params.is_empty() {
        return true;
    }
    let product = stable_params
        .iter()
        .fold(1.0, |acc, value| acc * value.abs());
    product <= threshold
}

fn reshape_endpoint_distances(setup: &mut HomoclinicSetup) -> Result<()> {
    let mesh = &mut setup.guess.mesh_states;
    let dim = setup.basis.dim;
    if mesh.len() < 2 {
        bail!("Need at least two mesh points for endpoint-distance update");
    }
    if setup.guess.x0.len() != dim {
        bail!("Homoclinic setup has inconsistent equilibrium dimension");
    }

    let start = mesh[0].clone();
    let end = mesh
        .last()
        .cloned()
        .ok_or_else(|| anyhow!("Homoclinic mesh is empty"))?;
    let x0 = &setup.guess.x0;

    let start_dir = normalize_or_basis_direction(
        &sub(&start, x0),
        first_basis_vector(&setup.basis.unstable_q, dim),
    );
    let end_dir = normalize_or_basis_direction(
        &sub(&end, x0),
        first_basis_vector(&setup.basis.stable_q, dim),
    );

    mesh[0] = add_scaled(x0, &start_dir, setup.guess.eps0);
    let last = mesh.len() - 1;
    mesh[last] = add_scaled(x0, &end_dir, setup.guess.eps1);

    let nodes = collocation_nodes(setup.ncol)?;
    setup.guess.stage_states = build_stage_states_open(mesh, &nodes);
    Ok(())
}

fn collocation_nodes(ncol: usize) -> Result<Vec<f64>> {
    Ok(super::periodic::CollocationCoefficients::new(ncol)?.nodes)
}

fn build_stage_states_open(mesh_states: &[Vec<f64>], nodes: &[f64]) -> Vec<Vec<Vec<f64>>> {
    let mut out = Vec::with_capacity(mesh_states.len().saturating_sub(1));
    for i in 0..mesh_states.len().saturating_sub(1) {
        let left = &mesh_states[i];
        let right = &mesh_states[i + 1];
        let mut interval = Vec::with_capacity(nodes.len());
        for node in nodes.iter().copied() {
            let mut stage = vec![0.0; left.len()];
            for d in 0..left.len() {
                stage[d] = left[d] + node * (right[d] - left[d]);
            }
            interval.push(stage);
        }
        out.push(interval);
    }
    out
}

fn normalize_or_basis_direction(candidate: &[f64], fallback: Vec<f64>) -> Vec<f64> {
    let norm = l2_norm(candidate);
    if norm > 1e-10 {
        return candidate.iter().map(|value| value / norm).collect();
    }
    let fallback_norm = l2_norm(&fallback);
    if fallback_norm > 1e-10 {
        return fallback.iter().map(|value| value / fallback_norm).collect();
    }
    let mut unit = vec![0.0; candidate.len().max(1)];
    unit[0] = 1.0;
    unit
}

fn first_basis_vector(flat: &[f64], dim: usize) -> Vec<f64> {
    let mut out = vec![0.0; dim];
    for i in 0..dim {
        out[i] = flat[i * dim];
    }
    out
}

fn add_scaled(base: &[f64], direction: &[f64], scale: f64) -> Vec<f64> {
    base.iter()
        .zip(direction.iter())
        .map(|(a, b)| a + scale * b)
        .collect()
}

fn sub(lhs: &[f64], rhs: &[f64]) -> Vec<f64> {
    lhs.iter().zip(rhs.iter()).map(|(a, b)| a - b).collect()
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::homoclinic_init::homotopy_saddle_setup_from_equilibrium;
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};

    fn linear_system() -> EquationSystem {
        // x' = p0 * x + y
        // y' = -y + p1
        let eq1 = Bytecode {
            ops: vec![
                OpCode::LoadParam(0),
                OpCode::LoadVar(0),
                OpCode::Mul,
                OpCode::LoadVar(1),
                OpCode::Add,
            ],
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

    fn settings() -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 40,
            corrector_steps: 6,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        }
    }

    #[test]
    fn stage_a_transitions_when_stable_product_collapses() {
        let mut system = linear_system();
        let mut setup = homotopy_saddle_setup_from_equilibrium(
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

        setup.s_params = vec![1e-5, 1e-5];
        advance_stage(&mut setup, 0.01).expect("advance");
        assert_eq!(setup.stage, HomotopyStage::StageB);
    }

    #[test]
    fn stage_c_reaches_stage_d_with_eps_tolerance() {
        let mut system = linear_system();
        let mut setup = homotopy_saddle_setup_from_equilibrium(
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
            0.01,
            5.0,
            5e-3,
        )
        .expect("setup");
        setup.stage = HomotopyStage::StageC;
        setup.setup.guess.eps1 = 4e-3;
        advance_stage(&mut setup, 0.01).expect("advance");
        assert_eq!(setup.stage, HomotopyStage::StageD);
    }

    #[test]
    fn continuation_marks_stage_transitions_as_special_points() {
        let mut system = linear_system();
        let mut setup = homotopy_saddle_setup_from_equilibrium(
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
        setup.s_params = vec![1e-5, 1e-5];
        let branch =
            continue_homotopy_saddle_curve(&mut system, setup, settings(), true).expect("branch");

        assert!(!branch.points.is_empty());
        assert!(!branch.bifurcations.is_empty());
        assert!(matches!(
            branch.branch_type,
            BranchType::HomotopySaddleCurve { .. }
        ));
    }
}
