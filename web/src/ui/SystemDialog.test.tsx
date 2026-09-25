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
    const onCreateEmbed = vi.fn()
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
        onCreateEmbed={onCreateEmbed}
        onCreateSystem={onCreateSystem}
        onDeleteSystem={onDeleteSystem}
        onImportSystem={onImportSystem}
        onClose={onClose}
      />
    )

    const nameInput = screen.getByTestId('system-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'My_System')
    await user.click(screen.getByTestId('create-system'))
    expect(onCreateSystem).toHaveBeenCalledWith('My_System')

    await user.click(screen.getByRole('button', { name: 'System A' }))
    expect(onOpenSystem).toHaveBeenCalledWith('sys-1')

    await user.click(screen.getByRole('button', { name: 'Download ZIP archive' }))
    expect(onExportSystem).toHaveBeenCalledWith('sys-1')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirmDelete).toHaveBeenCalledWith({ name: 'System A', kind: 'System' })
    expect(onDeleteSystem).toHaveBeenCalledWith('sys-1')

    const file = new File(['PK\x03\x04'], 'system.zip', { type: 'application/zip' })
    const input = screen.getByTestId('import-system')
    await user.upload(input, file)
    expect(onImportSystem).toHaveBeenCalledWith(file)
  })

  it('opens the embed creator from the row action', async () => {
    const user = userEvent.setup()
    const onCreateEmbed = vi.fn()

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
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={onCreateEmbed}
        onCreateSystem={vi.fn()}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Create embed' }))

    expect(onCreateEmbed).toHaveBeenCalledWith('sys-1')
  })

  it('shows type, dimension, parameter names, and relative update time per row', () => {
    const updatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    render(
      <SystemDialog
        open
        systems={[
          {
            id: 'sys-1',
            name: 'Lorenz',
            updatedAt,
            type: 'flow',
            varNames: ['x', 'y', 'z'],
            paramNames: ['sigma', 'rho', 'beta'],
          },
          {
            id: 'legacy',
            name: 'Legacy',
            updatedAt: 'not a date',
            type: 'map',
          },
        ]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={vi.fn()}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const lorenz = screen.getByRole('button', { name: 'Lorenz' })
    expect(lorenz).toHaveTextContent('Flow')
    expect(lorenz).toHaveTextContent('3D')
    expect(lorenz).toHaveTextContent('sigma rho beta')
    expect(lorenz).toHaveTextContent('3 h ago')
    const legacy = screen.getByRole('button', { name: 'Legacy' })
    expect(legacy).toHaveTextContent('Map')
    expect(legacy).toHaveTextContent('—')
    expect(legacy).not.toHaveTextContent('undefined')
  })

  it('shows empty state and uses the default name for create', async () => {
    const user = userEvent.setup()
    const onCreateSystem = vi.fn()

    render(
      <SystemDialog
        open
        systems={[]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={onCreateSystem}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    await user.click(screen.getByTestId('create-system'))
    expect(onCreateSystem).toHaveBeenCalledWith('NewSystem')
  })

  it('rejects invalid system names', async () => {
    const user = userEvent.setup()
    const onCreateSystem = vi.fn()

    render(
      <SystemDialog
        open
        systems={[]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={onCreateSystem}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const nameInput = screen.getByTestId('system-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'Bad/Name')
    await user.click(screen.getByTestId('create-system'))

    expect(onCreateSystem).not.toHaveBeenCalled()
    expect(
      screen.getByText('System name cannot contain path separators.')
    ).toBeInTheDocument()

    await user.clear(nameInput)
    await user.type(nameInput, '  My System  ')
    await user.click(screen.getByTestId('create-system'))

    expect(onCreateSystem).toHaveBeenCalledWith('My System')
  })

  it('does not delete when confirmation is canceled', async () => {
    const user = userEvent.setup()
    const onDeleteSystem = vi.fn()
    vi.mocked(confirmDelete).mockReturnValue(false)

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
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={vi.fn()}
        onDeleteSystem={onDeleteSystem}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirmDelete).toHaveBeenCalledWith({ name: 'System A', kind: 'System' })
    expect(onDeleteSystem).not.toHaveBeenCalled()
  })

  it('renders type labels and closes the dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <SystemDialog
        open
        systems={[
          {
            id: 'sys-1',
            name: 'Flow Sys',
            updatedAt: '2024-01-01T00:00:00Z',
            type: 'flow',
          },
          {
            id: 'sys-2',
            name: 'Map Sys',
            updatedAt: '2024-01-02T00:00:00Z',
            type: 'map',
          },
        ]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={vi.fn()}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={onClose}
      />
    )

    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(screen.getByText('Map')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    render(
      <SystemDialog
        open={false}
        systems={[]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={vi.fn()}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects duplicate names inline and suffixes the default name', async () => {
    const user = userEvent.setup()
    const onCreateSystem = vi.fn()
    render(
      <SystemDialog
        open
        systems={[
          { id: 'sys-1', name: 'Lorenz', updatedAt: '2024-01-01T00:00:00Z', type: 'flow' },
          { id: 'sys-2', name: 'NewSystem', updatedAt: '2024-01-01T00:00:00Z', type: 'flow' },
        ]}
        onOpenSystem={vi.fn()}
        onExportSystem={vi.fn()}
        onCreateEmbed={vi.fn()}
        onCreateSystem={onCreateSystem}
        onDeleteSystem={vi.fn()}
        onImportSystem={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const nameInput = screen.getByTestId('system-name-input')
    expect(nameInput).toHaveValue('NewSystem_2')

    await user.clear(nameInput)
    await user.type(nameInput, 'lorenz')
    await user.click(screen.getByTestId('create-system'))
    expect(screen.getByRole('alert')).toHaveTextContent('"Lorenz" already exists.')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(onCreateSystem).not.toHaveBeenCalled()

    await user.type(nameInput, '_2')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByTestId('create-system'))
    expect(onCreateSystem).toHaveBeenCalledWith('lorenz_2')
  })

  it('closes on Esc and on a backdrop click, restoring focus', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const props = {
      systems: [{ id: 'sys-1', name: 'Lorenz', updatedAt: '2024-01-01T00:00:00Z', type: 'flow' as const }],
      onOpenSystem: vi.fn(),
      onExportSystem: vi.fn(),
      onCreateEmbed: vi.fn(),
      onCreateSystem: vi.fn(),
      onDeleteSystem: vi.fn(),
      onImportSystem: vi.fn(),
      onClose,
    }
    const { rerender } = render(<SystemDialog open {...props} />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'Lorenz' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    rerender(<SystemDialog open={false} {...props} />)
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
