//! Variational bundle transport shared by collocation and shooting
//! heteroclinic inclination diagnostics.

use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};

const MIN_FRAME_SINGULAR_VALUE: f64 = 1.0e-10;
const MAX_RELATIVE_TRANSPORT_RESIDUAL: f64 = 1.0e-6;

#[derive(Debug, Clone)]
pub(crate) struct InclinationFrameData {
    pub transported_frame: DMatrix<f64>,
    pub reference_frame: DMatrix<f64>,
    pub minimum_overlap_singular_value: f64,
    pub relative_transport_residual: f64,
}

impl InclinationFrameData {
    #[cfg(test)]
    pub(crate) fn signed_test(&self) -> Result<f64> {
        let overlap = self.reference_frame.transpose() * &self.transported_frame;
        if overlap.nrows() == 0 || overlap.nrows() != overlap.ncols() {
            bail!("Inclination overlap must be a non-empty square matrix");
        }
        let value = overlap.determinant();
        if !value.is_finite() {
            bail!("Inclination determinant is non-finite");
        }
        Ok(value)
    }
}

/// Transport the complete source-unstable and target-stable bundles along a
/// connection, then remove the consistently oriented flow direction at the
/// opposite endpoint. The interval maps advance the variational equation in
/// forward physical time.
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(crate) fn transported_inclination_frames(
    interval_maps: &[DMatrix<f64>],
    interval_residuals: &[f64],
    source_unstable_frame: &DMatrix<f64>,
    target_stable_frame: &DMatrix<f64>,
    target_flow: &DVector<f64>,
    source_flow: &DVector<f64>,
    target_strong_unstable: &DMatrix<f64>,
    source_strong_stable: &DMatrix<f64>,
) -> Result<(InclinationFrameData, InclinationFrameData)> {
    let source = transport_source_inclination(
        interval_maps,
        interval_residuals,
        source_unstable_frame,
        target_flow,
        target_strong_unstable,
    )?;
    let target = transport_target_inclination(
        interval_maps,
        interval_residuals,
        target_stable_frame,
        source_flow,
        source_strong_stable,
    )?;
    Ok((source, target))
}

pub(crate) fn transport_source_inclination(
    interval_maps: &[DMatrix<f64>],
    interval_residuals: &[f64],
    source_unstable_frame: &DMatrix<f64>,
    target_flow: &DVector<f64>,
    target_strong_unstable: &DMatrix<f64>,
) -> Result<InclinationFrameData> {
    let maximum_residual = validate_transport_inputs(
        interval_maps,
        interval_residuals,
        source_unstable_frame.nrows(),
    )?;
    let mut forward = positive_qr(source_unstable_frame)?;
    for map in interval_maps {
        forward = positive_qr(&(map * forward))?;
    }
    let transverse = oriented_flow_complement(&forward, target_flow)?;
    frame_data(transverse, target_strong_unstable, maximum_residual)
}

pub(crate) fn transport_target_inclination(
    interval_maps: &[DMatrix<f64>],
    interval_residuals: &[f64],
    target_stable_frame: &DMatrix<f64>,
    source_flow: &DVector<f64>,
    source_strong_stable: &DMatrix<f64>,
) -> Result<InclinationFrameData> {
    let mut maximum_residual = validate_transport_inputs(
        interval_maps,
        interval_residuals,
        target_stable_frame.nrows(),
    )?;
    let mut backward = positive_qr(target_stable_frame)?;
    for map in interval_maps.iter().rev() {
        let singular_values = map.clone().svd(false, false).singular_values;
        let largest = singular_values.iter().copied().fold(0.0_f64, f64::max);
        let smallest = singular_values
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        if !smallest.is_finite() || smallest <= 1.0e-12 * largest.max(1.0) {
            bail!("Backward inclination variational map is singular or ill-conditioned");
        }
        let solved = map
            .clone()
            .lu()
            .solve(&backward)
            .ok_or_else(|| anyhow!("Backward inclination variational solve failed"))?;
        let residual = (map * &solved - &backward).norm()
            / (map.norm() * solved.norm() + backward.norm()).max(1.0);
        if !residual.is_finite() || residual > MAX_RELATIVE_TRANSPORT_RESIDUAL {
            bail!("Backward inclination transport residual {residual:.3e} exceeds tolerance");
        }
        maximum_residual = maximum_residual.max(residual);
        backward = positive_qr(&solved)?;
    }
    let transverse = oriented_flow_complement(&backward, source_flow)?;
    frame_data(transverse, source_strong_stable, maximum_residual)
}

fn validate_transport_inputs(
    interval_maps: &[DMatrix<f64>],
    interval_residuals: &[f64],
    dim: usize,
) -> Result<f64> {
    if dim == 0
        || interval_maps.is_empty()
        || interval_maps.len() != interval_residuals.len()
        || interval_maps.iter().any(|map| map.shape() != (dim, dim))
    {
        bail!("Inclination transport dimensions are inconsistent");
    }
    let maximum_residual = interval_residuals.iter().copied().fold(0.0_f64, f64::max);
    if !maximum_residual.is_finite() || maximum_residual > MAX_RELATIVE_TRANSPORT_RESIDUAL {
        bail!(
            "Inclination variational transport residual {maximum_residual:.3e} exceeds tolerance"
        );
    }
    Ok(maximum_residual)
}

