import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Data, Layout } from 'plotly.js'
import type {
  AxisRange,
  BifurcationAxis,
  BifurcationDiagram,
  ClvRenderStyle,
  ContinuationObject,
  ContinuationPoint,
  EquilibriumEigenPair,
  IsoclineComputedSnapshot,
  LineStyle,
  OrbitObject,
  SceneAxisVariables,
  SystemConfig,
  System,
  Scene,
  TreeNode,
} from '../system/types'
import type {
  ComputeIsoclineResult,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
} from '../compute/ForkCoreClient'
import {
  buildSortedArrayOrder,
  ensureBranchIndices,
  extractLimitCycleProfile,
  formatBifurcationLabel,
  getBranchParams,
  resolveContinuationPointParam2Value,
  type LimitCycleProfileLayout,
} from '../system/continuation'
import { resolveClvRender } from '../system/clv'
import { DEFAULT_RENDER } from '../system/model'
import {
  EIGENVECTOR_COLOR_PALETTE,
  isRealEigenvalue,
  resolveEquilibriumEigenspaceIndices,
  resolveEquilibriumEigenvectorRender,
} from '../system/equilibriumEigenvectors'
import { resolveSceneAxisIndices, resolveSceneAxisSelection } from '../system/sceneAxes'
import { PlotlyViewport, type PlotlyPointClick } from '../viewports/plotly/PlotlyViewport'
import type { PlotlyRelayoutEvent } from '../viewports/plotly/usePlotViewport'
import { resolvePlotlyThemeTokens, type PlotlyThemeTokens } from '../viewports/plotly/plotlyTheme'
import { confirmDelete, getDeleteKindLabel } from './confirmDelete'
import { clampMenuX } from './contextMenu'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from './branchPointSelection'

type ViewportPanelProps = {
  system: System
  selectedNodeId: string | null
  branchPointSelection?: BranchPointSelection
  theme: 'light' | 'dark'
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
  onSelectBranchPoint?: (selection: BranchPointSelection) => void
  onSelectOrbitPoint?: (selection: OrbitPointSelection) => void
  onSelectLimitCyclePoint?: (selection: LimitCyclePointSelection) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeViewport: (id: string, height: number) => void
  onToggleViewport: (id: string) => void
  onCreateScene: (targetId?: string | null) => void
  onCreateBifurcation: (targetId?: string | null) => void
  onRenameViewport: (id: string, name: string) => void
  onDeleteViewport: (id: string) => void
  onSampleMap1DFunction?: (
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<SampleMap1DFunctionResult>
  isoclineGeometryCache?: Record<
    string,
    {
      signature: string
      geometry: ComputeIsoclineResult
    }
  >
}

type ViewportEntry = {
  node: TreeNode
  scene?: Scene
  diagram?: BifurcationDiagram
}

type ViewportTileProps = {
  system: System
  entry: ViewportEntry
  selectedNodeId: string | null
  branchPointSelection?: BranchPointSelection
  mapRange: [number, number] | null
  mapFunctionSamples: MapFunctionSamples | null
  draggingId: string | null
  dragOverId: string | null
  setDraggingId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
  onSelectBranchPoint?: (selection: BranchPointSelection) => void
  onSelectOrbitPoint?: (selection: OrbitPointSelection) => void
  onSelectLimitCyclePoint?: (selection: LimitCyclePointSelection) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeStart: (id: string, event: React.PointerEvent) => void
  onToggleViewport: (id: string) => void
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void
  isEditing: boolean
  draftName: string
  onDraftNameChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  plotlyTheme: PlotlyThemeTokens
  isoclineGeometryCache?: Record<
    string,
    {
      signature: string
      geometry: ComputeIsoclineResult
    }
  >
}

function resolvePointIndex(point: PlotlyPointClick): number | null {
  if (typeof point.customdata !== 'number' || !Number.isFinite(point.customdata)) {
    return null
  }
  return Math.max(0, Math.round(point.customdata))
}

const LINE_STYLE_DASH: Record<LineStyle, 'solid' | 'dash' | 'dot'> = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'dot',
}

function resolveLineDash(lineStyle: LineStyle | undefined): 'solid' | 'dash' | 'dot' {
  return LINE_STYLE_DASH[lineStyle ?? 'solid']
}

function resolveStateSpaceStride(value?: number | null): number {
  if (!Number.isFinite(value)) return 1
  const rounded = Math.round(value as number)
  return rounded >= 1 ? rounded : 1
}

type TimeSeriesViewportMeta = {
  yRange?: [number, number] | null
  height?: number | null
}

type MapFunctionSamples = {
  key: string
  range: [number, number]
  x: number[]
  y: number[]
}

const MIN_VIEWPORT_HEIGHT = 200
const CLV_HEAD_RATIO = 0.25
const COBWEB_DIAGONAL_COLOR = 'rgba(120,120,120,0.45)'
const COBWEB_FUNCTION_COLOR = '#6f7a89'
const MAP_FUNCTION_SAMPLE_COUNT = 256
const EMPTY_TRACES: Data[] = []

function interpolateOrbitState(
  times: number[],
  states: Array<[number, number, number]>,
  t: number
): [number, number, number] {
  if (times.length === 0) return [0, 0, 0]
  if (t <= times[0]) return states[0]
  const lastIndex = times.length - 1
  if (t >= times[lastIndex]) return states[lastIndex]

  let low = 0
  let high = lastIndex
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (times[mid] < t) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  const idx = Math.max(1, low)
  const t0 = times[idx - 1]
  const t1 = times[idx]
  const weight = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
  const [x0, y0, z0] = states[idx - 1]
  const [x1, y1, z1] = states[idx]
  return [
    x0 + (x1 - x0) * weight,
    y0 + (y1 - y0) * weight,
    z0 + (z1 - z0) * weight,
  ]
}

function buildCobwebPath(rows: number[][]): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  if (rows.length < 2) return { x, y }

  for (let i = 0; i < rows.length - 1; i += 1) {
    const x0 = rows[i]?.[1]
    const x1 = rows[i + 1]?.[1]
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue
    if (x.length === 0) {
      x.push(x0)
      y.push(x0)
    }
    x.push(x0)
    y.push(x1)
    x.push(x1)
    y.push(x1)
  }
  return { x, y }
}

function buildCobwebLineTrace(
  rows: number[][],
  options: { name: string; uid: string; color: string; lineWidth: number }
): Data | null {
  const cobweb = buildCobwebPath(rows)
  if (cobweb.x.length === 0) return null
  return {
    type: 'scatter',
    mode: 'lines',
    name: options.name,
    uid: options.uid,
    x: cobweb.x,
    y: cobweb.y,
    line: { color: options.color, width: options.lineWidth },
    hoverinfo: 'skip',
    showlegend: false,
  }
}

function buildCobwebRowsFromStates(
  states: number[][],
  options?: { closeCycle?: boolean }
): number[][] {
  const rows = states.map((state, index) => [index, state[0]])
  if (options?.closeCycle && states.length > 1) {
    const firstValue = states[0]?.[0]
    if (Number.isFinite(firstValue)) {
      rows.push([states.length, firstValue])
    }
  }
  return rows
}

function buildCobwebBaseTraces(
  range: [number, number] | null,
  samples?: { x: number[]; y: number[] } | null
): Data[] {
  if (!range) return []
  const min = Math.min(range[0], range[1])
  const max = Math.max(range[0], range[1])
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []

  const traces: Data[] = []
  if (samples && samples.x.length > 0 && samples.y.length > 0) {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: samples.x,
      y: samples.y,
      line: { color: COBWEB_FUNCTION_COLOR, width: 1.5 },
      hoverinfo: 'skip',
      showlegend: false,
    })
  }

  traces.push({
    type: 'scatter',
    mode: 'lines',
    x: [min, max],
    y: [min, max],
    line: { color: COBWEB_DIAGONAL_COLOR, width: 1, dash: 'dot' },
    hoverinfo: 'skip',
    showlegend: false,
  })

  return traces
}

type PlotSize = { width: number; height: number }

type SceneBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

const EIGENVECTOR_DISC_SEGMENTS = 48
const EIGENVECTOR_DISC_OPACITY = 0.18
const EIGENVECTOR_ORTHO_EPS = 1e-9

function buildClvTraces(
  nodeId: string,
  orbit: OrbitObject,
  clv: ClvRenderStyle,
  axisIndices: [number, number, number] | null,
  plotSize?: PlotSize | null
): Data[] {
  const covariant = orbit.covariantVectors
  if (!covariant || covariant.vectors.length === 0) return []
  if (orbit.data.length === 0) return []
  const orbitDim = orbit.data[0]?.length ? orbit.data[0].length - 1 : 0
  const plotDim = Math.min(covariant.dim, orbitDim)
  if (plotDim < 2) return []
  if (clv.vectorIndices.length === 0) return []

  const use3d = plotDim >= 3
  const fallbackAxes: [number, number, number] = [0, 1, 2]
  const axes =
    use3d &&
    axisIndices &&
    axisIndices.every((index) => index >= 0 && index < orbitDim)
      ? axisIndices
      : fallbackAxes
  const axisX = axes[0]
  const axisY = axes[1]
  const axisZ = axes[2]
  const orbitTimes: number[] = []
  const orbitStates: Array<[number, number, number]> = []
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const row of orbit.data) {
    if (row.length < (use3d ? 4 : 3)) continue
    const x = row[axisX + 1]
    const y = row[axisY + 1]
    const z = use3d ? row[axisZ + 1] : 0
    orbitTimes.push(row[0])
    orbitStates.push([x, y, z])
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  if (orbitTimes.length === 0) return []
  const dx = maxX - minX
  const dy = maxY - minY
  const dz = use3d ? maxZ - minZ : 0
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const hasAspectScale =
    !use3d &&
    plotSize &&
    Number.isFinite(plotSize.width) &&
    Number.isFinite(plotSize.height) &&
    plotSize.width > 0 &&
    plotSize.height > 0 &&
    Number.isFinite(dx) &&
    Number.isFinite(dy) &&
    dx > 0 &&
    dy > 0
  const scaleX = hasAspectScale ? plotSize.width / dx : 1
  const scaleY = hasAspectScale ? plotSize.height / dy : 1
  const diagPixels = hasAspectScale
    ? Math.sqrt(plotSize.width * plotSize.width + plotSize.height * plotSize.height)
    : diag
  const length = clv.lengthScale * diagPixels
  if (!Number.isFinite(length) || length <= 0) return []

  const headLength = length * CLV_HEAD_RATIO * clv.headScale
  const shaftLength = Math.max(0, length - headLength)
  const showHeads = headLength > 0
  const stride = Math.max(1, Math.floor(clv.stride))
  const stepCount = Math.min(covariant.times.length, covariant.vectors.length)
  const traces: Data[] = []

  clv.vectorIndices.forEach((vectorIndex, colorIndex) => {
    const lineX: Array<number | null> = []
    const lineY: Array<number | null> = []
    const lineZ: Array<number | null> = []
    const headLineX: Array<number | null> = []
    const headLineY: Array<number | null> = []
    const headX: number[] = []
    const headY: number[] = []
    const headZ: number[] = []
    const headU: number[] = []
    const headV: number[] = []
    const headW: number[] = []
    const color = clv.colors[colorIndex] ?? '#1f77b4'

    for (let idx = 0; idx < stepCount; idx += stride) {
      const vectorsAtStep = covariant.vectors[idx]
      if (!vectorsAtStep || !vectorsAtStep[vectorIndex]) continue
      const vec = vectorsAtStep[vectorIndex]
      const vx = vec[axisX]
      const vy = vec[axisY]
      const vz = use3d ? vec[axisZ] : 0
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || (use3d && !Number.isFinite(vz))) {
        continue
      }
      const norm = use3d
        ? Math.sqrt(vx * vx + vy * vy + vz * vz)
        : Math.sqrt(
            (vx * scaleX) * (vx * scaleX) + (vy * scaleY) * (vy * scaleY)
          )
      if (!Number.isFinite(norm) || norm === 0) continue

      const base = interpolateOrbitState(orbitTimes, orbitStates, covariant.times[idx])
      const ux = vx / norm
      const uy = vy / norm
      const uz = vz / norm
      const shaftX = base[0] + ux * shaftLength
      const shaftY = base[1] + uy * shaftLength
      const shaftZ = base[2] + uz * shaftLength

      lineX.push(base[0], shaftX, null)
      lineY.push(base[1], shaftY, null)
      if (use3d) {
        lineZ.push(base[2], shaftZ, null)
      }

      const headBaseX = shaftX
      const headBaseY = shaftY
      const headBaseZ = shaftZ
      if (showHeads) {
        if (use3d) {
          headX.push(headBaseX)
          headY.push(headBaseY)
          headZ.push(headBaseZ)
          headU.push(ux)
          headV.push(uy)
          headW.push(uz)
        } else {
          const tipX = headBaseX + ux * headLength
          const tipY = headBaseY + uy * headLength
          const wingScale = headLength * 0.5
          const uxScreen = ux * scaleX
          const uyScreen = uy * scaleY
          const perpX = hasAspectScale ? -uyScreen / scaleX : -uy
          const perpY = hasAspectScale ? uxScreen / scaleY : ux
          const leftX = headBaseX + perpX * wingScale
          const leftY = headBaseY + perpY * wingScale
          const rightX = headBaseX - perpX * wingScale
          const rightY = headBaseY - perpY * wingScale
          headLineX.push(tipX, leftX, null, tipX, rightX, null)
          headLineY.push(tipY, leftY, null, tipY, rightY, null)
        }
      }
    }

    if (lineX.length > 0) {
      if (use3d) {
        traces.push({
          type: 'scatter3d',
          mode: 'lines',
          x: lineX,
          y: lineY,
          z: lineZ,
          uid: nodeId,
          line: {
            color,
            width: clv.thickness,
          },
          showlegend: false,
          hoverinfo: 'none',
        })
      } else {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: lineX,
          y: lineY,
          uid: nodeId,
          line: {
            color,
            width: clv.thickness,
          },
          showlegend: false,
          hoverinfo: 'none',
        })
      }
    }

    if (showHeads) {
      if (use3d && headX.length > 0) {
        traces.push({
          type: 'cone',
          x: headX,
          y: headY,
          z: headZ,
          u: headU,
          v: headV,
          w: headW,
          uid: nodeId,
          anchor: 'tail',
          // Use raw sizing to avoid per-trace scaling differences between CLVs.
          sizemode: 'raw',
          sizeref: headLength,
          colorscale: [
            [0, color],
            [1, color],
          ],
          showscale: false,
          hoverinfo: 'none',
        } as Data)
      }
      if (!use3d && headLineX.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: headLineX,
          y: headLineY,
          uid: nodeId,
          line: {
            color,
            width: clv.thickness,
          },
          showlegend: false,
          hoverinfo: 'none',
        })
      }
    }
  })

  return traces
}

