import { useState } from 'react'
import {
  formatSystemString,
  parseSystemString,
  type SystemStringDefinition,
} from '../../system/systemString'

type SystemStringToolsProps = {
  definition: SystemStringDefinition
  canCopy: boolean
  onImport: (definition: SystemStringDefinition) => void
}

export function SystemStringTools({
  definition,
  canCopy,
  onImport,
}: SystemStringToolsProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const openImport = () => {
    setInput('')
    setError(null)
    setStatus(null)
    setImportOpen(true)
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
        `Imported ${parsed.varNames.length} ${
          parsed.varNames.length === 1 ? 'variable' : 'variables'
        } and ${parsed.paramNames.length} ${
          parsed.paramNames.length === 1 ? 'parameter' : 'parameters'
        }. Apply changes to save.`
      )
    } catch (parseError) {
      setStatus(null)
      setError(parseError instanceof Error ? parseError.message : String(parseError))
    }
  }

  return (
    <section className="system-editor__string-tools" aria-label="System string tools">
      <div className="system-editor__string-tools-summary">
        <div className="system-editor__string-tools-copy">
          <span className="system-editor__eyebrow">Text tools</span>
          <strong>System string</strong>
          <span>Move variables, equations, and parameter values as plain text.</span>
        </div>
        <div className="system-editor__string-tools-actions">
          <button
            type="button"
            className="inspector-inline-button"
            onClick={openImport}
            aria-expanded={importOpen}
            data-testid="import-system-string"
          >
            Import system string
          </button>
          <button
            type="button"
            className="inspector-inline-button"
            onClick={() => void copySystemString()}
            disabled={!canCopy}
            title={canCopy ? undefined : 'Fix the current draft before copying it.'}
            data-testid="copy-system-string"
          >
            Copy system string
          </button>
        </div>
      </div>

      {importOpen ? (
        <div className="system-editor__string-import" data-testid="system-string-importer">
          <label htmlFor="system-string-input">
            <span>System definition</span>
            <textarea
              id="system-string-input"
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
          </label>
          <p>
            Use one <code>name&apos; = equation</code> or{' '}
            <code>name = numeric value</code> entry per line. Blank lines and surrounding
            spaces are ignored.
          </p>
          <div className="system-editor__string-import-actions">
            <button type="button" onClick={closeImport}>
              Cancel
            </button>
            <button
              type="button"
              className="system-editor__string-replace"
              onClick={replaceFromSystemString}
              data-testid="replace-from-system-string"
            >
              Replace variables and parameters
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
  )
}
