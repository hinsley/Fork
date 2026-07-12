export const WORKFLOW_IDS = [
  'frozen-variables-toggle',
  'parameters-toggle',
  'appearance-toggle',
  'orbit-run-toggle',
  'orbit-data-toggle',
  'oseledets-toggle',
  'limit-cycle-toggle',
  'equilibrium-solver-toggle',
  'equilibrium-data-toggle',
  'equilibrium-continuation-toggle',
  'equilibrium-manifold-toggle',
  'limit-cycle-data-toggle',
  'limit-cycle-manifold-toggle',
  'isocline-toggle',
  'branch-summary-toggle',
  'branch-points-toggle',
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
  group: 'Configure' | 'Inspect' | 'Compute' | 'Continuation' | 'Manifolds' | 'Bifurcations'
  label: string
  description: string
  tag?: string
}

export type SelectionSessionState = {
  activeWorkflow: WorkflowId | null
}

export type SelectionSessionAction =
  | { type: 'open-workflow'; workflow: WorkflowId }
  | { type: 'close-workflow' }

export function selectionSessionReducer(
  _state: SelectionSessionState,
  action: SelectionSessionAction
): SelectionSessionState {
  switch (action.type) {
    case 'open-workflow':
      return { activeWorkflow: action.workflow }
    case 'close-workflow':
      return { activeWorkflow: null }
  }
}

export function isWorkflowId(value: string | undefined): value is WorkflowId {
  return Boolean(value && (WORKFLOW_IDS as readonly string[]).includes(value))
}
