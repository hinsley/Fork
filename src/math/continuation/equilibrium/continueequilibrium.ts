import {
  Matrix,
  add,
  derivative,
  eigs,
  matrix,
  multiply,
  norm,
  pinv,
  subtract
} from "mathjs"

import { Equation, Parameter } from "../../../components/ODEEditor"

// Compute Jacobian in augmented continuation space.
// TODO: Add compilation of derivative expressions into callback.
function augmentedJacobian(
  equations: Equation[],
  parameters: Parameter[],
  continuationParameter: Parameter
): (point: number[]) => Matrix {
  // Each row corresponds to an equation.
  // The first column corresponds to the continuation parameter.
  // Each subsequent column corresponds to a state variable.
  return (point: number[]) => {
    const scope: { [key: string]: number } = {}
    equations.forEach((eq, i) => {
      scope[eq.variable] = point[i]
    })
    parameters.forEach((param, _) => {
      scope[param.name] = param.value
    })

    return matrix(equations.map(equation =>
      [
        derivative(equation.expression, continuationParameter.name).evaluate(scope),
        ...equations.map(varEquation => derivative(equation.expression, varEquation.variable).evaluate(scope))
      ]
    ))
  }
}

// Evaluate the governing equations at a point in the
// augmented continuation space. `point` should have
// first entry the continuation parameter value and
// the rest of its entries the state variable values.
function vectorField(
  equations: Equation[],
  parameters: Parameter[],
  continuationParameter: Parameter,
  point: number[]
): number[] {
  const scope: { [key: string]: number } = {}
  equations.forEach((eq, i) => {
    scope[eq.variable] = point[i+1]
  })
  parameters.forEach((param, _) => {
    if (param.name === continuationParameter.name) {
      scope[param.name] = point[0]
    } else {
      scope[param.name] = param.value
    }
  })
  return equations.map(equation => equation.compiled?.evaluate(scope))
}

// Takes a point in state space and the value of the continuation
// parameter and returns the point in the augmented space.
function augmentedPoint(
  point: number[],
  continuationParameterValue: number
): Matrix {
  return matrix([continuationParameterValue, ...point])
}

/**
 * Calculate the continued equilibrium curve in extended state space.
 * @param equations 
 * @param parameters 
 * @param continuationParameter 
 * @param initialPoint 
 * @param forward 
 * @param initialStepSize 
 * @param minimumStepSize 
 * @param maximumStepSize 
 * @param stepSizeDecrement 
 * @param stepSizeIncrement 
 * @param correctorStepsStepSizeIncrementThreshold 
 * @param maxNumPoints 
 * @param correctorMaxSteps 
 * @param eps0 
 * @param eps1 
 * @returns A list of points in continuation space.
 */
export default function continueEquilibrium(
  equations: Equation[],
  parameters: Parameter[],
  continuationParameter: Parameter,
  initialPoint: number[], // Initial point in state space only.
  forward: boolean, // true for forward, false for backward.
  initialStepSize: number,
  minimumStepSize: number,
  maximumStepSize: number,
  stepSizeDecrement: number,
  stepSizeIncrement: number,
  correctorStepsStepSizeIncrementThreshold: number,
  predictorMaxPoints: number,
  correctorMaxSteps: number,
  eps0: number, // Tolerance for residual.
  eps1: number // Tolerance for search step.
): number[][] {
  const points: number[][] = []
  // Calculate the augmented Jacobian function.
  const jac = augmentedJacobian(equations, parameters, continuationParameter)
  // Determine initial point in product space of
  // continuation parameter and state variables.
  let x = augmentedPoint(
    initialPoint,
    continuationParameter.value
  )
  points.push(x.valueOf() as number[])
  // Set initial direction (only varying the continuation parameter).
  let v = matrix([1, ...new Array(initialPoint.length).fill(0)])
  // Normalize direction.
  v = multiply(v, 1 / (norm(v) as number))
  // Choose forward or backward based on increasing or decreasing continuation parameter.
  v = multiply(v, v.get([0]) / v.get([0]) * (forward ? 1 : -1))
  // Set step size.
  let stepSize = initialStepSize
  v = multiply(v, stepSize)

  // Predictor loop.
  for (let point = 0; point < predictorMaxPoints; point++) {
    let X = add(x, v) // X0
    let V = v // V0

    // Corrector loop.
    let converged = false
    while (!converged) {
      if (stepSize < minimumStepSize) {
        // Not converging despite using minimum step size.
        alert("Failed to converge: Reached minimum step size.")
        return points
      }
      let step = 0
      for (; step < correctorMaxSteps; step++) {
        const J = jac(X.valueOf() as number[])
        const B = matrix([V.valueOf() as number[], ...J.valueOf() as number[][]])
        const Binv = pinv(B)
        const R = matrix([0, ...multiply(J, V).valueOf() as number[]])
        const F = vectorField(
          equations,
          parameters,
          continuationParameter,
          X.valueOf() as number[]
        )
        const Q = matrix([0, ...F])
        const W = subtract(V, multiply(Binv, R))
        V = multiply(W, 1 / (norm(W) as number))
        const oldX = X
        X = subtract(X, multiply(Binv, Q))

        if (
          (norm(F) as number) < eps0
          && (norm(subtract(X, oldX)) as number) < eps1
        ) {
          converged = true
          break
        }
      }

      if (!converged) {
        // Did not converge; need to decrease step size.
        stepSize *= stepSizeDecrement
        // Reset X and V to X0 and V0.
        X = add(x, v)
        V = v
      } else if (step < correctorStepsStepSizeIncrementThreshold) {
        // Converged too quickly; can increase step size.
        Math.min(stepSize *= stepSizeIncrement, maximumStepSize)
      }
    }

    // Once converged, set new point and direction.
    x = X
    v = multiply(V, stepSize)
    points.push(x.valueOf() as number[])
  }

  return points
}