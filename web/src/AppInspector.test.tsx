import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { AppProvider } from './state/appState'
import { addBifurcationDiagram, createSystem, selectNode } from './system/model'
import { MemorySystemStore } from './system/store'
import { MockForkCoreClient } from './compute/mockClient'

describe('App inspector', () => {
  it('persists bifurcation axis changes from the inspector', async () => {
    let system = createSystem({ name: 'Diagram Inspector' })
    const diagramResult = addBifurcationDiagram(system, 'Diagram 1')
    system = selectNode(diagramResult.system, diagramResult.nodeId)

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

    const xSelect = screen.getByTestId('diagram-x-param') as HTMLSelectElement
    expect(xSelect.value).toBe('')

    fireEvent.change(xSelect, { target: { value: 'state:x' } })

    await waitFor(() => {
      expect(xSelect.value).toBe('state:x')
    })
  })
})
