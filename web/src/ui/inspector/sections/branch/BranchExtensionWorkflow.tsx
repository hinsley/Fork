import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'

export function BranchExtensionWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchExtensionDraft,
    branchExtensionError,
    canExtendBranch,
    handleExtendBranch,
    runDisabled,
    selectionKey,
    setBranchExtensionDraft,
  } = scope
  return <>
{canExtendBranch ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-branch-extend`}
                    title="Extend Branch"
                    testId="branch-extend-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before extending.
                        </div>
                      ) : null}
                      <label>
                        Direction
                        <select
                          value={branchExtensionDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-direction"
                        >
                          <option value="forward">Forward (Increasing Index)</option>
                          <option value="backward">Backward (Decreasing Index)</option>
                        </select>
                      </label>
                      <label>
                        Max points to add
                        <input
                          type="number"
                          value={branchExtensionDraft.maxSteps}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-max-steps"
                        />
                      </label>
                      <label>
                        Step size
                        <input
                          type="number"
                          value={branchExtensionDraft.stepSize}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-step-size"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={branchExtensionDraft.minStepSize}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-min-step"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={branchExtensionDraft.maxStepSize}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-max-step"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={branchExtensionDraft.correctorSteps}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={branchExtensionDraft.correctorTolerance}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={branchExtensionDraft.stepTolerance}
                          onChange={(event) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          disabled={!canExtendBranch}
                          data-testid="branch-extend-step-tolerance"
                        />
                      </label>
                      {branch &&
                      (branch.branchType === 'limit_cycle' ||
                        branch.branchType === 'isoperiodic_curve' ||
                        branch.branchType === 'lpc_curve' ||
                        branch.branchType === 'pd_curve' ||
                        branch.branchType === 'ns_curve') ? (
                        <CollocationAdaptivityFields
                          draft={branchExtensionDraft}
                          onChange={(patch) =>
                            setBranchExtensionDraft((prev) => ({ ...prev, ...patch }))
                          }
                          testIdPrefix="branch-extend"
                        />
                      ) : null}
                      {branchExtensionError ? (
                        <div className="field-error">{branchExtensionError}</div>
                      ) : null}
                      <button
                        onClick={handleExtendBranch}
                        disabled={runDisabled || !canExtendBranch}
                        data-testid="branch-extend-submit"
                      >
                        Extend Branch
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
