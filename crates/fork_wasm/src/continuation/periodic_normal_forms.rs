use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::{
    periodic_branch_point_switch_setup, periodic_orbit_normal_form, LimitCycleSetup,
    PeriodicOrbitBranchPointNormalForm, PeriodicOrbitNormalFormType,
};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn parse_normal_form_type(value: &str) -> Result<PeriodicOrbitNormalFormType, JsValue> {
    match value {
        "branchPoint" | "BranchPoint" | "bp" => Ok(PeriodicOrbitNormalFormType::BranchPoint),
        "periodDoubling" | "PeriodDoubling" | "pd" => {
            Ok(PeriodicOrbitNormalFormType::PeriodDoubling)
        }
        "neimarkSacker" | "NeimarkSacker" | "ns" => {
            Ok(PeriodicOrbitNormalFormType::NeimarkSacker)
        }
        _ => Err(JsValue::from_str(
            "Unknown periodic-orbit normal form. Expected branchPoint, periodDoubling, or neimarkSacker.",
        )),
    }
}

#[wasm_bindgen]
impl WasmSystem {
    /// Compute a Poincare-return-map normal form at a corrected limit cycle.
    ///
    /// The returned tagged object contains PD, NS, or generic `+1`
    /// coefficients and residual/conditioning diagnostics.  A `+1` form is
    /// explicitly classified as either an LPC or a generic periodic branch
    /// point.
    pub fn compute_periodic_orbit_normal_form(
        &mut self,
        setup_val: JsValue,
        param_index: usize,
        normal_form_type: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(&self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Periodic-orbit normal forms require a flow system.",
            ));
        }
        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid limit cycle setup: {error}")))?;
        let normal_form_type = parse_normal_form_type(normal_form_type)?;
        let normal_form =
            periodic_orbit_normal_form(&mut self.system, &setup, param_index, normal_form_type)
                .map_err(|error| {
                    JsValue::from_str(&format!(
                        "Periodic-orbit normal-form computation failed: {error}"
                    ))
                })?;
        to_value(&normal_form)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    /// Construct a collocation predictor on the periodic branch emanating
    /// from a generic periodic branch point.
    pub fn switch_periodic_orbit_branch(
        &mut self,
        setup_val: JsValue,
        param_index: usize,
        normal_form_val: JsValue,
        amplitude: f64,
    ) -> Result<JsValue, JsValue> {
        if !matches!(&self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Periodic-orbit branch switching requires a flow system.",
            ));
        }
        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid limit cycle setup: {error}")))?;
        let normal_form: PeriodicOrbitBranchPointNormalForm =
            from_value(normal_form_val).map_err(|error| {
                JsValue::from_str(&format!(
                    "Invalid periodic branch-point normal form: {error}"
                ))
            })?;
        let switched = periodic_branch_point_switch_setup(
            &mut self.system,
            &setup,
            param_index,
            &normal_form,
            amplitude,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Periodic-orbit branch switching failed: {error}"))
        })?;
        to_value(&switched)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_normal_form_type;
    use fork_core::continuation::PeriodicOrbitNormalFormType;

    #[test]
    fn normal_form_type_aliases_match_the_web_contract() {
        assert_eq!(
            parse_normal_form_type("bp").expect("BP alias"),
            PeriodicOrbitNormalFormType::BranchPoint
        );
        assert_eq!(
            parse_normal_form_type("periodDoubling").expect("PD name"),
            PeriodicOrbitNormalFormType::PeriodDoubling
        );
        assert_eq!(
            parse_normal_form_type("ns").expect("NS alias"),
            PeriodicOrbitNormalFormType::NeimarkSacker
        );
    }
}