type PendingEigenvector = {
  nodeId: string
  state: number[]
  eigenpairs: EquilibriumEigenPair[]
  vectorIndices: number[]
  colors: string[]
  lineLengthScale: number
  lineThickness: number
  discRadiusScale: number
  discThickness: number
  highlight: boolean
  axisIndices: [number, number, number] | null
}

function updateSceneBounds(bounds: SceneBounds, x: number, y: number, z?: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  const safeZ = typeof z === 'number' && Number.isFinite(z) ? z : 0
  bounds.minX = Math.min(bounds.minX, x)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxY = Math.max(bounds.maxY, y)
  bounds.minZ = Math.min(bounds.minZ, safeZ)
  bounds.maxZ = Math.max(bounds.maxZ, safeZ)
}

function buildEquilibriumEigenvectorTraces(
  entry: PendingEigenvector,
  bounds: SceneBounds,
  plotSize?: PlotSize | null
): Data[] {
  if (entry.state.length < 2 || entry.eigenpairs.length === 0) return []
  const plotDim = entry.state.length >= 3 ? 3 : 2
  const use3d = plotDim === 3
  const fallbackAxes: [number, number, number] = [0, 1, 2]
  const axes =
    entry.axisIndices &&
    entry.axisIndices.every((index) => index >= 0 && index < entry.state.length)
      ? entry.axisIndices
      : fallbackAxes
  const axisX = axes[0]
  const axisY = axes[1]
  const axisZ = axes[2]
  const stateX = entry.state[axisX]
  const stateY = entry.state[axisY]
  const stateZ = use3d ? entry.state[axisZ] : 0
  if (!Number.isFinite(stateX) || !Number.isFinite(stateY) || (use3d && !Number.isFinite(stateZ))) {
    return []
  }

  const dx = bounds.maxX - bounds.minX
  const dy = bounds.maxY - bounds.minY
  const dz = use3d ? bounds.maxZ - bounds.minZ : 0
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const fallbackScale = Math.max(
    1,
    Math.abs(stateX),
    Math.abs(stateY),
    use3d ? Math.abs(stateZ) : 0
  )
  const baseDiag = Number.isFinite(diag) && diag > 0 ? diag : fallbackScale
  const hasAspectScale =
    !use3d &&
    plotSize &&
    Number.isFinite(plotSize.width) &&
    Number.isFinite(plotSize.height) &&
    plotSize.width > 0 &&
    plotSize.height > 0 &&
    Number.isFinite(dx) &&
    Number.isFinite(dy) &&
    dx > 0 &&
    dy > 0
  const scaleX = hasAspectScale ? plotSize.width / dx : 1
  const scaleY = hasAspectScale ? plotSize.height / dy : 1
  const diagPixels = hasAspectScale
    ? Math.sqrt(plotSize.width * plotSize.width + plotSize.height * plotSize.height)
    : baseDiag
  const lineLength = entry.lineLengthScale * diagPixels
  const discRadius = entry.discRadiusScale * diagPixels
  const lineHalfLength = lineLength * 0.5

  const baseLineWidth = Number.isFinite(entry.lineThickness)
    ? Math.max(0.5, entry.lineThickness)
    : 1
  const lineWidth = entry.highlight ? baseLineWidth + 1 : baseLineWidth
  const baseDiscWidth = Number.isFinite(entry.discThickness)
    ? Math.max(0.5, entry.discThickness)
    : 1
  const discLineWidth = entry.highlight ? baseDiscWidth + 1 : baseDiscWidth
  const traces: Data[] = []

  const colorWithAlpha = (value: string, alpha: number) => {
    if (!value.startsWith('#')) return value
    const raw = value.slice(1)
    if (raw.length !== 6 && raw.length !== 3) return value
    const digits =
      raw.length === 3
        ? raw.split('').map((char) => char.repeat(2)).join('')
        : raw
    const r = Number.parseInt(digits.slice(0, 2), 16)
    const g = Number.parseInt(digits.slice(2, 4), 16)
    const b = Number.parseInt(digits.slice(4, 6), 16)
    if (![r, g, b].every(Number.isFinite)) return value
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const dot = (a: number[], b: number[]) =>
    a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)
  const norm = (vec: number[]) => Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0))
  const normalize = (vec: number[]) => {
    const magnitude = norm(vec)
    if (!Number.isFinite(magnitude) || magnitude <= EIGENVECTOR_ORTHO_EPS) return null
    return vec.map((value) => value / magnitude)
  }
  const subtractScaled = (vec: number[], basis: number[], scale: number) =>
    vec.map((value, index) => value - (basis[index] ?? 0) * scale)
  const orthonormalize = (a: number[], b: number[]) => {
    const normA = norm(a)
    const normB = norm(b)
    if (normA <= EIGENVECTOR_ORTHO_EPS && normB <= EIGENVECTOR_ORTHO_EPS) return null
    const primary = normB > normA ? b : a
    const secondary = normB > normA ? a : b
    const u = normalize(primary)
    if (!u) return null
    const projection = dot(secondary, u)
    const vRaw = subtractScaled(secondary, u, projection)
    const v = normalize(vRaw)
    if (!v) return null
    return { u, v }
  }

  const pushLine = (ux: number, uy: number, uz: number, color: string) => {
    const x0 = stateX - ux * lineHalfLength
    const x1 = stateX + ux * lineHalfLength
    const y0 = stateY - uy * lineHalfLength
    const y1 = stateY + uy * lineHalfLength
    const z0 = stateZ - uz * lineHalfLength
    const z1 = stateZ + uz * lineHalfLength
    if (use3d) {
      traces.push({
        type: 'scatter3d',
        mode: 'lines',
        uid: entry.nodeId,
        x: [x0, x1],
        y: [y0, y1],
        z: [z0, z1],
        line: { color, width: lineWidth },
        showlegend: false,
        hoverinfo: 'none',
      })
    } else {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        uid: entry.nodeId,
        x: [x0, x1],
        y: [y0, y1],
        line: { color, width: lineWidth },
        showlegend: false,
        hoverinfo: 'none',
      })
    }
  }

  const pushDisc = (u: number[], v: number[], color: string) => {
    const ringX: number[] = []
    const ringY: number[] = []
    const ringZ: number[] = []
    for (let idx = 0; idx <= EIGENVECTOR_DISC_SEGMENTS; idx += 1) {
      const theta = (idx / EIGENVECTOR_DISC_SEGMENTS) * Math.PI * 2
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      ringX.push(stateX + discRadius * (u[0] * cos + v[0] * sin))
      ringY.push(stateY + discRadius * (u[1] * cos + v[1] * sin))
      ringZ.push(stateZ + discRadius * ((u[2] ?? 0) * cos + (v[2] ?? 0) * sin))
    }
    if (use3d) {
      const meshX = [stateX, ...ringX.slice(0, -1)]
      const meshY = [stateY, ...ringY.slice(0, -1)]
      const meshZ = [stateZ, ...ringZ.slice(0, -1)]
      const i: number[] = []
      const j: number[] = []
      const k: number[] = []
      const ringCount = meshX.length - 1
      for (let idx = 1; idx <= ringCount; idx += 1) {
        const next = idx < ringCount ? idx + 1 : 1
        i.push(0)
        j.push(idx)
        k.push(next)
      }
      const iTyped = Uint32Array.from(i)
      const jTyped = Uint32Array.from(j)
      const kTyped = Uint32Array.from(k)
      traces.push({
        type: 'mesh3d',
        uid: entry.nodeId,
        x: meshX,
        y: meshY,
        z: meshZ,
        i: iTyped,
        j: jTyped,
        k: kTyped,
        color,
        opacity: EIGENVECTOR_DISC_OPACITY,
        flatshading: true,
        showscale: false,
        hoverinfo: 'none',
      } as Data)
      traces.push({
        type: 'scatter3d',
        mode: 'lines',
        uid: entry.nodeId,
        x: ringX,
        y: ringY,
        z: ringZ,
        line: { color, width: discLineWidth },
        showlegend: false,
        hoverinfo: 'none',
      })
    } else {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        uid: entry.nodeId,
        x: ringX,
        y: ringY,
        fill: 'toself',
        fillcolor: colorWithAlpha(color, EIGENVECTOR_DISC_OPACITY),
        line: { color, width: discLineWidth },
        showlegend: false,
        hoverinfo: 'none',
      })
    }
  }

  const resolveEigenlineDirection = (real: number[], imag: number[]) => {
    if (!Number.isFinite(lineLength) || lineLength <= 0) return null
    const realNorm = use3d
      ? norm(real)
      : Math.sqrt((real[0] * scaleX) ** 2 + (real[1] * scaleY) ** 2)
    const imagNorm = use3d
      ? norm(imag)
      : Math.sqrt((imag[0] * scaleX) ** 2 + (imag[1] * scaleY) ** 2)
    const useReal = realNorm >= imagNorm
    const components = useReal ? real : imag
    const componentNorm = useReal ? realNorm : imagNorm
    if (!Number.isFinite(componentNorm) || componentNorm <= 0) return null
    return {
      ux: components[0] / componentNorm,
      uy: components[1] / componentNorm,
      uz: use3d ? (components[2] ?? 0) / componentNorm : 0,
    }
  }

  entry.vectorIndices.forEach((vectorIndex, colorIndex) => {
    const pair = entry.eigenpairs[vectorIndex]
    if (!pair) return
    const axisOrder = use3d ? [axisX, axisY, axisZ] : [axisX, axisY]
    if (axisOrder.some((index) => index >= pair.vector.length)) return
    const real = axisOrder.map((index) => pair.vector[index]?.re ?? Number.NaN)
    const imag = axisOrder.map((index) => pair.vector[index]?.im ?? Number.NaN)
    if (!real.every(Number.isFinite) || !imag.every(Number.isFinite)) return
    const paletteIndex = vectorIndex % EIGENVECTOR_COLOR_PALETTE.length
    const color = entry.colors[colorIndex] ?? EIGENVECTOR_COLOR_PALETTE[paletteIndex]

    if (!isRealEigenvalue(pair.value)) {
      if (discRadius > 0) {
        const basis = orthonormalize(real, imag)
        if (basis) {
          pushDisc(basis.u, basis.v, color)
        } else {
          const direction = resolveEigenlineDirection(real, imag)
          if (direction) {
            pushLine(direction.ux, direction.uy, direction.uz, color)
          }
        }
      }
      return
    }

    const direction = resolveEigenlineDirection(real, imag)
    if (direction) {
      pushLine(direction.ux, direction.uy, direction.uz, color)
    }
  })

  return traces
}


function collectVisibleObjectIds(system: System): string[] {
  const ids: string[] = []
  const stack = [...system.rootIds]
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) continue
    const node = system.nodes[nodeId]
    if (!node) continue
    if (node.children.length > 0) {
      stack.push(...node.children)
    }
    if (node.kind !== 'object' || !node.visibility) continue
    const object = system.objects[nodeId]
    if (!object) continue
    ids.push(nodeId)
  }
  return ids
}

function collectVisibleBranchIds(system: System): string[] {
  const ids: string[] = []
  const stack = [...system.rootIds]
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) continue
    const node = system.nodes[nodeId]
    if (!node) continue
    if (node.children.length > 0) {
      stack.push(...node.children)
    }
    if (node.kind !== 'branch' || !node.visibility) continue
    if (!system.branches[nodeId]) continue
    ids.push(nodeId)
  }
  return ids
}

