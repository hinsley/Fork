import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystem } from '../system/model'
import { SystemSettingsDialog } from './SystemSettingsDialog'
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
