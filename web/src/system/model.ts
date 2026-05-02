import type {
  AnalysisAxisSpec,
  AnalysisObject,
  AnalysisViewport,
  AnalysisViewportAdvanced,
  AnalysisEventSpec,
  BifurcationAxis,
  BifurcationDiagram,
  ContinuationObject,
  LimitCycleRenderTarget,
  RenderStyle,
  System,
  SystemIndex,
  SystemLayout,
  SystemUiState,
  Scene,
  SystemConfig,
  TreeNode
} from './types'
import { makeStableId as makeId, nowIso } from '../utils/determinism'
import { resolveSceneAxisSelection } from './sceneAxes'

const DEFAULT_SYSTEM: SystemConfig = {
  name: 'Untitled System',
  equations: ['y', '-x'],
  params: [],
  paramNames: [],
  varNames: ['x', 'y'],
  solver: 'rk4',
  type: 'flow'
}

const DEFAULT_LAYOUT: SystemLayout = {
  leftWidth: 280,
  rightWidth: 320,
  objectsOpen: true,
  inspectorOpen: true,
  branchViewerOpen: true
}

const DEFAULT_UI: SystemUiState = {
  selectedNodeId: null,
  layout: DEFAULT_LAYOUT,
  viewportHeights: {},
  limitCycleRenderTargets: {}
}

export const DEFAULT_SCENE_CAMERA: Scene['camera'] = {
  eye: { x: 1.6, y: 1.4, z: 0.8 },
  center: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 }
}

const DEFAULT_SCENE: Scene = {
  id: 'scene-main',
  name: 'Main_Scene',
  camera: structuredClone(DEFAULT_SCENE_CAMERA),
  axisRanges: {},
  viewRevision: 0,
  axisVariables: null,
  selectedNodeIds: [],
  display: 'all'
}

const DEFAULT_ANALYSIS_EVENT: AnalysisEventSpec = {
  mode: 'cross_up',
  source: {
    kind: 'custom',
    expression: 'x'
  },
  level: 0,
  positivityConstraints: []
}

const DEFAULT_ANALYSIS_ADVANCED: AnalysisViewportAdvanced = {
  skipHits: 0,
  hitStride: 1,
  maxHits: 2000,
  connectPoints: false,
  showIdentityLine: true,
  identityLineColor: '#787878',
  identityLineStyle: 'dotted'
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback
}

function defaultObservableAxis(
  expression: string,
  hitOffset: number,
  label?: string
): AnalysisAxisSpec {
  return {
    kind: 'observable',
    expression,
    hitOffset,
    label
  }
}

function defaultReturnMapViewport(
  config: SystemConfig,
  id: string,
  name: string
): AnalysisViewport {
  const firstVar = config.varNames[0] ?? 'x'
  const remaining = config.varNames.filter((varName) => varName !== firstVar)
  if (config.type === 'map') {
    return {
      id,
      name,
      kind: 'return_map',
      axisRanges: {},
      viewRevision: 0,
      sourceNodeIds: [],
      display: 'all',
      event: {
        ...DEFAULT_ANALYSIS_EVENT,
        mode: 'every_iterate',
        source: {
          kind: 'custom',
          expression: firstVar
        }
      },
      axes: {
        x: defaultObservableAxis(firstVar, 0, `${firstVar}@n`),
        y: defaultObservableAxis(firstVar, 1, `${firstVar}@n+1`),
        z: null
      },
      advanced: structuredClone(DEFAULT_ANALYSIS_ADVANCED)
    }
  }

  const xExpression = remaining[0] ?? firstVar
  const yExpression = remaining[1] ?? remaining[0] ?? firstVar
  const yOffset: -1 | 0 | 1 = remaining.length >= 2 ? 0 : 1
  return {
    id,
    name,
    kind: 'return_map',
    axisRanges: {},
    viewRevision: 0,
    sourceNodeIds: [],
    display: 'all',
    event: {
      ...DEFAULT_ANALYSIS_EVENT,
      source: {
        kind: 'custom',
        expression: firstVar
      }
    },
    axes: {
      x: defaultObservableAxis(xExpression, 0, `${xExpression}@n`),
      y: defaultObservableAxis(
        yExpression,
        yOffset,
        `${yExpression}@${yOffset === 0 ? 'n' : 'n+1'}`
      ),
      z: null
    },
    advanced: structuredClone(DEFAULT_ANALYSIS_ADVANCED)
  }
}

