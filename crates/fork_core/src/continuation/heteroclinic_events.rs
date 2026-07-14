//! Event functions for a connection between two distinct hyperbolic equilibria.
//!
//! Unlike a homoclinic orbit, a heteroclinic connection has independent
//! source and target spectra. The diagnostics in this module never combine
//! those spectra into one-saddle HBK labels.

use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

pub const DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE: f64 = 1.0e-5;
const CENTER_TOLERANCE: f64 = 1.0e-8;
const MIN_ADJOINT_VECTOR_NORM: f64 = 1.0e-13;
const MIN_ADJOINT_PAIRING: f64 = 1.0e-10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HeteroclinicEventKind {
    /// A source eigenvalue reaches the imaginary axis.
    #[serde(rename = "SHL")]
    SourceHyperbolicityLoss,
    /// A target eigenvalue reaches the imaginary axis.
    #[serde(rename = "THL")]
    TargetHyperbolicityLoss,
    /// The weak source-unstable real mode and complex pair exchange dominance.
    #[serde(rename = "SLC")]
    SourceLeadingCollision,
    /// The weak target-stable real mode and complex pair exchange dominance.
    #[serde(rename = "TLC")]
    TargetLeadingCollision,
    /// The connection loses its weak real source-unstable component.
    #[serde(rename = "SOF")]
    SourceOrbitFlip,
    /// The connection loses its weak real target-stable component.
    #[serde(rename = "TOF")]
    TargetOrbitFlip,
    /// A neutral-saddle-style cross-endpoint resonance is not intrinsic to a
    /// single open connection.
    #[serde(rename = "XRS")]
    CrossEndpointResonance,
    /// Source inclination-flip test (not yet implemented).
    #[serde(rename = "SIF")]
    SourceInclinationFlip,
    /// Target inclination-flip test (not yet implemented).
    #[serde(rename = "TIF")]
    TargetInclinationFlip,
}

