//! LPC (Limit Point of Cycles) curve continuation.
//!
//! Continues fold bifurcations of limit cycles in two-parameter space.
//! The defining system is:
//! - Standard BVP for the limit cycle: F(u, T, p) = 0
//! - Singularity condition: G = 0 where G detects μ = 1 multiplier

use super::{collocation_profile_is_acceptable, explicit_profile_palc_weights, LCBorders};
use crate::continuation::codim1_curves::Codim2TestFunctions;
use crate::continuation::periodic::{extract_multipliers_collocation, CollocationCoefficients};
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};

/// LPC curve continuation problem.
///
/// Augmented state layout: [p1, stages..., meshes..., T, p2]
/// where:
/// - p1: First continuation parameter  
/// - stages: Stage states (ntst × ncol × dim values)
/// - meshes: Mesh point states ((ntst+1) × dim values, with implicit periodicity)
/// - T: Period
/// - p2: Second continuation parameter
///
/// Residual: [collocation eqns, continuity eqns, phase condition, G singularity]
pub struct LPCCurveProblem<'a> {
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
    /// Border vectors for singularity
    borders: LCBorders,
    /// Cached BVP Jacobian for G computation
    cached_jac: Option<DMatrix<f64>>,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
    /// Codim-2 test function values
    codim2_tests: Codim2TestFunctions,
}

impl<'a> LPCCurveProblem<'a> {
    /// Create a new LPC curve problem from a detected LPC point.
    pub fn new(
        system: &'a mut EquationSystem,
        lc_state: Vec<f64>,
        _period: f64,
        param1_index: usize,
        param2_index: usize,
        _param1_value: f64,
        _param2_value: f64,
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        let dim = system.equations.len();
        if ntst < 2 {
            bail!("LPC curve requires at least two mesh intervals");
        }
        let coeffs = CollocationCoefficients::new(ncol)?;

        let stage_count = ntst * ncol;
        let ncoords = stage_count * dim + (ntst + 1) * dim; // stages + mesh points

        // Work arrays for evaluations
        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];

        // Phase anchor and direction from first mesh state
        let mesh_start = stage_count * dim;
        let phase_anchor = if lc_state.len() >= mesh_start + dim {
            lc_state[mesh_start..mesh_start + dim].to_vec()
        } else if lc_state.len() >= dim {
            lc_state[0..dim].to_vec()
        } else {
            vec![0.0; dim]
        };

        // Use f(anchor) as direction
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

