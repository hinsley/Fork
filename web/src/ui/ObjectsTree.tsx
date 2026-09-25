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
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { ContinuationObject, RowSummary, System, TreeNode } from '../system/types'
import {
  canMoveNodeIntoParent,
  DEFAULT_RENDER,
  isNodeEffectivelyVisible,
} from '../system/model'
import type { ReorderPlacement } from '../system/model'
import { hasCustomObjectParams } from '../system/parameters'
import { formatEquilibriumLabel } from '../system/labels'
import {
  formatBifurcationBadges,
  resolveRenderedPointSummary,
  rowSummaryMatches,
  summarizeBranch,
  summarizeObject,
} from '../system/rowSummary'
import { findRenameConflict } from '../state/systemTreeCommands'
import { confirmDelete, getDeleteKindLabel } from './confirmDelete'
import { clampMenuX, clampMenuY, focusMenuItem } from './contextMenu'
import { Icon } from './Icon'
import { getNodeGlyph } from './nodeGlyph'
import { DISMISS_MENUS_EVENT } from './dismissMenus'
import './tree.css'

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
  /**
   * Creates a folder under `parentId`. With `wrapNodeId` the folder replaces that
   * sibling and contains it. Returning the new folder id starts an inline rename.
   */
  onCreateFolder?: (
    parentId?: string | null,
    options?: { wrapNodeId?: string }
  ) => string | null | void
  onCreateOrbit: () => void
  onCreateEquilibrium: () => void
  onCreateForcedPeriodicResponse?: (orbitId?: string) => void
  onCreateIsocline?: () => void
  onCreateStateGrid?: () => void
  onDuplicateNode?: (id: string) => void | Promise<void>
  onDeleteNode: (id: string) => void
}

