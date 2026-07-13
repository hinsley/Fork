use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::{
    hopf_hopf_equilibrium_curve_seeds, hopf_hopf_neimark_sacker_seeds,
    hopf_hopf_normal_form as compute_hopf_hopf_normal_form, zero_hopf_equilibrium_curve_seeds,
    zero_hopf_neimark_sacker_seed, zero_hopf_normal_form as compute_zero_hopf_normal_form,
    Codim2BranchSeed, HopfHopfNormalForm, ZeroHopfNormalForm,
};
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ZeroHopfSwitchResult {
    normal_form: ZeroHopfNormalForm,
    equilibrium_curve_seeds: Vec<Codim2BranchSeed>,
    neimark_sacker_seed: Option<Codim2BranchSeed>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HopfHopfSwitchResult {
    normal_form: HopfHopfNormalForm,
    hopf_curve_seeds: Vec<Codim2BranchSeed>,
    neimark_sacker_seeds: Vec<Codim2BranchSeed>,
}

fn require_flow(system_type: &SystemType) -> Result<(), &'static str> {
    if matches!(system_type, SystemType::Flow) {
        Ok(())
    } else {
        Err("Zero-Hopf and Hopf-Hopf normal forms require a flow system.")
    }
}

fn serialize<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    to_value(value).map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
}

#[wasm_bindgen]
impl WasmSystem {
    /// Compute detailed, serializable Zero-Hopf coefficients and numerical
    /// conditioning diagnostics at a refined equilibrium codimension-two
    /// point.
    #[allow(clippy::too_many_arguments)]
    pub fn compute_zero_hopf_normal_form(
        &mut self,
        state: &[f64],
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        frequency: f64,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let normal_form = compute_zero_hopf_normal_form(
            &mut self.system,
            state,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            frequency,
        )
        .map_err(|error| JsValue::from_str(&format!("Zero-Hopf normal form failed: {error}")))?;
        serialize(&normal_form)
    }

    /// Compute detailed, serializable nonresonant Hopf-Hopf coefficients and
    /// both NS unfolding predictors.
    #[allow(clippy::too_many_arguments)]
    pub fn compute_hopf_hopf_normal_form(
        &mut self,
        state: &[f64],
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        source_frequency: f64,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let normal_form = compute_hopf_hopf_normal_form(
            &mut self.system,
            state,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            source_frequency,
        )
        .map_err(|error| JsValue::from_str(&format!("Hopf-Hopf normal form failed: {error}")))?;
        serialize(&normal_form)
    }

    /// Produce corrected Zero-Hopf switches to both fold/Hopf orientations
    /// and, when the coefficient sign condition permits it, the periodic-orbit
    /// Neimark-Sacker curve.
    #[allow(clippy::too_many_arguments)]
    pub fn switch_from_zero_hopf(
        &mut self,
        state: &[f64],
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        frequency: f64,
        curve_perturbation: f64,
        cycle_amplitude: f64,
        ntst: usize,
        ncol: usize,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let normal_form = compute_zero_hopf_normal_form(
            &mut self.system,
            state,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            frequency,
        )
        .map_err(|error| JsValue::from_str(&format!("Zero-Hopf normal form failed: {error}")))?;
        let equilibrium_curve_seeds = zero_hopf_equilibrium_curve_seeds(
            &mut self.system,
            &normal_form,
            curve_perturbation,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Zero-Hopf equilibrium branch switching failed: {error}"
            ))
        })?;
        let neimark_sacker_seed = zero_hopf_neimark_sacker_seed(
            &mut self.system,
            &normal_form,
            cycle_amplitude,
            ntst,
            ncol,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Zero-Hopf NS branch switching failed: {error}"))
        })?;
        serialize(&ZeroHopfSwitchResult {
            normal_form,
            equilibrium_curve_seeds,
            neimark_sacker_seed,
        })
    }

    /// Produce corrected Hopf-Hopf switches to both orientations of both Hopf
    /// curves and to both periodic-orbit Neimark-Sacker curves.
    #[allow(clippy::too_many_arguments)]
    pub fn switch_from_hopf_hopf(
        &mut self,
        state: &[f64],
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        source_frequency: f64,
        curve_perturbation: f64,
        cycle_amplitude: f64,
        ntst: usize,
        ncol: usize,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        require_flow(&self.system_type).map_err(JsValue::from_str)?;
        let normal_form = compute_hopf_hopf_normal_form(
            &mut self.system,
            state,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            source_frequency,
        )
        .map_err(|error| JsValue::from_str(&format!("Hopf-Hopf normal form failed: {error}")))?;
        let hopf_curve_seeds = hopf_hopf_equilibrium_curve_seeds(
            &mut self.system,
            &normal_form,
            curve_perturbation,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Hopf-Hopf Hopf branch switching failed: {error}"))
        })?;
        let neimark_sacker_seeds = hopf_hopf_neimark_sacker_seeds(
            &mut self.system,
            &normal_form,
            cycle_amplitude,
            ntst,
            ncol,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!("Hopf-Hopf NS branch switching failed: {error}"))
        })?;
        serialize(&HopfHopfSwitchResult {
            normal_form,
            hopf_curve_seeds,
            neimark_sacker_seeds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::require_flow;
    use crate::system::SystemType;

    #[test]
    fn equilibrium_codim_two_entrypoints_reject_maps() {
        assert!(require_flow(&SystemType::Flow).is_ok());
        assert!(require_flow(&SystemType::Map).is_err());
    }
}
