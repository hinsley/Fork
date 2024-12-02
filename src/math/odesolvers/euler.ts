import { Matrix, add, multiply } from 'mathjs'

import { Equation } from '../../components/ODEEditor'

// Euler's method.
export default function euler(equations: Equation[],
                              point: number[],
                              stepSize: number,
                              deviations: Matrix|null = null,
                              jacobian: Matrix|null = null): number[]|[number[], Matrix] {
  const scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i]
  })

  const derivative = equations.map(eq => eq.compiled?.evaluate(scope))

  const newPoint = point.map((x, i) => x + stepSize * derivative[i])

  if (deviations && jacobian) { // Tangent space integration.
    const newDeviations = add(deviations, multiply(multiply(jacobian, deviations), stepSize))

    return [
      newPoint,
      newDeviations
    ]
  }

  return newPoint
}