# Homoclinic and Homotopy-Saddle User Guide (Methods 1, 2, 3, 4)

This guide explains the four homoclinic-related workflows in Fork and how to tune them for stable continuation runs.

- Method 1: Homoclinic continuation from a large-period limit cycle point
- Method 2: Homoclinic continuation from an existing homoclinic branch point (`Continue from Point` on a homoclinic branch)
- Method 3: Homotopy-saddle continuation from an equilibrium branch point
- Method 4: Homoclinic continuation from a StageD homotopy-saddle point

All numerical work is done in Fork Core (Rust/WASM) with the continuation engine and autodiff-based derivatives.

## Prerequisites

- System type must be `flow` (ODE)
- At least two system parameters must exist
- You must select a source branch point before launching any method

## What Is a Homotopy-Saddle?

A homotopy-saddle branch is a staged continuation object used to build a reliable seed for a true homoclinic continuation.

The idea is:

1. Start from an equilibrium and construct an easier boundary-value connection problem.
2. Continue that problem while progressively enforcing homoclinic endpoint/manifold structure.
3. Stop at `StageD`, which is treated as a ready seed for Method 4.

How to think about it:

- It is a bridge workflow, not the final homoclinic curve you usually analyze.
- It is useful when Method 1 is hard to start robustly from your current large-cycle seed.
- Stage progression is automatic; you do not manually drive StageA/B/C/D.
- Homotopy-saddle branches therefore do not expose the generic `Extend Branch` action. Use the
  staged Method 3 run to reach StageD, then start Method 4 from a selected StageD point.

## Which Method to Use

| Method | Start From | Primary Use | Output |
|---|---|---|---|
| 1 | `limit_cycle` branch point | First homoclinic branch from a large cycle | `homoclinic_curve` |
| 2 | `homoclinic_curve` branch point | Restart/remesh/continue an existing homoclinic branch | `homoclinic_curve` |
| 3 | `equilibrium` branch point | Build StageD seed through staged continuation | `homotopy_saddle_curve` |
| 4 | `homotopy_saddle_curve` StageD point | Convert staged seed into homoclinic continuation | `homoclinic_curve` |

## Shared Continuation Settings (All Methods and Extension)

Current homoclinic/homotopy defaults:

- `Initial step size = 0.01`
- `Min step size = 1e-5`
- `Max step size = 0.1`
- `Max points = 300`
- `Corrector steps = 32` (homoclinic/homotopy specific default)

Field meanings:

For Methods 1, 2, and 4, exactly one or two of `Free T`, `Free eps0`, and `Free eps1`
must be selected. The homoclinic continuation layout rejects both zero and all three free extras.

| Field | What It Controls | When to Change It |
|---|---|---|
| Branch name | Name of the output continuation object | Use meaningful names that encode source and parameter plane |
| Direction (`Forward`/`Backward`) | Sign of continuation step along branch orientation | Explore opposite direction or extend both sides |
| Initial step size | First predictor step magnitude | Reduce first when Newton fails near seed/endpoint |
| Max points | Maximum points computed in this run | Increase when branch is healthy and you want more length |
| Min step size | Floor for adaptive step shrinking | Lower only if you need finer rescue steps; too low can be slow/noisy |
| Max step size | Ceiling for adaptive growth | Lower if curve bends sharply or corrections fail after aggressive growth |
| Corrector steps | Newton correction iteration cap per point | Default is 32 for homoclinic/homotopy runs and extensions |
| Corrector tolerance | Newton residual/solve strictness | Tighten for accuracy, loosen slightly for difficult starts |
| Step tolerance | Acceptance tolerance for step update | Tighten for stability on sensitive branches |

## Method-Specific Fields

### Method 1: Homoclinic from Large Cycle

Source: selected limit-cycle branch point.

Method 1 supports two numerical discretizations:

- `Orthogonal Collocation` is the default and preserves Fork's existing Method 1 behavior.
- `Standard Shooting` first builds the same collocation seed, then samples that seed onto shooting
  nodes before continuation. One shooting interval gives single shooting; more than one gives
  multiple shooting.

