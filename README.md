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
I will have to study some more theory of numerical bifurcation analysis in maps before putting together a to-do list there.

### Maps
- Codimension 0
- Codimension 1
- Codimension 2

### ODE systems
- Codimension 0
    - [X] Equilibrium
    - [ ] Periodic Orbit
- Codimension 1
    - [ ] Andronov-Hopf
    - [ ] Homoclinic to Saddle-Equilibrium
    - [ ] Homoclinic to Saddle-Focus
    - [ ] Homoclinic to Saddle-Periodic-Orbit
    - [ ] Saddle-Node
    - [ ] Saddle-Node of Periodic Orbits
- Codimension 2
    - [ ] Bautin Point / Generalized Andronov-Hopf
    - [ ] Bogdanov-Takens
    - [ ] Saddle-to-Saddle-Focus
    - [ ] Zero-Hopf
    - [ ] Shilnikov-Hopf

## Rendering
Fork uses [MathBox](https://github.com/unconed/mathbox) and [Plotly](https://plotly.com/javascript/) to render trajectories, bifurcation diagrams, and other visualizations.

# Building
Install `yarn` and run `yarn add vite` followed by `yarn vite`.
