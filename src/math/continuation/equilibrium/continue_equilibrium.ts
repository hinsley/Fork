import {
  Matrix,
  add,
  derivative,
  lusolve,
  matrix,
  multiply,
  norm,
  pinv,
  subtract,
  transpose
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
      scope[eq.variable] = point[i+1]
    })
    parameters.forEach((param, _) => {
      scope[param.name] = param.value
    })
    scope[continuationParameter.name] = point[0]

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

function newtonCorrector(
  x: Matrix,
  v: Matrix,
  equations: Equation[],
  parameters: Parameter[],
  continuationParameter: Parameter,
  jac: (point: number[]) => Matrix,
  stepSize: number,
  minimumStepSize: number,
  maximumStepSize: number,
  stepSizeDecrement: number,
  stepSizeIncrement: number,
  correctorStepsStepSizeIncrementThreshold: number,
  correctorMaxSteps: number,
  eps0: number,
  eps1: number
): [Matrix, Matrix] | null {
  const R = matrix([1, ...new Array(equations.length).fill(0)])

  let X = add(x, multiply(v, stepSize)) // X0
  let V = v // V0

  let converged = false
  while (!converged) {
    if (stepSize < minimumStepSize) {
      // Not converging despite using minimum step size.
      return null
    }
    let step = 0
    for (; step < correctorMaxSteps; step++) {
      const J = jac(X.valueOf() as number[])
      const B = matrix([V.valueOf() as number[], ...J.valueOf() as number[][]])
      // const Binv = pinv(B)
      let F: number[] = []
      let dX: Matrix = matrix([])
      // From MATCONT's newtcorr.m:
      // "Repeat twice with same Jacobian.
      // Calculating the Jacobian is usually
      // a lot more expensive than solving a
      // system."
      // Note: This may not be true, since we
      // aren't numerically computing the
      // Jacobian at every step, but instead
      // using a symbolically predetermined
      // Jacobian.
      for (let i = 0; i < 2; i++) {
        F = vectorField(
          equations,
          parameters,
          continuationParameter,
          X.valueOf() as number[]
        )
        const Q = matrix([0, ...F])
        const W = matrix((transpose(lusolve(B, R)).valueOf() as number[][])[0])
        // const W = multiply(Binv, R)
        V = multiply(W, 1 / (norm(W) as number))
        // dX = matrix((transpose(lusolve(B, Q)).valueOf() as number[][])[0])
        dX = matrix((transpose(lusolve(B, Q)).valueOf() as number[][])[0]) // PALC.
        // dX = multiply(Binv, Q)
        X = subtract(X, dX)
      }

      if (
        (norm(F) as number) < eps0
        && (norm(dX) as number) < eps1
      ) {
        converged = true
      }
    }

    if (!converged) {
      // Did not converge; need to decrease step size.
      stepSize *= stepSizeDecrement
      // Reset X and V to X0 and V0.
      X = add(x, multiply(v, stepSize))
      V = v
    } else if (step < correctorStepsStepSizeIncrementThreshold) {
      // Converged too quickly; can increase step size.
      Math.min(stepSize *= stepSizeIncrement, maximumStepSize)
    }
  }

  return [X, V]
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
  // R is used for corrector steps.
  const R = matrix([1, ...new Array(equations.length).fill(0)])
  // Determine initial point in product space of
  // continuation parameter and state variables.
  let x = augmentedPoint(
    initialPoint,
    continuationParameter.value
  )
  points.push(x.valueOf() as number[])
  // Set initial direction (only varying the continuation parameter).
  let v = matrix([forward ? 1 : -1, ...new Array(initialPoint.length).fill(0)])
  let result = newtonCorrector(
    x,
    v,
    equations,
    parameters,
    continuationParameter,
    jac,
    initialStepSize,
    minimumStepSize,
    maximumStepSize,
    stepSizeDecrement,
    stepSizeIncrement,
    correctorStepsStepSizeIncrementThreshold,
    correctorMaxSteps,
    eps0,
    eps1
  )
  if (result === null) {
    alert(`Failed to converge: Reached minimum step size. Solved ${points.length} on branch.`)
    return points
  }
  [x, v] = result
  // Set step size.
  let stepSize = initialStepSize

  // Predictor loop.
  for (let point = 0; point < predictorMaxPoints; point++) {
    result = newtonCorrector(
      x,
      v,
      equations,
      parameters,
      continuationParameter,
      jac,
      stepSize,
      minimumStepSize,
      maximumStepSize,
      stepSizeDecrement,
      stepSizeIncrement,
      correctorStepsStepSizeIncrementThreshold,
      correctorMaxSteps,
      eps0,
      eps1
    )
    if (result === null) {
      return points
    }
    const [X, V] = result

    // Once converged, set new point and direction.
    x = X
    const J = jac(x.valueOf() as number[])
    const B = matrix([V.valueOf() as number[], ...J.valueOf() as number[][]])
    v = matrix((transpose(lusolve(B, R)).valueOf() as number[][])[0])
    // const Binv = pinv(B)
    // v = multiply(Binv, R)
    v = multiply(v, 1 / (norm(v) as number))
    points.push(x.valueOf() as number[])
  }

  return points
}