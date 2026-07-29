import { describe, expect, it } from 'vitest'
import {
  colorWithOpacity,
  normalizeColorOpacity,
  opacityToPercent,
  percentToOpacity,
} from './color'

describe('color opacity helpers', () => {
  it('clamps alpha and percentage values to their supported ranges', () => {
    expect(normalizeColorOpacity(-0.25)).toBe(0)
    expect(normalizeColorOpacity(1.25)).toBe(1)
    expect(percentToOpacity(-20)).toBe(0)
    expect(percentToOpacity(125)).toBe(1)
    expect(opacityToPercent(0.375)).toBe(38)
  })

  it('adds alpha to six-digit hex colors and preserves opaque colors', () => {
    expect(colorWithOpacity('#112233', 0.4)).toBe('rgba(17, 34, 51, 0.4)')
    expect(colorWithOpacity('#112233', 1)).toBe('#112233')
  })
})
