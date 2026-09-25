import { describe, expect, it } from 'vitest'
import {
  findOrbitDivergenceIndex,
  formatBifurcationBadges,
  resolveRenderedPointSummary,
  rowSummaryMatches,
  summarizeBranch,
  summarizeObject,
} from './rowSummary'
import type {
  ContinuationObject,
  ContinuationPoint,
  EquilibriumObject,
  ForcedPeriodicResponseObject,
  InvariantMeasureObject,
  IsoclineObject,
  LimitCycleObject,
  OrbitObject,
  ParticleObject,
  StateGridObject,
} from './types'

const flow = { type: 'flow' as const }
const map = { type: 'map' as const }

function orbit(overrides: Partial<OrbitObject> = {}): OrbitObject {
  return {
    type: 'orbit',
    name: 'Orbit_1',
    systemName: 'S',
    data: Array.from({ length: 10001 }, (_, index) => [index * 0.01, 0, 0]),
    t_start: 0,
    t_end: 100,
    dt: 0.01,
    ...overrides,
  }
}

function equilibrium(overrides: Partial<EquilibriumObject> = {}): EquilibriumObject {
  return { type: 'equilibrium', name: 'Eq', systemName: 'S', ...overrides }
}

function solution(values: Array<[number, number]>, cyclePoints?: number[][]) {
  return {
    state: [0, 0],
    residual_norm: 0,
    iterations: 1,
    jacobian: [],
    eigenpairs: values.map(([re, im]) => ({ value: { re, im }, vector: [] })),
    ...(cyclePoints ? { cycle_points: cyclePoints } : {}),
  }
}

function point(param: number, stability = 'None', extra: Partial<ContinuationPoint> = {}) {
  return { state: [0], param_value: param, stability, ...extra } as ContinuationPoint
}

