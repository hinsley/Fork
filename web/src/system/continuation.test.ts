import { describe, expect, it } from 'vitest'
import {
  buildSortedArrayOrder,
  canonicalizeLimitCycleStateForAnalysis,
  computeLimitCycleMetrics,
  ensureBranchIndices,
  extractLimitCycleProfile,
  gaussLegendreNormalizedNodes,
  limitCycleProfileNormalizedCoordinates,
  extractHopfOmega,
  formatBifurcationLabel,
  formatBifurcationType,
  getBranchParams,
  interpretLimitCycleStability,
  isUniformNormalizedCollocationMesh,
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
  it('labels every tracked homoclinic spectral marker with its HBK code', () => {
    expect(formatBifurcationType('HomoclinicThreeLeadingStable')).toBe(
      'TLS - Three Leading Stable'
    )
    expect(formatBifurcationType('HomoclinicThreeLeadingUnstable')).toBe(
      'TLU - Three Leading Unstable'
    )
    expect(formatBifurcationType('HomoclinicNonCentral')).toBe(
      'NCH - Non-Central Homoclinic'
    )
    expect(formatBifurcationType('HomoclinicShilnikovHopf')).toBe(
      'SH - Shilnikov-Hopf'
    )
    expect(formatBifurcationType('HomoclinicBogdanovTakens')).toBe(
      'BT - Bogdanov-Takens'
    )
  })

  it('labels transported heteroclinic inclination flips by endpoint', () => {
    expect(formatBifurcationType('HeteroclinicSourceInclinationFlip')).toBe(
      'SIF - Source Inclination Flip'
    )
    expect(formatBifurcationType('HeteroclinicTargetInclinationFlip')).toBe(
      'TIF - Target Inclination Flip'
    )
  })

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

  it('decodes a heteroclinic secondary parameter after both endpoint equilibria', () => {
    const p2 = 0.73
    const basis = {
      stable_q: [1, 0, 0, 1],
      unstable_q: [1, 0, 0, 1],
      dim: 2,
      nneg: 1,
      npos: 1,
    }
    const branchType = {
      type: 'HeteroclinicCurve' as const,
      schema: {
        schema_version: 1,
        base_params: [0, 0],
        param1_index: 0,
        param2_index: 1,
        source_basis: basis,
        target_basis: basis,
        fixed_time: 10,
        fixed_eps0: 0.01,
        fixed_eps1: 0.01,
        projector_refresh_interval: 2,
      },
      ntst: 2,
      ncol: 1,
      param1_name: 'mu',
      param2_name: 'nu',
      free_time: false,
      free_eps0: true,
      free_eps1: true,
    }
    const state = [
      -1, 0, 0, 0, 1, 0,
      -0.5, 0, 0.5, 0,
      -1, 0,
      1, 0,
      p2,
      0.01, 0.01,
      0, 0,
    ]

    expect(
      resolveContinuationPointParam2Value(
        { state, param2_value: undefined },
        branchType,
        2
      )
    ).toBeCloseTo(p2, 12)
    expect(
      resolveContinuationPointEquilibriumState({ state }, branchType, 2)
    ).toEqual([-1, 0])
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

  it('decodes and samples packed standard-shooting homoclinic states', () => {
    const dim = 2
    const ntst = 2
    const ncol = 0
    const x0 = [0.1, -0.2]
    const p2 = 0.37
    const packed = [
      // M + 1 shooting nodes
      0, 0, 1, 0, 2, 0,
      // equilibrium, secondary parameter, free T, and Riccati tail
      ...x0, p2, 8, 0, 0,
    ]
    const branchType = {
      type: 'HomoclinicCurve' as const,
      ntst,
      ncol,
      param1_name: 'mu',
      param2_name: 'nu',
      free_time: true,
      free_eps0: false,
      free_eps1: false,
    }

    const { profilePoints } = extractLimitCycleProfile(packed, dim, ntst, ncol, {
      layout: 'mesh-first',
      allowPackedTail: true,
    })

    expect(profilePoints).toEqual([[0, 0], [1, 0], [2, 0]])
    expect(resolveContinuationPointEquilibriumState({ state: packed }, branchType, dim)).toEqual(x0)
    expect(
      resolveContinuationPointParam2Value(
        { state: packed, param2_value: undefined },
        branchType,
        dim
      )
    ).toBeCloseTo(p2, 12)
    expect(limitCycleProfileNormalizedCoordinates(ntst, ncol)).toEqual([0, 0.5, 1])
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
    expect(serialized.branch_type).toEqual({
      type: 'LimitCycle',
      ntst: 10,
      ncol: 4,
      normalized_mesh: Array.from({ length: 11 }, (_, index) => index / 10),
    })
    expect(serialized.points[1].eigenvalues).toEqual([[3, 4]])
  })

  it('preserves resume_state metadata when serializing branch data', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      data: {
        ...baseBranch.data,
        points: [basePoint, { ...basePoint, param_value: 1 }],
        indices: [0, 1],
        resume_state: {
          max_index_seed: {
            endpoint_index: 1,
            aug_state: [1, 0],
            tangent: [1, 0],
            step_size: 0.02,
          },
        },
      },
    }

    const serialized = serializeBranchDataForWasm(branch)
    expect(serialized.resume_state?.max_index_seed?.step_size).toBe(0.02)
    expect(serialized.resume_state?.max_index_seed?.endpoint_index).toBe(1)
  })

  it('preserves homoc_context metadata when serializing branch data', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      data: {
        ...baseBranch.data,
        points: [basePoint, { ...basePoint, param_value: 1 }],
        indices: [0, 1],
        homoc_context: {
          base_params: [0.1, 0.2],
          param1_index: 0,
          param2_index: 1,
          fixed_time: 1.0,
          fixed_eps0: 0.01,
          fixed_eps1: 0.02,
          basis: {
            stable_q: [1, 0, 0, 1],
            unstable_q: [1, 0, 0, 1],
            dim: 2,
            nneg: 1,
            npos: 1,
          },
        },
      },
    }

    const serialized = serializeBranchDataForWasm(branch)
    expect(serialized.homoc_context?.basis?.dim).toBe(2)
    expect(serialized.homoc_context?.param1_index).toBe(0)
    expect(serialized.homoc_context?.fixed_time).toBe(1)
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

  it('preserves persisted homoclinic event diagnostics during normalization and serialization', () => {
    const homoclinic_events = {
      stable_dimension: 2,
      unstable_dimension: 1,
      discarded_eigenvalues: 0,
      events: [
        {
          kind: 'NNS' as const,
          name: 'Neutral saddle',
          value: -0.25,
          status: 'available' as const,
          reason: null,
        },
        {
          kind: 'IFS' as const,
          name: 'Inclination flip (stable manifold)',
          value: null,
          status: 'unsupported' as const,
          reason: 'adjoint continuation is unavailable',
        },
      ],
    }
    const normalized = normalizeBranchEigenvalues({
      points: [{ ...basePoint, homoclinic_events }],
      bifurcations: [],
      indices: [0],
    })
    expect(normalized.points[0].homoclinic_events).toEqual(homoclinic_events)

    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'homoclinic_curve',
      data: normalized,
    }
    expect(serializeBranchDataForWasm(branch).points[0].homoclinic_events).toEqual(
      homoclinic_events
    )
  })

  it('normalizes and serializes independent heteroclinic endpoint spectra', () => {
    const wireDiagnostics = {
      source_stable_dimension: 1,
      source_unstable_dimension: 3,
      target_stable_dimension: 3,
      target_unstable_dimension: 1,
      source_discarded_eigenvalues: 0,
      target_discarded_eigenvalues: 0,
      source_eigenvalues: [[1, 0]],
      target_eigenvalues: [[-2, 0]],
      inclination_transport: {
        source: {
          ambient_dimension: 3,
          frame_dimension: 1,
          transported_frame: [1, 0, 0],
          reference_frame: [0.8, 0.6, 0],
          minimum_overlap_singular_value: 0.8,
          relative_transport_residual: 2e-9,
        },
        target: {
          ambient_dimension: 3,
          frame_dimension: 1,
          transported_frame: [0, 1, 0],
          reference_frame: [0, -1, 0],
          minimum_overlap_singular_value: 1,
          relative_transport_residual: 3e-9,
        },
      },
      events: [
        {
          kind: 'XRS' as const,
          name: 'Cross-endpoint resonance',
          value: null,
          status: 'unsupported' as const,
          reason: 'a single open connection has no intrinsic analogue',
        },
      ],
    }
    const normalized = normalizeBranchEigenvalues({
      points: [{ ...basePoint, heteroclinic_events: wireDiagnostics as never }],
      bifurcations: [],
      indices: [0],
    })
    expect(normalized.points[0].heteroclinic_events?.source_eigenvalues).toEqual([
      { re: 1, im: 0 },
    ])
    expect(normalized.points[0].heteroclinic_events?.events[0].kind).toBe('XRS')
    expect(
      normalized.points[0].heteroclinic_events?.inclination_transport?.source
        ?.transported_frame
    ).toEqual([1, 0, 0])

    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'heteroclinic_curve',
      data: normalized,
    }
    const serialized = serializeBranchDataForWasm(branch)
    expect(serialized.points[0].heteroclinic_events?.source_eigenvalues).toEqual([[1, 0]])
    expect(serialized.points[0].heteroclinic_events?.target_eigenvalues).toEqual([[-2, 0]])
    expect(serialized.points[0].heteroclinic_events?.inclination_transport).toEqual(
      wireDiagnostics.inclination_transport
    )
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
        branch_type: {
          type: 'LimitCycle',
          ntst: 3,
          ncol: 5,
          normalized_mesh: [0, 0.08, 0.41, 1],
        },
      },
    }

    const serialized = serializeBranchDataForWasm(branch)

    expect(serialized.branch_type).toEqual({
      type: 'LimitCycle',
      ntst: 3,
      ncol: 5,
      normalized_mesh: [0, 0.08, 0.41, 1],
    })
  })

  it('distinguishes uniform and nonuniform normalized collocation meshes', () => {
    expect(isUniformNormalizedCollocationMesh([0, 0.25, 0.5, 0.75, 1])).toBe(true)
    expect(isUniformNormalizedCollocationMesh([0, 0.1, 0.5, 0.75, 1])).toBe(false)
  })

  it('rejects malformed normalized limit-cycle meshes at the WASM boundary', () => {
    const branch: ContinuationObject = {
      ...baseBranch,
      branchType: 'limit_cycle',
      data: {
        ...baseBranch.data,
        branch_type: {
          type: 'LimitCycle',
          ntst: 3,
          ncol: 2,
          normalized_mesh: [0, 0.4, 0.3, 1],
        },
      },
    }

    expect(() => serializeBranchDataForWasm(branch)).toThrow(
      'Limit cycle branch has invalid normalized mesh coordinates.'
    )
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
    expect(formatBifurcationType('HomoclinicNeutralSaddle')).toBe(
      'NNS - Neutral Saddle'
    )
    expect(formatBifurcationType('HomoclinicOrbitFlipStable')).toBe(
      'OFS - Orbit Flip Stable'
    )
    expect(formatBifurcationType('HeteroclinicSourceLeadingCollision')).toBe(
      'SLC - Source Leading-Spectrum Collision'
    )
    expect(formatBifurcationType('HeteroclinicTargetOrbitFlip')).toBe(
      'TOF - Target Orbit Flip'
    )
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

  it('assigns exact nonuniform mesh and Gauss-stage coordinates to the profile', () => {
    const nodes = gaussLegendreNormalizedNodes(2)
    const coordinates = limitCycleProfileNormalizedCoordinates(2, 2, [0, 0.2, 1])
    expect(coordinates).not.toBeNull()
    expect(coordinates).toHaveLength(7)
    expect(coordinates?.[0]).toBe(0)
    expect(coordinates?.[1]).toBeCloseTo(0.2 * nodes[0], 14)
    expect(coordinates?.[2]).toBeCloseTo(0.2 * nodes[1], 14)
    expect(coordinates?.[3]).toBeCloseTo(0.2, 14)
    expect(coordinates?.[4]).toBeCloseTo(0.2 + 0.8 * nodes[0], 14)
    expect(coordinates?.[5]).toBeCloseTo(0.2 + 0.8 * nodes[1], 14)
    expect(coordinates?.[6]).toBe(1)
    expect(limitCycleProfileNormalizedCoordinates(2, 2, [0, 0.4, 0.3])).toBeNull()
  })

  it('extracts a stage-first collocation profile', () => {
    const flatState = [1, 11, 0, 10, 0, 7]
    const result = extractLimitCycleProfile(flatState, 1, 2, 1, {
      layout: 'stage-first',
    })

    expect(result.profilePoints).toEqual([[0], [1], [10], [11], [0]])
    expect(result.period).toBe(7)
  })

  it('canonicalizes explicit codim1 cycle states for mesh-first analysis', () => {
    const stageFirst = [
      // stages
      100, 101, 110, 111,
      // explicit mesh, including the closing point
      10, 11, 20, 21, 10, 11,
      // period
      6,
    ]

    expect(
      canonicalizeLimitCycleStateForAnalysis(stageFirst, 2, 2, 1, 'lpc_curve')
    ).toEqual([
      // explicit mesh
      10, 11, 20, 21, 10, 11,
      // stages
      100, 101, 110, 111,
      // period
      6,
    ])
    expect(
      canonicalizeLimitCycleStateForAnalysis(stageFirst, 2, 2, 1, 'ns_curve')
    ).toEqual([10, 11, 20, 21, 10, 11, 100, 101, 110, 111, 6])
    expect(
      canonicalizeLimitCycleStateForAnalysis(stageFirst, 2, 2, 1, 'isoperiodic_curve')
    ).toEqual([10, 11, 20, 21, 10, 11, 100, 101, 110, 111, 6])
  })

  it('preserves mesh-first limit-cycle and PD analysis states', () => {
    const meshFirstExplicit = [10, 11, 20, 21, 10, 11, 100, 101, 110, 111, 6]
    const meshFirstImplicit = [10, 11, 20, 21, 100, 101, 110, 111, 6]

    expect(
      canonicalizeLimitCycleStateForAnalysis(meshFirstExplicit, 2, 2, 1, 'pd_curve')
    ).toEqual(meshFirstExplicit)
    expect(
      canonicalizeLimitCycleStateForAnalysis(meshFirstImplicit, 2, 2, 1, 'limit_cycle')
    ).toEqual(meshFirstImplicit)
    expect(() =>
      canonicalizeLimitCycleStateForAnalysis(meshFirstImplicit, 2, 2, 1, 'pd_curve')
    ).toThrow(/expected 11/)
    expect(() =>
      canonicalizeLimitCycleStateForAnalysis(meshFirstExplicit, 2, 2, 1, 'limit_cycle')
    ).toThrow(/expected 9/)
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
    expect(
      interpretLimitCycleStability([
        { re: 1, im: 0 },
        { re: -1.005, im: 0 },
      ])
    ).toBe('unstable (1D)')
    expect(
      interpretLimitCycleStability([
        { re: 1.001, im: 0 },
        { re: 1.005, im: 0 },
      ])
    ).toBe('unstable (1D)')
    expect(interpretLimitCycleStability([{ re: 1, im: 0.2 }])).toBe('unknown')
  })
})
