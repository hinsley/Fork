//! Stepped runner for extending an existing 1D invariant-manifold branch.

use fork_core::continuation::{
    extend_manifold_eq_1d_with_kind_and_periodicity, ContinuationBranch, Manifold1DSettings,
    ManifoldGeometry, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;
use fork_core::state_periodicity::StatePeriodicity;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEqManifold1DExtensionRunner {
    system: EquationSystem,
    kind: SystemKind,
    branch: Option<ContinuationBranch>,
    settings: Manifold1DSettings,
    periodicity: StatePeriodicity,
    start_arclength: f64,
    target_additional_arclength: f64,
    start_point_count: usize,
    units_used: usize,
    max_units: usize,
    progress: StepResult,
}

fn curve_counters(branch: &ContinuationBranch) -> (usize, usize) {
    match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Curve(geometry)) => geometry
            .solver_diagnostics
            .as_ref()
            .map(|diagnostics| {
                (
                    diagnostics.integration_steps,
                    diagnostics.map_growth_iterations,
                )
            })
            .unwrap_or((0, 0)),
        _ => (0, 0),
    }
}

fn branch_arclength(branch: &ContinuationBranch) -> f64 {
    branch
        .points
        .last()
        .map(|point| point.param_value)
        .unwrap_or(0.0)
}

fn branch_termination_reason(branch: &ContinuationBranch) -> &str {
    match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Curve(geometry)) => geometry
            .solver_diagnostics
            .as_ref()
            .map(|diagnostics| diagnostics.termination_reason.as_str())
            .unwrap_or(""),
        _ => "",
    }
}

#[wasm_bindgen]
impl WasmEqManifold1DExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        branch_val: JsValue,
        settings_val: JsValue,
        periods: Vec<f64>,
    ) -> Result<WasmEqManifold1DExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();
        let kind = match system_type {
            "map" => SystemKind::Map {
                iterations: map_iterations as usize,
            },
            _ => SystemKind::Flow,
        };
        let settings: Manifold1DSettings = from_value(settings_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid manifold settings: {}", error)))?;
        let branch: ContinuationBranch = from_value(branch_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid manifold branch: {}", error)))?;
        if branch.points.len() < 2 {
            return Err(JsValue::from_str(
                "A 1D manifold branch needs at least two points before extension.",
            ));
        }

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for equation in equations {
            let expression = parse(&equation).map_err(|error| JsValue::from_str(&error))?;
            bytecodes.push(
                compiler
                    .try_compile(&expression)
                    .map_err(|error| JsValue::from_str(&error))?,
            );
        }
        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);
        let periodicity = StatePeriodicity::from_periods(&periods, var_names.len());
        let max_units = match kind {
            SystemKind::Flow => {
                let time_limited_steps =
                    (settings.caps.max_time / settings.integration_dt.abs()).ceil() as usize;
                settings.caps.max_steps.min(time_limited_steps.max(1))
            }
            SystemKind::Map { .. } => settings
                .caps
                .max_iterations
                .unwrap_or(settings.caps.max_steps),
        }
        .max(1);
        let start_arclength = branch_arclength(&branch);
        let start_point_count = branch.points.len();
        let target_additional_arclength = settings.target_arclength;
        Ok(Self {
            system,
            kind,
            branch: Some(branch),
            settings,
            periodicity,
            start_arclength,
            target_additional_arclength,
            start_point_count,
            units_used: 0,
            max_units,
            progress: StepResult::new(false, 0, max_units, 0, 0, start_arclength),
        })
    }

    pub fn is_done(&self) -> bool {
        self.progress.done
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        if self.progress.done {
            return to_value(&self.progress)
                .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)));
        }
        let branch = self
            .branch
            .take()
            .ok_or_else(|| JsValue::from_str("Runner is missing its branch state."))?;
        let current_arclength = branch_arclength(&branch);
        let achieved = (current_arclength - self.start_arclength).max(0.0);
        let remaining_target = (self.target_additional_arclength - achieved).max(0.0);
        let remaining_units = self.max_units.saturating_sub(self.units_used);
        if remaining_target <= 1e-12 || remaining_units == 0 {
            self.progress.done = true;
            self.branch = Some(branch);
            return to_value(&self.progress)
                .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)));
        }

        let budget = (batch_size.max(1) as usize).min(remaining_units);
        let points_added = branch.points.len().saturating_sub(self.start_point_count);
        let remaining_point_budget = self.settings.caps.max_points.saturating_sub(points_added);
        if remaining_point_budget < 2 {
            self.progress.done = true;
            self.branch = Some(branch);
            return to_value(&self.progress)
                .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)));
        }
        let before_counters = curve_counters(&branch);
        let before_count = branch.points.len();
        let mut batch_settings = self.settings.clone();
        batch_settings.target_arclength = remaining_target;
        batch_settings.caps.max_points = remaining_point_budget;
        match self.kind {
            SystemKind::Flow => {
                let dt = self.settings.integration_dt.abs();
                let remaining_time =
                    (self.settings.caps.max_time - (self.units_used as f64) * dt).max(0.0);
                batch_settings.caps.max_time = remaining_time;
                let steps_to_time_cap = (remaining_time / dt).ceil() as usize;
                batch_settings.caps.max_steps = if steps_to_time_cap <= budget {
                    budget.saturating_add(1)
                } else {
                    budget
                };
            }
            SystemKind::Map { .. } => batch_settings.caps.max_iterations = Some(budget),
        }
        let branch = extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut self.system,
            self.kind,
            branch,
            batch_settings,
            &self.periodicity,
        )
        .map_err(|error| JsValue::from_str(&format!("1D manifold extension failed: {}", error)))?;
        let after_counters = curve_counters(&branch);
        let units_advanced = match self.kind {
            SystemKind::Flow => after_counters.0.saturating_sub(before_counters.0),
            SystemKind::Map { .. } => after_counters.1.saturating_sub(before_counters.1),
        };
        self.units_used = self.units_used.saturating_add(units_advanced.min(budget));
        let current_arclength = branch_arclength(&branch);
        let achieved = (current_arclength - self.start_arclength).max(0.0);
        let target_reached = achieved + 1e-10 >= self.target_additional_arclength;
        let reason = branch_termination_reason(&branch);
        let retryable_cap = matches!(reason, "max_steps" | "max_iterations");
        let made_progress = branch.points.len() > before_count;
        let done = target_reached
            || self.units_used >= self.max_units
            || branch.points.len().saturating_sub(self.start_point_count)
                >= self.settings.caps.max_points.saturating_sub(1)
            || (!retryable_cap && !target_reached)
            || !made_progress;
        self.progress = StepResult::new(
            done,
            self.units_used,
            self.max_units,
            branch.points.len().saturating_sub(self.start_point_count),
            0,
            current_arclength,
        );
        self.branch = Some(branch);
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        if !self.progress.done {
            return Err(JsValue::from_str("Runner has not finished."));
        }
        let branch = self
            .branch
            .take()
            .ok_or_else(|| JsValue::from_str("Runner result has already been taken."))?;
        to_value(&branch)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }
}
