import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { InspectorSubDisclosure } from '../selectionSession'

export function OrbitInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    InspectorMetrics,
    StateTable,
    buildSuggestedBranchName,
    clvColors,
    clvHasData,
    clvIndices,
    clvNeeds2d,
    clvRender,
    clvVisibleSet,
    continuationParameterCount,
    continuationParameterLabels,
    covariantDraft,
    covariantError,
    formatFixed,
    formatNumber,
    formatPointValues,
    frozenVariableHeaderNames,
    handleClvColorChange,
    handleClvVisibilityChange,
    handleComputeCovariant,
    handleComputeLyapunov,
    handleCreateLimitCycleFromOrbit,
    handleOrbitPreviewJump,
    handlePasteOrbitState,
    handleRunOrbit,
    isDiscreteMap,
    limitCycleFromOrbitBranchSuggestion,
    limitCycleFromOrbitDraft,
    limitCycleFromOrbitError,
    limitCycleFromOrbitNameSuggestion,
    lyapunovDimension,
    lyapunovDraft,
    lyapunovError,
    onOrbitPointSelect,
    orbit,
    orbitDraft,
    orbitError,
    orbitPreviewEnd,
    orbitPreviewError,
    orbitPreviewInput,
    orbitPreviewPage,
    orbitPreviewPageCount,
    orbitPreviewRows,
    orbitPreviewStart,
    orbitPreviewVarNames,
    runDisabled,
    selectedNodeId,
    selectedOrbitPoint,
    selectedOrbitPointIndex,
    selectedOrbitState,
    selectionKey,
    setCovariantDraft,
    setLimitCycleFromOrbitDraft,
    setLyapunovDraft,
    setOrbitDraft,
    setOrbitPreviewError,
    setOrbitPreviewInput,
    setOrbitPreviewPageIndex,
    systemDraft,
    updateClvRender,
    writeClipboardText,
  } = scope
  return <>
{orbit ? (
            <>
              <InspectorDisclosure
                key={`${selectionKey}-orbit-run`}
                title="Orbit Simulation"
                testId="orbit-run-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before running orbits.
                    </div>
                  ) : null}
                  <StateTable
                    title="Initial state"
                    varNames={frozenVariableHeaderNames}
                    values={orbitDraft.initialState}
                    onChange={(next) =>
                      setOrbitDraft((prev) => ({ ...prev, initialState: next }))
                    }
                    onCopy={() =>
                      void writeClipboardText(formatPointValues(orbitDraft.initialState))
                    }
                    onPaste={handlePasteOrbitState}
                    testIdPrefix="orbit-run-ic"
                  />
                  <label>
                    {systemDraft.type === 'map' ? 'Iterations' : 'Duration'}
                    <input
                      type="number"
                      value={orbitDraft.duration}
                      onChange={(event) =>
                        setOrbitDraft((prev) => ({ ...prev, duration: event.target.value }))
                      }
                      data-testid="orbit-run-duration"
                    />
                  </label>
                  {systemDraft.type === 'flow' ? (
                    <label>
                      Step size (dt)
                      <input
                        type="number"
                        value={orbitDraft.dt}
                        onChange={(event) =>
                          setOrbitDraft((prev) => ({ ...prev, dt: event.target.value }))
                        }
                        data-testid="orbit-run-dt"
                      />
                    </label>
                  ) : null}
                  {orbitError ? <div className="field-error">{orbitError}</div> : null}
                  <button
                    onClick={handleRunOrbit}
                    disabled={runDisabled}
                    data-testid="orbit-run-submit"
                  >
                    Run Orbit
                  </button>
                </div>
              </InspectorDisclosure>

              {orbit.data.length > 0 ? (
                <InspectorDisclosure
                key={`${selectionKey}-orbit-data`}
                title="Orbit Data"
                testId="orbit-data-toggle"
              >
                <InspectorSubDisclosure title="Summary" testId="orbit-data-summary-toggle">
                  <div className="inspector-section">
                    <InspectorMetrics
                      rows={[
                        { label: 'System', value: orbit.systemName },
                        { label: 'Data points', value: orbit.data.length.toLocaleString() },
                        {
                          label: 'Time range',
                          value:
                            orbit.data.length > 0
                              ? `${formatFixed(orbit.t_start, 3)} to ${formatFixed(orbit.t_end, 3)}`
                              : 'n/a',
                        },
                        { label: 'Step size (dt)', value: formatFixed(orbit.dt, 4) },
                        ...(lyapunovDimension !== null
                          ? [
                              {
                                label: 'Lyapunov dimension',
                                value: formatNumber(lyapunovDimension, 6),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                </InspectorSubDisclosure>
                <InspectorSubDisclosure
                  title="Parameters (last run)"
                  testId="orbit-data-parameters-toggle"
                >
                  <div className="inspector-section">
                    {orbit.parameters && orbit.parameters.length > 0 ? (
                      <InspectorMetrics
                        rows={orbit.parameters.map((value, index) => ({
                          label: systemDraft.paramNames[index] || `p${index + 1}`,
                          value: formatNumber(value, 6),
                        }))}
                      />
                    ) : (
                      <p className="empty-state">Parameters not recorded yet.</p>
                    )}
                    {orbit.parameters && orbit.parameters.length > 0 ? (
                      <div className="inspector-inline-actions">
                        <button
                          type="button"
                          className="inspector-inline-button"
                          onClick={() =>
                            void writeClipboardText(formatPointValues(orbit.parameters ?? []))
                          }
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </div>
                </InspectorSubDisclosure>
                <InspectorSubDisclosure title="Data preview" testId="orbit-data-preview-toggle">
                  <div className="inspector-section">
                  {orbit.data.length > 0 ? (
                    <div className="orbit-preview">
                      <div className="orbit-preview__controls">
                        <div className="inspector-row inspector-row--nav">
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(0)}
                            disabled={orbitPreviewPage <= 0}
                            data-testid="orbit-preview-start"
                          >
                            Start
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(orbitPreviewPage - 1)}
                            disabled={orbitPreviewPage <= 0}
                            data-testid="orbit-preview-prev"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(orbitPreviewPage + 1)}
                            disabled={orbitPreviewPage >= orbitPreviewPageCount - 1}
                            data-testid="orbit-preview-next"
                          >
                            Next
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(orbitPreviewPageCount - 1)}
                            disabled={orbitPreviewPage >= orbitPreviewPageCount - 1}
                            data-testid="orbit-preview-end"
                          >
                            End
                          </button>
                        </div>
                        <span className="orbit-preview__page">
                          Page {orbitPreviewPage + 1} of {orbitPreviewPageCount}
                        </span>
                        <label>
                          Jump to page
                          <div className="inspector-row orbit-preview__jump">
                            <input
                              type="number"
                              min={1}
                              max={orbitPreviewPageCount}
                              value={orbitPreviewInput}
                              onChange={(event) => {
                                setOrbitPreviewInput(event.target.value)
                                setOrbitPreviewError(null)
                              }}
                              data-testid="orbit-preview-page-input"
                            />
                            <button
                              type="button"
                              onClick={handleOrbitPreviewJump}
                              data-testid="orbit-preview-page-jump"
                            >
                              Jump
                            </button>
                          </div>
                        </label>
                        {orbitPreviewError ? (
                          <div className="field-error">{orbitPreviewError}</div>
                        ) : null}
                        <div className="orbit-preview__summary">
                          Showing {orbitPreviewStart + 1}–{orbitPreviewEnd} of{' '}
                          {orbit.data.length.toLocaleString()}
                        </div>
                        {selectedOrbitPoint ? (
                          <div className="inspector-inline-actions">
                            <span className="inspector-meta">
                              Selected point #{selectedOrbitPointIndex}{' '}
                              {selectedOrbitPoint[0] !== undefined
                                ? `· t=${formatFixed(selectedOrbitPoint[0], 3)}`
                                : ''}
                            </span>
                            {selectedOrbitState ? (
                              <button
                                type="button"
                                className="inspector-inline-button"
                                onClick={() =>
                                  void writeClipboardText(
                                    formatPointValues(selectedOrbitState)
                                  )
                                }
                              >
                                Copy state
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="orbit-preview__table"
                        role="region"
                        aria-label="Orbit data preview"
                      >
                        <table className="orbit-preview__table-grid">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>t</th>
                              {orbitPreviewVarNames.map((name, index) => (
                                <th key={`orbit-preview-col-${index}`}>{name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {orbitPreviewRows.map((point, rowIndex) => {
                              const pointIndex = orbitPreviewStart + rowIndex
                              const isSelected = pointIndex === selectedOrbitPointIndex
                              return (
                                <tr
                                  key={`orbit-preview-row-${pointIndex}`}
                                  className={isSelected ? 'is-selected' : undefined}
                                  onClick={() => {
                                    if (!onOrbitPointSelect || !selectedNodeId) return
                                    onOrbitPointSelect({
                                      orbitId: selectedNodeId,
                                      pointIndex,
                                    })
                                  }}
                                >
                                  <td>{pointIndex}</td>
                                  <td>{formatFixed(point[0], 3)}</td>
                                  {orbitPreviewVarNames.map((_, varIndex) => (
                                    <td key={`orbit-preview-cell-${rowIndex}-${varIndex}`}>
                                      {formatFixed(point[varIndex + 1] ?? Number.NaN, 4)}
                                    </td>
                                  ))}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="empty-state">No orbit samples stored yet.</p>
                  )}
                  </div>
                </InspectorSubDisclosure>
                </InspectorDisclosure>
              ) : null}

              {orbit.data.length >= 2 ? (
                <InspectorDisclosure
                key={`${selectionKey}-oseledets`}
                title="Lyapunov Analysis"
                testId="oseledets-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before computing Lyapunov data.
                    </div>
                  ) : null}
                  {!orbit.data || orbit.data.length < 2 ? (
                    <p className="empty-state">Run an orbit to enable Lyapunov analysis.</p>
                  ) : null}
                  <h4 className="inspector-subheading">Lyapunov exponents</h4>
                  {orbit.lyapunovExponents && orbit.lyapunovExponents.length > 0 ? (
                    <InspectorMetrics
                      rows={[
                        ...orbit.lyapunovExponents.map((value, index) => ({
                          label: `λ${index + 1}`,
                          value: formatFixed(value, 6),
                        })),
                        ...(lyapunovDimension !== null
                          ? [
                              {
                                label: 'Lyapunov dimension',
                                value: formatNumber(lyapunovDimension, 6),
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : (
                    <p className="empty-state">Lyapunov exponents not computed yet.</p>
                  )}
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Transient iterations to discard'
                      : 'Transient time to discard'}
                    <input
                      type="number"
                      value={lyapunovDraft.transient}
                      onChange={(event) =>
                        setLyapunovDraft((prev) => ({
                          ...prev,
                          transient: event.target.value,
                        }))
                      }
                      data-testid="lyapunov-transient"
                    />
                  </label>
                  <label>
                    Steps between QR decompositions
                    <input
                      type="number"
                      value={lyapunovDraft.qrStride}
                      onChange={(event) =>
                        setLyapunovDraft((prev) => ({
                          ...prev,
                          qrStride: event.target.value,
                        }))
                      }
                      data-testid="lyapunov-qr"
                    />
                  </label>
                  {lyapunovError ? <div className="field-error">{lyapunovError}</div> : null}
                  <button
                    onClick={handleComputeLyapunov}
                    disabled={runDisabled}
                    data-testid="lyapunov-submit"
                  >
                    Compute Lyapunov Exponents
                  </button>
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Covariant Lyapunov vectors</h4>
                  {orbit.covariantVectors && orbit.covariantVectors.vectors.length > 0 ? (
                    <>
                      <InspectorMetrics
                        rows={[
                          {
                            label: 'Checkpoints',
                            value: orbit.covariantVectors.vectors.length.toLocaleString(),
                          },
                          { label: 'Dimension', value: orbit.covariantVectors.dim },
                          {
                            label: 'Time span',
                            value:
                              orbit.covariantVectors.times.length > 0
                                ? `${formatFixed(orbit.covariantVectors.times[0], 3)} to ${formatFixed(
                                    orbit.covariantVectors.times[
                                      orbit.covariantVectors.times.length - 1
                                    ],
                                    3
                                  )}`
                                : 'n/a',
                          },
                        ]}
                      />
                      {orbit.covariantVectors.vectors[0] ? (
                        <div className="inspector-data">
                          {orbit.covariantVectors.vectors[0].map((vec, index) => (
                            <div key={`clv-${index}`}>
                              v{index + 1}: [{vec.map((value) => formatFixed(value, 4)).join(', ')}
                              ]
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="empty-state">Covariant Lyapunov vectors not computed yet.</p>
                  )}
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Transient iterations to discard'
                      : 'Transient time to discard'}
                    <input
                      type="number"
                      value={covariantDraft.transient}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          transient: event.target.value,
                        }))
                      }
                      data-testid="clv-transient"
                    />
                  </label>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Forward transient (pre-window steps)'
                      : 'Forward transient (pre-window)'}
                    <input
                      type="number"
                      value={covariantDraft.forward}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          forward: event.target.value,
                        }))
                      }
                      data-testid="clv-forward"
                    />
                  </label>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Backward transient (post-window steps)'
                      : 'Backward transient (post-window)'}
                    <input
                      type="number"
                      value={covariantDraft.backward}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          backward: event.target.value,
                        }))
                      }
                      data-testid="clv-backward"
                    />
                  </label>
                  <label>
                    Steps between QR decompositions
                    <input
                      type="number"
                      value={covariantDraft.qrStride}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          qrStride: event.target.value,
                        }))
                      }
                      data-testid="clv-qr"
                    />
                  </label>
                  {covariantError ? <div className="field-error">{covariantError}</div> : null}
                  <button
                    onClick={handleComputeCovariant}
                    disabled={runDisabled}
                    data-testid="clv-submit"
                  >
                    Compute Covariant Vectors
                  </button>
                </div>
                {clvHasData ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-clv-plot`}
                    title="CLV Plotting"
                    testId="clv-plot-toggle"
                    defaultOpen={false}
                  >
                    <div className="inspector-section">
                      {clvNeeds2d ? (
                        <div className="field-warning">
                          CLV plotting requires at least two state variables.
                        </div>
                      ) : null}
                      <label>
                        Show CLV vectors
                        <input
                          type="checkbox"
                          checked={clvRender.enabled}
                          onChange={(event) =>
                            updateClvRender({ enabled: event.target.checked })
                          }
                          data-testid="clv-plot-enabled"
                        />
                      </label>
                      <label>
                        Stride (plot every Nth checkpoint)
                        <input
                          type="number"
                          min={1}
                          value={clvRender.stride}
                          onChange={(event) =>
                            updateClvRender({ stride: Number(event.target.value) })
                          }
                          data-testid="clv-plot-stride"
                        />
                      </label>
                      <label>
                        Arrow length (fraction of orbit size)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={clvRender.lengthScale}
                          onChange={(event) =>
                            updateClvRender({ lengthScale: Number(event.target.value) })
                          }
                          data-testid="clv-plot-length"
                        />
                      </label>
                      <label>
                        Arrowhead scale
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={clvRender.headScale}
                          onChange={(event) =>
                            updateClvRender({ headScale: Number(event.target.value) })
                          }
                          data-testid="clv-plot-head-scale"
                        />
                      </label>
                      <label>
                        Arrow thickness (px)
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={clvRender.thickness}
                          onChange={(event) =>
                            updateClvRender({ thickness: Number(event.target.value) })
                          }
                          data-testid="clv-plot-thickness"
                        />
                      </label>
                    </div>
                    <div className="inspector-section">
                      <h4 className="inspector-subheading">Vector colors</h4>
                      {clvIndices.length > 0 ? (
                        <div className="inspector-list">
                          {clvIndices.map((index, idx) => {
                            const visible = clvVisibleSet.has(index)
                            return (
                              <div className="clv-control-row" key={`clv-color-${index}`}>
                                <span className="clv-control-row__label">CLV {index + 1}</span>
                                <input
                                  type="checkbox"
                                  checked={visible}
                                  onChange={(event) =>
                                    handleClvVisibilityChange(index, event.target.checked)
                                  }
                                  aria-label={`Show CLV ${index + 1}`}
                                  data-testid={`clv-plot-show-${index}`}
                                />
                                <input
                                  type="color"
                                  value={clvColors[idx]}
                                  onChange={(event) =>
                                    handleClvColorChange(index, event.target.value)
                                  }
                                  disabled={!visible}
                                  aria-label={`CLV ${index + 1} color`}
                                  data-testid={`clv-plot-color-${index}`}
                                />
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="empty-state">Covariant vectors not computed yet.</p>
                      )}
                    </div>
                  </InspectorDisclosure>
                ) : null}
                </InspectorDisclosure>
              ) : null}

              {!isDiscreteMap && orbit.data.length > 0 ? (
                <InspectorDisclosure
                  key={`${selectionKey}-limit-cycle`}
                  title="Limit Cycle"
                  testId="limit-cycle-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    <h4 className="inspector-subheading">Continue from Orbit</h4>
                    {continuationParameterCount === 0 ? (
                      <p className="empty-state">Add a parameter before continuing.</p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {orbit && orbit.data.length === 0 ? (
                      <p className="empty-state">Run an orbit before continuing.</p>
                    ) : null}
                    {continuationParameterCount === 0 ||
                    !orbit ||
                    orbit.data.length === 0 ? null : (
                    <>
                      <label>
                        Limit cycle name
                        <input
                          value={limitCycleFromOrbitDraft.limitCycleName}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              limitCycleName: event.target.value,
                            }))
                          }
                          placeholder={limitCycleFromOrbitNameSuggestion}
                          data-testid="limit-cycle-from-orbit-name"
                        />
                      </label>
                      <label>
                        Branch name
                        <input
                          value={limitCycleFromOrbitDraft.branchName}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              branchName: event.target.value,
                            }))
                          }
                          placeholder={limitCycleFromOrbitBranchSuggestion}
                          data-testid="limit-cycle-from-orbit-branch-name"
                        />
                      </label>
                      <label>
                        Continuation parameter
                        <select
                          value={limitCycleFromOrbitDraft.parameterName}
                          onChange={(event) => {
                            const nextParameterName = event.target.value
                            setLimitCycleFromOrbitDraft((prev) => {
                              const baseName =
                                prev.limitCycleName.trim() || limitCycleFromOrbitNameSuggestion
                              const prevSuggestedName = buildSuggestedBranchName(
                                baseName,
                                prev.parameterName
                              )
                              const nextSuggestedName = buildSuggestedBranchName(
                                baseName,
                                nextParameterName
                              )
                              const shouldUpdateName = prev.branchName === prevSuggestedName
                              return {
                                ...prev,
                                parameterName: nextParameterName,
                                branchName: shouldUpdateName
                                  ? nextSuggestedName
                                  : prev.branchName,
                              }
                            })
                          }}
                          data-testid="limit-cycle-from-orbit-parameter"
                        >
                          {continuationParameterLabels.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Cycle detection tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.tolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              tolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-tolerance"
                        />
                      </label>
                      <label>
                        NTST
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.ntst}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              ntst: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-ntst"
                        />
                        <span className="field-help">Mesh intervals along the cycle.</span>
                      </label>
                      <label>
                        NCOL
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.ncol}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              ncol: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-ncol"
                        />
                        <span className="field-help">Collocation points per mesh interval.</span>
                      </label>
                      <label>
                        Direction
                        <select
                          value={limitCycleFromOrbitDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-direction"
                        >
                          <option value="forward">Forward (Increasing Param)</option>
                          <option value="backward">Backward (Decreasing Param)</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.stepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.maxSteps}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-max-steps"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.minStepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-min-step-size"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.maxStepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-max-step-size"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.correctorSteps}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.correctorTolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.stepTolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-step-tolerance"
                        />
                      </label>
                      {limitCycleFromOrbitError ? (
                        <div className="field-error">{limitCycleFromOrbitError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateLimitCycleFromOrbit}
                        disabled={
                          runDisabled ||
                          continuationParameterCount === 0 ||
                          orbit.data.length === 0
                        }
                        data-testid="limit-cycle-from-orbit-submit"
                      >
                        Continue Limit Cycle
                      </button>
                    </>
                    )}
                  </div>
                </InspectorDisclosure>
              ) : null}
            </>
          ) : null}
  </>
}
