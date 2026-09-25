import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { isDeterministicMode } from '../../utils/determinism'
import {
  isWorkflowId,
  selectionSessionReducer,
  type WorkflowActionEntry,
  type WorkflowId,
} from './selectionSessionState'
import { WorkflowFocusContext, type WorkflowFocusValue } from './workflowFocusContext'
import { useWorkflowFocus } from './useWorkflowFocus'

const NAVIGATION_EXIT_MS = 150
const NAVIGATION_ENTER_MS = 200

function shouldAnimateNavigation() {
  if (isDeterministicMode() || typeof window === 'undefined') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function WorkflowFocusProvider({
  children,
  onActiveWorkflowChange,
}: {
  children: ReactNode
  onActiveWorkflowChange?: () => void
}) {
  const [state, dispatch] = useReducer(selectionSessionReducer, {
    activeWorkflow: null,
    navigationDirection: null,
    navigationPhase: 'idle',
    targetWorkflow: null,
  })
  const navigate = useCallback(
    (targetWorkflow: WorkflowId | null) => {
      if (state.navigationPhase !== 'idle') {
        // Never drop a click that lands mid-animation: settle on the new target at once.
        if (targetWorkflow !== state.targetWorkflow) {
          dispatch({ type: 'navigate-immediately', targetWorkflow })
        }
        return
      }
      if (targetWorkflow === state.activeWorkflow) return
      if (!shouldAnimateNavigation()) {
        dispatch({ type: 'navigate-immediately', targetWorkflow })
        return
      }
      dispatch({
        type: 'start-navigation',
        direction: targetWorkflow ? 'forward' : 'backward',
        targetWorkflow,
      })
    },
    [state.activeWorkflow, state.navigationPhase, state.targetWorkflow]
  )
  useEffect(() => {
    if (state.navigationPhase === 'idle') return
    const timeout = window.setTimeout(
      () =>
        dispatch({
          type:
            state.navigationPhase === 'exiting'
              ? 'commit-navigation'
              : 'finish-navigation',
        }),
      state.navigationPhase === 'exiting' ? NAVIGATION_EXIT_MS : NAVIGATION_ENTER_MS
    )
    return () => window.clearTimeout(timeout)
  }, [state.navigationPhase])
  useEffect(() => {
    onActiveWorkflowChange?.()
  }, [onActiveWorkflowChange, state.activeWorkflow])
  const value = useMemo<WorkflowFocusValue>(
    () => ({
      ...state,
      openWorkflow: (workflow) => navigate(workflow),
      closeWorkflow: () => navigate(null),
    }),
    [navigate, state]
  )
  return <WorkflowFocusContext.Provider value={value}>{children}</WorkflowFocusContext.Provider>
}

export function InspectorSubDisclosure({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <details className="inspector-disclosure inspector-subdisclosure">
      <summary className="inspector-disclosure__summary" data-testid={testId}>
        {title}
      </summary>
      <div className="inspector-disclosure__content">{children}</div>
    </details>
  )
}

export function WorkflowFocusToolbar({
  entries,
}: {
  entries: WorkflowActionEntry[]
}) {
  const focus = useWorkflowFocus()
  if (!focus?.activeWorkflow) return null
  const entry = entries.find((candidate) => candidate.id === focus.activeWorkflow)
  return (
    <div className="inspector-workflow-toolbar" data-testid="inspector-workflow-focus">
      <button
        type="button"
        className="icon-btn"
        onClick={focus.closeWorkflow}
        aria-label="Back"
        title="Back"
        data-testid="inspector-workflow-back"
      >
        <span aria-hidden="true">←</span>
      </button>
      <strong className="truncate">{entry?.title ?? entry?.label ?? 'Workflow'}</strong>
    </div>
  )
}

export function InspectorDisclosure({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  testId,
  actionOnly = false,
}: {
  title: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (nextOpen: boolean) => void
  children: ReactNode
  testId?: string
  actionOnly?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const workflowFocus = useWorkflowFocus()
  const workflowId = isWorkflowId(testId) ? testId : null
  const workflowFocused = Boolean(
    workflowId && workflowFocus?.activeWorkflow === workflowId
  )
  const resolvedOpen = workflowFocus?.activeWorkflow
    ? workflowFocused
    : typeof open === 'boolean'
      ? open
      : uncontrolledOpen

  return (
    <details
      className={`inspector-disclosure${actionOnly ? ' inspector-disclosure--action-only' : ''}`}
      open={resolvedOpen}
      data-workflow-id={workflowId ?? undefined}
      data-workflow-active={workflowFocused ? 'true' : undefined}
      onToggle={(event) => {
        const nextOpen = (event.currentTarget as HTMLDetailsElement).open
        if (workflowFocus?.activeWorkflow) return
        if (typeof open !== 'boolean') {
          setUncontrolledOpen(nextOpen)
        }
        onOpenChange?.(nextOpen)
      }}
    >
      <summary className="inspector-disclosure__summary" data-testid={testId}>
        {title}
      </summary>
      <div className="inspector-disclosure__content">{children}</div>
    </details>
  )
}
