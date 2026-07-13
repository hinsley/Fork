use fork_core::continuation::equilibrium::continue_parameter;
use fork_core::continuation::{
    continue_parameter as continue_parameter_legacy, map_branch_point_normal_form,
    map_neimark_sacker_normal_form, map_period_doubling_normal_form, BifurcationType,
    ContinuationSettings, MapBranchPointKind, MapCriticality,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;

fn compile_map(
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
        .map(|equation| compiler.compile(&parse(equation).expect("parse analytic map")))
        .collect();
    EquationSystem::new(
        bytecode,
        parameters.iter().map(|(_, value)| *value).collect(),
    )
}

#[test]
fn branch_point_normal_form_matches_pitchfork_and_transcritical_maps() {
    let a = -0.456;
    let c = -1.234;
    let mut pitchfork = compile_map(
        &["x + mu*a*x + c*x^3"],
        &["x"],
        &[("mu", 0.0), ("a", a), ("c", c)],
    );

    let nf = map_branch_point_normal_form(&mut pitchfork, &[0.0], 0, 0.0, 1)
        .expect("pitchfork normal form");
    assert_eq!(nf.kind, MapBranchPointKind::Pitchfork);
    assert!(nf.constant_parameter_coefficient.abs() < 1e-8);
    assert!((nf.linear_parameter_coefficient - a).abs() < 1e-5);
    assert!(nf.quadratic_coefficient.abs() < 1e-6);
    assert!((nf.cubic_coefficient - 6.0 * c).abs() < 2e-3);
    assert!(nf.conditioning.right_residual < 1e-8);
    assert!(nf.conditioning.left_residual < 1e-8);

    let b = 0.21;
    let mut transcritical = compile_map(
        &["x + mu*a*x + b*x^2 + c*x^3"],
        &["x"],
        &[("mu", 0.0), ("a", a), ("b", b), ("c", c)],
    );
    let nf = map_branch_point_normal_form(&mut transcritical, &[0.0], 0, 0.0, 1)
        .expect("transcritical normal form");
    assert_eq!(nf.kind, MapBranchPointKind::Transcritical);
    assert!((nf.quadratic_coefficient - 2.0 * b).abs() < 1e-5);
    assert!((nf.cubic_coefficient - 6.0 * c).abs() < 2e-3);
}

#[test]
fn branch_point_normal_form_uses_the_requested_map_iterate() {
    // At mu = 0, F(x) = -x + c*x^3 has multiplier -1, whereas
    // F^2(x) = x - 2*c*x^3 + O(x^5) has a +1 pitchfork normal form.
    // This exercises the same Phi^k path used for a point on a map cycle.
    let a = 0.37;
    let c = -0.41;
    let mut map = compile_map(
        &["(-1 + a*mu)*x + c*x^3"],
        &["x"],
        &[("mu", 0.0), ("a", a), ("c", c)],
    );

    assert!(map_branch_point_normal_form(&mut map, &[0.0], 0, 0.0, 1).is_err());

    let nf = map_branch_point_normal_form(&mut map, &[0.0], 0, 0.0, 2)
        .expect("second-iterate branch-point normal form");
    assert_eq!(nf.kind, MapBranchPointKind::Pitchfork);
    assert!(nf.constant_parameter_coefficient.abs() < 1e-8);
    assert!((nf.linear_parameter_coefficient + 2.0 * a).abs() < 2e-5);
    assert!(nf.quadratic_coefficient.abs() < 1e-6);
    assert!((nf.cubic_coefficient + 12.0 * c).abs() < 4e-3);
    assert!(nf.conditioning.right_residual < 1e-8);
    assert!(nf.conditioning.left_residual < 1e-8);
}

#[test]
fn generic_map_continuation_labels_plus_one_crossing_as_branch_point() {
    let mut map = compile_map(
        &["x + mu*a*x + c*x^3"],
        &["x"],
        &[("mu", -0.2), ("a", -0.456), ("c", -1.234)],
    );
    let branch = continue_parameter(
        &mut map,
        SystemKind::Map { iterations: 1 },
        &[0.0],
        0,
        ContinuationSettings {
            step_size: 0.025,
            min_step_size: 1e-6,
            max_step_size: 0.05,
            max_steps: 18,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        },
        true,
    )
    .expect("continue the map fixed-point branch");

    let point = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::BranchPoint)
        .expect("detect the +1 multiplier as a map branch point");
    assert!(point.param_value.abs() < 1e-7, "mu={}", point.param_value);
    assert!(branch
        .points
        .iter()
        .all(|point| point.stability != BifurcationType::Fold));

    let legacy_branch = continue_parameter_legacy(
        &mut map,
        SystemKind::Map { iterations: 1 },
        &[0.0],
        0,
        ContinuationSettings {
            step_size: 0.025,
            min_step_size: 1e-6,
            max_step_size: 0.05,
            max_steps: 18,
            corrector_steps: 12,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        },
        true,
    )
    .expect("continue with the legacy map entry point");
    assert!(legacy_branch
        .points
        .iter()
        .any(|point| point.stability == BifurcationType::BranchPoint));
}