/** Show the filter box once the tree has this many rows (or while filtering). */
const FILTER_MIN_NODES = 8

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
  if (branch.branchType === 'forced_periodic_response') return 'forced periodic response'
  if (branch.branchType === 'limit_cycle') return 'limit cycle'
  if (branch.branchType === 'homoclinic_curve') return 'homoclinic curve'
  if (branch.branchType === 'heteroclinic_curve') return 'heteroclinic curve'
  if (branch.branchType === 'homotopy_saddle_curve') return 'homotopy saddle curve'
  if (branch.branchType === 'fold_curve') return 'fold curve'
  if (branch.branchType === 'hopf_curve') {
    return system.config.type === 'map' ? 'neimark-sacker curve' : 'hopf curve'
  }
  if (branch.branchType === 'lpc_curve') return 'lpc curve'
  if (branch.branchType === 'isoperiodic_curve') return 'isoperiodic curve'
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
  if (node.objectType === 'forced_periodic_response') {
    return `${node.name} (forced periodic response)`
  }
  if (node.objectType === 'isocline') return `${node.name} (isocline)`
  if (node.objectType === 'particles') return `${node.name} (particles)`
  if (node.objectType === 'state_grid') return `${node.name} (state grid)`
  if (node.objectType === 'invariant_measure') return `${node.name} (invariant measure)`
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
      onCreateForcedPeriodicResponse = () => {},
      onCreateIsocline = () => {},
      onCreateStateGrid = () => {},
      onDuplicateNode = () => {},
      onDeleteNode,
    },
    ref
  ) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [draftName, setDraftName] = useState('')
    const [renameError, setRenameError] = useState<string | null>(null)
    const [renameShake, setRenameShake] = useState(0)
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
    const [filter, setFilter] = useState('')
    useEffect(() => {
      const handleDismiss = () => {
        setNodeContextMenu(null)
        setCreateMenu(null)
      }
      window.addEventListener(DISMISS_MENUS_EVENT, handleDismiss)
      return () => window.removeEventListener(DISMISS_MENUS_EVENT, handleDismiss)
    }, [])
    const labelRefs = useRef(new Map<string, HTMLButtonElement>())
    const pendingFocusRef = useRef<string | null>(null)
    const menuOpenedByKeyboardRef = useRef(false)
    const createdFolderRenameRef = useRef<string | null>(null)
    const pendingDeleteFocusRef = useRef<{ deletedId: string; nextId: string | null } | null>(
      null
    )
    const equilibriumLabel = formatEquilibriumLabel(system.config.type)
    const createEquilibriumLabel =
      system.config.type === 'map' ? 'Fixed point / cycle' : equilibriumLabel

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
      setRenameError(null)
    }

    const focusNodeLabel = useCallback((nodeId: string) => {
      const label = labelRefs.current.get(nodeId)
      if (label) {
        label.focus()
        pendingFocusRef.current = null
      } else {
        // The row may not be rendered yet (e.g. right after a rename or expand).
        pendingFocusRef.current = nodeId
      }
    }, [])

    useEffect(() => {
      const pending = pendingFocusRef.current
      if (!pending) return
      const label = labelRefs.current.get(pending)
      if (label) {
        label.focus()
        pendingFocusRef.current = null
      }
    })

    // After a delete lands, select and focus the neighbouring row. Selecting
    // earlier would run against the pre-delete system and undo the removal.
    useEffect(() => {
      const pending = pendingDeleteFocusRef.current
      if (!pending || system.nodes[pending.deletedId]) return
      pendingDeleteFocusRef.current = null
      if (pending.nextId && system.nodes[pending.nextId]) {
        onSelect(pending.nextId)
        focusNodeLabel(pending.nextId)
      }
    }, [focusNodeLabel, onSelect, system.nodes])

    const closeMenus = useCallback(() => {
      setNodeContextMenu(null)
      setCreateMenu(null)
    }, [])

    useEffect(() => {
      if (!nodeContextMenu && !createMenu) return
      const handlePointerDown = () => {
        setNodeContextMenu(null)
        setCreateMenu(null)
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          const returnId = menuOpenedByKeyboardRef.current ? nodeContextMenu?.id : null
          setNodeContextMenu(null)
          setCreateMenu(null)
          if (returnId) focusNodeLabel(returnId)
          return
        }
        const menu = nodeContextMenuRef.current ?? createMenuRef.current
        if (!menu) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          focusMenuItem(menu, event.key === 'ArrowDown' ? 1 : -1)
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          focusMenuItem(menu, event.key === 'Home' ? 'first' : 'last')
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
    }, [nodeContextMenu, createMenu, focusNodeLabel])

    useLayoutEffect(() => {
      if (!createMenu || !createMenuRef.current) return
      const rect = createMenuRef.current.getBoundingClientRect()
      if (!rect.width) return
      const clampedX = clampMenuX(createMenu.x, rect.width)
      const clampedY = clampMenuY(createMenu.y, rect.height)
      if (clampedX === createMenu.x && clampedY === createMenu.y) return
      setCreateMenu((prev) => (prev ? { ...prev, x: clampedX, y: clampedY } : prev))
    }, [createMenu])

    useLayoutEffect(() => {
      if (!nodeContextMenu || !nodeContextMenuRef.current) return
      const rect = nodeContextMenuRef.current.getBoundingClientRect()
      if (!rect.width) return
      const clampedX = clampMenuX(nodeContextMenu.x, rect.width)
      const clampedY = clampMenuY(nodeContextMenu.y, rect.height)
      if (clampedX === nodeContextMenu.x && clampedY === nodeContextMenu.y) return
      setNodeContextMenu((prev) => (prev ? { ...prev, x: clampedX, y: clampedY } : prev))
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

    /**
     * Commits the inline rename. A name another sibling already uses is
     * rejected: from Enter the input stays open and shakes; on blur the old
     * name is kept (the rename command reports the conflict).
     */
    const commitRename = (node: TreeNode, source: 'enter' | 'blur'): boolean => {
      const trimmed = draftName.trim()
      if (trimmed && trimmed !== node.name) {
        const conflict = findRenameConflict(system, node.id, trimmed)
        if (conflict && source === 'enter') {
          setRenameError(conflict)
          setRenameShake((count) => count + 1)
          return false
        }
        onRename(node.id, trimmed)
      }
      setRenameError(null)
      setEditingId(null)
      return true
    }

    const openNodeContextMenu = (
      nodeId: string,
      x: number,
      y: number,
      viaKeyboard = false
    ) => {
      onSelect(nodeId)
      setCreateMenu(null)
      menuOpenedByKeyboardRef.current = viaKeyboard
      setNodeContextMenu({ id: nodeId, x, y })
    }

    useEffect(() => {
      if (!nodeContextMenu || !menuOpenedByKeyboardRef.current) return
      focusMenuItem(nodeContextMenuRef.current, 'first')
    }, [nodeContextMenu])

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

    const getChildIds = (nodeId: string): string[] => {
      const node = system.nodes[nodeId]
      if (!node) return []
      const directChildren = node.children.filter((id) => Boolean(system.nodes[id]))
      const derivedChildren = childrenByParent.get(nodeId) ?? []
      return directChildren.length > 0
        ? [...directChildren, ...derivedChildren.filter((id) => !directChildren.includes(id))]
        : derivedChildren
    }

    const renderTargets = system.ui.limitCycleRenderTargets
    // Row summaries: hydrated payloads win, otherwise the persisted index digest.
    // Cycles rendered at a branch point summarize that point, like the inspector.
    const summaries = useMemo(() => {
      const map = new Map<string, RowSummary | undefined>()
      Object.values(system.nodes).forEach((node) => {
        if (node.kind === 'object') {
          const object = system.objects[node.id]
          map.set(
            node.id,
            object
              ? summarizeObject(
                  object,
                  system.config,
                  resolveRenderedPointSummary(renderTargets, system.branches, node.id, object.type)
                )
              : system.index.objects[node.id]?.summary
          )
        } else if (node.kind === 'branch') {
          const branch = system.branches[node.id]
          map.set(
            node.id,
            branch ? summarizeBranch(branch, system.config) : system.index.branches[node.id]?.summary
          )
        }
      })
      return map
    }, [
      system.nodes,
      system.objects,
      system.branches,
      system.index,
      system.config,
      renderTargets,
    ])

    const treeNodeCount = useMemo(
      () =>
        Object.values(system.nodes).filter(
          (node) => node.kind === 'object' || node.kind === 'branch' || node.kind === 'folder'
        ).length,
      [system.nodes]
    )
    const showFilter = treeNodeCount >= FILTER_MIN_NODES || filter.length > 0
    const activeFilter = showFilter ? filter.trim() : ''

    // Filter: matches and their ancestors are forced open; descendants of a match
    // stay visible (following their own expansion). `null` means no filter.
    const filterState = (() => {
      if (!activeFilter) return null
      const forced = new Set<string>()
      const shown = new Set<string>()
      const visited = new Set<string>()
      const visit = (nodeId: string, ancestors: string[], underMatch: boolean) => {
        if (visited.has(nodeId)) return
        visited.add(nodeId)
        const node = system.nodes[nodeId]
        if (!node) return
        const matches = rowSummaryMatches(activeFilter, node.name, summaries.get(nodeId), [
          getNodeLabel(node, system),
        ])
        if (matches) {
          forced.add(nodeId)
          ancestors.forEach((id) => forced.add(id))
        }
        if (matches || underMatch) shown.add(nodeId)
        getChildIds(nodeId).forEach((childId) =>
          visit(childId, [...ancestors, nodeId], underMatch || matches)
        )
      }
      rootNodes.forEach((id) => visit(id, [], false))
      forced.forEach((id) => shown.add(id))
      return { forced, shown }
    })()

    const isShown = (nodeId: string) => !filterState || filterState.shown.has(nodeId)
    const isForcedOpen = (nodeId: string) =>
      Boolean(filterState) && getChildIds(nodeId).some((id) => filterState?.forced.has(id))
    const isOpen = (nodeId: string) =>
      isForcedOpen(nodeId) || Boolean(system.nodes[nodeId]?.expanded)

    // Rows in display order (ignoring drag previews) for keyboard navigation.
    const visibleOrder: string[] = []
    const parentOf = new Map<string, string | null>()
    {
      const seen = new Set<string>()
      const walk = (ids: string[], parentId: string | null) => {
        ids.forEach((id) => {
          if (seen.has(id) || !system.nodes[id] || !isShown(id)) return
          seen.add(id)
          visibleOrder.push(id)
          parentOf.set(id, parentId)
          if (isOpen(id)) walk(getChildIds(id), id)
        })
      }
      walk(rootNodes, null)
    }
    const tabStopId =
      selectedNodeId && visibleOrder.includes(selectedNodeId) ? selectedNodeId : visibleOrder[0]

    const moveFocusTo = (nodeId: string | null | undefined) => {
      if (!nodeId) return
      onSelect(nodeId)
      focusNodeLabel(nodeId)
    }

    /** Row to focus once `nodeId` (and its subtree) is gone: the next row, else the previous. */
    const rowAfterDelete = (nodeId: string): string | null => {
      const isInSubtree = (id: string) => {
        let cursor: string | null | undefined = id
        while (cursor) {
          if (cursor === nodeId) return true
          cursor = parentOf.get(cursor)
        }
        return false
      }
      const index = visibleOrder.indexOf(nodeId)
      if (index < 0) return null
      const next = visibleOrder.slice(index + 1).find((id) => !isInSubtree(id))
      return next ?? visibleOrder[index - 1] ?? null
    }

    const requestDelete = (nodeId: string) => {
      const node = system.nodes[nodeId]
      if (!node) return
      if (confirmDelete({ name: node.name, kind: getDeleteKindLabel(node, system) })) {
        // Keep keyboard focus in the tree instead of dropping it to <body>.
        pendingDeleteFocusRef.current = { deletedId: nodeId, nextId: rowAfterDelete(nodeId) }
        onDeleteNode(nodeId)
      }
    }

    const openContextMenuFromKeyboard = (nodeId: string) => {
      const rect = rowRefs.current.get(nodeId)?.getBoundingClientRect()
      openNodeContextMenu(nodeId, rect ? rect.left + 24 : 0, rect ? rect.bottom : 0, true)
    }

    const handleTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const nodeId =
        target.closest<HTMLElement>('[data-tree-node-id]')?.dataset.treeNodeId ?? tabStopId
      if (!nodeId) return
      const node = system.nodes[nodeId]
      if (!node) return
      const index = visibleOrder.indexOf(nodeId)
      const hasChildren = getChildIds(nodeId).length > 0
      const expanded = isOpen(nodeId)
      let handled = true
      switch (event.key) {
        case 'ArrowDown':
          moveFocusTo(visibleOrder[Math.min(visibleOrder.length - 1, index + 1)])
          break
        case 'ArrowUp':
          moveFocusTo(visibleOrder[Math.max(0, index - 1)])
          break
        case 'Home':
          moveFocusTo(visibleOrder[0])
          break
        case 'End':
          moveFocusTo(visibleOrder[visibleOrder.length - 1])
          break
        case 'ArrowRight':
          if (hasChildren && !expanded) onToggleExpanded(nodeId)
          else if (hasChildren && expanded) moveFocusTo(visibleOrder[index + 1])
          break
        case 'ArrowLeft':
          if (hasChildren && expanded && !isForcedOpen(nodeId)) onToggleExpanded(nodeId)
          else moveFocusTo(parentOf.get(nodeId))
          break
        case ' ':
          onToggleVisibility(nodeId)
          break
        case 'F2':
          startRename(node)
          break
        case 'Delete':
          requestDelete(nodeId)
          break
        case 'ContextMenu':
          openContextMenuFromKeyboard(nodeId)
          break
        case 'F10':
          if (event.shiftKey) openContextMenuFromKeyboard(nodeId)
          else handled = false
          break
        default:
          handled = false
      }
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const renderSummary = (nodeId: string, node: TreeNode, summaryId: string) => {
      if (node.kind === 'folder') {
        const count = getChildIds(nodeId).length
        return count > 0 ? (
          <span className="tree-node__summary" id={summaryId}>
            <span className="tree-node__count num" title={`${count} items`}>
              {count}
            </span>
          </span>
        ) : null
      }
      const summary = summaries.get(nodeId)
      if (!summary) return null
      const badges = formatBifurcationBadges(summary.bifs)
      const pending = summary.tone === 'muted' && !summary.status
      return (
        <span className="tree-node__summary" id={summaryId}>
          {summary.text ? (
            <span
              className={`tree-node__data num${pending ? ' tree-node__data--pending' : ''}`}
              title={summary.text}
            >
              <span className="tree-node__data-text">{summary.text}</span>
            </span>
          ) : null}
          {summary.status ? (
            <span
              className={`chip chip--${summary.tone ?? 'muted'} tree-node__status`}
              title={summary.warn}
            >
              {summary.status}
            </span>
          ) : null}
          {badges.shown.map((badge) => (
            <span
              key={badge.code}
              className={`bif bif--${badge.tone} tree-node__bif`}
              title={badge.count > 1 ? `${badge.code} × ${badge.count}` : badge.code}
            >
              {badge.label}
            </span>
          ))}
          {badges.overflow > 0 ? (
            <span
              className="tree-node__bif-more faint num"
              title={(summary.bifs ?? [])
                .slice(badges.shown.length)
                .map(([code, total]) => (total > 1 ? `${code}×${total}` : code))
                .join(' ')}
            >
              +{badges.overflow}
            </span>
          ) : null}
          {summary.warn && !summary.status ? (
            <span className="chip chip--warning tree-node__warn" title={summary.warn}>
              !
            </span>
          ) : null}
        </span>
      )
    }

    const renderNode = (nodeId: string, depth: number) => {
      const node = system.nodes[nodeId]
      if (!node) return null
      if (!isShown(nodeId) && draggingId !== nodeId) return null
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
      const childIds = getChildIds(nodeId)
      const hasChildren = childIds.length > 0
      const expanded = isOpen(nodeId)
      const isEditing = editingId === nodeId
      const isFolder = node.kind === 'folder'
      const nodeColor = node.render?.color ?? DEFAULT_RENDER.color
      const glyph = getNodeGlyph(node, system)
      const hidden = !node.visibility
      const inheritedHidden = !hidden && !isNodeEffectivelyVisible(system.nodes, nodeId)
      const summaryId = `tree-summary-${nodeId}`
      const summaryContent = renderSummary(nodeId, node, summaryId)
      const object = system.objects[nodeId]
      const customParameters =
        object && object.type !== 'continuation' && 'customParameters' in object
          ? object.customParameters
          : null
      const hasFrozenVariables =
        object &&
        object.type !== 'continuation' &&
        'frozenVariables' in object &&
        Object.keys(object.frozenVariables?.frozenValuesByVarName ?? {}).length > 0
      const rowClassName = [
        'tree-node__row',
        isSelected ? 'tree-node__row--selected' : '',
        hidden ? 'tree-node__row--hidden' : '',
        inheritedHidden ? 'tree-node__row--inherited-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')
      const visibilityLabel = isFolder
        ? node.visibility
          ? 'Hide folder'
          : 'Show folder'
        : node.visibility
          ? 'Hide node'
          : 'Show node'

      return (
        <div
          key={nodeId}
          className="tree-node"
          role="treeitem"
          aria-level={paddingDepth + 1}
          aria-selected={isSelected}
          aria-expanded={hasChildren ? expanded : undefined}
          aria-labelledby={isEditing ? undefined : `object-tree-label-${nodeId}`}
        >
          <div
            className={rowClassName}
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
                  tabIndex={-1}
                  aria-label={expanded ? 'Collapse node' : 'Expand node'}
                  data-testid={`node-expand-${nodeId}`}
                >
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                </button>
              ) : (
                <span className="tree-node__spacer" aria-hidden="true" />
              )}
              <span
                className="tree-node__glyph"
                style={isFolder ? undefined : ({ color: nodeColor } as CSSProperties)}
                data-kind={glyph.kind}
                aria-hidden="true"
                data-testid={isFolder ? `node-folder-icon-${nodeId}` : undefined}
              >
                <Icon name={glyph.icon} size={14} />
              </span>
              {isEditing ? (
                <input
                  className={`tree-node__rename${
                    renameError
                      ? ` tree-node__rename--invalid tree-node__rename--shake-${renameShake % 2}`
                      : ''
                  }`}
                  value={draftName}
                  autoFocus
                  onFocus={(event) => {
                    if (!renameError) event.currentTarget.select()
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    setRenameError(null)
                  }}
                  onBlur={() => commitRename(node, 'blur')}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      if (commitRename(node, 'enter')) focusNodeLabel(nodeId)
                    }
                    if (event.key === 'Escape') {
                      setRenameError(null)
                      setEditingId(null)
                      focusNodeLabel(nodeId)
                    }
                  }}
                  aria-label={`Rename ${node.name}`}
                  aria-invalid={renameError ? true : undefined}
                  title={renameError ?? undefined}
                  data-testid={`node-rename-input-${nodeId}`}
                />
              ) : (
                <button
                  className="tree-node__label"
                  ref={(label) => {
                    if (label) labelRefs.current.set(nodeId, label)
                    else labelRefs.current.delete(nodeId)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(nodeId)
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    startRename(node)
                  }}
                  tabIndex={nodeId === tabStopId ? 0 : -1}
                  title={node.name}
                  style={
                    {
                      '--tree-name-min': `${Math.min(Array.from(node.name).length, 6)}ch`,
                    } as CSSProperties
                  }
                  id={`object-tree-label-${nodeId}`}
                  aria-label={getNodeLabel(node, system)}
                  aria-describedby={summaryContent ? summaryId : undefined}
                  aria-current={isSelected ? 'true' : undefined}
                  data-testid={`object-tree-node-${nodeId}`}
                >
                  <span className="tree-node__name">{node.name}</span>
                </button>
              )}
              {hasCustomObjectParams(system.config, customParameters) ? (
                <span
                  className="tree-node__flag"
                  data-testid={`object-tree-custom-${nodeId}`}
                  title="Custom parameters"
                >
                  p
                </span>
              ) : null}
              {hasFrozenVariables ? (
                <span
                  className="tree-node__flag"
                  data-testid={`object-tree-frozen-${nodeId}`}
                  title="Frozen variables configured"
                  aria-label="Frozen variables configured"
                >
                  ❄
                </span>
              ) : null}
              <span className="tree-node__fill" aria-hidden="true" />
              {summaryContent}
              <button
                className="icon-btn icon-btn--sm tree-node__visibility"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleVisibility(nodeId)
                }}
                tabIndex={-1}
                data-visible={node.visibility ? 'true' : 'false'}
                aria-label={visibilityLabel}
                title={visibilityLabel}
                data-testid={`node-visibility-${nodeId}`}
              >
                <Icon name={node.visibility ? 'eye' : 'eye-off'} size={14} />
              </button>
            </div>
          </div>
          {(hasChildren || dropPreview?.targetId === nodeId) &&
          (expanded || dropPreview?.targetId === nodeId) ? (
            <div className="tree-node__children" role="group">
              {getPreviewOrder(childIds, nodeId).map((childId) =>
                renderNode(childId, depth + 1)
              )}
            </div>
          ) : null}
        </div>
      )
    }

    const contextNode = nodeContextMenu ? system.nodes[nodeContextMenu.id] ?? null : null
    const contextParent = contextNode?.parentId
      ? system.nodes[contextNode.parentId] ?? null
      : null
    const canWrapInFolder =
      contextNode?.kind === 'object' &&
      contextNode.objectType !== 'particles' &&
      (!contextParent || contextParent.kind === 'folder')
    const contextHasBranches =
      contextNode?.kind === 'object' &&
      getChildIds(contextNode.id).some((id) => system.nodes[id]?.kind === 'branch')

    const createFolderAndRename = (
      parentId: string | null,
      options?: { wrapNodeId?: string }
    ) => {
      const created = options ? onCreateFolder(parentId, options) : onCreateFolder(parentId)
      if (typeof created === 'string' && created) {
        createdFolderRenameRef.current = created
        setEditingId(created)
        setDraftName('')
      }
    }

    // Fill the rename draft once a just-created folder shows up in the tree.
    useEffect(() => {
      const pendingId = createdFolderRenameRef.current
      if (!pendingId) return
      const node = system.nodes[pendingId]
      if (!node) return
      createdFolderRenameRef.current = null
      if (editingId === pendingId) setDraftName(node.name)
    }, [editingId, system.nodes])

    // Folders created outside the tree (the panel's folder button, the command
    // palette) are selected by the create command; start naming them right away,
    // like folders created from the tree menus.
    const knownFoldersRef = useRef<{ systemId: string; ids: Set<string> } | null>(null)
    useEffect(() => {
      const ids = new Set(
        Object.values(system.nodes)
          .filter((node) => node.kind === 'folder')
          .map((node) => node.id)
      )
      const known = knownFoldersRef.current
      knownFoldersRef.current = { systemId: system.id, ids }
      if (!known || known.systemId !== system.id) return
      const created = [...ids].filter((id) => !known.ids.has(id))
      if (created.length !== 1) return
      const createdId = created[0]!
      const node = system.nodes[createdId]
      if (!node || system.ui.selectedNodeId !== createdId || editingId === createdId) return
      setEditingId(createdId)
      setDraftName(node.name)
      setRenameError(null)
    }, [editingId, system.id, system.nodes, system.ui.selectedNodeId])

    const runMenuAction = (action: () => void) => {
      closeMenus()
      action()
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
        {showFilter ? (
          <label className="objects-tree__filter">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={filter}
              placeholder="Filter"
              aria-label="Filter objects"
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && filter) {
                  event.stopPropagation()
                  setFilter('')
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveFocusTo(visibleOrder[0])
                }
              }}
              data-testid="objects-tree-filter"
            />
          </label>
        ) : null}
        <div
          className="objects-tree__list"
          role="tree"
          aria-label="Objects"
          onKeyDown={handleTreeKeyDown}
          onKeyUp={(event) => {
            // Space toggles visibility; keep it from also clicking the focused label.
            if (event.key === ' ' && !(event.target as HTMLElement).closest('input')) {
              event.preventDefault()
            }
          }}
        >
          {activeFilter && visibleOrder.length === 0 ? (
            <p className="objects-tree__empty faint">No matches</p>
          ) : null}
          {getPreviewOrder(rootNodes, null).map((nodeId) => renderNode(nodeId, 0))}
        </div>
        {createMenu ? (
          <div
            className="tree-menu menu-surface"
            style={{ left: createMenu.x, top: createMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            ref={createMenuRef}
            data-testid="create-object-menu"
          >
            <button
              className="menu-item"
              onClick={() => runMenuAction(onCreateOrbit)}
              data-testid="create-orbit"
            >
              <Icon name="orbit" size={14} />
              Orbit
            </button>
            <button
              className="menu-item"
              onClick={() => runMenuAction(onCreateEquilibrium)}
              data-testid="create-equilibrium"
            >
              <Icon name="equilibrium" size={14} />
              {createEquilibriumLabel}
            </button>
            {system.config.periodicForcing ? (
              <button
                className="menu-item"
                onClick={() => runMenuAction(() => onCreateForcedPeriodicResponse())}
                data-testid="create-forced-periodic-response"
              >
                <Icon name="cycle" size={14} />
                Forced periodic response
              </button>
            ) : null}
            <hr />
            <button
              className="menu-item"
              onClick={() => runMenuAction(onCreateIsocline)}
              data-testid="create-isocline"
            >
              <Icon name="isocline" size={14} />
              Isocline
            </button>
            <button
              className="menu-item"
              onClick={() => runMenuAction(onCreateStateGrid)}
              data-testid="create-state-grid"
            >
              <Icon name="grid" size={14} />
              State grid
            </button>
            <hr />
            <button
              className="menu-item"
              onClick={() => runMenuAction(() => createFolderAndRename(null))}
              data-testid="create-folder"
            >
              <Icon name="folder" size={14} />
              Folder
            </button>
          </div>
        ) : null}
        {nodeContextMenu && contextNode ? (
          <div
            className="tree-menu menu-surface"
            style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            ref={nodeContextMenuRef}
            data-testid="object-context-menu"
          >
            <button
              className="menu-item"
              onClick={() => runMenuAction(() => startRename(contextNode))}
              data-testid="object-context-rename"
            >
              <Icon name="pencil" size={14} />
              Rename
              <span className="kbd tree-menu__hint">F2</span>
            </button>
            {contextNode.kind === 'object' || contextNode.kind === 'branch' ? (
              <button
                className="menu-item"
                onClick={() => runMenuAction(() => void onDuplicateNode(contextNode.id))}
                data-testid="object-context-duplicate"
              >
                <Icon name="copy" size={14} />
                Duplicate
              </button>
            ) : null}
            <button
              className="menu-item"
              onClick={() => runMenuAction(() => onToggleVisibility(contextNode.id))}
              data-testid="object-context-visibility"
            >
              <Icon name={contextNode.visibility ? 'eye-off' : 'eye'} size={14} />
              {contextNode.visibility ? 'Hide' : 'Show'}
              <span className="kbd tree-menu__hint">Space</span>
            </button>
            {system.config.periodicForcing &&
            contextNode.kind === 'object' &&
            contextNode.objectType === 'orbit' ? (
              <button
                className="menu-item"
                onClick={() =>
                  runMenuAction(() => onCreateForcedPeriodicResponse(contextNode.id))
                }
                data-testid="object-context-create-forced-periodic-response"
              >
                <Icon name="cycle" size={14} />
                Create forced periodic response
              </button>
            ) : null}
            {contextNode.kind === 'folder' || canWrapInFolder || contextHasBranches ? (
              <hr />
            ) : null}
            {contextNode.kind === 'folder' ? (
              <button
                className="menu-item"
                onClick={() => runMenuAction(() => createFolderAndRename(contextNode.id))}
                data-testid="object-context-create-folder"
              >
                <Icon name="folder" size={14} />
                New subfolder
              </button>
            ) : null}
            {canWrapInFolder ? (
              <button
                className="menu-item"
                onClick={() =>
                  runMenuAction(() =>
                    createFolderAndRename(contextNode.parentId ?? null, {
                      wrapNodeId: contextNode.id,
                    })
                  )
                }
                data-testid="object-context-create-folder"
              >
                <Icon name="folder" size={14} />
                Move to new folder
              </button>
            ) : null}
            {contextHasBranches ? (
              <button
                className="menu-item"
                onClick={() => runMenuAction(() => createFolderAndRename(contextNode.id))}
                data-testid="object-context-create-branch-folder"
              >
                <Icon name="folder" size={14} />
                New branch folder
              </button>
            ) : null}
            <hr />
            <button
              className="menu-item tree-menu__danger"
              onClick={() => runMenuAction(() => requestDelete(contextNode.id))}
              data-testid="object-context-delete"
            >
              <Icon name="trash" size={14} />
              Delete
              <span className="kbd tree-menu__hint">Del</span>
            </button>
          </div>
        ) : null}
      </div>
    )
  }
)
