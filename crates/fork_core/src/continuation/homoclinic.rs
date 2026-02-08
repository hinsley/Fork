use super::homoclinic_init::{decode_homoclinic_state, pack_homoclinic_state, HomoclinicSetup};
use super::periodic::CollocationCoefficients;
use super::problem::{ContinuationProblem, PointDiagnostics, TestFunctionValues};
use super::{
    continue_with_problem, BifurcationType, BranchType, ContinuationBranch, ContinuationPoint,
    ContinuationSettings, HomoclinicBasisSnapshot, HomoclinicResumeContext,
};
use crate::equation_engine::EquationSystem;
use crate::equilibrium::{compute_jacobian, SystemKind};
use crate::traits::DynamicalSystem;
use anyhow::{anyhow, bail, Result};
use nalgebra::{DMatrix, DVector};
use num_complex::Complex;

pub fn continue_homoclinic_curve(
    system: &mut EquationSystem,
    setup: HomoclinicSetup,
    settings: ContinuationSettings,
    forward: bool,
) -> Result<ContinuationBranch> {
    let initial_state = pack_homoclinic_state(&setup);
    let initial_point = ContinuationPoint {
        state: initial_state,
        param_value: setup.guess.param1_value,
        stability: BifurcationType::None,
        eigenvalues: Vec::new(),
        cycle_points: None,
    };

    let mut problem = HomoclinicProblem::new(system, setup.clone())?;
    let mut branch = continue_with_problem(&mut problem, initial_point, settings, forward)?;
    branch.branch_type = BranchType::HomoclinicCurve {
        ntst: setup.ntst,
        ncol: setup.ncol,
        param1_name: setup.param1_name.clone(),
        param2_name: setup.param2_name.clone(),
        free_time: setup.extras.free_time,
        free_eps0: setup.extras.free_eps0,
        free_eps1: setup.extras.free_eps1,
    };
    branch.homoc_context = Some(HomoclinicResumeContext {
        base_params: setup.base_params.clone(),
        param1_index: setup.param1_index,
        param2_index: setup.param2_index,
        basis: HomoclinicBasisSnapshot {
            stable_q: setup.basis.stable_q.clone(),
            unstable_q: setup.basis.unstable_q.clone(),
            dim: setup.basis.dim,
            nneg: setup.basis.nneg,
            npos: setup.basis.npos,
        },
        fixed_time: setup.guess.time,
        fixed_eps0: setup.guess.eps0,
        fixed_eps1: setup.guess.eps1,
    });
    Ok(branch)
}

pub struct HomoclinicProblem<'a> {
    system: &'a mut EquationSystem,
    setup: HomoclinicSetup,
    coeffs: CollocationCoefficients,
    phase_ref_mesh: Vec<Vec<f64>>,
    phase_ref_flow: Vec<Vec<f64>>,
    work_stage_f: Vec<f64>,
}

impl<'a> HomoclinicProblem<'a> {
    pub fn new(system: &'a mut EquationSystem, setup: HomoclinicSetup) -> Result<Self> {
        if setup.extras.free_count() == 0 {
            bail!("At least one free homoclinic extra parameter is required");
        }
        if setup.ntst < 2 {
            bail!("Homoclinic continuation requires at least 2 intervals");
        }
        if setup.ncol == 0 {
            bail!("Collocation degree must be positive");
        }
        if setup.guess.mesh_states.len() != setup.ntst + 1 {
            bail!("Homoclinic mesh must contain ntst+1 points");
        }
        if setup.guess.stage_states.len() != setup.ntst {
            bail!("Homoclinic stage-state interval count mismatch");
        }

        let coeffs = CollocationCoefficients::new(setup.ncol)?;
        let mut problem = Self {
            system,
            setup,
            coeffs,
            phase_ref_mesh: Vec::new(),
            phase_ref_flow: Vec::new(),
            work_stage_f: Vec::new(),
        };
        problem.phase_ref_mesh = problem.setup.guess.mesh_states.clone();
        let phase_params = problem.current_params(
            problem.setup.guess.param1_value,
            problem.setup.guess.param2_value,
        )?;
        let phase_mesh = problem.phase_ref_mesh.clone();
        problem.phase_ref_flow = problem.flow_on_mesh(&phase_mesh, &phase_params)?;
        Ok(problem)
    }

