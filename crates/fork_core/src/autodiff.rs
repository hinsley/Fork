use crate::traits::DynamicalSystem;
use num_traits::{Float, FromPrimitive, Num, NumCast, One, ToPrimitive, Zero};
use std::cell::RefCell;
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
        if n == 0 {
            return Self::new(val_pow, 0.0);
        }
        let derivative_power = if n == i32::MIN {
            // Avoid overflowing `n - 1`; x^n / x is equivalent for nonzero x
            // and retains the expected infinite behavior at the singularity.
            val_pow / self.val
        } else {
            self.val.powi(n - 1)
        };
        Self::new(val_pow, (n as f64) * derivative_power * self.eps)
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

struct TangentWorkspace {
    dual_state: Vec<Dual>,
    dual_out: Vec<Dual>,
}

pub struct TangentSystem<S> {
    pub inner: S,
    pub dimension: usize,
    workspace: RefCell<TangentWorkspace>,
}

impl<S> TangentSystem<S> {
    pub fn new(inner: S, dim: usize) -> Self {
        Self {
            inner,
            dimension: dim,
            workspace: RefCell::new(TangentWorkspace {
                dual_state: vec![Dual::zero(); dim],
                dual_out: vec![Dual::zero(); dim],
            }),
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
        let augmented_dimension = n + n * n;
        assert!(
            x.len() >= augmented_dimension,
            "tangent-system input dimension mismatch: expected at least {augmented_dimension}, got {}",
            x.len()
        );
        assert!(
            out.len() >= augmented_dimension,
            "tangent-system output dimension mismatch: expected at least {augmented_dimension}, got {}",
            out.len()
        );

        // Phi is row-major in x[n..]. A forward-mode pass seeded by one
        // column Phi[:, column] directly returns J(x) * Phi[:, column].
        // This avoids both materializing J and multiplying J * Phi.
        let mut workspace = self.workspace.borrow_mut();
        let TangentWorkspace {
            dual_state,
            dual_out,
        } = &mut *workspace;
        let t_dual = Dual::new(t, 0.0);

        for column in 0..n {
            for row in 0..n {
                dual_state[row] = Dual::new(x[row], x[n + row * n + column]);
            }

            self.inner.apply(t_dual, dual_state, dual_out);

            for row in 0..n {
                if column == 0 {
                    out[row] = dual_out[row].val;
                }
                out[n + row * n + column] = dual_out[row].eps;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Dual, TangentSystem};
    use crate::traits::DynamicalSystem;
    use num_traits::Float;
    use std::cell::Cell;
    use std::f64::consts::{LN_10, LN_2};

    #[derive(Default)]
    struct CountingScalarFlow {
        f64_calls: Cell<usize>,
        dual_calls: Cell<usize>,
    }

    impl DynamicalSystem<f64> for CountingScalarFlow {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, t: f64, x: &[f64], out: &mut [f64]) {
            self.f64_calls.set(self.f64_calls.get() + 1);
            out[0] = x[0] * x[0] * x[0] + 2.0 * t * x[0];
        }
    }

    impl DynamicalSystem<Dual> for CountingScalarFlow {
        fn dimension(&self) -> usize {
            1
        }

        fn apply(&self, t: Dual, x: &[Dual], out: &mut [Dual]) {
            self.dual_calls.set(self.dual_calls.get() + 1);
            out[0] = x[0] * x[0] * x[0] + Dual::new(2.0, 0.0) * t * x[0];
        }
    }

    struct ThreeDimensionalMap;

    impl DynamicalSystem<f64> for ThreeDimensionalMap {
        fn dimension(&self) -> usize {
            3
        }

        fn apply(&self, t: f64, x: &[f64], out: &mut [f64]) {
            out[0] = x[0] * x[1] + x[2].sin() + t;
            out[1] = x[1] * x[1] + x[0];
            out[2] = x[0].exp() - x[1] * x[2];
        }
    }

    impl DynamicalSystem<Dual> for ThreeDimensionalMap {
        fn dimension(&self) -> usize {
            3
        }

        fn apply(&self, t: Dual, x: &[Dual], out: &mut [Dual]) {
            out[0] = x[0] * x[1] + x[2].sin() + t;
            out[1] = x[1] * x[1] + x[0];
            out[2] = x[0].exp() - x[1] * x[2];
        }
    }

    fn explicit_jacobian_product(jacobian: &[f64], phi: &[f64], dim: usize) -> Vec<f64> {
        let mut product = vec![0.0; dim * dim];
        for row in 0..dim {
            for column in 0..dim {
                for inner in 0..dim {
                    product[row * dim + column] +=
                        jacobian[row * dim + inner] * phi[inner * dim + column];
                }
            }
        }
        product
    }

    fn assert_slice_close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        for (index, (&actual, &expected)) in actual.iter().zip(expected).enumerate() {
            assert!(
                (actual - expected).abs() < 1e-12,
                "mismatch at {index}: {actual} != {expected}"
            );
        }
    }

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
    fn dual_integer_power_handles_zero_and_minimum_exponents() {
        assert_eq!(Dual::new(0.0, 1.0).powi(0), Dual::new(1.0, 0.0));
        assert_eq!(
            Dual::new(1.0, 0.5).powi(i32::MIN),
            Dual::new(1.0, 0.5 * i32::MIN as f64)
        );
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

    #[test]
    fn tangent_flow_matches_explicit_scalar_jacobian_without_base_evaluation() {
        let system = TangentSystem::new(CountingScalarFlow::default(), 1);
        let time = 0.4;
        let state = [1.25, -0.75];
        let mut actual = [0.0; 2];

        system.apply(time, &state, &mut actual);

        let value = state[0].powi(3) + 2.0 * time * state[0];
        let jacobian = [3.0 * state[0] * state[0] + 2.0 * time];
        let tangent = explicit_jacobian_product(&jacobian, &state[1..], 1);
        assert_slice_close(&actual, &[value, tangent[0]]);
        assert_eq!(
            system.inner.f64_calls.get(),
            0,
            "the primal value should come from the first Dual pass"
        );
        assert_eq!(system.inner.dual_calls.get(), 1);
    }

    #[test]
    fn tangent_map_matches_explicit_three_dimensional_jacobian() {
        let system = TangentSystem::new(ThreeDimensionalMap, 3);
        let time = 0.2;
        let base = [0.7_f64, -1.1, 0.4];
        let phi = [0.5, -0.2, 1.0, 1.3, 0.7, -0.6, -0.4, 0.9, 0.8];
        let mut state = Vec::from(base);
        state.extend(phi);
        let mut actual = vec![0.0; system.dimension()];

        system.apply(time, &state, &mut actual);

        let values = [
            base[0] * base[1] + base[2].sin() + time,
            base[1] * base[1] + base[0],
            base[0].exp() - base[1] * base[2],
        ];
        let jacobian = [
            base[1],
            base[0],
            base[2].cos(),
            1.0,
            2.0 * base[1],
            0.0,
            base[0].exp(),
            -base[2],
            -base[1],
        ];
        let tangent = explicit_jacobian_product(&jacobian, &phi, 3);
        let mut expected = Vec::from(values);
        expected.extend(tangent);
        assert_slice_close(&actual, &expected);
    }
}
