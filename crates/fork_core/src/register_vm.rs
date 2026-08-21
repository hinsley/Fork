use crate::equation_engine::{Bytecode, ComparisonOp, ExpressionScalar, OpCode};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::mem::{discriminant, Discriminant};

/// One instruction in the fused register program. Inputs always refer to
/// earlier registers, so evaluation is a single forward pass.
#[derive(Debug, Clone, Copy)]
struct RegisterInstruction {
    op: OpCode,
    inputs: [usize; 3],
    arity: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RegisterKey {
    opcode: Discriminant<OpCode>,
    immediate: u64,
    inputs: [usize; 3],
    arity: u8,
}

impl Hash for RegisterKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.opcode.hash(state);
        self.immediate.hash(state);
        self.inputs.hash(state);
        self.arity.hash(state);
    }
}

/// Immutable, fused representation of every equation in an EquationSystem.
///
/// Compiling all equations together makes exact common subexpressions shared
/// across outputs. Unlike the public postfix bytecode VM, intermediates live in
/// fixed registers and require neither push/pop traffic nor one stack reset per
/// equation.
#[derive(Debug)]
pub(crate) struct RegisterProgram {
    instructions: Vec<RegisterInstruction>,
    outputs: Vec<usize>,
    naive_instruction_count: usize,
    uses_context: bool,
}

impl RegisterProgram {
    pub(crate) fn compile(equations: &[Bytecode]) -> Self {
        let naive_instruction_count = equations.iter().map(|equation| equation.ops.len()).sum();
        let uses_context = equations.iter().any(Bytecode::uses_context);
        let mut instructions = Vec::new();
        let mut nodes = HashMap::new();
        let mut outputs = Vec::with_capacity(equations.len());

        for equation in equations {
            let mut stack = Vec::with_capacity(equation.ops.len());
            for &op in &equation.ops {
                let arity = opcode_arity(op);
                assert!(
                    stack.len() >= arity,
                    "invalid equation bytecode: {op:?} requires {arity} operands"
                );

                let first_input = stack.len() - arity;
                let mut inputs = [0; 3];
                for (destination, source) in inputs[..arity]
                    .iter_mut()
                    .zip(stack[first_input..].iter().copied())
                {
                    *destination = source;
                }
                stack.truncate(first_input);

                let key = RegisterKey {
                    opcode: discriminant(&op),
                    immediate: opcode_immediate(op),
                    inputs,
                    arity: arity as u8,
                };
                let register = if let Some(&register) = nodes.get(&key) {
                    register
                } else {
                    let register = instructions.len();
                    instructions.push(RegisterInstruction {
                        op,
                        inputs,
                        arity: arity as u8,
                    });
                    nodes.insert(key, register);
                    register
                };
                stack.push(register);
            }

            // Preserve the stack VM's behavior for an empty expression.
            let output = stack.last().copied().unwrap_or_else(|| {
                let op = OpCode::LoadConst(0.0);
                let key = RegisterKey {
                    opcode: discriminant(&op),
                    immediate: 0.0_f64.to_bits(),
                    inputs: [0; 3],
                    arity: 0,
                };
                if let Some(&register) = nodes.get(&key) {
                    register
                } else {
                    let register = instructions.len();
                    instructions.push(RegisterInstruction {
                        op,
                        inputs: [0; 3],
                        arity: 0,
                    });
                    nodes.insert(key, register);
                    register
                }
            });
            outputs.push(output);
        }

        Self {
            instructions,
            outputs,
            naive_instruction_count,
            uses_context,
        }
    }

