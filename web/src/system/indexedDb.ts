import { buildSystemArchiveBlob, parseSystemArchiveFile } from './archive'
import { emptySystemIndex, normalizeSystem, shardForEntityId } from './model'
import type { LoadedEntities, SystemStore } from './store'
import type {
  AnalysisObject,
  BranchIndexEntry,
  ContinuationObject,
  ObjectIndexEntry,
  System,
  SystemConfig,
  SystemIndex,
  SystemSummary,
  SystemUiSnapshot,
} from './types'

const STORAGE_SCHEMA_VERSION = 1
const DEFAULT_DB_NAME = 'fork-systems-v3'
const DEFAULT_DB_VERSION = 3
const META_STORE = 'system-meta'
const UI_STORE = 'system-ui'
const OBJECT_INDEX_STORE = 'object-index'
const BRANCH_INDEX_STORE = 'branch-index'
const OBJECT_PAYLOAD_STORE = 'object-payload'
const BRANCH_PAYLOAD_STORE = 'branch-payload'
const LEGACY_STORES = ['systems', 'system-data']

type StoreConfig = {
  name?: string
  version?: number
}

type SystemMetaRecord = {
  schemaVersion: number
  system: {
    id: string
    name: string
    config: SystemConfig
    updatedAt: string
  }
}

type UiRecord = {
  schemaVersion: number
  ui: SystemUiSnapshot
}

type IndexRecord<T> = {
  schemaVersion: number
  entries: Record<string, T>
}

type PayloadRecord<T> = {
  schemaVersion: number
  payload: T
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
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to delete IndexedDB database'))
  })
}

function isVersionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: string }).name === 'VersionError'
}

function openDatabaseOnce(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const legacyStore of LEGACY_STORES) {
        if (db.objectStoreNames.contains(legacyStore)) {
          db.deleteObjectStore(legacyStore)
        }
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
      if (!db.objectStoreNames.contains(UI_STORE)) {
        db.createObjectStore(UI_STORE)
      }
      if (!db.objectStoreNames.contains(OBJECT_INDEX_STORE)) {
        db.createObjectStore(OBJECT_INDEX_STORE)
      }
      if (!db.objectStoreNames.contains(BRANCH_INDEX_STORE)) {
        db.createObjectStore(BRANCH_INDEX_STORE)
      }
      if (!db.objectStoreNames.contains(OBJECT_PAYLOAD_STORE)) {
        db.createObjectStore(OBJECT_PAYLOAD_STORE)
      }
      if (!db.objectStoreNames.contains(BRANCH_PAYLOAD_STORE)) {
        db.createObjectStore(BRANCH_PAYLOAD_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
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

function objectPayloadKey(systemId: string, objectId: string) {
  return `${systemId}:${objectId}`
}

function branchPayloadKey(systemId: string, branchId: string) {
  return `${systemId}:${branchId}`
}

function buildUiRecord(system: System): UiRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    ui: {
      systemId: system.id,
      updatedAt: system.updatedAt,
      nodes: structuredClone(system.nodes),
      rootIds: [...system.rootIds],
      scenes: structuredClone(system.scenes),
      bifurcationDiagrams: structuredClone(system.bifurcationDiagrams),
      ui: structuredClone(system.ui),
    },
  }
}

function buildMetaRecord(system: System): SystemMetaRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    system: {
      id: system.id,
      name: system.name,
      config: structuredClone(system.config),
      updatedAt: system.updatedAt,
    },
  }
}

function buildObjectIndexRecord(index: Record<string, ObjectIndexEntry>): IndexRecord<ObjectIndexEntry> {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    entries: structuredClone(index),
  }
}

function buildBranchIndexRecord(index: Record<string, BranchIndexEntry>): IndexRecord<BranchIndexEntry> {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    entries: structuredClone(index),
  }
}

