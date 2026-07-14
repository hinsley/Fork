//! WasmSystem helpers for genuine heteroclinic standard shooting.

use crate::system::WasmSystem;
use fork_core::continuation::{
    continue_heteroclinic_shooting_curve, heteroclinic_shooting_setup_from_collocation,
    ContinuationSettings, HeteroclinicSetupV1, HeteroclinicShootingSettings,
    HeteroclinicShootingSetupV1,
};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    pub fn init_heteroclinic_shooting_from_collocation(
        &mut self,
        setup_val: JsValue,
        intervals: u32,
        integration_steps_per_segment: u32,
    ) -> Result<JsValue, JsValue> {
        let setup: HeteroclinicSetupV1 = from_value(setup_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid heteroclinic collocation setup: {error}"))
        })?;
        let shooting = heteroclinic_shooting_setup_from_collocation(
            &setup,
            HeteroclinicShootingSettings {
                intervals: intervals as usize,
                integration_steps_per_segment: integration_steps_per_segment as usize,
            },
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to initialize heteroclinic standard shooting: {error}"
            ))
        })?;
        to_value(&shooting)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    /// Blocking entry point retained for the Node CLI.
    pub fn compute_heteroclinic_shooting_continuation(
        &mut self,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let setup: HeteroclinicShootingSetupV1 = from_value(setup_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid heteroclinic shooting setup: {error}"))
        })?;
        let settings: ContinuationSettings = from_value(settings_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid continuation settings: {error}"))
        })?;
        let branch =
            continue_heteroclinic_shooting_curve(&mut self.system, setup, settings, forward)
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Heteroclinic standard-shooting continuation failed: {error}"
                    ))
                })?;
        to_value(&branch)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}
