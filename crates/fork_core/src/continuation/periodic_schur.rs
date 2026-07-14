//! Product-free Floquet extraction from a periodic transfer sequence.
//!
//! The reduction and implicit periodic-QR sweep are a focused complex-arithmetic
//! implementation of the periodic Schur algorithm described by Bojanczyk,
//! Golub, and Van Dooren.  The sweep structure follows the MIT-licensed
//! `PeriodicSchurDecompositions.jl` implementation (itself derived in part from
//! BSD-licensed SLICOT routines), specialized here to a standard product of
//! dense `f64` transfer matrices.

use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

#[derive(Debug, Clone)]
pub(super) struct PeriodicSchurSpectrum {
    pub multipliers: Vec<Complex<f64>>,
    /// Raw physical mode vectors at mesh points `0..period` (the repeated
    /// endpoint is omitted and equals `multiplier * mesh_vectors[0]`).
    pub mesh_vectors: Vec<Vec<Vec<Complex<f64>>>>,
}

pub(super) fn periodic_schur_floquet_spectrum(
    transfers: &[DMatrix<f64>],
    compute_vectors: bool,
) -> Result<PeriodicSchurSpectrum> {
    let first = transfers
        .first()
        .ok_or_else(|| anyhow!("Periodic Schur Floquet extraction requires transfer matrices."))?;
    let dim = first.nrows();
    if dim == 0 || first.ncols() != dim {
        bail!("Periodic Schur transfer matrices must be square and non-empty.");
    }
    if transfers
        .iter()
        .any(|transfer| transfer.nrows() != dim || transfer.ncols() != dim)
    {
        bail!("Periodic Schur transfer matrices must have a common square dimension.");
    }
    if transfers
        .iter()
        .flat_map(|transfer| transfer.iter())
        .any(|value| !value.is_finite())
    {
        bail!("Periodic Schur transfer matrices must contain only finite values.");
    }

    // The right-oriented periodic decomposition represents A[0]A[1]...A[p-1].
    // Reverse the physical mesh transfers so that this is T[p-1]...T[1]T[0],
    // i.e. the monodromy map anchored at mesh point zero.
    let mut log_input_scale = 0.0;
    let mut factors = Vec::with_capacity(transfers.len());
    let mut input_scales = Vec::with_capacity(transfers.len());
    for transfer in transfers.iter().rev() {
        let scale = transfer
            .iter()
            .map(|value| value.abs())
            .fold(0.0f64, f64::max);
        if scale == 0.0 {
            factors.push(DMatrix::zeros(dim, dim));
            input_scales.push(0.0);
        } else {
            log_input_scale += scale.ln();
            factors.push(transfer.map(|value| Complex::new(value / scale, 0.0)));
            input_scales.push(scale);
        }
    }

    let mut schur = periodic_hessenberg(factors, compute_vectors);
    periodic_qr(&mut schur.factors, schur.bases.as_mut())?;

    let mut entries = (0..dim)
        .map(|index| {
            let multiplier = safe_diagonal_product(&schur.factors, index, log_input_scale);
            (index, multiplier)
        })
        .collect::<Vec<_>>();

    let mut mesh_vectors = if compute_vectors {
        let bases = schur
            .bases
            .as_ref()
            .ok_or_else(|| anyhow!("Periodic Schur vectors were not accumulated."))?;
        schur_mesh_vectors(&schur.factors, bases, &input_scales, &entries, transfers)?
    } else {
        Vec::new()
    };

    entries.sort_by(|a, b| {
        a.1.re
            .total_cmp(&b.1.re)
            .then_with(|| a.1.im.total_cmp(&b.1.im))
            .then_with(|| a.0.cmp(&b.0))
    });
    if compute_vectors {
        for mesh in &mut mesh_vectors {
            let original = std::mem::take(mesh);
            *mesh = entries
                .iter()
                .map(|(index, _)| original[*index].clone())
                .collect();
        }
    }
    Ok(PeriodicSchurSpectrum {
        multipliers: entries.into_iter().map(|(_, value)| value).collect(),
        mesh_vectors,
    })
}

struct PeriodicSchurFactors {
    factors: Vec<DMatrix<Complex<f64>>>,
    bases: Option<Vec<DMatrix<Complex<f64>>>>,
}

fn periodic_hessenberg(
    mut factors: Vec<DMatrix<Complex<f64>>>,
    accumulate_bases: bool,
) -> PeriodicSchurFactors {
    let period = factors.len();
    let dim = factors[0].nrows();
    let mut bases =
        accumulate_bases.then(|| vec![DMatrix::<Complex<f64>>::identity(dim, dim); period]);

    for column in 0..dim.saturating_sub(1) {
        for factor_index in (1..period).rev() {
            let reflector = householder_vector(
                (column..dim)
                    .map(|row| factors[factor_index][(row, column)])
                    .collect(),
            );
            apply_householder_left(&mut factors[factor_index], column, column, &reflector);
            apply_householder_right(&mut factors[factor_index - 1], 0, column, &reflector);
            if let Some(bases) = bases.as_mut() {
                apply_householder_right(&mut bases[factor_index], 0, column, &reflector);
            }
            for row in column + 1..dim {
                factors[factor_index][(row, column)] = Complex::new(0.0, 0.0);
            }
        }

        let reflector = householder_vector(
            (column + 1..dim)
                .map(|row| factors[0][(row, column)])
                .collect(),
        );
        apply_householder_left(&mut factors[0], column + 1, column, &reflector);
        apply_householder_right(&mut factors[period - 1], 0, column + 1, &reflector);
        if let Some(bases) = bases.as_mut() {
            apply_householder_right(&mut bases[0], 0, column + 1, &reflector);
        }
        for row in column + 2..dim {
            factors[0][(row, column)] = Complex::new(0.0, 0.0);
        }
    }

    PeriodicSchurFactors { factors, bases }
}