fn frame_data(
    transported_frame: DMatrix<f64>,
    reference_frame: &DMatrix<f64>,
    relative_transport_residual: f64,
) -> Result<InclinationFrameData> {
    let reference_frame = positive_qr(reference_frame)?;
    if reference_frame.shape() != transported_frame.shape() {
        bail!("Inclination transported and reference frames have different dimensions");
    }
    let overlap = reference_frame.transpose() * &transported_frame;
    let minimum_overlap_singular_value = overlap
        .clone()
        .svd(false, false)
        .singular_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    if !minimum_overlap_singular_value.is_finite() {
        bail!("Inclination overlap has a non-finite singular value");
    }
    Ok(InclinationFrameData {
        transported_frame,
        reference_frame,
        minimum_overlap_singular_value,
        relative_transport_residual,
    })
}

pub(crate) fn positive_qr(frame: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    if frame.nrows() == 0 || frame.ncols() == 0 || frame.ncols() > frame.nrows() {
        bail!("Inclination frame has invalid dimensions");
    }
    if frame.iter().any(|value| !value.is_finite()) {
        bail!("Inclination frame contains non-finite entries");
    }
    let decomposition = frame.clone().qr();
    let (mut q, r) = decomposition.unpack();
    q = q.columns(0, frame.ncols()).into_owned();
    let scale = frame.norm().max(1.0);
    for index in 0..frame.ncols() {
        let diagonal = r[(index, index)];
        if !diagonal.is_finite() || diagonal.abs() <= MIN_FRAME_SINGULAR_VALUE * scale {
            bail!("Inclination frame is rank deficient");
        }
        if diagonal < 0.0 {
            q.column_mut(index).scale_mut(-1.0);
        }
    }
    Ok(q)
}

/// Complete the oriented flow coordinate inside an invariant frame to an
/// element of SO(k), and retain its transverse columns. Consequently arbitrary
/// QR sign choices cannot flip the scalar inclination test.
fn oriented_flow_complement(frame: &DMatrix<f64>, flow: &DVector<f64>) -> Result<DMatrix<f64>> {
    let frame = positive_qr(frame)?;
    let bundle_dim = frame.ncols();
    if bundle_dim < 2 || flow.len() != frame.nrows() {
        bail!("Inclination flips require a bundle of dimension at least two");
    }
    let flow_norm = flow.norm();
    if !flow_norm.is_finite() || flow_norm <= MIN_FRAME_SINGULAR_VALUE {
        bail!("Connection flow direction is degenerate");
    }
    let coordinates = frame.transpose() * flow;
    let membership_residual = (flow - &frame * &coordinates).norm() / flow_norm;
    if !membership_residual.is_finite() || membership_residual > 1.0e-6 {
        bail!("Connection flow is not contained in the transported invariant bundle");
    }
    let coordinate_norm = coordinates.norm();
    let first = coordinates / coordinate_norm;
    let mut columns = vec![first];
    for coordinate in 0..bundle_dim {
        if columns.len() == bundle_dim {
            break;
        }
        let mut candidate = DVector::zeros(bundle_dim);
        candidate[coordinate] = 1.0;
        for column in &columns {
            candidate -= column * column.dot(&candidate);
        }
        let norm = candidate.norm();
        if norm > MIN_FRAME_SINGULAR_VALUE {
            columns.push(candidate / norm);
        }
    }
    if columns.len() != bundle_dim {
        bail!("Could not complete the connection-flow orientation");
    }
    let mut rotation = DMatrix::from_columns(&columns);
    if rotation.determinant() < 0.0 {
        rotation.column_mut(bundle_dim - 1).scale_mut(-1.0);
    }
    Ok(frame * rotation.columns(1, bundle_dim - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transports_source_and_target_frames_with_signed_rank_loss() {
        let rotation = |angle: f64| {
            DMatrix::from_row_slice(
                3,
                3,
                &[
                    angle.cos(),
                    -angle.sin(),
                    0.0,
                    angle.sin(),
                    angle.cos(),
                    0.0,
                    0.0,
                    0.0,
                    1.0,
                ],
            )
        };
        let source_bundle = DMatrix::from_columns(&[
            DVector::from_vec(vec![1.0, 0.0, 0.0]),
            DVector::from_vec(vec![0.0, 1.0, 0.0]),
        ]);
        let target_bundle = source_bundle.clone();
        let flow = DVector::from_vec(vec![1.0, 0.0, 0.0]);
        let target_reference = DMatrix::from_column_slice(3, 1, &[0.0, 1.0, 0.0]);
        let source_reference = target_reference.clone();

        let (positive, _) = transported_inclination_frames(
            &[rotation(0.2)],
            &[1.0e-12],
            &source_bundle,
            &target_bundle,
            &(rotation(0.2) * &flow),
            &flow,
            &target_reference,
            &source_reference,
        )
        .expect("transport");
        assert!(positive.signed_test().expect("test") > 0.0);

        let orthogonal_reference = DMatrix::from_column_slice(3, 1, &[0.0, 0.0, 1.0]);
        let (zero, _) = transported_inclination_frames(
            &[rotation(0.2)],
            &[1.0e-12],
            &source_bundle,
            &target_bundle,
            &(rotation(0.2) * &flow),
            &flow,
            &orthogonal_reference,
            &source_reference,
        )
        .expect("transport");
        assert!(zero.signed_test().expect("test").abs() < 1.0e-12);
    }

    #[test]
    fn rejects_transport_that_does_not_contain_the_flow() {
        let identity = DMatrix::identity(3, 3);
        let bundle = identity.columns(0, 2).into_owned();
        let reference = identity.columns(0, 1).into_owned();
        let error = transported_inclination_frames(
            &[identity],
            &[0.0],
            &bundle,
            &bundle,
            &DVector::from_vec(vec![0.0, 0.0, 1.0]),
            &DVector::from_vec(vec![1.0, 0.0, 0.0]),
            &reference,
            &reference,
        )
        .expect_err("flow outside bundle must fail");
        assert!(error.to_string().contains("not contained"));
    }
}
