//! Continuation WASM bindings and helpers.
//!
//! Submodules group WasmSystem continuation methods and the various runner types
//! to keep each workflow focused and easier to navigate.

mod codim1_extension_runner;
mod curve_runners;
mod eq_runner;
mod extension_runner;
mod homoc_runner;
mod homotopy_saddle_runner;
mod lc_runner;
mod shared;
mod system_methods;

pub use codim1_extension_runner::WasmCodim1CurveExtensionRunner;
pub use curve_runners::{
    WasmFoldCurveRunner, WasmHopfCurveRunner, WasmLPCCurveRunner, WasmNSCurveRunner,
    WasmPDCurveRunner,
};
pub use eq_runner::WasmEquilibriumRunner;
pub use extension_runner::WasmContinuationExtensionRunner;
pub use homoc_runner::WasmHomoclinicRunner;
pub use homotopy_saddle_runner::WasmHomotopySaddleRunner;
pub use lc_runner::WasmLimitCycleRunner;

#[cfg(test)]
mod tests {
    use super::{
        WasmCodim1CurveExtensionRunner, WasmContinuationExtensionRunner, WasmEquilibriumRunner,
        WasmFoldCurveRunner, WasmHomoclinicRunner, WasmHomotopySaddleRunner, WasmHopfCurveRunner,
        WasmLPCCurveRunner, WasmLimitCycleRunner, WasmNSCurveRunner, WasmPDCurveRunner,
    };

    #[test]
    fn continuation_reexports_are_wired() {
        assert!(std::any::type_name::<WasmFoldCurveRunner>().ends_with("WasmFoldCurveRunner"));
        assert!(std::any::type_name::<WasmHopfCurveRunner>().ends_with("WasmHopfCurveRunner"));
        assert!(std::any::type_name::<WasmLPCCurveRunner>().ends_with("WasmLPCCurveRunner"));
        assert!(std::any::type_name::<WasmNSCurveRunner>().ends_with("WasmNSCurveRunner"));
        assert!(std::any::type_name::<WasmPDCurveRunner>().ends_with("WasmPDCurveRunner"));
        assert!(std::any::type_name::<WasmEquilibriumRunner>().ends_with("WasmEquilibriumRunner"));
        assert!(std::any::type_name::<WasmContinuationExtensionRunner>()
            .ends_with("WasmContinuationExtensionRunner"));
        assert!(std::any::type_name::<WasmCodim1CurveExtensionRunner>()
            .ends_with("WasmCodim1CurveExtensionRunner"));
        assert!(std::any::type_name::<WasmLimitCycleRunner>().ends_with("WasmLimitCycleRunner"));
        assert!(std::any::type_name::<WasmHomoclinicRunner>().ends_with("WasmHomoclinicRunner"));
        assert!(
            std::any::type_name::<WasmHomotopySaddleRunner>().ends_with("WasmHomotopySaddleRunner")
        );
    }
}
