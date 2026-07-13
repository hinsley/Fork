//! PD (Period Doubling) curve continuation.
//!
//! Continues period-doubling (flip) bifurcations of limit cycles in two-parameter space.
//! The defining system is:
//! - Standard BVP for the limit cycle: F(u, T, p) = 0
//! - Singularity condition: G = 0 where G detects μ = -1 multiplier
//!
//! Key difference from LPC: uses **antiperiodic** boundary conditions for the
//! bordered system (u(0) + u(T) = 0 instead of u(0) - u(T) = 0).

use super::{
    codim2::{
        append_return_map_conditioning, curve_normal_form_settings, limit_cycle_setup_from_profile,
        secondary_cycle_tests, secondary_spectral_coefficients, TrackedCycleMultiplier,
    },
    collocation_defect_estimate_on_mesh, explicit_profile_palc_weights_on_mesh,
    transfer_explicit_mesh_first_curve_aug, transfer_explicit_mesh_first_curve_state,
    CurveCollocationAdaptation, CurveMeshAdaptationDecision, FullProfilePhaseGauge, LCBorders,
};
use crate::continuation::codim1_curves::Codim2TestFunctions;
use crate::continuation::periodic::{
    extract_multipliers_collocation, uniform_normalized_mesh, validated_normalized_mesh,
    CollocationAdaptationReport, CollocationAdaptivitySettings, CollocationCoefficients,
    LimitCycleSetup,
};
use crate::continuation::periodic_normal_forms::periodic_period_doubling_normal_form_with_settings;
use crate::continuation::problem::{
    ContinuationProblem, PointDiagnostics, StepRejectionAction, TestFunctionValues,
};
use crate::continuation::{Codim2BifurcationType, Codim2Coefficient};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};

/// PD curve continuation problem.
///
/// Augmented state layout: [p1, stages..., meshes..., T, p2]
/// Uses standard periodic LC BVP + G singularity from bordered antiperiodic Jacobian.
pub struct PDCurveProblem<'a> {
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
    /// Persistent normalized collocation boundaries, including 0 and 1.
    normalized_mesh: Vec<f64>,
    /// Collocation degree
    ncol: usize,
    /// Collocation coefficients
    coeffs: CollocationCoefficients,
    /// Integral phase condition on the complete Gauss collocation profile.
    phase_gauge: FullProfilePhaseGauge,
    /// Bounded a-posteriori mesh adaptation and provenance.
    adaptation: CurveCollocationAdaptation,
    /// Border vectors for antiperiodic singularity (for G computation only)
    borders: LCBorders,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
    /// Codim-2 test function values
    codim2_tests: Codim2TestFunctions,
}

impl<'a> PDCurveProblem<'a> {
    /// Create a new PD curve problem from a detected PD point.
    pub fn new(
        system: &'a mut EquationSystem,
        lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        Self::new_on_mesh(
            system,
            lc_state,
            period,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            ntst,
            ncol,
            uniform_normalized_mesh(ntst),
        )
    }

    /// Create a PD curve problem on explicit normalized mesh boundaries.
    #[allow(clippy::too_many_arguments)]
    pub fn new_on_mesh(
        system: &'a mut EquationSystem,
        lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        param1_value: f64,
        param2_value: f64,
        ntst: usize,
        ncol: usize,
        normalized_mesh: Vec<f64>,
    ) -> Result<Self> {
        let dim = system.equations.len();
        if dim == 0 {
            bail!("PD curve requires a nonempty flow system");
        }
        if ntst < 2 {
            bail!("PD curve requires at least two mesh intervals");
        }
        if !period.is_finite() || period <= 0.0 {
            bail!("PD curve period must be positive and finite");
        }
        if param1_index == param2_index {
            bail!("PD curve requires two distinct continuation parameters");
        }
        if param1_index >= system.params.len() || param2_index >= system.params.len() {
            bail!("PD curve parameter index is out of bounds");
        }
        let expected_lc_len = (ntst + 1) * dim + ntst * ncol * dim;
        if lc_state.len() != expected_lc_len {
            bail!(
                "PD curve mesh-first state has length {}, expected {} for ntst={}, ncol={}, dim={}",
                lc_state.len(),
                expected_lc_len,
                ntst,
                ncol,
                dim
            );
        }
        let normalized_mesh = validated_normalized_mesh(ntst, &normalized_mesh)?;
        let coeffs = CollocationCoefficients::new(ncol)?;

        let stage_count = ntst * ncol;

        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];

