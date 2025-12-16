use fork_core::analysis::{
    covariant_lyapunov_vectors as core_clv, lyapunov_exponents as core_lyapunov, LyapunovStepper,
};
use fork_core::autodiff::Dual;
use fork_core::continuation::{
    continue_parameter as core_continuation, extend_branch as core_extend_branch,
    compute_eigenvalues_for_state, ContinuationBranch, ContinuationSettings,
    hopf_init::{extract_hopf_data, init_limit_cycle_from_hopf},
    CollocationConfig, LimitCycleGuess, continue_limit_cycle, extend_limit_cycle,
    ContinuationPoint, BifurcationType, BranchType,
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
        
        let branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;

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
                let config = CollocationConfig { ntst: *ntst, ncol: *ncol };
                let upoldp = branch.upoldp.clone()
                    .ok_or_else(|| JsValue::from_str("Limit cycle branch missing upoldp data"))?;
                extend_limit_cycle(
                    &mut self.system,
                    param_index,
                    &config,
                    branch,
                    upoldp,
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
    /// Returns the LimitCycleGuess as a serialized JsValue.
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

        // Create a ContinuationPoint to pass to extract_hopf_data
        let hopf_point = ContinuationPoint {
            state: hopf_state,
            param_value,
            stability: BifurcationType::Hopf,
            eigenvalues: Vec::new(),
        };

        let old_param = self.system.params[param_index];
        self.system.params[param_index] = param_value;

        let hopf_data = extract_hopf_data(&mut self.system, &hopf_point, param_index)
            .map_err(|e| JsValue::from_str(&format!("Failed to extract Hopf data: {}", e)))?;

        let config = CollocationConfig {
            ntst: ntst as usize,
            ncol: ncol as usize,
        };

        let guess = init_limit_cycle_from_hopf(&hopf_data, amplitude, &config)
            .map_err(|e| JsValue::from_str(&format!("Failed to initialize limit cycle: {}", e)))?;

        self.system.params[param_index] = old_param;

        to_value(&guess).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Computes limit cycle continuation from an initial guess.
    pub fn compute_limit_cycle_continuation(
        &mut self,
        guess_val: JsValue,
        parameter_name: &str,
        settings_val: JsValue,
        ntst: u32,
        ncol: u32,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        let guess: LimitCycleGuess = from_value(guess_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle guess: {}", e)))?;

        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param_index = *self
            .system
            .param_map
            .get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;

        let config = CollocationConfig {
            ntst: ntst as usize,
            ncol: ncol as usize,
        };

        let branch = continue_limit_cycle(
            &mut self.system,
            param_index,
            &config,
            guess,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Limit cycle continuation failed: {}", e)))?;

        to_value(&branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}

#[derive(Serialize)]
struct CovariantVectorsPayload {
    dimension: usize,
    checkpoints: usize,
    times: Vec<f64>,
    vectors: Vec<f64>,
}
