import type { SystemConfig } from './types'

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

function formatFixedPointLabel(options?: LabelOptions): string {
  const singular = 'Fixed point'
  const plural = 'Fixed points'
  const label = options?.plural ? plural : singular
  return options?.lowercase ? label.toLowerCase() : label
}

export function formatEquilibriumLabel(
  systemType: SystemType,
  options?: LabelOptions
): string {
  const isMap = systemType === 'map'
  if (isMap) {
    const iterations =
      typeof options?.mapIterations === 'number' && Number.isFinite(options.mapIterations)
        ? Math.max(1, Math.trunc(options.mapIterations))
        : 1
    if (iterations === 1) {
      return formatFixedPointLabel(options)
    }
    return formatCycleLabel(iterations, options)
  }
  const singular = 'Equilibrium'
  const plural = 'Equilibria'
  const label = options?.plural ? plural : singular
  return options?.lowercase ? label.toLowerCase() : label
}
