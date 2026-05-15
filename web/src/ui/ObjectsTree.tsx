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
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
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

const TOUCH_DRAG_THRESHOLD_PX = 8
const TOUCH_DRAG_ARM_DELAY_MS = 220
const TOUCH_CONTEXT_MENU_DELAY_MS = 600

type TouchTreeInteraction = {
  contextMenuTimer: number | null
  contextMenuOpened: boolean
  dragArmed: boolean
  dragArmTimer: number | null
  dragging: boolean
  nodeId: string
  pointerId: number
  startX: number
  startY: number
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

function getLayoutTop(element: HTMLElement): number {
  let top = 0
  let cursor: HTMLElement | null = element
  while (cursor) {
    top += cursor.offsetTop
    cursor = cursor.offsetParent as HTMLElement | null
  }
  return top
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
    const [touchDragging, setTouchDragging] = useState(false)
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
    const draggingIdRef = useRef<string | null>(null)
    const treeRootRef = useRef<HTMLDivElement | null>(null)
    const dragRuntimeRef = useRef<{
      commitDropPreview: (sourceId: string | null) => boolean
      getCurrentDragSourceId: (dataTransfer?: DataTransfer | null) => string | null
      updateDropPreviewForRootBoundary: (sourceId: string, clientY: number) => boolean
    } | null>(null)
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
    const rowMotionRefs = useRef(new Map<string, HTMLDivElement>())
    const activeRowAnimations = useRef(new Map<string, Animation>())
    const previousRowTops = useRef(new Map<string, number>())
    const touchInteractionRef = useRef<TouchTreeInteraction | null>(null)
    const suppressNextClickRef = useRef(false)
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
      const nextTops = new Map<string, number>()
      rowRefs.current.forEach((row, nodeId) => {
        const top = getLayoutTop(row)
        nextTops.set(nodeId, top)
        const previousTop = previousRowTops.current.get(nodeId)
        const motion = rowMotionRefs.current.get(nodeId)
        if (!draggingId || previousTop === undefined) return
        const deltaY = previousTop - top
        if (!motion || Math.abs(deltaY) < 1 || typeof motion.animate !== 'function') {
          return
        }
        activeRowAnimations.current.get(nodeId)?.cancel()
        const animation = motion.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        )
        activeRowAnimations.current.set(nodeId, animation)
        const clearAnimation = () => {
          if (activeRowAnimations.current.get(nodeId) === animation) {
            activeRowAnimations.current.delete(nodeId)
          }
        }
        animation.onfinish = clearAnimation
        animation.oncancel = clearAnimation
      })
      previousRowTops.current = nextTops
    })

    useEffect(() => {
      const animations = activeRowAnimations.current
      return () => {
        animations.forEach((animation) => animation.cancel())
        animations.clear()
      }
    }, [])

    useEffect(() => {
      const interactionRef = touchInteractionRef
      return () => {
        const interaction = interactionRef.current
        if (interaction?.contextMenuTimer) {
          window.clearTimeout(interaction.contextMenuTimer)
        }
        if (interaction?.dragArmTimer) {
          window.clearTimeout(interaction.dragArmTimer)
        }
      }
    }, [])

    const commitRename = (node: TreeNode) => {
      const trimmed = draftName.trim()
      if (trimmed && trimmed !== node.name) {
        onRename(node.id, trimmed)
      }
      setEditingId(null)
    }

    const openNodeContextMenu = (nodeId: string, x: number, y: number) => {
      onSelect(nodeId)
      setCreateMenu(null)
      setNodeContextMenu({ id: nodeId, x, y })
    }

    const openCreateMenu = useCallback((position: { x: number; y: number }) => {
      setNodeContextMenu(null)
      setCreateMenu(position)
    }, [setCreateMenu, setNodeContextMenu])

    useImperativeHandle(ref, () => ({ openCreateMenu }), [openCreateMenu])

    const clearTouchInteractionTimer = () => {
      const interaction = touchInteractionRef.current
      if (!interaction) return
      if (interaction.contextMenuTimer) {
        window.clearTimeout(interaction.contextMenuTimer)
        interaction.contextMenuTimer = null
      }
      if (interaction.dragArmTimer) {
        window.clearTimeout(interaction.dragArmTimer)
        interaction.dragArmTimer = null
      }
    }

    const getDropPlacement = (row: HTMLElement, clientY: number): ReorderPlacement => {
      const rect = row.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
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

    const getCurrentDragSourceId = (dataTransfer?: DataTransfer | null) =>
      draggingIdRef.current || draggingId || dataTransfer?.getData('text/plain') || null

    const updateDropPreviewForTarget = (
      sourceId: string,
      targetId: string,
      clientY: number
    ): boolean => {
      const sourceNode = system.nodes[sourceId]
      const targetNode = system.nodes[targetId]
      const targetRow = rowRefs.current.get(targetId)
      if (!sourceNode || !targetNode || !targetRow || sourceId === targetId) {
        return false
      }

      if (
        (targetNode.kind === 'folder' || targetNode.kind === 'object') &&
        canMoveNodeIntoParent(system.nodes, sourceId, targetId)
      ) {
        if (
          dropPreviewRef.current?.mode !== 'inside' ||
          dropPreviewRef.current.targetId !== targetId
        ) {
          updateDropPreview({ mode: 'inside', targetId })
        }
        return true
      }

      const targetParentId = targetNode.parentId ?? null
      if (
        sourceNode.parentId !== targetNode.parentId &&
        !canMoveNodeIntoParent(system.nodes, sourceId, targetParentId)
      ) {
        updateDropPreview(null)
        return false
      }

      const placement = getDropPlacement(targetRow, clientY)
      if (
        dropPreviewRef.current?.mode !== 'reorder' ||
        dropPreviewRef.current?.targetId !== targetId ||
        dropPreviewRef.current.parentId !== targetParentId ||
        (dropPreviewRef.current.mode === 'reorder' &&
          dropPreviewRef.current.placement !== placement)
      ) {
        updateDropPreview({
          mode: 'reorder',
          targetId,
          parentId: targetParentId,
          placement,
        })
      }
      return true
    }

    const updateDropPreviewForRootEdge = (
      sourceId: string,
      edge: 'start' | 'end'
    ): boolean => {
      const sourceNode = system.nodes[sourceId]
      if (!sourceNode || !canMoveNodeIntoParent(system.nodes, sourceId, null)) {
        return Boolean(dropPreviewRef.current)
      }

      const targetIds = rootNodes.filter((id) => id !== sourceId)
      const targetId = edge === 'start' ? targetIds[0] : targetIds.at(-1)
      if (!targetId) {
        updateDropPreview(null)
        return true
      }
      const placement: ReorderPlacement = edge === 'start' ? 'before' : 'after'

      if (
        dropPreviewRef.current?.mode !== 'reorder' ||
        dropPreviewRef.current.targetId !== targetId ||
        dropPreviewRef.current.parentId !== null ||
        dropPreviewRef.current.placement !== placement
      ) {
        updateDropPreview({
          mode: 'reorder',
          targetId,
          parentId: null,
          placement,
        })
      }
      return true
    }

    const updateDropPreviewForRootBoundary = (sourceId: string, clientY: number): boolean => {
      const targetRows = rootNodes
        .filter((id) => id !== sourceId)
        .map((id) => rowRefs.current.get(id))
        .filter((row): row is HTMLDivElement => Boolean(row))

      if (targetRows.length === 0) {
        return updateDropPreviewForRootEdge(sourceId, 'end')
      }

      const firstRect = targetRows[0]!.getBoundingClientRect()
      const lastRect = targetRows[targetRows.length - 1]!.getBoundingClientRect()
      if (clientY < firstRect.top) {
        return updateDropPreviewForRootEdge(sourceId, 'start')
      }
      if (clientY > lastRect.bottom) {
        return updateDropPreviewForRootEdge(sourceId, 'end')
      }
      return Boolean(dropPreviewRef.current)
    }

    const updateTouchDropPreview = (sourceId: string, clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY)
      const targetRow = element?.closest<HTMLElement>('[data-tree-node-id]')
      const targetId = targetRow?.dataset.treeNodeId
      if (!targetId || targetId === sourceId) {
        if (
          (element && treeRootRef.current?.contains(element)) ||
          !treeRootRef.current ||
          clientY < treeRootRef.current.getBoundingClientRect().top ||
          clientY > treeRootRef.current.getBoundingClientRect().bottom
        ) {
          return updateDropPreviewForRootBoundary(sourceId, clientY)
        }
        return Boolean(dropPreviewRef.current)
      }
      return updateDropPreviewForTarget(sourceId, targetId, clientY)
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

    useLayoutEffect(() => {
      dragRuntimeRef.current = {
        commitDropPreview,
        getCurrentDragSourceId,
        updateDropPreviewForRootBoundary,
      }
    })

    useEffect(() => {
      if (!draggingId) return

      const clearDragInteraction = () => {
        const interaction = touchInteractionRef.current
        if (interaction?.contextMenuTimer) {
          window.clearTimeout(interaction.contextMenuTimer)
        }
        if (interaction?.dragArmTimer) {
          window.clearTimeout(interaction.dragArmTimer)
        }
        touchInteractionRef.current = null
        draggingIdRef.current = null
        dropPreviewRef.current = null
        setDropPreview(null)
        setTouchDragging(false)
        setDraggingId(null)
      }
      const clearIfHidden = () => {
        if (document.visibilityState === 'hidden') {
          clearDragInteraction()
        }
      }
      const clearTouchDragInteraction = () => {
        if (!touchInteractionRef.current?.dragging) return
        clearDragInteraction()
      }
      const updateWindowDragPreview = (event: DragEvent) => {
        const runtime = dragRuntimeRef.current
        if (!runtime) return
        const sourceId = runtime.getCurrentDragSourceId(event.dataTransfer)
        if (!sourceId) return

        const target = event.target instanceof Element ? event.target : null
        if (
          target &&
          treeRootRef.current?.contains(target) &&
          target.closest('[data-tree-node-id]')
        ) {
          return
        }

        const hasValidPreview =
          runtime.updateDropPreviewForRootBoundary(sourceId, event.clientY) ||
          Boolean(dropPreviewRef.current)
        if (!hasValidPreview) return
        event.preventDefault()
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
      }
      const commitWindowDragEnd = (event: DragEvent) => {
        const runtime = dragRuntimeRef.current
        const sourceId = runtime?.getCurrentDragSourceId(event.dataTransfer) ?? null
        runtime?.commitDropPreview(sourceId)
        clearDragInteraction()
      }
      const commitWindowDrop = (event: DragEvent) => {
        const runtime = dragRuntimeRef.current
        const sourceId = runtime?.getCurrentDragSourceId(event.dataTransfer) ?? null
        if (dropPreviewRef.current) {
          event.preventDefault()
          runtime?.commitDropPreview(sourceId)
        }
        clearDragInteraction()
      }

      window.addEventListener('dragover', updateWindowDragPreview)
      window.addEventListener('dragend', commitWindowDragEnd)
      window.addEventListener('drop', commitWindowDrop)
      window.addEventListener('blur', clearDragInteraction)
      window.addEventListener('pointercancel', clearTouchDragInteraction)
      document.addEventListener('visibilitychange', clearIfHidden)
      return () => {
        window.removeEventListener('dragover', updateWindowDragPreview)
        window.removeEventListener('dragend', commitWindowDragEnd)
        window.removeEventListener('drop', commitWindowDrop)
        window.removeEventListener('blur', clearDragInteraction)
        window.removeEventListener('pointercancel', clearTouchDragInteraction)
        document.removeEventListener('visibilitychange', clearIfHidden)
      }
    }, [draggingId])

    const startTouchInteraction = (
      event: ReactPointerEvent<HTMLDivElement>,
      nodeId: string,
      isEditing: boolean
    ) => {
      if (isEditing || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) {
        return
      }
      if (event.button !== 0 && event.button !== -1) return
      clearTouchInteractionTimer()
      const pointerId = event.pointerId
      const dragArmTimer = window.setTimeout(() => {
        const interaction = touchInteractionRef.current
        if (!interaction || interaction.pointerId !== pointerId || interaction.contextMenuOpened) {
          return
        }
        interaction.dragArmed = true
        interaction.dragArmTimer = null
      }, TOUCH_DRAG_ARM_DELAY_MS)
      const contextMenuTimer = window.setTimeout(() => {
        const interaction = touchInteractionRef.current
        if (!interaction || interaction.pointerId !== pointerId || interaction.dragging) {
          return
        }
        interaction.contextMenuOpened = true
        interaction.contextMenuTimer = null
        suppressNextClickRef.current = true
        updateDropPreview(null)
        draggingIdRef.current = null
        setTouchDragging(false)
        setDraggingId(null)
        openNodeContextMenu(interaction.nodeId, interaction.startX, interaction.startY)
      }, TOUCH_CONTEXT_MENU_DELAY_MS)
      touchInteractionRef.current = {
        contextMenuTimer,
        contextMenuOpened: false,
        dragArmed: false,
        dragArmTimer,
        dragging: false,
        nodeId,
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    const updateTouchInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = touchInteractionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      if (interaction.contextMenuOpened) return

      const deltaX = event.clientX - interaction.startX
      const deltaY = event.clientY - interaction.startY
      if (!interaction.dragging) {
        const distance = Math.hypot(deltaX, deltaY)
        if (distance < TOUCH_DRAG_THRESHOLD_PX) return
        if (!interaction.dragArmed) {
          if (interaction.contextMenuTimer) {
            window.clearTimeout(interaction.contextMenuTimer)
            interaction.contextMenuTimer = null
          }
          return
        }
        clearTouchInteractionTimer()
        interaction.dragging = true
        setCreateMenu(null)
        setNodeContextMenu(null)
        draggingIdRef.current = interaction.nodeId
        setTouchDragging(true)
        setDraggingId(interaction.nodeId)
      }

      event.preventDefault()
      updateTouchDropPreview(interaction.nodeId, event.clientX, event.clientY)
    }

    const endTouchInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = touchInteractionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return

      clearTouchInteractionTimer()
      if (interaction.dragging) {
        event.preventDefault()
        suppressNextClickRef.current = true
        commitDropPreview(interaction.nodeId)
        updateDropPreview(null)
        draggingIdRef.current = null
        setTouchDragging(false)
        setDraggingId(null)
      }
      touchInteractionRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }

    const cancelTouchInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
      const interaction = touchInteractionRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      clearTouchInteractionTimer()
      if (interaction.dragging) {
        updateDropPreview(null)
        draggingIdRef.current = null
        setTouchDragging(false)
        setDraggingId(null)
      }
      touchInteractionRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
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
          className={`tree-node__row${isSelected ? ' tree-node__row--selected' : ''}`}
          draggable={!isEditing}
          ref={(row) => {
            if (row) {
              rowRefs.current.set(nodeId, row)
            } else {
              rowRefs.current.delete(nodeId)
            }
          }}
          style={indentStyle}
          onClickCapture={(event) => {
            if (!suppressNextClickRef.current) return
            suppressNextClickRef.current = false
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={() => onSelect(nodeId)}
          onDragStart={(event) => {
            if (isEditing) {
              event.preventDefault()
              return
            }
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', nodeId)
            draggingIdRef.current = nodeId
            setTouchDragging(false)
            setDraggingId(nodeId)
          }}
          onDragEnd={(event) => {
            commitDropPreview(getCurrentDragSourceId(event.dataTransfer))
            draggingIdRef.current = null
            setTouchDragging(false)
            setDraggingId(null)
            updateDropPreview(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            openNodeContextMenu(nodeId, event.clientX, event.clientY)
          }}
          onPointerDown={(event) => {
            startTouchInteraction(event, nodeId, isEditing)
          }}
          onPointerMove={(event) => {
            updateTouchInteraction(event)
          }}
          onPointerUp={(event) => {
            endTouchInteraction(event)
          }}
          onPointerCancel={(event) => {
            cancelTouchInteraction(event)
          }}
          onDragOver={(event) => {
            const sourceId =
              draggingIdRef.current || draggingId || event.dataTransfer.getData('text/plain')
            if (!sourceId || sourceId === nodeId) {
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = updateDropPreviewForTarget(
              sourceId,
              nodeId,
              event.clientY
            )
              ? 'move'
              : 'none'
          }}
          data-tree-node-id={nodeId}
          data-testid={`object-tree-row-${nodeId}`}
        >
          <div
            className="tree-node__row-motion"
            ref={(row) => {
              if (row) {
                rowMotionRefs.current.set(nodeId, row)
              } else {
                rowMotionRefs.current.delete(nodeId)
              }
            }}
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
              <button
                className="tree-node__visibility tree-node__visibility--folder"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleVisibility(nodeId)
                }}
                data-visible={node.visibility ? 'true' : 'false'}
                aria-label={node.visibility ? 'Hide folder' : 'Show folder'}
                title={node.visibility ? 'Hide folder' : 'Show folder'}
                data-testid={`node-visibility-${nodeId}`}
              >
                <span
                  className="tree-node__folder-icon"
                  aria-hidden="true"
                  data-testid={`node-folder-icon-${nodeId}`}
                >
                  📁
                </span>
              </button>
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
        className={`objects-tree${draggingId ? ' objects-tree--dragging' : ''}${
          touchDragging ? ' objects-tree--touch-dragging' : ''
        }`}
        ref={treeRootRef}
        onDragOver={(event) => {
          const target = event.target instanceof Element ? event.target : null
          const isOverRow = Boolean(target?.closest('[data-tree-node-id]'))
          if (!isOverRow) {
            const sourceId = getCurrentDragSourceId(event.dataTransfer)
            if (sourceId && updateDropPreviewForRootBoundary(sourceId, event.clientY)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
            return
          }
          if (!dropPreviewRef.current) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          commitDropPreview(getCurrentDragSourceId(event.dataTransfer))
          updateDropPreview(null)
          draggingIdRef.current = null
          setTouchDragging(false)
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
