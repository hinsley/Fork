# Homoclinic and Homotopy-Saddle User Guide (Methods 1, 2, 4, 5)

This guide explains the four homoclinic-related workflows in Fork and how to tune them for stable continuation runs.

- Method 1: Homoclinic continuation from a large-period limit cycle point
- Method 2: Homoclinic continuation from an existing homoclinic branch point
- Method 4: Homoclinic continuation from a StageD homotopy-saddle point
- Method 5: Homotopy-saddle continuation from an equilibrium branch point

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

## Which Method to Use

| Method | Start From | Primary Use | Output |
|---|---|---|---|
| 1 | `limit_cycle` branch point | First homoclinic branch from a large cycle | `homoclinic_curve` |
| 2 | `homoclinic_curve` branch point | Restart/remesh/continue an existing homoclinic branch | `homoclinic_curve` |
| 4 | `homotopy_saddle_curve` StageD point | Convert staged seed into homoclinic continuation | `homoclinic_curve` |
| 5 | `equilibrium` branch point | Build StageD seed through staged continuation | `homotopy_saddle_curve` |

## Shared Continuation Settings (All Methods and Extension)

Current homoclinic/homotopy defaults:

- `Initial step size = 0.01`
- `Min step size = 1e-5`
- `Max step size = 0.1`
- `Max points = 300`
- `Corrector steps = 32` (homoclinic/homotopy specific default)

Field meanings:

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

| Field | Meaning | Practical Guidance |
|---|---|---|
| First parameter / Second parameter | Parameter plane for codim-1 homoclinic continuation | Choose two parameters with visible effect in your model |
| Target NTST | Number of mesh intervals for the orbit profile | Increase for long/steep orbits; lower for quick scouting |
| Target NCOL | Collocation polynomial order per interval | Usually keep moderate; increase only when profile needs higher local fidelity |
| Free T | Whether total homoclinic time is solved as unknown | Keep off initially unless continuation needs time re-adjustment |
| Free eps0 | Free start-endpoint distance from equilibrium | Usually on for robust starts |
| Free eps1 | Free end-endpoint distance from equilibrium | Usually on for robust starts |

### Method 2: Homoclinic from Homoclinic

Source: selected homoclinic branch point.

| Field | Meaning | Practical Guidance |
|---|---|---|
| Branch name | Name of the restarted branch | Use a restart suffix so provenance is obvious |
| Target NTST / Target NCOL | Restart mesh for the homoclinic profile | Use to remesh before long extension or after repeated failures |
| Free T / Free eps0 / Free eps1 | Which homoclinic extras remain unknowns | Start with same choices as source branch, then change one at a time |
| Parameter plane | Inherited from source homoclinic branch metadata | If you need a different parameter pair, start a new branch in the desired plane |

### Method 4: Homoclinic from Homotopy-Saddle

Source: selected StageD point on `homotopy_saddle_curve`.

| Field | Meaning | Practical Guidance |
|---|---|---|
| Branch name | Name of the converted homoclinic branch | Keep stage/source info in name for traceability |
| Target NTST / Target NCOL | Mesh used for conversion and continuation | Start moderate; raise if endpoint geometry is poorly resolved |
| Free T / Free eps0 / Free eps1 | Homoclinic extras in the converted problem | Same tuning logic as Method 2 |
| Parameter plane | Inherited from source homotopy-saddle branch metadata | Use a different StageD seed if you want a different continuation plane |

### Method 5: Homotopy-Saddle from Equilibrium

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

## Extension of Existing Homoclinic Branches

Use the same extension workflow as other continuation branches.

- Web: `Extend Branch` panel on the selected homoclinic branch
- CLI: `Extend Branch` from branch inspector

Extension uses the branch's existing continuation settings as defaults and only changes direction/length unless you edit settings.

Important behavior:

- Extension does one continuation attempt with your selected settings.
- There is no automatic retry and no automatic method switch during extension.

## Why Extension Can Jump (and How Fork Prevents It)

A large first-step jump at extension startup usually means the solver did not resume from a true continuation endpoint state and tangent. In that case, the predictor can launch from a less-local direction than the branch geometry near the endpoint.

Fork now prefers endpoint resume metadata (`augmented state + tangent`) when extending from either side of a branch. If that metadata is unavailable, fallback seeding uses only the local endpoint-neighbor secant. For homoclinic extension, if packed endpoint data cannot be decoded reliably, extension fails fast with an actionable error instead of silently switching methods.

This keeps extension behavior continuous with the existing branch and avoids hidden restart logic.

## Endpoint Distance Interpretation (`eps0`, `eps1`)

For homoclinic continuation, `eps0` and `eps1` are endpoint distances from the saddle equilibrium:

- `eps0 = ||u(0) - x0||`
- `eps1 = ||u(1) - x0||`

Interpretation:

- Smaller values mean endpoints lie closer to the local manifold neighborhood near the saddle.
- If endpoint distances suddenly grow after extension starts, you likely launched with a nonlocal first predictor step or an under-resolved mesh.
- Stable runs usually show gradual evolution of `eps0/eps1`, not abrupt jumps at the extension seam.

## Troubleshooting Playbook

| Symptom | Likely Cause | What to Try (in order) |
|---|---|---|
| Stops at seed point or endpoint | Predictor step too large for local geometry | 1) Lower initial step by 10x (`0.01 -> 0.001`) 2) Increase corrector steps 3) Tighten mesh (`NTST`) |
| Continuation seems to vary mostly one parameter | Chosen parameter pair has weak sensitivity in current region | 1) Confirm both parameters are distinct and active 2) Restart from same point with a different parameter pair |
| Frequent correction failures after a few points | Step growth too aggressive or local curvature high | 1) Lower max step size 2) Increase corrector steps 3) Tighten tolerances |
| Branch is noisy or has poor geometric quality | Mesh too coarse for orbit shape | Increase `NTST` first, then `NCOL` if needed |
| Method 5 does not reach StageD | Seed scaling/time window mismatched | 1) Increase `T` 2) Reduce `eps0`/`eps1` modestly 3) Increase max points |
| Extension fails but branch itself is valid | Current branch settings/mesh not good for farther region | Create explicit restart (Method 2 or Method 4 path) with remeshed `NTST/NCOL` and then continue |
| First extension point jumps far in parameter space | Local endpoint tangent/step was not appropriate | 1) Reduce initial step size 2) Ensure extension uses a branch with valid endpoint history 3) Re-seed via explicit Method 2 if needed |
| `eps0/eps1` become much larger right after extension | First extension predictor left local manifold neighborhood | 1) Lower initial and max step sizes 2) Increase `NTST` 3) Reinitialize with explicit homoclinic restart |

## Recommended Operating Pattern

1. Build a clean source branch point (good cycle/equilibrium quality).
2. Start with default continuation settings.
3. If it fails, reduce initial step size first.
4. If failures persist, remesh (`NTST` up) before changing many tolerances.
5. Use Method 2 (or 4 from StageD) for controlled restarts instead of repeatedly forcing extension through a bad local discretization.
