import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystem } from '../system/model'
import { DISCARD_SYSTEM_CHANGES_MESSAGE, SystemSettingsDialog } from './SystemSettingsDialog'
import type { SystemEditorActions } from './inspector/types'

let capturedProps: Record<string, unknown> | null = null

vi.mock('./inspector/SystemEditorPanel', () => ({
  SystemEditorPanel: (props: Record<string, unknown>) => {
    capturedProps = props
    return <div data-testid="system-editor-panel" />
  },
}))

function makeActions(): SystemEditorActions {
  return {
    updateSystem: vi.fn().mockResolvedValue(undefined),
    validateSystem: vi.fn().mockResolvedValue({ ok: true, equationErrors: [] }),
  }
}

describe('SystemSettingsDialog', () => {
  beforeEach(() => {
    capturedProps = null
  })

  it('renders the dedicated editor and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const system = createSystem({ name: 'Test_System' })
    const actions = makeActions()

    render(
      <SystemSettingsDialog
        open
        system={system}
        onClose={onClose}
        actions={actions}
      />
    )

    expect(screen.getByTestId('system-settings-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('system-editor-panel')).toBeInTheDocument()
    expect(capturedProps?.systemId).toBe(system.id)
    expect(capturedProps?.config).toBe(system.config)
    expect(capturedProps?.actions).toBe(actions)

    await user.click(screen.getByTestId('close-system-settings'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Esc and backdrop click, confirming before discarding changes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <SystemSettingsDialog
        open
        system={createSystem({ name: 'Test_System' })}
        onClose={onClose}
        actions={makeActions()}
      />
    )
    const dialog = screen.getByTestId('system-settings-dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(confirm).not.toHaveBeenCalled()

    const onDirtyChange = capturedProps?.onDirtyChange as (dirty: boolean) => void
    act(() => onDirtyChange(true))
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('close-system-settings'))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenCalledWith(DISCARD_SYSTEM_CHANGES_MESSAGE)
    expect(onClose).toHaveBeenCalledTimes(2)

    confirm.mockReturnValue(true)
    await user.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(3)
    confirm.mockRestore()
  })

  it('returns null without an open system', () => {
    const actions = makeActions()
    const { rerender } = render(
      <SystemSettingsDialog open system={null} onClose={vi.fn()} actions={actions} />
    )
    expect(screen.queryByTestId('system-settings-dialog')).not.toBeInTheDocument()

    rerender(
      <SystemSettingsDialog
        open={false}
        system={createSystem({ name: 'Test_System' })}
        onClose={vi.fn()}
        actions={actions}
      />
    )
    expect(screen.queryByTestId('system-settings-dialog')).not.toBeInTheDocument()
  })
})
