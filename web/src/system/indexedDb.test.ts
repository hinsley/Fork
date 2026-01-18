import { describe, expect, it } from 'vitest'
import { IndexedDbSystemStore } from './indexedDb'
import { createSystem, updateLayout, updateSystem } from './model'

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
})
