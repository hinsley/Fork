import type { ReactNode } from 'react'
import { Icon } from './Icon'

type BranchNavigatorContentProps = {
  branchSortedOrder: number[]
  branchSortedIndex: number
  branchPointIndex: number | null
  branchPointInput: string
  branchPointError: string | null
  /** Logical index range shown after the input, e.g. `0…40`. */
  indexRange?: string
  onPointSelect: (arrayIndex: number) => void
  onPointInputChange: (value: string) => void
  onJumpToPoint: () => void
  /** Trailing controls on the stepper row (e.g. Copy). */
  trailing?: ReactNode
  /** Chips rendered on their own line under the stepper. */
  children?: ReactNode
}

/** Point stepper: first / previous / index input / next / last. */
export function BranchNavigatorContent({
  branchSortedOrder,
  branchSortedIndex,
  branchPointIndex,
  branchPointInput,
  branchPointError,
  indexRange,
  onPointSelect,
  onPointInputChange,
  onJumpToPoint,
  trailing,
  children,
}: BranchNavigatorContentProps) {
  const count = branchSortedOrder.length
  const noSelection = branchPointIndex === null || count === 0
  const atStart = noSelection || branchSortedIndex <= 0
  const atEnd = noSelection || branchSortedIndex < 0 || branchSortedIndex >= count - 1
  return (
    <div className="branch-stepper">
      <div className="branch-stepper__controls">
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => {
            if (count === 0) return
            onPointSelect(branchSortedOrder[0])
          }}
          disabled={atStart}
          title="First point"
          aria-label="First point"
          data-testid="branch-point-least"
        >
          <Icon name="first" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => {
            if (branchSortedIndex <= 0) return
            onPointSelect(branchSortedOrder[branchSortedIndex - 1])
          }}
          disabled={atStart}
          title="Previous point (←)"
          aria-label="Previous point"
          data-testid="branch-point-prev"
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <input
          type="number"
          className="branch-stepper__input"
          value={branchPointInput}
          onChange={(event) => onPointInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onJumpToPoint()
            }
          }}
          aria-label="Point index"
          title="Point index (Enter to jump)"
          aria-invalid={branchPointError ? true : undefined}
          data-testid="branch-point-input"
        />
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={onJumpToPoint}
          title="Jump to index"
          aria-label="Jump to index"
          data-testid="branch-point-jump"
        >
          <Icon name="enter" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => {
            if (atEnd) return
            onPointSelect(branchSortedOrder[branchSortedIndex + 1])
          }}
          disabled={atEnd}
          title="Next point (→)"
          aria-label="Next point"
          data-testid="branch-point-next"
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => {
            if (count === 0) return
            onPointSelect(branchSortedOrder[count - 1])
          }}
          disabled={atEnd}
          title="Last point"
          aria-label="Last point"
          data-testid="branch-point-greatest"
        >
          <Icon name="last" size={14} />
        </button>
        {indexRange ? <span className="branch-stepper__range faint num">{indexRange}</span> : null}
        {trailing ? <span className="branch-stepper__trailing">{trailing}</span> : null}
      </div>
      {children ? <div className="branch-stepper__chips">{children}</div> : null}
      {branchPointError ? (
        <div className="field-error branch-stepper__error">{branchPointError}</div>
      ) : null}
    </div>
  )
}
