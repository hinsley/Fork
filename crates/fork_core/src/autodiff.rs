use crate::traits::DynamicalSystem;
use num_traits::{Float, FromPrimitive, Num, NumCast, One, ToPrimitive, Zero};
use std::ops::{
    Add, AddAssign, Div, DivAssign, Mul, MulAssign, Neg, Rem, RemAssign, Sub, SubAssign,
};

/// Simple Dual Number for Forward Mode AD
/// val: real part
/// eps: infinitesimal part
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct Dual {
    pub val: f64,
    pub eps: f64,
}

impl Dual {
    pub fn new(val: f64, eps: f64) -> Self {
        Self { val, eps }
    }
}

// Implement generic traits for Dual to satisfy Scalar (Float)
// This is boilerplate heavy.

impl Zero for Dual {
    fn zero() -> Self {
        Self::new(0.0, 0.0)
    }
    fn is_zero(&self) -> bool {
        self.val == 0.0 && self.eps == 0.0
    }
}

impl One for Dual {
    fn one() -> Self {
        Self::new(1.0, 0.0)
    }
}

impl Add for Dual {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self::new(self.val + rhs.val, self.eps + rhs.eps)
    }
}

impl Sub for Dual {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self::new(self.val - rhs.val, self.eps - rhs.eps)
    }
}

impl Mul for Dual {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        Self::new(self.val * rhs.val, self.val * rhs.eps + self.eps * rhs.val)
    }
}

impl Div for Dual {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        let denom = rhs.val * rhs.val;
        Self::new(
            self.val / rhs.val,
            (self.eps * rhs.val - self.val * rhs.eps) / denom,
        )
    }
}

impl Neg for Dual {
    type Output = Self;
    fn neg(self) -> Self {
        Self::new(-self.val, -self.eps)
    }
}

impl Rem for Dual {
    type Output = Self;
    fn rem(self, rhs: Self) -> Self {
        // Derivative of rem is tricky, usually just rem of val.
        Self::new(self.val % rhs.val, 0.0)
    }
}

impl AddAssign for Dual {
    fn add_assign(&mut self, rhs: Self) {
        *self = *self + rhs;
    }
}
impl SubAssign for Dual {
    fn sub_assign(&mut self, rhs: Self) {
        *self = *self - rhs;
    }
}
impl MulAssign for Dual {
    fn mul_assign(&mut self, rhs: Self) {
        *self = *self * rhs;
    }
}
impl DivAssign for Dual {
    fn div_assign(&mut self, rhs: Self) {
        *self = *self / rhs;
    }
}
impl RemAssign for Dual {
    fn rem_assign(&mut self, rhs: Self) {
        *self = *self % rhs;
    }
}

impl Num for Dual {
    type FromStrRadixErr = ();
    fn from_str_radix(str: &str, radix: u32) -> Result<Self, Self::FromStrRadixErr> {
        f64::from_str_radix(str, radix)
            .map(|v| Self::new(v, 0.0))
            .map_err(|_| ())
    }
}

impl ToPrimitive for Dual {
    fn to_i64(&self) -> Option<i64> {
        self.val.to_i64()
    }
    fn to_u64(&self) -> Option<u64> {
        self.val.to_u64()
    }
    fn to_f64(&self) -> Option<f64> {
        Some(self.val)
    }
}

impl FromPrimitive for Dual {
    fn from_i64(n: i64) -> Option<Self> {
        Some(Self::new(n as f64, 0.0))
    }
    fn from_u64(n: u64) -> Option<Self> {
        Some(Self::new(n as f64, 0.0))
    }
    fn from_f64(n: f64) -> Option<Self> {
        Some(Self::new(n, 0.0))
    }
}

impl NumCast for Dual {
    fn from<T: ToPrimitive>(n: T) -> Option<Self> {
        n.to_f64().map(|v| Self::new(v, 0.0))
    }
}