    pub(crate) fn execute<T: ExpressionScalar>(
        &self,
        vars: &[T],
        params: &[T],
        context: T,
        registers: &mut Vec<T>,
        out: &mut [T],
    ) {
        assert!(
            out.len() >= self.outputs.len(),
            "equation output buffer has length {}; expected at least {}",
            out.len(),
            self.outputs.len()
        );
        let zero = T::from_f64(0.0).unwrap();
        registers.resize(self.instructions.len(), zero);

        for (destination, instruction) in self.instructions.iter().enumerate() {
            debug_assert_eq!(instruction.arity as usize, opcode_arity(instruction.op));
            let input = |index: usize| registers[instruction.inputs[index]];
            let value = match instruction.op {
                OpCode::LoadConst(value) => T::from_f64(value).unwrap(),
                OpCode::LoadVar(index) => vars[index],
                OpCode::LoadParam(index) => params[index],
                OpCode::LoadContext => context,
                OpCode::Add => input(0) + input(1),
                OpCode::Sub => input(0) - input(1),
                OpCode::Mul => input(0) * input(1),
                OpCode::Div => input(0) / input(1),
                OpCode::Pow => input(0).powf(input(1)),
                OpCode::Square => input(0) * input(0),
                OpCode::Cube => input(0) * input(0) * input(0),
                OpCode::PowI(exponent) => input(0).powi(exponent),
                OpCode::Sin => input(0).sin(),
                OpCode::Cos => input(0).cos(),
                OpCode::Tan => input(0).tan(),
                OpCode::Exp => input(0).exp(),
                OpCode::Log => input(0).ln(),
                OpCode::Sinh => input(0).sinh(),
                OpCode::Cosh => input(0).cosh(),
                OpCode::Tanh => input(0).tanh(),
                OpCode::Sec => T::one() / input(0).cos(),
                OpCode::Csc => T::one() / input(0).sin(),
                OpCode::Cot => T::one() / input(0).tan(),
                OpCode::Sech => T::one() / input(0).cosh(),
                OpCode::Csch => T::one() / input(0).sinh(),
                OpCode::Coth => T::one() / input(0).tanh(),
                OpCode::Asin => input(0).asin(),
                OpCode::Acos => input(0).acos(),
                OpCode::Atan => input(0).atan(),
                OpCode::Asinh => input(0).asinh(),
                OpCode::Acosh => input(0).acosh(),
                OpCode::Atanh => input(0).atanh(),
                OpCode::Sqrt => input(0).sqrt(),
                OpCode::Cbrt => input(0).cbrt(),
                OpCode::Exp2 => input(0).exp2(),
                OpCode::ExpM1 => input(0).exp_m1(),
                OpCode::Log2 => input(0).log2(),
                OpCode::Log10 => input(0).log10(),
                OpCode::Log1P => input(0).ln_1p(),
                OpCode::LogBase => input(0).log(input(1)),
                OpCode::Atan2 => input(0).atan2(input(1)),
                OpCode::Hypot => input(0).hypot(input(1)),
                OpCode::Min => input(0).min(input(1)),
                OpCode::Max => input(0).max(input(1)),
                OpCode::Abs => input(0).abs(),
                OpCode::Floor => input(0).floor(),
                OpCode::Ceil => input(0).ceil(),
                OpCode::Round => input(0).round(),
                OpCode::Trunc => input(0).trunc(),
                OpCode::Fract => input(0).fract(),
                OpCode::Sign => input(0).signum(),
                OpCode::Erf => input(0).expr_erf(),
                OpCode::Erfc => input(0).expr_erfc(),
                OpCode::Sinc => input(0).expr_sinc(),
                OpCode::Sigmoid => input(0).expr_sigmoid(),
                OpCode::Softplus => input(0).expr_softplus(),
                OpCode::LogAddExp => input(0).expr_logaddexp(input(1)),
                OpCode::Clamp => input(0).expr_clamp(input(1), input(2)),
                OpCode::Heaviside => input(0).expr_heaviside(),
                OpCode::Less => input(0).expr_compare(input(1), ComparisonOp::Less),
                OpCode::LessEqual => input(0).expr_compare(input(1), ComparisonOp::LessEqual),
                OpCode::Greater => input(0).expr_compare(input(1), ComparisonOp::Greater),
                OpCode::GreaterEqual => input(0).expr_compare(input(1), ComparisonOp::GreaterEqual),
                OpCode::Equal => input(0).expr_compare(input(1), ComparisonOp::Equal),
                OpCode::NotEqual => input(0).expr_compare(input(1), ComparisonOp::NotEqual),
                OpCode::Select => input(0).expr_select(input(1), input(2)),
                OpCode::Neg => -input(0),
            };
            registers[destination] = value;
        }

        for (destination, &source) in out.iter_mut().zip(&self.outputs) {
            *destination = registers[source];
        }
    }

    pub(crate) fn register_count(&self) -> usize {
        self.instructions.len()
    }

    pub(crate) fn naive_instruction_count(&self) -> usize {
        self.naive_instruction_count
    }

