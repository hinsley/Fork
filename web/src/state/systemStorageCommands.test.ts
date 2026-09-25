import { describe, expect, it, vi } from 'vitest'
import { addScene, createSystem } from '../system/model'
import { MemorySystemStore } from '../system/store'
import type { System, SystemSummary } from '../system/types'
import {
  createSystemStorageCommands,
  type SystemStorageCommandDeps,
} from './systemStorageCommands'

type CapturedAction = Parameters<SystemStorageCommandDeps['dispatch']>[0]

function setupStorageCommands(options: {
  store?: MemorySystemStore
  initialSystem?: System | null
} = {}) {
  const store = options.store ?? new MemorySystemStore()
  let currentSystem = options.initialSystem ?? null
  let latestSystem: System | null = null
  let systems: SystemSummary[] = []
  let busy = false
  let error: string | null = null
  const actions: CapturedAction[] = []
  const ensureEntitiesLoaded = vi.fn(async () => currentSystem)
  const downloadArchive = vi.fn()
  const clearBrowserStorage = vi.fn()
  const reloadBrowser = vi.fn()

  const commands = createSystemStorageCommands({
    store,
    dispatch: (action) => {
      actions.push(action)
      if (action.type === 'SET_SYSTEM') {
        currentSystem = action.system
      } else if (action.type === 'SET_SYSTEMS') {
        systems = action.systems
      } else if (action.type === 'SET_BUSY') {
        busy = action.busy
      } else if (action.type === 'SET_ERROR') {
        error = action.error
      }
    },
    getCurrentSystem: () => currentSystem,
    setLatestSystem: (system) => {
      latestSystem = system
    },
    ensureEntitiesLoaded,
    downloadArchive,
    clearBrowserStorage,
    reloadBrowser,
  })

  return {
    actions,
    clearBrowserStorage,
    commands,
    downloadArchive,
    ensureEntitiesLoaded,
    getState: () => ({ busy, currentSystem, error, latestSystem, systems }),
    reloadBrowser,
    store,
  }
}

describe('system storage commands', () => {
  it('creates systems through the store and refreshes summaries', async () => {
    const harness = setupStorageCommands()

    await harness.commands.createSystem('  My System  ')

    const state = harness.getState()
    expect(state.currentSystem?.name).toBe('My System')
    expect(state.systems).toEqual(await harness.store.list())
    expect(state.error).toBeNull()
    expect(state.busy).toBe(false)
    expect(harness.actions.map((action) => action.type)).toEqual([
      'SET_BUSY',
      'SET_SYSTEM',
      'SET_SYSTEMS',
      'SET_BUSY',
    ])
  })

  it('keeps invalid create requests inside the command layer', async () => {
    const harness = setupStorageCommands()

    await harness.commands.createSystem('Invalid/Name')

    expect(harness.getState().currentSystem).toBeNull()
    expect(harness.getState().error).toBe(
      'System name cannot contain path separators.'
    )
    expect(await harness.store.list()).toEqual([])
  })

  it('opens systems and delegates selected entity hydration', async () => {
    const base = createSystem({ name: 'Open_Command' })
    const withScene = addScene(base, 'Scene_A')
    const selectedSystem: System = {
      ...withScene.system,
      ui: {
        ...withScene.system.ui,
        selectedNodeId: withScene.nodeId,
      },
    }
    const store = new MemorySystemStore()
    await store.save(selectedSystem)
    const harness = setupStorageCommands({ store })

    await harness.commands.openSystem(selectedSystem.id)

    const state = harness.getState()
    expect(state.currentSystem?.id).toBe(selectedSystem.id)
    expect(state.latestSystem?.id).toBe(selectedSystem.id)
    expect(harness.ensureEntitiesLoaded).toHaveBeenCalledWith({
      objectIds: [withScene.nodeId],
      branchIds: [withScene.nodeId],
    })
  })

  it('returns to the homepage without deleting the active system', async () => {
    const system = createSystem({ name: 'Home_Command' })
    const store = new MemorySystemStore()
    await store.save(system)
    const harness = setupStorageCommands({ store, initialSystem: system })

    harness.commands.closeSystem()

    expect(harness.getState().currentSystem).toBeNull()
    expect(harness.getState().latestSystem).toBeNull()
    expect(await store.list()).toHaveLength(1)
  })

  it('exports archives through the injected browser download effect', async () => {
    const system = createSystem({ name: 'Export_Command' })
    const store = new MemorySystemStore()
    await store.save(system)
    const harness = setupStorageCommands({ store })

    await harness.commands.exportSystem(system.id)

    expect(harness.downloadArchive).toHaveBeenCalledTimes(1)
    expect(harness.downloadArchive.mock.calls[0]?.[0].filename).toBe('Export_Command.zip')
    expect(harness.getState().busy).toBe(false)
  })

  it('resets stored systems and delegates browser cleanup effects', async () => {
    const system = createSystem({ name: 'Reset_Command' })
    const store = new MemorySystemStore()
    await store.save(system)
    const harness = setupStorageCommands({ store, initialSystem: system })

    await harness.commands.resetFork()

    expect(await store.list()).toEqual([])
    expect(harness.getState().currentSystem).toBeNull()
    expect(harness.getState().systems).toEqual([])
    expect(harness.clearBrowserStorage).toHaveBeenCalledTimes(1)
    expect(harness.reloadBrowser).toHaveBeenCalledTimes(1)
  })

  it('reports failed imports, opens, deletes, and saves instead of failing silently', async () => {
    const system = createSystem({ name: 'Failing_Store' })
    const store = new MemorySystemStore()
    await store.save(system)
    const harness = setupStorageCommands({ store, initialSystem: system })

    vi.spyOn(store, 'importSystemArchive').mockRejectedValueOnce(new Error('Bad archive'))
    await harness.commands.importSystem(new File(['nope'], 'bad.zip'))
    expect(harness.getState().error).toBe('Import failed: Bad archive')
    expect(harness.getState().busy).toBe(false)

    await harness.commands.openSystem('missing-id')
    expect(harness.getState().error).toBe('Open failed: System "missing-id" not found')
    expect(harness.getState().busy).toBe(false)

    vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('Delete denied'))
    await harness.commands.deleteSystem(system.id)
    expect(harness.getState().error).toBe('Delete failed: Delete denied')
    expect(harness.getState().systems.map((entry) => entry.id)).toEqual([system.id])
    expect(harness.getState().busy).toBe(false)

    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('Quota exceeded'))
    await harness.commands.saveSystem()
    expect(harness.getState().error).toBe('Save failed: Quota exceeded')
    expect(harness.getState().busy).toBe(false)
  })

  it('lists summaries with variable and parameter names, newest first', async () => {
    const older = { ...createSystem({ name: 'Older' }), updatedAt: '2024-01-01T00:00:00.000Z' }
    const newer = { ...createSystem({ name: 'Newer' }), updatedAt: '2024-02-01T00:00:00.000Z' }
    const store = new MemorySystemStore()
    await store.save(older)
    await store.save(newer)

    const summaries = await store.list()

    expect(summaries.map((entry) => entry.name)).toEqual(['Newer', 'Older'])
    expect(summaries[0]?.varNames).toEqual(newer.config.varNames)
    expect(summaries[0]?.paramNames).toEqual(newer.config.paramNames)
  })
})
