import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import type { Scene } from '../../../system/types'

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
              <div className="inspector-subsection">
                <h4 className="section-head">
                  <span>Items</span>
                  {sceneSelectedIds.length === 0 ? (
                    <span className="chip" data-testid="scene-showing-chip">
                      {scene.display === 'selection' ? 'showing: selection' : 'showing: all visible'}
                    </span>
                  ) : (
                    <span className="chip">{`${sceneSelectedIds.length} selected`}</span>
                  )}
                </h4>
                <label title="Used when no items are checked below">
                  Fallback
                  <select
                    value={scene.display}
                    onChange={(event) =>
                      onUpdateScene(scene.id, {
                        display: event.target.value as Scene['display'],
                      })
                    }
                    data-testid="scene-display"
                  >
                    <option value="all">All visible</option>
                    <option value="selection">Current selection</option>
                  </select>
                </label>
                <input
                  value={sceneSearch}
                  onChange={(event) => setSceneSearch(event.target.value)}
                  placeholder="Filter objects and branches…"
                  aria-label="Search objects and branches"
                  data-testid="scene-object-search"
                />
                {displayedEntries.length > 0 ? (
                  <div className="scene-object-list">
                    {displayedEntries.map((entry) => {
                      const checked = sceneSelectedSet.has(entry.id)
                      return (
                        <label
                          key={`scene-entry-${entry.id}`}
                          className="scene-object-row"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? sceneSelectedIds.filter((id) => id !== entry.id)
                                : [...sceneSelectedIds, entry.id]
                              onUpdateScene(scene.id, { selectedNodeIds: next })
                            }}
                          />
                          <span className="scene-object-row__name">{entry.name}</span>
                          <span className="scene-object-row__meta">
                            {entry.type.replace('_', ' ')}
                            {entry.visible ? '' : ' · hidden'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <p className="faint">—</p>
                )}
              </div>
            </div>
          ) : null}
  </>
}
