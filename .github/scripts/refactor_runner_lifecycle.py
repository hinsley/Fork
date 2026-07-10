from pathlib import Path


boundary_path = Path("crates/fork_wasm/src/continuation/runner_boundary.rs")
boundary = boundary_path.read_text()

old_import = """use fork_core::continuation::{
    ContinuationBranch, ContinuationPoint, ContinuationProblem, ContinuationRunner,
    ContinuationSettings,
};
"""
new_import = """use fork_core::continuation::{
    ContinuationBranch, ContinuationPoint, ContinuationProblem, ContinuationRunner,
    ContinuationSettings, StepResult,
};
"""
if boundary.count(old_import) != 1:
    raise SystemExit("expected continuation import block")
boundary = boundary.replace(old_import, new_import, 1)

if boundary.count("use serde::Serialize;\n") != 1:
    raise SystemExit("expected serde import")
boundary = boundary.replace("use serde::Serialize;\n", "use serde::Serialize;\nuse std::fmt;\n", 1)

start_marker = "pub(crate) struct OwnedContinuationRunner"
end_marker = """impl<P: ContinuationProblem + 'static> Drop for OwnedContinuationRunner<P> {
    fn drop(&mut self) {
        let _ = self.runner.take();
    }
}
"""
start = boundary.find(start_marker)
end_start = boundary.find(end_marker, start)
if start < 0 or end_start < 0:
    raise SystemExit("expected existing owned runner lifecycle block")
end = end_start + len(end_marker)

new_lifecycle = r'''#[derive(Debug)]
pub(crate) enum RunnerHandleError {
    NotInitialized,
    Step(anyhow::Error),
}

impl fmt::Display for RunnerHandleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInitialized => formatter.write_str("Runner not initialized"),
            Self::Step(error) => write!(formatter, "Continuation step failed: {error}"),
        }
    }
}

impl std::error::Error for RunnerHandleError {}

pub(crate) struct RunnerHandle<P: ContinuationProblem> {
    runner: Option<ContinuationRunner<P>>,
}

impl<P: ContinuationProblem> RunnerHandle<P> {
    pub(crate) fn new(runner: ContinuationRunner<P>) -> Self {
        Self {
            runner: Some(runner),
        }
    }

    pub(crate) fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    pub(crate) fn run_steps(
        &mut self,
        batch_size: u32,
    ) -> Result<StepResult, RunnerHandleError> {
        self.runner_mut()?
            .run_steps(batch_size as usize)
            .map_err(RunnerHandleError::Step)
    }

    pub(crate) fn get_progress(&self) -> Result<StepResult, RunnerHandleError> {
        Ok(self.runner_ref()?.step_result())
    }

    pub(crate) fn take_result(
        &mut self,
    ) -> Result<ContinuationBranch, RunnerHandleError> {
        let runner = self
            .runner
            .take()
            .ok_or(RunnerHandleError::NotInitialized)?;
        Ok(runner.take_result())
    }

    pub(crate) fn runner_mut(
        &mut self,
    ) -> Result<&mut ContinuationRunner<P>, RunnerHandleError> {
        self.runner
            .as_mut()
            .ok_or(RunnerHandleError::NotInitialized)
    }

    pub(crate) fn run_steps_js(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let result = self.run_steps(batch_size).map_err(runner_error_to_js)?;
        serialize_js(&result)
    }

    pub(crate) fn get_progress_js(&self) -> Result<JsValue, JsValue> {
        let progress = self.get_progress().map_err(runner_error_to_js)?;
        serialize_js(&progress)
    }

    fn runner_ref(&self) -> Result<&ContinuationRunner<P>, RunnerHandleError> {
        self.runner
            .as_ref()
            .ok_or(RunnerHandleError::NotInitialized)
    }

    fn clear(&mut self) {
        let _ = self.runner.take();
    }
}

pub(crate) fn runner_error_to_js(error: RunnerHandleError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

pub(crate) struct OwnedContinuationRunner<P: ContinuationProblem + 'static> {
    runner: RunnerHandle<P>,
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
            runner: RunnerHandle::new(runner),
            system,
        })
    }

    pub(crate) fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    pub(crate) fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps_js(batch_size)
    }

    pub(crate) fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress_js()
    }

    pub(crate) fn take_result(&mut self) -> Result<ContinuationBranch, JsValue> {
        self.runner.take_result().map_err(runner_error_to_js)
    }

    pub(crate) fn runner_mut(&mut self) -> Result<&mut ContinuationRunner<P>, JsValue> {
        self.runner.runner_mut().map_err(runner_error_to_js)
    }
}

impl<P: ContinuationProblem + 'static> Drop for OwnedContinuationRunner<P> {
    fn drop(&mut self) {
        self.runner.clear();
    }
}
'''

