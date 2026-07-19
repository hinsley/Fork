use fork_core::continuation::periodic::{
    correct_limit_cycle_setup, PeriodicOrbitCollocationProblem,
};
use fork_core::continuation::{
    continue_limit_cycle_collocation, gauss_legendre_nodes, periodic_branch_point_normal_form,
    periodic_branch_point_switch_setup, periodic_neimark_sacker_normal_form,
    periodic_neimark_sacker_normal_form_for_cosine_with_settings,
    periodic_neimark_sacker_normal_form_with_settings, periodic_period_doubling_normal_form,
    periodic_plus_one_bifurcation_type, uniform_normalized_mesh, BifurcationType,
    ContinuationProblem, ContinuationSettings, LimitCycleGuess, LimitCycleSetup,
    PeriodicOrbitBranchPointKind, PeriodicOrbitCriticality, PeriodicOrbitNormalFormSettings,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::traits::DynamicalSystem;
use nalgebra::DVector;
use std::f64::consts::TAU;

fn compile_flow(
    equations: &[&str],
    variables: &[&str],
    parameters: &[(&str, f64)],
) -> EquationSystem {
    let variable_names = variables
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let parameter_names = parameters
        .iter()
        .map(|(name, _)| (*name).to_string())
        .collect::<Vec<_>>();
    let compiler = Compiler::new(&variable_names, &parameter_names);
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse suspension flow")))
        .collect();
    EquationSystem::new(
        bytecode,
        parameters.iter().map(|(_, value)| *value).collect(),
    )
}

fn circular_cycle_setup(dim: usize, ntst: usize, ncol: usize) -> LimitCycleSetup {
    let nodes = gauss_legendre_nodes(ncol).expect("Gauss nodes");
    let state_at = |time: f64| {
        let mut state = vec![0.0; dim];
        state[0] = time.cos();
        state[1] = time.sin();
        state
    };
    let mesh_states = (0..ntst)
        .map(|interval| state_at(TAU * interval as f64 / ntst as f64))
        .collect::<Vec<_>>();
    let stage_states = (0..ntst)
        .map(|interval| {
            nodes
                .iter()
                .map(|node| state_at(TAU * (interval as f64 + node) / ntst as f64))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value: 0.0,
            period: TAU,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: false,
        },
        phase_anchor: {
            let mut anchor = vec![0.0; dim];
            anchor[0] = 1.0;
            anchor
        },
        phase_direction: {
            let mut direction = vec![0.0; dim];
            direction[1] = 1.0;
            direction
        },
        mesh_points: ntst,
        collocation_degree: ncol,
        normalized_mesh: uniform_normalized_mesh(ntst),
    }
}

#[test]
fn plus_one_normal_form_distinguishes_branch_points_from_limit_point_cycles() {
    let a = 0.7;
    let b = -1.2;
    let mut branch_flow = compile_flow(
        &["-y + x*(1-x^2-y^2)", "x + y*(1-x^2-y^2)", "a*mu*z + b*z^2"],
        &["x", "y", "z"],
        &[("mu", 0.0), ("a", a), ("b", b)],
    );
    let setup = circular_cycle_setup(3, 12, 3);
    let nf = periodic_branch_point_normal_form(&mut branch_flow, &setup, 0)
        .expect("periodic branch-point normal form");

    assert_eq!(nf.kind, PeriodicOrbitBranchPointKind::Transcritical);
    assert_eq!(
        periodic_plus_one_bifurcation_type(&nf),
        BifurcationType::BranchPoint
    );
    assert!(nf.constant_parameter_coefficient.abs() < 2e-4);
    assert!((nf.linear_parameter_coefficient - a * TAU).abs() < 3e-2);
    assert!((nf.quadratic_coefficient - 2.0 * b * TAU).abs() < 5e-2);
    assert!(
        nf.conditioning.return_map_residual < 1e-8,
        "conditioning={:?}",
        nf.conditioning
    );
    assert!(nf.conditioning.section_residual < 1e-8);
    assert!(nf.conditioning.right_residual < 2e-5);

    let switched = periodic_branch_point_switch_setup(&mut branch_flow, &setup, 0, &nf, 0.03)
        .expect("switch to the secondary periodic branch");
    let predicted_mu = -b * 0.03 / a;
    assert!((switched.guess.param_value - predicted_mu).abs() < 5e-4);
    assert!((switched.guess.mesh_states[0][2] - 0.03).abs() < 5e-4);
    let (corrected, _) = correct_limit_cycle_setup(&mut branch_flow, 0, switched.clone(), 1e-9, 10)
        .expect("correct the switched periodic branch predictor");
    assert!((corrected.guess.mesh_states[0][2] - 0.03).abs() < 7e-4);

    let secondary = continue_limit_cycle_collocation(
        &mut branch_flow,
        0,
        corrected.collocation_config(),
        corrected.guess.clone(),
        ContinuationSettings {
            step_size: 0.004,
            min_step_size: 1e-7,
            max_step_size: 0.008,
            max_steps: 3,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        },
        true,
    )
    .expect("continue the switched periodic branch");
    assert!(secondary.points.len() >= 4, "branch={secondary:?}");
    for point in &secondary.points {
        let z = point.state[2];
        let expected_z = -a * point.param_value / b;
        assert!((z - expected_z).abs() < 2e-5, "point={point:?}");

        let mut problem = PeriodicOrbitCollocationProblem::new(
            &mut branch_flow,
            0,
            corrected.mesh_points,
            corrected.collocation_degree,
            corrected.phase_anchor.clone(),
            corrected.phase_direction.clone(),
        )
        .expect("secondary-branch residual problem");
        let mut augmented = DVector::zeros(point.state.len() + 1);
        augmented[0] = point.param_value;
        augmented.as_mut_slice()[1..].copy_from_slice(&point.state);
        let mut residual = DVector::zeros(point.state.len());
        problem
            .residual(&augmented, &mut residual)
            .expect("evaluate secondary-branch residual");
        let residual_rms = residual.norm() / (residual.len() as f64).sqrt();
        let defect = problem
            .scaled_collocation_defect(&augmented)
            .expect("evaluate secondary-branch defect");
        assert!(residual_rms.is_finite() && residual_rms < 2e-8);
        assert!(defect.is_finite() && defect < 2.5e-2);
    }
    assert!(
        (secondary.points.last().unwrap().param_value - secondary.points[0].param_value).abs()
            > 5e-3
    );

    let mut rhs = vec![0.0; 3];
    branch_flow.params[0] = switched.guess.param_value;
    branch_flow.apply(0.0, &switched.guess.mesh_states[0], &mut rhs);
    assert!(rhs[2].abs() < 2e-5, "secondary-branch residual={}", rhs[2]);

    let mut lpc_flow = compile_flow(
        &["-y + x*(1-x^2-y^2)", "x + y*(1-x^2-y^2)", "mu + z^2"],
        &["x", "y", "z"],
        &[("mu", 0.0)],
    );
    let lpc_nf = periodic_branch_point_normal_form(&mut lpc_flow, &setup, 0)
        .expect("limit-point-cycle normal form");
    assert_eq!(lpc_nf.kind, PeriodicOrbitBranchPointKind::LimitPointCycle);
    assert_eq!(
        periodic_plus_one_bifurcation_type(&lpc_nf),
        BifurcationType::CycleFold
    );
    assert!((lpc_nf.constant_parameter_coefficient - TAU).abs() < 3e-2);
    assert!(periodic_branch_point_switch_setup(&mut lpc_flow, &setup, 0, &lpc_nf, 0.03).is_err());
}

#[test]
fn continuation_labels_a_generic_periodic_plus_one_crossing_as_a_branch_point() {
    let mut flow = compile_flow(
        &["-y + x*(1-x^2-y^2)", "x + y*(1-x^2-y^2)", "a*mu*z + b*z^2"],
        &["x", "y", "z"],
        &[("mu", -0.04), ("a", 0.7), ("b", -1.2)],
    );
    let mut setup = circular_cycle_setup(3, 12, 3);
    setup.guess.param_value = -0.04;
    let branch = continue_limit_cycle_collocation(
        &mut flow,
        0,
        setup.collocation_config(),
        setup.guess,
        ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.02,
            max_steps: 8,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        },
        true,
    )
    .expect("continue the primary periodic branch through its generic BP");

    let branch_point = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::BranchPoint)
        .expect("classify the nontrivial +1 multiplier as a periodic branch point");
    assert!(branch_point.param_value.abs() < 1e-6);
    assert!(branch
        .points
        .iter()
        .all(|point| point.stability != BifurcationType::CycleFold));
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn period_doubling_normal_form_matches_an_analytic_suspension() {
    let stable_exponent = -0.4;
    let cubic = -0.2;
    let mut flow = compile_flow(
        &[
            "-y + x*(1-x^2-y^2)",
            "x + y*(1-x^2-y^2)",
            "((mu+s)/2+(mu-s)*x/2)*u+((mu-s)*y/2-0.5)*v+c*((1+2*x+x^2)*u^3+3*y*(1+x)*u^2*v+3*y^2*u*v^2+y*(1-x)*v^3)/4",
            "((mu-s)*y/2+0.5)*u+((mu+s)/2-(mu-s)*x/2)*v+c*(y*(1+x)*u^3+3*y^2*u^2*v+3*y*(1-x)*u*v^2+(1-2*x+x^2)*v^3)/4",
        ],
        &["x", "y", "u", "v"],
        &[("mu", 0.0), ("s", stable_exponent), ("c", cubic)],
    );
    let setup = circular_cycle_setup(4, 14, 3);
    let nf = periodic_period_doubling_normal_form(&mut flow, &setup, 0)
        .expect("period-doubling periodic-orbit normal form");

    assert!((nf.multiplier + 1.0).abs() < 2e-4, "mu={}", nf.multiplier);
    assert!((nf.parameter_coefficient + TAU).abs() < 5e-2);
    assert!((nf.cubic_coefficient + cubic * TAU).abs() < 8e-2);
    assert_eq!(nf.criticality, PeriodicOrbitCriticality::Supercritical);
    assert!(nf.conditioning.return_map_residual < 1e-8, "nf={nf:?}");
    assert!(nf.conditioning.right_residual < 2e-5);
    assert!(nf.conditioning.homological_residual < 2e-4);
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn neimark_sacker_normal_form_matches_a_complex_cubic_suspension() {
    let theta = 0.37;
    let omega = theta / TAU;
    let cubic = -0.2;
    let mut flow = compile_flow(
        &[
            "-y + x*(1-x^2-y^2)",
            "x + y*(1-x^2-y^2)",
            "mu*u-omega*v+c*(u^2+v^2)*u",
            "omega*u+mu*v+c*(u^2+v^2)*v",
        ],
        &["x", "y", "u", "v"],
        &[("mu", 0.0), ("omega", omega), ("c", cubic)],
    );
    let setup = circular_cycle_setup(4, 14, 3);
    let nf = periodic_neimark_sacker_normal_form(&mut flow, &setup, 0)
        .expect("Neimark-Sacker periodic-orbit normal form");

    assert!((nf.angle - theta).abs() < 2e-4, "theta={}", nf.angle);
    assert!((nf.multiplier.norm() - 1.0).abs() < 2e-4);
    assert!((nf.parameter_coefficient.re - TAU).abs() < 6e-2);
    assert!(nf.parameter_coefficient.im.abs() < 3e-2);
    // Unit Euclidean normalization of the complex critical eigenvector makes
    // the center coordinate smaller than physical u+i*v by sqrt(2).
    assert!((nf.cubic_coefficient.re - 2.0 * cubic * TAU).abs() < 18e-2);
    assert_eq!(nf.criticality, PeriodicOrbitCriticality::Supercritical);
    assert!(nf.conditioning.return_map_residual < 1e-8, "nf={nf:?}");
    assert!(nf.conditioning.right_residual < 2e-5);
    assert!(nf.conditioning.homological_residual < 3e-4);
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn neimark_sacker_normal_form_includes_orbit_drift_and_quadratic_terms() {
    // With z = (u-mu*sx) + i(v-mu*sy), the transverse equation is
    //
    //   zdot = (i*omega+a*mu)z + qa*z^2 + qb*z*zbar.
    //
    // Thus the periodic orbit moves as (u,v)=mu*(sx,sy).  For unit Euclidean
    // critical eigenvectors, continuous-time normalization gives
    // c = 2i*qb*(qa-qb)/omega.  The time-TAU Poincare map therefore has
    // parameter coefficient a*TAU and cubic coefficient d=c*TAU.
    let theta = 0.61;
    let omega = theta / TAU;
    let a = 0.47;
    let qa = 0.05;
    let qb = -0.04;
    let sx = 0.17;
    let sy = -0.11;
    let mut flow = compile_flow(
        &[
            "-y+x*(1-x^2-y^2)",
            "x+y*(1-x^2-y^2)",
            "-omega*(v-mu*sy)+a*mu*(u-mu*sx)+qa*((u-mu*sx)^2-(v-mu*sy)^2)+qb*((u-mu*sx)^2+(v-mu*sy)^2)",
            "omega*(u-mu*sx)+a*mu*(v-mu*sy)+2*qa*(u-mu*sx)*(v-mu*sy)",
        ],
        &["x", "y", "u", "v"],
        &[
            ("mu", 0.0),
            ("omega", omega),
            ("a", a),
            ("qa", qa),
            ("qb", qb),
            ("sx", sx),
            ("sy", sy),
        ],
    );
    let setup = circular_cycle_setup(4, 14, 3);
    let nf = periodic_neimark_sacker_normal_form(&mut flow, &setup, 0)
        .expect("translated quadratic periodic NS normal form");
    let expected_cubic_im = 2.0 * qb * (qa - qb) * TAU / omega;

    assert!(
        (nf.parameter_coefficient.re - a * TAU).abs() < 6e-2,
        "nf={nf:?}"
    );
    assert!(nf.parameter_coefficient.im.abs() < 4e-2, "nf={nf:?}");
    assert!(nf.cubic_coefficient.re.abs() < 5e-2, "nf={nf:?}");
    assert!(
        (nf.cubic_coefficient.im - expected_cubic_im).abs() < 6e-2,
        "expected {expected_cubic_im}, nf={nf:?}"
    );
}

#[test]
fn periodic_neimark_sacker_normal_form_rejects_first_through_fourth_order_resonances() {
    for (theta, label) in [
        (0.0, "1:1"),
        (std::f64::consts::PI, "1:2"),
        (2.0 * std::f64::consts::PI / 3.0, "1:3"),
        (std::f64::consts::FRAC_PI_2, "1:4"),
    ] {
        let omega = theta / TAU;
        let mut flow = compile_flow(
            &[
                "-y+x*(1-x^2-y^2)",
                "x+y*(1-x^2-y^2)",
                "mu*u-omega*v",
                "omega*u+mu*v",
            ],
            &["x", "y", "u", "v"],
            &[("mu", 0.0), ("omega", omega)],
        );
        let setup = circular_cycle_setup(4, 12, 3);
        let error = periodic_neimark_sacker_normal_form(&mut flow, &setup, 0)
            .expect_err("strong resonance must not use the generic periodic NS normal form");
        assert!(error.to_string().contains(label), "error={error:#}");
    }
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn targeted_ns_normal_form_tracks_the_requested_pair_when_modulus_order_switches() {
    let theta_1 = 0.37;
    let theta_2 = 0.91;
    let omega_1 = theta_1 / TAU;
    let omega_2 = theta_2 / TAU;
    let mut flow = compile_flow(
        &[
            "-y + x*(1-x^2-y^2)",
            "x + y*(1-x^2-y^2)",
            "mu*u1-omega1*v1+c1*(u1^2+v1^2)*u1",
            "omega1*u1+mu*v1+c1*(u1^2+v1^2)*v1",
            "-mu*u2-omega2*v2+c2*(u2^2+v2^2)*u2",
            "omega2*u2-mu*v2+c2*(u2^2+v2^2)*v2",
        ],
        &["x", "y", "u1", "v1", "u2", "v2"],
        &[
            ("mu", 0.0),
            ("omega1", omega_1),
            ("omega2", omega_2),
            ("c1", -0.2),
            ("c2", -0.1),
        ],
    );
    let mut setup = circular_cycle_setup(6, 14, 3);
    let settings = PeriodicOrbitNormalFormSettings {
        integration_steps: 512,
        multiplier_tolerance: 1e-2,
        ..PeriodicOrbitNormalFormSettings::default()
    };

    let mut selected_angles = Vec::new();
    let mut untargeted_angles = Vec::new();
    for parameter in [-5e-5, 5e-5] {
        setup.guess.param_value = parameter;
        let untargeted =
            periodic_neimark_sacker_normal_form_with_settings(&mut flow, &setup, 0, settings)
                .expect("untargeted NS normal form");
        untargeted_angles.push(untargeted.angle);

        let targeted = periodic_neimark_sacker_normal_form_for_cosine_with_settings(
            &mut flow,
            &setup,
            0,
            theta_1.cos(),
            settings,
        )
        .expect("targeted NS normal form");
        selected_angles.push(targeted.angle);
    }

    assert!((untargeted_angles[0] - theta_1).abs() < 3e-4);
    assert!((untargeted_angles[1] - theta_2).abs() < 3e-4);
    assert!(selected_angles
        .iter()
        .all(|angle| (*angle - theta_1).abs() < 3e-4));
}
