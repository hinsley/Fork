//! Special-point test functions for homoclinic orbits to a hyperbolic saddle.

use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;
use serde::{Deserialize, Serialize};

pub const DEFAULT_FOCUS_TOLERANCE: f64 = 1.0e-5;
const MIN_ADJOINT_VECTOR_NORM: f64 = 1.0e-13;
const MIN_ADJOINT_PAIRING: f64 = 1.0e-10;
const LOCALIZED_CENTER_TOLERANCE: f64 = 1.0e-5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HomoclinicEventKind {
    #[serde(rename = "NNS")]
    NeutralSaddle,
    #[serde(rename = "NSF")]
    NeutralSaddleFocus,
    #[serde(rename = "NFF")]
    NeutralBiFocus,
    #[serde(rename = "DRS")]
    DoubleRealStable,
    #[serde(rename = "DRU")]
    DoubleRealUnstable,
    #[serde(rename = "NDS")]
    NeutrallyDivergentStable,
    #[serde(rename = "NDU")]
    NeutrallyDivergentUnstable,
    #[serde(rename = "TLS")]
    ThreeLeadingStable,
    #[serde(rename = "TLU")]
    ThreeLeadingUnstable,
    #[serde(rename = "NCH")]
    NonCentralHomoclinic,
    #[serde(rename = "SH")]
    ShilnikovHopf,
    #[serde(rename = "BT")]
    BogdanovTakens,
    #[serde(rename = "OFU")]
    OrbitFlipUnstable,
    #[serde(rename = "OFS")]
    OrbitFlipStable,
    #[serde(rename = "IFU")]
    InclinationFlipUnstable,
    #[serde(rename = "IFS")]
    InclinationFlipStable,
}

