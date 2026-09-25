import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import { PeriodicLinearSolverField } from './PeriodicLinearSolverField'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

export function LimitCycleFromPDWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    branchParameterName,
    equilibriumDraft,
    handleCreateCycleFromPD,
    handleCreateLimitCycleFromPD,
    limitCycleFromPDBranchSuggestion,
    limitCycleFromPDDraft,
    limitCycleFromPDError,
    limitCycleFromPDLabel,
    limitCycleFromPDNameSuggestion,
    pdObjectLabelName,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setEquilibriumDraft,
    setLimitCycleFromPDDraft,
    showLimitCycleFromPD,
    systemDraft,
  } = scope
  const limitCycleFromPDStepIssues = validateStepSizes(limitCycleFromPDDraft)
  if (!branch) return null
  return <>
{showLimitCycleFromPD ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-limit-cycle-pd`}
                    title={limitCycleFromPDLabel}
                    testId="limit-cycle-from-pd-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                    {systemDraft.type === 'map' ? (
                      branch.branchType !== 'equilibrium' ? (
                        <p className="field-warning">Needs a cycle branch.</p>
                      ) : null
                    ) : branch.branchType !== 'limit_cycle' ? (
                      <p className="field-warning">Needs a limit-cycle branch.</p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes first.
                      </div>
                    ) : null}
                    {!selectedBranchPoint ? (
                      <p className="field-warning">Select a point.</p>
                    ) : selectedBranchPoint.stability !== 'PeriodDoubling' ? (
                      <p className="field-warning">Select a PD point.</p>
                    ) : (
                      <>
                        <label>
                          {pdObjectLabelName} name
                          <input
                            value={limitCycleFromPDDraft.limitCycleName}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                limitCycleName: event.target.value,
                              }))
                            }
                            placeholder={limitCycleFromPDNameSuggestion}
                            data-testid="limit-cycle-from-pd-name"
                          />
                        </label>
                        <label>
                          Branch name
                          <input
                            value={limitCycleFromPDDraft.branchName}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                branchName: event.target.value,
                              }))
                            }
                            placeholder={limitCycleFromPDBranchSuggestion}
                            data-testid="limit-cycle-from-pd-branch-name"
                          />
                        </label>
                        <div className="inspector-divider">Initialization</div>
                        <label>
                          Continuation parameter
                          <input
                            value={branchParameterName}
                            disabled
                            data-testid="limit-cycle-from-pd-parameter"
                          />
                        </label>
                        <label>
                          Perturbation amplitude
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.amplitude}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                amplitude: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-amplitude"
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={limitCycleFromPDDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                            data-testid="limit-cycle-from-pd-direction"
                          >
                            <option value="forward">→ Increasing</option>
                            <option value="backward">← Decreasing</option>
                          </select>
                        </label>
                        {systemDraft.type === 'map' ? (
                          <>
                            <label>
                              Max solver steps
                              <input
                                type="number"
                                value={equilibriumDraft.maxSteps}
                                onChange={(event) =>
                                  setEquilibriumDraft((prev) => ({
                                    ...prev,
                                    maxSteps: event.target.value,
                                  }))
                                }
                                data-testid="limit-cycle-from-pd-solver-steps"
                              />
                            </label>
                            <label>
                              Damping factor
                              <input
                                type="number"
                                value={equilibriumDraft.dampingFactor}
                                onChange={(event) =>
                                  setEquilibriumDraft((prev) => ({
                                    ...prev,
                                    dampingFactor: event.target.value,
                                  }))
                                }
                                data-testid="limit-cycle-from-pd-solver-damping"
                              />
                            </label>
                          </>
                        ) : null}
                        <div className="inspector-divider">Predictor</div>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.stepSize}
                            aria-invalid={limitCycleFromPDStepIssues.stepSize || undefined}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.maxSteps}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-max-steps"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.minStepSize}
                            aria-invalid={limitCycleFromPDStepIssues.minStepSize || undefined}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.maxStepSize}
                            aria-invalid={limitCycleFromPDStepIssues.maxStepSize || undefined}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-max-step-size"
                          />
                        </label>
                        <StepSizeError issues={limitCycleFromPDStepIssues} testId="limit-cycle-from-pd-step-error" />
                        <div className="inspector-divider">Corrector</div>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.correctorSteps}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.correctorTolerance}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.stepTolerance}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-step-tolerance"
                          />
                        </label>
                        {systemDraft.type === 'flow' ? (
                          <>
                            <PeriodicLinearSolverField
                              useDenseSolve={limitCycleFromPDDraft.useDenseSolve}
                              onChange={(useDenseSolve) =>
                                setLimitCycleFromPDDraft((prev) => ({
                                  ...prev,
                                  useDenseSolve,
                                }))
                              }
                              testId="limit-cycle-from-pd-use-dense-solve"
                            />
                            <CollocationAdaptivityFields
                              draft={limitCycleFromPDDraft}
                              onChange={(patch) =>
                                setLimitCycleFromPDDraft((prev) => ({ ...prev, ...patch }))
                              }
                              testIdPrefix="limit-cycle-from-pd"
                            />
                          </>
                        ) : null}
                        {limitCycleFromPDError ? (
                          <div className="field-error">{limitCycleFromPDError}</div>
                        ) : null}
                        <button
                          className="inspector-primary-action"
                          onClick={
                            systemDraft.type === 'map'
                              ? handleCreateCycleFromPD
                              : handleCreateLimitCycleFromPD
                          }
                          disabled={
                            limitCycleFromPDStepIssues.invalid ||
                            runDisabled ||
                            (systemDraft.type === 'map'
                              ? branch.branchType !== 'equilibrium'
                              : branch.branchType !== 'limit_cycle') ||
                            selectedBranchPoint?.stability !== 'PeriodDoubling'
                          }
                          data-testid="limit-cycle-from-pd-submit"
                        >
                          Continue
                        </button>
                      </>
                    )}
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
