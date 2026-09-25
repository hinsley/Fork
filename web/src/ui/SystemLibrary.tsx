import { useEffect, useRef, useState } from 'react'
import type { SystemSummary } from '../system/types'
import { validateSystemName } from '../state/systemValidation'
import { normalizeDisplayName } from '../utils/naming'
import { fmtRelativeTime } from '../utils/format'
import { confirmDelete } from './confirmDelete'
import { Icon } from './Icon'

export type SystemLibraryActions = {
  onOpenSystem: (id: string) => void
  onExportSystem: (id: string) => void
  onCreateEmbed: (id: string) => void
  onCreateSystem: (name: string) => void
  onDeleteSystem: (id: string) => void
  onImportSystem: (file: File) => void
}

type SystemLibraryProps = SystemLibraryActions & {
  systems: SystemSummary[]
  activeSystemId?: string | null
  autoFocusFirst?: boolean
}

function systemMeta(system: SystemSummary) {
  const dimension = system.varNames?.length
  return {
    type: system.type === 'map' ? 'Map' : 'Flow',
    dimension: dimension ? `${dimension}D` : null,
    params: system.paramNames?.length ? system.paramNames.join(' ') : null,
  }
}

const DEFAULT_SYSTEM_NAME = 'NewSystem'

function nameKey(name: string): string {
  return normalizeDisplayName(name).toLowerCase()
}

/** Inline error for a name already used by a saved system (case-insensitive). */
function duplicateSystemNameError(name: string, systems: SystemSummary[]): string | null {
  const key = nameKey(name)
  const existing = systems.find((system) => nameKey(system.name) === key)
  return existing ? `"${existing.name}" already exists.` : null
}

/** `NewSystem`, then `NewSystem_2`, `NewSystem_3`, … like default object names. */
function defaultSystemName(systems: SystemSummary[]): string {
  const taken = new Set(systems.map((system) => nameKey(system.name)))
  if (!taken.has(nameKey(DEFAULT_SYSTEM_NAME))) return DEFAULT_SYSTEM_NAME
  let index = 2
  while (taken.has(nameKey(`${DEFAULT_SYSTEM_NAME}_${index}`))) index += 1
  return `${DEFAULT_SYSTEM_NAME}_${index}`
}

/** Create/import bar plus one dense row per saved system. Used by home and the Systems dialog. */
export function SystemLibrary({
  systems,
  activeSystemId = null,
  autoFocusFirst = false,
  onOpenSystem,
  onExportSystem,
  onCreateEmbed,
  onCreateSystem,
  onDeleteSystem,
  onImportSystem,
}: SystemLibraryProps) {
  // null = untouched: show a default that never collides with a saved system.
  const [typedName, setTypedName] = useState<string | null>(null)
  const name = typedName ?? defaultSystemName(systems)
  const [nameError, setNameError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!autoFocusFirst) return
    listRef.current?.querySelector<HTMLButtonElement>('.sys-lib__open')?.focus()
  }, [autoFocusFirst])

  const nameErrorFor = (value: string) =>
    validateSystemName(value) ?? duplicateSystemNameError(value, systems)

  const handleCreate = () => {
    const error = nameErrorFor(name)
    setNameError(error)
    if (error) return
    setTypedName(null)
    onCreateSystem(normalizeDisplayName(name))
  }

  const moveFocus = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('.sys-lib__open') ?? []
    )
    const index = buttons.findIndex((button) => button === document.activeElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus()
  }

  return (
    <div className="sys-lib" data-testid="system-library">
      <form
        className="sys-lib__bar"
        onSubmit={(event) => {
          event.preventDefault()
          handleCreate()
        }}
      >
        <input
          className="sys-lib__name-input"
          value={name}
          aria-label="New system name"
          onChange={(event) => {
            const nextName = event.target.value
            setTypedName(nextName)
            if (nameError) setNameError(nameErrorFor(nextName))
          }}
          data-testid="system-name-input"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? 'new-system-name-error' : undefined}
        />
        <button className="btn btn--primary" type="submit" data-testid="create-system">
          <Icon name="plus" size={14} />
          Create
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => importInputRef.current?.click()}
          title="Import a system archive (.zip)"
        >
          <Icon name="upload" size={14} />
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
      </form>
      {nameError ? (
        <div className="sys-lib__error" id="new-system-name-error" role="alert">
          {nameError}
        </div>
      ) : null}
      {systems.length > 0 ? (
        <ul className="sys-lib__list" ref={listRef} onKeyDown={moveFocus}>
          {systems.map((system) => {
            const meta = systemMeta(system)
            const isActive = system.id === activeSystemId
            return (
              <li
                key={system.id}
                className={`dialog__list-row sys-lib__row${isActive ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="sys-lib__open"
                  onClick={() => onOpenSystem(system.id)}
                  aria-label={system.name}
                  aria-current={isActive ? 'true' : undefined}
                  title={`Open ${system.name}`}
                >
                  <span className="sys-lib__name truncate">{system.name}</span>
                  <span className="sys-lib__type">{meta.type}</span>
                  <span className="sys-lib__dim num">{meta.dimension ?? ''}</span>
                  <span className="sys-lib__params truncate" title={meta.params ?? undefined}>
                    {meta.params ?? ''}
                  </span>
                  <time className="sys-lib__time" dateTime={system.updatedAt}>
                    {fmtRelativeTime(system.updatedAt, now)}
                  </time>
                </button>
                <div className="sys-lib__actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Download ZIP archive"
                    title="Download ZIP archive"
                    onClick={() => onExportSystem(system.id)}
                  >
                    <Icon name="download" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Create embed"
                    title="Create embed"
                    onClick={() => onCreateEmbed(system.id)}
                  >
                    <Icon name="code" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn sys-lib__delete"
                    aria-label="Delete"
                    title={`Delete ${system.name}`}
                    onClick={() => {
                      if (confirmDelete({ name: system.name, kind: 'System' })) {
                        onDeleteSystem(system.id)
                      }
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
