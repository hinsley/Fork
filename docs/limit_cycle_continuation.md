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
14. [Related: Isochrone Continuation](#related-isochrone-continuation)

---

## Overview

Fork supports two methods for initiating limit cycle continuation:

1. **From Orbit Data**: If you have an orbit that converges to a stable limit cycle (e.g., from numerical integration), Fork can extract one period and use it to initialize limit cycle continuation.
2. **From Period-Doubling (PD) Bifurcation**: When a limit cycle undergoes a period-doubling bifurcation, a new limit cycle family emerges with double the period. Fork can branch from a detected PD point to this new family.

For fixed-period continuation in a two-parameter plane (isochrones), see
[`docs/isochrone_continuation.md`](./isochrone_continuation.md).
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

#### 1. Reference Point Selection

Use the point at **1/3 of the orbit** as the reference. This skips any initial transient while the trajectory settles onto the attractor:

```
ref_idx = n / 3
x_ref = orbit[ref_idx]
t_ref = times[ref_idx]
```

#### 2. Cycle Detection

Search forward from the reference point for the **first local minimum** of the distance function that falls within tolerance:

```
for i in skip_start..n:
    dist = |x[i] - x_ref|
    if dist is local minimum AND dist < tolerance:
        cycle_end = i
        break
```

The period is `T = times[cycle_end] - t_ref`.

#### 3. Remeshing to Collocation Grid

The detected cycle (from `ref_idx` to `cycle_end`) is linearly interpolated onto a uniform mesh:

```
for k in 0..ntst:
    tau = k / ntst  # Normalized time [0, 1)
    mesh_state[k] = interpolate(tau, cycle)
```

Stage (collocation) points are then computed by interpolating between mesh points at the Gauss-Legendre nodes.

#### 4. Phase Condition

The phase anchor is set to the first mesh point, and the phase direction is the normalized velocity at that point:

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

**Cause**: The algorithm found a return at 2T or 3T instead of T.

**Solutions**:
1. This was fixed by using a small fixed skip (`skip_start = ref_idx + 10`) instead of a percentage-based skip
2. If still occurring, ensure the orbit has sufficient resolution near the first return

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
| **Transient handling** | Not needed | Skips first 1/3 of orbit |

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

Total profile points: `ntst × ncol + 1` (including the starting point)

### Normalized Time

We use normalized time τ ∈ [0, 1] where:
- τ = 0 corresponds to t = 0
- τ = 1 corresponds to t = T

The actual time is t = τ · T.

### State Vector

The unknowns for continuation are:

```
u = [x(τ₀), x(τ₁), ..., x(τₙ), T]
```

where:
- x(τᵢ) ∈ ℝᵈⁱᵐ is the state at mesh/collocation point τᵢ
- T ∈ ℝ is the period

Total unknowns: (ntst × ncol + 1) × dim + 1

### Lagrange Interpolation

Within each interval, the solution is approximated by a polynomial passing through the collocation points. For ncol = 4, this is a degree-4 polynomial.

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

#### 2. Continuity Equations (ntst × dim equations)

At the boundary between intervals i and i+1:

```
x_end(interval i) - x_start(interval i+1) = 0
```

where x_end is computed by Lagrange interpolation at s = 1.

#### 3. Periodicity (dim equations)

```
x(τ = 1) - x(τ = 0) = 0
```

The orbit must close on itself.

#### 4. Phase Condition (1 equation)

Periodic orbits have an arbitrary phase—we can shift t → t + Δt and get the same orbit. To remove this degeneracy, we add an **integral phase condition**:

```
∫₀¹ <x(τ) - x_old(τ), dx_old/dτ> dτ = 0
```

This says the new orbit is orthogonal (in L²) to translations of the old orbit along itself.

### The Augmented System

For pseudo-arclength continuation, we add one more equation:

```
<(u - u_pred), tangent> = 0
```

This constrains the solution to lie on a hyperplane perpendicular to the tangent direction, at a specified arclength from the previous point.

Total system: (ntst × ncol × dim) + (ntst × dim) + dim + 1 + 1 equations and unknowns

---

## Newton's Method and the Jacobian

### Newton Iteration

Given a prediction u_pred, we solve the corrector equations:

```
J · Δu = -F(u)
u ← u + Δu
```

until ||F(u)|| < tolerance.

### Jacobian Structure

The Jacobian J = ∂F/∂u has a specific sparsity pattern:

```
┌─────────────────────────────────┐
│ Collocation (banded + period)   │
├─────────────────────────────────┤
│ Continuity (links intervals)    │
├─────────────────────────────────┤
│ Periodicity (first & last)      │
├─────────────────────────────────┤
│ Phase condition (all states)    │
├─────────────────────────────────┤
│ Arclength (tangent direction)   │
└─────────────────────────────────┘
```

### Automatic Differentiation

Fork uses **forward-mode automatic differentiation** to compute exact Jacobian entries. For each residual equation, we:

1. Evaluate the equation with dual numbers carrying derivatives
2. Extract the derivative with respect to each unknown

### Inter-Interval Coupling

A critical subtlety: the mesh point at the start of interval i (for i > 0) is computed by **interpolating the end of interval i-1**. This interpolation depends on all states in interval i-1, which in turn depends on interval i-2, etc.

The derivative of mesh[i] with respect to profile states forms a **recursive chain**:

```
∂mesh[i]/∂x(τⱼ) = Σₖ L_k(1) · ∂mesh[i-1]/∂x(τⱼ) + L_j(1)·δ(j in interval i-1)
```

Fork pre-computes these coefficients to handle the full inter-interval coupling correctly.

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

Floquet multipliers are eigenvalues of the **monodromy matrix** M, which describes how perturbations evolve after one period. For an n-dimensional system:
- One multiplier is always exactly 1 (trivial multiplier, corresponding to perturbations along the orbit)
- Other multipliers determine stability:
  - All |μ| < 1: stable limit cycle
  - Any |μ| > 1: unstable limit cycle

### Algorithm: Sequential Block Elimination

Fork extracts Floquet multipliers directly from the collocation Jacobian using **sequential block elimination**, chaining local transfer matrices through each mesh interval:

```
M = T_{ntst-1} × T_{ntst-2} × ... × T_1 × T_0
```

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

4. **Chain accumulation**:
   ```
   M = T_i × M
   ```

The final matrix M is the monodromy, and its eigenvalues are the Floquet multipliers.

### Comparison with Global S-matrix Approach

Some implementations use a **global S-matrix reduction** algorithm:

| Aspect | Fork (Sequential) | Global S-matrix |
|--------|-------------------|-----------------|
| **Build phase** | Chain T_i matrices one interval at a time | Build full (ntst×dim) × ((ntst+1)×dim) S-matrix |
| **Elimination** | Sequential dim×dim solves | Banded Gaussian elimination with pivoting |
| **Memory** | O(dim²) working memory | O(ntst × dim²) for S-matrix |
| **Computational cost** | O(ntst × (ncol×dim)³ + ntst × dim³) | O(ntst × (ncol×dim)³ + ntst × dim³) |
| **BVP structure** | Implicit periodicity (last equation wraps to x₀) | Explicit boundary row (x₀ - x_{ntst} = 0) |

Both approaches are **mathematically equivalent** and extract the same monodromy eigenvalues. The primary differences are:

1. **Memory efficiency**: Sequential approach avoids allocating the full S-matrix
2. **BVP compatibility**: Sequential approach naturally handles implicit periodicity; explicit-boundary methods introduce an extra endpoint variable

### Why Not Use the Full S-matrix Reduction?

Fork's BVP uses **implicit periodicity**: the last continuity equation wraps x_{ntst} back to x₀, meaning both endpoints share the same Jacobian column. Full S-matrix formulations typically assume **explicit periodicity**: x_{ntst} is a separate variable with an explicit boundary equation x₀ - x_{ntst} = 0.

The sequential approach correctly handles implicit periodicity by using modular indexing:
```rust
let next_mesh_col = mesh_col_start + ((interval + 1) % ntst) * dim;
```

This makes the last transfer matrix T_{ntst-1} directly map from x_{ntst-1} back to x₀.

### Comparison with BifurcationKit.jl

BifurcationKit.jl (Julia) offers **multiple Floquet computation methods**:

| Method | Description | Comparison to Fork |
|--------|-------------|-------------------|
| **FloquetQaD** | "Quick and Dirty" — sequential matrix products along orbit | **Same approach as Fork** |
| **Periodic Schur** | Uses periodic Schur decomposition (via PeriodicSchurBifurcationKit.jl) | More numerically stable, but more complex |

BifurcationKit.jl's documentation notes that `FloquetQaD` "may suffer from precision issues, especially when dealing with many time sections or large/small Floquet exponents, due to accumulated errors."

Fork's approach is equivalent to `FloquetQaD`. For most practical systems (moderate ntst, dim ≤ 10), precision is sufficient. The Periodic Schur method would be preferable for high-precision needs or very large/stiff systems.

**Future enhancement**: To add Periodic Schur support, Fork would need to implement periodic QR iteration (computing eigenvalues of a matrix product without forming it). This would avoid error accumulation in the sequential products and provide better precision for extreme Floquet exponents (very stable or very unstable orbits). Reference implementations exist in SLICOT (Fortran) and PeriodicSchurBifurcationKit.jl (Julia).

### Sanity Check

Fork validates the computed multipliers before using them for bifurcation detection:

```rust
if trivial_distance > 0.5 {
    // Multipliers are numerically corrupt
    return (NaN, NaN, NaN, values);
}
```

If no multiplier is within 0.5 of 1.0, the monodromy computation has broken down (often due to numerical issues on very stiff or long-period orbits). In this case, NaN test values are returned to prevent false bifurcation detections.

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
| Multipliers are NaN | Monodromy computation failed | Check orbit validity, increase ntst |
| False bifurcation detection | Step size too large | Reduce step size, re-extend |
| Very large/small multipliers | Highly unstable orbit | Consider Periodic Schur (future) |

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

At a PD point, the monodromy matrix $M$ has an eigenvalue of -1 (the period-doubling multiplier). We first compute the corresponding eigenvector $v$:
$$(M + I)v = 0$$
where $I$ is the identity matrix. $v$ represents the direction in state space into which the orbit begins to "wobble" before splitting into a doubled period.

#### 2. Doubled-Period Guess Construction

We construct an initial guess for the doubled-period limit cycle by concatenating the original cycle with itself and adding a small perturbation in the direction of the PD eigenvector:

1. **Base Mesh**: Concatenate two copies of the original mesh points. Adjust normalized time to $[0, 1]$.
2. **Perturbation**: Add a small perturbation based on the PD eigenvector:
   $$x_{new}(\tau) \approx x_{orig}(\tau \pmod{1/2}) + h \cdot v(\tau)$$
   where $h$ is the perturbation amplitude (default 0.01).
3. **Stage States**: Rebuild all collocation stage states using the perturbed mesh.

#### 3. Predictor-Corrector Continuation

Once the doubled-period guess is constructed (with $ntst_{new} = 2 \cdot ntst_{orig}$), Fork runs standard orthogonal collocation continuation to converge onto and track the new branch.

### Comparison of LC Initiation Methods

| Aspect | From Hopf | From Orbit | From PD Branching |
|--------|-----------|------------|-------------------|
| **Initial guess** | Normal form approx | Sampler from orbit | PD eigenvector perturb |
| **New Period** | $\approx 2\pi/\omega$ | Sampler period | $\approx 2 \times$ original period |
| **Mesh (ntst)** | User-defined | User-defined | $2 \times$ original ntst |
| **Stability** | Any | Stable only | Any |

## Related: Isochrone Continuation

Isochrone continuation is implemented as a separate branch type (`isochrone_curve`) that starts
from a limit-cycle or isochrone branch point and continues in a two-parameter plane while keeping
the period fixed to the seed point period.

See [`docs/isochrone_continuation.md`](./isochrone_continuation.md) for:
- Inspector workflows (`Continue Isochrone`, `Continue from Point`)
- parameter selection defaults and constraints
- direction/index semantics and backward extension behavior
- Floquet multiplier handling on isochrone points
- troubleshooting for common initialization and extension errors

---

## References and Further Reading

- Doedel, E.J. "Lecture Notes on Numerical Analysis of Nonlinear Equations"
- Kuznetsov, Y.A. "Elements of Applied Bifurcation Theory"
- Keller, H.B. "Numerical Methods for Two-Point Boundary-Value Problems"
