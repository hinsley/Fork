use crate::traits::{DynamicalSystem, Scalar, Steppable};

/// Classic Runge-Kutta 4th Order Solver
pub struct RK4<T: Scalar> {
    k1: Vec<T>,
    k2: Vec<T>,
    k3: Vec<T>,
    k4: Vec<T>,
    tmp: Vec<T>,
}

impl<T: Scalar> RK4<T> {
    pub fn new(dim: usize) -> Self {
        Self {
            k1: vec![T::from_f64(0.0).unwrap(); dim],
            k2: vec![T::from_f64(0.0).unwrap(); dim],
            k3: vec![T::from_f64(0.0).unwrap(); dim],
            k4: vec![T::from_f64(0.0).unwrap(); dim],
            tmp: vec![T::from_f64(0.0).unwrap(); dim],
        }
    }
}

impl<T: Scalar> Steppable<T> for RK4<T> {
    fn step(&mut self, system: &impl DynamicalSystem<T>, t: &mut T, state: &mut [T], dt: T) {
        let half = T::from_f64(0.5).unwrap();
        let sixth = T::from_f64(1.0 / 6.0).unwrap();
        let two = T::from_f64(2.0).unwrap();

        let t0 = *t;

        // k1 = f(t, y)
        system.apply(t0, state, &mut self.k1);

        // k2 = f(t + dt/2, y + dt*k1/2)
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * self.k1[i] * half;
        }
        system.apply(t0 + dt * half, &self.tmp, &mut self.k2);

        // k3 = f(t + dt/2, y + dt*k2/2)
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * self.k2[i] * half;
        }
        system.apply(t0 + dt * half, &self.tmp, &mut self.k3);

        // k4 = f(t + dt, y + dt*k3)
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * self.k3[i];
        }
        system.apply(t0 + dt, &self.tmp, &mut self.k4);

        // y_next = y + dt/6 * (k1 + 2k2 + 2k3 + k4)
        for i in 0..state.len() {
            state[i] = state[i]
                + dt * sixth * (self.k1[i] + two * self.k2[i] + two * self.k3[i] + self.k4[i]);
        }

        *t = t0 + dt;
    }
}

/// Tsitouras 5/4 Solver
pub struct Tsit5<T: Scalar> {
    k1: Vec<T>,
    k2: Vec<T>,
    k3: Vec<T>,
    k4: Vec<T>,
    k5: Vec<T>,
    k6: Vec<T>,
    _k7: Vec<T>, // Used in adaptive step, not used in fixed step update directly
    tmp: Vec<T>,
}

impl<T: Scalar> Tsit5<T> {
    pub fn new(dim: usize) -> Self {
        let z = T::from_f64(0.0).unwrap();
        Self {
            k1: vec![z; dim],
            k2: vec![z; dim],
            k3: vec![z; dim],
            k4: vec![z; dim],
            k5: vec![z; dim],
            k6: vec![z; dim],
            _k7: vec![z; dim],
            tmp: vec![z; dim],
        }
    }
}

impl<T: Scalar> Steppable<T> for Tsit5<T> {
    fn step(&mut self, system: &impl DynamicalSystem<T>, t: &mut T, state: &mut [T], dt: T) {
        let t0 = *t;

        // Tsit5 Coefficients
        let c2 = T::from_f64(0.161).unwrap();
        let c3 = T::from_f64(0.327).unwrap();
        let c4 = T::from_f64(0.9).unwrap();
        let c5 = T::from_f64(0.9800255409045097).unwrap();
        let c6 = T::from_f64(1.0).unwrap();

        let a21 = T::from_f64(0.161).unwrap();

        let a31 = T::from_f64(-0.008480655492356989).unwrap();
        let a32 = T::from_f64(0.335480655492357).unwrap();

        let a41 = T::from_f64(2.898).unwrap();
        let a42 = T::from_f64(-6.359447987781783).unwrap();
        let a43 = T::from_f64(4.361447987781783).unwrap();

        let a51 = T::from_f64(5.325864858437957).unwrap();
        let a52 = T::from_f64(-11.748883564062828).unwrap();
        let a53 = T::from_f64(7.495539342889693).unwrap();
        let a54 = T::from_f64(-0.09249506636030195).unwrap();

        let a61 = T::from_f64(5.86145544294642).unwrap();
        let a62 = T::from_f64(-12.92096931784711).unwrap();
        let a63 = T::from_f64(8.159367898576159).unwrap();
        let a64 = T::from_f64(-0.071584973281401).unwrap();
        let a65 = T::from_f64(-0.02826857949054663).unwrap();

        let a71 = T::from_f64(0.09646076681806523).unwrap();
        let a72 = T::from_f64(0.01).unwrap();
        let a73 = T::from_f64(0.4798896504144996).unwrap();
        let a74 = T::from_f64(1.379008574103742).unwrap();
        let a75 = T::from_f64(-3.290069515436099).unwrap();
        let a76 = T::from_f64(2.324710524099774).unwrap();

        // b coefficients (5th order)
        let b1 = a71;
        let b2 = a72;
        let b3 = a73;
        let b4 = a74;
        let b5 = a75;
        let b6 = a76;

        // k1
        system.apply(t0, state, &mut self.k1);

        // k2
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * (a21 * self.k1[i]);
        }
        system.apply(t0 + c2 * dt, &self.tmp, &mut self.k2);

