import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystem } from '../system/model'
import { SystemSettingsDialog } from './SystemSettingsDialog'

let capturedProps: Record<string, unknown> | null = null

vi.mock('./InspectorDetailsPanel', () => ({
  InspectorDetailsPanel: (props: Record<string, unknown>) => {
    capturedProps = props
    return <div data-testid="inspector-details-panel" />
  },
}))

describe('SystemSettingsDialog', () => {
  beforeEach(() => {
    capturedProps = null
  })

  it('renders when open and calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const system = createSystem({ name: 'Test_System' })

    render(
      <SystemSettingsDialog
        open
        system={system}
        selectedNodeId={null}
        theme="light"
        onClose={onClose}
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateObjectParams={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn(() => Promise.resolve())}
        onValidateSystem={vi.fn(() => Promise.resolve({ ok: true, equationErrors: [] }))}
        onRunOrbit={vi.fn(() => Promise.resolve())}
        onComputeLyapunovExponents={vi.fn(() => Promise.resolve())}
        onComputeCovariantLyapunovVectors={vi.fn(() => Promise.resolve())}
        onSolveEquilibrium={vi.fn(() => Promise.resolve())}
        onCreateEquilibriumBranch={vi.fn(() => Promise.resolve())}
        onCreateBranchFromPoint={vi.fn(() => Promise.resolve())}
        onExtendBranch={vi.fn(() => Promise.resolve())}
        onCreateFoldCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateHopfCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromHopf={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromOrbit={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromPD={vi.fn(() => Promise.resolve())}
      />
    )

    expect(screen.getByTestId('system-settings-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-details-panel')).toBeInTheDocument()

    await user.click(screen.getByTestId('close-system-settings'))
    expect(onClose).toHaveBeenCalled()
  })

  it('passes props through to InspectorDetailsPanel', () => {
    const system = createSystem({ name: 'Test_System' })
    const onRename = vi.fn()
    const onToggleVisibility = vi.fn()
    const onUpdateRender = vi.fn()
    const onUpdateObjectParams = vi.fn()
    const onUpdateScene = vi.fn()
    const onUpdateBifurcationDiagram = vi.fn()
    const onUpdateSystem = vi.fn(() => Promise.resolve())
    const onValidateSystem = vi.fn(() =>
      Promise.resolve({ ok: true, equationErrors: [] })
    )
    const onRunOrbit = vi.fn(() => Promise.resolve())
    const onComputeLyapunovExponents = vi.fn(() => Promise.resolve())
    const onComputeCovariantLyapunovVectors = vi.fn(() => Promise.resolve())
    const onSolveEquilibrium = vi.fn(() => Promise.resolve())
    const onCreateEquilibriumBranch = vi.fn(() => Promise.resolve())
    const onCreateBranchFromPoint = vi.fn(() => Promise.resolve())
    const onExtendBranch = vi.fn(() => Promise.resolve())
    const onCreateFoldCurveFromPoint = vi.fn(() => Promise.resolve())
    const onCreateHopfCurveFromPoint = vi.fn(() => Promise.resolve())
    const onCreateLimitCycleFromHopf = vi.fn(() => Promise.resolve())
    const onCreateLimitCycleFromOrbit = vi.fn(() => Promise.resolve())
    const onCreateLimitCycleFromPD = vi.fn(() => Promise.resolve())

    render(
      <SystemSettingsDialog
        open
        system={system}
        selectedNodeId="node-1"
        theme="light"
        onClose={vi.fn()}
        onRename={onRename}
        onToggleVisibility={onToggleVisibility}
        onUpdateRender={onUpdateRender}
        onUpdateObjectParams={onUpdateObjectParams}
        onUpdateScene={onUpdateScene}
        onUpdateBifurcationDiagram={onUpdateBifurcationDiagram}
        onUpdateSystem={onUpdateSystem}
        onValidateSystem={onValidateSystem}
        onRunOrbit={onRunOrbit}
        onComputeLyapunovExponents={onComputeLyapunovExponents}
        onComputeCovariantLyapunovVectors={onComputeCovariantLyapunovVectors}
        onSolveEquilibrium={onSolveEquilibrium}
        onCreateEquilibriumBranch={onCreateEquilibriumBranch}
        onCreateBranchFromPoint={onCreateBranchFromPoint}
        onExtendBranch={onExtendBranch}
        onCreateFoldCurveFromPoint={onCreateFoldCurveFromPoint}
        onCreateHopfCurveFromPoint={onCreateHopfCurveFromPoint}
        onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
        onCreateLimitCycleFromOrbit={onCreateLimitCycleFromOrbit}
        onCreateLimitCycleFromPD={onCreateLimitCycleFromPD}
      />
    )

    expect(capturedProps).not.toBeNull()
    expect(capturedProps?.system).toBe(system)
    expect(capturedProps?.selectedNodeId).toBe('node-1')
    expect(capturedProps?.view).toBe('system')
    expect(capturedProps?.theme).toBe('light')
    expect(capturedProps?.onRename).toBe(onRename)
    expect(capturedProps?.onToggleVisibility).toBe(onToggleVisibility)
    expect(capturedProps?.onUpdateRender).toBe(onUpdateRender)
    expect(capturedProps?.onUpdateObjectParams).toBe(onUpdateObjectParams)
    expect(capturedProps?.onUpdateScene).toBe(onUpdateScene)
    expect(capturedProps?.onUpdateBifurcationDiagram).toBe(onUpdateBifurcationDiagram)
    expect(capturedProps?.onUpdateSystem).toBe(onUpdateSystem)
    expect(capturedProps?.onValidateSystem).toBe(onValidateSystem)
    expect(capturedProps?.onRunOrbit).toBe(onRunOrbit)
    expect(capturedProps?.onComputeLyapunovExponents).toBe(onComputeLyapunovExponents)
    expect(capturedProps?.onComputeCovariantLyapunovVectors).toBe(
      onComputeCovariantLyapunovVectors
    )
    expect(capturedProps?.onSolveEquilibrium).toBe(onSolveEquilibrium)
    expect(capturedProps?.onCreateEquilibriumBranch).toBe(onCreateEquilibriumBranch)
    expect(capturedProps?.onCreateBranchFromPoint).toBe(onCreateBranchFromPoint)
    expect(capturedProps?.onExtendBranch).toBe(onExtendBranch)
    expect(capturedProps?.onCreateFoldCurveFromPoint).toBe(onCreateFoldCurveFromPoint)
    expect(capturedProps?.onCreateHopfCurveFromPoint).toBe(onCreateHopfCurveFromPoint)
    expect(capturedProps?.onCreateLimitCycleFromHopf).toBe(onCreateLimitCycleFromHopf)
    expect(capturedProps?.onCreateLimitCycleFromOrbit).toBe(onCreateLimitCycleFromOrbit)
    expect(capturedProps?.onCreateLimitCycleFromPD).toBe(onCreateLimitCycleFromPD)
  })

  it('returns null when open without a system', () => {
    render(
      <SystemSettingsDialog
        open
        system={null}
        selectedNodeId={null}
        theme="light"
        onClose={vi.fn()}
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn(() => Promise.resolve())}
        onValidateSystem={vi.fn(() => Promise.resolve({ ok: true, equationErrors: [] }))}
        onRunOrbit={vi.fn(() => Promise.resolve())}
        onComputeLyapunovExponents={vi.fn(() => Promise.resolve())}
        onComputeCovariantLyapunovVectors={vi.fn(() => Promise.resolve())}
        onSolveEquilibrium={vi.fn(() => Promise.resolve())}
        onCreateEquilibriumBranch={vi.fn(() => Promise.resolve())}
        onCreateBranchFromPoint={vi.fn(() => Promise.resolve())}
        onExtendBranch={vi.fn(() => Promise.resolve())}
        onCreateFoldCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateHopfCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromHopf={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromOrbit={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromPD={vi.fn(() => Promise.resolve())}
      />
    )

    expect(screen.queryByTestId('system-settings-dialog')).not.toBeInTheDocument()
  })

  it('returns null when closed', () => {
    const system = createSystem({ name: 'Test_System' })
    render(
      <SystemSettingsDialog
        open={false}
        system={system}
        selectedNodeId={null}
        theme="light"
        onClose={vi.fn()}
        onRename={vi.fn()}
        onToggleVisibility={vi.fn()}
        onUpdateRender={vi.fn()}
        onUpdateScene={vi.fn()}
        onUpdateBifurcationDiagram={vi.fn()}
        onUpdateSystem={vi.fn(() => Promise.resolve())}
        onValidateSystem={vi.fn(() => Promise.resolve({ ok: true, equationErrors: [] }))}
        onRunOrbit={vi.fn(() => Promise.resolve())}
        onComputeLyapunovExponents={vi.fn(() => Promise.resolve())}
        onComputeCovariantLyapunovVectors={vi.fn(() => Promise.resolve())}
        onSolveEquilibrium={vi.fn(() => Promise.resolve())}
        onCreateEquilibriumBranch={vi.fn(() => Promise.resolve())}
        onCreateBranchFromPoint={vi.fn(() => Promise.resolve())}
        onExtendBranch={vi.fn(() => Promise.resolve())}
        onCreateFoldCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateHopfCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromHopf={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromOrbit={vi.fn(() => Promise.resolve())}
        onCreateLimitCycleFromPD={vi.fn(() => Promise.resolve())}
      />
    )

    expect(screen.queryByTestId('system-settings-dialog')).not.toBeInTheDocument()
  })
})
