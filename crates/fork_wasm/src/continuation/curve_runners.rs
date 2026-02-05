//! Codimension-1 curve continuation runners.

use crate::system::build_system;
use fork_core::continuation::codim1_curves::estimate_hopf_kappa_from_jacobian;
use fork_core::continuation::{
    Codim1CurveBranch, Codim1CurvePoint, Codim1CurveType, Codim2BifurcationType, ContinuationPoint,
    ContinuationRunner, ContinuationSettings, FoldCurveProblem, HopfCurveProblem, LPCCurveProblem,
    NSCurveProblem, PDCurveProblem,
};
use fork_core::equation_engine::EquationSystem;
use fork_core::equilibrium::{compute_jacobian, SystemKind};
use nalgebra::DMatrix;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmFoldCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<FoldCurveProblem<'static>>>,
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = FoldCurveProblem::new(
            unsafe { &mut *system_ptr },
            kind,
            &fold_state,
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: FoldCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(fold_state.len() + 1);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&fold_state);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Fold,
            eigenvalues: vec![],
            cycle_points: None,
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmFoldCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            fold_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n = self.fold_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
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

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Fold,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::{
        WasmFoldCurveRunner, WasmHopfCurveRunner, WasmLPCCurveRunner, WasmNSCurveRunner,
        WasmPDCurveRunner,
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
    fn pd_curve_runner_pads_implicit_state_and_includes_period() {
        let period = 5.0;
        let mut runner = WasmPDCurveRunner::new(
            vec!["a * x + b".to_string()],
            vec![1.0, 2.0],
            vec!["a".to_string(), "b".to_string()],
            vec!["x".to_string()],
            vec![0.5, 0.75],
            period,
            "a",
            1.0,
            "b",
            2.0,
            1,
            1,
            settings_value(0),
            true,
        )
        .expect("runner");

        runner.run_steps(1).expect("run steps");
        let branch_val = runner.get_result().expect("result");
        let branch: Codim1CurveBranch = from_value(branch_val).expect("branch");

        assert_eq!(branch.curve_type, Codim1CurveType::PeriodDoubling);
        assert_eq!(branch.points.len(), 1);
        let point = &branch.points[0];
        assert_eq!(point.param1_value, 1.0);
        assert_eq!(point.param2_value, 2.0);
        assert_eq!(point.state, vec![0.5, 0.5, 0.75, period]);
    }
}

#[wasm_bindgen]
pub struct WasmHopfCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<HopfCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    hopf_state: Vec<f64>,
    hopf_kappa: f64,
    param2_value: f64,
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
        let jac = compute_jacobian(&system, kind, &hopf_state)
            .map_err(|e| JsValue::from_str(&format!("Failed to compute Jacobian: {}", e)))?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);
        let kappa_seed =
            estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(hopf_omega * hopf_omega);
        let hopf_kappa = if kappa_seed.is_finite() && kappa_seed > 0.0 {
            kappa_seed
        } else {
            hopf_omega * hopf_omega
        };

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = HopfCurveProblem::new(
            unsafe { &mut *system_ptr },
            kind,
            &hopf_state,
            hopf_omega,
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create Hopf problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: HopfCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(n + 2);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&hopf_state);
        augmented_state.push(hopf_kappa);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Hopf,
            eigenvalues: vec![],
            cycle_points: None,
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmHopfCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            hopf_state,
            hopf_kappa,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n = self.hopf_state.len();
        let kappa_default = self.hopf_kappa;

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
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

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(kappa),
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Hopf,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmLPCCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<LPCCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmLPCCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

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
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);
            padded
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = LPCCurveProblem::new(
            unsafe { &mut *system_ptr },
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create LPC problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: LPCCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

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
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmLPCCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

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
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::LimitPointCycle,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmPDCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<PDCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    full_lc_state: Vec<f64>,
    param2_value: f64,
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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmPDCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

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
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let u0: Vec<f64> = lc_state[0..dim].to_vec();
            let mesh_end = ntst * dim;
            let mut padded = Vec::with_capacity(lc_state.len() + dim);
            padded.extend_from_slice(&lc_state[0..mesh_end]);
            padded.extend_from_slice(&u0);
            padded.extend_from_slice(&lc_state[mesh_end..]);
            padded
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = PDCurveProblem::new(
            unsafe { &mut *system_ptr },
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create PD problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: PDCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

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
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmPDCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            full_lc_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

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
                    self.full_lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::PeriodDoubling,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmNSCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<NSCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
    initial_k: f64,
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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmNSCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

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
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);
            padded
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = NSCurveProblem::new(
            unsafe { &mut *system_ptr },
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            initial_k,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create NS problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: NSCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

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
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmNSCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
            initial_k,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
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

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(k_value),
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
