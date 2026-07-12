import { useAppContext } from '../state/appContext'
import { ViewportPanel } from '../ui/ViewportPanel'
import type { PlotlyFigureCaptureState } from '../viewports/plotly/figureCapture'
import type { EmbedHeaders, EmbedInteraction, EmbedTheme } from './types'

export function EmbedCapturePreview({
  viewportIds,
  theme,
  headers,
  interaction,
  onFigureCapture,
}: {
  viewportIds: string[]
  theme: EmbedTheme
  headers: EmbedHeaders
  interaction: EmbedInteraction
  onFigureCapture: (state: PlotlyFigureCaptureState) => void
}) {
  const { state, actions } = useAppContext()
  const system = state.system
  if (!system) return null

  const showHeaders =
    headers === 'show' || (headers === 'auto' && viewportIds.length > 1)

  return (
    <div className="embed-viewer" data-theme={theme} data-testid="embed-preview-viewer">
      <div className="embed-viewer__content">
        <ViewportPanel
          system={system}
          selectedNodeId={null}
          mode="viewer"
          viewportIds={viewportIds}
          showHeaders={showHeaders}
          interaction={interaction}
          theme={theme}
          onSampleMap1DFunction={actions.sampleMap1DFunction}
          onComputeEventSeriesFromOrbit={actions.computeEventSeriesFromOrbit}
          onComputeEventSeriesFromSamples={actions.computeEventSeriesFromSamples}
          isoclineGeometryCache={state.isoclineGeometryCache}
          onFigureCapture={onFigureCapture}
        />
      </div>
    </div>
  )
}
