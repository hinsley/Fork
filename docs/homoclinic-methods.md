# Homoclinic and Homotopy-Saddle Methods (Methods 1, 2, 4, 5)

This guide explains how to run the four homoclinic-related workflows implemented in Fork:

- Method 1: Homoclinic continuation from a large-period limit cycle branch point
- Method 2: Homoclinic continuation restart from an existing homoclinic branch point
- Method 4: Homoclinic continuation from a StageD homotopy-saddle branch point
- Method 5: Homotopy-saddle continuation from an equilibrium branch point

All numerical computation runs in Fork Core (Rust + WASM) through the existing continuation/autodiff machinery.

## Requirements

- System type must be `flow` (ODE), not `map`
- At least two system parameters are required for these methods
- Select a branch point before running any of these workflows

## Method 1: Homoclinic from Large Cycle

Start from a point on a `limit_cycle` continuation branch.

CLI:
1. Open the limit cycle branch and inspect a point.
2. Choose `Continue Homoclinic Curve (Method 1)`.
3. Configure `param1`, `param2`, target `NTST/NCOL`, free variables (`T`, `eps0`, `eps1`), and continuation settings.

Web:
1. Select a limit cycle branch and a branch point.
2. Open `Homoclinic from Large Cycle` in Inspector.
3. Fill parameters and settings, then submit.

Output: a new `homoclinic_curve` branch.

Recommended seed settings for robust starts from long cycles:

- `Free T = false`
- `Free eps0 = true`
- `Free eps1 = true`
- Small predictor step (for example `1e-3`) and tighter corrector tolerances.

## Method 2: Homoclinic from Homoclinic

Start from a point on an existing `homoclinic_curve` branch.

CLI:
1. Open the homoclinic branch point.
2. Choose `Continue Homoclinic Curve (Method 2)`.
3. Set target mesh, free variables, and continuation settings.

Web:
1. Select a homoclinic branch and branch point.
2. Open `Homoclinic from Homoclinic`.
3. Configure restart settings and submit.

Output: a new `homoclinic_curve` branch (restart/continuation).

## Method 5: Homotopy-Saddle from Equilibrium

Start from a point on an `equilibrium` branch.

CLI:
1. Open an equilibrium branch point.
2. Choose `Continue Homotopy-Saddle (Method 5)`.
3. Configure active parameters, `NTST/NCOL`, `eps0`, `eps1`, `T`, `eps1_tol`, and continuation settings.

Web:
1. Select an equilibrium branch point.
2. Open `Homotopy-Saddle from Equilibrium`.
3. Enter initialization and continuation settings, then submit.

Output: a new `homotopy_saddle_curve` branch with stage metadata.

## Method 4: Homoclinic from Homotopy-Saddle

Start from a point on a `homotopy_saddle_curve` branch that has reached `StageD`.

CLI:
1. Open a StageD homotopy-saddle branch point.
2. Choose `Continue Homoclinic Curve (Method 4)`.
3. Configure target mesh, free variables, and continuation settings.

Web:
1. Select a homotopy-saddle branch point.
2. Verify stage is `StageD` in `Homoclinic from Homotopy-Saddle`.
3. Submit the homoclinic continuation settings.

Output: a new `homoclinic_curve` branch seeded from the StageD point.

## Interpreting Branch Point Diagnostics

For homoclinic/homotopy branches, Inspector/CLI expose branch metadata and point diagnostics, including:

- Active parameters (`param1`, `param2`)
- Homotopy stage (for `homotopy_saddle_curve`)
- Packed-state endpoint diagnostics (`T`, `eps0`, `eps1`, and endpoint distances when available)

## Notes

- If continuation stops at or near the seed point, lower initial step size and/or tighten mesh/corrector settings.
- For Method 4, StageD is required by design before conversion to homoclinic continuation.
