// NOTE: The submodules in continuation/ (equilibrium, periodic, problem)
// contain continuation problem implementations.

#[path = "continuation/problem.rs"]
pub mod problem;

#[path = "continuation/periodic.rs"]
pub mod periodic;

#[path = "continuation/equilibrium.rs"]
pub mod equilibrium;

#[path = "continuation/types.rs"]
pub mod types;

#[path = "continuation/util.rs"]
pub mod util;

#[path = "continuation/codim1_curves/mod.rs"]
pub mod codim1_curves;

#[path = "continuation/lc_codim1_curves/mod.rs"]
pub mod lc_codim1_curves;

#[path = "continuation/homoclinic.rs"]
pub mod homoclinic;

#[path = "continuation/homoclinic_init.rs"]
pub mod homoclinic_init;

#[path = "continuation/homotopy_saddle.rs"]
pub mod homotopy_saddle;

// Re-export types needed for external use
pub use codim1_curves::{Codim2TestFunctions, FoldCurveProblem, HopfCurveProblem};
pub use homoclinic::continue_homoclinic_curve;
pub use homoclinic_init::{
    compute_homoclinic_basis, decode_homoclinic_state, homoclinic_setup_from_homoclinic_point,
    homoclinic_setup_from_homoclinic_point_with_source_extras,
    homoclinic_setup_from_homotopy_saddle_point, homoclinic_setup_from_large_cycle,
    homotopy_saddle_setup_from_equilibrium, pack_homoclinic_state, DecodedHomoclinicState,
    HomoclinicBasis, HomoclinicExtraFlags, HomoclinicFixedScalars, HomoclinicGuess,
    HomoclinicSetup, HomotopySaddleSetup,
};
pub use homotopy_saddle::{continue_homotopy_saddle_curve, homotopy_stage_d_to_homoclinic};
pub use lc_codim1_curves::{LPCCurveProblem, NSCurveProblem, PDCurveProblem};
pub use periodic::{
    continue_limit_cycle_collocation, extend_limit_cycle_collocation, limit_cycle_setup_from_hopf,
    limit_cycle_setup_from_orbit, limit_cycle_setup_from_pd, CollocationConfig, LimitCycleGuess,
    LimitCycleSetup, OrbitTimeMode,
};
pub use problem::{PointDiagnostics, TestFunctionValues};
pub use types::{
    BifurcationType, BranchType, Codim1CurveBranch, Codim1CurvePoint, Codim1CurveType,
    Codim2BifurcationType, ContinuationBranch, ContinuationEndpointSeed, ContinuationPoint,
    ContinuationResumeState, ContinuationSettings, HomoclinicBasisSnapshot,
    HomoclinicResumeContext, HomotopyStage, StepResult,
};
pub use util::{
    compute_eigenvalues, compute_nullspace_tangent, continuation_point_to_aug, hopf_pair_count,
    hopf_test_function, neutral_saddle_test_function, real_eigenvalue_count,
};

use crate::equation_engine::EquationSystem;
use crate::equilibrium::{
    compute_param_jacobian, compute_system_jacobian, evaluate_equilibrium_residual, SystemKind,
};
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
pub use problem::ContinuationProblem; // DEBUG_PD_CURVE: Made public for debug

// Generic continuation functions using ContinuationProblem trait

/// Continues from an initial point using pseudo-arclength continuation (PALC).
pub fn continue_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    initial_point: ContinuationPoint,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = problem.dimension();

    // Build initial augmented state [p, x...]
    let mut prev_aug = DVector::zeros(dim + 1);
    prev_aug[0] = initial_point.param_value;
    for (i, &val) in initial_point.state.iter().enumerate() {
        if i < dim {
            prev_aug[i + 1] = val;
        }
    }

    // Initialize branch with starting point
    let initial_diag = problem.diagnostics(&prev_aug)?;
    let mut prev_diag = initial_diag.clone();
    let mut branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: initial_point.state.clone(),
            param_value: initial_point.param_value,
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points.clone(),
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
        homoc_context: None,
        resume_state: None,
    };

    // Compute initial tangent and orient it based on requested parameter direction.
    let mut prev_tangent = compute_tangent_from_problem(problem, &prev_aug)?;
    let forward_sign = if forward { 1.0 } else { -1.0 };

    // When starting from a bifurcation (like Hopf), the tangent's parameter component
    // may be near-zero due to the branch being nearly orthogonal to the parameter axis.
    // For high-dimensional problems (like LC collocation), the normalized parameter component
    // can be extremely small. We use a relative threshold and add a proportional bias.
    let tangent_norm = prev_tangent.norm();
    let relative_threshold = 0.01; // 1% of tangent norm
    let param_component_threshold = relative_threshold * tangent_norm;

    if prev_tangent[0].abs() < param_component_threshold {
        // Add a bias equal to the threshold value in the user's direction
        prev_tangent[0] = param_component_threshold * forward_sign;
        // Re-normalize
        let norm = prev_tangent.norm();
        if norm > 1e-12 {
            prev_tangent = &prev_tangent / norm;
        }
    } else if prev_tangent[0] * forward_sign < 0.0 {
        prev_tangent = -prev_tangent;
    }

    // Set direction
    let direction_sign = 1.0; // Direction is now encoded in the oriented tangent
    let mut step_size = clamp_step_size(settings.step_size, settings);
    let mut current_index: i32 = 0;
    let mut consecutive_failures = 0;
    const MAX_CONSECUTIVE_FAILURES: usize = 20;

    for _step in 0..settings.max_steps {
        // Predictor: predict along tangent
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector: solve using Newton-like iteration
        let corrected_opt = correct_with_problem(
            problem,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            settings.corrector_steps,
            settings.corrector_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }

            // Compute new tangent
            let new_tangent = compute_tangent_from_problem(problem, &corrected_aug)?;
            if !new_tangent.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }

            // Ensure tangent direction consistency (sign should match prev_tangent)
            let dot_product: f64 = new_tangent
                .iter()
                .zip(prev_tangent.iter())
                .map(|(a, b)| a * b)
                .sum();
            let consistent_tangent = if dot_product < 0.0 {
                -new_tangent // Flip sign to maintain direction
            } else {
                new_tangent
            };

            // Reset failure counter on success
            consecutive_failures = 0;

            // Update problem state after successful step
            problem.update_after_step(&corrected_aug)?;

            // Compute diagnostics for the new point
            let diagnostics = problem.diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let prev_tests = &prev_diag.test_values;
            let new_tests = &diagnostics.test_values;

            // Detect limit cycle bifurcations
            let cycle_fold_crossed = prev_tests.cycle_fold * new_tests.cycle_fold < 0.0;
            let period_doubling_crossed =
                prev_tests.period_doubling * new_tests.period_doubling < 0.0;
            let neimark_sacker_crossed = prev_tests.neimark_sacker * new_tests.neimark_sacker < 0.0;

            // Detect equilibrium bifurcations
            let fold_crossed = prev_tests.fold * new_tests.fold < 0.0;
            let hopf_crossed = hopf_crossed_with_complex_pairs(&prev_diag, &diagnostics);
            let neutral_saddle_crossed =
                neutral_saddle_crossed_with_real_pairs(&prev_diag, &diagnostics);

            // Prioritize: Fold > Hopf > CycleFold > PeriodDoubling > NeimarkSacker
            let bifurcation_type = if fold_crossed {
                BifurcationType::Fold
            } else if hopf_crossed {
                BifurcationType::Hopf
            } else if cycle_fold_crossed {
                BifurcationType::CycleFold
            } else if period_doubling_crossed {
                BifurcationType::PeriodDoubling
            } else if neimark_sacker_crossed {
                BifurcationType::NeimarkSacker
            } else if neutral_saddle_crossed {
                BifurcationType::NeutralSaddle
            } else {
                BifurcationType::None
            };

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if bifurcation_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    problem,
                    &prev_aug,
                    prev_tests,
                    &corrected_aug,
                    new_tests,
                    bifurcation_type,
                    &prev_tangent,
                    settings.corrector_steps,
                    settings.corrector_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diagnostics.clone()),
                }
            } else {
                (corrected_aug.clone(), diagnostics.clone())
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diagnostics.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            // Create new point
            current_index += forward_sign as i32;
            let new_point = ContinuationPoint {
                state: output_aug.rows(1, dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }

            branch.points.push(new_point);
            branch.indices.push(current_index);

            // Adaptive step size - increase on success
            step_size = (step_size * 1.2).min(settings.max_step_size);

            prev_aug = continuation_aug;
            prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, consistent_tangent)?;
            prev_diag = continuation_diag;
        } else {
            // Failed to converge, reduce step size
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size
                || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                break;
            }
        }
    }

    if let Some(seed) = build_resume_seed(current_index, &prev_aug, &prev_tangent, step_size) {
        let mut resume_state = ContinuationResumeState::default();
        if seed.endpoint_index <= 0 {
            resume_state.min_index_seed = Some(seed.clone());
        }
        if seed.endpoint_index >= 0 {
            resume_state.max_index_seed = Some(seed);
        }
        branch.resume_state = Some(resume_state);
    }

    Ok(branch)
}

// ============================================================================
// Stepping-Based Continuation API (for progress reporting)
// ============================================================================

const MAX_CONSECUTIVE_FAILURES: usize = 20;

fn clamp_step_size(step_size: f64, settings: ContinuationSettings) -> f64 {
    let mut clamped = if step_size.is_finite() && step_size > 0.0 {
        step_size
    } else {
        settings.step_size
    };
    clamped = clamped.max(settings.min_step_size);
    clamped = clamped.min(settings.max_step_size);
    clamped
}

fn normalize_tangent_or_compute<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    mut tangent: DVector<f64>,
) -> Result<DVector<f64>> {
    if tangent.norm() < 1e-12 {
        tangent = compute_tangent_from_problem(problem, prev_aug)?;
    }
    let norm = tangent.norm();
    if norm > 1e-12 {
        Ok(tangent / norm)
    } else {
        Ok(tangent)
    }
}

