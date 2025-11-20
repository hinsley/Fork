use wasm_bindgen::prelude::*;
use fork_core::equation_engine::{Compiler, EquationSystem, parse};
use fork_core::solvers::{RK4, Tsit5, DiscreteMap};
use fork_core::traits::{Steppable, DynamicalSystem};
use fork_core::autodiff::Dual;

#[wasm_bindgen]
pub struct WasmSystem {
    system: EquationSystem<f64>,
    state: Vec<f64>,
    t: f64,
    solver: SolverType,
}

enum SolverType {
    RK4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

#[wasm_bindgen]
impl WasmSystem {
    #[wasm_bindgen(constructor)]
    pub fn new(equations: Vec<String>, params: Vec<f64>, param_names: Vec<String>, var_names: Vec<String>, solver_name: &str) -> Result<WasmSystem, JsValue> {
        let compiler = Compiler::new(&var_names, &param_names);
        let mut bytecodes = Vec::new();
        for eq_str in equations {
            let expr = parse(&eq_str).map_err(|e| JsValue::from_str(&e))?;
            let code = compiler.compile(&expr);
            bytecodes.push(code);
        }

        let system = EquationSystem::new(bytecodes, params);
        let dim = system.dimension();

        let solver = match solver_name {
            "rk4" => SolverType::RK4(RK4::new(dim)),
            "tsit5" => SolverType::Tsit5(Tsit5::new(dim)),
            "discrete" => SolverType::Discrete(DiscreteMap::new(dim)),
            _ => return Err(JsValue::from_str("Unknown solver")),
        };

        Ok(WasmSystem {
            system,
            state: vec![0.0; dim],
            t: 0.0,
            solver,
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
        let dual_params: Vec<Dual> = self.system.params.iter().map(|&p| Dual::new(p, 0.0)).collect();
        let dual_system = EquationSystem::new(self.system.equations.clone(), dual_params);
        
        let n = self.system.dimension();
        let mut jacobian = vec![0.0; n * n];
        let mut dual_x = vec![Dual::new(0.0, 0.0); n];
        let mut dual_out = vec![Dual::new(0.0, 0.0); n];
        let t_dual = Dual::new(self.t, 0.0);
        
        for j in 0..n {
            for i in 0..n {
                dual_x[i] = Dual::new(self.state[i], if i == j { 1.0 } else { 0.0 });
            }
            dual_system.apply(t_dual, &dual_x, &mut dual_out);
            for i in 0..n {
                jacobian[i * n + j] = dual_out[i].eps;
            }
        }
        
        jacobian
    }
}
