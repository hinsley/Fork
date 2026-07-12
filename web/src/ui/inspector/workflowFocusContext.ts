import { createContext } from 'react'
import type { SelectionSessionState, WorkflowId } from './selectionSessionState'

export type WorkflowFocusValue = SelectionSessionState & {
  openWorkflow: (workflow: WorkflowId) => void
  closeWorkflow: () => void
}

export const WorkflowFocusContext = createContext<WorkflowFocusValue | null>(null)
