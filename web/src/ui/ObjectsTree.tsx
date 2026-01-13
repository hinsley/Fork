import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import type { System, TreeNode } from '../system/types'
import { confirmDelete, getDeleteKindLabel } from './confirmDelete'

export type ObjectsTreeHandle = {
  openCreateMenu: (position: { x: number; y: number }) => void
}

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

export const ObjectsTree = forwardRef<ObjectsTreeHandle, ObjectsTreeProps>(
  function ObjectsTree(
    {
      system,
      selectedNodeId,
      onSelect,
      onToggleVisibility,
      onRename,
      onToggleExpanded,
      onReorderNode,
      onCreateOrbit,
      onCreateEquilibrium,
      onDeleteNode,
    },
    ref
  ) {
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

    const rootNodes = useMemo(
      () => system.rootIds.filter((id) => system.nodes[id]?.kind === 'object'),
      [system.nodes, system.rootIds]
    )
    const childrenByParent = useMemo(() => {
      const map = new Map<string, string[]>()
      Object.values(system.nodes).forEach((node) => {
        if (!node.parentId) return
        const list = map.get(node.parentId) ?? []
        list.push(node.id)
        map.set(node.parentId, list)
      })
      return map
    }, [system.nodes])

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

    const openCreateMenu = useCallback((position: { x: number; y: number }) => {
      setNodeContextMenu(null)
      setCreateMenu(position)
    }, [])

    useImperativeHandle(ref, () => ({ openCreateMenu }), [openCreateMenu])

    const renderNode = (nodeId: string, depth: number) => {
    const node = system.nodes[nodeId]
    if (!node) return null
    let inferredDepth = 0
    let cursor = node
    const visited = new Set<string>([nodeId])
    while (cursor.parentId) {
      if (visited.has(cursor.parentId)) break
      const parent = system.nodes[cursor.parentId]
      if (!parent) break
      inferredDepth += 1
      visited.add(cursor.parentId)
      cursor = parent
    }
    const paddingDepth = Math.max(depth, inferredDepth)
    const isSelected = nodeId === selectedNodeId
    const directChildren = node.children.filter((id) => Boolean(system.nodes[id]))
    const derivedChildren = childrenByParent.get(nodeId) ?? []
    const childIds =
      directChildren.length > 0
        ? [...directChildren, ...derivedChildren.filter((id) => !directChildren.includes(id))]
        : derivedChildren
    const hasChildren = childIds.length > 0
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
          style={{ paddingLeft: `${paddingDepth * 14}px` }}
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
              onClick={(event) => {
                event.stopPropagation()
                onToggleExpanded(nodeId)
              }}
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
            onClick={(event) => {
              event.stopPropagation()
              onToggleVisibility(nodeId)
            }}
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
            {childIds.map((childId) => renderNode(childId, depth + 1))}
          </div>
        ) : null}
      </div>
    )
    }

    return (
      <div className="objects-tree" data-testid="objects-tree">
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
                const nodeId = nodeContextMenu.id
                const node = system.nodes[nodeId]
                setNodeContextMenu(null)
                if (!node) return
                if (confirmDelete({ name: node.name, kind: getDeleteKindLabel(node) })) {
                  onDeleteNode(nodeId)
                }
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
)
