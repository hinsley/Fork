# Experimental: 2D Stable/Unstable Manifolds of Limit Cycles

This document covers the current `cycle_manifold_2d` workflow in Fork: what it does, how the UI maps to solver settings, how the algorithm works, and how to debug failures.

## Experimental Status

`cycle_manifold_2d` is an **experimental** feature.

- It can produce useful manifolds for many systems.
- It can still fail, slow down significantly, or terminate early on difficult geometries.
- Numerical robustness and performance are under active iteration.

Use it as a research workflow, not yet as a guaranteed production-grade pipeline.

## Eligibility and Floquet Mode Rules

For limit-cycle 2D manifolds, Fork currently requires a **real, nontrivial** Floquet multiplier.

- `real`: `|Im(mu)| <= 1e-8`
- `nontrivial`: `|mu - 1| > 1e-3`
- `stable manifold`: `|mu| < 1 - 1e-6`
- `unstable manifold`: `|mu| > 1 + 1e-6`

The trivial phase multiplier near `mu = 1` is intentionally excluded.

## UI and CLI Mapping

Web panel (`Inspector -> Invariant Manifolds -> 2D limit-cycle manifold`) exposes:

- `Kind`: `Stable` or `Unstable`
- `Floquet index`: filtered to eligible indices for selected kind
- `Direction`: `Plus` or `Minus` sheet orientation
- `Initial radius`
- `Leaf delta`
- `Ring points`
- `Integration dt`
- `Target arclength`
- `NTST`, `NCOL`
- caps: `Max steps`, `Max points`, `Max rings`, `Max vertices`, `Max time`

CLI exposes the same core controls. `Direction` selects the sign of the seeded Floquet-normal sheet (the Floquet direction is defined only up to sign).

## Algorithm Overview (Current Implementation)

1. Decode and phase-order cycle profile from collocation state.
2. Compute Floquet mode on the selected multiplier.
3. Build a Floquet vector bundle along the cycle:
   - Primary: collocation monodromy interval transfers.
   - Fallback: variational transport when transfer path is unavailable.
4. Seed ring around cycle using transported bundle direction (`Plus`/`Minus` sign selection).
5. Grow ring-by-ring via leaf solves:
   - Each leaf solves first-hit intersection with local plane target.
   - Stable uses reverse-time dynamics internally.
6. Reparameterize by closed-curve arclength for correspondence stability.
7. Apply quality checks (turn angle, distance-angle, geodesic metrics), retrying with smaller `leaf_delta` when needed.

## Reading Branch Diagnostics

`Branch Summary -> Manifold solver diagnostics` is the primary debugging source.

Most informative counters:

- `Leaf fail: plane no-convergence`
- `Leaf fail: no first hit before max time`
- `Leaf fail: integrator non-finite`
- `Geodesic rejects`
- `Spacing failures`
- `Failed ring`, `Failed attempt`, `Solved leaf points before fail`

Interpretation:

- High `plane no-convergence`: local leaf root solve is struggling.
- High `no first hit before max time`: leaves do not reach first plane target under current time cap.
- High `integrator non-finite`: trajectory enters singular/stiff/unstable region for current settings.
- High `geodesic rejects`: ring geometry is too distorted for acceptance thresholds.
- `spacing adaptation failed (too_many_points)`: attempted ring refinement exploded point count.

## Troubleshooting and Tuning

### Immediate `Ring Build Failed` on ring 1

Try, in order:

1. Lower `Leaf delta`.
2. Increase `Ring points`.
3. Lower `Integration dt`.
4. Increase `Max time`.

### `NoFirstHitWithinMaxTime`

1. Increase `Max time`.
2. Lower `Leaf delta`.
3. Use smaller `Initial radius` if seed starts too far from local linear regime.

### `IntegratorNonFinite`

1. Lower `Integration dt`.
2. Lower `Leaf delta`.
3. Reduce target scope (`Target arclength`, `Max rings`) and grow progressively.
4. Verify system parameters are in a numerically reasonable regime.

### `Geodesic Quality Rejected` or frequent geodesic rejects

1. Lower `Leaf delta`.
2. Increase `Ring points`.
3. Keep growth local first; increase target arclength in stages.

### Very slow runs

1. Start with smaller `Target arclength`.
2. Use fewer `Max rings` for exploratory passes.
3. Keep `Ring points` only as high as needed for geometry quality.
4. Prefer staged runs over one very long run.

## Known Limitations (Current)

- Feature is experimental and may require manual retuning per system.
- Uses real Floquet directions only (complex bundles are not yet exposed for LC 2D manifold seeding).
- Some systems still exhibit poor ring quality or slow convergence under strict quality gates.
- Current render path emphasizes ring curves; mesh quality must be inferred from diagnostics and ring behavior.

## Developer Touchpoints

- Core solver: `crates/fork_core/src/continuation/manifold.rs`
- Floquet/monodromy plumbing: `crates/fork_core/src/continuation/periodic.rs`
- Settings types: `crates/fork_core/src/continuation/types.rs`
- Web eligibility logic: `web/src/system/floquetModes.ts`
- Web UI: `web/src/ui/InspectorDetailsPanel.tsx`
- CLI setup: `cli/src/continuation/initiate-lc.ts`
