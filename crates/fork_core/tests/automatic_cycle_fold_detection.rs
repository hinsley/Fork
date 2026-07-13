//! Regression coverage for automatic cycle-fold detection on an ordinary
//! one-parameter limit-cycle branch.
//!
//! The Bautin radial normal form has the closed-form cycle-fold locus
//! `mu = beta^2 / 4`.  At `beta = -1` the stable small cycle turns at
//! `mu = 0.25`, where its nontrivial Floquet multiplier crosses `+1`.

use fork_core::continuation::periodic::{uniform_normalized_mesh, CollocationCoefficients};
use fork_core::continuation::{
    continue_limit_cycle_collocation, BifurcationType, ContinuationSettings, LimitCycleGuess,
    LimitCycleSetup,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use num_complex::Complex;
use std::f64::consts::TAU;

const NTST: usize = 8;
const NCOL: usize = 3;

fn bautin_system(mu: f64, beta: f64) -> EquationSystem {
    let variables = vec!["x".to_string(), "y".to_string()];
    let parameters = vec!["mu".to_string(), "beta".to_string()];
    let compiler = Compiler::new(&variables, &parameters);
    let equations = [
        "mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2",
        "x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2",
    ]
    .iter()
    .map(|equation| compiler.compile(&parse(equation).expect("parse Bautin equation")))
    .collect();
    let mut system = EquationSystem::new(equations, vec![mu, beta]);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn exact_cycle_setup(mu: f64, beta: f64) -> LimitCycleSetup {
    let discriminant = beta * beta - 4.0 * mu;
    assert!(beta < 0.0 && discriminant > 0.0);
    let radius_squared = (-beta - discriminant.sqrt()) / 2.0;
    let radius = radius_squared.sqrt();
    let coefficients = CollocationCoefficients::new(NCOL).expect("collocation coefficients");

    let state_at = |phase: f64| vec![radius * phase.cos(), radius * phase.sin()];
    let mesh_states = (0..NTST)
        .map(|interval| state_at(TAU * interval as f64 / NTST as f64))
        .collect::<Vec<_>>();
    let stage_states = (0..NTST)
        .map(|interval| {
            coefficients
                .nodes
                .iter()
                .map(|node| state_at(TAU * (interval as f64 + node) / NTST as f64))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value: mu,
            period: TAU,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: true,
        },
        phase_anchor: vec![radius, 0.0],
        phase_direction: vec![0.0, 1.0],
        mesh_points: NTST,
        collocation_degree: NCOL,
        normalized_mesh: uniform_normalized_mesh(NTST),
    }
}

fn multiplier_distances(
    point: &fork_core::continuation::ContinuationPoint,
    target: Complex<f64>,
) -> Vec<f64> {
    let mut distances = point
        .eigenvalues
        .iter()
        .map(|value| (*value - target).norm())
        .collect::<Vec<_>>();
    distances.sort_by(f64::total_cmp);
    distances
}

#[test]
fn bautin_branch_automatically_detects_and_refines_cycle_fold() {
    let beta = -1.0;
    let initial_mu = 0.24;
    let setup = exact_cycle_setup(initial_mu, beta);
    let config = setup.collocation_config();
    let mut system = bautin_system(initial_mu, beta);
    let settings = ContinuationSettings {
        step_size: 0.05,
        min_step_size: 1.0e-6,
        max_step_size: 0.08,
        max_steps: 30,
        corrector_steps: 12,
        corrector_tolerance: 1.0e-9,
        step_tolerance: 1.0e-10,
    };

    let branch =
        continue_limit_cycle_collocation(&mut system, 0, config, setup.guess, settings, true)
            .expect("continue the Bautin cycle branch through its fold");

    let fold = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::CycleFold)
        .expect("automatic cycle-fold detection");
    assert!(
        (fold.param_value - 0.25).abs() < 2.0e-4,
        "detected mu={} instead of the exact cycle-fold value",
        fold.param_value
    );
    let plus_one_distances = multiplier_distances(fold, Complex::new(1.0, 0.0));
    assert!(
        plus_one_distances.len() >= 2 && plus_one_distances[1] < 2.0e-3,
        "cycle-fold point lacks a nontrivial +1 multiplier: {:?}",
        fold.eigenvalues
    );
}
