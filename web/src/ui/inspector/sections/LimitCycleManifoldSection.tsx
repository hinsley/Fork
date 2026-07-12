import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import type { ManifoldCycle2DAlgorithm, ManifoldDirection, ManifoldStability } from '../../../system/types'

export function LimitCycleManifoldSection({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    handleCreateLimitCycleManifold,
    limitCycle,
    limitCycleDisplayMultipliers,
    limitCycleManifoldDraft,
    limitCycleManifoldEligibleFloquetIndexOptions,
    limitCycleManifoldError,
    runDisabled,
    selectionKey,
    setLimitCycleManifoldDraft,
    systemDraft,
  } = scope
  return <>
{limitCycle && limitCycleDisplayMultipliers.length > 0 ? (
            <InspectorDisclosure
              key={`${selectionKey}-limit-cycle-manifold`}
              title="Invariant Manifolds"
              testId="limit-cycle-manifold-toggle"
              defaultOpen={false}
            >
              <div className="inspector-section">
                {runDisabled ? (
                  <div className="field-warning">
                    Apply valid system changes before computing manifolds.
                  </div>
                ) : null}
                {systemDraft.type === 'map' ? (
                  <p className="empty-state">
                    Invariant manifolds are available for flow systems only.
                  </p>
                ) : null}
                {limitCycleDisplayMultipliers.length === 0 ? (
                  <p className="empty-state">
                    Floquet multipliers are required. Continue the cycle first to populate them.
                  </p>
                ) : (
                  <>
                    <label>
                      Branch name
                      <input
                        value={limitCycleManifoldDraft.name}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-name"
                      />
                    </label>
                    <label>
                      Kind
                      <select
                        value={limitCycleManifoldDraft.stability}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            stability: event.target.value as ManifoldStability,
                          }))
                        }
                        data-testid="limit-cycle-manifold-stability"
                      >
                        <option value="Unstable">Unstable</option>
                        <option value="Stable">Stable</option>
                      </select>
                    </label>
                    <label>
                      Direction
                      <select
                        value={limitCycleManifoldDraft.direction}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            direction: event.target.value as ManifoldDirection,
                          }))
                        }
                        data-testid="limit-cycle-manifold-direction"
                      >
                        <option value="Plus">plus</option>
                        <option value="Minus">minus</option>
                      </select>
                    </label>
                    <label>
                      Algorithm
                      <select
                        value={limitCycleManifoldDraft.algorithm}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            algorithm: event.target.value as ManifoldCycle2DAlgorithm,
                          }))
                        }
                        data-testid="limit-cycle-manifold-algorithm"
                      >
                        <option value="GeodesicRings">geodesic rings</option>
                        <option value="IsochronFibers">isochron fibers (HKO)</option>
                        <option value="SegmentedPreimageFibers">
                          segmented preimage fibers (fast)
                        </option>
                      </select>
                    </label>
                    <label>
                      Floquet index
                      <select
                        value={limitCycleManifoldDraft.floquetIndex}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            floquetIndex: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-floquet-index"
                        disabled={limitCycleManifoldEligibleFloquetIndexOptions.length === 0}
                      >
                        {limitCycleManifoldEligibleFloquetIndexOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {limitCycleManifoldEligibleFloquetIndexOptions.length === 0 ? (
                      <div className="field-warning">
                        No eligible Floquet multipliers for the selected stability.
                      </div>
                    ) : null}
                    <label>
                      Initial radius
                      <input
                        value={limitCycleManifoldDraft.initialRadius}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            initialRadius: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-initial-radius"
                      />
                    </label>
                    <label>
                      Leaf delta
                      <input
                        value={limitCycleManifoldDraft.leafDelta}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            leafDelta: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-leaf-delta"
                      />
                    </label>
                    <label>
                      Ring points
                      <input
                        value={limitCycleManifoldDraft.ringPoints}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            ringPoints: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-ring-points"
                      />
                    </label>
                    <label>
                      Integration dt
                      <input
                        value={limitCycleManifoldDraft.integrationDt}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            integrationDt: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-integration-dt"
                      />
                    </label>
                    <label>
                      Target arclength
                      <input
                        value={limitCycleManifoldDraft.targetArclength}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            targetArclength: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-target-arclength"
                      />
                    </label>
                    <label>
                      NTST
                      <input
                        value={limitCycleManifoldDraft.ntst}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            ntst: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-ntst"
                      />
                    </label>
                    <label>
                      NCOL
                      <input
                        value={limitCycleManifoldDraft.ncol}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            ncol: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-manifold-ncol"
                      />
                    </label>
                    <div className="inspector-divider">Termination caps</div>
                    <label>
                      Max steps
                      <input
                        value={limitCycleManifoldDraft.caps.maxSteps}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            caps: { ...prev.caps, maxSteps: event.target.value },
                          }))
                        }
                        data-testid="limit-cycle-manifold-caps-max-steps"
                      />
                    </label>
                    <label>
                      Max points
                      <input
                        value={limitCycleManifoldDraft.caps.maxPoints}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            caps: { ...prev.caps, maxPoints: event.target.value },
                          }))
                        }
                        data-testid="limit-cycle-manifold-caps-max-points"
                      />
                    </label>
                    <label>
                      Max rings
                      <input
                        value={limitCycleManifoldDraft.caps.maxRings}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            caps: { ...prev.caps, maxRings: event.target.value },
                          }))
                        }
                        data-testid="limit-cycle-manifold-caps-max-rings"
                      />
                    </label>
                    <label>
                      Max vertices
                      <input
                        value={limitCycleManifoldDraft.caps.maxVertices}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            caps: { ...prev.caps, maxVertices: event.target.value },
                          }))
                        }
                        data-testid="limit-cycle-manifold-caps-max-vertices"
                      />
                    </label>
                    <label>
                      Max time
                      <input
                        value={limitCycleManifoldDraft.caps.maxTime}
                        onChange={(event) =>
                          setLimitCycleManifoldDraft((prev) => ({
                            ...prev,
                            caps: { ...prev.caps, maxTime: event.target.value },
                          }))
                        }
                        data-testid="limit-cycle-manifold-caps-max-time"
                      />
                    </label>
                    {limitCycleManifoldError ? (
                      <div className="field-error">{limitCycleManifoldError}</div>
                    ) : null}
                    <button
                      onClick={handleCreateLimitCycleManifold}
                      disabled={runDisabled || systemDraft.type === 'map'}
                      data-testid="limit-cycle-manifold-submit"
                    >
                      Compute
                    </button>
                  </>
                )}
              </div>
            </InspectorDisclosure>
          ) : null}
  </>
}
