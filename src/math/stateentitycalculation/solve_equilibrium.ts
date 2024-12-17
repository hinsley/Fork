import { matrix, multiply, norm, pinv, subtract } from "mathjs"

import { Equation, Parameter } from "../../components/ODEEditor"

import jacobian from "../differentiation/jacobian"

export default function solveEquilibrium(
  equations: Equation[],
  parameters: Parameter[],
  initialGuess: number[],
  maxSteps: number,
  dampingFactor: number
): number[] {
  const tolerance = 1e-6 // The tolerance for successive iterates of the solution.
  
  var oldPoint = matrix(initialGuess.map(_ => NaN))
  var point = matrix(initialGuess)
  const scope: { [key: string]: number } = {}

  for (var i = 0; i < maxSteps; i++) {
    if (norm(subtract(point, oldPoint)) < tolerance) {
      return point.valueOf()
    }
    oldPoint = point

    equations.forEach((equation: Equation, index: number) => {
      scope[equation.variable] = oldPoint.get([index])
    })
    parameters.forEach((param: Parameter, _: number) => {
      scope[param.name] = param.value
    })
    const moorePenroseInverse = pinv(jacobian(equations, parameters)(oldPoint.valueOf()))
    const flow = matrix(equations.map(equation => equation.compiled?.evaluate(scope)))
    point = subtract(oldPoint, multiply(dampingFactor, moorePenroseInverse, flow))
  }

  return equations.map(() => NaN)
}