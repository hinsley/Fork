import type {
  AnalysisObject,
  BifurcationAxis,
  BifurcationDiagram,
  ContinuationObject,
  LimitCycleRenderTarget,
  RenderStyle,
  System,
  SystemLayout,
  SystemUiState,
  Scene,
  SystemConfig,
  TreeNode,
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
  type: 'flow',
}

const DEFAULT_LAYOUT: SystemLayout = {
  leftWidth: 280,
  rightWidth: 320,
  objectsOpen: true,
  inspectorOpen: true,
  branchViewerOpen: true,
}

const DEFAULT_UI: SystemUiState = {
  selectedNodeId: null,
  layout: DEFAULT_LAYOUT,
  viewportHeights: {},
  limitCycleRenderTargets: {},
}

const DEFAULT_SCENE: Scene = {
  id: 'scene-main',
  name: 'Main_Scene',
  camera: {
    eye: { x: 1.6, y: 1.4, z: 0.8 },
    center: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  },
  axisRanges: {},
  viewRevision: 0,
  axisVariables: null,
  selectedNodeIds: [],
  display: 'all',
}

export const DEFAULT_RENDER: RenderStyle = {
  color: '#e06c3f',
  lineWidth: 2,
  lineStyle: 'solid',
  pointSize: 4,
}

// IDs and timestamps are routed through deterministic helpers for tests.

export function createSystem(args: { name: string; config?: SystemConfig }): System {
  const config = args.config ? { ...args.config } : { ...DEFAULT_SYSTEM, name: args.name }

  return {
    id: makeId('system'),
    name: args.name,
    config,
    nodes: {},
    rootIds: [],
    objects: {},
    branches: {},
    scenes: [],
    bifurcationDiagrams: [],
    ui: structuredClone(DEFAULT_UI),
    updatedAt: nowIso(),
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
    render: { ...DEFAULT_RENDER },
  }
}

export function addObject(system: System, obj: AnalysisObject): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const node = createTreeNode({
    name: obj.name,
    kind: 'object',
    objectType: obj.type,
    parentId: null,
  })
  next.nodes[node.id] = node
  next.rootIds.push(node.id)
  next.objects[node.id] = obj
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
  const updated = { ...existing, ...update, type: existing.type } as AnalysisObject
  next.objects[nodeId] = updated
  next.updatedAt = nowIso()
  return next
}

export function updateBranch(
  system: System,
  nodeId: string,
  branch: ContinuationObject
): System {
  const next = structuredClone(system)
  if (!next.branches[nodeId]) return system
  next.branches[nodeId] = branch
  next.updatedAt = nowIso()
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
    parentId: parentNodeId,
  })
  next.nodes[node.id] = node
  next.branches[node.id] = branch
  const parent = next.nodes[parentNodeId]
  if (parent) {
    parent.children.push(node.id)
    parent.expanded = true
  }
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

export function addScene(system: System, name: string): { system: System; nodeId: string } {
  const next = structuredClone(system)
  const sceneId = makeId('scene')
  const axisVariables = resolveSceneAxisSelection(next.config.varNames, null)
  const node = createTreeNode({
    id: sceneId,
    name,
    kind: 'scene',
    objectType: 'scene',
    parentId: null,
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
    display: 'all',
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
    parentId: null,
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
    viewRevision: 0,
  })
  next.updatedAt = nowIso()
  return { system: next, nodeId: node.id }
}

export function renameNode(system: System, nodeId: string, newName: string): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  node.name = newName
  const obj = next.objects[nodeId]
  if (obj) obj.name = newName
  const branch = next.branches[nodeId]
  if (branch) branch.name = newName
  const scene = next.scenes.find((entry) => entry.id === nodeId)
  if (scene) scene.name = newName
  const diagram = next.bifurcationDiagrams.find((entry) => entry.id === nodeId)
  if (diagram) diagram.name = newName
  next.updatedAt = nowIso()
  return next
}

export function toggleNodeVisibility(system: System, nodeId: string): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  node.visibility = !node.visibility
  next.updatedAt = nowIso()
  return next
}