fn householder_vector(mut values: Vec<Complex<f64>>) -> Vec<Complex<f64>> {
    if values.len() <= 1 {
        return vec![Complex::new(0.0, 0.0); values.len()];
    }
    let norm = values
        .iter()
        .map(|value| value.norm_sqr())
        .sum::<f64>()
        .sqrt();
    if norm == 0.0 {
        return vec![Complex::new(0.0, 0.0); values.len()];
    }
    let phase = if values[0].norm() == 0.0 {
        Complex::new(1.0, 0.0)
    } else {
        values[0] / values[0].norm()
    };
    values[0] += phase * norm;
    let reflector_norm = values
        .iter()
        .map(|value| value.norm_sqr())
        .sum::<f64>()
        .sqrt();
    if reflector_norm == 0.0 {
        return vec![Complex::new(0.0, 0.0); values.len()];
    }
    for value in &mut values {
        *value /= reflector_norm;
    }
    values
}

fn apply_householder_left(
    matrix: &mut DMatrix<Complex<f64>>,
    row_start: usize,
    column_start: usize,
    reflector: &[Complex<f64>],
) {
    if reflector.iter().all(|value| value.norm() == 0.0) {
        return;
    }
    for column in column_start..matrix.ncols() {
        let projection = reflector
            .iter()
            .enumerate()
            .map(|(offset, value)| value.conj() * matrix[(row_start + offset, column)])
            .sum::<Complex<f64>>();
        for (offset, value) in reflector.iter().enumerate() {
            matrix[(row_start + offset, column)] -= 2.0 * *value * projection;
        }
    }
}

fn apply_householder_right(
    matrix: &mut DMatrix<Complex<f64>>,
    row_start: usize,
    column_start: usize,
    reflector: &[Complex<f64>],
) {
    if reflector.iter().all(|value| value.norm() == 0.0) {
        return;
    }
    for row in row_start..matrix.nrows() {
        let projection = reflector
            .iter()
            .enumerate()
            .map(|(offset, value)| matrix[(row, column_start + offset)] * *value)
            .sum::<Complex<f64>>();
        for (offset, value) in reflector.iter().enumerate() {
            matrix[(row, column_start + offset)] -= 2.0 * projection * value.conj();
        }
    }
}

#[derive(Clone, Copy)]
struct ComplexGivens {
    cosine: f64,
    sine: Complex<f64>,
}

fn complex_givens(first: Complex<f64>, second: Complex<f64>) -> (ComplexGivens, Complex<f64>) {
    if second.norm() == 0.0 {
        return (
            ComplexGivens {
                cosine: 1.0,
                sine: Complex::new(0.0, 0.0),
            },
            first,
        );
    }
    if first.norm() == 0.0 {
        let sine = second.conj() / second.norm();
        return (
            ComplexGivens { cosine: 0.0, sine },
            Complex::new(second.norm(), 0.0),
        );
    }
    let scale = first.norm() + second.norm();
    let norm = scale * ((first.norm() / scale).powi(2) + (second.norm() / scale).powi(2)).sqrt();
    let phase = first / first.norm();
    (
        ComplexGivens {
            cosine: first.norm() / norm,
            sine: phase * second.conj() / norm,
        },
        phase * norm,
    )
}

fn apply_givens_left(
    matrix: &mut DMatrix<Complex<f64>>,
    first: usize,
    second: usize,
    rotation: ComplexGivens,
    column_start: usize,
    column_end: usize,
) {
    for column in column_start..column_end {
        let upper = matrix[(first, column)];
        let lower = matrix[(second, column)];
        matrix[(first, column)] = rotation.cosine * upper + rotation.sine * lower;
        matrix[(second, column)] = -rotation.sine.conj() * upper + rotation.cosine * lower;
    }
}

fn apply_givens_adjoint_right(
    matrix: &mut DMatrix<Complex<f64>>,
    first: usize,
    second: usize,
    rotation: ComplexGivens,
    row_start: usize,
    row_end: usize,
) {
    for row in row_start..row_end {
        let left = matrix[(row, first)];
        let right = matrix[(row, second)];
        matrix[(row, first)] = rotation.cosine * left + rotation.sine.conj() * right;
        matrix[(row, second)] = -rotation.sine * left + rotation.cosine * right;
    }
}

