use crate::{
    equation_engine::{EquationSystem, OpCode},
    traits::DynamicalSystem,
};
use thiserror::Error;

/// Invalid structure-of-arrays buffers supplied to a batch evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BatchEvaluationError {
    #[error("batch state buffer has length {actual}; expected {expected} ({dimension} variables x {batch_len} samples)")]
    StateLength {
        expected: usize,
        actual: usize,
        dimension: usize,
        batch_len: usize,
    },
    #[error("batch output buffer has length {actual}; expected {expected} ({dimension} equations x {batch_len} samples)")]
    OutputLength {
        expected: usize,
        actual: usize,
        dimension: usize,
        batch_len: usize,
    },
    #[error("batch dimensions overflow usize: {dimension} x {batch_len}")]
    DimensionOverflow { dimension: usize, batch_len: usize },
}

impl EquationSystem {
    /// Evaluates this system for independent states stored in structure-of-arrays order.
    ///
    /// For a system with `dimension` variables and `batch_len` samples, `states`
    /// and `out` must both contain `dimension * batch_len` values. The state for
    /// variable `variable` and sample `sample` is at
    /// `states[variable * batch_len + sample]`; outputs use the same layout.
    /// All samples receive the same flow-time or map-iteration `context`.
    ///
    /// Algebraic bytecode is evaluated two samples at a time with WASM SIMD128
    /// on `wasm32`. Systems containing any other operation automatically use
    /// the ordinary scalar VM, so this method supports the complete expression
    /// language without changing its numerical semantics.
    pub fn apply_batch_soa(
        &self,
        context: f64,
        batch_len: usize,
        states: &[f64],
        out: &mut [f64],
    ) -> Result<(), BatchEvaluationError> {
        let dimension = self.equations().len();
        let expected =
            dimension
                .checked_mul(batch_len)
                .ok_or(BatchEvaluationError::DimensionOverflow {
                    dimension,
                    batch_len,
                })?;
        if states.len() != expected {
            return Err(BatchEvaluationError::StateLength {
                expected,
                actual: states.len(),
                dimension,
                batch_len,
            });
        }
        if out.len() != expected {
            return Err(BatchEvaluationError::OutputLength {
                expected,
                actual: out.len(),
                dimension,
                batch_len,
            });
        }
        if batch_len == 0 || dimension == 0 {
            return Ok(());
        }
        if batch_len == 1 {
            // SoA and ordinary contiguous state layout coincide for one sample.
            self.apply(context, states, out);
            return Ok(());
        }

        #[cfg(target_arch = "wasm32")]
        if self.is_batch_simd_compatible() {
            // SAFETY: WebAssembly validates SIMD128 support when instantiating
            // the module. Buffer sizes and opcode compatibility were checked
            // above, and the SIMD routine handles an odd final sample itself.
            unsafe {
                apply_simd_batch(self, context, batch_len, states, out);
            }
            return Ok(());
        }

        apply_scalar_batch(self, context, batch_len, states, out);
        Ok(())
    }

    /// Whether every equation can use the algebraic SIMD batch interpreter.
    ///
    /// This reports bytecode compatibility independently of the compilation
    /// target. SIMD is currently selected only for `wasm32` builds.
    pub fn is_batch_simd_compatible(&self) -> bool {
        self.equations().iter().all(|equation| {
            equation.ops.iter().all(|operation| {
                matches!(
                    operation,
                    OpCode::LoadConst(_)
                        | OpCode::LoadVar(_)
                        | OpCode::LoadParam(_)
                        | OpCode::LoadContext
                        | OpCode::Add
                        | OpCode::Sub
                        | OpCode::Mul
                        | OpCode::Div
                        | OpCode::Square
                        | OpCode::Cube
                        | OpCode::PowI(_)
                        | OpCode::Neg
                )
            })
        })
    }

    /// Whether this build will select SIMD128 for this system's batch evaluation.
    pub fn supports_simd_batch(&self) -> bool {
        cfg!(target_arch = "wasm32") && self.is_batch_simd_compatible()
    }
}

fn apply_scalar_batch(
    system: &EquationSystem,
    context: f64,
    batch_len: usize,
    states: &[f64],
    out: &mut [f64],
) {
    apply_scalar_batch_range(system, context, batch_len, states, out, 0);
}

