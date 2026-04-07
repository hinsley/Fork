import { describe, it, expect } from 'vitest'
import {
  addAnalysisViewport,
  addBranch,
  addObject,
  addBifurcationDiagram,
  addScene,
  createSystem,
  duplicateNode,
  moveNode,
  normalizeSystem,
  removeNode,
  reorderNode,
  renameNode,
  selectNode,
  toggleNodeVisibility,
  updateAnalysisViewport,
  updateBifurcationDiagram,
  updateNodeRender,
  updateScene,
  updateSystem,
} from './model'
import type { ContinuationObject, LimitCycleObject, OrbitObject } from './types'

describe('system model', () => {
  it('adds objects, renames, and toggles visibility', () => {
    const system = createSystem({ name: 'Demo' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: system.config.name,
      data: [
        [0, 0, 1],
        [0.1, 0.1, 0.9],
      ],
      t_start: 0,
      t_end: 0.1,
      dt: 0.1,
    }

    const { system: withObject, nodeId } = addObject(system, orbit)
    expect(withObject.objects[nodeId].name).toBe('Orbit A')

    const renamed = renameNode(withObject, nodeId, 'Orbit B')
    expect(renamed.nodes[nodeId].name).toBe('Orbit B')
    expect(renamed.objects[nodeId].name).toBe('Orbit B')

    const toggled = toggleNodeVisibility(renamed, nodeId)
    expect(toggled.nodes[nodeId].visibility).toBe(false)

    const selected = selectNode(toggled, nodeId)
    expect(selected.ui.selectedNodeId).toBe(nodeId)
  })

  it('reorders siblings', () => {
    const system = createSystem({ name: 'Order' })
    const base: OrbitObject = {
      type: 'orbit',
      name: 'Orbit',
      systemName: system.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const first = addObject(system, { ...base, name: 'First' })
    const second = addObject(first.system, { ...base, name: 'Second' })
    const third = addObject(second.system, { ...base, name: 'Third' })

    const moved = moveNode(third.system, first.nodeId, 'down')
    const objectOrder = moved.rootIds.filter((id) => moved.nodes[id]?.kind === 'object')
    expect(objectOrder[0]).toBe(second.nodeId)
    expect(objectOrder[1]).toBe(first.nodeId)
  })

  it('reorders nodes by target', () => {
    const system = createSystem({ name: 'Order' })
    const base: OrbitObject = {
      type: 'orbit',
      name: 'Orbit',
      systemName: system.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const first = addObject(system, { ...base, name: 'First' })
    const second = addObject(first.system, { ...base, name: 'Second' })
    const third = addObject(second.system, { ...base, name: 'Third' })

    const reordered = reorderNode(third.system, third.nodeId, first.nodeId)
    const objectOrder = reordered.rootIds.filter((id) => reordered.nodes[id]?.kind === 'object')
    expect(objectOrder[0]).toBe(third.nodeId)
    expect(objectOrder[1]).toBe(first.nodeId)
  })

  it('reorders nodes downward to the target position', () => {
    const system = createSystem({ name: 'Order' })
    const base: OrbitObject = {
      type: 'orbit',
      name: 'Orbit',
      systemName: system.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const first = addObject(system, { ...base, name: 'First' })
    const second = addObject(first.system, { ...base, name: 'Second' })
    const third = addObject(second.system, { ...base, name: 'Third' })

    const reordered = reorderNode(third.system, first.nodeId, third.nodeId)
    const objectOrder = reordered.rootIds.filter((id) => reordered.nodes[id]?.kind === 'object')
    expect(objectOrder[0]).toBe(second.nodeId)
    expect(objectOrder[1]).toBe(third.nodeId)
    expect(objectOrder[2]).toBe(first.nodeId)
  })

  it('updates system name across objects', () => {
    const system = createSystem({ name: 'Demo' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit',
      systemName: system.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }

    const { system: withObject, nodeId } = addObject(system, orbit)
    const updated = updateSystem(withObject, { ...withObject.config, name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.config.name).toBe('Renamed')
    expect(updated.objects[nodeId].systemName).toBe('Renamed')
  })

  it('normalizes missing viewRevision fields for viewports', () => {
    const system = createSystem({ name: 'Legacy' })
    const { system: withScene } = addScene(system, 'Scene')
    const { system: withDiagram } = addBifurcationDiagram(withScene, 'Diagram')
    const { system: withAnalysis } = addAnalysisViewport(withDiagram, 'Return_Map')
    const legacy = structuredClone(withAnalysis) as typeof withAnalysis
    delete (legacy.scenes[0] as { viewRevision?: number }).viewRevision
    delete (legacy.bifurcationDiagrams[0] as { viewRevision?: number }).viewRevision
    delete (legacy.analysisViewports[0] as { viewRevision?: number }).viewRevision

    const normalized = normalizeSystem(legacy)

    expect(normalized.scenes[0].viewRevision).toBe(0)
    expect(normalized.bifurcationDiagrams[0].viewRevision).toBe(0)
    expect(normalized.analysisViewports[0].viewRevision).toBe(0)
  })

  it('normalizes missing analysis positivity constraints to an empty list', () => {
    const system = createSystem({ name: 'Legacy_Analysis_Constraints' })
    const { system: withAnalysis } = addAnalysisViewport(system, 'Event_Map')
    const legacy = structuredClone(withAnalysis)
    delete (legacy.analysisViewports[0].event as { positivityConstraints?: string[] })
      .positivityConstraints

    const normalized = normalizeSystem(legacy)

    expect(normalized.analysisViewports[0].event.positivityConstraints).toEqual([])
  })

  it('keeps viewRevision stable across non-view updates', () => {
    let system = createSystem({ name: 'View_Revision' })
    const sceneResult = addScene(system, 'Scene')
    const diagramResult = addBifurcationDiagram(sceneResult.system, 'Diagram')
    system = updateScene(diagramResult.system, sceneResult.nodeId, { viewRevision: 3 })
    system = updateBifurcationDiagram(system, diagramResult.nodeId, { viewRevision: 5 })

    const rendered = updateNodeRender(system, sceneResult.nodeId, { lineWidth: 4 })
    const selected = selectNode(rendered, sceneResult.nodeId)
    const diagramUpdated = updateBifurcationDiagram(selected, diagramResult.nodeId, {
      selectedBranchIds: ['branch-1'],
    })

    expect(
      diagramUpdated.scenes.find((scene) => scene.id === sceneResult.nodeId)?.viewRevision
    ).toBe(3)
    expect(
      diagramUpdated.bifurcationDiagrams.find(
        (diagram) => diagram.id === diagramResult.nodeId
      )?.viewRevision
    ).toBe(5)
  })

  it('initializes scene axes to defaults for 2D and 4D systems', () => {
    const twoD = createSystem({ name: 'TwoD' })
    const twoDScene = addScene(twoD, 'Scene2D')
    expect(twoDScene.system.scenes[0]?.axisVariables).toEqual(['x', 'y'])

    const fourD = createSystem({
      name: 'FourD',
      config: {
        name: 'FourD',
        equations: ['x', 'y', 'z', 'w'],
        params: [],
        paramNames: [],
        varNames: ['x', 'y', 'z', 'w'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const fourDScene = addScene(fourD, 'Scene4D')
    expect(fourDScene.system.scenes[0]?.axisVariables).toEqual(['x', 'y', 'z'])
  })

  it('normalizes legacy axis object payloads into ordered axis arrays', () => {
    const system = createSystem({
      name: 'LegacyAxes',
      config: {
        name: 'LegacyAxes',
        equations: ['x', 'y', 'z', 'w'],
        params: [],
        paramNames: [],
        varNames: ['x', 'y', 'z', 'w'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const withScene = addScene(system, 'Scene')
    const legacy = structuredClone(withScene.system) as typeof withScene.system & {
      scenes: Array<(typeof withScene.system.scenes)[number] & { axisVariables?: unknown }>
    }
    ;(legacy.scenes[0] as { axisVariables?: unknown }).axisVariables = {
      x: 'w',
      y: 'x',
      z: 'y',
    }

    const normalized = normalizeSystem(legacy)

    expect(normalized.scenes[0]?.axisVariables).toEqual(['w', 'x', 'y'])
  })

  it('preserves limit-cycle render targets when normalizing skeleton systems', () => {
    const base = createSystem({
      name: 'LC_Target_Skeleton',
      config: {
        name: 'LC_Target_Skeleton',
        equations: ['y', '-x'],
        params: [0.2],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const cycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC_Seed',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: 'Orbit_Seed' },
      ntst: 4,
      ncol: 2,
      period: 1,
      state: [0, 0, 1],
      createdAt: new Date().toISOString(),
    }
    const withCycle = addObject(base, cycle)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'lc_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: cycle.name,
      startObject: cycle.name,
      branchType: 'limit_cycle',
      data: {
        points: [{ state: [0, 0, 1], param_value: 0.2, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 3,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [0.2],
    }
    const withBranch = addBranch(withCycle.system, branch, withCycle.nodeId)
    const targetSystem = structuredClone(withBranch.system)
    targetSystem.ui.limitCycleRenderTargets = {
      [withCycle.nodeId]: {
        type: 'branch',
        branchId: withBranch.nodeId,
        pointIndex: 0,
      },
    }

    const skeleton = normalizeSystem({
      ...targetSystem,
      objects: {},
      branches: {},
    })

    expect(skeleton.ui.limitCycleRenderTargets?.[withCycle.nodeId]).toEqual({
      type: 'branch',
      branchId: withBranch.nodeId,
      pointIndex: 0,
    })
  })

  it('renames scene nodes without cloning object or branch payload maps', () => {
    const base = createSystem({ name: 'Scene_Rename_Ref' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const withObject = addObject(base, orbit)
    const withScene = addScene(withObject.system, 'Scene A')

    const renamed = renameNode(withScene.system, withScene.nodeId, 'Scene B')

    expect(renamed.nodes[withScene.nodeId].name).toBe('Scene B')
    expect(renamed.scenes.find((scene) => scene.id === withScene.nodeId)?.name).toBe('Scene B')
    expect(renamed.objects).toBe(withScene.system.objects)
    expect(renamed.branches).toBe(withScene.system.branches)
    expect(renamed.rootIds).toBe(withScene.system.rootIds)
  })

  it('renames analysis viewport nodes without cloning object or branch payload maps', () => {
    const base = createSystem({ name: 'Analysis_Rename_Ref' })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const withObject = addObject(base, orbit)
    const withAnalysis = addAnalysisViewport(withObject.system, 'Return Map A')

    const renamed = renameNode(withAnalysis.system, withAnalysis.nodeId, 'Return Map B')

    expect(renamed.nodes[withAnalysis.nodeId].name).toBe('Return Map B')
    expect(
      renamed.analysisViewports.find((viewport) => viewport.id === withAnalysis.nodeId)?.name
    ).toBe('Return Map B')
    expect(renamed.objects).toBe(withAnalysis.system.objects)
    expect(renamed.branches).toBe(withAnalysis.system.branches)
    expect(renamed.rootIds).toBe(withAnalysis.system.rootIds)
  })

  it('renames objects with dependency rewrites using copy-on-write updates', () => {
    const base = createSystem({
      name: 'Object_Rename_Ref',
      config: {
        name: 'Object_Rename_Ref',
        equations: ['y', '-x'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit A',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [0],
    }
    const withOrbit = addObject(base, orbit)
    const branch: ContinuationObject = {
      type: 'continuation',
      name: 'orbit_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'equilibrium',
      data: {
        points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 10,
        corrector_steps: 3,
        corrector_tolerance: 1e-6,
        step_tolerance: 1e-6,
      },
      timestamp: new Date().toISOString(),
      params: [0],
    }
    const withBranch = addBranch(withOrbit.system, branch, withOrbit.nodeId)
    const limitCycle: LimitCycleObject = {
      type: 'limit_cycle',
      name: 'LC A',
      systemName: base.config.name,
      origin: { type: 'orbit', orbitName: orbit.name },
      ntst: 12,
      ncol: 4,
      period: 1,
      state: [0, 0],
      createdAt: new Date().toISOString(),
      parameters: [0],
    }
    const withLimitCycle = addObject(withBranch.system, limitCycle)

    const renamed = renameNode(withLimitCycle.system, withOrbit.nodeId, 'Orbit B')

    expect(renamed.nodes[withOrbit.nodeId].name).toBe('Orbit B')
    expect(renamed.objects[withOrbit.nodeId].name).toBe('Orbit B')
    expect(renamed.branches[withBranch.nodeId].parentObject).toBe('Orbit A')
    expect(renamed.branches[withBranch.nodeId].startObject).toBe('Orbit A')
    const lc = renamed.objects[withLimitCycle.nodeId]
    expect(lc.type).toBe('limit_cycle')
    if (lc.type === 'limit_cycle') {
      expect(lc.origin.type).toBe('orbit')
      if (lc.origin.type === 'orbit') {
        expect(lc.origin.orbitName).toBe('Orbit A')
      }
    }
    expect(renamed.objects).not.toBe(withLimitCycle.system.objects)
    expect(renamed.branches).toBe(withLimitCycle.system.branches)
    const renamedOrbit = renamed.objects[withOrbit.nodeId]
    const originalOrbit = withLimitCycle.system.objects[withOrbit.nodeId]
    expect(renamedOrbit.type).toBe('orbit')
    if (renamedOrbit.type === 'orbit' && originalOrbit.type === 'orbit') {
      expect(renamedOrbit.data).toBe(originalOrbit.data)
    }
  })

  it('duplicates an object together with its continuation branch subtree', () => {
    const base = createSystem({
      name: 'Duplicate_Object_Subtree',
      config: {
        name: 'Duplicate_Object_Subtree',
        equations: ['y', '-x'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_A',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [0],
    }
    const withOrbit = addObject(base, orbit)
    const settings: ContinuationObject['settings'] = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 3,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    }
    const rootBranch: ContinuationObject = {
      type: 'continuation',
      name: 'root_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObjectId: withOrbit.nodeId,
      startObjectId: withOrbit.nodeId,
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'equilibrium',
      data: {
        points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings,
      timestamp: new Date().toISOString(),
      params: [0],
    }
    const withRootBranch = addBranch(withOrbit.system, rootBranch, withOrbit.nodeId)
    const childBranch: ContinuationObject = {
      type: 'continuation',
      name: 'child_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObjectId: withOrbit.nodeId,
      startObjectId: withRootBranch.nodeId,
      parentObject: orbit.name,
      startObject: rootBranch.name,
      branchType: 'equilibrium',
      data: {
        points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings,
      timestamp: new Date().toISOString(),
      params: [0],
    }
    const withChildBranch = addBranch(withRootBranch.system, childBranch, withRootBranch.nodeId)

    const duplicated = duplicateNode(withChildBranch.system, withOrbit.nodeId)
    expect(duplicated).toBeTruthy()
    if (!duplicated) {
      throw new Error('Expected duplicated object subtree.')
    }

    const duplicateObjectId = duplicated.nodeId
    const duplicateObjectNode = duplicated.system.nodes[duplicateObjectId]
    expect(duplicateObjectNode.name).toBe('Orbit_A_copy')
    expect(Object.keys(duplicated.system.objects)).toHaveLength(2)

    const rootIndex = duplicated.system.rootIds.indexOf(withOrbit.nodeId)
    expect(duplicated.system.rootIds[rootIndex + 1]).toBe(duplicateObjectId)

    const duplicateRootBranchId = duplicateObjectNode.children[0]
    const duplicateRootBranchNode = duplicated.system.nodes[duplicateRootBranchId]
    const duplicateRootBranch = duplicated.system.branches[duplicateRootBranchId]
    expect(duplicateRootBranch.parentObjectId).toBe(duplicateObjectId)
    expect(duplicateRootBranch.startObjectId).toBe(duplicateObjectId)
    expect(duplicateRootBranch.parentObject).toBe('Orbit_A_copy')
    expect(duplicateRootBranch.startObject).toBe('Orbit_A_copy')

    const duplicateChildBranchId = duplicateRootBranchNode.children[0]
    const duplicateChildBranch = duplicated.system.branches[duplicateChildBranchId]
    expect(duplicateChildBranch.parentObjectId).toBe(duplicateObjectId)
    expect(duplicateChildBranch.startObjectId).toBe(duplicateRootBranchId)
    expect(duplicateChildBranch.parentObject).toBe('Orbit_A_copy')
    expect(duplicateChildBranch.startObject).toBe(duplicateRootBranch.name)
  })

  it('duplicates continuation branch children as sibling branches without creating objects', () => {
    const base = createSystem({
      name: 'Duplicate_Branch_Subtree',
      config: {
        name: 'Duplicate_Branch_Subtree',
        equations: ['y', '-x'],
        params: [0],
        paramNames: ['mu'],
        varNames: ['x', 'y'],
        solver: 'rk4',
        type: 'flow',
      },
    })
    const orbit: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_B',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
      parameters: [0],
    }
    const withOrbit = addObject(base, orbit)
    const settings: ContinuationObject['settings'] = {
      step_size: 0.01,
      min_step_size: 1e-5,
      max_step_size: 0.1,
      max_steps: 10,
      corrector_steps: 3,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    }
    const rootBranch: ContinuationObject = {
      type: 'continuation',
      name: 'root_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObjectId: withOrbit.nodeId,
      startObjectId: withOrbit.nodeId,
      parentObject: orbit.name,
      startObject: orbit.name,
      branchType: 'equilibrium',
      data: {
        points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings,
      timestamp: new Date().toISOString(),
      params: [0],
    }
    const withRootBranch = addBranch(withOrbit.system, rootBranch, withOrbit.nodeId)
    const childBranch: ContinuationObject = {
      type: 'continuation',
      name: 'child_branch',
      systemName: base.config.name,
      parameterName: 'mu',
      parentObjectId: withOrbit.nodeId,
      startObjectId: withRootBranch.nodeId,
      parentObject: orbit.name,
      startObject: rootBranch.name,
      branchType: 'equilibrium',
      data: {
        points: [{ state: [0, 0], param_value: 0, stability: 'None', eigenvalues: [] }],
        bifurcations: [],
        indices: [0],
      },
      settings,
      timestamp: new Date().toISOString(),
      params: [0],
    }
    const withChildBranch = addBranch(withRootBranch.system, childBranch, withRootBranch.nodeId)

    const duplicated = duplicateNode(withChildBranch.system, withRootBranch.nodeId)
    expect(duplicated).toBeTruthy()
    if (!duplicated) {
      throw new Error('Expected duplicated branch subtree.')
    }

    expect(Object.keys(duplicated.system.objects)).toHaveLength(1)
    const duplicateRootBranchId = duplicated.nodeId
    const objectChildren = duplicated.system.nodes[withOrbit.nodeId].children
    const sourceIndex = objectChildren.indexOf(withRootBranch.nodeId)
    expect(objectChildren[sourceIndex + 1]).toBe(duplicateRootBranchId)

    const duplicateRootBranchNode = duplicated.system.nodes[duplicateRootBranchId]
    const duplicateRootBranch = duplicated.system.branches[duplicateRootBranchId]
    expect(duplicateRootBranch.name).toBe('root_branch_copy')
    expect(duplicateRootBranch.parentObjectId).toBe(withOrbit.nodeId)
    expect(duplicateRootBranch.startObjectId).toBe(withOrbit.nodeId)
    expect(duplicateRootBranch.parentObject).toBe(orbit.name)
    expect(duplicateRootBranch.startObject).toBe(orbit.name)

    const duplicateChildBranchId = duplicateRootBranchNode.children[0]
    const duplicateChildBranch = duplicated.system.branches[duplicateChildBranchId]
    expect(duplicateChildBranch.name).toBe('child_branch_copy')
    expect(duplicateChildBranch.parentObjectId).toBe(withOrbit.nodeId)
    expect(duplicateChildBranch.startObjectId).toBe(duplicateRootBranchId)
    expect(duplicateChildBranch.parentObject).toBe(orbit.name)
    expect(duplicateChildBranch.startObject).toBe('root_branch_copy')
  })

  it('duplicates scene and diagram viewports as siblings with copied UI state', () => {
    let system = createSystem({ name: 'Duplicate_Viewports' })
    const sceneAdded = addScene(system, 'Scene_A')
    system = sceneAdded.system
    system = updateScene(system, sceneAdded.nodeId, {
      selectedNodeIds: ['node-1'],
      display: 'selection',
      axisRanges: { x: [-2, 2] },
      viewRevision: 3,
    })
    system.ui.viewportHeights[sceneAdded.nodeId] = 320

    const sceneDuplicate = duplicateNode(system, sceneAdded.nodeId)
    expect(sceneDuplicate).toBeTruthy()
    if (!sceneDuplicate) {
      throw new Error('Expected duplicated scene.')
    }
    const duplicatedSceneId = sceneDuplicate.nodeId
    const sceneRootIndex = sceneDuplicate.system.rootIds.indexOf(sceneAdded.nodeId)
    expect(sceneDuplicate.system.rootIds[sceneRootIndex + 1]).toBe(duplicatedSceneId)
    expect(sceneDuplicate.system.nodes[duplicatedSceneId].name).toBe('Scene_A_copy')
    expect(sceneDuplicate.system.ui.viewportHeights[duplicatedSceneId]).toBe(320)
    expect(
      sceneDuplicate.system.scenes.find((scene) => scene.id === duplicatedSceneId)
    ).toMatchObject({
      name: 'Scene_A_copy',
      selectedNodeIds: ['node-1'],
      display: 'selection',
      axisRanges: { x: [-2, 2] },
      viewRevision: 3,
    })

    const diagramAdded = addBifurcationDiagram(sceneDuplicate.system, 'Diagram_A')
    const withDiagram = updateBifurcationDiagram(diagramAdded.system, diagramAdded.nodeId, {
      selectedBranchIds: ['branch-1'],
      xAxis: { kind: 'parameter', name: 'mu' },
      yAxis: { kind: 'state', name: 'x' },
      axisRanges: { x: [0, 1], y: [-1, 1] },
      viewRevision: 4,
    })
    withDiagram.ui.viewportHeights[diagramAdded.nodeId] = 280

    const diagramDuplicate = duplicateNode(withDiagram, diagramAdded.nodeId)
    expect(diagramDuplicate).toBeTruthy()
    if (!diagramDuplicate) {
      throw new Error('Expected duplicated diagram.')
    }
    const duplicatedDiagramId = diagramDuplicate.nodeId
    const diagramRootIndex = diagramDuplicate.system.rootIds.indexOf(diagramAdded.nodeId)
    expect(diagramDuplicate.system.rootIds[diagramRootIndex + 1]).toBe(duplicatedDiagramId)
    expect(diagramDuplicate.system.nodes[duplicatedDiagramId].name).toBe('Diagram_A_copy')
    expect(diagramDuplicate.system.ui.viewportHeights[duplicatedDiagramId]).toBe(280)
    expect(
      diagramDuplicate.system.bifurcationDiagrams.find(
        (diagram) => diagram.id === duplicatedDiagramId
      )
    ).toMatchObject({
      name: 'Diagram_A_copy',
      selectedBranchIds: ['branch-1'],
      xAxis: { kind: 'parameter', name: 'mu' },
      yAxis: { kind: 'state', name: 'x' },
      axisRanges: { x: [0, 1], y: [-1, 1] },
      viewRevision: 4,
    })
  })
  it('duplicates analysis viewports as siblings with copied UI state', () => {
    let system = createSystem({ name: 'Duplicate_Analysis_Viewport' })
    const analysisAdded = addAnalysisViewport(system, 'Return_Map_A')
    system = updateAnalysisViewport(analysisAdded.system, analysisAdded.nodeId, {
      sourceNodeIds: ['node-1'],
      display: 'selection',
      axisRanges: { x: [-1, 1], y: [0, 2] },
      viewRevision: 6,
      event: {
        mode: 'cross_down',
        source: { kind: 'custom', expression: 'mu' },
        level: 0.25,
      },
      axes: {
        x: { kind: 'observable', expression: 'mu', hitOffset: 0, label: 'mu@n' },
        y: { kind: 'observable', expression: 'x', hitOffset: 1, label: 'x@n+1' },
        z: { kind: 'hit_index', label: 'n' },
      },
      advanced: {
        skipHits: 2,
        hitStride: 3,
        maxHits: 120,
        connectPoints: true,
        showIdentityLine: true,
        identityLineColor: '#787878',
        identityLineStyle: 'dotted',
      },
    })
    system.ui.viewportHeights[analysisAdded.nodeId] = 260

    const analysisDuplicate = duplicateNode(system, analysisAdded.nodeId)
    expect(analysisDuplicate).toBeTruthy()
    if (!analysisDuplicate) {
      throw new Error('Expected duplicated analysis viewport.')
    }
    const duplicatedAnalysisId = analysisDuplicate.nodeId
    const analysisRootIndex = analysisDuplicate.system.rootIds.indexOf(analysisAdded.nodeId)
    expect(analysisDuplicate.system.rootIds[analysisRootIndex + 1]).toBe(duplicatedAnalysisId)
    expect(analysisDuplicate.system.nodes[duplicatedAnalysisId].name).toBe('Return_Map_A_copy')
    expect(analysisDuplicate.system.ui.viewportHeights[duplicatedAnalysisId]).toBe(260)
    expect(
      analysisDuplicate.system.analysisViewports.find((viewport) => viewport.id === duplicatedAnalysisId)
    ).toMatchObject({
      name: 'Return_Map_A_copy',
      sourceNodeIds: [],
      display: 'selection',
      axisRanges: { x: [-1, 1], y: [0, 2] },
      viewRevision: 6,
      event: {
        mode: 'cross_down',
        source: { kind: 'custom', expression: 'mu' },
        level: 0.25,
      },
      axes: {
        x: { kind: 'observable', expression: 'mu', hitOffset: 0, label: 'mu@n' },
        y: { kind: 'observable', expression: 'x', hitOffset: 1, label: 'x@n+1' },
        z: { kind: 'hit_index', label: 'n' },
      },
      advanced: {
        skipHits: 2,
        hitStride: 3,
        maxHits: 120,
        connectPoints: true,
        showIdentityLine: true,
        identityLineColor: '#787878',
        identityLineStyle: 'dotted',
      },
    })
  })

  it('removes deleted source nodes from analysis viewport source selections', () => {
    const base = createSystem({ name: 'Analysis_Remove_Cleanup' })
    const orbitA: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_A',
      systemName: base.config.name,
      data: [[0, 0, 1]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const orbitB: OrbitObject = {
      type: 'orbit',
      name: 'Orbit_B',
      systemName: base.config.name,
      data: [[0, 1, 0]],
      t_start: 0,
      t_end: 0,
      dt: 0.1,
    }
    const withOrbitA = addObject(base, orbitA)
    const withOrbitB = addObject(withOrbitA.system, orbitB)
    const analysisAdded = addAnalysisViewport(withOrbitB.system, 'Return_Map')
    const configured = updateAnalysisViewport(analysisAdded.system, analysisAdded.nodeId, {
      sourceNodeIds: [withOrbitA.nodeId, withOrbitB.nodeId],
    })

    const cleaned = removeNode(configured, withOrbitA.nodeId)

    expect(cleaned.analysisViewports[0]?.sourceNodeIds).toEqual([withOrbitB.nodeId])
  })

})
