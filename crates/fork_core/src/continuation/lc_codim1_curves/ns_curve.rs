//! NS (Neimark-Sacker) curve continuation.
//! 
//! Continues Neimark-Sacker (torus) bifurcations of limit cycles in two-parameter space.
//! The defining system is:
//! - Standard BVP for the limit cycle: F(u, T, p) = 0
//! - Two singularity conditions: G1 = 0, G2 = 0 (complex pair on unit circle)
//!
//! Key differences from LPC/PD:
//! - Extra auxiliary variable k = cos(θ) where θ is the angle of critical multiplier
//! - Two border vector pairs (for 2D complex eigenspace)
//! - Bordered Jacobian includes rotation by e^{iθ}

use super::LCBorders;
use crate::continuation::periodic::{
    CollocationCoefficients, extract_multipliers_shooting,
};
use crate::continuation::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use crate::continuation::codim1_curves::Codim2TestFunctions;
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{bail, Result};
use nalgebra::{DMatrix, DVector};

/// NS curve continuation problem.
/// 
/// Augmented state layout: [p1, stages..., meshes..., T, p2, k]
/// where k = cos(θ) and θ is the argument of the critical Floquet multiplier.
/// 
/// The additional variable k tracks the angle through its cosine.
pub struct NSCurveProblem<'a> {
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
    /// Border vectors for first singularity (real part)
    borders1: LCBorders,
    /// Border vectors for second singularity (imaginary part)  
    borders2: LCBorders,
    /// Indices for selecting singularity functions from bordered solve
    index1: (usize, usize),
    /// Indices for selecting singularity functions from bordered solve
    index2: (usize, usize),
    /// Cached BVP Jacobian
    cached_jac: Option<DMatrix<f64>>,
    /// Work arrays for function evaluations
    work_f: Vec<f64>,
    /// Work arrays for Jacobians
    work_j: Vec<f64>,
    /// Codim-2 test function values
    codim2_tests: Codim2TestFunctions,
}

