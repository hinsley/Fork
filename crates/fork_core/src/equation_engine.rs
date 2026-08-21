use crate::{
    autodiff::Dual,
    register_vm::RegisterProgram,
    traits::{DynamicalSystem, Scalar},
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpressionContext {
    None,
    FlowTime,
    MapIteration,
}

impl ExpressionContext {
    pub fn symbol(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::FlowTime => Some("t"),
            Self::MapIteration => Some("n"),
        }
    }
}

/// OpCodes for the Stack-based Virtual Machine.
/// The VM operates on a stack of `Scalar` values (f64 or Dual).
#[derive(Debug, Clone, Copy)]
pub enum OpCode {
    /// Pushes a constant `f64` value onto the stack.
    LoadConst(f64),
    /// Pushes the value of a state variable (by index) onto the stack.
    /// Indices correspond to the order variables were defined (e.g., 0=x, 1=y).
    LoadVar(usize),
    /// Pushes the value of a parameter (by index) onto the stack.
    LoadParam(usize),
    /// Pushes the current flow time or map iteration supplied by the caller.
    LoadContext,
    /// Pops top two values (b, a), pushes (a + b).
    Add,
    /// Pops top two values (b, a), pushes (a - b).
    Sub,
    /// Pops top two values (b, a), pushes (a * b).
    Mul,
    /// Pops top two values (b, a), pushes (a / b).
    Div,
    /// Pops top two values (b, a), pushes (a ^ b).
    Pow,
    /// Pops top value (a), pushes a * a.
    Square,
    /// Pops top value (a), pushes a * a * a.
    Cube,
    /// Pops top value (a), pushes a raised to a compile-time integer power.
    PowI(i32),
    /// Pops top value (a), pushes sin(a).
    Sin,
    /// Pops top value (a), pushes cos(a).
    Cos,
    /// Pops top value (a), pushes tan(a).
    Tan,
    /// Pops top value (a), pushes exp(a).
    Exp,
    /// Pops top value (a), pushes ln(a).
    Log,
    /// Pops top value (a), pushes sinh(a).
    Sinh,
    /// Pops top value (a), pushes cosh(a).
    Cosh,
    /// Pops top value (a), pushes tanh(a).
    Tanh,
    /// Pops top value (a), pushes sec(a).
    Sec,
    /// Pops top value (a), pushes csc(a).
    Csc,
    /// Pops top value (a), pushes cot(a).
    Cot,
    /// Pops top value (a), pushes sech(a).
    Sech,
    /// Pops top value (a), pushes csch(a).
    Csch,
    /// Pops top value (a), pushes coth(a).
    Coth,
    /// Pops top value (a), pushes asin(a).
    Asin,
    /// Pops top value (a), pushes acos(a).
    Acos,
    /// Pops top value (a), pushes atan(a).
    Atan,
    /// Pops top value (a), pushes asinh(a).
    Asinh,
    /// Pops top value (a), pushes acosh(a).
    Acosh,
    /// Pops top value (a), pushes atanh(a).
    Atanh,
    /// Pops top value (a), pushes sqrt(a).
    Sqrt,
    /// Pops top value (a), pushes cbrt(a).
    Cbrt,
    /// Pops top value (a), pushes 2^a.
    Exp2,
    /// Pops top value (a), pushes exp(a) - 1.
    ExpM1,
    /// Pops top value (a), pushes log2(a).
    Log2,
    /// Pops top value (a), pushes log10(a).
    Log10,
    /// Pops top value (a), pushes ln(1 + a).
    Log1P,
    /// Pops base and value, pushes log_base(value).
    LogBase,
    /// Pops x and y, pushes atan2(y, x).
    Atan2,
    /// Pops b and a, pushes hypot(a, b).
    Hypot,
    /// Pops b and a, pushes min(a, b).
    Min,
    /// Pops b and a, pushes max(a, b).
    Max,
    /// Pops top value (a), pushes abs(a).
    Abs,
    /// Pops top value (a), pushes floor(a).
    Floor,
    /// Pops top value (a), pushes ceil(a).
    Ceil,
    /// Pops top value (a), pushes round(a).
    Round,
    /// Pops top value (a), pushes trunc(a).
    Trunc,
    /// Pops top value (a), pushes fract(a).
    Fract,
    /// Pops top value (a), pushes signum(a).
    Sign,
    /// Pops top value (a), pushes erf(a).
    Erf,
    /// Pops top value (a), pushes erfc(a).
    Erfc,
    /// Pops top value (a), pushes sin(a) / a with sinc(0) = 1.
    Sinc,
    /// Pops top value (a), pushes the logistic sigmoid of a.
    Sigmoid,
    /// Pops top value (a), pushes log(1 + exp(a)) using a stable formulation.
    Softplus,
    /// Pops b and a, pushes log(exp(a) + exp(b)) using a stable formulation.
    LogAddExp,
    /// Pops upper, lower, and value, pushes value clamped to [lower, upper].
    Clamp,
    /// Pops top value (a), pushes 0, 0.5, or 1 according to the sign of a.
    Heaviside,
    /// Pops b and a, pushes 1 if a < b and 0 otherwise.
    Less,
    /// Pops b and a, pushes 1 if a <= b and 0 otherwise.
    LessEqual,
    /// Pops b and a, pushes 1 if a > b and 0 otherwise.
    Greater,
    /// Pops b and a, pushes 1 if a >= b and 0 otherwise.
    GreaterEqual,
    /// Pops b and a, pushes 1 if a == b and 0 otherwise.
    Equal,
    /// Pops b and a, pushes 1 if a != b and 0 otherwise.
    NotEqual,
    /// Pops false value, true value, and condition, then pushes the selected value.
    Select,
    /// Pops top value (a), pushes -a.
    Neg,
}

#[derive(Debug, Clone, Copy)]
pub enum ComparisonOp {
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Equal,
    NotEqual,
}

/// Scalar operations used by the expression VM in addition to `num_traits::Float`.
pub trait ExpressionScalar: Scalar {
    fn expr_erf(self) -> Self;
    fn expr_erfc(self) -> Self;
    fn expr_sinc(self) -> Self;
    fn expr_sigmoid(self) -> Self;
    fn expr_softplus(self) -> Self;
    fn expr_logaddexp(self, other: Self) -> Self;
    fn expr_clamp(self, lower: Self, upper: Self) -> Self;
    fn expr_heaviside(self) -> Self;
    fn expr_compare(self, other: Self, comparison: ComparisonOp) -> Self;
    fn expr_select(self, if_true: Self, if_false: Self) -> Self;
}

fn sinc_value_derivative(value: f64) -> (f64, f64) {
    if value.abs() < 1e-4 {
        let x2 = value * value;
        let result = 1.0 - x2 / 6.0 + x2 * x2 / 120.0 - x2 * x2 * x2 / 5040.0;
        let derivative = -value / 3.0 + value * x2 / 30.0 - value * x2 * x2 / 840.0;
        (result, derivative)
    } else {
        (
            value.sin() / value,
            (value * value.cos() - value.sin()) / (value * value),
        )
    }
}

