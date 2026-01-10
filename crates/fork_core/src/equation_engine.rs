use crate::{
    autodiff::Dual,
    traits::{DynamicalSystem, Scalar},
};
use std::cell::RefCell;
use std::collections::HashMap;
use thiserror::Error;

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
    /// Pops top value (a), pushes exp(a).
    Exp,
    /// Pops top value (a), pushes -a.
    Neg,
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

#[derive(Debug, Error)]
pub enum EquationError {
    #[error("unknown variable or parameter: {0}")]
    UnknownSymbol(String),
    #[error("unknown binary operator: {0}")]
    UnknownBinaryOperator(char),
    #[error("unknown unary operator: {0}")]
    UnknownUnaryOperator(char),
    #[error("unknown function: {0}")]
    UnknownFunction(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("bytecode stack underflow for {0:?}")]
    StackUnderflow(OpCode),
    #[error("bytecode missing result value")]
    MissingResult,
    #[error("variable index out of bounds: {0}")]
    VarIndexOutOfBounds(usize),
    #[error("parameter index out of bounds: {0}")]
    ParamIndexOutOfBounds(usize),
    #[error("scalar conversion failed")]
    ScalarConversion,
}

pub type EquationResult<T> = Result<T, EquationError>;

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

fn pop_stack<T: Scalar>(stack: &mut Vec<T>, op: OpCode) -> EquationResult<T> {
    stack.pop().ok_or(EquationError::StackUnderflow(op))
}

impl VM {
    /// Executes the bytecode.
    ///
    /// # Type Parameters
    /// * `T`: The scalar type (e.g., `f64` or `Dual`).
    pub fn execute<T: Scalar>(
        bytecode: &Bytecode,
        vars: &[T],
        params: &[T],
        stack: &mut Vec<T>,
    ) -> EquationResult<T> {
        stack.clear();

        for &op in &bytecode.ops {
            match op {
                OpCode::LoadConst(val) => {
                    let value = T::from_f64(val).ok_or(EquationError::ScalarConversion)?;
                    stack.push(value);
                }
                OpCode::LoadVar(idx) => {
                    let value = *vars
                        .get(idx)
                        .ok_or(EquationError::VarIndexOutOfBounds(idx))?;
                    stack.push(value);
                }
                OpCode::LoadParam(idx) => {
                    let value = *params
                        .get(idx)
                        .ok_or(EquationError::ParamIndexOutOfBounds(idx))?;
                    stack.push(value);
                }
                OpCode::Add => {
                    let b = pop_stack(stack, op)?;
                    let a = pop_stack(stack, op)?;
                    stack.push(a + b);
                }
                OpCode::Sub => {
                    let b = pop_stack(stack, op)?;
                    let a = pop_stack(stack, op)?;
                    stack.push(a - b);
                }
                OpCode::Mul => {
                    let b = pop_stack(stack, op)?;
                    let a = pop_stack(stack, op)?;
                    stack.push(a * b);
                }
                OpCode::Div => {
                    let b = pop_stack(stack, op)?;
                    let a = pop_stack(stack, op)?;
                    stack.push(a / b);
                }
                OpCode::Pow => {
                    let b = pop_stack(stack, op)?;
                    let a = pop_stack(stack, op)?;
                    stack.push(a.powf(b));
                }
                OpCode::Sin => {
                    let a = pop_stack(stack, op)?;
                    stack.push(a.sin());
                }
                OpCode::Cos => {
                    let a = pop_stack(stack, op)?;
                    stack.push(a.cos());
                }
                OpCode::Exp => {
                    let a = pop_stack(stack, op)?;
                    stack.push(a.exp());
                }
                OpCode::Neg => {
                    let a = pop_stack(stack, op)?;
                    stack.push(-a);
                }
            }
        }

        // The result is the last item on the stack. Default to 0.0 if empty (shouldn't happen in valid code).
        stack.pop().ok_or(EquationError::MissingResult)
    }
}

// --- AST & Parser ---

/// Abstract Syntax Tree nodes for expressions.
#[derive(Debug)]
pub enum Expr {
    Number(f64),
    Variable(String),
    Binary(Box<Expr>, char, Box<Expr>), // char is operator +, -, *, /, ^
    Unary(char, Box<Expr>),             // -, s (sin), c (cos), e (exp)
    Call(String, Box<Expr>),            // functions like sin(x)
}

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

    pub fn compile(&self, expr: &Expr) -> EquationResult<Bytecode> {
        let mut ops = Vec::new();
        self.compile_recursive(expr, &mut ops)?;
        Ok(Bytecode { ops })
    }

    fn compile_recursive(&self, expr: &Expr, ops: &mut Vec<OpCode>) -> EquationResult<()> {
        match expr {
            Expr::Number(n) => ops.push(OpCode::LoadConst(*n)),
            Expr::Variable(name) => {
                if let Some(&idx) = self.var_map.get(name) {
                    ops.push(OpCode::LoadVar(idx));
                } else if let Some(&idx) = self.param_map.get(name) {
                    ops.push(OpCode::LoadParam(idx));
                } else {
                    return Err(EquationError::UnknownSymbol(name.clone()));
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
                    _ => return Err(EquationError::UnknownBinaryOperator(*op)),
                }
            }
            Expr::Unary(op, operand) => {
                self.compile_recursive(operand, ops)?;
                match op {
                    '-' => ops.push(OpCode::Neg),
                    _ => return Err(EquationError::UnknownUnaryOperator(*op)),
                }
            }
            Expr::Call(func, arg) => {
                self.compile_recursive(arg, ops)?;
                match func.as_str() {
                    "sin" => ops.push(OpCode::Sin),
                    "cos" => ops.push(OpCode::Cos),
                    "exp" => ops.push(OpCode::Exp),
                    _ => return Err(EquationError::UnknownFunction(func.clone())),
                }
            }
        }
        Ok(())
    }
}