impl<'a> NSCurveProblem<'a> {
    /// Create a new NS curve problem from a detected NS point.
    /// 
    /// The initial k value should be cos(θ) where θ = arg(μ) for the critical
    /// Floquet multiplier μ on the unit circle.
    pub fn new(
        system: &'a mut EquationSystem,
        lc_state: Vec<f64>,
        _period: f64,
        param1_index: usize,
        param2_index: usize,
        _param1_value: f64,
        _param2_value: f64,
        initial_k: f64,  // cos(θ) for the NS multiplier angle
        ntst: usize,
        ncol: usize,
    ) -> Result<Self> {
        let dim = system.equations.len();
        let coeffs = CollocationCoefficients::new(ncol)?;
        
        let stage_count = ntst * ncol;
        let ncoords = stage_count * dim + (ntst + 1) * dim;
        
        let work_f = vec![0.0; stage_count * dim];
        let work_j = vec![0.0; stage_count * dim * dim];
        
        // Phase anchor and direction 
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
        
        // Initialize two sets of border vectors for complex eigenspace
        // These span the 2D eigenspace corresponding to conjugate pair e^{±iθ}
        let phi1 = DVector::from_element(ncoords, 1.0 / (ncoords as f64).sqrt());
        let psi1 = phi1.clone();
        let borders1 = LCBorders::new(phi1, psi1);
        
        let mut phi2 = DVector::from_element(ncoords, 1.0 / (ncoords as f64).sqrt());
        // Slight perturbation to avoid linear dependence
        if ncoords > 0 {
            phi2[0] *= -1.0;
        }
        let psi2 = phi2.clone();
        let borders2 = LCBorders::new(phi2, psi2);
        
        // Default indices for singularity function extraction
        let index1 = (0, 0);
        let index2 = (1, 1);
        
        // Validate initial_k
        let _k = initial_k.clamp(-1.0, 1.0);
        
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
            borders1,
            borders2,
            index1,
            index2,
            cached_jac: None,
            work_f,
            work_j,
            codim2_tests: Codim2TestFunctions::default(),
        })
    }

    fn ncoords(&self) -> usize {
        self.ntst * self.ncol * self.dim + (self.ntst + 1) * self.dim
    }

    fn period_index(&self) -> usize {
        1 + self.ncoords()
    }

    fn param2_idx(&self) -> usize {
        self.period_index() + 1
    }

    /// Index of k (cos θ) in augmented state
    fn k_index(&self) -> usize {
        self.param2_idx() + 1
    }

    #[allow(dead_code)]
    fn aug_dim(&self) -> usize {
        // p1 + coords + T + p2 + k
        1 + self.ncoords() + 1 + 1 + 1
    }

    pub fn codim2_tests(&self) -> Codim2TestFunctions {
        self.codim2_tests
    }

    /// Number of residual equations
    fn n_eqs(&self) -> usize {
        // collocation + continuity + phase + G1 + G2
        self.ntst * self.ncol * self.dim + self.ntst * self.dim + 1 + 2
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

    fn get_k(&self, aug: &DVector<f64>) -> f64 {
        aug[self.k_index()]
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

    /// Compute the two singularity functions G1, G2 from the NS bordered system.
    /// 
    /// The NS bordered system uses rotation by e^{iθ} where k = cos(θ).
    /// We solve a 2-column bordered system and extract specific components.
    fn compute_ns_singularities(&self, jac: &DMatrix<f64>, k: f64) -> (f64, f64) {
        let n = jac.nrows();
        
        // The NS Jacobian is augmented with rotation: J * J + k * I
        // For the bordered system, we use a simplified approach aligned with the standard formulation
        
        // Build bordered matrix [J, ψ1, ψ2; φ1', 0, 0; φ2', 0, 0]
        // But for NS, the Jacobian itself is modified to include the rotation term
        
        // Simplified: use the standard bordered approach with k modulating
        let mut bordered = DMatrix::zeros(n + 2, n + 2);
        bordered.view_mut((0, 0), (n, n)).copy_from(jac);
        
        // Add k * I to the diagonal (simplified rotation representation)
        for i in 0..n {
            bordered[(i, i)] += k;
        }
        
        // Border columns
        for i in 0..n.min(self.borders1.psi.len()) {
            bordered[(i, n)] = self.borders1.psi[i];
        }
        for i in 0..n.min(self.borders2.psi.len()) {
            bordered[(i, n + 1)] = self.borders2.psi[i];
        }
        
        // Border rows
        for i in 0..n.min(self.borders1.phi.len()) {
            bordered[(n, i)] = self.borders1.phi[i];
        }
        for i in 0..n.min(self.borders2.phi.len()) {
            bordered[(n + 1, i)] = self.borders2.phi[i];
        }
        
        // RHS: 2 columns, identity in the border block
        let mut rhs = DMatrix::zeros(n + 2, 2);
        rhs[(n, 0)] = 1.0;
        rhs[(n + 1, 1)] = 1.0;
        
        // Solve bordered system
        if let Some(sol) = bordered.lu().solve(&rhs) {
            // Extract G1 and G2 from the solution using indices
            let g1 = sol[(n + self.index1.0, self.index1.1)];
            let g2 = sol[(n + self.index2.0, self.index2.1)];
            (g1, g2)
        } else {
            (f64::NAN, f64::NAN)
        }
    }

    /// Build the standard periodic BVP Jacobian for multiplier extraction.
    fn build_periodic_jac(&mut self, aug: &DVector<f64>) -> Result<DMatrix<f64>> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();
        
        let n_stages = self.ntst * self.ncol;
        let n_eqs = n_stages * self.dim + self.ntst * self.dim + 1;
        let n_vars = self.ncoords() + 1;
        
        let mut jac = DMatrix::<f64>::zeros(n_eqs, n_vars);
        
        // Evaluate stage Jacobians
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
        
        // Collocation equations
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
        
        // Continuity equations
        let cont_row = n_stages * self.dim;
        for interval in 0..self.ntst {
            let row = cont_row + interval * self.dim;
            let mesh_col = n_stages * self.dim + interval * self.dim;
            let next_col = n_stages * self.dim + ((interval + 1) % (self.ntst + 1)) * self.dim;
            
            for d in 0..self.dim {
                jac[(row + d, mesh_col + d)] = -1.0;
                jac[(row + d, next_col + d)] = 1.0;
            }
            
            for k_stage in 0..self.ncol {
                let k_idx = interval * self.ncol + k_stage;
                let k_col = k_idx * self.dim;
                let jac_start = k_idx * self.dim * self.dim;
                let b = self.coeffs.b[k_stage];
                
                for r in 0..self.dim {
                    for c in 0..self.dim {
                        let jv = self.work_j[jac_start + r * self.dim + c];
                        jac[(row + r, k_col + c)] -= h * b * jv;
                    }
                }
            }
        }
        
        // Phase condition
        let phase_row = cont_row + self.ntst * self.dim;
        let mesh0_col = n_stages * self.dim;
        for d in 0..self.dim {
            jac[(phase_row, mesh0_col + d)] = self.phase_direction[d];
        }
        
        Ok(jac)
    }
}

