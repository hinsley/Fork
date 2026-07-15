# Expression language

Fork compiles system equations to a small stack-based bytecode language. The same compiler and
evaluator are used by the Rust core, WASM, the web system editor, the CLI, and scalar expressions
such as isoclines. Every operation below evaluates for both `f64` values and forward-mode `Dual`
numbers, so state Jacobians and parameter derivatives follow the same expression semantics.

## Syntax

- Numeric literals: `2`, `.5`, `1.`, `1e-3`, `2.5E+4`
- Declared variable and parameter names, including names that begin with `_`
- Built-in constants: `pi`, `tau` (equal to `2*pi`), and `e`
- Arithmetic: `+`, `-`, `*`, `/`, `^`
- Comparisons: `<`, `<=`, `>`, `>=`, `==`, `!=` (results are `0` or `1`)
- Parentheses for grouping and commas between function arguments
- Unary negation, for example `-x`

Function names are case-sensitive. Multiplication must be explicit: write `2*x`, not `2x`.
Declared variable and parameter names take precedence over built-in constants so existing systems
that use names such as `e` remain compatible. Chained comparisons such as `0 < x < 1` are rejected;
write nested `if()` calls or combine separate numeric comparisons explicitly.

In the web editor and system-string import, parameter values accept finite constant expressions
using numeric literals, `pi`, `tau`, `e`, arithmetic, powers, unary signs, and parentheses. For
example, `omega = tau / 4` is stored as the numeric value `pi/2`.

## Contextual time and iteration symbols

Flow equations may use undeclared `t` for the solver's live time. Map equations may use undeclared
`n` for the current integer iteration index. The symbols are contextual: undeclared `n` is an error
in a flow, and undeclared `t` is an error in a map. Resolution order is declared state variable,
declared parameter, applicable context symbol, then built-in constant, so an existing declared `t`
or `n` continues to shadow the contextual meaning.

Run Orbit accepts an initial `t0` or `n0`. Runge-Kutta stages evaluate `t` at their stage times;
maps evaluate `n` once per unit iteration and then increment it. Events and observables use the live
sample clock, including when the equations themselves have a frozen forcing context. Parameter
constant expressions remain context-free: `t` and `n` are invalid there.

Flow forcing-period declarations use the same context-free, parameter-only expression subset. They
may reference parameters and constants (for example `tau / omega`) but not state variables or
`t`/`n`. Unlike parameter constants, a forcing-period expression is reevaluated and differentiated
at every continuation trial and must remain finite and positive.

Lyapunov exponents and covariant Lyapunov vectors may be computed directly for a live
nonautonomous system. Their spectra describe the driven state dynamics and do not add the
artificial neutral direction that state augmentation by a phase variable would introduce.

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
| Special | `erf(x)`, `erfc(x)`, `sinc(x)` |
| Stable transforms | `sigmoid(x)`, `softplus(x)`, `logaddexp(x, y)` |

The operator `x^y` and the function `pow(x, y)` are equivalent. `log(x)` and `ln(x)` are the
natural logarithm; `log(x, base)` uses an explicit base. Stable near-zero forms are available as
`expm1(x)` and `log1p(x)`.

Fork defines `sinc(x) = sin(x)/x` with the continuous value `sinc(0) = 1`; a near-zero series
avoids cancellation. `sigmoid`, `softplus`, and `logaddexp` use branch-stable formulas that avoid
avoidable overflow for large positive or negative arguments. `erf` and `erfc` use complementary
value functions and analytic dual-number derivatives.

Compatibility aliases are accepted for `expm1` (`exp_m1`), `log1p` (`ln1p`, `ln_1p`), and `sign`
(`signum`).

Each function retains its real-valued domain. Invalid real inputs, such as `sqrt(-1)`, `log(0)`, or
`acosh(0.5)`, produce non-finite values that downstream solvers will reject.

## Piecewise functions

Fork also supports `abs(x)`, variadic `min(x, y, ...)` and `max(x, y, ...)`, `floor(x)`, `ceil(x)`,
`round(x)`, `trunc(x)`, `fract(x)`, `sign(x)`, `clamp(x, min, max)`, `heaviside(x)`, comparisons,
and `if(condition, then, else)`.

Comparisons produce dimensionless `0` or `1` values and have zero derivatives. `if()` treats zero
as false and a nonzero finite value as true, propagating the value and derivative of only the
selected branch. `heaviside(x)` is `0` below zero, `1` above zero, and uses the conventional value
`0.5` at zero with derivative zero. `clamp` propagates the active input or bound; reversed bounds
produce a non-finite value rather than panicking.

Their dual-number derivatives are the derivative of the active branch away from a corner, tie, or
jump. At a nondifferentiable point, no classical derivative exists, so the selected branch value is
only a computational convention. Systems that use these functions can be integrated, but
continuation, bifurcation detection, and normal-form calculations should not cross or land on their
nondifferentiable sets.

## Adding another function

Add an opcode and `ExpressionScalar` evaluation in `crates/fork_core/src/equation_engine.rs`, map
its name and arity in `resolve_fixed_function`, and add value plus numerical dual-derivative tests. Keep
the web reference in `web/src/system/expressionLanguage.ts` synchronized with the core signature
lists. Functions exposed through WASM must return compile errors rather than panic on an invalid
name or argument count.
