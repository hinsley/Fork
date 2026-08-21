//! Fork Core: continuation and bifurcation analysis of dynamical systems.
//!
//! Fork compiles user-written vector fields to bytecode, evaluates them with
//! `f64` or forward-mode dual numbers, and drives pseudo-arclength
//! continuation over equilibria, periodic orbits, connection orbits, and
//! their bifurcation curves — in pure Rust with no platform LAPACK, so native
//! and browser builds share one algorithm set.
//!
//! # The seam that matters
//!
//! Everything above raw evaluation is organized around one trait,
//! [`ContinuationProblem`](continuation/problem/trait.ContinuationProblem.html):
//! a defining system supplies a residual, an extended Jacobian, PALC metric
//! weights, and diagnostics; the engine in [`continuation`] supplies step
//! control, correctors, event detection, and branch bookkeeping. Equilibria,
//! limit cycles, homoclinic and heteroclinic connections, and codim-1 curve
//! problems all plug into the same drivers.
//!
//! # A taste of the workflow
//!
//! ```
//! use fork_core::equation_engine::{parse, Compiler, EquationSystem};
//! use fork_core::equilibrium::{solve_equilibrium, NewtonSettings, SystemKind};
//!
//! let equations = ["y - x^3 + p", "x - y"];
//! let variables = ["x", "y"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
//! let parameters = ["p"].iter().map(|s| s.to_string()).collect::<Vec<_>>();
//! let compiler = Compiler::new(&variables, &parameters);
//! let bytecode = equations
//!     .iter()
//!     .map(|eq| compiler.compile(&parse(eq).unwrap()))
//!     .collect();
//! let mut system = EquationSystem::new(bytecode, vec![0.5]);
//! system.set_maps(compiler.param_map, compiler.var_map);
//!
//! // Equilibria of the flow solve f(x) = 0.
//! let root =
//!     solve_equilibrium(&system, SystemKind::Flow, &[0.5, 0.5], NewtonSettings::default())
//!         .unwrap();
//! assert_eq!(root.state.len(), 2);
//! ```
//!
//! For complete workflows see `examples/lpc_walkthrough.rs` and The Fork Book.
//!
//! # Numerical contracts
//!
//! Several invariants are load-bearing and non-negotiable: Floquet spectra are
//! extracted product-free from collocation transfers (never a monodromy
//! product), collocation meshes are semantically load-bearing across
//! serialization and adaptation, phase gauges freeze between continuation
//! steps, and there is no platform LAPACK. See `docs/DECISIONS.md` in the
//! repository before changing numerics.

pub mod analysis;
pub mod autodiff;
pub mod continuation;
pub mod equation_engine;
pub mod equilibrium;
pub mod event_series;
pub mod expansion_entropy;
pub mod forced_response;
pub mod isocline;
pub mod solvers;
pub mod state_periodicity;
pub mod traits;
pub mod transfer_eigenmodes;
pub mod transfer_operator;
