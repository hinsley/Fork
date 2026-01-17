# Progress Reporting in Fork (CLI + Web + WASM)

This document explains how progress reporting works for long-running
computations in the Fork CLI and web UI. It is maintained manually and is not
generated from code comments.
Note: This document has not been fully human-reviewed; treat it as guidance and verify against current behavior.

## Overview

Progress reporting is implemented as stepped runners in Rust/WASM and
thin progress helpers in the CLI and web worker. The core math engine
stays unchanged in algorithmic complexity; the UI only receives small
progress payloads per batch.

Key ideas:
- Run computations in fixed-size batches.
- After each batch, emit a compact progress struct.
- The CLI and web UI render progress bars without blocking computation.

## Data Flow

1. **Core runner** (Rust) exposes a step-based API.
2. **WASM bindings** wrap the runner and serialize progress payloads.
3. **CLI helpers** call `run_steps` in a loop and update the progress bar.
4. **Web worker** runs the same stepped loop, posts progress messages, and the
   UI renders them in the toolbar.

## Progress Payloads

These structs are serialized across WASM and drive the CLI/web progress bars:

- `crates/fork_core/src/continuation/types.rs` `StepResult`
  - Continuation progress: steps, points, bifurcations, parameter value.
- `crates/fork_wasm/src/analysis.rs` `AnalysisProgress`
  - Analysis progress: current step and max steps.
- `crates/fork_wasm/src/equilibrium.rs` `EquilibriumSolveProgress`
  - Solver progress: iterations, residual norm, max steps.
- `cli/src/types.ts` `ContinuationProgress`
  - TypeScript view of `StepResult` for the CLI.
- `web/src/compute/ForkCoreClient.ts` `ContinuationProgress`
  - TypeScript view of `StepResult` for the web worker.

## Where Progress Is Reported

Continuation flows (CLI + web toolbar):
- Equilibrium continuation (new branches and extensions).
- Limit cycle continuation (including LC-from-Hopfs and orbit seeds).
- Codim-1 curve continuation (Fold, Hopf, LPC, PD, NS).

Analysis and solver flows (CLI only today):
- Lyapunov exponents.
- Covariant Lyapunov vectors (CLV).
- Equilibrium solver runs.

Other long-running operations (CLI only today):
- Orbit simulation in the CLI.
- Eigenvalue hydration for branch inspection.

Primary entry points in the CLI:
- `cli/src/continuation/progress.ts`
- `cli/src/progress.ts`
- `cli/src/index.ts` (orbit simulation)
- `cli/src/continuation/inspect.ts` (eigenvalue hydration)

Primary entry points in the web app:
- `web/src/compute/worker/forkCoreWorker.ts` (stepped runners + progress posts)
- `web/src/compute/wasmClient.ts` (progress callbacks)
- `web/src/state/appState.tsx` (progress state)
- `web/src/ui/Toolbar.tsx` (progress rendering)

## Batching and Performance Notes

Batch size is chosen to target a fixed number of UI updates (currently 50)
for the full run in both the CLI and web worker. This keeps progress responsive
without adding a measurable performance cost in the Rust core or in the WASM
boundary.

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
5. For the web, post progress from the worker and surface it in `appState`
   (toolbar progress uses `ContinuationProgress`).

Keep payloads small and avoid per-step allocations in hot loops.
