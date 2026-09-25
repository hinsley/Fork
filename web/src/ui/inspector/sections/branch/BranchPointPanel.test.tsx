import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { InspectorDetailsPanel } from '../../../InspectorDetailsPanel'
import { addBranch, addObject, createSystem } from '../../../../system/model'
import type {
  ContinuationObject,
  ContinuationPoint,
  EquilibriumObject,
  SystemConfig,
} from '../../../../system/types'
import type { BranchPointSelection } from '../../../branchPointSelection'

function hopfBranchSystem(
  options: { parameterName?: 'mu' | 'nu'; hopfRealPart?: number } = {}
) {
  const parameterName = options.parameterName ?? 'mu'
  const config: SystemConfig = {
    name: 'Branch_Panel_Hopf',
    equations: ['mu * x - y', 'x + mu * y'],
    params: [-0.5, 0.25],
    paramNames: ['mu', 'nu'],
    varNames: ['x', 'y'],
    solver: 'rk4',
    type: 'flow',
  }
  const base = createSystem({ name: config.name, config })
  const equilibrium: EquilibriumObject = {
    type: 'equilibrium',
    name: 'EQ',
    systemName: config.name,
  }
  const added = addObject(base, equilibrium)
  const mus = [-0.5, -0.25, 0, 0.25, 0.5]
  const points: ContinuationPoint[] = mus.map((mu) => ({
    state: [0, 0],
    param_value: mu,
    stability: mu === 0 ? 'Hopf' : 'None',
    eigenvalues: [
      { re: mu === 0 ? (options.hopfRealPart ?? 0) : mu, im: 1 },
      { re: mu === 0 ? (options.hopfRealPart ?? 0) : mu, im: -1 },
    ],
  }))
  const branch: ContinuationObject = {
    type: 'continuation',
    name: `eq_${parameterName}`,
    systemName: config.name,
    parameterName,
    parentObject: 'EQ',
    startObject: 'EQ',
    branchType: 'equilibrium',
    data: {
      points,
      bifurcations: [2],
      indices: [0, 1, 2, 3, 4],
      branch_type: { type: 'Equilibrium' },
    },
    settings: {
      step_size: 0.25,
      min_step_size: 1e-5,
      max_step_size: 0.5,
      max_steps: 4,
      corrector_steps: 4,
      corrector_tolerance: 1e-6,
      step_tolerance: 1e-6,
    },
    timestamp: new Date().toISOString(),
    params: [...config.params],
  }
  return addBranch(added.system, branch, added.nodeId)
}

type PanelProps = ComponentProps<typeof InspectorDetailsPanel>

function baseProps(
  system: PanelProps['system'],
  selectedNodeId: string
): PanelProps {
  return {
    system,
    selectedNodeId,
    view: 'selection',
    theme: 'light',
    onRename: vi.fn(),
    onToggleVisibility: vi.fn(),
    onUpdateRender: vi.fn(),
    onUpdateScene: vi.fn(),
    onUpdateBifurcationDiagram: vi.fn(),
    onUpdateSystem: vi.fn().mockResolvedValue(undefined),
    onValidateSystem: vi.fn().mockResolvedValue({ ok: true, equationErrors: [] }),
    onRunOrbit: vi.fn().mockResolvedValue(undefined),
    onComputeLyapunovExponents: vi.fn().mockResolvedValue(undefined),
    onComputeCovariantLyapunovVectors: vi.fn().mockResolvedValue(undefined),
    onSolveEquilibrium: vi.fn().mockResolvedValue(undefined),
    onCreateEquilibriumBranch: vi.fn().mockResolvedValue(undefined),
    onCreateBranchFromPoint: vi.fn().mockResolvedValue(undefined),
    onExtendBranch: vi.fn().mockResolvedValue(undefined),
    onCreateFoldCurveFromPoint: vi.fn().mockResolvedValue(undefined),
    onCreateHopfCurveFromPoint: vi.fn().mockResolvedValue(undefined),
    onCreateNSCurveFromPoint: vi.fn().mockResolvedValue(undefined),
    onCreateLimitCycleFromHopf: vi.fn().mockResolvedValue(undefined),
    onCreateLimitCycleFromOrbit: vi.fn().mockResolvedValue(undefined),
    onCreateLimitCycleFromPD: vi.fn().mockResolvedValue(undefined),
    onCreateCycleFromPD: vi.fn().mockResolvedValue(undefined),
  }
}

