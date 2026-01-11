import { describe, expect, it } from 'vitest'
import { validateSystemConfig } from './systemValidation'
import type { SystemConfig } from '../system/types'

const baseConfig: SystemConfig = {
  name: 'Valid_System',
  equations: ['x'],
  params: [1],
  paramNames: ['a'],
  varNames: ['x'],
  solver: 'rk4',
  type: 'flow',
}

const buildConfig = (overrides: Partial<SystemConfig> = {}): SystemConfig => ({
  ...baseConfig,
  ...overrides,
})

describe('validateSystemConfig', () => {
  it('accepts a valid configuration', () => {
    const result = validateSystemConfig(buildConfig())

    expect(result.valid).toBe(true)
    expect(Object.keys(result.errors)).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('warns when the name is not CLI-safe', () => {
    const result = validateSystemConfig(buildConfig({ name: 'Not Safe' }))

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain(
      'System name is not CLI-safe; use alphanumerics and underscores for parity.'
    )
  })

  it('flags invalid variable names', () => {
    const result = validateSystemConfig(buildConfig({ varNames: ['1bad', 'good'] }))

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('Invalid variable names: 1bad.')
  })

  it('flags duplicate variable names', () => {
    const result = validateSystemConfig(buildConfig({ varNames: ['x', 'x'] }))

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('Duplicate variable names: x.')
  })

  it('requires equations for each variable', () => {
    const result = validateSystemConfig(
      buildConfig({ varNames: ['x', 'y'], equations: ['x'] })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.equations?.[1]).toBe('Equation required.')
  })

  it('validates parameter name and value rules', () => {
    const mismatch = validateSystemConfig(buildConfig({ params: [], paramNames: ['a'] }))
    expect(mismatch.errors.params).toEqual(['Parameter count mismatch.'])

    const nonNumeric = validateSystemConfig(
      buildConfig({ params: [0, Number.NaN], paramNames: ['a', 'b'] })
    )
    expect(nonNumeric.errors.params).toEqual(['', 'Parameter must be numeric.'])
  })

  it('enforces solver compatibility with the system type', () => {
    const mapResult = validateSystemConfig(
      buildConfig({ type: 'map', solver: 'rk4' })
    )
    expect(mapResult.errors.solver).toBe('Map systems must use the discrete solver.')

    const flowResult = validateSystemConfig(
      buildConfig({ type: 'flow', solver: 'discrete' })
    )
    expect(flowResult.errors.solver).toBe('Flow systems must use rk4 or tsit5.')
  })
})
