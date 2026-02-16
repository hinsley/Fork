import { buildSystemArchiveBlob, parseSystemArchiveFile } from './archive'
import type { System } from './types'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadSystem(system: System) {
  const blob = buildSystemArchiveBlob(system)
  const filename = `${system.name.replace(/\s+/g, '_') || 'fork_system'}.zip`
  downloadBlob(blob, filename)
}

export async function readSystemFile(file: File): Promise<System> {
  return await parseSystemArchiveFile(file)
}

