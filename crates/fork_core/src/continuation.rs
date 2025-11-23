pub mod problem;
pub mod equilibrium;
pub mod periodic;

pub use equilibrium::{compute_eigenvalues_for_state, continue_parameter, extend_branch};
pub use periodic::{
    continue_limit_cycle_collocation, extend_limit_cycle_collocation, limit_cycle_setup_from_hopf,
    CollocationConfig, LimitCycleGuess, LimitCycleSetup,
};

use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector, SymmetricEigen};
use problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ContinuationSettings {
    pub step_size: f64,
    pub min_step_size: f64,
    pub max_step_size: f64,
    pub max_steps: usize,
    pub corrector_steps: usize,
    pub corrector_tolerance: f64,
    pub step_tolerance: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum BifurcationType {
    None,
    Fold,
    Hopf,
    NeutralSaddle,
    CycleFold,
    PeriodDoubling,
    NeimarkSacker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationPoint {
    pub state: Vec<f64>,
    pub param_value: f64,
    pub stability: BifurcationType,
    #[serde(default)]
    pub eigenvalues: Vec<Complex<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationBranch {
    pub points: Vec<ContinuationPoint>,
    pub bifurcations: Vec<usize>, // Indices of points where bifurcation was detected
    pub indices: Vec<i32>,        // Explicit indices relative to start point (0)
}

pub(crate) fn extend_branch_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    mut branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = problem.dimension();
    if branch.points.is_empty() {
        bail!("Cannot extend empty branch");
    }

    if branch.indices.len() != branch.points.len() {
        branch.indices = (0..branch.points.len() as i32).collect();
    }

    let (endpoint_idx, last_index, is_append) = if forward {
        let max_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .max_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        (max_idx_pos, branch.indices[max_idx_pos], true)
    } else {
        let min_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        (min_idx_pos, branch.indices[min_idx_pos], false)
    };
    let mut prev_point = branch.points[endpoint_idx].clone();

    let mut prev_aug = continuation_point_to_aug(&prev_point);
    let mut prev_tangent = tangent_for_point(problem, &prev_point)?;
    let mut prev_diag = diagnostics_from_point(problem, &prev_point)?;

    let mut step_size = settings.step_size;
    let direction_sign = if is_append { 1.0 } else { -1.0 };

    let mut new_points_data: Vec<(ContinuationPoint, i32)> = Vec::new();

    let mut current_index = last_index;

    for _step in 0..settings.max_steps {
        // Predictor
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector (PALC only)
        let corrected_opt = solve_palc(problem, &pred_aug, &prev_aug, &prev_tangent, settings)?;

        if let Some((corrected_aug, new_tangent)) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite())
                || !new_tangent.iter().all(|v| v.is_finite())
            {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }

            // Converged
            let mut diagnostics = problem.diagnostics(&corrected_aug)?;

            if !diagnostics.test_values.is_finite() {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }

            let mut new_pt = ContinuationPoint {
                state: corrected_aug.rows(1, dim).iter().cloned().collect(),
                param_value: corrected_aug[0],
                stability: BifurcationType::None,
                eigenvalues: diagnostics.eigenvalues.clone(),
            };

            let prev_tests = prev_diag.test_values;
            let fold_crossed = prev_tests.fold * diagnostics.test_values.fold < 0.0;
            let hopf_crossed = prev_tests.hopf * diagnostics.test_values.hopf < 0.0;
            let neutral_crossed =
                prev_tests.neutral_saddle * diagnostics.test_values.neutral_saddle < 0.0;
            let cycle_fold_crossed =
                prev_tests.cycle_fold * diagnostics.test_values.cycle_fold < 0.0;
            let period_doubling_crossed =
                prev_tests.period_doubling * diagnostics.test_values.period_doubling < 0.0;
            let neimark_crossed =
                prev_tests.neimark_sacker * diagnostics.test_values.neimark_sacker < 0.0;

            let mut current_tangent = new_tangent.clone();

            if fold_crossed {
                match refine_fold_point(problem, settings, &prev_point, &prev_tests, &new_pt, &diagnostics.test_values, &prev_tangent) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        #[cfg(test)]
                        {
                            println!("Fold refinement failed: {:?}", _err);
                        }
                        new_pt.stability = BifurcationType::Fold;
                    }
                }
                new_pt.stability = BifurcationType::Fold;
            } else if hopf_crossed && !neutral_crossed {
                match refine_hopf_point(problem, settings, &prev_point, &prev_tests, &new_pt, &diagnostics.test_values, &prev_tangent) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        #[cfg(test)]
                        {
                            println!("Hopf refinement failed: {:?}", _err);
                        }
                        new_pt.stability = BifurcationType::Hopf;
                    }
                }
                new_pt.stability = BifurcationType::Hopf;
            } else if neutral_crossed {
                new_pt.stability = BifurcationType::NeutralSaddle;
            } else if cycle_fold_crossed {
                new_pt.stability = BifurcationType::CycleFold;
            } else if period_doubling_crossed {
                new_pt.stability = BifurcationType::PeriodDoubling;
            } else if neimark_crossed {
                new_pt.stability = BifurcationType::NeimarkSacker;
            }

            current_index += if is_append { 1 } else { -1 };
            prev_aug = continuation_point_to_aug(&new_pt);
            prev_tangent = current_tangent.clone();
            prev_diag = diagnostics;
            prev_point = new_pt.clone();
            new_points_data.push((new_pt, current_index));
        } else {
            step_size *= 0.5;
            if step_size < settings.min_step_size {
                break;
            }
            continue;
        }
    }

    if is_append {
        for (pt, idx) in new_points_data {
            if pt.stability != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }
            branch.points.push(pt);
            branch.indices.push(idx);
        }
    } else {
        let shift = new_points_data.len();
        for bif_idx in &mut branch.bifurcations {
            *bif_idx += shift;
        }

        for (pt, idx) in new_points_data.into_iter().rev() {
            branch.points.insert(0, pt);
            branch.indices.insert(0, idx);
        }

        branch.bifurcations.clear();
        for i in 1..branch.points.len() {
            if branch.points[i].stability != BifurcationType::None {
                branch.bifurcations.push(i);
            }
        }
    }

    Ok(branch)
}