#[test]
fn generic_map_continuation_keeps_saddle_node_classified_as_fold() {
    let mut map = compile_map(&["x + mu - x^2"], &["x"], &[("mu", 0.09)]);
    let branch = continue_parameter(
        &mut map,
        SystemKind::Map { iterations: 1 },
        &[0.3],
        0,
        ContinuationSettings {
            step_size: 0.02,
            min_step_size: 1e-7,
            max_step_size: 0.04,
            max_steps: 24,
            corrector_steps: 16,
            corrector_tolerance: 1e-11,
            step_tolerance: 1e-11,
        },
        false,
    )
    .expect("continue the scalar map through its saddle-node");

    let fold = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::Fold)
        .expect("classify the +1 saddle-node as Fold");
    assert!(fold.param_value.abs() < 1e-7, "mu={}", fold.param_value);
    assert!(fold.state[0].abs() < 1e-5, "x={}", fold.state[0]);
    assert!(branch
        .points
        .iter()
        .all(|point| point.stability != BifurcationType::BranchPoint));

    let legacy_branch = continue_parameter_legacy(
        &mut map,
        SystemKind::Map { iterations: 1 },
        &[0.3],
        0,
        ContinuationSettings {
            step_size: 0.02,
            min_step_size: 1e-7,
            max_step_size: 0.04,
            max_steps: 24,
            corrector_steps: 16,
            corrector_tolerance: 1e-11,
            step_tolerance: 1e-11,
        },
        false,
    )
    .expect("continue the saddle-node through the root compatibility entry point");
    assert!(legacy_branch
        .points
        .iter()
        .any(|point| point.stability == BifurcationType::Fold));
    assert!(legacy_branch
        .points
        .iter()
        .all(|point| point.stability != BifurcationType::BranchPoint));
}

#[test]
fn period_doubling_normal_form_matches_scalar_flip_map() {
    let a = 0.456;
    let c = -1.234;
    let mut map = compile_map(
        &["(-1 + mu*a)*x + c*x^3"],
        &["x"],
        &[("mu", 0.0), ("a", a), ("c", c)],
    );

    let nf = map_period_doubling_normal_form(&mut map, &[0.0], 0, 0.0, 1)
        .expect("period-doubling normal form");
    assert!((nf.parameter_coefficient - a).abs() < 1e-5);
    assert!((nf.cubic_coefficient - c).abs() < 5e-4);
    assert_eq!(nf.criticality, MapCriticality::Subcritical);
    assert!(nf.conditioning.right_residual < 1e-8);
    assert!(nf.conditioning.left_residual < 1e-8);
}