    fn dim(&self) -> usize {
        self.system.equations.len()
    }

    fn orbit_unknown_count(&self) -> usize {
        let dim = self.dim();
        ((self.setup.ntst + 1) + self.setup.ntst * self.setup.ncol) * dim
    }

    fn riccati_size(&self) -> usize {
        self.setup.basis.nneg * self.setup.basis.npos
    }

    fn free_extra_count(&self) -> usize {
        self.setup.extras.free_count()
    }

    fn current_params(&self, p1: f64, p2: f64) -> Result<Vec<f64>> {
        let mut params = self.setup.base_params.clone();
        if self.setup.param1_index >= params.len() || self.setup.param2_index >= params.len() {
            bail!("Parameter index out of range in homoclinic setup");
        }
        params[self.setup.param1_index] = p1;
        params[self.setup.param2_index] = p2;
        Ok(params)
    }

    fn decode_state(&self, aug_state: &DVector<f64>) -> Result<DecodedState> {
        let decoded = decode_homoclinic_state(
            &aug_state.as_slice()[1..],
            self.dim(),
            self.setup.ntst,
            self.setup.ncol,
            self.setup.extras,
            self.setup.guess.time,
            self.setup.guess.eps0,
            self.setup.guess.eps1,
        )?;
        Ok(DecodedState {
            mesh_states: decoded.mesh_states,
            stage_states: decoded.stage_states,
            x0: decoded.x0,
            p2: decoded.param2_value,
            time: decoded.time,
            eps0: decoded.eps0,
            eps1: decoded.eps1,
            yu: decoded.yu,
            ys: decoded.ys,
            nneg: decoded.nneg,
            npos: decoded.npos,
        })
    }

    fn with_params<F, R>(&mut self, params: &[f64], mut f: F) -> Result<R>
    where
        F: FnMut(&mut EquationSystem) -> Result<R>,
    {
        if self.system.params.len() != params.len() {
            bail!("Parameter vector length mismatch");
        }
        let old = self.system.params.clone();
        self.system.params.copy_from_slice(params);
        let result = f(self.system);
        self.system.params = old;
        result
    }

    fn evaluate_stage_flow(
        &mut self,
        stage_states: &[Vec<Vec<f64>>],
        params: &[f64],
    ) -> Result<()> {
        let dim = self.dim();
        let stage_count = self.setup.ntst * self.setup.ncol;
        let expected = stage_count * dim;
        if self.work_stage_f.len() != expected {
            self.work_stage_f.resize(expected, 0.0);
        }
        let mut stage_f = vec![0.0; expected];
        self.with_params(params, |system| {
            let mut offset = 0usize;
            for interval in stage_states {
                for stage in interval {
                    system.apply(0.0, stage, &mut stage_f[offset..offset + dim]);
                    offset += dim;
                }
            }
            Ok(())
        })?;
        self.work_stage_f = stage_f;
        Ok(())
    }

    fn stage_flow_slice(&self, interval: usize, stage: usize) -> &[f64] {
        let dim = self.dim();
        let idx = interval * self.setup.ncol + stage;
        let start = idx * dim;
        &self.work_stage_f[start..start + dim]
    }

    fn flow_at_state(&mut self, state: &[f64], params: &[f64], out: &mut [f64]) -> Result<()> {
        self.with_params(params, |system| {
            system.apply(0.0, state, out);
            Ok(())
        })
    }

