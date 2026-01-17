import { describe, expect, it } from 'vitest'
import { IdbSystemStore } from './indexedDb'
import { createAxisPickerSystem, createDemoSystem } from './fixtures'

let dbCounter = 0

async function createStore() {
  dbCounter += 1
  return await IdbSystemStore.create({ dbName: `fork-test-${dbCounter}` })
}

describe('IdbSystemStore', () => {
  it('saves and loads systems', async () => {
    const store = await createStore()
    const { system } = createDemoSystem()

    await store.save(system)
    const loaded = await store.load(system.id)

    expect(loaded).toEqual(system)
    await store.close()
  })

  it('updates UI snapshots without overwriting core data', async () => {
    const store = await createStore()
    const { system } = createDemoSystem()

    await store.save(system)

    const updated = {
      ...system,
      updatedAt: '2024-01-02T00:00:00.000Z',
      ui: {
        ...system.ui,
        layout: {
          ...system.ui.layout,
          leftWidth: system.ui.layout.leftWidth + 10,
        },
      },
    }

    await store.saveUi(updated)
    const loaded = await store.load(system.id)

    expect(loaded.ui.layout.leftWidth).toBe(updated.ui.layout.leftWidth)
    expect(loaded.config).toEqual(system.config)
    await store.close()
  })

  it('lists systems by latest update time', async () => {
    const store = await createStore()
    const { system: first } = createDemoSystem()
    const { system: second } = createAxisPickerSystem()

    first.updatedAt = '2024-01-01T00:00:00.000Z'
    second.updatedAt = '2024-01-02T00:00:00.000Z'

    await store.save(first)
    await store.save(second)

    const updatedFirst = {
      ...first,
      updatedAt: '2024-01-03T00:00:00.000Z',
      ui: {
        ...first.ui,
        layout: {
          ...first.ui.layout,
          rightWidth: first.ui.layout.rightWidth + 15,
        },
      },
    }

    await store.saveUi(updatedFirst)
    const list = await store.list()

    expect(list[0].id).toBe(first.id)
    expect(list[0].updatedAt).toBe(updatedFirst.updatedAt)
    expect(list[1].id).toBe(second.id)
    await store.close()
  })

  it('removes systems and clears storage', async () => {
    const store = await createStore()
    const { system: first } = createDemoSystem()
    const { system: second } = createAxisPickerSystem()

    await store.save(first)
    await store.save(second)

    await store.remove(first.id)
    expect(await store.list()).toHaveLength(1)

    await store.clear()
    expect(await store.list()).toHaveLength(0)
    await store.close()
  })
})
