import { Matrix, derivative, matrix } from 'mathjs'

import { Equation } from '../../components/ODEEditor'

/**
 * Creates a function that computes the Jacobian matrix of the system of equations at a given point.
 * @param equations - The system of equations.
 * @returns A function that takes a point in the state space as an array of numbers and returns the
 * Jacobian matrix at that point.
 */
export default function jacobian(equations: Equation[]): (point: number[]) => Matrix {
  // Each row corresponds to an equation.
  // Each column (more specifically, entry within a row) corresponds to a differentiation variable.
  return (point: number[]) => {
    const scope: { [key: string]: number } = {}
    equations.forEach((eq, i) => {
      scope[eq.variable] = point[i]
    })

    return matrix(equations.map(equation => 
      equations.map(varEquation =>
        derivative(equation.expression, varEquation.variable).evaluate(scope)
      )
    ))
  }
}
