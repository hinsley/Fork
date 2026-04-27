import { describe, expect, it } from 'vitest'
import type { EventSeriesHit } from '../compute/ForkCoreClient'
import { addObject, createSystem, updateNodeRender } from '../system/model'
import type {
  AnalysisViewport,
  OrbitObject,
  System,
  SystemConfig
} from '../system/types'
import {
  buildIdentityLineTrace,
  buildTraceBundleFromHits,
  filterHitsByConstraints,
  mergeIdentityRanges,
  parseAnalysisTracePointMeta
} from './analysisTraceBuilders'

const CONFIG: SystemConfig = {
  name: 'Analysis_Trace_Builder_System',
  equations: ['y', '-x'],
  params: [],
  paramNames: [],
  varNames: ['x', 'y'],
  solver: 'rk4',
  type: 'flow'
}

function buildSystemWithOrbit(): { system: System; sourceId: string } {
  const base = createSystem({ name: CONFIG.name, config: CONFIG })
  const orbit: OrbitObject = {
    type: 'orbit',
    name: 'Orbit_Trace_Target',
    systemName: CONFIG.name,
    data: [
      [0, 0, 1],
      [0.1, 1, 0],
      [0.2, 2, -1]
    ],
    t_start: 0,
    t_end: 0.2,
    dt: 0.1
  }
  const added = addObject(base, orbit)
  const system = updateNodeRender(added.system, added.nodeId, {
    color: '#123456',
    lineWidth: 7,
    lineStyle: 'dashed',
    pointSize: 9
  })
  return { system, sourceId: added.nodeId }
}

function buildViewport(
  overrides: {
    axes?: AnalysisViewport['axes']
    advanced?: Partial<AnalysisViewport['advanced']>
  } = {}
): AnalysisViewport {
  return {
    id: 'analysis-1',
    name: 'Event_Map_1',
    kind: 'return_map',
    axisRanges: {},
    viewRevision: 0,
    sourceNodeIds: [],
    display: 'all',
    event: {
      mode: 'cross_up',
      source: { kind: 'custom', expression: 'x' },
      level: 0,
      positivityConstraints: []
    },
    axes: overrides.axes ?? {
      x: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
      y: { kind: 'hit_index', label: 'n' },
      z: null
    },
    advanced: {
      skipHits: 0,
      hitStride: 1,
      maxHits: 2000,
      connectPoints: false,
      showIdentityLine: true,
      identityLineColor: '#787878',
      identityLineStyle: 'dotted',
      ...overrides.advanced
    }
  }
}

