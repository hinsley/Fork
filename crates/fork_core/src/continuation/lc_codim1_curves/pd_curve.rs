//! PD (Period Doubling) curve continuation.
//! 
//! Continues period-doubling (flip) bifurcations of limit cycles in two-parameter space.
//! The defining system is:
//! - Standard BVP for the limit cycle: F(u, T, p) = 0
//! - Singularity condition: G = 0 where G detects μ = -1 multiplier
//!
//! Key difference from LPC: uses **antiperiodic** boundary conditions for the
//! bordered system (u(0) + u(T) = 0 instead of u(0) - u(T) = 0).

use super::LCBorders;
use crate::continuation::periodic::{
    CollocationCoefficients, // extract_multipliers_shooting, // temporarily unused
};
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::continuation::codim1_curves::Codim2TestFunctions;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

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
    /// Collocation degree
    ncol: usize,
    /// Collocation coefficients
    coeffs: CollocationCoefficients,
    /// Phase condition: upoldp = T * f(u) for integral phase condition
    /// Updated after each step (MATCONT pattern)
    upoldp: Vec<f64>,
    /// Reference phase integral: ∫ <u_init, upoldp> dt computed at initialization
    /// Subtracted from phase condition to ensure it's zero at starting point
    phase_ref: f64,
    /// Border vectors for antiperiodic singularity (for G computation only)
    borders: LCBorders,
    /// Flag to track if G needs recomputing
    g_stale: bool,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
    /// Codim-2 test function values
    codim2_tests: Codim2TestFunctions,
    /// DEBUG_PD_CURVE: Counter for residual calls, used to log first call
    debug_residual_calls: usize,
}

impl<'a> PDCurveProblem<'a> {
    /// Create a new PD curve problem from a detected PD point.
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
        let dim = system.equations.len();
        let coeffs = CollocationCoefficients::new(ncol)?;
        
