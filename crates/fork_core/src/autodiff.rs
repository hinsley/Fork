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
        // x^y = exp(y * ln(x))
        let val_pow = self.val.powf(n.val);
        let eps_new = val_pow * (n.eps * self.val.ln() + n.val * self.eps / self.val);
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
        unimplemented!()
    }
    fn ln(self) -> Self {
        Self::new(self.val.ln(), self.eps / self.val)
    }
    fn log(self, base: Self) -> Self {
        self.ln() / base.ln()
    }
    fn log2(self) -> Self {
        unimplemented!()
    }
    fn log10(self) -> Self {
        unimplemented!()
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
        unimplemented!()
    }

    fn cbrt(self) -> Self {
        unimplemented!()
    }
    fn hypot(self, _other: Self) -> Self {
        unimplemented!()
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
        unimplemented!()
    }
    fn acos(self) -> Self {
        unimplemented!()
    }
    fn atan(self) -> Self {
        unimplemented!()
    }
    fn atan2(self, _other: Self) -> Self {
        unimplemented!()
    }
    fn sin_cos(self) -> (Self, Self) {
        (self.sin(), self.cos())
    }

    fn exp_m1(self) -> Self {
        unimplemented!()
    }
    fn ln_1p(self) -> Self {
        unimplemented!()
    }
    fn sinh(self) -> Self {
        unimplemented!()
    }
    fn cosh(self) -> Self {
        unimplemented!()
    }
    fn tanh(self) -> Self {
        unimplemented!()
    }
    fn asinh(self) -> Self {
        unimplemented!()
    }
    fn acosh(self) -> Self {
        unimplemented!()
    }
    fn atanh(self) -> Self {
        unimplemented!()
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
