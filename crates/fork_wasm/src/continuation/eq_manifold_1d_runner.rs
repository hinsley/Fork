//! Stepped runner wrapper for 1D equilibrium manifolds.

use fork_core::continuation::{
    continue_manifold_eq_1d_with_kind_and_periodicity, ContinuationBranch, Manifold1DSettings,
    ManifoldDirection, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;
use fork_core::state_periodicity::StatePeriodicity;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEqManifold1DRunner {
    system: EquationSystem,
    kind: SystemKind,
    equilibrium_state: Vec<f64>,
    settings: Manifold1DSettings,
    periodicity: StatePeriodicity,
    directions: Vec<ManifoldDirection>,
    next_direction: usize,
    progress: StepResult,
    result: Vec<ContinuationBranch>,
}

#[wasm_bindgen]
impl WasmEqManifold1DRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        equilibrium_state: Vec<f64>,
        settings_val: JsValue,
        periods: Vec<f64>,
    ) -> Result<WasmEqManifold1DRunner, JsValue> {
        console_error_panic_hook::set_once();
        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
            _ => SystemKind::Flow,
        };

        let settings: Manifold1DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            bytecodes.push(compiler.compile(&expr));
        }
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let directions = match settings.direction {
            ManifoldDirection::Both => vec![ManifoldDirection::Plus, ManifoldDirection::Minus],
            direction => vec![direction],
        };
        let progress = StepResult::new(false, 0, directions.len(), 0, 0, 0.0);
        let periodicity = StatePeriodicity::from_periods(&periods, var_names.len());
        Ok(WasmEqManifold1DRunner {
            system,
            kind,
            equilibrium_state,
            settings,
            periodicity,
            directions,
            next_direction: 0,
            progress,
            result: Vec::new(),
        })
    }

    pub fn is_done(&self) -> bool {
        self.progress.done
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let remaining = self.directions.len().saturating_sub(self.next_direction);
        let count = (batch_size.max(1) as usize).min(remaining);
        for _ in 0..count {
            let mut settings = self.settings.clone();
            settings.direction = self.directions[self.next_direction];
            let branches = continue_manifold_eq_1d_with_kind_and_periodicity(
                &mut self.system,
                self.kind,
                &self.equilibrium_state,
                settings,
                &self.periodicity,
            )
            .map_err(|e| JsValue::from_str(&format!("1D manifold computation failed: {}", e)))?;
            self.result.extend(branches);
            self.next_direction += 1;
        }
        let points = self.result.iter().map(|branch| branch.points.len()).sum();
        let last_param = self
            .result
            .iter()
            .filter_map(|branch| branch.points.last().map(|point| point.param_value))
            .fold(0.0, f64::max);
        self.progress = StepResult::new(
            self.next_direction == self.directions.len(),
            self.next_direction,
            self.directions.len(),
            points,
            0,
            last_param,
        );
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        if !self.progress.done {
            return Err(JsValue::from_str("Runner has not finished"));
        }
        to_value(&std::mem::take(&mut self.result))
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
