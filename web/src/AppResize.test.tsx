import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { AppProvider } from './state/appState'
import { MemorySystemStore } from './system/store'
import { createDemoSystem } from './system/fixtures'
import { MockForkCoreClient } from './compute/mockClient'

describe('App layout', () => {
  it('resizes panels via splitter drag', async () => {
    const { system } = createDemoSystem()
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

    const workspace = screen.getByTestId('workspace')
    const splitter = screen.getByTestId('splitter-left')
    const initial = workspace.style.gridTemplateColumns

    await act(async () => {
      fireEvent.pointerDown(splitter, { clientX: 200 })
      fireEvent.pointerMove(window, { clientX: 260 })
      fireEvent.pointerUp(window)
    })

    expect(workspace.style.gridTemplateColumns).not.toBe(initial)
  })
})
