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
  SystemConfig
} from '../system/types'
import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
  EventSeriesHit,
  EventSeriesOrderedSample
} from '../compute/ForkCoreClient'
import {
  extractLimitCycleProfile,
  getBranchParams
} from '../system/continuation'
import {
  isSubsystemSnapshotCompatible,
  mapStateRowsToDisplay,
  stateVectorToDisplay
} from '../system/subsystemGateway'
import {
  PlotlyViewport,
  type PlotlyPointClick
} from '../viewports/plotly/PlotlyViewport'
import type { PlotlyRelayoutEvent } from '../viewports/plotly/usePlotViewport'
import type { PlotlyThemeTokens } from '../viewports/plotly/plotlyTheme'
import {
  normalizeAnalysisExpressionError,
  resolveAnalysisCobwebAxes,
  resolveAnalysisAxisLabelForSystem,
  resolveAnalysisConstraintExpressions,
  resolveAnalysisEventExpression,
  resolveAnalysisSourceIds
} from './analysisViewportUtils'
import {
  buildIdentityLineTrace,
  buildTraceBundleFromHits,
  filterHitsByConstraints,
  mergeIdentityRanges,
  parseAnalysisTracePointMeta,
  type AnalysisTraceBundle
} from './analysisTraceBuilders'

type AnalysisViewportPlotProps = {
  system: System
  viewport: AnalysisViewport
  selectedNodeId: string | null
  plotlyTheme: PlotlyThemeTokens
  onSelectSource: (id: string) => void
  onSelectOrbitPoint?: (selection: {
    orbitId: string
    pointIndex: number
    hitIndex?: number | null
    time?: number | null
    state?: number[] | null
  }) => void
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

function buildInitialView(
  viewport: AnalysisViewport
): PlotlyRelayoutEvent | null {
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

function resolveConstraintExpressions(viewport: AnalysisViewport): string[] {
  const expressions: string[] = []
  const seen = new Set<string>()
  for (const expression of resolveAnalysisConstraintExpressions(
    viewport.event
  )) {
    if (seen.has(expression)) continue
    seen.add(expression)
    expressions.push(expression)
  }
  return expressions
}

function combineRequestedExpressions(
  observableExpressions: string[],
  constraintExpressions: string[]
): string[] {
  const requested = [...observableExpressions]
  const seen = new Set(requested)
  for (const expression of constraintExpressions) {
    if (seen.has(expression)) continue
    seen.add(expression)
    requested.push(expression)
  }
  return requested
}

function hasBlankObservableExpression(
  axis: AnalysisAxisSpec | null | undefined
): boolean {
  return axis?.kind === 'observable' && axis.expression.trim().length === 0
}

function hasBlankConstraintExpression(viewport: AnalysisViewport): boolean {
  return resolveAnalysisConstraintExpressions(viewport.event).some(
    (expression) => expression.trim().length === 0
  )
}

function resolveCompatibleSnapshot(
  systemConfig: SystemConfig,
  snapshot?: SubsystemSnapshot | null
): SubsystemSnapshot | null {
  if (!snapshot) return null
  return isSubsystemSnapshotCompatible(systemConfig, snapshot) ? snapshot : null
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
      points_flat: geometry.points_flat
    }
  }
  return null
}

function buildSamplesFromOrbit(
  systemConfig: SystemConfig,
  orbit: OrbitObject
): EventSeriesOrderedSample[] | null {
  if (orbit.data.length === 0) return null
  const snapshot = resolveCompatibleSnapshot(
    systemConfig,
    orbit.subsystemSnapshot
  )
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
    state: row.slice(1)
  }))
}

function buildSamplesFromLimitCycle(
  systemConfig: SystemConfig,
  limitCycle: LimitCycleObject
): EventSeriesOrderedSample[] | null {
  const snapshot = resolveCompatibleSnapshot(
    systemConfig,
    limitCycle.subsystemSnapshot
  )
  const dim = snapshot?.freeVariableNames.length ?? systemConfig.varNames.length
  const { profilePoints, period } = extractLimitCycleProfile(
    limitCycle.state,
    dim,
    limitCycle.ntst,
    limitCycle.ncol,
    {
      allowPackedTail: true
    }
  )
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
    state
  }))
}

