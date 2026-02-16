import { describe, expect, it } from 'vitest'
import { IndexedDbSystemStore } from './indexedDb'
import { addObject, createSystem, updateLayout, updateObject, updateSystem } from './model'
import type { OrbitObject } from './types'

async function createLegacyDb(name: string, version = 1): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('systems')) {
        db.createObjectStore('systems', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open legacy IndexedDB'))
  })
}

async function deleteDb(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to delete IndexedDB'))
  })
}

function makeStore() {
  const nonce = Math.random().toString(16).slice(2)
  return new IndexedDbSystemStore({ name: `fork-test-${Date.now()}-${nonce}` })
}

async function readObjectPayloadRecord(
  dbName: string,
  systemId: string,
  objectId: string
): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 3)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB for inspection'))
  })
  try {
    const tx = db.transaction('object-payload', 'readonly')
    const store = tx.objectStore('object-payload')
    const key = `${systemId}:${objectId}`
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(request.error ?? new Error('Failed to read payload inspection key'))
    })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Inspection transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Inspection transaction aborted'))
    })
    return structuredClone(value)
  } finally {
    db.close()
  }
}

describe('IndexedDbSystemStore', () => {
  it('upgrades legacy databases without breaking persistence', async () => {
    const name = `fork-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await createLegacyDb(name)
    const store = new IndexedDbSystemStore({ name })
    try {
      const systems = await store.list()
      expect(systems).toEqual([])
    } finally {
      await store.clear()
      await deleteDb(name)
    }
  })

  it('recreates databases when a newer schema version exists', async () => {
    const name = `fork-version-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await createLegacyDb(name, 5)
    const store = new IndexedDbSystemStore({ name })
    const system = createSystem({ name: 'IndexedDB_Recreate' })
    try {
      await store.save(system)
      const loaded = await store.load(system.id)
      expect(loaded.name).toBe('IndexedDB_Recreate')
      const summaries = await store.list()
      expect(summaries).toHaveLength(1)
    } finally {
      await store.clear()
      await deleteDb(name)
    }
  })

  it('keeps data when saveUi runs after a newer data save', async () => {
    const store = makeStore()
    try {
      const base = createSystem({ name: 'IndexedDB_System' })
      await store.save(base)

      const updated = updateSystem(base, { ...base.config, name: 'IndexedDB_System_Updated' })
      await store.save(updated)

      const uiOnly = updateLayout(base, {
        leftWidth: base.ui.layout.leftWidth + 20,
      })
      await store.saveUi(uiOnly)

      const loaded = await store.load(base.id)
      expect(loaded.name).toBe('IndexedDB_System_Updated')
      expect(loaded.ui.layout.leftWidth).toBe(uiOnly.ui.layout.leftWidth)
    } finally {
      await store.clear()
    }
  })

  it('preserves untouched payload records when saving a single edited entity', async () => {
    const store = makeStore()
    try {
      const base = createSystem({ name: 'IndexedDB_Diff' })
      const orbitA: OrbitObject = {
        type: 'orbit',
        name: 'Orbit_A',
        systemName: base.config.name,
        data: [[0, 0, 0]],
        t_start: 0,
        t_end: 0,
        dt: 0.1,
      }
      const orbitB: OrbitObject = {
        type: 'orbit',
        name: 'Orbit_B',
        systemName: base.config.name,
        data: [[0, 1, 0]],
        t_start: 0,
        t_end: 0,
        dt: 0.1,
      }
      const withA = addObject(base, orbitA)
      const withB = addObject(withA.system, orbitB)
      await store.save(withB.system)

      const dbName = (store as unknown as { dbName: string }).dbName
      const beforeB = await readObjectPayloadRecord(dbName, withB.system.id, withB.nodeId)

      const edited = updateObject(withB.system, withA.nodeId, { name: 'Orbit_A_Updated' })
      await store.save(edited)

      const afterA = await readObjectPayloadRecord(dbName, edited.id, withA.nodeId)
      const afterB = await readObjectPayloadRecord(dbName, edited.id, withB.nodeId)

      expect(afterA).not.toEqual(null)
      expect(afterB).toEqual(beforeB)
    } finally {
      await store.clear()
    }
  })
})
