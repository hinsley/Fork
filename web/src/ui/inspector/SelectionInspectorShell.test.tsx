import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { addObject, createSystem } from '../../system/model'
import type { EquilibriumObject, OrbitObject, System } from '../../system/types'
import { InspectorDetailsPanel } from '../InspectorDetailsPanel'

function orbit(name: string, systemName: string): OrbitObject {
  return { type: 'orbit', name, systemName, data: [], t_start: 0, t_end: 10, dt: 0.01 }
}

function requiredProps(system: System, selectedNodeId: string) {
  const resolved = Promise.resolve()
  return {
    system,
    selectedNodeId,
    view: 'selection' as const,
    theme: 'light' as const,
    onRename: vi.fn(),
    onToggleVisibility: vi.fn(),
    onUpdateRender: vi.fn(),
    onUpdateScene: vi.fn(),
    onUpdateBifurcationDiagram: vi.fn(),
    onUpdateSystem: vi.fn(() => resolved),
    onValidateSystem: vi.fn(() => Promise.resolve({ ok: true, equationErrors: [] })),
    onRunOrbit: vi.fn(() => resolved),
    onComputeLyapunovExponents: vi.fn(() => resolved),
    onComputeCovariantLyapunovVectors: vi.fn(() => resolved),
    onSolveEquilibrium: vi.fn(() => resolved),
    onCreateEquilibriumBranch: vi.fn(() => resolved),
    onCreateBranchFromPoint: vi.fn(() => resolved),
    onExtendBranch: vi.fn(() => resolved),
    onCreateFoldCurveFromPoint: vi.fn(() => resolved),
    onCreateHopfCurveFromPoint: vi.fn(() => resolved),
    onCreateNSCurveFromPoint: vi.fn(() => resolved),
    onCreateLimitCycleFromHopf: vi.fn(() => resolved),
    onCreateLimitCycleFromOrbit: vi.fn(() => resolved),
    onCreateLimitCycleFromPD: vi.fn(() => resolved),
    onCreateCycleFromPD: vi.fn(() => resolved),
  }
}

describe('selection inspector workflow shell', () => {
  it('opens solved equilibrium data from the Inspect action', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Workflow_Inspect' })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Equilibrium_A',
      systemName: base.name,
      solution: {
        state: base.config.varNames.map(() => 0),
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      parameters: [...base.config.params],
    }
    const added = addObject(base, equilibrium)
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)

    const actions = screen.getByTestId('inspector-actions')
    expect(within(actions).getByRole('heading', { name: 'Inspect' })).toBeVisible()
    expect(screen.getByTestId('action-equilibrium-data-toggle')).toHaveTextContent('View Data')

    await user.click(screen.getByTestId('action-equilibrium-data-toggle'))

    expect(screen.getByTestId('inspector-workflow-focus')).toHaveTextContent('Inspect')
    expect(screen.getByRole('heading', { name: 'Coordinates' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Residual and iterations' })).not.toBeVisible()
    expect(screen.getByRole('heading', { name: 'Last solver attempt' })).not.toBeVisible()
    expect(screen.queryByTestId('inspector-workflow-advanced')).toBeNull()

    await user.click(screen.getByTestId('inspector-workflow-back'))
    await user.click(screen.getByTestId('action-equilibrium-solver-toggle'))

    expect(screen.getByRole('heading', { name: 'Residual and iterations' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Last solver attempt' })).toBeVisible()
    expect(screen.queryByText('Cached solver parameters')).toBeNull()
  })

  it('groups configuration actions and labels continuation actions', () => {
    const base = createSystem({ name: 'Workflow_Groups' })
    const added = addObject(
      base,
      {
        ...orbit('Orbit_A', base.name),
        data: [
          [0, 1],
          [1, 2],
        ],
      }
    )
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)

    const actions = screen.getByTestId('inspector-actions')
    expect(actions).toHaveTextContent('Configure')
    expect(actions).toHaveTextContent('Frozen Variables')
    expect(actions).toHaveTextContent('Parameters')
    expect(within(actions).getAllByRole('button')[0]).toHaveTextContent('Appearance')
    expect(actions).not.toHaveTextContent('Modify appearance')
    expect(within(actions).getByRole('heading', { name: 'Continuation' })).toBeVisible()
    expect(within(actions).queryByRole('heading', { name: 'Continue' })).toBeNull()
  })

  it('focuses one action and retains its draft when returning to browse mode', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Workflow_Shell' })
    const added = addObject(base, orbit('Orbit_A', base.name))
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)

    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('inspector-workflow-focus')).toBeVisible()
    expect(screen.getByTestId('orbit-run-duration')).toBeVisible()
    expect(screen.getByTestId('inspector-workflow-advanced')).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    await user.clear(screen.getByTestId('orbit-run-duration'))
    await user.type(screen.getByTestId('orbit-run-duration'), '42')
    await user.click(screen.getByTestId('inspector-workflow-back'))
    expect(screen.getByTestId('inspector-actions')).toBeVisible()

    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('orbit-run-duration')).toHaveValue(42)
  })

  it('creates a fresh keyed session when the selected node changes', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Workflow_Reset' })
    const first = addObject(base, orbit('Orbit_A', base.name))
    const second = addObject(first.system, orbit('Orbit_B', base.name))
    const { rerender } = render(
      <InspectorDetailsPanel {...requiredProps(second.system, first.nodeId)} />
    )

    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    await user.clear(screen.getByTestId('orbit-run-duration'))
    await user.type(screen.getByTestId('orbit-run-duration'), '42')

    rerender(<InspectorDetailsPanel {...requiredProps(second.system, second.nodeId)} />)
    expect(screen.queryByTestId('inspector-workflow-focus')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('orbit-run-duration')).not.toHaveValue(42)
  })
})