    fn flow_on_mesh(&mut self, mesh_states: &[Vec<f64>], params: &[f64]) -> Result<Vec<Vec<f64>>> {
        let dim = self.dim();
        let mut out = Vec::with_capacity(mesh_states.len());
        self.with_params(params, |system| {
            for state in mesh_states {
                let mut f = vec![0.0; dim];
                system.apply(0.0, state, &mut f);
                out.push(f);
            }
            Ok(())
        })?;
        Ok(out)
    }

    fn basis_matrix(flat: &[f64], dim: usize) -> Result<DMatrix<f64>> {
        if flat.len() != dim * dim {
            bail!("Basis matrix has invalid size");
        }
        Ok(DMatrix::from_column_slice(dim, dim, flat))
    }

    fn unpack_riccati(vec: &[f64], rows: usize, cols: usize) -> DMatrix<f64> {
        if rows == 0 || cols == 0 {
            return DMatrix::zeros(rows, cols);
        }
        DMatrix::from_row_slice(rows, cols, vec)
    }

    fn riccati_coeff(q0: &DMatrix<f64>, a: &DMatrix<f64>, nsub: usize) -> Result<RiccatiCoeff> {
        let th = q0.transpose() * a * q0;
        if nsub > th.nrows() {
            bail!("Invalid invariant-subspace dimension");
        }
        let t11 = th.view((0, 0), (nsub, nsub)).into_owned();
        let t12 = th.view((0, nsub), (nsub, th.ncols() - nsub)).into_owned();
        let e21 = th.view((nsub, 0), (th.nrows() - nsub, nsub)).into_owned();
        let t22 = th
            .view((nsub, nsub), (th.nrows() - nsub, th.ncols() - nsub))
            .into_owned();
        Ok(RiccatiCoeff { t11, t12, e21, t22 })
    }
}

