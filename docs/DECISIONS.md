# Design Decision Log

This log captures small but impactful implementation decisions so future work (including AI agents)
does not unknowingly regress behavior. Add entries when you make a choice that is not obvious from
the code alone or when you introduce a workaround, shim, or architectural constraint.

## How to add an entry
- Append newest entries at the top.
- Keep entries short and concrete: what/why/impact + where to find it.
- Prefer ASCII text.

Template:
```
### YYYY-MM-DD: Title
Context:
Decision:
Why:
Impact:
References:
```

---

### 2026-07-14: Continue multidimensional inclination tests in exterior coordinates
Context:
A complex conjugate principal pair or a cluster of equally weak real modes has real dimension
`r > 1`. The transported transverse frame then has `m - 1` columns while the strong reference
frame has `m - r` columns, so `R^T T` is rectangular and has no signed determinant. Treating its
smallest singular value as a signed scalar would fabricate an orientation and create false events
when the overlap merely rotates.
Decision:
This decision supersedes the simple-real principal-mode restriction in the inclination-transport
entry below.
Represent the rank condition by every maximal minor of `R^T T`, that is, its top exterior-power
coordinate vector. Its norm `sqrt(det((R^T T)(R^T T)^T))` is the gauge-invariant product of overlap
singular values. Serialize a unit exterior orientation from the first nonzero accepted diagnostic,
carry it through the existing independent Procrustes frame alignment, and use its pairing with the
current minor vector only for the sign of the invariant exterior-volume scalar. For rectangular
brackets, additionally require
the chord between consecutive minor vectors to pass within `1e-3` relative norm of the origin; a
coordinate sign change without near-rank-loss is rejected. Group principal modes by normalized real
part with the existing inclination separation tolerance, and require a nonempty strong complement.
Why:
The exterior vector vanishes exactly when the strong-inclination overlap loses row rank and its norm
is invariant under orthogonal basis changes. The persisted orientation makes one-parameter
bracketing and restart deterministic without claiming that a complex determinant is intrinsically
signed.
Impact:
`SIF` and `TIF` now support complex conjugate, clustered, and multiple principal blocks when a
strong complement exists. Diagnostic payloads distinguish transported, reference, and principal
dimensions and expose the gauge-invariant exterior volume. Legacy square payloads remain readable.
References:
`crates/fork_core/src/continuation/heteroclinic_events.rs`,
`crates/fork_core/src/continuation/heteroclinic_transport.rs`,
`docs/heteroclinic-methods.md`,
[Deng](https://www.math.unl.edu/~bdeng1/Papers/DengTwistedLoop.pdf),
[De Witte et al. (2012)](https://doi.org/10.1145/2168773.2168776)

---

### 2026-07-14: Detect two-equilibrium inclination flips with transported tangent frames
Context:
Endpoint eigenvalues and endpoint displacement projections can detect spectral and orbit-flip
degeneracies, but they do not determine whether the source or target tangent bundle loses its
orientation along an open connection. Reusing a one-saddle homoclinic orientation flag would also
conflate two independent endpoint geometries.
Decision:
Transport the source principal tangent frame forward and the target principal tangent frame
backward along the corrected connection. Align each new frame to its previously accepted frame by a
full `O(k)` Procrustes transform, independently continuing transported-to-previous-transported and
reference-to-previous-reference gauges. Never align transported directly to reference. Require each
current-to-previous overlap to have minimum singular value at least `cos(pi / 9)`, then use the
signed determinants `det(R_source^T T_source)` and `det(R_target^T T_target)` as `SIF` and `TIF`. Restrict
automatic construction to a real, simple principal endpoint mode; report complex, repeated,
malformed, rank-deficient, or high-residual frames as unavailable. Localize only finite,
orientation-continuous sign brackets. Persist an optional `inclination_transport` diagnostic with
independent nullable `source` and `target` frames. Each frame stores the ambient and frame
dimensions, flattened column-major transported and reference matrices, minimum physical overlap
singular value, and relative transport residual.
Why:
Direct tangent transport measures the strong-inclination geometry itself. Independent full-`O(k)`
gauge continuation removes arbitrary eigensolver basis signs and reflections without forcing the
physical transported-versus-reference determinant positive, so its sign remains meaningful across
continuation steps. Optional version-tolerant diagnostics keep older branches readable and make
numerical eligibility auditable in Rust, WASM, CLI, and web.
Impact:
Two-equilibrium branches can carry localized `HeteroclinicSourceInclinationFlip` and
`HeteroclinicTargetInclinationFlip` markers labeled `SIF` and `TIF`. This is a Fork extension beyond
HBK 0.2.1 and AUTO97 heteroclinic orientation support, not a strict parity claim. De Witte et al.
supports the tangent/Riccati numerical approach but is not cited as defining Fork's exact
endpoint-separated determinant.
References:
`crates/fork_core/src/continuation/heteroclinic_events.rs`,
`docs/heteroclinic-methods.md`,
[Deng](https://www.math.unl.edu/~bdeng1/Papers/DengTwistedLoop.pdf),
[Liu, Ruan, and Zhu (2011)](https://www.math.miami.edu/~ruan/MyPapers/LiuRuanZhu-DCDSS2011.pdf),
[De Witte et al. (2012)](https://doi.org/10.1145/2168773.2168776),
[AUTO97 manual](https://www.staff.science.uu.nl/~kouzn101/AUTO/auto97man.pdf)

---

### 2026-07-13: Split published Orbit references from regular CI and project Chenciner conditioning
Context:
The MLfast LPC and Steinmetz-Larter NS targets were documented but not executable, while the natural
curve-corrected Chenciner locator spent minutes recomputing a full return-map normal form twice for
every collocation unknown solely to form an ambient finite-difference conditioning row.
Decision:
Keep analytic cycle curves, adaptx PD, and the natural Chenciner locator in regular Rust CI. Put the
two time-integrated published models in an ignored optimized slow tier with a five-minute scheduled
workflow. For Chenciner conditioning, project the signed source-bracket derivative onto the corrected
NS-curve tangent; retain the full curve correction, event coefficient, residual, and return-map
conditioning. Preserve an adapted source cycle's exact normalized mesh when constructing its NS
curve problem. Permit temporary Newton values of the NS cosine outside its physical interval, but
reject any converged point outside that interval.
Why:
Only the event-gradient component along the one-dimensional curve nullspace supplies new rank to the
augmented locator. Reintegrating the normal form in every ambient coordinate is redundant. Published
model integrations remain valuable independent oracles but are too expensive for the regular test
loop.
Impact:
The natural Chenciner fixture runs in seconds with explicit residual and conditioning assertions.
Executable MLfast $20\times4$/$32\times4$ and Steinmetz-Larter $16\times3$/$16\times4$ comparisons
start from attracting Orbits, locate the published bifurcations, and accept LPC/NS curve steps. The
Steinmetz path also guards nonuniform mesh provenance and NS Newton-domain handling.
References:
`crates/fork_core/src/continuation/codim1_curves/refinement.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/ns_curve.rs`,
`crates/fork_core/tests/published_cycle_references.rs`,
`.github/workflows/slow-cycle-references.yml`,
`docs/limit_cycle_continuation.md`

---

### 2026-07-13: Retain equilibrium codimension-two normal forms and correct branch predictors
Context:
Zero-Hopf and Hopf-Hopf markers were refined on Hopf curves, but Fork retained only a scalar test
value. There was no inspectable coefficient set or supported switch to the intersecting equilibrium
curves and the Neimark-Sacker curves of periodic orbits. The old Hopf-Hopf bialternate determinant
also touched zero without changing sign on a canonical unfolding.
Decision:
Compute Kuznetsov-normalized Zero-Hopf and nonresonant Hopf-Hopf multilinear coefficients at the
refined point, including eigenvector pairings, homological residuals, unfolding condition numbers,
and low-order resonance distance. Retain the scalar diagnostics on the refined marker. Build both
orientations of every equilibrium target from its defining-system tangent, and build the one
applicable Zero-Hopf plus both Hopf-Hopf NS-cycle predictors through second order before correcting
them on the collocation NS defining system. Detect Hopf-Hopf with the signed real part of the
non-source conjugate pair.
Why:
A serialized marker must contain enough numerical provenance to decide whether switching is safe.
Correcting the normal-form orbit on the actual target system prevents a plausible-looking seed from
being treated as a validated branch.
Impact:
Core and WASM callers can compute coefficients separately or request all corrected branch seeds.
Canonical three- and four-dimensional oracle tests continue several steps on every equilibrium and
periodic-orbit target. Resonant Hopf-Hopf points are reported as unsupported rather than applying
the nonresonant formulas.
References:
`crates/fork_core/src/continuation/codim1_curves/equilibrium_codim2.rs`,
`crates/fork_core/src/continuation/codim1_curves/branching.rs`,
`crates/fork_core/tests/equilibrium_codim2_branching.rs`,
`crates/fork_wasm/src/continuation/equilibrium_codim2.rs`,
`docs/equilibrium_codim2_branching.md`

---

### 2026-07-13: Adapt collocation meshes at the rejected numerical frontier
Context:
Reducing the pseudo-arclength step cannot repair a converged cycle whose fixed NTST/NCOL profile is
intrinsically under-resolved, and publishing a resized endpoint alone would mix incompatible packed
state layouts within one branch.
Decision:
Compute a scaled defect for every active interval. On the first retry of each continuation invocation,
redistribute the same number of intervals toward large defects when that changes the mesh materially;
on later retries, add a deterministic bounded number of intervals and place them by the same
defect-weighted rule. Interpolate the last accepted state, tangent, every published point, and saved
extension history onto the new Gauss layout. Retry the same PALC step without consuming its progress
or reducing its arclength. Limit retries and mesh growth explicitly, and preserve the exact normalized
mesh, cumulative attempts, and any budget/cap termination in serializable core metadata. A resumed
run gets a fresh retry budget while retaining earlier provenance; only attempts appended by that run
are applied to already-persisted branch states.
Why:
Dimension-changing adaptation must preserve the represented cycle and keep every point, tangent,
branch type, and valid resume seed on one layout. Nonuniform interval placement resolves a localized
defect without paying the cost of globally uniform refinement.
Impact:
Ordinary flow-cycle seed correction, continuation, and extension adapt automatically. The LPC, PD,
NS, and isoperiodic cycle-curve defining systems use the same redistribution/refinement policy with
layout-specific profile and border transfer. WASM, web, and CLI preserve exact meshes and cumulative
reports; the web Inspector and CLI expose enable/redistribution/tolerance/retry/cap controls plus a
concise provenance summary. This paragraph's original fixed-layout limitation for homoclinic
continuation was superseded by the HBK-parity decision below. Discrete maps still do not use flow
collocation.
References:
`crates/fork_core/src/continuation/problem.rs`,
`crates/fork_core/src/continuation/periodic.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/`,
`crates/fork_wasm/src/continuation/extension_runner.rs`,
`docs/limit_cycle_continuation.md`

---

### 2026-07-14: Localize one-sided HomHS events with tracked spectral identities
Context:
HBK and Fork expose raw `TLS`, `TLU`, `NCH`, `SH`, and `BT` test values whose ordered formulas do
not provide ordinary two-point sign brackets. The three-leading gaps touch zero and reopen, while a
stable or unstable center eigenvalue disappears from the corresponding partition at the imaginary
axis. Applying generic sign-change detection either missed these events or misclassified the same
spectral transition as `DRS`/`DRU` or a neutral-saddle event.
Decision:
Represent real eigenvalues and complex-conjugate pairs as deterministic spectral modes and match
them between consecutive corrected points. Detect `NCH` and `SH` only when the same real mode or
complex-pair representative crosses the imaginary axis. For `TLS` and `TLU`, compare the tracked
leading real branch with the leading complex pair to obtain a signed bracket, then bisect on the
corrected continuation branch; retain the ordered HBK gap as the serialized diagnostic. Promote a
refined center crossing to `BT` only when at least two eigenvalues are co-localized at zero. Treat
near-zero modes as center modes when persisting the refined diagnostic payload.
Why:
The signed tracking scalar supplies a refinement coordinate without changing the HBK-facing raw
test value. Matching identities prevents a nearest-eigenvalue reorder from fabricating a center
crossing, and post-refinement multiplicity verification prevents every zero eigenvalue from being
labeled Bogdanov-Takens.
Impact:
All five formerly diagnostic-only HBK channels now produce corrected, bidirectionally localized
markers through batch continuation, stepped runners, initial-tangent runners, restart, and
extension. Their raw diagnostics and marker labels survive serialization and remain visible in CLI
and web inspectors. Inclination flips remain unsupported.
References:
`crates/fork_core/src/continuation.rs`,
`crates/fork_core/src/continuation/homoclinic_events.rs`,
`docs/hclinic-parity.md`,
`docs/homoclinic-methods.md`

---

### 2026-07-14: Add a versioned two-equilibrium heteroclinic formulation
Context:
HBK 0.2.1's HomHS problem approaches the same saddle at both ends, while a genuine heteroclinic
connection approaches distinct source and target equilibria. Reusing Fork's one-saddle restart
metadata would conflate two different defining systems and could silently apply the wrong invariant
subspace at an endpoint.
Decision:
Add a separate `HeteroclinicCurve` and version-one connection schema. Solve both equilibrium
equations in the augmented system, maintain independent source-unstable and target-stable Riccati
charts, and impose endpoint projection and radius conditions against their corresponding
equilibria. Require the codimension-one index condition that the source unstable dimension plus the
target stable dimension equals the state dimension. Use adaptive nonuniform orthogonal collocation
as the first numerical representation, with atomic dual-projector refresh and exact mesh/schema
preservation through restart and extension. Expose creation from an open orbit plus two compatible
solved equilibria in the CLI and web UI.
Why:
Separate schemas make the endpoint ownership explicit and prevent homoclinic decoders from
accepting heteroclinic state. Collocation reuses Fork's established defect-control machinery while
providing a deterministic first end-to-end milestone.
Impact:
Fork can continue, serialize, restart, extend, inspect, and plot genuine two-equilibrium
heteroclinic curves through core, WASM, CLI, and web. The exact `tanh` connection on `mu = nu`
certifies the formulation. Standard single/multiple shooting and heteroclinic-specific spectral
event and special-point theory remain separate follow-ups; homoclinic event labels are not reused.
References:
`crates/fork_core/src/continuation/heteroclinic.rs`,
`crates/fork_wasm/src/continuation/heteroclinic_runner.rs`,
`docs/heteroclinic-methods.md`

---

### 2026-07-14: Add shooting without collapsing the two-equilibrium schema
Context:
Long or sensitive connections can benefit from shooting, but the existing shooting implementation
belongs to the one-saddle homoclinic defining system. Routing a genuine heteroclinic through it
would lose the independent target equilibrium and target invariant-subspace chart.
Decision:
Add a separate `HeteroclinicShootingSetupV1` and `HeteroclinicShootingProblem`. Store `M + 1`
shooting nodes, two equilibria, two Riccati charts, and the same version-one connection schema.
Interpret `M = 1` as single shooting and `M > 1` as multiple shooting. Serialize shooting branches
with an explicit discretization tag, `NTST = M`, `NCOL = 0`, and fixed integration steps per
segment. Keep adaptive orthogonal collocation as the default UI and CLI choice.
Why:
The numerical representation may change without changing endpoint ownership or the mathematical
defining system. A dedicated setup makes that distinction enforceable in decoding, restart, and
extension.
Impact:
The analytic two-saddle connection continues and extends with collocation, single shooting, and
multiple shooting through core, WASM, CLI, and web. Projector refresh remains atomic across the
source and target charts. Heteroclinic shooting never uses the one-saddle homoclinic schema.
References:
`crates/fork_core/src/continuation/heteroclinic_shooting.rs`,
`crates/fork_wasm/src/continuation/heteroclinic_shooting_runner.rs`,
`docs/heteroclinic-methods.md`

---

### 2026-07-14: Keep two-equilibrium event diagnostics endpoint-local
Context:
A genuine connection has different source and target equilibria. HBK/HomCont event names such as
neutral saddle, Shilnikov-Hopf, and Bogdanov-Takens are one-saddle homoclinic classifications and
cannot be obtained by concatenating eigenvalues from two unrelated endpoint Jacobians. At the same
time, the connection has useful endpoint-local spectral and geometric degeneracies that should be
localized and persisted.
Decision:
Store a separate `heteroclinic_events` payload. Eigendecompose the source and target Jacobians
independently. Detect endpoint hyperbolicity loss (`SHL`/`THL`), signed real-versus-complex leading
mode collisions (`SLC`/`TLC`), and simple-real endpoint orbit flips (`SOF`/`TOF`) using each
endpoint's own adjoint mode. Localize only finite sign-changing brackets. Report cross-endpoint
resonance (`XRS`) and source/target inclination flips (`SIF`/`TIF`) as unsupported with a reason.
Require an endpoint Morse-index change before accepting `SHL` or `THL`, and orient localization by
that index change so a nearest-mode identity swap cannot masquerade as loss of hyperbolicity.
Why:
The separate payload prevents homoclinic labels from leaking into a mathematically different
problem, while retaining auditable test values, exact localized markers, and both endpoint spectra
through Rust, WASM, CLI, web, and restart serialization.
Impact:
Users can inspect independent endpoint spectra and available/unavailable/unsupported connection
events. Loss-of-hyperbolicity markers are limiting points where the active hyperbolic formulation
ceases to apply. Scalar orbit-flip tests are unavailable for a complex leading eigenspace, and
inclination flips remain a future transported-variational calculation.
References:
`crates/fork_core/src/continuation/heteroclinic_events.rs`,
`docs/heteroclinic-methods.md`,
[Beyn (1990)](https://doi.org/10.1093/imanum/10.3.379),
[Homburg and Sandstede (2010)](https://doi.org/10.1016/S1874-575X(10)00316-4)

---

### 2026-07-14: Match HBK's HomHS formulations and keep true heteroclinics separate
Context:
HclinicBifurcationKit 0.2.1 follows a truncated orbit whose two endpoints approach the same
hyperbolic saddle. Its package name does not imply a two-distinct-equilibrium heteroclinic defining
system. Fork's earlier homoclinic path also used a fixed uniform collocation layout and stale
invariant-subspace bases, and it did not expose HBK's shooting or special-point data.
Decision:
Treat strict HBK parity as one-saddle HomHS continuation. Support defect-controlled nonuniform
orthogonal collocation and standard single/multiple shooting with the same saddle, endpoint-radius,
projection, phase, and Riccati equations. Refresh stable and unstable projectors in a chart-safe way:
transform the Riccati coordinates, accepted history, tangents, and resume seeds so the represented
physical subspaces do not change. Preserve nonuniform source meshes in long-cycle initialization and
restart. Evaluate, serialize, and display the implemented HBK spectral and orbit-flip tests, and
localize the channels with genuine signed brackets. Keep HBK's one-sided `TLS`, `TLU`, `NCH`, `SH`,
and `BT` values as diagnostics rather than manufacturing event markers from an absent bracket;
report inclination flips as unsupported because HBK only supplies placeholders. Use the
stable-side-symmetric difference for the raw `TLU` diagnostic, rather than HBK 0.2.1's literal sum
of positive unstable rates.
Why:
Numerical parity requires equivalent defining systems, initialization, mesh transfer, restart
coordinates, and observable event data—not merely similarly named UI actions. Separating genuine
heteroclinics prevents one-saddle metadata from being silently reused for a mathematically different
two-equilibrium connection.
Impact:
Core, WASM, CLI, and web support long-cycle and Bogdanov-Takens HomHS continuation with collocation
or shooting, adaptive collocation restarts/extensions, localized signed-bracket special points,
raw one-sided HBK diagnostics, and exact discretization metadata. The separate two-saddle
heteroclinic schema is implemented by the decision above and remains outside the HBK parity claim.
Continuation-aware eigenvalue tracking and touching-root
localization are required before `TLS`, `TLU`, `NCH`, `SH`, or `BT` can be promoted from diagnostics
to robust automatic markers. The tracked-spectral-identity decision above implements and supersedes
this original limitation.
Fork's heuristic equilibrium-to-Stage-D Method 3 is also tracked independently and is not counted as
HBK parity evidence.
References:
`crates/fork_core/src/continuation/homoclinic.rs`,
`crates/fork_core/src/continuation/homoclinic_shooting.rs`,
`crates/fork_core/src/continuation/homoclinic_events.rs`,
`crates/fork_core/src/continuation/homoclinic_init.rs`,
`crates/fork_wasm/src/continuation/`,
`docs/hclinic-parity.md`,
`docs/homoclinic-methods.md`

---

### 2026-07-13: Define map Neimark-Sacker curves with the multiplier matrix
Context:
The web exposed map Neimark-Sacker curve continuation through the flow Hopf runner. The core applied
`A^2 + kappa I` to the fixed-point residual Jacobian `D(F^m - I)`, which is neither the map
unit-circle condition nor the multiplier matrix used for stability.
Decision:
For maps, keep `D(F^m - I)` only in the fixed-point equations and PALC Jacobian. Build the spectral
border from `M = D(F^m)` and use `M^2 - 2 k M + I`, where `k = cos(theta)` for the critical conjugate
multiplier pair. Estimate `k` from the non-real pair closest to the unit circle, retain it as the
curve auxiliary, and expose the result as a Neimark-Sacker curve. The strong-resonance tests are
`k-1`, `k+1`, `k+1/2`, and `k` for resonances 1:1 through 1:4.
Why:
A map NS pair satisfies `lambda^2 - 2 cos(theta) lambda + 1 = 0`. Separating the residual and
spectral Jacobians also makes iterated-map fixed points use the correct `F^m` derivatives.
Impact:
The analytic rotating-map regression follows the exact two-parameter unit-modulus locus through
multiple core steps, and the WASM runner returns unit-modulus multipliers plus `cos(theta)` instead
of a flow frequency squared.
References:
`crates/fork_core/src/continuation/codim1_curves/hopf_curve.rs`,
`crates/fork_core/tests/map_ns_curve.rs`,
`crates/fork_wasm/src/continuation/curve_runners.rs`

---

### 2026-07-13: Gauge cycle curves on the full Gauss profile and split benchmark roles
Context:
LPC, PD, NS, and isoperiodic curves used incompatible pointwise or mesh-only phase gauges, and
single-step synthetic tests could pass without validating a nonlinear curve, its Floquet condition,
or the stable-Orbit initialization path.
Decision:
Use one Gauss-quadrature integral phase condition for every cycle curve, storing the complete
reference stage profile and `T_ref f(u_ref, p_ref)`. Hold that reference fixed during a Newton trial;
replace it only after an independently accepted step, then refresh defining-system data and compute
the next PALC tangent. Test curve solvers in two tiers: automated analytic Bautin, non-orientable PD
suspension, and transverse-pair NS suspension fixtures with exact loci and multipliers; then
published secondary validation targets from MATCONT's stable-Orbit MLfast (LPC), adaptx/Genesio-Tesi
(PD), and Steinmetz-Larter (NS) examples. Keep the adaptx Orbit-to-PD path in regular CI on a
Fork-owned coarse mesh and compare it against MATCONT's higher-resolution values.
Why:
The full profile removes phase freedom without depending on one storage node, while exact normal
forms localize numerical regressions and published models exercise the end-to-end workflow against
independent results.
Impact:
Rejected corrector trials cannot drift the phase reference. Multi-step tests check defining
residuals, off-node defects, and critical Floquet multipliers. Published mesh provenance is retained:
MLfast uses 30x4 and adaptx 20x4 in MATCONT; the Steinmetz-Larter source supplies integration and NS
data but no collocation mesh, so Fork-owned baseline/refinement meshes must be labeled and compared.
The generic NS event scalar is a magnitude-scaled bialternate product over nontrivial multipliers.
An NS label also requires an unchanged nonzero complex-pair count and a change in the number of
complex pairs outside the unit circle; stable real-to-complex transitions and reciprocal real pairs
therefore cannot masquerade as torus bifurcations.
References:
`crates/fork_core/src/continuation/lc_codim1_curves/mod.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/nonlinear_benchmarks.rs`,
`crates/fork_core/tests/adaptive_pd_reference.rs`,
`docs/limit_cycle_continuation.md`,
https://www.staff.science.uu.nl/~kouzn101/NBA/ManualMatcontAug2019.pdf,
https://bifurcationkit.github.io/BifurcationKitDocs.jl/stable/periodicOrbitCollocation/

---

### 2026-07-13: Use periodic Schur for large collocation Floquet problems
Context:
The block-cyclic Floquet formulation preserves stiff directions without forming a monodromy
product, but its dense eigenproblem has dimension `NTST * state_dimension`. Large adaptive meshes
therefore hit a memory and cubic-time ceiling even when the ODE state dimension is small.
Decision:
Add a pure-Rust complex periodic Hessenberg/QR backend. Scale and reverse the local transfer factors,
accumulate the periodic Schur bases, recover diagonal products in log-polar form, and reconstruct raw
mesh modes by solving the triangular periodic cocycle instead of repeatedly transporting one anchor
vector. `Auto` retains the block-cyclic implementation as the reference for block dimensions through
96 and selects periodic Schur above that; it may fall back only when the alternate dense problem is
within the existing 2048 limit. Explicit selections never change backend silently. Expose the choice
and the concrete backend used through core, WASM, and the web Floquet panel.
Why:
This reduces large-mesh Floquet work to `O(NTST * dimension^3)` arithmetic and
`O(NTST * dimension^2)` storage while retaining the product-free stiff-spectrum behavior required by
cycle bifurcation detection, normal forms, and invariant-manifold seeds.
Impact:
Large meshes no longer fail solely because the block-cyclic matrix exceeds the dense limit. The
periodic-Schur path also reconstructs singular zero-multiplier modes with a backward local
nullspace/preimage recurrence, including deterministic bases for repeated semisimple zeros, without
forming the dense block operator. The block-cyclic path remains independently testable for
cross-backend regression checks and explicit diagnostics. Native and browser builds use the same
algorithm without a platform LAPACK dependency.
References:
`crates/fork_core/src/continuation/periodic_schur.rs`,
`crates/fork_core/src/continuation/periodic.rs`,
`crates/fork_wasm/src/continuation/system_methods.rs`,
`web/src/compute/worker/forkCoreWorker.ts`,
`web/src/ui/inspector/SelectionInspectorView.tsx`,
`docs/limit_cycle_continuation.md`

---

### 2026-07-13: Continue flow limit cycles with collocation-native PALC and Floquet analysis
Context:
Orbit seeds could select a multiple of the minimal period, the pseudo-arclength metric changed with
NTST/NCOL, and chaining interval transfer matrices lost strongly contracting or expanding Floquet
modes. Floquet vectors were also projected for rendering, so they no longer satisfied the
variational cocycle used by branch switching and manifold seeding.
Decision:
Keep flow limit-cycle continuation entirely in the orthogonal-collocation BVP. Correct sampled
Orbit seeds at fixed parameter, use an integral phase condition and quadrature-weighted PALC metric,
and reject nontriviality or independent-defect failures. Obtain interval transfers by eliminating
collocation stages, but compute their spectrum from one block-cyclic eigenproblem instead of forming
the transfer product. Return raw mesh and stage Floquet modes, remove exactly one credible trivial
+1 multiplier for stability tests, and reject defective repeated roots rather than manufacturing
independent eigenvectors. Build PD predictors from the phase-dependent -1 mode only after verifying
both a nearby -1 multiplier and antiperiodic nullity. Define NS curves with the doubled-period real
condition `v(0) - 2 k v(1) + v(2) = 0` and independent diagonal/off-diagonal conditions from the
two-column bordered solve. LPC, PD, NS, and isoperiodic curves use the same quadrature-scaled PALC
metric and independent off-node defect acceptance rule as ordinary cycle continuation. Before a
rendered codimension-one cycle point is analyzed, canonicalize its stored explicit profile and apply
that point's subsystem snapshot and parameter values. In production manifold paths, propagate
collocation Floquet failures, require stored multipliers to match the recomputed spectrum, and retain
direct variational integration only for legacy cycles without parameter provenance. Branch extension
reuses the core quadrature-weighted PALC metric and validated Jacobian-null tangent, and a resume seed
is accepted only when it belongs to the visible endpoint; its adaptively selected step size is
preserved subject to any smaller local cap.
Why:
The resulting continuation and stability calculations remain mesh-scaled, preserve stiff Floquet
directions, and use the same collocation discretization for cycles, multipliers, eigenvectors, and
branch switching.
Impact:
Map Orbits are rejected by the flow-limit-cycle path. Orbit seeds must contain a finite, strictly
ordered time coordinate and a genuine nonconstant return. Under-resolved continuation trials are
retried at a smaller step, while Hopf and PD predictors remain free to leave the bifurcation
parameter during PALC correction. Invalid PD sources and defective Floquet eigenspaces now fail
explicitly instead of producing a plausible but numerically unsupported branch or mode. Exact fold
tangents are no longer perturbed with an artificial parameter component during branch extension.
References:
`crates/fork_core/src/continuation.rs`, `crates/fork_core/src/continuation/periodic.rs`,
`crates/fork_core/src/continuation/manifold.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/mod.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/ns_curve.rs`,
`crates/fork_wasm/src/continuation/lc_runner.rs`,
`web/src/state/appState.tsx`, `web/src/system/floquetModes.ts`,
`cli/src/continuation/initiate-lc-from-orbit.ts`

---

### 2026-07-12: Treat codimension-two branch predictors as corrected, inspectable seeds
Context:
Refined generalized-Hopf and Bogdanov-Takens points were selectable but could not initialize their
emanating codimension-one branches. The limit-point-of-cycles defining system also omitted the
explicit periodic boundary equations, so multidimensional cycle seeds were not square.
Decision:
Compute the second Lyapunov coefficient through fifth-order multilinear forms. At a nondegenerate
generalized-Hopf point, use the source Hopf-curve secant to predict a small fold of cycles and
correct it on the LPC defining system. At a nondegenerate Bogdanov-Takens point, compute normalized
nilpotent chains, quadratic coefficients, and the two-parameter unfolding, then construct and
correct nearby fold, Hopf, and open-orbit homoclinic seeds. Store source-point provenance and both
predictor and corrected residuals on every switched branch. Restore the missing explicit periodic
boundary equations in the LPC problem.
Why:
Branch switching is trustworthy only when the target defining-system residual is checked, and the
stored provenance makes the asymptotic perturbation and correction quality visible after creation.
Impact:
The web and CLI expose LPC switching from generalized-Hopf points and fold, Hopf, and homoclinic
switching from Bogdanov-Takens points after their nondegeneracy checks pass.
References:
`crates/fork_core/src/continuation/codim1_curves/branching.rs`,
`crates/fork_core/src/continuation/codim1_curves/normal_forms.rs`,
`crates/fork_core/src/continuation/lc_codim1_curves/lpc_curve.rs`

---

### 2026-07-12: Refine equilibrium codim-2 points on their source curve
Context:
Fold-curve cusp and Hopf-curve generalized-Hopf tests were constant placeholders, while other
codim-2 crossings were attached to an unrefined step endpoint and lost their numerical provenance.
Decision:
Use explicit fold quadratic/cusp cubic coefficients and the first Lyapunov coefficient. Locate
supported sign changes with bracketed secant interpolation followed by
pseudo-arclength correction back to the codim-1 curve. Replace the public crossing sample with the
refined point, but keep the solver at its accepted continuation endpoint. Store residuals,
coefficients, conditioning, and source-segment provenance on the selectable branch point. Restrict
generalized-Hopf calculations to flows; maps use the Neimark-Sacker/Chenciner path.
Why:
The locator preserves a bracket and avoids differentiating a normal-form coefficient, while keeping
continuation state stable and making numerical confidence inspectable.
Impact:
Initial and extended fold/Hopf curves expose refined codim-2 points consistently in WASM, web, and
CLI results. Higher-order nondegeneracy coefficients determine whether supported refined points are
eligible for branch switching.
References:
`crates/fork_core/src/continuation/codim1_curves/normal_forms.rs`,
`crates/fork_core/src/continuation/codim1_curves/refinement.rs`,
`crates/fork_wasm/src/continuation/curve_runners.rs`,
`web/src/ui/inspector/sections/branch/BranchDataSections.tsx`

### 2026-07-10: Extend 2D manifolds from accepted numerical frontiers
Context:
Two-dimensional equilibrium and limit-cycle manifolds could only be recomputed from their local
seed, even when a valid partial surface was already stored.
Decision:
Persist a versioned, backend-specific resume state with every 2D surface. Geodesic continuation
stores the accepted outer ring, inward leaf anchors, adaptive leaf delta, and accumulated
arclength. HKO continuation stores each phase fiber, its fundamental-segment family position, and
the converged collocation warm start. Segmented preimage continuation stores its phase fibers,
outer ring, arclengths, and return-segment configuration. Extension treats target arclength and
resource limits as additional work, retains the old mesh exactly, and appends seam-connected bands.
Why:
The rendered mesh alone does not contain the leaf genealogy or collocation state required for a
faithful restart. Replaying from the local seed is expensive and can produce a numerically
different surface.
Impact:
New 2D manifold branches can be extended in the web and CLI. Preexisting branches without resume
state must be recomputed once. Failed solves leave the stored branch unchanged.
References:
`crates/fork_core/src/continuation/manifold.rs`,
`crates/fork_core/src/continuation/types.rs`,
`crates/fork_wasm/src/continuation/manifold_2d_extension_runner.rs`,
`web/src/state/appState.tsx`, `cli/src/continuation/extend.ts`

### 2026-07-10: Use true K-O leaf continuation and HKO fundamental-segment BVPs for 2D manifolds
Context:
The equilibrium surface solver could jump between polygon segments or accept relaxed leaf hits, and
the limit-cycle option called `IsochronFibers` was a fixed-return preimage approximation rather than
the Hannam-Krauskopf-Osinga construction. Positive-multiplier `Both` also joined two distinct sheets
into one artificial ring.
Decision:
Continue every equilibrium leaf from its exact zero-time solution in source-position/time space,
solve the first Euclidean-distance event exactly, retain the solved source genealogy and per-leaf
step reductions, and refine long edges with exact leaves that demonstrably split their parent edge,
up to the configured point budget. Reject unresolved spacing. Implement HKO as two warm-started
collocation continuations: first build a nonlinear fundamental segment from the periodic-orbit BVP,
then traverse that segment and append full return segments along each phase isochron. Reject every
nonconverged collocation solve. Keep the old
backend as the explicitly named `SegmentedPreimageFibers` preview algorithm. Represent positive
`Both` as two branches and negative multipliers on a continuous double cover.
Why:
These are the topology, continuation, mesh, and convergence contracts used by the published K-O and
HKO algorithms; accepting approximations under the same names made failures fragile and misleading.
Impact:
Equilibrium 2D surfaces require the complete selected stable/unstable side to have dimension two.
Limit-cycle 2D surfaces require exactly one nontrivial real transverse Floquet direction. HKO runs are
more expensive than segmented preimages but expose phase shear, normal lift-off, and rejected-solve
diagnostics, and never place a nonconverged BVP point in the mesh.
References:
`crates/fork_core/src/continuation/manifold.rs`, `crates/fork_core/src/continuation/types.rs`,
`web/src/ui/InspectorDetailsPanel.tsx`, `cli/src/continuation/initiate-lc.ts`,
`docs/invariant_manifolds.md`, `docs/limit_cycle_manifold_2d_experimental.md`

### 2026-07-10: Persist resumable state for 1D invariant-manifold extension
Context:
Flow and map 1D manifolds could only be recomputed from their equilibrium or cycle seed, while map
growth may stop partway through an adaptively sampled fundamental domain.
Decision:
Persist a versioned curve resume state. Flow branches store the terminal state. Map branches store
the cycle anchor, active domain, pending samples/cursor, spacing target, effective iterate count,
and growth count; cycle-phase states are propagated independently. Extend through a dedicated
stepped WASM runner and atomically replace the stored branch only after success. Replay legacy map
branches once when resume metadata is absent.
Why:
Endpoint-only continuation must preserve accepted points and resume the numerical construction,
including stable preimages, negative multipliers, cycle phases, and interrupted domains.
Impact:
`eq_manifold_1d` curve geometry has optional `resume_state`; web and CLI expose `Extend Manifold`,
and consumers must preserve this field when normalizing or serializing branch geometry.
References:
`crates/fork_core/src/continuation/manifold.rs`, `crates/fork_core/src/continuation/types.rs`,
`crates/fork_wasm/src/continuation/eq_manifold_1d_extension_runner.rs`,
`web/src/state/appState.tsx`, `cli/src/continuation/extend.ts`, `docs/invariant_manifolds.md`

### 2026-04-25: 2D manifold growth keeps solved adaptive rings
Context:
The 2D equilibrium manifold solver had Krauskopf-Osinga-style controls, but robustness suffered
because adaptive rings were resampled back to the previous point count and failed leaves could be
filled by synthetic points.
Decision:
Keep inserted/removed ring vertices after spacing adaptation, evaluate geodesic quality through each
point's stored source parameter, solve inserted points as true leaf hits, and report unsolved leaves
instead of synthesizing geometry. The leaf solve controls the Euclidean distance from the base point
inside the outward half-leaf, matching the Krauskopf-Osinga construction, rather than a signed
projection that can hide large tangential jumps. Mesh adaptation removes neighbors below
`min_spacing`, as in the K-O leaf-add/drop rule, while finite edge-ratio variation is left to the
turn and distance-angle quality checks. Make `AdaptiveGlobal` the web/CLI default and keep
Lorenz-specific values as a named reference profile.
Why:
This preserves the adaptive mesh the algorithm asks for and avoids off-manifold geometry that can hide
solver failures while making the default usable beyond Lorenz.
Impact:
2D surface meshes can have varying ring sizes; downstream consumers must rely on `ring_offsets`
rather than assuming equal point counts.
References:
`crates/fork_core/src/continuation/manifold.rs`, `web/src/ui/InspectorDetailsPanel.tsx`,
`docs/invariant_manifolds.md`

### 2026-02-16: Web persistence V3 hard cutover with sharded entities and ZIP-only transfer
Context:
The web app previously rewrote large JSON payloads on many updates and used name-coupled references
that amplified rewrite churn after renames.
Decision:
Adopt persistence V3 with per-system manifests/meta/ui, object/branch indexes, sharded payload files
(`objects/<shard>/<id>.json`, `branches/<shard>/<id>.json`), ID-based parent/start references, and
lazy entity hydration. Use new namespaces (`fork-systems-v3` in OPFS, `fork-systems-v3` IndexedDB DB)
and ZIP-only import/export via archive APIs.
Why:
This removes whole-file rewrite pressure, improves large-system load behavior, and keeps lookup costs
bounded without directory scans.
Impact:
Hard cutover: legacy local namespaces and legacy JSON import format are intentionally not read.
Users must re-seed defaults or import V3 ZIP archives. `saveUi()` is UI-only, while `save()` writes
only changed payload records plus updated indexes/manifest.
References:
`web/src/system/opfs.ts`, `web/src/system/indexedDb.ts`, `web/src/system/archive.ts`,
`web/src/system/store.ts`, `web/src/system/types.ts`, `web/src/state/appState.tsx`,
`web/src/system/importExport.ts`

### 2026-02-11: Object-scoped frozen-variable subsystems as compute context
Context:
Fast-slow workflows require running solves/continuations in reduced subsystems where selected state
variables are frozen, while preserving consistent full-system display behavior.
Decision:
Make frozen-variable subsystem configuration object-scoped and snapshot-based. All compute calls go
through the subsystem gateway, which builds reduced run configs and maps states between reduced and
full coordinates. Persist reduced-canonical computed states and immutable subsystem snapshots on
branches/derived objects.
Why:
Keeps the model modular and reproducible while avoiding ad hoc per-solver reduction logic.
Impact:
Objects define their own frozen context; branches inherit immutable snapshots; UI renders by embedding
reduced states into full-system coordinates with per-point projection overrides for frozen continuation
parameters.
References:
`web/src/system/subsystemGateway.ts`, `web/src/system/types.ts`,
`web/src/state/appState.tsx`, `docs/frozen_variable_subsystems.md`

### 2026-02-11: Frozen continuation parameter identity split between runtime and persisted metadata
Context:
Codim-1 branch extension and projection regressions occurred when frozen-variable continuation
parameters were encoded only as display labels or only as runtime names.
Decision:
Use explicit persisted refs (`ParameterRef`) as source-of-truth metadata; convert to runtime parameter
names (including generated `fv__...`) only at compute/extension request boundaries. On extension
results, restore/preserve two-parameter metadata and display labels for stored branch data.
Why:
Prevents unknown-parameter errors at runtime and avoids post-extension projection collapse along
secondary frozen continuation parameters.
Impact:
Extension requests reliably use runtime names; stored branches remain display-stable; scene and
inspector projection can recover frozen param2 semantics even if response payloads omit branch-type
refs.
References:
`web/src/system/subsystemGateway.ts`, `web/src/state/appState.tsx`,
`web/src/ui/ViewportPanel.tsx`, `web/src/ui/InspectorDetailsPanel.tsx`

### 2026-02-11: Scene rendering policy parity for continuation branches
Context:
State-space scenes and bifurcation diagrams needed aligned branch rendering semantics and selected-point
feedback for continuation objects.
Decision:
Standardize scene rendering so equilibrium and codim-1 bifurcation curves render as line traces with
dedicated codim-2 marker overlays only. Keep selected branch-point markers unified with diagram style,
and render envelopes (not full profile point clouds) for cycle-like continuation branches when one free
state axis is plotted.
Why:
Reduces visual noise and keeps scene behavior consistent with diagram interpretation.
Impact:
Codim-1 curves no longer render per-point markers in scenes, codim-2 points remain explicit, and
cycle-like one-free-axis projections use min/max envelopes for continuation branches.
References:
`web/src/ui/ViewportPanel.tsx`, `web/src/ui/ViewportPanel.test.tsx`,
`docs/frozen_variable_subsystems.md`

### 2026-01-22: Decouple map vs flow continuations only when taxonomy diverges
Context:
Some bifurcation continuation handlers share map/flow logic with label switches (e.g., PD
cycle vs limit cycle; Hopf vs Neimark-Sacker). We considered splitting all map/flow
continuations for consistency.
Decision:
Decouple only when map and flow represent different object types or initiation algorithms.
Keep shared handlers where the math/object is the same (e.g., fold curve continuation,
equilibrium continuation with mapIterations gating). Split PD cycle vs limit cycle now and
track Hopf vs Neimark-Sacker as a follow-on task.
Why:
Reduces accidental taxonomy drift without adding needless code duplication.
Impact:
Map PD cycle and flow PD limit cycle are separate actions; Hopf/NS will be split. Fold and
equilibrium continuations remain shared with mapIterations-specific configuration.
References:
`web/src/state/appState.tsx`, `web/src/ui/InspectorDetailsPanel.tsx`, bead Fork-os5v,
bead Fork-p1vn, epic Fork-oag1

### 2026-01-24: Neutral cursor for bifurcation legends
Context:
Bifurcation diagrams render a Plotly legend for labels, but legend toggles are disabled so object
visibility is controlled solely by the object tree. Plotly still shows a pointer cursor on legend
items, implying a separate visibility toggle that is not wired to object menu state.
Decision:
Add a diagram-scoped CSS override to force the legend cursor to `default` for bifurcation viewports.
Why:
Avoids suggesting an independent visible/hidden control that could drift from object menu state.
Impact:
Legend labels remain visible, but no interactive cursor appears on bifurcation diagrams.
References:
`web/src/App.css`, `web/src/ui/ViewportPanel.tsx`

### 2026-01-20: Accept 1D map samples after StrictMode effect cleanup
Context:
In React StrictMode, effects run and clean up immediately on first mount. The initial map sampling
request can be aborted in cleanup, but the worker can still resolve with a usable result. A global
mounted flag made us drop that completion forever, leaving the map graph blank until another UI
change retriggered sampling.
Decision:
Use a per-effect disposed flag and the current map key to ignore only truly stale results; accept
the first completed sample if the map key still matches, even if the initial effect cleanup ran.
Why:
Avoids a permanent "no samples" state on initial load while still guarding against out-of-date
responses when the map configuration changes.
Impact:
1D map graphs render on first load; subsequent range/config changes still discard stale samples.
References:
`web/src/ui/ViewportPanel.tsx`

### 2026-01-23: Store cycle points for map fixed-point solutions
Context:
Map fixed points can represent cycles via F^k(x) - x, but the UI needed the full orbit to render
all cycle points and show them in data tables.
Decision:
When solving or continuing map fixed points with mapIterations > 1, compute cycle_points by
iterating the map starting from the representative state and store the full list on the result.
The first point remains the representative for rendering and line traces.
Why:
Avoids re-running the map in the UI and keeps cycle rendering/inspection consistent across scenes
and bifurcation diagrams.
Impact:
Map fixed-point solutions optionally include cycle_points; flows are unchanged. UI renders cycle
tail points as circles with a diamond representative and shows a cycle table in the inspector.
References:
`crates/fork_core/src/equilibrium.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_core/src/continuation/problem.rs`, `crates/fork_core/src/continuation/types.rs`,
`crates/fork_wasm/src/continuation/shared.rs`, `web/src/ui/ViewportPanel.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`

### 2026-01-22: Continue from corrected step after bifurcation refinement
Context:
Refined bifurcation points can land on either side of the sign change, causing repeated detections
on subsequent steps even when the branch progresses past the crossing.
Decision:
Keep the refined point for the recorded bifurcation, but advance the continuation state from the
post-corrected step point (not the refined point) whenever a bifurcation is detected.
Why:
Avoids duplicate bifurcations while still storing the refined location for reporting and plotting.
Impact:
Continuation proceeds smoothly past bifurcations without repeated sign-change hits.
References:
`crates/fork_core/src/continuation.rs`

### 2026-01-21: Map period-doubling test uses determinant-style product
Context:
Map equilibrium continuation needed PD detection that stays well-defined when eigenvalues are
complex conjugate pairs.
Decision:
Compute the PD test as the product of (mu + 1) over real eigenvalues and |mu + 1|^2 for each complex
conjugate pair (equivalently det(J + I) for the map Jacobian).
Why:
This preserves the sign change at mu = -1 without introducing artificial zeros when the spectrum
is purely complex.
Impact:
Map fixed-point continuation uses a determinant-style PD test value with positive complex-pair
contributions.
References:
`crates/fork_core/src/continuation/util.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_wasm/src/continuation/shared.rs`

### 2026-01-20: Map fixed points use cycle length in equilibrium solves
Context:
Map fixed points can represent cycles by solving F^k(x) - x, but we had no way to set k.
Decision:
Store mapIterations on map equilibrium solver params and continuation branches, and pass it through
core/wasm with a default of 1 when omitted.
Why:
Keeps fixed points and cycles unified in the same object type without changing flow behavior.
Impact:
Map solves and continuations iterate the map and Jacobians; legacy data fall back to 1.
References:
`crates/fork_core/src/equilibrium.rs`, `crates/fork_core/src/continuation/equilibrium.rs`,
`crates/fork_wasm/src/equilibrium.rs`, `web/src/state/appState.tsx`, `cli/src/index.ts`

### 2026-01-19: Neimark-Sacker test returns 0 without complex pairs
Context:
Map equilibrium continuation could falsely flag an NS at the first step when the starting Jacobian
had only real (e.g., zero) eigenvalues but the next step introduced a complex pair inside the unit
circle. The sign-change detector treated the missing-complex case as positive.
Decision:
Make the NS test function return 0.0 when no complex conjugate pairs exist, so sign-change detection
only triggers when both sides of a step have complex pairs.
Why:
Prevents false NS detections at the start of a branch without adding per-step guards.
Impact:
NS detection ignores steps where complex pairs are absent; true NS crossings still change sign.
References:
`crates/fork_core/src/continuation/util.rs`, `crates/fork_core/src/continuation/equilibrium.rs`

### 2026-01-17: Treat OPFS as Chromium-only persistence
Context:
The web app uses OPFS (File System Access API) for `system.json` and `ui.json`, but Safari and
Firefox do not implement `FileSystemFileHandle.createWritable` in stable builds.
Decision:
Treat OPFS as a Chromium-only storage backend and always gate it behind capability checks
(`navigator.storage.getDirectory` + `FileSystemFileHandle.createWritable`). Use IndexedDB as the
persistent fallback for non-Chromium browsers (memory fallback if IndexedDB fails).
Why:
Avoid runtime crashes while keeping persistence reliable across browsers.
Impact:
Any new persistence work must feature-detect OPFS and never assume `createWritable` exists.
Docs and tests should call out the IndexedDB fallback path. IndexedDB quotas vary by browser/device
and can be evicted under storage pressure, so persistence code should handle quota errors and avoid
assuming unlimited storage.
References:
`web/src/system/opfs.ts`, `web/src/system/indexedDb.ts`, `web/src/system/storeFactory.ts`,
`web/src/main.tsx`, `web/ARCHITECTURE.md`

### 2026-01-10: Build web WASM during deploy
Context:
Committing `pkg-web` kept hosted builds simple but added binary churn to the repo.
Decision:
Stop tracking `crates/fork_wasm/pkg-web` and generate it during web builds with
`wasm-pack build --target web --out-dir pkg-web`. Vercel installs Rust + wasm-pack
and runs this step before `npm run build`.
Why:
Keeps the repo lean and avoids committing generated WASM artifacts.
Impact:
Local web setup and CI must have Rust + wasm-pack; `pkg-web` is generated on demand.
References:
`.gitignore`, `README.md`, `web/vercel.json`, `web/ARCHITECTURE.md`

### 2026-01-09: Commit web WASM package for hosted builds
Context:
Vercel builds the web app without a Rust toolchain, so `pkg-web` is missing and Vite cannot resolve
`@fork-wasm` during the build.
Decision:
Track `crates/fork_wasm/pkg-web` in git and generate it locally with
`wasm-pack build --target web --out-dir pkg-web` when core bindings change.
Why:
Keeps hosted builds working without requiring Rust/wasm-pack in the deploy environment.
Impact:
Repo now includes the web WASM artifacts; regenerate and commit after core/wasm updates.
References:
`.gitignore`, `crates/fork_wasm/pkg-web`, `web/vite.config.ts`,
`web/src/compute/worker/forkCoreWorker.ts`

### 2026-01-09: Enforce CLI-safe names across the UI
Context:
Web object/branch defaults historically used spaces, while the CLI requires names to be
alphanumeric with underscores only for storage and command parity.
Decision:
Treat object/branch/system names as CLI-safe identifiers (`[a-zA-Z0-9_]`) everywhere.
Web defaults now sanitize spaces to underscores and UI validation blocks invalid names.
Why:
Prevents CLI/web mismatch and avoids invalid filenames when persisting objects and branches.
Impact:
Creation/rename flows in the web UI now reject non-CLI-safe names and suggest underscore defaults.
References:
`cli/src/naming.ts`, `web/src/utils/naming.ts`, `web/src/state/appState.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`, `web/src/App.tsx`

### 2026-01-08: Split system UI persistence from core data
Context:
The web UI now needs per-project layout/render state (viewport sizing/order, render styles, etc.)
without rewriting large analysis payloads on every UI tweak.
Decision:
Persist core system data to `system.json` and UI state to `ui.json` in OPFS. Export/import uses a
combined project bundle (`system` + `ui`) and merges on load, falling back to legacy bundles when
`ui.json` is missing.
Why:
Keeps UI saves lightweight while ensuring exported systems recreate the same visual setup.
Impact:
Adds split serialization helpers and a `saveUi` path; UI edits debounce their own persistence.
References:
`web/src/system/serialization.ts`, `web/src/system/opfs.ts`, `web/src/state/appState.tsx`,
`web/src/ui/ViewportPanel.tsx`

### 2025-01-08: Viewport nodes live in the object tree
Context:
The UI needs multiple viewports (state-space scenes + bifurcation diagrams) that can be reordered and configured.
Decision:
Represent viewports as root `TreeNode` entries of kind `scene` or `diagram`, with configs stored in
`project.scenes` and `project.bifurcationDiagrams`. `createProject` seeds a default Main Scene node,
and `normalizeProject` backfills missing nodes for older projects. The viewport grid uses root order
and HTML5 drag handles to reorder nodes via `reorderNode`. Bifurcation viewports render a Plotly
placeholder annotation until UX is co-designed.
Why:
Keeps viewports in the same object model as other assets while enabling a DCC-style layout without
locking in bifurcation rendering decisions.
Impact:
Scene/diagram visibility toggles hide viewport tiles; viewport Plotly test IDs are now per-node.
References:
`web/src/project/model.ts`, `web/src/project/serialization.ts`, `web/src/ui/ViewportPanel.tsx`,
`web/src/ui/InspectorDetailsPanel.tsx`

### 2025-01-07: Lazy-load Plotly via adapter
Context:
Plotly bloats the main bundle; we want initial UI to load fast without changing the Plotly API surface.
Decision:
Load Plotly dynamically inside `plotlyAdapter.ts` with a cached promise and expose `preloadPlotly`/`isPlotlyLoaded`.
`PlotlyViewport` shows a lightweight loading overlay until Plotly is ready.
Why:
Keeps future feature work on Plotly unchanged while reducing the main bundle size.
Impact:
Viewport renders asynchronously on first load; unit tests must mock the adapter exports.
References:
`web/src/viewports/plotly/plotlyAdapter.ts`, `web/src/viewports/plotly/PlotlyViewport.tsx`,
`web/src/test/setup.ts`

### 2025-01-07: WASM equation validation uses worker + alias
Context:
System equation validation should run in Fork Core (WASM) without blocking the main thread.
Decision:
Run validation in the worker by attempting to construct `WasmSystem`; fall back to per-equation
attempts to surface specific parse errors. Use a Vite alias `@fork-wasm` to load the local
`crates/fork_wasm/pkg-web/fork_wasm.js`, and set `worker.format = "es"` for Vite builds.
Why:
Avoids UI freezes and keeps validation in core logic while making the worker buildable in Vite.
Impact:
Build requires a local `crates/fork_wasm/pkg-web` (built via `wasm-pack --target web --out-dir pkg-web`).
Type shims exist for
the WASM module, Plotly, and OPFS iterator typings.
References:
`web/src/compute/worker/forkCoreWorker.ts`, `web/vite.config.ts`,
`web/src/types/wasm.d.ts`, `web/src/types/plotly.d.ts`, `web/src/types/fileSystem.d.ts`,
`web/src/ui/InspectorDetailsPanel.tsx`