fn build_resume_seed(
    endpoint_index: i32,
    aug_state: &DVector<f64>,
    tangent: &DVector<f64>,
    step_size: f64,
) -> Option<ContinuationEndpointSeed> {
    if !step_size.is_finite() || step_size <= 0.0 {
        return None;
    }
    if aug_state.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if tangent.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if tangent.norm() <= 1e-12 {
        return None;
    }
    let tangent_norm = tangent / tangent.norm();
    Some(ContinuationEndpointSeed {
        endpoint_index,
        aug_state: aug_state.iter().cloned().collect(),
        tangent: tangent_norm.iter().cloned().collect(),
        step_size,
    })
}

/// A runner that holds continuation state and allows stepped execution for progress reporting.
///
/// Use this when you need to report progress during continuation:
/// ```ignore
/// let mut runner = ContinuationRunner::new(problem, initial_point, settings, forward)?;
/// while !runner.is_done() {
///     runner.run_steps(5)?;
///     println!("Progress: {}/{}", runner.current_step(), runner.max_steps());
/// }
/// let branch = runner.take_result();
/// ```
pub struct ContinuationRunner<P: ContinuationProblem> {
    problem: P,
    prev_aug: DVector<f64>,
    prev_tangent: DVector<f64>,
    initial_aug: DVector<f64>,
    initial_tangent: DVector<f64>,
    initial_step_size: f64,
    prev_diag: PointDiagnostics,
    step_size: f64,
    current_index: i32,
    index_step: i32,
    consecutive_failures: usize,
    current_step: usize,
    max_steps: usize,
    settings: ContinuationSettings,
    branch: ContinuationBranch,
    done: bool,
    dim: usize,
}

