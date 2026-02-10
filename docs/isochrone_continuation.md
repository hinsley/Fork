# Isochrone Continuation

This document describes Fork's isochrone continuation workflow for flow systems.
Note: This document has not been fully human-reviewed; treat it as guidance and verify against current behavior.

## Overview

An isochrone branch in Fork is a codim-1 continuation curve in a two-parameter plane with a fixed-period constraint:

`T(z) = T_seed`

where `T_seed` is the period at the selected seed point on a source branch.

Fork represents this as branch type `isochrone_curve`.

## Where It Appears in the UI

- From a limit-cycle branch point:
  - Inspector action: `Continue Isochrone`
- From an isochrone branch point:
  - Inspector action: `Continue from Point`

Both paths create a new `isochrone_curve` branch under the same limit-cycle parent object.

## Relation to Other Continuation Types

Isochrone continuation is intentionally close to LC codim-1 continuation plumbing (predictor-corrector, extension menus, branch navigation), but it is not a standard bifurcation curve continuation:

- Standard codim-1 bifurcation curves enforce a bifurcation condition (e.g. fold/Hopf/LPC/PD/NS).
- Isochrone enforces fixed period at the seed (`T - T_seed = 0`) instead.
- Isochrone can start from any selected LC (or isochrone) point, not only special bifurcation markers.

## Parameter Selection Rules

Two distinct continuation parameters are required.

### `Continue Isochrone` from a limit-cycle branch

- You can select both continuation parameters.
- Default first parameter: the source limit-cycle branch continuation parameter.
- Second parameter: user-selected, must be different from the first.

### `Continue from Point` from an isochrone branch

- You can select any two distinct system parameters (not restricted to the existing branch's second parameter).
- Parameter names are stored on the new branch as `param1_name` and `param2_name`.

## Direction and Index Semantics

Isochrone branches follow the same logical-index semantics as other continuation branches:

- Forward initialization: indices increase from `0` to `+N`.
- Backward initialization: indices decrease from `0` to `-N`.

With default `max_steps = 300`:

- forward run ends near `+300`
- backward run ends near `-300`

Branch extension follows index-side semantics:

- forward extension extends from the max-index endpoint
- backward extension extends from the min-index endpoint

### Backward-extension outward guard

For isochrone edge cases where the local endpoint edge bends toward index `0`, Fork applies an outward-orientation guard in parameter space during extension initialization so backward extension does not retrace inward toward the seed side.

## Floquet Multipliers on Isochrone Points

Isochrone points store multipliers/eigenvalues in the same point-eigenvalue field used by LC-family branches, so Point Details can display multipliers for selected isochrone points.

If you see:

`No multipliers stored for this point.`

it usually means legacy/imported branch data without multiplier payloads on those points.

## Branch Summary Behavior

For `isochrone_curve`, Branch Summary reports the selected-point period from the currently selected point in Branch Navigator.

## Typical Error Messages and Troubleshooting

### `Continuation init failed: Monodromy: singular stage block at interval 0`

Usually indicates a poor/degenerate periodic seed state for monodromy assembly.

Try:

- reseeding from a nearby LC point
- reducing step size
- increasing mesh resolution (`ntst`, optionally `ncol`)
- confirming the seed point has a valid period and periodic state payload

### `Isochrone continuation stopped at the seed point. Try a smaller step size or adjust parameters.`

No accepted continuation step was found under current settings.

Try:

- smaller initial `step_size`
- larger `corrector_steps`
- tightening `corrector_tolerance`
- choosing a different seed point
- choosing a parameter pair with better local conditioning

### `Isochrone continuation is unavailable in this WASM build. Rebuild fork_wasm ...`

Rebuild the appropriate WASM target for your frontend:

- CLI: `wasm-pack build --target nodejs`
- Web: `wasm-pack build --target web --out-dir pkg-web`

## Numerical Sanity Check

For default settings on typical smooth test systems, period drift along the isochrone branch should remain small. A practical check is:

`max_i |T_i - T_seed| / max(T_seed, 1) <= 1e-4`

If drift is larger, reduce step size and/or increase mesh resolution.
