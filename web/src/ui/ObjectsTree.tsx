import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, DragEvent } from 'react'
import type { ContinuationObject, System, TreeNode } from '../system/types'
import { canMoveNodeIntoParent, DEFAULT_RENDER } from '../system/model'
import type { ReorderPlacement } from '../system/model'
import { hasCustomObjectParams } from '../system/parameters'
import { formatEquilibriumLabel } from '../system/labels'
import { confirmDelete, getDeleteKindLabel } from './confirmDelete'
import { clampMenuX } from './contextMenu'

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
  onReorderNode: (nodeId: string, targetId: string, placement?: ReorderPlacement) => void
  onMoveNodeIntoParent?: (nodeId: string, parentId: string | null) => void
  onCreateFolder?: (parentId?: string | null) => void
  onCreateOrbit: () => void
  onCreateEquilibrium: () => void
  onCreateIsocline?: () => void
  onDuplicateNode?: (id: string) => void | Promise<void>
  onDeleteNode: (id: string) => void
}

function getBranchTypeLabel(branch: ContinuationObject, system: System): string {
  const manifoldStopSuffix = getManifoldStopLabel(branch)
  if (branch.branchType === 'equilibrium') {
    return formatEquilibriumLabel(system.config.type, {
      lowercase: true,
      mapIterations: branch.mapIterations,
    })
  }
  if (branch.branchType === 'limit_cycle') return 'limit cycle'
  if (branch.branchType === 'homoclinic_curve') return 'homoclinic curve'
  if (branch.branchType === 'homotopy_saddle_curve') return 'homotopy saddle curve'
  if (branch.branchType === 'fold_curve') return 'fold curve'
  if (branch.branchType === 'hopf_curve') return 'hopf curve'
  if (branch.branchType === 'lpc_curve') return 'lpc curve'
  if (branch.branchType === 'isochrone_curve') return 'isochrone curve'
  if (branch.branchType === 'pd_curve') return 'pd curve'
  if (branch.branchType === 'ns_curve') return 'ns curve'
  if (branch.branchType === 'eq_manifold_1d') return 'equilibrium manifold (1d)'
  if (branch.branchType === 'eq_manifold_2d') {
    return `equilibrium manifold (2d${manifoldStopSuffix})`
  }
  if (branch.branchType === 'cycle_manifold_2d') {
    return `cycle manifold (2d${manifoldStopSuffix})`
  }
  return 'branch'
}

function getManifoldStopLabel(branch: ContinuationObject): string {
  if (branch.branchType !== 'eq_manifold_2d' && branch.branchType !== 'cycle_manifold_2d') {
    return ''
  }
  const geometry = branch.data.manifold_geometry
  if (!geometry || !('vertices_flat' in geometry)) return ''
  const reason = geometry.solver_diagnostics?.termination_reason?.trim()
  if (!reason) return ''
  return `, ${reason.replaceAll('_', ' ')}`
}

