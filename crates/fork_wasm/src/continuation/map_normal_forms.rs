use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::{map_normal_form, MapNormalFormType};
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    /// Compute local normal-form coefficients at a refined map bifurcation.
    ///
    /// `normal_form_type` accepts `branchPoint`, `periodDoubling`, or
    /// `neimarkSacker`. The returned object is tagged by its `type` field and
    /// includes coefficient and conditioning diagnostics.
    pub fn compute_map_normal_form(
        &mut self,
        state: &[f64],
        param_index: usize,
        param_value: f64,
        map_iterations: usize,
        normal_form_type: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(&self.system_type, SystemType::Map) {
            return Err(JsValue::from_str(
                "Map normal forms require a discrete-map system.",
            ));
        }
        let normal_form_type = match normal_form_type {
            "branchPoint" | "BranchPoint" | "bp" => MapNormalFormType::BranchPoint,
            "periodDoubling" | "PeriodDoubling" | "pd" => MapNormalFormType::PeriodDoubling,
            "neimarkSacker" | "NeimarkSacker" | "ns" => MapNormalFormType::NeimarkSacker,
            _ => return Err(JsValue::from_str(
                "Unknown map normal form. Expected branchPoint, periodDoubling, or neimarkSacker.",
            )),
        };
        let normal_form = map_normal_form(
            &mut self.system,
            state,
            param_index,
            param_value,
            map_iterations,
            normal_form_type,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Map normal-form computation failed: {error}"))
        })?;
        to_value(&normal_form)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}
