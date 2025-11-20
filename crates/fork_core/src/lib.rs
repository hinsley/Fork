pub mod autodiff;
pub mod equation_engine;
pub mod equilibrium;
pub mod solvers;
/// The `fork_core` crate provides the fundamental mathematical engine for the Fork CLI.
/// It is designed to be generic, supporting both standard floating-point arithmetic (`f64`)
/// and automatic differentiation via Dual numbers.
///
/// Key components:
/// - **Traits**: `Scalar` (numeric type abstraction), `DynamicalSystem` (ODEs/Maps), `Steppable` (Solvers).
/// - **Equation Engine**: A custom bytecode VM for evaluating user-defined equations efficiently.
/// - **Solvers**: Numerical integrators (RK4, Tsit5) and iterators (DiscreteMap).
/// - **Autodiff**: Dual number implementation and `TangentSystem` wrapper for Jacobian-based dynamics.
pub mod traits;