The shooting option changes only the numerical representation of the homoclinic connection. The
endpoint manifold conditions, continuation parameters, and `Free T`/`Free eps0`/`Free eps1`
choices remain the same. Method 2 can keep collocation or switch a collocation source to shooting;
a shooting source restarts as shooting. Method 4 currently uses orthogonal collocation.

Method 1 consumes the source cycle's exact normalized mesh, including an adaptive nonuniform mesh.
The selected seam interval is removed from the periodic profile and its interval width is accounted
for when converting the retained open-orbit time. The resulting seed can then be transferred to a
new collocation mesh or sampled onto shooting nodes.

| Field | Meaning | Practical Guidance |
|---|---|---|
| First parameter / Second parameter | Parameter plane for codim-1 homoclinic continuation | Choose two parameters with visible effect in your model |
| Method | Numerical representation of the homoclinic connection | Keep `Orthogonal Collocation` for the established path; choose `Standard Shooting` to use single/multiple shooting |
| Target NTST | Number of collocation intervals for the output, or for the intermediate seed when shooting | Increase for long/steep orbits; lower for quick scouting |
| Target NCOL | Collocation polynomial order for the output, or for the intermediate seed when shooting | Usually keep moderate; increase only when profile needs higher local fidelity |
| Shooting intervals | Number of shooting segments | `1` is single shooting; values greater than `1` are multiple shooting. Default: `8` |
| Integration steps per segment | Fixed integration resolution within each shooting segment | Increase when segment integration error is visible or Newton correction is sensitive. Default: `64` |
| Adaptive collocation | Defect-driven redistribution and bounded NTST growth | Available only for collocation. Keep enabled unless you need a deliberately fixed comparison mesh |
| Defect tolerance / retry budget / mesh cap | Resolution acceptance and adaptation limits | Lower the tolerance for a stricter profile; raise retries/cap only when the defect report shows the current budget or cap was reached |
| Free T | Whether total homoclinic time is solved as unknown | Keep off initially unless continuation needs time re-adjustment |
| Free eps0 | Free start-endpoint distance from equilibrium | Usually on for robust starts |
| Free eps1 | Free end-endpoint distance from equilibrium | Usually on for robust starts |

Shooting branches store their node count as `NTST`, use `NCOL = 0` to identify the node-based packed
profile, and retain the integration-step count in their discretization metadata. Fork's data
inspector and orbit renderer decode this representation directly, including the equilibrium and
continuation scalars appended after the shooting nodes.

### Method 2: Continue from Point (Homoclinic Restart)

Source: selected homoclinic branch point.

| Field | Meaning | Practical Guidance |
|---|---|---|
| Branch name | Name of the restarted branch | Use a restart suffix so provenance is obvious |
| First parameter / Second parameter | Parameter plane for the restarted homoclinic continuation | You can switch to a new parameter pair; the two selections must be distinct |
| Method | Restart representation | Keep collocation, switch a collocation source to shooting, or retain shooting for a shooting source |
| Target NTST / Target NCOL | Restart mesh for a collocation profile | Use to remesh before long extension or after repeated failures |
| Shooting intervals / integration steps | Shooting-node count and per-segment integration resolution | Shown for shooting restarts; a shooting source cannot currently be converted back to collocation |
| Adaptive collocation | Defect-driven mesh control for the restarted branch | Shown only for collocation restarts |
| Free T / Free eps0 / Free eps1 | Which homoclinic extras remain unknowns | Start with same choices as source branch, then change one at a time |

Method 2 seed reconstruction uses the source branch encoding (discretization, exact normalized mesh
or shooting nodes, and source free/fixed-extra flags), then applies your target representation and
extras. This keeps the restart local even when you change continuation parameters,
free/fixed-extra choices, or collocation resolution.

UI note: in the Inspector menu this method appears as `Continue from Point` when a homoclinic branch point is selected.

### Method 3: Homotopy-Saddle from Equilibrium

Source: selected equilibrium branch point.

