import type { InspectorSelectionController } from '../../InspectorDetailsPanel'

export function LimitCycleInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    canRenderStoredCycle,
    isStoredCycleTarget,
    limitCycle,
    limitCycleRenderLabel,
    onSetLimitCycleRenderTarget,
    selectedNodeId,
  } = scope
  return <>
{limitCycle ? (
            <div
              className="inspector-section"
              data-testid="limit-cycle-render-target"
            >
              <h4 className="inspector-subheading">Rendered at</h4>
              <div className="inspector-data">{limitCycleRenderLabel}</div>
              {onSetLimitCycleRenderTarget && !isStoredCycleTarget && canRenderStoredCycle ? (
                <div className="inspector-row">
                  <button
                    type="button"
                    onClick={() =>
                      selectedNodeId
                        ? onSetLimitCycleRenderTarget(selectedNodeId, { type: 'object' })
                        : null
                    }
                    data-testid="limit-cycle-render-stored"
                  >
                    Render @ original parameters
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
  </>
}
