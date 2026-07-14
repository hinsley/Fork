//! Codimension-1 curve continuation runners.

use super::runner_boundary::{serialize_js, OwnedContinuationRunner};
use crate::system::build_system;
use fork_core::continuation::codim1_curves::{
    estimate_hopf_kappa_from_jacobian, estimate_map_ns_cosine_from_jacobian, refine_codim2_points,
};
use fork_core::continuation::uniform_normalized_mesh;
use fork_core::continuation::{
    Codim1CurveBranch, Codim1CurvePoint, Codim1CurveType, Codim2Bifurcation, Codim2BifurcationType,
    CollocationAdaptationReport, CollocationAdaptivitySettings, ContinuationPoint,
    ContinuationSettings, FoldCurveProblem, HopfCurveProblem, IsoperiodicCurveProblem,
    LPCCurveProblem, NSCurveProblem, PDCurveProblem,
};
use fork_core::equilibrium::{compute_jacobian, compute_system_jacobian, SystemKind};
use nalgebra::DMatrix;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::from_value;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, Deserialize, Default)]
struct CurveRunnerOptions {
    #[serde(default)]
    collocation_adaptivity: CollocationAdaptivitySettings,
}

#[derive(Serialize)]
struct AdaptiveCodim1CurveResult {
    branch: Codim1CurveBranch,
    collocation_adaptation: CollocationAdaptationReport,
}

pub(crate) fn normalize_lc_seed_for_stage_first_explicit(
    lc_state: &[f64],
    ntst: usize,
    ncol: usize,
    dim: usize,
) -> Result<Vec<f64>, String> {
    let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
    let implicit_ncoords = ntst * ncol * dim + ntst * dim;

    if lc_state.len() == implicit_ncoords {
        // Limit-cycle branches store mesh-first implicit periodic data:
        // [mesh_0 .. mesh_(ntst-1), stages...].
        // Isoperiodic expects stage-first explicit periodic data:
        // [stages..., mesh_0 .. mesh_ntst], where mesh_ntst = mesh_0.
        let mesh_len = ntst * dim;
        let mesh = &lc_state[..mesh_len];
        let stages = &lc_state[mesh_len..];
        let mut reordered = Vec::with_capacity(expected_ncoords);
        reordered.extend_from_slice(stages);
        reordered.extend_from_slice(mesh);
        reordered.extend_from_slice(&mesh[..dim]);
        return Ok(reordered);
    }

    if lc_state.len() == expected_ncoords {
        return Ok(lc_state.to_vec());
    }

    Err(format!(
        "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
        lc_state.len(),
        expected_ncoords,
        implicit_ncoords,
        ntst,
        ncol,
        dim
    ))
}

pub(crate) fn normalize_pd_lc_seed_for_mesh_first_explicit(
    lc_state: &[f64],
    ntst: usize,
    ncol: usize,
    dim: usize,
) -> Result<Vec<f64>, String> {
    let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
    let implicit_ncoords = ntst * ncol * dim + ntst * dim;

    if lc_state.len() == implicit_ncoords {
        // Limit-cycle branches store mesh-first implicit periodic data:
        // [mesh_0 .. mesh_(ntst-1), stages...].  PD continuation uses
        // mesh-first explicit data, so insert mesh_ntst = mesh_0 before stages.
        let mesh_len = ntst * dim;
        let mut padded = Vec::with_capacity(expected_ncoords);
        padded.extend_from_slice(&lc_state[..mesh_len]);
        padded.extend_from_slice(&lc_state[..dim]);
        padded.extend_from_slice(&lc_state[mesh_len..]);
        return Ok(padded);
    }

    if lc_state.len() == expected_ncoords {
        return Ok(lc_state.to_vec());
    }

    Err(format!(
        "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
        lc_state.len(),
        expected_ncoords,
        implicit_ncoords,
        ntst,
        ncol,
        dim
    ))
}

fn split_pd_curve_output_state(state: &[f64], explicit_lc_len: usize) -> Option<(Vec<f64>, f64)> {
    if state.len() < explicit_lc_len + 2 {
        return None;
    }
    Some((
        state[..explicit_lc_len + 1].to_vec(),
        state[explicit_lc_len + 1],
    ))
}

#[cfg(test)]
mod layout_tests {
    use super::{
        normalize_lc_seed_for_stage_first_explicit, normalize_pd_lc_seed_for_mesh_first_explicit,
        split_pd_curve_output_state,
    };

