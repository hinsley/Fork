# State Grid transfer operator

The transfer-operator analysis supports discrete maps and autonomous flows on a fixed regular State
Grid. The State Grid is the ambient partition. One editable starting point selects the only initial
cover cell; its default coordinate on each axis is the midpoint of that axis. Fork repeatedly maps
samples from newly reached cells and adds their in-grid target cells until the sampled forward cover
stops growing. It then assembles the operator only on that grown cover.

For each cover cell, Fork evaluates a deterministic low-discrepancy sample set. Maps route each
sample through the configured number of map iterates. Flows route each sample through the configured
fixed-time flow map Φτ using RK4 or Tsit5 integration steps no larger than the configured
integration step. The default flow-map time is `1`, and the default integration step is `0.01`.
This is a fixed-time sampling map, not a Poincaré return map. A target endpoint on the upper grid
boundary belongs to the last cell. An endpoint outside the closed grid is dropped.

Progress is reported in three phases. Cover exploration reports explored, discovered, and queued
cells without a percentage because the final cover size is not known yet. Once the cover closes,
transition construction reports completed source cells against the known cover size, along with
dynamics-step and sparse-edge counts. The stationary solve then reports iterations against its
configured limit and the current residual against the requested tolerance. The calculation yields
between bounded batches so cancellation can interrupt every phase.

Explicitly time-dependent flows are shown in the State Grid workflow but their invariant-measure
action is disabled until a phase-locked or otherwise non-autonomous construction is implemented.

Running the analysis creates a separate Invariant Measure object. The State Grid retains the
bounds, resolution, subsystem configuration, and method settings for later analyses. The new object
stores the complete result snapshot and a stable link to its source State Grid, then owns its own
name, visibility, color, opacity, and point size. Editing or deleting the source grid does not alter
an already computed measure.

The stored sparse columns define a conditional transfer operator on the grown cover. For each
source cell with one or more endpoints retained in that cover, Fork divides each target count by
that source cell's retained count, so every eligible column sums to one. A source cell with no
retained endpoints remains a zero column and is counted in the result. In-cover transitions are
retained even when their target cell has no surviving source samples. The stationary iteration
returns the normalized dominant mode of this nonnegative operator and its leading eigenvalue. When
that eigenvalue is approximately one, the result is a mass-preserving invariant measure; below one,
the result is a leaky finite-box mode and the leading eigenvalue exposes the per-application
retention. The result also records the starting cell, ambient-to-cover cell indices, cover-growth
passes, retained sample mass, excluded-source count, the final L1 residual, and iteration count.

For one, two, and three active grid variables, a Scene renders positive mode mass at cell
centers. Every marker in one measure has the same user-selectable size. Each positive mass is
mapped linearly relative to the maximum mass to marker alpha from 0% to 100%, and the Invariant
Measure object's opacity multiplies that alpha once. Zero mass has no marker. Frozen coordinates
are restored from the stored subsystem snapshot before applying the Scene's axis order. Results
with more than three active grid variables are stored but are not rendered as a misleading
state-space projection.

## Example: Logistic map

1. Open the built-in `LogisticMap` system. It is the discrete map
   `x[n+1] = r*x[n]*(1-x[n])` with `r = 3.9`.
2. Create a State Grid from the Objects menu.
3. Open **State Grid setup** and set the `x` bounds to `0` and `1`, with resolution `100`.
4. Open **Invariant measure**. Keep `4` samples per cell, `1` map iteration per transition,
   the default starting point `0.5`, stationary iteration limit `2000`, and convergence tolerance
   `1e-10`.
5. Choose **Create invariant measure**.
6. If the system has no viewport yet, choose the `+` under the object tree and create a
   **State Space Scene**.

Fork creates and selects `Invariant_Measure_State_Grid_1`. In a Scene, the separate object appears
as fixed-size points along the state axis; more opaque points have larger mode mass. With the
settings above, the closed region retains all sampled endpoints and the distribution is visibly
nonuniform.

## Flow interpretation

For an autonomous flow, the fixed-time map Φτ supplies the same finite-box transition operator
used for maps. The flow-map time controls τ, while the integration step controls the numerical
resolution of each application of Φτ. A result with leading eigenvalue approximately one is
mass-preserving on the retained cover. A result below one remains a leaky finite-box mode;
conditional column normalization does not turn it into a globally mass-preserving invariant
measure.
