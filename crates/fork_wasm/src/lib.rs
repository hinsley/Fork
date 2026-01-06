use fork_core::analysis::{
    covariant_lyapunov_vectors as core_clv, lyapunov_exponents as core_lyapunov, LyapunovStepper,
};
use fork_core::autodiff::{Dual, TangentSystem};
use fork_core::continuation::{
    ContinuationBranch, ContinuationPoint, ContinuationSettings, BranchType, StepResult,
    ContinuationProblem, ContinuationRunner, PointDiagnostics, TestFunctionValues,
    CollocationConfig, LimitCycleSetup,
    continue_limit_cycle_collocation, extend_limit_cycle_collocation,
    limit_cycle_setup_from_hopf, limit_cycle_setup_from_orbit, limit_cycle_setup_from_pd,
    Codim1CurveType, Codim2BifurcationType, Codim1CurvePoint, Codim1CurveBranch,
    FoldCurveProblem, HopfCurveProblem, LPCCurveProblem, PDCurveProblem, NSCurveProblem,
    continue_with_problem, compute_eigenvalues, hopf_test_function, neutral_saddle_test_function,
};
use fork_core::continuation::periodic::{CollocationCoefficients, PeriodicOrbitCollocationProblem};
use fork_core::continuation::equilibrium::{
    continue_parameter as core_continuation, extend_branch as core_extend_branch,
    compute_eigenvalues_for_state,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::{
    solve_equilibrium as core_equilibrium_solver, EigenPair, EquilibriumResult, NewtonSettings, SystemKind,
};
use fork_core::solvers::{DiscreteMap, Tsit5, RK4};
use fork_core::traits::{DynamicalSystem, Steppable};
use js_sys::Float64Array;
use nalgebra::linalg::{QR, SVD};
use nalgebra::{Complex, DMatrix, DVector};
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

fn build_system(
    equations: Vec<String>,
    params: Vec<f64>,
    param_names: &[String],
    var_names: &[String],
) -> Result<EquationSystem, JsValue> {
    let compiler = Compiler::new(var_names, param_names);
    let mut bytecodes = Vec::new();
    for eq_str in equations {
        let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
        let code = compiler.compile(&expr);
        bytecodes.push(code);
    }

    let mut system = EquationSystem::new(bytecodes, params);
    system.set_maps(compiler.param_map, compiler.var_map);
    Ok(system)
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
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;  // Without u_ntst
        
        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Need to add the last mesh point (copy of first mesh point)
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);  // Append u_ntst = u_0
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
        ).map_err(|e| JsValue::from_str(&format!("Failed to create LPC problem: {}", e)))?;

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
        let codim1_points: Vec<Codim1CurvePoint> = branch.points.iter().map(|pt| {
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
        }).collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::LimitPointCycle,
            param1_index,
            param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;  // Without u_ntst
        
        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Need to add the last mesh point (copy of first mesh point)
            // LC state uses MESH-FIRST layout: [mesh_0, mesh_1, ..., mesh_(ntst-1), stages...]
            // First mesh point is at index 0..dim
            let u0: Vec<f64> = lc_state[0..dim].to_vec();
            // We need to insert u_ntst (=u_0) after all meshes but before stages
            // Position to insert: after ntst mesh points = ntst * dim
            let mesh_end = ntst * dim;
            let mut padded = Vec::with_capacity(lc_state.len() + dim);
            padded.extend_from_slice(&lc_state[0..mesh_end]);  // All meshes
            padded.extend_from_slice(&u0);                     // Add u_ntst = u_0
            padded.extend_from_slice(&lc_state[mesh_end..]);   // All stages
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
        ).map_err(|e| JsValue::from_str(&format!("Failed to create PD problem: {}", e)))?;

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
        let codim1_points: Vec<Codim1CurvePoint> = branch.points.iter().map(|pt| {
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
        }).collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::PeriodDoubling,
            param1_index,
            param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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
        initial_k: f64,  // cos(θ) for the NS multiplier angle
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
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;  // Without u_ntst
        
        let full_lc_state = if lc_state.len() == implicit_ncoords {
            // Need to add the last mesh point (copy of first mesh point)
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);  // Append u_ntst = u_0
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
        ).map_err(|e| JsValue::from_str(&format!("Failed to create NS problem: {}", e)))?;

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
        let codim1_points: Vec<Codim1CurvePoint> = branch.points.iter().map(|pt| {
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
                auxiliary: Some(k_value),  // Store k = cos(θ)
                eigenvalues: pt.eigenvalues.clone(),
            }
        }).collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
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

// ============================================================================
// Stepped Continuation Runners (for progress reporting)
// ============================================================================

struct OwnedEquilibriumContinuationProblem {
    system: EquationSystem,
    kind: SystemKind,
    param_index: usize,
}

impl OwnedEquilibriumContinuationProblem {
    fn new(system: EquationSystem, kind: SystemKind, param_index: usize) -> Self {
        Self {
            system,
            kind,
            param_index,
        }
    }

    fn with_param<F, R>(&mut self, param: f64, f: F) -> anyhow::Result<R>
    where
        F: FnOnce(&mut EquationSystem) -> anyhow::Result<R>,
    {
        let old = self.system.params[self.param_index];
        self.system.params[self.param_index] = param;
        let result = f(&mut self.system);
        self.system.params[self.param_index] = old;
        result
    }
}

