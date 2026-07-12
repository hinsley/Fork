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
  return <>
{scene ? (
            <div className="inspector-section">
              <h3>Scene</h3>
              {showSceneAxisPicker && sceneAxisSelection ? (
                <div className="inspector-subsection">
                  <h4 className="inspector-subheading">State space axes</h4>
                  <label>
                    Axis count
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
                    X axis
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
                      Y axis
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
                      Z axis
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
              ) : null}
              <div className="inspector-subsection">
                <h4 className="inspector-subheading">Displayed items</h4>
                <label>
                  Fallback display
                  <select
                    value={scene.display}
                    onChange={(event) =>
                      onUpdateScene(scene.id, {
                        display: event.target.value as Scene['display'],
                      })
                    }
                    data-testid="scene-display"
                  >
                    <option value="all">All visible objects and branches</option>
                    <option value="selection">Selected object or branch</option>
                  </select>
                </label>
                <p className="empty-state">Used when no items are selected below.</p>
                <label>
                  Search objects and branches
                  <input
                    value={sceneSearch}
                    onChange={(event) => setSceneSearch(event.target.value)}
                    placeholder="Type to filter…"
                    data-testid="scene-object-search"
                  />
                </label>
                {sceneSelectedEntries.length > 0 ? (
                  <div className="scene-object-selected">
                    {sceneSelectedEntries.map((entry) => (
                      <div className="scene-object-selected__row" key={`scene-sel-${entry.id}`}>
                        <div className="scene-object-selected__info">
                          <span>{entry.name}</span>
                          <span className="scene-object-selected__meta">
                            {entry.type.replace('_', ' ')}
                            {entry.visible ? '' : ' · hidden'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="scene-object-selected__remove"
                          onClick={() => {
                            const next = sceneSelectedIds.filter((id) => id !== entry.id)
                            onUpdateScene(scene.id, { selectedNodeIds: next })
                          }}
                          aria-label={`Remove ${entry.name} from scene`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">
                    {scene.display === 'selection'
                      ? 'No items selected yet. Showing the current selection by default.'
                      : 'No items selected yet. Showing all visible items by default.'}{' '}
                    Use the list below to add objects or branches to this scene.
                  </p>
                )}
                {sceneFilteredEntries.length > 0 ? (
                  <div className="scene-object-list">
                    {sceneFilteredEntries.map((entry) => {
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
                  <p className="empty-state">No scene items match this search.</p>
                )}
              </div>
            </div>
          ) : null}
  </>
}
