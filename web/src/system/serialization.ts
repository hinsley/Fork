import type { System } from './types'
import { normalizeSystem } from './model'

export const SYSTEM_SCHEMA_VERSION = 1

export type SystemBundle = {
  schemaVersion: number
  system: System
}

export function serializeSystem(system: System): SystemBundle {
  return {
    schemaVersion: SYSTEM_SCHEMA_VERSION,
    system: structuredClone(system),
  }
}

export function deserializeSystem(bundle: SystemBundle): System {
  if (bundle.schemaVersion !== SYSTEM_SCHEMA_VERSION) {
    throw new Error(`Unsupported system schema version: ${bundle.schemaVersion}`)
  }
  return normalizeSystem(structuredClone(bundle.system))
}
