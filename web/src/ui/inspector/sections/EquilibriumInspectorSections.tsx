import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../system/subsystemGateway'
import type { ManifoldStability, ManifoldDirection } from '../../../system/types'
import type { EquilibriumManifoldProfileDraft } from '../../manifoldProfileDrafts'
import { InspectorSubDisclosure } from '../selectionSession'

type EquilibriumManifoldMode = 'curve_1d' | 'surface_2d'

export function EquilibriumInspectorSections({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    InspectorMetrics,
    PlotlyViewport,
    StateTable,
    buildSuggestedBranchName,
    continuationDraft,
    continuationError,
    continuationParameterCount,
    continuationParameterLabels,
    equilibrium,
    equilibriumContinuationBaseName,
    equilibriumCyclePoints,
    equilibriumDisplayState,
    equilibriumDraft,
    equilibriumEigenPlot,
    equilibriumEigenpairs,
    equilibriumEigenvectorColors,
    equilibriumEigenvectorIndices,
    equilibriumEigenvectorRender,
    equilibriumEigenvectorVisibleSet,
    equilibriumError,
    equilibriumHasEigenvectors,
    equilibriumLabel,
    equilibriumLabelLower,
    equilibriumLabelPluralLower,
    equilibriumManifoldDraft,
    equilibriumManifoldEligibleIndexOptions,
    equilibriumManifoldEligibleRealIndexOptions,
    equilibriumManifoldError,
    equilibriumManifoldModeOptions,
    existingBranchNames,
    formatComplexValue,
    formatFixed,
    formatNumber,
    formatPointValues,
    formatPolarValue,
    formatScientific,
    frozenVariableHeaderNames,
    handleCreateEquilibriumBranch,
    handleCreateEquilibriumManifold,
    handleEquilibriumEigenvectorColorChange,
    handleEquilibriumEigenvectorVisibilityChange,
    handlePasteEquilibriumGuess,
    handleSolveEquilibrium,
    isDiscreteMap,
    isRealEigenvalue,
    makeSurfaceProfileDefaults,
    runDisabled,
    selectionKey,
    setContinuationDraft,
    setEquilibriumDraft,
    setEquilibriumManifoldDraft,
    showEquilibriumEigenvectorControls,
    systemDraft,
    updateEquilibriumEigenvectorRender,
    writeClipboardText,
  } = scope
  return <>
{equilibrium ? (
            <>
              <InspectorDisclosure
                key={`${selectionKey}-equilibrium-solver`}
                title={`${equilibriumLabel} Solver`}
                testId="equilibrium-solver-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      {`Apply valid system changes before solving ${equilibriumLabelPluralLower}.`}
                    </div>
                  ) : null}
                  <StateTable
                    title="Initial state"
                    varNames={frozenVariableHeaderNames}
                    values={equilibriumDraft.initialGuess}
                    onChange={(next) =>
                      setEquilibriumDraft((prev) => ({ ...prev, initialGuess: next }))
                    }
                    onCopy={() =>
                      void writeClipboardText(
                        formatPointValues(equilibriumDraft.initialGuess)
                      )
                    }
                    onPaste={handlePasteEquilibriumGuess}
                    testIdPrefix="equilibrium-solve-guess"
                  />
                  <label>
                    Max steps
                    <input
                      type="number"
                      value={equilibriumDraft.maxSteps}
                      onChange={(event) =>
                        setEquilibriumDraft((prev) => ({ ...prev, maxSteps: event.target.value }))
                      }
                      data-testid="equilibrium-solve-steps"
                    />
                  </label>
                  <label>
                    Damping
                    <input
                      type="number"
                      value={equilibriumDraft.dampingFactor}
                      onChange={(event) =>
                        setEquilibriumDraft((prev) => ({
                          ...prev,
                          dampingFactor: event.target.value,
                        }))
                      }
                      data-testid="equilibrium-solve-damping"
                    />
                  </label>
                  {systemDraft.type === 'map' ? (
                    <label>
                      Cycle length
                      <input
                        type="number"
                        value={equilibriumDraft.mapIterations}
                        onChange={(event) =>
                          setEquilibriumDraft((prev) => ({
                            ...prev,
                            mapIterations: event.target.value,
                          }))
                        }
                        data-testid="equilibrium-solve-cycle-length"
                      />
                    </label>
                  ) : null}
                  {equilibriumError ? <div className="field-error">{equilibriumError}</div> : null}
                  <button
                    onClick={handleSolveEquilibrium}
                    disabled={runDisabled}
                    data-testid="equilibrium-solve-submit"
                  >
                    Solve {equilibriumLabel}
                  </button>
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Residual and iterations</h4>
                  {equilibrium.solution ? (
                    <InspectorMetrics
                      rows={[
                        {
                          label: 'Residual',
                          value: formatScientific(equilibrium.solution.residual_norm, 6),
                        },
                        {
                          label: 'Iterations',
                          value: equilibrium.solution.iterations,
                        },
                      ]}
                    />
                  ) : (
                    <p className="empty-state">No residual available until solved.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Last solver attempt</h4>
                  {equilibrium.lastRun ? (
                    <InspectorMetrics
                      rows={[
                        { label: 'Timestamp', value: equilibrium.lastRun.timestamp },
                        {
                          label: 'Result',
                          value: equilibrium.lastRun.success ? 'Success' : 'Failed',
                        },
                        ...(equilibrium.lastRun.residual_norm !== undefined
                          ? [
                              {
                                label: 'Residual',
                                value: formatScientific(equilibrium.lastRun.residual_norm, 6),
                              },
                            ]
                          : []),
                        ...(equilibrium.lastRun.iterations !== undefined
                          ? [
                              {
                                label: 'Iterations',
                                value: equilibrium.lastRun.iterations,
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : (
                    <p className="empty-state">Solver has not been run yet.</p>
                  )}
                </div>
              </InspectorDisclosure>

              {equilibrium.solution ? (
                <InspectorDisclosure
                key={`${selectionKey}-equilibrium-data`}
                title={`${equilibriumLabel} Data`}
                testId="equilibrium-data-toggle"
                actionOnly
              >
                <InspectorSubDisclosure
                  title="Coordinates"
                  testId="equilibrium-data-coordinates-toggle"
                >
                  <div className="inspector-section">
                    {equilibrium.solution && equilibriumDisplayState ? (
                      <InspectorMetrics
                        rows={frozenVariableHeaderNames.map((name, index) => ({
                          label: name,
                          value: formatNumber(equilibriumDisplayState[index] ?? Number.NaN, 6),
                        }))}
                      />
                    ) : (
                      <p className="empty-state">{`No stored ${equilibriumLabelLower} solution yet.`}</p>
                    )}
                    {equilibrium.solution ? (
                      <div className="inspector-inline-actions">
                        <button
                          type="button"
                          className="inspector-inline-button"
                          onClick={() =>
                            void writeClipboardText(
                              formatPointValues(equilibriumDisplayState ?? [])
                            )
                          }
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </div>
                </InspectorSubDisclosure>
                {isDiscreteMap ? (
                  <InspectorSubDisclosure
                    title="Cycle points"
                    testId="equilibrium-data-cycle-points-toggle"
                  >
                    <div className="inspector-section">
                      {equilibriumCyclePoints && equilibriumCyclePoints.length > 0 ? (
                        <div
                          className="orbit-preview__table"
                          role="region"
                          aria-label="Cycle point data"
                        >
                        <table className="orbit-preview__table-grid">
                          <thead>
                            <tr>
                              <th>#</th>
                              {frozenVariableHeaderNames.map((name, index) => (
                                <th key={`equilibrium-cycle-col-${index}`}>
                                  {name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {equilibriumCyclePoints.map((point, rowIndex) => (
                              <tr key={`equilibrium-cycle-row-${rowIndex}`}>
                                <td>{rowIndex}</td>
                                {frozenVariableHeaderNames.map((_, varIndex) => (
                                  <td
                                    key={`equilibrium-cycle-cell-${rowIndex}-${varIndex}`}
                                  >
                                    {formatFixed(point[varIndex] ?? Number.NaN, 4)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      ) : (
                        <p className="empty-state">No cycle points stored yet.</p>
                      )}
                      {equilibriumCyclePoints && equilibriumCyclePoints.length > 0 ? (
                        <div className="inspector-inline-actions">
                          <button
                            type="button"
                            className="inspector-inline-button"
                            onClick={() =>
                              void writeClipboardText(
                                equilibriumCyclePoints
                                  .map((point) => formatPointValues(point))
                                  .join('\n')
                              )
                            }
                          >
                            Copy
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </InspectorSubDisclosure>
                ) : null}
                <InspectorSubDisclosure
                  title="Parameters (last solve)"
                  testId="equilibrium-data-parameters-toggle"
                >
                  <div className="inspector-section">
                    {equilibrium.parameters && equilibrium.parameters.length > 0 ? (
                      <InspectorMetrics
                        rows={equilibrium.parameters.map((value, index) => ({
                          label: systemDraft.paramNames[index] || `p${index + 1}`,
                          value: formatNumber(value, 6),
                        }))}
                      />
                    ) : (
                      <p className="empty-state">Parameters not recorded yet.</p>
                    )}
                    {equilibrium.parameters && equilibrium.parameters.length > 0 ? (
                      <div className="inspector-inline-actions">
                        <button
                          type="button"
                          className="inspector-inline-button"
                          onClick={() =>
                            void writeClipboardText(formatPointValues(equilibrium.parameters ?? []))
                          }
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </div>
                </InspectorSubDisclosure>
                <InspectorSubDisclosure
                  title="Eigenpairs"
                  testId="equilibrium-data-eigenpairs-toggle"
                >
                  <div className="inspector-section">
                  {equilibrium.solution && equilibrium.solution.eigenpairs.length > 0 ? (
                    <div className="inspector-list">
                      {showEquilibriumEigenvectorControls ? (
                        <>
                          {!equilibriumHasEigenvectors ? (
                            <p className="empty-state">Eigenvectors not computed yet.</p>
                          ) : null}
                          <label>
                            Show eigenvectors
                            <input
                              type="checkbox"
                              checked={equilibriumEigenvectorRender.enabled}
                              onChange={(event) =>
                                updateEquilibriumEigenvectorRender({
                                  enabled: event.target.checked,
                                })
                              }
                              data-testid="equilibrium-eigenvector-enabled"
                            />
                          </label>
                          <label>
                            Eigenline length (fraction of scene)
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={equilibriumEigenvectorRender.lineLengthScale}
                              onChange={(event) =>
                                updateEquilibriumEigenvectorRender({
                                  lineLengthScale: Number(event.target.value),
                                })
                              }
                              data-testid="equilibrium-eigenvector-line-length"
                            />
                          </label>
                          <label>
                            Eigenline thickness (px)
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={equilibriumEigenvectorRender.lineThickness}
                              onChange={(event) =>
                                updateEquilibriumEigenvectorRender({
                                  lineThickness: Number(event.target.value),
                                })
                              }
                              data-testid="equilibrium-eigenvector-line-thickness"
                            />
                          </label>
                          <label>
                            Eigenspace disc radius (fraction of scene)
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={equilibriumEigenvectorRender.discRadiusScale}
                              onChange={(event) =>
                                updateEquilibriumEigenvectorRender({
                                  discRadiusScale: Number(event.target.value),
                                })
                              }
                              data-testid="equilibrium-eigenvector-disc-radius"
                            />
                          </label>
                          <label>
                            Eigenspace disc thickness (px)
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={equilibriumEigenvectorRender.discThickness}
                              onChange={(event) =>
                                updateEquilibriumEigenvectorRender({
                                  discThickness: Number(event.target.value),
                                })
                              }
                              data-testid="equilibrium-eigenvector-disc-thickness"
                            />
                          </label>
                          {equilibriumEigenvectorIndices.length > 0 ? (
                            <div className="inspector-list">
                              {equilibriumEigenvectorIndices.map((index, idx) => {
                                const pair = equilibriumEigenpairs[index]
                                const label =
                                  pair && !isRealEigenvalue(pair.value)
                                    ? `Eigenspace ${index + 1}`
                                    : `Eigenvector ${index + 1}`
                                const visible = equilibriumEigenvectorVisibleSet.has(index)
                                return (
                                  <div className="clv-control-row" key={`eq-eigen-color-${index}`}>
                                    <span className="clv-control-row__label">{label}</span>
                                    <input
                                      type="checkbox"
                                      checked={visible}
                                      onChange={(event) =>
                                        handleEquilibriumEigenvectorVisibilityChange(
                                          index,
                                          event.target.checked
                                        )
                                      }
                                      aria-label={`Show ${label.toLowerCase()}`}
                                      data-testid={`equilibrium-eigenvector-show-${index}`}
                                    />
                                    <input
                                      type="color"
                                      value={equilibriumEigenvectorColors[idx]}
                                      onChange={(event) =>
                                        handleEquilibriumEigenvectorColorChange(
                                          index,
                                          event.target.value
                                        )
                                      }
                                      disabled={!visible}
                                      aria-label={`${label} color`}
                                      data-testid={`equilibrium-eigenvector-color-${index}`}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {/* Mirror the legacy UI by plotting eigenvalues in the complex plane. */}
                      {equilibriumEigenPlot ? (
                        <div className="inspector-plot">
                          <PlotlyViewport
                            plotId="equilibrium-eigenvalue-plot"
                            data={equilibriumEigenPlot.data}
                            layout={equilibriumEigenPlot.layout}
                            testId="equilibrium-eigenvalue-plot"
                          />
                        </div>
                      ) : null}
                      {equilibrium.solution.eigenpairs.map((pair, pairIndex) => (
                        <div
                          className="inspector-subsection inspector-eigenpair"
                          key={`eq-eigen-${pairIndex}`}
                        >
                          <div className="inspector-eigenpair__header">
                            <span className="inspector-subheading">
                              Eigenpair {pairIndex + 1}
                            </span>
                            <span className="inspector-eigenpair__value">
                              <span className="inspector-eigenpair__value-label">Value</span>
                              <span className="inspector-eigenpair__value-number">
                                {formatComplexValue(pair.value)}
                                {isDiscreteMap
                                  ? ` (${formatPolarValue(pair.value, 4)})`
                                  : null}
                              </span>
                            </span>
                          </div>
                          {pair.vector.length > 0 ? (
                            <div className="inspector-eigenvector">
                              {pair.vector.map((entry, vectorIndex) => (
                                <div
                                  className="inspector-eigenvector__entry"
                                  key={`eq-eigen-${pairIndex}-${vectorIndex}`}
                                >
                                  <span className="inspector-eigenvector__label">
                                    {systemDraft.varNames[vectorIndex] ||
                                      `v${pairIndex + 1}_${vectorIndex + 1}`}
                                  </span>
                                  <span className="inspector-eigenvector__value">
                                    {formatComplexValue(entry)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="empty-state">No eigenvector components stored.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">No eigenpairs available yet.</p>
                  )}
                  </div>
                </InspectorSubDisclosure>
                </InspectorDisclosure>
              ) : null}

              {equilibrium.solution ? (
                <InspectorDisclosure
                key={`${selectionKey}-equilibrium-continuation`}
                title={`${equilibriumLabel} Continuation`}
                testId="equilibrium-continuation-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before continuing.
                    </div>
                  ) : null}
                  {continuationParameterCount === 0 ? (
                    <p className="empty-state">Add parameters to enable continuation.</p>
                  ) : null}
                  {!equilibrium.solution ? (
                    <p className="empty-state">{`Solve the ${equilibriumLabelLower} to continue it.`}</p>
                  ) : (
                    <>
                      <label>
                        Branch name
                        <input
                          value={continuationDraft.name}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={buildSuggestedBranchName(
                            equilibriumContinuationBaseName,
                            continuationDraft.parameterName,
                            existingBranchNames
                          )}
                          data-testid="equilibrium-branch-name"
                        />
                      </label>
                      <label>
                        Continuation parameter
                        <select
                          value={continuationDraft.parameterName}
                          onChange={(event) => {
                            const nextParameterName = event.target.value
                            setContinuationDraft((prev) => {
                              const prevSuggestedName = buildSuggestedBranchName(
                                equilibriumContinuationBaseName,
                                prev.parameterName,
                                existingBranchNames
                              )
                              const nextSuggestedName = buildSuggestedBranchName(
                                equilibriumContinuationBaseName,
                                nextParameterName,
                                existingBranchNames
                              )
                              const shouldUpdateName = prev.name === prevSuggestedName
                              return {
                                ...prev,
                                parameterName: nextParameterName,
                                name: shouldUpdateName ? nextSuggestedName : prev.name,
                              }
                            })
                          }}
                          data-testid="equilibrium-branch-parameter"
                        >
                          {continuationParameterLabels.map((name) => (
                            <option key={name} value={name}>
                              {formatContinuationParameterDisplayLabel(name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Direction
                        <select
                          value={continuationDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="equilibrium-branch-direction"
                        >
                          <option value="forward">Forward (Increasing Param)</option>
                          <option value="backward">Backward (Decreasing Param)</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={continuationDraft.stepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={continuationDraft.maxSteps}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-max-steps"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={continuationDraft.minStepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-min-step"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={continuationDraft.maxStepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-max-step"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={continuationDraft.correctorSteps}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={continuationDraft.correctorTolerance}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={continuationDraft.stepTolerance}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-step-tolerance"
                        />
                      </label>
                      {continuationError ? (
                        <div className="field-error">{continuationError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateEquilibriumBranch}
                        disabled={runDisabled}
                        data-testid="equilibrium-branch-submit"
                      >
                        Create Branch
                      </button>
                    </>
                  )}
                </div>
                </InspectorDisclosure>
              ) : null}

              {equilibrium.solution ? (
                <InspectorDisclosure
                key={`${selectionKey}-equilibrium-manifold`}
                title="Invariant Manifolds"
                testId="equilibrium-manifold-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before computing manifolds.
                    </div>
                  ) : null}
                  {systemDraft.type === 'map' ? (
                    <p className="empty-state">
                      Map systems currently support 1D equilibrium manifolds only.
                    </p>
                  ) : null}
                  {!equilibrium.solution ? (
                    <p className="empty-state">{`Solve the ${equilibriumLabelLower} before computing manifolds.`}</p>
                  ) : (
                    <>
                      <label>
                        Branch name
                        <input
                          value={equilibriumManifoldDraft.name}
                          onChange={(event) =>
                            setEquilibriumManifoldDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-manifold-name"
                        />
                      </label>
                      <label>
                        Kind
                        <select
                          value={equilibriumManifoldDraft.stability}
                          onChange={(event) =>
                            setEquilibriumManifoldDraft((prev) => ({
                              ...prev,
                              stability: event.target.value as ManifoldStability,
                            }))
                          }
                          data-testid="equilibrium-manifold-stability"
                        >
                          <option value="Unstable">Unstable</option>
                          <option value="Stable">Stable</option>
                        </select>
                      </label>
                      <label>
                        Mode
                        <select
                          value={equilibriumManifoldDraft.mode}
                          onChange={(event) =>
                            setEquilibriumManifoldDraft((prev) => {
                              const nextMode = event.target.value as EquilibriumManifoldMode
                              if (nextMode !== 'surface_2d') {
                                return { ...prev, mode: nextMode }
                              }
                              const profile =
                                prev.mode === 'surface_2d' ? prev.profile : 'adaptive_global'
                              const defaults = makeSurfaceProfileDefaults(profile)
                              return {
                                ...prev,
                                mode: nextMode,
                                profile,
                                ...defaults,
                              }
                            })
                          }
                          disabled={equilibriumManifoldModeOptions.length <= 1}
                          data-testid="equilibrium-manifold-mode"
                        >
                          {equilibriumManifoldModeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {equilibriumManifoldDraft.mode === 'curve_1d' ? (
                        <>
                          <label>
                            Direction
                            <select
                              value={equilibriumManifoldDraft.direction}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  direction: event.target.value as ManifoldDirection,
                                }))
                              }
                              data-testid="equilibrium-manifold-direction"
                            >
                              <option value="Both">both</option>
                              <option value="Plus">plus</option>
                              <option value="Minus">minus</option>
                            </select>
                          </label>
                          <label>
                            Eigen index
                            <select
                              value={equilibriumManifoldDraft.eigIndex}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  eigIndex: event.target.value,
                                }))
                              }
                              disabled={equilibriumManifoldEligibleRealIndexOptions.length === 0}
                              data-testid="equilibrium-manifold-eig-index"
                            >
                              {equilibriumManifoldEligibleRealIndexOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {equilibriumManifoldEligibleRealIndexOptions.length === 0 ? (
                            <div className="field-warning">
                              No eligible real {equilibriumManifoldDraft.stability.toLowerCase()} eigenmodes.
                            </div>
                          ) : null}
                          <label>
                            Epsilon
                            <input
                              value={equilibriumManifoldDraft.eps}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  eps: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold-eps"
                            />
                          </label>
                          {systemDraft.type !== 'map' ? (
                            <label>
                              Integration dt
                              <input
                                value={equilibriumManifoldDraft.integrationDt}
                                onChange={(event) =>
                                  setEquilibriumManifoldDraft((prev) => ({
                                    ...prev,
                                    integrationDt: event.target.value,
                                  }))
                                }
                                data-testid="equilibrium-manifold-integration-dt"
                              />
                            </label>
                          ) : null}
                          <label>
                            Target arclength
                            <input
                              value={equilibriumManifoldDraft.targetArclength}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  targetArclength: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold-target-arclength"
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label>
                            Profile
                            <select
                              value={equilibriumManifoldDraft.profile}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => {
                                  const profile = event.target.value as EquilibriumManifoldProfileDraft
                                  const defaults = makeSurfaceProfileDefaults(profile)
                                  return {
                                    ...prev,
                                    profile,
                                    ...defaults,
                                  }
                                })
                              }
                              data-testid="equilibrium-manifold2d-profile"
                            >
                              <option value="adaptive_global">adaptive global</option>
                              <option value="local_preview">local preview</option>
                              <option value="lorenz_global">Lorenz reference</option>
                            </select>
                          </label>
                          <label>
                            Eigenspace indices (A,B)
                            <div className="inspector-row">
                              <select
                                value={equilibriumManifoldDraft.eigIndexA}
                                onChange={(event) =>
                                  setEquilibriumManifoldDraft((prev) => ({
                                    ...prev,
                                    eigIndexA: event.target.value,
                                  }))
                                }
                                disabled={equilibriumManifoldEligibleIndexOptions.length === 0}
                                data-testid="equilibrium-manifold-eig-index-a"
                              >
                                {equilibriumManifoldEligibleIndexOptions.map((option) => (
                                  <option key={`a-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={equilibriumManifoldDraft.eigIndexB}
                                onChange={(event) =>
                                  setEquilibriumManifoldDraft((prev) => ({
                                    ...prev,
                                    eigIndexB: event.target.value,
                                  }))
                                }
                                disabled={equilibriumManifoldEligibleIndexOptions.length === 0}
                                data-testid="equilibrium-manifold-eig-index-b"
                              >
                                {equilibriumManifoldEligibleIndexOptions.map((option) => (
                                  <option key={`b-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>
                          {equilibriumManifoldEligibleIndexOptions.length === 0 ? (
                            <div className="field-warning">
                              No eligible {equilibriumManifoldDraft.stability.toLowerCase()} eigenmodes.
                            </div>
                          ) : null}
                          <label>
                            Initial radius
                            <input
                              value={equilibriumManifoldDraft.initialRadius}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  initialRadius: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-initial-radius"
                            />
                          </label>
                          <label>
                            Leaf delta
                            <input
                              value={equilibriumManifoldDraft.leafDelta}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  leafDelta: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-leaf-delta"
                            />
                          </label>
                          <label>
                            Delta min
                            <input
                              value={equilibriumManifoldDraft.deltaMin}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  deltaMin: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-delta-min"
                            />
                          </label>
                          <label>
                            Ring points
                            <input
                              value={equilibriumManifoldDraft.ringPoints}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  ringPoints: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-ring-points"
                            />
                          </label>
                          <label>
                            Min spacing
                            <input
                              value={equilibriumManifoldDraft.minSpacing}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  minSpacing: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-min-spacing"
                            />
                          </label>
                          <label>
                            Max spacing
                            <input
                              value={equilibriumManifoldDraft.maxSpacing}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  maxSpacing: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-max-spacing"
                            />
                          </label>
                          <label>
                            Alpha min
                            <input
                              value={equilibriumManifoldDraft.alphaMin}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  alphaMin: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-alpha-min"
                            />
                          </label>
                          <label>
                            Alpha max
                            <input
                              value={equilibriumManifoldDraft.alphaMax}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  alphaMax: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-alpha-max"
                            />
                          </label>
                          <label>
                            Delta-alpha min
                            <input
                              value={equilibriumManifoldDraft.deltaAlphaMin}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  deltaAlphaMin: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-delta-alpha-min"
                            />
                          </label>
                          <label>
                            Delta-alpha max
                            <input
                              value={equilibriumManifoldDraft.deltaAlphaMax}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  deltaAlphaMax: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-delta-alpha-max"
                            />
                          </label>
                          <label>
                            Integration dt
                            <input
                              value={equilibriumManifoldDraft.integrationDt}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  integrationDt: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-integration-dt"
                            />
                          </label>
                          <label>
                            Target radius
                            <input
                              value={equilibriumManifoldDraft.targetRadius}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  targetRadius: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-target-radius"
                            />
                          </label>
                          <label>
                            Target arclength
                            <input
                              value={equilibriumManifoldDraft.targetArclength}
                              onChange={(event) =>
                                setEquilibriumManifoldDraft((prev) => ({
                                  ...prev,
                                  targetArclength: event.target.value,
                                }))
                              }
                              data-testid="equilibrium-manifold2d-target-arclength"
                            />
                          </label>
                        </>
                      )}

                      <div className="inspector-divider">Termination caps</div>
                      <label>
                        Max steps
                        <input
                          value={equilibriumManifoldDraft.caps.maxSteps}
                          onChange={(event) =>
                            setEquilibriumManifoldDraft((prev) => ({
                              ...prev,
                              caps: { ...prev.caps, maxSteps: event.target.value },
                            }))
                          }
                          data-testid="equilibrium-manifold-caps-max-steps"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          value={equilibriumManifoldDraft.caps.maxPoints}
                          onChange={(event) =>
                            setEquilibriumManifoldDraft((prev) => ({
                              ...prev,
                              caps: { ...prev.caps, maxPoints: event.target.value },
                            }))
                          }
                          data-testid="equilibrium-manifold-caps-max-points"
                        />
                      </label>
                      {equilibriumManifoldDraft.mode === 'surface_2d' ? (
                        <label>
                          Max rings
                          <input
                            value={equilibriumManifoldDraft.caps.maxRings}
                            onChange={(event) =>
                              setEquilibriumManifoldDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxRings: event.target.value },
                              }))
                            }
                            data-testid="equilibrium-manifold-caps-max-rings"
                          />
                        </label>
                      ) : null}
                      {equilibriumManifoldDraft.mode === 'surface_2d' ? (
                        <label>
                          Max vertices
                          <input
                            value={equilibriumManifoldDraft.caps.maxVertices}
                            onChange={(event) =>
                              setEquilibriumManifoldDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxVertices: event.target.value },
                              }))
                            }
                            data-testid="equilibrium-manifold-caps-max-vertices"
                          />
                        </label>
                      ) : null}
                      {systemDraft.type === 'map' && equilibriumManifoldDraft.mode === 'curve_1d' ? (
                        <label>
                          Max iterations
                          <input
                            value={equilibriumManifoldDraft.caps.maxIterations}
                            onChange={(event) =>
                              setEquilibriumManifoldDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxIterations: event.target.value },
                              }))
                            }
                            data-testid="equilibrium-manifold-caps-max-iterations"
                          />
                        </label>
                      ) : (
                        <label>
                          Max time
                          <input
                            value={equilibriumManifoldDraft.caps.maxTime}
                            onChange={(event) =>
                              setEquilibriumManifoldDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxTime: event.target.value },
                              }))
                            }
                            data-testid="equilibrium-manifold-caps-max-time"
                          />
                        </label>
                      )}
                      {equilibriumManifoldError ? (
                        <div className="field-error">{equilibriumManifoldError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateEquilibriumManifold}
                        disabled={runDisabled}
                        data-testid="equilibrium-manifold-submit"
                      >
                        Compute
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