| Field | Meaning | Practical Guidance |
|---|---|---|
| Branch name | Name of the staged branch | Include source equilibrium/plane in name |
| First parameter / Second parameter | Parameter plane for staged continuation | Pick parameters that move the equilibrium and global geometry measurably |
| NTST / NCOL | Collocation discretization for staged orbit profile | Use moderate start; increase if stage progression is unstable |
| eps0 | Initial distance from equilibrium at one endpoint | Too large can destabilize seed; too small can be overly stiff |
| eps1 | Initial distance at the opposite endpoint | Start moderate, stage logic drives toward smaller values |
| T | Initial orbit time window | Too short misses excursion; too long can make corrections stiff |
| eps1_tol | StageC->StageD completion threshold | Smaller means stricter StageD readiness, usually needs more continuation |

### Method 4: Homoclinic from Homotopy-Saddle

Source: selected StageD point on `homotopy_saddle_curve`.

| Field | Meaning | Practical Guidance |
|---|---|---|
| Branch name | Name of the converted homoclinic branch | Keep stage/source info in name for traceability |
| Target NTST / Target NCOL | Mesh used for conversion and continuation | Start moderate; raise if endpoint geometry is poorly resolved |
| Free T / Free eps0 / Free eps1 | Homoclinic extras in the converted problem | Same tuning logic as Method 2 |
| Parameter plane | Inherited from source homotopy-saddle branch metadata | Use a different StageD seed if you want a different continuation plane |

## Extension of Existing Homoclinic Branches

Use the same extension workflow as other continuation branches.

- Web: `Extend Branch` panel on the selected homoclinic branch
- CLI: `Extend Branch` from branch inspector

Extension uses the branch's existing continuation settings as defaults and only changes direction/length unless you edit settings.

Important behavior:

- Extension does one continuation attempt with your selected settings.
- There is no automatic retry and no automatic method switch during extension.
- Collocation extension retains adaptive mesh control and transfers the published history whenever
  the mesh changes. Shooting extension keeps the saved segment and integration settings.
- For runs with any fixed homoclinic extras (`Free T`/`Free eps0`/`Free eps1` off), extension requires saved branch metadata.

## Special-Point Diagnostics

Every corrected homoclinic point records the HBK-style test channels that are mathematically
available for its saddle spectrum. All implemented channels are localized and labeled with the
standard codes:

- neutral types: `NNS`, `NSF`, `NFF`;
- leading-spectrum interactions: `DRS`, `DRU`, `NDS`, `NDU`, `TLS`, `TLU`;
- center-boundary interactions: `NCH`, `SH`, `BT`;
- orbit flips: `OFS`, `OFU` when the required normalized adjoint data are available.

In the audited HBK 0.2.1 source, the ordered `TLS`/`TLU` gaps are one-sided and the
`NCH`/`SH`/`BT` values are one-sided until the selected eigenvalue disappears at loss of
hyperbolicity; its sign-crossing event handler therefore cannot normally bracket them. Fork tracks
real eigenvalues and conjugate-pair representatives between corrected steps. It localizes
`TLS`/`TLU` using a signed real-branch/pair separation while preserving the raw touching gap,
tracks the same center mode through zero for `NCH`/`SH`, and emits `BT` only after two center modes
are verified at the refined point. Identity tracking prevents a mere nearest-mode reorder from
creating a false center marker.

The point inspector in web and CLI shows each test value together with availability and a reason when
a channel does not apply to the current real/focus configuration. `IFS` and `IFU` are reported as
unsupported rather than as numerical zeros because HBK 0.2.1 also leaves these inclination-flip
channels as placeholders. Fork uses `Re(lambda1) - Re(lambda3)` for the raw `TLU` diagnostic;
HBK 0.2.1's literal plus sign cannot vanish while both leading rates remain unstable.

### Frozen-variable subsystem invariants (extension)

When extending homoclinic branches in frozen-variable subsystems:

- Endpoint state must be a valid packed homoclinic point for the branch's source mesh (`ntst/ncol`) in the subsystem's reduced dimension.
- Extension decode uses the saved homoclinic basis dimensions (`nneg`, `npos`) from branch context/setup, rather than inferring them from trailing packed-state length.
- Extension resumes from saved endpoint metadata (`resume_state`) and, for fixed-extra runs, compatible `homoc_context` (`fixed_time`, `fixed_eps0`, `fixed_eps1`, basis snapshot).
- If any of those decode/resume contracts are missing or incompatible, extension fails fast with an explicit error instead of silently switching continuation methods.

