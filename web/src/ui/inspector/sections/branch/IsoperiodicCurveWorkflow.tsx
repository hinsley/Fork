import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function IsoperiodicCurveWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchParams,
    continuationParameterCount,
    continuationParameterLabels,
    continuationParameterSet,
    existingBranchNames,
    formatNumber,
    handleCreateIsoperiodicCurve,
    isoperiodicCurveDraft,
    isoperiodicCurveError,
    isoperiodicParam1Options,
    isoperiodicParam2Options,
    parseNumber,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setIsoperiodicCurveDraft,
    showIsoperiodicContinuation,
    suggestDefaultName,
    systemDraft,
  } = scope
  if (!branch) return null
  return <>
{showIsoperiodicContinuation ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-isoperiodic-curve`}
                    title={
                      branch.branchType === 'isoperiodic_curve'
                        ? 'Continue from Point'
                        : 'Continue Isoperiodic Curve'
                    }
                    testId="isoperiodic-curve-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="empty-state">
                          Add a second parameter to enable isoperiodic curve continuation.
                        </p>
                      ) : null}
                      <label>
                        Curve name
                        <input
                          value={isoperiodicCurveDraft.name}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={suggestDefaultName('isoperiodicCurve', {
                            sourceName: branch.name,
                            existingNames: existingBranchNames,
                          })}
                          data-testid="isoperiodic-curve-name"
                        />
                      </label>
                      <label>
                        First parameter
                        <select
                          value={isoperiodicCurveDraft.parameterName}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => {
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
                          disabled={isoperiodicParam1Options.length === 0}
                          data-testid="isoperiodic-curve-param1"
                        >
                          {isoperiodicParam1Options.map((name) => {
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
                          value={isoperiodicCurveDraft.param2Name}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              param2Name: event.target.value,
                            }))
                          }
                          disabled={isoperiodicParam2Options.length === 0}
                          data-testid="isoperiodic-curve-param2"
                        >
                          {isoperiodicParam2Options.map((name) => {
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
                          value={isoperiodicCurveDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="isoperiodic-curve-direction"
                        >
                          <option value="forward">Forward</option>
                          <option value="backward">Backward</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.stepSize}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-step-size"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.minStepSize}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-min-step-size"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.maxStepSize}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-max-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.maxSteps}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-max-steps"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.correctorSteps}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.correctorTolerance}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={isoperiodicCurveDraft.stepTolerance}
                          onChange={(event) =>
                            setIsoperiodicCurveDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="isoperiodic-curve-step-tolerance"
                        />
                      </label>
                      {isoperiodicCurveError ? (
                        <div className="field-error">{isoperiodicCurveError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateIsoperiodicCurve}
                        disabled={
                          runDisabled ||
                          !selectedBranchPoint ||
                          (branch.branchType !== 'limit_cycle' &&
                            branch.branchType !== 'isoperiodic_curve')
                        }
                        data-testid="isoperiodic-curve-submit"
                      >
                        {branch.branchType === 'isoperiodic_curve'
                          ? 'Continue from Point'
                          : 'Continue Isoperiodic Curve'}
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
