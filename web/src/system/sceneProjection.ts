import { resolveSceneAxisIndices, resolveSceneAxisSelection } from './sceneAxes'
import type { SceneAxisVariables, SystemConfig } from './types'

export type SceneProjectionKind =
  | 'flow_timeseries_1d'
  | 'map_cobweb_1d'
  | 'phase_2d'
  | 'phase_3d'

export interface SceneProjection {
  kind: SceneProjectionKind
  axisVariables: SceneAxisVariables
  axisIndices: number[]
  axisCount: 1 | 2 | 3
  showMapFunctionCurve: boolean
}

export function resolveSceneProjection(
  config: SystemConfig,
  axisVariables?: SceneAxisVariables | null
): SceneProjection | null {
  const selection = resolveSceneAxisSelection(config.varNames, axisVariables)
  if (!selection) return null
  const axisIndices = resolveSceneAxisIndices(config.varNames, selection)
  if (!axisIndices || axisIndices.length !== selection.length) return null

  let axisCount: 1 | 2 | 3
  if (selection.length === 1) axisCount = 1
  else if (selection.length === 2) axisCount = 2
  else axisCount = 3

  let kind: SceneProjectionKind
  if (axisCount === 1) {
    kind = config.type === 'map' ? 'map_cobweb_1d' : 'flow_timeseries_1d'
  } else if (axisCount === 2) {
    kind = 'phase_2d'
  } else {
    kind = 'phase_3d'
  }

  const showMapFunctionCurve =
    kind === 'map_cobweb_1d' && config.type === 'map' && config.varNames.length === 1

  return {
    kind,
    axisVariables: selection,
    axisIndices,
    axisCount,
    showMapFunctionCurve,
  }
}
