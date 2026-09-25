import type { IconName } from './Icon'
import type { System, TreeNode } from '../system/types'

/** Type glyph for a tree node, shared by the objects tree and the command palette. */
export function getNodeGlyph(node: TreeNode, system: System): { icon: IconName; kind: string } {
  if (node.kind === 'folder') return { icon: 'folder', kind: 'folder' }
  if (node.kind === 'scene') return { icon: 'scene', kind: 'scene' }
  if (node.kind === 'diagram') return { icon: 'diagram', kind: 'diagram' }
  if (node.kind === 'analysis') return { icon: 'analysis', kind: 'analysis' }
  if (node.kind === 'branch') {
    const branchType =
      system.branches[node.id]?.branchType ?? system.index.branches[node.id]?.branchType
    if (branchType?.includes('manifold')) return { icon: 'manifold', kind: `branch-${branchType}` }
    return { icon: 'branch', kind: branchType ? `branch-${branchType}` : 'branch' }
  }
  switch (node.objectType) {
    case 'orbit':
      return { icon: 'orbit', kind: 'orbit' }
    case 'equilibrium':
      return { icon: 'equilibrium', kind: 'equilibrium' }
    case 'limit_cycle':
      return { icon: 'cycle', kind: 'limit_cycle' }
    case 'forced_periodic_response':
      return { icon: 'cycle', kind: 'forced_periodic_response' }
    case 'isocline':
      return { icon: 'isocline', kind: 'isocline' }
    case 'state_grid':
      return { icon: 'grid', kind: 'state_grid' }
    case 'invariant_measure':
      return { icon: 'measure', kind: 'invariant_measure' }
    case 'particles':
      return { icon: 'particles', kind: 'particles' }
    default:
      return { icon: 'orbit', kind: node.objectType ?? node.kind }
  }
}
