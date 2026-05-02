import { describe, expect, it, vi } from 'vitest'
import { addObject, addScene, createSystem } from '../system/model'
import type { OrbitObject, System, SystemConfig } from '../system/types'
import {
  createSystemTreeCommands,
  type SystemTreeCommandDeps,
} from './systemTreeCommands'

type CapturedAction = Parameters<SystemTreeCommandDeps['dispatch']>[0]

function makeOrbit(name: string, config: SystemConfig): OrbitObject {
  return {
    type: 'orbit',
    name,
    systemName: config.name,
    data: [[0, 0, 0, 0]],
    t_start: 0,
    t_end: 0,
    dt: 0.1,
    parameters: [...config.params],
  }
}

function setupTreeCommands(initialSystem: System | null = createSystem({ name: 'Tree_Command' })) {
  let currentSystem = initialSystem
  let error: string | null = null
  const actions: CapturedAction[] = []
  const scheduleSystemSave = vi.fn()
  const scheduleUiSave = vi.fn()
  const ensureObjectLoaded = vi.fn()
  const ensureBranchLoaded = vi.fn()

  const commands = createSystemTreeCommands({
    dispatch: (action) => {
      actions.push(action)
      if (action.type === 'SET_SYSTEM') {
        currentSystem = action.system
      } else if (action.type === 'SET_ERROR') {
        error = action.error
      }
    },
    getCurrentSystem: () => currentSystem,
    scheduleSystemSave,
    scheduleUiSave,
    ensureObjectLoaded,
    ensureBranchLoaded,
  })

  return {
    actions,
    commands,
    ensureBranchLoaded,
    ensureObjectLoaded,
    getState: () => ({ currentSystem, error }),
    scheduleSystemSave,
    scheduleUiSave,
  }
}

describe('system tree commands', () => {
  it('selects nodes and hydrates selected objects', () => {
    const base = createSystem({ name: 'Select_Command' })
    const added = addObject(base, makeOrbit('Orbit_A', base.config))
    const harness = setupTreeCommands(added.system)

    harness.commands.selectNode(added.nodeId)

    expect(harness.getState().currentSystem?.ui.selectedNodeId).toBe(added.nodeId)
    expect(harness.ensureObjectLoaded).toHaveBeenCalledWith(added.nodeId)
    expect(harness.ensureBranchLoaded).not.toHaveBeenCalled()

    harness.commands.selectNode(added.nodeId)

    expect(harness.actions).toHaveLength(1)
  })

  it('renames objects through the system save path', () => {
    const base = createSystem({ name: 'Rename_Command' })
    const added = addObject(base, makeOrbit('Orbit_A', base.config))
    const harness = setupTreeCommands(added.system)

    harness.commands.renameNode(added.nodeId, '  Orbit_B  ')

    const system = harness.getState().currentSystem
    expect(system?.nodes[added.nodeId]?.name).toBe('Orbit_B')
    expect(system?.objects[added.nodeId]?.name).toBe('Orbit_B')
    expect(harness.scheduleSystemSave).toHaveBeenCalledWith(system)
    expect(harness.scheduleUiSave).not.toHaveBeenCalled()
  })

  it('keeps invalid renames inside the command layer', () => {
    const base = createSystem({ name: 'Invalid_Rename_Command' })
    const added = addObject(base, makeOrbit('Orbit_A', base.config))
    const harness = setupTreeCommands(added.system)

    harness.commands.renameNode(added.nodeId, 'Invalid name')

    expect(harness.getState().error).toBe(
      'Orbit names must be alphanumeric with underscores only.'
    )
    expect(harness.getState().currentSystem?.nodes[added.nodeId]?.name).toBe('Orbit_A')
    expect(harness.scheduleSystemSave).not.toHaveBeenCalled()
    expect(harness.scheduleUiSave).not.toHaveBeenCalled()
  })

  it('renames scene nodes through the UI save path', () => {
    const base = createSystem({ name: 'Scene_Rename_Command' })
    const added = addScene(base, 'Scene_A')
    const harness = setupTreeCommands(added.system)

    harness.commands.renameNode(added.nodeId, 'Scene_B')

    const system = harness.getState().currentSystem
    expect(system?.nodes[added.nodeId]?.name).toBe('Scene_B')
    expect(system?.scenes.find((scene) => scene.id === added.nodeId)?.name).toBe('Scene_B')
    expect(harness.scheduleUiSave).toHaveBeenCalledWith(system)
    expect(harness.scheduleSystemSave).not.toHaveBeenCalled()
  })

  it('updates tree display state through UI saves', () => {
    const base = createSystem({ name: 'Tree_Display_Command' })
    const first = addObject(base, makeOrbit('Orbit_A', base.config))
    const second = addObject(first.system, makeOrbit('Orbit_B', base.config))
    const harness = setupTreeCommands(second.system)

    harness.commands.toggleVisibility(first.nodeId)
    expect(harness.getState().currentSystem?.nodes[first.nodeId]?.visibility).toBe(false)

    harness.commands.toggleExpanded(first.nodeId)
    expect(harness.getState().currentSystem?.nodes[first.nodeId]?.expanded).toBe(false)

    harness.commands.moveNode(first.nodeId, 'down')
    expect(harness.getState().currentSystem?.rootIds).toEqual([second.nodeId, first.nodeId])

    harness.commands.reorderNode(first.nodeId, second.nodeId)
    expect(harness.getState().currentSystem?.rootIds).toEqual([first.nodeId, second.nodeId])

    harness.commands.updateLayout({ objectsOpen: false })
    expect(harness.getState().currentSystem?.ui.layout.objectsOpen).toBe(false)

    harness.commands.updateViewportHeight(first.nodeId, 320)
    expect(harness.getState().currentSystem?.ui.viewportHeights[first.nodeId]).toBe(320)

    harness.commands.updateViewportHeight(first.nodeId, Number.POSITIVE_INFINITY)
    expect(harness.getState().currentSystem?.ui.viewportHeights[first.nodeId]).toBe(320)

    harness.commands.updateRender(first.nodeId, { color: '#ff0000' })
    expect(harness.getState().currentSystem?.nodes[first.nodeId]?.render.color).toBe('#ff0000')
    expect(harness.scheduleUiSave).toHaveBeenCalledTimes(7)
  })
})
