import { Equation } from '../../components/ODEEditor'

// Runge-Kutta 4th order method.
export default function rk4(equations: Equation[], point: number[], stepSize: number) {
  let scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i]
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

  return point.map((p, i) =>
    p + stepSize / 6 * (k1[i] + 2 * (k2[i] + k3[i]) + k4[i])
  )
}