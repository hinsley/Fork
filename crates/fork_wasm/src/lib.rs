//! WASM bindings module map.
//!
//! - `system`: core WasmSystem wrapper and utilities.
//! - `analysis`: Lyapunov/CLV computations and runners.
//! - `continuation`: continuation workflows and stepped runners.
//! - `event_series`: analysis helpers for return/event maps.
//! - `equilibrium`: equilibrium solver runner and helpers.

mod analysis;
mod continuation;
mod equilibrium;
mod event_series;
mod system;

pub use analysis::{WasmCovariantLyapunovRunner, WasmLyapunovRunner};
pub use continuation::{
    WasmCodim1CurveExtensionRunner, WasmContinuationExtensionRunner, WasmCycleManifold2DRunner,
    WasmEqManifold1DRunner, WasmEqManifold2DRunner, WasmEquilibriumRunner, WasmFoldCurveRunner,
    WasmHomoclinicRunner, WasmHomotopySaddleRunner, WasmHopfCurveRunner, WasmIsochroneCurveRunner,
    WasmLPCCurveRunner, WasmLimitCycleRunner, WasmNSCurveRunner, WasmPDCurveRunner,
};
pub use equilibrium::WasmEquilibriumSolverRunner;
pub use system::WasmSystem;
