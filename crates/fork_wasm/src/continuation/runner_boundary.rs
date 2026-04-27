//! Shared WASM continuation runner ownership and JS glue.

use fork_core::continuation::{
    ContinuationBranch, ContinuationPoint, ContinuationProblem, ContinuationRunner,
    ContinuationSettings,
};
use fork_core::equation_engine::EquationSystem;
use serde::Serialize;
use serde_wasm_bindgen::to_value;
use wasm_bindgen::prelude::JsValue;

pub(crate) struct OwnedContinuationRunner<P: ContinuationProblem + 'static> {
    runner: Option<ContinuationRunner<P>>,
    #[allow(dead_code)]
    system: Box<EquationSystem>,
}

impl<P: ContinuationProblem + 'static> OwnedContinuationRunner<P> {
    pub(crate) fn new<F>(
        system: EquationSystem,
        build_problem: F,
        initial_point: ContinuationPoint,
        settings: ContinuationSettings,
        forward: bool,
        problem_label: &str,
    ) -> Result<Self, JsValue>
    where
        F: FnOnce(&'static mut EquationSystem) -> anyhow::Result<P>,
    {
        let mut system = Box::new(system);
        let problem = build_problem(static_system_ref(&mut system)).map_err(|err| {
            JsValue::from_str(&format!("Failed to create {problem_label} problem: {err}"))
        })?;
        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|err| JsValue::from_str(&format!("Continuation init failed: {err}")))?;

        Ok(Self {
            runner: Some(runner),
            system,
        })
    }

    pub(crate) fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub(crate) fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let result = self
            .runner_mut()?
            .run_steps(batch_size as usize)
            .map_err(|err| JsValue::from_str(&format!("Continuation step failed: {err}")))?;
        serialize_js(&result)
    }

    pub(crate) fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        serialize_js(&runner.step_result())
    }

    pub(crate) fn take_result(&mut self) -> Result<ContinuationBranch, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;
        Ok(runner.take_result())
    }

    pub(crate) fn runner_mut(&mut self) -> Result<&mut ContinuationRunner<P>, JsValue> {
        self.runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))
    }
}

impl<P: ContinuationProblem + 'static> Drop for OwnedContinuationRunner<P> {
    fn drop(&mut self) {
        let _ = self.runner.take();
    }
}

pub(crate) fn serialize_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    to_value(value).map_err(|err| JsValue::from_str(&format!("Serialization error: {err}")))
}

pub(crate) fn static_system_ref(system: &mut Box<EquationSystem>) -> &'static mut EquationSystem {
    let system_ptr: *mut EquationSystem = system.as_mut();
    // SAFETY: OwnedContinuationRunner owns the boxed system allocation and the
    // ContinuationRunner that stores this borrow. The runner is dropped before
    // the system allocation, and no API exposes another mutable system borrow.
    unsafe { &mut *system_ptr }
}
