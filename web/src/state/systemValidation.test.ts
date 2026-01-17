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

  it('rejects names that are not CLI-safe', () => {
    const result = validateSystemConfig(buildConfig({ name: 'Not Safe' }))

    expect(result.valid).toBe(false)
    expect(result.errors.name).toBe(
      'System name must contain only letters, numbers, and underscores.'
    )
  })

  it('requires a non-empty system name', () => {
    const result = validateSystemConfig(buildConfig({ name: '   ' }))

    expect(result.valid).toBe(false)
    expect(result.errors.name).toBe('System name is required.')
  })

  it('flags invalid variable names', () => {
    const result = validateSystemConfig(buildConfig({ varNames: ['1bad', 'good'] }))

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('Invalid variable names: 1bad.')
  })

  it('requires at least one variable', () => {
    const result = validateSystemConfig(
      buildConfig({ varNames: [], equations: [] })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('At least one variable is required.')
    expect(result.errors.equations).toBeUndefined()
  })

  it('flags empty variable names when others are present', () => {
    const result = validateSystemConfig(
      buildConfig({ varNames: ['x', ' '], equations: ['x', 'y'] })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('Variable names cannot be empty.')
  })

  it('flags duplicate variable names', () => {
    const result = validateSystemConfig(buildConfig({ varNames: ['x', 'x'] }))

    expect(result.valid).toBe(false)
    expect(result.errors.varNames).toBe('Duplicate variable names: x.')
  })

  it('treats trimmed variable names as duplicates', () => {
    const result = validateSystemConfig(
      buildConfig({ varNames: [' x ', 'x'], equations: ['x', 'x'] })
    )

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

    const emptyNames = validateSystemConfig(
      buildConfig({ paramNames: ['a', ' '], params: [1, 2] })
    )
    expect(emptyNames.errors.paramNames).toBe('Parameter names cannot be empty.')

    const invalidNames = validateSystemConfig(
      buildConfig({ paramNames: ['a', '1b'], params: [1, 2] })
    )
    expect(invalidNames.errors.paramNames).toBe('Invalid parameter names: 1b.')

    const duplicates = validateSystemConfig(
      buildConfig({ paramNames: ['a', 'a'], params: [1, 2] })
    )
    expect(duplicates.errors.paramNames).toBe('Duplicate parameter names: a.')

    const nonNumeric = validateSystemConfig(
      buildConfig({ params: [0, Number.NaN], paramNames: ['a', 'b'] })
    )
    expect(nonNumeric.errors.params).toEqual(['', 'Parameter must be numeric.'])
  })

  it('requires parameter counts to match names when multiple params exist', () => {
    const result = validateSystemConfig(
      buildConfig({ params: [1], paramNames: ['a', 'b'] })
    )

    expect(result.valid).toBe(false)
    expect(result.errors.params).toEqual([
      'Parameter count mismatch.',
      'Parameter count mismatch.',
    ])
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

  it('allows compatible solver selections', () => {
    const mapResult = validateSystemConfig(
      buildConfig({ type: 'map', solver: 'discrete' })
    )
    expect(mapResult.errors.solver).toBeUndefined()

    const flowResult = validateSystemConfig(
      buildConfig({ type: 'flow', solver: 'tsit5' })
    )
    expect(flowResult.errors.solver).toBeUndefined()
  })
})
