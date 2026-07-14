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
pub const DEFAULT_MAX_INCLINATION_TRANSPORT_RESIDUAL: f64 = 1.0e-6;
pub const INCLINATION_FRAME_REFRESH_ANGLE_THRESHOLD: f64 = std::f64::consts::PI / 9.0;
const CENTER_TOLERANCE: f64 = 1.0e-8;
const MIN_ADJOINT_VECTOR_NORM: f64 = 1.0e-13;
const MIN_ADJOINT_PAIRING: f64 = 1.0e-10;
const MIN_INCLINATION_FRAME_SINGULAR_VALUE: f64 = 1.0e-10;
const MIN_INCLINATION_PRINCIPAL_SEPARATION: f64 = 1.0e-6;

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

/// Caller-supplied variational transport data for one endpoint inclination
/// test. Frames are flattened column-major `ambient_dimension x frame_dimension`
/// matrices. Fork evaluates the signed overlap determinant; callers do not
/// supply an event scalar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicInclinationFrame {
    pub ambient_dimension: usize,
    pub frame_dimension: usize,
    pub transported_frame: Vec<f64>,
    pub reference_frame: Vec<f64>,
    pub minimum_overlap_singular_value: f64,
    pub relative_transport_residual: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HeteroclinicInclinationTransportDiagnostics {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<HeteroclinicInclinationFrame>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<HeteroclinicInclinationFrame>,
}

/// Build the serialized frame payload from nalgebra matrices without changing
/// their native column-major order.
pub fn heteroclinic_inclination_frame_from_matrices(
    transported_frame: &DMatrix<f64>,
    reference_frame: &DMatrix<f64>,
    minimum_overlap_singular_value: f64,
    relative_transport_residual: f64,
) -> Result<HeteroclinicInclinationFrame> {
    if transported_frame.shape() != reference_frame.shape() {
        bail!("inclination transported and reference frame dimensions differ");
    }
    let ambient_dimension = transported_frame.nrows();
    let frame_dimension = transported_frame.ncols();
    inclination_frame_matrix(
        transported_frame.as_slice(),
        ambient_dimension,
        frame_dimension,
        "transported",
    )?;
    inclination_frame_matrix(
        reference_frame.as_slice(),
        ambient_dimension,
        frame_dimension,
        "reference",
    )?;
    Ok(HeteroclinicInclinationFrame {
        ambient_dimension,
        frame_dimension,
        transported_frame: transported_frame.as_slice().to_vec(),
        reference_frame: reference_frame.as_slice().to_vec(),
        minimum_overlap_singular_value,
        relative_transport_residual,
    })
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inclination_transport: Option<HeteroclinicInclinationTransportDiagnostics>,
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
    compute_heteroclinic_event_diagnostics_with_inclination_transport(
        source_eigenvalues,
        target_eigenvalues,
        orbit_flip,
        None,
        focus_tolerance,
    )
}

