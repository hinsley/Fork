import type { PeriodicVariableConfig, SystemConfig } from './types'

export const DEFAULT_VARIABLE_PERIOD = Math.PI * 2

export function normalizePeriodicVariables(
  config: Pick<SystemConfig, 'varNames' | 'periodicVariables'>
): PeriodicVariableConfig[] {
  return config.varNames.map((_, index) => {
    const entry = config.periodicVariables?.[index]
    const period =
      entry && Number.isFinite(entry.period) && entry.period > 0
        ? entry.period
        : DEFAULT_VARIABLE_PERIOD
    return {
      enabled: Boolean(entry?.enabled),
      period,
    }
  })
}

export function periodicPeriodsForConfig(config: SystemConfig): number[] {
  return normalizePeriodicVariables(config).map((entry) =>
    entry.enabled && Number.isFinite(entry.period) && entry.period > 0
      ? entry.period
      : Number.NaN
  )
}

export function parsePeriodExpression(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const normalized = trimmed
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
  const piMatch = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?(?:e[+-]?\d+)?)\*?pi$/)
  if (piMatch) {
    const coefficientText = piMatch[1]
    const coefficient =
      !coefficientText || coefficientText === '+'
        ? 1
        : coefficientText === '-'
          ? -1
          : Number(coefficientText)
    const parsed = coefficient * Math.PI
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function shouldBreakPeriodicSegment(
  previous: Array<number | null>,
  current: Array<number | null>,
  coordinatePeriods: Array<number | null>
): boolean {
  for (let index = 0; index < coordinatePeriods.length; index += 1) {
    const period = coordinatePeriods[index]
    if (!period || !Number.isFinite(period) || period <= 0) continue
    const prev = previous[index]
    const next = current[index]
    if (!isFiniteNumber(prev) || !isFiniteNumber(next)) continue
    if (Math.abs(next - prev) > period * 0.5) {
      return true
    }
  }
  return false
}

export function insertPeriodicLineBreaks<TCustom = unknown>(input: {
  x: Array<number | null>
  y: Array<number | null>
  z?: Array<number | null>
  customdata?: TCustom[]
  text?: string[]
  coordinatePeriods: Array<number | null>
}): {
  x: Array<number | null>
  y: Array<number | null>
  z?: Array<number | null>
  customdata?: Array<TCustom | null>
  text?: string[]
  splitCount: number
} {
  const hasZ = Array.isArray(input.z)
  const length = Math.min(
    input.x.length,
    input.y.length,
    hasZ ? input.z?.length ?? 0 : Number.POSITIVE_INFINITY
  )
  const x: Array<number | null> = []
  const y: Array<number | null> = []
  const z: Array<number | null> | undefined = hasZ ? [] : undefined
  const customdata = input.customdata ? ([] as Array<TCustom | null>) : undefined
  const text = input.text ? ([] as string[]) : undefined
  let previous: Array<number | null> | null = null
  let splitCount = 0

  for (let index = 0; index < length; index += 1) {
    const current = hasZ
      ? [input.x[index] ?? null, input.y[index] ?? null, input.z?.[index] ?? null]
      : [input.x[index] ?? null, input.y[index] ?? null]
    if (
      previous &&
      shouldBreakPeriodicSegment(previous, current, input.coordinatePeriods) &&
      x.length > 0
    ) {
      x.push(null)
      y.push(null)
      z?.push(null)
      customdata?.push(null)
      text?.push('')
      splitCount += 1
    }

    x.push(current[0] ?? null)
    y.push(current[1] ?? null)
    z?.push(current[2] ?? null)
    customdata?.push(input.customdata?.[index] ?? null)
    text?.push(input.text?.[index] ?? '')
    previous = current
  }

  return { x, y, z, customdata, text, splitCount }
}
