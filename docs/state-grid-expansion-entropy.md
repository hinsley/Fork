# State Grid and expansion entropy

## Scope

A State Grid is a bounded regular Cartesian grid in the full state space. Each state variable has
a minimum, maximum, and resolution. The first analysis on this object is Hunt–Ott expansion
entropy for autonomous flows and discrete maps. Adaptive subdivision, box maps, and invariant sets
are not part of this slice. See `state-grid-transfer-operator.md` for the separate transfer
operator and invariant-measure analysis.

The object is general on purpose. Its stable type is `state_grid`. The stored `analysis` field is a
tagged choice. Later analyses can use the same bounds and resolution without changing the object
identity or treating expansion entropy as the object itself.

## Finite-grid estimator

For a closed restraining region \(S\), let \(F_q\) be either the time-\(T\) flow map
\(\Phi_T\), with \(q=T\), or the \(n\)-fold iterate \(f^n\) of a discrete map, with \(q=n\).
Let \(\sigma_i\) be the singular values of \(DF_q(x)\). Fork uses the Hunt–Ott expansion factor

$$
G(DF_q(x)) = \prod_i \max(1,\sigma_i(DF_q(x))).
$$

The State Grid defines one sample at the center of every Cartesian cell. If there are \(N\) grid
points, Fork computes

$$
E(q) = \frac{1}{N}\sum_{x_j \text{ survives to } q} G(DF_q(x_j)).
$$

A trajectory survives only while every state coordinate remains inside its closed configured
interval. For flows, Fork checks this condition after each fixed integration step. A trajectory
that exits and re-enters between two flow-step endpoints is not detected, so the step size is part
of the escape-policy resolution. For maps, Fork checks the condition after every iterate. In both
cases, a sample contributes zero at and after the first detected escape. The denominator remains
the total initial grid size \(N\), not the survivor count.

Fork records the convergence curve

$$
h(q) = \frac{\log E(q)}{q}.
$$

The displayed final value is the last finite-horizon value: \(h(T_{\max})\) for a flow or
\(h(n_{\max})\) for a map. It is not an exact unrestricted topological entropy and it is not an
automatically fitted asymptotic slope.
If no sample survives at a checkpoint, Fork displays \(-\infty\) and stores that value as `null`
so archive JSON remains valid.

## Numerical method

- Initial states are deterministic Cartesian cell centers. This is a uniform midpoint quadrature
  rule on the configured region.
- A flow and its full tangent matrix are integrated together with the system's RK4 or Tsit5
  solver.
- A map is evaluated once per iteration and its full tangent matrix is updated as
  \(\Phi_{k+1}=Df(x_k)\Phi_k\). Convergence checkpoints are iteration counts; the flow step-size
  setting is not used.
- The Jacobian comes from Fork's existing forward-mode automatic differentiation of the compiled
  system equations.
- The tangent matrix starts at the identity.
- At the configured stabilization stride, the complete tangent matrix is divided by its largest
  absolute entry. The removed logarithmic scale is accumulated separately.
- At each checkpoint, Fork computes singular values of the scaled matrix, restores their common
  logarithmic scale, and sums only positive singular-value logarithms.
- Ensemble sums use log-sum-exp. This avoids constructing raw expansion products.
- Fork records the largest observed logarithmic condition number. It warns when the singular-value
  spread exceeds the reliable floating-point range.

Global rescaling preserves the full finite-time tangent map up to a scalar. It avoids simple
overflow but does not make arbitrarily ill-conditioned tangent maps exact. A conditioning warning
means that the user should shorten the horizon or stabilization stride and compare convergence
results.

## Execution

Rust partitions the deterministic sample order into logical ranges of 16 points and processes up to
eight ranges per progress advance. A threaded build may schedule those ranges concurrently, but it
always merges them in logical-range order. The serial and parallel paths therefore produce
bitwise-identical aggregate results.

The web build uses a shared-memory Rust/WASM thread pool when the page is cross-origin isolated and
the browser exposes `SharedArrayBuffer`. Rust selects at most four worker threads from the reported
hardware concurrency. The browser only selects the compatible WASM bundle and initializes the
pool; it does not partition samples or reduce partial results. Browsers, installed PWAs, and hosts
without cross-origin isolation use the same Rust executor in serial mode. The result inspector
records which runtime completed the calculation.

Each logical range accumulates checkpoint values online with a log-sum-exp accumulator. Individual
sample checkpoint vectors are discarded after accumulation, so retained memory scales with the
number of logical ranges and checkpoints rather than the number of State Grid points.

## Relationship to the references

The estimator follows the restraining-region and survivor-weighted definition in
[Hunt and Ott, *Defining Chaos*](https://arxiv.org/abs/1501.07896).

Fork uses the State Grid's deterministic cell centers and exposes the full \(h(T)\) and
\(\log E(T)\) series, labeled by time for flows and iteration count for maps. It does not report
random-batch error bars or choose a scaling interval automatically. This makes the finite-grid
dependence visible and reproducible, but grid-refinement comparison is required for a convergence
study.

## Analytic checks

- For the map \(f(x,y)=(2x,\tfrac12 y)\), the tangent map is
  \(Df^n=\operatorname{diag}(2^n,2^{-n})\). A surviving sample therefore has
  \(\log G(Df^n)=n\log 2\), so the expected estimate is exactly \(\log 2\).
- For the contracting map \(f(x,y)=(\tfrac12 x,\tfrac14 y)\), every singular value is at most one.
  The expected expansion factor is one and the expected estimate is zero.

Both cases are covered in core, Node/WASM, and real-browser tests. The expanding check uses the
grid center at the fixed point so the chosen closed region does not introduce escape loss.

Set-oriented analysis separates a regular grid from box
collections and algorithms that refine or map those collections. Fork keeps the same conceptual
separation: State Grid is the reusable bounded discretization. Adaptive coverings, forward box
maps, and set-oriented refinement are future analysis modes, not hidden behavior in the current
object.
