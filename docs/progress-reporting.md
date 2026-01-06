# Progress Reporting in Fork (CLI + WASM)

This document explains how progress reporting works for long-running
computations in the Fork CLI. It is maintained manually and is not
generated from code comments.

## Overview

Progress reporting is implemented as stepped runners in Rust/WASM and
thin progress helpers in the CLI. The core math engine stays unchanged
in algorithmic complexity; the CLI only receives small progress payloads
per batch.

Key ideas:
- Run computations in fixed-size batches.
- After each batch, emit a compact progress struct.
- The CLI renders progress bars without blocking computation.

## Data Flow

1. **Core runner** (Rust) exposes a step-based API.
2. **WASM bindings** wrap the runner and serialize progress payloads.
3. **CLI helpers** call `run_steps` in a loop and update the progress bar.

## Progress Payloads

These structs are serialized across WASM and drive the CLI progress bars:

- `crates/fork_core/src/continuation/types.rs` `StepResult`
  - Continuation progress: steps, points, bifurcations, parameter value.
- `crates/fork_wasm/src/lib.rs` `AnalysisProgress`
  - Analysis progress: current step and max steps.
- `crates/fork_wasm/src/lib.rs` `EquilibriumSolveProgress`
  - Solver progress: iterations, residual norm, max steps.

## Where Progress Is Reported

Continuation flows:
- Equilibrium continuation (new branches and extensions).
- Limit cycle continuation (including LC-from-Hopfs and orbit seeds).
- Codim-1 curve continuation (Fold, Hopf, LPC, PD, NS).

Analysis and solver flows:
- Lyapunov exponents.
- Covariant Lyapunov vectors (CLV).
- Equilibrium solver runs.

Other long-running operations:
- Orbit simulation in the CLI.
- Eigenvalue hydration for branch inspection.

Primary entry points in the CLI:
- `cli/src/continuation/progress.ts`
- `cli/src/progress.ts`
- `cli/src/index.ts` (orbit simulation)
- `cli/src/continuation/inspect.ts` (eigenvalue hydration)

## Batching and Performance Notes

Batch size is chosen to target a fixed number of UI updates (currently 50)
for the full run. This keeps progress responsive without adding a measurable
performance cost in the Rust core or in the WASM boundary.

The CLI progress helpers do not alter solver tolerances or step sizes. They
only control how often progress is requested.

## Extending Progress to New Computations

To add progress reporting for a new long-running computation:

1. Add a stepped runner in Rust/WASM that exposes:
   - `get_progress()` and `run_steps(batch_size)`.
2. Define a compact progress payload (serializable).
3. Add a CLI helper that:
   - Computes a batch size.
   - Loops `run_steps` until `done`.
   - Renders progress via `printProgress`.
4. Wire the helper into the CLI flow.

Keep payloads small and avoid per-step allocations in hot loops.
