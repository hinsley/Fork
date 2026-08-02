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
mod expansion_entropy;
mod forced_response;
mod system;
mod transfer_eigenmodes;
mod transfer_operator;

#[cfg(all(target_arch = "wasm32", feature = "wasm-threads"))]
use std::sync::atomic::{AtomicUsize, Ordering};

pub use analysis::{WasmCovariantLyapunovRunner, WasmLyapunovRunner};
pub use continuation::{
    WasmCodim1CurveExtensionRunner, WasmContinuationExtensionRunner, WasmCycleManifold2DRunner,
    WasmEqManifold1DExtensionRunner, WasmEqManifold1DGroupExtensionRunner, WasmEqManifold1DRunner,
    WasmEqManifold2DRunner, WasmEquilibriumRunner, WasmFoldCurveRunner, WasmHeteroclinicRunner,
    WasmHeteroclinicShootingRunner, WasmHomoclinicRunner, WasmHomoclinicShootingRunner,
    WasmHomotopySaddleRunner, WasmHopfCurveRunner, WasmIsoperiodicCurveRunner, WasmLPCCurveRunner,
    WasmLimitCycleRunner, WasmManifold2DExtensionRunner, WasmNSCurveRunner, WasmPDCurveRunner,
};
pub use equilibrium::WasmEquilibriumSolverRunner;
pub use expansion_entropy::WasmExpansionEntropyRunner;
pub use forced_response::WasmForcedResponseRunner;
pub use system::WasmSystem;
pub use transfer_eigenmodes::WasmTransferEigenmodeRunner;
pub use transfer_operator::WasmTransferOperatorRunner;

#[cfg(all(target_arch = "wasm32", feature = "wasm-threads"))]
static EXPANSION_ENTROPY_WORKER_COUNT: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(target_arch = "wasm32", feature = "wasm-threads"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn init_fork_thread_pool() -> js_sys::Promise {
    let global = js_sys::global();
    let navigator = js_sys::Reflect::get(&global, &wasm_bindgen::JsValue::from_str("navigator"))
        .unwrap_or(wasm_bindgen::JsValue::UNDEFINED);
    let hardware_concurrency = js_sys::Reflect::get(
        &navigator,
        &wasm_bindgen::JsValue::from_str("hardwareConcurrency"),
    )
    .ok()
    .and_then(|value| value.as_f64())
    .filter(|value| value.is_finite() && *value >= 1.0)
    .map(|value| value as usize)
    .unwrap_or(2);
    let worker_count = hardware_concurrency.saturating_sub(1).clamp(1, 4);
    EXPANSION_ENTROPY_WORKER_COUNT.store(worker_count, Ordering::Relaxed);
    wasm_bindgen_rayon::init_thread_pool(worker_count)
}

pub(crate) fn expansion_entropy_worker_count() -> usize {
    #[cfg(all(target_arch = "wasm32", feature = "wasm-threads"))]
    {
        return EXPANSION_ENTROPY_WORKER_COUNT.load(Ordering::Relaxed);
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "wasm-threads")))]
    {
        0
    }
}
