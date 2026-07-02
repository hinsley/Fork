/// Periodic state-coordinate metadata and modular arithmetic helpers.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StatePeriodicity {
    periods: Vec<Option<f64>>,
}

impl StatePeriodicity {
    pub fn none() -> Self {
        Self {
            periods: Vec::new(),
        }
    }

    pub fn from_periods(periods: &[f64], dim: usize) -> Self {
        let mut normalized = vec![None; dim];
        for (index, period) in periods.iter().copied().enumerate().take(dim) {
            if period.is_finite() && period > 0.0 {
                normalized[index] = Some(period);
            }
        }
        Self {
            periods: normalized,
        }
    }

    pub fn period(&self, index: usize) -> Option<f64> {
        self.periods.get(index).copied().flatten()
    }

    pub fn wrap_value(value: f64, period: f64) -> f64 {
        if !value.is_finite() || !period.is_finite() || period <= 0.0 {
            return value;
        }
        let wrapped = value.rem_euclid(period);
        if wrapped == period {
            0.0
        } else {
            wrapped
        }
    }

    pub fn wrap_state(&self, state: &mut [f64]) {
        for (index, value) in state.iter_mut().enumerate() {
            if let Some(period) = self.period(index) {
                *value = Self::wrap_value(*value, period);
            }
        }
    }

    pub fn wrapped_delta(&self, index: usize, delta: f64) -> f64 {
        let Some(period) = self.period(index) else {
            return delta;
        };
        if !delta.is_finite() {
            return delta;
        }
        (delta + 0.5 * period).rem_euclid(period) - 0.5 * period
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_positive_and_negative_values() {
        let periodicity = StatePeriodicity::from_periods(&[1.0, f64::NAN, 2.0], 3);
        let mut state = vec![1.25, 5.0, -0.25];
        periodicity.wrap_state(&mut state);

        assert!((state[0] - 0.25).abs() < 1e-12);
        assert!((state[1] - 5.0).abs() < 1e-12);
        assert!((state[2] - 1.75).abs() < 1e-12);
    }

    #[test]
    fn wrapped_delta_uses_short_periodic_displacement() {
        let periodicity = StatePeriodicity::from_periods(&[1.0], 1);

        assert!((periodicity.wrapped_delta(0, 0.1) - 0.1).abs() < 1e-12);
        assert!((periodicity.wrapped_delta(0, 0.9) + 0.1).abs() < 1e-12);
        assert!((periodicity.wrapped_delta(0, -0.9) - 0.1).abs() < 1e-12);
    }
}