## Why Extension Can Jump (and How Fork Prevents It)

A large first-step jump at extension startup usually means the solver did not resume from a true continuation endpoint state and tangent. In that case, the predictor can launch from a less-local direction than the branch geometry near the endpoint.

Fork uses endpoint resume metadata (`augmented state + tangent`) when extending from either side of a branch. For fixed-extra homoclinic runs, extension also uses saved fixed scalar metadata (`T`, `eps0`, `eps1`) so the defining system remains consistent across continuation and extension. If required endpoint/metadata decoding is unavailable, extension fails fast with an actionable error instead of silently switching methods.

This keeps extension behavior continuous with the existing branch and avoids hidden restart logic.

## Endpoint Distance Interpretation (`eps0`, `eps1`)

For homoclinic continuation, `eps0` and `eps1` are endpoint distances from the saddle equilibrium:

- `eps0 = ||u(0) - x0||`
- `eps1 = ||u(1) - x0||`

Interpretation:

- Smaller values mean endpoints lie closer to the local manifold neighborhood near the saddle.
- If endpoint distances suddenly grow after extension starts, you likely launched with a nonlocal first predictor step or an under-resolved mesh.
- Stable runs usually show gradual evolution of `eps0/eps1`, not abrupt jumps at the extension seam.

## Validated Duffing Reference Fixture

Fork's deterministic Methods 1/2/4 regression uses the two-parameter Duffing flow

$$
\dot{x}=y, \qquad
\dot{y}=x-x^3+(\mu-\nu)y.
$$

When `mu = nu`, the system is conservative and has a family of periodic orbits

$$
x(t)=A\,\operatorname{dn}(\omega t,k), \qquad
A^2=\frac{2}{2-k^2}, \qquad
\omega^2=\frac{1}{2-k^2}.
$$

For

$$
H(x,y)=\frac{y^2}{2}-\frac{x^2}{2}+\frac{x^4}{4},
$$

the perturbed flow satisfies

$$
\dot H=(\mu-\nu)y^2.
$$

A nonconstant homoclinic orbit returns to the same saddle energy, so integrating this identity makes `mu = nu` the exact homoclinic locus.

As `k` approaches one, the period diverges and this family approaches the homoclinic loop to the saddle `(0, 0)`. The fixture uses `k = 0.99`, samples the resulting cycle on `NTST = 32`, `NCOL = 2`, and converts it to a homoclinic mesh with `NTST = 8`, `NCOL = 2`.

Reproducible Method 1/2 settings and Method 4 CLI/WASM target settings:

- `Free T = on`, `Free eps0 = off`, `Free eps1 = off`
- `Initial step size = 1e-4`, `Min step size = 1e-9`, `Max step size = 1e-3`
- `Max points/accepted steps = 3`, `Corrector steps = 32`
- `Corrector tolerance = 1e-8`, `Step tolerance = 1e-8`

Expected diagnostics:

- The core Method 1 result produces the seed plus three accepted points; the CLI intentionally discards the large-cycle approximation seed and persists the three accepted points.
- Standard-shooting Method 1 uses eight shooting intervals with 64 integration steps per segment
  in the menu smoke and likewise persists the three corrected points after discarding its sampled
  collocation seed.
- Method 2, restarted from the first accepted Method 1 point, produces the seed plus three accepted points.
- Method 4, initialized from a homoclinic-ready StageD profile encoded with the staged workflow's source flags, produces the seed plus three accepted points.
- The core StageD conversion helper, which retains the StageD `T`/`eps1` free flags, also accepts all three requested steps; the CLI/WASM regression additionally changes the target to the `T`-only layout above.
- The accepted points remain on a line parallel to the analytic locus `mu = nu`: the spread in `mu - nu` is below `1e-8`. With the intentionally small `8 x 2` target mesh, the absolute offset from the analytic locus is below `5e-4`.

Run the core and CLI/WASM certifications with:

```bash
cargo test -p fork_core --test homoclinic_reference
cd cli && npm run test:wasm && npm run test:homoclinic-menu
```

