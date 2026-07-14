import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { isHomoclinicExtraSelectionDisabled } from '../../../../system/homoclinicExtras'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'

export function HomoclinicRestartWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    continuationParameterLabels,
    continuationParameterSet,
    existingBranchNames,
    handleCreateHomoclinicFromHomoclinic,
    homoclinicFromHomoclinicDraft,
    homoclinicFromHomoclinicError,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setHomoclinicFromHomoclinicDraft,
    showHomoclinicFromHomoclinic,
    suggestDefaultName,
  } = scope
  if (!branch) return null
  const sourceType = branch.data.branch_type
  const sourceUsesShooting =
    sourceType?.type === 'HomoclinicCurve' &&
    (sourceType.discretization?.type === 'shooting' || sourceType.ncol === 0)
  return <>
{showHomoclinicFromHomoclinic ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-homoclinic-homoclinic`}
                    title="Continue from Point"
                    testId="homoclinic-from-homoclinic-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before continuing.
                        </div>
                      ) : null}
                      {!selectedBranchPoint ? (
                        <p className="empty-state">Select a branch point to continue.</p>
                      ) : (
                        <>
                          <label>
                            Branch name
                            <input
                              value={homoclinicFromHomoclinicDraft.name}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('homoclinicRestart', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="homoclinic-from-homoclinic-name"
                            />
                          </label>
                          <label>
                            First parameter
                            <select
                              value={homoclinicFromHomoclinicDraft.parameterName}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => {
                                  const parameterName = event.target.value
                                  const fallbackParam2 =
                                    continuationParameterLabels.find(
                                      (name) => name !== parameterName
                                    ) ??
                                    continuationParameterLabels[0] ??
                                    ''
                                  const param2Name =
                                    prev.param2Name !== parameterName &&
                                    continuationParameterSet.has(prev.param2Name)
                                      ? prev.param2Name
                                      : fallbackParam2
                                  return { ...prev, parameterName, param2Name }
                                })
                              }
                              data-testid="homoclinic-from-homoclinic-parameter"
                            >
                              {continuationParameterLabels.map((name) => (
                                <option key={`homoc-homoc-param1-${name}`} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Second parameter
                            <select
                              value={homoclinicFromHomoclinicDraft.param2Name}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-param2"
                            >
                              {continuationParameterLabels
                                .filter((name) => name !== homoclinicFromHomoclinicDraft.parameterName)
                                .map((name) => (
                                  <option key={`homoc-homoc-param2-${name}`} value={name}>
                                    {name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <div className="inspector-divider">Initialization</div>
                          <label>
                            Method
                            <select
                              value={homoclinicFromHomoclinicDraft.discretization}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  discretization:
                                    event.target.value === 'shooting'
                                      ? 'shooting'
                                      : 'collocation',
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-discretization"
                            >
                              <option value="collocation" disabled={sourceUsesShooting}>
                                Orthogonal Collocation
                              </option>
                              <option value="shooting">Standard Shooting</option>
                            </select>
                          </label>
                          {sourceUsesShooting ? (
                            <p className="field-help">
                              A standard-shooting source restarts with standard shooting.
                            </p>
                          ) : null}
                          {homoclinicFromHomoclinicDraft.discretization === 'collocation' ? (
                            <>
                              <label>
                                Target NTST
                                <input
                                  type="number"
                                  value={homoclinicFromHomoclinicDraft.targetNtst}
                                  onChange={(event) =>
                                    setHomoclinicFromHomoclinicDraft((prev) => ({
                                      ...prev,
                                      targetNtst: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-homoclinic-ntst"
                                />
                              </label>
                              <label>
                                Target NCOL
                                <input
                                  type="number"
                                  value={homoclinicFromHomoclinicDraft.targetNcol}
                                  onChange={(event) =>
                                    setHomoclinicFromHomoclinicDraft((prev) => ({
                                      ...prev,
                                      targetNcol: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-homoclinic-ncol"
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <label>
                                Shooting intervals
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={homoclinicFromHomoclinicDraft.shootingIntervals}
                                  onChange={(event) =>
                                    setHomoclinicFromHomoclinicDraft((prev) => ({
                                      ...prev,
                                      shootingIntervals: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-homoclinic-shooting-intervals"
                                />
                              </label>
                              <label>
                                Integration steps per segment
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={
                                    homoclinicFromHomoclinicDraft.integrationStepsPerSegment
                                  }
                                  onChange={(event) =>
                                    setHomoclinicFromHomoclinicDraft((prev) => ({
                                      ...prev,
                                      integrationStepsPerSegment: event.target.value,
                                    }))
                                  }
                                  data-testid="homoclinic-from-homoclinic-integration-steps"
                                />
                              </label>
                            </>
                          )}
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomoclinicDraft.freeTime}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomoclinicDraft,
                                'freeTime'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  freeTime: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-free-time"
                            />
                            Free T
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomoclinicDraft.freeEps0}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomoclinicDraft,
                                'freeEps0'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  freeEps0: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-free-eps0"
                            />
                            Free eps0
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomoclinicDraft.freeEps1}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomoclinicDraft,
                                'freeEps1'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  freeEps1: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-free-eps1"
                            />
                            Free eps1
                          </label>
                          <label>
                            Direction
                            <select
                              value={
                                homoclinicFromHomoclinicDraft.forward
                                  ? 'forward'
                                  : 'backward'
                              }
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-direction"
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
                              value={homoclinicFromHomoclinicDraft.stepSize}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.maxSteps}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-max-steps"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.minStepSize}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.maxStepSize}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-max-step-size"
                            />
                          </label>
                          <div className="inspector-divider">Corrector</div>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.correctorSteps}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.correctorTolerance}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={homoclinicFromHomoclinicDraft.stepTolerance}
                              onChange={(event) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homoclinic-step-tolerance"
                            />
                          </label>
                          {homoclinicFromHomoclinicDraft.discretization === 'collocation' ? (
                            <CollocationAdaptivityFields
                              draft={homoclinicFromHomoclinicDraft}
                              onChange={(patch) =>
                                setHomoclinicFromHomoclinicDraft((prev) => ({
                                  ...prev,
                                  ...patch,
                                }))
                              }
                              testIdPrefix="homoclinic-from-homoclinic"
                            />
                          ) : null}
                          {homoclinicFromHomoclinicError ? (
                            <div className="field-error">{homoclinicFromHomoclinicError}</div>
                          ) : null}
                          <button
                            onClick={handleCreateHomoclinicFromHomoclinic}
                            disabled={
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'homoclinic_curve'
                            }
                            data-testid="homoclinic-from-homoclinic-submit"
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