function ensureObjectIndex(system: System): Record<string, ObjectIndexEntry> {
  const index = structuredClone(system.index?.objects ?? {})
  Object.entries(system.objects).forEach(([id, payload]) => {
    const existing = index[id]
    const metadataChanged =
      !existing || existing.name !== payload.name || existing.objectType !== payload.type
    index[id] = {
      id,
      name: payload.name,
      objectType: payload.type,
      shard: existing?.shard ?? shardForEntityId(id),
      updatedAt: metadataChanged ? system.updatedAt : existing.updatedAt,
    }
  })
  return index
}

function ensureBranchIndex(system: System): Record<string, BranchIndexEntry> {
  const index = structuredClone(system.index?.branches ?? {})
  Object.entries(system.branches).forEach(([id, payload]) => {
    const existing = index[id]
    const metadataChanged =
      !existing ||
      existing.name !== payload.name ||
      existing.branchType !== payload.branchType ||
      existing.parentObjectId !== (payload.parentObjectId ?? null) ||
      existing.startObjectId !== (payload.startObjectId ?? null)
    index[id] = {
      id,
      name: payload.name,
      branchType: payload.branchType,
      parentObjectId: payload.parentObjectId ?? null,
      startObjectId: payload.startObjectId ?? null,
      shard: existing?.shard ?? shardForEntityId(id),
      updatedAt: metadataChanged ? system.updatedAt : existing.updatedAt,
    }
  })
  return index
}

function requireMetaRecord(raw: unknown): SystemMetaRecord['system'] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid system meta record.')
  }
  const record = raw as SystemMetaRecord
  if (record.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported system meta schema version: ${record.schemaVersion}`)
  }
  if (!record.system || typeof record.system !== 'object') {
    throw new Error('Invalid system meta record.')
  }
  return structuredClone(record.system)
}

function requireUiRecord(raw: unknown): SystemUiSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid system UI record.')
  }
  const record = raw as UiRecord
  if (record.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported system UI schema version: ${record.schemaVersion}`)
  }
  if (!record.ui || typeof record.ui !== 'object') {
    throw new Error('Invalid system UI record.')
  }
  return structuredClone(record.ui)
}

function requireIndexRecord<T>(raw: unknown): Record<string, T> {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const record = raw as IndexRecord<T>
  if (record.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    return {}
  }
  if (!record.entries || typeof record.entries !== 'object') {
    return {}
  }
  return structuredClone(record.entries)
}

function requirePayloadRecord<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as PayloadRecord<T>
  if (record.schemaVersion !== STORAGE_SCHEMA_VERSION) return null
  if (!record.payload || typeof record.payload !== 'object') return null
  return structuredClone(record.payload)
}

function readAll<T>(store: IDBObjectStore): Promise<{ keys: string[]; values: T[] }> {
  return Promise.all([requestToPromise(store.getAllKeys()), requestToPromise(store.getAll())]).then(
    ([keys, values]) => ({
      keys: keys.map((key) => String(key)),
      values: values as T[],
    })
  )
}