        let mut phase_gauge =
            FullProfilePhaseGauge::new_on_mesh(&normalized_mesh, ncol, dim, &coeffs.b)?;
        let stage_start = (ntst + 1) * dim;
        phase_gauge.set_reference(
            system,
            param1_index,
            param2_index,
            param1_value,
            param2_value,
            period,
            &lc_state[stage_start..],
        )?;
        let adaptation = CurveCollocationAdaptation::new(&normalized_mesh, ncol)?;

        // Initialize borders for antiperiodic G computation
        // The flip singularity acts on state variations only: collocation
        // stages plus one implicit mesh state per interval.  Period and phase
        // are not part of this variational eigenproblem.
        let n_jac = ntst * ncol * dim + ntst * dim;
        let phi = DVector::from_element(n_jac, 1.0 / (n_jac as f64).sqrt());
        let psi = phi.clone();
        let borders = LCBorders::new(phi, psi);

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
            borders,
            work_f,
            work_j,
            codim2_tests: Codim2TestFunctions::default(),
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

    /// Number of LC coords (stages + mesh states)
    fn ncoords(&self) -> usize {
        self.ntst * self.ncol * self.dim + (self.ntst + 1) * self.dim
    }

    /// Index of period T in augmented state
    fn period_index(&self) -> usize {
        1 + self.ncoords()
    }

    /// Index of p2 in augmented state
    fn param2_idx(&self) -> usize {
        self.period_index() + 1
    }

    /// Total augmented state dimension
    #[allow(dead_code)]
    fn aug_dim(&self) -> usize {
        1 + self.ncoords() + 1 + 1
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }

    /// Number of residual equations.
    ///
    /// This must equal len(state) where state = [lc_coords, T, p2].
    /// PALC adds p1 at front and pseudo-arclength constraint, making
    /// aug = [p1, lc_coords, T, p2] with len = ncoords + 3.
    /// dimension() must return ncoords + 2 so PALC creates correct sized aug.
    fn n_eqs(&self) -> usize {
        // Augmented variables: lc_coords + T + p2 = ncoords + 2
        self.ncoords() + 2
    }

    fn get_p1(&self, aug: &DVector<f64>) -> f64 {
        aug[0]
    }

    fn get_p2(&self, aug: &DVector<f64>) -> Result<f64> {
        let idx = self.param2_idx();
        if idx >= aug.len() {
            bail!(
                "PD curve param2 index out of bounds: param2_idx={} but aug.len()={}. ncoords={}, period_idx={}, ntst={}, ncol={}, dim={}",
                idx, aug.len(), self.ncoords(), self.period_index(), self.ntst, self.ncol, self.dim
            );
        }
        Ok(aug[idx])
    }

    fn get_period(&self, aug: &DVector<f64>) -> f64 {
        aug[self.period_index()]
    }

    /// Stage offset: stages come AFTER mesh points
    /// Layout: [p1, mesh_0, mesh_1, ..., mesh_ntst, stage_0_0, stage_0_1, ..., T, p2]
    fn stage_offset(&self) -> usize {
        1 + (self.ntst + 1) * self.dim
    }

