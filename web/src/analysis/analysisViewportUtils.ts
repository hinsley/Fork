import type { AnalysisAxisSpec, AnalysisViewport, System } from '../system/types'

export type AnalysisSourceEntry = {
  id: string
  name: string
  typeLabel: string
  visible: boolean
}

function formatObservableOffset(hitOffset: -1 | 0 | 1): string {
  if (hitOffset === 0) return 'n'
  return hitOffset > 0 ? `n+${hitOffset}` : `n${hitOffset}`
}

function formatSourceTypeLabel(system: System, nodeId: string): string {
  const object = system.objects[nodeId]
  if (object?.type === 'orbit') return 'Orbit'
  if (object?.type === 'limit_cycle') return 'Limit cycle'
  const branch = system.branches[nodeId]
  if (branch?.branchType === 'eq_manifold_1d') return '1D manifold'
  return 'Analysis source'
}

export function isAnalysisSourceNode(system: System, nodeId: string): boolean {
  const node = system.nodes[nodeId]
  if (!node) return false
  if (node.kind === 'object') {
    const object = system.objects[nodeId]
    return object?.type === 'orbit' || object?.type === 'limit_cycle'
  }
  if (node.kind === 'branch') {
    return system.branches[nodeId]?.branchType === 'eq_manifold_1d'
  }
  return false
}

export function collectAnalysisSourceEntries(system: System): AnalysisSourceEntry[] {
  const entries: AnalysisSourceEntry[] = []
  const stack = [...system.rootIds]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = system.nodes[nodeId]
    if (!node) continue
    if (node.children.length > 0) {
      stack.push(...node.children)
    }
    if (!isAnalysisSourceNode(system, nodeId)) continue
    entries.push({
      id: nodeId,
      name: node.name,
      typeLabel: formatSourceTypeLabel(system, nodeId),
      visible: node.visibility,
    })
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

export function resolveAnalysisSourceIds(
  system: System,
  viewport: AnalysisViewport,
  selectedNodeId: string | null
): string[] {
  if (viewport.sourceNodeIds.length > 0) {
    return viewport.sourceNodeIds.filter((nodeId) => isAnalysisSourceNode(system, nodeId))
  }
  if (
    viewport.display === 'selection' &&
    selectedNodeId &&
    isAnalysisSourceNode(system, selectedNodeId)
  ) {
    return [selectedNodeId]
  }
  return collectAnalysisSourceEntries(system)
    .filter((entry) => entry.visible)
    .map((entry) => entry.id)
}

export function resolveAnalysisAxisLabel(axis: AnalysisAxisSpec): string {
  const trimmedLabel = axis.label?.trim()
  if (trimmedLabel) return trimmedLabel
  if (axis.kind === 'observable') {
    return `${axis.expression}@${formatObservableOffset(axis.hitOffset)}`
  }
  if (axis.kind === 'hit_index') return 'Hit index'
  return 'Delta t'
}
