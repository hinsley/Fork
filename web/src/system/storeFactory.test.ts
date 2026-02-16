import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { System, SystemSummary } from './types'
import type { SystemStore } from './store'
import { MemorySystemStore } from './store'
import { MEMORY_FALLBACK_WARNING, createBrowserSystemStore, selectStoreWithDefaults } from './storeFactory'
import { DEFAULT_SYSTEMS_SEEDED_KEY } from './seedDefaults'

class FailingStore implements SystemStore {
  async list(): Promise<SystemSummary[]> {
    throw new Error('fail')
  }
  async load(): Promise<System> {
    throw new Error('fail')
  }
  async save(): Promise<void> {
    throw new Error('fail')
  }
  async saveUi(): Promise<void> {
    throw new Error('fail')
  }
  async loadEntities(): Promise<{ objects: Record<string, never>; branches: Record<string, never> }> {
    throw new Error('fail')
  }
  async exportSystemArchive(): Promise<{ filename: string; blob: Blob }> {
    throw new Error('fail')
  }
  async importSystemArchive(): Promise<System> {
    throw new Error('fail')
  }
  async remove(): Promise<void> {
    throw new Error('fail')
  }
  async clear(): Promise<void> {
    throw new Error('fail')
  }
}

class TestStore implements SystemStore {
  private systems = new Map<string, System>()
  async list(): Promise<SystemSummary[]> {
    return Array.from(this.systems.values()).map((system) => ({
      id: system.id,
      name: system.name,
      updatedAt: system.updatedAt,
      type: system.config.type,
    }))
  }
  async load(id: string): Promise<System> {
    const system = this.systems.get(id)
    if (!system) throw new Error('Missing system')
    return structuredClone(system)
  }
  async save(system: System): Promise<void> {
    this.systems.set(system.id, structuredClone(system))
  }
  async saveUi(system: System): Promise<void> {
    this.systems.set(system.id, structuredClone(system))
  }
  async loadEntities(
    systemId: string,
    objectIds: string[],
    branchIds: string[]
  ): Promise<{ objects: Record<string, never>; branches: Record<string, never> }> {
    void systemId
    void objectIds
    void branchIds
    return { objects: {}, branches: {} }
  }
  async exportSystemArchive(): Promise<{ filename: string; blob: Blob }> {
    return { filename: 'test.zip', blob: new Blob() }
  }
  async importSystemArchive(): Promise<System> {
    throw new Error('Missing system')
  }
  async remove(id: string): Promise<void> {
    this.systems.delete(id)
  }
  async clear(): Promise<void> {
    this.systems.clear()
  }
}

class VolatileStore implements SystemStore {
  async list(): Promise<SystemSummary[]> {
    return []
  }
  async load(): Promise<System> {
    throw new Error('Missing system')
  }
  async save(): Promise<void> {
    // Intentionally drop writes to simulate non-persistent storage.
  }
  async saveUi(): Promise<void> {
    // Intentionally drop writes to simulate non-persistent storage.
  }
  async loadEntities(): Promise<{ objects: Record<string, never>; branches: Record<string, never> }> {
    return { objects: {}, branches: {} }
  }
  async exportSystemArchive(): Promise<{ filename: string; blob: Blob }> {
    return { filename: 'volatile.zip', blob: new Blob() }
  }
  async importSystemArchive(): Promise<System> {
    throw new Error('Missing system')
  }
  async remove(): Promise<void> {
    // No-op.
  }
  async clear(): Promise<void> {
    // No-op.
  }
}

describe('selectStoreWithDefaults', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns a warning when memory storage is used', async () => {
    const store = new MemorySystemStore()
    const result = await selectStoreWithDefaults([store], true)
    expect(result.store).toBe(store)
    expect(result.warning).toBe(MEMORY_FALLBACK_WARNING)
  })

  it('does not warn when warned disabled for memory storage', async () => {
    const store = new MemorySystemStore()
    const result = await selectStoreWithDefaults([store], false)
    expect(result.warning).toBeNull()
  })

  it('falls back to memory when earlier stores fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memory = new MemorySystemStore()
    const result = await selectStoreWithDefaults([new FailingStore(), memory], true)
    expect(result.store).toBe(memory)
    expect(result.warning).toBe(MEMORY_FALLBACK_WARNING)
    warnSpy.mockRestore()
  })

  it('falls back when a store fails to persist defaults', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memory = new MemorySystemStore()
    const result = await selectStoreWithDefaults([new VolatileStore(), memory], true)
    expect(result.store).toBe(memory)
    expect(result.warning).toBe(MEMORY_FALLBACK_WARNING)
    warnSpy.mockRestore()
  })

  it('warns when persistent storage is empty after being marked seeded', async () => {
    localStorage.setItem(DEFAULT_SYSTEMS_SEEDED_KEY, '1')
    const result = await selectStoreWithDefaults([new TestStore()], true)
    expect(result.warning).toBe(MEMORY_FALLBACK_WARNING)
  })

  it('does not warn when a persistent store succeeds', async () => {
    const result = await selectStoreWithDefaults([new TestStore()], true)
    expect(result.warning).toBeNull()
  })
})

describe('createBrowserSystemStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('warns when only memory storage is available', async () => {
    const result = await createBrowserSystemStore({
      deterministic: false,
      warnOnMemory: true,
      support: { opfs: false, indexedDb: false },
    })

    expect(result.store).toBeInstanceOf(MemorySystemStore)
    expect(result.warning).toBe(MEMORY_FALLBACK_WARNING)
  })
})
