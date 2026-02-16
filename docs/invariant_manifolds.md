# Invariant Manifolds User Guide

This document describes invariant manifold workflows in Fork, how to tune solver settings, and how to troubleshoot bad geometry.

## Overview

Fork currently supports invariant manifolds for **flow systems** (ODEs):

- Equilibrium 1D stable/unstable manifolds
- Equilibrium 2D stable/unstable manifolds
- Limit-cycle 2D stable/unstable manifolds

Discrete-map manifold solvers are not enabled yet.

## Where to Compute Them

- Equilibrium object: Inspector -> `Invariant Manifolds`
- Limit-cycle object: Inspector -> `Invariant Manifolds`
- CLI: continuation menus for equilibrium and limit-cycle starts

## Stage Summary

1. Stage 1: Equilibrium 1D manifold (`eq_manifold_1d`)
2. Stage 1b: Directed branch mode (`Direction = Plus | Minus`) for 1D
3. Stage 2: Equilibrium 2D surface (`eq_manifold_2d`)
4. Stage 3: Limit-cycle 2D surface (`cycle_manifold_2d`)

## Eligibility Rules

### Equilibrium 1D

- Selected side must have exactly one real eigenmode:
  - `Unstable`: one positive-real-part eigenvalue
  - `Stable`: one negative-real-part eigenvalue

### Equilibrium 2D

- Selected side must have exactly two dimensions in the eigenspace:
  - real pair, or
  - complex conjugate pair (focus case, represented with real/imag basis vectors)
- Ambient dimension must be `n >= 3`

### Limit-cycle 2D

- Must start from a selected limit-cycle object
- Selected side must have one real nontrivial Floquet multiplier
- Ambient dimension must be `n >= 3`

## 1D Equilibrium Manifolds

### Direction Modes

- `Both` (default): creates two child branches (`plus` and `minus`)
- `Plus`: one directed branch
- `Minus`: one directed branch

### Main Controls

- `Kind`: `Stable` or `Unstable`
- `Direction`: `Both`, `Plus`, `Minus`
- `Eigen index`: eigenmode selector
- `eps`: seed offset from equilibrium
- `target_arclength`: 1D manifold length goal
- `integration_dt`: internal integration step size
- `caps`: `max_steps`, `max_points`, `max_time`, ...

The 1D solver uses arclength-targeted shooting/BVP in time (no radius controls).

### Recommended Tuning Order

1. Leave `eps` near default.
2. Increase `target_arclength` gradually (example: `10 -> 30 -> 80`).
3. Increase `max_time` only if growth stops before the desired arclength.
4. Reduce `integration_dt` if traces are jagged.
5. Increase `max_points` only if truncated by cap.

## 2D Equilibrium and 2D Cycle Manifolds

### Main Controls

- `Kind`
- Index selectors (`eig_indices` for equilibrium, `floquet_index` for cycle)
- `initial_radius`
- `leaf_delta`
- `ring_points`
- `integration_dt`
- `target_radius` (equilibrium 2D)
- `target_arclength`
- `caps`: `max_rings`, `max_vertices`, `max_time`, ...

### 2D Solver Model (What It Actually Solves)

Fork uses a KO-style ring-growth workflow:

1. Start from an initial ring near the source object.
2. For each base ring point, solve a leaf problem with unknown start parameter and time.
3. Continue in time from the trivial `t=0` family member and accept the **first** admissible hit.
4. Enforce orientation (half-plane) so the ring does not jump to the wrong side.
5. Adapt mesh using both angle and `(spacing * angle)` quality thresholds.

Leaf failures, spacing failures, and quality failures all use the same ring-level reject-and-retry path that shrinks `leaf_delta`.
Fork does not synthesize projected fallback points.

### Practical Starting Values

- Quick preview (generic):  
  `initial_radius = 1e-3`, `leaf_delta = 0.02`, `ring_points = 48`, `integration_dt = 0.01`, `target_arclength = 0.25`, `max_rings = 48`, `max_vertices = 8000`, `max_time = 5`
