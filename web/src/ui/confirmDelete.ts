import type { System, TreeNode } from '../system/types'
import { formatEquilibriumLabel } from '../system/labels'

type ConfirmDeleteTarget = {
  name: string
  kind?: string
}

export function confirmDelete({ name, kind }: ConfirmDeleteTarget): boolean {
  const trimmedName = name.trim()
  const nameLabel = trimmedName ? `"${trimmedName}"` : 'this item'
  const targetLabel = kind ? `${kind} ${nameLabel}` : nameLabel
  return window.confirm(`Are you sure you want to delete ${targetLabel}?`)
}

export function getDeleteKindLabel(node: TreeNode, system: System): string {
  if (node.kind === 'branch') return 'Branch'
  if (node.kind === 'scene') return 'Scene'
  if (node.kind === 'diagram') return 'Bifurcation diagram'
  if (node.kind === 'camera') return 'Camera'
  if (node.kind === 'object') {
    if (node.objectType === 'orbit') return 'Orbit'
    if (node.objectType === 'equilibrium') {
      const object = system.objects[node.id]
      const mapIterations =
        system.config.type === 'map' && object?.type === 'equilibrium'
          ? object.lastSolverParams?.mapIterations ??
            object.solution?.cycle_points?.length
          : undefined
      return formatEquilibriumLabel(system.config.type, { mapIterations })
    }
    if (node.objectType === 'limit_cycle') return 'Limit cycle'
    return 'Object'
  }
  return 'Item'
}