fn periodic_qr(
    factors: &mut [DMatrix<Complex<f64>>],
    mut bases: Option<&mut Vec<DMatrix<Complex<f64>>>>,
) -> Result<()> {
    let period = factors.len();
    let dim = factors[0].nrows();
    if dim == 1 {
        return Ok(());
    }
    let small_number = f64::MIN_POSITIVE * dim as f64 / f64::EPSILON;
    // Near-neutral cycle multipliers can be separated by only a few ulps after
    // a long collocation product. Give the periodic QR sweeps the same generous
    // convergence window used by robust dense eigensolvers before declaring
    // failure; each sweep remains product-free and linear in the period.
    let max_iterations = 400 * dim.max(2);
    let mut last = dim - 1;
    let mut iterations = 0usize;

    loop {
        let mut first = 0usize;
        for index in (1..=last).rev() {
            let mut tolerance =
                factors[0][(index - 1, index - 1)].norm() + factors[0][(index, index)].norm();
            if tolerance == 0.0 {
                tolerance = active_one_norm(&factors[0], 0, index);
            }
            if factors[0][(index, index - 1)].norm() <= (f64::EPSILON * tolerance).max(small_number)
            {
                factors[0][(index, index - 1)] = Complex::new(0.0, 0.0);
                first = index;
                break;
            }
        }

        if first == last {
            if last == 0 {
                break;
            }
            last -= 1;
            iterations = 0;
            continue;
        }

        iterations += 1;
        if iterations > max_iterations {
            bail!(
                "Periodic Schur QR iteration failed to converge at active index {}.",
                last
            );
        }

        let mut rotation = if iterations.is_multiple_of(8) {
            // A controlled zero shift breaks the near-neutral stagnation that
            // is common when a flow's trivial multiplier is clustered with a
            // second multiplier close to one. This is the complex periodic-QZ
            // recovery step used by the upstream implementation.
            complex_givens(factors[0][(first, first)], factors[0][(first + 1, first)]).0
        } else if iterations.is_multiple_of(10) {
            complex_givens(Complex::new(1.0, -2.0), Complex::new(2.0, 2.0)).0
        } else {
            let mut rotation = complex_givens(Complex::new(1.0, 0.0), Complex::new(1.0, 0.0)).0;
            for factor_index in (1..period).rev() {
                rotation = complex_givens(
                    factors[factor_index][(first, first)] * rotation.cosine,
                    factors[factor_index][(last, last)] * rotation.sine.conj(),
                )
                .0;
            }
            complex_givens(
                factors[0][(first, first)] * rotation.cosine
                    - factors[0][(last, last)] * rotation.sine.conj(),
                factors[0][(first + 1, first)] * rotation.cosine,
            )
            .0
        };

        for column in first..last {
            if column > first {
                let (next_rotation, diagonal) = complex_givens(
                    factors[0][(column, column - 1)],
                    factors[0][(column + 1, column - 1)],
                );
                rotation = next_rotation;
                factors[0][(column, column - 1)] = diagonal;
                factors[0][(column + 1, column - 1)] = Complex::new(0.0, 0.0);
            }
            apply_givens_left(&mut factors[0], column, column + 1, rotation, column, dim);
            if let Some(bases) = bases.as_deref_mut() {
                apply_givens_adjoint_right(&mut bases[0], column, column + 1, rotation, 0, dim);
            }

            for factor_index in (1..period).rev() {
                apply_givens_adjoint_right(
                    &mut factors[factor_index],
                    column,
                    column + 1,
                    rotation,
                    0,
                    column + 2,
                );
                let (next_rotation, diagonal) = complex_givens(
                    factors[factor_index][(column, column)],
                    factors[factor_index][(column + 1, column)],
                );
                rotation = next_rotation;
                factors[factor_index][(column, column)] = diagonal;
                factors[factor_index][(column + 1, column)] = Complex::new(0.0, 0.0);
                apply_givens_left(
                    &mut factors[factor_index],
                    column,
                    column + 1,
                    rotation,
                    column + 1,
                    dim,
                );
                if let Some(bases) = bases.as_deref_mut() {
                    apply_givens_adjoint_right(
                        &mut bases[factor_index],
                        column,
                        column + 1,
                        rotation,
                        0,
                        dim,
                    );
                }
            }
            apply_givens_adjoint_right(
                &mut factors[0],
                column,
                column + 1,
                rotation,
                0,
                (column + 3).min(dim),
            );
        }
    }
    Ok(())
}

fn active_one_norm(matrix: &DMatrix<Complex<f64>>, first: usize, last: usize) -> f64 {
    (first..=last)
        .map(|column| {
            (first..=last)
                .map(|row| matrix[(row, column)].norm())
                .sum::<f64>()
        })
        .fold(0.0, f64::max)
}

fn safe_diagonal_product(
    factors: &[DMatrix<Complex<f64>>],
    index: usize,
    log_input_scale: f64,
) -> Complex<f64> {
    let mut mantissa = Complex::new(1.0, 0.0);
    let mut binary_exponent = 0i64;
    for factor in factors {
        let diagonal = factor[(index, index)];
        let factor_scale = active_one_norm(factor, 0, factor.nrows() - 1);
        let zero_tolerance =
            8.0 * f64::EPSILON * factor.nrows().max(1) as f64 * factor_scale.max(f64::MIN_POSITIVE);
        if diagonal.norm() <= zero_tolerance {
            return Complex::new(0.0, 0.0);
        }
        mantissa *= diagonal;
        let magnitude = mantissa.norm();
        if magnitude == 0.0 {
            return Complex::new(0.0, 0.0);
        }
        let shift = magnitude.log2().floor() as i64;
        mantissa *= 2.0f64.powi(-(shift.clamp(i32::MIN as i64, i32::MAX as i64) as i32));
        binary_exponent += shift;
    }
    let log_magnitude =
        mantissa.norm().ln() + binary_exponent as f64 * std::f64::consts::LN_2 + log_input_scale;
    let magnitude = if log_magnitude >= f64::MAX.ln() {
        f64::MAX
    } else if log_magnitude <= f64::MIN_POSITIVE.ln() {
        0.0
    } else {
        log_magnitude.exp()
    };
    if magnitude == 0.0 {
        Complex::new(0.0, 0.0)
    } else {
        Complex::from_polar(magnitude, mantissa.arg())
    }
}

