import type { System } from '../system/types'

type BranchViewerProps = {
  system: System
  selectedNodeId: string | null
  onSelectBranch: (id: string) => void
}

export function BranchViewer({ system, selectedNodeId, onSelectBranch }: BranchViewerProps) {
  const branches = Object.entries(system.branches)

  return (
    <div className="branch-viewer" data-testid="branch-viewer-panel">
      {branches.length === 0 ? (
        <p className="empty-state">No branches in this system.</p>
      ) : (
        <div className="branch-viewer__list">
          {branches.map(([id, branch]) => {
            const isSelected = id === selectedNodeId
            return (
              <button
                key={id}
                className={`branch-viewer__item ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onSelectBranch(id)}
                data-testid={`branch-row-${id}`}
              >
                <span>{branch.name}</span>
                <span>{branch.branchType}</span>
                <span>{branch.data.points.length} pts</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
