import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type {
  BifurcationAxis,
  BifurcationDiagram,
  ClvRenderStyle,
  ContinuationObject,
  ContinuationPoint,
  OrbitObject,
  System,
  Scene,
  TreeNode,
} from '../system/types'
import type {
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
} from '../compute/ForkCoreClient'
import {
  buildSortedArrayOrder,
  ensureBranchIndices,
  formatBifurcationLabel,
  getBranchParams,
} from '../system/continuation'
import { resolveClvRender } from '../system/clv'
import { PlotlyViewport } from '../viewports/plotly/PlotlyViewport'
import { confirmDelete, getDeleteKindLabel } from './confirmDelete'

type ViewportPanelProps = {
  system: System
  selectedNodeId: string | null
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
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
  mapRange: [number, number] | null
  mapFunctionSamples: MapFunctionSamples | null
  draggingId: string | null
  dragOverId: string | null
  setDraggingId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeStart: (id: string, event: React.PointerEvent) => void
  onToggleViewport: (id: string) => void
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void
  isEditing: boolean
  draftName: string
  onDraftNameChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
}

type PlotlyRelayoutEvent = Record<string, unknown>

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

function buildClvTraces(nodeId: string, orbit: OrbitObject, clv: ClvRenderStyle): Data[] {
  const covariant = orbit.covariantVectors
  if (!covariant || covariant.vectors.length === 0) return []
  if (covariant.dim < 3 || orbit.data.length === 0) return []
  if (clv.vectorIndices.length === 0) return []

  const orbitTimes: number[] = []
  const orbitStates: Array<[number, number, number]> = []
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const row of orbit.data) {
    if (row.length < 4) continue
    const x = row[1]
    const y = row[2]
    const z = row[3]
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
  const dz = maxZ - minZ
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const length = clv.lengthScale * diag
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
      const vx = vec[0]
      const vy = vec[1]
      const vz = vec[2]
      const norm = Math.sqrt(vx * vx + vy * vy + vz * vz)
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
      lineZ.push(base[2], shaftZ, null)

      const headBaseX = shaftX
      const headBaseY = shaftY
      const headBaseZ = shaftZ
      if (showHeads) {
        headX.push(headBaseX)
        headY.push(headBaseY)
        headZ.push(headBaseZ)
        headU.push(ux)
        headV.push(uy)
        headW.push(uz)
      }
    }

    if (lineX.length > 0) {
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
    }

    if (showHeads && headX.length > 0) {
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
  })

  return traces
}

function readAxisRange(
  event: PlotlyRelayoutEvent,
  axis: 'xaxis' | 'yaxis'
): [number, number] | null | undefined {
  const autorangeKey = `${axis}.autorange`
  if (event[autorangeKey] === true) {
    return null
  }
  const rangeKey = `${axis}.range`
  const rangeValue = event[rangeKey]
  if (Array.isArray(rangeValue) && rangeValue.length === 2) {
    const start = Number(rangeValue[0])
    const end = Number(rangeValue[1])
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return [start, end]
    }
  }
  const startKey = `${axis}.range[0]`
  const endKey = `${axis}.range[1]`
  const start = event[startKey]
  const end = event[endKey]
  if (typeof start === 'number' && typeof end === 'number') {
    return [start, end]
  }
  return undefined
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
      const value = object.solution?.state?.[0]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
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