    #[test]
    fn normalizes_mesh_first_implicit_state_for_isoperiodic_seed() {
        let normalized =
            normalize_lc_seed_for_stage_first_explicit(&[10.0, 20.0, 30.0, 40.0], 2, 1, 1)
                .expect("normalize state");
        assert_eq!(normalized, vec![30.0, 40.0, 10.0, 20.0, 10.0]);
    }

    #[test]
    fn normalizes_dim_two_mesh_first_implicit_state_for_ns_seed() {
        let normalized = normalize_lc_seed_for_stage_first_explicit(
            &[10.0, 11.0, 20.0, 21.0, 30.0, 31.0, 40.0, 41.0],
            2,
            1,
            2,
        )
        .expect("normalize two-dimensional NS state");
        assert_eq!(
            normalized,
            vec![30.0, 31.0, 40.0, 41.0, 10.0, 11.0, 20.0, 21.0, 10.0, 11.0,]
        );
    }

    #[test]
    fn accepts_stage_first_explicit_state_unchanged() {
        let normalized =
            normalize_lc_seed_for_stage_first_explicit(&[30.0, 40.0, 10.0, 20.0, 10.0], 2, 1, 1)
                .expect("normalize state");
        assert_eq!(normalized, vec![30.0, 40.0, 10.0, 20.0, 10.0]);
    }

    #[test]
    fn rejects_incorrect_state_length() {
        let err =
            normalize_lc_seed_for_stage_first_explicit(&[1.0, 2.0, 3.0], 2, 1, 1).unwrap_err();
        assert!(err.contains("Invalid lc_state.len()"));
    }

    #[test]
    fn pads_mesh_first_implicit_state_for_pd_seed() {
        let normalized =
            normalize_pd_lc_seed_for_mesh_first_explicit(&[10.0, 20.0, 30.0, 40.0], 2, 1, 1)
                .expect("normalize PD state");
        assert_eq!(normalized, vec![10.0, 20.0, 10.0, 30.0, 40.0]);
    }

    #[test]
    fn pads_dim_two_pd_seed_at_the_mesh_stage_boundary() {
        let normalized = normalize_pd_lc_seed_for_mesh_first_explicit(
            &[10.0, 11.0, 20.0, 21.0, 30.0, 31.0, 40.0, 41.0],
            2,
            1,
            2,
        )
        .expect("normalize two-dimensional PD state");
        assert_eq!(
            normalized,
            vec![10.0, 11.0, 20.0, 21.0, 10.0, 11.0, 30.0, 31.0, 40.0, 41.0,]
        );
    }

    #[test]
    fn accepts_mesh_first_explicit_pd_state_unchanged() {
        let normalized =
            normalize_pd_lc_seed_for_mesh_first_explicit(&[10.0, 20.0, 10.0, 30.0, 40.0], 2, 1, 1)
                .expect("normalize PD state");
        assert_eq!(normalized, vec![10.0, 20.0, 10.0, 30.0, 40.0]);
    }

    #[test]
    fn rejects_invalid_pd_state_length() {
        let err = normalize_pd_lc_seed_for_mesh_first_explicit(&[1.0, 2.0, 3.0], 2, 1, 1)
            .expect_err("invalid PD state should fail");
        assert!(err.contains("Invalid lc_state.len()"));
    }

    #[test]
    fn stepped_pd_output_keeps_explicit_coordinates_period_and_second_parameter_distinct() {
        // dim=2, ntst=2, ncol=1 gives ten explicit LC coordinates. The
        // continuation point then appends period and p2.
        let state = vec![
            10.0, 11.0, 20.0, 21.0, 10.0, 11.0, 30.0, 31.0, 40.0, 41.0, 6.25, 0.75,
        ];
        let (physical, p2) =
            split_pd_curve_output_state(&state, 10).expect("valid stepped PD output layout");
        assert_eq!(physical, state[..11]);
        assert_eq!(physical.last().copied(), Some(6.25));
        assert_eq!(p2, 0.75);
    }
}

#[wasm_bindgen]
pub struct WasmFoldCurveRunner {
    runner: OwnedContinuationRunner<FoldCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    fold_state: Vec<f64>,
    param2_value: f64,
}

