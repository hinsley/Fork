use fork_core::analysis::{
    covariant_lyapunov_vectors as core_clv, lyapunov_exponents as core_lyapunov, LyapunovStepper,
};
use fork_core::autodiff::Dual;
use fork_core::continuation::{
    compute_eigenvalues_for_state, continue_limit_cycle_collocation,
    continue_parameter as core_continuation, extend_branch as core_extend_branch,
    extend_limit_cycle_collocation, limit_cycle_setup_from_hopf, CollocationConfig,
    ContinuationBranch, ContinuationSettings,
};
use fork_core::equation_engine::{parse, Compiler, EquationSystem};
use fork_core::equilibrium::{
    solve_equilibrium as core_equilibrium_solver, NewtonSettings, SystemKind,
};
use fork_core::solvers::{DiscreteMap, Tsit5, RK4};
use fork_core::traits::{DynamicalSystem, Steppable};
use js_sys::Float64Array;
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsLimitCycleRequest {
    #[serde(rename = "meshPoints")]
    mesh_points: usize,
    degree: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsLimitCycleMeta {
    method: String,
    #[serde(rename = "meshPoints")]
    mesh_points: Option<usize>,
    degree: Option<usize>,
    #[serde(rename = "phaseAnchor")]
    phase_anchor: Vec<f64>,
    #[serde(rename = "phaseDirection")]
    phase_direction: Vec<f64>,
}

#[derive(Serialize)]
struct LimitCycleBranchResponse {
    branch: ContinuationBranch,
    meta: JsLimitCycleMeta,
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
        let stride = if qr_stride == 0 {
            1
        } else {
            qr_stride as usize
        };
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
            if qr_stride == 0 {
                1
            } else {
                qr_stride as usize
            },
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

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let updated_branch = core_extend_branch(
            &mut self.system,
            kind,
            branch,
            param_index,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Branch extension failed: {}", e)))?;

        to_value(&updated_branch)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn continue_limit_cycle_from_hopf(
        &mut self,
        hopf_state: Vec<f64>,
        hopf_param: f64,
        parameter_name: &str,
        method_val: JsValue,
        amplitude: f64,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Limit cycle continuation is only available for flow systems",
            ));
        }

        let req: JsLimitCycleRequest = from_value(method_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid method settings: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        let setup = limit_cycle_setup_from_hopf(
            &mut self.system,
            param_index,
            &hopf_state,
            hopf_param,
            req.mesh_points,
            req.degree,
            amplitude,
        )
        .map_err(|e| JsValue::from_str(&format!("Failed to build initial guess: {}", e)))?;

        let branch = continue_limit_cycle_collocation(
            &mut self.system,
            param_index,
            setup.collocation_config(),
            setup.guess.clone(),
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Limit cycle continuation failed: {}", e)))?;
        let response = LimitCycleBranchResponse {
            branch,
            meta: JsLimitCycleMeta {
                method: "collocation".into(),
                mesh_points: Some(setup.mesh_points),
                degree: Some(setup.collocation_degree),
                phase_anchor: setup.phase_anchor.clone(),
                phase_direction: setup.phase_direction.clone(),
            },
        };

        to_value(&response).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    pub fn extend_limit_cycle_branch(
        &mut self,
        branch_val: JsValue,
        parameter_name: &str,
        meta_val: JsValue,
        settings_val: JsValue,
        forward: bool,
    ) -> Result<JsValue, JsValue> {
        if !matches!(self.system_type, SystemType::Flow) {
            return Err(JsValue::from_str(
                "Limit cycle continuation is only available for flow systems",
            ));
        }

        let branch: ContinuationBranch = from_value(branch_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid branch data: {}", e)))?;
        let meta: JsLimitCycleMeta = from_value(meta_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid limit cycle metadata: {}", e)))?;
        let settings: ContinuationSettings = from_value(settings_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid continuation settings: {}", e)))?;

        let param_index =
            *self.system.param_map.get(parameter_name).ok_or_else(|| {
                JsValue::from_str(&format!("Unknown parameter: {}", parameter_name))
            })?;

        if meta.method.as_str() != "collocation" {
            return Err(JsValue::from_str(
                "Only collocation-based limit cycle branches are supported.",
            ));
        }
        let mesh_points = meta
            .mesh_points
            .ok_or_else(|| JsValue::from_str("Missing meshPoints for collocation branch"))?;
        let degree = meta
            .degree
            .ok_or_else(|| JsValue::from_str("Missing degree for collocation branch"))?;
        let config = CollocationConfig {
            mesh_points,
            degree,
            phase_anchor: meta.phase_anchor.clone(),
            phase_direction: meta.phase_direction.clone(),
        };
        let updated_branch = extend_limit_cycle_collocation(
            &mut self.system,
            param_index,
            config,
            branch,
            settings,
            forward,
        )
        .map_err(|e| JsValue::from_str(&format!("Branch extension failed: {}", e)))?;

        let response = LimitCycleBranchResponse {
            branch: updated_branch,
            meta,
        };

        to_value(&response).map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
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
}

#[derive(Serialize)]
struct CovariantVectorsPayload {
    dimension: usize,
    checkpoints: usize,
    times: Vec<f64>,
    vectors: Vec<f64>,
}
