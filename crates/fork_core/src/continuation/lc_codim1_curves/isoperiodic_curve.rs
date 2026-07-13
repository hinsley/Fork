//! Isoperiodic curve continuation for limit cycles.
//!
//! Continues a limit cycle in two-parameter space with fixed period:
//! - Standard periodic collocation BVP for the cycle
//! - Isoperiodic condition: T - T_seed = 0

use super::{
    collocation_defect_estimate_on_mesh, explicit_profile_palc_weights_on_mesh,
    transfer_explicit_curve_aug, transfer_explicit_curve_state, CurveCollocationAdaptation,
    CurveMeshAdaptationDecision, FullProfilePhaseGauge,
};
use crate::continuation::periodic::{
    extract_multipliers_collocation, uniform_normalized_mesh, validated_normalized_mesh,
    CollocationAdaptationReport, CollocationAdaptivitySettings, CollocationCoefficients,
};
use crate::continuation::problem::{
    ContinuationProblem, PointDiagnostics, StepRejectionAction, TestFunctionValues,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};

/// Isoperiodic curve continuation problem.
///
/// Augmented state layout: [p1, stages..., meshes..., T, p2]
/// with stage-first LC storage.
pub struct IsoperiodicCurveProblem<'a> {
    /// The dynamical system
    system: &'a mut EquationSystem,
    /// Index of first active parameter
    param1_index: usize,
    /// Index of second active parameter
    param2_index: usize,
    /// State dimension
    dim: usize,
    /// Number of mesh intervals
    ntst: usize,
    /// Persistent normalized collocation interval boundaries.
    normalized_mesh: Vec<f64>,
    /// Collocation degree
    ncol: usize,
    /// Collocation coefficients
    coeffs: CollocationCoefficients,
    /// Integral phase condition on the complete Gauss collocation profile.
    phase_gauge: FullProfilePhaseGauge,
    /// Bounded a-posteriori mesh adaptation and provenance.
    adaptation: CurveCollocationAdaptation,
    /// Seed period to keep fixed on the curve
    target_period: f64,
    /// Cached BVP Jacobian for diagnostics
    cached_jac: Option<DMatrix<f64>>,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
}

impl<'a> IsoperiodicCurveProblem<'a> {
    /// Create a new isoperiodic curve continuation problem from a seed LC point.
    pub fn new(
        system: &'a mut EquationSystem,
        _lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        _param1_value: f64,
        _param2_value: f64,
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        Self::new_on_mesh(
            system,
            _lc_state,
            period,
            param1_index,
            param2_index,
            _param1_value,
            _param2_value,
            ncol,
            uniform_normalized_mesh(ntst),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_on_mesh(
        system: &'a mut EquationSystem,
        _lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        _param1_value: f64,
        _param2_value: f64,
        ncol: usize,
        normalized_mesh: Vec<f64>,
    ) -> Result<Self> {
        let ntst = normalized_mesh.len().saturating_sub(1);
        if ntst < 2 {
            bail!("Isoperiodic curve requires at least two mesh intervals");
        }
        let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
        if !period.is_finite() || period <= 0.0 {
            bail!("Selected point has no valid period");
        }

        if param1_index == param2_index {
            bail!("Isoperiodic curve continuation requires two distinct parameters");
        }

        if param1_index >= system.params.len() || param2_index >= system.params.len() {
            bail!("Unknown continuation parameter index");
        }

        let dim = system.equations.len();
        let coeffs = CollocationCoefficients::new(ncol)?;

        let stage_count = ntst * ncol;

        // Work arrays for evaluations
        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];

        let phase_gauge =
            FullProfilePhaseGauge::new_on_mesh(&normalized_mesh, ncol, dim, &coeffs.b)?;
        let adaptation = CurveCollocationAdaptation::new(&normalized_mesh, ncol)?;

        Ok(Self {
            system,
            param1_index,
            param2_index,
            dim,
            ntst,
            normalized_mesh,
            ncol,
            coeffs,
            phase_gauge,
            adaptation,
            target_period: period,
            cached_jac: None,
            work_f,
            work_j,
        })
    }

    pub fn normalized_mesh(&self) -> &[f64] {
        &self.normalized_mesh
    }

    pub fn set_collocation_adaptivity(
        &mut self,
        settings: CollocationAdaptivitySettings,
    ) -> Result<()> {
        self.adaptation.configure(settings)
    }

    pub fn adaptation_report(&self) -> &CollocationAdaptationReport {
        self.adaptation.report()
    }

    pub fn seed_adaptation_report(&mut self, report: CollocationAdaptationReport) -> Result<()> {
        self.adaptation
            .seed_report(report, &self.normalized_mesh, self.ncol)
    }

    fn interval_width(&self, interval: usize) -> f64 {
        self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]
    }

    /// Number of LC coordinates (stages + mesh states).
    fn ncoords(&self) -> usize {
        self.ntst * self.ncol * self.dim + (self.ntst + 1) * self.dim
    }

