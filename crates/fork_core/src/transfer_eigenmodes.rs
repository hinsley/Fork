use anyhow::{anyhow, bail, Result};
use nalgebra::{linalg::Schur, ComplexField, DMatrix, DVector};
use num_complex::Complex64;
use serde::Serialize;
use std::collections::VecDeque;

pub const MAX_EIGENMODE_GROUPS: usize = 48;
pub const MAX_KRYLOV_DIMENSION: usize = 96;
pub const MAX_KRYLOV_BASIS_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_PERSISTED_MODE_COMPONENTS: usize = 2_000_000;

const MIN_SUBSPACE_PADDING: usize = 6;
const MIN_KRYLOV_DIMENSION: usize = 12;
const BREAKDOWN_TOLERANCE: f64 = 1.0e-13;
const CONJUGATE_TOLERANCE: f64 = 1.0e-8;
const STOCHASTIC_TOLERANCE: f64 = 1.0e-10;

#[derive(Debug, Clone, PartialEq)]
pub struct SparseColumnMatrix {
    dimension: usize,
    column_offsets: Vec<usize>,
    row_indices: Vec<usize>,
    values: Vec<f64>,
}

impl SparseColumnMatrix {
    pub fn new(
        dimension: usize,
        column_offsets: Vec<usize>,
        row_indices: Vec<usize>,
        values: Vec<f64>,
    ) -> Result<Self> {
        if dimension == 0 {
            bail!("Eigenmode analysis requires a non-empty transfer operator.");
        }
        if column_offsets.len() != dimension + 1
            || column_offsets.first().copied() != Some(0)
            || column_offsets.last().copied() != Some(values.len())
            || row_indices.len() != values.len()
            || column_offsets.windows(2).any(|pair| pair[0] > pair[1])
        {
            bail!("Sparse transfer-operator columns are malformed.");
        }
        if row_indices.iter().any(|row| *row >= dimension)
            || values
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
        {
            bail!("Sparse transfer-operator entries are invalid.");
        }
        Ok(Self {
            dimension,
            column_offsets,
            row_indices,
            values,
        })
    }

    pub fn dimension(&self) -> usize {
        self.dimension
    }

    pub fn nonzero_count(&self) -> usize {
        self.values.len()
    }

    fn apply_complex(&self, input: &[Complex64], output: &mut [Complex64]) {
        output.fill(Complex64::new(0.0, 0.0));
        for (source, &source_value) in input.iter().enumerate().take(self.dimension) {
            for edge in self.column_offsets[source]..self.column_offsets[source + 1] {
                output[self.row_indices[edge]] += source_value * self.values[edge];
            }
        }
    }

    fn structure_diagnostics(&self) -> MarkovStructureDiagnostics {
        let mass_preserving = (0..self.dimension).all(|source| {
            let sum = self.values[self.column_offsets[source]..self.column_offsets[source + 1]]
                .iter()
                .sum::<f64>();
            (sum - 1.0).abs() <= STOCHASTIC_TOLERANCE
        });
        let (component_count, closed_component_count) = self.strong_components();
        let reducible = component_count > 1;
        let period = if mass_preserving && !reducible {
            Some(self.irreducible_period())
        } else {
            None
        };
        MarkovStructureDiagnostics {
            mass_preserving,
            reducible,
            component_count,
            closed_component_count,
            stationary_simple: mass_preserving && closed_component_count == 1,
            period,
        }
    }

    fn strong_components(&self) -> (usize, usize) {
        let mut reverse = vec![Vec::new(); self.dimension];
        for source in 0..self.dimension {
            for edge in self.column_offsets[source]..self.column_offsets[source + 1] {
                if self.values[edge] > 0.0 {
                    reverse[self.row_indices[edge]].push(source);
                }
            }
        }

        let mut visited = vec![false; self.dimension];
        let mut finish_order = Vec::with_capacity(self.dimension);
        for root in 0..self.dimension {
            if visited[root] {
                continue;
            }
            visited[root] = true;
            let mut stack = vec![(root, self.column_offsets[root])];
            while let Some((node, next_edge)) = stack.last_mut() {
                let end = self.column_offsets[*node + 1];
                if *next_edge < end {
                    let edge = *next_edge;
                    *next_edge += 1;
                    if self.values[edge] <= 0.0 {
                        continue;
                    }
                    let target = self.row_indices[edge];
                    if !visited[target] {
                        visited[target] = true;
                        stack.push((target, self.column_offsets[target]));
                    }
                } else {
                    finish_order.push(*node);
                    stack.pop();
                }
            }
        }

        let mut component = vec![usize::MAX; self.dimension];
        let mut component_count = 0;
        for &root in finish_order.iter().rev() {
            if component[root] != usize::MAX {
                continue;
            }
            component[root] = component_count;
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                for &target in &reverse[node] {
                    if component[target] == usize::MAX {
                        component[target] = component_count;
                        stack.push(target);
                    }
                }
            }
            component_count += 1;
        }

        let mut closed = vec![true; component_count];
        for source in 0..self.dimension {
            for edge in self.column_offsets[source]..self.column_offsets[source + 1] {
                if self.values[edge] > 0.0 && component[source] != component[self.row_indices[edge]]
                {
                    closed[component[source]] = false;
                }
            }
        }
        (
            component_count,
            closed.into_iter().filter(|value| *value).count(),
        )
    }

    fn irreducible_period(&self) -> usize {
        let mut depth = vec![usize::MAX; self.dimension];
        depth[0] = 0;
        let mut queue = VecDeque::from([0]);
        while let Some(source) = queue.pop_front() {
            for edge in self.column_offsets[source]..self.column_offsets[source + 1] {
                if self.values[edge] <= 0.0 {
                    continue;
                }
                let target = self.row_indices[edge];
                if depth[target] == usize::MAX {
                    depth[target] = depth[source] + 1;
                    queue.push_back(target);
                }
            }
        }
        let mut period = 0usize;
        for source in 0..self.dimension {
            for edge in self.column_offsets[source]..self.column_offsets[source + 1] {
                if self.values[edge] <= 0.0 {
                    continue;
                }
                let target = self.row_indices[edge];
                let difference =
                    (depth[source] as isize + 1 - depth[target] as isize).unsigned_abs();
                period = greatest_common_divisor(period, difference);
            }
        }
        period.max(1)
    }
}

