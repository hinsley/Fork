import { describe, expect, it, vi } from 'vitest'
import { addFolder, addObject, addScene, createSystem } from '../system/model'
import type { OrbitObject, System, SystemConfig } from '../system/types'
import {
  createSystemTreeCommands,
  findRenameConflict,
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

    harness.commands.renameNode(added.nodeId, '  Voltage   Orbit  ')

    const system = harness.getState().currentSystem
    expect(system?.nodes[added.nodeId]?.name).toBe('Voltage   Orbit')
    expect(system?.objects[added.nodeId]?.name).toBe('Voltage   Orbit')
    expect(harness.scheduleSystemSave).toHaveBeenCalledWith(system)
    expect(harness.scheduleUiSave).not.toHaveBeenCalled()
  })

  it('keeps invalid renames inside the command layer', () => {
    const base = createSystem({ name: 'Invalid_Rename_Command' })
    const added = addObject(base, makeOrbit('Orbit_A', base.config))
    const harness = setupTreeCommands(added.system)

    harness.commands.renameNode(added.nodeId, 'Invalid/name')

    expect(harness.getState().error).toBe('Orbit name cannot contain path separators.')
    expect(harness.getState().currentSystem?.nodes[added.nodeId]?.name).toBe('Orbit_A')
    expect(harness.scheduleSystemSave).not.toHaveBeenCalled()
    expect(harness.scheduleUiSave).not.toHaveBeenCalled()
  })

  it('rejects renames to a name another object or folder already uses', () => {
    const base = createSystem({ name: 'Duplicate_Rename_Command' })
    const first = addObject(base, makeOrbit('Orbit_A', base.config))
    const second = addObject(first.system, makeOrbit('Orbit_B', base.config))
    const folderA = addFolder(second.system, 'Folder_A')
    const folderB = addFolder(folderA.system, 'Folder_B')
    const scene = addScene(folderB.system, 'Scene_A')
    const harness = setupTreeCommands(scene.system)

    expect(findRenameConflict(scene.system, second.nodeId, ' Orbit_A ')).toBe(
      'Orbit "Orbit_A" already exists.'
    )
    expect(harness.commands.renameNode(second.nodeId, 'Orbit_A')).toBe(false)
    expect(harness.getState().error).toBe('Orbit "Orbit_A" already exists.')
    expect(harness.getState().currentSystem?.nodes[second.nodeId]?.name).toBe('Orbit_B')
    expect(harness.scheduleSystemSave).not.toHaveBeenCalled()

    expect(harness.commands.renameNode(folderB.nodeId, 'Folder_A')).toBe(false)
    expect(harness.getState().currentSystem?.nodes[folderB.nodeId]?.name).toBe('Folder_B')

    // Different kinds may share a name; renaming to the current name is fine.
    expect(findRenameConflict(scene.system, scene.nodeId, 'Orbit_A')).toBeNull()
    expect(findRenameConflict(scene.system, second.nodeId, 'Orbit_B')).toBeNull()
    expect(harness.commands.renameNode(second.nodeId, 'Orbit_C')).toBe(true)
    expect(harness.getState().currentSystem?.nodes[second.nodeId]?.name).toBe('Orbit_C')
  })

  it('renames scene nodes through the UI save path', () => {
    const base = createSystem({ name: 'Scene_Rename_Command' })
    const added = addScene(base, 'Scene_A')
    const harness = setupTreeCommands(added.system)

    harness.commands.renameNode(added.nodeId, 'Parameter Sweep')

    const system = harness.getState().currentSystem
    expect(system?.nodes[added.nodeId]?.name).toBe('Parameter Sweep')
    expect(system?.scenes.find((scene) => scene.id === added.nodeId)?.name).toBe(
      'Parameter Sweep'
    )
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

    const folderId = harness.commands.createFolder()
    expect(folderId).toBeTruthy()
    expect(harness.getState().currentSystem?.nodes[folderId ?? '']?.kind).toBe('folder')
    expect(harness.getState().currentSystem?.ui.selectedNodeId).toBe(folderId)

    if (!folderId) throw new Error('Folder was not created')
    harness.commands.moveNodeIntoParent(first.nodeId, folderId)
    expect(harness.getState().currentSystem?.nodes[first.nodeId]?.parentId).toBe(folderId)
    expect(harness.getState().currentSystem?.nodes[folderId]?.children).toContain(first.nodeId)

    harness.commands.updateLayout({ objectsOpen: false })
    expect(harness.getState().currentSystem?.ui.layout.objectsOpen).toBe(false)

    harness.commands.updateViewportHeight(first.nodeId, 320)
    expect(harness.getState().currentSystem?.ui.viewportHeights[first.nodeId]).toBe(320)

    harness.commands.updateViewportHeight(first.nodeId, Number.POSITIVE_INFINITY)
    expect(harness.getState().currentSystem?.ui.viewportHeights[first.nodeId]).toBe(320)

    harness.commands.updateRender(first.nodeId, { color: '#ff0000' })
    expect(harness.getState().currentSystem?.nodes[first.nodeId]?.render.color).toBe('#ff0000')
    expect(harness.scheduleUiSave).toHaveBeenCalledTimes(9)
  })

  it('creates sibling folders with incremented names', () => {
    const base = createSystem({ name: 'Folder_Names' })
    const first = addObject(base, makeOrbit('Orbit_A', base.config))
    const harness = setupTreeCommands(first.system)

    const rootFolderA = harness.commands.createFolder()
    const rootFolderB = harness.commands.createFolder()
    expect(harness.getState().currentSystem?.nodes[rootFolderA ?? '']?.name).toBe('Folder_1')
    expect(harness.getState().currentSystem?.nodes[rootFolderB ?? '']?.name).toBe('Folder_2')

    // Names stay unique across the whole tree, not just among siblings.
    const childFolderA = harness.commands.createFolder(first.nodeId)
    const childFolderB = harness.commands.createFolder(first.nodeId)
    expect(harness.getState().currentSystem?.nodes[childFolderA ?? '']?.name).toBe('Folder_3')
    expect(harness.getState().currentSystem?.nodes[childFolderB ?? '']?.name).toBe('Folder_4')
  })

  it('wraps a node in a new sibling folder at its position', () => {
    const base = createSystem({ name: 'Folder_Wrap' })
    const first = addObject(base, makeOrbit('Orbit_A', base.config))
    const second = addObject(first.system, makeOrbit('Orbit_B', base.config))
    const third = addObject(second.system, makeOrbit('Orbit_C', base.config))
    const harness = setupTreeCommands(third.system)

    const folderId = harness.commands.createFolder(null, { wrapNodeId: second.nodeId })
    const state = harness.getState().currentSystem
    if (!folderId || !state) throw new Error('Folder was not created')
    expect(state.rootIds).toEqual([first.nodeId, folderId, third.nodeId])
    expect(state.nodes[folderId]?.children).toEqual([second.nodeId])
    expect(state.nodes[second.nodeId]?.parentId).toBe(folderId)
    expect(state.ui.selectedNodeId).toBe(folderId)
  })
})
