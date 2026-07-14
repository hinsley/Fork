use fork_core::continuation::periodic::CollocationAdaptivitySettings;
use fork_core::continuation::{
    continue_heteroclinic_curve, decode_heteroclinic_state, extend_heteroclinic_curve,
    heteroclinic_setup_from_orbit, BranchType, ContinuationBranch, ContinuationSettings,
    HeteroclinicEventKind, HeteroclinicEventStatus, HeteroclinicOrbitSeed, HomoclinicExtraFlags,
    HETEROCLINIC_SCHEMA_VERSION,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};

const SOURCE_TIME: f64 = -5.0;
const TARGET_TIME: f64 = 5.0;

fn analytic_system(params: Vec<f64>) -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string()];
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = ["1-x^2", "x*y+(mu-nu)*(1-x^2)"];
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse heteroclinic oracle")))
        .collect();
    let mut system = EquationSystem::new(bytecode, params);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn analytic_seed() -> HeteroclinicOrbitSeed {
    let sample_count = 161usize;
    let times = (0..sample_count)
        .map(|index| {
            SOURCE_TIME + (TARGET_TIME - SOURCE_TIME) * index as f64 / (sample_count - 1) as f64
        })
        .collect::<Vec<_>>();
    let states = times
        .iter()
        .map(|time| vec![time.tanh(), 0.0])
        .collect::<Vec<_>>();
    HeteroclinicOrbitSeed {
        times,
        states,
        source_equilibrium: vec![-1.0, 0.0],
        target_equilibrium: vec![1.0, 0.0],
    }
}

fn settings() -> ContinuationSettings {
    ContinuationSettings {
        step_size: 1.0e-3,
        min_step_size: 1.0e-7,
        max_step_size: 2.0e-3,
        max_steps: 3,
        corrector_steps: 24,
        corrector_tolerance: 1.0e-9,
        step_tolerance: 1.0e-9,
    }
}

#[test]
fn analytic_two_saddle_connection_continues_on_mu_equals_nu() {
    let mut system = analytic_system(vec![0.0, 0.0]);
    let setup = heteroclinic_setup_from_orbit(
        &mut system,
        &analytic_seed(),
        20,
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
    .expect("analytic heteroclinic setup");

    assert_ne!(
        setup.guess.source_equilibrium,
        setup.guess.target_equilibrium
    );
    assert_eq!(setup.source_basis.npos, 1);
    assert_eq!(setup.target_basis.nneg, 1);

    let branch = continue_heteroclinic_curve(&mut system, setup.clone(), settings(), true)
        .expect("analytic heteroclinic continuation");
    assert_eq!(branch.points.len(), 4);
    let BranchType::HeteroclinicCurve { schema, .. } = &branch.branch_type else {
        panic!("expected a genuine heteroclinic branch");
    };
    assert_eq!(schema.schema_version, HETEROCLINIC_SCHEMA_VERSION);

    for point in &branch.points[1..] {
        let event_diagnostics = point
            .heteroclinic_events
            .as_ref()
            .expect("corrected reference points persist heteroclinic diagnostics");
        assert_eq!(event_diagnostics.source_eigenvalues.len(), 2);
        assert_eq!(event_diagnostics.target_eigenvalues.len(), 2);
        assert_eq!(event_diagnostics.source_unstable_dimension, 1);
        assert_eq!(event_diagnostics.target_stable_dimension, 1);
        assert!(point.homoclinic_events.is_none());
        assert_eq!(
            event_diagnostics
                .event(HeteroclinicEventKind::CrossEndpointResonance)
                .status,
            HeteroclinicEventStatus::Unsupported
        );
        let decoded = decode_heteroclinic_state(
            &point.state,
            2,
            setup.ntst,
            setup.ncol,
            setup.extras,
            setup.guess.time,
            setup.guess.eps0,
            setup.guess.eps1,
            (setup.source_basis.nneg, setup.source_basis.npos),
            (setup.target_basis.nneg, setup.target_basis.npos),
        )
        .expect("decode continued heteroclinic point");
        assert!((point.param_value - decoded.param2_value).abs() < 2.0e-6);
        assert!((decoded.source_equilibrium[0] + 1.0).abs() < 1.0e-7);
        assert!(decoded.source_equilibrium[1].abs() < 1.0e-7);
        assert!((decoded.target_equilibrium[0] - 1.0).abs() < 1.0e-7);
        assert!(decoded.target_equilibrium[1].abs() < 1.0e-7);
        assert!(decoded.mesh_states.first().expect("source endpoint")[0] < -0.9);
        assert!(decoded.mesh_states.last().expect("target endpoint")[0] > 0.9);
    }

    let encoded = serde_json::to_string(&branch).expect("serialize heteroclinic branch");
    let persisted: ContinuationBranch =
        serde_json::from_str(&encoded).expect("deserialize heteroclinic branch");
    assert!(persisted.points[1].heteroclinic_events.is_some());
    let original_len = persisted.points.len();
    let extended = extend_heteroclinic_curve(
        &mut system,
        persisted,
        ContinuationSettings {
            max_steps: 2,
            ..settings()
        },
        true,
    )
    .expect("extend the persisted heteroclinic branch");
    assert_eq!(extended.points.len(), original_len + 2);
    let BranchType::HeteroclinicCurve { schema, .. } = &extended.branch_type else {
        panic!("extension must retain heteroclinic metadata");
    };
    assert_eq!(schema.schema_version, HETEROCLINIC_SCHEMA_VERSION);
}

#[test]
fn setup_rejects_a_connection_without_codimension_one_endpoint_indices() {
    let variables = vec!["x".to_string(), "y".to_string(), "z".to_string()];
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = ["1-x^2", "x*y", "-x*z"];
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse index fixture")))
        .collect();
    let mut system = EquationSystem::new(bytecode, vec![0.0, 0.0]);
    system.set_maps(compiler.param_map, compiler.var_map);

    let mut seed = analytic_seed();
    for state in &mut seed.states {
        state.push(0.0);
    }
    seed.source_equilibrium.push(0.0);
    seed.target_equilibrium.push(0.0);
    let error = heteroclinic_setup_from_orbit(
        &mut system,
        &seed,
        12,
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
    .expect_err("source unstable plus target stable dimensions must equal the phase dimension");
    assert!(error
        .to_string()
        .contains("codimension-one index condition"));
}

#[test]
fn underresolved_connection_adapts_and_persists_its_exact_mesh() {
    let mut system = analytic_system(vec![0.0, 0.0]);
    let mut setup = heteroclinic_setup_from_orbit(
        &mut system,
        &analytic_seed(),
        2,
        1,
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
    .expect("coarse heteroclinic setup");
    setup.collocation_adaptivity = CollocationAdaptivitySettings {
        enabled: true,
        redistribution_enabled: true,
        defect_tolerance: 2.0e-3,
        max_refinements: 4,
        max_mesh_points: 32,
    };
    let branch = continue_heteroclinic_curve(
        &mut system,
        setup,
        ContinuationSettings {
            max_steps: 1,
            corrector_steps: 32,
            ..settings()
        },
        true,
    )
    .expect("adaptive heteroclinic continuation");
    let BranchType::HeteroclinicCurve {
        ntst,
        normalized_mesh,
        collocation_adaptation: Some(report),
        ..
    } = branch.branch_type
    else {
        panic!("adaptive branch metadata");
    };
    assert!(!report.attempts.is_empty());
    assert_eq!(report.current_mesh_points, ntst);
    assert_eq!(report.current_normalized_mesh, normalized_mesh);
    assert_eq!(normalized_mesh.len(), ntst + 1);
}
