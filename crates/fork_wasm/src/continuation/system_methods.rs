//! WasmSystem continuation methods.

use super::curve_runners::normalize_lc_seed_for_stage_first_explicit;
use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::codim1_curves::{
    estimate_hopf_kappa_from_jacobian, estimate_map_ns_cosine_from_jacobian, refine_codim2_points,
};
use fork_core::continuation::equilibrium::{
    compute_eigenvalues_for_state, continue_parameter as core_continuation,
    extend_branch as core_extend_branch, map_cycle_seed_from_pd,
};
use fork_core::continuation::{
    bogdanov_takens_curve_seeds, bogdanov_takens_homoclinic_seed,
    compute_limit_cycle_floquet_modes as core_compute_limit_cycle_floquet_modes,
    compute_limit_cycle_floquet_modes_on_mesh as core_compute_limit_cycle_floquet_modes_on_mesh,
    compute_limit_cycle_floquet_modes_on_mesh_with_backend as core_compute_limit_cycle_floquet_modes_on_mesh_with_backend,
    compute_limit_cycle_floquet_modes_with_backend as core_compute_limit_cycle_floquet_modes_with_backend,
    continue_homoclinic_curve, continue_homotopy_saddle_curve, continue_limit_cycle_collocation,
    continue_limit_cycle_manifold_2d, continue_limit_cycle_manifold_2d_with_progress,
    continue_manifold_eq_1d_with_kind_and_periodicity, continue_manifold_eq_2d,
    continue_manifold_eq_2d_with_progress, continue_with_problem, extend_limit_cycle_collocation,
    extend_limit_cycle_manifold_2d_with_progress, extend_manifold_eq_2d_with_progress,
    generalized_hopf_lpc_seed, homoclinic_setup_from_homoclinic_point_with_source_extras,
    homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh,
    homoclinic_setup_from_homotopy_saddle_point, homoclinic_setup_from_large_cycle,
    homoclinic_setup_from_large_cycle_on_mesh, homotopy_saddle_setup_from_equilibrium,
    limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit, limit_cycle_setup_from_pd,
    limit_cycle_setup_from_pd_on_mesh, uniform_normalized_mesh, BranchType, Codim1CurveBranch,
    Codim1CurvePoint, Codim1CurveType, Codim2Bifurcation, Codim2BifurcationType, CollocationConfig,
    ContinuationBranch, ContinuationSettings, FloquetBackend, FoldCurveProblem,
    HomoclinicExtraFlags, HomoclinicFixedScalars, HomoclinicSetup, HomotopySaddleSetup,
    HopfCurveProblem, IsoperiodicCurveProblem, LPCCurveProblem, LimitCycleSetup,
    Manifold1DSettings, Manifold2DSettings, ManifoldCycle2DSettings, ManifoldGeometry,
    ManifoldSurfaceResumeState, NSCurveProblem, OrbitTimeMode, PDCurveProblem, StepResult,
};
use fork_core::equilibrium::{compute_jacobian, compute_system_jacobian, SystemKind};
use fork_core::traits::DynamicalSystem;
use js_sys::Function;
use nalgebra::DMatrix;
use num_complex::Complex;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::{from_value, to_value};
use std::collections::BTreeMap;

fn parse_floquet_backend(value: &str) -> Result<FloquetBackend, JsValue> {
    match value {
        "auto" => Ok(FloquetBackend::Auto),
        "periodic_schur" => Ok(FloquetBackend::PeriodicSchur),
        "block_cyclic" => Ok(FloquetBackend::BlockCyclic),
        _ => Err(JsValue::from_str(&format!(
            "Unknown Floquet backend '{}'; expected auto, periodic_schur, or block_cyclic.",
            value
        ))),
    }
}
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Deserialize)]
struct ComplexWire {
    re: f64,
    im: f64,
}

fn split_pd_curve_output_state(state: &[f64], explicit_lc_len: usize) -> Option<(Vec<f64>, f64)> {
    if state.len() < explicit_lc_len + 2 {
        return None;
    }
    Some((
        state[..explicit_lc_len + 1].to_vec(),
        state[explicit_lc_len + 1],
    ))
}

fn validate_limit_cycle_system_type(system_type: &SystemType) -> Result<(), &'static str> {
    if matches!(system_type, SystemType::Flow) {
        Ok(())
    } else {
        Err("Limit-cycle collocation is available for flow systems only.")
    }
}

fn manifold_ring_count(branch: &ContinuationBranch) -> usize {
    match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(surface)) => surface.ring_offsets.len(),
        _ => 0,
    }
}

fn manifold_surface_arclength(branch: &ContinuationBranch) -> f64 {
    let resume_state = match branch.manifold_geometry.as_ref() {
        Some(ManifoldGeometry::Surface(surface)) => surface.resume_state.as_deref(),
        _ => None,
    };
    match resume_state {
        Some(ManifoldSurfaceResumeState::GeodesicRings {
            accumulated_arclength,
            ..
        }) => *accumulated_arclength,
        Some(ManifoldSurfaceResumeState::HkoIsochronFibers {
            emitted_arclength, ..
        })
        | Some(ManifoldSurfaceResumeState::SegmentedPreimageFibers {
            emitted_arclength, ..
        }) => *emitted_arclength,
        None => 0.0,
    }
}

enum Manifold2DExtensionSettings {
    Equilibrium(Manifold2DSettings),
    Cycle(ManifoldCycle2DSettings),
}

impl Manifold2DExtensionSettings {
    fn target_arclength(&self) -> f64 {
        match self {
            Self::Equilibrium(settings) => settings.target_arclength,
            Self::Cycle(settings) => settings.target_arclength,
        }
    }
}

fn arclength_progress_step(arclength: f64) -> usize {
    if !arclength.is_finite() || arclength <= 0.0 {
        0
    } else if arclength >= (usize::MAX as f64) {
        usize::MAX
    } else {
        arclength.floor() as usize
    }
}

fn arclength_progress_max(target_arclength: f64) -> usize {
    if !target_arclength.is_finite() || target_arclength <= 0.0 {
        1
    } else if target_arclength >= (usize::MAX as f64) {
        usize::MAX
    } else {
        (target_arclength.ceil() as usize).max(1)
    }
}

fn emit_progress(callback: &Function, progress: StepResult) -> Result<(), JsValue> {
    let payload = to_value(&progress)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;
    callback
        .call1(&JsValue::NULL, &payload)
        .map(|_| ())
        .map_err(|err| {
            if err.is_string() {
                err
            } else {
                JsValue::from_str("Progress callback threw an error.")
            }
        })
}

