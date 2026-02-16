# Invariant Manifolds in Fork

This guide documents the current stable/unstable manifold feature set in Fork, including what is implemented, what each setting does, how the solver works internally, and how to troubleshoot failed runs.

## Scope and Current Status

Fork currently supports invariant manifolds for **flow systems** (`dx/dt = f(x, p)`) only.

Implemented branches:

- `eq_manifold_1d`: 1D stable/unstable manifolds of equilibria
- `eq_manifold_2d`: 2D stable/unstable manifolds of equilibria
- `cycle_manifold_2d`: 2D stable/unstable manifolds of limit cycles

Not implemented yet:

- Invariant manifolds for discrete maps

## Where to Run

Web UI:

- Select an equilibrium object -> Inspector -> `Invariant Manifolds`
- Select a limit-cycle object -> Inspector -> `Invariant Manifolds`

CLI:

- Continuation menus provide:
  - 1D equilibrium manifold
  - 2D equilibrium manifold
  - 2D limit-cycle manifold

## Eligibility Rules

### Equilibrium 1D

- System must be a flow system.
- Selected equilibrium must be solved.
- Chosen side must have at least one eligible **real** mode:
  - `Unstable`: real part `> 0`
  - `Stable`: real part `< 0`
- In the Web UI, the `Eigen index` list is filtered to eligible real modes for the selected side.

### Equilibrium 2D

- System must be a flow system.
- Selected equilibrium must be solved.
- Ambient dimension must be `n >= 3`.
- Chosen side must provide a 2D eigenspace:
  - either two real modes, or
  - one complex-conjugate pair (internally converted to a real 2D basis).
- In the Web UI, the eigenspace index selectors are filtered to eligible modes for the selected side.

### Limit-Cycle 2D

- System must be a flow system.
- Selected object must be a limit cycle with multipliers available.
- Ambient dimension must be `n >= 3`.
- Selected side must have an eligible real nontrivial Floquet mode.

## Solver Overview

## 1D Equilibrium Solver

The 1D workflow computes a trajectory branch seeded from the equilibrium along a selected eigenvector direction:

- Seed: `x_seed = x_eq + sign * eps * v`
- Side handling:
  - unstable manifold uses forward flow
  - stable manifold uses reversed flow internally
- Directed modes:
  - `Both` computes `Plus` and `Minus`
  - `Plus` computes one branch
  - `Minus` computes one branch

Targeting:

- Primary target is `target_arclength`.
- Internally, the solver uses an arclength-hit boundary solve in time.
- If the target is not reachable under caps/time, it falls back to the maximal reachable trajectory under current caps.

Output:

- Branch points use `param_value = arclength`.
- Full curve geometry is persisted in `manifold_geometry`.

## 2D Ring-Growth Solver (Equilibrium and Cycle)

Both 2D workflows use the same growth engine.

### Surface Representation

A surface is grown ring-by-ring:

- `C_0`: initial closed ring near source object
- `C_i -> C_{i+1}`: build next ring by solving one leaf problem per base point

### Initial Ring

Equilibrium 2D:

- Build basis vectors `e1,e2` from selected eigenspace.
- Initial ring points:
  - `x_k = x0 + r0 * (cos(theta_k) e1 + sin(theta_k) e2)`
  - uses a half-step phase offset in `theta_k`.

Cycle 2D:

- Start from cycle mesh points and local normal direction.
- Perturb each cycle point by `initial_radius`.
- If selected multiplier is negative, a doubled cover is used for anti-periodic direction continuity.

### Leaf Solve at One Base Point

Given base point `r` on current ring:

1. Construct leaf plane normal from ring tangent (neighbor-averaged tangent).
2. Parameterize startpoint on current ring polygon segment.
3. For fixed integration time `T`, solve plane residual in segment parameter using:
   - Newton with analytic derivative from variational equations,
   - segment switching on `[0,1]` boundary crossing,
   - bisection fallback if needed.
4. Continue in `T` from `0` until the first hit with signed distance reaching `leaf_delta`.
5. Refine first hit by bisection in `T`.

Derivatives:

- No finite differences are used in manifold leaf solves.
- Jacobian `Df(x)` is evaluated via autodiff path (`compute_jacobian`).
- Variational system is integrated alongside state for sensitivity terms.

### Ring Attempt and Acceptance

For each candidate ring attempt:

1. Build raw next ring (`same point count as previous ring`).
2. Evaluate raw geodesic-quality metrics:
   - `max_angle`
   - `max_delta_angle`
