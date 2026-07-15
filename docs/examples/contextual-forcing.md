# Contextual forcing examples

## Time-forced flow

Use a flow with state variables `x, v`, parameters `gamma, omega`, and equations

```text
v
-gamma*v - x + 0.2*cos(omega*t)
```

An orbit started at `t0 = 3` evaluates the forcing at time 3 and advances through the solver's
Runge-Kutta stage times. Freeze `t` on an equilibrium, isocline, or limit-cycle object to inspect an
instantaneous autonomous skeleton. On a frozen flow object, `t (frozen forcing context)` can be
selected as a continuation coordinate.

To compute a phase-locked response, declare periodic forcing with period expression
`tau / omega`, leave equation time live, and create a **Forced periodic response** object. A phase
of `0` strobes at integer forcing periods. Continuing in `omega` includes the derivative of the
period and integration endpoint.

## Iteration-forced map

Use a one-dimensional map with parameter `r` and equation

```text
r*x*(1-x) + 0.01*sin(n)
```

An orbit started at `n0 = -4` evaluates iterations `-4, -3, -2, ...`, one unit at a time. Freeze an
integer `n` to solve fixed points or inspect a static cobweb function curve for that skeleton.
Frozen `n` is deliberately not a continuous continuation parameter.

For a period-two forcing such as `a*cos(pi*n)`, declare iteration period `2`. A phase residue of
`1` evaluates the return operator at `n = 1, 2`; response multiple `m` composes exactly `2m`
iterations and stores their live iteration contexts.
