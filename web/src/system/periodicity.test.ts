import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIABLE_PERIOD,
  insertPeriodicLineBreaks,
  normalizePeriodicVariables,
  parsePeriodExpression,
  periodicPeriodsForConfig,
} from './periodicity'
import type { SystemConfig } from './types'

function baseConfig(update: Partial<SystemConfig> = {}): SystemConfig {
  return {
    name: 'test',
    type: 'map',
    solver: 'discrete',
    varNames: ['theta', 'r'],
    equations: ['theta + 0.1', 'r'],
    paramNames: [],
    params: [],
    ...update,
  }
}

describe('periodicity helpers', () => {
  it('parses pi-based period expressions', () => {
    expect(parsePeriodExpression('2pi')).toBeCloseTo(Math.PI * 2)
    expect(parsePeriodExpression('2 * π')).toBeCloseTo(Math.PI * 2)
    expect(parsePeriodExpression('0.5pi')).toBeCloseTo(Math.PI * 0.5)
  })

  it('normalizes missing periods to disabled 2pi entries', () => {
    const normalized = normalizePeriodicVariables(baseConfig({ varNames: ['x', 'y', 'z'] }))

    expect(normalized).toEqual([
      { enabled: false, period: DEFAULT_VARIABLE_PERIOD },
      { enabled: false, period: DEFAULT_VARIABLE_PERIOD },
      { enabled: false, period: DEFAULT_VARIABLE_PERIOD },
    ])
  })

  it('emits NaN for disabled solver period slots', () => {
    const periods = periodicPeriodsForConfig(
      baseConfig({
        periodicVariables: [
          { enabled: true, period: 1 },
          { enabled: false, period: 3 },
        ],
      })
    )

    expect(periods[0]).toBe(1)
    expect(Number.isNaN(periods[1])).toBe(true)
  })

  it('inserts null separators at periodic wrap jumps', () => {
    const split = insertPeriodicLineBreaks({
      x: [0.9, 0.95, 0.02, 0.08],
      y: [0, 0, 0, 0],
      customdata: [0, 1, 2, 3],
      coordinatePeriods: [1, null],
    })

    expect(split.splitCount).toBe(1)
    expect(split.x).toEqual([0.9, 0.95, null, 0.02, 0.08])
    expect(split.y).toEqual([0, 0, null, 0, 0])
    expect(split.customdata).toEqual([0, 1, null, 2, 3])
  })
})