fn sigmoid_value(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

fn softplus_value(value: f64) -> f64 {
    value.max(0.0) + (-value.abs()).exp().ln_1p()
}

fn logaddexp_value(left: f64, right: f64) -> f64 {
    if left == f64::INFINITY || right == f64::INFINITY {
        f64::INFINITY
    } else if left == f64::NEG_INFINITY {
        right
    } else if right == f64::NEG_INFINITY {
        left
    } else if left >= right {
        left + (right - left).exp().ln_1p()
    } else {
        right + (left - right).exp().ln_1p()
    }
}

fn logaddexp_weights(left: f64, right: f64) -> (f64, f64) {
    if left == right {
        (0.5, 0.5)
    } else if left == f64::INFINITY || right == f64::NEG_INFINITY {
        (1.0, 0.0)
    } else if right == f64::INFINITY || left == f64::NEG_INFINITY {
        (0.0, 1.0)
    } else {
        let left_weight = sigmoid_value(left - right);
        (left_weight, 1.0 - left_weight)
    }
}

fn compare_values(left: f64, right: f64, comparison: ComparisonOp) -> f64 {
    let result = match comparison {
        ComparisonOp::Less => left < right,
        ComparisonOp::LessEqual => left <= right,
        ComparisonOp::Greater => left > right,
        ComparisonOp::GreaterEqual => left >= right,
        ComparisonOp::Equal => left == right,
        ComparisonOp::NotEqual => left != right,
    };
    if result {
        1.0
    } else {
        0.0
    }
}

impl ExpressionScalar for f64 {
    fn expr_erf(self) -> Self {
        libm::erf(self)
    }

    fn expr_erfc(self) -> Self {
        libm::erfc(self)
    }

    fn expr_sinc(self) -> Self {
        sinc_value_derivative(self).0
    }

    fn expr_sigmoid(self) -> Self {
        sigmoid_value(self)
    }

    fn expr_softplus(self) -> Self {
        softplus_value(self)
    }

    fn expr_logaddexp(self, other: Self) -> Self {
        logaddexp_value(self, other)
    }

    fn expr_clamp(self, lower: Self, upper: Self) -> Self {
        if self.is_nan() || lower.is_nan() || upper.is_nan() || lower > upper {
            f64::NAN
        } else if self < lower {
            lower
        } else if self > upper {
            upper
        } else {
            self
        }
    }

    fn expr_heaviside(self) -> Self {
        if self.is_nan() {
            f64::NAN
        } else if self < 0.0 {
            0.0
        } else if self > 0.0 {
            1.0
        } else {
            0.5
        }
    }

    fn expr_compare(self, other: Self, comparison: ComparisonOp) -> Self {
        compare_values(self, other, comparison)
    }

    fn expr_select(self, if_true: Self, if_false: Self) -> Self {
        if self.is_nan() {
            f64::NAN
        } else if self != 0.0 {
            if_true
        } else {
            if_false
        }
    }
}

impl ExpressionScalar for Dual {
    fn expr_erf(self) -> Self {
        let derivative = 2.0 / std::f64::consts::PI.sqrt() * (-self.val * self.val).exp();
        Dual::new(libm::erf(self.val), self.eps * derivative)
    }

    fn expr_erfc(self) -> Self {
        let derivative = -2.0 / std::f64::consts::PI.sqrt() * (-self.val * self.val).exp();
        Dual::new(libm::erfc(self.val), self.eps * derivative)
    }

    fn expr_sinc(self) -> Self {
        let (value, derivative) = sinc_value_derivative(self.val);
        Dual::new(value, self.eps * derivative)
    }

    fn expr_sigmoid(self) -> Self {
        let value = sigmoid_value(self.val);
        Dual::new(value, self.eps * value * (1.0 - value))
    }

    fn expr_softplus(self) -> Self {
        Dual::new(softplus_value(self.val), self.eps * sigmoid_value(self.val))
    }

    fn expr_logaddexp(self, other: Self) -> Self {
        let (left_weight, right_weight) = logaddexp_weights(self.val, other.val);
        Dual::new(
            logaddexp_value(self.val, other.val),
            left_weight * self.eps + right_weight * other.eps,
        )
    }

    fn expr_clamp(self, lower: Self, upper: Self) -> Self {
        if self.val.is_nan() || lower.val.is_nan() || upper.val.is_nan() || lower.val > upper.val {
            Dual::new(f64::NAN, f64::NAN)
        } else if self.val < lower.val {
            lower
        } else if self.val > upper.val {
            upper
        } else {
            self
        }
    }

    fn expr_heaviside(self) -> Self {
        Dual::new(
            if self.val.is_nan() {
                f64::NAN
            } else if self.val < 0.0 {
                0.0
            } else if self.val > 0.0 {
                1.0
            } else {
                0.5
            },
            0.0,
        )
    }

    fn expr_compare(self, other: Self, comparison: ComparisonOp) -> Self {
        Dual::new(compare_values(self.val, other.val, comparison), 0.0)
    }

    fn expr_select(self, if_true: Self, if_false: Self) -> Self {
        if self.val.is_nan() {
            Dual::new(f64::NAN, f64::NAN)
        } else if self.val != 0.0 {
            if_true
        } else {
            if_false
        }
    }
}

/// Represents a compiled sequence of operations.
#[derive(Debug, Clone)]
pub struct Bytecode {
    pub ops: Vec<OpCode>,
}

impl Bytecode {
    pub fn new() -> Self {
        Self { ops: Vec::new() }
    }

    pub fn uses_context(&self) -> bool {
        self.ops.iter().any(|op| matches!(op, OpCode::LoadContext))
    }
}

/// Stack-based Virtual Machine for evaluating equations.
///
/// The VM is stateless; `execute` takes all necessary context:
/// - `bytecode`: Instructions to run.
/// - `vars`: Current state vector (read-only).
/// - `params`: Parameter vector (read-only).
/// - `stack`: A mutable buffer for intermediate computations.
///
/// Returns the result of the evaluation (the value left on the stack).
pub struct VM;

impl VM {
    /// Executes the bytecode.
    ///
    /// # Type Parameters
    /// * `T`: The scalar type (e.g., `f64` or `Dual`).
    pub fn execute<T: ExpressionScalar>(
        bytecode: &Bytecode,
        vars: &[T],
        params: &[T],
        stack: &mut Vec<T>,
    ) -> T {
        Self::execute_at(bytecode, vars, params, T::from_f64(0.0).unwrap(), stack)
    }

    pub fn execute_at<T: ExpressionScalar>(
        bytecode: &Bytecode,
        vars: &[T],
        params: &[T],
        context: T,
        stack: &mut Vec<T>,
    ) -> T {
        stack.clear();

        for op in &bytecode.ops {
            match op {
                OpCode::LoadConst(val) => {
                    stack.push(T::from_f64(*val).unwrap());
                }
                OpCode::LoadVar(idx) => {
                    stack.push(vars[*idx]);
                }
                OpCode::LoadParam(idx) => {
                    stack.push(params[*idx]);
                }
                OpCode::LoadContext => {
                    stack.push(context);
                }
                OpCode::Add => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a + b);
                }
                OpCode::Sub => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a - b);
                }
                OpCode::Mul => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a * b);
                }
                OpCode::Div => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a / b);
                }
                OpCode::Pow => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a.powf(b));
                }
                OpCode::Square => {
                    let a = stack.pop().unwrap();
                    stack.push(a * a);
                }
                OpCode::Cube => {
                    let a = stack.pop().unwrap();
                    stack.push(a * a * a);
                }
                OpCode::PowI(exponent) => {
                    let a = stack.pop().unwrap();
                    stack.push(a.powi(*exponent));
                }
                OpCode::Sin => {
                    let a = stack.pop().unwrap();
                    stack.push(a.sin());
                }
                OpCode::Cos => {
                    let a = stack.pop().unwrap();
                    stack.push(a.cos());
                }
                OpCode::Tan => {
                    let a = stack.pop().unwrap();
                    stack.push(a.tan());
                }
                OpCode::Exp => {
                    let a = stack.pop().unwrap();
                    stack.push(a.exp());
                }
                OpCode::Log => {
                    let a = stack.pop().unwrap();
                    stack.push(a.ln());
                }
                OpCode::Sinh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.sinh());
                }
                OpCode::Cosh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.cosh());
                }
                OpCode::Tanh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.tanh());
                }
                OpCode::Sec => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.cos());
                }
                OpCode::Csc => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.sin());
                }
                OpCode::Cot => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.tan());
                }
                OpCode::Sech => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.cosh());
                }
                OpCode::Csch => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.sinh());
                }
                OpCode::Coth => {
                    let a = stack.pop().unwrap();
                    stack.push(T::one() / a.tanh());
                }
                OpCode::Asin => {
                    let a = stack.pop().unwrap();
                    stack.push(a.asin());
                }
                OpCode::Acos => {
                    let a = stack.pop().unwrap();
                    stack.push(a.acos());
                }
                OpCode::Atan => {
                    let a = stack.pop().unwrap();
                    stack.push(a.atan());
                }
                OpCode::Asinh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.asinh());
                }
                OpCode::Acosh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.acosh());
                }
                OpCode::Atanh => {
                    let a = stack.pop().unwrap();
                    stack.push(a.atanh());
                }
                OpCode::Sqrt => {
                    let a = stack.pop().unwrap();
                    stack.push(a.sqrt());
                }
                OpCode::Cbrt => {
                    let a = stack.pop().unwrap();
                    stack.push(a.cbrt());
                }
                OpCode::Exp2 => {
                    let a = stack.pop().unwrap();
                    stack.push(a.exp2());
                }
                OpCode::ExpM1 => {
                    let a = stack.pop().unwrap();
                    stack.push(a.exp_m1());
                }
                OpCode::Log2 => {
                    let a = stack.pop().unwrap();
                    stack.push(a.log2());
                }
                OpCode::Log10 => {
                    let a = stack.pop().unwrap();
                    stack.push(a.log10());
                }
                OpCode::Log1P => {
                    let a = stack.pop().unwrap();
                    stack.push(a.ln_1p());
                }
                OpCode::LogBase => {
                    let base = stack.pop().unwrap();
                    let value = stack.pop().unwrap();
                    stack.push(value.log(base));
                }
                OpCode::Atan2 => {
                    let x = stack.pop().unwrap();
                    let y = stack.pop().unwrap();
                    stack.push(y.atan2(x));
                }
                OpCode::Hypot => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a.hypot(b));
                }
                OpCode::Min => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a.min(b));
                }
                OpCode::Max => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a.max(b));
                }
                OpCode::Abs => {
                    let a = stack.pop().unwrap();
                    stack.push(a.abs());
                }
                OpCode::Floor => {
                    let a = stack.pop().unwrap();
                    stack.push(a.floor());
                }
                OpCode::Ceil => {
                    let a = stack.pop().unwrap();
                    stack.push(a.ceil());
                }
                OpCode::Round => {
                    let a = stack.pop().unwrap();
                    stack.push(a.round());
                }
                OpCode::Trunc => {
                    let a = stack.pop().unwrap();
                    stack.push(a.trunc());
                }
                OpCode::Fract => {
                    let a = stack.pop().unwrap();
                    stack.push(a.fract());
                }
                OpCode::Sign => {
                    let a = stack.pop().unwrap();
                    stack.push(a.signum());
                }
                OpCode::Erf => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_erf());
                }
                OpCode::Erfc => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_erfc());
                }
                OpCode::Sinc => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_sinc());
                }
                OpCode::Sigmoid => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_sigmoid());
                }
                OpCode::Softplus => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_softplus());
                }
                OpCode::LogAddExp => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_logaddexp(b));
                }
                OpCode::Clamp => {
                    let upper = stack.pop().unwrap();
                    let lower = stack.pop().unwrap();
                    let value = stack.pop().unwrap();
                    stack.push(value.expr_clamp(lower, upper));
                }
                OpCode::Heaviside => {
                    let a = stack.pop().unwrap();
                    stack.push(a.expr_heaviside());
                }
                OpCode::Less
                | OpCode::LessEqual
                | OpCode::Greater
                | OpCode::GreaterEqual
                | OpCode::Equal
                | OpCode::NotEqual => {
                    let b = stack.pop().unwrap();
                    let a = stack.pop().unwrap();
                    let comparison = match op {
                        OpCode::Less => ComparisonOp::Less,
                        OpCode::LessEqual => ComparisonOp::LessEqual,
                        OpCode::Greater => ComparisonOp::Greater,
                        OpCode::GreaterEqual => ComparisonOp::GreaterEqual,
                        OpCode::Equal => ComparisonOp::Equal,
                        OpCode::NotEqual => ComparisonOp::NotEqual,
                        _ => unreachable!(),
                    };
                    stack.push(a.expr_compare(b, comparison));
                }
                OpCode::Select => {
                    let if_false = stack.pop().unwrap();
                    let if_true = stack.pop().unwrap();
                    let condition = stack.pop().unwrap();
                    stack.push(condition.expr_select(if_true, if_false));
                }
                OpCode::Neg => {
                    let a = stack.pop().unwrap();
                    stack.push(-a);
                }
            }
        }

        // The result is the last item on the stack. Default to 0.0 if empty (shouldn't happen in valid code).
        stack.pop().unwrap_or_else(|| T::from_f64(0.0).unwrap())
    }
}