fn schur_mesh_vectors(
    factors: &[DMatrix<Complex<f64>>],
    bases: &[DMatrix<Complex<f64>>],
    input_scales: &[f64],
    multipliers: &[(usize, Complex<f64>)],
    transfers: &[DMatrix<f64>],
) -> Result<Vec<Vec<Vec<Complex<f64>>>>> {
    let dim = factors[0].nrows();
    let period = factors.len();
    if bases.len() != period
        || input_scales.len() != period
        || multipliers.len() != dim
        || transfers.len() != period
    {
        bail!("Periodic Schur mode reconstruction received inconsistent factor metadata.");
    }

    let zero_targets = multipliers
        .iter()
        .filter_map(|(target, multiplier)| (multiplier.norm() == 0.0).then_some(*target))
        .collect::<Vec<_>>();
    let mut modes = vec![None; dim];
    if !zero_targets.is_empty() {
        let zero_modes = product_free_zero_mode_mesh_vectors(transfers, zero_targets.len())?;
        for (&target, mode) in zero_targets.iter().zip(zero_modes) {
            modes[target] = Some(mode);
        }
    }

    for &(target, multiplier) in multipliers {
        if multiplier.norm() == 0.0 {
            continue;
        }
        if !multiplier.re.is_finite() || !multiplier.im.is_finite() {
            bail!("Periodic Schur raw modes require finite multipliers.");
        }
        if input_scales.contains(&0.0) {
            bail!("A singular transfer sequence cannot have a nonzero periodic-Schur multiplier.");
        }
        let root = canonical_periodic_root(multiplier, period);
        let local_roots = input_scales
            .iter()
            .map(|scale| root / *scale)
            .collect::<Vec<_>>();
        let mut coordinates = vec![vec![Complex::new(0.0, 0.0); dim]; period];
        coordinates[0][target] = Complex::new(1.0, 0.0);
        for factor_index in 0..period - 1 {
            let diagonal = factors[factor_index][(target, target)];
            if diagonal.norm() == 0.0 {
                bail!("Periodic Schur factor has a zero diagonal in raw-mode reconstruction.");
            }
            coordinates[factor_index + 1][target] =
                local_roots[factor_index] * coordinates[factor_index][target] / diagonal;
        }

        for component in (0..target).rev() {
            let has_zero_diagonal = factors
                .iter()
                .any(|factor| factor[(component, component)].norm() == 0.0);
            let mut affine = Vec::with_capacity(period);
            let mut total_log_gain = 0.0;
            for factor_index in 0..period {
                let diagonal = factors[factor_index][(component, component)];
                let next = (factor_index + 1) % period;
                let coupling = (component + 1..=target)
                    .map(|column| {
                        factors[factor_index][(component, column)] * coordinates[next][column]
                    })
                    .sum::<Complex<f64>>();
                if has_zero_diagonal {
                    // Solve the triangular recurrence backward:
                    //
                    //   root_k x_k - diagonal_k x_(k+1) = coupling_k.
                    //
                    // Dividing by the nonzero root keeps nonzero modes
                    // well-defined when a different Schur direction is killed
                    // by a singular local factor.
                    affine.push((
                        diagonal / local_roots[factor_index],
                        coupling / local_roots[factor_index],
                    ));
                } else {
                    let gain = local_roots[factor_index] / diagonal;
                    let forcing = -coupling / diagonal;
                    total_log_gain += gain.norm().ln();
                    affine.push((gain, forcing));
                }
            }

            if has_zero_diagonal {
                let reversed = affine.iter().rev().copied().collect::<Vec<_>>();
                let initial = solve_cyclic_affine(&reversed)?;
                coordinates[0][component] = initial;
                let mut next_value = initial;
                for factor_index in (0..period).rev() {
                    let current = affine[factor_index].0 * next_value + affine[factor_index].1;
                    if factor_index > 0 {
                        coordinates[factor_index][component] = current;
                    }
                    next_value = current;
                }
            } else {
                let initial = solve_cyclic_affine(&affine)?;
                coordinates[0][component] = initial;
                if total_log_gain <= 0.0 {
                    for factor_index in 0..period - 1 {
                        coordinates[factor_index + 1][component] = affine[factor_index].0
                            * coordinates[factor_index][component]
                            + affine[factor_index].1;
                    }
                } else {
                    let mut next_value = initial;
                    for factor_index in (1..period).rev() {
                        let previous =
                            (next_value - affine[factor_index].1) / affine[factor_index].0;
                        coordinates[factor_index][component] = previous;
                        next_value = previous;
                    }
                }
            }
        }

        let mut anchor = &bases[0] * DVector::from_vec(coordinates[0].clone());
        let normalization = normalization_factor(anchor.as_mut_slice())?;
        for coordinate in &mut coordinates {
            for value in coordinate {
                *value *= normalization;
            }
        }

        let mut raw_mesh = Vec::with_capacity(period);
        for mesh_index in 0..period {
            let basis_index = (period - mesh_index) % period;
            let balanced =
                &bases[basis_index] * DVector::from_vec(coordinates[basis_index].clone());
            let power = safe_complex_power(root, mesh_index);
            raw_mesh.push(balanced.iter().map(|value| *value * power).collect());
        }
        modes[target] = Some(raw_mesh);
    }

    let mut by_mesh = vec![vec![Vec::new(); dim]; period];
    for (mode_index, mode) in modes.into_iter().enumerate() {
        let mode = mode.ok_or_else(|| {
            anyhow!(
                "Periodic Schur did not reconstruct raw mode {}.",
                mode_index + 1
            )
        })?;
        for (mesh_index, vector) in mode.into_iter().enumerate() {
            by_mesh[mesh_index][mode_index] = vector;
        }
    }
    Ok(by_mesh)
}

