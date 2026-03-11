import type {
  AnalysisAxisSpec,
  AnalysisEventSpec,
  AnalysisViewport,
  IsoclineSource,
  System,
  SystemConfig,
} from '../system/types'

export type AnalysisSourceEntry = {
  id: string
  name: string
  typeLabel: string
  visible: boolean
}

export function formatAnalysisHitOffset(hitOffset: number): string {
  if (hitOffset === 0) return 'n'
  return hitOffset > 0 ? `n+${hitOffset}` : `n${hitOffset}`
}

export function resolveAnalysisSourceExpression(
  systemConfig: SystemConfig,
  source: IsoclineSource
): string {
  if (source.kind === 'custom') return source.expression
  const index = systemConfig.varNames.indexOf(source.variableName)
  if (index < 0 || index >= systemConfig.equations.length) return ''
  if (source.kind === 'flow_derivative') {
    return systemConfig.equations[index] ?? ''
  }
  return `(${systemConfig.equations[index] ?? ''}) - (${source.variableName})`
}

export function resolveAnalysisEventExpression(
  systemConfig: SystemConfig,
  event: AnalysisEventSpec
): string {
  if (event.mode === 'every_iterate') {
    return systemConfig.varNames[0] ?? systemConfig.paramNames[0] ?? '0'
  }
  return resolveAnalysisSourceExpression(systemConfig, event.source)
}

export function normalizeAnalysisExpressionError(message: string): string {
  return message.replace(/^(Event|Observable|Constraint) expression error:\s*/i, '').trim()
}

export function resolveAnalysisConstraintExpressions(event: AnalysisEventSpec): string[] {
  return Array.isArray(event.positivityConstraints) ? event.positivityConstraints : []
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
  return resolveAnalysisAxisLabelForSystem(axis, 'flow')
}

export function resolveAnalysisAxisLabelForSystem(
  axis: AnalysisAxisSpec,
  systemType: SystemConfig['type']
): string {
  const trimmedLabel = axis.label?.trim()
  if (trimmedLabel) return trimmedLabel
  if (axis.kind === 'observable') {
    return `${axis.expression}@${formatAnalysisHitOffset(axis.hitOffset)}`
  }
  if (axis.kind === 'hit_index') return 'Hit index'
  return `${systemType === 'map' ? 'Delta n' : 'Delta t'}@${formatAnalysisHitOffset(axis.hitOffset)}`
}