// --- AST & Parser ---

/// Abstract Syntax Tree nodes for expressions.
#[derive(Debug)]
pub enum Expr {
    Number(f64),
    Variable(String),
    Binary(Box<Expr>, char, Box<Expr>), // char is operator +, -, *, /, ^
    Comparison(Box<Expr>, ComparisonOp, Box<Expr>),
    Unary(char, Box<Expr>),  // -, s (sin), c (cos), e (exp)
    Call(String, Vec<Expr>), // functions like sin(x) or atan2(y, x)
}

/// Function signatures suitable for user-facing expression-language help.
pub const SMOOTH_FUNCTION_SIGNATURES: &[&str] = &[
    "sin(x)",
    "cos(x)",
    "tan(x)",
    "sec(x)",
    "csc(x)",
    "cot(x)",
    "asin(x)",
    "acos(x)",
    "atan(x)",
    "atan2(y, x)",
    "sinh(x)",
    "cosh(x)",
    "tanh(x)",
    "sech(x)",
    "csch(x)",
    "coth(x)",
    "asinh(x)",
    "acosh(x)",
    "atanh(x)",
    "sqrt(x)",
    "cbrt(x)",
    "exp(x)",
    "exp2(x)",
    "expm1(x)",
    "ln(x)",
    "log(x)",
    "log(x, base)",
    "log2(x)",
    "log10(x)",
    "log1p(x)",
    "pow(x, y)",
    "hypot(x, y)",
    "erf(x)",
    "erfc(x)",
    "sinc(x)",
    "sigmoid(x)",
    "softplus(x)",
    "logaddexp(x, y)",
];

/// These functions have useful piecewise derivatives, but are not differentiable everywhere.
pub const PIECEWISE_FUNCTION_SIGNATURES: &[&str] = &[
    "abs(x)",
    "min(x, y, ...)",
    "max(x, y, ...)",
    "floor(x)",
    "ceil(x)",
    "round(x)",
    "trunc(x)",
    "fract(x)",
    "sign(x)",
    "clamp(x, min, max)",
    "heaviside(x)",
    "if(condition, then, else)",
];

/// Compiles an AST (`Expr`) into `Bytecode`.
/// Resolves variable and parameter names to indices.
pub struct Compiler {
    pub var_map: HashMap<String, usize>,
    pub param_map: HashMap<String, usize>,
    pub context: ExpressionContext,
}

impl Compiler {
    pub fn new(var_names: &[String], param_names: &[String]) -> Self {
        Self::new_with_context(var_names, param_names, ExpressionContext::None)
    }

    pub fn new_with_context(
        var_names: &[String],
        param_names: &[String],
        context: ExpressionContext,
    ) -> Self {
        let mut var_map = HashMap::new();
        for (i, name) in var_names.iter().enumerate() {
            var_map.insert(name.clone(), i);
        }

        let mut param_map = HashMap::new();
        for (i, name) in param_names.iter().enumerate() {
            param_map.insert(name.clone(), i);
        }

        Self {
            var_map,
            param_map,
            context,
        }
    }

    pub fn compile(&self, expr: &Expr) -> Bytecode {
        self.try_compile(expr)
            .unwrap_or_else(|error| panic!("{error}"))
    }

    /// Compile an expression without panicking on unknown symbols, functions, or arities.
    pub fn try_compile(&self, expr: &Expr) -> Result<Bytecode, String> {
        let mut ops = Vec::new();
        self.compile_recursive(expr, &mut ops)?;
        Ok(Bytecode { ops })
    }

    /// Compiles one expression and returns its value when the emitted subtree
    /// is a safely folded constant.
    fn compile_recursive(&self, expr: &Expr, ops: &mut Vec<OpCode>) -> Result<Option<f64>, String> {
        let start = ops.len();
        match expr {
            Expr::Number(n) => {
                ops.push(OpCode::LoadConst(*n));
                Ok(Some(*n))
            }
            Expr::Variable(name) => {
                if let Some(&idx) = self.var_map.get(name) {
                    ops.push(OpCode::LoadVar(idx));
                    Ok(None)
                } else if let Some(&idx) = self.param_map.get(name) {
                    ops.push(OpCode::LoadParam(idx));
                    Ok(None)
                } else if self.context.symbol() == Some(name.as_str()) {
                    ops.push(OpCode::LoadContext);
                    Ok(None)
                } else if let Some(value) = builtin_constant(name) {
                    ops.push(OpCode::LoadConst(value));
                    Ok(Some(value))
                } else if name == "t" || name == "n" {
                    let expected = self.context.symbol().unwrap_or("no contextual symbol");
                    Err(format!(
                        "Context symbol {name} is not available here; this expression context provides {expected}"
                    ))
                } else {
                    Err(format!("Unknown variable or parameter: {name}"))
                }
            }
            Expr::Binary(left, op, right) => {
                if *op == '^' {
                    return self.compile_power(left, right, start, ops);
                }

                let left_constant = self.compile_recursive(left, ops)?;
                let right_constant = self.compile_recursive(right, ops)?;
                ops.push(match op {
                    '+' => OpCode::Add,
                    '-' => OpCode::Sub,
                    '*' => OpCode::Mul,
                    '/' => OpCode::Div,
                    _ => return Err(format!("Unknown binary operator: {op}")),
                });
                Ok(self.fold_if_all_constant(
                    start,
                    left_constant.is_some() && right_constant.is_some(),
                    ops,
                ))
            }
            Expr::Comparison(left, comparison, right) => {
                let left_constant = self.compile_recursive(left, ops)?;
                let right_constant = self.compile_recursive(right, ops)?;
                ops.push(match comparison {
                    ComparisonOp::Less => OpCode::Less,
                    ComparisonOp::LessEqual => OpCode::LessEqual,
                    ComparisonOp::Greater => OpCode::Greater,
                    ComparisonOp::GreaterEqual => OpCode::GreaterEqual,
                    ComparisonOp::Equal => OpCode::Equal,
                    ComparisonOp::NotEqual => OpCode::NotEqual,
                });
                Ok(self.fold_if_all_constant(
                    start,
                    left_constant.is_some() && right_constant.is_some(),
                    ops,
                ))
            }
            Expr::Unary(op, operand) => {
                let constant = self.compile_recursive(operand, ops)?;
                match op {
                    '-' => ops.push(OpCode::Neg),
                    _ => return Err(format!("Unknown unary operator: {op}")),
                }
                Ok(self.fold_if_all_constant(start, constant.is_some(), ops))
            }
            Expr::Call(func, args) => {
                if matches!(func.as_str(), "min" | "max") {
                    if args.len() < 2 {
                        return Err(function_arity_error(
                            func,
                            "at least 2 arguments",
                            args.len(),
                        ));
                    }
                    let mut all_constant = self.compile_recursive(&args[0], ops)?.is_some();
                    for arg in &args[1..] {
                        all_constant &= self.compile_recursive(arg, ops)?.is_some();
                        ops.push(if func == "min" {
                            OpCode::Min
                        } else {
                            OpCode::Max
                        });
                    }
                    return Ok(self.fold_if_all_constant(start, all_constant, ops));
                }

                if func == "pow" && args.len() == 2 {
                    return self.compile_power(&args[0], &args[1], start, ops);
                }

                let mut all_constant = true;
                for arg in args {
                    all_constant &= self.compile_recursive(arg, ops)?.is_some();
                }
                ops.push(resolve_fixed_function(func, args.len())?);
                Ok(self.fold_if_all_constant(start, all_constant, ops))
            }
        }
    }

