import type { InspectorSelectionController } from '../../InspectorDetailsPanel'

export function DiagramInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    axisOptions,
    branchEntries,
    diagram,
    diagramFilteredBranches,
    diagramSearch,
    diagramSelectedEntries,
    diagramSelectedIds,
    diagramSelectedSet,
    formatAxisValue,
    onUpdateBifurcationDiagram,
    parseAxisValue,
    setDiagramSearch,
  } = scope
  return <>
{diagram ? (
            <div className="inspector-section">
              <h3>Bifurcation Diagram</h3>
              {axisOptions.length > 0 ? (
                <>
                  <label>
                    Abscissa
                    <select
                      value={formatAxisValue(diagram.xAxis)}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          xAxis: parseAxisValue(event.target.value),
                        })
                      }
                      data-testid="diagram-x-param"
                    >
                      <option value="">Unassigned</option>
                      {axisOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ordinate
                    <select
                      value={formatAxisValue(diagram.yAxis)}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          yAxis: parseAxisValue(event.target.value),
                        })
                      }
                      data-testid="diagram-y-param"
                    >
                      <option value="">Unassigned</option>
                      {axisOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="empty-state">
                  Add parameters or state space variables to configure axes.
                </p>
              )}
              {branchEntries.length > 0 ? (
                <div className="inspector-subsection">
                  <h4 className="inspector-subheading">Displayed branches</h4>
                  <label>
                    Search branches
                    <input
                      value={diagramSearch}
                      onChange={(event) => setDiagramSearch(event.target.value)}
                      placeholder="Type to filter…"
                      data-testid="diagram-branch-search"
                    />
                  </label>
                  {diagramSelectedEntries.length > 0 ? (
                    <div className="scene-object-selected">
                      {diagramSelectedEntries.map((entry) => (
                        <div
                          className="scene-object-selected__row"
                          key={`diagram-sel-${entry.id}`}
                        >
                          <div className="scene-object-selected__info">
                            <span>{entry.name}</span>
                            <span className="scene-object-selected__meta">
                              {entry.type} · {entry.points} points
                              {entry.visible ? '' : ' · hidden'}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="scene-object-selected__remove"
                            onClick={() => {
                              const next = diagramSelectedIds.filter((id) => id !== entry.id)
                              onUpdateBifurcationDiagram(diagram.id, {
                                selectedBranchIds: next,
                              })
                            }}
                            aria-label={`Remove ${entry.name} from diagram`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">
                      No branches selected yet. Showing all visible branches by default. Use
                      the list below to add branches to this diagram.
                    </p>
                  )}
                  {diagramFilteredBranches.length > 0 ? (
                    <div className="scene-object-list">
                      {diagramFilteredBranches.map((entry) => {
                        const checked = diagramSelectedSet.has(entry.id)
                        return (
                          <label
                            key={`diagram-entry-${entry.id}`}
                            className="scene-object-row"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? diagramSelectedIds.filter((id) => id !== entry.id)
                                  : [...diagramSelectedIds, entry.id]
                                onUpdateBifurcationDiagram(diagram.id, {
                                  selectedBranchIds: next,
                                })
                              }}
                            />
                            <span className="scene-object-row__name">{entry.name}</span>
                            <span className="scene-object-row__meta">
                              {entry.type} · {entry.points} points
                              {entry.visible ? '' : ' · hidden'}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="empty-state">No branches match this search.</p>
                  )}
                </div>
              ) : (
                <p className="empty-state">No branches available yet.</p>
              )}
            </div>
          ) : null}
  </>
}
