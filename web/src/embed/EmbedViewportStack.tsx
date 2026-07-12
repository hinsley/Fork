import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '../state/appContext'
import { ViewportPanel } from '../ui/ViewportPanel'
import type { EmbedSpecV1 } from './types'

function resolveTheme(theme: EmbedSpecV1['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function EmbedViewportStack({
  spec,
  applyDocumentTheme = false,
}: {
  spec: EmbedSpecV1
  applyDocumentTheme?: boolean
}) {
  const { state, actions } = useAppContext()
  const [resetRevision, setResetRevision] = useState(0)
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme(spec.theme))
  const system = state.system

  useEffect(() => {
    setTheme(resolveTheme(spec.theme))
    if (spec.theme !== 'auto' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setTheme(media.matches ? 'dark' : 'light')
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [spec.theme])

  useEffect(() => {
    if (!applyDocumentTheme) return
    document.documentElement.dataset.theme = theme
  }, [applyDocumentTheme, theme])

  const viewportState = useMemo(() => {
    if (!system) return { ids: [], error: null as string | null }
    const available = system.rootIds.filter((id) => {
      const kind = system.nodes[id]?.kind
      return kind === 'scene' || kind === 'diagram' || kind === 'analysis'
    })
    if (spec.viewportIds.length === 0) {
      return { ids: available.slice(0, 1), error: null }
    }
    const invalid = spec.viewportIds.filter((id) => !available.includes(id))
    if (invalid.length > 0) {
      return { ids: [], error: `Unknown viewport: ${invalid[0]}` }
    }
    const requested = new Set(spec.viewportIds)
    return { ids: available.filter((id) => requested.has(id)), error: null }
  }, [spec.viewportIds, system])

  if (!system) return null
  if (viewportState.error) {
    return <div className="embed-status embed-status--error">{viewportState.error}</div>
  }
  if (viewportState.ids.length === 0) {
    return <div className="embed-status embed-status--error">This system has no viewports to display.</div>
  }

  const showHeaders =
    spec.headers === 'show' || (spec.headers === 'auto' && viewportState.ids.length > 1)

  const enterFullscreen = async () => {
    setFullscreenError(null)
    try {
      if (!document.documentElement.requestFullscreen) {
        throw new Error('Fullscreen is not available in this browser.')
      }
      await document.documentElement.requestFullscreen()
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="embed-viewer" data-theme={theme} data-testid="embed-viewer">
      {spec.controls.length > 0 ? (
        <div className="embed-viewer__controls" aria-label="Viewer controls">
          {spec.controls.includes('reset') ? (
            <button onClick={() => setResetRevision((value) => value + 1)}>Reset view</button>
          ) : null}
          {spec.controls.includes('fullscreen') ? (
            <button onClick={() => void enterFullscreen()}>Fullscreen</button>
          ) : null}
        </div>
      ) : null}
      {fullscreenError ? (
        <div className="embed-viewer__notice" role="status">{fullscreenError}</div>
      ) : null}
      <div className="embed-viewer__content" key={resetRevision}>
        <ViewportPanel
          system={system}
          selectedNodeId={null}
          mode="viewer"
          viewportIds={viewportState.ids}
          showHeaders={showHeaders}
          interaction={spec.interaction}
          theme={theme}
          onSampleMap1DFunction={actions.sampleMap1DFunction}
          onComputeEventSeriesFromOrbit={actions.computeEventSeriesFromOrbit}
          onComputeEventSeriesFromSamples={actions.computeEventSeriesFromSamples}
          isoclineGeometryCache={state.isoclineGeometryCache}
        />
      </div>
    </div>
  )
}
