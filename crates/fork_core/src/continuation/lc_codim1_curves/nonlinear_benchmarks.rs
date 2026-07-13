//! Nonlinear, multi-step reference benchmarks for limit-cycle bifurcation curves.
//!
//! The regular CI fixtures deliberately use normal forms with closed-form
//! periodic orbits and Floquet spectra.  That keeps the oracle independent of
//! shooting and lets these tests isolate the orthogonal-collocation curve
//! solvers.  The corresponding published-model validation targets are
//! documented in `docs/limit_cycle_continuation.md`.

use super::{
    scaled_collocation_defect, IsoperiodicCurveProblem, LPCCurveProblem, NSCurveProblem,
    PDCurveProblem,
};
use crate::continuation::periodic::{
    compute_limit_cycle_floquet_modes, correct_limit_cycle_setup, prepare_limit_cycle_setup,
    uniform_normalized_mesh, CollocationCoefficients,
};
use crate::continuation::{
    generalized_hopf_lpc_seed, refine_codim2_points, BifurcationType, Codim2BifurcationType,
    ContinuationPoint, ContinuationProblem, ContinuationRunner, ContinuationSettings,
    LimitCycleGuess, LimitCycleSetup,
};
use crate::equation_engine::{parse, Compiler, EquationSystem};
use nalgebra::DVector;
use num_complex::Complex;
use std::f64::consts::TAU;

const NTST: usize = 4;
const NCOL: usize = 3;
const CODIM2_NTST: usize = 4;
const TRANSVERSE_DIM: usize = 4;
const ACCEPTED_STEPS: usize = 8;

#[derive(Clone, Copy)]
enum ExplicitLayout {
    StageFirst,
    MeshFirst,
}

fn compiled_system(
    equations: &[&str],
    variables: &[&str],
    parameters: &[&str],
    values: Vec<f64>,
) -> EquationSystem {
    let variable_names = variables
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let parameter_names = parameters
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let compiler = Compiler::new(&variable_names, &parameter_names);
    let bytecode = equations
        .iter()
        .map(|equation| compiler.compile(&parse(equation).expect("parse benchmark equation")))
        .collect();
    let mut system = EquationSystem::new(bytecode, values);
    system.set_maps(compiler.param_map, compiler.var_map);
    system
}

fn bautin_system() -> EquationSystem {
    // Canonical generalized-Hopf/Bautin radial normal form.  For beta < 0,
    // the small-amplitude cycles born at Hopf are stable and meet the LPC
    // locus mu = beta^2/4, r^2 = -beta/2.
    compiled_system(
        &[
            "mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2",
            "x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2",
        ],
        &["x", "y"],
        &["mu", "beta"],
        vec![0.0, 0.0],
    )
}

fn pd_suspension_system(mu: f64, beta: f64) -> EquationSystem {
    // Nonlinear Stuart-Landau cycle plus a non-orientable transverse bundle.
    // In the half-angle rotating frame the transverse exponents are
    // a = mu-beta^2 and b = -0.2, hence the multipliers are
    // -exp(2*pi*a) and -exp(2*pi*b).  The simple PD locus is mu=beta^2.
    compiled_system(
        &[
            "-y+x*(1-x^2-y^2)",
            "x+y*(1-x^2-y^2)",
            "((mu-beta^2-0.2)/2+(mu-beta^2+0.2)*x/2)*u+((mu-beta^2+0.2)*y/2-0.5)*v",
            "((mu-beta^2+0.2)*y/2+0.5)*u+((mu-beta^2-0.2)/2-(mu-beta^2+0.2)*x/2)*v",
        ],
        &["x", "y", "u", "v"],
        &["mu", "beta"],
        vec![mu, beta],
    )
}