pub(crate) fn continue_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    mut initial_point: ContinuationPoint,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = problem.dimension();
    if initial_point.state.len() != dim {
        bail!("Initial state dimension mismatch");
    }

    let current_aug = continuation_point_to_aug(&initial_point);
    let initial_diag = problem.diagnostics(&current_aug)?;
    initial_point.eigenvalues = initial_diag.eigenvalues;
    initial_point.stability = BifurcationType::None;

    let branch = ContinuationBranch {
        points: vec![initial_point],
        bifurcations: Vec::new(),
        indices: vec![0],
    };

    extend_branch_with_problem(problem, branch, settings, forward)
}

fn tangent_for_point<P: ContinuationProblem>(
    problem: &mut P,
    point: &ContinuationPoint,
) -> Result<DVector<f64>> {
    let aug = continuation_point_to_aug(point);
    let j_ext = problem.extended_jacobian(&aug)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent[0] < 0.0 {
        tangent = -tangent;
    }
    Ok(tangent)
}

fn diagnostics_from_point(
    problem: &mut impl ContinuationProblem,
    point: &ContinuationPoint,
) -> Result<PointDiagnostics> {
    let aug = continuation_point_to_aug(point);
    problem.diagnostics(&aug)
}

fn compute_nullspace_tangent(j_ext: &DMatrix<f64>) -> Result<DVector<f64>> {
    if let Some(vec) = try_gram_eigen(j_ext) {
        return Ok(vec);
    }
    compute_tangent_linear_solve(j_ext)
}

