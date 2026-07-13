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
13. [Validation Benchmarks](#validation-benchmarks)
14. [Branching to Period-Doubled Limit Cycles](#branching-to-period-doubled-limit-cycles)
15. [Related: Isoperiodic Curve Continuation](#related-isoperiodic-curve-continuation)

---

## Overview

Fork supports three methods for initiating limit cycle continuation:

1. **From Orbit Data**: If you have an orbit that converges to a stable limit cycle (e.g., from numerical integration), Fork can extract one period and use it to initialize limit cycle continuation.
2. **From a Hopf Bifurcation**: Fork builds a small-amplitude periodic predictor from a selected equilibrium or Hopf-curve point and corrects it through limit-cycle continuation.
3. **From Period-Doubling (PD) Bifurcation**: When a limit cycle undergoes a period-doubling bifurcation, a new limit cycle family emerges with double the period. Fork can branch from a detected PD point to this new family.

For fixed-period continuation in a two-parameter plane (isoperiodic curves), see
[`docs/isoperiodic_curve_continuation.md`](./isoperiodic_curve_continuation.md).
For frozen-variable subsystem semantics and reduced/full-state projection rules, see
[`docs/frozen_variable_subsystems.md`](./frozen_variable_subsystems.md).

Orbit, Hopf, and PD initialization are exposed in both the web Inspector and CLI branch workflows.

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
| Adaptive collocation mesh | enabled | Retry an under-resolved accepted frontier on an adapted mesh |
| Redistribute before refinement | enabled | Move the existing intervals once before adding intervals |
| Defect tolerance | 0.025 | Maximum scaled independent off-node defect |
| Max mesh adaptations | 3 | Retry budget for this continuation invocation; zero is valid |
| Max mesh intervals | 512 | Hard cap for automatic mesh growth |

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
| Adaptive collocation mesh | enabled | Retry an under-resolved accepted frontier on an adapted mesh |
| Redistribute before refinement | enabled | Move the existing intervals once before adding intervals |
| Defect tolerance | 0.025 | Maximum scaled independent off-node defect |
| Max mesh adaptations | 3 | Retry budget for this continuation invocation; zero is valid |
| Max mesh intervals | 512 | Hard cap for automatic mesh growth |

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

Fork evaluates this condition on the complete Gauss-stage profile. For a uniform mesh, its discrete
form is

$$
\Phi(u;u_{\mathrm{ref}})=
\sum_{i=0}^{N_{\mathrm{tst}}-1}\sum_{j=1}^{N_{\mathrm{col}}}
\frac{b_j}{N_{\mathrm{tst}}}
\left\langle
u_{ij}-u_{\mathrm{ref},ij},
T_{\mathrm{ref}}f(u_{\mathrm{ref},ij},p_{\mathrm{ref}})
\right\rangle=0,
$$

where $b_j$ are the Gauss weights. The reference stages and normalized-time derivative
$T_{\mathrm{ref}}f(u_{\mathrm{ref}},p_{\mathrm{ref}})$ remain fixed throughout one Newton correction,
so the phase row is affine and its exact Jacobian has entries only in the Gauss-stage columns. A
rejected trial cannot move the gauge. After a step passes the independent defect check, Fork replaces
the reference with the accepted profile, refreshes cached defining-system data and borders where
applicable, and only then computes the next PALC tangent.

The same full-profile gauge is used by LPC, PD, NS, and isoperiodic cycle curves. A first-mesh-point
or mesh-only gauge is not an acceptable substitute: it makes the chosen phase depend on storage order
and ignores most of the collocation polynomial. This policy agrees with the integral previous-orbit
phase conditions documented by
[MATCONT](https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf#page=81)
and [BifurcationKit.jl](https://bifurcationkit.github.io/BifurcationKitDocs.jl/stable/periodicOrbitCollocation/#Phase-condition).

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
off-node check points and compares it with the vector field, retaining one scaled maximum per mesh
interval. For ordinary limit-cycle branches and LPC, PD, NS, and isoperiodic cycle curves, an
excessive defect first attempts a defect-weighted redistribution with the same interval count. If the
frontier remains under-resolved, later retries add a deterministic bounded number of intervals and
place the nonuniform boundaries using the local indicators. Fork interpolates the accepted profile,
PALC tangent, all published points, and persisted extension history onto the exact new Gauss layout,
then retries the same step. An adaptation does not consume accepted-step progress or pretend that a
smaller pseudo-arclength step fixes spatial resolution.

The defaults allow three adaptations per continuation invocation, subject to a 512-interval cap.
Restarted extensions keep cumulative provenance but get a fresh retry budget, and already-applied
historical transfers are not replayed. Report-returning core and WASM entrypoints preserve the initial
and current normalized meshes, local trigger defects, every redistribution/refinement, and a
structured disabled/budget/cap/stalled termination. Web and CLI branches store this report; their
controls expose enablement, redistribution, defect tolerance, retry budget, and mesh cap, while the
Inspector/CLI summary shows the resulting provenance. Homoclinic defining systems remain on their
own fixed truncation mesh. The large-cycle homoclinic initializer is still uniform-source-only; web
and CLI reject a nonuniform source and ask the user to recontinue the cycle on a uniform mesh before
calling that legacy initializer. Discrete maps do not use flow collocation. All flow-cycle
collocation paths require at least two mesh intervals because a one-interval periodic layout aliases
the current and next mesh blocks needed by Floquet condensation.

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

### Algorithm: Collocation Condensation and Product-Free Floquet Backends

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

Fork has two product-free eigensolvers for the resulting transfer sequence:

- **Periodic Schur** reverses the transfers into physical monodromy order, scales each factor,
  reduces the sequence to periodic Hessenberg/triangular form, and applies an implicit complex
  single-shift periodic QR iteration, with controlled zero-shift recovery for nearly neutral
  multiplier clusters. Multipliers are recovered from the diagonal factor products in scaled
  log-polar form. Its storage is `O(ntst × dim²)` and its leading arithmetic cost is
  `O(ntst × dim³)`; it never constructs an `(ntst × dim)` square matrix.
- **Block-cyclic reference** places the transfers in one matrix `C` of size `(ntst × dim)`:

```
C_(i+1,i) = T_i                 for i < ntst - 1
C_(0,ntst-1) = T_(ntst-1)
```

  If `gamma` is an eigenvalue of `C`, the physical Floquet multiplier is
`mu = gamma^ntst`. Fork chooses one deterministic root from each root family and reconstructs the
physical mesh mode with `y_i = gamma^i z_i`. Stage modes come from the stored stage sensitivities,
and the closing vector is exactly `mu y_0`. Zero multipliers use a direct boundary-nullspace solve,
because the balanced `gamma^i` reconstruction is singular at zero.

`Auto` uses the block-cyclic reference while `ntst × dim <= 96`, then selects periodic Schur. If the
selected backend cannot reconstruct a raw mode, `Auto` tries the other backend when the dense block
dimension is at most 2048. Explicit backend requests do not silently change algorithms. The web
Floquet panel exposes all three choices and records the concrete backend in the stored result.

This formulation avoids the overflow, underflow, and loss of strongly contracting directions caused
by explicitly forming `T_(ntst-1) ... T_0`. Multiplier magnitudes are reconstructed in log-polar form,
with representable overflow/underflow handled deterministically.

### Comparison with BifurcationKit.jl

BifurcationKit.jl (Julia) offers **multiple Floquet computation methods**:

| Method | Description | Comparison to Fork |
|--------|-------------|-------------------|
| **FloquetQaD** | "Quick and Dirty" — sequential matrix products along orbit | Fork avoids this product |
| **Periodic Schur** | Uses periodic Schur decomposition (via PeriodicSchurBifurcationKit.jl) | Fork now provides the corresponding product-free periodic Hessenberg/QR path |

BifurcationKit.jl's documentation notes that `FloquetQaD` can lose precision with many sections or
large/small Floquet exponents. Fork now has the same class of periodic-Schur protection for large
meshes while retaining its independent block-cyclic formulation as a deterministic small-problem
reference and fallback. The implementation is pure Rust, including the orthogonal transformations,
so it is available in native, CLI WASM, and browser WASM builds without LAPACK or SLICOT binaries.

### Raw Floquet Eigenvectors

The core returns unprojected variational eigenvectors at every mesh and stage point. These vectors
satisfy the local cocycle and final closure relation and are the source of truth for PD branch
switching and invariant-manifold seeds. Rendering may normalize a mode for display, but it must not
project away the flow direction. Reduced frozen-variable calculations are lifted back to the full
coordinate space with zeros in frozen components.

The periodic-Schur path accumulates every periodic basis and solves the upper-triangular periodic
cocycle component by component. It emits the mode at each mesh boundary directly from the
corresponding Schur basis, rather than repeatedly multiplying an anchor vector and amplifying a
stable mode's roundoff contamination. The block-cyclic path accepts eigenvectors only when the
shifted operator has the requested geometric multiplicity. Both paths report defective or
numerically inseparable multipliers instead of manufacturing nonexistent independent modes.

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

For NS detection, Fork evaluates the bialternate product over all remaining multipliers,
$\prod_{i<j}(\mu_i\mu_j-1)$. Products are accumulated with positive magnitude scaling so stiff
Floquet spectra cannot overflow before the critical factor is inspected. An NS label additionally
requires the same nonzero number of nonreal conjugate pairs on both sides and a change in how many
of those pairs lie outside the unit circle. This keeps stable real-to-complex transitions and
reciprocal real-pair crossings from being mislabeled as torus bifurcations.

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

Ordinary flow-cycle correction/continuation and LPC, PD, NS, and isoperiodic cycle curves adapt the
normalized mesh automatically when the independent defect exceeds tolerance. Manual NTST selection
still sets the starting cost, and the configured retry and mesh caps keep that cost bounded.

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
| Very large/small multipliers | Highly unstable/stable orbit | Refine the mesh; use `Automatic` or `Periodic Schur` for large meshes |

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

## Validation Benchmarks

Limit-cycle bifurcation curves use two complementary test tiers. Fast analytic fixtures catch
algebra, layout, phase-gauge, Floquet, and multi-step continuation regressions in regular CI. Published
models then check the complete stable-Orbit-to-collocation workflow against independent reference
calculations. Neither tier replaces the other.

### Tier 1: Automated Analytic CI Fixtures

These are autonomous realizations of canonical periodic normal forms. They are not physical models;
their purpose is to provide orbit, bifurcation-locus, period, and Floquet oracles that are independent
of shooting. Each test must take several accepted collocation-curve steps and check the defining
residual, off-node defect, exact parameter locus, and critical multiplier at every point.

Ordinary-cycle mesh adaptation additionally uses an analytic slow-fast circle with
`theta' = a + b cos(theta)`. Its exact period and normalized profile make a deterministic oracle for
coarse-mesh defect, automatic refinement, transfer, correction, and final defect acceptance.

For LPC, use the Bautin radial normal form, with $r^2=x^2+y^2$,

$$
\dot x=\mu x-y+\beta xr^2+xr^4,
\qquad
\dot y=x+\mu y+\beta yr^2+yr^4.
$$

For $\beta<0$, the exact fold-of-cycles locus is

$$
\mu=\frac{\beta^2}{4},
\qquad r^2=-\frac{\beta}{2},
\qquad T=2\pi.
$$

The critical spectrum has the trivial $+1$ multiplier and a second $+1$ multiplier at the fold.

For PD, suspend a non-orientable transverse bundle over the unit Stuart–Landau cycle. Set
$a=\mu-\beta^2$, $b=-0.2$, $m=(a+b)/2$, and $d=(a-b)/2$:

$$
\dot x=-y+x(1-x^2-y^2),
\qquad
\dot y=x+y(1-x^2-y^2),
$$

$$
\begin{pmatrix}\dot u\\\dot v\end{pmatrix}=
\begin{pmatrix}
m+dx & dy-\tfrac12\\
dy+\tfrac12 & m-dx
\end{pmatrix}
\begin{pmatrix}u\\v\end{pmatrix}.
$$

The transverse multipliers are exactly $-e^{2\pi a}$ and $-e^{2\pi b}$. Thus
$\mu=\beta^2$ is a generic PD curve with one simple $-1$ multiplier; fixed $b<0$ avoids the
double-$-1$ degeneracy of a constant half-frequency rotation.

For NS, use the same unit cycle and a nonlinear transverse complex mode. With
$a=\mu-\beta^2$, $\omega=0.2+0.1\beta$, and $\rho^2=u^2+v^2$,

$$
\dot u=au-\omega v-\rho^2u,
\qquad
\dot v=\omega u+av-\rho^2v.
$$

Its transverse multipliers are $e^{2\pi(a\pm i\omega)}$, so the exact nonresonant NS locus is
$\mu=\beta^2$ and the real doubled-period auxiliary value is $k=\cos(2\pi\omega)$.

### Tier 2: Published Stable-Orbit Validation Targets

Published-model validation starts from a time-integrated attracting cycle, passes the resulting
Orbit through Fork's minimal-period extraction and fixed-parameter collocation correction, continues
the LC to the published bifurcation, and then takes multiple steps on the two-parameter curve. Compare
phase-invariant quantities—parameters, period, critical multipliers, residual, and off-node defect—not
raw profile coordinates. Repeat on a refined mesh and require convergence.

The regular integration suite exercises this complete path on adaptx with a Fork-owned
$8\times3$ mesh; the reference $20\times4$ MATCONT discretization remains the higher-resolution
oracle. The ignored release-mode slow tier in `published_cycle_references.rs` executes the MLfast
and Steinmetz–Larter paths below, including their coarse/refined comparisons and accepted
two-parameter curve steps.

#### MLfast: LPC

The modified fast Morris–Lecar system is

$$
\dot v=y-0.5(v+0.5)-2w(v+0.7)-m_\infty(v-1),
\qquad
\dot w=1.15(w_\infty-w)\tau,
$$

$$
m_\infty=\frac{1+\tanh((v+0.01)/0.15)}{2},
\quad
w_\infty=\frac{1+\tanh((v-z)/0.145)}{2},
\quad
\tau=\cosh((v-0.1)/0.29).
$$

At fixed $z=0.1$, MATCONT reports an LPC at $y=0.08456948$ with
$T=4.222012$ and fold coefficient $-0.2334578$; the cycle gains stability at the fold. Its
published LC and LPC runs use $N_{\mathrm{tst}}=30$, $N_{\mathrm{col}}=4$, with $y,z$ free on the
LPC curve. Use an Orbit on the attracting branch adjacent to the fold rather than importing a
MATCONT collocation state. See the official manual's
[MLfast example](https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf#page=84).

Fork's executable benchmark integrates the attracting cycle at $(y,z)=(0.084,0.1)$, then uses
Fork-owned $20\times4$ and $32\times4$ grids. The refined result must satisfy
$|y-y_{\mathrm{MATCONT}}|<10^{-4}$ and $|T-T_{\mathrm{MATCONT}}|<2\times10^{-4}$; the two grids must
agree in both quantities within $2\times10^{-4}$. Each grid then accepts two LPC-curve steps and
retains two multipliers within $2\times10^{-3}$ of $+1$. MATCONT's published $30\times4$ grid is
source provenance only; neither Fork grid imports its state.

#### adaptx / Genesio–Tesi: PD

The adaptive-control system used by Genesio and Tesi is

$$
\dot x=y,
\qquad
\dot y=z,
\qquad
\dot z=-\alpha z-\beta y-x+x^2.
$$

For $\beta=1$, MATCONT reports the first positive PD at $\alpha=0.6303020$ with
$T=6.364071$ and normal-form coefficient $-0.04267675$. The LC and PD-curve calculations use
$N_{\mathrm{tst}}=20$, $N_{\mathrm{col}}=4$. With $\alpha,\beta$ free, the published PD curve reaches
strong 1:2 resonances near $(0,1.698711)$ with $T=4.841835$ and $(0,0.6782783)$ with
$T=9.058318$. These are independent curve-level oracles beyond locating the seed PD. Start the
Orbit on the attracting pre-PD side and verify its nontrivial multipliers before continuation. See the
official manual's
[adaptx LC and PD-curve example](https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf#page=79).
The independent
[BifurcationKit.jl PD tutorial](https://bifurcationkit.github.io/BifurcationKitDocs.jl/stable/tutorials/ode/tutorialsODE-PD/)
uses orthogonal collocation on the same MatCont-library system and exercises the same PD workflow.

#### Steinmetz–Larter: NS

For the peroxidase–oxidase model,

$$
\begin{aligned}
\dot A&=-k_1ABX-k_3ABY+k_7-k_{-7}A,\\
\dot B&=-k_1ABX-k_3ABY+k_8,\\
\dot X&=k_1ABX-2k_2X^2+2k_3ABY-k_4X+k_6,\\
\dot Y&=-k_3ABY+2k_2X^2-k_5Y.
\end{aligned}
$$

MATCONT gives a point on the NS cycle as

$$
(A,B,X,Y)=(1.8609653,25.678306,0.010838258,0.094707061)
$$

at

$$
(k_1,k_2,k_3,k_4,k_5,k_6,k_7,k_{-7},k_8)
=(0.1631021,1250,0.046875,20,1.104,0.001,0.71643356,0.1175,0.5).
$$

The NS normal-form coefficient is $-1.406017\times10^{-6}$, and integration at $k_7=0.7167$
produces the expected stable torus. The
[2012 MATCONT manual's second NS point](https://venturi.soe.ucsc.edu/sites/default/files/ManualSep2012.pdf#page=32)
has
$(k_7,k_8)=(1.5163129,0.83200664)$ and phase state
$(6.1231735,9.1855407,0.0054271408,0.024602951)$. Use $k_7,k_8$ as curve parameters and seed
the LC from the attracting-cycle side, verified by its multipliers; do not use the $k_7=0.7167$
torus trajectory as a limit-cycle Orbit.

The [official manual](https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf#page=41)
provides the equations, critical values, and an `ode45` run on $[0,3000]$ with relative tolerance
$10^{-8}$, but it does **not** state an orthogonal-collocation mesh for this example. Therefore the
fixture must label its baseline and refined meshes as Fork choices and demonstrate convergence; it
must not attribute those meshes to MATCONT.

The official
[BifurcationKit.jl Steinmetz–Larter tutorial](https://bifurcationkit.github.io/BifurcationKitDocs.jl/stable/tutorials/ode/steinmetz/)
independently demonstrates the trajectory-to-orthogonal-collocation workflow and NS continuation on
this model.

The maintained MATLAB definitions and testruns are distributed in the
[official MATCONT release archive](https://sourceforge.net/projects/matcont/files/MatCont/MatCont7p6/MatCont7p6.zip/download).

Fork's benchmark integrates an attracting cycle at $(k_7,k_8)=(1.5,0.82)$. Its baseline and
refinement are Fork-owned $16\times3$ and $16\times4$ requests; any defect-driven interval
redistribution/refinement is retained in the branch metadata and reused by the NS defining system.
The two runs must converge in the detected $k_8$, period, and critical-pair cosine. The baseline NS
curve accepts 16 steps, keeps a nonreal pair within $3\times10^{-3}$ of unit modulus, and passes
within $10^{-3}$ in $k_7$ and $5\times10^{-4}$ in $k_8$ of the published second NS point.

Runtime policy:

- Regular Rust CI runs the analytic multi-step cycle curves, the adaptx published PD benchmark,
  and the full curve-corrected Chenciner locator.
- MLfast and Steinmetz–Larter are ignored in ordinary `cargo test` because they integrate attracting
  Orbits and repeat mesh-convergence paths. Run them serially in optimized mode with
  `cargo test -p fork_core --test published_cycle_references --release -- --ignored --test-threads=1`.
- `.github/workflows/slow-cycle-references.yml` runs that command with a five-minute job timeout.
  On the 2026-07-13 developer machine the two tests complete in about 5 seconds and 65 seconds,
  respectively, including both Steinmetz grids; the combined warm release run takes about 70 seconds
  (about 84 seconds including a rebuild).

## Periodic-Orbit Normal Forms and Generic Branch Points

Fork computes PD, NS, and nontrivial $+1$ Floquet normal forms from a local Poincare return map
through the first collocation mesh point. Removing the flow direction before the spectral solve is
essential: the autonomous phase multiplier is always $+1$ and must not be mistaken for an LPC or a
generic periodic branch point. Each result includes the return-map and section residuals,
left/right eigenvector residuals and pairing, and the largest homological-equation residual.

For a nontrivial $+1$ multiplier, the reduced scalar equation is

$$
\xi \mapsto \xi+a_{01}\,\delta\mu+b_{11}\xi\,\delta\mu
       +\frac{b_{20}}{2}\xi^2+\frac{b_{30}}{6}\xi^3.
$$

Fork classifies the event as an LPC when $a_{01}\ne0$. When $a_{01}=0$, the same Floquet crossing is
a generic periodic branch point (transcritical or pitchfork according to the remaining
coefficients), and `periodic_branch_point_switch_setup` constructs a predictor on the emanating
periodic branch; the ordinary limit-cycle start path then fixed-parameter-corrects that predictor.
The core entry point is `periodic_orbit_normal_form`; packed-state WASM entry points reconstruct the
exact persistent collocation mesh and phase direction before computing coefficients or switching.
The web Inspector exposes coefficient and conditioning readouts, persists their source provenance,
and corrects and continues a generic transcritical or pitchfork periodic branch into a child branch.

### Codimension-two points on cycle-bifurcation curves

Fork evaluates the interaction tests below only after removing the autonomous flow multiplier and
the multiplier (or complex pair) that defines the source LPC, PD, or NS curve. Consequently an
LPPD, LPNS, PDNS, or NSNS test refers to an independent secondary Floquet mode. A real reciprocal
pair is not an NS pair: NS tests match nonreal conjugates and use the signed factor
$|\mu|^2-1$.

Every detected sign change is localized by a bracketed secant iteration whose trial point is
pseudo-arclength-corrected back to the codimension-one collocation curve. Multiple simultaneous
events on one source segment are retained in deterministic table order rather than collapsed to a
single label. The serialized record contains both endpoint test values, the refined test and curve
residuals, named coefficients, conditioning, certification, and typed branch-switch metadata.

| Event | Source curve(s) | Defining test and retained diagnostics | Typed switch after refinement |
| --- | --- | --- | --- |
| CPC | LPC | Zero of the periodic return-map quadratic coefficient; retains the cubic and parameter coefficients plus return-map conditioning. | Reported unavailable: selecting the other tangent LPC arc requires a two-parameter unfolding tangent. |
| LPPD | LPC or PD | Independent secondary $-1$ or $+1$ multiplier after removing the source curve's tracked mode; retains signed secondary tests and nearest-mode distances. | LPC to PD or PD to LPC. |
| LPNS | LPC or NS | Independent secondary nonreal unit pair or $+1$ multiplier; retains the second pair's cosine and unit-modulus residual. | LPC to NS (with its cosine) or NS to LPC. |
| GPD | PD | Zero of the periodic PD cubic coefficient; retains the parameter coefficient, critical multiplier, and return-map conditioning. | Reported unavailable: the doubled-cycle LPC predictor also needs a normalized fifth-order coefficient. |
| PDNS | PD or NS | Independent secondary nonreal unit pair or $-1$ multiplier; retains its cosine and spectral residuals. | PD to NS (with its cosine) or NS to PD. |
| CH | NS | Zero of the real periodic NS cubic coefficient; retains its imaginary part, parameter coefficient, critical angle/modulus, and return-map conditioning. | Reported unavailable: a torus-fold is not one of Fork's periodic-orbit codimension-one curve problems. |
| NSNS | NS | Signed unit-modulus test for a second nonreal conjugate pair after removing the angle-selected defining pair. | A second NS curve, carrying the secondary pair's cosine. |
| R1, R2 | NS | $k-1=0$ and $k+1=0$, where $k=\cos\theta$; retains the order, angle, cosine, and refined test. | R1 to LPC and R2 to PD. |
| R3, R4 | NS | $k+1/2=0$ and $k=0$; retains the order, angle, cosine, and refined test. | Reported unavailable: these emit resonant period-three or period-four orbit branches, for which Fork has no typed predictor. |

For GPD, Chenciner, and R1--R4, `defining_conditions_verified` can be true while
`nondegeneracy_evaluated` is false. This is deliberate, not a "candidate" label. At the
BifurcationKit.jl revision used for parity review
([commit `ed4b14eef65b60fd1612e6914fa669f44fac3d81`, 2026-06-30](https://github.com/bifurcationkit/BifurcationKit.jl/commit/ed4b14eef65b60fd1612e6914fa669f44fac3d81)),
the generated periodic codimension-two normal-form constructors dispatch these event names but leave
their `nf` field unset (`nothing`); BK therefore
does not provide an independent normalized higher-order or resonant nondegeneracy coefficient to use
as an oracle. Fork records that limitation explicitly in each event's certification reason.

Cycle-curve problems retain the normalized collocation mesh that produced the source branch. The
same interval boundaries and widths are used by residuals, Jacobians, phase quadrature, PALC weights,
defect checks, periodic normal-form profile reconstruction, refinement, WASM serialization, and
extension. The legacy constructors remain uniform-mesh convenience wrappers.

For Chenciner conditioning, the corrected NS-curve Jacobian has a one-dimensional nullspace, so
event transversality depends only on the normal-form gradient component along the curve tangent.
Fork uses the signed source bracket to estimate that component and appends its tangent-projected row
to the curve Jacobian. This avoids recomputing the full return-map normal form twice per collocation
unknown without changing the curve correction, cubic coefficient, residual, or defining event. The
natural Chenciner regression now runs in ordinary debug CI (about 2.2 seconds on the 2026-07-13
developer machine) and asserts both bordered and event-augmented conditioning.

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

- [MATCONT / CL MATCONT manual (2019)](https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf)
- [MATCONT / CL MATCONT manual (2012)](https://venturi.soe.ucsc.edu/sites/default/files/ManualSep2012.pdf)
- [MATCONT official release archive](https://sourceforge.net/projects/matcont/files/MatCont/MatCont7p6/MatCont7p6.zip/download)
- [BifurcationKit.jl: periodic orbits based on orthogonal collocation](https://bifurcationkit.github.io/BifurcationKitDocs.jl/stable/periodicOrbitCollocation/)
- Doedel, E.J. "Lecture Notes on Numerical Analysis of Nonlinear Equations"
- Kuznetsov, Y.A. "Elements of Applied Bifurcation Theory"
- Keller, H.B. "Numerical Methods for Two-Point Boundary-Value Problems"
