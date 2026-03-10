import { useEffect, useMemo, useState } from 'react'
import type { AnalysisAxisSpec, AnalysisViewport, System, SystemConfig } from '../system/types'
import {
  collectAnalysisSourceEntries,
  normalizeAnalysisExpressionError,
  resolveAnalysisAxisLabel,
  resolveAnalysisConstraintExpressions,
  resolveAnalysisEventExpression,
  resolveAnalysisSourceExpression,
} from '../analysis/analysisViewportUtils'

type AnalysisViewportInspectorProps = {
  system: System
  viewport: AnalysisViewport
  onUpdateAnalysisViewport: (
    id: string,
    update: Partial<Omit<AnalysisViewport, 'id' | 'name'>>
  ) => void
  onValidateAnalysisExpression?: (
    request: {
      system: SystemConfig
      expression: string
      role: 'event' | 'observable'
    },
    opts?: { signal?: AbortSignal }
  ) => Promise<void>
}

type AxisKey = 'x' | 'y' | 'z'
type AxisErrors = Record<AxisKey, string | null>
type ConstraintErrors = Array<string | null>

function defaultObservableAxis(system: System, hitOffset: number): AnalysisAxisSpec {
  const expression = system.config.varNames[0] ?? system.config.paramNames[0] ?? 'x'
  return { kind: 'observable', expression, hitOffset, label: null }
}

function axisKindValue(axis: AnalysisAxisSpec | null | undefined): string {
  return axis?.kind ?? 'none'
}