function buildSkeletonSystem(
  meta: SystemMetaRecord['system'],
  ui: SystemUiSnapshot,
  index: SystemIndex
): System {
  return normalizeSystem({
    id: meta.id,
    name: meta.name,
    config: meta.config,
    index,
    nodes: structuredClone(ui.nodes),
    rootIds: [...ui.rootIds],
    objects: {},
    branches: {},
    scenes: structuredClone(ui.scenes),
    bifurcationDiagrams: structuredClone(ui.bifurcationDiagrams),
    ui: structuredClone(ui.ui),
    updatedAt: meta.updatedAt,
  })
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
      const transaction = db.transaction(META_STORE, 'readonly')
      const metaStore = transaction.objectStore(META_STORE)
      const { values } = await readAll<SystemMetaRecord>(metaStore)
      await transactionDone(transaction)
      const summaries = values.map((value) => {
        const system = requireMetaRecord(value)
        return {
          id: system.id,
          name: system.name,
          updatedAt: system.updatedAt,
          type: system.config.type,
        } satisfies SystemSummary
      })
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } finally {
      db.close()
    }
  }

  async load(id: string): Promise<System> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction(
        [META_STORE, UI_STORE, OBJECT_INDEX_STORE, BRANCH_INDEX_STORE],
        'readonly'
      )
      const metaStore = transaction.objectStore(META_STORE)
      const uiStore = transaction.objectStore(UI_STORE)
      const objectIndexStore = transaction.objectStore(OBJECT_INDEX_STORE)
      const branchIndexStore = transaction.objectStore(BRANCH_INDEX_STORE)
      const [metaRaw, uiRaw, objectIndexRaw, branchIndexRaw] = await Promise.all([
        requestToPromise(metaStore.get(id)),
        requestToPromise(uiStore.get(id)),
        requestToPromise(objectIndexStore.get(id)),
        requestToPromise(branchIndexStore.get(id)),
      ])
      await transactionDone(transaction)
      if (!metaRaw || !uiRaw) {
        throw new Error(`System "${id}" not found`)
      }
      const meta = requireMetaRecord(metaRaw)
      const ui = requireUiRecord(uiRaw)
      const objectIndex = requireIndexRecord<ObjectIndexEntry>(objectIndexRaw)
      const branchIndex = requireIndexRecord<BranchIndexEntry>(branchIndexRaw)
      return buildSkeletonSystem(meta, ui, {
        objects: objectIndex,
        branches: branchIndex,
      })
    } finally {
      db.close()
    }
  }

  async loadEntities(
    systemId: string,
    objectIds: string[],
    branchIds: string[]
  ): Promise<LoadedEntities> {
    if (objectIds.length === 0 && branchIds.length === 0) {
      return { objects: {}, branches: {} }
    }
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([OBJECT_PAYLOAD_STORE, BRANCH_PAYLOAD_STORE], 'readonly')
      const objectPayloadStore = transaction.objectStore(OBJECT_PAYLOAD_STORE)
      const branchPayloadStore = transaction.objectStore(BRANCH_PAYLOAD_STORE)
      const objects: Record<string, AnalysisObject> = {}
      const branches: Record<string, ContinuationObject> = {}
      await Promise.all(
        objectIds.map(async (id) => {
          const raw = await requestToPromise(objectPayloadStore.get(objectPayloadKey(systemId, id)))
          const payload = requirePayloadRecord<AnalysisObject>(raw)
          if (!payload) return
          objects[id] = { ...payload, id } as AnalysisObject
        })
      )
      await Promise.all(
        branchIds.map(async (id) => {
          const raw = await requestToPromise(branchPayloadStore.get(branchPayloadKey(systemId, id)))
          const payload = requirePayloadRecord<ContinuationObject>(raw)
          if (!payload) return
          branches[id] = { ...payload, id }
        })
      )
      await transactionDone(transaction)
      return { objects, branches }
    } finally {
      db.close()
    }
  }

  async save(system: System): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    const objectIndex = ensureObjectIndex(system)
    const branchIndex = ensureBranchIndex(system)
    try {
      const readTx = db.transaction(
        [OBJECT_INDEX_STORE, BRANCH_INDEX_STORE, OBJECT_PAYLOAD_STORE, BRANCH_PAYLOAD_STORE],
        'readonly'
      )
      const existingObjectIndexRaw = await requestToPromise(
        readTx.objectStore(OBJECT_INDEX_STORE).get(system.id)
      )
      const existingBranchIndexRaw = await requestToPromise(
        readTx.objectStore(BRANCH_INDEX_STORE).get(system.id)
      )
      const objectPayloadStoreRead = readTx.objectStore(OBJECT_PAYLOAD_STORE)
      const branchPayloadStoreRead = readTx.objectStore(BRANCH_PAYLOAD_STORE)
      const existingObjectIndex = requireIndexRecord<ObjectIndexEntry>(existingObjectIndexRaw)
      const existingBranchIndex = requireIndexRecord<BranchIndexEntry>(existingBranchIndexRaw)

      const removedObjectIds = Object.keys(existingObjectIndex).filter((id) => !(id in objectIndex))
      const removedBranchIds = Object.keys(existingBranchIndex).filter((id) => !(id in branchIndex))
      const changedObjectIds = (
        await Promise.all(
          Object.entries(system.objects).map(async ([id, payload]) => {
            const existing = existingObjectIndex[id]
            if (!existing) return id
            const raw = await requestToPromise(objectPayloadStoreRead.get(objectPayloadKey(system.id, id)))
            const persisted = requirePayloadRecord<AnalysisObject>(raw)
            if (!persisted) return id
            const normalized = { ...structuredClone(payload), id } as AnalysisObject
            return JSON.stringify(persisted) === JSON.stringify(normalized) ? null : id
          })
        )
      ).filter((id): id is string => Boolean(id))
      const changedBranchIds = (
        await Promise.all(
          Object.entries(system.branches).map(async ([id, payload]) => {
            const existing = existingBranchIndex[id]
            if (!existing) return id
            const raw = await requestToPromise(branchPayloadStoreRead.get(branchPayloadKey(system.id, id)))
            const persisted = requirePayloadRecord<ContinuationObject>(raw)
            if (!persisted) return id
            const normalized = { ...structuredClone(payload), id }
            return JSON.stringify(persisted) === JSON.stringify(normalized) ? null : id
          })
        )
      ).filter((id): id is string => Boolean(id))
      await transactionDone(readTx)

      const writeTx = db.transaction(
        [
          META_STORE,
          UI_STORE,
          OBJECT_INDEX_STORE,
          BRANCH_INDEX_STORE,
          OBJECT_PAYLOAD_STORE,
          BRANCH_PAYLOAD_STORE,
        ],
        'readwrite'
      )
      writeTx.objectStore(META_STORE).put(buildMetaRecord(system), system.id)
      writeTx.objectStore(UI_STORE).put(buildUiRecord(system), system.id)
      writeTx.objectStore(OBJECT_INDEX_STORE).put(buildObjectIndexRecord(objectIndex), system.id)
      writeTx.objectStore(BRANCH_INDEX_STORE).put(buildBranchIndexRecord(branchIndex), system.id)

      const objectPayloadStore = writeTx.objectStore(OBJECT_PAYLOAD_STORE)
      const branchPayloadStore = writeTx.objectStore(BRANCH_PAYLOAD_STORE)
      changedObjectIds.forEach((id) => {
        const payload = system.objects[id]
        if (!payload) return
        objectPayloadStore.put(
          {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            payload: { ...structuredClone(payload), id },
          } satisfies PayloadRecord<AnalysisObject>,
          objectPayloadKey(system.id, id)
        )
      })
      changedBranchIds.forEach((id) => {
        const payload = system.branches[id]
        if (!payload) return
        branchPayloadStore.put(
          {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            payload: { ...structuredClone(payload), id },
          } satisfies PayloadRecord<ContinuationObject>,
          branchPayloadKey(system.id, id)
        )
      })
      removedObjectIds.forEach((id) => {
        objectPayloadStore.delete(objectPayloadKey(system.id, id))
      })
      removedBranchIds.forEach((id) => {
        branchPayloadStore.delete(branchPayloadKey(system.id, id))
      })
      await transactionDone(writeTx)
    } finally {
      db.close()
    }
  }

  async saveUi(system: System): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction([META_STORE, UI_STORE], 'readwrite')
      const metaStore = transaction.objectStore(META_STORE)
      const existingMetaRaw = await requestToPromise(metaStore.get(system.id))
      if (existingMetaRaw) {
        const existingMeta = requireMetaRecord(existingMetaRaw)
        const mergedMeta: System = {
          ...system,
          name: existingMeta.name,
          config: existingMeta.config,
          updatedAt:
            existingMeta.updatedAt.localeCompare(system.updatedAt) > 0
              ? existingMeta.updatedAt
              : system.updatedAt,
        }
        metaStore.put(buildMetaRecord(mergedMeta), system.id)
      } else {
        metaStore.put(buildMetaRecord(system), system.id)
      }
      transaction.objectStore(UI_STORE).put(buildUiRecord(system), system.id)
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }

  async exportSystemArchive(systemId: string): Promise<{ filename: string; blob: Blob }> {
    const skeleton = await this.load(systemId)
    const entities = await this.loadEntities(
      systemId,
      Object.keys(skeleton.index.objects),
      Object.keys(skeleton.index.branches)
    )
    const fullSystem = normalizeSystem({
      ...skeleton,
      objects: entities.objects,
      branches: entities.branches,
      index: skeleton.index ?? emptySystemIndex(),
    })
    return {
      filename: `${fullSystem.name || 'fork_system'}.zip`,
      blob: buildSystemArchiveBlob(fullSystem),
    }
  }

  async importSystemArchive(file: File): Promise<System> {
    const system = await parseSystemArchiveFile(file)
    await this.save(system)
    return await this.load(system.id)
  }

  async remove(id: string): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const readTx = db.transaction([OBJECT_INDEX_STORE, BRANCH_INDEX_STORE], 'readonly')
      const existingObjectIndexRaw = await requestToPromise(readTx.objectStore(OBJECT_INDEX_STORE).get(id))
      const existingBranchIndexRaw = await requestToPromise(readTx.objectStore(BRANCH_INDEX_STORE).get(id))
      await transactionDone(readTx)
      const objectIndex = requireIndexRecord<ObjectIndexEntry>(existingObjectIndexRaw)
      const branchIndex = requireIndexRecord<BranchIndexEntry>(existingBranchIndexRaw)

      const writeTx = db.transaction(
        [META_STORE, UI_STORE, OBJECT_INDEX_STORE, BRANCH_INDEX_STORE, OBJECT_PAYLOAD_STORE, BRANCH_PAYLOAD_STORE],
        'readwrite'
      )
      writeTx.objectStore(META_STORE).delete(id)
      writeTx.objectStore(UI_STORE).delete(id)
      writeTx.objectStore(OBJECT_INDEX_STORE).delete(id)
      writeTx.objectStore(BRANCH_INDEX_STORE).delete(id)
      const objectPayloadStore = writeTx.objectStore(OBJECT_PAYLOAD_STORE)
      const branchPayloadStore = writeTx.objectStore(BRANCH_PAYLOAD_STORE)
      Object.keys(objectIndex).forEach((objectId) => {
        objectPayloadStore.delete(objectPayloadKey(id, objectId))
      })
      Object.keys(branchIndex).forEach((branchId) => {
        branchPayloadStore.delete(branchPayloadKey(id, branchId))
      })
      await transactionDone(writeTx)
    } finally {
      db.close()
    }
  }

  async clear(): Promise<void> {
    const db = await openDatabase(this.dbName, this.dbVersion)
    try {
      const transaction = db.transaction(
        [META_STORE, UI_STORE, OBJECT_INDEX_STORE, BRANCH_INDEX_STORE, OBJECT_PAYLOAD_STORE, BRANCH_PAYLOAD_STORE],
        'readwrite'
      )
      transaction.objectStore(META_STORE).clear()
      transaction.objectStore(UI_STORE).clear()
      transaction.objectStore(OBJECT_INDEX_STORE).clear()
      transaction.objectStore(BRANCH_INDEX_STORE).clear()
      transaction.objectStore(OBJECT_PAYLOAD_STORE).clear()
      transaction.objectStore(BRANCH_PAYLOAD_STORE).clear()
      await transactionDone(transaction)
    } finally {
      db.close()
    }
  }
}