/// Compute the kernel of the full periodic product without ever forming that
/// product or the `(period * dimension)` block-cyclic operator.
///
/// Starting from the zero subspace at the closing boundary, walk backward and
/// compute
///
/// `S_i = { x : T_i x is in S_(i+1) }`.
///
/// If `U` spans `S_(i+1)`, this is the nullspace of
/// `(I - U U^T) T_i`. Each solve is only `dimension` square, so the method has
/// the same `O(period * dimension^3)` scaling as periodic Schur.
fn product_free_zero_mode_mesh_vectors(
    transfers: &[DMatrix<f64>],
    requested_modes: usize,
) -> Result<Vec<Vec<Vec<Complex<f64>>>>> {
    let first = transfers
        .first()
        .ok_or_else(|| anyhow!("Zero-multiplier modes require transfer matrices."))?;
    let dim = first.nrows();
    if requested_modes == 0 {
        return Ok(Vec::new());
    }
    if requested_modes > dim {
        bail!(
            "Requested {} zero-multiplier modes for dimension {}.",
            requested_modes,
            dim
        );
    }

    let mut preimage_basis = DMatrix::<f64>::zeros(dim, 0);
    for transfer in transfers.iter().rev() {
        let constrained = if preimage_basis.ncols() == 0 {
            transfer.clone()
        } else {
            transfer - &preimage_basis * (preimage_basis.transpose() * transfer)
        };
        preimage_basis = numerical_nullspace(&constrained, transfer.norm())?;
    }

    if preimage_basis.ncols() < requested_modes {
        bail!(
            "Periodic zero multiplier has algebraic multiplicity {}, but the product-free cocycle nullspace has geometric multiplicity {}.",
            requested_modes,
            preimage_basis.ncols()
        );
    }
    let anchors = canonical_subspace_basis(&preimage_basis, requested_modes)?;
    let mut modes = Vec::with_capacity(requested_modes);
    for anchor in anchors {
        let mut current = anchor;
        let mut mesh = Vec::with_capacity(transfers.len());
        let mut trajectory_scale = 1.0f64;
        for transfer in transfers {
            mesh.push(
                current
                    .iter()
                    .map(|value| Complex::new(*value, 0.0))
                    .collect::<Vec<_>>(),
            );
            current = transfer * current;
            if current.iter().any(|value| !value.is_finite()) {
                bail!("Product-free zero-multiplier mode became non-finite.");
            }
            trajectory_scale = trajectory_scale.max(current.norm());
        }
        let closure_tolerance = 4096.0
            * f64::EPSILON
            * transfers.len().max(1) as f64
            * dim.max(1) as f64
            * trajectory_scale;
        if current.norm() > closure_tolerance {
            bail!(
                "Product-free zero-multiplier mode failed closure: residual {:.3e}, tolerance {:.3e}.",
                current.norm(),
                closure_tolerance
            );
        }
        modes.push(mesh);
    }
    Ok(modes)
}

fn numerical_nullspace(matrix: &DMatrix<f64>, reference_scale: f64) -> Result<DMatrix<f64>> {
    let dim = matrix.ncols();
    let svd = matrix.clone().svd(false, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Singular periodic-cocycle SVD did not return right vectors."))?;
    let tolerance = 8.0
        * f64::EPSILON
        * matrix.nrows().max(matrix.ncols()).max(1) as f64
        * reference_scale.max(f64::MIN_POSITIVE);
    let null_indices = svd
        .singular_values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| (*value <= tolerance).then_some(index))
        .collect::<Vec<_>>();
    Ok(DMatrix::from_fn(dim, null_indices.len(), |row, column| {
        v_t[(null_indices[column], row)]
    }))
}

/// Turn an arbitrary orthonormal basis into a deterministic coordinate-pivoted
/// basis. Projecting e_1, e_2, ... through the subspace projector removes the
/// arbitrary rotations and signs returned by an SVD for repeated zero modes.
fn canonical_subspace_basis(basis: &DMatrix<f64>, requested: usize) -> Result<Vec<DVector<f64>>> {
    let dim = basis.nrows();
    let projector = basis * basis.transpose();
    let mut selected: Vec<DVector<f64>> = Vec::with_capacity(requested);
    let tolerance = 4096.0 * f64::EPSILON * dim.max(1) as f64;
    for axis in 0..dim {
        let mut candidate = projector.column(axis).into_owned();
        for previous in &selected {
            candidate -= previous * previous.dot(&candidate);
        }
        let norm = candidate.norm();
        if norm <= tolerance {
            continue;
        }
        candidate /= norm;
        let pivot = candidate
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
            .map(|(index, _)| index)
            .unwrap_or(0);
        if candidate[pivot].is_sign_negative() {
            candidate *= -1.0;
        }
        selected.push(candidate);
        if selected.len() == requested {
            return Ok(selected);
        }
    }
    bail!(
        "Could not construct {} deterministic zero-multiplier modes from a rank-{} cocycle kernel.",
        requested,
        basis.ncols()
    )
}

