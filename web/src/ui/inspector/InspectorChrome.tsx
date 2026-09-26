import {
  Fragment,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { Icon } from '../Icon'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'

export type ChipTone =
  | 'stable'
  | 'unstable'
  | 'saddle'
  | 'nonhyperbolic'
  | 'unknown'
  | 'muted'
  | 'warning'
  | 'neutral'

export type HeaderChip = {
  label: string
  tone?: ChipTone
  title?: string
  testId?: string
}

export type HeaderPanelId = 'appearance' | 'parameters' | 'frozen-variables'

export type HeaderPanel = {
  id: HeaderPanelId
  label: string
  icon: ReactNode
  /** Small badge on the icon (e.g. frozen variable count). */
  badge?: ReactNode
  /** Highlights the icon when the object deviates from the defaults. */
  highlighted?: boolean
  content: ReactNode
}

/** Closes a floating surface on outside pointer down or Escape. */
function useDismiss(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>
) {
  const onCloseRef = useRef(onClose)
  const refsRef = useRef(refs)
  useEffect(() => {
    onCloseRef.current = onClose
    refsRef.current = refs
  })
  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return
      onCloseRef.current()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])
}

export function SnowflakeIcon() {
  return (
    <svg className="ui-icon" width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
    </svg>
  )
}

export function StatusChip({ chip }: { chip: HeaderChip }) {
  const tone = chip.tone && chip.tone !== 'neutral' ? ` chip--${chip.tone}` : ''
  return (
    <span
      className={`chip${tone}`}
      title={chip.title}
      data-testid={chip.testId ?? 'inspector-status-chip'}
    >
      {chip.label}
    </span>
  )
}

export type EntityHeaderProps = {
  name: string
  onNameChange: (value: string) => void
  onNameCommit: () => void
  onNameCancel: () => void
  nameTestId?: string
  /** Type label, shown as a tooltip on the name. */
  typeLabel?: string
  chip?: HeaderChip | null
  /** Row 2: a verbatim meta string (branches) or a list of short parts (objects). */
  detail?: string | string[] | null
  visible?: boolean
  onToggleVisibility?: () => void
  panels?: HeaderPanel[]
}

