import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { SourceChecklist } from './SourceChecklist'

type AxisOption = { value: string; label: string; kind: 'parameter' | 'state' }

/** Axis choices grouped by kind, with bare names like the viewport header picker. */
function AxisOptionGroups({ options }: { options: AxisOption[] }) {
  const params = options.filter((option) => option.kind === 'parameter')
  const states = options.filter((option) => option.kind === 'state')
  return (
    <>
      {params.length > 0 ? (
        <optgroup label="Parameters">
          {params.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      {states.length > 0 ? (
        <optgroup label="Variables">
          {states.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  )
}

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
                      <option value="">—</option>
                      <AxisOptionGroups options={axisOptions} />
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
                      <option value="">—</option>
                      <AxisOptionGroups options={axisOptions} />
                    </select>
                  </label>
                </div>
              ) : null}
              {branchEntries.length > 0 || diagramSelectedIds.length > 0 ? (
                <SourceChecklist
                  title="Branches"
                  entries={displayedEntries.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    meta: `${entry.type}${entry.points === null ? '' : ` · ${entry.points} points`}${
                      entry.visible ? '' : ' · hidden'
                    }`,
                  }))}
                  selectedIds={diagramSelectedIds}
                  implicitIds={branchEntries
                    .filter((entry) => entry.visible)
                    .map((entry) => entry.id)}
                  onChange={(next) =>
                    onUpdateBifurcationDiagram(diagram.id, { selectedBranchIds: next })
                  }
                  search={{
                    value: diagramSearch,
                    onChange: setDiagramSearch,
                    placeholder: 'Filter branches…',
                    ariaLabel: 'Search branches',
                    testId: 'diagram-branch-search',
                  }}
                  chipTestId="diagram-showing-chip"
                />
              ) : null}
            </div>
          ) : null}
  </>
}
