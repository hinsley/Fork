import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type { BifurcationDiagram, System, Scene, TreeNode } from '../system/types'
import { PlotlyViewport } from '../viewports/plotly/PlotlyViewport'

type ViewportPanelProps = {
  system: System
  selectedNodeId: string | null
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeViewport: (id: string, height: number) => void
}

type ViewportEntry = {
  node: TreeNode
  scene?: Scene
  diagram?: BifurcationDiagram
  hidden?: boolean
}

type ViewportTileProps = {
  system: System
  entry: ViewportEntry
  selectedNodeId: string | null
  draggingId: string | null
  dragOverId: string | null
  setDraggingId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  onSelectViewport: (id: string) => void
  onSelectObject: (id: string) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeStart: (id: string, event: React.PointerEvent) => void
}

type PlotlyRelayoutEvent = Record<string, unknown>

type TimeSeriesViewportMeta = {
  yRange?: [number, number] | null
  height?: number | null
}

const MIN_VIEWPORT_HEIGHT = 200

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

function buildSceneTraces(
  system: System,
  scene: Scene,
  selectedNodeId: string | null,
  timeSeriesMeta?: TimeSeriesViewportMeta | null
): Data[] {
  const traces: Data[] = []
  const isTimeSeries = system.config.varNames.length === 1
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

    const highlight = nodeId === selectedNodeId
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
      const band = (width * 0.75) * dataPerPixel
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

function buildDiagramLayout(diagram: BifurcationDiagram): Partial<Layout> {
  const hasBranch = Boolean(diagram.branchId)
  const message = hasBranch
    ? 'Bifurcation diagram placeholder. Awaiting design.'
    : 'Select a branch to configure this diagram.'

  return {
    autosize: true,
    margin: { l: 30, r: 20, t: 20, b: 30 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    xaxis: { visible: false },
    yaxis: { visible: false },
    showlegend: false,
    annotations: [
      {
        text: message,
        x: 0.5,
        y: 0.5,
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: { color: '#9aa3b2', size: 12 },
      },
    ],
  }
}

function ViewportTile({
  system,
  entry,
  selectedNodeId,
  draggingId,
  dragOverId,
  setDraggingId,
  setDragOverId,
  onSelectViewport,
  onSelectObject,
  onReorderViewport,
  onResizeStart,
}: ViewportTileProps) {
  const { node, scene, diagram } = entry
  const isSelected = node.id === selectedNodeId
  const isDragging = draggingId === node.id
  const isDropTarget = dragOverId === node.id && draggingId !== node.id
  const [timeSeriesRange, setTimeSeriesRange] = useState<[number, number] | null>(null)
  const [plotHeight, setPlotHeight] = useState<number | null>(null)

  useEffect(() => {
    setTimeSeriesRange(null)
    setPlotHeight(null)
  }, [scene?.id])

  const handleRelayout = useCallback(
    (event: PlotlyRelayoutEvent) => {
      if (!scene || system.config.varNames.length !== 1) return
      const nextRange = readAxisRange(event, 'yaxis')
      if (nextRange === undefined) return
      setTimeSeriesRange((prev) => {
        if (nextRange === null) {
          return prev === null ? prev : null
        }
        if (prev && prev[0] === nextRange[0] && prev[1] === nextRange[1]) {
          return prev
        }
        return nextRange
      })
    },
    [scene, system.config.varNames.length]
  )

  const handleResize = useCallback(
    (size: { width: number; height: number }) => {
      if (!scene || system.config.varNames.length !== 1) return
      const height = size.height
      setPlotHeight((prev) => (prev === height ? prev : height))
    },
    [scene, system.config.varNames.length]
  )

  const timeSeriesMeta = useMemo(() => {
    if (!scene || system.config.varNames.length !== 1) return null
    return { yRange: timeSeriesRange, height: plotHeight }
  }, [plotHeight, scene, system.config.varNames.length, timeSeriesRange])

  const data = useMemo(() => {
    if (scene) return buildSceneTraces(system, scene, selectedNodeId, timeSeriesMeta)
    return []
  }, [system, scene, selectedNodeId, timeSeriesMeta])

  const layout = useMemo(() => {
    if (scene) return buildSceneLayout(system, scene)
    if (diagram) return buildDiagramLayout(diagram)
    return buildSceneLayout(system, system.scenes[0])
  }, [system, scene, diagram])

  const label = scene ? 'State Space' : 'Bifurcation Diagram'

  return (
    <section
      className={`viewport-tile ${entry.hidden ? 'viewport-tile--hidden' : ''} ${
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
        <div className="viewport-tile__title">
          <span>{node.name}</span>
          <span className="viewport-tile__meta">{label}</span>
        </div>
      </header>
      <div className="viewport-tile__body">
        <PlotlyViewport
          data={data}
          layout={layout}
          testId={`plotly-viewport-${node.id}`}
          onPointClick={scene ? onSelectObject : undefined}
          onRelayout={scene ? handleRelayout : undefined}
          onResize={scene ? handleResize : undefined}
        />
      </div>
      <div
        className="viewport-resize-handle"
        onPointerDown={(event) => onResizeStart(node.id, event)}
        data-testid={`viewport-resize-${node.id}`}
      />
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
}: ViewportPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const viewportHeights = system.ui.viewportHeights
  const tileRefs = useRef(new Map<string, HTMLDivElement | null>())
  const resizeRef = useRef<{
    startY: number
    startHeight: number
    id: string
  } | null>(null)

  const viewports = useMemo(() => {
    const entries: ViewportEntry[] = []
  for (const nodeId of system.rootIds) {
    const node = system.nodes[nodeId]
    if (!node) continue
    if (node.kind === 'scene') {
      const scene = system.scenes.find((entry) => entry.id === nodeId)
      if (!scene) continue
      entries.push({ node, scene, hidden: !node.visibility })
    } else if (node.kind === 'diagram') {
      const diagram = system.bifurcationDiagrams.find((entry) => entry.id === nodeId)
      if (!diagram) continue
      entries.push({ node, diagram, hidden: !node.visibility })
    }
  }
    return entries
  }, [system])

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

  if (viewports.length === 0) {
    return (
      <p className="empty-state">
        No visible viewports. Toggle visibility or create a new one.
      </p>
    )
  }

  return (
    <div className="viewport-workspace" data-testid="viewport-workspace">
      {viewports.map((entry) => {
        const height = viewportHeights[entry.node.id]

        return (
          <div
            key={entry.node.id}
            className="viewport-item"
            ref={(node) => {
              tileRefs.current.set(entry.node.id, node)
            }}
            style={height ? { height } : undefined}
          >
            <ViewportTile
              system={system}
              entry={entry}
              selectedNodeId={selectedNodeId}
              draggingId={draggingId}
              dragOverId={dragOverId}
              setDraggingId={setDraggingId}
              setDragOverId={setDragOverId}
              onSelectViewport={onSelectViewport}
              onSelectObject={onSelectObject}
              onReorderViewport={onReorderViewport}
              onResizeStart={startResize}
            />
          </div>
        )
      })}
    </div>
  )
}
