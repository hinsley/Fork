import { describe, expect, it, vi } from 'vitest'
import { addScene, createSystem } from '../system/model'
import { MemorySystemStore } from '../system/store'
import type { System, SystemSummary } from '../system/types'
import {
  STARTER_DATASET_NAME,
  STARTER_DATASET_WINDOW_SIZE,
  createDataSystemConfig,
  seedStarterDataset,
} from '../system/dataDefaults'
import {
  createSystemStorageCommands,
  type SystemStorageCommandDeps,
} from './systemStorageCommands'

type CapturedAction = Parameters<SystemStorageCommandDeps['dispatch']>[0]

function setupStorageCommands(options: {
  store?: MemorySystemStore
  initialSystem?: System | null
  prepareSystemForStorage?: SystemStorageCommandDeps['prepareSystemForStorage']
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
    prepareSystemForStorage: options.prepareSystemForStorage,
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

const testStarterSpectrum = {
  frequencies: [0, 0.125],
  power: [0, 1],
  sample_count: 512,
  segment_count: 4,
  sample_interval: 1,
  window_size: STARTER_DATASET_WINDOW_SIZE,
}

function seedStarterDatasetForTest(system: System) {
  return seedStarterDataset(system, testStarterSpectrum, '2026-05-12T00:00:00.000Z')
}

describe('system storage commands', () => {
  it('creates systems through the store and refreshes summaries', async () => {
    const harness = setupStorageCommands()

    await harness.commands.createSystem('Command_System')

    const state = harness.getState()
    expect(state.currentSystem?.name).toBe('Command_System')
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

    await harness.commands.createSystem('Invalid Name')

    expect(harness.getState().currentSystem).toBeNull()
    expect(harness.getState().error).toBe(
      'System name must contain only letters, numbers, and underscores.'
    )
    expect(await harness.store.list()).toEqual([])
  })

  it('prepares starter datasets before saving data systems', async () => {
    const harness = setupStorageCommands({
      prepareSystemForStorage: seedStarterDatasetForTest,
    })

    await harness.commands.createSystem('Data_Command', 'data')

    const state = harness.getState()
    const objectId = state.currentSystem?.rootIds.find((id) => {
      return state.currentSystem?.objects[id]?.type === 'dataset'
    })
    expect(objectId).toBeTruthy()
    expect(state.currentSystem?.objects[objectId!]?.name).toBe(STARTER_DATASET_NAME)
    expect(state.currentSystem?.ui.selectedNodeId).toBe(objectId)
    expect(state.currentSystem?.config.data?.starterDatasetSeeded).toBe(true)
    expect(await harness.store.load(state.currentSystem!.id)).toMatchObject({
      config: { data: { starterDatasetSeeded: true } },
    })
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

  it('migrates legacy empty data systems when opened', async () => {
    const legacy = createSystem({
      name: 'Legacy_Data',
      config: createDataSystemConfig('Legacy_Data'),
    })
    const store = new MemorySystemStore()
    await store.save(legacy)
    const harness = setupStorageCommands({
      store,
      prepareSystemForStorage: seedStarterDatasetForTest,
    })

    await harness.commands.openSystem(legacy.id)

    const state = harness.getState()
    const objectId = state.currentSystem?.ui.selectedNodeId
    expect(objectId).toBeTruthy()
    expect(state.currentSystem?.objects[objectId!]?.name).toBe(STARTER_DATASET_NAME)
    expect(harness.ensureEntitiesLoaded).toHaveBeenCalledWith({
      objectIds: [objectId],
      branchIds: [objectId],
    })
    expect((await store.load(legacy.id)).config.data?.starterDatasetSeeded).toBe(true)
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
})
