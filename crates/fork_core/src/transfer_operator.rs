use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq)]
pub struct BoxTransitionOperator {
    pub dimension: usize,
    pub total_boxes: usize,
    pub ambient_box_count: usize,
    pub bounds: Vec<(f64, f64)>,
    pub resolution: Vec<usize>,
    pub axis_names: Vec<String>,
    pub cover_box_indices: Vec<usize>,
    pub seed_box_index: usize,
    pub cover_growth_iterations: usize,
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
        if !value.is_finite()
            || !min.is_finite()
            || !max.is_finite()
            || min > max
            || count == 0
            || (min == max && (count != 1 || value != min))
            || value < min
            || value > max
        {
            return None;
        }
        let coordinate = if min == max {
            0
        } else if value == max {
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
    let total =
        validate_transition_grid(dimension, bounds, resolution, samples_per_cell, iterations)?;
    let cover_box_indices: Vec<usize> = (0..total).collect();
    assemble_sampled_box_transition_operator(
        dimension,
        bounds,
        resolution,
        samples_per_cell,
        iterations,
        axis_names,
        &cover_box_indices,
        0,
        0,
        &mut step,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step<F>(
    dimension: usize,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
    axis_names: &[String],
    seed_box_index: usize,
    mut step: F,
) -> Result<BoxTransitionOperator>
where
    F: FnMut(usize, usize, usize, &mut [f64], &mut [f64]) -> Result<()>,
{
    let total =
        validate_transition_grid(dimension, bounds, resolution, samples_per_cell, iterations)?;
    if seed_box_index >= total {
        bail!("The transfer-operator starting point must select a valid ambient box.");
    }

    let mut discovered = BTreeSet::from([seed_box_index]);
    let mut frontier = BTreeSet::from([seed_box_index]);
    let mut cover_growth_iterations = 0usize;
    while !frontier.is_empty() {
        cover_growth_iterations += 1;
        let mut next = BTreeSet::new();
        for source in frontier {
            for sample in 0..samples_per_cell {
                if let Some(target) = sampled_transition_target(
                    bounds,
                    resolution,
                    source,
                    sample,
                    samples_per_cell,
                    iterations,
                    &mut step,
                )? {
                    if !discovered.contains(&target) {
                        next.insert(target);
                    }
                }
            }
        }
        discovered.extend(next.iter().copied());
        frontier = next;
    }

    let cover_box_indices: Vec<usize> = discovered.into_iter().collect();
    assemble_sampled_box_transition_operator(
        dimension,
        bounds,
        resolution,
        samples_per_cell,
        iterations,
        axis_names,
        &cover_box_indices,
        seed_box_index,
        cover_growth_iterations,
        &mut step,
    )
}

fn validate_transition_grid(
    dimension: usize,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
) -> Result<usize> {
    if iterations == 0
        || samples_per_cell == 0
        || dimension == 0
        || dimension != bounds.len()
        || bounds.len() != resolution.len()
    {
        bail!("Transition settings and grid dimension must be positive and match the system.");
    }
    for (&(min, max), &count) in bounds.iter().zip(resolution) {
        if !min.is_finite()
            || !max.is_finite()
            || min > max
            || count == 0
            || (min == max && count != 1)
        {
            bail!("Each grid axis requires min < max, or min = max with resolution 1.");
        }
    }
    resolution
        .iter()
        .try_fold(1usize, |n, &r| n.checked_mul(r))
        .ok_or_else(|| anyhow::anyhow!("Grid size overflows usize."))
}

#[allow(clippy::too_many_arguments)]
fn sampled_transition_target<F>(
    bounds: &[(f64, f64)],
    resolution: &[usize],
    source: usize,
    sample: usize,
    samples_per_cell: usize,
    iterations: usize,
    step: &mut F,
) -> Result<Option<usize>>
where
    F: FnMut(usize, usize, usize, &mut [f64], &mut [f64]) -> Result<()>,
{
    let mut state = stratified_cell_sample(bounds, resolution, source, sample, samples_per_cell)?;
    let mut out = vec![0.0; state.len()];
    for iteration in 0..iterations {
        step(source, sample, iteration, &mut state, &mut out)?;
        state.copy_from_slice(&out);
    }
    Ok(box_index(&state, bounds, resolution))
}

#[allow(clippy::too_many_arguments)]
fn assemble_sampled_box_transition_operator<F>(
    dimension: usize,
    bounds: &[(f64, f64)],
    resolution: &[usize],
    samples_per_cell: usize,
    iterations: usize,
    axis_names: &[String],
    cover_box_indices: &[usize],
    seed_box_index: usize,
    cover_growth_iterations: usize,
    step: &mut F,
) -> Result<BoxTransitionOperator>
where
    F: FnMut(usize, usize, usize, &mut [f64], &mut [f64]) -> Result<()>,
{
    let ambient_box_count =
        validate_transition_grid(dimension, bounds, resolution, samples_per_cell, iterations)?;
    let local_indices: BTreeMap<usize, usize> = cover_box_indices
        .iter()
        .copied()
        .enumerate()
        .map(|(local, ambient)| (ambient, local))
        .collect();
    let mut offsets = Vec::with_capacity(cover_box_indices.len() + 1);
    let mut targets = Vec::new();
    let mut probabilities = Vec::new();
    let mut retained = 0usize;
    let mut zero_survivor_sources = 0usize;
    for &source in cover_box_indices {
        offsets.push(targets.len());
        let mut counts = BTreeMap::new();
        for sample in 0..samples_per_cell {
            if let Some(target) = sampled_transition_target(
                bounds,
                resolution,
                source,
                sample,
                samples_per_cell,
                iterations,
                step,
            )? {
                let Some(&local_target) = local_indices.get(&target) else {
                    continue;
                };
                *counts.entry(local_target).or_insert(0usize) += 1;
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
        total_boxes: cover_box_indices.len(),
        ambient_box_count,
        bounds: bounds.to_vec(),
        resolution: resolution.to_vec(),
        axis_names: axis_names.to_vec(),
        cover_box_indices: cover_box_indices.to_vec(),
        seed_box_index,
        cover_growth_iterations,
        column_offsets: offsets,
        target_indices: targets,
        probabilities,
        retained_mass: retained as f64
            / cover_box_indices
                .len()
                .checked_mul(samples_per_cell)
                .ok_or_else(|| anyhow::anyhow!("Transfer sample count overflows usize."))?
                as f64,
        zero_survivor_sources,
    })
}

fn apply_operator(operator: &BoxTransitionOperator, distribution: &[f64]) -> Vec<f64> {
    let mut applied = vec![0.0; operator.total_boxes];
    for (source, &source_mass) in distribution.iter().enumerate().take(operator.total_boxes) {
        for edge in operator.column_offsets[source]..operator.column_offsets[source + 1] {
            applied[operator.target_indices[edge]] += operator.probabilities[edge] * source_mass;
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
            ambient_box_count: 2,
            bounds: vec![(0., 1.)],
            resolution: vec![2],
            axis_names: vec!["x".to_string()],
            cover_box_indices: vec![0, 1],
            seed_box_index: 0,
            cover_growth_iterations: 0,
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

    #[test]
    fn one_starting_point_grows_a_compact_forward_cover() {
        let op = sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step(
            1,
            &[(0., 1.)],
            &[5],
            1,
            1,
            &["x".to_string()],
            1,
            |_, _, _, state, out| {
                out[0] = state[0] + 0.2;
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(op.ambient_box_count, 5);
        assert_eq!(op.cover_box_indices, vec![1, 2, 3, 4]);
        assert_eq!(op.seed_box_index, 1);
        assert_eq!(op.total_boxes, 4);
        assert_eq!(op.target_indices, vec![1, 2, 3]);
        assert_eq!(op.zero_survivor_sources, 1);
    }

    #[test]
    fn a_degenerate_axis_selects_its_single_cell() {
        assert_eq!(box_index(&[2.0], &[(2.0, 2.0)], &[1]), Some(0));
        assert_eq!(box_index(&[2.1], &[(2.0, 2.0)], &[1]), None);
        assert_eq!(box_index(&[2.0], &[(2.0, 2.0)], &[2]), None);

        let sample = stratified_cell_sample(&[(2.0, 2.0)], &[1], 0, 0, 1).unwrap();
        assert_eq!(sample, vec![2.0]);
    }

    #[test]
    fn lorenz_flow_grows_from_the_selected_positive_equilibrium() {
        let rho = 28.0;
        let sigma = 10.0;
        let beta = 0.4;
        let equilibrium_coordinate = (beta * (rho - 1.0_f64)).sqrt();
        let starting_point = [equilibrium_coordinate, equilibrium_coordinate, rho - 1.0];
        let bounds = [(-30.0, 30.0), (-30.0, 30.0), (-5.0, 55.0)];
        let resolution = [64, 64, 64];
        let seed_box_index = box_index(&starting_point, &bounds, &resolution).unwrap();
        let op = sampled_box_transition_operator_on_grown_cover_with_axis_names_and_step(
            3,
            &bounds,
            &resolution,
            2,
            1,
            &["x".to_string(), "y".to_string(), "z".to_string()],
            seed_box_index,
            |_, _, _, state, out| {
                let mut current = [state[0], state[1], state[2]];
                for _ in 0..100 {
                    current = lorenz_rk4_step(current, 0.01, sigma, rho, beta);
                }
                out.copy_from_slice(&current);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(op.seed_box_index, seed_box_index);
        assert!(op.cover_box_indices.contains(&seed_box_index));
        assert!(op.total_boxes > 1);
        assert!(op.total_boxes < op.ambient_box_count);
        for source in 0..op.total_boxes {
            let sum: f64 = op.probabilities
                [op.column_offsets[source]..op.column_offsets[source + 1]]
                .iter()
                .sum();
            assert!(sum == 0.0 || (sum - 1.0).abs() < 1.0e-12);
        }
    }

    fn lorenz_rk4_step(state: [f64; 3], dt: f64, sigma: f64, rho: f64, beta: f64) -> [f64; 3] {
        fn derivative(state: [f64; 3], sigma: f64, rho: f64, beta: f64) -> [f64; 3] {
            [
                sigma * (state[1] - state[0]),
                state[0] * (rho - state[2]) - state[1],
                state[0] * state[1] - beta * state[2],
            ]
        }

        let k1 = derivative(state, sigma, rho, beta);
        let at = |scale: f64, increment: [f64; 3]| {
            [
                state[0] + scale * increment[0],
                state[1] + scale * increment[1],
                state[2] + scale * increment[2],
            ]
        };
        let k2 = derivative(at(dt / 2.0, k1), sigma, rho, beta);
        let k3 = derivative(at(dt / 2.0, k2), sigma, rho, beta);
        let k4 = derivative(at(dt, k3), sigma, rho, beta);
        [
            state[0] + dt * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]) / 6.0,
            state[1] + dt * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]) / 6.0,
            state[2] + dt * (k1[2] + 2.0 * k2[2] + 2.0 * k3[2] + k4[2]) / 6.0,
        ]
    }
}