    fn stage_slice<'b>(&self, aug: &'b [f64], interval: usize, stage: usize) -> &'b [f64] {
        let idx = interval * self.ncol + stage;
        let start = self.stage_offset() + idx * self.dim;
        &aug[start..start + self.dim]
    }

    /// Mesh points come FIRST after p1
    fn mesh_slice<'b>(&self, aug: &'b [f64], idx: usize) -> &'b [f64] {
        let actual = idx % (self.ntst + 1);
        let start = 1 + actual * self.dim;
        &aug[start..start + self.dim]
    }

    fn stage_profile<'b>(&self, aug: &'b DVector<f64>) -> &'b [f64] {
        let start = self.stage_offset();
        let end = start + self.ntst * self.ncol * self.dim;
        &aug.as_slice()[start..end]
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
            self.get_p2(aug)?,
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
        let mesh_len = (ntst + 1) * self.dim;
        let stage_len = ntst * self.ncol * self.dim;
        let profile_end = 1 + mesh_len + stage_len;
        if accepted_aug.len() != profile_end + 2 {
            bail!("Transferred PD state has an invalid collocation layout");
        }
        phase_gauge.set_reference(
            self.system,
            self.param1_index,
            self.param2_index,
            accepted_aug[0],
            accepted_aug[profile_end + 1],
            accepted_aug[profile_end],
            &accepted_aug.as_slice()[1 + mesh_len..1 + mesh_len + stage_len],
        )?;
        let border_dim = ntst * self.ncol * self.dim + ntst * self.dim;
        let phi = DVector::from_element(border_dim, 1.0 / (border_dim as f64).sqrt());
        self.ntst = ntst;
        self.normalized_mesh = normalized_mesh;
        self.phase_gauge = phase_gauge;
        self.borders = LCBorders::new(phi.clone(), phi);
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
            self.get_p2(aug)?,
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

    fn normal_form_setup(&mut self, aug: &DVector<f64>) -> Result<LimitCycleSetup> {
        let mesh_states = (0..self.ntst)
            .map(|mesh| self.mesh_slice(aug.as_slice(), mesh).to_vec())
            .collect();
        let stage_states = (0..self.ntst)
            .map(|interval| {
                (0..self.ncol)
                    .map(|stage| self.stage_slice(aug.as_slice(), interval, stage).to_vec())
                    .collect()
            })
            .collect();
        limit_cycle_setup_from_profile(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug)?,
            self.get_period(aug),
            mesh_states,
            stage_states,
            self.ncol,
            &self.normalized_mesh,
        )
    }

    pub(crate) fn codim2_coefficients_at(
        &mut self,
        aug: &DVector<f64>,
        bifurcation_type: Codim2BifurcationType,
        test_value: f64,
    ) -> Result<Vec<Codim2Coefficient>> {
        match bifurcation_type {
            Codim2BifurcationType::GeneralizedPeriodDoubling => {
                let setup = self.normal_form_setup(aug)?;
                let normal_form = periodic_period_doubling_normal_form_with_settings(
                    self.system,
                    &setup,
                    self.param1_index,
                    curve_normal_form_settings(self.ntst, self.ncol),
                )?;
                let mut coefficients = vec![
                    Codim2Coefficient {
                        name: "cubic_coefficient".to_string(),
                        value: normal_form.cubic_coefficient,
                    },
                    Codim2Coefficient {
                        name: "parameter_coefficient".to_string(),
                        value: normal_form.parameter_coefficient,
                    },
                    Codim2Coefficient {
                        name: "critical_multiplier".to_string(),
                        value: normal_form.multiplier,
                    },
                ];
                append_return_map_conditioning(&mut coefficients, normal_form.conditioning);
                Ok(coefficients)
            }
            Codim2BifurcationType::FoldFlip | Codim2BifurcationType::FlipNeimarkSacker => {
                let jac = self.build_periodic_jac(aug)?;
                let multipliers =
                    extract_multipliers_collocation(&jac, self.dim, self.ntst, self.ncol)?;
                let secondary =
                    secondary_cycle_tests(&multipliers, TrackedCycleMultiplier::MinusOne)?;
                Ok(secondary_spectral_coefficients(&secondary))
            }
            _ => Ok(vec![Codim2Coefficient {
                name: "test_value".to_string(),
                value: test_value,
            }]),
        }
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

    /// Compute singularity G from bordered system.
    ///
    /// For PD, the bordered system uses the **antiperiodic** Jacobian.
    fn compute_g(&self, jac: &DMatrix<f64>) -> Result<f64> {
        let n = jac.nrows();
        if jac.ncols() != n || self.borders.phi.len() != n || self.borders.psi.len() != n {
            bail!("PD bordered singularity dimensions do not match");
        }
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);

        for i in 0..n.min(self.borders.psi.len()) {
            bordered[(i, n)] = self.borders.psi[i];
        }
        for i in 0..n.min(self.borders.phi.len()) {
            bordered[(n, i)] = self.borders.phi[i];
        }
        bordered[(n, n)] = 0.0;

        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        let solution = bordered
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow::anyhow!("PD bordered singularity solve is singular"))?;
        let g = solution[n];
        if !g.is_finite() {
            bail!("PD bordered singularity value is non-finite");
        }
        Ok(g)
    }

    /// Build the square state-variational collocation operator.
    ///
    /// Columns are `[stage variations, implicit mesh variations]`.  Interior
    /// continuity rows always use `+I` on the next mesh state.  The last row
    /// uses `+I` for a periodic variational field and `-I` for an
    /// antiperiodic field, which is the discrete condition `v(T) = -v(0)`.
    /// Neither the orbit phase nor a period variation belongs in this Floquet
    /// eigenproblem.
    fn build_state_variational_jac(
        &mut self,
        aug: &DVector<f64>,
        antiperiodic: bool,
    ) -> Result<DMatrix<f64>> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug)?;
        let period = self.get_period(aug);
        let aug_slice = aug.as_slice();

        let n_stages = self.ntst * self.ncol;
        let stage_dim = n_stages * self.dim;
        let mesh_dim = self.ntst * self.dim;
        let n = stage_dim + mesh_dim;

        let mut jac = DMatrix::<f64>::zeros(n, n);

        // Evaluate the vector-field Jacobian at every collocation stage.
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let j = self.eval_jac(&z, p1, p2)?;
                let idx = interval * self.ncol + stage;
                let start = idx * self.dim * self.dim;
                if start + self.dim * self.dim <= self.work_j.len() {
                    self.work_j[start..start + self.dim * self.dim].copy_from_slice(&j);
                }
            }
        }

        // Linearized collocation equations.
        for interval in 0..self.ntst {
            let h = period * (self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]);
            for stage in 0..self.ncol {
                let stage_idx = interval * self.ncol + stage;
                let row = stage_idx * self.dim;

                for d in 0..self.dim {
                    let col = stage_idx * self.dim + d;
                    jac[(row + d, col)] = 1.0;
                }

                let mesh_col = stage_dim + interval * self.dim;
                for d in 0..self.dim {
                    jac[(row + d, mesh_col + d)] = -1.0;
                }

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
            }
        }

        // Linearized continuity equations.  The antiperiodic sign is applied
        // exactly once, at the wrap from the final interval back to mesh 0.
        let cont_row = stage_dim;
        for interval in 0..self.ntst {
            let h = period * (self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]);
            let row = cont_row + interval * self.dim;
            let mesh_col = stage_dim + interval * self.dim;
            let is_wrap = interval + 1 == self.ntst;

            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
            }

            let next_mesh_idx = (interval + 1) % self.ntst;
            let next_col = stage_dim + next_mesh_idx * self.dim;
            for d in 0..self.dim {
                jac[(row + d, next_col + d)] = if antiperiodic && is_wrap { -1.0 } else { 1.0 };
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
        }

        Ok(jac)
    }

    /// Build the periodic collocation Jacobian layout consumed by the robust
    /// Floquet transfer extractor:
    /// `[parameter, implicit meshes, stages, period]`.
    ///
    /// Multiplier extraction only uses the state-variational blocks, so the
    /// parameter and period columns and the final phase row are intentionally
    /// zero here.
    fn build_periodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let variational = self.build_state_variational_jac(aug, false)?;
        let stage_dim = self.ntst * self.ncol * self.dim;
        let mesh_dim = self.ntst * self.dim;
        let state_dim = stage_dim + mesh_dim;
        let mut jac = DMatrix::zeros(state_dim + 1, state_dim + 2);
        let mesh_col_start = 1;
        let stage_col_start = mesh_col_start + mesh_dim;

        for row in 0..state_dim {
            for stage_col in 0..stage_dim {
                jac[(row, stage_col_start + stage_col)] = variational[(row, stage_col)];
            }
            for mesh_col in 0..mesh_dim {
                jac[(row, mesh_col_start + mesh_col)] = variational[(row, stage_dim + mesh_col)];
            }
        }
        Ok(jac)
    }

    /// Build the antiperiodic state-variational operator used by the bordered
    /// period-doubling singularity function.
    fn build_antiperiodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        self.build_state_variational_jac(aug, true)
    }
}