function buildSamplesFromManifold(
  systemConfig: SystemConfig,
  branch: ContinuationObject
): EventSeriesOrderedSample[] | null {
  const geometry = resolveManifoldCurveGeometry(branch.data.manifold_geometry)
  if (!geometry || geometry.dim <= 0) return null
  const snapshot = resolveCompatibleSnapshot(
    systemConfig,
    branch.subsystemSnapshot
  )
  const samples: EventSeriesOrderedSample[] = []
  for (
    let offset = 0;
    offset < geometry.points_flat.length;
    offset += geometry.dim
  ) {
    const point = geometry.points_flat.slice(offset, offset + geometry.dim)
    if (point.length !== geometry.dim) continue
    const state = snapshot ? stateVectorToDisplay(snapshot, point) : point
    if (state.length !== systemConfig.varNames.length) return null
    samples.push({ state })
  }
  return samples.length > 0 ? samples : null
}

function buildLayout(
  system: System,
  viewport: AnalysisViewport,
  plotlyTheme: PlotlyThemeTokens,
  message: string | null,
  hasData: boolean
): Partial<Layout> {
  const xLabel = resolveAnalysisAxisLabelForSystem(
    viewport.axes.x,
    system.config.type
  )
  const yLabel = resolveAnalysisAxisLabelForSystem(
    viewport.axes.y,
    system.config.type
  )
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
          font: { color: plotlyTheme.muted, size: 12 }
        }
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
      itemdoubleclick: false
    },
    annotations
  } satisfies Partial<Layout>

  if (zAxis) {
    return {
      ...base,
      scene: {
        xaxis: {
          title: { text: xLabel, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)'
        },
        yaxis: {
          title: { text: yLabel, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)'
        },
        zaxis: {
          title: {
            text: resolveAnalysisAxisLabelForSystem(zAxis, system.config.type),
            font: { color: plotlyTheme.text }
          },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)'
        },
        bgcolor: plotlyTheme.background,
        aspectmode: 'cube'
      }
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
      automargin: true
    },
    yaxis: {
      title: { text: yLabel, font: { color: plotlyTheme.text } },
      tickfont: { color: plotlyTheme.text },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      automargin: true
    }
  }
}

