import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createSystem } from '../system/model'
import { SystemSettingsDialog } from './SystemSettingsDialog'

vi.mock('./InspectorDetailsPanel', () => ({
  InspectorDetailsPanel: () => <div data-testid="inspector-details-panel" />,
}))

describe('SystemSettingsDialog', () => {
  it('renders when open and calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const system = createSystem({ name: 'Test System' })

    render(
      <SystemSettingsDialog
        open
        system={system}
        selectedNodeId={null}
        onClose={onClose}
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
        onCreateLimitCycle={vi.fn(() => Promise.resolve())}
        onCreateEquilibriumBranch={vi.fn(() => Promise.resolve())}
        onCreateBranchFromPoint={vi.fn(() => Promise.resolve())}
        onExtendBranch={vi.fn(() => Promise.resolve())}
        onCreateFoldCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateHopfCurveFromPoint={vi.fn(() => Promise.resolve())}
      />
    )

    expect(screen.getByTestId('system-settings-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-details-panel')).toBeInTheDocument()

    await user.click(screen.getByTestId('close-system-settings'))
    expect(onClose).toHaveBeenCalled()
  })

  it('returns null when closed', () => {
    render(
      <SystemSettingsDialog
        open={false}
        system={null}
        selectedNodeId={null}
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
        onCreateLimitCycle={vi.fn(() => Promise.resolve())}
        onCreateEquilibriumBranch={vi.fn(() => Promise.resolve())}
        onCreateBranchFromPoint={vi.fn(() => Promise.resolve())}
        onExtendBranch={vi.fn(() => Promise.resolve())}
        onCreateFoldCurveFromPoint={vi.fn(() => Promise.resolve())}
        onCreateHopfCurveFromPoint={vi.fn(() => Promise.resolve())}
      />
    )

    expect(screen.queryByTestId('system-settings-dialog')).not.toBeInTheDocument()
  })
})