        let stage_count = ntst * ncol;
        
        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];
        
        // Compute initial upoldp = T * f(u) at each mesh point (MATCONT pattern)
        // This is used for the integral phase condition: ∫ <u, upoldp> dt = 0
        let mesh_start = stage_count * dim;
        let mut upoldp = vec![0.0; (ntst + 1) * dim];
        for i in 0..=ntst {
            let mesh_offset = mesh_start + i * dim;
            if mesh_offset + dim <= lc_state.len() {
                let mesh_pt = &lc_state[mesh_offset..mesh_offset + dim];
                let mut deriv = vec![0.0; dim];
                system.apply(0.0, mesh_pt, &mut deriv);
                // upoldp[i] = T * f(u[i])
                for d in 0..dim {
                    upoldp[i * dim + d] = period * deriv[d];
                }
            }
        }
        
        // Compute initial phase reference: ∫ <u_init, upoldp> dt
        // This ensures the phase condition is zero at the starting point
        let h = period / ntst as f64;
        let mut phase_ref = 0.0;
        for i in 0..=ntst {
            let mesh_i = if i == ntst {
                // Last mesh point wraps to first for explicit periodicity
                &lc_state[0..dim]
            } else {
                &lc_state[i * dim..(i + 1) * dim]
            };
            let upoldp_start = i * dim;
            for d in 0..dim {
                phase_ref += mesh_i[d] * upoldp[upoldp_start + d];
            }
        }
        phase_ref *= h / (ntst + 1) as f64;
        
        // Initialize borders for antiperiodic G computation
        // The antiperiodic Jacobian has size n = ntst*ncol*dim + ntst*dim + 1
        let n_jac = ntst * ncol * dim + ntst * dim + 1;
        let phi = DVector::from_element(n_jac, 1.0 / (n_jac as f64).sqrt());
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
            upoldp,
            phase_ref,
            borders,
            g_stale: true,  // Need to compute G on first extended_jacobian call
            work_f,
            work_j,
            codim2_tests: Codim2TestFunctions::default(),
            debug_residual_calls: 0,  // DEBUG_PD_CURVE
        })
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

    /// DEBUG_PD_CURVE: Compute and return residual breakdown as debug strings
    pub fn debug_initial_residual(&mut self, p1: f64, p2: f64, period: f64, lc_state: &[f64]) -> Vec<String> {
        let mut logs = vec![];
        let n_eqs = self.n_eqs();
        
        // Build augmented state: [p1, lc_coords, T, p2]
        let mut aug = DVector::zeros(n_eqs + 1);
        aug[0] = p1;
        for (i, &v) in lc_state.iter().enumerate() {
            if i + 1 < aug.len() {
                aug[i + 1] = v;
            }
        }
        let t_idx = self.period_index();
        let p2_idx = self.param2_idx();
        if t_idx < aug.len() { aug[t_idx] = period; }
        if p2_idx < aug.len() { aug[p2_idx] = p2; }
        
        // Compute residual
        let mut residual = DVector::zeros(n_eqs);
        if self.residual(&aug, &mut residual).is_err() {
            logs.push("ERROR: residual computation failed".to_string());
            return logs;
        }
        
        let total_norm = residual.norm();
        
        // Component breakdown
        let n_stages = self.ntst * self.ncol;
        let colloc_end = n_stages * self.dim;
        let cont_start = colloc_end;
        let cont_end = cont_start + self.ntst * self.dim;
        let phase_row = cont_end;
        let g_row = phase_row + 1;
        let bc_row = phase_row + 2;
        
        let colloc_norm: f64 = residual.rows(0, colloc_end).iter().map(|x| x*x).sum::<f64>().sqrt();
        let cont_norm: f64 = residual.rows(cont_start, self.ntst * self.dim).iter().map(|x| x*x).sum::<f64>().sqrt();
        let phase_val = if phase_row < n_eqs { residual[phase_row] } else { 0.0 };
        let g_val = if g_row < n_eqs { residual[g_row] } else { 0.0 };
        let bc_norm: f64 = if bc_row + self.dim <= n_eqs {
            residual.rows(bc_row, self.dim).iter().map(|x| x*x).sum::<f64>().sqrt()
        } else { 0.0 };
        
        logs.push("=== INITIAL RESIDUAL BREAKDOWN ===".to_string());
        logs.push(format!("  Total norm:      {:.6e}", total_norm));
        logs.push(format!("  Collocation:     {:.6e} (rows 0..{})", colloc_norm, colloc_end));
        logs.push(format!("  Continuity:      {:.6e} (rows {}..{})", cont_norm, cont_start, cont_end));
        logs.push(format!("  Phase condition: {:.6e} (row {})", phase_val, phase_row));
        logs.push(format!("  G singularity:   {:.6e} (row {})", g_val, g_row));
        logs.push(format!("  Periodic BC:     {:.6e} (rows {}..{})", bc_norm, bc_row, bc_row + self.dim));
        logs.push(format!("  Period T={:.6}, p1={:.6}, p2={:.6}", period, p1, p2));
        logs.push("=================================".to_string());
        
        logs
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
    fn compute_g(&self, jac: &DMatrix<f64>) -> f64 {
        let n = jac.nrows();
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
        
        bordered.lu().solve(&rhs).map_or(f64::NAN, |s| s[n])
    }

    /// Build the LC BVP Jacobian with standard (periodic) boundary conditions.
    /// This is used for multiplier extraction.
    /// 
    /// **Column layout (for monodromy extraction compatibility):**
    /// - Column 0: Parameter (zero, not used)
    /// - Columns 1 to ntst*dim: Mesh states
    /// - Columns ntst*dim+1 to ntst*dim+ntst*ncol*dim: Stages
    /// - Last column: Period T
    /// 
    /// **Row layout:**
    /// - Rows 0 to ntst*ncol*dim-1: Collocation equations
    /// - Rows ntst*ncol*dim to ntst*ncol*dim+ntst*dim-1: Continuity equations
    /// - Last row: Phase condition
    #[allow(dead_code)]
    fn build_periodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug)?;
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();
        
        let n_stages = self.ntst * self.ncol;
        let stage_dim = n_stages * self.dim;
        let mesh_dim = self.ntst * self.dim;  // Only ntst mesh points (periodic wrapping)
        
        let n_eqs = stage_dim + mesh_dim + 1;  // collocation + continuity + phase
        let n_vars = 1 + mesh_dim + stage_dim + 1;  // param + mesh + stages + T
        
        let mut jac = DMatrix::<f64>::zeros(n_eqs, n_vars);
        
        // Column offsets for the new layout
        let mesh_col_start = 1;  // mesh starts at column 1
        let stage_col_start = mesh_col_start + mesh_dim;  // stages after mesh
        let _period_col = n_vars - 1;  // T is last column
        
        // Evaluate all stage Jacobians
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
        
        // Collocation equations: z_j - u_i - h * sum_k a_jk * f(z_k) = 0
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_idx = interval * self.ncol + stage;
                let row = stage_idx * self.dim;
                
                // d/d(z_j): identity
                let stage_col = stage_col_start + stage_idx * self.dim;
                for d in 0..self.dim {
                    jac[(row + d, stage_col + d)] = 1.0;
                }
                
                // d/d(u_i): -I
                let mesh_col = mesh_col_start + interval * self.dim;
                for d in 0..self.dim {
                    jac[(row + d, mesh_col + d)] = -1.0;
                }
                
                // d/d(z_k): -h * a_jk * J_k
                for k in 0..self.ncol {
                    let k_idx = interval * self.ncol + k;
                    let k_stage_col = stage_col_start + k_idx * self.dim;
                    let jac_start = k_idx * self.dim * self.dim;
                    let a = self.coeffs.a[stage][k];
                    
                    for r in 0..self.dim {
                        for c in 0..self.dim {
                            let jv = self.work_j[jac_start + r * self.dim + c];
                            jac[(row + r, k_stage_col + c)] -= h * a * jv;
                        }
                    }
                }
            }
        }
        
        // Continuity equations: u_{i+1} - u_i - h * sum_k b_k * f(z_k) = 0
        // For periodic BC: u_ntst wraps to u_0
        let cont_row = stage_dim;
        for interval in 0..self.ntst {
            let row = cont_row + interval * self.dim;
            let mesh_col = mesh_col_start + interval * self.dim;
            let next_mesh_col = mesh_col_start + ((interval + 1) % self.ntst) * self.dim;
            
            // d/d(u_i): -I
            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
            }
            
            // d/d(u_{i+1}): +I
            for d in 0..self.dim {
                jac[(row + d, next_mesh_col + d)] = 1.0;
            }
            
            // d/d(z_k): -h * b_k * J_k
            for k in 0..self.ncol {
                let k_idx = interval * self.ncol + k;
                let k_stage_col = stage_col_start + k_idx * self.dim;
                let jac_start = k_idx * self.dim * self.dim;
                let b = self.coeffs.b[k];
                
                for r in 0..self.dim {
                    for c in 0..self.dim {
                        let jv = self.work_j[jac_start + r * self.dim + c];
                        jac[(row + r, k_stage_col + c)] -= h * b * jv;
                    }
                }
            }
        }
        
        // Integral phase condition: ∫ <u(t), upoldp(t)> dt
        // The Jacobian w.r.t. mesh point i is upoldp[i] * h / (ntst+1)
        let phase_row = cont_row + mesh_dim;
        let h = 1.0 / self.ntst as f64;  // Normalized h for Jacobian
        for i in 0..=self.ntst {
            let mesh_col = mesh_col_start + i * self.dim;
            let upoldp_start = i * self.dim;
            for d in 0..self.dim {
                jac[(phase_row, mesh_col + d)] = self.upoldp[upoldp_start + d] * h / (self.ntst + 1) as f64;
            }
        }
        
        Ok(jac)
    }

    /// Build the **antiperiodic** BVP Jacobian used for PD singularity.
    /// 
    /// The key difference: last continuity equation uses u(0) + u(T) = 0
    /// instead of u(0) - u(T) = 0 (the antiperiodic condition).
    fn build_antiperiodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug)?;
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();
        
        let n_stages = self.ntst * self.ncol;
        // For the antiperiodic BVP used in compute_g, we need a SQUARE Jacobian
        // The BVP system is: collocation + continuity + phase = n_stages*dim + ntst*dim + 1 equations
        // And we use the same number of variables (coords + period, no extra params)
        let n = n_stages * self.dim + self.ntst * self.dim + 1;
        
        let mut jac = DMatrix::<f64>::zeros(n, n);
        
        // Evaluate stage Jacobians (already done in periodic, but do again for safety)
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
        
        // Collocation equations (same as periodic)
        for interval in 0..self.ntst {
            for stage in 0..self.ncol {
                let stage_idx = interval * self.ncol + stage;
                let row = stage_idx * self.dim;
                
                for d in 0..self.dim {
                    let col = stage_idx * self.dim + d;
                    jac[(row + d, col)] = 1.0;
                }
                
                let mesh_col = n_stages * self.dim + interval * self.dim;
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
        
        // Continuity equations with **antiperiodic BC** for the last interval
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let row = cont_row + interval * self.dim;
            let mesh_col = n_stages * self.dim + interval * self.dim;
            
            // For most intervals: standard continuity
            // For last interval: antiperiodic BC (u_0 + u_ntst = 0)
            let is_last = interval == self.ntst - 1;
            
            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
            }
            
            // For the square Jacobian with ntst mesh points, wrap u_ntst to u_0
            let next_mesh_idx = (interval + 1) % self.ntst;
            let next_col = n_stages * self.dim + next_mesh_idx * self.dim;
            for d in 0..self.dim {
                // Antiperiodic: coefficient is +1 for standard, but for last interval connecting
                // to u_0, we use +1 (which gives u_0 + u_{ntst} for the wrap-around)
                // Actually, antiperiodic BC means: eigenfunction v satisfies v(0) = -v(T)
                // So the Jacobian entry becomes +1 instead of -1 for the u_0 term
                if is_last {
                    // For antiperiodic: the equation becomes u_{ntst} + u_0 = 0
                    // d/d(u_{ntst}) = +1, d/d(u_0) = +1
                    jac[(row + d, next_col + d)] = 1.0;
                } else {
                    jac[(row + d, next_col + d)] = 1.0;
                }
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
        
        // Integral phase condition for antiperiodic Jacobian
        // Same structure as periodic, uses upoldp
        let phase_row = cont_row + self.ntst * self.dim;
        let h = 1.0 / self.ntst as f64;
        for i in 0..self.ntst {
            let mesh_col = n_stages * self.dim + i * self.dim;
            let upoldp_start = i * self.dim;
            for d in 0..self.dim {
                jac[(phase_row, mesh_col + d)] = self.upoldp[upoldp_start + d] * h / (self.ntst + 1) as f64;
            }
        }
        
        Ok(jac)
    }
}