impl<'a> ContinuationProblem for PDCurveProblem<'a> {
    fn dimension(&self) -> usize {
        self.n_eqs()
    }

    fn palc_metric_weights(&self, _aug: &DVector<f64>) -> Result<DVector<f64>> {
        let mesh_dim = (self.ntst + 1) * self.dim;
        explicit_profile_palc_weights_on_mesh(
            self.dimension() + 1,
            &self.normalized_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            1,
            1 + mesh_dim,
        )
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        // DEBUG: Check dimensions at entry
        let expected_aug_len = self.dimension() + 1; // PALC adds p1
        let expected_out_len = self.dimension();
        if aug.len() != expected_aug_len {
            bail!(
                "RESIDUAL: aug.len()={} but expected {} (dimension()={}, ncoords()={}, ntst={}, ncol={}, dim={})",
                aug.len(), expected_aug_len, self.dimension(), self.ncoords(), self.ntst, self.ncol, self.dim
            );
        }
        if out.len() != expected_out_len {
            bail!(
                "RESIDUAL: out.len()={} but expected {} (dimension()={})",
                out.len(),
                expected_out_len,
                self.dimension()
            );
        }

        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug)?;
        let period = self.get_period(aug);

        if period <= 0.0 {
            bail!("Period must be positive");
        }
        self.ensure_phase_reference(aug)?;