        // Initialize borders with uniform vectors
        let phi = DVector::from_element(ncoords + 1, 1.0 / ((ncoords + 1) as f64).sqrt());
        let psi = phi.clone();
        let borders = LCBorders::new(phi, psi);

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
            borders,
            cached_jac: None,
            work_f,
            work_j,
            codim2_tests: Codim2TestFunctions::default(),
        })
    }

    /// Number of LC coords (stages + mesh states)
    fn ncoords(&self) -> usize {
        self.ntst * self.ncol * self.dim + (self.ntst + 1) * self.dim
    }

    /// Index of period T in augmented state
    fn period_index(&self) -> usize {
        1 + self.ncoords() // after p1 and coords
    }

    /// Index of p2 in augmented state
    fn param2_idx(&self) -> usize {
        self.period_index() + 1
    }

    /// Total augmented state dimension
    #[allow(dead_code)]
    fn aug_dim(&self) -> usize {
        // p1 + coords + T + p2
        1 + self.ncoords() + 1 + 1
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }

    /// Number of residual equations
    fn n_eqs(&self) -> usize {
        // collocation + continuity + periodic boundary + phase + G
        self.ntst * self.ncol * self.dim + self.ntst * self.dim + self.dim + 1 + 1
    }

    /// Extract p1 from augmented state
    fn get_p1(&self, aug: &DVector<f64>) -> f64 {
        aug[0]
    }

    /// Extract p2 from augmented state
    fn get_p2(&self, aug: &DVector<f64>) -> f64 {
        aug[self.param2_idx()]
    }

    /// Extract period from augmented state
    fn get_period(&self, aug: &DVector<f64>) -> f64 {
        aug[self.period_index()]
    }

    /// Get stage state at (interval, stage)
    fn stage_slice<'b>(&self, aug: &'b [f64], interval: usize, stage: usize) -> &'b [f64] {
        let idx = interval * self.ncol + stage;
        let start = 1 + idx * self.dim;
        &aug[start..start + self.dim]
    }

    /// Get an explicit mesh state at index `0..=ntst`.
    fn mesh_slice<'b>(&self, aug: &'b [f64], idx: usize) -> &'b [f64] {
        let actual = idx.min(self.ntst);
        let mesh_offset = 1 + self.ntst * self.ncol * self.dim;
        let start = mesh_offset + actual * self.dim;
        &aug[start..start + self.dim]
    }

    /// Set parameters and evaluate function
    fn eval_f(&mut self, state: &[f64], p1: f64, p2: f64) -> Vec<f64> {
        // Set parameters
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;

        let mut result = vec![0.0; self.dim];
        self.system.apply(0.0, state, &mut result);
        result
    }

    /// Set parameters and evaluate Jacobian
    fn eval_jac(&mut self, state: &[f64], p1: f64, p2: f64) -> Result<Vec<f64>> {
        self.system.params[self.param1_index] = p1;
        self.system.params[self.param2_index] = p2;
        compute_jacobian(self.system, SystemKind::Flow, state)
    }

    /// Compute singularity G from bordered system
    fn compute_g(&self, jac: &DMatrix<f64>) -> Result<f64> {
        let n = jac.nrows();
        if n == 0 || jac.ncols() != n {
            bail!("LPC bordered singularity requires a nonempty square Jacobian");
        }
        if self.borders.phi.len() != n || self.borders.psi.len() != n {
            bail!("LPC bordered singularity dimensions do not match");
        }
        if jac.iter().any(|value| !value.is_finite())
            || self.borders.phi.iter().any(|value| !value.is_finite())
            || self.borders.psi.iter().any(|value| !value.is_finite())
        {
            bail!("LPC bordered singularity contains non-finite inputs");
        }
        if self.borders.phi.norm() <= 1e-12 || self.borders.psi.norm() <= 1e-12 {
            bail!("LPC bordered singularity received a near-zero border vector");
        }
        let mut bordered = DMatrix::zeros(n + 1, n + 1);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);

        for i in 0..n {
            bordered[(i, n)] = self.borders.psi[i];
        }
        for i in 0..n {
            bordered[(n, i)] = self.borders.phi[i];
        }
        bordered[(n, n)] = 0.0;

        let mut rhs = DVector::zeros(n + 1);
        rhs[n] = 1.0;

        let solution = bordered
            .lu()
            .solve(&rhs)
            .ok_or_else(|| anyhow::anyhow!("LPC bordered singularity solve is singular"))?;
        if solution.iter().any(|value| !value.is_finite()) {
            bail!("LPC bordered singularity solve returned non-finite values");
        }
        Ok(solution[n])
    }

    /// Build the LC BVP Jacobian (for multiplier extraction)
    fn build_bvp_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();

        let n_stages = self.ntst * self.ncol;
        let n_eqs = n_stages * self.dim + self.ntst * self.dim + self.dim + 1;
        let n_vars = self.ncoords() + 1; // coords + T
        let period_col = n_vars - 1;
        let dh_dperiod = 1.0 / self.ntst as f64;

        let mut jac = DMatrix::<f64>::zeros(n_eqs, n_vars);

        // Evaluate all stage vector fields and Jacobians. The vector fields are
        // needed for the derivative of the time-rescaled collocation equations
        // with respect to the unknown period.
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let j = self.eval_jac(&z, p1, p2)?;
                let idx = interval * self.ncol + stage;
                let f_start = idx * self.dim;
                self.work_f[f_start..f_start + self.dim].copy_from_slice(&f);
                let start = idx * self.dim * self.dim;
                if start + self.dim * self.dim <= self.work_j.len() {
                    self.work_j[start..start + self.dim * self.dim].copy_from_slice(&j);
                }
            }
        }

        // Fill collocation Jacobian entries
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
                        jac[(row + r, period_col)] -=
                            dh_dperiod * a * self.work_f[k_idx * self.dim + r];
                    }
                }
            }
        }

        // Continuity equations
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let row = cont_row + interval * self.dim;
            let mesh_col = n_stages * self.dim + interval * self.dim;
            let next_col = n_stages * self.dim + (interval + 1) * self.dim;

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
                    jac[(row + r, period_col)] -=
                        dh_dperiod * b * self.work_f[k_idx * self.dim + r];
                }
            }
        }

        // Explicit periodic boundary condition mesh_ntst = mesh_0.
        let periodic_row = cont_row + self.ntst * self.dim;
        let mesh0_col = n_stages * self.dim;
        let mesh_end_col = n_stages * self.dim + self.ntst * self.dim;
        for d in 0..self.dim {
            jac[(periodic_row + d, mesh0_col + d)] = -1.0;
            jac[(periodic_row + d, mesh_end_col + d)] = 1.0;
        }

        // Phase condition
        let phase_row = periodic_row + self.dim;
        for d in 0..self.dim {
            jac[(phase_row, mesh0_col + d)] = self.phase_direction[d];
        }

        Ok(jac)
    }

    /// Remap the stage-first BVP Jacobian with an explicit closing mesh point
    /// to the mesh-first, implicitly periodic layout used by the collocation
    /// Floquet extractor.
    fn remap_jac_for_multiplier_extraction(&self, jac: &DMatrix<f64>) -> DMatrix<f64> {
        let stage_cols = self.ntst * self.ncol * self.dim;
        let explicit_mesh_cols = (self.ntst + 1) * self.dim;
        let current_mesh_start = stage_cols;
        let current_period_col = stage_cols + explicit_mesh_cols;

        let implicit_mesh_cols = self.ntst * self.dim;
        let expected_stage_start = 1 + implicit_mesh_cols;
        let expected_period_col = expected_stage_start + stage_cols;
        let expected_cols = expected_period_col + 1;
        let expected_rows = stage_cols + implicit_mesh_cols + 1;
        let source_phase_row = stage_cols + implicit_mesh_cols + self.dim;
        let expected_phase_row = stage_cols + implicit_mesh_cols;
        let mut remapped = DMatrix::<f64>::zeros(expected_rows, expected_cols);

        for expected_row in 0..expected_rows {
            // The source stores explicit periodic-BC rows before its phase row;
            // those rows become redundant after folding mesh_ntst into mesh_0.
            let source_row = if expected_row == expected_phase_row {
                source_phase_row
            } else {
                expected_row
            };

            for stage_col in 0..stage_cols {
                remapped[(expected_row, expected_stage_start + stage_col)] =
                    jac[(source_row, stage_col)];
            }
            for interval in 0..self.ntst {
                for component in 0..self.dim {
                    let source_col = current_mesh_start + interval * self.dim + component;
                    let expected_col = 1 + interval * self.dim + component;
                    remapped[(expected_row, expected_col)] += jac[(source_row, source_col)];
                }
            }
            for component in 0..self.dim {
                let source_col = current_mesh_start + self.ntst * self.dim + component;
                let expected_col = 1 + component;
                remapped[(expected_row, expected_col)] += jac[(source_row, source_col)];
            }
            remapped[(expected_row, expected_period_col)] = jac[(source_row, current_period_col)];
        }

        remapped
    }
}

