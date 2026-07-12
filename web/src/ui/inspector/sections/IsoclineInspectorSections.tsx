import type { InspectorSelectionController } from '../../InspectorDetailsPanel'

export function IsoclineInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    StateTable,
    formatPointValues,
    handleClearParamOverride,
    handleComputeIsocline,
    handleParamOverrideChange,
    handlePasteParamOverride,
    handleToggleIsoclineAxis,
    handleUpdateIsocline,
    handleUpdateIsoclineAxisField,
    handleUpdateIsoclineFrozenValue,
    hasParamOverride,
    isMapSystem,
    isocline,
    isoclineActiveAxes,
    isoclineActiveSet,
    isoclineAxisDrafts,
    isoclineComputing,
    isoclineError,
    isoclineFrozenDrafts,
    isoclineFrozenVariables,
    isoclineLevelDraft,
    isoclineMaxActiveVariables,
    isoclineResolvedExpression,
    isoclineSourceKind,
    isoclineSourceVariable,
    isoclineStale,
    paramOverrideDraft,
    paramOverrideError,
    parseDraftNumber,
    selectionKey,
    setIsoclineError,
    setIsoclineLevelDraft,
    systemDraft,
    writeClipboardText,
  } = scope
  return <>
{isocline ? (
            <InspectorDisclosure
              key={`${selectionKey}-isocline`}
              title="Isocline"
              testId="isocline-toggle"
              actionOnly
            >
              <div className="inspector-section">
                <label>
                  Source
                  <select
                    value={isoclineSourceKind}
                    onChange={(event) => {
                      const nextKind = event.target.value as
                        | 'custom'
                        | 'flow_derivative'
                        | 'map_increment'
                      if (nextKind === 'custom') {
                        handleUpdateIsocline({
                          source:
                            isocline.source.kind === 'custom'
                              ? isocline.source
                              : { kind: 'custom', expression: isoclineResolvedExpression },
                        })
                        return
                      }
                      handleUpdateIsocline({
                        source: {
                          kind: nextKind,
                          variableName: isoclineSourceVariable,
                        },
                      })
                    }}
                    data-testid="isocline-source-kind"
                  >
                    <option value="custom">Custom expression</option>
                    {isMapSystem ? (
                      <option value="map_increment">Map increment (x_n+1 - x_n)</option>
                    ) : (
                      <option value="flow_derivative">Time derivative (dx/dt)</option>
                    )}
                  </select>
                </label>

                {isoclineSourceKind === 'custom' ? (
                  <label>
                    Expression
                    <input
                      value={isocline.source.kind === 'custom' ? isocline.source.expression : ''}
                      onChange={(event) =>
                        handleUpdateIsocline({
                          source: {
                            kind: 'custom',
                            expression: event.target.value,
                          },
                        })
                      }
                      placeholder="x + y"
                      data-testid="isocline-expression"
                    />
                  </label>
                ) : (
                  <label>
                    Variable
                    <select
                      value={isoclineSourceVariable}
                      onChange={(event) =>
                        handleUpdateIsocline({
                          source: {
                            kind: isoclineSourceKind as 'flow_derivative' | 'map_increment',
                            variableName: event.target.value,
                          },
                        })
                      }
                      data-testid="isocline-source-variable"
                    >
                      {systemDraft.varNames.map((name) => (
                        <option key={`isocline-source-var-${name}`} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  Isocline value
                  <input
                    type="text"
                    inputMode="decimal"
                    value={isoclineLevelDraft}
                    onChange={(event) => {
                      const raw = event.target.value
                      setIsoclineError(null)
                      setIsoclineLevelDraft(raw)
                      const parsed = parseDraftNumber(raw)
                      if (parsed === null) return
                      handleUpdateIsocline({ level: parsed })
                    }}
                    data-testid="isocline-level"
                  />
                </label>
                <p className="empty-state" data-testid="isocline-resolved-expression">
                  f(x, p) = {isoclineResolvedExpression || '∅'}
                </p>

                <div className="inspector-subsection">
                  <h4 className="inspector-subheading">
                    Active variables ({Math.min(isocline.axes.length, isoclineMaxActiveVariables)}/
                    {isoclineMaxActiveVariables})
                  </h4>
                  <div className="isocline-axis-selector">
                    {systemDraft.varNames.map((name) => {
                      const active = isoclineActiveSet.has(name)
                      const disableActivate =
                        !active && isocline.axes.length >= isoclineMaxActiveVariables
                      return (
                        <label key={`isocline-axis-toggle-${name}`} className="isocline-axis-toggle">
                          <input
                            type="checkbox"
                            checked={active}
                            disabled={disableActivate}
                            onChange={(event) =>
                              handleToggleIsoclineAxis(name, event.target.checked)
                            }
                            data-testid={`isocline-axis-active-${name}`}
                          />
                          <span>{name}</span>
                        </label>
                      )
                    })}
                  </div>
                  {isoclineActiveAxes.length > 0 ? (
                    <div
                      className="state-table__wrap"
                      role="region"
                      aria-label="Isocline active variable ranges"
                    >
                      <table className="state-table__grid isocline-axis-table">
                        <thead>
                          <tr>
                            <th>Variable</th>
                            <th>Min</th>
                            <th>Max</th>
                            <th>Samples</th>
                          </tr>
                        </thead>
                        <tbody>
                          {isoclineActiveAxes.map((axis) => (
                            <tr key={`isocline-axis-row-${axis.variableName}`}>
                              <td className="isocline-table__label">{axis.variableName}</td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="state-table__input"
                                  value={isoclineAxisDrafts[axis.variableName]?.min ?? axis.min.toString()}
                                  onChange={(event) =>
                                    handleUpdateIsoclineAxisField(
                                      axis.variableName,
                                      'min',
                                      event.target.value
                                    )
                                  }
                                  data-testid={`isocline-axis-min-${axis.variableName}`}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="state-table__input"
                                  value={isoclineAxisDrafts[axis.variableName]?.max ?? axis.max.toString()}
                                  onChange={(event) =>
                                    handleUpdateIsoclineAxisField(
                                      axis.variableName,
                                      'max',
                                      event.target.value
                                    )
                                  }
                                  data-testid={`isocline-axis-max-${axis.variableName}`}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="state-table__input"
                                  value={
                                    isoclineAxisDrafts[axis.variableName]?.samples ??
                                    axis.samples.toString()
                                  }
                                  onChange={(event) =>
                                    handleUpdateIsoclineAxisField(
                                      axis.variableName,
                                      'samples',
                                      event.target.value
                                    )
                                  }
                                  data-testid={`isocline-axis-samples-${axis.variableName}`}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="empty-state">Select at least one active variable.</p>
                  )}
                </div>

                {isoclineFrozenVariables.length > 0 ? (
                  <div className="inspector-subsection" data-testid="isocline-frozen-table">
                    <h4 className="inspector-subheading">Frozen variables</h4>
                    <div
                      className="state-table__wrap"
                      role="region"
                      aria-label="Isocline frozen variables"
                    >
                      <table className="state-table__grid isocline-frozen-table">
                        <thead>
                          <tr>
                            <th>Variable</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {isoclineFrozenVariables.map(({ name, index, value }) => (
                            <tr key={`isocline-frozen-row-${name}`}>
                              <td className="isocline-table__label">{name}</td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="state-table__input"
                                  value={isoclineFrozenDrafts[name] ?? value.toString()}
                                  onChange={(event) =>
                                    handleUpdateIsoclineFrozenValue(
                                      name,
                                      index,
                                      event.target.value
                                    )
                                  }
                                  data-testid={`isocline-frozen-${name}`}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="inspector-subsection" data-testid="isocline-parameter-table">
                  <StateTable
                    title="Isocline parameters"
                    varNames={systemDraft.paramNames}
                    values={paramOverrideDraft}
                    onChange={handleParamOverrideChange}
                    onCopy={() => void writeClipboardText(formatPointValues(paramOverrideDraft))}
                    onPaste={handlePasteParamOverride}
                    emptyMessage="No parameters defined yet."
                    testIdPrefix="param-override"
                  />
                  {hasParamOverride ? (
                    <div className="inspector-inline-actions">
                      <button
                        type="button"
                        className="inspector-inline-button"
                        onClick={handleClearParamOverride}
                        data-testid="param-override-clear"
                      >
                        Restore default parameters
                      </button>
                    </div>
                  ) : null}
                  {paramOverrideError ? <div className="field-error">{paramOverrideError}</div> : null}
                </div>

                {!isocline.lastComputed ? (
                  <p className="empty-state" data-testid="isocline-not-computed">
                    Not computed yet.
                  </p>
                ) : (
                  <p className="empty-state" data-testid="isocline-last-computed">
                    Last computed at {isocline.lastComputed.computedAt}
                  </p>
                )}
                {isoclineStale ? (
                  <div className="field-warning" data-testid="isocline-stale-indicator">
                    Settings changed since the last compute.
                  </div>
                ) : null}
                {isoclineError ? <div className="field-error">{isoclineError}</div> : null}
                <button
                  type="button"
                  onClick={() => void handleComputeIsocline()}
                  disabled={isoclineComputing}
                  data-testid="isocline-compute"
                >
                  {isoclineComputing ? 'Computing...' : 'Compute'}
                </button>
              </div>
            </InspectorDisclosure>
          ) : null}
  </>
}
