//! Continuation WASM bindings and helpers.
//!
//! Submodules group WasmSystem continuation methods and the various runner types
//! to keep each workflow focused and easier to navigate.

mod codim1_extension_runner;
mod curve_runners;
mod cycle_manifold_2d_runner;
mod eq_manifold_1d_extension_runner;
mod eq_manifold_1d_runner;
mod eq_manifold_2d_runner;
mod eq_runner;
mod equilibrium_codim2;
mod extension_runner;
mod heteroclinic_runner;
mod heteroclinic_shooting_methods;
mod heteroclinic_shooting_runner;
mod homoc_runner;
mod homoc_shooting_methods;
mod homoc_shooting_runner;
mod homotopy_saddle_runner;
mod lc_runner;
mod manifold_2d_extension_runner;
mod map_normal_forms;
mod packed_periodic_workflows;
mod periodic_normal_forms;
mod runner_boundary;
mod shared;
mod system_methods;

pub use codim1_extension_runner::WasmCodim1CurveExtensionRunner;
pub use curve_runners::{
    WasmFoldCurveRunner, WasmHopfCurveRunner, WasmIsoperiodicCurveRunner, WasmLPCCurveRunner,
    WasmNSCurveRunner, WasmPDCurveRunner,
};
pub use cycle_manifold_2d_runner::WasmCycleManifold2DRunner;
pub use eq_manifold_1d_extension_runner::WasmEqManifold1DExtensionRunner;
pub use eq_manifold_1d_runner::WasmEqManifold1DRunner;
pub use eq_manifold_2d_runner::WasmEqManifold2DRunner;
pub use eq_runner::WasmEquilibriumRunner;
pub use extension_runner::WasmContinuationExtensionRunner;
pub use heteroclinic_runner::WasmHeteroclinicRunner;
pub use heteroclinic_shooting_runner::WasmHeteroclinicShootingRunner;
pub use homoc_runner::WasmHomoclinicRunner;
pub use homoc_shooting_runner::WasmHomoclinicShootingRunner;
pub use homotopy_saddle_runner::WasmHomotopySaddleRunner;
pub use lc_runner::WasmLimitCycleRunner;
pub use manifold_2d_extension_runner::WasmManifold2DExtensionRunner;

#[cfg(test)]
mod tests {
    use super::{
        WasmCodim1CurveExtensionRunner, WasmContinuationExtensionRunner, WasmCycleManifold2DRunner,
        WasmEqManifold1DExtensionRunner, WasmEqManifold1DRunner, WasmEqManifold2DRunner,
        WasmEquilibriumRunner, WasmFoldCurveRunner, WasmHeteroclinicRunner,
        WasmHeteroclinicShootingRunner, WasmHomoclinicRunner, WasmHomoclinicShootingRunner,
        WasmHomotopySaddleRunner, WasmHopfCurveRunner, WasmIsoperiodicCurveRunner,
        WasmLPCCurveRunner, WasmLimitCycleRunner, WasmManifold2DExtensionRunner, WasmNSCurveRunner,
        WasmPDCurveRunner,
    };

    #[test]
    fn continuation_reexports_are_wired() {
        assert!(std::any::type_name::<WasmFoldCurveRunner>().ends_with("WasmFoldCurveRunner"));
        assert!(std::any::type_name::<WasmHopfCurveRunner>().ends_with("WasmHopfCurveRunner"));
        assert!(std::any::type_name::<WasmIsoperiodicCurveRunner>()
            .ends_with("WasmIsoperiodicCurveRunner"));
        assert!(std::any::type_name::<WasmLPCCurveRunner>().ends_with("WasmLPCCurveRunner"));
        assert!(std::any::type_name::<WasmNSCurveRunner>().ends_with("WasmNSCurveRunner"));
        assert!(std::any::type_name::<WasmPDCurveRunner>().ends_with("WasmPDCurveRunner"));
        assert!(std::any::type_name::<WasmEquilibriumRunner>().ends_with("WasmEquilibriumRunner"));
        assert!(std::any::type_name::<WasmEqManifold1DRunner>().ends_with("WasmEqManifold1DRunner"));
        assert!(std::any::type_name::<WasmEqManifold1DExtensionRunner>()
            .ends_with("WasmEqManifold1DExtensionRunner"));
        assert!(std::any::type_name::<WasmEqManifold2DRunner>().ends_with("WasmEqManifold2DRunner"));
        assert!(std::any::type_name::<WasmCycleManifold2DRunner>()
            .ends_with("WasmCycleManifold2DRunner"));
        assert!(std::any::type_name::<WasmManifold2DExtensionRunner>()
            .ends_with("WasmManifold2DExtensionRunner"));
        assert!(std::any::type_name::<WasmContinuationExtensionRunner>()
            .ends_with("WasmContinuationExtensionRunner"));
        assert!(std::any::type_name::<WasmCodim1CurveExtensionRunner>()
            .ends_with("WasmCodim1CurveExtensionRunner"));
        assert!(std::any::type_name::<WasmLimitCycleRunner>().ends_with("WasmLimitCycleRunner"));
        assert!(std::any::type_name::<WasmHomoclinicRunner>().ends_with("WasmHomoclinicRunner"));
        assert!(std::any::type_name::<WasmHeteroclinicRunner>().ends_with("WasmHeteroclinicRunner"));
        assert!(std::any::type_name::<WasmHeteroclinicShootingRunner>()
            .ends_with("WasmHeteroclinicShootingRunner"));
        assert!(std::any::type_name::<WasmHomoclinicShootingRunner>()
            .ends_with("WasmHomoclinicShootingRunner"));
        assert!(
            std::any::type_name::<WasmHomotopySaddleRunner>().ends_with("WasmHomotopySaddleRunner")
        );
    }
}
