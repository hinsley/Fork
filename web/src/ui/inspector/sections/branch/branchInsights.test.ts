import { describe, expect, it, vi } from 'vitest'
import type { ContinuationObject, ContinuationPoint } from '../../../../system/types'
import {
  branchSpectrumKind,
  buildBifurcationRows,
  buildEigenRows,
  buildStabilityRuns,
  formatBranchSummaryDetail,
  formatParamRange,
  formatPointTsv,
  pointStability,
  recallBranchPoint,
  rememberBranchPoint,
} from './branchInsights'

function point(
  param: number,
  eigenvalues: Array<[number, number]>,
  stability: string = 'None'
): ContinuationPoint {
  return {
    state: [0, 0],
    param_value: param,
    stability,
    eigenvalues: eigenvalues.map(([re, im]) => ({ re, im })),
  }
}

function equilibriumBranch(points: ContinuationPoint[], bifurcations: number[]): ContinuationObject {
  return {
    type: 'continuation',
    name: 'eq',
    systemName: 'S',
    parameterName: 'mu',
    parentObject: 'EQ',
    startObject: 'EQ',
    branchType: 'equilibrium',
    data: {
      points,
      bifurcations,
      indices: points.map((_, index) => index),
    },
    settings: {
      step_size: 0.1,
      min_step_size: 1e-6,
      max_step_size: 0.2,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-8,
      step_tolerance: 1e-8,
    },
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

describe('branch insights', () => {
  const points = [
    point(-0.5, [[-0.5, 1], [-0.5, -1]]),
    point(-0.25, [[-0.25, 1], [-0.25, -1]]),
    point(0, [[0, 1], [0, -1]], 'Hopf'),
    point(0.25, [[0.25, 1], [0.25, -1]]),
    point(0.5, [[0.5, 2], [0.5, -2]]),
  ]
  const branch = equilibriumBranch(points, [2])

  it('groups points into stability runs by unstable dimension', () => {
    const runs = buildStabilityRuns(points, [0, 1, 2, 3, 4], 'equilibrium', 'flow')
    expect(runs).toEqual([
      { start: 0, end: 2, unstable: 0 },
      { start: 3, end: 4, unstable: 2 },
    ])
  })

  it('reports real stability instead of the bifurcation tag', () => {
    expect(pointStability(points[0], 'equilibrium', 'flow')).toEqual({
      kind: 'stable',
      label: 'stable focus',
    })
    expect(pointStability(points[2], 'equilibrium', 'flow')?.kind).toBe('nonhyperbolic')
    expect(pointStability(points[0], null, 'flow')).toBeNull()
  })

  it('builds bifurcation rows with codes, parameter values and Hopf frequency', () => {
    const rows = buildBifurcationRows({
      branch,
      branchIndices: [0, 1, 2, 3, 4],
      sortedOrder: [0, 1, 2, 3, 4],
      systemType: 'flow',
      stateDimension: 2,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      arrayIndex: 2,
      sortedPosition: 2,
      logicalIndex: 2,
      code: 'H',
      tone: 'hopf',
      label: 'Hopf',
      param1: 0,
      param2: null,
      extra: 'ω 1',
      candidate: false,
    })
  })

  it('labels map Hopf tags as Neimark-Sacker', () => {
    const rows = buildBifurcationRows({
      branch,
      branchIndices: [0, 1, 2, 3, 4],
      sortedOrder: [0, 1, 2, 3, 4],
      systemType: 'map',
      stateDimension: 2,
    })
    expect(rows[0]).toMatchObject({ code: 'NS', label: 'Neimark-Sacker' })
  })

  it('formats the summary meta line, keeping the type/point prefix verbatim', () => {
    expect(formatBranchSummaryDetail(branch, 'Equilibrium', [0, 1, 2, 3, 4], 2)).toBe(
      'equilibrium · 5 points · mu −0.5 → 0.5'
    )
    expect(formatParamRange({ start: 0, end: 1, min: -0.5, max: 1 })).toBe('0 → 1 [−0.5, 1]')
  })

  it('sorts eigenvalues most-unstable first and flags unstable rows', () => {
    const rows = buildEigenRows(
      [
        { re: -2, im: 0 },
        { re: 0.5, im: 1 },
        { re: 0.5, im: -1 },
      ],
      'flow'
    )
    expect(rows.map((row) => [row.re, row.im, row.unstable])).toEqual([
      [0.5, 1, true],
      [0.5, -1, true],
      [-2, 0, false],
    ])
    expect(buildEigenRows([{ re: 0.5, im: 0 }], 'flow', false)[0].unstable).toBe(false)
  })

  it('does not tint a located Hopf pair (locator noise) as unstable', () => {
    const rows = buildEigenRows(
      [
        { re: 4.16564e-7, im: 9.62453 },
        { re: 4.16564e-7, im: -9.62453 },
        { re: -13.6667, im: 0 },
      ],
      'flow'
    )
    expect(rows.map((row) => row.unstable)).toEqual([false, false, false])
  })

  it('treats cycle-like branches as multipliers and skips the trivial one', () => {
    expect(branchSpectrumKind('pd_curve', 'flow')).toBe('cycle')
    const rows = buildEigenRows(
      [
        { re: 1, im: 0 },
        { re: -1.5, im: 0 },
      ],
      'cycle'
    )
    expect(rows[0]).toMatchObject({ re: -1.5, unstable: true, trivial: false })
    expect(rows[1]).toMatchObject({ re: 1, unstable: false, trivial: true })
  })

  it('copies points as full-precision TSV', () => {
    expect(
      formatPointTsv({
        index: 4,
        params: [['mu', 0.123456789012]],
        state: [['x', -1e-17]],
        eigenvalues: [{ re: 0.5, im: -0.25 }],
        eigenLabel: 'μ',
      })
    ).toBe('index\t4\nmu\t0.123456789012\nx\t-1e-17\nμ1\t0.5\t-0.25')
  })

  it('remembers the selected point per branch', () => {
    rememberBranchPoint('sys-memory', 'branch-a', 3)
    expect(recallBranchPoint('sys-memory', 'branch-a', 5)).toBe(3)
    expect(recallBranchPoint('sys-memory', 'branch-a', 3)).toBeNull()
    expect(recallBranchPoint('sys-memory', 'branch-b', 5)).toBeNull()
  })

  it('restores the remembered point after a reload (fresh module, same storage)', async () => {
    rememberBranchPoint('sys-reload', 'branch-r', 7)
    vi.resetModules()
    const reloaded = await import('./branchInsights')
    expect(reloaded.recallBranchPoint('sys-reload', 'branch-r', 10)).toBe(7)
    expect(reloaded.recallBranchPoint('sys-reload', 'branch-r', 7)).toBeNull()
  })

  it('ignores unreadable stored points', async () => {
    localStorage.setItem('fork:branch-points', '{not json')
    vi.resetModules()
    const reloaded = await import('./branchInsights')
    expect(reloaded.recallBranchPoint('sys-bad', 'branch-x', 10)).toBeNull()
    reloaded.rememberBranchPoint('sys-bad', 'branch-x', 2)
    vi.resetModules()
    const again = await import('./branchInsights')
    expect(again.recallBranchPoint('sys-bad', 'branch-x', 10)).toBe(2)
  })
})
