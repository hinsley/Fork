import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { formatContinuationParameterDisplayLabel } from '../../../../system/subsystemGateway'
import { validateStepSizes } from './stepSizeValidation'
import { StepSizeError } from './StepSizeError'

export function HomotopySaddleWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    branch,
    continuationParameterCount,
    continuationParameterLabels,
    existingBranchNames,
    handleCreateHomotopySaddleFromEquilibrium,
    homotopySaddleFromEquilibriumDraft,
    homotopySaddleFromEquilibriumError,
    runDisabled,
    selectedBranchPoint,
    selectionKey,
    setHomotopySaddleFromEquilibriumDraft,
    showHomotopySaddleFromEquilibrium,
    suggestDefaultName,
    systemDraft,
  } = scope
  const homotopySaddleFromEquilibriumStepIssues = validateStepSizes(homotopySaddleFromEquilibriumDraft)
  if (!branch) return null
  return <>
{showHomotopySaddleFromEquilibrium ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-homotopy-saddle-equilibrium`}
                    title="Homotopy-saddle continuation"
                    testId="homotopy-saddle-from-equilibrium-toggle"
                    defaultOpen={false}
                    actionOnly
                  >
                    <div className="inspector-section">
                      {systemDraft.type === 'map' ? (
                        <p className="field-warning">Flow systems only.</p>
                      ) : null}
                      {continuationParameterCount < 2 ? (
                        <p className="field-warning">Needs a second parameter.</p>
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
                              value={homotopySaddleFromEquilibriumDraft.name}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={suggestDefaultName('homotopySaddle', {
                                sourceName: branch.name,
                                existingNames: existingBranchNames,
                              })}
                              data-testid="homotopy-saddle-from-equilibrium-name"
                            />
                          </label>
                          <label>
                            First parameter
                            <select
                              value={homotopySaddleFromEquilibriumDraft.parameterName}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  parameterName: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-param1"
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
                              value={homotopySaddleFromEquilibriumDraft.param2Name}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  param2Name: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-param2"
                            >
                              {continuationParameterLabels
                                .filter(
                                  (name) =>
                                    name !== homotopySaddleFromEquilibriumDraft.parameterName
                                )
                                .map((name) => (
                                  <option key={name} value={name}>
                                    {formatContinuationParameterDisplayLabel(name)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <div className="inspector-divider">Initialization</div>
                          <label>
                            NTST
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.ntst}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  ntst: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-ntst"
                            />
                          </label>
                          <label>
                            NCOL
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.ncol}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  ncol: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-ncol"
                            />
                          </label>
                          <label>
                            eps0
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.eps0}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  eps0: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-eps0"
                            />
                          </label>
                          <label>
                            eps1
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.eps1}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  eps1: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-eps1"
                            />
                          </label>
                          <label>
                            T
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.time}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  time: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-time"
                            />
                          </label>
                          <label>
                            eps1 tolerance
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.eps1Tol}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  eps1Tol: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-eps1-tol"
                            />
                          </label>
                          <label>
                            Direction
                            <select
                              value={
                                homotopySaddleFromEquilibriumDraft.forward
                                  ? 'forward'
                                  : 'backward'
                              }
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  forward: event.target.value === 'forward',
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-direction"
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
                              value={homotopySaddleFromEquilibriumDraft.stepSize}
                              aria-invalid={homotopySaddleFromEquilibriumStepIssues.stepSize || undefined}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  stepSize: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-step-size"
                            />
                          </label>
                          <label>
                            Max points
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.maxSteps}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  maxSteps: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-max-steps"
                            />
                          </label>
                          <label>
                            Min step size
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.minStepSize}
                              aria-invalid={homotopySaddleFromEquilibriumStepIssues.minStepSize || undefined}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  minStepSize: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-min-step-size"
                            />
                          </label>
                          <label>
                            Max step size
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.maxStepSize}
                              aria-invalid={homotopySaddleFromEquilibriumStepIssues.maxStepSize || undefined}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  maxStepSize: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-max-step-size"
                            />
                          </label>
                          <StepSizeError issues={homotopySaddleFromEquilibriumStepIssues} testId="homotopy-saddle-from-equilibrium-step-error" />
                          <div className="inspector-divider">Corrector</div>
                          <label>
                            Corrector steps
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.correctorSteps}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  correctorSteps: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-corrector-steps"
                            />
                          </label>
                          <label>
                            Corrector tolerance
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.correctorTolerance}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  correctorTolerance: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-corrector-tolerance"
                            />
                          </label>
                          <label>
                            Step tolerance
                            <input
                              type="number"
                              value={homotopySaddleFromEquilibriumDraft.stepTolerance}
                              onChange={(event) =>
                                setHomotopySaddleFromEquilibriumDraft((prev) => ({
                                  ...prev,
                                  stepTolerance: event.target.value,
                                }))
                              }
                              data-testid="homotopy-saddle-from-equilibrium-step-tolerance"
                            />
                          </label>
                          {homotopySaddleFromEquilibriumError ? (
                            <div className="field-error">{homotopySaddleFromEquilibriumError}</div>
                          ) : null}
                          <button
                            className="inspector-primary-action"
                            onClick={handleCreateHomotopySaddleFromEquilibrium}
                            disabled={
                              homotopySaddleFromEquilibriumStepIssues.invalid ||
                              runDisabled ||
                              !selectedBranchPoint ||
                              branch.branchType !== 'equilibrium' ||
                              systemDraft.type === 'map'
                            }
                            data-testid="homotopy-saddle-from-equilibrium-submit"
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
