use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct BoxTransitionOperator {
    pub dimension: usize,
    pub total_boxes: usize,
    pub bounds: Vec<(f64, f64)>,
    pub resolution: Vec<usize>,
    pub axis_names: Vec<String>,
    pub column_offsets: Vec<usize>,
    pub target_indices: Vec<usize>,
    pub probabilities: Vec<f64>,
    pub retained_mass: f64,
    pub zero_survivor_sources: usize,
}

pub fn box_index(point: &[f64], bounds: &[(f64, f64)], resolution: &[usize]) -> Option<usize> {
    if point.len() != bounds.len() || bounds.len() != resolution.len() {
        return None;
    }
    let mut index = 0usize;
    for ((&value, &(min, max)), &count) in point.iter().zip(bounds).zip(resolution) {
        if !value.is_finite() || value < min || value > max || count == 0 {
            return None;
        }
        let coordinate = if value == max {
            count - 1
        } else {
            ((value - min) / (max - min) * count as f64).floor() as usize
        };
        if coordinate >= count {
            return None;
        }
        index = index.checked_mul(count)?.checked_add(coordinate)?;
    }
    Some(index)
}

pub fn stratified_cell_sample(
    bounds: &[(f64, f64)],
    resolution: &[usize],
    cell: usize,
    sample: usize,
    samples_per_cell: usize,
) -> Result<Vec<f64>> {
    if samples_per_cell == 0 || bounds.is_empty() || bounds.len() != resolution.len() {
        bail!("Grid dimension and sample count must be positive.");
    }
    let total = resolution
        .iter()
        .try_fold(1usize, |n, &r| n.checked_mul(r))
        .ok_or_else(|| anyhow::anyhow!("Grid size overflows usize."))?;
    if cell >= total || resolution.contains(&0) {
        bail!("Cell index or resolution is invalid.");
    }
    let mut remaining = cell;
    let mut point = vec![0.0; bounds.len()];
    for axis in (0..bounds.len()).rev() {
        let coordinate = remaining % resolution[axis];
        remaining /= resolution[axis];
        let (min, max) = bounds[axis];
        let offset = if samples_per_cell == 1 {
            0.5
        } else {
            radical_inverse(sample + 1, PRIME_BASES[axis % PRIME_BASES.len()])
        };
        point[axis] = min + (coordinate as f64 + offset) * (max - min) / resolution[axis] as f64;
    }
    Ok(point)
}

const PRIME_BASES: [usize; 16] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
fn radical_inverse(mut n: usize, base: usize) -> f64 {
    let mut value = 0.0;
    let mut factor = 1.0 / base as f64;
    while n > 0 {
        value += factor * (n % base) as f64;
        n /= base;
        factor /= base as f64;
    }
    value
}

pub fn sampled_box_transition_operator<S: DynamicalSystem<f64>>(
    system: &S,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
) -> Result<BoxTransitionOperator> {
    sampled_box_transition_operator_with_axis_names(
        system,
        bounds,
        resolution,
        samples_per_cell,
        iterations,
        &[],
    )
}

pub fn sampled_box_transition_operator_with_axis_names<S: DynamicalSystem<f64>>(
    system: &S,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
    axis_names: &[String],
) -> Result<BoxTransitionOperator> {
    sampled_box_transition_operator_with_axis_names_and_step(
        system.dimension(),
        bounds,
        resolution,
        samples_per_cell,
        iterations,
        axis_names,
        |_, _, _, state, out| {
            system.apply(0.0, state, out);
            Ok(())
        },
    )
}

