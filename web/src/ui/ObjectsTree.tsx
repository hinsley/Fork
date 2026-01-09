import { useEffect, useMemo, useState } from 'react'
import type { System, TreeNode } from '../system/types'

type ObjectsTreeProps = {
  system: System
  selectedNodeId: string | null
  onSelect: (id: string) => void
  onToggleVisibility: (id: string) => void
  onRename: (id: string, name: string) => void
  onToggleExpanded: (id: string) => void
  onReorderNode: (nodeId: string, targetId: string) => void
  onCreateOrbit: () => void
  onCreateEquilibrium: () => void
  onCreateScene: () => void
  onCreateBifurcation: () => void
  onDeleteNode: (id: string) => void
}

function getNodeLabel(node: TreeNode) {
  if (node.kind === 'branch') return `Branch: ${node.name}`
  if (node.objectType === 'equilibrium') return `${node.name} (equilibrium)`
  if (node.objectType === 'limit_cycle') return `${node.name} (limit cycle)`
  if (node.objectType === 'orbit') return `${node.name} (orbit)`
  if (node.kind === 'scene') return `${node.name} (scene)`
  if (node.kind === 'diagram') return `${node.name} (bifurcation)`
  return node.name
}

export function ObjectsTree({
  system,
  selectedNodeId,
  onSelect,
  onToggleVisibility,
  onRename,
  onToggleExpanded,
  onReorderNode,
  onCreateOrbit,
  onCreateEquilibrium,
  onCreateScene,
  onCreateBifurcation,
  onDeleteNode,
}: ObjectsTreeProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [createMenu, setCreateMenu] = useState<{
    x: number
    y: number
  } | null>(null)

  const rootNodes = useMemo(() => system.rootIds, [system.rootIds])

  const startRename = (node: TreeNode) => {
    setEditingId(node.id)
    setDraftName(node.name)
  }

  useEffect(() => {
    if (!nodeContextMenu && !createMenu) return
    const handlePointerDown = () => {
      setNodeContextMenu(null)
      setCreateMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNodeContextMenu(null)
        setCreateMenu(null)
      }
    }
    const handleBlur = () => {
      setNodeContextMenu(null)
      setCreateMenu(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleBlur)
    }
  }, [nodeContextMenu, createMenu])

  const commitRename = (node: TreeNode) => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== node.name) {
      onRename(node.id, trimmed)
    }
    setEditingId(null)
  }

  const renderNode = (nodeId: string, depth: number) => {
    const node = system.nodes[nodeId]
    if (!node) return null
    const isSelected = nodeId === selectedNodeId
    const hasChildren = node.children.length > 0
    const isEditing = editingId === nodeId
    const isRoot = node.parentId === null
    const isDragging = draggingId === nodeId
    const isDropTarget = isRoot && dragOverId === nodeId && draggingId !== node.id

    return (
      <div key={nodeId} className={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}>
        <div
          className={`tree-node__row${isDragging ? ' tree-node__row--dragging' : ''}${
            isDropTarget ? ' tree-node__row--drop' : ''
          }`}
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onSelect(nodeId)}
          onContextMenu={(event) => {
            event.preventDefault()
            onSelect(nodeId)
            setCreateMenu(null)
            setNodeContextMenu({ id: nodeId, x: event.clientX, y: event.clientY })
          }}
          onDragOver={(event) => {
            if (!isRoot) return
            const sourceId = draggingId || event.dataTransfer.getData('text/plain')
            const sourceNode = sourceId ? system.nodes[sourceId] : null
            if (!sourceId || !sourceNode || sourceNode.parentId !== null) return
            event.preventDefault()
            setDragOverId(nodeId)
          }}
          onDrop={(event) => {
            if (!isRoot) return
            event.preventDefault()
            const sourceId = event.dataTransfer.getData('text/plain') || draggingId
            const sourceNode = sourceId ? system.nodes[sourceId] : null
            if (sourceId && sourceNode?.parentId === null && sourceId !== nodeId) {
              onReorderNode(sourceId, nodeId)
            }
            setDragOverId(null)
            setDraggingId(null)
          }}
          data-testid={`object-tree-row-${nodeId}`}
        >
          {hasChildren ? (
            <button
              className="tree-node__expand"
              onClick={() => onToggleExpanded(nodeId)}
              aria-label={node.expanded ? 'Collapse node' : 'Expand node'}
              data-testid={`node-expand-${nodeId}`}
            >
              {node.expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree-node__spacer" />
          )}
          <button
            className="tree-node__visibility"
            onClick={() => onToggleVisibility(nodeId)}
            aria-label={node.visibility ? 'Hide node' : 'Show node'}
            data-testid={`node-visibility-${nodeId}`}
          >
            {node.visibility ? '●' : '○'}
          </button>
          <button
            className="tree-node__label"
            onClick={(event) => {
              event.stopPropagation()
              onSelect(nodeId)
            }}
            data-testid={`object-tree-node-${nodeId}`}
          >
            {isEditing ? (
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => commitRename(node)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(node)
                  if (event.key === 'Escape') setEditingId(null)
                }}
                data-testid={`node-rename-input-${nodeId}`}
              />
            ) : (
              getNodeLabel(node)
            )}
          </button>
          {isRoot ? (
            <button
              className="tree-node__handle"
              draggable
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', nodeId)
                setDraggingId(nodeId)
              }}
              onDragEnd={() => {
                setDraggingId(null)
                setDragOverId(null)
              }}
              aria-label={`Drag ${node.name}`}
              data-testid={`node-drag-${nodeId}`}
            >
              ::
            </button>
          ) : null}
        </div>
        {hasChildren && node.expanded ? (
          <div className="tree-node__children">
            {node.children.map((childId) => renderNode(childId, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="objects-tree" data-testid="objects-tree">
      <div className="objects-tree__toolbar">
        <button
          onClick={(event) => {
            setNodeContextMenu(null)
            setCreateMenu({ x: event.clientX, y: event.clientY })
          }}
          data-testid="create-object-button"
        >
          Create Object
        </button>
      </div>
      <div className="objects-tree__list">
        {rootNodes.length === 0 ? <p className="empty-state">No objects yet.</p> : null}
        {rootNodes.map((nodeId) => renderNode(nodeId, 0))}
      </div>
      {createMenu ? (
        <div
          className="context-menu"
          style={{ left: createMenu.x, top: createMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          data-testid="create-object-menu"
        >
          <button
            className="context-menu__item"
            onClick={() => {
              onCreateOrbit()
              setCreateMenu(null)
            }}
            data-testid="create-orbit"
          >
            Orbit
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              onCreateEquilibrium()
              setCreateMenu(null)
            }}
            data-testid="create-equilibrium"
          >
            Equilibrium
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              onCreateScene()
              setCreateMenu(null)
            }}
            data-testid="create-scene"
          >
            State Space Scene
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              onCreateBifurcation()
              setCreateMenu(null)
            }}
            data-testid="create-bifurcation"
          >
            Bifurcation Diagram
          </button>
        </div>
      ) : null}
      {nodeContextMenu ? (
        <div
          className="context-menu"
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          data-testid="object-context-menu"
        >
          <button
            className="context-menu__item"
            onClick={() => {
              const node = system.nodes[nodeContextMenu.id]
              if (node) startRename(node)
              setNodeContextMenu(null)
            }}
            data-testid="object-context-rename"
          >
            Rename
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              onDeleteNode(nodeContextMenu.id)
              setNodeContextMenu(null)
            }}
            data-testid="object-context-delete"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}
