use crate::autodiff::Dual;
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::continuation::util::{
    compute_eigenvalues, neimark_sacker_test_function, period_doubling_test_function,
};
use crate::continuation::{
    continue_with_problem, extend_branch_with_problem, BranchType, ContinuationBranch,
    ContinuationPoint, ContinuationSettings,
};
use crate::equation_engine::{parse, Bytecode, Compiler, EquationSystem, VM};
use crate::equilibrium::{ComplexNumber, NewtonSettings};
use crate::solvers::{Tsit5, RK4};
use crate::state_periodicity::StatePeriodicity;
use crate::traits::{DynamicalSystem, Steppable};
use anyhow::{bail, Context, Result};
use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone)]
pub struct CompiledParameterExpression {
    code: Bytecode,
    parameter_count: usize,
}

impl CompiledParameterExpression {
    pub fn compile(expression: &str, parameter_names: &[String]) -> Result<Self> {
        let parsed = parse(expression).map_err(anyhow::Error::msg)?;
        let compiler = Compiler::new(&[], parameter_names);
        let code = compiler.try_compile(&parsed).map_err(anyhow::Error::msg)?;
        Ok(Self {
            code,
            parameter_count: parameter_names.len(),
        })
    }

    pub fn evaluate(&self, parameters: &[f64]) -> Result<f64> {
        if parameters.len() != self.parameter_count {
            bail!(
                "Parameter expression expected {} values, got {}",
                self.parameter_count,
                parameters.len()
            );
        }
        let mut stack = Vec::with_capacity(32);
        let value = VM::execute(&self.code, &[], parameters, &mut stack);
        if !value.is_finite() {
            bail!("Parameter expression evaluated to a non-finite value");
        }
        Ok(value)
    }

    pub fn evaluate_dual_wrt_param(
        &self,
        parameters: &[f64],
        parameter_index: usize,
    ) -> Result<Dual> {
        if parameters.len() != self.parameter_count {
            bail!(
                "Parameter expression expected {} values, got {}",
                self.parameter_count,
                parameters.len()
            );
        }
        if parameter_index >= parameters.len() {
            bail!("Parameter expression derivative index is out of bounds");
        }
        let dual_parameters = parameters
            .iter()
            .enumerate()
            .map(|(index, value)| Dual::new(*value, (index == parameter_index) as u8 as f64))
            .collect::<Vec<_>>();
        let mut stack = Vec::with_capacity(32);
        let value = VM::execute(&self.code, &[], &dual_parameters, &mut stack);
        if !value.val.is_finite() || !value.eps.is_finite() {
            bail!("Parameter expression derivative evaluated to a non-finite value");
        }
        Ok(value)
    }
}

#[derive(Debug, Clone)]
pub enum PeriodicForcing {
    Flow {
        period_expression: String,
        compiled_period: CompiledParameterExpression,
    },
    Map {
        iteration_period: usize,
    },
}

impl PeriodicForcing {
    pub fn flow(expression: &str, parameter_names: &[String]) -> Result<Self> {
        Ok(Self::Flow {
            period_expression: expression.to_string(),
            compiled_period: CompiledParameterExpression::compile(expression, parameter_names)?,
        })
    }

    pub fn map(iteration_period: usize) -> Result<Self> {
        if iteration_period == 0 {
            bail!("Map forcing period must be a positive integer");
        }
        Ok(Self::Map { iteration_period })
    }

    pub fn period_expression(&self) -> Option<&str> {
        match self {
            Self::Flow {
                period_expression, ..
            } => Some(period_expression),
            Self::Map { .. } => None,
        }
    }

    pub fn iteration_period(&self) -> Option<usize> {
        match self {
            Self::Map { iteration_period } => Some(*iteration_period),
            Self::Flow { .. } => None,
        }
    }

