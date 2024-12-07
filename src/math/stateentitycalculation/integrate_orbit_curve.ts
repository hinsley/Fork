import { Equation, Parameter } from "../../ODEEditor"
import rk4 from "../odesolvers/rk4"

export default function integrateOrbitCurve(
  equations: Equation[],
  parameters: Parameter,
  initialConditions: number[],
  duration: number,
  dt: number
): number[][] {
  var point = initialConditions
  var points = []

  for (var i = 0; i * dt < duration; i++) {
    point = rk4(equations, parameters, point, dt) as number[]
    points.push(point)
  }

  return points
}