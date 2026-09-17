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
    system,
  } = scope
  const selectedEntriesById = new Map(diagramSelectedEntries.map((entry) => [entry.id, entry]))
  const displayedEntries = [
    ...diagramSelectedIds.map((id) => selectedEntriesById.get(id) ?? {
      id,
      name: system.nodes[id]?.name ?? id,
      type: 'Unavailable branch — uncheck to remove',
      points: null,
      visible: true,
    }),
    ...diagramFilteredBranches.filter((entry) => !diagramSelectedSet.has(entry.id)),
  ]
  return <>
{diagram ? (
            <div className="inspector-section">
              <h3>Bifurcation diagram</h3>
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
              {branchEntries.length > 0 || diagramSelectedIds.length > 0 ? (
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
                  {diagramSelectedIds.length === 0 ? (
                    <p className="empty-state">
                      No branches selected yet. Showing all visible branches by default. Use
                      the list below to select branches for this diagram.
                    </p>
                  ) : null}
                  {displayedEntries.length > 0 ? (
                    <div className="scene-object-list">
                      {displayedEntries.map((entry) => {
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
                              {entry.type}{entry.points === null ? '' : ` · ${entry.points} points`}
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