fn ns_suspension_system(mu: f64, beta: f64) -> EquationSystem {
    // Nonlinear Stuart-Landau cycle with a transverse complex pair
    // exp((a +/- i*omega)T), a=mu-beta^2 and omega=0.2+0.1*beta.
    // Thus the nonresonant NS locus is exactly mu=beta^2.
    compiled_system(
        &[
            "-y+x*(1-x^2-y^2)",
            "x+y*(1-x^2-y^2)",
            "(mu-beta^2)*u-(0.2+0.1*beta)*v-(u^2+v^2)*u",
            "(0.2+0.1*beta)*u+(mu-beta^2)*v-(u^2+v^2)*v",
        ],
        &["x", "y", "u", "v"],
        &["mu", "beta"],
        vec![mu, beta],
    )
}

fn isoperiodic_stuart_landau_system(mu: f64, beta: f64) -> EquationSystem {
    // Stable Stuart-Landau cycles with radius^2=1+0.2*mu and angular
    // frequency 1+mu+beta.  Holding the seed period fixed therefore gives the
    // exact isoperiodic locus mu+beta=0.
    compiled_system(
        &[
            "x*(1+0.2*mu-x^2-y^2)-(1+mu+beta)*y",
            "(1+mu+beta)*x+y*(1+0.2*mu-x^2-y^2)",
        ],
        &["x", "y"],
        &["mu", "beta"],
        vec![mu, beta],
    )
}

fn sampled_unit_cycle_setup(param_value: f64) -> LimitCycleSetup {
    sampled_cycle_setup(4, param_value)
}

fn sampled_cycle_setup(dim: usize, param_value: f64) -> LimitCycleSetup {
    sampled_cycle_setup_on_grid(dim, param_value, NTST, NCOL)
}

fn sampled_cycle_setup_on_grid(
    dim: usize,
    param_value: f64,
    ntst: usize,
    ncol: usize,
) -> LimitCycleSetup {
    assert!(dim >= 2);
    let coefficients = CollocationCoefficients::new(ncol).expect("collocation coefficients");
    let mesh_states = (0..ntst)
        .map(|mesh| {
            let angle = TAU * mesh as f64 / ntst as f64;
            let mut state = vec![0.0; dim];
            state[0] = angle.cos();
            state[1] = angle.sin();
            state
        })
        .collect::<Vec<_>>();
    let stage_states = (0..ntst)
        .map(|interval| {
            coefficients
                .nodes
                .iter()
                .map(|node| {
                    let angle = TAU * (interval as f64 + node) / ntst as f64;
                    let mut state = vec![0.0; dim];
                    state[0] = angle.cos();
                    state[1] = angle.sin();
                    state
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value,
            period: TAU,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: true,
        },
        phase_anchor: {
            let mut anchor = vec![0.0; dim];
            anchor[0] = 1.0;
            anchor
        },
        phase_direction: {
            let mut direction = vec![0.0; dim];
            direction[1] = 1.0;
            direction
        },
        mesh_points: ntst,
        collocation_degree: ncol,
        normalized_mesh: uniform_normalized_mesh(ntst),
    }
}

fn coefficient<'a>(event: &'a crate::continuation::RefinedCodim2Event, name: &str) -> &'a f64 {
    &event
        .data
        .coefficients
        .iter()
        .find(|coefficient| coefficient.name == name)
        .unwrap_or_else(|| panic!("missing {name} coefficient in {:?}", event.data))
        .value
}

