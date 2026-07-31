use crate::{
    autodiff::{Dual, TangentSystem},
    solvers::{DiscreteMap, Tsit5, RK4},
    traits::{DynamicalSystem, Steppable},
};
use anyhow::{anyhow, bail, Result};
use nalgebra::DMatrix;
use serde::Serialize;

const CONDITIONING_WARNING_LOG_THRESHOLD: f64 = 500.0;

#[derive(Debug, Clone, Copy)]
pub enum ExpansionEntropyStepper {
    Rk4,
    Tsit5,
    Discrete,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ExpansionEntropySampleResult {
    pub horizons: Vec<f64>,
    pub log_expansion_factors: Vec<Option<f64>>,
    pub survived: Vec<bool>,
    pub max_log_condition_number: f64,
    pub conditioning_warning: bool,
}

pub fn cartesian_cell_center(
    bounds: &[(f64, f64)],
    resolution: &[usize],
    sample_index: usize,
) -> Result<Vec<f64>> {
    if bounds.is_empty() || bounds.len() != resolution.len() {
        bail!("Bounds and resolution must have the same positive dimension.");
    }

    let mut total = 1usize;
    for ((min, max), count) in bounds.iter().zip(resolution) {
        if !min.is_finite() || !max.is_finite() || min >= max {
            bail!("Each grid bound must be finite with min < max.");
        }
        if *count == 0 {
            bail!("Each grid resolution must be at least 1.");
        }
        total = total
            .checked_mul(*count)
            .ok_or_else(|| anyhow!("Grid sample count overflows usize."))?;
    }
    if sample_index >= total {
        bail!("Sample index is outside the state grid.");
    }

    let mut remaining = sample_index;
    let mut point = vec![0.0; bounds.len()];
    for axis in (0..bounds.len()).rev() {
        let count = resolution[axis];
        let coordinate = remaining % count;
        remaining /= count;
        let (min, max) = bounds[axis];
        let spacing = (max - min) / count as f64;
        point[axis] = min + (coordinate as f64 + 0.5) * spacing;
    }
    Ok(point)
}

pub fn expansion_entropy_sample<S>(
    system: S,
    solver: ExpansionEntropyStepper,
    initial_state: &[f64],
    bounds: &[(f64, f64)],
    initial_time: f64,
    steps: usize,
    dt: f64,
    checkpoint_stride: usize,
    stabilization_stride: usize,
) -> Result<ExpansionEntropySampleResult>
where
    S: DynamicalSystem<f64> + DynamicalSystem<Dual>,
{
    if initial_state.is_empty() || initial_state.len() != bounds.len() {
        bail!("Initial state and bounds must have the same positive dimension.");
    }
    if DynamicalSystem::<f64>::dimension(&system) != initial_state.len() {
        bail!("Initial state dimension does not match the system.");
    }
    for (min, max) in bounds {
        if !min.is_finite() || !max.is_finite() || min >= max {
            bail!("Each grid bound must be finite with min < max.");
        }
    }
    if steps == 0 {
        bail!("Expansion entropy requires at least one integration step.");
    }
    if !dt.is_finite() || dt <= 0.0 {
        bail!("Step size must be finite and positive.");
    }
    if checkpoint_stride == 0 || stabilization_stride == 0 {
        bail!("Checkpoint and stabilization strides must be at least 1.");
    }

    let dim = initial_state.len();
    let mut augmented_state = vec![0.0; dim + dim * dim];
    augmented_state[..dim].copy_from_slice(initial_state);
    for row in 0..dim {
        augmented_state[dim + row * dim + row] = 1.0;
    }

    let tangent_system = TangentSystem::new(system, dim);
    let mut stepper = match solver {
        ExpansionEntropyStepper::Rk4 => {
            ExpansionEntropyInternalStepper::Rk4(RK4::new(dim + dim * dim))
        }
        ExpansionEntropyStepper::Tsit5 => {
            ExpansionEntropyInternalStepper::Tsit5(Tsit5::new(dim + dim * dim))
        }
        ExpansionEntropyStepper::Discrete => {
            ExpansionEntropyInternalStepper::Discrete(DiscreteMap::new(dim + dim * dim))
        }
    };
    let mut time = initial_time;
    let mut log_scale = 0.0;
    let mut survived = true;
    let mut max_log_condition_number: f64 = 0.0;
    let mut conditioning_warning = false;
    let checkpoint_count = steps.div_ceil(checkpoint_stride);
    let mut horizons = Vec::with_capacity(checkpoint_count);
    let mut log_expansion_factors = Vec::with_capacity(checkpoint_count);
    let mut survival_series = Vec::with_capacity(checkpoint_count);

    for step in 1..=steps {
        if survived {
            stepper.step(&tangent_system, &mut time, &mut augmented_state, dt);
            survived = state_is_inside(&augmented_state[..dim], bounds);
            if survived && step % stabilization_stride == 0 {
                rescale_tangent(&mut augmented_state[dim..], &mut log_scale)?;
            }
        } else {
            time += dt;
        }

        if step % checkpoint_stride == 0 || step == steps {
            horizons.push(match solver {
                ExpansionEntropyStepper::Discrete => step as f64,
                ExpansionEntropyStepper::Rk4 | ExpansionEntropyStepper::Tsit5 => step as f64 * dt,
            });
            survival_series.push(survived);
            if survived {
                let (log_factor, log_condition, warned) =
                    log_expansion_factor(&augmented_state[dim..], dim, log_scale)?;
                log_expansion_factors.push(Some(log_factor));
                max_log_condition_number = max_log_condition_number.max(log_condition);
                conditioning_warning |= warned;
            } else {
                log_expansion_factors.push(None);
            }
        }
    }

    Ok(ExpansionEntropySampleResult {
        horizons,
        log_expansion_factors,
        survived: survival_series,
        max_log_condition_number,
        conditioning_warning,
    })
}

pub fn expansion_entropy_convergence(
    sample_results: &[ExpansionEntropySampleResult],
) -> Result<(Vec<f64>, Vec<f64>, Vec<usize>)> {
    let first = sample_results
        .first()
        .ok_or_else(|| anyhow!("Expansion entropy requires at least one sample."))?;
    if first.horizons.is_empty() {
        bail!("Expansion entropy samples must contain at least one checkpoint.");
    }
    let checkpoints = first.horizons.len();
    let mut estimates = Vec::with_capacity(checkpoints);
    let mut survivors = Vec::with_capacity(checkpoints);

    for sample in sample_results {
        if sample.horizons != first.horizons
            || sample.log_expansion_factors.len() != checkpoints
            || sample.survived.len() != checkpoints
        {
            bail!("Expansion entropy sample checkpoint grids do not match.");
        }
    }

    for checkpoint in 0..checkpoints {
        let logs: Vec<f64> = sample_results
            .iter()
            .filter_map(|sample| sample.log_expansion_factors[checkpoint])
            .collect();
        survivors.push(logs.len());
        if logs.is_empty() {
            estimates.push(f64::NEG_INFINITY);
            continue;
        }
        let maximum = logs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let log_sum = maximum
            + logs
                .iter()
                .map(|value| (value - maximum).exp())
                .sum::<f64>()
                .ln();
        let horizon = first.horizons[checkpoint];
        if !horizon.is_finite() || horizon <= 0.0 {
            bail!("Expansion entropy checkpoint horizons must be finite and positive.");
        }
        estimates.push((log_sum - (sample_results.len() as f64).ln()) / horizon);
    }

    Ok((first.horizons.clone(), estimates, survivors))
}

enum ExpansionEntropyInternalStepper {
    Rk4(RK4<f64>),
    Tsit5(Tsit5<f64>),
    Discrete(DiscreteMap<f64>),
}

impl ExpansionEntropyInternalStepper {
    fn step<S>(&mut self, system: &TangentSystem<S>, time: &mut f64, state: &mut [f64], dt: f64)
    where
        S: DynamicalSystem<f64> + DynamicalSystem<Dual>,
    {
        match self {
            Self::Rk4(stepper) => Steppable::step(stepper, system, time, state, dt),
            Self::Tsit5(stepper) => Steppable::step(stepper, system, time, state, dt),
            Self::Discrete(stepper) => Steppable::step(stepper, system, time, state, dt),
        }
    }
}

fn state_is_inside(state: &[f64], bounds: &[(f64, f64)]) -> bool {
    state
        .iter()
        .zip(bounds)
        .all(|(value, (min, max))| value.is_finite() && value >= min && value <= max)
}

fn rescale_tangent(tangent: &mut [f64], log_scale: &mut f64) -> Result<()> {
    let maximum = tangent.iter().map(|value| value.abs()).fold(0.0, f64::max);
    if !maximum.is_finite() || maximum <= f64::MIN_POSITIVE {
        bail!("Tangent matrix became non-finite or numerically singular.");
    }
    for value in tangent {
        *value /= maximum;
    }
    *log_scale += maximum.ln();
    Ok(())
}

fn log_expansion_factor(tangent: &[f64], dim: usize, log_scale: f64) -> Result<(f64, f64, bool)> {
    let matrix = DMatrix::from_row_slice(dim, dim, tangent);
    let singular_values = matrix.svd(false, false).singular_values;
    let mut log_factor = 0.0;
    let mut maximum_log = f64::NEG_INFINITY;
    let mut minimum_log = f64::INFINITY;
    for singular_value in singular_values.iter() {
        if !singular_value.is_finite() {
            bail!("Tangent singular-value decomposition returned a non-finite value.");
        }
        if *singular_value <= 0.0 {
            minimum_log = f64::NEG_INFINITY;
            continue;
        }
        let log_value = log_scale + singular_value.ln();
        log_factor += log_value.max(0.0);
        maximum_log = maximum_log.max(log_value);
        minimum_log = minimum_log.min(log_value);
    }
    let log_condition = maximum_log - minimum_log;
    Ok((
        log_factor,
        log_condition,
        log_condition > CONDITIONING_WARNING_LOG_THRESHOLD,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        cartesian_cell_center, expansion_entropy_convergence, expansion_entropy_sample,
        ExpansionEntropySampleResult, ExpansionEntropyStepper,
    };
    use crate::{autodiff::Dual, traits::DynamicalSystem};

    #[derive(Clone, Copy)]
    struct LinearSystem {
        rates: [f64; 2],
    }

    impl DynamicalSystem<f64> for LinearSystem {
        fn dimension(&self) -> usize {
            2
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = self.rates[0] * x[0];
            out[1] = self.rates[1] * x[1];
        }
    }

    impl DynamicalSystem<Dual> for LinearSystem {
        fn dimension(&self) -> usize {
            2
        }

        fn apply(&self, _t: Dual, x: &[Dual], out: &mut [Dual]) {
            out[0] = x[0] * Dual::new(self.rates[0], 0.0);
            out[1] = x[1] * Dual::new(self.rates[1], 0.0);
        }
    }

    #[test]
    fn cartesian_sampling_uses_deterministic_cell_centers() {
        let bounds = [(-1.0, 1.0), (10.0, 14.0)];
        let resolution = [2, 2];
        assert_eq!(
            cartesian_cell_center(&bounds, &resolution, 0).unwrap(),
            vec![-0.5, 11.0]
        );
        assert_eq!(
            cartesian_cell_center(&bounds, &resolution, 3).unwrap(),
            vec![0.5, 13.0]
        );
        assert!(cartesian_cell_center(&bounds, &resolution, 4).is_err());
    }

    #[test]
    fn linear_flow_matches_the_known_positive_rate_sum() {
        let result = expansion_entropy_sample(
            LinearSystem { rates: [0.4, -0.2] },
            ExpansionEntropyStepper::Rk4,
            &[0.0, 0.0],
            &[(-1.0, 1.0), (-1.0, 1.0)],
            0.0,
            200,
            0.01,
            20,
            10,
        )
        .unwrap();

        assert_eq!(result.horizons.len(), 10);
        for (time, log_factor) in result
            .horizons
            .iter()
            .zip(result.log_expansion_factors.iter())
        {
            let expected = 0.4 * time;
            assert!((log_factor.unwrap() - expected).abs() < 1.0e-8);
        }
        assert!(result.survived.iter().all(|value| *value));
        assert!(!result.conditioning_warning);
    }

    #[test]
    fn linear_map_matches_the_known_positive_log_singular_value_sum() {
        let result = expansion_entropy_sample(
            LinearSystem { rates: [2.0, 0.5] },
            ExpansionEntropyStepper::Discrete,
            &[0.0, 0.0],
            &[(-1.0, 1.0), (-1.0, 1.0)],
            0.0,
            12,
            1.0,
            3,
            2,
        )
        .unwrap();

        assert_eq!(result.horizons, vec![3.0, 6.0, 9.0, 12.0]);
        for (iterations, log_factor) in result
            .horizons
            .iter()
            .zip(result.log_expansion_factors.iter())
        {
            let expected = iterations * 2.0_f64.ln();
            assert!((log_factor.unwrap() - expected).abs() < 1.0e-12);
        }
        let (_, estimates, survivors) = expansion_entropy_convergence(&[result]).unwrap();
        assert!(estimates
            .iter()
            .all(|estimate| (*estimate - 2.0_f64.ln()).abs() < 1.0e-12));
        assert_eq!(survivors, vec![1, 1, 1, 1]);
    }

    #[test]
    fn contracting_map_has_zero_expansion_entropy_estimate() {
        let result = expansion_entropy_sample(
            LinearSystem { rates: [0.5, 0.25] },
            ExpansionEntropyStepper::Discrete,
            &[0.5, -0.5],
            &[(-1.0, 1.0), (-1.0, 1.0)],
            0.0,
            10,
            1.0,
            2,
            2,
        )
        .unwrap();

        let (_, estimates, survivors) = expansion_entropy_convergence(&[result]).unwrap();
        assert_eq!(estimates, vec![0.0; 5]);
        assert_eq!(survivors, vec![1; 5]);
    }

    #[test]
    fn map_escape_is_applied_after_each_iterate() {
        let result = expansion_entropy_sample(
            LinearSystem { rates: [2.0, 1.0] },
            ExpansionEntropyStepper::Discrete,
            &[0.6, 0.0],
            &[(-1.0, 1.0), (-1.0, 1.0)],
            0.0,
            4,
            1.0,
            1,
            1,
        )
        .unwrap();

        assert_eq!(result.horizons, vec![1.0, 2.0, 3.0, 4.0]);
        assert!(result.survived.iter().all(|survived| !survived));
        assert!(result.log_expansion_factors.iter().all(Option::is_none));
    }

    #[test]
    fn escaped_samples_contribute_zero_from_the_first_escape_checkpoint() {
        let result = expansion_entropy_sample(
            LinearSystem { rates: [1.0, 0.0] },
            ExpansionEntropyStepper::Rk4,
            &[0.9, 0.0],
            &[(-1.0, 1.0), (-1.0, 1.0)],
            0.0,
            10,
            0.1,
            1,
            1,
        )
        .unwrap();

        assert!(!result.survived[1]);
        assert!(result.log_expansion_factors[1].is_none());
        assert!(result
            .log_expansion_factors
            .iter()
            .skip(1)
            .all(Option::is_none));
    }

    #[test]
    fn convergence_uses_total_ensemble_size_and_log_sum_exp() {
        let samples = vec![
            ExpansionEntropySampleResult {
                horizons: vec![1.0, 2.0],
                log_expansion_factors: vec![Some(2.0), Some(4.0)],
                survived: vec![true, true],
                max_log_condition_number: 0.0,
                conditioning_warning: false,
            },
            ExpansionEntropySampleResult {
                horizons: vec![1.0, 2.0],
                log_expansion_factors: vec![None, None],
                survived: vec![false, false],
                max_log_condition_number: 0.0,
                conditioning_warning: false,
            },
        ];

        let (times, estimates, survivors) = expansion_entropy_convergence(&samples).unwrap();
        assert_eq!(times, vec![1.0, 2.0]);
        assert_eq!(survivors, vec![1, 1]);
        assert!((estimates[0] - (2.0 - 2.0_f64.ln())).abs() < 1.0e-12);
        assert!((estimates[1] - (4.0 - 2.0_f64.ln()) / 2.0).abs() < 1.0e-12);
    }

    #[test]
    fn convergence_is_negative_infinity_when_no_sample_survives() {
        let samples = vec![ExpansionEntropySampleResult {
            horizons: vec![1.0],
            log_expansion_factors: vec![None],
            survived: vec![false],
            max_log_condition_number: 0.0,
            conditioning_warning: false,
        }];

        let (_, estimates, survivors) = expansion_entropy_convergence(&samples).unwrap();
        assert_eq!(survivors, vec![0]);
        assert_eq!(estimates, vec![f64::NEG_INFINITY]);
    }
}
