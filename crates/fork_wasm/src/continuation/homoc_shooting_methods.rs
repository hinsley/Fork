//! WasmSystem helpers for standard homoclinic shooting.

use crate::system::WasmSystem;
use fork_core::continuation::{
    continue_homoclinic_shooting_curve, homoclinic_shooting_setup_from_collocation,
    homoclinic_shooting_setup_from_point, ContinuationSettings, HomoclinicExtraFlags,
    HomoclinicFixedScalars, HomoclinicSetup, HomoclinicShootingSettings, HomoclinicShootingSetup,
};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    /// Convert any existing collocation homoclinic seed (including large-cycle
    /// and BT predictors) into standard single/multiple-shooting nodes.
    pub fn init_homoclinic_shooting_from_collocation(
        &mut self,
        setup_val: JsValue,
        intervals: u32,
        integration_steps_per_segment: u32,
    ) -> Result<JsValue, JsValue> {
        let setup: HomoclinicSetup = from_value(setup_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid homoclinic collocation setup: {error}"))
        })?;
        let shooting = HomoclinicShootingSettings {
            intervals: intervals as usize,
            integration_steps_per_segment: integration_steps_per_segment as usize,
        };
        let shooting_setup =
            homoclinic_shooting_setup_from_collocation(&setup, shooting).map_err(|error| {
                JsValue::from_str(&format!(
                    "Failed to initialize homoclinic standard shooting: {error}"
                ))
            })?;
        to_value(&shooting_setup)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_homoclinic_shooting_from_shooting(
        &mut self,
        point_state: Vec<f64>,
        source_intervals: u32,
        source_free_time: bool,
        source_free_eps0: bool,
        source_free_eps1: bool,
        source_fixed_time: f64,
        source_fixed_eps0: f64,
        source_fixed_eps1: f64,
        param1_name: &str,
        param2_name: &str,
        target_intervals: u32,
        integration_steps_per_segment: u32,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index = *self.system.param_map.get(param1_name).ok_or_else(|| {
            JsValue::from_str(&format!("Unknown continuation parameter: {param1_name}"))
        })?;
        let param2_index = *self.system.param_map.get(param2_name).ok_or_else(|| {
            JsValue::from_str(&format!("Unknown second parameter: {param2_name}"))
        })?;
        let base_params = self.system.params.clone();
        let setup = homoclinic_shooting_setup_from_point(
            &mut self.system,
            &point_state,
            source_intervals as usize,
            HomoclinicShootingSettings {
                intervals: target_intervals as usize,
                integration_steps_per_segment: integration_steps_per_segment as usize,
            },
            &base_params,
            param1_index,
            param2_index,
            param1_name,
            param2_name,
            HomoclinicExtraFlags {
                free_time,
                free_eps0,
                free_eps1,
            },
            HomoclinicExtraFlags {
                free_time: source_free_time,
                free_eps0: source_free_eps0,
                free_eps1: source_free_eps1,
            },
            HomoclinicFixedScalars {
                time: source_fixed_time,
                eps0: source_fixed_eps0,
                eps1: source_fixed_eps1,
            },
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to restart homoclinic standard shooting: {error}"
            ))
        })?;
        to_value(&setup)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    /// Blocking standard-shooting continuation, retained for CLI compatibility.
    pub fn compute_homoclinic_shooting_continuation(
        &mut self,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let setup: HomoclinicShootingSetup = from_value(setup_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid homoclinic shooting setup: {error}"))
        })?;
        let settings: ContinuationSettings = from_value(settings_val).map_err(|error| {
            JsValue::from_str(&format!("Invalid continuation settings: {error}"))
        })?;
        let branch = continue_homoclinic_shooting_curve(&mut self.system, setup, settings, forward)
            .map_err(|error| {
                JsValue::from_str(&format!(
                    "Homoclinic standard-shooting continuation failed: {error}"
                ))
            })?;
        to_value(&branch)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}
