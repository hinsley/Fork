import type { Data } from 'plotly.js'
import { continuationPieceRanges } from '../../system/continuation'
import type {
  ContinuationObject,
  LineStyle,
  RenderStyle,
  System,
} from '../../system/types'
import { normalizeColorOpacity } from '../../system/color'

const LINE_STYLE_DASH = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'dot',
} as const

type TraceArrayKey = 'x' | 'y' | 'z' | 'customdata' | 'text'

function resolveLineDash(style: LineStyle): 'solid' | 'dash' | 'dot' {
  return LINE_STYLE_DASH[style]
}

function hasLineMode(trace: Data): boolean {
  return (
    (trace.type === 'scatter' || trace.type === 'scatter3d') &&
    typeof trace.mode === 'string' &&
    trace.mode.split('+').includes('lines')
  )
}

function numericPointIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function sliceTraceArray(
  values: unknown[],
  includedPositions: readonly number[]
): unknown[] {
  return includedPositions.map((position) => values[position])
}

function trimNullEdges(values: unknown[], positions: number[]): number[] {
  let start = 0
  let end = positions.length
  while (start < end && values[positions[start]] == null) start += 1
  while (end > start && values[positions[end - 1]] == null) end -= 1
  return positions.slice(start, end)
}

function splitTraceForPiece(
  trace: Data,
  startPointIndex: number,
  endPointIndex: number
): Data | null {
  const customdata =
    'customdata' in trace && Array.isArray(trace.customdata)
      ? trace.customdata
      : null
  if (!customdata) return null

  const positions: number[] = []
  for (let position = 0; position < customdata.length; position += 1) {
    const pointIndex = numericPointIndex(customdata[position])
    if (
      pointIndex !== null &&
      pointIndex >= startPointIndex &&
      pointIndex <= endPointIndex
    ) {
      positions.push(position)
      continue
    }
    if (
      customdata[position] == null &&
      positions.length > 0 &&
      position + 1 < customdata.length
    ) {
      const nextPointIndex = numericPointIndex(customdata[position + 1])
      if (
        nextPointIndex !== null &&
        nextPointIndex >= startPointIndex &&
        nextPointIndex <= endPointIndex
      ) {
        positions.push(position)
      }
    }
  }

  const includedPositions = trimNullEdges(customdata, positions)
  if (includedPositions.length === 0) return null

  const next = { ...trace } as Record<string, unknown>
  for (const key of ['x', 'y', 'z', 'customdata', 'text'] as TraceArrayKey[]) {
    const values = next[key]
    if (Array.isArray(values) && values.length === customdata.length) {
      next[key] = sliceTraceArray(values, includedPositions)
    }
  }
  return next as Data
}

function applyPieceStyle(
  trace: Data,
  branchRender: RenderStyle,
  pieceIndex: number
): Data {
  const override = branchRender.continuationPieceOverrides?.[pieceIndex]
  if (!override) return trace
  const color = override.color ?? branchRender.color
  const lineWidth = override.lineWidth ?? branchRender.lineWidth
  const pointSize = override.pointSize ?? branchRender.pointSize
  const lineStyle = override.lineStyle ?? branchRender.lineStyle
  const next = {
    ...trace,
    opacity: normalizeColorOpacity(override.opacity ?? branchRender.opacity),
  } as Data

  if ('line' in next && next.line) {
    next.line = {
      ...next.line,
      color,
      width: lineWidth,
      dash: resolveLineDash(lineStyle),
    }
  }
  if ('marker' in next && next.marker) {
    next.marker = {
      ...next.marker,
      color,
      size: pointSize,
    }
  }
  return next
}

function splitBranchTrace(
  trace: Data,
  branch: ContinuationObject,
  branchRender: RenderStyle
): Data[] {
  const ranges = continuationPieceRanges(
    branch.data.points.length,
    branch.data.bifurcations
  )
  if (
    ranges.length <= 1 ||
    !branchRender.continuationPieceOverrides ||
    Object.keys(branchRender.continuationPieceOverrides).length === 0 ||
    !hasLineMode(trace)
  ) {
    return [trace]
  }

  const customdata =
    'customdata' in trace && Array.isArray(trace.customdata)
      ? trace.customdata
      : null
  if (!customdata?.some((entry) => numericPointIndex(entry) !== null)) {
    return [trace]
  }

  const pieces = ranges
    .map((range) => {
      const pieceTrace = splitTraceForPiece(
        trace,
        range.startPointIndex,
        range.endPointIndex
      )
      if (!pieceTrace) return null
      return applyPieceStyle(pieceTrace, branchRender, range.pieceIndex)
    })
    .filter((entry): entry is Data => entry !== null)

  return pieces.length > 0 ? pieces : [trace]
}

export function applyBranchPieceAppearances(
  traces: Data[],
  nodes: System['nodes'],
  branches: System['branches']
): Data[] {
  return traces.flatMap((trace) => {
    const nodeId =
      'uid' in trace && typeof trace.uid === 'string' ? trace.uid : null
    if (!nodeId) return [trace]
    const node = nodes[nodeId]
    const branch = branches[nodeId]
    if (!node || node.kind !== 'branch' || !branch) return [trace]
    return splitBranchTrace(trace, branch, node.render)
  })
}
