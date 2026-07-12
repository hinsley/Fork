export const WORKFLOW_IDS = [
  'orbit-run-toggle',
  'oseledets-toggle',
  'limit-cycle-toggle',
  'equilibrium-solver-toggle',
  'equilibrium-continuation-toggle',
  'equilibrium-manifold-toggle',
  'limit-cycle-data-toggle',
  'limit-cycle-manifold-toggle',
  'isocline-toggle',
  'manifold-extend-toggle',
  'branch-extend-toggle',
  'branch-continue-toggle',
  'codim1-curve-toggle',
  'isochrone-curve-toggle',
  'limit-cycle-from-hopf-toggle',
  'limit-cycle-from-pd-toggle',
  'homoclinic-from-large-cycle-toggle',
  'homoclinic-from-homoclinic-toggle',
  'homotopy-saddle-from-equilibrium-toggle',
  'homoclinic-from-homotopy-saddle-toggle',
] as const

export type WorkflowId = (typeof WORKFLOW_IDS)[number]

export type WorkflowActionEntry = {
  id: WorkflowId
  group: 'Compute' | 'Continue' | 'Manifolds' | 'Bifurcations'
  label: string
  description: string
}

export type SelectionSessionState = {
  activeWorkflow: WorkflowId | null
  advancedOpen: boolean
}

export type SelectionSessionAction =
  | { type: 'open-workflow'; workflow: WorkflowId }
  | { type: 'close-workflow' }
  | { type: 'toggle-advanced' }

export function selectionSessionReducer(
  state: SelectionSessionState,
  action: SelectionSessionAction
): SelectionSessionState {
  switch (action.type) {
    case 'open-workflow':
      return { activeWorkflow: action.workflow, advancedOpen: false }
    case 'close-workflow':
      return { activeWorkflow: null, advancedOpen: false }
    case 'toggle-advanced':
      return { ...state, advancedOpen: !state.advancedOpen }
  }
}

export function isWorkflowId(value: string | undefined): value is WorkflowId {
  return Boolean(value && (WORKFLOW_IDS as readonly string[]).includes(value))
}
