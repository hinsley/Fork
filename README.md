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
| Period-doubling (flip) | **Detection and branch switching available** | Detect and refine a multiplier crossing <code>-1</code>; construct a seed for the doubled cycle. Two-parameter flip curves are not implemented. |
| Neimark-Sacker | **Detection available** | Detect and refine a complex multiplier pair crossing the unit circle. Two-parameter Neimark-Sacker curves are not implemented for maps. |
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
| Limit-cycle branch | **Available** | Orthogonal collocation, initialization from a Hopf point or sampled orbit, branch extension, Floquet multipliers, and Floquet modes. |
| Limit point of cycles (LPC) | **Experimental** | A two-parameter LPC defining system and runner exist. Automatic LPC detection on ordinary limit-cycle branches is currently disabled, and LPC codimension-two tests remain placeholders. |
| Period-doubling of cycles | **Detection and branch switching available; curve experimental** | Detect a multiplier crossing <code>-1</code> and initialize the doubled-period branch. The two-parameter PD-curve path still contains temporary diagnostics and disabled adaptation logic. |
| Neimark-Sacker / torus bifurcation | **Detection available; curve experimental** | Detect a complex Floquet pair crossing the unit circle. The two-parameter NS-curve path uses a simplified singularity formulation and is not yet benchmarked as a production solver. |
| Isoperiodic curves | **Available** | Continue a limit-cycle family in two parameters while holding its period fixed. This is a continuation constraint, not a bifurcation type. |

### Global connections

| Connection | Status | Current capability |
| --- | --- | --- |
| Homoclinic to a saddle equilibrium | **Experimental** | Open-orbit collocation with equilibrium, endpoint-distance, invariant-subspace, and Riccati constraints. Initialization is available from a large cycle or a homotopy-saddle workflow. |
| Homoclinic to a saddle-focus | **Experimental and not benchmarked** | The generic saddle-equilibrium formulation can construct real invariant-subspace bases from complex eigenvectors, but dedicated saddle-focus benchmark coverage is still missing. |
| Homoclinic to a periodic orbit | **Not implemented** | No periodic-orbit endpoint and invariant-bundle defining system is present. |

### Codimension-two points

Codimension-two support currently means sign-change tests evaluated while extending a codimension-one curve. These labels are not yet produced by a dedicated root-refinement pass, and no codimension-two set is itself continued.

| Point type | Status | Current capability |
| --- | --- | --- |
| Bogdanov-Takens, zero-Hopf, and double-Hopf | **Experimental detection** | Test functions exist on equilibrium fold and Hopf curves, but coverage and numerical validation remain limited. |
| Strong resonances 1:1, 1:2, 1:3, and 1:4 | **Experimental detection** | Algebraic tests exist on the experimental Neimark-Sacker curve path. |
| Cusp and generalized Hopf (Bautin) | **Not implemented** | Public types exist, but the relevant normal-form test functions are placeholders. |
| Chenciner and cycle interaction points | **Not implemented** | Chenciner, fold-flip, fold-NS, flip-NS, double-NS, generalized PD, and cusp-of-cycles tests are incomplete or placeholders. |
| Full codimension-two continuation | **Not implemented** | Fork currently detects candidate points only; it does not continue codimension-two loci. |

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