impl<P: ContinuationProblem> ContinuationRunner<P> {
    fn init_branch_from_aug(
        problem: &mut P,
        prev_aug: &DVector<f64>,
        dim: usize,
    ) -> Result<(PointDiagnostics, ContinuationBranch)> {
        let initial_diag = problem.diagnostics(prev_aug)?;
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: prev_aug.rows(1, dim).iter().cloned().collect(),
                param_value: prev_aug[0],
                stability: BifurcationType::None,
                eigenvalues: initial_diag.eigenvalues.clone(),
                cycle_points: initial_diag.cycle_points.clone(),
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
        };
        Ok((initial_diag, branch))
    }

    /// Create a new continuation runner initialized from a starting point.
    pub fn new(
        mut problem: P,
        initial_point: ContinuationPoint,
        settings: ContinuationSettings,
        forward: bool,
    ) -> Result<Self> {
        let dim = problem.dimension();

        // Build initial augmented state [p, x...]
        let mut prev_aug = DVector::zeros(dim + 1);
        prev_aug[0] = initial_point.param_value;
        for (i, &val) in initial_point.state.iter().enumerate() {
            if i < dim {
                prev_aug[i + 1] = val;
            }
        }

        let (prev_diag, branch) = Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;

        // Compute initial tangent and orient it based on requested parameter direction.
        let mut prev_tangent = compute_tangent_from_problem(&mut problem, &prev_aug)?;
        let forward_sign = if forward { 1.0 } else { -1.0 };

        let tangent_norm = prev_tangent.norm();
        let relative_threshold = 0.01;
        let param_component_threshold = relative_threshold * tangent_norm;

        if prev_tangent[0].abs() < param_component_threshold {
            prev_tangent[0] = param_component_threshold * forward_sign;
            let norm = prev_tangent.norm();
            if norm > 1e-12 {
                prev_tangent = &prev_tangent / norm;
            }
        } else if prev_tangent[0] * forward_sign < 0.0 {
            prev_tangent = -prev_tangent;
        }

        let index_step = if forward { 1 } else { -1 };

        let step_size = clamp_step_size(settings.step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            step_size,
            current_index: 0,
            index_step,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Create a new continuation runner with a user-specified initial tangent.
    ///
    /// This is intended for branch extension where the tangent is derived from
    /// the existing branch or a secant direction.
    pub fn new_with_tangent(
        mut problem: P,
        initial_point: ContinuationPoint,
        initial_tangent: DVector<f64>,
        settings: ContinuationSettings,
    ) -> Result<Self> {
        let dim = problem.dimension();

        // Build initial augmented state [p, x...]
        let mut prev_aug = DVector::zeros(dim + 1);
        prev_aug[0] = initial_point.param_value;
        for (i, &val) in initial_point.state.iter().enumerate() {
            if i < dim {
                prev_aug[i + 1] = val;
            }
        }

        let (prev_diag, branch) = Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;
        let prev_tangent = normalize_tangent_or_compute(&mut problem, &prev_aug, initial_tangent)?;

        let step_size = clamp_step_size(settings.step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            step_size,
            current_index: 0,
            index_step: 1,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Create a continuation runner from a saved endpoint seed.
    ///
    /// This resumes from the accepted augmented state/tangent/step size
    /// captured at an endpoint of a previous run.
    pub fn new_from_seed(
        mut problem: P,
        aug_state: Vec<f64>,
        tangent: Vec<f64>,
        seed_step_size: f64,
        settings: ContinuationSettings,
    ) -> Result<Self> {
        let dim = problem.dimension();
        if aug_state.len() != dim + 1 {
            bail!(
                "Resume seed dimension mismatch: expected {} values, got {}",
                dim + 1,
                aug_state.len()
            );
        }
        if tangent.len() != dim + 1 {
            bail!(
                "Resume seed tangent dimension mismatch: expected {} values, got {}",
                dim + 1,
                tangent.len()
            );
        }

        let prev_aug = DVector::from_vec(aug_state);
        let seed_tangent = DVector::from_vec(tangent);
        let prev_tangent = normalize_tangent_or_compute(&mut problem, &prev_aug, seed_tangent)?;
        let (prev_diag, branch) = Self::init_branch_from_aug(&mut problem, &prev_aug, dim)?;

        let step_size = clamp_step_size(seed_step_size, settings);

        Ok(Self {
            problem,
            prev_aug: prev_aug.clone(),
            prev_tangent: prev_tangent.clone(),
            initial_aug: prev_aug,
            initial_tangent: prev_tangent,
            initial_step_size: step_size,
            prev_diag,
            step_size,
            current_index: 0,
            index_step: 1,
            consecutive_failures: 0,
            current_step: 0,
            max_steps: settings.max_steps,
            settings,
            branch,
            done: false,
            dim,
        })
    }

    /// Run a batch of continuation steps, returning progress information.
    pub fn run_steps(&mut self, batch_size: usize) -> Result<StepResult> {
        if self.done {
            return Ok(self.step_result());
        }

        for _ in 0..batch_size {
            if self.current_step >= self.max_steps {
                self.done = true;
                break;
            }

            if !self.single_step()? {
                // Early termination due to step size or failure limit
                self.done = true;
                break;
            }

            self.current_step += 1;
        }

        Ok(self.step_result())
    }

    /// Execute a single continuation step. Returns false if should terminate.
    fn single_step(&mut self) -> Result<bool> {
        // Predictor: predict along tangent
        let direction_sign = 1.0;
        let pred_aug = &self.prev_aug + &self.prev_tangent * (self.step_size * direction_sign);

        // Corrector: solve using Newton-like iteration
        let corrected_opt = correct_with_problem(
            &mut self.problem,
            &pred_aug,
            &self.prev_aug,
            &self.prev_tangent,
            self.settings.corrector_steps,
            self.settings.corrector_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                self.consecutive_failures += 1;
                self.step_size *= 0.5;
                if self.step_size < self.settings.min_step_size
                    || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    return Ok(false);
                }
                return Ok(true); // Continue trying
            }
            // Compute new tangent
            let new_tangent = compute_tangent_from_problem(&mut self.problem, &corrected_aug)?;
            if !new_tangent.iter().all(|v| v.is_finite()) {
                self.consecutive_failures += 1;
                self.step_size *= 0.5;
                if self.step_size < self.settings.min_step_size
                    || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    return Ok(false);
                }
                return Ok(true);
            }

            // Ensure tangent direction consistency
            let dot_product: f64 = new_tangent
                .iter()
                .zip(self.prev_tangent.iter())
                .map(|(a, b)| a * b)
                .sum();
            let consistent_tangent = if dot_product < 0.0 {
                -new_tangent
            } else {
                new_tangent
            };

            // Reset failure counter on success
            self.consecutive_failures = 0;

            // Update problem state after successful step
            self.problem.update_after_step(&corrected_aug)?;

            // Compute diagnostics for the new point
            let diagnostics = self.problem.diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let prev_tests = &self.prev_diag.test_values;
            let new_tests = &diagnostics.test_values;

            // Detect limit cycle bifurcations
            let cycle_fold_crossed = prev_tests.cycle_fold * new_tests.cycle_fold < 0.0;
            let period_doubling_crossed =
                prev_tests.period_doubling * new_tests.period_doubling < 0.0;
            let neimark_sacker_crossed = prev_tests.neimark_sacker * new_tests.neimark_sacker < 0.0;

            // Detect equilibrium bifurcations
            let fold_crossed = prev_tests.fold * new_tests.fold < 0.0;
            let hopf_crossed = hopf_crossed_with_complex_pairs(&self.prev_diag, &diagnostics);
            let neutral_saddle_crossed =
                neutral_saddle_crossed_with_real_pairs(&self.prev_diag, &diagnostics);

            let bifurcation_type = if fold_crossed {
                BifurcationType::Fold
            } else if hopf_crossed {
                BifurcationType::Hopf
            } else if cycle_fold_crossed {
                BifurcationType::CycleFold
            } else if period_doubling_crossed {
                BifurcationType::PeriodDoubling
            } else if neimark_sacker_crossed {
                BifurcationType::NeimarkSacker
            } else if neutral_saddle_crossed {
                BifurcationType::NeutralSaddle
            } else {
                BifurcationType::None
            };

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if bifurcation_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    &mut self.problem,
                    &self.prev_aug,
                    prev_tests,
                    &corrected_aug,
                    new_tests,
                    bifurcation_type,
                    &self.prev_tangent,
                    self.settings.corrector_steps,
                    self.settings.corrector_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diagnostics.clone()),
                }
            } else {
                (corrected_aug.clone(), diagnostics.clone())
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diagnostics.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            self.current_index += self.index_step;

            let new_point = ContinuationPoint {
                state: output_aug.rows(1, self.dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                self.branch.bifurcations.push(self.branch.points.len());
            }

            self.branch.points.push(new_point);
            self.branch.indices.push(self.current_index);

            // Adaptive step size - increase on success
            self.step_size = (self.step_size * 1.2).min(self.settings.max_step_size);

            self.prev_aug = continuation_aug;
            self.prev_tangent = normalize_tangent_or_compute(
                &mut self.problem,
                &self.prev_aug,
                consistent_tangent,
            )?;
            self.prev_diag = continuation_diag;
        } else {
            // Failed to converge, reduce step size
            self.consecutive_failures += 1;
            self.step_size *= 0.5;
            if self.step_size < self.settings.min_step_size
                || self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Check if continuation is complete.
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Get current step number.
    pub fn current_step(&self) -> usize {
        self.current_step
    }

    /// Get max steps.
    pub fn max_steps(&self) -> usize {
        self.max_steps
    }

    /// Get step result for progress reporting.
    pub fn step_result(&self) -> StepResult {
        StepResult::new(
            self.done,
            self.current_step,
            self.max_steps,
            self.branch.points.len(),
            self.branch.bifurcations.len(),
            self.prev_aug[0],
        )
    }

    /// Take the final branch result, consuming the runner.
    pub fn take_result(mut self) -> ContinuationBranch {
        let mut resume_state = self.branch.resume_state.take().unwrap_or_default();

        // Prefer boundary secants from accepted points for endpoint seeds.
        // The initial predictor tangent can be stale after early correction and
        // can produce nonlocal extension starts, especially for homoclinic
        // branches when extending from the minimum-index side.
        let start_seed = build_resume_seed_from_branch_endpoint(
            &self.branch,
            0,
            -self.index_step,
            self.initial_step_size,
        )
        .or_else(|| {
            build_resume_seed(
                0,
                &self.initial_aug,
                &self.initial_tangent,
                self.initial_step_size,
            )
        });
        if let Some(seed) = start_seed {
            assign_seed_to_resume_state(&mut resume_state, seed);
        }

        let current_seed = build_resume_seed(
            self.current_index,
            &self.prev_aug,
            &self.prev_tangent,
            self.step_size,
        )
        .or_else(|| {
            build_resume_seed_from_branch_endpoint(
                &self.branch,
                self.current_index,
                self.index_step,
                self.step_size,
            )
        });

        if let Some(seed) = current_seed {
            assign_seed_to_resume_state(&mut resume_state, seed);
        }

        if resume_state.min_index_seed.is_some() || resume_state.max_index_seed.is_some() {
            self.branch.resume_state = Some(resume_state);
        }
        self.branch
    }

    /// Get a reference to the branch.
    pub fn branch(&self) -> &ContinuationBranch {
        &self.branch
    }

    /// Set the branch type (used for limit cycle continuation).
    pub fn set_branch_type(&mut self, branch_type: BranchType) {
        self.branch.branch_type = branch_type;
    }

    /// Set the upoldp field (used for limit cycle continuation).
    pub fn set_upoldp(&mut self, upoldp: Option<Vec<Vec<f64>>>) {
        self.branch.upoldp = upoldp;
    }

    /// Set homoclinic extension context metadata.
    pub fn set_homoc_context(&mut self, homoc_context: Option<HomoclinicResumeContext>) {
        self.branch.homoc_context = homoc_context;
    }

    /// Set extension resume metadata.
    pub fn set_resume_state(&mut self, resume_state: Option<ContinuationResumeState>) {
        self.branch.resume_state = resume_state;
    }
}

fn assign_seed_to_resume_state(
    resume_state: &mut ContinuationResumeState,
    seed: ContinuationEndpointSeed,
) {
    if seed.endpoint_index <= 0 {
        resume_state.min_index_seed = Some(seed.clone());
    }
    if seed.endpoint_index >= 0 {
        resume_state.max_index_seed = Some(seed);
    }
}

fn build_resume_seed_from_branch_endpoint(
    branch: &ContinuationBranch,
    endpoint_index: i32,
    index_step: i32,
    step_size: f64,
) -> Option<ContinuationEndpointSeed> {
    if !step_size.is_finite() || step_size <= 0.0 {
        return None;
    }
    let endpoint_pos = branch
        .indices
        .iter()
        .position(|&idx| idx == endpoint_index)?;
    let endpoint = branch.points.get(endpoint_pos)?;
    if endpoint.state.iter().any(|v| !v.is_finite()) || !endpoint.param_value.is_finite() {
        return None;
    }

    let mut aug_state = Vec::with_capacity(endpoint.state.len() + 1);
    aug_state.push(endpoint.param_value);
    aug_state.extend(endpoint.state.iter().copied());

    let neighbor_index = endpoint_index - index_step;
    let tangent = if let Some(neighbor_pos) = branch
        .indices
        .iter()
        .position(|&idx| idx == neighbor_index)
        .and_then(|pos| branch.points.get(pos).map(|pt| (pos, pt)))
    {
        let (_, neighbor) = neighbor_pos;
        if neighbor.state.len() == endpoint.state.len()
            && neighbor.state.iter().all(|v| v.is_finite())
            && neighbor.param_value.is_finite()
        {
            let mut secant = DVector::zeros(aug_state.len());
            secant[0] = endpoint.param_value - neighbor.param_value;
            for i in 0..endpoint.state.len() {
                secant[i + 1] = endpoint.state[i] - neighbor.state[i];
            }
            if secant.norm() > 1e-12 {
                secant.normalize().iter().copied().collect::<Vec<f64>>()
            } else {
                let mut fallback = vec![0.0; aug_state.len()];
                fallback[0] = if index_step >= 0 { 1.0 } else { -1.0 };
                fallback
            }
        } else {
            let mut fallback = vec![0.0; aug_state.len()];
            fallback[0] = if index_step >= 0 { 1.0 } else { -1.0 };
            fallback
        }
    } else {
        let mut fallback = vec![0.0; aug_state.len()];
        fallback[0] = if index_step >= 0 { 1.0 } else { -1.0 };
        fallback
    };

    Some(ContinuationEndpointSeed {
        endpoint_index,
        aug_state,
        tangent,
        step_size,
    })
}

fn orient_extension_tangent(
    tangent: &mut DVector<f64>,
    secant: Option<&DVector<f64>>,
    forward: bool,
) {
    let forward_sign = if forward { 1.0 } else { -1.0 };

    if let Some(secant) = secant {
        if tangent.dot(secant) < 0.0 {
            *tangent = -tangent.clone();
        }
        return;
    }

    let tangent_norm = tangent.norm();
    let param_component_threshold = 0.01 * tangent_norm;

    if tangent[0].abs() < param_component_threshold {
        tangent[0] = param_component_threshold * forward_sign;
        let norm = tangent.norm();
        if norm > 1e-12 {
            *tangent = &*tangent / norm;
        }
    } else if tangent[0] * forward_sign < 0.0 {
        *tangent = -tangent.clone();
    }
}

fn cap_extension_step_size(settings: &mut ContinuationSettings, secant_norm: Option<f64>) {
    let Some(secant_norm) = secant_norm else {
        return;
    };
    if !secant_norm.is_finite() || secant_norm <= 1e-12 {
        return;
    }

    if settings.step_size > secant_norm {
        settings.step_size = secant_norm;
    }
    if settings.max_step_size < settings.step_size {
        settings.max_step_size = settings.step_size;
    }
    if settings.min_step_size > settings.step_size {
        settings.min_step_size = settings.step_size;
    }
}

fn validate_resume_seed(
    seed: &ContinuationEndpointSeed,
    endpoint_index: i32,
    expected_aug_len: usize,
) -> bool {
    if seed.endpoint_index != endpoint_index {
        return false;
    }
    if seed.aug_state.len() != expected_aug_len || seed.tangent.len() != expected_aug_len {
        return false;
    }
    if seed.aug_state.iter().any(|v| !v.is_finite()) {
        return false;
    }
    if seed.tangent.iter().any(|v| !v.is_finite()) {
        return false;
    }
    if seed.step_size <= 0.0 || !seed.step_size.is_finite() {
        return false;
    }
    let tangent_norm = DVector::from_vec(seed.tangent.clone()).norm();
    tangent_norm > 1e-12
}

fn select_resume_seed(
    branch: &ContinuationBranch,
    forward: bool,
    endpoint_index: i32,
    expected_aug_len: usize,
) -> Option<ContinuationEndpointSeed> {
    let seed = if forward {
        branch
            .resume_state
            .as_ref()
            .and_then(|state| state.max_index_seed.clone())
    } else {
        branch
            .resume_state
            .as_ref()
            .and_then(|state| state.min_index_seed.clone())
    }?;
    if validate_resume_seed(&seed, endpoint_index, expected_aug_len) {
        Some(seed)
    } else {
        None
    }
}

/// Extends an existing branch using pseudo-arclength continuation.
/// Uses a secant predictor from the last two points to determine the continuation direction.
pub fn extend_branch_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    mut branch: ContinuationBranch,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    if branch.points.is_empty() {
        bail!("Cannot extend empty branch");
    }

    if branch.indices.len() != branch.points.len() {
        branch.indices = (0..branch.points.len() as i32).collect();
    }

    // Get the endpoint to continue from based on forward/backward
    // forward=true means append to the end (max index), forward=false means prepend (min index)
    let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
        let max_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .max_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        // Find the previous point (second highest index)
        let prev_idx_pos = if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != max_idx_pos)
                .max_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        };
        (max_idx_pos, branch.indices[max_idx_pos], prev_idx_pos, true)
    } else {
        let min_idx_pos = branch
            .indices
            .iter()
            .enumerate()
            .min_by_key(|(_, &idx)| idx)
            .unwrap()
            .0;
        // Find the next point (second lowest index)
        let next_idx_pos = if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != min_idx_pos)
                .min_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        };
        (
            min_idx_pos,
            branch.indices[min_idx_pos],
            next_idx_pos,
            false,
        )
    };

    let endpoint = &branch.points[endpoint_idx];

    // Build augmented state for endpoint
    let dim = problem.dimension();
    let mut end_aug = DVector::zeros(dim + 1);
    if endpoint.state.len() != dim {
        anyhow::bail!(
            "Dimension mismatch: branch point state has length {}, problem expects {}",
            endpoint.state.len(),
            dim
        );
    }
    end_aug[0] = endpoint.param_value;
    for (i, &v) in endpoint.state.iter().enumerate() {
        end_aug[i + 1] = v;
    }

    // Compute secant direction from neighbor to endpoint if we have two points.
    // Secant from interior neighbor to selected endpoint preserves outward continuation
    // on the requested signed-index side.
    let (secant_direction, secant_norm) = if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &branch.points[neighbor_pos];
        let mut neighbor_aug = DVector::zeros(dim + 1);
        neighbor_aug[0] = neighbor.param_value;
        for (i, &v) in neighbor.state.iter().enumerate() {
            neighbor_aug[i + 1] = v;
        }

        let secant = &end_aug - &neighbor_aug;
        let norm = secant.norm();
        if norm > 1e-12 {
            (Some(secant.normalize()), Some(norm))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let mut settings = settings;
    cap_extension_step_size(&mut settings, secant_norm);
    let resume_seed = select_resume_seed(&branch, forward, last_index, dim + 1);

    let extension = if let Some(seed) = resume_seed {
        let initial_point = ContinuationPoint {
            state: seed.aug_state[1..].to_vec(),
            param_value: seed.aug_state[0],
            stability: endpoint.stability,
            eigenvalues: endpoint.eigenvalues.clone(),
            cycle_points: endpoint.cycle_points.clone(),
        };
        continue_with_initial_tangent(
            problem,
            initial_point,
            DVector::from_vec(seed.tangent),
            settings,
        )?
    } else {
        // With at least two points, secant provides a robust outward direction.
        let mut tangent = if let Some(secant) = secant_direction.as_ref() {
            secant.clone()
        } else {
            compute_tangent_from_problem(problem, &end_aug)?
        };

        orient_extension_tangent(&mut tangent, secant_direction.as_ref(), forward);

        // Now run continuation with the correctly oriented tangent
        let initial_point = ContinuationPoint {
            state: endpoint.state.clone(),
            param_value: endpoint.param_value,
            stability: endpoint.stability.clone(),
            eigenvalues: endpoint.eigenvalues.clone(),
            cycle_points: endpoint.cycle_points.clone(),
        };

        continue_with_initial_tangent(problem, initial_point, tangent.clone(), settings)?
    };

    // Merge extension into main branch (skip first point as it's the endpoint)
    let index_offset = last_index;
    let sign = if is_append { 1 } else { -1 };
    let orig_count = branch.points.len();
    for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
        branch.points.push(pt);
        let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
        branch.indices.push(index_offset + idx * sign);
    }

    // Merge bifurcation indices (adjusting for new positions in merged branch)
    // extension.bifurcations contains indices into extension.points (before skip)
    // After merging, extension point i maps to branch.points[orig_count + i - 1] (skipping first)
    for ext_bif_idx in extension.bifurcations {
        if ext_bif_idx > 0 {
            // Map to new position: orig_count + (ext_bif_idx - 1)
            branch.bifurcations.push(orig_count + ext_bif_idx - 1);
        }
        // ext_bif_idx == 0 is the overlap point which already exists in branch, skip it
    }

    if let Some(ext_resume) = extension.resume_state {
        let mut merged_resume = branch.resume_state.take().unwrap_or_default();
        if let Some(seed) = ext_resume.max_index_seed {
            let mapped_index = index_offset + seed.endpoint_index * sign;
            let mapped_seed = ContinuationEndpointSeed {
                endpoint_index: mapped_index,
                aug_state: seed.aug_state,
                tangent: seed.tangent,
                step_size: seed.step_size,
            };
            if sign > 0 {
                merged_resume.max_index_seed = Some(mapped_seed);
            } else {
                merged_resume.min_index_seed = Some(mapped_seed);
            }
        }
        if let Some(seed) = ext_resume.min_index_seed {
            let mapped_index = index_offset + seed.endpoint_index * sign;
            let mapped_seed = ContinuationEndpointSeed {
                endpoint_index: mapped_index,
                aug_state: seed.aug_state,
                tangent: seed.tangent,
                step_size: seed.step_size,
            };
            if sign > 0 {
                merged_resume.max_index_seed = Some(mapped_seed);
            } else {
                merged_resume.min_index_seed = Some(mapped_seed);
            }
        }
        branch.resume_state = Some(merged_resume);
    }

    Ok(branch)
}

