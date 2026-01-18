import { createDefaultSystems } from './defaultSystems'
import type { SystemStore } from './store'

export const DEFAULT_SYSTEMS_SEEDED_KEY = 'fork-default-systems-seeded'

type SeedDefaultsOptions = {
  persistSeedFlag: boolean
}

type SeedDefaultsResult = {
  seeded: boolean
  storageCleared: boolean
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  if (!('localStorage' in window)) return null
  if (typeof window.localStorage.getItem !== 'function') return null
  return window.localStorage
}

function hasSeededDefaultSystems(): boolean {
  const storage = getLocalStorage()
  if (!storage) return false
  return storage.getItem(DEFAULT_SYSTEMS_SEEDED_KEY) === '1'
}

function markDefaultSystemsSeeded() {
  const storage = getLocalStorage()
  if (!storage) return
  storage.setItem(DEFAULT_SYSTEMS_SEEDED_KEY, '1')
}

export async function seedDefaultSystems(
  store: SystemStore,
  options: SeedDefaultsOptions
): Promise<SeedDefaultsResult> {
  const seedFlagged = options.persistSeedFlag && hasSeededDefaultSystems()
  const existing = await store.list()
  const isEmpty = existing.length === 0
  if (isEmpty) {
    const defaults = createDefaultSystems()
    for (const system of defaults) {
      await store.save(system)
    }
  }
  if (options.persistSeedFlag) {
    markDefaultSystemsSeeded()
  }
  return {
    seeded: isEmpty,
    storageCleared: seedFlagged && isEmpty,
  }
}
