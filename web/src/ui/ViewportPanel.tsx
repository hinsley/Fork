import { useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type { BifurcationDiagram, System, Scene, TreeNode } from '../system/types'
import { PlotlyViewport } from '../viewports/plotly/PlotlyViewport'

type ViewportPanelProps = {
  system: System
  selectedNodeId: string | null
  onSelectViewport: (id: string) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
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
  draggingId: string | null
  dragOverId: string | null
  setDraggingId: (id: string | null) => void
  setDragOverId: (id: string | null) => void
  onSelectViewport: (id: string) => void
  onReorderViewport: (nodeId: string, targetId: string) => void
  onResizeStart: (id: string, event: React.PointerEvent) => void
}

const MIN_VIEWPORT_HEIGHT = 200

function collectOrbitIds(system: System): string[] {
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
    if (!object || object.type !== 'orbit') continue
    ids.push(nodeId)
  }
  return ids
}

function buildSceneTraces(
  system: System,
  scene: Scene,
  selectedNodeId: string | null
): Data[] {
  const traces: Data[] = []
  const candidateIds =
    scene.display === 'selection' && selectedNodeId ? [selectedNodeId] : collectOrbitIds(system)

  for (const nodeId of candidateIds) {
    const node = system.nodes[nodeId]
    if (!node || node.kind !== 'object' || !node.visibility) continue
    const object = system.objects[nodeId]
    if (!object || object.type !== 'orbit') continue

    const rows = object.data
    if (rows.length === 0) continue
    const dimension = rows[0].length - 1
    const x: number[] = []
    const y: number[] = []

    if (dimension >= 2) {
      for (const row of rows) {
        x.push(row[1])
        y.push(row[2])
      }
    } else {
      for (const row of rows) {
        x.push(row[0])
        y.push(row[1])
      }
    }

    const highlight = nodeId === selectedNodeId
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: object.name,
      x,
      y,
      line: {
        color: node.render.color,
        width: highlight ? node.render.lineWidth + 1 : node.render.lineWidth,
      },
    })
  }
  return traces
}

function buildSceneLayout(): Partial<Layout> {
  return {
    autosize: true,
    margin: { l: 40, r: 20, t: 20, b: 40 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    xaxis: { zerolinecolor: 'rgba(120,120,120,0.3)' },
    yaxis: { zerolinecolor: 'rgba(120,120,120,0.3)' },
    showlegend: false,
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
  onReorderViewport,
  onResizeStart,
}: ViewportTileProps) {
  const { node, scene, diagram } = entry
  const isSelected = node.id === selectedNodeId
  const isDragging = draggingId === node.id
  const isDropTarget = dragOverId === node.id && draggingId !== node.id

  const data = useMemo(() => {
    if (scene) return buildSceneTraces(system, scene, selectedNodeId)
    return []
  }, [system, scene, selectedNodeId])

  const layout = useMemo(() => {
    if (scene) return buildSceneLayout()
    if (diagram) return buildDiagramLayout(diagram)
    return buildSceneLayout()
  }, [scene, diagram])

  const label = scene ? 'State Space' : 'Bifurcation'

  return (
    <section
      className={`viewport-tile ${isSelected ? 'viewport-tile--selected' : ''} ${
        isDropTarget ? 'viewport-tile--drop' : ''
      }`}
      data-testid={`viewport-tile-${node.id}`}
      onClick={() => onSelectViewport(node.id)}
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
      <header className={`viewport-tile__header ${isDragging ? 'is-dragging' : ''}`}>
        <button
          className="viewport-tile__handle"
          draggable
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
        <PlotlyViewport data={data} layout={layout} testId={`plotly-viewport-${node.id}`} />
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
  onReorderViewport,
}: ViewportPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [viewportHeights, setViewportHeights] = useState<Record<string, number>>({})
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
      if (!node.visibility) continue
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
      setViewportHeights((prev) => ({ ...prev, [targetId]: nextHeight }))
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
              onReorderViewport={onReorderViewport}
              onResizeStart={startResize}
            />
          </div>
        )
      })}
    </div>
  )
}