fn sampled_planar_unit_cycle_setup(param_value: f64) -> LimitCycleSetup {
    let coefficients = CollocationCoefficients::new(NCOL).expect("collocation coefficients");
    let mesh_states = (0..NTST)
        .map(|mesh| {
            let angle = TAU * mesh as f64 / NTST as f64;
            vec![angle.cos(), angle.sin()]
        })
        .collect::<Vec<_>>();
    let stage_states = (0..NTST)
        .map(|interval| {
            coefficients
                .nodes
                .iter()
                .map(|node| {
                    let angle = TAU * (interval as f64 + node) / NTST as f64;
                    vec![angle.cos(), angle.sin()]
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value,
            period: TAU,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: true,
        },
        phase_anchor: vec![1.0, 0.0],
        phase_direction: vec![0.0, 1.0],
        mesh_points: NTST,
        collocation_degree: NCOL,
        normalized_mesh: uniform_normalized_mesh(NTST),
    }
}

fn corrected_unit_cycle_setup(dim: usize, param_value: f64, ntst: usize) -> LimitCycleSetup {
    assert!(dim >= 2);
    let mut base = compiled_system(
        &["-y+x*(1-x^2-y^2)+0*dummy", "x+y*(1-x^2-y^2)+0*dummy"],
        &["x", "y"],
        &["dummy"],
        vec![param_value],
    );
    let (mut corrected, _) = correct_limit_cycle_setup(
        &mut base,
        0,
        sampled_cycle_setup_on_grid(2, param_value, ntst, NCOL),
        1.0e-10,
        12,
    )
    .expect("correct the shared unit-cycle profile");
    let pad = |state: &mut Vec<f64>| state.resize(dim, 0.0);
    for state in &mut corrected.guess.mesh_states {
        pad(state);
    }
    for interval in &mut corrected.guess.stage_states {
        for state in interval {
            pad(state);
        }
    }
    pad(&mut corrected.phase_anchor);
    pad(&mut corrected.phase_direction);
    corrected
}

fn explicit_state(setup: &LimitCycleSetup, layout: ExplicitLayout) -> Vec<f64> {
    let mut mesh = setup
        .guess
        .mesh_states
        .iter()
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    mesh.extend_from_slice(&setup.guess.mesh_states[0]);
    let stages = setup
        .guess
        .stage_states
        .iter()
        .flatten()
        .flatten()
        .copied()
        .collect::<Vec<_>>();
    match layout {
        ExplicitLayout::StageFirst => stages.into_iter().chain(mesh).collect(),
        ExplicitLayout::MeshFirst => mesh.into_iter().chain(stages).collect(),
    }
}

fn initial_point(
    coords: &[f64],
    period: f64,
    param1: f64,
    param2: f64,
    stability: BifurcationType,
    auxiliary: Option<f64>,
) -> ContinuationPoint {
    let mut state = coords.to_vec();
    state.push(period);
    state.push(param2);
    if let Some(value) = auxiliary {
        state.push(value);
    }
    ContinuationPoint {
        state,
        param_value: param1,
        stability,
        eigenvalues: Vec::new(),
        cycle_points: None,
    }
}

fn settings() -> ContinuationSettings {
    ContinuationSettings {
        step_size: 2.0e-3,
        min_step_size: 1.0e-7,
        max_step_size: 5.0e-3,
        max_steps: ACCEPTED_STEPS,
        corrector_steps: 10,
        corrector_tolerance: 1.0e-8,
        step_tolerance: 1.0e-10,
    }
}

fn augmented(point: &ContinuationPoint) -> DVector<f64> {
    DVector::from_iterator(
        point.state.len() + 1,
        std::iter::once(point.param_value).chain(point.state.iter().copied()),
    )
}

fn assert_last_residual<P: ContinuationProblem>(problem: &mut P, point: &ContinuationPoint) {
    let aug = augmented(point);
    let mut residual = DVector::zeros(problem.dimension());
    problem
        .residual(&aug, &mut residual)
        .expect("evaluate final defining residual");
    let rms = residual.norm() / (problem.dimension() as f64).sqrt();
    assert!(rms < 2.0e-7, "final defining residual RMS={rms:.3e}");
    assert!(problem
        .is_step_acceptable(&aug)
        .expect("independent profile acceptance"));
}

fn decoded_profile(
    point: &ContinuationPoint,
    layout: ExplicitLayout,
    dim: usize,
) -> (Vec<Vec<f64>>, Vec<Vec<f64>>, f64, f64) {
    let stage_values = NTST * NCOL * dim;
    let mesh_values = (NTST + 1) * dim;
    let coordinate_values = stage_values + mesh_values;
    let (stage_flat, mesh_flat) = match layout {
        ExplicitLayout::StageFirst => (
            &point.state[..stage_values],
            &point.state[stage_values..coordinate_values],
        ),
        ExplicitLayout::MeshFirst => (
            &point.state[mesh_values..coordinate_values],
            &point.state[..mesh_values],
        ),
    };
    let stages = stage_flat
        .chunks_exact(dim)
        .map(|state| state.to_vec())
        .collect();
    let meshes = mesh_flat
        .chunks_exact(dim)
        .map(|state| state.to_vec())
        .collect();
    (
        meshes,
        stages,
        point.state[coordinate_values],
        point.state[coordinate_values + 1],
    )
}

fn assert_profile_defects(
    system: &mut EquationSystem,
    points: &[ContinuationPoint],
    layout: ExplicitLayout,
    dim: usize,
) {
    let coefficients = CollocationCoefficients::new(NCOL).expect("collocation coefficients");
    for point in points {
        let (meshes, stages, period, param2) = decoded_profile(point, layout, dim);
        let defect = scaled_collocation_defect(
            system,
            0,
            1,
            point.param_value,
            param2,
            &meshes,
            &stages,
            period,
            NTST,
            NCOL,
            &coefficients.nodes,
        )
        .expect("off-node collocation defect");
        assert!(defect < 1.0e-2, "off-node defect={defect:.3e}");
        assert!((period - TAU).abs() < 2.0e-3, "period={period:.12}");
    }
}

fn nearest_multiplier(multipliers: &[Complex<f64>], target: Complex<f64>) -> &Complex<f64> {
    multipliers
        .iter()
        .min_by(|left, right| {
            (**left - target)
                .norm()
                .total_cmp(&(**right - target).norm())
        })
        .expect("nonempty Floquet spectrum")
}

#[test]
fn bautin_lpc_curve_accepts_multiple_collocation_steps() {
    let mut system = bautin_system();
    let seed = generalized_hopf_lpc_seed(
        &mut system,
        &[0.0, 0.0],
        &[0.0, 0.0],
        0,
        1,
        0.0,
        0.0,
        0.0,
        -0.1,
        1.0,
        1.0,
        -0.2,
        4.0,
        0.1,
        NTST,
        NCOL,
        1.0e-8,
    )
    .expect("corrected Bautin LPC seed");
    assert!(seed.corrected_residual < 1.0e-7);
    let period = seed.period.expect("LPC seed period");
    let problem = LPCCurveProblem::new(
        &mut system,
        seed.state.clone(),
        period,
        0,
        1,
        seed.param1_value,
        seed.param2_value,
        NTST,
        NCOL,
    )
    .expect("LPC curve problem");
    let point = initial_point(
        &seed.state,
        period,
        seed.param1_value,
        seed.param2_value,
        BifurcationType::CycleFold,
        None,
    );
    let mut runner = ContinuationRunner::new(problem, point, settings(), true)
        .expect("initialize LPC continuation");
    runner
        .run_steps(ACCEPTED_STEPS)
        .expect("continue Bautin LPC curve");
    assert_eq!(runner.current_step(), ACCEPTED_STEPS);
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), ACCEPTED_STEPS + 1);
    assert_last_residual(&mut problem, branch.points.last().expect("last LPC point"));
    drop(problem);

    for point in &branch.points {
        let (_, _, _, beta) = decoded_profile(point, ExplicitLayout::StageFirst, 2);
        assert!(
            (point.param_value - 0.25 * beta * beta).abs() < 3.0e-4,
            "Bautin LPC locus mismatch: mu={}, beta={beta}",
            point.param_value
        );
        let near_one = point
            .eigenvalues
            .iter()
            .filter(|value| (**value - Complex::new(1.0, 0.0)).norm() < 3.0e-3)
            .count();
        assert!(near_one >= 2, "LPC multipliers={:?}", point.eigenvalues);
    }
    assert_profile_defects(&mut system, &branch.points, ExplicitLayout::StageFirst, 2);
}

