//! Slow, published-model validation for Orbit-seeded cycle bifurcation curves.
//!
//! These tests intentionally begin with a numerically integrated attracting
//! orbit. They do not import a MATCONT or BifurcationKit collocation vector.
//! The published values and source provenance are documented in
//! `docs/limit_cycle_continuation.md`.

use fork_core::continuation::{
    continue_limit_cycle_collocation, continue_with_problem, limit_cycle_setup_from_orbit,
    BifurcationType, BranchType, ContinuationPoint, ContinuationSettings, LPCCurveProblem,
    NSCurveProblem, OrbitTimeMode,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::solvers::RK4;
use fork_core::traits::Steppable;
use num_complex::Complex;

fn compiled_system(
    equations: &[&str],
    variables: &[&str],
    parameters: &[&str],
    values: Vec<f64>,
) -> EquationSystem {
    let variables = variables
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let parameters = parameters
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let compiler = Compiler::new(&variables, &parameters);
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse reference equation")))
        .collect();
    let mut system = EquationSystem::new(bytecode, values);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn mlfast_system(y: f64, z: f64) -> EquationSystem {
    compiled_system(
        &[
            "y-0.5*(v+0.5)-2*w*(v+0.7)-((1+tanh((v+0.01)/0.15))/2)*(v-1)",
            "1.15*(((1+tanh((v-z)/0.145))/2)-w)*cosh((v-0.1)/0.29)",
        ],
        &["v", "w"],
        &["y", "z"],
        vec![y, z],
    )
}

fn steinmetz_larter_system(k7: f64, k8: f64) -> EquationSystem {
    compiled_system(
        &[
            "-k1*A*B*X-k3*A*B*Y+k7-km7*A",
            "-k1*A*B*X-k3*A*B*Y+k8",
            "k1*A*B*X-2*k2*X^2+2*k3*A*B*Y-k4*X+k6",
            "-k3*A*B*Y+2*k2*X^2-k5*Y",
        ],
        &["A", "B", "X", "Y"],
        &["k1", "k2", "k3", "k4", "k5", "k6", "k7", "km7", "k8"],
        vec![
            0.163_102_1,
            1250.0,
            0.046_875,
            20.0,
            1.104,
            0.001,
            k7,
            0.1175,
            k8,
        ],
    )
}

fn settled_orbit(
    system: &EquationSystem,
    initial: &[f64],
    dt: f64,
    settle_steps: usize,
    sample_steps: usize,
) -> (Vec<f64>, Vec<Vec<f64>>) {
    let mut solver = RK4::new(initial.len());
    let mut time = 0.0;
    let mut state = initial.to_vec();
    for _ in 0..settle_steps {
        solver.step(system, &mut time, &mut state, dt);
    }

    let mut times = Vec::with_capacity(sample_steps + 1);
    let mut states = Vec::with_capacity(sample_steps + 1);
    times.push(time);
    states.push(state.clone());
    for _ in 0..sample_steps {
        solver.step(system, &mut time, &mut state, dt);
        times.push(time);
        states.push(state.clone());
    }
    (times, states)
}

fn explicit_stage_first_state(
    implicit: &[f64],
    dimension: usize,
    ntst: usize,
    ncol: usize,
) -> (Vec<f64>, f64) {
    let mesh_len = ntst * dimension;
    let stage_len = ntst * ncol * dimension;
    assert_eq!(implicit.len(), mesh_len + stage_len + 1);

    let mut explicit = implicit[mesh_len..mesh_len + stage_len].to_vec();
    explicit.extend_from_slice(&implicit[..mesh_len]);
    explicit.extend_from_slice(&implicit[..dimension]);
    (explicit, implicit[mesh_len + stage_len])
}

fn distance_to_multiplier(point: &ContinuationPoint, target: Complex<f64>) -> f64 {
    point
        .eigenvalues
        .iter()
        .map(|value| (*value - target).norm())
        .fold(f64::INFINITY, f64::min)
}

#[derive(Debug)]
struct SteinmetzReference {
    requested_ntst: usize,
    requested_ncol: usize,
    effective_ntst: usize,
    ns_k8: f64,
    period: f64,
    critical_cosine: f64,
    curve: Vec<(f64, f64)>,
}

fn mlfast_reference_on_grid(
    orbit_times: &[f64],
    orbit_states: &[Vec<f64>],
    ntst: usize,
    ncol: usize,
) -> (f64, f64) {
    let initial_y = 0.084;
    let z = 0.1;
    let mut system = mlfast_system(initial_y, z);
    let setup = limit_cycle_setup_from_orbit(
        orbit_times,
        orbit_states,
        initial_y,
        ntst,
        ncol,
        0.01,
        OrbitTimeMode::Continuous,
    )
    .expect("attracting MLfast Orbit seed");
    let config = setup.collocation_config();
    let branch = continue_limit_cycle_collocation(
        &mut system,
        0,
        config,
        setup.guess,
        ContinuationSettings {
            step_size: 2.0e-3,
            min_step_size: 1.0e-6,
            max_step_size: 3.0e-3,
            max_steps: 240,
            corrector_steps: 12,
            corrector_tolerance: 1.0e-9,
            step_tolerance: 1.0e-10,
        },
        true,
    )
    .expect("Orbit-seeded MLfast continuation");

    let initial = branch.points.first().expect("corrected MLfast cycle");
    let trivial = initial
        .eigenvalues
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (**left - Complex::new(1.0, 0.0))
                .norm_sqr()
                .total_cmp(&(**right - Complex::new(1.0, 0.0)).norm_sqr())
        })
        .map(|(index, _)| index)
        .expect("trivial multiplier");
    assert!(
        initial
            .eigenvalues
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != trivial)
            .all(|(_, multiplier)| multiplier.norm() < 1.0),
        "the MLfast Orbit seed must be attracting: {:?}",
        initial.eigenvalues
    );

    let lpc = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::CycleFold)
        .unwrap_or_else(|| {
            panic!(
                "detect the published MLfast LPC; samples={:?}",
                branch
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
    let (coords, period) = explicit_stage_first_state(&lpc.state, 2, ntst, ncol);
    let problem = LPCCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        lpc.param_value,
        z,
        ntst,
        ncol,
    )
    .expect("MLfast LPC defining system");
    let mut state = coords;
    state.push(period);
    state.push(z);
    let seed = ContinuationPoint {
        state,
        param_value: lpc.param_value,
        stability: BifurcationType::CycleFold,
        eigenvalues: lpc.eigenvalues,
        cycle_points: None,
    };
    let curve = continue_with_problem(
        &mut { problem },
        seed,
        ContinuationSettings {
            step_size: 2.0e-4,
            min_step_size: 1.0e-8,
            max_step_size: 5.0e-4,
            max_steps: 2,
            corrector_steps: 12,
            corrector_tolerance: 1.0e-8,
            step_tolerance: 1.0e-10,
        },
        true,
    )
    .expect("MLfast LPC curve continuation");
    assert_eq!(curve.points.len(), 3, "seed plus two accepted LPC points");
    for point in &curve.points {
        assert!(
            distance_to_multiplier(point, Complex::new(1.0, 0.0)) < 2.0e-3,
            "MLfast LPC point lacks the fold multiplier: {:?}",
            point.eigenvalues
        );
        assert!(
            point
                .eigenvalues
                .iter()
                .filter(|multiplier| (**multiplier - Complex::new(1.0, 0.0)).norm() < 2.0e-3)
                .count()
                >= 2,
            "MLfast LPC point lacks two +1 multipliers: {:?}",
            point.eigenvalues
        );
    }
    (lpc.param_value, period)
}

fn steinmetz_reference_on_grid(
    orbit_times: &[f64],
    orbit_states: &[Vec<f64>],
    ntst: usize,
    ncol: usize,
    curve_steps: usize,
) -> SteinmetzReference {
    let initial_k7 = 1.5;
    let initial_k8 = 0.82;
    let mut system = steinmetz_larter_system(initial_k7, initial_k8);
    let setup = limit_cycle_setup_from_orbit(
        orbit_times,
        orbit_states,
        initial_k8,
        ntst,
        ncol,
        0.01,
        OrbitTimeMode::Continuous,
    )
    .expect("attracting Steinmetz-Larter Orbit seed");
    let config = setup.collocation_config();
    let branch = continue_limit_cycle_collocation(
        &mut system,
        8,
        config,
        setup.guess,
        ContinuationSettings {
            step_size: 2.0e-3,
            min_step_size: 1.0e-7,
            max_step_size: 3.0e-3,
            max_steps: 220,
            corrector_steps: 14,
            corrector_tolerance: 1.0e-9,
            step_tolerance: 1.0e-10,
        },
        true,
    )
    .expect("Orbit-seeded Steinmetz-Larter continuation");
    let (effective_ntst, normalized_mesh) = match &branch.branch_type {
        BranchType::LimitCycle {
            ntst,
            ncol: degree,
            normalized_mesh,
        } => {
            assert_eq!(*degree, ncol);
            (*ntst, normalized_mesh.clone())
        }
        other => panic!("unexpected Steinmetz-Larter branch type: {other:?}"),
    };

    let initial = branch
        .points
        .first()
        .expect("corrected Steinmetz-Larter cycle");
    let trivial = initial
        .eigenvalues
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (**left - Complex::new(1.0, 0.0))
                .norm_sqr()
                .total_cmp(&(**right - Complex::new(1.0, 0.0)).norm_sqr())
        })
        .map(|(index, _)| index)
        .expect("trivial multiplier");
    assert!(
        initial
            .eigenvalues
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != trivial)
            .all(|(_, multiplier)| multiplier.norm() < 1.0),
        "the Steinmetz-Larter Orbit seed must be attracting: {:?}",
        initial.eigenvalues
    );

    let ns = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::NeimarkSacker)
        .unwrap_or_else(|| {
            panic!(
                "detect the Steinmetz-Larter NS; samples={:?}",
                branch
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
    let defining = ns
        .eigenvalues
        .iter()
        .filter(|multiplier| multiplier.im > 1.0e-3)
        .min_by(|left, right| {
            (left.norm() - 1.0)
                .abs()
                .total_cmp(&(right.norm() - 1.0).abs())
        })
        .expect("nonreal unit multiplier");
    let defining_k = defining.re / defining.norm();
    let (coords, period) = explicit_stage_first_state(&ns.state, 4, effective_ntst, ncol);
    if curve_steps == 0 {
        return SteinmetzReference {
            requested_ntst: ntst,
            requested_ncol: ncol,
            effective_ntst,
            ns_k8: ns.param_value,
            period,
            critical_cosine: defining_k,
            curve: vec![(initial_k7, ns.param_value)],
        };
    }
    let mut problem = NSCurveProblem::new_on_mesh(
        &mut system,
        coords.clone(),
        period,
        8,
        6,
        ns.param_value,
        initial_k7,
        defining_k,
        effective_ntst,
        ncol,
        normalized_mesh,
    )
    .expect("Steinmetz-Larter NS defining system");
    let mut state = coords;
    state.push(period);
    state.push(initial_k7);
    state.push(defining_k);
    let seed = ContinuationPoint {
        state,
        param_value: ns.param_value,
        stability: BifurcationType::NeimarkSacker,
        eigenvalues: ns.eigenvalues,
        cycle_points: None,
    };
    let curve = continue_with_problem(
        &mut problem,
        seed,
        ContinuationSettings {
            step_size: 5.0e-3,
            min_step_size: 1.0e-8,
            max_step_size: 2.0e-2,
            max_steps: curve_steps,
            corrector_steps: 14,
            corrector_tolerance: 1.0e-8,
            step_tolerance: 1.0e-10,
        },
        true,
    )
    .expect("Steinmetz-Larter NS curve continuation");
    assert!(curve.points.len() > 2, "NS seed plus accepted curve steps");
    let curve = curve
        .points
        .iter()
        .map(|point| {
            let k7 = point.state[point.state.len() - 2];
            let critical = point
                .eigenvalues
                .iter()
                .filter(|multiplier| multiplier.im > 1.0e-3)
                .min_by(|left, right| {
                    (left.norm() - 1.0)
                        .abs()
                        .total_cmp(&(right.norm() - 1.0).abs())
                })
                .unwrap_or_else(|| {
                    panic!(
                        "continued nonreal unit multiplier at ({k7}, {}): {:?}",
                        point.param_value, point.eigenvalues
                    )
                });
            assert!(
                (critical.norm() - 1.0).abs() < 3.0e-3,
                "Steinmetz-Larter NS multiplier={critical:?}"
            );
            (k7, point.param_value)
        })
        .collect();
    SteinmetzReference {
        requested_ntst: ntst,
        requested_ncol: ncol,
        effective_ntst,
        ns_k8: ns.param_value,
        period,
        critical_cosine: defining_k,
        curve,
    }
}

#[test]
#[ignore = "published Orbit-to-LPC mesh-convergence benchmark; run in the bounded slow validation tier"]
fn mlfast_orbit_reaches_published_lpc_and_continues_curve() {
    let system = mlfast_system(0.084, 0.1);
    let (times, states) = settled_orbit(&system, &[-0.1, 0.2], 0.005, 80_000, 16_000);
    let coarse = mlfast_reference_on_grid(&times, &states, 20, 4);
    let fine = mlfast_reference_on_grid(&times, &states, 32, 4);
    assert!(
        (fine.0 - 0.084_569_48).abs() < 1.0e-4,
        "fine LPC y={}",
        fine.0
    );
    assert!((fine.1 - 4.222_012).abs() < 2.0e-4, "fine LPC T={}", fine.1);
    assert!(
        (coarse.0 - fine.0).abs() < 2.0e-4,
        "coarse/fine y={coarse:?}/{fine:?}"
    );
    assert!(
        (coarse.1 - fine.1).abs() < 2.0e-4,
        "coarse/fine T={coarse:?}/{fine:?}"
    );
}

#[test]
#[ignore = "published Orbit-to-NS mesh-convergence benchmark; run in the bounded slow validation tier"]
fn steinmetz_larter_orbit_reaches_published_ns_and_continues_curve() {
    let system = steinmetz_larter_system(1.5, 0.82);
    let (times, states) = settled_orbit(&system, &[1.0, 1.0, 0.01, 0.01], 0.001, 136_000, 40_000);
    let coarse = steinmetz_reference_on_grid(&times, &states, 16, 3, 16);
    let fine = steinmetz_reference_on_grid(&times, &states, 16, 4, 0);
    assert_eq!(coarse.requested_ntst, 16);
    assert_eq!(fine.requested_ntst, 16);
    assert_eq!(coarse.requested_ncol, 3);
    assert_eq!(fine.requested_ncol, 4);
    assert!(coarse.effective_ntst >= coarse.requested_ntst);
    assert!(fine.effective_ntst >= fine.requested_ntst);
    assert!(
        (coarse.ns_k8 - fine.ns_k8).abs() < 2.0e-4,
        "coarse={coarse:?}, fine={fine:?}"
    );
    assert!(
        (coarse.period - fine.period).abs() < 2.0e-2,
        "coarse={coarse:?}, fine={fine:?}"
    );
    assert!(
        (coarse.critical_cosine - fine.critical_cosine).abs() < 2.0e-3,
        "coarse={coarse:?}, fine={fine:?}"
    );
    let nearest = coarse
        .curve
        .iter()
        .min_by(|left, right| {
            (left.0 - 1.516_312_9)
                .abs()
                .total_cmp(&(right.0 - 1.516_312_9).abs())
        })
        .expect("NS curve point");
    assert!(
        (nearest.0 - 1.516_312_9).abs() < 1.0e-3,
        "nearest k7={nearest:?}"
    );
    assert!(
        (nearest.1 - 0.832_006_64).abs() < 5.0e-4,
        "nearest k8={nearest:?}"
    );
}