impl Float for Dual {
    fn nan() -> Self {
        Self::new(f64::NAN, 0.0)
    }
    fn infinity() -> Self {
        Self::new(f64::INFINITY, 0.0)
    }
    fn neg_infinity() -> Self {
        Self::new(f64::NEG_INFINITY, 0.0)
    }
    fn neg_zero() -> Self {
        Self::new(-0.0, -0.0)
    }
    fn min_value() -> Self {
        Self::new(f64::MIN, 0.0)
    }
    fn min_positive_value() -> Self {
        Self::new(f64::MIN_POSITIVE, 0.0)
    }
    fn max_value() -> Self {
        Self::new(f64::MAX, 0.0)
    }
    fn is_nan(self) -> bool {
        self.val.is_nan()
    }
    fn is_infinite(self) -> bool {
        self.val.is_infinite()
    }
    fn is_finite(self) -> bool {
        self.val.is_finite()
    }
    fn is_normal(self) -> bool {
        self.val.is_normal()
    }
    fn classify(self) -> std::num::FpCategory {
        self.val.classify()
    }
    fn floor(self) -> Self {
        Self::new(self.val.floor(), 0.0)
    }
    fn ceil(self) -> Self {
        Self::new(self.val.ceil(), 0.0)
    }
    fn round(self) -> Self {
        Self::new(self.val.round(), 0.0)
    }
    fn trunc(self) -> Self {
        Self::new(self.val.trunc(), 0.0)
    }
    fn fract(self) -> Self {
        Self::new(self.val.fract(), self.eps)
    }
    fn abs(self) -> Self {
        Self::new(
            self.val.abs(),
            if self.val >= 0.0 { self.eps } else { -self.eps },
        )
    }
    fn signum(self) -> Self {
        Self::new(self.val.signum(), 0.0)
    }
    fn is_sign_positive(self) -> bool {
        self.val.is_sign_positive()
    }
    fn is_sign_negative(self) -> bool {
        self.val.is_sign_negative()
    }
    fn mul_add(self, a: Self, b: Self) -> Self {
        self * a + b
    }
    fn recip(self) -> Self {
        Self::one() / self
    }

    fn powi(self, n: i32) -> Self {
        let val_pow = self.val.powi(n);
        Self::new(val_pow, (n as f64) * self.val.powi(n - 1) * self.eps)
    }

    fn powf(self, n: Self) -> Self {
        // Special-case integer exponents (no ln needed, handles negative bases)
        if n.eps == 0.0 {
            let rounded = n.val.round();
            if (n.val - rounded).abs() < 1e-12 {
                return self.powi(rounded as i32);
            }
        }

        // General case
        let val_pow = self.val.powf(n.val);
        let eps_new = if self.val == 0.0 {
            0.0
        } else {
            val_pow * (n.eps * self.val.ln() + n.val * self.eps / self.val)
        };
        Self::new(val_pow, eps_new)
    }

    fn sqrt(self) -> Self {
        let s = self.val.sqrt();
        Self::new(s, self.eps / (2.0 * s))
    }

    fn exp(self) -> Self {
        let e = self.val.exp();
        Self::new(e, e * self.eps)
    }

    fn exp2(self) -> Self {
        let val = self.val.exp2();
        Self::new(val, self.eps * val * std::f64::consts::LN_2)
    }
    fn ln(self) -> Self {
        Self::new(self.val.ln(), self.eps / self.val)
    }
    fn log(self, base: Self) -> Self {
        self.ln() / base.ln()
    }
    fn log2(self) -> Self {
        Self::new(
            self.val.log2(),
            self.eps / (self.val * std::f64::consts::LN_2),
        )
    }
    fn log10(self) -> Self {
        Self::new(
            self.val.log10(),
            self.eps / (self.val * std::f64::consts::LN_10),
        )
    }

    fn max(self, other: Self) -> Self {
        if self.val > other.val {
            self
        } else {
            other
        }
    }
    fn min(self, other: Self) -> Self {
        if self.val < other.val {
            self
        } else {
            other
        }
    }

    fn abs_sub(self, _other: Self) -> Self {
        if self.val > _other.val {
            Self::new(self.val - _other.val, self.eps - _other.eps)
        } else {
            Self::zero()
        }
    }

    fn cbrt(self) -> Self {
        let val = self.val.cbrt();
        Self::new(val, self.eps / (3.0 * val * val))
    }
    fn hypot(self, _other: Self) -> Self {
        let val = self.val.hypot(_other.val);
        Self::new(val, (self.val * self.eps + _other.val * _other.eps) / val)
    }

    fn sin(self) -> Self {
        Self::new(self.val.sin(), self.eps * self.val.cos())
    }
    fn cos(self) -> Self {
        Self::new(self.val.cos(), -self.eps * self.val.sin())
    }
    fn tan(self) -> Self {
        let t = self.val.tan();
        Self::new(t, self.eps * (1.0 + t * t))
    }
    fn asin(self) -> Self {
        let denom = (1.0 - self.val * self.val).sqrt();
        Self::new(self.val.asin(), self.eps / denom)
    }
    fn acos(self) -> Self {
        let denom = (1.0 - self.val * self.val).sqrt();
        Self::new(self.val.acos(), -self.eps / denom)
    }
    fn atan(self) -> Self {
        Self::new(self.val.atan(), self.eps / (1.0 + self.val * self.val))
    }
    fn atan2(self, _other: Self) -> Self {
        let denom = self.val * self.val + _other.val * _other.val;
        Self::new(
            self.val.atan2(_other.val),
            (self.eps * _other.val - _other.eps * self.val) / denom,
        )
    }
    fn sin_cos(self) -> (Self, Self) {
        (self.sin(), self.cos())
    }