function collectMap1DRange(system: System): [number, number] | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const ids = collectVisibleObjectIds(system)
  for (const nodeId of ids) {
    const object = system.objects[nodeId]
    if (!object) continue
    if (object.type === 'orbit') {
      for (const row of object.data) {
        const value = row[1]
        if (!Number.isFinite(value)) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      continue
    }
    if (object.type === 'equilibrium') {
      const solution = object.solution
      if (!solution) continue
      const cyclePoints =
        solution.cycle_points && solution.cycle_points.length > 0
          ? solution.cycle_points
          : [solution.state]
      for (const point of cyclePoints) {
        const value = point?.[0]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      continue
    }
    if (object.type === 'limit_cycle') {
      const value = object.state?.[0]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return [min, max]
}

type DiagramTraceState = {
  traces: Data[]
  hasAxes: boolean
  hasBranches: boolean
  hasData: boolean
  xTitle: string
  yTitle: string
}

function axisTitle(axis: BifurcationAxis | null): string {
  return axis?.name ?? ''
}

function resolveAxisValue(
  system: System,
  branch: ContinuationObject,
  point: ContinuationPoint,
  axis: BifurcationAxis,
  branchParams: number[]
): number | null {
  if (axis.kind === 'state') {
    const index = system.config.varNames.indexOf(axis.name)
    if (index < 0) return null
    const value = point.state[index]
    return Number.isFinite(value) ? value : null
  }

  const paramIndex = system.config.paramNames.indexOf(axis.name)
  if (paramIndex < 0) return null

  const branchType = branch.data.branch_type
  if (branchType && 'param1_name' in branchType && 'param2_name' in branchType) {
    if (axis.name === branchType.param1_name) {
      return Number.isFinite(point.param_value) ? point.param_value : null
    }
    if (axis.name === branchType.param2_name) {
      if (Number.isFinite(point.param2_value)) {
        return point.param2_value ?? null
      }
      const inferred = resolveContinuationPointParam2Value(
        point,
        branchType,
        system.config.varNames.length
      )
      if (Number.isFinite(inferred)) {
        return inferred ?? null
      }
      const fallback = branchParams[paramIndex]
      return Number.isFinite(fallback) ? fallback : null
    }
  }

  if (axis.name === branch.parameterName) {
    return Number.isFinite(point.param_value) ? point.param_value : null
  }

  const fallback = branchParams[paramIndex]
  return Number.isFinite(fallback) ? fallback : null
}

const LIMIT_CYCLE_BRANCH_TYPES = new Set([
  'limit_cycle',
  'pd_curve',
  'lpc_curve',
  'ns_curve',
])
const DEFAULT_LIMIT_CYCLE_MESH = { ntst: 20, ncol: 4 }

function resolveLimitCycleMesh(
  branch: ContinuationObject
): { ntst: number; ncol: number } {
  if (!LIMIT_CYCLE_BRANCH_TYPES.has(branch.branchType)) {
    return DEFAULT_LIMIT_CYCLE_MESH
  }
  const branchType = branch.data.branch_type
  if (!branchType || typeof branchType !== 'object') {
    return DEFAULT_LIMIT_CYCLE_MESH
  }
  if ('type' in branchType) {
    const typeName = branchType.type
    if (
      ['LimitCycle', 'PDCurve', 'LPCCurve', 'NSCurve'].includes(typeName) &&
      'ntst' in branchType &&
      'ncol' in branchType
    ) {
      return {
        ntst: branchType.ntst ?? DEFAULT_LIMIT_CYCLE_MESH.ntst,
        ncol: branchType.ncol ?? DEFAULT_LIMIT_CYCLE_MESH.ncol,
      }
    }
  }
  const legacy = branchType as { LimitCycle?: { ntst?: number; ncol?: number } }
  if (legacy.LimitCycle) {
    return {
      ntst: legacy.LimitCycle.ntst ?? DEFAULT_LIMIT_CYCLE_MESH.ntst,
      ncol: legacy.LimitCycle.ncol ?? DEFAULT_LIMIT_CYCLE_MESH.ncol,
    }
  }
  return DEFAULT_LIMIT_CYCLE_MESH
}

type LimitCycleEnvelope = { min: number; max: number }

function resolveLimitCycleEnvelope(
  system: System,
  branch: ContinuationObject,
  point: ContinuationPoint,
  axis: BifurcationAxis
): LimitCycleEnvelope | null {
  if (axis.kind !== 'state') return null
  const index = system.config.varNames.indexOf(axis.name)
  if (index < 0) return null
  const dim = system.config.varNames.length
  if (dim <= 0) return null
  const { ntst, ncol } = resolveLimitCycleMesh(branch)
  const { profilePoints } = extractLimitCycleProfile(point.state, dim, ntst, ncol)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  if (profilePoints.length > 0) {
    for (const profilePoint of profilePoints) {
      const value = profilePoint[index]
      if (!Number.isFinite(value)) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  } else {
    const value = point.state[index]
    if (Number.isFinite(value)) {
      min = value
      max = value
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

function resolveLimitCycleLayout(
  branchType: ContinuationObject['branchType']
): LimitCycleProfileLayout {
  if (branchType === 'lpc_curve' || branchType === 'ns_curve') {
    return 'stage-first'
  }
  return 'mesh-first'
}

type LimitCycleTraceConfig = {
  state: number[]
  dim: number
  ntst: number
  ncol: number
  name: string
  uid: string
  color: string
  lineWidth: number
  pointSize: number
  layout?: LimitCycleProfileLayout
  showLegend?: boolean
  axisIndices?: [number, number, number] | null
}

function buildLimitCycleTraces(config: LimitCycleTraceConfig): Data[] {
  const {
    state,
    dim,
    ntst,
    ncol,
    name,
    uid,
    color,
    lineWidth,
    pointSize,
    layout,
    showLegend,
    axisIndices,
  } = config
  const traces: Data[] = []
  if (!state || state.length === 0 || dim <= 0) return traces
  const plotDim = Math.min(dim, 3)
  const { profilePoints, period } = extractLimitCycleProfile(state, dim, ntst, ncol, {
    layout,
  })
  const fallbackAxes: [number, number, number] = [0, 1, 2]
  const axes =
    axisIndices && axisIndices.every((index) => index >= 0 && index < dim)
      ? axisIndices
      : fallbackAxes
  const axisOrder = plotDim >= 3 ? axes : plotDim === 2 ? [0, 1] : [0]
  const usablePoints = profilePoints
    .map((point, index) => ({
      point,
      index,
      coords: axisOrder.map((axis) => point[axis]),
    }))
    .filter(({ coords }) => coords.length === plotDim && coords.every(Number.isFinite))

  if (usablePoints.length >= 2 && plotDim > 0) {
    if (plotDim >= 3) {
      const x = usablePoints.map(({ coords }) => coords[0] ?? Number.NaN)
      const y = usablePoints.map(({ coords }) => coords[1] ?? Number.NaN)
      const z = usablePoints.map(({ coords }) => coords[2] ?? Number.NaN)
      const customdata = usablePoints.map(({ index }) => index)
      traces.push({
        type: 'scatter3d',
        mode: 'lines',
        name,
        uid,
        x,
        y,
        z,
        customdata,
        line: { color, width: lineWidth },
        ...(showLegend === undefined ? {} : { showlegend: showLegend }),
      })
    } else if (plotDim === 2) {
      const x = usablePoints.map(({ coords }) => coords[0] ?? Number.NaN)
      const y = usablePoints.map(({ coords }) => coords[1] ?? Number.NaN)
      const customdata = usablePoints.map(({ index }) => index)
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name,
        uid,
        x,
        y,
        customdata,
        line: { color, width: lineWidth },
        ...(showLegend === undefined ? {} : { showlegend: showLegend }),
      })
    } else if (plotDim === 1) {
      const timeEnd = Number.isFinite(period)
        ? period
        : Math.max(usablePoints.length - 1, 1)
      const step = usablePoints.length > 1 ? timeEnd / (usablePoints.length - 1) : 1
      const x = usablePoints.map((_, idx) => idx * step)
      const y = usablePoints.map(({ coords }) => coords[0] ?? Number.NaN)
      const customdata = usablePoints.map(({ index }) => index)
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name,
        uid,
        x,
        y,
        customdata,
        line: { color, width: lineWidth },
        ...(showLegend === undefined ? {} : { showlegend: showLegend }),
      })
    }
    return traces
  }

  if (plotDim <= 0) return traces
  const fallback = axisOrder.map((axis) => state[axis])
  if (fallback.length !== plotDim || !fallback.every(Number.isFinite)) return traces
  if (plotDim >= 3) {
    traces.push({
      type: 'scatter3d',
      mode: 'markers',
      name,
      uid,
      x: [fallback[0]],
      y: [fallback[1]],
      z: [fallback[2]],
      customdata: [0],
      marker: { color, size: pointSize },
      ...(showLegend === undefined ? {} : { showlegend: showLegend }),
    })
  } else if (plotDim === 2) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name,
      uid,
      x: [fallback[0]],
      y: [fallback[1]],
      customdata: [0],
      marker: { color, size: pointSize },
      ...(showLegend === undefined ? {} : { showlegend: showLegend }),
    })
  } else if (plotDim === 1) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name,
      uid,
      x: [0],
      y: [fallback[0]],
      customdata: [0],
      marker: { color, size: pointSize },
      ...(showLegend === undefined ? {} : { showlegend: showLegend }),
    })
  }
  return traces
}

function buildObjectNameIndex(system: System): Map<string, string> {
  const map = new Map<string, string>()
  Object.entries(system.objects).forEach(([id, obj]) => {
    map.set(obj.name, id)
  })
  return map
}

function buildLimitCyclePreviewTraces(
  system: System,
  selection: BranchPointSelection | null,
  axisIndices: [number, number, number] | null
): Data[] {
  if (!selection) return EMPTY_TRACES
  const branch = system.branches[selection.branchId]
  const point = branch?.data.points[selection.pointIndex]
  if (!branch || !point || !LIMIT_CYCLE_BRANCH_TYPES.has(branch.branchType)) {
    return EMPTY_TRACES
  }
  const objectNameIndex = buildObjectNameIndex(system)
  const objectId = objectNameIndex.get(branch.parentObject) ?? null
  const objectNode = objectId ? system.nodes[objectId] : null
  const render = {
    ...DEFAULT_RENDER,
    ...(objectNode?.render ?? system.nodes[selection.branchId]?.render ?? {}),
  }
  const renderTarget = objectId
    ? system.ui.limitCycleRenderTargets?.[objectId] ?? null
    : null
  const isCurrentTarget =
    Boolean(
      renderTarget?.type === 'branch' &&
        renderTarget.branchId === selection.branchId &&
        renderTarget.pointIndex === selection.pointIndex
    )
  if (isCurrentTarget) return EMPTY_TRACES
  const { ntst, ncol } = resolveLimitCycleMesh(branch)
  const dim = system.config.varNames.length
  const indices = ensureBranchIndices(branch.data)
  const logicalIndex = indices[selection.pointIndex]
  const displayIndex = Number.isFinite(logicalIndex) ? logicalIndex : selection.pointIndex
  const traceName = `LC Preview: ${branch.name} @ ${displayIndex}`
  return buildLimitCycleTraces({
    state: point.state,
    dim,
    ntst,
    ncol,
    name: traceName,
    uid: selection.branchId,
    color: render.color,
    lineWidth: render.lineWidth + 1,
    pointSize: render.pointSize + 2,
    layout: resolveLimitCycleLayout(branch.branchType),
    showLegend: false,
    axisIndices,
  })
}

function buildIsoclineSnapshotSignature(snapshot: IsoclineComputedSnapshot): string {
  return JSON.stringify({
    source: snapshot.source,
    expression: snapshot.expression,
    level: snapshot.level,
    axes: snapshot.axes,
    frozenState: snapshot.frozenState,
    parameters: snapshot.parameters,
  })
}

function buildIsoclineTraces(config: {
  nodeId: string
  name: string
  color: string
  lineWidth: number
  pointSize: number
  highlight: boolean
  geometry: ComputeIsoclineResult
  axisIndices: [number, number, number] | null
  isMap1D: boolean
  isTimeSeries: boolean
  timeRange: [number, number] | null
}): Data[] {
  const {
    nodeId,
    name,
    color,
    lineWidth,
    pointSize,
    highlight,
    geometry,
    axisIndices,
    isMap1D,
    isTimeSeries,
    timeRange,
  } = config
  const traces: Data[] = []
  const dim = geometry.dim
  if (!Number.isFinite(dim) || dim <= 0) return traces
  const pointCount = Math.floor(geometry.points.length / dim)
  if (pointCount <= 0) return traces
  const axes: [number, number, number] = axisIndices ?? [0, 1, 2]
  const width = highlight ? lineWidth + 1 : lineWidth
  const markerSize = highlight ? pointSize + 2 : pointSize
  const readPoint = (index: number): number[] | null => {
    if (index < 0 || index >= pointCount) return null
    const start = index * dim
    const point = geometry.points.slice(start, start + dim)
    return point.length === dim ? point : null
  }
  const projectPoint = (
    point: number[]
  ): [number, number, number] | [number, number] | [number] | null => {
    if (dim >= 3) {
      const x = point[axes[0]]
      const y = point[axes[1]]
      const z = point[axes[2]]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
      return [x, y, z]
    }
    if (dim === 2) {
      const x = point[0]
      const y = point[1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return [x, y]
    }
    const value = point[0]
    if (!Number.isFinite(value)) return null
    return [value]
  }

  if (geometry.geometry === 'points') {
    if (dim >= 3) {
      const x: number[] = []
      const y: number[] = []
      const z: number[] = []
      for (let index = 0; index < pointCount; index += 1) {
        const projected = projectPoint(readPoint(index) ?? [])
        if (!projected || projected.length !== 3) continue
        x.push(projected[0])
        y.push(projected[1])
        z.push(projected[2])
      }
      if (x.length > 0) {
        traces.push({
          type: 'scatter3d',
          mode: 'markers',
          name,
          uid: nodeId,
          x,
          y,
          z,
          marker: { color, size: markerSize },
        })
      }
      return traces
    }
    if (dim === 2) {
      const x: number[] = []
      const y: number[] = []
      for (let index = 0; index < pointCount; index += 1) {
        const projected = projectPoint(readPoint(index) ?? [])
        if (!projected || projected.length !== 2) continue
        x.push(projected[0])
        y.push(projected[1])
      }
      if (x.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name,
          uid: nodeId,
          x,
          y,
          marker: { color, size: markerSize },
        })
      }
      return traces
    }
    const x: number[] = []
    const y: number[] = []
    const fallbackTime = timeRange ? timeRange[0] : 0
    for (let index = 0; index < pointCount; index += 1) {
      const projected = projectPoint(readPoint(index) ?? [])
      if (!projected || projected.length !== 1) continue
      if (isMap1D) {
        x.push(projected[0])
        y.push(projected[0])
      } else if (isTimeSeries) {
        x.push(fallbackTime)
        y.push(projected[0])
      } else {
        x.push(index)
        y.push(projected[0])
      }
    }
    if (x.length > 0) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name,
        uid: nodeId,
        x,
        y,
        marker: { color, size: markerSize },
      })
    }
    return traces
  }

  if (geometry.geometry === 'segments') {
    if (dim >= 3) {
      const x: Array<number | null> = []
      const y: Array<number | null> = []
      const z: Array<number | null> = []
      for (let edge = 0; edge + 1 < geometry.segments.length; edge += 2) {
        const a = readPoint(geometry.segments[edge] ?? -1)
        const b = readPoint(geometry.segments[edge + 1] ?? -1)
        if (!a || !b) continue
        const pa = projectPoint(a)
        const pb = projectPoint(b)
        if (!pa || !pb || pa.length !== 3 || pb.length !== 3) continue
        x.push(pa[0], pb[0], null)
        y.push(pa[1], pb[1], null)
        z.push(pa[2], pb[2], null)
      }
      if (x.length > 0) {
        traces.push({
          type: 'scatter3d',
          mode: 'lines',
          name,
          uid: nodeId,
          x,
          y,
          z,
          line: { color, width },
        })
      }
      return traces
    }
    if (dim !== 2) return traces
    const x: Array<number | null> = []
    const y: Array<number | null> = []
    for (let edge = 0; edge + 1 < geometry.segments.length; edge += 2) {
      const a = readPoint(geometry.segments[edge] ?? -1)
      const b = readPoint(geometry.segments[edge + 1] ?? -1)
      if (!a || !b) continue
      const pa = projectPoint(a)
      const pb = projectPoint(b)
      if (!pa || !pb || pa.length !== 2 || pb.length !== 2) continue
      x.push(pa[0], pb[0], null)
      y.push(pa[1], pb[1], null)
    }
    if (x.length > 0) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name,
        uid: nodeId,
        x,
        y,
        line: { color, width },
      })
    }
    return traces
  }

  if (dim < 3) return traces
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  for (let index = 0; index < pointCount; index += 1) {
    const projected = projectPoint(readPoint(index) ?? [])
    if (!projected || projected.length !== 3) return traces
    x.push(projected[0])
    y.push(projected[1])
    z.push(projected[2])
  }
  if (x.length === 0) return traces
  const i: number[] = []
  const j: number[] = []
  const k: number[] = []
  for (let face = 0; face + 2 < geometry.triangles.length; face += 3) {
    i.push(geometry.triangles[face] ?? 0)
    j.push(geometry.triangles[face + 1] ?? 0)
    k.push(geometry.triangles[face + 2] ?? 0)
  }
  if (i.length === 0) return traces
  traces.push({
    type: 'mesh3d',
    name,
    uid: nodeId,
    x,
    y,
    z,
    i: Uint32Array.from(i),
    j: Uint32Array.from(j),
    k: Uint32Array.from(k),
    color,
    opacity: highlight ? 0.5 : 0.35,
    flatshading: true,
    showscale: false,
  } as Data)
  return traces
}

