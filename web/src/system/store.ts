import type {
  AnalysisObject,
  ContinuationObject,
  System,
  SystemSummary,
} from './types'
import { buildSystemArchiveBlob, parseSystemArchiveFile } from './archive'

export type LoadedEntities = {
  objects: Record<string, AnalysisObject>
  branches: Record<string, ContinuationObject>
}

export interface SystemStore {
  list(): Promise<SystemSummary[]>
  load(id: string): Promise<System>
  loadEntities(systemId: string, objectIds: string[], branchIds: string[]): Promise<LoadedEntities>
  save(system: System): Promise<void>
  saveUi(system: System): Promise<void>
  exportSystemArchive(systemId: string): Promise<{ filename: string; blob: Blob }>
  importSystemArchive(file: File): Promise<System>
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

  async loadEntities(
    systemId: string,
    objectIds: string[],
    branchIds: string[]
  ): Promise<LoadedEntities> {
    const system = this.systems.get(systemId)
    if (!system) {
      throw new Error(`System "${systemId}" not found`)
    }
    const objects: Record<string, AnalysisObject> = {}
    const branches: Record<string, ContinuationObject> = {}
    objectIds.forEach((id) => {
      const entry = system.objects[id]
      if (entry) {
        objects[id] = structuredClone(entry)
      }
    })
    branchIds.forEach((id) => {
      const entry = system.branches[id]
      if (entry) {
        branches[id] = structuredClone(entry)
      }
    })
    return { objects, branches }
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

  async exportSystemArchive(systemId: string): Promise<{ filename: string; blob: Blob }> {
    const system = this.systems.get(systemId)
    if (!system) {
      throw new Error(`System "${systemId}" not found`)
    }
    const blob = buildSystemArchiveBlob(structuredClone(system))
    return {
      filename: `${system.name || 'fork_system'}.zip`,
      blob,
    }
  }

  async importSystemArchive(file: File): Promise<System> {
    const system = await parseSystemArchiveFile(file)
    this.systems.set(system.id, structuredClone(system))
    return structuredClone(system)
  }

  async remove(id: string): Promise<void> {
    this.systems.delete(id)
  }

  async clear(): Promise<void> {
    this.systems.clear()
  }
}