    fn exp_m1(self) -> Self {
        let exp = self.val.exp();
        Self::new(self.val.exp_m1(), self.eps * exp)
    }
    fn ln_1p(self) -> Self {
        Self::new(self.val.ln_1p(), self.eps / (1.0 + self.val))
    }
    fn sinh(self) -> Self {
        Self::new(self.val.sinh(), self.eps * self.val.cosh())
    }
    fn cosh(self) -> Self {
        Self::new(self.val.cosh(), self.eps * self.val.sinh())
    }
    fn tanh(self) -> Self {
        let val = self.val.tanh();
        Self::new(val, self.eps * (1.0 - val * val))
    }
    fn asinh(self) -> Self {
        let denom = (self.val * self.val + 1.0).sqrt();
        Self::new(self.val.asinh(), self.eps / denom)
    }
    fn acosh(self) -> Self {
        let denom = (self.val * self.val - 1.0).sqrt();
        Self::new(self.val.acosh(), self.eps / denom)
    }
    fn atanh(self) -> Self {
        Self::new(self.val.atanh(), self.eps / (1.0 - self.val * self.val))
    }

    fn integer_decode(self) -> (u64, i16, i8) {
        self.val.integer_decode()
    }
}

// --- Tangent System Wrapper ---

pub struct TangentSystem<S> {
    pub inner: S,
    pub dimension: usize,
}

impl<S> TangentSystem<S> {
    pub fn new(inner: S, dim: usize) -> Self {
        Self {
            inner,
            dimension: dim,
        }
    }
}

