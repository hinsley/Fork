# Fork
Fork is a browser-based numerical bifurcation continuation software application, supporting the analysis of smooth finite-dimensional maps and systems of ordinary differential equations.
The goal is to support all popular mobile and desktop devices.

## Bifurcations by codimension
A checkmark denotes that support for the bifurcation type has been implemented.
I will have to study some more theory of numerical bifurcation analysis in maps before putting together a to-do list there.

### Maps
- Codimension 0
- Codimension 1
- Codimension 2

### ODE systems
- Codimension 0
    - [ ] Equilibrium
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
Fork uses [MathBox](https://github.com/unconed/mathbox) to render trajectories, bifurcation diagrams, and other visualizations.
