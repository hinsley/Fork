import { describe, it, expect } from 'vitest'
import {
  addBranch,
  addObject,
  addBifurcationDiagram,
  addScene,
  createSystem,
  moveNode,
  normalizeSystem,
  reorderNode,
  renameNode,
  selectNode,
  toggleNodeVisibility,
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
    const legacy = structuredClone(withDiagram) as typeof withDiagram
    delete (legacy.scenes[0] as { viewRevision?: number }).viewRevision
    delete (legacy.bifurcationDiagrams[0] as { viewRevision?: number }).viewRevision

    const normalized = normalizeSystem(legacy)

    expect(normalized.scenes[0].viewRevision).toBe(0)
    expect(normalized.bifurcationDiagrams[0].viewRevision).toBe(0)
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
    expect(renamed.branches[withBranch.nodeId].parentObject).toBe('Orbit B')
    expect(renamed.branches[withBranch.nodeId].startObject).toBe('Orbit B')
    const lc = renamed.objects[withLimitCycle.nodeId]
    expect(lc.type).toBe('limit_cycle')
    if (lc.type === 'limit_cycle') {
      expect(lc.origin.type).toBe('orbit')
      if (lc.origin.type === 'orbit') {
        expect(lc.origin.orbitName).toBe('Orbit B')
      }
    }
    expect(renamed.objects).not.toBe(withLimitCycle.system.objects)
    expect(renamed.branches).not.toBe(withLimitCycle.system.branches)
    const renamedOrbit = renamed.objects[withOrbit.nodeId]
    const originalOrbit = withLimitCycle.system.objects[withOrbit.nodeId]
    expect(renamedOrbit.type).toBe('orbit')
    if (renamedOrbit.type === 'orbit' && originalOrbit.type === 'orbit') {
      expect(renamedOrbit.data).toBe(originalOrbit.data)
    }
  })
})
