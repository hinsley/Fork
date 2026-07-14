<p align="center">
  <img src="web/public/favicon.svg" alt="Fork logo" width="200" />
</p>
<p align="center">
  <a href="https://codecov.io/gh/hinsley/Fork">
    <img src="https://codecov.io/gh/hinsley/Fork/graph/badge.svg?token=YLTHXLLC0J" alt="codecov" />
  </a>
</p>

# Fork
Fork is a numerical bifurcation continuation software application with both a web UI and a Node.js CLI, supporting the analysis of smooth finite-dimensional maps and systems of ordinary differential equations.
The goal is to support all popular mobile and desktop devices.

## Supporters
Fork is developed in my spare time and incentivized both by my personal use of the software and by [Patreon support](https://www.patreon.com/ForkDynamics).
People who have supported Fork on Patreon are listed below.

### Current Supporters

- Christopher Hitzel
- Julien Brenneck

### Past Supporters

- Jacob Price

## Monorepo structure
Fork is a 4-part monorepo: a Rust core, WASM bindings, a Node.js CLI, and a web UI. The core is the numerical engine, while the CLI and web app provide different user interfaces on top of the same algorithms.

- `crates/fork_core`: Pure Rust numerical engine. It includes a small equation language: user-provided expressions are parsed into an AST, compiled into stack-based bytecode, and executed by a tiny VM against `f64` values or dual numbers for automatic differentiation. This feeds Newton solvers, continuation, stability, and collocation routines. The core is UI-agnostic and designed to be deterministic, testable, and reusable across frontends.
- `crates/fork_wasm`: WebAssembly bindings that wrap the core for JavaScript consumers. This lets the CLI and web UI share the exact same numerical engine and results.
- `cli`: Interactive Node.js CLI built on the WASM bindings. It exposes the core algorithms in a text-based workflow.
- `web`: Vite + React web UI that consumes the WASM bindings and renders results in the browser.

Rust and WebAssembly were chosen so the performance-critical numerical kernels and automatic differentiation live in one place, and the browser and CLI run identical continuation logic without a separate JavaScript reimplementation.

## Continuation and bifurcation support

Fork uses pseudo-arclength continuation (PALC) to follow solution branches through turns that a simple parameter sweep would miss. The tables below separate four different capabilities:

- **Branch continuation** follows equilibria, map cycles, or ODE limit cycles while one parameter varies.
- **Detection** marks and refines a bifurcation encountered on an existing branch.
- **Bifurcation-curve continuation** follows that bifurcation in a two-parameter plane.
- **Codimension-two detection** looks for special points on a bifurcation curve. Fork does not yet continue codimension-two sets.

**Available** means the main numerical path is implemented and integrated. **Experimental** means a usable code path exists, but it is simplified, contains temporary diagnostics, or still lacks benchmark coverage. **Not implemented** means that only types, placeholders, or no numerical path exist.

### Maps

Map cycles are represented as fixed points of an iterated map, <code>F<sup>k</sup>(x) = x</code>. The case <code>k = 1</code> gives fixed points, while <code>k > 1</code> can represent higher-period points.

| Object or event | Status | Current capability |
| --- | --- | --- |
| Fixed points and periodic points | **Available** | Solve and continue <code>F<sup>k</sup>(x) = x</code>; return the individual points of a <code>k</code>-cycle. |
| Saddle-node (fold) | **Available** | Detect and refine folds on map branches; continue fold curves in two parameters. |
| Branch point | **Detection and normal form available** | Localize a <code>+1</code> multiplier event and use the reduced map normal form to distinguish a saddle-node from transcritical, pitchfork, or degenerate branching. The coefficients and conditioning diagnostics also support iterated maps. |
| Period-doubling (flip) | **Detection and branch switching available** | Detect and refine a multiplier crossing <code>-1</code>, compute its cubic map normal form and criticality, and construct a seed for the doubled cycle. Two-parameter flip curves are not implemented. |
| Neimark-Sacker | **Available** | Detect and refine a complex multiplier pair crossing the unit circle, compute its complex cubic map normal form and criticality, then continue the Neimark-Sacker curve in two parameters. The generic normal form rejects the strong 1:1 through 1:4 resonances explicitly. The core, Node WASM, and web workflow are covered by analytic references with a known unit-circle locus. |
| Map codimension-two points | **Not implemented** | No dedicated map codimension-two defining system or validated detection path is present. |

### ODE equilibria

| Object or event | Status | Current capability |
| --- | --- | --- |
| Equilibrium branch | **Available** | One-parameter equilibrium continuation with adaptive PALC and branch extension. |
| Saddle-node (fold) | **Available** | Detect and refine folds; continue fold curves in two parameters. |
| Andronov-Hopf | **Available** | Detect and refine Hopf points, initialize a nearby limit cycle, and continue Hopf curves in two parameters. |
| Neutral saddle | **Detection available** | Detect a zero crossing of the real-eigenvalue pair-sum test on an equilibrium branch. No dedicated two-parameter connection locus is implemented. |

### ODE periodic orbits

| Object or event | Status | Current capability |
| --- | --- | --- |
| Limit-cycle branch | **Available** | Orthogonal collocation, initialization from a Hopf point or sampled orbit, branch extension, Floquet multipliers, and raw Floquet modes. Floquet analysis automatically uses the dense block-cyclic reference on small discretizations and a pure-Rust product-free periodic-Schur backend on large meshes, including singular zero-multiplier raw modes; the web UI also permits an explicit backend choice and records which solver ran. Ordinary cycles and LPC, PD, NS, and isoperiodic curves monitor the scaled collocation defect, redistribute nonuniform meshes or increase the interval count when needed, transfer accepted states and tangents across each remesh, and retain a structured adaptation report. Mesh-sensitive follow-on workflows preserve the stored mesh or reject unsupported legacy data instead of silently replacing it with a uniform mesh. |
| Limit point of cycles (LPC) | **Available; published benchmark pending** | Automatically detect and refine a cycle fold on an ordinary limit-cycle branch, then continue its two-parameter LPC curve. An analytic Bautin reference covers automatic detection, multiple curve steps, and the real-WASM web workflow; the published MLfast benchmark remains pending. |
| Generic branch point of cycles | **Detection, normal form, and switching available** | Distinguish a nontrivial <code>+1</code> Floquet branch point from an LPC using its Poincare-map normal form, then construct, correct, and continue the secondary periodic branch. Analytic transcritical and pitchfork suspensions validate the coefficients and switched branch. |
| Period-doubling of cycles | **Available; published curve benchmark pending** | Detect a multiplier crossing <code>-1</code>, compute its Poincare-map cubic normal form and criticality, initialize and continue the doubled-period branch, and continue the two-parameter PD curve. The core PD-cycle path is now properly tested—much better than before—including the published MATCONT stable-Orbit-to-collocation-to-PD workflow and multiple accepted PD-curve steps. |
| Neimark-Sacker / torus bifurcation | **Available; published benchmark pending** | Detect a complex Floquet pair crossing the unit circle, compute its complex cubic Poincare-map normal form and criticality, and continue the two-parameter NS curve. The generic normal form rejects the strong 1:1 through 1:4 resonances explicitly. An analytic transverse-pair reference covers multiple collocation-curve steps; the published Steinmetz-Larter benchmark remains pending. |
| Isoperiodic curves | **Available** | Continue a limit-cycle family in two parameters while holding its period fixed. This is a continuation constraint, not a bifurcation type. |

### Global connections

| Connection | Status | Current capability |
| --- | --- | --- |
| Homoclinic to a saddle equilibrium | **Available; HBK 0.2.1 numerical parity** | Projection boundary conditions, chart-safe Riccati coordinates, adaptive nonuniform orthogonal collocation, and standard single/multiple shooting are available from long cycles and Bogdanov-Takens points. Restarts and extensions preserve the discretization, mesh, invariant-subspace chart, and fixed scalar context. A Duffing reference certifies collocation and shooting through core, Node WASM, CLI, and web workflows. Fork's separate heuristic Method 3 Stage-D generation is not used as parity evidence and still needs an independent model certification. |
| Homoclinic to a saddle-focus | **Available; analytic reference validated** | Rank-revealing real invariant-subspace construction handles complex conjugate and repeated eigenvalues without double-counting. A four-dimensional Duffing-plus-focus reference certifies both collocation and multiple shooting and exercises the neutral saddle-focus diagnostic. |
| Heteroclinic between distinct equilibria | **Available; collocation reference validated** | Continue a sampled open orbit between two independently solved hyperbolic equilibria in two parameters. The versioned schema preserves separate source/target equilibria, invariant splittings, endpoint radii, adaptive nonuniform collocation mesh, and projector charts through restart and extension. The analytic <code>x=tanh(t)</code> reference certifies the exact <code>mu=nu</code> locus through core, Node WASM, CLI, and web workflows. Standard shooting and heteroclinic-specific spectral event theory remain follow-ups. |
| Homoclinic to a periodic orbit | **Not implemented** | No periodic-orbit endpoint and invariant-bundle defining system is present. |

See [the HclinicBifurcationKit parity matrix](docs/hclinic-parity.md), the
[homoclinic workflow guide](docs/homoclinic-methods.md), and the
[heteroclinic workflow guide](docs/heteroclinic-methods.md) for the audited
scope, initializers, discretizations, event codes, and numerical acceptance
tests.

### Codimension-two points

Equilibrium fold and Hopf curves run a bracketed secant locator after continuation. Each trial is corrected back to the codimension-one defining curve, and a refined point replaces the crossing step in the public branch. Refined points retain the curve residual, test residual, named normal-form coefficients, condition estimates, and source-segment provenance in the web and CLI inspectors. Fork still does not continue codimension-two sets.

| Point type | Status | Current capability |
| --- | --- | --- |
| Zero-Hopf and double-Hopf | **Available for nonresonant points** | Curve-corrected detection retains detailed local normal forms and conditioning. Zero-Hopf switches to both orientations of fold and Hopf curves and, when its sign condition holds, an NS curve of cycles. Hopf-Hopf switches to both orientations of either Hopf mode and to either emanating NS curve of cycles. The generic Hopf-Hopf formulas explicitly reject 1:1 and 1:2 internal resonances. |
| Strong resonances 1:1, 1:2, 1:3, and 1:4 | **Available detection and refinement** | Angle tests on NS curves are curve-corrected and retain resonance diagnostics. R1 and R2 provide typed LPC and PD switches; R3 and R4 report that period-three and period-four branch predictors are unavailable. |
| Cusp | **Available for ODE fold curves** | Computes the quadratic fold coefficient, refines its zero, and retains the cubic cusp coefficient for the nondegeneracy check. |
| Bogdanov-Takens | **Available for ODE fold curves** | Refines the double-zero point, retains the nilpotent-chain coefficients and residuals, and switches to nearby fold, Hopf, and homoclinic branches. |
| Generalized Hopf (Bautin) | **Available for ODE Hopf curves** | Computes and refines the first Lyapunov coefficient, validates the second Lyapunov coefficient, and switches to the emanating limit-point-of-cycles curve. |
| Cycle interaction points | **Available detection and refinement** | CPC, fold-flip, fold-NS, generalized PD, flip-NS, Chenciner, double-NS, and the four strong resonances use curve-corrected tests with named coefficients, residuals, conditioning, certification, and simultaneous-event preservation. Intersections expose typed alternate-curve switches; higher-order switches whose required normalized coefficient or target curve is unavailable say so explicitly. |
| Full codimension-two continuation | **Not implemented** | Fork refines points and can switch from selected nondegenerate points, but it does not continue codimension-two loci themselves. |

## Rendering
Fork uses [Plotly](https://plotly.com/javascript/) to render trajectories, bifurcation diagrams, and other visualizations.

# Building
Fork ships as a Rust/WASM core, a Node.js CLI, and a web UI. The CLI and web app each have their own dependency setup.

Build the Rust core with:
```bash
cargo build
```

Build the WASM bindings for the CLI with:
```bash
cd crates/fork_wasm
wasm-pack build --target nodejs
```

Run the CLI with:
```bash
cd cli
npm install
npm start
```

Build the WASM bindings for the web UI with:
```bash
cd crates/fork_wasm
wasm-pack build --target web --out-dir pkg-web
```

Run the web UI locally with:
```bash
cd web
npm install
npm run dev
```

Create a production build of the web UI with:
```bash
cd web
npm run build
```

Run local landing gates with:
```bash
cd cli
npm run build
npm test

cd ../web
npm run lint
npm run build
npm test
```

Deploy builds (including Vercel) need the Rust toolchain and `wasm-pack` to generate `pkg-web`. See `web/vercel.json` for the hosted build configuration.