fn apply_scalar_batch_range(
    system: &EquationSystem,
    context: f64,
    batch_len: usize,
    states: &[f64],
    out: &mut [f64],
    first_sample: usize,
) {
    let dimension = system.equations().len();
    let mut state = vec![0.0; dimension];
    let mut values = vec![0.0; dimension];

    for sample in first_sample..batch_len {
        for variable in 0..dimension {
            state[variable] = states[variable * batch_len + sample];
        }
        system.apply(context, &state, &mut values);
        for (equation_index, &value) in values.iter().enumerate() {
            out[equation_index * batch_len + sample] = value;
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
unsafe fn apply_simd_batch(
    system: &EquationSystem,
    context: f64,
    batch_len: usize,
    states: &[f64],
    out: &mut [f64],
) {
    use core::arch::wasm32::{
        f64x2_add, f64x2_div, f64x2_extract_lane, f64x2_mul, f64x2_neg, f64x2_splat, f64x2_sub,
        v128, v128_load, v128_store,
    };

    let stack_capacity = system
        .equations()
        .iter()
        .map(|equation| equation.ops.len())
        .max()
        .unwrap_or(0);
    let mut stack: Vec<v128> = Vec::with_capacity(stack_capacity);

    for (equation_index, equation) in system.equations().iter().enumerate() {
        let output_base = equation_index * batch_len;
        for sample in (0..batch_len).step_by(2) {
            let has_second_lane = sample + 1 < batch_len;
            stack.clear();
            for operation in &equation.ops {
                match operation {
                    OpCode::LoadConst(value) => stack.push(f64x2_splat(*value)),
                    OpCode::LoadVar(variable) => {
                        let offset = variable * batch_len + sample;
                        let values = if has_second_lane {
                            // SAFETY: layout validation guarantees two values
                            // remain in this variable's SoA block.
                            v128_load(states.as_ptr().add(offset).cast::<v128>())
                        } else {
                            // Duplicate an odd final sample instead of dropping
                            // into a separately allocated scalar workspace.
                            f64x2_splat(states[offset])
                        };
                        stack.push(values);
                    }
                    OpCode::LoadParam(parameter) => {
                        stack.push(f64x2_splat(system.params[*parameter]));
                    }
                    OpCode::LoadContext => stack.push(f64x2_splat(context)),
                    OpCode::Add => {
                        let right = stack.pop().expect("valid compiled bytecode");
                        let left = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_add(left, right));
                    }
                    OpCode::Sub => {
                        let right = stack.pop().expect("valid compiled bytecode");
                        let left = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_sub(left, right));
                    }
                    OpCode::Mul => {
                        let right = stack.pop().expect("valid compiled bytecode");
                        let left = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_mul(left, right));
                    }
                    OpCode::Div => {
                        let right = stack.pop().expect("valid compiled bytecode");
                        let left = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_div(left, right));
                    }
                    OpCode::Square => {
                        let value = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_mul(value, value));
                    }
                    OpCode::Cube => {
                        let value = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_mul(f64x2_mul(value, value), value));
                    }
                    OpCode::PowI(exponent) => {
                        let value = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_powi(value, *exponent));
                    }
                    OpCode::Neg => {
                        let value = stack.pop().expect("valid compiled bytecode");
                        stack.push(f64x2_neg(value));
                    }
                    _ => unreachable!("SIMD compatibility is checked before evaluation"),
                }
            }
            let result = stack.pop().unwrap_or_else(|| f64x2_splat(0.0));
            if has_second_lane {
                // SAFETY: output layout validation guarantees space for both
                // lanes in this equation's SoA output block.
                v128_store(
                    out.as_mut_ptr().add(output_base + sample).cast::<v128>(),
                    result,
                );
            } else {
                out[output_base + sample] = f64x2_extract_lane::<0>(result);
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[inline]
fn f64x2_powi(base: core::arch::wasm32::v128, exponent: i32) -> core::arch::wasm32::v128 {
    use core::arch::wasm32::{f64x2_extract_lane, f64x2_replace_lane, f64x2_splat};

    // WASM has no lane-wise integer-power instruction. Keep surrounding
    // algebra vectorized while using Rust's scalar powi implementation in each
    // lane, preserving ordinary EquationSystem rounding and edge behavior.
    let lane_0 = f64x2_extract_lane::<0>(base).powi(exponent);
    let lane_1 = f64x2_extract_lane::<1>(base).powi(exponent);
    f64x2_replace_lane::<1>(f64x2_splat(lane_0), lane_1)
}

#[cfg(test)]
mod tests {
    use super::{BatchEvaluationError, EquationSystem};
    use crate::equation_engine::{parse, Bytecode, Compiler, ExpressionContext, OpCode};

    fn system(equations: &[&str], parameters: Vec<f64>, with_time: bool) -> EquationSystem {
        let variables = ["x".to_string(), "y".to_string()];
        let parameter_names = ["a".to_string()];
        let context = if with_time {
            ExpressionContext::FlowTime
        } else {
            ExpressionContext::None
        };
        let compiler = Compiler::new_with_context(&variables, &parameter_names, context);
        let bytecode = equations
            .iter()
            .map(|source| compiler.compile(&parse(source).expect("parse batch equation")))
            .collect();
        EquationSystem::new(bytecode, parameters)
    }

    #[test]
    fn batch_soa_matches_individual_algebraic_evaluations() {
        let system = system(&["x + a*y + t", "x*y - a"], vec![0.25], true);
        let batch_len = 3;
        // SoA: all x values, followed by all y values.
        let states = [1.0, -2.0, 4.0, 0.5, 3.0, -1.0];
        let mut actual = [f64::NAN; 6];

        system
            .apply_batch_soa(2.0, batch_len, &states, &mut actual)
            .expect("valid batch");

        let expected = [3.125, 0.75, 5.75, 0.25, -6.25, -4.25];
        assert_eq!(actual, expected);
        assert!(system.is_batch_simd_compatible());
        assert_eq!(system.supports_simd_batch(), cfg!(target_arch = "wasm32"));
    }

    #[test]
    fn unsupported_operations_use_the_scalar_fallback() {
        let system = system(&["sin(x) + y^2", "cos(y) / (1 + x*x)"], vec![0.0], false);
        let batch_len = 3;
        let states: [f64; 6] = [0.1, -0.4, 1.2, 0.2, 0.8, -0.7];
        let mut actual = [f64::NAN; 6];

        system
            .apply_batch_soa(0.0, batch_len, &states, &mut actual)
            .expect("valid batch");

        for sample in 0..batch_len {
            let x = states[sample];
            let y = states[batch_len + sample];
            let expected = [x.sin() + y.powf(2.0), y.cos() / (1.0 + x * x)];
            assert_eq!(actual[sample], expected[0]);
            assert_eq!(actual[batch_len + sample], expected[1]);
        }
        assert!(!system.is_batch_simd_compatible());
    }

    #[test]
    fn specialized_integer_powers_are_simd_compatible() {
        use OpCode::{Cube, LoadVar, PowI, Square};

        let system = EquationSystem::new(
            vec![
                Bytecode {
                    ops: vec![LoadVar(0), Square],
                },
                Bytecode {
                    ops: vec![LoadVar(1), Cube],
                },
                Bytecode {
                    ops: vec![LoadVar(2), PowI(-3)],
                },
            ],
            Vec::new(),
        );
        let states = [2.0, -3.0, 0.5, -2.0, 4.0, -0.5];
        let mut actual = [f64::NAN; 6];

        system
            .apply_batch_soa(0.0, 2, &states, &mut actual)
            .expect("valid specialized-power batch");

        assert_eq!(actual, [4.0, 9.0, 0.125, -8.0, 0.015625, -8.0]);
        assert!(system.is_batch_simd_compatible());
    }

    #[test]
    fn validates_both_soa_buffer_lengths() {
        let system = system(&["x", "y"], vec![0.0], false);
        let mut output = [0.0; 6];

        assert_eq!(
            system.apply_batch_soa(0.0, 3, &[0.0; 5], &mut output),
            Err(BatchEvaluationError::StateLength {
                expected: 6,
                actual: 5,
                dimension: 2,
                batch_len: 3,
            })
        );
        assert_eq!(
            system.apply_batch_soa(0.0, 3, &[0.0; 6], &mut output[..5]),
            Err(BatchEvaluationError::OutputLength {
                expected: 6,
                actual: 5,
                dimension: 2,
                batch_len: 3,
            })
        );
    }

    #[test]
    fn accepts_an_empty_batch() {
        let system = system(&["x + y", "x - y"], vec![0.0], false);
        assert_eq!(system.apply_batch_soa(1.0, 0, &[], &mut []), Ok(()));
    }

    #[test]
    fn evaluates_a_single_sample_without_relayout() {
        let system = system(&["sin(x) + t", "y^2 - a"], vec![0.25], true);
        let mut actual = [f64::NAN; 2];
        system
            .apply_batch_soa(0.75, 1, &[0.0, -2.0], &mut actual)
            .expect("valid single-sample batch");
        assert_eq!(actual, [0.75, 3.75]);
    }

    #[test]
    fn rejects_overflowing_batch_dimensions_before_accessing_buffers() {
        let system = system(&["x", "y"], vec![0.0], false);
        assert_eq!(
            system.apply_batch_soa(0.0, usize::MAX, &[], &mut []),
            Err(BatchEvaluationError::DimensionOverflow {
                dimension: 2,
                batch_len: usize::MAX,
            })
        );
    }
}
