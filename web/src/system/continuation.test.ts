import { describe, expect, it } from 'vitest'
import {
  buildSortedArrayOrder,
  computeLimitCycleMetrics,
  ensureBranchIndices,
  extractLimitCycleProfile,
  extractHopfOmega,
  formatBifurcationLabel,
  formatBifurcationType,
  getBranchParams,
  interpretLimitCycleStability,
  normalizeBranchEigenvalues,
  normalizeEigenvalueArray,
  resolveContinuationPointEquilibriumState,
  resolveContinuationPointParam2Value,
  serializeBranchDataForWasm,
} from './continuation'
import { addObject, createSystem } from './model'
import type { ContinuationObject, ContinuationPoint, OrbitObject, SystemConfig } from './types'

const baseConfig: SystemConfig = {
  name: 'Sys',
  equations: ['x'],
  params: [0.1, 0.2],
  paramNames: ['a', 'b'],
  varNames: ['x'],
  solver: 'rk4',
  type: 'flow',
}

const baseSettings = {
  step_size: 0.1,
  min_step_size: 0.01,
  max_step_size: 0.5,
  max_steps: 10,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-4,
}

const basePoint: ContinuationPoint = {
  state: [0],
  param_value: 0,
  stability: 'None',
  eigenvalues: [{ re: 0, im: 0 }],
}

const baseBranch: ContinuationObject = {
  type: 'continuation',
  name: 'Branch',
  systemName: 'Sys',
  parameterName: 'a',
  parentObject: 'Parent',
  startObject: 'Start',
  branchType: 'equilibrium',
  data: {
    points: [basePoint],
    bifurcations: [],
    indices: [0],
  },
  settings: baseSettings,
  timestamp: '2020-01-01T00:00:00Z',
}

