use super::normal_forms::{bogdanov_takens_normal_form, BogdanovTakensNormalForm};
use super::{FoldCurveProblem, HopfCurveProblem};
use crate::continuation::homoclinic::HomoclinicProblem;
use crate::continuation::homoclinic_init::{
    compute_homoclinic_basis, decode_homoclinic_state_with_basis, pack_homoclinic_state,
    HomoclinicExtraFlags, HomoclinicGuess, HomoclinicSetup,
};
use crate::continuation::periodic::{limit_cycle_setup_from_hopf, CollocationCoefficients};
use crate::continuation::{ContinuationProblem, LPCCurveProblem};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, compute_param_jacobian, SystemKind};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Codim2BranchTarget {
    Fold,
    Hopf,
    LimitPointCycle,
    Homoclinic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Codim2BranchSeed {
    pub target: Codim2BranchTarget,
    pub state: Vec<f64>,
    pub param1_value: f64,
    pub param2_value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auxiliary: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ntst: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ncol: Option<usize>,
    pub perturbation: f64,
    pub predictor_residual: f64,
    pub corrected_residual: f64,
    pub correction_iterations: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomoclinicBranchSeed {
    pub setup: HomoclinicSetup,
    pub perturbation: f64,
    pub predictor_residual: f64,
    pub corrected_residual: f64,
    pub correction_iterations: usize,
}

fn residual_norm<P: ContinuationProblem>(problem: &mut P, aug: &DVector<f64>) -> Result<f64> {
    let mut residual = DVector::zeros(problem.dimension());
    problem.residual(aug, &mut residual)?;
    Ok(residual.norm())
}

fn correct_to_curve<P: ContinuationProblem>(
    problem: &mut P,
    aug: &mut DVector<f64>,
    tolerance: f64,
    max_iterations: usize,
) -> Result<(f64, f64, usize)> {
    if aug.len() != problem.dimension() + 1 {
        bail!(
            "Predictor dimension mismatch: got {}, expected {}",
            aug.len(),
            problem.dimension() + 1
        );
    }
    let predictor_residual = residual_norm(problem, aug)?;
    let mut current_residual = predictor_residual;
    if current_residual <= tolerance {
        return Ok((predictor_residual, current_residual, 0));
    }

    for iteration in 0..max_iterations {
        let mut residual = DVector::zeros(problem.dimension());
        problem.residual(aug, &mut residual)?;
        current_residual = residual.norm();
        if current_residual <= tolerance {
            return Ok((predictor_residual, current_residual, iteration));
        }
        let jac = problem.extended_jacobian(aug)?;
        let mut gram = &jac * jac.transpose();
        let regularization = (1e-12 * (1.0 + gram.norm())).max(f64::EPSILON);
        for index in 0..gram.nrows() {
            gram[(index, index)] += regularization;
        }
        let multiplier = gram
            .lu()
            .solve(&(-residual))
            .ok_or_else(|| anyhow!("Predictor correction normal solve is singular"))?;
        let step = jac.transpose() * multiplier;
        if !step.iter().all(|value| value.is_finite()) {
            bail!("Predictor correction produced a non-finite step");
        }

        let mut scale = 1.0;
        let mut accepted = false;
        while scale >= 1.0 / 128.0 {
            let trial = aug.clone() + step.clone() * scale;
            let trial_residual = residual_norm(problem, &trial)?;
            if trial_residual.is_finite() && trial_residual < current_residual {
                *aug = trial;
                current_residual = trial_residual;
                accepted = true;
                break;
            }
            scale *= 0.5;
        }
        if !accepted {
            break;
        }
    }

    Ok((predictor_residual, current_residual, max_iterations))
}

fn flatten_limit_cycle_setup(setup: &crate::continuation::LimitCycleSetup) -> Vec<f64> {
    let mut coords = Vec::new();
    for interval in &setup.guess.stage_states {
        for stage in interval {
            coords.extend_from_slice(stage);
        }
    }
    for mesh in &setup.guess.mesh_states {
        coords.extend_from_slice(mesh);
    }
    if let Some(first) = setup.guess.mesh_states.first() {
        coords.extend_from_slice(first);
    }
    coords
}

#[allow(clippy::too_many_arguments)]
pub fn generalized_hopf_lpc_seed(
    system: &mut EquationSystem,
    gh_state: &[f64],
    neighbor_state: &[f64],
    param1_index: usize,
    param2_index: usize,
    gh_param1: f64,
    gh_param2: f64,
    neighbor_param1: f64,
    neighbor_param2: f64,
    gh_kappa: f64,
    neighbor_kappa: f64,
    neighbor_l1: f64,
    second_lyapunov: f64,
    amplitude: f64,
    ntst: usize,
    ncol: usize,
    tolerance: f64,
) -> Result<Codim2BranchSeed> {
    if gh_state.len() != neighbor_state.len() || gh_state.len() != system.equations.len() {
        bail!("Generalized-Hopf source point dimension mismatch");
    }
    if !neighbor_l1.is_finite() || neighbor_l1.abs() <= 1e-12 {
        bail!("Generalized-Hopf source neighbor must have a nonzero first coefficient");
    }
    if !second_lyapunov.is_finite() || second_lyapunov.abs() <= 1e-10 {
        bail!("Generalized-Hopf second coefficient is degenerate");
    }
    if !amplitude.is_finite() || amplitude <= 0.0 {
        bail!("Generalized-Hopf LPC amplitude must be positive");
    }

    let target_l1 = -2.0 * second_lyapunov * amplitude.powi(2);
    let scale = target_l1 / neighbor_l1;
    let predicted_param1 = gh_param1 + (neighbor_param1 - gh_param1) * scale;
    let predicted_param2 = gh_param2 + (neighbor_param2 - gh_param2) * scale;
    let predicted_kappa = gh_kappa + (neighbor_kappa - gh_kappa) * scale;
    if predicted_kappa <= 0.0 || !predicted_kappa.is_finite() {
        bail!("Generalized-Hopf LPC predictor produced a nonpositive frequency squared");
    }
    let predicted_state: Vec<f64> = gh_state
        .iter()
        .zip(neighbor_state.iter())
        .map(|(&gh, &neighbor)| gh + (neighbor - gh) * scale)
        .collect();

    let old_params = system.params.clone();
    system.params[param1_index] = predicted_param1;
    system.params[param2_index] = predicted_param2;
    let setup = limit_cycle_setup_from_hopf(
        system,
        param1_index,
        &predicted_state,
        predicted_param1,
        ntst,
        ncol,
        amplitude,
    )?;
    let coords = flatten_limit_cycle_setup(&setup);
    let period = setup.guess.period;
    let mut problem = LPCCurveProblem::new(
        system,
        coords.clone(),
        period,
        param1_index,
        param2_index,
        predicted_param1,
        predicted_param2,
        ntst,
        ncol,
    )?;
    let mut aug = DVector::from_iterator(
        coords.len() + 3,
        std::iter::once(predicted_param1)
            .chain(coords.iter().copied())
            .chain([period, predicted_param2]),
    );
    let correction = correct_to_curve(&mut problem, &mut aug, tolerance, 10);
    drop(problem);
    system.params = old_params;
    let (predictor_residual, corrected_residual, correction_iterations) = correction?;
    let corrected_coords = aug.rows(1, coords.len()).iter().copied().collect();
    let corrected_period = aug[1 + coords.len()];

    Ok(Codim2BranchSeed {
        target: Codim2BranchTarget::LimitPointCycle,
        state: corrected_coords,
        param1_value: aug[0],
        param2_value: aug[2 + coords.len()],
        auxiliary: Some(predicted_kappa),
        period: Some(corrected_period),
        ntst: Some(ntst),
        ncol: Some(ncol),
        perturbation: amplitude,
        predictor_residual,
        corrected_residual,
        correction_iterations,
    })
}

struct BogdanovTakensLocalData {
    normal_form: BogdanovTakensNormalForm,
    unfolding_inverse: DMatrix<f64>,
}

fn parameter_jacobian_derivative(
    system: &mut EquationSystem,
    state: &[f64],
    parameter_index: usize,
) -> Result<DMatrix<f64>> {
    let original = system.params[parameter_index];
    let step = f64::EPSILON.powf(1.0 / 3.0) * (1.0 + original.abs());
    system.params[parameter_index] = original + step;
    let plus = compute_jacobian(system, SystemKind::Flow, state)?;
    system.params[parameter_index] = original - step;
    let minus = compute_jacobian(system, SystemKind::Flow, state)?;
    system.params[parameter_index] = original;
    let n = state.len();
    Ok(
        (DMatrix::from_row_slice(n, n, &plus) - DMatrix::from_row_slice(n, n, &minus))
            / (2.0 * step),
    )
}

fn bogdanov_takens_local_data(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
) -> Result<BogdanovTakensLocalData> {
    system.params[param1_index] = param1_value;
    system.params[param2_index] = param2_value;
    let n = state.len();
    let jac_values = compute_jacobian(system, SystemKind::Flow, state)?;
    let jac = DMatrix::from_row_slice(n, n, &jac_values);
    let normal_form = bogdanov_takens_normal_form(system, SystemKind::Flow, state, &jac)?;
    if normal_form.quadratic_coefficient.abs() <= 1e-10
        || normal_form.mixed_coefficient.abs() <= 1e-10
    {
        bail!("Bogdanov-Takens normal form is degenerate");
    }

    let f_p1 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param1_index,
    )?);
    let f_p2 = DVector::from_vec(compute_param_jacobian(
        system,
        SystemKind::Flow,
        state,
        param2_index,
    )?);
    let a_p1 = parameter_jacobian_derivative(system, state, param1_index)?;
    let a_p2 = parameter_jacobian_derivative(system, state, param2_index)?;
    let mut unfolding = DMatrix::zeros(2, 2);
    unfolding[(0, 0)] = normal_form.p1.dot(&f_p1);
    unfolding[(0, 1)] = normal_form.p1.dot(&f_p2);
    unfolding[(1, 0)] = normal_form.p0.dot(&(&a_p1 * &normal_form.q0))
        + normal_form.p1.dot(&(&a_p1 * &normal_form.q1));
    unfolding[(1, 1)] = normal_form.p0.dot(&(&a_p2 * &normal_form.q0))
        + normal_form.p1.dot(&(&a_p2 * &normal_form.q1));
    let unfolding_inverse = unfolding
        .try_inverse()
        .ok_or_else(|| anyhow!("Bogdanov-Takens two-parameter unfolding is singular"))?;
    Ok(BogdanovTakensLocalData {
        normal_form,
        unfolding_inverse,
    })
}