impl ContinuationProblem for OwnedEquilibriumContinuationProblem {
    fn dimension(&self) -> usize {
        self.system.equations.len()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> anyhow::Result<()> {
        let dim = self.dimension();
        if out.len() != dim {
            anyhow::bail!("Residual buffer has incorrect dimension");
        }

        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        self.with_param(param, |system| {
            match kind {
                SystemKind::Flow => system.apply(0.0, &state, out.as_mut_slice()),
                SystemKind::Map => {
                    system.apply(0.0, &state, out.as_mut_slice());
                    for i in 0..out.len() {
                        out[i] -= state[i];
                    }
                }
            }
            Ok(())
        })?;

        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> anyhow::Result<DMatrix<f64>> {
        let dim = self.dimension();
        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;
        let param_index = self.param_index;

        let mut j_ext = DMatrix::zeros(dim, dim + 1);

        self.with_param(param, |system| {
            let mut f_dual = vec![Dual::new(0.0, 0.0); dim];
            system.evaluate_dual_wrt_param(&state, param_index, &mut f_dual);
            for i in 0..dim {
                j_ext[(i, 0)] = f_dual[i].eps;
            }

            let jac_x = fork_core::equilibrium::compute_jacobian(system, kind, &state)?;
            for col in 0..dim {
                for row in 0..dim {
                    j_ext[(row, col + 1)] = jac_x[row * dim + col];
                }
            }

            Ok(())
        })?;

        Ok(j_ext)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> anyhow::Result<PointDiagnostics> {
        let dim = self.dimension();
        let param = aug_state[0];
        let state: Vec<f64> = aug_state.rows(1, dim).iter().cloned().collect();
        let kind = self.kind;

        let mat = self.with_param(param, |system| {
            let jac = fork_core::equilibrium::compute_jacobian(system, kind, &state)?;
            Ok(DMatrix::from_row_slice(dim, dim, &jac))
        })?;

        let fold = mat.determinant();
        let eigenvalues = compute_eigenvalues(&mat)?;
        let (hopf, neutral) = if matches!(kind, SystemKind::Flow) && dim >= 2 {
            (
                hopf_test_function(&eigenvalues).re,
                neutral_saddle_test_function(&eigenvalues),
            )
        } else {
            (0.0, 0.0)
        };

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(fold, hopf, neutral),
            eigenvalues,
        })
    }
}

/// WASM-exported runner for stepped equilibrium continuation.
/// Allows progress reporting by running batches of steps at a time.
#[wasm_bindgen]
pub struct WasmEquilibriumRunner {
    runner: Option<ContinuationRunner<OwnedEquilibriumContinuationProblem>>,
}

#[wasm_bindgen]
impl WasmEquilibriumRunner {
    /// Create a new stepped equilibrium continuation runner.
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        equilibrium_state: Vec<f64>,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmEquilibriumRunner, JsValue> {
        console_error_panic_hook::set_once();

        // Parse equations and create system
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            let code = compiler.compile(&expr);
            bytecodes.push(code);
        }

        let mut system = EquationSystem::new(bytecodes, params);
        system.set_maps(compiler.param_map, compiler.var_map);

        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let param_index = *system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let initial_point = ContinuationPoint {
            state: equilibrium_state,
            param_value: system.params[param_index],
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
        };

        let problem = OwnedEquilibriumContinuationProblem::new(system, kind, param_index);

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmEquilibriumRunner {
            runner: Some(runner),
        })
    }

    /// Check if the continuation is complete.
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

        let branch = runner.take_result();

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

fn validate_mesh_states(
    state_dim: usize,
    mesh_points: usize,
    states: &[Vec<f64>],
) -> anyhow::Result<()> {
    if states.len() != mesh_points {
        anyhow::bail!(
            "Initial guess must provide {} mesh states (got {})",
            mesh_points,
            states.len()
        );
    }
    for slice in states {
        if slice.len() != state_dim {
            anyhow::bail!(
                "State slice length {} does not match system dimension {}",
                slice.len(),
                state_dim
            );
        }
    }
    Ok(())
}

fn build_stage_states_from_mesh(
    dim: usize,
    mesh_points: usize,
    degree: usize,
    nodes: &[f64],
    mesh_states: &[Vec<f64>],
) -> Vec<Vec<Vec<f64>>> {
    let mut stage_states = Vec::with_capacity(mesh_points);
    for i in 0..mesh_points {
        let next = if i + 1 == mesh_points {
            &mesh_states[0]
        } else {
            &mesh_states[i + 1]
        };
        let current = &mesh_states[i];
        let mut stages = Vec::with_capacity(degree);
        for &node in nodes {
            let mut stage = vec![0.0; dim];
            for d in 0..dim {
                stage[d] = current[d] + node * (next[d] - current[d]);
            }
            stages.push(stage);
        }
        stage_states.push(stages);
    }
    stage_states
}

fn flatten_collocation_state(
    mesh_states: &[Vec<f64>],
    stage_states: &[Vec<Vec<f64>>],
    period: f64,
) -> Vec<f64> {
    let mesh_flat: Vec<f64> = mesh_states.iter().flatten().cloned().collect();
    let stage_flat: Vec<f64> = stage_states.iter().flatten().flatten().cloned().collect();
    let mut flat = Vec::with_capacity(mesh_flat.len() + stage_flat.len() + 1);
    flat.extend(mesh_flat);
    flat.extend(stage_flat);
    flat.push(period);
    flat
}

fn compute_tangent_from_problem<P: ContinuationProblem>(
    problem: &mut P,
    aug_state: &DVector<f64>,
) -> anyhow::Result<DVector<f64>> {
    let dim = problem.dimension();
    let jac = problem.extended_jacobian(aug_state)?;

    if jac.nrows() != dim || jac.ncols() != dim + 1 {
        anyhow::bail!(
            "Jacobian has unexpected dimensions: {}x{}, expected {}x{}",
            jac.nrows(),
            jac.ncols(),
            dim,
            dim + 1
        );
    }

    let bordering_candidates = [0, dim, 1];
    for &idx in &bordering_candidates {
        let mut c = DVector::zeros(dim + 1);
        c[idx.min(dim)] = 1.0;

        let mut bordered = DMatrix::zeros(dim + 1, dim + 1);
        for i in 0..dim {
            for j in 0..dim + 1 {
                bordered[(i, j)] = jac[(i, j)];
            }
        }
        for j in 0..dim + 1 {
            bordered[(dim, j)] = c[j];
        }

        let mut rhs = DVector::zeros(dim + 1);
        rhs[dim] = 1.0;

        let lu = bordered.lu();
        if let Some(sol) = lu.solve(&rhs) {
            let norm = sol.norm();
            if norm > 1e-10 && sol.iter().all(|v| v.is_finite()) {
                return Ok(sol / norm);
            }
        }
    }

    let mut tangent = DVector::zeros(dim + 1);
    tangent[0] = 1.0;
    Ok(tangent)
}

#[wasm_bindgen]
pub struct WasmLimitCycleRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<PeriodicOrbitCollocationProblem<'static>>>,
}

