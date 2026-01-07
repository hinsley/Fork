import type { System, SystemSummary } from './types'
import type { SystemStore } from './store'
import { deserializeSystem, serializeSystem, type SystemBundle } from './serialization'

const SYSTEMS_DIR = 'fork-systems'
const SYSTEM_FILE = 'system.json'

async function getRootDirectory() {
  if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) {
    throw new Error('OPFS not supported in this browser')
  }
  return await navigator.storage.getDirectory()
}

async function getSystemsDirectory(create = true) {
  const root = await getRootDirectory()
  return await root.getDirectoryHandle(SYSTEMS_DIR, { create })
}

async function readSystemBundle(dir: FileSystemDirectoryHandle): Promise<SystemBundle> {
  const fileHandle = await dir.getFileHandle(SYSTEM_FILE)
  const file = await fileHandle.getFile()
  return JSON.parse(await file.text()) as SystemBundle
}

async function writeSystemBundle(dir: FileSystemDirectoryHandle, bundle: SystemBundle) {
  const fileHandle = await dir.getFileHandle(SYSTEM_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(bundle, null, 2))
  await writable.close()
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
        const bundle = await readSystemBundle(dirEntry)
        summaries.push({
          id: bundle.system.id,
          name: bundle.system.name,
          updatedAt: bundle.system.updatedAt,
          type: bundle.system.config.type,
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
    const bundle = await readSystemBundle(systemDir)
    return deserializeSystem(bundle)
  }

  async save(system: System): Promise<void> {
    const systemsDir = await getSystemsDirectory()
    const systemDir = await systemsDir.getDirectoryHandle(system.id, { create: true })
    await writeSystemBundle(systemDir, serializeSystem(system))
  }

  async remove(id: string): Promise<void> {
    const systemsDir = await getSystemsDirectory()
    await systemsDir.removeEntry(id, { recursive: true })
  }
}