fn parameter_offset(data: &BogdanovTakensLocalData, beta1: f64, beta2: f64) -> DVector<f64> {
    &data.unfolding_inverse * DVector::from_vec(vec![beta1, beta2])
}

#[allow(clippy::too_many_arguments)]
pub fn bogdanov_takens_curve_seeds(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_value: f64,
    param2_value: f64,
    perturbation: f64,
    tolerance: f64,
) -> Result<(Codim2BranchSeed, Codim2BranchSeed)> {
    if !perturbation.is_finite() || perturbation <= 0.0 {
        bail!("Bogdanov-Takens perturbation must be positive");
    }
    let old_params = system.params.clone();
    let data = bogdanov_takens_local_data(
        system,
        state,
        param1_index,
        param2_index,
        param1_value,
        param2_value,
    )?;
    let a = data.normal_form.quadratic_coefficient;
    let b = data.normal_form.mixed_coefficient;

    let fold_beta2 = perturbation;
    let fold_offset = parameter_offset(&data, 0.0, fold_beta2);
    let fold_p1 = param1_value + fold_offset[0];
    let fold_p2 = param2_value + fold_offset[1];
    system.params[param1_index] = fold_p1;
    system.params[param2_index] = fold_p2;
    let mut fold_problem =
        FoldCurveProblem::new(system, SystemKind::Flow, state, param1_index, param2_index)?;
    let mut fold_aug = DVector::from_iterator(
        state.len() + 2,
        [fold_p1, fold_p2].into_iter().chain(state.iter().copied()),
    );
    let (fold_predictor_residual, fold_corrected_residual, fold_iterations) =
        correct_to_curve(&mut fold_problem, &mut fold_aug, tolerance, 10)?;
    drop(fold_problem);

    let hopf_beta2 = perturbation.copysign(a / b);
    let hopf_beta1 = -a * hopf_beta2.powi(2) / b.powi(2);
    let hopf_offset = parameter_offset(&data, hopf_beta1, hopf_beta2);
    let hopf_p1 = param1_value + hopf_offset[0];
    let hopf_p2 = param2_value + hopf_offset[1];
    let center_x = -hopf_beta2 / b;
    let hopf_state = DVector::from_column_slice(state) + &data.normal_form.q0 * center_x;
    let kappa = 2.0 * a * hopf_beta2 / b;
    if !kappa.is_finite() || kappa <= 0.0 {
        bail!("Bogdanov-Takens Hopf predictor produced a nonpositive frequency squared");
    }
    system.params[param1_index] = hopf_p1;
    system.params[param2_index] = hopf_p2;
    let mut hopf_problem = HopfCurveProblem::new(
        system,
        SystemKind::Flow,
        hopf_state.as_slice(),
        kappa.sqrt(),
        param1_index,
        param2_index,
    )?;
    let mut hopf_aug = DVector::from_iterator(
        state.len() + 3,
        [hopf_p1, hopf_p2]
            .into_iter()
            .chain(hopf_state.iter().copied())
            .chain(std::iter::once(kappa)),
    );
    let (hopf_predictor_residual, hopf_corrected_residual, hopf_iterations) =
        correct_to_curve(&mut hopf_problem, &mut hopf_aug, tolerance, 10)?;
    drop(hopf_problem);
    system.params = old_params;

    let fold = Codim2BranchSeed {
        target: Codim2BranchTarget::Fold,
        state: fold_aug.rows(2, state.len()).iter().copied().collect(),
        param1_value: fold_aug[0],
        param2_value: fold_aug[1],
        auxiliary: None,
        period: None,
        ntst: None,
        ncol: None,
        perturbation,
        predictor_residual: fold_predictor_residual,
        corrected_residual: fold_corrected_residual,
        correction_iterations: fold_iterations,
    };
    let hopf = Codim2BranchSeed {
        target: Codim2BranchTarget::Hopf,
        state: hopf_aug.rows(2, state.len()).iter().copied().collect(),
        param1_value: hopf_aug[0],
        param2_value: hopf_aug[1],
        auxiliary: Some(hopf_aug[state.len() + 2]),
        period: None,
        ntst: None,
        ncol: None,
        perturbation,
        predictor_residual: hopf_predictor_residual,
        corrected_residual: hopf_corrected_residual,
        correction_iterations: hopf_iterations,
    };
    Ok((fold, hopf))
}