// --- Simple Parser ---

/// Parses a string expression into an AST.
pub fn parse(input: &str) -> EquationResult<Expr> {
    let tokens = tokenize(input)?;
    let mut parser = Parser { tokens, pos: 0 };
    let expr = parser.parse_expression()?;
    if parser.peek().is_some() {
        return Err(EquationError::Parse("Unexpected token".to_string()));
    }
    Ok(expr)
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
    LParen,
    RParen,
}

fn tokenize(input: &str) -> EquationResult<Vec<Token>> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c.is_digit(10) || c == '.' {
            let mut num_str = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_digit(10) || d == '.' {
                    num_str.push(d);
                    chars.next();
                } else {
                    break;
                }
            }
            let value = num_str
                .parse()
                .map_err(|_| EquationError::Parse(format!("Invalid number literal: {}", num_str)))?;
            tokens.push(Token::Number(value));
        } else if c.is_alphabetic() {
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
                '(' => tokens.push(Token::LParen),
                ')' => tokens.push(Token::RParen),
                _ => {
                    return Err(EquationError::Parse(format!(
                        "Unexpected character: {}",
                        c
                    )))
                }
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

    fn parse_expression(&mut self) -> EquationResult<Expr> {
        self.parse_term()
    }

    fn parse_term(&mut self) -> EquationResult<Expr> {
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

    fn parse_factor(&mut self) -> EquationResult<Expr> {
        let left = self.parse_factor_op()?;
        Ok(left)
    }

    fn parse_factor_op(&mut self) -> EquationResult<Expr> {
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

    fn parse_power(&mut self) -> EquationResult<Expr> {
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

    fn parse_unary(&mut self) -> EquationResult<Expr> {
        if let Some(token) = self.peek() {
            if let Token::Minus = token {
                self.consume();
                let expr = self.parse_unary()?;
                return Ok(Expr::Unary('-', Box::new(expr)));
            }
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> EquationResult<Expr> {
        match self.consume() {
            Some(Token::Number(n)) => Ok(Expr::Number(n)),
            Some(Token::Identifier(name)) => {
                if let Some(Token::LParen) = self.peek() {
                    self.consume(); // eat '('
                    let arg = self.parse_expression()?;
                    if let Some(Token::RParen) = self.consume() {
                        Ok(Expr::Call(name, Box::new(arg)))
                    } else {
                        Err(EquationError::Parse("Expected ')'".to_string()))
                    }
                } else {
                    Ok(Expr::Variable(name))
                }
            }
            Some(Token::LParen) => {
                let expr = self.parse_expression()?;
                if let Some(Token::RParen) = self.consume() {
                    Ok(expr)
                } else {
                    Err(EquationError::Parse("Expected ')'".to_string()))
                }
            }
            _ => Err(EquationError::Parse("Unexpected token".to_string())),
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
    last_error: RefCell<Option<EquationError>>,
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
            last_error: RefCell::new(None),
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

    pub fn take_last_error(&self) -> Option<EquationError> {
        self.last_error.borrow_mut().take()
    }

    fn execute_or_default<T: Scalar>(
        &self,
        bytecode: &Bytecode,
        vars: &[T],
        params: &[T],
        stack: &mut Vec<T>,
    ) -> T {
        match VM::execute(bytecode, vars, params, stack) {
            Ok(value) => {
                self.last_error.borrow_mut().take();
                value
            }
            Err(err) => {
                *self.last_error.borrow_mut() = Some(err);
                T::zero()
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
            out[i] = self.execute_or_default(eq, &x_dual, &params, &mut stack);
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
            out[i] = self.execute_or_default(eq, x, &self.params, &mut stack);
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
            out[i] = self.execute_or_default(eq, x, &params, &mut stack);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_reports_malformed_expression() {
        let err = parse("sin(").unwrap_err();
        assert!(matches!(err, EquationError::Parse(_)));
    }

    #[test]
    fn compile_reports_unknown_symbol() {
        let compiler = Compiler::new(&[String::from("x")], &[]);
        let expr = Expr::Variable("y".to_string());
        let err = compiler.compile(&expr).unwrap_err();
        assert!(matches!(err, EquationError::UnknownSymbol(name) if name == "y"));
    }

    #[test]
    fn compile_reports_unknown_function() {
        let compiler = Compiler::new(&[String::from("x")], &[]);
        let expr = Expr::Call("log".to_string(), Box::new(Expr::Variable("x".to_string())));
        let err = compiler.compile(&expr).unwrap_err();
        assert!(matches!(err, EquationError::UnknownFunction(name) if name == "log"));
    }

    #[test]
    fn vm_reports_stack_underflow() {
        let bytecode = Bytecode {
            ops: vec![OpCode::Add],
        };
        let mut stack: Vec<f64> = Vec::new();
        let err = VM::execute(&bytecode, &[], &[], &mut stack).unwrap_err();
        assert!(matches!(err, EquationError::StackUnderflow(OpCode::Add)));
    }

    #[test]
    fn vm_reports_invalid_var_index() {
        let bytecode = Bytecode {
            ops: vec![OpCode::LoadVar(1)],
        };
        let mut stack = Vec::new();
        let err = VM::execute(&bytecode, &[1.0], &[], &mut stack).unwrap_err();
        assert!(matches!(err, EquationError::VarIndexOutOfBounds(1)));
    }
}
