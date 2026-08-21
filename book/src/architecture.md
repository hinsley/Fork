# Architecture

## Crate map

```
user equations ("y - 0.5*(v+0.5) - ...")
        │  parse + Compiler
        ▼
Bytecode ──► VM::execute_at::<T>          fork_core::equation_engine
                T = f64  │  Dual (forward AD)
                ▼
        EquationSystem  ── implements ──► DynamicalSystem<T>   traits.rs
                │
                │  borrowed by problem implementations
                ▼
   trait ContinuationProblem                    continuation/problem.rs
     residual · extended_jacobian · bordered solve · PALC metric
     diagnostics · event hooks · step acceptance · discretization transfer
                │
                │  implemented by
                ├─ EquilibriumContinuationProblem      (Dual-AD Jacobian)
                ├─ PeriodicOrbitCollocationProblem     (assembled Jacobian)
                ├─ Homoclinic/Heteroclinic (+ shooting variants)
                ├─ Fold/HopfCurveProblem               (equilibrium codim-1)
                └─ LPC/PD/NS/IsoperiodicCurveProblem   (cycle codim-1)
                ▼
   generic PALC engine                           continuation.rs
     continue_with_problem · ContinuationRunner (stepped) · extend_branch
                ▼
   ContinuationBranch (serde) ──► fork_wasm runners ──► web / cli
```

## The seam that matters

[`ContinuationProblem`](../api/fork_core/continuation/problem/trait.ContinuationProblem.html)
is the contract between "what bifurcation problem am I solving" and "how does
pseudo-arclength continuation work". The engine knows nothing about collocation
or shooting; the problems know nothing about step-size control. The trait's
default methods encode the numerical contracts — quadrature-weighted PALC
metrics, a-posteriori step acceptance, transactional reparameterization — so a
new problem inherits correct behavior by overriding only what is genuinely
different.

## Module responsibilities

| Module | Responsibility |
|---|---|
| `equation_engine` | Expression parser, compiler, stack VM; `EquationSystem` with f64 and Dual evaluation, value+Jacobian in one pass. |
| `solvers` | RK4, Tsitouras 5/4, discrete-map steppers with workspace reuse. |
| `autodiff` | Forward-mode `Dual` numbers implementing `Float`. |
| `equilibrium` | Newton solves, deflation, eigenpairs of equilibria and map cycles. |
| `continuation` | PALC engine, problem trait, periodic collocation, Floquet machinery, codim-1/codim-2 curves, connection orbits, invariant manifolds. |
| `analysis` / `expansion_entropy` / `transfer_*` | Lyapunov/CLV analysis, entropy estimation, transfer operators and their eigenmodes. |
| `isocline`, `event_series`, `forced_response`, `state_periodicity` | Supporting analyses shared by CLI and web. |

## API generations

The repository is migrating from direct functions on `EquationSystem` (with
`SystemKind` tags) toward the problem-trait engine. **The trait-engine path is
canonical.** New work targets `ContinuationProblem` implementations and the
generic drivers; legacy one-shot entry points remain for the applications that
have not migrated and are progressively being retired. When the two disagree,
the trait path and its tests define correct behavior.

## Where the time goes

For orientation when profiling (numbers from the MLfast ntst=20 reference
workload): equilibrium continuation is microseconds per step; limit-cycle
collocation continuation is ~1 ms per step with the structured solver; the
expensive workflows are the codim-1 curve problems, whose cost concentrates in
Jacobian assembly and the bordered factorizations inside singularity
conditions. The LPC curve's Jacobian is now assembled by a bordered adjoint
identity; PD, NS, and isoperiodic curves still differentiate residuals
numerically (tracked as Fork-5x7p). See [Numerical
Contracts](numerical-contracts.md) for the rules optimization work must obey.
