import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatSystemString,
  parseSystemString,
  type SystemStringDefinition,
} from '../../system/systemString'
import { Icon } from '../Icon'

type SystemStringToolsProps = {
  definition: SystemStringDefinition
  canCopy: boolean
  onImport: (definition: SystemStringDefinition) => void
  /** When given, the Import/Copy buttons render into this element (e.g. a dialog header). */
  actionsContainer?: HTMLElement | null
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function SystemStringTools({
  definition,
  canCopy,
  onImport,
  actionsContainer,
}: SystemStringToolsProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const toggleImport = () => {
    setInput('')
    setError(null)
    setStatus(null)
    setImportOpen((open) => !open)
  }

  const closeImport = () => {
    setInput('')
    setError(null)
    setImportOpen(false)
  }

  const copySystemString = async () => {
    setError(null)
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.')
      }
      await navigator.clipboard.writeText(formatSystemString(definition))
      setStatus('System string copied.')
    } catch (copyError) {
      setStatus(null)
      setError(copyError instanceof Error ? copyError.message : String(copyError))
    }
  }

  const replaceFromSystemString = () => {
    try {
      const parsed = parseSystemString(input)
      onImport(parsed)
      setInput('')
      setError(null)
      setImportOpen(false)
      setStatus(
        `Imported ${plural(parsed.varNames.length, 'variable')}, ${plural(
          parsed.paramNames.length,
          'parameter'
        )}.`
      )
    } catch (parseError) {
      setStatus(null)
      setError(parseError instanceof Error ? parseError.message : String(parseError))
    }
  }

  const actions = (
    <span className="system-string-actions">
      <button
        type="button"
        className={`icon-btn${importOpen ? ' is-active' : ''}`}
        onClick={toggleImport}
        aria-expanded={importOpen}
        aria-label="Import system string"
        title="Import from text (x' = …, p = …)"
        data-testid="import-system-string"
      >
        <Icon name="upload" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => void copySystemString()}
        disabled={!canCopy}
        aria-label="Copy system string"
        title={canCopy ? 'Copy as text' : 'Fix the draft before copying.'}
        data-testid="copy-system-string"
      >
        <Icon name="copy" />
      </button>
    </span>
  )

  const hasBody = importOpen || Boolean(error) || Boolean(status)

  return (
    <>
      {actionsContainer ? createPortal(actions, actionsContainer) : null}
      {!actionsContainer || hasBody ? (
        <section className="system-editor__string-tools" aria-label="System string tools">
          {actionsContainer ? null : actions}
          {importOpen ? (
            <div className="system-editor__string-import" data-testid="system-string-importer">
              <textarea
                id="system-string-input"
                aria-label="System definition"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  setError(null)
                }}
                placeholder={"x' = sigma * (y - x)\ny' = x - y\nsigma = 10"}
                spellCheck={false}
                autoFocus
                data-testid="system-string-input"
              />
              <div className="system-editor__string-import-actions">
                <button type="button" className="btn btn--ghost" onClick={closeImport}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={replaceFromSystemString}
                  title="Replace variables and parameters"
                  data-testid="replace-from-system-string"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="field-error system-editor__string-feedback" role="alert">
              {error}
            </div>
          ) : null}
          {status ? (
            <div className="system-editor__string-feedback" role="status">
              {status}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
