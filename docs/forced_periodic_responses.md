# Periodic stroboscopic forced responses

Fork continues phase-locked responses of periodically forced systems with a stroboscopic return
map. This workflow does not add time or forcing phase to the state. It is separate from autonomous
limit-cycle continuation, whose default remains orthogonal collocation.

For a flow with declared period `T(p)`, phase fraction `phi`, and response multiple `m`, the return
operator integrates from `phi*T` for `m*T`. The configured RK4 or Tsit5 method takes exactly
`m * stepsPerForcingPeriod` steps. For a map with declared iteration period `q`, integer phase
residue `r`, and response multiple `m`, the operator composes the map at contexts
`r, r+1, ..., r+mq-1`. Periodic state coordinates are wrapped after every step, and Newton uses the
shortest wrapped residual.

The defining equation is

$$
P_{p,\phi}^{m}(x)-x=0.
$$

State and continuation-parameter derivatives are propagated by dual numbers through the complete
return operator. For flows this includes derivatives of `T(p)`, the phase-dependent starting time,
the integration endpoint, and the RK step size. A period such as `tau / omega` therefore changes
correctly during frequency continuation.

## Period declarations

Flow period expressions use the ordinary expression language but may reference only parameters and
built-in constants. They may not reference state variables, `t`, or `n`, and must evaluate to a
finite positive value at the current parameters and every continuation trial. Map periods are
positive safe integers. The declaration is a trusted mathematical contract: Fork verifies that the
equations use the matching contextual symbol, but it does not prove global periodicity.

The object-local phase is normalized modulo one for flows and modulo `q` for maps. A positive
integer response multiple `m` requests an `mT` or `mq` response. If Newton converges to a response
with a smaller divisor, Fork records and reports that lower multiple.

## Stability and bifurcations

The eigenvalues of the stroboscopic monodromy matrix are the response multipliers. Fork monitors
`det(M-I)` for forced-response folds, a multiplier crossing `-1` for period doubling, and a complex
pair crossing the unit circle for Neimark-Sacker bifurcations. These points are localized by the
existing PALC event machinery. The spectrum has no artificial neutral phase multiplier because
phase was not appended as a state coordinate.

Branch switching, forced-response normal forms, and two-parameter forced-response curves are not
part of this release. Compact phase augmentation and quasiperiodic multi-angle continuation are also
separate follow-ups.

## Live forcing versus frozen skeletons

Stroboscopic analysis requires live `t` or `n`. Freezing the equation forcing context disables the
workflow with `Stroboscopic analysis requires live t/n. Unfreeze the equation forcing context.`
Frozen state variables remain valid continuation coordinates. The live forcing context itself is
never offered as a continuation coordinate.

This does not relax any autonomous-analysis guard. Declaring a forcing period does not make a live
nonautonomous equilibrium, autonomous limit cycle, invariant manifold, or connecting orbit valid;
freeze the forcing context to study that instantaneous skeleton instead.
