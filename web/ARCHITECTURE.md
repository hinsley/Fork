# Fork Architecture (v0)

This document captures the initial web UI architecture for Fork, based on the
existing CLI surface area and the Rust/WASM core.

## Repo Inspection Notes (CLI + Core)

### How the CLI calls Fork Core today
- The CLI is TypeScript/Node and loads WASM bindings from
  `crates/fork_wasm/pkg/fork_wasm.js` (built via `wasm-pack build --target nodejs`).
- `cli/src/wasm.ts` wraps the exported WASM classes and runners:
  - `WasmSystem` for stepping systems and computing Jacobians.
  - Runner-style APIs for continuation, equilibrium solver, and Lyapunov/CLV.
  - Continuation and analysis run in batches via `run_steps()` with progress polling.
- No IPC layer is used; the CLI calls into WASM directly in-process.

### CLI surface area (parity target)
- Systems:
  - Create, edit, duplicate, delete.
  - Stored under `cli/data/systems/<system>/system.json`.
- Objects:
  - Orbit objects: simulate trajectories, extend, inspect, Oseledets solver
    (Lyapunov exponents + covariant vectors), create limit cycle object from orbit.
  - Equilibrium objects: solve equilibrium, inspect data, create branches.
  - Limit cycle objects: inspect state, create branches.
  - Stored under `cli/data/systems/<system>/objects/<object>.json`.
- Branches (continuation):
  - Stored under `cli/data/systems/<system>/objects/<object>/branches/<branch>.json`.
  - Branch actions: inspect, extend, rename, delete.
  - Branch viewer:
    - Summary page with start, end, bifurcation points.
    - Point browser with pagination and jump-to-index.
    - Point detail view includes parameters, eigenvalues/Floquet multipliers,
      LC metrics, stability, and context-specific actions.
    - Actions from points: create new EQ/LC branches, initiate LC from Hopf,
      continue codim-1 curves (fold, hopf, lpc, pd, ns).

## Web Stack (minimal, consistent with repo)
- Bundler: Vite (existing).
- Language: TypeScript + React (existing).
- Graphics: Plotly.js for all 2D/3D rendering (initially).
- Tests:
  - Unit + component: Vitest + Testing Library + jsdom.
  - E2E: Playwright.
- Package manager: npm (package-lock present in repo).

## Module Boundaries

### UI State
- `src/state/`: app store, actions, reducers/selectors, derived UI state
  (selection, panel layout, viewport settings).
- `src/state/actions/`: command layer that calls `ForkCoreClient` and updates
  system state.

### System Model + Persistence
- `src/system/`: system schema, object tree ops, branch ops, migrations.
- `src/system/opfs.ts`: OPFS persistence helpers, import/export bundling; Chromium-only File System
  Access API, so Safari/Firefox require a feature-detected IndexedDB fallback (memory if needed).
- `src/system/indexedDb.ts`: IndexedDB persistence fallback for non-Chromium browsers.
- `src/system/storeFactory.ts`: runtime store selection across OPFS, IndexedDB, and memory.
- `src/system/fixtures.ts`: deterministic fixtures for tests.

### WASM Bridge + Compute
- `src/compute/`:
  - `ForkCoreClient` interface (mockable).
  - `WasmForkCoreClient` implementation (loads WASM and runs jobs).
  - Job queue with cancellation and timing instrumentation.
- `src/compute/worker/`: Web Worker entry for running WASM off the main thread.
- Web builds target `wasm-pack build --target web --out-dir pkg-web` so the
  worker can import `crates/fork_wasm/pkg-web/fork_wasm.js`. The `pkg-web/`
  output is generated during local setup or CI builds when core bindings
  change. The CLI still uses `pkg/` from the nodejs target.

### Plotly Viewports / Scenes
- `src/viewports/plotly/`:
  - `PlotlyViewport` component.
  - Plotly scene adapter (camera, axes, selection linking).
  - Render mapping from objects/branches to Plotly traces.

### Panels + Layout
- `src/ui/`:
  - DCC-style panel layout (split panes, collapsible panels).
  - Objects tree, Inspector panel, Branch Viewer panel.
  - Toolbar/statusbar and performance overlay.

## Data Model (Web)

### System
- `System` mirrors a CLI system, with web-only UI metadata:
  - `id`, `name`
  - `config`: `SystemConfig` (equations, params, var/param names, solver, type)
  - `objects`: dictionary of `ObjectNode` (hierarchical)
  - `branches`: dictionary of `ContinuationObject` (branch data + metadata)
  - `scenes`: list of `Scene` (Plotly viewport configs + camera)
  - `ui`: layout/panel state, selections, view settings

### Object Tree
- `ObjectNode` represents a tree node:
  - `id`, `name`, `type` (orbit, equilibrium, limit_cycle, branch, scene, camera)
  - `children`: node ids
  - `visibility`, `locked`, `renderProps` (color, size, style)
  - `dataRef`: pointer to object/branch data

### Branches
- `ContinuationObject` and related types track branch data, indices, bifurcations.
- Branch nodes appear under their parent object in the tree.

### Scenes
- `Scene` stores viewport config:
  - camera, axes, trace visibility, selection links, and layout preferences.

## Concurrency Plan (No UI Freezes)
- All WASM calls are executed via a job queue that:
  - runs off the main thread (Web Worker)
  - supports `AbortController` cancellation tokens
  - logs timing and progress (dev only)
- UI dispatches async commands that:
  - enqueue compute jobs
  - await results
  - apply results to system state
- Long-running tasks can be cancelled from the UI without blocking rendering.

## CLI Parity Strategy
- Reuse CLI type definitions as the source of truth:
  - Prefer extracting shared types to a common module (future step).
  - In v0, mirror the CLI type interfaces in web with explicit parity tests.
- Keep persistence format compatible with CLI object + branch JSON layout.
- Centralize ForkCoreClient APIs to avoid divergence across UI + tests.

## Rendering Co-Design Guardrail
- New Plotly rendering systems and interaction patterns require explicit user
  review before implementation. Prototype first, confirm UX, then harden APIs.
