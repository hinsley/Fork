import type { System, SystemData, SystemSummary, SystemUiSnapshot } from './types'
import type { SystemStore } from './store'
import {
  SYSTEM_DATA_SCHEMA_VERSION,
  SYSTEM_UI_SCHEMA_VERSION,
  mergeSystem,
  serializeSystemData,
  serializeSystemUi,
  type SystemDataBundle,
  type SystemUiBundle,
} from './serialization'

const DEFAULT_DB_NAME = 'fork-systems'
const DEFAULT_DB_VERSION = 2
const DATA_STORE = 'system-data'
const UI_STORE = 'system-ui'
const LEGACY_STORE = 'systems'

type StoreConfig = {
  name?: string
  version?: number
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to delete IndexedDB'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function isVersionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'VersionError'
}

function openDatabaseOnce(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        db.deleteObjectStore(LEGACY_STORE)
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE)
      }
      if (!db.objectStoreNames.contains(UI_STORE)) {
        db.createObjectStore(UI_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

async function openDatabase(name: string, version: number): Promise<IDBDatabase> {
  try {
    return await openDatabaseOnce(name, version)
  } catch (error) {
    if (!isVersionError(error)) {
      throw error
    }
    await deleteDatabase(name)
    return await openDatabaseOnce(name, version)
  }
}

function latestIso(primary: string, secondary?: string) {
  if (!secondary) return primary
  return primary.localeCompare(secondary) >= 0 ? primary : secondary
}

function requireSystemDataBundle(bundle: unknown): SystemData {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid system data bundle.')
  }
  const record = bundle as SystemDataBundle
  if (record.schemaVersion !== SYSTEM_DATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported system schema version: ${record.schemaVersion}`)
  }
  if (!record.system || typeof record.system !== 'object') {
    throw new Error('Invalid system data bundle.')
  }
  return structuredClone(record.system)
}

function requireSystemUiBundle(bundle: unknown): SystemUiSnapshot {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid system UI bundle.')
  }
  const record = bundle as SystemUiBundle
  if (record.schemaVersion !== SYSTEM_UI_SCHEMA_VERSION) {
    throw new Error(`Unsupported system UI schema version: ${record.schemaVersion}`)
  }
  if (!record.ui || typeof record.ui !== 'object') {
    throw new Error('Invalid system UI bundle.')
  }
  return structuredClone(record.ui)
}

async function readAll<T>(
  store: IDBObjectStore
): Promise<{ keys: string[]; values: T[] }> {
  const [keys, values] = await Promise.all([
    requestToPromise(store.getAllKeys()),
    requestToPromise(store.getAll()),
  ])
  return {
    keys: keys.map((key) => String(key)),
    values: values as T[],
  }
}

export class IndexedDbSystemStore implements SystemStore {
  private dbName: string
  private dbVersion: number

  constructor(config: StoreConfig = {}) {
    this.dbName = config.name ?? DEFAULT_DB_NAME
    this.dbVersion = config.version ?? DEFAULT_DB_VERSION
  }

  async list(): Promise<SystemSummary[]> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([DATA_STORE, UI_STORE], 'readonly')
      const dataStore = transaction.objectStore(DATA_STORE)
      const uiStore = transaction.objectStore(UI_STORE)
      const [dataEntries, uiEntries] = await Promise.all([
        readAll<SystemDataBundle>(dataStore),
        readAll<SystemUiBundle>(uiStore),
      ])
      await transactionDone(transaction)

      const uiById = new Map<string, SystemUiSnapshot>()
      uiEntries.keys.forEach((key, index) => {
        uiById.set(key, requireSystemUiBundle(uiEntries.values[index]))
      })

      const summaries = dataEntries.keys.map((key, index) => {
        const data = requireSystemDataBundle(dataEntries.values[index])
        const ui = uiById.get(key)
        return {
          id: data.id,
          name: data.name,
          updatedAt: latestIso(data.updatedAt, ui?.updatedAt),
          type: data.config.type,
        }
      })

      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } finally {
      db.close()
    }
  }

  async load(id: string): Promise<System> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([DATA_STORE, UI_STORE], 'readonly')
      const dataStore = transaction.objectStore(DATA_STORE)
      const uiStore = transaction.objectStore(UI_STORE)
      const dataBundle = await requestToPromise(dataStore.get(id))
      const uiBundle = await requestToPromise(uiStore.get(id))
      await transactionDone(transaction)

      if (!dataBundle) {
        throw new Error(`System "${id}" not found`)
      }

      const data = requireSystemDataBundle(dataBundle)
      const ui = uiBundle ? requireSystemUiBundle(uiBundle) : undefined
      return mergeSystem(data, ui)
    } finally {
      db.close()
    }
  }

  async save(system: System): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([DATA_STORE, UI_STORE], 'readwrite')
      const dataStore = transaction.objectStore(DATA_STORE)
      const uiStore = transaction.objectStore(UI_STORE)
      dataStore.put(serializeSystemData(system), system.id)
      uiStore.put(serializeSystemUi(system), system.id)
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }

  async saveUi(system: System): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction(UI_STORE, 'readwrite')
      const uiStore = transaction.objectStore(UI_STORE)
      uiStore.put(serializeSystemUi(system), system.id)
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }

  async remove(id: string): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([DATA_STORE, UI_STORE], 'readwrite')
      transaction.objectStore(DATA_STORE).delete(id)
      transaction.objectStore(UI_STORE).delete(id)
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }

  async clear(): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([DATA_STORE, UI_STORE], 'readwrite')
      transaction.objectStore(DATA_STORE).clear()
      transaction.objectStore(UI_STORE).clear()
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }
}