export function toggleNodeExpanded(system: System, nodeId: string): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  node.expanded = !node.expanded
  next.updatedAt = nowIso()
  return next
}

export function moveNode(
  system: System,
  nodeId: string,
  direction: 'up' | 'down'
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system

  const siblings = node.parentId ? next.nodes[node.parentId]?.children : next.rootIds
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

export function reorderNode(system: System, nodeId: string, targetId: string): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  const target = next.nodes[targetId]
  if (!node || !target) return system
  if (node.parentId !== target.parentId) return system

  const siblings = node.parentId ? next.nodes[node.parentId]?.children : next.rootIds
  if (!siblings) return system
  const fromIndex = siblings.indexOf(nodeId)
  const targetIndex = siblings.indexOf(targetId)
  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return system

  siblings.splice(fromIndex, 1)
  siblings.splice(targetIndex, 0, nodeId)
  next.updatedAt = nowIso()
  return next
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
  }

  next.scenes = next.scenes.filter((scene) => !removalSet.has(scene.id))
  next.bifurcationDiagrams = next.bifurcationDiagrams.filter(
    (diagram) => !removalSet.has(diagram.id)
  )

  next.scenes = next.scenes.map((scene) => ({
    ...scene,
    selectedNodeIds: scene.selectedNodeIds.filter((id) => !removalSet.has(id)),
  }))

  next.bifurcationDiagrams = next.bifurcationDiagrams.map((diagram) => ({
    ...diagram,
    selectedBranchIds: diagram.selectedBranchIds.filter((id) => !removalSet.has(id)),
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
      Object.entries(next.ui.limitCycleRenderTargets).filter(([objectId, target]) => {
        if (removalSet.has(objectId)) return false
        if (!target || typeof target !== 'object') return false
        const record = target as Record<string, unknown>
        if (record.type === 'object') {
          return true
        }
        const branchId = typeof record.branchId === 'string' ? record.branchId : null
        if (!branchId) return false
        return !removalSet.has(branchId)
      })
    )
  }

  next.updatedAt = nowIso()
  return next
}

export function selectNode(system: System, nodeId: string | null): System {
  const next = structuredClone(system)
  next.ui.selectedNodeId = nodeId
  next.updatedAt = nowIso()
  return next
}

export function updateLayout(system: System, layout: Partial<SystemLayout>): System {
  const next = structuredClone(system)
  next.ui.layout = { ...next.ui.layout, ...layout }
  next.updatedAt = nowIso()
  return next
}

export function updateViewportHeights(
  system: System,
  updates: Record<string, number>
): System {
  const next = structuredClone(system)
  next.ui.viewportHeights = { ...next.ui.viewportHeights, ...updates }
  next.updatedAt = nowIso()
  return next
}

export function updateLimitCycleRenderTarget(
  system: System,
  objectId: string,
  target: LimitCycleRenderTarget | null
): System {
  const next = structuredClone(system)
  if (!next.ui.limitCycleRenderTargets) {
    next.ui.limitCycleRenderTargets = {}
  }
  if (target) {
    next.ui.limitCycleRenderTargets[objectId] = target
  } else {
    delete next.ui.limitCycleRenderTargets[objectId]
  }
  next.updatedAt = nowIso()
  return next
}

export function updateNodeRender(
  system: System,
  nodeId: string,
  render: Partial<TreeNode['render']>
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  node.render = { ...DEFAULT_RENDER, ...(node.render ?? {}), ...render }
  next.updatedAt = nowIso()
  return next
}

export function updateScene(
  system: System,
  sceneId: string,
  update: Partial<Omit<Scene, 'id' | 'name'>>
): System {
  const next = structuredClone(system)
  const scene = next.scenes.find((entry) => entry.id === sceneId)
  if (!scene) return system
  Object.assign(scene, update)
  next.updatedAt = nowIso()
  return next
}

