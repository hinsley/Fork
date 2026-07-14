# Expression language

Fork compiles system equations to a small stack-based bytecode language. The same compiler and
evaluator are used by the Rust core, WASM, the web system editor, the CLI, and scalar expressions
such as isoclines. Every operation below evaluates for both `f64` values and forward-mode `Dual`
numbers, so state Jacobians and parameter derivatives follow the same expression semantics.

## Syntax

- Numeric literals: `2`, `.5`, `1.`, `1e-3`, `2.5E+4`
- Declared variable and parameter names, including names that begin with `_`
- Arithmetic: `+`, `-`, `*`, `/`, `^`
- Parentheses for grouping and commas between function arguments
- Unary negation, for example `-x`

Function names are case-sensitive. Multiplication must be explicit: write `2*x`, not `2x`.
Expressions may only refer to declared variables and parameters; mathematical constants such as
pi must currently be declared as parameters or entered numerically.

## Differentiable functions

| Family | Signatures |
| --- | --- |
| Trigonometric | `sin(x)`, `cos(x)`, `tan(x)`, `sec(x)`, `csc(x)`, `cot(x)` |
| Inverse trigonometric | `asin(x)`, `acos(x)`, `atan(x)`, `atan2(y, x)` |
| Hyperbolic | `sinh(x)`, `cosh(x)`, `tanh(x)`, `sech(x)`, `csch(x)`, `coth(x)` |
| Inverse hyperbolic | `asinh(x)`, `acosh(x)`, `atanh(x)` |
| Exponential | `exp(x)`, `exp2(x)`, `expm1(x)` |
| Logarithmic | `ln(x)`, `log(x)`, `log(x, base)`, `log2(x)`, `log10(x)`, `log1p(x)` |
| Algebraic | `sqrt(x)`, `cbrt(x)`, `pow(x, y)`, `hypot(x, y)` |

The operator `x^y` and the function `pow(x, y)` are equivalent. `log(x)` and `ln(x)` are the
natural logarithm; `log(x, base)` uses an explicit base. Stable near-zero forms are available as
`expm1(x)` and `log1p(x)`.

Compatibility aliases are accepted for `expm1` (`exp_m1`), `log1p` (`ln1p`, `ln_1p`), and `sign`
(`signum`).

Each function retains its real-valued domain. Invalid real inputs, such as `sqrt(-1)`, `log(0)`, or
`acosh(0.5)`, produce non-finite values that downstream solvers will reject.

## Piecewise functions

Fork also supports `abs(x)`, variadic `min(x, y, ...)` and `max(x, y, ...)`, `floor(x)`, `ceil(x)`,
`round(x)`, `trunc(x)`, `fract(x)`, and `sign(x)`.

Their dual-number derivatives are the derivative of the active branch away from a corner, tie, or
jump. At a nondifferentiable point, no classical derivative exists, so the selected branch value is
only a computational convention. Systems that use these functions can be integrated, but
continuation, bifurcation detection, and normal-form calculations should not cross or land on their
nondifferentiable sets.

## Adding another function

Add an opcode and generic `Scalar` evaluation in `crates/fork_core/src/equation_engine.rs`, map its
name and arity in `resolve_fixed_function`, and add value plus numerical dual-derivative tests. Keep
the web reference in `web/src/system/expressionLanguage.ts` synchronized with the core signature
lists. Functions exposed through WASM must return compile errors rather than panic on an invalid
name or argument count.
