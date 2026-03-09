import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type {
  AnalysisAxisSpec,
  AnalysisViewport,
  ContinuationObject,
  LimitCycleObject,
  OrbitObject,
  SubsystemSnapshot,
  System,
  SystemConfig,
} from '../system/types'
import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
  EventSeriesHit,
  EventSeriesOrderedSample,
} from '../compute/ForkCoreClient'
import { extractLimitCycleProfile, getBranchParams } from '../system/continuation'
import { DEFAULT_RENDER } from '../system/model'
import {
  isSubsystemSnapshotCompatible,
  mapStateRowsToDisplay,
  stateVectorToDisplay,
} from '../system/subsystemGateway'
import { PlotlyViewport, type PlotlyPointClick } from '../viewports/plotly/PlotlyViewport'
import type { PlotlyRelayoutEvent } from '../viewports/plotly/usePlotViewport'
import type { PlotlyThemeTokens } from '../viewports/plotly/plotlyTheme'
import {
  normalizeAnalysisExpressionError,
  resolveAnalysisAxisLabel,
  resolveAnalysisEventExpression,
  resolveAnalysisSourceIds,
} from './analysisViewportUtils'

type AnalysisViewportPlotProps = {
  system: System
  viewport: AnalysisViewport
  selectedNodeId: string | null
  plotlyTheme: PlotlyThemeTokens
  onSelectSource: (id: string) => void
  onComputeEventSeriesFromOrbit?: (
    request: ComputeEventSeriesFromOrbitRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<{ hits: EventSeriesHit[] }>
  onComputeEventSeriesFromSamples?: (
    request: ComputeEventSeriesFromSamplesRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<{ hits: EventSeriesHit[] }>
}

type ComputedTraceState = {
  traces: Data[]
  message: string | null
}

const EMPTY_TRACES: Data[] = []
const LINE_STYLE_DASH = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'dot',
} as const

function appendAxisRangeSnapshot(
  snapshot: PlotlyRelayoutEvent,
  axis: 'xaxis' | 'yaxis' | 'zaxis',
  range: [number, number] | null | undefined,
  is3d: boolean
) {
  const prefix = is3d ? `scene.${axis}` : axis
  if (range === undefined) return
  if (range === null) {
    snapshot[`${prefix}.autorange`] = true
    return
  }
  const start = range[0]
  const end = range[1]
  if (Number.isFinite(start) && Number.isFinite(end)) {
    snapshot[`${prefix}.range`] = [start, end]
  }
}

function buildInitialView(viewport: AnalysisViewport): PlotlyRelayoutEvent | null {
  const snapshot: PlotlyRelayoutEvent = {}
  const is3d = Boolean(viewport.axes.z)
  appendAxisRangeSnapshot(snapshot, 'xaxis', viewport.axisRanges.x, is3d)
  appendAxisRangeSnapshot(snapshot, 'yaxis', viewport.axisRanges.y, is3d)
  if (is3d) {
    appendAxisRangeSnapshot(snapshot, 'zaxis', viewport.axisRanges.z, true)
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null
}

function resolveSourceParams(
  systemConfig: SystemConfig,
  primary?: number[] | null,
  secondary?: number[] | null
): number[] {
  const isValid = (values?: number[] | null): values is number[] =>
    Array.isArray(values) &&
    values.length === systemConfig.params.length &&
    values.every((value) => Number.isFinite(value))
  if (isValid(primary)) return [...primary]
  if (isValid(secondary)) return [...secondary]
  return [...systemConfig.params]
}

function resolveObservableExpressions(viewport: AnalysisViewport): string[] {
  const expressions: string[] = []
  const seen = new Set<string>()
  const axes = [viewport.axes.x, viewport.axes.y, viewport.axes.z].filter(
    (axis): axis is AnalysisAxisSpec => Boolean(axis)
  )
  for (const axis of axes) {
    if (axis.kind !== 'observable') continue
    if (seen.has(axis.expression)) continue
    seen.add(axis.expression)
    expressions.push(axis.expression)
  }
  return expressions
}

function hasBlankObservableExpression(axis: AnalysisAxisSpec | null | undefined): boolean {
  return axis?.kind === 'observable' && axis.expression.trim().length === 0
}

function resolveCompatibleSnapshot(
  systemConfig: SystemConfig,
  snapshot?: SubsystemSnapshot | null
): SubsystemSnapshot | null {
  if (!snapshot) return null
  return isSubsystemSnapshotCompatible(systemConfig, snapshot) ? snapshot : null
}

function resolveLineDash(style: string | undefined): 'solid' | 'dash' | 'dot' {
  return LINE_STYLE_DASH[(style as keyof typeof LINE_STYLE_DASH) ?? 'solid'] ?? 'solid'
}

function resolveManifoldCurveGeometry(
  geometry: ContinuationObject['data']['manifold_geometry'] | undefined
): { dim: number; points_flat: number[] } | null {
  if (!geometry || geometry.type !== 'Curve') return null
  if ('Curve' in geometry && geometry.Curve) {
    return geometry.Curve
  }
  if ('points_flat' in geometry && Array.isArray(geometry.points_flat)) {
    return {
      dim: geometry.dim,
      points_flat: geometry.points_flat,
    }
  }
  return null
}

function buildSamplesFromOrbit(
  systemConfig: SystemConfig,
  orbit: OrbitObject
): EventSeriesOrderedSample[] | null {
  if (orbit.data.length === 0) return null
  const snapshot = resolveCompatibleSnapshot(systemConfig, orbit.subsystemSnapshot)
  let rows = orbit.data
  if (snapshot) {
    rows = mapStateRowsToDisplay(snapshot, orbit.data)
  }
  const dimension = rows[0]?.length ? rows[0].length - 1 : 0
  if (dimension !== systemConfig.varNames.length) {
    return null
  }
  return rows.map((row) => ({
    time: Number.isFinite(row[0]) ? row[0] : null,
    state: row.slice(1),
  }))
}

function buildSamplesFromLimitCycle(
  systemConfig: SystemConfig,
  limitCycle: LimitCycleObject
): EventSeriesOrderedSample[] | null {
  const snapshot = resolveCompatibleSnapshot(systemConfig, limitCycle.subsystemSnapshot)
  const dim = snapshot?.freeVariableNames.length ?? systemConfig.varNames.length
  const { profilePoints, period } = extractLimitCycleProfile(limitCycle.state, dim, limitCycle.ntst, limitCycle.ncol, {
    allowPackedTail: true,
  })
  if (profilePoints.length === 0) return null
  const mappedPoints = snapshot
    ? profilePoints.map((point) => stateVectorToDisplay(snapshot, point))
    : profilePoints.map((point) => [...point])
  if (mappedPoints[0]?.length !== systemConfig.varNames.length) {
    return null
  }
  const denominator = Math.max(mappedPoints.length - 1, 1)
  return mappedPoints.map((state, index) => ({
    time: Number.isFinite(period) ? (period * index) / denominator : index,
    state,
  }))
}

function buildSamplesFromManifold(
  systemConfig: SystemConfig,
  branch: ContinuationObject
): EventSeriesOrderedSample[] | null {
  const geometry = resolveManifoldCurveGeometry(branch.data.manifold_geometry)
  if (!geometry || geometry.dim <= 0) return null
  const snapshot = resolveCompatibleSnapshot(systemConfig, branch.subsystemSnapshot)
  const samples: EventSeriesOrderedSample[] = []
  for (let offset = 0; offset < geometry.points_flat.length; offset += geometry.dim) {
    const point = geometry.points_flat.slice(offset, offset + geometry.dim)
    if (point.length !== geometry.dim) continue
    const state = snapshot ? stateVectorToDisplay(snapshot, point) : point
    if (state.length !== systemConfig.varNames.length) return null
    samples.push({ state })
  }
  return samples.length > 0 ? samples : null
}

function resolveAxisValue(
  axis: AnalysisAxisSpec,
  hits: EventSeriesHit[],
  currentIndex: number,
  observableIndexByExpression: Map<string, number>
): number | null {
  if (!hits[currentIndex]) return null
  if (axis.kind === 'observable') {
    const targetHit = hits[currentIndex + axis.hitOffset]
    if (!targetHit) return null
    const observableIndex = observableIndexByExpression.get(axis.expression)
    if (observableIndex === undefined) return null
    const value = targetHit.observable_values[observableIndex]
    return Number.isFinite(value) ? value : null
  }
  if (axis.kind === 'hit_index') {
    const order = hits[currentIndex]?.order
    return Number.isFinite(order) ? order : currentIndex
  }
  const currentTime = hits[currentIndex + axis.hitOffset]?.time
  const nextTime = hits[currentIndex + axis.hitOffset + 1]?.time
  if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime)) return null
  return (nextTime as number) - (currentTime as number)
}