describe('analysisTraceBuilders', () => {
  it('builds 2D event-map traces with render styles and click metadata', () => {
    const { system, sourceId } = buildSystemWithOrbit()
    const viewport = buildViewport({ advanced: { connectPoints: true } })
    const hits: EventSeriesHit[] = [
      {
        order: 2,
        sample_index: 5,
        time: 0.125,
        state: [0.5, 0.25],
        observable_values: [3, 1]
      }
    ]

    const bundle = buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      hits,
      new Map([
        ['x', 0],
        ['constraint', 1]
      ])
    )

    expect(bundle?.identityRange).toBeNull()
    expect(bundle?.traces).toHaveLength(1)
    const trace = bundle?.traces[0] as
      | {
          x?: number[]
          y?: number[]
          mode?: string
          uid?: string
          marker?: { color?: string; size?: number }
          line?: { color?: string; width?: number; dash?: string }
          customdata?: unknown[]
        }
      | undefined
    expect(trace?.x).toEqual([3])
    expect(trace?.y).toEqual([2])
    expect(trace?.mode).toBe('lines+markers')
    expect(trace?.uid).toBe(sourceId)
    expect(trace?.marker).toEqual({ color: '#123456', size: 9 })
    expect(trace?.line).toEqual({
      color: '#123456',
      width: 7,
      dash: 'dash'
    })
    expect(parseAnalysisTracePointMeta(trace?.customdata?.[0])).toEqual({
      hitIndex: 2,
      sampleIndex: 5,
      time: 0.125,
      state: [0.5, 0.25]
    })
  })

  it('filters hits through positive constraint observables', () => {
    const hits: EventSeriesHit[] = [
      {
        order: 0,
        sample_index: 0,
        state: [0],
        observable_values: [1, 2]
      },
      {
        order: 1,
        sample_index: 1,
        state: [1],
        observable_values: [2, -3]
      }
    ]

    expect(
      filterHitsByConstraints(
        hits,
        ['constraint'],
        new Map([
          ['x', 0],
          ['constraint', 1]
        ])
      )
    ).toEqual([hits[0]])
  })

  it('builds reversed cobweb overlays and identity-line ranges', () => {
    const { system, sourceId } = buildSystemWithOrbit()
    const viewport = buildViewport({
      axes: {
        x: { kind: 'observable', expression: 'x', hitOffset: 1, label: 'x@n+1' },
        y: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        z: null
      },
      advanced: {
        connectPoints: true,
        identityLineColor: '#112233',
        identityLineStyle: 'dashed'
      }
    })
    const hits: EventSeriesHit[] = [
      { order: 0, sample_index: 0, state: [0], observable_values: [2] },
      { order: 1, sample_index: 1, state: [1], observable_values: [3] },
      { order: 2, sample_index: 2, state: [2], observable_values: [5] }
    ]

    const bundle = buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      hits,
      new Map([['x', 0]])
    )

    expect(bundle?.identityRange).toEqual([2, 5])
    const cobwebTrace = bundle?.traces.find(
      (trace) => 'name' in trace && trace.name === 'Orbit_Trace_Target cobweb'
    ) as { x?: Array<number | null>; y?: Array<number | null> } | undefined
    const markerTrace = bundle?.traces.find(
      (trace) =>
        'uid' in trace &&
        trace.uid === sourceId &&
        'mode' in trace &&
        trace.mode === 'markers'
    ) as { x?: number[]; y?: number[]; mode?: string } | undefined

    expect(cobwebTrace?.x).toEqual([2, 3, 3, null, 3, 5, 5, null])
    expect(cobwebTrace?.y).toEqual([2, 2, 3, null, 3, 3, 5, null])
    expect(markerTrace?.mode).toBe('markers')
    expect(markerTrace?.x).toEqual([3, 5])
    expect(markerTrace?.y).toEqual([2, 3])

    const identityTrace = buildIdentityLineTrace(viewport, [5, 2]) as {
      x?: number[]
      y?: number[]
      line?: { color?: string; dash?: string }
    }
    expect(identityTrace.x).toEqual([2, 5])
    expect(identityTrace.y).toEqual([2, 5])
    expect(identityTrace.line?.color).toBe('#112233')
    expect(identityTrace.line?.dash).toBe('dash')
    expect(mergeIdentityRanges([[2, 5], [1, 4], null])).toEqual([1, 5])
  })

  it('builds 3D traces without cobweb or identity overlays', () => {
    const { system, sourceId } = buildSystemWithOrbit()
    const viewport = buildViewport({
      axes: {
        x: { kind: 'observable', expression: 'x', hitOffset: 0, label: 'x@n' },
        y: { kind: 'observable', expression: 'x', hitOffset: 1, label: 'x@n+1' },
        z: { kind: 'hit_index', label: 'n' }
      },
      advanced: { connectPoints: true }
    })
    const hits: EventSeriesHit[] = [
      { order: 0, sample_index: 0, state: [0], observable_values: [1] },
      { order: 1, sample_index: 1, state: [1], observable_values: [2] },
      { order: 2, sample_index: 2, state: [2], observable_values: [3] }
    ]

    const bundle = buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      hits,
      new Map([['x', 0]])
    )

    expect(bundle?.identityRange).toBeNull()
    expect(bundle?.traces).toHaveLength(1)
    const trace = bundle?.traces[0] as
      | {
          type?: string
          mode?: string
          x?: number[]
          y?: number[]
          z?: number[]
        }
      | undefined
    expect(trace?.type).toBe('scatter3d')
    expect(trace?.mode).toBe('lines+markers')
    expect(trace?.x).toEqual([1, 2])
    expect(trace?.y).toEqual([2, 3])
    expect(trace?.z).toEqual([0, 1])
  })

  it('rejects invalid trace-point metadata payloads', () => {
    expect(parseAnalysisTracePointMeta('not-json')).toBeNull()
    expect(parseAnalysisTracePointMeta(JSON.stringify({ hitIndex: 1 }))).toBeNull()
    expect(
      parseAnalysisTracePointMeta(
        JSON.stringify({
          hitIndex: 1,
          sampleIndex: 2,
          time: Number.NaN,
          state: ['bad']
        })
      )
    ).toEqual({
      hitIndex: 1,
      sampleIndex: 2,
      time: null,
      state: null
    })
  })
})
