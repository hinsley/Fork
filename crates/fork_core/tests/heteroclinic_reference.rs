use fork_core::continuation::periodic::CollocationAdaptivitySettings;
use fork_core::continuation::{
    continue_heteroclinic_curve, continue_heteroclinic_shooting_curve,
    decode_heteroclinic_shooting_state, decode_heteroclinic_state, extend_heteroclinic_curve,
    heteroclinic_setup_from_orbit, heteroclinic_shooting_setup_from_collocation, BranchType,
    ContinuationBranch, ContinuationSettings, HeteroclinicEventKind, HeteroclinicEventStatus,
    HeteroclinicOrbitSeed, HeteroclinicShootingSettings, HomoclinicDiscretization,
    HomoclinicExtraFlags, HETEROCLINIC_SCHEMA_VERSION,
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

fn inclination_system(source_flip: bool, params: Vec<f64>) -> EquationSystem {
    let variables = vec![
        "x".to_string(),
        "w".to_string(),
        "y".to_string(),
        "z".to_string(),
    ];
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = if source_flip {
        ["1-x^2", "x*w+(mu-nu)*(1-x^2)+mu*(1-x^2)*y", "0.5*y", "-3*z"]
    } else {
        ["1-x^2", "x*w-(mu-nu)*(1-x^2)-mu*(1-x^2)*y", "-0.5*y", "3*z"]
    };
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse inclination oracle")))
        .collect();
    let mut system = EquationSystem::new(bytecode, params);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn inclination_seed() -> HeteroclinicOrbitSeed {
    let sample_count = 161usize;
    let times = (0..sample_count)
        .map(|index| {
            SOURCE_TIME + (TARGET_TIME - SOURCE_TIME) * index as f64 / (sample_count - 1) as f64
        })
        .collect::<Vec<_>>();
    let states = times
        .iter()
        .map(|time| vec![time.tanh(), 0.0, 0.0, 0.0])
        .collect::<Vec<_>>();
    HeteroclinicOrbitSeed {
        times,
        states,
        source_equilibrium: vec![-1.0, 0.0, 0.0, 0.0],
        target_equilibrium: vec![1.0, 0.0, 0.0, 0.0],
    }
}

fn complex_inclination_system(source_flip: bool, params: Vec<f64>) -> EquationSystem {
    let variables = ["x", "w", "y", "u", "z"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let parameter_names = vec!["mu".to_string(), "nu".to_string()];
    let compiler = Compiler::new(&variables, &parameter_names);
    let equations = if source_flip {
        [
            "1-x^2",
            "0.5*w-y",
            "w+0.5*y",
            "0.75*x*u+(mu-nu)*(1-x^2)+mu*(1-x^2)*w",
            "-3*z",
        ]
    } else {
        [
            "1-x^2",
            "-0.5*w-y",
            "w-0.5*y",
            "0.75*x*u-(mu-nu)*(1-x^2)-mu*(1-x^2)*w",
            "3*z",
        ]
    };
    let bytecode = equations
        .iter()
        .map(|equation| {
            compiler.compile(&parse(equation).expect("parse complex inclination oracle"))
        })
        .collect();
    let mut system = EquationSystem::new(bytecode, params);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn complex_inclination_seed() -> HeteroclinicOrbitSeed {
    let sample_count = 161usize;
    let times = (0..sample_count)
        .map(|index| {
            SOURCE_TIME + (TARGET_TIME - SOURCE_TIME) * index as f64 / (sample_count - 1) as f64
        })
        .collect::<Vec<_>>();
    HeteroclinicOrbitSeed {
        states: times
            .iter()
            .map(|time| vec![time.tanh(), 0.0, 0.0, 0.0, 0.0])
            .collect(),
        times,
        source_equilibrium: vec![-1.0, 0.0, 0.0, 0.0, 0.0],
        target_equilibrium: vec![1.0, 0.0, 0.0, 0.0, 0.0],
    }
}

#[test]
fn transported_inclination_tests_cross_on_analytic_connections() {
    for (source_flip, kind, bifurcation) in [
        (
            true,
            HeteroclinicEventKind::SourceInclinationFlip,
            fork_core::continuation::BifurcationType::HeteroclinicSourceInclinationFlip,
        ),
        (
            false,
            HeteroclinicEventKind::TargetInclinationFlip,
            fork_core::continuation::BifurcationType::HeteroclinicTargetInclinationFlip,
        ),
    ] {
        for forward in [true, false] {
            let start = if forward { -3.0e-3 } else { 3.0e-3 };
            let mut system = inclination_system(source_flip, vec![start, start]);
            let mut setup = heteroclinic_setup_from_orbit(
                &mut system,
                &inclination_seed(),
                20,
                3,
                &[start, start],
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
            .expect("analytic inclination setup");
            if source_flip && forward {
                setup.projector_refresh_interval = 1;
            }
            let collocation = continue_heteroclinic_curve(
                &mut system,
                setup.clone(),
                ContinuationSettings {
                    step_size: 1.0e-3,
                    min_step_size: 1.0e-7,
                    max_step_size: 1.0e-3,
                    max_steps: 8,
                    corrector_steps: 24,
                    corrector_tolerance: 1.0e-9,
                    step_tolerance: 1.0e-9,
                },
                forward,
            )
            .expect("analytic inclination continuation");
            let collocation_zero =
                assert_inclination_branch(&collocation, kind, bifurcation, (4, 1, 1, 1));
            if source_flip && forward {
                let persisted: ContinuationBranch = serde_json::from_str(
                    &serde_json::to_string(&collocation)
                        .expect("serialize analytic inclination branch"),
                )
                .expect("deserialize analytic inclination branch");
                let original_len = persisted.points.len();
                let extended = extend_heteroclinic_curve(
                    &mut system,
                    persisted,
                    ContinuationSettings {
                        max_steps: 2,
                        ..settings()
                    },
                    forward,
                )
                .expect("extend serialized inclination branch");
                assert_eq!(extended.points.len(), original_len + 2);
                let endpoint = extended
                    .points
                    .last()
                    .and_then(|point| point.heteroclinic_events.as_ref())
                    .and_then(|diagnostics| diagnostics.inclination_transport.as_ref())
                    .and_then(|transport| transport.source.as_ref());
                assert!(endpoint.is_some(), "restart must preserve the SIF gauge");
            }

            let shooting_setup = heteroclinic_shooting_setup_from_collocation(
                &setup,
                HeteroclinicShootingSettings {
                    intervals: 6,
                    integration_steps_per_segment: 128,
                },
            )
            .expect("analytic inclination shooting setup");
            let shooting = continue_heteroclinic_shooting_curve(
                &mut system,
                shooting_setup,
                ContinuationSettings {
                    step_size: 1.0e-3,
                    min_step_size: 1.0e-7,
                    max_step_size: 1.0e-3,
                    max_steps: 8,
                    corrector_steps: 24,
                    corrector_tolerance: 1.0e-9,
                    step_tolerance: 1.0e-9,
                },
                forward,
            )
            .expect("analytic inclination shooting continuation");
            let shooting_zero =
                assert_inclination_branch(&shooting, kind, bifurcation, (4, 1, 1, 1));
            assert!(
            collocation_zero.abs() < 1.0e-5 && shooting_zero.abs() < 1.0e-5,
            "{kind:?} must localize the analytic zero: collocation={collocation_zero}, shooting={shooting_zero}"
        );
            assert!(
                (collocation_zero - shooting_zero).abs() < 1.0e-5,
                "{kind:?} discretizations disagree on the localized zero"
            );
        }
    }
}

#[test]
fn complex_principal_blocks_localize_transport_rank_loss() {
    for (source_flip, kind, bifurcation) in [
        (
            true,
            HeteroclinicEventKind::SourceInclinationFlip,
            fork_core::continuation::BifurcationType::HeteroclinicSourceInclinationFlip,
        ),
        (
            false,
            HeteroclinicEventKind::TargetInclinationFlip,
            fork_core::continuation::BifurcationType::HeteroclinicTargetInclinationFlip,
        ),
    ] {
        for forward in [true, false] {
            let start = if forward { -3.0e-3 } else { 3.0e-3 };
            let mut system = complex_inclination_system(source_flip, vec![start, start]);
            let setup = heteroclinic_setup_from_orbit(
                &mut system,
                &complex_inclination_seed(),
                20,
                3,
                &[start, start],
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
            .expect("complex-principal inclination setup");
            let continuation_settings = ContinuationSettings {
                step_size: 1.0e-3,
                min_step_size: 1.0e-7,
                max_step_size: 1.0e-3,
                max_steps: 8,
                corrector_steps: 24,
                corrector_tolerance: 1.0e-9,
                step_tolerance: 1.0e-9,
            };
            let collocation = continue_heteroclinic_curve(
                &mut system,
                setup.clone(),
                continuation_settings,
                forward,
            )
            .expect("complex-principal collocation continuation");
            let collocation_zero =
                assert_inclination_branch(&collocation, kind, bifurcation, (5, 2, 1, 2));
            if source_flip && forward {
                let persisted: ContinuationBranch = serde_json::from_str(
                    &serde_json::to_string(&collocation)
                        .expect("serialize complex-principal inclination branch"),
                )
                .expect("deserialize complex-principal inclination branch");
                let original_len = persisted.points.len();
                let extended = extend_heteroclinic_curve(
                    &mut system,
                    persisted,
                    ContinuationSettings {
                        max_steps: 2,
                        ..continuation_settings
                    },
                    forward,
                )
                .expect("extend serialized complex-principal inclination branch");
                assert_eq!(extended.points.len(), original_len + 2);
                let endpoint = extended
                    .points
                    .last()
                    .and_then(|point| point.heteroclinic_events.as_ref())
                    .and_then(|diagnostics| diagnostics.inclination_transport.as_ref())
                    .and_then(|transport| transport.source.as_ref())
                    .expect("complex-principal restart frame");
                assert_eq!(endpoint.exterior_orientation.len(), 2);
                assert!(endpoint.gauge_invariant_overlap_volume.is_finite());
            }

            let shooting_setup = heteroclinic_shooting_setup_from_collocation(
                &setup,
                HeteroclinicShootingSettings {
                    intervals: 6,
                    integration_steps_per_segment: 128,
                },
            )
            .expect("complex-principal shooting setup");
            let shooting = continue_heteroclinic_shooting_curve(
                &mut system,
                shooting_setup,
                continuation_settings,
                forward,
            )
            .expect("complex-principal shooting continuation");
            let shooting_zero =
                assert_inclination_branch(&shooting, kind, bifurcation, (5, 2, 1, 2));
            assert!(collocation_zero.abs() < 1.0e-5);
            assert!(shooting_zero.abs() < 1.0e-5);
            assert!((collocation_zero - shooting_zero).abs() < 1.0e-5);
        }
    }
}

fn assert_inclination_branch(
    branch: &ContinuationBranch,
    kind: HeteroclinicEventKind,
    bifurcation: fork_core::continuation::BifurcationType,
    expected_dimensions: (usize, usize, usize, usize),
) -> f64 {
    let values = branch
        .points
        .iter()
        .filter_map(|point| point.heteroclinic_events.as_ref())
        .filter_map(|diagnostics| {
            let event = diagnostics.event(kind);
            (event.status == HeteroclinicEventStatus::Available)
                .then_some(event.value)
                .flatten()
        })
        .collect::<Vec<_>>();
    let parameters = branch
        .points
        .iter()
        .map(|point| point.param_value)
        .collect::<Vec<_>>();
    assert!(
        values.iter().any(|value| *value < -1.0e-6),
        "{kind:?} must be negative before the analytic flip: values={values:?}, parameters={parameters:?}"
    );
    assert!(
        values.iter().any(|value| *value > 1.0e-6),
        "{kind:?} must be positive after the analytic flip: {values:?}"
    );
    let localized = branch
        .points
        .iter()
        .find(|point| point.stability == bifurcation)
        .unwrap_or_else(|| panic!("{kind:?} must be localized and classified"));
    let frames = branch
        .points
        .iter()
        .filter_map(|point| point.heteroclinic_events.as_ref())
        .filter_map(|diagnostics| diagnostics.inclination_transport.as_ref())
        .filter_map(|transport| match kind {
            HeteroclinicEventKind::SourceInclinationFlip => transport.source.as_ref(),
            HeteroclinicEventKind::TargetInclinationFlip => transport.target.as_ref(),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(!frames.is_empty(), "{kind:?} frame payload must persist");
    assert!(frames.iter().all(|frame| {
        frame.ambient_dimension == expected_dimensions.0
            && frame.frame_dimension == expected_dimensions.1
            && frame.reference_dimension == expected_dimensions.2
            && frame.principal_dimension == expected_dimensions.3
            && frame.relative_transport_residual < 1.0e-6
    }));
    localized.param_value
}

#[test]
fn analytic_connection_continues_and_extends_with_single_and_multiple_shooting() {
    for intervals in [1usize, 6] {
        let mut system = analytic_system(vec![0.0, 0.0]);
        let collocation = heteroclinic_setup_from_orbit(
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
        .expect("analytic heteroclinic collocation seed");
        let shooting = heteroclinic_shooting_setup_from_collocation(
            &collocation,
            HeteroclinicShootingSettings {
                intervals,
                integration_steps_per_segment: 96,
            },
        )
        .expect("sample heteroclinic shooting nodes");
        assert_ne!(
            shooting.guess.source_equilibrium, shooting.guess.target_equilibrium,
            "shooting must retain two distinct endpoint equilibria"
        );

        let branch =
            continue_heteroclinic_shooting_curve(&mut system, shooting.clone(), settings(), true)
                .expect("analytic heteroclinic shooting continuation");
        assert_eq!(branch.points.len(), 4, "M={intervals}");
        let BranchType::HeteroclinicCurve {
            schema,
            ntst,
            ncol,
            discretization,
            ..
        } = &branch.branch_type
        else {
            panic!("expected a genuine heteroclinic shooting branch")
        };
        assert_eq!(schema.schema_version, HETEROCLINIC_SCHEMA_VERSION);
        assert_eq!(*ntst, intervals);
        assert_eq!(*ncol, 0);
        assert_eq!(
            *discretization,
            HomoclinicDiscretization::Shooting {
                integration_steps_per_segment: 96
            }
        );

        for point in &branch.points[1..] {
            let event_diagnostics = point
                .heteroclinic_events
                .as_ref()
                .expect("shooting points persist heteroclinic diagnostics");
            assert_eq!(event_diagnostics.source_unstable_dimension, 1);
            assert_eq!(event_diagnostics.target_stable_dimension, 1);
            assert!(point.homoclinic_events.is_none());
            let decoded = decode_heteroclinic_shooting_state(&point.state, &shooting)
                .expect("decode heteroclinic shooting point");
            assert!((point.param_value - decoded.param2_value).abs() < 3.0e-6);
            assert!((decoded.source_equilibrium[0] + 1.0).abs() < 1.0e-7);
            assert!((decoded.target_equilibrium[0] - 1.0).abs() < 1.0e-7);
            assert!(decoded.nodes.first().expect("source node")[0] < -0.9);
            assert!(decoded.nodes.last().expect("target node")[0] > 0.9);
        }

        let persisted: ContinuationBranch = serde_json::from_str(
            &serde_json::to_string(&branch).expect("serialize shooting branch"),
        )
        .expect("deserialize shooting branch");
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
        .expect("extend persisted heteroclinic shooting branch");
        assert_eq!(extended.points.len(), original_len + 2, "M={intervals}");
        let BranchType::HeteroclinicCurve { discretization, .. } = extended.branch_type else {
            panic!("extension must remain a heteroclinic branch")
        };
        assert!(matches!(
            discretization,
            HomoclinicDiscretization::Shooting { .. }
        ));
        assert!(
            extended
                .points
                .last()
                .and_then(|point| point.heteroclinic_events.as_ref())
                .is_some(),
            "extended shooting points retain heteroclinic diagnostics"
        );
    }
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
