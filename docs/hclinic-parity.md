# HclinicBifurcationKit parity

This document tracks Fork against
[HclinicBifurcationKit.jl (HBK)](https://github.com/bifurcationkit/HclinicBifurcationKit.jl),
using the `v0.2.1` source rather than inferring capabilities from the package
name.  The audited source revision is
[`426e578`](https://github.com/bifurcationkit/HclinicBifurcationKit.jl/tree/426e57845bfdb6a46422acd71bb95d9fc1a90c29).
The relevant upstream documentation is HBK's
[hyperbolic-saddle HomHS formulation](https://bifurcationkit.github.io/HclinicBifurcationKit.jl/dev/homoHS/),
[collocation](https://bifurcationkit.github.io/HclinicBifurcationKit.jl/dev/periodicOrbitCollocation/),
[shooting](https://bifurcationkit.github.io/HclinicBifurcationKit.jl/dev/shooting/),
[special-point detection](https://bifurcationkit.github.io/HclinicBifurcationKit.jl/dev/detectionBifurcation/),
and [branch switching](https://bifurcationkit.github.io/HclinicBifurcationKit.jl/dev/branchswitching/).

## Scope

HBK currently implements a homoclinic connection whose two truncated-orbit
endpoints approach the **same hyperbolic saddle**.  It does not implement a
connection between two distinct equilibria: the source and target boundary
conditions share one saddle, one Jacobian, and one stable/unstable splitting.

Accordingly, strict HBK parity and genuine two-saddle heteroclinic continuation
are separate Fork milestones. Fork now implements the latter with two
equilibria, two Jacobians, independent source/target invariant subspaces, and a
versioned connection schema. It remains an extension beyond HBK 0.2.1 rather
than evidence for strict HBK parity.

## Source-backed capability matrix

| Capability | HBK 0.2.1 | Fork |
| --- | --- | --- |
| Projection-boundary-condition HomHS | Open orbit, saddle equation, endpoint projections/radii, and CIS-Riccati variables | Supported |
| Free homoclinic quantities | One or two selected from `T`, `eps0`, and `eps1` | Supported and validated end to end |
| Orthogonal collocation | Open-orbit collocation with an integral phase condition | Supported |
| Adaptive collocation mesh | Defect-driven mesh redistribution | Supported for homoclinic collocation |
| Standard shooting | Single shooting (`M=1`) and multiple shooting (`M>1`) | Supported; collocation remains the default |
| Parallel shooting segments | Optional parallel segment evaluation | Numerically equivalent serial evaluation; parallel execution is a benchmark-driven performance follow-up |
| Long-cycle initialization | Convert a long periodic orbit to collocation or shooting | Supported for both discretizations |
| Bogdanov-Takens switch | Fourth-order BT predictor followed by correction/continuation | Supported; a collocation predictor can be sampled onto shooting nodes |
| Two-parameter PALC | Continue a HomHS curve in a parameter plane | Supported in both directions |
| Sign-bracketed spectral special points | `NNS`, `NSF`, `NFF`, `DRS`, `DRU`, `NDS`, and `NDU` | Supported with named, localized markers and per-point serialized test values |
| One-sided spectral events | HBK exposes raw `TLS`, `TLU`, `NCH`, `SH`, and `BT` scalars, but its event handler cannot normally bracket their ordered one-sided formulas | Supported and localized with continuation-aware spectral identities; raw values remain serialized at the corrected marker |
| Orbit flip | Optional `OFS`/`OFU` tests | Exposed only when the required adjoint data are available |
| Inclination flip | `IFS`/`IFU` are constant placeholders, not implemented | Explicitly reported as unsupported |
| Genuine two-saddle heteroclinic | Not implemented | Supported beyond strict parity with adaptive orthogonal collocation (default), standard single/multiple shooting, restart, extension, independent endpoint spectra, localized `SHL`/`THL`/`SLC`/`TLC`/`SOF`/`TOF` and transported `SIF`/`TIF` channels, with `XRS` explicitly unsupported |

The transported two-saddle `SIF`/`TIF` channels do not change the strict HBK
inclination-flip row above. They are a separate Fork extension with independent
source-forward and target-backward tangent frames, plus independent `O(k)`
Procrustes gauge alignment against the preceding accepted frames, and a
real-simple principal-mode restriction. The transported and reference frames
are never aligned directly to one another before evaluating their signed determinant. The
[AUTO97 manual](https://www.staff.science.uu.nl/~kouzn101/AUTO/auto97man.pdf)
likewise does not provide heteroclinic orientation support, while
[De Witte et al. (2012)](https://doi.org/10.1145/2168773.2168776) provides the
tangent/Riccati numerical precedent rather than Fork's exact two-endpoint
determinant scalar.

Fork uses the mathematically symmetric three-leading-unstable diagnostic
`Re(lambda1) - Re(lambda3)`. HBK 0.2.1 literally uses a plus sign for `TLU`,
which cannot vanish while both eigenvalues remain unstable. Even with that
correction, ordered `TLS`/`TLU` gaps only touch zero, while `NCH`, `SH`, and
`BT` lose their selected stable/unstable eigenvalue at zero. HBK registers all
five with a sign-crossing event handler, but the audited implementation cannot
normally localize them. Fork matches real modes and conjugate-pair
representatives between corrected steps. `TLS`/`TLU` use the signed separation
between the tracked leading real branch and leading complex pair, then refine
the zero on the corrected branch while retaining the raw touching gap.
`NCH`/`SH` follow the same real mode or complex pair through the imaginary
axis. A marker is promoted to `BT` only when the refined spectrum verifies at
least two co-localized center eigenvalues.

## Numerical acceptance

The conservative Duffing family provides a deterministic reference: its
homoclinic locus in Fork's two-parameter test system is `mu = nu`.  The core
test suite requires collocation, single shooting, and multiple shooting to
advance on that locus from the same long-cycle seed.  Additional tests cover:

- non-diagonal saddle eigendirections and packed-state layout;
- rejection of nonhyperbolic saddles and singular three-free-quantity setups;
- nonuniform-mesh residual scaling, PALC quadrature, defect estimation, and
  mesh transfer;
- every implemented homoclinic special-point scalar, direct sign-bracketed
  event, tracked center crossing, and three-leading touching-root path;
- real Node-WASM, CLI, and browser creation/rendering workflows.

The four-dimensional saddle-focus fixture appends a stable complex pair to the
Duffing loop. It certifies conjugate-pair basis construction, multiple shooting,
and an available `NSF` channel without treating unavailable real/bi-focus
channels as zero-valued events.

Fork's separate heteroclinic acceptance fixture uses
`x' = 1 - x^2`, `y' = x y + (mu - nu)(1 - x^2)`. Its exact connection
`(x, y) = (tanh(t), 0)` runs from `(-1, 0)` to `(1, 0)` on `mu = nu`.
The test certifies independent endpoint equilibria and splittings, the packed
version-one schema, defect-driven mesh redistribution, serialization, restart,
extension, transported inclination-frame persistence and diagnostics, and the
real Node-WASM, CLI, and web boundaries. See
[`heteroclinic-methods.md`](heteroclinic-methods.md) for the user workflow and
current limitations.

## Important non-parity workflow

Fork's equilibrium-to-homotopy-saddle Method 3 is not an HBK workflow.  Until
its staged defining systems are corrected and certified, a Stage D label alone
must not be interpreted as proof of a homoclinic connection.  Method 4 remains
the conversion from an already corrected Stage D profile to the homoclinic
defining system.
