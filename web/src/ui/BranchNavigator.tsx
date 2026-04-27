import type { ContinuationObject, ContinuationPoint } from '../system/types'
import { formatBifurcationLabel } from '../system/continuation'
import {
  formatContinuationDisplayNumber,
  summarizeContinuationPointEigenvalues,
  type ContinuationParameterReadout,
} from './branchPointDisplay'

type BranchNavigatorContentProps = {
  branch: ContinuationObject
  branchIndices: number[]
  branchSortedOrder: number[]
  branchSortedIndex: number
  branchPointIndex: number | null
  branchPointInput: string
  branchPointError: string | null
  selectedBranchPoint: ContinuationPoint | null | undefined
  selectedBranchPointParameterReadout: ContinuationParameterReadout | null
  selectedPointStability?: string | null
  selectedPointPeriod?: number | null
  branchBifurcations: number[]
  onPointSelect: (arrayIndex: number) => void
  onPointInputChange: (value: string) => void
  onJumpToPoint: () => void
  onRenderLimitCycleHere?: () => void
}

export function BranchNavigatorContent({
  branch,
  branchIndices,
  branchSortedOrder,
  branchSortedIndex,
  branchPointIndex,
  branchPointInput,
  branchPointError,
  selectedBranchPoint,
  selectedBranchPointParameterReadout,
  selectedPointStability,
  selectedPointPeriod,
  branchBifurcations,
  onPointSelect,
  onPointInputChange,
  onJumpToPoint,
  onRenderLimitCycleHere,
}: BranchNavigatorContentProps) {
  const finitePeriod =
    typeof selectedPointPeriod === 'number' && Number.isFinite(selectedPointPeriod)
      ? selectedPointPeriod
      : null

  if (branch.data.points.length === 0) {
    return <p className="empty-state">No branch points stored yet.</p>
  }

  return (
    <>
      <div className="inspector-row inspector-row--nav">
        <button
          type="button"
          onClick={() => {
            if (branchSortedOrder.length === 0) return
            onPointSelect(branchSortedOrder[0])
          }}
          disabled={
            branchPointIndex === null ||
            branchSortedOrder.length === 0 ||
            branchSortedIndex <= 0
          }
          data-testid="branch-point-least"
        >
          Start
        </button>
        <button
          type="button"
          onClick={() => {
            if (branchSortedIndex <= 0) return
            onPointSelect(branchSortedOrder[branchSortedIndex - 1])
          }}
          disabled={branchPointIndex === null || branchSortedIndex <= 0}
          data-testid="branch-point-prev"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              branchSortedIndex < 0 ||
              branchSortedIndex >= branchSortedOrder.length - 1
            )
              return
            onPointSelect(branchSortedOrder[branchSortedIndex + 1])
          }}
          disabled={
            branchPointIndex === null ||
            branchSortedIndex < 0 ||
            branchSortedIndex >= branchSortedOrder.length - 1
          }
          data-testid="branch-point-next"
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => {
            if (branchSortedOrder.length === 0) return
            onPointSelect(branchSortedOrder[branchSortedOrder.length - 1])
          }}
          disabled={
            branchPointIndex === null ||
            branchSortedOrder.length === 0 ||
            branchSortedIndex >= branchSortedOrder.length - 1
          }
          data-testid="branch-point-greatest"
        >
          End
        </button>
      </div>

      <label>
        Point index
        <div className="inspector-row">
          <input
            type="number"
            value={branchPointInput}
            onChange={(event) => onPointInputChange(event.target.value)}
            data-testid="branch-point-input"
          />
          <button type="button" onClick={onJumpToPoint} data-testid="branch-point-jump">
            Jump
          </button>
        </div>
      </label>
      {branchPointError ? <div className="field-error">{branchPointError}</div> : null}

      {branchPointIndex !== null ? (
        <div className="inspector-data">
          <div>
            {`Selected point: ${branchIndices[branchPointIndex]} ([${branchPointIndex}] memaddr)`}
          </div>
          {selectedBranchPoint ? (
            <>
              {selectedBranchPointParameterReadout ? (
                <div>
                  {selectedBranchPointParameterReadout.label}:{' '}
                  {selectedBranchPointParameterReadout.value}
                </div>
              ) : null}
              <div>
                Stability: {selectedPointStability ?? selectedBranchPoint.stability}
              </div>
              {finitePeriod !== null ? (
                <div>
                  Period: {formatContinuationDisplayNumber(finitePeriod, 6)}
                </div>
              ) : null}
              <div>
                {summarizeContinuationPointEigenvalues(
                  selectedBranchPoint,
                  branch.branchType
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {branchPointIndex !== null && onRenderLimitCycleHere ? (
        <div className="inspector-row">
          <button
            type="button"
            onClick={onRenderLimitCycleHere}
            data-testid="branch-point-render-lc"
          >
            Render LC Here
          </button>
        </div>
      ) : null}

      {branchBifurcations.length > 0 ? (
        <div className="inspector-section">
          <h4 className="inspector-subheading">Bifurcations</h4>
          <div className="inspector-list">
            {branchBifurcations.map((idx) => {
              const logical = branchIndices[idx]
              const point = branch.data.points[idx]
              const displayIndex = Number.isFinite(logical) ? logical : idx
              const label = formatBifurcationLabel(displayIndex, point?.stability)
              return (
                <button
                  type="button"
                  key={`bif-${idx}`}
                  onClick={() => onPointSelect(idx)}
                  data-testid={`branch-bifurcation-${idx}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </>
  )
}
