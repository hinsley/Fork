import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { MockForkCoreClient } from './compute/mockClient'
import { AppProvider } from './state/appState'
import { createSystem } from './system/model'
import { MemorySystemStore } from './system/store'

describe('App home', () => {
  it('returns to the systems list without deleting the open system', async () => {
    const system = createSystem({ name: 'Home_Test' })
    const store = new MemorySystemStore()
    await store.save(system)

    render(
      <AppProvider
        store={store}
        client={new MockForkCoreClient()}
        initialSystem={system}
        initialSystems={[
          {
            id: system.id,
            name: system.name,
            updatedAt: system.updatedAt,
            type: system.config.type,
          },
        ]}
      >
        <App />
      </AppProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('workspace')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('go-home'))
    })

    expect(screen.queryByTestId('workspace')).toBeNull()
    const home = screen.getByTestId('home')
    expect(within(home).getByTestId('system-library')).toBeInTheDocument()
    expect(within(home).getByRole('button', { name: 'Home_Test' })).toHaveTextContent('Flow')
    expect(within(home).getByTestId('create-system')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('open-systems')).toBeNull()
    expect(await store.list()).toHaveLength(1)
  })
})
