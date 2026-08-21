# Introduction

Fork performs continuation and bifurcation analysis of dynamical systems whose
vector fields are written by the user as ordinary expressions. Given equations
like

$$
\dot v = y - \tfrac{1}{2}(v + \tfrac{1}{2}) - 2 w (v + \tfrac{7}{10})
         - \tfrac{1}{2}\left(1 + \tanh\tfrac{v + 0.01}{0.15}\right)(v - 1),
$$

Fork compiles them to bytecode, integrates them, locates equilibria and
periodic orbits, and continues them through parameter space — tracing
bifurcation curves of codimension one and two, invariant manifolds of
equilibria and cycles, and homoclinic and heteroclinic connections.

## What is in the repository

| Piece | Path | Role |
|---|---|---|
| `fork_core` | `crates/fork_core` | The engine: equation compiler and VM, integrators, collocation, continuation, manifolds, spectral analysis. Pure Rust, no platform LAPACK. |
| `fork_wasm` | `crates/fork_wasm` | Browser bindings over the engine: stepped runners with progress reporting, serde-wasm-bindgen serialization, an opt-in thread pool. |
| CLI | `cli/` | Interactive TypeScript/Node application driving the NodeJS bindings. |
| Web | `web/` | Vite + React frontend driving the browser bindings. |

The engine and the applications are deliberately separate. The numerics never
touch JavaScript; the applications never implement numerics.

## Why it looks like this

Three constraints shaped the design and are worth knowing before reading
further:

1. **One algorithm set everywhere.** Native and browser builds share the same
   pure-Rust linear algebra. There is no platform LAPACK and no
   platform-specific numerics.
2. **The continuation engine is generic over *problems*, not systems.** A
   single pseudo-arclength driver serves equilibria, periodic orbits,
   connection orbits, and their bifurcation curves through one trait,
   [`ContinuationProblem`](../api/fork_core/continuation/problem/trait.ContinuationProblem.html).
3. **Numerical contracts are explicit.** Decisions that would otherwise be
   folklore — why Floquet spectra never come from monodromy products, why mesh
   identity is load-bearing across serialization — are recorded in
   [Numerical Contracts](numerical-contracts.md) and in the repository's
   `docs/DECISIONS.md`.

## Reading paths

- *I want to run things.* [Getting Started](getting-started.md), then the
  application you prefer.
- *I want to understand the machinery.* [Architecture](architecture.md).
- *I want to drive continuation from code.* [From Equilibrium to an LPC
  Curve](tutorial-lpc.md), which walks the exact path the published-reference
  tests take.
- *I am about to change numerics.* [Numerical Contracts](numerical-contracts.md)
  first.
