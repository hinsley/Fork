use fork_core::analysis::{
    covariant_lyapunov_vectors as core_clv, lyapunov_exponents as core_lyapunov, LyapunovStepper,
};
use fork_core::autodiff::Dual;
use fork_core::continuation::{
    ContinuationBranch, ContinuationSettings, BranchType,
    CollocationConfig, LimitCycleSetup,
    continue_limit_cycle_collocation, extend_limit_cycle_collocation,
    limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit, limit_cycle_setup_from_pd,
    Codim1CurveType, Codim2BifurcationType, Codim1CurvePoint, Codim1CurveBranch,
    FoldCurveProblem, HopfCurveProblem, continue_with_problem,
};
use fork_core::continuation::equilibrium::{
    continue_parameter as core_continuation, extend_branch as core_extend_branch,
    compute_eigenvalues_for_state,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::{
    solve_equilibrium as core_equilibrium_solver, NewtonSettings, SystemKind,
};
use fork_core::solvers::{DiscreteMap, Tsit5, RK4};
use fork_core::traits::{DynamicalSystem, Steppable};
use js_sys::Float64Array;
use serde::Serialize;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmSystem {
    system: EquationSystem,
    state: Vec<f64>,
    t: f64,
    solver: SolverType,
    system_type: SystemType,
}

enum SolverType {
    RK4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

enum SystemType {
    Flow,
    Map,
}

#[wasm_bindgen]
impl WasmSystem {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        system_type: &str,
    ) -> Result<WasmSystem, JsValue> {
        console_error_panic_hook::set_once();

        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            let code = compiler.compile(&expr);
            bytecodes.push(code);
        }

        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);
        
        let dim = system.equations.len();

        let solver = match solver_name {
            "rk4" => SolverType::RK4(RK4::new(dim)),
            "tsit5" => SolverType::Tsit5(Tsit5::new(dim)),
            "discrete" => SolverType::Discrete(DiscreteMap::new(dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        let system_type = match system_type {
            "map" => SystemType::Map,
            _ => SystemType::Flow,
        };

        Ok(WasmSystem {
            system,
            state: vec![0.0; dim],
            t: 0.0,
            solver,
            system_type,
        })
    }

    pub fn set_state(&mut self, state: &[f64]) {
        self.state = state.to_vec();
    }

    pub fn get_state(&self) -> Vec<f64> {
        self.state.clone()
    }

    pub fn set_t(&mut self, t: f64) {
        self.t = t;
    }

    pub fn get_t(&self) -> f64 {
        self.t
    }

    pub fn step(&mut self, dt: f64) {
        match &mut self.solver {
            SolverType::RK4(s) => s.step(&self.system, &mut self.t, &mut self.state, dt),
            SolverType::Tsit5(s) => s.step(&self.system, &mut self.t, &mut self.state, dt),
            SolverType::Discrete(s) => s.step(&self.system, &mut self.t, &mut self.state, dt),
        }
    }

    pub fn compute_jacobian(&self) -> Vec<f64> {
        let n = self.system.equations.len();
        let mut jacobian = vec![0.0; n * n];
        let mut dual_x = vec![Dual::new(0.0, 0.0); n];
        let mut dual_out = vec![Dual::new(0.0, 0.0); n];
        let t_dual = Dual::new(self.t, 0.0);

        for j in 0..n {
            for i in 0..n {
                dual_x[i] = Dual::new(self.state[i], if i == j { 1.0 } else { 0.0 });
            }
            self.system.apply(t_dual, &dual_x, &mut dual_out);
            for i in 0..n {
                jacobian[i * n + j] = dual_out[i].eps;
            }
        }

        jacobian
    }

    pub fn compute_lyapunov_exponents(
        &self,
        start_state: Vec<f64>,
        start_time: f64,
        steps: u32,
        dt: f64,
        qr_stride: u32,
    ) -> Result<Float64Array, JsValue> {
        let dim = self.system.equations.len();
        if start_state.len() != dim {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }
        if steps == 0 {
            return Err(JsValue::from_str(
                "Lyapunov computation requires at least one step.",
            ));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        let stride = if qr_stride == 0 { 1 } else { qr_stride as usize };
        let step_count = steps as usize;
        let solver = match &self.solver {
            SolverType::RK4(_) => LyapunovStepper::Rk4,
            SolverType::Tsit5(_) => LyapunovStepper::Tsit5,
            SolverType::Discrete(_) => LyapunovStepper::Discrete,
        };

        let exponents = core_lyapunov(
            &self.system,
            solver,
            &start_state,
            start_time,
            step_count,
            dt,
            stride,
        )
        .map_err(|e| JsValue::from_str(&format!("Lyapunov computation failed: {}", e)))?;

        Ok(Float64Array::from(exponents.as_slice()))
    }

    pub fn compute_covariant_lyapunov_vectors(
        &self,
        start_state: Vec<f64>,
        start_time: f64,
        window_steps: u32,
        dt: f64,
        qr_stride: u32,
        forward_transient: u32,
        backward_transient: u32,
    ) -> Result<JsValue, JsValue> {
        let dim = self.system.equations.len();
        if start_state.len() != dim {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        if window_steps == 0 {
            return Err(JsValue::from_str(
                "Covariant Lyapunov computation requires a positive window.",
            ));
        }

        let solver = match &self.solver {
            SolverType::RK4(_) => LyapunovStepper::Rk4,
            SolverType::Tsit5(_) => LyapunovStepper::Tsit5,
            SolverType::Discrete(_) => LyapunovStepper::Discrete,
        };

        let result = core_clv(
            &self.system,
            solver,
            &start_state,
            start_time,
            dt,
            if qr_stride == 0 { 1 } else { qr_stride as usize },
            window_steps as usize,
            forward_transient as usize,
            backward_transient as usize,
        )
        .map_err(|e| JsValue::from_str(&format!("Covariant Lyapunov computation failed: {}", e)))?;

        let payload = CovariantVectorsPayload {
            dimension: result.dimension,
            checkpoints: result.checkpoints,
            times: result.times,
            vectors: result.vectors,
        };

        to_value(&payload).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn solve_equilibrium(
        &self,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
    ) -> Result<JsValue, JsValue> {
        let settings = NewtonSettings {
            max_steps: max_steps as usize,
            damping,
            ..NewtonSettings::default()
        };

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };

        let result = core_equilibrium_solver(&self.system, kind, &initial_guess, settings)
            .map_err(|e| JsValue::from_str(&format!("Equilibrium solve failed: {}", e)))?;

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

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
            forward
        ).map_err(|e| JsValue::from_str(&format!("Continuation failed: {}", e)))?;
        
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
                    forward
                ).map_err(|e| JsValue::from_str(&format!("Branch extension failed: {}", e)))?
            },
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
                    forward
                ).map_err(|e| JsValue::from_str(&format!("LC branch extension failed: {}", e)))?
            }
        };
        
        to_value(&updated_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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

        to_value(&eigenvalues).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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
        .map_err(|e| JsValue::from_str(&format!("Failed to initialize limit cycle from orbit: {}", e)))?;

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
        ).map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

        // Build initial augmented state for PALC: [p1, p2, x1, ..., xn]
        // The ContinuationPoint.state should contain [p2, x1..xn] so that
        // when continue_with_problem prepends p1, we get [p1, p2, x1..xn]
        let n = fold_state.len();
        
        // Build state as [p2, x1..xn]
        let mut augmented_state = Vec::with_capacity(n + 1);
        augmented_state.push(param2_value);  // p2
        augmented_state.extend_from_slice(&fold_state);  // x1..xn

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
        let codim1_points: Vec<Codim1CurvePoint> = branch.points.iter().map(|pt| {
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
                param1_value: pt.param_value,  // p1
                param2_value: p2,              // p2 extracted from augmented state
                codim2_type: Codim2BifurcationType::None,
                auxiliary: None,
                eigenvalues: pt.eigenvalues.clone(),
            }
        }).collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Fold,
            param1_index,
            param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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

        // Create Hopf curve problem
        let mut problem = HopfCurveProblem::new(
            &mut self.system,
            kind,
            &hopf_state,
            hopf_omega,
            param1_index,
            param2_index,
        ).map_err(|e| JsValue::from_str(&format!("Failed to create Hopf problem: {}", e)))?;

        // Build initial augmented state for PALC: [p1, p2, x1, ..., xn, κ]
        // The ContinuationPoint.state should contain [p2, x1..xn, κ] so that
        // when continue_with_problem prepends p1, we get [p1, p2, x1..xn, κ]
        let n = hopf_state.len();
        let kappa = hopf_omega * hopf_omega;
        
        // Build state as [p2, x1..xn, κ]
        let mut augmented_state = Vec::with_capacity(n + 2);
        augmented_state.push(param2_value);  // p2
        augmented_state.extend_from_slice(&hopf_state);  // x1..xn
        augmented_state.push(kappa);  // κ

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
        let n = hopf_state.len();  // Physical state dimension
        let codim1_points: Vec<Codim1CurvePoint> = branch.points.iter().map(|pt| {
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
                hopf_omega * hopf_omega
            };
            
            Codim1CurvePoint {
                state: physical_state,
                param1_value: pt.param_value,  // p1
                param2_value: p2,              // p2 extracted from augmented state
                codim2_type: Codim2BifurcationType::None,
                auxiliary: Some(kappa),        // κ extracted from augmented state
                eigenvalues: pt.eigenvalues.clone(),
            }
        }).collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Hopf,
            param1_index,
            param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[derive(Serialize)]
struct CovariantVectorsPayload {
    dimension: usize,
    checkpoints: usize,
    times: Vec<f64>,
    vectors: Vec<f64>,
}