function SelectionHarness({
  props,
  initialSelection,
}: {
  props: PanelProps
  initialSelection: BranchPointSelection
}) {
  const [selection, setSelection] = useState<BranchPointSelection>(initialSelection)
  return (
    <>
      <button
        type="button"
        data-testid="external-select"
        onClick={() => setSelection({ branchId: props.selectedNodeId ?? '', pointIndex: 1 })}
      />
      <InspectorDetailsPanel
        {...props}
        branchPointSelection={selection}
        onBranchPointSelect={setSelection}
      />
    </>
  )
}

describe('branch point panel', () => {
  it('shows the branch summary and real stability on the root page', () => {
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    expect(screen.getByText('equilibrium · 5 points · mu −0.5 → 0.5')).toBeVisible()
    expect(screen.getByTestId('branch-stability-bar')).toHaveTextContent('stable')
    expect(screen.getByTestId('branch-stability-bar')).toHaveTextContent('unstable 2u')
    const row = screen.getByTestId('branch-bifurcation-2')
    expect(row).toHaveTextContent('H')
    expect(row).toHaveTextContent('Hopf')
    expect(row).toHaveTextContent('ω 1')
    // Endpoint default selection: an unstable focus, not a bifurcation tag.
    expect(screen.getByTestId('branch-point-stability')).toHaveTextContent('unstable focus')
    expect(screen.queryByTestId('branch-point-bif-chip')).toBeNull()
  })

  it('moves point actions into the point panel and opens their workflows', async () => {
    const user = userEvent.setup()
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    await user.click(screen.getByTestId('branch-bifurcation-2'))
    expect(screen.getByTestId('branch-point-bif-chip')).toHaveTextContent('Hopf')
    const panel = within(screen.getByTestId('branch-point-panel'))
    expect(panel.getByTestId('action-limit-cycle-from-hopf-toggle')).toHaveTextContent(
      'Limit cycle'
    )
    expect(panel.getByTestId('action-codim1-curve-toggle')).toHaveTextContent('Hopf curve')
    expect(panel.getByTestId('action-branch-continue-toggle')).toHaveTextContent(
      'Continue from here'
    )
    const rootActions = screen.queryByTestId('inspector-actions')
    if (rootActions) {
      expect(within(rootActions).queryByTestId('action-limit-cycle-from-hopf-toggle')).toBeNull()
    }

    await user.click(panel.getByTestId('action-limit-cycle-from-hopf-toggle'))
    expect(screen.getByTestId('inspector-workflow-focus')).toHaveTextContent('Limit cycle')
    expect(
      screen.getByTestId('limit-cycle-from-hopf-toggle').closest('details')
    ).toHaveAttribute('data-workflow-active', 'true')
  })

  it('steps with arrow keys and jumps between bifurcations with Shift', () => {
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    const input = screen.getByTestId('branch-point-input')
    expect(input).toHaveValue(4)
    const scrubber = screen.getByTestId('branch-point-scrubber')
    fireEvent.keyDown(scrubber, { key: 'ArrowLeft' })
    expect(input).toHaveValue(3)
    fireEvent.keyDown(scrubber, { key: 'ArrowLeft', shiftKey: true })
    expect(input).toHaveValue(2)
    fireEvent.keyDown(scrubber, { key: 'ArrowLeft', shiftKey: true })
    expect(input).toHaveValue(2)
    fireEvent.keyDown(scrubber, { key: 'ArrowRight' })
    expect(input).toHaveValue(3)
    fireEvent.change(scrubber, { target: { value: '0' } })
    expect(input).toHaveValue(0)
    // Typing in the index input does not step points.
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(input).toHaveValue(0)
  })

  it('keeps Shift+arrows on bifurcations and works after clicking the summary', () => {
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    const input = screen.getByTestId('branch-point-input')
    const scrubber = screen.getByTestId('branch-point-scrubber')
    // At the last point there is no later bifurcation: handled as a no-op, so
    // the range input cannot fall back to its native one-point step.
    expect(input).toHaveValue(4)
    expect(fireEvent.keyDown(scrubber, { key: 'ArrowRight', shiftKey: true })).toBe(false)
    expect(input).toHaveValue(4)
    fireEvent.keyDown(scrubber, { key: 'ArrowLeft', shiftKey: true })
    expect(input).toHaveValue(2)
    expect(fireEvent.keyDown(scrubber, { key: 'ArrowLeft', shiftKey: true })).toBe(false)
    expect(input).toHaveValue(2)
    // Plain arrows at the ends are swallowed too.
    fireEvent.change(scrubber, { target: { value: '0' } })
    expect(fireEvent.keyDown(scrubber, { key: 'ArrowLeft' })).toBe(false)
    expect(input).toHaveValue(0)

    // The branch root is focusable (not a tab stop), so a click on the summary
    // gives arrow keys a target.
    const root = screen.getByTestId('branch-summary').closest('.branch-root') as HTMLElement
    expect(root).toHaveAttribute('tabindex', '-1')
    root.focus()
    expect(root).toHaveFocus()
    fireEvent.keyDown(root, { key: 'ArrowRight' })
    expect(input).toHaveValue(1)
  })

  it('reads a Hopf point with locator-noise Re λ as non-hyperbolic', async () => {
    const user = userEvent.setup()
    const { system, nodeId } = hopfBranchSystem({ hopfRealPart: 4.2e-7 })
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    await user.click(screen.getByTestId('branch-bifurcation-2'))
    expect(screen.getByTestId('branch-point-stability')).toHaveTextContent('non-hyperbolic')
    const rows = within(screen.getByTestId('branch-point-eigenvalues')).getAllByRole('row')
    expect(rows.filter((row) => row.classList.contains('is-unstable'))).toHaveLength(0)
  })

  it('defaults the limit-cycle parameter to the branch parameter', async () => {
    const user = userEvent.setup()
    const { system, nodeId } = hopfBranchSystem({ parameterName: 'nu' })
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    await user.click(screen.getByTestId('branch-bifurcation-2'))
    await user.click(
      within(screen.getByTestId('branch-point-panel')).getByTestId(
        'action-limit-cycle-from-hopf-toggle'
      )
    )
    expect(screen.getByTestId('limit-cycle-from-hopf-parameter')).toHaveValue('nu')
    expect(
      (screen.getByTestId('limit-cycle-from-hopf-branch-name') as HTMLInputElement).value
    ).toMatch(/_nu$/)
  })

  it('blocks continuation when the initial or min step exceeds the max step', async () => {
    const user = userEvent.setup()
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    await user.click(screen.getByTestId('branch-bifurcation-2'))
    await user.click(
      within(screen.getByTestId('branch-point-panel')).getByTestId(
        'action-limit-cycle-from-hopf-toggle'
      )
    )
    const submit = screen.getByTestId('limit-cycle-from-hopf-submit')
    expect(submit).toHaveTextContent(/^Continue$/)
    expect(submit).toBeEnabled()
    expect(screen.getByTestId('limit-cycle-from-hopf-direction')).toHaveTextContent('→ Increasing')

    fireEvent.change(screen.getByTestId('limit-cycle-from-hopf-step-size'), {
      target: { value: '0.5' },
    })
    expect(submit).toBeDisabled()
    expect(screen.getByTestId('limit-cycle-from-hopf-step-error')).toHaveTextContent(
      'Initial step exceeds max step.'
    )
    expect(screen.getByTestId('limit-cycle-from-hopf-step-size')).toHaveAttribute(
      'aria-invalid',
      'true'
    )

    fireEvent.change(screen.getByTestId('limit-cycle-from-hopf-step-size'), {
      target: { value: '0.05' },
    })
    fireEvent.change(screen.getByTestId('limit-cycle-from-hopf-min-step-size'), {
      target: { value: '1' },
    })
    expect(submit).toBeDisabled()
    expect(screen.getByTestId('limit-cycle-from-hopf-step-error')).toHaveTextContent(
      'Min step exceeds max step.'
    )

    fireEvent.change(screen.getByTestId('limit-cycle-from-hopf-min-step-size'), {
      target: { value: '1e-5' },
    })
    expect(submit).toBeEnabled()
    expect(screen.queryByTestId('limit-cycle-from-hopf-step-error')).toBeNull()
  })

  it('jumps on Enter in the index input', () => {
    const { system, nodeId } = hopfBranchSystem()
    render(<InspectorDetailsPanel {...baseProps(system, nodeId)} />)

    const input = screen.getByTestId('branch-point-input')
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const muValue = within(screen.getByTestId('branch-point-panel'))
      .getAllByText('mu')[0]
      .closest('.branch-kv__pair')
      ?.querySelector('dd')
    expect(muValue).toHaveTextContent('−0.25')
  })

  it('follows viewport point selection without opening a workflow page', async () => {
    const user = userEvent.setup()
    const { system, nodeId } = hopfBranchSystem()
    const props = baseProps(system, nodeId)
    render(
      <SelectionHarness props={props} initialSelection={{ branchId: nodeId, pointIndex: 4 }} />
    )
    expect(screen.getByTestId('branch-point-input')).toHaveValue(4)

    await user.click(screen.getByTestId('external-select'))
    expect(screen.getByTestId('branch-point-input')).toHaveValue(1)
    expect(screen.queryByTestId('inspector-workflow-focus')).toBeNull()
    expect(screen.getByTestId('branch-point-panel')).toBeVisible()
  })
})