boundary = boundary[:start] + new_lifecycle + boundary[end:]
boundary = boundary.replace(
    "// ContinuationRunner that stores this borrow. The runner is dropped before\n",
    "// RunnerHandle that stores this borrow. The runner is dropped before\n",
    1,
)
boundary_path.write_text(boundary)


eq_path = Path("crates/fork_wasm/src/continuation/eq_runner.rs")
eq = eq_path.read_text()

shared_import = "use super::shared::OwnedEquilibriumContinuationProblem;\n"
if eq.count(shared_import) != 1:
    raise SystemExit("expected equilibrium shared import")
eq = eq.replace(
    shared_import,
    "use super::runner_boundary::{runner_error_to_js, serialize_js, RunnerHandle};\n"
    + shared_import,
    1,
)

eq = eq.replace(
    "use serde_wasm_bindgen::{from_value, to_value};\n",
    "use serde_wasm_bindgen::from_value;\n",
    1,
)

old_field = "    runner: Option<ContinuationRunner<OwnedEquilibriumContinuationProblem>>,\n"
new_field = "    runner: RunnerHandle<OwnedEquilibriumContinuationProblem>,\n"
if eq.count(old_field) != 1:
    raise SystemExit("expected equilibrium runner field")
eq = eq.replace(old_field, new_field, 1)

old_constructor = """        Ok(WasmEquilibriumRunner {
            runner: Some(runner),
            periodicity,
        })
"""
new_constructor = """        Ok(WasmEquilibriumRunner {
            runner: RunnerHandle::new(runner),
            periodicity,
        })
"""
if eq.count(old_constructor) != 1:
    raise SystemExit("expected equilibrium runner constructor")
eq = eq.replace(old_constructor, new_constructor, 1)

old_methods = """    /// Check if the continuation is complete.
    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

    /// Run a batch of continuation steps and return progress.
    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner
            .run_steps(batch_size as usize)
            .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Get progress information.
    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Get the final branch result.
    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let mut branch = runner.take_result();
        wrap_equilibrium_branch(&mut branch, &self.periodicity);

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
"""
new_methods = """    /// Check if the continuation is complete.
    pub fn is_done(&self) -> bool {
        self.runner.is_done()
    }

    /// Run a batch of continuation steps and return progress.
    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        self.runner.run_steps_js(batch_size)
    }

    /// Get progress information.
    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        self.runner.get_progress_js()
    }

    /// Get the final branch result.
    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let mut branch = self.runner.take_result().map_err(runner_error_to_js)?;
        wrap_equilibrium_branch(&mut branch, &self.periodicity);
        serialize_js(&branch)
    }
"""
if eq.count(old_methods) != 1:
    raise SystemExit("expected equilibrium lifecycle methods")
eq = eq.replace(old_methods, new_methods, 1)

test_import = "    use fork_core::continuation::ContinuationSettings;\n"
if eq.count(test_import) != 1:
    raise SystemExit("expected equilibrium test import")
eq = eq.replace(
    test_import,
    test_import + "    use serde_wasm_bindgen::to_value;\n",
    1,
)

eq_path.write_text(eq)
