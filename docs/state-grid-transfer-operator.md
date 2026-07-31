# State Grid transfer operator

The transfer-operator analysis currently supports discrete maps on a fixed regular State Grid.
For each source cell, Fork evaluates a deterministic low-discrepancy sample set and routes every
sample through the configured number of map iterates. A target endpoint on the upper grid boundary
belongs to the last cell. An endpoint outside the closed grid is dropped.

The stored sparse columns define a conditional transfer operator. For each source cell with one or
more in-grid endpoints, Fork divides each target count by that source cell's in-grid count, so every
eligible column sums to one. A source cell with no in-grid endpoints is excluded and counted in the
result. The stationary iteration runs on the eligible source domain without global renormalization;
it rejects a domain that is not closed because a transition enters an excluded source cell. The
result records retained mass, excluded-source count, the final L1 residual, and iteration count.

For one, two, and three state variables, a Scene renders positive stationary mass at cell centers.
Marker size is fixed. Mass is mapped logarithmically to marker alpha from 15% to 100%, and the
State Grid render opacity multiplies that alpha. Zero mass has no marker. Systems with more than
three state variables are not rendered as a misleading state-space projection in this slice.