function buildSceneTraces(
  system: System,
  scene: Scene,
  selectedNodeId: string | null,
  timeSeriesMeta?: TimeSeriesViewportMeta | null,
  mapRange?: [number, number] | null,
  mapFunctionSamples?: MapFunctionSamples | null
): Data[] {
  const traces: Data[] = []
  const isMap = system.config.type === 'map'
  const isTimeSeries = system.config.varNames.length === 1 && !isMap
  const isMap1D = isMap && system.config.varNames.length === 1
  const manualSelection = scene.selectedNodeIds ?? []
  const candidateIds =
    manualSelection.length > 0
      ? manualSelection
      : scene.display === 'selection' && selectedNodeId
        ? [selectedNodeId]
        : collectVisibleObjectIds(system)
  let timeRange: [number, number] | null = null
  const pendingEquilibria: Array<{
    nodeId: string
    name: string
    value: number
    color: string
    lineWidth: number
    highlight: boolean
  }> = []
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

    if (object.type === 'equilibrium') {
      if (!object.solution || object.solution.state.length === 0) continue
      const state = object.solution.state
      const dimension = state.length
      const highlight = nodeId === selectedNodeId
      const size = highlight ? node.render.pointSize + 2 : node.render.pointSize
      if (dimension >= 3) {
        traces.push({
          type: 'scatter3d',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x: [state[0]],
          y: [state[1]],
          z: [state[2]],
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (dimension >= 2) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x: [state[0]],
          y: [state[1]],
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (isMap1D) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x: [state[0]],
          y: [state[0]],
          marker: {
            color: node.render.color,
            size,
          },
        })
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

    if (object.type !== 'orbit') continue

    const rows = object.data
    if (rows.length === 0) continue
    // Use the first three state components for 3D systems to match CLI state-space views.
    const dimension = rows[0].length - 1
    const highlight = nodeId === selectedNodeId
    if (isMap) {
      const size = highlight ? node.render.pointSize + 2 : node.render.pointSize
      if (dimension >= 3) {
        const x: number[] = []
        const y: number[] = []
        const z: number[] = []
        for (const row of rows) {
          x.push(row[1])
          y.push(row[2])
          z.push(row[3])
        }
        traces.push({
          type: 'scatter3d',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x,
          y,
          z,
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (dimension >= 2) {
        const x: number[] = []
        const y: number[] = []
        for (const row of rows) {
          x.push(row[1])
          y.push(row[2])
        }
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: object.name,
          uid: nodeId,
          x,
          y,
          marker: {
            color: node.render.color,
            size,
          },
        })
      } else if (isMap1D) {
        const diagonal: number[] = []
        for (const row of rows) {
          const value = row[1]
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
        const cobweb = buildCobwebPath(rows)
        if (cobweb.x.length > 0) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            name: object.name,
            uid: nodeId,
            x: cobweb.x,
            y: cobweb.y,
            line: {
              color: node.render.color,
              width: highlight ? node.render.lineWidth + 1 : node.render.lineWidth,
            },
            hoverinfo: 'skip',
            showlegend: false,
          })
        }
      }
    } else {
      const x: number[] = []
      const y: number[] = []
      const z: number[] = []
      if (dimension >= 3) {
        for (const row of rows) {
          x.push(row[1])
          y.push(row[2])
          z.push(row[3])
        }
      } else if (dimension >= 2) {
        for (const row of rows) {
          x.push(row[1])
          y.push(row[2])
        }
      } else {
        for (const row of rows) {
          const value = row[1]
          x.push(row[0])
          y.push(value)
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
          line: {
            color: node.render.color,
            width: highlight ? node.render.lineWidth + 1 : node.render.lineWidth,
          },
        })
      }
    }

    if (dimension >= 3 && system.config.varNames.length >= 3) {
      const clvRender = resolveClvRender(node.render?.clv, object.covariantVectors?.dim)
      if (clvRender.enabled) {
        traces.push(...buildClvTraces(nodeId, object, clvRender))
      }
    }
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
  selectedNodeId: string | null
): DiagramTraceState {
  const traces: Data[] = []
  const xAxis = diagram.xAxis
  const yAxis = diagram.yAxis
  const hasAxes = Boolean(xAxis && yAxis)
  const hasBranches = diagram.selectedBranchIds.length > 0
  const xTitle = axisTitle(xAxis)
  const yTitle = axisTitle(yAxis)

  if (!xAxis || !yAxis) {
    return { traces, hasAxes, hasBranches, hasData: false, xTitle, yTitle }
  }

  let hasData = false
  for (const branchId of diagram.selectedBranchIds) {
    const branch = system.branches[branchId]
    const node = system.nodes[branchId]
    if (!branch || !node || !node.visibility) continue
    if (!branch.data.points || branch.data.points.length === 0) continue

    const indices = ensureBranchIndices(branch.data)
    const order = buildSortedArrayOrder(indices)
    const branchParams = getBranchParams(system, branch)
    const x: number[] = []
    const y: number[] = []

    for (const idx of order) {
      const point = branch.data.points[idx]
      if (!point) continue
      const xValue = resolveAxisValue(system, branch, point, xAxis, branchParams)
      const yValue = resolveAxisValue(system, branch, point, yAxis, branchParams)
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
      x.push(xValue as number)
      y.push(yValue as number)
    }

    if (x.length === 0 || y.length === 0) continue
    hasData = true

    const highlight = branchId === selectedNodeId
    const lineWidth = highlight ? node.render.lineWidth + 1 : node.render.lineWidth
    const markerSize = highlight ? node.render.pointSize + 2 : node.render.pointSize

    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: branch.name,
      uid: branchId,
      x,
      y,
      line: {
        color: node.render.color,
        width: lineWidth,
      },
    })

    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: `${branch.name} start`,
      uid: branchId,
      x: [x[0]],
      y: [y[0]],
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
      for (const bifIndex of branch.data.bifurcations) {
        const point = branch.data.points[bifIndex]
        if (!point) continue
        const xValue = resolveAxisValue(system, branch, point, xAxis, branchParams)
        const yValue = resolveAxisValue(system, branch, point, yAxis, branchParams)
        if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue
        bx.push(xValue as number)
        by.push(yValue as number)
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
  }

  return { traces, hasAxes, hasBranches, hasData, xTitle, yTitle }
}