function buildTraceFromHits(
  system: System,
  viewport: AnalysisViewport,
  sourceId: string,
  hits: EventSeriesHit[],
  observableIndexByExpression: Map<string, number>
): Data | null {
  const node = system.nodes[sourceId]
  if (!node) return null
  const render = { ...DEFAULT_RENDER, ...(node.render ?? {}) }
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  const customdata: number[] = []
  const skipHits = Math.max(0, Math.trunc(viewport.advanced.skipHits))
  const hitStride = Math.max(1, Math.trunc(viewport.advanced.hitStride))
  const maxHits = Math.max(1, Math.trunc(viewport.advanced.maxHits))
  const zAxis = viewport.axes.z ?? null

  for (
    let hitIndex = skipHits, plotted = 0;
    hitIndex < hits.length && plotted < maxHits;
    hitIndex += hitStride
  ) {
    const xValue = resolveAxisValue(viewport.axes.x, hits, hitIndex, observableIndexByExpression)
    const yValue = resolveAxisValue(viewport.axes.y, hits, hitIndex, observableIndexByExpression)
    const zValue = zAxis
      ? resolveAxisValue(zAxis, hits, hitIndex, observableIndexByExpression)
      : null
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
    if (zAxis && !Number.isFinite(zValue)) continue
    x.push(xValue as number)
    y.push(yValue as number)
    if (zAxis) {
      z.push(zValue as number)
    }
    customdata.push(hits[hitIndex]?.order ?? hitIndex)
    plotted += 1
  }

  if (x.length === 0) return null

  const axisLabels = {
    x: resolveAnalysisAxisLabel(viewport.axes.x),
    y: resolveAnalysisAxisLabel(viewport.axes.y),
    z: zAxis ? resolveAnalysisAxisLabel(zAxis) : null,
  }
  const hovertemplate = zAxis
    ? `${axisLabels.x}: %{x}<br>${axisLabels.y}: %{y}<br>${axisLabels.z}: %{z}<br>hit: %{customdata}<extra>${node.name}</extra>`
    : `${axisLabels.x}: %{x}<br>${axisLabels.y}: %{y}<br>hit: %{customdata}<extra>${node.name}</extra>`

  if (zAxis) {
    return {
      type: 'scatter3d',
      mode: viewport.advanced.connectPoints ? 'lines+markers' : 'markers',
      uid: sourceId,
      name: node.name,
      x,
      y,
      z,
      customdata,
      hovertemplate,
      marker: {
        color: render.color,
        size: render.pointSize,
      },
      line: {
        color: render.color,
        width: render.lineWidth,
        dash: resolveLineDash(render.lineStyle),
      },
    } satisfies Data
  }

  return {
    type: 'scattergl',
    mode: viewport.advanced.connectPoints ? 'lines+markers' : 'markers',
    uid: sourceId,
    name: node.name,
    x,
    y,
    customdata,
    hovertemplate,
    marker: {
      color: render.color,
      size: render.pointSize,
    },
    line: {
      color: render.color,
      width: render.lineWidth,
      dash: resolveLineDash(render.lineStyle),
    },
  } satisfies Data
}