The menu smoke drives the actual Method 1, 2, and 4 configuration menus, including collocation,
standard shooting, nonuniform source meshes, and shooting restart. It edits the certified settings
above through `inquirer`, crosses the Node-WASM bridge, and verifies the resulting branches are
persisted with more than one point. Method 2 requires the source branch's packed layout, exact mesh
or shooting metadata, and fixed-scalar context. Method 4 requires a corrected StageD-compatible profile encoded with its
source free/fixed flags; changing the target flags happens only after decoding that source layout.

The Method 4 fixture certifies StageD decoding, conversion, and continuation independently of StageD generation: it re-encodes an accepted homoclinic connection using the fixed StageD source layout (`T` and `eps1` free, `eps0` fixed). Conversion must decode that source layout before applying the target free/fixed choices. The heuristic Method 3 stage-generation path is not used as evidence that an arbitrary StageD profile is already a corrected homoclinic connection.

## Troubleshooting Playbook

| Symptom | Likely Cause | What to Try (in order) |
|---|---|---|
| Stops at seed point or endpoint | Predictor step too large for local geometry | 1) Lower initial step by 10x (`0.01 -> 0.001`) 2) Increase corrector steps 3) Tighten mesh (`NTST`) |
| Continuation seems to vary mostly one parameter | Chosen parameter pair has weak sensitivity in current region | 1) Confirm both parameters are distinct and active 2) Restart from same point with a different parameter pair |
| Frequent correction failures after a few points | Step growth too aggressive or local curvature high | 1) Lower max step size 2) Increase corrector steps 3) Tighten tolerances |
| Branch is noisy or has poor geometric quality | Mesh too coarse for orbit shape | Increase `NTST` first, then `NCOL` if needed |
| Standard shooting corrector fails near the seed | Too few shooting segments or insufficient segment integration resolution | 1) Increase shooting intervals 2) Increase integration steps per segment 3) Reduce the initial continuation step |
| Method 3 does not reach StageD | Seed scaling/time window mismatched | 1) Increase `T` 2) Reduce `eps0`/`eps1` modestly 3) Increase max points |
| Extension fails but branch itself is valid | Current branch settings/mesh not good for farther region | Create explicit restart (Method 2 or Method 4 path) with remeshed `NTST/NCOL` and then continue |
| First extension point jumps far in parameter space | Local endpoint tangent/step was not appropriate | 1) Reduce initial step size 2) Ensure extension uses a branch with valid endpoint history 3) Re-seed via explicit Method 2 if needed |
| `eps0/eps1` become much larger right after extension | First extension predictor left local manifold neighborhood | 1) Lower initial and max step sizes 2) Increase `NTST` 3) Reinitialize with explicit homoclinic restart |
| `Large-cycle point dimension mismatch for the selected frozen-variable subsystem.` | Large-cycle packed state was interpreted in full dimension instead of reduced subsystem dimension | 1) Confirm source limit-cycle branch/object snapshot and free-variable count 2) Recompute source branch after frozen-config changes 3) Retry with the same frozen snapshot context |
| `Continuation init failed: Decoded Riccati dimensions do not match setup basis` | Packed homoc point decode used/inferred Riccati dimensions that do not match saved setup basis | 1) Recompute from source branch point with current build 2) Keep parameter plane fixed and retry 3) If persistent, restart via Method 2 with fresh seed |
| `Failed to decode the homoclinic endpoint state for extension. Use explicit Homoclinic from Homoclinic with a valid packed point.` | Endpoint packed state or resume metadata is incompatible with extension decode contracts for the selected subsystem | 1) Verify endpoint belongs to current branch and has packed state 2) Recompute/restart the branch with current build to regenerate resume metadata 3) Use explicit Method 2 restart from a valid point, then extend |

## Recommended Operating Pattern

1. Build a clean source branch point (good cycle/equilibrium quality).
2. Start with default continuation settings.
3. If it fails, reduce initial step size first.
4. If failures persist, remesh (`NTST` up) before changing many tolerances.
5. Use Method 2 (or Method 4 from StageD) for controlled restarts instead of repeatedly forcing extension through a bad local discretization.
