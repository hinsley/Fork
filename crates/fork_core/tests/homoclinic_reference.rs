use fork_core::continuation::homoclinic_init::decode_homoclinic_state_with_basis;
use fork_core::continuation::periodic::CollocationCoefficients;
use fork_core::continuation::{
    continue_homoclinic_curve, homoclinic_setup_from_homoclinic_point_with_source_extras,
    homoclinic_setup_from_large_cycle, homotopy_stage_d_to_homoclinic, pack_homoclinic_state,
    ContinuationBranch, ContinuationSettings, HomoclinicExtraFlags, HomoclinicFixedScalars,
    HomoclinicSetup, HomotopySaddleSetup, HomotopyStage,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};

const SOURCE_NTST: usize = 32;
const SOURCE_NCOL: usize = 2;
const TARGET_NTST: usize = 8;
const TARGET_NCOL: usize = 2;
const DUFFING_MODULUS: f64 = 0.99;

const METHOD_EXTRAS: HomoclinicExtraFlags = HomoclinicExtraFlags {
    free_time: true,
    free_eps0: false,
    free_eps1: false,
};

const STAGE_D_EXTRAS: HomoclinicExtraFlags = HomoclinicExtraFlags {
    free_time: true,
    free_eps0: false,
    free_eps1: true,
};

fn duffing_system(params: Vec<f64>) -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string()];
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = ["y", "x-x^3+(mu-nu)*y"];
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse Duffing equation")))
        .collect();
    let mut system = EquationSystem::new(bytecode, params);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn arithmetic_geometric_mean(mut left: f64, mut right: f64) -> f64 {
    for _ in 0..32 {
        let arithmetic = 0.5 * (left + right);
        let geometric = (left * right).sqrt();
        left = arithmetic;
        right = geometric;
        if (left - right).abs() < 1e-15 {
            break;
        }
    }
    left
}

fn duffing_period_and_amplitude(modulus: f64) -> (f64, f64) {
    let frequency = 1.0 / (2.0 - modulus * modulus).sqrt();
    let amplitude = 2.0_f64.sqrt() * frequency;
    let complementary_modulus = (1.0 - modulus * modulus).sqrt();
    let complete_elliptic_k =
        std::f64::consts::PI / (2.0 * arithmetic_geometric_mean(1.0, complementary_modulus));
    let period = 2.0 * complete_elliptic_k / frequency;
    (period, amplitude)
}

fn duffing_flow(state: [f64; 2]) -> [f64; 2] {
    [state[1], state[0] - state[0].powi(3)]
}

fn rk4_duffing_step(state: [f64; 2], step: f64) -> [f64; 2] {
    let k1 = duffing_flow(state);
    let k2 = duffing_flow([state[0] + 0.5 * step * k1[0], state[1] + 0.5 * step * k1[1]]);
    let k3 = duffing_flow([state[0] + 0.5 * step * k2[0], state[1] + 0.5 * step * k2[1]]);
    let k4 = duffing_flow([state[0] + step * k3[0], state[1] + step * k3[1]]);
    [
        state[0] + step * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]) / 6.0,
        state[1] + step * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]) / 6.0,
    ]
}

fn duffing_cycle_state_at(time: f64, amplitude: f64) -> Vec<f64> {
    let steps = (time / 1e-3).ceil().max(1.0) as usize;
    let step = time / steps as f64;
    let mut state = [amplitude, 0.0];
    for _ in 0..steps {
        state = rk4_duffing_step(state, step);
    }
    state.to_vec()
}

/// The conservative Duffing equation has the exact periodic family
///
/// x(t) = A dn(omega t, k),  A^2 = 2 / (2-k^2),
///
/// whose period diverges and whose inner turning point tends to the saddle as
/// k -> 1. Sampling k=0.99 gives a deterministic large-cycle approximation to
/// the homoclinic loop. The added damping coefficient is `mu - nu`, so the
/// analytic homoclinic locus in the two-parameter plane is `mu = nu`.
fn duffing_large_cycle_state() -> Vec<f64> {
    let (period, amplitude) = duffing_period_and_amplitude(DUFFING_MODULUS);
    let coeffs = CollocationCoefficients::new(SOURCE_NCOL).expect("collocation nodes");
    let mut state = Vec::new();

    for interval in 0..SOURCE_NTST {
        let time = period * interval as f64 / SOURCE_NTST as f64;
        state.extend(duffing_cycle_state_at(time, amplitude));
    }
    for interval in 0..SOURCE_NTST {
        for node in coeffs.nodes.iter().copied() {
            let time = period * (interval as f64 + node) / SOURCE_NTST as f64;
            state.extend(duffing_cycle_state_at(time, amplitude));
        }
    }
    state.push(period);
    state
}

fn continuation_settings() -> ContinuationSettings {
    ContinuationSettings {
        step_size: 1e-4,
        min_step_size: 1e-9,
        max_step_size: 1e-3,
        max_steps: 3,
        corrector_steps: 32,
        corrector_tolerance: 1e-8,
        step_tolerance: 1e-8,
    }
}

fn method_1_setup(system: &mut EquationSystem) -> HomoclinicSetup {
    homoclinic_setup_from_large_cycle(
        system,
        &duffing_large_cycle_state(),
        SOURCE_NTST,
        SOURCE_NCOL,
        TARGET_NTST,
        TARGET_NCOL,
        &[0.0, 0.0],
        0,
        1,
        "mu",
        "nu",
        METHOD_EXTRAS,
    )
    .expect("Method 1 setup from Duffing large cycle")
}

