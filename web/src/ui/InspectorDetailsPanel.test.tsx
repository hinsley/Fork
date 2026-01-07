import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoSystem } from '../system/fixtures'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import { useState } from 'react'
import { renameNode, toggleNodeVisibility, updateNodeRender } from '../system/model'

describe('InspectorDetailsPanel', () => {
  it('binds name and render fields', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onRename = vi.fn()
    const onToggleVisibility = vi.fn()
    const onUpdateRender = vi.fn()
    const onUpdateScene = vi.fn()
    const onUpdateBifurcationDiagram = vi.fn()
    const onUpdateSystem = vi.fn().mockResolvedValue(undefined)
    const onValidateSystem = vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })
    const onCreateOrbit = vi.fn().mockResolvedValue(undefined)
    const onCreateEquilibrium = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)

    function Wrapper() {
      const [state, setState] = useState(system)
      return (
        <InspectorDetailsPanel
          system={state}
          selectedNodeId={objectNodeId}
          view="selection"
          onRename={(id, name) => {
            onRename(id, name)
            setState((prev) => renameNode(prev, id, name))
          }}
          onToggleVisibility={(id) => {
            onToggleVisibility(id)
            setState((prev) => toggleNodeVisibility(prev, id))
          }}
          onUpdateRender={(id, render) => {
            onUpdateRender(id, render)
            setState((prev) => updateNodeRender(prev, id, render))
          }}
          onUpdateScene={onUpdateScene}
          onUpdateBifurcationDiagram={onUpdateBifurcationDiagram}
          onUpdateSystem={async (system) => {
            onUpdateSystem(system)
            setState((prev) => ({ ...prev, config: system }))
          }}
          onValidateSystem={onValidateSystem}
          onCreateOrbit={onCreateOrbit}
          onCreateEquilibrium={onCreateEquilibrium}
          onCreateLimitCycle={onCreateLimitCycle}
        />
      )
    }

    render(<Wrapper />)

    const nameInput = screen.getByTestId('inspector-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Orbit Q')
    expect(onRename).toHaveBeenLastCalledWith(objectNodeId, 'Orbit Q')

    await user.click(screen.getByTestId('inspector-visibility'))
    expect(onToggleVisibility).toHaveBeenCalledWith(objectNodeId)

    const lineWidth = screen.getByTestId('inspector-line-width')
    await user.clear(lineWidth)
    await user.type(lineWidth, '3')
    expect(onUpdateRender).toHaveBeenLastCalledWith(objectNodeId, { lineWidth: 3 })
  })

  it('applies system changes from the editor', async () => {
    const user = userEvent.setup()
    const { system } = createDemoSystem()
    const onUpdateSystem = vi.fn().mockResolvedValue(undefined)
    const onValidateSystem = vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={null}
        view="system"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={onUpdateSystem}
        onValidateSystem={onValidateSystem}
        onCreateOrbit={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const nameInput = screen.getByTestId('system-name')
    await user.clear(nameInput)
    await user.type(nameInput, 'New System')

    await user.click(screen.getByTestId('system-apply'))

    expect(onUpdateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New System' })
    )
  })

  it('creates orbit and limit cycle requests', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onCreateOrbit = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={null}
        view="create"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onCreateOrbit={onCreateOrbit}
        onCreateEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycle={onCreateLimitCycle}
      />
    )

    await user.clear(screen.getByTestId('create-orbit-name'))
    await user.type(screen.getByTestId('create-orbit-name'), 'Orbit Q')
    await user.clear(screen.getByTestId('create-orbit-duration'))
    await user.type(screen.getByTestId('create-orbit-duration'), '10')
    await user.clear(screen.getByTestId('create-orbit-dt'))
    await user.type(screen.getByTestId('create-orbit-dt'), '0.5')
    await user.clear(screen.getByTestId('create-orbit-ic-0'))
    await user.type(screen.getByTestId('create-orbit-ic-0'), '1')
    await user.clear(screen.getByTestId('create-orbit-ic-1'))
    await user.type(screen.getByTestId('create-orbit-ic-1'), '2')

    await user.click(screen.getByTestId('create-orbit-submit'))

    expect(onCreateOrbit).toHaveBeenCalledWith({
      name: 'Orbit Q',
      initialState: [1, 2],
      duration: 10,
      dt: 0.5,
    })

    await user.clear(screen.getByTestId('create-limit-cycle-name'))
    await user.type(screen.getByTestId('create-limit-cycle-name'), 'LC Q')
    await user.clear(screen.getByTestId('create-limit-cycle-period'))
    await user.type(screen.getByTestId('create-limit-cycle-period'), '6')
    await user.clear(screen.getByTestId('create-limit-cycle-state-0'))
    await user.type(screen.getByTestId('create-limit-cycle-state-0'), '0.1')
    await user.clear(screen.getByTestId('create-limit-cycle-state-1'))
    await user.type(screen.getByTestId('create-limit-cycle-state-1'), '0.2')

    await user.click(screen.getByTestId('create-limit-cycle-submit'))

    expect(onCreateLimitCycle).toHaveBeenCalledWith({
      name: 'LC Q',
      originOrbitId: objectNodeId,
      period: 6,
      state: [0.1, 0.2],
      ntst: 50,
      ncol: 4,
      parameterName: undefined,
    })
  })
})