fn solve_cyclic_affine(affine: &[(Complex<f64>, Complex<f64>)]) -> Result<Complex<f64>> {
    let total_log_gain = affine.iter().map(|(gain, _)| gain.norm().ln()).sum::<f64>();
    let (cycle_gain, cycle_forcing) = if total_log_gain <= 0.0 {
        let mut gain = Complex::new(1.0, 0.0);
        let mut forcing = Complex::new(0.0, 0.0);
        for &(local_gain, local_forcing) in affine {
            forcing = local_gain * forcing + local_forcing;
            gain *= local_gain;
        }
        (gain, forcing)
    } else {
        let mut gain = Complex::new(1.0, 0.0);
        let mut forcing = Complex::new(0.0, 0.0);
        for &(local_gain, local_forcing) in affine.iter().rev() {
            let inverse = Complex::new(1.0, 0.0) / local_gain;
            forcing = inverse * forcing - inverse * local_forcing;
            gain *= inverse;
        }
        (gain, forcing)
    };
    let denominator = Complex::new(1.0, 0.0) - cycle_gain;
    let tolerance = 4096.0 * f64::EPSILON * affine.len().max(1) as f64;
    if denominator.norm() <= tolerance {
        if cycle_forcing.norm() <= tolerance {
            return Ok(Complex::new(0.0, 0.0));
        }
        bail!("Periodic Schur multiplier is defective or numerically inseparable.");
    }
    Ok(cycle_forcing / denominator)
}

fn canonical_periodic_root(multiplier: Complex<f64>, period: usize) -> Complex<f64> {
    let log_modulus = multiplier.norm().ln() / period as f64;
    Complex::from_polar(log_modulus.exp(), multiplier.arg() / period as f64)
}

fn safe_complex_power(base: Complex<f64>, exponent: usize) -> Complex<f64> {
    if exponent == 0 {
        return Complex::new(1.0, 0.0);
    }
    let log_modulus = base.norm().ln() * exponent as f64;
    let magnitude = if log_modulus >= f64::MAX.ln() {
        f64::MAX
    } else if log_modulus <= f64::MIN_POSITIVE.ln() {
        0.0
    } else {
        log_modulus.exp()
    };
    Complex::from_polar(magnitude, base.arg() * exponent as f64)
}

