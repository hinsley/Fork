# Limit Cycle Continuation

This document describes how Fork implements limit cycle continuation, including initialization from orbit data and period-doubling points, the underlying numerical methods, and troubleshooting guidance.
Note: This document has not been fully human-reviewed; treat it as guidance and verify against current behavior.

## Table of Contents

1. [Overview](#overview)
2. [CLI Workflow](#cli-workflow)
3. [Limit Cycle from Orbits](#limit-cycle-from-orbits)
4. [Numerical Background](#numerical-background)
5. [Hopf Point Detection and Refinement](#hopf-point-detection-and-refinement)
6. [Limit Cycle Initialization from Hopf](#limit-cycle-initialization-from-hopf)
7. [Orthogonal Collocation Discretization](#orthogonal-collocation-discretization)
8. [The Continuation Problem](#the-continuation-problem)
9. [Newton's Method and the Jacobian](#newtons-method-and-the-jacobian)
10. [Branch Extension](#branch-extension)
11. [Floquet Multiplier Extraction](#floquet-multiplier-extraction)
12. [Best Practices for Accurate Floquet Multipliers](#best-practices-for-accurate-floquet-multipliers)
13. [Branching to Period-Doubled Limit Cycles](#branching-to-period-doubled-limit-cycles)
14. [Related: Isoperiodic Curve Continuation](#related-isoperiodic-curve-continuation)

---

## Overview

Fork supports two methods for initiating limit cycle continuation:

1. **From Orbit Data**: If you have an orbit that converges to a stable limit cycle (e.g., from numerical integration), Fork can extract one period and use it to initialize limit cycle continuation.
2. **From Period-Doubling (PD) Bifurcation**: When a limit cycle undergoes a period-doubling bifurcation, a new limit cycle family emerges with double the period. Fork can branch from a detected PD point to this new family.

For fixed-period continuation in a two-parameter plane (isoperiodic curves), see
[`docs/isoperiodic_curve_continuation.md`](./isoperiodic_curve_continuation.md).
For frozen-variable subsystem semantics and reduced/full-state projection rules, see
[`docs/frozen_variable_subsystems.md`](./frozen_variable_subsystems.md).

Note: Hopf-based initialization exists in the core but is not currently exposed in the UI or CLI.

### Key Concepts

- **Equilibrium continuation**: Tracking fixed points as a parameter varies
- **Hopf bifurcation**: Point where eigenvalues become purely imaginary (±iω)
- **Limit cycle**: Periodic orbit; represented as a closed curve in state space
- **Collocation**: Discretization method for boundary value problems

---

## CLI Workflow

### Step 1: Start Limit Cycle from Orbit

If you have an orbit that converges to a stable limit cycle, use it to seed continuation.

CLI path:
```
System Menu → Branches → Create New Branch → Limit Cycle Branch → [select orbit]
```

Web UI:
```
Inspector → Limit Cycle from Orbit → [select orbit] → Continue Limit Cycle
```

### Step 2: Configure LC Continuation

You'll be prompted for:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Cycle tolerance | 0.1 | Orbit recurrence tolerance for detecting a cycle |
| ntst | 20 | Number of mesh intervals |
| ncol | 4 | Collocation points per interval |
| Direction | forward | Continue in positive or negative parameter direction |
| Step size | 0.01 | Initial continuation step size |
| Max points | 50 | Maximum continuation steps |

Additional settings (min/max step size, corrector steps, corrector tolerance, step tolerance) are
available in the CLI configuration menu and the web Inspector for tighter control.

### Step 3: View Results

After continuation completes, you can inspect the limit cycle branch:
- Each point contains the full limit cycle profile
- Eigenvalues (Floquet multipliers) indicate stability
- Use the plotting script to visualize all cycles together
### Step 4: Branch to Double Period (PD only)

If a Period-Doubling (PD) bifurcation is detected (Floquet multiplier crosses -1):
1. Inspect the branch points and find the point marked "PeriodDoubling".
2. Select the point and choose "Branch to Period-Doubled Limit Cycle".
3. Configure the perturbation amplitude (default 0.01) and run continuation.

CLI path:
```
Branches → [select limit cycle branch] → Inspect Branch Points → [select PD point]
→ Branch to Period-Doubled Limit Cycle
```

Web UI:
```
Inspector → Limit Cycle from PD → [select Period Doubling point] → Continue Limit Cycle
```

---

## Limit Cycle from Orbits

When you have an orbit that converges to a stable limit cycle but no nearby Hopf bifurcation is known, you can initialize limit cycle continuation directly from the orbit data.

### When to Use This Method

- The system has a stable limit cycle discovered via simulation
- You want to track the limit cycle family as parameters vary
- No Hopf bifurcation is nearby or easily accessible
- You're working with a system where finding equilibria is difficult

### CLI Workflow

#### Step 1: Compute an Orbit

First, create an orbit that converges to the limit cycle:

```
System Menu → Objects → Create New Object → Orbit
```

**Important**: The orbit should:
- Run long enough to settle onto the attractor (bypass transients)
- Include at least 2-3 complete periods after settling
- Have sufficient time resolution (small dt or many iterations)

**Recommended duration**: At least 100× the expected period.

#### Step 2: Create Limit Cycle Branch

```
System Menu → Objects → [select orbit] → Create Limit Cycle Object (from this orbit)
→ [configure]
```

#### Step 3: Configure Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Cycle detection tolerance | 0.1 | Max distance to consider a "return" to reference point |
| ntst | 20 | Number of mesh intervals |
| ncol | 4 | Collocation points per interval |
| Step size | 0.01 | Initial continuation step size |
| Direction | forward | Parameter direction |
| Max points | 50 | Continuation steps |

Additional settings (min/max step size, corrector steps, corrector tolerance, step tolerance) are
available in the CLI configuration menu and the web Inspector.

Web UI:
```
Inspector → Limit Cycle from Orbit → Continue Limit Cycle
```

### Implementation Details

The orbit-to-LC algorithm follows the steps below:

#### 1. Trajectory Validation and Tail Search

For flows, the saved time coordinate must be finite and strictly increasing. Fork searches reference
points backward from the settled tail rather than choosing a fixed fraction of the trajectory. This
favors the latest, best-converged complete cycle while still leaving enough samples for a return.
Map Orbits are not accepted here because a flow period and flow collocation BVP cannot be inferred
from discrete iterations.

#### 2. Cycle Detection

For each tail reference, Fork first waits until the trajectory has left the tolerance ball. It then
accepts the first local distance minimum that re-enters the ball with the same direction of travel:

```
for ref_idx in reversed(tail_references):
    wait until |x[i] - x[ref_idx]| > tolerance
    for later i:
        if distance is a local minimum
           and distance <= tolerance
           and tangent directions agree:
            use [ref_idx, i] as one cycle
            break
```

Waiting for departure avoids the zero-lag return. The orientation check distinguishes crossings that
share the same observed state, including sparsely sampled scalar sequences, and prevents a two- or
three-period alias from being chosen when the minimal return is present. The period is
`T = times[cycle_end] - times[ref_idx]`.

#### 3. Remeshing to Collocation Grid

The detected cycle (from `ref_idx` to `cycle_end`) is linearly interpolated onto a uniform mesh:

```
for k in 0..ntst:
    tau = k / ntst  # Normalized time [0, 1)
    mesh_state[k] = interpolate(tau, cycle)
```

Stage (collocation) points are then computed by interpolating between mesh points at the Gauss-Legendre nodes.

#### 4. Fixed-Parameter BVP Correction

The remeshed Orbit is only a sampled guess. Before parameter continuation, Fork solves the complete
collocation BVP for all mesh states, stage states, and the period while holding the selected parameter
fixed. A scale-aware profile-variation test rejects collapse to an equilibrium, and an independent
off-node defect estimate rejects an under-resolved polynomial.

The serialized phase anchor/direction is retained for compatibility, but the actual BVP gauge is the
mesh-independent integral phase condition against the complete stage profile. Hopf and PD branch
predictors deliberately skip this fixed-parameter correction: they must be allowed to move away from
the bifurcation parameter in the first pseudo-arclength correction.

For backward-compatible metadata, the seed still records:

```
phase_anchor = mesh[0]
phase_direction = normalize(mesh[1] - mesh[0])
```

### Troubleshooting

#### "No cycle detected" Error

**Cause**: The orbit doesn't return close enough to the reference point within the tolerance.

**Solutions**:
1. **Increase tolerance** (e.g., 0.1 → 0.5) if the orbit sampling is coarse
2. **Compute a longer orbit** to include more complete cycles
3. **Reduce integration step size** for finer sampling

#### Period Is Wrong (Multiple Periods Detected)

**Cause**: The saved trajectory does not contain a resolved, same-orientation minimal return near its
settled tail.

**Solutions**:
1. Integrate for at least one more settled period
2. Reduce the orbit integration step so the first return has a local sample minimum
3. Adjust the return tolerance without making it large enough to merge distinct crossings

#### Newton Corrector Fails After Initialization

**Cause**: The initial guess from remeshing isn't accurate enough.

**Solutions**:
1. **Increase ntst** for better mesh resolution
2. **Increase orbit duration** for more accurate cycle extraction
3. **Check orbit quality** — ensure it's actually converged to the limit cycle

#### Low-Resolution Limit Cycle Plot

**Cause**: Only mesh endpoints are being plotted, not the full collocation profile.

**Solution**: The plotting script (`plot_lc_branch.py`) now extracts both mesh and stage states for full resolution. Update to the latest version.

### Comparison with Hopf Initialization

| Aspect | From Hopf | From Orbit |
|--------|-----------|------------|
| **Initial guess quality** | Excellent (analytical) | Good (numerical) |
| **Period accuracy** | Exact from eigenvalue | Approximate from sampling |
| **Requirements** | Hopf bifurcation point | Orbit converging to LC |
| **Unstable LCs** | Yes (can continue backward) | No (orbit won't converge) |
| **Transient handling** | Not needed | Searches backward through the settled tail |

## Numerical Background

### What Is a Limit Cycle?

A limit cycle is a periodic solution x(t) of an ODE system:

```
dx/dt = f(x, λ)
x(0) = x(T)
```

where T is the (unknown) period. We seek limit cycles that depend continuously on a parameter λ.

### Why Collocation?

Finding periodic orbits is a **boundary value problem** (BVP), not an initial value problem. Time-stepping methods (like RK4) can find stable limit cycles but fail for:
- Unstable limit cycles
- Accurate period determination
- Smooth continuation in parameters

**Orthogonal collocation** converts the BVP into a system of nonlinear algebraic equations that can be solved with Newton's method.

---

## Hopf Point Detection and Refinement

### Hopf Test Function

During equilibrium continuation, Fork monitors the **Hopf test function**:

```
ψ_Hopf = Π (λᵢ + λⱼ) for all eigenvalue pairs with Im(λᵢ) = -Im(λⱼ)
```

This product equals zero when two complex conjugate eigenvalues sum to zero (purely imaginary).

### Refinement

When ψ_Hopf changes sign between consecutive continuation points, Fork uses bisection to locate the exact Hopf point:

1. Binary search on the continuation parameter
2. At each trial point, recompute equilibrium and eigenvalues
3. Continue until |ψ_Hopf| < tolerance

The refined point gives:
- **x₀**: Equilibrium state at Hopf
- **λ₀**: Parameter value at Hopf
- **ω**: Imaginary part of critical eigenvalue (angular frequency)
- **q**: Eigenvector corresponding to eigenvalue iω

---

## Limit Cycle Initialization from Hopf

### The Challenge

At the Hopf point, the "limit cycle" has zero amplitude. We need a nonzero initial guess close enough for Newton's method to converge.

### Normal Form Theory

Near a Hopf bifurcation, the system's dynamics on the center manifold are described by the **Hopf normal form**:

```
dz/dt = (μ + iω)z + l₁|z|²z + O(|z|⁴)
```

where z ∈ ℂ is a complex amplitude. For μ ≠ 0 and l₁ ≠ 0, there exists a limit cycle with amplitude r satisfying:

```
r² ≈ -μ / l₁
```

### Eigenvector-Based Initialization

Fork uses the complex eigenvector q to construct an initial limit cycle guess using the Hopf normal form approximation.

#### Step 1: Eigenvector Rotation

In general systems, the real and imaginary parts of the Hopf eigenvector are **not orthogonal**. This causes problems with the phase condition (explained below). To fix this, Fork rotates the eigenvector $q \to q \cdot e^{i\phi}$ such that the resulting $Re(q)$ and $Im(q)$ are orthogonal:

```
d = ||Re(q)||²
s = ||Im(q)||²
r = Re(q) · Im(q)
φ = ½ atan2(2r, s - d)
q ← q · exp(i·φ)
```

After rotation, $Re(q) \perp Im(q)$, and $Re(q)$ is normalized to unit length.

#### Step 2: Initial Profile Construction

The initial limit cycle profile is sampled at each mesh point:

```
x(θ) = x₀ + A·[Re(q)·cos(2πθ) - Im(q)·sin(2πθ)]
```

for θ ∈ [0, 1], where:
- **x₀** is the equilibrium at the Hopf point
- **A** is the user-specified amplitude
- **Re(q), Im(q)** are the rotated eigenvector components

The initial period guess is:

```
T₀ = 2π / ω
```

#### Step 3: Phase Condition Setup

The phase condition pins the orbit's phase to avoid translational degeneracy. Fork sets:

- **Phase anchor**: x₀ (the Hopf equilibrium)
- **Phase direction**: Im(q) (the rotated imaginary part, normalized)

This choice is critical. The initial guess at θ=0 is:
```
x(0) = x₀ + A·Re(q)
```

The phase condition requires:
```
(x(0) - x₀) · phase_direction = 0
```

Substituting:
```
A·Re(q) · Im(q) = 0  ✓ (satisfied because Re(q) ⊥ Im(q))
```

If the phase direction were set to Re(q) instead, the condition would force A=0, collapsing the guess to the equilibrium. This subtle bug caused incorrect continuation direction in earlier Fork versions.

### Choosing the Amplitude

The amplitude parameter controls how far from the Hopf point the initial guess is placed:

- **Too small** (<0.01): The cycle is nearly degenerate; Newton may have trouble
- **Too large** (>1.0): Outside the basin of convergence
- **Sweet spot** (0.05–0.2): Usually works well

For subcritical bifurcations (l₁ > 0), you may need to step in the negative parameter direction to find stable cycles.

---

## Orthogonal Collocation Discretization

### Mesh Structure

The period [0, T] is divided into **ntst** intervals. Within each interval, we use **ncol** collocation points at Gauss-Legendre nodes.

```
Interval 1       Interval 2           Interval ntst
[----●--●--●----][----●--●--●----]...[----●--●--●----]
  c₁  c₂  c₃       c₁  c₂  c₃           c₁  c₂  c₃

● = collocation point
```

Fork stores `ntst` periodic mesh states and `ntst × ncol` Gauss stage states. The endpoint at
normalized time 1 is the first mesh state again; it is not stored as an independent unknown.

### Normalized Time

We use normalized time τ ∈ [0, 1] where:
- τ = 0 corresponds to t = 0
- τ = 1 corresponds to t = T

The actual time is t = τ · T.

### State Vector

At a fixed parameter, the collocation unknowns are:

```
u = [x_0, ..., x_(ntst-1), z_(0,1), ..., z_(ntst-1,ncol), T]
```

where:
- `x_i` is the state at the start of mesh interval `i`
- `z_(i,j)` is the state at Gauss node `j` in interval `i`
- T ∈ ℝ is the period

Total fixed-parameter unknowns: `ntst × (ncol + 1) × dim + 1`. Parameter continuation prepends
the free parameter to this vector.

### Lagrange Interpolation

Within each interval, the solution is represented by its left mesh state and Gauss-stage values.
The equivalent degree-`ncol` collocation polynomial is integrated with the Gauss Runge-Kutta
coefficients `A` and `b`.

The **Lagrange basis polynomials** L_j(s) satisfy L_j(s_k) = δ_jk at the collocation nodes s_k.

**Interpolation formula**:
```
x(s) = Σⱼ x(sⱼ) · Lⱼ(s)
```

**Derivative formula**:
```
dx/ds = Σⱼ x(sⱼ) · L'ⱼ(s)
```

---

## The Continuation Problem

### Residual Equations

The collocation BVP is the system of equations F(u) = 0 where:

#### 1. Collocation Equations (ntst × ncol × dim equations)

At each collocation point τ in interval i:

```
Σⱼ L'ⱼ(τ) · x(τⱼ) - T · f(x(τ), λ) = 0
```

The left side is the polynomial derivative; the right side is T times the ODE right-hand side.

#### 2. Continuity and Periodicity Equations (ntst × dim equations)

At the boundary between intervals i and i+1:

```
x_end(interval i) - x_start(interval i+1) = 0
```

where `x_end` is computed with the Gauss weights. For the last interval, `x_start(interval i+1)`
is `x_0`, so periodicity is the final continuity equation rather than a separate boundary row.

#### 3. Phase Condition (1 equation)

Periodic orbits have an arbitrary phase—we can shift t → t + Δt and get the same orbit. To remove this degeneracy, we add an **integral phase condition**:

```
∫₀¹ <x(τ) - x_old(τ), dx_old/dτ> dτ = 0
```

This says the new orbit is orthogonal (in L²) to translations of the old orbit along itself.

### The Augmented System

For pseudo-arclength continuation, the parameter is added as one extra unknown and the bordered
corrector adds one more equation:

```
<(u - u_pred), tangent>_W = 0
```

`W` uses quadrature-scaled profile weights and unit weights for the parameter and period. This keeps
tangent normalization, predictor size, and corrector damping approximately invariant when NTST or
NCOL changes.

LPC, PD, NS, and isoperiodic cycle curves use the same profile metric. Their explicitly stored closing
mesh point shares the periodic endpoint weight with the first mesh point, so duplicating that endpoint
does not change the pseudo-arclength norm.

The collocation BVP is square at fixed parameter. The free parameter plus the pseudo-arclength row
keeps the continuation corrector square as well.

---

## Newton's Method and the Jacobian

### Newton Iteration

Given a prediction u_pred, we solve the corrector equations:

```
J · Δu = -F(u)
u ← u + Δu
```

until the mesh-normalized residual is below the requested tolerance. A small Newton update with a
larger residual is treated as stagnation, not convergence.

### Jacobian Structure

The Jacobian J = ∂F/∂u has a specific sparsity pattern:

```
┌─────────────────────────────────┐
│ Collocation (banded + period)   │
├─────────────────────────────────┤
│ Continuity (links intervals)    │
├─────────────────────────────────┤
│ Phase condition (all states)    │
├─────────────────────────────────┤
│ Arclength (tangent direction)   │
└─────────────────────────────────┘
```

### Automatic Differentiation

Fork uses automatic differentiation for the vector-field state Jacobian and continuation-parameter
derivative at every stage. The collocation, continuity, phase, period, and parameter blocks are then
assembled analytically from those derivatives and the Gauss coefficients.

### Inter-Interval Coupling

Mesh states are explicit unknowns. Each interval therefore couples only its left mesh state, its
own stages, and the next mesh state; the last interval wraps directly to mesh state zero. There is
no recursive interpolation of prior intervals in the nonlinear BVP.

### Independent Defect Check

Collocation equations are exactly enforced at the Gauss nodes, so their algebraic residual alone can
hide an under-resolved orbit. Fork evaluates the reconstructed polynomial derivative at independent
off-node check points and compares it with the vector field. An excessive scaled defect rejects the
trial and retries with a smaller pseudo-arclength step while preserving the valid branch prefix.
The same acceptance check applies to LPC, PD, NS, and isoperiodic cycle-curve trials. These paths
require at least two mesh intervals because a one-interval periodic layout aliases the current and
next mesh blocks needed by Floquet condensation.

---

## Branch Extension

### The Problem

After computing an initial limit cycle branch, users often want to extend it further. The challenge is determining which direction to continue.

### Secant Predictor

Fork uses the **last two points** on the branch to determine the continuation direction:

1. Find the endpoint (max/min index depending on forward/backward)
2. Find the neighboring point
3. Compute secant vector: endpoint - neighbor
4. Orient the tangent to have positive dot product with secant

This ensures continuation follows the branch's natural direction, even if the branch has "turned around" (parameter changed direction).

### Branch Type Metadata

Each continuation branch stores:
- `branchType`: 'equilibrium' or 'limit_cycle'
- For limit cycles: `ntst`, `ncol`, `upoldp` (velocity profile)

This metadata ensures the correct continuation function is called when extending.

---

## Floquet Multiplier Extraction

### What Are Floquet Multipliers?

Floquet multipliers are eigenvalues of the **monodromy operator**, which describes how perturbations
evolve after one period. For an autonomous n-dimensional flow:
- One multiplier is theoretically +1 (the trivial flow-direction multiplier); numerically it should
  be close to +1 at a resolved cycle
- The remaining multipliers determine stability:
  - All nontrivial |μ| < 1: stable limit cycle
  - Any nontrivial |μ| > 1: unstable limit cycle

### Algorithm: Collocation Condensation and a Block-Cyclic Eigenproblem

Fork extracts each local variational transfer from the same orthogonal-collocation Jacobian used by
continuation. It does **not** multiply those transfers into a monodromy matrix.

For each interval i:

1. **Stage elimination**: Solve the collocation equations for stage sensitivities
   ```
   ds/dx = -G_s^{-1} × G_x
   ```
   where G_s is the stage-to-stage Jacobian and G_x is the mesh-to-stage Jacobian.

2. **Continuity condensation**: Substitute into continuity equation
   ```
   effective_C_x = C_x + C_s × (ds/dx)
   ```

3. **Transfer matrix**: Compute mesh-to-mesh transfer
   ```
   T_i = -C_next^{-1} × effective_C_x
   ```

The transfers are placed in one block-cyclic matrix `C` of size `(ntst × dim)`:

```
C_(i+1,i) = T_i                 for i < ntst - 1
C_(0,ntst-1) = T_(ntst-1)
```

If `gamma` is an eigenvalue of `C`, the physical Floquet multiplier is
`mu = gamma^ntst`. Fork chooses one deterministic root from each root family and reconstructs the
physical mesh mode with `y_i = gamma^i z_i`. Stage modes come from the stored stage sensitivities,
and the closing vector is exactly `mu y_0`. Zero multipliers use a direct boundary-nullspace solve,
because the balanced `gamma^i` reconstruction is singular at zero.

This formulation avoids the overflow, underflow, and loss of strongly contracting directions caused
by explicitly forming `T_(ntst-1) ... T_0`. Multiplier magnitudes are reconstructed in log-polar form,
with representable overflow/underflow handled deterministically.

### Comparison with BifurcationKit.jl

BifurcationKit.jl (Julia) offers **multiple Floquet computation methods**:

| Method | Description | Comparison to Fork |
|--------|-------------|-------------------|
| **FloquetQaD** | "Quick and Dirty" — sequential matrix products along orbit | Fork avoids this product |
| **Periodic Schur** | Uses periodic Schur decomposition (via PeriodicSchurBifurcationKit.jl) | Product-free and better-scaled for large problems |

BifurcationKit.jl's documentation notes that `FloquetQaD` can lose precision with many sections or
large/small Floquet exponents. Fork's block-cyclic problem also avoids forming the product, but it is
not a periodic-Schur implementation: its dense eigensolve scales with `ntst × dim` and can be more
expensive for large meshes.

**Future enhancement**: a periodic Schur backend would retain product-free scaling while reducing the
dense block-cyclic cost. Reference implementations exist in SLICOT and
PeriodicSchurBifurcationKit.jl.

### Raw Floquet Eigenvectors

The core returns unprojected variational eigenvectors at every mesh and stage point. These vectors
satisfy the local cocycle and final closure relation and are the source of truth for PD branch
switching and invariant-manifold seeds. Rendering may normalize a mode for display, but it must not
project away the flow direction. Reduced frozen-variable calculations are lifted back to the full
coordinate space with zeros in frozen components.

Eigenvectors are accepted only when the shifted block-cyclic operator has the requested geometric
multiplicity. Nearby but distinct roots therefore keep eigenvectors computed at their own roots. If
an algebraically repeated root is defective, Fork reports the multiplicity failure instead of
duplicating or orthogonalizing one vector into nonexistent independent modes.

Production invariant-manifold paths with stored parameter provenance rebuild their Floquet seed from
the collocation transfers and propagate any extraction failure. The stored multiplier must match the
recomputed eligible root before its eigenvector is used; the recomputed root determines whether the
bundle is periodic or antiperiodic. Stage directions are transported at the actual Gauss phases, and
negative multipliers interpolate toward `-v(0)` at cycle closure so the nonorientable double cover
does not pass through a spurious zero vector. Direct variational integration is an explicit
compatibility fallback only for legacy cycle data that has no parameter provenance; it independently
verifies the requested multiplier and is not used to hide a failed collocation calculation.

When the displayed cycle comes from an LPC, PD, NS, or isoperiodic curve, Fork first converts that
curve's explicit storage order to the canonical mesh-first cycle profile. Floquet and manifold work
then uses the selected point's subsystem snapshot and both parameter values; it never combines that
state with multipliers or parameters borrowed from another branch point.

### Sanity Check

Fork validates the computed multipliers before using them for bifurcation detection:

```rust
if trivial_distance > 1e-2 {
    // Multipliers are numerically corrupt
    return (NaN, NaN, NaN, values);
}
```

Fork removes exactly one multiplier within `1e-2` of +1 before evaluating the LPC, PD, and
Neimark-Sacker tests. If no such multiplier exists, the orbit or variational discretization is not
credible enough for bifurcation flags, so the test values are returned as NaN. A second multiplier
near +1 remains in the product and can therefore detect a limit point of cycles.

### Neimark-Sacker Curve Conditions

Neimark-Sacker curve continuation condenses the same collocation Jacobian into interval transfers
and applies them over two copies of the base period. With `k = cos(theta)`, the real characteristic
boundary condition is

```
v(0) - 2 k v(1) + v(2) = 0.
```

Its doubled-period operator has a two-dimensional real nullspace when the one-period Floquet map has
a conjugate unit-circle pair satisfying `mu^2 - 2 k mu + 1 = 0`. A two-column bordered solve supplies
the two scalar defining conditions. Fork takes one diagonal and one off-diagonal entry of its real
2-by-2 reduced block; using both diagonal entries would repeat the same real condition and leave the
system rank-deficient.

---

## Best Practices for Accurate Floquet Multipliers

### Mesh Resolution (ntst)

The number of mesh intervals controls discretization accuracy:

| ntst | Use Case |
|------|----------|
| 10–15 | Quick exploration, smooth orbits |
| 20–30 | Default for most systems (recommended) |
| 40–60 | Stiff systems, sharp transients, relaxation oscillations |
| 80+ | Extreme precision needs (rarely necessary) |

**Signs you need more mesh points:**
- Trivial multiplier drifts from 1.0
- Newton corrector struggles to converge
- Orbit profile looks under-resolved

### Collocation Degree (ncol)

Higher degree = higher-order polynomial approximation per interval:

| ncol | Description |
|------|-------------|
| 3 | Minimum for smooth problems |
| 4 | Default (good balance of accuracy and cost) |
| 5–6 | Higher precision or stiff systems |

Generally, increasing ntst is more effective than increasing ncol for improving accuracy.

### Step Size

Continuation step size affects multiplier stability:

- **Too large**: Newton may converge to a different orbit branch, causing multiplier jumps
- **Too small**: Slow, but multipliers stay consistent
- **Adaptive**: Fork adapts step size based on convergence — start with 0.01 and let it adjust

**Tip**: If multipliers suddenly jump or the trivial multiplier deviates from 1.0, reduce step size and re-extend.

### Initial Amplitude (from Hopf)

When starting a limit cycle from a Hopf bifurcation:

| Amplitude | Effect |
|-----------|--------|
| 0.01–0.05 | Very close to Hopf, may be numerically degenerate |
| 0.05–0.2 | Sweet spot for most systems |
| 0.5+ | May be outside convergence basin |

If the initial Newton correction fails, try a smaller amplitude.

### Troubleshooting Poor Multipliers

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Trivial multiplier ≠ 1.0 | Mesh too coarse | Increase ntst |
| Multipliers are NaN | No credible trivial mode or non-finite spectrum | Check orbit validity, increase ntst/ncol |
| False bifurcation detection | Step size too large | Reduce step size, re-extend |
| Very large/small multipliers | Highly unstable/stable orbit | Refine the mesh; periodic Schur remains a future large-problem backend |

### Example: High-Precision Configuration

For a stiff 3D system with relaxation oscillations:

```
ntst: 50
ncol: 4
step_size: 0.005
corrector_tol: 1e-8
```

For a smooth 2D system:

```
ntst: 20
ncol: 4
step_size: 0.01
corrector_tol: 1e-6
```

---

## Branching to Period-Doubled Limit Cycles

Period-doubling (PD) branching allows you to follow the cascaded route to chaos by switching from a limit cycle of period $T$ to a new family of period $2T$.

### When to Use This Method

- A "PeriodDoubling" bifurcation is detected on your limit cycle branch.
- You want to follow the period-doubling route to chaos (e.g., in the Rössler system).
- You want to explore the stability of the doubled-period cycles.

### CLI Workflow

```
Branches → [select LC branch] → Inspect Branch Points → [select PD point]
→ Branch to Period-Doubled Limit Cycle
```

Web UI:
```
Inspector → Limit Cycle from PD → [select Period Doubling point] → Continue Limit Cycle
```

### Numerical Implementation

The PD branching algorithm follows the steps below:

#### 1. PD Eigenvector Computation

At a PD point, the variational return has multiplier -1. Fork selects the corresponding raw mode
from the block-cyclic collocation eigenproblem. The reconstructed mesh and stage eigenfunction is
antiperiodic over one base period, so its sign reverses on the second copy. This phase-dependent mode,
not one constant eigenvector copied around the orbit, represents the wobble into the doubled branch.

Before constructing the predictor, Fork verifies that the closest collocation multiplier is within
`1e-2` of -1 and that the antiperiodic state-only collocation operator has relative smallest singular
value at most `1e-3`. A selected point that fails either test is rejected as an invalid PD source.

#### 2. Doubled-Period Guess Construction

We construct an initial guess for the doubled-period limit cycle by concatenating the original cycle with itself and adding a small perturbation in the direction of the PD eigenvector:

1. **Base Profile**: Concatenate two copies of the stored mesh and collocation-stage profile.
2. **Perturbation**: Add the antiperiodic mesh/stage mode with opposite signs on the two halves:
   $$x_{new}(\tau) \approx x_{orig}(\tau \pmod{1/2}) + h \cdot v(\tau)$$
   where $h$ is the perturbation amplitude (default 0.01).
3. **Period**: Double the stored period and retain all perturbed stage unknowns for the PALC solve.

#### 3. Predictor-Corrector Continuation

Once the doubled-period guess is constructed (with $ntst_{new} = 2 \cdot ntst_{orig}$), Fork runs standard orthogonal collocation continuation to converge onto and track the new branch.

### Comparison of LC Initiation Methods

| Aspect | From Hopf | From Orbit | From PD Branching |
|--------|-----------|------------|-------------------|
| **Initial guess** | Normal form approx | Sampler from orbit | PD eigenvector perturb |
| **New Period** | $\approx 2\pi/\omega$ | Sampler period | $\approx 2 \times$ original period |
| **Mesh (ntst)** | User-defined | User-defined | $2 \times$ original ntst |
| **Stability** | Any | Stable only | Any |

## Related: Isoperiodic Curve Continuation

Isoperiodic curve continuation is implemented as a separate branch type (`isoperiodic_curve`) that starts
from a limit-cycle or isoperiodic curve branch point and continues in a two-parameter plane while keeping
the period fixed to the seed point period.

See [`docs/isoperiodic_curve_continuation.md`](./isoperiodic_curve_continuation.md) for:
- Inspector workflows (`Continue Isoperiodic Curve`, `Continue from Point`)
- parameter selection defaults and constraints
- direction/index semantics and backward extension behavior
- Floquet multiplier handling on isoperiodic curve points
- troubleshooting for common initialization and extension errors

---

## References and Further Reading

- Doedel, E.J. "Lecture Notes on Numerical Analysis of Nonlinear Equations"
- Kuznetsov, Y.A. "Elements of Applied Bifurcation Theory"
- Keller, H.B. "Numerical Methods for Two-Point Boundary-Value Problems"
