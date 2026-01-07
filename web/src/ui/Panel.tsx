import type { ReactNode } from 'react'

export function Panel({
  title,
  open,
  onToggle,
  children,
  actions,
  testId,
  className,
  hideHeader = false,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
  actions?: ReactNode
  testId?: string
  className?: string
  hideHeader?: boolean
}) {
  return (
    <section
      className={`panel ${open ? 'panel--open' : 'panel--closed'} ${className ?? ''}`.trim()}
      data-testid={testId}
    >
      {hideHeader ? null : (
        <header className="panel__header">
          <button
            className="panel__toggle"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          >
            {open ? '▾' : '▸'}
          </button>
          <h2 className="panel__title">{title}</h2>
          <div className="panel__actions">{actions}</div>
        </header>
      )}
      {open ? <div className="panel__body">{children}</div> : null}
    </section>
  )
}
