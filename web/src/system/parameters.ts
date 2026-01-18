import type { SystemConfig } from './types'

const PARAM_EPSILON = 1e-12

export function isValidParameterSet(
  systemParams: number[],
  override?: number[] | null
): override is number[] {
  if (!Array.isArray(override)) return false
  if (override.length !== systemParams.length) return false
  return override.every((value) => Number.isFinite(value))
}

export function resolveObjectParams(
  system: SystemConfig,
  override?: number[] | null
): number[] {
  if (isValidParameterSet(system.params, override)) {
    return [...override]
  }
  return [...system.params]
}

export function hasCustomObjectParams(
  system: SystemConfig,
  override?: number[] | null
): boolean {
  if (!isValidParameterSet(system.params, override)) return false
  return override.some(
    (value, index) => Math.abs(value - system.params[index]) > PARAM_EPSILON
  )
}
