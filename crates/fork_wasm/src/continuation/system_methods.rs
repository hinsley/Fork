//! WasmSystem continuation methods.

use crate::system::{SystemType, WasmSystem};
use fork_core::continuation::equilibrium::{
    compute_eigenvalues_for_state, continue_parameter as core_continuation,
    extend_branch as core_extend_branch,
};
use fork_core::continuation::{
    continue_limit_cycle_collocation, continue_with_problem, extend_limit_cycle_collocation,
    limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit, limit_cycle_setup_from_pd,
    BranchType, Codim1CurveBranch, Codim1CurvePoint, Codim1CurveType, Codim2BifurcationType,
    ContinuationBranch, ContinuationSettings, LimitCycleSetup, StepResult,
    FoldCurveProblem, HopfCurveProblem, LPCCurveProblem, NSCurveProblem, PDCurveProblem,
    CollocationConfig,
};
use fork_core::continuation::codim1_curves::estimate_hopf_kappa_from_jacobian;
use fork_core::equilibrium::{compute_jacobian, SystemKind};
use fork_core::traits::DynamicalSystem;
use nalgebra::DMatrix;
use serde::Serialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmSystem {
    pub fn compute_continuation(
        &mut self,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let param_index = *self.system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

        // Auto-recover missing upoldp for LimitCycle branches
        if let BranchType::LimitCycle { .. } = branch.branch_type {
            if branch.upoldp.is_none() {
                if let Some(last_pt) = branch.points.last() {
                    let dim = self.system.equations.len();
                    if last_pt.state.len() > dim {
                        let x0 = &last_pt.state[0..dim];
                        let period = *last_pt.state.last().unwrap_or(&1.0);
                        let mut work = vec![0.0; dim];
                        self.system.apply(0.0, x0, &mut work);
                        // x'(0) = T * f(x0) (approx tangent for phase condition)
                        let u0: Vec<f64> = work.iter().map(|&v| v * period).collect();
                        branch.upoldp = Some(vec![u0]);
                    }
                }
            }
        }

        let param_index = *self.system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let updated_branch = match &branch.branch_type {
            BranchType::Equilibrium => {
                let kind = match self.system_type {
                    SystemType::Flow => SystemKind::Flow,
                    SystemType::Map => SystemKind::Map,
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
            BranchType::LimitCycle { ntst, ncol } => {
                // Extract phase anchor and direction from upoldp
                let upoldp = branch.upoldp.clone()
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

                // Extract phase anchor from last point's state (first mesh point)
                let last_pt = branch.points.last()
                    .ok_or_else(|| JsValue::from_str("Branch has no points"))?;
                let dim = self.system.equations.len();
                let phase_anchor: Vec<f64> = last_pt.state.iter().take(dim).cloned().collect();

                let config = CollocationConfig {
                    mesh_points: *ntst,
                    degree: *ncol,
                    phase_anchor,
                    phase_direction,
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
        };

        to_value(&updated_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn compute_equilibrium_eigenvalues(
        &mut self,
        state: Vec<f64>,
        parameter_name: &str,
        param_value: f64,
    ) -> Result<JsValue, JsValue> {
        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let param_index = *self
            .system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        if state.len() != self.system.equations.len() {
            return Err(JsValue::from_str("State dimension mismatch for eigenvalue computation."));
        }

        let eigenvalues = compute_eigenvalues_for_state(
            &mut self.system,
            kind,
            &state,
            param_index,
            param_value,
        )
        .map_err(|e| JsValue::from_str(&format!("Eigenvalue computation failed: {}", e)))?;

        to_value(&eigenvalues)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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
        let param_index = *self
            .system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

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
        let dim = self.system.equations.len();

        // Unflatten orbit_states: orbit_states_flat is [x0_0, x0_1, ..., x1_0, x1_1, ..., ...]
        if orbit_states_flat.len() % dim != 0 {
            return Err(JsValue::from_str(&format!(
                "Orbit states length {} not divisible by dimension {}",
                orbit_states_flat.len(), dim
            )));
        }

        let n_points = orbit_states_flat.len() / dim;
        if n_points != orbit_times.len() {
            return Err(JsValue::from_str(&format!(
                "Orbit has {} time points but {} state vectors",
                orbit_times.len(), n_points
            )));
        }

        let orbit_states: Vec<Vec<f64>> = (0..n_points)
            .map(|i| orbit_states_flat[i * dim..(i + 1) * dim].to_vec())
            .collect();

        let setup = limit_cycle_setup_from_orbit(
            &orbit_times,
            &orbit_states,
            param_value,
            ntst as usize,
            ncol as usize,
            tolerance,
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

    /// Computes limit cycle continuation from an initial setup (from init_lc_from_hopf).
    pub fn compute_limit_cycle_continuation(
        &mut self,
        setup_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle setup: {}", e)))?;

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param_index = *self
            .system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let param1_index = *self.system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self.system.param_map.get(param2_name)
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
        };

        // Run continuation
        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Fold curve continuation failed: {}", e)))?;

        // Convert to Codim1CurveBranch format
        // The continuation stores augmented state as [p1, p2, x1, ..., xn]
        // pt.param_value = p1, pt.state = [p2, x1, ..., xn]
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                // pt.state layout: [p2, x1, ..., xn]
                // Extract p2 (first element)
                let p2 = if !pt.state.is_empty() { pt.state[0] } else { param2_value };
                // Extract physical state (elements 1 to n)
                let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                    pt.state[1..(n + 1)].to_vec()
                } else {
                    fold_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value, // p1
                    param2_value: p2,             // p2 extracted from augmented state
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: None,
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Fold,
            param1_index,
            param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
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
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let param1_index = *self.system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self.system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        // Set parameters to Hopf point values
        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        let n = hopf_state.len();
        let jac = compute_jacobian(&self.system, kind, &hopf_state)
            .map_err(|e| JsValue::from_str(&format!("Failed to compute Jacobian: {}", e)))?;
        let jac_mat = DMatrix::from_row_slice(n, n, &jac);
        let kappa_seed = estimate_hopf_kappa_from_jacobian(&jac_mat)
            .unwrap_or(hopf_omega * hopf_omega);
        let kappa = if kappa_seed.is_finite() && kappa_seed > 0.0 {
            kappa_seed
        } else {
            hopf_omega * hopf_omega
        };
        let kappa_default = kappa;

        // Create Hopf curve problem
        let mut problem = HopfCurveProblem::new(
            &mut self.system,
            kind,
            &hopf_state,
            hopf_omega,
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
            stability: fork_core::continuation::BifurcationType::Hopf,
            eigenvalues: vec![],
        };

        // Run continuation
        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Hopf curve continuation failed: {}", e)))?;

        // Convert to Codim1CurveBranch format
        // The continuation stores augmented state as [p1, p2, x1, ..., xn, κ]
        // pt.param_value = p1, pt.state = [p2, x1, ..., xn, κ]
        let n = hopf_state.len(); // Physical state dimension
        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                // pt.state layout: [p2, x1, ..., xn, κ]
                // Extract p2 (first element)
                let p2 = if !pt.state.is_empty() { pt.state[0] } else { param2_value };
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

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value, // p1
                    param2_value: p2,             // p2 extracted from augmented state
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(kappa),       // κ extracted from augmented state
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Hopf,
            param1_index,
            param2_index,
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

        let param1_index = *self.system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self.system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        // Set parameters
        self.system.params[param1_index] = param1_value;
        self.system.params[param2_index] = param2_value;

        // Handle implicit periodicity: if lc_state has ntst mesh points instead of ntst+1,
        // duplicate the first mesh point at the end (u_0 = u_ntst for periodic BC)
        let dim = self.system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim; // Without u_ntst

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Need to add the last mesh point (copy of first mesh point)
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0); // Append u_ntst = u_0
            padded
        } else if lc_state.len() == expected_ncoords {
            lc_state.clone()
        } else {
            return Err(JsValue::from_str(&format!(
                "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
                lc_state.len(), expected_ncoords, implicit_ncoords, ntst, ncol, dim
            )));
        };

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
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::LimitPointCycle,
            param1_index,
            param2_index,
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

        let param1_index = *self.system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self.system.param_map.get(param2_name)
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
                lc_state.len(), expected_ncoords, implicit_ncoords, ntst, ncol, dim
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
        };

        let branch = continue_with_problem(&mut problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("PD curve continuation failed: {}", e)))?;

        // State layout after prepend: [p1, lc_state, T, p2]
        let n_lc = lc_state.len();
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
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::PeriodDoubling,
            param1_index,
            param2_index,
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

        let param1_index = *self.system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *self.system.param_map.get(param2_name)
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
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0); // Append u_ntst = u_0
            padded
        } else if lc_state.len() == expected_ncoords {
            lc_state.clone()
        } else {
            return Err(JsValue::from_str(&format!(
                "Invalid lc_state.len()={}, expected {} or {} (ntst={}, ncol={}, dim={})",
                lc_state.len(), expected_ncoords, implicit_ncoords, ntst, ncol, dim
            )));
        };

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
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
            param1_index,
            param2_index,
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
            SystemType::Map => SystemKind::Map,
        };

        let param_index = *self.system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use crate::system::WasmSystem;
    use fork_core::continuation::{BranchType, ContinuationBranch, ContinuationSettings};
    use serde_wasm_bindgen::to_value;
    use wasm_bindgen::JsValue;

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

    #[test]
    fn init_lc_from_orbit_rejects_nondivisible_states() {
        let system = build_two_dim_system();
        let err = system
            .init_lc_from_orbit(vec![0.0], vec![1.0, 2.0, 3.0], 0.0, 2, 2, 1e-6)
            .expect_err("should reject non-divisible orbit states");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("not divisible"));
    }

    #[test]
    fn init_lc_from_orbit_rejects_time_state_mismatch() {
        let system = build_two_dim_system();
        let err = system
            .init_lc_from_orbit(vec![0.0], vec![1.0, 2.0, 3.0, 4.0], 0.0, 2, 2, 1e-6)
            .expect_err("should reject mismatched time/state counts");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Orbit has"));
    }

    #[test]
    fn compute_continuation_rejects_unknown_parameter() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .compute_continuation(vec![0.0, 0.0], "missing", continuation_settings(1), true)
            .expect_err("should reject unknown parameter");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }

    #[test]
    fn compute_equilibrium_eigenvalues_rejects_state_dim() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .compute_equilibrium_eigenvalues(vec![0.0], "p", 0.0)
            .expect_err("should reject state dimension mismatch");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("State dimension"));
    }

    #[test]
    fn extend_continuation_rejects_missing_upoldp() {
        let mut system = build_two_dim_system_with_param();
        let branch = ContinuationBranch {
            points: Vec::new(),
            bifurcations: Vec::new(),
            indices: Vec::new(),
            branch_type: BranchType::LimitCycle { ntst: 3, ncol: 2 },
            upoldp: None,
        };
        let branch_val = to_value(&branch).expect("branch");

        let err = system
            .extend_continuation(branch_val, "p", continuation_settings(1), true)
            .expect_err("should reject missing upoldp");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("upoldp"));
    }

    #[test]
    fn continue_fold_curve_rejects_unknown_parameter() {
        let mut system = build_two_dim_system_with_param();
        let err = system
            .continue_fold_curve(
                vec![0.0, 0.0],
                "p",
                0.0,
                "missing",
                0.0,
                continuation_settings(1),
                true,
            )
            .expect_err("should reject unknown parameter");

        let message = err.as_string().unwrap_or_default();
        assert!(message.contains("Unknown parameter"));
    }
}
