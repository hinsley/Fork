import type { AnalysisObject, ContinuationObject, SystemConfig } from './types'

type SystemType = SystemConfig['type']

type LabelOptions = {
  plural?: boolean
  lowercase?: boolean
  mapIterations?: number
}

function formatCycleLabel(mapIterations: number | undefined, options?: LabelOptions): string {
  const iterations =
    typeof mapIterations === 'number' && Number.isFinite(mapIterations)
      ? Math.max(1, Math.trunc(mapIterations))
      : null
  const singular = iterations && iterations > 1 ? `${iterations}-cycle` : 'cycle'
  const plural = iterations && iterations > 1 ? `${iterations}-cycles` : 'cycles'
  const label = options?.plural ? plural : singular
  if (options?.lowercase) return label
  return /^[a-z]/.test(label) ? `${label[0].toUpperCase()}${label.slice(1)}` : label
}

export function formatEquilibriumLabel(
  systemType: SystemType,
  options?: LabelOptions
): string {
  const isMap = systemType === 'map'
  if (isMap) {
    return formatCycleLabel(options?.mapIterations, options)
  }
  const singular = 'Equilibrium'
  const plural = 'Equilibria'
  const label = options?.plural ? plural : singular
  return options?.lowercase ? label.toLowerCase() : label
}

export function formatObjectTypeLabel(
  systemType: SystemType,
  object: AnalysisObject
): string {
  if (object.type === 'equilibrium') {
    const mapIterations =
      object.lastSolverParams?.mapIterations ?? object.solution?.cycle_points?.length
    if (systemType === 'map') {
      const iterations =
        typeof mapIterations === 'number' && Number.isFinite(mapIterations)
          ? Math.max(1, Math.trunc(mapIterations))
          : null
      if (iterations === 1) return 'fixed point'
    }
    return formatEquilibriumLabel(systemType, {
      lowercase: true,
      mapIterations,
    })
  }
  if (object.type === 'limit_cycle') return 'limit cycle'
  if (object.type === 'orbit') return 'orbit'
  return object.type
}

export function formatBranchTypeLabel(
  systemType: SystemType,
  branch: ContinuationObject
): string {
  if (branch.branchType === 'equilibrium') {
    return formatEquilibriumLabel(systemType, {
      lowercase: true,
      mapIterations: branch.mapIterations,
    })
  }
  return branch.branchType.replace(/_/g, ' ')
}
