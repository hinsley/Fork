export const WORKFLOW_IDS = [
  'frozen-variables-toggle',
  'parameters-toggle',
  'appearance-toggle',
  'orbit-run-toggle',
  'orbit-data-toggle',
  'oseledets-toggle',
  'limit-cycle-toggle',
  'heteroclinic-from-orbit-toggle',
  'equilibrium-solver-toggle',
  'equilibrium-data-toggle',
  'equilibrium-continuation-toggle',
  'equilibrium-manifold-toggle',
  'forced-response-solver-toggle',
  'forced-response-data-toggle',
  'forced-response-continuation-toggle',
  'limit-cycle-data-toggle',
  'limit-cycle-manifold-toggle',
  'isocline-toggle',
  'branch-summary-toggle',
  'branch-points-toggle',
  'normal-form-workflow-toggle',
  'manifold-extend-toggle',
  'branch-extend-toggle',
  'branch-continue-toggle',
  'codim1-curve-toggle',
  'isoperiodic-curve-toggle',
  'limit-cycle-codim1-curve-toggle',
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

export type WorkflowNavigationDirection = 'forward' | 'backward'
export type WorkflowNavigationPhase = 'idle' | 'exiting' | 'entering'

export type SelectionSessionState = {
  activeWorkflow: WorkflowId | null
  navigationDirection: WorkflowNavigationDirection | null
  navigationPhase: WorkflowNavigationPhase
  targetWorkflow: WorkflowId | null
}

export type SelectionSessionAction =
  | {
      type: 'start-navigation'
      direction: WorkflowNavigationDirection
      targetWorkflow: WorkflowId | null
    }
  | { type: 'commit-navigation' }
  | { type: 'finish-navigation' }
  | {
      type: 'navigate-immediately'
      targetWorkflow: WorkflowId | null
    }

export function selectionSessionReducer(
  state: SelectionSessionState,
  action: SelectionSessionAction
): SelectionSessionState {
  switch (action.type) {
    case 'start-navigation':
      return {
        ...state,
        navigationDirection: action.direction,
        navigationPhase: 'exiting',
        targetWorkflow: action.targetWorkflow,
      }
    case 'commit-navigation':
      if (state.navigationPhase !== 'exiting') return state
      return {
        ...state,
        activeWorkflow: state.targetWorkflow,
        navigationPhase: 'entering',
      }
    case 'finish-navigation':
      return {
        ...state,
        navigationDirection: null,
        navigationPhase: 'idle',
        targetWorkflow: state.activeWorkflow,
      }
    case 'navigate-immediately':
      return {
        activeWorkflow: action.targetWorkflow,
        navigationDirection: null,
        navigationPhase: 'idle',
        targetWorkflow: action.targetWorkflow,
      }
  }
}

export function isWorkflowId(value: string | undefined): value is WorkflowId {
  return Boolean(value && (WORKFLOW_IDS as readonly string[]).includes(value))
}
