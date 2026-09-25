import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import { PeriodicLinearSolverField } from './PeriodicLinearSolverField'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

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
  const branchExtensionStepIssues = validateStepSizes(branchExtensionDraft)
  return <>
{canExtendBranch ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-branch-extend`}
                    title="Extend branch"
                    testId="branch-extend-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes first.
                        </div>
                      ) : null}
                      <label title="Point index direction to extend">
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
                          <option value="forward">→ Increasing</option>
                          <option value="backward">← Decreasing</option>
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
                          aria-invalid={branchExtensionStepIssues.stepSize || undefined}
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
                          aria-invalid={branchExtensionStepIssues.minStepSize || undefined}
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
                          aria-invalid={branchExtensionStepIssues.maxStepSize || undefined}
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
                      <StepSizeError issues={branchExtensionStepIssues} testId="branch-extend-step-error" />
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
                      {branch?.branchType === 'limit_cycle' ? (
                        <PeriodicLinearSolverField
                          useDenseSolve={branchExtensionDraft.useDenseSolve ?? false}
                          onChange={(useDenseSolve) =>
                            setBranchExtensionDraft((prev) => ({
                              ...prev,
                              useDenseSolve,
                            }))
                          }
                          testId="branch-extend-use-dense-solve"
                        />
                      ) : null}
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
                        className="inspector-primary-action"
                        onClick={handleExtendBranch}
                        disabled={branchExtensionStepIssues.invalid || runDisabled || !canExtendBranch}
                        data-testid="branch-extend-submit"
                      >
                        Extend
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
