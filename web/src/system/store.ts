import type { System, SystemSummary } from './types'

export interface SystemStore {
  list(): Promise<SystemSummary[]>
  load(id: string): Promise<System>
  save(system: System): Promise<void>
  saveUi(system: System): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export class MemorySystemStore implements SystemStore {
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
    if (!system) {
      throw new Error(`System "${id}" not found`)
    }
    return structuredClone(system)
  }

  async save(system: System): Promise<void> {
    this.systems.set(system.id, structuredClone(system))
  }

  async saveUi(system: System): Promise<void> {
    const existing = this.systems.get(system.id)
    if (!existing) {
      this.systems.set(system.id, structuredClone(system))
      return
    }
    const next = structuredClone(existing)
    next.nodes = structuredClone(system.nodes)
    next.rootIds = [...system.rootIds]
    next.scenes = structuredClone(system.scenes)
    next.bifurcationDiagrams = structuredClone(system.bifurcationDiagrams)
    next.ui = structuredClone(system.ui)
    next.updatedAt = system.updatedAt
    this.systems.set(system.id, next)
  }

  async remove(id: string): Promise<void> {
    this.systems.delete(id)
  }

  async clear(): Promise<void> {
    this.systems.clear()
  }
}