        // k3
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * (a31 * self.k1[i] + a32 * self.k2[i]);
        }
        system.apply(t0 + c3 * dt, &self.tmp, &mut self.k3);

        // k4
        for i in 0..state.len() {
            self.tmp[i] = state[i] + dt * (a41 * self.k1[i] + a42 * self.k2[i] + a43 * self.k3[i]);
        }
        system.apply(t0 + c4 * dt, &self.tmp, &mut self.k4);

        // k5
        for i in 0..state.len() {
            self.tmp[i] = state[i]
                + dt * (a51 * self.k1[i] + a52 * self.k2[i] + a53 * self.k3[i] + a54 * self.k4[i]);
        }
        system.apply(t0 + c5 * dt, &self.tmp, &mut self.k5);

        // k6
        for i in 0..state.len() {
            self.tmp[i] = state[i]
                + dt * (a61 * self.k1[i]
                    + a62 * self.k2[i]
                    + a63 * self.k3[i]
                    + a64 * self.k4[i]
                    + a65 * self.k5[i]);
        }
        system.apply(t0 + c6 * dt, &self.tmp, &mut self.k6);

        // Update State
        for i in 0..state.len() {
            state[i] = state[i]
                + dt * (b1 * self.k1[i]
                    + b2 * self.k2[i]
                    + b3 * self.k3[i]
                    + b4 * self.k4[i]
                    + b5 * self.k5[i]
                    + b6 * self.k6[i]);
        }

        *t = t0 + dt;
    }
}

/// Discrete Map Stepper
/// Just evaluates x_{n+1} = f(x_n).
/// dt is treated as 1 iteration regardless of value, but we track t as t + dt.
pub struct DiscreteMap<T: Scalar> {
    tmp: Vec<T>,
}

impl<T: Scalar> DiscreteMap<T> {
    pub fn new(dim: usize) -> Self {
        Self {
            tmp: vec![T::from_f64(0.0).unwrap(); dim],
        }
    }
}

impl<T: Scalar> Steppable<T> for DiscreteMap<T> {
    fn step(&mut self, system: &impl DynamicalSystem<T>, t: &mut T, state: &mut [T], dt: T) {
        // x_{n+1} = f(x_n)
        // The equation system's apply method computes f(x) into out.
        system.apply(*t, state, &mut self.tmp);

        // Update state
        for i in 0..state.len() {
            state[i] = self.tmp[i];
        }

        // Update time (iteration count usually)
        // For maps, dt usually = 1.
        *t = *t + dt;
    }
}

#[cfg(test)]
mod tests_accuracy {
    use super::{DiscreteMap, RK4, Tsit5};
    use crate::traits::{DynamicalSystem, Steppable};

    #[derive(Clone, Copy)]
    struct LinearFlow {
        rate: f64,
    }

