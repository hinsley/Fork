import type {
  BifurcationAxis,
  BifurcationDiagram,
  Scene,
  SystemConfig,
} from '../system/types'
import { DEFAULT_SCENE_CAMERA } from '../system/model'
import { maxSceneAxisCount, resolveSceneAxisSelection } from '../system/sceneAxes'

export type SceneUpdate = Partial<Omit<Scene, 'id' | 'name'>>
export type DiagramUpdate = Partial<Omit<BifurcationDiagram, 'id' | 'name'>>

function formatAxisValue(axis: BifurcationAxis | null): string {
  return axis ? `${axis.kind}:${axis.name}` : ''
}

function parseAxisValue(value: string): BifurcationAxis | null {
  if (!value) return null
  const [kind, ...rest] = value.split(':')
  if (kind !== 'parameter' && kind !== 'state') return null
  const name = rest.join(':')
  if (!name) return null
  return { kind, name }
}

const AXIS_LETTERS = ['x', 'y', 'z'] as const

export function SceneAxisControls({
  config,
  scene,
  onUpdateScene,
}: {
  config: SystemConfig
  scene: Scene
  onUpdateScene: (sceneId: string, update: SceneUpdate) => void
}) {
  const varNames = config.varNames
  const maxAxes = maxSceneAxisCount(varNames)
  const selection = resolveSceneAxisSelection(varNames, scene.axisVariables)
  if (!selection || maxAxes === 0) return null

  const setCount = (count: number) => {
    const nextAxes = resolveSceneAxisSelection(varNames, null, count)
    if (!nextAxes) return
    onUpdateScene(scene.id, {
      axisVariables: nextAxes,
      viewRevision: scene.viewRevision + 1,
      axisRanges: {},
      camera: structuredClone(DEFAULT_SCENE_CAMERA),
    })
  }

  const setAxis = (axisIndex: number, value: string) => {
    const nextAxes = [...selection] as NonNullable<Scene['axisVariables']>
    nextAxes[axisIndex] = value
    const resolved = resolveSceneAxisSelection(varNames, nextAxes, nextAxes.length)
    if (!resolved) return
    onUpdateScene(scene.id, { axisVariables: resolved })
  }

  return (
    <div className="viewport-axis-controls">
      {maxAxes >= 2 ? (
        <label className="viewport-axis-controls__field">
          <span>Axes</span>
          <select
            value={selection.length}
            onChange={(event) => setCount(Number(event.target.value))}
            data-testid={`viewport-axis-count-${scene.id}`}
          >
            {Array.from({ length: maxAxes }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count === 1 ? (config.type === 'map' ? '1 · cobweb' : '1 · vs t') : count}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selection.map((current, axisIndex) => (
        <label className="viewport-axis-controls__field" key={AXIS_LETTERS[axisIndex]}>
          <span>{AXIS_LETTERS[axisIndex]}</span>
          <select
            value={current}
            onChange={(event) => setAxis(axisIndex, event.target.value)}
            data-testid={`viewport-axis-${AXIS_LETTERS[axisIndex]}-${scene.id}`}
          >
            {varNames.map((name) => (
              <option
                key={name}
                value={name}
                disabled={name !== current && selection.includes(name)}
              >
                {name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}

export function DiagramAxisControls({
  config,
  diagram,
  onUpdateBifurcationDiagram,
}: {
  config: SystemConfig
  diagram: BifurcationDiagram
  onUpdateBifurcationDiagram: (diagramId: string, update: DiagramUpdate) => void
}) {
  const options = (
    <>
      {config.paramNames.length > 0 ? (
        <optgroup label="Parameters">
          {config.paramNames.map((name) => (
            <option key={`p:${name}`} value={formatAxisValue({ kind: 'parameter', name })}>
              {name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Variables">
        {config.varNames.map((name) => (
          <option key={`s:${name}`} value={formatAxisValue({ kind: 'state', name })}>
            {name}
          </option>
        ))}
      </optgroup>
    </>
  )
  const axes = [
    { key: 'x', value: diagram.xAxis, update: (axis: BifurcationAxis | null) => ({ xAxis: axis }) },
    { key: 'y', value: diagram.yAxis, update: (axis: BifurcationAxis | null) => ({ yAxis: axis }) },
  ] as const
  return (
    <div className="viewport-axis-controls">
      {axes.map((axis) => (
        <label className="viewport-axis-controls__field" key={axis.key}>
          <span>{axis.key}</span>
          <select
            value={formatAxisValue(axis.value)}
            onChange={(event) =>
              onUpdateBifurcationDiagram(diagram.id, axis.update(parseAxisValue(event.target.value)))
            }
            data-testid={`viewport-axis-${axis.key}-${diagram.id}`}
          >
            <option value="">—</option>
            {options}
          </select>
        </label>
      ))}
    </div>
  )
}