function branch(overrides: Partial<ContinuationObject> = {}): ContinuationObject {
  return {
    type: 'continuation',
    name: 'eq_branch',
    systemName: 'S',
    parameterName: 'mu',
    parentObject: 'Eq',
    startObject: 'Eq',
    branchType: 'equilibrium',
    data: { points: [], bifurcations: [], indices: [] },
    settings: {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('summarizeObject', () => {
  it('summarizes flow orbits with time span and compact sample count', () => {
    expect(summarizeObject(orbit(), flow)).toEqual({ text: 't 0–100 · 10k' })
    expect(summarizeObject(orbit({ data: [[0, 1], [1, 2]], t_end: 1 }), flow)?.text).toBe(
      't 0–1 · 2'
    )
  })

  it('appends the leading Lyapunov exponent when present', () => {
    expect(
      summarizeObject(orbit({ lyapunovExponents: [0.90563, 0, -14.57] }), flow)?.text
    ).toBe('t 0–100 · 10k · λ₁ 0.906')
  })

  it('summarizes map orbits by iteration count', () => {
    const data = Array.from({ length: 1001 }, (_, index) => [index, 0])
    expect(summarizeObject(orbit({ data, t_start: 0, t_end: 1000 }), map)?.text).toBe('n 1000')
  })

  it('flags orbits whose state became non-finite as diverged', () => {
    const data = [
      [0, 1],
      [0.5, 2],
      [1, Number.POSITIVE_INFINITY],
      [1.5, Number.NaN],
    ]
    expect(findOrbitDivergenceIndex(data)).toBe(2)
    expect(summarizeObject(orbit({ data, t_end: 1.5 }), flow)).toEqual({
      text: 't 0–1.5 · 4',
      status: 'diverged',
      tone: 'unstable',
    })
    // JSON persistence turns ∞ into null.
    const persisted = [[0, 1], [1, null as unknown as number]]
    expect(findOrbitDivergenceIndex(persisted)).toBe(1)
    expect(findOrbitDivergenceIndex([[0, 1], [1, 2]])).toBe(-1)
  })

  it('marks orbits that were never run', () => {
    expect(summarizeObject(orbit({ data: [] }), flow)).toEqual({ text: '—', tone: 'muted' })
  })

  it('classifies solved equilibria', () => {
    expect(
      summarizeObject(equilibrium({ solution: solution([[-1, 1], [-1, -1]]) }), flow)
    ).toEqual({ status: 'stable focus', tone: 'stable' })
    expect(
      summarizeObject(
        equilibrium({ solution: solution([[1, 0], [-2, 3], [-2, -3]]) }),
        flow
      )
    ).toEqual({ status: 'saddle-focus 1u', tone: 'saddle' })
  })

  it('labels map cycles with their period', () => {
    expect(
      summarizeObject(
        equilibrium({ solution: solution([[0.2, 0]], [[0], [1], [2]]) }),
        map
      )
    ).toEqual({ text: '3-cycle', status: 'stable', tone: 'stable' })
    expect(
      summarizeObject(equilibrium({ solution: solution([[-1.5, 0]], [[0]]) }), map)
    ).toEqual({ status: 'unstable', tone: 'unstable' })
  })

  it('reports unsolved and failed equilibria', () => {
    expect(summarizeObject(equilibrium(), flow)).toEqual({ status: 'unsolved', tone: 'muted' })
    expect(
      summarizeObject(
        equilibrium({
          lastRun: {
            timestamp: 'x',
            success: false,
            diagnostic: { kind: 'max_iterations', message: 'Newton did not converge.' },
          },
        }),
        flow
      )
    ).toEqual({ status: 'failed', tone: 'unstable', warn: 'Newton did not converge.' })
  })

  it('summarizes limit cycles with period and Floquet stability', () => {
    const cycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC',
      systemName: 'S',
      origin: { type: 'orbit', orbitName: 'Orbit_1' },
      ntst: 20,
      ncol: 4,
      period: 6.283185,
      state: [],
      createdAt: 'x',
      floquetMultipliers: [
        { re: 1, im: 0 },
        { re: 0.2, im: 0 },
      ],
    }
    expect(summarizeObject(cycle, flow)).toEqual({
      text: 'T 6.283',
      status: 'stable',
      tone: 'stable',
    })
    expect(
      summarizeObject(
        {
          ...cycle,
          floquetMultipliers: [
            { re: 1, im: 0 },
            { re: 3, im: 0 },
            { re: 2, im: 0 },
          ],
        },
        flow
      )
    ).toEqual({ text: 'T 6.283', status: 'unstable 2u', tone: 'unstable' })
    expect(summarizeObject({ ...cycle, floquetMultipliers: undefined }, flow)).toEqual({
      text: 'T 6.283',
    })
  })

  it('labels torus instability and summarizes the rendered branch point', () => {
    const cycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'lc1',
      systemName: 'S',
      origin: { type: 'hopf', equilibriumObjectName: 'Eq', equilibriumBranchName: 'b', pointIndex: 3 },
      ntst: 20,
      ncol: 4,
      period: 0.6528,
      state: [],
      createdAt: 'x',
    }
    expect(
      summarizeObject(
        {
          ...cycle,
          floquetMultipliers: [
            { re: 1, im: 0 },
            { re: 1.1, im: 0.5 },
            { re: 1.1, im: -0.5 },
          ],
        },
        flow
      )
    ).toEqual({ text: 'T 0.6528', status: 'unstable (torus)', tone: 'unstable' })
    const lcBranch = branch({
      name: 'lc1_rho',
      branchType: 'limit_cycle',
      data: {
        points: [
          point(24, 'None', {
            state: [1, 2, 0.668116],
            eigenvalues: [
              { re: 1, im: 0 },
              { re: 1.01807, im: 0 },
            ],
          }),
        ],
        bifurcations: [],
        indices: [0],
      },
    })
    const rendered = resolveRenderedPointSummary(
      { lc1: { type: 'branch', branchId: 'b1', pointIndex: 0 } },
      { b1: lcBranch },
      'lc1',
      'limit_cycle'
    )
    expect(summarizeObject(cycle, flow, rendered)).toEqual({
      text: 'T 0.6681',
      status: 'unstable 1u',
      tone: 'unstable',
    })
    expect(
      resolveRenderedPointSummary(
        { lc1: { type: 'object' } },
        { b1: lcBranch },
        'lc1',
        'limit_cycle'
      )
    ).toBeUndefined()
  })

  it('summarizes forced periodic responses', () => {
    const response: ForcedPeriodicResponseObject = {
      type: 'forced_periodic_response',
      name: 'FPR',
      systemName: 'S',
      origin: { type: 'manual' },
      lastSolverParams: {
        initialGuess: [],
        phase: 0,
        responseMultiple: 2,
        stepsPerForcingPeriod: 100,
        maxSteps: 10,
        dampingFactor: 1,
        tolerance: 1e-8,
      },
      createdAt: 'x',
    }
    expect(summarizeObject(response, flow)).toEqual({ status: 'unsolved', tone: 'muted' })
    expect(
      summarizeObject(
        {
          ...response,
          solution: {
            state: [],
            residual_norm: 0,
            iterations: 1,
            monodromy: [],
            multipliers: [{ re: 0.5, im: 0 }],
            cycle_points: [],
            contexts: [],
            forcing_period: 6.2832,
            response_multiple: 2,
            minimal_response_multiple: 2,
          },
        },
        flow
      )
    ).toEqual({ text: 'T 6.283 ×2', status: 'stable', tone: 'stable' })
    const forcedBranch = branch({
      name: 'fpr_omega',
      branchType: 'forced_periodic_response',
      data: {
        points: [
          point(2, 'None', {
            forcing_period: 3.1416,
            eigenvalues: [
              { re: 1.5, im: 0 },
              { re: 0.2, im: 0 },
            ],
          }),
        ],
        bifurcations: [],
        indices: [0],
        branch_type: {
          type: 'ForcedPeriodicResponse',
          symbol: 't',
          phase: 0,
          response_multiple: 2,
          steps_per_forcing_period: 100,
          integrator: 'rk4',
        },
      },
    })
    const rendered = resolveRenderedPointSummary(
      { fpr: { type: 'branch', branchId: 'fb', pointIndex: 0 } },
      { fb: forcedBranch },
      'fpr',
      'forced_periodic_response'
    )
    expect(summarizeObject(response, flow, rendered)).toEqual({
      text: 'T 3.142 ×2',
      status: 'saddle 1u',
      tone: 'saddle',
    })
  })

  it('summarizes isoclines by their defining level set', () => {
    const isocline: IsoclineObject = {
      type: 'isocline',
      name: 'Iso',
      systemName: 'S',
      source: { kind: 'flow_derivative', variableName: 'x' },
      level: 0,
      axes: [],
      frozenState: [],
    }
    expect(summarizeObject(isocline, flow)).toEqual({ text: 'x′=0', tone: 'muted' })
    expect(
      summarizeObject(
        {
          ...isocline,
          source: { kind: 'custom', expression: 'x*y' },
          level: 0.5,
          lastComputed: {} as IsoclineObject['lastComputed'],
        },
        flow
      )
    ).toEqual({ text: 'x*y=0.5' })
    expect(
      summarizeObject(
        { ...isocline, source: { kind: 'map_increment', variableName: 'y' } },
        map
      )?.text
    ).toBe('Δy=0')
  })

  it('summarizes state grids, invariant measures and particles', () => {
    const grid: StateGridObject = {
      type: 'state_grid',
      name: 'Grid',
      systemName: 'S',
      axes: [
        { variableName: 'x', min: 0, max: 1, resolution: 64 },
        { variableName: 'y', min: 0, max: 1, resolution: 48 },
      ],
      sampling: { type: 'cartesian_cell_centers' },
      analysis: {
        type: 'expansion_entropy',
        steps: 10,
        dt: 0.1,
        checkpointStride: 1,
        stabilizationStride: 1,
      },
      createdAt: 'x',
    }
    expect(summarizeObject(grid, flow)).toEqual({ text: '64×48' })
    expect(
      summarizeObject(
        {
          ...grid,
          lastResult: {
            entropyEstimates: [0.1, 0.4213, null],
          } as unknown as StateGridObject['lastResult'],
        },
        flow
      )
    ).toEqual({ text: '64×48 · h 0.421' })

    const measure = {
      type: 'invariant_measure',
      name: 'Measure',
      systemName: 'S',
      sourceStateGridId: 'g',
      sourceStateGridName: 'Grid',
      result: { totalBoxes: 4096 },
      createdAt: 'x',
    } as unknown as InvariantMeasureObject
    expect(summarizeObject(measure, flow)).toEqual({ text: '4096 boxes' })

    const particles: ParticleObject = {
      type: 'particles',
      name: 'P',
      systemName: 'S',
      sourceStateGridId: 'g',
      sourceStateGridName: 'Grid',
      settings: { speed: 1, lifetime: 1, integrationStep: 0.01, trailLength: 4, playing: true },
      createdAt: 'x',
    }
    expect(summarizeObject(particles, flow)).toEqual({ text: 'playing' })
    expect(
      summarizeObject({ ...particles, settings: { ...particles.settings, playing: false } }, flow)
    ).toBeUndefined()
  })
})

describe('summarizeBranch', () => {
  it('summarizes codim-1 branches with parameter range, size and bifurcations', () => {
    const points = [
      point(-0.5),
      point(0, 'Fold'),
      point(0.5, 'Hopf'),
      point(1, 'Fold'),
      point(1.5),
    ]
    const summary = summarizeBranch(
      branch({
        parameterRef: { kind: 'native_param', name: 'p1' },
        data: { points, bifurcations: [1, 2, 3], indices: [0, 1, 2, 3, 4] },
      }),
      flow
    )
    expect(summary).toEqual({
      text: 'p1 −0.5…1.5 · 5',
      bifs: [
        ['LP', 2],
        ['H', 1],
      ],
    })
  })

  it('reports Hopf points on map branches as Neimark–Sacker', () => {
    const summary = summarizeBranch(
      branch({
        data: { points: [point(0), point(1, 'Hopf')], bifurcations: [1], indices: [0, 1] },
      }),
      map
    )
    expect(summary?.bifs).toEqual([['NS', 1]])
    expect(summary?.text).toBe('mu 0…1 · 2')
  })

  it('names both parameters of codim-2 curves', () => {
    const summary = summarizeBranch(
      branch({
        branchType: 'fold_curve',
        parameterName: 'a, b',
        data: {
          points: [point(0, 'None', { param2_value: 1 }), point(1, 'Cusp', { param2_value: 2 })],
          bifurcations: [1],
          indices: [0, 1],
          branch_type: {
            type: 'FoldCurve',
            param1_name: 'alpha',
            param2_name: 'beta',
          } as unknown as NonNullable<ContinuationObject['data']['branch_type']>,
        },
      }),
      flow
    )
    expect(summary).toEqual({ text: 'alpha, beta · 2', bifs: [['CP', 1]] })
  })

  it('carries termination messages and handles empty branches', () => {
    expect(
      summarizeBranch(
        branch({
          data: {
            points: [],
            bifurcations: [],
            indices: [],
            termination: { kind: 'step', message: 'Step size too small.' },
          },
        }),
        flow
      )
    ).toEqual({ text: '—', tone: 'muted', warn: 'Step size too small.' })
  })

  it('summarizes manifolds by dimension and size', () => {
    expect(
      summarizeBranch(
        branch({
          branchType: 'eq_manifold_1d',
          data: {
            points: [],
            bifurcations: [],
            indices: [],
            manifold_geometry: {
              type: 'Curve',
              dim: 3,
              points_flat: new Array(900).fill(0),
              arclength: [],
              direction: 'Both',
            },
          },
        }),
        flow
      )?.text
    ).toBe('1d · 300')
    expect(
      summarizeBranch(
        branch({
          branchType: 'eq_manifold_2d',
          data: {
            points: [],
            bifurcations: [],
            indices: [],
            manifold_geometry: {
              type: 'Surface',
              dim: 3,
              vertices_flat: [],
              triangles: [],
              ring_offsets: [0, 10, 20],
              solver_diagnostics: {
                termination_reason: 'max_rings',
              } as unknown as NonNullable<
                Extract<
                  NonNullable<ContinuationObject['data']['manifold_geometry']>,
                  { vertices_flat: number[] }
                >['solver_diagnostics']
              >,
            },
          },
        }),
        flow
      )?.text
    ).toBe('2d · 3 rings · max rings')
  })
})

describe('formatBifurcationBadges', () => {
  it('caps the list and reports the overflow', () => {
    expect(
      formatBifurcationBadges([
        ['LP', 2],
        ['H', 1],
        ['BP', 1],
        ['PD', 3],
        ['NS', 1],
      ])
    ).toEqual({
      shown: [
        { code: 'LP', count: 2, label: 'LP×2', tone: 'fold' },
        { code: 'H', count: 1, label: 'H', tone: 'hopf' },
        { code: 'BP', count: 1, label: 'BP', tone: 'branch' },
      ],
      overflow: 2,
    })
    expect(formatBifurcationBadges(undefined)).toEqual({ shown: [], overflow: 0 })
  })
})

describe('rowSummaryMatches', () => {
  const summary = { status: 'saddle 1u', bifs: [['H', 1]] as Array<[string, number]> }

  it('matches names and summary text case-insensitively for lower-case queries', () => {
    expect(rowSummaryMatches('saddle', 'Equilibrium_1', summary)).toBe(true)
    expect(rowSummaryMatches('equil', 'Equilibrium_1', summary)).toBe(true)
    expect(rowSummaryMatches('stable', 'Equilibrium_1', summary)).toBe(false)
  })

  it('matches bifurcation codes exactly when the query has capitals', () => {
    expect(rowSummaryMatches('H', 'Branch', summary)).toBe(true)
    expect(rowSummaryMatches('LP', 'Branch', summary)).toBe(false)
    expect(rowSummaryMatches('H', 'branch', undefined)).toBe(false)
  })
})
