import {
  moveNode as moveSystemNode,
  renameNode as renameSystemNode,
  reorderNode as reorderSystemNode,
  selectNode as selectSystemNode,
  toggleNodeExpanded,
  toggleNodeVisibility,
  updateLayout as updateSystemLayout,
  updateNodeRender,
  updateViewportHeights,
} from '../system/model'
import { formatEquilibriumLabel } from '../system/labels'
import type { System, SystemConfig, TreeNode } from '../system/types'
import { isCliSafeName } from '../utils/naming'

type SystemTreeAction =
  | { type: 'SET_SYSTEM'; system: System | null }
  | { type: 'SET_ERROR'; error: string | null }

type LoadEntity = (id: string) => void | Promise<void>
type ScheduleSave = (system: System) => void

export type SystemTreeCommands = {
  selectNode: (nodeId: string | null) => void
  renameNode: (nodeId: string, name: string) => void
  toggleVisibility: (nodeId: string) => void
  toggleExpanded: (nodeId: string) => void
  moveNode: (nodeId: string, direction: 'up' | 'down') => void
  reorderNode: (nodeId: string, targetId: string) => void
  updateLayout: (layout: Partial<System['ui']['layout']>) => void
  updateViewportHeight: (nodeId: string, height: number) => void
  updateRender: (nodeId: string, render: Partial<TreeNode['render']>) => void
}

export type SystemTreeCommandDeps = {
  dispatch: (action: SystemTreeAction) => void
  getCurrentSystem: () => System | null
  scheduleSystemSave: ScheduleSave
  scheduleUiSave: ScheduleSave
  ensureObjectLoaded: LoadEntity
  ensureBranchLoaded: LoadEntity
}

export function validateObjectName(name: string, label: string): string | null {
  if (!name.trim()) return `${label} name is required.`
  if (!isCliSafeName(name)) {
    return `${label} names must be alphanumeric with underscores only.`
  }
  return null
}

function getNodeLabel(node: TreeNode | undefined, systemType: SystemConfig['type']): string {
  if (!node) return 'Item'
  if (node.kind === 'branch') return 'Branch'
  if (node.kind === 'scene') return 'Scene'
  if (node.kind === 'diagram') return 'Bifurcation diagram'
  if (node.kind === 'object') {
    if (node.objectType === 'orbit') return 'Orbit'
    if (node.objectType === 'equilibrium') return formatEquilibriumLabel(systemType)
    if (node.objectType === 'limit_cycle') return 'Limit cycle'
    if (node.objectType === 'isocline') return 'Isocline'
    return 'Object'
  }
  return 'Item'
}

function shouldSaveUiOnly(node: TreeNode | undefined): boolean {
  return node?.kind === 'scene' || node?.kind === 'diagram' || node?.kind === 'analysis'
}

export function createSystemTreeCommands({
  dispatch,
  getCurrentSystem,
  scheduleSystemSave,
  scheduleUiSave,
  ensureObjectLoaded,
  ensureBranchLoaded,
}: SystemTreeCommandDeps): SystemTreeCommands {
  const selectNode = (nodeId: string | null) => {
    const current = getCurrentSystem()
    if (!current) return
    if (current.ui.selectedNodeId === nodeId) return

    const system = selectSystemNode(current, nodeId)
    dispatch({ type: 'SET_SYSTEM', system })
    if (!nodeId) return

    if (system.index.objects[nodeId]) {
      void ensureObjectLoaded(nodeId)
    } else if (system.index.branches[nodeId]) {
      void ensureBranchLoaded(nodeId)
    }
  }

  const renameNode = (nodeId: string, name: string) => {
    const current = getCurrentSystem()
    if (!current) return

    const trimmedName = name.trim()
    const node = current.nodes[nodeId]
    const nameError = validateObjectName(trimmedName, getNodeLabel(node, current.config.type))
    if (nameError) {
      dispatch({ type: 'SET_ERROR', error: nameError })
      return
    }
    if (!node) return

    const system = renameSystemNode(current, nodeId, trimmedName)
    dispatch({ type: 'SET_SYSTEM', system })
    if (shouldSaveUiOnly(node)) {
      scheduleUiSave(system)
    } else {
      scheduleSystemSave(system)
    }
  }

  const toggleVisibility = (nodeId: string) => {
    const current = getCurrentSystem()
    if (!current) return
    const system = toggleNodeVisibility(current, nodeId)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const toggleExpanded = (nodeId: string) => {
    const current = getCurrentSystem()
    if (!current) return
    const system = toggleNodeExpanded(current, nodeId)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const moveNode = (nodeId: string, direction: 'up' | 'down') => {
    const current = getCurrentSystem()
    if (!current) return
    const system = moveSystemNode(current, nodeId, direction)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const reorderNode = (nodeId: string, targetId: string) => {
    const current = getCurrentSystem()
    if (!current) return
    const system = reorderSystemNode(current, nodeId, targetId)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const updateLayout = (layout: Partial<System['ui']['layout']>) => {
    const current = getCurrentSystem()
    if (!current) return
    const system = updateSystemLayout(current, layout)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const updateViewportHeight = (nodeId: string, height: number) => {
    const current = getCurrentSystem()
    if (!current || !Number.isFinite(height)) return
    const system = updateViewportHeights(current, { [nodeId]: height })
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  const updateRender = (nodeId: string, render: Partial<TreeNode['render']>) => {
    const current = getCurrentSystem()
    if (!current) return
    const system = updateNodeRender(current, nodeId, render)
    dispatch({ type: 'SET_SYSTEM', system })
    scheduleUiSave(system)
  }

  return {
    selectNode,
    renameNode,
    toggleVisibility,
    toggleExpanded,
    moveNode,
    reorderNode,
    updateLayout,
    updateViewportHeight,
    updateRender,
  }
}
