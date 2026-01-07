import { deserializeSystem, serializeSystem } from './serialization'
import type { System } from './types'

export function downloadSystem(system: System) {
  const bundle = serializeSystem(system)
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${system.name.replace(/\s+/g, '_') || 'fork_system'}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function readSystemFile(file: File): Promise<System> {
  const text = await file.text()
  const bundle = JSON.parse(text) as ReturnType<typeof serializeSystem>
  return deserializeSystem(bundle)
}
