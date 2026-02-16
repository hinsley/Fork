import { buildSystemArchiveBlob, parseSystemArchiveFile } from './archive'
import { emptySystemIndex, normalizeSystem, shardForEntityId } from './model'
import type { LoadedEntities, SystemStore } from './store'
import type {
  AnalysisObject,
  BranchIndexEntry,
  ContinuationObject,
  ObjectIndexEntry,
  System,
  SystemConfig,
  SystemIndex,
  SystemSummary,
  SystemUiSnapshot,
} from './types'

const STORAGE_SCHEMA_VERSION = 1
const SYSTEMS_DIR = 'fork-systems-v3'
const MANIFEST_FILE = 'manifest.json'
const SYSTEM_FILE = 'system.json'
const UI_FILE = 'ui.json'
const INDEX_DIR = 'index'
const OBJECT_INDEX_FILE = 'objects.json'
const BRANCH_INDEX_FILE = 'branches.json'
const OBJECTS_DIR = 'objects'
const BRANCHES_DIR = 'branches'

type ManifestBundle = {
  schemaVersion: number
  summary: SystemSummary
}

type SystemMetaBundle = {
  schemaVersion: number
  system: {
    id: string
    name: string
    config: SystemConfig
    updatedAt: string
  }
}

type UiBundle = {
  schemaVersion: number
  ui: SystemUiSnapshot
}

type IndexBundle<T> = {
  schemaVersion: number
  entries: Record<string, T>
}

type EntityBundle<T> = {
  schemaVersion: number
  payload: T
}

export function supportsOpfs(): boolean {
  if (typeof window === 'undefined') return false
  if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) return false
  const handle = (globalThis as {
    FileSystemFileHandle?: { prototype?: { createWritable?: unknown } }
  }).FileSystemFileHandle
  return typeof handle?.prototype?.createWritable === 'function'
}

async function getRootDirectory() {
  if (!supportsOpfs()) {
    throw new Error('OPFS not supported in this browser')
  }
  return await navigator.storage.getDirectory()
}

async function getSystemsDirectory(create = true) {
  const root = await getRootDirectory()
  return await root.getDirectoryHandle(SYSTEMS_DIR, { create })
}

async function getSystemDirectory(systemId: string, create = true) {
  const systemsDir = await getSystemsDirectory(create)
  return await systemsDir.getDirectoryHandle(systemId, { create })
}

async function readJsonFile<T>(dir: FileSystemDirectoryHandle, filename: string): Promise<T> {
  const fileHandle = await dir.getFileHandle(filename)
  const file = await fileHandle.getFile()
  return JSON.parse(await file.text()) as T
}

async function readJsonFileOrNull<T>(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<T | null> {
  try {
    return await readJsonFile<T>(dir, filename)
  } catch {
    return null
  }
}

async function writeJsonFile(dir: FileSystemDirectoryHandle, filename: string, payload: unknown) {
  const fileHandle = await dir.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(payload, null, 2))
  await writable.close()
}

async function readManifest(dir: FileSystemDirectoryHandle): Promise<SystemSummary | null> {
  const bundle = await readJsonFileOrNull<ManifestBundle>(dir, MANIFEST_FILE)
  if (!bundle) return null
  if (bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) return null
  return bundle.summary
}

async function writeManifest(dir: FileSystemDirectoryHandle, summary: SystemSummary) {
  const bundle: ManifestBundle = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    summary,
  }
  await writeJsonFile(dir, MANIFEST_FILE, bundle)
}

async function readSystemMeta(
  dir: FileSystemDirectoryHandle
): Promise<SystemMetaBundle['system']> {
  const bundle = await readJsonFile<SystemMetaBundle>(dir, SYSTEM_FILE)
  if (bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported OPFS schema version: ${bundle.schemaVersion}`)
  }
  return bundle.system
}

async function writeSystemMeta(dir: FileSystemDirectoryHandle, system: System) {
  const bundle: SystemMetaBundle = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    system: {
      id: system.id,
      name: system.name,
      config: structuredClone(system.config),
      updatedAt: system.updatedAt,
    },
  }
  await writeJsonFile(dir, SYSTEM_FILE, bundle)
}

async function readUi(dir: FileSystemDirectoryHandle): Promise<SystemUiSnapshot> {
  const bundle = await readJsonFile<UiBundle>(dir, UI_FILE)
  if (bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported OPFS UI schema version: ${bundle.schemaVersion}`)
  }
  return bundle.ui
}

