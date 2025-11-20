use num_traits::{Float, FromPrimitive};
use std::fmt::Debug;

/// A trait for types that can be used as scalars in our dynamical systems.
/// Must support basic arithmetic, debug printing, and conversion from f64.
pub trait Scalar: Float + FromPrimitive + Debug + 'static {}

impl<T: Float + FromPrimitive + Debug + 'static> Scalar for T {}

/// Represents a dynamical system (Flow or Map).
pub trait DynamicalSystem<T: Scalar> {
    /// Returns the dimension of the state space.
    fn dimension(&self) -> usize;

    /// Evaluates the vector field (flow) or map function.
    /// x: current state
    /// t: current time
    /// out: buffer to write the result (dx/dt or x_{n+1})
    fn apply(&self, t: T, x: &[T], out: &mut [T]);
}

/// A trait for solvers that can step a system forward.
pub trait Steppable<T: Scalar> {
    /// Performs one step of size dt.
    /// t: current time (updated after step)
    /// state: current state (updated after step)
    /// dt: step size
    fn step(&mut self, system: &impl DynamicalSystem<T>, t: &mut T, state: &mut [T], dt: T);
}