function buildSceneLayout(system: System, scene: Scene): Partial<Layout> {
  const uirevision = scene.id
  const base = {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: false,
    uirevision,
  } satisfies Partial<Layout>

  const varNames = system.config.varNames
  if (varNames.length >= 3) {
    return {
      ...base,
      scene: {
        xaxis: {
          title: { text: varNames[0] ?? 'x' },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        yaxis: {
          title: { text: varNames[1] ?? 'y' },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        zaxis: {
          title: { text: varNames[2] ?? 'z' },
          zerolinecolor: 'rgba(120,120,120,0.3)',
        },
        camera: {
          eye: { ...scene.camera.eye },
          center: { ...scene.camera.center },
          up: { ...scene.camera.up },
        },
        aspectmode: 'data',
      },
    }
  }

  if (varNames.length === 1 && system.config.type === 'map') {
    const name = varNames[0] ?? 'x'
    return {
      ...base,
      xaxis: {
        title: { text: `${name}_n` },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
      yaxis: {
        title: { text: `${name}_{n+1}` },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
    }
  }

  if (varNames.length === 1) {
    return {
      ...base,
      xaxis: {
        title: { text: 't' },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
      yaxis: {
        title: { text: varNames[0] ?? 'x' },
        zerolinecolor: 'rgba(120,120,120,0.3)',
      },
    }
  }

  return {
    ...base,
    xaxis: { zerolinecolor: 'rgba(120,120,120,0.3)' },
    yaxis: { zerolinecolor: 'rgba(120,120,120,0.3)' },
  }
}

function buildDiagramLayout(
  diagram: BifurcationDiagram,
  traceState: DiagramTraceState | null
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
    message = 'Select branches to configure this diagram.'
  } else if (!hasData) {
    message = 'No bifurcation data available for the selected axes.'
  }

  return {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: hasData,
    uirevision: diagram.id,
    xaxis: hasAxes
      ? {
          title: { text: xTitle },
          zerolinecolor: 'rgba(120,120,120,0.3)',
          gridcolor: 'rgba(120,120,120,0.15)',
          automargin: true,
        }
      : { visible: false },
    yaxis: hasAxes
      ? {
          title: { text: yTitle },
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
            font: { color: '#9aa3b2', size: 12 },
          },
        ]
      : [],
  }
}

function ViewportTile({
  system,
  entry,
  selectedNodeId,
  mapRange,
  mapFunctionSamples,
  draggingId,
  dragOverId,
  setDraggingId,
  setDragOverId,
  onSelectViewport,
  onSelectObject,
  onReorderViewport,
  onResizeStart,
  onToggleViewport,
  onContextMenu,
  isEditing,
  draftName,
  onDraftNameChange,
  onCommitRename,
  onCancelRename,
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
  const activeSceneId = scene?.id ?? null
  const timeSeriesRange =
    timeSeriesState.sceneId === activeSceneId ? timeSeriesState.range : null
  const plotHeight =
    timeSeriesState.sceneId === activeSceneId ? timeSeriesState.height : null

  const handleRelayout = useCallback(
    (event: PlotlyRelayoutEvent) => {
      if (!scene || system.config.varNames.length !== 1 || system.config.type === 'map') return
      const nextRange = readAxisRange(event, 'yaxis')
      if (nextRange === undefined) return
      const sceneId = scene.id
      setTimeSeriesState((prev) => {
        if (prev.sceneId !== sceneId) {
          return { sceneId, range: nextRange ?? null, height: null }
        }
        if (nextRange === null) {
          return prev.range === null ? prev : { ...prev, range: null }
        }
        if (prev.range && prev.range[0] === nextRange[0] && prev.range[1] === nextRange[1]) {
          return prev
        }
        return { ...prev, range: nextRange }
      })
    },
    [scene, system.config.type, system.config.varNames.length]
  )

  const handleResize = useCallback(
    (size: { width: number; height: number }) => {
      if (!scene || system.config.varNames.length !== 1 || system.config.type === 'map') return
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
    return buildDiagramTraces(system, diagram, selectedNodeId)
  }, [diagram, selectedNodeId, system])

  const data = useMemo(() => {
    if (scene) {
      return buildSceneTraces(
        system,
        scene,
        selectedNodeId,
        timeSeriesMeta,
        mapRange,
        mapFunctionSamples
      )
    }
    if (diagram) return diagramTraceState?.traces ?? []
    return []
  }, [
    diagram,
    diagramTraceState,
    mapFunctionSamples,
    mapRange,
    scene,
    selectedNodeId,
    system,
    timeSeriesMeta,
  ])

  const layout = useMemo(() => {
    if (scene) return buildSceneLayout(system, scene)
    if (diagram) return buildDiagramLayout(diagram, diagramTraceState)
    return buildSceneLayout(system, system.scenes[0])
  }, [system, scene, diagram, diagramTraceState])

  const label = scene ? 'State Space' : 'Bifurcation Diagram'

  return (
    <section
      className={`viewport-tile ${isCollapsed ? 'viewport-tile--collapsed' : ''} ${
        isSelected ? 'viewport-tile--selected' : ''
      } ${isDropTarget ? 'viewport-tile--drop' : ''}`}
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
              data={data}
              layout={layout}
              testId={`plotly-viewport-${node.id}`}
              onPointClick={scene || diagram ? onSelectObject : undefined}
              onRelayout={scene ? handleRelayout : undefined}
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
  onSelectViewport,
  onSelectObject,
  onReorderViewport,
  onResizeViewport,
  onToggleViewport,
  onCreateScene,
  onCreateBifurcation,
  onRenameViewport,
  onDeleteViewport,
  onSampleMap1DFunction,
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
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [mapFunctionSamples, setMapFunctionSamples] = useState<MapFunctionSamples | null>(null)
  const viewportHeights = system.ui.viewportHeights
  const tileRefs = useRef(new Map<string, HTMLDivElement | null>())
  const resizeRef = useRef<{
    startY: number
    startHeight: number
    id: string
  } | null>(null)
  const mapRequestKeyRef = useRef<string | null>(null)

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

  useEffect(() => {
    if (!isMap1D || !mapKey || !mapConfig || !mapRangeValues || !onSampleMap1DFunction) {
      mapRequestKeyRef.current = null
      return
    }
    if (mapRequestKeyRef.current === mapKey) return

    mapRequestKeyRef.current = mapKey
    const controller = new AbortController()
    const request: SampleMap1DFunctionRequest = {
      system: mapConfig,
      min: mapRangeValues[0],
      max: mapRangeValues[1],
      samples: MAP_FUNCTION_SAMPLE_COUNT,
    }

    onSampleMap1DFunction(request, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || mapRequestKeyRef.current !== mapKey) return
        setMapFunctionSamples({
          key: mapKey,
          range: mapRangeValues,
          x: result.x,
          y: result.y,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (err instanceof Error && err.name === 'AbortError') return
        setMapFunctionSamples(null)
      })

    return () => {
      controller.abort()
    }
  }, [isMap1D, mapConfig, mapKey, mapRangeValues, onSampleMap1DFunction])

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
                mapRange={mapRangeValues}
                mapFunctionSamples={activeMapFunction}
                draggingId={draggingId}
                dragOverId={dragOverId}
                setDraggingId={setDraggingId}
                setDragOverId={setDragOverId}
                onSelectViewport={onSelectViewport}
                onSelectObject={onSelectObject}
                onReorderViewport={onReorderViewport}
                onResizeStart={startResize}
                onToggleViewport={onToggleViewport}
                onContextMenu={openNodeMenu}
                isEditing={isEditing}
                draftName={isEditing ? draftName : entry.node.name}
                onDraftNameChange={(value) => setDraftName(value)}
                onCommitRename={() => commitRename(entry.node)}
                onCancelRename={cancelRename}
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
              if (confirmDelete({ name: node.name, kind: getDeleteKindLabel(node) })) {
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
