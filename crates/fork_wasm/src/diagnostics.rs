use fork_core::diagnostics::CalculationDiagnostic;
use serde::Serialize;
use wasm_bindgen::JsValue;

#[derive(Serialize)]
struct CalculationFailure<'a> {
    message: String,
    diagnostic: &'a CalculationDiagnostic,
}

pub(crate) fn error_to_js(error: anyhow::Error) -> JsValue {
    let message = format!("{error:#}");
    if let Some(diagnostic) = error.downcast_ref::<CalculationDiagnostic>() {
        return serde_wasm_bindgen::to_value(&CalculationFailure { message: message.clone(), diagnostic })
            .unwrap_or_else(|_| JsValue::from_str(&message));
    }
    JsValue::from_str(&message)
}
