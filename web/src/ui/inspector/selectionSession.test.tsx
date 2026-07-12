import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowFocusProvider } from './selectionSession'
import { selectionSessionReducer } from './selectionSessionState'
import { useWorkflowFocus } from './useWorkflowFocus'

describe('selectionSessionReducer', () => {
  it('opens, preserves, and closes focused workflows explicitly', () => {
    const initial = { activeWorkflow: null, advancedOpen: false } as const
    const open = selectionSessionReducer(initial, {
      type: 'open-workflow',
      workflow: 'equilibrium-solver-toggle',
    })
    expect(open).toEqual({ activeWorkflow: 'equilibrium-solver-toggle', advancedOpen: false })
    expect(selectionSessionReducer(open, { type: 'toggle-advanced' }).advancedOpen).toBe(true)
    expect(selectionSessionReducer(open, { type: 'close-workflow' })).toEqual(initial)
  })

  it('provides focus controls to a keyed inspector session', () => {
    const { result } = renderHook(() => useWorkflowFocus(), { wrapper: WorkflowFocusProvider })
    act(() => result.current?.openWorkflow('orbit-run-toggle'))
    expect(result.current?.activeWorkflow).toBe('orbit-run-toggle')
    act(() => result.current?.closeWorkflow())
    expect(result.current?.activeWorkflow).toBeNull()
  })
})
