//! Core WASM system wrapper and low-level utilities.

use fork_core::autodiff::Dual;
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::solvers::{DiscreteMap, RK4, Tsit5};
use fork_core::traits::{DynamicalSystem, Steppable};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmSystem {
    pub(crate) system: EquationSystem,
    state: Vec<f64>,
    t: f64,
    pub(crate) solver: SolverType,
    pub(crate) system_type: SystemType,
}

pub(crate) enum SolverType {
    RK4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

pub(crate) enum SystemType {
    Flow,
    Map,
}

pub(crate) fn build_system(
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
}
