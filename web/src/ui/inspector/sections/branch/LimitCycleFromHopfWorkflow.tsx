import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../../system/subsystemGateway'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'

export function LimitCycleFromHopfWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    buildSuggestedBranchName,
    continuationParameterCount,
    continuationParameterLabels,
    existingObjectNames,
    handleCreateLimitCycleFromHopf,
    isHopfPointSelected,
    isHopfSourceBranch,
    limitCycleFromHopfBranchSuggestion,
    limitCycleFromHopfDraft,
    limitCycleFromHopfError,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setLimitCycleFromHopfDraft,
    showLimitCycleFromHopf,
    suggestDefaultName,
  } = scope
  if (!branch) return null
  return <>
{showLimitCycleFromHopf ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-limit-cycle-hopf`}
                    title="Limit Cycle from Hopf"
                    testId="limit-cycle-from-hopf-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {!isHopfSourceBranch ? (
                        <p className="empty-state">
                          Limit cycle continuation is only available for equilibrium or Hopf curve
                          branches.
                        </p>
                      ) : null}
                      {continuationParameterCount === 0 ? (
                        <p className="empty-state">Add a parameter before continuing.</p>
                      ) : null}
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {!isHopfSourceBranch ||
                      continuationParameterCount === 0 ? null : !selectedBranchPoint ? (
                        <p className="empty-state">Select a branch point to continue.</p>
                      ) : !isHopfPointSelected ? (
                        <p className="empty-state">
                          Select a Hopf bifurcation point to continue a limit cycle.
                        </p>
                      ) : (
                          <>
                            <label>
                              Limit cycle name
                              <input
                                value={limitCycleFromHopfDraft.limitCycleName}
                                onChange={(event) =>
                                  setLimitCycleFromHopfDraft((prev) => ({
                                    ...prev,
                                    limitCycleName: event.target.value,
                                  }))
                                }
                                placeholder={suggestDefaultName('limitCycle', {
                                  sourceName: branch.name,
                                  existingNames: existingObjectNames,
                                })}
                                data-testid="limit-cycle-from-hopf-name"
                              />
                            </label>
                            <label>
                              Branch name
                              <input
                                value={limitCycleFromHopfDraft.branchName}
                                onChange={(event) =>
                                  setLimitCycleFromHopfDraft((prev) => ({
                                    ...prev,
                                    branchName: event.target.value,
                                  }))
                                }
                                placeholder={limitCycleFromHopfBranchSuggestion}
                                data-testid="limit-cycle-from-hopf-branch-name"
                              />
                            </label>
                            <label>
                              Continuation parameter
                              <select
                                value={limitCycleFromHopfDraft.parameterName}
                                onChange={(event) => {
                                  const nextParameterName = event.target.value
                                  setLimitCycleFromHopfDraft((prev) => {
                                    const baseName =
                                      prev.limitCycleName.trim() ||
                                      suggestDefaultName('limitCycle', {
                                        sourceName: branch.name,
                                        existingNames: existingObjectNames,
                                      })
                                    const prevSuggestedName = buildSuggestedBranchName(
                                      baseName,
                                      prev.parameterName
                                    )
                                    const nextSuggestedName = buildSuggestedBranchName(
                                      baseName,
                                      nextParameterName
                                    )
                                    const shouldUpdateName =
                                      prev.branchName === prevSuggestedName
                                    return {
                                      ...prev,
                                      parameterName: nextParameterName,
                                      branchName: shouldUpdateName
                                        ? nextSuggestedName
                                        : prev.branchName,
                                    }
                                  })
                                }}
                                data-testid="limit-cycle-from-hopf-parameter"
                              >
                              {continuationParameterLabels.map((name) => (
                                <option key={name} value={name}>
                                  {formatContinuationParameterDisplayLabel(name)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Initial amplitude
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.amplitude}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  amplitude: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-amplitude"
                            />
                          </label>
                          <label>
                            NTST
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.ntst}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  ntst: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-ntst"
                            />
                            <span className="field-help">Mesh intervals along the cycle.</span>
                          </label>
                          <label>
                            NCOL
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.ncol}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  ncol: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-ncol"
                            />
                            <span className="field-help">
                              Collocation points per mesh interval.
                            </span>
                          </label>
                          <label>
                            Direction
                            <select
                              value={limitCycleFromHopfDraft.forward ? 'forward' : 'backward'}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-direction"
                            >
                              <option value="forward">Forward (Increasing Param)</option>
                              <option value="backward">Backward (Decreasing Param)</option>
                            </select>
                          </label>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.stepSize}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.maxSteps}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-max-steps"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.minStepSize}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.maxStepSize}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-max-step-size"
                            />
                          </label>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.correctorSteps}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.correctorTolerance}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={limitCycleFromHopfDraft.stepTolerance}
                              onChange={(event) =>
                                setLimitCycleFromHopfDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="limit-cycle-from-hopf-step-tolerance"
                            />
                          </label>
                          <CollocationAdaptivityFields
                            draft={limitCycleFromHopfDraft}
                            onChange={(patch) =>
                              setLimitCycleFromHopfDraft((prev) => ({ ...prev, ...patch }))
                            }
                            testIdPrefix="limit-cycle-from-hopf"
                          />
                          {limitCycleFromHopfError ? (
                            <div className="field-error">{limitCycleFromHopfError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateLimitCycleFromHopf}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              !isHopfSourceBranch ||
                              !isHopfPointSelected ||
                              continuationParameterCount === 0
                            }
                            data-testid="limit-cycle-from-hopf-submit"
                          >
                            Continue Limit Cycle
                          </button>
                          </>
                    )}
                  </div>
                </InspectorDisclosure>
                ) : null}
  </>
}