/// Continues from an initial point with a given initial tangent direction.
pub fn continue_with_initial_tangent<P: ContinuationProblem>(
    problem: &mut P,
    initial_point: ContinuationPoint,
    initial_tangent: DVector<f64>,
    settings: ContinuationSettings,
) -> Result<ContinuationBranch> {
    let dim = problem.dimension();

    // Build initial augmented state
    let mut prev_aug = DVector::zeros(dim + 1);
    prev_aug[0] = initial_point.param_value;
    for (i, &v) in initial_point.state.iter().enumerate() {
        prev_aug[i + 1] = v;
    }

    let initial_diag = problem.diagnostics(&prev_aug)?;
    let mut prev_diag = initial_diag.clone();
    let mut branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: initial_point.state.clone(),
            param_value: initial_point.param_value,
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points.clone(),
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
        homoc_context: None,
        resume_state: None,
    };

    // Use provided tangent (already oriented correctly)
    let mut prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, initial_tangent)?;

    let mut step_size = clamp_step_size(settings.step_size, settings);
    let mut current_index: i32 = 0;
    let mut consecutive_failures = 0;
    const MAX_CONSECUTIVE_FAILURES: usize = 20;

    for _step in 0..settings.max_steps {
        // Predictor: always step in positive tangent direction (tangent is already oriented)
        let pred_aug = &prev_aug + &prev_tangent * step_size;

        // Corrector
        let corrected_opt = correct_with_problem(
            problem,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            settings.corrector_steps,
            settings.corrector_tolerance,
        )?;

        if let Some(corrected_aug) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size
                    || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
                {
                    break;
                }
                continue;
            }
            consecutive_failures = 0;

            // Compute new tangent and orient it to match previous direction
            let mut new_tangent = compute_tangent_from_problem(problem, &corrected_aug)?;
            if new_tangent.dot(&prev_tangent) < 0.0 {
                new_tangent = -new_tangent;
            }

            // Compute diagnostics
            let diag = problem.diagnostics(&corrected_aug)?;

            // Bifurcation detection via test function sign changes
            let prev_tests = &prev_diag.test_values;
            let new_tests = &diag.test_values;

            // Detect limit cycle bifurcations
            let cycle_fold_crossed = prev_tests.cycle_fold * new_tests.cycle_fold < 0.0;
            let period_doubling_crossed =
                prev_tests.period_doubling * new_tests.period_doubling < 0.0;
            let neimark_sacker_crossed = prev_tests.neimark_sacker * new_tests.neimark_sacker < 0.0;

            // Detect equilibrium bifurcations
            let fold_crossed = prev_tests.fold * new_tests.fold < 0.0;
            let hopf_crossed = hopf_crossed_with_complex_pairs(&prev_diag, &diag);
            let neutral_saddle_crossed = neutral_saddle_crossed_with_real_pairs(&prev_diag, &diag);

            // Prioritize: Fold > Hopf > CycleFold > PeriodDoubling > NeimarkSacker
            let bifurcation_type = if fold_crossed {
                BifurcationType::Fold
            } else if hopf_crossed {
                BifurcationType::Hopf
            } else if cycle_fold_crossed {
                BifurcationType::CycleFold
            } else if period_doubling_crossed {
                BifurcationType::PeriodDoubling
            } else if neimark_sacker_crossed {
                BifurcationType::NeimarkSacker
            } else if neutral_saddle_crossed {
                BifurcationType::NeutralSaddle
            } else {
                BifurcationType::None
            };

            // Refine bifurcation point if detected
            let (final_aug, final_diag) = if bifurcation_type != BifurcationType::None {
                match refine_bifurcation_bisection(
                    problem,
                    &prev_aug,
                    prev_tests,
                    &corrected_aug,
                    new_tests,
                    bifurcation_type,
                    &prev_tangent,
                    settings.corrector_steps,
                    settings.corrector_tolerance,
                ) {
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag),
                    Err(_) => (corrected_aug.clone(), diag.clone()),
                }
            } else {
                (corrected_aug.clone(), diag.clone())
            };

            let output_aug = final_aug;
            let output_diag = final_diag;
            let (continuation_aug, continuation_diag) = if bifurcation_type != BifurcationType::None
            {
                (corrected_aug.clone(), diag.clone())
            } else {
                (output_aug.clone(), output_diag.clone())
            };

            // Create new point with potentially refined state
            let new_pt = ContinuationPoint {
                state: output_aug.rows(1, dim).iter().cloned().collect(),
                param_value: output_aug[0],
                stability: bifurcation_type,
                eigenvalues: output_diag.eigenvalues.clone(),
                cycle_points: output_diag.cycle_points.clone(),
            };

            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }

            branch.points.push(new_pt);
            branch.indices.push(current_index + 1);
            current_index += 1;

            // Update problem state if needed
            problem.update_after_step(&continuation_aug)?;

            prev_aug = continuation_aug;
            prev_tangent = normalize_tangent_or_compute(problem, &prev_aug, new_tangent)?;
            prev_diag = continuation_diag;

            // Adaptive step size
            step_size = (step_size * 1.2).min(settings.max_step_size);
        } else {
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size
                || consecutive_failures >= MAX_CONSECUTIVE_FAILURES
            {
                break;
            }
        }
    }

    if let Some(seed) = build_resume_seed(current_index, &prev_aug, &prev_tangent, step_size) {
        let mut resume_state = ContinuationResumeState::default();
        if seed.endpoint_index <= 0 {
            resume_state.min_index_seed = Some(seed.clone());
        }
        if seed.endpoint_index >= 0 {
            resume_state.max_index_seed = Some(seed);
        }
        branch.resume_state = Some(resume_state);
    }

    Ok(branch)
}

