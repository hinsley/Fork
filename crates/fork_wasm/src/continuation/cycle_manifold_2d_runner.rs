//! Stepped runner wrapper for 2D limit-cycle manifolds.

use fork_core::continuation::{
    continue_limit_cycle_manifold_2d, ContinuationBranch, ManifoldCycle2DSettings,
    ManifoldGeometry, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use num_complex::Complex;
use serde::Deserialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
struct ComplexWire {
    re: f64,
    im: f64,
}

#[wasm_bindgen]
pub struct WasmCycleManifold2DRunner {
    progress: StepResult,
    result: Option<ContinuationBranch>,
}

#[wasm_bindgen]
impl WasmCycleManifold2DRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        cycle_state: Vec<f64>,
        ntst: u32,
        ncol: u32,
        floquet_multipliers_val: JsValue,
        settings_val: JsValue,
    ) -> Result<WasmCycleManifold2DRunner, JsValue> {
        console_error_panic_hook::set_once();
        if system_type == "map" {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }

        let settings: ManifoldCycle2DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let floquet_wire: Vec<ComplexWire> = from_value(floquet_multipliers_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid Floquet multipliers: {}", e)))?;
        let floquet_multipliers = floquet_wire
            .into_iter()
            .map(|value| Complex::new(value.re, value.im))
            .collect::<Vec<_>>();

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            bytecodes.push(compiler.compile(&expr));
        }
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let branch = continue_limit_cycle_manifold_2d(
            &mut system,
            &cycle_state,
            ntst as usize,
            ncol as usize,
            &floquet_multipliers,
            settings,
        )
        .map_err(|e| JsValue::from_str(&format!("Cycle manifold computation failed: {}", e)))?;
        let points = branch.points.len();
        let rings = match branch.manifold_geometry.as_ref() {
            Some(ManifoldGeometry::Surface(surface)) => surface.ring_offsets.len(),
            _ => 0,
        };
        let last_param = branch
            .points
            .last()
            .map(|point| point.param_value)
            .unwrap_or(0.0);
        let progress =
            StepResult::new(true, 1, 1, points, 0, last_param).with_rings_computed(rings);
        Ok(WasmCycleManifold2DRunner {
            progress,
            result: Some(branch),
        })
    }

    pub fn is_done(&self) -> bool {
        true
    }

    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let result = self
            .result
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
