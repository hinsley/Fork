import type { System, SystemData, SystemSummary, SystemUiSnapshot } from './types'
import type { SystemStore } from './store'
import {
  deserializeSystemData,
  deserializeSystemUi,
  mergeSystem,
  serializeSystemData,
  serializeSystemUi,
  type LegacySystemBundle,
  type SystemDataBundle,
  type SystemUiBundle,
} from './serialization'

const SYSTEMS_DIR = 'fork-systems'
const SYSTEM_FILE = 'system.json'
const UI_FILE = 'ui.json'

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

async function readJsonFile<T>(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<T> {
  const fileHandle = await dir.getFileHandle(filename)
  const file = await fileHandle.getFile()
  return JSON.parse(await file.text()) as T
}

async function writeJsonFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  payload: unknown
) {
  const fileHandle = await dir.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(payload, null, 2))
  await writable.close()
}

function latestIso(primary: string, secondary?: string) {
  if (!secondary) return primary
  return primary.localeCompare(secondary) >= 0 ? primary : secondary
}

async function readSystemData(
  dir: FileSystemDirectoryHandle
): Promise<{ data: SystemData; ui?: SystemUiSnapshot }> {
  const bundle = await readJsonFile<SystemDataBundle | LegacySystemBundle>(dir, SYSTEM_FILE)
  const result = deserializeSystemData(bundle)
  return { data: result.data, ui: result.ui }
}

async function readSystemUi(dir: FileSystemDirectoryHandle): Promise<SystemUiSnapshot | null> {
  try {
    const bundle = await readJsonFile<SystemUiBundle>(dir, UI_FILE)
    return deserializeSystemUi(bundle)
  } catch {
    return null
  }
}

async function writeSystemData(dir: FileSystemDirectoryHandle, system: System) {
  await writeJsonFile(dir, SYSTEM_FILE, serializeSystemData(system))
}

async function writeSystemUi(dir: FileSystemDirectoryHandle, system: System) {
  await writeJsonFile(dir, UI_FILE, serializeSystemUi(system))
}

export class OpfsSystemStore implements SystemStore {
  async list(): Promise<SystemSummary[]> {
    const systemsDir = await getSystemsDirectory(false).catch(() => null)
    if (!systemsDir) return []

    const summaries: SystemSummary[] = []
    for await (const entry of systemsDir.values()) {
      if (entry.kind !== 'directory') continue
      const dirEntry = entry as FileSystemDirectoryHandle
      try {
        const { data, ui: legacyUi } = await readSystemData(dirEntry)
        const ui = (await readSystemUi(dirEntry)) ?? legacyUi
        summaries.push({
          id: data.id,
          name: data.name,
          updatedAt: latestIso(data.updatedAt, ui?.updatedAt),
          type: data.config.type,
        })
      } catch {
        continue
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async load(id: string): Promise<System> {
    const systemsDir = await getSystemsDirectory()
    const systemDir = await systemsDir.getDirectoryHandle(id)
    const { data, ui: legacyUi } = await readSystemData(systemDir)
    const ui = (await readSystemUi(systemDir)) ?? legacyUi
    return mergeSystem(data, ui ?? undefined)
  }

  async save(system: System): Promise<void> {
    const systemsDir = await getSystemsDirectory()
    const systemDir = await systemsDir.getDirectoryHandle(system.id, { create: true })
    await writeSystemData(systemDir, system)
    await writeSystemUi(systemDir, system)
  }

  async saveUi(system: System): Promise<void> {
    const systemsDir = await getSystemsDirectory()
    const systemDir = await systemsDir.getDirectoryHandle(system.id, { create: true })
    await writeSystemUi(systemDir, system)
  }

  async remove(id: string): Promise<void> {
    const systemsDir = await getSystemsDirectory()
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
