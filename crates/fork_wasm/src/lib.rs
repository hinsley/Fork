use fork_core::analysis::{lyapunov_exponents as core_lyapunov, LyapunovStepper};
use fork_core::autodiff::Dual;
use fork_core::continuation::{
    continue_parameter as core_continuation, extend_branch as core_extend_branch, ContinuationBranch,
    ContinuationSettings,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::{
    solve_equilibrium as core_equilibrium_solver, NewtonSettings, SystemKind,
};
use fork_core::solvers::{DiscreteMap, Tsit5, RK4};
use fork_core::traits::{DynamicalSystem, Steppable};
use js_sys::Float64Array;
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

        let kind = match self.system_type {
            SystemType::Flow => SystemKind::Flow,
            SystemType::Map => SystemKind::Map,
        };
        
        let param_index = *self.system.param_map.get(parameter_name)
            .ok_or_else(|| JsValue::from_str(&format!("Unknown parameter: {}", parameter_name)))?;
        
        let updated_branch = core_extend_branch(
            &mut self.system,
            kind,
            branch,
            param_index,
            settings,
            forward
        ).map_err(|e| JsValue::from_str(&format!("Branch extension failed: {}", e)))?;
        
        to_value(&updated_branch).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }
}
