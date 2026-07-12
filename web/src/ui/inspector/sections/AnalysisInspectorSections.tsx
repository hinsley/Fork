import type { InspectorSelectionController } from '../../InspectorDetailsPanel'

export function AnalysisInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    AnalysisViewportInspector,
    analysis,
    onUpdateAnalysisViewport,
    onValidateAnalysisExpression,
    system,
  } = scope
  return <>
{analysis ? (
            <AnalysisViewportInspector
              system={system}
              viewport={analysis}
              onUpdateAnalysisViewport={onUpdateAnalysisViewport ?? (() => undefined)}
              onValidateAnalysisExpression={onValidateAnalysisExpression}
            />
          ) : null}
  </>
}