3. Reject and shrink `leaf_delta` if quality exceeds configured bounds.
4. If accepted, run ring spacing adaptation (insert/remove points).
5. If spacing adaptation fails, reject and retry with smaller `leaf_delta`.

Delta adaptation:

- Shrink factor on reject: `0.5`
- Grow factor on strong first-try accept: `2.0`
- Lower bound: `delta_min`

Important implementation detail:

- Geodesic acceptance uses the **raw ring** before spacing adaptation.

### Termination Conditions

2D runs terminate on first matching condition, including:

- `target_radius`
- `target_arclength`
- `max_rings`
- `max_vertices`
- `bounds_exit`
- `ring_too_small`
- `ring_build_failed`
- `ring_spacing_failed`
- `geodesic_quality_rejected`
- `ring_candidate_too_small`

## Web UI Settings Reference

## Equilibrium 1D (`Mode = 1D curve`)

Fields:

- `Kind`: `Stable` or `Unstable`
- `Direction`: `both`, `plus`, `minus`
- `Eigen index`: dropdown of eligible real modes (displayed as 1-based labels)
- `Epsilon`
- `Integration dt`
- `Target arclength`

Termination caps shown:

- `Max steps`
- `Max points`
- `Max vertices`
- `Max time`

Note:

- `Max rings` is not shown for 1D mode.

## Equilibrium 2D (`Mode = 2D surface`)

Fields:

- `Kind`
- `Profile`
  - `local preview`
  - `Default` (internal profile: `LorenzGlobalKo`)
- `Eigenspace indices (A,B)`
- `Initial radius`
- `Leaf delta`
- `Delta min`
- `Ring points`
- `Min spacing`
- `Max spacing`
- `Alpha min`
- `Alpha max`
- `Delta-alpha min`
- `Delta-alpha max`
- `Integration dt`
- `Target radius`
- `Target arclength`

Termination caps shown:

- `Max steps`
- `Max points`
- `Max rings`
- `Max vertices`
- `Max time`

Profile defaults in Web:

`local preview`

- `initial_radius = 1e-3`
- `target_radius = 5`
- `leaf_delta = 0.002`
- `delta_min = 0.001`
- `ring_points = 48`
- `min_spacing = 0.00134`
- `max_spacing = 0.004`
- `alpha_min = 0.3`
- `alpha_max = 0.4`
- `delta_alpha_min = 0.1`
- `delta_alpha_max = 1.0`
- `integration_dt = 0.01`
- `target_arclength = 10`
- caps: `max_steps=300`, `max_points=8000`, `max_rings=240`, `max_vertices=50000`, `max_time=200`

`Default` (`LorenzGlobalKo`)

- `initial_radius = 1.0`
- `target_radius = 40`
- `leaf_delta = 1.0`
- `delta_min = 0.01`
- `ring_points = 20`
- `min_spacing = 0.25`
- `max_spacing = 2.0`
- `alpha_min = 0.3`
- `alpha_max = 0.4`
- `delta_alpha_min = 0.1`
- `delta_alpha_max = 1.0`
- `integration_dt = 0.001`
- `target_arclength = 100`
- caps: `max_steps=2000`, `max_points=8000`, `max_rings=200`, `max_vertices=200000`, `max_time=200`

## Limit-Cycle 2D

Fields:

- `Kind`
- `Floquet index`
- `Initial radius`
- `Leaf delta`
- `Ring points`
- `Integration dt`
- `Target arclength`
- `NTST`
- `NCOL`

Termination caps shown:

- `Max steps`
- `Max points`
- `Max rings`
- `Max vertices`
- `Max time`

Note:

- The cycle manifold panel currently does not expose `Delta min`, spacing, or alpha thresholds in the Web form even though the core supports them.

## CLI Notes

CLI provides the same three manifold workflows.

Notable CLI differences:

- Equilibrium 2D profile menu still labels the global profile as `Lorenz (global K-O)`.
- 1D equilibrium menu no longer prompts for `max rings`; it uses backend default for that cap.

## Progress, Output, and Rendering

## Progress Display

During manifold runs, toolbar progress metadata includes:

- `rings` count (for 2D workflows)
- `points`
- current manifold `arclength`

For non-manifold continuations, the same slot shows `bifurcations`.

## Branch Summary and Diagnostics

For manifold branches, Inspector `Branch Summary` includes:

