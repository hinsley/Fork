import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { MockForkCoreClient } from './compute/mockClient'
import { AppProvider } from './state/appState'
import { addScene, createSystem } from './system/model'
import { MemorySystemStore } from './system/store'
import type { System } from './system/types'

async function renderApp(options: { system?: System | null; error?: string | null } = {}) {
  const store = new MemorySystemStore()
  if (options.system) await store.save(options.system)
  const systems = await store.list()
  render(
    <AppProvider
      store={store}
      client={new MockForkCoreClient()}
      initialSystem={options.system ?? null}
      initialSystems={systems}
      initialError={options.error ?? null}
    >
      <App />
    </AppProvider>
  )
  return store
}

describe('App shell', () => {
  it('shows the system chip in the toolbar and opens system settings from it', async () => {
    const system = createSystem({ name: 'Chip_Test' })
    await renderApp({ system })

    const chip = screen.getByTestId('open-system-settings')
    expect(chip).toHaveTextContent('Flow · 2D · rk4')
    expect(within(screen.getByTestId('toolbar')).getByTestId('open-system-settings')).toBe(chip)
    fireEvent.click(chip)
    expect(await screen.findByTestId('close-system-settings')).toBeInTheDocument()
  })

  it('renders errors as a dismissible alert toast', async () => {
    await renderApp({ error: 'Import failed: not a Fork archive' })

    const toast = screen.getByRole('alert')
    expect(toast).toHaveTextContent('Import failed: not a Fork archive')
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('collapses side panels from the toolbar and with bracket shortcuts', async () => {
    const system = createSystem({ name: 'Panels_Test' })
    await renderApp({ system })

    const objects = screen.getByTestId('objects-panel').parentElement as HTMLElement
    const inspector = screen.getByTestId('inspector-panel').parentElement as HTMLElement
    expect(objects).toBeVisible()

    fireEvent.click(screen.getByTestId('toggle-objects-panel'))
    await waitFor(() => expect(objects).not.toBeVisible())
    expect(screen.getByTestId('workspace').style.gridTemplateColumns).toMatch(/^0px 0px/)

    fireEvent.keyDown(window, { key: '[' })
    await waitFor(() => expect(objects).toBeVisible())

    fireEvent.keyDown(window, { key: ']' })
    await waitFor(() => expect(inspector).not.toBeVisible())
    expect(screen.getByTestId('toggle-inspector-panel')).toHaveAttribute('aria-pressed', 'false')
  })

  it('jumps to a node from the command palette', async () => {
    const base = createSystem({ name: 'Palette_Test' })
    const { system } = addScene(base, 'Phase_Portrait')
    await renderApp({ system })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    const palette = screen.getByTestId('command-palette')
    const input = within(palette).getByTestId('command-palette-input')
    fireEvent.change(input, { target: { value: 'phase port' } })
    expect(within(palette).getAllByRole('option')[0]).toHaveTextContent('Phase_Portrait')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(screen.queryByTestId('command-palette')).toBeNull()
    await waitFor(() =>
      expect(document.querySelector('.viewport-tile--selected')).toHaveTextContent(
        'Phase_Portrait'
      )
    )
  })
})