/// Compute endpoint-local events and, when supplied by a collocation or
/// shooting transport implementation, source/target inclination tests.
pub fn compute_heteroclinic_event_diagnostics_with_inclination_transport(
    source_eigenvalues: &[Complex<f64>],
    target_eigenvalues: &[Complex<f64>],
    orbit_flip: Option<&HeteroclinicOrbitFlipData>,
    inclination_transport: Option<HeteroclinicInclinationTransportDiagnostics>,
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
    events.push(inclination_flip_event(
        HeteroclinicEventKind::SourceInclinationFlip,
        inclination_transport
            .as_ref()
            .and_then(|transport| transport.source.as_ref()),
        &source,
        &target,
        source_stable_dimension,
        source_unstable_dimension,
        target_stable_dimension,
        target_unstable_dimension,
        focus_tolerance,
    ));
    events.push(inclination_flip_event(
        HeteroclinicEventKind::TargetInclinationFlip,
        inclination_transport
            .as_ref()
            .and_then(|transport| transport.target.as_ref()),
        &source,
        &target,
        source_stable_dimension,
        source_unstable_dimension,
        target_stable_dimension,
        target_unstable_dimension,
        focus_tolerance,
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
        inclination_transport,
    }
}

fn inclination_flip_event(
    kind: HeteroclinicEventKind,
    frame: Option<&HeteroclinicInclinationFrame>,
    source_eigenvalues: &[Complex<f64>],
    target_eigenvalues: &[Complex<f64>],
    source_stable_dimension: usize,
    source_unstable_dimension: usize,
    target_stable_dimension: usize,
    target_unstable_dimension: usize,
    focus_tolerance: f64,
) -> HeteroclinicEventValue {
    let Some(frame) = frame else {
        return HeteroclinicEventValue::unavailable(
            kind,
            "caller-supplied inclination transport and reference frames are unavailable",
        );
    };
    if let Err(error) = validate_inclination_spectral_eligibility(
        kind,
        frame,
        source_eigenvalues,
        target_eigenvalues,
        source_stable_dimension,
        source_unstable_dimension,
        target_stable_dimension,
        target_unstable_dimension,
        focus_tolerance,
    ) {
        return HeteroclinicEventValue::unavailable(kind, error.to_string());
    }
    match signed_heteroclinic_inclination_determinant(frame) {
        Ok(value) => HeteroclinicEventValue::available(kind, value),
        Err(error) => HeteroclinicEventValue::unavailable(kind, error.to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_inclination_spectral_eligibility(
    kind: HeteroclinicEventKind,
    frame: &HeteroclinicInclinationFrame,
    source_eigenvalues: &[Complex<f64>],
    target_eigenvalues: &[Complex<f64>],
    source_stable_dimension: usize,
    source_unstable_dimension: usize,
    target_stable_dimension: usize,
    target_unstable_dimension: usize,
    focus_tolerance: f64,
) -> Result<()> {
    if source_eigenvalues.len() != target_eigenvalues.len()
        || frame.ambient_dimension != source_eigenvalues.len()
    {
        bail!("inclination frame ambient dimension does not match both endpoint spectra");
    }
    if source_eigenvalues
        .iter()
        .chain(target_eigenvalues)
        .any(|value| value.re.abs() <= CENTER_TOLERANCE)
    {
        bail!("inclination flips require both endpoint spectra to remain hyperbolic");
    }
    match kind {
        HeteroclinicEventKind::SourceInclinationFlip => {
            if source_unstable_dimension < 2 {
                bail!("source inclination flips require source unstable dimension at least two");
            }
            if source_unstable_dimension != target_unstable_dimension {
                bail!("source inclination flips require equal unstable endpoint dimensions");
            }
            if frame.frame_dimension != source_unstable_dimension - 1 {
                bail!("source inclination frame dimension must equal unstable dimension minus one");
            }
            validate_simple_real_principal_mode(
                target_eigenvalues,
                false,
                focus_tolerance,
                "target unstable",
            )?;
        }
        HeteroclinicEventKind::TargetInclinationFlip => {
            if target_stable_dimension < 2 {
                bail!("target inclination flips require target stable dimension at least two");
            }
            if source_stable_dimension != target_stable_dimension {
                bail!("target inclination flips require equal stable endpoint dimensions");
            }
            if frame.frame_dimension != target_stable_dimension - 1 {
                bail!("target inclination frame dimension must equal stable dimension minus one");
            }
            validate_simple_real_principal_mode(
                source_eigenvalues,
                true,
                focus_tolerance,
                "source stable",
            )?;
        }
        _ => bail!("inclination spectral eligibility requested for a non-inclination event"),
    }
    Ok(())
}

fn validate_simple_real_principal_mode(
    eigenvalues: &[Complex<f64>],
    stable: bool,
    focus_tolerance: f64,
    label: &str,
) -> Result<()> {
    let on_side = |value: Complex<f64>| {
        if stable {
            value.re < -CENTER_TOLERANCE
        } else {
            value.re > CENTER_TOLERANCE
        }
    };
    let mut candidates = eigenvalues
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, value)| on_side(*value))
        .collect::<Vec<_>>();
    candidates.sort_by(|(_, left), (_, right)| {
        if stable {
            right.re.total_cmp(&left.re)
        } else {
            left.re.total_cmp(&right.re)
        }
    });
    let (principal_index, principal) = candidates
        .first()
        .copied()
        .ok_or_else(|| anyhow!("{label} principal mode is unavailable"))?;
    if principal.im.abs() >= focus_tolerance {
        bail!("{label} principal mode must be real");
    }
    let minimum_separation = eigenvalues
        .iter()
        .copied()
        .enumerate()
        .filter(|(index, _)| *index != principal_index)
        .map(|(_, value)| normalized_complex_distance(principal, value))
        .min_by(|left, right| left.total_cmp(right))
        .unwrap_or(f64::INFINITY);
    if !minimum_separation.is_finite() || minimum_separation <= MIN_INCLINATION_PRINCIPAL_SEPARATION
    {
        bail!("{label} principal mode must be simple and spectrally separated");
    }
    Ok(())
}

fn normalized_complex_distance(left: Complex<f64>, right: Complex<f64>) -> f64 {
    (left - right).norm() / (1.0 + left.norm() + right.norm())
}

/// Evaluate `det(R^T T)` from caller-supplied reference and transported
/// frames. A singular overlap is a valid zero of the event function; only
/// malformed/rank-deficient frames or an inaccurate transport are rejected.
pub fn signed_heteroclinic_inclination_determinant(
    frame: &HeteroclinicInclinationFrame,
) -> Result<f64> {
    if !frame.minimum_overlap_singular_value.is_finite()
        || frame.minimum_overlap_singular_value < 0.0
    {
        bail!("inclination minimum overlap singular value must be finite and non-negative");
    }
    if !frame.relative_transport_residual.is_finite()
        || frame.relative_transport_residual < 0.0
        || frame.relative_transport_residual > DEFAULT_MAX_INCLINATION_TRANSPORT_RESIDUAL
    {
        bail!(
            "inclination relative transport residual {} exceeds the eligibility bound {}",
            frame.relative_transport_residual,
            DEFAULT_MAX_INCLINATION_TRANSPORT_RESIDUAL
        );
    }
    let transported = inclination_frame_matrix(
        &frame.transported_frame,
        frame.ambient_dimension,
        frame.frame_dimension,
        "transported",
    )?;
    let reference = inclination_frame_matrix(
        &frame.reference_frame,
        frame.ambient_dimension,
        frame.frame_dimension,
        "reference",
    )?;
    validate_full_rank_inclination_frame(&transported, "transported")?;
    validate_full_rank_inclination_frame(&reference, "reference")?;
    let determinant = (reference.transpose() * transported).determinant();
    if !determinant.is_finite() {
        bail!("inclination overlap determinant is non-finite");
    }
    Ok(determinant)
}

/// Align a locally continuous current frame to the previous frame using the
/// closest orthogonal right factor. Full `O(k)` alignment removes arbitrary
/// eigensolver basis rotations and sign changes, including the `k = 1` gauge.
pub fn align_heteroclinic_frame_orientation_continuously(
    previous_frame: &[f64],
    current_frame: &[f64],
    ambient_dimension: usize,
    frame_dimension: usize,
) -> Result<Vec<f64>> {
    let previous = inclination_frame_matrix(
        previous_frame,
        ambient_dimension,
        frame_dimension,
        "previous",
    )?;
    let current =
        inclination_frame_matrix(current_frame, ambient_dimension, frame_dimension, "current")?;
    validate_full_rank_inclination_frame(&previous, "previous")?;
    validate_full_rank_inclination_frame(&current, "current")?;
    let overlap = current.transpose() * &previous;
    let svd = overlap.svd(true, true);
    let minimum_overlap = svd
        .singular_values
        .iter()
        .copied()
        .min_by(|left, right| left.total_cmp(right))
        .ok_or_else(|| anyhow!("inclination continuity overlap has no singular values"))?;
    let minimum_continuity_overlap = INCLINATION_FRAME_REFRESH_ANGLE_THRESHOLD.cos();
    if !minimum_overlap.is_finite() || minimum_overlap < minimum_continuity_overlap {
        bail!(
            "inclination frame continuity overlap {} is below the refresh threshold {}",
            minimum_overlap,
            minimum_continuity_overlap
        );
    }
    let left = svd
        .u
        .ok_or_else(|| anyhow!("inclination frame alignment omitted left singular vectors"))?;
    let right_transpose = svd
        .v_t
        .ok_or_else(|| anyhow!("inclination frame alignment omitted right singular vectors"))?;
    let rotation = left * right_transpose;
    let aligned = current * rotation;
    Ok(matrix_to_column_major(&aligned))
}

/// Apply proper-orthogonal continuity alignment independently to both frames
/// at each endpoint that exists in both consecutive diagnostics.
pub fn align_heteroclinic_inclination_transport_continuously(
    previous: &HeteroclinicInclinationTransportDiagnostics,
    current: &HeteroclinicInclinationTransportDiagnostics,
) -> Result<HeteroclinicInclinationTransportDiagnostics> {
    Ok(HeteroclinicInclinationTransportDiagnostics {
        source: align_inclination_endpoint(previous.source.as_ref(), current.source.as_ref())?,
        target: align_inclination_endpoint(previous.target.as_ref(), current.target.as_ref())?,
    })
}

/// Align a recomputed diagnostic payload to the preceding serialized gauge.
/// A discontinuous source or target is dropped independently so continuation
/// remains usable and the affected channel becomes unavailable.
pub fn align_heteroclinic_event_diagnostics_continuously(
    previous: &HeteroclinicEventDiagnostics,
    mut current: HeteroclinicEventDiagnostics,
) -> HeteroclinicEventDiagnostics {
    if let Some(current_transport) = current.inclination_transport.as_ref() {
        let previous_transport = previous.inclination_transport.as_ref();
        let source = align_inclination_endpoint(
            previous_transport.and_then(|transport| transport.source.as_ref()),
            current_transport.source.as_ref(),
        )
        .ok()
        .flatten();
        let target = align_inclination_endpoint(
            previous_transport.and_then(|transport| transport.target.as_ref()),
            current_transport.target.as_ref(),
        )
        .ok()
        .flatten();
        current.inclination_transport =
            Some(HeteroclinicInclinationTransportDiagnostics { source, target });
    }
    refresh_inclination_events(&mut current);
    current
}

fn align_inclination_endpoint(
    previous: Option<&HeteroclinicInclinationFrame>,
    current: Option<&HeteroclinicInclinationFrame>,
) -> Result<Option<HeteroclinicInclinationFrame>> {
    let Some(current) = current else {
        return Ok(None);
    };
    let Some(previous) = previous else {
        return Ok(Some(current.clone()));
    };
    if previous.ambient_dimension != current.ambient_dimension
        || previous.frame_dimension != current.frame_dimension
    {
        bail!("inclination frame dimensions changed across continuation steps");
    }
    let mut aligned = current.clone();
    aligned.transported_frame = align_heteroclinic_frame_orientation_continuously(
        &previous.transported_frame,
        &current.transported_frame,
        current.ambient_dimension,
        current.frame_dimension,
    )?;
    aligned.reference_frame = align_heteroclinic_frame_orientation_continuously(
        &previous.reference_frame,
        &current.reference_frame,
        current.ambient_dimension,
        current.frame_dimension,
    )?;
    Ok(Some(aligned))
}

fn refresh_inclination_events(diagnostics: &mut HeteroclinicEventDiagnostics) {
    for kind in [
        HeteroclinicEventKind::SourceInclinationFlip,
        HeteroclinicEventKind::TargetInclinationFlip,
    ] {
        let frame = diagnostics
            .inclination_transport
            .as_ref()
            .and_then(|transport| match kind {
                HeteroclinicEventKind::SourceInclinationFlip => transport.source.as_ref(),
                HeteroclinicEventKind::TargetInclinationFlip => transport.target.as_ref(),
                _ => None,
            });
        let event = inclination_flip_event(
            kind,
            frame,
            &diagnostics.source_eigenvalues,
            &diagnostics.target_eigenvalues,
            diagnostics.source_stable_dimension,
            diagnostics.source_unstable_dimension,
            diagnostics.target_stable_dimension,
            diagnostics.target_unstable_dimension,
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        if let Some(existing) = diagnostics
            .events
            .iter_mut()
            .find(|existing| existing.kind == kind)
        {
            *existing = event;
        }
    }
}

fn inclination_frame_matrix(
    values: &[f64],
    ambient_dimension: usize,
    frame_dimension: usize,
    label: &str,
) -> Result<DMatrix<f64>> {
    if ambient_dimension == 0 || frame_dimension == 0 || frame_dimension > ambient_dimension {
        bail!("{label} inclination frame dimensions must satisfy 0 < frame <= ambient");
    }
    let expected = ambient_dimension
        .checked_mul(frame_dimension)
        .ok_or_else(|| anyhow!("{label} inclination frame dimensions overflow"))?;
    if values.len() != expected {
        bail!(
            "{label} inclination frame length mismatch: expected {expected}, got {}",
            values.len()
        );
    }
    if !values.iter().all(|value| value.is_finite()) {
        bail!("{label} inclination frame contains non-finite values");
    }
    Ok(DMatrix::from_column_slice(
        ambient_dimension,
        frame_dimension,
        values,
    ))
}

fn validate_full_rank_inclination_frame(frame: &DMatrix<f64>, label: &str) -> Result<()> {
    let singular_values = frame.clone().svd(false, false).singular_values;
    let minimum = singular_values
        .iter()
        .copied()
        .min_by(|left, right| left.total_cmp(right))
        .ok_or_else(|| anyhow!("{label} inclination frame has no singular values"))?;
    let maximum = singular_values
        .iter()
        .copied()
        .max_by(|left, right| left.total_cmp(right))
        .unwrap_or(0.0);
    if !minimum.is_finite() || minimum <= MIN_INCLINATION_FRAME_SINGULAR_VALUE * maximum.max(1.0) {
        bail!("{label} inclination frame is rank deficient");
    }
    Ok(())
}

fn matrix_to_column_major(matrix: &DMatrix<f64>) -> Vec<f64> {
    matrix.as_slice().to_vec()
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
        let cross_endpoint = diagnostics.event(HeteroclinicEventKind::CrossEndpointResonance);
        assert_eq!(cross_endpoint.status, HeteroclinicEventStatus::Unsupported);
        for kind in [
            HeteroclinicEventKind::SourceInclinationFlip,
            HeteroclinicEventKind::TargetInclinationFlip,
        ] {
            let event = diagnostics.event(kind);
            assert_eq!(event.status, HeteroclinicEventStatus::Unavailable);
            assert_eq!(event.value, None);
            assert!(event
                .reason
                .as_deref()
                .is_some_and(|reason| reason.contains("transport")));
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

    fn inclination_frame(
        transported_frame: Vec<f64>,
        reference_frame: Vec<f64>,
        minimum_overlap_singular_value: f64,
        relative_transport_residual: f64,
    ) -> HeteroclinicInclinationFrame {
        HeteroclinicInclinationFrame {
            ambient_dimension: 4,
            frame_dimension: 1,
            transported_frame,
            reference_frame,
            minimum_overlap_singular_value,
            relative_transport_residual,
        }
    }

    #[test]
    fn caller_supplied_frames_produce_independent_signed_inclination_tests() {
        let matrix = DMatrix::from_column_slice(3, 2, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let serialized = heteroclinic_inclination_frame_from_matrices(&matrix, &matrix, 1.0, 0.0)
            .expect("column-major frame constructor");
        assert_eq!(
            serialized.transported_frame,
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        );

        let transport = HeteroclinicInclinationTransportDiagnostics {
            source: Some(inclination_frame(
                vec![0.25, 1.0, 0.0, 0.0],
                vec![1.0, 0.0, 0.0, 0.0],
                0.25,
                1.0e-10,
            )),
            target: Some(inclination_frame(
                vec![1.0, -0.75, 0.0, 0.0],
                vec![0.0, 1.0, 0.0, 0.0],
                0.75,
                1.0e-10,
            )),
        };
        let diagnostics = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &[c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)],
            &[c(-3.0, 0.0), c(-1.0, 0.0), c(2.0, 0.0), c(4.0, 0.0)],
            None,
            Some(transport.clone()),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );

        assert_eq!(
            diagnostics
                .event(HeteroclinicEventKind::SourceInclinationFlip)
                .value,
            Some(0.25)
        );
        assert_eq!(
            diagnostics
                .event(HeteroclinicEventKind::TargetInclinationFlip)
                .value,
            Some(-0.75)
        );
        assert_eq!(diagnostics.inclination_transport, Some(transport.clone()));

        let encoded = serde_json::to_string(&diagnostics).expect("serialize inclination frames");
        let decoded: HeteroclinicEventDiagnostics =
            serde_json::from_str(&encoded).expect("reload inclination frames");
        assert_eq!(decoded.inclination_transport, Some(transport));
    }

    #[test]
    fn transport_residual_controls_eligibility_but_zero_overlap_remains_evaluable() {
        let eligible_zero = inclination_frame(
            vec![0.0, 1.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
            0.0,
            DEFAULT_MAX_INCLINATION_TRANSPORT_RESIDUAL,
        );
        assert_eq!(
            signed_heteroclinic_inclination_determinant(&eligible_zero)
                .expect("a singular overlap is the event, not invalid input"),
            0.0
        );

        let poor_transport = inclination_frame(
            vec![0.5, 1.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
            0.5,
            DEFAULT_MAX_INCLINATION_TRANSPORT_RESIDUAL * 10.0,
        );
        let transport = HeteroclinicInclinationTransportDiagnostics {
            source: Some(poor_transport),
            target: None,
        };
        let diagnostics = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &[c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)],
            &[c(-3.0, 0.0), c(-1.0, 0.0), c(2.0, 0.0), c(4.0, 0.0)],
            None,
            Some(transport),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        let event = diagnostics.event(HeteroclinicEventKind::SourceInclinationFlip);
        assert_eq!(event.status, HeteroclinicEventStatus::Unavailable);
        assert!(event
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("residual")));
    }

    #[test]
    fn inclination_eligibility_requires_matching_morse_indices_and_a_simple_real_principal_mode() {
        let source =
            inclination_frame(vec![0.5, 1.0, 0.0, 0.0], vec![1.0, 0.0, 0.0, 0.0], 0.5, 0.0);
        let transport = HeteroclinicInclinationTransportDiagnostics {
            source: Some(source.clone()),
            target: None,
        };
        let mismatched = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &[c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)],
            &[c(-3.0, 0.0), c(-1.0, 0.0), c(-0.5, 0.0), c(2.0, 0.0)],
            None,
            Some(transport.clone()),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert!(mismatched
            .event(HeteroclinicEventKind::SourceInclinationFlip)
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("equal unstable")));

        let nonhyperbolic = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &[c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)],
            &[c(-3.0, 0.0), c(-1.0, 0.0), c(0.0, 0.0), c(2.0, 0.0)],
            None,
            Some(transport.clone()),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert!(nonhyperbolic
            .event(HeteroclinicEventKind::SourceInclinationFlip)
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("hyperbolic")));

        let complex_principal = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &[c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)],
            &[c(-3.0, 0.0), c(-1.0, 0.0), c(2.0, 1.0), c(2.0, -1.0)],
            None,
            Some(transport.clone()),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert!(complex_principal
            .event(HeteroclinicEventKind::SourceInclinationFlip)
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("real")));

        let clustered_source = [
            c(-4.0, 0.0),
            c(-2.0, 0.0),
            c(1.0, 0.0),
            c(3.0, 0.0),
            c(5.0, 0.0),
        ];
        let clustered_target = [
            c(-3.0, 0.0),
            c(-1.0, 0.0),
            c(2.0, 0.0),
            c(2.0 + 1.0e-10, 0.0),
            c(4.0, 0.0),
        ];
        let clustered_frame = HeteroclinicInclinationFrame {
            ambient_dimension: 5,
            frame_dimension: 2,
            transported_frame: vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            reference_frame: vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            minimum_overlap_singular_value: 1.0,
            relative_transport_residual: 0.0,
        };
        let clustered = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &clustered_source,
            &clustered_target,
            None,
            Some(HeteroclinicInclinationTransportDiagnostics {
                source: Some(clustered_frame),
                target: None,
            }),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        assert!(clustered
            .event(HeteroclinicEventKind::SourceInclinationFlip)
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("separated")));
    }

    #[test]
    fn orthogonal_alignment_removes_rotations_and_arbitrary_basis_reflections() {
        let previous = vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let rotated = vec![0.0, 1.0, 0.0, -1.0, 0.0, 0.0];
        let aligned = align_heteroclinic_frame_orientation_continuously(&previous, &rotated, 3, 2)
            .expect("proper rotation alignment");
        for (actual, expected) in aligned.iter().zip(&previous) {
            assert!((actual - expected).abs() < 1.0e-12);
        }

        let reflected = vec![-1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let aligned_reflection =
            align_heteroclinic_frame_orientation_continuously(&previous, &reflected, 3, 2)
                .expect("orthogonal alignment removes a basis-gauge reflection");
        for (actual, expected) in aligned_reflection.iter().zip(&previous) {
            assert!((actual - expected).abs() < 1.0e-12);
        }
    }

    #[test]
    fn continuity_gate_rejects_a_large_frame_jump() {
        let previous = vec![1.0, 0.0];
        let discontinuous = vec![0.0, 1.0];
        let error =
            align_heteroclinic_frame_orientation_continuously(&previous, &discontinuous, 2, 1)
                .expect_err("orthogonal frames are not a locally continuous gauge update");
        assert!(error.to_string().contains("refresh threshold"));
    }

    #[test]
    fn diagnostics_alignment_drops_only_the_discontinuous_endpoint() {
        let spectra_source = [c(-4.0, 0.0), c(-2.0, 0.0), c(1.0, 0.0), c(3.0, 0.0)];
        let spectra_target = [c(-3.0, 0.0), c(-1.0, 0.0), c(2.0, 0.0), c(4.0, 0.0)];
        let frame =
            |transported_frame: Vec<f64>, reference_frame: Vec<f64>| HeteroclinicInclinationFrame {
                ambient_dimension: 4,
                frame_dimension: 1,
                minimum_overlap_singular_value: 1.0,
                relative_transport_residual: 0.0,
                transported_frame,
                reference_frame,
            };
        let previous = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &spectra_source,
            &spectra_target,
            None,
            Some(HeteroclinicInclinationTransportDiagnostics {
                source: Some(frame(vec![1.0, 0.0, 0.0, 0.0], vec![1.0, 0.0, 0.0, 0.0])),
                target: Some(frame(vec![0.0, 1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0])),
            }),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );
        let current = compute_heteroclinic_event_diagnostics_with_inclination_transport(
            &spectra_source,
            &spectra_target,
            None,
            Some(HeteroclinicInclinationTransportDiagnostics {
                source: Some(frame(vec![0.0, 1.0, 0.0, 0.0], vec![1.0, 0.0, 0.0, 0.0])),
                target: Some(frame(vec![0.0, 1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 0.0])),
            }),
            DEFAULT_HETEROCLINIC_FOCUS_TOLERANCE,
        );

        let aligned = align_heteroclinic_event_diagnostics_continuously(&previous, current);
        let transport = aligned
            .inclination_transport
            .as_ref()
            .expect("target transport survives");
        assert!(transport.source.is_none());
        assert!(transport.target.is_some());
        assert_eq!(
            aligned
                .event(HeteroclinicEventKind::SourceInclinationFlip)
                .status,
            HeteroclinicEventStatus::Unavailable
        );
        assert_eq!(
            aligned
                .event(HeteroclinicEventKind::TargetInclinationFlip)
                .status,
            HeteroclinicEventStatus::Available
        );
    }
}
