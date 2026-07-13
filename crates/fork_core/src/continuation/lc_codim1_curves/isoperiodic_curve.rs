//! Isoperiodic curve continuation for limit cycles.
//!
//! Continues a limit cycle in two-parameter space with fixed period:
//! - Standard periodic collocation BVP for the cycle
//! - Isoperiodic condition: T - T_seed = 0

use super::{collocation_profile_is_acceptable, explicit_profile_palc_weights};
use crate::continuation::periodic::{extract_multipliers_collocation, CollocationCoefficients};
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
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
    /// Collocation degree
    ncol: usize,
    /// Collocation coefficients
    coeffs: CollocationCoefficients,
    /// Phase condition anchor
    phase_anchor: Vec<f64>,
    /// Phase condition direction
    phase_direction: Vec<f64>,
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
        lc_state: Vec<f64>,
        period: f64,
        param1_index: usize,
        param2_index: usize,
        _param1_value: f64,
        _param2_value: f64,
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        if !period.is_finite() || period <= 0.0 {
            bail!("Selected point has no valid period");
        }

        if param1_index == param2_index {
            bail!("Isoperiodic curve continuation requires two distinct parameters");
        }

        if param1_index >= system.params.len() || param2_index >= system.params.len() {
            bail!("Unknown continuation parameter index");
        }

        if ntst < 2 {
            bail!("Isoperiodic curve requires at least two mesh intervals");
        }

        let dim = system.equations.len();
        let coeffs = CollocationCoefficients::new(ncol)?;

        let stage_count = ntst * ncol;

        // Work arrays for evaluations
        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];

        // Phase anchor and direction from first mesh state.
        let mesh_start = stage_count * dim;
        let phase_anchor = if lc_state.len() >= mesh_start + dim {
            lc_state[mesh_start..mesh_start + dim].to_vec()
        } else if lc_state.len() >= dim {
            lc_state[0..dim].to_vec()
        } else {
            vec![0.0; dim]
        };

        let mut phase_direction = vec![0.0; dim];
        system.apply(0.0, &phase_anchor, &mut phase_direction);
        let norm: f64 = phase_direction.iter().map(|x| x * x).sum::<f64>().sqrt();
        if norm > 1e-12 {
            for x in &mut phase_direction {
                *x /= norm;
            }
        } else {
            phase_direction = vec![1.0; dim];
        }

        Ok(Self {
            system,
            param1_index,
            param2_index,
            dim,
            ntst,
            ncol,
            coeffs,
            phase_anchor,
            phase_direction,
            target_period: period,
            cached_jac: None,
            work_f,
            work_j,
        })
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
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();

        let n_stages = self.ntst * self.ncol;
        let n_eqs = n_stages * self.dim + self.ntst * self.dim + 1 + self.dim;
        let n_vars = self.ncoords() + 1; // coords + T

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
            }
        }

        // Fill collocation Jacobian entries.
        for interval in 0..self.ntst {
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
            }
        }

        // Continuity equations.
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
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
        }

        // Phase condition.
        let phase_row = cont_row + self.ntst * self.dim;
        let mesh0_col = n_stages * self.dim;
        for d in 0..self.dim {
            jac[(phase_row, mesh0_col + d)] = self.phase_direction[d];
        }

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
        explicit_profile_palc_weights(
            self.dimension() + 1,
            self.ntst,
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

        let h = period / self.ntst as f64;
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

        // Phase condition.
        let phase_row = cont_row + self.ntst * self.dim;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mut phase = 0.0;
        for d in 0..self.dim {
            phase += (mesh0[d] - self.phase_anchor[d]) * self.phase_direction[d];
        }
        out[phase_row] = phase;

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
        collocation_profile_is_acceptable(
            self.system,
            self.param1_index,
            self.param2_index,
            self.get_p1(aug),
            self.get_p2(aug),
            &mesh_states,
            &stage_states,
            self.get_period(aug),
            self.ntst,
            self.ncol,
            &self.coeffs.nodes,
        )
    }

    fn update_after_step(&mut self, _aug: &DVector<f64>) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::IsoperiodicCurveProblem;
    use crate::continuation::ContinuationProblem;
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
}