    fn compile_power(
        &self,
        base: &Expr,
        exponent: &Expr,
        start: usize,
        ops: &mut Vec<OpCode>,
    ) -> Result<Option<f64>, String> {
        let base_constant = self.compile_recursive(base, ops)?;
        let exponent_start = ops.len();
        let exponent_constant = self.compile_recursive(exponent, ops)?;

        if base_constant.is_some() && exponent_constant.is_some() {
            ops.push(OpCode::Pow);
            if let Some(value) = self.fold_if_all_constant(start, true, ops) {
                return Ok(Some(value));
            }
            ops.pop();
        }

        if let Some(exponent) = exponent_constant.and_then(integer_exponent) {
            ops.truncate(exponent_start);
            ops.push(specialized_power_opcode(exponent));
        } else {
            ops.push(OpCode::Pow);
        }
        Ok(None)
    }

    fn fold_if_all_constant(
        &self,
        start: usize,
        all_constant: bool,
        ops: &mut Vec<OpCode>,
    ) -> Option<f64> {
        if !all_constant {
            return None;
        }

        let bytecode = Bytecode {
            ops: ops[start..].to_vec(),
        };
        let mut f64_stack = Vec::with_capacity(bytecode.ops.len());
        let value: f64 = VM::execute(&bytecode, &[], &[], &mut f64_stack);
        let mut dual_stack = Vec::with_capacity(bytecode.ops.len());
        let dual = VM::execute(&bytecode, &[] as &[Dual], &[], &mut dual_stack);

        // Preserve the exact Dual result, including the sign of zero. Even
        // when a subtree cannot safely be replaced, return its known scalar
        // value so a surrounding integer power can still be specialized.
        if value.is_finite()
            && dual.eps.to_bits() == 0.0_f64.to_bits()
            && dual.val.to_bits() == value.to_bits()
        {
            ops.truncate(start);
            ops.push(OpCode::LoadConst(value));
        }
        Some(value)
    }
}

fn integer_exponent(value: f64) -> Option<i32> {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i32::MIN as f64
        && value <= i32::MAX as f64
    {
        Some(value as i32)
    } else {
        None
    }
}

fn specialized_power_opcode(exponent: i32) -> OpCode {
    match exponent {
        2 => OpCode::Square,
        3 => OpCode::Cube,
        exponent => OpCode::PowI(exponent),
    }
}

fn function_arity_error(name: &str, expected: &str, actual: usize) -> String {
    format!("Function '{name}' expects {expected}; got {actual}.")
}

pub fn builtin_constant(name: &str) -> Option<f64> {
    match name {
        "pi" => Some(std::f64::consts::PI),
        "tau" => Some(std::f64::consts::TAU),
        "e" => Some(std::f64::consts::E),
        _ => None,
    }
}

fn resolve_fixed_function(name: &str, arity: usize) -> Result<OpCode, String> {
    let unary = match name {
        "sin" => Some(OpCode::Sin),
        "cos" => Some(OpCode::Cos),
        "tan" => Some(OpCode::Tan),
        "exp" => Some(OpCode::Exp),
        "ln" => Some(OpCode::Log),
        "sinh" => Some(OpCode::Sinh),
        "cosh" => Some(OpCode::Cosh),
        "tanh" => Some(OpCode::Tanh),
        "sec" => Some(OpCode::Sec),
        "csc" => Some(OpCode::Csc),
        "cot" => Some(OpCode::Cot),
        "sech" => Some(OpCode::Sech),
        "csch" => Some(OpCode::Csch),
        "coth" => Some(OpCode::Coth),
        "asin" => Some(OpCode::Asin),
        "acos" => Some(OpCode::Acos),
        "atan" => Some(OpCode::Atan),
        "asinh" => Some(OpCode::Asinh),
        "acosh" => Some(OpCode::Acosh),
        "atanh" => Some(OpCode::Atanh),
        "sqrt" => Some(OpCode::Sqrt),
        "cbrt" => Some(OpCode::Cbrt),
        "exp2" => Some(OpCode::Exp2),
        "expm1" | "exp_m1" => Some(OpCode::ExpM1),
        "log2" => Some(OpCode::Log2),
        "log10" => Some(OpCode::Log10),
        "log1p" | "ln1p" | "ln_1p" => Some(OpCode::Log1P),
        "abs" => Some(OpCode::Abs),
        "floor" => Some(OpCode::Floor),
        "ceil" => Some(OpCode::Ceil),
        "round" => Some(OpCode::Round),
        "trunc" => Some(OpCode::Trunc),
        "fract" => Some(OpCode::Fract),
        "sign" | "signum" => Some(OpCode::Sign),
        "erf" => Some(OpCode::Erf),
        "erfc" => Some(OpCode::Erfc),
        "sinc" => Some(OpCode::Sinc),
        "sigmoid" => Some(OpCode::Sigmoid),
        "softplus" => Some(OpCode::Softplus),
        "heaviside" => Some(OpCode::Heaviside),
        _ => None,
    };
    if let Some(opcode) = unary {
        return if arity == 1 {
            Ok(opcode)
        } else {
            Err(function_arity_error(name, "1 argument", arity))
        };
    }

    match name {
        "log" => match arity {
            1 => Ok(OpCode::Log),
            2 => Ok(OpCode::LogBase),
            _ => Err(function_arity_error(name, "1 or 2 arguments", arity)),
        },
        "atan2" => fixed_binary_function(name, arity, OpCode::Atan2),
        "hypot" => fixed_binary_function(name, arity, OpCode::Hypot),
        "pow" => fixed_binary_function(name, arity, OpCode::Pow),
        "logaddexp" => fixed_binary_function(name, arity, OpCode::LogAddExp),
        "clamp" => fixed_ternary_function(name, arity, OpCode::Clamp),
        "if" => fixed_ternary_function(name, arity, OpCode::Select),
        _ => Err(format!("Unknown function: {name}")),
    }
}

fn fixed_ternary_function(name: &str, arity: usize, opcode: OpCode) -> Result<OpCode, String> {
    if arity == 3 {
        Ok(opcode)
    } else {
        Err(function_arity_error(name, "3 arguments", arity))
    }
}

fn fixed_binary_function(name: &str, arity: usize, opcode: OpCode) -> Result<OpCode, String> {
    if arity == 2 {
        Ok(opcode)
    } else {
        Err(function_arity_error(name, "2 arguments", arity))
    }
}

// --- Simple Parser ---

