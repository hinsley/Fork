# Map Equilibrium 1D Manifold Solver (Cycles + Fixed Points)

This document covers the map-only `eq_manifold_1d` algorithm in Fork: what it computes, how to tune it, and how to debug common failures.

## Scope

Supported:

- Discrete maps `x_{k+1} = F(x_k, p)`
- 1D stable/unstable manifolds of:
  - fixed points (`mapIterations = 1`)
  - `n`-cycles (`mapIterations > 1`)
- Output fan-out per `(cycle point, direction)` for cycle runs

Not supported:

- 2D map manifold solving (equilibrium or cycle)

## Algorithm References

Fork's map 1D implementation is based on the fundamental-domain growth family introduced by Krauskopf and Osinga, and aligned with modern public implementations:

- Bernd Krauskopf and Hinke M. Osinga, "Growing 1D and quasi-2D unstable manifolds of maps", Journal of Computational Physics 146(1), 404-419 (1998), DOI: [10.1006/jcph.1998.6059](https://doi.org/10.1006/jcph.1998.6059)
- Preprint version: "Growing Unstable Manifolds of Planar Maps" (1997), University Digital Conservancy: [hdl.handle.net/11299/3145](https://hdl.handle.net/11299/3145)
- Reference codebase used during implementation/tuning:
  - GrowFundCurv1D repository: [github.com/dcjulio/Computing-1D-manifolds-in-maps](https://github.com/dcjulio/Computing-1D-manifolds-in-maps)
  - D. C'Julio, B. Krauskopf, H.M. Osinga (2024), Numerical Algorithms 96(3), DOI: [10.1007/s11075-024-01812-0](https://doi.org/10.1007/s11075-024-01812-0)

## Solver Outline in Fork

For each branch direction:

1. Build seed:
   - choose the representative cycle point `x0` (first point in stored cycle order)
   - compute eigendata on the `n`-iterate map `F^n` at `x0`
   - set `x_seed = x0 + sign * eps * v`
2. Choose the effective return `G`:
   - positive multiplier: `G = F^n`
   - negative multiplier: `G = F^(2n)` so a directed half-branch does not alternate and overlap the opposite side
3. Build an exact local fundamental domain:
   - unstable: from `x_seed` to `G(x_seed)`
   - stable: from `G(x_seed)` to `x_seed`; this keeps `eps` as the outer local scale and avoids a nonlocal inverse solve during initialization
4. Grow domain iteratively:
   - unstable: apply `G`
   - stable: solve `G(y) = x_k` with damped Newton
   - stable continuation predictors transport each target-sample step through the local inverse Jacobian at the preceding converged preimage
   - if the requested endpoint falls inside a stable inverse domain, stop there instead of solving its potentially remote far endpoint; combine the unused source-domain suffix with the accepted preimage prefix to form a new exact local fundamental domain for later extension
5. Adaptive remeshing (mapped-domain quality control):
   - checks segment spacing and local turn/curvature proxies
   - inserts new domain midpoints
   - evaluates inserted points exactly with `G` (unstable) or preimage Newton (stable)
6. Append accepted mapped points to the representative manifold polyline until termination.
7. For `mapIterations = n > 1`, generate the remaining phase branches by propagation:
   - propagate one phase at a time (`p0 -> p1 -> ... -> p{n-1}`) instead of remapping each branch from `p0`
   - branch at cycle point `k` is still `F^k(representative_curve)` for `k = 1..n-1`
   - each cycle-phase branch records its own physical arclength in `param_value`; `source_arclength` retains alignment with the representative sampling.

Important:

- The stable initial domain interpolates between two exact forward-related endpoints; every grown domain is produced by preimage evaluation.
- For stable runs, predictors and Newton solves use the Jacobian of the effective return `G`, with a damped line search for correction.
- The requested period must be the cycle's least period; a fixed point cannot be relabeled as an `n`-cycle.
- Stable growth requires a locally invertible return map. Globally noninvertible maps may still have multiple preimage branches; Newton follows only the locally continued branch.
- Periodic state coordinates are wrapped after every map evaluation, while distances and Newton residuals use shortest modular displacements.

## User Controls (What Actually Matters for Maps)

Primary controls:

- `mapIterations`
  - cycle period used for fan-out and cycle-point indexing
- `eps`
  - local seed offset size near each cycle point
- `target_arclength`
  - manifold length goal
- `caps.max_iterations`
  - maximum fundamental-domain growth iterations
- `caps.max_points`
  - hard point budget for output density

Secondary/fallback:

- `caps.max_steps`
  - fallback growth cap if `max_iterations` is unset

Shared-schema fields currently ignored for map 1D growth:

- `integration_dt`
- `caps.max_time`

These remain in request types for flow/map schema compatibility, but map 1D continuation is iterate-based, not time-step-based.

## Output Structure

For map branches, `BranchType::ManifoldEq1D` stores:

- `map_iterations`
- `cycle_point_index` (0-based)

Curve geometry also stores `solver_diagnostics` (stop reason, requested/achieved length, growth counts, correction size, and least period). For cycles of period greater than one, every phase is solved in its own physical arclength; `source_arclength` is intentionally absent because there is no longer a representative-sample parameterization.

The return-map eigenvector is transported from one cycle point to the next with the one-step map Jacobian and normalized without changing its sign. Each requested direction is then initialized and grown independently at every phase. All phase/direction branches share the requested physical target. If bounds or a point/iteration cap stops one solve early, every sibling is recomputed to the shortest achieved length and diagnostics report `group_limit` with the limiting phase and reason.

Curve geometry stores a versioned map resume state containing the current cycle anchor, adaptive
fundamental domain, pending mapped samples/cursor, spacing target, effective iterate count, and
growth counter. This permits exact endpoint extension without reconstructing accepted geometry.
For stable maps, a target inside an inverse-grown domain rolls that cut into a new fundamental
domain whose endpoints remain related by the effective return. Repeated extension therefore resumes
locally from the saved endpoint and does not first solve the unused, potentially enormous remainder
of the old inverse domain.
Each emitted cycle phase receives its own local resume state, so it can be advanced without replaying
or propagating another phase. Legacy branches without this field are replayed to their saved endpoint
on first extension and upgraded when the extension result is saved.

Web and CLI storage assign one `manifoldGroupId` to all phases/directions emitted by a calculation.
Extending any member advances the complete group to one common final physical arclength. Legacy
generated names (`name_p{idx}_{plus|minus}`) are grouped and upgraded on first successful extension.
The longest stored branch is the extension baseline, allowing shorter legacy phases to catch up; if
the configured limits cannot reach that baseline, no member is saved and the user must raise the
limits or rebuild the group. Renamed, incomplete, or ambiguous legacy groups are rejected instead of
guessing at sibling membership. Batch progress reports the minimum achieved group arclength, and
persistence occurs only after every sibling has completed successfully.

Naming behavior:

- `mapIterations = 1`: standard fixed-point naming
- `mapIterations > 1`: `name_p{idx}_{plus|minus}` with `idx` rendered 1-based

## Troubleshooting

## Symptom: stable manifold has too few points or gets coarse far away

Actions:

1. Increase `caps.max_points` (first lever).
2. Increase `caps.max_iterations` (second lever).
3. Keep `target_arclength` realistic for your current budgets.

Notes:

- Very small `eps` mostly affects local seeding and early geometry.
- Far-field spacing is controlled primarily by refinement plus point/iteration caps.

## Symptom: branch is jagged

Actions:

1. Increase `caps.max_points`.
2. Increase `caps.max_iterations`.
3. Reduce `target_arclength` to inspect shorter verified segments first.

## Symptom: stable branch stops early

Likely causes:

- preimage Newton failed to converge
- map branch left configured bounds
- non-finite map values in current parameter regime

Actions:

1. Check parameter regime for near-singular/noninvertible map behavior.
2. Reduce `target_arclength` and confirm local branch quality first.
3. Increase `max_iterations` and `max_points` only after local behavior is stable.

## Symptom: no eligible mode appears for selected side

Eligibility for map 1D uses multiplier modulus and real-only modes:

- unstable: `|lambda| > 1 + 1e-6`
- stable: `|lambda| < 1 - 1e-6`
- real-only: `|Im(lambda)| <= 1e-8`

If no mode is shown, the selected side has no eligible real 1D direction at that point.

## Symptom: cycle output names seem unexpected

For cycle runs (`mapIterations > 1`), one branch is emitted per cycle point per direction:

- `name_p1_plus`, `name_p1_minus`, ..., `name_pN_plus`, `name_pN_minus`

This is expected and encodes cycle-point provenance explicitly.

## Extending a Saved Map Branch

Select any saved fixed-point or cycle-phase `eq_manifold_1d` branch and choose `Extend Manifold`.
The requested arclength and caps apply only to the new segment. Fork preserves the branch's map
period, phase, side, directed half-branch, periodic coordinates, parameter snapshot, and bounds.
The shared endpoint is emitted once, and new physical arclength is offset from the old endpoint.

## Developer Touchpoints

- Core implementation:
  - `crates/fork_core/src/continuation/manifold.rs`
- Branch metadata:
  - `crates/fork_core/src/continuation/types.rs`
- Web request plumbing:
  - `web/src/compute/ForkCoreClient.ts`
  - `web/src/state/appState.tsx`
  - `web/src/ui/InspectorDetailsPanel.tsx`
- CLI initiation path:
  - `cli/src/continuation/initiate-eq.ts`
- CLI extension path:
  - `cli/src/continuation/extend.ts`
