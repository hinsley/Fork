import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type {
  BifurcationDiagram,
  LimitCycleRenderTarget,
  Scene,
  System,
  SystemConfig,
  TreeNode,
} from '../system/types'
import type {
  BranchContinuationRequest,
  BranchExtensionRequest,
  EquilibriumContinuationRequest,
  EquilibriumSolveRequest,
  FoldCurveContinuationRequest,
  HomoclinicFromHomoclinicRequest,
  HomoclinicFromHomotopySaddleRequest,
  HomoclinicFromLargeCycleRequest,
  HopfCurveContinuationRequest,
  HomotopySaddleFromEquilibriumRequest,
  MapNSCurveContinuationRequest,
  LimitCycleHopfContinuationRequest,
  LimitCycleOrbitContinuationRequest,
  LimitCyclePDContinuationRequest,
  MapCyclePDContinuationRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
} from '../state/appState'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from './branchPointSelection'

type SystemSettingsDialogProps = {
  open: boolean
  system: System | null
  selectedNodeId: string | null
  theme: 'light' | 'dark'
  branchPointSelection?: BranchPointSelection
  orbitPointSelection?: OrbitPointSelection
  limitCyclePointSelection?: LimitCyclePointSelection
  onBranchPointSelect?: (selection: BranchPointSelection) => void
  onOrbitPointSelect?: (selection: OrbitPointSelection) => void
  onLimitCyclePointSelect?: (selection: LimitCyclePointSelection) => void
  onClose: () => void
  onRename: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onUpdateRender: (id: string, render: Partial<TreeNode['render']>) => void
  onUpdateObjectParams: (id: string, params: number[] | null) => void
  onUpdateScene: (id: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  onUpdateBifurcationDiagram: (
    id: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  onSetLimitCycleRenderTarget?: (
    objectId: string,
    target: LimitCycleRenderTarget | null
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
  onCreateEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  onCreateBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  onExtendBranch: (request: BranchExtensionRequest) => Promise<void>
  onCreateFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  onCreateHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  onCreateNSCurveFromPoint: (request: MapNSCurveContinuationRequest) => Promise<void>
  onCreateLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  onCreateLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  onCreateCycleFromPD: (request: MapCyclePDContinuationRequest) => Promise<void>
  onCreateLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
  onCreateHomoclinicFromLargeCycle?: (
    request: HomoclinicFromLargeCycleRequest
  ) => Promise<void>
  onCreateHomoclinicFromHomoclinic?: (
    request: HomoclinicFromHomoclinicRequest
  ) => Promise<void>
  onCreateHomotopySaddleFromEquilibrium?: (
    request: HomotopySaddleFromEquilibriumRequest
  ) => Promise<void>
  onCreateHomoclinicFromHomotopySaddle?: (
    request: HomoclinicFromHomotopySaddleRequest
  ) => Promise<void>
}

export function SystemSettingsDialog({
  open,
  system,
  selectedNodeId,
  theme,
  branchPointSelection,
  orbitPointSelection,
  limitCyclePointSelection,
  onBranchPointSelect,
  onOrbitPointSelect,
  onLimitCyclePointSelect,
  onClose,
  onRename,
  onToggleVisibility,
  onUpdateRender,
  onUpdateObjectParams,
  onUpdateScene,
  onUpdateBifurcationDiagram,
  onSetLimitCycleRenderTarget,
  onUpdateSystem,
  onValidateSystem,
  onRunOrbit,
  onComputeLyapunovExponents,
  onComputeCovariantLyapunovVectors,
  onSolveEquilibrium,
  onCreateEquilibriumBranch,
  onCreateBranchFromPoint,
  onExtendBranch,
  onCreateFoldCurveFromPoint,
  onCreateHopfCurveFromPoint,
  onCreateNSCurveFromPoint,
  onCreateLimitCycleFromHopf,
  onCreateLimitCycleFromOrbit,
  onCreateCycleFromPD,
  onCreateLimitCycleFromPD,
  onCreateHomoclinicFromLargeCycle,
  onCreateHomoclinicFromHomoclinic,
  onCreateHomotopySaddleFromEquilibrium,
  onCreateHomoclinicFromHomotopySaddle,
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
            theme={theme}
            branchPointSelection={branchPointSelection}
            orbitPointSelection={orbitPointSelection}
            limitCyclePointSelection={limitCyclePointSelection}
            onBranchPointSelect={onBranchPointSelect}
            onOrbitPointSelect={onOrbitPointSelect}
            onLimitCyclePointSelect={onLimitCyclePointSelect}
            onRename={onRename}
            onToggleVisibility={onToggleVisibility}
            onUpdateRender={onUpdateRender}
            onUpdateObjectParams={onUpdateObjectParams}
            onUpdateScene={onUpdateScene}
            onUpdateBifurcationDiagram={onUpdateBifurcationDiagram}
            onSetLimitCycleRenderTarget={onSetLimitCycleRenderTarget}
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
            onCreateNSCurveFromPoint={onCreateNSCurveFromPoint}
            onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
            onCreateLimitCycleFromOrbit={onCreateLimitCycleFromOrbit}
            onCreateCycleFromPD={onCreateCycleFromPD}
            onCreateLimitCycleFromPD={onCreateLimitCycleFromPD}
            onCreateHomoclinicFromLargeCycle={onCreateHomoclinicFromLargeCycle}
            onCreateHomoclinicFromHomoclinic={onCreateHomoclinicFromHomoclinic}
            onCreateHomotopySaddleFromEquilibrium={onCreateHomotopySaddleFromEquilibrium}
            onCreateHomoclinicFromHomotopySaddle={onCreateHomoclinicFromHomotopySaddle}
          />
        </div>
      </div>
    </div>
  )
}