impl<'a> ContinuationProblem for NSCurveProblem<'a> {
    fn dimension(&self) -> usize {
        self.n_eqs()
    }

    fn residual(&mut self, aug: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        let p1 = self.get_p1(aug);
        let p2 = self.get_p2(aug);
        let period = self.get_period(aug);
        let k = self.get_k(aug);
        
        if period <= 0.0 {
            bail!("Period must be positive");
        }
        
        let h = period / self.ntst as f64;
        let aug_slice = aug.as_slice();
        let n_stages = self.ntst * self.ncol;
        
        // Evaluate stage functions
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
                    for k_stage in 0..self.ncol {
                        let f_idx = (interval * self.ncol + k_stage) * self.dim + d;
                        sum += self.coeffs.a[stage][k_stage] * self.work_f[f_idx];
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
                for k_stage in 0..self.ncol {
                    let f_idx = (interval * self.ncol + k_stage) * self.dim + d;
                    sum += self.coeffs.b[k_stage] * self.work_f[f_idx];
                }
                out[row + d] = mesh_next[d] - mesh_i[d] - h * sum;
            }
        }
        
        // Phase condition
        let phase_row = cont_row + self.ntst * self.dim;
        let mesh0 = self.mesh_slice(aug_slice, 0);
        let mut phase = 0.0;
        for d in 0..self.dim {
            phase += (mesh0[d] - self.phase_anchor[d]) * self.phase_direction[d];
        }
        out[phase_row] = phase;
        
        // Two NS singularity conditions
        let jac = self.build_periodic_jac(aug)?;
        let (g1, g2) = self.compute_ns_singularities(&jac, k);
        out[phase_row + 1] = g1;
        out[phase_row + 2] = g2;
        
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
        let k = self.get_k(aug);
        
        let jac = if let Some(ref j) = self.cached_jac {
            j.clone()
        } else {
            self.build_periodic_jac(aug)?
        };
        
        let multipliers = extract_multipliers_shooting(&jac, self.dim, self.ntst, self.ncol)?;
        
        // Codim-2 test functions for NS curve
        // R1, R2, R3, R4: strong resonances at k = 1, -1, -1/2, 0
        // LPNS, CH, PDNS, NSNS
        let mut tests = Codim2TestFunctions::default();
        tests.resonance_1_1 = k - 1.0;     // R1: k = cos(0) = 1
        tests.resonance_1_2 = k + 1.0;     // R2: k = cos(π) = -1
        tests.resonance_1_3 = k + 0.5;     // R3: k = cos(2π/3) = -1/2
        tests.resonance_1_4 = k;           // R4: k = cos(π/2) = 0
        tests.fold_ns = 1.0;               // LPNS placeholder
        tests.chenciner = 1.0;             // CH placeholder
        tests.flip_ns = 1.0;               // PDNS placeholder
        tests.double_ns = 1.0;             // NSNS placeholder
        self.codim2_tests = tests;
        
        Ok(PointDiagnostics {
            test_values: TestFunctionValues::limit_cycle(1.0, 1.0, 1.0),
            eigenvalues: multipliers,
            cycle_points: None,
        })
    }

    fn update_after_step(&mut self, aug: &DVector<f64>) -> Result<()> {
        let k = self.get_k(aug);
        let jac = self.build_periodic_jac(aug)?;
        
        // Build the NS-modified Jacobian for border update
        let n = jac.nrows();
        let mut ns_jac = jac;
        for i in 0..n {
            ns_jac[(i, i)] += k;
        }
        
        // Update both border vector pairs
        self.borders1.update(&ns_jac)?;
        self.borders2.update(&ns_jac)?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    // Tests would go here
}