function buildSceneTraces(
  system: System,
  scene: Scene,
  selectedNodeId: string | null,
  isoclineGeometryCache?: Record<
    string,
    {
      signature: string
      geometry: ComputeIsoclineResult
    }
  >,
  timeSeriesMeta?: TimeSeriesViewportMeta | null,
  mapRange?: [number, number] | null,
  mapFunctionSamples?: MapFunctionSamples | null,
  plotSize?: PlotSize | null
): Data[] {
  const traces: Data[] = []
  const isoclineCache = isoclineGeometryCache ?? {}
  const limitCycleRenderTargets = system.ui.limitCycleRenderTargets ?? {}
  const isMap = system.config.type === 'map'
  const isTimeSeries = system.config.varNames.length === 1 && !isMap
  const isMap1D = isMap && system.config.varNames.length === 1
  const sceneAxisIndices = resolveSceneAxisIndices(
    system.config.varNames,
    scene.axisVariables
  )
  const sceneAxes =
    sceneAxisIndices &&
    sceneAxisIndices.every(
      (index) => index >= 0 && index < system.config.varNames.length
    )
      ? sceneAxisIndices
      : null
  const axisX = sceneAxes?.[0] ?? 0
  const axisY = sceneAxes?.[1] ?? 1
  const axisZ = sceneAxes?.[2] ?? 2
  const manualSelection = scene.selectedNodeIds ?? []
  const candidateIds =
    manualSelection.length > 0
      ? manualSelection
      : scene.display === 'selection' && selectedNodeId
        ? [selectedNodeId]
        : collectVisibleObjectIds(system)
  const canPlotEigenvectors = !isTimeSeries && !isMap1D
  let timeRange: [number, number] | null = null
  const pendingEquilibria: Array<{
    nodeId: string
    name: string
    value: number
    color: string
    lineWidth: number
    highlight: boolean
  }> = []
  const pendingEigenvectors: PendingEigenvector[] = []
  const sceneBounds: SceneBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minEquilibrium = Number.POSITIVE_INFINITY
  let maxEquilibrium = Number.NEGATIVE_INFINITY
  if (isMap1D) {
    const cobwebRange = mapRange ?? mapFunctionSamples?.range ?? null
    const baseSamples = mapFunctionSamples
      ? { x: mapFunctionSamples.x, y: mapFunctionSamples.y }
      : null
    traces.push(...buildCobwebBaseTraces(cobwebRange, baseSamples))
  }
  if (isTimeSeries) {
    let minT = Number.POSITIVE_INFINITY
    let maxT = Number.NEGATIVE_INFINITY
    for (const nodeId of candidateIds) {
      const node = system.nodes[nodeId]
      if (!node || node.kind !== 'object' || !node.visibility) continue
      const object = system.objects[nodeId]
      if (!object || object.type !== 'orbit' || object.data.length === 0) continue
      const start = Math.min(object.t_start, object.t_end)
      const end = Math.max(object.t_start, object.t_end)
      minT = Math.min(minT, start)
      maxT = Math.max(maxT, end)
    }
    if (Number.isFinite(minT) && Number.isFinite(maxT)) {
      timeRange = [minT, maxT]
    }
  }

  for (const nodeId of candidateIds) {
    const node = system.nodes[nodeId]
    if (!node || node.kind !== 'object' || !node.visibility) continue
    const object = system.objects[nodeId]
    if (!object) continue

    if (object.type === 'isocline') {
      if (!object.lastComputed) continue
      const signature = buildIsoclineSnapshotSignature(object.lastComputed)
      const cached = isoclineCache[nodeId]
      if (!cached || cached.signature !== signature) continue
      const highlight = nodeId === selectedNodeId
      traces.push(
        ...buildIsoclineTraces({
          nodeId,
          name: object.name,
          color: node.render.color,
          lineWidth: node.render.lineWidth,
          pointSize: node.render.pointSize,
          highlight,
          geometry: cached.geometry,
          axisIndices: sceneAxes,
          isMap1D,
          isTimeSeries,
          timeRange,
        })
      )
      continue
    }

    if (object.type === 'equilibrium') {
      if (!object.solution || object.solution.state.length === 0) continue
      const state = object.solution.state
      const dimension = state.length
      const highlight = nodeId === selectedNodeId
      const size = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const cycleStates =
        isMap && object.solution?.cycle_points?.length
          ? object.solution.cycle_points
          : [state]
      const hasCyclePoints = isMap && cycleStates.length > 1
      const representativeState = cycleStates[0] ?? state
      const cycleTailStates = hasCyclePoints ? cycleStates.slice(1) : []
      if (canPlotEigenvectors && dimension >= 2) {
        const eigenX = dimension >= 3 ? state[axisX] : state[0]
        const eigenY = dimension >= 3 ? state[axisY] : state[1]
        const eigenZ = dimension >= 3 ? state[axisZ] : 0
        updateSceneBounds(sceneBounds, eigenX, eigenY, eigenZ)
        if (hasCyclePoints) {
          const axisIndices = dimension >= 3 ? [axisX, axisY, axisZ] : [0, 1, 0]
          for (const cycleState of cycleTailStates) {
            const valueX = cycleState[axisIndices[0]]
            const valueY = cycleState[axisIndices[1]]
            const valueZ = dimension >= 3 ? cycleState[axisIndices[2]] : 0
            updateSceneBounds(sceneBounds, valueX, valueY, valueZ)
          }
        }
        const eigenpairs = object.solution.eigenpairs ?? []
        const eigenspaceIndices = resolveEquilibriumEigenspaceIndices(eigenpairs)
        const eigenvectorRender = resolveEquilibriumEigenvectorRender(
          node.render?.equilibriumEigenvectors,
          eigenspaceIndices
        )
        const eigenvectorPlotDim = dimension >= 3 ? 3 : 2
        const hasEigenvectors = eigenpairs.some(
          (pair) => pair.vector.length >= eigenvectorPlotDim
        )
        if (eigenvectorRender.enabled && hasEigenvectors && eigenvectorRender.vectorIndices.length > 0) {
          pendingEigenvectors.push({
            nodeId,
            state,
            eigenpairs,
            vectorIndices: eigenvectorRender.vectorIndices,
            colors: eigenvectorRender.colors,
            lineLengthScale: eigenvectorRender.lineLengthScale,
            lineThickness: eigenvectorRender.lineThickness,
            discRadiusScale: eigenvectorRender.discRadiusScale,
            discThickness: eigenvectorRender.discThickness,
            highlight,
            axisIndices: sceneAxes,
          })
        }
      }
      if (dimension >= 3) {
        const repX = representativeState[axisX]
        const repY = representativeState[axisY]
        const repZ = representativeState[axisZ]
        if (hasCyclePoints) {
          const cycleX: number[] = []
          const cycleY: number[] = []
          const cycleZ: number[] = []
          for (const cycleState of cycleTailStates) {
            cycleX.push(cycleState[axisX])
            cycleY.push(cycleState[axisY])
            cycleZ.push(cycleState[axisZ])
          }
          if (cycleX.length > 0) {
            traces.push({
              type: 'scatter3d',
              mode: 'markers',
              name: object.name,
              uid: nodeId,
              x: cycleX,
              y: cycleY,
              z: cycleZ,
              marker: {
                color: node.render.color,
                size,
              },
            })
          }
          traces.push({
            type: 'scatter3d',
            mode: 'markers',
            name: `${object.name} representative`,
            uid: nodeId,
            x: [repX],
            y: [repY],
            z: [repZ],
            marker: {
              color: node.render.color,
              size: size + 1,
              symbol: 'diamond',
            },
            showlegend: false,
          })
        } else {
          traces.push({
            type: 'scatter3d',
            mode: 'markers',
            name: object.name,
            uid: nodeId,
            x: [repX],
            y: [repY],
            z: [repZ],
            marker: {
              color: node.render.color,
              size,
            },
          })
        }
      } else if (dimension >= 2) {
        const repX = representativeState[0]
        const repY = representativeState[1]
        if (hasCyclePoints) {
          const cycleX: number[] = []
          const cycleY: number[] = []
          for (const cycleState of cycleTailStates) {
            cycleX.push(cycleState[0])
            cycleY.push(cycleState[1])
          }
          if (cycleX.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name: object.name,
              uid: nodeId,
              x: cycleX,
              y: cycleY,
              marker: {
                color: node.render.color,
                size,
              },
            })
          }
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: `${object.name} representative`,
            uid: nodeId,
            x: [repX],
            y: [repY],
            marker: {
              color: node.render.color,
              size: size + 1,
              symbol: 'diamond',
            },
            showlegend: false,
          })
        } else {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: object.name,
            uid: nodeId,
            x: [repX],
            y: [repY],
            marker: {
              color: node.render.color,
              size,
            },
          })
        }
      } else if (isMap1D) {
        const repValue = representativeState[0]
        const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
        if (hasCyclePoints) {
          const diagonal: number[] = []
          for (const cycleState of cycleTailStates) {
            const value = cycleState[0]
            if (typeof value !== 'number' || !Number.isFinite(value)) continue
            diagonal.push(value)
          }
          if (diagonal.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name: object.name,
              uid: nodeId,
              x: diagonal,
              y: diagonal,
              marker: {
                color: node.render.color,
                size,
              },
            })
          }
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: `${object.name} representative`,
            uid: nodeId,
            x: [repValue],
            y: [repValue],
            marker: {
              color: node.render.color,
              size: size + 1,
              symbol: 'diamond',
            },
            showlegend: false,
          })
          const cobwebTrace = buildCobwebLineTrace(
            buildCobwebRowsFromStates(cycleStates, { closeCycle: true }),
            {
              name: object.name,
              uid: nodeId,
              color: node.render.color,
              lineWidth,
            }
          )
          if (cobwebTrace) {
            traces.push(cobwebTrace)
          }
        } else {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: object.name,
            uid: nodeId,
            x: [repValue],
            y: [repValue],
            marker: {
              color: node.render.color,
              size,
            },
          })
        }
      } else if (isTimeSeries && timeRange && timeRange[0] !== timeRange[1]) {
        pendingEquilibria.push({
          nodeId,
          name: object.name,
          value: state[0],
          color: node.render.color,
          lineWidth: node.render.lineWidth,
          highlight,
        })
        minEquilibrium = Math.min(minEquilibrium, state[0])
        maxEquilibrium = Math.max(maxEquilibrium, state[0])
      } else {
        const time = timeRange ? timeRange[0] : 0
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x: [time],
          y: [state[0]],
          marker: {
            color: node.render.color,
            size,
          },
        })
      }
      continue
    }

    if (object.type === 'limit_cycle') {
      const highlight = nodeId === selectedNodeId
      const renderTarget = limitCycleRenderTargets[nodeId] ?? null
      let state = object.state
      let ntst = object.ntst
      let ncol = object.ncol
      let layout: LimitCycleProfileLayout = 'mesh-first'
      if (renderTarget?.type === 'branch') {
        const branch = system.branches[renderTarget.branchId]
        const point = branch?.data.points[renderTarget.pointIndex]
        if (branch && point) {
          const mesh = resolveLimitCycleMesh(branch)
          state = point.state
          ntst = mesh.ntst
          ncol = mesh.ncol
          layout = resolveLimitCycleLayout(branch.branchType)
        }
      }
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      traces.push(
        ...buildLimitCycleTraces({
          state,
          dim: system.config.varNames.length,
          ntst,
          ncol,
          name: object.name,
          uid: nodeId,
          color: node.render.color,
          lineWidth,
          pointSize: node.render.pointSize + (highlight ? 2 : 0),
          layout,
          axisIndices: sceneAxes,
        })
      )
      continue
    }

    if (object.type !== 'orbit') continue

    const rows = object.data
    if (rows.length === 0) continue
    // Use the scene-selected axes for 3D systems (fallback to the first three variables).
    const dimension = rows[0].length - 1
    const highlight = nodeId === selectedNodeId
    if (isMap) {
      const size = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      if (dimension >= 3) {
        const x: number[] = []
        const y: number[] = []
        const z: number[] = []
        const customdata: number[] = []
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const valueX = row[axisX + 1]
          const valueY = row[axisY + 1]
          const valueZ = row[axisZ + 1]
          x.push(valueX)
          y.push(valueY)
          z.push(valueZ)
          customdata.push(index)
          if (canPlotEigenvectors) {
            updateSceneBounds(sceneBounds, valueX, valueY, valueZ)
          }
        }
        traces.push({
          type: 'scatter3d',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x,
          y,
          z,
          customdata,
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (dimension >= 2) {
        const x: number[] = []
        const y: number[] = []
        const customdata: number[] = []
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          x.push(row[1])
          y.push(row[2])
          customdata.push(index)
          if (canPlotEigenvectors) {
            updateSceneBounds(sceneBounds, row[1], row[2], 0)
          }
        }
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x,
          y,
          customdata,
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (isMap1D) {
        const diagonal: number[] = []
        const customdata: number[] = []
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const value = row[1]
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          diagonal.push(value)
          customdata.push(index)
        }
        if (diagonal.length > 0) {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: object.name,
            uid: nodeId,
            x: diagonal,
            y: diagonal,
            customdata,
            marker: {
              color: node.render.color,
              size,
            },
          })
        }
        const cobwebTrace = buildCobwebLineTrace(rows, {
          name: object.name,
          uid: nodeId,
          color: node.render.color,
          lineWidth,
        })
        if (cobwebTrace) {
          traces.push(cobwebTrace)
        }
      }
    } else {
      const x: number[] = []
      const y: number[] = []
      const z: number[] = []
      const customdata: number[] = []
      if (dimension >= 3) {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const valueX = row[axisX + 1]
          const valueY = row[axisY + 1]
          const valueZ = row[axisZ + 1]
          x.push(valueX)
          y.push(valueY)
          z.push(valueZ)
          customdata.push(index)
          if (canPlotEigenvectors) {
            updateSceneBounds(sceneBounds, valueX, valueY, valueZ)
          }
        }
      } else if (dimension >= 2) {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          x.push(row[1])
          y.push(row[2])
          customdata.push(index)
          if (canPlotEigenvectors) {
            updateSceneBounds(sceneBounds, row[1], row[2], 0)
          }
        }
      } else {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const value = row[1]
          x.push(row[0])
          y.push(value)
          customdata.push(index)
          if (isTimeSeries) {
            minY = Math.min(minY, value)
            maxY = Math.max(maxY, value)
          }
        }
      }

      if (dimension >= 3) {
        traces.push({
          type: 'scatter3d',
          mode: 'lines',
          name: object.name,
          uid: nodeId,
          x,
          y,
          z,
          customdata,
          line: {
            color: node.render.color,
            width: highlight ? node.render.lineWidth + 1 : node.render.lineWidth,
          },
        })
      } else {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: object.name,
          uid: nodeId,
          x,
          y,
          customdata,
          line: {
            color: node.render.color,
            width: highlight ? node.render.lineWidth + 1 : node.render.lineWidth,
          },
        })
      }
    }

    if (dimension >= 2 && system.config.varNames.length >= 2) {
      const clvRender = resolveClvRender(node.render?.clv, object.covariantVectors?.dim)
      if (clvRender.enabled) {
        traces.push(
          ...buildClvTraces(
            nodeId,
            object,
            clvRender,
            sceneAxes,
            plotSize
          )
        )
      }
    }
  }

  if (pendingEigenvectors.length > 0) {
    pendingEigenvectors.forEach((entry) => {
      traces.push(...buildEquilibriumEigenvectorTraces(entry, sceneBounds, plotSize))
    })
  }

  if (isTimeSeries && timeRange && timeRange[0] !== timeRange[1] && pendingEquilibria.length > 0) {
    const axisRange = timeSeriesMeta?.yRange
    const rangeFromAxis =
      axisRange && Number.isFinite(axisRange[0]) && Number.isFinite(axisRange[1])
        ? axisRange[1] - axisRange[0]
        : null
    const rangeFromOrbits =
      Number.isFinite(minY) && Number.isFinite(maxY) && maxY !== minY ? maxY - minY : null
    const rangeFromEquilibria =
      Number.isFinite(minEquilibrium) &&
      Number.isFinite(maxEquilibrium) &&
      maxEquilibrium !== minEquilibrium
        ? maxEquilibrium - minEquilibrium
        : null
    const rangeY = rangeFromAxis ?? rangeFromOrbits ?? rangeFromEquilibria ?? 1
    const plotHeight = timeSeriesMeta?.height ?? MIN_VIEWPORT_HEIGHT
    const dataPerPixel = rangeY / Math.max(plotHeight, 1)
    const [start, end] = timeRange

    for (const entry of pendingEquilibria) {
      const width = entry.highlight ? entry.lineWidth + 1 : entry.lineWidth
      const band = (width * 2) * dataPerPixel
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: entry.name,
        uid: entry.nodeId,
        x: [start, end],
        y: [entry.value, entry.value],
        line: {
          color: entry.color,
          dash: 'dot',
          width,
        },
      })
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: entry.name,
        uid: entry.nodeId,
        x: [start, end, end, start],
        y: [entry.value - band, entry.value - band, entry.value + band, entry.value + band],
        fill: 'toself',
        hoveron: 'fills',
        fillcolor: 'rgba(0,0,0,0.002)',
        line: { width: 0 },
        hovertemplate: '<extra></extra>',
        showlegend: false,
      })
    }
  }
  return traces
}

