import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type { BifurcationDiagram, Scene, System, SystemConfig, TreeNode } from '../system/types'
import type {
  BranchContinuationRequest,
  BranchExtensionRequest,
  EquilibriumContinuationRequest,
  EquilibriumSolveRequest,
  FoldCurveContinuationRequest,
  HopfCurveContinuationRequest,
  LimitCycleCreateRequest,
  LimitCycleHopfContinuationRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
} from '../state/appState'

type InspectorPanelProps = {
  system: System
  selectedNodeId: string | null
  theme: 'light' | 'dark'
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
  onExtendBranch: (request: BranchExtensionRequest) => Promise<void>
  onCreateFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  onCreateHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  onCreateLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
}

export function InspectorPanel({
  system,
  selectedNodeId,
  theme,
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
  onExtendBranch,
  onCreateFoldCurveFromPoint,
  onCreateHopfCurveFromPoint,
  onCreateLimitCycleFromHopf,
}: InspectorPanelProps) {
  return (
    <div className="inspector">
      <div className="inspector__content">
        <InspectorDetailsPanel
          system={system}
          selectedNodeId={selectedNodeId}
          theme={theme}
          view="selection"
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
          onExtendBranch={onExtendBranch}
          onCreateFoldCurveFromPoint={onCreateFoldCurveFromPoint}
          onCreateHopfCurveFromPoint={onCreateHopfCurveFromPoint}
          onCreateLimitCycleFromHopf={onCreateLimitCycleFromHopf}
        />
      </div>
    </div>
  )
}
