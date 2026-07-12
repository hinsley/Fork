import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function BranchContinueWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchContinuationDraft,
    branchContinuationError,
    branchSupportsContinueFromPoint,
    buildSuggestedBranchName,
    continuationParameterCount,
    continuationParameterLabels,
    existingBranchNames,
    handleCreateBranchFromPoint,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setBranchContinuationDraft,
    showBranchContinueFromPoint,
    suggestDefaultName,
  } = scope
  if (!branch) return null
  return <>
{showBranchContinueFromPoint ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-branch-continue`}
                    title="Continue from Point"
                    testId="branch-continue-toggle"
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
                      <label>
                        Branch name
                        <input
                          value={branchContinuationDraft.name}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={
                            suggestDefaultName('branchContinuation', {
                              sourceName: branch.name,
                              parameterName: branchContinuationDraft.parameterName,
                              existingNames: existingBranchNames,
                            })
                          }
                          data-testid="branch-from-point-name"
                        />
                      </label>
                      <div className="inspector-divider">Initialization</div>
                      <label>
                        Continuation parameter
                        <select
                          value={branchContinuationDraft.parameterName}
                          onChange={(event) => {
                            const nextParameterName = event.target.value
                            setBranchContinuationDraft((prev) => {
                              const prevSuggestedName = buildSuggestedBranchName(
                                branch.name,
                                prev.parameterName,
                                existingBranchNames
                              )
                              const nextSuggestedName = buildSuggestedBranchName(
                                branch.name,
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
                          data-testid="branch-from-point-parameter"
                        >
                          {continuationParameterLabels.map((name) => (
                            <option key={name} value={name}>
                              {name}
                              {name === branch.parameterName ? ' (current)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Direction
                        <select
                          value={branchContinuationDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="branch-from-point-direction"
                        >
                          <option value="forward">Forward (Increasing Param)</option>
                          <option value="backward">Backward (Decreasing Param)</option>
                        </select>
                      </label>
                      <div className="inspector-divider">Predictor</div>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={branchContinuationDraft.stepSize}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={branchContinuationDraft.maxSteps}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-max-steps"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={branchContinuationDraft.minStepSize}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-min-step"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={branchContinuationDraft.maxStepSize}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-max-step"
                        />
                      </label>
                      <div className="inspector-divider">Corrector</div>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={branchContinuationDraft.correctorSteps}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={branchContinuationDraft.correctorTolerance}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={branchContinuationDraft.stepTolerance}
                          onChange={(event) =>
                            setBranchContinuationDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="branch-from-point-step-tolerance"
                        />
                      </label>
                      {branchContinuationError ? (
                        <div className="field-error">{branchContinuationError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateBranchFromPoint}
                        disabled={
                          runDisabled ||
                          !selectedBranchPoint ||
                          !branchSupportsContinueFromPoint
                        }
                        data-testid="branch-from-point-submit"
                      >
                        Create Branch
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
