import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { isHomoclinicExtraSelectionDisabled } from '../../../../system/homoclinicExtras'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'

export function HomoclinicFromLargeCycleWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    continuationParameterCount,
    continuationParameterLabels,
    existingBranchNames,
    handleCreateHomoclinicFromLargeCycle,
    homoclinicFromLargeCycleDraft,
    homoclinicFromLargeCycleError,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setHomoclinicFromLargeCycleDraft,
    showHomoclinicFromLargeCycle,
    suggestDefaultName,
    systemDraft,
  } = scope
  if (!branch) return null
  return <>
{showHomoclinicFromLargeCycle ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-homoclinic-large-cycle`}
                    title="Homoclinic from Large Cycle"
                    testId="homoclinic-from-large-cycle-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {systemDraft.type === 'map' ? (
                        <p className="empty-state">
                          Homoclinic continuation is only available for flow systems.
                        </p>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="empty-state">Add a second parameter to continue.</p>
                      ) : null}
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="empty-state">Add a second parameter to continue.</p>
                      ) : null}
                      {!selectedBranchPoint ? (
                        <p className="empty-state">Select a branch point to continue.</p>
                      ) : (
                        <>
                          <label>
                            Branch name
                            <input
                              value={homoclinicFromLargeCycleDraft.name}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('homoclinic', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="homoclinic-from-large-cycle-name"
                            />
                          </label>
                          <label>
                            First parameter
                            <select
                              value={homoclinicFromLargeCycleDraft.parameterName}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  parameterName: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-param1"
                            >
                              {continuationParameterLabels.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Second parameter
                            <select
                              value={homoclinicFromLargeCycleDraft.param2Name}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-param2"
                            >
                              {continuationParameterLabels
                                .filter(
                                  (name) =>
                                    name !== homoclinicFromLargeCycleDraft.parameterName
                                )
                                .map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Method
                            <select
                              value={homoclinicFromLargeCycleDraft.discretization}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  discretization:
                                    event.target.value === 'shooting'
                                      ? 'shooting'
                                      : 'collocation',
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-method"
                            >
                              <option value="collocation">Orthogonal Collocation</option>
                              <option value="shooting">Standard Shooting</option>
                            </select>
                          </label>
                          <div className="inspector-divider">Initialization</div>
                          <label>
                            Target NTST
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.targetNtst}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  targetNtst: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-ntst"
                            />
                          </label>
                          <label>
                            Target NCOL
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.targetNcol}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  targetNcol: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-ncol"
                            />
                          </label>
                          {homoclinicFromLargeCycleDraft.discretization === 'shooting' ? (
                            <>
                              <label>
                                Shooting intervals
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={homoclinicFromLargeCycleDraft.shootingIntervals}
                                  onChange={(event) =>
                                    setHomoclinicFromLargeCycleDraft((prev) => ({
                                      ...prev,
                                      shootingIntervals: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-large-cycle-shooting-intervals"
                                />
                              </label>
                              <label>
                                Integration steps per segment
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={
                                    homoclinicFromLargeCycleDraft.integrationStepsPerSegment
                                  }
                                  onChange={(event) =>
                                    setHomoclinicFromLargeCycleDraft((prev) => ({
                                      ...prev,
                                      integrationStepsPerSegment: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-large-cycle-integration-steps-per-segment"
                                />
                              </label>
                            </>
                          ) : null}
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromLargeCycleDraft.freeTime}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromLargeCycleDraft,
                                'freeTime'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  freeTime: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-free-time"
                            />
                            Free T
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromLargeCycleDraft.freeEps0}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromLargeCycleDraft,
                                'freeEps0'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  freeEps0: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-free-eps0"
                            />
                            Free eps0
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromLargeCycleDraft.freeEps1}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromLargeCycleDraft,
                                'freeEps1'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  freeEps1: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-free-eps1"
                            />
                            Free eps1
                          </label>
                          <label>
                            Direction
                            <select
                              value={
                                homoclinicFromLargeCycleDraft.forward
                                  ? 'forward'
                                  : 'backward'
                              }
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-direction"
                            >
                              <option value="forward">Forward</option>
                              <option value="backward">Backward</option>
                            </select>
                          </label>
                          <div className="inspector-divider">Predictor</div>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.stepSize}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.maxSteps}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-max-steps"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.minStepSize}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.maxStepSize}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-max-step-size"
                            />
                          </label>
                          <div className="inspector-divider">Corrector</div>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.correctorSteps}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.correctorTolerance}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.stepTolerance}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-step-tolerance"
                            />
                          </label>
                          {homoclinicFromLargeCycleDraft.discretization === 'collocation' ? (
                            <CollocationAdaptivityFields
                              draft={homoclinicFromLargeCycleDraft}
                              onChange={(patch) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  ...patch,
                                }))
                              }
                              testIdPrefix="homoclinic-from-large-cycle"
                            />
                          ) : null}
                          {homoclinicFromLargeCycleError ? (
                            <div className="field-error">{homoclinicFromLargeCycleError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateHomoclinicFromLargeCycle}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'limit_cycle' ||
                              systemDraft.type === 'map'
                            }
                            data-testid="homoclinic-from-large-cycle-submit"
                          >
                            Continue Homoclinic
                          </button>
                        </>
                      )}
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
