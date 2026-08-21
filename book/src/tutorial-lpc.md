# From Equilibrium to an LPC Curve

This tutorial drives a complete bifurcation-analysis workflow from Rust code,
following the same path as Fork's published-reference tests. Everything shown
is real and runs:

```sh
cargo run --release -p fork_core --example lpc_walkthrough
```

The system is MLfast, a two-dimensional slow-fast neuron model. In one
parameter it has a stable limit cycle that dies in a **fold of cycles** (an LPC)
near $y = 0.08457$. We will find that fold, then continue it as a curve in the
$(y, z)$ parameter plane.

## 1. Describe the system

Equations are strings; variables and parameters get names and indices through
the compiler. The result is an [`EquationSystem`] that evaluates both as `f64`
and as forward-AD dual numbers — which is where every Jacobian comes from.

```rust
{{#include ../../crates/fork_core/examples/lpc_walkthrough.rs:system}}
```

## 2. Find the attractor

A limit cycle cannot be written down; it has to be found. Integrate to the
attractor and record one trajectory:

```rust
{{#include ../../crates/fork_core/examples/lpc_walkthrough.rs:orbit}}
```

## 3. Seed a collocated limit cycle

`limit_cycle_setup_from_orbit` resamples the recorded orbit onto a Gauss
collocation mesh (here `ntst = 20` intervals, degree `ncol = 4`) and produces a
setup whose guess can be corrected into a genuine periodic-orbit solution of
the collocated boundary value problem.

## 4. Continue until something happens

Continuation walks the cycle through parameter `y`. Somewhere along the branch
a Floquet multiplier crosses the unit circle at $+1$ — the engine detects this
and tags the point `CycleFold`:

```rust
{{#include ../../crates/fork_core/examples/lpc_walkthrough.rs:continue-lc}}
```

Running this prints `LPC at y = 0.08456948`, matching the published value to
eight digits.

## 5. Continue the fold itself

An LPC point is not a dead end: it is the seed of a *curve* in two parameters.
Re-expressing the cycle in the curve problem's layout and wrapping it in the
fold-of-cycles defining system gives a new continuation problem — which the
same PALC engine then drives, now in $(y, z)$ simultaneously:

```rust
{{#include ../../crates/fork_core/examples/lpc_walkthrough.rs:curve}}
```

Note what did *not* change: the engine, the settings shape, the point and
branch types. The defining system changed, and [`LPCCurveProblem`] implements
the same trait as every other problem in the crate.

## Where to go from here

- The codim-1 machinery generalizes: `PDCurveProblem`, `NSCurveProblem`, and
  `IsoperiodicCurveProblem` continue period-doubling, Neimark-Sacker, and
  isoperiodic curves of cycles; `FoldCurveProblem` and `HopfCurveProblem`
  do the same for equilibria.
- Codim-2 points found on these curves refine through
  `refine_codim2_points` and carry normal-form coefficients.
- For the numerical rules any of this work must respect, read
  [Numerical Contracts](numerical-contracts.md) before optimizing anything.

[`EquationSystem`]: ../api/fork_core/equation_engine/struct.EquationSystem.html
[`LPCCurveProblem`]: ../api/fork_core/continuation/struct.LPCCurveProblem.html