fn try_gram_eigen(j_ext: &DMatrix<f64>) -> Option<DVector<f64>> {
    if j_ext.ncols() == 0 {
        return None;
    }

    let gram = j_ext.transpose() * j_ext;
    if gram.iter().any(|v| !v.is_finite()) {
        return None;
    }

    let identity = DMatrix::identity(gram.nrows(), gram.ncols());
    let mut epsilon = 0.0;

    for _ in 0..5 {
        let adjusted = if epsilon == 0.0 {
            gram.clone()
        } else {
            &gram + identity.scale(epsilon)
        };

        let eig = SymmetricEigen::new(adjusted.clone());
        if eig.eigenvalues.is_empty() {
            return None;
        }

        let mut min_idx = 0;
        let mut min_val = eig.eigenvalues[0];
        for (i, &val) in eig.eigenvalues.iter().enumerate().skip(1) {
            if !val.is_finite() {
                continue;
            }
            if val < min_val {
                min_val = val;
                min_idx = i;
            }
        }

        if !min_val.is_finite() {
            epsilon = if epsilon == 0.0 {
                1e-12
            } else {
                epsilon * 10.0
            };
            continue;
        }

        let vec = eig.eigenvectors.column(min_idx).into_owned();
        if vec.norm_squared() == 0.0 || vec.iter().any(|v| !v.is_finite()) {
            return None;
        }
        return Some(vec);
    }

    None
}

fn compute_tangent_linear_solve(j_ext: &DMatrix<f64>) -> Result<DVector<f64>> {
    let dim = j_ext.nrows();
    if dim == 0 {
        bail!("Failed to compute tangent: zero-dimensional system");
    }

    let mut a = DMatrix::zeros(dim + 1, dim + 1);
    a.view_mut((0, 0), (dim, dim + 1)).copy_from(j_ext);
    let mut rhs = DVector::zeros(dim + 1);
    rhs[dim] = 1.0;

    for col in 0..=dim {
        for j in 0..=dim {
            a[(dim, j)] = 0.0;
        }
        a[(dim, col)] = 1.0;

        if let Some(solution) = a.clone().lu().solve(&rhs) {
            if solution.iter().all(|v| v.is_finite()) && solution.norm_squared() != 0.0 {
                return Ok(solution);
            }
        }
    }

    bail!("Failed to compute tangent: all bordered solves singular")
}

fn continuation_point_to_aug(point: &ContinuationPoint) -> DVector<f64> {
    let mut aug = DVector::zeros(point.state.len() + 1);
    aug[0] = point.param_value;
    for (i, &val) in point.state.iter().enumerate() {
        aug[i + 1] = val;
    }
    aug
}

fn refine_fold_point<P: ContinuationProblem>(
    problem: &mut P,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = problem.dimension();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_fold_newton(
        problem,
        &prev_aug,
        prev_tests.fold,
        &new_aug,
        new_tests.fold,
        settings,
    )?;

    let diagnostics = problem.diagnostics(&refined_aug)?;
    let j_ext = problem.extended_jacobian(&refined_aug)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Fold,
        eigenvalues: diagnostics.eigenvalues.clone(),
    };

    Ok((point, diagnostics, tangent))
}

fn refine_hopf_point<P: ContinuationProblem>(
    problem: &mut P,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = problem.dimension();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_hopf_newton(
        problem,
        &prev_aug,
        prev_tests.hopf,
        &new_aug,
        new_tests.hopf,
        settings,
    )?;

    let diagnostics = problem.diagnostics(&refined_aug)?;
    let j_ext = problem.extended_jacobian(&refined_aug)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Hopf,
        eigenvalues: diagnostics.eigenvalues.clone(),
    };

    Ok((point, diagnostics, tangent))
}

fn solve_fold_newton<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    prev_fold: f64,
    new_aug: &DVector<f64>,
    new_fold: f64,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = problem.dimension();
    let mut current = prev_aug.clone();
    let denom = prev_fold - new_fold;
    if denom.abs() > 1e-12 {
        let mut s = prev_fold / denom;
        if !s.is_finite() {
            s = 0.5;
        }
        s = s.clamp(0.0, 1.0);
        current = prev_aug + (new_aug - prev_aug) * s;
    }

    for _ in 0..settings.corrector_steps {
        let j_ext = problem.extended_jacobian(&current)?;
        let mut f_val = DVector::zeros(dim);
        problem.residual(&current, &mut f_val)?;

        let diag = problem.diagnostics(&current)?;
        let test_val = diag.test_values.fold;
        let f_norm = f_val.norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            return Ok(current);
        }

        let grad = compute_test_gradient(problem, &current, &|vals| vals.fold)?;

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = grad[i];
        }

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -test_val;

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Fold refinement linear solve failed"))?;
        current += &delta;

        if delta.norm() < settings.step_tolerance {
            return Ok(current);
        }
    }

    Err(anyhow!("Fold refinement did not converge"))
}