#[test]
fn neimark_sacker_normal_form_matches_complex_cubic_map() {
    let theta = 0.37_f64;
    let ct = theta.cos();
    let st = theta.sin();
    let a = 1.123;
    let cr = -6.789;
    let ci = -0.456;
    let mut map = compile_map(
        &[
            "ct*(x*(1+a*mu+cr*(x^2+y^2))-y*ci*(x^2+y^2))-st*(y*(1+a*mu+cr*(x^2+y^2))+x*ci*(x^2+y^2))",
            "st*(x*(1+a*mu+cr*(x^2+y^2))-y*ci*(x^2+y^2))+ct*(y*(1+a*mu+cr*(x^2+y^2))+x*ci*(x^2+y^2))",
        ],
        &["x", "y"],
        &[
            ("mu", 0.0),
            ("ct", ct),
            ("st", st),
            ("a", a),
            ("cr", cr),
            ("ci", ci),
        ],
    );

    let nf = map_neimark_sacker_normal_form(&mut map, &[0.0, 0.0], 0, 0.0, 1)
        .expect("Neimark-Sacker normal form");
    assert!((nf.angle.abs() - theta).abs() < 1e-8);
    assert!((nf.parameter_coefficient.re - a).abs() < 2e-3);
    assert!(nf.parameter_coefficient.im.abs() < 2e-3);
    // The critical eigenvector has unit Euclidean norm, so physical
    // z=x+i*y equals sqrt(2) times the center coordinate.  Kuznetsov's
    // coefficient in that center coordinate is therefore 2*(cr+i*ci).
    assert!((nf.cubic_coefficient.re - 2.0 * cr).abs() < 4e-2);
    assert!((nf.cubic_coefficient.im - 2.0 * ci).abs() < 4e-2);
    assert_eq!(nf.criticality, MapCriticality::Supercritical);
    assert!(nf.conditioning.right_residual < 1e-8);
    assert!(nf.conditioning.left_residual < 1e-8);
}

#[test]
fn neimark_sacker_normal_form_includes_fixed_point_drift_and_quadratic_terms() {
    // In complex notation, with z = (x-mu*sx) + i(y-mu*sy), this map is
    //
    //   F(z,mu) = mu*s + (1+a*mu)e^(i theta) z + qa*z^2 + qb*z*zbar.
    //
    // Hence the fixed point moves as x_*(mu)=mu*s.  The exact PRM formula
    // cancels the state-held parameter derivative against B(q, x_*'), leaving
    // parameter coefficient a.  Both quadratic homological terms are nonzero;
    // evaluating the Kuznetsov formula with unit Euclidean eigenvectors gives
    // d = -0.23527792392009708 - 0.583951637382225 i.
    let theta = 0.61_f64;
    let ct = theta.cos();
    let st = theta.sin();
    let a = 0.47;
    let qa = 0.23;
    let qb = -0.31;
    let sx = 0.17;
    let sy = -0.11;
    let mut map = compile_map(
        &[
            "mu*sx+(1+a*mu)*(ct*(x-mu*sx)-st*(y-mu*sy))+qa*((x-mu*sx)^2-(y-mu*sy)^2)+qb*((x-mu*sx)^2+(y-mu*sy)^2)",
            "mu*sy+(1+a*mu)*(st*(x-mu*sx)+ct*(y-mu*sy))+2*qa*(x-mu*sx)*(y-mu*sy)",
        ],
        &["x", "y"],
        &[
            ("mu", 0.0),
            ("ct", ct),
            ("st", st),
            ("a", a),
            ("qa", qa),
            ("qb", qb),
            ("sx", sx),
            ("sy", sy),
        ],
    );

    let nf = map_neimark_sacker_normal_form(&mut map, &[0.0, 0.0], 0, 0.0, 1)
        .expect("translated quadratic Neimark-Sacker normal form");
    assert!((nf.parameter_coefficient.re - a).abs() < 2e-3, "nf={nf:?}");
    assert!(nf.parameter_coefficient.im.abs() < 2e-3, "nf={nf:?}");
    assert!(
        (nf.cubic_coefficient.re + 0.23527792392009708).abs() < 3e-3,
        "nf={nf:?}"
    );
    assert!(
        (nf.cubic_coefficient.im + 0.583951637382225).abs() < 3e-3,
        "nf={nf:?}"
    );
}

#[test]
fn neimark_sacker_normal_form_rejects_first_through_fourth_order_resonances() {
    for (theta, label) in [
        (0.0, "1:1"),
        (std::f64::consts::PI, "1:2"),
        (2.0 * std::f64::consts::PI / 3.0, "1:3"),
        (std::f64::consts::FRAC_PI_2, "1:4"),
    ] {
        let mut map = compile_map(
            &["(1+mu)*(ct*x-st*y)", "(1+mu)*(st*x+ct*y)"],
            &["x", "y"],
            &[("mu", 0.0), ("ct", theta.cos()), ("st", theta.sin())],
        );
        let error = map_neimark_sacker_normal_form(&mut map, &[0.0, 0.0], 0, 0.0, 1)
            .expect_err("strong resonance must not use the generic NS normal form");
        assert!(error.to_string().contains(label), "error={error:#}");
    }
}