#[test]
fn lpc_curve_refines_cpc_with_a_signed_coefficient_bracket() {
    let mut system = compiled_system(
        &["-y+x*(1-x^2-y^2)", "x+y*(1-x^2-y^2)", "p+q*z^2+z^3"],
        &["x", "y", "z"],
        &["p", "q"],
        vec![0.0, -0.05],
    );
    let corrected = corrected_unit_cycle_setup(3, 0.0, CODIM2_NTST);
    let coords = explicit_state(&corrected, ExplicitLayout::StageFirst);
    let period = corrected.guess.period;
    let mut problem = LPCCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        0.0,
        -0.05,
        CODIM2_NTST,
        NCOL,
    )
    .expect("LPC cusp problem");
    let endpoint =
        |beta| initial_point(&coords, period, 0.0, beta, BifurcationType::CycleFold, None);

    let events = refine_codim2_points(&mut problem, &[endpoint(-0.05), endpoint(0.05)], 12, 2.0e-4)
        .expect("refine CPC");
    let cpc = events
        .iter()
        .find(|event| event.data.bifurcation_type == Codim2BifurcationType::CuspOfCycles)
        .expect("CPC event");
    assert!(cpc.data.refined, "event={:?}", cpc.data);
    assert!(!cpc.data.candidate, "event={:?}", cpc.data);
    assert_eq!(cpc.data.certification.nondegenerate, Some(true));
    assert!(cpc.data.source_test_values[0] < 0.0);
    assert!(cpc.data.source_test_values[1] > 0.0);
    assert!(cpc.data.test_function_value.abs() < 2.0e-4);
    assert!(cpc.data.residual_norm < 2.0e-3);
    assert!(coefficient(cpc, "quadratic_coefficient").abs() < 2.0e-4);
    assert!(coefficient(cpc, "cubic_coefficient").abs() > 1.0);
}

