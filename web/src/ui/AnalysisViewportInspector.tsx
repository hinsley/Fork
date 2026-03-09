import { useMemo, useState } from 'react'
import type { AnalysisAxisSpec, AnalysisViewport, System } from '../system/types'
import {
  collectAnalysisSourceEntries,
  resolveAnalysisAxisLabel,
} from '../analysis/analysisViewportUtils'

type AnalysisViewportInspectorProps = {
  system: System
  viewport: AnalysisViewport
  onUpdateAnalysisViewport: (
    id: string,
    update: Partial<Omit<AnalysisViewport, 'id' | 'name'>>
  ) => void
}

function defaultObservableAxis(system: System, hitOffset: -1 | 0 | 1): AnalysisAxisSpec {
  const expression = system.config.varNames[0] ?? system.config.paramNames[0] ?? 'x'
  return {
    kind: 'observable',
    expression,
    hitOffset,
    label: null,
  }
}

function axisKindValue(axis: AnalysisAxisSpec | null | undefined): string {
  if (!axis) return 'none'
  return axis.kind
}

function eventModeOptions(system: System): Array<{ value: AnalysisViewport['event']['mode']; label: string }> {
  const options: Array<{ value: AnalysisViewport['event']['mode']; label: string }> = [
    { value: 'cross_up', label: 'Crossing up' },
    { value: 'cross_down', label: 'Crossing down' },
    { value: 'cross_either', label: 'Crossing either way' },
  ]
  if (system.config.type === 'map') {
    options.unshift({ value: 'every_iterate', label: 'Every iterate' })
  }
  return options
}