#[wasm_bindgen]
impl WasmSystem {
    pub fn compute_continuation(
        &mut self,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        map_iterations: u32,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let branch = core_continuation(
            &mut self.system,
            kind,
            &equilibrium_state,
            param_index,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Continuation failed: {}", e)))?;

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn extend_continuation(
        &mut self,
        branch_val: JsValue,
        parameter_name: &str,
        map_iterations: u32,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

        if branch.points.is_empty() {
            return Err(JsValue::from_str("Branch has no points"));
        }

        if branch.indices.len() != branch.points.len() {
            branch.indices = (0..branch.points.len() as i32).collect();
        }

        let endpoint_idx = if forward {
            branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
        } else {
            branch
                .indices
                .iter()
                .enumerate()
                .min_by_key(|(_, &idx)| idx)
                .map(|(pos, _)| pos)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
        };

        // Auto-recover missing upoldp for LimitCycle branches
        if matches!(&branch.branch_type, BranchType::LimitCycle { .. }) {
            if branch.upoldp.is_none() {
                let endpoint = &branch.points[endpoint_idx];
                let dim = self.system.equations.len();
                if endpoint.state.len() > dim {
                    let x0 = &endpoint.state[0..dim];
                    let period = *endpoint.state.last().unwrap_or(&1.0);
                    let mut work = vec![0.0; dim];
                    self.system.apply(0.0, x0, &mut work);
                    // x'(0) = T * f(x0) (approx tangent for phase condition)
                    let u0: Vec<f64> = work.iter().map(|&v| v * period).collect();
                    branch.upoldp = Some(vec![u0]);
                }
            }
        }

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let updated_branch = match &branch.branch_type {
            BranchType::Equilibrium => {
                let kind = match self.system_type {
                    SystemType::Flow => SystemKind::Flow,
                    SystemType::Map => SystemKind::Map {
                        iterations: map_iterations as usize,
                    },
                };
                core_extend_branch(
                    &mut self.system,
                    kind,
                    branch,
                    param_index,
                    settings,
                    forward,
                )
                .map_err(|e| JsValue::from_str(&format!("Branch extension failed: {}", e)))?
            }
            BranchType::LimitCycle {
                ntst,
                ncol,
                normalized_mesh,
            } => {
                validate_limit_cycle_system_type(&self.system_type).map_err(JsValue::from_str)?;
                // Extract phase anchor and direction from upoldp
                let upoldp = branch
                    .upoldp
                    .clone()
                    .ok_or_else(|| JsValue::from_str("Limit cycle branch missing upoldp data"))?;

                // Use first point of upoldp as phase direction reference
                let phase_direction = if !upoldp.is_empty() && !upoldp[0].is_empty() {
                    let dir_norm: f64 = upoldp[0].iter().map(|v| v * v).sum::<f64>().sqrt();
                    if dir_norm > 1e-12 {
                        upoldp[0].iter().map(|v| v / dir_norm).collect()
                    } else {
                        upoldp[0].clone()
                    }
                } else {
                    vec![1.0] // Fallback
                };

                // Anchor phase at the signed-index endpoint that is being extended.
                let endpoint = &branch.points[endpoint_idx];
                let dim = self.system.equations.len();
                let phase_anchor: Vec<f64> = endpoint.state.iter().take(dim).cloned().collect();

                let config = CollocationConfig {
                    mesh_points: *ntst,
                    degree: *ncol,
                    phase_anchor,
                    phase_direction,
                    normalized_mesh: normalized_mesh.clone(),
                };
                extend_limit_cycle_collocation(
                    &mut self.system,
                    param_index,
                    config,
                    branch,
                    settings,
                    forward,
                )
                .map_err(|e| JsValue::from_str(&format!("LC branch extension failed: {}", e)))?
            }
            BranchType::HomoclinicCurve { .. } | BranchType::HomotopySaddleCurve { .. } => {
                return Err(JsValue::from_str(
                    "Branch extension for homoclinic and homotopy-saddle curves is not available yet.",
                ))
            }
            BranchType::ManifoldEq1D { .. }
            | BranchType::ManifoldEq2D { .. }
            | BranchType::ManifoldCycle2D { .. } => {
                return Err(JsValue::from_str(
                    "Branch extension for invariant manifold branches is not available yet.",
                ))
            }
        };

        to_value(&updated_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_equilibrium_eigenvalues(
        &mut self,
        state: Vec<f64>,
        parameter_name: &str,
        map_iterations: u32,
        param_value: f64,
    ) -> Result<JsValue, JsValue> {
        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        if state.len() != self.system.equations.len() {
            return Err(JsValue::from_str(
                "State dimension mismatch for eigenvalue computation.",
            ));
        }

        let eigenvalues =
            compute_eigenvalues_for_state(&mut self.system, kind, &state, param_index, param_value)
                .map_err(|e| JsValue::from_str(&format!("Eigenvalue computation failed: {}", e)))?;

        to_value(&eigenvalues)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_eq_manifold_1d(
        &mut self,
        equilibrium_state: Vec<f64>,
        map_iterations: u32,
        settings_val: JsValue,
    ) -> Result<JsValue, JsValue> {
        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };
        let settings: Manifold1DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let branches = continue_manifold_eq_1d_with_kind_and_periodicity(
            &mut self.system,
            kind,
            &equilibrium_state,
            settings,
            &self.periodicity,
        )
        .map_err(|e| JsValue::from_str(&format!("1D manifold computation failed: {}", e)))?;
        to_value(&branches).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_eq_manifold_2d(
        &mut self,
        equilibrium_state: Vec<f64>,
        settings_val: JsValue,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }
        let settings: Manifold2DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let branch = continue_manifold_eq_2d(&mut self.system, &equilibrium_state, settings)
            .map_err(|e| JsValue::from_str(&format!("2D manifold computation failed: {}", e)))?;
        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_eq_manifold_2d_with_progress(
        &mut self,
        equilibrium_state: Vec<f64>,
        settings_val: JsValue,
        progress_callback: Function,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }
        let settings: Manifold2DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let max_arclength_steps = arclength_progress_max(settings.target_arclength.max(0.0));
        let mut callback_error: Option<JsValue> = None;
        let mut latest_arclength = 0.0f64;
        let mut latest_radius = 0.0f64;
        let mut on_ring_progress = |rings: usize, points: usize, arclength: f64, radius: f64| {
            if callback_error.is_some() {
                return;
            }
            latest_arclength = arclength;
            latest_radius = radius;
            let arclength_step = arclength_progress_step(arclength);
            let max_step = max_arclength_steps.max(arclength_step.max(1));
            let progress = StepResult::new(
                false,
                arclength_step.min(max_step),
                max_step,
                points,
                0,
                radius,
            )
            .with_rings_computed(rings);
            if let Err(err) = emit_progress(&progress_callback, progress) {
                callback_error = Some(err);
            }
        };
        let branch = continue_manifold_eq_2d_with_progress(
            &mut self.system,
            &equilibrium_state,
            settings,
            Some(&mut on_ring_progress),
        )
        .map_err(|e| JsValue::from_str(&format!("2D manifold computation failed: {}", e)))?;
        if let Some(err) = callback_error {
            return Err(err);
        }
        let rings = manifold_ring_count(&branch);
        let final_arclength_step = arclength_progress_step(latest_arclength);
        let final_max_step = max_arclength_steps.max(final_arclength_step.max(1));
        let final_progress = StepResult::new(
            true,
            final_arclength_step.min(final_max_step),
            final_max_step,
            branch.points.len(),
            0,
            latest_radius,
        )
        .with_rings_computed(rings);
        emit_progress(&progress_callback, final_progress)?;
        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_cycle_manifold_2d(
        &mut self,
        cycle_state: Vec<f64>,
        ntst: u32,
        ncol: u32,
        floquet_multipliers_val: JsValue,
        settings_val: JsValue,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }
        let settings: ManifoldCycle2DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let floquet_wire: Vec<ComplexWire> = from_value(floquet_multipliers_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid Floquet multipliers: {}", e)))?;
        let floquet_multipliers = floquet_wire
            .into_iter()
            .map(|value| Complex::new(value.re, value.im))
            .collect::<Vec<_>>();
        let branch = continue_limit_cycle_manifold_2d(
            &mut self.system,
            &cycle_state,
            ntst as usize,
            ncol as usize,
            &floquet_multipliers,
            settings,
        )
        .map_err(|e| JsValue::from_str(&format!("Cycle manifold computation failed: {}", e)))?;
        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_cycle_manifold_2d_with_progress(
        &mut self,
        cycle_state: Vec<f64>,
        ntst: u32,
        ncol: u32,
        floquet_multipliers_val: JsValue,
        settings_val: JsValue,
        progress_callback: Function,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Invariant manifolds are currently available for flow systems only.",
            ));
        }
        let settings: ManifoldCycle2DSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold settings: {}", e)))?;
        let max_arclength_steps = arclength_progress_max(settings.target_arclength.max(0.0));
        let floquet_wire: Vec<ComplexWire> = from_value(floquet_multipliers_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid Floquet multipliers: {}", e)))?;
        let floquet_multipliers = floquet_wire
            .into_iter()
            .map(|value| Complex::new(value.re, value.im))
            .collect::<Vec<_>>();
        let mut callback_error: Option<JsValue> = None;
        let mut latest_arclength = 0.0f64;
        let mut latest_radius = 0.0f64;
        let mut on_ring_progress = |rings: usize, points: usize, arclength: f64, radius: f64| {
            if callback_error.is_some() {
                return;
            }
            latest_arclength = arclength;
            latest_radius = radius;
            let arclength_step = arclength_progress_step(arclength);
            let max_step = max_arclength_steps.max(arclength_step.max(1));
            let progress = StepResult::new(
                false,
                arclength_step.min(max_step),
                max_step,
                points,
                0,
                radius,
            )
            .with_rings_computed(rings);
            if let Err(err) = emit_progress(&progress_callback, progress) {
                callback_error = Some(err);
            }
        };
        let branch = continue_limit_cycle_manifold_2d_with_progress(
            &mut self.system,
            &cycle_state,
            ntst as usize,
            ncol as usize,
            &floquet_multipliers,
            settings,
            Some(&mut on_ring_progress),
        )
        .map_err(|e| JsValue::from_str(&format!("Cycle manifold computation failed: {}", e)))?;
        if let Some(err) = callback_error {
            return Err(err);
        }
        let rings = manifold_ring_count(&branch);
        let final_arclength_step = arclength_progress_step(latest_arclength);
        let final_max_step = max_arclength_steps.max(final_arclength_step.max(1));
        let final_progress = StepResult::new(
            true,
            final_arclength_step.min(final_max_step),
            final_max_step,
            branch.points.len(),
            0,
            latest_radius,
        )
        .with_rings_computed(rings);
        emit_progress(&progress_callback, final_progress)?;
        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Extend a persisted 2D manifold while reporting each accepted new ring.
    pub fn extend_manifold_2d_with_progress(
        &mut self,
        branch_val: JsValue,
        settings_val: JsValue,
        progress_callback: Function,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "2D invariant-manifold extension is available for flow systems only.",
            ));
        }
        let branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifold branch: {}", e)))?;
        let extension_settings = match &branch.branch_type {
            BranchType::ManifoldEq2D { .. } => {
                Manifold2DExtensionSettings::Equilibrium(from_value(settings_val).map_err(|e| {
                    JsValue::from_str(&format!("Invalid equilibrium manifold settings: {}", e))
                })?)
            }
            BranchType::ManifoldCycle2D { .. } => {
                Manifold2DExtensionSettings::Cycle(from_value(settings_val).map_err(|e| {
                    JsValue::from_str(&format!("Invalid cycle manifold settings: {}", e))
                })?)
            }
            _ => {
                return Err(JsValue::from_str(
                    "Only 2D equilibrium or limit-cycle manifold branches can be extended.",
                ));
            }
        };

        let start_arclength = manifold_surface_arclength(&branch);
        let start_rings = manifold_ring_count(&branch);
        let start_points = branch.points.len();
        let target_arclength = extension_settings.target_arclength().max(0.0);
        let max_arclength_steps = arclength_progress_max(target_arclength);
        emit_progress(
            &progress_callback,
            StepResult::new(false, 0, max_arclength_steps, 0, 0, 0.0).with_rings_computed(0),
        )?;

        let mut callback_error: Option<JsValue> = None;
        let mut latest_arclength = 0.0f64;
        let mut latest_radius = 0.0f64;
        let mut on_ring_progress = |rings: usize, points: usize, arclength: f64, radius: f64| {
            if callback_error.is_some() {
                return;
            }
            latest_arclength = (arclength - start_arclength).max(0.0);
            latest_radius = radius;
            let arclength_step = arclength_progress_step(latest_arclength);
            let max_step = max_arclength_steps.max(arclength_step.max(1));
            let progress = StepResult::new(
                false,
                arclength_step.min(max_step),
                max_step,
                points,
                0,
                radius,
            )
            .with_rings_computed(rings.saturating_sub(start_rings));
            if let Err(err) = emit_progress(&progress_callback, progress) {
                callback_error = Some(err);
            }
        };

        let extended = match extension_settings {
            Manifold2DExtensionSettings::Equilibrium(settings) => {
                extend_manifold_eq_2d_with_progress(
                    &mut self.system,
                    branch,
                    settings,
                    Some(&mut on_ring_progress),
                )
            }
            Manifold2DExtensionSettings::Cycle(settings) => {
                extend_limit_cycle_manifold_2d_with_progress(
                    &mut self.system,
                    branch,
                    settings,
                    Some(&mut on_ring_progress),
                )
            }
        }
        .map_err(|e| JsValue::from_str(&format!("2D manifold extension failed: {}", e)))?;
        if let Some(err) = callback_error {
            return Err(err);
        }

        let rings = manifold_ring_count(&extended).saturating_sub(start_rings);
        let points = extended.points.len().saturating_sub(start_points);
        let final_step = arclength_progress_step(latest_arclength);
        let final_max_step = max_arclength_steps.max(final_step.max(1));
        emit_progress(
            &progress_callback,
            StepResult::new(
                true,
                final_step.min(final_max_step),
                final_max_step,
                points,
                0,
                latest_radius,
            )
            .with_rings_computed(rings),
        )?;
        to_value(&extended).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_limit_cycle_floquet_modes(
        &mut self,
        cycle_state: Vec<f64>,
        ntst: u32,
        ncol: u32,
        parameter_name: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Floquet mode computation is currently available for flow systems only.",
            ));
        }
        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let result = core_compute_limit_cycle_floquet_modes(
            &mut self.system,
            param_index,
            &cycle_state,
            ntst as usize,
            ncol as usize,
        )
        .map_err(|e| JsValue::from_str(&format!("Floquet mode computation failed: {}", e)))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_limit_cycle_floquet_modes_with_backend(
        &mut self,
        cycle_state: Vec<f64>,
        ntst: u32,
        ncol: u32,
        parameter_name: &str,
        backend: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Floquet mode computation is currently available for flow systems only.",
            ));
        }
        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let result = core_compute_limit_cycle_floquet_modes_with_backend(
            &mut self.system,
            param_index,
            &cycle_state,
            ntst as usize,
            ncol as usize,
            parse_floquet_backend(backend)?,
        )
        .map_err(|e| JsValue::from_str(&format!("Floquet mode computation failed: {}", e)))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_limit_cycle_floquet_modes_on_mesh(
        &mut self,
        cycle_state: Vec<f64>,
        ncol: u32,
        normalized_mesh: Vec<f64>,
        parameter_name: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Floquet mode computation is currently available for flow systems only.",
            ));
        }
        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let result = core_compute_limit_cycle_floquet_modes_on_mesh(
            &mut self.system,
            param_index,
            &cycle_state,
            ncol as usize,
            normalized_mesh,
        )
        .map_err(|e| JsValue::from_str(&format!("Floquet mode computation failed: {}", e)))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_limit_cycle_floquet_modes_on_mesh_with_backend(
        &mut self,
        cycle_state: Vec<f64>,
        ncol: u32,
        normalized_mesh: Vec<f64>,
        parameter_name: &str,
        backend: &str,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Floquet mode computation is currently available for flow systems only.",
            ));
        }
        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let result = core_compute_limit_cycle_floquet_modes_on_mesh_with_backend(
            &mut self.system,
            param_index,
            &cycle_state,
            ncol as usize,
            normalized_mesh,
            parse_floquet_backend(backend)?,
        )
        .map_err(|e| JsValue::from_str(&format!("Floquet mode computation failed: {}", e)))?;
        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Initializes a limit cycle guess from a Hopf bifurcation point.
    /// Returns the LimitCycleSetup as a serialized JsValue.
    pub fn init_lc_from_hopf(
        &mut self,
        hopf_state: Vec<f64>,
        parameter_name: &str,
        param_value: f64,
        amplitude: f64,
        ntst: u32,
        ncol: u32,
    ) -> Result<JsValue, JsValue> {
        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let setup = limit_cycle_setup_from_hopf(
            &mut self.system,
            param_index,
            &hopf_state,
            param_value,
            ntst as usize,
            ncol as usize,
            amplitude,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to initialize limit cycle: {}", e)))?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_lpc_from_generalized_hopf(
        &mut self,
        gh_state: Vec<f64>,
        neighbor_state: Vec<f64>,
        param1_name: &str,
        param2_name: &str,
        gh_param1: f64,
        gh_param2: f64,
        neighbor_param1: f64,
        neighbor_param2: f64,
        gh_kappa: f64,
        neighbor_kappa: f64,
        neighbor_l1: f64,
        second_lyapunov: f64,
        amplitude: f64,
        ntst: u32,
        ncol: u32,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let seed = generalized_hopf_lpc_seed(
            &mut self.system,
            &gh_state,
            &neighbor_state,
            param1_index,
            param2_index,
            gh_param1,
            gh_param2,
            neighbor_param1,
            neighbor_param2,
            gh_kappa,
            neighbor_kappa,
            neighbor_l1,
            second_lyapunov,
            amplitude,
            ntst as usize,
            ncol as usize,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to initialize LPC curve from generalized Hopf point: {}",
                error
            ))
        })?;
        to_value(&seed)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_curves_from_bogdanov_takens(
        &mut self,
        state: Vec<f64>,
        param1_name: &str,
        param2_name: &str,
        param1_value: f64,
        param2_value: f64,
        perturbation: f64,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let seeds = bogdanov_takens_curve_seeds(
            &mut self.system,
            &state,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            perturbation,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to initialize curves from Bogdanov-Takens point: {}",
                error
            ))
        })?;
        to_value(&seeds)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_homoclinic_from_bogdanov_takens(
        &mut self,
        state: Vec<f64>,
        param1_name: &str,
        param2_name: &str,
        param1_value: f64,
        param2_value: f64,
        perturbation: f64,
        ntst: u32,
        ncol: u32,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let seed = bogdanov_takens_homoclinic_seed(
            &mut self.system,
            &state,
            param1_index,
            param2_index,
            param1_name,
            param2_name,
            param1_value,
            param2_value,
            perturbation,
            ntst as usize,
            ncol as usize,
            tolerance,
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic branch from Bogdanov-Takens point: {}",
                error
            ))
        })?;
        to_value(&seed)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {}", error)))
    }

    /// Initializes a limit cycle guess from a computed orbit.
    /// The orbit should have converged to a stable limit cycle.
    /// Returns the LimitCycleSetup as a serialized JsValue.
    pub fn init_lc_from_orbit(
        &self,
        orbit_times: Vec<f64>,
        orbit_states_flat: Vec<f64>,
        param_value: f64,
        ntst: u32,
        ncol: u32,
        tolerance: f64,
    ) -> Result<JsValue, JsValue> {
        validate_limit_cycle_system_type(&self.system_type).map_err(JsValue::from_str)?;
        let dim = self.system.equations.len();

        // Unflatten orbit_states: orbit_states_flat is [x0_0, x0_1, ..., x1_0, x1_1, ..., ...]
        if orbit_states_flat.len() % dim != 0 {
            return Err(JsValue::from_str(&format!(
                "Orbit states length {} not divisible by dimension {}",
                orbit_states_flat.len(),
                dim
            )));
        }

        let n_points = orbit_states_flat.len() / dim;
        if n_points != orbit_times.len() {
            return Err(JsValue::from_str(&format!(
                "Orbit has {} time points but {} state vectors",
                orbit_times.len(),
                n_points
            )));
        }

        let orbit_states: Vec<Vec<f64>> = (0..n_points)
            .map(|i| orbit_states_flat[i * dim..(i + 1) * dim].to_vec())
            .collect();

        let time_mode = match self.system_type {
            SystemType::Flow => OrbitTimeMode::Continuous,
            SystemType::Map => OrbitTimeMode::Discrete,
        };

        let setup = limit_cycle_setup_from_orbit(
            &orbit_times,
            &orbit_states,
            param_value,
            ntst as usize,
            ncol as usize,
            tolerance,
            time_mode,
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize limit cycle from orbit: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Initializes a period-doubled limit cycle from a period-doubling bifurcation.
    /// Takes the LC state at the PD point and constructs a doubled-period initial guess
    /// by computing the PD eigenvector and perturbing the original orbit.
    pub fn init_lc_from_pd(
        &mut self,
        lc_state: Vec<f64>,
        param_name: &str,
        param_value: f64,
        ntst: u32,
        ncol: u32,
        amplitude: f64,
    ) -> Result<JsValue, JsValue> {
        let param_index = *self
            .system
            .param_map
            .get(param_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param_name)))?;

        let setup = limit_cycle_setup_from_pd(
            &mut self.system,
            param_index,
            &lc_state,
            param_value,
            ntst as usize,
            ncol as usize,
            amplitude,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to initialize LC from PD: {}", e)))?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn init_lc_from_pd_on_mesh(
        &mut self,
        lc_state: Vec<f64>,
        param_name: &str,
        param_value: f64,
        ncol: u32,
        normalized_mesh: Vec<f64>,
        amplitude: f64,
    ) -> Result<JsValue, JsValue> {
        let param_index = *self
            .system
            .param_map
            .get(param_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param_name)))?;

        let setup = limit_cycle_setup_from_pd_on_mesh(
            &mut self.system,
            param_index,
            &lc_state,
            param_value,
            ncol as usize,
            normalized_mesh,
            amplitude,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to initialize LC from PD: {}", e)))?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Initializes a period-doubled map cycle seed from a period-doubling bifurcation.
    /// Takes the cycle state at the PD point and returns a perturbed seed for the doubled cycle.
    pub fn init_map_cycle_from_pd(
        &mut self,
        pd_state: Vec<f64>,
        param_name: &str,
        param_value: f64,
        map_iterations: u32,
        amplitude: f64,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Map) {
            return Err(JsValue::from_str(
                "Map cycle initialization requires a map system.",
            ));
        }

        let param_index = *self
            .system
            .param_map
            .get(param_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param_name)))?;

        let seed = map_cycle_seed_from_pd(
            &mut self.system,
            param_index,
            &pd_state,
            param_value,
            map_iterations as usize,
            amplitude,
        )
        .map_err(|e| {
            JsValue::from_str(&format!("Failed to initialize map cycle from PD: {}", e))
        })?;

        to_value(&seed).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Computes limit cycle continuation from an initial setup (from init_lc_from_hopf).
    pub fn compute_limit_cycle_continuation(
        &mut self,
        setup_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        validate_limit_cycle_system_type(&self.system_type).map_err(JsValue::from_str)?;
        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle setup: {}", e)))?;

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let config = setup.collocation_config();

        let branch = continue_limit_cycle_collocation(
            &mut self.system,
            param_index,
            config,
            setup.guess,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Limit cycle continuation failed: {}", e)))?;

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn init_homoclinic_from_large_cycle(
        &mut self,
        lc_state: Vec<f64>,
        source_ntst: u32,
        source_ncol: u32,
        parameter_name: &str,
        param2_name: &str,
        target_ntst: u32,
        target_ncol: u32,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();

        let setup = homoclinic_setup_from_large_cycle(
            &mut self.system,
            &lc_state,
            source_ntst as usize,
            source_ncol as usize,
            target_ntst as usize,
            target_ncol as usize,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            HomoclinicExtraFlags {
                free_time,
                free_eps0,
                free_eps1,
            },
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic setup from large cycle: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Nonuniform-mesh counterpart of `init_homoclinic_from_large_cycle`.
    /// `source_normalized_mesh` contains the source LC interval boundaries;
    /// source NTST is inferred from its length.
    pub fn init_homoclinic_from_large_cycle_on_mesh(
        &mut self,
        lc_state: Vec<f64>,
        source_ncol: u32,
        source_normalized_mesh: Vec<f64>,
        parameter_name: &str,
        param2_name: &str,
        target_ntst: u32,
        target_ncol: u32,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();

        let setup = homoclinic_setup_from_large_cycle_on_mesh(
            &mut self.system,
            &lc_state,
            source_ncol as usize,
            source_normalized_mesh,
            target_ntst as usize,
            target_ncol as usize,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            HomoclinicExtraFlags {
                free_time,
                free_eps0,
                free_eps1,
            },
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic setup from nonuniform large cycle: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn init_homoclinic_from_homoclinic(
        &mut self,
        point_state: Vec<f64>,
        source_ntst: u32,
        source_ncol: u32,
        source_free_time: bool,
        source_free_eps0: bool,
        source_free_eps1: bool,
        source_fixed_time: f64,
        source_fixed_eps0: f64,
        source_fixed_eps1: f64,
        parameter_name: &str,
        param2_name: &str,
        target_ntst: u32,
        target_ncol: u32,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();

        let source_extras = HomoclinicExtraFlags {
            free_time: source_free_time,
            free_eps0: source_free_eps0,
            free_eps1: source_free_eps1,
        };
        let target_extras = HomoclinicExtraFlags {
            free_time,
            free_eps0,
            free_eps1,
        };

        let source_fixed = HomoclinicFixedScalars {
            time: source_fixed_time,
            eps0: source_fixed_eps0,
            eps1: source_fixed_eps1,
        };

        let setup = homoclinic_setup_from_homoclinic_point_with_source_extras(
            &mut self.system,
            &point_state,
            source_ntst as usize,
            source_ncol as usize,
            target_ntst as usize,
            target_ncol as usize,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            target_extras,
            source_extras,
            Some(source_fixed),
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic setup from homoclinic point: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Mesh-aware Method 2 initializer for restarting an adaptive homoclinic
    /// collocation point without first pretending its source mesh is uniform.
    #[allow(clippy::too_many_arguments)]
    pub fn init_homoclinic_from_homoclinic_on_mesh(
        &mut self,
        point_state: Vec<f64>,
        source_ncol: u32,
        source_normalized_mesh: Vec<f64>,
        source_free_time: bool,
        source_free_eps0: bool,
        source_free_eps1: bool,
        source_fixed_time: f64,
        source_fixed_eps0: f64,
        source_fixed_eps1: f64,
        parameter_name: &str,
        param2_name: &str,
        target_ncol: u32,
        target_normalized_mesh: Vec<f64>,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();
        let source_extras = HomoclinicExtraFlags {
            free_time: source_free_time,
            free_eps0: source_free_eps0,
            free_eps1: source_free_eps1,
        };
        let target_extras = HomoclinicExtraFlags {
            free_time,
            free_eps0,
            free_eps1,
        };
        let source_fixed = HomoclinicFixedScalars {
            time: source_fixed_time,
            eps0: source_fixed_eps0,
            eps1: source_fixed_eps1,
        };
        let setup = homoclinic_setup_from_homoclinic_point_with_source_extras_on_mesh(
            &mut self.system,
            &point_state,
            source_ncol as usize,
            source_normalized_mesh,
            target_ncol as usize,
            target_normalized_mesh,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            target_extras,
            source_extras,
            Some(source_fixed),
        )
        .map_err(|error| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic setup from nonuniform homoclinic point: {error}"
            ))
        })?;
        to_value(&setup)
            .map_err(|error| JsValue::from_str(&format!("Serialization error: {error}")))
    }

    pub fn init_homotopy_saddle_from_equilibrium(
        &mut self,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        param2_name: &str,
        ntst: u32,
        ncol: u32,
        eps0: f64,
        eps1: f64,
        time: f64,
        eps1_tol: f64,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();

        let setup = homotopy_saddle_setup_from_equilibrium(
            &mut self.system,
            &equilibrium_state,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            ntst as usize,
            ncol as usize,
            eps0,
            eps1,
            time,
            eps1_tol,
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize homotopy-saddle setup from equilibrium: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn init_homoclinic_from_homotopy_saddle(
        &mut self,
        stage_d_state: Vec<f64>,
        source_ntst: u32,
        source_ncol: u32,
        parameter_name: &str,
        param2_name: &str,
        target_ntst: u32,
        target_ncol: u32,
        free_time: bool,
        free_eps0: bool,
        free_eps1: bool,
    ) -> Result<JsValue, JsValue> {
        let param1_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;
        let base_params = self.system.params.clone();

        let setup = homoclinic_setup_from_homotopy_saddle_point(
            &mut self.system,
            &stage_d_state,
            source_ntst as usize,
            source_ncol as usize,
            target_ntst as usize,
            target_ncol as usize,
            &base_params,
            param1_index,
            param2_index,
            parameter_name,
            param2_name,
            HomoclinicExtraFlags {
                free_time,
                free_eps0,
                free_eps1,
            },
        )
        .map_err(|e| {
            JsValue::from_str(&format!(
                "Failed to initialize homoclinic setup from homotopy-saddle point: {}",
                e
            ))
        })?;

        to_value(&setup).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_homoclinic_continuation(
        &mut self,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let setup: HomoclinicSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid homoclinic setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let branch = continue_homoclinic_curve(&mut self.system, setup, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Homoclinic continuation failed: {}", e)))?;

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_homotopy_saddle_continuation(
        &mut self,
        setup_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let setup: HomotopySaddleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid homotopy-saddle setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let branch = continue_homotopy_saddle_curve(&mut self.system, setup, settings, forward)
            .map_err(|e| {
                JsValue::from_str(&format!("Homotopy-saddle continuation failed: {}", e))
            })?;

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues a fold (saddle-node) bifurcation curve in two-parameter space.
    ///
    /// # Arguments
    /// * `fold_state` - State vector at the fold bifurcation point
    /// * `param1_name` - Name of first active parameter
    /// * `param1_value` - Value of first parameter at fold point
    /// * `param2_name` - Name of second active parameter
    /// * `param2_value` - Value of second parameter at fold point
    /// * `settings_val` - Continuation settings (step size, max steps, etc.)
    /// * `forward` - Direction of continuation
    ///
    /// # Returns
    /// A `Codim1CurveBranch` containing the fold curve and detected codim-2 bifurcations
    pub fn continue_fold_curve(
        &mut self,
        fold_state: Vec<f64>,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        map_iterations: u32,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        // Set parameters to fold point values
        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        // Create fold curve problem
        let mut problem = FoldCurveProblem::new(
            &mut self.system,
            kind,
            &fold_state,
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

        // Build initial augmented state for PALC: [p1, p2, x1, ..., xn]
        // The ContinuationPoint.state should contain [p2, x1..xn] so that
        // when continue_with_problem prepends p1, we get [p1, p2, x1..xn]
        let n = fold_state.len();

        // Build state as [p2, x1..xn]
        let mut augmented_state = Vec::with_capacity(n + 1);
        augmented_state.push(param2_value); // p2
        augmented_state.extend_from_slice(&fold_state); // x1..xn

        // Build initial point for PALC
        // param_value = p1, state = [p2, x1..xn]
        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Fold,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        // Run continuation
        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Fold curve continuation failed: {}", e)))?;

        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("Codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, _> = events
            .into_iter()
            .map(|event| (event.replace_index, event))
            .collect();

        // Convert to Codim1CurveBranch format
        // The continuation stores augmented state as [p1, p2, x1, ..., xn]
        // pt.param_value = p1, pt.state = [p2, x1, ..., xn]
        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let (pt, codim2) = match events_by_index.remove(&index) {
                Some(event) => (event.point, Some(event.data)),
                None => (original_point.clone(), None),
            };
            // pt.state layout: [p2, x1, ..., xn]
            // Extract p2 (first element)
            let p2 = if !pt.state.is_empty() {
                pt.state[0]
            } else {
                param2_value
            };
            // Extract physical state (elements 1 to n)
            let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                pt.state[1..(n + 1)].to_vec()
            } else {
                fold_state.clone()
            };

            let codim2_type = codim2
                .as_ref()
                .map(|data| data.bifurcation_type)
                .unwrap_or(Codim2BifurcationType::None);
            if codim2_type != Codim2BifurcationType::None {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: codim2_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value, // p1
                param2_value: p2,             // p2 extracted from augmented state
                codim2_type,
                auxiliary: None,
                eigenvalues: pt.eigenvalues.clone(),
                codim2_events: codim2.clone().into_iter().collect(),
                codim2,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Fold,
            param1_index,
            param2_index,
            ntst: 0,
            ncol: 0,
            normalized_mesh: Vec::new(),
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues a Hopf bifurcation curve in two-parameter space.
    ///
    /// # Arguments
    /// * `hopf_state` - State vector at the Hopf bifurcation point
    /// * `hopf_omega` - Hopf frequency (imaginary part of critical eigenvalue)
    /// * `param1_name` - Name of first active parameter
    /// * `param1_value` - Value of first parameter at Hopf point
    /// * `param2_name` - Name of second active parameter
    /// * `param2_value` - Value of second parameter at Hopf point
    /// * `settings_val` - Continuation settings
    /// * `forward` - Direction of continuation
    ///
    /// # Returns
    /// A `Codim1CurveBranch` containing the Hopf curve and detected codim-2 bifurcations
    pub fn continue_hopf_curve(
        &mut self,
        hopf_state: Vec<f64>,
        hopf_omega: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        map_iterations: u32,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        // Set parameters to Hopf point values
        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        let n = hopf_state.len();
        let jac = match kind {
            SystemKind::Flow => compute_jacobian(&self.system, kind, &hopf_state),
            SystemKind::Map { .. } => compute_system_jacobian(&self.system, kind, &hopf_state),
        }
        .map_err(|e| JsValue::from_str(&format!("Failed to compute Jacobian: {}", e)))?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);
        let kappa = match kind {
            SystemKind::Flow => {
                estimate_hopf_kappa_from_jacobian(&jac_mat).unwrap_or(hopf_omega * hopf_omega)
            }
            SystemKind::Map { .. } => estimate_map_ns_cosine_from_jacobian(&jac_mat)
                .unwrap_or_else(|| (1.0 - hopf_omega * hopf_omega).max(0.0).sqrt()),
        };
        if !kappa.is_finite()
            || (kind.is_flow() && kappa <= 0.0)
            || (kind.is_map() && kappa.abs() > 1.0 + 1.0e-8)
        {
            return Err(JsValue::from_str(
                "Invalid Hopf/Neimark-Sacker spectral seed",
            ));
        }
        let kappa_default = kappa;

        // Create Hopf curve problem
        let mut problem = HopfCurveProblem::new(
            &mut self.system,
            kind,
            &hopf_state,
            if kind.is_map() { kappa } else { hopf_omega },
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create Hopf problem: {}", e)))?;

        // Build initial augmented state for PALC: [p1, p2, x1, ..., xn, κ]
        // The ContinuationPoint.state should contain [p2, x1..xn, κ] so that
        // when continue_with_problem prepends p1, we get [p1, p2, x1..xn, κ]

        // Build state as [p2, x1..xn, κ]
        let mut augmented_state = Vec::with_capacity(n + 2);
        augmented_state.push(param2_value); // p2
        augmented_state.extend_from_slice(&hopf_state); // x1..xn
        augmented_state.push(kappa); // κ

        // Build initial point for PALC
        // param_value = p1, state = [p2, x1..xn, κ]
        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: if kind.is_map() {
                fork_core::continuation::BifurcationType::NeimarkSacker
            } else {
                fork_core::continuation::BifurcationType::Hopf
            },
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        // Run continuation
        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| {
                let label = if kind.is_map() {
                    "Neimark-Sacker"
                } else {
                    "Hopf"
                };
                JsValue::from_str(&format!("{label} curve continuation failed: {e}"))
            })?;

        let events = refine_codim2_points(
            &mut problem,
            &branch.points,
            settings.corrector_steps.max(8),
            settings.corrector_tolerance.clamp(1e-10, 1e-6),
        )
        .map_err(|error| JsValue::from_str(&format!("Codim-2 refinement failed: {error}")))?;
        let mut events_by_index: BTreeMap<usize, _> = events
            .into_iter()
            .map(|event| (event.replace_index, event))
            .collect();

        // Convert to Codim1CurveBranch format
        // The continuation stores augmented state as [p1, p2, x1, ..., xn, κ]
        // pt.param_value = p1, pt.state = [p2, x1, ..., xn, κ]
        let n = hopf_state.len(); // Physical state dimension
        let mut codim1_points = Vec::with_capacity(branch.points.len());
        let mut codim2_bifurcations = Vec::new();
        for (index, original_point) in branch.points.iter().enumerate() {
            let (pt, codim2) = match events_by_index.remove(&index) {
                Some(event) => (event.point, Some(event.data)),
                None => (original_point.clone(), None),
            };
            // pt.state layout: [p2, x1, ..., xn, κ]
            // Extract p2 (first element)
            let p2 = if !pt.state.is_empty() {
                pt.state[0]
            } else {
                param2_value
            };
            // Extract physical state (elements 1 to n)
            let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                pt.state[1..(n + 1)].to_vec()
            } else {
                hopf_state.clone()
            };
            // Extract κ (last element)
            let kappa = if pt.state.len() >= n + 2 {
                pt.state[n + 1]
            } else {
                kappa_default
            };

            let codim2_type = codim2
                .as_ref()
                .map(|data| data.bifurcation_type)
                .unwrap_or(Codim2BifurcationType::None);
            if codim2_type != Codim2BifurcationType::None {
                codim2_bifurcations.push(Codim2Bifurcation {
                    index,
                    bifurcation_type: codim2_type,
                });
            }
            codim1_points.push(Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value, // p1
                param2_value: p2,             // p2 extracted from augmented state
                codim2_type,
                auxiliary: Some(kappa), // κ extracted from augmented state
                eigenvalues: pt.eigenvalues.clone(),
                codim2_events: codim2.clone().into_iter().collect(),
                codim2,
            });
        }

        let codim1_branch = Codim1CurveBranch {
            curve_type: if kind.is_map() {
                Codim1CurveType::NeimarkSacker
            } else {
                Codim1CurveType::Hopf
            },
            param1_index,
            param2_index,
            ntst: 0,
            ncol: 0,
            normalized_mesh: Vec::new(),
            points: codim1_points,
            codim2_bifurcations,
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
    ///
    /// # Arguments
    /// * `lc_state` - Flattened LC collocation state at the LPC point
    /// * `period` - Period at the LPC point
    /// * `param1_name` - Name of first active parameter
    /// * `param1_value` - Value of first parameter at LPC point
    /// * `param2_name` - Name of second active parameter
    /// * `param2_value` - Value of second parameter at LPC point
    /// * `ntst` - Number of mesh intervals in collocation
    /// * `ncol` - Collocation degree
    /// * `settings_val` - Continuation settings as JsValue
    /// * `forward` - Direction of continuation
    pub fn continue_isoperiodic_curve(
        &mut self,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        let dim = self.system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Limit-cycle branches store mesh-first implicit periodic data:
            // [mesh_0 .. mesh_(ntst-1), stages...].
            // Isoperiodic expects stage-first explicit periodic data:
            // [stages..., mesh_0 .. mesh_ntst], where mesh_ntst = mesh_0.
            let mesh_len = ntst * dim;
            let mesh = &lc_state[..mesh_len];
            let stages = &lc_state[mesh_len..];
            let mut reordered = Vec::with_capacity(expected_ncoords);
            reordered.extend_from_slice(stages);
            reordered.extend_from_slice(mesh);
            reordered.extend_from_slice(&mesh[..dim]);
            reordered
        } else if lc_state.len() == expected_ncoords {
            lc_state.clone()
        } else {
            return Err(JsValue::from_str(&format!(
                "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
                lc_state.len(),
                expected_ncoords,
                implicit_ncoords,
                ntst,
                ncol,
                dim
            )));
        };

        let mut problem = IsoperiodicCurveProblem::new(
            &mut self.system,
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create isoperiodic problem: {}", e)))?;

        // Build initial augmented state: [lc_state, T, p2]
        // When continue_with_problem prepends p1, we get [p1, lc_state, T, p2]
        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| {
                JsValue::from_str(&format!("Isoperiodic curve continuation failed: {}", e))
            })?;

        let n_lc = full_lc_state.len();
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                    codim2: None,
                    codim2_events: Vec::new(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Isoperiodic,
            param1_index,
            param2_index,
            ntst,
            ncol,
            normalized_mesh: uniform_normalized_mesh(ntst),
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
    ///
    /// # Arguments
    /// * `lc_state` - Flattened LC collocation state at the LPC point
    /// * `period` - Period at the LPC point
    /// * `param1_name` - Name of first active parameter
    /// * `param1_value` - Value of first parameter at LPC point
    /// * `param2_name` - Name of second active parameter
    /// * `param2_value` - Value of second parameter at LPC point
    /// * `ntst` - Number of mesh intervals in collocation
    /// * `ncol` - Collocation degree
    /// * `settings_val` - Continuation settings as JsValue
    /// * `forward` - Direction of continuation
    pub fn continue_lpc_curve(
        &mut self,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        // Set parameters
        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        let dim = self.system.equations.len();
        let full_lc_state = normalize_lc_seed_for_stage_first_explicit(&lc_state, ntst, ncol, dim)
            .map_err(|error| JsValue::from_str(&error))?;

        // Create LPC curve problem
        let mut problem = LPCCurveProblem::new(
            &mut self.system,
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create LPC problem: {}", e)))?;

        // Build initial augmented state: [lc_state, T, p2]
        // When continue_with_problem prepends p1, we get [p1, lc_state, T, p2]
        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::CycleFold,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("LPC curve continuation failed: {}", e)))?;

        // Convert to Codim1CurveBranch format
        // State layout after prepend: [p1, lc_state, T, p2]
        // pt.param_value = p1, pt.state = [lc_state, T, p2]
        let n_lc = full_lc_state.len();
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                // Extract p2 from end of state
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    param2_value
                };
                // Extract physical LC state + T (everything except p2 at end)
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec() // lc_state + T
                } else {
                    lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                    codim2: None,
                    codim2_events: Vec::new(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::LimitPointCycle,
            param1_index,
            param2_index,
            ntst,
            ncol,
            normalized_mesh: uniform_normalized_mesh(ntst),
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues a PD (Period-Doubling) bifurcation curve in two-parameter space.
    pub fn continue_pd_curve(
        &mut self,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        // Handle implicit periodicity: if lc_state has ntst mesh points instead of ntst+1,
        // duplicate the first mesh point at the end (u_0 = u_ntst for periodic BC)
        let dim = self.system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim; // Without u_ntst

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Need to add the last mesh point (copy of first mesh point)
            // LC state uses MESH-FIRST layout: [mesh_0, mesh_1, ..., mesh_(ntst-1), stages...]
            // First mesh point is at index 0..dim
            let u0: Vec<f64> = lc_state[0..dim].to_vec();
            // We need to insert u_ntst (=u_0) after all meshes but before stages
            // Position to insert: after ntst mesh points = ntst * dim
            let mesh_end = ntst * dim;
            let mut padded = Vec::with_capacity(lc_state.len() + dim);
            padded.extend_from_slice(&lc_state[0..mesh_end]); // All meshes
            padded.extend_from_slice(&u0); // Add u_ntst = u_0
            padded.extend_from_slice(&lc_state[mesh_end..]); // All stages
            padded
        } else if lc_state.len() == expected_ncoords {
            lc_state.clone()
        } else {
            return Err(JsValue::from_str(&format!(
                "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
                lc_state.len(),
                expected_ncoords,
                implicit_ncoords,
                ntst,
                ncol,
                dim
            )));
        };

        let mut problem = PDCurveProblem::new(
            &mut self.system,
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create PD problem: {}", e)))?;

        // Build initial augmented state: [lc_state, T, p2]
        // When continue_with_problem prepends p1, we get [p1, lc_state, T, p2]
        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::PeriodDoubling,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("PD curve continuation failed: {}", e)))?;

        // Continuation points store [full_lc_state, T, p2].  Use the padded
        // explicit length, not the caller's possibly implicit seed length.
        let n_lc = full_lc_state.len();
        let mut fallback_physical_state = full_lc_state.clone();
        fallback_physical_state.push(period);
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let (physical_state, p2) = split_pd_curve_output_state(&pt.state, n_lc)
                    .unwrap_or_else(|| (fallback_physical_state.clone(), param2_value));

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                    codim2: None,
                    codim2_events: Vec::new(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::PeriodDoubling,
            param1_index,
            param2_index,
            ntst,
            ncol,
            normalized_mesh: uniform_normalized_mesh(ntst),
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Continues an NS (Neimark-Sacker) bifurcation curve in two-parameter space.
    pub fn continue_ns_curve(
        &mut self,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        initial_k: f64, // cos(θ) for the NS multiplier angle
        ntst: usize,
        ncol: usize,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param1_index = *self
            .system
            .param_map
            .get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self
            .system
            .param_map
            .get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        let dim = self.system.equations.len();
        let full_lc_state = normalize_lc_seed_for_stage_first_explicit(&lc_state, ntst, ncol, dim)
            .map_err(|error| JsValue::from_str(&error))?;

        let mut problem = NSCurveProblem::new(
            &mut self.system,
            full_lc_state.clone(),
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            initial_k,
            ntst,
            ncol,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create NS problem: {}", e)))?;

        // Build initial augmented state: [lc_state, T, p2, k]
        // When continue_with_problem prepends p1, we get [p1, lc_state, T, p2, k]
        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 3);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);
        augmented_state.push(initial_k);

        let initial_point = fork_core::continuation::ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::NeimarkSacker,
            eigenvalues: vec![],
            cycle_points: None,
            homoclinic_events: None,
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("NS curve continuation failed: {}", e)))?;

        // State layout after prepend: [p1, lc_state, T, p2, k]
        // pt.param_value = p1, pt.state = [lc_state, T, p2, k]
        let n_lc = full_lc_state.len();
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                // Extract p2 from state[n_lc + 1]
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    param2_value
                };
                // Extract k from state[n_lc + 2]
                let k_value = if pt.state.len() >= n_lc + 3 {
                    pt.state[n_lc + 2]
                } else {
                    initial_k
                };
                // Extract physical LC state + T (lc_state + T parts)
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(k_value), // Store k = cos(θ)
                    eigenvalues: pt.eigenvalues.clone(),
                    codim2: None,
                    codim2_events: Vec::new(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
            param1_index,
            param2_index,
            ntst,
            ncol,
            normalized_mesh: uniform_normalized_mesh(ntst),
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Compute equilibrium continuation with progress reporting capability.
    /// Returns a serialized StepResult after running the specified number of steps.
    ///
    /// This is a convenience method that runs the full continuation but returns
    /// progress information. For true stepped execution, use WasmEquilibriumRunner.
    pub fn compute_continuation_stepped(
        &mut self,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        map_iterations: u32,
        settings_val: JsValue,
        forward: bool,
        _batch_size: u32,
    ) -> Result<JsValue, JsValue> {
        // For this simplified version, we just run the full continuation
        // and return the result with progress info.
        // The real stepped execution is in WasmEquilibriumRunner.

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map {
                iterations: map_iterations as usize,
            },
        };

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let branch = core_continuation(
            &mut self.system,
            kind,
            &equilibrium_state,
            param_index,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Continuation failed: {}", e)))?;

        // Return result with progress info wrapped
        #[derive(Serialize)]
        struct SteppedResult {
            branch: ContinuationBranch,
            progress: StepResult,
        }

        let result = SteppedResult {
            progress: StepResult::new(
                true,
                settings.max_steps,
                settings.max_steps,
                branch.points.len(),
                branch.bifurcations.len(),
                branch.points.last().map_or(0.0, |p| p.param_value),
            ),
            branch,
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[cfg(test)]
mod pd_output_layout_tests {
    use super::{split_pd_curve_output_state, validate_limit_cycle_system_type};
    use crate::system::SystemType;

    #[test]
    fn padded_pd_output_uses_the_explicit_seed_length() {
        // A dim=2, ntst=2, ncol=1 implicit seed has 8 coordinates; the PD
        // runner pads it to 10 before appending period and p2.
        let state = vec![
            10.0, 11.0, 20.0, 21.0, 10.0, 11.0, 30.0, 31.0, 40.0, 41.0, 6.25, 0.75,
        ];
        let (physical, p2) =
            split_pd_curve_output_state(&state, 10).expect("explicit PD output layout");
        assert_eq!(physical, state[..11]);
        assert_eq!(p2, 0.75);
    }

    #[test]
    fn public_limit_cycle_methods_accept_flows_and_reject_maps() {
        assert!(validate_limit_cycle_system_type(&SystemType::Flow).is_ok());
        let error = validate_limit_cycle_system_type(&SystemType::Map)
            .expect_err("map limit-cycle collocation must be rejected");
        assert!(error.contains("flow systems only"));
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use crate::system::WasmSystem;
    use fork_core::continuation::{
        pack_homoclinic_state, BifurcationType, BranchType, ContinuationBranch, ContinuationPoint,
        ContinuationSettings, HomoclinicSetup, HomoclinicShootingSetup, HomotopySaddleSetup,
    };
    use serde_wasm_bindgen::{from_value, to_value};
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn build_two_dim_system() -> WasmSystem {
        WasmSystem::new(
            vec!["x".to_string(), "y".to_string()],
            vec![],
            vec![],
            vec!["x".to_string(), "y".to_string()],
            "rk4",
            "flow",
        )
        .expect("system should build")
    }

    fn build_two_dim_system_with_param() -> WasmSystem {
        WasmSystem::new(
            vec!["x".to_string(), "y".to_string()],
            vec![0.0],
            vec!["p".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "rk4",
            "flow",
        )
        .expect("system should build")
    }

    fn build_homoclinic_system() -> WasmSystem {
        WasmSystem::new(
            vec!["y".to_string(), "x".to_string()],
            vec![0.2, 0.1],
            vec!["mu".to_string(), "nu".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "rk4",
            "flow",
        )
        .expect("homoclinic system should build")
    }

    fn build_two_dim_map_with_param() -> WasmSystem {
        WasmSystem::new(
            vec!["x".to_string(), "y".to_string()],
            vec![0.0],
            vec!["p".to_string()],
            vec!["x".to_string(), "y".to_string()],
            "discrete",
            "map",
        )
        .expect("map system should build")
    }

    fn continuation_settings(max_steps: usize) -> JsValue {
        let settings = ContinuationSettings {
            step_size: 0.1,
            min_step_size: 1e-6,
            max_step_size: 1.0,
            max_steps,
            corrector_steps: 1,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-8,
        };

        to_value(&settings).expect("settings")
    }

    #[wasm_bindgen_test]
    fn init_lc_from_orbit_rejects_nondivisible_states() {
        let system = build_two_dim_system();
        let err = system
            .init_lc_from_orbit(vec![0.0], vec![1.0, 2.0, 3.0], 0.0, 2, 2, 1e-6)
            .expect_err("should reject non-divisible orbit states");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("not divisible"));
    }

    #[wasm_bindgen_test]
    fn homoclinic_wasm_initializers_preserve_core_validation_errors() {
        let mut system = build_homoclinic_system();
        let duplicate = system
            .init_homotopy_saddle_from_equilibrium(
                vec![0.0, 0.0],
                "mu",
                "mu",
                6,
                2,
                0.01,
                0.02,
                5.0,
                1e-3,
            )
            .expect_err("duplicate parameters must fail");
        assert!(duplicate
            .as_string()
            .unwrap_or_default()
            .contains("two distinct parameters"));

        let invalid_time = system
            .init_homotopy_saddle_from_equilibrium(
                vec![0.0, 0.0],
                "mu",
                "nu",
                6,
                2,
                0.01,
                0.02,
                0.0,
                1e-3,
            )
            .expect_err("non-positive time must fail");
        assert!(invalid_time
            .as_string()
            .unwrap_or_default()
            .contains("strictly positive"));

        let too_many_extras = system
            .init_homoclinic_from_large_cycle(Vec::new(), 3, 1, "mu", "nu", 3, 1, true, true, true)
            .expect_err("three free extras must fail");
        assert!(too_many_extras
            .as_string()
            .unwrap_or_default()
            .contains("at most two"));

        let invalid_source_mesh = system
            .init_homoclinic_from_large_cycle_on_mesh(
                Vec::new(),
                1,
                vec![0.0, 0.7, 0.6, 1.0],
                "mu",
                "nu",
                3,
                1,
                false,
                true,
                true,
            )
            .expect_err("nonmonotone source mesh must fail");
        assert!(invalid_source_mesh
            .as_string()
            .unwrap_or_default()
            .contains("strictly increasing"));

        let invalid_restart_mesh = system
            .init_homoclinic_from_homoclinic_on_mesh(
                Vec::new(),
                1,
                vec![0.0, 0.8, 0.7, 1.0],
                true,
                false,
                false,
                1.0,
                0.01,
                0.01,
                "mu",
                "nu",
                1,
                vec![0.0, 0.2, 0.6, 1.0],
                true,
                false,
                false,
            )
            .expect_err("nonmonotone homoclinic restart mesh must fail");
        assert!(invalid_restart_mesh
            .as_string()
            .unwrap_or_default()
            .contains("strictly increasing"));
    }

    #[wasm_bindgen_test]
    fn homoclinic_wasm_setup_round_trips_preserve_seed_trust() {
        let mut system = build_homoclinic_system();
        let staged_value = system
            .init_homotopy_saddle_from_equilibrium(
                vec![0.0, 0.0],
                "mu",
                "nu",
                6,
                2,
                0.01,
                0.02,
                5.0,
                1e-3,
            )
            .expect("staged homoclinic setup");
        let staged: HomotopySaddleSetup =
            from_value(staged_value.clone()).expect("decode staged setup");
        assert!(!staged.setup.initial_seed_is_corrected);

        let approximate_shooting: HomoclinicShootingSetup = from_value(
            system
                .init_homoclinic_shooting_from_collocation(staged_value, 4, 32)
                .expect("shooting from approximate staged setup"),
        )
        .expect("decode approximate shooting setup");
        assert!(!approximate_shooting.initial_seed_is_corrected);

        let method_4_value = system
            .init_homoclinic_from_homotopy_saddle(
                pack_homoclinic_state(&staged.setup),
                staged.setup.ntst as u32,
                staged.setup.ncol as u32,
                "mu",
                "nu",
                staged.setup.ntst as u32,
                staged.setup.ncol as u32,
                true,
                false,
                false,
            )
            .expect("Method 4 setup from staged heuristic endpoint");
        let method_4: HomoclinicSetup =
            from_value(method_4_value.clone()).expect("decode Method 4 setup");
        assert!(!method_4.initial_seed_is_corrected);

        let method_4_shooting: HomoclinicShootingSetup = from_value(
            system
                .init_homoclinic_shooting_from_collocation(method_4_value, 4, 32)
                .expect("shooting from Method 4 setup"),
        )
        .expect("decode Method 4 shooting setup");
        assert!(!method_4_shooting.initial_seed_is_corrected);
    }

    #[wasm_bindgen_test]
    fn init_lc_from_orbit_rejects_time_state_mismatch() {
        let system = build_two_dim_system();
        let err = system
            .init_lc_from_orbit(vec![0.0], vec![1.0, 2.0, 3.0, 4.0], 0.0, 2, 2, 1e-6)
            .expect_err("should reject mismatched time/state counts");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Orbit has"));
    }

    #[wasm_bindgen_test]
    fn init_lc_from_orbit_rejects_map_systems_before_cycle_detection() {
        let system = build_two_dim_map_with_param();
        let err = system
            .init_lc_from_orbit(vec![], vec![], 0.0, 2, 2, 1e-6)
            .expect_err("map Orbit seeds must be rejected");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("flow systems only"));
    }

    #[wasm_bindgen_test]
    fn legacy_limit_cycle_continuation_rejects_map_systems_before_setup_decode() {
        let mut system = build_two_dim_map_with_param();
        let err = system
            .compute_limit_cycle_continuation(JsValue::NULL, "p", continuation_settings(1), true)
            .expect_err("map limit-cycle continuation must be rejected");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("flow systems only"));
    }

    #[wasm_bindgen_test]
    fn legacy_limit_cycle_extension_rejects_map_systems() {
        let mut system = build_two_dim_map_with_param();
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![1.0, 2.0, 1.5, 2.5, 6.25],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::LimitCycle {
                ntst: 1,
                ncol: 1,
                normalized_mesh: vec![0.0, 1.0],
            },
            upoldp: Some(vec![vec![1.0, 0.0]]),
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let err = system
            .extend_continuation(branch_val, "p", 1, continuation_settings(1), true)
            .expect_err("map limit-cycle extension must be rejected");
        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("flow systems only"));
    }

    #[wasm_bindgen_test]
    fn compute_continuation_rejects_unknown_parameter() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .compute_continuation(vec![0.0, 0.0], "missing", 1, continuation_settings(1), true)
            .expect_err("should reject unknown parameter");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }

    #[wasm_bindgen_test]
    fn compute_equilibrium_eigenvalues_rejects_state_dim() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .compute_equilibrium_eigenvalues(vec![0.0], "p", 1, 0.0)
            .expect_err("should reject state dimension mismatch");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("State dimension"));
    }

    #[wasm_bindgen_test]
    fn extend_continuation_rejects_missing_upoldp() {
        let mut system = build_two_dim_system_with_param();
        let branch = ContinuationBranch {
            points: vec![ContinuationPoint {
                state: vec![0.0, 0.0],
                param_value: 0.0,
                stability: BifurcationType::None,
                eigenvalues: Vec::new(),
                cycle_points: None,
                homoclinic_events: None,
            }],
            bifurcations: Vec::new(),
            indices: vec![0],
            branch_type: BranchType::LimitCycle {
                ntst: 3,
                ncol: 2,
                normalized_mesh: vec![0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0],
            },
            upoldp: None,
            homoc_context: None,
            resume_state: None,
            manifold_geometry: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let err = system
            .extend_continuation(branch_val, "p", 1, continuation_settings(1), true)
            .expect_err("should reject missing upoldp");

        if let Some(message) = err.as_string() {
            assert!(message.to_lowercase().contains("upoldp"));
        }
    }

    #[wasm_bindgen_test]
    fn continue_fold_curve_rejects_unknown_parameter() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .continue_fold_curve(
                vec![0.0, 0.0],
                "p",
                0.0,
                "missing",
                0.0,
                1,
                continuation_settings(1),
                true,
            )
            .expect_err("should reject unknown parameter");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }
}