#[wasm_bindgen]
impl WasmLimitCycleRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        _system_type: &str,
        setup_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmLimitCycleRunner, JsValue> {
        console_error_panic_hook::set_once();

        let setup: LimitCycleSetup = from_value(setup_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle setup: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let system = build_system(equations, params, &param_names, &var_names)?;

        let param_index = *system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let config = setup.collocation_config();
        let dim = system.equations.len();
        validate_mesh_states(dim, config.mesh_points, &setup.guess.mesh_states)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let stage_states = if setup.guess.stage_states.is_empty() {
            let coeffs = CollocationCoefficients::new(config.degree)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            build_stage_states_from_mesh(
                dim,
                config.mesh_points,
                config.degree,
                &coeffs.nodes,
                &setup.guess.mesh_states,
            )
        } else {
            setup.guess.stage_states.clone()
        };

        let flat_state = flatten_collocation_state(
            &setup.guess.mesh_states,
            &stage_states,
            setup.guess.period,
        );

        let initial_point = ContinuationPoint {
            state: flat_state,
            param_value: setup.guess.param_value,
            stability: fork_core::continuation::BifurcationType::None,
            eigenvalues: Vec::new(),
        };

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = PeriodicOrbitCollocationProblem::new(
            unsafe { &mut *system_ptr },
            param_index,
            config.mesh_points,
            config.degree,
            config.phase_anchor,
            config.phase_direction,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create LC problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: PeriodicOrbitCollocationProblem<'static> =
            unsafe { std::mem::transmute(problem) };

        let mut runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;
        runner.set_branch_type(BranchType::LimitCycle {
            ntst: config.mesh_points,
            ncol: config.degree,
        });

        Ok(WasmLimitCycleRunner {
            system: boxed_system,
            runner: Some(runner),
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

struct ExtensionMergeContext {
    branch: ContinuationBranch,
    index_offset: i32,
    sign: i32,
}

enum ExtensionRunnerKind {
    Equilibrium {
        runner: ContinuationRunner<OwnedEquilibriumContinuationProblem>,
        merge: ExtensionMergeContext,
    },
    LimitCycle {
        _system: Box<EquationSystem>,
        runner: ContinuationRunner<PeriodicOrbitCollocationProblem<'static>>,
        merge: ExtensionMergeContext,
    },
}

#[wasm_bindgen]
pub struct WasmContinuationExtensionRunner {
    runner: Option<ExtensionRunnerKind>,
}

#[wasm_bindgen]
impl WasmContinuationExtensionRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        branch_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmContinuationExtensionRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

        if branch.indices.is_empty() {
            branch.indices = (0..branch.points.len() as i32).collect();
        }

        let (endpoint_idx, last_index, neighbor_idx, is_append) = if forward {
            let max_idx_pos = branch
                .indices
                .iter()
                .enumerate()
                .max_by_key(|(_, &idx)| idx)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
            let prev_idx_pos = if branch.points.len() > 1 {
                branch
                    .indices
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != max_idx_pos)
                    .max_by_key(|(_, &idx)| idx)
                    .map(|(i, _)| i)
            } else {
                None
            };
            (max_idx_pos, branch.indices[max_idx_pos], prev_idx_pos, true)
        } else {
            let min_idx_pos = branch
                .indices
                .iter()
                .enumerate()
                .min_by_key(|(_, &idx)| idx)
                .ok_or_else(|| JsValue::from_str("Branch has no indices"))?
                .0;
            let next_idx_pos = if branch.points.len() > 1 {
                branch
                    .indices
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != min_idx_pos)
                    .min_by_key(|(_, &idx)| idx)
                    .map(|(i, _)| i)
            } else {
                None
            };
            (min_idx_pos, branch.indices[min_idx_pos], next_idx_pos, false)
        };

        let sign = if is_append { 1 } else { -1 };
        let mut merge = ExtensionMergeContext {
            branch,
            index_offset: last_index,
            sign,
        };
        let endpoint = merge
            .branch
            .points
            .get(endpoint_idx)
            .cloned()
            .ok_or_else(|| JsValue::from_str("Branch endpoint missing"))?;

        let system = build_system(equations, params, &param_names, &var_names)?;
        let param_index = *system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let runner_kind = match &merge.branch.branch_type {
            BranchType::Equilibrium => {
                let kind = match system_type {
                    "map" => SystemKind::Map,
                    _ => SystemKind::Flow,
                };

                let mut problem = OwnedEquilibriumContinuationProblem::new(system, kind, param_index);
                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in endpoint.state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = if is_append {
                        &end_aug - &neighbor_aug
                    } else {
                        &neighbor_aug - &end_aug
                    };
                    if secant.norm() > 1e-12 {
                        Some(secant.normalize())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

                if let Some(secant) = secant_direction {
                    if tangent.dot(&secant) < 0.0 {
                        tangent = -tangent;
                    }
                } else {
                    let forward_sign = if forward { 1.0 } else { -1.0 };
                    if tangent[0] * forward_sign < 0.0 {
                        tangent = -tangent;
                    }
                }

                let initial_point = ContinuationPoint {
                    state: endpoint.state.clone(),
                    param_value: endpoint.param_value,
                    stability: endpoint.stability.clone(),
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                let mut runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());

                ExtensionRunnerKind::Equilibrium { runner, merge }
            }
            BranchType::LimitCycle { ntst, ncol } => {
                if merge.branch.upoldp.is_none() {
                    if let Some(last_pt) = merge.branch.points.last() {
                        let dim = system.equations.len();
                        if last_pt.state.len() > dim {
                            let x0 = &last_pt.state[0..dim];
                            let period = *last_pt.state.last().unwrap_or(&1.0);
                            let mut work = vec![0.0; dim];
                            system.apply(0.0, x0, &mut work);
                            let u0: Vec<f64> = work.iter().map(|&v| v * period).collect();
                            merge.branch.upoldp = Some(vec![u0]);
                        }
                    }
                }

                let upoldp = merge
                    .branch
                    .upoldp
                    .clone()
                    .ok_or_else(|| JsValue::from_str("Limit cycle branch missing upoldp data"))?;

                let phase_direction = if !upoldp.is_empty() && !upoldp[0].is_empty() {
                    let dir_norm: f64 = upoldp[0].iter().map(|v| v * v).sum::<f64>().sqrt();
                    if dir_norm > 1e-12 {
                        upoldp[0].iter().map(|v| v / dir_norm).collect()
                    } else {
                        upoldp[0].clone()
                    }
                } else {
                    vec![1.0]
                };

                let last_pt = merge
                    .branch
                    .points
                    .last()
                    .ok_or_else(|| JsValue::from_str("Branch has no points"))?;
                let dim = system.equations.len();
                let phase_anchor: Vec<f64> = last_pt.state.iter().take(dim).cloned().collect();

                let mut boxed_system = Box::new(system);
                let system_ptr: *mut EquationSystem = &mut *boxed_system;
                let mut problem = PeriodicOrbitCollocationProblem::new(
                    unsafe { &mut *system_ptr },
                    param_index,
                    *ntst,
                    *ncol,
                    phase_anchor,
                    phase_direction,
                )
                .map_err(|e| JsValue::from_str(&format!("Failed to create LC problem: {}", e)))?;

                let dim = problem.dimension();
                if endpoint.state.len() != dim {
                    return Err(JsValue::from_str(&format!(
                        "Dimension mismatch: branch point state has length {}, problem expects {}",
                        endpoint.state.len(),
                        dim
                    )));
                }

                let mut end_aug = DVector::zeros(dim + 1);
                end_aug[0] = endpoint.param_value;
                for (i, &v) in endpoint.state.iter().enumerate() {
                    end_aug[i + 1] = v;
                }

                let secant_direction = if let Some(neighbor_pos) = neighbor_idx {
                    let neighbor = &merge.branch.points[neighbor_pos];
                    let mut neighbor_aug = DVector::zeros(dim + 1);
                    neighbor_aug[0] = neighbor.param_value;
                    for (i, &v) in neighbor.state.iter().enumerate() {
                        neighbor_aug[i + 1] = v;
                    }
                    let secant = if is_append {
                        &end_aug - &neighbor_aug
                    } else {
                        &neighbor_aug - &end_aug
                    };
                    if secant.norm() > 1e-12 {
                        Some(secant.normalize())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let mut tangent = compute_tangent_from_problem(&mut problem, &end_aug)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

                if let Some(secant) = secant_direction {
                    if tangent.dot(&secant) < 0.0 {
                        tangent = -tangent;
                    }
                } else {
                    let forward_sign = if forward { 1.0 } else { -1.0 };
                    if tangent[0] * forward_sign < 0.0 {
                        tangent = -tangent;
                    }
                }

                let initial_point = ContinuationPoint {
                    state: endpoint.state.clone(),
                    param_value: endpoint.param_value,
                    stability: endpoint.stability.clone(),
                    eigenvalues: endpoint.eigenvalues.clone(),
                };

                // SAFETY: The problem borrows the boxed system allocation, which lives
                // for the lifetime of the runner.
                let problem: PeriodicOrbitCollocationProblem<'static> =
                    unsafe { std::mem::transmute(problem) };

                let mut runner = ContinuationRunner::new_with_tangent(
                    problem,
                    initial_point,
                    tangent,
                    settings,
                )
                .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;
                runner.set_branch_type(merge.branch.branch_type.clone());
                runner.set_upoldp(merge.branch.upoldp.clone());

                ExtensionRunnerKind::LimitCycle {
                    _system: boxed_system,
                    runner,
                    merge,
                }
            }
        };

        Ok(WasmContinuationExtensionRunner {
            runner: Some(runner_kind),
        })
    }

    pub fn is_done(&self) -> bool {
        match self.runner.as_ref() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner.is_done(),
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner.is_done(),
            None => true,
        }
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_mut() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner
                .run_steps(batch_size as usize)
                .map_err(|e| JsValue::from_str(&format!("Continuation step failed: {}", e)))?,
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let result = match self.runner.as_ref() {
            Some(ExtensionRunnerKind::Equilibrium { runner, .. }) => runner.step_result(),
            Some(ExtensionRunnerKind::LimitCycle { runner, .. }) => runner.step_result(),
            None => return Err(JsValue::from_str("Runner not initialized")),
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner_kind = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let (extension, merge) = match runner_kind {
            ExtensionRunnerKind::Equilibrium { runner, merge } => (runner.take_result(), merge),
            ExtensionRunnerKind::LimitCycle { runner, merge, .. } => (runner.take_result(), merge),
        };

        let mut branch = merge.branch;
        let orig_count = branch.points.len();
        let ExtensionMergeContext {
            index_offset,
            sign,
            ..
        } = merge;

        for (i, pt) in extension.points.into_iter().enumerate().skip(1) {
            branch.points.push(pt);
            let idx = extension.indices.get(i).cloned().unwrap_or(i as i32);
            branch.indices.push(index_offset + idx * sign);
        }

        for ext_bif_idx in extension.bifurcations {
            if ext_bif_idx > 0 {
                branch.bifurcations.push(orig_count + ext_bif_idx - 1);
            }
        }

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmFoldCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<FoldCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    fold_state: Vec<f64>,
    param2_value: f64,
}

#[wasm_bindgen]
impl WasmFoldCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        fold_state: Vec<f64>,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmFoldCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let param1_index = *system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = FoldCurveProblem::new(
            unsafe { &mut *system_ptr },
            kind,
            &fold_state,
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create fold problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: FoldCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(fold_state.len() + 1);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&fold_state);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Fold,
            eigenvalues: vec![],
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmFoldCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            fold_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n = self.fold_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if !pt.state.is_empty() {
                    pt.state[0]
                } else {
                    self.param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                    pt.state[1..(n + 1)].to_vec()
                } else {
                    self.fold_state.clone()
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
            curve_type: Codim1CurveType::Fold,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmHopfCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<HopfCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    hopf_state: Vec<f64>,
    hopf_omega: f64,
    param2_value: f64,
}

#[wasm_bindgen]
impl WasmHopfCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        hopf_state: Vec<f64>,
        hopf_omega: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmHopfCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let param1_index = *system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = HopfCurveProblem::new(
            unsafe { &mut *system_ptr },
            kind,
            &hopf_state,
            hopf_omega,
            param1_index,
            param2_index,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to create Hopf problem: {}", e)))?;

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: HopfCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let n = hopf_state.len();
        let kappa = hopf_omega * hopf_omega;
        let mut augmented_state = Vec::with_capacity(n + 2);
        augmented_state.push(param2_value);
        augmented_state.extend_from_slice(&hopf_state);
        augmented_state.push(kappa);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::Hopf,
            eigenvalues: vec![],
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmHopfCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            hopf_state,
            hopf_omega,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n = self.hopf_state.len();
        let kappa_default = self.hopf_omega * self.hopf_omega;

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if !pt.state.is_empty() {
                    pt.state[0]
                } else {
                    self.param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n + 1 {
                    pt.state[1..(n + 1)].to_vec()
                } else {
                    self.hopf_state.clone()
                };
                let kappa = if pt.state.len() >= n + 2 {
                    pt.state[n + 1]
                } else {
                    kappa_default
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(kappa),
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::Hopf,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmLPCCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<LPCCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
}

#[wasm_bindgen]
impl WasmLPCCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
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
    ) -> Result<WasmLPCCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = LPCCurveProblem::new(
            unsafe { &mut *system_ptr },
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

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: LPCCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::CycleFold,
            eigenvalues: vec![],
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmLPCCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    self.param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    self.lc_state.clone()
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
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmPDCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<PDCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    full_lc_state: Vec<f64>,
    param2_value: f64,
}

#[wasm_bindgen]
impl WasmPDCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
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
    ) -> Result<WasmPDCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let u0: Vec<f64> = lc_state[0..dim].to_vec();
            let mesh_end = ntst * dim;
            let mut padded = Vec::with_capacity(lc_state.len() + dim);
            padded.extend_from_slice(&lc_state[0..mesh_end]);
            padded.extend_from_slice(&u0);
            padded.extend_from_slice(&lc_state[mesh_end..]);
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = PDCurveProblem::new(
            unsafe { &mut *system_ptr },
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

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: PDCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 2);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::PeriodDoubling,
            eigenvalues: vec![],
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmPDCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            full_lc_state,
            param2_value,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    self.param2_value
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    self.full_lc_state.clone()
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
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[wasm_bindgen]
pub struct WasmNSCurveRunner {
    #[allow(dead_code)]
    system: Box<EquationSystem>,
    runner: Option<ContinuationRunner<NSCurveProblem<'static>>>,
    param1_index: usize,
    param2_index: usize,
    lc_state: Vec<f64>,
    full_lc_state: Vec<f64>,
    param2_value: f64,
    initial_k: f64,
}

#[wasm_bindgen]
impl WasmNSCurveRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        lc_state: Vec<f64>,
        period: f64,
        param1_name: &str,
        param1_value: f64,
        param2_name: &str,
        param2_value: f64,
        initial_k: f64,
        ntst: usize,
        ncol: usize,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<WasmNSCurveRunner, JsValue> {
        console_error_panic_hook::set_once();

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let mut system = build_system(equations, params, &param_names, &var_names)?;
        let param1_index = *system.param_map.get(param1_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param1_name)))?;
        let param2_index = *system.param_map.get(param2_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", param2_name)))?;

        system.params[param1_index] = param1_value;
        system.params[param2_index] = param2_value;

        let dim = system.equations.len();
        let expected_ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let implicit_ncoords = ntst * ncol * dim + ntst * dim;

        let full_lc_state = if lc_state.len() == implicit_ncoords {
            let mut padded = lc_state.clone();
            let stages_len = ntst * ncol * dim;
            let u0: Vec<f64> = lc_state[stages_len..stages_len + dim].to_vec();
            padded.extend(u0);
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

        let mut boxed_system = Box::new(system);
        let system_ptr: *mut EquationSystem = &mut *boxed_system;
        let problem = NSCurveProblem::new(
            unsafe { &mut *system_ptr },
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

        // SAFETY: The problem borrows the boxed system allocation, which lives
        // for the lifetime of the runner.
        let problem: NSCurveProblem<'static> = unsafe { std::mem::transmute(problem) };

        let mut augmented_state = Vec::with_capacity(full_lc_state.len() + 3);
        augmented_state.extend_from_slice(&full_lc_state);
        augmented_state.push(period);
        augmented_state.push(param2_value);
        augmented_state.push(initial_k);

        let initial_point = ContinuationPoint {
            state: augmented_state,
            param_value: param1_value,
            stability: fork_core::continuation::BifurcationType::NeimarkSacker,
            eigenvalues: vec![],
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, forward)
            .map_err(|e| JsValue::from_str(&format!("Continuation init failed: {}", e)))?;

        Ok(WasmNSCurveRunner {
            system: boxed_system,
            runner: Some(runner),
            param1_index,
            param2_index,
            lc_state,
            full_lc_state,
            param2_value,
            initial_k,
        })
    }

    pub fn is_done(&self) -> bool {
        self.runner.as_ref().map_or(true, |runner| runner.is_done())
    }

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

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let result = runner.step_result();

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&mut self) -> Result<JsValue, JsValue> {
        let runner = self
            .runner
            .take()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let branch = runner.take_result();
        let n_lc = self.full_lc_state.len();

        let codim1_points: Vec<Codim1CurvePoint> = branch
            .points
            .iter()
            .map(|pt| {
                let p2 = if pt.state.len() >= n_lc + 2 {
                    pt.state[n_lc + 1]
                } else {
                    self.param2_value
                };
                let k_value = if pt.state.len() >= n_lc + 3 {
                    pt.state[n_lc + 2]
                } else {
                    self.initial_k
                };
                let physical_state: Vec<f64> = if pt.state.len() >= n_lc + 1 {
                    pt.state[..(n_lc + 1)].to_vec()
                } else {
                    self.lc_state.clone()
                };

                Codim1CurvePoint {
                    state: physical_state,
                    param1_value: pt.param_value,
                    param2_value: p2,
                    codim2_type: Codim2BifurcationType::None,
                    auxiliary: Some(k_value),
                    eigenvalues: pt.eigenvalues.clone(),
                }
            })
            .collect();

        let codim1_branch = Codim1CurveBranch {
            curve_type: Codim1CurveType::NeimarkSacker,
            param1_index: self.param1_index,
            param2_index: self.param2_index,
            points: codim1_points,
            codim2_bifurcations: vec![],
            indices: branch.indices.clone(),
        };

        to_value(&codim1_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

fn apply_qr(phi_slice: &mut [f64], dim: usize, accum: &mut [f64]) -> anyhow::Result<()> {
    if phi_slice.len() != dim * dim {
        anyhow::bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, phi_slice);
    let qr = QR::new(matrix);
    let (q, r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)].abs();
        if diag <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        accum[i] += diag.ln();
    }
    for i in 0..dim {
        for j in 0..dim {
            phi_slice[i * dim + j] = q[(i, j)];
        }
    }
    Ok(())
}

fn thin_qr_positive(slice: &[f64], dim: usize) -> anyhow::Result<(DMatrix<f64>, DMatrix<f64>)> {
    if slice.len() != dim * dim {
        anyhow::bail!("Tangent matrix slice has incorrect size.");
    }
    let matrix = DMatrix::from_row_slice(dim, dim, slice);
    let qr = QR::new(matrix);
    let (mut q, mut r) = qr.unpack();
    for i in 0..dim {
        let diag = r[(i, i)];
        if diag.abs() <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered near-singular R matrix during orthonormalization."
            ));
        }
        if diag < 0.0 {
            for row in 0..dim {
                q[(row, i)] = -q[(row, i)];
            }
            for col in i..dim {
                r[(i, col)] = -r[(i, col)];
            }
        }
    }
    Ok((q, r))
}

fn overwrite_slice_with_matrix(slice: &mut [f64], matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            slice[i * dim + j] = matrix[(i, j)];
        }
    }
}