    impl DynamicalSystem<f64> for LinearFlow {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = self.rate * x[0];
        }
    }

    #[derive(Clone, Copy)]
    struct DiagonalLinearFlow {
        rates: [f64; 2],
    }

    impl DynamicalSystem<f64> for DiagonalLinearFlow {
        fn dimension(&self) -> usize {
            2
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = self.rates[0] * x[0];
            out[1] = self.rates[1] * x[1];
        }
    }

    #[derive(Clone, Copy)]
    struct ConstantFlow {
        values: [f64; 2],
    }

    impl DynamicalSystem<f64> for ConstantFlow {
        fn dimension(&self) -> usize {
            2
        }

        fn apply(&self, _t: f64, _x: &[f64], out: &mut [f64]) {
            out[0] = self.values[0];
            out[1] = self.values[1];
        }
    }

    #[derive(Clone, Copy)]
    struct AffineMap {
        scale: f64,
        offset: f64,
    }

    impl DynamicalSystem<f64> for AffineMap {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = self.scale * x[0] + self.offset;
        }
    }

    #[test]
    fn rk4_step_matches_exponential() {
        let system = LinearFlow { rate: 1.0 };
        let mut solver = RK4::new(1);
        let mut t = 0.0;
        let mut state = vec![1.0];
        let dt = 0.1;
        solver.step(&system, &mut t, &mut state, dt);
        let expected = (system.rate * dt).exp();
        assert!((state[0] - expected).abs() < 1e-6);
        assert!((t - dt).abs() < 1e-12);
    }

    #[test]
    fn tsit5_step_matches_exponential() {
        let system = LinearFlow { rate: 1.0 };
        let mut solver = Tsit5::new(1);
        let mut t = 0.0;
        let mut state = vec![1.0];
        let dt = 0.1;
        solver.step(&system, &mut t, &mut state, dt);
        let expected = (system.rate * dt).exp();
        assert!((state[0] - expected).abs() < 1e-6);
        assert!((t - dt).abs() < 1e-12);
    }

    #[test]
    fn rk4_step_matches_two_dimensional_linear_flow() {
        let system = DiagonalLinearFlow {
            rates: [1.0, -2.0],
        };
        let mut solver = RK4::new(2);
        let mut t = 0.0;
        let mut state = vec![1.0, 2.0];
        let dt = 0.05;
        solver.step(&system, &mut t, &mut state, dt);
        let actual_x = state[0];
        let actual_y = state[1];
        let target_x = (system.rates[0] * dt).exp();
        let target_y = 2.0 * (system.rates[1] * dt).exp();
        assert!((actual_x - target_x).abs() < 1e-6);
        assert!((actual_y - target_y).abs() < 1e-6);
        assert!((t - dt).abs() < 1e-12);
    }

    #[test]
    fn tsit5_step_matches_constant_flow() {
        let system = ConstantFlow {
            values: [1.5, -0.5],
        };
        let mut solver = Tsit5::new(2);
        let mut t = 1.0;
        let mut state = vec![2.0, 4.0];
        let dt = 0.2;
        solver.step(&system, &mut t, &mut state, dt);
        assert!((state[0] - (2.0 + 1.5 * dt)).abs() < 1e-12);
        assert!((state[1] - (4.0 - 0.5 * dt)).abs() < 1e-12);
        assert!((t - 1.2).abs() < 1e-12);
    }

    #[test]
    fn discrete_map_updates_state_and_time() {
        let system = AffineMap {
            scale: 2.0,
            offset: 1.0,
        };
        let mut solver = DiscreteMap::new(1);
        let mut t: f64 = 2.0;
        let mut state = vec![3.0_f64];
        let dt: f64 = 0.25;
        solver.step(&system, &mut t, &mut state, dt);
        assert!((state[0] - 7.0).abs() < 1e-12);
        assert!((t - 2.25).abs() < 1e-12);
    }

    #[test]
    fn discrete_map_ignores_dt_for_state_update() {
        let system = AffineMap {
            scale: 1.0,
            offset: 1.0,
        };
        let mut solver = DiscreteMap::new(1);
        let mut t_small = 0.0;
        let mut state_small = vec![5.0];
        solver.step(&system, &mut t_small, &mut state_small, 0.1);

        let mut solver = DiscreteMap::new(1);
        let mut t_large = 0.0;
        let mut state_large = vec![5.0];
        solver.step(&system, &mut t_large, &mut state_large, 2.5);

        assert!((state_small[0] - 6.0).abs() < 1e-12);
        assert!((state_large[0] - 6.0).abs() < 1e-12);
        assert!((t_small - 0.1).abs() < 1e-12);
        assert!((t_large - 2.5).abs() < 1e-12);
    }
}