/// Sample a fixed number of transitions from each cell using a caller-provided step.
///
/// The callback receives the source cell, sample, and transition indices so callers can
/// reset per-sample transition state such as a flow time before advancing the sample.
pub fn sampled_box_transition_operator_with_axis_names_and_step<F>(
    dimension: usize,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
    axis_names: &[String],
    mut step: F,
) -> Result<BoxTransitionOperator>
where
    F: FnMut(usize, usize, usize, &mut [f64], &mut [f64]) -> Result<()>,
{
    if iterations == 0 || dimension != bounds.len() {
        bail!("Transition iterations and grid dimension must be positive and match the system.");
    }
    let total = resolution
        .iter()
        .try_fold(1usize, |n, &r| n.checked_mul(r))
        .ok_or_else(|| anyhow::anyhow!("Grid size overflows usize."))?;
    let mut offsets = Vec::with_capacity(total + 1);
    let mut targets = Vec::new();
    let mut probabilities = Vec::new();
    let mut retained = 0usize;
    let mut zero_survivor_sources = 0usize;
    for source in 0..total {
        offsets.push(targets.len());
        let mut counts = BTreeMap::new();
        for sample in 0..samples_per_cell {
            let mut state =
                stratified_cell_sample(bounds, resolution, source, sample, samples_per_cell)?;
            let mut out = vec![0.0; state.len()];
            for iteration in 0..iterations {
                step(source, sample, iteration, &mut state, &mut out)?;
                state.copy_from_slice(&out);
            }
            if let Some(target) = box_index(&state, bounds, resolution) {
                *counts.entry(target).or_insert(0usize) += 1;
                retained += 1;
            }
        }
        let in_grid_count: usize = counts.values().sum();
        if in_grid_count == 0 {
            zero_survivor_sources += 1;
        }
        for (target, count) in counts {
            targets.push(target);
            probabilities.push(count as f64 / in_grid_count as f64);
        }
    }
    offsets.push(targets.len());
    Ok(BoxTransitionOperator {
        dimension: bounds.len(),
        total_boxes: total,
        bounds: bounds.to_vec(),
        resolution: resolution.to_vec(),
        axis_names: axis_names.to_vec(),
        column_offsets: offsets,
        target_indices: targets,
        probabilities,
        retained_mass: retained as f64 / (total * samples_per_cell) as f64,
        zero_survivor_sources,
    })
}

fn apply_operator(operator: &BoxTransitionOperator, distribution: &[f64]) -> Vec<f64> {
    let mut applied = vec![0.0; operator.total_boxes];
    for source in 0..operator.total_boxes {
        for edge in operator.column_offsets[source]..operator.column_offsets[source + 1] {
            applied[operator.target_indices[edge]] +=
                operator.probabilities[edge] * distribution[source];
        }
    }
    applied
}

fn eigenvalue_and_residual(operator: &BoxTransitionOperator, distribution: &[f64]) -> (f64, f64) {
    let applied = apply_operator(operator, distribution);
    let eigenvalue: f64 = applied.iter().sum();
    let residual: f64 = applied
        .iter()
        .zip(distribution)
        .map(|(applied, value)| (applied - eigenvalue * value).abs())
        .sum();
    (eigenvalue, residual)
}

