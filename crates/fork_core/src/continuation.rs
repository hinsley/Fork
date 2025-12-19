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

// Re-export types needed for external use
pub use periodic::{
    CollocationConfig, LimitCycleGuess, LimitCycleSetup,
    continue_limit_cycle_collocation, extend_limit_cycle_collocation,
    limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit,
};
pub use problem::{PointDiagnostics, TestFunctionValues};
pub use types::{
    BifurcationType, BranchType, ContinuationBranch, ContinuationPoint, ContinuationSettings,
};
pub use util::{
    compute_nullspace_tangent, continuation_point_to_aug,
    compute_eigenvalues, hopf_test_function, neutral_saddle_test_function,
};

use crate::autodiff::Dual;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::SystemKind;
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use problem::ContinuationProblem;

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
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
    };
    
    // Compute initial tangent
    let mut prev_tangent = compute_tangent_from_problem(problem, &prev_aug)?;
    
    // Set direction
    let direction_sign = if forward { 1.0 } else { -1.0 };
    let mut step_size = settings.step_size;
    let mut current_index: i32 = 0;
    let mut consecutive_failures = 0;
    const MAX_CONSECUTIVE_FAILURES: usize = 20;
    
    #[cfg(test)]
    println!("Starting continuation: max_steps={}, step_size={}, min_step={}", 
             settings.max_steps, settings.step_size, settings.min_step_size);
    
    #[cfg(test)]
    {
        // Debug tangent info
        let tangent_p = prev_tangent[0];
        let tangent_period = prev_tangent[dim]; // Period component
        println!("Initial tangent: param_component={:.6}, period_component={:.6}, norm={:.6}", 
                 tangent_p, tangent_period, prev_tangent.norm());
    }
    
    for step in 0..settings.max_steps {
        // Predictor: predict along tangent
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);
        
        #[cfg(test)]
        {
            let pred_period = pred_aug[dim];
            println!("Step {}: param_pred={:.6}, period_pred={:.6}, step_size={:.6}", 
                     step, pred_aug[0], pred_period, step_size);
        }
        
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
            #[cfg(test)]
            println!("  Corrector converged: param={:.6}", corrected_aug[0]);
            
            if !corrected_aug.iter().all(|v| v.is_finite()) {
                #[cfg(test)]
                println!("  Non-finite values in corrected_aug");
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size || consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    #[cfg(test)]
                    println!("  Breaking: step_size={:.2e}, failures={}", step_size, consecutive_failures);
                    break;
                }
                continue;
            }
            
            // Compute new tangent
            let new_tangent = compute_tangent_from_problem(problem, &corrected_aug)?;
            if !new_tangent.iter().all(|v| v.is_finite()) {
                #[cfg(test)]
                println!("  Non-finite tangent");
                consecutive_failures += 1;
                step_size *= 0.5;
                if step_size < settings.min_step_size || consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    break;
                }
                continue;
            }
            
            // Ensure tangent direction consistency (sign should match prev_tangent)
            let dot_product: f64 = new_tangent.iter()
                .zip(prev_tangent.iter())
                .map(|(a, b)| a * b)
                .sum();
            let consistent_tangent = if dot_product < 0.0 {
                -new_tangent  // Flip sign to maintain direction
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
            
            // Detect limit cycle bifurcations (check LC test functions)
            let cycle_fold_crossed = prev_tests.cycle_fold * new_tests.cycle_fold <= 0.0;
            let period_doubling_crossed = prev_tests.period_doubling * new_tests.period_doubling <= 0.0;
            let neimark_sacker_crossed = prev_tests.neimark_sacker * new_tests.neimark_sacker <= 0.0;
            
            // Prioritize: CycleFold > PeriodDoubling > NeimarkSacker
            let bifurcation_type = if cycle_fold_crossed {
                BifurcationType::CycleFold
            } else if period_doubling_crossed {
                BifurcationType::PeriodDoubling
            } else if neimark_sacker_crossed {
                BifurcationType::NeimarkSacker
            } else {
                BifurcationType::None
            };
            
            // Create new point
            current_index += direction_sign as i32;
            let new_point = ContinuationPoint {
                state: corrected_aug.rows(1, dim).iter().cloned().collect(),
                param_value: corrected_aug[0],
                stability: bifurcation_type,
                eigenvalues: diagnostics.eigenvalues.clone(),
            };
            
            // Record bifurcation if detected
            if bifurcation_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }
            
            branch.points.push(new_point);
            branch.indices.push(current_index);
            
            #[cfg(test)]
            println!("  Added point {}: param={:.6}", branch.points.len(), corrected_aug[0]);
            
            // Adaptive step size - increase on success
            step_size = (step_size * 1.2).min(settings.max_step_size);
            
            prev_aug = corrected_aug;
            prev_tangent = consistent_tangent;
            prev_diag = diagnostics;
        } else {
            // Failed to converge, reduce step size
            #[cfg(test)]
            println!("  Corrector failed to converge");
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size || consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                #[cfg(test)]
                println!("  Breaking: step_size={:.2e}, failures={}", step_size, consecutive_failures);
                break;
            }
        }
    }
    
    Ok(branch)
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
    
    // Get the endpoint to continue from based on forward/backward
    // forward=true means append to the end (max index), forward=false means prepend (min index)
    let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
        let max_idx_pos = branch.indices.iter().enumerate()
            .max_by_key(|(_, &idx)| idx).unwrap().0;
        // Find the previous point (second highest index)
        let prev_idx_pos = if branch.points.len() > 1 {
            branch.indices.iter().enumerate()
                .filter(|(i, _)| *i != max_idx_pos)
                .max_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        };
        (max_idx_pos, branch.indices[max_idx_pos], prev_idx_pos, true)
    } else {
        let min_idx_pos = branch.indices.iter().enumerate()
            .min_by_key(|(_, &idx)| idx).unwrap().0;
        // Find the next point (second lowest index)  
        let next_idx_pos = if branch.points.len() > 1 {
            branch.indices.iter().enumerate()
                .filter(|(i, _)| *i != min_idx_pos)
                .min_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        };
        (min_idx_pos, branch.indices[min_idx_pos], next_idx_pos, false)
    };
    
    let endpoint = &branch.points[endpoint_idx];
    
    // Build augmented state for endpoint
    let dim = problem.dimension();
    let mut end_aug = DVector::zeros(dim + 1);
    if endpoint.state.len() != dim {
        anyhow::bail!("Dimension mismatch: branch point state has length {}, problem expects {}", endpoint.state.len(), dim);
    }
    end_aug[0] = endpoint.param_value;
    for (i, &v) in endpoint.state.iter().enumerate() {
        end_aug[i + 1] = v;
    }
    
    // Compute secant direction from neighbor to endpoint if we have two points
    let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = &branch.points[neighbor_pos];
        let mut neighbor_aug = DVector::zeros(dim + 1);
        neighbor_aug[0] = neighbor.param_value;
        for (i, &v) in neighbor.state.iter().enumerate() {
            neighbor_aug[i + 1] = v;
        }
        
        // Secant from neighbor to endpoint (the direction we were going)
        let secant = if is_append {
            &end_aug - &neighbor_aug  // From neighbor to endpoint
        } else {
            &neighbor_aug - &end_aug  // From endpoint to neighbor (reversed for prepend)
        };
        
        if secant.norm() > 1e-12 {
            Some(secant.normalize())
        } else {
            None
        }
    } else {
        None
    };
    
    // Compute tangent at endpoint
    let mut tangent = compute_tangent_from_problem(problem, &end_aug)?;
    
    // Orient tangent to match secant direction (or use forward flag if no secant)
    if let Some(secant) = secant_direction {
        // Orient tangent to have positive dot product with secant
        if tangent.dot(&secant) < 0.0 {
            tangent = -tangent;
        }
    } else {
        // Fall back to forward flag if only one point
        if !is_append {
            tangent = -tangent;
        }
    }
    
    // Now run continuation with the correctly oriented tangent
    let initial_point = ContinuationPoint {
        state: endpoint.state.clone(),
        param_value: endpoint.param_value,
        stability: endpoint.stability.clone(),
        eigenvalues: endpoint.eigenvalues.clone(),
    };
    
    // Use continue_with_initial_tangent to preserve direction
    let extension = continue_with_initial_tangent(
        problem, 
        initial_point, 
        tangent.clone(),
        settings
    )?;
    
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
    
    // Initialize branch with starting point
    let initial_diag = problem.diagnostics(&prev_aug)?;
    let mut prev_diag = initial_diag.clone();
    let mut branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: initial_point.state.clone(),
            param_value: initial_point.param_value,
            stability: BifurcationType::None,
            eigenvalues: initial_diag.eigenvalues,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::default(),
        upoldp: None,
    };
    
    // Use provided tangent (already oriented correctly)
    let mut prev_tangent = initial_tangent;
    if prev_tangent.norm() < 1e-12 {
        prev_tangent = compute_tangent_from_problem(problem, &prev_aug)?;
    }
    
    let mut step_size = settings.step_size;
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
                if step_size < settings.min_step_size || consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
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
            
            // Detect limit cycle bifurcations (check LC test functions)
            let cycle_fold_crossed = prev_tests.cycle_fold * new_tests.cycle_fold < 0.0;
            let period_doubling_crossed = prev_tests.period_doubling * new_tests.period_doubling < 0.0;
            let neimark_sacker_crossed = prev_tests.neimark_sacker * new_tests.neimark_sacker < 0.0;
            
            // Prioritize: CycleFold > PeriodDoubling > NeimarkSacker
            let bifurcation_type = if cycle_fold_crossed {
                BifurcationType::CycleFold
            } else if period_doubling_crossed {
                BifurcationType::PeriodDoubling
            } else if neimark_sacker_crossed {
                BifurcationType::NeimarkSacker
            } else {
                BifurcationType::None
            };
            
            // If bifurcation detected, refine its location via bisection
            // NOTE: Newton refinement with finite differences for test function gradients
            // could also be used here for faster convergence, but bisection is simpler
            // and more robust for the high-dimensional LC collocation problems.
            let (final_aug, final_diag, final_bif_type) = if bifurcation_type != BifurcationType::None {
                // Refine using bisection between prev_aug and corrected_aug
                match refine_lc_bifurcation_bisection(
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
                    Ok((refined_aug, refined_diag)) => (refined_aug, refined_diag, bifurcation_type),
                    Err(_) => {
                        // Refinement failed, use the unrefined point
                        (corrected_aug.clone(), diag.clone(), bifurcation_type)
                    }
                }
            } else {
                (corrected_aug.clone(), diag.clone(), BifurcationType::None)
            };
            
            // Create new point with potentially refined state
            current_index += 1;
            let new_pt = ContinuationPoint {
                state: final_aug.rows(1, dim).iter().cloned().collect(),
                param_value: final_aug[0],
                stability: final_bif_type,
                eigenvalues: final_diag.eigenvalues.clone(),
            };
            
            // Record bifurcation if detected
            if final_bif_type != BifurcationType::None {
                branch.bifurcations.push(branch.points.len());
            }
            
            branch.points.push(new_pt);
            branch.indices.push(current_index);
            
            // Update problem state if needed (use original corrected_aug for continuation)
            problem.update_after_step(&corrected_aug)?;
            
            prev_aug = corrected_aug;
            prev_tangent = new_tangent;
            prev_diag = diag;
            
            // Adaptive step size
            step_size = (step_size * 1.2).min(settings.max_step_size);
        } else {
            consecutive_failures += 1;
            step_size *= 0.5;
            if step_size < settings.min_step_size || consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                break;
            }
        }
    }
    
    Ok(branch)
}

