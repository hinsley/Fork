import type {
  EquilibriumDeflationConfig,
  EquilibriumDeflationTargetConfig,
  EquilibriumObject,
} from './types'

export const DEFAULT_DEFLATION_EXPONENT = 2
export const DEFAULT_DEFLATION_SHIFT = 1

export function equilibriumDeflationTargets(
  config: EquilibriumDeflationConfig | undefined
): EquilibriumDeflationTargetConfig[] {
  if (!config) return []
  if (Array.isArray(config.targets)) {
    return config.targets.map((target) => ({ ...target }))
  }
  return (config.targetObjectIds ?? []).map((targetObjectId) => ({
    targetObjectId,
    exponent: config.exponent ?? DEFAULT_DEFLATION_EXPONENT,
    shift: config.shift ?? DEFAULT_DEFLATION_SHIFT,
  }))
}

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