#[test]
fn nonorientable_suspension_pd_curve_accepts_multiple_collocation_steps() {
    let beta = 0.25;
    let mu = beta * beta;
    let mut system = pd_suspension_system(mu, beta);
    let setup = sampled_unit_cycle_setup(mu);
    let (corrected, canonical_state) =
        correct_limit_cycle_setup(&mut system, 0, setup, 1.0e-10, 12)
            .expect("correct sampled PD cycle");
    let modes = compute_limit_cycle_floquet_modes(&mut system, 0, &canonical_state, NTST, NCOL)
        .expect("PD seed Floquet modes");
    let critical = modes
        .multipliers
        .iter()
        .min_by(|left, right| {
            (left.re + 1.0)
                .hypot(left.im)
                .total_cmp(&(right.re + 1.0).hypot(right.im))
        })
        .expect("PD seed spectrum");
    assert!((critical.re + 1.0).hypot(critical.im) < 3.0e-3);

    let coords = explicit_state(&corrected, ExplicitLayout::MeshFirst);
    let period = corrected.guess.period;
    let problem = PDCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        mu,
        beta,
        NTST,
        NCOL,
    )
    .expect("PD curve problem");
    let point = initial_point(
        &coords,
        period,
        mu,
        beta,
        BifurcationType::PeriodDoubling,
        None,
    );
    let mut runner = ContinuationRunner::new(problem, point, settings(), true)
        .expect("initialize PD continuation");
    runner.run_steps(ACCEPTED_STEPS).expect("continue PD curve");
    assert_eq!(runner.current_step(), ACCEPTED_STEPS);
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), ACCEPTED_STEPS + 1);
    assert_last_residual(&mut problem, branch.points.last().expect("last PD point"));
    drop(problem);

    for point in &branch.points {
        let (_, _, _, beta) = decoded_profile(point, ExplicitLayout::MeshFirst, TRANSVERSE_DIM);
        assert!(
            (point.param_value - beta * beta).abs() < 4.0e-4,
            "PD locus mismatch: mu={}, beta={beta}",
            point.param_value
        );
        let critical = nearest_multiplier(&point.eigenvalues, Complex::new(-1.0, 0.0));
        assert!(
            (*critical + Complex::new(1.0, 0.0)).norm() < 4.0e-3,
            "PD multipliers={:?}",
            point.eigenvalues
        );
    }
    assert_profile_defects(
        &mut system,
        &branch.points,
        ExplicitLayout::MeshFirst,
        TRANSVERSE_DIM,
    );
}