fn normalization_factor(vector: &mut [Complex<f64>]) -> Result<Complex<f64>> {
    let norm = vector
        .iter()
        .map(|value| value.norm_sqr())
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= 1e-14 {
        bail!("Periodic Schur eigenvector has zero or non-finite norm.");
    }
    let pivot = vector
        .iter()
        .copied()
        .max_by(|a, b| a.norm_sqr().total_cmp(&b.norm_sqr()))
        .unwrap_or_else(|| Complex::new(1.0, 0.0));
    let phase = if pivot.norm() == 0.0 {
        Complex::new(1.0, 0.0)
    } else {
        pivot.conj() / pivot.norm()
    };
    Ok(phase / norm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    fn rotation(angle: f64) -> DMatrix<f64> {
        DMatrix::from_row_slice(2, 2, &[angle.cos(), -angle.sin(), angle.sin(), angle.cos()])
    }

    fn rotation_3d(angle: f64, tilt: f64) -> DMatrix<f64> {
        let (c, s) = (angle.cos(), angle.sin());
        let (ct, st) = (tilt.cos(), tilt.sin());
        DMatrix::from_row_slice(3, 3, &[c * ct, -s, c * st, s * ct, c, s * st, -st, 0.0, ct])
    }

    fn rossler_scale_basis(phase: f64) -> DMatrix<f64> {
        let mut shear = DMatrix::identity(3, 3);
        shear[(0, 1)] = 18.0 * phase.sin();
        shear[(1, 2)] = 11.0 * (2.0 * phase).cos();
        shear[(0, 2)] = 7.0 * (3.0 * phase).sin();
        rotation_3d(phase, 0.37 * (2.0 * phase).sin()) * shear
    }

    fn sorted_log_moduli(values: &[Complex<f64>]) -> Vec<f64> {
        let mut logs = values
            .iter()
            .map(|value| value.norm().ln())
            .collect::<Vec<_>>();
        logs.sort_by(f64::total_cmp);
        logs
    }

    fn assert_mode_cocycle(
        transfers: &[DMatrix<f64>],
        spectrum: &PeriodicSchurSpectrum,
        mode_index: usize,
        tolerance: f64,
    ) {
        for interval in 0..transfers.len() {
            let current = DVector::from_vec(spectrum.mesh_vectors[interval][mode_index].clone());
            let transported = transfers[interval].map(|value| Complex::new(value, 0.0)) * current;
            let expected = if interval + 1 < transfers.len() {
                spectrum.mesh_vectors[interval + 1][mode_index].clone()
            } else {
                spectrum.mesh_vectors[0][mode_index]
                    .iter()
                    .map(|value| *value * spectrum.multipliers[mode_index])
                    .collect()
            };
            let residual = transported
                .iter()
                .zip(&expected)
                .map(|(actual, expected)| (*actual - *expected).norm_sqr())
                .sum::<f64>()
                .sqrt();
            let scale = transported
                .iter()
                .chain(&expected)
                .map(|value| value.norm_sqr())
                .sum::<f64>()
                .sqrt()
                .max(1.0);
            assert!(
                residual / scale <= tolerance,
                "cocycle residual={} at interval {interval}, mode {mode_index}",
                residual / scale
            );
        }
    }

    #[test]
    fn periodic_schur_matches_scalar_and_complex_products() {
        let scalar = vec![
            DMatrix::from_element(1, 1, 2.0),
            DMatrix::from_element(1, 1, 0.25),
            DMatrix::from_element(1, 1, 3.0),
        ];
        let spectrum =
            periodic_schur_floquet_spectrum(&scalar, true).expect("scalar periodic Schur spectrum");
        assert_eq!(spectrum.multipliers.len(), 1);
        assert!((spectrum.multipliers[0] - Complex::new(1.5, 0.0)).norm() < 1e-12);
        assert_eq!(spectrum.mesh_vectors[0].len(), 1);
        assert!((spectrum.mesh_vectors[0][0][0].norm() - 1.0).abs() < 1e-12);

        let interval_count = 17usize;
        let radius = 1.7f64;
        let angle = 0.8f64;
        let local =
            rotation(angle / interval_count as f64) * radius.powf(1.0 / interval_count as f64);
        let transfers = vec![local; interval_count];
        let spectrum = periodic_schur_floquet_spectrum(&transfers, false)
            .expect("complex periodic Schur spectrum");
        assert_eq!(spectrum.multipliers.len(), 2);
        for multiplier in spectrum.multipliers {
            assert!((multiplier.norm() - radius).abs() < 2e-10);
            assert!((multiplier.im.abs() - radius * angle.sin()).abs() < 2e-10);
        }
    }

    #[test]
    fn periodic_schur_preserves_stiff_rotating_directions() {
        let interval_count = 80usize;
        let exponent = 128.0f64;
        let local = DMatrix::from_diagonal(&nalgebra::DVector::from_vec(vec![
            (exponent / interval_count as f64).exp(),
            (-exponent / interval_count as f64).exp(),
        ]));
        let mut transfers = Vec::with_capacity(interval_count);
        for interval in 0..interval_count {
            let current = rotation(2.0 * PI * interval as f64 / interval_count as f64);
            let next = rotation(2.0 * PI * (interval + 1) as f64 / interval_count as f64);
            transfers.push(next * &local * current.transpose());
        }

        let spectrum = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("stiff periodic Schur spectrum");
        let logs = sorted_log_moduli(&spectrum.multipliers);
        assert!((logs[0] + exponent).abs() < 2e-8, "logs={logs:?}");
        assert!((logs[1] - exponent).abs() < 2e-8, "logs={logs:?}");

        for mode_index in 0..spectrum.multipliers.len() {
            for interval in 0..interval_count {
                let current = &spectrum.mesh_vectors[interval][mode_index];
                let expected = if interval + 1 < interval_count {
                    spectrum.mesh_vectors[interval + 1][mode_index].clone()
                } else {
                    spectrum.mesh_vectors[0][mode_index]
                        .iter()
                        .map(|value| *value * spectrum.multipliers[mode_index])
                        .collect()
                };
                let transported = (&transfers[interval].map(|value| Complex::new(value, 0.0))
                    * nalgebra::DVector::from_vec(current.clone()))
                .iter()
                .copied()
                .collect::<Vec<_>>();
                let residual = transported
                    .iter()
                    .zip(&expected)
                    .map(|(actual, expected)| (*actual - *expected).norm_sqr())
                    .sum::<f64>()
                    .sqrt();
                let scale = transported
                    .iter()
                    .chain(&expected)
                    .map(|value| value.norm_sqr())
                    .sum::<f64>()
                    .sqrt()
                    .max(f64::MIN_POSITIVE);
                assert!(
                    residual / scale < 2e-8,
                    "cocycle residual={} at interval {interval}, mode {mode_index}",
                    residual / scale
                );
            }
        }
    }

    #[test]
    fn periodic_schur_converges_for_nearly_repeated_rossler_scale_multipliers() {
        let interval_count = 300usize;
        let target_multipliers: [f64; 3] = [1.0 - 1.0e-12, 1.0, 1.413];
        let local = DMatrix::from_diagonal(&DVector::from_iterator(
            3,
            target_multipliers
                .iter()
                .map(|value| value.powf(1.0 / interval_count as f64)),
        ));
        let mut transfers = Vec::with_capacity(interval_count);
        for interval in 0..interval_count {
            let phase = 2.0 * PI * interval as f64 / interval_count as f64;
            let next_phase = 2.0 * PI * (interval + 1) as f64 / interval_count as f64;
            let current = rossler_scale_basis(phase);
            let next = rossler_scale_basis(next_phase);
            transfers
                .push(next * &local * current.try_inverse().expect("invertible periodic basis"));
        }

        let spectrum = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("Rössler-scale periodic Schur spectrum");
        for (actual, expected) in spectrum.multipliers.iter().zip(target_multipliers) {
            assert!((actual.re - expected).abs() < 2e-8, "actual={actual:?}");
            assert!(actual.im.abs() < 2e-8, "actual={actual:?}");
        }
    }

    #[test]
    fn periodic_schur_scales_past_the_dense_block_limit() {
        let interval_count = 1100usize;
        let exponent = 40.0f64;
        let local = DMatrix::from_diagonal(&nalgebra::DVector::from_vec(vec![
            (exponent / interval_count as f64).exp(),
            (-exponent / interval_count as f64).exp(),
        ]));
        let transfers = vec![local; interval_count];

        let spectrum = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("large-mesh periodic Schur spectrum");
        let logs = sorted_log_moduli(&spectrum.multipliers);
        assert!((logs[0] + exponent).abs() < 2e-9, "logs={logs:?}");
        assert!((logs[1] - exponent).abs() < 2e-9, "logs={logs:?}");
        assert_eq!(spectrum.mesh_vectors[0].len(), 2);
    }

    #[test]
    fn periodic_schur_returns_product_free_zero_mode_past_dense_limit() {
        let interval_count = 1100usize;
        let singular_interval = 437usize;
        let mut transfers = Vec::with_capacity(interval_count);
        for interval in 0..interval_count {
            let phase = 2.0 * PI * interval as f64 / interval_count as f64;
            let next_phase = 2.0 * PI * (interval + 1) as f64 / interval_count as f64;
            let current = rotation(0.63 * phase.sin());
            let next = rotation(0.63 * next_phase.sin());
            let first = if interval == singular_interval {
                0.0
            } else {
                1.0001
            };
            let local = DMatrix::from_diagonal(&DVector::from_vec(vec![first, 1.0002]));
            transfers.push(next * local * current.transpose());
        }

        let spectrum = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("large singular periodic Schur spectrum and raw modes");
        let zero_index = spectrum
            .multipliers
            .iter()
            .position(|value| value.norm() == 0.0)
            .expect("one zero multiplier");
        assert_eq!(
            spectrum
                .multipliers
                .iter()
                .filter(|value| value.norm() == 0.0)
                .count(),
            1
        );
        let anchor_norm = spectrum.mesh_vectors[0][zero_index]
            .iter()
            .map(|value| value.norm_sqr())
            .sum::<f64>()
            .sqrt();
        assert!((anchor_norm - 1.0).abs() < 1e-10);
        assert_mode_cocycle(&transfers, &spectrum, zero_index, 2e-10);
    }

    #[test]
    fn periodic_schur_returns_deterministic_repeated_zero_modes() {
        let interval_count = 31usize;
        let mut transfers = Vec::with_capacity(interval_count);
        for interval in 0..interval_count {
            let phase = 2.0 * PI * interval as f64 / interval_count as f64;
            let next_phase = 2.0 * PI * (interval + 1) as f64 / interval_count as f64;
            let current = rotation_3d(0.4 * phase.sin(), 0.3 * phase.cos());
            let next = rotation_3d(0.4 * next_phase.sin(), 0.3 * next_phase.cos());
            let local = if interval == 13 {
                DMatrix::from_diagonal(&DVector::from_vec(vec![0.0, 0.0, 1.01]))
            } else {
                DMatrix::from_diagonal(&DVector::from_vec(vec![1.02, 0.99, 1.01]))
            };
            transfers.push(next * local * current.transpose());
        }

        let first = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("repeated-zero periodic Schur modes");
        let second = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("deterministic repeated-zero periodic Schur modes");
        let zero_indices = first
            .multipliers
            .iter()
            .enumerate()
            .filter_map(|(index, value)| (value.norm() == 0.0).then_some(index))
            .collect::<Vec<_>>();
        assert_eq!(zero_indices.len(), 2);
        for &mode_index in &zero_indices {
            assert_mode_cocycle(&transfers, &first, mode_index, 2e-10);
            for component in 0..3 {
                assert!(
                    (first.mesh_vectors[0][mode_index][component]
                        - second.mesh_vectors[0][mode_index][component])
                        .norm()
                        < 1e-12
                );
            }
        }
        let overlap = first.mesh_vectors[0][zero_indices[0]]
            .iter()
            .zip(&first.mesh_vectors[0][zero_indices[1]])
            .map(|(left, right)| left.conj() * right)
            .sum::<Complex<f64>>();
        assert!(overlap.norm() < 1e-10);
    }

    #[test]
    fn periodic_schur_preserves_representable_tiny_nonzero_mode() {
        let interval_count = 1usize;
        let target = 1.0e-14f64;
        let local = DMatrix::from_diagonal(&DVector::from_vec(vec![
            target.powf(1.0 / interval_count as f64),
            1.01,
        ]));
        let transfers = vec![local; interval_count];
        let spectrum = periodic_schur_floquet_spectrum(&transfers, true)
            .expect("representable tiny periodic Schur mode");
        assert!(spectrum.multipliers[0].norm() > 0.0);
        assert!((spectrum.multipliers[0].norm().ln() - target.ln()).abs() < 1e-9);
        assert_mode_cocycle(&transfers, &spectrum, 0, 2e-10);
    }

    #[test]
    fn periodic_schur_reports_defective_zero_mode_multiplicity() {
        let transfers = vec![DMatrix::from_row_slice(2, 2, &[0.0, 1.0, 0.0, 0.0])];
        let error = periodic_schur_floquet_spectrum(&transfers, true)
            .expect_err("defective zero multiplier should not fabricate a raw-mode basis");
        let message = error.to_string();
        assert!(message.contains("algebraic multiplicity 2"), "{message}");
        assert!(message.contains("geometric multiplicity 1"), "{message}");
    }
}
