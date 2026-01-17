import { OpfsSystemStore, supportsOpfs } from './opfs'
import { IdbSystemStore, supportsIndexedDb } from './indexedDb'
import { MemorySystemStore, type SystemStore } from './store'

export async function createBrowserSystemStore(
  deterministic: boolean
): Promise<SystemStore> {
  if (deterministic) return new MemorySystemStore()
  if (supportsOpfs()) return new OpfsSystemStore()

  if (supportsIndexedDb()) {
    try {
      return await IdbSystemStore.create()
    } catch (error) {
      console.warn('[storage] IndexedDB unavailable, falling back to memory.', error)
    }
  }

  return new MemorySystemStore()
}