- branch metadata (type/parent/start/points)
- surface counts (`Surface rings`, `Surface vertices`) for 2D
- solver stop reason and final delta (`Termination`, `Final leaf delta`)
- full solver diagnostics counters and last-failure context (2D)

The generic `Bifurcations` row is still present in branch summary and is typically `0` for manifold branches.

## Rendering

Current rendering behavior:

- 1D manifolds: line traces (`scatter` / `scatter3d`)
- 2D manifolds: **rings rendered as closed line traces** (`scatter` / `scatter3d`)

Notes:

- Surface triangles are still persisted in geometry payloads, but viewport rendering currently emphasizes ring curves rather than filled mesh surfaces.
- For `n > 3`, all manifold rendering is axis-projected using the selected scene variables.

## Persistence

Manifold geometry is persisted in `branch.data.manifold_geometry` and rehydrates on reload without recomputation.

- 1D: `Curve { points_flat, arclength, direction }`
- 2D: `Surface { vertices_flat, triangles, ring_offsets, ring_diagnostics, solver_diagnostics }`

## Practical Tuning Guide

## If Rings Are Too Far Apart

Decrease `Leaf delta`.

Optional supporting changes:

- Increase `Ring points`.
- Decrease `Max spacing`.

## If Growth Stalls Early

1. Increase `Max time`.
2. Increase `Target arclength` and/or `Target radius` (2D equilibrium).
3. For global-scale runs, use profile `Default` (not `local preview`).
4. If still failing, reduce `Leaf delta` moderately and increase `Ring points`.

## If You Get `Ring Build Failed`

In `Manifold solver diagnostics`, check:

- `Leaf fail: plane no-convergence`
- `Leaf fail: segment switch limit`
- `Leaf fail: integrator non-finite`
- `Leaf fail: no first hit before max time`
- `Failed ring`, `Failed attempt`, `Solved leaf points before fail`
- `Last leaf failure reason`, `point`, `segment`, `time`, `tau`

Interpretation:

- High `no first hit before max time`: increase `Max time`, possibly reduce `Leaf delta`.
- High `segment switch limit` or `plane no-convergence`: reduce `Leaf delta`, increase `Ring points`, verify profile choice.
- High `integrator non-finite`: reduce `Integration dt` and check system equations/parameter regime.

## If You Get Quality Rejects

- `Ring-quality rejects` or `Geodesic rejects` means geometry constraints are too strict for current step scale.

Try:

1. Reduce `Leaf delta`.
2. Increase `Ring points`.
3. Relax thresholds slightly (`Alpha max`, `Delta-alpha max`) only if needed.

## If Solve Is Very Slow

- Start with smaller target goals (`Target arclength`, `Target radius`).
- Use fewer initial points for quick exploratory runs.
- Keep `local preview` for fast local checks, then switch to `Default` for larger-scale runs.

## Recommended Starting Configs

## Lorenz origin stable manifold (2D equilibrium)

Use profile `Default` first.

Then adjust only as needed:

- For denser rings: lower `Leaf delta`.
- For longer continuation: increase `Target arclength` and caps.

## 1D equilibrium manifolds (general)

- Keep `Direction = both` initially.
- Start with modest `Target arclength` and increase in stages.
- Lower `Integration dt` if polyline quality is too coarse.

## Known Limitations

- Map manifold workflows are not available yet.
- 2D ring-growth robustness is still being improved for difficult geometries.
- Branch extension for manifold branches is not exposed as a continuation extension workflow.

## Developer Touchpoints

Core:

- `crates/fork_core/src/continuation/manifold.rs`
- `crates/fork_core/src/continuation/types.rs`

WASM bridge:

- `crates/fork_wasm/src/continuation/system_methods.rs`

Web:

- `web/src/ui/InspectorDetailsPanel.tsx`
- `web/src/ui/ViewportPanel.tsx`
- `web/src/App.tsx`
- `web/src/ui/Toolbar.tsx`

CLI:

- `cli/src/continuation/initiate-eq.ts`
- `cli/src/continuation/initiate-lc.ts`
- `cli/src/continuation/inspect.ts`

## Verification Commands

Core:

- `cargo test --workspace`

WASM:

- `cd crates/fork_wasm && wasm-pack build --target nodejs`
- `cd crates/fork_wasm && wasm-pack build --target web`

CLI:

- `cd cli && npm run build`

Web:

- `cd web && npm run lint`
- `cd web && npm test`