export function EntityHeader({
  name,
  onNameChange,
  onNameCommit,
  onNameCancel,
  nameTestId = 'inspector-name',
  typeLabel,
  chip,
  detail,
  visible,
  onToggleVisibility,
  panels = [],
}: EntityHeaderProps) {
  const [openPanel, setOpenPanel] = useState<HeaderPanelId | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  useDismiss(openPanel !== null, () => setOpenPanel(null), [toolsRef, popoverRef])
  const activePanel = panels.find((panel) => panel.id === openPanel) ?? null
  const detailParts = Array.isArray(detail) ? detail.filter(Boolean) : null

  return (
    <header className="inspector-entity-header" data-testid="inspector-entity-header">
      <div className="inspector-entity-header__row">
        <label className="inspector-entity-header__name" title={typeLabel}>
          <span className="inspector-entity-header__name-label">Name</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onBlur={onNameCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onNameCancel()
                event.currentTarget.blur()
              }
            }}
            spellCheck={false}
            data-testid={nameTestId}
          />
        </label>
        {chip ? <StatusChip chip={chip} /> : null}
        <div className="inspector-entity-header__tools" ref={toolsRef}>
          {onToggleVisibility ? (
            <button
              type="button"
              className="icon-btn"
              onClick={onToggleVisibility}
              aria-pressed={visible === false}
              aria-label={visible === false ? 'Show' : 'Hide'}
              title={visible === false ? 'Hidden — show' : 'Visible — hide'}
              data-testid="inspector-visibility"
              data-visible={visible === false ? 'false' : 'true'}
            >
              <Icon name={visible === false ? 'eye-off' : 'eye'} />
            </button>
          ) : null}
          {panels.map((panel) => {
            const open = openPanel === panel.id
            return (
              <button
                key={panel.id}
                type="button"
                className={`icon-btn inspector-entity-header__tool${open ? ' is-active' : ''}${
                  panel.highlighted ? ' is-highlighted' : ''
                }`}
                onClick={() => setOpenPanel((current) => (current === panel.id ? null : panel.id))}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={panel.label}
                title={panel.label}
                data-testid={`action-${panel.id}-toggle`}
              >
                {panel.icon}
                {panel.badge !== undefined && panel.badge !== null ? (
                  <span className="inspector-entity-header__badge">{panel.badge}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      {detailParts ? (
        detailParts.length > 0 ? (
          <div className="inspector-entity-header__meta" data-testid="inspector-meta">
            {detailParts.map((part, index) => (
              <span key={`${part}-${index}`}>{part}</span>
            ))}
          </div>
        ) : null
      ) : detail ? (
        <div className="inspector-entity-header__meta" data-testid="inspector-meta">
          {detail}
        </div>
      ) : null}
      {panels.length > 0 ? (
        <div className="inspector-popover-layer" ref={popoverRef}>
          {panels.map((panel) => (
            // Closed panels stay mounted (hidden) so their controls keep stable identities.
            <div
              key={panel.id}
              className="inspector-popover menu-surface"
              role="dialog"
              aria-label={panel.label}
              hidden={panel !== activePanel}
              data-testid={`inspector-${panel.id}-popover`}
            >
              <div className="inspector-popover__head">
                <span className="section-head">{panel.label}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  onClick={() => setOpenPanel(null)}
                  aria-label="Close"
                  title="Close"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="inspector-popover__body">{panel.content}</div>
            </div>
          ))}
        </div>
      ) : null}
    </header>
  )
}

const ACTION_GROUPS = [
  'Configure',
  'Inspect',
  'Compute',
  'Continuation',
  'Manifolds',
  'Bifurcations',
] as const

/**
 * Collapsible action groups (Compute, Continuation, …). Each row opens its
 * workflow page; every row keeps the `action-<workflowId>` test id.
 */
export function ActionBar({ entries }: { entries: WorkflowActionEntry[] }) {
  const focus = useWorkflowFocus()
  const listId = useId()
  if (!focus || focus.activeWorkflow || entries.length === 0) return null
  return (
    <section className="inspector-actions" data-testid="inspector-actions">
      {ACTION_GROUPS.map((group) => {
        const groupEntries = entries.filter((entry) => entry.group === group)
        if (groupEntries.length === 0) return null
        const expanded = focus.collapsedActionGroups[group] === false
        const contentId = `${listId}-${group}`
        return (
          <div className="inspector-actions__group" key={group}>
            <h4>
              <button
                type="button"
                className="inspector-actions__toggle"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => focus.toggleActionGroup(group)}
              >
                <span className="inspector-actions__chevron" aria-hidden="true">›</span>
                {group}
              </button>
            </h4>
            <div className="inspector-actions__items" id={contentId} hidden={!expanded}>
              {groupEntries.map((entry) => (
                <button
                  type="button"
                  className="inspector-action-row"
                  onClick={() => focus.openWorkflow(entry.id)}
                  disabled={entry.disabled}
                  title={entry.description}
                  aria-description={entry.description}
                  data-testid={`action-${entry.id}`}
                  key={entry.id}
                >
                  <span>
                    <strong className="inspector-action-row__title">
                      <span>{entry.label}</span>
                      {entry.tag ? <span className="tree-node__tag">{entry.tag}</span> : null}
                    </strong>
                    {entry.disabled ? <small>{entry.description}</small> : null}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** Key/value grid from rows; values render in tabular mono. */
export function KeyValues({
  rows,
  columns = 1,
  testId,
}: {
  rows: Array<{ label: ReactNode; value: ReactNode; title?: string; testId?: string } | null | false>
  columns?: 1 | 2
  testId?: string
}) {
  const visible = rows.filter(Boolean) as Array<{
    label: ReactNode
    value: ReactNode
    title?: string
    testId?: string
  }>
  if (visible.length === 0) return null
  return (
    <dl className={`kv${columns === 2 ? ' kv--2' : ''}`} data-testid={testId}>
      {visible.map((row, index) => (
        <Fragment key={index}>
          <dt title={row.title}>{row.label}</dt>
          <dd data-testid={row.testId} title={typeof row.value === 'string' ? row.value : undefined}>
            {row.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** Small icon button that copies full-precision text to the clipboard. */
export function CopyButton({
  onCopy,
  label = 'Copy',
  testId,
}: {
  onCopy: () => void
  label?: string
  testId?: string
}) {
  return (
    <button
      type="button"
      className="icon-btn icon-btn--sm"
      onClick={onCopy}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <Icon name="copy" size={13} />
    </button>
  )
}

/** Flat inline section with a small-caps heading and optional trailing controls. */
export function InlineSection({
  title,
  actions,
  children,
  testId,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  testId?: string
}) {
  return (
    <section className="inspector-inline-section" data-testid={testId}>
      <h4 className="section-head">
        <span>{title}</span>
        {actions ? <span className="inspector-inline-section__actions">{actions}</span> : null}
      </h4>
      {children}
    </section>
  )
}

/** Collapsible block for bulky secondary data (tables, vector components…). */
export function DataDetails({
  title,
  children,
  testId,
  defaultOpen = false,
}: {
  title: ReactNode
  children: ReactNode
  testId?: string
  defaultOpen?: boolean
}) {
  return (
    <details className="inspector-data-details" open={defaultOpen || undefined}>
      <summary className="section-head" data-testid={testId}>
        {title}
      </summary>
      <div className="inspector-data-details__body">{children}</div>
    </details>
  )
}

/** Compact pager for data preview tables. */
export function DataPager({
  page,
  pageCount,
  onPage,
  jumpValue,
  onJumpChange,
  onJump,
  error,
  summary,
  testIdPrefix,
}: {
  page: number
  pageCount: number
  onPage: (index: number) => void
  jumpValue: string
  onJumpChange: (value: string) => void
  onJump: () => void
  error?: string | null
  summary?: ReactNode
  testIdPrefix: string
}) {
  const atStart = page <= 0
  const atEnd = page >= pageCount - 1
  return (
    <div className="data-pager">
      <div className="data-pager__row">
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onPage(0)}
          disabled={atStart} aria-label="First page" title="First page"
          data-testid={`${testIdPrefix}-start`}>
          <Icon name="first" size={13} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onPage(page - 1)}
          disabled={atStart} aria-label="Previous page" title="Previous page"
          data-testid={`${testIdPrefix}-prev`}>
          <Icon name="chevron-left" size={13} />
        </button>
        <span className="data-pager__page num">{`Page ${page + 1} of ${pageCount}`}</span>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onPage(page + 1)}
          disabled={atEnd} aria-label="Next page" title="Next page"
          data-testid={`${testIdPrefix}-next`}>
          <Icon name="chevron-right" size={13} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onPage(pageCount - 1)}
          disabled={atEnd} aria-label="Last page" title="Last page"
          data-testid={`${testIdPrefix}-end`}>
          <Icon name="last" size={13} />
        </button>
        <form
          className="data-pager__jump"
          onSubmit={(event) => {
            event.preventDefault()
            onJump()
          }}
        >
          <input
            type="number"
            min={1}
            max={pageCount}
            value={jumpValue}
            onChange={(event) => onJumpChange(event.target.value)}
            aria-label="Jump to page"
            data-testid={`${testIdPrefix}-page-input`}
          />
          <button type="submit" className="btn btn--ghost" data-testid={`${testIdPrefix}-page-jump`}>
            Go
          </button>
        </form>
      </div>
      {summary ? <div className="data-pager__summary faint">{summary}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  )
}

/** Collapsed "Advanced" group inside compute forms. */
export function AdvancedFields({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}) {
  return (
    <details className="inspector-advanced">
      <summary data-testid={testId}>Advanced</summary>
      <div className="inspector-advanced__body">{children}</div>
    </details>
  )
}
