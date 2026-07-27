# Deflated equilibrium and map-cycle solves

Fork can keep a Newton solve away from selected known solutions. This first slice applies only to:

- equilibria of flow systems;
- cycles of discrete maps, including period-one cycles commonly called fixed points.

Flow cycles are not deflated.

## Method

For the original residual \(F(x)\) and known roots \(r_j\), Fork uses the shifted norm-deflation
operator

$$
D(x)=\prod_j\left(\lVert x-r_j\rVert^{-p}+\alpha\right)
$$

and applies Newton's method to \(D(x)F(x)=0\). The implementation uses the exact rank-one Jacobian
update after cancelling the common scalar \(D(x)\) from the Newton linear system. This avoids
forming very large residual and Jacobian entries near a selected root. Convergence is still tested
with the norm of the deflated residual, while stored results report the original residual norm.

The default exponent is \(p=2\). It gives a stronger local pole than norm deflation with \(p=1\).
The default shift is \(\alpha=1\). A positive unit shift makes the deflated residual approach the
original residual far from selected roots, which prevents false convergence caused only by the
unshifted multiplier approaching zero. These defaults follow the shifted squared-norm example in
[Farrell, Birkisson, and Funke](https://arxiv.org/abs/1410.5620). Both values are editable.
The exponent must be at least one, and the shift must be non-negative.

Periodic state coordinates use the shortest wrapped displacement when Fork computes the distance
to a selected root.

## Map cycles

A selected map cycle contributes every stored phase point to the deflation operator. A period-one
cycle contributes its single stored state. Deflating only one point from a higher-period cycle
would permit Newton to return the same cycle with a different phase representative.

The Solve Cycle menu lists every other solved map cycle. Target eligibility is not filtered by
cycle period. Period-one cycles and higher-period cycles use the same selection, persistence, and
root-expansion path.

## Solver setup and persistence

Open the Deflation control inside Solve Equilibrium or Solve Cycle. Select one or more targets and
edit the exponent or shift if needed. The selected targets and numerical parameters are stored on
that equilibrium or cycle solver object. Repeated solves reuse them until they are changed or
cleared.

Targets must still describe roots of the current equations, parameter values, and frozen-variable
subsystem. Fork rejects stale or incompatible targets and asks for them to be solved again.