#[test]
fn pd_curve_refines_gpd_with_a_signed_cubic_bracket() {
    let mut system = compiled_system(
        &[
            "-y+x*(1-x^2-y^2)",
            "x+y*(1-x^2-y^2)",
            "((p-0.2)/2+(p+0.2)*x/2)*u+((p+0.2)*y/2-0.5)*v+q*((1+2*x+x^2)*u^3+3*y*(1+x)*u^2*v+3*y^2*u*v^2+y*(1-x)*v^3)/4",
            "((p+0.2)*y/2+0.5)*u+((p-0.2)/2-(p+0.2)*x/2)*v+q*(y*(1+x)*u^3+3*y^2*u^2*v+3*y*(1-x)*u*v^2+(1-2*x+x^2)*v^3)/4",
        ],
        &["x", "y", "u", "v"],
        &["p", "q"],
        vec![0.0, -0.05],
    );
    let corrected = corrected_unit_cycle_setup(4, 0.0, CODIM2_NTST);
    let coords = explicit_state(&corrected, ExplicitLayout::MeshFirst);
    let period = corrected.guess.period;
    let mut problem = PDCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        0.0,
        -0.05,
        CODIM2_NTST,
        NCOL,
    )
    .expect("PD interaction problem");
    let endpoint = |q| {
        initial_point(
            &coords,
            period,
            0.0,
            q,
            BifurcationType::PeriodDoubling,
            None,
        )
    };
    let events = refine_codim2_points(&mut problem, &[endpoint(-0.05), endpoint(0.05)], 12, 2.0e-4)
        .expect("refine GPD");
    let gpd = events
        .iter()
        .find(|event| {
            event.data.bifurcation_type == Codim2BifurcationType::GeneralizedPeriodDoubling
        })
        .expect("GPD event");
    assert!(gpd.data.refined, "event={:?}", gpd.data);
    assert!(!gpd.data.candidate, "event={:?}", gpd.data);
    assert!(gpd.data.certification.defining_conditions_verified);
    assert!(!gpd.data.certification.nondegeneracy_evaluated);
    assert_eq!(gpd.data.certification.nondegenerate, None);
    assert!(gpd
        .data
        .certification
        .reason
        .as_deref()
        .is_some_and(|reason| {
            reason.contains("BifurcationKit") && reason.contains("metadata-only")
        }));
    assert!(gpd.data.source_test_values[0] * gpd.data.source_test_values[1] < 0.0);
    assert!(gpd.data.test_function_value.abs() < 2.0e-4);
    assert!(gpd.data.residual_norm < 2.0e-3);
    assert!(coefficient(gpd, "cubic_coefficient").abs() < 2.0e-4);
}

