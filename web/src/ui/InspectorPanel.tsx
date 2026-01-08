import { BranchViewer } from './BranchViewer'
import { InspectorDetailsPanel } from './InspectorDetailsPanel'
import type { BifurcationDiagram, System, Scene, SystemConfig, TreeNode } from '../system/types'
import type {
  EquilibriumSolveRequest,
  LimitCycleCreateRequest,
  OrbitRunRequest,
} from '../state/appState'

export type InspectorView = 'selection' | 'system' | 'branches'

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
  onSolveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  onCreateLimitCycle: (request: LimitCycleCreateRequest) => Promise<void>
  onSelectBranch: (id: string) => void
}

const VIEWS: Array<{ id: InspectorView; label: string }> = [
  { id: 'selection', label: 'Selection' },
  { id: 'system', label: 'System Settings' },
  { id: 'branches', label: 'Branches' },
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
  onSolveEquilibrium,
  onCreateLimitCycle,
  onSelectBranch,
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
        {view === 'branches' ? (
          <BranchViewer
            system={system}
            selectedNodeId={selectedNodeId}
            onSelectBranch={onSelectBranch}
          />
        ) : (
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
            onSolveEquilibrium={onSolveEquilibrium}
            onCreateLimitCycle={onCreateLimitCycle}
          />
        )}
      </div>
    </div>
  )
}