    pub(crate) fn uses_context(&self) -> bool {
        self.uses_context
    }
}

fn opcode_immediate(op: OpCode) -> u64 {
    match op {
        OpCode::LoadConst(value) => value.to_bits(),
        OpCode::LoadVar(index) | OpCode::LoadParam(index) => index as u64,
        OpCode::PowI(exponent) => (exponent as u32) as u64,
        _ => 0,
    }
}

fn opcode_arity(op: OpCode) -> usize {
    match op {
        OpCode::LoadConst(_) | OpCode::LoadVar(_) | OpCode::LoadParam(_) | OpCode::LoadContext => 0,
        OpCode::Add
        | OpCode::Sub
        | OpCode::Mul
        | OpCode::Div
        | OpCode::Pow
        | OpCode::LogBase
        | OpCode::Atan2
        | OpCode::Hypot
        | OpCode::Min
        | OpCode::Max
        | OpCode::LogAddExp
        | OpCode::Less
        | OpCode::LessEqual
        | OpCode::Greater
        | OpCode::GreaterEqual
        | OpCode::Equal
        | OpCode::NotEqual => 2,
        OpCode::Clamp | OpCode::Select => 3,
        OpCode::Square
        | OpCode::Cube
        | OpCode::PowI(_)
        | OpCode::Sin
        | OpCode::Cos
        | OpCode::Tan
        | OpCode::Exp
        | OpCode::Log
        | OpCode::Sinh
        | OpCode::Cosh
        | OpCode::Tanh
        | OpCode::Sec
        | OpCode::Csc
        | OpCode::Cot
        | OpCode::Sech
        | OpCode::Csch
        | OpCode::Coth
        | OpCode::Asin
        | OpCode::Acos
        | OpCode::Atan
        | OpCode::Asinh
        | OpCode::Acosh
        | OpCode::Atanh
        | OpCode::Sqrt
        | OpCode::Cbrt
        | OpCode::Exp2
        | OpCode::ExpM1
        | OpCode::Log2
        | OpCode::Log10
        | OpCode::Log1P
        | OpCode::Abs
        | OpCode::Floor
        | OpCode::Ceil
        | OpCode::Round
        | OpCode::Trunc
        | OpCode::Fract
        | OpCode::Sign
        | OpCode::Erf
        | OpCode::Erfc
        | OpCode::Sinc
        | OpCode::Sigmoid
        | OpCode::Softplus
        | OpCode::Heaviside
        | OpCode::Neg => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::RegisterProgram;
    use crate::autodiff::Dual;
    use crate::equation_engine::{Bytecode, OpCode};

    fn shared_program() -> RegisterProgram {
        RegisterProgram::compile(&[
            Bytecode {
                ops: vec![
                    OpCode::LoadVar(0),
                    OpCode::LoadParam(0),
                    OpCode::Mul,
                    OpCode::LoadVar(1),
                    OpCode::Add,
                ],
            },
            Bytecode {
                ops: vec![
                    OpCode::LoadVar(0),
                    OpCode::LoadParam(0),
                    OpCode::Mul,
                    OpCode::LoadVar(1),
                    OpCode::Sub,
                ],
            },
        ])
    }

    #[test]
    fn shares_exact_subexpressions_between_equations() {
        let program = shared_program();
        assert_eq!(program.naive_instruction_count(), 10);
        assert_eq!(program.register_count(), 6);

        let mut registers = Vec::new();
        let mut out = [0.0, 0.0, 99.0];
        program.execute(&[3.0, 4.0], &[2.0], 0.0, &mut registers, &mut out);
        assert_eq!(out, [10.0, 2.0, 99.0]);
    }

    #[test]
    fn fused_program_preserves_dual_derivatives() {
        let program = shared_program();
        let mut registers = Vec::new();
        let mut out = [Dual::new(0.0, 0.0); 2];
        program.execute(
            &[Dual::new(3.0, 1.0), Dual::new(4.0, 0.0)],
            &[Dual::new(2.0, 0.0)],
            Dual::new(0.0, 0.0),
            &mut registers,
            &mut out,
        );
        assert_eq!(out[0], Dual::new(10.0, 2.0));
        assert_eq!(out[1], Dual::new(2.0, 2.0));
    }
}
