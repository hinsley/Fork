# Experimental: 2D Stable/Unstable Manifolds of Limit Cycles

This document covers Fork's three `cycle_manifold_2d` backends, including the full
Hannam-Krauskopf-Osinga (HKO) fundamental-segment construction, their topology rules, and how to
interpret failures.

## Experimental Status

The workflow remains experimental because large nonlinear BVP families can be expensive and can
encounter genuine continuation limits. Its safety contracts are not experimental: a failed
collocation solve is rejected, an unresolved mesh is not returned as converged geometry, and
topologically distinct sheets are not joined.

## Eligibility and Floquet Mode Rules

For a 2D limit-cycle manifold, Fork requires exactly one **real, nontrivial transverse Floquet
direction** on the selected stable or unstable side. The orbit phase plus that direction gives the
two dimensions of the manifold.

- `real`: `|Im(mu)| <= 1e-8`
- `nontrivial`: `|mu - 1| > 1e-3`
- `stable manifold`: `|mu| < 1 - 1e-6`
- `unstable manifold`: `|mu| > 1 + 1e-6`

The trivial phase multiplier near `mu = 1` is intentionally excluded. A selected side with more than
one transverse direction is not silently reduced to an arbitrary 2D subset.

Topology depends on the sign of the real multiplier:

- `mu > 0`: the Floquet line bundle is orientable. `Plus` and `Minus` seed two distinct surface
  branches. The plural core API returns both when `Both` is requested; the Web and CLI run one at a
  time.
- `mu < 0`: the direction is anti-periodic after one period. Fork uses one continuous double cover
  with return time `2T`; it does not manufacture two sheets.

## UI and CLI Mapping

Web panel (`Inspector -> Invariant Manifolds -> 2D limit-cycle manifold`) exposes:

- `Kind`: `Stable` or `Unstable`
- `Floquet index`: filtered to eligible indices for selected kind
- `Direction`: `Plus` or `Minus` sheet orientation
- `Algorithm`: `Geodesic rings`, `Isochron fibers (HKO)`, or
  `Segmented preimage fibers (fast)`
- `Initial radius`
- `Leaf delta`
- `Ring points`
- `Integration dt`
- `Target arclength`
- `NTST`, `NCOL`
- caps: `Max steps`, `Max points`, `Max rings`, `Max vertices`, `Max time`

CLI exposes the same core controls. For a positive multiplier, `Direction` selects one of the two
orientable sheets. For a negative multiplier, its sign only fixes the parametrization of the same
double-covered surface.

## Algorithm Backends

### Isochron Fibers (HKO)

This is the faithful phase-foliated HKO workflow:

1. Decode and phase-order cycle profile from collocation state.
2. Compute and transport the selected Floquet direction around the cycle:
   - Primary: collocation monodromy interval transfers.
   - Fallback: variational transport when transfer path is unavailable.
3. At every cycle phase, start from the periodic-orbit BVP and continue its endpoint along the
   Floquet direction. Stop at the first local segment-length/nonlinear-departure event; this produces
   the nonlinear fundamental segment.
4. Continue a second collocation family whose endpoint traverses the fundamental segment. The other
   endpoint traces one isochron.
5. Promote the completed return segment to the next fundamental segment and repeat until the common
   fiber arclength is reached.
6. Resample every phase fiber at common arclength values and triangulate the resulting phase rings.

Every family is warm-started from the previous collocation solution. A nonconverged trial is rejected
and retried with a smaller continuation step; if the minimum step cannot converge or meet the spatial
spacing target, the run fails instead of appending that point. HKO uses at least 12 mesh intervals
and collocation degree 3 so numerical cycle-closure error is not mistaken for nonlinear lift-off.

### Geodesic Rings

This backend seeds a ring around the cycle and applies the same Krauskopf-Osinga-style leaf
continuation, adaptive spacing, geodesic quality checks, and genealogy triangulation used for
equilibrium surfaces. Use it when geodesic level sets are the desired parametrization.

### Segmented Preimage Fibers (Fast)

This is the former `IsochronFibers` backend under an accurate name. It repeatedly solves shorter,
fixed-return preimage BVPs starting from a linear Floquet offset. It is useful for previews and mildly
nonlinear tubes, but it does not construct or traverse the nonlinear HKO fundamental segment. It also
rejects every nonconverged collocation solve.

## Reading Branch Diagnostics

`Branch Summary -> Manifold solver diagnostics` is the primary debugging source.

Most informative counters:

- `Leaf fail: plane no-convergence`
- `Leaf fail: no first hit before max time`
- `Leaf fail: integrator non-finite`
- `Per-leaf delta reductions`
- `Geodesic rejects`
- `Spacing failures`
- `Failed ring`, `Failed attempt`, `Solved leaf points before fail`

Interpretation:

- High `plane no-convergence`: local leaf root solve is struggling.
- High `no first hit before max time`: leaves do not reach first plane target under current time cap.
- High `integrator non-finite`: trajectory enters singular/stiff/unstable region for current settings.
- High `Per-leaf delta reductions`: some geodesic leaves needed a smaller local distance, commonly
  near finite-length leaves or attractors.
- High `geodesic rejects`: ring geometry is too distorted for acceptance thresholds.
- `spacing adaptation failed (point_cap_exceeded)`: long edges remained after the allowed point cap,
  so the ring was rejected rather than returned under-resolved.

For HKO, `Termination detail` also reports the number of fundamental and isochron solves, rejected
nonconverged trials, achieved and requested common fiber arclength, maximum residual and Newton
iterations, and maximum fundamental-segment phase shear and normal lift-off. `termination =
max_steps` means at least one phase fiber exhausted its accepted continuation-point budget before the
requested common length. An exactly filled ring or vertex budget is still reported as
`target_arclength`; cap termination is reserved for actual truncation.

## Troubleshooting and Tuning

### Immediate `Ring Build Failed` on ring 1

For `Geodesic rings`, try in order:

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
4. Use `Segmented preimage fibers (fast)` for a preview before an HKO run.

### HKO continuation failure

1. Read the phase, family parameter, residual, and Newton-iteration count in the error.
2. Reduce `Initial radius` so the fundamental-segment construction remains in its local regime.
3. Reduce `Target arclength` and grow in stages.
4. Increase `NTST` or `NCOL` when residuals suggest the BVP mesh is too coarse.
5. Reduce `Integration dt` when the initial guesses or variational transport are rough.

`rejected_nonconverged > 0` in a successful run means adaptive retries were needed; none of those
rejected points is present in the returned mesh.

## Known Limitations (Current)

- Large nonlinear HKO families may require manual retuning per system.
- Uses real Floquet directions only (complex bundles are not yet exposed for LC 2D manifold seeding).
- Geodesic rings can still encounter folds or spacing growth that demand smaller steps or more mesh
  points.
- HKO can terminate at a genuine collocation fold or when the requested common fiber length is not
  attainable at every phase under the configured budgets.

## Developer Touchpoints

- Core solver: `crates/fork_core/src/continuation/manifold.rs`
- Floquet/monodromy plumbing: `crates/fork_core/src/continuation/periodic.rs`
- Settings types: `crates/fork_core/src/continuation/types.rs`
- Web eligibility logic: `web/src/system/floquetModes.ts`
- Web UI: `web/src/ui/InspectorDetailsPanel.tsx`
- CLI setup: `cli/src/continuation/initiate-lc.ts`