function getNodeLabel(node: TreeNode, system: System) {
  if (node.kind === 'branch') {
    const branch = system.branches[node.id]
    return `Branch: ${node.name} (${branch ? getBranchTypeLabel(branch, system) : 'branch'})`
  }
  if (node.kind === 'folder') return node.name
  if (node.objectType === 'equilibrium') {
    const object = system.objects[node.id]
    const mapIterations =
      system.config.type === 'map' && object?.type === 'equilibrium'
        ? object.lastSolverParams?.mapIterations ??
          object.solution?.cycle_points?.length
        : undefined
    const cycleIterations =
      typeof mapIterations === 'number' && Number.isFinite(mapIterations)
        ? Math.max(1, Math.trunc(mapIterations))
        : null
    const equilibriumLabel =
      system.config.type === 'map' && cycleIterations === 1
        ? 'fixed point'
        : formatEquilibriumLabel(system.config.type, {
            lowercase: true,
            mapIterations,
          })
    return `${node.name} (${equilibriumLabel})`
  }
  if (node.objectType === 'limit_cycle') return `${node.name} (limit cycle)`
  if (node.objectType === 'isocline') return `${node.name} (isocline)`
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
      onMoveNodeIntoParent = () => {},
      onCreateFolder = () => {},
      onCreateOrbit,
      onCreateEquilibrium,
      onCreateIsocline = () => {},
      onDuplicateNode = () => {},
      onDeleteNode,
    },
    ref
  ) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [draftName, setDraftName] = useState('')
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropPreview, setDropPreview] = useState<
      | {
          mode: 'reorder'
          targetId: string
          parentId: string | null
          placement: ReorderPlacement
        }
      | { mode: 'inside'; targetId: string }
      | null
    >(null)
    const dropPreviewRef = useRef<typeof dropPreview>(null)
    const [nodeContextMenu, setNodeContextMenu] = useState<{
      id: string
      x: number
      y: number
    } | null>(null)
    const [createMenu, setCreateMenu] = useState<{
      x: number
      y: number
    } | null>(null)
    const createMenuRef = useRef<HTMLDivElement | null>(null)
    const nodeContextMenuRef = useRef<HTMLDivElement | null>(null)
    const rowRefs = useRef(new Map<string, HTMLDivElement>())
    const previousRowRects = useRef(new Map<string, DOMRect>())
    const equilibriumLabel = formatEquilibriumLabel(system.config.type)
    const createEquilibriumLabel =
      system.config.type === 'map' ? 'Fixed point / Cycle' : equilibriumLabel

    const rootNodes = useMemo(
      () =>
        system.rootIds.filter((id) => {
          const node = system.nodes[id]
          return node?.kind === 'object' || node?.kind === 'folder'
        }),
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

    useLayoutEffect(() => {
      const nextRects = new Map<string, DOMRect>()
      rowRefs.current.forEach((row, nodeId) => {
        const rect = row.getBoundingClientRect()
        nextRects.set(nodeId, rect)
        const previous = previousRowRects.current.get(nodeId)
        if (!draggingId || !previous) return
        const deltaY = previous.top - rect.top
        if (Math.abs(deltaY) < 1 || typeof row.animate !== 'function') return
        row.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        )
      })
      previousRowRects.current = nextRects
    })

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
    }, [setCreateMenu, setNodeContextMenu])

    useImperativeHandle(ref, () => ({ openCreateMenu }), [openCreateMenu])

    const getDropPlacement = (
      event: DragEvent<HTMLDivElement>
    ): ReorderPlacement => {
      const rect = event.currentTarget.getBoundingClientRect()
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }

    const getPreviewOrder = (nodeIds: string[], parentId: string | null) => {
      if (!draggingId || !dropPreview) return nodeIds
      const sourceNode = system.nodes[draggingId]
      if (!sourceNode) return nodeIds
      const next = nodeIds.filter((id) => id !== draggingId)

      if (dropPreview.mode === 'inside') {
        if (parentId === dropPreview.targetId) {
          return [...next, draggingId]
        }
        return next
      }

      if (
        dropPreview.mode !== 'reorder' ||
        parentId !== dropPreview.parentId ||
        !next.includes(dropPreview.targetId)
      ) {
        return next
      }
      if (draggingId === dropPreview.targetId) return nodeIds
      const targetIndex = next.indexOf(dropPreview.targetId)
      if (targetIndex === -1) return nodeIds
      const insertionIndex =
        dropPreview.placement === 'after' ? targetIndex + 1 : targetIndex
      next.splice(insertionIndex, 0, draggingId)
      return next
    }

    const updateDropPreview = (preview: typeof dropPreview) => {
      dropPreviewRef.current = preview
      setDropPreview(preview)
    }

    const commitDropPreview = (sourceId: string | null) => {
      const preview = dropPreviewRef.current
      if (!sourceId || !preview || sourceId === preview.targetId) return false
      const sourceNode = system.nodes[sourceId]
      const targetNode = system.nodes[preview.targetId]
      if (!sourceNode || !targetNode) {
        return false
      }
      if (preview.mode === 'inside') {
        onMoveNodeIntoParent(sourceId, preview.targetId)
        return true
      }
      onReorderNode(sourceId, preview.targetId, preview.placement)
      return true
    }

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
    const indentStyle = { '--tree-node-depth': paddingDepth } as CSSProperties
    const isSelected = nodeId === selectedNodeId
    const directChildren = node.children.filter((id) => Boolean(system.nodes[id]))
    const derivedChildren = childrenByParent.get(nodeId) ?? []
    const childIds =
      directChildren.length > 0
        ? [...directChildren, ...derivedChildren.filter((id) => !directChildren.includes(id))]
        : derivedChildren
    const hasChildren = childIds.length > 0
    const isEditing = editingId === nodeId
    const nodeColor = node.render?.color ?? DEFAULT_RENDER.color
    const visibilityStyle = { '--node-color': nodeColor } as CSSProperties
    const isDragging = draggingId === nodeId
    const object = system.objects[nodeId]
    const customParameters =
      object && object.type !== 'continuation' ? object.customParameters : null
    const hasFrozenVariables =
      object &&
      object.type !== 'continuation' &&
      Object.keys(object.frozenVariables?.frozenValuesByVarName ?? {}).length > 0

    return (
      <div key={nodeId} className="tree-node">
        <div
          className={`tree-node__row${isSelected ? ' tree-node__row--selected' : ''}${
            isDragging ? ' tree-node__row--dragging' : ''
          }`}
          draggable={!isEditing}
          ref={(row) => {
            if (row) {
              rowRefs.current.set(nodeId, row)
            } else {
              rowRefs.current.delete(nodeId)
            }
          }}
          style={indentStyle}
          onClick={() => onSelect(nodeId)}
          onDragStart={(event) => {
            if (isEditing) {
              event.preventDefault()
              return
            }
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', nodeId)
            setDraggingId(nodeId)
          }}
          onDragEnd={() => {
            setDraggingId(null)
            updateDropPreview(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            onSelect(nodeId)
            setCreateMenu(null)
            setNodeContextMenu({ id: nodeId, x: event.clientX, y: event.clientY })
          }}
          onDragOver={(event) => {
            const sourceId = draggingId || event.dataTransfer.getData('text/plain')
            const sourceNode = sourceId ? system.nodes[sourceId] : null
            if (!sourceId || !sourceNode || sourceId === nodeId) {
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (
              (node.kind === 'folder' || node.kind === 'object') &&
              canMoveNodeIntoParent(system.nodes, sourceId, nodeId)
            ) {
              if (
                dropPreviewRef.current?.mode !== 'inside' ||
                dropPreviewRef.current.targetId !== nodeId
              ) {
                updateDropPreview({ mode: 'inside', targetId: nodeId })
              }
              return
            }
            if (sourceNode.parentId !== node.parentId) {
              const targetParentId = node.parentId ?? null
              if (!canMoveNodeIntoParent(system.nodes, sourceId, targetParentId)) {
                updateDropPreview(null)
                event.dataTransfer.dropEffect = 'none'
                return
              }
            }
            const placement = getDropPlacement(event)
            const targetParentId = node.parentId ?? null
            if (
              dropPreviewRef.current?.mode !== 'reorder' ||
              dropPreviewRef.current?.targetId !== nodeId ||
              dropPreviewRef.current.parentId !== targetParentId ||
              (dropPreviewRef.current.mode === 'reorder' &&
                dropPreviewRef.current.placement !== placement)
            ) {
              updateDropPreview({
                mode: 'reorder',
                targetId: nodeId,
                parentId: targetParentId,
                placement,
              })
            }
          }}
          data-testid={`object-tree-row-${nodeId}`}
        >
          <span className="tree-node__indent" aria-hidden="true" />
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
          {node.kind === 'folder' ? (
            <span
              className="tree-node__folder-icon"
              aria-hidden="true"
              data-testid={`node-folder-icon-${nodeId}`}
            >
              📁
            </span>
          ) : (
            <button
              className="tree-node__visibility"
              onClick={(event) => {
                event.stopPropagation()
                onToggleVisibility(nodeId)
              }}
              style={visibilityStyle}
              data-visible={node.visibility ? 'true' : 'false'}
              aria-label={node.visibility ? 'Hide node' : 'Show node'}
              data-testid={`node-visibility-${nodeId}`}
            />
          )}
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
              <span className="tree-node__label-content">
                <span className="tree-node__label-text">
                  {getNodeLabel(node, system)}
                </span>
                {hasCustomObjectParams(system.config, customParameters) ? (
                  <span
                    className="tree-node__tag"
                    data-testid={`object-tree-custom-${nodeId}`}
                  >
                    custom
                  </span>
                ) : null}
                {hasFrozenVariables ? (
                  <span
                    className="tree-node__tag"
                    data-testid={`object-tree-frozen-${nodeId}`}
                    title="Frozen variables configured"
                    aria-label="Frozen variables configured"
                  >
                    ❄️
                  </span>
                ) : null}
              </span>
            )}
          </button>
        </div>
        {(hasChildren || dropPreview?.targetId === nodeId) &&
        (node.expanded || dropPreview?.targetId === nodeId) ? (
          <div className="tree-node__children">
            {getPreviewOrder(childIds, nodeId).map((childId) =>
              renderNode(childId, depth + 1)
            )}
          </div>
        ) : null}
      </div>
    )
    }

    return (
      <div
        className="objects-tree"
        onDragOver={(event) => {
          if (!dropPreviewRef.current) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          commitDropPreview(event.dataTransfer.getData('text/plain') || draggingId)
          updateDropPreview(null)
          setDraggingId(null)
        }}
        data-testid="objects-tree"
      >
        <div className="objects-tree__list">
          {rootNodes.length === 0 ? <p className="empty-state">No objects yet.</p> : null}
          {getPreviewOrder(rootNodes, null).map((nodeId) => renderNode(nodeId, 0))}
        </div>
        {createMenu ? (
          <div
            className="context-menu"
            style={{ left: createMenu.x, top: createMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            ref={createMenuRef}
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
              {createEquilibriumLabel}
            </button>
            <button
              className="context-menu__item"
              onClick={() => {
                onCreateIsocline()
                setCreateMenu(null)
              }}
              data-testid="create-isocline"
            >
              Isocline
            </button>
          </div>
        ) : null}
        {nodeContextMenu ? (
          <div
            className="context-menu"
            style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            ref={nodeContextMenuRef}
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
            {(() => {
              const node = system.nodes[nodeContextMenu.id]
              if (!node || (node.kind !== 'object' && node.kind !== 'branch')) return null
              return (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const nodeId = nodeContextMenu.id
                    setNodeContextMenu(null)
                    void onDuplicateNode(nodeId)
                  }}
                  data-testid="object-context-duplicate"
                >
                  Duplicate
                </button>
              )
            })()}
            {(() => {
              const node = system.nodes[nodeContextMenu.id]
              if (!node || (node.kind !== 'object' && node.kind !== 'folder')) return null
              return (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const parentId = nodeContextMenu.id
                    setNodeContextMenu(null)
                    onCreateFolder(parentId)
                  }}
                  data-testid="object-context-create-folder"
                >
                  {node.kind === 'folder' ? 'Create Subfolder' : 'Create Folder'}
                </button>
              )
            })()}
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
