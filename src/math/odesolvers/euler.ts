import { Equation } from '../../components/ODEEditor'

// Euler's method.
export default function euler(equations: Equation[], point: number[], stepSize: number) {
  const scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i]
  })

  const derivative = equations.map(eq => eq.compiled?.evaluate(scope))
  return point.map((x, i) => x + stepSize * derivative[i])
}