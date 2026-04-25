# Invariant Manifolds in Fork

This guide documents the current stable/unstable manifold feature set in Fork, including what is implemented, what each setting does, how the solver works internally, and how to troubleshoot failed runs.

## Scope and Current Status

Fork supports invariant manifolds for:

- **Flow systems** (`dx/dt = f(x, p)`)
- **Map systems** (`x_{k+1} = F(x_k, p)`) for **equilibrium 1D manifolds** (fixed points and `n`-cycles)

Implemented branches:

- `eq_manifold_1d`: 1D stable/unstable manifolds of equilibria
- `eq_manifold_2d`: 2D stable/unstable manifolds of equilibria
- `cycle_manifold_2d`: 2D stable/unstable manifolds of limit cycles (**experimental**)

Not implemented yet:

- 2D equilibrium manifolds for discrete maps
- 2D cycle manifolds for discrete maps

## Map 1D Algorithm References

Map equilibrium 1D solver design follows the Krauskopf-Osinga fundamental-domain growth approach and related modern implementations:

- Krauskopf and Osinga (1998), JCP 146(1), DOI: [10.1006/jcph.1998.6059](https://doi.org/10.1006/jcph.1998.6059)
- 1997 preprint: [hdl.handle.net/11299/3145](https://hdl.handle.net/11299/3145)
- GrowFundCurv1D reference implementation: [github.com/dcjulio/Computing-1D-manifolds-in-maps](https://github.com/dcjulio/Computing-1D-manifolds-in-maps)

Detailed map-solver usage and troubleshooting guide:

- `docs/map_equilibrium_manifold_1d_solver.md`

## Where to Run

Web UI:

- Select an equilibrium object -> Inspector -> `Invariant Manifolds`
- Select a limit-cycle object -> Inspector -> `Invariant Manifolds`

CLI:

- Continuation menus provide:
  - 1D equilibrium manifold (flow + map)
  - 2D equilibrium manifold
  - 2D limit-cycle manifold

## Eligibility Rules

### Equilibrium 1D

- System can be flow or map.
- Selected equilibrium must be solved.
- Chosen side must have at least one eligible **real** mode:
  - Flow:
    - `Unstable`: real part `> 0`
    - `Stable`: real part `< 0`
  - Map:
    - `Unstable`: `|lambda| > 1 + 1e-6`
    - `Stable`: `|lambda| < 1 - 1e-6`
- In the Web UI, the `Eigen index` list is filtered to eligible real modes for the selected side.

Map cycle fan-out:

- `mapIterations = 1`: one cycle point (fixed point), one branch per requested direction.
- `mapIterations > 1`: one branch per `(cycle point, direction)`.
- For `mapIterations > 1`, Fork computes one representative curve on `F^n` and propagates it with `F^k` to emit the remaining cycle-phase branches.
- Branch names for cycle fan-out: `name_p{idx}_{dir}` where:
  - `idx` is 1-based cycle-point index (`p1`, `p2`, ...)
  - `dir` is `plus` or `minus`

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
  - real: `|Im(mu)| <= 1e-8`
  - nontrivial: `|mu - 1| > 1e-3`
  - stable side: `|mu| < 1 - 1e-6`
  - unstable side: `|mu| > 1 + 1e-6`

Detailed LC 2D notes: `docs/limit_cycle_manifold_2d_experimental.md`.

## Solver Overview

## 1D Equilibrium Solver

The 1D workflow computes a trajectory branch seeded from the equilibrium along a selected eigenvector direction:

- Seed: `x_seed = x_eq + sign * eps * v`
- Side handling:
  - Flow systems:
    - unstable manifold uses forward flow
    - stable manifold uses reversed flow internally
  - Map systems:
    - for `mapIterations = n`, solve a representative branch on the `n`-iterate map `F^n`
    - unstable manifold growth uses forward `F^n` mapping
    - stable manifold growth uses inverse-map stepping on `F^n` via Newton preimages
      - solve `F^n(y) = x_k` for `y`
      - use Jacobian of `F^n` in the Newton solve
    - emit additional cycle-phase branches by forward propagation of the representative curve phase-by-phase (`p0 -> p1 -> ...`), equivalent to `F^k` at phase `k`
    - cycle-phase branches reuse the representative arclength schedule (`param_value`) so branch components at each cycle point stay arclength-aligned
    - mapped fundamental-domain samples are adaptively refined (spacing + turn/curvature checks) before appending branch points
- Directed modes:
  - `Both` computes `Plus` and `Minus`
  - `Plus` computes one branch
  - `Minus` computes one branch

Targeting:

- Primary target is `target_arclength`.
- Internally, the solver uses an arclength-hit boundary solve in time.
- If the target is not reachable under caps/time/step budgets, it falls back to the maximal reachable trajectory under current caps.

Output:

- Branch points use `param_value = arclength`.
- Full curve geometry is persisted in `manifold_geometry`.
- Map runs also store `map_iterations` and `cycle_point_index` in `branch_type` metadata for each emitted branch.

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
4. Continue in `T` from `0` until the first outward half-leaf hit whose Euclidean distance from `r` reaches `leaf_delta`.
5. Refine first hit by bisection in `T`.

Derivatives:

- The plane solve first uses the variational flow derivative.
- Jacobian `Df(x)` is evaluated through the autodiff path (`compute_jacobian`).
- Finite differences are retained only as a fallback if variational transport is unavailable or degenerate.

### Ring Attempt and Acceptance

For each candidate ring attempt:

1. Build raw next ring (`same point count as previous ring`).
2. Evaluate raw geodesic-quality metrics:
   - `max_angle`
   - `max_delta_angle`
3. Reject and shrink `leaf_delta` if quality exceeds configured bounds.
4. If accepted, run ring spacing adaptation:
   - edges shorter than `min_spacing` are removed
   - long edges are split by solving additional leaf problems at midpoint source parameters
   - inserted points keep their source parameter and remain actual integrated leaf hits
5. Re-check ring/geodesic quality using the stored source parameters after spacing adaptation.
6. If a required leaf cannot be solved, reject and retry with smaller `leaf_delta`.

Delta adaptation:

- Shrink factor on reject: `0.5`
- Grow factor on strong first-try accept: `2.0`
- Lower bound: `delta_min`

Important implementation detail:

- Geodesic acceptance uses both the raw ring and the adapted ring.
- Adapted rings are not resampled back to the previous point count.
- The solver does not synthesize missing leaves or relaxed plane projections; if a leaf cannot be solved, it is reported as a failure and the attempt is retried with a smaller `leaf_delta`.

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

| Field | What it controls | Tuning note |
| --- | --- | --- |
| `Kind` | Stable or unstable manifold side. | Stable flow curves use reversed time internally. |
| `Direction` | `both`, `plus`, or `minus` branch direction along the selected eigenvector. | Use `both` first unless one side is known to be irrelevant. |
| `Eigen index` | Eligible real mode, displayed as a 1-based label. | Filtered by stability side; wrong mode gives a different curve. |
| `Epsilon` | Seed offset from the equilibrium along the eigenvector. | Smaller stays closer to the linear eigendirection; too small can be numerically inefficient. |
| `Integration dt` | Flow integration step size. | Lower it if the polyline trajectory is visibly coarse; map growth does not use this field. |
| `Target arclength` | Desired curve arclength. | Main continuation target for 1D branches. |
| `Max steps` | Flow step budget. | Raise it for long curves if the branch stops before the target. |
| `Max points` | Maximum saved curve points. | Raise for long or highly refined curves. |
| `Max vertices` | Shared geometry cap. | Usually not the limiting field for 1D curves. |
| `Max time` | Maximum flow time. | Raise if the target arclength is not reachable under the current time cap. |

Note:

- `Max rings` is not shown for 1D mode.

## Equilibrium 2D (`Mode = 2D surface`)

### Profiles

Profiles are complete numeric starting points for the 2D equilibrium surface solver. In the Web UI and CLI, choosing a profile resets the exposed 2D surface fields to that profile's values. Direct core callers may still override any individual field after setting the profile.

- `adaptive global` (`AdaptiveGlobal`): the default general-purpose profile. It grows on a moderate global length scale and is the right first choice for most nontrivial surfaces when the goal is more than a tiny local patch, but it is still a conservative generic scale rather than an automatic scale-selection algorithm.
- `local preview` (`LocalPreview`): a small, fast local eigenspace check. Use this to confirm the equilibrium, selected stability side, orientation, and rendering before spending time on a global run. It is intentionally not tuned for long continuation.
- `Lorenz reference` (`LorenzGlobalKo`): a Krauskopf-Osinga-scale Lorenz profile with larger initial radius, leaf spacing, and ring spacing. Use it for long Lorenz stable-manifold runs, especially target arclengths around `100` and beyond, where the smaller generic scale is inefficient and can cause avoidable rejection or cap pressure.

### Settings

| Field | What it controls | Efficiency/accuracy effect |
| --- | --- | --- |
| `Kind` | Stable or unstable manifold side. Stable flow manifolds are integrated with reversed time internally. | Wrong side gives the wrong invariant sheet or no eligible eigenspace. |
| `Profile` | Bundle of numeric defaults for the fields below. | Start from a profile before hand-tuning; profile scale usually matters more than any single threshold. |
| `Eigenspace indices (A,B)` | Eligible 2D eigenspace used for the initial ring. Labels are 1-based in the UI. | `auto` is usually best. Wrong indices seed a different manifold even if the run succeeds. |
| `Initial radius` | Radius of the first ring around the equilibrium in the selected eigenspace. | Larger skips more of the linear neighborhood and can be efficient for known global examples; smaller is safer locally but needs more rings to go far. |
| `Leaf delta` | Target Euclidean distance from each current-ring point to the next outward leaf hit. | Larger is faster and coarser; smaller is denser and slower. Too large triggers quality rejects; too small can waste rings and browser memory. |
| `Delta min` | Lower bound for adaptive shrinking of `Leaf delta`. | If too high, the solver may fail before finding a workable step; if too low, it may spend a long time building tiny rings. |
| `Ring points` | Number of vertices in the initial ring. Later rings may gain or lose points through spacing adaptation. | More points capture initial angular variation better but increase leaf solves per ring. |
| `Min spacing` | Adjacent ring vertices closer than this are candidates for deletion. | Larger removes near-duplicates and keeps the mesh lighter; too large can erase real geometric detail. |
| `Max spacing` | Adjacent ring edges longer than this are split by solving inserted leaves. | Smaller gives denser, more accurate rings but can be expensive; too small may cause spacing failure if inserted leaves cannot be solved. |
| `Alpha min` | Lower geodesic angle threshold used when deciding whether an accepted ring was easy enough to allow growth of `Leaf delta`. | Raising it makes growth more conservative; lowering it can allow faster step-size growth. |
| `Alpha max` | Upper geodesic angle threshold for rejecting a candidate ring. | Lower is stricter and more accurate but may shrink too often; higher is more permissive but can accept badly stretched strips. |
| `Delta-alpha min` | Lower distance-weighted geodesic threshold used with `Alpha min`. | A scale-aware "easy ring" threshold; usually leave with the selected profile. |
| `Delta-alpha max` | Upper distance-weighted geodesic rejection threshold. | Lower is stricter; higher is more permissive. Prefer changing `Leaf delta` before relaxing this. |
| `Integration dt` | RK4 step size for trajectory and variational integration inside leaf solves. | Smaller is more accurate and slower. Reduce it when trajectories look jagged or non-finite integration appears. |
| `Target radius` | Stop once the average surface radius from the source object reaches this value. | Increase it for farther global growth; set it above the expected radius when `Target arclength` is the main goal. |
| `Target arclength` | Stop once accumulated strip-to-strip distance reaches this value. | This is the main long-growth target. Increase caps with it. |
| `Max steps` | Per-leaf integration/continuation step budget. | Increase if leaf solves hit step limits before reaching the next ring. |
| `Max points` | Shared branch point cap used by manifold workflows. | Usually less important than `Max vertices` for 2D surfaces, but keep it comfortably above expected branch metadata counts. |
| `Max rings` | Maximum number of rings in the surface. | Increase for long runs or smaller `Leaf delta`; decrease for quick exploratory runs. |
| `Max vertices` | Maximum total surface vertices after ring spacing adaptation. | Increase for long or dense runs. If the browser becomes heavy, coarsen spacing instead of only raising this. |
| `Max time` | Maximum flow time searched for a leaf hit. | Increase when diagnostics show `no first hit before max time`; avoid making it huge until the side, eigenspace, and scale are confirmed. |

Validation constraints in the UI and CLI:

- `Leaf delta > 0`
- `0 < Delta min <= Leaf delta`
- `Ring points >= 4` in the Web UI (`>= 8` in the CLI)
- `0 < Min spacing < Max spacing`
- `0 < Alpha min < Alpha max`
- `0 < Delta-alpha min < Delta-alpha max`

### Profile Defaults

| Profile | `initial_radius` | `target_radius` | `leaf_delta` | `delta_min` | `ring_points` | `min_spacing` | `max_spacing` | `integration_dt` | `target_arclength` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `adaptive global` | `0.2` | `20` | `0.2` | `0.001` | `32` | `0.05` | `0.5` | `0.005` | `60` |
| `local preview` | `1e-3` | `5` | `0.002` | `0.001` | `48` | `0.00134` | `0.004` | `0.01` | `10` |
| `Lorenz reference` | `1.0` | `40` | `1.0` | `0.01` | `20` | `0.25` | `2.0` | `0.001` | `100` |

| Profile | `alpha_min` | `alpha_max` | `delta_alpha_min` | `delta_alpha_max` | `max_steps` | `max_points` | `max_rings` | `max_vertices` | `max_time` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `adaptive global` | `0.3` | `0.4` | `0.01` | `1.0` | `1500` | `8000` | `240` | `200000` | `200` |
| `local preview` | `0.3` | `0.4` | `0.1` | `1.0` | `300` | `8000` | `240` | `50000` | `200` |
| `Lorenz reference` | `0.3` | `0.4` | `0.01` | `1.0` | `2000` | `8000` | `200` | `200000` | `200` |

### Why Profile Scale Matters

The profile is not just a convenience preset. It sets the geometric scale of the ring stack:

- `adaptive global` starts at radius `0.2`, asks for leaf-to-leaf distance `0.2`, uses `32` initial ring points, and keeps ring edges around `0.05` to `0.5`.
- `Lorenz reference` starts at radius `1.0`, asks for leaf-to-leaf distance `1.0`, uses `20` initial ring points, and keeps ring edges around `0.25` to `2.0`.

Both profiles use the same default geodesic acceptance thresholds (`alpha_max = 0.4`, `delta_alpha_max = 1.0`). If `Lorenz reference` succeeds where `adaptive global` fails, that usually means the run needed the larger K-O/global length scale, not that Lorenz is using looser quality gates.

On the Lorenz origin stable manifold, long runs can expose this clearly. `adaptive global` may shrink `Leaf delta` repeatedly until it hits `Delta min = 0.001`; after enough tiny rings, spacing adaptation can create a fragile ring with a huge edge ratio or near-`pi` turn angle. That may surface as `geodesic_quality_rejected` in the termination summary, but the more informative `Termination detail` can say something like `reparameterized ring quality trigger`. In that case, do not keep shrinking `Leaf delta`. Switch to `Lorenz reference`, or manually coarsen toward that scale, and keep `Target radius` high enough that arclength stops first.

## Limit-Cycle 2D

| Field | What it controls | Tuning note |
| --- | --- | --- |
| `Kind` | Stable or unstable cycle manifold side. | Requires an eligible nontrivial real Floquet multiplier. |
| `Floquet index` | Floquet mode used to seed the cycle tube. | Wrong index produces a different manifold direction. |
| `Direction` | `plus` or `minus` side of the selected Floquet eigenvector. | Start with one side; compute the other separately if needed. |
| `Algorithm` | `geodesic rings` or `isochron fibers (HKO)`. | Use geodesic rings for legacy runs; use isochron fibers for phase-foliated LC surfaces. |
| `Initial radius` | Offset from the cycle profile in the selected normal direction. | Smaller is safer locally; larger may skip a difficult near-cycle region. |
| `Leaf delta` | Distance between successive rings. | Same accuracy/speed tradeoff as equilibrium 2D. |
| `Ring points` | Number of cycle/profile samples used for each ring. | More points resolve cycle variation better and cost more leaf solves. |
| `Integration dt` | Flow and variational integration step size. | Lower for accuracy or non-finite integration failures. |
| `Target arclength` | Desired tube growth distance. | Main target for cycle manifold growth. |
| `NTST` | Number of mesh intervals used when decoding/reusing a collocation cycle profile. | Match the stored cycle mesh when available. |
| `NCOL` | Collocation order used with `NTST`. | Match the stored cycle mesh when available. |
| `Max steps` | Per-leaf integration/continuation step budget. | Raise for long or difficult leaf solves. |
| `Max points` | Shared branch point cap. | Usually secondary to ring and vertex caps for 2D surfaces. |
| `Max rings` | Maximum number of generated rings. | Raise for long cycle tubes. |
| `Max vertices` | Maximum total surface vertices. | Raise for dense tubes or coarsen with larger spacing. |
| `Max time` | Maximum flow time searched for each leaf hit. | Raise if diagnostics show missing first hits. |

Note:

- The cycle manifold panel currently does not expose `Delta min`, spacing, or alpha thresholds in the Web form even though the core supports them.
- `cycle_manifold_2d` is experimental; see `docs/limit_cycle_manifold_2d_experimental.md` for troubleshooting and tuning guidance.

### Limit-Cycle Algorithms

`geodesic rings` is the original Fork backend. It seeds a ring around the limit cycle and advances the whole ring with the same leaf-shooting/ring-quality machinery used for equilibrium surfaces. It is useful as a quick legacy baseline, but it is not the Krauskopf-Osinga limit-cycle method.

`isochron fibers (HKO)` follows the Hinke-Krauskopf-Osinga construction more closely. Fork samples phases on the limit cycle, transports the selected real Floquet bundle, offsets each phase by `Initial radius`, and grows fixed-phase fibers using open orbit-segment BVP solves. The open-orbit residual uses collocation equations and autodiff Jacobians from the core equation engine. The resulting fibers are resampled by arclength into rings so the existing surface renderer can draw a clean translucent mesh.

Important topology rules:

- A positive real Floquet multiplier gives two orientable sheets. Use `Direction = plus` and `Direction = minus` as separate runs.
- A negative real Floquet multiplier is anti-periodic. Fork uses a double cover of the cycle phases and a return time of `2T` so the direction field is continuous.
- Complex Floquet pairs are not supported by the 2D LC manifold workflow yet.

For `isochron fibers (HKO)`, the settings have slightly different practical meanings:

- `Ring points` is the number of phase fibers. Negative multipliers double this internally.
- `Leaf delta` is the target arclength spacing after fiber resampling, not a geodesic leaf step.
- `Target arclength` is the requested length along each fixed-phase fiber.
- `Max steps` limits the total return-preimage BVP budget; raise it when a long target with many phase fibers stops early.
- `NTST` and `NCOL` set the open-orbit collocation resolution. Fork caps the internal HKO BVP mesh to keep browser runs tractable, but larger source meshes still improve Floquet/profile data.
- `Integration dt` is used for initial BVP guesses and the variational Floquet fallback; reduce it if the diagnostics report non-finite integration or visibly rough fibers.

### Limit-Cycle Troubleshooting

If `geodesic rings` fails but `isochron fibers (HKO)` works, the failure is usually geometric: the old backend is trying to advance a full ring through a region where the correct surface is better described as fixed-phase fibers. Prefer the HKO backend for LC manifolds unless you are comparing against old results.

For HKO runs, first read `Termination detail`. It reports the phase count, ring count, return time, BVP mesh, BVP solve count, nonconverged solve count, and maximum residual.

- `nonconverged > 0`: reduce `Target arclength`, reduce `Initial radius`, lower `Integration dt`, or increase `NTST`/`NCOL`. If only a few solves miss tolerance and the surface is smooth, the run may still be usable.
- `termination = max_rings`: raise `Max rings` or increase `Leaf delta`.
- `termination = max_vertices`: raise `Max vertices`, reduce `Ring points`, or increase `Leaf delta`.
- Very slow HKO runs: lower `Ring points`, raise `Leaf delta`, lower `Target arclength`, or raise `Initial radius` modestly to skip an expensive near-cycle layer.
- Rough or twisted surfaces: verify the Floquet index, raise `Ring points`, reduce `Leaf delta`, and check whether the selected multiplier is negative, which intentionally doubles the phase cover.
- No visible growth away from the cycle: verify `Kind`, `Floquet index`, and `Direction`; then raise `Max steps` because the HKO return budget is shared across all phase fibers.

## CLI Notes

CLI provides the same three manifold workflows.

Notable CLI differences:

- Equilibrium 2D defaults to `Adaptive global`; the Lorenz-tuned profile is listed as `Lorenz reference`.
- 1D equilibrium menu no longer prompts for `max rings`; it uses backend default for that cap.

## Progress, Output, and Rendering

## Progress Display

During 2D manifold runs, the toolbar progress UI now shows:

- header progress as `arclength / target arclength`
- metadata rows for `rings` and `points`
- metadata value `radius` (current radius estimate)

For non-manifold continuations and 1D manifold runs, the generic progress display remains step-based and the same metadata slot shows `bifurcations`.

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
- 2D manifolds: rings rendered as closed line traces (`scatter` / `scatter3d`)
- 2D manifolds in 3-axis scenes: optional translucent mesh fill (`mesh3d`) built from the persisted surface triangles

Notes:

- Select a 2D manifold branch and use the Inspector `Hide surface` / `Show surface` button to switch between the translucent mesh fill and the ring curves.
- When the mesh fill is shown, ring curves are hidden so the branch reads as a surface rather than a stack of contours.
- Mesh opacity is intentionally similar to 3D isocline surfaces so overlapping structures remain visible.
- In 2-axis scene projections, 2D manifolds render as projected ring curves. The filled `mesh3d` surface is only emitted for 3-axis scenes.
- For `n > 3`, all manifold rendering is axis-projected using the selected scene variables.

## Persistence

Manifold geometry is persisted in `branch.data.manifold_geometry` and rehydrates on reload without recomputation.

- 1D: `Curve { points_flat, arclength, direction }`
- 2D: `Surface { vertices_flat, triangles, ring_offsets, ring_diagnostics, solver_diagnostics }`

## Practical Tuning Guide

Start by choosing the right scale, then tune the smallest number of fields.

- For a fast sanity check, use `local preview`.
- For most unknown global surfaces, use `adaptive global`.
- For long Lorenz stable manifolds, use `Lorenz reference`; do not take a local or moderate-scale profile and only raise the target.
- For more accuracy, reduce `Leaf delta` or `Max spacing`, raise `Ring points`, and possibly reduce `Integration dt`.
- For more speed, raise `Leaf delta` or `Max spacing`, lower `Ring points`, reduce the target, or switch from local-scale settings to a global profile.

Prefer changing `Leaf delta`, spacing, target, and caps before changing the alpha thresholds. The alpha thresholds are quality guards; relaxing them can be correct, but it should be a late step after the run is already at a reasonable scale.

## Read Diagnostics First

After a 2D run, inspect `Branch Summary -> Manifold solver diagnostics`.

| Diagnostic / termination | Likely meaning | First response |
| --- | --- | --- |
| `termination = target_arclength` | Desired long-growth target was reached. | Successful run; only tune density or visual clarity. |
| `termination = target_radius` | Desired radial target was reached before arclength target. | Successful if radius was the goal; otherwise raise `Target radius`. |
| `termination = max_rings` | Ring cap stopped growth. | Raise `Max rings`, raise `Leaf delta`, or lower the target. |
| `termination = max_vertices` | Mesh density cap stopped growth. | Raise `Max vertices` or coarsen with larger `Max spacing`, `Min spacing`, or `Leaf delta`. |
| `termination = ring_build_failed` | At least one leaf in the next ring could not be solved after retries. | Use leaf failure counters below; usually adjust `Leaf delta`, `Max time`, or profile scale. |
| `termination = ring_spacing_failed` | Base ring was accepted, but inserted spacing leaves could not be solved. | Increase `Max spacing`, increase `Max time`, or reduce `Leaf delta` less aggressively. |
| `termination = geodesic_quality_rejected` | Candidate rings repeatedly violated geodesic angle/distance quality, or a ring-quality guard was summarized by this termination reason. | Read `Termination detail`. If it mentions a geodesic angle/distance, reduce `Leaf delta`; if it mentions reparameterized ring quality, edge ratio, or a large turn angle after shrinking to `Delta min`, choose a coarser profile scale such as `Lorenz reference`. |
| `Ring-quality rejects > 0` | Rings had near-duplicate, inverted, or badly ordered local geometry. | Increase `Ring points`, increase `Min spacing`, or reduce `Leaf delta`. |
| `Geodesic rejects > 0` | Strip-to-strip geometry was too steep for current thresholds. | Reduce `Leaf delta`; only then consider a modestly higher `Alpha max` or `Delta-alpha max`. |
| `Min leaf delta reached = yes` | Adaptive shrinking hit `Delta min`. | Settings are at the wrong scale or too strict; for long Lorenz use `Lorenz reference` or coarser spacing, otherwise reduce target or revise `Delta min`/thresholds. |
| `Final leaf delta` much smaller than requested | Solver needed repeated shrinkage. | Start with a smaller `Leaf delta` or improve resolution with more `Ring points`. |
| `Leaf fail: no first hit before max time` | The flow did not reach the required outward section within the time search. | Increase `Max time`, reduce `Leaf delta`, and verify stable/unstable side. |
| `Leaf fail: plane no-convergence` | Newton/bisection could not solve the section residual. | Reduce `Leaf delta`, increase `Ring points`, and check for a bad eigenspace choice. |
| `Leaf fail: segment switch limit` | The solved intersection walked across too many ring segments. | Reduce `Leaf delta`, use more `Ring points`, or choose a less local/global profile as appropriate. |
| `Leaf fail: integrator non-finite` | The trajectory left finite numeric range. | Reduce `Integration dt`, lower targets, and check equations/parameters for blow-up. |

## Common Tuning Scenarios

### Rings are visibly too far apart

Decrease `Leaf delta` first. If long edges remain after adaptation, decrease `Max spacing`. If angular detail near the first ring is missing, increase `Ring points`.

Use a smaller `Integration dt` only when trajectory integration itself looks inaccurate; it does not directly make the mesh denser.

### Surface is too dense or the browser becomes heavy

Increase `Leaf delta` and `Max spacing`, then consider increasing `Min spacing` so near-duplicate vertices are deleted. Reducing `Ring points` helps the first few rings, but the dominant cost in long runs is usually total inserted vertices.

If the run is hitting `max_vertices`, do not only raise `Max vertices`; decide whether the extra density is useful. A coarser long surface is often more informative than a dense short one.

### Solve is very slow

Use `local preview` only to verify setup, then switch to `adaptive global` or `Lorenz reference` for real global growth. Tiny local spacing carried into a long target is the most common efficiency mistake.

For faster exploratory runs:

- lower `Target arclength` and `Target radius`
- raise `Leaf delta` modestly
- raise `Max spacing`
- lower `Ring points`
- keep `Max vertices` below a browser-heavy value until the run settings are proven

### Growth stalls early

If the stop reason is a successful target, raise that target. If the stop reason is a cap, raise that cap or coarsen the mesh. If the stop reason is a build or quality failure, inspect the reject and leaf-failure counters before changing targets.

For moderate global runs, use `adaptive global`. For Lorenz runs near arclength `100` and beyond, use `Lorenz reference`.

### Long Lorenz stable manifold stops before the requested arclength

Use profile `Lorenz reference`, set `Target arclength` to the desired value, and keep `Target radius` above the expected radial extent so radius does not stop first. For an arclength around `150`, start with:

- `Profile = Lorenz reference`
- `Target arclength = 150`
- `Target radius = 200`
- `Max steps = 3000`
- `Max rings = 400`
- `Max vertices = 300000`
- `Max time = 300`

This configuration has been manually smoke-tested in the Web UI for the Lorenz origin stable manifold at arclength `150`; it reached `target_arclength` with no build, spacing, geodesic, or ring-quality rejects.

### `Ring Build Failed`

Check these diagnostic fields:

- `Leaf fail: plane no-convergence`
- `Leaf fail: segment switch limit`
- `Leaf fail: integrator non-finite`
- `Leaf fail: no first hit before max time`
- `Failed ring`, `Failed attempt`, `Solved leaf points before fail`
- `Last leaf failure reason`, `point`, `segment`, `time`, `tau`

Use this interpretation:

- High `no first hit before max time`: increase `Max time`, and reduce `Leaf delta` if the requested next ring is too far away.
- High `segment switch limit` or `plane no-convergence`: reduce `Leaf delta`, increase `Ring points`, and verify the profile scale.
- High `integrator non-finite`: reduce `Integration dt`; if it persists, lower targets and check the equations or parameter regime.

### Quality rejects

`Ring-quality rejects` and `Geodesic rejects` mean the candidate surface did not satisfy the mesh quality constraints at the current step scale.

First read `Termination detail`. A detail with `angle=` or `distance_angle=` is a direct geodesic-quality failure. A detail with `reparameterized ring quality trigger`, `edge_ratio`, or a large `turn_angle` means the run produced a pathological ring after spacing adaptation; this often happens when a long run is attempted at too small a profile scale and the solver has already shrunk to `Delta min`.

Try, in order:

1. If `Final leaf delta` is still large and the detail is a direct geodesic angle/distance failure, reduce `Leaf delta`.
2. If `Final leaf delta` is at `Delta min` and the detail mentions edge ratio or turn angle, switch to a coarser profile scale (`Lorenz reference` for long Lorenz) before changing thresholds.
3. Increase `Ring points` only when angular resolution of the ring is visibly poor; more points can also make an already over-dense long run heavier.
4. Adjust spacing: lower `Max spacing` for more inserted points, or raise `Min spacing` to delete near-duplicates.
5. Relax `Alpha max` or `Delta-alpha max` slightly only if the surface is visually and numerically reasonable but the thresholds are too strict.

### No first hit before max time

This means leaf integration did not find the outward half-leaf distance target in the allowed flow time. Increase `Max time` and reduce `Leaf delta`. Also verify that `Kind` is correct; stable and unstable manifolds use opposite time directions internally.

### Integrator non-finite

Reduce `Integration dt` and shorten the target. If the same state region always fails, inspect the vector field and parameter values; the trajectory may be leaving the modeled domain or encountering a singular expression.

## Recommended Starting Configs

## Lorenz origin stable manifold (2D equilibrium)

Use profile `adaptive global` for quick-to-moderate global growth. Use `Lorenz reference` for long Lorenz runs, such as arclength `100`, `150`, or `250`, where the original K-O scale uses larger leaf spacing.

Suggested workflow:

1. Run `local preview` only if you need to confirm the selected equilibrium/eigenspace.
2. Switch to `Lorenz reference`.
3. Set `Kind = Stable`.
4. Set `Target arclength = 100`, `150`, or higher for a stress run.
5. Set `Target radius` high enough that arclength stops first, for example `200` for an arclength-`150` smoke run.
6. Raise caps with the target, for example `Max steps = 3000`, `Max rings = 400`, `Max vertices = 300000`, `Max time = 300`; arclength `250` may need more vertices depending on spacing adaptation.

Then adjust only as needed:

- For denser rings: lower `Leaf delta` or `Max spacing`.
- For faster long runs: keep `Leaf delta = 1.0` initially and avoid lowering it until the long target is reachable.
- For longer continuation: increase `Target arclength`, `Target radius`, `Max rings`, and `Max vertices` together.

## 1D equilibrium manifolds (general)

- Keep `Direction = both` initially.
- Start with modest `Target arclength` and increase in stages.
- Flow only: lower `Integration dt` if polyline quality is too coarse.
- Map only: increase `Max points` and `Max iterations`; `Integration dt` is a shared-schema placeholder and is not used for map growth.

## Known Limitations

- 2D map manifolds are not available yet.
- 2D ring-growth still depends on suitable target/cap choices for very large or highly folded surfaces.
- `cycle_manifold_2d` (limit-cycle 2D manifolds) is experimental and may require substantial tuning.
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
