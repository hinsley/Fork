import { compile } from "mathjs"

import { Equation, Parameter } from "../../components/ODEEditor"



export default function marchSquares(
  equations: Equation[],
  parameters: Parameter[],
  expression: string,
  isoclineValue: number,
  ranges: [number, number][],
  resolutions: number[]
): [number[], number][] {
  // Validate that there are at least two equations.
  if (equations.length < 2) {
    throw new Error("There must be at least two equations.")
  }

  // Validate ranges and resolutions length (should match number of equations).
  if (ranges.length !== equations.length) {
    throw new Error(`Number of ranges (${ranges.length}) must match number of equations (${equations.length})`)
  }
  if (resolutions.length !== equations.length) {
    throw new Error(`Number of resolutions (${resolutions.length}) must match number of equations (${equations.length})`)
  }

  const compiledExpression = compile(expression)

  const scope: { [key: string]: number } = {}
  parameters.forEach((param, _) => {
    scope[param.name] = param.value
  })

  const stepSizes = ranges.map((range, i) => (range[1] - range[0]) / Math.max(1, resolutions[i] - 1))
  const prevRow = Array(resolutions[0]).fill(NaN)
  let prevValue = NaN
  let prevRowPrevValue = NaN
  const squareTypes: [number[], number][] = []

  // Iterate over third dimension if it exists; otherwise just do one step.
  for (let k = 0; equations.length >= 3 ? k < resolutions[2] : k === 0; k++) {
    for (let j = 0; j < resolutions[1]; j++) {
      for (let i = 0; i < resolutions[0]; i++) {
        // Calculate the value of the expression at the current point.
        scope[equations[0].variable] = ranges[0][0] + stepSizes[0] * i
        scope[equations[1].variable] = ranges[1][0] + stepSizes[1] * j
        if (equations.length >= 3) {
          scope[equations[2].variable] = ranges[2][0] + stepSizes[2] * k
        }
        const value = compiledExpression.evaluate(scope)

        // Check if we're at least on the second row and the second entry of the current row.
        if (j > 0 && i > 0) {
          // Calculate the square type.
          const squareType = (prevRowPrevValue > isoclineValue ? 8 : 0)
            + (prevRow[i] > isoclineValue ? 4 : 0)
            + (value > isoclineValue ? 2 : 0)
            + (prevValue > isoclineValue ? 1 : 0)

          // Empty square types are associated with values 0 and 15.
          if (squareType !== 0 && squareType !== 15) {
            squareTypes.push([
              [
                ranges[0][0] + stepSizes[0] * i,
                ranges[1][0] + stepSizes[1] * j,
                equations.length >= 3 ? ranges[2][0] + stepSizes[2] * k : 0
              ],
              squareType
            ])
          }

          // TODO: Handle saddles.
        }
        
        // Cache for optimization.
        prevRowPrevValue = prevRow[i]
        prevRow[i] = value
        // Save previous value so it's not overwritten when we cache for the next row.
        prevValue = value
      }
    }
  }

  return squareTypes
}