function buildDiagramTraces(
  system: System,
  diagram: BifurcationDiagram,
  selectedNodeId: string | null,
  branchPointSelection: BranchPointSelection | null
): DiagramTraceState {
  const traces: Data[] = []
  const xAxis = diagram.xAxis
  const yAxis = diagram.yAxis
  const hasAxes = Boolean(xAxis && yAxis)
  const selectionBranchId = branchPointSelection?.branchId ?? null
  const selectionPointIndex = branchPointSelection?.pointIndex ?? null
  const selectedBranchIds = diagram.selectedBranchIds ?? []
  const candidateBranchIds =
    selectedBranchIds.length > 0
      ? selectedBranchIds
      : collectVisibleBranchIds(system)
  const branchIds = candidateBranchIds.filter((branchId) => {
    const node = system.nodes[branchId]
    return Boolean(node?.visibility && system.branches[branchId])
  })
  const hasBranches = branchIds.length > 0
  const xTitle = axisTitle(xAxis)
  const yTitle = axisTitle(yAxis)

  if (!xAxis || !yAxis) {
    return { traces, hasAxes, hasBranches, hasData: false, xTitle, yTitle }
  }

  let hasData = false
  const appendMultiLineMarkers = (
    branchId: string,
    branch: ContinuationObject,
    indices: number[],
    pointIndices: number[],
    lines: Array<{ x: Array<number | null>; y: Array<number | null> }>,
    markerSize: number,
    color: string
  ) => {
    if (lines.length === 0) return

    const positionByIndex = new Map<number, number>()
    for (let position = 0; position < pointIndices.length; position += 1) {
      positionByIndex.set(pointIndices[position], position)
    }

    const startX: number[] = []
    const startY: number[] = []
    const startIndices: number[] = []
    const endX: number[] = []
    const endY: number[] = []
    const endIndices: number[] = []

    for (const line of lines) {
      let firstIndex: number | null = null
      let lastIndex: number | null = null
      for (let i = 0; i < line.x.length; i += 1) {
        const xValue = line.x[i]
        const yValue = line.y[i]
        if (
          typeof xValue === 'number' &&
          Number.isFinite(xValue) &&
          typeof yValue === 'number' &&
          Number.isFinite(yValue)
        ) {
          firstIndex = i
          break
        }
      }
      for (let i = line.x.length - 1; i >= 0; i -= 1) {
        const xValue = line.x[i]
        const yValue = line.y[i]
        if (
          typeof xValue === 'number' &&
          Number.isFinite(xValue) &&
          typeof yValue === 'number' &&
          Number.isFinite(yValue)
        ) {
          lastIndex = i
          break
        }
      }
      if (firstIndex !== null) {
        const xValue = line.x[firstIndex]
        const yValue = line.y[firstIndex]
        if (typeof xValue === 'number' && typeof yValue === 'number') {
          startX.push(xValue)
          startY.push(yValue)
          startIndices.push(pointIndices[firstIndex] ?? firstIndex)
        }
      }
      if (lastIndex !== null) {
        const xValue = line.x[lastIndex]
        const yValue = line.y[lastIndex]
        if (typeof xValue === 'number' && typeof yValue === 'number') {
          endX.push(xValue)
          endY.push(yValue)
          endIndices.push(pointIndices[lastIndex] ?? lastIndex)
        }
      }
    }

    if (startX.length > 0) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${branch.name} start`,
        uid: branchId,
        x: startX,
        y: startY,
        customdata: startIndices,
        marker: {
          color,
          size: markerSize,
          symbol: 'triangle-up',
        },
        showlegend: false,
        hovertemplate: 'Start<extra></extra>',
      })
    }

    if (endX.length > 0) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${branch.name} end`,
        uid: branchId,
        x: endX,
        y: endY,
        customdata: endIndices,
        marker: {
          color,
          size: markerSize,
          symbol: 'triangle-down',
        },
        showlegend: false,
        hovertemplate: 'End<extra></extra>',
      })
    }

    if (branch.data.bifurcations && branch.data.bifurcations.length > 0) {
      const bx: number[] = []
      const by: number[] = []
      const labels: string[] = []
      const bifIndices: number[] = []
      for (const bifIndex of branch.data.bifurcations) {
        const point = branch.data.points[bifIndex]
        const position = positionByIndex.get(bifIndex)
        if (!point || position === undefined) continue
        const logicalIndex = indices[bifIndex]
        const displayIndex = Number.isFinite(logicalIndex) ? logicalIndex : bifIndex
        const label = formatBifurcationLabel(displayIndex, point.stability)
        for (const line of lines) {
          const xValue = line.x[position]
          const yValue = line.y[position]
          if (
            typeof xValue !== 'number' ||
            !Number.isFinite(xValue) ||
            typeof yValue !== 'number' ||
            !Number.isFinite(yValue)
          ) {
            continue
          }
          bx.push(xValue)
          by.push(yValue)
          labels.push(label)
          bifIndices.push(bifIndex)
        }
      }
      if (bx.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} bifurcations`,
          uid: branchId,
          x: bx,
          y: by,
          customdata: bifIndices,
          marker: {
            color,
            size: markerSize + 2,
            symbol: 'diamond',
          },
          text: labels,
          showlegend: false,
          hovertemplate: '%{text}<extra></extra>',
        })
      }
    }
  }

  const appendSelectedPointMarker = (
    branchId: string,
    branch: ContinuationObject,
    indices: number[],
    pointIndices: number[],
    lines: Array<{ x: Array<number | null>; y: Array<number | null> }>,
    markerSize: number,
    color: string
  ) => {
    if (selectionBranchId !== branchId || selectionPointIndex === null) return
    if (
      selectionPointIndex < 0 ||
      selectionPointIndex >= branch.data.points.length
    ) {
      return
    }
    const position = pointIndices.indexOf(selectionPointIndex)
    if (position < 0) return
    const selectedX: number[] = []
    const selectedY: number[] = []
    for (const line of lines) {
      const xValue = line.x[position]
      const yValue = line.y[position]
      if (
        typeof xValue === 'number' &&
        Number.isFinite(xValue) &&
        typeof yValue === 'number' &&
        Number.isFinite(yValue)
      ) {
        selectedX.push(xValue)
        selectedY.push(yValue)
      }
    }
    if (selectedX.length === 0) return
    const logicalIndex = indices[selectionPointIndex]
    const displayIndex = Number.isFinite(logicalIndex)
      ? logicalIndex
      : selectionPointIndex
    const label = `Selected point: ${displayIndex}`
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: `${branch.name} selected point`,
      uid: branchId,
      x: selectedX,
      y: selectedY,
      customdata: selectedX.map(() => selectionPointIndex),
      marker: {
        color,
        size: markerSize + 4,
        symbol: 'circle-open',
        line: { color, width: 2 },
      },
      text: selectedX.map(() => label),
      showlegend: false,
      hovertemplate: '%{text}<extra></extra>',
    })
  }

  for (const branchId of branchIds) {
    const branch = system.branches[branchId]
    const node = system.nodes[branchId]
    if (!branch || !node || !node.visibility) continue
    if (!branch.data.points || branch.data.points.length === 0) continue

    const indices = ensureBranchIndices(branch.data)
    const order = buildSortedArrayOrder(indices)
    const branchParams = getBranchParams(system, branch)
    const x: number[] = []
    const y: number[] = []
    const pointIndices: number[] = []
    const hasMixedAxes = xAxis.kind !== yAxis.kind
    const isLimitCycleBranch = LIMIT_CYCLE_BRANCH_TYPES.has(branch.branchType)
    const isStateAxisPair = xAxis.kind === 'state' && yAxis.kind === 'state'
    const isStateParamPair =
      (xAxis.kind === 'state' && yAxis.kind === 'parameter') ||
      (xAxis.kind === 'parameter' && yAxis.kind === 'state')
    const mapIterations = branch.mapIterations ?? 1
    const useCyclePoints =
      isStateAxisPair &&
      system.config.type === 'map' &&
      branch.branchType === 'equilibrium' &&
      mapIterations > 1
    const useMixedCyclePoints =
      isStateParamPair &&
      system.config.type === 'map' &&
      branch.branchType === 'equilibrium' &&
      mapIterations > 1
    const stateAxisIndices = isStateAxisPair
      ? [
          system.config.varNames.indexOf(xAxis.name),
          system.config.varNames.indexOf(yAxis.name),
        ]
      : null
    const isFlow = system.config.type === 'flow'

    if (
      isFlow &&
      isLimitCycleBranch &&
      isStateAxisPair &&
      stateAxisIndices &&
      stateAxisIndices[0] >= 0 &&
      stateAxisIndices[1] >= 0
    ) {
      const axisX = stateAxisIndices[0]
      const axisY = stateAxisIndices[1]
      const dim = system.config.varNames.length
      const { ntst, ncol } = resolveLimitCycleMesh(branch)
      const layout = resolveLimitCycleLayout(branch.branchType)
      const stateSpaceStride = resolveStateSpaceStride(node.render.stateSpaceStride)
      const cycleX: Array<number | null> = []
      const cycleY: Array<number | null> = []
      const cycleCustomdata: Array<number | null> = []
      const repX: number[] = []
      const repY: number[] = []
      const repIndices: number[] = []
      const bifX: number[] = []
      const bifY: number[] = []
      const bifLabels: string[] = []
      const bifIndices: number[] = []
      const bifSet = new Set(branch.data.bifurcations ?? [])

      for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
        const idx = order[orderIndex]
        const isBifurcation = bifSet.has(idx)
        const isSelected =
          selectionBranchId === branchId && selectionPointIndex === idx
        const isEndpoint = orderIndex === 0 || orderIndex === order.length - 1
        const isStrideHit =
          stateSpaceStride <= 1 || orderIndex % stateSpaceStride === 0
        if (!isStrideHit && !isBifurcation && !isSelected && !isEndpoint) {
          continue
        }
        const point = branch.data.points[idx]
        if (!point) continue
        const { profilePoints } = extractLimitCycleProfile(
          point.state,
          dim,
          ntst,
          ncol,
          { layout }
        )
        if (profilePoints.length === 0) continue

        let repPoint: number[] | null = null
        for (const profilePoint of profilePoints) {
          const xValue = profilePoint[axisX]
          const yValue = profilePoint[axisY]
          if (Number.isFinite(xValue) && Number.isFinite(yValue)) {
            repPoint = profilePoint
            break
          }
        }
        if (repPoint) {
          repX.push(repPoint[axisX])
          repY.push(repPoint[axisY])
          repIndices.push(idx)
        }

        let bifLabel = ''
        if (isBifurcation) {
          const logicalIndex = indices[idx]
          const displayIndex = Number.isFinite(logicalIndex) ? logicalIndex : idx
          bifLabel = formatBifurcationLabel(displayIndex, point.stability)
        }

        const segmentX: Array<number | null> = []
        const segmentY: Array<number | null> = []
        const segmentCustomdata: Array<number | null> = []
        let hasFinite = false
        for (const profilePoint of profilePoints) {
          const xValue = profilePoint[axisX]
          const yValue = profilePoint[axisY]
          if (Number.isFinite(xValue) && Number.isFinite(yValue)) {
            segmentX.push(xValue)
            segmentY.push(yValue)
            segmentCustomdata.push(idx)
            hasFinite = true
            if (isBifurcation) {
              bifX.push(xValue)
              bifY.push(yValue)
              bifLabels.push(bifLabel)
              bifIndices.push(idx)
            }
          } else {
            segmentX.push(null)
            segmentY.push(null)
            segmentCustomdata.push(null)
          }
        }
        if (hasFinite) {
          cycleX.push(...segmentX, null)
          cycleY.push(...segmentY, null)
          cycleCustomdata.push(...segmentCustomdata, null)
        }
      }

      if (cycleX.length === 0 || cycleY.length === 0) continue
      hasData = true

      const highlight = branchId === selectedNodeId
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const lineDash = resolveLineDash(node.render.lineStyle)

      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: branch.name,
        uid: branchId,
        x: cycleX,
        y: cycleY,
        customdata: cycleCustomdata,
        line: {
          color: node.render.color,
          width: lineWidth,
          dash: lineDash,
        },
        connectgaps: false,
      })

      if (repX.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} start`,
          uid: branchId,
          x: [repX[0]],
          y: [repY[0]],
          customdata: [repIndices[0]],
          marker: {
            color: node.render.color,
            size: markerSize,
            symbol: 'triangle-up',
          },
          showlegend: false,
          hovertemplate: 'Start<extra></extra>',
        })
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} end`,
          uid: branchId,
          x: [repX[repX.length - 1]],
          y: [repY[repY.length - 1]],
          customdata: [repIndices[repIndices.length - 1]],
          marker: {
            color: node.render.color,
            size: markerSize,
            symbol: 'triangle-down',
          },
          showlegend: false,
          hovertemplate: 'End<extra></extra>',
        })
      }

      if (bifX.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} bifurcations`,
          uid: branchId,
          x: bifX,
          y: bifY,
          customdata: bifIndices,
          marker: {
            color: node.render.color,
            size: markerSize + 2,
            symbol: 'diamond',
          },
          text: bifLabels,
          showlegend: false,
          hovertemplate: '%{text}<extra></extra>',
        })
      }

      appendSelectedPointMarker(
        branchId,
        branch,
        indices,
        repIndices,
        [{ x: repX, y: repY }],
        markerSize,
        node.render.color
      )
      continue
    }

    if (hasMixedAxes && isLimitCycleBranch) {
      const parameterAxis = xAxis.kind === 'parameter' ? xAxis : yAxis
      const stateAxis = xAxis.kind === 'state' ? xAxis : yAxis
      const xMin: number[] = []
      const yMin: number[] = []
      const xMax: number[] = []
      const yMax: number[] = []

      for (const idx of order) {
        const point = branch.data.points[idx]
        if (!point) continue
        const paramValue = resolveAxisValue(system, branch, point, parameterAxis, branchParams)
        const envelope = resolveLimitCycleEnvelope(system, branch, point, stateAxis)
        if (paramValue === null || !Number.isFinite(paramValue) || !envelope) continue
        const { min, max } = envelope
        const values =
          xAxis.kind === 'parameter'
            ? { xMin: paramValue, yMin: min, xMax: paramValue, yMax: max }
            : { xMin: min, yMin: paramValue, xMax: max, yMax: paramValue }
        if (
          !Number.isFinite(values.xMin) ||
          !Number.isFinite(values.yMin) ||
          !Number.isFinite(values.xMax) ||
          !Number.isFinite(values.yMax)
        ) {
          continue
        }
        xMin.push(values.xMin)
        yMin.push(values.yMin)
        xMax.push(values.xMax)
        yMax.push(values.yMax)
        pointIndices.push(idx)
      }

      if (xMax.length === 0 || yMax.length === 0) continue
      hasData = true

      const highlight = branchId === selectedNodeId
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const lineDash = resolveLineDash(node.render.lineStyle)

      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: branch.name,
        uid: branchId,
        x: xMax,
        y: yMax,
        customdata: pointIndices,
        line: {
          color: node.render.color,
          width: lineWidth,
          dash: lineDash,
        },
      })

      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: `${branch.name} min`,
        uid: branchId,
        x: xMin,
        y: yMin,
        customdata: pointIndices,
        line: {
          color: node.render.color,
          width: lineWidth,
          dash: lineDash,
        },
        showlegend: false,
      })

      appendMultiLineMarkers(
        branchId,
        branch,
        indices,
        pointIndices,
        [
          { x: xMax, y: yMax },
          { x: xMin, y: yMin },
        ],
        markerSize,
        node.render.color
      )
      appendSelectedPointMarker(
        branchId,
        branch,
        indices,
        pointIndices,
        [
          { x: xMax, y: yMax },
          { x: xMin, y: yMin },
        ],
        markerSize,
        node.render.color
      )
      continue
    }

    if (useMixedCyclePoints) {
      const stateAxis = xAxis.kind === 'state' ? xAxis : yAxis
      const paramAxis = xAxis.kind === 'parameter' ? xAxis : yAxis
      const stateIndex = system.config.varNames.indexOf(stateAxis.name)
      if (stateIndex < 0) continue

      const cycleLines = new Map<number, { x: Array<number | null>; y: Array<number | null> }>()
      for (const idx of order) {
        const point = branch.data.points[idx]
        if (!point) continue
        const paramValue = resolveAxisValue(system, branch, point, paramAxis, branchParams)
        if (paramValue === null || !Number.isFinite(paramValue)) continue
        const cycleStates =
          point.cycle_points && point.cycle_points.length > 0
            ? point.cycle_points
            : [point.state]
        const representative = cycleStates[0] ?? point.state
        const repStateValue = representative[stateIndex]
        if (!Number.isFinite(repStateValue)) continue
        const repX = xAxis.kind === 'parameter' ? paramValue : repStateValue
        const repY = yAxis.kind === 'parameter' ? paramValue : repStateValue
        if (!Number.isFinite(repX) || !Number.isFinite(repY)) continue
        const pointPosition = x.length
        for (const line of cycleLines.values()) {
          line.x.push(null)
          line.y.push(null)
        }

        for (let cycleIndex = 1; cycleIndex < cycleStates.length; cycleIndex += 1) {
          const cycleState = cycleStates[cycleIndex]
          const cycleStateValue = cycleState[stateIndex]
          if (!Number.isFinite(cycleStateValue)) continue
          const valueX = xAxis.kind === 'parameter' ? paramValue : cycleStateValue
          const valueY = yAxis.kind === 'parameter' ? paramValue : cycleStateValue
          if (!Number.isFinite(valueX) || !Number.isFinite(valueY)) continue
          const line = cycleLines.get(cycleIndex)
          if (line) {
            line.x[pointPosition] = valueX
            line.y[pointPosition] = valueY
          } else {
            const seed = {
              x: Array(pointPosition).fill(null),
              y: Array(pointPosition).fill(null),
            }
            seed.x.push(valueX)
            seed.y.push(valueY)
            cycleLines.set(cycleIndex, seed)
          }
        }

        x.push(repX)
        y.push(repY)
        pointIndices.push(idx)
      }

      if (x.length === 0 || y.length === 0) continue
      hasData = true

      const highlight = branchId === selectedNodeId
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const lineDash = resolveLineDash(node.render.lineStyle)

      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: branch.name,
        uid: branchId,
        x,
        y,
        customdata: pointIndices,
        line: {
          color: node.render.color,
          width: lineWidth,
          dash: lineDash,
        },
      })

      for (const [cycleIndex, line] of cycleLines.entries()) {
        const hasValues = line.x.some(
          (value) => typeof value === 'number' && Number.isFinite(value)
        )
        if (!hasValues) continue
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: `${branch.name} cycle ${cycleIndex + 1}`,
          uid: branchId,
          x: line.x,
          y: line.y,
          customdata: pointIndices,
          line: {
            color: node.render.color,
            width: lineWidth,
            dash: lineDash,
          },
          showlegend: false,
          connectgaps: false,
        })
      }

      appendMultiLineMarkers(
        branchId,
        branch,
        indices,
        pointIndices,
        [{ x, y }, ...Array.from(cycleLines.values())],
        markerSize,
        node.render.color
      )
      appendSelectedPointMarker(
        branchId,
        branch,
        indices,
        pointIndices,
        [{ x, y }, ...Array.from(cycleLines.values())],
        markerSize,
        node.render.color
      )
      continue
    }

    if (
      useCyclePoints &&
      stateAxisIndices &&
      stateAxisIndices[0] >= 0 &&
      stateAxisIndices[1] >= 0
    ) {
      const axisX = stateAxisIndices[0]
      const axisY = stateAxisIndices[1]
      const cycleX: number[] = []
      const cycleY: number[] = []
      const cycleIndices: number[] = []
      const repPoints = new Map<number, { x: number; y: number }>()

      for (const idx of order) {
        const point = branch.data.points[idx]
        if (!point) continue
        const cycleStates =
          point.cycle_points && point.cycle_points.length > 0
            ? point.cycle_points
            : [point.state]
        const representative = cycleStates[0] ?? point.state
        const repX = representative[axisX]
        const repY = representative[axisY]
        if (!Number.isFinite(repX) || !Number.isFinite(repY)) continue
        x.push(repX)
        y.push(repY)
        pointIndices.push(idx)
        repPoints.set(idx, { x: repX, y: repY })

        for (let cycleIndex = 1; cycleIndex < cycleStates.length; cycleIndex += 1) {
          const cycleState = cycleStates[cycleIndex]
          const valueX = cycleState[axisX]
          const valueY = cycleState[axisY]
          if (!Number.isFinite(valueX) || !Number.isFinite(valueY)) continue
          cycleX.push(valueX)
          cycleY.push(valueY)
          cycleIndices.push(idx)
        }
      }

      if (x.length === 0 || y.length === 0) continue
      hasData = true

      const highlight = branchId === selectedNodeId
      const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
      const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize
      const lineDash = resolveLineDash(node.render.lineStyle)

      traces.push({
        type: 'scatter',
        mode: 'lines',
        name: branch.name,
        uid: branchId,
        x,
        y,
        customdata: pointIndices,
        line: {
          color: node.render.color,
          width: lineWidth,
          dash: lineDash,
        },
      })

      if (cycleX.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} cycle`,
          uid: branchId,
          x: cycleX,
          y: cycleY,
          customdata: cycleIndices,
          marker: {
            color: node.render.color,
            size: markerSize,
          },
          showlegend: false,
        })
      }

      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${branch.name} start`,
        uid: branchId,
        x: [x[0]],
        y: [y[0]],
        customdata: [pointIndices[0]],
        marker: {
          color: node.render.color,
          size: markerSize,
          symbol: 'triangle-up',
        },
        showlegend: false,
        hovertemplate: 'Start<extra></extra>',
      })

      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${branch.name} end`,
        uid: branchId,
        x: [x[x.length - 1]],
        y: [y[y.length - 1]],
        customdata: [pointIndices[pointIndices.length - 1]],
        marker: {
          color: node.render.color,
          size: markerSize,
          symbol: 'triangle-down',
        },
        showlegend: false,
        hovertemplate: 'End<extra></extra>',
      })

      if (branch.data.bifurcations && branch.data.bifurcations.length > 0) {
        const bx: number[] = []
        const by: number[] = []
        const labels: string[] = []
        const bifIndices: number[] = []
        for (const bifIndex of branch.data.bifurcations) {
          const point = branch.data.points[bifIndex]
          const repPoint = repPoints.get(bifIndex)
          if (!point || !repPoint) continue
          const { x: xValue, y: yValue } = repPoint
          if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
          bx.push(xValue)
          by.push(yValue)
          bifIndices.push(bifIndex)
          const logicalIndex = indices[bifIndex]
          const displayIndex = Number.isFinite(logicalIndex) ? logicalIndex : bifIndex
          labels.push(formatBifurcationLabel(displayIndex, point.stability))
        }
        if (bx.length > 0) {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            name: `${branch.name} bifurcations`,
            uid: branchId,
            x: bx,
            y: by,
            customdata: bifIndices,
            marker: {
              color: node.render.color,
              size: markerSize + 2,
              symbol: 'diamond',
            },
            text: labels,
            showlegend: false,
            hovertemplate: '%{text}<extra></extra>',
          })
        }
      }
      appendSelectedPointMarker(
        branchId,
        branch,
        indices,
        pointIndices,
        [{ x, y }],
        markerSize,
        node.render.color
      )
      continue
    }

    for (const idx of order) {
      const point = branch.data.points[idx]
      if (!point) continue
      const xValue = resolveAxisValue(system, branch, point, xAxis, branchParams)
      const yValue = resolveAxisValue(system, branch, point, yAxis, branchParams)
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
      x.push(xValue as number)
      y.push(yValue as number)
      pointIndices.push(idx)
    }

    if (x.length === 0 || y.length === 0) continue
    hasData = true

    const highlight = branchId === selectedNodeId
    const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
    const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize
    const lineDash = resolveLineDash(node.render.lineStyle)

    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: branch.name,
      uid: branchId,
      x,
      y,
      customdata: pointIndices,
      line: {
        color: node.render.color,
        width: lineWidth,
        dash: lineDash,
      },
    })

    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: `${branch.name} start`,
      uid: branchId,
      x: [x[0]],
      y: [y[0]],
      customdata: [pointIndices[0]],
      marker: {
        color: node.render.color,
        size: markerSize,
        symbol: 'triangle-up',
      },
      showlegend: false,
      hovertemplate: 'Start<extra></extra>',
    })

    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: `${branch.name} end`,
      uid: branchId,
      x: [x[x.length - 1]],
      y: [y[y.length - 1]],
      customdata: [pointIndices[pointIndices.length - 1]],
      marker: {
        color: node.render.color,
        size: markerSize,
        symbol: 'triangle-down',
      },
      showlegend: false,
      hovertemplate: 'End<extra></extra>',
    })

    if (branch.data.bifurcations && branch.data.bifurcations.length > 0) {
      const bx: number[] = []
      const by: number[] = []
      const labels: string[] = []
      const bifIndices: number[] = []
      for (const bifIndex of branch.data.bifurcations) {
        const point = branch.data.points[bifIndex]
        if (!point) continue
        const xValue = resolveAxisValue(system, branch, point, xAxis, branchParams)
        const yValue = resolveAxisValue(system, branch, point, yAxis, branchParams)
        if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
        bx.push(xValue as number)
        by.push(yValue as number)
        bifIndices.push(bifIndex)
        const logicalIndex = indices[bifIndex]
        const displayIndex = Number.isFinite(logicalIndex) ? logicalIndex : bifIndex
        labels.push(formatBifurcationLabel(displayIndex, point.stability))
      }
      if (bx.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${branch.name} bifurcations`,
          uid: branchId,
          x: bx,
          y: by,
          customdata: bifIndices,
          marker: {
            color: node.render.color,
            size: markerSize + 2,
            symbol: 'diamond',
          },
          text: labels,
          showlegend: false,
          hovertemplate: '%{text}<extra></extra>',
        })
      }
    }

    appendSelectedPointMarker(
      branchId,
      branch,
      indices,
      pointIndices,
      [{ x, y }],
      markerSize,
      node.render.color
    )
  }

  return { traces, hasAxes, hasBranches, hasData, xTitle, yTitle }
}

