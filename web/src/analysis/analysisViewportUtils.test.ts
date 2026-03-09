import { describe, expect, it } from 'vitest'
import { addAnalysisViewport, addBranch, addObject, createSystem } from '../system/model'
import type { ContinuationObject, LimitCycleObject, OrbitObject } from '../system/types'
import {
  collectAnalysisSourceEntries,
  resolveAnalysisAxisLabel,
  resolveAnalysisSourceIds,
} from './analysisViewportUtils'

const BASE_SETTINGS = {
  step_size: 0.1,
  min_step_size: 0.01,
  max_step_size: 0.2,
  max_steps: 10,
  corrector_steps: 4,
  corrector_tolerance: 1e-6,
  step_tolerance: 1e-6,
} as const

describe('analysisViewportUtils', () => {
  it('collects compatible sources and resolves fallback selection rules', () => {
    const base = createSystem({ name: 'Analysis Utils' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: base.name,
      data: [
        [0, 0, 0],
        [0.1, 1, 1],
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
    }
    const withOrbit = addObject(base, orbit)

    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'Cycle A',
      systemName: base.name,
      origin: { type: 'orbit', orbitId: withOrbit.nodeId, orbitName: 'Orbit A' },
      ntst: 2,
      ncol: 2,
      period: 1,
      state: [0, 0, 1, 0, 0, 1],
      createdAt: new Date().toISOString(),
    }
    const withCycle = addObject(withOrbit.system, limitCycle)

    const manifold: ContinuationObject = {
      type: 'continuation',
      name: 'Stable_1D',
      systemName: base.name,
      parameterName: 'p',
      parentObject: withOrbit.nodeId,
      startObject: withOrbit.nodeId,
      branchType: 'eq_manifold_1d',
      data: {
        points: [],
        bifurcations: [],
        indices: [],
        manifold_geometry: {
          type: 'Curve',
          dim: 2,
          points_flat: [0, 0, 1, 1],
          arclength: [0, 1],
          direction: 'Plus',
        },
      },
      settings: BASE_SETTINGS,
      timestamp: new Date().toISOString(),
    }
    const withManifold = addBranch(withCycle.system, manifold, withOrbit.nodeId)
    const incompatibleBranch: ContinuationObject = {
      ...manifold,
      name: 'Hopf_Curve',
      branchType: 'hopf_curve',
      data: { points: [], bifurcations: [], indices: [] },
    }
    const withBranch = addBranch(withManifold.system, incompatibleBranch, withOrbit.nodeId)
    withBranch.system.nodes[withCycle.nodeId]!.visibility = false

    const entries = collectAnalysisSourceEntries(withBranch.system)
    expect(entries.map((entry) => ({ name: entry.name, type: entry.typeLabel, visible: entry.visible }))).toEqual([
      { name: 'Cycle A', type: 'Limit cycle', visible: false },
      { name: 'Orbit A', type: 'Orbit', visible: true },
      { name: 'Stable_1D', type: '1D manifold', visible: true },
    ])

    const { system: withViewport, nodeId: viewportId } = addAnalysisViewport(withBranch.system, 'Return Map')
    const viewport = withViewport.analysisViewports.find((entry) => entry.id === viewportId)
    expect(viewport).toBeTruthy()
    expect(resolveAnalysisSourceIds(withViewport, viewport!, null)).toEqual([
      withOrbit.nodeId,
      withManifold.nodeId,
    ])

    expect(
      resolveAnalysisSourceIds(
        withViewport,
        { ...viewport!, display: 'selection' },
        withManifold.nodeId
      )
    ).toEqual([withManifold.nodeId])

    expect(
      resolveAnalysisSourceIds(
        withViewport,
        { ...viewport!, sourceNodeIds: [withCycle.nodeId, withBranch.nodeId, withOrbit.nodeId] },
        null
      )
    ).toEqual([withCycle.nodeId, withOrbit.nodeId])
  })

  it('formats implicit axis labels', () => {
    expect(
      resolveAnalysisAxisLabel({
        kind: 'observable',
        expression: 'sigma',
        hitOffset: 1,
      })
    ).toBe('sigma@n+1')
    expect(resolveAnalysisAxisLabel({ kind: 'hit_index' })).toBe('Hit index')
    expect(resolveAnalysisAxisLabel({ kind: 'delta_time' })).toBe('Delta t')
  })
})
