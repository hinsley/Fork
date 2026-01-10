import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type { BifurcationDiagram, Scene, System, SystemConfig, TreeNode } from '../system/types'
import type {
  BranchContinuationRequest,
  EquilibriumContinuationRequest,
  EquilibriumSolveRequest,
  FoldCurveContinuationRequest,
  HopfCurveContinuationRequest,
  LimitCycleCreateRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
} from '../state/appState'

type SystemSettingsDialogProps = {
  open: boolean
  system: System | null
  selectedNodeId: string | null
  onClose: () => void
  onRename: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onUpdateRender: (id: string, render: Partial<TreeNode['render']>) => void
  onUpdateScene: (id: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  onUpdateBifurcationDiagram: (
    id: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  onUpdateSystem: (system: SystemConfig) => Promise<void>
  onValidateSystem: (system: SystemConfig, opts?: { signal?: AbortSignal }) => Promise<{
    ok: boolean
    equationErrors: Array<string | null>
    message?: string
  }>
  onRunOrbit: (request: OrbitRunRequest) => Promise<void>
  onComputeLyapunovExponents: (request: OrbitLyapunovRequest) => Promise<void>
  onComputeCovariantLyapunovVectors: (request: OrbitCovariantLyapunovRequest) => Promise<void>
  onSolveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  onCreateLimitCycle: (request: LimitCycleCreateRequest) => Promise<void>
  onCreateEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  onCreateBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  onCreateFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  onCreateHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
}

export function SystemSettingsDialog({
  open,
  system,
  selectedNodeId,
  onClose,
  onRename,
  onToggleVisibility,
  onUpdateRender,
  onUpdateScene,
  onUpdateBifurcationDiagram,
  onUpdateSystem,
  onValidateSystem,
  onRunOrbit,
  onComputeLyapunovExponents,
  onComputeCovariantLyapunovVectors,
  onSolveEquilibrium,
  onCreateLimitCycle,
  onCreateEquilibriumBranch,
  onCreateBranchFromPoint,
  onCreateFoldCurveFromPoint,
  onCreateHopfCurveFromPoint,
}: SystemSettingsDialogProps) {
  if (!open || !system) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-settings-title"
      data-testid="system-settings-dialog"
    >
      <div className="dialog dialog--system-settings">
        <header className="dialog__header">
          <h2 id="system-settings-title">System Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close system settings"
            data-testid="close-system-settings"
          >
            ✕
          </button>
        </header>
        <div className="dialog__section dialog__section--flush">
          <InspectorDetailsPanel
            system={system}
            selectedNodeId={selectedNodeId}
            view="system"
            onRename={onRename}
            onToggleVisibility={onToggleVisibility}
            onUpdateRender={onUpdateRender}
            onUpdateScene={onUpdateScene}
            onUpdateBifurcationDiagram={onUpdateBifurcationDiagram}
            onUpdateSystem={onUpdateSystem}
            onValidateSystem={onValidateSystem}
            onRunOrbit={onRunOrbit}
            onComputeLyapunovExponents={onComputeLyapunovExponents}
            onComputeCovariantLyapunovVectors={onComputeCovariantLyapunovVectors}
            onSolveEquilibrium={onSolveEquilibrium}
            onCreateLimitCycle={onCreateLimitCycle}
            onCreateEquilibriumBranch={onCreateEquilibriumBranch}
            onCreateBranchFromPoint={onCreateBranchFromPoint}
            onCreateFoldCurveFromPoint={onCreateFoldCurveFromPoint}
            onCreateHopfCurveFromPoint={onCreateHopfCurveFromPoint}
          />
        </div>
      </div>
    </div>
  )
}