        let aug_slice = aug.as_slice();
        let n_stages = self.ntst * self.ncol;

        // Evaluate all stage functions
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let start = (interval * self.ncol + stage) * self.dim;
                self.work_f[start..start + self.dim].copy_from_slice(&f);
            }
        }

        // Collocation equations (same as LPC)
        for interval in 0..self.ntst {
            let h = period * (self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]);
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

        // Continuity equations (same as LPC - using periodic BC for the orbit itself)
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let h = period * (self.normalized_mesh[interval + 1] - self.normalized_mesh[interval]);
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

        // G singularity - compute FRESH for each call
        // This is necessary for correct numerical Jacobian differentiation.
        // Computing G requires building the antiperiodic Jacobian and solving
        // the bordered system - expensive but correct.
        let jac_antipd = self.build_antiperiodic_jac(aug)?;
        let g = self.compute_g(&jac_antipd)?;
        out[phase_row + 1] = g;

        // Explicit periodic boundary condition: u_ntst - u_0 = 0
        // This is PERIODIC (not antiperiodic!) to match the phase condition
        let bc_row = phase_row + 2;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mesh_ntst = self.mesh_slice(aug_slice, self.ntst);
        for d in 0..self.dim {
            out[bc_row + d] = mesh_ntst[d] - mesh0[d];
        }

        Ok(())
    }

    fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        // NOTE: We do NOT cache G here. Each residual() call computes G fresh.
        // This is slower but necessary for correct numerical differentiation.
        // If we cached G, all residual calls would return the same G value,
        // resulting in a zero row in the numerical Jacobian and a singular matrix.

        // Numerical differentiation
        let n = self.dimension();
        let m = aug.len();
        let eps = 1e-7;

        let mut jac = DMatrix::zeros(n, m);
        let mut res_base = DVector::zeros(n);
        self.residual(aug, &mut res_base)?;

        for j in 0..m {
            let mut aug_p = aug.clone();
            aug_p[j] += eps;
            let mut res_p = DVector::zeros(n);
            self.residual(&aug_p, &mut res_p)?;

            for i in 0..n {
                jac[(i, j)] = (res_p[i] - res_base[i]) / eps;
            }
        }

        Ok(jac)
    }

    fn diagnostics(&mut self, aug: &DVector<f64>) -> Result<PointDiagnostics> {
        let jac = self.build_periodic_jac(aug)?;
        let multipliers = extract_multipliers_collocation(&jac, self.dim, self.ntst, self.ncol)?;
        let mut tests = Codim2TestFunctions::default();
        match secondary_cycle_tests(&multipliers, TrackedCycleMultiplier::MinusOne) {
            Ok(secondary) => {
                tests.fold_flip = secondary.plus_one;
                tests.flip_ns = secondary.unit_pair;
            }
            Err(_) => {
                tests.fold_flip = f64::NAN;
                tests.flip_ns = f64::NAN;
            }
        }
        tests.gpd = self
            .normal_form_setup(aug)
            .and_then(|setup| {
                periodic_period_doubling_normal_form_with_settings(
                    self.system,
                    &setup,
                    self.param1_index,
                    curve_normal_form_settings(self.ntst, self.ncol),
                )
            })
            .map(|normal_form| normal_form.cubic_coefficient)
            .unwrap_or(f64::NAN);
        self.codim2_tests = tests;

        Ok(PointDiagnostics {
            // This problem already constrains the flip multiplier to -1.
            // Feeding its near-zero defining test back into the generic
            // codim-1 detector would repeatedly self-detect PD events from
            // roundoff sign changes.  Simultaneous LPC/NS crossings are
            // exposed through `codim2_tests` above instead.
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
        let transferred_aug = transfer_explicit_mesh_first_curve_aug(
            accepted_aug,
            &old_mesh,
            &new_mesh,
            self.ncol,
            self.dim,
            &self.coeffs.nodes,
            2,
        )?;
        let transferred_tangent = transfer_explicit_mesh_first_curve_aug(
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
                transfer_explicit_mesh_first_curve_state(
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
                    transfer_explicit_mesh_first_curve_state(
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
            bail!("Adaptive PD continuation failed to transfer branch history");
        }
        Ok(transferred)
    }

    fn update_after_step(&mut self, aug: &DVector<f64>) -> Result<()> {
        self.set_phase_reference(aug)?;

        // Adapt the border vectors to the current antiperiodic nullspaces.
        // Keeping the initial fixed borders indefinitely makes the scalar
        // bordered singularity function ill-conditioned as the curve turns.
        let jac = self.build_antiperiodic_jac(aug)?;
        self.borders.update(&jac)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PDCurveProblem;
    use crate::continuation::periodic::CollocationCoefficients;
    use crate::continuation::problem::ContinuationProblem;
    use crate::continuation::{
        BifurcationType, ContinuationPoint, ContinuationRunner, ContinuationSettings,
    };
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::DVector;

    fn two_oscillator_system(primary_frequency: f64, flip_frequency: f64) -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(primary_frequency),
                        OpCode::LoadVar(1),
                        OpCode::Mul,
                        OpCode::Neg,
                    ],
                },
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(primary_frequency),
                        OpCode::LoadVar(0),
                        OpCode::Mul,
                    ],
                },
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(flip_frequency),
                        OpCode::LoadVar(3),
                        OpCode::Mul,
                        OpCode::Neg,
                    ],
                },
                Bytecode {
                    ops: vec![
                        OpCode::LoadConst(flip_frequency),
                        OpCode::LoadVar(2),
                        OpCode::Mul,
                    ],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    fn zero_mesh_first_state(ntst: usize, ncol: usize, dim: usize) -> Vec<f64> {
        vec![0.0; (ntst + 1) * dim + ntst * ncol * dim]
    }

    fn nonstationary_mesh_first_state(ntst: usize, ncol: usize, dim: usize) -> Vec<f64> {
        let mut state = zero_mesh_first_state(ntst, ncol, dim);
        let stage_start = (ntst + 1) * dim;
        for stage in 0..ntst * ncol {
            state[stage_start + stage * dim] = 1.0;
        }
        state
    }

    fn sampled_primary_cycle_state(ntst: usize, ncol: usize) -> Vec<f64> {
        let dim = 4;
        let coeffs = CollocationCoefficients::new(ncol).expect("collocation coefficients");
        let mut state = Vec::with_capacity((ntst + 1) * dim + ntst * ncol * dim);
        for mesh in 0..=ntst {
            let angle = std::f64::consts::TAU * mesh as f64 / ntst as f64;
            state.extend([angle.cos(), angle.sin(), 0.0, 0.0]);
        }
        for interval in 0..ntst {
            for node in &coeffs.nodes {
                let angle = std::f64::consts::TAU * (interval as f64 + node) / ntst as f64;
                state.extend([angle.cos(), angle.sin(), 0.0, 0.0]);
            }
        }
        state
    }

    fn augmented_state(lc_state: &[f64], period: f64, param1: f64, param2: f64) -> DVector<f64> {
        let mut aug = DVector::zeros(lc_state.len() + 3);
        aug[0] = param1;
        aug.as_mut_slice()[1..1 + lc_state.len()].copy_from_slice(lc_state);
        aug[1 + lc_state.len()] = period;
        aug[2 + lc_state.len()] = param2;
        aug
    }

    #[test]
    fn get_p2_returns_error_on_bounds_mismatch() {
        let bytecode = Bytecode {
            ops: vec![OpCode::LoadVar(0)],
        };
        let mut system = EquationSystem::new(vec![bytecode], vec![0.0, 0.0]);
        let lc_state = vec![0.0, 0.0, 0.0, 1.0, 1.0];

        let problem = PDCurveProblem::new(&mut system, lc_state, 1.0, 0, 1, 0.0, 0.0, 2, 1)
            .expect("failed to build PD curve problem");

        let aug = DVector::zeros(problem.param2_idx());
        let err = problem.get_p2(&aug).unwrap_err();
        assert!(err.to_string().contains("out of bounds"));
    }

    #[test]
    fn antiperiodic_variational_sign_is_applied_only_at_the_wrap() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 3;
        let ncol = 1;
        let dim = 4;
        let lc_state = sampled_primary_cycle_state(ntst, ncol);
        let aug = augmented_state(&lc_state, std::f64::consts::TAU, 0.0, 0.0);
        let mut problem = PDCurveProblem::new(
            &mut system,
            lc_state,
            std::f64::consts::TAU,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("PD problem");

        let jac = problem
            .build_antiperiodic_jac(&aug)
            .expect("antiperiodic variational Jacobian");
        let stage_dim = ntst * ncol * dim;
        let continuity_row = stage_dim;
        let mesh_col = stage_dim;

        // Interior continuity is y_{i+1} - y_i - h B_i w_i = 0.
        assert_eq!(jac[(continuity_row, mesh_col)], -1.0);
        assert_eq!(jac[(continuity_row, mesh_col + dim)], 1.0);

        // At the only seam, y(T) = -y(0), so the wrapped next-state
        // coefficient changes from +I to -I.  The current-state sign does not.
        let last_row = continuity_row + (ntst - 1) * dim;
        let last_mesh_col = mesh_col + (ntst - 1) * dim;
        assert_eq!(jac[(last_row, last_mesh_col)], -1.0);
        assert_eq!(jac[(last_row, mesh_col)], -1.0);
    }

    #[test]
    fn nonuniform_variational_jacobian_and_residual_use_each_interval_width() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 2;
        let ncol = 1;
        let dim = 4;
        let normalized_mesh = vec![0.0, 0.2, 1.0];
        let lc_state = nonstationary_mesh_first_state(ntst, ncol, dim);
        let mut problem = PDCurveProblem::new_on_mesh(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
            normalized_mesh.clone(),
        )
        .expect("nonuniform PD problem");
        assert_eq!(problem.normalized_mesh(), normalized_mesh);
        let aug = augmented_state(&lc_state, 1.0, 0.0, 0.0);

        let jac = problem
            .build_state_variational_jac(&aug, false)
            .expect("nonuniform state-variational Jacobian");
        let first_interval_entry = jac[(0, 1)];
        let second_interval_entry = jac[(dim, dim + 1)];
        assert!(first_interval_entry.abs() > 1e-12);
        assert!((second_interval_entry / first_interval_entry - 4.0).abs() < 1e-12);

        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&aug, &mut residual)
            .expect("nonuniform PD residual");
        assert!(residual[1].abs() > 1e-12);
        assert!((residual[dim + 1] / residual[1] - 4.0).abs() < 1e-12);
    }

    #[test]
    fn diagnostics_extract_the_analytic_four_dimensional_flip_spectrum() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 16;
        let ncol = 3;
        let dim = 4;
        let period = std::f64::consts::TAU;
        let lc_state = sampled_primary_cycle_state(ntst, ncol);
        let aug = augmented_state(&lc_state, period, 0.0, 0.0);
        let mut problem =
            PDCurveProblem::new(&mut system, lc_state, period, 0, 1, 0.0, 0.0, ntst, ncol)
                .expect("PD problem");

        let diagnostics = problem.diagnostics(&aug).expect("PD diagnostics");
        assert_eq!(diagnostics.eigenvalues.len(), dim);
        let near_plus_one = diagnostics
            .eigenvalues
            .iter()
            .filter(|mu| (**mu - num_complex::Complex::new(1.0, 0.0)).norm() < 1e-6)
            .count();
        let near_minus_one = diagnostics
            .eigenvalues
            .iter()
            .filter(|mu| (**mu + num_complex::Complex::new(1.0, 0.0)).norm() < 1e-6)
            .count();
        assert_eq!(
            near_plus_one, 2,
            "multipliers: {:?}",
            diagnostics.eigenvalues
        );
        assert_eq!(
            near_minus_one, 2,
            "multipliers: {:?}",
            diagnostics.eigenvalues
        );
        assert_eq!(diagnostics.test_values.period_doubling, 1.0);
    }

    #[test]
    fn accepted_step_updates_the_antiperiodic_borders() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 8;
        let ncol = 2;
        let dim = 4;
        let period = std::f64::consts::TAU;
        let lc_state = sampled_primary_cycle_state(ntst, ncol);
        let aug = augmented_state(&lc_state, period, 0.0, 0.0);
        let mut problem =
            PDCurveProblem::new(&mut system, lc_state, period, 0, 1, 0.0, 0.0, ntst, ncol)
                .expect("PD problem");
        problem
            .ensure_phase_reference(&aug)
            .expect("initial PD phase reference");
        let derivative_index = problem
            .phase_gauge
            .reference_derivative()
            .expect("PD reference derivative")
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
            .map(|(index, _)| index)
            .expect("nonempty derivative");
        let mut accepted = aug;
        accepted[problem.stage_offset() + derivative_index] += 1e-3;
        assert!(
            problem
                .phase_gauge
                .residual(problem.stage_profile(&accepted))
                .expect("shifted PD phase")
                .abs()
                > 1e-6
        );
        let phase_row = ntst * ncol * dim + ntst * dim;
        let mut residual = DVector::zeros(problem.dimension());
        problem
            .residual(&accepted, &mut residual)
            .expect("shifted PD residual");
        assert!(residual[phase_row].abs() > 1e-6);
        let phi_before = problem.borders.phi.clone();
        let psi_before = problem.borders.psi.clone();

        problem
            .update_after_step(&accepted)
            .expect("accepted PD reference and border update");

        assert!((&problem.borders.phi - phi_before).norm() > 1e-6);
        assert!((&problem.borders.psi - psi_before).norm() > 1e-6);
        assert!(
            problem
                .phase_gauge
                .residual(problem.stage_profile(&accepted))
                .expect("updated PD phase")
                .abs()
                < 1e-14
        );
        problem
            .residual(&accepted, &mut residual)
            .expect("updated PD residual");
        assert!(residual[phase_row].abs() < 1e-14);
    }

    #[test]
    fn mesh_first_explicit_seed_initializes_the_continuation_runner() {
        let mut system = two_oscillator_system(1.0, 0.4);
        let ntst = 3;
        let ncol = 2;
        let dim = 4;
        let period = std::f64::consts::TAU;
        let lc_state = sampled_primary_cycle_state(ntst, ncol);
        let problem = PDCurveProblem::new(
            &mut system,
            lc_state.clone(),
            period,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("PD problem");
        let mut state = lc_state;
        state.push(period);
        state.push(0.0);
        let initial_point = ContinuationPoint {
            state,
            param_value: 0.0,
            stability: BifurcationType::PeriodDoubling,
            eigenvalues: Vec::new(),
            cycle_points: None,
        };
        let settings = ContinuationSettings {
            step_size: 1e-3,
            min_step_size: 1e-6,
            max_step_size: 1e-2,
            max_steps: 1,
            corrector_steps: 4,
            corrector_tolerance: 1e-8,
            step_tolerance: 1e-10,
        };

        let runner = ContinuationRunner::new(problem, initial_point, settings, true)
            .expect("mesh-first PD runner initialization");
        assert_eq!(runner.current_step(), 0);
        assert_eq!(
            runner.branch().points[0].state.len(),
            (ntst + 1) * dim + ntst * ncol * dim + 2
        );
        assert_eq!(runner.branch().points[0].eigenvalues.len(), dim);
    }

    #[test]
    fn rejects_single_interval_layout() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 1;
        let ncol = 1;
        let dim = 4;
        let lc_state = nonstationary_mesh_first_state(ntst, ncol, dim);
        let result = PDCurveProblem::new(&mut system, lc_state, 1.0, 0, 1, 0.0, 0.0, ntst, ncol);
        let error = result
            .err()
            .expect("single-interval PD layout must be rejected");
        assert!(error.to_string().contains("at least two mesh intervals"));
    }

    #[test]
    fn palc_metric_normalizes_the_explicit_collocation_profile() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 3;
        let ncol = 2;
        let dim = 4;
        let lc_state = nonstationary_mesh_first_state(ntst, ncol, dim);
        let problem = PDCurveProblem::new(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("PD problem");
        let aug = augmented_state(&lc_state, 1.0, 0.0, 0.0);
        let weights = problem.palc_metric_weights(&aug).expect("PALC weights");
        let stage_start = 1 + (ntst + 1) * dim;
        let mut component_weight = 0.0;
        for mesh in 0..=ntst {
            component_weight += weights[1 + mesh * dim];
        }
        for interval in 0..ntst {
            for stage in 0..ncol {
                component_weight += weights[stage_start + (interval * ncol + stage) * dim];
            }
        }
        assert!((component_weight - 1.0).abs() < 1e-12);
        assert!((weights[1] - weights[1 + ntst * dim]).abs() < 1e-15);
    }

    #[test]
    fn rejects_an_independently_underresolved_profile() {
        let mut system = two_oscillator_system(1.0, 0.5);
        let ntst = 2;
        let ncol = 1;
        let dim = 4;
        let lc_state = nonstationary_mesh_first_state(ntst, ncol, dim);
        let mut problem = PDCurveProblem::new(
            &mut system,
            lc_state.clone(),
            1.0,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("PD problem");
        let zero_state = zero_mesh_first_state(ntst, ncol, dim);
        let mut aug = augmented_state(&zero_state, 1.0, 0.0, 0.0);
        assert!(problem.is_step_acceptable(&aug).expect("resolved profile"));
        aug[1] = 10.0;
        assert!(!problem
            .is_step_acceptable(&aug)
            .expect("under-resolved profile"));
    }
}
