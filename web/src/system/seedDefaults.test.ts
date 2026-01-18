import { beforeEach, describe, expect, it } from 'vitest'
import { createSystem } from './model'
import { MemorySystemStore } from './store'
import { DEFAULT_SYSTEMS_SEEDED_KEY, seedDefaultSystems } from './seedDefaults'

describe('seedDefaultSystems', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('seeds defaults for non-persistent stores even if flagged', async () => {
    localStorage.setItem(DEFAULT_SYSTEMS_SEEDED_KEY, '1')
    const store = new MemorySystemStore()
    await seedDefaultSystems(store, { persistSeedFlag: false })
    const systems = await store.list()
    expect(systems.length).toBeGreaterThan(0)
  })

  it('does not set the seed flag for non-persistent stores', async () => {
    const store = new MemorySystemStore()
    await seedDefaultSystems(store, { persistSeedFlag: false })
    expect(localStorage.getItem(DEFAULT_SYSTEMS_SEEDED_KEY)).toBeNull()
  })

  it('re-seeds defaults for persistent stores when the flag is set but store is empty', async () => {
    localStorage.setItem(DEFAULT_SYSTEMS_SEEDED_KEY, '1')
    const store = new MemorySystemStore()
    await seedDefaultSystems(store, { persistSeedFlag: true })
    const systems = await store.list()
    expect(systems.length).toBeGreaterThan(0)
  })

  it('does not seed defaults when a persistent store already has systems', async () => {
    const store = new MemorySystemStore()
    await store.save(createSystem({ name: 'Existing' }))
    await seedDefaultSystems(store, { persistSeedFlag: true })
    const systems = await store.list()
    expect(systems).toHaveLength(1)
  })

  it('sets the seed flag after seeding persistent stores', async () => {
    const store = new MemorySystemStore()
    await seedDefaultSystems(store, { persistSeedFlag: true })
    expect(localStorage.getItem(DEFAULT_SYSTEMS_SEEDED_KEY)).toBe('1')
  })
})