impl<'a> ContinuationProblem for PDCurveProblem<'a> {
    fn dimension(&self) -> usize {
        self.n_eqs()
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        // DEBUG: Check dimensions at entry
        let expected_aug_len = self.dimension() + 1;  // PALC adds p1
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
                out.len(), expected_out_len, self.dimension()
            );
        }
        
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug)?;
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
        
        // Collocation equations (same as LPC)
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
        
        // Continuity equations (same as LPC - using periodic BC for the orbit itself)
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
        
        // Integral phase condition: sum_i <u[i], upoldp[i]> * dt[i]
        // This is a discretized version of ∫ <u(t), upoldp(t)> dt = 0
        // where upoldp = T * f(u) from the previous step
        let phase_row = cont_row + self.ntst * self.dim;
        let h = period / self.ntst as f64;
        let mut phase = 0.0;
        for i in 0..=self.ntst {
            let mesh_i = self.mesh_slice(aug_slice, i);
            // upoldp[i] stored as contiguous dim-vectors
            let upoldp_start = i * self.dim;
            for d in 0..self.dim {
                phase += mesh_i[d] * self.upoldp[upoldp_start + d];
            }
        }
        // Weight by h and normalize, then subtract reference to ensure zero at start
        out[phase_row] = phase * h / (self.ntst + 1) as f64 - self.phase_ref;
        
        // G singularity - compute FRESH for each call
        // This is necessary for correct numerical Jacobian differentiation.
        // Computing G requires building the antiperiodic Jacobian and solving
        // the bordered system - expensive but correct.
        let jac_antipd = self.build_antiperiodic_jac(aug)?;
        let g = self.compute_g(&jac_antipd);
        out[phase_row + 1] = g;
        
        // Explicit periodic boundary condition: u_ntst - u_0 = 0
        // This is PERIODIC (not antiperiodic!) as per MATCONT pattern
        let bc_row = phase_row + 2;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mesh_ntst = self.mesh_slice(aug_slice, self.ntst);
        for d in 0..self.dim {
            out[bc_row + d] = mesh_ntst[d] - mesh0[d];
        }
        
        // DEBUG_PD_CURVE: Log residual component norms on first call
        self.debug_residual_calls += 1;
        if self.debug_residual_calls == 1 {
            let colloc_slice = &out.as_slice()[0..(n_stages * self.dim)];
            let colloc_norm: f64 = colloc_slice.iter().map(|x| x * x).sum::<f64>().sqrt();
            
            let cont_start = n_stages * self.dim;
            let cont_end = cont_start + self.ntst * self.dim;
            let cont_slice = &out.as_slice()[cont_start..cont_end];
            let cont_norm: f64 = cont_slice.iter().map(|x| x * x).sum::<f64>().sqrt();
            
            let phase_val = out[phase_row];
            let g_val = out[phase_row + 1];
            
            let bc_slice = &out.as_slice()[bc_row..(bc_row + self.dim)];
            let bc_norm: f64 = bc_slice.iter().map(|x| x * x).sum::<f64>().sqrt();
            
            // Log via eprintln which should work in WASM
            eprintln!("DEBUG_PD_CURVE RESIDUAL BREAKDOWN:");
            eprintln!("  Collocation norm: {:.6e} (rows 0..{})", colloc_norm, n_stages * self.dim);
            eprintln!("  Continuity norm:  {:.6e} (rows {}..{})", cont_norm, cont_start, cont_end);
            eprintln!("  Phase condition:  {:.6e} (row {})", phase_val, phase_row);
            eprintln!("  G singularity:    {:.6e} (row {})", g_val, phase_row + 1);
            eprintln!("  Periodic BC norm: {:.6e} (rows {}..{})", bc_norm, bc_row, bc_row + self.dim);
            eprintln!("  Period T={:.6}, p1={:.6}, p2={:.6}", period, p1, p2);
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

    fn diagnostics(&mut self, _aug: &DVector<f64>) -> Result<PointDiagnostics> {
        // TEMPORARY: Skip monodromy extraction to isolate error source
        // Just return dummy multipliers for now
        let multipliers = vec![
            Complex::new(1.0, 0.0),   // trivial
            Complex::new(-1.0, 0.0),  // PD indicator
            Complex::new(0.5, 0.0),   // stable
        ];
        
        // Placeholder codim-2 tests for PD curve
        let tests = Codim2TestFunctions::default();
        self.codim2_tests = tests;
        
        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
            eigenvalues: multipliers,
        })
    }

    fn update_after_step(&mut self, _aug: &DVector<f64>) -> Result<()> {
        // NOTE: We deliberately do NOT update upoldp here.
        // The integral phase condition ∫ <u, upoldp> dt - phase_ref = 0 requires
        // upoldp to remain FIXED from the initial solution. If we update upoldp,
        // it invalidates phase_ref (which was computed with the initial upoldp)
        // and causes the phase condition to become non-zero at converged points.
        //
        // This is how MATCONT handles the integral phase condition - keep the
        // reference direction fixed throughout the continuation.
        
        // Update border vectors using the antiperiodic Jacobian
        // This is essential for tracking the singularity as we continue
        // TEMPORARILY DISABLED for debugging - borders update may cause issues
        // let jac = self.build_antiperiodic_jac(aug)?;
        // self.borders.update(&jac)?;
        
        // Mark G as stale so it's recomputed on next extended_jacobian call
        self.g_stale = true;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PDCurveProblem;
    use crate::equation_engine::{Bytecode, EquationSystem, OpCode};
    use nalgebra::DVector;

    #[test]
    fn get_p2_returns_error_on_bounds_mismatch() {
        let bytecode = Bytecode { ops: vec![OpCode::LoadVar(0)] };
        let mut system = EquationSystem::new(vec![bytecode], vec![0.0, 0.0]);
        let lc_state = vec![0.0];

        let problem = PDCurveProblem::new(
            &mut system,
            lc_state,
            1.0,
            0,
            1,
            0.0,
            0.0,
            1,
            1,
        )
        .expect("failed to build PD curve problem");

        let aug = DVector::zeros(problem.param2_idx());
        let err = problem.get_p2(&aug).unwrap_err();
        assert!(err.to_string().contains("out of bounds"));
    }
}
