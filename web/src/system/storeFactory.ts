import { IndexedDbSystemStore } from './indexedDb'
import { OpfsSystemStore, supportsOpfs } from './opfs'
import { seedDefaultSystems } from './seedDefaults'
import { MemorySystemStore, type SystemStore } from './store'

export const MEMORY_FALLBACK_WARNING =
  "Local storage isn't available, so work will be discarded when the page is reloaded."

type StoreSupport = {
  opfs: boolean
  indexedDb: boolean
}

export type StoreSelection = {
  store: SystemStore
  warning: string | null
}

function detectStoreSupport(): StoreSupport {
  if (typeof window === 'undefined') {
    return { opfs: false, indexedDb: false }
  }
  return {
    opfs: supportsOpfs(),
    indexedDb: 'indexedDB' in window,
  }
}

function buildStoreCandidates(options: {
  deterministic: boolean
  support: StoreSupport
}): SystemStore[] {
  if (options.deterministic) {
    return [new MemorySystemStore()]
  }
  const candidates: SystemStore[] = []
  if (options.support.opfs) {
    candidates.push(new OpfsSystemStore())
  }
  if (options.support.indexedDb) {
    candidates.push(new IndexedDbSystemStore())
  }
  candidates.push(new MemorySystemStore())
  return candidates
}

export function getBrowserStoreCandidates(options: {
  deterministic: boolean
  support?: StoreSupport
}): SystemStore[] {
  const support = options.support ?? detectStoreSupport()
  return buildStoreCandidates({ deterministic: options.deterministic, support })
}

export async function selectStoreWithDefaults(
  candidates: SystemStore[],
  warnOnMemory: boolean
): Promise<StoreSelection> {
  let lastError: unknown = null
  for (const store of candidates) {
    try {
      const seedResult = await seedDefaultSystems(store, {
        persistSeedFlag: !(store instanceof MemorySystemStore),
      })
      if (seedResult.seeded) {
        const seededSystems = await store.list()
        if (seededSystems.length === 0) {
          throw new Error('System store did not persist defaults.')
        }
      }
      if (lastError) {
        console.warn('[SystemStore] Using fallback storage', lastError)
      }
      return {
        store,
        warning:
          warnOnMemory &&
          (store instanceof MemorySystemStore || seedResult.storageCleared)
            ? MEMORY_FALLBACK_WARNING
            : null,
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('No system storage available.')
}

export async function createBrowserSystemStore(options: {
  deterministic: boolean
  warnOnMemory: boolean
  support?: StoreSupport
}): Promise<StoreSelection> {
  const candidates = getBrowserStoreCandidates({
    deterministic: options.deterministic,
    support: options.support,
  })
  const warnOnMemory = options.warnOnMemory && !options.deterministic
  return await selectStoreWithDefaults(candidates, warnOnMemory)
}
