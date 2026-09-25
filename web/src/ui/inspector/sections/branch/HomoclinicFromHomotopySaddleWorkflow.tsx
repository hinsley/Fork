import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { isHomoclinicExtraSelectionDisabled } from '../../../../system/homoclinicExtras'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

export function HomoclinicFromHomotopySaddleWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    existingBranchNames,
    handleCreateHomoclinicFromHomotopySaddle,
    homoclinicFromHomotopySaddleDraft,
    homoclinicFromHomotopySaddleError,
    homotopyBranchStage,
    homotopyStageDReady,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setHomoclinicFromHomotopySaddleDraft,
    showHomoclinicFromHomotopySaddle,
    suggestDefaultName,
  } = scope
  const homoclinicFromHomotopySaddleStepIssues = validateStepSizes(homoclinicFromHomotopySaddleDraft)
  if (!branch) return null
  return <>
{showHomoclinicFromHomotopySaddle ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-homoclinic-homotopy-saddle`}
                    title="Homoclinic from homotopy saddle"
                    testId="homoclinic-from-homotopy-saddle-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {!homotopyStageDReady ? (
                        <p
                          className="field-warning"
                          title="Continue the homotopy-saddle branch to StageD first."
                        >
                          {`Needs StageD (at ${homotopyBranchStage ?? 'unknown'}).`}
                        </p>
                      ) : null}
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes first.
                        </div>
                      ) : null}
                      {!selectedBranchPoint ? (
                        <p className="field-warning">Select a point.</p>
                      ) : (
                        <>
                          <label>
                            Branch name
                            <input
                              value={homoclinicFromHomotopySaddleDraft.name}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('homoclinicStageD', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="homoclinic-from-homotopy-saddle-name"
                            />
                          </label>
                          <div className="inspector-divider">Initialization</div>
                          <label>
                            Target NTST
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.targetNtst}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  targetNtst: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-ntst"
                            />
                          </label>
                          <label>
                            Target NCOL
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.targetNcol}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  targetNcol: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-ncol"
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomotopySaddleDraft.freeTime}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomotopySaddleDraft,
                                'freeTime'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  freeTime: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-free-time"
                            />
                            Free T
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomotopySaddleDraft.freeEps0}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomotopySaddleDraft,
                                'freeEps0'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  freeEps0: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-free-eps0"
                            />
                            Free eps0
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={homoclinicFromHomotopySaddleDraft.freeEps1}
                              disabled={isHomoclinicExtraSelectionDisabled(
                                homoclinicFromHomotopySaddleDraft,
                                'freeEps1'
                              )}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  freeEps1: event.target.checked,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-free-eps1"
                            />
                            Free eps1
                          </label>
                          <label>
                            Direction
                            <select
                              value={
                                homoclinicFromHomotopySaddleDraft.forward
                                  ? 'forward'
                                  : 'backward'
                              }
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-direction"
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
                              value={homoclinicFromHomotopySaddleDraft.stepSize}
                              aria-invalid={homoclinicFromHomotopySaddleStepIssues.stepSize || undefined}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.maxSteps}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-max-steps"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.minStepSize}
                              aria-invalid={homoclinicFromHomotopySaddleStepIssues.minStepSize || undefined}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.maxStepSize}
                              aria-invalid={homoclinicFromHomotopySaddleStepIssues.maxStepSize || undefined}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-max-step-size"
                            />
                          </label>
                          <StepSizeError issues={homoclinicFromHomotopySaddleStepIssues} testId="homoclinic-from-homotopy-saddle-step-error" />
                          <div className="inspector-divider">Corrector</div>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.correctorSteps}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.correctorTolerance}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={homoclinicFromHomotopySaddleDraft.stepTolerance}
                              onChange={(event) =>
                                setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="homoclinic-from-homotopy-saddle-step-tolerance"
                            />
                          </label>
                          <CollocationAdaptivityFields
                            draft={homoclinicFromHomotopySaddleDraft}
                            onChange={(patch) =>
                              setHomoclinicFromHomotopySaddleDraft((prev) => ({
                                ...prev,
                                ...patch,
                              }))
                            }
                            testIdPrefix="homoclinic-from-homotopy-saddle"
                          />
                          {homoclinicFromHomotopySaddleError ? (
                            <div className="field-error">{homoclinicFromHomotopySaddleError}</div>
                          ) : null}
                          <button
                            className="inspector-primary-action"
                            onClick={handleCreateHomoclinicFromHomotopySaddle}
                            disabled={
                              homoclinicFromHomotopySaddleStepIssues.invalid ||
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'homotopy_saddle_curve' ||
                              !homotopyStageDReady
                            }
                            data-testid="homoclinic-from-homotopy-saddle-submit"
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
