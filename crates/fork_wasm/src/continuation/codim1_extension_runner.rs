//! Codimension-1 curve branch extension runner.

use crate::system::build_system;
use super::shared::compute_tangent_from_problem;
use fork_core::continuation::codim1_curves::estimate_hopf_kappa_from_jacobian;
use fork_core::continuation::{
    ContinuationPoint, ContinuationRunner, ContinuationSettings, FoldCurveProblem, HopfCurveProblem,
    LPCCurveProblem, NSCurveProblem, PDCurveProblem,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::{compute_jacobian, SystemKind};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
enum Codim1BranchType {
    FoldCurve {
        param1_name: String,
        param2_name: String,
    },
    HopfCurve {
        param1_name: String,
        param2_name: String,
    },
    LPCCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
    },
    PDCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
    },
    NSCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
    },
}

impl Codim1BranchType {
    fn param_names(&self) -> (&str, &str) {
        match self {
            Codim1BranchType::FoldCurve {
                param1_name,
                param2_name,
            }
            | Codim1BranchType::HopfCurve {
                param1_name,
                param2_name,
            }
            | Codim1BranchType::LPCCurve {
                param1_name,
                param2_name,
                ..
            }
            | Codim1BranchType::PDCurve {
                param1_name,
                param2_name,
                ..
            }
            | Codim1BranchType::NSCurve {
                param1_name,
                param2_name,
                ..
            } => (param1_name.as_str(), param2_name.as_str()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Codim1BranchPoint {
    state: Vec<f64>,
    param_value: f64,
    #[serde(default)]
    param2_value: Option<f64>,
    #[serde(default)]
    stability: Option<String>,
    #[serde(default)]
    eigenvalues: Vec<Complex<f64>>,
    #[serde(default)]
    auxiliary: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Codim1BranchData {
    points: Vec<Codim1BranchPoint>,
    #[serde(default)]
    bifurcations: Vec<usize>,
    #[serde(default)]
    indices: Vec<i32>,
    branch_type: Codim1BranchType,
}

struct ExtensionMergeContext {
    branch: Codim1BranchData,
    index_offset: i32,
    sign: i32,
}

enum Codim1ExtensionRunnerKind {
    Fold {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<FoldCurveProblem<'static>>,
        merge: ExtensionMergeContext,
        dim: usize,
    },
    Hopf {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<HopfCurveProblem<'static>>,
        merge: ExtensionMergeContext,
        dim: usize,
    },
    LPC {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<LPCCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    PD {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<PDCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    NS {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<NSCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
}

#[wasm_bindgen]
pub struct WasmCodim1CurveExtensionRunner {
    runner: Option<Codim1ExtensionRunnerKind>,
}

#[wasm_bindgen]
impl WasmCodim1CurveExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        branch_val: JsValue,
        _parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmCodim1CurveExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut branch: Codim1BranchData = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

        if branch.points.is_empty() {
            return Err(JsValue::from_str("Branch has no points"));
        }

        if branch.indices.len() != branch.points.len() {
            branch.indices = (0..branch.points.len() as i32).collect();
        }

        let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
            let max_idx_pos = branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
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
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
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
            (min_idx_pos, branch.indices[min_idx_pos], next_idx_pos, false)
        };

        let sign = if is_append { 1 } else { -1 };
        let merge = ExtensionMergeContext {
            branch,
            index_offset: last_index,
            sign,
        };

        let endpoint = merge
            .branch
            .points
            .get(endpoint_idx)
            .cloned()
            .ok_or_else(|| JsValue::from_str("Branch endpoint missing"))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let (param1_name, param2_name) = merge.branch.branch_type.param_names();
        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        let runner_kind = match &merge.branch.branch_type {
            Codim1BranchType::FoldCurve { .. } => {
                let dim = system.equations.len();
                let endpoint_state = endpoint.state.clone();
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("Fold curve point missing param2_value"))?;

                system.params[param1_index] = endpoint.param_value;
                system.params[param2_index] = endpoint_param2;

                let end_state =
                    build_fold_state(&endpoint, endpoint_param2, dim).map_err(to_js_error)?;

                let mut end_aug = DVector::zeros(end_state.len() + 1);
                end_aug[0] = endpoint.param_value;
                for (i, v) in end_state.iter().enumerate() {
                    end_aug[i + 1] = *v;
                }

                let secant = build_secant_direction(
                    &merge.branch,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| build_fold_state(pt, pt.param2_value.unwrap_or(endpoint_param2), dim),
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = FoldCurveProblem::new(
                    unsafe { &mut *system_ptr },
                    kind,
                    &endpoint_state,
                    param1_index,
                    param2_index,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

                let mut problem: FoldCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                orient_tangent(&mut tangent, secant.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

                Codim1ExtensionRunnerKind::Fold {
                    _system: boxed_system,
                    runner,
                    merge,
                    dim,
                }
            }
            Codim1BranchType::HopfCurve { .. } => {
                let dim = system.equations.len();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Hopf curve point state has length {}, expected {}",
                        endpoint.state.len(),
                        dim
                    )));
                }
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("Hopf curve point missing param2_value"))?;

                system.params[param1_index] = endpoint.param_value;
                system.params[param2_index] = endpoint_param2;

                let (kappa, hopf_omega) = resolve_hopf_kappa_and_omega(
                    &mut system,
                    kind,
                    &endpoint,
                    endpoint_param2,
                    param1_index,
                    param2_index,
                )?;

                let end_state = build_hopf_state(&endpoint, endpoint_param2, kappa, dim);
                let mut end_aug = DVector::zeros(end_state.len() + 1);
                end_aug[0] = endpoint.param_value;
                for (i, v) in end_state.iter().enumerate() {
                    end_aug[i + 1] = *v;
                }

                let secant = build_secant_direction(
                    &merge.branch,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| {
                        let param2 = pt.param2_value.unwrap_or(endpoint_param2);
                        let pt_kappa = resolve_hopf_kappa_from_point(pt, kappa);
                        Ok(build_hopf_state(pt, param2, pt_kappa, dim))
                    },
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = HopfCurveProblem::new(
                    unsafe { &mut *system_ptr },
                    kind,
                    &endpoint.state,
                    hopf_omega,
                    param1_index,
                    param2_index,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create hopf problem: {}", e)))?;

                let mut problem: HopfCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                orient_tangent(&mut tangent, secant.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

                Codim1ExtensionRunnerKind::Hopf {
                    _system: boxed_system,
                    runner,
                    merge,
                    dim,
                }
            }
            Codim1BranchType::LPCCurve { ntst, ncol, .. } => {
                let dim = system.equations.len();
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("LPC curve point missing param2_value"))?;
                let (full_lc_state, period) =
                    unpack_lc_state(&endpoint.state, *ntst, *ncol, dim, LcLayout::StageFirst)
                        .map_err(to_js_error)?;

                system.params[param1_index] = endpoint.param_value;
                system.params[param2_index] = endpoint_param2;

                let end_state = build_lc_state(&full_lc_state, period, endpoint_param2);
                let mut end_aug = DVector::zeros(end_state.len() + 1);
                end_aug[0] = endpoint.param_value;
                for (i, v) in end_state.iter().enumerate() {
                    end_aug[i + 1] = *v;
                }

                let secant = build_secant_direction(
                    &merge.branch,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| {
                        let param2 = pt.param2_value.unwrap_or(endpoint_param2);
                        let (lc_state, pt_period) = unpack_lc_state(
                            &pt.state,
                            *ntst,
                            *ncol,
                            dim,
                            LcLayout::StageFirst,
                        )?;
                        Ok(build_lc_state(&lc_state, pt_period, param2))
                    },
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = LPCCurveProblem::new(
                    unsafe { &mut *system_ptr },
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    *ntst,
                    *ncol,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create LPC problem: {}", e)))?;

                let mut problem: LPCCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                orient_tangent(&mut tangent, secant.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

                Codim1ExtensionRunnerKind::LPC {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
            Codim1BranchType::PDCurve { ntst, ncol, .. } => {
                let dim = system.equations.len();
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("PD curve point missing param2_value"))?;
                let (full_lc_state, period) =
                    unpack_lc_state(&endpoint.state, *ntst, *ncol, dim, LcLayout::MeshFirst)
                        .map_err(to_js_error)?;

                system.params[param1_index] = endpoint.param_value;
                system.params[param2_index] = endpoint_param2;

                let end_state = build_lc_state(&full_lc_state, period, endpoint_param2);
                let mut end_aug = DVector::zeros(end_state.len() + 1);
                end_aug[0] = endpoint.param_value;
                for (i, v) in end_state.iter().enumerate() {
                    end_aug[i + 1] = *v;
                }

                let secant = build_secant_direction(
                    &merge.branch,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| {
                        let param2 = pt.param2_value.unwrap_or(endpoint_param2);
                        let (lc_state, pt_period) = unpack_lc_state(
                            &pt.state,
                            *ntst,
                            *ncol,
                            dim,
                            LcLayout::MeshFirst,
                        )?;
                        Ok(build_lc_state(&lc_state, pt_period, param2))
                    },
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = PDCurveProblem::new(
                    unsafe { &mut *system_ptr },
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    *ntst,
                    *ncol,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create PD problem: {}", e)))?;

                let mut problem: PDCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                orient_tangent(&mut tangent, secant.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

                Codim1ExtensionRunnerKind::PD {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
            Codim1BranchType::NSCurve { ntst, ncol, .. } => {
                let dim = system.equations.len();
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("NS curve point missing param2_value"))?;
                let endpoint_k = endpoint
                    .auxiliary
                    .ok_or_else(|| JsValue::from_str("NS curve point missing auxiliary k value"))?;
                let (full_lc_state, period) =
                    unpack_lc_state(&endpoint.state, *ntst, *ncol, dim, LcLayout::StageFirst)
                        .map_err(to_js_error)?;

                system.params[param1_index] = endpoint.param_value;
                system.params[param2_index] = endpoint_param2;

                let end_state = build_ns_state(&full_lc_state, period, endpoint_param2, endpoint_k);
                let mut end_aug = DVector::zeros(end_state.len() + 1);
                end_aug[0] = endpoint.param_value;
                for (i, v) in end_state.iter().enumerate() {
                    end_aug[i + 1] = *v;
                }

                let secant = build_secant_direction(
                    &merge.branch,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| {
                        let param2 = pt.param2_value.unwrap_or(endpoint_param2);
                        let k_value = pt.auxiliary.unwrap_or(endpoint_k);
                        let (lc_state, pt_period) = unpack_lc_state(
                            &pt.state,
                            *ntst,
                            *ncol,
                            dim,
                            LcLayout::StageFirst,
                        )?;
                        Ok(build_ns_state(&lc_state, pt_period, param2, k_value))
                    },
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = NSCurveProblem::new(
                    unsafe { &mut *system_ptr },
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    endpoint_k,
                    *ntst,
                    *ncol,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create NS problem: {}", e)))?;

                let mut problem: NSCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                orient_tangent(&mut tangent, secant.as_ref(), forward);

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

                Codim1ExtensionRunnerKind::NS {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
        };

        Ok(WasmCodim1CurveExtensionRunner {
            runner: Some(runner_kind),
        })
    }

    pub fn is_done(&self) -> bool {
        match self.runner.as_ref() {
            Some(Codim1ExtensionRunnerKind::Fold { runner, .. }) => runner.is_done(),
            Some(Codim1ExtensionRunnerKind::Hopf { runner, .. }) => runner.is_done(),
            Some(Codim1ExtensionRunnerKind::LPC { runner, .. }) => runner.is_done(),
            Some(Codim1ExtensionRunnerKind::PD { runner, .. }) => runner.is_done(),
            Some(Codim1ExtensionRunnerKind::NS { runner, .. }) => runner.is_done(),
            None => true,
        }
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_mut() {
            Some(Codim1ExtensionRunnerKind::Fold { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(Codim1ExtensionRunnerKind::Hopf { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(Codim1ExtensionRunnerKind::LPC { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(Codim1ExtensionRunnerKind::PD { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(Codim1ExtensionRunnerKind::NS { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_ref() {
            Some(Codim1ExtensionRunnerKind::Fold { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::Hopf { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::LPC { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::PD { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::NS { runner, .. }) => runner.step_result(),
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner_kind = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let (extension, mut merge, curve_dim) = match runner_kind {
            Codim1ExtensionRunnerKind::Fold { runner, merge, dim, .. } => {
                (runner.take_result(), merge, CurveDim::Equilibrium(dim))
            }
            Codim1ExtensionRunnerKind::Hopf { runner, merge, dim, .. } => {
                (runner.take_result(), merge, CurveDim::Equilibrium(dim))
            }
            Codim1ExtensionRunnerKind::LPC { runner, merge, .. } => {
                (runner.take_result(), merge, CurveDim::LimitCycle)
            }
            Codim1ExtensionRunnerKind::PD { runner, merge, .. } => {
                (runner.take_result(), merge, CurveDim::LimitCycle)
            }
            Codim1ExtensionRunnerKind::NS { runner, merge, .. } => {
                (runner.take_result(), merge, CurveDim::LimitCycle)
            }
        };

        let ExtensionMergeContext {
            index_offset,
            sign,
            ..
        } = merge;

        for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
            let converted = convert_extension_point(&merge.branch.branch_type, &pt, curve_dim)?;
            merge.branch.points.push(converted);
            let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
            merge.branch.indices.push(index_offset + idx * sign);
        }

        to_value(&merge.branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[derive(Clone, Copy)]
enum CurveDim {
    Equilibrium(usize),
    LimitCycle,
}

fn orient_tangent(tangent: &mut DVector<f64>, secant: Option<&DVector<f64>>, forward: bool) {
    if let Some(secant) = secant {
        if tangent.dot(secant) < 0.0 {
            *tangent = -tangent.clone();
        }
    } else {
        let forward_sign = if forward { 1.0 } else { -1.0 };
        if tangent[0] * forward_sign < 0.0 {
            *tangent = -tangent.clone();
        }
    }
}

fn to_js_error(err: anyhow::Error) -> JsValue {
    JsValue::from_str(&format!("{}", err))
}

fn build_fold_state(
    point: &Codim1BranchPoint,
    param2_value: f64,
    dim: usize,
) -> anyhow::Result<Vec<f64>> {
    if point.state.len() != dim {
        anyhow::bail!(
            "Fold curve point state has length {}, expected {}",
            point.state.len(),
            dim
        );
    }
    let mut state = Vec::with_capacity(dim + 1);
    state.push(param2_value);
    state.extend_from_slice(&point.state);
    Ok(state)
}

fn build_hopf_state(
    point: &Codim1BranchPoint,
    param2_value: f64,
    kappa: f64,
    dim: usize,
) -> Vec<f64> {
    let mut state = Vec::with_capacity(dim + 2);
    state.push(param2_value);
    state.extend_from_slice(&point.state);
    state.push(kappa);
    state
}

fn build_lc_state(lc_state: &[f64], period: f64, param2_value: f64) -> Vec<f64> {
    let mut state = Vec::with_capacity(lc_state.len() + 2);
    state.extend_from_slice(lc_state);
    state.push(period);
    state.push(param2_value);
    state
}

fn build_ns_state(
    lc_state: &[f64],
    period: f64,
    param2_value: f64,
    k_value: f64,
) -> Vec<f64> {
    let mut state = Vec::with_capacity(lc_state.len() + 3);
    state.extend_from_slice(lc_state);
    state.push(period);
    state.push(param2_value);
    state.push(k_value);
    state
}

enum LcLayout {
    StageFirst,
    MeshFirst,
}

fn unpack_lc_state(
    state_with_period: &[f64],
    ntst: usize,
    ncol: usize,
    dim: usize,
    layout: LcLayout,
) -> anyhow::Result<(Vec<f64>, f64)> {
    if state_with_period.is_empty() {
        anyhow::bail!("LC curve point state is empty");
    }
    let period = *state_with_period
        .last()
        .ok_or_else(|| anyhow::anyhow!("LC curve missing period"))?;
    let lc_state = &state_with_period[..state_with_period.len() - 1];

    let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
    let implicit_ncoords = ntst * ncol * dim + ntst * dim;

    let full_lc_state = if lc_state.len() == expected_ncoords {
        lc_state.to_vec()
    } else if lc_state.len() == implicit_ncoords {
        match layout {
            LcLayout::StageFirst => {
                let stages_len = ntst * ncol * dim;
                if lc_state.len() < stages_len + dim {
                    anyhow::bail!("LC state is too short to infer mesh point");
                }
                let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
                let mut padded = lc_state.to_vec();
                padded.extend(u0);
                padded
            }
            LcLayout::MeshFirst => {
                let mesh_end = ntst * dim;
                if lc_state.len() < mesh_end + dim {
                    anyhow::bail!("LC state is too short to infer mesh point");
                }
                let u0: Vec<f64> = lc_state[0..dim].to_vec();
                let mut padded = Vec::with_capacity(lc_state.len() + dim);
                padded.extend_from_slice(&lc_state[0..mesh_end]);
                padded.extend_from_slice(&u0);
                padded.extend_from_slice(&lc_state[mesh_end..]);
                padded
            }
        }
    } else {
        anyhow::bail!(
            "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
            lc_state.len(),
            expected_ncoords,
            implicit_ncoords,
            ntst,
            ncol,
            dim
        );
    };

    Ok((full_lc_state, period))
}

fn build_secant_direction<F>(
    branch: &Codim1BranchData,
    neighbor_idx: Option<usize>,
    end_aug: &DVector<f64>,
    is_append: bool,
    mut state_builder: F,
) -> Result<Option<DVector<f64>>, JsValue>
where
    F: FnMut(&Codim1BranchPoint) -> anyhow::Result<Vec<f64>>,
{
    let secant = if let Some(neighbor_pos) = neighbor_idx {
        let neighbor = branch
            .points
            .get(neighbor_pos)
            .ok_or_else(|| JsValue::from_str("Branch neighbor missing"))?;
        let neighbor_state = state_builder(neighbor).map_err(to_js_error)?;
        let mut neighbor_aug = DVector::zeros(neighbor_state.len() + 1);
        neighbor_aug[0] = neighbor.param_value;
        for (i, v) in neighbor_state.iter().enumerate() {
            neighbor_aug[i + 1] = *v;
        }
        let secant = if is_append {
            end_aug - neighbor_aug
        } else {
            neighbor_aug - end_aug
        };
        if secant.norm() > 1e-12 {
            Some(secant.normalize())
        } else {
            None
        }
    } else {
        None
    };
    Ok(secant)
}

fn resolve_hopf_kappa_and_omega(
    system: &mut EquationSystem,
    kind: SystemKind,
    point: &Codim1BranchPoint,
    param2_value: f64,
    param1_index: usize,
    param2_index: usize,
) -> Result<(f64, f64), JsValue> {
    if let Some(kappa) = point.auxiliary {
        if kappa.is_finite() && kappa > 0.0 {
            return Ok((kappa, kappa.sqrt()));
        }
    }

    if !point.eigenvalues.is_empty() {
        let omega = extract_hopf_omega(&point.eigenvalues);
        if omega.is_finite() && omega > 0.0 {
            return Ok((omega * omega, omega));
        }
    }

    system.params[param1_index] = point.param_value;
    system.params[param2_index] = param2_value;
    let jac = compute_jacobian(system, kind, &point.state)
        .map_err(|e| JsValue::from_str(&format!("Failed to compute Jacobian: {}", e)))?;
    let n = point.state.len();
    let jac_mat = DMatrix::from_row_slice(n, n, &jac);
    let kappa_raw = estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(1.0);
    let kappa = if kappa_raw.is_finite() && kappa_raw > 0.0 {
        kappa_raw
    } else {
        1.0
    };
    Ok((kappa, kappa.sqrt()))
}

fn extract_hopf_omega(eigenvalues: &[Complex<f64>]) -> f64 {
    let mut max_abs_im: f64 = 0.0;
    for eig in eigenvalues {
        if !eig.re.is_finite() || !eig.im.is_finite() {
            continue;
        }
        max_abs_im = max_abs_im.max(eig.im.abs());
    }
    if max_abs_im <= 0.0 {
        return 1.0;
    }

    let min_imag = max_abs_im * 1e-3;
    let mut best_re: f64 = f64::INFINITY;
    let mut best_im: f64 = 0.0;
    for eig in eigenvalues {
        if !eig.re.is_finite() || !eig.im.is_finite() {
            continue;
        }
        let abs_im = eig.im.abs();
        if abs_im < min_imag {
            continue;
        }
        let abs_re = eig.re.abs();
        if abs_re < best_re || (abs_re == best_re && abs_im > best_im.abs()) {
            best_re = abs_re;
            best_im = eig.im;
        }
    }

    if best_im == 0.0 {
        best_im = max_abs_im;
    }

    let omega = best_im.abs();
    if omega > 0.0 {
        omega
    } else {
        1.0
    }
}

fn resolve_hopf_kappa_from_point(point: &Codim1BranchPoint, fallback: f64) -> f64 {
    if let Some(kappa) = point.auxiliary {
        if kappa.is_finite() && kappa > 0.0 {
            return kappa;
        }
    }
    if !point.eigenvalues.is_empty() {
        let omega = extract_hopf_omega(&point.eigenvalues);
        if omega.is_finite() && omega > 0.0 {
            return omega * omega;
        }
    }
    fallback
}

fn convert_extension_point(
    branch_type: &Codim1BranchType,
    point: &ContinuationPoint,
    curve_dim: CurveDim,
) -> Result<Codim1BranchPoint, JsValue> {
    match branch_type {
        Codim1BranchType::FoldCurve { .. } => match curve_dim {
            CurveDim::Equilibrium(dim) => {
                if point.state.len() < dim + 1 {
                    return Err(JsValue::from_str(
                        "Fold curve extension point has unexpected state length",
                    ));
                }
                let param2_value = point.state[0];
                let physical_state = point.state[1..(dim + 1)].to_vec();
                Ok(Codim1BranchPoint {
                    state: physical_state,
                    param_value: point.param_value,
                    param2_value: Some(param2_value),
                    stability: Some("None".to_string()),
                    eigenvalues: point.eigenvalues.clone(),
                    auxiliary: None,
                })
            }
            _ => Err(JsValue::from_str("Fold curve conversion missing dimension")),
        },
        Codim1BranchType::HopfCurve { .. } => match curve_dim {
            CurveDim::Equilibrium(dim) => {
                if point.state.len() < dim + 2 {
                    return Err(JsValue::from_str(
                        "Hopf curve extension point has unexpected state length",
                    ));
                }
                let param2_value = point.state[0];
                let physical_state = point.state[1..(dim + 1)].to_vec();
                let kappa = point.state[dim + 1];
                Ok(Codim1BranchPoint {
                    state: physical_state,
                    param_value: point.param_value,
                    param2_value: Some(param2_value),
                    stability: Some("None".to_string()),
                    eigenvalues: point.eigenvalues.clone(),
                    auxiliary: Some(kappa),
                })
            }
            _ => Err(JsValue::from_str("Hopf curve conversion missing dimension")),
        },
        Codim1BranchType::LPCCurve { .. } | Codim1BranchType::PDCurve { .. } => {
            if point.state.len() < 2 {
                return Err(JsValue::from_str(
                    "LC curve extension point has unexpected state length",
                ));
            }
            let param2_value = *point.state.last().unwrap_or(&0.0);
            let period = point.state[point.state.len() - 2];
            let lc_state = &point.state[..point.state.len() - 2];
            let mut physical_state = Vec::with_capacity(lc_state.len() + 1);
            physical_state.extend_from_slice(lc_state);
            physical_state.push(period);
            Ok(Codim1BranchPoint {
                state: physical_state,
                param_value: point.param_value,
                param2_value: Some(param2_value),
                stability: Some("None".to_string()),
                eigenvalues: point.eigenvalues.clone(),
                auxiliary: None,
            })
        }
        Codim1BranchType::NSCurve { .. } => {
            if point.state.len() < 3 {
                return Err(JsValue::from_str(
                    "NS curve extension point has unexpected state length",
                ));
            }
            let k_value = *point.state.last().unwrap_or(&0.0);
            let param2_value = point.state[point.state.len() - 2];
            let period = point.state[point.state.len() - 3];
            let lc_state = &point.state[..point.state.len() - 3];
            let mut physical_state = Vec::with_capacity(lc_state.len() + 1);
            physical_state.extend_from_slice(lc_state);
            physical_state.push(period);
            Ok(Codim1BranchPoint {
                state: physical_state,
                param_value: point.param_value,
                param2_value: Some(param2_value),
                stability: Some("None".to_string()),
                eigenvalues: point.eigenvalues.clone(),
                auxiliary: Some(k_value),
            })
        }
    }
}