#[allow(clippy::too_many_arguments)]
pub fn bogdanov_takens_homoclinic_seed(
    system: &mut EquationSystem,
    state: &[f64],
    param1_index: usize,
    param2_index: usize,
    param1_name: &str,
    param2_name: &str,
    param1_value: f64,
    param2_value: f64,
    perturbation: f64,
    ntst: usize,
    ncol: usize,
    tolerance: f64,
) -> Result<HomoclinicBranchSeed> {
    if ntst < 2 || ncol == 0 {
        bail!("Bogdanov-Takens homoclinic mesh is invalid");
    }
    if !perturbation.is_finite() || perturbation <= 0.0 {
        bail!("Bogdanov-Takens perturbation must be positive");
    }
    let old_params = system.params.clone();
    let data = bogdanov_takens_local_data(
        system,
        state,
        param1_index,
        param2_index,
        param1_value,
        param2_value,
    )?;
    let a = data.normal_form.quadratic_coefficient;
    let b = data.normal_form.mixed_coefficient;
    let epsilon = (perturbation * a.abs() / 6.0).sqrt();
    let beta1 = -4.0 * epsilon.powi(4) / a;
    let beta2 = (10.0 * b / (7.0 * a)) * epsilon.powi(2);
    let offset = parameter_offset(&data, beta1, beta2);
    let predicted_p1 = param1_value + offset[0];
    let predicted_p2 = param2_value + offset[1];
    let mut base_params = old_params.clone();
    base_params[param1_index] = predicted_p1;
    base_params[param2_index] = predicted_p2;
    system.params.copy_from_slice(&base_params);

    let saddle =
        DVector::from_column_slice(state) + &data.normal_form.q0 * (2.0 * epsilon.powi(2) / a);
    let tail_ratio = 1e-3_f64;
    let s_limit = (1.0 / tail_ratio.sqrt()).acosh();
    let time = s_limit / epsilon;
    let orbit_state = |physical_time: f64| {
        let scaled = epsilon * physical_time;
        let sech_sq = 1.0 / scaled.cosh().powi(2);
        let w0 = epsilon.powi(2) * (2.0 - 6.0 * sech_sq) / a;
        let w1 = 12.0 * epsilon.powi(3) * sech_sq * scaled.tanh() / a;
        DVector::from_column_slice(state) + &data.normal_form.q0 * w0 + &data.normal_form.q1 * w1
    };
    let coeffs = CollocationCoefficients::new(ncol)?;
    let mesh_states: Vec<Vec<f64>> = (0..=ntst)
        .map(|index| {
            let t = -time + 2.0 * time * index as f64 / ntst as f64;
            orbit_state(t).iter().copied().collect()
        })
        .collect();
    let stage_states: Vec<Vec<Vec<f64>>> = (0..ntst)
        .map(|interval| {
            coeffs
                .nodes
                .iter()
                .map(|node| {
                    let t = -time + 2.0 * time * (interval as f64 + node) / ntst as f64;
                    orbit_state(t).iter().copied().collect()
                })
                .collect()
        })
        .collect();
    let endpoint_distance = |point: &[f64]| {
        point
            .iter()
            .zip(saddle.iter())
            .map(|(&left, &right)| (left - right).powi(2))
            .sum::<f64>()
            .sqrt()
    };
    let eps0 = endpoint_distance(&mesh_states[0]);
    let eps1 = endpoint_distance(mesh_states.last().expect("nonempty homoclinic mesh"));
    let basis = compute_homoclinic_basis(system, saddle.as_slice(), &base_params)?;
    let riccati_size = basis.nneg * basis.npos;
    let mut setup = HomoclinicSetup {
        guess: HomoclinicGuess {
            mesh_states,
            stage_states,
            x0: saddle.iter().copied().collect(),
            param1_value: predicted_p1,
            param2_value: predicted_p2,
            time,
            eps0,
            eps1,
            yu: vec![0.0; riccati_size],
            ys: vec![0.0; riccati_size],
        },
        ntst,
        ncol,
        param1_index,
        param2_index,
        param1_name: param1_name.to_string(),
        param2_name: param2_name.to_string(),
        base_params: base_params.clone(),
        extras: HomoclinicExtraFlags {
            free_time: true,
            free_eps0: false,
            free_eps1: false,
        },
        basis,
    };
    let packed = pack_homoclinic_state(&setup);
    let mut aug = DVector::from_iterator(
        packed.len() + 1,
        std::iter::once(predicted_p1).chain(packed.iter().copied()),
    );
    let mut problem = HomoclinicProblem::new(system, setup.clone())?;
    let correction = correct_to_curve(&mut problem, &mut aug, tolerance, 6);
    drop(problem);
    let (predictor_residual, corrected_residual, correction_iterations) = correction?;
    let decoded = decode_homoclinic_state_with_basis(
        &aug.as_slice()[1..],
        state.len(),
        ntst,
        ncol,
        setup.extras,
        setup.guess.time,
        setup.guess.eps0,
        setup.guess.eps1,
        (setup.basis.nneg, setup.basis.npos),
    )?;
    setup.guess.mesh_states = decoded.mesh_states;
    setup.guess.stage_states = decoded.stage_states;
    setup.guess.x0 = decoded.x0;
    setup.guess.param1_value = aug[0];
    setup.guess.param2_value = decoded.param2_value;
    setup.guess.time = decoded.time;
    setup.guess.eps0 = decoded.eps0;
    setup.guess.eps1 = decoded.eps1;
    setup.guess.yu = decoded.yu;
    setup.guess.ys = decoded.ys;
    system.params = old_params;

    Ok(HomoclinicBranchSeed {
        setup,
        perturbation,
        predictor_residual,
        corrected_residual,
        correction_iterations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{parse, Compiler};

    fn system(equations: &[&str], parameters: &[&str], values: Vec<f64>) -> EquationSystem {
        let variables = vec!["x".to_string(), "y".to_string()];
        let parameter_names: Vec<String> =
            parameters.iter().map(|name| (*name).to_string()).collect();
        let compiler = Compiler::new(&variables, &parameter_names);
        let bytecode = equations
            .iter()
            .map(|equation| compiler.compile(&parse(equation).expect("parse equation")))
            .collect();
        let mut system = EquationSystem::new(bytecode, values);
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    #[test]
    fn generalized_hopf_seed_lands_on_radial_lpc_locus() {
        let mut system = system(
            &[
                "mu*x-y+beta*x*(x^2+y^2)+x*(x^2+y^2)^2",
                "x+mu*y+beta*y*(x^2+y^2)+y*(x^2+y^2)^2",
            ],
            &["mu", "beta"],
            vec![0.0, 0.0],
        );
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
            8,
            2,
            1e-7,
        )
        .expect("generalized-Hopf LPC seed");

        assert_eq!(seed.target, Codim2BranchTarget::LimitPointCycle);
        // For r' = mu*r + beta*r^3 + r^5, the cycle-fold locus is
        // beta = -2*r^2 and mu = r^4.  Check the corrected cycle itself
        // instead of the normal-form predictor, which need not already lie on
        // the nonlinear collocation curve.
        let first_mesh = 8 * 2 * 2;
        let radius_squared = seed.state[first_mesh].powi(2) + seed.state[first_mesh + 1].powi(2);
        assert!(
            (seed.param2_value + 2.0 * radius_squared).abs() < 5e-4,
            "seed={seed:?}"
        );
        assert!(
            (seed.param1_value - radius_squared.powi(2)).abs() < 2e-4,
            "seed={seed:?}"
        );
        assert!(seed.corrected_residual < 1e-5, "seed={seed:?}");
        assert!(
            seed.corrected_residual <= seed.predictor_residual,
            "seed={seed:?}"
        );
    }

    #[test]
    fn bogdanov_takens_curve_predictors_match_canonical_unfolding() {
        let mut system = system(&["y", "mu1+mu2*y+x^2+x*y"], &["mu1", "mu2"], vec![0.0, 0.0]);
        let (fold, hopf) =
            bogdanov_takens_curve_seeds(&mut system, &[0.0, 0.0], 0, 1, 0.0, 0.0, 0.05, 1e-9)
                .expect("Bogdanov-Takens curve seeds");

        assert_eq!(fold.target, Codim2BranchTarget::Fold);
        assert!(fold.param1_value.abs() < 1e-7, "fold={fold:?}");
        assert!(fold.param2_value > 0.0, "fold={fold:?}");
        assert!(fold.corrected_residual < 1e-7, "fold={fold:?}");
        assert_eq!(hopf.target, Codim2BranchTarget::Hopf);
        assert!(hopf.param1_value < 0.0, "hopf={hopf:?}");
        assert!(hopf.param2_value > 0.0, "hopf={hopf:?}");
        assert!(hopf.auxiliary.is_some_and(|kappa| kappa > 0.0));
        assert!(hopf.corrected_residual < 1e-7, "hopf={hopf:?}");
    }

    #[test]
    fn bogdanov_takens_homoclinic_predictor_builds_open_orbit_setup() {
        let mut system = system(&["y", "mu1+mu2*y+x^2+x*y"], &["mu1", "mu2"], vec![0.0, 0.0]);
        let seed = bogdanov_takens_homoclinic_seed(
            &mut system,
            &[0.0, 0.0],
            0,
            1,
            "mu1",
            "mu2",
            0.0,
            0.0,
            0.05,
            8,
            2,
            1e-6,
        )
        .expect("Bogdanov-Takens homoclinic seed");

        assert_eq!(seed.setup.guess.mesh_states.len(), 9);
        assert_eq!(seed.setup.guess.stage_states.len(), 8);
        assert!(seed.setup.guess.time > 0.0);
        assert!(seed.setup.guess.eps0 > 0.0);
        assert!(seed.setup.guess.eps1 > 0.0);
        assert!(seed.corrected_residual.is_finite());
        assert!(seed.corrected_residual < 1e-6, "seed residuals: {seed:?}");
        assert!(
            seed.corrected_residual <= seed.predictor_residual,
            "seed residuals: {seed:?}"
        );
    }
}