impl<'a> ContinuationProblem for LPCCurveProblem<'a> {
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

        // Evaluate all stage functions
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let z = self.stage_slice(aug_slice, interval, stage).to_vec();
                let f = self.eval_f(&z, p1, p2);
                let start = (interval * self.ncol + stage) * self.dim;
                self.work_f[start..start + self.dim].copy_from_slice(&f);
            }
        }

        // Collocation equations
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

        // Continuity equations
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

        // Explicit periodic boundary condition.
        let periodic_row = cont_row + self.ntst * self.dim;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mesh_end = self.mesh_slice(aug_slice, self.ntst);
        for d in 0..self.dim {
            out[periodic_row + d] = mesh_end[d] - mesh0[d];
        }

        // Phase condition
        let phase_row = periodic_row + self.dim;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mut phase = 0.0;
        for d in 0..self.dim {
            phase += (mesh0[d] - self.phase_anchor[d]) * self.phase_direction[d];
        }
        out[phase_row] = phase;

        // Singularity G
        let jac = self.build_bvp_jac(aug)?;
        let g = self.compute_g(&jac)?;
        out[phase_row + 1] = g;

        self.cached_jac = Some(jac);
        Ok(())
    }

    fn extended_jacobian(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
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
        let jac = if let Some(ref j) = self.cached_jac {
            j.clone()
        } else {
            self.build_bvp_jac(aug)?
        };

        let remapped_jac = self.remap_jac_for_multiplier_extraction(&jac);
        let multipliers =
            extract_multipliers_collocation(&remapped_jac, self.dim, self.ntst, self.ncol)?;

        // Placeholder codim-2 tests
        let mut tests = Codim2TestFunctions::default();
        tests.fold_flip = 1.0;
        tests.fold_ns = 1.0;
        self.codim2_tests = tests;

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
        if let Some(ref jac) = self.cached_jac {
            self.borders.update(jac)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::equation_engine::{Bytecode, OpCode};

    fn rotation_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![OpCode::LoadVar(1), OpCode::Neg],
                },
                Bytecode {
                    ops: vec![OpCode::LoadVar(0)],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    fn linear_growth_system() -> EquationSystem {
        EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![OpCode::LoadVar(0)],
                },
                Bytecode {
                    ops: vec![OpCode::LoadVar(1)],
                },
            ],
            vec![0.0, 0.0],
        )
    }

    #[test]
    fn explicit_periodic_mesh_makes_lpc_problem_square() {
        let mut system = rotation_system();
        let ntst = 3;
        let ncol = 2;
        let ncoords = ntst * ncol * 2 + (ntst + 1) * 2;
        let problem = LPCCurveProblem::new(
            &mut system,
            vec![0.0; ncoords],
            std::f64::consts::TAU,
            0,
            1,
            0.0,
            0.0,
            ntst,
            ncol,
        )
        .expect("LPC problem");

        assert_eq!(problem.dimension() + 1, 1 + ncoords + 1 + 1);
    }

    #[test]
    fn diagnostics_remap_dim_two_returns_collocation_multipliers() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let ncoords = ntst * ncol * 2 + (ntst + 1) * 2;
        let mut problem = LPCCurveProblem::new(
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
        .expect("LPC problem");
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[problem.period_index()] = 1.0;

        let diagnostics = problem
            .diagnostics(&aug)
            .expect("canonical Floquet extraction");
        assert_eq!(diagnostics.eigenvalues.len(), 2);
        for multiplier in diagnostics.eigenvalues {
            assert!(multiplier.im.abs() < 1e-12);
            assert!((multiplier.re - 25.0 / 9.0).abs() < 1e-10);
        }
    }

    #[test]
    fn bvp_period_column_matches_finite_difference() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let ncoords = ntst * ncol * 2 + (ntst + 1) * 2;
        let mut problem = LPCCurveProblem::new(
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
        .expect("LPC problem");

        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[1] = 1.0;
        aug[2] = -2.0;
        aug[3] = 3.0;
        aug[4] = 4.0;
        aug[problem.period_index()] = 1.25;

        let bvp_jac = problem.build_bvp_jac(&aug).expect("BVP Jacobian");
        let period_col = problem.ncoords();
        assert!(
            bvp_jac.column(period_col).norm() > 1e-6,
            "the period column must carry the time-rescaling derivative"
        );

        let eps = 1e-6;
        let mut aug_plus = aug.clone();
        aug_plus[problem.period_index()] += eps;
        let mut residual_plus = DVector::zeros(problem.dimension());
        problem
            .residual(&aug_plus, &mut residual_plus)
            .expect("positive period perturbation");

        let mut aug_minus = aug;
        aug_minus[problem.period_index()] -= eps;
        let mut residual_minus = DVector::zeros(problem.dimension());
        problem
            .residual(&aug_minus, &mut residual_minus)
            .expect("negative period perturbation");

        for row in 0..bvp_jac.nrows() {
            let finite_difference = (residual_plus[row] - residual_minus[row]) / (2.0 * eps);
            assert!(
                (bvp_jac[(row, period_col)] - finite_difference).abs() < 1e-8,
                "period derivative mismatch at row {row}: analytic={}, finite_difference={finite_difference}",
                bvp_jac[(row, period_col)],
            );
        }
    }

    #[test]
    fn rejects_single_interval_layout() {
        let mut system = rotation_system();
        let ntst = 1;
        let ncol = 1;
        let ncoords = ntst * ncol * 2 + (ntst + 1) * 2;
        let result = LPCCurveProblem::new(
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
            .expect("single-interval LPC layout must be rejected");
        assert!(error.to_string().contains("at least two mesh intervals"));
    }

    #[test]
    fn palc_metric_normalizes_the_explicit_collocation_profile() {
        let mut system = linear_growth_system();
        let ntst = 3;
        let ncol = 2;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let problem = LPCCurveProblem::new(
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
        .expect("LPC problem");
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
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = LPCCurveProblem::new(
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
        .expect("LPC problem");
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
    fn lpc_singularity_rejects_failed_and_nonfinite_bordered_solves() {
        let mut system = linear_growth_system();
        let ntst = 2;
        let ncol = 1;
        let dim = 2;
        let ncoords = ntst * ncol * dim + (ntst + 1) * dim;
        let mut problem = LPCCurveProblem::new(
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
        .expect("LPC problem");
        let operator_dim = ncoords + 1;
        problem.borders = LCBorders::new(
            DVector::from_vec({
                let mut values = vec![0.0; operator_dim];
                values[0] = 1.0;
                values
            }),
            DVector::from_vec({
                let mut values = vec![0.0; operator_dim];
                values[0] = 1.0;
                values
            }),
        );

        let singular = DMatrix::zeros(operator_dim, operator_dim);
        assert!(problem.compute_g(&singular).is_err());

        let nonfinite = DMatrix::from_element(operator_dim, operator_dim, f64::NAN);
        assert!(problem.compute_g(&nonfinite).is_err());

        let nonsquare = DMatrix::zeros(operator_dim, operator_dim + 1);
        assert!(problem.compute_g(&nonsquare).is_err());

        problem.borders =
            LCBorders::new(DVector::zeros(operator_dim), DVector::zeros(operator_dim));
        let mut aug = DVector::zeros(problem.dimension() + 1);
        aug[problem.period_index()] = 1.0;
        let mut residual = DVector::zeros(problem.dimension());
        assert!(problem.residual(&aug, &mut residual).is_err());
    }
}
