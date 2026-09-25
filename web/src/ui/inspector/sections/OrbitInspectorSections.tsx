import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../system/subsystemGateway'
import { InspectorSubDisclosure } from '../selectionSession'
import { CollocationAdaptivityFields } from './branch/CollocationAdaptivityFields'
import { PeriodicLinearSolverField } from './branch/PeriodicLinearSolverField'
import { OpacityPercentInput } from '../../OpacityPercentInput'
import { fmt, fmtCount, fmtRange } from '../../../utils/format'
import {
  AdvancedFields,
  CopyButton,
  DataDetails,
  DataPager,
  InlineSection,
  KeyValues,
} from '../InspectorChrome'

export function OrbitInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    StateTable,
    autonomousAnalysisError,
    buildSuggestedBranchName,
    clvColors,
    clvHasData,
    clvIndices,
    clvNeeds2d,
    clvOpacities,
    clvRender,
    clvVisibleSet,
    continuationParameterCount,
    continuationParameterLabels,
    covariantDraft,
    covariantError,
    formatPointValues,
    frozenVariableHeaderNames,
    handleClvColorChange,
    handleClvOpacityChange,
    handleClvVisibilityChange,
    handleComputeCovariant,
    handleComputeLyapunov,
    handleCreateLimitCycleFromOrbit,
    handleCreateHeteroclinicFromOrbit,
    handleOrbitPreviewJump,
    handlePasteOrbitState,
    handleRunOrbit,
    handleExtendOrbit,
    isDiscreteMap,
    limitCycleFromOrbitBranchSuggestion,
    limitCycleFromOrbitDraft,
    limitCycleFromOrbitError,
    limitCycleFromOrbitNameSuggestion,
    heteroclinicEquilibriumOptions,
    heteroclinicFromOrbitDraft,
    heteroclinicFromOrbitError,
    heteroclinicFromOrbitNameSuggestion,
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
    setHeteroclinicFromOrbitDraft,
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
                title="Simulation"
                testId="orbit-run-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes first.
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
                    {systemDraft.type === 'map' ? 'n₀' : 't₀'}
                    <input
                      type="number"
                      step={systemDraft.type === 'map' ? 1 : 'any'}
                      value={orbitDraft.initialContext}
                      onChange={(event) =>
                        setOrbitDraft((prev) => ({
                          ...prev,
                          initialContext: event.target.value,
                        }))
                      }
                      data-testid="orbit-run-initial-context"
                    />
                  </label>
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
                      dt
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
                  <div className="inspector-submit-row">
                    <button
                      className="inspector-primary-action"
                      onClick={handleRunOrbit}
                      disabled={runDisabled}
                      data-testid="orbit-run-submit"
                    >
                      Run
                    </button>
                    {orbit.data.length > 0 ? (
                      <button
                        className="btn inspector-submit-row__secondary"
                        onClick={handleExtendOrbit}
                        disabled={runDisabled}
                        title="Continue the current orbit for the duration above"
                        data-testid="orbit-extend-submit"
                      >
                        {systemDraft.type === 'map'
                          ? `Extend from n = ${orbit.t_end}`
                          : `Extend from t = ${fmt(orbit.t_end)}`}
                      </button>
                    ) : null}
                  </div>
                </div>
              </InspectorDisclosure>

              {orbit.parameters && orbit.parameters.length > 0 ? (
                <InlineSection
                  title="Parameters"
                  testId="orbit-data-parameters"
                  actions={
                    <CopyButton
                      label="Copy parameters"
                      onCopy={() =>
                        void writeClipboardText(formatPointValues(orbit.parameters ?? []))
                      }
                    />
                  }
                >
                  <KeyValues
                    columns={2}
                    rows={orbit.parameters.map((value, index) => ({
                      label: systemDraft.paramNames[index] || `p${index + 1}`,
                      value: fmt(value),
                    }))}
                  />
                </InlineSection>
              ) : null}

              {orbit.data.length > 0 ? (
                <DataDetails
                  title={`Samples · ${fmtCount(orbit.data.length)}`}
                  testId="orbit-data-preview-toggle"
                >
                  <DataPager
                    page={orbitPreviewPage}
                    pageCount={orbitPreviewPageCount}
                    onPage={setOrbitPreviewPageIndex}
                    jumpValue={orbitPreviewInput}
                    onJumpChange={(value) => {
                      setOrbitPreviewInput(value)
                      setOrbitPreviewError(null)
                    }}
                    onJump={handleOrbitPreviewJump}
                    error={orbitPreviewError}
                    summary={`${orbitPreviewStart + 1}–${orbitPreviewEnd} of ${fmtCount(
                      orbit.data.length
                    )}`}
                    testIdPrefix="orbit-preview"
                  />
                  {selectedOrbitPoint ? (
                    <div className="inspector-selected-point">
                      <span className="chip">
                        {`Selected point #${selectedOrbitPointIndex}`}
                      </span>
                      {selectedOrbitPoint[0] !== undefined ? (
                        <span className="num muted">
                          {`${isDiscreteMap ? 'n' : 't'} ${fmt(selectedOrbitPoint[0])}`}
                        </span>
                      ) : null}
                      {selectedOrbitState ? (
                        <CopyButton
                          label="Copy state"
                          onCopy={() =>
                            void writeClipboardText(formatPointValues(selectedOrbitState))
                          }
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <div
                    className="inspector-table-scroll"
                    role="region"
                    aria-label="Orbit data preview"
                  >
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{isDiscreteMap ? 'n' : 't'}</th>
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
                              className={`is-clickable${isSelected ? ' is-selected' : ''}`}
                              onClick={() => {
                                if (!onOrbitPointSelect || !selectedNodeId) return
                                onOrbitPointSelect({
                                  orbitId: selectedNodeId,
                                  pointIndex,
                                })
                              }}
                            >
                              <td>{pointIndex}</td>
                              <td>{fmt(point[0])}</td>
                              {orbitPreviewVarNames.map((_, varIndex) => (
                                <td key={`orbit-preview-cell-${rowIndex}-${varIndex}`}>
                                  {fmt(point[varIndex + 1] ?? Number.NaN)}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </DataDetails>
              ) : null}

              {orbit.data.length >= 2 ? (
                <InspectorDisclosure
                key={`${selectionKey}-oseledets`}
                title="Lyapunov analysis"
                testId="oseledets-toggle"
                defaultOpen={false}
                actionOnly
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes first.
                    </div>
                  ) : null}
                  <h4 className="section-head">Exponents</h4>
                  <label title={systemDraft.type === 'map' ? 'Transient iterations to discard' : 'Transient time to discard'}>
                    Transient
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
                  <label title="Steps between QR decompositions">
                    QR stride
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
                    className="inspector-primary-action"
                    onClick={handleComputeLyapunov}
                    disabled={runDisabled}
                    data-testid="lyapunov-submit"
                  >
                    Compute
                  </button>
                </div>
                <div className="inspector-section">
                  <h4 className="section-head">Covariant vectors</h4>
                  {orbit.covariantVectors && orbit.covariantVectors.vectors.length > 0 ? (
                    <KeyValues
                      columns={2}
                      rows={[
                        {
                          label: 'Checkpoints',
                          value: fmtCount(orbit.covariantVectors.vectors.length),
                        },
                        { label: 'Dim', value: String(orbit.covariantVectors.dim) },
                        orbit.covariantVectors.times.length > 0
                          ? {
                              label: systemDraft.type === 'map' ? 'n' : 't',
                              value: fmtRange(
                                orbit.covariantVectors.times[0],
                                orbit.covariantVectors.times[
                                  orbit.covariantVectors.times.length - 1
                                ]
                              ),
                            }
                          : null,
                      ]}
                    />
                  ) : null}
                  <label title={systemDraft.type === 'map' ? 'Transient iterations to discard' : 'Transient time to discard'}>
                    Transient
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
                  <label title="Forward transient before the window">
                    Forward
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
                  <label title="Backward transient after the window">
                    Backward
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
                  <label title="Steps between QR decompositions">
                    QR stride
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
                    className="inspector-primary-action"
                    onClick={handleComputeCovariant}
                    disabled={runDisabled}
                    data-testid="clv-submit"
                  >
                    Compute
                  </button>
                </div>
                {clvHasData ? (
                  <InspectorSubDisclosure
                    title="CLV plotting"
                    testId="clv-plot-toggle"
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
                      <label title="Plot every Nth checkpoint">
                        Stride
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
                      <label title="Arrow length as a fraction of the orbit size">
                        Length
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
                        Head scale
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
                      <label title="Arrow thickness in pixels">
                        Thickness px
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
                                <OpacityPercentInput
                                  value={clvOpacities[idx]}
                                  onChange={(opacity) =>
                                    handleClvOpacityChange(index, opacity)
                                  }
                                  disabled={!visible}
                                  ariaLabel={`CLV ${index + 1} opacity percentage`}
                                  testId={`clv-plot-opacity-${index}`}
                                />
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  </InspectorSubDisclosure>
                ) : null}
                </InspectorDisclosure>
              ) : null}

              {!isDiscreteMap && orbit.data.length > 0 ? (
                <InspectorDisclosure
                  key={`${selectionKey}-limit-cycle`}
                  title="Limit cycle from orbit"
                  testId="limit-cycle-toggle"
                  defaultOpen={false}
                  actionOnly
                >
                  <div className="inspector-section">
                    {autonomousAnalysisError ? (
                      <div className="field-warning" data-testid="autonomous-workflow-warning">
                        {autonomousAnalysisError}
                      </div>
                    ) : continuationParameterCount === 0 ? (
                      <p className="field-warning">Needs a parameter.</p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes first.
                      </div>
                    ) : null}
                    {autonomousAnalysisError ||
                    continuationParameterCount === 0 ||
                    !orbit ||
                    orbit.data.length === 0 ? null : (
                    <>
                      <label>
                        Cycle name
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
                        Branch
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
                        Parameter
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
                              {formatContinuationParameterDisplayLabel(name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label title="Cycle detection tolerance">
                        Detect tol
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
                      <label title="Mesh intervals along the cycle">
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
                      </label>
                      <label title="Collocation points per mesh interval">
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
                          <option value="forward">→ Increasing</option>
                          <option value="backward">← Decreasing</option>
                        </select>
                      </label>
                      <label>
                        Step
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
                        Max pts
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
                      <AdvancedFields testId="limit-cycle-from-orbit-advanced">
                      <label>
                        Min step
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
                        Max step
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
                        Corr. steps
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
                        Corr. tol
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
                        Step tol
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
                      <PeriodicLinearSolverField
                        useDenseSolve={limitCycleFromOrbitDraft.useDenseSolve}
                        onChange={(useDenseSolve) =>
                          setLimitCycleFromOrbitDraft((prev) => ({
                            ...prev,
                            useDenseSolve,
                          }))
                        }
                        testId="limit-cycle-from-orbit-use-dense-solve"
                      />
                      <CollocationAdaptivityFields
                        draft={limitCycleFromOrbitDraft}
                        onChange={(patch) =>
                          setLimitCycleFromOrbitDraft((prev) => ({ ...prev, ...patch }))
                        }
                        testIdPrefix="limit-cycle-from-orbit"
                      />
                      </AdvancedFields>
                      {limitCycleFromOrbitError ? (
                        <div className="field-error">{limitCycleFromOrbitError}</div>
                      ) : null}
                      <button
                        className="inspector-primary-action"
                        onClick={handleCreateLimitCycleFromOrbit}
                        disabled={
                          runDisabled ||
                          continuationParameterCount === 0 ||
                          orbit.data.length === 0
                        }
                        data-testid="limit-cycle-from-orbit-submit"
                      >
                        Continue
                      </button>
                    </>
                    )}
                  </div>
                </InspectorDisclosure>
              ) : null}
              {!isDiscreteMap && orbit.data.length > 0 ? (
                <InspectorDisclosure
                  key={`${selectionKey}-heteroclinic-from-orbit`}
                  title="Heteroclinic connection"
                  testId="heteroclinic-from-orbit-toggle"
                  defaultOpen={false}
                  actionOnly
                >
                  <div className="inspector-section">
                    {continuationParameterCount < 2 ? (
                      <p className="field-warning">Needs two parameters.</p>
                    ) : null}
                    {heteroclinicEquilibriumOptions.length < 2 ? (
                      <p className="field-warning" title="The orbit must run from the source saddle toward the target saddle; both endpoints solved at the orbit's parameters.">Needs two solved equilibria.</p>
                    ) : null}
                    {continuationParameterCount >= 2 &&
                    heteroclinicEquilibriumOptions.length >= 2 &&
                    orbit.data.length >= 2 ? (
                      <>
                        <label>
                          Branch name
                          <input
                            value={heteroclinicFromOrbitDraft.name}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                name: event.target.value,
                              }))
                            }
                            placeholder={heteroclinicFromOrbitNameSuggestion}
                            data-testid="heteroclinic-from-orbit-name"
                          />
                        </label>
                        <label>
                          Source equilibrium
                          <select
                            value={heteroclinicFromOrbitDraft.sourceEquilibriumId}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                sourceEquilibriumId: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-source-equilibrium"
                          >
                            {heteroclinicEquilibriumOptions.map((option) => (
                              <option
                                key={option.id}
                                value={option.id}
                                disabled={option.id === heteroclinicFromOrbitDraft.targetEquilibriumId}
                              >
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Target equilibrium
                          <select
                            value={heteroclinicFromOrbitDraft.targetEquilibriumId}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                targetEquilibriumId: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-target-equilibrium"
                          >
                            {heteroclinicEquilibriumOptions.map((option) => (
                              <option
                                key={option.id}
                                value={option.id}
                                disabled={option.id === heteroclinicFromOrbitDraft.sourceEquilibriumId}
                              >
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Continuation parameter
                          <select
                            value={heteroclinicFromOrbitDraft.parameterName}
                            onChange={(event) => {
                              const parameterName = event.target.value
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                parameterName,
                                param2Name:
                                  prev.param2Name === parameterName
                                    ? continuationParameterLabels.find(
                                        (name) => name !== parameterName
                                      ) ?? ''
                                    : prev.param2Name,
                              }))
                            }}
                            data-testid="heteroclinic-param1"
                          >
                            {continuationParameterLabels.map((name) => (
                              <option key={name} value={name}>
                                {formatContinuationParameterDisplayLabel(name)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Second parameter
                          <select
                            value={heteroclinicFromOrbitDraft.param2Name}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                param2Name: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-param2"
                          >
                            {continuationParameterLabels.map((name) => (
                              <option
                                key={name}
                                value={name}
                                disabled={name === heteroclinicFromOrbitDraft.parameterName}
                              >
                                {formatContinuationParameterDisplayLabel(name)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Method
                          <select
                            value={heteroclinicFromOrbitDraft.discretization}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                discretization: event.target.value as 'collocation' | 'shooting',
                              }))
                            }
                            data-testid="heteroclinic-method"
                          >
                            <option value="collocation">Orthogonal Collocation</option>
                            <option value="shooting">Standard Shooting</option>
                          </select>
                        </label>
                        <label>
                          NTST
                          <input
                            type="number"
                            min="2"
                            value={heteroclinicFromOrbitDraft.ntst}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                ntst: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-ntst"
                          />
                        </label>
                        {heteroclinicFromOrbitDraft.discretization === 'shooting' ? (
                          <>
                            <label>
                              Shooting intervals
                              <input
                                type="number"
                                min="1"
                                value={heteroclinicFromOrbitDraft.shootingIntervals}
                                onChange={(event) =>
                                  setHeteroclinicFromOrbitDraft((prev) => ({
                                    ...prev,
                                    shootingIntervals: event.target.value,
                                  }))
                                }
                                data-testid="heteroclinic-shooting-intervals"
                              />
                              <span className="field-hint">
                                1 selects single shooting; larger values use multiple shooting.
                              </span>
                            </label>
                            <label>
                              Integration steps per segment
                              <input
                                type="number"
                                min="1"
                                value={heteroclinicFromOrbitDraft.integrationStepsPerSegment}
                                onChange={(event) =>
                                  setHeteroclinicFromOrbitDraft((prev) => ({
                                    ...prev,
                                    integrationStepsPerSegment: event.target.value,
                                  }))
                                }
                                data-testid="heteroclinic-integration-steps"
                              />
                            </label>
                          </>
                        ) : null}
                        <label>
                          NCOL
                          <input
                            type="number"
                            min="1"
                            value={heteroclinicFromOrbitDraft.ncol}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                ncol: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-ncol"
                          />
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={heteroclinicFromOrbitDraft.freeTime}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                freeTime: event.target.checked,
                              }))
                            }
                          />
                          Free flight time T
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={heteroclinicFromOrbitDraft.freeEps0}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                freeEps0: event.target.checked,
                              }))
                            }
                          />
                          Free source radius eps0
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={heteroclinicFromOrbitDraft.freeEps1}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                freeEps1: event.target.checked,
                              }))
                            }
                          />
                          Free target radius eps1
                        </label>
                        <label>
                          Projector refresh interval
                          <input
                            type="number"
                            min="1"
                            value={heteroclinicFromOrbitDraft.projectorRefreshInterval}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                projectorRefreshInterval: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-projector-refresh"
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={heteroclinicFromOrbitDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                          >
                            <option value="forward">→ Increasing</option>
                            <option value="backward">← Decreasing</option>
                          </select>
                        </label>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.stepSize}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.maxSteps}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-max-steps"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.minStepSize}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.maxStepSize}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-max-step-size"
                          />
                        </label>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.correctorSteps}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.correctorTolerance}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={heteroclinicFromOrbitDraft.stepTolerance}
                            onChange={(event) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="heteroclinic-step-tolerance"
                          />
                        </label>
                        {heteroclinicFromOrbitDraft.discretization === 'collocation' ? (
                          <CollocationAdaptivityFields
                            draft={heteroclinicFromOrbitDraft}
                            onChange={(patch) =>
                              setHeteroclinicFromOrbitDraft((prev) => ({ ...prev, ...patch }))
                            }
                            testIdPrefix="heteroclinic-from-orbit"
                          />
                        ) : null}
                        {heteroclinicFromOrbitError ? (
                          <div className="field-error">{heteroclinicFromOrbitError}</div>
                        ) : null}
                        <button
                          className="inspector-primary-action"
                          onClick={handleCreateHeteroclinicFromOrbit}
                          disabled={runDisabled}
                          data-testid="heteroclinic-from-orbit-submit"
                        >
                          Continue
                        </button>
                      </>
                    ) : null}
                  </div>
                </InspectorDisclosure>
              ) : null}
            </>
          ) : null}
  </>
}
