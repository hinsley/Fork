import { describe, expect, it } from 'vitest'
import {
  eigenmodeScalarValues,
  flattenEigenmodeWarmStart,
  maxSupportedEigenmodeCount,
} from './invariantMeasureEigenmodes'
import type { InvariantMeasureEigenmode } from './types'

const complexMode: InvariantMeasureEigenmode = {
  rank: 1,
  eigenvalueRe: 0.4,
  eigenvalueIm: 0.7,
  modulus: Math.hypot(0.4, 0.7),
  ritzResidual: 1e-12,
  converged: true,
  conjugatePair: true,
  interpretation: 'oscillatory_density_relaxation',
  vectorReal: [1, 0, -1],
  vectorImaginary: [0, 1, 0],
}

describe('invariant-measure eigenmode helpers', () => {
  it('caps requests by spectrum size and bounded solver memory', () => {
    expect(maxSupportedEigenmodeCount(1)).toBe(0)
    expect(maxSupportedEigenmodeCount(2)).toBe(1)
    expect(maxSupportedEigenmodeCount(8)).toBe(7)
    expect(maxSupportedEigenmodeCount(100)).toBe(45)
    expect(maxSupportedEigenmodeCount(250_000)).toBeLessThan(6)
  })

  it('turns a complex pair into real, imaginary, and phase slices', () => {
    expect(
      eigenmodeScalarValues(complexMode, {
        modeRank: 1,
        component: 'real',
        phase: 0,
      })
    ).toEqual([1, 0, -1])
    expect(
      eigenmodeScalarValues(complexMode, {
        modeRank: 1,
        component: 'imaginary',
        phase: 0,
      })
    ).toEqual([0, 1, 0])
    const phase = eigenmodeScalarValues(complexMode, {
      modeRank: 1,
      component: 'phase',
      phase: Math.PI / 2,
    })
    expect(phase[0]).toBeCloseTo(0, 12)
    expect(phase[1]).toBeCloseTo(1, 12)
    expect(phase[2]).toBeCloseTo(0, 12)
  })

  it('pads real modes with zero imaginary warm-start components', () => {
    const realMode: InvariantMeasureEigenmode = {
      ...complexMode,
      conjugatePair: false,
      eigenvalueIm: 0,
      vectorImaginary: [],
    }
    expect(flattenEigenmodeWarmStart([realMode], 3)).toEqual({
      real: [1, 0, -1],
      imaginary: [0, 0, 0],
    })
  })
})