    pub fn resolved_period(&self, parameters: &[f64]) -> Result<f64> {
        let period = match self {
            Self::Flow {
                compiled_period, ..
            } => compiled_period.evaluate(parameters)?,
            Self::Map { iteration_period } => *iteration_period as f64,
        };
        if !period.is_finite() || period <= 0.0 {
            bail!("Forcing period must evaluate to a finite positive value");
        }
        Ok(period)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowIntegrator {
    Rk4,
    Tsit5,
}

#[derive(Debug, Clone, Copy)]
pub struct StroboscopicSettings {
    pub phase: f64,
    pub response_multiple: usize,
    pub steps_per_forcing_period: usize,
}

impl Default for StroboscopicSettings {
    fn default() -> Self {
        Self {
            phase: 0.0,
            response_multiple: 1,
            steps_per_forcing_period: 200,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StroboscopicEvaluation {
    pub returned_state: Vec<f64>,
    pub cycle_points: Vec<Vec<f64>>,
    pub contexts: Vec<f64>,
    pub forcing_period: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedStrobeSeed {
    pub state: Vec<f64>,
    pub context: f64,
}

pub struct StroboscopicMap<'a> {
    system: &'a EquationSystem,
    forcing: PeriodicForcing,
    integrator: FlowIntegrator,
    settings: StroboscopicSettings,
    periodicity: StatePeriodicity,
}

struct ParameterSeededSystem<'a> {
    system: &'a EquationSystem,
    parameter_index: usize,
}

impl DynamicalSystem<Dual> for ParameterSeededSystem<'_> {
    fn dimension(&self) -> usize {
        self.system.equations.len()
    }

    fn apply(&self, t: Dual, x: &[Dual], out: &mut [Dual]) {
        self.system
            .apply_dual_wrt_param(t, x, self.parameter_index, out);
    }
}

impl<'a> StroboscopicMap<'a> {
    pub fn new(
        system: &'a EquationSystem,
        forcing: PeriodicForcing,
        integrator: FlowIntegrator,
        settings: StroboscopicSettings,
        periodicity: StatePeriodicity,
    ) -> Result<Self> {
        if system.equations.is_empty() {
            bail!("Stroboscopic map requires a non-empty system");
        }
        if !settings.phase.is_finite() {
            bail!("Stroboscopic phase must be finite");
        }
        if settings.response_multiple == 0 {
            bail!("Response multiple must be a positive integer");
        }
        match forcing {
            PeriodicForcing::Flow { .. } if settings.steps_per_forcing_period == 0 => {
                bail!("Flow steps per forcing period must be positive")
            }
            PeriodicForcing::Map { iteration_period }
                if settings.phase.fract() != 0.0
                    || settings.phase.abs() > MAX_SAFE_INTEGER
                    || iteration_period > MAX_SAFE_INTEGER as usize =>
            {
                bail!("Map stroboscopic phase and forcing period must be safe integers")
            }
            _ => {}
        }
        let map = Self {
            system,
            forcing,
            integrator,
            settings,
            periodicity,
        };
        map.resolved_period()?;
        Ok(map)
    }

    pub fn with_system<'b>(&self, system: &'b EquationSystem) -> Result<StroboscopicMap<'b>> {
        StroboscopicMap::new(
            system,
            self.forcing.clone(),
            self.integrator,
            self.settings,
            self.periodicity.clone(),
        )
    }

    pub fn forcing(&self) -> &PeriodicForcing {
        &self.forcing
    }

    pub fn settings(&self) -> StroboscopicSettings {
        self.settings
    }

    pub fn evaluate(&self, initial_state: &[f64]) -> Result<StroboscopicEvaluation> {
        self.validate_state(initial_state)?;
        match &self.forcing {
            PeriodicForcing::Flow { .. } => self.evaluate_flow(initial_state),
            PeriodicForcing::Map { iteration_period } => {
                self.evaluate_map(initial_state, *iteration_period)
            }
        }
    }

    /// Advance an orbit sample to its first matching stroboscopic section.
    ///
    /// The supplied context is the clock attached to `initial_state`. Flow
    /// seeds are integrated for the fractional remainder of a forcing period;
    /// map seeds are iterated with exact unit contexts until the requested
    /// residue is reached.
    pub fn advance_seed_to_strobe(
        &self,
        initial_context: f64,
        initial_state: &[f64],
    ) -> Result<AdvancedStrobeSeed> {
        self.validate_state(initial_state)?;
        if !initial_context.is_finite() {
            bail!("Orbit seed context must be finite");
        }
        match self.forcing {
            PeriodicForcing::Flow { .. } => {
                let period = self.resolved_period()?;
                let phase_context = self.settings.phase.rem_euclid(1.0) * period;
                let mut delta = (phase_context - initial_context).rem_euclid(period);
                let tolerance = 16.0 * f64::EPSILON * period.max(initial_context.abs()).max(1.0);
                if delta <= tolerance || (period - delta).abs() <= tolerance {
                    delta = 0.0;
                }
                let mut context = initial_context;
                let mut state = initial_state.to_vec();
                self.periodicity.wrap_state(&mut state);
                if delta > 0.0 {
                    let steps = ((delta / period) * self.settings.steps_per_forcing_period as f64)
                        .ceil()
                        .max(1.0) as usize;
                    let dt = delta / steps as f64;
                    match self.integrator {
                        FlowIntegrator::Rk4 => {
                            let mut solver = RK4::new(state.len());
                            for _ in 0..steps {
                                solver.step(self.system, &mut context, &mut state, dt);
                                self.periodicity.wrap_state(&mut state);
                                self.check_finite(&state)?;
                            }
                        }
                        FlowIntegrator::Tsit5 => {
                            let mut solver = Tsit5::new(state.len());
                            for _ in 0..steps {
                                solver.step(self.system, &mut context, &mut state, dt);
                                self.periodicity.wrap_state(&mut state);
                                self.check_finite(&state)?;
                            }
                        }
                    }
                    // Avoid accumulated clock roundoff at the handoff to Newton.
                    context = initial_context + delta;
                }
                Ok(AdvancedStrobeSeed { state, context })
            }
            PeriodicForcing::Map { iteration_period } => {
                if initial_context.fract() != 0.0 || initial_context.abs() > MAX_SAFE_INTEGER {
                    bail!("Map orbit seed context must be a safe integer");
                }
                let period = iteration_period as i64;
                let phase = (self.settings.phase as i64).rem_euclid(period);
                let source = initial_context as i64;
                let offset = (phase - source).rem_euclid(period);
                let target = source
                    .checked_add(offset)
                    .ok_or_else(|| anyhow::anyhow!("Map stroboscopic seed context overflow"))?;
                if (target as f64).abs() > MAX_SAFE_INTEGER {
                    bail!("Map stroboscopic seed context exceeds the safe integer range");
                }
                let mut state = initial_state.to_vec();
                self.periodicity.wrap_state(&mut state);
                let mut next = vec![0.0; state.len()];
                for context in source..target {
                    self.system.apply(context as f64, &state, &mut next);
                    self.periodicity.wrap_state(&mut next);
                    self.check_finite(&next)?;
                    std::mem::swap(&mut state, &mut next);
                }
                Ok(AdvancedStrobeSeed {
                    state,
                    context: target as f64,
                })
            }
        }
    }

    pub fn state_jacobian(&self, initial_state: &[f64]) -> Result<DMatrix<f64>> {
        self.validate_state(initial_state)?;
        let dim = initial_state.len();
        let mut jacobian = DMatrix::zeros(dim, dim);
        for column in 0..dim {
            let dual_state = initial_state
                .iter()
                .enumerate()
                .map(|(index, value)| Dual::new(*value, (index == column) as u8 as f64))
                .collect::<Vec<_>>();
            let returned = self.evaluate_dual(&dual_state, None)?;
            for row in 0..dim {
                jacobian[(row, column)] = returned[row].eps;
            }
        }
        Ok(jacobian)
    }

    pub fn parameter_jacobian(
        &self,
        initial_state: &[f64],
        parameter_index: usize,
    ) -> Result<Vec<f64>> {
        self.validate_state(initial_state)?;
        if parameter_index >= self.system.params.len() {
            bail!("Stroboscopic parameter index is out of bounds");
        }
        let dual_state = initial_state
            .iter()
            .map(|value| Dual::new(*value, 0.0))
            .collect::<Vec<_>>();
        Ok(self
            .evaluate_dual(&dual_state, Some(parameter_index))?
            .iter()
            .map(|value| value.eps)
            .collect())
    }

    fn validate_state(&self, state: &[f64]) -> Result<()> {
        if state.len() != self.system.equations.len() {
            bail!(
                "Stroboscopic state dimension mismatch: expected {}, got {}",
                self.system.equations.len(),
                state.len()
            );
        }
        if state.iter().any(|value| !value.is_finite()) {
            bail!("Stroboscopic state must be finite");
        }
        Ok(())
    }

    fn resolved_period(&self) -> Result<f64> {
        self.forcing.resolved_period(&self.system.params)
    }

    fn evaluate_flow(&self, initial_state: &[f64]) -> Result<StroboscopicEvaluation> {
        let period = self.resolved_period()?;
        let phase = self.settings.phase.rem_euclid(1.0);
        let steps = self
            .settings
            .response_multiple
            .checked_mul(self.settings.steps_per_forcing_period)
            .ok_or_else(|| anyhow::anyhow!("Stroboscopic flow step count overflow"))?;
        let dt = period / self.settings.steps_per_forcing_period as f64;
        let mut time = phase * period;
        let mut state = initial_state.to_vec();
        self.periodicity.wrap_state(&mut state);
        let mut points = vec![state.clone()];
        let mut contexts = vec![time];
        match self.integrator {
            FlowIntegrator::Rk4 => {
                let mut solver = RK4::new(state.len());
                for _ in 0..steps {
                    solver.step(self.system, &mut time, &mut state, dt);
                    self.periodicity.wrap_state(&mut state);
                    self.check_finite(&state)?;
                    points.push(state.clone());
                    contexts.push(time);
                }
            }
            FlowIntegrator::Tsit5 => {
                let mut solver = Tsit5::new(state.len());
                for _ in 0..steps {
                    solver.step(self.system, &mut time, &mut state, dt);
                    self.periodicity.wrap_state(&mut state);
                    self.check_finite(&state)?;
                    points.push(state.clone());
                    contexts.push(time);
                }
            }
        }
        Ok(StroboscopicEvaluation {
            returned_state: state,
            cycle_points: points,
            contexts,
            forcing_period: period,
        })
    }

    fn evaluate_map(
        &self,
        initial_state: &[f64],
        iteration_period: usize,
    ) -> Result<StroboscopicEvaluation> {
        let phase = (self.settings.phase as i64).rem_euclid(iteration_period as i64) as f64;
        let iterations = iteration_period
            .checked_mul(self.settings.response_multiple)
            .ok_or_else(|| anyhow::anyhow!("Stroboscopic iteration count overflow"))?;
        let mut context = phase;
        let mut state = initial_state.to_vec();
        self.periodicity.wrap_state(&mut state);
        let mut next = vec![0.0; state.len()];
        let mut points = vec![state.clone()];
        let mut contexts = vec![context];
        for _ in 0..iterations {
            self.system.apply(context, &state, &mut next);
            self.periodicity.wrap_state(&mut next);
            self.check_finite(&next)?;
            std::mem::swap(&mut state, &mut next);
            context += 1.0;
            points.push(state.clone());
            contexts.push(context);
        }
        Ok(StroboscopicEvaluation {
            returned_state: state,
            cycle_points: points,
            contexts,
            forcing_period: iteration_period as f64,
        })
    }

    fn evaluate_dual(
        &self,
        initial_state: &[Dual],
        parameter_index: Option<usize>,
    ) -> Result<Vec<Dual>> {
        match &self.forcing {
            PeriodicForcing::Flow {
                compiled_period, ..
            } => {
                let period = if let Some(index) = parameter_index {
                    compiled_period.evaluate_dual_wrt_param(&self.system.params, index)?
                } else {
                    Dual::new(compiled_period.evaluate(&self.system.params)?, 0.0)
                };
                if !period.val.is_finite() || period.val <= 0.0 {
                    bail!("Forcing period must evaluate to a finite positive value");
                }
                let phase = self.settings.phase.rem_euclid(1.0);
                let mut time = period * Dual::new(phase, 0.0);
                let dt = period / Dual::new(self.settings.steps_per_forcing_period as f64, 0.0);
                let steps = self
                    .settings
                    .response_multiple
                    .checked_mul(self.settings.steps_per_forcing_period)
                    .ok_or_else(|| anyhow::anyhow!("Stroboscopic flow step count overflow"))?;
                let mut state = initial_state.to_vec();
                self.wrap_dual_state(&mut state);
                match (self.integrator, parameter_index) {
                    (FlowIntegrator::Rk4, Some(index)) => {
                        let seeded = ParameterSeededSystem {
                            system: self.system,
                            parameter_index: index,
                        };
                        let mut solver = RK4::new(state.len());
                        for _ in 0..steps {
                            solver.step(&seeded, &mut time, &mut state, dt);
                            self.wrap_dual_state(&mut state);
                        }
                    }
                    (FlowIntegrator::Tsit5, Some(index)) => {
                        let seeded = ParameterSeededSystem {
                            system: self.system,
                            parameter_index: index,
                        };
                        let mut solver = Tsit5::new(state.len());
                        for _ in 0..steps {
                            solver.step(&seeded, &mut time, &mut state, dt);
                            self.wrap_dual_state(&mut state);
                        }
                    }
                    (FlowIntegrator::Rk4, None) => {
                        let mut solver = RK4::new(state.len());
                        for _ in 0..steps {
                            solver.step(self.system, &mut time, &mut state, dt);
                            self.wrap_dual_state(&mut state);
                        }
                    }
                    (FlowIntegrator::Tsit5, None) => {
                        let mut solver = Tsit5::new(state.len());
                        for _ in 0..steps {
                            solver.step(self.system, &mut time, &mut state, dt);
                            self.wrap_dual_state(&mut state);
                        }
                    }
                }
                self.check_finite_dual(&state)?;
                Ok(state)
            }
            PeriodicForcing::Map { iteration_period } => {
                let phase = (self.settings.phase as i64).rem_euclid(*iteration_period as i64);
                let iterations = iteration_period
                    .checked_mul(self.settings.response_multiple)
                    .ok_or_else(|| anyhow::anyhow!("Stroboscopic iteration count overflow"))?;
                let mut state = initial_state.to_vec();
                self.wrap_dual_state(&mut state);
                let mut next = vec![Dual::new(0.0, 0.0); state.len()];
                for offset in 0..iterations {
                    let context = Dual::new((phase + offset as i64) as f64, 0.0);
                    if let Some(index) = parameter_index {
                        self.system
                            .apply_dual_wrt_param(context, &state, index, &mut next);
                    } else {
                        self.system.apply(context, &state, &mut next);
                    }
                    self.wrap_dual_state(&mut next);
                    std::mem::swap(&mut state, &mut next);
                }
                self.check_finite_dual(&state)?;
                Ok(state)
            }
        }
    }

    fn wrap_dual_state(&self, state: &mut [Dual]) {
        for (index, value) in state.iter_mut().enumerate() {
            if let Some(period) = self.periodicity.period(index) {
                value.val = StatePeriodicity::wrap_value(value.val, period);
            }
        }
    }

    fn check_finite(&self, state: &[f64]) -> Result<()> {
        if state.iter().any(|value| !value.is_finite()) {
            bail!("Stroboscopic evaluation produced a non-finite state");
        }
        Ok(())
    }

    fn check_finite_dual(&self, state: &[Dual]) -> Result<()> {
        if state
            .iter()
            .any(|value| !value.val.is_finite() || !value.eps.is_finite())
        {
            bail!("Stroboscopic derivative produced a non-finite state");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForcedResponseResult {
    pub state: Vec<f64>,
    pub residual_norm: f64,
    pub iterations: usize,
    pub monodromy: Vec<f64>,
    pub multipliers: Vec<ComplexNumber>,
    pub cycle_points: Vec<Vec<f64>>,
    pub contexts: Vec<f64>,
    pub forcing_period: f64,
    pub response_multiple: usize,
    pub minimal_response_multiple: usize,
}

pub fn solve_forced_response(
    system: &EquationSystem,
    forcing: PeriodicForcing,
    integrator: FlowIntegrator,
    stroboscopic: StroboscopicSettings,
    initial_guess: &[f64],
    newton: NewtonSettings,
    periodicity: &StatePeriodicity,
) -> Result<ForcedResponseResult> {
    validate_newton_settings(newton)?;
    let map = StroboscopicMap::new(
        system,
        forcing,
        integrator,
        stroboscopic,
        periodicity.clone(),
    )?;
    map.validate_state(initial_guess)?;

    let dim = initial_guess.len();
    let mut state = initial_guess.to_vec();
    periodicity.wrap_state(&mut state);
    let mut residual = response_residual(&map, &state, periodicity)?;
    let mut residual_norm = l2_norm(&residual);
    let mut iterations = 0usize;

    while residual_norm > newton.tolerance {
        if iterations >= newton.max_steps {
            bail!(
                "Forced-response Newton solver failed to converge in {} steps (||P(x)-x|| = {})",
                newton.max_steps,
                residual_norm
            );
        }
        let mut jacobian = map.state_jacobian(&state)?;
        for index in 0..dim {
            jacobian[(index, index)] -= 1.0;
        }
        let delta = jacobian
            .lu()
            .solve(&DVector::from_column_slice(&residual))
            .context("Failed to solve the forced-response Newton system")?;
        for index in 0..dim {
            state[index] -= newton.damping * delta[index];
        }
        periodicity.wrap_state(&mut state);
        residual = response_residual(&map, &state, periodicity)?;
        residual_norm = l2_norm(&residual);
        iterations += 1;
    }

    let evaluation = map.evaluate(&state)?;
    let monodromy = map.state_jacobian(&state)?;
    let multipliers = compute_eigenvalues(&monodromy)?
        .into_iter()
        .map(ComplexNumber::from)
        .collect();
    let minimal_response_multiple = minimal_response_multiple(
        system,
        map.forcing.clone(),
        integrator,
        map.settings,
        &state,
        periodicity,
        newton.tolerance,
    )?;

    Ok(ForcedResponseResult {
        state,
        residual_norm,
        iterations,
        monodromy: monodromy.iter().copied().collect(),
        multipliers,
        cycle_points: evaluation.cycle_points,
        contexts: evaluation.contexts,
        forcing_period: evaluation.forcing_period,
        response_multiple: stroboscopic.response_multiple,
        minimal_response_multiple,
    })
}

fn validate_newton_settings(settings: NewtonSettings) -> Result<()> {
    if settings.max_steps == 0 {
        bail!("Forced-response Newton max_steps must be positive");
    }
    if !settings.damping.is_finite() || settings.damping <= 0.0 {
        bail!("Forced-response Newton damping must be finite and positive");
    }
    if !settings.tolerance.is_finite() || settings.tolerance <= 0.0 {
        bail!("Forced-response Newton tolerance must be finite and positive");
    }
    Ok(())
}

fn response_residual(
    map: &StroboscopicMap<'_>,
    state: &[f64],
    periodicity: &StatePeriodicity,
) -> Result<Vec<f64>> {
    let returned = map.evaluate(state)?.returned_state;
    Ok(returned
        .iter()
        .zip(state)
        .enumerate()
        .map(|(index, (returned, initial))| periodicity.wrapped_delta(index, returned - initial))
        .collect())
}

fn minimal_response_multiple(
    system: &EquationSystem,
    forcing: PeriodicForcing,
    integrator: FlowIntegrator,
    settings: StroboscopicSettings,
    state: &[f64],
    periodicity: &StatePeriodicity,
    tolerance: f64,
) -> Result<usize> {
    for divisor in 1..=settings.response_multiple {
        if settings.response_multiple % divisor != 0 {
            continue;
        }
        let candidate = StroboscopicMap::new(
            system,
            forcing.clone(),
            integrator,
            StroboscopicSettings {
                response_multiple: divisor,
                ..settings
            },
            periodicity.clone(),
        )?;
        if l2_norm(&response_residual(&candidate, state, periodicity)?)
            <= (10.0 * tolerance).max(1e-8)
        {
            return Ok(divisor);
        }
    }
    Ok(settings.response_multiple)
}

fn l2_norm(values: &[f64]) -> f64 {
    values.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[derive(Debug, Clone, Copy)]
pub struct ForcedResponseContinuationSettings {
    pub stroboscopic: StroboscopicSettings,
    pub continuation: ContinuationSettings,
}

pub struct ForcedResponseContinuationProblem<'a> {
    system: &'a mut EquationSystem,
    forcing: PeriodicForcing,
    parameter_index: usize,
    integrator: FlowIntegrator,
    stroboscopic: StroboscopicSettings,
    periodicity: StatePeriodicity,
}

impl<'a> ForcedResponseContinuationProblem<'a> {
    pub fn new(
        system: &'a mut EquationSystem,
        forcing: PeriodicForcing,
        parameter_index: usize,
        integrator: FlowIntegrator,
        stroboscopic: StroboscopicSettings,
        periodicity: StatePeriodicity,
    ) -> Result<Self> {
        if parameter_index >= system.params.len() {
            bail!("Forced-response continuation parameter index is out of bounds");
        }
        StroboscopicMap::new(
            system,
            forcing.clone(),
            integrator,
            stroboscopic,
            periodicity.clone(),
        )?;
        Ok(Self {
            system,
            forcing,
            parameter_index,
            integrator,
            stroboscopic,
            periodicity,
        })
    }

    fn with_parameter<T>(
        &mut self,
        parameter: f64,
        operation: impl FnOnce(&StroboscopicMap<'_>) -> Result<T>,
    ) -> Result<T> {
        let previous = self.system.params[self.parameter_index];
        self.system.params[self.parameter_index] = parameter;
        let map = StroboscopicMap::new(
            self.system,
            self.forcing.clone(),
            self.integrator,
            self.stroboscopic,
            self.periodicity.clone(),
        );
        let result = match map {
            Ok(map) => operation(&map),
            Err(error) => Err(error),
        };
        self.system.params[self.parameter_index] = previous;
        result
    }

    pub fn branch_type(&self) -> BranchType {
        BranchType::ForcedPeriodicResponse {
            symbol: match self.forcing {
                PeriodicForcing::Flow { .. } => "t".to_string(),
                PeriodicForcing::Map { .. } => "n".to_string(),
            },
            period_expression: self.forcing.period_expression().map(ToString::to_string),
            iteration_period: self.forcing.iteration_period(),
            phase: self.stroboscopic.phase,
            response_multiple: self.stroboscopic.response_multiple,
            steps_per_forcing_period: self.stroboscopic.steps_per_forcing_period,
            integrator: match self.integrator {
                FlowIntegrator::Rk4 => "rk4",
                FlowIntegrator::Tsit5 => "tsit5",
            }
            .to_string(),
        }
    }
}

impl ContinuationProblem for ForcedResponseContinuationProblem<'_> {
    fn dimension(&self) -> usize {
        self.system.equations.len()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let dim = self.dimension();
        if aug_state.len() != dim + 1 || out.len() != dim {
            bail!("Forced-response continuation residual dimension mismatch");
        }
        let state = aug_state.rows(1, dim).iter().copied().collect::<Vec<_>>();
        let periodicity = self.periodicity.clone();
        let residual = self.with_parameter(aug_state[0], |map| {
            response_residual(map, &state, &periodicity)
        })?;
        out.copy_from_slice(&residual);
        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dim = self.dimension();
        if aug_state.len() != dim + 1 {
            bail!("Forced-response continuation Jacobian dimension mismatch");
        }
        let state = aug_state.rows(1, dim).iter().copied().collect::<Vec<_>>();
        let parameter_index = self.parameter_index;
        self.with_parameter(aug_state[0], |map| {
            let parameter = map.parameter_jacobian(&state, parameter_index)?;
            let state_jacobian = map.state_jacobian(&state)?;
            let mut extended = DMatrix::zeros(dim, dim + 1);
            for row in 0..dim {
                extended[(row, 0)] = parameter[row];
                for column in 0..dim {
                    extended[(row, column + 1)] =
                        state_jacobian[(row, column)] - f64::from(row == column);
                }
            }
            Ok(extended)
        })
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let dim = self.dimension();
        let state = aug_state.rows(1, dim).iter().copied().collect::<Vec<_>>();
        self.with_parameter(aug_state[0], |map| {
            let monodromy = map.state_jacobian(&state)?;
            let multipliers = compute_eigenvalues(&monodromy)?;
            let residual_jacobian = &monodromy - DMatrix::identity(dim, dim);
            let cycle_fold = residual_jacobian.determinant();
            let evaluation = map.evaluate(&state)?;
            Ok(PointDiagnostics {
                test_values: TestFunctionValues::limit_cycle(
                    cycle_fold,
                    period_doubling_test_function(&multipliers),
                    neimark_sacker_test_function(&multipliers),
                ),
                eigenvalues: multipliers,
                cycle_points: Some(evaluation.cycle_points),
            })
        })
    }
}

pub fn continue_forced_response(
    system: &mut EquationSystem,
    forcing: PeriodicForcing,
    parameter_index: usize,
    initial_state: &[f64],
    settings: ForcedResponseContinuationSettings,
    integrator: FlowIntegrator,
    forward: bool,
    periodicity: &StatePeriodicity,
) -> Result<ContinuationBranch> {
    let parameter_value = *system.params.get(parameter_index).ok_or_else(|| {
        anyhow::anyhow!("Forced-response continuation parameter is out of bounds")
    })?;
    let mut problem = ForcedResponseContinuationProblem::new(
        system,
        forcing,
        parameter_index,
        integrator,
        settings.stroboscopic,
        periodicity.clone(),
    )?;
    if initial_state.len() != problem.dimension() {
        bail!("Forced-response continuation initial state dimension mismatch");
    }
    let branch_type = problem.branch_type();
    let point = ContinuationPoint {
        state: initial_state.to_vec(),
        param_value: parameter_value,
        stability: crate::continuation::BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
        homoclinic_events: None,
        heteroclinic_events: None,
    };
    let mut branch = continue_with_problem(&mut problem, point, settings.continuation, forward)?;
    branch.branch_type = branch_type;
    Ok(branch)
}

pub fn extend_forced_response(
    system: &mut EquationSystem,
    forcing: PeriodicForcing,
    parameter_index: usize,
    branch: ContinuationBranch,
    settings: ForcedResponseContinuationSettings,
    integrator: FlowIntegrator,
    forward: bool,
    periodicity: &StatePeriodicity,
) -> Result<ContinuationBranch> {
    let mut problem = ForcedResponseContinuationProblem::new(
        system,
        forcing,
        parameter_index,
        integrator,
        settings.stroboscopic,
        periodicity.clone(),
    )?;
    let branch_type = problem.branch_type();
    let mut extended =
        extend_branch_with_problem(&mut problem, branch, settings.continuation, forward)?;
    extended.branch_type = branch_type;
    Ok(extended)
}

#[cfg(test)]
mod tests {
    use super::{
        continue_forced_response, solve_forced_response, CompiledParameterExpression,
        FlowIntegrator, ForcedResponseContinuationProblem, ForcedResponseContinuationSettings,
        PeriodicForcing, StroboscopicMap, StroboscopicSettings,
    };
    use crate::continuation::problem::ContinuationProblem;
    use crate::continuation::ContinuationSettings;
    use crate::equation_engine::{parse, Compiler, EquationSystem, ExpressionContext};
    use crate::equilibrium::NewtonSettings;
    use crate::state_periodicity::StatePeriodicity;
    use nalgebra::DVector;

    fn compile_system(
        equations: &[&str],
        vars: &[&str],
        params: &[(&str, f64)],
        context: ExpressionContext,
    ) -> EquationSystem {
        let var_names = vars
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let param_names = params
            .iter()
            .map(|(name, _)| name.to_string())
            .collect::<Vec<_>>();
        let compiler = Compiler::new_with_context(&var_names, &param_names, context);
        let codes = equations
            .iter()
            .map(|equation| compiler.try_compile(&parse(equation).unwrap()).unwrap())
            .collect();
        let mut system =
            EquationSystem::new(codes, params.iter().map(|(_, value)| *value).collect());
        system.set_maps(compiler.param_map, compiler.var_map);
        system
    }

    #[test]
    fn parameter_period_expression_supports_constants_parameters_and_dual_derivatives() {
        let expression =
            CompiledParameterExpression::compile("tau / omega", &["omega".to_string()]).unwrap();
        let value = expression.evaluate(&[2.0]).unwrap();
        let dual = expression.evaluate_dual_wrt_param(&[2.0], 0).unwrap();

        assert!((value - std::f64::consts::PI).abs() < 1e-12);
        assert!((dual.eps + std::f64::consts::PI / 2.0).abs() < 1e-12);
        assert!(CompiledParameterExpression::compile("x + 1", &["omega".to_string()]).is_err());
        assert!(CompiledParameterExpression::compile("t + 1", &["omega".to_string()]).is_err());
        let shadowed = CompiledParameterExpression::compile("tau", &["tau".to_string()]).unwrap();
        assert_eq!(shadowed.evaluate(&[7.0]).unwrap(), 7.0);
        let nonfinite =
            CompiledParameterExpression::compile("1 / omega", &["omega".to_string()]).unwrap();
        assert!(nonfinite.evaluate(&[0.0]).is_err());
    }

    #[test]
    fn time_forced_flow_uses_parameter_dependent_period_and_nonzero_phase() {
        let system = compile_system(
            &["-a*x + b*cos(omega*t)"],
            &["x"],
            &[("a", 1.5), ("b", 0.8), ("omega", 2.0)],
            ExpressionContext::FlowTime,
        );
        let forcing = PeriodicForcing::flow(
            "tau / omega",
            &["a".to_string(), "b".to_string(), "omega".to_string()],
        )
        .unwrap();
        let settings = StroboscopicSettings {
            phase: 0.25,
            response_multiple: 1,
            steps_per_forcing_period: 800,
        };
        let map = StroboscopicMap::new(
            &system,
            forcing,
            FlowIntegrator::Tsit5,
            settings,
            StatePeriodicity::none(),
        )
        .unwrap();

        let result = map.evaluate(&[0.2]).unwrap();
        assert!((result.forcing_period - std::f64::consts::PI).abs() < 1e-12);
        assert!((result.contexts[0] - std::f64::consts::PI / 4.0).abs() < 1e-12);
        assert!((result.contexts.last().unwrap() - 5.0 * std::f64::consts::PI / 4.0).abs() < 1e-10);

        let monodromy = map.state_jacobian(&[0.2]).unwrap();
        let expected = (-1.5 * std::f64::consts::PI).exp();
        assert!((monodromy[(0, 0)] - expected).abs() < 2e-8);

        let exact = map.parameter_jacobian(&[0.2], 2).unwrap();
        let mut plus = system.clone();
        let mut minus = system.clone();
        let h = 1e-5;
        plus.params[2] += h;
        minus.params[2] -= h;
        let plus_map = map.with_system(&plus).unwrap();
        let minus_map = map.with_system(&minus).unwrap();
        let finite_difference = (plus_map.evaluate(&[0.2]).unwrap().returned_state[0]
            - minus_map.evaluate(&[0.2]).unwrap().returned_state[0])
            / (2.0 * h);
        assert!((exact[0] - finite_difference).abs() < 2e-6);
    }

    #[test]
    fn iteration_forced_map_advances_exact_integer_contexts() {
        let system = compile_system(
            &["a*x + b*cos(pi*n)"],
            &["x"],
            &[("a", 0.5), ("b", 1.0)],
            ExpressionContext::MapIteration,
        );
        let map = StroboscopicMap::new(
            &system,
            PeriodicForcing::map(2).unwrap(),
            FlowIntegrator::Tsit5,
            StroboscopicSettings {
                phase: 1.0,
                response_multiple: 2,
                steps_per_forcing_period: 200,
            },
            StatePeriodicity::none(),
        )
        .unwrap();
        let result = map.evaluate(&[0.0]).unwrap();

        assert_eq!(result.contexts, vec![1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(result.cycle_points.len(), 5);
        assert!((result.returned_state[0] - 0.625).abs() < 1e-12);
    }

    #[test]
    fn orbit_seeds_advance_to_the_next_requested_strobe_section() {
        let flow = compile_system(&["1 + 0*t"], &["x"], &[], ExpressionContext::FlowTime);
        let flow_map = StroboscopicMap::new(
            &flow,
            PeriodicForcing::flow("2", &[]).unwrap(),
            FlowIntegrator::Rk4,
            StroboscopicSettings {
                phase: 0.25,
                response_multiple: 1,
                steps_per_forcing_period: 20,
            },
            StatePeriodicity::none(),
        )
        .unwrap();
        let advanced_flow = flow_map.advance_seed_to_strobe(0.2, &[3.0]).unwrap();
        assert!((advanced_flow.context - 0.5).abs() < 1e-12);
        assert!((advanced_flow.state[0] - 3.3).abs() < 1e-12);

        let map = compile_system(&["x + n"], &["x"], &[], ExpressionContext::MapIteration);
        let map_operator = StroboscopicMap::new(
            &map,
            PeriodicForcing::map(3).unwrap(),
            FlowIntegrator::Tsit5,
            StroboscopicSettings {
                phase: 1.0,
                response_multiple: 1,
                steps_per_forcing_period: 1,
            },
            StatePeriodicity::none(),
        )
        .unwrap();
        let advanced_map = map_operator.advance_seed_to_strobe(2.0, &[0.0]).unwrap();
        assert_eq!(advanced_map.context, 4.0);
        assert_eq!(advanced_map.state, vec![5.0]);
        assert!(map_operator.advance_seed_to_strobe(2.5, &[0.0]).is_err());
    }

    #[test]
    fn newton_solves_a_periodic_flow_response_and_detects_lower_period() {
        let system = compile_system(
            &["-a*x + b*cos(omega*t)"],
            &["x"],
            &[("a", 1.5), ("b", 0.8), ("omega", 2.0)],
            ExpressionContext::FlowTime,
        );
        let forcing = PeriodicForcing::flow(
            "tau / omega",
            &["a".to_string(), "b".to_string(), "omega".to_string()],
        )
        .unwrap();
        let result = solve_forced_response(
            &system,
            forcing,
            FlowIntegrator::Tsit5,
            StroboscopicSettings {
                phase: 0.0,
                response_multiple: 2,
                steps_per_forcing_period: 800,
            },
            &[0.0],
            NewtonSettings::default(),
            &StatePeriodicity::none(),
        )
        .unwrap();

        let expected = 0.8 * 1.5 / (1.5_f64.powi(2) + 2.0_f64.powi(2));
        assert!((result.state[0] - expected).abs() < 2e-8);
        assert!(result.residual_norm < 1e-9);
        assert_eq!(result.minimal_response_multiple, 1);
        assert_eq!(result.cycle_points.len(), 1601);
    }

    #[test]
    fn newton_solves_iteration_forced_map_and_wrapping_preserves_derivatives() {
        let system = compile_system(
            &["a*x + b*cos(pi*n)"],
            &["x"],
            &[("a", 0.5), ("b", 1.0)],
            ExpressionContext::MapIteration,
        );
        let periodicity = StatePeriodicity::from_periods(&[10.0], 1);
        let map = StroboscopicMap::new(
            &system,
            PeriodicForcing::map(2).unwrap(),
            FlowIntegrator::Tsit5,
            StroboscopicSettings {
                phase: 0.0,
                response_multiple: 1,
                steps_per_forcing_period: 1,
            },
            periodicity.clone(),
        )
        .unwrap();
        let wrapped_jacobian = map.state_jacobian(&[9.8]).unwrap();
        assert!((wrapped_jacobian[(0, 0)] - 0.25).abs() < 1e-12);

        let result = solve_forced_response(
            &system,
            PeriodicForcing::map(2).unwrap(),
            FlowIntegrator::Tsit5,
            StroboscopicSettings {
                phase: 0.0,
                response_multiple: 1,
                steps_per_forcing_period: 1,
            },
            &[0.0],
            NewtonSettings::default(),
            &StatePeriodicity::none(),
        )
        .unwrap();
        assert!((result.state[0] + 2.0 / 3.0).abs() < 1e-12);
        assert!((result.multipliers[0].re - 0.25).abs() < 1e-12);
        assert_eq!(result.contexts, vec![0.0, 1.0, 2.0]);
    }

    #[test]
    fn palc_continues_forcing_amplitude_with_multiplier_diagnostics() {
        let mut system = compile_system(
            &["-a*x + b*cos(omega*t)"],
            &["x"],
            &[("a", 1.5), ("b", 0.8), ("omega", 2.0)],
            ExpressionContext::FlowTime,
        );
        let forcing = PeriodicForcing::flow(
            "tau / omega",
            &["a".to_string(), "b".to_string(), "omega".to_string()],
        )
        .unwrap();
        let expected = 0.8 * 1.5 / (1.5_f64.powi(2) + 2.0_f64.powi(2));
        let branch = continue_forced_response(
            &mut system,
            forcing,
            1,
            &[expected],
            ForcedResponseContinuationSettings {
                stroboscopic: StroboscopicSettings {
                    phase: 0.0,
                    response_multiple: 1,
                    steps_per_forcing_period: 500,
                },
                continuation: ContinuationSettings {
                    step_size: 0.03,
                    min_step_size: 1e-6,
                    max_step_size: 0.05,
                    max_steps: 4,
                    corrector_steps: 12,
                    corrector_tolerance: 1e-10,
                    step_tolerance: 1e-10,
                },
            },
            FlowIntegrator::Tsit5,
            true,
            &StatePeriodicity::none(),
        )
        .unwrap();

        assert!(branch.points.len() >= 3);
        for point in &branch.points {
            let analytic = point.param_value * 1.5 / (1.5_f64.powi(2) + 2.0_f64.powi(2));
            assert!((point.state[0] - analytic).abs() < 2e-7);
            assert_eq!(point.eigenvalues.len(), 1);
            assert!(point
                .cycle_points
                .as_ref()
                .is_some_and(|points| points.len() == 501));
        }
    }

    #[test]
    fn forced_response_diagnostics_identify_fold_flip_and_neimark_sacker_multipliers() {
        let settings = StroboscopicSettings {
            phase: 0.0,
            response_multiple: 1,
            steps_per_forcing_period: 1,
        };

        let mut fold_system = compile_system(
            &["p*x + 0*n"],
            &["x"],
            &[("p", 0.0)],
            ExpressionContext::MapIteration,
        );
        let mut fold_problem = ForcedResponseContinuationProblem::new(
            &mut fold_system,
            PeriodicForcing::map(1).unwrap(),
            0,
            FlowIntegrator::Tsit5,
            settings,
            StatePeriodicity::none(),
        )
        .unwrap();
        let fold = fold_problem
            .diagnostics(&DVector::from_vec(vec![1.0, 0.0]))
            .unwrap();
        assert!(fold.test_values.cycle_fold.abs() < 1e-12);

        let flip = fold_problem
            .diagnostics(&DVector::from_vec(vec![-1.0, 0.0]))
            .unwrap();
        assert!(flip.test_values.period_doubling.abs() < 1e-12);

        let mut ns_system = compile_system(
            &[
                "rho*(cos(theta)*x - sin(theta)*y) + 0*n",
                "rho*(sin(theta)*x + cos(theta)*y) + 0*n",
            ],
            &["x", "y"],
            &[("rho", 0.8), ("theta", 0.7)],
            ExpressionContext::MapIteration,
        );
        let mut ns_problem = ForcedResponseContinuationProblem::new(
            &mut ns_system,
            PeriodicForcing::map(1).unwrap(),
            0,
            FlowIntegrator::Tsit5,
            settings,
            StatePeriodicity::none(),
        )
        .unwrap();
        let ns = ns_problem
            .diagnostics(&DVector::from_vec(vec![1.0, 0.0, 0.0]))
            .unwrap();
        assert!(ns.test_values.neimark_sacker.abs() < 1e-12);
        assert_eq!(ns.eigenvalues.len(), 2);
        assert!(ns.eigenvalues.iter().all(|value| value.im.abs() > 0.1));
    }
}
