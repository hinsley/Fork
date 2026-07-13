use fork_core::continuation::{
    limit_cycle_setup_from_packed_state, periodic_branch_point_switch_setup,
    PeriodicOrbitBranchPointKind, PeriodicOrbitBranchPointNormalForm,
    PeriodicOrbitNormalFormConditioning,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};

fn oscillator() -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string()];
    let parameters = vec!["mu".to_string()];
    let compiler = Compiler::new(&variables, &parameters);
    let bytecode = ["mu*x-y", "x+mu*y"]
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse oscillator")))
        .collect();
    let mut system = EquationSystem::new(bytecode, vec![0.0]);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

#[test]
fn packed_source_preserves_nonuniform_mesh_stages_and_uses_the_vector_field_for_phase() {
    let normalized_mesh = vec![0.0, 0.1, 0.55, 1.0];
    let ncol = 2;
    let mesh_states = [[1.0, 0.0], [0.8, 0.6], [-0.8, 0.6]];
    let stage_states = [
        [0.99, 0.1],
        [0.95, 0.3],
        [0.5, 0.86],
        [-0.2, 0.98],
        [-0.9, 0.4],
        [-0.98, -0.1],
    ];
    let mut packed = mesh_states
        .iter()
        .chain(stage_states.iter())
        .flat_map(|state| state.iter().copied())
        .collect::<Vec<_>>();
    packed.push(std::f64::consts::TAU);

    let mut system = oscillator();
    let setup = limit_cycle_setup_from_packed_state(
        &mut system,
        0,
        0.0,
        &packed,
        ncol,
        normalized_mesh.clone(),
    )
    .expect("packed source");

    assert_eq!(setup.normalized_mesh, normalized_mesh);
    assert_eq!(setup.guess.mesh_states, mesh_states.map(Vec::from).to_vec());
    assert_eq!(setup.guess.stage_states.len(), 3);
    assert_eq!(
        setup.guess.stage_states[1],
        stage_states[2..4]
            .iter()
            .copied()
            .map(Vec::from)
            .collect::<Vec<_>>()
    );
    assert_eq!(setup.phase_anchor, vec![1.0, 0.0]);
    assert!((setup.phase_direction[0]).abs() < 1e-12);
    assert!((setup.phase_direction[1] - 1.0).abs() < 1e-12);
    assert!(!setup.guess.requires_fixed_parameter_correction);
}

#[test]
fn packed_source_rejects_missing_mesh_instead_of_silently_uniformizing() {
    let mut system = oscillator();
    let error =
        limit_cycle_setup_from_packed_state(&mut system, 0, 0.0, &[1.0, 0.0, 1.0], 2, Vec::new())
            .expect_err("missing persistent mesh must be rejected");
    assert!(error.to_string().contains("normalized mesh"), "{error:#}");
}

#[test]
fn packed_source_accepts_an_explicit_closing_mesh_without_moving_stage_offsets() {
    let normalized_mesh = vec![0.0, 0.2, 0.7, 1.0];
    let mesh_states = [[1.0, 0.0], [0.3, 0.95], [-0.3, -0.95], [1.0, 0.0]];
    let stage_states = [
        [0.95, 0.2],
        [0.8, 0.55],
        [0.0, 1.0],
        [-0.8, 0.55],
        [-0.8, -0.55],
        [0.8, -0.55],
    ];
    let mut packed = mesh_states
        .iter()
        .chain(stage_states.iter())
        .flat_map(|state| state.iter().copied())
        .collect::<Vec<_>>();
    packed.push(std::f64::consts::TAU);

    let setup = limit_cycle_setup_from_packed_state(
        &mut oscillator(),
        0,
        0.0,
        &packed,
        2,
        normalized_mesh.clone(),
    )
    .expect("explicit closure source");

    assert_eq!(setup.normalized_mesh, normalized_mesh);
    assert_eq!(setup.guess.mesh_states.len(), 3);
    assert_eq!(setup.guess.stage_states[0][0], stage_states[0]);
    assert_eq!(setup.guess.stage_states[2][1], stage_states[5]);
}

#[test]
fn packed_source_rejects_malformed_mesh_and_wrong_state_length() {
    let mut system = oscillator();
    let malformed = limit_cycle_setup_from_packed_state(
        &mut system,
        0,
        0.0,
        &[0.0; 19],
        2,
        vec![0.0, 0.6, 0.4, 1.0],
    )
    .expect_err("nonmonotone mesh");
    assert!(malformed.to_string().contains("strictly increasing"));

    let wrong_length = limit_cycle_setup_from_packed_state(
        &mut system,
        0,
        0.0,
        &[0.0; 7],
        2,
        vec![0.0, 0.2, 0.7, 1.0],
    )
    .expect_err("wrong packed length");
    assert!(wrong_length.to_string().contains("expected 19 or 21"));
}

#[test]
fn branch_point_predictor_samples_the_persistent_nonuniform_mesh() {
    let normalized_mesh = vec![0.0, 0.1, 0.55, 1.0];
    let mesh_states = [[1.0, 0.0], [0.8, 0.6], [-0.8, 0.6]];
    let stage_states = [[0.99, 0.1], [0.5, 0.86], [-0.9, 0.4]];
    let mut packed = mesh_states
        .iter()
        .chain(stage_states.iter())
        .flat_map(|state| state.iter().copied())
        .collect::<Vec<_>>();
    packed.push(std::f64::consts::TAU);
    let mut system = oscillator();
    let source = limit_cycle_setup_from_packed_state(
        &mut system,
        0,
        0.0,
        &packed,
        1,
        normalized_mesh.clone(),
    )
    .expect("source");
    let normal_form = PeriodicOrbitBranchPointNormalForm {
        kind: PeriodicOrbitBranchPointKind::Transcritical,
        constant_parameter_coefficient: 0.0,
        linear_parameter_coefficient: 1.0,
        quadratic_coefficient: 0.0,
        cubic_coefficient: 0.0,
        critical_mode: vec![0.0, 0.0],
        conditioning: PeriodicOrbitNormalFormConditioning {
            return_map_residual: 0.0,
            section_residual: 0.0,
            return_time_correction: 0.0,
            section_transversality: 1.0,
            eigenvector_pairing: 1.0,
            right_residual: 0.0,
            left_residual: 0.0,
            homological_residual: 0.0,
        },
    };
    let switched = periodic_branch_point_switch_setup(&mut system, &source, 0, &normal_form, 0.01)
        .expect("switch predictor");

    assert_eq!(switched.normalized_mesh, normalized_mesh);
    let expected = [
        (std::f64::consts::TAU * 0.1).cos(),
        (std::f64::consts::TAU * 0.1).sin(),
    ];
    assert!(
        switched.guess.mesh_states[1]
            .iter()
            .zip(expected)
            .all(|(actual, expected)| (actual - expected).abs() < 2e-4),
        "mesh={:?}",
        switched.guess.mesh_states
    );
}
