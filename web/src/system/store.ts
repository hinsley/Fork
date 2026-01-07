import type { System, SystemSummary } from './types'

export interface SystemStore {
  list(): Promise<SystemSummary[]>
  load(id: string): Promise<System>
  save(system: System): Promise<void>
  remove(id: string): Promise<void>
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

  async remove(id: string): Promise<void> {
    this.systems.delete(id)
  }
}
