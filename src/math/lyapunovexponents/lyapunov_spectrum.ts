import { Equation } from '../../components/ODEEditor'
import rk4 from '../odesolvers/rk4'

// Lyapunov spectrum calculation. See section 3.2.2 of the book by George Datseris.

const epsilon = 1e-6 // Perturbation for initial condition and scaling.

// Parameters for evolution and convergence
const dt = 1e-1 // Time step
const evolveSteps = 1e2 // Steps between rescaling
const maxSteps = 3e4 // Maximum total steps

/**
 * Gets an initial condition near the origin for Lyapunov exponent calculation.
 * Uses a small random perturbation from origin to avoid starting exactly at a fixed point.
 * @returns Initial condition.
 */
function getInitialCondition(equations: Equation[]): number[] {
  return equations.map(() => (Math.random() - 0.5) * epsilon)
}
