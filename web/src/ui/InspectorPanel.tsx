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
  HopfCurveContinuationRequest,
  LimitCycleHopfContinuationRequest,
  LimitCycleOrbitContinuationRequest,
  LimitCyclePDContinuationRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
} from '../state/appState'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from './branchPointSelection'

type InspectorPanelProps = {
  system: System
  selectedNodeId: string | null
  theme: 'light' | 'dark'
  branchPointSelection?: BranchPointSelection
  orbitPointSelection?: OrbitPointSelection
  limitCyclePointSelection?: LimitCyclePointSelection
  onBranchPointSelect?: (selection: BranchPointSelection) => void
  onOrbitPointSelect?: (selection: OrbitPointSelection) => void
  onLimitCyclePointSelect?: (selection: LimitCyclePointSelection) => void
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
  onCreateLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  onCreateLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  onCreateLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
}

export function InspectorPanel({
  system,
  selectedNodeId,
  theme,
  branchPointSelection,
  orbitPointSelection,
  limitCyclePointSelection,
  onBranchPointSelect,
  onOrbitPointSelect,
  onLimitCyclePointSelect,
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
  onCreateLimitCycleFromHopf,
  onCreateLimitCycleFromOrbit,
  onCreateLimitCycleFromPD,
}: InspectorPanelProps) {
  return (
    <div className="inspector">
      <div className="inspector__content">
        <InspectorDetailsPanel
          system={system}
          selectedNodeId={selectedNodeId}
          theme={theme}
          view="selection"
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
          onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
          onCreateLimitCycleFromOrbit={onCreateLimitCycleFromOrbit}
          onCreateLimitCycleFromPD={onCreateLimitCycleFromPD}
        />
      </div>
    </div>
  )
}
