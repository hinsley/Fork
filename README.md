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

## Repository layout
Fork is a 3-part monorepo: a Rust core, a Node.js CLI, and a web UI. The core is the numerical engine, while the CLI and web app provide different user interfaces on top of the same algorithms.

- `crates/fork_core`: Pure Rust numerical engine. It owns the continuation algorithms, equation parsing, integration, linear algebra/solvers, and stability computations. The core is UI-agnostic and is designed to be deterministic, testable, and reusable across frontends.
- `crates/fork_wasm`: WebAssembly bindings that wrap the core for JavaScript consumers. This is how the CLI and web UI call into the same continuation logic.
- `cli`: Interactive Node.js CLI built on the WASM bindings. It exposes the core algorithms in a text-based workflow.
- `web`: Vite + React web UI that consumes the WASM bindings and renders results in the browser.

## Supporters
Fork is developed in my spare time and incentivized both by my personal use of the software and by [Patreon support](https://www.patreon.com/ForkDynamics).
People who have supported Fork on Patreon are listed below.

### Current Supporters

- Christopher Hitzel
- Julien Brenneck

### Past Supporters

- Jacob Price

## Bifurcations by codimension
A checkmark denotes that support for the bifurcation type has been implemented.

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
    - [ ] Bogdanov-Takens
    - [ ] Saddle-to-Saddle-Focus
    - [ ] Zero-Hopf
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
