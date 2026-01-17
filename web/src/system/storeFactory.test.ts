import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserSystemStore } from './storeFactory'
import { MemorySystemStore } from './store'
import { OpfsSystemStore } from './opfs'
import { IdbSystemStore } from './indexedDb'
import * as opfs from './opfs'
import * as indexedDb from './indexedDb'

describe('createBrowserSystemStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns memory storage in deterministic mode', async () => {
    const store = await createBrowserSystemStore(true)
    expect(store).toBeInstanceOf(MemorySystemStore)
  })

  it('prefers OPFS when supported', async () => {
    vi.spyOn(opfs, 'supportsOpfs').mockReturnValue(true)

    const store = await createBrowserSystemStore(false)

    expect(store).toBeInstanceOf(OpfsSystemStore)
  })

  it('falls back to IndexedDB when OPFS is unavailable', async () => {
    vi.spyOn(opfs, 'supportsOpfs').mockReturnValue(false)
    vi.spyOn(indexedDb, 'supportsIndexedDb').mockReturnValue(true)

    const store = await createBrowserSystemStore(false)

    expect(store).toBeInstanceOf(IdbSystemStore)
    if (store instanceof IdbSystemStore) {
      await store.close()
    }
  })

  it('falls back to memory when IndexedDB creation fails', async () => {
    vi.spyOn(opfs, 'supportsOpfs').mockReturnValue(false)
    vi.spyOn(indexedDb, 'supportsIndexedDb').mockReturnValue(true)
    vi.spyOn(IdbSystemStore, 'create').mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = await createBrowserSystemStore(false)

    expect(store).toBeInstanceOf(MemorySystemStore)
    warnSpy.mockRestore()
  })
})