function buildLayout(
  viewport: AnalysisViewport,
  plotlyTheme: PlotlyThemeTokens,
  message: string | null,
  hasData: boolean
): Partial<Layout> {
  const xLabel = resolveAnalysisAxisLabel(viewport.axes.x)
  const yLabel = resolveAnalysisAxisLabel(viewport.axes.y)
  const zAxis = viewport.axes.z ?? null
  const annotations: NonNullable<Layout['annotations']> = message
    ? [
        {
          text: message,
          x: 0.5,
          y: 0.5,
          xref: 'paper' as const,
          yref: 'paper' as const,
          showarrow: false,
          font: { color: plotlyTheme.muted, size: 12 },
        },
      ]
    : []
  const base = {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: plotlyTheme.background,
    plot_bgcolor: plotlyTheme.background,
    font: { color: plotlyTheme.text },
    showlegend: hasData,
    legend: {
      font: { color: plotlyTheme.text },
      itemclick: false,
      itemdoubleclick: false,
    },
    annotations,
  } satisfies Partial<Layout>

  if (zAxis) {
    return {
      ...base,
      scene: {
        xaxis: {
          title: { text: xLabel, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        yaxis: {
          title: { text: yLabel, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        zaxis: {
          title: { text: resolveAnalysisAxisLabel(zAxis), font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        bgcolor: plotlyTheme.background,
        aspectmode: 'cube',
      },
    }
  }

  return {
    ...base,
    dragmode: 'pan',
    xaxis: {
      title: { text: xLabel, font: { color: plotlyTheme.text } },
      tickfont: { color: plotlyTheme.text },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      automargin: true,
    },
    yaxis: {
      title: { text: yLabel, font: { color: plotlyTheme.text } },
      tickfont: { color: plotlyTheme.text },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      automargin: true,
    },
  }
}

function buildSourceSignature(system: System, sourceId: string): Record<string, unknown> {
  const object = system.objects[sourceId]
  if (object?.type === 'orbit') {
    return {
      id: sourceId,
      type: object.type,
      rows: object.data.length,
      dt: object.dt,
      tStart: object.t_start,
      tEnd: object.t_end,
      params: object.customParameters ?? object.parameters ?? null,
      frozen: object.frozenVariables?.frozenValuesByVarName ?? null,
      snapshot: object.subsystemSnapshot?.hash ?? null,
    }
  }
  if (object?.type === 'limit_cycle') {
    return {
      id: sourceId,
      type: object.type,
      ntst: object.ntst,
      ncol: object.ncol,
      period: object.period,
      stateLength: object.state.length,
      params: object.customParameters ?? object.parameters ?? null,
      frozen: object.frozenVariables?.frozenValuesByVarName ?? null,
      snapshot: object.subsystemSnapshot?.hash ?? null,
    }
  }
  const branch = system.branches[sourceId]
  if (branch?.branchType === 'eq_manifold_1d') {
    const geometry = resolveManifoldCurveGeometry(branch.data.manifold_geometry)
    return {
      id: sourceId,
      type: branch.branchType,
      points: geometry?.points_flat.length ?? 0,
      dim: geometry?.dim ?? 0,
      params: branch.params ?? null,
      snapshot: branch.subsystemSnapshot?.hash ?? null,
    }
  }
  return { id: sourceId, type: 'unknown' }
}

async function computeSourceTrace(
  system: System,
  viewport: AnalysisViewport,
  sourceId: string,
  eventExpression: string,
  observableExpressions: string[],
  signal: AbortSignal,
  handlers: Pick<
    AnalysisViewportPlotProps,
    'onComputeEventSeriesFromOrbit' | 'onComputeEventSeriesFromSamples'
  >
): Promise<Data | null> {
  const systemConfig = system.config
  const observableIndexByExpression = new Map(
    observableExpressions.map((expression, index) => [expression, index])
  )
  const object = system.objects[sourceId]

  if (object?.type === 'orbit') {
    const params = resolveSourceParams(systemConfig, object.customParameters, object.parameters)
    const runConfig = { ...systemConfig, params }
    const snapshot = resolveCompatibleSnapshot(systemConfig, object.subsystemSnapshot)
    const canUseExact =
      Boolean(handlers.onComputeEventSeriesFromOrbit) &&
      object.data.length > 0 &&
      (!snapshot || snapshot.freeVariableNames.length === systemConfig.varNames.length)

    const result = canUseExact
      ? await handlers.onComputeEventSeriesFromOrbit!({
          system: runConfig,
          initialState: object.data[0].slice(1),
          startTime: object.t_start,
          steps: Math.max(object.data.length - 1, 1),
          dt: object.dt,
          mode: viewport.event.mode,
          eventExpression,
          eventLevel: viewport.event.level,
          observableExpressions,
        }, { signal })
      : await handlers.onComputeEventSeriesFromSamples!({
          system: runConfig,
          samples: buildSamplesFromOrbit(systemConfig, object) ?? [],
          mode: viewport.event.mode,
          eventExpression,
          eventLevel: viewport.event.level,
          observableExpressions,
        }, { signal })

    return buildTraceFromHits(system, viewport, sourceId, result.hits, observableIndexByExpression)
  }

  if (object?.type === 'limit_cycle') {
    if (!handlers.onComputeEventSeriesFromSamples) return null
    const params = resolveSourceParams(systemConfig, object.customParameters, object.parameters)
    const samples = buildSamplesFromLimitCycle(systemConfig, object)
    if (!samples || samples.length === 0) return null
    const result = await handlers.onComputeEventSeriesFromSamples(
      {
        system: { ...systemConfig, params },
        samples,
        mode: viewport.event.mode,
        eventExpression,
        eventLevel: viewport.event.level,
        observableExpressions,
      },
      { signal }
    )
    return buildTraceFromHits(system, viewport, sourceId, result.hits, observableIndexByExpression)
  }

  const branch = system.branches[sourceId]
  if (branch?.branchType === 'eq_manifold_1d') {
    if (!handlers.onComputeEventSeriesFromSamples) return null
    const samples = buildSamplesFromManifold(systemConfig, branch)
    if (!samples || samples.length === 0) return null
    const result = await handlers.onComputeEventSeriesFromSamples(
      {
        system: { ...systemConfig, params: getBranchParams(system, branch) },
        samples,
        mode: viewport.event.mode,
        eventExpression,
        eventLevel: viewport.event.level,
        observableExpressions,
      },
      { signal }
    )
    return buildTraceFromHits(system, viewport, sourceId, result.hits, observableIndexByExpression)
  }

  return null
}

export function AnalysisViewportPlot({
  system,
  viewport,
  selectedNodeId,
  plotlyTheme,
  onSelectSource,
  onComputeEventSeriesFromOrbit,
  onComputeEventSeriesFromSamples,
}: AnalysisViewportPlotProps) {
  const eventExpression = useMemo(
    () => resolveAnalysisEventExpression(system.config, viewport.event),
    [system.config, viewport.event]
  )
  const sourceIds = useMemo(
    () => resolveAnalysisSourceIds(system, viewport, selectedNodeId),
    [selectedNodeId, system, viewport]
  )
  const signature = useMemo(
    () =>
      JSON.stringify({
        viewport,
        selectedNodeId: viewport.display === 'selection' ? selectedNodeId : null,
        systemType: system.config.type,
        equations: system.config.equations,
        varNames: system.config.varNames,
        paramNames: system.config.paramNames,
        params: system.config.params,
        eventExpression,
        sources: sourceIds.map((sourceId) => buildSourceSignature(system, sourceId)),
      }),
    [eventExpression, selectedNodeId, sourceIds, system, viewport]
  )
  const cacheRef = useRef(new Map<string, ComputedTraceState>())
  const [traceState, setTraceState] = useState<ComputedTraceState>(() => {
    return cacheRef.current.get(signature) ?? { traces: EMPTY_TRACES, message: null }
  })

  useEffect(() => {
    const cached = cacheRef.current.get(signature)
    if (cached) {
      setTraceState(cached)
      return
    }

    if (!onComputeEventSeriesFromSamples) {
      const next = {
        traces: EMPTY_TRACES,
        message: 'Analysis computation is unavailable in this build.',
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    if (viewport.event.mode !== 'every_iterate' && eventExpression.trim().length === 0) {
      const next = {
        traces: EMPTY_TRACES,
        message: 'Event expression is required.',
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    if (
      hasBlankObservableExpression(viewport.axes.x) ||
      hasBlankObservableExpression(viewport.axes.y) ||
      hasBlankObservableExpression(viewport.axes.z)
    ) {
      const next = {
        traces: EMPTY_TRACES,
        message: 'Observable axis expressions are required.',
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    if (sourceIds.length === 0) {
      const next = {
        traces: EMPTY_TRACES,
        message:
          viewport.display === 'selection'
            ? 'Select an orbit, limit cycle, or 1D manifold source to populate this view.'
            : 'No compatible visible sources are available for this analysis viewport.',
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setTraceState({ traces: EMPTY_TRACES, message: 'Computing event map…' })

    void Promise.allSettled(
          sourceIds.map((sourceId) =>
            computeSourceTrace(
              system,
              viewport,
              sourceId,
              eventExpression,
              resolveObservableExpressions(viewport),
              controller.signal,
          {
            onComputeEventSeriesFromOrbit,
            onComputeEventSeriesFromSamples,
          }
        )
      )
    )
      .then((results) => {
        if (cancelled) return
        const traces = results
          .filter((result): result is PromiseFulfilledResult<Data | null> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((trace): trace is Data => Boolean(trace))
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        const next: ComputedTraceState = {
          traces,
          message:
            traces.length > 0
              ? null
              : rejected
                ? rejected.reason instanceof Error
                  ? normalizeAnalysisExpressionError(rejected.reason.message)
                  : String(rejected.reason)
                : 'No event hits matched the current source, event, and axis settings.',
        }
        setTraceState(next)
        cacheRef.current.set(signature, next)
      })
      .catch((error) => {
        if (cancelled) return
        if (error instanceof Error && error.name === 'AbortError') return
        const next = {
          traces: EMPTY_TRACES,
          message:
            error instanceof Error
              ? normalizeAnalysisExpressionError(error.message)
              : String(error),
        }
        setTraceState(next)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    onComputeEventSeriesFromOrbit,
    onComputeEventSeriesFromSamples,
    eventExpression,
    signature,
    sourceIds,
    system,
    viewport,
  ])

  const layout = useMemo(
    () => buildLayout(viewport, plotlyTheme, traceState.message, traceState.traces.length > 0),
    [plotlyTheme, traceState.message, traceState.traces.length, viewport]
  )
  const initialView = useMemo(() => buildInitialView(viewport), [viewport])
  const handlePointClick = useCallback(
    (point: PlotlyPointClick) => {
      if (typeof point.uid === 'string') {
        onSelectSource(point.uid)
      }
    },
    [onSelectSource]
  )

  return (
    <PlotlyViewport
      plotId={viewport.id}
      data={traceState.traces}
      layout={layout}
      viewRevision={viewport.viewRevision}
      persistView
      initialView={initialView}
      testId={`plotly-viewport-${viewport.id}`}
      onPointClick={traceState.traces.length > 0 ? handlePointClick : undefined}
    />
  )
}
