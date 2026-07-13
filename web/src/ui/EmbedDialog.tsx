import { useCallback, useMemo, useRef, useState } from 'react'
import type { System } from '../system/types'
import { EmbedCapturePreview } from '../embed/EmbedCapturePreview'
import type {
  EmbedHeaders,
  EmbedInteraction,
  EmbedTheme,
  StandaloneEmbed,
} from '../embed/types'
import { buildIframeMarkup } from '../embed/markup'
import { loadBundledDependencyPayload } from '../embed/standaloneDependencies'
import {
  buildBundledStandaloneHtml,
  buildStandaloneHtml,
  downloadStandaloneHtml,
  standaloneEmbedFilename,
} from '../embed/standaloneHtml'
import type { PlotlyFigureCaptureState } from '../viewports/plotly/figureCapture'

const DEFAULT_EXPORTED_VIEWPORT_HEIGHT = 360

export function EmbedDialog({
  open,
  system,
  appTheme,
  onClose,
}: {
  open: boolean
  system: System | null
  appTheme: EmbedTheme
  onClose: () => void
}) {
  if (!open || !system) return null
  return (
    <EmbedDialogContent
      key={system.id}
      system={system}
      appTheme={appTheme}
      onClose={onClose}
    />
  )
}

function EmbedDialogContent({
  system,
  appTheme,
  onClose,
}: {
  system: System
  appTheme: EmbedTheme
  onClose: () => void
}) {
  const viewportEntries = useMemo(() => {
    return system.rootIds.flatMap((id) => {
      const node = system.nodes[id]
      if (!node || (node.kind !== 'scene' && node.kind !== 'diagram' && node.kind !== 'analysis')) {
        return []
      }
      const type =
        node.kind === 'scene' ? 'State Space' : node.kind === 'diagram' ? 'Bifurcation' : 'Event Map'
      return [{ id, name: node.name, type }]
    })
  }, [system])
  const selected = system.ui.selectedNodeId
  const defaultId =
    selected && viewportEntries.some((entry) => entry.id === selected)
      ? selected
      : viewportEntries[0]?.id
  const filename = standaloneEmbedFilename(system.name)
  const [source, setSource] = useState(`./${filename}`)
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultId ? [defaultId] : [])
  const [theme, setTheme] = useState<EmbedTheme>(appTheme)
  const [headers, setHeaders] = useState<EmbedHeaders>('auto')
  const [interaction, setInteraction] = useState<EmbedInteraction>('plot')
  const [width, setWidth] = useState('100%')
  const [height, setHeight] = useState(560)
  const [bundleDependencies, setBundleDependencies] = useState(false)
  const [isBundling, setIsBundling] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [captures, setCaptures] = useState<Record<string, PlotlyFigureCaptureState>>({})
  const markupRef = useRef<HTMLTextAreaElement | null>(null)

  const markup = buildIframeMarkup({
    source,
    title: `${system.name} visualization`,
    width,
    height,
  })

  const handleFigureCapture = useCallback((state: PlotlyFigureCaptureState) => {
    setCaptures((current) => ({ ...current, [state.plotId]: state }))
  }, [])

  const selectedCaptures = selectedIds.map((id) => captures[id])
  const allReady =
    selectedIds.length > 0 &&
    selectedCaptures.every((capture) => capture?.status === 'ready')
  const captureErrors = selectedCaptures.filter(
    (capture): capture is Extract<PlotlyFigureCaptureState, { status: 'error' }> =>
      capture?.status === 'error'
  )

  const resetCaptures = () => setCaptures({})

  const buildExport = (): StandaloneEmbed | null => {
    if (!allReady) return null
    const byId = new Map(viewportEntries.map((entry) => [entry.id, entry]))
    return {
      title: `${system.name} visualization`,
      theme,
      headers,
      interaction,
      viewports: selectedIds.flatMap((id) => {
        const entry = byId.get(id)
        const capture = captures[id]
        if (!entry || capture?.status !== 'ready') return []
        return [
          {
            ...entry,
            height: system.ui.viewportHeights[id] ?? DEFAULT_EXPORTED_VIEWPORT_HEIGHT,
            figure: capture.figure,
            ...(capture.fallbackImage ? { fallbackImage: capture.fallbackImage } : {}),
          },
        ]
      }),
    }
  }

  const downloadHtml = async () => {
    const exported = buildExport()
    if (!exported) return
    setDownloadError(null)
    if (!bundleDependencies) {
      downloadStandaloneHtml(buildStandaloneHtml(exported), filename)
      return
    }
    setIsBundling(true)
    try {
      const dependencies = await loadBundledDependencyPayload()
      downloadStandaloneHtml(
        buildBundledStandaloneHtml(exported, dependencies),
        filename
      )
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : 'Unable to bundle embed dependencies.'
      )
    } finally {
      setIsBundling(false)
    }
  }

  const copyMarkup = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markup)
      } else {
        markupRef.current?.select()
        document.execCommand('copy')
      }
      setCopyStatus('Embed code copied.')
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : 'Unable to copy embed code.')
    }
  }

  return (
    <div className="dialog-backdrop embed-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog embed-dialog" data-testid="embed-dialog">
        <header className="dialog__header">
          <div>
            <h2>Embed {system.name}</h2>
            <p>Export selected viewports as a standalone Plotly HTML page.</p>
          </div>
          <button onClick={onClose} aria-label="Close embed dialog">✕</button>
        </header>

        <div className="embed-dialog__body">
          <section className="embed-dialog__settings">
            <h3>Viewports</h3>
            {viewportEntries.length === 0 ? (
              <p className="empty-state">Create a viewport before embedding this system.</p>
            ) : (
              <div className="embed-dialog__viewport-list">
                {viewportEntries.map((entry) => (
                  <label key={entry.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(entry.id)}
                      onChange={(event) => {
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, entry.id]
                            : current.filter((id) => id !== entry.id)
                        )
                      }}
                    />
                    <span>{entry.name}</span>
                    <small>{entry.type}</small>
                  </label>
                ))}
              </div>
            )}

            <label className="embed-dialog__field">
              <span>Hosted HTML path</span>
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                data-testid="embed-source"
              />
            </label>

            <div className="embed-dialog__grid">
              <label className="embed-dialog__field">
                <span>Theme</span>
                <select
                  value={theme}
                  onChange={(event) => {
                    setTheme(event.target.value as EmbedTheme)
                    resetCaptures()
                  }}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label className="embed-dialog__field">
                <span>Viewport headers</span>
                <select
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value as EmbedHeaders)}
                >
                  <option value="auto">Automatic</option>
                  <option value="show">Show</option>
                  <option value="hide">Hide</option>
                </select>
              </label>
              <label className="embed-dialog__field">
                <span>Interaction</span>
                <select
                  value={interaction}
                  onChange={(event) => setInteraction(event.target.value as EmbedInteraction)}
                >
                  <option value="plot">Pan, zoom, rotate, hover</option>
                  <option value="none">Static presentation</option>
                </select>
              </label>
              <label className="embed-dialog__field">
                <span>Width</span>
                <input value={width} onChange={(event) => setWidth(event.target.value)} />
              </label>
              <label className="embed-dialog__field">
                <span>Height (px)</span>
                <input
                  type="number"
                  min={240}
                  max={2400}
                  value={height}
                  onChange={(event) => setHeight(Math.max(240, Number(event.target.value) || 240))}
                />
              </label>
            </div>

            <label className="embed-dialog__bundle-option">
              <input
                type="checkbox"
                aria-label="Bundle dependencies (Experimental)"
                checked={bundleDependencies}
                onChange={(event) => {
                  setBundleDependencies(event.target.checked)
                  setDownloadError(null)
                  resetCaptures()
                }}
              />
              <span>
                <strong>Bundle dependencies (Experimental)</strong>
                <small>
                  Package dependencies, convert 2D GPU traces to SVG, and add static 3D
                  fallbacks for restrictive hosts.
                </small>
              </span>
            </label>

            <h3>Embed code</h3>
            <textarea
              ref={markupRef}
              readOnly
              value={markup}
              rows={8}
              data-testid="embed-code"
            />
            <div className="embed-dialog__actions">
              <button
                onClick={() => void downloadHtml()}
                disabled={!allReady || isBundling}
                data-testid="download-embed-html"
              >
                {isBundling ? 'Bundling dependencies…' : 'Download embed HTML'}
              </button>
              <button
                className="toolbar__button toolbar__button--primary"
                onClick={() => void copyMarkup()}
                disabled={selectedIds.length === 0}
              >
                Copy embed code
              </button>
            </div>
            {captureErrors.length > 0 ? (
              <p className="field-error" role="alert">
                {captureErrors.map((error) => error.message).join(' ')}
              </p>
            ) : selectedIds.length > 0 && !allReady ? (
              <p role="status">Preparing selected viewports…</p>
            ) : null}
            {downloadError ? (
              <p className="field-error" role="alert">{downloadError}</p>
            ) : null}
            {copyStatus ? <p role="status">{copyStatus}</p> : null}
          </section>

          <section className="embed-dialog__preview">
            <h3>Preview</h3>
            <div className="embed-dialog__preview-frame" style={{ height }}>
              {selectedIds.length > 0 ? (
                <EmbedCapturePreview
                  viewportIds={selectedIds}
                  theme={theme}
                  headers={headers}
                  interaction={interaction}
                  captureStaticFallbacks={bundleDependencies}
                  onFigureCapture={handleFigureCapture}
                />
              ) : (
                <div className="embed-status">Select at least one viewport.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