    /// Index of period T in augmented state.
    fn period_index(&self) -> usize {
        1 + self.ncoords()
    }

    /// Index of p2 in augmented state.
    fn param2_idx(&self) -> usize {
        self.period_index() + 1
    }

    /// Number of residual equations.
    fn n_eqs(&self) -> usize {
        // collocation + continuity + phase + fixed-period constraint + periodic BC
        self.ntst * self.ncol * self.dim + self.ntst * self.dim + 1 + 1 + self.dim
    }

    /// Row index of the fixed-period isoperiodic constraint.
    #[cfg(test)]
    fn fixed_period_row(&self) -> usize {
        let n_stages = self.ntst * self.ncol;
        let cont_row = n_stages * self.dim;
        let phase_row = cont_row + self.ntst * self.dim;
        phase_row + 1
    }

    fn get_p1(&self, aug: &DVector<f64>) -> f64 {
        aug[0]
    }

    fn get_p2(&self, aug: &DVector<f64>) -> f64 {
        aug[self.param2_idx()]
    }

    fn get_period(&self, aug: &DVector<f64>) -> f64 {
        aug[self.period_index()]
    }

    fn stage_slice<'b>(&self, aug: &'b [f64], interval: usize, stage: usize) -> &'b [f64] {
        let idx = interval * self.ncol + stage;
        let start = 1 + idx * self.dim;
        &aug[start..start + self.dim]
    }

    fn mesh_slice<'b>(&self, aug: &'b [f64], idx: usize) -> &'b [f64] {
        let actual = idx % (self.ntst + 1);
        let mesh_offset = 1 + self.ntst * self.ncol * self.dim;
        let start = mesh_offset + actual * self.dim;
        &aug[start..start + self.dim]
    }

    fn stage_profile<'b>(&self, aug: &'b DVector<f64>) -> &'b [f64] {
        let stage_len = self.ntst * self.ncol * self.dim;
        &aug.as_slice()[1..1 + stage_len]
    }

    fn defect_estimate(
        &mut self,
        aug: &DVector<f64>,
    ) -> Result<crate::continuation::periodic::CollocationDefectEstimate> {
        let aug_slice = aug.as_slice();
        let mesh_states = (0..=self.ntst)
            .map(|mesh| self.mesh_slice(aug_slice, mesh).to_vec())
            .collect::<Vec<_>>();
        let stage_states = (0..self.ntst)
            .flat_map(|interval| {
                (0..self.ncol)
                    .map(|stage| self.stage_slice(aug_slice, interval, stage).to_vec())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        collocation_defect_estimate_on_mesh(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug),
            &mesh_states,
            &stage_states,
            self.get_period(aug),
            &self.normalized_mesh,
            self.ncol,
            &self.coeffs.nodes,
        )
    }

    fn replace_mesh(
        &mut self,
        normalized_mesh: Vec<f64>,
        accepted_aug: &DVector<f64>,
    ) -> Result<()> {
        let ntst = normalized_mesh.len().saturating_sub(1);
        let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
        let mut phase_gauge = FullProfilePhaseGauge::new_on_mesh(
            &normalized_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.b,
        )?;
        let stage_len = ntst * self.ncol * self.dim;
        let mesh_len = (ntst + 1) * self.dim;
        let profile_end = 1 + stage_len + mesh_len;
        if accepted_aug.len() != profile_end + 2 {
            bail!("Transferred isoperiodic state has an invalid collocation layout");
        }
        phase_gauge.set_reference(
            self.system,
            self.param1_index,
            self.param2_index,
            accepted_aug[0],
            accepted_aug[profile_end + 1],
            accepted_aug[profile_end],
            &accepted_aug.as_slice()[1..1 + stage_len],
        )?;
        self.ntst = ntst;
        self.normalized_mesh = normalized_mesh;
        self.phase_gauge = phase_gauge;
        self.cached_jac = None;
        self.work_f.resize(ntst * self.ncol * self.dim, 0.0);
        self.work_j
            .resize(ntst * self.ncol * self.dim * self.dim, 0.0);
        Ok(())
    }

    fn set_phase_reference(&mut self, aug: &DVector<f64>) -> Result<()> {
        let stages = self.stage_profile(aug);
        self.phase_gauge.set_reference(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug),
            self.get_period(aug),
            stages,
        )
    }

    fn ensure_phase_reference(&mut self, aug: &DVector<f64>) -> Result<()> {
        if !self.phase_gauge.is_initialized() {
            self.set_phase_reference(aug)?;
        }
        Ok(())
    }

    fn eval_f(&mut self, state: &[f64], p1: f64, p2: f64) -> Vec<f64> {
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;

        let mut result = vec![0.0; self.dim];
        self.system.apply(0.0, state, &mut result);
        result
    }

    fn eval_jac(&mut self, state: &[f64], p1: f64, p2: f64) -> Result<Vec<f64>> {
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;
        compute_jacobian(self.system, SystemKind::Flow, state)
    }

    /// Build the LC BVP Jacobian (for multiplier extraction in diagnostics).
    fn build_bvp_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        self.ensure_phase_reference(aug)?;
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let aug_slice = aug.as_slice();

        let n_stages = self.ntst * self.ncol;
        let n_eqs = n_stages * self.dim + self.ntst * self.dim + 1 + self.dim;
        let n_vars = self.ncoords() + 1; // coords + T
        let period_col = n_vars - 1;

        let mut jac = DMatrix::<f64>::zeros(n_eqs, n_vars);

        // Evaluate all stage Jacobians.
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let j = self.eval_jac(&z, p1, p2)?;
                let idx = interval * self.ncol + stage;
                let start = idx * self.dim * self.dim;
                if start + self.dim * self.dim <= self.work_j.len() {
                    self.work_j[start..start + self.dim * self.dim].copy_from_slice(&j);
                }
                let flow = self.eval_f(&z, p1, p2);
                let flow_start = idx * self.dim;
                self.work_f[flow_start..flow_start + self.dim].copy_from_slice(&flow);
            }
        }

        // Fill collocation Jacobian entries.
        for interval in 0..self.ntst {
            let h = period * self.interval_width(interval);
            for stage in 0..self.ncol {
                let stage_idx = interval * self.ncol + stage;
                let row = stage_idx * self.dim;

                // dF/dz = I
                for d in 0..self.dim {
                    let col = stage_idx * self.dim + d;
                    jac[(row + d, col)] = 1.0;
                }

                // dF/d(mesh_i) = -I
                let mesh_col = n_stages * self.dim + interval * self.dim;
                for d in 0..self.dim {
                    jac[(row + d, mesh_col + d)] = -1.0;
                }

                // dF/d(stages) via a coefficients
                for k in 0..self.ncol {
                    let k_idx = interval * self.ncol + k;
                    let k_col = k_idx * self.dim;
                    let jac_start = k_idx * self.dim * self.dim;
                    let a = self.coeffs.a[stage][k];

                    for r in 0..self.dim {
                        for c in 0..self.dim {
                            let jv = self.work_j[jac_start + r * self.dim + c];
                            jac[(row + r, k_col + c)] -= h * a * jv;
                        }
                    }
                }

                for r in 0..self.dim {
                    let mut period_sum = 0.0;
                    for k in 0..self.ncol {
                        let flow_index = (interval * self.ncol + k) * self.dim + r;
                        period_sum += self.coeffs.a[stage][k] * self.work_f[flow_index];
                    }
                    jac[(row + r, period_col)] = -self.interval_width(interval) * period_sum;
                }
            }
        }

        // Continuity equations.
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let h = period * self.interval_width(interval);
            let row = cont_row + interval * self.dim;
            let mesh_col = n_stages * self.dim + interval * self.dim;
            let next_col = n_stages * self.dim + ((interval + 1) % (self.ntst + 1)) * self.dim;

            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
                jac[(row + d, next_col + d)] = 1.0;
            }

            for k in 0..self.ncol {
                let k_idx = interval * self.ncol + k;
                let k_col = k_idx * self.dim;
                let jac_start = k_idx * self.dim * self.dim;
                let b = self.coeffs.b[k];

                for r in 0..self.dim {
                    for c in 0..self.dim {
                        let jv = self.work_j[jac_start + r * self.dim + c];
                        jac[(row + r, k_col + c)] -= h * b * jv;
                    }
                }
            }
            for r in 0..self.dim {
                let mut period_sum = 0.0;
                for k in 0..self.ncol {
                    let flow_index = (interval * self.ncol + k) * self.dim + r;
                    period_sum += self.coeffs.b[k] * self.work_f[flow_index];
                }
                jac[(row + r, period_col)] = -self.interval_width(interval) * period_sum;
            }
        }

        // Integral phase condition on all Gauss stages.
        let phase_row = cont_row + self.ntst * self.dim;
        let mesh0_col = n_stages * self.dim;
        self.phase_gauge
            .write_jacobian_row(&mut jac, phase_row, 0)?;

        // Periodic BC: u(ntst) - u(0) = 0
        let bc_row = phase_row + 1;
        let mesh_last_col = n_stages * self.dim + self.ntst * self.dim;
        for d in 0..self.dim {
            jac[(bc_row + d, mesh0_col + d)] = -1.0;
            jac[(bc_row + d, mesh_last_col + d)] = 1.0;
        }

        Ok(jac)
    }

    /// Remap this problem's stage-first explicit Jacobian layout to the
    /// mesh-first implicit layout expected by `extract_multipliers_collocation`.
    fn remap_jac_for_multiplier_extraction(&self, jac: &DMatrix<f64>) -> DMatrix<f64> {
        let n_stages = self.ntst * self.ncol;
        let stage_cols = n_stages * self.dim;
        let mesh_cols = (self.ntst + 1) * self.dim;
        let current_mesh_start = stage_cols;
        let current_period_col = stage_cols + mesh_cols;

        // Expected by extract_multipliers_collocation:
        // [param_dummy, mesh_0..mesh_(ntst-1), stages..., period]
        let expected_mesh_cols = self.ntst * self.dim;
        let expected_stage_start = 1 + expected_mesh_cols;
        let expected_period_col = expected_stage_start + stage_cols;
        let expected_cols = expected_period_col + 1;

        // Folding mesh_ntst into mesh_0 makes the explicit periodic-BC rows
        // identically zero.  Drop those redundant rows; the collocation
        // extractor expects only stage, continuity, and phase equations.
        let expected_rows = stage_cols + self.ntst * self.dim + 1;
        let mut remapped = DMatrix::<f64>::zeros(expected_rows, expected_cols);

        for row in 0..expected_rows {
            // Stages: keep interval-major ordering, just move after mesh block.
            for stage_col in 0..stage_cols {
                remapped[(row, expected_stage_start + stage_col)] = jac[(row, stage_col)];
            }

            // Mesh_0..mesh_(ntst-1): map directly.
            for interval in 0..self.ntst {
                for d in 0..self.dim {
                    let src = current_mesh_start + interval * self.dim + d;
                    let dst = 1 + interval * self.dim + d;
                    remapped[(row, dst)] += jac[(row, src)];
                }
            }

            // Mesh_ntst in explicit layout is periodic image of mesh_0.
            // Fold its derivative contribution into mesh_0 for implicit layout.
            for d in 0..self.dim {
                let src = current_mesh_start + self.ntst * self.dim + d;
                let dst = 1 + d;
                remapped[(row, dst)] += jac[(row, src)];
            }

            remapped[(row, expected_period_col)] = jac[(row, current_period_col)];
        }

        remapped
    }
}