- Lorenz origin stable manifold (common proving case):  
  local preview: `initial_radius = 1e-3`, `leaf_delta = 0.02`, `ring_points = 48`, `max_time = 5`  
  global-scale growth: `initial_radius = 1e-3`, `leaf_delta = 0.02`, `ring_points = 48`, `target_arclength = 100..160`, `max_time = 50`
- Rössler saddle-focus unstable manifold:  
  start much smaller (`initial_radius ~ 1e-4`, `leaf_delta ~ 1e-4 .. 2e-3`) and usually increase `max_time` substantially; growth is weak near the source.

If the mesh folds too quickly, lower `leaf_delta` and increase `ring_points`.
If you need longer surfaces, raise `target_arclength` and caps in stages.

## Target Radius vs Target Arclength

These are different stop criteria:

- `target_radius`: Euclidean distance from the source center (used for 2D equilibrium surfaces)
- `target_arclength`: accumulated path length along the manifold growth

Interpretation:

- Radius-limited solves stop when they reach a geometric distance shell (2D equilibrium surfaces).
- Arclength-limited solves stop when they have traced enough manifold length, even if the radius is not large.

For 1D equilibrium manifolds, stopping is arclength-based.
For 2D surfaces, radius/arclength and hard caps can all be active.

## Rendering and Persistence

- 1D manifolds render as line traces (`scatter` / `scatter3d`)
- 2D manifolds render as surface mesh (`mesh3d`) or projected edges in 2D views
- For `n > 3`, rendering projects onto currently selected scene axes
- Geometry is persisted in branch payload (`manifold_geometry`) and reloaded directly
- 2D manifold branches also persist solver diagnostics (`termination_reason`, counters, final `leaf_delta`)

## Inspecting Solver Stops

For 2D manifold branches, open `Branch Summary` in the Inspector and check:

- `Termination`
- `Final leaf delta`
- `Leaf delta floor` and `Min leaf delta reached`
- `Failed ring`, `Failed attempt`, `Solved leaf points before fail` (when a ring build fails)
- `Manifold solver diagnostics` counters (build failures, spacing failures, quality rejects)
- `Last ring/geodesic max ...` metrics for the final attempted ring-quality evaluation

This tells you whether growth stopped because of targets/caps or because leaf/ring construction failed.
The Objects tree also appends the stop reason to 2D manifold branch labels for quick triage.

### Reading `Ring Build Failed` with the new diagnostics

- `failed_ring` / `failed_attempt`: where the solver ran out of recoverable retries.
- `failed_leaf_points`: how many leaf points on that ring were solved before failure.
- `leaf_delta_floor`: the minimum allowed `leaf_delta` for that run.
- `min_leaf_delta_reached = yes`: retries touched the floor at least once; further growth may need less aggressive targets.
- large `last_ring_max_*` or `last_geodesic_max_*`: smoothness/geodesic criteria are forcing repeated rejects; lower `leaf_delta` and/or raise `ring_points`.

## Troubleshooting

### Symptom: only one point (or almost no growth)

Likely causes:

- `target_arclength` too small
- `max_time` too small
- selected side/index not actually eligible

Try:

1. Increase `target_arclength`.
2. Increase `max_time`.
3. Verify `Kind` and index selection.

### Symptom: long straight "teleport" segments in 1D

Likely causes:

- Sparse or inconsistent sampling along trajectory
- Attempting very large arclength goals in one run without enough time resolution

Current behavior:

- 1D manifold branches store dense trajectory samples along the solved arc.
- If the requested arclength is unreachable within `max_time`, growth stops at the reachable extent.

Try:

1. Start with moderate `target_arclength` and extend in stages.
2. Use `integration_dt = 0.005` to `0.01`.
3. Increase `max_time` only after confirming good geometry on smaller targets.

### Symptom: tangled or self-crossing 2D surface

Likely causes:

