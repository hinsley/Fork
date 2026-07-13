//! Reconstruct limit-cycle setups from persisted collocation branch states.
//!
//! The persisted state layout is
//! `[ntst mesh states][ntst*ncol stage states][period]`.  Some historical
//! exports include the closing mesh state explicitly; that representation is
//! accepted as well, but the persistent normalized mesh is always required.

use super::periodic::{LimitCycleGuess, LimitCycleSetup};
use crate::equation_engine::EquationSystem;
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};

fn validate_persistent_mesh(normalized_mesh: &[f64]) -> Result<()> {
    if normalized_mesh.len() < 3 {
        bail!(
            "A persistent normalized mesh with at least two intervals is required; legacy branches without mesh metadata must be recontinued first"
        );
    }
    if normalized_mesh.iter().any(|value| !value.is_finite())
        || normalized_mesh[0].abs() > 1e-12
        || (normalized_mesh[normalized_mesh.len() - 1] - 1.0).abs() > 1e-12
        || normalized_mesh
            .windows(2)
            .any(|window| window[1] <= window[0])
    {
        bail!("Persistent normalized mesh must be finite, strictly increasing, and span [0, 1]");
    }
    Ok(())
}

/// Rebuild a complete [`LimitCycleSetup`] from a saved continuation point.
///
/// Unlike UI-side reconstruction, this preserves every collocation stage and
/// the exact nonuniform mesh.  The phase condition is anchored at the first
/// mesh state and uses the normalized flow vector `F(x0, p)`.
pub fn limit_cycle_setup_from_packed_state(
    system: &mut EquationSystem,
    param_index: usize,
    param_value: f64,
    packed_state: &[f64],
    collocation_degree: usize,
    normalized_mesh: Vec<f64>,
) -> Result<LimitCycleSetup> {
    validate_persistent_mesh(&normalized_mesh)?;
    if param_index >= system.params.len() {
        bail!("Packed limit-cycle source parameter index is out of bounds");
    }
    if !param_value.is_finite() {
        bail!("Packed limit-cycle source parameter must be finite");
    }
    if collocation_degree == 0 {
        bail!("Packed limit-cycle source collocation degree must be positive");
    }
    let state_dimension = system.equations.len();
    if state_dimension == 0 {
        bail!("Packed limit-cycle source has zero state dimension");
    }

    let mesh_points = normalized_mesh.len() - 1;
    let stage_count = mesh_points * collocation_degree;
    let implicit_length = (mesh_points + stage_count) * state_dimension + 1;
    let explicit_length = (mesh_points + 1 + stage_count) * state_dimension + 1;
    let explicit_closure = match packed_state.len() {
        length if length == implicit_length => false,
        length if length == explicit_length => true,
        length => bail!(
            "Packed limit-cycle source has length {length}; expected {implicit_length} or {explicit_length} for ntst={mesh_points}, ncol={collocation_degree}, dim={state_dimension}"
        ),
    };
    let period = packed_state[packed_state.len() - 1];
    if !period.is_finite() || period <= 0.0 {
        bail!("Packed limit-cycle source period must be positive and finite");
    }

    let mesh_count_in_state = mesh_points + usize::from(explicit_closure);
    let mut mesh_states = Vec::with_capacity(mesh_points);
    for mesh in 0..mesh_points {
        let start = mesh * state_dimension;
        mesh_states.push(packed_state[start..start + state_dimension].to_vec());
    }
    if explicit_closure {
        let closing_start = mesh_points * state_dimension;
        let closing = &packed_state[closing_start..closing_start + state_dimension];
        let closure_error = closing
            .iter()
            .zip(mesh_states[0].iter())
            .map(|(left, right)| (left - right) * (left - right))
            .sum::<f64>()
            .sqrt();
        if !closure_error.is_finite() || closure_error > 1e-6 {
            bail!("Explicit closing mesh state is inconsistent with the phase anchor");
        }
    }

    let stage_offset = mesh_count_in_state * state_dimension;
    let mut stage_states = vec![vec![vec![0.0; state_dimension]; collocation_degree]; mesh_points];
    for (interval, interval_states) in stage_states.iter_mut().enumerate() {
        for (stage, state) in interval_states.iter_mut().enumerate() {
            let flat_stage = interval * collocation_degree + stage;
            let start = stage_offset + flat_stage * state_dimension;
            state.copy_from_slice(&packed_state[start..start + state_dimension]);
        }
    }

    let phase_anchor = mesh_states[0].clone();
    let old_parameter = system.params[param_index];
    system.params[param_index] = param_value;
    let mut phase_direction = vec![0.0; state_dimension];
    system.apply(0.0, &phase_anchor, &mut phase_direction);
    system.params[param_index] = old_parameter;
    let phase_norm = phase_direction
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    if !phase_norm.is_finite() || phase_norm <= 1e-12 {
        bail!("Packed limit-cycle source has a singular vector-field phase direction");
    }
    for value in &mut phase_direction {
        *value /= phase_norm;
    }

    Ok(LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value,
            period,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: false,
        },
        phase_anchor,
        phase_direction,
        mesh_points,
        collocation_degree,
        normalized_mesh,
    })
}
