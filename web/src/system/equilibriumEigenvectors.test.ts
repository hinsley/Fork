import { describe, expect, it } from 'vitest'
import { resolveEquilibriumEigenvalueMarkerColors } from './equilibriumEigenvectors'
import type { EquilibriumEigenPair } from './types'

function pair(re: number, im: number): EquilibriumEigenPair {
  return {
    value: { re, im },
    vector: [],
  }
}

describe('resolveEquilibriumEigenvalueMarkerColors', () => {
  it('maps a complex conjugate pair to the same eigenspace color', () => {
    const eigenpairs = [pair(-1, 0), pair(0.2, 0.5), pair(0.2, -0.5)]

    const colors = resolveEquilibriumEigenvalueMarkerColors(
      eigenpairs,
      [0, 1],
      ['#112233', '#abcdef']
    )

    expect(colors).toEqual(['#112233', '#abcdef', '#abcdef'])
  })

  it('falls back when no eigenspace color is available', () => {
    const colors = resolveEquilibriumEigenvalueMarkerColors([pair(0.1, -0.3)], [], [])

    expect(colors).toEqual(['var(--accent)'])
  })

  it('uses index-matched colors for real eigenvalues', () => {
    const eigenpairs = [pair(-2, 0), pair(-0.1, 1e-7)]
    const colors = resolveEquilibriumEigenvalueMarkerColors(
      eigenpairs,
      [0, 1],
      ['#123456', '#654321']
    )

    expect(colors).toEqual(['#123456', '#654321'])
  })
})