async function writeUi(dir: FileSystemDirectoryHandle, system: System) {
  const bundle: UiBundle = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    ui: {
      systemId: system.id,
      updatedAt: system.updatedAt,
      nodes: structuredClone(system.nodes),
      rootIds: [...system.rootIds],
      scenes: structuredClone(system.scenes),
      bifurcationDiagrams: structuredClone(system.bifurcationDiagrams),
      ui: structuredClone(system.ui),
    },
  }
  await writeJsonFile(dir, UI_FILE, bundle)
}

async function getIndexDirectory(
  systemDir: FileSystemDirectoryHandle,
  create = true
): Promise<FileSystemDirectoryHandle> {
  return await systemDir.getDirectoryHandle(INDEX_DIR, { create })
}

async function readObjectIndex(
  systemDir: FileSystemDirectoryHandle
): Promise<Record<string, ObjectIndexEntry>> {
  const indexDir = await getIndexDirectory(systemDir, false).catch(() => null)
  if (!indexDir) return {}
  const bundle = await readJsonFileOrNull<IndexBundle<ObjectIndexEntry>>(indexDir, OBJECT_INDEX_FILE)
  if (!bundle || bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) return {}
  return bundle.entries
}

async function readBranchIndex(
  systemDir: FileSystemDirectoryHandle
): Promise<Record<string, BranchIndexEntry>> {
  const indexDir = await getIndexDirectory(systemDir, false).catch(() => null)
  if (!indexDir) return {}
  const bundle = await readJsonFileOrNull<IndexBundle<BranchIndexEntry>>(indexDir, BRANCH_INDEX_FILE)
  if (!bundle || bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) return {}
  return bundle.entries
}

async function writeObjectIndex(
  systemDir: FileSystemDirectoryHandle,
  entries: Record<string, ObjectIndexEntry>
) {
  const indexDir = await getIndexDirectory(systemDir, true)
  const bundle: IndexBundle<ObjectIndexEntry> = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    entries,
  }
  await writeJsonFile(indexDir, OBJECT_INDEX_FILE, bundle)
}

async function writeBranchIndex(
  systemDir: FileSystemDirectoryHandle,
  entries: Record<string, BranchIndexEntry>
) {
  const indexDir = await getIndexDirectory(systemDir, true)
  const bundle: IndexBundle<BranchIndexEntry> = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    entries,
  }
  await writeJsonFile(indexDir, BRANCH_INDEX_FILE, bundle)
}

async function getEntityShardDirectory(
  systemDir: FileSystemDirectoryHandle,
  rootDirName: string,
  shard: string,
  create = true
): Promise<FileSystemDirectoryHandle> {
  const root = await systemDir.getDirectoryHandle(rootDirName, { create })
  return await root.getDirectoryHandle(shard, { create })
}

async function writeObjectPayload(
  systemDir: FileSystemDirectoryHandle,
  id: string,
  shard: string,
  payload: AnalysisObject
) {
  const shardDir = await getEntityShardDirectory(systemDir, OBJECTS_DIR, shard, true)
  const bundle: EntityBundle<AnalysisObject> = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    payload: { ...structuredClone(payload), id },
  }
  await writeJsonFile(shardDir, `${id}.json`, bundle)
}

async function writeBranchPayload(
  systemDir: FileSystemDirectoryHandle,
  id: string,
  shard: string,
  payload: ContinuationObject
) {
  const shardDir = await getEntityShardDirectory(systemDir, BRANCHES_DIR, shard, true)
  const bundle: EntityBundle<ContinuationObject> = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    payload: { ...structuredClone(payload), id },
  }
  await writeJsonFile(shardDir, `${id}.json`, bundle)
}

async function readObjectPayload(
  systemDir: FileSystemDirectoryHandle,
  id: string,
  shard: string
): Promise<AnalysisObject> {
  const shardDir = await getEntityShardDirectory(systemDir, OBJECTS_DIR, shard, false)
  const bundle = await readJsonFile<EntityBundle<AnalysisObject>>(shardDir, `${id}.json`)
  if (bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported object payload schema version: ${bundle.schemaVersion}`)
  }
  return { ...bundle.payload, id } as AnalysisObject
}

async function readBranchPayload(
  systemDir: FileSystemDirectoryHandle,
  id: string,
  shard: string
): Promise<ContinuationObject> {
  const shardDir = await getEntityShardDirectory(systemDir, BRANCHES_DIR, shard, false)
  const bundle = await readJsonFile<EntityBundle<ContinuationObject>>(shardDir, `${id}.json`)
  if (bundle.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported branch payload schema version: ${bundle.schemaVersion}`)
  }
  return { ...bundle.payload, id }
}

