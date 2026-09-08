import { useRef, useState } from 'react'
import type { SystemSummary } from '../system/types'
import { validateSystemName } from '../state/systemValidation'
import { normalizeDisplayName } from '../utils/naming'
import { confirmDelete } from './confirmDelete'
import './dialogs.css'

type SystemDialogProps = {
  open: boolean
  systems: SystemSummary[]
  onOpenSystem: (id: string) => void
  onExportSystem: (id: string) => void
  onCreateEmbed: (id: string) => void
  onCreateSystem: (name: string) => void
  onDeleteSystem: (id: string) => void
  onImportSystem: (file: File) => void
  onClose: () => void
}

export function SystemDialog({
  open,
  systems,
  onOpenSystem,
  onExportSystem,
  onCreateEmbed,
  onCreateSystem,
  onDeleteSystem,
  onImportSystem,
  onClose,
}: SystemDialogProps) {
  const [name, setName] = useState('NewSystem')
  const [nameError, setNameError] = useState<string | null>(null)
  const [exportTargetId, setExportTargetId] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const exportTarget = systems.find((system) => system.id === exportTargetId) ?? null

  const handleCreate = () => {
    const error = validateSystemName(name)
    setNameError(error)
    if (error) return
    onCreateSystem(normalizeDisplayName(name))
  }

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="systems-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog dialog--workspace dialog--systems">
        <header className="dialog__header">
          <h2 id="systems-title">Systems</h2>
          <button className="dialog__close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </header>
        <section className="dialog__section system-library__create">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handleCreate()
            }}
          >
            <label htmlFor="new-system-name">New system</label>
            <div className="dialog__row">
              <input
                id="new-system-name"
                value={name}
                onChange={(event) => {
                  const nextName = event.target.value
                  setName(nextName)
                  if (nameError) {
                    setNameError(validateSystemName(nextName))
                  }
                }}
                data-testid="system-name-input"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'new-system-name-error' : undefined}
              />
              <button className="dialog__primary" type="submit" data-testid="create-system">
                Create
              </button>
            </div>
          </form>
          {nameError ? <div className="field-error" id="new-system-name-error" role="alert">{nameError}</div> : null}
        </section>
        <section className="dialog__section system-library__saved">
          <div className="system-library__section-heading">
            <h3>Saved systems</h3>
            <button className="system-library__import" onClick={() => importInputRef.current?.click()}>
              Import ZIP
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,application/zip"
              aria-label="Import system archive"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImportSystem(file)
                event.currentTarget.value = ''
              }}
              data-testid="import-system"
            />
          </div>
          {systems.length === 0 ? (
            <p className="empty-state">No saved systems yet.</p>
          ) : (
            <div className="dialog__list">
              {systems.map((system) => (
                <div key={system.id} className="dialog__list-row">
                  <div className="dialog__list-title">
                    <button className="system-library__open" onClick={() => onOpenSystem(system.id)} title={`Open ${system.name}`}>
                      {system.name}
                    </button>
                    <span className="dialog__list-type">
                      {system.type === 'map' ? 'Map' : 'Flow'}
                    </span>
                  </div>
                  <div className="dialog__list-actions">
                    <button onClick={() => setExportTargetId(system.id)}>Export</button>
                    <button
                      className="system-library__delete"
                      title={`Delete ${system.name}`}
                      onClick={() => {
                        if (confirmDelete({ name: system.name, kind: 'System' })) {
                          onDeleteSystem(system.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {exportTarget ? (
        <div className="dialog-backdrop export-choice-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-choice-title">
          <div className="dialog dialog--workspace export-choice-dialog" data-testid="export-choice-dialog">
            <header className="dialog__header">
              <div>
                <h2 id="export-choice-title">Export {exportTarget.name}</h2>
              </div>
              <button className="dialog__close" onClick={() => setExportTargetId(null)} aria-label="Close export choices">
                ✕
              </button>
            </header>
            <div className="export-choice-dialog__options">
              <button
                className="export-choice-dialog__option"
                aria-label="Create embed"
                onClick={() => {
                  setExportTargetId(null)
                  onCreateEmbed(exportTarget.id)
                }}
              >
                <span className="export-choice-dialog__option-title">Create embed</span>
                <span>Selected viewports · HTML</span>
              </button>
              <button
                className="export-choice-dialog__option"
                aria-label="Download ZIP archive"
                onClick={() => {
                  setExportTargetId(null)
                  onExportSystem(exportTarget.id)
                }}
              >
                <span className="export-choice-dialog__option-title">Download ZIP</span>
                <span>Complete system · Reimportable</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
