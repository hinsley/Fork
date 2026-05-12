import { createSystem } from '../system/model'
import { createDataSystemConfig } from '../system/dataDefaults'
import type { SystemStore } from '../system/store'
import type { System, SystemConfig, SystemSummary } from '../system/types'
import { validateSystemName } from './systemValidation'

type SystemStorageAction =
  | { type: 'SET_SYSTEM'; system: System | null }
  | { type: 'SET_SYSTEMS'; systems: SystemSummary[] }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string | null }

type EnsureEntitiesLoaded = (request: {
  objectIds?: string[]
  branchIds?: string[]
}) => Promise<System | null>

type SystemArchive = {
  filename: string
  blob: Blob
}

type PreparedSystem = {
  system: System
  changed: boolean
}

type PrepareSystemForStorage = (system: System) => Promise<PreparedSystem> | PreparedSystem

export type SystemStorageCommands = {
  refreshSystems: () => Promise<void>
  createSystem: (name: string, type?: SystemConfig['type']) => Promise<void>
  openSystem: (id: string) => Promise<void>
  saveSystem: () => Promise<void>
  exportSystem: (id: string) => Promise<void>
  deleteSystem: (id: string) => Promise<void>
  resetFork: () => Promise<void>
  importSystem: (file: File) => Promise<void>
}

export type SystemStorageCommandDeps = {
  store: SystemStore
  dispatch: (action: SystemStorageAction) => void
  getCurrentSystem: () => System | null
  setLatestSystem: (system: System | null) => void
  ensureEntitiesLoaded: EnsureEntitiesLoaded
  downloadArchive?: (archive: SystemArchive) => void
  clearBrowserStorage?: () => void
  reloadBrowser?: () => void
  prepareSystemForStorage?: PrepareSystemForStorage
}

function downloadArchive({ filename, blob }: SystemArchive): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function clearBrowserStorage(): void {
  if (
    typeof window !== 'undefined' &&
    'localStorage' in window &&
    typeof window.localStorage.clear === 'function'
  ) {
    window.localStorage.clear()
  }
}

function reloadBrowser(): void {
  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

export function createSystemStorageCommands({
  store,
  dispatch,
  getCurrentSystem,
  setLatestSystem,
  ensureEntitiesLoaded,
  downloadArchive: download = downloadArchive,
  clearBrowserStorage: clearStorage = clearBrowserStorage,
  reloadBrowser: reload = reloadBrowser,
  prepareSystemForStorage,
}: SystemStorageCommandDeps): SystemStorageCommands {
  const refreshSystems = async () => {
    try {
      const systems = await store.list()
      dispatch({ type: 'SET_SYSTEMS', systems })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }

  const createSystemAction = async (name: string, type: SystemConfig['type'] = 'flow') => {
    const nameError = validateSystemName(name)
    if (nameError) {
      dispatch({ type: 'SET_ERROR', error: nameError })
      return
    }
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      const config: SystemConfig | undefined =
        type === 'data'
          ? createDataSystemConfig(name)
          : type === 'map'
            ? {
                name,
                equations: ['r * x * (1 - x)'],
                params: [3.7],
                paramNames: ['r'],
                varNames: ['x'],
                solver: 'discrete',
                type: 'map',
              }
            : undefined
      const created = createSystem(config ? { name, config } : { name })
      const prepared = prepareSystemForStorage
        ? await prepareSystemForStorage(created)
        : { system: created, changed: false }
      const system = prepared.system
      dispatch({ type: 'SET_SYSTEM', system })
      await store.save(system)
      await refreshSystems()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }

  const openSystem = async (id: string) => {
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      const loaded = await store.load(id)
      const prepared = prepareSystemForStorage
        ? await prepareSystemForStorage(loaded)
        : { system: loaded, changed: false }
      const system = prepared.system
      if (prepared.changed) {
        await store.save(system)
      }
      setLatestSystem(system)
      dispatch({ type: 'SET_SYSTEM', system })
      if (prepared.changed) {
        await refreshSystems()
      }
      const selectedNodeId = system.ui.selectedNodeId
      if (selectedNodeId) {
        await ensureEntitiesLoaded({
          objectIds: [selectedNodeId],
          branchIds: [selectedNodeId],
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }

  const saveSystem = async () => {
    const system = getCurrentSystem()
    if (!system) return
    dispatch({ type: 'SET_BUSY', busy: true })
    await store.save(system)
    await refreshSystems()
    dispatch({ type: 'SET_BUSY', busy: false })
  }

  const exportSystem = async (id: string) => {
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      const result = await store.exportSystemArchive(id)
      download(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }

  const deleteSystem = async (id: string) => {
    dispatch({ type: 'SET_BUSY', busy: true })
    await store.remove(id)
    await refreshSystems()
    dispatch({ type: 'SET_BUSY', busy: false })
  }

  const resetFork = async () => {
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      await store.clear()
      clearStorage()
      dispatch({ type: 'SET_SYSTEM', system: null })
      dispatch({ type: 'SET_SYSTEMS', systems: [] })
      reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }

  const importSystem = async (file: File) => {
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      const system = await store.importSystemArchive(file)
      dispatch({ type: 'SET_SYSTEM', system })
      await refreshSystems()
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }

  return {
    refreshSystems,
    createSystem: createSystemAction,
    openSystem,
    saveSystem,
    exportSystem,
    deleteSystem,
    resetFork,
    importSystem,
  }
}