#[test]
fn transverse_pair_ns_curve_accepts_multiple_collocation_steps() {
    let beta = 0.3;
    let mu = beta * beta;
    let mut system = ns_suspension_system(mu, beta);
    let setup = sampled_unit_cycle_setup(mu);
    let (corrected, canonical_state) =
        correct_limit_cycle_setup(&mut system, 0, setup, 1.0e-10, 12)
            .expect("correct sampled NS cycle");
    let modes = compute_limit_cycle_floquet_modes(&mut system, 0, &canonical_state, NTST, NCOL)
        .expect("NS seed Floquet modes");
    let critical = modes
        .multipliers
        .iter()
        .filter(|value| value.im > 0.05)
        .min_by(|left, right| {
            (left.re.hypot(left.im) - 1.0)
                .abs()
                .total_cmp(&(right.re.hypot(right.im) - 1.0).abs())
        })
        .expect("nonreal critical NS multiplier");
    assert!((critical.re.hypot(critical.im) - 1.0).abs() < 3.0e-3);
    let initial_k = critical.re;

    let coords = explicit_state(&corrected, ExplicitLayout::StageFirst);
    let period = corrected.guess.period;
    let problem = NSCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        mu,
        beta,
        initial_k,
        NTST,
        NCOL,
    )
    .expect("NS curve problem");
    let point = initial_point(
        &coords,
        period,
        mu,
        beta,
        BifurcationType::NeimarkSacker,
        Some(initial_k),
    );
    let mut runner = ContinuationRunner::new(problem, point, settings(), true)
        .expect("initialize NS continuation");
    runner.run_steps(ACCEPTED_STEPS).expect("continue NS curve");
    assert_eq!(runner.current_step(), ACCEPTED_STEPS);
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), ACCEPTED_STEPS + 1);
    assert_last_residual(&mut problem, branch.points.last().expect("last NS point"));
    drop(problem);

    let coordinate_values = NTST * NCOL * TRANSVERSE_DIM + (NTST + 1) * TRANSVERSE_DIM;
    for point in &branch.points {
        let (_, _, _, beta) = decoded_profile(point, ExplicitLayout::StageFirst, TRANSVERSE_DIM);
        assert!(
            (point.param_value - beta * beta).abs() < 4.0e-4,
            "NS locus mismatch: mu={}, beta={beta}",
            point.param_value
        );
        let k = point.state[coordinate_values + 2];
        let critical = point
            .eigenvalues
            .iter()
            .filter(|value| value.im > 0.05)
            .min_by(|left, right| {
                (left.norm() - 1.0)
                    .abs()
                    .total_cmp(&(right.norm() - 1.0).abs())
            })
            .expect("nonreal NS multiplier");
        assert!(
            (critical.norm() - 1.0).abs() < 4.0e-3,
            "NS multipliers={:?}",
            point.eigenvalues
        );
        assert!(
            (critical.re - k).abs() < 4.0e-3,
            "NS k={k}, multiplier={critical:?}"
        );
    }
    assert_profile_defects(
        &mut system,
        &branch.points,
        ExplicitLayout::StageFirst,
        TRANSVERSE_DIM,
    );
}

