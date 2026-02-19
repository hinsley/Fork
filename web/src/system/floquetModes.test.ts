import { describe, expect, it } from 'vitest'
import {
  normalizeFloquetMultipliersForRendering,
  resolveTrivialFloquetModeIndex,
} from './floquetModes'

describe('floquetModes helpers', () => {
  it('marks the multiplier closest to +1 as the trivial mode', () => {
    const multipliers = [
      { re: 0.1, im: 0 },
      { re: 1.02, im: -0.03 },
      { re: -0.9, im: 0 },
    ]
    expect(resolveTrivialFloquetModeIndex(multipliers)).toBe(1)
  })

  it('forces the trivial mode to render as real (line)', () => {
    const multipliers = [
      { re: 0.1, im: 0 },
      { re: 1.0, im: 0.2 },
    ]
    const normalized = normalizeFloquetMultipliersForRendering(multipliers)
    expect(normalized[1]).toEqual({ re: 1.0, im: 0 })
  })

  it('snaps tiny-imaginary multipliers to real for rendering', () => {
    const multipliers = [
      { re: 0, im: 5e-4 },
      { re: 0.25, im: -2e-4 },
    ]
    const normalized = normalizeFloquetMultipliersForRendering(multipliers)
    expect(normalized[0]).toEqual({ re: 0, im: 0 })
    expect(normalized[1]).toEqual({ re: 0.25, im: 0 })
  })
})
