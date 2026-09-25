import { useState, type KeyboardEvent } from 'react'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { CollocationAdaptivityFields } from './CollocationAdaptivityFields'
import {
  buildCollocationAdaptivitySettings,
  type CollocationAdaptivityDraft,
} from '../../collocationAdaptivity'
import { BranchSummary } from './BranchSummary'
import { BranchPointPanel } from './BranchPointPanel'
import { BranchSolverDetails } from './BranchSolverDetails'
import '../../branch.css'

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

export function BranchDataSections({ scope }: { scope: InspectorSelectionController }) {
  const [btHomoclinicDraft, setBtHomoclinicDraft] = useState<
    CollocationAdaptivityDraft & {
      discretization: 'collocation' | 'shooting'
      shootingIntervals: string
      integrationStepsPerSegment: string
    }
  >({
    discretization: 'collocation',
    shootingIntervals: '8',
    integrationStepsPerSegment: '64',
  })
  const {
    InspectorDisclosure,
    branch,
    branchBifurcations,
    branchSortedIndex,
    branchSortedOrder,
    handleCreateCodim2Branch,
    selectedBranchPoint,
    selectionKey,
    setBranchPoint,
    showCodim2BranchSwitch,
  } = scope
  if (!branch) return null

  // ←/→ step one point; Shift+←/→ jump to the previous/next bifurcation.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (isTextEntry(event.target)) return
    if (branchSortedOrder.length === 0) return
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const current = branchSortedIndex < 0 ? 0 : branchSortedIndex
    let target = current + direction
    if (event.shiftKey) {
      const positions = branchBifurcations
        .map((arrayIndex) => branchSortedOrder.indexOf(arrayIndex))
        .filter((position) => position >= 0)
        .sort((left, right) => left - right)
      const next =
        direction > 0
          ? positions.find((position) => position > current)
          : [...positions].reverse().find((position) => position < current)
      if (next === undefined) return
      target = next
    }
    if (target < 0 || target >= branchSortedOrder.length) return
    event.preventDefault()
    setBranchPoint(branchSortedOrder[target])
  }

  return <>
    <div className="branch-root" onKeyDown={handleKeyDown}>
      <BranchSummary scope={scope} />
      <BranchPointPanel scope={scope} />
      <BranchSolverDetails scope={scope} />
    </div>
    {showCodim2BranchSwitch && selectedBranchPoint?.codim2 ? (
      <InspectorDisclosure
        key={`${selectionKey}-codim2-branch-switch`}
        title="Branch switching"
        testId="codim2-branch-switch-toggle"
        actionOnly
      >
                                    <h4 className="inspector-subheading">Branch switching</h4>
                                    <div className="inspector-actions">
                                      {selectedBranchPoint.codim2.type === 'GeneralizedHopf' ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleCreateCodim2Branch('LimitPointCycle')}
                                          data-testid="codim2-switch-lpc"
                                        >
                                          Start LPC curve
                                        </button>
                                      ) : (
                                        <>
                                          <label>
                                            Homoclinic method
                                            <select
                                              value={btHomoclinicDraft.discretization}
                                              onChange={(event) =>
                                                setBtHomoclinicDraft((prev) => ({
                                                  ...prev,
                                                  discretization:
                                                    event.target.value === 'shooting'
                                                      ? 'shooting'
                                                      : 'collocation',
                                                }))
                                              }
                                              data-testid="codim2-switch-homoclinic-method"
                                            >
                                              <option value="collocation">
                                                Orthogonal Collocation
                                              </option>
                                              <option value="shooting">Standard Shooting</option>
                                            </select>
                                          </label>
                                          {btHomoclinicDraft.discretization === 'shooting' ? (
                                            <>
                                              <label>
                                                Shooting intervals
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={btHomoclinicDraft.shootingIntervals}
                                                  onChange={(event) =>
                                                    setBtHomoclinicDraft((prev) => ({
                                                      ...prev,
                                                      shootingIntervals: event.target.value,
                                                    }))
                                                  }
                                                  data-testid="codim2-switch-homoclinic-shooting-intervals"
                                                />
                                              </label>
                                              <label>
                                                Integration steps per segment
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={
                                                    btHomoclinicDraft.integrationStepsPerSegment
                                                  }
                                                  onChange={(event) =>
                                                    setBtHomoclinicDraft((prev) => ({
                                                      ...prev,
                                                      integrationStepsPerSegment:
                                                        event.target.value,
                                                    }))
                                                  }
                                                  data-testid="codim2-switch-homoclinic-integration-steps"
                                                />
                                              </label>
                                            </>
                                          ) : (
                                            <CollocationAdaptivityFields
                                              draft={btHomoclinicDraft}
                                              onChange={(patch) =>
                                                setBtHomoclinicDraft((prev) => ({
                                                  ...prev,
                                                  ...patch,
                                                }))
                                              }
                                              testIdPrefix="codim2-switch-homoclinic"
                                            />
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => void handleCreateCodim2Branch('Fold')}
                                            data-testid="codim2-switch-fold"
                                          >
                                            Start fold curve
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleCreateCodim2Branch('Hopf')}
                                            data-testid="codim2-switch-hopf"
                                          >
                                            Start Hopf curve
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleCreateCodim2Branch('Homoclinic', {
                                                discretization: btHomoclinicDraft.discretization,
                                                collocationAdaptivity:
                                                  btHomoclinicDraft.discretization === 'collocation'
                                                    ? buildCollocationAdaptivitySettings(
                                                        btHomoclinicDraft
                                                      ) ?? undefined
                                                    : undefined,
                                                shootingIntervals:
                                                  btHomoclinicDraft.discretization === 'shooting'
                                                    ? Number(
                                                        btHomoclinicDraft.shootingIntervals
                                                      )
                                                    : undefined,
                                                integrationStepsPerSegment:
                                                  btHomoclinicDraft.discretization === 'shooting'
                                                    ? Number(
                                                        btHomoclinicDraft.integrationStepsPerSegment
                                                      )
                                                    : undefined,
                                              })
                                            }
                                            data-testid="codim2-switch-homoclinic"
                                          >
                                            Start homoclinic (
                                            {btHomoclinicDraft.discretization})
                                          </button>
                                        </>
                                      )}
                                    </div>
      </InspectorDisclosure>
    ) : null}
  </>
}
