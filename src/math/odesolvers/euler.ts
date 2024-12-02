import { Matrix, add, multiply } from 'mathjs'

import { Equation, Parameter } from '../../components/ODEEditor'

// Euler's method.
export default function euler(equations: Equation[],
                              parameters: Parameter[],
                              point: number[],
                              stepSize: number,
                              deviations: Matrix|null = null,
                              jacobian_function: ((point: number[]) => Matrix)|null = null): number[]|[number[], Matrix] {
  const scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i]
  })
  parameters.forEach((param, _) => {
    scope[param.name] = param.value
  })

  const derivative = equations.map(eq => eq.compiled?.evaluate(scope))

  const newPoint = point.map((x, i) => x + stepSize * derivative[i])

  if (deviations && jacobian_function) { // Tangent space integration.
    const newDeviations = add(deviations, multiply(multiply(jacobian_function(point), deviations), stepSize))

    return [
      newPoint,
      newDeviations
    ]
  }

  return newPoint
}