impl<'a> ContinuationProblem for IsoperiodicCurveProblem<'a> {
    fn dimension(&self) -> usize {
        self.n_eqs()
    }

    fn palc_metric_weights(&self, _aug: &DVector<f64>) -> Result<DVector<f64>> {
        let stage_dim = self.ntst * self.ncol * self.dim;
        explicit_profile_palc_weights_on_mesh(
            self.dimension() + 1,
            &self.normalized_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            1 + stage_dim,
            1,
        )
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);

        if period <= 0.0 {
            bail!("Period must be positive");
        }
        self.ensure_phase_reference(aug)?;

        let aug_slice = aug.as_slice();
        let n_stages = self.ntst * self.ncol;

        // Evaluate all stage functions.
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let start = (interval * self.ncol + stage) * self.dim;
                self.work_f[start..start + self.dim].copy_from_slice(&f);
            }
        }

        // Collocation equations.
        for interval in 0..self.ntst {
            let h = period * self.interval_width(interval);
            let mesh = self.mesh_slice(aug_slice, interval);
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage);
                let row = (interval * self.ncol + stage) * self.dim;

                for d in 0..self.dim {
                    let mut sum = 0.0;
                    for k in 0..self.ncol {
                        let f_idx = (interval * self.ncol + k) * self.dim + d;
                        sum += self.coeffs.a[stage][k] * self.work_f[f_idx];
                    }
                    out[row + d] = z[d] - mesh[d] - h * sum;
                }
            }
        }

        // Continuity equations.
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let h = period * self.interval_width(interval);
            let mesh_i = self.mesh_slice(aug_slice, interval);
            let mesh_next = self.mesh_slice(aug_slice, interval + 1);
            let row = cont_row + interval * self.dim;

            for d in 0..self.dim {
                let mut sum = 0.0;
                for k in 0..self.ncol {
                    let f_idx = (interval * self.ncol + k) * self.dim + d;
                    sum += self.coeffs.b[k] * self.work_f[f_idx];
                }
                out[row + d] = mesh_next[d] - mesh_i[d] - h * sum;
            }
        }

        // Integral phase condition on all Gauss stages.
        let phase_row = cont_row + self.ntst * self.dim;
        out[phase_row] = self.phase_gauge.residual(self.stage_profile(aug))?;

        // Fixed-period constraint.
        out[phase_row + 1] = period - self.target_period;

        // Periodic BC: u(ntst) - u(0) = 0
        let bc_row = phase_row + 2;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mesh_last = self.mesh_slice(aug_slice, self.ntst);
        for d in 0..self.dim {
            out[bc_row + d] = mesh_last[d] - mesh0[d];
        }

        self.cached_jac = Some(self.build_bvp_jac(aug)?);
        Ok(())
    }

    fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        // Numerical differentiation.
        let n = self.dimension();
        let m = aug.len();
        let eps = 1e-7;

        let mut jac = DMatrix::zeros(n, m);
        let mut res_base = DVector::zeros(n);
        self.residual(aug, &mut res_base)?;
        let base_bvp_jac = self.cached_jac.clone();

        for j in 0..m {
            let mut aug_p = aug.clone();
            aug_p[j] += eps;
            let mut res_p = DVector::zeros(n);
            self.residual(&aug_p, &mut res_p)?;

            for i in 0..n {
                jac[(i, j)] = (res_p[i] - res_base[i]) / eps;
            }
        }

        // Every perturbed residual refreshes the Floquet cache. Diagnostics
        // following tangent construction must see the accepted base point,
        // not the final finite-difference perturbation.
        self.cached_jac = base_bvp_jac;

        Ok(jac)
    }

    fn diagnostics(&mut self, aug: &DVector<f64>) -> Result<PointDiagnostics> {
        let jac = if let Some(ref j) = self.cached_jac {
            j.clone()
        } else {
            self.build_bvp_jac(aug)?
        };

        // Multiplier extraction expects mesh-first implicit Jacobian ordering.
        // Isoperiodic stores stage-first explicit, so remap before extraction.
        let remapped_jac = self.remap_jac_for_multiplier_extraction(&jac);
        let multipliers =
            extract_multipliers_collocation(&remapped_jac, self.dim, self.ntst, self.ncol)
                .map_err(|error| anyhow!("Isoperiodic Floquet extraction failed: {error}"))?;

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
            eigenvalues: multipliers,
            cycle_points: None,
        })
    }

    fn is_step_acceptable(&mut self, aug: &DVector<f64>) -> Result<bool> {
        Ok(self.defect_estimate(aug)?.max_scaled_defect
            <= self.adaptation.settings().defect_tolerance)
    }

    fn handle_step_rejection(
        &mut self,
        accepted_aug: &DVector<f64>,
        accepted_tangent: &DVector<f64>,
        rejected_aug: &DVector<f64>,
        branch_states: &[Vec<f64>],
    ) -> Result<StepRejectionAction> {
        let estimate = self.defect_estimate(rejected_aug)?;
        if estimate.max_scaled_defect <= self.adaptation.settings().defect_tolerance {
            return Ok(StepRejectionAction::ReduceStep);
        }
        let old_mesh = self.normalized_mesh.clone();
        let CurveMeshAdaptationDecision::Adapt(new_mesh) =
            self.adaptation.decide(&estimate, &old_mesh, self.ncol)?
        else {
            return Ok(StepRejectionAction::Terminate);
        };
        let transferred_aug = transfer_explicit_curve_aug(
            accepted_aug,
            &old_mesh,
            &new_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            2,
        )?;
        let transferred_tangent = transfer_explicit_curve_aug(
            accepted_tangent,
            &old_mesh,
            &new_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            2,
        )?;
        let transferred_branch_states = branch_states
            .iter()
            .map(|state| {
                transfer_explicit_curve_state(
                    state,
                    &old_mesh,
                    &new_mesh,
                    self.ncol,
                    self.dim,
                    &self.coeffs.nodes,
                    2,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        self.replace_mesh(new_mesh, &transferred_aug)?;
        Ok(StepRejectionAction::Refined {
            accepted_aug: transferred_aug,
            accepted_tangent: transferred_tangent,
            branch_states: transferred_branch_states,
            branch_type: None,
        })
    }

    fn transfer_branch_states_to_current_discretization(
        &self,
        branch_states: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        if self.adaptation.report().attempts.is_empty()
            && branch_states
                .iter()
                .all(|state| state.len() == self.dimension())
        {
            return Ok(branch_states.to_vec());
        }
        let mut transferred = branch_states.to_vec();
        for attempt in self.adaptation.transfer_attempts() {
            transferred = transferred
                .iter()
                .map(|state| {
                    transfer_explicit_curve_state(
                        state,
                        &attempt.old_normalized_mesh,
                        &attempt.new_normalized_mesh,
                        self.ncol,
                        self.dim,
                        &self.coeffs.nodes,
                        2,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
        }
        if transferred
            .iter()
            .any(|state| state.len() != self.dimension())
        {
            bail!("Adaptive isoperiodic continuation failed to transfer branch history");
        }
        Ok(transferred)
    }

    fn update_after_step(&mut self, aug: &DVector<f64>) -> Result<()> {
        self.set_phase_reference(aug)?;
        self.cached_jac = Some(self.build_bvp_jac(aug)?);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::transfer_explicit_curve_state;
    use super::IsoperiodicCurveProblem;
    use crate::continuation::periodic::{
        CollocationAdaptationReport, CollocationAdaptivitySettings, CollocationMeshAdaptationKind,
        CollocationRefinementAttempt,
    };
    use crate::continuation::{ContinuationProblem, StepRejectionAction};
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::{DMatrix, DVector};

    fn make_two_dim_flow_system() -> EquationSystem {
        // x' = x, y' = y (simple linear flow).
        let eq_x = Bytecode {
            ops: vec![OpCode::LoadVar(0)],
        };
        let eq_y = Bytecode {
            ops: vec![OpCode::LoadVar(1)],
        };
        EquationSystem::new(vec![eq_x, eq_y], vec![0.0, 0.0])
    }

    fn make_parameterized_two_dim_flow_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(1.0),
                        OpCode::LoadParam(1),
                        OpCode::Add,
                        OpCode::LoadVar(0),
                        OpCode::Mul,
                    ],
                },
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(2.0),
                        OpCode::LoadParam(1),
                        OpCode::Add,
                        OpCode::LoadVar(1),
                        OpCode::Mul,
                    ],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    #[test]
    fn rejects_invalid_seed_period() {
        let mut system = make_two_dim_flow_system();
        let lc_state = vec![0.1; 10];

        let err = IsoperiodicCurveProblem::new(&mut system, lc_state, 0.0, 0, 1, 0.0, 0.0, 2, 1)
            .err()
            .expect("expected invalid period to fail");

        assert!(
            err.to_string()
                .contains("Selected point has no valid period"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn rejects_identical_parameter_indices() {
        let mut system = make_two_dim_flow_system();
        let lc_state = vec![0.1; 10];

        let err = IsoperiodicCurveProblem::new(&mut system, lc_state, 1.0, 0, 0, 0.0, 0.0, 2, 1)
            .err()
            .expect("expected identical parameters to fail");

        assert!(
            err.to_string()
                .contains("Isoperiodic curve continuation requires two distinct parameters"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn rejects_unknown_parameter_index() {
        let mut system = make_two_dim_flow_system();
        let lc_state = vec![0.1; 10];

        let err = IsoperiodicCurveProblem::new(&mut system, lc_state, 1.0, 0, 2, 0.0, 0.0, 2, 1)
            .err()
            .expect("expected unknown parameter index to fail");

        assert!(
            err.to_string()
                .contains("Unknown continuation parameter index"),
            "unexpected error: {}",
            err
        );
    }

    #[test]
    fn residual_enforces_fixed_period_constraint() {
        let mut system = make_two_dim_flow_system();
        let lc_state = vec![0.1; 10];

        let mut problem =
            IsoperiodicCurveProblem::new(&mut system, lc_state, 2.0, 0, 1, 0.0, 0.0, 2, 1)
                .expect("create isoperiodic problem");

        // Build [p1, lc_state..., T, p2] with T != T_seed.
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = 0.0;
        for i in 0..10 {
            aug[i + 1] = 0.1;
        }
        let t_idx = 1 + 10;
        aug[t_idx] = 2.5;

        let mut out = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut out)
            .expect("residual should evaluate");

        let isoperiodic_row = problem.fixed_period_row();
        assert!((out[isoperiodic_row] - 0.5).abs() < 1e-9);
    }

    #[test]
    fn isoperiodic_phase_gauge_uses_all_stages_and_refreshes_after_acceptance() {
        let mut system = make_two_dim_flow_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = IsoperiodicCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("isoperiodic problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        for stage in 0..ntst * ncol {
            aug[1 + stage * dim] = 1.0;
        }
        aug[problem.period_index()] = 1.0;

        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut residual)
            .expect("isoperiodic residual");
        let phase_row = ntst * ncol * dim + ntst * dim;
        assert!(residual[phase_row].abs() < 1e-14);

        let mut shifted = aug;
        shifted[1 + (ntst * ncol - 1) * dim] += 1e-3;
        problem
            .residual(&shifted, &mut residual)
            .expect("shifted isoperiodic residual");
        assert!(residual[phase_row].abs() > 1e-5);

        problem
            .update_after_step(&shifted)
            .expect("accepted isoperiodic reference update");
        problem
            .residual(&shifted, &mut residual)
            .expect("updated isoperiodic residual");
        assert!(residual[phase_row].abs() < 1e-14);
    }

    #[test]
    fn diagnostics_reports_singular_floquet_blocks() {
        let mut system = make_two_dim_flow_system();
        let lc_state = vec![0.1; 10];

        let mut problem =
            IsoperiodicCurveProblem::new(&mut system, lc_state, 2.0, 0, 1, 0.0, 0.0, 2, 1)
                .expect("create isoperiodic problem");

        let ntst = 2usize;
        let n_stages = ntst;
        let n_eqs = n_stages * 2 + ntst * 2 + 1 + 2;
        let n_vars = (n_stages * 2 + (ntst + 1) * 2) + 1;
        problem.cached_jac = Some(DMatrix::<f64>::zeros(n_eqs, n_vars));

        let aug = DVector::zeros(problem.dimension() + 1);
        let error = problem
            .diagnostics(&aug)
            .expect_err("singular Floquet blocks must not be hidden");
        assert!(
            error
                .to_string()
                .contains("Isoperiodic Floquet extraction failed"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn diagnostics_produces_multipliers_for_regular_seed() {
        let mut system = make_two_dim_flow_system();
        // ntst=2, ncol=1, dim=2:
        // [stages(4), mesh(6)]
        let lc_state = vec![0.1; 10];

        let mut problem =
            IsoperiodicCurveProblem::new(&mut system, lc_state, 1.0, 0, 1, 0.0, 0.0, 2, 1)
                .expect("create isoperiodic problem");

        // Augmented state layout: [p1, lc_state..., T, p2]
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = 0.0;
        for i in 0..10 {
            aug[i + 1] = 0.1;
        }
        let t_idx = 1 + 10;
        aug[t_idx] = 1.0;
        aug[t_idx + 1] = 0.0;

        // Populate cached Jacobian via residual, then verify diagnostics extraction.
        let mut out = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut out)
            .expect("residual should evaluate");
        let diag = problem
            .diagnostics(&aug)
            .expect("diagnostics should evaluate");
        assert!(
            !diag.eigenvalues.is_empty(),
            "regular seed should produce floquet multipliers"
        );
    }

    #[test]
    fn diagnostics_at_base_point_are_unchanged_by_extended_jacobian_evaluation() {
        let mut system = make_parameterized_two_dim_flow_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = IsoperiodicCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.2,
            ntst,
            ncol,
        )
        .expect("isoperiodic problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        for index in 1..=ntst * ncol * dim {
            aug[index] = 1.0;
        }
        aug[problem.period_index()] = 1.0;
        aug[problem.param2_idx()] = 0.2;

        let before = problem
            .diagnostics(&aug)
            .expect("base-point isoperiodic diagnostics")
            .eigenvalues;
        problem
            .extended_jacobian(&aug)
            .expect("finite-difference isoperiodic Jacobian");
        let after = problem
            .diagnostics(&aug)
            .expect("post-Jacobian isoperiodic diagnostics")
            .eigenvalues;

        assert_eq!(before.len(), after.len());
        for expected in before {
            let error = after
                .iter()
                .map(|actual| (*actual - expected).norm())
                .fold(f64::INFINITY, f64::min);
            assert!(
                error < 1.0e-12,
                "isoperiodic diagnostics reused a perturbed cached Jacobian: error={error:.3e}"
            );
        }
    }

    #[test]
    fn rejects_single_interval_layout() {
        let mut system = make_two_dim_flow_system();
        let ntst = 1;
        let ncol = 1;
        let ncoords = ntst * ncol * 2 + (ntst + 1) * 2;
        let result = IsoperiodicCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        );
        let error = result
            .err()
            .expect("single-interval isoperiodic layout must be rejected");
        assert!(error.to_string().contains("at least two mesh intervals"));
    }

    #[test]
    fn palc_metric_normalizes_the_explicit_collocation_profile() {
        let mut system = make_two_dim_flow_system();
        let ntst = 3;
        let ncol = 2;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let problem = IsoperiodicCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("isoperiodic problem");
        let aug = DVector::zeros(problem.dimension() + 1);
        let weights = problem.palc_metric_weights(&aug).expect("PALC weights");
        let stage_dim = ntst * ncol * dim;
        let mesh_start = 1 + stage_dim;
        let mut component_weight = 0.0;
        for interval in 0..ntst {
            for stage in 0..ncol {
                component_weight += weights[1 + (interval * ncol + stage) * dim];
            }
        }
        for mesh in 0..=ntst {
            component_weight += weights[mesh_start + mesh * dim];
        }
        assert!((component_weight - 1.0).abs() < 1e-12);
        assert!((weights[mesh_start] - weights[mesh_start + ntst * dim]).abs() < 1e-15);
    }

    #[test]
    fn nonuniform_bvp_jacobian_matches_finite_differences() {
        let mut system = make_parameterized_two_dim_flow_system();
        let normalized_mesh = vec![0.0, 0.08, 0.42, 1.0];
        let ntst = normalized_mesh.len() - 1;
        let ncol = 2;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = IsoperiodicCurveProblem::new_on_mesh(
            &mut system,
            vec![0.0; ncoords],
            1.3,
            0,
            1,
            0.1,
            0.2,
            ncol,
            normalized_mesh.clone(),
        )
        .expect("nonuniform isoperiodic problem");
        assert_eq!(problem.normalized_mesh(), normalized_mesh);

        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[0] = 0.1;
        for index in 0..ncoords {
            aug[1 + index] = 0.4 + 0.03 * index as f64;
        }
        aug[problem.period_index()] = 1.3;
        aug[problem.param2_idx()] = 0.2;
        let mut base_residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut base_residual)
            .expect("initialize nonuniform phase gauge");
        let analytic = problem
            .build_bvp_jac(&aug)
            .expect("analytic nonuniform BVP Jacobian");

        let phase_row = ntst * ncol * dim + ntst * dim;
        let epsilon = 1e-7;
        for column in 0..analytic.ncols() {
            let aug_column = if column < ncoords {
                1 + column
            } else {
                problem.period_index()
            };
            let mut plus = aug.clone();
            let mut minus = aug.clone();
            plus[aug_column] += epsilon;
            minus[aug_column] -= epsilon;
            let mut plus_residual = DVector::zeros(problem.dimension());
            let mut minus_residual = DVector::zeros(problem.dimension());
            problem
                .residual(&plus, &mut plus_residual)
                .expect("plus residual");
            problem
                .residual(&minus, &mut minus_residual)
                .expect("minus residual");
            for row in 0..analytic.nrows() {
                let full_row = if row <= phase_row { row } else { row + 1 };
                let numerical =
                    (plus_residual[full_row] - minus_residual[full_row]) / (2.0 * epsilon);
                let error = (analytic[(row, column)] - numerical).abs();
                assert!(
                    error < 3e-6,
                    "nonuniform BVP Jacobian mismatch at ({row}, {column}): analytic={}, numerical={}, error={error:.3e}",
                    analytic[(row, column)],
                    numerical
                );
            }
        }
    }

    #[test]
    fn rejects_an_independently_underresolved_profile() {
        let mut system = make_two_dim_flow_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = IsoperiodicCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("isoperiodic problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[problem.period_index()] = 1.0;
        assert!(problem.is_step_acceptable(&aug).expect("resolved profile"));
        let mesh_start = 1 + ntst * ncol * dim;
        aug[mesh_start] = 10.0;
        assert!(!problem
            .is_step_acceptable(&aug)
            .expect("under-resolved profile"));
    }

    #[test]
    fn extension_transfer_skips_attempts_from_the_seeded_report() {
        let mut system = make_two_dim_flow_system();
        let current_mesh = vec![0.0, 0.18, 0.61, 1.0];
        let previous_mesh = vec![0.0, 0.5, 1.0];
        let ntst = current_mesh.len() - 1;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = IsoperiodicCurveProblem::new_on_mesh(
            &mut system,
            vec![0.0; ncoords],
            1.0,
            0,
            1,
            0.0,
            0.0,
            ncol,
            current_mesh.clone(),
        )
        .expect("isoperiodic restart problem");
        problem
            .set_collocation_adaptivity(CollocationAdaptivitySettings {
                enabled: true,
                redistribution_enabled: false,
                defect_tolerance: 1.0e-12,
                max_refinements: 3,
                max_mesh_points: 8,
            })
            .expect("adaptive settings");
        problem
            .seed_adaptation_report(CollocationAdaptationReport {
                initial_mesh_points: previous_mesh.len() - 1,
                current_mesh_points: current_mesh.len() - 1,
                degree: ncol,
                defect_tolerance: 0.5,
                refinement_budget: 99,
                max_mesh_points: 128,
                initial_normalized_mesh: previous_mesh.clone(),
                current_normalized_mesh: current_mesh.clone(),
                attempts: (1..=3)
                    .map(|sequence| CollocationRefinementAttempt {
                        sequence,
                        kind: CollocationMeshAdaptationKind::Redistribution,
                        old_mesh_points: previous_mesh.len() - 1,
                        new_mesh_points: current_mesh.len() - 1,
                        degree: ncol,
                        trigger_defect: 0.5,
                        tolerance: 0.5,
                        interval_scaled_defects: vec![0.25, 0.5],
                        old_normalized_mesh: previous_mesh.clone(),
                        new_normalized_mesh: current_mesh.clone(),
                    })
                    .collect(),
                termination: None,
            })
            .expect("seed prior report");
        assert_eq!(problem.adaptation_report().defect_tolerance, 1.0e-12);
        assert_eq!(problem.adaptation_report().refinement_budget, 3);
        assert_eq!(problem.adaptation_report().max_mesh_points, 8);

        let mut accepted = DVector::zeros(problem.dimension() + 1);
        for index in 0..ncoords {
            accepted[1 + index] = if index % 2 == 0 {
                3.0 + index as f64
            } else {
                -2.0 - index as f64
            };
        }
        accepted[problem.period_index()] = 1.0;
        accepted[problem.param2_idx()] = 0.0;
        let mut tangent = DVector::zeros(accepted.len());
        tangent[0] = 1.0;
        let persisted_before_extension = accepted.as_slice()[1..].to_vec();

        let action = problem
            .handle_step_rejection(&accepted, &tangent, &accepted, &[])
            .expect("one new adaptive retry");
        assert!(matches!(action, StepRejectionAction::Refined { .. }));
        assert_eq!(problem.adaptation_report().attempts.len(), 4);
        let new_attempt = problem
            .adaptation_report()
            .attempts
            .last()
            .expect("new adaptation attempt");

        let expected = transfer_explicit_curve_state(
            &persisted_before_extension,
            &current_mesh,
            &new_attempt.new_normalized_mesh,
            ncol,
            dim,
            &problem.coeffs.nodes,
            2,
        )
        .expect("single current-to-final transfer");
        let transferred = problem
            .transfer_branch_states_to_current_discretization(&[persisted_before_extension])
            .expect("extension history transfer");

        assert_eq!(transferred.len(), 1);
        assert_eq!(transferred[0].len(), expected.len());
        for (actual, expected) in transferred[0].iter().zip(expected) {
            assert!((actual - expected).abs() < 1.0e-12);
        }
    }
}