async function removeEntityPayload(
  systemDir: FileSystemDirectoryHandle,
  rootDirName: string,
  id: string,
  shard: string
) {
  const rootDir = await systemDir.getDirectoryHandle(rootDirName, { create: false }).catch(() => null)
  if (!rootDir) return
  const shardDir = await rootDir.getDirectoryHandle(shard, { create: false }).catch(() => null)
  if (!shardDir) return
  await shardDir.removeEntry(`${id}.json`).catch(() => undefined)
}

function resolveSummary(system: System): SystemSummary {
  return {
    id: system.id,
    name: system.name,
    updatedAt: system.updatedAt,
    type: system.config.type,
  }
}

function ensureIndex(system: System): SystemIndex {
  const index = structuredClone(system.index ?? emptySystemIndex())
  Object.entries(system.objects).forEach(([id, obj]) => {
    const existing = index.objects[id]
    const metadataChanged = !existing || existing.name !== obj.name || existing.objectType !== obj.type
    index.objects[id] = {
      id,
      name: obj.name,
      objectType: obj.type,
      shard: existing?.shard ?? shardForEntityId(id),
      updatedAt: metadataChanged ? system.updatedAt : existing.updatedAt,
    }
  })
  Object.entries(system.branches).forEach(([id, branch]) => {
    const existing = index.branches[id]
    const metadataChanged =
      !existing ||
      existing.name !== branch.name ||
      existing.branchType !== branch.branchType ||
      existing.parentObjectId !== (branch.parentObjectId ?? null) ||
      existing.startObjectId !== (branch.startObjectId ?? null)
    index.branches[id] = {
      id,
      name: branch.name,
      branchType: branch.branchType,
      parentObjectId: branch.parentObjectId ?? null,
      startObjectId: branch.startObjectId ?? null,
      shard: existing?.shard ?? shardForEntityId(id),
      updatedAt: metadataChanged ? system.updatedAt : existing.updatedAt,
    }
  })
  return index
}

function buildSkeletonSystem(
  meta: SystemMetaBundle['system'],
  ui: SystemUiSnapshot,
  index: SystemIndex
): System {
  return normalizeSystem({
    id: meta.id,
    name: meta.name,
    config: meta.config,
    index,
    nodes: structuredClone(ui.nodes),
    rootIds: [...ui.rootIds],
    objects: {},
    branches: {},
    scenes: structuredClone(ui.scenes),
    bifurcationDiagrams: structuredClone(ui.bifurcationDiagrams),
    ui: structuredClone(ui.ui),
    updatedAt: meta.updatedAt,
  })
}

