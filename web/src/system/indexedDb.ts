import type { System, SystemSummary, SystemUiSnapshot } from './types'
import type { SystemStore } from './store'
import {
  deserializeSystemData,
  deserializeSystemUi,
  mergeSystem,
  serializeSystemData,
  serializeSystemUi,
  type LegacySystemBundle,
  type SystemDataBundle,
  type SystemUiBundle,
} from './serialization'

const DEFAULT_DB_NAME = 'fork-systems'
const DB_VERSION = 1
const STORE_NAME = 'systems'

type StoredSystemRecord = {
  id: string
  data: SystemDataBundle | LegacySystemBundle
  ui?: SystemUiBundle
}

type IdbStoreOptions = {
  dbName?: string
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
      }
      resolve(db)
    }
  })
}

async function getAllRecords(store: IDBObjectStore): Promise<StoredSystemRecord[]> {
  const maybeGetAll = (store as { getAll?: () => IDBRequest<StoredSystemRecord[]> }).getAll
  if (maybeGetAll) {
    return requestToPromise(maybeGetAll.call(store))
  }
  return new Promise((resolve, reject) => {
    const records: StoredSystemRecord[] = []
    const request = store.openCursor()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(records)
        return
      }
      records.push(cursor.value as StoredSystemRecord)
      cursor.continue()
    }
  })
}

function safeDeserializeUi(bundle?: SystemUiBundle): SystemUiSnapshot | null {
  if (!bundle) return null
  try {
    return deserializeSystemUi(bundle)
  } catch {
    return null
  }
}

function latestIso(primary: string, secondary?: string) {
  if (!secondary) return primary
  return primary.localeCompare(secondary) >= 0 ? primary : secondary
}

export function supportsIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

export class IdbSystemStore implements SystemStore {
  private dbPromise: Promise<IDBDatabase>
  private options: IdbStoreOptions

  constructor(options: IdbStoreOptions = {}) {
    this.options = options
    this.dbPromise = openDatabase(this.options.dbName ?? DEFAULT_DB_NAME)
  }

  static async create(options?: IdbStoreOptions): Promise<IdbSystemStore> {
    const store = new IdbSystemStore(options)
    await store.dbPromise
    return store
  }

  async list(): Promise<SystemSummary[]> {
    const db = await this.dbPromise
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const records = await getAllRecords(store)
    await transactionDone(transaction)

    const summaries: SystemSummary[] = []
    for (const record of records) {
      try {
        const { data, ui: legacyUi } = deserializeSystemData(record.data)
        const ui = safeDeserializeUi(record.ui) ?? legacyUi
        summaries.push({
          id: data.id,
          name: data.name,
          updatedAt: latestIso(data.updatedAt, ui?.updatedAt),
          type: data.config.type,
        })
      } catch {
        continue
      }
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async load(id: string): Promise<System> {
    const record = await this.getRecord(id)
    if (!record) {
      throw new Error(`System "${id}" not found`)
    }
    const { data, ui: legacyUi } = deserializeSystemData(record.data)
    const ui = safeDeserializeUi(record.ui) ?? legacyUi
    return mergeSystem(data, ui ?? undefined)
  }

  async save(system: System): Promise<void> {
    const record: StoredSystemRecord = {
      id: system.id,
      data: serializeSystemData(system),
      ui: serializeSystemUi(system),
    }
    await this.putRecord(record)
  }

  async saveUi(system: System): Promise<void> {
    const existing = await this.getRecord(system.id)
    const record: StoredSystemRecord = existing
      ? { ...existing, ui: serializeSystemUi(system) }
      : {
          id: system.id,
          data: serializeSystemData(system),
          ui: serializeSystemUi(system),
        }
    await this.putRecord(record)
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.delete(id)
    await transactionDone(transaction)
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.clear()
    await transactionDone(transaction)
  }

  async close(): Promise<void> {
    const db = await this.dbPromise
    db.close()
  }

  private async getRecord(id: string): Promise<StoredSystemRecord | undefined> {
    const db = await this.dbPromise
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const record = await requestToPromise(
      store.get(id) as IDBRequest<StoredSystemRecord | undefined>
    )
    await transactionDone(transaction)
    return record
  }

  private async putRecord(record: StoredSystemRecord): Promise<void> {
    const db = await this.dbPromise
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.put(record)
    await transactionDone(transaction)
  }
}
