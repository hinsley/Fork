import { Equation } from '../../components/ODEEditor'
import rk4 from '../odesolvers/rk4'

// Leading Lyapunov exponent calculation.

const epsilon = 1e-6 // Perturbation for initial condition and scaling.

// Parameters for evolution and convergence.
const dt = 1e-1 // Time step.
const evolveSteps = 1e2 // Steps between rescaling.
const maxSteps = 3e4 // Maximum total steps.

/**
 * Gets two initial conditions near the origin for Lyapunov exponent calculation.
 * Uses a small random perturbation from origin to avoid starting exactly at a fixed point.
 * @returns Two initial conditions.
 */
function getInitialConditions(equations: Equation[]): [number[], number[]] {
  return [
    equations.map(() => (Math.random() - 0.5) * epsilon),
    equations.map(() => (Math.random() - 0.5) * epsilon)
  ]
}

/**
 * Rescale neighboring trajectory after some evolution has taken place.
 * @returns Distance and rescaled neighboring trajectory location in state space.
 */
function rescaleNeighbor(trajectory: number[], neighbor: number[]): [number, number[]] {
  // Get vector from trajectory to neighbor.
  const displacement = neighbor.map((n, i) => n - trajectory[i])
  
  // Calculate current distance between points.
  const distance = Math.sqrt(displacement.reduce((sum, component) => sum + component * component, 0))

  // Rescale displacement vector to have length epsilon.
  const scaledDisplacement = displacement.map(d => d * epsilon / distance)

  // Return new neighbor position by adding scaled displacement to trajectory.
  return [
    distance,
    trajectory.map((t, i) => t + scaledDisplacement[i])
  ]
}

/**
 * Calculates the leading Lyapunov exponent (LLE) for a system of ODEs.
 * 
 * The LLE measures the average exponential rate of divergence or convergence of 
 * nearby trajectories in the system's state space. A positive LLE indicates chaos.
 * 
 * Method:
 * 1. Start with two nearby initial conditions.
 * 2. Evolve both trajectories forward in time.
 * 3. Periodically rescale the distance between trajectories.
 * 4. Track the growth rates between rescalings.
 * 5. Average the log of growth rates to get LLE.
 * 
 * @param equations - System of ODEs to analyze.
 * @returns Leading Lyapunov exponent value.
 */
export default function LLE(equations: Equation[]): number {
  // Get initial conditions.
  let [trajectory, neighbor] = getInitialConditions(equations)
  
  // Track sum of log growth rates.
  let sumLogGrowth = 0
  let numSteps = 0
  

  // Evolve system and track divergence.
  while (numSteps < maxSteps) {
    // Evolve both trajectories for several steps.
    for (let i = 0; i < evolveSteps; i++) {
      trajectory = rk4(equations, trajectory, dt)
      neighbor = rk4(equations, neighbor, dt)
    }
    
    // Rescale the neighbor trajectory and get distance.
    const [distance, rescaledNeighbor] = rescaleNeighbor(trajectory, neighbor)
    
    // Add log of growth rate to sum.
    sumLogGrowth += Math.log(distance / epsilon)
    
    // Update neighbor to rescaled position.
    neighbor = rescaledNeighbor
    
    numSteps += evolveSteps
  }
  
  // Calculate average exponential growth rate.
  return sumLogGrowth / (numSteps * dt)
}
