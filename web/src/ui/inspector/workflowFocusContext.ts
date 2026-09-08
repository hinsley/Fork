import { createContext } from 'react'
import type { SelectionSessionState, WorkflowActionEntry, WorkflowId } from './selectionSessionState'

export type WorkflowFocusValue = SelectionSessionState & {
  openWorkflow: (workflow: WorkflowId) => void
  closeWorkflow: () => void
  collapsedActionGroups: Partial<Record<WorkflowActionEntry['group'], boolean>>
  toggleActionGroup: (group: WorkflowActionEntry['group']) => void
}

export const WorkflowFocusContext = createContext<WorkflowFocusValue | null>(null)
