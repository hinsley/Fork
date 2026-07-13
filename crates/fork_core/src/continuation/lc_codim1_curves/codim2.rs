use anyhow::{bail, Result};
use num_complex::Complex;

use crate::continuation::periodic::{validated_normalized_mesh, LimitCycleGuess, LimitCycleSetup};
use crate::continuation::periodic_normal_forms::{
    PeriodicOrbitNormalFormConditioning, PeriodicOrbitNormalFormSettings,
};
use crate::continuation::Codim2Coefficient;
use crate::equation_engine::EquationSystem;
use crate::traits::DynamicalSystem;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TrackedCycleMultiplier {
    PlusOne,
    MinusOne,
    UnitPair { cosine: f64 },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SecondaryCycleTests {
    pub plus_one: f64,
    pub minus_one: f64,
    pub unit_pair: f64,
    pub remaining_multipliers: Vec<Complex<f64>>,
}

pub(crate) fn curve_normal_form_settings(
    mesh_points: usize,
    collocation_degree: usize,
) -> PeriodicOrbitNormalFormSettings {
    PeriodicOrbitNormalFormSettings {
        // Curve localization evaluates the coefficient repeatedly.  Resolve
        // every collocation subinterval by at least eight fifth-order steps while
        // retaining a substantial floor for low-order meshes. The local map
        // is evaluated repeatedly during codimension-two refinement; 128 RK5
        // steps already put the smooth analytic suspension error below the
        // curve locator's 1e-4 scale.
        integration_steps: (mesh_points * collocation_degree * 8).clamp(128, 2_048),
        ..PeriodicOrbitNormalFormSettings::default()
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn limit_cycle_setup_from_profile(
    system: &mut EquationSystem,
    param1_index: usize,
    param2_index: usize,
    param1: f64,
    param2: f64,
    period: f64,
    mesh_states: Vec<Vec<f64>>,
    stage_states: Vec<Vec<Vec<f64>>>,
    collocation_degree: usize,
    normalized_mesh: &[f64],
) -> Result<LimitCycleSetup> {
    let mesh_points = stage_states.len();
    let dimension = system.equations.len();
    if mesh_points < 2
        || collocation_degree == 0
        || mesh_states.len() != mesh_points
        || mesh_states.iter().any(|state| state.len() != dimension)
        || stage_states.iter().any(|interval| {
            interval.len() != collocation_degree
                || interval.iter().any(|state| state.len() != dimension)
        })
    {
        bail!("Cannot reconstruct a periodic normal-form setup from the collocation profile");
    }
    if !period.is_finite() || period <= 0.0 {
        bail!("Periodic normal-form setup requires a finite positive period");
    }
    let normalized_mesh = validated_normalized_mesh(mesh_points, normalized_mesh)?;
    system.params[param1_index] = param1;
    system.params[param2_index] = param2;
    let phase_anchor = mesh_states[0].clone();
    let mut phase_direction = vec![0.0; dimension];
    system.apply(0.0, &phase_anchor, &mut phase_direction);
    let phase_norm = phase_direction
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    if !phase_norm.is_finite() || phase_norm <= 1e-12 {
        bail!("Periodic normal-form setup has a singular flow phase direction");
    }
    for value in &mut phase_direction {
        *value /= phase_norm;
    }

    Ok(LimitCycleSetup {
        guess: LimitCycleGuess {
            param_value: param1,
            period,
            mesh_states,
            stage_states,
            requires_fixed_parameter_correction: true,
        },
        phase_anchor,
        phase_direction,
        mesh_points,
        collocation_degree,
        normalized_mesh,
    })
}

pub(crate) fn secondary_cycle_tests(
    multipliers: &[Complex<f64>],
    tracked: TrackedCycleMultiplier,
) -> Result<SecondaryCycleTests> {
    if multipliers.is_empty()
        || multipliers
            .iter()
            .any(|value| !value.re.is_finite() || !value.im.is_finite())
    {
        bail!("Cycle codimension-two tests require a finite Floquet spectrum");
    }

    let mut retained = (0..multipliers.len()).collect::<Vec<_>>();
    let trivial = closest_index(multipliers, &retained, Complex::new(1.0, 0.0))?;
    if (multipliers[trivial] - Complex::new(1.0, 0.0)).norm() > 1e-2 {
        bail!("Cycle codimension-two tests could not identify the autonomous +1 multiplier");
    }
    retained.retain(|index| *index != trivial);

    match tracked {
        TrackedCycleMultiplier::PlusOne => {
            let index = closest_index(multipliers, &retained, Complex::new(1.0, 0.0))?;
            if (multipliers[index] - Complex::new(1.0, 0.0)).norm() > 5e-2 {
                bail!("LPC spectrum does not contain its tracked nontrivial +1 multiplier");
            }
            retained.retain(|candidate| *candidate != index);
        }
        TrackedCycleMultiplier::MinusOne => {
            let index = closest_index(multipliers, &retained, Complex::new(-1.0, 0.0))?;
            if (multipliers[index] - Complex::new(-1.0, 0.0)).norm() > 5e-2 {
                bail!("PD spectrum does not contain its tracked -1 multiplier");
            }
            retained.retain(|candidate| *candidate != index);
        }
        TrackedCycleMultiplier::UnitPair { cosine } => {
            if !cosine.is_finite() || !(-1.0..=1.0).contains(&cosine) {
                bail!("NS tracked cosine must be finite and lie in [-1, 1]");
            }
            let sine = (1.0 - cosine * cosine).max(0.0).sqrt();
            let positive = Complex::new(cosine, sine);
            let negative = positive.conj();
            let (first, second, distance) =
                closest_pair(multipliers, &retained, positive, negative)?;
            if distance > 0.1 {
                bail!("NS spectrum does not contain the unit pair selected by its angle");
            }
            retained.retain(|candidate| *candidate != first && *candidate != second);
        }
    }

    let remaining_multipliers = retained
        .iter()
        .map(|index| multipliers[*index])
        .collect::<Vec<_>>();
    let plus_one = real_multiplier_product(&remaining_multipliers, 1.0);
    let minus_one = real_multiplier_product(&remaining_multipliers, -1.0);
    let unit_pair = conjugate_unit_pair_product(&remaining_multipliers)?;
    Ok(SecondaryCycleTests {
        plus_one,
        minus_one,
        unit_pair,
        remaining_multipliers,
    })
}

pub(crate) fn secondary_spectral_coefficients(
    tests: &SecondaryCycleTests,
) -> Vec<Codim2Coefficient> {
    let plus_one_distance = tests
        .remaining_multipliers
        .iter()
        .map(|value| (*value - Complex::new(1.0, 0.0)).norm())
        .fold(f64::MAX, f64::min);
    let minus_one_distance = tests
        .remaining_multipliers
        .iter()
        .map(|value| (*value + Complex::new(1.0, 0.0)).norm())
        .fold(f64::MAX, f64::min);
    let mut unit_pair_residual = f64::MAX;
    let mut unit_pair_cosine = 0.0;
    for (first, second) in nonreal_conjugate_pairs(&tests.remaining_multipliers).unwrap_or_default()
    {
        let residual = (first.norm_sqr() - 1.0).abs();
        if residual < unit_pair_residual {
            unit_pair_residual = residual;
            unit_pair_cosine = 0.5 * (first.re + second.re);
        }
    }
    vec![
        Codim2Coefficient {
            name: "secondary_plus_one_test".to_string(),
            value: tests.plus_one,
        },
        Codim2Coefficient {
            name: "secondary_minus_one_test".to_string(),
            value: tests.minus_one,
        },
        Codim2Coefficient {
            name: "secondary_unit_pair_test".to_string(),
            value: tests.unit_pair,
        },
        Codim2Coefficient {
            name: "closest_secondary_plus_one_distance".to_string(),
            value: plus_one_distance,
        },
        Codim2Coefficient {
            name: "closest_secondary_minus_one_distance".to_string(),
            value: minus_one_distance,
        },
        Codim2Coefficient {
            name: "closest_secondary_complex_unit_pair_residual".to_string(),
            value: unit_pair_residual,
        },
        Codim2Coefficient {
            name: "secondary_unit_pair_cosine".to_string(),
            value: unit_pair_cosine.clamp(-1.0, 1.0),
        },
    ]
}

pub(crate) fn append_return_map_conditioning(
    coefficients: &mut Vec<Codim2Coefficient>,
    conditioning: PeriodicOrbitNormalFormConditioning,
) {
    coefficients.extend(
        [
            ("return_map_residual", conditioning.return_map_residual),
            ("section_residual", conditioning.section_residual),
            (
                "return_time_correction",
                conditioning.return_time_correction,
            ),
            (
                "section_transversality",
                conditioning.section_transversality,
            ),
            ("eigenvector_pairing", conditioning.eigenvector_pairing),
            ("right_eigen_residual", conditioning.right_residual),
            ("left_eigen_residual", conditioning.left_residual),
            ("homological_residual", conditioning.homological_residual),
        ]
        .into_iter()
        .map(|(name, value)| Codim2Coefficient {
            name: name.to_string(),
            value,
        }),
    );
}

fn closest_index(
    multipliers: &[Complex<f64>],
    retained: &[usize],
    target: Complex<f64>,
) -> Result<usize> {
    retained
        .iter()
        .copied()
        .min_by(|left, right| {
            (multipliers[*left] - target)
                .norm()
                .total_cmp(&(multipliers[*right] - target).norm())
        })
        .ok_or_else(|| anyhow::anyhow!("Floquet spectrum is missing a tracked multiplier"))
}

fn closest_pair(
    multipliers: &[Complex<f64>],
    retained: &[usize],
    first_target: Complex<f64>,
    second_target: Complex<f64>,
) -> Result<(usize, usize, f64)> {
    let mut best = None;
    for &first in retained {
        for &second in retained {
            if first == second {
                continue;
            }
            let distance = (multipliers[first] - first_target).norm()
                + (multipliers[second] - second_target).norm();
            if best.is_none_or(|(_, _, best_distance)| distance < best_distance) {
                best = Some((first, second, distance));
            }
        }
    }
    best.ok_or_else(|| anyhow::anyhow!("Floquet spectrum is missing a tracked multiplier pair"))
}

fn saturated_product(accumulator: f64, factor: f64) -> f64 {
    let value = accumulator * factor;
    if value.is_finite() {
        value
    } else {
        f64::MAX.copysign(accumulator.signum() * factor.signum())
    }
}

fn real_multiplier_product(multipliers: &[Complex<f64>], target: f64) -> f64 {
    multipliers.iter().fold(1.0, |product, multiplier| {
        let tolerance = 1e-8 * multiplier.norm().max(1.0);
        if multiplier.im.abs() <= tolerance {
            saturated_product(product, multiplier.re - target)
        } else {
            product
        }
    })
}

fn conjugate_unit_pair_product(multipliers: &[Complex<f64>]) -> Result<f64> {
    let pairs = nonreal_conjugate_pairs(multipliers)?;
    if pairs.is_empty() {
        return Ok(1.0);
    }
    Ok(pairs.into_iter().fold(1.0, |product, (value, _)| {
        saturated_product(product, value.norm_sqr() - 1.0)
    }))
}

fn nonreal_conjugate_pairs(
    multipliers: &[Complex<f64>],
) -> Result<Vec<(Complex<f64>, Complex<f64>)>> {
    let mut negative_used = vec![false; multipliers.len()];
    let mut pairs = Vec::new();
    for (index, value) in multipliers.iter().copied().enumerate() {
        let real_tolerance = 1e-8 * value.norm().max(1.0);
        if value.im <= real_tolerance {
            continue;
        }
        let target = value.conj();
        let Some((partner_index, partner_distance)) = multipliers
            .iter()
            .enumerate()
            .filter(|(candidate_index, candidate)| {
                !negative_used[*candidate_index]
                    && candidate.im < -real_tolerance
                    && *candidate_index != index
            })
            .map(|(candidate_index, candidate)| (candidate_index, (*candidate - target).norm()))
            .min_by(|left, right| left.1.total_cmp(&right.1))
        else {
            bail!("Floquet spectrum has an unmatched nonreal multiplier");
        };
        let tolerance = 1e-6 * value.norm().max(1.0);
        if partner_distance > tolerance {
            bail!("Floquet spectrum is not closed under complex conjugation");
        }
        negative_used[partner_index] = true;
        pairs.push((value, multipliers[partner_index]));
    }
    for (index, value) in multipliers.iter().enumerate() {
        let real_tolerance = 1e-8 * value.norm().max(1.0);
        if value.im < -real_tolerance && !negative_used[index] {
            bail!("Floquet spectrum has an unmatched nonreal multiplier");
        }
    }
    Ok(pairs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(re: f64, im: f64) -> Complex<f64> {
        Complex::new(re, im)
    }

    #[test]
    fn lpc_secondary_tests_remove_trivial_and_tracked_plus_one() {
        let theta = 0.7_f64;
        let spectrum = [
            c(1.0, 0.0),
            c(1.0, 0.0),
            c(-0.75, 0.0),
            Complex::from_polar(0.9, theta),
            Complex::from_polar(0.9, -theta),
        ];
        let tests = secondary_cycle_tests(&spectrum, TrackedCycleMultiplier::PlusOne)
            .expect("secondary LPC spectrum");
        assert_eq!(tests.remaining_multipliers.len(), 3);
        assert!((tests.minus_one - 0.25).abs() < 1e-12);
        assert!(
            tests.unit_pair < 0.0,
            "stable complex pair must lie below NS"
        );
    }

    #[test]
    fn pd_secondary_tests_do_not_reuse_the_defining_minus_one_multiplier() {
        let spectrum = [c(1.0, 0.0), c(-1.0, 0.0), c(0.8, 0.0), c(0.6, 0.0)];
        let tests = secondary_cycle_tests(&spectrum, TrackedCycleMultiplier::MinusOne)
            .expect("secondary PD spectrum");
        assert_eq!(tests.remaining_multipliers, vec![c(0.8, 0.0), c(0.6, 0.0)]);
        assert!((tests.plus_one - 0.08).abs() < 1e-12);
        assert_eq!(tests.unit_pair, 1.0);
    }

    #[test]
    fn reciprocal_real_multipliers_are_not_a_neimark_sacker_pair() {
        let spectrum = [c(1.0, 0.0), c(-1.0, 0.0), c(2.0, 0.0), c(0.5, 0.0)];
        let tests = secondary_cycle_tests(&spectrum, TrackedCycleMultiplier::MinusOne)
            .expect("real reciprocal spectrum");
        assert_eq!(tests.unit_pair, 1.0);
    }

    #[test]
    fn nonreal_conjugate_pair_has_a_signed_unit_modulus_test() {
        let theta = 0.6_f64;
        for (radius, expected_sign) in [(0.9, -1.0_f64), (1.1, 1.0_f64)] {
            let spectrum = [
                c(1.0, 0.0),
                c(-1.0, 0.0),
                Complex::from_polar(radius, theta),
                Complex::from_polar(radius, -theta),
            ];
            let tests = secondary_cycle_tests(&spectrum, TrackedCycleMultiplier::MinusOne)
                .expect("complex secondary spectrum");
            assert_eq!(tests.unit_pair.signum(), expected_sign);
        }
    }

    #[test]
    fn ns_secondary_tests_remove_the_pair_matching_the_continued_angle() {
        let tracked_theta = 0.8_f64;
        let secondary_theta = 1.2_f64;
        let spectrum = [
            c(1.0, 0.0),
            Complex::from_polar(1.0, tracked_theta),
            Complex::from_polar(1.0, -tracked_theta),
            Complex::from_polar(1.1, secondary_theta),
            Complex::from_polar(1.1, -secondary_theta),
            c(-0.7, 0.0),
        ];
        let tests = secondary_cycle_tests(
            &spectrum,
            TrackedCycleMultiplier::UnitPair {
                cosine: tracked_theta.cos(),
            },
        )
        .expect("secondary NS spectrum");
        assert_eq!(tests.remaining_multipliers.len(), 3);
        assert!(
            tests.unit_pair > 0.0,
            "outer pair must lie above secondary NS"
        );
        assert!((tests.minus_one - 0.3).abs() < 1e-12);
    }

    #[test]
    fn malformed_spectra_are_rejected_instead_of_emitting_placeholders() {
        let missing_trivial = [c(0.5, 0.0), c(-1.0, 0.0)];
        assert!(secondary_cycle_tests(&missing_trivial, TrackedCycleMultiplier::MinusOne).is_err());

        let missing_pair = [c(1.0, 0.0), c(0.8, 0.1), c(0.8, -0.1)];
        assert!(secondary_cycle_tests(
            &missing_pair,
            TrackedCycleMultiplier::UnitPair { cosine: 0.0 }
        )
        .is_err());
    }
}
