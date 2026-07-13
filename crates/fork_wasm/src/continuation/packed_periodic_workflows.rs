//! Normal-form workflows sourced directly from persisted collocation states.

use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::{
    limit_cycle_setup_from_packed_state, periodic_branch_point_switch_setup,
    periodic_orbit_normal_form, LimitCycleSetup, PeriodicOrbitNormalForm,
    PeriodicOrbitNormalFormType,
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackedPeriodicBranchSwitchResult {
    normal_form: PeriodicOrbitNormalForm,
    setup: LimitCycleSetup,
}

fn parse_type(value: &str) -> Result<PeriodicOrbitNormalFormType, &'static str> {
    match value {
        "branchPoint" | "BranchPoint" | "bp" => Ok(PeriodicOrbitNormalFormType::BranchPoint),
        "periodDoubling" | "PeriodDoubling" | "pd" => {
            Ok(PeriodicOrbitNormalFormType::PeriodDoubling)
        }
        "neimarkSacker" | "NeimarkSacker" | "ns" => {
            Ok(PeriodicOrbitNormalFormType::NeimarkSacker)
        }
        _ => Err(
            "Unknown periodic-orbit normal form. Expected branchPoint, periodDoubling, or neimarkSacker.",
        ),
    }
}

fn require_flow(system_type: &SystemType) -> Result<(), &'static str> {
    if matches!(system_type, SystemType::Flow) {
        Ok(())
    } else {
        Err("Periodic-orbit normal forms require a flow system.")
    }
}

#[wasm_bindgen]
impl WasmSystem {
    /// Compute a periodic-orbit normal form directly from the full persisted
    /// collocation state.  The exact saved mesh is mandatory; the setup and
    /// phase direction are reconstructed inside Rust.
    #[allow(clippy::too_many_arguments)]
    pub fn compute_periodic_normal_form_from_packed_state(
        &mut self,
        packed_state: &[f64],
        param_index: usize,
        param_value: f64,
        collocation_degree: usize,
        normalized_mesh: &[f64],
        normal_form_type: &str,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let setup = limit_cycle_setup_from_packed_state(
            &mut self.system,
            param_index,
            param_value,
            packed_state,
            collocation_degree,
            normalized_mesh.to_vec(),
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Periodic-orbit packed-state reconstruction failed: {error}"
            ))
        })?;
        let normal_form = periodic_orbit_normal_form(
            &mut self.system,
            &setup,
            param_index,
            parse_type(normal_form_type).map_err(JsValue::from_str)?,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Periodic-orbit normal-form computation failed: {error}"
            ))
        })?;
        to_value(&normal_form)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    /// Compute the generic `+1` normal form and construct its secondary-cycle
    /// predictor directly from a saved branch point.
    #[allow(clippy::too_many_arguments)]
    pub fn switch_periodic_branch_from_packed_state(
        &mut self,
        packed_state: &[f64],
        param_index: usize,
        param_value: f64,
        collocation_degree: usize,
        normalized_mesh: &[f64],
        amplitude: f64,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let setup = limit_cycle_setup_from_packed_state(
            &mut self.system,
            param_index,
            param_value,
            packed_state,
            collocation_degree,
            normalized_mesh.to_vec(),
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Periodic-orbit packed-state reconstruction failed: {error}"
            ))
        })?;
        let normal_form = periodic_orbit_normal_form(
            &mut self.system,
            &setup,
            param_index,
            PeriodicOrbitNormalFormType::BranchPoint,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Periodic branch-point normal-form computation failed: {error}"
            ))
        })?;
        let PeriodicOrbitNormalForm::BranchPoint(branch_point) = &normal_form else {
            return Err(JsValue::from_str(
                "Periodic branch-point computation returned the wrong normal-form type.",
            ));
        };
        let switched = periodic_branch_point_switch_setup(
            &mut self.system,
            &setup,
            param_index,
            branch_point,
            amplitude,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Periodic-orbit branch switching failed: {error}"))
        })?;
        to_value(&PackedPeriodicBranchSwitchResult {
            normal_form,
            setup: switched,
        })
        .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_type;
    use fork_core::continuation::PeriodicOrbitNormalFormType;

    #[test]
    fn aliases_match_product_requests() {
        assert_eq!(
            parse_type("bp").expect("BP"),
            PeriodicOrbitNormalFormType::BranchPoint
        );
        assert_eq!(
            parse_type("pd").expect("PD"),
            PeriodicOrbitNormalFormType::PeriodDoubling
        );
        assert_eq!(
            parse_type("ns").expect("NS"),
            PeriodicOrbitNormalFormType::NeimarkSacker
        );
        assert!(parse_type("unsupported").is_err());
    }
}
