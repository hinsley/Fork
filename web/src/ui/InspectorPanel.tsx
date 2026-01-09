import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type { BifurcationDiagram, System, Scene, SystemConfig, TreeNode } from '../system/types'
import type {
  BranchContinuationRequest,
  EquilibriumContinuationRequest,
  EquilibriumSolveRequest,
  LimitCycleCreateRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
} from '../state/appState'

export type InspectorView = 'selection' | 'system'

type InspectorPanelProps = {
  system: System
  selectedNodeId: string | null
  view: InspectorView
  onViewChange: (view: InspectorView) => void
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
}

const VIEWS: Array<{ id: InspectorView; label: string }> = [
  { id: 'selection', label: 'Selection' },
  { id: 'system', label: 'System Settings' },
]

export function InspectorPanel({
  system,
  selectedNodeId,
  view,
  onViewChange,
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
}: InspectorPanelProps) {
  return (
    <div className="inspector">
      <div className="inspector__menu" role="tablist" aria-label="Inspector views">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            className={`inspector__tab ${view === entry.id ? 'is-active' : ''}`}
            onClick={() => onViewChange(entry.id)}
            role="tab"
            aria-selected={view === entry.id}
            data-testid={`inspector-tab-${entry.id}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="inspector__content">
        <InspectorDetailsPanel
          system={system}
          selectedNodeId={selectedNodeId}
          view={view}
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
        />
      </div>
    </div>
  )
}