#[wasm_bindgen]
impl WasmFoldCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        fold_state: Vec<f64>,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmFoldCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
            _ => SystemKind::Flow,
        };

        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let mut augmented_state = Vec::with_capacity(fold_state.len() + 1);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&fold_state);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Fold,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| FoldCurveProblem::new(system, kind, &fold_state, param1_index, param2_index),
            initial_point,
            settings,
            forward,
            "fold",
        )?;

        Ok(WasmFoldCurveRunner {
            runner,
            param1_index,
            param2_index,
            fold_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let settings = self.runner.settings()?;
        let (branch, mut problem) = self.runner.take_result_with_problem()?;
        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("Codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
        for event in events {
            events_by_index
                .entry(event.replace_index)
                .or_default()
                .push(event);
        }
        let n = self.fold_state.len();

        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let refined_events = events_by_index.remove(&index).unwrap_or_default();
            let pt = refined_events
                .first()
                .map(|event| event.point.clone())
                .unwrap_or_else(|| original_point.clone());
            let codim2_events = refined_events
                .into_iter()
                .map(|event| event.data)
                .collect::<Vec<_>>();
            let codim2 = codim2_events.first().cloned();
            let p2 = if !pt.state.is_empty() {
                pt.state[0]
            } else {
                self.param2_value
            };
            let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                pt.state[1..(n + 1)].to_vec()
            } else {
                self.fold_state.clone()
            };

            let codim2_type = codim2
                .as_ref()
                .map(|data| data.bifurcation_type)
                .unwrap_or(Codim2BifurcationType::None);
            for data in &codim2_events {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: data.bifurcation_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,
                param2_value: p2,
                codim2_type,
                auxiliary: None,
                eigenvalues: pt.eigenvalues.clone(),
                codim2_events,
                codim2,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Fold,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst: 0,
            ncol: 0,
            normalized_mesh: Vec::new(),
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::{
        WasmFoldCurveRunner, WasmHopfCurveRunner, WasmIsoperiodicCurveRunner, WasmLPCCurveRunner,
        WasmNSCurveRunner,
    };
    use fork_core::continuation::{
        Codim1CurveBranch, Codim1CurveType, Codim2BifurcationType, ContinuationSettings,
    };
    use serde_wasm_bindgen::{from_value, to_value};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn settings_value(max_steps: usize) -> wasm_bindgen::JsValue {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-9,
            step_tolerance: 1e-6,
        };
        to_value(&settings).expect("settings")
    }

    fn map_ns_settings_value(max_steps: usize) -> wasm_bindgen::JsValue {
        let settings = ContinuationSettings {
            step_size: 0.02,
            min_step_size: 1e-7,
            max_step_size: 0.04,
            max_steps,
            corrector_steps: 10,
            corrector_tolerance: 1e-10,
            step_tolerance: 1e-10,
        };
        to_value(&settings).expect("map NS settings")
    }

    #[wasm_bindgen_test]
    fn lpc_curve_runner_rejects_invalid_state_len() {
        let result = WasmLPCCurveRunner::new(
            vec!["x".to_string()],
            vec![1.0],
            vec!["p".to_string()],
            vec!["x".to_string()],
            vec![0.0, 1.0, 2.0],
            1.0,
            "p",
            1.0,
            "p",
            1.0,
            2,
            1,
            settings_value(3),
            true,
        );

        assert!(result.is_err(), "should reject invalid lc_state length");
        let message = result
            .err()
            .and_then(|err| err.as_string())
            .unwrap_or_default();
        assert!(message.contains("Invalid lc_state.len()"));
    }

    #[wasm_bindgen_test]
    fn isoperiodic_curve_runner_emits_expected_initial_point() {
        let period = 2.0;
        // Keep the one-stage-per-interval Floquet blocks nonsingular.  This test exercises
        // the wrapper's initial-point layout; singular-block propagation is
        // covered explicitly by the core isoperiodic diagnostics tests.
        let a = 0.25;
        let mut runner = WasmIsoperiodicCurveRunner::new(
            vec!["a * x + b".to_string()],
            vec![a, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            vec![0.5, 0.5, 0.5, 0.5],
            period,
            "a",
            a,
            "b",
            2.0,
            2,
            1,
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let branch_val = runner.get_result().expect("result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("branch");

        assert_eq!(branch.curve_type, Codim1CurveType::Isoperiodic);
        assert_eq!(branch.points.len(), 1);
        let point = &branch.points[0];
        assert_eq!(point.param1_value, a);
        assert_eq!(point.param2_value, 2.0);
        // Isoperiodic points use stage-first coordinates with an explicit
        // periodic endpoint: [stage0, stage1, mesh0, mesh1,
        // mesh2 (= mesh0), period].  Two intervals also keep current and next
        // mesh blocks distinct during Floquet condensation.
        assert_eq!(point.state, vec![0.5, 0.5, 0.5, 0.5, 0.5, period]);
        assert_eq!(point.codim2_type, Codim2BifurcationType::None);
        assert!(point.auxiliary.is_none());
    }

    #[wasm_bindgen_test]
    fn isoperiodic_curve_runner_reorders_mesh_first_lc_state_to_stage_first() {
        // ntst=2, ncol=1, dim=1
        // Input layout (mesh-first implicit): [mesh0, mesh1, stage0, stage1]
        // Expected internal/output layout (stage-first explicit):
        // [stage0, stage1, mesh0, mesh1, mesh0]
        let period = 3.0;
        let mut runner = WasmIsoperiodicCurveRunner::new(
            vec!["a * x + b".to_string()],
            vec![1.0, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            vec![10.0, 20.0, 30.0, 40.0],
            period,
            "a",
            1.0,
            "b",
            2.0,
            2,
            1,
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let branch_val = runner.get_result().expect("result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("branch");

        assert_eq!(branch.curve_type, Codim1CurveType::Isoperiodic);
        assert_eq!(branch.points.len(), 1);
        let point = &branch.points[0];
        assert_eq!(point.state, vec![30.0, 40.0, 10.0, 20.0, 10.0, period]);
    }

    #[wasm_bindgen_test]
    fn ns_curve_runner_rejects_invalid_state_len() {
        let result = WasmNSCurveRunner::new(
            vec!["x".to_string()],
            vec![1.0, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            vec![0.0, 1.0, 2.0],
            1.0,
            "a",
            1.0,
            "b",
            2.0,
            0.5,
            2,
            1,
            settings_value(3),
            true,
        );

        assert!(result.is_err(), "should reject invalid lc_state length");
        let message = result
            .err()
            .and_then(|err| err.as_string())
            .unwrap_or_default();
        assert!(message.contains("Invalid lc_state.len()"));
    }

    #[wasm_bindgen_test]
    fn fold_curve_runner_emits_expected_initial_point() {
        let mut runner = WasmFoldCurveRunner::new(
            vec!["a * x - b".to_string()],
            vec![1.0, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            "flow",
            1,
            vec![0.0],
            "a",
            1.0,
            "b",
            2.0,
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let branch_val = runner.get_result().expect("result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("branch");

        assert_eq!(branch.curve_type, Codim1CurveType::Fold);
        assert_eq!(branch.param1_index, 0);
        assert_eq!(branch.param2_index, 1);
        assert_eq!(branch.indices, vec![0]);
        assert_eq!(branch.points.len(), 1);
        let point = &branch.points[0];
        assert_eq!(point.state, vec![0.0]);
        assert_eq!(point.param1_value, 1.0);
        assert_eq!(point.param2_value, 2.0);
        assert_eq!(point.codim2_type, Codim2BifurcationType::None);
        assert!(point.auxiliary.is_none());
    }

    #[wasm_bindgen_test]
    fn hopf_curve_runner_sets_kappa_auxiliary() {
        let hopf_omega = 3.0;
        let mut runner = WasmHopfCurveRunner::new(
            vec!["a * x".to_string(), "b * y".to_string()],
            vec![-1.0, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "flow",
            1,
            vec![0.0, 0.0],
            hopf_omega,
            "a",
            -1.0,
            "b",
            2.0,
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let branch_val = runner.get_result().expect("result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("branch");

        assert_eq!(branch.curve_type, Codim1CurveType::Hopf);
        assert_eq!(branch.points.len(), 1);
        let point = &branch.points[0];
        assert_eq!(point.state, vec![0.0, 0.0]);
        assert_eq!(point.param1_value, -1.0);
        assert_eq!(point.param2_value, 2.0);
        assert_eq!(point.auxiliary, Some(hopf_omega * hopf_omega));
    }

    #[wasm_bindgen_test]
    fn map_ns_curve_runner_follows_unit_circle_locus() {
        let mut runner = WasmHopfCurveRunner::new(
            vec![
                "(1+p1+p2)*(0.5*x-0.8660254037844386*y)".to_string(),
                "(1+p1+p2)*(0.8660254037844386*x+0.5*y)".to_string(),
            ],
            vec![-0.2, 0.2],
            vec!["p1".to_string(), "p2".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "map",
            1,
            vec![0.0, 0.0],
            0.8660254037844386,
            "p1",
            -0.2,
            "p2",
            0.2,
            map_ns_settings_value(4),
            true,
        )
        .expect("map NS runner");

        runner.run_steps(4).expect("map NS steps");
        let branch_val = runner.get_result().expect("map NS result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("map NS branch");

        assert_eq!(branch.curve_type, Codim1CurveType::NeimarkSacker);
        assert!(branch.points.len() >= 3);
        for point in &branch.points {
            assert!((point.param1_value + point.param2_value).abs() < 1.0e-4);
            assert!((point.auxiliary.expect("cosine") - 0.5).abs() < 3.0e-4);
            assert!(point
                .eigenvalues
                .iter()
                .all(|multiplier| (multiplier.norm() - 1.0).abs() < 1.0e-4));
        }
    }
}

#[wasm_bindgen]
pub struct WasmHopfCurveRunner {
    runner: OwnedContinuationRunner<HopfCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    hopf_state: Vec<f64>,
    hopf_kappa: f64,
    param2_value: f64,
    kind: SystemKind,
}

#[wasm_bindgen]
impl WasmHopfCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        hopf_state: Vec<f64>,
        hopf_omega: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHopfCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
            _ => SystemKind::Flow,
        };

        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let n = hopf_state.len();
        let jac = match kind {
            SystemKind::Flow => compute_jacobian(&system, kind, &hopf_state),
            SystemKind::Map { .. } => compute_system_jacobian(&system, kind, &hopf_state),
        }
        .map_err(|e| JsValue::from_str(&format!("Failed to compute Jacobian: {}", e)))?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);
        let hopf_kappa = match kind {
            SystemKind::Flow => {
                estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(hopf_omega * hopf_omega)
            }
            SystemKind::Map { .. } => estimate_map_ns_cosine_from_jacobian(&jac_mat)
                .unwrap_or_else(|| (1.0 - hopf_omega * hopf_omega).max(0.0).sqrt()),
        };
        if !hopf_kappa.is_finite()
            || (kind.is_flow() && hopf_kappa <= 0.0)
            || (kind.is_map() && hopf_kappa.abs() > 1.0 + 1.0e-8)
        {
            return Err(JsValue::from_str(
                "Invalid Hopf/Neimark-Sacker spectral seed",
            ));
        }

        let mut augmented_state = Vec::with_capacity(n + 2);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&hopf_state);
        augmented_state.push(hopf_kappa);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: if kind.is_map() {
                fork_core::continuation::BifurcationType::NeimarkSacker
            } else {
                fork_core::continuation::BifurcationType::Hopf
            },
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| {
                HopfCurveProblem::new(
                    system,
                    kind,
                    &hopf_state,
                    if kind.is_map() {
                        hopf_kappa
                    } else {
                        hopf_omega
                    },
                    param1_index,
                    param2_index,
                )
            },
            initial_point,
            settings,
            forward,
            if kind.is_map() {
                "Neimark-Sacker"
            } else {
                "Hopf"
            },
        )?;

        Ok(WasmHopfCurveRunner {
            runner,
            param1_index,
            param2_index,
            hopf_state,
            hopf_kappa,
            param2_value,
            kind,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let settings = self.runner.settings()?;
        let (branch, mut problem) = self.runner.take_result_with_problem()?;
        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("Codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
        for event in events {
            events_by_index
                .entry(event.replace_index)
                .or_default()
                .push(event);
        }
        let n = self.hopf_state.len();
        let kappa_default = self.hopf_kappa;

        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let refined_events = events_by_index.remove(&index).unwrap_or_default();
            let pt = refined_events
                .first()
                .map(|event| event.point.clone())
                .unwrap_or_else(|| original_point.clone());
            let codim2_events = refined_events
                .into_iter()
                .map(|event| event.data)
                .collect::<Vec<_>>();
            let codim2 = codim2_events.first().cloned();
            let p2 = if !pt.state.is_empty() {
                pt.state[0]
            } else {
                self.param2_value
            };
            let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                pt.state[1..(n + 1)].to_vec()
            } else {
                self.hopf_state.clone()
            };
            let kappa = if pt.state.len() >= n + 2 {
                pt.state[n + 1]
            } else {
                kappa_default
            };

            let codim2_type = codim2
                .as_ref()
                .map(|data| data.bifurcation_type)
                .unwrap_or(Codim2BifurcationType::None);
            for data in &codim2_events {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: data.bifurcation_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,
                param2_value: p2,
                codim2_type,
                auxiliary: Some(kappa),
                eigenvalues: pt.eigenvalues.clone(),
                codim2_events,
                codim2,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: if self.kind.is_map() {
                Codim1CurveType::NeimarkSacker
            } else {
                Codim1CurveType::Hopf
            },
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst: 0,
            ncol: 0,
            normalized_mesh: Vec::new(),
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}

#[wasm_bindgen]
pub struct WasmLPCCurveRunner {
    runner: OwnedContinuationRunner<LPCCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
    ncol: usize,
}

#[wasm_bindgen]
impl WasmLPCCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        normalized_mesh: Vec<f64>,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmLPCCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let options: CurveRunnerOptions = from_value(settings_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid LPC curve options: {}", e)))?;
        let adaptivity = options.collocation_adaptivity;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let normalized_mesh = if normalized_mesh.is_empty() {
            uniform_normalized_mesh(ntst)
        } else {
            normalized_mesh
        };
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Limit-cycle branches store mesh-first implicit periodic data:
            // [mesh_0 .. mesh_(ntst-1), stages...].
            // Isoperiodic expects stage-first explicit periodic data:
            // [stages..., mesh_0 .. mesh_ntst], where mesh_ntst = mesh_0.
            let mesh_len = ntst * dim;
            let mesh = &lc_state[..mesh_len];
            let stages = &lc_state[mesh_len..];
            let mut reordered = Vec::with_capacity(expected_ncoords);
            reordered.extend_from_slice(stages);
            reordered.extend_from_slice(mesh);
            reordered.extend_from_slice(&mesh[..dim]);
            reordered
        } else if lc_state.len() == expected_ncoords {
            lc_state.clone()
        } else {
            return Err(JsValue::from_str(&format!(
                "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
                lc_state.len(),
                expected_ncoords,
                implicit_ncoords,
                ntst,
                ncol,
                dim
            )));
        };

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::CycleFold,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| {
                let mut problem = LPCCurveProblem::new_on_mesh(
                    system,
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    param1_value,
                    param2_value,
                    ntst,
                    ncol,
                    normalized_mesh.clone(),
                )?;
                problem.set_collocation_adaptivity(adaptivity)?;
                Ok(problem)
            },
            initial_point,
            settings,
            forward,
            "LPC",
        )?;

        Ok(WasmLPCCurveRunner {
            runner,
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
            ncol,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        serialize_js(self.runner.problem()?.adaptation_report())
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let collocation_adaptation = self.runner.problem()?.adaptation_report().clone();
        let branch: Codim1CurveBranch = from_value(self.get_result()?)
            .map_err(|error| JsValue::from_str(&format!("Invalid LPC curve result: {error}")))?;
        serialize_js(&AdaptiveCodim1CurveResult {
            branch,
            collocation_adaptation,
        })
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let settings = self.runner.settings()?;
        let (branch, mut problem) = self.runner.take_result_with_problem()?;
        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("LPC codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
        for event in events {
            events_by_index
                .entry(event.replace_index)
                .or_default()
                .push(event);
        }
        let normalized_mesh = problem.normalized_mesh().to_vec();
        let ntst = normalized_mesh.len().saturating_sub(1);
        let n_lc = branch
            .points
            .first()
            .and_then(|point| point.state.len().checked_sub(2))
            .unwrap_or(self.full_lc_state.len());

        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let refined_events = events_by_index.remove(&index).unwrap_or_default();
            let pt = refined_events
                .first()
                .map(|event| &event.point)
                .unwrap_or(original_point);
            let codim2_events = refined_events
                .iter()
                .map(|event| event.data.clone())
                .collect::<Vec<_>>();
            let codim2 = codim2_events.first().cloned();
            let p2 = if pt.state.len() >= n_lc + 2 {
                pt.state[n_lc + 1]
            } else {
                self.param2_value
            };
            let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                pt.state[..(n_lc + 1)].to_vec()
            } else {
                self.lc_state.clone()
            };

            for data in &codim2_events {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: data.bifurcation_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,
                param2_value: p2,
                codim2_type: codim2
                    .as_ref()
                    .map(|data| data.bifurcation_type)
                    .unwrap_or(Codim2BifurcationType::None),
                auxiliary: None,
                eigenvalues: pt.eigenvalues.clone(),
                codim2,
                codim2_events,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::LimitPointCycle,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst,
            ncol: self.ncol,
            normalized_mesh,
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}

#[wasm_bindgen]
pub struct WasmIsoperiodicCurveRunner {
    runner: OwnedContinuationRunner<IsoperiodicCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
    ncol: usize,
}

#[wasm_bindgen]
impl WasmIsoperiodicCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        normalized_mesh: Vec<f64>,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmIsoperiodicCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let options: CurveRunnerOptions = from_value(settings_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid isoperiodic curve options: {}", e)))?;
        let adaptivity = options.collocation_adaptivity;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let normalized_mesh = if normalized_mesh.is_empty() {
            uniform_normalized_mesh(ntst)
        } else {
            normalized_mesh
        };
        let full_lc_state = normalize_lc_seed_for_stage_first_explicit(&lc_state, ntst, ncol, dim)
            .map_err(|message| JsValue::from_str(&message))?;

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| {
                let mut problem = IsoperiodicCurveProblem::new_on_mesh(
                    system,
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    param1_value,
                    param2_value,
                    ncol,
                    normalized_mesh.clone(),
                )?;
                problem.set_collocation_adaptivity(adaptivity)?;
                Ok(problem)
            },
            initial_point,
            settings,
            forward,
            "isoperiodic",
        )?;

        Ok(WasmIsoperiodicCurveRunner {
            runner,
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
            ncol,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        serialize_js(self.runner.problem()?.adaptation_report())
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let collocation_adaptation = self.runner.problem()?.adaptation_report().clone();
        let branch: Codim1CurveBranch = from_value(self.get_result()?).map_err(|error| {
            JsValue::from_str(&format!("Invalid isoperiodic curve result: {error}"))
        })?;
        serialize_js(&AdaptiveCodim1CurveResult {
            branch,
            collocation_adaptation,
        })
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let (branch, problem) = self.runner.take_result_with_problem()?;
        let normalized_mesh = problem.normalized_mesh().to_vec();
        let ntst = normalized_mesh.len().saturating_sub(1);
        let n_lc = branch
            .points
            .first()
            .and_then(|point| point.state.len().checked_sub(2))
            .unwrap_or(self.full_lc_state.len());

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    self.param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    self.lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                    codim2: None,
                    codim2_events: Vec::new(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Isoperiodic,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst,
            ncol: self.ncol,
            normalized_mesh,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}

#[wasm_bindgen]
pub struct WasmPDCurveRunner {
    runner: OwnedContinuationRunner<PDCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    full_lc_state: Vec<f64>,
    period: f64,
    param2_value: f64,
    ncol: usize,
}

#[wasm_bindgen]
impl WasmPDCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        normalized_mesh: Vec<f64>,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmPDCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let options: CurveRunnerOptions = from_value(settings_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid PD curve options: {}", e)))?;
        let adaptivity = options.collocation_adaptivity;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let normalized_mesh = if normalized_mesh.is_empty() {
            uniform_normalized_mesh(ntst)
        } else {
            normalized_mesh
        };
        let full_lc_state =
            normalize_pd_lc_seed_for_mesh_first_explicit(&lc_state, ntst, ncol, dim)
                .map_err(|message| JsValue::from_str(&message))?;

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::PeriodDoubling,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| {
                let mut problem = PDCurveProblem::new_on_mesh(
                    system,
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    param1_value,
                    param2_value,
                    ntst,
                    ncol,
                    normalized_mesh.clone(),
                )?;
                problem.set_collocation_adaptivity(adaptivity)?;
                Ok(problem)
            },
            initial_point,
            settings,
            forward,
            "PD",
        )?;

        Ok(WasmPDCurveRunner {
            runner,
            param1_index,
            param2_index,
            full_lc_state,
            period,
            param2_value,
            ncol,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        serialize_js(self.runner.problem()?.adaptation_report())
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let collocation_adaptation = self.runner.problem()?.adaptation_report().clone();
        let branch: Codim1CurveBranch = from_value(self.get_result()?)
            .map_err(|error| JsValue::from_str(&format!("Invalid PD curve result: {error}")))?;
        serialize_js(&AdaptiveCodim1CurveResult {
            branch,
            collocation_adaptation,
        })
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let settings = self.runner.settings()?;
        let (branch, mut problem) = self.runner.take_result_with_problem()?;
        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("PD codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
        for event in events {
            events_by_index
                .entry(event.replace_index)
                .or_default()
                .push(event);
        }
        let normalized_mesh = problem.normalized_mesh().to_vec();
        let ntst = normalized_mesh.len().saturating_sub(1);
        let n_lc = branch
            .points
            .first()
            .and_then(|point| point.state.len().checked_sub(2))
            .unwrap_or(self.full_lc_state.len());
        let mut fallback_physical_state = self.full_lc_state.clone();
        fallback_physical_state.push(self.period);

        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let refined_events = events_by_index.remove(&index).unwrap_or_default();
            let pt = refined_events
                .first()
                .map(|event| &event.point)
                .unwrap_or(original_point);
            let codim2_events = refined_events
                .iter()
                .map(|event| event.data.clone())
                .collect::<Vec<_>>();
            let codim2 = codim2_events.first().cloned();
            let (physical_state, p2) = split_pd_curve_output_state(&pt.state, n_lc)
                .unwrap_or_else(|| (fallback_physical_state.clone(), self.param2_value));

            for data in &codim2_events {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: data.bifurcation_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,
                param2_value: p2,
                codim2_type: codim2
                    .as_ref()
                    .map(|data| data.bifurcation_type)
                    .unwrap_or(Codim2BifurcationType::None),
                auxiliary: None,
                eigenvalues: pt.eigenvalues.clone(),
                codim2,
                codim2_events,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::PeriodDoubling,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst,
            ncol: self.ncol,
            normalized_mesh,
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}

#[wasm_bindgen]
pub struct WasmNSCurveRunner {
    runner: OwnedContinuationRunner<NSCurveProblem<'static>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
    initial_k: f64,
    ncol: usize,
}

#[wasm_bindgen]
impl WasmNSCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        initial_k: f64,
        ntst: usize,
        ncol: usize,
        normalized_mesh: Vec<f64>,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmNSCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let options: CurveRunnerOptions = from_value(settings_val.clone())
            .map_err(|e| JsValue::from_str(&format!("Invalid NS curve options: {}", e)))?;
        let adaptivity = options.collocation_adaptivity;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let normalized_mesh = if normalized_mesh.is_empty() {
            uniform_normalized_mesh(ntst)
        } else {
            normalized_mesh
        };
        let full_lc_state = normalize_lc_seed_for_stage_first_explicit(&lc_state, ntst, ncol, dim)
            .map_err(|message| JsValue::from_str(&message))?;

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 3);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);
        augmented_state.push(initial_k);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::NeimarkSacker,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
            heteroclinic_events: None,
        };

        let runner = OwnedContinuationRunner::new(
            system,
            |system| {
                let mut problem = NSCurveProblem::new_on_mesh(
                    system,
                    full_lc_state.clone(),
                    period,
                    param1_index,
                    param2_index,
                    param1_value,
                    param2_value,
                    initial_k,
                    ntst,
                    ncol,
                    normalized_mesh.clone(),
                )?;
                problem.set_collocation_adaptivity(adaptivity)?;
                Ok(problem)
            },
            initial_point,
            settings,
            forward,
            "NS",
        )?;

        Ok(WasmNSCurveRunner {
            runner,
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
            initial_k,
            ncol,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps(batch_size)
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress()
    }

    pub fn get_adaptation_report(&self) -> Result<JsValue, JsValue> {
        serialize_js(self.runner.problem()?.adaptation_report())
    }

    pub fn get_result_with_report(&mut self) -> Result<JsValue, JsValue> {
        let collocation_adaptation = self.runner.problem()?.adaptation_report().clone();
        let branch: Codim1CurveBranch = from_value(self.get_result()?)
            .map_err(|error| JsValue::from_str(&format!("Invalid NS curve result: {error}")))?;
        serialize_js(&AdaptiveCodim1CurveResult {
            branch,
            collocation_adaptation,
        })
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let settings = self.runner.settings()?;
        let (branch, mut problem) = self.runner.take_result_with_problem()?;
        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("NS codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, Vec<_>> = BTreeMap::new();
        for event in events {
            events_by_index
                .entry(event.replace_index)
                .or_default()
                .push(event);
        }
        let normalized_mesh = problem.normalized_mesh().to_vec();
        let ntst = normalized_mesh.len().saturating_sub(1);
        let n_lc = branch
            .points
            .first()
            .and_then(|point| point.state.len().checked_sub(3))
            .unwrap_or(self.full_lc_state.len());

        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let refined_events = events_by_index.remove(&index).unwrap_or_default();
            let pt = refined_events
                .first()
                .map(|event| &event.point)
                .unwrap_or(original_point);
            let codim2_events = refined_events
                .iter()
                .map(|event| event.data.clone())
                .collect::<Vec<_>>();
            let codim2 = codim2_events.first().cloned();
            let p2 = if pt.state.len() >= n_lc + 2 {
                pt.state[n_lc + 1]
            } else {
                self.param2_value
            };
            let k_value = if pt.state.len() >= n_lc + 3 {
                pt.state[n_lc + 2]
            } else {
                self.initial_k
            };
            let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                pt.state[..(n_lc + 1)].to_vec()
            } else {
                self.lc_state.clone()
            };

            for data in &codim2_events {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: data.bifurcation_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,
                param2_value: p2,
                codim2_type: codim2
                    .as_ref()
                    .map(|data| data.bifurcation_type)
                    .unwrap_or(Codim2BifurcationType::None),
                auxiliary: Some(k_value),
                eigenvalues: pt.eigenvalues.clone(),
                codim2,
                codim2_events,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            ntst,
            ncol: self.ncol,
            normalized_mesh,
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        serialize_js(&codim1_branch)
    }
}