fn solve_hopf_newton<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    prev_hopf: f64,
    new_aug: &DVector<f64>,
    new_hopf: f64,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = problem.dimension();
    let mut current = prev_aug.clone();
    let denom = prev_hopf - new_hopf;
    if denom.abs() > 1e-12 {
        let mut s = prev_hopf / denom;
        if !s.is_finite() {
            s = 0.5;
        }
        s = s.clamp(0.0, 1.0);
        current = prev_aug + (new_aug - prev_aug) * s;
    }

    for _ in 0..settings.corrector_steps {
        let j_ext = problem.extended_jacobian(&current)?;
        let mut f_val = DVector::zeros(dim);
        problem.residual(&current, &mut f_val)?;

        let diag = problem.diagnostics(&current)?;
        let test_val = diag.test_values.hopf;
        let f_norm = f_val.norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            return Ok(current);
        }

        let grad = compute_test_gradient(problem, &current, &|vals| vals.hopf)?;

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = grad[i];
        }

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -test_val;

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Hopf refinement linear solve failed"))?;
        current += &delta;

        if delta.norm() < settings.step_tolerance {
            return Ok(current);
        }
    }

    Err(anyhow!("Hopf refinement did not converge"))
}

fn compute_test_gradient(
    problem: &mut impl ContinuationProblem,
    aug_state: &DVector<f64>,
    selector: &dyn Fn(&TestFunctionValues) -> f64,
) -> Result<DVector<f64>> {
    let dim = problem.dimension();
    let mut grad = DVector::zeros(dim + 1);
    let base_eps = 1e-6;

    for i in 0..dim + 1 {
        let mut perturbed = aug_state.clone();
        let step = base_eps * (1.0 + aug_state[i].abs());
        perturbed[i] += step;
        let plus_diag = problem.diagnostics(&perturbed)?;
        let plus = selector(&plus_diag.test_values);
        perturbed[i] -= 2.0 * step;
        let minus_diag = problem.diagnostics(&perturbed)?;
        let minus = selector(&minus_diag.test_values);
        grad[i] = (plus - minus) / (2.0 * step);
    }

    Ok(grad)
}

fn solve_palc<P: ContinuationProblem>(
    problem: &mut P,
    pred_aug: &DVector<f64>,
    _prev_aug: &DVector<f64>,
    prev_tangent: &DVector<f64>,
    settings: ContinuationSettings,
) -> Result<Option<(DVector<f64>, DVector<f64>)>> {
    let dim = problem.dimension();
    let mut current_aug = pred_aug.clone();

    for _ in 0..settings.corrector_steps {
        let j_ext = problem.extended_jacobian(&current_aug)?;
        let mut f_val = DVector::zeros(dim);
        problem.residual(&current_aug, &mut f_val)?;

        let diff = &current_aug - pred_aug;
        let constraint_val = prev_tangent.dot(&diff);

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -constraint_val;

        if rhs.norm() < settings.corrector_tolerance {
            let j_ext_final = problem.extended_jacobian(&current_aug)?;
            let mut new_tangent = compute_nullspace_tangent(&j_ext_final)?;

            if new_tangent.norm() > 0.0 {
                new_tangent.normalize_mut();
            }

            let oriented_tangent = if new_tangent.dot(prev_tangent) < 0.0 {
                -new_tangent
            } else {
                new_tangent
            };

            return Ok(Some((current_aug, oriented_tangent)));
        }

        let mut a = DMatrix::zeros(dim + 1, dim + 1);
        a.view_mut((0, 0), (dim, dim + 1)).copy_from(&j_ext);
        for i in 0..dim + 1 {
            a[(dim, i)] = prev_tangent[i];
        }

        let delta = a
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow!("Singular matrix in PALC corrector"))?;

        current_aug += &delta;

        if delta.norm() < settings.step_tolerance {}
    }

    Ok(None)
}

