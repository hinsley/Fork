# Limit Cycle Continuation from Hopf Bifurcations

This document describes how Fork implements bifurcation from Hopf points to limit cycle continuation, including both the user-facing workflow and the underlying numerical methods.

## Table of Contents

1. [Overview](#overview)
2. [CLI Workflow](#cli-workflow)
3. [Numerical Background](#numerical-background)
4. [Hopf Point Detection and Refinement](#hopf-point-detection-and-refinement)
5. [Limit Cycle Initialization from Hopf](#limit-cycle-initialization-from-hopf)
6. [Orthogonal Collocation Discretization](#orthogonal-collocation-discretization)
7. [The Continuation Problem](#the-continuation-problem)
8. [Newton's Method and the Jacobian](#newtons-method-and-the-jacobian)
9. [Branch Extension](#branch-extension)
10. [Floquet Multiplier Extraction](#floquet-multiplier-extraction)
11. [Best Practices for Accurate Floquet Multipliers](#best-practices-for-accurate-floquet-multipliers)

---

## Overview

At a **Hopf bifurcation**, a pair of complex conjugate eigenvalues of the equilibrium's Jacobian crosses the imaginary axis. This marks the birth (or death) of a family of periodic orbits—**limit cycles**—that emanate from the equilibrium point.

Fork provides automated detection of Hopf bifurcations during equilibrium continuation and allows continuation of the limit cycle family in a chosen parameter.

### Key Concepts

- **Equilibrium continuation**: Tracking fixed points as a parameter varies
- **Hopf bifurcation**: Point where eigenvalues become purely imaginary (±iω)
- **Limit cycle**: Periodic orbit; represented as a closed curve in state space
- **Collocation**: Discretization method for boundary value problems

---

## CLI Workflow

### Step 1: Run Equilibrium Continuation

First, perform equilibrium continuation to find Hopf bifurcation points:

```
System Menu → Continuation → Create New Branch → [select equilibrium] → [configure]
```

Fork automatically detects Hopf bifurcations (marked with "Hopf" stability in the branch viewer).

### Step 2: Start Limit Cycle from Hopf

Select a Hopf point and choose "Start Limit Cycle from Hopf":

```
Continuation Menu → [select branch] → Inspect Branch Points → [select Hopf point]
→ Start Limit Cycle from Hopf
```

### Step 3: Configure LC Continuation

You'll be prompted for:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Amplitude | 0.1 | Initial amplitude of limit cycle guess |
| ntst | 20 | Number of mesh intervals |
| ncol | 4 | Collocation points per interval |
| Direction | forward | Continue in positive or negative parameter direction |
| Step size | 0.01 | Initial continuation step size |
| Max steps | 100 | Maximum continuation steps |

### Step 4: View Results

After continuation completes, you can inspect the limit cycle branch:
- Each point contains the full limit cycle profile
- Eigenvalues (Floquet multipliers) indicate stability
- Use the plotting script to visualize all cycles together

---

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

Fork uses the complex eigenvector q to construct an initial limit cycle guess. Let q = qᵣ + i·qᵢ be the eigenvector for eigenvalue iω. The initial profile is:

```
x(θ) = x₀ + A·[qᵣ·cos(2πθ) - qᵢ·sin(2πθ)]
```

for θ ∈ [0, 1], where:
- **x₀** is the equilibrium at the Hopf point
- **A** is the user-specified amplitude
- **qᵣ, qᵢ** are real and imaginary parts of the eigenvector

The initial period guess is:

```
T₀ = 2π / ω
```

### Choosing the Amplitude

The amplitude parameter controls how far from the Hopf point the initial guess is placed:

- **Too small** (< 0.01): The cycle is nearly degenerate; Newton may have trouble
- **Too large** (> 1.0): Outside the basin of convergence
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

### Comparison with MATCONT's Approach

MATCONT uses a **global S-matrix reduction** algorithm:

| Aspect | Fork (Sequential) | MATCONT (Global S-matrix) |
|--------|-------------------|---------------------------|
| **Build phase** | Chain T_i matrices one interval at a time | Build full (ntst×dim) × ((ntst+1)×dim) S-matrix |
| **Elimination** | Sequential dim×dim solves | Banded Gaussian elimination with pivoting |
| **Memory** | O(dim²) working memory | O(ntst × dim²) for S-matrix |
| **Computational cost** | O(ntst × (ncol×dim)³ + ntst × dim³) | O(ntst × (ncol×dim)³ + ntst × dim³) |
| **BVP structure** | Implicit periodicity (last equation wraps to x₀) | Explicit boundary row (x₀ - x_{ntst} = 0) |

Both approaches are **mathematically equivalent** and extract the same monodromy eigenvalues. The primary differences are:

1. **Memory efficiency**: Sequential approach avoids allocating the full S-matrix
2. **BVP compatibility**: Sequential approach naturally handles implicit periodicity; MATCONT requires explicit boundary variables

### Why Not Use MATCONT's Exact Approach?

Fork's BVP uses **implicit periodicity**: the last continuity equation wraps x_{ntst} back to x₀, meaning both endpoints share the same Jacobian column. MATCONT's algorithm assumes **explicit periodicity**: x_{ntst} is a separate variable with an explicit boundary equation x₀ - x_{ntst} = 0.

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

## References and Further Reading

- Doedel, E.J. "Lecture Notes on Numerical Analysis of Nonlinear Equations"
- Kuznetsov, Y.A. "Elements of Applied Bifurcation Theory"
- Keller, H.B. "Numerical Methods for Two-Point Boundary-Value Problems"
