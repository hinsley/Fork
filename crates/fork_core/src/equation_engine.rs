use crate::traits::{Scalar, DynamicalSystem};
use std::collections::HashMap;
use std::cell::RefCell;

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
    pub fn execute<T: Scalar>(
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
                OpCode::Exp => {
                    let a = stack.pop().unwrap();
                    stack.push(a.exp());
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
    Unary(char, Box<Expr>), // -, s (sin), c (cos), e (exp)
    Call(String, Box<Expr>), // functions like sin(x)
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

    pub fn compile(&self, expr: &Expr) -> Bytecode {
        let mut ops = Vec::new();
        self.compile_recursive(expr, &mut ops);
        Bytecode { ops }
    }

    fn compile_recursive(&self, expr: &Expr, ops: &mut Vec<OpCode>) {
        match expr {
            Expr::Number(n) => ops.push(OpCode::LoadConst(*n)),
            Expr::Variable(name) => {
                if let Some(&idx) = self.var_map.get(name) {
                    ops.push(OpCode::LoadVar(idx));
                } else if let Some(&idx) = self.param_map.get(name) {
                    ops.push(OpCode::LoadParam(idx));
                } else {
                    panic!("Unknown variable or parameter: {}", name);
                }
            }
            Expr::Binary(left, op, right) => {
                self.compile_recursive(left, ops);
                self.compile_recursive(right, ops);
                match op {
                    '+' => ops.push(OpCode::Add),
                    '-' => ops.push(OpCode::Sub),
                    '*' => ops.push(OpCode::Mul),
                    '/' => ops.push(OpCode::Div),
                    '^' => ops.push(OpCode::Pow),
                    _ => panic!("Unknown binary operator: {}", op),
                }
            }
            Expr::Unary(op, operand) => {
                self.compile_recursive(operand, ops);
                match op {
                    '-' => ops.push(OpCode::Neg),
                    _ => panic!("Unknown unary operator: {}", op),
                }
            }
            Expr::Call(func, arg) => {
                self.compile_recursive(arg, ops);
                match func.as_str() {
                    "sin" => ops.push(OpCode::Sin),
                    "cos" => ops.push(OpCode::Cos),
                    "exp" => ops.push(OpCode::Exp),
                    _ => panic!("Unknown function: {}", func),
                }
            }
        }
    }
}

// --- Simple Parser ---

/// Parses a string expression into an AST.
pub fn parse(input: &str) -> Result<Expr, String> {
    let tokens = tokenize(input);
    let mut parser = Parser { tokens, pos: 0 };
    parser.parse_expression()
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Identifier(String),
    Plus, Minus, Star, Slash, Caret,
    LParen, RParen,
}

fn tokenize(input: &str) -> Vec<Token> {
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
            tokens.push(Token::Number(num_str.parse().unwrap_or(0.0)));
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
                _ => {} // Ignore unknown
            }
            chars.next();
        }
    }
    tokens
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
        self.parse_term()
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
                    let arg = self.parse_expression()?;
                    if let Some(Token::RParen) = self.consume() {
                        Ok(Expr::Call(name, Box::new(arg)))
                    } else {
                        Err("Expected ')'".to_string())
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
                    Err("Expected ')'".to_string())
                }
            }
            _ => Err("Unexpected token".to_string()),
        }
    }
}

// --- EquationSystem ---

/// A concrete implementation of `DynamicalSystem` that uses the VM.
/// Contains one compiled bytecode expression per state variable.
pub struct EquationSystem<T: Scalar> {
    pub equations: Vec<Bytecode>,
    pub params: Vec<T>,
    // Interior mutability for VM stack to avoid allocation in apply.
    // Note: This makes the system !Sync. For parallelization, we'd need a different approach.
    pub stack: RefCell<Vec<T>>, 
}

impl<T: Scalar> EquationSystem<T> {
    pub fn new(equations: Vec<Bytecode>, params: Vec<T>) -> Self {
        Self {
            equations,
            params,
            stack: RefCell::new(Vec::with_capacity(64)),
        }
    }
}

impl<T: Scalar> DynamicalSystem<T> for EquationSystem<T> {
    fn dimension(&self) -> usize {
        self.equations.len()
    }

    fn apply(&self, _t: T, x: &[T], out: &mut [T]) {
        let mut stack = self.stack.borrow_mut();
        for (i, eq) in self.equations.iter().enumerate() {
            out[i] = VM::execute(eq, x, &self.params, &mut stack);
        }
    }
}
