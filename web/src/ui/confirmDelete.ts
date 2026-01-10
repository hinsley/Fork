import type { TreeNode } from '../system/types'

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

export function getDeleteKindLabel(node: TreeNode): string {
  if (node.kind === 'branch') return 'Branch'
  if (node.kind === 'scene') return 'Scene'
  if (node.kind === 'diagram') return 'Bifurcation diagram'
  if (node.kind === 'camera') return 'Camera'
  if (node.kind === 'object') {
    if (node.objectType === 'orbit') return 'Orbit'
    if (node.objectType === 'equilibrium') return 'Equilibrium'
    if (node.objectType === 'limit_cycle') return 'Limit cycle'
    return 'Object'
  }
  return 'Item'
}
