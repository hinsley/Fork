import { Matrix, qr, zeros } from 'mathjs'

import { Equation, Parameter } from '../../components/ODEEditor'
import rk4 from '../odesolvers/euler'
import jacobian from '../differentiation/jacobian'

// Lyapunov spectrum calculation. See section 3.2.2 of the book by George Datseris.

const radius = 1e0 // Perturbation for initial condition.

/**
 * Gets an initial condition near the origin for Lyapunov exponent calculation.
 * Uses a small random perturbation from origin to avoid starting exactly at a fixed point.
 * @returns Initial condition.
 */
function getInitialCondition(equations: Equation[]): number[] {
  return equations.map(() => (Math.random() - 0.5) * radius * 2)
}

/**
 * Produces a random orthogonal matrix.
 * @param size - The size of the matrix.
 * @returns Orthogonal matrix.
 */
function getRandomOrthogonalMatrix(size: number): Matrix {
  // Form a random matrix.
  const mat = zeros(size, size)
  // Fill matrix with random values between -1 and 1
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      mat.set([i, j], Math.random() * 2 - 1)
    }
  }

  // Perform QR factorization.
  const result = qr(mat)
  const Q = result["Q"]

  return Q
}

export default function lyapunovSpectrum(equations: Equation[],
                                         parameters: Parameter[],
                                         dt: number = 1e-2, // Time step.
                                         rescaleSteps: number = 3e1, // Steps between rescaling.
                                         maxSteps: number = 3e2, // Maximum total steps.
                                         Ttr: number = 0 // Transient steps to discard.
                                        ): number[] {
  var point = getInitialCondition(equations)

  if (Ttr > 0) {
    // Evolve initial condition for Ttr steps to allow for transient decay.
    for (let i = 0; i < Ttr; i++) {
      point = rk4(equations, parameters, point, dt) as number[]
    }
  }

  const jacobian_function = jacobian(equations, parameters)
  var deviations = getRandomOrthogonalMatrix(equations.length)
  var lyapunovExponents: number[] = equations.map(() => 0)
  var stepsSinceLastRescale = 0

  for (let i = 0; i < Ttr + maxSteps; i++) {
    const result = rk4(equations, parameters, point, dt, deviations, jacobian_function)
    point = result[0] as number[]
    deviations = result[1] as Matrix

    stepsSinceLastRescale++
    if (stepsSinceLastRescale == rescaleSteps || i == Ttr) { // Rescale period.
      stepsSinceLastRescale = 0

      // Rescale deviations.
      const result = qr(deviations)
      const Q = result["Q"]
      const R = result["R"]
      deviations = Q
      
      // Calculate and accumulate Lyapunov exponents
      if (Ttr < i) {
        for (var j = 0; j < equations.length; j++) {
          lyapunovExponents[j] += Math.log(Math.abs(R.get([j, j])))
        }
      }
    }
  }

  // Normalize by evolution time.
  lyapunovExponents = lyapunovExponents.map(lyapunovExponent => lyapunovExponent / maxSteps / dt)

  return lyapunovExponents
}
