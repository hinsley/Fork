//! End-to-end numerical coverage for a two-parameter Neimark-Sacker curve of
//! map fixed points.

use fork_core::continuation::equilibrium::{continue_parameter, EquilibriumContinuationProblem};
use fork_core::continuation::{
    continue_with_problem, BifurcationType, ContinuationPoint, ContinuationProblem,
    ContinuationSettings, HopfCurveProblem,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;
use nalgebra::DVector;

fn rotating_map(p1: f64, p2: f64) -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string()];
    let parameters = vec!["p1".to_string(), "p2".to_string()];
    let compiler = Compiler::new(&variables, &parameters);
    let equations = [
        "(1+p1+p2)*(0.5*x-0.8660254037844386*y)",
        "(1+p1+p2)*(0.8660254037844386*x+0.5*y)",
    ]
    .iter()
    .map(|equation| compiler.compile(&parse(equation).expect("parse rotating map")))
    .collect();
    let mut system = EquationSystem::new(equations, vec![p1, p2]);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

#[test]
fn rotating_map_ns_curve_follows_unit_modulus_locus() {
    // Offset the start so the regular continuation test brackets (rather than
    // deliberately lands on) the NS event. Exact-hit behavior has its own
    // scalar crossing regression in the generic continuation tests.
    let initial_p1 = -0.41;
    let p2 = 0.2;
    let mut system = rotating_map(initial_p1, p2);
    {
        let mut diagnostic_system = rotating_map(initial_p1, p2);
        let mut diagnostic_problem = EquilibriumContinuationProblem::new(
            &mut diagnostic_system,
            SystemKind::Map { iterations: 1 },
            0,
        );
        let inside = diagnostic_problem
            .diagnostics(&DVector::from_vec(vec![-0.21, 0.0, 0.0]))
            .expect("inside diagnostics");
        let outside = diagnostic_problem
            .diagnostics(&DVector::from_vec(vec![-0.16, 0.0, 0.0]))
            .expect("outside diagnostics");
        assert!(inside.test_values.neimark_sacker < 0.0);
        assert!(outside.test_values.neimark_sacker > 0.0);
    }
    let detection_settings = ContinuationSettings {
        step_size: 0.05,
        min_step_size: 1.0e-6,
        max_step_size: 0.08,
        max_steps: 8,
        corrector_steps: 8,
        corrector_tolerance: 1.0e-10,
        step_tolerance: 1.0e-10,
    };
    let fixed_points = continue_parameter(
        &mut system,
        SystemKind::Map { iterations: 1 },
        &[0.0, 0.0],
        0,
        detection_settings,
        true,
    )
    .expect("continue rotating-map fixed point");
    let ns = fixed_points
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::NeimarkSacker)
        .unwrap_or_else(|| {
            panic!(
                "detect rotating-map Neimark-Sacker point; points={:?}",
                fixed_points
                    .points
                    .iter()
                    .map(|point| (
                        point.param_value,
                        point.stability,
                        point.eigenvalues.clone()
                    ))
                    .collect::<Vec<_>>()
            )
        })
        .clone();
    assert!((ns.param_value + p2).abs() < 1.0e-8);
    let cosine = ns
        .eigenvalues
        .iter()
        .filter(|value| value.im.abs() > 1.0e-8)
        .map(|value| value.re)
        .next()
        .expect("critical complex multiplier");
    system.params[0] = ns.param_value;

    let mut problem = HopfCurveProblem::new(
        &mut system,
        SystemKind::Map { iterations: 1 },
        &ns.state,
        cosine,
        0,
        1,
    )
    .expect("map NS defining system");
    let initial = ContinuationPoint {
        // continue_with_problem prepends p1: [p1, p2, x, y, cos(theta)]
        state: vec![p2, ns.state[0], ns.state[1], cosine],
        param_value: ns.param_value,
        stability: BifurcationType::NeimarkSacker,
        eigenvalues: vec![],
        cycle_points: None,
        homoclinic_events: None,
    };
    let settings = ContinuationSettings {
        step_size: 0.02,
        min_step_size: 1.0e-7,
        max_step_size: 0.04,
        max_steps: 8,
        corrector_steps: 10,
        corrector_tolerance: 1.0e-10,
        step_tolerance: 1.0e-10,
    };

    let branch = continue_with_problem(&mut problem, initial, settings, true)
        .expect("continue the map NS curve");
    assert!(
        branch.points.len() >= 3,
        "map NS continuation must accept multiple steps"
    );
    for point in &branch.points {
        let continued_p2 = point.state[0];
        let cosine = *point.state.last().expect("NS cosine auxiliary");
        assert!(
            (point.param_value + continued_p2).abs() < 1.0e-4,
            "off exact NS locus: p1={}, p2={continued_p2}",
            point.param_value
        );
        assert!((cosine - 0.5).abs() < 3.0e-4, "cos(theta)={cosine}");
        assert_eq!(point.eigenvalues.len(), 2);
        assert!(
            point
                .eigenvalues
                .iter()
                .all(|multiplier| (multiplier.norm() - 1.0).abs() < 1.0e-4),
            "multipliers left the unit circle: {:?}",
            point.eigenvalues
        );
    }
}
