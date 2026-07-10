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

#[cfg(test)]
mod tests {
    use super::{RunnerHandle, RunnerHandleError};
    use crate::continuation::shared::OwnedEquilibriumContinuationProblem;
    use crate::system::build_system;
    use fork_core::continuation::{
        BifurcationType, BranchType, ContinuationPoint, ContinuationRunner,
        ContinuationSettings,
    };
    use fork_core::equilibrium::SystemKind;

    fn settings(max_steps: usize) -> ContinuationSettings {
        ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        }
    }

    fn build_handle(
        max_steps: usize,
    ) -> RunnerHandle<OwnedEquilibriumContinuationProblem> {
        let param_names = vec!["a".to_string()];
        let var_names = vec!["x".to_string()];
        let system = build_system(
            vec!["a * x".to_string()],
            vec![1.0],
            &param_names,
            &var_names,
        )
        .expect("system");
        let problem =
            OwnedEquilibriumContinuationProblem::new(system, SystemKind::Flow, 0);
        let initial_point = ContinuationPoint {
            state: vec![0.0],
            param_value: 1.0,
            stability: BifurcationType::None,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };
        let runner = ContinuationRunner::new(
            problem,
            initial_point,
            settings(max_steps),
            true,
        )
        .expect("runner");
        RunnerHandle::new(runner)
    }

    #[test]
    fn runner_handle_drives_progress_and_consumes_result() {
        let mut handle = build_handle(0);

        assert!(!handle.is_done());
        let initial = handle.get_progress().expect("initial progress");
        assert_eq!(initial.current_step, 0);
        assert!(!initial.done);

        let completed = handle.run_steps(1).expect("run steps");
        assert!(completed.done);
        assert!(handle.is_done());

        let branch = handle.take_result().expect("result");
        assert_eq!(branch.points.len(), 1);
    }

    #[test]
    fn runner_handle_exposes_mutable_runner_before_consumption() {
        let mut handle = build_handle(0);
        handle
            .runner_mut()
            .expect("runner")
            .set_branch_type(BranchType::LimitCycle { ntst: 2, ncol: 1 });

        let branch = handle.take_result().expect("result");
        assert!(matches!(
            branch.branch_type,
            BranchType::LimitCycle { ntst: 2, ncol: 1 }
        ));
    }

    #[test]
    fn runner_handle_reports_consumed_state_consistently() {
        let mut handle = build_handle(0);
        handle.take_result().expect("result");

        assert!(handle.is_done());
        assert!(matches!(
            handle.get_progress(),
            Err(RunnerHandleError::NotInitialized)
        ));
        assert!(matches!(
            handle.run_steps(1),
            Err(RunnerHandleError::NotInitialized)
        ));
        assert!(matches!(
            handle.runner_mut(),
            Err(RunnerHandleError::NotInitialized)
        ));
        assert!(matches!(
            handle.take_result(),
            Err(RunnerHandleError::NotInitialized)
        ));
    }
}
