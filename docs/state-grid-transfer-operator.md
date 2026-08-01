# State Grid transfer operator

The transfer-operator analysis currently supports discrete maps on a fixed regular State Grid.
For each source cell, Fork evaluates a deterministic low-discrepancy sample set and routes every
sample through the configured number of map iterates. A target endpoint on the upper grid boundary
belongs to the last cell. An endpoint outside the closed grid is dropped.

Running the analysis creates a separate Invariant Measure object. The State Grid retains the
bounds, resolution, subsystem configuration, and method settings for later analyses. The new object
stores the complete result snapshot and a stable link to its source State Grid, then owns its own
name, visibility, color, opacity, and point size. Editing or deleting the source grid does not alter
an already computed measure.

The stored sparse columns define a conditional transfer operator. For each source cell with one or
more in-grid endpoints, Fork divides each target count by that source cell's in-grid count, so every
eligible column sums to one. A source cell with no in-grid endpoints remains a zero column and is
counted in the result. In-grid transitions are retained even when their target cell has no surviving
source samples. The stationary iteration returns the normalized dominant mode of this nonnegative
operator and its leading eigenvalue. When that eigenvalue is approximately one, the result is a
mass-preserving invariant measure; below one, the result is a leaky finite-box mode and the leading
eigenvalue exposes the per-application retention. The result also records retained sample mass,
excluded-source count, the final L1 residual, and iteration count.

For one, two, and three active grid variables, a Scene renders positive mode mass at cell
centers. Every marker in one measure has the same user-selectable size. Mass is mapped
logarithmically to marker alpha from 15% to 100%, and the Invariant Measure object's opacity
multiplies that alpha once. Zero mass has no marker. Frozen coordinates are restored from the
stored subsystem snapshot before applying the Scene's axis order. Results with more than three
active grid variables are stored but are not rendered as a misleading state-space projection.

## Example: Logistic map

1. Open the built-in `LogisticMap` system. It is the discrete map
   `x[n+1] = r*x[n]*(1-x[n])` with `r = 3.9`.
2. Create a State Grid from the Objects menu.
3. Open **State Grid setup** and set the `x` bounds to `0` and `1`, with resolution `100`.
4. Open **Invariant measure**. Keep `4` samples per cell, `1` map iteration per transition,
   stationary iteration limit `2000`, and convergence tolerance `1e-10`.
5. Choose **Create invariant measure**.
6. If the system has no viewport yet, choose the `+` under the object tree and create a
   **State Space Scene**.

Fork creates and selects `Invariant_Measure_State_Grid_1`. In a Scene, the separate object appears
as fixed-size points along the state axis; more opaque points have larger mode mass. With the
settings above, the closed region retains all sampled endpoints and the distribution is visibly
nonuniform.