export class OpfsSystemStore implements SystemStore {
  async list(): Promise<SystemSummary[]> {
    const systemsDir = await getSystemsDirectory(false).catch(() => null)
    if (!systemsDir) return []
    const summaries: SystemSummary[] = []
    for await (const entry of systemsDir.values()) {
      if (entry.kind !== 'directory') continue
      const summary = await readManifest(entry as FileSystemDirectoryHandle)
      if (summary) {
        summaries.push(summary)
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async load(id: string): Promise<System> {
    const systemDir = await getSystemDirectory(id, false)
    const [meta, ui, objectIndex, branchIndex] = await Promise.all([
      readSystemMeta(systemDir),
      readUi(systemDir),
      readObjectIndex(systemDir),
      readBranchIndex(systemDir),
    ])
    return buildSkeletonSystem(meta, ui, {
      objects: objectIndex,
      branches: branchIndex,
    })
  }

  async loadEntities(
    systemId: string,
    objectIds: string[],
    branchIds: string[]
  ): Promise<LoadedEntities> {
    if (objectIds.length === 0 && branchIds.length === 0) {
      return { objects: {}, branches: {} }
    }
    const systemDir = await getSystemDirectory(systemId, false)
    const [objectIndex, branchIndex] = await Promise.all([
      readObjectIndex(systemDir),
      readBranchIndex(systemDir),
    ])
    const objects: Record<string, AnalysisObject> = {}
    const branches: Record<string, ContinuationObject> = {}
    await Promise.all(
      objectIds.map(async (id) => {
        const entry = objectIndex[id]
        if (!entry) return
        objects[id] = await readObjectPayload(systemDir, id, entry.shard || shardForEntityId(id))
      })
    )
    await Promise.all(
      branchIds.map(async (id) => {
        const entry = branchIndex[id]
        if (!entry) return
        branches[id] = await readBranchPayload(systemDir, id, entry.shard || shardForEntityId(id))
      })
    )
    return { objects, branches }
  }

  async save(system: System): Promise<void> {
    const systemDir = await getSystemDirectory(system.id, true)
    const next = structuredClone(system)
    next.index = ensureIndex(next)
    const [existingObjectIndex, existingBranchIndex] = await Promise.all([
      readObjectIndex(systemDir),
      readBranchIndex(systemDir),
    ])

    const removedObjectIds = Object.keys(existingObjectIndex).filter((id) => !(id in next.index.objects))
    const removedBranchIds = Object.keys(existingBranchIndex).filter((id) => !(id in next.index.branches))
    const changedObjectIds = (
      await Promise.all(
        Object.entries(next.objects).map(async ([id, payload]) => {
          const existing = existingObjectIndex[id]
          if (!existing) return id
          try {
            const persisted = await readObjectPayload(
              systemDir,
              id,
              existing.shard || shardForEntityId(id)
            )
            const normalized = { ...structuredClone(payload), id } as AnalysisObject
            return JSON.stringify(persisted) === JSON.stringify(normalized) ? null : id
          } catch {
            return id
          }
        })
      )
    ).filter((id): id is string => Boolean(id))
    const changedBranchIds = (
      await Promise.all(
        Object.entries(next.branches).map(async ([id, payload]) => {
          const existing = existingBranchIndex[id]
          if (!existing) return id
          try {
            const persisted = await readBranchPayload(
              systemDir,
              id,
              existing.shard || shardForEntityId(id)
            )
            const normalized = { ...structuredClone(payload), id }
            return JSON.stringify(persisted) === JSON.stringify(normalized) ? null : id
          } catch {
            return id
          }
        })
      )
    ).filter((id): id is string => Boolean(id))

    await Promise.all([
      writeSystemMeta(systemDir, next),
      writeUi(systemDir, next),
      writeObjectIndex(systemDir, next.index.objects),
      writeBranchIndex(systemDir, next.index.branches),
      writeManifest(systemDir, resolveSummary(next)),
    ])

    await Promise.all(
      changedObjectIds.map(async (id) => {
        const payload = next.objects[id]
        if (!payload) return
        const indexEntry = next.index.objects[id]
        if (!indexEntry) return
        await writeObjectPayload(systemDir, id, indexEntry.shard, payload)
      })
    )
    await Promise.all(
      changedBranchIds.map(async (id) => {
        const payload = next.branches[id]
        if (!payload) return
        const indexEntry = next.index.branches[id]
        if (!indexEntry) return
        await writeBranchPayload(systemDir, id, indexEntry.shard, payload)
      })
    )
    await Promise.all(
      removedObjectIds.map((id) =>
        removeEntityPayload(
          systemDir,
          OBJECTS_DIR,
          id,
          existingObjectIndex[id]?.shard || shardForEntityId(id)
        )
      )
    )
    await Promise.all(
      removedBranchIds.map((id) =>
        removeEntityPayload(
          systemDir,
          BRANCHES_DIR,
          id,
          existingBranchIndex[id]?.shard || shardForEntityId(id)
        )
      )
    )
  }

  async saveUi(system: System): Promise<void> {
    const systemDir = await getSystemDirectory(system.id, true)
    const currentMeta = await readSystemMeta(systemDir).catch(() => null)
    const summary = currentMeta
      ? {
          id: currentMeta.id,
          name: currentMeta.name,
          updatedAt:
            currentMeta.updatedAt.localeCompare(system.updatedAt) > 0
              ? currentMeta.updatedAt
              : system.updatedAt,
          type: currentMeta.config.type,
        }
      : resolveSummary(system)
    await Promise.all([writeUi(systemDir, system), writeManifest(systemDir, summary)])
  }

  async exportSystemArchive(systemId: string): Promise<{ filename: string; blob: Blob }> {
    const skeleton = await this.load(systemId)
    const entityIds = {
      objectIds: Object.keys(skeleton.index.objects),
      branchIds: Object.keys(skeleton.index.branches),
    }
    const entities = await this.loadEntities(systemId, entityIds.objectIds, entityIds.branchIds)
    const fullSystem = normalizeSystem({
      ...skeleton,
      objects: entities.objects,
      branches: entities.branches,
    })
    return {
      filename: `${fullSystem.name || 'fork_system'}.zip`,
      blob: buildSystemArchiveBlob(fullSystem),
    }
  }

  async importSystemArchive(file: File): Promise<System> {
    const system = await parseSystemArchiveFile(file)
    await this.save(system)
    return await this.load(system.id)
  }

  async remove(id: string): Promise<void> {
    const systemsDir = await getSystemsDirectory(false).catch(() => null)
    if (!systemsDir) return
    await systemsDir.removeEntry(id, { recursive: true })
  }

  async clear(): Promise<void> {
    const systemsDir = await getSystemsDirectory(false).catch(() => null)
    if (!systemsDir) return
    const removals: Promise<void>[] = []
    for await (const entry of systemsDir.values()) {
      removals.push(systemsDir.removeEntry(entry.name, { recursive: true }))
    }
    await Promise.all(removals)
  }
}
