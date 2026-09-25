import { describe, expect, it } from 'vitest'
import type { SystemConfig } from '../../system/types'
import { systemConfigsEqual } from './systemConfigEquality'

const stored: SystemConfig = {
  name: 'Demo',
  equations: ['y', '-x + mu * x'],
  params: [0.2],
  paramNames: ['mu'],
  varNames: ['x', 'y'],
  solver: 'rk4',
  type: 'flow',
}

describe('systemConfigsEqual', () => {
  it('ignores key order and absent optional fields', () => {
    const draftOrder: SystemConfig = {
      name: 'Demo',
      type: 'flow',
      solver: 'rk4',
      varNames: ['x', 'y'],
      equations: ['y', '-x + mu * x'],
      paramNames: ['mu'],
      params: [0.2],
      periodicVariables: [
        { enabled: false, period: Math.PI * 2 },
        { enabled: false, period: Math.PI * 2 },
      ],
      periodicForcing: undefined,
    }
    expect(JSON.stringify(draftOrder)).not.toBe(JSON.stringify(stored))
    expect(systemConfigsEqual(draftOrder, stored)).toBe(true)
    expect(systemConfigsEqual(stored, draftOrder)).toBe(true)
  })

  it('detects real edits', () => {
    expect(systemConfigsEqual({ ...stored, params: [0.3] }, stored)).toBe(false)
    expect(systemConfigsEqual({ ...stored, name: 'Other' }, stored)).toBe(false)
    expect(systemConfigsEqual({ ...stored, solver: 'tsit5' }, stored)).toBe(false)
    expect(systemConfigsEqual({ ...stored, equations: ['y', '-x'] }, stored)).toBe(false)
    expect(
      systemConfigsEqual(
        { ...stored, periodicVariables: [{ enabled: true, period: 1 }, { enabled: false, period: 1 }] },
        stored
      )
    ).toBe(false)
    expect(
      systemConfigsEqual(
        { ...stored, periodicForcing: { symbol: 't', periodExpression: 'tau' } },
        stored
      )
    ).toBe(false)
  })

  it('treats an invalid enabled period as a change', () => {
    const periodic: SystemConfig = {
      ...stored,
      periodicVariables: [{ enabled: true, period: Math.PI * 2 }, { enabled: false, period: 1 }],
    }
    expect(
      systemConfigsEqual(
        { ...periodic, periodicVariables: [{ enabled: true, period: Number.NaN }, { enabled: false, period: 1 }] },
        periodic
      )
    ).toBe(false)
  })
})
