import { describe, expect, it } from 'vitest'
import { createDefaultSystems } from './defaultSystems'

describe('default systems', () => {
  it('uses native hyperbolic operations for Morris-Lecar', () => {
    const morrisLecar = createDefaultSystems().find(
      (system) => system.config.name === 'MorrisLecar'
    )

    expect(morrisLecar).toBeDefined()
    expect(morrisLecar?.config.equations[0]).toContain('tanh((V - V1) / V2)')
    expect(morrisLecar?.config.equations[1]).toBe(
      '(0.5 * (1 + tanh((V - V3) / V4)) - w) * cosh((V - V3) / (2 * V4))'
    )
    expect(morrisLecar?.config.equations.join(' ')).not.toContain('exp(')
  })
})
