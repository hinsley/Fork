import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('keeps a failed latest attempt separate from the stored successful solution', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Failed_Attempt' })
    const equilibrium: EquilibriumObject = {
      type: 'equilibrium',
      name: 'Eq',
      systemName: base.name,
      solution: {
        state: base.config.varNames.map(() => 0),
        residual_norm: 0,
        iterations: 1,
        jacobian: [],
        eigenpairs: [],
      },
      lastRun: {
        timestamp: '2026-09-16T12:00:00Z',
        success: false,
        diagnostic: {
          kind: 'iteration_limit',
          message: 'Newton correction did not converge.',
          iterations: 20,
          max_iterations: 20,
          residual_norm: 0.25,
          tolerance: 1e-8,
          suggestion: 'Choose a closer initial guess.',
        },
      },
    }
    const added = addObject(base, equilibrium)
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)
    expect(screen.getByText('last attempt failed')).toBeVisible()
    await user.click(screen.getByTestId('action-equilibrium-solver-toggle'))
    expect(screen.getByTestId('calculation-diagnostic')).toBeVisible()
    expect(screen.getByText('Newton correction did not converge.')).toBeVisible()
    expect(screen.getByText('Choose a closer initial guess.')).toBeVisible()
    expect(screen.getByTestId('calculation-diagnostic-metrics')).toHaveTextContent('Residual 2.50e-1')
    expect(screen.getByText('Stored solution unchanged.')).toBeVisible()
    await user.click(screen.getByTestId('inspector-workflow-back'))
    await user.click(screen.getByTestId('action-equilibrium-solver-toggle'))
    expect(screen.getByTestId('calculation-diagnostic')).toBeVisible()
  })

  it('shows solved equilibrium data inline without an Inspect workflow', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Workflow_Inspect',
      config: {
        name: 'Workflow_Inspect',
        equations: ['-x'],
        params: [1],
        paramNames: ['a'],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
    })
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

    expect(screen.queryByTestId('action-equilibrium-data-toggle')).toBeNull()
    expect(screen.getByTestId('inspector-meta')).toHaveTextContent('Solved')
    const state = within(screen.getByTestId('equilibrium-glance-state'))
    expect(state.getByText(base.config.varNames[0])).toBeVisible()
    expect(state.getByRole('button', { name: 'Copy state' })).toBeVisible()
    const parameters = within(screen.getByTestId('equilibrium-data-parameters'))
    expect(parameters.getByText(base.config.paramNames[0])).toBeVisible()
    expect(parameters.getByRole('button', { name: 'Copy parameters' })).toBeVisible()
    expect(screen.getByTestId('equilibrium-solve-submit')).not.toBeVisible()

    await user.click(screen.getByTestId('action-equilibrium-solver-toggle'))

    expect(screen.getByTestId('equilibrium-solve-submit')).toBeVisible()
    // The header and glance stay pinned; inline data yields to the workflow.
    expect(screen.getByTestId('equilibrium-glance-state')).toBeVisible()
    expect(screen.getByTestId('inspector-panel-body')).toHaveClass('inspector-browser--workflow')
    expect(screen.queryByText('Cached solver parameters')).toBeNull()
  })

  it('shows primary actions as buttons and the rest in the overflow menu', () => {
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
    expect(within(actions).getAllByTestId(/^action-/)[0]).toHaveTextContent('Run')
    expect(screen.getByTestId('action-orbit-run-toggle')).toBeVisible()
    expect(screen.getByTestId('action-oseledets-toggle')).toBeVisible()
    expect(screen.getByTestId('orbit-extend-quick')).toBeVisible()
    // Appearance, parameters and frozen variables live in the header.
    expect(within(actions).queryByTestId('action-appearance-toggle')).toBeNull()
    expect(screen.getByTestId('action-appearance-toggle')).toHaveAttribute('aria-label', 'Appearance')
    expect(screen.getByTestId('action-parameters-toggle')).toBeVisible()
    expect(screen.getByTestId('action-frozen-variables-toggle')).toBeVisible()
    expect(actions).not.toHaveTextContent('Configure')
    const more = screen.getByTestId('inspector-actions-more')
    expect(screen.getByTestId('action-limit-cycle-toggle')).not.toBeVisible()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('action-limit-cycle-toggle')).toBeVisible()
    expect(screen.getByTestId('action-heteroclinic-from-orbit-toggle')).toHaveTextContent(
      'Heteroclinic connection'
    )
    fireEvent.click(screen.getByTestId('action-limit-cycle-toggle'))
    expect(screen.getByTestId('inspector-workflow-focus')).toHaveTextContent('Limit cycle from orbit')
    expect(screen.getByTestId('heteroclinic-from-orbit-toggle').closest('details')).toHaveClass(
      'inspector-disclosure--action-only'
    )
  })

  it('shows discrete-map orbit data inline and workflows through Actions', async () => {
    const user = userEvent.setup()
    const base = createSystem({
      name: 'Workflow_Map',
      config: {
        name: 'Workflow_Map',
        equations: ['r * x * (1 - x)'],
        params: [3.7],
        paramNames: ['r'],
        varNames: ['x'],
        solver: 'discrete',
        type: 'map',
      },
    })
    const added = addObject(base, {
      ...orbit('Orbit_Map', base.name),
      data: [
        [0, 0.2],
        [1, 0.592],
      ],
      parameters: [...base.config.params],
    })
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)

    expect(screen.getByTestId('action-orbit-run-toggle')).toBeVisible()
    expect(screen.getByTestId('action-oseledets-toggle')).toBeVisible()
    expect(screen.queryByTestId('action-limit-cycle-toggle')).toBeNull()
    expect(screen.queryByTestId('inspector-actions-more')).toBeNull()
    expect(screen.queryByTestId('action-orbit-data-toggle')).toBeNull()

    for (const testId of ['orbit-run-toggle', 'oseledets-toggle']) {
      expect(screen.getByTestId(testId).closest('details')).toHaveClass(
        'inspector-disclosure--action-only'
      )
    }

    expect(screen.getByTestId('inspector-meta')).toHaveTextContent('2 points')
    expect(screen.getByTestId('orbit-glance-final-state')).toHaveTextContent('0.592')
    expect(screen.getByTestId('orbit-data-preview-toggle')).toBeVisible()
    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('inspector-meta')).toHaveTextContent('2 points')
    expect(screen.getByTestId('orbit-run-submit')).toBeVisible()
  })

  it('focuses one action and retains its draft when returning to browse mode', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Workflow_Shell' })
    const added = addObject(base, orbit('Orbit_A', base.name))
    render(<InspectorDetailsPanel {...requiredProps(added.system, added.nodeId)} />)

    expect(screen.getByTestId('inspector-name')).toBeVisible()
    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('inspector-workflow-focus')).toBeVisible()
    expect(screen.getByTestId('inspector-name')).toBeVisible()
    expect(screen.getByTestId('orbit-run-duration')).toBeVisible()
    expect(screen.queryByTestId('inspector-workflow-advanced')).toBeNull()

    await user.clear(screen.getByTestId('orbit-run-duration'))
    await user.type(screen.getByTestId('orbit-run-duration'), '42')
    await user.click(screen.getByTestId('inspector-workflow-back'))
    expect(screen.getByTestId('inspector-actions')).toBeVisible()
    expect(screen.getByTestId('inspector-name')).toBeVisible()

    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    expect(screen.getByTestId('orbit-run-duration')).toHaveValue(42)
  })

  it('reports workflow changes so the inspector can reset its scroll position', async () => {
    const user = userEvent.setup()
    const base = createSystem({ name: 'Workflow_Scroll_Reset' })
    const added = addObject(base, orbit('Orbit_A', base.name))
    const onActiveWorkflowChange = vi.fn()
    render(
      <InspectorDetailsPanel
        {...requiredProps(added.system, added.nodeId)}
        onActiveWorkflowChange={onActiveWorkflowChange}
      />
    )

    await waitFor(() => expect(onActiveWorkflowChange).toHaveBeenCalledTimes(1))
    await user.click(screen.getByTestId('action-orbit-run-toggle'))
    await waitFor(() => expect(onActiveWorkflowChange.mock.calls.length).toBeGreaterThan(1))
    await user.click(screen.getByTestId('inspector-workflow-back'))
    await waitFor(() => expect(onActiveWorkflowChange.mock.calls.length).toBeGreaterThan(2))
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
