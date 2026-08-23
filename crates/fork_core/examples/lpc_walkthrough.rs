//! End-to-end walkthrough: from a compiled system to a continued LPC curve.
//!
//! This is the executable companion of "From Equilibrium to an LPC Curve" in
//! The Fork Book. It follows the same path as the published-reference tests:
//! settle an attracting orbit of the MLfast model, seed a collocated limit
//! cycle, continue it until the fold of cycles appears, then continue the LPC
//! curve in two parameters.
//!
//! Run with `cargo run --release -p fork_core --example lpc_walkthrough`.

use fork_core::continuation::{
    continue_limit_cycle_collocation, continue_with_problem, limit_cycle_setup_from_orbit,
    BifurcationType, ContinuationPoint, ContinuationSettings, LPCCurveProblem, OrbitTimeMode,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::solvers::RK4;
use fork_core::traits::Steppable;

// ANCHOR: system
/// The MLfast model (Kuznetsov), a two-dimensional slow-fast neuron model
/// whose parameters `y` and `z` we will continue in.
fn mlfast_system(y: f64, z: f64) -> EquationSystem {
    let variables = ["v", "w"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let parameters = ["y", "z"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let compiler = Compiler::new(&variables, &parameters);
    let equations = [
        "y-0.5*(v+0.5)-2*w*(v+0.7)-((1+tanh((v+0.01)/0.15))/2)*(v-1)",
        "1.15*(((1+tanh((v-z)/0.145))/2)-w)*cosh((v-0.1)/0.29)",
    ];
    let bytecode = equations
        .iter()
        .map(|eq| compiler.compile(&parse(eq).expect("equation parses")))
        .collect();
    let mut system = EquationSystem::new(bytecode, vec![y, z]);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}
// ANCHOR_END: system

// ANCHOR: orbit
/// Integrate to the attractor, then record one trajectory sample.
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
    let mut times = vec![time];
    let mut states = vec![state.clone()];
    for _ in 0..sample_steps {
        solver.step(system, &mut time, &mut state, dt);
        times.push(time);
        states.push(state.clone());
    }
    (times, states)
}
// ANCHOR_END: orbit

fn main() {
    // ANCHOR: seed
    let initial_y = 0.084;
    let z = 0.1;
    let system = mlfast_system(initial_y, z);
    let (times, states) = settled_orbit(&system, &[-0.1, 0.2], 0.005, 80_000, 16_000);

    // Resample the attracting orbit onto a Gauss collocation mesh and correct
    // it into a genuine periodic orbit.
    let setup = limit_cycle_setup_from_orbit(
        &times,
        &states,
        initial_y,
        20, // ntst: mesh intervals
        4,  // ncol: Gauss collocation degree
        0.01,
        OrbitTimeMode::Continuous,
    )
    .expect("orbit seeds a limit cycle");
    // ANCHOR_END: seed

    // ANCHOR: continue-lc
    let settings = ContinuationSettings {
        step_size: 2.0e-3,
        min_step_size: 1.0e-6,
        max_step_size: 3.0e-3,
        max_steps: 240,
        corrector_steps: 12,
        corrector_tolerance: 1.0e-9,
        step_tolerance: 1.0e-10,
    };
    let mut system = mlfast_system(initial_y, z);
    let config = setup.collocation_config();
    let branch = continue_limit_cycle_collocation(
        &mut system,
        0, // continue in parameter y
        config,
        setup.guess,
        settings,
        true,
    )
    .expect("limit cycle continuation");

    // The fold of cycles announces itself as a CycleFold point on the branch.
    let lpc = branch
        .points
        .iter()
        .find(|point| point.stability == BifurcationType::CycleFold)
        .expect("MLfast develops an LPC near y = 0.08456948")
        .clone();
    println!("LPC at y = {:.8}", lpc.param_value);
    // ANCHOR_END: continue-lc

    // ANCHOR: curve
    // Re-express the cycle in the curve problem's stage-first layout and build
    // the fold-of-cycles defining system in the (y, z) parameter plane.
    let (ntst, ncol) = (20usize, 4usize);
    let mesh_len = ntst * 2;
    let stage_len = ntst * ncol * 2;
    let mut coords = lpc.state[mesh_len..mesh_len + stage_len].to_vec();
    coords.extend_from_slice(&lpc.state[..mesh_len]);
    coords.extend_from_slice(&lpc.state[..2]);
    let period = lpc.state[mesh_len + stage_len];

    let mut curve_system = mlfast_system(lpc.param_value, z);
    let mut problem = LPCCurveProblem::new(
        &mut curve_system,
        coords.clone(),
        period,
        0, // p1 = y
        1, // p2 = z
        lpc.param_value,
        z,
        ntst,
        ncol,
    )
    .expect("LPC defining system");

    let mut state = coords;
    state.push(period);
    state.push(z);
    let seed = ContinuationPoint {
        state,
        param_value: lpc.param_value,
        stability: BifurcationType::CycleFold,
        eigenvalues: lpc.eigenvalues,
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };

    let curve = continue_with_problem(
        &mut problem,
        seed,
        ContinuationSettings {
            step_size: 2.0e-4,
            min_step_size: 1.0e-8,
            max_step_size: 5.0e-4,
            max_steps: 10,
            corrector_steps: 12,
            corrector_tolerance: 1.0e-8,
            step_tolerance: 1.0e-10,
        },
        true,
    )
    .expect("LPC curve continuation");

    // Every curve point still carries the fold: a multiplier at +1.
    let last = curve.points.last().unwrap();
    let fold = last
        .eigenvalues
        .iter()
        .map(|m| (m.re - 1.0).hypot(m.im))
        .fold(f64::INFINITY, f64::min);
    println!(
        "curve: {} points, last y = {:.8}, fold multiplier distance = {:.2e}",
        curve.points.len(),
        last.param_value,
        fold
    );
    assert!(fold < 2.0e-3, "curve must stay on the fold of cycles");
    // ANCHOR_END: curve
}