/// Parses a string expression into an AST.
pub fn parse(input: &str) -> Result<Expr, String> {
    let tokens = tokenize(input)?;
    let mut parser = Parser { tokens, pos: 0 };
    let expression = parser.parse_expression()?;
    if parser.pos != parser.tokens.len() {
        return Err(format!(
            "Unexpected trailing token {:?}",
            parser.tokens[parser.pos]
        ));
    }
    Ok(expression)
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Identifier(String),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    EqualEqual,
    NotEqual,
    Comma,
    LParen,
    RParen,
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '`' {
            chars.next();
            let mut ident = String::new();
            let mut terminated = false;
            for d in chars.by_ref() {
                if d == '`' {
                    terminated = true;
                    break;
                }
                ident.push(d);
            }
            if !terminated {
                return Err("Unterminated quoted identifier".to_string());
            }
            if ident.trim().is_empty() {
                return Err("Quoted identifier cannot be empty".to_string());
            }
            tokens.push(Token::Identifier(ident));
        } else if c.is_ascii_digit() || c == '.' {
            let mut num_str = String::new();
            let mut has_digit = false;

            while let Some(&d) = chars.peek() {
                if d.is_ascii_digit() {
                    num_str.push(d);
                    chars.next();
                    has_digit = true;
                } else {
                    break;
                }
            }
            if chars.peek() == Some(&'.') {
                num_str.push('.');
                chars.next();
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() {
                        num_str.push(d);
                        chars.next();
                        has_digit = true;
                    } else {
                        break;
                    }
                }
            }
            if !has_digit {
                return Err(format!("Invalid number '{num_str}'"));
            }
            if matches!(chars.peek(), Some('e' | 'E')) {
                num_str.push(chars.next().unwrap());
                if matches!(chars.peek(), Some('+' | '-')) {
                    num_str.push(chars.next().unwrap());
                }
                let mut exponent_digits = 0;
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() {
                        num_str.push(d);
                        chars.next();
                        exponent_digits += 1;
                    } else {
                        break;
                    }
                }
                if exponent_digits == 0 {
                    return Err(format!("Invalid number '{num_str}'"));
                }
            }
            let value = num_str
                .parse::<f64>()
                .map_err(|_| format!("Invalid number '{}'", num_str))?;
            tokens.push(Token::Number(value));
        } else if c.is_alphabetic() || c == '_' {
            let mut ident = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_alphanumeric() || d == '_' {
                    ident.push(d);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Identifier(ident));
        } else {
            match c {
                '+' => tokens.push(Token::Plus),
                '-' => tokens.push(Token::Minus),
                '*' => tokens.push(Token::Star),
                '/' => tokens.push(Token::Slash),
                '^' => tokens.push(Token::Caret),
                '<' => {
                    chars.next();
                    if chars.peek() == Some(&'=') {
                        chars.next();
                        tokens.push(Token::LessEqual);
                    } else {
                        tokens.push(Token::Less);
                    }
                    continue;
                }
                '>' => {
                    chars.next();
                    if chars.peek() == Some(&'=') {
                        chars.next();
                        tokens.push(Token::GreaterEqual);
                    } else {
                        tokens.push(Token::Greater);
                    }
                    continue;
                }
                '=' => {
                    chars.next();
                    if chars.peek() == Some(&'=') {
                        chars.next();
                        tokens.push(Token::EqualEqual);
                        continue;
                    }
                    return Err("Expected '=='".to_string());
                }
                '!' => {
                    chars.next();
                    if chars.peek() == Some(&'=') {
                        chars.next();
                        tokens.push(Token::NotEqual);
                        continue;
                    }
                    return Err("Expected '!='".to_string());
                }
                ',' => tokens.push(Token::Comma),
                '(' => tokens.push(Token::LParen),
                ')' => tokens.push(Token::RParen),
                _ => return Err(format!("Invalid token '{}'", c)),
            }
            chars.next();
        }
    }
    Ok(tokens)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<Token> {
        self.tokens.get(self.pos).cloned()
    }

    fn consume(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let t = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(t)
        } else {
            None
        }
    }

    fn parse_expression(&mut self) -> Result<Expr, String> {
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<Expr, String> {
        let left = self.parse_term()?;
        let comparison = match self.peek() {
            Some(Token::Less) => ComparisonOp::Less,
            Some(Token::LessEqual) => ComparisonOp::LessEqual,
            Some(Token::Greater) => ComparisonOp::Greater,
            Some(Token::GreaterEqual) => ComparisonOp::GreaterEqual,
            Some(Token::EqualEqual) => ComparisonOp::Equal,
            Some(Token::NotEqual) => ComparisonOp::NotEqual,
            _ => return Ok(left),
        };
        self.consume();
        let right = self.parse_term()?;
        if matches!(
            self.peek(),
            Some(
                Token::Less
                    | Token::LessEqual
                    | Token::Greater
                    | Token::GreaterEqual
                    | Token::EqualEqual
                    | Token::NotEqual
            )
        ) {
            return Err(
                "Chained comparisons are not supported; combine explicit comparisons in if()."
                    .to_string(),
            );
        }
        Ok(Expr::Comparison(
            Box::new(left),
            comparison,
            Box::new(right),
        ))
    }

    fn parse_term(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_factor()?;

        while let Some(token) = self.peek() {
            match token {
                Token::Plus => {
                    self.consume();
                    let right = self.parse_factor()?;
                    left = Expr::Binary(Box::new(left), '+', Box::new(right));
                }
                Token::Minus => {
                    self.consume();
                    let right = self.parse_factor()?;
                    left = Expr::Binary(Box::new(left), '-', Box::new(right));
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_factor(&mut self) -> Result<Expr, String> {
        let left = self.parse_factor_op()?;
        Ok(left)
    }

    fn parse_factor_op(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_power()?;

        while let Some(token) = self.peek() {
            match token {
                Token::Star => {
                    self.consume();
                    let right = self.parse_power()?;
                    left = Expr::Binary(Box::new(left), '*', Box::new(right));
                }
                Token::Slash => {
                    self.consume();
                    let right = self.parse_power()?;
                    left = Expr::Binary(Box::new(left), '/', Box::new(right));
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_power(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_unary()?;

        while let Some(token) = self.peek() {
            match token {
                Token::Caret => {
                    self.consume();
                    let right = self.parse_unary()?;
                    left = Expr::Binary(Box::new(left), '^', Box::new(right));
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr, String> {
        if let Some(token) = self.peek() {
            if let Token::Minus = token {
                self.consume();
                let expr = self.parse_unary()?;
                return Ok(Expr::Unary('-', Box::new(expr)));
            }
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, String> {
        match self.consume() {
            Some(Token::Number(n)) => Ok(Expr::Number(n)),
            Some(Token::Identifier(name)) => {
                if let Some(Token::LParen) = self.peek() {
                    self.consume(); // eat '('
                    let mut args = Vec::new();
                    if let Some(Token::RParen) = self.peek() {
                        self.consume();
                        return Ok(Expr::Call(name, args));
                    }

                    loop {
                        args.push(self.parse_expression()?);
                        match self.consume() {
                            Some(Token::Comma) => continue,
                            Some(Token::RParen) => break,
                            _ => return Err("Expected ',' or ')'".to_string()),
                        }
                    }
                    Ok(Expr::Call(name, args))
                } else {
                    Ok(Expr::Variable(name))
                }
            }
            Some(Token::LParen) => {
                let expr = self.parse_expression()?;
                if let Some(Token::RParen) = self.consume() {
                    Ok(expr)
                } else {
                    Err("Expected ')'".to_string())
                }
            }
            _ => Err("Unexpected token".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, Bytecode, Compiler, Dual, EquationSystem, ExpressionContext, OpCode, VM};
    use crate::traits::DynamicalSystem;

    fn eval_with_x_and_p(expr: &str, x: f64, p: f64) -> f64 {
        let var_names = vec!["x".to_string()];
        let param_names = vec!["p".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let parsed = parse(expr).expect("expression should parse");
        let bytecode = compiler.compile(&parsed);

        let system = EquationSystem::new(vec![bytecode], vec![p]);
        let mut out = vec![0.0];
        system.apply(0.0, &[x], &mut out);
        out[0]
    }

    fn assert_close(actual: f64, expected: f64) {
        let tol = 1e-12;
        assert!(
            (actual - expected).abs() < tol,
            "expected {expected}, got {actual}"
        );
    }

    fn assert_eps_close(actual: f64, expected: f64) {
        let tol = 1e-6;
        assert!(
            (actual - expected).abs() < tol,
            "expected derivative {expected}, got {actual}"
        );
    }

    fn eval_dual_wrt_p(expr: &str, x: f64, p: f64) -> Dual {
        let var_names = vec!["x".to_string()];
        let param_names = vec!["p".to_string()];
        let compiler = Compiler::new(&var_names, &param_names);
        let parsed = parse(expr).expect("expression should parse");
        let bytecode = compiler.compile(&parsed);

        let system = EquationSystem::new(vec![bytecode], vec![p]);
        let mut out = vec![Dual::new(0.0, 0.0)];
        system.evaluate_dual_wrt_param(&[x], 0, &mut out);
        out[0]
    }

    fn numeric_derivative_wrt_p(expr: &str, x: f64, p: f64) -> f64 {
        let h = 1e-6;
        (eval_with_x_and_p(expr, x, p + h) - eval_with_x_and_p(expr, x, p - h)) / (2.0 * h)
    }

    fn compile_single_variable_expression(expression: &str) -> Bytecode {
        let compiler = Compiler::new(&["x".to_string()], &[]);
        compiler.compile(&parse(expression).expect("expression should parse"))
    }

    fn execute_f64(bytecode: &Bytecode, x: f64) -> f64 {
        VM::execute(bytecode, &[x], &[], &mut Vec::new())
    }

    fn execute_dual(bytecode: &Bytecode, x: Dual) -> Dual {
        VM::execute(bytecode, &[x], &[], &mut Vec::new())
    }

    #[test]
    fn compiler_recursively_folds_only_constant_subtrees() {
        let constant = compile_single_variable_expression("2 + 3 * 4");
        assert!(
            matches!(constant.ops.as_slice(), [OpCode::LoadConst(value)] if *value == 14.0),
            "unexpected constant bytecode: {:?}",
            constant.ops
        );

        let mixed = compile_single_variable_expression("x + (2 * 3 + sin(0))");
        assert!(
            matches!(
                mixed.ops.as_slice(),
                [
                    OpCode::LoadVar(0),
                    OpCode::LoadConst(value),
                    OpCode::Add
                ] if *value == 6.0
            ),
            "unexpected mixed bytecode: {:?}",
            mixed.ops
        );

        let ieee_sensitive = compile_single_variable_expression("x + 0");
        assert!(
            matches!(
                ieee_sensitive.ops.as_slice(),
                [OpCode::LoadVar(0), OpCode::LoadConst(value), OpCode::Add]
                    if value.to_bits() == 0.0_f64.to_bits()
            ),
            "x + 0 must not be algebraically simplified: {:?}",
            ieee_sensitive.ops
        );

        let signed_zero_dual = compile_single_variable_expression("-2");
        assert!(
            matches!(
                signed_zero_dual.ops.as_slice(),
                [OpCode::LoadConst(value), OpCode::Neg] if *value == 2.0
            ),
            "folding must preserve a constant subtree's signed Dual zero: {:?}",
            signed_zero_dual.ops
        );

        let non_finite = compile_single_variable_expression("1 / 0");
        assert!(
            matches!(
                non_finite.ops.as_slice(),
                [
                    OpCode::LoadConst(one),
                    OpCode::LoadConst(zero),
                    OpCode::Div
                ] if *one == 1.0 && *zero == 0.0
            ),
            "non-finite constant results should remain runtime operations: {:?}",
            non_finite.ops
        );
    }

    #[test]
    fn compiler_lowers_compile_time_integer_powers() {
        for (expression, expected) in [
            ("x^2", OpCode::Square),
            ("x^3", OpCode::Cube),
            ("x^-4", OpCode::PowI(-4)),
            ("x^(1 + 1)", OpCode::Square),
            ("pow(x, 5)", OpCode::PowI(5)),
            ("pow(x, 3)", OpCode::Cube),
        ] {
            let bytecode = compile_single_variable_expression(expression);
            assert_eq!(
                bytecode.ops.len(),
                2,
                "unexpected bytecode for {expression}: {:?}",
                bytecode.ops
            );
            assert!(matches!(bytecode.ops[0], OpCode::LoadVar(0)));
            let matches_expected = match (bytecode.ops[1], expected) {
                (OpCode::Square, OpCode::Square) | (OpCode::Cube, OpCode::Cube) => true,
                (OpCode::PowI(actual), OpCode::PowI(expected)) => actual == expected,
                _ => false,
            };
            assert!(
                matches_expected,
                "unexpected power opcode for {expression}: {:?}",
                bytecode.ops[1]
            );
        }

        let non_integer = compile_single_variable_expression("x^2.5");
        assert!(matches!(
            non_integer.ops.as_slice(),
            [
                OpCode::LoadVar(0),
                OpCode::LoadConst(exponent),
                OpCode::Pow
            ] if *exponent == 2.5
        ));
    }

    #[test]
    fn folded_and_specialized_bytecode_preserves_f64_and_dual_results() {
        let optimized =
            compile_single_variable_expression("x^2 + x^3 + x^-4 + pow(x, 5) + (2 * 3)");
        let reference = Bytecode {
            ops: vec![
                OpCode::LoadVar(0),
                OpCode::LoadConst(2.0),
                OpCode::Pow,
                OpCode::LoadVar(0),
                OpCode::LoadConst(3.0),
                OpCode::Pow,
                OpCode::Add,
                OpCode::LoadVar(0),
                OpCode::LoadConst(4.0),
                OpCode::Neg,
                OpCode::Pow,
                OpCode::Add,
                OpCode::LoadVar(0),
                OpCode::LoadConst(5.0),
                OpCode::Pow,
                OpCode::Add,
                OpCode::LoadConst(2.0),
                OpCode::LoadConst(3.0),
                OpCode::Mul,
                OpCode::Add,
            ],
        };

        for x in [0.7, 1.3, 2.1] {
            assert_close(execute_f64(&optimized, x), execute_f64(&reference, x));
            let actual = execute_dual(&optimized, Dual::new(x, 0.75));
            let expected = execute_dual(&reference, Dual::new(x, 0.75));
            assert_close(actual.val, expected.val);
            assert_close(actual.eps, expected.eps);
        }
    }

    #[test]
    fn contextual_symbols_are_system_kind_specific() {
        let vars = vec!["x".to_string()];
        let flow = Compiler::new_with_context(&vars, &[], ExpressionContext::FlowTime);
        let map = Compiler::new_with_context(&vars, &[], ExpressionContext::MapIteration);

        let flow_code = flow
            .try_compile(&parse("t + x").expect("flow expression should parse"))
            .expect("flow time should compile");
        assert!(flow_code.uses_context());
        assert_eq!(
            flow.try_compile(&parse("n + x").expect("map symbol should parse"))
                .unwrap_err(),
            "Context symbol n is not available here; this expression context provides t"
        );

        let map_code = map
            .try_compile(&parse("n + x").expect("map expression should parse"))
            .expect("map iteration should compile");
        assert!(map_code.uses_context());
        assert_eq!(
            map.try_compile(&parse("t + x").expect("flow symbol should parse"))
                .unwrap_err(),
            "Context symbol t is not available here; this expression context provides n"
        );
    }

    #[test]
    fn quoted_identifiers_allow_spaces_in_variable_and_parameter_names() {
        let variables = vec!["Membrane Voltage".to_string()];
        let parameters = vec!["Applied Current".to_string()];
        let compiler = Compiler::new(&variables, &parameters);
        let expression = parse("`Membrane Voltage` + 2 * `Applied Current`")
            .expect("quoted display names should parse");
        let bytecode = compiler
            .try_compile(&expression)
            .expect("quoted display names should compile");
        let system = EquationSystem::new(vec![bytecode], vec![3.0]);
        let mut output = vec![0.0];
        system.apply(0.0, &[4.0], &mut output);
        assert_eq!(output, vec![10.0]);
    }

    #[test]
    fn declared_names_shadow_contextual_symbols() {
        let flow = Compiler::new_with_context(
            &["t".to_string()],
            &["n".to_string()],
            ExpressionContext::FlowTime,
        );
        let code = flow
            .try_compile(&parse("t + n").expect("expression should parse"))
            .expect("declared names should compile");
        assert!(!code.uses_context());

        let system = EquationSystem::new(vec![code], vec![4.0]);
        let mut out = vec![0.0];
        system.apply(99.0, &[3.0], &mut out);
        assert_close(out[0], 7.0);
    }

    #[test]
    fn equation_system_evaluates_f64_and_dual_context() {
        let compiler =
            Compiler::new_with_context(&["x".to_string()], &[], ExpressionContext::FlowTime);
        let code = compiler.compile(&parse("t * x").expect("expression should parse"));
        let system = EquationSystem::new(vec![code], Vec::new());
        assert!(system.uses_context());

        let mut out = vec![0.0];
        system.apply(2.5, &[4.0], &mut out);
        assert_close(out[0], 10.0);

        let mut dual_out = vec![Dual::new(0.0, 0.0)];
        system.apply(Dual::new(2.5, 1.0), &[Dual::new(4.0, 0.0)], &mut dual_out);
        assert_close(dual_out[0].val, 10.0);
        assert_close(dual_out[0].eps, 4.0);
    }

    #[test]
    fn parse_rejects_invalid_token() {
        assert!(parse("1 + $").is_err());
    }

    #[test]
    fn parse_rejects_invalid_number() {
        assert!(parse("1..2").is_err());
        assert!(parse(".").is_err());
    }

    #[test]
    fn evaluates_trig_and_hyperbolic_function_family() {
        let x = 0.7_f64;
        let p = 1.1_f64;

        assert_close(eval_with_x_and_p("tan(x)", x, p), x.tan());
        assert_close(eval_with_x_and_p("log(p)", x, p), p.ln());

        assert_close(eval_with_x_and_p("sec(x)", x, p), 1.0 / x.cos());
        assert_close(eval_with_x_and_p("csc(x)", x, p), 1.0 / x.sin());
        assert_close(eval_with_x_and_p("cot(x)", x, p), 1.0 / x.tan());

        assert_close(eval_with_x_and_p("sinh(p)", x, p), p.sinh());
        assert_close(eval_with_x_and_p("cosh(p)", x, p), p.cosh());
        assert_close(eval_with_x_and_p("tanh(p)", x, p), p.tanh());
        assert_close(eval_with_x_and_p("sech(p)", x, p), 1.0 / p.cosh());
        assert_close(eval_with_x_and_p("csch(p)", x, p), 1.0 / p.sinh());
        assert_close(eval_with_x_and_p("coth(p)", x, p), 1.0 / p.tanh());
    }

    #[test]
    fn dual_param_derivative_matches_numeric_for_supported_functions() {
        let x = 0.7_f64;
        let p = 1.1_f64;
        let expressions = [
            "tan(p)", "log(p)", "sec(p)", "csc(p)", "cot(p)", "sinh(p)", "cosh(p)", "tanh(p)",
            "sech(p)", "csch(p)", "coth(p)",
        ];

        for expr in expressions {
            let dual = eval_dual_wrt_p(expr, x, p);
            let expected_val = eval_with_x_and_p(expr, x, p);
            let expected_eps = numeric_derivative_wrt_p(expr, x, p);
            assert_close(dual.val, expected_val);
            assert_eps_close(dual.eps, expected_eps);
        }
    }

    #[test]
    fn evaluates_extended_smooth_unary_function_family() {
        let cases = [
            ("sqrt(p)", 2.3),
            ("cbrt(p)", 2.3),
            ("asin(p)", 0.3),
            ("acos(p)", 0.3),
            ("atan(p)", 0.3),
            ("asinh(p)", 0.5),
            ("acosh(p)", 2.0),
            ("atanh(p)", 0.4),
            ("exp2(p)", 1.5),
            ("expm1(p)", 0.4),
            ("log2(p)", 3.0),
            ("log10(p)", 2.5),
            ("log1p(p)", 0.4),
        ];

        for (expr, p) in cases {
            let dual = eval_dual_wrt_p(expr, 0.7, p);
            assert_close(dual.val, eval_with_x_and_p(expr, 0.7, p));
            assert_eps_close(dual.eps, numeric_derivative_wrt_p(expr, 0.7, p));
        }
    }

    #[test]
    fn evaluates_builtin_mathematical_constants() {
        assert_close(
            eval_with_x_and_p("pi + tau + e", 0.0, 0.0),
            std::f64::consts::PI + std::f64::consts::TAU + std::f64::consts::E,
        );

        let dual = eval_dual_wrt_p("p * pi + tau / e", 0.0, 1.5);
        assert_close(
            dual.val,
            1.5 * std::f64::consts::PI + std::f64::consts::TAU / std::f64::consts::E,
        );
        assert_close(dual.eps, std::f64::consts::PI);
    }

    #[test]
    fn declared_names_shadow_builtin_constants_for_compatibility() {
        let compiler = Compiler::new(&["pi".to_string()], &["e".to_string()]);
        let parsed = parse("pi + e + tau").expect("expression should parse");
        let bytecode = compiler.compile(&parsed);
        let system = EquationSystem::new(vec![bytecode], vec![4.0]);
        let mut out = vec![0.0];

        system.apply(0.0, &[3.0], &mut out);

        assert_close(out[0], 3.0 + 4.0 + std::f64::consts::TAU);
    }

    #[test]
    fn evaluates_stable_scientific_function_family() {
        let cases = [
            ("erf(p)", 0.7),
            ("erfc(p)", 0.7),
            ("sinc(p)", 0.7),
            ("sinc(p)", 1e-8),
            ("sigmoid(p)", -1.3),
            ("softplus(p)", -1.3),
            ("logaddexp(p, x)", 1.3),
        ];

        for (expr, p) in cases {
            let dual = eval_dual_wrt_p(expr, 0.7, p);
            assert_close(dual.val, eval_with_x_and_p(expr, 0.7, p));
            assert_eps_close(dual.eps, numeric_derivative_wrt_p(expr, 0.7, p));
        }

        assert_close(eval_with_x_and_p("erf(1)", 0.0, 0.0), 0.8427007929497149);
        assert_close(eval_with_x_and_p("erfc(1)", 0.0, 0.0), 0.15729920705028513);
        assert_close(eval_with_x_and_p("sinc(0)", 0.0, 0.0), 1.0);
        assert_close(eval_with_x_and_p("sigmoid(1000)", 0.0, 0.0), 1.0);
        assert_close(eval_with_x_and_p("sigmoid(-1000)", 0.0, 0.0), 0.0);
        assert_close(eval_with_x_and_p("softplus(1000)", 0.0, 0.0), 1000.0);
        assert_close(eval_with_x_and_p("softplus(-1000)", 0.0, 0.0), 0.0);
        assert_close(
            eval_with_x_and_p("logaddexp(1000, 999)", 0.0, 0.0),
            1000.0 + (-1.0_f64).exp().ln_1p(),
        );
        assert_close(
            eval_with_x_and_p("logaddexp(-1000, -1001)", 0.0, 0.0),
            -1000.0 + (-1.0_f64).exp().ln_1p(),
        );
    }

    #[test]
    fn evaluates_piecewise_conditionals_and_comparisons() {
        let comparisons = [
            ("p < x", 0.0),
            ("p <= x", 1.0),
            ("p > x", 0.0),
            ("p >= x", 1.0),
            ("p == x", 1.0),
            ("p != x", 0.0),
        ];
        for (expr, expected) in comparisons {
            assert_close(eval_with_x_and_p(expr, 0.7, 0.7), expected);
            assert_close(eval_dual_wrt_p(expr, 0.7, 0.7).eps, 0.0);
        }

        let positive = eval_dual_wrt_p("if(p > 0, p^2, -p)", 0.0, 1.2);
        assert_close(positive.val, 1.44);
        assert_close(positive.eps, 2.4);
        let negative = eval_dual_wrt_p("if(p > 0, p^2, -p)", 0.0, -1.2);
        assert_close(negative.val, 1.2);
        assert_close(negative.eps, -1.0);

        for (p, expected_val, expected_eps) in [(-2.0, -1.0, 0.0), (0.5, 0.5, 1.0), (2.0, 1.0, 0.0)]
        {
            let dual = eval_dual_wrt_p("clamp(p, -1, 1)", 0.0, p);
            assert_close(dual.val, expected_val);
            assert_close(dual.eps, expected_eps);
        }

        assert_close(eval_with_x_and_p("heaviside(-1)", 0.0, 0.0), 0.0);
        assert_close(eval_with_x_and_p("heaviside(0)", 0.0, 0.0), 0.5);
        assert_close(eval_with_x_and_p("heaviside(1)", 0.0, 0.0), 1.0);
        assert_close(eval_dual_wrt_p("heaviside(p)", 0.0, 0.7).eps, 0.0);
        assert!(eval_with_x_and_p("clamp(p, 1, -1)", 0.0, 0.0).is_nan());
        assert!(eval_with_x_and_p("heaviside(0/0)", 0.0, 0.0).is_nan());
    }

    #[test]
    fn parser_rejects_chained_comparisons() {
        assert!(parse("0 < x < 1").is_err());
    }

    #[test]
    fn evaluates_binary_and_variadic_function_family() {
        let x = 0.7_f64;
        let p = 1.3_f64;
        let expressions = [
            "atan2(p, x)",
            "hypot(p, x)",
            "pow(p, x)",
            "log(p, x)",
            "min(p, x)",
            "max(p, x)",
            "min(2, p, x)",
            "max(-2, p, x)",
        ];

        for expr in expressions {
            let dual = eval_dual_wrt_p(expr, x, p);
            assert_close(dual.val, eval_with_x_and_p(expr, x, p));
            assert_eps_close(dual.eps, numeric_derivative_wrt_p(expr, x, p));
        }
    }

    #[test]
    fn evaluates_piecewise_function_family_away_from_breakpoints() {
        let cases = [
            ("abs(p)", -1.3),
            ("floor(p)", 1.3),
            ("ceil(p)", 1.3),
            ("round(p)", 1.3),
            ("trunc(p)", -1.3),
            ("fract(p)", -1.3),
            ("sign(p)", -1.3),
        ];

        for (expr, p) in cases {
            let dual = eval_dual_wrt_p(expr, 0.7, p);
            assert_close(dual.val, eval_with_x_and_p(expr, 0.7, p));
            assert_eps_close(dual.eps, numeric_derivative_wrt_p(expr, 0.7, p));
        }
    }

    #[test]
    fn parser_accepts_scientific_notation_and_leading_underscore_identifiers() {
        assert_close(eval_with_x_and_p("1e-3 + p", 0.0, 2.0), 2.001);
        assert!(parse("_state + 1").is_ok());
    }

    #[test]
    fn parser_rejects_trailing_tokens() {
        assert!(parse("x y").is_err());
        assert!(parse("sin(x) trailing").is_err());
    }

    #[test]
    fn compiler_returns_user_facing_symbol_function_and_arity_errors() {
        let compiler = Compiler::new(&["x".to_string()], &["p".to_string()]);
        let cases = [
            ("missing + 1", "Unknown variable or parameter: missing"),
            ("mystery(x)", "Unknown function: mystery"),
            ("sin()", "Function 'sin' expects 1 argument; got 0."),
            ("pow(x)", "Function 'pow' expects 2 arguments; got 1."),
            (
                "log(x, p, 2)",
                "Function 'log' expects 1 or 2 arguments; got 3.",
            ),
            (
                "min(x)",
                "Function 'min' expects at least 2 arguments; got 1.",
            ),
            (
                "clamp(x, 0)",
                "Function 'clamp' expects 3 arguments; got 2.",
            ),
            ("if(x, 1)", "Function 'if' expects 3 arguments; got 2."),
        ];

        for (expression, expected) in cases {
            let parsed = parse(expression).expect("expression syntax should parse");
            let error = compiler
                .try_compile(&parsed)
                .expect_err("expression should fail compilation");
            assert_eq!(error, expected);
        }
    }
}

// --- EquationSystem ---

/// A concrete implementation of `DynamicalSystem` that uses the VM.
/// Contains one compiled bytecode expression per state variable.
pub struct EquationSystem {
    /// Immutable postfix bytecode retained for standalone/event evaluation and
    /// batch interpreters. Clones share this storage with the fused program.
    equations: Arc<[Bytecode]>,
    pub params: Vec<f64>,
    pub param_map: HashMap<String, usize>,
    pub var_map: HashMap<String, usize>,
    program: Arc<RegisterProgram>,
    workspace: RefCell<EquationWorkspace>,
}

/// Mutable evaluation memory is deliberately separate from the immutable,
/// Arc-shared compiled program. Every EquationSystem clone gets its own
/// workspace, so hot-path buffers are reusable without coupling clones.
struct EquationWorkspace {
    registers_f64: Vec<f64>,
    registers_dual: Vec<Dual>,
    params_dual: Vec<Dual>,
    state_dual: Vec<Dual>,
}

impl EquationWorkspace {
    fn new(register_count: usize, parameter_count: usize, dimension: usize) -> Self {
        Self {
            registers_f64: Vec::with_capacity(register_count),
            registers_dual: Vec::with_capacity(register_count),
            params_dual: Vec::with_capacity(parameter_count),
            state_dual: Vec::with_capacity(dimension),
        }
    }
}

fn sync_dual_params(params: &[f64], params_dual: &mut Vec<Dual>) {
    params_dual.resize(params.len(), Dual::new(0.0, 0.0));
    for (destination, &source) in params_dual.iter_mut().zip(params) {
        *destination = Dual::new(source, 0.0);
    }
}

impl Clone for EquationSystem {
    fn clone(&self) -> Self {
        Self {
            equations: self.equations.clone(),
            params: self.params.clone(),
            param_map: self.param_map.clone(),
            var_map: self.var_map.clone(),
            program: self.program.clone(),
            workspace: RefCell::new(EquationWorkspace::new(
                self.program.register_count(),
                self.params.len(),
                self.equations.len(),
            )),
        }
    }
}

impl EquationSystem {
    pub fn new(equations: Vec<Bytecode>, params: Vec<f64>) -> Self {
        let equations: Arc<[Bytecode]> = equations.into();
        let program = Arc::new(RegisterProgram::compile(equations.as_ref()));
        let workspace = RefCell::new(EquationWorkspace::new(
            program.register_count(),
            params.len(),
            equations.len(),
        ));
        Self {
            equations,
            params,
            param_map: HashMap::new(),
            var_map: HashMap::new(),
            program,
            workspace,
        }
    }

    pub fn set_maps(&mut self, param_map: HashMap<String, usize>, var_map: HashMap<String, usize>) {
        self.param_map = param_map;
        self.var_map = var_map;
    }

    /// Read-only access to the immutable postfix equations. Equation bytecode
    /// cannot be mutated after construction because the fused program is
    /// compiled from it and must remain in lockstep.
    pub fn equations(&self) -> &[Bytecode] {
        &self.equations
    }

    pub fn uses_context(&self) -> bool {
        self.program.uses_context()
    }

    /// Number of fixed registers evaluated by the fused program after exact
    /// common-subexpression elimination across all equations.
    pub fn register_count(&self) -> usize {
        self.program.register_count()
    }

    /// Total number of instructions in the original independent postfix
    /// equations, before cross-equation sharing.
    pub fn naive_instruction_count(&self) -> usize {
        self.program.naive_instruction_count()
    }

    pub fn ensure_dual_params(&self) {
        let mut workspace = self.workspace.borrow_mut();
        sync_dual_params(&self.params, &mut workspace.params_dual);
    }

    /// Evaluates the system values and state Jacobian into caller-owned buffers.
    ///
    /// The first seeded Dual evaluation supplies both the ordinary values and
    /// the first Jacobian column, so this does not evaluate the system
    /// separately with `f64`.
    pub(crate) fn apply_value_and_jacobian_in_place(
        &self,
        context: f64,
        state: &[f64],
        values: &mut [f64],
        jacobian: &mut [f64],
        dual_state: &mut [Dual],
        dual_out: &mut [Dual],
    ) {
        let dim = self.equations.len();
        assert_eq!(state.len(), dim);
        assert_eq!(values.len(), dim);
        assert_eq!(jacobian.len(), dim * dim);
        assert_eq!(dual_state.len(), dim);
        assert_eq!(dual_out.len(), dim);

        let mut workspace = self.workspace.borrow_mut();
        let EquationWorkspace {
            registers_dual,
            params_dual,
            ..
        } = &mut *workspace;
        sync_dual_params(&self.params, params_dual);
        let dual_context = Dual::new(context, 0.0);
        for column in 0..dim {
            for row in 0..dim {
                dual_state[row] = Dual::new(state[row], if row == column { 1.0 } else { 0.0 });
            }
            self.program.execute(
                dual_state,
                params_dual,
                dual_context,
                registers_dual,
                dual_out,
            );
            for row in 0..dim {
                if column == 0 {
                    values[row] = dual_out[row].val;
                }
                jacobian[row * dim + column] = dual_out[row].eps;
            }
        }
    }

    /// Evaluates the equations using Dual numbers, differentiating with respect to a specific parameter.
    /// The state variables `x` are treated as constants.
    pub fn evaluate_dual_wrt_param(&self, x: &[f64], param_idx: usize, out: &mut [Dual]) {
        self.evaluate_dual_wrt_param_at(x, param_idx, 0.0, out);
    }

    pub fn evaluate_dual_wrt_param_at(
        &self,
        x: &[f64],
        param_idx: usize,
        context: f64,
        out: &mut [Dual],
    ) {
        let mut workspace = self.workspace.borrow_mut();
        let EquationWorkspace {
            registers_dual,
            params_dual,
            state_dual,
            ..
        } = &mut *workspace;
        sync_dual_params(&self.params, params_dual);
        params_dual[param_idx].eps = 1.0;
        state_dual.resize(x.len(), Dual::new(0.0, 0.0));
        for (destination, &source) in state_dual.iter_mut().zip(x) {
            *destination = Dual::new(source, 0.0);
        }
        self.program.execute(
            state_dual,
            params_dual,
            Dual::new(context, 0.0),
            registers_dual,
            out,
        );
    }

    /// Evaluates the complete system with Dual state/context values while
    /// seeding one stored parameter. This is used when differentiating a
    /// numerical flow or map composition with respect to that parameter.
    pub fn apply_dual_wrt_param(
        &self,
        context: Dual,
        x: &[Dual],
        param_idx: usize,
        out: &mut [Dual],
    ) {
        let mut workspace = self.workspace.borrow_mut();
        let EquationWorkspace {
            registers_dual,
            params_dual,
            ..
        } = &mut *workspace;
        sync_dual_params(&self.params, params_dual);
        params_dual[param_idx].eps = 1.0;
        self.program
            .execute(x, params_dual, context, registers_dual, out);
    }
}

impl DynamicalSystem<f64> for EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, t: f64, x: &[f64], out: &mut [f64]) {
        let mut workspace = self.workspace.borrow_mut();
        self.program
            .execute(x, &self.params, t, &mut workspace.registers_f64, out);
    }
}

impl DynamicalSystem<Dual> for EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, t: Dual, x: &[Dual], out: &mut [Dual]) {
        let mut workspace = self.workspace.borrow_mut();
        let EquationWorkspace {
            registers_dual,
            params_dual,
            ..
        } = &mut *workspace;
        sync_dual_params(&self.params, params_dual);
        self.program.execute(x, params_dual, t, registers_dual, out);
    }
}

impl DynamicalSystem<f64> for &EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, t: f64, x: &[f64], out: &mut [f64]) {
        (*self).apply(t, x, out)
    }
}

impl DynamicalSystem<Dual> for &EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, t: Dual, x: &[Dual], out: &mut [Dual]) {
        (*self).apply(t, x, out)
    }
}

#[cfg(test)]
mod equation_system_value_jacobian_tests {
    use super::{parse, Compiler, Dual, EquationSystem};
    use crate::traits::DynamicalSystem;
    use std::sync::Arc;

    #[test]
    fn clones_share_immutable_programs_but_keep_independent_workspaces() {
        let variables = vec!["x".to_string(), "y".to_string()];
        let compiler = Compiler::new(&variables, &[]);
        let equations = ["x*x + y", "x*x - y"]
            .iter()
            .map(|source| compiler.compile(&parse(source).expect("parse equation")))
            .collect();
        let system = EquationSystem::new(equations, Vec::new());
        let clone = system.clone();

        assert!(Arc::ptr_eq(&system.equations, &clone.equations));
        assert!(Arc::ptr_eq(&system.program, &clone.program));
        assert_ne!(system.workspace.as_ptr(), clone.workspace.as_ptr());
        assert_eq!(system.naive_instruction_count(), 10);
        assert_eq!(system.register_count(), 5);

        let mut first = [0.0; 2];
        let mut second = [0.0; 2];
        system.apply(0.0, &[3.0, 4.0], &mut first);
        clone.apply(0.0, &[2.0, -1.0], &mut second);
        assert_eq!(first, [13.0, 5.0]);
        assert_eq!(second, [3.0, 5.0]);
    }

    #[test]
    fn value_and_jacobian_in_place_reuses_caller_buffers() {
        let variables = vec!["x".to_string(), "y".to_string()];
        let parameters = vec!["mu".to_string()];
        let compiler = Compiler::new(&variables, &parameters);
        let equations = ["mu*x + y*y", "sin(x) - mu*y"]
            .iter()
            .map(|source| compiler.compile(&parse(source).expect("parse equation")))
            .collect();
        let system = EquationSystem::new(equations, vec![0.25]);
        let mut values = vec![f64::NAN; 2];
        let mut jacobian = vec![f64::NAN; 4];
        let mut dual_state = vec![Dual::new(f64::NAN, f64::NAN); 2];
        let mut dual_out = vec![Dual::new(f64::NAN, f64::NAN); 2];

        system.apply_value_and_jacobian_in_place(
            0.0,
            &[0.4, -0.3],
            &mut values,
            &mut jacobian,
            &mut dual_state,
            &mut dual_out,
        );

        assert!((values[0] - 0.19).abs() <= 1e-15);
        assert!((values[1] - (0.4_f64.sin() + 0.075)).abs() <= 1e-15);
        let expected = [0.25, -0.6, 0.4_f64.cos(), -0.25];
        for (actual, expected) in jacobian.iter().zip(expected) {
            assert!((actual - expected).abs() <= 1e-15);
        }

        system.apply_value_and_jacobian_in_place(
            0.0,
            &[-0.2, 0.5],
            &mut values,
            &mut jacobian,
            &mut dual_state,
            &mut dual_out,
        );
        assert!((values[0] - 0.2).abs() <= 1e-15);
        assert!((values[1] - (-0.2_f64.sin() - 0.125)).abs() <= 1e-15);
        let expected = [0.25, 1.0, (-0.2_f64).cos(), -0.25];
        for (actual, expected) in jacobian.iter().zip(expected) {
            assert!((actual - expected).abs() <= 1e-15);
        }
    }
}
