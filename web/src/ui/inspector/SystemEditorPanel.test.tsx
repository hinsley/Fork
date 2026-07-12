import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createSystem } from '../../system/model'
import { SystemEditorPanel } from './SystemEditorPanel'
import type { SystemEditorActions } from './types'

function renderEditor() {
  const system = createSystem({ name: 'Editor_Test' })
  const actions: SystemEditorActions = {
    updateSystem: vi.fn().mockResolvedValue(undefined),
    validateSystem: vi.fn().mockResolvedValue({ ok: true, equationErrors: [] }),
  }
  render(<SystemEditorPanel systemId={system.id} config={system.config} actions={actions} />)
  return { system, actions }
}

describe('SystemEditorPanel', () => {
  it('keeps major editor sections independently open', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.getByTestId('system-toggle-model')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('system-toggle-variables')).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByTestId('system-toggle-model'))
    expect(screen.getByTestId('system-toggle-model')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('system-toggle-variables')).toHaveAttribute('aria-expanded', 'true')
  })

  it('only renders a period input when periodic wrapping is enabled', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.queryByTestId('system-periodic-period-0')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('system-periodic-enabled-0'))
    expect(screen.getByTestId('system-periodic-period-0')).toBeVisible()
  })

  it('validates and applies a changed configuration', async () => {
    const user = userEvent.setup()
    const { actions } = renderEditor()

    await user.clear(screen.getByTestId('system-name'))
    await user.type(screen.getByTestId('system-name'), 'Updated_System')
    await user.click(screen.getByTestId('system-apply'))

    await waitFor(() => expect(actions.updateSystem).toHaveBeenCalledOnce())
    expect(actions.updateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated_System' })
    )
  })
})