function hashNumberSequence(values: Iterable<number>): string {
  let hash = 0x811c9dc5
  let count = 0
  for (const value of values) {
    const normalized = Number.isFinite(value)
      ? Object.is(value, -0)
        ? '-0'
        : String(value)
      : Number.isNaN(value)
        ? 'NaN'
        : value > 0
          ? 'Infinity'
          : '-Infinity'
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    hash ^= 0x2c
    hash = Math.imul(hash, 0x01000193)
    count += 1
  }
  return `${count}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function hashMatrixRows(rows: readonly number[][]): string {
  return hashNumberSequence(rows.flat())
}

function buildSourceSignature(
  system: System,
  sourceId: string
): Record<string, unknown> {
  const node = system.nodes[sourceId]
  const nodeSignature = {
    name: node?.name ?? null,
    render: node?.render ?? null
  }
  const object = system.objects[sourceId]
  if (object?.type === 'orbit') {
    return {
      id: sourceId,
      type: object.type,
      rows: object.data.length,
      dt: object.dt,
      tStart: object.t_start,
      tEnd: object.t_end,
      dataHash: hashMatrixRows(object.data),
      params: object.customParameters ?? object.parameters ?? null,
      frozen: object.frozenVariables?.frozenValuesByVarName ?? null,
      snapshot: object.subsystemSnapshot?.hash ?? null,
      node: nodeSignature
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
      stateHash: hashNumberSequence(object.state),
      params: object.customParameters ?? object.parameters ?? null,
      frozen: object.frozenVariables?.frozenValuesByVarName ?? null,
      snapshot: object.subsystemSnapshot?.hash ?? null,
      node: nodeSignature
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
      pointsHash: geometry ? hashNumberSequence(geometry.points_flat) : null,
      params: branch.params ?? null,
      snapshot: branch.subsystemSnapshot?.hash ?? null,
      node: nodeSignature
    }
  }
  return { id: sourceId, type: 'unknown', node: nodeSignature }
}

async function computeSourceTrace(
  system: System,
  viewport: AnalysisViewport,
  sourceId: string,
  eventExpression: string,
  requestedExpressions: string[],
  constraintExpressions: string[],
  signal: AbortSignal,
  handlers: Pick<
    AnalysisViewportPlotProps,
    'onComputeEventSeriesFromOrbit' | 'onComputeEventSeriesFromSamples'
  >
): Promise<AnalysisTraceBundle | null> {
  const systemConfig = system.config
  const observableIndexByExpression = new Map(
    requestedExpressions.map((expression, index) => [expression, index])
  )
  const object = system.objects[sourceId]

  if (object?.type === 'orbit') {
    const params = resolveSourceParams(
      systemConfig,
      object.customParameters,
      object.parameters
    )
    const runConfig = { ...systemConfig, params }
    const snapshot = resolveCompatibleSnapshot(
      systemConfig,
      object.subsystemSnapshot
    )
    const canUseExact =
      Boolean(handlers.onComputeEventSeriesFromOrbit) &&
      object.data.length > 0 &&
      (!snapshot ||
        snapshot.freeVariableNames.length === systemConfig.varNames.length)

    const result = canUseExact
      ? await handlers.onComputeEventSeriesFromOrbit!(
          {
            system: runConfig,
            initialState: object.data[0].slice(1),
            startTime: object.t_start,
            steps: Math.max(object.data.length - 1, 1),
            dt: object.dt,
            mode: viewport.event.mode,
            eventExpression,
            eventLevel: viewport.event.level,
            observableExpressions: requestedExpressions
          },
          { signal }
        )
      : await handlers.onComputeEventSeriesFromSamples!(
          {
            system: runConfig,
            samples: buildSamplesFromOrbit(systemConfig, object) ?? [],
            mode: viewport.event.mode,
            eventExpression,
            eventLevel: viewport.event.level,
            observableExpressions: requestedExpressions
          },
          { signal }
        )

    return buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      filterHitsByConstraints(
        result.hits,
        constraintExpressions,
        observableIndexByExpression
      ),
      observableIndexByExpression
    )
  }

  if (object?.type === 'limit_cycle') {
    if (!handlers.onComputeEventSeriesFromSamples) return null
    const params = resolveSourceParams(
      systemConfig,
      object.customParameters,
      object.parameters
    )
    const samples = buildSamplesFromLimitCycle(systemConfig, object)
    if (!samples || samples.length === 0) return null
    const result = await handlers.onComputeEventSeriesFromSamples(
      {
        system: { ...systemConfig, params },
        samples,
        mode: viewport.event.mode,
        eventExpression,
        eventLevel: viewport.event.level,
        observableExpressions: requestedExpressions
      },
      { signal }
    )
    return buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      filterHitsByConstraints(
        result.hits,
        constraintExpressions,
        observableIndexByExpression
      ),
      observableIndexByExpression
    )
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
        observableExpressions: requestedExpressions
      },
      { signal }
    )
    return buildTraceBundleFromHits(
      system,
      viewport,
      sourceId,
      filterHitsByConstraints(
        result.hits,
        constraintExpressions,
        observableIndexByExpression
      ),
      observableIndexByExpression
    )
  }

  return null
}

export function AnalysisViewportPlot({
  system,
  viewport,
  selectedNodeId,
  plotlyTheme,
  onSelectSource,
  onSelectOrbitPoint,
  onComputeEventSeriesFromOrbit,
  onComputeEventSeriesFromSamples
}: AnalysisViewportPlotProps) {
  const eventExpression = useMemo(
    () => resolveAnalysisEventExpression(system.config, viewport.event),
    [system.config, viewport.event]
  )
  const observableExpressions = useMemo(
    () => resolveObservableExpressions(viewport),
    [viewport]
  )
  const constraintExpressions = useMemo(
    () => resolveConstraintExpressions(viewport),
    [viewport]
  )
  const requestedExpressions = useMemo(
    () =>
      combineRequestedExpressions(observableExpressions, constraintExpressions),
    [constraintExpressions, observableExpressions]
  )
  const sourceIds = useMemo(
    () => resolveAnalysisSourceIds(system, viewport, selectedNodeId),
    [selectedNodeId, system, viewport]
  )
  const signature = useMemo(
    () =>
      JSON.stringify({
        viewport,
        selectedNodeId:
          viewport.display === 'selection' ? selectedNodeId : null,
        systemType: system.config.type,
        equations: system.config.equations,
        varNames: system.config.varNames,
        paramNames: system.config.paramNames,
        params: system.config.params,
        eventExpression,
        sources: sourceIds.map((sourceId) =>
          buildSourceSignature(system, sourceId)
        )
      }),
    [eventExpression, selectedNodeId, sourceIds, system, viewport]
  )
  const cacheRef = useRef(new Map<string, ComputedTraceState>())
  const [traceState, setTraceState] = useState<ComputedTraceState>({
    traces: EMPTY_TRACES,
    message: null
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
        message: 'Analysis computation is unavailable in this build.'
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    if (
      viewport.event.mode !== 'every_iterate' &&
      eventExpression.trim().length === 0
    ) {
      const next = {
        traces: EMPTY_TRACES,
        message: 'Event expression is required.'
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
        message: 'Observable axis expressions are required.'
      }
      setTraceState(next)
      cacheRef.current.set(signature, next)
      return
    }

    if (hasBlankConstraintExpression(viewport)) {
      const next = {
        traces: EMPTY_TRACES,
        message: 'Constraint expressions are required.'
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
            : 'No compatible visible sources are available for this analysis viewport.'
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
          requestedExpressions,
          constraintExpressions,
          controller.signal,
          {
            onComputeEventSeriesFromOrbit,
            onComputeEventSeriesFromSamples
          }
        )
      )
    )
      .then((results) => {
        if (cancelled) return
        const bundles = results
          .filter(
            (
              result
            ): result is PromiseFulfilledResult<AnalysisTraceBundle | null> =>
              result.status === 'fulfilled'
          )
          .map((result) => result.value)
          .filter((bundle): bundle is AnalysisTraceBundle => Boolean(bundle))
        const sourceTraces = bundles.flatMap((bundle) => bundle.traces)
        const traces = [...sourceTraces]
        const identityRange =
          viewport.advanced.showIdentityLine &&
          resolveAnalysisCobwebAxes(viewport)
            ? mergeIdentityRanges(bundles.map((bundle) => bundle.identityRange))
            : null
        if (identityRange) {
          traces.unshift(buildIdentityLineTrace(viewport, identityRange))
        }
        const rejected = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        )
        const next: ComputedTraceState = {
          traces,
          message:
            sourceTraces.length > 0
              ? null
              : rejected
                ? rejected.reason instanceof Error
                  ? normalizeAnalysisExpressionError(rejected.reason.message)
                  : String(rejected.reason)
                : 'No event hits matched the current source, event, and axis settings.'
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
              : String(error)
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
    constraintExpressions,
    observableExpressions,
    requestedExpressions,
    signature,
    sourceIds,
    system,
    viewport
  ])

  const layout = useMemo(
    () =>
      buildLayout(
        system,
        viewport,
        plotlyTheme,
        traceState.message,
        traceState.traces.length > 0
      ),
    [
      plotlyTheme,
      system,
      traceState.message,
      traceState.traces.length,
      viewport
    ]
  )
  const initialView = useMemo(() => buildInitialView(viewport), [viewport])
  const handlePointClick = useCallback(
    (point: PlotlyPointClick) => {
      if (typeof point.uid !== 'string') return
      onSelectSource(point.uid)
      const node = system.nodes[point.uid]
      const object = system.objects[point.uid]
      if (node?.kind !== 'object' || object?.type !== 'orbit') return
      const metadata = parseAnalysisTracePointMeta(point.customdata)
      if (!metadata) return
      onSelectOrbitPoint?.({
        orbitId: point.uid,
        pointIndex: Math.max(0, Math.round(metadata.sampleIndex)),
        hitIndex:
          typeof metadata.hitIndex === 'number' &&
          Number.isFinite(metadata.hitIndex)
            ? Math.max(0, Math.round(metadata.hitIndex))
            : null,
        time:
          typeof metadata.time === 'number' && Number.isFinite(metadata.time)
            ? metadata.time
            : null,
        state: Array.isArray(metadata.state) ? [...metadata.state] : null
      })
    },
    [onSelectOrbitPoint, onSelectSource, system.nodes, system.objects]
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
