import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function IsochroneCurveWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchParams,
    continuationParameterCount,
    continuationParameterLabels,
    continuationParameterSet,
    existingBranchNames,
    formatNumber,
    handleCreateIsochroneCurve,
    isochroneCurveDraft,
    isochroneCurveError,
    isochroneParam1Options,
    isochroneParam2Options,
    parseNumber,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setIsochroneCurveDraft,
    showIsochroneContinuation,
    suggestDefaultName,
    systemDraft,
  } = scope
  if (!branch) return null
  return <>
{showIsochroneContinuation ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-isochrone-curve`}
                    title={branch.branchType === 'isochrone_curve' ? 'Continue from Point' : 'Continue Isochrone'}
                    testId="isochrone-curve-toggle"
                    defaultOpen={false}
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="empty-state">
                          Add a second parameter to enable isochrone continuation.
                        </p>
                      ) : null}
                      <label>
                        Curve name
                        <input
                          value={isochroneCurveDraft.name}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={suggestDefaultName('isochroneCurve', {
                            sourceName: branch.name,
                            existingNames: existingBranchNames,
                          })}
                          data-testid="isochrone-curve-name"
                        />
                      </label>
                      <label>
                        First parameter
                        <select
                          value={isochroneCurveDraft.parameterName}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => {
                              const parameterName = event.target.value
                              const fallbackParam2 =
                                continuationParameterLabels.find((name) => name !== parameterName) ?? ''
                              const param2Name =
                                prev.param2Name !== parameterName &&
                                continuationParameterSet.has(prev.param2Name)
                                  ? prev.param2Name
                                  : fallbackParam2
                              return { ...prev, parameterName, param2Name }
                            })
                          }
                          disabled={isochroneParam1Options.length === 0}
                          data-testid="isochrone-curve-param1"
                        >
                          {isochroneParam1Options.map((name) => {
                            const idx = systemDraft.paramNames.indexOf(name)
                            const branchValue =
                              branchParams.length === systemDraft.paramNames.length
                                ? branchParams[idx]
                                : undefined
                            const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                            const value = branchValue ?? fallbackValue
                            const label = `${name} (current: ${formatNumber(
                              value ?? Number.NaN,
                              6
                            )})`
                            return (
                              <option key={name} value={name}>
                                {label}
                              </option>
                            )
                          })}
                        </select>
                      </label>
                      <label>
                        Second parameter
                        <select
                          value={isochroneCurveDraft.param2Name}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              param2Name: event.target.value,
                            }))
                          }
                          disabled={isochroneParam2Options.length === 0}
                          data-testid="isochrone-curve-param2"
                        >
                          {isochroneParam2Options.map((name) => {
                            const idx = systemDraft.paramNames.indexOf(name)
                            const branchValue =
                              branchParams.length === systemDraft.paramNames.length
                                ? branchParams[idx]
                                : undefined
                            const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                            const value = branchValue ?? fallbackValue
                            const label = `${name} (current: ${formatNumber(
                              value ?? Number.NaN,
                              6
                            )})`
                            return (
                              <option key={name} value={name}>
                                {label}
                              </option>
                            )
                          })}
                        </select>
                      </label>
                      <label>
                        Direction
                        <select
                          value={isochroneCurveDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="isochrone-curve-direction"
                        >
                          <option value="forward">Forward</option>
                          <option value="backward">Backward</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={isochroneCurveDraft.stepSize}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-step-size"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={isochroneCurveDraft.minStepSize}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-min-step-size"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={isochroneCurveDraft.maxStepSize}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-max-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={isochroneCurveDraft.maxSteps}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-max-steps"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={isochroneCurveDraft.correctorSteps}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={isochroneCurveDraft.correctorTolerance}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={isochroneCurveDraft.stepTolerance}
                          onChange={(event) =>
                            setIsochroneCurveDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="isochrone-curve-step-tolerance"
                        />
                      </label>
                      {isochroneCurveError ? (
                        <div className="field-error">{isochroneCurveError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateIsochroneCurve}
                        disabled={
                          runDisabled ||
                          !selectedBranchPoint ||
                          (branch.branchType !== 'limit_cycle' &&
                            branch.branchType !== 'isochrone_curve')
                        }
                        data-testid="isochrone-curve-submit"
                      >
                        {branch.branchType === 'isochrone_curve'
                          ? 'Continue from Point'
                          : 'Continue Isochrone'}
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