impl<'a> ContinuationProblem for HomoclinicProblem<'a> {
    fn dimension(&self) -> usize {
        let dim = self.dim();
        self.orbit_unknown_count() + dim + 1 + self.free_extra_count() + 2 * self.riccati_size()
    }

    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()> {
        if out.len() != self.dimension() {
            bail!(
                "Homoclinic residual length mismatch: expected {}, got {}",
                self.dimension(),
                out.len()
            );
        }

        let dim = self.dim();
        let decoded = self.decode_state(aug_state)?;
        if decoded.nneg != self.setup.basis.nneg || decoded.npos != self.setup.basis.npos {
            bail!("Decoded Riccati dimensions do not match setup basis");
        }
        if decoded.time <= 0.0 {
            bail!("Homoclinic time must be positive");
        }

        let params = self.current_params(aug_state[0], decoded.p2)?;
        self.evaluate_stage_flow(&decoded.stage_states, &params)?;

        let mut row = 0usize;
        let h = 2.0 * decoded.time / self.setup.ntst as f64;

        // Collocation equations
        for interval in 0..self.setup.ntst {
            let base = &decoded.mesh_states[interval];
            for stage in 0..self.setup.ncol {
                let z = &decoded.stage_states[interval][stage];
                for r in 0..dim {
                    let mut sum = 0.0;
                    for k in 0..self.setup.ncol {
                        sum += self.coeffs.a[stage][k] * self.stage_flow_slice(interval, k)[r];
                    }
                    out[row] = z[r] - base[r] - h * sum;
                    row += 1;
                }
            }
        }

        // Continuity equations (open orbit, no wrap)
        for interval in 0..self.setup.ntst {
            let base = &decoded.mesh_states[interval];
            let next = &decoded.mesh_states[interval + 1];
            for r in 0..dim {
                let mut sum = 0.0;
                for k in 0..self.setup.ncol {
                    sum += self.coeffs.b[k] * self.stage_flow_slice(interval, k)[r];
                }
                out[row] = next[r] - base[r] - h * sum;
                row += 1;
            }
        }

        // Equilibrium constraint at x0
        let mut f_x0 = vec![0.0; dim];
        self.flow_at_state(&decoded.x0, &params, &mut f_x0)?;
        for value in f_x0 {
            out[row] = value;
            row += 1;
        }

        // Phase constraints: count = free_extra_count - 1
        let phase_constraints = self.free_extra_count().saturating_sub(1);
        if phase_constraints > 0 {
            let mut phase = 0.0;
            let count = decoded
                .mesh_states
                .len()
                .min(self.phase_ref_mesh.len())
                .min(self.phase_ref_flow.len());
            for i in 0..count {
                let current = &decoded.mesh_states[i];
                let reference = &self.phase_ref_mesh[i];
                let direction = &self.phase_ref_flow[i];
                for j in 0..dim {
                    phase += (current[j] - reference[j]) * direction[j];
                }
            }
            out[row] = phase / (count.max(1) as f64);
            row += 1;
            for _ in 1..phase_constraints {
                out[row] = 0.0;
                row += 1;
            }
        }

        // Riccati equations
        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let a = DMatrix::from_row_slice(dim, dim, &jac_data);
        let q0u = Self::basis_matrix(&self.setup.basis.unstable_q, dim)?;
        let q0s = Self::basis_matrix(&self.setup.basis.stable_q, dim)?;
        let yu = Self::unpack_riccati(&decoded.yu, self.setup.basis.nneg, self.setup.basis.npos);
        let ys = Self::unpack_riccati(&decoded.ys, self.setup.basis.npos, self.setup.basis.nneg);

        if self.setup.basis.nneg > 0 && self.setup.basis.npos > 0 {
            let coeff_u = Self::riccati_coeff(&q0u, &a, self.setup.basis.npos)?;
            let ru =
                &coeff_u.t22 * &yu - &yu * &coeff_u.t11 + &coeff_u.e21 - &yu * &coeff_u.t12 * &yu;
            for i in 0..ru.nrows() {
                for j in 0..ru.ncols() {
                    out[row] = ru[(i, j)];
                    row += 1;
                }
            }

            let coeff_s = Self::riccati_coeff(&q0s, &a, self.setup.basis.nneg)?;
            let rs =
                &coeff_s.t22 * &ys - &ys * &coeff_s.t11 + &coeff_s.e21 - &ys * &coeff_s.t12 * &ys;
            for i in 0..rs.nrows() {
                for j in 0..rs.ncols() {
                    out[row] = rs[(i, j)];
                    row += 1;
                }
            }
        }

        // Endpoint manifold constraints
        let start_delta = vector_sub(&decoded.mesh_states[0], &decoded.x0);
        let end_delta = vector_sub(
            decoded
                .mesh_states
                .last()
                .ok_or_else(|| anyhow!("Empty homoclinic mesh"))?,
            &decoded.x0,
        );

        let q1u = build_q1_unstable(&q0u, &yu)?;
        for i in 0..self.setup.basis.nneg {
            let col = self.setup.basis.nneg - 1 - i;
            out[row] = dot(&start_delta, q1u.column(col).as_slice());
            row += 1;
        }
        let q1s = build_q1_stable(&q0s, &ys)?;
        for i in 0..self.setup.basis.npos {
            let col = self.setup.basis.npos - 1 - i;
            out[row] = dot(&end_delta, q1s.column(col).as_slice());
            row += 1;
        }

        // Endpoint distances
        out[row] = l2_norm(&start_delta) - decoded.eps0;
        row += 1;
        out[row] = l2_norm(&end_delta) - decoded.eps1;
        row += 1;

        if row != out.len() {
            bail!(
                "Homoclinic residual assembly mismatch: filled {} entries, expected {}",
                row,
                out.len()
            );
        }

        Ok(())
    }

    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>> {
        let dim = self.dimension();
        let mut baseline = DVector::zeros(dim);
        self.residual(aug_state, &mut baseline)?;

        let mut jac = DMatrix::zeros(dim, dim + 1);
        let mut perturbed = aug_state.clone();

        for col in 0..=dim {
            let base = aug_state[col];
            let step = (1e-7f64).max(1e-7 * base.abs());
            perturbed[col] = base + step;
            let mut shifted = DVector::zeros(dim);
            self.residual(&perturbed, &mut shifted)?;
            for row in 0..dim {
                jac[(row, col)] = (shifted[row] - baseline[row]) / step;
            }
            perturbed[col] = base;
        }

        Ok(jac)
    }

    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics> {
        let decoded = self.decode_state(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.p2)?;
        let jac_data = self.with_params(&params, |system| {
            compute_jacobian(system, SystemKind::Flow, &decoded.x0)
        })?;
        let dim = self.dim();
        let jac = DMatrix::from_row_slice(dim, dim, &jac_data);
        let eigenvalues: Vec<Complex<f64>> = jac.complex_eigenvalues().iter().copied().collect();

        Ok(PointDiagnostics {
            test_values: TestFunctionValues::equilibrium(1.0, 1.0, 1.0),
            eigenvalues,
            cycle_points: Some(decoded.mesh_states),
        })
    }

