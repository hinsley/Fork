import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoSystem } from '../system/fixtures'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import { useState } from 'react'
import { addObject, createSystem, renameNode, toggleNodeVisibility, updateNodeRender } from '../system/model'
import type { EquilibriumObject } from '../system/types'

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
    const onRunOrbit = vi.fn().mockResolvedValue(undefined)
    const onSolveEquilibrium = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)
    const onCreateEquilibriumBranch = vi.fn().mockResolvedValue(undefined)
    const onCreateBranchFromPoint = vi.fn().mockResolvedValue(undefined)

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
          onRunOrbit={onRunOrbit}
          onSolveEquilibrium={onSolveEquilibrium}
          onCreateLimitCycle={onCreateLimitCycle}
          onCreateEquilibriumBranch={onCreateEquilibriumBranch}
          onCreateBranchFromPoint={onCreateBranchFromPoint}
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
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
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

  it('runs orbit and creates limit cycle requests', async () => {
    const user = userEvent.setup()
    const { system, objectNodeId } = createDemoSystem()
    const onRunOrbit = vi.fn().mockResolvedValue(undefined)
    const onCreateLimitCycle = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={objectNodeId}
        view="selection"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={onRunOrbit}
        onSolveEquilibrium={vi.fn().mockResolvedValue(undefined)}
        onCreateLimitCycle={onCreateLimitCycle}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('orbit-run-toggle'))
    await user.clear(screen.getByTestId('orbit-run-duration'))
    await user.type(screen.getByTestId('orbit-run-duration'), '10')
    await user.clear(screen.getByTestId('orbit-run-dt'))
    await user.type(screen.getByTestId('orbit-run-dt'), '0.5')
    await user.clear(screen.getByTestId('orbit-run-ic-0'))
    await user.type(screen.getByTestId('orbit-run-ic-0'), '1')
    await user.clear(screen.getByTestId('orbit-run-ic-1'))
    await user.type(screen.getByTestId('orbit-run-ic-1'), '2')

    await user.click(screen.getByTestId('orbit-run-submit'))

    expect(onRunOrbit).toHaveBeenCalledWith({
      orbitId: objectNodeId,
      initialState: [1, 2],
      duration: 10,
      dt: 0.5,
    })

    await user.click(screen.getByTestId('limit-cycle-toggle'))
    await user.clear(screen.getByTestId('limit-cycle-name'))
    await user.type(screen.getByTestId('limit-cycle-name'), 'LC Q')
    await user.clear(screen.getByTestId('limit-cycle-period'))
    await user.type(screen.getByTestId('limit-cycle-period'), '6')
    await user.clear(screen.getByTestId('limit-cycle-state-0'))
    await user.type(screen.getByTestId('limit-cycle-state-0'), '0.1')
    await user.clear(screen.getByTestId('limit-cycle-state-1'))
    await user.type(screen.getByTestId('limit-cycle-state-1'), '0.2')

    await user.click(screen.getByTestId('limit-cycle-submit'))

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

  it('solves equilibrium requests', async () => {
    const user = userEvent.setup()
    const baseSystem = createSystem({ name: 'Test System' })
    const eqObject: EquilibriumObject = {
      type: 'equilibrium',
      name: 'EQ 1',
      systemName: baseSystem.config.name,
      lastSolverParams: {
        initialGuess: baseSystem.config.varNames.map(() => 0),
        maxSteps: 25,
        dampingFactor: 1,
      },
      parameters: [...baseSystem.config.params],
    }
    const { system, nodeId } = addObject(baseSystem, eqObject)
    const onSolveEquilibrium = vi.fn().mockResolvedValue(undefined)

    render(
      <InspectorDetailsPanel
        system={system}
        selectedNodeId={nodeId}
        view="selection"
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn().mockResolvedValue(undefined)}
        onValidateSystem={vi.fn().mockResolvedValue({ ok: true, equationErrors: [] })}
        onRunOrbit={vi.fn().mockResolvedValue(undefined)}
        onSolveEquilibrium={onSolveEquilibrium}
        onCreateLimitCycle={vi.fn().mockResolvedValue(undefined)}
        onCreateEquilibriumBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranchFromPoint={vi.fn().mockResolvedValue(undefined)}
      />
    )

    await user.click(screen.getByTestId('equilibrium-solver-toggle'))
    await user.clear(screen.getByTestId('equilibrium-solve-steps'))
    await user.type(screen.getByTestId('equilibrium-solve-steps'), '10')
    await user.clear(screen.getByTestId('equilibrium-solve-damping'))
    await user.type(screen.getByTestId('equilibrium-solve-damping'), '0.8')
    await user.clear(screen.getByTestId('equilibrium-solve-guess-0'))
    await user.type(screen.getByTestId('equilibrium-solve-guess-0'), '1')
    await user.clear(screen.getByTestId('equilibrium-solve-guess-1'))
    await user.type(screen.getByTestId('equilibrium-solve-guess-1'), '2')

    await user.click(screen.getByTestId('equilibrium-solve-submit'))

    expect(onSolveEquilibrium).toHaveBeenCalledWith({
      equilibriumId: nodeId,
      initialGuess: [1, 2],
      maxSteps: 10,
      dampingFactor: 0.8,
    })
  })
})