impl HomoclinicEventKind {
    pub const ALL: [Self; 16] = [
        Self::NeutralSaddle,
        Self::NeutralSaddleFocus,
        Self::NeutralBiFocus,
        Self::DoubleRealStable,
        Self::DoubleRealUnstable,
        Self::NeutrallyDivergentStable,
        Self::NeutrallyDivergentUnstable,
        Self::ThreeLeadingStable,
        Self::ThreeLeadingUnstable,
        Self::NonCentralHomoclinic,
        Self::ShilnikovHopf,
        Self::BogdanovTakens,
        Self::OrbitFlipUnstable,
        Self::OrbitFlipStable,
        Self::InclinationFlipUnstable,
        Self::InclinationFlipStable,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Self::NeutralSaddle => "NNS",
            Self::NeutralSaddleFocus => "NSF",
            Self::NeutralBiFocus => "NFF",
            Self::DoubleRealStable => "DRS",
            Self::DoubleRealUnstable => "DRU",
            Self::NeutrallyDivergentStable => "NDS",
            Self::NeutrallyDivergentUnstable => "NDU",
            Self::ThreeLeadingStable => "TLS",
            Self::ThreeLeadingUnstable => "TLU",
            Self::NonCentralHomoclinic => "NCH",
            Self::ShilnikovHopf => "SH",
            Self::BogdanovTakens => "BT",
            Self::OrbitFlipUnstable => "OFU",
            Self::OrbitFlipStable => "OFS",
            Self::InclinationFlipUnstable => "IFU",
            Self::InclinationFlipStable => "IFS",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::NeutralSaddle => "Neutral saddle",
            Self::NeutralSaddleFocus => "Neutral saddle-focus",
            Self::NeutralBiFocus => "Neutral bi-focus",
            Self::DoubleRealStable => "Double real stable leading eigenvalue",
            Self::DoubleRealUnstable => "Double real unstable leading eigenvalue",
            Self::NeutrallyDivergentStable => "Neutrally divergent saddle-focus (stable)",
            Self::NeutrallyDivergentUnstable => "Neutrally divergent saddle-focus (unstable)",
            Self::ThreeLeadingStable => "Three leading eigenvalues (stable)",
            Self::ThreeLeadingUnstable => "Three leading eigenvalues (unstable)",
            Self::NonCentralHomoclinic => "Non-central homoclinic to saddle-node",
            Self::ShilnikovHopf => "Shilnikov-Hopf",
            Self::BogdanovTakens => "Bogdanov-Takens",
            Self::OrbitFlipUnstable => "Orbit flip (unstable manifold)",
            Self::OrbitFlipStable => "Orbit flip (stable manifold)",
            Self::InclinationFlipUnstable => "Inclination flip (unstable manifold)",
            Self::InclinationFlipStable => "Inclination flip (stable manifold)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HomoclinicEventStatus {
    Available,
    Unavailable,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HomoclinicEventValue {
    pub kind: HomoclinicEventKind,
    pub name: String,
    pub value: Option<f64>,
    pub status: HomoclinicEventStatus,
    pub reason: Option<String>,
}

impl HomoclinicEventValue {
    fn available(kind: HomoclinicEventKind, value: f64) -> Self {
        if !value.is_finite() {
            return Self::unavailable(kind, "the test-function value is non-finite");
        }
        Self {
            kind,
            name: kind.name().to_owned(),
            value: Some(value),
            status: HomoclinicEventStatus::Available,
            reason: None,
        }
    }

    fn unavailable(kind: HomoclinicEventKind, reason: impl Into<String>) -> Self {
        Self {
            kind,
            name: kind.name().to_owned(),
            value: None,
            status: HomoclinicEventStatus::Unavailable,
            reason: Some(reason.into()),
        }
    }

    fn unsupported(kind: HomoclinicEventKind, reason: impl Into<String>) -> Self {
        Self {
            kind,
            name: kind.name().to_owned(),
            value: None,
            status: HomoclinicEventStatus::Unsupported,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrbitFlipSideData {
    /// `x1 - xs` for the stable side and `x0 - xs` for the unstable side.
    pub endpoint_displacement: Vec<f64>,
    /// Leading adjoint eigenvector, normalized against its right eigenvector.
    pub leading_adjoint_eigenvector: Vec<Complex<f64>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HomoclinicOrbitFlipData {
    pub stable: Option<OrbitFlipSideData>,
    pub unstable: Option<OrbitFlipSideData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HomoclinicEventDiagnostics {
    pub events: Vec<HomoclinicEventValue>,
    pub stable_dimension: usize,
    pub unstable_dimension: usize,
    pub discarded_eigenvalues: usize,
}

impl HomoclinicEventDiagnostics {
    pub fn event(&self, kind: HomoclinicEventKind) -> &HomoclinicEventValue {
        self.events
            .iter()
            .find(|event| event.kind == kind)
            .expect("all homoclinic event kinds are always present")
    }
}

/// Build the endpoint/adjoint data needed by the stable and unstable
/// orbit-flip test functions.
///
/// Each side is deliberately independent. A defective or numerically singular
/// leading eigenspace disables only that orbit-flip channel; spectrum-backed
/// homoclinic diagnostics remain available.
pub(crate) fn build_homoclinic_orbit_flip_data(
    jacobian: &DMatrix<f64>,
    eigenvalues: &[Complex<f64>],
    unstable_endpoint_displacement: Vec<f64>,
    stable_endpoint_displacement: Vec<f64>,
) -> HomoclinicOrbitFlipData {
    let unstable = leading_saddle_eigenvalue(eigenvalues, false).and_then(|eigenvalue| {
        orbit_flip_side_data(jacobian, eigenvalue, unstable_endpoint_displacement).ok()
    });
    let stable = leading_saddle_eigenvalue(eigenvalues, true).and_then(|eigenvalue| {
        orbit_flip_side_data(jacobian, eigenvalue, stable_endpoint_displacement).ok()
    });
    HomoclinicOrbitFlipData { stable, unstable }
}

fn leading_saddle_eigenvalue(eigenvalues: &[Complex<f64>], stable: bool) -> Option<Complex<f64>> {
    let mut candidates = eigenvalues
        .iter()
        .copied()
        .filter(|value| complex_is_finite(*value))
        .filter(|value| {
            if stable {
                value.re < 0.0
            } else {
                value.re > 0.0
            }
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let real_order = if stable {
            right.re.total_cmp(&left.re)
        } else {
            left.re.total_cmp(&right.re)
        };
        real_order.then_with(|| right.im.total_cmp(&left.im))
    });
    candidates.first().copied()
}

fn orbit_flip_side_data(
    jacobian: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
    endpoint_displacement: Vec<f64>,
) -> Result<OrbitFlipSideData> {
    let right = complex_eigenvector(jacobian, eigenvalue)?;
    // For real J and Hermitian pairing p^*q, the adjoint eigenproblem is
    // J^T p = conjugate(lambda) p.
    let mut adjoint = complex_eigenvector(&jacobian.transpose(), eigenvalue.conj())?;
    let pairing = hermitian_inner(&adjoint, &right);
    if !complex_is_finite(pairing) || pairing.norm() <= MIN_ADJOINT_PAIRING {
        bail!("Leading homoclinic left/right eigenvector pairing is singular");
    }
    // If <p,q> = c, p / conjugate(c) has unit Hermitian pairing with q.
    adjoint /= pairing.conj();
    Ok(OrbitFlipSideData {
        endpoint_displacement,
        leading_adjoint_eigenvector: adjoint.iter().copied().collect(),
    })
}

fn complex_eigenvector(
    matrix: &DMatrix<f64>,
    eigenvalue: Complex<f64>,
) -> Result<DVector<Complex<f64>>> {
    if matrix.nrows() == 0 || matrix.nrows() != matrix.ncols() {
        bail!("Homoclinic adjoint eigensolve requires a non-empty square matrix");
    }
    let dimension = matrix.nrows();
    let mut shifted = matrix.map(|value| Complex::new(value, 0.0));
    for index in 0..dimension {
        shifted[(index, index)] -= eigenvalue;
    }
    let decomposition = shifted.svd(false, true);
    let v_t = decomposition
        .v_t
        .ok_or_else(|| anyhow!("Homoclinic adjoint eigensolve omitted singular vectors"))?;
    let row = v_t.nrows() - 1;
    let mut vector = DVector::from_iterator(
        dimension,
        (0..dimension).map(|column| v_t[(row, column)].conj()),
    );
    let norm = vector.norm();
    if !norm.is_finite() || norm <= MIN_ADJOINT_VECTOR_NORM {
        bail!("Homoclinic adjoint eigenvector is degenerate");
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

/// Compute the HBK homoclinic special-point test functions.
///
/// Stable eigenvalues are ordered from the imaginary axis outward and unstable
/// eigenvalues from the imaginary axis outward. Equal-real-part conjugate pairs
/// put the positive-imaginary member first, making the result independent of
/// the eigensolver's input order. Non-finite eigenvalues are discarded rather
/// than leaking sentinels such as `Inf` into serialized continuation data.
///
/// HclinicBifurcationKit 0.2.1 evaluates `TLU` as
/// `real(lambda1) + real(lambda3)`. Both terms are positive on a hyperbolic
/// saddle, so that expression cannot even reach the documented three-leading
/// unstable collision. Fork uses the stable-side-symmetric separation
/// `real(lambda1) - real(lambda3)` instead. The ordered gap remains the raw
/// serialized diagnostic; the continuation layer localizes its touching zero
/// with a signed separation between tracked real and complex spectral branches.
pub fn compute_homoclinic_event_diagnostics(
    eigenvalues: &[Complex<f64>],
    orbit_flip: Option<&HomoclinicOrbitFlipData>,
    focus_tolerance: f64,
) -> HomoclinicEventDiagnostics {
    let focus_tolerance = if focus_tolerance.is_finite() && focus_tolerance >= 0.0 {
        focus_tolerance
    } else {
        DEFAULT_FOCUS_TOLERANCE
    };

    let mut stable = Vec::new();
    let mut unstable = Vec::new();
    let mut center = Vec::new();
    let mut discarded_eigenvalues = 0;
    for &eigenvalue in eigenvalues {
        if !complex_is_finite(eigenvalue) {
            discarded_eigenvalues += 1;
        } else if eigenvalue.re.abs() <= LOCALIZED_CENTER_TOLERANCE {
            center.push(eigenvalue);
        } else if eigenvalue.re < 0.0 {
            stable.push(eigenvalue);
        } else if eigenvalue.re > 0.0 {
            unstable.push(eigenvalue);
        }
    }
    stable.sort_by(|left, right| {
        right
            .re
            .total_cmp(&left.re)
            .then_with(|| right.im.total_cmp(&left.im))
    });
    unstable.sort_by(|left, right| {
        left.re
            .total_cmp(&right.re)
            .then_with(|| right.im.total_cmp(&left.im))
    });
    center.sort_by(|left, right| {
        left.norm()
            .total_cmp(&right.norm())
            .then_with(|| right.im.total_cmp(&left.im))
    });

    let mu1 = stable.first().copied();
    let mu2 = stable.get(1).copied();
    let mu3 = stable.get(2).copied();
    let lambda1 = unstable.first().copied();
    let lambda2 = unstable.get(1).copied();
    let lambda3 = unstable.get(2).copied();
    let center_real = center
        .iter()
        .copied()
        .find(|value| !is_focus(*value, focus_tolerance));
    let center_focus = center
        .iter()
        .copied()
        .find(|value| value.im > 0.0 && is_focus(*value, focus_tolerance));
    let center_real_values = center
        .iter()
        .copied()
        .filter(|value| !is_focus(*value, focus_tolerance))
        .collect::<Vec<_>>();

    let mut events = Vec::with_capacity(HomoclinicEventKind::ALL.len());
    let neutral_value = mu1
        .zip(lambda1)
        .map(|(stable, unstable)| stable.re + unstable.re);
    let neutral_kind = mu1.zip(lambda1).map(|(stable, unstable)| {
        match (
            is_focus(stable, focus_tolerance),
            is_focus(unstable, focus_tolerance),
        ) {
            (false, false) => HomoclinicEventKind::NeutralSaddle,
            (true, true) => HomoclinicEventKind::NeutralBiFocus,
            _ => HomoclinicEventKind::NeutralSaddleFocus,
        }
    });
    for kind in [
        HomoclinicEventKind::NeutralSaddle,
        HomoclinicEventKind::NeutralSaddleFocus,
        HomoclinicEventKind::NeutralBiFocus,
    ] {
        events.push(match (neutral_kind, neutral_value) {
            (Some(active), Some(value)) if active == kind => {
                HomoclinicEventValue::available(kind, value)
            }
            (Some(_), Some(_)) => HomoclinicEventValue::unavailable(
                kind,
                "the leading stable/unstable spectrum has a different real/focus type",
            ),
            _ => HomoclinicEventValue::unavailable(
                kind,
                "requires at least one stable and one unstable eigenvalue",
            ),
        });
    }

    events.push(match mu1.zip(mu2) {
        Some((leading, second)) => HomoclinicEventValue::available(
            HomoclinicEventKind::DoubleRealStable,
            double_real_test(leading, second, focus_tolerance),
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::DoubleRealStable,
            "requires at least two stable eigenvalues",
        ),
    });
    events.push(match lambda1.zip(lambda2) {
        Some((leading, second)) => HomoclinicEventValue::available(
            HomoclinicEventKind::DoubleRealUnstable,
            double_real_test(leading, second, focus_tolerance),
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::DoubleRealUnstable,
            "requires at least two unstable eigenvalues",
        ),
    });
    events.push(match mu1.zip(mu2).zip(lambda1) {
        Some(((leading, second), unstable)) => HomoclinicEventValue::available(
            HomoclinicEventKind::NeutrallyDivergentStable,
            leading.re + second.re + unstable.re,
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::NeutrallyDivergentStable,
            "requires two stable and one unstable eigenvalue",
        ),
    });
    events.push(match mu1.zip(lambda1).zip(lambda2) {
        Some(((stable, leading), second)) => HomoclinicEventValue::available(
            HomoclinicEventKind::NeutrallyDivergentUnstable,
            stable.re + leading.re + second.re,
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::NeutrallyDivergentUnstable,
            "requires one stable and two unstable eigenvalues",
        ),
    });
    events.push(match mu1.zip(mu3) {
        Some((leading, third)) => HomoclinicEventValue::available(
            HomoclinicEventKind::ThreeLeadingStable,
            leading.re - third.re,
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::ThreeLeadingStable,
            "requires at least three stable eigenvalues",
        ),
    });
    events.push(match lambda1.zip(lambda3) {
        Some((leading, third)) => HomoclinicEventValue::available(
            HomoclinicEventKind::ThreeLeadingUnstable,
            leading.re - third.re,
        ),
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::ThreeLeadingUnstable,
            "requires at least three unstable eigenvalues",
        ),
    });
    events.push(match center_real.or(mu1) {
        Some(leading) => {
            HomoclinicEventValue::available(HomoclinicEventKind::NonCentralHomoclinic, leading.re)
        }
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::NonCentralHomoclinic,
            "requires at least one stable eigenvalue",
        ),
    });
    events.push(match center_focus.or(lambda1) {
        Some(leading) => {
            HomoclinicEventValue::available(HomoclinicEventKind::ShilnikovHopf, leading.re)
        }
        None => HomoclinicEventValue::unavailable(
            HomoclinicEventKind::ShilnikovHopf,
            "requires at least one unstable eigenvalue",
        ),
    });
    events.push(match center_real_values.as_slice() {
        [first, second, ..] => HomoclinicEventValue::available(
            HomoclinicEventKind::BogdanovTakens,
            first.re * second.re,
        ),
        _ => match mu1.zip(lambda1) {
            Some((stable, unstable)) => HomoclinicEventValue::available(
                HomoclinicEventKind::BogdanovTakens,
                stable.re * unstable.re,
            ),
            None => HomoclinicEventValue::unavailable(
                HomoclinicEventKind::BogdanovTakens,
                "requires two center eigenvalues or at least one stable and one unstable eigenvalue",
            ),
        },
    });

    let unstable_flip_data = orbit_flip.and_then(|data| data.unstable.as_ref());
    events.push(orbit_flip_event(
        HomoclinicEventKind::OrbitFlipUnstable,
        unstable_flip_data,
        lambda1,
        focus_tolerance,
        true,
    ));
    let stable_flip_data = orbit_flip.and_then(|data| data.stable.as_ref());
    events.push(orbit_flip_event(
        HomoclinicEventKind::OrbitFlipStable,
        stable_flip_data,
        mu1,
        focus_tolerance,
        false,
    ));

    let unsupported_reason = "inclination-flip test functions are not implemented in HBK or Fork";
    events.push(HomoclinicEventValue::unsupported(
        HomoclinicEventKind::InclinationFlipUnstable,
        unsupported_reason,
    ));
    events.push(HomoclinicEventValue::unsupported(
        HomoclinicEventKind::InclinationFlipStable,
        unsupported_reason,
    ));

    debug_assert_eq!(
        events.iter().map(|event| event.kind).collect::<Vec<_>>(),
        HomoclinicEventKind::ALL
    );
    HomoclinicEventDiagnostics {
        events,
        stable_dimension: stable.len(),
        unstable_dimension: unstable.len(),
        discarded_eigenvalues,
    }
}

fn complex_is_finite(value: Complex<f64>) -> bool {
    value.re.is_finite() && value.im.is_finite()
}

fn is_focus(value: Complex<f64>, tolerance: f64) -> bool {
    value.im.abs() >= tolerance
}

fn double_real_test(leading: Complex<f64>, second: Complex<f64>, tolerance: f64) -> f64 {
    if is_focus(leading, tolerance) {
        -(leading.im - second.im).powi(2)
    } else {
        (leading.re - second.re).powi(2)
    }
}

fn orbit_flip_event(
    kind: HomoclinicEventKind,
    data: Option<&OrbitFlipSideData>,
    leading_eigenvalue: Option<Complex<f64>>,
    focus_tolerance: f64,
    multiply_focus_components: bool,
) -> HomoclinicEventValue {
    let Some(leading_eigenvalue) = leading_eigenvalue else {
        return HomoclinicEventValue::unavailable(
            kind,
            "requires the corresponding leading saddle eigenvalue",
        );
    };
    let Some(data) = data else {
        return HomoclinicEventValue::unavailable(kind, "orbit-flip data were not supplied");
    };
    if data.endpoint_displacement.is_empty()
        || data.endpoint_displacement.len() != data.leading_adjoint_eigenvector.len()
    {
        return HomoclinicEventValue::unavailable(
            kind,
            "endpoint displacement and adjoint eigenvector dimensions do not match",
        );
    }
    if data
        .endpoint_displacement
        .iter()
        .any(|component| !component.is_finite())
        || data
            .leading_adjoint_eigenvector
            .iter()
            .any(|&component| !complex_is_finite(component))
    {
        return HomoclinicEventValue::unavailable(
            kind,
            "orbit-flip data contain non-finite values",
        );
    }

    let Some(oriented_adjoint) = phase_oriented(&data.leading_adjoint_eigenvector) else {
        return HomoclinicEventValue::unavailable(kind, "the adjoint eigenvector has zero norm");
    };
    let (real_projection, imaginary_projection) = oriented_adjoint
        .iter()
        .zip(&data.endpoint_displacement)
        .fold((0.0, 0.0), |(real, imaginary), (adjoint, displacement)| {
            (
                real + adjoint.re * displacement,
                imaginary + adjoint.im * displacement,
            )
        });
    let value = if multiply_focus_components && is_focus(leading_eigenvalue, focus_tolerance) {
        real_projection * imaginary_projection
    } else {
        real_projection
    };
    HomoclinicEventValue::available(kind, value)
}

fn phase_oriented(values: &[Complex<f64>]) -> Option<Vec<Complex<f64>>> {
    let (pivot_index, pivot_norm) = values
        .iter()
        .enumerate()
        .map(|(index, value)| (index, value.norm()))
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                // Prefer the earliest coordinate when magnitudes tie.
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
        .all(|&component| complex_is_finite(component))
        .then_some(oriented)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(re: f64, im: f64) -> Complex<f64> {
        Complex::new(re, im)
    }

    fn assert_available(
        diagnostics: &HomoclinicEventDiagnostics,
        kind: HomoclinicEventKind,
        expected: f64,
    ) {
        let event = diagnostics.event(kind);
        assert_eq!(event.status, HomoclinicEventStatus::Available);
        assert_eq!(event.reason, None);
        assert!((event.value.expect("available value") - expected).abs() < 1.0e-12);
    }

    fn assert_unavailable(diagnostics: &HomoclinicEventDiagnostics, kind: HomoclinicEventKind) {
        let event = diagnostics.event(kind);
        assert_eq!(event.status, HomoclinicEventStatus::Unavailable);
        assert_eq!(event.value, None);
        assert!(event
            .reason
            .as_deref()
            .is_some_and(|reason| !reason.is_empty()));
    }

    #[test]
    fn real_saddle_matches_hbk_test_functions_and_corrected_tlu() {
        let diagnostics = compute_homoclinic_event_diagnostics(
            &[
                c(2.0, 0.0),
                c(-3.0, 0.0),
                c(0.5, 0.0),
                c(-1.0, 0.0),
                c(1.0, 0.0),
                c(-2.0, 0.0),
            ],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );

        assert_eq!(diagnostics.stable_dimension, 3);
        assert_eq!(diagnostics.unstable_dimension, 3);
        assert_available(&diagnostics, HomoclinicEventKind::NeutralSaddle, -0.5);
        assert_unavailable(&diagnostics, HomoclinicEventKind::NeutralSaddleFocus);
        assert_unavailable(&diagnostics, HomoclinicEventKind::NeutralBiFocus);
        assert_available(&diagnostics, HomoclinicEventKind::DoubleRealStable, 1.0);
        assert_available(&diagnostics, HomoclinicEventKind::DoubleRealUnstable, 0.25);
        assert_available(
            &diagnostics,
            HomoclinicEventKind::NeutrallyDivergentStable,
            -2.5,
        );
        assert_available(
            &diagnostics,
            HomoclinicEventKind::NeutrallyDivergentUnstable,
            0.5,
        );
        assert_available(&diagnostics, HomoclinicEventKind::ThreeLeadingStable, 2.0);
        assert_available(
            &diagnostics,
            HomoclinicEventKind::ThreeLeadingUnstable,
            -1.5,
        );
        assert_available(
            &diagnostics,
            HomoclinicEventKind::NonCentralHomoclinic,
            -1.0,
        );
        assert_available(&diagnostics, HomoclinicEventKind::ShilnikovHopf, 0.5);
        assert_available(&diagnostics, HomoclinicEventKind::BogdanovTakens, -0.5);
        assert_unavailable(&diagnostics, HomoclinicEventKind::OrbitFlipStable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::OrbitFlipUnstable);
    }

    #[test]
    fn one_side_focus_activates_only_neutral_saddle_focus() {
        let stable_focus = compute_homoclinic_event_diagnostics(
            &[c(-1.0, -2.0), c(0.5, 0.0), c(-3.0, 0.0), c(-1.0, 2.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        assert_unavailable(&stable_focus, HomoclinicEventKind::NeutralSaddle);
        assert_available(&stable_focus, HomoclinicEventKind::NeutralSaddleFocus, -0.5);
        assert_unavailable(&stable_focus, HomoclinicEventKind::NeutralBiFocus);
        assert_available(&stable_focus, HomoclinicEventKind::DoubleRealStable, -16.0);
        assert_available(
            &stable_focus,
            HomoclinicEventKind::NeutrallyDivergentStable,
            -1.5,
        );

        let unstable_focus = compute_homoclinic_event_diagnostics(
            &[c(-1.0, 0.0), c(0.5, -1.5), c(-2.0, 0.0), c(0.5, 1.5)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        assert_available(
            &unstable_focus,
            HomoclinicEventKind::NeutralSaddleFocus,
            -0.5,
        );
        assert_available(
            &unstable_focus,
            HomoclinicEventKind::DoubleRealUnstable,
            -9.0,
        );
        assert_available(
            &unstable_focus,
            HomoclinicEventKind::NeutrallyDivergentUnstable,
            0.0,
        );
    }

    #[test]
    fn bifocus_activates_neutral_bifocus() {
        let diagnostics = compute_homoclinic_event_diagnostics(
            &[c(0.5, -1.5), c(-1.0, -2.0), c(0.5, 1.5), c(-1.0, 2.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );

        assert_unavailable(&diagnostics, HomoclinicEventKind::NeutralSaddle);
        assert_unavailable(&diagnostics, HomoclinicEventKind::NeutralSaddleFocus);
        assert_available(&diagnostics, HomoclinicEventKind::NeutralBiFocus, -0.5);
        assert_available(&diagnostics, HomoclinicEventKind::DoubleRealStable, -16.0);
        assert_available(&diagnostics, HomoclinicEventKind::DoubleRealUnstable, -9.0);
    }

    #[test]
    fn double_real_functions_change_sign_across_real_complex_transition() {
        let real = compute_homoclinic_event_diagnostics(
            &[c(-1.0, 0.0), c(-1.25, 0.0), c(0.5, 0.0), c(0.75, 0.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        let complex = compute_homoclinic_event_diagnostics(
            &[c(-1.0, 0.25), c(-1.0, -0.25), c(0.5, 0.2), c(0.5, -0.2)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );

        assert_available(&real, HomoclinicEventKind::DoubleRealStable, 0.0625);
        assert_available(&real, HomoclinicEventKind::DoubleRealUnstable, 0.0625);
        assert_available(&complex, HomoclinicEventKind::DoubleRealStable, -0.25);
        assert_available(&complex, HomoclinicEventKind::DoubleRealUnstable, -0.16);
    }

    #[test]
    fn orbit_flip_values_are_phase_oriented_deterministically() {
        let orbit_flip = HomoclinicOrbitFlipData {
            stable: Some(OrbitFlipSideData {
                endpoint_displacement: vec![3.0, 4.0],
                leading_adjoint_eigenvector: vec![c(-2.0, 0.0), c(0.0, 0.0)],
            }),
            unstable: Some(OrbitFlipSideData {
                endpoint_displacement: vec![0.0, 2.0],
                leading_adjoint_eigenvector: vec![c(1.0, 1.0), c(1.0, 0.0)],
            }),
        };
        let diagnostics = compute_homoclinic_event_diagnostics(
            &[c(-1.0, 0.0), c(0.5, 1.5), c(0.5, -1.5)],
            Some(&orbit_flip),
            DEFAULT_FOCUS_TOLERANCE,
        );

        assert_available(&diagnostics, HomoclinicEventKind::OrbitFlipStable, 6.0);
        assert_available(&diagnostics, HomoclinicEventKind::OrbitFlipUnstable, -2.0);
    }

    #[test]
    fn center_modes_keep_nch_sh_and_bt_available_at_the_localized_boundary() {
        let nch = compute_homoclinic_event_diagnostics(
            &[c(-2.0, 0.0), c(0.0, 0.0), c(2.0, 0.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        assert_available(&nch, HomoclinicEventKind::NonCentralHomoclinic, 0.0);

        let sh = compute_homoclinic_event_diagnostics(
            &[c(-2.0, 0.0), c(0.0, 1.0), c(0.0, -1.0), c(2.0, 0.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        assert_available(&sh, HomoclinicEventKind::ShilnikovHopf, 0.0);

        let bt = compute_homoclinic_event_diagnostics(
            &[c(-2.0, 0.0), c(0.0, 0.0), c(0.0, 0.0), c(2.0, 0.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        assert_available(&bt, HomoclinicEventKind::BogdanovTakens, 0.0);
    }

    #[test]
    fn insufficient_or_non_finite_data_never_emit_non_finite_values() {
        let orbit_flip = HomoclinicOrbitFlipData {
            stable: Some(OrbitFlipSideData {
                endpoint_displacement: vec![f64::NAN],
                leading_adjoint_eigenvector: vec![c(1.0, 0.0)],
            }),
            unstable: Some(OrbitFlipSideData {
                endpoint_displacement: vec![1.0, 2.0],
                leading_adjoint_eigenvector: vec![c(1.0, 0.0)],
            }),
        };
        let diagnostics = compute_homoclinic_event_diagnostics(
            &[
                c(-1.0, 0.0),
                c(0.5, 0.0),
                c(f64::NAN, 0.0),
                c(f64::INFINITY, 0.0),
            ],
            Some(&orbit_flip),
            f64::NAN,
        );

        assert_eq!(diagnostics.discarded_eigenvalues, 2);
        assert_unavailable(&diagnostics, HomoclinicEventKind::DoubleRealStable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::DoubleRealUnstable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::ThreeLeadingStable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::ThreeLeadingUnstable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::OrbitFlipStable);
        assert_unavailable(&diagnostics, HomoclinicEventKind::OrbitFlipUnstable);
        assert!(diagnostics
            .events
            .iter()
            .all(|event| event.value.is_none_or(f64::is_finite)));

        let json = serde_json::to_string(&diagnostics).expect("finite diagnostics serialize");
        assert!(!json.contains("NaN"));
        assert!(!json.contains("Infinity"));
    }

    #[test]
    fn labels_order_and_inclination_flip_support_are_stable() {
        let diagnostics = compute_homoclinic_event_diagnostics(
            &[c(-1.0, 0.0), c(1.0, 0.0)],
            None,
            DEFAULT_FOCUS_TOLERANCE,
        );
        let kinds = diagnostics
            .events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            vec![
                HomoclinicEventKind::NeutralSaddle,
                HomoclinicEventKind::NeutralSaddleFocus,
                HomoclinicEventKind::NeutralBiFocus,
                HomoclinicEventKind::DoubleRealStable,
                HomoclinicEventKind::DoubleRealUnstable,
                HomoclinicEventKind::NeutrallyDivergentStable,
                HomoclinicEventKind::NeutrallyDivergentUnstable,
                HomoclinicEventKind::ThreeLeadingStable,
                HomoclinicEventKind::ThreeLeadingUnstable,
                HomoclinicEventKind::NonCentralHomoclinic,
                HomoclinicEventKind::ShilnikovHopf,
                HomoclinicEventKind::BogdanovTakens,
                HomoclinicEventKind::OrbitFlipUnstable,
                HomoclinicEventKind::OrbitFlipStable,
                HomoclinicEventKind::InclinationFlipUnstable,
                HomoclinicEventKind::InclinationFlipStable,
            ]
        );
        for kind in [
            HomoclinicEventKind::InclinationFlipUnstable,
            HomoclinicEventKind::InclinationFlipStable,
        ] {
            let event = diagnostics.event(kind);
            assert_eq!(event.status, HomoclinicEventStatus::Unsupported);
            assert_eq!(event.value, None);
            assert!(event.reason.as_deref().unwrap().contains("not implemented"));
        }

        let json = serde_json::to_value(&diagnostics).expect("serialize labels");
        assert_eq!(json["events"][0]["kind"], "NNS");
        assert_eq!(json["events"][8]["kind"], "TLU");
        assert_eq!(json["events"][14]["kind"], "IFU");
    }
}