fn run_method_1() -> (HomoclinicSetup, ContinuationBranch) {
    let mut system = duffing_system(vec![0.0, 0.0]);
    let setup = method_1_setup(&mut system);
    let branch =
        continue_homoclinic_curve(&mut system, setup.clone(), continuation_settings(), true)
            .expect("Method 1 continuation");
    (setup, branch)
}

fn decode_point_params(
    setup: &HomoclinicSetup,
    point: &fork_core::continuation::ContinuationPoint,
) -> (f64, f64) {
    let decoded = decode_homoclinic_state_with_basis(
        &point.state,
        2,
        setup.ntst,
        setup.ncol,
        setup.extras,
        setup.guess.time,
        setup.guess.eps0,
        setup.guess.eps1,
        (setup.basis.nneg, setup.basis.npos),
    )
    .expect("decode homoclinic point");
    (point.param_value, decoded.param2_value)
}

fn assert_advances_on_duffing_locus(setup: &HomoclinicSetup, branch: &ContinuationBranch) {
    assert!(
        branch.points.len() > 1,
        "validated homoclinic branch must advance beyond its seed"
    );
    let accepted = &branch.points[1..];
    let gaps: Vec<f64> = accepted
        .iter()
        .map(|point| {
            let (mu, nu) = decode_point_params(setup, point);
            assert!(mu.is_finite() && nu.is_finite());
            mu - nu
        })
        .collect();
    let min_gap = gaps.iter().copied().fold(f64::INFINITY, f64::min);
    let max_gap = gaps.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    assert!(
        max_gap - min_gap < 1e-8,
        "the continued curve must remain parallel to the analytic mu=nu locus: {gaps:?}"
    );
    assert!(
        gaps[0].abs() < 5e-4,
        "coarse-mesh Duffing locus drift is too large: {}",
        gaps[0]
    );
    let first_mu = accepted.first().expect("first accepted point").param_value;
    let last_mu = accepted.last().expect("last accepted point").param_value;
    assert!(
        (last_mu - first_mu).abs() > 5e-5,
        "homoclinic continuation did not move measurably along the locus"
    );
}

fn fixed_scalars(setup: &HomoclinicSetup) -> HomoclinicFixedScalars {
    HomoclinicFixedScalars {
        time: setup.guess.time,
        eps0: setup.guess.eps0,
        eps1: setup.guess.eps1,
    }
}

#[test]
fn method_1_advances_from_a_duffing_large_cycle() {
    let (setup, branch) = run_method_1();
    assert_advances_on_duffing_locus(&setup, &branch);
}

#[test]
fn method_2_restart_advances_from_a_method_1_point() {
    let (source_setup, source_branch) = run_method_1();
    let source_point = &source_branch.points[1];
    let (mu, nu) = decode_point_params(&source_setup, source_point);
    let mut system = duffing_system(vec![mu, nu]);
    let setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
        &mut system,
        &source_point.state,
        source_setup.ntst,
        source_setup.ncol,
        TARGET_NTST,
        TARGET_NCOL,
        &[mu, nu],
        0,
        1,
        "mu",
        "nu",
        METHOD_EXTRAS,
        source_setup.extras,
        Some(fixed_scalars(&source_setup)),
    )
    .expect("Method 2 restart setup");
    let branch =
        continue_homoclinic_curve(&mut system, setup.clone(), continuation_settings(), true)
            .expect("Method 2 continuation");

    assert_advances_on_duffing_locus(&setup, &branch);
}

#[test]
fn method_4_advances_from_a_certified_stage_d_profile() {
    let (source_setup, source_branch) = run_method_1();
    let source_point = &source_branch.points[1];
    let (mu, nu) = decode_point_params(&source_setup, source_point);
    let mut system = duffing_system(vec![mu, nu]);

    // A StageD point is a homoclinic-ready connection profile encoded with the
    // staged workflow's fixed extras. Re-encode an accepted Method 1 point to
    // isolate and certify the StageD -> Method 4 boundary independently of the
    // Method 3 stage-generation heuristic.
    let stage_setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
        &mut system,
        &source_point.state,
        source_setup.ntst,
        source_setup.ncol,
        TARGET_NTST,
        TARGET_NCOL,
        &[mu, nu],
        0,
        1,
        "mu",
        "nu",
        STAGE_D_EXTRAS,
        source_setup.extras,
        Some(fixed_scalars(&source_setup)),
    )
    .expect("certified StageD setup");
    let stage_d = HomotopySaddleSetup {
        stage: HomotopyStage::StageD,
        eps1_tol: 1e-3,
        u_params: vec![0.0; stage_setup.basis.npos],
        s_params: vec![0.0; stage_setup.basis.npos],
        setup: stage_setup,
    };
    let stage_d_state = pack_homoclinic_state(&stage_d.setup);
    let setup = homotopy_stage_d_to_homoclinic(
        &mut system,
        &stage_d,
        &stage_d_state,
        TARGET_NTST,
        TARGET_NCOL,
    )
    .expect("Method 4 conversion");
    let branch =
        continue_homoclinic_curve(&mut system, setup.clone(), continuation_settings(), true)
            .expect("Method 4 continuation");

    assert_advances_on_duffing_locus(&setup, &branch);
}
