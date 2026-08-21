# Numerical Contracts

These invariants are load-bearing. Optimizations and refactors must preserve
them; several exist because a regression already happened once. Primary source:
`docs/DECISIONS.md` in the repository.

## One algorithm set, no platform LAPACK

All dense and structured linear algebra is pure Rust (nalgebra plus in-house
factorizations). There is no platform LAPACK anywhere, native or browser.

**Why:** browser and native builds must produce identical numerics from one
source tree.
**Consequence:** performance work must come from algorithmic structure — never
by swapping in a platform BLAS.

## Floquet spectra are product-free

Limit-cycle multipliers are extracted by eliminating collocation stages to get
interval transfer matrices and solving one block-cyclic eigenproblem — never by
forming the monodromy product $\Phi = T_{N} \cdots T_2 T_1$, which loses strongly
contracting modes on long or stiff cycles. Above block dimension 96 the
block-cyclic path switches to a product-free periodic Schur decomposition.

**Consequence:** any new Floquet consumer must take transfers from the
collocation Jacobian, not integrate a variational product. Cross-backend
regression tests (block-cyclic vs periodic Schur) must stay green.

## Collocation-native PALC

Periodic-orbit problems use quadrature-weighted pseudo-arclength metrics so
tangent normalization does not jump when the adaptive mesh redistributes.
Mesh layout changes are semantically meaningful: a point serialized before an
adaptation is transferred through explicit protocol hooks
(`transfer_branch_states_to_current_discretization`) rather than reinterpreted.

**Consequence:** caching keyed on state identity must account for mesh identity;
never "simplify" the metric back to Euclidean weights.

## Gauges freeze between steps

Phase conditions (limit cycles, connection orbits) evaluate against a reference
profile captured once per accepted point and frozen across the corrector's
Newton iterations. Re-parameterization happens only through the engine's
transactional post-corrector hook.

**Why:** rejected corrector trials must not drift the phase reference.
**Consequence:** diagnostics computed after a tangent construction must see the
accepted base point, not intermediate Newton iterates.

## Forcing stays out of the state

Periodically forced systems use a fixed-phase stroboscopic return map with the
forcing period declared externally; forcing context is delivered through
contextual bytecode, not by augmenting the state vector.

**Consequence:** dimension-preserving contracts elsewhere (PALC layouts,
resume seeds) can assume state dimension equals physical dimension.

## Border vectors freeze between steps

Fold-of-cycles and Neimark-Sacker defining systems hold their border vectors
fixed while Newton corrects a step, adapting them only at accepted points from
the current operator's smallest singular directions.

**Historical note:** the Chenciner locator once spent minutes recomputing a
return-map normal form twice per unknown solely to form a finite-difference
conditioning row. When adding derivative information, prefer projecting onto
the curve tangent over recomputing expensive forms inside inner loops.

## What this means for optimization work

1. Measure first; the profile decides the target. Past hot spots have been
   finite-difference Jacobians stacked on factorizing residuals and redundant
   normal-form recomputation — not the expression VM.
2. Forward-mode autodiff has no asymptotic advantage over one-sided differences
   for dense Jacobians. Wins come from exploiting structure (bordered adjoint
   identities, block-condensed solves), which requires deriving the gradient of
   the *defining system*, not differentiating residuals harder.
3. Every analytic-Jacobian replacement ships with a retained finite-difference
   reference and a cross-check test (see
   `lpc_curve.rs::analytic_extended_jacobian_matches_finite_difference`).
