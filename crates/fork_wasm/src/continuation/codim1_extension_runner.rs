//! Codimension-1 curve branch extension runner.

use super::shared::compute_tangent_from_problem;
use crate::system::build_system;
use fork_core::continuation::codim1_curves::estimate_hopf_kappa_from_jacobian;
use fork_core::continuation::{
    Codim2BifurcationType, Codim2TestFunctions, ContinuationBranch, ContinuationPoint,
    ContinuationProblem, ContinuationRunner, ContinuationSettings, FoldCurveProblem,
    HopfCurveProblem, IsochroneCurveProblem, LPCCurveProblem, NSCurveProblem, PDCurveProblem,
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
    IsochroneCurve {
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
            | Codim1BranchType::IsochroneCurve {
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
        system: Box<EquationSystem>,
        kind: SystemKind,
        runner: ContinuationRunner<FoldCurveProblem<'static>>,
        merge: ExtensionMergeContext,
        dim: usize,
    },
    Hopf {
        system: Box<EquationSystem>,
        kind: SystemKind,
        runner: ContinuationRunner<HopfCurveProblem<'static>>,
        merge: ExtensionMergeContext,
        dim: usize,
    },
    LPC {
        system: Box<EquationSystem>,
        runner: ContinuationRunner<LPCCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    Isochrone {
        system: Box<EquationSystem>,
        runner: ContinuationRunner<IsochroneCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    PD {
        system: Box<EquationSystem>,
        runner: ContinuationRunner<PDCurveProblem<'static>>,
        merge: ExtensionMergeContext,
    },
    NS {
        system: Box<EquationSystem>,
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
        map_iterations: u32,
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
            (
                min_idx_pos,
                branch.indices[min_idx_pos],
                next_idx_pos,
                false,
            )
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
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
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
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::Fold {
                    system: boxed_system,
                    kind,
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
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::Hopf {
                    system: boxed_system,
                    kind,
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
                        let (lc_state, pt_period) =
                            unpack_lc_state(&pt.state, *ntst, *ncol, dim, LcLayout::StageFirst)?;
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

                let mut problem: LPCCurveProblem<'static> = unsafe { std::mem::transmute(problem) };
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::LPC {
                    system: boxed_system,
                    runner,
                    merge,
                }
            }
            Codim1BranchType::IsochroneCurve { ntst, ncol, .. } => {
                let dim = system.equations.len();
                let endpoint_param2 = endpoint
                    .param2_value
                    .ok_or_else(|| JsValue::from_str("Isochrone curve point missing param2_value"))?;
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
                        let (lc_state, pt_period) =
                            unpack_lc_state(&pt.state, *ntst, *ncol, dim, LcLayout::StageFirst)?;
                        Ok(build_lc_state(&lc_state, pt_period, param2))
                    },
                )?;

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let problem = IsochroneCurveProblem::new(
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
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to create isochrone problem: {}", e))
                })?;

                let mut problem: IsochroneCurveProblem<'static> =
                    unsafe { std::mem::transmute(problem) };
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::Isochrone {
                    system: boxed_system,
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
                        let (lc_state, pt_period) =
                            unpack_lc_state(&pt.state, *ntst, *ncol, dim, LcLayout::MeshFirst)?;
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

                let mut problem: PDCurveProblem<'static> = unsafe { std::mem::transmute(problem) };
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::PD {
                    system: boxed_system,
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
                        let (lc_state, pt_period) =
                            unpack_lc_state(&pt.state, *ntst, *ncol, dim, LcLayout::StageFirst)?;
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

                let mut problem: NSCurveProblem<'static> = unsafe { std::mem::transmute(problem) };
                let tangent = initial_tangent_from_secant_or_problem(
                    &mut problem,
                    &end_aug,
                    secant.as_ref(),
                    forward,
                )?;

                let initial_point = ContinuationPoint {
                    state: end_state.clone(),
                    param_value: endpoint.param_value,
                    stability: fork_core::continuation::BifurcationType::None,
                    eigenvalues: endpoint.eigenvalues.clone(),
                    cycle_points: None,
                };

                let runner =
                    ContinuationRunner::new_with_tangent(problem, initial_point, tangent, settings)
                        .map_err(|e| {
                            JsValue::from_str(&format!("Continuation init failed: {}", e))
                        })?;

                Codim1ExtensionRunnerKind::NS {
                    system: boxed_system,
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
            Some(Codim1ExtensionRunnerKind::Isochrone { runner, .. }) => runner.is_done(),
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
            Some(Codim1ExtensionRunnerKind::Isochrone { runner, .. }) => runner
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
            Some(Codim1ExtensionRunnerKind::Isochrone { runner, .. }) => runner.step_result(),
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

        let (extension, mut merge, curve_dim, codim2_types) = match runner_kind {
            Codim1ExtensionRunnerKind::Fold {
                runner,
                merge,
                dim,
                mut system,
                kind,
            } => {
                let extension = runner.take_result();
                let codim2_types = detect_codim2_fold(
                    &extension,
                    &merge.branch.branch_type,
                    system.as_mut(),
                    kind,
                    dim,
                )?;
                (extension, merge, CurveDim::Equilibrium(dim), codim2_types)
            }
            Codim1ExtensionRunnerKind::Hopf {
                runner,
                merge,
                dim,
                mut system,
                kind,
            } => {
                let extension = runner.take_result();
                let codim2_types = detect_codim2_hopf(
                    &extension,
                    &merge.branch.branch_type,
                    system.as_mut(),
                    kind,
                    dim,
                )?;
                (extension, merge, CurveDim::Equilibrium(dim), codim2_types)
            }
            Codim1ExtensionRunnerKind::LPC {
                runner,
                merge,
                mut system,
            } => {
                let extension = runner.take_result();
                let codim2_types =
                    detect_codim2_lpc(&extension, &merge.branch.branch_type, system.as_mut())?;
                (extension, merge, CurveDim::LimitCycle, codim2_types)
            }
            Codim1ExtensionRunnerKind::Isochrone {
                runner,
                merge,
                system: _system,
            } => {
                let extension = runner.take_result();
                let codim2_types =
                    vec![Codim2BifurcationType::None; extension.points.len().saturating_sub(1)];
                (extension, merge, CurveDim::LimitCycle, codim2_types)
            }
            Codim1ExtensionRunnerKind::PD {
                runner,
                merge,
                mut system,
            } => {
                let extension = runner.take_result();
                let codim2_types =
                    detect_codim2_pd(&extension, &merge.branch.branch_type, system.as_mut())?;
                (extension, merge, CurveDim::LimitCycle, codim2_types)
            }
            Codim1ExtensionRunnerKind::NS {
                runner,
                merge,
                mut system,
            } => {
                let extension = runner.take_result();
                let codim2_types =
                    detect_codim2_ns(&extension, &merge.branch.branch_type, system.as_mut())?;
                (extension, merge, CurveDim::LimitCycle, codim2_types)
            }
        };

        let ExtensionMergeContext {
            index_offset, sign, ..
        } = merge;

        let mut codim2_iter = codim2_types.into_iter();

        for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
            let codim2_type = codim2_iter.next().unwrap_or(Codim2BifurcationType::None);
            let converted =
                convert_extension_point(&merge.branch.branch_type, &pt, curve_dim, codim2_type)?;
            if codim2_type != Codim2BifurcationType::None {
                merge.branch.bifurcations.push(merge.branch.points.len());
            }
            merge.branch.points.push(converted);
            let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
            merge.branch.indices.push(index_offset + idx * sign);
        }

        to_value(&merge.branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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

fn initial_tangent_from_secant_or_problem<P: ContinuationProblem>(
    problem: &mut P,
    end_aug: &DVector<f64>,
    secant: Option<&DVector<f64>>,
    forward: bool,
) -> Result<DVector<f64>, JsValue> {
    let mut tangent = if let Some(secant_vec) = secant {
        secant_vec.clone()
    } else {
        compute_tangent_from_problem(problem, end_aug)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?
    };
    orient_tangent(&mut tangent, secant, forward);
    Ok(tangent)
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

fn build_ns_state(lc_state: &[f64], period: f64, param2_value: f64, k_value: f64) -> Vec<f64> {
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
    _is_append: bool,
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
        // Always orient secant from interior neighbor -> selected endpoint.
        // This preserves outward continuation on both append (max-index) and
        // prepend (min-index) extension sides.
        let secant = end_aug - neighbor_aug;
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
    codim2_type: Codim2BifurcationType,
) -> Result<Codim1BranchPoint, JsValue> {
    let stability = Some(codim2_stability_label(codim2_type));
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
                    stability,
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
                    stability,
                    eigenvalues: point.eigenvalues.clone(),
                    auxiliary: Some(kappa),
                })
            }
            _ => Err(JsValue::from_str("Hopf curve conversion missing dimension")),
        },
        Codim1BranchType::LPCCurve { .. }
        | Codim1BranchType::IsochroneCurve { .. }
        | Codim1BranchType::PDCurve { .. } => {
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
                stability,
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
                stability,
                eigenvalues: point.eigenvalues.clone(),
                auxiliary: Some(k_value),
            })
        }
    }
}

fn codim2_stability_label(bifurcation: Codim2BifurcationType) -> String {
    if bifurcation == Codim2BifurcationType::None {
        "None".to_string()
    } else {
        format!("{:?}", bifurcation)
    }
}

fn detect_codim2_fold(
    extension: &ContinuationBranch,
    branch_type: &Codim1BranchType,
    system: &mut EquationSystem,
    kind: SystemKind,
    dim: usize,
) -> Result<Vec<Codim2BifurcationType>, JsValue> {
    let (param1_index, param2_index) = param_indices(system, branch_type)?;
    let first = extension
        .points
        .first()
        .ok_or_else(|| JsValue::from_str("Fold extension has no points"))?;
    if first.state.len() < dim + 1 {
        return Err(JsValue::from_str(
            "Fold extension point has unexpected state length",
        ));
    }
    let p2 = first.state[0];
    let state = first.state[1..(dim + 1)].to_vec();

    system.params[param1_index] = first.param_value;
    system.params[param2_index] = p2;

    let mut problem = FoldCurveProblem::new(system, kind, &state, param1_index, param2_index)
        .map_err(to_js_error)?;

    detect_codim2_for_extension(extension, |point| {
        codim2_tests_for_fold(&mut problem, point)
    })
}

fn detect_codim2_hopf(
    extension: &ContinuationBranch,
    branch_type: &Codim1BranchType,
    system: &mut EquationSystem,
    kind: SystemKind,
    dim: usize,
) -> Result<Vec<Codim2BifurcationType>, JsValue> {
    let (param1_index, param2_index) = param_indices(system, branch_type)?;
    let first = extension
        .points
        .first()
        .ok_or_else(|| JsValue::from_str("Hopf extension has no points"))?;
    if first.state.len() < dim + 2 {
        return Err(JsValue::from_str(
            "Hopf extension point has unexpected state length",
        ));
    }
    let p2 = first.state[0];
    let state = first.state[1..(dim + 1)].to_vec();
    let kappa = first.state[dim + 1];
    let hopf_omega = if kappa.is_finite() && kappa > 0.0 {
        kappa.sqrt()
    } else {
        1.0
    };

    system.params[param1_index] = first.param_value;
    system.params[param2_index] = p2;

    let mut problem =
        HopfCurveProblem::new(system, kind, &state, hopf_omega, param1_index, param2_index)
            .map_err(to_js_error)?;

    detect_codim2_for_extension(extension, |point| {
        codim2_tests_for_hopf(&mut problem, point)
    })
}

fn detect_codim2_lpc(
    extension: &ContinuationBranch,
    branch_type: &Codim1BranchType,
    system: &mut EquationSystem,
) -> Result<Vec<Codim2BifurcationType>, JsValue> {
    let (ntst, ncol) = match branch_type {
        Codim1BranchType::LPCCurve { ntst, ncol, .. } => (*ntst, *ncol),
        _ => return Err(JsValue::from_str("Branch type is not LPC")),
    };
    let (param1_index, param2_index) = param_indices(system, branch_type)?;
    let dim = system.equations.len();
    let first = extension
        .points
        .first()
        .ok_or_else(|| JsValue::from_str("LPC extension has no points"))?;
    let (full_lc_state, period, p2, _) =
        split_lc_continuation_state(&first.state, ntst, ncol, dim, LcLayout::StageFirst, false)?;

    system.params[param1_index] = first.param_value;
    system.params[param2_index] = p2;

    let mut problem = LPCCurveProblem::new(
        system,
        full_lc_state,
        period,
        param1_index,
        param2_index,
        first.param_value,
        p2,
        ntst,
        ncol,
    )
    .map_err(to_js_error)?;

    detect_codim2_for_extension(extension, |point| codim2_tests_for_lpc(&mut problem, point))
}

fn detect_codim2_pd(
    extension: &ContinuationBranch,
    branch_type: &Codim1BranchType,
    system: &mut EquationSystem,
) -> Result<Vec<Codim2BifurcationType>, JsValue> {
    let (ntst, ncol) = match branch_type {
        Codim1BranchType::PDCurve { ntst, ncol, .. } => (*ntst, *ncol),
        _ => return Err(JsValue::from_str("Branch type is not PD")),
    };
    let (param1_index, param2_index) = param_indices(system, branch_type)?;
    let dim = system.equations.len();
    let first = extension
        .points
        .first()
        .ok_or_else(|| JsValue::from_str("PD extension has no points"))?;
    let (full_lc_state, period, p2, _) =
        split_lc_continuation_state(&first.state, ntst, ncol, dim, LcLayout::MeshFirst, false)?;

    system.params[param1_index] = first.param_value;
    system.params[param2_index] = p2;

    let mut problem = PDCurveProblem::new(
        system,
        full_lc_state,
        period,
        param1_index,
        param2_index,
        first.param_value,
        p2,
        ntst,
        ncol,
    )
    .map_err(to_js_error)?;

    detect_codim2_for_extension(extension, |point| codim2_tests_for_pd(&mut problem, point))
}

fn detect_codim2_ns(
    extension: &ContinuationBranch,
    branch_type: &Codim1BranchType,
    system: &mut EquationSystem,
) -> Result<Vec<Codim2BifurcationType>, JsValue> {
    let (ntst, ncol) = match branch_type {
        Codim1BranchType::NSCurve { ntst, ncol, .. } => (*ntst, *ncol),
        _ => return Err(JsValue::from_str("Branch type is not NS")),
    };
    let (param1_index, param2_index) = param_indices(system, branch_type)?;
    let dim = system.equations.len();
    let first = extension
        .points
        .first()
        .ok_or_else(|| JsValue::from_str("NS extension has no points"))?;
    let (full_lc_state, period, p2, k_value) =
        split_lc_continuation_state(&first.state, ntst, ncol, dim, LcLayout::StageFirst, true)?;
    let k_value = k_value.ok_or_else(|| JsValue::from_str("NS extension missing k value"))?;

    system.params[param1_index] = first.param_value;
    system.params[param2_index] = p2;

    let mut problem = NSCurveProblem::new(
        system,
        full_lc_state,
        period,
        param1_index,
        param2_index,
        first.param_value,
        p2,
        k_value,
        ntst,
        ncol,
    )
    .map_err(to_js_error)?;

    detect_codim2_for_extension(extension, |point| codim2_tests_for_ns(&mut problem, point))
}

fn detect_codim2_for_extension<F>(
    extension: &ContinuationBranch,
    mut compute_tests: F,
) -> Result<Vec<Codim2BifurcationType>, JsValue>
where
    F: FnMut(&ContinuationPoint) -> Result<Codim2TestFunctions, JsValue>,
{
    if extension.points.len() <= 1 {
        return Ok(Vec::new());
    }

    let mut prev_tests = compute_tests(&extension.points[0])?;
    let mut detected = Vec::with_capacity(extension.points.len().saturating_sub(1));

    for point in extension.points.iter().skip(1) {
        let tests = compute_tests(point)?;
        let change = tests
            .detect_sign_changes(&prev_tests)
            .first()
            .copied()
            .unwrap_or(Codim2BifurcationType::None);
        detected.push(change);
        prev_tests = tests;
    }

    Ok(detected)
}

fn codim2_tests_for_fold(
    problem: &mut FoldCurveProblem,
    point: &ContinuationPoint,
) -> Result<Codim2TestFunctions, JsValue> {
    let aug = aug_from_point(point);
    problem.diagnostics(&aug).map_err(to_js_error)?;
    let tests = problem.codim2_tests();
    problem.update_after_step(&aug).map_err(to_js_error)?;
    Ok(tests)
}

fn codim2_tests_for_hopf(
    problem: &mut HopfCurveProblem,
    point: &ContinuationPoint,
) -> Result<Codim2TestFunctions, JsValue> {
    let aug = aug_from_point(point);
    problem.diagnostics(&aug).map_err(to_js_error)?;
    let tests = problem.codim2_tests();
    problem.update_after_step(&aug).map_err(to_js_error)?;
    Ok(tests)
}

fn codim2_tests_for_lpc(
    problem: &mut LPCCurveProblem,
    point: &ContinuationPoint,
) -> Result<Codim2TestFunctions, JsValue> {
    let aug = aug_from_point(point);
    problem.diagnostics(&aug).map_err(to_js_error)?;
    let tests = problem.codim2_tests();
    problem.update_after_step(&aug).map_err(to_js_error)?;
    Ok(tests)
}

fn codim2_tests_for_pd(
    problem: &mut PDCurveProblem,
    point: &ContinuationPoint,
) -> Result<Codim2TestFunctions, JsValue> {
    let aug = aug_from_point(point);
    problem.diagnostics(&aug).map_err(to_js_error)?;
    let tests = problem.codim2_tests();
    problem.update_after_step(&aug).map_err(to_js_error)?;
    Ok(tests)
}

fn codim2_tests_for_ns(
    problem: &mut NSCurveProblem,
    point: &ContinuationPoint,
) -> Result<Codim2TestFunctions, JsValue> {
    let aug = aug_from_point(point);
    problem.diagnostics(&aug).map_err(to_js_error)?;
    let tests = problem.codim2_tests();
    problem.update_after_step(&aug).map_err(to_js_error)?;
    Ok(tests)
}

fn aug_from_point(point: &ContinuationPoint) -> DVector<f64> {
    let mut aug = DVector::zeros(point.state.len() + 1);
    aug[0] = point.param_value;
    for (i, v) in point.state.iter().enumerate() {
        aug[i + 1] = *v;
    }
    aug
}

fn param_indices(
    system: &EquationSystem,
    branch_type: &Codim1BranchType,
) -> Result<(usize, usize), JsValue> {
    let (param1_name, param2_name) = branch_type.param_names();
    let param1_index = *system
        .param_map
        .get(param1_name)
        .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
    let param2_index = *system
        .param_map
        .get(param2_name)
        .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
    Ok((param1_index, param2_index))
}

fn split_lc_continuation_state(
    state: &[f64],
    ntst: usize,
    ncol: usize,
    dim: usize,
    layout: LcLayout,
    has_k: bool,
) -> Result<(Vec<f64>, f64, f64, Option<f64>), JsValue> {
    if has_k {
        if state.len() < 3 {
            return Err(JsValue::from_str("NS continuation state is too short"));
        }
        let k_value = *state.last().unwrap_or(&0.0);
        let p2 = state[state.len() - 2];
        let state_with_period = &state[..state.len() - 2];
        let (full_lc_state, period) =
            unpack_lc_state(state_with_period, ntst, ncol, dim, layout).map_err(to_js_error)?;
        Ok((full_lc_state, period, p2, Some(k_value)))
    } else {
        if state.len() < 2 {
            return Err(JsValue::from_str("LC continuation state is too short"));
        }
        let p2 = *state.last().unwrap_or(&0.0);
        let state_with_period = &state[..state.len() - 1];
        let (full_lc_state, period) =
            unpack_lc_state(state_with_period, ntst, ncol, dim, layout).map_err(to_js_error)?;
        Ok((full_lc_state, period, p2, None))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_secant_direction, convert_extension_point, Codim1BranchData, Codim1BranchPoint,
        Codim1BranchType, CurveDim,
    };
    use fork_core::continuation::{BifurcationType, Codim2BifurcationType, ContinuationPoint};
    use nalgebra::DVector;

    #[test]
    fn convert_isochrone_extension_point_keeps_period_and_param2() {
        let branch_type = Codim1BranchType::IsochroneCurve {
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            ntst: 4,
            ncol: 2,
        };
        let point = ContinuationPoint {
            // LC state + period + param2
            state: vec![0.3, -0.4, 5.5, 0.12],
            param_value: 0.2,
            stability: BifurcationType::None,
            eigenvalues: vec![],
            cycle_points: None,
        };

        let converted = convert_extension_point(
            &branch_type,
            &point,
            CurveDim::LimitCycle,
            Codim2BifurcationType::None,
        )
        .expect("convert isochrone point");

        assert_eq!(converted.param_value, 0.2);
        assert_eq!(converted.param2_value, Some(0.12));
        assert_eq!(converted.state, vec![0.3, -0.4, 5.5]);
        assert_eq!(converted.stability.as_deref(), Some("None"));
    }

    #[test]
    fn backward_extension_secant_points_outward_from_neighbor_to_endpoint() {
        let branch = Codim1BranchData {
            points: vec![
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: -0.3,
                    param2_value: Some(0.2),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                },
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: -0.2,
                    param2_value: Some(0.2),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![-3, -2],
            branch_type: Codim1BranchType::FoldCurve {
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
            },
        };

        let end_aug = DVector::from_vec(vec![-0.3, 0.0]);
        let secant = build_secant_direction(
            &branch,
            Some(1),
            &end_aug,
            false,
            |pt| Ok(pt.state.clone()),
        )
        .expect("build secant")
        .expect("secant");

        // Endpoint is at smaller parameter than interior neighbor, so outward
        // direction for backward extension should be negative in param component.
        assert!(
            secant[0] < 0.0,
            "Expected backward secant param component < 0, got {}",
            secant[0]
        );
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn convert_isochrone_extension_point_rejects_short_state() {
        let branch_type = Codim1BranchType::IsochroneCurve {
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            ntst: 4,
            ncol: 2,
        };
        let point = ContinuationPoint {
            state: vec![1.0],
            param_value: 0.2,
            stability: BifurcationType::None,
            eigenvalues: vec![],
            cycle_points: None,
        };

        let err = convert_extension_point(
            &branch_type,
            &point,
            CurveDim::LimitCycle,
            Codim2BifurcationType::None,
        )
        .expect_err("short state should fail");

        let message = err.as_string().unwrap_or_default();
        assert!(
            message.contains("LC curve extension point has unexpected state length"),
            "unexpected error: {}",
            message
        );
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::{
        Codim1BranchData, Codim1BranchPoint, Codim1BranchType, WasmCodim1CurveExtensionRunner,
    };
    use fork_core::continuation::ContinuationSettings;
    use serde_wasm_bindgen::to_value;
    use wasm_bindgen::JsValue;

    fn settings_value(max_steps: usize) -> JsValue {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };
        to_value(&settings).expect("settings")
    }

    fn fold_point(state: f64, param_value: f64, param2_value: Option<f64>) -> Codim1BranchPoint {
        Codim1BranchPoint {
            state: vec![state],
            param_value,
            param2_value,
            stability: None,
            eigenvalues: Vec::new(),
            auxiliary: None,
        }
    }

    #[test]
    fn backward_extension_selects_signed_min_index_endpoint_on_non_monotonic_order() {
        // Intentional non-monotonic storage order:
        // array position is [idx 0, idx -2, idx +1]. The min signed index point is the
        // backward endpoint. We leave only that point missing param2_value so endpoint
        // selection failures become unambiguous.
        let branch = Codim1BranchData {
            points: vec![
                fold_point(0.0, 0.0, Some(0.5)),
                fold_point(-0.1, -0.1, None),
                fold_point(0.2, 0.2, Some(0.5)),
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -2, 1],
            branch_type: Codim1BranchType::FoldCurve {
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
            },
        };
        let branch_val = to_value(&branch).expect("branch");

        let result = WasmCodim1CurveExtensionRunner::new(
            vec!["x - a - b".to_string()],
            vec![0.0, 0.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            branch_val,
            "a",
            settings_value(1),
            false,
        );

        assert!(
            result.is_err(),
            "should select min-index endpoint with missing param2_value"
        );
        let err = result.err().expect("error");

        let message = err.as_string().unwrap_or_default();
        assert!(
            message.contains("Fold curve point missing param2_value"),
            "expected backward endpoint validation error, got '{}'",
            message
        );
    }
}