pub fn stationary_distribution(
    operator: &BoxTransitionOperator,
    max_iterations: usize,
    tolerance: f64,
) -> Result<(Vec<f64>, f64, f64, usize)> {
    if max_iterations == 0 || !tolerance.is_finite() || tolerance <= 0.0 {
        bail!("Stationary iteration settings must be positive.");
    }
    let n = operator.total_boxes;
    let eligible: Vec<usize> = (0..n)
        .filter(|source| operator.column_offsets[*source] < operator.column_offsets[*source + 1])
        .collect();
    let mut p = vec![0.0; n];
    if eligible.is_empty() {
        if n == 0 {
            return Ok((p, 0.0, 0.0, 0));
        }
        p.fill(1.0 / n as f64);
    } else {
        for source in &eligible {
            p[*source] = 1.0 / eligible.len() as f64;
        }
    }

    for iteration in 1..=max_iterations {
        let applied = apply_operator(operator, &p);
        let survival = applied.iter().sum::<f64>();
        if survival <= 0.0 {
            return Ok((vec![0.0; n], 0.0, 0.0, iteration));
        }

        let next: Vec<f64> = applied.iter().map(|value| value / survival).collect();
        let (next_eigenvalue, next_residual) = eigenvalue_and_residual(operator, &next);
        p = next;
        if next_eigenvalue > 0.0 && next_residual <= tolerance {
            return Ok((p, next_eigenvalue, next_residual, iteration));
        }
    }
    let (eigenvalue, residual) = eigenvalue_and_residual(operator, &p);
    Ok((p, eigenvalue, residual, max_iterations))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Identity;
    impl DynamicalSystem<f64> for Identity {
        fn dimension(&self) -> usize {
            1
        }
        fn apply(&self, _: f64, x: &[f64], out: &mut [f64]) {
            out[0] = x[0]
        }
    }
    #[test]
    fn identity_operator_is_stochastic_and_uniform_is_stationary() {
        let op = sampled_box_transition_operator(&Identity, &[(0., 1.)], &[4], 3, 1).unwrap();
        for column in 0..4 {
            let sum: f64 = op.probabilities
                [op.column_offsets[column]..op.column_offsets[column + 1]]
                .iter()
                .sum();
            assert!((sum - 1.).abs() < 1e-12);
        }
        let (p, eigenvalue, residual, _) = stationary_distribution(&op, 10, 1e-12).unwrap();
        assert!((p.iter().sum::<f64>() - 1.).abs() < 1e-12);
        assert!(p.iter().all(|x| *x >= 0.));
        assert!((eigenvalue - 1.).abs() < 1e-12);
        assert!(residual < 1e-12);
    }

    #[test]
    fn caller_provided_step_samples_a_fixed_transition() {
        let op = sampled_box_transition_operator_with_axis_names_and_step(
            1,
            &[(0., 1.)],
            &[2],
            2,
            1,
            &["x".to_string()],
            |_, _, _, state, out| {
                out[0] = state[0] + 0.01;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(op.target_indices, vec![0, 1]);
        assert_eq!(op.zero_survivor_sources, 0);
        assert!((op.retained_mass - 1.).abs() < 1e-12);
    }
    #[test]
    fn upper_boundary_belongs_to_last_box() {
        assert_eq!(box_index(&[1.], &[(0., 1.)], &[4]), Some(3));
    }
    struct Escape;
    impl DynamicalSystem<f64> for Escape {
        fn dimension(&self) -> usize {
            1
        }
        fn apply(&self, _: f64, _: &[f64], out: &mut [f64]) {
            out[0] = 2.0;
        }
    }
    #[test]
    fn zero_survivor_sources_are_excluded_and_not_renormalized_globally() {
        let op = sampled_box_transition_operator(&Escape, &[(0., 1.)], &[2], 3, 1).unwrap();
        assert_eq!(op.zero_survivor_sources, 2);
        let (p, eigenvalue, residual, _) = stationary_distribution(&op, 10, 1e-12).unwrap();
        assert!(p.iter().all(|value| *value == 0.));
        assert_eq!(eigenvalue, 0.);
        assert_eq!(residual, 0.);
    }

    struct IntoZeroSurvivor;
    impl DynamicalSystem<f64> for IntoZeroSurvivor {
        fn dimension(&self) -> usize {
            1
        }
        fn apply(&self, _: f64, x: &[f64], out: &mut [f64]) {
            out[0] = if x[0] < 0.5 { 0.75 } else { 2.0 };
        }
    }

    #[test]
    fn retained_transition_into_zero_survivor_target_returns_relaxed_mode() {
        let op = sampled_box_transition_operator_with_axis_names(
            &IntoZeroSurvivor,
            &[(0., 1.)],
            &[2],
            3,
            1,
            &["x".to_string()],
        )
        .unwrap();
        assert_eq!(op.zero_survivor_sources, 1);
        let (p, eigenvalue, residual, _) = stationary_distribution(&op, 10, 1e-12).unwrap();
        assert!(p.iter().all(|value| *value == 0.));
        assert_eq!(eigenvalue, 0.);
        assert_eq!(residual, 0.);
    }

    #[test]
    fn leaky_operator_returns_its_normalized_dominant_mode() {
        let op = BoxTransitionOperator {
            dimension: 1,
            total_boxes: 2,
            bounds: vec![(0., 1.)],
            resolution: vec![2],
            axis_names: vec!["x".to_string()],
            column_offsets: vec![0, 2, 2],
            target_indices: vec![0, 1],
            probabilities: vec![0.5, 0.5],
            retained_mass: 0.5,
            zero_survivor_sources: 1,
        };
        let (p, eigenvalue, residual, _) = stationary_distribution(&op, 100, 1e-12).unwrap();
        assert!((p[0] - 0.5).abs() < 1e-12);
        assert!((p[1] - 0.5).abs() < 1e-12);
        assert!((eigenvalue - 0.5).abs() < 1e-12);
        assert!(residual < 1e-12);
    }
}