/// Refines a bifurcation point using bisection.
fn refine_bifurcation_bisection<P: ContinuationProblem>(
    problem: &mut P,
    prev_aug: &DVector<f64>,
    prev_tests: &problem::TestFunctionValues,
    new_aug: &DVector<f64>,
    new_tests: &problem::TestFunctionValues,
    bif_type: BifurcationType,
    tangent: &DVector<f64>,
    corrector_steps: usize,
    tolerance: f64,
) -> Result<(DVector<f64>, problem::PointDiagnostics)> {
    const MAX_BISECTION_ITERS: usize = 10;
    const TEST_TOLERANCE: f64 = 1e-6;

    let mut lo_aug = prev_aug.clone();
    let mut hi_aug = new_aug.clone();
    let mut lo_test = prev_tests.value_for(bif_type);
    let mut hi_test = new_tests.value_for(bif_type);

    // Ensure lo_test < 0, hi_test > 0 for consistent bisection
    if lo_test > hi_test {
        std::mem::swap(&mut lo_aug, &mut hi_aug);
        std::mem::swap(&mut lo_test, &mut hi_test);
    }

    let mut best_aug = if lo_test.abs() < hi_test.abs() {
        lo_aug.clone()
    } else {
        hi_aug.clone()
    };
    let mut best_diag = problem.diagnostics(&best_aug)?;

    for _ in 0..MAX_BISECTION_ITERS {
        // Linear interpolation to estimate zero crossing
        let denom = hi_test - lo_test;
        let s = if denom.abs() > 1e-12 {
            (-lo_test / denom).clamp(0.1, 0.9) // Avoid extreme ends
        } else {
            0.5
        };

        let mid_aug = &lo_aug + (&hi_aug - &lo_aug) * s;

        // Correct back to solution manifold
        let corrected = correct_with_problem(
            problem,
            &mid_aug,
            &lo_aug,
            tangent,
            corrector_steps,
            tolerance,
        )?;

        let corrected_aug = match corrected {
            Some(aug) => aug,
            None => {
                // Correction failed, try midpoint without correction
                mid_aug
            }
        };

        // Compute diagnostics at corrected point
        let diag = problem.diagnostics(&corrected_aug)?;
        let mid_test = diag.test_values.value_for(bif_type);

        // Check convergence
        if mid_test.abs() < TEST_TOLERANCE {
            return Ok((corrected_aug, diag));
        }

        // Update bracket
        if mid_test < 0.0 {
            lo_aug = corrected_aug.clone();
            lo_test = mid_test;
        } else {
            hi_aug = corrected_aug.clone();
            hi_test = mid_test;
        }

        // Track best (closest to zero)
        if mid_test.abs() < best_diag.test_values.value_for(bif_type).abs() {
            best_aug = corrected_aug;
            best_diag = diag;
        }
    }

    // Return best found even if not fully converged
    Ok((best_aug, best_diag))
}

/// Computes the tangent vector using the Jacobian null space.
fn compute_tangent_from_problem<P: ContinuationProblem>(
    problem: &mut P,
    aug_state: &DVector<f64>,
) -> Result<DVector<f64>> {
    let dim = problem.dimension();
    let jac = problem.extended_jacobian(aug_state)?;

    // Validate Jacobian dimensions
    if jac.nrows() != dim || jac.ncols() != dim + 1 {
        bail!(
            "Jacobian has unexpected dimensions: {}x{}, expected {}x{}",
            jac.nrows(),
            jac.ncols(),
            dim,
            dim + 1
        );
    }

    // Try multiple bordering directions for robustness
    // The tangent t satisfies: J * t = 0, ||t|| = 1
    // We use the bordering method: solve [J; c^T] * t = [0; 1]

    let bordering_candidates = [
        0,   // Parameter direction
        dim, // Last state component (period for LC)
        1,   // First state component
    ];

    for &idx in &bordering_candidates {
        // Build bordering vector
        let mut c = DVector::zeros(dim + 1);
        c[idx.min(dim)] = 1.0;

        // Build bordered system: [J; c^T] * t = [0; 1]
        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        for i in 0..dim {
            for j in 0..dim + 1 {
                bordered[(i, j)] = jac[(i, j)];
            }
        }
        for j in 0..dim + 1 {
            bordered[(dim, j)] = c[j];
        }

        // Right-hand side [0; 0; ...; 0; 1]
        let mut rhs = DVector::zeros(dim + 1);
        rhs[dim] = 1.0;

        // Solve using LU decomposition
        let lu = bordered.lu();
        if let Some(sol) = lu.solve(&rhs) {
            let norm = sol.norm();
            if norm > 1e-10 && sol.iter().all(|v| v.is_finite()) {
                return Ok(sol / norm);
            }
        }
    }

    // Fallback: use random-ish unit vector in nullspace approximation
    // Just pick parameter direction
    let mut tangent = DVector::zeros(dim + 1);
    tangent[0] = 1.0;
    Ok(tangent)
}

/// Corrects a predicted point using Moore-Penrose pseudo-arclength correction.
///
/// This uses a bordered pseudo-arclength corrector: solve the bordered system
/// [J; v'] * delta = [F; 0], which minimizes the correction perpendicular to the tangent.
/// Both state AND parameter are corrected.
fn correct_with_problem<P: ContinuationProblem>(
    problem: &mut P,
    prediction: &DVector<f64>,
    _prev_aug: &DVector<f64>,
    prev_tangent: &DVector<f64>,
    max_iters: usize,
    tolerance: f64,
) -> Result<Option<DVector<f64>>> {
    let dim = problem.dimension();
    let mut current = prediction.clone();

    for _iter in 0..max_iters {
        // Compute residual F(x)
        let mut residual = DVector::zeros(dim);
        problem.residual(&current, &mut residual)?;

        let res_norm = residual.norm();

        // Check convergence: F(x) should be small.
        if res_norm < tolerance {
            return Ok(Some(current));
        }

        // Get the extended Jacobian [dF/dp | dF/dx], dim x (dim+1)
        let jac = problem.extended_jacobian(&current)?;

        // Build bordered Jacobian: [J; v'] is (dim+1) x (dim+1)
        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        for i in 0..dim {
            for j in 0..(dim + 1) {
                bordered[(i, j)] = jac[(i, j)];
            }
        }
        for j in 0..(dim + 1) {
            bordered[(dim, j)] = prev_tangent[j];
        }

        // Build extended RHS: [-F; 0] to keep Newton corrections orthogonal
        // to the continuation tangent row (Moore-Penrose style corrector).
        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -residual[i];
        }
        rhs[dim] = 0.0;

        // Solve bordered system
        let lu = bordered.lu();
        if let Some(delta) = lu.solve(&rhs) {
            let delta_norm = delta.norm();

            if !delta_norm.is_finite() {
                return Ok(None);
            }

            // Damping for large steps
            let damping = if delta_norm > 1.0 {
                0.5 / delta_norm
            } else {
                1.0
            };

            // Update ALL components including parameter (clone delta for later use)
            current += &(damping * &delta);
        } else {
            return Ok(None);
        }
    }

    // Final convergence check
    let mut final_res = DVector::zeros(dim);
    problem.residual(&current, &mut final_res)?;
    let final_norm = final_res.norm();

    if final_norm < tolerance * 10.0 {
        Ok(Some(current))
    } else {
        Ok(None)
    }
}

// Types (ContinuationSettings, BifurcationType, ContinuationPoint, BranchType, ContinuationBranch)
// are now in the types module and re-exported above.

pub fn extend_branch(
    system: &mut EquationSystem,
    kind: SystemKind,
    mut branch: ContinuationBranch,
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = system.equations.len();
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

    // Find the neighbor point for secant computation
    let neighbor_idx = if forward {
        // Find second highest index
        if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_idx)
                .max_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        }
    } else {
        // Find second lowest index
        if branch.points.len() > 1 {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_idx)
                .min_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        }
    };

    let start_param = system.params[param_index];

    let mut prev_aug = continuation_point_to_aug(&prev_point);
    let mut prev_tangent = tangent_for_point(system, kind, param_index, &prev_point)?;

    // Compute secant from neighbor to endpoint and orient tangent accordingly
    if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &branch.points[neighbor_pos];
        let neighbor_aug = continuation_point_to_aug(neighbor);

        // Secant from interior neighbor to selected endpoint.
        // This preserves outward continuation on the requested signed-index side.
        let secant = &prev_aug - &neighbor_aug;

        if secant.norm() > 1e-12 {
            prev_tangent = secant.normalize();
            orient_extension_tangent(&mut prev_tangent, Some(&secant), forward);
        }
    } else {
        orient_extension_tangent(&mut prev_tangent, None, forward);
    }

    let mut prev_diag = diagnostics_from_point(system, kind, param_index, &prev_point)?;

    let mut step_size = settings.step_size;
    // Direction is now encoded in the tangent, always step forward
    let direction_sign = 1.0;

    let mut new_points_data: Vec<(ContinuationPoint, i32)> = Vec::new();

    let mut current_index = last_index;

    for _step in 0..settings.max_steps {
        // Predictor: step in tangent direction (tangent is already oriented correctly)
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector (PALC only)
        let corrected_opt = solve_palc(
            system,
            kind,
            &pred_aug,
            &prev_aug,
            &prev_tangent,
            param_index,
            settings,
        )?;

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
            system.params[param_index] = corrected_aug[0];
            let mut diagnostics =
                compute_point_diagnostics(system, kind, &corrected_aug, param_index)?;

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
                cycle_points: diagnostics.cycle_points.clone(),
            };

            let prev_tests = prev_diag.test_values;
            let fold_crossed = prev_tests.fold * diagnostics.test_values.fold < 0.0;
            let hopf_crossed = hopf_crossed_with_complex_pairs(&prev_diag, &diagnostics);
            let neutral_crossed = neutral_saddle_crossed_with_real_pairs(&prev_diag, &diagnostics);

            let mut current_tangent = new_tangent.clone();

            if fold_crossed {
                match refine_fold_point(
                    system,
                    kind,
                    param_index,
                    settings,
                    &prev_point,
                    &prev_tests,
                    &new_pt,
                    &diagnostics.test_values,
                    &prev_tangent,
                ) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        new_pt.stability = BifurcationType::Fold;
                    }
                }
                new_pt.stability = BifurcationType::Fold;
            } else if hopf_crossed && !neutral_crossed {
                match refine_hopf_point(
                    system,
                    kind,
                    param_index,
                    settings,
                    &prev_point,
                    &prev_tests,
                    &new_pt,
                    &diagnostics.test_values,
                    &prev_tangent,
                ) {
                    Ok((refined_point, refined_diag, refined_tangent)) => {
                        new_pt = refined_point;
                        diagnostics = refined_diag;
                        current_tangent = refined_tangent;
                    }
                    Err(_err) => {
                        new_pt.stability = BifurcationType::Hopf;
                    }
                }
                new_pt.stability = BifurcationType::Hopf;
            } else if hopf_crossed && neutral_crossed {
                // Detected Hopf and neutral saddle simultaneously; suppress Hopf.
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

    system.params[param_index] = start_param;

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

pub fn continue_parameter(
    system: &mut EquationSystem,
    kind: SystemKind,
    initial_state: &[f64],
    param_index: usize,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let dim = system.equations.len();
    if initial_state.len() != dim {
        bail!("Initial state dimension mismatch");
    }

    let start_param = system.params[param_index];

    let mut current_aug = DVector::zeros(dim + 1);
    current_aug[0] = start_param;
    for i in 0..dim {
        current_aug[i + 1] = initial_state[i];
    }

    let initial_diag = compute_point_diagnostics(system, kind, &current_aug, param_index)?;

    let branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: current_aug.rows(1, dim).iter().cloned().collect(),
            param_value: current_aug[0],
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
            cycle_points: initial_diag.cycle_points,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::Equilibrium,
        upoldp: None,
        homoc_context: None,
        resume_state: None,
    };

    extend_branch(system, kind, branch, param_index, settings, forward)
}

