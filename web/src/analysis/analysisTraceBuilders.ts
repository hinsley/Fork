import type { Data } from 'plotly.js'
import type { EventSeriesHit } from '../compute/ForkCoreClient'
import { DEFAULT_RENDER } from '../system/model'
import type { AnalysisAxisSpec, AnalysisViewport, System } from '../system/types'
import {
  resolveAnalysisAxisLabelForSystem,
  resolveAnalysisCobwebAxes
} from './analysisViewportUtils'

export type AnalysisTraceBundle = {
  traces: Data[]
  identityRange: [number, number] | null
}

export type AnalysisTracePointMeta = {
  hitIndex: number
  sampleIndex: number
  time: number | null
  state: number[] | null
}

const LINE_STYLE_DASH = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'dot'
} as const

export function parseAnalysisTracePointMeta(
  value: unknown
): AnalysisTracePointMeta | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as Partial<AnalysisTracePointMeta>
    if (
      typeof parsed.hitIndex !== 'number' ||
      !Number.isFinite(parsed.hitIndex) ||
      typeof parsed.sampleIndex !== 'number' ||
      !Number.isFinite(parsed.sampleIndex)
    ) {
      return null
    }
    return {
      hitIndex: parsed.hitIndex,
      sampleIndex: parsed.sampleIndex,
      time:
        typeof parsed.time === 'number' && Number.isFinite(parsed.time)
          ? parsed.time
          : null,
      state:
        Array.isArray(parsed.state) &&
        parsed.state.every((entry) => typeof entry === 'number')
          ? [...parsed.state]
          : null
    }
  } catch {
    return null
  }
}

function resolveLineDash(style: string | undefined): 'solid' | 'dash' | 'dot' {
  return (
    LINE_STYLE_DASH[(style as keyof typeof LINE_STYLE_DASH) ?? 'solid'] ??
    'solid'
  )
}

function resolveIdentityRange(
  x: readonly number[],
  y: readonly number[]
): [number, number] | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of [...x, ...y]) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.02, 1e-6)
    return [min - padding, max + padding]
  }
  return [min, max]
}

export function mergeIdentityRanges(
  ranges: Array<[number, number] | null>
): [number, number] | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const range of ranges) {
    if (!range) continue
    min = Math.min(min, range[0], range[1])
    max = Math.max(max, range[0], range[1])
  }
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null
}

function buildCobwebTraceFromPoints(
  x: readonly number[],
  y: readonly number[],
  options: {
    sourceId: string
    name: string
    color: string
    lineWidth: number
    lineDash: 'solid' | 'dash' | 'dot'
    earlierAxis: 'x' | 'y'
  }
): Data | null {
  const cobwebX: Array<number | null> = []
  const cobwebY: Array<number | null> = []

  for (let index = 0; index < x.length; index += 1) {
    const xValue = x[index]
    const yValue = y[index]
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
    if (options.earlierAxis === 'x') {
      cobwebX.push(xValue, xValue, yValue, null)
      cobwebY.push(xValue, yValue, yValue, null)
    } else {
      cobwebX.push(yValue, xValue, xValue, null)
      cobwebY.push(yValue, yValue, xValue, null)
    }
  }

  if (cobwebX.length === 0) return null

  return {
    type: 'scattergl',
    mode: 'lines',
    uid: options.sourceId,
    name: `${options.name} cobweb`,
    x: cobwebX,
    y: cobwebY,
    line: {
      color: options.color,
      width: options.lineWidth,
      dash: options.lineDash
    },
    hoverinfo: 'skip',
    showlegend: false
  } satisfies Data
}

