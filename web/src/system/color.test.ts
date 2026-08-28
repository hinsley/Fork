import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVARIANT_MEASURE_COLOR,
  colorWithOpacity,
  normalizeColorOpacity,
  opacityToPercent,
  percentToOpacity,
} from './color'
import { resolvePlotlyBackgroundColor } from '../viewports/plotly/plotlyTheme'

function hexChannel(value: string, offset: number): number {
  const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(value: string): number {
  return (
    0.2126 * hexChannel(value, 1) +
    0.7152 * hexChannel(value, 3) +
    0.0722 * hexChannel(value, 5)
  )
}

function contrastRatio(left: string, right: string): number {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right))
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right))
  return (brighter + 0.05) / (darker + 0.05)
}

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

  it('keeps the invariant-measure color visible on both Plotly themes', () => {
    expect(
      contrastRatio(DEFAULT_INVARIANT_MEASURE_COLOR, resolvePlotlyBackgroundColor('light'))
    ).toBeGreaterThanOrEqual(4)
    expect(
      contrastRatio(DEFAULT_INVARIANT_MEASURE_COLOR, resolvePlotlyBackgroundColor('dark'))
    ).toBeGreaterThanOrEqual(4)
  })
})