    fn update_after_step(&mut self, aug_state: &DVector<f64>) -> Result<()> {
        let decoded = self.decode_state(aug_state)?;
        let params = self.current_params(aug_state[0], decoded.p2)?;
        self.phase_ref_flow = self.flow_on_mesh(&decoded.mesh_states, &params)?;
        self.phase_ref_mesh = decoded.mesh_states;
        self.setup.guess.time = decoded.time;
        self.setup.guess.eps0 = decoded.eps0;
        self.setup.guess.eps1 = decoded.eps1;
        self.setup.guess.param1_value = aug_state[0];
        self.setup.guess.param2_value = decoded.p2;
        self.setup.guess.x0 = decoded.x0;
        Ok(())
    }
}

#[derive(Debug)]
struct DecodedState {
    mesh_states: Vec<Vec<f64>>,
    stage_states: Vec<Vec<Vec<f64>>>,
    x0: Vec<f64>,
    p2: f64,
    time: f64,
    eps0: f64,
    eps1: f64,
    yu: Vec<f64>,
    ys: Vec<f64>,
    nneg: usize,
    npos: usize,
}

struct RiccatiCoeff {
    t11: DMatrix<f64>,
    t12: DMatrix<f64>,
    e21: DMatrix<f64>,
    t22: DMatrix<f64>,
}

fn build_q1_unstable(q0u: &DMatrix<f64>, yu: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    let nneg = yu.nrows();
    let npos = yu.ncols();
    if q0u.nrows() != nneg + npos || q0u.ncols() != nneg + npos {
        bail!("Unstable basis dimensions do not match Riccati state");
    }

    let mut block = DMatrix::zeros(nneg + npos, nneg);
    for r in 0..npos {
        for c in 0..nneg {
            block[(r, c)] = -yu[(c, r)];
        }
    }
    for i in 0..nneg {
        block[(npos + i, i)] = 1.0;
    }
    Ok(q0u * block)
}

fn build_q1_stable(q0s: &DMatrix<f64>, ys: &DMatrix<f64>) -> Result<DMatrix<f64>> {
    let npos = ys.nrows();
    let nneg = ys.ncols();
    if q0s.nrows() != nneg + npos || q0s.ncols() != nneg + npos {
        bail!("Stable basis dimensions do not match Riccati state");
    }

    let mut block = DMatrix::zeros(nneg + npos, npos);
    for r in 0..nneg {
        for c in 0..npos {
            block[(r, c)] = -ys[(c, r)];
        }
    }
    for i in 0..npos {
        block[(nneg + i, i)] = 1.0;
    }
    Ok(q0s * block)
}

fn vector_sub(lhs: &[f64], rhs: &[f64]) -> Vec<f64> {
    lhs.iter().zip(rhs.iter()).map(|(a, b)| a - b).collect()
}

fn dot(lhs: &[f64], rhs: &[f64]) -> f64 {
    lhs.iter().zip(rhs.iter()).map(|(a, b)| a * b).sum()
}

