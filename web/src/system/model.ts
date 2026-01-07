import type {
  AnalysisObject,
  BifurcationDiagram,
  ContinuationObject,
  System,
  SystemLayout,
  SystemUiState,
  Scene,
  SystemConfig,
  TreeNode,
} from './types'

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
}

const DEFAULT_SCENE: Scene = {
  id: 'scene-main',
  name: 'Main Scene',
  camera: {
    eye: { x: 1.6, y: 1.4, z: 0.8 },
    center: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  },
  selectedNodeIds: [],
  display: 'all',
}

const DEFAULT_RENDER = {
  color: '#e06c3f',
  lineWidth: 2,
  pointSize: 4,
}

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso() {
  return new Date().toISOString()
}

export function createSystem(args: { name: string; config?: SystemConfig }): System {
  const config = args.config ? { ...args.config } : { ...DEFAULT_SYSTEM, name: args.name }
  const scene = structuredClone(DEFAULT_SCENE)
  const sceneNode = createTreeNode({
    id: scene.id,
    name: scene.name,
    kind: 'scene',
    objectType: 'scene',
    parentId: null,
  })

  return {
    id: makeId('system'),
    name: args.name,
    config,
    nodes: { [sceneNode.id]: sceneNode },
    rootIds: [sceneNode.id],
    objects: {},
    branches: {},
    scenes: [scene],
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
    branchId: null,
    xParam: null,
    yParam: null,
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

  next.bifurcationDiagrams = next.bifurcationDiagrams.map((diagram) =>
    diagram.branchId && removalSet.has(diagram.branchId)
      ? { ...diagram, branchId: null }
      : diagram
  )

  if (next.ui.selectedNodeId && removalSet.has(next.ui.selectedNodeId)) {
    next.ui.selectedNodeId = null
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

export function updateNodeRender(
  system: System,
  nodeId: string,
  render: Partial<TreeNode['render']>
): System {
  const next = structuredClone(system)
  const node = next.nodes[nodeId]
  if (!node) return system
  node.render = { ...node.render, ...render }
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

  if (!next.scenes || next.scenes.length === 0) {
    next.scenes = [structuredClone(DEFAULT_SCENE)]
  } else {
    next.scenes = next.scenes.map((scene) => ({
      ...scene,
      selectedNodeIds: scene.selectedNodeIds ?? [],
      display: scene.display ?? 'all',
    }))
  }

  if (!next.bifurcationDiagrams) {
    next.bifurcationDiagrams = []
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

  return next as System
}
