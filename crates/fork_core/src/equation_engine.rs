use crate::{
    autodiff::Dual,
    traits::{DynamicalSystem, Scalar},
};
use std::cell::RefCell;
use std::collections::HashMap;

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
}

impl Compiler {
    pub fn new(var_names: &[String], param_names: &[String]) -> Self {
        let mut var_map = HashMap::new();
        for (i, name) in var_names.iter().enumerate() {
            var_map.insert(name.clone(), i);
        }

        let mut param_map = HashMap::new();
        for (i, name) in param_names.iter().enumerate() {
            param_map.insert(name.clone(), i);
        }

        Self { var_map, param_map }
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

    fn compile_recursive(&self, expr: &Expr, ops: &mut Vec<OpCode>) -> Result<(), String> {
        match expr {
            Expr::Number(n) => ops.push(OpCode::LoadConst(*n)),
            Expr::Variable(name) => {
                if let Some(&idx) = self.var_map.get(name) {
                    ops.push(OpCode::LoadVar(idx));
                } else if let Some(&idx) = self.param_map.get(name) {
                    ops.push(OpCode::LoadParam(idx));
                } else if let Some(value) = builtin_constant(name) {
                    ops.push(OpCode::LoadConst(value));
                } else {
                    return Err(format!("Unknown variable or parameter: {name}"));
                }
            }
            Expr::Binary(left, op, right) => {
                self.compile_recursive(left, ops)?;
                self.compile_recursive(right, ops)?;
                match op {
                    '+' => ops.push(OpCode::Add),
                    '-' => ops.push(OpCode::Sub),
                    '*' => ops.push(OpCode::Mul),
                    '/' => ops.push(OpCode::Div),
                    '^' => ops.push(OpCode::Pow),
                    _ => return Err(format!("Unknown binary operator: {op}")),
                }
            }
            Expr::Comparison(left, comparison, right) => {
                self.compile_recursive(left, ops)?;
                self.compile_recursive(right, ops)?;
                ops.push(match comparison {
                    ComparisonOp::Less => OpCode::Less,
                    ComparisonOp::LessEqual => OpCode::LessEqual,
                    ComparisonOp::Greater => OpCode::Greater,
                    ComparisonOp::GreaterEqual => OpCode::GreaterEqual,
                    ComparisonOp::Equal => OpCode::Equal,
                    ComparisonOp::NotEqual => OpCode::NotEqual,
                });
            }
            Expr::Unary(op, operand) => {
                self.compile_recursive(operand, ops)?;
                match op {
                    '-' => ops.push(OpCode::Neg),
                    _ => return Err(format!("Unknown unary operator: {op}")),
                }
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
                    self.compile_recursive(&args[0], ops)?;
                    for arg in &args[1..] {
                        self.compile_recursive(arg, ops)?;
                        ops.push(if func == "min" {
                            OpCode::Min
                        } else {
                            OpCode::Max
                        });
                    }
                    return Ok(());
                }

                for arg in args {
                    self.compile_recursive(arg, ops)?;
                }
                ops.push(resolve_fixed_function(func, args.len())?);
            }
        }
        Ok(())
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
    use super::{parse, Compiler, Dual, EquationSystem};
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
    pub equations: Vec<Bytecode>,
    pub params: Vec<f64>,
    pub param_map: HashMap<String, usize>,
    pub var_map: HashMap<String, usize>,
    // Separate stacks/param caches for f64 and Dual execution to avoid reallocations.
    stack_f64: RefCell<Vec<f64>>,
    stack_dual: RefCell<Vec<Dual>>,
    pub(crate) params_dual: RefCell<Vec<Dual>>,
}

impl EquationSystem {
    pub fn new(equations: Vec<Bytecode>, params: Vec<f64>) -> Self {
        Self {
            equations,
            params,
            param_map: HashMap::new(),
            var_map: HashMap::new(),
            stack_f64: RefCell::new(Vec::with_capacity(64)),
            stack_dual: RefCell::new(Vec::with_capacity(64)),
            params_dual: RefCell::new(Vec::new()),
        }
    }

    pub fn set_maps(&mut self, param_map: HashMap<String, usize>, var_map: HashMap<String, usize>) {
        self.param_map = param_map;
        self.var_map = var_map;
    }

    pub fn ensure_dual_params(&self) {
        let mut params_dual = self.params_dual.borrow_mut();
        if params_dual.len() != self.params.len() {
            params_dual.clear();
            params_dual.extend(self.params.iter().map(|&p| Dual::new(p, 0.0)));
        } else {
            for (dst, &src) in params_dual.iter_mut().zip(self.params.iter()) {
                *dst = Dual::new(src, 0.0);
            }
        }
    }

    /// Evaluates the equations using Dual numbers, differentiating with respect to a specific parameter.
    /// The state variables `x` are treated as constants.
    pub fn evaluate_dual_wrt_param(&self, x: &[f64], param_idx: usize, out: &mut [Dual]) {
        self.ensure_dual_params();

        {
            let mut params = self.params_dual.borrow_mut();
            params[param_idx].eps = 1.0;
        }

        let x_dual: Vec<Dual> = x.iter().map(|&v| Dual::new(v, 0.0)).collect();

        let params = self.params_dual.borrow();
        let mut stack = self.stack_dual.borrow_mut();
        for (i, eq) in self.equations.iter().enumerate() {
            out[i] = VM::execute(eq, &x_dual, &params, &mut stack);
        }
    }
}

impl DynamicalSystem<f64> for EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, _t: f64, x: &[f64], out: &mut [f64]) {
        let mut stack = self.stack_f64.borrow_mut();
        for (i, eq) in self.equations.iter().enumerate() {
            out[i] = VM::execute(eq, x, &self.params, &mut stack);
        }
    }
}

impl DynamicalSystem<Dual> for EquationSystem {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, _t: Dual, x: &[Dual], out: &mut [Dual]) {
        self.ensure_dual_params();
        let params = self.params_dual.borrow();
        let mut stack = self.stack_dual.borrow_mut();
        for (i, eq) in self.equations.iter().enumerate() {
            out[i] = VM::execute(eq, x, &params, &mut stack);
        }
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
