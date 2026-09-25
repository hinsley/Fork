import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { fuzzyScore } from './shellFormat'

export type Command = {
  id: string
  label: string
  /** Right-aligned context: node type, "Create", "System", … */
  hint?: string
  icon?: IconName
  /** Extra text that matches but is not shown (aliases). */
  keywords?: string
  run: () => void
}

const MAX_RESULTS = 60

/** Keyboard-first jump list. Mount it only while open so each opening starts fresh. */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  const results = useMemo(() => {
    if (!query.trim()) return commands.slice(0, MAX_RESULTS)
    return commands
      .map((command) => ({
        command,
        score: Math.max(
          fuzzyScore(query, command.label),
          command.hint ? fuzzyScore(query, `${command.label} ${command.hint}`) - 1 : -1,
          command.keywords ? fuzzyScore(query, command.keywords) - 2 : -1
        ),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.command)
  }, [commands, query])

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (typeof item?.scrollIntoView === 'function') item.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: Command | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (results.length ? (index + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(results[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const activeId = results[active] ? `cmdk-${results[active].id}` : undefined

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="menu-surface cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        onKeyDown={onKeyDown}
      >
        <div className="cmdk__search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            placeholder="Go to object, create, switch system…"
            aria-label="Command"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={activeId}
            data-testid="command-palette-input"
          />
        </div>
        <ul className="cmdk__list" id="cmdk-list" role="listbox" ref={listRef}>
          {results.map((command, index) => (
            <li
              key={command.id}
              id={`cmdk-${command.id}`}
              role="option"
              aria-selected={index === active}
              data-index={index}
              className={`cmdk__item${index === active ? ' is-active' : ''}`}
              onMouseMove={() => setActive(index)}
              onClick={() => run(command)}
            >
              {command.icon ? <Icon name={command.icon} size={14} /> : <span className="cmdk__icon-gap" />}
              <span className="cmdk__label truncate">{command.label}</span>
              {command.hint ? <span className="cmdk__hint">{command.hint}</span> : null}
            </li>
          ))}
          {results.length === 0 ? <li className="cmdk__none faint">No matches</li> : null}
        </ul>
      </div>
    </div>
  )
}
