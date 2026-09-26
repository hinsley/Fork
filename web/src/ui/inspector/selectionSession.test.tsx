import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowFocusProvider } from './selectionSession'
import { selectionSessionReducer } from './selectionSessionState'
import { useWorkflowFocus } from './useWorkflowFocus'

describe('selectionSessionReducer', () => {
  it('moves forward and backward through directional navigation phases', () => {
    const initial = {
      activeWorkflow: null,
      navigationDirection: null,
      navigationPhase: 'idle',
      targetWorkflow: null,
    } as const
    const exitingForward = selectionSessionReducer(initial, {
      type: 'start-navigation',
      direction: 'forward',
      targetWorkflow: 'equilibrium-solver-toggle',
    })
    expect(exitingForward).toMatchObject({
      activeWorkflow: null,
      navigationDirection: 'forward',
      navigationPhase: 'exiting',
    })
    const enteringForward = selectionSessionReducer(exitingForward, {
      type: 'commit-navigation',
    })
    expect(enteringForward).toMatchObject({
      activeWorkflow: 'equilibrium-solver-toggle',
      navigationDirection: 'forward',
      navigationPhase: 'entering',
    })
    const open = selectionSessionReducer(enteringForward, { type: 'finish-navigation' })
    expect(open).toMatchObject({
      activeWorkflow: 'equilibrium-solver-toggle',
      navigationDirection: null,
      navigationPhase: 'idle',
    })

    const exitingBackward = selectionSessionReducer(open, {
      type: 'start-navigation',
      direction: 'backward',
      targetWorkflow: null,
    })
    const enteringBackward = selectionSessionReducer(exitingBackward, {
      type: 'commit-navigation',
    })
    expect(enteringBackward).toMatchObject({
      activeWorkflow: null,
      navigationDirection: 'backward',
      navigationPhase: 'entering',
    })
    expect(
      selectionSessionReducer(enteringBackward, { type: 'finish-navigation' })
    ).toEqual(initial)
  })

  it('provides focus controls to a keyed inspector session', () => {
    const { result } = renderHook(() => useWorkflowFocus(), { wrapper: WorkflowFocusProvider })
    act(() => result.current?.openWorkflow('orbit-run-toggle'))
    expect(result.current?.activeWorkflow).toBe('orbit-run-toggle')
    act(() => result.current?.closeWorkflow())
    expect(result.current?.activeWorkflow).toBeNull()
  })
})