export function buildIdentityLineTrace(
  viewport: AnalysisViewport,
  range: [number, number]
): Data {
  const min = Math.min(range[0], range[1])
  const max = Math.max(range[0], range[1])
  return {
    type: 'scattergl',
    mode: 'lines',
    name: 'Identity line',
    x: [min, max],
    y: [min, max],
    line: {
      color: viewport.advanced.identityLineColor,
      width: 1.5,
      dash: resolveLineDash(viewport.advanced.identityLineStyle)
    },
    hoverinfo: 'skip',
    showlegend: false
  } satisfies Data
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

export function buildTraceBundleFromHits(
  system: System,
  viewport: AnalysisViewport,
  sourceId: string,
  hits: EventSeriesHit[],
  observableIndexByExpression: Map<string, number>
): AnalysisTraceBundle | null {
  const node = system.nodes[sourceId]
  if (!node) return null
  const render = { ...DEFAULT_RENDER, ...(node.render ?? {}) }
  const lineDash = resolveLineDash(render.lineStyle)
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  const customdata: string[] = []
  const text: string[] = []
  const skipHits = Math.max(0, Math.trunc(viewport.advanced.skipHits))
  const hitStride = Math.max(1, Math.trunc(viewport.advanced.hitStride))
  const maxHits = Math.max(1, Math.trunc(viewport.advanced.maxHits))
  const zAxis = viewport.axes.z ?? null
  const cobwebAxes = resolveAnalysisCobwebAxes(viewport)

  for (
    let hitIndex = skipHits, plotted = 0;
    hitIndex < hits.length && plotted < maxHits;
    hitIndex += hitStride
  ) {
    const xValue = resolveAxisValue(
      viewport.axes.x,
      hits,
      hitIndex,
      observableIndexByExpression
    )
    const yValue = resolveAxisValue(
      viewport.axes.y,
      hits,
      hitIndex,
      observableIndexByExpression
    )
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
    const hit = hits[hitIndex]
    const hitIndexValue = hit?.order ?? hitIndex
    customdata.push(
      JSON.stringify({
        hitIndex: hitIndexValue,
        sampleIndex: hit?.sample_index ?? hitIndexValue,
        time:
          typeof hit?.time === 'number' && Number.isFinite(hit.time)
            ? hit.time
            : null,
        state: Array.isArray(hit?.state) ? hit.state : null
      } satisfies AnalysisTracePointMeta)
    )
    text.push(String(hitIndexValue))
    plotted += 1
  }

  if (x.length === 0) return null

  const axisLabels = {
    x: resolveAnalysisAxisLabelForSystem(viewport.axes.x, system.config.type),
    y: resolveAnalysisAxisLabelForSystem(viewport.axes.y, system.config.type),
    z: zAxis
      ? resolveAnalysisAxisLabelForSystem(zAxis, system.config.type)
      : null
  }
  const hovertemplate = zAxis
    ? `${axisLabels.x}: %{x}<br>${axisLabels.y}: %{y}<br>${axisLabels.z}: %{z}<br>hit: %{text}<extra>${node.name}</extra>`
    : `${axisLabels.x}: %{x}<br>${axisLabels.y}: %{y}<br>hit: %{text}<extra>${node.name}</extra>`

  if (zAxis) {
    return {
      traces: [
        {
          type: 'scatter3d',
          mode: viewport.advanced.connectPoints ? 'lines+markers' : 'markers',
          uid: sourceId,
          name: node.name,
          x,
          y,
          z,
          customdata,
          text,
          hovertemplate,
          marker: {
            color: render.color,
            size: render.pointSize
          },
          line: {
            color: render.color,
            width: render.lineWidth,
            dash: lineDash
          }
        } satisfies Data
      ],
      identityRange: null
    }
  }

  const traces: Data[] = []
  if (cobwebAxes && viewport.advanced.connectPoints) {
    const cobwebTrace = buildCobwebTraceFromPoints(x, y, {
      sourceId,
      name: node.name,
      color: render.color,
      lineWidth: render.lineWidth,
      lineDash,
      earlierAxis: cobwebAxes.earlierAxis
    })
    if (cobwebTrace) {
      traces.push(cobwebTrace)
    }
  }

  traces.push({
    type: 'scattergl',
    mode: cobwebAxes
      ? 'markers'
      : viewport.advanced.connectPoints
        ? 'lines+markers'
        : 'markers',
    uid: sourceId,
    name: node.name,
    x,
    y,
    customdata,
    text,
    hovertemplate,
    marker: {
      color: render.color,
      size: render.pointSize
    },
    line: {
      color: render.color,
      width: render.lineWidth,
      dash: lineDash
    }
  } satisfies Data)

  return {
    traces,
    identityRange: cobwebAxes ? resolveIdentityRange(x, y) : null
  }
}

export function filterHitsByConstraints(
  hits: EventSeriesHit[],
  constraintExpressions: string[],
  observableIndexByExpression: Map<string, number>
): EventSeriesHit[] {
  if (constraintExpressions.length === 0) return hits
  return hits.filter((hit) =>
    constraintExpressions.every((expression) => {
      const observableIndex = observableIndexByExpression.get(expression)
      if (observableIndex === undefined) return false
      const value = hit.observable_values[observableIndex]
      return Number.isFinite(value) && value > 0
    })
  )
}