fn tangent_for_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    point: &ContinuationPoint,
) -> Result<DVector<f64>> {
    let aug = continuation_point_to_aug(point);
    let j_ext = compute_extended_jacobian(system, kind, &aug, param_index)?;
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
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    point: &ContinuationPoint,
) -> Result<PointDiagnostics> {
    let aug = continuation_point_to_aug(point);
    compute_point_diagnostics(system, kind, &aug, param_index)
}

// Tangent computation functions (compute_nullspace_tangent, try_gram_eigen,
// compute_tangent_linear_solve) and continuation_point_to_aug are now in util module.

fn refine_fold_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = system.equations.len();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_fold_newton(
        system,
        kind,
        &prev_aug,
        prev_tests.fold,
        &new_aug,
        new_tests.fold,
        param_index,
        settings,
    )?;

    let start_param = system.params[param_index];
    system.params[param_index] = refined_aug[0];
    let diagnostics = compute_point_diagnostics(system, kind, &refined_aug, param_index)?;
    let j_ext = compute_extended_jacobian(system, kind, &refined_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }
    system.params[param_index] = start_param;

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Fold,
        eigenvalues: diagnostics.eigenvalues.clone(),
        cycle_points: diagnostics.cycle_points.clone(),
    };

    Ok((point, diagnostics, tangent))
}

fn refine_hopf_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    prev_tests: &TestFunctionValues,
    new_point: &ContinuationPoint,
    new_tests: &TestFunctionValues,
    prev_tangent: &DVector<f64>,
) -> Result<(ContinuationPoint, PointDiagnostics, DVector<f64>)> {
    let dim = system.equations.len();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_hopf_newton(
        system,
        kind,
        &prev_aug,
        prev_tests.hopf,
        &new_aug,
        new_tests.hopf,
        param_index,
        settings,
    )?;

    let start_param = system.params[param_index];
    system.params[param_index] = refined_aug[0];
    let diagnostics = compute_point_diagnostics(system, kind, &refined_aug, param_index)?;
    let j_ext = compute_extended_jacobian(system, kind, &refined_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    if tangent.dot(prev_tangent) < 0.0 {
        tangent = -tangent;
    }
    system.params[param_index] = start_param;

    let point = ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        stability: BifurcationType::Hopf,
        eigenvalues: diagnostics.eigenvalues.clone(),
        cycle_points: diagnostics.cycle_points.clone(),
    };

    Ok((point, diagnostics, tangent))
}

fn solve_fold_newton(
    system: &mut EquationSystem,
    kind: SystemKind,
    prev_aug: &DVector<f64>,
    prev_fold: f64,
    new_aug: &DVector<f64>,
    new_fold: f64,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
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

    let start_param = system.params[param_index];

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current, param_index)?;
        let current_param = current[0];
        let current_state: Vec<f64> = current.rows(1, dim).iter().cloned().collect();

        let old_param = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_param;

        let diag = compute_point_diagnostics(system, kind, &current, param_index)?;
        let test_val = diag.test_values.fold;
        let f_norm = DVector::from_vec(f_val.clone()).norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }

        let grad = compute_test_gradient(system, kind, &current, param_index, &|vals| vals.fold)?;

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
            system.params[param_index] = start_param;
            return Ok(current);
        }
    }

    system.params[param_index] = start_param;
    Err(anyhow!("Fold refinement did not converge"))
}

fn solve_hopf_newton(
    system: &mut EquationSystem,
    kind: SystemKind,
    prev_aug: &DVector<f64>,
    prev_hopf: f64,
    new_aug: &DVector<f64>,
    new_hopf: f64,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
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

    let start_param = system.params[param_index];

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current, param_index)?;
        let current_param = current[0];
        let current_state: Vec<f64> = current.rows(1, dim).iter().cloned().collect();

        let old_param = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_param;

        let diag = compute_point_diagnostics(system, kind, &current, param_index)?;
        let test_val = diag.test_values.hopf;
        let f_norm = DVector::from_vec(f_val.clone()).norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }

        let grad = compute_test_gradient(system, kind, &current, param_index, &|vals| vals.hopf)?;

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
            system.params[param_index] = start_param;
            return Ok(current);
        }
    }

    system.params[param_index] = start_param;
    Err(anyhow!("Hopf refinement did not converge"))
}

fn compute_test_gradient(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
    selector: &dyn Fn(&TestFunctionValues) -> f64,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut grad = DVector::zeros(dim + 1);
    let base_eps = 1e-6;

    for i in 0..dim + 1 {
        let mut perturbed = aug_state.clone();
        let step = base_eps * (1.0 + aug_state[i].abs());
        perturbed[i] += step;
        let plus_diag = compute_point_diagnostics(system, kind, &perturbed, param_index)?;
        let plus = selector(&plus_diag.test_values);
        perturbed[i] -= 2.0 * step;
        let minus_diag = compute_point_diagnostics(system, kind, &perturbed, param_index)?;
        let minus = selector(&minus_diag.test_values);
        grad[i] = (plus - minus) / (2.0 * step);
    }

    Ok(grad)
}

fn hopf_crossed_with_complex_pairs(
    prev_diag: &PointDiagnostics,
    new_diag: &PointDiagnostics,
) -> bool {
    let prev_pairs = hopf_pair_count(&prev_diag.eigenvalues);
    let new_pairs = hopf_pair_count(&new_diag.eigenvalues);
    prev_diag.test_values.hopf * new_diag.test_values.hopf < 0.0
        && prev_pairs > 0
        && new_pairs > 0
        && prev_pairs == new_pairs
}

fn neutral_saddle_crossed_with_real_pairs(
    prev_diag: &PointDiagnostics,
    new_diag: &PointDiagnostics,
) -> bool {
    let prev_real = real_eigenvalue_count(&prev_diag.eigenvalues);
    let new_real = real_eigenvalue_count(&new_diag.eigenvalues);
    prev_diag.test_values.neutral_saddle * new_diag.test_values.neutral_saddle < 0.0
        && prev_real >= 2
        && new_real >= 2
        && prev_real == new_real
}