#[test]
#[ignore = "the full NS curve-corrected CH locator is a slow validation target; the bounded locator matrix and periodic NS normal-form tests run in regular CI"]
fn ns_curve_refines_chenciner_with_a_signed_cubic_bracket() {
    let mut system = compiled_system(
        &[
            "-y+x*(1-x^2-y^2)",
            "x+y*(1-x^2-y^2)",
            "p*u-(0.37/6.283185307179586)*v+q*(u^2+v^2)*u",
            "(0.37/6.283185307179586)*u+p*v+q*(u^2+v^2)*v",
        ],
        &["x", "y", "u", "v"],
        &["p", "q"],
        vec![0.0, -0.05],
    );
    let corrected = corrected_unit_cycle_setup(4, 0.0, CODIM2_NTST);
    let (_, canonical_state) =
        prepare_limit_cycle_setup(corrected.clone(), 4).expect("pack corrected NS profile");
    let modes =
        compute_limit_cycle_floquet_modes(&mut system, 0, &canonical_state, CODIM2_NTST, NCOL)
            .expect("CH seed Floquet modes");
    let defining_multiplier = modes
        .multipliers
        .iter()
        .filter(|value| value.im > 0.05)
        .min_by(|left, right| {
            (left.re.hypot(left.im) - 1.0)
                .abs()
                .total_cmp(&(right.re.hypot(right.im) - 1.0).abs())
        })
        .expect("CH defining multiplier");
    let defining_k = defining_multiplier.re / defining_multiplier.re.hypot(defining_multiplier.im);
    let coords = explicit_state(&corrected, ExplicitLayout::StageFirst);
    let period = corrected.guess.period;
    let mut problem = NSCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        0.0,
        -0.05,
        defining_k,
        CODIM2_NTST,
        NCOL,
    )
    .expect("NS interaction problem");
    let endpoint = |q: f64| {
        initial_point(
            &coords,
            period,
            0.0,
            q,
            BifurcationType::NeimarkSacker,
            Some(defining_k),
        )
    };
    let events = refine_codim2_points(&mut problem, &[endpoint(-0.05), endpoint(0.05)], 12, 3.0e-4)
        .expect("refine Chenciner point");
    let ch = events
        .iter()
        .find(|event| event.data.bifurcation_type == Codim2BifurcationType::Chenciner)
        .expect("Chenciner event");
    assert!(ch.data.refined, "event={:?}", ch.data);
    assert!(!ch.data.candidate, "event={:?}", ch.data);
    assert!(ch.data.certification.defining_conditions_verified);
    assert!(!ch.data.certification.nondegeneracy_evaluated);
    assert_eq!(ch.data.certification.nondegenerate, None);
    assert!(ch
        .data
        .certification
        .reason
        .as_deref()
        .is_some_and(|reason| {
            reason.contains("BifurcationKit") && reason.contains("metadata-only")
        }));
    assert!(ch.data.source_test_values[0] * ch.data.source_test_values[1] < 0.0);
    assert!(ch.data.test_function_value.abs() < 3.0e-4);
    assert!(ch.data.residual_norm < 3.0e-3);
    assert!(coefficient(ch, "first_lyapunov_coefficient").abs() < 3.0e-4);
}

#[test]
fn stable_stuart_landau_isoperiodic_curve_stays_phase_locked() {
    let mu = 0.0;
    let beta = 0.0;
    let mut system = isoperiodic_stuart_landau_system(mu, beta);
    let setup = sampled_planar_unit_cycle_setup(mu);
    let (corrected, _) = correct_limit_cycle_setup(&mut system, 0, setup, 1.0e-10, 12)
        .expect("correct sampled isoperiodic cycle");
    let coords = explicit_state(&corrected, ExplicitLayout::StageFirst);
    let period = corrected.guess.period;
    let problem = IsoperiodicCurveProblem::new(
        &mut system,
        coords.clone(),
        period,
        0,
        1,
        mu,
        beta,
        NTST,
        NCOL,
    )
    .expect("isoperiodic curve problem");
    let point = initial_point(&coords, period, mu, beta, BifurcationType::None, None);
    let mut runner = ContinuationRunner::new(problem, point, settings(), true)
        .expect("initialize isoperiodic continuation");
    runner
        .run_steps(ACCEPTED_STEPS)
        .expect("continue isoperiodic curve");
    assert_eq!(runner.current_step(), ACCEPTED_STEPS);
    let (branch, mut problem) = runner.take_result_with_problem();
    assert_eq!(branch.points.len(), ACCEPTED_STEPS + 1);
    assert_last_residual(
        &mut problem,
        branch.points.last().expect("last isoperiodic point"),
    );
    drop(problem);

    for point in &branch.points {
        let (_, _, point_period, beta) = decoded_profile(point, ExplicitLayout::StageFirst, 2);
        assert!(
            (point.param_value + beta).abs() < 2.0e-5,
            "isoperiodic locus mismatch: mu={}, beta={beta}",
            point.param_value
        );
        assert!((point_period - period).abs() < 2.0e-8);
        let trivial = nearest_multiplier(&point.eigenvalues, Complex::new(1.0, 0.0));
        assert!((*trivial - Complex::new(1.0, 0.0)).norm() < 3.0e-3);
        assert!(point.eigenvalues.iter().any(|value| value.norm() < 0.1));
    }
    assert_profile_defects(&mut system, &branch.points, ExplicitLayout::StageFirst, 2);
}
