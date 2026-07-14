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
- creation, inspection, plotting, and extension in both the web UI and CLI.

Standard single/multiple shooting and heteroclinic-specific spectral event and
special-point theory are not yet available. Fork deliberately does not attach
homoclinic event labels to a two-equilibrium connection.

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
   source unstable dimension, target stable dimension, and mesh report.
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
adaptive mesh persistence, serialization, and extension:

```bash
cargo test -p fork_core --test heteroclinic_reference
cd cli && npm run test:wasm
```
