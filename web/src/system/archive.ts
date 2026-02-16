import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { normalizeSystem, shardForEntityId } from './model'
import type {
  AnalysisObject,
  BranchIndexEntry,
  ContinuationObject,
  ObjectIndexEntry,
  System,
  SystemConfig,
  SystemIndex,
  SystemUiSnapshot,
} from './types'

const ARCHIVE_SCHEMA_VERSION = 1

type ArchiveManifest = {
  schemaVersion: number
  systemId: string
  name: string
  updatedAt: string
  type: SystemConfig['type']
}

type ArchiveSystemMeta = {
  id: string
  name: string
  config: SystemConfig
  updatedAt: string
}

type ArchiveFileMap = Record<string, Uint8Array>

function encodeJson(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2))
}

function decodeJson<T>(entries: ArchiveFileMap, path: string): T {
  const encoded =
    entries[path] ??
    entries[path.replace(/^\/+/, '')] ??
    entries[`/${path.replace(/^\/+/, '')}`] ??
    entries[`./${path.replace(/^\/+/, '')}`]
  if (!encoded) {
    throw new Error(`Archive is missing "${path}".`)
  }
  return JSON.parse(strFromU8(encoded)) as T
}

function buildArchiveEntries(system: System): ArchiveFileMap {
  const normalized = normalizeSystem(system)
  const entries: ArchiveFileMap = {}
  const manifest: ArchiveManifest = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    systemId: normalized.id,
    name: normalized.name,
    updatedAt: normalized.updatedAt,
    type: normalized.config.type,
  }
  const meta: ArchiveSystemMeta = {
    id: normalized.id,
    name: normalized.name,
    config: normalized.config,
    updatedAt: normalized.updatedAt,
  }
  const ui: SystemUiSnapshot = {
    systemId: normalized.id,
    updatedAt: normalized.updatedAt,
    nodes: structuredClone(normalized.nodes),
    rootIds: [...normalized.rootIds],
    scenes: structuredClone(normalized.scenes),
    bifurcationDiagrams: structuredClone(normalized.bifurcationDiagrams),
    ui: structuredClone(normalized.ui),
  }
  entries['manifest.json'] = encodeJson(manifest)
  entries['system.json'] = encodeJson(meta)
  entries['ui.json'] = encodeJson(ui)
  entries['index/objects.json'] = encodeJson(normalized.index.objects)
  entries['index/branches.json'] = encodeJson(normalized.index.branches)

  Object.entries(normalized.index.objects).forEach(([id, indexEntry]) => {
    const payload = normalized.objects[id]
    if (!payload) {
      throw new Error(`Missing object payload for "${id}" while building archive.`)
    }
    const shard = indexEntry.shard || shardForEntityId(id)
    entries[`objects/${shard}/${id}.json`] = encodeJson(payload)
  })

  Object.entries(normalized.index.branches).forEach(([id, indexEntry]) => {
    const payload = normalized.branches[id]
    if (!payload) {
      throw new Error(`Missing branch payload for "${id}" while building archive.`)
    }
    const shard = indexEntry.shard || shardForEntityId(id)
    entries[`branches/${shard}/${id}.json`] = encodeJson(payload)
  })

  return entries
}

export function buildSystemArchiveBytes(system: System): Uint8Array {
  const entries = buildArchiveEntries(system)
  const zippable: Record<string, [Uint8Array]> = {}
  Object.entries(entries).forEach(([path, bytes]) => {
    zippable[path] = [new Uint8Array(bytes)]
  })
  return zipSync(zippable as unknown as Record<string, Uint8Array>)
}

export function buildSystemArchiveBlob(system: System): Blob {
  const zipBytes = buildSystemArchiveBytes(system)
  // Copy into a plain ArrayBuffer so BlobPart typing is compatible across TS lib targets.
  const blobBytes = new Uint8Array(zipBytes.byteLength)
  blobBytes.set(zipBytes)
  return new Blob([blobBytes as unknown as BlobPart], { type: 'application/zip' })
}

function parseObjectPayloads(
  entries: ArchiveFileMap,
  index: Record<string, ObjectIndexEntry>
): Record<string, AnalysisObject> {
  const objects: Record<string, AnalysisObject> = {}
  Object.entries(index).forEach(([id, entry]) => {
    const shard = entry.shard || shardForEntityId(id)
    const path = `objects/${shard}/${id}.json`
    const payload = decodeJson<AnalysisObject>(entries, path)
    objects[id] = { ...payload, id } as AnalysisObject
  })
  return objects
}

function parseBranchPayloads(
  entries: ArchiveFileMap,
  index: Record<string, BranchIndexEntry>
): Record<string, ContinuationObject> {
  const branches: Record<string, ContinuationObject> = {}
  Object.entries(index).forEach(([id, entry]) => {
    const shard = entry.shard || shardForEntityId(id)
    const path = `branches/${shard}/${id}.json`
    const payload = decodeJson<ContinuationObject>(entries, path)
    branches[id] = { ...payload, id }
  })
  return branches
}

async function readArchiveFileBytes(file: File): Promise<Uint8Array> {
  const maybeArrayBuffer = file as File & {
    arrayBuffer?: () => Promise<ArrayBuffer>
    text?: () => Promise<string>
  }
  if (typeof maybeArrayBuffer.arrayBuffer === 'function') {
    return new Uint8Array(await maybeArrayBuffer.arrayBuffer())
  }
  if (typeof maybeArrayBuffer.text === 'function') {
    const rawText = await maybeArrayBuffer.text()
    const bytes = new Uint8Array(rawText.length)
    for (let index = 0; index < rawText.length; index += 1) {
      bytes[index] = rawText.charCodeAt(index) & 0xff
    }
    return bytes
  }
  throw new Error('Unable to read archive file bytes.')
}

export async function parseSystemArchiveFile(file: File): Promise<System> {
  const raw = await readArchiveFileBytes(file)
  return parseSystemArchiveBytes(raw)
}

export function parseSystemArchiveBytes(raw: Uint8Array): System {
  const entries = unzipSync(raw)
  const manifest = decodeJson<ArchiveManifest>(entries, 'manifest.json')
  if (manifest.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported archive schema version: ${manifest.schemaVersion}`)
  }
  const meta = decodeJson<ArchiveSystemMeta>(entries, 'system.json')
  const ui = decodeJson<SystemUiSnapshot>(entries, 'ui.json')
  const index: SystemIndex = {
    objects: decodeJson<Record<string, ObjectIndexEntry>>(entries, 'index/objects.json'),
    branches: decodeJson<Record<string, BranchIndexEntry>>(entries, 'index/branches.json'),
  }
  const objects = parseObjectPayloads(entries, index.objects)
  const branches = parseBranchPayloads(entries, index.branches)
  const system: System = {
    id: meta.id,
    name: meta.name,
    config: meta.config,
    index,
    nodes: structuredClone(ui.nodes),
    rootIds: [...ui.rootIds],
    objects,
    branches,
    scenes: structuredClone(ui.scenes),
    bifurcationDiagrams: structuredClone(ui.bifurcationDiagrams),
    ui: structuredClone(ui.ui),
    updatedAt: meta.updatedAt,
  }
  return normalizeSystem(system)
}
