import type { System } from '../../system/types'
import { fmtCount } from '../../utils/format'

/** Inspector content when nothing is selected: the equations and what exists. */
export function NoSelectionInspector({ system }: { system: System }) {
  const { config } = system
  const isMap = config.type === 'map'
  const objectCount = Object.keys(system.index?.objects ?? system.objects).length
  const branchCount = Object.keys(system.index?.branches ?? system.branches).length
  const viewportCount =
    system.scenes.length + system.bifurcationDiagrams.length + system.analysisViewports.length
  return (
    <div className="inspector-empty" data-testid="inspector-no-selection">
      <div className="section-head">
        <span>{isMap ? 'Map' : 'Equations'}</span>
      </div>
      {config.equations.length > 0 ? (
        <ol className="inspector-equations" data-testid="inspector-equations">
          {config.equations.map((equation, index) => {
            const name = config.varNames[index] || `x${index + 1}`
            return (
              <li key={`${name}-${index}`}>
                <span className="inspector-equations__lhs">
                  {isMap ? `${name} ↦` : `${name}′ =`}
                </span>
                <span className="inspector-equations__rhs">{equation || '—'}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="faint">—</p>
      )}
      <div className="inspector-empty__counts" data-testid="inspector-counts">
        <span>
          <span className="num">{fmtCount(objectCount)}</span> objects
        </span>
        <span>
          <span className="num">{fmtCount(branchCount)}</span> branches
        </span>
        <span>
          <span className="num">{fmtCount(viewportCount)}</span> viewports
        </span>
      </div>
    </div>
  )
}
