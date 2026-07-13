import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'

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
    pdObjectLabel,
    pdObjectLabelName,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setEquilibriumDraft,
    setLimitCycleFromPDDraft,
    showLimitCycleFromPD,
    systemDraft,
  } = scope
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
                        <p className="empty-state">
                          Period-doubling branching for maps requires a cycle branch.
                        </p>
                      ) : null
                    ) : branch.branchType !== 'limit_cycle' ? (
                      <p className="empty-state">
                        Period-doubling branching is only available for limit cycle branches.
                      </p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {!selectedBranchPoint ? (
                      <p className="empty-state">Select a branch point to continue.</p>
                    ) : selectedBranchPoint.stability !== 'PeriodDoubling' ? (
                      <p className="empty-state">
                        Select a Period Doubling point to branch.
                      </p>
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
                            <option value="forward">Forward (Increasing Param)</option>
                            <option value="backward">Backward (Decreasing Param)</option>
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
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-max-step-size"
                          />
                        </label>
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
                          <CollocationAdaptivityFields
                            draft={limitCycleFromPDDraft}
                            onChange={(patch) =>
                              setLimitCycleFromPDDraft((prev) => ({ ...prev, ...patch }))
                            }
                            testIdPrefix="limit-cycle-from-pd"
                          />
                        ) : null}
                        {limitCycleFromPDError ? (
                          <div className="field-error">{limitCycleFromPDError}</div>
                        ) : null}
                        <button
                          onClick={
                            systemDraft.type === 'map'
                              ? handleCreateCycleFromPD
                              : handleCreateLimitCycleFromPD
                          }
                          disabled={
                            runDisabled ||
                            (systemDraft.type === 'map'
                              ? branch.branchType !== 'equilibrium'
                              : branch.branchType !== 'limit_cycle') ||
                            selectedBranchPoint?.stability !== 'PeriodDoubling'
                          }
                          data-testid="limit-cycle-from-pd-submit"
                        >
                          {`Continue ${pdObjectLabel}`}
                        </button>
                      </>
                    )}
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
