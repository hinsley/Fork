use crate::autodiff::Dual;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::SystemKind;
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector, SymmetricEigen};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationPoint {
    pub state: Vec<f64>,
    pub param_value: f64,
    pub tangent: Vec<f64>, // Tangent in augmented space [param, state...]
    pub stability: BifurcationType,
    pub test_function_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuationBranch {
    pub points: Vec<ContinuationPoint>,
    pub bifurcations: Vec<usize>, // Indices of points where bifurcation was detected
    pub indices: Vec<i32>, // Explicit indices relative to start point (0)
}

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
    
    let (prev_point, last_index, is_append) = if forward {
        let max_idx_pos = branch.indices.iter().enumerate().max_by_key(|(_, &idx)| idx).unwrap().0;
        (&branch.points[max_idx_pos], branch.indices[max_idx_pos], true)
    } else {
        let min_idx_pos = branch.indices.iter().enumerate().min_by_key(|(_, &idx)| idx).unwrap().0;
        (&branch.points[min_idx_pos], branch.indices[min_idx_pos], false)
    };

    let start_param = system.params[param_index];
    
    let mut prev_aug = DVector::from_iterator(dim + 1, 
        std::iter::once(prev_point.param_value).chain(prev_point.state.iter().cloned()));
    let mut prev_tangent = DVector::from_vec(prev_point.tangent.clone());
    
    let mut step_size = settings.step_size;
    let direction_sign = if is_append { 1.0 } else { -1.0 };
    
    let mut new_points_data: Vec<(ContinuationPoint, i32)> = Vec::new();
    
    let mut current_index = last_index;

    for _step in 0..settings.max_steps {
        // Predictor
        let pred_aug = &prev_aug + &prev_tangent * (step_size * direction_sign);

        // Corrector (PALC only)
        let corrected_opt = solve_palc(
            system, 
            kind, 
            &pred_aug, 
            &prev_aug, 
            &prev_tangent, 
            param_index, 
            settings
        )?;

        if let Some((corrected_aug, new_tangent)) = corrected_opt {
            if !corrected_aug.iter().all(|v| v.is_finite()) || !new_tangent.iter().all(|v| v.is_finite()) {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }

            // Converged
            system.params[param_index] = corrected_aug[0];
            let test_val = compute_test_function(system, kind, &corrected_aug, param_index)?;

            if !test_val.is_finite() {
                step_size *= 0.5;
                if step_size < settings.min_step_size {
                    break;
                }
                continue;
            }
            
            let prev_cmp_point = if new_points_data.is_empty() {
                prev_point.clone()
            } else {
                new_points_data.last().unwrap().0.clone()
            };

            let mut new_pt = ContinuationPoint {
                state: corrected_aug.rows(1, dim).iter().cloned().collect(),
                param_value: corrected_aug[0],
                tangent: new_tangent.iter().cloned().collect(),
                test_function_value: test_val,
                stability: BifurcationType::None,
            };

            let crossed = prev_cmp_point.test_function_value * new_pt.test_function_value < 0.0;
            if crossed {
                match refine_fold_point(
                    system,
                    kind,
                    param_index,
                    settings,
                    &prev_cmp_point,
                    &new_pt,
                ) {
                    Ok(refined) => {
                        new_pt = refined;
                    }
                    Err(_err) => {
                        #[cfg(test)]
                        {
                            println!("Fold refinement failed: {:?}", _err);
                        }
                        new_pt.stability = BifurcationType::Fold;
                    }
                }
            }

            if crossed {
                new_pt.stability = BifurcationType::Fold;
            }
            
            current_index += if is_append { 1 } else { -1 };
            prev_aug = continuation_point_to_aug(&new_pt);
            prev_tangent = DVector::from_vec(new_pt.tangent.clone());
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

    let j_ext = compute_extended_jacobian(system, kind, &current_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;

    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }

    if forward {
        if tangent[0] < 0.0 { tangent = -tangent; }
    } else {
        if tangent[0] > 0.0 { tangent = -tangent; }
    }

    let initial_test = compute_test_function(system, kind, &current_aug, param_index)?;

    let branch = ContinuationBranch {
        points: vec![ContinuationPoint {
            state: current_aug.rows(1, dim).iter().cloned().collect(),
            param_value: current_aug[0],
            tangent: tangent.iter().cloned().collect(),
            stability: BifurcationType::None,
            test_function_value: initial_test,
        }],
        bifurcations: Vec::new(),
        indices: vec![0],
    };

    extend_branch(system, kind, branch, param_index, settings, true)
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
            epsilon = if epsilon == 0.0 { 1e-12 } else { epsilon * 10.0 };
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

fn refine_fold_point(
    system: &mut EquationSystem,
    kind: SystemKind,
    param_index: usize,
    settings: ContinuationSettings,
    prev_point: &ContinuationPoint,
    new_point: &ContinuationPoint,
) -> Result<ContinuationPoint> {
    let dim = system.equations.len();
    let prev_aug = continuation_point_to_aug(prev_point);
    let new_aug = continuation_point_to_aug(new_point);
    let refined_aug = solve_fold_newton(
        system,
        kind,
        &prev_aug,
        prev_point.test_function_value,
        &new_aug,
        new_point.test_function_value,
        param_index,
        settings,
    )?;

    let start_param = system.params[param_index];
    system.params[param_index] = refined_aug[0];
    let test_val = compute_test_function(system, kind, &refined_aug, param_index)?;
    let j_ext = compute_extended_jacobian(system, kind, &refined_aug, param_index)?;
    let mut tangent = compute_nullspace_tangent(&j_ext)?;
    if tangent.norm() > 0.0 {
        tangent.normalize_mut();
    }
    system.params[param_index] = start_param;

    Ok(ContinuationPoint {
        state: refined_aug.rows(1, dim).iter().cloned().collect(),
        param_value: refined_aug[0],
        tangent: tangent.iter().cloned().collect(),
        stability: BifurcationType::Fold,
        test_function_value: test_val,
    })
}

fn solve_fold_newton(
    system: &mut EquationSystem,
    kind: SystemKind,
    prev_aug: &DVector<f64>,
    prev_test: f64,
    new_aug: &DVector<f64>,
    new_test: f64,
    param_index: usize,
    settings: ContinuationSettings,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut current = prev_aug.clone();
    let denom = prev_test - new_test;
    if denom.abs() > 1e-12 {
        let mut s = prev_test / denom;
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

        let test_val = compute_test_function(system, kind, &current, param_index)?;
        let f_norm = DVector::from_vec(f_val.clone()).norm();
        if f_norm < settings.corrector_tolerance && test_val.abs() < settings.corrector_tolerance {
            system.params[param_index] = start_param;
            return Ok(current);
        }

        let grad = compute_test_gradient(system, kind, &current, param_index)?;

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

fn compute_test_gradient(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<DVector<f64>> {
    let dim = system.equations.len();
    let mut grad = DVector::zeros(dim + 1);
    let base_eps = 1e-6;

    for i in 0..dim + 1 {
        let mut perturbed = aug_state.clone();
        let step = base_eps * (1.0 + aug_state[i].abs());
        perturbed[i] += step;
        let plus = compute_test_function(system, kind, &perturbed, param_index)?;
        perturbed[i] -= 2.0 * step;
        let minus = compute_test_function(system, kind, &perturbed, param_index)?;
        grad[i] = (plus - minus) / (2.0 * step);
    }

    Ok(grad)
}

fn compute_test_function(
    system: &mut EquationSystem,
    kind: SystemKind,
    aug_state: &DVector<f64>,
    param_index: usize,
) -> Result<f64> {
    let dim = system.equations.len();
    let param = aug_state[0];
    let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();

    let old_param = system.params[param_index];
    system.params[param_index] = param;

    let jac = crate::equilibrium::compute_jacobian(system, kind, &state)?;
    
    system.params[param_index] = old_param;

    let mat = DMatrix::from_row_slice(dim, dim, &jac);
    let det = mat.determinant();

    Ok(det)
}

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

        let delta = a.lu().solve(&rhs).ok_or_else(|| anyhow!("Singular matrix in PALC corrector"))?;
        
        current_aug += &delta;
        
        if delta.norm() < settings.step_tolerance {
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, OpCode, EquationSystem};

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
        
        let res = continue_parameter(&mut system, SystemKind::Flow, &initial_state, param_index, settings, true);
        
        assert!(res.is_ok(), "Continuation failed: {:?}", res.err());
        let branch = res.unwrap();
        
        println!("Generated {} points", branch.points.len());
        for (i, pt) in branch.points.iter().enumerate() {
            println!("Pt {}: a={:.4}, x={:.4}, tan=[{:.3}, {:.3}]", 
                i, pt.param_value, pt.state[0], pt.tangent[0], pt.tangent[1]);
        }
        
        assert!(branch.points.len() > 1);
        assert!(branch.points[1].param_value > -1.0);
        assert!(branch.points[1].state[0] < 1.0);
    }
}