fn append_matrix_row_major(target: &mut Vec<f64>, matrix: &DMatrix<f64>) {
    let dim = matrix.nrows();
    for i in 0..dim {
        for j in 0..dim {
            target.push(matrix[(i, j)]);
        }
    }
}

fn solve_upper(r: &[f64], rhs: &[f64], dim: usize) -> anyhow::Result<Vec<f64>> {
    let mut result = vec![0.0; dim * dim];
    for col in 0..dim {
        for row in (0..dim).rev() {
            let mut value = rhs[row * dim + col];
            for k in row + 1..dim {
                value -= r[row * dim + k] * result[k * dim + col];
            }
            let diag = r[row * dim + row];
            if diag.abs() <= f64::EPSILON {
                return Err(anyhow::anyhow!(
                    "Encountered near-singular R matrix during backward substitution."
                ));
            }
            result[row * dim + col] = value / diag;
        }
    }
    Ok(result)
}

fn normalize_columns(matrix: &mut [f64], dim: usize) -> anyhow::Result<()> {
    for col in 0..dim {
        let mut norm = 0.0;
        for row in 0..dim {
            let value = matrix[row * dim + col];
            norm += value * value;
        }
        norm = norm.sqrt();
        if norm <= f64::EPSILON {
            return Err(anyhow::anyhow!(
                "Encountered degenerate CLV column during normalization."
            ));
        }
        for row in 0..dim {
            matrix[row * dim + col] /= norm;
        }
    }
    Ok(())
}

