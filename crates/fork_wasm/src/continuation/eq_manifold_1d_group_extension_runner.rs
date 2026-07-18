//! Stepped runner for atomically extending a periodic-map 1D manifold group.

use fork_core::continuation::{
    extend_manifold_eq_1d_with_kind_and_periodicity, BranchType, ContinuationBranch,
    Manifold1DSettings, ManifoldDirection, ManifoldGeometry, ManifoldStability, StepResult,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::SystemKind;
use fork_core::state_periodicity::StatePeriodicity;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

enum GroupExtensionStage {
    Attempt,
    Equalize { common_final: f64, detail: String },
    Done,
}

#[wasm_bindgen]
pub struct WasmEqManifold1DGroupExtensionRunner {
    system: EquationSystem,
    kind: SystemKind,
    originals: Vec<ContinuationBranch>,
    original_lengths: Vec<f64>,
    working: Vec<Option<ContinuationBranch>>,
    settings: Manifold1DSettings,
    periodicity: StatePeriodicity,
    baseline: f64,
    requested_final: f64,
    next_branch: usize,
    completed_units: usize,
    stage: GroupExtensionStage,
    progress: StepResult,
}

fn branch_arclength(branch: &ContinuationBranch) -> Result<f64, JsValue> {
    let length = branch
        .points
        .last()
        .map(|point| point.param_value)
        .ok_or_else(|| JsValue::from_str("A manifold group branch has no endpoint."))?;
    if !length.is_finite() || length <= 0.0 {
        return Err(JsValue::from_str(
            "A manifold group branch has invalid arclength metadata.",
        ));
    }
    Ok(length)
}

fn branch_metadata(
    branch: &ContinuationBranch,
) -> Result<(ManifoldStability, ManifoldDirection, usize, usize, usize), JsValue> {
    match branch.branch_type {
        BranchType::ManifoldEq1D {
            stability,
            direction,
            eig_index,
            map_iterations: Some(iterations),
            cycle_point_index: Some(phase),
            ..
        } => Ok((stability, direction, eig_index, iterations, phase)),
        _ => Err(JsValue::from_str(
            "The manifold group contains invalid numerical metadata.",
        )),
    }
}

fn validate_group(
    branches: &[ContinuationBranch],
    iterations: usize,
    stability: ManifoldStability,
) -> Result<(), JsValue> {
    if branches.is_empty() {
        return Err(JsValue::from_str(
            "A manifold extension group cannot be empty.",
        ));
    }
    let mut plus = vec![false; iterations];
    let mut minus = vec![false; iterations];
    let mut selected_eig_index = None;
    for branch in branches {
        let (branch_stability, direction, eig_index, branch_iterations, phase) =
            branch_metadata(branch)?;
        if branch_stability != stability || branch_iterations != iterations || phase >= iterations {
            return Err(JsValue::from_str(
                "The manifold extension group has inconsistent metadata.",
            ));
        }
        if selected_eig_index.is_some_and(|index| index != eig_index) {
            return Err(JsValue::from_str(
                "The manifold extension group mixes different eigenmodes.",
            ));
        }
        selected_eig_index = Some(eig_index);
        let seen = match direction {
            ManifoldDirection::Plus => &mut plus[phase],
            ManifoldDirection::Minus => &mut minus[phase],
            ManifoldDirection::Both => {
                return Err(JsValue::from_str(
                    "Stored manifold branches must have one direction.",
                ));
            }
        };
        if *seen {
            return Err(JsValue::from_str(
                "The manifold extension group contains a duplicate phase.",
            ));
        }
        *seen = true;
    }
    for phases in [plus, minus] {
        if phases.iter().any(|value| *value) && phases.iter().any(|value| !*value) {
            return Err(JsValue::from_str(
                "The manifold extension group is missing a cycle phase.",
            ));
        }
    }
    Ok(())
}

#[wasm_bindgen]
impl WasmEqManifold1DGroupExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        map_iterations: u32,
        branches_val: JsValue,
        settings_val: JsValue,
        periods: Vec<f64>,
    ) -> Result<WasmEqManifold1DGroupExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();
        if system_type != "map" || map_iterations <= 1 {
            return Err(JsValue::from_str(
                "Group extension is only available for periodic-map manifolds.",
            ));
        }
        let kind = SystemKind::Map {
            iterations: map_iterations as usize,
        };
        let settings: Manifold1DSettings = from_value(settings_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid manifold settings: {error}")))?;
        let originals: Vec<ContinuationBranch> = from_value(branches_val)
            .map_err(|error| JsValue::from_str(&format!("Invalid manifold group: {error}")))?;
        validate_group(&originals, map_iterations as usize, settings.stability)?;
        if !settings.target_arclength.is_finite() || settings.target_arclength <= 0.0 {
            return Err(JsValue::from_str(
                "Additional common manifold arclength must be positive.",
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
        let original_lengths = originals
            .iter()
            .map(branch_arclength)
            .collect::<Result<Vec<_>, _>>()?;
        let baseline = original_lengths.iter().copied().fold(0.0_f64, f64::max);
        let current_common = original_lengths
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let requested_final = baseline + settings.target_arclength;
        let branch_count = originals.len();
        Ok(Self {
            system,
            kind,
            originals,
            original_lengths,
            working: vec![None; branch_count],
            settings,
            periodicity,
            baseline,
            requested_final,
            next_branch: 0,
            completed_units: 0,
            stage: GroupExtensionStage::Attempt,
            progress: StepResult::new(false, 0, branch_count, 0, 0, current_common),
        })
    }

    pub fn is_done(&self) -> bool {
        self.progress.done
    }

    fn extend_branch_to_total(
        &mut self,
        index: usize,
        target_total: f64,
    ) -> Result<ContinuationBranch, JsValue> {
        let branch = self.originals[index].clone();
        let additional = (target_total - self.original_lengths[index]).max(0.0);
        if additional <= 1e-10 * (1.0 + target_total) {
            return Ok(branch);
        }
        let (stability, direction, eig_index, _, phase) = branch_metadata(&branch)?;
        let mut settings = self.settings.clone();
        settings.stability = stability;
        settings.direction = direction;
        settings.eig_index = Some(eig_index);
        settings.target_arclength = additional;
        extend_manifold_eq_1d_with_kind_and_periodicity(
            &mut self.system,
            self.kind,
            branch,
            settings,
            &self.periodicity,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Map manifold group extension failed atomically while extending phase {} {:?} from arclength {} to {}. No group result was produced; raise bounds or point/iteration limits, or rebuild the manifold group. Cause: {}",
                phase + 1,
                direction,
                self.original_lengths[index],
                target_total,
                error
            ))
        })
    }

    fn finish_attempt_if_ready(&mut self) -> Result<(), JsValue> {
        if self.next_branch < self.originals.len() {
            return Ok(());
        }
        let (limiting_index, common_final) = self
            .working
            .iter()
            .enumerate()
            .map(|(index, branch)| {
                Ok((
                    index,
                    branch_arclength(branch.as_ref().ok_or_else(|| {
                        JsValue::from_str("A manifold group result is missing.")
                    })?)?,
                ))
            })
            .collect::<Result<Vec<_>, JsValue>>()?
            .into_iter()
            .min_by(|left, right| left.1.total_cmp(&right.1))
            .ok_or_else(|| JsValue::from_str("A manifold group result is missing."))?;
        if common_final + 1e-10 < self.baseline {
            return Err(JsValue::from_str(&format!(
                "A legacy manifold phase could not catch up to the existing common baseline arclength {}. Increase the point/iteration limits or rebuild the manifold group.",
                self.baseline
            )));
        }
        if common_final + 1e-10 >= self.requested_final {
            self.stage = GroupExtensionStage::Done;
            self.progress.done = true;
            self.progress.current_param = common_final;
            return Ok(());
        }
        let limiter = self.working[limiting_index]
            .as_ref()
            .ok_or_else(|| JsValue::from_str("A manifold group result is missing."))?;
        let (_, direction, _, _, phase) = branch_metadata(limiter)?;
        let reason = match limiter.manifold_geometry.as_ref() {
            Some(ManifoldGeometry::Curve(geometry)) => geometry
                .solver_diagnostics
                .as_ref()
                .map(|diagnostics| diagnostics.termination_reason.as_str())
                .unwrap_or("unknown_limit"),
            _ => "unknown_limit",
        };
        let detail = format!(
            "common arclength limited by phase {} {:?} ({})",
            phase + 1,
            direction,
            reason
        );
        self.working.fill(None);
        self.next_branch = 0;
        self.progress.max_steps = self.originals.len().saturating_mul(2);
        self.stage = GroupExtensionStage::Equalize {
            common_final,
            detail,
        };
        Ok(())
    }

    fn finish_equalization_if_ready(&mut self) -> Result<(), JsValue> {
        let (common_final, detail) = match &self.stage {
            GroupExtensionStage::Equalize {
                common_final,
                detail,
            } => (*common_final, detail.clone()),
            _ => return Ok(()),
        };
        if self.next_branch < self.originals.len() {
            return Ok(());
        }
        for branch in self.working.iter_mut().flatten() {
            let achieved = branch_arclength(branch)?;
            if (achieved - common_final).abs() > 1e-8 * (1.0 + common_final) {
                return Err(JsValue::from_str(
                    "The manifold group could not be equalized to one arclength.",
                ));
            }
            if let Some(ManifoldGeometry::Curve(geometry)) = branch.manifold_geometry.as_mut() {
                if let Some(diagnostics) = geometry.solver_diagnostics.as_mut() {
                    diagnostics.requested_arclength = self.requested_final;
                    diagnostics.achieved_arclength = common_final;
                    diagnostics.target_reached = false;
                    diagnostics.termination_reason = "group_limit".to_string();
                    diagnostics.termination_detail = Some(detail.clone());
                }
            }
        }
        self.stage = GroupExtensionStage::Done;
        self.progress.done = true;
        self.progress.current_param = common_final;
        Ok(())
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        if self.progress.done {
            return to_value(&self.progress)
                .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")));
        }
        let mut remaining = batch_size.max(1) as usize;
        while remaining > 0 && !self.progress.done {
            let target_total = match self.stage {
                GroupExtensionStage::Attempt => self.requested_final,
                GroupExtensionStage::Equalize { common_final, .. } => common_final,
                GroupExtensionStage::Done => break,
            };
            let index = self.next_branch;
            let branch = self.extend_branch_to_total(index, target_total)?;
            self.working[index] = Some(branch);
            self.next_branch += 1;
            self.completed_units += 1;
            remaining -= 1;
            match self.stage {
                GroupExtensionStage::Attempt => self.finish_attempt_if_ready()?,
                GroupExtensionStage::Equalize { .. } => self.finish_equalization_if_ready()?,
                GroupExtensionStage::Done => {}
            }
        }
        let points_computed: usize = self
            .working
            .iter()
            .enumerate()
            .filter_map(|(index, branch)| {
                branch.as_ref().map(|branch| {
                    branch
                        .points
                        .len()
                        .saturating_sub(self.originals[index].points.len())
                })
            })
            .sum();
        let current_common = self
            .working
            .iter()
            .enumerate()
            .map(|(index, branch)| match branch {
                Some(branch) => branch_arclength(branch),
                None => Ok(self.original_lengths[index]),
            })
            .collect::<Result<Vec<_>, JsValue>>()?
            .into_iter()
            .fold(f64::INFINITY, f64::min);
        self.progress.current_step = self.completed_units;
        self.progress.points_computed = points_computed;
        self.progress.current_param = current_common;
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        to_value(&self.progress)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        if !self.progress.done {
            return Err(JsValue::from_str("Runner has not finished."));
        }
        let result = self
            .working
            .iter_mut()
            .map(|branch| {
                branch
                    .take()
                    .ok_or_else(|| JsValue::from_str("Runner result has already been taken."))
            })
            .collect::<Result<Vec<_>, _>>()?;
        to_value(&result)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }
}
