import type { SceneAxisVariables } from './types'

export type SceneAxisSelection = {
  x: string
  y: string
  z: string
}

const AXIS_KEYS: Array<keyof SceneAxisVariables> = ['x', 'y', 'z']

export function resolveSceneAxisSelection(
  varNames: string[],
  axisVariables?: SceneAxisVariables | null
): SceneAxisSelection | null {
  if (varNames.length < 3) return null
  const used = new Set<string>()
  const selection = {} as SceneAxisSelection

  AXIS_KEYS.forEach((axisKey, index) => {
    const preferred = axisVariables?.[axisKey]
    if (preferred && varNames.includes(preferred) && !used.has(preferred)) {
      selection[axisKey] = preferred
      used.add(preferred)
      return
    }
    const fallback = varNames.find((name) => !used.has(name))
    const chosen = fallback ?? varNames[Math.min(index, varNames.length - 1)] ?? ''
    selection[axisKey] = chosen
    used.add(chosen)
  })

  return selection
}

export function resolveSceneAxisIndices(
  varNames: string[],
  axisVariables?: SceneAxisVariables | null
): [number, number, number] | null {
  const selection = resolveSceneAxisSelection(varNames, axisVariables)
  if (!selection) return null
  return [
    varNames.indexOf(selection.x),
    varNames.indexOf(selection.y),
    varNames.indexOf(selection.z),
  ]
}