fn compute_point_diagnostics(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<PointDiagnostics> {
    let dim = system.equations.len();
    let param = aug_state[0];
    let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();

    let old_param = system.params[param_index];
    system.params[param_index] = param;

    let system_jac = compute_system_jacobian(system, kind, &state)?;

    system.params[param_index] = old_param;

    let mut residual_jac = system_jac.clone();
    if kind.is_map() {
        for i in 0..dim {
            residual_jac[i * dim + i] -= 1.0;
        }
    }

    let residual_mat = DMatrix::from_row_slice(dim, dim, &residual_jac);
    let fold = residual_mat.determinant();

    let eigen_mat = if kind.is_map() {
        DMatrix::from_row_slice(dim, dim, &system_jac)
    } else {
        residual_mat.clone()
    };

    let eigenvalues = compute_eigenvalues(&eigen_mat)?;
    let (hopf, neutral) = if kind.is_flow() && dim >= 2 {
        (
            hopf_test_function(&eigenvalues).re,
            neutral_saddle_test_function(&eigenvalues),
        )
    } else {
        (0.0, 0.0)
    };

    Ok(PointDiagnostics {
        test_values: TestFunctionValues::equilibrium(fold, hopf, neutral),
        eigenvalues,
        cycle_points: None,
    })
}

pub fn compute_eigenvalues_for_state(
    system: &mut EquationSystem,
    kind: SystemKind,
    state: &[f64],
    param_index: usize,
    param_value: f64,
) -> Result<Vec<Complex<f64>>> {
    let mut aug = DVector::zeros(state.len() + 1);
    aug[0] = param_value;
    for (i, &val) in state.iter().enumerate() {
        aug[i + 1] = val;
    }
    let diagnostics = compute_point_diagnostics(system, kind, &aug, param_index)?;
    Ok(diagnostics.eigenvalues)
}

// Eigenvalue and bifurcation test functions (compute_eigenvalues, hopf_test_function,
// neutral_saddle_test_function) are now in util module.

fn compute_extended_jacobian(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<DMatrix<f64>> {
    let dim = system.equations.len();
    let param = aug_state[0];
    let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();

    let mut j_ext = DMatrix::zeros(dim, dim + 1);

    let old_param = system.params[param_index];
    system.params[param_index] = param;

    let param_jac = compute_param_jacobian(system, kind, &state, param_index)?;
    for i in 0..dim {
        j_ext[(i, 0)] = param_jac[i];
    }

    system.params[param_index] = old_param;

    let jac_x = crate::equilibrium::compute_jacobian(system, kind, &state)?;
    for col in 0..dim {
        for row in 0..dim {
            // Fix: Row-Major from compute_jacobian
            j_ext[(row, col + 1)] = jac_x[row * dim + col];
        }
    }

    Ok(j_ext)
}

fn evaluate_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) -> Result<()> {
    evaluate_equilibrium_residual(system, kind, state, out)
}

fn solve_palc(
    system: &mut EquationSystem,
    kind: SystemKind,
    pred_aug: &DVector<f64>,
    _prev_aug: &DVector<f64>,
    prev_tangent: &DVector<f64>,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<Option<(DVector<f64>, DVector<f64>)>> {
    let dim = system.equations.len();
    let mut current_aug = pred_aug.clone();

    for _ in 0..settings.corrector_steps {
        let j_ext = compute_extended_jacobian(system, kind, &current_aug, param_index)?;

        let current_param = current_aug[0];
        let current_state: Vec<f64> = current_aug.rows(1, dim).iter().cloned().collect();

        let old_p = system.params[param_index];
        system.params[param_index] = current_param;
        let mut f_val = vec![0.0; dim];
        evaluate_residual(system, kind, &current_state, &mut f_val)?;
        system.params[param_index] = old_p;

        let diff = &current_aug - pred_aug;
        let constraint_val = prev_tangent.dot(&diff);

        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -f_val[i];
        }
        rhs[dim] = -constraint_val;

        if rhs.norm() < settings.corrector_tolerance {
            let j_ext_final = compute_extended_jacobian(system, kind, &current_aug, param_index)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::{DMatrix, DVector};

    #[test]
    fn test_palc_simple_fold() {
        let mut ops = Vec::new();
        ops.push(OpCode::LoadVar(0));
        ops.push(OpCode::LoadConst(2.0));
        ops.push(OpCode::Pow);
        ops.push(OpCode::LoadParam(0));
        ops.push(OpCode::Add);

        let eq = Bytecode { ops };
        let equations = vec![eq];
        let params = vec![-1.0];
        let mut system = EquationSystem::new(equations, params);

        let initial_state = vec![1.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.5,
            max_steps: 40,
            corrector_steps: 5,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let res = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true,
        );

        assert!(res.is_ok(), "Continuation failed: {:?}", res.err());
        let branch = res.unwrap();

        assert!(branch.points.len() > 1);
        assert!(branch.points[1].param_value > -1.0);
        assert!(branch.points[1].state[0] < 1.0);
    }

    /// Test Hopf normal form: dx/dt = μx - y, dy/dt = x + μy
    /// Linear part has eigenvalues μ ± i, so Hopf bifurcation at μ = 0.
    #[test]
    fn test_hopf_normal_form() {
        // Build: dx/dt = mu*x - y (equation 0)
        //        dy/dt = x + mu*y (equation 1)
        // Equilibrium at origin for all mu.
        // Eigenvalues: mu ± i => Hopf at mu = 0

        // Equation 0: mu*x - y = LoadParam(0)*LoadVar(0) - LoadVar(1)
        let eq0_ops = vec![
            OpCode::LoadParam(0), // mu
            OpCode::LoadVar(0),   // x
            OpCode::Mul,          // mu*x
            OpCode::LoadVar(1),   // y
            OpCode::Sub,          // mu*x - y
        ];

        // Equation 1: x + mu*y = LoadVar(0) + LoadParam(0)*LoadVar(1)
        let eq1_ops = vec![
            OpCode::LoadVar(0),   // x
            OpCode::LoadParam(0), // mu
            OpCode::LoadVar(1),   // y
            OpCode::Mul,          // mu*y
            OpCode::Add,          // x + mu*y
        ];

        let equations = vec![Bytecode { ops: eq0_ops }, Bytecode { ops: eq1_ops }];
        let params = vec![-0.5]; // Start at mu = -0.5 (stable)
        let mut system = EquationSystem::new(equations, params);

        // Equilibrium is at origin
        let initial_state = vec![0.0, 0.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.05,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 50,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let res = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true, // Forward: -0.5 -> positive
        );

        assert!(res.is_ok(), "Hopf NF continuation failed: {:?}", res.err());
        let branch = res.unwrap();

        // Check that we found a Hopf bifurcation
        let hopf_points: Vec<_> = branch
            .points
            .iter()
            .enumerate()
            .filter(|(_, pt)| pt.stability == BifurcationType::Hopf)
            .collect();

        // We should find at least one Hopf bifurcation
        assert!(!hopf_points.is_empty(), "Should detect Hopf bifurcation");

        // The Hopf should be near mu = 0
        let hopf_param = hopf_points[0].1.param_value;
        assert!(
            hopf_param.abs() < 0.1,
            "Hopf should be near mu=0, found at mu={:.6}",
            hopf_param
        );
    }

    #[test]
    fn test_no_hopf_when_complex_pair_becomes_real() {
        // dx/dt = -x + y
        // dy/dt = mu*x - y
        // Jacobian [[-1, 1], [mu, -1]] has eigenvalues -1 ± sqrt(mu).
        // For mu < 0: complex pair with negative real part.
        // For mu > 0: real eigenvalues with negative real parts (no Hopf).
        let eq0_ops = vec![
            OpCode::LoadConst(-1.0),
            OpCode::LoadVar(0),
            OpCode::Mul,
            OpCode::LoadVar(1),
            OpCode::Add,
        ];
        let eq1_ops = vec![
            OpCode::LoadParam(0),
            OpCode::LoadVar(0),
            OpCode::Mul,
            OpCode::LoadConst(-1.0),
            OpCode::LoadVar(1),
            OpCode::Mul,
            OpCode::Add,
        ];

        let equations = vec![Bytecode { ops: eq0_ops }, Bytecode { ops: eq1_ops }];
        let params = vec![-0.5];
        let mut system = EquationSystem::new(equations, params);

        let initial_state = vec![0.0, 0.0];
        let param_index = 0;

        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 30,
            corrector_steps: 5,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let branch = continue_parameter(
            &mut system,
            SystemKind::Flow,
            &initial_state,
            param_index,
            settings,
            true,
        )
        .expect("Continuation should succeed");

        assert!(
            branch.points.iter().any(|pt| pt.param_value > 0.0),
            "Continuation should cross into positive mu"
        );

        let hopf_points: Vec<_> = branch
            .points
            .iter()
            .filter(|pt| pt.stability == BifurcationType::Hopf)
            .collect();

        assert!(
            hopf_points.is_empty(),
            "Should not detect Hopf when complex pair becomes real"
        );

        let neutral_points: Vec<_> = branch
            .points
            .iter()
            .filter(|pt| pt.stability == BifurcationType::NeutralSaddle)
            .collect();

        assert!(
            neutral_points.is_empty(),
            "Should not detect neutral saddle when complex pair becomes real"
        );
    }

    #[derive(Default)]
    struct ZeroResidualProblem;

    impl ContinuationProblem for ZeroResidualProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, _aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    #[derive(Default)]
    struct LinearRelationProblem;

    impl ContinuationProblem for LinearRelationProblem {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = aug_state[1] - aug_state[0];
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[-1.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    fn constant_settings(max_steps: usize) -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.1,
            min_step_size: 0.1,
            max_step_size: 0.1,
            max_steps,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        }
    }

    #[test]
    fn test_runner_indices_ignore_tangent_sign_flips() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-5,
            max_step_size: 0.2,
            max_steps: 5,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            true,
        )
        .expect("runner init");

        assert!(runner.single_step().expect("first step"));
        runner.prev_tangent[0] = -runner.prev_tangent[0];
        assert!(runner.single_step().expect("second step"));

        assert_eq!(runner.branch.indices, vec![0, 1, 2]);
    }

    #[test]
    fn test_extend_branch_with_problem_normalizes_missing_indices() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = ZeroResidualProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.2,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
        };

        let extended = extend_branch_with_problem(&mut problem, branch, settings, true)
            .expect("extend branch with missing indices");

        assert_eq!(extended.points.len(), 3);
        assert_eq!(extended.indices, vec![0, 1, 2]);
    }

    #[test]
    fn test_orient_extension_tangent_biases_small_parameter_component_without_secant() {
        let mut forward_tangent = DVector::from_vec(vec![1e-12, 1.0]);
        orient_extension_tangent(&mut forward_tangent, None, true);
        assert!(
            forward_tangent[0] > 1e-3,
            "Expected forward tangent parameter component to be biased positive, got {}",
            forward_tangent[0]
        );

        let mut backward_tangent = DVector::from_vec(vec![1e-12, 1.0]);
        orient_extension_tangent(&mut backward_tangent, None, false);
        assert!(
            backward_tangent[0] < -1e-3,
            "Expected backward tangent parameter component to be biased negative, got {}",
            backward_tangent[0]
        );
    }

    #[test]
    fn test_orient_extension_tangent_with_secant_keeps_orientation_without_param_bias() {
        let mut tangent = DVector::from_vec(vec![1e-12, 1.0, 0.0]);
        let secant = DVector::from_vec(vec![-0.5, -2.0, 0.0]);

        orient_extension_tangent(&mut tangent, Some(&secant), true);

        assert!(
            tangent[0].abs() < 1e-9,
            "Expected secant-oriented tangent to preserve tiny parameter component, got {}",
            tangent[0]
        );
        assert!(
            tangent.dot(&secant) > 0.0,
            "Expected tangent to remain aligned with secant orientation"
        );
    }

    #[test]
    fn test_continuation_runner_emits_resume_state_for_endpoint() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 2,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            true,
        )
        .expect("runner init");
        runner.run_steps(2).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, 0);
        assert_eq!(min_seed.aug_state.len(), 2);
        assert_eq!(min_seed.tangent.len(), 2);
        assert!(min_seed.step_size > 0.0);

        let seed = resume.max_index_seed.expect("max seed");
        assert_eq!(seed.endpoint_index, 2);
        assert_eq!(seed.aug_state.len(), 2);
        assert_eq!(seed.tangent.len(), 2);
        assert!(seed.step_size > 0.0);
    }

    #[test]
    fn test_continuation_runner_backward_preserves_start_boundary_seed() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 2,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut runner = ContinuationRunner::new(
            ZeroResidualProblem::default(),
            initial_point,
            settings,
            false,
        )
        .expect("runner init");
        runner.run_steps(2).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, -2);
        let max_seed = resume.max_index_seed.expect("max seed");
        assert_eq!(max_seed.endpoint_index, 0);
        assert!(max_seed.step_size > 0.0);
    }

    #[test]
    fn test_continuation_runner_start_seed_uses_boundary_secant() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        };

        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        // Deliberately choose an initial tangent that is not tangent to x = p.
        let initial_tangent = DVector::from_vec(vec![1.0, 0.0]);
        let mut runner = ContinuationRunner::new_with_tangent(
            LinearRelationProblem::default(),
            initial_point,
            initial_tangent,
            settings,
        )
        .expect("runner init");
        runner.run_steps(1).expect("run steps");
        let branch = runner.take_result();

        let resume = branch.resume_state.expect("resume state");
        let min_seed = resume.min_index_seed.expect("min seed");
        assert_eq!(min_seed.endpoint_index, 0);

        // Expected boundary secant at minimum endpoint: point(0) - point(1)
        let p0 = &branch.points[0];
        let p1 = &branch.points[1];
        let mut secant = DVector::from_vec(vec![
            p0.param_value - p1.param_value,
            p0.state[0] - p1.state[0],
        ]);
        secant = secant.normalize();
        let seed_tangent = DVector::from_vec(min_seed.tangent);
        let alignment = seed_tangent.dot(&secant);
        assert!(
            alignment > 0.999,
            "expected min boundary seed tangent to follow accepted boundary secant, got alignment {}",
            alignment
        );
    }

    #[test]
    fn test_extension_uses_resume_seed_before_secant_fallback() {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 0.2,
            max_steps: 1,
            corrector_steps: 2,
            corrector_tolerance: 1e-6,
            step_tolerance: 1e-6,
        };

        let mut problem = ZeroResidualProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![0.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: Some(ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(ContinuationEndpointSeed {
                    endpoint_index: 1,
                    aug_state: vec![1.0, 0.0],
                    tangent: vec![-1.0, 0.0],
                    step_size: 0.05,
                }),
            }),
        };

        let extended = extend_branch_with_problem(&mut problem, branch, settings, true)
            .expect("extension with resume seed");
        let new_param = extended.points.last().expect("new point").param_value;
        assert!(
            new_param < 1.0,
            "resume seed should drive the first step direction, got param {}",
            new_param
        );
    }

    #[test]
    fn test_cap_extension_step_size_limits_predictor_to_local_secant_scale() {
        let mut settings = ContinuationSettings {
            step_size: 0.01,
            min_step_size: 1e-6,
            max_step_size: 0.1,
            max_steps: 20,
            corrector_steps: 8,
            corrector_tolerance: 1e-7,
            step_tolerance: 1e-7,
        };

        cap_extension_step_size(&mut settings, Some(0.003));

        assert!((settings.step_size - 0.003).abs() < 1e-12);
        assert!(settings.max_step_size >= settings.step_size);
        assert!(settings.min_step_size <= settings.step_size);
    }

    #[test]
    fn test_resume_extension_caps_first_step_to_local_secant_scale() {
        let settings = ContinuationSettings {
            step_size: 1.0,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 1,
            corrector_steps: 8,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        };

        let mut problem = LinearRelationProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![1.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![1.01],
                    param_value: 1.01,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: Some(ContinuationResumeState {
                min_index_seed: None,
                max_index_seed: Some(ContinuationEndpointSeed {
                    endpoint_index: 1,
                    aug_state: vec![1.01, 1.01],
                    tangent: vec![1.0, 1.0],
                    step_size: 0.2,
                }),
            }),
        };

        let extended =
            extend_branch_with_problem(&mut problem, branch, settings, true).expect("extension");
        let endpoint = extended.points[1].param_value;
        let next = extended.points[2].param_value;
        let delta = (next - endpoint).abs();
        assert!(
            delta < 0.05,
            "resume-seeded extension should stay local to endpoint secant scale, got {}",
            delta
        );
    }

    #[test]
    fn test_extension_first_step_locality_guard_prevents_large_nonlocal_jump() {
        let settings = ContinuationSettings {
            step_size: 1.0,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        let mut problem = LinearRelationProblem::default();
        let branch = ContinuationBranch {
            points: vec![
                ContinuationPoint {
                    state: vec![1.0],
                    param_value: 1.0,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
                ContinuationPoint {
                    state: vec![1.01],
                    param_value: 1.01,
                    stability: BifurcationType::None,
                    eigenvalues: Vec::new(),
                    cycle_points: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, 1],
            branch_type: BranchType::default(),
            upoldp: None,
            homoc_context: None,
            resume_state: None,
        };

        let extended =
            extend_branch_with_problem(&mut problem, branch, settings, true).expect("extension");
        let endpoint = extended.points[1].param_value;
        let next = extended.points[2].param_value;
        let delta = (next - endpoint).abs();
        assert!(
            delta < 0.05,
            "first extension step should remain local to the endpoint secant scale, got {}",
            delta
        );
    }

    #[test]
    fn test_extend_branch_matches_longer_continuation() {
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };

        let mut full_problem = LinearRelationProblem::default();
        let full_branch = continue_with_problem(
            &mut full_problem,
            initial_point.clone(),
            constant_settings(4),
            true,
        )
        .expect("full continuation");

        let mut short_problem = LinearRelationProblem::default();
        let short_branch = continue_with_problem(
            &mut short_problem,
            initial_point,
            constant_settings(2),
            true,
        )
        .expect("short continuation");

        let mut extend_problem = LinearRelationProblem::default();
        let extended_branch = extend_branch_with_problem(
            &mut extend_problem,
            short_branch,
            constant_settings(2),
            true,
        )
        .expect("extended continuation");

        assert_eq!(extended_branch.points.len(), full_branch.points.len());
        assert_eq!(extended_branch.indices, full_branch.indices);

        for (idx, (extended, full)) in extended_branch
            .points
            .iter()
            .zip(full_branch.points.iter())
            .enumerate()
        {
            let param_delta = (extended.param_value - full.param_value).abs();
            assert!(
                param_delta < 1e-10,
                "param mismatch at point {}: {} vs {}",
                idx,
                extended.param_value,
                full.param_value
            );
            assert_eq!(extended.state.len(), full.state.len());
            for (state_idx, (lhs, rhs)) in extended.state.iter().zip(full.state.iter()).enumerate()
            {
                let state_delta = (lhs - rhs).abs();
                assert!(
                    state_delta < 1e-10,
                    "state mismatch at point {} idx {}: {} vs {}",
                    idx,
                    state_idx,
                    lhs,
                    rhs
                );
            }
        }
    }

    fn side_endpoint_and_neighbor(branch: &ContinuationBranch, forward: bool) -> (usize, usize) {
        let endpoint_pos = if forward {
            branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("endpoint")
        } else {
            branch
                .indices
                .iter()
                .enumerate()
                .min_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("endpoint")
        };

        let neighbor_pos = if forward {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_pos)
                .max_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("neighbor")
        } else {
            branch
                .indices
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != endpoint_pos)
                .min_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .expect("neighbor")
        };

        (endpoint_pos, neighbor_pos)
    }

    #[test]
    fn test_extend_branch_respects_signed_index_side_for_all_direction_combinations() {
        let cases = [
            ("init-forward/extend-forward", true, true),
            ("init-forward/extend-backward", true, false),
            ("init-backward/extend-forward", false, true),
            ("init-backward/extend-backward", false, false),
        ];

        for (label, init_forward, extend_forward) in cases {
            let initial_point = ContinuationPoint {
                state: vec![0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
            };

            let mut init_problem = LinearRelationProblem::default();
            let seed = continue_with_problem(
                &mut init_problem,
                initial_point,
                constant_settings(2),
                init_forward,
            )
            .unwrap_or_else(|err| panic!("{}: init continuation failed: {}", label, err));

            let orig_len = seed.points.len();
            let orig_min = *seed.indices.iter().min().expect("min index");
            let orig_max = *seed.indices.iter().max().expect("max index");
            let (endpoint_pos, neighbor_pos) = side_endpoint_and_neighbor(&seed, extend_forward);
            let endpoint_param = seed.points[endpoint_pos].param_value;
            let neighbor_param = seed.points[neighbor_pos].param_value;
            let secant_param = endpoint_param - neighbor_param;
            assert!(
                secant_param.abs() > 1e-12,
                "{}: expected non-degenerate secant",
                label
            );

            let mut extend_problem = LinearRelationProblem::default();
            let extended = extend_branch_with_problem(
                &mut extend_problem,
                seed,
                constant_settings(1),
                extend_forward,
            )
            .unwrap_or_else(|err| panic!("{}: extension failed: {}", label, err));

            assert_eq!(
                extended.points.len(),
                orig_len + 1,
                "{}: expected exactly one new point",
                label
            );
            assert_eq!(
                extended.indices.len(),
                orig_len + 1,
                "{}: index count should track point count",
                label
            );

            let new_pos = orig_len;
            let new_index = extended.indices[new_pos];
            let new_param = extended.points[new_pos].param_value;
            let param_delta = new_param - endpoint_param;

            if extend_forward {
                assert_eq!(
                    new_index,
                    orig_max + 1,
                    "{}: forward extension should target max-index side",
                    label
                );
                assert_eq!(
                    *extended.indices.iter().min().expect("min index"),
                    orig_min,
                    "{}: forward extension should preserve min index bound",
                    label
                );
            } else {
                assert_eq!(
                    new_index,
                    orig_min - 1,
                    "{}: backward extension should target min-index side",
                    label
                );
                assert_eq!(
                    *extended.indices.iter().max().expect("max index"),
                    orig_max,
                    "{}: backward extension should preserve max index bound",
                    label
                );
            }

            assert!(
                param_delta * secant_param > 0.0,
                "{}: extension doubled back (delta={}, secant={})",
                label,
                param_delta,
                secant_param
            );
        }
    }
}
