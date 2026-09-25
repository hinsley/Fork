import { describe, expect, it } from 'vitest'
import { formatSystemChip, fuzzyScore } from './shellFormat'

describe('formatSystemChip', () => {
  it('shows type, dimension, and solver for flows only', () => {
    expect(formatSystemChip({ name: 'L', type: 'flow', dimension: 3, solver: 'rk4' })).toBe(
      'Flow · 3D · rk4'
    )
    expect(formatSystemChip({ name: 'H', type: 'map', dimension: 2, solver: 'discrete' })).toBe(
      'Map · 2D'
    )
  })
})

describe('fuzzyScore', () => {
  it('rejects non-subsequences and ranks word-start matches higher', () => {
    expect(fuzzyScore('xyz', 'Limit Cycle')).toBe(-1)
    expect(fuzzyScore('lc', 'Limit Cycle')).toBeGreaterThan(fuzzyScore('lc', 'Local'))
    expect(fuzzyScore('orb', 'Orbit_1')).toBeGreaterThan(fuzzyScore('orb', 'New orbit'))
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})
