import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../system/subsystemGateway'
import type { ManifoldStability, ManifoldDirection } from '../../../system/types'
import {
  DEFAULT_DEFLATION_EXPONENT,
  DEFAULT_DEFLATION_SHIFT,
} from '../../../system/deflation'
import type { EquilibriumManifoldProfileDraft } from '../../manifoldProfileDrafts'
import { InspectorSubDisclosure } from '../selectionSession'
import { OpacityPercentInput } from '../../OpacityPercentInput'
import { CalculationDiagnosticSummary } from '../CalculationDiagnosticSummary'
import { fmt, fmtComplex } from '../../../utils/format'
import {
  AdvancedFields,
  CopyButton,
  DataDetails,
  InlineSection,
  KeyValues,
} from '../InspectorChrome'

type EquilibriumManifoldMode = 'curve_1d' | 'surface_2d'

export function EquilibriumInspectorSections({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    PlotlyViewport,
    StateTable,
    autonomousAnalysisError,
    buildSuggestedBranchName,
    continuationDraft,
    continuationError,
    continuationParameterCount,
    continuationParameterLabels,
    equilibrium,
    equilibriumContinuationBaseName,
    equilibriumCyclePoints,
    equilibriumDeflationTargetOptions,
    equilibriumDraft,
    equilibriumEigenPlot,
    equilibriumEigenpairs,
    equilibriumEigenvectorColors,
    equilibriumEigenvectorIndices,
    equilibriumEigenvectorOpacities,
    equilibriumEigenvectorRender,
    equilibriumEigenvectorVisibleSet,
    equilibriumError,
    equilibriumLabel,
    equilibriumManifoldDraft,
    equilibriumManifoldEligibleIndexOptions,
    equilibriumManifoldEligibleRealIndexOptions,
    equilibriumManifoldError,
    equilibriumManifoldModeOptions,
    existingBranchNames,
    formatPointValues,
    frozenVariableHeaderNames,
    handleCreateEquilibriumBranch,
    handleCreateEquilibriumManifold,
    handleEquilibriumEigenvectorColorChange,
    handleEquilibriumEigenvectorOpacityChange,
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
                title={`Solve ${equilibriumLabel}`}
                testId="equilibrium-solver-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes first.
                    </div>
                  ) : null}
                  {autonomousAnalysisError ? (
                    <div className="field-warning" data-testid="autonomous-workflow-warning">
                      {autonomousAnalysisError}
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
                  <label title="Maximum Newton steps">
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
                  <InspectorSubDisclosure
                    title="Deflation"
                    testId="equilibrium-deflation-toggle"
                  >
                    <div
                      className="inspector-section"
                      title={
                        systemDraft.type === 'flow'
                          ? 'Solved equilibria this solver should avoid'
                          : 'Solved map cycles this solver should avoid (every phase point)'
                      }
                    >
                      {equilibriumDeflationTargetOptions.length > 0 ? (
                        <div className="inspector-list">
                          {equilibriumDeflationTargetOptions.map((option) => {
                            const selectedTarget = equilibriumDraft.deflationTargets.find(
                              (target) => target.targetObjectId === option.id
                            )
                            return (
                              <div key={option.id} className="inspector-section">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selectedTarget)}
                                    onChange={(event) =>
                                      setEquilibriumDraft((previous) => ({
                                        ...previous,
                                        deflationTargets: event.target.checked
                                          ? [
                                              ...previous.deflationTargets,
                                              {
                                                targetObjectId: option.id,
                                                exponent:
                                                  DEFAULT_DEFLATION_EXPONENT.toString(),
                                                shift: DEFAULT_DEFLATION_SHIFT.toString(),
                                              },
                                            ]
                                          : previous.deflationTargets.filter(
                                              (target) =>
                                                target.targetObjectId !== option.id
                                            ),
                                      }))
                                    }
                                    data-testid={`equilibrium-deflation-target-${option.id}`}
                                  />
                                  {option.name}
                                </label>
                                {selectedTarget ? (
                                  <>
                                    <label>
                                      Exponent
                                      <input
                                        type="number"
                                        min="1"
                                        step="0.1"
                                        value={selectedTarget.exponent}
                                        onChange={(event) =>
                                          setEquilibriumDraft((previous) => ({
                                            ...previous,
                                            deflationTargets:
                                              previous.deflationTargets.map((target) =>
                                                target.targetObjectId === option.id
                                                  ? {
                                                      ...target,
                                                      exponent: event.target.value,
                                                    }
                                                  : target
                                              ),
                                          }))
                                        }
                                        data-testid={`equilibrium-deflation-exponent-${option.id}`}
                                      />
                                    </label>
                                    <label>
                                      Shift
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={selectedTarget.shift}
                                        onChange={(event) =>
                                          setEquilibriumDraft((previous) => ({
                                            ...previous,
                                            deflationTargets:
                                              previous.deflationTargets.map((target) =>
                                                target.targetObjectId === option.id
                                                  ? {
                                                      ...target,
                                                      shift: event.target.value,
                                                    }
                                                  : target
                                              ),
                                          }))
                                        }
                                        data-testid={`equilibrium-deflation-shift-${option.id}`}
                                      />
                                    </label>
                                  </>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="faint">—</p>
                      )}
                      {equilibriumDraft.deflationTargets.length > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEquilibriumDraft((previous) => ({
                              ...previous,
                              deflationTargets: [],
                            }))
                          }
                          data-testid="equilibrium-deflation-clear"
                        >
                          Clear targets
                        </button>
                      ) : null}
                    </div>
                  </InspectorSubDisclosure>
                  {equilibriumError ? <div className="field-error">{equilibriumError}</div> : null}
                  <button
                    className="inspector-primary-action"
                    onClick={handleSolveEquilibrium}
                    disabled={runDisabled || Boolean(autonomousAnalysisError)}
                    data-testid="equilibrium-solve-submit"
                  >
                    Solve {equilibriumLabel}
                  </button>
                </div>
                {equilibrium.lastRun && !equilibrium.lastRun.success ? (
                  <div className="inspector-section" data-testid="equilibrium-last-attempt">
                    <div className="section-head">
                      <span title={equilibrium.lastRun.timestamp}>Last attempt</span>
                      <span className="chip chip--warning">failed</span>
                    </div>
                    {equilibrium.lastRun.diagnostic ? (
                      <CalculationDiagnosticSummary diagnostic={equilibrium.lastRun.diagnostic} />
                    ) : null}
                    {equilibrium.solution ? (
                      <p className="faint">Stored solution unchanged.</p>
                    ) : null}
                  </div>
                ) : null}
              </InspectorDisclosure>

              {equilibrium.solution && equilibrium.parameters && equilibrium.parameters.length > 0 ? (
                <InlineSection
                  title="Parameters"
                  testId="equilibrium-data-parameters"
                  actions={
                    <CopyButton
                      label="Copy parameters"
                      onCopy={() =>
                        void writeClipboardText(formatPointValues(equilibrium.parameters ?? []))
                      }
                    />
                  }
                >
                  <KeyValues
                    columns={2}
                    rows={equilibrium.parameters.map((value, index) => ({
                      label: systemDraft.paramNames[index] || `p${index + 1}`,
                      value: fmt(value),
                    }))}
                  />
                </InlineSection>
              ) : null}

              {equilibrium.solution && isDiscreteMap && equilibriumCyclePoints && equilibriumCyclePoints.length > 1 ? (
                <DataDetails
                  title={`Cycle points · ${equilibriumCyclePoints.length}`}
                  testId="equilibrium-data-cycle-points-toggle"
                >
                  <div className="inspector-inline-section__actions">
                    <CopyButton
                      label="Copy cycle points"
                      onCopy={() =>
                        void writeClipboardText(
                          equilibriumCyclePoints
                            .map((point) => formatPointValues(point))
                            .join('\n')
                        )
                      }
                    />
                  </div>
                  <div className="inspector-table-scroll" role="region" aria-label="Cycle point data">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          {frozenVariableHeaderNames.map((name, index) => (
                            <th key={`equilibrium-cycle-col-${index}`}>{name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {equilibriumCyclePoints.map((point, rowIndex) => (
                          <tr key={`equilibrium-cycle-row-${rowIndex}`}>
                            <td>{rowIndex}</td>
                            {frozenVariableHeaderNames.map((_, varIndex) => (
                              <td key={`equilibrium-cycle-cell-${rowIndex}-${varIndex}`}>
                                {fmt(point[varIndex] ?? Number.NaN)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DataDetails>
              ) : null}

              {equilibrium.solution && equilibrium.solution.eigenpairs.length > 0 ? (
                <DataDetails title="Eigenpairs" testId="equilibrium-data-eigenpairs-toggle">
                  <div className="inspector-section">
                  {equilibrium.solution && equilibrium.solution.eigenpairs.length > 0 ? (
                    <div className="inspector-list">
                      {showEquilibriumEigenvectorControls ? (
                        <>
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
                          <div className="inspector-form-grid">
                          <label title="Eigenline length as a fraction of the scene">
                            Line length
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
                          <label title="Eigenline thickness in pixels">
                            Line px
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
                          <label title="Eigenspace disc radius as a fraction of the scene">
                            Disc radius
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
                          <label title="Eigenspace disc thickness in pixels">
                            Disc px
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
                          </div>
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
                                    <OpacityPercentInput
                                      value={equilibriumEigenvectorOpacities[idx]}
                                      onChange={(opacity) =>
                                        handleEquilibriumEigenvectorOpacityChange(
                                          index,
                                          opacity
                                        )
                                      }
                                      disabled={!visible}
                                      ariaLabel={`${label} opacity percentage`}
                                      testId={`equilibrium-eigenvector-opacity-${index}`}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {equilibriumEigenPlot ? (
                        <div className="inspector-plot inspector-plot--compact">
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
                            <span className="inspector-eigenpair__index">
                              λ{pairIndex + 1}
                            </span>
                            <span className="inspector-eigenpair__value num">
                              {fmtComplex(pair.value)}
                              {isDiscreteMap
                                ? `  |λ| ${fmt(Math.hypot(pair.value.re, pair.value.im))}`
                                : null}
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
                                    {fmtComplex(entry)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  </div>
                </DataDetails>
              ) : null}

              {equilibrium.solution ? (
                <InspectorDisclosure
                key={`${selectionKey}-equilibrium-continuation`}
                title={`Continue ${equilibriumLabel}`}
                testId="equilibrium-continuation-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes first.
                    </div>
                  ) : null}
                  {autonomousAnalysisError ? (
                    <div className="field-warning">{autonomousAnalysisError}</div>
                  ) : null}
                  {continuationParameterCount === 0 ? (
                    <p className="field-warning">Needs a parameter.</p>
                  ) : null}
                  {!equilibrium.solution ? null : (
                    <>
                      <label>
                        Branch
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
                        Parameter
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
                          <option value="forward">→ Increasing</option>
                          <option value="backward">← Decreasing</option>
                        </select>
                      </label>
                      <label>
                        Step
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
                        Max pts
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
                      <AdvancedFields testId="equilibrium-branch-advanced">
                      <label>
                        Min step
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
                        Max step
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
                        Corr. steps
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
                        Corr. tol
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
                        Step tol
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
                      </AdvancedFields>
                      {continuationError ? (
                        <div className="field-error">{continuationError}</div>
                      ) : null}
                      <button
                        className="inspector-primary-action"
                        onClick={handleCreateEquilibriumBranch}
                        disabled={runDisabled || Boolean(autonomousAnalysisError)}
                        data-testid="equilibrium-branch-submit"
                      >
                        Continue
                      </button>
                    </>
                  )}
                </div>
                </InspectorDisclosure>
              ) : null}

              {equilibrium.solution ? (
                <InspectorDisclosure
                key={`${selectionKey}-equilibrium-manifold`}
                title="Invariant manifold"
                testId="equilibrium-manifold-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes first.
                    </div>
                  ) : null}
                  {autonomousAnalysisError ? (
                    <div className="field-warning">{autonomousAnalysisError}</div>
                  ) : null}
                  {!equilibrium.solution ? null : (
                    <>
                      <label>
                        Branch
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

                      <h4 className="section-head">Caps</h4>
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
                        className="inspector-primary-action"
                        onClick={handleCreateEquilibriumManifold}
                        disabled={runDisabled || Boolean(autonomousAnalysisError)}
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
