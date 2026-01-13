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

## Bifurcations by codimension
A checkmark denotes that support for the bifurcation type has been implemented. Codim-2 support currently means detection on codim-1 curves (not full codim-2 continuation).

### Maps
- Codimension 0
    - [X] Equilibrium (Fixed Point)
    - [ ] Periodic Orbit
- Codimension 1
    - [X] Saddle-Node (Fold)
    - [ ] Period-Doubling (Flip)
    - [ ] Neimark-Sacker
- Codimension 2
    - [ ] Cusp
    - [ ] Bogdanov-Takens
    - [ ] Chenciner

### ODE systems
- Codimension 0
    - [X] Equilibrium
    - [X] Periodic Orbit
- Codimension 1
    - [X] Andronov-Hopf
    - [ ] Homoclinic to Saddle-Equilibrium
    - [ ] Homoclinic to Saddle-Focus
    - [ ] Homoclinic to Saddle-Periodic-Orbit
    - [X] Saddle-Node (Fold)
    - [X] Saddle-Node of Periodic Orbits (LPC: Limit Point of Cycles)
- Codimension 2
    - [ ] Bautin Point / Generalized Andronov-Hopf
    - [X] Bogdanov-Takens
    - [ ] Saddle-to-Saddle-Focus
    - [X] Zero-Hopf
    - [X] Double Hopf
    - [X] Resonance 1:1 (Neimark-Sacker)
    - [X] Resonance 1:2 (Neimark-Sacker)
    - [X] Resonance 1:3 (Neimark-Sacker)
    - [X] Resonance 1:4 (Neimark-Sacker)
    - [ ] Shilnikov-Hopf

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

Deploy builds (including Vercel) need the Rust toolchain and `wasm-pack` to generate `pkg-web`. See `web/vercel.json` for the hosted build configuration.
