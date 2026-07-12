import { useMemo, useReducer, type ReactNode } from 'react'
import {
  selectionSessionReducer,
  type WorkflowActionEntry,
} from './selectionSessionState'
import { WorkflowFocusContext, type WorkflowFocusValue } from './workflowFocusContext'
import { useWorkflowFocus } from './useWorkflowFocus'

export function WorkflowFocusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(selectionSessionReducer, {
    activeWorkflow: null,
    advancedOpen: false,
  })
  const value = useMemo<WorkflowFocusValue>(
    () => ({
      ...state,
      openWorkflow: (workflow) => dispatch({ type: 'open-workflow', workflow }),
      closeWorkflow: () => dispatch({ type: 'close-workflow' }),
      toggleAdvanced: () => dispatch({ type: 'toggle-advanced' }),
    }),
    [state]
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

export function WorkflowActionList({ entries }: { entries: WorkflowActionEntry[] }) {
  const focus = useWorkflowFocus()
  if (!focus || focus.activeWorkflow || entries.length === 0) return null

  const groups = [
    'Configure',
    'Inspect',
    'Compute',
    'Continuation',
    'Manifolds',
    'Bifurcations',
  ] as const
  return (
    <section className="inspector-actions" data-testid="inspector-actions">
      {groups.map((group) => {
        const groupEntries = entries.filter((entry) => entry.group === group)
        if (groupEntries.length === 0) return null
        return (
          <div className="inspector-actions__group" key={group}>
            <h4>{group}</h4>
            {groupEntries.map((entry) => (
              <button
                type="button"
                className="inspector-action-row"
                onClick={() => focus.openWorkflow(entry.id)}
                data-testid={`action-${entry.id}`}
                key={entry.id}
              >
                <span>
                  <strong className="inspector-action-row__title">
                    <span>{entry.label}</span>
                    {entry.tag ? <span className="tree-node__tag">{entry.tag}</span> : null}
                  </strong>
                  <small>{entry.description}</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        )
      })}
    </section>
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
      <button type="button" onClick={focus.closeWorkflow} data-testid="inspector-workflow-back">
        ← Back
      </button>
      <div>
        <span>{entry?.group ?? 'Action'}</span>
        <strong>{entry?.label ?? 'Workflow'}</strong>
      </div>
      {entry?.group !== 'Configure' && entry?.group !== 'Inspect' ? (
        <button
          type="button"
          aria-expanded={focus.advancedOpen}
          onClick={focus.toggleAdvanced}
          data-testid="inspector-workflow-advanced"
        >
          Advanced
        </button>
      ) : null}
    </div>
  )
}