function eventModeOptions(
  system: System
): Array<{ value: AnalysisViewport['event']['mode']; label: string }> {
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

function primaryVariable(system: System): string {
  return system.config.varNames[0] ?? ''
}

function parseInteger(value: string, fallback = 0): number {
  const next = Number(value)
  return Number.isFinite(next) ? Math.trunc(next) : fallback
}

export function AnalysisViewportInspector({
  system,
  viewport,
  onUpdateAnalysisViewport,
  onValidateAnalysisExpression,
}: AnalysisViewportInspectorProps) {
  const [sourceSearch, setSourceSearch] = useState('')
  const [eventError, setEventError] = useState<string | null>(null)
  const [axisErrors, setAxisErrors] = useState<AxisErrors>({ x: null, y: null, z: null })
  const [constraintErrors, setConstraintErrors] = useState<ConstraintErrors>([])
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
  const eventExpression = useMemo(
    () => resolveAnalysisEventExpression(system.config, viewport.event),
    [system.config, viewport.event]
  )
  const eventSourceKind = viewport.event.source.kind
  const eventSourceVariable = useMemo(() => {
    if (viewport.event.source.kind === 'custom') return primaryVariable(system)
    return system.config.varNames.includes(viewport.event.source.variableName)
      ? viewport.event.source.variableName
      : primaryVariable(system)
  }, [system, viewport.event.source])
  const resolvedSourceExpression = useMemo(
    () => resolveAnalysisSourceExpression(system.config, viewport.event.source),
    [system.config, viewport.event.source]
  )
  const positivityConstraints = useMemo(
    () => resolveAnalysisConstraintExpressions(viewport.event),
    [viewport.event]
  )

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        let nextEventError: string | null = null
        const nextAxisErrors: AxisErrors = { x: null, y: null, z: null }
        const nextConstraintErrors: ConstraintErrors = positivityConstraints.map(() => null)

        if (viewport.event.mode !== 'every_iterate') {
          if (eventExpression.trim().length === 0) {
            nextEventError = 'Expression is required.'
          } else if (onValidateAnalysisExpression) {
            try {
              await onValidateAnalysisExpression(
                { system: system.config, expression: eventExpression, role: 'event' },
                { signal: controller.signal }
              )
            } catch (error) {
              if (!(error instanceof Error && error.name === 'AbortError')) {
                nextEventError = normalizeAnalysisExpressionError(
                  error instanceof Error ? error.message : String(error)
                )
              }
            }
          }
        }

        for (let index = 0; index < positivityConstraints.length; index += 1) {
          const expression = positivityConstraints[index] ?? ''
          if (expression.trim().length === 0) {
            nextConstraintErrors[index] = 'Expression is required.'
            continue
          }
          if (!onValidateAnalysisExpression) continue
          try {
            await onValidateAnalysisExpression(
              { system: system.config, expression, role: 'observable' },
              { signal: controller.signal }
            )
          } catch (error) {
            if (!(error instanceof Error && error.name === 'AbortError')) {
              nextConstraintErrors[index] = normalizeAnalysisExpressionError(
                error instanceof Error ? error.message : String(error)
              )
            }
          }
        }

        const axes: Array<[AxisKey, AnalysisAxisSpec | null | undefined]> = [
          ['x', viewport.axes.x],
          ['y', viewport.axes.y],
          ['z', viewport.axes.z],
        ]
        for (const [key, axis] of axes) {
          if (axis?.kind !== 'observable') continue
          if (axis.expression.trim().length === 0) {
            nextAxisErrors[key] = 'Expression is required.'
            continue
          }
          if (!onValidateAnalysisExpression) continue
          try {
            await onValidateAnalysisExpression(
              { system: system.config, expression: axis.expression, role: 'observable' },
              { signal: controller.signal }
            )
          } catch (error) {
            if (!(error instanceof Error && error.name === 'AbortError')) {
              nextAxisErrors[key] = normalizeAnalysisExpressionError(
                error instanceof Error ? error.message : String(error)
              )
            }
          }
        }

        if (!controller.signal.aborted) {
          setEventError(nextEventError)
          setAxisErrors(nextAxisErrors)
          setConstraintErrors(nextConstraintErrors)
        }
      })()
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [
    eventExpression,
    onValidateAnalysisExpression,
    positivityConstraints,
    system.config,
    viewport.axes,
    viewport.event,
  ])

  const updateAxis = (key: AxisKey, nextAxis: AnalysisAxisSpec | null) => {
    onUpdateAnalysisViewport(viewport.id, {
      axes: {
        ...viewport.axes,
        [key]: nextAxis,
      },
    })
  }

  const updateConstraints = (positivityConstraintValues: string[]) => {
    onUpdateAnalysisViewport(viewport.id, {
      event: {
        ...viewport.event,
        positivityConstraints: positivityConstraintValues,
      },
    })
  }

  const renderAxisEditor = (
    key: AxisKey,
    title: string,
    axis: AnalysisAxisSpec | null,
    options?: { allowNone?: boolean }
  ) => {
    const allowNone = options?.allowNone ?? false
    return (
      <div className="inspector-subsection" key={`analysis-axis-${key}`}>
        <h4 className="inspector-subheading">{title}</h4>
        <label>
          Axis value
          <select
            value={axisKindValue(axis)}
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
                updateAxis(key, {
                  kind: 'delta_time',
                  hitOffset: axis?.kind === 'delta_time' ? axis.hitOffset : 0,
                  label: axis?.label ?? null,
                })
                return
              }
              updateAxis(
                key,
                axis?.kind === 'observable'
                  ? axis
                  : defaultObservableAxis(system, key === 'y' ? 1 : 0)
              )
            }}
          >
            {allowNone ? <option value="none">Disabled</option> : null}
            <option value="observable">Observable expression</option>
            <option value="hit_index">Hit index</option>
            <option value="delta_time">Delta n</option>
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
                      updateAxis(key, { ...axis, expression: event.target.value })
                    }
                    placeholder="State or parameter expression"
                    data-testid={`analysis-axis-expression-${key}`}
                  />
                </label>
                {axisErrors[key] ? (
                  <div
                    className="field-error"
                    data-testid={`analysis-axis-expression-error-${key}`}
                  >
                    {axisErrors[key]}
                  </div>
                ) : null}
              </>
            ) : null}
            {axis.kind === 'observable' || axis.kind === 'delta_time' ? (
              <>
                <label>
                  Hit offset
                  <input
                    type="number"
                    step={1}
                    value={axis.hitOffset}
                    onChange={(event) =>
                      updateAxis(key, {
                        ...axis,
                        hitOffset: parseInteger(event.target.value),
                      })
                    }
                    data-testid={`analysis-axis-hit-offset-${key}`}
                  />
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
      <h3>Event Map</h3>
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
        {viewport.event.mode === 'every_iterate' ? (
          <p className="empty-state">
            Every iterate uses each landing iterate directly. Event expression and level are ignored
            in this mode.
          </p>
        ) : (
          <>
            <label>
              Source
              <select
                value={eventSourceKind}
                onChange={(event) => {
                  const nextKind = event.target.value as
                    | 'custom'
                    | 'flow_derivative'
                    | 'map_increment'
                  if (nextKind === 'custom') {
                    onUpdateAnalysisViewport(viewport.id, {
                      event: {
                        ...viewport.event,
                        source:
                          viewport.event.source.kind === 'custom'
                            ? viewport.event.source
                            : { kind: 'custom', expression: resolvedSourceExpression },
                      },
                    })
                    return
                  }
                  onUpdateAnalysisViewport(viewport.id, {
                    event: {
                      ...viewport.event,
                      source: { kind: nextKind, variableName: eventSourceVariable },
                    },
                  })
                }}
                data-testid="analysis-event-source-kind"
              >
                <option value="custom">Custom expression</option>
                {system.config.type === 'map' ? (
                  <option value="map_increment">Map increment (x_n+1 - x_n)</option>
                ) : (
                  <option value="flow_derivative">Time derivative (dx/dt)</option>
                )}
              </select>
            </label>
            {eventSourceKind === 'custom' ? (
              <label>
                Expression
                <input
                  value={viewport.event.source.kind === 'custom' ? viewport.event.source.expression : ''}
                  onChange={(event) =>
                    onUpdateAnalysisViewport(viewport.id, {
                      event: {
                        ...viewport.event,
                        source: { kind: 'custom', expression: event.target.value },
                      },
                    })
                  }
                  placeholder="State or parameter expression"
                  data-testid="analysis-event-expression"
                />
              </label>
            ) : (
              <label>
                Variable
                <select
                  value={eventSourceVariable}
                  onChange={(event) =>
                    onUpdateAnalysisViewport(viewport.id, {
                      event: {
                        ...viewport.event,
                        source: {
                          kind: eventSourceKind as 'flow_derivative' | 'map_increment',
                          variableName: event.target.value,
                        },
                      },
                    })
                  }
                  data-testid="analysis-event-source-variable"
                >
                  {system.config.varNames.map((name) => (
                    <option key={`analysis-event-var-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {eventError ? (
              <div className="field-error" data-testid="analysis-event-expression-error">
                {eventError}
              </div>
            ) : null}
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
            <p className="empty-state" data-testid="analysis-event-resolved-expression">
              f(x, p) = {eventExpression || '∅'}
            </p>
          </>
        )}
        <div className="inspector-subsection">
          <h4 className="inspector-subheading">Positivity constraints</h4>
          <p className="empty-state">
            Keep only hits where every listed expression is strictly positive. Leave this empty to
            accept all hits.
          </p>
          {positivityConstraints.length > 0 ? (
            <>
              {positivityConstraints.map((constraint, index) => (
                <div key={`analysis-constraint-${index}`}>
                  <label>
                    Constraint {index + 1}
                    <input
                      value={constraint}
                      onChange={(event) => {
                        const next = [...positivityConstraints]
                        next[index] = event.target.value
                        updateConstraints(next)
                      }}
                      placeholder="Expression > 0"
                      data-testid={`analysis-constraint-expression-${index}`}
                    />
                  </label>
                  {constraintErrors[index] ? (
                    <div
                      className="field-error"
                      data-testid={`analysis-constraint-expression-error-${index}`}
                    >
                      {constraintErrors[index]}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      updateConstraints(
                        positivityConstraints.filter((_, constraintIndex) => constraintIndex !== index)
                      )
                    }
                    data-testid={`analysis-remove-constraint-${index}`}
                  >
                    Remove constraint
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="empty-state" data-testid="analysis-constraints-empty">
              No positivity constraints.
            </p>
          )}
          <button
            type="button"
            onClick={() => updateConstraints([...positivityConstraints, ''])}
            data-testid="analysis-add-constraint"
          >
            Add positivity constraint
          </button>
        </div>
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