function buildSceneBaseLayout(
  config: SystemConfig,
  axisVariables: SceneAxisVariables | null | undefined,
  plotlyTheme: PlotlyThemeTokens
): Partial<Layout> {
  const base = {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: plotlyTheme.background,
    plot_bgcolor: plotlyTheme.background,
    showlegend: false,
    legend: { font: { color: plotlyTheme.text } },
    font: { color: plotlyTheme.text },
  } satisfies Partial<Layout>

  const varNames = config.varNames
  const axisSelection = resolveSceneAxisSelection(varNames, axisVariables)
  const axisLabels = axisSelection ?? {
    x: varNames[0] ?? 'x',
    y: varNames[1] ?? 'y',
    z: varNames[2] ?? 'z',
  }
  const panMode = varNames.length === 2 ? { dragmode: 'pan' as const } : {}
  if (varNames.length >= 3) {
    return {
      ...base,
      scene: {
        xaxis: {
          title: { text: axisLabels.x, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        yaxis: {
          title: { text: axisLabels.y, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        zaxis: {
          title: { text: axisLabels.z, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        bgcolor: plotlyTheme.background,
        aspectmode: 'data',
      },
    }
  }

  if (varNames.length === 1 && config.type === 'map') {
    const name = varNames[0] ?? 'x'
    return {
      ...base,
      xaxis: {
        title: { text: `${name}_n`, font: { color: plotlyTheme.text } },
        tickfont: { color: plotlyTheme.text },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
      yaxis: {
        title: { text: `${name}_{n+1}`, font: { color: plotlyTheme.text } },
        tickfont: { color: plotlyTheme.text },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
    }
  }

  if (varNames.length === 1) {
    return {
      ...base,
      xaxis: {
        title: { text: 't', font: { color: plotlyTheme.text } },
        tickfont: { color: plotlyTheme.text },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
      yaxis: {
        title: { text: varNames[0] ?? 'x', font: { color: plotlyTheme.text } },
        tickfont: { color: plotlyTheme.text },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
    }
  }

  return {
    ...base,
    ...panMode,
    xaxis: {
      zerolinecolor: 'rgba(120,120,120,0.3)',
      tickfont: { color: plotlyTheme.text },
    },
    yaxis: {
      zerolinecolor: 'rgba(120,120,120,0.3)',
      tickfont: { color: plotlyTheme.text },
    },
  }
}

function buildDiagramBaseLayout(
  traceState: DiagramTraceState | null,
  plotlyTheme: PlotlyThemeTokens
): Partial<Layout> {
  const hasAxes = traceState?.hasAxes ?? false
  const hasBranches = traceState?.hasBranches ?? false
  const hasData = traceState?.hasData ?? false
  const xTitle = traceState?.xTitle ?? ''
  const yTitle = traceState?.yTitle ?? ''
  let message: string | null = null

  if (!hasAxes) {
    message = 'Select axes to configure this diagram.'
  } else if (!hasBranches) {
    message = 'No visible branches available for this diagram.'
  } else if (!hasData) {
    message = 'No bifurcation data available for the selected axes.'
  }

  return {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: plotlyTheme.background,
    plot_bgcolor: plotlyTheme.background,
    showlegend: hasData,
    dragmode: 'pan',
    font: { color: plotlyTheme.text },
    legend: {
      font: { color: plotlyTheme.text },
      itemclick: false,
      itemdoubleclick: false,
    },
    xaxis: hasAxes
      ? {
          title: { text: xTitle, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
          gridcolor: 'rgba(120,120,120,0.15)',
          automargin: true,
        }
      : { visible: false },
    yaxis: hasAxes
      ? {
          title: { text: yTitle, font: { color: plotlyTheme.text } },
          tickfont: { color: plotlyTheme.text },
          zerolinecolor: 'rgba(120,120,120,0.3)',
          gridcolor: 'rgba(120,120,120,0.15)',
          automargin: true,
        }
      : { visible: false },
    annotations: message
      ? [
          {
            text: message,
            x: 0.5,
            y: 0.5,
            xref: 'paper',
            yref: 'paper',
            showarrow: false,
            font: { color: plotlyTheme.muted, size: 12 },
          },
        ]
      : [],
  }
}


function appendAxisRangeSnapshot(
  snapshot: PlotlyRelayoutEvent,
  axis: 'xaxis' | 'yaxis',
  range: AxisRange | null | undefined
) {
  if (range === undefined) return
  if (range === null) {
    snapshot[`${axis}.autorange`] = true
    return
  }
  const start = range[0]
  const end = range[1]
  if (Number.isFinite(start) && Number.isFinite(end)) {
    snapshot[`${axis}.range`] = [start, end]
  }
}

type PlotlyCameraSpec = {
  eye: { x: number; y: number; z: number }
  center: { x: number; y: number; z: number }
  up: { x: number; y: number; z: number }
}

function isVector3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Number.isFinite(record.x) && Number.isFinite(record.y) && Number.isFinite(record.z)
  )
}

function isCameraSpec(camera: unknown): camera is PlotlyCameraSpec {
  if (!camera || typeof camera !== 'object') return false
  const record = camera as Record<string, unknown>
  return isVector3(record.eye) && isVector3(record.center) && isVector3(record.up)
}

function buildSceneInitialView(system: System, scene: Scene): PlotlyRelayoutEvent | null {
  const snapshot: PlotlyRelayoutEvent = {}
  if (system.config.varNames.length >= 3) {
    if (isCameraSpec(scene.camera)) {
      snapshot['scene.camera'] = {
        eye: { ...scene.camera.eye },
        center: { ...scene.camera.center },
        up: { ...scene.camera.up },
      }
    }
  } else {
    appendAxisRangeSnapshot(snapshot, 'xaxis', scene.axisRanges.x)
    appendAxisRangeSnapshot(snapshot, 'yaxis', scene.axisRanges.y)
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null
}

function buildDiagramInitialView(diagram: BifurcationDiagram): PlotlyRelayoutEvent | null {
  const snapshot: PlotlyRelayoutEvent = {}
  appendAxisRangeSnapshot(snapshot, 'xaxis', diagram.axisRanges.x)
  appendAxisRangeSnapshot(snapshot, 'yaxis', diagram.axisRanges.y)
  return Object.keys(snapshot).length > 0 ? snapshot : null
}

function ViewportTile({
  system,
  entry,
  selectedNodeId,
  branchPointSelection,
  mapRange,
  mapFunctionSamples,
  draggingId,
  dragOverId,
  setDraggingId,
  setDragOverId,
  onSelectViewport,
  onSelectObject,
  onSelectBranchPoint,
  onSelectOrbitPoint,
  onSelectLimitCyclePoint,
  onReorderViewport,
  onResizeStart,
  onToggleViewport,
  onContextMenu,
  isEditing,
  draftName,
  onDraftNameChange,
  onCommitRename,
  onCancelRename,
  plotlyTheme,
  isoclineGeometryCache,
}: ViewportTileProps) {
  const { node, scene, diagram } = entry
  const isSelected = node.id === selectedNodeId
  const isDragging = draggingId === node.id
  const isDropTarget = dragOverId === node.id && draggingId !== node.id
  const isCollapsed = !node.expanded
  const [timeSeriesState, setTimeSeriesState] = useState<{
    sceneId: string | null
    range: [number, number] | null
    height: number | null
  }>(() => ({
    sceneId: scene?.id ?? null,
    range: null,
    height: null,
  }))
  const [plotSize, setPlotSize] = useState<PlotSize | null>(null)
  const activeSceneId = scene?.id ?? null
  const timeSeriesRange =
    timeSeriesState.sceneId === activeSceneId ? timeSeriesState.range : null
  const plotHeight =
    timeSeriesState.sceneId === activeSceneId ? timeSeriesState.height : null

  const handlePointClick = useCallback(
    (event: PlotlyPointClick) => {
      const uid = event.uid
      if (typeof uid === 'string') {
        onSelectObject(uid)
      }

      const pointIndex = resolvePointIndex(event)
      if (pointIndex === null || typeof uid !== 'string') return

      const node = system.nodes[uid]
      if (!node) return

      if (node.kind === 'branch') {
        if (!diagram) return
        onSelectBranchPoint?.({ branchId: uid, pointIndex })
        return
      }

      if (node.kind !== 'object') return
      const object = system.objects[uid]
      if (!object) return

      if (object.type === 'orbit') {
        if (pointIndex >= 0 && pointIndex < object.data.length) {
          onSelectOrbitPoint?.({ orbitId: uid, pointIndex })
        }
      } else if (object.type === 'limit_cycle') {
        if (pointIndex >= 0) {
          onSelectLimitCyclePoint?.({ limitCycleId: uid, pointIndex })
        }
      }
    },
    [
      diagram,
      onSelectBranchPoint,
      onSelectLimitCyclePoint,
      onSelectObject,
      onSelectOrbitPoint,
      system.nodes,
      system.objects,
    ]
  )

  const handleResize = useCallback(
    (size: { width: number; height: number }) => {
      if (!scene) return
      setPlotSize((prev) => {
        if (prev && prev.width === size.width && prev.height === size.height) {
          return prev
        }
        return { width: size.width, height: size.height }
      })
      if (system.config.varNames.length !== 1 || system.config.type === 'map') return
      const height = size.height
      const sceneId = scene.id
      setTimeSeriesState((prev) => {
        if (prev.sceneId !== sceneId) {
          return { sceneId, range: null, height }
        }
        if (prev.height === height) {
          return prev
        }
        return { ...prev, height }
      })
    },
    [scene, system.config.type, system.config.varNames.length]
  )

  const timeSeriesMeta = useMemo(() => {
    if (!scene || system.config.varNames.length !== 1 || system.config.type === 'map') return null
    return { yRange: timeSeriesRange, height: plotHeight }
  }, [plotHeight, scene, system.config.type, system.config.varNames.length, timeSeriesRange])

  const diagramTraceState = useMemo(() => {
    if (!diagram) return null
    return buildDiagramTraces(
      system,
      diagram,
      selectedNodeId,
      branchPointSelection ?? null
    )
  }, [branchPointSelection, diagram, selectedNodeId, system])

  const viewRevision = scene?.viewRevision ?? diagram?.viewRevision ?? 0
  const initialView = useMemo(() => {
    if (scene) return buildSceneInitialView(system, scene)
    if (diagram) return buildDiagramInitialView(diagram)
    return null
  }, [diagram, scene, system])

  const layout = useMemo(() => {
    if (scene) return buildSceneBaseLayout(system.config, scene.axisVariables, plotlyTheme)
    if (diagram) return buildDiagramBaseLayout(diagramTraceState, plotlyTheme)
    const fallbackAxisVariables = system.scenes[0]?.axisVariables ?? null
    return buildSceneBaseLayout(system.config, fallbackAxisVariables, plotlyTheme)
  }, [
    diagram,
    diagramTraceState,
    plotlyTheme,
    scene,
    system.config,
    system.scenes,
  ])

  const plotAreaSize = useMemo(() => {
    if (!plotSize) return null
    const margin = layout.margin
    const left = typeof margin?.l === 'number' ? margin.l : 0
    const right = typeof margin?.r === 'number' ? margin.r : 0
    const top = typeof margin?.t === 'number' ? margin.t : 0
    const bottom = typeof margin?.b === 'number' ? margin.b : 0
    return {
      width: Math.max(1, plotSize.width - left - right),
      height: Math.max(1, plotSize.height - top - bottom),
    }
  }, [layout.margin, plotSize])

  const sceneTraces = useMemo(() => {
    if (!scene) return EMPTY_TRACES
    return buildSceneTraces(
      system,
      scene,
      selectedNodeId,
      isoclineGeometryCache,
      timeSeriesMeta,
      mapRange,
      mapFunctionSamples,
      plotAreaSize
    )
  }, [
    mapFunctionSamples,
    mapRange,
    plotAreaSize,
    scene,
    selectedNodeId,
    isoclineGeometryCache,
    system,
    timeSeriesMeta,
  ])

  const limitCyclePreviewTraces = useMemo(() => {
    if (!scene) return EMPTY_TRACES
    const axisIndices = resolveSceneAxisIndices(
      system.config.varNames,
      scene.axisVariables
    )
    return buildLimitCyclePreviewTraces(
      system,
      branchPointSelection ?? null,
      axisIndices
    )
  }, [branchPointSelection, scene, system])

  const data = useMemo(() => {
    if (scene) {
      if (limitCyclePreviewTraces.length === 0) return sceneTraces
      return [...sceneTraces, ...limitCyclePreviewTraces]
    }
    if (diagram) return diagramTraceState?.traces ?? EMPTY_TRACES
    return EMPTY_TRACES
  }, [
    diagram,
    diagramTraceState,
    limitCyclePreviewTraces,
    scene,
    sceneTraces,
  ])

  const label = scene ? 'State Space' : 'Bifurcation Diagram'
  const viewportTypeClass = diagram ? 'viewport-tile--diagram' : ''

  return (
    <section
      className={`viewport-tile ${isCollapsed ? 'viewport-tile--collapsed' : ''} ${
        isSelected ? 'viewport-tile--selected' : ''
      } ${isDropTarget ? 'viewport-tile--drop' : ''} ${viewportTypeClass}`}
      data-testid={`viewport-tile-${node.id}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOverId(node.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        const sourceId = event.dataTransfer.getData('text/plain') || draggingId
        if (sourceId && sourceId !== node.id) {
          onReorderViewport(sourceId, node.id)
        }
        setDragOverId(null)
        setDraggingId(null)
      }}
    >
      <header
        className={`viewport-tile__header ${isDragging ? 'is-dragging' : ''}`}
        onClick={() => onSelectViewport(node.id)}
        onContextMenu={(event) => onContextMenu(event, node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectViewport(node.id)
          }
        }}
        role="button"
        tabIndex={0}
        data-testid={`viewport-header-${node.id}`}
      >
        <button
          className="viewport-tile__toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggleViewport(node.id)
          }}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name} viewport`}
          data-testid={`viewport-toggle-${node.id}`}
        >
          {isCollapsed ? '▸' : '▾'}
        </button>
        <button
          className="viewport-tile__handle"
          draggable
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', node.id)
            setDraggingId(node.id)
          }}
          onDragEnd={() => {
            setDraggingId(null)
            setDragOverId(null)
          }}
          aria-label={`Drag ${node.name} viewport`}
          data-testid={`viewport-drag-${node.id}`}
        >
          ::
        </button>
        {isEditing ? (
          <input
            className="viewport-tile__rename"
            value={draftName}
            autoFocus
            onChange={(event) => onDraftNameChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={onCommitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommitRename()
              if (event.key === 'Escape') onCancelRename()
            }}
            data-testid={`viewport-rename-input-${node.id}`}
          />
        ) : (
          <div className="viewport-tile__title">
            <span>{node.name}</span>
            <span className="viewport-tile__meta">{label}</span>
          </div>
        )}
      </header>
      {isCollapsed ? null : (
        <>
          <div className="viewport-tile__body">
            <PlotlyViewport
              plotId={node.id}
              data={data}
              layout={layout}
              viewRevision={viewRevision}
              persistView
              initialView={initialView}
              testId={`plotly-viewport-${node.id}`}
              onPointClick={scene || diagram ? handlePointClick : undefined}
              onResize={scene ? handleResize : undefined}
            />
          </div>
          <div
            className="viewport-resize-handle"
            onPointerDown={(event) => onResizeStart(node.id, event)}
            data-testid={`viewport-resize-${node.id}`}
          />
        </>
      )}
    </section>
  )
}

export function ViewportPanel({
  system,
  selectedNodeId,
  branchPointSelection,
  theme,
  onSelectViewport,
  onSelectObject,
  onSelectBranchPoint,
  onSelectOrbitPoint,
  onSelectLimitCyclePoint,
  onReorderViewport,
  onResizeViewport,
  onToggleViewport,
  onCreateScene,
  onCreateBifurcation,
  onRenameViewport,
  onDeleteViewport,
  onSampleMap1DFunction,
  isoclineGeometryCache,
}: ViewportPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [createMenu, setCreateMenu] = useState<{
    x: number
    y: number
    targetId: string | null
  } | null>(null)
  const createMenuRef = useRef<HTMLDivElement | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const nodeContextMenuRef = useRef<HTMLDivElement | null>(null)
  const [mapFunctionSamples, setMapFunctionSamples] = useState<MapFunctionSamples | null>(null)
  const viewportHeights = system.ui.viewportHeights
  const tileRefs = useRef(new Map<string, HTMLDivElement | null>())
  const resizeRef = useRef<{
    startY: number
    startHeight: number
    id: string
  } | null>(null)
  const mapRequestKeyRef = useRef<string | null>(null)
  const mapKeyRef = useRef<string | null>(null)
  const plotlyTheme = useMemo(() => resolvePlotlyThemeTokens(theme), [theme])

  const viewports = useMemo(() => {
    const entries: ViewportEntry[] = []
    for (const nodeId of system.rootIds) {
      const node = system.nodes[nodeId]
      if (!node) continue
      if (node.kind === 'scene') {
        const scene = system.scenes.find((entry) => entry.id === nodeId)
        if (!scene) continue
        entries.push({ node, scene })
      } else if (node.kind === 'diagram') {
        const diagram = system.bifurcationDiagrams.find((entry) => entry.id === nodeId)
        if (!diagram) continue
        entries.push({ node, diagram })
      }
    }
    return entries
  }, [system])

  const isMap1D = system.config.type === 'map' && system.config.varNames.length === 1
  const mapRangeKey = useMemo(() => {
    if (!isMap1D) return null
    const range = collectMap1DRange(system)
    if (!range) return null
    return `${range[0]}|${range[1]}`
  }, [isMap1D, system])
  const mapRangeValues = useMemo(() => {
    if (!mapRangeKey) return null
    const parts = mapRangeKey.split('|').map((value) => Number(value))
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
      return null
    }
    return [parts[0], parts[1]] as [number, number]
  }, [mapRangeKey])
  const mapConfigJson = isMap1D
    ? JSON.stringify({
        ...system.config,
        equations: [...system.config.equations],
        params: [...system.config.params],
        paramNames: [...system.config.paramNames],
        varNames: [...system.config.varNames],
      })
    : null
  const mapConfig = useMemo(() => {
    if (!mapConfigJson) return null
    return JSON.parse(mapConfigJson) as SampleMap1DFunctionRequest['system']
  }, [mapConfigJson])
  const mapKey = mapConfigJson && mapRangeKey ? `${mapConfigJson}|${mapRangeKey}` : null
  const activeMapFunction =
    mapFunctionSamples && mapFunctionSamples.key === mapKey ? mapFunctionSamples : null
  const hasMapSamples = Boolean(activeMapFunction)

  useEffect(() => {
    mapKeyRef.current = mapKey
  }, [mapKey])

  useEffect(() => {
    let disposed = false
    if (!isMap1D || !mapKey || !mapConfig || !mapRangeValues || !onSampleMap1DFunction) {
      mapRequestKeyRef.current = null
      return
    }
    if (hasMapSamples) return
    if (mapRequestKeyRef.current === mapKey) return

    const requestKey = mapKey
    mapRequestKeyRef.current = requestKey
    mapKeyRef.current = requestKey
    const controller = new AbortController()
    const request: SampleMap1DFunctionRequest = {
      system: mapConfig,
      min: mapRangeValues[0],
      max: mapRangeValues[1],
      samples: MAP_FUNCTION_SAMPLE_COUNT,
    }

    onSampleMap1DFunction(request, { signal: controller.signal })
      .then((result) => {
        if (disposed) return
        if (mapKeyRef.current !== requestKey) return
        setMapFunctionSamples({
          key: requestKey,
          range: mapRangeValues,
          x: result.x,
          y: result.y,
        })
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        if (disposed) return
        if (mapKeyRef.current !== requestKey) return
        setMapFunctionSamples(null)
      })
      .finally(() => {
        if (mapRequestKeyRef.current === requestKey) {
          mapRequestKeyRef.current = null
        }
      })

    return () => {
      disposed = true
      controller.abort()
      if (mapRequestKeyRef.current === requestKey) {
        mapRequestKeyRef.current = null
      }
    }
  }, [
    hasMapSamples,
    isMap1D,
    mapConfig,
    mapKey,
    mapRangeValues,
    onSampleMap1DFunction,
    system,
  ])

  useEffect(() => {
    if (!createMenu && !nodeContextMenu) return
    const handlePointerDown = () => {
      setCreateMenu(null)
      setNodeContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateMenu(null)
        setNodeContextMenu(null)
        setEditingId(null)
      }
    }
    const handleBlur = () => {
      setCreateMenu(null)
      setNodeContextMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleBlur)
    }
  }, [createMenu, nodeContextMenu])

  useLayoutEffect(() => {
    if (!createMenu || !createMenuRef.current) return
    const rect = createMenuRef.current.getBoundingClientRect()
    if (!rect.width) return
    const clampedX = clampMenuX(createMenu.x, rect.width)
    if (clampedX === createMenu.x) return
    setCreateMenu((prev) => (prev ? { ...prev, x: clampedX } : prev))
  }, [createMenu])

  useLayoutEffect(() => {
    if (!nodeContextMenu || !nodeContextMenuRef.current) return
    const rect = nodeContextMenuRef.current.getBoundingClientRect()
    if (!rect.width) return
    const clampedX = clampMenuX(nodeContextMenu.x, rect.width)
    if (clampedX === nodeContextMenu.x) return
    setNodeContextMenu((prev) => (prev ? { ...prev, x: clampedX } : prev))
  }, [nodeContextMenu])

  const openCreateMenu = (event: React.MouseEvent, targetId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    setNodeContextMenu(null)
    setCreateMenu({ x: event.clientX, y: event.clientY, targetId })
  }

  const openNodeMenu = (event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectViewport(nodeId)
    setCreateMenu(null)
    setNodeContextMenu({ id: nodeId, x: event.clientX, y: event.clientY })
  }

  const startRename = (node: TreeNode) => {
    setEditingId(node.id)
    setDraftName(node.name)
  }

  const commitRename = (node: TreeNode) => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== node.name) {
      onRenameViewport(node.id, trimmed)
    }
    setEditingId(null)
  }

  const cancelRename = () => {
    setEditingId(null)
  }

  const startResize = (id: string, event: React.PointerEvent) => {
    const node = tileRefs.current.get(id)
    if (!node) return
    event.preventDefault()
    event.stopPropagation()
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    resizeRef.current = {
      id,
      startY: event.clientY,
      startHeight: node.getBoundingClientRect().height,
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (!resizeRef.current) return
      const { startY, startHeight, id: targetId } = resizeRef.current
      const delta = moveEvent.clientY - startY
      const nextHeight = Math.max(MIN_VIEWPORT_HEIGHT, startHeight + delta)
      onResizeViewport(targetId, nextHeight)
    }

    const handleUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const createMenuNode = createMenu ? (
    <div
      className="context-menu"
      style={{ left: createMenu.x, top: createMenu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      ref={createMenuRef}
      data-testid="viewport-create-menu"
    >
      <button
        className="context-menu__item"
        onClick={() => {
          onCreateScene(createMenu.targetId)
          setCreateMenu(null)
        }}
        data-testid="viewport-create-scene"
      >
        State Space Scene
      </button>
      <button
        className="context-menu__item"
        onClick={() => {
          onCreateBifurcation(createMenu.targetId)
          setCreateMenu(null)
        }}
        data-testid="viewport-create-bifurcation"
      >
        Bifurcation Diagram
      </button>
    </div>
  ) : null

  if (viewports.length === 0) {
    return (
      <>
        <div className="empty-state viewport-empty">
          <p>No viewports yet.</p>
          <div className="viewport-insert viewport-insert--empty">
            <button
              className="viewport-insert__button"
              onClick={(event) => openCreateMenu(event, null)}
              aria-label="Add viewport"
              data-testid="viewport-insert-empty"
            >
              +
            </button>
          </div>
        </div>
        {createMenuNode}
      </>
    )
  }

  return (
    <div className="viewport-workspace" data-testid="viewport-workspace">
      {viewports.map((entry, index) => {
        const height = viewportHeights[entry.node.id]
        const isCollapsed = !entry.node.expanded
        const targetId = viewports[index + 1]?.node.id ?? null
        const isEditing = editingId === entry.node.id

        return (
          <Fragment key={entry.node.id}>
            <div
              className={`viewport-item${isCollapsed ? ' viewport-item--collapsed' : ''}`}
              ref={(node) => {
                tileRefs.current.set(entry.node.id, node)
              }}
              style={!isCollapsed && height ? { height } : undefined}
            >
              <ViewportTile
                system={system}
                entry={entry}
                selectedNodeId={selectedNodeId}
                branchPointSelection={branchPointSelection}
                mapRange={mapRangeValues}
                mapFunctionSamples={activeMapFunction}
                draggingId={draggingId}
                dragOverId={dragOverId}
                setDraggingId={setDraggingId}
                setDragOverId={setDragOverId}
                onSelectViewport={onSelectViewport}
                onSelectObject={onSelectObject}
                onSelectBranchPoint={onSelectBranchPoint}
                onSelectOrbitPoint={onSelectOrbitPoint}
                onSelectLimitCyclePoint={onSelectLimitCyclePoint}
                onReorderViewport={onReorderViewport}
                onResizeStart={startResize}
                onToggleViewport={onToggleViewport}
                onContextMenu={openNodeMenu}
                isEditing={isEditing}
                draftName={isEditing ? draftName : entry.node.name}
                onDraftNameChange={(value) => setDraftName(value)}
                onCommitRename={() => commitRename(entry.node)}
                onCancelRename={cancelRename}
                plotlyTheme={plotlyTheme}
                isoclineGeometryCache={isoclineGeometryCache}
              />
            </div>
            <div className="viewport-insert" data-testid={`viewport-insert-${entry.node.id}`}>
              <button
                className="viewport-insert__button"
                onClick={(event) => openCreateMenu(event, targetId)}
                aria-label="Add viewport"
              >
                +
              </button>
            </div>
          </Fragment>
        )
      })}
      {createMenuNode}
      {nodeContextMenu ? (
        <div
          className="context-menu"
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          ref={nodeContextMenuRef}
          data-testid="viewport-context-menu"
        >
          <button
            className="context-menu__item"
            onClick={() => {
              const node = system.nodes[nodeContextMenu.id]
              if (node) startRename(node)
              setNodeContextMenu(null)
            }}
            data-testid="viewport-context-rename"
          >
            Rename
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              const nodeId = nodeContextMenu.id
              const node = system.nodes[nodeId]
              setNodeContextMenu(null)
              if (!node) return
              if (
                confirmDelete({
                  name: node.name,
                  kind: getDeleteKindLabel(node, system),
                })
              ) {
                onDeleteViewport(nodeId)
              }
            }}
            data-testid="viewport-context-delete"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}