fn matmul_row_major(a: &[f64], b: &[f64], dest: &mut [f64], dim: usize) {
    for i in 0..dim {
        for j in 0..dim {
            let mut accum = 0.0;
            for k in 0..dim {
                accum += a[i * dim + k] * b[k * dim + j];
            }
            dest[i * dim + j] = accum;
        }
    }
}

fn unit_upper_triangular(dim: usize) -> Vec<f64> {
    let mut matrix = vec![0.0; dim * dim];
    for i in 0..dim {
        for j in i..dim {
            matrix[i * dim + j] = if i == j { 1.0 } else { 0.0 };
        }
    }
    matrix
}

#[derive(Serialize)]
struct AnalysisProgress {
    done: bool,
    current_step: usize,
    max_steps: usize,
}

enum LyapunovInternalStepper {
    RK4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

impl LyapunovInternalStepper {
    fn step(
        &mut self,
        system: &TangentSystem<EquationSystem>,
        t: &mut f64,
        state: &mut [f64],
        dt: f64,
    ) {
        match self {
            LyapunovInternalStepper::RK4(s) => s.step(system, t, state, dt),
            LyapunovInternalStepper::Tsit5(s) => s.step(system, t, state, dt),
            LyapunovInternalStepper::Discrete(s) => s.step(system, t, state, dt),
        }
    }
}

struct LyapunovRunnerState {
    tangent_system: TangentSystem<EquationSystem>,
    stepper: LyapunovInternalStepper,
    augmented_state: Vec<f64>,
    accum: Vec<f64>,
    t: f64,
    steps_done: usize,
    since_last_qr: usize,
    total_time: f64,
    dim: usize,
    dt: f64,
    steps: usize,
    qr_stride: usize,
    done: bool,
}

#[wasm_bindgen]
pub struct WasmLyapunovRunner {
    state: Option<LyapunovRunnerState>,
}

#[wasm_bindgen]
impl WasmLyapunovRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        initial_state: Vec<f64>,
        initial_time: f64,
        steps: u32,
        dt: f64,
        qr_stride: u32,
    ) -> Result<WasmLyapunovRunner, JsValue> {
        console_error_panic_hook::set_once();

        if initial_state.is_empty() {
            return Err(JsValue::from_str("Initial state must have positive dimension."));
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

        let system = build_system(equations, params, &param_names, &var_names)?;
        let dim = initial_state.len();
        if dim != system.equations.len() {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }

        let stepper = match solver_name {
            "rk4" => LyapunovInternalStepper::RK4(RK4::new(dim + dim * dim)),
            "tsit5" => LyapunovInternalStepper::Tsit5(Tsit5::new(dim + dim * dim)),
            "discrete" => LyapunovInternalStepper::Discrete(DiscreteMap::new(dim + dim * dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        let aug_dim = dim + dim * dim;
        let mut augmented_state = vec![0.0; aug_dim];
        augmented_state[..dim].copy_from_slice(&initial_state);
        for i in 0..dim {
            for j in 0..dim {
                augmented_state[dim + i * dim + j] = if i == j { 1.0 } else { 0.0 };
            }
        }

        let tangent_system = TangentSystem::new(system, dim);

        Ok(WasmLyapunovRunner {
            state: Some(LyapunovRunnerState {
                tangent_system,
                stepper,
                augmented_state,
                accum: vec![0.0; dim],
                t: initial_time,
                steps_done: 0,
                since_last_qr: 0,
                total_time: 0.0,
                dim,
                dt,
                steps: steps as usize,
                qr_stride: stride,
                done: false,
            }),
        })
    }

    pub fn is_done(&self) -> bool {
        self.state.as_ref().map_or(true, |state| state.done)
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.done {
            let progress = AnalysisProgress {
                done: true,
                current_step: state.steps_done,
                max_steps: state.steps,
            };
            return to_value(&progress)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }

        for _ in 0..batch_size {
            if state.steps_done >= state.steps {
                state.done = true;
                break;
            }

            state.stepper.step(
                &state.tangent_system,
                &mut state.t,
                &mut state.augmented_state,
                state.dt,
            );
            state.steps_done += 1;
            state.since_last_qr += 1;
            state.total_time += state.dt;

            if state.since_last_qr == state.qr_stride || state.steps_done == state.steps {
                apply_qr(
                    &mut state.augmented_state[state.dim..],
                    state.dim,
                    &mut state.accum,
                )
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                state.since_last_qr = 0;
            }
        }

        if state.steps_done >= state.steps {
            state.done = true;
        }

        let progress = AnalysisProgress {
            done: state.done || state.steps_done >= state.steps,
            current_step: state.steps_done,
            max_steps: state.steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = AnalysisProgress {
            done: state.done,
            current_step: state.steps_done,
            max_steps: state.steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.total_time <= 0.0 {
            return Err(JsValue::from_str(
                "Total integration time is zero; cannot normalize exponents.",
            ));
        }

        let mut exponents = state.accum.clone();
        for value in &mut exponents {
            *value /= state.total_time;
        }

        to_value(&exponents).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

struct CovariantRunnerState {
    tangent_system: TangentSystem<EquationSystem>,
    stepper: LyapunovInternalStepper,
    augmented_state: Vec<f64>,
    t: f64,
    steps_done: usize,
    since_last_qr: usize,
    total_steps: usize,
    dt: f64,
    qr_stride: usize,
    window_steps: usize,
    forward_transient: usize,
    backward_transient: usize,
    q_history: Vec<f64>,
    r_history: Vec<f64>,
    time_history: Vec<f64>,
    window_accum: usize,
    backward_accum: usize,
    done: bool,
}

#[wasm_bindgen]
pub struct WasmCovariantLyapunovRunner {
    state: Option<CovariantRunnerState>,
}

#[wasm_bindgen]
impl WasmCovariantLyapunovRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        solver_name: &str,
        initial_state: Vec<f64>,
        initial_time: f64,
        dt: f64,
        qr_stride: u32,
        window_steps: u32,
        forward_transient: u32,
        backward_transient: u32,
    ) -> Result<WasmCovariantLyapunovRunner, JsValue> {
        console_error_panic_hook::set_once();

        if initial_state.is_empty() {
            return Err(JsValue::from_str("Initial state must have positive dimension."));
        }
        if dt <= 0.0 {
            return Err(JsValue::from_str("dt must be positive."));
        }
        if window_steps == 0 {
            return Err(JsValue::from_str("Window size must be at least one step."));
        }
        let stride = if qr_stride == 0 { 1 } else { qr_stride as usize };

        let total_steps = forward_transient as usize
            + window_steps as usize
            + backward_transient as usize;
        if total_steps == 0 {
            return Err(JsValue::from_str("Total integration steps must be positive."));
        }

        let system = build_system(equations, params, &param_names, &var_names)?;
        let dim = initial_state.len();
        if dim != system.equations.len() {
            return Err(JsValue::from_str("Initial state dimension mismatch."));
        }

        let stepper = match solver_name {
            "rk4" => LyapunovInternalStepper::RK4(RK4::new(dim + dim * dim)),
            "tsit5" => LyapunovInternalStepper::Tsit5(Tsit5::new(dim + dim * dim)),
            "discrete" => LyapunovInternalStepper::Discrete(DiscreteMap::new(dim + dim * dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        let aug_dim = dim + dim * dim;
        let mut augmented_state = vec![0.0; aug_dim];
        augmented_state[..dim].copy_from_slice(&initial_state);
        for i in 0..dim {
            for j in 0..dim {
                augmented_state[dim + i * dim + j] = if i == j { 1.0 } else { 0.0 };
            }
        }

        let tangent_system = TangentSystem::new(system, dim);

        Ok(WasmCovariantLyapunovRunner {
            state: Some(CovariantRunnerState {
                tangent_system,
                stepper,
                augmented_state,
                t: initial_time,
                steps_done: 0,
                since_last_qr: 0,
                total_steps,
                dt,
                qr_stride: stride,
                window_steps: window_steps as usize,
                forward_transient: forward_transient as usize,
                backward_transient: backward_transient as usize,
                q_history: Vec::new(),
                r_history: Vec::new(),
                time_history: Vec::new(),
                window_accum: 0,
                backward_accum: 0,
                done: false,
            }),
        })
    }

    pub fn is_done(&self) -> bool {
        self.state.as_ref().map_or(true, |state| state.done)
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.done {
            let progress = AnalysisProgress {
                done: true,
                current_step: state.steps_done,
                max_steps: state.total_steps,
            };
            return to_value(&progress)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }

        let dim = state.tangent_system.dimension;
        for _ in 0..batch_size {
            if state.steps_done >= state.total_steps {
                state.done = true;
                break;
            }

            state.stepper.step(
                &state.tangent_system,
                &mut state.t,
                &mut state.augmented_state,
                state.dt,
            );
            state.steps_done += 1;
            state.since_last_qr += 1;

            if state.since_last_qr == state.qr_stride || state.steps_done == state.total_steps {
                let block_steps = state.since_last_qr;
                state.since_last_qr = 0;

                let phi_slice = &mut state.augmented_state[dim..];
                let (q_matrix, r_matrix) = thin_qr_positive(phi_slice, dim)
                    .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
                overwrite_slice_with_matrix(phi_slice, &q_matrix);

                if state.steps_done <= state.forward_transient {
                    continue;
                }

                let mut stored = false;
                if state.window_accum < state.window_steps {
                    append_matrix_row_major(&mut state.q_history, &q_matrix);
                    append_matrix_row_major(&mut state.r_history, &r_matrix);
                    state.time_history.push(state.t);
                    state.window_accum = state
                        .window_accum
                        .saturating_add(block_steps)
                        .min(state.window_steps);
                    stored = true;
                } else if state.backward_accum < state.backward_transient {
                    append_matrix_row_major(&mut state.r_history, &r_matrix);
                    state.backward_accum = state
                        .backward_accum
                        .saturating_add(block_steps)
                        .min(state.backward_transient);
                    stored = true;
                }

                if !stored && state.window_accum < state.window_steps {
                    return Err(JsValue::from_str(
                        "Failed to store Gram-Schmidt data for the requested window.",
                    ));
                }

                if state.window_accum == state.window_steps
                    && state.backward_accum == state.backward_transient
                {
                    state.done = true;
                    break;
                }
            }
        }

        if state.steps_done >= state.total_steps {
            state.done = true;
        }

        let progress = AnalysisProgress {
            done: state.done,
            current_step: state.steps_done,
            max_steps: state.total_steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = AnalysisProgress {
            done: state.done,
            current_step: state.steps_done,
            max_steps: state.total_steps,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let dim = state.tangent_system.dimension;
        let dim_sq = dim * dim;
        if state.q_history.is_empty() {
            return Err(JsValue::from_str(
                "No CLV data stored. Ensure window duration exceeds qr_stride.",
            ));
        }
        if state.q_history.len() % dim_sq != 0 || state.r_history.len() % dim_sq != 0 {
            return Err(JsValue::from_str(
                "Internal storage size mismatch while assembling CLVs.",
            ));
        }

        let window_count = state.q_history.len() / dim_sq;
        let total_r_count = state.r_history.len() / dim_sq;
        if total_r_count < window_count {
            return Err(JsValue::from_str("Insufficient R-history for backward pass."));
        }

        let mut c_matrix = unit_upper_triangular(dim);
        for idx in (window_count..total_r_count).rev() {
            let r_slice = &state.r_history[idx * dim_sq..(idx + 1) * dim_sq];
            c_matrix = solve_upper(r_slice, &c_matrix, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            normalize_columns(&mut c_matrix, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
        }

        let mut clv_vectors = vec![0.0; state.q_history.len()];
        let mut c_current = c_matrix;

        for idx in (0..window_count).rev() {
            let q_slice = &state.q_history[idx * dim_sq..(idx + 1) * dim_sq];
            let r_slice = &state.r_history[idx * dim_sq..(idx + 1) * dim_sq];
            let dest = &mut clv_vectors[idx * dim_sq..(idx + 1) * dim_sq];
            matmul_row_major(q_slice, &c_current, dest, dim);
            let next_c = solve_upper(r_slice, &c_current, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
            c_current = next_c;
            normalize_columns(&mut c_current, dim)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;
        }

        let payload = CovariantVectorsPayload {
            dimension: dim,
            checkpoints: window_count,
            times: state.time_history.clone(),
            vectors: clv_vectors,
        };

        to_value(&payload).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[derive(Serialize)]
struct EquilibriumSolveProgress {
    done: bool,
    iterations: usize,
    max_steps: usize,
    residual_norm: f64,
}

struct EquilibriumSolverState {
    system: EquationSystem,
    kind: SystemKind,
    state: Vec<f64>,
    residual: Vec<f64>,
    residual_norm: f64,
    iterations: usize,
    settings: NewtonSettings,
    done: bool,
}

#[wasm_bindgen]
pub struct WasmEquilibriumSolverRunner {
    state: Option<EquilibriumSolverState>,
}

#[wasm_bindgen]
impl WasmEquilibriumSolverRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(
        equations: Vec<String>,
        params: Vec<f64>,
        param_names: Vec<String>,
        var_names: Vec<String>,
        system_type: &str,
        initial_guess: Vec<f64>,
        max_steps: u32,
        damping: f64,
    ) -> Result<WasmEquilibriumSolverRunner, JsValue> {
        console_error_panic_hook::set_once();

        let system = build_system(equations, params, &param_names, &var_names)?;
        let kind = match system_type {
            "map" => SystemKind::Map,
            _ => SystemKind::Flow,
        };

        let settings = NewtonSettings {
            max_steps: max_steps as usize,
            damping,
            ..NewtonSettings::default()
        };

        let dim = system.equations.len();
        if dim == 0 {
            return Err(JsValue::from_str("System has zero dimension."));
        }
        if initial_guess.len() != dim {
            return Err(JsValue::from_str("Initial guess dimension mismatch."));
        }

        let state = initial_guess;
        let mut residual = vec![0.0; dim];
        evaluate_equilibrium_residual(&system, kind, &state, &mut residual);
        let residual_norm = l2_norm(&residual);

        Ok(WasmEquilibriumSolverRunner {
            state: Some(EquilibriumSolverState {
                system,
                kind,
                state,
                residual,
                residual_norm,
                iterations: 0,
                settings,
                done: false,
            }),
        })
    }

    pub fn is_done(&self) -> bool {
        self.state.as_ref().map_or(true, |state| state.done)
    }

    pub fn run_steps(&mut self, batch_size: u32) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.done {
            let progress = EquilibriumSolveProgress {
                done: true,
                iterations: state.iterations,
                max_steps: state.settings.max_steps,
                residual_norm: state.residual_norm,
            };
            return to_value(&progress)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)));
        }

        for _ in 0..batch_size {
            if state.residual_norm <= state.settings.tolerance {
                state.done = true;
                break;
            }

            if state.iterations >= state.settings.max_steps {
                return Err(JsValue::from_str(&format!(
                    "Newton solver failed to converge in {} steps (‖f(x)‖ = {}).",
                    state.settings.max_steps,
                    state.residual_norm
                )));
            }

            let jacobian = fork_core::equilibrium::compute_jacobian(
                &state.system,
                state.kind,
                &state.state,
            )
            .map_err(|e| JsValue::from_str(&format!("Jacobian failed: {}", e)))?;
            let delta = solve_linear_system(state.system.equations.len(), &jacobian, &state.residual)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

            for i in 0..state.state.len() {
                state.state[i] -= state.settings.damping * delta[i];
            }

            state.iterations += 1;
            evaluate_equilibrium_residual(&state.system, state.kind, &state.state, &mut state.residual);
            state.residual_norm = l2_norm(&state.residual);
        }

        let progress = EquilibriumSolveProgress {
            done: state.done,
            iterations: state.iterations,
            max_steps: state.settings.max_steps,
            residual_norm: state.residual_norm,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_progress(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        let progress = EquilibriumSolveProgress {
            done: state.done,
            iterations: state.iterations,
            max_steps: state.settings.max_steps,
            residual_norm: state.residual_norm,
        };

        to_value(&progress).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn get_result(&self) -> Result<JsValue, JsValue> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Runner not initialized"))?;

        if state.residual_norm > state.settings.tolerance {
            return Err(JsValue::from_str("Equilibrium solver has not converged yet."));
        }

        let jacobian = fork_core::equilibrium::compute_jacobian(
            &state.system,
            state.kind,
            &state.state,
        )
        .map_err(|e| JsValue::from_str(&format!("Jacobian failed: {}", e)))?;
        let eigenpairs = compute_equilibrium_eigenpairs(state.system.equations.len(), &jacobian)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        let result = EquilibriumResult {
            state: state.state.clone(),
            residual_norm: state.residual_norm,
            iterations: state.iterations,
            jacobian,
            eigenpairs,
        };

        to_value(&result).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

fn evaluate_equilibrium_residual(
    system: &EquationSystem,
    kind: SystemKind,
    state: &[f64],
    out: &mut [f64],
) {
    match kind {
        SystemKind::Flow => system.apply(0.0, state, out),
        SystemKind::Map => {
            system.apply(0.0, state, out);
            for i in 0..out.len() {
                out[i] -= state[i];
            }
        }
    }
}

fn solve_linear_system(dim: usize, jacobian: &[f64], residual: &[f64]) -> anyhow::Result<Vec<f64>> {
    let j_matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let rhs = DVector::from_column_slice(residual);
    j_matrix
        .lu()
        .solve(&rhs)
        .map(|v| v.iter().cloned().collect())
        .ok_or_else(|| anyhow::anyhow!("Jacobian is singular."))
}

fn compute_equilibrium_eigenpairs(
    dim: usize,
    jacobian: &[f64],
) -> anyhow::Result<Vec<EigenPair>> {
    let matrix = DMatrix::from_row_slice(dim, dim, jacobian);
    let eigenvalues = matrix.complex_eigenvalues();
    let complex_matrix = matrix.map(|v| Complex::new(v, 0.0));

    let mut pairs = Vec::with_capacity(dim);
    for idx in 0..dim {
        let lambda = eigenvalues[idx];

        let mut shifted = complex_matrix.clone();
        for i in 0..dim {
            shifted[(i, i)] -= lambda;
        }

        let svd = SVD::new(shifted, true, true);
        let v_t = svd
            .v_t
            .ok_or_else(|| anyhow::anyhow!("Failed to compute eigenvector for eigenvalue index {}", idx))?;
        let row_index = v_t.nrows().saturating_sub(1);
        let row = v_t.row(row_index);
        let mut vector: Vec<Complex<f64>> = row.iter().map(|c| *c).collect();
        normalize_complex_vector(&mut vector);

        pairs.push(EigenPair {
            value: fork_core::equilibrium::ComplexNumber::from(lambda),
            vector: vector
                .into_iter()
                .map(fork_core::equilibrium::ComplexNumber::from)
                .collect(),
        });
    }
    Ok(pairs)
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|v| v * v).sum::<f64>().sqrt()
}

fn normalize_complex_vector(vec: &mut [Complex<f64>]) {
    let norm = vec.iter().map(|c| c.norm_sqr()).sum::<f64>().sqrt();
    if norm > 0.0 {
        for entry in vec {
            *entry /= norm;
        }
    }
}

// ============================================================================
// Helper function to add stepped continuation to WasmSystem
// ============================================================================

#[wasm_bindgen]
impl WasmSystem {
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
            forward
        ).map_err(|e| JsValue::from_str(&format!("Continuation failed: {}", e)))?;
        
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