export const DEFAULT_RENDER: RenderStyle = {
  color: '#e06c3f',
  lineWidth: 2,
  lineStyle: 'solid',
  pointSize: 4,
  stateSpaceStride: 1,
  manifoldSurfaceVisible: true
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function shardForEntityId(id: string): string {
  return (fnv1a32(id) & 0xff).toString(16).padStart(2, '0')
}

export function emptySystemIndex(): SystemIndex {
  return {
    objects: {},
    branches: {}
  }
}

function rebuildSystemIndex(system: System): SystemIndex {
  const index = emptySystemIndex()
  const updatedAt = system.updatedAt
  Object.entries(system.objects).forEach(([id, obj]) => {
    index.objects[id] = {
      id,
      name: obj.name,
      objectType: obj.type,
      shard: shardForEntityId(id),
      updatedAt
    }
  })
  Object.entries(system.branches).forEach(([id, branch]) => {
    index.branches[id] = {
      id,
      name: branch.name,
      branchType: branch.branchType,
      parentObjectId: branch.parentObjectId ?? null,
      startObjectId: branch.startObjectId ?? null,
      shard: shardForEntityId(id),
      updatedAt
    }
  })
  return index
}

// IDs and timestamps are routed through deterministic helpers for tests.

export function createSystem(args: {
  name: string
  config?: SystemConfig
}): System {
  const config = args.config
    ? { ...args.config }
    : { ...DEFAULT_SYSTEM, name: args.name }

  return {
    id: makeId('system'),
    name: args.name,
    config,
    index: emptySystemIndex(),
    nodes: {},
    rootIds: [],
    objects: {},
    branches: {},
    scenes: [],
    bifurcationDiagrams: [],
    analysisViewports: [],
    ui: structuredClone(DEFAULT_UI),
    updatedAt: nowIso()
  }
}

export function createTreeNode(params: {
  id?: string
  name: string
  kind: TreeNode['kind']
  objectType?: TreeNode['objectType']
  parentId: string | null
}): TreeNode {
  return {
    id: params.id ?? makeId('node'),
    name: params.name,
    kind: params.kind,
    objectType: params.objectType,
    parentId: params.parentId,
    children: [],
    visibility: true,
    expanded: true,
    render: { ...DEFAULT_RENDER }
  }
}

export function addObject(
  system: System,
  obj: AnalysisObject
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const node = createTreeNode({
    name: obj.name,
    kind: 'object',
    objectType: obj.type,
    parentId: null
  })
  const updatedAt = nowIso()
  next.nodes[node.id] = node
  next.rootIds.push(node.id)
  next.objects[node.id] = { ...obj, id: node.id }
  next.index.objects[node.id] = {
    id: node.id,
    name: obj.name,
    objectType: obj.type,
    shard: shardForEntityId(node.id),
    updatedAt
  }
  next.updatedAt = updatedAt
  return { system: next, nodeId: node.id }
}

export function addFolder(
  system: System,
  name: string,
  parentId: string | null = null
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const parent = parentId ? next.nodes[parentId] : null
  if (parentId && !parent) return { system, nodeId: '' }
  const node = createTreeNode({
    name,
    kind: 'folder',
    objectType: 'folder',
    parentId
  })
  next.nodes[node.id] = node
  if (parent) {
    parent.children.push(node.id)
    parent.expanded = true
  } else {
    next.rootIds.push(node.id)
  }
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

/**
 * Update an existing analysis object without touching tree structure.
 */
export function updateObject(
  system: System,
  nodeId: string,
  update: Partial<AnalysisObject>
): System {
  const next = structuredClone(system)
  const existing = next.objects[nodeId]
  if (!existing) return system
  const updatedAt = nowIso()
  const updated = {
    ...existing,
    ...update,
    type: existing.type,
    id: nodeId
  } as AnalysisObject
  next.objects[nodeId] = updated
  next.index.objects[nodeId] = {
    id: nodeId,
    name: updated.name,
    objectType: updated.type,
    shard: shardForEntityId(nodeId),
    updatedAt
  }
  next.updatedAt = updatedAt
  return next
}

export function updateBranch(
  system: System,
  nodeId: string,
  branch: ContinuationObject
): System {
  const next = structuredClone(system)
  if (!next.branches[nodeId]) return system
  const updatedAt = nowIso()
  const normalized: ContinuationObject = {
    ...branch,
    id: nodeId,
    parentObjectId:
      branch.parentObjectId ?? next.nodes[nodeId]?.parentId ?? undefined,
    startObjectId:
      branch.startObjectId ??
      branch.parentObjectId ??
      next.nodes[nodeId]?.parentId ??
      undefined
  }
  next.branches[nodeId] = normalized
  next.index.branches[nodeId] = {
    id: nodeId,
    name: normalized.name,
    branchType: normalized.branchType,
    parentObjectId: normalized.parentObjectId ?? null,
    startObjectId: normalized.startObjectId ?? null,
    shard: shardForEntityId(nodeId),
    updatedAt
  }
  next.updatedAt = updatedAt
  return next
}

export function addBranch(
  system: System,
  branch: ContinuationObject,
  parentNodeId: string
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const node = createTreeNode({
    name: branch.name,
    kind: 'branch',
    objectType: 'continuation',
    parentId: parentNodeId
  })
  const updatedAt = nowIso()
  next.nodes[node.id] = node
  const normalized: ContinuationObject = {
    ...branch,
    id: node.id,
    parentObjectId: branch.parentObjectId ?? parentNodeId,
    startObjectId: branch.startObjectId ?? branch.parentObjectId ?? parentNodeId
  }
  next.branches[node.id] = normalized
  next.index.branches[node.id] = {
    id: node.id,
    name: normalized.name,
    branchType: normalized.branchType,
    parentObjectId: normalized.parentObjectId ?? null,
    startObjectId: normalized.startObjectId ?? null,
    shard: shardForEntityId(node.id),
    updatedAt
  }
  const parent = next.nodes[parentNodeId]
  if (parent) {
    parent.children.push(node.id)
    parent.expanded = true
  }
  next.updatedAt = updatedAt
  return { system: next, nodeId: node.id }
}

export function addScene(
  system: System,
  name: string
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const sceneId = makeId('scene')
  const axisVariables = resolveSceneAxisSelection(next.config.varNames, null)
  const node = createTreeNode({
    id: sceneId,
    name,
    kind: 'scene',
    objectType: 'scene',
    parentId: null
  })
  next.nodes[node.id] = node
  next.rootIds.push(node.id)
  next.scenes.push({
    id: sceneId,
    name,
    camera: structuredClone(DEFAULT_SCENE.camera),
    axisRanges: structuredClone(DEFAULT_SCENE.axisRanges),
    viewRevision: DEFAULT_SCENE.viewRevision,
    axisVariables: axisVariables ?? null,
    selectedNodeIds: [],
    display: 'all'
  })
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

export function addBifurcationDiagram(
  system: System,
  name: string
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const diagramId = makeId('diagram')
  const node = createTreeNode({
    id: diagramId,
    name,
    kind: 'diagram',
    objectType: 'bifurcation',
    parentId: null
  })
  next.nodes[node.id] = node
  next.rootIds.push(node.id)
  next.bifurcationDiagrams.push({
    id: diagramId,
    name,
    selectedBranchIds: [],
    xAxis: null,
    yAxis: null,
    axisRanges: {},
    viewRevision: 0
  })
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

export function addAnalysisViewport(
  system: System,
  name: string
): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const analysisId = makeId('analysis')
  const node = createTreeNode({
    id: analysisId,
    name,
    kind: 'analysis',
    objectType: 'analysis',
    parentId: null
  })
  next.nodes[node.id] = node
  next.rootIds.push(node.id)
  next.analysisViewports.push(
    defaultReturnMapViewport(next.config, analysisId, name)
  )
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

export function renameNode(
  system: System,
  nodeId: string,
  newName: string
): System {
  const node = system.nodes[nodeId]
  if (!node) return system
  const updatedAt = nowIso()
  const nextNodes = {
    ...system.nodes,
    [nodeId]: {
      ...node,
      name: newName
    }
  }
  let nextObjects = system.objects
  if (system.objects[nodeId]) {
    nextObjects = {
      ...system.objects,
      [nodeId]: { ...system.objects[nodeId], name: newName, id: nodeId }
    }
  }
  let nextBranches = system.branches
  if (system.branches[nodeId]) {
    nextBranches = {
      ...system.branches,
      [nodeId]: { ...system.branches[nodeId], name: newName, id: nodeId }
    }
  }
  const nextIndex = structuredClone(system.index)
  if (nextIndex.objects[nodeId]) {
    nextIndex.objects[nodeId].name = newName
    nextIndex.objects[nodeId].updatedAt = updatedAt
  }
  if (nextIndex.branches[nodeId]) {
    nextIndex.branches[nodeId].name = newName
    nextIndex.branches[nodeId].updatedAt = updatedAt
  }

  const sceneIndex = system.scenes.findIndex((entry) => entry.id === nodeId)
  let nextScenes = system.scenes
  if (sceneIndex !== -1) {
    nextScenes = [...system.scenes]
    nextScenes[sceneIndex] = { ...nextScenes[sceneIndex], name: newName }
  }

  const diagramIndex = system.bifurcationDiagrams.findIndex(
    (entry) => entry.id === nodeId
  )
  let nextBifurcationDiagrams = system.bifurcationDiagrams
  if (diagramIndex !== -1) {
    nextBifurcationDiagrams = [...system.bifurcationDiagrams]
    nextBifurcationDiagrams[diagramIndex] = {
      ...nextBifurcationDiagrams[diagramIndex],
      name: newName
    }
  }

  const analysisIndex = system.analysisViewports.findIndex(
    (entry) => entry.id === nodeId
  )
  let nextAnalysisViewports = system.analysisViewports
  if (analysisIndex !== -1) {
    nextAnalysisViewports = [...system.analysisViewports]
    nextAnalysisViewports[analysisIndex] = {
      ...nextAnalysisViewports[analysisIndex],
      name: newName
    }
  }

  return {
    ...system,
    index: nextIndex,
    nodes: nextNodes,
    objects: nextObjects,
    branches: nextBranches,
    scenes: nextScenes,
    bifurcationDiagrams: nextBifurcationDiagrams,
    analysisViewports: nextAnalysisViewports,
    updatedAt
  }
}

export function toggleNodeVisibility(system: System, nodeId: string): System {
  const node = system.nodes[nodeId]
  if (!node) return system
  return {
    ...system,
    nodes: {
      ...system.nodes,
      [nodeId]: {
        ...node,
        visibility: !node.visibility
      }
    },
    updatedAt: nowIso()
  }
}

export function toggleNodeExpanded(system: System, nodeId: string): System {
  const node = system.nodes[nodeId]
  if (!node) return system
  return {
    ...system,
    nodes: {
      ...system.nodes,
      [nodeId]: {
        ...node,
        expanded: !node.expanded
      }
    },
    updatedAt: nowIso()
  }
}

export function moveNode(
  system: System,
  nodeId: string,
  direction: 'up' | 'down'
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system

  const siblings = node.parentId
    ? next.nodes[node.parentId]?.children
    : next.rootIds
  if (!siblings) return system
  const index = siblings.indexOf(nodeId)
  if (index === -1) return system

  const delta = direction === 'up' ? -1 : 1
  const target = index + delta
  if (target < 0 || target >= siblings.length) return system

  siblings.splice(index, 1)
  siblings.splice(target, 0, nodeId)
  next.updatedAt = nowIso()
  return next
}

export type ReorderPlacement = 'before' | 'after'

export function reorderNode(
  system: System,
  nodeId: string,
  targetId: string,
  placement: ReorderPlacement = 'before'
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  const target = next.nodes[targetId]
  if (!node || !target) return system
  if (nodeId === targetId) return system
  const targetParentId = target.parentId ?? null
  const sameParent = node.parentId === targetParentId
  if (!sameParent && !canMoveNodeIntoParent(next.nodes, nodeId, targetParentId)) {
    return system
  }

  const oldSiblings = node.parentId
    ? next.nodes[node.parentId]?.children
    : next.rootIds
  const newSiblings = targetParentId
    ? next.nodes[targetParentId]?.children
    : next.rootIds
  if (!oldSiblings || !newSiblings) return system
  const fromIndex = oldSiblings.indexOf(nodeId)
  const targetIndex = newSiblings.indexOf(targetId)
  if (fromIndex === -1 || targetIndex === -1 || (sameParent && fromIndex === targetIndex))
    return system

  oldSiblings.splice(fromIndex, 1)
  node.parentId = targetParentId
  if (targetParentId) {
    next.nodes[targetParentId].expanded = true
  }
  const targetIndexAfterRemoval = newSiblings.indexOf(targetId)
  if (targetIndexAfterRemoval === -1) return system
  const insertionIndex = placement === 'after'
    ? targetIndexAfterRemoval + 1
    : targetIndexAfterRemoval
  if (sameParent && fromIndex === insertionIndex) return system

  newSiblings.splice(insertionIndex, 0, nodeId)
  next.updatedAt = nowIso()
  return next
}

function getAncestorIds(nodes: Record<string, TreeNode>, nodeId: string): string[] {
  const ancestors: string[] = []
  let cursor = nodes[nodeId]
  const visited = new Set<string>([nodeId])
  while (cursor?.parentId) {
    if (visited.has(cursor.parentId)) break
    ancestors.push(cursor.parentId)
    visited.add(cursor.parentId)
    cursor = nodes[cursor.parentId]
  }
  return ancestors
}

function getOwningObjectId(nodes: Record<string, TreeNode>, nodeId: string): string | null {
  const node = nodes[nodeId]
  if (!node) return null
  if (node.kind === 'object') return node.id
  for (const ancestorId of getAncestorIds(nodes, nodeId)) {
    if (nodes[ancestorId]?.kind === 'object') return ancestorId
  }
  return null
}

export function canMoveNodeIntoParent(
  nodes: Record<string, TreeNode>,
  nodeId: string,
  parentId: string | null
): boolean {
  const node = nodes[nodeId]
  const parent = parentId ? nodes[parentId] : null
  if (!node || (parentId && !parent)) return false
  if (node.kind !== 'object' && node.kind !== 'branch' && node.kind !== 'folder') {
    return false
  }
  if (parentId === nodeId) return false
  if (parentId && getAncestorIds(nodes, parentId).includes(nodeId)) return false

  if (!parentId) {
    return (
      node.kind === 'object' ||
      (node.kind === 'folder' && !getOwningObjectId(nodes, node.id))
    )
  }

  if (parent?.kind === 'folder') {
    const folderOwner = getOwningObjectId(nodes, parent.id)
    if (!folderOwner) {
      return node.kind === 'object' || (node.kind === 'folder' && !getOwningObjectId(nodes, node.id))
    }
    if (node.kind === 'object') return false
    return getOwningObjectId(nodes, node.id) === folderOwner
  }

  if (parent?.kind === 'object') {
    const sourceOwner = getOwningObjectId(nodes, node.id)
    if (node.kind === 'branch') return sourceOwner === parent.id
    if (node.kind === 'folder') return sourceOwner === parent.id
    return false
  }

  return false
}

export function moveNodeIntoParent(
  system: System,
  nodeId: string,
  parentId: string | null
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  if (!canMoveNodeIntoParent(next.nodes, nodeId, parentId)) return system
  if (node.parentId === parentId) return system

  const oldSiblings = node.parentId
    ? next.nodes[node.parentId]?.children
    : next.rootIds
  if (!oldSiblings) return system
  const oldIndex = oldSiblings.indexOf(nodeId)
  if (oldIndex === -1) return system
  oldSiblings.splice(oldIndex, 1)

  node.parentId = parentId
  const newSiblings = parentId ? next.nodes[parentId]?.children : next.rootIds
  if (!newSiblings) return system
  newSiblings.push(nodeId)
  if (parentId) {
    next.nodes[parentId].expanded = true
  }
  next.updatedAt = nowIso()
  return next
}

function duplicateName(baseName: string, existingNames: Set<string>): string {
  let candidate = `${baseName}_copy`
  let suffix = 2
  while (existingNames.has(candidate)) {
    candidate = `${baseName}_copy_${suffix}`
    suffix += 1
  }
  existingNames.add(candidate)
  return candidate
}

function reserveUniqueName(name: string, existingNames: Set<string>): string {
  if (!existingNames.has(name)) {
    existingNames.add(name)
    return name
  }
  return duplicateName(name, existingNames)
}

function resolveEntityNameById(
  system: System,
  id: string | undefined,
  fallback: string
): string {
  if (!id) return fallback
  return (
    system.nodes[id]?.name ??
    system.objects[id]?.name ??
    system.branches[id]?.name ??
    fallback
  )
}

function branchParentKey(
  parentObjectId: string | undefined,
  parentObjectName: string
): string {
  if (parentObjectId) return `id:${parentObjectId}`
  return `name:${parentObjectName}`
}

function isAnalysisSourceNode(
  system: Pick<System, 'nodes' | 'branches' | 'index'>,
  nodeId: string
): boolean {
  const node = system.nodes[nodeId]
  if (!node) return false
  if (node.kind === 'object') {
    return node.objectType === 'orbit' || node.objectType === 'limit_cycle'
  }
  if (node.kind !== 'branch') return false
  const branchType =
    system.branches[nodeId]?.branchType ??
    system.index.branches[nodeId]?.branchType ??
    null
  return branchType === 'eq_manifold_1d'
}

function normalizeAnalysisAxis(
  axis: AnalysisAxisSpec | null | undefined
): AnalysisAxisSpec {
  if (!axis || axis.kind === 'hit_index' || axis.kind === 'delta_time') {
    return axis?.kind === 'delta_time'
      ? {
          kind: 'delta_time',
          hitOffset:
            typeof axis.hitOffset === 'number' &&
            Number.isFinite(axis.hitOffset)
              ? Math.trunc(axis.hitOffset)
              : 0,
          label: axis.label ?? null
        }
      : axis?.kind === 'hit_index'
        ? { kind: 'hit_index', label: axis.label ?? null }
        : defaultObservableAxis('x', 0)
  }
  const hitOffset =
    typeof axis.hitOffset === 'number' && Number.isFinite(axis.hitOffset)
      ? Math.trunc(axis.hitOffset)
      : 0
  return {
    kind: 'observable',
    expression: typeof axis.expression === 'string' ? axis.expression : 'x',
    hitOffset,
    label: axis.label ?? null
  }
}

function normalizeAnalysisEventSource(
  system: Pick<System, 'config'>,
  source: AnalysisEventSpec['source'] | null | undefined,
  legacyExpression?: unknown
): AnalysisEventSpec['source'] {
  const firstVar = system.config.varNames[0] ?? 'x'
  if (source?.kind === 'custom') {
    return {
      kind: 'custom',
      expression:
        typeof source.expression === 'string'
          ? source.expression
          : typeof legacyExpression === 'string'
            ? legacyExpression
            : firstVar
    }
  }
  if (
    source?.kind === 'flow_derivative' &&
    system.config.type === 'flow' &&
    system.config.varNames.includes(source.variableName)
  ) {
    return {
      kind: 'flow_derivative',
      variableName: source.variableName
    }
  }
  if (
    source?.kind === 'map_increment' &&
    system.config.type === 'map' &&
    system.config.varNames.includes(source.variableName)
  ) {
    return {
      kind: 'map_increment',
      variableName: source.variableName
    }
  }
  if (typeof legacyExpression === 'string') {
    return {
      kind: 'custom',
      expression: legacyExpression
    }
  }
  return {
    kind: 'custom',
    expression: firstVar
  }
}

function normalizeAnalysisAdvanced(
  advanced: Partial<AnalysisViewportAdvanced> | null | undefined
): AnalysisViewportAdvanced {
  const skipHits =
    typeof advanced?.skipHits === 'number' && Number.isFinite(advanced.skipHits)
      ? Math.max(0, Math.floor(advanced.skipHits))
      : DEFAULT_ANALYSIS_ADVANCED.skipHits
  const hitStride =
    typeof advanced?.hitStride === 'number' &&
    Number.isFinite(advanced.hitStride)
      ? Math.max(1, Math.floor(advanced.hitStride))
      : DEFAULT_ANALYSIS_ADVANCED.hitStride
  const maxHits =
    typeof advanced?.maxHits === 'number' && Number.isFinite(advanced.maxHits)
      ? Math.max(1, Math.floor(advanced.maxHits))
      : DEFAULT_ANALYSIS_ADVANCED.maxHits
  const identityLineStyle =
    advanced?.identityLineStyle === 'solid' ||
    advanced?.identityLineStyle === 'dashed' ||
    advanced?.identityLineStyle === 'dotted'
      ? advanced.identityLineStyle
      : DEFAULT_ANALYSIS_ADVANCED.identityLineStyle
  return {
    skipHits,
    hitStride,
    maxHits,
    connectPoints: Boolean(advanced?.connectPoints),
    showIdentityLine:
      typeof advanced?.showIdentityLine === 'boolean'
        ? advanced.showIdentityLine
        : DEFAULT_ANALYSIS_ADVANCED.showIdentityLine,
    identityLineColor: normalizeHexColor(
      advanced?.identityLineColor,
      DEFAULT_ANALYSIS_ADVANCED.identityLineColor
    ),
    identityLineStyle
  }
}

function normalizeAnalysisViewport(
  system: Pick<System, 'config' | 'nodes' | 'branches' | 'index'>,
  viewport: AnalysisViewport
): AnalysisViewport {
  const fallback = defaultReturnMapViewport(
    system.config,
    viewport.id,
    viewport.name
  )
  const legacyEvent = viewport.event as
    | (AnalysisEventSpec & { expression?: unknown })
    | undefined
  const sourceNodeIds = Array.isArray(viewport.sourceNodeIds)
    ? viewport.sourceNodeIds.filter((nodeId) =>
        isAnalysisSourceNode(system, nodeId)
      )
    : []
  const event = {
    mode:
      viewport.event?.mode === 'every_iterate' ||
      viewport.event?.mode === 'cross_up' ||
      viewport.event?.mode === 'cross_down' ||
      viewport.event?.mode === 'cross_either'
        ? viewport.event.mode
        : fallback.event.mode,
    source: normalizeAnalysisEventSource(
      system,
      viewport.event?.source,
      legacyEvent?.expression
    ),
    level:
      typeof viewport.event?.level === 'number' &&
      Number.isFinite(viewport.event.level)
        ? viewport.event.level
        : fallback.event.level,
    positivityConstraints: Array.isArray(viewport.event?.positivityConstraints)
      ? viewport.event.positivityConstraints.map((constraint) =>
          typeof constraint === 'string' ? constraint : ''
        )
      : fallback.event.positivityConstraints
  }
  return {
    ...fallback,
    ...viewport,
    sourceNodeIds,
    display: viewport.display === 'selection' ? 'selection' : 'all',
    axisRanges: viewport.axisRanges ?? {},
    viewRevision: viewport.viewRevision ?? 0,
    event,
    axes: {
      x: normalizeAnalysisAxis(viewport.axes?.x),
      y: normalizeAnalysisAxis(viewport.axes?.y),
      z: viewport.axes?.z ? normalizeAnalysisAxis(viewport.axes.z) : null
    },
    advanced: normalizeAnalysisAdvanced(viewport.advanced)
  }
}

function duplicateNodeId(kind: TreeNode['kind']): string {
  if (kind === 'scene') return makeId('scene')
  if (kind === 'diagram') return makeId('diagram')
  if (kind === 'analysis') return makeId('analysis')
  return makeId('node')
}

export function duplicateNode(
  system: System,
  nodeId: string
): { system: System; nodeId: string } | null {
  const sourceRoot = system.nodes[nodeId]
  if (!sourceRoot || sourceRoot.kind === 'camera') return null

  const next = structuredClone(system)
  const updatedAt = nowIso()
  const idMap = new Map<string, string>()
  const duplicatedBranchOldIds: string[] = []
  const sourceScenesById = new Map(
    system.scenes.map((scene) => [scene.id, scene])
  )
  const sourceDiagramsById = new Map(
    system.bifurcationDiagrams.map((diagram) => [diagram.id, diagram])
  )
  const sourceAnalysisById = new Map(
    system.analysisViewports.map((viewport) => [viewport.id, viewport])
  )
  const objectNames = new Set(
    Object.values(next.objects).map((obj) => obj.name)
  )
  const sceneNames = new Set(next.scenes.map((scene) => scene.name))
  const diagramNames = new Set(
    next.bifurcationDiagrams.map((diagram) => diagram.name)
  )
  const analysisNames = new Set(
    next.analysisViewports.map((viewport) => viewport.name)
  )

  const rootName =
    sourceRoot.kind === 'object'
      ? duplicateName(sourceRoot.name, objectNames)
      : sourceRoot.kind === 'scene'
        ? duplicateName(sourceRoot.name, sceneNames)
        : sourceRoot.kind === 'diagram'
          ? duplicateName(sourceRoot.name, diagramNames)
          : sourceRoot.kind === 'analysis'
            ? duplicateName(sourceRoot.name, analysisNames)
            : sourceRoot.name

  const cloneSubtree = (
    sourceId: string,
    parentId: string | null,
    isRoot: boolean
  ): string | null => {
    const sourceNode = system.nodes[sourceId]
    if (!sourceNode) return null

    let nextName = sourceNode.name
    if (isRoot) {
      nextName = rootName
    } else if (sourceNode.kind === 'object') {
      nextName = reserveUniqueName(sourceNode.name, objectNames)
    } else if (sourceNode.kind === 'scene') {
      nextName = reserveUniqueName(sourceNode.name, sceneNames)
    } else if (sourceNode.kind === 'diagram') {
      nextName = reserveUniqueName(sourceNode.name, diagramNames)
    } else if (sourceNode.kind === 'analysis') {
      nextName = reserveUniqueName(sourceNode.name, analysisNames)
    }

    const newId = duplicateNodeId(sourceNode.kind)
    idMap.set(sourceId, newId)

    const clonedNode: TreeNode = {
      ...sourceNode,
      id: newId,
      name: nextName,
      parentId,
      children: []
    }
    next.nodes[newId] = clonedNode

    if (sourceNode.kind === 'object') {
      const object = system.objects[sourceId]
      if (!object) return null
      next.objects[newId] = { ...object, id: newId, name: nextName }
      next.index.objects[newId] = {
        id: newId,
        name: nextName,
        objectType: object.type,
        shard: shardForEntityId(newId),
        updatedAt
      }
    } else if (sourceNode.kind === 'branch') {
      const branch = system.branches[sourceId]
      if (!branch) return null
      duplicatedBranchOldIds.push(sourceId)
      next.branches[newId] = { ...branch, id: newId, name: nextName }
      next.index.branches[newId] = {
        id: newId,
        name: nextName,
        branchType: branch.branchType,
        parentObjectId: branch.parentObjectId ?? null,
        startObjectId: branch.startObjectId ?? null,
        shard: shardForEntityId(newId),
        updatedAt
      }
    } else if (sourceNode.kind === 'scene') {
      const scene = sourceScenesById.get(sourceId)
      if (!scene) return null
      next.scenes.push({
        ...structuredClone(scene),
        id: newId,
        name: nextName
      })
    } else if (sourceNode.kind === 'diagram') {
      const diagram = sourceDiagramsById.get(sourceId)
      if (!diagram) return null
      next.bifurcationDiagrams.push({
        ...structuredClone(diagram),
        id: newId,
        name: nextName
      })
    } else if (sourceNode.kind === 'analysis') {
      const viewport = sourceAnalysisById.get(sourceId)
      if (!viewport) return null
      next.analysisViewports.push({
        ...structuredClone(viewport),
        id: newId,
        name: nextName
      })
    }

    sourceNode.children.forEach((childId) => {
      const childDuplicateId = cloneSubtree(childId, newId, false)
      if (childDuplicateId) {
        clonedNode.children.push(childDuplicateId)
      }
    })

    return newId
  }

  const rootParentId =
    sourceRoot.parentId && next.nodes[sourceRoot.parentId]
      ? sourceRoot.parentId
      : null
  const duplicatedRootId = cloneSubtree(nodeId, rootParentId, true)
  if (!duplicatedRootId) return null

  const siblings = rootParentId
    ? next.nodes[rootParentId]?.children
    : next.rootIds
  if (!siblings) return null
  const sourceIndex = siblings.indexOf(nodeId)
  if (sourceIndex === -1) {
    siblings.push(duplicatedRootId)
  } else {
    siblings.splice(sourceIndex + 1, 0, duplicatedRootId)
  }

  const duplicatedBranchNewIds = new Set<string>()
  duplicatedBranchOldIds.forEach((oldBranchId) => {
    const newBranchId = idMap.get(oldBranchId)
    if (!newBranchId) return
    duplicatedBranchNewIds.add(newBranchId)
    const branch = next.branches[newBranchId]
    const branchNode = next.nodes[newBranchId]
    if (!branch || !branchNode) return
    const parentNode = branchNode.parentId
      ? next.nodes[branchNode.parentId]
      : null
    const remappedParentObjectId =
      (branch.parentObjectId
        ? (idMap.get(branch.parentObjectId) ?? branch.parentObjectId)
        : undefined) ??
      (parentNode?.kind === 'object' ? parentNode.id : undefined)
    const remappedStartObjectId = branch.startObjectId
      ? (idMap.get(branch.startObjectId) ?? branch.startObjectId)
      : remappedParentObjectId
    branch.parentObjectId = remappedParentObjectId
    branch.startObjectId = remappedStartObjectId
  })

  const branchNamesByParent = new Map<string, Set<string>>()
  Object.entries(next.branches).forEach(([id, branch]) => {
    if (duplicatedBranchNewIds.has(id)) return
    const key = branchParentKey(branch.parentObjectId, branch.parentObject)
    const names = branchNamesByParent.get(key) ?? new Set<string>()
    names.add(branch.name)
    branchNamesByParent.set(key, names)
  })

  duplicatedBranchOldIds.forEach((oldBranchId) => {
    const newBranchId = idMap.get(oldBranchId)
    if (!newBranchId) return
    const branch = next.branches[newBranchId]
    const node = next.nodes[newBranchId]
    if (!branch || !node) return
    const key = branchParentKey(branch.parentObjectId, branch.parentObject)
    const names = branchNamesByParent.get(key) ?? new Set<string>()
    const isRootBranchDuplicate =
      sourceRoot.kind === 'branch' && oldBranchId === nodeId
    const nextName = isRootBranchDuplicate
      ? duplicateName(branch.name, names)
      : reserveUniqueName(branch.name, names)
    branchNamesByParent.set(key, names)
    branch.name = nextName
    node.name = nextName
  })

  duplicatedBranchOldIds.forEach((oldBranchId) => {
    const newBranchId = idMap.get(oldBranchId)
    if (!newBranchId) return
    const branch = next.branches[newBranchId]
    if (!branch) return
    branch.parentObject = resolveEntityNameById(
      next,
      branch.parentObjectId,
      branch.parentObject
    )
    branch.startObject = resolveEntityNameById(
      next,
      branch.startObjectId,
      branch.startObject
    )
    next.index.branches[newBranchId] = {
      id: newBranchId,
      name: branch.name,
      branchType: branch.branchType,
      parentObjectId: branch.parentObjectId ?? null,
      startObjectId: branch.startObjectId ?? null,
      shard: shardForEntityId(newBranchId),
      updatedAt
    }
  })

  for (const [sourceId, duplicateId] of idMap.entries()) {
    const height = next.ui.viewportHeights[sourceId]
    if (Number.isFinite(height) && height > 0) {
      next.ui.viewportHeights[duplicateId] = height
    }
  }

  const sourceTargets = system.ui.limitCycleRenderTargets ?? {}
  const nextTargets = { ...(next.ui.limitCycleRenderTargets ?? {}) }
  let targetsChanged = false
  for (const [sourceId, duplicateId] of idMap.entries()) {
    if (system.nodes[sourceId]?.kind !== 'object') continue
    const target = sourceTargets[sourceId]
    if (!target) continue
    if (target.type === 'object') {
      nextTargets[duplicateId] = { type: 'object' }
      targetsChanged = true
      continue
    }
    nextTargets[duplicateId] = {
      type: 'branch',
      branchId: idMap.get(target.branchId) ?? target.branchId,
      pointIndex: target.pointIndex
    }
    targetsChanged = true
  }
  if (targetsChanged) {
    next.ui.limitCycleRenderTargets = nextTargets
  }

  next.updatedAt = updatedAt
  return { system: next, nodeId: duplicatedRootId }
}

export function removeNode(system: System, nodeId: string): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system

  const toRemove: string[] = []
  const stack = [nodeId]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (!currentId) continue
    const current = next.nodes[currentId]
    if (!current) continue
    toRemove.push(currentId)
    if (current.children.length > 0) {
      stack.push(...current.children)
    }
  }

  const removalSet = new Set(toRemove)
  const parentId = node.parentId
  if (parentId) {
    const parent = next.nodes[parentId]
    if (parent) {
      parent.children = parent.children.filter((id) => !removalSet.has(id))
    }
  } else {
    next.rootIds = next.rootIds.filter((id) => !removalSet.has(id))
  }

  for (const id of toRemove) {
    delete next.nodes[id]
    delete next.objects[id]
    delete next.branches[id]
    delete next.index.objects[id]
    delete next.index.branches[id]
  }

  next.scenes = next.scenes.filter((scene) => !removalSet.has(scene.id))
  next.bifurcationDiagrams = next.bifurcationDiagrams.filter(
    (diagram) => !removalSet.has(diagram.id)
  )
  next.analysisViewports = next.analysisViewports
    .filter((viewport) => !removalSet.has(viewport.id))
    .map((viewport) => ({
      ...viewport,
      sourceNodeIds: viewport.sourceNodeIds.filter((id) => !removalSet.has(id))
    }))

  next.scenes = next.scenes.map((scene) => ({
    ...scene,
    selectedNodeIds: scene.selectedNodeIds.filter((id) => !removalSet.has(id))
  }))

  next.bifurcationDiagrams = next.bifurcationDiagrams.map((diagram) => ({
    ...diagram,
    selectedBranchIds: diagram.selectedBranchIds.filter(
      (id) => !removalSet.has(id)
    )
  }))

  if (next.ui.selectedNodeId && removalSet.has(next.ui.selectedNodeId)) {
    next.ui.selectedNodeId = null
  }
  Object.keys(next.ui.viewportHeights).forEach((id) => {
    if (removalSet.has(id)) {
      delete next.ui.viewportHeights[id]
    }
  })
  if (next.ui.limitCycleRenderTargets) {
    next.ui.limitCycleRenderTargets = Object.fromEntries(
      Object.entries(next.ui.limitCycleRenderTargets).filter(
        ([objectId, target]) => {
          if (removalSet.has(objectId)) return false
          if (!target || typeof target !== 'object') return false
          const record = target as Record<string, unknown>
          if (record.type === 'object') {
            return true
          }
          const branchId =
            typeof record.branchId === 'string' ? record.branchId : null
          if (!branchId) return false
          return !removalSet.has(branchId)
        }
      )
    )
  }

  next.updatedAt = nowIso()
  return next
}

export function selectNode(system: System, nodeId: string | null): System {
  return {
    ...system,
    ui: {
      ...system.ui,
      selectedNodeId: nodeId
    },
    updatedAt: nowIso()
  }
}

export function updateLayout(
  system: System,
  layout: Partial<SystemLayout>
): System {
  return {
    ...system,
    ui: {
      ...system.ui,
      layout: {
        ...system.ui.layout,
        ...layout
      }
    },
    updatedAt: nowIso()
  }
}

export function updateViewportHeights(
  system: System,
  updates: Record<string, number>
): System {
  return {
    ...system,
    ui: {
      ...system.ui,
      viewportHeights: {
        ...system.ui.viewportHeights,
        ...updates
      }
    },
    updatedAt: nowIso()
  }
}

export function updateLimitCycleRenderTarget(
  system: System,
  objectId: string,
  target: LimitCycleRenderTarget | null
): System {
  const nextTargets = { ...(system.ui.limitCycleRenderTargets ?? {}) }
  if (target) {
    nextTargets[objectId] = target
  } else {
    delete nextTargets[objectId]
  }
  return {
    ...system,
    ui: {
      ...system.ui,
      limitCycleRenderTargets: nextTargets
    },
    updatedAt: nowIso()
  }
}

export function updateNodeRender(
  system: System,
  nodeId: string,
  render: Partial<TreeNode['render']>
): System {
  const node = system.nodes[nodeId]
  if (!node) return system
  return {
    ...system,
    nodes: {
      ...system.nodes,
      [nodeId]: {
        ...node,
        render: { ...DEFAULT_RENDER, ...(node.render ?? {}), ...render }
      }
    },
    updatedAt: nowIso()
  }
}

export function updateScene(
  system: System,
  sceneId: string,
  update: Partial<Omit<Scene, 'id' | 'name'>>
): System {
  const index = system.scenes.findIndex((entry) => entry.id === sceneId)
  if (index === -1) return system
  const nextScenes = [...system.scenes]
  nextScenes[index] = { ...nextScenes[index], ...update }
  return {
    ...system,
    scenes: nextScenes,
    updatedAt: nowIso()
  }
}

export function updateBifurcationDiagram(
  system: System,
  diagramId: string,
  update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
): System {
  const index = system.bifurcationDiagrams.findIndex(
    (entry) => entry.id === diagramId
  )
  if (index === -1) return system
  const nextDiagrams = [...system.bifurcationDiagrams]
  nextDiagrams[index] = { ...nextDiagrams[index], ...update }
  return {
    ...system,
    bifurcationDiagrams: nextDiagrams,
    updatedAt: nowIso()
  }
}

export function updateAnalysisViewport(
  system: System,
  viewportId: string,
  update: Partial<Omit<AnalysisViewport, 'id' | 'name' | 'kind'>>
): System {
  const index = system.analysisViewports.findIndex(
    (entry) => entry.id === viewportId
  )
  if (index === -1) return system
  const nextViewports = [...system.analysisViewports]
  nextViewports[index] = normalizeAnalysisViewport(system, {
    ...nextViewports[index],
    ...update
  })
  return {
    ...system,
    analysisViewports: nextViewports,
    updatedAt: nowIso()
  }
}

export function updateSystem(system: System, config: SystemConfig): System {
  const next = structuredClone(system)
  const previousName = next.config.name
  next.name = config.name
  next.config = {
    name: config.name,
    equations: [...config.equations],
    params: [...config.params],
    paramNames: [...config.paramNames],
    varNames: [...config.varNames],
    solver: config.solver,
    type: config.type
  }

  if (previousName !== config.name) {
    Object.values(next.objects).forEach((obj) => {
      obj.systemName = config.name
    })
    Object.values(next.branches).forEach((branch) => {
      branch.systemName = config.name
    })
  }

  next.updatedAt = nowIso()
  return next
}

export function mergeLoadedEntities(
  system: System,
  payload: {
    objects?: Record<string, AnalysisObject>
    branches?: Record<string, ContinuationObject>
  }
): System {
  const next = structuredClone(system)
  const updatedAt = nowIso()
  if (payload.objects) {
    Object.entries(payload.objects).forEach(([id, object]) => {
      const normalizedObject = { ...object, id } as AnalysisObject
      next.objects[id] = normalizedObject
      next.index.objects[id] = {
        id,
        name: normalizedObject.name,
        objectType: normalizedObject.type,
        shard: shardForEntityId(id),
        updatedAt
      }
    })
  }
  if (payload.branches) {
    Object.entries(payload.branches).forEach(([id, branch]) => {
      const normalizedBranch: ContinuationObject = {
        ...branch,
        id
      }
      next.branches[id] = normalizedBranch
      next.index.branches[id] = {
        id,
        name: normalizedBranch.name,
        branchType: normalizedBranch.branchType,
        parentObjectId: normalizedBranch.parentObjectId ?? null,
        startObjectId: normalizedBranch.startObjectId ?? null,
        shard: shardForEntityId(id),
        updatedAt
      }
    })
  }
  next.updatedAt = updatedAt
  return normalizeSystem(next)
}

function mergeIndexEntries(
  nodes: Record<string, TreeNode>,
  loaded: SystemIndex,
  existing: SystemIndex | null
): SystemIndex {
  const merged: SystemIndex = {
    objects: {
      ...(existing?.objects ?? {})
    },
    branches: {
      ...(existing?.branches ?? {})
    }
  }
  Object.entries(loaded.objects).forEach(([id, entry]) => {
    merged.objects[id] = entry
  })
  Object.entries(loaded.branches).forEach(([id, entry]) => {
    merged.branches[id] = entry
  })
  Object.keys(merged.objects).forEach((id) => {
    const node = nodes[id]
    if (!node || node.kind !== 'object') {
      delete merged.objects[id]
    }
  })
  Object.keys(merged.branches).forEach((id) => {
    const node = nodes[id]
    if (!node || node.kind !== 'branch') {
      delete merged.branches[id]
    }
  })
  return merged
}

export function normalizeSystem(system: System): System {
  const next = structuredClone(system) as System & {
    index?: SystemIndex
    scenes?: Scene[]
    bifurcationDiagrams?: BifurcationDiagram[]
    analysisViewports?: AnalysisViewport[]
    ui?: SystemUiState & { layout?: Partial<SystemLayout> }
  }
  const existingIndex = structuredClone(next.index ?? emptySystemIndex())

  if (!next.scenes) {
    next.scenes = [structuredClone(DEFAULT_SCENE)]
  }
  next.scenes = next.scenes.map((scene) => {
    const axisVariables = resolveSceneAxisSelection(
      next.config.varNames,
      scene.axisVariables
    )
    return {
      ...scene,
      selectedNodeIds: scene.selectedNodeIds ?? [],
      display: scene.display ?? 'all',
      axisRanges: scene.axisRanges ?? {},
      viewRevision: scene.viewRevision ?? 0,
      axisVariables: axisVariables ?? null
    }
  })

  if (!next.bifurcationDiagrams) {
    next.bifurcationDiagrams = []
  } else {
    next.bifurcationDiagrams = next.bifurcationDiagrams.map((diagram) => {
      const legacy = diagram as BifurcationDiagram & {
        branchId?: string | null
        selectedBranchIds?: string[]
        xParam?: string | null
        yParam?: string | null
        xAxis?: BifurcationAxis | null
        yAxis?: BifurcationAxis | null
      }
      const xAxis =
        legacy.xAxis ??
        (legacy.xParam ? { kind: 'parameter', name: legacy.xParam } : null)
      const yAxis =
        legacy.yAxis ??
        (legacy.yParam ? { kind: 'parameter', name: legacy.yParam } : null)
      const selectedBranchIds = Array.isArray(legacy.selectedBranchIds)
        ? legacy.selectedBranchIds
        : legacy.branchId
          ? [legacy.branchId]
          : []
      const rest = { ...legacy }
      delete rest.branchId
      delete rest.xParam
      delete rest.yParam
      return {
        ...rest,
        xAxis,
        yAxis,
        selectedBranchIds,
        axisRanges: rest.axisRanges ?? {},
        viewRevision: rest.viewRevision ?? 0
      }
    })
  }

  if (!next.analysisViewports) {
    next.analysisViewports = []
  } else {
    next.analysisViewports = next.analysisViewports.map((viewport) =>
      normalizeAnalysisViewport(next as System, viewport)
    )
  }

  const ensureRootNode = (
    id: string,
    name: string,
    kind: TreeNode['kind'],
    objectType: TreeNode['objectType']
  ) => {
    if (!next.nodes[id]) {
      const node = createTreeNode({
        id,
        name,
        kind,
        objectType,
        parentId: null
      })
      next.nodes[id] = node
    } else {
      next.nodes[id].name = name
      next.nodes[id].kind = kind
      next.nodes[id].objectType = objectType
      if (next.nodes[id].parentId !== null) {
        next.nodes[id].parentId = null
      }
    }
    if (!next.rootIds.includes(id)) {
      next.rootIds.push(id)
    }
  }

  next.scenes.forEach((scene) => {
    ensureRootNode(scene.id, scene.name, 'scene', 'scene')
  })

  next.bifurcationDiagrams.forEach((diagram) => {
    ensureRootNode(diagram.id, diagram.name, 'diagram', 'bifurcation')
  })
  next.analysisViewports.forEach((viewport) => {
    ensureRootNode(viewport.id, viewport.name, 'analysis', 'analysis')
  })

  const objectNameToNodeId = new Map<string, string>()
  Object.entries(next.objects).forEach(([id, obj]) => {
    const normalizedObject = { ...obj, id } as AnalysisObject
    next.objects[id] = normalizedObject
    if (!next.nodes[id]) {
      next.nodes[id] = createTreeNode({
        id,
        name: normalizedObject.name,
        kind: 'object',
        objectType: normalizedObject.type,
        parentId: null
      })
    }
    const node = next.nodes[id]
    node.name = normalizedObject.name
    node.kind = 'object'
    node.objectType = normalizedObject.type
    node.parentId = node.parentId ?? null
    if (!node.parentId && !next.rootIds.includes(id)) {
      next.rootIds.push(id)
    }
    objectNameToNodeId.set(normalizedObject.name, id)
  })

  Object.entries(next.branches).forEach(([id, branch]) => {
    const parentId =
      branch.parentObjectId ??
      objectNameToNodeId.get(branch.parentObject) ??
      next.nodes[id]?.parentId ??
      null
    const startObjectId =
      branch.startObjectId ??
      objectNameToNodeId.get(branch.startObject) ??
      branch.parentObjectId ??
      null
    const normalizedBranch: ContinuationObject = {
      ...branch,
      id,
      parentObjectId: parentId ?? undefined,
      startObjectId: startObjectId ?? undefined
    }
    next.branches[id] = normalizedBranch
    if (!next.nodes[id]) {
      next.nodes[id] = createTreeNode({
        id,
        name: normalizedBranch.name,
        kind: 'branch',
        objectType: 'continuation',
        parentId
      })
    }
    const node = next.nodes[id]
    node.name = normalizedBranch.name
    node.kind = 'branch'
    node.objectType = 'continuation'
    node.parentId = node.parentId ?? parentId

    if (node.parentId) {
      const parent = next.nodes[node.parentId]
      if (parent && !parent.children.includes(id)) {
        parent.children.push(id)
      }
    } else if (!next.rootIds.includes(id)) {
      next.rootIds.push(id)
    }
  })

  Object.values(next.nodes).forEach((node) => {
    node.children = node.children ?? []
    node.visibility = node.visibility ?? true
    node.expanded = node.expanded ?? true
    node.render = { ...DEFAULT_RENDER, ...(node.render ?? {}) }
  })

  Object.values(next.nodes).forEach((node) => {
    node.children = node.children.filter(
      (childId, index, children) =>
        Boolean(next.nodes[childId]) &&
        next.nodes[childId].parentId === node.id &&
        children.indexOf(childId) === index
    )
  })
  Object.values(next.nodes).forEach((node) => {
    if (!node.parentId || !next.nodes[node.parentId]) return
    const parent = next.nodes[node.parentId]
    if (!parent.children.includes(node.id)) {
      parent.children.push(node.id)
    }
  })
  next.rootIds = next.rootIds.filter(
    (id, index, rootIds) =>
      Boolean(next.nodes[id]) &&
      next.nodes[id].parentId === null &&
      rootIds.indexOf(id) === index
  )
  Object.values(next.nodes).forEach((node) => {
    if (node.parentId === null && !next.rootIds.includes(node.id)) {
      next.rootIds.push(node.id)
    }
  })

  const nextUi = next.ui ?? structuredClone(DEFAULT_UI)
  nextUi.selectedNodeId = nextUi.selectedNodeId ?? null
  nextUi.layout = { ...DEFAULT_LAYOUT, ...(nextUi.layout ?? {}) }
  const viewportHeights = nextUi.viewportHeights ?? {}
  nextUi.viewportHeights = Object.fromEntries(
    Object.entries(viewportHeights).filter(
      ([id, height]) =>
        Boolean(next.nodes[id]) && Number.isFinite(height) && height > 0
    )
  )
  const limitCycleRenderTargets = nextUi.limitCycleRenderTargets ?? {}
  const normalizedTargets: Record<string, LimitCycleRenderTarget> = {}
  const isLimitCycleObject = (objectId: string): boolean => {
    const payload = next.objects[objectId]
    if (payload) return payload.type === 'limit_cycle'
    const node = next.nodes[objectId]
    if (node?.kind === 'object' && node.objectType === 'limit_cycle')
      return true
    const indexEntry = existingIndex.objects[objectId]
    return indexEntry?.objectType === 'limit_cycle'
  }
  const hasBranchReference = (branchId: string): boolean => {
    if (next.branches[branchId]) return true
    const node = next.nodes[branchId]
    if (node?.kind === 'branch') return true
    return Boolean(existingIndex.branches[branchId])
  }
  Object.entries(limitCycleRenderTargets).forEach(([objectId, target]) => {
    if (!isLimitCycleObject(objectId)) {
      return
    }
    if (!target || typeof target !== 'object') return
    if ((target as LimitCycleRenderTarget).type === 'object') {
      normalizedTargets[objectId] = { type: 'object' }
      return
    }
    const branchId = (target as { branchId?: string }).branchId
    const pointIndex = (target as { pointIndex?: number }).pointIndex
    if (!branchId || !hasBranchReference(branchId)) return
    if (typeof pointIndex !== 'number' || !Number.isFinite(pointIndex)) return
    if (pointIndex < 0) return
    normalizedTargets[objectId] = { type: 'branch', branchId, pointIndex }
  })
  nextUi.limitCycleRenderTargets = normalizedTargets
  next.ui = nextUi
  const loadedIndex = rebuildSystemIndex(next as System)
  next.index = mergeIndexEntries(next.nodes, loadedIndex, existingIndex)

  return next as System
}
