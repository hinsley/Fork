import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SystemDialog } from './SystemDialog'
import { confirmDelete } from './confirmDelete'

vi.mock('./confirmDelete', () => ({
  confirmDelete: vi.fn(),
}))

describe('SystemDialog', () => {
  it('calls dialog actions for create, open, export, delete, and import', async () => {
    const user = userEvent.setup()
    const onOpenSystem = vi.fn()
    const onExportSystem = vi.fn()
    const onCreateSystem = vi.fn()
    const onDeleteSystem = vi.fn()
    const onImportSystem = vi.fn()
    const onClose = vi.fn()

    vi.mocked(confirmDelete).mockReturnValue(true)

    render(
      <SystemDialog
        open
        systems={[
          {
            id: 'sys-1',
            name: 'System A',
            updatedAt: '2024-01-01T00:00:00Z',
            type: 'flow',
          },
        ]}
        onOpenSystem={onOpenSystem}
        onExportSystem={onExportSystem}
        onCreateSystem={onCreateSystem}
        onDeleteSystem={onDeleteSystem}
        onImportSystem={onImportSystem}
        onClose={onClose}
      />
    )

    const nameInput = screen.getByTestId('system-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'My System')
    await user.click(screen.getByTestId('create-system'))
    expect(onCreateSystem).toHaveBeenCalledWith('My System')

    await user.click(screen.getByRole('button', { name: 'System A' }))
    expect(onOpenSystem).toHaveBeenCalledWith('sys-1')

    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(onExportSystem).toHaveBeenCalledWith('sys-1')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirmDelete).toHaveBeenCalledWith({ name: 'System A', kind: 'System' })
    expect(onDeleteSystem).toHaveBeenCalledWith('sys-1')

    const file = new File(['{}'], 'system.json', { type: 'application/json' })
    const input = screen.getByTestId('import-system')
    await user.upload(input, file)
    expect(onImportSystem).toHaveBeenCalledWith(file)
  })

  it('renders nothing when closed', () => {
    render(
      <SystemDialog
        open={false}
        systems={[]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateSystem={vi.fn()}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