/// Refines a limit cycle bifurcation point using bisection.
/// 
/// This function bisects between `prev_aug` and `new_aug` to find the point where
/// the specified test function crosses zero. At each bisection step, the interpolated
/// point is corrected back onto the solution manifold using Newton's method.
///
/// # Arguments
/// * `problem` - The continuation problem (provides residual, Jacobian, diagnostics)
/// * `prev_aug` - Augmented state before the bifurcation (test function has one sign)
/// * `prev_tests` - Test function values at prev_aug
/// * `new_aug` - Augmented state after the bifurcation (test function has opposite sign)
/// * `new_tests` - Test function values at new_aug
/// * `bif_type` - The type of bifurcation being refined
/// * `tangent` - Tangent direction for the corrector
/// * `corrector_steps` - Max Newton corrector iterations
/// * `tolerance` - Convergence tolerance
///
/// # Note
/// Newton refinement (solving the augmented system [F=0, ψ=0] with test function gradient
/// computed via finite differences) could provide faster (quadratic) convergence but requires
/// dim+1 extra monodromy evaluations per iteration. Bisection is simpler and sufficient
/// for most applications.
fn refine_lc_bifurcation_bisection<P: ContinuationProblem>(
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
    
    let mut best_aug = if lo_test.abs() < hi_test.abs() { lo_aug.clone() } else { hi_aug.clone() };
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
        bail!("Jacobian has unexpected dimensions: {}x{}, expected {}x{}", 
              jac.nrows(), jac.ncols(), dim, dim + 1);
    }
    
    // Try multiple bordering directions for robustness
    // The tangent t satisfies: J * t = 0, ||t|| = 1
    // We use the bordering method: solve [J; c^T] * t = [0; 1]
    
    let bordering_candidates = [
        0,  // Parameter direction
        dim, // Last state component (period for LC)
        1,  // First state component
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
/// This follows MATCONT's newtcorr style: solve the bordered system
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
    
    #[cfg(test)]
    println!("    Corrector: dim={}, max_iters={}, tol={:.2e}", dim, max_iters, tolerance);
    
    // Use adaptive tangent for bordering - start with prev_tangent
    let mut border_tangent = prev_tangent.clone();
    
    for iter in 0..max_iters {
        // Compute residual F(x)
        let mut residual = DVector::zeros(dim);
        problem.residual(&current, &mut residual)?;
        
        let res_norm = residual.norm();
        
        #[cfg(test)]
        if iter == 0 || (iter + 1) % 5 == 0 {
            println!("    Iter {}: res_norm={:.6e}", iter, res_norm);
        }
        
        // Check convergence: F(x) should be small
        if res_norm < tolerance {
            #[cfg(test)]
            println!("    Converged at iter {} with res_norm={:.6e}", iter, res_norm);
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
            bordered[(dim, j)] = border_tangent[j];
        }
        
        // Build extended RHS: [-F; 0]
        let mut rhs = DVector::zeros(dim + 1);
        for i in 0..dim {
            rhs[i] = -residual[i];
        }
        rhs[dim] = 0.0;  // Tangent constraint: tangent . delta = 0
        
        // Solve bordered system
        let lu = bordered.lu();
        if let Some(delta) = lu.solve(&rhs) {
            let delta_norm = delta.norm();
            
            #[cfg(test)]
            if iter == 0 {
                println!("    Delta norm: {:.2e}", delta_norm);
            }
            
            if !delta_norm.is_finite() {
                #[cfg(test)]
                println!("    Delta norm non-finite at iter {}", iter);
                return Ok(None);
            }
            
            // Damping for large steps
            let damping = if delta_norm > 1.0 { 0.5 / delta_norm } else { 1.0 };
            
            // Update ALL components including parameter (clone delta for later use)
            current += &(damping * &delta);
            
            // Ensure period stays positive
            let period_val = current[dim];
            if period_val <= 0.1 {
                #[cfg(test)]
                println!("    Period went too low ({}), clamping", period_val);
                current[dim] = 0.5;  // Reset to reasonable value
            }
            
            // Update tangent estimate for next iteration if delta is reasonable
            if delta_norm > 1e-10 && delta_norm < 1e5 {
                border_tangent = delta.clone() / delta_norm;
            }
        } else {
            #[cfg(test)]
            println!("    LU solve failed at iter {}", iter);
            return Ok(None);
        }
    }
    
    // Final convergence check
    let mut final_res = DVector::zeros(dim);
    problem.residual(&current, &mut final_res)?;
    let final_norm = final_res.norm();
    
    #[cfg(test)]
    println!("    Final check: res_norm={:.6e}, tol*10={:.6e}", final_norm, tolerance * 10.0);
    
    if final_norm < tolerance * 10.0 {
        Ok(Some(current))
    } else {
        #[cfg(test)]
        println!("    Did not converge: final_norm={:.6e} > {:.6e}", final_norm, tolerance * 10.0);
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
            branch.indices.iter().enumerate()
                .filter(|(i, _)| *i != endpoint_idx)
                .max_by_key(|(_, &idx)| idx)
                .map(|(i, _)| i)
        } else {
            None
        }
    } else {
        // Find second lowest index
        if branch.points.len() > 1 {
            branch.indices.iter().enumerate()
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
        
        // Secant from neighbor to endpoint (the direction we were going)
        let secant = if is_append {
            &prev_aug - &neighbor_aug  // From neighbor to endpoint
        } else {
            &neighbor_aug - &prev_aug  // From endpoint to neighbor (reversed for prepend)
        };
        
        // Orient tangent to match secant direction
        if secant.norm() > 1e-12 && prev_tangent.dot(&secant) < 0.0 {
            prev_tangent = -prev_tangent;
        }
    } else {
        // Fall back to forward flag if only one point
        if !is_append {
            prev_tangent = -prev_tangent;
        }
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
            };

            let prev_tests = prev_diag.test_values;
            let fold_crossed = prev_tests.fold * diagnostics.test_values.fold < 0.0;
            let hopf_crossed = prev_tests.hopf * diagnostics.test_values.hopf < 0.0;
            let neutral_crossed =
                prev_tests.neutral_saddle * diagnostics.test_values.neutral_saddle < 0.0;

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
                        #[cfg(test)]
                        {
                            println!("Fold refinement failed: {:?}", _err);
                        }
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
                        #[cfg(test)]
                        {
                            println!("Hopf refinement failed: {:?}", _err);
                        }
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
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
        branch_type: BranchType::Equilibrium,
        upoldp: None,
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
        evaluate_residual(system, kind, &current_state, &mut f_val);
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
        evaluate_residual(system, kind, &current_state, &mut f_val);
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

    let jac = crate::equilibrium::compute_jacobian(system, kind, &state)?;

    system.params[param_index] = old_param;

    let mat = DMatrix::from_row_slice(dim, dim, &jac);
    let fold = mat.determinant();

    let eigenvalues = compute_eigenvalues(&mat)?;
    let (hopf, neutral) = if matches!(kind, SystemKind::Flow) && dim >= 2 {
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

    let mut f_dual = vec![Dual::new(0.0, 0.0); dim];
    system.evaluate_dual_wrt_param(&state, param_index, &mut f_dual);

    for i in 0..dim {
        j_ext[(i, 0)] = f_dual[i].eps;
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

fn evaluate_residual(system: &EquationSystem, kind: SystemKind, state: &[f64], out: &mut [f64]) {
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map => {
            system.apply(0.0, state, out);
            for i in 0..out.len() {
                out[i] -= state[i];
            }
        }
    }
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
        evaluate_residual(system, kind, &current_state, &mut f_val);
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

        println!("Generated {} points", branch.points.len());
        for (i, pt) in branch.points.iter().enumerate() {
            println!(
                "Pt {}: a={:.4}, x={:.4}",
                i, pt.param_value, pt.state[0]
            );
        }

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
            OpCode::LoadParam(0),  // mu
            OpCode::LoadVar(0),    // x
            OpCode::Mul,           // mu*x
            OpCode::LoadVar(1),    // y
            OpCode::Sub,           // mu*x - y
        ];
        
        // Equation 1: x + mu*y = LoadVar(0) + LoadParam(0)*LoadVar(1)
        let eq1_ops = vec![
            OpCode::LoadVar(0),    // x
            OpCode::LoadParam(0),  // mu
            OpCode::LoadVar(1),    // y
            OpCode::Mul,           // mu*y
            OpCode::Add,           // x + mu*y
        ];

        let equations = vec![
            Bytecode { ops: eq0_ops },
            Bytecode { ops: eq1_ops },
        ];
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

        println!("Hopf NF: Generated {} points", branch.points.len());
        
        // Check that we found a Hopf bifurcation
        let hopf_points: Vec<_> = branch.points.iter()
            .enumerate()
            .filter(|(_, pt)| pt.stability == BifurcationType::Hopf)
            .collect();
        
        println!("Found {} Hopf points", hopf_points.len());
        for (i, pt) in &hopf_points {
            println!("  Point {}: mu = {:.6}", i, pt.param_value);
        }

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
}
