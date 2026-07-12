import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'

export function BranchManifoldExtensionWorkflow({ scope }: { scope: InspectorSelectionController }) {
  const {
    InspectorDisclosure,
    canExtendInvariantManifold,
    equilibriumManifoldExtensionDraft,
    equilibriumManifoldExtensionError,
    handleExtendEquilibriumManifold1D,
    handleExtendManifold2D,
    isSurfaceManifoldBranch,
    runDisabled,
    selectionKey,
    setEquilibriumManifoldExtensionDraft,
    systemDraft,
  } = scope
  return <>
{canExtendInvariantManifold ? (
                  <InspectorDisclosure
                    key={`${selectionKey}-manifold-extend`}
                    title="Extend Manifold"
                    testId="manifold-extend-toggle"
                    defaultOpen={false}
                  >
                    <div className="inspector-section">
                      {runDisabled ? (
                        <div className="field-warning">
                          Apply valid system changes before extending.
                        </div>
                      ) : null}
                      <label>
                        Additional arclength
                        <input
                          type="number"
                          value={equilibriumManifoldExtensionDraft.targetArclength}
                          onChange={(event) =>
                            setEquilibriumManifoldExtensionDraft((prev) => ({
                              ...prev,
                              targetArclength: event.target.value,
                            }))
                          }
                          data-testid="manifold-extend-arclength"
                        />
                      </label>
                      {systemDraft.type === 'flow' ? (
                        <label>
                          Integration dt
                          <input
                            type="number"
                            value={equilibriumManifoldExtensionDraft.integrationDt}
                            onChange={(event) =>
                              setEquilibriumManifoldExtensionDraft((prev) => ({
                                ...prev,
                                integrationDt: event.target.value,
                              }))
                            }
                            data-testid="manifold-extend-integration-dt"
                          />
                        </label>
                      ) : null}
                      <label>
                        Max integration steps
                        <input
                          type="number"
                          value={equilibriumManifoldExtensionDraft.caps.maxSteps}
                          onChange={(event) =>
                            setEquilibriumManifoldExtensionDraft((prev) => ({
                              ...prev,
                              caps: { ...prev.caps, maxSteps: event.target.value },
                            }))
                          }
                          data-testid="manifold-extend-max-steps"
                        />
                      </label>
                      {isSurfaceManifoldBranch ? (
                        <>
                          <label>
                            Max rings to add
                            <input
                              type="number"
                              value={equilibriumManifoldExtensionDraft.caps.maxRings}
                              onChange={(event) =>
                                setEquilibriumManifoldExtensionDraft((prev) => ({
                                  ...prev,
                                  caps: { ...prev.caps, maxRings: event.target.value },
                                }))
                              }
                              data-testid="manifold-extend-max-rings"
                            />
                          </label>
                          <label>
                            Max vertices to add
                            <input
                              type="number"
                              value={equilibriumManifoldExtensionDraft.caps.maxVertices}
                              onChange={(event) =>
                                setEquilibriumManifoldExtensionDraft((prev) => ({
                                  ...prev,
                                  caps: { ...prev.caps, maxVertices: event.target.value },
                                }))
                              }
                              data-testid="manifold-extend-max-vertices"
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          Max points to add
                          <input
                            type="number"
                            value={equilibriumManifoldExtensionDraft.caps.maxPoints}
                            onChange={(event) =>
                              setEquilibriumManifoldExtensionDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxPoints: event.target.value },
                              }))
                            }
                            data-testid="manifold-extend-max-points"
                          />
                        </label>
                      )}
                      {systemDraft.type === 'flow' ? (
                        <label>
                          Max integration time
                          <input
                            type="number"
                            value={equilibriumManifoldExtensionDraft.caps.maxTime}
                            onChange={(event) =>
                              setEquilibriumManifoldExtensionDraft((prev) => ({
                                ...prev,
                                caps: { ...prev.caps, maxTime: event.target.value },
                              }))
                            }
                            data-testid="manifold-extend-max-time"
                          />
                        </label>
                      ) : (
                        <label>
                          Max map iterations
                          <input
                            type="number"
                            value={equilibriumManifoldExtensionDraft.caps.maxIterations}
                            onChange={(event) =>
                              setEquilibriumManifoldExtensionDraft((prev) => ({
                                ...prev,
                                caps: {
                                  ...prev.caps,
                                  maxIterations: event.target.value,
                                },
                              }))
                            }
                            data-testid="manifold-extend-max-iterations"
                          />
                        </label>
                      )}
                      {equilibriumManifoldExtensionError ? (
                        <div className="field-error">
                          {equilibriumManifoldExtensionError}
                        </div>
                      ) : null}
                      <button
                        onClick={
                          isSurfaceManifoldBranch
                            ? handleExtendManifold2D
                            : handleExtendEquilibriumManifold1D
                        }
                        disabled={runDisabled}
                        data-testid="manifold-extend-submit"
                      >
                        Extend Manifold
                      </button>
                    </div>
                  </InspectorDisclosure>
                ) : null}
  </>
}
