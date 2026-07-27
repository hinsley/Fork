import type { EquilibriumObject } from './types'

export const DEFAULT_DEFLATION_EXPONENT = 2
export const DEFAULT_DEFLATION_SHIFT = 1

export function equilibriumMapIterations(object: EquilibriumObject): number {
  const value =
    object.solutionProvenance?.mapIterations ??
    object.lastSolverParams?.mapIterations ??
    object.solution?.cycle_points?.length ??
    1
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1
}

export function mapCycleDeflationStates(object: EquilibriumObject): number[][] {
  if (!object.solution) return []
  const cyclePoints = object.solution.cycle_points
  return cyclePoints && cyclePoints.length > 0
    ? cyclePoints
    : [object.solution.state]
}