fn greatest_common_divisor(mut left: usize, mut right: usize) -> usize {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SparseEigenmodePhase {
    BuildingKrylov,
    Restarting,
    FinalizingModes,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SparseEigenmodeProgress {
    pub phase: SparseEigenmodePhase,
    pub matrix_vector_products: usize,
    pub max_matrix_vector_products: usize,
    pub restart_count: usize,
    pub max_restarts: usize,
    pub subspace_dimension: usize,
    pub max_subspace_dimension: usize,
    pub converged_modes: usize,
    pub requested_modes: usize,
    pub best_residual: Option<f64>,
    pub tolerance: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RestartedArnoldiSettings {
    pub requested_modes: usize,
    pub tolerance: f64,
    pub max_restarts: usize,
    pub max_subspace_dimension: usize,
}

impl RestartedArnoldiSettings {
    pub fn bounded(
        operator_dimension: usize,
        requested_modes: usize,
        tolerance: f64,
        max_restarts: usize,
    ) -> Result<Self> {
        if requested_modes == 0 || requested_modes > MAX_EIGENMODE_GROUPS {
            bail!(
                "Request between 1 and {} nontrivial eigenmodes.",
                MAX_EIGENMODE_GROUPS
            );
        }
        if requested_modes > max_supported_mode_count(operator_dimension) {
            bail!(
                "This {}-cell cover supports at most {} persisted eigenmodes within the browser memory limit.",
                operator_dimension,
                max_supported_mode_count(operator_dimension)
            );
        }
        if !tolerance.is_finite() || tolerance <= 0.0 {
            bail!("Eigenmode tolerance must be positive.");
        }
        if max_restarts == 0 {
            bail!("Eigenmode restart limit must be positive.");
        }
        let max_subspace_dimension =
            recommended_subspace_dimension(operator_dimension, requested_modes)?;
        Ok(Self {
            requested_modes,
            tolerance,
            max_restarts,
            max_subspace_dimension,
        })
    }
}

pub fn max_supported_mode_count(operator_dimension: usize) -> usize {
    if operator_dimension < 2 {
        return 0;
    }
    let result_limit = MAX_PERSISTED_MODE_COMPONENTS / operator_dimension.saturating_mul(2);
    let spectral_limit = operator_dimension - 1;
    (1..=MAX_EIGENMODE_GROUPS.min(spectral_limit))
        .take_while(|requested| {
            *requested <= result_limit
                && recommended_subspace_dimension(operator_dimension, *requested).is_ok()
        })
        .last()
        .unwrap_or(0)
}

fn recommended_subspace_dimension(
    operator_dimension: usize,
    requested_modes: usize,
) -> Result<usize> {
    let raw_target = (requested_modes.saturating_mul(2) + 3).min(operator_dimension);
    let desired = (raw_target + MIN_SUBSPACE_PADDING)
        .max(MIN_KRYLOV_DIMENSION.min(operator_dimension))
        .min(MAX_KRYLOV_DIMENSION)
        .min(operator_dimension);
    let bytes_per_column = operator_dimension
        .checked_mul(std::mem::size_of::<Complex64>())
        .ok_or_else(|| anyhow!("Krylov basis size overflows usize."))?;
    let memory_columns = if bytes_per_column == 0 {
        0
    } else {
        MAX_KRYLOV_BASIS_BYTES / bytes_per_column
    };
    let memory_dimension = memory_columns.saturating_sub(1).min(MAX_KRYLOV_DIMENSION);
    let dimension = desired.min(memory_dimension).min(operator_dimension);
    let minimum = (raw_target + 2).min(operator_dimension);
    if dimension < minimum {
        bail!("The requested Krylov basis exceeds the bounded browser memory policy.");
    }
    Ok(dimension)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EigenmodeInterpretation {
    DensityRelaxation,
    AlternatingDensityRelaxation,
    OscillatoryDensityRelaxation,
    ApproximateUnconverged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpectralGapStatus {
    Available,
    OperatorNotMassPreserving,
    ReducibleOperator,
    NonUniqueStationaryMode,
    PeriodicOperator,
    StationaryModeNotConverged,
    SubdominantModeUnavailable,
    SubdominantModeNotConverged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EigenmodeReuseBehavior {
    CachedOperatorFreshRestart,
    CachedOperatorSavedModeWarmStart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkovStructureDiagnostics {
    pub mass_preserving: bool,
    pub reducible: bool,
    pub component_count: usize,
    pub closed_component_count: usize,
    pub stationary_simple: bool,
    pub period: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseEigenmode {
    pub rank: usize,
    pub eigenvalue_re: f64,
    pub eigenvalue_im: f64,
    pub modulus: f64,
    pub ritz_residual: f64,
    pub converged: bool,
    pub conjugate_pair: bool,
    pub interpretation: EigenmodeInterpretation,
    pub vector_real: Vec<f64>,
    pub vector_imaginary: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseEigenmodeResult {
    pub method: &'static str,
    pub requested_modes: usize,
    pub computed_modes: usize,
    pub represented_eigenpairs: usize,
    pub operator_dimension: usize,
    pub operator_nonzeros: usize,
    pub tolerance: f64,
    pub max_restarts: usize,
    pub restart_count: usize,
    pub max_subspace_dimension: usize,
    pub matrix_vector_products: usize,
    pub basis_persisted: bool,
    pub reuse_behavior: EigenmodeReuseBehavior,
    pub structure: MarkovStructureDiagnostics,
    pub spectral_gap: Option<f64>,
    pub spectral_gap_status: SpectralGapStatus,
    pub modes: Vec<SparseEigenmode>,
}

#[derive(Debug, Clone)]
struct RitzCandidate {
    eigenvalue: Complex64,
    projected_vector: DVector<Complex64>,
    residual_estimate: f64,
}

#[derive(Debug, Clone)]
struct SelectedCandidate {
    candidate: RitzCandidate,
    conjugate_pair: bool,
}

pub struct RestartedArnoldiRunner {
    operator: SparseColumnMatrix,
    settings: RestartedArnoldiSettings,
    stationary_eigenvalue: f64,
    stationary_residual: f64,
    reuse_behavior: EigenmodeReuseBehavior,
    structure: MarkovStructureDiagnostics,
    basis: Vec<Complex64>,
    hessenberg: DMatrix<Complex64>,
    residual_vector: Vec<Complex64>,
    next_column: usize,
    current_dimension: usize,
    restart_count: usize,
    matrix_vector_products: usize,
    phase: SparseEigenmodePhase,
    latest_candidates: Vec<RitzCandidate>,
    selected_candidates: Vec<SelectedCandidate>,
    finalized_modes: Vec<SparseEigenmode>,
    best_residual: Option<f64>,
    result: Option<SparseEigenmodeResult>,
}

impl RestartedArnoldiRunner {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        operator: SparseColumnMatrix,
        stationary_distribution: Vec<f64>,
        stationary_eigenvalue: f64,
        stationary_residual: f64,
        settings: RestartedArnoldiSettings,
        warm_start_real: &[f64],
        warm_start_imaginary: &[f64],
    ) -> Result<Self> {
        let n = operator.dimension();
        if stationary_distribution.len() != n
            || stationary_distribution
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
            || stationary_distribution.iter().sum::<f64>() <= 0.0
            || !stationary_eigenvalue.is_finite()
            || !stationary_residual.is_finite()
            || stationary_residual < 0.0
        {
            bail!("Stored stationary-mode data do not match the sparse operator.");
        }
        if warm_start_real.len() != warm_start_imaginary.len()
            || (!warm_start_real.is_empty() && !warm_start_real.len().is_multiple_of(n))
            || warm_start_real
                .iter()
                .chain(warm_start_imaginary)
                .any(|value| !value.is_finite())
        {
            bail!("Saved eigenmode warm-start data are malformed.");
        }
        let max_dimension = settings.max_subspace_dimension;
        let mut basis = vec![Complex64::new(0.0, 0.0); n * (max_dimension + 1)];
        let warm_count = if n == 0 { 0 } else { warm_start_real.len() / n };
        let mut initial = deterministic_start(n, 0);
        for mode in 0..warm_count {
            let weight = 1.0 / (mode + 2) as f64;
            for (row, value) in initial.iter_mut().enumerate() {
                let index = mode * n + row;
                *value += Complex64::new(
                    warm_start_real[index] * weight,
                    warm_start_imaginary[index] * weight,
                );
            }
        }
        normalize_vector(&mut initial)?;
        basis[..n].copy_from_slice(&initial);
        let stationary_vector: Vec<_> = stationary_distribution
            .iter()
            .map(|value| Complex64::new(*value, 0.0))
            .collect();
        let mut applied_stationary = vec![Complex64::new(0.0, 0.0); n];
        operator.apply_complex(&stationary_vector, &mut applied_stationary);
        let verified_stationary_residual = applied_stationary
            .iter()
            .zip(&stationary_vector)
            .map(|(applied, value)| (*applied - stationary_eigenvalue * *value).norm())
            .sum::<f64>();
        let structure = operator.structure_diagnostics();
        Ok(Self {
            operator,
            settings,
            stationary_eigenvalue,
            stationary_residual: stationary_residual.max(verified_stationary_residual),
            reuse_behavior: if warm_count > 0 {
                EigenmodeReuseBehavior::CachedOperatorSavedModeWarmStart
            } else {
                EigenmodeReuseBehavior::CachedOperatorFreshRestart
            },
            structure,
            basis,
            hessenberg: DMatrix::zeros(max_dimension + 1, max_dimension),
            residual_vector: vec![Complex64::new(0.0, 0.0); n],
            next_column: 0,
            current_dimension: 0,
            restart_count: 0,
            matrix_vector_products: 0,
            phase: SparseEigenmodePhase::BuildingKrylov,
            latest_candidates: Vec::new(),
            selected_candidates: Vec::new(),
            finalized_modes: Vec::new(),
            best_residual: None,
            result: None,
        })
    }

    pub fn progress(&self) -> SparseEigenmodeProgress {
        let converged_modes = select_nontrivial_candidates(
            &self.latest_candidates,
            self.stationary_eigenvalue,
            self.settings.requested_modes,
        )
        .into_iter()
        .filter(|candidate| candidate_converged(candidate, self.settings.tolerance))
        .count();
        SparseEigenmodeProgress {
            phase: self.phase,
            matrix_vector_products: self.matrix_vector_products,
            max_matrix_vector_products: self.settings.max_subspace_dimension
                * (self.settings.max_restarts + 1)
                + self.settings.requested_modes,
            restart_count: self.restart_count,
            max_restarts: self.settings.max_restarts,
            subspace_dimension: self.current_dimension,
            max_subspace_dimension: self.settings.max_subspace_dimension,
            converged_modes,
            requested_modes: self.settings.requested_modes,
            best_residual: self.best_residual,
            tolerance: self.settings.tolerance,
        }
    }

    pub fn is_complete(&self) -> bool {
        self.phase == SparseEigenmodePhase::Complete
    }

    pub fn advance(&mut self, operator_product_budget: usize) -> Result<()> {
        let mut remaining = operator_product_budget.max(1);
        while remaining > 0 && !self.is_complete() {
            match self.phase {
                SparseEigenmodePhase::BuildingKrylov => {
                    self.expand_one_column()?;
                    remaining -= 1;
                }
                SparseEigenmodePhase::Restarting => {
                    self.restart()?;
                    break;
                }
                SparseEigenmodePhase::FinalizingModes => {
                    if self.finalized_modes.len() < self.selected_candidates.len() {
                        self.finalize_one_mode()?;
                        remaining -= 1;
                    } else {
                        self.finish_result();
                    }
                }
                SparseEigenmodePhase::Complete => break,
            }
        }
        Ok(())
    }

    pub fn result(&self) -> Result<&SparseEigenmodeResult> {
        self.result
            .as_ref()
            .ok_or_else(|| anyhow!("Sparse eigenmode analysis is not complete."))
    }

    fn expand_one_column(&mut self) -> Result<()> {
        let n = self.operator.dimension();
        let column = self.next_column;
        let max_dimension = self.settings.max_subspace_dimension;
        if column >= max_dimension {
            self.analyze_cycle(false)?;
            return Ok(());
        }
        let input = self.basis_column(column).to_vec();
        let mut work = vec![Complex64::new(0.0, 0.0); n];
        self.operator.apply_complex(&input, &mut work);
        self.matrix_vector_products += 1;
        for _ in 0..2 {
            for basis_column in 0..=column {
                let coefficient = hermitian_dot(self.basis_column(basis_column), &work);
                self.hessenberg[(basis_column, column)] += coefficient;
                axpy(&mut work, self.basis_column(basis_column), -coefficient);
            }
        }
        let norm = vector_norm(&work);
        self.hessenberg[(column + 1, column)] = Complex64::new(norm, 0.0);
        self.current_dimension = column + 1;
        self.next_column = column + 1;
        if norm <= BREAKDOWN_TOLERANCE || self.next_column == max_dimension {
            self.residual_vector = work;
            self.analyze_cycle(norm <= BREAKDOWN_TOLERANCE)?;
            return Ok(());
        }
        let next_start = (column + 1) * n;
        for (destination, value) in self.basis[next_start..next_start + n].iter_mut().zip(work) {
            *destination = value / norm;
        }
        Ok(())
    }

    fn analyze_cycle(&mut self, happy_breakdown: bool) -> Result<()> {
        let dimension = self.current_dimension;
        if dimension == 0 {
            bail!("Arnoldi iteration produced an empty Krylov basis.");
        }
        self.latest_candidates = projected_ritz_candidates(
            &self.hessenberg,
            dimension,
            vector_norm(&self.residual_vector),
        )?;
        self.best_residual = self
            .latest_candidates
            .iter()
            .map(|candidate| candidate.residual_estimate)
            .filter(|value| value.is_finite())
            .min_by(f64::total_cmp);
        let selected = select_nontrivial_candidates(
            &self.latest_candidates,
            self.stationary_eigenvalue,
            self.settings.requested_modes,
        );
        let enough_converged = selected.len() >= self.settings.requested_modes
            && selected
                .iter()
                .take(self.settings.requested_modes)
                .all(|candidate| candidate_converged(candidate, self.settings.tolerance));
        if enough_converged
            || self.restart_count >= self.settings.max_restarts
            || dimension >= self.operator.dimension()
            || happy_breakdown
        {
            self.selected_candidates = selected;
            self.phase = if self.selected_candidates.is_empty() {
                SparseEigenmodePhase::Complete
            } else {
                SparseEigenmodePhase::FinalizingModes
            };
            if self.selected_candidates.is_empty() {
                self.finish_result();
            }
        } else {
            self.phase = SparseEigenmodePhase::Restarting;
        }
        Ok(())
    }

    fn restart(&mut self) -> Result<()> {
        let n = self.operator.dimension();
        let dimension = self.current_dimension;
        if dimension < 3 {
            self.selected_candidates = select_nontrivial_candidates(
                &self.latest_candidates,
                self.stationary_eigenvalue,
                self.settings.requested_modes,
            );
            self.phase = SparseEigenmodePhase::FinalizingModes;
            return Ok(());
        }
        let desired_keep = (self.settings.requested_modes.saturating_mul(2) + 3)
            .min(dimension - 1)
            .max(1);
        let shift_count = dimension - desired_keep;
        let mut shifts: Vec<_> = self
            .latest_candidates
            .iter()
            .map(|candidate| candidate.eigenvalue)
            .collect();
        shifts.sort_by(|left, right| {
            left.norm()
                .total_cmp(&right.norm())
                .then_with(|| left.re.total_cmp(&right.re))
                .then_with(|| left.im.total_cmp(&right.im))
        });
        shifts.truncate(shift_count);
        if shifts.is_empty() {
            self.selected_candidates = select_nontrivial_candidates(
                &self.latest_candidates,
                self.stationary_eigenvalue,
                self.settings.requested_modes,
            );
            self.phase = SparseEigenmodePhase::FinalizingModes;
            return Ok(());
        }

        let mut projected = DMatrix::from_fn(dimension, dimension, |row, column| {
            self.hessenberg[(row, column)]
        });
        let mut accumulated_q = DMatrix::<Complex64>::identity(dimension, dimension);
        for shift in shifts {
            let mut shifted = projected.clone();
            for diagonal in 0..dimension {
                shifted[(diagonal, diagonal)] -= shift;
            }
            let (q, r) = shifted.qr().unpack();
            projected = &r * &q;
            for diagonal in 0..dimension {
                projected[(diagonal, diagonal)] += shift;
            }
            accumulated_q *= q;
        }
        for column in 0..dimension {
            for row in column.saturating_add(2)..dimension {
                projected[(row, column)] = Complex64::new(0.0, 0.0);
            }
        }

        let old_basis = self.basis.clone();
        let mut transformed = vec![Complex64::new(0.0, 0.0); n * dimension];
        for new_column in 0..dimension {
            for old_column in 0..dimension {
                let coefficient = accumulated_q[(old_column, new_column)];
                if coefficient.norm_sqr() == 0.0 {
                    continue;
                }
                let source = &old_basis[old_column * n..(old_column + 1) * n];
                let destination = &mut transformed[new_column * n..(new_column + 1) * n];
                for row in 0..n {
                    destination[row] += source[row] * coefficient;
                }
            }
        }

        let mut residual = vec![Complex64::new(0.0, 0.0); n];
        let discarded_coefficient = projected[(desired_keep, desired_keep - 1)];
        let old_residual_coefficient = accumulated_q[(dimension - 1, desired_keep - 1)];
        for row in 0..n {
            residual[row] = transformed[desired_keep * n + row] * discarded_coefficient
                + self.residual_vector[row] * old_residual_coefficient;
        }

        self.basis.fill(Complex64::new(0.0, 0.0));
        self.basis[..desired_keep * n].copy_from_slice(&transformed[..desired_keep * n]);
        self.hessenberg.fill(Complex64::new(0.0, 0.0));
        for column in 0..desired_keep {
            for row in 0..desired_keep {
                self.hessenberg[(row, column)] = projected[(row, column)];
            }
        }
        for basis_column in 0..desired_keep {
            let correction = hermitian_dot(self.basis_column(basis_column), &residual);
            self.hessenberg[(basis_column, desired_keep - 1)] += correction;
            axpy(&mut residual, self.basis_column(basis_column), -correction);
        }
        let residual_norm = vector_norm(&residual);
        if residual_norm > BREAKDOWN_TOLERANCE {
            self.hessenberg[(desired_keep, desired_keep - 1)] = Complex64::new(residual_norm, 0.0);
            for (destination, &value) in self.basis[desired_keep * n..(desired_keep + 1) * n]
                .iter_mut()
                .zip(&residual)
            {
                *destination = value / residual_norm;
            }
        } else {
            let mut fresh = deterministic_start(n, self.restart_count + 1);
            for basis_column in 0..desired_keep {
                let coefficient = hermitian_dot(self.basis_column(basis_column), &fresh);
                axpy(&mut fresh, self.basis_column(basis_column), -coefficient);
            }
            normalize_vector(&mut fresh)?;
            self.basis[desired_keep * n..(desired_keep + 1) * n].copy_from_slice(&fresh);
            self.hessenberg[(desired_keep, desired_keep - 1)] = Complex64::new(0.0, 0.0);
        }
        self.residual_vector.fill(Complex64::new(0.0, 0.0));
        self.next_column = desired_keep;
        self.current_dimension = desired_keep;
        self.restart_count += 1;
        self.phase = SparseEigenmodePhase::BuildingKrylov;
        Ok(())
    }

    fn finalize_one_mode(&mut self) -> Result<()> {
        let selection = &self.selected_candidates[self.finalized_modes.len()];
        let dimension = selection.candidate.projected_vector.len();
        let n = self.operator.dimension();
        let mut vector = vec![Complex64::new(0.0, 0.0); n];
        for basis_column in 0..dimension {
            let coefficient = selection.candidate.projected_vector[basis_column];
            let basis = self.basis_column(basis_column);
            for row in 0..n {
                vector[row] += basis[row] * coefficient;
            }
        }
        normalize_mode_phase(&mut vector)?;
        let mut eigenvalue = selection.candidate.eigenvalue;
        if eigenvalue.im < -CONJUGATE_TOLERANCE {
            eigenvalue = eigenvalue.conj();
            for value in &mut vector {
                *value = value.conj();
            }
        }
        if eigenvalue.im.abs() <= CONJUGATE_TOLERANCE {
            eigenvalue.im = 0.0;
            for value in &mut vector {
                value.im = 0.0;
            }
            normalize_vector(&mut vector)?;
            orient_real_mode(&mut vector);
        }
        let mut applied = vec![Complex64::new(0.0, 0.0); n];
        self.operator.apply_complex(&vector, &mut applied);
        self.matrix_vector_products += 1;
        for (value, mode) in applied.iter_mut().zip(&vector) {
            *value -= eigenvalue * *mode;
        }
        let residual = vector_norm(&applied);
        let converged = residual <= self.settings.tolerance * eigenvalue.norm().max(1.0);
        let conjugate_pair = selection.conjugate_pair || eigenvalue.im.abs() > CONJUGATE_TOLERANCE;
        let interpretation = if !converged {
            EigenmodeInterpretation::ApproximateUnconverged
        } else if conjugate_pair {
            EigenmodeInterpretation::OscillatoryDensityRelaxation
        } else if eigenvalue.re < 0.0 {
            EigenmodeInterpretation::AlternatingDensityRelaxation
        } else {
            EigenmodeInterpretation::DensityRelaxation
        };
        self.finalized_modes.push(SparseEigenmode {
            rank: self.finalized_modes.len() + 1,
            eigenvalue_re: eigenvalue.re,
            eigenvalue_im: eigenvalue.im,
            modulus: eigenvalue.norm(),
            ritz_residual: residual,
            converged,
            conjugate_pair,
            interpretation,
            vector_real: vector.iter().map(|value| value.re).collect(),
            vector_imaginary: if conjugate_pair {
                vector.iter().map(|value| value.im).collect()
            } else {
                Vec::new()
            },
        });
        if self.finalized_modes.len() == self.selected_candidates.len() {
            self.finish_result();
        }
        Ok(())
    }

    fn finish_result(&mut self) {
        self.finalized_modes.sort_by(|left, right| {
            right
                .modulus
                .total_cmp(&left.modulus)
                .then_with(|| right.eigenvalue_re.total_cmp(&left.eigenvalue_re))
                .then_with(|| right.eigenvalue_im.total_cmp(&left.eigenvalue_im))
        });
        for (index, mode) in self.finalized_modes.iter_mut().enumerate() {
            mode.rank = index + 1;
        }
        let (spectral_gap, spectral_gap_status) = spectral_gap(
            &self.structure,
            self.stationary_eigenvalue,
            self.stationary_residual,
            self.settings.tolerance,
            self.finalized_modes.first(),
        );
        let represented_eigenpairs = self
            .finalized_modes
            .iter()
            .map(|mode| if mode.conjugate_pair { 2 } else { 1 })
            .sum();
        self.result = Some(SparseEigenmodeResult {
            method: "implicitly_restarted_arnoldi",
            requested_modes: self.settings.requested_modes,
            computed_modes: self.finalized_modes.len(),
            represented_eigenpairs,
            operator_dimension: self.operator.dimension(),
            operator_nonzeros: self.operator.nonzero_count(),
            tolerance: self.settings.tolerance,
            max_restarts: self.settings.max_restarts,
            restart_count: self.restart_count,
            max_subspace_dimension: self.settings.max_subspace_dimension,
            matrix_vector_products: self.matrix_vector_products,
            basis_persisted: false,
            reuse_behavior: self.reuse_behavior,
            structure: self.structure,
            spectral_gap,
            spectral_gap_status,
            modes: std::mem::take(&mut self.finalized_modes),
        });
        self.phase = SparseEigenmodePhase::Complete;
    }

    fn basis_column(&self, column: usize) -> &[Complex64] {
        let n = self.operator.dimension();
        &self.basis[column * n..(column + 1) * n]
    }
}

fn projected_ritz_candidates(
    hessenberg: &DMatrix<Complex64>,
    dimension: usize,
    residual_norm: f64,
) -> Result<Vec<RitzCandidate>> {
    let projected = DMatrix::from_fn(dimension, dimension, |row, column| {
        hessenberg[(row, column)]
    });
    let (_, triangular) = Schur::new(projected.clone()).unpack();
    let mut candidates = Vec::with_capacity(dimension);
    for index in 0..dimension {
        let eigenvalue = triangular[(index, index)];
        if !eigenvalue.is_finite() {
            continue;
        }
        let projected_vector = complex_eigenvector(&projected, eigenvalue)?;
        let residual_estimate = residual_norm * projected_vector[dimension - 1].norm();
        candidates.push(RitzCandidate {
            eigenvalue,
            projected_vector,
            residual_estimate,
        });
    }
    candidates.sort_by(|left, right| {
        right
            .eigenvalue
            .norm()
            .total_cmp(&left.eigenvalue.norm())
            .then_with(|| right.eigenvalue.re.total_cmp(&left.eigenvalue.re))
            .then_with(|| right.eigenvalue.im.total_cmp(&left.eigenvalue.im))
    });
    Ok(candidates)
}

fn complex_eigenvector(
    matrix: &DMatrix<Complex64>,
    eigenvalue: Complex64,
) -> Result<DVector<Complex64>> {
    let dimension = matrix.nrows();
    let mut shifted = matrix.clone();
    for index in 0..dimension {
        shifted[(index, index)] -= eigenvalue;
    }
    let svd = shifted.svd(false, true);
    let v_t = svd
        .v_t
        .ok_or_else(|| anyhow!("Projected eigensolve omitted right singular vectors."))?;
    let mut vector = DVector::from_iterator(
        dimension,
        (0..dimension).map(|index| v_t[(dimension - 1, index)].conj()),
    );
    let norm = vector.norm();
    if !norm.is_finite() || norm <= BREAKDOWN_TOLERANCE {
        bail!("Projected Ritz vector is degenerate.");
    }
    vector /= Complex64::new(norm, 0.0);
    Ok(vector)
}

fn select_nontrivial_candidates(
    candidates: &[RitzCandidate],
    stationary_eigenvalue: f64,
    requested_modes: usize,
) -> Vec<SelectedCandidate> {
    if candidates.is_empty() {
        return Vec::new();
    }
    let stationary_index = candidates
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (left.eigenvalue - Complex64::new(stationary_eigenvalue, 0.0))
                .norm()
                .total_cmp(&(right.eigenvalue - Complex64::new(stationary_eigenvalue, 0.0)).norm())
        })
        .map(|(index, _)| index);
    let mut selected = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if Some(index) == stationary_index {
            continue;
        }
        if candidate.eigenvalue.im < -CONJUGATE_TOLERANCE {
            let conjugate_present = candidates.iter().enumerate().any(|(other_index, other)| {
                other_index != index
                    && Some(other_index) != stationary_index
                    && (other.eigenvalue - candidate.eigenvalue.conj()).norm()
                        <= CONJUGATE_TOLERANCE * candidate.eigenvalue.norm().max(1.0)
            });
            if conjugate_present {
                continue;
            }
        }
        let is_complex = candidate.eigenvalue.im.abs() > CONJUGATE_TOLERANCE;
        let duplicate = selected.iter().any(|existing: &SelectedCandidate| {
            is_complex
                && (existing.candidate.eigenvalue - candidate.eigenvalue.conj()).norm()
                    <= CONJUGATE_TOLERANCE * candidate.eigenvalue.norm().max(1.0)
        });
        if duplicate {
            continue;
        }
        selected.push(SelectedCandidate {
            candidate: candidate.clone(),
            conjugate_pair: is_complex,
        });
        if selected.len() == requested_modes {
            break;
        }
    }
    selected
}

fn candidate_converged(candidate: &SelectedCandidate, tolerance: f64) -> bool {
    candidate.candidate.residual_estimate
        <= tolerance * candidate.candidate.eigenvalue.norm().max(1.0)
}

fn spectral_gap(
    structure: &MarkovStructureDiagnostics,
    stationary_eigenvalue: f64,
    stationary_residual: f64,
    tolerance: f64,
    subdominant: Option<&SparseEigenmode>,
) -> (Option<f64>, SpectralGapStatus) {
    if !structure.mass_preserving {
        return (None, SpectralGapStatus::OperatorNotMassPreserving);
    }
    if structure.reducible {
        return (None, SpectralGapStatus::ReducibleOperator);
    }
    if !structure.stationary_simple {
        return (None, SpectralGapStatus::NonUniqueStationaryMode);
    }
    if structure.period.unwrap_or(1) > 1 {
        return (None, SpectralGapStatus::PeriodicOperator);
    }
    if (stationary_eigenvalue - 1.0).abs() > tolerance || stationary_residual > tolerance {
        return (None, SpectralGapStatus::StationaryModeNotConverged);
    }
    let Some(mode) = subdominant else {
        return (None, SpectralGapStatus::SubdominantModeUnavailable);
    };
    if !mode.converged || mode.modulus > 1.0 + tolerance * 10.0 {
        return (None, SpectralGapStatus::SubdominantModeNotConverged);
    }
    (
        Some((1.0 - mode.modulus).max(0.0)),
        SpectralGapStatus::Available,
    )
}

fn deterministic_start(length: usize, stream: usize) -> Vec<Complex64> {
    let mut state = 0x9E37_79B9_7F4A_7C15_u64 ^ (stream as u64).wrapping_mul(0xD1B5_4A32_D192_ED03);
    (0..length)
        .map(|index| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let real = ((state >> 11) as f64 / ((1_u64 << 53) as f64)) - 0.5;
            let imaginary = ((index + stream) as f64 * 0.754_877_666).sin() * 0.05;
            Complex64::new(real, imaginary)
        })
        .collect()
}

fn normalize_vector(vector: &mut [Complex64]) -> Result<()> {
    let norm = vector_norm(vector);
    if !norm.is_finite() || norm <= BREAKDOWN_TOLERANCE {
        bail!("Krylov start vector is degenerate.");
    }
    for value in vector {
        *value /= norm;
    }
    Ok(())
}

fn normalize_mode_phase(vector: &mut [Complex64]) -> Result<()> {
    normalize_vector(vector)?;
    let pivot = vector
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.norm_sqr().total_cmp(&right.norm_sqr()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    let pivot_value = vector[pivot];
    if pivot_value.norm() <= BREAKDOWN_TOLERANCE {
        bail!("Ritz mode is degenerate.");
    }
    let rotation = pivot_value.conj() / pivot_value.norm();
    for value in vector {
        *value *= rotation;
    }
    Ok(())
}

fn orient_real_mode(vector: &mut [Complex64]) {
    let pivot = vector
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.re.abs().total_cmp(&right.re.abs()))
        .map(|(index, _)| index)
        .unwrap_or(0);
    if vector[pivot].re < 0.0 {
        for value in vector {
            *value = -*value;
        }
    }
}

fn hermitian_dot(left: &[Complex64], right: &[Complex64]) -> Complex64 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left.conj() * *right)
        .sum()
}

fn axpy(target: &mut [Complex64], source: &[Complex64], coefficient: Complex64) {
    for (target, source) in target.iter_mut().zip(source) {
        *target += coefficient * *source;
    }
}

fn vector_norm(vector: &[Complex64]) -> f64 {
    vector
        .iter()
        .map(|value| value.norm_sqr())
        .sum::<f64>()
        .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matrix_from_dense(columns: &[Vec<f64>]) -> SparseColumnMatrix {
        let dimension = columns.len();
        let mut column_offsets = vec![0];
        let mut row_indices = Vec::new();
        let mut values = Vec::new();
        for column in columns {
            assert_eq!(column.len(), dimension);
            for (row, value) in column.iter().copied().enumerate() {
                if value != 0.0 {
                    row_indices.push(row);
                    values.push(value);
                }
            }
            column_offsets.push(values.len());
        }
        SparseColumnMatrix::new(dimension, column_offsets, row_indices, values).unwrap()
    }

    fn solve(
        operator: SparseColumnMatrix,
        stationary: Vec<f64>,
        requested: usize,
        tolerance: f64,
    ) -> SparseEigenmodeResult {
        let settings =
            RestartedArnoldiSettings::bounded(operator.dimension(), requested, tolerance, 20)
                .unwrap();
        let mut runner = RestartedArnoldiRunner::new(
            operator,
            stationary,
            1.0,
            tolerance * 0.1,
            settings,
            &[],
            &[],
        )
        .unwrap();
        while !runner.is_complete() {
            runner.advance(1).unwrap();
        }
        runner.result().unwrap().clone()
    }

    #[test]
    fn two_state_aperiodic_chain_has_known_gap_and_right_mode() {
        let operator = matrix_from_dense(&[vec![0.9, 0.1], vec![0.2, 0.8]]);
        let result = solve(operator, vec![2.0 / 3.0, 1.0 / 3.0], 1, 1.0e-10);

        assert_eq!(result.modes.len(), 1);
        assert!((result.modes[0].eigenvalue_re - 0.7).abs() < 1.0e-8);
        assert!(result.modes[0].eigenvalue_im.abs() < 1.0e-10);
        assert!(result.modes[0].ritz_residual < 1.0e-8);
        assert_eq!(result.spectral_gap_status, SpectralGapStatus::Available);
        assert!((result.spectral_gap.unwrap() - 0.3).abs() < 1.0e-8);
        assert!(!result.structure.reducible);
        assert_eq!(result.structure.period, Some(1));
    }

    #[test]
    fn three_cycle_returns_one_complex_pair_and_marks_gap_periodic() {
        let operator = matrix_from_dense(&[
            vec![0.0, 1.0, 0.0],
            vec![0.0, 0.0, 1.0],
            vec![1.0, 0.0, 0.0],
        ]);
        let result = solve(operator, vec![1.0 / 3.0; 3], 1, 1.0e-10);

        assert_eq!(result.modes.len(), 1);
        let mode = &result.modes[0];
        assert!(mode.conjugate_pair);
        assert!((mode.modulus - 1.0).abs() < 1.0e-8);
        assert!((mode.eigenvalue_re + 0.5).abs() < 1.0e-8);
        assert!((mode.eigenvalue_im.abs() - 3.0_f64.sqrt() / 2.0).abs() < 1.0e-8);
        assert_eq!(result.structure.period, Some(3));
        assert_eq!(
            result.spectral_gap_status,
            SpectralGapStatus::PeriodicOperator
        );
        assert_eq!(result.spectral_gap, None);
    }

    #[test]
    fn damped_cycle_returns_converged_oscillatory_density_mode() {
        let operator = matrix_from_dense(&[
            vec![0.2, 0.8, 0.0],
            vec![0.0, 0.2, 0.8],
            vec![0.8, 0.0, 0.2],
        ]);
        let result = solve(operator, vec![1.0 / 3.0; 3], 1, 1.0e-10);

        let mode = &result.modes[0];
        assert!(mode.conjugate_pair);
        assert!((mode.eigenvalue_re + 0.2).abs() < 1.0e-8);
        assert!((mode.eigenvalue_im.abs() - 0.4 * 3.0_f64.sqrt()).abs() < 1.0e-8);
        assert_eq!(
            mode.interpretation,
            EigenmodeInterpretation::OscillatoryDensityRelaxation
        );
        assert_eq!(result.spectral_gap_status, SpectralGapStatus::Available);
    }

    #[test]
    fn reducible_chain_never_presents_a_mixing_gap() {
        let operator = matrix_from_dense(&[
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![0.5, 0.5, 0.0],
        ]);
        let result = solve(operator, vec![0.5, 0.5, 0.0], 1, 1.0e-9);

        assert!(result.structure.reducible);
        assert_eq!(result.structure.closed_component_count, 2);
        assert_eq!(
            result.spectral_gap_status,
            SpectralGapStatus::ReducibleOperator
        );
        assert_eq!(result.spectral_gap, None);
    }

    #[test]
    fn restart_converges_leading_diagonal_modes_without_dense_full_spectrum() {
        let dimension = 24;
        let columns: Vec<Vec<f64>> = (0..dimension)
            .map(|column| {
                let mut values = vec![0.0; dimension];
                values[column] = 1.0 - column as f64 * 0.025;
                values
            })
            .collect();
        let operator = matrix_from_dense(&columns);
        let settings = RestartedArnoldiSettings {
            requested_modes: 3,
            tolerance: 1.0e-8,
            max_restarts: 30,
            max_subspace_dimension: 10,
        };
        let mut stationary = vec![0.0; dimension];
        stationary[0] = 1.0;
        let mut runner =
            RestartedArnoldiRunner::new(operator, stationary, 1.0, 0.0, settings, &[], &[])
                .unwrap();
        while !runner.is_complete() {
            runner.advance(1).unwrap();
        }
        let result = runner.result().unwrap();

        assert!(result.restart_count > 0);
        assert_eq!(result.modes.len(), 3);
        for (mode, expected) in result.modes.iter().zip([0.975, 0.95, 0.925]) {
            assert!((mode.eigenvalue_re - expected).abs() < 2.0e-5);
            assert!(mode.ritz_residual < 1.0e-6);
        }
    }

    #[test]
    fn saved_modes_are_only_a_warm_start_and_the_basis_is_not_persisted() {
        let operator = matrix_from_dense(&[vec![0.9, 0.1], vec![0.2, 0.8]]);
        let settings = RestartedArnoldiSettings::bounded(2, 1, 1.0e-9, 5).unwrap();
        let mut runner = RestartedArnoldiRunner::new(
            operator,
            vec![2.0 / 3.0, 1.0 / 3.0],
            1.0,
            0.0,
            settings,
            &[1.0, -1.0],
            &[0.0, 0.0],
        )
        .unwrap();
        while !runner.is_complete() {
            runner.advance(1).unwrap();
        }
        let result = runner.result().unwrap();

        assert_eq!(
            result.reuse_behavior,
            EigenmodeReuseBehavior::CachedOperatorSavedModeWarmStart
        );
        assert!(!result.basis_persisted);
    }
}
