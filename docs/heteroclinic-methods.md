# Heteroclinic Connection User Guide

Fork continues a sampled open orbit from one hyperbolic equilibrium to a
distinct hyperbolic equilibrium. This is a separate defining system from the
one-saddle homoclinic workflow and uses its own versioned restart schema.

## What is available

- adaptive nonuniform orthogonal collocation;
- independent source-unstable and target-stable invariant-subspace charts;
- two-parameter pseudo-arclength continuation in either direction;
- serialized restart and generic branch extension with exact mesh, fixed-scalar,
  endpoint, and projector context;
- independent source/target spectral diagnostics, sign-bracketed localization,
  and simple-real endpoint orbit-flip tests;
- creation, inspection, plotting, and extension in both the web UI and CLI.

Standard single/multiple shooting is not yet available. Source/target
inclination flips remain explicitly unsupported. Fork deliberately does not
attach one-saddle homoclinic event labels to a two-equilibrium connection.

## Connection event definitions

Let the source and target be distinct equilibria `x_-` and `x_+`, with

$$
A_- = D_x f(x_-, \alpha), \qquad A_+ = D_x f(x_+, \alpha).
$$

Fork eigensolves `A_-` and `A_+` separately. This follows the standard
finite-interval connecting-orbit formulation with independent asymptotic
boundary conditions at the two endpoints; see
[Beyn (1990)](https://doi.org/10.1093/imanum/10.3.379) and the numerical
continuation survey by
[Beyn et al. (2002)](https://doi.org/10.1016/S1874-575X(02)80025-X).
The following are Fork's signed detection functions:

- `SHL` and `THL` are the real part of the source or target eigenvalue
  nearest the imaginary axis. A zero marks loss of endpoint hyperbolicity and
  therefore the boundary of validity of the active hyperbolic connection
  formulation.
- For `SLC`, let `lambda_r^u` be the weak real source-unstable mode and
  `lambda_c^u` the positive-imaginary representative of the weak complex
  source-unstable pair. Fork uses

$$
\psi_{\mathrm{SLC}} = \operatorname{Re}\lambda_r^u
  - \operatorname{Re}\lambda_c^u.
$$

  `TLC` is the same signed dominance gap for the weak real and complex modes
  in the target-stable spectrum. A sign change exchanges which real or
  complex eigenspace is leading.
- For a simple real weak source-unstable eigenvalue, let `q_-` and `p_-` be
  right and adjoint eigenvectors normalized by
  `p_-^* q_- = 1`. With the truncated source displacement
  `delta_- = u(-T) - x_-`, Fork uses

$$
\psi_{\mathrm{SOF}} = \operatorname{Re}(p_-^*\delta_-).
$$

  `TOF` uses the target's own weak stable adjoint eigenvector and
  `delta_+ = u(T) - x_+`. Adjoint projection boundary conditions are standard
  in connecting-orbit continuation; see
  [Doedel et al. (2007)](https://arxiv.org/abs/0706.1688). Flip terminology
  and its geometric scope are reviewed by
  [Homburg and Sandstede (2010)](https://doi.org/10.1016/S1874-575X(10)00316-4).

Each available scalar is localized only across a finite sign-changing bracket.
The corrected marker serializes the exact event value and both endpoint
spectra. A complex leading eigenspace makes the scalar `SOF` or `TOF` channel
unavailable because eliminating a two-dimensional complex coefficient is not
a generic scalar condition.

The Inspector and CLI also list unsupported channels rather than fabricating
homoclinic analogues:

- `XRS`: no neutral-saddle-style cross-endpoint resonance is assigned to one
  open connection. Such stability indices require additional global-return or
  closed-cycle data.
- `SIF` and `TIF`: inclination flips require transported tangent-space or
  adjoint-variational orientation data along the connection; endpoint spectra
  alone are insufficient.

## Required objects

Start with three objects produced from the same frozen subsystem and parameter
snapshot:

1. an orbit sampled from the source toward the target;
2. a solved source equilibrium;
3. a different solved target equilibrium.

Both equilibria must be hyperbolic. For a codimension-one connection in an
`n`-dimensional flow, Fork requires

```text
dim(W^u(source)) + dim(W^s(target)) = n.
```

The two continuation parameters must be distinct. The usual connection extras
are the truncated flight time `T` and endpoint radii `eps0` and `eps1`; choose
at least one and at most two of them as free quantities.

## Web workflow

1. Select the source-to-target Orbit in the object tree.
2. Open **Continuation**, then **Heteroclinic Connection**.
3. Select the source and target equilibrium objects.
4. Select two continuation parameters and configure `NTST`, `NCOL`, free
   extras, continuation direction, adaptivity, and projector refresh cadence.
5. Create the branch. Select it to inspect endpoint names, schema version,
   source/target spectra and event statuses, Morse dimensions, and mesh report.
6. Use **Extend branch** to continue from either end.

Fork rejects stale or incompatible equilibrium objects instead of projecting
them into the orbit's subsystem implicitly.

## CLI workflow

Manage the Orbit and choose **Continue Heteroclinic Connection**. The wizard
asks for the same endpoint, parameter, collocation, free-extra, adaptivity, and
continuation settings as the web UI. The new branch appears under the Orbit and
can be inspected or extended from the Orbit's branches menu.

## Restart contract

Every `HeteroclinicCurve` stores schema version 1 with:

- both continuation parameter indices and the base parameter vector;
- independent source and target basis snapshots and Morse dimensions;
- fixed values for any non-free `T`, `eps0`, or `eps1`;
- projector refresh cadence;
- `NTST`, `NCOL`, the normalized mesh, adaptivity settings, and the latest
  adaptation report.

Extension fails fast if the selected endpoint cannot be decoded with this
schema. It never falls back to the homoclinic one-saddle layout.

## Numerical reference

The deterministic acceptance model is

```text
x' = 1 - x^2
y' = x y + (mu - nu)(1 - x^2).
```

It has the exact connection `(x, y) = (tanh(t), 0)` from `(-1, 0)` to
`(1, 0)` on the locus `mu = nu`. The reference tests multiple accepted
continuation steps, endpoint ownership, independent invariant splittings,
adaptive mesh persistence, independent event serialization, and extension.
The core runner also has a signed `SLC` reference that brackets and localizes
the exact zero to tolerance:

```bash
cargo test -p fork_core --test heteroclinic_reference
cd cli && npm run test:wasm
```
