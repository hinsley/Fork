use fork_core::continuation::codim1_curves::refine_codim2_points;
use fork_core::continuation::{
    continue_with_problem, hopf_hopf_equilibrium_curve_seeds, hopf_hopf_neimark_sacker_seeds,
    hopf_hopf_normal_form, zero_hopf_equilibrium_curve_seeds, zero_hopf_neimark_sacker_seed,
    zero_hopf_normal_form, BifurcationType, Codim2BifurcationType, Codim2BranchSeed,
    Codim2BranchTarget, ContinuationPoint, ContinuationSettings, FoldCurveProblem,
    HopfCurveProblem, NSCurveProblem,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;

fn system(
    variables: &[&str],
    parameters: &[&str],
    equations: &[&str],
    values: Vec<f64>,
) -> EquationSystem {
    let variable_names: Vec<String> = variables.iter().map(|name| (*name).to_string()).collect();
    let parameter_names: Vec<String> = parameters.iter().map(|name| (*name).to_string()).collect();
    let compiler = Compiler::new(&variable_names, &parameter_names);
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse equation")))
        .collect();
    let mut system = EquationSystem::new(bytecode, values);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

#[test]
fn zero_hopf_normal_form_matches_canonical_three_dimensional_oracle() {
    let mut flow = system(
        &["x", "u", "v"],
        &["beta1", "beta2"],
        &[
            "beta1+x^2-u^2-v^2",
            "beta2*u-v+x*u-u*(u^2+v^2)",
            "u+beta2*v+x*v-v*(u^2+v^2)",
        ],
        vec![0.0, 0.0],
    );

    let nf = zero_hopf_normal_form(&mut flow, &[0.0, 0.0, 0.0], 0, 1, 0.0, 0.0, 1.0)
        .expect("zero-Hopf normal form");

    assert!((nf.frequency - 1.0).abs() < 1e-10, "nf={nf:?}");
    assert!((nf.g200 - 2.0).abs() < 2e-5, "nf={nf:?}");
    assert!((nf.g011 + 2.0).abs() < 2e-5, "nf={nf:?}");
    assert!((nf.g110.re - 1.0).abs() < 2e-5, "nf={nf:?}");
    assert!(nf.has_neimark_sacker, "nf={nf:?}");
    assert!(nf.diagnostics.max_eigen_residual < 1e-9, "nf={nf:?}");
    assert!(
        nf.diagnostics.unfolding_condition_number < 10.0,
        "nf={nf:?}"
    );
}

#[test]
fn hopf_hopf_normal_form_matches_decoupled_cubic_oracle() {
    let mut flow = system(
        &["x1", "y1", "x2", "y2"],
        &["beta1", "beta2"],
        &[
            "beta1*x1-1.7*y1-x1*(x1^2+y1^2)-2*x1*(x2^2+y2^2)",
            "1.7*x1+beta1*y1-y1*(x1^2+y1^2)-2*y1*(x2^2+y2^2)",
            "beta2*x2-y2-3*x2*(x1^2+y1^2)-4*x2*(x2^2+y2^2)",
            "x2+beta2*y2-3*y2*(x1^2+y1^2)-4*y2*(x2^2+y2^2)",
        ],
        vec![0.0, 0.0],
    );

    let nf = hopf_hopf_normal_form(&mut flow, &[0.0; 4], 0, 1, 0.0, 0.0, 1.7)
        .expect("Hopf-Hopf normal form");

    assert!((nf.frequency1 - 1.7).abs() < 1e-10, "nf={nf:?}");
    assert!((nf.frequency2 - 1.0).abs() < 1e-10, "nf={nf:?}");
    assert_eq!(nf.neimark_sacker_predictors.len(), 2, "nf={nf:?}");
    assert_eq!(
        nf.neimark_sacker_predictors[0].parameter_quadratic,
        [-2.0, -6.0],
        "nf={nf:?}"
    );
    assert!(
        (nf.neimark_sacker_predictors[1].parameter_quadratic[0] + 4.0).abs() < 2e-8
            && (nf.neimark_sacker_predictors[1].parameter_quadratic[1] + 8.0).abs() < 2e-8,
        "nf={nf:?}"
    );
    assert!(nf.diagnostics.max_eigen_residual < 1e-9, "nf={nf:?}");
    assert!(
        nf.diagnostics.unfolding_condition_number < 10.0,
        "nf={nf:?}"
    );
}

#[test]
fn resonant_hopf_hopf_reports_why_generic_switching_is_unsupported() {
    let mut flow = system(
        &["x1", "y1", "x2", "y2"],
        &["beta1", "beta2"],
        &[
            "beta1*x1-2*y1-x1*(x1^2+y1^2)",
            "2*x1+beta1*y1-y1*(x1^2+y1^2)",
            "beta2*x2-y2-x2*(x2^2+y2^2)",
            "x2+beta2*y2-y2*(x2^2+y2^2)",
        ],
        vec![0.0, 0.0],
    );
    let error = hopf_hopf_normal_form(&mut flow, &[0.0; 4], 0, 1, 0.0, 0.0, 2.0)
        .expect_err("1:2 Hopf-Hopf point must use a resonant normal form");
    assert!(
        error.to_string().contains("low-order internal resonance"),
        "error={error:#}"
    );
}

#[test]
fn neimark_sacker_is_an_explicit_codim_two_branch_target() {
    assert_eq!(
        format!("{:?}", Codim2BranchTarget::NeimarkSacker),
        "NeimarkSacker"
    );
}

fn short_curve_settings() -> ContinuationSettings {
    ContinuationSettings {
        step_size: 0.01,
        min_step_size: 1e-7,
        max_step_size: 0.03,
        max_steps: 3,
        corrector_steps: 8,
        corrector_tolerance: 1e-9,
        step_tolerance: 1e-9,
    }
}

fn continue_equilibrium_seed(
    flow: &mut EquationSystem,
    seed: &Codim2BranchSeed,
    param1_index: usize,
    param2_index: usize,
) -> usize {
    flow.params[param1_index] = seed.param1_value;
    flow.params[param2_index] = seed.param2_value;
    let mut point_state = vec![seed.param2_value];
    point_state.extend_from_slice(&seed.state);
    match seed.target {
        Codim2BranchTarget::Fold => {
            let mut problem = FoldCurveProblem::new(
                flow,
                SystemKind::Flow,
                &seed.state,
                param1_index,
                param2_index,
            )
            .expect("fold problem from Zero-Hopf seed");
            let branch = continue_with_problem(
                &mut problem,
                ContinuationPoint {
                    state: point_state,
                    param_value: seed.param1_value,
                    stability: BifurcationType::Fold,
                    eigenvalues: vec![],
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                short_curve_settings(),
                seed.perturbation > 0.0,
            )
            .expect("continue switched fold curve");
            branch.points.len()
        }
        Codim2BranchTarget::Hopf => {
            let kappa = seed.auxiliary.expect("Hopf kappa");
            point_state.push(kappa);
            let mut problem = HopfCurveProblem::new(
                flow,
                SystemKind::Flow,
                &seed.state,
                kappa.sqrt(),
                param1_index,
                param2_index,
            )
            .expect("Hopf problem from codimension-two seed");
            let branch = continue_with_problem(
                &mut problem,
                ContinuationPoint {
                    state: point_state,
                    param_value: seed.param1_value,
                    stability: BifurcationType::Hopf,
                    eigenvalues: vec![],
                    cycle_points: None,
                    homoclinic_events: None,
                    heteroclinic_events: None,
                },
                short_curve_settings(),
                seed.perturbation > 0.0,
            )
            .expect("continue switched Hopf curve");
            branch.points.len()
        }
        _ => panic!("unexpected equilibrium target: {:?}", seed.target),
    }
}

#[test]
fn zero_hopf_switches_to_both_fold_and_hopf_orientations_and_continues() {
    let mut flow = system(
        &["x", "u", "v"],
        &["beta1", "beta2"],
        &[
            "beta1+x^2-u^2-v^2",
            "beta2*u-v+x*u-u*(u^2+v^2)",
            "u+beta2*v+x*v-v*(u^2+v^2)",
        ],
        vec![0.0, 0.0],
    );
    let nf = zero_hopf_normal_form(&mut flow, &[0.0; 3], 0, 1, 0.0, 0.0, 1.0)
        .expect("zero-Hopf normal form");
    let seeds = zero_hopf_equilibrium_curve_seeds(&mut flow, &nf, 0.02, 1e-10)
        .expect("Zero-Hopf equilibrium branch seeds");
    assert_eq!(seeds.len(), 4, "seeds={seeds:?}");
    assert_eq!(
        seeds
            .iter()
            .filter(|seed| seed.target == Codim2BranchTarget::Fold)
            .count(),
        2
    );
    assert_eq!(
        seeds
            .iter()
            .filter(|seed| seed.target == Codim2BranchTarget::Hopf)
            .count(),
        2
    );
    for seed in &seeds {
        assert!(seed.corrected_residual < 1e-8, "seed={seed:?}");
        assert!(continue_equilibrium_seed(&mut flow, seed, 0, 1) >= 4);
    }
}

#[test]
fn hopf_hopf_switches_to_both_modes_and_both_orientations_and_continues() {
    let mut flow = system(
        &["x1", "y1", "x2", "y2"],
        &["beta1", "beta2"],
        &[
            "beta1*x1-1.7*y1-x1*(x1^2+y1^2)-2*x1*(x2^2+y2^2)",
            "1.7*x1+beta1*y1-y1*(x1^2+y1^2)-2*y1*(x2^2+y2^2)",
            "beta2*x2-y2-3*x2*(x1^2+y1^2)-4*x2*(x2^2+y2^2)",
            "x2+beta2*y2-3*y2*(x1^2+y1^2)-4*y2*(x2^2+y2^2)",
        ],
        vec![0.0, 0.0],
    );
    let nf = hopf_hopf_normal_form(&mut flow, &[0.0; 4], 0, 1, 0.0, 0.0, 1.7)
        .expect("Hopf-Hopf normal form");
    let seeds = hopf_hopf_equilibrium_curve_seeds(&mut flow, &nf, 0.02, 1e-10)
        .expect("Hopf-Hopf Hopf branch seeds");
    assert_eq!(seeds.len(), 4, "seeds={seeds:?}");
    let mut kappas: Vec<f64> = seeds
        .iter()
        .map(|seed| seed.auxiliary.expect("Hopf kappa"))
        .collect();
    kappas.sort_by(|left, right| left.total_cmp(right));
    assert!((kappas[0] - 1.0).abs() < 1e-6, "kappas={kappas:?}");
    assert!(
        (kappas[3] - 1.7_f64.powi(2)).abs() < 1e-6,
        "kappas={kappas:?}"
    );
    for seed in &seeds {
        assert!(seed.corrected_residual < 1e-8, "seed={seed:?}");
        assert!(continue_equilibrium_seed(&mut flow, seed, 0, 1) >= 4);
    }
}

fn continue_ns_seed(
    flow: &mut EquationSystem,
    seed: &Codim2BranchSeed,
    param1_index: usize,
    param2_index: usize,
) -> usize {
    let period = seed.period.expect("NS period");
    let k = seed.auxiliary.expect("NS multiplier cosine");
    let ntst = seed.ntst.expect("NS mesh intervals");
    let ncol = seed.ncol.expect("NS collocation degree");
    flow.params[param1_index] = seed.param1_value;
    flow.params[param2_index] = seed.param2_value;
    let mut problem = NSCurveProblem::new(
        flow,
        seed.state.clone(),
        period,
        param1_index,
        param2_index,
        seed.param1_value,
        seed.param2_value,
        k,
        ntst,
        ncol,
    )
    .expect("NS problem from codimension-two seed");
    let mut point_state = seed.state.clone();
    point_state.extend([period, seed.param2_value, k]);
    let branch = continue_with_problem(
        &mut problem,
        ContinuationPoint {
            state: point_state,
            param_value: seed.param1_value,
            stability: BifurcationType::None,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        },
        ContinuationSettings {
            step_size: 0.002,
            min_step_size: 1e-8,
            max_step_size: 0.01,
            max_steps: 3,
            corrector_steps: 8,
            corrector_tolerance: 2e-7,
            step_tolerance: 2e-7,
        },
        true,
    )
    .expect("continue switched NS cycle curve");
    branch.points.len()
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn zero_hopf_ns_predictor_corrects_and_continues_multiple_curve_steps() {
    let mut flow = system(
        &["x", "u", "v"],
        &["beta1", "beta2"],
        &[
            "beta1+x^2-u^2-v^2",
            "beta2*u-v+x*u-u*(u^2+v^2)",
            "u+beta2*v+x*v-v*(u^2+v^2)",
        ],
        vec![0.0, 0.0],
    );
    let nf = zero_hopf_normal_form(&mut flow, &[0.0; 3], 0, 1, 0.0, 0.0, 1.0)
        .expect("zero-Hopf normal form");
    let parameter_quadratic = [
        nf.ns_beta1 * nf.v10[0] + nf.ns_beta2 * nf.v01[0],
        nf.ns_beta1 * nf.v10[1] + nf.ns_beta2 * nf.v01[1],
    ];
    assert!((parameter_quadratic[0] - 2.0).abs() < 2e-5, "nf={nf:?}");
    assert!(parameter_quadratic[1].abs() < 2e-5, "nf={nf:?}");
    let seed = zero_hopf_neimark_sacker_seed(&mut flow, &nf, 0.08, 8, 2, 5e-7)
        .expect("Zero-Hopf NS predictor")
        .expect("Zero-Hopf should emit an NS branch");
    assert_eq!(seed.target, Codim2BranchTarget::NeimarkSacker);
    assert!(seed.corrected_residual < 2e-5, "seed={seed:?}");
    let first_mesh = 8 * 2 * 3;
    let radius_squared = seed.state[first_mesh + 1].powi(2) + seed.state[first_mesh + 2].powi(2);
    assert!(seed.param2_value.abs() < 3e-4, "seed={seed:?}");
    assert!(
        (seed.param1_value - (radius_squared - radius_squared.powi(2))).abs() < 5e-4,
        "seed={seed:?}"
    );
    assert!(continue_ns_seed(&mut flow, &seed, 0, 1) >= 4);
}

#[test]
#[ignore = "medium-tier numerical regression"]
fn hopf_hopf_ns_predictors_correct_both_modes_and_continue() {
    let mut flow = system(
        &["x1", "y1", "x2", "y2"],
        &["beta1", "beta2"],
        &[
            "beta1*x1-1.7*y1-x1*(x1^2+y1^2)-2*x1*(x2^2+y2^2)",
            "1.7*x1+beta1*y1-y1*(x1^2+y1^2)-2*y1*(x2^2+y2^2)",
            "beta2*x2-y2-3*x2*(x1^2+y1^2)-4*x2*(x2^2+y2^2)",
            "x2+beta2*y2-3*y2*(x1^2+y1^2)-4*y2*(x2^2+y2^2)",
        ],
        vec![0.0, 0.0],
    );
    let nf = hopf_hopf_normal_form(&mut flow, &[0.0; 4], 0, 1, 0.0, 0.0, 1.7)
        .expect("Hopf-Hopf normal form");
    let seeds = hopf_hopf_neimark_sacker_seeds(&mut flow, &nf, 0.07, 8, 2, 5e-7)
        .expect("Hopf-Hopf NS predictors");
    assert_eq!(seeds.len(), 2, "seeds={seeds:?}");
    assert!(seeds.iter().any(|seed| seed.perturbation > 0.0));
    assert!(seeds.iter().any(|seed| seed.perturbation < 0.0));
    for seed in &seeds {
        assert!(seed.corrected_residual < 2e-5, "seed={seed:?}");
        let first_mesh = 8 * 2 * 4;
        let r1_squared = seed.state[first_mesh].powi(2) + seed.state[first_mesh + 1].powi(2);
        let r2_squared = seed.state[first_mesh + 2].powi(2) + seed.state[first_mesh + 3].powi(2);
        if seed.perturbation > 0.0 {
            assert!(
                (seed.param1_value - r1_squared).abs() < 8e-4,
                "seed={seed:?}"
            );
            assert!(
                (seed.param2_value - 3.0 * r1_squared).abs() < 8e-4,
                "seed={seed:?}"
            );
        } else {
            assert!(
                (seed.param1_value - 2.0 * r2_squared).abs() < 8e-4,
                "seed={seed:?}"
            );
            assert!(
                (seed.param2_value - 4.0 * r2_squared).abs() < 8e-4,
                "seed={seed:?}"
            );
        }
        assert!(continue_ns_seed(&mut flow, seed, 0, 1) >= 4);
    }
}

#[test]
fn refined_zero_hopf_point_retains_full_normal_form_diagnostics() {
    let mut flow = system(
        &["x", "u", "v"],
        &["beta1", "beta2"],
        &[
            "beta1+x^2-u^2-v^2",
            "beta2*u-v+x*u-u*(u^2+v^2)",
            "u+beta2*v+x*v-v*(u^2+v^2)",
        ],
        vec![-0.05_f64.powi(2), 0.05],
    );
    let point = |x: f64| ContinuationPoint {
        param_value: -x.powi(2),
        state: vec![-x, x, 0.0, 0.0, 1.0],
        stability: BifurcationType::Hopf,
        eigenvalues: vec![],
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut problem =
        HopfCurveProblem::new(&mut flow, SystemKind::Flow, &[-0.05, 0.0, 0.0], 1.0, 0, 1)
            .expect("Hopf problem around Zero-Hopf");
    let events = refine_codim2_points(&mut problem, &[point(-0.05), point(0.05)], 16, 1e-8)
        .expect("refine Zero-Hopf point");
    let event = events
        .iter()
        .find(|event| event.data.bifurcation_type == Codim2BifurcationType::ZeroHopf)
        .expect("refined Zero-Hopf event");
    for name in [
        "G200",
        "G011",
        "re_G110",
        "ns_beta1",
        "ns_beta2",
        "eigen_residual",
        "homological_residual",
        "unfolding_condition",
    ] {
        assert!(
            event
                .data
                .coefficients
                .iter()
                .any(|coefficient| coefficient.name == name),
            "missing {name}: {:?}",
            event.data
        );
    }
    assert!(!event.data.candidate, "event={:?}", event.data);
}

#[test]
fn fold_side_zero_hopf_refinement_retains_the_same_normal_form_metadata() {
    let mut flow = system(
        &["x", "u", "v"],
        &["beta1", "beta2"],
        &[
            "beta1+x^2-u^2-v^2",
            "beta2*u-v+x*u-u*(u^2+v^2)",
            "u+beta2*v+x*v-v*(u^2+v^2)",
        ],
        vec![0.0, -0.05],
    );
    let point = |beta2: f64| ContinuationPoint {
        param_value: 0.0,
        state: vec![beta2, 0.0, 0.0, 0.0],
        stability: BifurcationType::Fold,
        eigenvalues: vec![],
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut problem = FoldCurveProblem::new(&mut flow, SystemKind::Flow, &[0.0; 3], 0, 1)
        .expect("fold problem around Zero-Hopf");
    let events = refine_codim2_points(&mut problem, &[point(-0.05), point(0.05)], 16, 1e-8)
        .expect("refine fold-side Zero-Hopf point");
    let event = events
        .iter()
        .find(|event| event.data.bifurcation_type == Codim2BifurcationType::ZeroHopf)
        .expect("fold-side Zero-Hopf event");
    assert!(
        event
            .data
            .coefficients
            .iter()
            .any(|coefficient| coefficient.name == "unfolding_condition"),
        "event={:?}",
        event.data
    );
    assert!(!event.data.candidate, "event={:?}", event.data);
}

#[test]
fn refined_hopf_hopf_point_retains_both_ns_unfoldings() {
    let mut flow = system(
        &["x1", "y1", "x2", "y2"],
        &["beta1", "beta2"],
        &[
            "beta1*x1-1.7*y1-x1*(x1^2+y1^2)-2*x1*(x2^2+y2^2)",
            "1.7*x1+beta1*y1-y1*(x1^2+y1^2)-2*y1*(x2^2+y2^2)",
            "beta2*x2-y2-3*x2*(x1^2+y1^2)-4*x2*(x2^2+y2^2)",
            "x2+beta2*y2-3*y2*(x1^2+y1^2)-4*y2*(x2^2+y2^2)",
        ],
        vec![0.0, -0.05],
    );
    let point = |beta2: f64| ContinuationPoint {
        param_value: 0.0,
        state: vec![beta2, 0.0, 0.0, 0.0, 0.0, 1.7_f64.powi(2)],
        stability: BifurcationType::Hopf,
        eigenvalues: vec![],
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut problem = HopfCurveProblem::new(&mut flow, SystemKind::Flow, &[0.0; 4], 1.7, 0, 1)
        .expect("Hopf problem around Hopf-Hopf");
    let events = refine_codim2_points(&mut problem, &[point(-0.05), point(0.05)], 16, 1e-8)
        .expect("refine Hopf-Hopf point");
    let event = events
        .iter()
        .find(|event| event.data.bifurcation_type == Codim2BifurcationType::DoubleHopf)
        .expect("refined Hopf-Hopf event");
    for name in [
        "omega1",
        "omega2",
        "re_G2100",
        "re_G0021",
        "re_G1110",
        "re_G1011",
        "ns1_alpha1",
        "ns1_alpha2",
        "ns2_alpha1",
        "ns2_alpha2",
        "resonance_distance",
    ] {
        assert!(
            event
                .data
                .coefficients
                .iter()
                .any(|coefficient| coefficient.name == name),
            "missing {name}: {:?}",
            event.data
        );
    }
    assert!(!event.data.candidate, "event={:?}", event.data);
}