fn l2_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::continuation::homoclinic_init::{
        homoclinic_setup_from_large_cycle, HomoclinicExtraFlags,
    };
    use crate::equation_engine::{Bytecode, OpCode};

    fn linear_system() -> EquationSystem {
        let eq1 = Bytecode {
            ops: vec![OpCode::LoadParam(0), OpCode::LoadVar(0), OpCode::Mul],
        };
        let eq2 = Bytecode {
            ops: vec![
                OpCode::LoadConst(-1.0),
                OpCode::LoadVar(1),
                OpCode::Mul,
                OpCode::LoadParam(1),
                OpCode::Add,
            ],
        };
        let mut system = EquationSystem::new(vec![eq1, eq2], vec![0.2, 0.1]);
        system.param_map.insert("mu".to_string(), 0);
        system.param_map.insert("nu".to_string(), 1);
        system.var_map.insert("x".to_string(), 0);
        system.var_map.insert("y".to_string(), 1);
        system
    }

    fn synthetic_lc_state(dim: usize, ntst: usize, ncol: usize) -> Vec<f64> {
        let mut flat = Vec::new();
        for i in 0..ntst {
            let t = i as f64 / ntst as f64;
            flat.push((2.0 * std::f64::consts::PI * t).cos());
            flat.push((2.0 * std::f64::consts::PI * t).sin());
        }
        for i in 0..ntst {
            for j in 0..ncol {
                let t = (i as f64 + (j as f64 + 1.0) / (ncol as f64 + 1.0)) / ntst as f64;
                flat.push((2.0 * std::f64::consts::PI * t).cos());
                flat.push((2.0 * std::f64::consts::PI * t).sin());
            }
        }
        let period = 2.0 * std::f64::consts::PI;
        flat.push(period);
        assert_eq!(flat.len(), ntst * dim + ntst * ncol * dim + 1);
        flat
    }

    #[test]
    fn residual_dimension_matches_problem_dimension() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");

        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let dim = problem.dimension();
        let mut aug = DVector::zeros(dim + 1);
        aug[0] = setup.guess.param1_value;
        let packed = pack_homoclinic_state(&setup);
        for (i, value) in packed.iter().copied().enumerate() {
            aug[i + 1] = value;
        }
        let mut residual = DVector::zeros(dim);
        problem.residual(&aug, &mut residual).expect("residual");
        assert_eq!(residual.len(), dim);
        assert!(residual.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn phase_constraint_is_enabled_for_two_free_extras() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup_two = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup two");
        let setup_one = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: true,
                free_eps0: false,
                free_eps1: false,
            },
        )
        .expect("setup one");

        let dim_two = HomoclinicProblem::new(&mut system, setup_two)
            .expect("problem two")
            .dimension();
        let dim_one = HomoclinicProblem::new(&mut system, setup_one)
            .expect("problem one")
            .dimension();
        assert_eq!(dim_two, dim_one + 1);
    }

    #[test]
    fn jacobian_shape_matches_continuation_trait_contract() {
        let mut system = linear_system();
        let state = synthetic_lc_state(2, 6, 2);
        let setup = homoclinic_setup_from_large_cycle(
            &mut system,
            &state,
            6,
            2,
            5,
            2,
            &[0.2, 0.1],
            0,
            1,
            "mu",
            "nu",
            HomoclinicExtraFlags {
                free_time: false,
                free_eps0: true,
                free_eps1: true,
            },
        )
        .expect("setup");
        let packed = pack_homoclinic_state(&setup);
        let mut problem = HomoclinicProblem::new(&mut system, setup.clone()).expect("problem");
        let dim = problem.dimension();

        let mut aug = DVector::zeros(dim + 1);
        aug[0] = setup.guess.param1_value;
        for (i, value) in packed.iter().copied().enumerate() {
            aug[i + 1] = value;
        }

        let jac = problem.extended_jacobian(&aug).expect("jacobian");
        assert_eq!(jac.nrows(), dim);
        assert_eq!(jac.ncols(), dim + 1);
        assert!(jac.iter().all(|v| v.is_finite()));
    }
}
