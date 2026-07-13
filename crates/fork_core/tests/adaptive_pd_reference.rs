//! End-to-end published-model benchmark for Orbit-seeded period doubling.
//!
//! The adaptive-control system and reference values are MATCONT manual
//! equations (57)/(72):
//!
//! ```text
//! x' = y
//! y' = z
//! z' = -alpha*z - beta*y - x + x^2
//! ```
//!
//! At `beta = 1`, MATCONT reports the first period doubling at
//! `alpha = 0.6303020`, `T = 6.364071`.  The test deliberately begins with a
//! numerically integrated stable Orbit at `alpha = 0.8`, passes it through
//! Fork's Orbit-to-orthogonal-collocation setup, continues the limit cycles to
//! the published PD point, and then accepts two steps of the two-parameter PD
//! curve.  The modest 8-by-3 grid keeps this suitable for regular CI while the
//! published values remain resolved to better than 5e-5.

use fork_core::continuation::{
    continue_limit_cycle_collocation, continue_with_problem, limit_cycle_setup_from_orbit,
    BifurcationType, ContinuationPoint, ContinuationSettings, OrbitTimeMode, PDCurveProblem,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::solvers::RK4;
use fork_core::traits::Steppable;
use num_complex::Complex;

const NTST: usize = 8;
const NCOL: usize = 3;

fn adaptive_control_system(alpha: f64, beta: f64) -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string(), "z".to_string()];
    let parameters = vec!["alpha".to_string(), "beta".to_string()];
    let compiler = Compiler::new(&variables, &parameters);
    let equations = ["y", "z", "-alpha*z-beta*y-x+x^2"]
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse equation")))
        .collect();
    let mut system = EquationSystem::new(equations, vec![alpha, beta]);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn settled_stable_orbit(system: &EquationSystem) -> (Vec<f64>, Vec<Vec<f64>>) {
    let dt = 0.01;
    let mut solver = RK4::new(3);
    let mut time = 0.0;
    let mut state = vec![0.1, 0.0, 0.0];

    for _ in 0..20_000 {
        solver.step(system, &mut time, &mut state, dt);
    }

    let mut times = Vec::with_capacity(8_001);
    let mut states = Vec::with_capacity(8_001);
    times.push(time);
    states.push(state.clone());
    for _ in 0..8_000 {
        solver.step(system, &mut time, &mut state, dt);
        times.push(time);
        states.push(state.clone());
    }
    (times, states)
}

fn pd_explicit_state(implicit: &[f64]) -> (Vec<f64>, f64) {
    let dim = 3;
    let mesh_len = NTST * dim;
    let stage_len = NTST * NCOL * dim;
    assert_eq!(implicit.len(), mesh_len + stage_len + 1);

    // Periodic LC continuation stores [mesh_0..mesh_(ntst-1), stages, T].
    // The PD defining system uses [mesh_0..mesh_ntst, stages] and therefore
    // needs the explicitly duplicated periodic endpoint.
    let mut explicit = implicit[..mesh_len].to_vec();
    explicit.extend_from_slice(&implicit[..dim]);
    explicit.extend_from_slice(&implicit[mesh_len..mesh_len + stage_len]);
    (explicit, implicit[mesh_len + stage_len])
}

fn distance_to_multiplier(point: &ContinuationPoint, target: Complex<f64>) -> f64 {
    point
        .eigenvalues
        .iter()
        .map(|value| (*value - target).norm())
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn stable_orbit_reaches_matcont_pd_and_continues_the_pd_curve() {
    let mut system = adaptive_control_system(0.8, 1.0);
    let (orbit_times, orbit_states) = settled_stable_orbit(&system);
    let setup = limit_cycle_setup_from_orbit(
        &orbit_times,
        &orbit_states,
        0.8,
        NTST,
        NCOL,
        0.02,
        OrbitTimeMode::Continuous,
    )
    .expect("stable Orbit seed");
    assert!((setup.guess.period - 6.33).abs() < 0.02);

    let config = setup.collocation_config();
    let lc_settings = ContinuationSettings {
        step_size: 0.02,
        min_step_size: 1.0e-5,
        max_step_size: 0.035,
        max_steps: 12,
        corrector_steps: 10,
        corrector_tolerance: 1.0e-9,
        step_tolerance: 1.0e-10,
    };
    let branch =
        continue_limit_cycle_collocation(&mut system, 0, config, setup.guess, lc_settings, false)
            .expect("Orbit-seeded orthogonal-collocation continuation");

    let initial = branch.points.first().expect("corrected initial cycle");
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
        "the alpha=0.8 Orbit must be stable"
    );
    assert!(
        branch
            .points
            .iter()
            .all(|point| point.stability != BifurcationType::NeimarkSacker),
        "a stable real-to-complex Floquet transition must not be labeled NS"
    );

    let pd = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::PeriodDoubling)
        .expect("detected first period doubling")
        .clone();
    let period = *pd.state.last().expect("cycle period");
    assert!(
        (pd.param_value - 0.630_302_0).abs() < 5.0e-5,
        "alpha={} differs from MATCONT",
        pd.param_value
    );
    assert!(
        (period - 6.364_071).abs() < 5.0e-5,
        "period={period} differs from MATCONT"
    );
    assert!(
        distance_to_multiplier(&pd, Complex::new(-1.0, 0.0)) < 1.0e-5,
        "PD point lacks a multiplier at -1"
    );

    let (lc_state, period) = pd_explicit_state(&pd.state);
    let mut problem = PDCurveProblem::new(
        &mut system,
        lc_state.clone(),
        period,
        0,
        1,
        pd.param_value,
        1.0,
        NTST,
        NCOL,
    )
    .expect("PD curve defining system");
    let mut state = lc_state;
    state.push(period);
    state.push(1.0);
    let seed = ContinuationPoint {
        state,
        param_value: pd.param_value,
        stability: BifurcationType::PeriodDoubling,
        eigenvalues: pd.eigenvalues,
        cycle_points: None,
    };
    let pd_settings = ContinuationSettings {
        step_size: 1.0e-3,
        min_step_size: 1.0e-7,
        max_step_size: 2.0e-3,
        max_steps: 2,
        corrector_steps: 10,
        corrector_tolerance: 1.0e-8,
        step_tolerance: 1.0e-10,
    };
    let curve = continue_with_problem(&mut problem, seed, pd_settings, true)
        .expect("two-parameter PD curve continuation");
    assert_eq!(curve.points.len(), 3, "seed plus two accepted PD steps");
    assert!((curve.points[2].param_value - curve.points[0].param_value).abs() > 1.0e-4);
    assert!(
        (curve.points[2].state.last().expect("beta") - curve.points[0].state.last().expect("beta"))
            .abs()
            > 1.0e-4
    );
    for point in &curve.points {
        assert!(
            distance_to_multiplier(point, Complex::new(-1.0, 0.0)) < 1.0e-5,
            "PD curve point ({}, {}) lacks a multiplier at -1",
            point.param_value,
            point.state.last().expect("beta")
        );
    }
}