export function updateBifurcationDiagram(
  system: System,
  diagramId: string,
  update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
): System {
  const next = structuredClone(system)
  const diagram = next.bifurcationDiagrams.find((entry) => entry.id === diagramId)
  if (!diagram) return system
  Object.assign(diagram, update)
  next.updatedAt = nowIso()
  return next
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
    type: config.type,
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

export function normalizeSystem(system: System): System {
  const next = structuredClone(system) as System & {
    scenes?: Scene[]
    bifurcationDiagrams?: BifurcationDiagram[]
    ui?: SystemUiState & { layout?: Partial<SystemLayout> }
  }

  if (!next.scenes) {
    next.scenes = [structuredClone(DEFAULT_SCENE)]
  }
  next.scenes = next.scenes.map((scene) => {
    const axisVariables = resolveSceneAxisSelection(next.config.varNames, scene.axisVariables)
    return {
      ...scene,
      selectedNodeIds: scene.selectedNodeIds ?? [],
      display: scene.display ?? 'all',
      axisRanges: scene.axisRanges ?? {},
      viewRevision: scene.viewRevision ?? 0,
      axisVariables: axisVariables ?? null,
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
        legacy.xAxis ?? (legacy.xParam ? { kind: 'parameter', name: legacy.xParam } : null)
      const yAxis =
        legacy.yAxis ?? (legacy.yParam ? { kind: 'parameter', name: legacy.yParam } : null)
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
        viewRevision: rest.viewRevision ?? 0,
      }
    })
  }

  const ensureRootNode = (
    id: string,
    name: string,
    kind: TreeNode['kind'],
    objectType: TreeNode['objectType']
  ) => {
    if (!next.nodes[id]) {
      const node = createTreeNode({ id, name, kind, objectType, parentId: null })
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

  const objectNameToNodeId = new Map<string, string>()
  Object.entries(next.objects).forEach(([id, obj]) => {
    if (!next.nodes[id]) {
      next.nodes[id] = createTreeNode({
        id,
        name: obj.name,
        kind: 'object',
        objectType: obj.type,
        parentId: null,
      })
    }
    const node = next.nodes[id]
    node.name = obj.name
    node.kind = 'object'
    node.objectType = obj.type
    node.parentId = node.parentId ?? null
    if (!next.rootIds.includes(id)) {
      next.rootIds.push(id)
    }
    objectNameToNodeId.set(obj.name, id)
  })

  Object.entries(next.branches).forEach(([id, branch]) => {
    const parentId = objectNameToNodeId.get(branch.parentObject) ?? null
    if (!next.nodes[id]) {
      next.nodes[id] = createTreeNode({
        id,
        name: branch.name,
        kind: 'branch',
        objectType: 'continuation',
        parentId,
      })
    }
    const node = next.nodes[id]
    node.name = branch.name
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

  const nextUi = next.ui ?? structuredClone(DEFAULT_UI)
  nextUi.selectedNodeId = nextUi.selectedNodeId ?? null
  nextUi.layout = { ...DEFAULT_LAYOUT, ...(nextUi.layout ?? {}) }
  const viewportHeights = nextUi.viewportHeights ?? {}
  nextUi.viewportHeights = Object.fromEntries(
    Object.entries(viewportHeights).filter(
      ([id, height]) => Boolean(next.nodes[id]) && Number.isFinite(height) && height > 0
    )
  )
  const limitCycleRenderTargets = nextUi.limitCycleRenderTargets ?? {}
  const normalizedTargets: Record<string, LimitCycleRenderTarget> = {}
  Object.entries(limitCycleRenderTargets).forEach(([objectId, target]) => {
    if (!next.objects[objectId] || next.objects[objectId]?.type !== 'limit_cycle') {
      return
    }
    if (!target || typeof target !== 'object') return
    if ((target as LimitCycleRenderTarget).type === 'object') {
      normalizedTargets[objectId] = { type: 'object' }
      return
    }
    const branchId = (target as { branchId?: string }).branchId
    const pointIndex = (target as { pointIndex?: number }).pointIndex
    if (!branchId || !next.branches[branchId]) return
    if (typeof pointIndex !== 'number' || !Number.isFinite(pointIndex)) return
    if (pointIndex < 0) return
    normalizedTargets[objectId] = { type: 'branch', branchId, pointIndex }
  })
  nextUi.limitCycleRenderTargets = normalizedTargets
  next.ui = nextUi

  return next as System
}
