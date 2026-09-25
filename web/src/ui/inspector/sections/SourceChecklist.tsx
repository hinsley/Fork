import type { ReactNode } from 'react'
import { Icon } from '../../Icon'

export type SourceChecklistEntry = {
  id: string
  name: string
  meta: ReactNode
}

export type SourceChecklistMode = {
  value: 'all' | 'selection'
  onChange: (value: 'all' | 'selection') => void
  testId: string
}

/**
 * Checkbox list of viewport sources (scene items, diagram branches, event-map
 * sources). With nothing checked explicitly the viewport shows an implicit
 * set (all visible, or the tree selection); those rows render as checked but
 * dimmed, and toggling one turns the implicit set into an explicit list.
 */
export function SourceChecklist({
  title,
  entries,
  selectedIds,
  implicitIds,
  onChange,
  mode,
  search,
  chipTestId,
}: {
  title: string
  /** Rows to show, explicitly checked entries first. */
  entries: SourceChecklistEntry[]
  selectedIds: string[]
  /** Entries included when nothing is checked (null: depends on the tree selection). */
  implicitIds: string[] | null
  onChange: (next: string[]) => void
  mode?: SourceChecklistMode
  search: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    ariaLabel: string
    testId?: string
  }
  chipTestId: string
}) {
  const explicit = selectedIds.length > 0
  const selectedSet = new Set(selectedIds)
  const implicitSet = new Set(explicit ? [] : implicitIds ?? [])
  const toggle = (id: string) => {
    if (explicit) {
      onChange(
        selectedSet.has(id) ? selectedIds.filter((entry) => entry !== id) : [...selectedIds, id]
      )
      return
    }
    const base = implicitIds ?? []
    onChange(implicitSet.has(id) ? base.filter((entry) => entry !== id) : [...base, id])
  }
  return (
    <div className="inspector-subsection source-checklist">
      <h4 className="section-head source-checklist__head">
        <span>{title}</span>
        {explicit ? (
          <span className="source-checklist__state">
            <span className="chip" data-testid={chipTestId}>
              {selectedIds.length} checked
            </span>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={() => onChange([])}
              title={mode?.value === 'selection' ? 'Uncheck all (show the tree selection)' : 'Uncheck all (show all visible)'}
              aria-label="Uncheck all"
              data-testid={`${chipTestId}-clear`}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ) : mode ? (
          <select
            className="source-checklist__mode"
            value={mode.value}
            onChange={(event) => mode.onChange(event.target.value as 'all' | 'selection')}
            aria-label={`${title} shown when none are checked`}
            data-testid={mode.testId}
          >
            <option value="all">all visible</option>
            <option value="selection">tree selection</option>
          </select>
        ) : (
          <span className="chip" data-testid={chipTestId}>
            all visible
          </span>
        )}
      </h4>
      <input
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder}
        aria-label={search.ariaLabel}
        data-testid={search.testId}
      />
      {entries.length > 0 ? (
        <div className="scene-object-list">
          {entries.map((entry) => {
            const implicit = implicitSet.has(entry.id)
            return (
              <label
                key={entry.id}
                className={`scene-object-row${implicit ? ' scene-object-row--implicit' : ''}`}
                title={implicit ? 'Shown (nothing checked)' : undefined}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(entry.id) || implicit}
                  onChange={() => toggle(entry.id)}
                />
                <span className="scene-object-row__name">{entry.name}</span>
                <span className="scene-object-row__meta">{entry.meta}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
