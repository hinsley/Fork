import { useContext } from 'react'
import { WorkflowFocusContext, type WorkflowFocusValue } from './workflowFocusContext'

export function useWorkflowFocus(): WorkflowFocusValue | null {
  return useContext(WorkflowFocusContext)
}
