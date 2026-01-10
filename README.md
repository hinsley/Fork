<p align="center">
  <img src="web/public/favicon.svg" alt="Fork logo" width="200" />
</p>

# Fork
Fork is a browser-based numerical bifurcation continuation software application, supporting the analysis of smooth finite-dimensional maps and systems of ordinary differential equations.
The goal is to support all popular mobile and desktop devices.

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
Build the Rust core with:
```bash
cargo build
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
