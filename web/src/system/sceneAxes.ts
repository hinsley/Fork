import type { SceneAxisVariables } from './types'

type LegacySceneAxisVariables = {
  x?: string
  y?: string
  z?: string
}

type SceneAxisLike = SceneAxisVariables | LegacySceneAxisVariables | null | undefined

export type SceneAxisCount = 1 | 2 | 3

const LEGACY_AXIS_KEYS: Array<keyof LegacySceneAxisVariables> = ['x', 'y', 'z']

function isSceneAxisArray(value: SceneAxisLike): value is SceneAxisVariables {
  if (!Array.isArray(value)) return false
  if (value.length < 1 || value.length > 3) return false
  return value.every((entry) => typeof entry === 'string')
}

function toAxisArray(value: SceneAxisLike): string[] {
  if (!value) return []
  if (isSceneAxisArray(value)) return [...value]
  if (typeof value !== 'object' || Array.isArray(value)) return []
  const legacy = value as LegacySceneAxisVariables
  const axes: string[] = []
  for (const key of LEGACY_AXIS_KEYS) {
    const entry = legacy[key]
    if (typeof entry === 'string') {
      axes.push(entry)
    }
  }
  return axes
}

function toSceneAxisVariables(values: string[]): SceneAxisVariables | null {
  if (values.length === 1) return [values[0]]
  if (values.length === 2) return [values[0], values[1]]
  if (values.length >= 3) return [values[0], values[1], values[2]]
  return null
}

function inferRequestedAxisCount(value: SceneAxisLike): SceneAxisCount | null {
  const axes = toAxisArray(value)
  if (axes.length === 1 || axes.length === 2 || axes.length === 3) {
    return axes.length
  }
  return null
}

function clampAxisCount(varCount: number, requested?: number | null): SceneAxisCount | 0 {
  const max = Math.min(3, Math.max(0, Math.trunc(varCount)))
  if (max <= 0) return 0
  if (!Number.isFinite(requested)) return max as SceneAxisCount
  const next = Math.min(max, Math.max(1, Math.trunc(requested as number)))
  if (next <= 1) return 1
  if (next === 2) return 2
  return 3
}

export function maxSceneAxisCount(varNames: string[]): SceneAxisCount | 0 {
  return clampAxisCount(varNames.length)
}

export function defaultSceneAxisVariables(
  varNames: string[],
  axisCount?: number
): SceneAxisVariables | null {
  const requested = clampAxisCount(varNames.length, axisCount)
  if (requested === 0) return null
  return toSceneAxisVariables(varNames.slice(0, requested))
}

export function resolveSceneAxisSelection(
  varNames: string[],
  axisVariables?: SceneAxisLike,
  axisCount?: number
): SceneAxisVariables | null {
  const fallbackCount = inferRequestedAxisCount(axisVariables)
  const requested = clampAxisCount(varNames.length, axisCount ?? fallbackCount)
  if (requested === 0) return null

  const selection: string[] = []
  const used = new Set<string>()
  const preferred = toAxisArray(axisVariables)

  for (const candidate of preferred) {
    if (!varNames.includes(candidate)) continue
    if (used.has(candidate)) continue
    selection.push(candidate)
    used.add(candidate)
    if (selection.length === requested) {
      return toSceneAxisVariables(selection)
    }
  }

  for (const candidate of varNames) {
    if (used.has(candidate)) continue
    selection.push(candidate)
    used.add(candidate)
    if (selection.length === requested) {
      return toSceneAxisVariables(selection)
    }
  }

  return toSceneAxisVariables(selection)
}

export function resolveSceneAxisCount(
  varNames: string[],
  axisVariables?: SceneAxisLike
): SceneAxisCount | 0 {
  const selection = resolveSceneAxisSelection(varNames, axisVariables)
  if (!selection) return 0
  if (selection.length === 1) return 1
  if (selection.length === 2) return 2
  return 3
}

export function resolveSceneAxisIndices(
  varNames: string[],
  axisVariables?: SceneAxisLike,
  axisCount?: number
): number[] | null {
  const selection = resolveSceneAxisSelection(varNames, axisVariables, axisCount)
  if (!selection) return null
  const indices = selection.map((name) => varNames.indexOf(name))
  if (indices.some((index) => index < 0)) return null
  return indices
}