export function AnalysisViewportInspector({
  system,
  viewport,
  onUpdateAnalysisViewport,
}: AnalysisViewportInspectorProps) {
  const [sourceSearch, setSourceSearch] = useState('')
  const sourceEntries = useMemo(() => collectAnalysisSourceEntries(system), [system])
  const selectedSourceSet = useMemo(
    () => new Set(viewport.sourceNodeIds),
    [viewport.sourceNodeIds]
  )
  const filteredEntries = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase()
    if (!query) return sourceEntries
    return sourceEntries.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(query) ||
        entry.typeLabel.toLowerCase().includes(query)
      )
    })
  }, [sourceEntries, sourceSearch])
  const selectedEntries = useMemo(
    () => sourceEntries.filter((entry) => selectedSourceSet.has(entry.id)),
    [selectedSourceSet, sourceEntries]
  )

  const updateAxes = (update: Partial<AnalysisViewport['axes']>) => {
    onUpdateAnalysisViewport(viewport.id, {
      axes: {
        ...viewport.axes,
        ...update,
      },
    })
  }

  const updateAxis = (
    key: 'x' | 'y' | 'z',
    nextAxis: AnalysisAxisSpec | null
  ) => {
    updateAxes({ [key]: nextAxis } as Partial<AnalysisViewport['axes']>)
  }

  const renderAxisEditor = (
    key: 'x' | 'y' | 'z',
    title: string,
    axis: AnalysisAxisSpec | null,
    options?: { allowNone?: boolean }
  ) => {
    const allowNone = options?.allowNone ?? false
    const kind = axisKindValue(axis)
    return (
      <div className="inspector-subsection" key={`analysis-axis-${key}`}>
        <h4 className="inspector-subheading">{title}</h4>
        <label>
          Axis value
          <select
            value={kind}
            onChange={(event) => {
              const nextKind = event.target.value
              if (nextKind === 'none') {
                updateAxis(key, null)
                return
              }
              if (nextKind === 'hit_index') {
                updateAxis(key, { kind: 'hit_index', label: axis?.label ?? null })
                return
              }
              if (nextKind === 'delta_time') {
                updateAxis(key, { kind: 'delta_time', label: axis?.label ?? null })
                return
              }
              updateAxis(
                key,
                axis && axis.kind === 'observable'
                  ? axis
                  : defaultObservableAxis(system, key === 'y' ? 1 : 0)
              )
            }}
          >
            {allowNone ? <option value="none">Disabled</option> : null}
            <option value="observable">Observable expression</option>
            <option value="hit_index">Hit index</option>
            <option value="delta_time">Delta t</option>
          </select>
        </label>
        {axis ? (
          <>
            <label>
              Label
              <input
                value={axis.label ?? ''}
                onChange={(event) => updateAxis(key, { ...axis, label: event.target.value })}
                placeholder={resolveAnalysisAxisLabel(axis)}
              />
            </label>
            {axis.kind === 'observable' ? (
              <>
                <label>
                  Expression
                  <input
                    value={axis.expression}
                    onChange={(event) =>
                      updateAxis(key, {
                        ...axis,
                        expression: event.target.value,
                      })
                    }
                    placeholder="State or parameter expression"
                  />
                </label>
                <label>
                  Sampled hit
                  <select
                    value={axis.hitOffset}
                    onChange={(event) =>
                      updateAxis(key, {
                        ...axis,
                        hitOffset: Number(event.target.value) as -1 | 0 | 1,
                      })
                    }
                  >
                    <option value={-1}>n-1</option>
                    <option value={0}>n</option>
                    <option value={1}>n+1</option>
                  </select>
                </label>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="inspector-section">
      <h3>Return / Event Map</h3>
      <div className="inspector-subsection">
        <h4 className="inspector-subheading">Sources</h4>
        <label>
          Fallback display
          <select
            value={viewport.display}
            onChange={(event) =>
              onUpdateAnalysisViewport(viewport.id, {
                display: event.target.value as AnalysisViewport['display'],
              })
            }
            data-testid="analysis-display"
          >
            <option value="all">All visible compatible sources</option>
            <option value="selection">Selected compatible source</option>
          </select>
        </label>
        <p className="empty-state">
          Explicitly selected sources override the fallback mode. Axis expressions can use state
          variables and system parameters.
        </p>
        <label>
          Search compatible sources
          <input
            value={sourceSearch}
            onChange={(event) => setSourceSearch(event.target.value)}
            placeholder="Type to filter…"
          />
        </label>
        {selectedEntries.length > 0 ? (
          <div className="scene-object-selected">
            {selectedEntries.map((entry) => (
              <div className="scene-object-selected__row" key={`analysis-sel-${entry.id}`}>
                <div className="scene-object-selected__info">
                  <span>{entry.name}</span>
                  <span className="scene-object-selected__meta">
                    {entry.typeLabel}
                    {entry.visible ? '' : ' · hidden'}
                  </span>
                </div>
                <button
                  type="button"
                  className="scene-object-selected__remove"
                  onClick={() => {
                    onUpdateAnalysisViewport(viewport.id, {
                      sourceNodeIds: viewport.sourceNodeIds.filter((id) => id !== entry.id),
                    })
                  }}
                  aria-label={`Remove ${entry.name} from analysis viewport`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            {viewport.display === 'selection'
              ? 'No explicit sources selected. The current compatible selection will be used.'
              : 'No explicit sources selected. All visible compatible sources will be used.'}
          </p>
        )}
        {filteredEntries.length > 0 ? (
          <div className="scene-object-list">
            {filteredEntries.map((entry) => {
              const checked = selectedSourceSet.has(entry.id)
              return (
                <label key={`analysis-entry-${entry.id}`} className="scene-object-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? viewport.sourceNodeIds.filter((id) => id !== entry.id)
                        : [...viewport.sourceNodeIds, entry.id]
                      onUpdateAnalysisViewport(viewport.id, { sourceNodeIds: next })
                    }}
                  />
                  <span className="scene-object-row__name">{entry.name}</span>
                  <span className="scene-object-row__meta">
                    {entry.typeLabel}
                    {entry.visible ? '' : ' · hidden'}
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="empty-state">No compatible sources match this search.</p>
        )}
      </div>

      <div className="inspector-subsection">
        <h4 className="inspector-subheading">Event</h4>
        <label>
          Event mode
          <select
            value={viewport.event.mode}
            onChange={(event) =>
              onUpdateAnalysisViewport(viewport.id, {
                event: {
                  ...viewport.event,
                  mode: event.target.value as AnalysisViewport['event']['mode'],
                },
              })
            }
            data-testid="analysis-event-mode"
          >
            {eventModeOptions(system).map((option) => (
              <option key={`analysis-mode-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Event expression
          <input
            value={viewport.event.expression}
            onChange={(event) =>
              onUpdateAnalysisViewport(viewport.id, {
                event: {
                  ...viewport.event,
                  expression: event.target.value,
                },
              })
            }
            placeholder="State or parameter expression"
            data-testid="analysis-event-expression"
          />
        </label>
        <label>
          Event level
          <input
            type="number"
            value={viewport.event.level}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateAnalysisViewport(viewport.id, {
                event: {
                  ...viewport.event,
                  level: Number.isFinite(value) ? value : 0,
                },
              })
            }}
            step="any"
            data-testid="analysis-event-level"
          />
        </label>
      </div>

      <div className="inspector-subsection">
        <h4 className="inspector-subheading">Axes</h4>
        {renderAxisEditor('x', 'X axis', viewport.axes.x)}
        {renderAxisEditor('y', 'Y axis', viewport.axes.y)}
        {renderAxisEditor('z', 'Z axis', viewport.axes.z ?? null, { allowNone: true })}
      </div>

      <div className="inspector-subsection">
        <h4 className="inspector-subheading">Advanced</h4>
        <label>
          Skip hits
          <input
            type="number"
            min={0}
            step={1}
            value={viewport.advanced.skipHits}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateAnalysisViewport(viewport.id, {
                advanced: {
                  ...viewport.advanced,
                  skipHits: Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
                },
              })
            }}
          />
        </label>
        <label>
          Hit stride
          <input
            type="number"
            min={1}
            step={1}
            value={viewport.advanced.hitStride}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateAnalysisViewport(viewport.id, {
                advanced: {
                  ...viewport.advanced,
                  hitStride: Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1,
                },
              })
            }}
          />
        </label>
        <label>
          Max hits
          <input
            type="number"
            min={1}
            step={1}
            value={viewport.advanced.maxHits}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateAnalysisViewport(viewport.id, {
                advanced: {
                  ...viewport.advanced,
                  maxHits: Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1,
                },
              })
            }}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={viewport.advanced.connectPoints}
            onChange={(event) =>
              onUpdateAnalysisViewport(viewport.id, {
                advanced: {
                  ...viewport.advanced,
                  connectPoints: event.target.checked,
                },
              })
            }
          />
          Connect plotted hits
        </label>
      </div>
    </div>
  )
}
