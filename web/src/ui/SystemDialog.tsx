import { useState } from 'react'
import type { SystemSummary } from '../system/types'
import { validateSystemName } from '../state/systemValidation'
import { confirmDelete } from './confirmDelete'

type SystemDialogProps = {
  open: boolean
  systems: SystemSummary[]
  onOpenSystem: (id: string) => void
  onExportSystem: (id: string) => void
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
  onCreateSystem,
  onDeleteSystem,
  onImportSystem,
  onClose,
}: SystemDialogProps) {
  const [name, setName] = useState('NewSystem')
  const [nameError, setNameError] = useState<string | null>(null)

  const handleCreate = () => {
    const error = validateSystemName(name)
    setNameError(error)
    if (error) return
    onCreateSystem(name)
  }

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <header className="dialog__header">
          <h2>Systems</h2>
          <button onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </header>
        <section className="dialog__section">
          <h3>Create New</h3>
          <div className="dialog__row">
            <input
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
            />
            <button onClick={handleCreate} data-testid="create-system">
              Create
            </button>
          </div>
          {nameError ? <div className="field-error">{nameError}</div> : null}
        </section>
        <section className="dialog__section">
          <h3>Open Existing</h3>
          {systems.length === 0 ? (
            <p className="empty-state">No saved systems yet.</p>
          ) : (
            <div className="dialog__list">
              {systems.map((system) => (
                <div key={system.id} className="dialog__list-row">
                  <div className="dialog__list-title">
                    <button onClick={() => onOpenSystem(system.id)}>{system.name}</button>
                    <span className="dialog__list-type">
                      {system.type === 'map' ? 'Map' : 'Flow'}
                    </span>
                  </div>
                  <div className="dialog__list-actions">
                    <button onClick={() => onExportSystem(system.id)}>Export</button>
                    <button
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
        <section className="dialog__section">
          <h3>Import</h3>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onImportSystem(file)
              event.currentTarget.value = ''
            }}
            data-testid="import-system"
          />
        </section>
      </div>
    </div>
  )
}
