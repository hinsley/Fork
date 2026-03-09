use crate::{
    equation_engine::{Bytecode, VM},
    isocline::compile_scalar_expression,
    solvers::{DiscreteMap, RK4, Tsit5},
    traits::{DynamicalSystem, Steppable},
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

const CROSS_EPS: f64 = 1e-12;
const REFINE_ITERS: usize = 32;
const TIME_EPS: f64 = 1e-12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventSeriesMode {
    EveryIterate,
    CrossUp,
    CrossDown,
    CrossEither,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderedSample {
    pub time: Option<f64>,
    pub state: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSeriesHit {
    pub order: usize,
    pub sample_index: usize,
    pub time: Option<f64>,
    pub state: Vec<f64>,
    pub observable_values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSeriesResult {
    pub hits: Vec<EventSeriesHit>,
}

pub struct CompiledEventSeriesExpressions {
    event: Bytecode,
    observables: Vec<Bytecode>,
}

#[derive(Debug, Clone, Copy)]
pub enum EventSeriesStepper {
    Rk4,
    Tsit5,
    Discrete,
}

enum InternalStepper {
    Rk4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

impl EventSeriesStepper {
    fn build(self, dim: usize) -> InternalStepper {
        match self {
            Self::Rk4 => InternalStepper::Rk4(RK4::new(dim)),
            Self::Tsit5 => InternalStepper::Tsit5(Tsit5::new(dim)),
            Self::Discrete => InternalStepper::Discrete(DiscreteMap::new(dim)),
        }
    }
}

impl InternalStepper {
    fn step(
        &mut self,
        system: &impl DynamicalSystem<f64>,
        t: &mut f64,
        state: &mut [f64],
        dt: f64,
    ) {
        match self {
            Self::Rk4(stepper) => stepper.step(system, t, state, dt),
            Self::Tsit5(stepper) => stepper.step(system, t, state, dt),
            Self::Discrete(stepper) => stepper.step(system, t, state, dt),
        }
    }
}

pub fn compile_event_series_expressions(
    event_expression: &str,
    observable_expressions: &[String],
    var_names: &[String],
    param_names: &[String],
) -> Result<CompiledEventSeriesExpressions> {
    let event = compile_scalar_expression(event_expression, var_names, param_names)?;
    let mut observables = Vec::with_capacity(observable_expressions.len());
    for expression in observable_expressions {
        observables.push(compile_scalar_expression(expression, var_names, param_names)?);
    }
    Ok(CompiledEventSeriesExpressions { event, observables })
}

pub fn extract_event_series_from_samples(
    params: &[f64],
    samples: &[OrderedSample],
    compiled: &CompiledEventSeriesExpressions,
    mode: EventSeriesMode,
    level: f64,
) -> Result<EventSeriesResult> {
    if !level.is_finite() {
        bail!("Event level must be finite.");
    }
    if samples.is_empty() {
        return Ok(EventSeriesResult { hits: Vec::new() });
    }

    let dim = samples[0].state.len();
    if dim == 0 {
        bail!("Samples must have positive dimension.");
    }
    for (index, sample) in samples.iter().enumerate() {
        if sample.state.len() != dim {
            bail!(
                "Sample {index} has dimension {} but expected {dim}.",
                sample.state.len()
            );
        }
    }

    let mut hits = Vec::new();
    let mut event_stack = Vec::with_capacity(64);
    let mut observable_stack = Vec::with_capacity(64);

    if mode == EventSeriesMode::EveryIterate {
        for (sample_index, sample) in samples.iter().enumerate() {
            hits.push(EventSeriesHit {
                order: hits.len(),
                sample_index,
                time: sample.time,
                state: sample.state.clone(),
                observable_values: evaluate_observables(
                    &compiled.observables,
                    &sample.state,
                    params,
                    &mut observable_stack,
                ),
            });
        }
        return Ok(EventSeriesResult { hits });
    }

    let mut prev_value =
        evaluate_scalar(&compiled.event, &samples[0].state, params, &mut event_stack) - level;
    for sample_index in 1..samples.len() {
        let next = &samples[sample_index];
        let next_value = evaluate_scalar(&compiled.event, &next.state, params, &mut event_stack)
            - level;
        if matches_crossing(prev_value, next_value, mode) {
            let prev = &samples[sample_index - 1];
            let tau = interpolate_factor(prev_value, next_value);
            let state = lerp_state(&prev.state, &next.state, tau);
            hits.push(EventSeriesHit {
                order: hits.len(),
                sample_index,
                time: lerp_time(prev.time, next.time, tau),
                state: state.clone(),
                observable_values: evaluate_observables(
                    &compiled.observables,
                    &state,
                    params,
                    &mut observable_stack,
                ),
            });
        }
        prev_value = next_value;
    }

    Ok(EventSeriesResult { hits })
}

pub fn compute_event_series_from_orbit<S>(
    system: S,
    stepper: EventSeriesStepper,
    params: &[f64],
    initial_state: &[f64],
    initial_time: f64,
    steps: usize,
    dt: f64,
    compiled: &CompiledEventSeriesExpressions,
    mode: EventSeriesMode,
    level: f64,
) -> Result<EventSeriesResult>
where
    S: DynamicalSystem<f64>,
{
    if initial_state.is_empty() {
        bail!("Initial state must have positive dimension.");
    }
    if steps == 0 {
        return Ok(EventSeriesResult { hits: Vec::new() });
    }
    if !dt.is_finite() || dt <= 0.0 {
        bail!("Step size dt must be positive.");
    }
    if !level.is_finite() {
        bail!("Event level must be finite.");
    }

    let dim = initial_state.len();
    let mut orbit_stepper = stepper.build(dim);
    let mut event_stack = Vec::with_capacity(64);
    let mut observable_stack = Vec::with_capacity(64);
    let mut hits = Vec::new();
    let mut t = initial_time;
    let mut state = initial_state.to_vec();
    let mut prev_value = evaluate_scalar(&compiled.event, &state, params, &mut event_stack) - level;

    if mode == EventSeriesMode::EveryIterate {
        hits.push(EventSeriesHit {
            order: hits.len(),
            sample_index: 0,
            time: Some(t),
            state: state.clone(),
            observable_values: evaluate_observables(
                &compiled.observables,
                &state,
                params,
                &mut observable_stack,
            ),
        });
    }

    for sample_index in 1..=steps {
        let prev_time = t;
        let prev_state = state.clone();
        orbit_stepper.step(&system, &mut t, &mut state, dt);
        let next_value = evaluate_scalar(&compiled.event, &state, params, &mut event_stack) - level;

        match mode {
            EventSeriesMode::EveryIterate => {
                hits.push(EventSeriesHit {
                    order: hits.len(),
                    sample_index,
                    time: Some(t),
                    state: state.clone(),
                    observable_values: evaluate_observables(
                        &compiled.observables,
                        &state,
                        params,
                        &mut observable_stack,
                    ),
                });
            }
            EventSeriesMode::CrossUp
            | EventSeriesMode::CrossDown
            | EventSeriesMode::CrossEither => {
                if matches_crossing(prev_value, next_value, mode) {
                    let (hit_time, hit_state) = if matches!(stepper, EventSeriesStepper::Discrete) {
                        (Some(t), state.clone())
                    } else {
                        refine_flow_crossing(
                            &system,
                            stepper,
                            params,
                            &compiled.event,
                            level,
                            prev_time,
                            dt,
                            &prev_state,
                            prev_value,
                            next_value,
                        )?
                    };

                    hits.push(EventSeriesHit {
                        order: hits.len(),
                        sample_index,
                        time: hit_time,
                        state: hit_state.clone(),
                        observable_values: evaluate_observables(
                            &compiled.observables,
                            &hit_state,
                            params,
                            &mut observable_stack,
                        ),
                    });
                }
            }
        }

        prev_value = next_value;
    }

    Ok(EventSeriesResult { hits })
}

fn evaluate_scalar(
    bytecode: &Bytecode,
    state: &[f64],
    params: &[f64],
    stack: &mut Vec<f64>,
) -> f64 {
    VM::execute(bytecode, state, params, stack)
}

fn evaluate_observables(
    observables: &[Bytecode],
    state: &[f64],
    params: &[f64],
    stack: &mut Vec<f64>,
) -> Vec<f64> {
    observables
        .iter()
        .map(|observable| evaluate_scalar(observable, state, params, stack))
        .collect()
}

fn matches_crossing(prev_value: f64, next_value: f64, mode: EventSeriesMode) -> bool {
    if !prev_value.is_finite() || !next_value.is_finite() {
        return false;
    }

    match mode {
        EventSeriesMode::EveryIterate => true,
        EventSeriesMode::CrossUp => prev_value < -CROSS_EPS && next_value >= -CROSS_EPS,
        EventSeriesMode::CrossDown => prev_value > CROSS_EPS && next_value <= CROSS_EPS,
        EventSeriesMode::CrossEither => {
            (prev_value < -CROSS_EPS && next_value >= -CROSS_EPS)
                || (prev_value > CROSS_EPS && next_value <= CROSS_EPS)
        }
    }
}

fn interpolate_factor(prev_value: f64, next_value: f64) -> f64 {
    let denom = next_value - prev_value;
    if !denom.is_finite() || denom.abs() <= CROSS_EPS {
        return 0.5;
    }
    ((-prev_value) / denom).clamp(0.0, 1.0)
}

fn lerp_state(prev: &[f64], next: &[f64], tau: f64) -> Vec<f64> {
    prev.iter()
        .zip(next.iter())
        .map(|(left, right)| left + (right - left) * tau)
        .collect()
}

fn lerp_time(prev: Option<f64>, next: Option<f64>, tau: f64) -> Option<f64> {
    match (prev, next) {
        (Some(left), Some(right)) if left.is_finite() && right.is_finite() => {
            Some(left + (right - left) * tau)
        }
        _ => None,
    }
}

fn refine_flow_crossing<S>(
    system: &S,
    stepper: EventSeriesStepper,
    params: &[f64],
    event: &Bytecode,
    level: f64,
    segment_start_time: f64,
    segment_dt: f64,
    segment_start_state: &[f64],
    start_value: f64,
    _end_value: f64,
) -> Result<(Option<f64>, Vec<f64>)>
where
    S: DynamicalSystem<f64>,
{
    if segment_dt <= 0.0 {
        bail!("Segment dt must be positive.");
    }

    let dim = segment_start_state.len();
    let mut event_stack = Vec::with_capacity(64);
    let mut lo_time = 0.0;
    let mut hi_time = segment_dt;
    let mut lo_value = start_value;
    let mut hi_state =
        advance_state(system, stepper, segment_start_time, segment_start_state, segment_dt);
    let mut hit_time = segment_start_time + segment_dt;
    let mut hit_state = hi_state.clone();

    for _ in 0..REFINE_ITERS {
        let mid_time = 0.5 * (lo_time + hi_time);
        if (hi_time - lo_time).abs() <= TIME_EPS {
            break;
        }

        let mid_state =
            advance_state(system, stepper, segment_start_time, segment_start_state, mid_time);
        if mid_state.len() != dim {
            bail!("Refined state dimension changed during event extraction.");
        }
        let mid_value = evaluate_scalar(event, &mid_state, params, &mut event_stack) - level;

        if mid_value.abs() <= CROSS_EPS {
            hit_time = segment_start_time + mid_time;
            hit_state = mid_state;
            break;
        }

        if brackets_zero(lo_value, mid_value) {
            hi_time = mid_time;
            hi_state = mid_state;
        } else {
            lo_time = mid_time;
            lo_value = mid_value;
        }

        hit_time = segment_start_time + hi_time;
        hit_state = hi_state.clone();
    }

    Ok((Some(hit_time), hit_state))
}

fn brackets_zero(left: f64, right: f64) -> bool {
    if left.abs() <= CROSS_EPS || right.abs() <= CROSS_EPS {
        return true;
    }
    (left < 0.0 && right > 0.0) || (left > 0.0 && right < 0.0)
}

fn advance_state<S>(
    system: &S,
    stepper: EventSeriesStepper,
    start_time: f64,
    start_state: &[f64],
    dt: f64,
) -> Vec<f64>
where
    S: DynamicalSystem<f64>,
{
    if dt <= 0.0 {
        return start_state.to_vec();
    }
    let mut local_t = start_time;
    let mut state = start_state.to_vec();
    let mut local_stepper = stepper.build(state.len());
    local_stepper.step(system, &mut local_t, &mut state, dt);
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    struct LinearFlow;

    impl DynamicalSystem<f64> for LinearFlow {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: f64, _x: &[f64], out: &mut [f64]) {
            out[0] = 1.0;
        }
    }

    struct FlipMap;

    impl DynamicalSystem<f64> for FlipMap {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = -x[0];
        }
    }

    fn names() -> (Vec<String>, Vec<String>) {
        (vec!["x".to_string()], vec!["a".to_string()])
    }

    #[test]
    fn sampled_event_series_interpolates_parameter_observables() {
        let (var_names, param_names) = names();
        let compiled = compile_event_series_expressions(
            "x",
            &["a".to_string(), "x + a".to_string()],
            &var_names,
            &param_names,
        )
        .expect("compile");

        let result = extract_event_series_from_samples(
            &[2.0],
            &[
                OrderedSample {
                    time: Some(0.0),
                    state: vec![-1.0],
                },
                OrderedSample {
                    time: Some(1.0),
                    state: vec![1.0],
                },
            ],
            &compiled,
            EventSeriesMode::CrossUp,
            0.0,
        )
        .expect("event series");

        assert_eq!(result.hits.len(), 1);
        let hit = &result.hits[0];
        assert!((hit.time.expect("time") - 0.5).abs() < 1e-9);
        assert!(hit.state[0].abs() < 1e-9);
        assert_eq!(hit.observable_values.len(), 2);
        assert!((hit.observable_values[0] - 2.0).abs() < 1e-9);
        assert!((hit.observable_values[1] - 2.0).abs() < 1e-9);
    }

    #[test]
    fn sampled_event_series_preserves_hit_order() {
        let (var_names, param_names) = names();
        let compiled =
            compile_event_series_expressions("x", &["x".to_string()], &var_names, &param_names)
                .expect("compile");

        let result = extract_event_series_from_samples(
            &[0.0],
            &[
                OrderedSample {
                    time: Some(0.0),
                    state: vec![-1.0],
                },
                OrderedSample {
                    time: Some(1.0),
                    state: vec![1.0],
                },
                OrderedSample {
                    time: Some(2.0),
                    state: vec![-1.0],
                },
            ],
            &compiled,
            EventSeriesMode::CrossEither,
            0.0,
        )
        .expect("event series");

        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.hits[0].order, 0);
        assert_eq!(result.hits[1].order, 1);
        assert_eq!(result.hits[0].sample_index, 1);
        assert_eq!(result.hits[1].sample_index, 2);
    }

    #[test]
    fn orbit_event_series_refines_flow_crossings() {
        let (var_names, param_names) = names();
        let compiled =
            compile_event_series_expressions("x", &["x".to_string()], &var_names, &param_names)
                .expect("compile");

        let result = compute_event_series_from_orbit(
            LinearFlow,
            EventSeriesStepper::Rk4,
            &[0.0],
            &[-1.0],
            0.0,
            10,
            0.2,
            &compiled,
            EventSeriesMode::CrossUp,
            0.0,
        )
        .expect("event series");

        assert_eq!(result.hits.len(), 1);
        let hit = &result.hits[0];
        assert!((hit.time.expect("time") - 1.0).abs() < 1e-6);
        assert!(hit.state[0].abs() < 1e-6);
    }

    #[test]
    fn orbit_event_series_supports_map_iterates_and_crossings() {
        let (var_names, param_names) = names();
        let compiled =
            compile_event_series_expressions("x", &["x".to_string()], &var_names, &param_names)
                .expect("compile");

        let every_iterate = compute_event_series_from_orbit(
            FlipMap,
            EventSeriesStepper::Discrete,
            &[0.0],
            &[1.0],
            0.0,
            3,
            1.0,
            &compiled,
            EventSeriesMode::EveryIterate,
            0.0,
        )
        .expect("every iterate");
        assert_eq!(every_iterate.hits.len(), 4);
        assert_eq!(every_iterate.hits[0].sample_index, 0);
        assert_eq!(every_iterate.hits[3].sample_index, 3);

        let crossings = compute_event_series_from_orbit(
            FlipMap,
            EventSeriesStepper::Discrete,
            &[0.0],
            &[1.0],
            0.0,
            3,
            1.0,
            &compiled,
            EventSeriesMode::CrossEither,
            0.0,
        )
        .expect("crossings");
        assert_eq!(crossings.hits.len(), 3);
        assert_eq!(crossings.hits[0].sample_index, 1);
        assert_eq!(crossings.hits[1].sample_index, 2);
        assert_eq!(crossings.hits[2].sample_index, 3);
        assert_eq!(crossings.hits[0].state[0], -1.0);
    }
}
