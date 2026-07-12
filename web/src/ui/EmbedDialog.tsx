import { useMemo, useRef, useState } from 'react'
import type { System } from '../system/types'
import { EmbedViewportStack } from '../embed/EmbedViewportStack'
import type {
  EmbedHeaders,
  EmbedInteraction,
  EmbedSpecV1,
  EmbedTheme,
} from '../embed/types'
import { buildEmbedMarkup } from '../embed/markup'

function exportFilename(system: System): string {
  return `${system.name.replace(/\s+/g, '_') || 'fork_system'}.zip`
}

export function EmbedDialog({
  open,
  system,
  onClose,
  onExport,
}: {
  open: boolean
  system: System | null
  onClose: () => void
  onExport: () => void
}) {
  if (!open || !system) return null
  return <EmbedDialogContent system={system} onClose={onClose} onExport={onExport} />
}

function EmbedDialogContent({
  system,
  onClose,
  onExport,
}: {
  system: System
  onClose: () => void
  onExport: () => void
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
  const [source, setSource] = useState(`./${exportFilename(system)}`)
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultId ? [defaultId] : [])
  const [theme, setTheme] = useState<EmbedTheme>('auto')
  const [headers, setHeaders] = useState<EmbedHeaders>('auto')
  const [interaction, setInteraction] = useState<EmbedInteraction>('plot')
  const [width, setWidth] = useState('100%')
  const [height, setHeight] = useState(560)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const markupRef = useRef<HTMLTextAreaElement | null>(null)

  const spec: EmbedSpecV1 = {
    version: 1,
    viewportIds: selectedIds,
    theme,
    headers,
    interaction,
  }
  const markup = buildEmbedMarkup({ source, spec, width, height })

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
            <p>Create a read-only visualization backed by the exported system ZIP.</p>
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
              <span>Hosted ZIP path</span>
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                data-testid="embed-source"
              />
            </label>

            <div className="embed-dialog__grid">
              <label className="embed-dialog__field">
                <span>Theme</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value as EmbedTheme)}>
                  <option value="auto">Automatic</option>
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

            <h3>Embed code</h3>
            <textarea
              ref={markupRef}
              readOnly
              value={markup}
              rows={10}
              data-testid="embed-code"
            />
            <div className="embed-dialog__actions">
              <button onClick={onExport}>Download system ZIP</button>
              <button
                className="toolbar__button toolbar__button--primary"
                onClick={() => void copyMarkup()}
                disabled={selectedIds.length === 0}
              >
                Copy embed code
              </button>
            </div>
            {copyStatus ? <p role="status">{copyStatus}</p> : null}
          </section>

          <section className="embed-dialog__preview">
            <h3>Preview</h3>
            <div className="embed-dialog__preview-frame" style={{ height }}>
              {selectedIds.length > 0 ? (
                <EmbedViewportStack spec={spec} />
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
