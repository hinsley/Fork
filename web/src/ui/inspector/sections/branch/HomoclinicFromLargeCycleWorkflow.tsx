import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../../system/subsystemGateway'
import { isHomoclinicExtraSelectionDisabled } from '../../../../system/homoclinicExtras'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

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
  const homoclinicFromLargeCycleStepIssues = validateStepSizes(homoclinicFromLargeCycleDraft)
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
                        <p className="field-warning">Flow systems only.</p>
                      ) : null}
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes first.
                        </div>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="field-warning">Needs a second parameter.</p>
                      ) : null}
                      {!selectedBranchPoint ? (
                        <p className="field-warning">Select a point.</p>
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
                                  {formatContinuationParameterDisplayLabel(name)}
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
                                    {formatContinuationParameterDisplayLabel(name)}
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
                              <option value="forward">→ Increasing</option>
                              <option value="backward">← Decreasing</option>
                            </select>
                          </label>
                          <div className="inspector-divider">Predictor</div>
                          <label>
                            Initial step size
                            <input
                              type="number"
                              value={homoclinicFromLargeCycleDraft.stepSize}
                              aria-invalid={homoclinicFromLargeCycleStepIssues.stepSize || undefined}
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
                              aria-invalid={homoclinicFromLargeCycleStepIssues.minStepSize || undefined}
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
                              aria-invalid={homoclinicFromLargeCycleStepIssues.maxStepSize || undefined}
                              onChange={(event) =>
                                setHomoclinicFromLargeCycleDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-large-cycle-max-step-size"
                            />
                          </label>
                          <StepSizeError issues={homoclinicFromLargeCycleStepIssues} testId="homoclinic-from-large-cycle-step-error" />
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
                            className="inspector-primary-action"
                            onClick={handleCreateHomoclinicFromLargeCycle}
                            disabled={
                              homoclinicFromLargeCycleStepIssues.invalid ||
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'limit_cycle' ||
                              systemDraft.type === 'map'
                            }
                            data-testid="homoclinic-from-large-cycle-submit"
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
