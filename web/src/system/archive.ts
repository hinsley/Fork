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

export type ArchiveParseLimits = {
  maxCompressedBytes: number
  maxExpandedBytes: number
  maxEntries: number
  maxCompressionRatio: number
}

export type ArchiveParseOptions = {
  limits?: ArchiveParseLimits
  strict?: boolean
}

export const EMBED_ARCHIVE_LIMITS: ArchiveParseLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxCompressionRatio: 100,
}

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

const SAFE_ARCHIVE_ENTRY = /^(manifest\.json|system\.json|ui\.json|index\/(objects|branches)\.json|(objects|branches)\/[a-f0-9]{2}\/[A-Za-z0-9._:-]+\.json)$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertSafeJsonTree(value: unknown, path = 'archive', depth = 0): void {
  if (depth > 128) {
    throw new Error(`Archive data is nested too deeply at ${path}.`)
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeJsonTree(entry, `${path}[${index}]`, depth + 1))
    return
  }
  if (!isRecord(value)) return
  Object.entries(value).forEach(([key, entry]) => {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Archive contains a forbidden key at ${path}.`)
    }
    assertSafeJsonTree(entry, `${path}.${key}`, depth + 1)
  })
}

function assertSafeId(id: unknown, label: string): asserts id is string {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || FORBIDDEN_KEYS.has(id)) {
    throw new Error(`Archive contains an invalid ${label}.`)
  }
}

function validateSurfaceGeometry(value: unknown, label: string): void {
  if (!isRecord(value)) return
  const geometry = value.type === 'Surface' && isRecord(value.Surface) ? value.Surface : value
  if (value.type !== 'Surface' && !('vertices_flat' in geometry)) return
  const dim = geometry.dim
  const vertices = geometry.vertices_flat
  const triangles = geometry.triangles
  if (!Number.isInteger(dim) || (dim as number) <= 0 || !Array.isArray(vertices)) {
    throw new Error(`${label} contains invalid surface geometry.`)
  }
  if (!Array.isArray(triangles) || vertices.length % (dim as number) !== 0) {
    throw new Error(`${label} contains inconsistent surface geometry.`)
  }
  const vertexCount = vertices.length / (dim as number)
  if (
    triangles.some(
      (index) => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= vertexCount
    )
  ) {
    throw new Error(`${label} contains an invalid surface triangle index.`)
  }
}

function validateEmbeddedSystem(system: System): void {
  assertSafeId(system.id, 'system ID')
  if (!system.config || !Array.isArray(system.config.varNames) || !Array.isArray(system.config.equations)) {
    throw new Error('Archive contains an invalid system configuration.')
  }
  if (!isRecord(system.nodes) || !Array.isArray(system.rootIds)) {
    throw new Error('Archive contains an invalid object tree.')
  }
  Object.entries(system.nodes).forEach(([id, node]) => {
    assertSafeId(id, 'node ID')
    if (!node || node.id !== id || !Array.isArray(node.children)) {
      throw new Error(`Archive contains an invalid node for ${id}.`)
    }
    node.children.forEach((childId) => {
      if (!system.nodes[childId]) throw new Error(`Archive node ${id} references a missing child.`)
    })
    if (node.parentId !== null && !system.nodes[node.parentId]) {
      throw new Error(`Archive node ${id} references a missing parent.`)
    }
  })
  system.rootIds.forEach((id) => {
    if (!system.nodes[id]) throw new Error('Archive object tree contains a missing root node.')
  })
  Object.entries(system.index.objects).forEach(([id, entry]) => {
    assertSafeId(id, 'object ID')
    if (entry.id !== id || !system.objects[id]) {
      throw new Error(`Archive object index is inconsistent for ${id}.`)
    }
  })
  Object.entries(system.index.branches).forEach(([id, entry]) => {
    assertSafeId(id, 'branch ID')
    if (entry.id !== id || !system.branches[id]) {
      throw new Error(`Archive branch index is inconsistent for ${id}.`)
    }
  })
  system.scenes.forEach((scene) => {
    if (!system.nodes[scene.id]) throw new Error(`Archive scene ${scene.id} has no matching node.`)
  })
  system.bifurcationDiagrams.forEach((diagram) => {
    if (!system.nodes[diagram.id]) throw new Error(`Archive diagram ${diagram.id} has no matching node.`)
  })
  system.analysisViewports.forEach((viewport) => {
    if (!system.nodes[viewport.id]) throw new Error(`Archive analysis ${viewport.id} has no matching node.`)
  })
  Object.entries(system.branches).forEach(([id, branch]) => {
    validateSurfaceGeometry(branch.data.manifold_geometry, `Archive branch ${id}`)
  })
}

function unzipArchive(raw: Uint8Array, options?: ArchiveParseOptions): ArchiveFileMap {
  const limits = options?.limits
  if (limits && raw.byteLength > limits.maxCompressedBytes) {
    throw new Error('System archive is larger than the 64 MiB embed limit.')
  }
  let entriesSeen = 0
  let expandedBytes = 0
  return unzipSync(raw, {
    filter: (file) => {
      entriesSeen += 1
      expandedBytes += file.originalSize
      if (limits) {
        if (entriesSeen > limits.maxEntries) throw new Error('System archive contains too many files.')
        if (expandedBytes > limits.maxExpandedBytes) {
          throw new Error('System archive expands beyond the 256 MiB embed limit.')
        }
        const ratio = file.originalSize / Math.max(1, file.size)
        if (ratio > limits.maxCompressionRatio) {
          throw new Error('System archive contains an unsafe compression ratio.')
        }
      }
      if (options?.strict && !SAFE_ARCHIVE_ENTRY.test(file.name)) {
        throw new Error(`System archive contains an unsupported entry: ${file.name}`)
      }
      return true
    },
  })
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
    analysisViewports: structuredClone(normalized.analysisViewports),
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

export function parseSystemArchiveBytes(raw: Uint8Array, options?: ArchiveParseOptions): System {
  const entries = unzipArchive(raw, options)
  const manifest = decodeJson<ArchiveManifest>(entries, 'manifest.json')
  if (manifest.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported archive schema version: ${manifest.schemaVersion}`)
  }
  const meta = decodeJson<ArchiveSystemMeta>(entries, 'system.json')
  const ui = decodeJson<SystemUiSnapshot>(entries, 'ui.json')
  if (manifest.systemId !== meta.id || manifest.systemId !== ui.systemId) {
    throw new Error('Archive system identifiers do not match.')
  }
  const index: SystemIndex = {
    objects: decodeJson<Record<string, ObjectIndexEntry>>(entries, 'index/objects.json'),
    branches: decodeJson<Record<string, BranchIndexEntry>>(entries, 'index/branches.json'),
  }
  if (options?.strict) {
    Object.keys(index.objects).forEach((id) => assertSafeId(id, 'object ID'))
    Object.keys(index.branches).forEach((id) => assertSafeId(id, 'branch ID'))
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
    analysisViewports: structuredClone(ui.analysisViewports),
    ui: structuredClone(ui.ui),
    updatedAt: meta.updatedAt,
  }
  if (options?.strict) assertSafeJsonTree(system)
  const normalized = normalizeSystem(system)
  if (options?.strict) validateEmbeddedSystem(normalized)
  return normalized
}
