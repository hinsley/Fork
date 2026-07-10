//! Runner for extending persisted 2D equilibrium and limit-cycle manifolds.

use fork_core::continuation::{
    extend_limit_cycle_manifold_2d, extend_manifold_eq_2d, BranchType, ContinuationBranch,
    Manifold2DSettings, ManifoldCycle2DSettings, ManifoldGeometry, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmManifold2DExtensionRunner {
    progress: StepResult,
    result: Option<ContinuationBranch>,
}

fn surface_counts(branch: &ContinuationBranch) -> (usize, usize) {
    match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(surface)) => {
            let vertices = if surface.dim > 0 {
                surface.vertices_flat.len() / surface.dim
            } else {
                0
            };
            (vertices, surface.ring_offsets.len())
        }
        _ => (0, 0),
    }
}

#[wasm_bindgen]
impl WasmManifold2DExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        branch_val: JsValue,
        settings_val: JsValue,
    ) -> Result<WasmManifold2DExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();
        if system_type == "map" {
            return Err(JsValue::from_str(
                "2D invariant-manifold extension is available for flow systems only.",
            ));
        }
        let branch: ContinuationBranch = from_value(branch_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid manifold branch: {error}")))?;
        let (start_vertices, start_rings) = surface_counts(&branch);

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for equation in equations {
            let expression = parse(&equation).map_err(|error| JsValue::from_str(&error))?;
            bytecodes.push(compiler.compile(&expression));
        }
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let result = match &branch.branch_type {
            BranchType::ManifoldEq2D { .. } => {
                let settings: Manifold2DSettings = from_value(settings_val).map_err(|error| {
                    JsValue::from_str(&format!("Invalid equilibrium manifold settings: {error}"))
                })?;
                extend_manifold_eq_2d(&mut system, branch, settings)
            }
            BranchType::ManifoldCycle2D { .. } => {
                let settings: ManifoldCycle2DSettings =
                    from_value(settings_val).map_err(|error| {
                        JsValue::from_str(&format!("Invalid cycle manifold settings: {error}"))
                    })?;
                extend_limit_cycle_manifold_2d(&mut system, branch, settings)
            }
            _ => Err(anyhow::anyhow!(
                "Only 2D equilibrium or limit-cycle manifold branches can be extended."
            )),
        }
        .map_err(|error| JsValue::from_str(&format!("2D manifold extension failed: {error}")))?;
        let (vertices, rings) = surface_counts(&result);
        let progress = StepResult::new(
            true,
            1,
            1,
            vertices.saturating_sub(start_vertices),
            0,
            rings.saturating_sub(start_rings) as f64,
        )
        .with_rings_computed(rings.saturating_sub(start_rings));
        Ok(Self {
            progress,
            result: Some(result),
        })
    }

    pub fn is_done(&self) -> bool {
        true
    }

    pub fn run_steps(&mut self, _batch_size: u32) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let result = self
            .result
            .take()
            .ok_or_else(|| JsValue::from_str("Runner result has already been taken."))?;
        to_value(&result)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}
