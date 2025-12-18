# Fork Core Architecture

This document describes the architecture of the `fork_core` crate, which provides the core numerical algorithms for dynamical systems analysis.

## Module Overview

```
fork_core/
├── lib.rs                  # Crate root, exports public API
├── equation_engine.rs      # Bytecode VM for evaluating equations
├── autodiff.rs             # Automatic differentiation (dual numbers)
├── equilibrium.rs          # Equilibrium solving (Newton-Raphson)
├── solvers.rs              # ODE integrators (RK4, etc.)
├── traits.rs               # Core traits (DynamicalSystem)
├── analysis.rs             # Analysis utilities
└── continuation/           # Continuation analysis module
    ├── types.rs            # Core data structures
    ├── problem.rs          # ContinuationProblem trait
    ├── equilibrium.rs      # Equilibrium continuation
    └── periodic.rs         # Limit cycle (collocation) continuation
```

## Core Concepts

### Equation Engine

The `EquationSystem` struct represents a dynamical system using a stack-based bytecode interpreter. This allows systems to be defined at runtime (e.g., from user input in the CLI).

```rust
// Bytecode opcodes
enum OpCode {
    LoadVar(usize),    // Push variable x[i]
    LoadParam(usize),  // Push parameter p[i]
    LoadConst(f64),    // Push constant
    Add, Sub, Mul, Div, // Arithmetic
    Sin, Cos, Exp, ...  // Functions
}
```

### Continuation Types

Key data structures (in `continuation/types.rs`):

| Type | Description |
|------|-------------|
| `ContinuationSettings` | Algorithm parameters (step size, tolerances) |
| `ContinuationPoint` | Single point on a branch (state, param, stability) |
| `ContinuationBranch` | Complete branch with points and bifurcations |
| `BifurcationType` | Classification (None, Fold, Hopf, etc.) |

### ContinuationProblem Trait

The `ContinuationProblem` trait (in `continuation/problem.rs`) abstracts over different problem types:

```rust
pub trait ContinuationProblem {
    fn dimension(&self) -> usize;
    fn residual(&mut self, aug_state: &DVector<f64>, out: &mut DVector<f64>) -> Result<()>;
    fn extended_jacobian(&mut self, aug_state: &DVector<f64>) -> Result<DMatrix<f64>>;
    fn diagnostics(&mut self, aug_state: &DVector<f64>) -> Result<PointDiagnostics>;
}
```

**Implementations:**
- `EquilibriumProblem` - For equilibrium continuation
- `LimitCycleProblem` - For limit cycle continuation via collocation

## Key Algorithms

### Pseudo-Arclength Continuation (PALC)

Located in `continuation.rs`, functions:
- `continue_with_problem()` - Start continuation from initial point
- `extend_branch_with_problem()` - Extend existing branch
- `correct_with_problem()` - Newton corrector with Moore-Penrose bordering

### Bifurcation Detection

Test functions for detecting bifurcations:
- **Fold**: Determinant of Jacobian crosses zero
- **Hopf**: ∏(λᵢ + λⱼ) = 0 (eigenvalue sum product)
- **Neutral Saddle**: Real eigenvalue sum crosses zero

### Limit Cycle Collocation

In `continuation/periodic.rs`:
- Orthogonal collocation with Gauss-Legendre points
- Phase condition: ∫ ⟨u̇ᵒˡᵈ, u - uᵒˡᵈ⟩ dt = 0
- Floquet multipliers from monodromy matrix

## Extending Fork Core

### Adding a New Bifurcation Type

1. Add variant to `BifurcationType` in `types.rs`
2. Add test function field to `TestFunctionValues` in `problem.rs`
3. Implement detection logic in continuation functions

### Adding a New Continuation Problem Type

1. Create new file in `continuation/`
2. Implement `ContinuationProblem` trait
3. Use `continue_with_problem()` for continuation

### Adding Tests

Tests are in `#[cfg(test)] mod tests` blocks. Example:

```rust
#[test]
fn test_hopf_normal_form() {
    // Create system: dx/dt = μx - y, dy/dt = x + μy
    // Verify Hopf bifurcation detected at μ = 0
}
```

Run tests: `cargo test -p fork_core`

## WASM Bridge

The `fork_wasm` crate wraps `fork_core` for web/CLI use:

```
fork_wasm/
└── lib.rs   # #[wasm_bindgen] exports
```

Functions are exposed to JavaScript/TypeScript via `wasm-bindgen`.
