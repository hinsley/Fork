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
              {axisOptions.length > 0 ? (
                <div className="inspector-form-grid">
                  <label>
                    x axis
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
                    y axis
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
                </div>
              ) : (
                <p className="faint">—</p>
              )}
              {branchEntries.length > 0 || diagramSelectedIds.length > 0 ? (
                <div className="inspector-subsection">
                  <h4 className="section-head">
                    <span>Branches</span>
                    <span className="chip" data-testid="diagram-showing-chip">
                      {diagramSelectedIds.length === 0
                        ? 'showing: all visible'
                        : `${diagramSelectedIds.length} selected`}
                    </span>
                  </h4>
                  <input
                    value={diagramSearch}
                    onChange={(event) => setDiagramSearch(event.target.value)}
                    placeholder="Filter branches…"
                    aria-label="Search branches"
                    data-testid="diagram-branch-search"
                  />
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
                    <p className="faint">—</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
  </>
}
