import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import type { Scene } from '../../../system/types'
import { SourceChecklist } from './SourceChecklist'

export function SceneInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    maxSceneAxes,
    onUpdateScene,
    scene,
    sceneAxisSelection,
    sceneFilteredEntries,
    sceneSearch,
    sceneSelectedEntries,
    sceneSelectableEntries,
    sceneSelectedIds,
    sceneSelectedSet,
    setSceneSearch,
    showSceneAxisPicker,
    system,
    updateSceneAxisCount,
    updateSceneAxisVariable,
  } = scope
  const selectedEntriesById = new Map(sceneSelectedEntries.map((entry) => [entry.id, entry]))
  const displayedEntries = [
    ...sceneSelectedIds.map((id) => selectedEntriesById.get(id) ?? {
      id,
      name: system.nodes[id]?.name ?? id,
      type: 'Unavailable source — uncheck to remove',
      visible: true,
    }),
    ...sceneFilteredEntries.filter((entry) => !sceneSelectedSet.has(entry.id)),
  ]
  return <>
{scene ? (
            <div className="inspector-section">
              {showSceneAxisPicker && sceneAxisSelection ? (
                <div className="inspector-subsection">
                  <h4 className="section-head">Axes</h4>
                  <div className="inspector-form-grid">
                  <label>
                    Count
                    <select
                      value={sceneAxisSelection.length}
                      onChange={(event) => updateSceneAxisCount(Number(event.target.value))}
                      data-testid="scene-axis-count"
                    >
                      {Array.from({ length: maxSceneAxes }, (_, index) => index + 1).map(
                        (count) => (
                          <option key={`scene-axis-count-${count}`} value={count}>
                            {count}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <label>
                    x
                    <select
                      value={sceneAxisSelection[0]}
                      onChange={(event) => updateSceneAxisVariable(0, event.target.value)}
                      data-testid="scene-axis-x"
                    >
                      {system.config.varNames.map((name) => (
                        <option
                          key={`scene-axis-x-${name}`}
                          value={name}
                          disabled={name !== sceneAxisSelection[0] && sceneAxisSelection.includes(name)}
                        >
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sceneAxisSelection.length >= 2 ? (
                    <label>
                      y
                      <select
                        value={sceneAxisSelection[1]}
                        onChange={(event) => updateSceneAxisVariable(1, event.target.value)}
                        data-testid="scene-axis-y"
                      >
                        {system.config.varNames.map((name) => (
                          <option
                            key={`scene-axis-y-${name}`}
                            value={name}
                            disabled={
                              name !== sceneAxisSelection[1] && sceneAxisSelection.includes(name)
                            }
                          >
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {sceneAxisSelection.length >= 3 ? (
                    <label>
                      z
                      <select
                        value={sceneAxisSelection[2]}
                        onChange={(event) => updateSceneAxisVariable(2, event.target.value)}
                        data-testid="scene-axis-z"
                      >
                        {system.config.varNames.map((name) => (
                          <option
                            key={`scene-axis-z-${name}`}
                            value={name}
                            disabled={
                              name !== sceneAxisSelection[2] && sceneAxisSelection.includes(name)
                            }
                          >
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  </div>
                </div>
              ) : null}
              <SourceChecklist
                title="Items"
                entries={displayedEntries.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  meta: `${entry.type.replace('_', ' ')}${entry.visible ? '' : ' · hidden'}`,
                }))}
                selectedIds={sceneSelectedIds}
                implicitIds={
                  scene.display === 'selection'
                    ? null
                    : (sceneSelectableEntries ?? sceneFilteredEntries)
                        .filter((entry) => entry.visible)
                        .map((entry) => entry.id)
                }
                onChange={(next) => onUpdateScene(scene.id, { selectedNodeIds: next })}
                mode={{
                  value: scene.display === 'selection' ? 'selection' : 'all',
                  onChange: (display) => onUpdateScene(scene.id, { display: display as Scene['display'] }),
                  testId: 'scene-display',
                }}
                search={{
                  value: sceneSearch,
                  onChange: setSceneSearch,
                  placeholder: 'Filter objects and branches…',
                  ariaLabel: 'Search objects and branches',
                  testId: 'scene-object-search',
                }}
                chipTestId="scene-showing-chip"
              />
            </div>
          ) : null}
  </>
}
