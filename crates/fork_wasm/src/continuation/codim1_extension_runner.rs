//! Codimension-1 curve branch extension runner.

use super::runner_boundary::static_system_ref;
use super::shared::compute_tangent_from_problem;
use crate::system::build_system;
use fork_core::continuation::codim1_curves::{
    estimate_hopf_kappa_from_jacobian, refine_codim2_points, Codim2CurveProblem,
};
use fork_core::continuation::{
    uniform_normalized_mesh, Codim2BifurcationType, Codim2PointData, CollocationAdaptationReport,
    CollocationAdaptivitySettings, ContinuationPoint, ContinuationProblem, ContinuationRunner,
    ContinuationSettings, FoldCurveProblem, HopfCurveProblem, IsoperiodicCurveProblem,
    LPCCurveProblem, NSCurveProblem, PDCurveProblem,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::{compute_jacobian, SystemKind};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::{from_value, to_value};
use std::collections::BTreeMap;
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
        #[serde(default)]
        normalized_mesh: Vec<f64>,
    },
    IsoperiodicCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
        #[serde(default)]
        normalized_mesh: Vec<f64>,
    },
    PDCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
        #[serde(default)]
        normalized_mesh: Vec<f64>,
    },
    NSCurve {
        param1_name: String,
        param2_name: String,
        ntst: usize,
        ncol: usize,
        #[serde(default)]
        normalized_mesh: Vec<f64>,
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
            | Codim1BranchType::IsoperiodicCurve {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    codim2: Option<Codim2PointData>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    codim2_events: Vec<Codim2PointData>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Codim1BranchData {
    points: Vec<Codim1BranchPoint>,
    #[serde(default)]
    bifurcations: Vec<usize>,
    #[serde(default)]
    indices: Vec<i32>,
    branch_type: Codim1BranchType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    collocation_adaptation: Option<CollocationAdaptationReport>,
}

#[derive(Serialize)]
struct AtomicCodim1ExtensionResult {
    branch: Codim1BranchData,
    collocation_adaptation: Option<CollocationAdaptationReport>,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
struct Codim1ExtensionOptions {
    #[serde(default)]
    collocation_adaptivity: CollocationAdaptivitySettings,
}

struct ExtensionMergeContext {
    branch: Codim1BranchData,
    index_offset: i32,
    sign: i32,
    endpoint_position: usize,
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
    Isoperiodic {
        system: Box<EquationSystem>,
        runner: ContinuationRunner<IsoperiodicCurveProblem<'static>>,
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

        let options: Codim1ExtensionOptions = from_value(settings_val.clone()).map_err(|e| {
            JsValue::from_str(&format!("Invalid codimension-one extension options: {}", e))
        })?;
        let adaptivity = options.collocation_adaptivity;
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
            endpoint_position: endpoint_idx,
        };
        let prior_adaptation = merge.branch.collocation_adaptation.clone();

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
                    endpoint_idx,
                    neighbor_idx,
                    &end_aug,
                    is_append,
                    |pt| build_fold_state(pt, pt.param2_value.unwrap_or(endpoint_param2), dim),
                )?;

                let mut boxed_system = Box::new(system);
                let problem = FoldCurveProblem::new(
                    static_system_ref(&mut boxed_system),
                    kind,
                    &endpoint_state,
                    param1_index,
                    param2_index,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

                let mut problem: FoldCurveProblem<'static> = problem;
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
                    endpoint_idx,
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
                let problem = HopfCurveProblem::new(
                    static_system_ref(&mut boxed_system),
                    kind,
                    &endpoint.state,
                    hopf_omega,
                    param1_index,
                    param2_index,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create hopf problem: {}", e)))?;

                let mut problem: HopfCurveProblem<'static> = problem;
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
            Codim1BranchType::LPCCurve {
                ntst,
                ncol,
                normalized_mesh,
                ..
            } => {
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
                    endpoint_idx,
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
                let normalized_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let problem = LPCCurveProblem::new_on_mesh(
                    static_system_ref(&mut boxed_system),
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    *ntst,
                    *ncol,
                    normalized_mesh,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create LPC problem: {}", e)))?;

                let mut problem: LPCCurveProblem<'static> = problem;
                problem
                    .set_collocation_adaptivity(adaptivity)
                    .map_err(to_js_error)?;
                if let Some(report) = prior_adaptation.clone() {
                    problem
                        .seed_adaptation_report(report)
                        .map_err(to_js_error)?;
                }
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
            Codim1BranchType::IsoperiodicCurve {
                ntst,
                ncol,
                normalized_mesh,
                ..
            } => {
                let dim = system.equations.len();
                let endpoint_param2 = endpoint.param2_value.ok_or_else(|| {
                    JsValue::from_str("Isoperiodic curve point missing param2_value")
                })?;
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
                    endpoint_idx,
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
                let normalized_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let problem = IsoperiodicCurveProblem::new_on_mesh(
                    static_system_ref(&mut boxed_system),
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    *ncol,
                    normalized_mesh,
                )
                .map_err(|e| {
                    JsValue::from_str(&format!("Failed to create isoperiodic problem: {}", e))
                })?;

                let mut problem: IsoperiodicCurveProblem<'static> = problem;
                problem
                    .set_collocation_adaptivity(adaptivity)
                    .map_err(to_js_error)?;
                if let Some(report) = prior_adaptation.clone() {
                    problem
                        .seed_adaptation_report(report)
                        .map_err(to_js_error)?;
                }
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

                Codim1ExtensionRunnerKind::Isoperiodic {
                    system: boxed_system,
                    runner,
                    merge,
                }
            }
            Codim1BranchType::PDCurve {
                ntst,
                ncol,
                normalized_mesh,
                ..
            } => {
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
                    endpoint_idx,
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
                let normalized_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let problem = PDCurveProblem::new_on_mesh(
                    static_system_ref(&mut boxed_system),
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    *ntst,
                    *ncol,
                    normalized_mesh,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create PD problem: {}", e)))?;

                let mut problem: PDCurveProblem<'static> = problem;
                problem
                    .set_collocation_adaptivity(adaptivity)
                    .map_err(to_js_error)?;
                if let Some(report) = prior_adaptation.clone() {
                    problem
                        .seed_adaptation_report(report)
                        .map_err(to_js_error)?;
                }
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
            Codim1BranchType::NSCurve {
                ntst,
                ncol,
                normalized_mesh,
                ..
            } => {
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
                    endpoint_idx,
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
                let normalized_mesh = if normalized_mesh.is_empty() {
                    uniform_normalized_mesh(*ntst)
                } else {
                    normalized_mesh.clone()
                };
                let problem = NSCurveProblem::new_on_mesh(
                    static_system_ref(&mut boxed_system),
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    endpoint.param_value,
                    endpoint_param2,
                    endpoint_k,
                    *ntst,
                    *ncol,
                    normalized_mesh,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create NS problem: {}", e)))?;

                let mut problem: NSCurveProblem<'static> = problem;
                problem
                    .set_collocation_adaptivity(adaptivity)
                    .map_err(to_js_error)?;
                if let Some(report) = prior_adaptation.clone() {
                    problem
                        .seed_adaptation_report(report)
                        .map_err(to_js_error)?;
                }
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
            Some(Codim1ExtensionRunnerKind::Isoperiodic { runner, .. }) => runner.is_done(),
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
            Some(Codim1ExtensionRunnerKind::Isoperiodic { runner, .. }) => runner
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
            Some(Codim1ExtensionRunnerKind::Isoperiodic { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::PD { runner, .. }) => runner.step_result(),
            Some(Codim1ExtensionRunnerKind::NS { runner, .. }) => runner.step_result(),
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        let report = match self.runner.as_ref() {
            Some(Codim1ExtensionRunnerKind::LPC { runner, .. }) => {
                Some(runner.problem().adaptation_report())
            }
            Some(Codim1ExtensionRunnerKind::Isoperiodic { runner, .. }) => {
                Some(runner.problem().adaptation_report())
            }
            Some(Codim1ExtensionRunnerKind::PD { runner, .. }) => {
                Some(runner.problem().adaptation_report())
            }
            Some(Codim1ExtensionRunnerKind::NS { runner, .. }) => {
                Some(runner.problem().adaptation_report())
            }
            _ => None,
        };
        to_value(&report).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let branch_value = self.get_result()?;
        let branch: Codim1BranchData = from_value(branch_value).map_err(|e| {
            JsValue::from_str(&format!("Failed to deserialize completed extension: {}", e))
        })?;
        let collocation_adaptation = branch.collocation_adaptation.clone();
        to_value(&AtomicCodim1ExtensionResult {
            branch,
            collocation_adaptation,
        })
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner_kind = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let (extension, mut merge, curve_dim, codim2_results) = match runner_kind {
            Codim1ExtensionRunnerKind::Fold {
                runner,
                merge,
                dim,
                system: _system,
                kind: _kind,
            } => {
                let settings = runner.settings();
                let (extension, mut problem) = runner.take_result_with_problem();
                let codim2_results =
                    refine_extension_codim2_results(&mut problem, &extension.points, settings)
                        .map_err(to_js_error)?;
                (extension, merge, CurveDim::Equilibrium(dim), codim2_results)
            }
            Codim1ExtensionRunnerKind::Hopf {
                runner,
                merge,
                dim,
                system: _system,
                kind: _kind,
            } => {
                let settings = runner.settings();
                let (extension, mut problem) = runner.take_result_with_problem();
                let codim2_results =
                    refine_extension_codim2_results(&mut problem, &extension.points, settings)
                        .map_err(to_js_error)?;
                (extension, merge, CurveDim::Equilibrium(dim), codim2_results)
            }
            Codim1ExtensionRunnerKind::LPC {
                runner,
                mut merge,
                system,
            } => {
                let settings = runner.settings();
                let (old_ntst, ncol) = match &merge.branch.branch_type {
                    Codim1BranchType::LPCCurve { ntst, ncol, .. } => (*ntst, *ncol),
                    _ => unreachable!("LPC runner requires LPC metadata"),
                };
                let dim = system.equations.len();
                let (extension, mut problem) = runner.take_result_with_problem();
                let final_mesh = problem.normalized_mesh().to_vec();
                remesh_persisted_lc_branch(
                    &mut merge.branch,
                    &problem,
                    old_ntst,
                    ncol,
                    dim,
                    LcLayout::StageFirst,
                    false,
                    &final_mesh,
                )?;
                merge.branch.collocation_adaptation = Some(problem.adaptation_report().clone());
                let codim2_results =
                    refine_extension_codim2_results(&mut problem, &extension.points, settings)
                        .map_err(to_js_error)?;
                (extension, merge, CurveDim::LimitCycle, codim2_results)
            }
            Codim1ExtensionRunnerKind::Isoperiodic {
                runner,
                mut merge,
                system,
            } => {
                let (old_ntst, ncol) = match &merge.branch.branch_type {
                    Codim1BranchType::IsoperiodicCurve { ntst, ncol, .. } => (*ntst, *ncol),
                    _ => unreachable!("isoperiodic runner requires isoperiodic metadata"),
                };
                let dim = system.equations.len();
                let (extension, problem) = runner.take_result_with_problem();
                let final_mesh = problem.normalized_mesh().to_vec();
                remesh_persisted_lc_branch(
                    &mut merge.branch,
                    &problem,
                    old_ntst,
                    ncol,
                    dim,
                    LcLayout::StageFirst,
                    false,
                    &final_mesh,
                )?;
                merge.branch.collocation_adaptation = Some(problem.adaptation_report().clone());
                let codim2_types =
                    vec![Codim2BifurcationType::None; extension.points.len().saturating_sub(1)];
                let codim2_results = typed_extension_results(codim2_types);
                (extension, merge, CurveDim::LimitCycle, codim2_results)
            }
            Codim1ExtensionRunnerKind::PD {
                runner,
                mut merge,
                system,
            } => {
                let settings = runner.settings();
                let (old_ntst, ncol) = match &merge.branch.branch_type {
                    Codim1BranchType::PDCurve { ntst, ncol, .. } => (*ntst, *ncol),
                    _ => unreachable!("PD runner requires PD metadata"),
                };
                let dim = system.equations.len();
                let (extension, mut problem) = runner.take_result_with_problem();
                let final_mesh = problem.normalized_mesh().to_vec();
                remesh_persisted_lc_branch(
                    &mut merge.branch,
                    &problem,
                    old_ntst,
                    ncol,
                    dim,
                    LcLayout::MeshFirst,
                    false,
                    &final_mesh,
                )?;
                merge.branch.collocation_adaptation = Some(problem.adaptation_report().clone());
                let codim2_results =
                    refine_extension_codim2_results(&mut problem, &extension.points, settings)
                        .map_err(to_js_error)?;
                (extension, merge, CurveDim::LimitCycle, codim2_results)
            }
            Codim1ExtensionRunnerKind::NS {
                runner,
                mut merge,
                system,
            } => {
                let settings = runner.settings();
                let (old_ntst, ncol) = match &merge.branch.branch_type {
                    Codim1BranchType::NSCurve { ntst, ncol, .. } => (*ntst, *ncol),
                    _ => unreachable!("NS runner requires NS metadata"),
                };
                let dim = system.equations.len();
                let (extension, mut problem) = runner.take_result_with_problem();
                let final_mesh = problem.normalized_mesh().to_vec();
                remesh_persisted_lc_branch(
                    &mut merge.branch,
                    &problem,
                    old_ntst,
                    ncol,
                    dim,
                    LcLayout::StageFirst,
                    true,
                    &final_mesh,
                )?;
                merge.branch.collocation_adaptation = Some(problem.adaptation_report().clone());
                let codim2_results =
                    refine_extension_codim2_results(&mut problem, &extension.points, settings)
                        .map_err(to_js_error)?;
                (extension, merge, CurveDim::LimitCycle, codim2_results)
            }
        };

        let ExtensionMergeContext {
            index_offset,
            sign,
            endpoint_position,
            ..
        } = merge;

        let existing_point_count = merge.branch.points.len();
        let mut codim2_iter = codim2_results.into_iter();

        for (i, original_point) in extension.points.into_iter().enumerate().skip(1) {
            let mut codim2 = codim2_iter.next().unwrap_or_default();
            remap_extension_codim2_source_segments(
                &mut codim2,
                endpoint_position,
                existing_point_count,
            );
            let point = codim2.point.as_ref().unwrap_or(&original_point);
            let codim2_type = codim2.bifurcation_type;
            let converted = convert_extension_point(
                &merge.branch.branch_type,
                point,
                curve_dim,
                codim2_type,
                codim2.data,
                codim2.events,
            )?;
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

struct ExtensionCodim2Result {
    bifurcation_type: Codim2BifurcationType,
    point: Option<ContinuationPoint>,
    data: Option<Codim2PointData>,
    events: Vec<Codim2PointData>,
}

impl Default for ExtensionCodim2Result {
    fn default() -> Self {
        Self {
            bifurcation_type: Codim2BifurcationType::None,
            point: None,
            data: None,
            events: Vec::new(),
        }
    }
}

fn refined_extension_results(
    point_count: usize,
    events: Vec<fork_core::continuation::codim1_curves::RefinedCodim2Event>,
) -> Vec<ExtensionCodim2Result> {
    let mut by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
    for event in events {
        by_index.entry(event.replace_index).or_default().push(event);
    }
    (1..point_count)
        .map(|index| {
            let Some(events) = by_index.remove(&index) else {
                return ExtensionCodim2Result::default();
            };
            let first = &events[0];
            ExtensionCodim2Result {
                bifurcation_type: first.data.bifurcation_type,
                point: Some(first.point.clone()),
                data: Some(first.data.clone()),
                events: events.into_iter().map(|event| event.data).collect(),
            }
        })
        .collect()
}

fn refine_extension_codim2_results<P: Codim2CurveProblem>(
    problem: &mut P,
    points: &[ContinuationPoint],
    settings: ContinuationSettings,
) -> anyhow::Result<Vec<ExtensionCodim2Result>> {
    let events = refine_codim2_points(
        problem,
        points,
        settings.corrector_steps.max(8),
        settings.corrector_tolerance.clamp(1e-10, 1e-6),
    )?;
    Ok(refined_extension_results(points.len(), events))
}

fn remap_extension_codim2_source_segments(
    result: &mut ExtensionCodim2Result,
    endpoint_position: usize,
    existing_point_count: usize,
) {
    let merged_position = |extension_position: usize| {
        if extension_position == 0 {
            endpoint_position
        } else {
            existing_point_count + extension_position - 1
        }
    };
    if let Some(data) = result.data.as_mut() {
        data.source_segment = [
            merged_position(data.source_segment[0]),
            merged_position(data.source_segment[1]),
        ];
    }
    for event in &mut result.events {
        event.source_segment = [
            merged_position(event.source_segment[0]),
            merged_position(event.source_segment[1]),
        ];
    }
}

fn typed_extension_results(types: Vec<Codim2BifurcationType>) -> Vec<ExtensionCodim2Result> {
    types
        .into_iter()
        .map(|bifurcation_type| ExtensionCodim2Result {
            bifurcation_type,
            point: None,
            data: None,
            events: Vec::new(),
        })
        .collect()
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

#[derive(Clone, Copy)]
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

#[allow(clippy::too_many_arguments)]
fn remesh_persisted_lc_branch<P: ContinuationProblem>(
    branch: &mut Codim1BranchData,
    problem: &P,
    old_ntst: usize,
    ncol: usize,
    dim: usize,
    layout: LcLayout,
    ns_auxiliary: bool,
    final_normalized_mesh: &[f64],
) -> Result<(), JsValue> {
    let internal_states = branch
        .points
        .iter()
        .map(|point| {
            let param2 = point
                .param2_value
                .ok_or_else(|| anyhow::anyhow!("LC curve point is missing its second parameter"))?;
            let (profile, period) = unpack_lc_state(&point.state, old_ntst, ncol, dim, layout)?;
            if ns_auxiliary {
                let k = point
                    .auxiliary
                    .ok_or_else(|| anyhow::anyhow!("NS curve point is missing its auxiliary k"))?;
                Ok(build_ns_state(&profile, period, param2, k))
            } else {
                Ok(build_lc_state(&profile, period, param2))
            }
        })
        .collect::<anyhow::Result<Vec<_>>>()
        .map_err(to_js_error)?;
    let transferred = problem
        .transfer_branch_states_to_current_discretization(&internal_states)
        .map_err(to_js_error)?;
    if transferred.len() != branch.points.len() {
        return Err(JsValue::from_str(
            "Adaptive LC curve transfer changed the persisted branch length",
        ));
    }
    for (point, state) in branch.points.iter_mut().zip(transferred) {
        let trailing = if ns_auxiliary { 2 } else { 1 };
        if state.len() <= trailing {
            return Err(JsValue::from_str(
                "Adaptive LC curve transfer returned a truncated state",
            ));
        }
        point.state = state[..state.len() - trailing].to_vec();
        point.param2_value = Some(state[state.len() - trailing]);
        if ns_auxiliary {
            point.auxiliary = state.last().copied();
        }
    }

    let final_ntst = final_normalized_mesh.len().saturating_sub(1);
    match &mut branch.branch_type {
        Codim1BranchType::LPCCurve {
            ntst,
            normalized_mesh,
            ..
        }
        | Codim1BranchType::IsoperiodicCurve {
            ntst,
            normalized_mesh,
            ..
        }
        | Codim1BranchType::PDCurve {
            ntst,
            normalized_mesh,
            ..
        }
        | Codim1BranchType::NSCurve {
            ntst,
            normalized_mesh,
            ..
        } => {
            *ntst = final_ntst;
            *normalized_mesh = final_normalized_mesh.to_vec();
        }
        _ => {
            return Err(JsValue::from_str(
                "Cannot attach an adaptive LC mesh to an equilibrium curve",
            ));
        }
    }
    Ok(())
}

fn build_secant_direction<F>(
    branch: &Codim1BranchData,
    endpoint_idx: usize,
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
        let mut secant = end_aug - neighbor_aug;
        if should_reverse_secant_for_outward_param_plane(branch, endpoint_idx, neighbor_pos) {
            secant = -secant;
        }
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

fn should_reverse_secant_for_outward_param_plane(
    branch: &Codim1BranchData,
    endpoint_idx: usize,
    neighbor_idx: usize,
) -> bool {
    let endpoint = match branch.points.get(endpoint_idx) {
        Some(point) => point,
        None => return false,
    };
    let neighbor = match branch.points.get(neighbor_idx) {
        Some(point) => point,
        None => return false,
    };
    let seed_pos = match branch.indices.iter().position(|&idx| idx == 0) {
        Some(pos) => pos,
        None => return false,
    };
    if seed_pos == endpoint_idx {
        return false;
    }
    let seed = match branch.points.get(seed_pos) {
        Some(point) => point,
        None => return false,
    };

    let endpoint_p2 = endpoint
        .param2_value
        .or(neighbor.param2_value)
        .or(seed.param2_value)
        .unwrap_or(0.0);
    let neighbor_p2 = neighbor.param2_value.unwrap_or(endpoint_p2);
    let seed_p2 = seed.param2_value.unwrap_or(endpoint_p2);

    let endpoint_distance = (endpoint.param_value - seed.param_value).hypot(endpoint_p2 - seed_p2);
    let neighbor_distance = (neighbor.param_value - seed.param_value).hypot(neighbor_p2 - seed_p2);

    endpoint_distance + 1e-12 < neighbor_distance
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
    codim2: Option<Codim2PointData>,
    codim2_events: Vec<Codim2PointData>,
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
                    codim2,
                    codim2_events,
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
                    codim2,
                    codim2_events,
                })
            }
            _ => Err(JsValue::from_str("Hopf curve conversion missing dimension")),
        },
        Codim1BranchType::LPCCurve { .. }
        | Codim1BranchType::IsoperiodicCurve { .. }
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
                codim2,
                codim2_events,
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
                codim2,
                codim2_events,
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

#[cfg(test)]
mod tests {
    use super::{
        build_secant_direction, convert_extension_point, refine_extension_codim2_results,
        remap_extension_codim2_source_segments, Codim1BranchData, Codim1BranchPoint,
        Codim1BranchType, CurveDim,
    };
    use anyhow::Result;
    use fork_core::continuation::codim1_curves::Codim2CurveProblem;
    use fork_core::continuation::{
        uniform_normalized_mesh, BifurcationType, Codim1CurveType, Codim2BifurcationType,
        Codim2Coefficient, Codim2Conditioning, Codim2PointData, Codim2TestFunctions,
        ContinuationPoint, ContinuationProblem, ContinuationSettings, PointDiagnostics,
        TestFunctionValues,
    };
    use nalgebra::{DMatrix, DVector};

    struct AdaptiveCycleInteractionCurve {
        normalized_mesh: Vec<f64>,
    }

    impl ContinuationProblem for AdaptiveCycleInteractionCurve {
        fn dimension(&self) -> usize {
            1
        }

        fn residual(&mut self, _aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
            out[0] = 0.0;
            Ok(())
        }

        fn extended_jacobian(&mut self, _aug: &DVector<f64>) -> Result<DMatrix<f64>> {
            Ok(DMatrix::from_row_slice(1, 2, &[0.0, 1.0]))
        }

        fn diagnostics(&mut self, _aug: &DVector<f64>) -> Result<PointDiagnostics> {
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
                eigenvalues: Vec::new(),
                cycle_points: None,
            })
        }
    }

    impl Codim2CurveProblem for AdaptiveCycleInteractionCurve {
        fn curve_type(&self) -> Codim1CurveType {
            Codim1CurveType::LimitPointCycle
        }

        fn supported_codim2_types(&self) -> &'static [Codim2BifurcationType] {
            &[
                Codim2BifurcationType::FoldFlip,
                Codim2BifurcationType::FoldNeimarkSacker,
            ]
        }

        fn codim2_tests_at(&mut self, aug: &DVector<f64>) -> Result<Codim2TestFunctions> {
            Ok(Codim2TestFunctions {
                fold_flip: aug[0],
                fold_ns: aug[0],
                ..Default::default()
            })
        }

        fn codim2_coefficients_at(
            &mut self,
            _aug: &DVector<f64>,
            bifurcation_type: Codim2BifurcationType,
            test_value: f64,
        ) -> Result<Vec<Codim2Coefficient>> {
            let mut coefficients = vec![
                Codim2Coefficient {
                    name: "test_value".to_string(),
                    value: test_value,
                },
                Codim2Coefficient {
                    name: "active_mesh_midpoint".to_string(),
                    value: self.normalized_mesh[1],
                },
            ];
            if bifurcation_type == Codim2BifurcationType::FoldNeimarkSacker {
                coefficients.push(Codim2Coefficient {
                    name: "secondary_unit_pair_cosine".to_string(),
                    value: 0.25,
                });
            }
            Ok(coefficients)
        }
    }

    fn codim2_settings() -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps: 2,
            corrector_steps: 8,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-9,
        }
    }

    #[test]
    fn lc_extension_refinement_uses_active_problem_and_keeps_simultaneous_metadata() {
        let mut problem = AdaptiveCycleInteractionCurve {
            normalized_mesh: vec![0.0, 0.2, 1.0],
        };
        let points = vec![
            ContinuationPoint {
                state: vec![0.0],
                param_value: -1.0,
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
        ];

        let mut results = refine_extension_codim2_results(&mut problem, &points, codim2_settings())
            .expect("refine extension codimension-two events");

        assert_eq!(results.len(), 1);
        remap_extension_codim2_source_segments(&mut results[0], 3, 5);
        let result = &results[0];
        assert_eq!(result.events.len(), 2);
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.bifurcation_type)
                .collect::<Vec<_>>(),
            vec![
                Codim2BifurcationType::FoldFlip,
                Codim2BifurcationType::FoldNeimarkSacker,
            ]
        );
        assert!(result.events.iter().all(|event| event.refined));
        assert!(result
            .events
            .iter()
            .all(|event| event.source_segment == [3, 5]));
        assert!(result.events.iter().all(|event| {
            event.coefficients.iter().any(|coefficient| {
                coefficient.name == "active_mesh_midpoint"
                    && (coefficient.value - 0.2).abs() < 1e-12
            })
        }));
        let fold_ns = result
            .events
            .iter()
            .find(|event| event.bifurcation_type == Codim2BifurcationType::FoldNeimarkSacker)
            .expect("fold-NS event");
        assert!(fold_ns.certification.defining_conditions_verified);
        assert!(fold_ns.branch_switches.iter().any(|switch| {
            switch.available
                && switch.target == Codim1CurveType::NeimarkSacker
                && switch.target_auxiliary == Some(0.25)
        }));
    }

    #[test]
    fn convert_isoperiodic_extension_point_keeps_period_and_param2() {
        let branch_type = Codim1BranchType::IsoperiodicCurve {
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            ntst: 4,
            ncol: 2,
            normalized_mesh: uniform_normalized_mesh(4),
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
            None,
            Vec::new(),
        )
        .expect("convert isoperiodic curve point");

        assert_eq!(converted.param_value, 0.2);
        assert_eq!(converted.param2_value, Some(0.12));
        assert_eq!(converted.state, vec![0.3, -0.4, 5.5]);
        assert_eq!(converted.stability.as_deref(), Some("None"));
    }

    #[test]
    fn convert_extension_point_preserves_codim2_refinement_metadata() {
        let branch_type = Codim1BranchType::FoldCurve {
            param1_name: "a".to_string(),
            param2_name: "b".to_string(),
        };
        let point = ContinuationPoint {
            state: vec![0.0, 0.0],
            param_value: 0.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };
        let metadata = Codim2PointData {
            bifurcation_type: Codim2BifurcationType::Cusp,
            refined: true,
            candidate: false,
            test_function: "fold quadratic coefficient a".to_string(),
            test_function_value: 1e-10,
            residual_norm: 2e-11,
            iterations: 4,
            tolerance: 1e-8,
            source_segment: [2, 3],
            source_test_values: [-0.1, 0.2],
            method: "bracketed secant with pseudo-arclength curve correction".to_string(),
            coefficients: vec![Codim2Coefficient {
                name: "c".to_string(),
                value: 1.0,
            }],
            conditioning: Codim2Conditioning {
                bordered_condition_number: Some(3.0),
                jacobian_condition_number: Some(4.0),
            },
            branch_switches: Vec::new(),
            certification: Default::default(),
        };

        let converted = convert_extension_point(
            &branch_type,
            &point,
            CurveDim::Equilibrium(1),
            Codim2BifurcationType::Cusp,
            Some(metadata.clone()),
            vec![metadata.clone()],
        )
        .expect("convert refined cusp");

        assert_eq!(converted.stability.as_deref(), Some("Cusp"));
        assert_eq!(converted.codim2, Some(metadata));
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
                    codim2: None,
                    codim2_events: Vec::new(),
                },
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: -0.2,
                    param2_value: Some(0.2),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                    codim2: None,
                    codim2_events: Vec::new(),
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![-3, -2],
            branch_type: Codim1BranchType::FoldCurve {
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
            },
            collocation_adaptation: None,
        };

        let end_aug = DVector::from_vec(vec![-0.3, 0.0]);
        let secant = build_secant_direction(&branch, 0, Some(1), &end_aug, false, |pt| {
            Ok(pt.state.clone())
        })
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

    #[test]
    fn secant_reverses_when_edge_turns_toward_seed_index() {
        // The minimum-index endpoint (-2) is closer to seed index 0 than its interior
        // neighbor (-1), so extending backward should reverse the local secant and
        // move farther away from index 0 rather than retracing back.
        let branch = Codim1BranchData {
            points: vec![
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: 0.0,
                    param2_value: Some(0.0),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                    codim2: None,
                    codim2_events: Vec::new(),
                },
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: -1.0,
                    param2_value: Some(0.0),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                    codim2: None,
                    codim2_events: Vec::new(),
                },
                Codim1BranchPoint {
                    state: vec![0.0],
                    param_value: -2.0,
                    param2_value: Some(0.0),
                    stability: None,
                    eigenvalues: Vec::new(),
                    auxiliary: None,
                    codim2: None,
                    codim2_events: Vec::new(),
                },
            ],
            bifurcations: Vec::new(),
            indices: vec![0, -2, -1],
            branch_type: Codim1BranchType::FoldCurve {
                param1_name: "a".to_string(),
                param2_name: "b".to_string(),
            },
            collocation_adaptation: None,
        };

        // Endpoint at index -2 (array position 1), interior neighbor index -1 (position 2).
        // Raw neighbor->endpoint secant points toward seed (+param), so the outward
        // correction should flip it to negative param direction.
        let end_aug = DVector::from_vec(vec![-1.0, 0.0]);
        let secant = build_secant_direction(&branch, 1, Some(2), &end_aug, false, |pt| {
            Ok(pt.state.clone())
        })
        .expect("build secant")
        .expect("secant");

        assert!(
            secant[0] < 0.0,
            "Expected reversed secant with negative param component, got {}",
            secant[0]
        );
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn convert_isoperiodic_extension_point_rejects_short_state() {
        let branch_type = Codim1BranchType::IsoperiodicCurve {
            param1_name: "mu".to_string(),
            param2_name: "nu".to_string(),
            ntst: 4,
            ncol: 2,
            normalized_mesh: uniform_normalized_mesh(4),
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
            None,
            Vec::new(),
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
            codim2: None,
            codim2_events: Vec::new(),
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
            collocation_adaptation: None,
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
