# AGENT_SYNOPSIS.md

## 1. Project Overview
This project is an **industrial-scale Numerical Dynamical Systems Application**, designed to be a comprehensive tool for analyzing both **continuous flows (ODEs)** and **discrete maps**.

The goal is to build a high-performance, rigorous mathematical engine in **Rust** (compiled to **WebAssembly**) that powers a modern, interactive web interface. The development strategy follows a "Core-First" approach: building and verifying the math engine as a headless CLI/library before constructing the React/Three.js visualization layer.

## 2. Architecture
The project is a **Monorepo** containing both the Rust core and the React frontend.

### Directory Structure
```
/ (root)
  Cargo.toml            # Workspace definition
  /crates
    /fork_core          # The Pure Rust Math Library (Parsing, Integration, Analysis)
    /fork_cli           # Command Line Interface (Binary, consumes fork_core)
    /fork_wasm          # WASM Bindings (Library, exposes fork_core to JS)
  /web                  # React Application (Vite, TypeScript, consumes fork_wasm)
```

-   **Core (Rust)**: Handles all parsing, evaluation, integration, and numerical analysis.
-   **Frontend (React)**: Handles visualization and user interaction.
    -   **3D**: `react-three-fiber` (R3F) for orbits and manifolds.
    -   **2D**: `react-plotly.js` for bifurcation diagrams and charts.
    -   **Bitmaps**: HTML5 Canvas for dense heatmaps (Lyapunov fractals).

## 3. Key Features & Modules
-   **Universal System Support**: Flows ($\dot{x} = f(x)$) and Maps ($x_{n+1} = f(x_n)$).
-   **Equation Engine**: Runtime parsing/evaluation.
-   **Simulation**: RK4/RK45 for flows, iteration for maps.
-   **State Space**: Real-time 3D visualization.
-   **Continuation**: PALC for tracing equilibria and detecting bifurcations.
-   **Analysis**: Lyapunov Spectrum, PSD, Jacobian analysis.

## 4. Data Structures
-   **`DynamicalSystem`**: Encompasses equations, parameters, and system type.
-   **`Equation`**: `{ variable: string, expression: string }`
-   **`Parameter`**: `{ name: string, value: number }`

## 5. Algorithms to Port (Rust/WASM)
-   **Expression Parsing**: `meval` or `evalexpr` (or custom).
-   **Integration**: RK4 (Flow), Iteration (Map).
-   **Continuation**: PALC with Newton-Raphson.
-   **Differentiation**: Automatic Differentiation (AutoDiff) or Symbolic.
-   **Linear Algebra**: Eigenvalues, QR, SVD.

## 6. Development Roadmap: "Core-First"

### Phase 1: Rust Core & CLI (Headless)
1.  **Workspace Setup**: (Completed) `fork_core`, `fork_cli`, `fork_wasm` initialized.
2.  **Math Engine (`fork_core`)**:
    -   Implement `Equation` parser/evaluator.
    -   Implement `Integrator` traits (Flow vs Map).
    -   Implement `RK4` solver.
3.  **CLI Tool (`fork_cli`)**:
    -   Build a CLI to define a system and run a simulation.
    -   Output results to CSV/stdout for verification.
    -   **Goal**: Verify Lorenz attractor generation matches benchmark data.

### Phase 2: Analysis Modules (Rust)
4.  **Lyapunov Spectrum**: Implement QR-based algorithm.
5.  **Jacobian**: Implement AutoDiff support.
6.  **Verification**: Add CLI commands to compute exponents for known systems.

### Phase 3: The WASM Bridge
7.  **Bindings (`fork_wasm`)**: Expose `DynamicalSystem` and `Integrator` to JS.
8.  **Memory Management**: efficient transfer of `Float64Array` buffers.

### Phase 4: Frontend Foundation
9.  **React Setup**: (Completed) Vite project initialized in `/web`.
10. **Rendering**: Install `react-three-fiber`, `drei`.
11. **Integration**: Connect WASM output to R3F mesh updates.

### Phase 5: Advanced UI & Polish
12. **System Editor**: UI for defining equations.
13. **Analysis Dashboard**: Plotly charts for bifurcation diagrams.
14. **Optimization**: Web Workers, SharedArrayBuffer.