describe('continuation helpers', () => {
  it('normalizes eigenvalue inputs', () => {
    const normalized = normalizeEigenvalueArray([
      [1, -2],
      { re: '3', im: 4 },
      { re: undefined, im: undefined },
    ])

    expect(normalized).toEqual([
      { re: 1, im: -2 },
      { re: 3, im: 4 },
      { re: 0, im: 0 },
    ])
  })

  it('returns an empty array for missing eigenvalues', () => {
    expect(normalizeEigenvalueArray(null)).toEqual([])
    expect(normalizeEigenvalueArray({})).toEqual([])
  })

  it('extracts a Hopf omega from eigenvalues', () => {
    const point: ContinuationPoint = {
      ...basePoint,
      eigenvalues: [
        { re: 0.5, im: 2 },
        { re: 0.1, im: 1 },
        { re: 0.1, im: 3 },
      ],
    }

    expect(extractHopfOmega(point)).toBe(3)
  })

  it('uses the smallest real part to pick a Hopf omega', () => {
    const point: ContinuationPoint = {
      ...basePoint,
      eigenvalues: [
        { re: 0.2, im: 4 },
        { re: 0.01, im: 2 },
      ],
    }

    expect(extractHopfOmega(point)).toBe(2)
  })

  it('falls back to 1.0 when Hopf eigenvalues are unavailable', () => {
    const point: ContinuationPoint = {
      ...basePoint,
      eigenvalues: [{ re: 1, im: 0 }],
    }

    expect(extractHopfOmega(point)).toBe(1)
  })

  it('normalizes eigenvalues across branch points', () => {
    const normalized = normalizeBranchEigenvalues({
      points: [
        {
          ...basePoint,
          eigenvalues: [
            [1, 2],
            { re: 3, im: 4 },
          ] as unknown as ContinuationPoint['eigenvalues'],
        },
      ],
      bifurcations: [],
      indices: [0],
    })

    expect(normalized.points[0].eigenvalues).toEqual([
      { re: 1, im: 2 },
      { re: 3, im: 4 },
    ])
  })

  it('decodes homoclinic secondary parameter from packed state', () => {
    const p2 = 0.37
    const state = [
      // mesh (ntst+1=3 points, dim=2)
      0, 0, 1, 1, 2, 2,
      // stages (ntst*ncol=2 points, dim=2)
      0.5, 0.5, 1.5, 1.5,
      // x0 (dim=2)
      0, 0,
      // p2
      p2,
      // extras + Riccati tail (unused in decoder)
      10, 0.01, 0, 0,
    ]
    const branchType = {
      type: 'HomoclinicCurve' as const,
      ntst: 2,
      ncol: 1,
      param1_name: 'a',
      param2_name: 'b',
      free_time: true,
      free_eps0: true,
      free_eps1: false,
    }

    const value = resolveContinuationPointParam2Value(
      { state, param2_value: undefined },
      branchType,
      2
    )

    expect(value).toBeCloseTo(p2, 12)
  })

  it('hydrates missing homoclinic param2 values during normalization', () => {
    const p2 = -0.42
    const state = [
      0, 0, 1, 1, 2, 2,
      0.5, 0.5, 1.5, 1.5,
      0, 0,
      p2,
      8, 0.02, 0, 0,
    ]

    const normalized = normalizeBranchEigenvalues(
      {
        points: [
          {
            state,
            param_value: 0.1,
            stability: 'None',
            eigenvalues: [],
          },
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'HomoclinicCurve',
          ntst: 2,
          ncol: 1,
          param1_name: 'a',
          param2_name: 'b',
          free_time: true,
          free_eps0: true,
          free_eps1: false,
        },
      },
      { stateDimension: 2 }
    )

    expect(normalized.points[0].param2_value).toBeCloseTo(p2, 12)
  })

  it('extracts equilibrium coordinates from packed homoclinic states', () => {
    const x0 = [1.25, -0.75]
    const state = [
      0, 0, 1, 1, 2, 2,
      0.5, 0.5, 1.5, 1.5,
      ...x0,
      0.33,
      8, 0.02, 0, 0,
    ]

    const equilibriumState = resolveContinuationPointEquilibriumState(
      { state },
      {
        type: 'HomoclinicCurve',
        ntst: 2,
        ncol: 1,
        param1_name: 'a',
        param2_name: 'b',
        free_time: true,
        free_eps0: true,
        free_eps1: false,
      },
      2
    )

    expect(equilibriumState).toEqual(x0)
  })

  it('extracts orbit profile from packed-tail homoclinic state', () => {
    const dim = 2
    const ntst = 2
    const ncol = 1
    const packed = [
      // mesh
      0, 0, 1, 0, 2, 0,
      // stage
      0.5, 0, 1.5, 0,
      // x0 + p2 + extras + Riccati tail
      0, 0, 0.25, 8, 0.02, 0, 0,
    ]

    const { profilePoints } = extractLimitCycleProfile(packed, dim, ntst, ncol, {
      layout: 'mesh-first',
      allowPackedTail: true,
    })

    expect(profilePoints.length).toBeGreaterThan(0)
    expect(profilePoints[0]).toEqual([0, 0])
    expect(profilePoints[profilePoints.length - 1]).toEqual([2, 0])
  })

  it('serializes branch data for WASM consumers', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'limit_cycle',
      data: {
        ...baseBranch.data,
        points: [
          {
            ...basePoint,
            eigenvalues: [{ re: 1, im: 2 }],
          },
          {
            ...basePoint,
            param_value: 1,
            eigenvalues: [[3, 4]] as unknown as ContinuationPoint['eigenvalues'],
          },
        ],
        indices: [12],
        branch_type: { type: 'LimitCycle', ntst: 10, ncol: 4 },
      },
    }

    const serialized = serializeBranchDataForWasm(branch)

    expect(serialized.indices).toEqual([0, 1])
    expect(serialized.branch_type).toEqual({ type: 'LimitCycle', ntst: 10, ncol: 4 })
    expect(serialized.points[1].eigenvalues).toEqual([[3, 4]])
  })

  it('preserves explicit indices when they match the point count', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      data: {
        ...baseBranch.data,
        points: [basePoint, { ...basePoint, param_value: 1 }],
        indices: [5, 6],
      },
    }

    const serialized = serializeBranchDataForWasm(branch)

    expect(serialized.indices).toEqual([5, 6])
  })

  it('rejects missing limit-cycle branch metadata', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'limit_cycle',
      data: {
        ...baseBranch.data,
      },
    }

    expect(() => serializeBranchDataForWasm(branch)).toThrow(
      'Limit cycle branch is missing branch_type metadata.'
    )
  })

  it('keeps explicit limit-cycle settings', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'limit_cycle',
      data: {
        ...baseBranch.data,
        branch_type: { type: 'LimitCycle', ntst: 12, ncol: 5 },
      },
    }

    const serialized = serializeBranchDataForWasm(branch)

    expect(serialized.branch_type).toEqual({ type: 'LimitCycle', ntst: 12, ncol: 5 })
  })

  it('preserves provided indices and sorts by logical order', () => {
    const data = {
      points: [basePoint, { ...basePoint, param_value: 1 }],
      bifurcations: [],
      indices: [2, 0],
    }

    expect(ensureBranchIndices(data)).toEqual([2, 0])
    expect(buildSortedArrayOrder([3, 1, 2])).toEqual([1, 2, 0])
  })

  it('generates indices when missing or mismatched', () => {
    const data = {
      points: [basePoint, { ...basePoint, param_value: 1 }],
      bifurcations: [],
      indices: [1],
    }

    expect(ensureBranchIndices(data)).toEqual([0, 1])
  })

  it('derives branch parameters from branch, parent, or system config', () => {
    const system = createSystem({ name: 'Sys', config: baseConfig })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Parent',
      systemName: system.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
      parameters: [9, 8],
    }
    const { system: withObject } = addObject(system, orbit)

    const withBranchParams = { ...baseBranch, params: [1, 2] }
    expect(getBranchParams(withObject, withBranchParams)).toEqual([1, 2])

    const withoutBranchParams = { ...baseBranch }
    expect(getBranchParams(withObject, withoutBranchParams)).toEqual([9, 8])
  })

  it('falls back to system params when no branch or parent params match', () => {
    const system = createSystem({ name: 'Sys', config: baseConfig })
    const branch = { ...baseBranch, parentObject: 'Missing' }

    expect(getBranchParams(system, branch)).toEqual(baseConfig.params)
  })

  it('formats bifurcation labels', () => {
    expect(formatBifurcationType('GeneralizedPeriodDoubling')).toBe(
      'Generalized Period Doubling'
    )
    expect(formatBifurcationType('FooBar')).toBe('Foo Bar')
    expect(formatBifurcationType('None')).toBe('Unknown')
    expect(formatBifurcationLabel(3, 'Hopf')).toBe('Index 3 - Hopf')
  })

  it('extracts limit cycle profile points and period', () => {
    const flatState = [1, 2, 3, 4, 5, 6, 10]
    const result = extractLimitCycleProfile(flatState, 2, 2, 1)

    expect(result.profilePoints).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
    expect(result.period).toBe(10)
  })

  it('extracts a mesh-first collocation profile', () => {
    const flatState = [0, 10, 1, 2, 11, 12, 5]
    const result = extractLimitCycleProfile(flatState, 1, 2, 2, {
      layout: 'mesh-first',
    })

    expect(result.profilePoints).toEqual([[0], [1], [2], [10], [11], [12], [0]])
    expect(result.period).toBe(5)
  })

  it('extracts a stage-first collocation profile', () => {
    const flatState = [1, 11, 0, 10, 0, 7]
    const result = extractLimitCycleProfile(flatState, 1, 2, 1, {
      layout: 'stage-first',
    })

    expect(result.profilePoints).toEqual([[0], [1], [10], [11], [0]])
    expect(result.period).toBe(7)
  })

  it('computes limit cycle metrics', () => {
    const metrics = computeLimitCycleMetrics(
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      10
    )

    expect(metrics.period).toBe(10)
    expect(metrics.ranges).toEqual([
      { min: 1, max: 5, range: 4 },
      { min: 2, max: 6, range: 4 },
    ])
    expect(metrics.means).toEqual([3, 4])
    expect(metrics.rmsAmplitudes[0]).toBeCloseTo(Math.sqrt(8 / 3))
    expect(metrics.rmsAmplitudes[1]).toBeCloseTo(Math.sqrt(8 / 3))
  })

  it('interprets limit cycle stability from multipliers', () => {
    expect(
      interpretLimitCycleStability([
        { re: 1, im: 0 },
        { re: 0.2, im: 0 },
      ])
    ).toBe('stable')
    expect(
      interpretLimitCycleStability([
        { re: 1, im: 0 },
        { re: 1.2, im: 0 },
      ])
    ).toBe('unstable (1D)')
    expect(
      interpretLimitCycleStability([
        { re: 1, im: 0 },
        { re: 1.1, im: 0.2 },
      ])
    ).toBe('unstable (torus)')
  })
})
