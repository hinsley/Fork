import { describe, expect, it } from 'vitest'
import type { InvariantMeasureEigenmode } from '../../../system/types'
import { groupEigenmodes } from './invariantMeasureStats'

function mode(
  rank: number,
  re: number,
  im: number,
  residual: number,
  conjugatePair = im !== 0
): InvariantMeasureEigenmode {
  return {
    rank,
    eigenvalueRe: re,
    eigenvalueIm: im,
    modulus: Math.hypot(re, im),
    ritzResidual: residual,
    converged: residual < 1e-8,
    conjugatePair,
    interpretation: conjugatePair ? 'oscillatory_density_relaxation' : 'density_relaxation',
    vectorReal: [],
    vectorImaginary: [],
  }
}

describe('groupEigenmodes', () => {
  // Logistic map, 200 cells: the solver returns each unconverged pair twice and
  // a real mode with a noise-level imaginary part.
  const logistic = [
    mode(1, 0.5307311975961506, 0.5628856932824069, 3.95e-9),
    mode(2, -0.39560076111887443, 0.6225895678199103, 1.42e-7),
    mode(3, -0.39560070350709503, 0.6225895629683356, 8.23e-8),
    mode(4, -0.007418746618831902, 0.7019014882997885, 1.24e-7),
    mode(5, -0.007418755805725494, 0.7019014631990949, 8.06e-8),
    mode(6, -0.6982701431978986, 0.000008879681931430057, 2.28e-5),
  ]

  it('shows each conjugate pair once and counts eigenvalues correctly', () => {
    const { rows, eigenvalueCount } = groupEigenmodes(logistic)
    expect(rows.map((row) => row.ranks)).toEqual([[1], [2, 3], [4, 5], [6]])
    expect(rows.map((row) => row.index)).toEqual([1, 2, 3, 4])
    expect(rows.map((row) => row.complex)).toEqual([true, true, true, false])
    expect(eigenvalueCount).toBe(7)
  })

  it('prefers a converged duplicate and never merges genuine real modes', () => {
    const converged = { ...logistic[2]!, converged: true }
    const { rows } = groupEigenmodes([logistic[1]!, converged])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.mode.rank).toBe(3)
    const repeated = groupEigenmodes([mode(1, 0.5, 0, 1e-10), mode(2, 0.5, 0, 1e-10)])
    expect(repeated.rows).toHaveLength(2)
    expect(repeated.eigenvalueCount).toBe(2)
  })

  it('keeps distinct pairs apart', () => {
    const { rows } = groupEigenmodes([mode(1, 0.3, 0.4, 1e-10), mode(2, 0.3, 0.41, 1e-10)])
    expect(rows).toHaveLength(2)
  })
})
