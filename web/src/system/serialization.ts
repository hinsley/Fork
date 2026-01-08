import type { System, SystemData, SystemUiSnapshot } from './types'
import { normalizeSystem } from './model'

export const SYSTEM_DATA_SCHEMA_VERSION = 1
export const SYSTEM_UI_SCHEMA_VERSION = 1
export const SYSTEM_PROJECT_SCHEMA_VERSION = 1

export type LegacySystemBundle = {
  schemaVersion: number
  system: System
}

export type SystemDataBundle = {
  schemaVersion: number
  system: SystemData
}

export type SystemUiBundle = {
  schemaVersion: number
  ui: SystemUiSnapshot
}

export type SystemProjectBundle = {
  schemaVersion: number
  system: SystemData
  ui: SystemUiSnapshot
}

function latestIso(primary: string, secondary?: string) {
  if (!secondary) return primary
  return primary.localeCompare(secondary) >= 0 ? primary : secondary
}

function isLegacySystem(system: System | SystemData): system is System {
  return 'nodes' in system || 'ui' in system
}

export function splitSystem(system: System): { data: SystemData; ui: SystemUiSnapshot } {
  const clone = structuredClone(system)
  const { nodes, rootIds, scenes, bifurcationDiagrams, ui, ...data } = clone
  return {
    data: data as SystemData,
    ui: {
      systemId: clone.id,
      updatedAt: clone.updatedAt,
      nodes,
      rootIds,
      scenes,
      bifurcationDiagrams,
      ui,
    },
  }
}

export function mergeSystem(data: SystemData, ui?: SystemUiSnapshot): System {
  const updatedAt = latestIso(data.updatedAt, ui?.updatedAt)
  const merged = {
    ...structuredClone(data),
    nodes: structuredClone(ui?.nodes ?? {}),
    rootIds: structuredClone(ui?.rootIds ?? []),
    scenes: structuredClone(ui?.scenes ?? []),
    bifurcationDiagrams: structuredClone(ui?.bifurcationDiagrams ?? []),
    ui: structuredClone(ui?.ui ?? {}),
    updatedAt,
  } as System
  return normalizeSystem(merged)
}

export function serializeSystemData(system: System): SystemDataBundle {
  const { data } = splitSystem(system)
  return {
    schemaVersion: SYSTEM_DATA_SCHEMA_VERSION,
    system: data,
  }
}

export function serializeSystemUi(system: System): SystemUiBundle {
  const { ui } = splitSystem(system)
  return {
    schemaVersion: SYSTEM_UI_SCHEMA_VERSION,
    ui,
  }
}

export function serializeSystem(system: System): SystemProjectBundle {
  const { data, ui } = splitSystem(system)
  return {
    schemaVersion: SYSTEM_PROJECT_SCHEMA_VERSION,
    system: data,
    ui,
  }
}

export function deserializeSystemData(
  bundle: SystemDataBundle | LegacySystemBundle
): { data: SystemData; ui?: SystemUiSnapshot } {
  if (bundle.schemaVersion !== SYSTEM_DATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported system schema version: ${bundle.schemaVersion}`)
  }
  if (isLegacySystem(bundle.system)) {
    const normalized = normalizeSystem(structuredClone(bundle.system))
    return splitSystem(normalized)
  }
  return { data: structuredClone(bundle.system) }
}

export function deserializeSystemUi(bundle: SystemUiBundle): SystemUiSnapshot {
  if (bundle.schemaVersion !== SYSTEM_UI_SCHEMA_VERSION) {
    throw new Error(`Unsupported system UI schema version: ${bundle.schemaVersion}`)
  }
  return structuredClone(bundle.ui)
}

export function deserializeSystem(
  bundle: SystemProjectBundle | LegacySystemBundle
): System {
  if (bundle.schemaVersion !== SYSTEM_PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported system schema version: ${bundle.schemaVersion}`)
  }
  if ('ui' in bundle) {
    return mergeSystem(structuredClone(bundle.system), structuredClone(bundle.ui))
  }
  const { data, ui } = deserializeSystemData(bundle)
  return mergeSystem(data, ui)
}
