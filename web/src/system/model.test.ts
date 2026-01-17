import { describe, it, expect } from 'vitest'
import {
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
import type { OrbitObject } from './types'

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
})
