import { Matrix, add, multiply } from 'mathjs'

import { Equation, Parameter } from '../../components/ODEEditor'

// Runge-Kutta 4th order method.
export default function rk4(equations: Equation[],
                            parameters: Parameter[],
                            point: number[],
                            stepSize: number,
                            deviations: Matrix|null = null,
                            jacobian_function: ((point: number[]) => Matrix)|null = null
                           ): number[]|[number[], Matrix] {
  const scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i]
  })
  parameters.forEach((param, _) => {
    scope[param.name] = param.value
  })

  const k1 = equations.map(eq => eq.compiled?.evaluate(scope))

  const h2 = point.map((p, i) => p + 0.5 * stepSize * k1[i])
  equations.forEach((eq, i) => {
    scope[eq.variable] = h2[i]
  })
  const k2 = equations.map(eq => eq.compiled?.evaluate(scope))

  const h3 = point.map((p, i) => p + 0.5 * stepSize * k2[i])
  equations.forEach((eq, i) => {
    scope[eq.variable] = h3[i]
  })
  const k3 = equations.map(eq => eq.compiled?.evaluate(scope))

  const h4 = point.map((p, i) => p + stepSize * k3[i])
  equations.forEach((eq, i) => {
    scope[eq.variable] = h4[i]
  })
  const k4 = equations.map(eq => eq.compiled?.evaluate(scope))

  const newPoint = point.map((p, i) =>
    p + stepSize / 6 * (k1[i] + 2 * (k2[i] + k3[i]) + k4[i])
  )

  if (deviations && jacobian_function) { // Tangent space integration.
    const t1 = multiply(jacobian_function(point), deviations)
    const t2 = multiply(jacobian_function(h2), deviations)
    const t3 = multiply(jacobian_function(h3), deviations)
    const t4 = multiply(jacobian_function(h4), deviations)

    const newDeviations = add(
      deviations,
      multiply(
        add(
          t1,
          add(
            multiply(
              2,
              add(t2, t3)
            ),
            t4
          )
        ),
        stepSize / 6
      )
    )

    return [
      newPoint,
      newDeviations
    ]
  }

  return newPoint
}