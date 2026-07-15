import { describe, expect, it } from 'vitest'
import type { SystemConfig } from './types'
import {
  autonomousContextError,
  normalizeFrozenEquationContext,
  usesEquationContext,
} from './expressionContext'

function system(overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    name: 'Context',
    equations: ['-x'],
    params: [],
    paramNames: [],
    varNames: ['x'],
    solver: 'rk4',
    type: 'flow',
    ...overrides,
  }
}

describe('expressionContext', () => {
  it('detects only the applicable unshadowed symbol', () => {
    expect(usesEquationContext(system({ equations: ['sin(t) - x'] }))).toBe(true)
    expect(usesEquationContext(system({ equations: ['n - x'] }))).toBe(false)
    expect(
      usesEquationContext(system({ equations: ['t - x'], paramNames: ['t'], params: [2] }))
    ).toBe(false)
    expect(
      usesEquationContext(
        system({ type: 'map', solver: 'discrete', equations: ['x + n'] })
      )
    ).toBe(true)
  })

  it('normalizes finite flow time and integer map index', () => {
    const flow = system({ equations: ['t - x'] })
    expect(normalizeFrozenEquationContext(flow, { symbol: 't', value: 0.5 })).toEqual({
      symbol: 't',
      value: 0.5,
    })

    const map = system({ type: 'map', solver: 'discrete', equations: ['x + n'] })
    expect(normalizeFrozenEquationContext(map, { symbol: 'n', value: -3 })).toEqual({
      symbol: 'n',
      value: -3,
    })
    expect(normalizeFrozenEquationContext(map, { symbol: 'n', value: 0.5 })).toBeUndefined()
  })

  it('reports the autonomous-analysis guard until context is frozen', () => {
    const flow = system({ equations: ['t - x'] })
    expect(autonomousContextError(flow)).toMatch(/depends on t/i)
    expect(autonomousContextError(flow, { symbol: 't', value: 2 })).toBeNull()
  })
})
