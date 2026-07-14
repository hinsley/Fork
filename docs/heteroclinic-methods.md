# Heteroclinic Connection User Guide

Fork continues a sampled open orbit from one hyperbolic equilibrium to a
distinct hyperbolic equilibrium. This is a separate defining system from the
one-saddle homoclinic workflow and uses its own versioned restart schema.

## What is available

- adaptive nonuniform orthogonal collocation;
- standard single shooting (`M = 1`) and multiple shooting (`M > 1`);
- independent source-unstable and target-stable invariant-subspace charts;
- two-parameter pseudo-arclength continuation in either direction;
- serialized restart and generic branch extension with exact mesh, fixed-scalar,
  endpoint, and projector context;
- independent source/target spectral diagnostics, sign-bracketed localization,
  simple-real endpoint orbit-flip tests, and transported source/target
  inclination-flip tests when eligible tangent frames are available;
- creation, inspection, plotting, and extension in both the web UI and CLI.

Fork deliberately does not attach one-saddle homoclinic event labels to a
two-equilibrium connection. Older branches without tangent-transport data remain
readable; their source/target inclination-flip channels are reported as unavailable.

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
  formulation. Fork requires the corresponding endpoint Morse index to change
  across the bracket, so a mere exchange between the nearest stable and
  unstable modes cannot create a false marker. Localization uses the minimum
  absolute real part with the bracket's Morse-index orientation.
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
- `SIF` and `TIF` measure loss of orientation in endpoint-local tangent bundles,
  not a relation between the two endpoint spectra. Along the corrected orbit,
  Fork directly transports a source frame forward and a target frame backward
  with the tangent variational equation

$$
\dot V(t) = D_x f(u(t), \alpha)V(t).
$$

  Let `R_-` and `R_+` be orientation-continuous orthonormal reference frames
  for the source and target principal bundles, and let `T_-` and `T_+` be the
  corresponding transported frames. Before evaluating a new continuation
  point, Fork independently aligns the current transported frame to the
  preceding accepted transported frame and the current reference frame to the
  preceding accepted reference frame using full `O(k)` Procrustes transforms.
  It never aligns the transported frame directly to the reference frame. The
  alignment is accepted only when the minimum singular value of each
  current-to-previous overlap is at least `cos(pi / 9)`; otherwise only that
  endpoint channel becomes unavailable. This removes arbitrary eigensolver
  basis signs and reflections while preserving the physical relative
  orientation. The signed tests are then

$$
\psi_{\mathrm{SIF}} = \det(R_-^\mathsf{T}T_-), \qquad
\psi_{\mathrm{TIF}} = \det(R_+^\mathsf{T}T_+).
$$

  For a one-dimensional frame these determinants reduce to signed dot
  products. Automatic construction currently requires the relevant principal
  source-unstable or target-stable mode to be real and simple; a complex or
  repeated principal mode makes that endpoint channel unavailable. Frames must
  have the declared ambient-by-frame size, full column rank, and an acceptable
  relative tangent-transport residual. The physical transported-to-reference
  overlap is allowed to become singular because its determinant zero is the
  event being detected; the separate current-to-previous gauge overlaps must
  still pass the continuity threshold.

The forward/backward construction follows the strong-inclination geometry and
principal-direction distinctions described by
[Deng](https://www.math.unl.edu/~bdeng1/Papers/DengTwistedLoop.pdf) and
[Liu, Ruan, and Zhu (2011)](https://www.math.miami.edu/~ruan/MyPapers/LiuRuanZhu-DCDSS2011.pdf).
[De Witte et al. (2012)](https://doi.org/10.1145/2168773.2168776) motivates the
use of tangent transport and continuously updated invariant subspaces in
connecting-orbit numerics; it does not define Fork's exact endpoint-separated
determinant scalar.

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

`SIF` and `TIF` are available only when their corresponding transport frame is
present and eligible. The serialized `inclination_transport` payload records
the flattened column-major transported and reference frames, ambient and frame
dimensions, minimum overlap singular value, and relative transport residual
for independent source and target inspection. The reported minimum singular
value measures conditioning and event proximity of the same-point physical
transported-to-reference overlap. The transient current-to-previous overlaps
used by the gauge-continuity gate are not serialized.

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
4. Select two continuation parameters and choose **Orthogonal Collocation**
   (the default) or **Standard Shooting**. For shooting, `1` interval is single
   shooting and more than one is multiple shooting; configure the fixed
   integration steps per segment. Then configure the free extras, continuation
   direction, and projector refresh cadence.
5. Create the branch. Select it to inspect endpoint names, schema version,
   source/target spectra and event statuses, inclination-transport quality,
   Morse dimensions, and mesh report.
6. Use **Extend branch** to continue from either end.

Fork rejects stale or incompatible equilibrium objects instead of projecting
them into the orbit's subsystem implicitly.

## CLI workflow

Manage the Orbit and choose **Continue Heteroclinic Connection**. The wizard
asks for the same endpoint, parameter, numerical representation, free-extra,
and continuation settings as the web UI. The new branch appears under the Orbit and
can be inspected or extended from the Orbit's branches menu.

## Restart contract

Every `HeteroclinicCurve` stores schema version 1 with:

- both continuation parameter indices and the base parameter vector;
- independent source and target basis snapshots and Morse dimensions;
- fixed values for any non-free `T`, `eps0`, or `eps1`;
- projector refresh cadence;
- optional source and target inclination-transport frames and their overlap and
  residual quality diagnostics at each continuation point;
- an explicit discretization tag: collocation stores `NTST`, `NCOL`, the exact
  normalized mesh, adaptivity settings, and adaptation report; shooting stores
  its segment count in `NTST`, sets `NCOL = 0`, and stores integration steps per
  segment.

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
continuation steps with collocation, single shooting, and multiple shooting;
endpoint ownership; independent invariant splittings; adaptive mesh
persistence; independent event serialization; and extension.
The core runner also has a signed `SLC` reference that brackets and localizes
the exact zero to tolerance:

```bash
cargo test -p fork_core --test heteroclinic_reference
cd cli && npm run test:wasm
```