impl<S> DynamicalSystem<f64> for TangentSystem<S>
where
    S: DynamicalSystem<f64> + DynamicalSystem<Dual>,
{
    fn dimension(&self) -> usize {
        let n = self.dimension;
        n + n * n
    }

    fn apply(&self, t: f64, x: &[f64], out: &mut [f64]) {
        let n = self.dimension;

        // 1. Evaluate base flow/map f(x)
        // We can use the f64 implementation of inner for this to be fast,
        // or just use the Dual one with eps=0. Let's use f64 for speed.
        self.inner.apply(t, &x[0..n], &mut out[0..n]);

        // 2. Compute Jacobian J(x) via Dual numbers
        // We need to compute J * Phi.
        // Phi is stored in x[n..] as a flattened nxn matrix (row-major or col-major? Let's say Row-Major).
        // Phi = [ phi_00, phi_01 ... ]

        // To get J * Phi efficiently without building J explicitly:
        // J * v is the directional derivative in direction v.
        // Phi has n columns: c_0, c_1, ... c_{n-1}.
        // (J * Phi).col(k) = J * c_k.
        // So we can compute J * c_k by running Dual apply with input (x + eps * c_k).
        // BUT, c_k are vectors in tangent space. The input to apply is state space.

        // Wait, standard Tangent dynamics for flow:
        // \dot{\Phi} = J(x) \Phi
        // This means column k of \dot{\Phi} is J(x) * (column k of \Phi).
        // This requires J(x).
        // J(x) can be computed column by column.
        // Column j of J(x) is result of apply with x_j having epsilon=1, others 0.

        // Let's compute J explicitly first (size N*N).
        // This is acceptable for small N.
        let mut jacobian = vec![0.0; n * n];
        let mut dual_x = vec![Dual::new(0.0, 0.0); n];
        let mut dual_out = vec![Dual::new(0.0, 0.0); n];
        let t_dual = Dual::new(t, 0.0);

        for j in 0..n {
            // Prepare input: x with perturbation in j-th component
            for i in 0..n {
                dual_x[i] = Dual::new(x[i], if i == j { 1.0 } else { 0.0 });
            }

            // Evaluate
            self.inner.apply(t_dual, &dual_x, &mut dual_out);

            // Extract derivatives to column j of Jacobian
            for i in 0..n {
                jacobian[i * n + j] = dual_out[i].eps;
            }
        }

        // 3. Compute \dot{\Phi} = J * Phi
        // out[n..] = J * x[n..]
        let phi_start = n;
        for i in 0..n {
            for j in 0..n {
                let mut sum = 0.0;
                for k in 0..n {
                    // J[i, k] * Phi[k, j]
                    sum += jacobian[i * n + k] * x[phi_start + k * n + j];
                }
                out[phi_start + i * n + j] = sum;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Dual;
    use num_traits::Float;
    use std::f64::consts::{LN_10, LN_2};

    fn assert_close(actual: Dual, expected_val: f64, expected_eps: f64) {
        let tol = 1e-12;
        assert!(
            (actual.val - expected_val).abs() < tol,
            "val mismatch: {actual:?} expected val {expected_val}"
        );
        assert!(
            (actual.eps - expected_eps).abs() < tol,
            "eps mismatch: {actual:?} expected eps {expected_eps}"
        );
    }

    fn numeric_derivative<F>(f: F, x: f64) -> f64
    where
        F: Fn(f64) -> f64,
    {
        let h = 1e-6;
        (f(x + h) - f(x - h)) / (2.0 * h)
    }

    fn assert_eps_close(name: &str, actual: f64, expected: f64) {
        let tol = 1e-6;
        assert!(
            (actual - expected).abs() < tol,
            "{name} eps mismatch: {actual} expected {expected}"
        );
    }

    fn assert_numeric_derivative<F, G>(name: &str, x: f64, f: F, g: G)
    where
        F: Fn(f64) -> f64,
        G: Fn(Dual) -> Dual,
    {
        let expected = numeric_derivative(f, x);
        let actual = g(Dual::new(x, 1.0)).eps;
        assert_eps_close(name, actual, expected);
    }

    fn assert_numeric_partial<F, G>(name: &str, x: f64, y: f64, f: F, g: G)
    where
        F: Fn(f64, f64) -> f64,
        G: Fn(Dual, Dual) -> Dual,
    {
        let expected = numeric_derivative(|v| f(v, y), x);
        let actual = g(Dual::new(x, 1.0), Dual::new(y, 0.0)).eps;
        assert_eps_close(name, actual, expected);
    }

    #[test]
    fn dual_exp2() {
        let x = Dual::new(1.5, 0.25);
        let val = 1.5_f64.exp2();
        let expected_eps = 0.25 * val * LN_2;
        assert_close(x.exp2(), val, expected_eps);
    }

    #[test]
    fn dual_log2() {
        let x = Dual::new(3.0, 0.4);
        let val = 3.0_f64.log2();
        let expected_eps = 0.4 / (3.0 * LN_2);
        assert_close(x.log2(), val, expected_eps);
    }

    #[test]
    fn dual_log10() {
        let x = Dual::new(2.5, 0.4);
        let val = 2.5_f64.log10();
        let expected_eps = 0.4 / (2.5 * LN_10);
        assert_close(x.log10(), val, expected_eps);
    }

    #[test]
    fn dual_abs_sub() {
        let a = Dual::new(5.0, 1.2);
        let b = Dual::new(2.0, 0.4);
        assert_close(a.abs_sub(b), 3.0, 0.8);

        let c = Dual::new(1.0, 1.2);
        let d = Dual::new(2.0, 0.4);
        assert_close(c.abs_sub(d), 0.0, 0.0);
    }

    #[test]
    fn dual_cbrt() {
        let x = Dual::new(8.0, 0.5);
        let val = 8.0_f64.cbrt();
        let expected_eps = 0.5 / (3.0 * val * val);
        assert_close(x.cbrt(), val, expected_eps);
    }

    #[test]
    fn dual_hypot() {
        let x = Dual::new(3.0, 0.2);
        let y = Dual::new(4.0, 0.5);
        let val = 3.0_f64.hypot(4.0);
        let expected_eps = (3.0 * 0.2 + 4.0 * 0.5) / val;
        assert_close(x.hypot(y), val, expected_eps);
    }

    #[test]
    fn dual_asin() {
        let x = Dual::new(0.3, 0.4);
        let val = 0.3_f64.asin();
        let expected_eps = 0.4 / (1.0 - 0.3 * 0.3).sqrt();
        assert_close(x.asin(), val, expected_eps);
    }

    #[test]
    fn dual_acos() {
        let x = Dual::new(0.3, 0.4);
        let val = 0.3_f64.acos();
        let expected_eps = -0.4 / (1.0 - 0.3 * 0.3).sqrt();
        assert_close(x.acos(), val, expected_eps);
    }

    #[test]
    fn dual_atan() {
        let x = Dual::new(0.3, 0.4);
        let val = 0.3_f64.atan();
        let expected_eps = 0.4 / (1.0 + 0.3 * 0.3);
        assert_close(x.atan(), val, expected_eps);
    }

    #[test]
    fn dual_atan2() {
        let y = Dual::new(1.0, 0.2);
        let x = Dual::new(2.0, 0.1);
        let val = 1.0_f64.atan2(2.0);
        let expected_eps = (0.2 * 2.0 - 0.1 * 1.0) / (1.0 * 1.0 + 2.0 * 2.0);
        assert_close(y.atan2(x), val, expected_eps);
    }

    #[test]
    fn dual_exp_m1() {
        let x = Dual::new(0.4, 0.3);
        let val = 0.4_f64.exp_m1();
        let expected_eps = 0.3 * 0.4_f64.exp();
        assert_close(x.exp_m1(), val, expected_eps);
    }

    #[test]
    fn dual_ln_1p() {
        let x = Dual::new(0.4, 0.3);
        let val = 0.4_f64.ln_1p();
        let expected_eps = 0.3 / (1.0 + 0.4);
        assert_close(x.ln_1p(), val, expected_eps);
    }

    #[test]
    fn dual_sinh() {
        let x = Dual::new(0.5, 0.2);
        let val = 0.5_f64.sinh();
        let expected_eps = 0.2 * 0.5_f64.cosh();
        assert_close(x.sinh(), val, expected_eps);
    }

    #[test]
    fn dual_cosh() {
        let x = Dual::new(0.5, 0.2);
        let val = 0.5_f64.cosh();
        let expected_eps = 0.2 * 0.5_f64.sinh();
        assert_close(x.cosh(), val, expected_eps);
    }

    #[test]
    fn dual_tanh() {
        let x = Dual::new(0.5, 0.2);
        let val = 0.5_f64.tanh();
        let expected_eps = 0.2 * (1.0 - val * val);
        assert_close(x.tanh(), val, expected_eps);
    }

    #[test]
    fn dual_asinh() {
        let x = Dual::new(0.5, 0.2);
        let val = 0.5_f64.asinh();
        let expected_eps = 0.2 / (0.5 * 0.5 + 1.0).sqrt();
        assert_close(x.asinh(), val, expected_eps);
    }

    #[test]
    fn dual_acosh() {
        let x = Dual::new(2.0, 0.3);
        let val = 2.0_f64.acosh();
        let expected_eps = 0.3 / (2.0 * 2.0 - 1.0).sqrt();
        assert_close(x.acosh(), val, expected_eps);
    }

    #[test]
    fn dual_atanh() {
        let x = Dual::new(0.4, 0.2);
        let val = 0.4_f64.atanh();
        let expected_eps = 0.2 / (1.0 - 0.4 * 0.4);
        assert_close(x.atanh(), val, expected_eps);
    }

    #[test]
    fn dual_numeric_derivative_spot_checks() {
        assert_numeric_derivative("exp2", 1.5, |v| v.exp2(), |d| d.exp2());
        assert_numeric_derivative("log2", 3.0, |v| v.log2(), |d| d.log2());
        assert_numeric_derivative("log10", 2.5, |v| v.log10(), |d| d.log10());
        assert_numeric_derivative("cbrt", 8.0, |v| v.cbrt(), |d| d.cbrt());
        assert_numeric_derivative("asin", 0.3, |v| v.asin(), |d| d.asin());
        assert_numeric_derivative("acos", 0.3, |v| v.acos(), |d| d.acos());
        assert_numeric_derivative("atan", 0.3, |v| v.atan(), |d| d.atan());
        assert_numeric_derivative("exp_m1", 0.4, |v| v.exp_m1(), |d| d.exp_m1());
        assert_numeric_derivative("ln_1p", 0.4, |v| v.ln_1p(), |d| d.ln_1p());
        assert_numeric_derivative("sinh", 0.5, |v| v.sinh(), |d| d.sinh());
        assert_numeric_derivative("cosh", 0.5, |v| v.cosh(), |d| d.cosh());
        assert_numeric_derivative("tanh", 0.5, |v| v.tanh(), |d| d.tanh());
        assert_numeric_derivative("asinh", 0.5, |v| v.asinh(), |d| d.asinh());
        assert_numeric_derivative("acosh", 2.0, |v| v.acosh(), |d| d.acosh());
        assert_numeric_derivative("atanh", 0.4, |v| v.atanh(), |d| d.atanh());
        assert_numeric_partial("hypot", 3.0, 4.0, |a, b| a.hypot(b), |a, b| a.hypot(b));
        assert_numeric_partial("atan2", 1.0, 2.0, |a, b| a.atan2(b), |a, b| a.atan2(b));
        assert_numeric_partial(
            "abs_sub",
            5.0,
            2.0,
            |a, b| if a > b { a - b } else { 0.0 },
            |a, b| a.abs_sub(b),
        );
    }
}