- `leaf_delta` too large
- too few `ring_points`
- per-leaf continuation failing to stay on the first-hit branch (usually from overly aggressive settings)

Try:

1. Lower `leaf_delta`.
2. Increase `ring_points`.
3. Lower `target_arclength`, then continue in additional runs.
4. If instability is weak (focus cases), increase `max_time` so first-hit leaves can actually reach `leaf_delta`.

### Symptom: Lorenz stable manifold stays tiny near the origin

Likely causes:

- using local-preview seeds (`initial_radius` and `leaf_delta` both tiny)
- expecting very large target radius/arclength alone to force global growth

Try:

1. Start from `initial_radius = 1e-3`, `leaf_delta = 0.02`, `ring_points = 48`.
2. Use `target_arclength = 50..160` with `max_time = 50` for global runs.
3. If growth still stalls, raise `ring_points` before increasing `leaf_delta`.

### Symptom: faceted/noisy 2D surface near the source

Likely causes:

- `leaf_delta` too large relative to `initial_radius`
- coarse ring resolution for local curvature

Try:

1. Start with `leaf_delta = 0.1 .. 0.5 * initial_radius`.
2. Increase `ring_points` to `32 .. 64`.
3. Keep first run short (`target_arclength <= 0.25`) and extend in staged runs.

### Symptom: 2D focus manifold barely grows (Rössler-like case)

Likely causes:

- `leaf_delta` too large relative to local expansion rate
- `max_time` too short for the first-hit distance crossing

Try:

1. Reduce `leaf_delta` first.
2. Increase `max_time` in steps.
3. Keep `ring_points` moderate at first (`24 .. 40`) and increase only after basic growth looks correct.

### Symptom: 2D manifold stays on "Computing..." for a long time

Likely causes:

- `target_arclength` too large for a first run
- `max_rings` / `max_time` caps set high while using dense rings

Try:

1. Start with `target_arclength = 0.25 .. 0.5`.
2. Use `ring_points = 24` initially.
3. Keep quick caps first (`max_rings = 48`, `max_vertices = 8000`, `max_time = 2`), then increase gradually.

### Symptom: eligibility errors (no eigenmode/eigenspace/Floquet multiplier)

Likely causes:

- wrong `Kind` (stable vs unstable)
- selected index not on the requested side

Try:

1. Switch `Kind`.
2. Pick a different index.
3. Recompute source equilibrium/cycle if data is stale.

### Symptom: early termination near bounds

Cause:

- manifold left configured domain bounds

Try:

1. Widen bounds.
2. Remove bounds for exploratory runs.

## Lorenz (Origin Saddle) Recipe

For the standard Lorenz flow (`sigma=10`, `rho=28`, `beta=8/3`) at the origin saddle, 1D unstable manifold runs are usually most stable with:

- `Direction = Both` (or `Plus` for one side)
- `target_arclength = 20 .. 60` first, then increase
- `integration_dt = 0.005 .. 0.01`
- `max_time >= 50` for larger targets

Avoid jumping directly to very large `target_arclength` on first solve.

## Developer Touchpoints

- Core numerics: `crates/fork_core/src/continuation/manifold.rs`
- Core manifold types: `crates/fork_core/src/continuation/types.rs`
- WASM system methods: `crates/fork_wasm/src/continuation/system_methods.rs`
- Web inspector controls: `web/src/ui/InspectorDetailsPanel.tsx`
- Web rendering: `web/src/ui/ViewportPanel.tsx`
- Plotly touchpoints note: `web/docs/plotly-injections.md`

## Build / Validation Commands

- Core tests: `cargo test --workspace`
- WASM (CLI): `cd crates/fork_wasm && wasm-pack build --target nodejs`
- WASM (Web): `cd crates/fork_wasm && wasm-pack build --target web --out-dir pkg-web`
- CLI build: `cd cli && npm run build`
- Web lint/tests: `cd web && npm run lint && npm run test:unit`