impl HeteroclinicEventKind {
    pub const ALL: [Self; 9] = [
        Self::SourceHyperbolicityLoss,
        Self::TargetHyperbolicityLoss,
        Self::SourceLeadingCollision,
        Self::TargetLeadingCollision,
        Self::SourceOrbitFlip,
        Self::TargetOrbitFlip,
        Self::CrossEndpointResonance,
        Self::SourceInclinationFlip,
        Self::TargetInclinationFlip,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Self::SourceHyperbolicityLoss => "SHL",
            Self::TargetHyperbolicityLoss => "THL",
            Self::SourceLeadingCollision => "SLC",
            Self::TargetLeadingCollision => "TLC",
            Self::SourceOrbitFlip => "SOF",
            Self::TargetOrbitFlip => "TOF",
            Self::CrossEndpointResonance => "XRS",
            Self::SourceInclinationFlip => "SIF",
            Self::TargetInclinationFlip => "TIF",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::SourceHyperbolicityLoss => "Source hyperbolicity loss",
            Self::TargetHyperbolicityLoss => "Target hyperbolicity loss",
            Self::SourceLeadingCollision => "Source leading-spectrum collision",
            Self::TargetLeadingCollision => "Target leading-spectrum collision",
            Self::SourceOrbitFlip => "Source orbit flip",
            Self::TargetOrbitFlip => "Target orbit flip",
            Self::CrossEndpointResonance => "Cross-endpoint resonance",
            Self::SourceInclinationFlip => "Source inclination flip",
            Self::TargetInclinationFlip => "Target inclination flip",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeteroclinicEventStatus {
    Available,
    Unavailable,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicEventValue {
    pub kind: HeteroclinicEventKind,
    pub name: String,
    pub value: Option<f64>,
    pub status: HeteroclinicEventStatus,
    pub reason: Option<String>,
}

impl HeteroclinicEventValue {
    fn available(kind: HeteroclinicEventKind, value: f64) -> Self {
        if !value.is_finite() {
            return Self::unavailable(kind, "the test-function value is non-finite");
        }
        Self {
            kind,
            name: kind.name().to_owned(),
            value: Some(value),
            status: HeteroclinicEventStatus::Available,
            reason: None,
        }
    }

    fn unavailable(kind: HeteroclinicEventKind, reason: impl Into<String>) -> Self {
        Self {
            kind,
            name: kind.name().to_owned(),
            value: None,
            status: HeteroclinicEventStatus::Unavailable,
            reason: Some(reason.into()),
        }
    }

    fn unsupported(kind: HeteroclinicEventKind, reason: impl Into<String>) -> Self {
        Self {
            kind,
            name: kind.name().to_owned(),
            value: None,
            status: HeteroclinicEventStatus::Unsupported,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicEndpointFlipData {
    pub endpoint_displacement: Vec<f64>,
    pub leading_adjoint_eigenvector: Vec<Complex<f64>>,
    pub leading_eigenvalue: Complex<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicOrbitFlipData {
    pub source: Option<HeteroclinicEndpointFlipData>,
    pub target: Option<HeteroclinicEndpointFlipData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicEventDiagnostics {
    pub events: Vec<HeteroclinicEventValue>,
    pub source_eigenvalues: Vec<Complex<f64>>,
    pub target_eigenvalues: Vec<Complex<f64>>,
    pub source_stable_dimension: usize,
    pub source_unstable_dimension: usize,
    pub target_stable_dimension: usize,
    pub target_unstable_dimension: usize,
    pub source_discarded_eigenvalues: usize,
    pub target_discarded_eigenvalues: usize,
}

impl HeteroclinicEventDiagnostics {
    pub fn event(&self, kind: HeteroclinicEventKind) -> &HeteroclinicEventValue {
        self.events
            .iter()
            .find(|event| event.kind == kind)
            .expect("all heteroclinic event kinds are always present")
    }
}

/// Construct independent source-departure and target-arrival adjoint data.
/// Failure on one endpoint disables only that endpoint's orbit-flip channel.
pub fn build_heteroclinic_orbit_flip_data(
    source_jacobian: &DMatrix<f64>,
    source_eigenvalues: &[Complex<f64>],
    source_endpoint_displacement: Vec<f64>,
    target_jacobian: &DMatrix<f64>,
    target_eigenvalues: &[Complex<f64>],
    target_endpoint_displacement: Vec<f64>,
) -> HeteroclinicOrbitFlipData {
    let source = leading_side_eigenvalue(source_eigenvalues, false).and_then(|eigenvalue| {
        endpoint_flip_data(source_jacobian, eigenvalue, source_endpoint_displacement).ok()
    });
    let target = leading_side_eigenvalue(target_eigenvalues, true).and_then(|eigenvalue| {
        endpoint_flip_data(target_jacobian, eigenvalue, target_endpoint_displacement).ok()
    });
    HeteroclinicOrbitFlipData { source, target }
}

pub fn compute_heteroclinic_event_diagnostics(
    source_eigenvalues: &[Complex<f64>],
    target_eigenvalues: &[Complex<f64>],
    orbit_flip: Option<&HeteroclinicOrbitFlipData>,
    focus_tolerance: f64,
) -> HeteroclinicEventDiagnostics {
    let focus_tolerance = if focus_tolerance.is_finite() && focus_tolerance >= 0.0 {
        focus_tolerance
    } else {
        DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE
    };
    let (source, source_discarded_eigenvalues) = finite_spectrum(source_eigenvalues);
    let (target, target_discarded_eigenvalues) = finite_spectrum(target_eigenvalues);

    let source_stable_dimension = source
        .iter()
        .filter(|value| value.re < -CENTER_TOLERANCE)
        .count();
    let source_unstable_dimension = source
        .iter()
        .filter(|value| value.re > CENTER_TOLERANCE)
        .count();
    let target_stable_dimension = target
        .iter()
        .filter(|value| value.re < -CENTER_TOLERANCE)
        .count();
    let target_unstable_dimension = target
        .iter()
        .filter(|value| value.re > CENTER_TOLERANCE)
        .count();

    let source_center = nearest_center_mode(&source);
    let target_center = nearest_center_mode(&target);
    let source_real = leading_mode(&source, false, false, focus_tolerance);
    let source_focus = leading_mode(&source, false, true, focus_tolerance);
    let target_real = leading_mode(&target, true, false, focus_tolerance);
    let target_focus = leading_mode(&target, true, true, focus_tolerance);

    let mut events = Vec::with_capacity(HeteroclinicEventKind::ALL.len());
    events.push(match source_center {
        Some(value) => HeteroclinicEventValue::available(
            HeteroclinicEventKind::SourceHyperbolicityLoss,
            value.re,
        ),
        None => HeteroclinicEventValue::unavailable(
            HeteroclinicEventKind::SourceHyperbolicityLoss,
            "the source spectrum has no finite eigenvalue",
        ),
    });
    events.push(match target_center {
        Some(value) => HeteroclinicEventValue::available(
            HeteroclinicEventKind::TargetHyperbolicityLoss,
            value.re,
        ),
        None => HeteroclinicEventValue::unavailable(
            HeteroclinicEventKind::TargetHyperbolicityLoss,
            "the target spectrum has no finite eigenvalue",
        ),
    });
    events.push(match source_real.zip(source_focus) {
        Some((real, focus)) => HeteroclinicEventValue::available(
            HeteroclinicEventKind::SourceLeadingCollision,
            real.re - focus.re,
        ),
        None => HeteroclinicEventValue::unavailable(
            HeteroclinicEventKind::SourceLeadingCollision,
            "requires both a real mode and a complex pair in the source unstable spectrum",
        ),
    });
    events.push(match target_real.zip(target_focus) {
        Some((real, focus)) => HeteroclinicEventValue::available(
            HeteroclinicEventKind::TargetLeadingCollision,
            real.re - focus.re,
        ),
        None => HeteroclinicEventValue::unavailable(
            HeteroclinicEventKind::TargetLeadingCollision,
            "requires both a real mode and a complex pair in the target stable spectrum",
        ),
    });
    events.push(endpoint_orbit_flip_event(
        HeteroclinicEventKind::SourceOrbitFlip,
        orbit_flip.and_then(|data| data.source.as_ref()),
        focus_tolerance,
    ));
    events.push(endpoint_orbit_flip_event(
        HeteroclinicEventKind::TargetOrbitFlip,
        orbit_flip.and_then(|data| data.target.as_ref()),
        focus_tolerance,
    ));
    events.push(HeteroclinicEventValue::unsupported(
        HeteroclinicEventKind::CrossEndpointResonance,
        "a neutral-saddle resonance is defined at one saddle; a single open two-equilibrium connection has no intrinsic cross-endpoint analogue",
    ));
    events.push(HeteroclinicEventValue::unsupported(
        HeteroclinicEventKind::SourceInclinationFlip,
        "a source inclination-flip test requires transported tangent-space orientation data that are not implemented",
    ));
    events.push(HeteroclinicEventValue::unsupported(
        HeteroclinicEventKind::TargetInclinationFlip,
        "a target inclination-flip test requires transported tangent-space orientation data that are not implemented",
    ));

    debug_assert_eq!(
        events.iter().map(|event| event.kind).collect::<Vec<_>>(),
        HeteroclinicEventKind::ALL
    );
    HeteroclinicEventDiagnostics {
        events,
        source_eigenvalues: source,
        target_eigenvalues: target,
        source_stable_dimension,
        source_unstable_dimension,
        target_stable_dimension,
        target_unstable_dimension,
        source_discarded_eigenvalues,
        target_discarded_eigenvalues,
    }
}

fn finite_spectrum(values: &[Complex<f64>]) -> (Vec<Complex<f64>>, usize) {
    let finite = values
        .iter()
        .copied()
        .filter(|value| complex_is_finite(*value))
        .collect::<Vec<_>>();
    let discarded = values.len().saturating_sub(finite.len());
    (finite, discarded)
}

fn nearest_center_mode(values: &[Complex<f64>]) -> Option<Complex<f64>> {
    values.iter().copied().min_by(|left, right| {
        left.re
            .abs()
            .total_cmp(&right.re.abs())
            .then_with(|| left.im.abs().total_cmp(&right.im.abs()))
    })
}

fn leading_mode(
    values: &[Complex<f64>],
    stable: bool,
    focus: bool,
    focus_tolerance: f64,
) -> Option<Complex<f64>> {
    let candidates = values.iter().copied().filter(|value| {
        let on_side = if stable {
            value.re < -CENTER_TOLERANCE
        } else {
            value.re > CENTER_TOLERANCE
        };
        let has_focus = value.im.abs() >= focus_tolerance;
        // Keep only one representative of a conjugate pair.
        on_side && has_focus == focus && (!focus || value.im > 0.0)
    });
    if stable {
        candidates.max_by(|left, right| left.re.total_cmp(&right.re))
    } else {
        candidates.min_by(|left, right| left.re.total_cmp(&right.re))
    }
}

fn leading_side_eigenvalue(eigenvalues: &[Complex<f64>], stable: bool) -> Option<Complex<f64>> {
    let candidates = eigenvalues.iter().copied().filter(|value| {
        complex_is_finite(*value)
            && if stable {
                value.re < -CENTER_TOLERANCE
            } else {
                value.re > CENTER_TOLERANCE
            }
    });
    if stable {
        candidates.max_by(|left, right| left.re.total_cmp(&right.re))
    } else {
        candidates.min_by(|left, right| left.re.total_cmp(&right.re))
    }
}

fn endpoint_orbit_flip_event(
    kind: HeteroclinicEventKind,
    data: Option<&HeteroclinicEndpointFlipData>,
    focus_tolerance: f64,
) -> HeteroclinicEventValue {
    let Some(data) = data else {
        return HeteroclinicEventValue::unavailable(
            kind,
            "endpoint displacement or adjoint leading-mode data are unavailable",
        );
    };
    if data.leading_eigenvalue.im.abs() >= focus_tolerance {
        return HeteroclinicEventValue::unavailable(
            kind,
            "a scalar orbit-flip test requires a simple real leading eigenvalue",
        );
    }
    if data.endpoint_displacement.len() != data.leading_adjoint_eigenvector.len()
        || data.endpoint_displacement.is_empty()
    {
        return HeteroclinicEventValue::unavailable(
            kind,
            "endpoint displacement and adjoint eigenvector dimensions do not match",
        );
    }
    let Some(adjoint) = phase_oriented(&data.leading_adjoint_eigenvector) else {
        return HeteroclinicEventValue::unavailable(kind, "the adjoint eigenvector is degenerate");
    };
    let value = adjoint
        .iter()
        .zip(&data.endpoint_displacement)
        .map(|(adjoint, displacement)| adjoint.re * displacement)
        .sum();
    HeteroclinicEventValue::available(kind, value)
}

fn endpoint_flip_data(
    jacobian: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
    endpoint_displacement: Vec<f64>,
) -> Result<HeteroclinicEndpointFlipData> {
    let right = complex_eigenvector(jacobian, eigenvalue)?;
    let mut adjoint = complex_eigenvector(&jacobian.transpose(), eigenvalue.conj())?;
    let pairing = hermitian_inner(&adjoint, &right);
    if !complex_is_finite(pairing) || pairing.norm() <= MIN_ADJOINT_PAIRING {
        bail!("Heteroclinic leading left/right eigenvector pairing is singular");
    }
    adjoint /= pairing.conj();
    Ok(HeteroclinicEndpointFlipData {
        endpoint_displacement,
        leading_adjoint_eigenvector: adjoint.iter().copied().collect(),
        leading_eigenvalue: eigenvalue,
    })
}

fn complex_eigenvector(
    matrix: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<DVector<Complex<f64>>> {
    if matrix.nrows() == 0 || matrix.nrows() != matrix.ncols() {
        bail!("Heteroclinic adjoint eigensolve requires a non-empty square matrix");
    }
    let dimension = matrix.nrows();
    let mut shifted = matrix.map(|value| Complex::new(value, 0.0));
    for index in 0..dimension {
        shifted[(index, index)] -= eigenvalue;
    }
    let decomposition = shifted.svd(false, true);
    let v_t = decomposition
        .v_t
        .ok_or_else(|| anyhow!("Heteroclinic adjoint eigensolve omitted singular vectors"))?;
    let row = v_t.nrows() - 1;
    let mut vector = DVector::from_iterator(
        dimension,
        (0..dimension).map(|column| v_t[(row, column)].conj()),
    );
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_ADJOINT_VECTOR_NORM {
        bail!("Heteroclinic adjoint eigenvector is degenerate");
    }
    vector /= Complex::new(norm, 0.0);
    Ok(vector)
}

fn hermitian_inner(left: &DVector<Complex<f64>>, right: &DVector<Complex<f64>>) -> Complex<f64> {
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| left.conj() * right)
        .sum()
}

fn phase_oriented(values: &[Complex<f64>]) -> Option<Vec<Complex<f64>>> {
    let (pivot_index, pivot_norm) = values
        .iter()
        .enumerate()
        .map(|(index, value)| (index, value.norm()))
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| right.0.cmp(&left.0))
        })?;
    if pivot_norm == 0.0 || !pivot_norm.is_finite() {
        return None;
    }
    let phase = values[pivot_index].conj() / pivot_norm;
    let oriented = values
        .iter()
        .map(|value| *value * phase)
        .collect::<Vec<_>>();
    oriented
        .iter()
        .all(|value| complex_is_finite(*value))
        .then_some(oriented)
}

fn complex_is_finite(value: Complex<f64>) -> bool {
    value.re.is_finite() && value.im.is_finite()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(re: f64, im: f64) -> Complex<f64> {
        Complex::new(re, im)
    }

    #[test]
    fn endpoint_spectra_remain_independent_and_unsupported_channels_are_explicit() {
        let diagnostics = compute_heteroclinic_event_diagnostics(
            &[c(1.0, 0.0), c(2.0, 1.0), c(2.0, -1.0), c(-3.0, 0.0)],
            &[c(-1.0, 0.0), c(-2.0, 1.0), c(-2.0, -1.0), c(4.0, 0.0)],
            None,
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert_eq!(diagnostics.source_unstable_dimension, 3);
        assert_eq!(diagnostics.target_stable_dimension, 3);
        assert_eq!(
            diagnostics
                .event(HeteroclinicEventKind::SourceLeadingCollision)
                .value,
            Some(-1.0)
        );
        assert_eq!(
            diagnostics
                .event(HeteroclinicEventKind::TargetLeadingCollision)
                .value,
            Some(1.0)
        );
        for kind in [
            HeteroclinicEventKind::CrossEndpointResonance,
            HeteroclinicEventKind::SourceInclinationFlip,
            HeteroclinicEventKind::TargetInclinationFlip,
        ] {
            let event = diagnostics.event(kind);
            assert_eq!(event.status, HeteroclinicEventStatus::Unsupported);
            assert_eq!(event.value, None);
            assert!(event
                .reason
                .as_deref()
                .is_some_and(|reason| !reason.is_empty()));
        }
    }

    #[test]
    fn real_endpoint_orbit_flip_uses_each_endpoints_own_adjoint_mode() {
        let source_jacobian = DMatrix::from_diagonal(&DVector::from_vec(vec![1.0, -2.0]));
        let target_jacobian = DMatrix::from_diagonal(&DVector::from_vec(vec![-3.0, 4.0]));
        let flip = build_heteroclinic_orbit_flip_data(
            &source_jacobian,
            &[c(1.0, 0.0), c(-2.0, 0.0)],
            vec![0.25, 9.0],
            &target_jacobian,
            &[c(-3.0, 0.0), c(4.0, 0.0)],
            vec![0.75, 8.0],
        );
        let diagnostics = compute_heteroclinic_event_diagnostics(
            &[c(1.0, 0.0), c(-2.0, 0.0)],
            &[c(-3.0, 0.0), c(4.0, 0.0)],
            Some(&flip),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert!(
            (diagnostics
                .event(HeteroclinicEventKind::SourceOrbitFlip)
                .value
                .unwrap()
                - 0.25)
                .abs()
                < 1.0e-12
        );
        assert!(
            (diagnostics
                .event(HeteroclinicEventKind::TargetOrbitFlip)
                .value
                .unwrap()
                - 0.75)
                .abs()
                < 1.0e-12
        );
    }
}
