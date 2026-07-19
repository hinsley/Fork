use fork_core::continuation::homoclinic::HomoclinicProblem;
use fork_core::continuation::homoclinic_init::decode_homoclinic_state_with_basis;
use fork_core::continuation::homoclinic_shooting::HomoclinicShootingProblem;
use fork_core::continuation::periodic::CollocationCoefficients;
use fork_core::continuation::{
    compute_homoclinic_event_diagnostics, continue_homoclinic_curve,
    continue_homoclinic_shooting_curve, decode_homoclinic_shooting_state,
    homoclinic_setup_from_homoclinic_point_with_source_extras, homoclinic_setup_from_large_cycle,
    homoclinic_shooting_setup_from_collocation, homotopy_stage_d_to_homoclinic,
    pack_homoclinic_shooting_state, pack_homoclinic_state, BifurcationType, ContinuationBranch,
    ContinuationPoint, ContinuationProblem, ContinuationRunner, ContinuationSettings,
    HomoclinicEventKind, HomoclinicEventStatus, HomoclinicExtraFlags, HomoclinicFixedScalars,
    HomoclinicSetup, HomoclinicShootingSettings, HomoclinicShootingSetup, HomotopySaddleSetup,
    HomotopyStage,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use nalgebra::DVector;

const SOURCE_NTST: usize = 32;
const SOURCE_NCOL: usize = 2;
const TARGET_NTST: usize = 8;
const TARGET_NCOL: usize = 2;
const DUFFING_MODULUS: f64 = 0.99;
const SADDLE_FOCUS_DECAY: f64 = 0.4;
const SADDLE_FOCUS_FREQUENCY: f64 = 1.3;

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

fn duffing_saddle_focus_system(params: Vec<f64>) -> EquationSystem {
    let variables = vec![
        "x".to_string(),
        "y".to_string(),
        "u".to_string(),
        "v".to_string(),
    ];
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = [
        "y".to_string(),
        "x-x^3+(mu-nu)*y".to_string(),
        format!("-{SADDLE_FOCUS_DECAY}*u-{SADDLE_FOCUS_FREQUENCY}*v"),
        format!("{SADDLE_FOCUS_FREQUENCY}*u-{SADDLE_FOCUS_DECAY}*v"),
    ];
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse saddle-focus equation")))
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

fn duffing_saddle_focus_large_cycle_state() -> Vec<f64> {
    let (period, amplitude) = duffing_period_and_amplitude(DUFFING_MODULUS);
    let coeffs = CollocationCoefficients::new(SOURCE_NCOL).expect("collocation nodes");
    let mut state = Vec::new();
    let mut append_state = |time: f64| {
        let planar = duffing_cycle_state_at(time, amplitude);
        state.extend([planar[0], planar[1], 0.0, 0.0]);
    };

    for interval in 0..SOURCE_NTST {
        append_state(period * interval as f64 / SOURCE_NTST as f64);
    }
    for interval in 0..SOURCE_NTST {
        for node in coeffs.nodes.iter().copied() {
            append_state(period * (interval as f64 + node) / SOURCE_NTST as f64);
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

fn saddle_focus_continuation_settings() -> ContinuationSettings {
    ContinuationSettings {
        max_steps: 2,
        ..continuation_settings()
    }
}

fn assert_saddle_focus_neutral_channel(eigenvalues: &[num_complex::Complex<f64>]) {
    let diagnostics = compute_homoclinic_event_diagnostics(eigenvalues, None, 1.0e-5);
    assert_eq!(
        diagnostics
            .event(HomoclinicEventKind::NeutralSaddleFocus)
            .status,
        HomoclinicEventStatus::Available
    );
    assert_eq!(
        diagnostics.event(HomoclinicEventKind::NeutralSaddle).status,
        HomoclinicEventStatus::Unavailable
    );
    assert_eq!(
        diagnostics
            .event(HomoclinicEventKind::NeutralBiFocus)
            .status,
        HomoclinicEventStatus::Unavailable
    );
}

fn max_transverse_component(states: impl IntoIterator<Item = Vec<f64>>) -> f64 {
    states
        .into_iter()
        .flat_map(|state| state.into_iter().skip(2))
        .map(f64::abs)
        .fold(0.0, f64::max)
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

fn collocation_layout(branch: &ContinuationBranch) -> (usize, usize) {
    let fork_core::continuation::BranchType::HomoclinicCurve { ntst, ncol, .. } =
        &branch.branch_type
    else {
        panic!("expected homoclinic branch metadata");
    };
    (*ntst, *ncol)
}

fn decode_point_params(
    setup: &HomoclinicSetup,
    branch: &ContinuationBranch,
    point: &fork_core::continuation::ContinuationPoint,
) -> (f64, f64) {
    let (ntst, ncol) = collocation_layout(branch);
    let decoded = decode_homoclinic_state_with_basis(
        &point.state,
        2,
        ntst,
        ncol,
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
            let (mu, nu) = decode_point_params(setup, branch, point);
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

fn assert_shooting_advances_on_duffing_locus(
    setup: &HomoclinicShootingSetup,
    branch: &ContinuationBranch,
) {
    assert!(
        branch.points.len() > 1,
        "standard-shooting homoclinic branch must advance beyond its seed"
    );
    let accepted = &branch.points[1..];
    let gaps = accepted
        .iter()
        .map(|point| {
            let decoded = decode_homoclinic_shooting_state(&point.state, setup)
                .expect("decode shooting point");
            point.param_value - decoded.param2_value
        })
        .collect::<Vec<_>>();
    let min_gap = gaps.iter().copied().fold(f64::INFINITY, f64::min);
    let max_gap = gaps.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    assert!(
        max_gap - min_gap < 2e-7,
        "shooting curve must stay parallel to the analytic mu=nu locus: {gaps:?}"
    );
    assert!(gaps[0].abs() < 1e-3, "shooting locus drift: {gaps:?}");
    let first_mu = accepted.first().unwrap().param_value;
    let last_mu = accepted.last().unwrap().param_value;
    assert!(
        (last_mu - first_mu).abs() > 5e-5,
        "shooting continuation did not move measurably"
    );
}

#[test]
fn method_1_advances_from_a_duffing_large_cycle() {
    let (setup, branch) = run_method_1();
    assert_advances_on_duffing_locus(&setup, &branch);
    let context = branch
        .homoc_context
        .as_ref()
        .expect("final collocation chart context");
    assert_eq!(
        context.projector_refresh_interval,
        setup.projector_refresh_interval
    );
    let basis_motion = setup
        .basis
        .unstable_q
        .iter()
        .zip(&context.basis.unstable_q)
        .map(|(left, right)| (left - right).powi(2))
        .sum::<f64>()
        .sqrt();
    assert!(basis_motion > 1e-8, "final context kept the seed chart");
}

#[test]
fn standard_single_and_multiple_shooting_advance_from_the_same_duffing_large_cycle() {
    for intervals in [1, 8] {
        let mut system = duffing_system(vec![0.0, 0.0]);
        let collocation = method_1_setup(&mut system);
        let setup = homoclinic_shooting_setup_from_collocation(
            &collocation,
            HomoclinicShootingSettings {
                intervals,
                integration_steps_per_segment: 1024 / intervals,
            },
        )
        .expect("shooting setup from Duffing large cycle");
        let branch = continue_homoclinic_shooting_curve(
            &mut system,
            setup.clone(),
            continuation_settings(),
            true,
        )
        .expect("standard shooting continuation");
        assert_shooting_advances_on_duffing_locus(&setup, &branch);
        let context = branch
            .homoc_context
            .as_ref()
            .expect("final shooting chart context");
        assert_eq!(
            context.projector_refresh_interval,
            setup.projector_refresh_interval
        );
    }
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn decoupled_duffing_saddle_focus_advances_with_nsf_diagnostics() {
    let mut collocation_system = duffing_saddle_focus_system(vec![0.0, 0.0]);
    let collocation_setup = homoclinic_setup_from_large_cycle(
        &mut collocation_system,
        &duffing_saddle_focus_large_cycle_state(),
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
    .expect("Duffing saddle-focus collocation setup");
    let collocation_branch = continue_homoclinic_curve(
        &mut collocation_system,
        collocation_setup.clone(),
        saddle_focus_continuation_settings(),
        true,
    )
    .expect("Duffing saddle-focus collocation continuation");
    assert!(
        collocation_branch.points.len() > 1,
        "collocation saddle-focus branch must advance, got {} points with {:?}",
        collocation_branch.points.len(),
        collocation_branch.branch_type
    );
    let (ntst, ncol) = collocation_layout(&collocation_branch);
    let mut collocation_gaps = Vec::new();
    let mut collocation_transverse = 0.0_f64;
    for point in &collocation_branch.points[1..] {
        let decoded = decode_homoclinic_state_with_basis(
            &point.state,
            4,
            ntst,
            ncol,
            collocation_setup.extras,
            collocation_setup.guess.time,
            collocation_setup.guess.eps0,
            collocation_setup.guess.eps1,
            (collocation_setup.basis.nneg, collocation_setup.basis.npos),
        )
        .expect("decode saddle-focus collocation point");
        collocation_gaps.push(point.param_value - decoded.param2_value);
        let mut states = decoded.mesh_states;
        states.extend(decoded.stage_states.into_iter().flatten());
        states.push(decoded.x0);
        collocation_transverse = collocation_transverse.max(max_transverse_component(states));
        assert_saddle_focus_neutral_channel(&point.eigenvalues);
    }
    let collocation_gap_range = collocation_gaps
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max)
        - collocation_gaps
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
    assert!(
        collocation_gap_range < 5.0e-7 && collocation_gaps[0].abs() < 1.0e-3,
        "collocation saddle-focus curve left mu=nu: {collocation_gaps:?}"
    );
    assert!(
        collocation_transverse < 1.0e-8,
        "collocation transverse drift: {collocation_transverse}"
    );
    assert!(
        (collocation_branch.points.last().unwrap().param_value
            - collocation_branch.points[0].param_value)
            .abs()
            > 5.0e-5,
        "collocation saddle-focus branch did not move measurably"
    );

    let shooting_setup = homoclinic_shooting_setup_from_collocation(
        &collocation_setup,
        HomoclinicShootingSettings {
            intervals: 1,
            integration_steps_per_segment: 1024,
        },
    )
    .expect("Duffing saddle-focus shooting setup");
    let mut shooting_system = duffing_saddle_focus_system(vec![0.0, 0.0]);
    let shooting_branch = continue_homoclinic_shooting_curve(
        &mut shooting_system,
        shooting_setup.clone(),
        saddle_focus_continuation_settings(),
        true,
    )
    .expect("Duffing saddle-focus shooting continuation");
    assert!(
        shooting_branch.points.len() > 1,
        "shooting saddle-focus branch must advance, got {} points",
        shooting_branch.points.len()
    );
    let mut shooting_gaps = Vec::new();
    let mut shooting_transverse = 0.0_f64;
    for point in &shooting_branch.points[1..] {
        let decoded = decode_homoclinic_shooting_state(&point.state, &shooting_setup)
            .expect("decode saddle-focus shooting point");
        shooting_gaps.push(point.param_value - decoded.param2_value);
        let mut states = decoded.nodes;
        states.push(decoded.x0);
        shooting_transverse = shooting_transverse.max(max_transverse_component(states));
        assert_saddle_focus_neutral_channel(&point.eigenvalues);
    }
    let shooting_gap_range = shooting_gaps
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max)
        - shooting_gaps.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(
        shooting_gap_range < 5.0e-7 && shooting_gaps[0].abs() < 1.0e-3,
        "shooting saddle-focus curve left mu=nu: {shooting_gaps:?}"
    );
    assert!(
        shooting_transverse < 1.0e-8,
        "shooting transverse drift: {shooting_transverse}"
    );
    assert!(
        (shooting_branch.points.last().unwrap().param_value
            - shooting_branch.points[0].param_value)
            .abs()
            > 5.0e-5,
        "shooting saddle-focus branch did not move measurably"
    );
}

#[test]
fn method_2_restart_advances_from_a_method_1_point() {
    let (source_setup, source_branch) = run_method_1();
    let source_point = &source_branch.points[1];
    let (mu, nu) = decode_point_params(&source_setup, &source_branch, source_point);
    let (source_ntst, source_ncol) = collocation_layout(&source_branch);
    let mut system = duffing_system(vec![mu, nu]);
    let setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
        &mut system,
        &source_point.state,
        source_ntst,
        source_ncol,
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
fn chart_safe_projectors_refresh_repeatedly_on_the_non_diagonal_duffing_saddle() {
    let mut system = duffing_system(vec![0.0, 0.0]);
    let mut setup = method_1_setup(&mut system);
    setup.projector_refresh_interval = 1;
    let initial_basis = setup.basis.unstable_q.clone();
    let initial_point = ContinuationPoint {
        state: pack_homoclinic_state(&setup),
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let problem = HomoclinicProblem::new(&mut system, setup).expect("refresh problem");
    let mut runner = ContinuationRunner::new(
        problem,
        initial_point,
        ContinuationSettings {
            max_steps: 3,
            ..continuation_settings()
        },
        true,
    )
    .expect("refresh runner");
    while !runner.is_done() {
        runner.run_steps(1).expect("refreshed continuation step");
    }
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), 4);
    assert!(
        problem.projector_refresh_count() >= 2,
        "expected multiple accepted-step chart refreshes"
    );
    let final_basis = &problem.resume_context().basis.unstable_q;
    let basis_motion = initial_basis
        .iter()
        .zip(final_basis)
        .map(|(left, right)| (left - right).powi(2))
        .sum::<f64>()
        .sqrt();
    assert!(basis_motion > 1e-8, "Duffing saddle chart did not move");

    let last = branch.points.last().expect("accepted endpoint");
    let aug = DVector::from_iterator(
        last.state.len() + 1,
        std::iter::once(last.param_value).chain(last.state.iter().copied()),
    );
    let mut residual = DVector::zeros(problem.dimension());
    problem
        .residual(&aug, &mut residual)
        .expect("final-chart residual");
    assert!(
        residual.norm() < 1e-5,
        "accepted endpoint changed under repeated chart refreshes: {}",
        residual.norm()
    );
}

#[test]
fn shooting_projectors_refresh_repeatedly_on_the_non_diagonal_duffing_saddle() {
    let mut system = duffing_system(vec![0.0, 0.0]);
    let collocation = method_1_setup(&mut system);
    let mut setup = homoclinic_shooting_setup_from_collocation(
        &collocation,
        HomoclinicShootingSettings {
            intervals: 1,
            integration_steps_per_segment: 1024,
        },
    )
    .expect("shooting refresh setup");
    setup.projector_refresh_interval = 1;
    let initial_point = ContinuationPoint {
        state: pack_homoclinic_shooting_state(&setup),
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: Some(setup.guess.nodes.clone()),
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let problem = HomoclinicShootingProblem::new(&mut system, setup).expect("shooting problem");
    let mut runner = ContinuationRunner::new(
        problem,
        initial_point,
        ContinuationSettings {
            max_steps: 3,
            ..continuation_settings()
        },
        true,
    )
    .expect("shooting refresh runner");
    while !runner.is_done() {
        runner.run_steps(1).expect("shooting refreshed step");
    }
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), 4);
    assert!(problem.projector_refresh_count() >= 2);
    let last = branch.points.last().expect("shooting endpoint");
    let aug = DVector::from_iterator(
        last.state.len() + 1,
        std::iter::once(last.param_value).chain(last.state.iter().copied()),
    );
    let mut residual = DVector::zeros(problem.dimension());
    problem
        .residual(&aug, &mut residual)
        .expect("shooting final-chart residual");
    assert!(residual.norm() < 1e-5, "shooting rechart residual drift");
}

#[test]
fn method_4_advances_from_a_certified_stage_d_profile() {
    let (source_setup, source_branch) = run_method_1();
    let source_point = &source_branch.points[1];
    let (mu, nu) = decode_point_params(&source_setup, &source_branch, source_point);
    let (source_ntst, source_ncol) = collocation_layout(&source_branch);
    let mut system = duffing_system(vec![mu, nu]);

    // A StageD point is a homoclinic-ready connection profile encoded with the
    // staged workflow's fixed extras. Re-encode an accepted Method 1 point to
    // isolate and certify the StageD -> Method 4 boundary independently of the
    // Method 3 stage-generation heuristic.
    let stage_setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
        &mut system,
        &source_point.state,
        source_ntst,
        source_ncol,
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
