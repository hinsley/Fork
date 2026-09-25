import { useEffect, useRef, useState } from 'react'
import { fmtCount } from '../utils/format'
import { Icon } from './Icon'
import { shortcutLabel } from './shortcuts'
import { formatSystemChip, type ToolbarSystem } from './shellFormat'
import type { ThemePreference } from './useThemePreference'

type TransferPhase =
  | 'exploring_cover'
  | 'building_transitions'
  | 'solving_stationary'
  | 'building_krylov'
  | 'restarting_krylov'
  | 'finalizing_eigenmodes'
  | 'complete'

export type ToolbarProgress = {
  label: string
  target?: { name: string; nodeId: string }
  currentStep: number
  maxSteps: number
  points: number
  bifurcations: number
  ringsComputed?: number
  showArclength?: boolean
  arclength?: number
  arclengthTarget?: number
  radius?: number
  phase?: TransferPhase
  discoveredBoxes?: number
  frontierBoxes?: number
  edgesBuilt?: number
  residual?: number
  tolerance?: number
  restartCount?: number
  maxRestarts?: number
  subspaceDimension?: number
  maxSubspaceDimension?: number
  convergedModes?: number
  requestedModes?: number
}

export type ToolbarPanels = {
  objectsOpen: boolean
  inspectorOpen: boolean
  onToggleObjects: () => void
  onToggleInspector: () => void
}

type ToolbarProps = {
  system: ToolbarSystem | null
  busy: boolean
  progress?: ToolbarProgress | null
  onHome: () => void
  onOpenSystems: () => void
  onOpenSystemSettings?: () => void
  onOpenCommandPalette?: () => void
  onSelectNode?: (nodeId: string) => void
  panels?: ToolbarPanels | null
  themePreference: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  onResetFork: () => void
  onCancelCalculation: () => void
}

const RESET_MESSAGE =
  'Are you absolutely 100% sure you want to completely reset everything in Fork? This will delete all systems and any data you have stored. Make sure to export any systems with data you want to preserve.'

const PHASE_LABELS: Record<TransferPhase, string> = {
  exploring_cover: 'Exploring cover',
  building_transitions: 'Building transitions',
  solving_stationary: 'Solving stationary mode',
  building_krylov: 'Building Krylov basis',
  restarting_krylov: 'Restarting Arnoldi solve',
  finalizing_eigenmodes: 'Finalizing eigenmodes',
  complete: 'Complete',
}

function formatArclength(value: number) {
  if (!Number.isFinite(value)) return 'n/a'
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) {
    return value.toExponential(3)
  }
  return value.toFixed(3)
}

function formatResidual(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toExponential(2) : 'pending'
}

const count = (value: number | undefined) => fmtCount(Math.max(0, value ?? 0))

/** Primary counter + secondary details for the running job. */
function describeProgress(progress: ToolbarProgress): { count: string; meta: string[] } {
  const phase = progress.phase
  const eigenmodes =
    phase === 'building_krylov' ||
    phase === 'restarting_krylov' ||
    phase === 'finalizing_eigenmodes' ||
    (phase === 'complete' && progress.label === 'Eigenmodes')
  const steps = `${count(progress.currentStep)} / ${count(progress.maxSteps)}`
  if (phase === 'exploring_cover') {
    return {
      count: `${count(progress.currentStep)} cells explored`,
      meta: [
        `${count(progress.discoveredBoxes)} discovered · ${count(progress.frontierBoxes)} queued`,
        `${count(progress.points)} dynamics steps`,
      ],
    }
  }
  if (phase === 'building_transitions') {
    return {
      count: `${steps} cells`,
      meta: [`${count(progress.points)} dynamics steps`, `${count(progress.edgesBuilt)} edges`],
    }
  }
  if (eigenmodes) {
    return {
      count: `${steps} sparse products`,
      meta: [
        `${count(progress.convergedModes)} / ${count(progress.requestedModes)} modes converged`,
        `basis ${count(progress.subspaceDimension)} / ${count(progress.maxSubspaceDimension)} · restart ${count(progress.restartCount)} / ${count(progress.maxRestarts)}`,
      ],
    }
  }
  if (phase === 'solving_stationary' || phase === 'complete') {
    return {
      count: `${steps} iterations`,
      meta: [`residual ${formatResidual(progress.residual)}`, `target ${formatResidual(progress.tolerance)}`],
    }
  }
  const meta: string[] = []
  if (typeof progress.ringsComputed === 'number') meta.push(`${progress.ringsComputed} rings`)
  meta.push(`${progress.points} pts`)
  if (progress.showArclength) {
    meta.push(`radius ${formatArclength(progress.radius ?? 0)}`)
    return {
      count: `${formatArclength(progress.arclength ?? progress.currentStep)} / ${formatArclength(progress.arclengthTarget ?? progress.maxSteps)}`,
      meta,
    }
  }
  meta.push(`${progress.bifurcations} bif`)
  return { count: `${progress.currentStep} / ${progress.maxSteps}`, meta }
}

function JobStatus({
  busy,
  progress,
  onCancel,
  onSelectNode,
}: {
  busy: boolean
  progress: ToolbarProgress | null | undefined
  onCancel: () => void
  onSelectNode?: (nodeId: string) => void
}) {
  if (!progress) {
    return (
      <div className="job job--idle" role="status">
        {busy ? <span className="job__busy">Computing…</span> : <span className="sr-only">Ready</span>}
      </div>
    )
  }
  const phaseLabel = progress.phase ? PHASE_LABELS[progress.phase] : null
  const indeterminate = progress.phase === 'exploring_cover'
  const { count: counter, meta } = describeProgress(progress)
  const fraction =
    progress.maxSteps > 0 ? Math.min(100, (progress.currentStep / progress.maxSteps) * 100) : 0
  const target = progress.target?.name ? progress.target : null
  return (
    <div className="job job--active" role="status">
      <div className="job__line">
        {target ? (
          onSelectNode ? (
            <button
              type="button"
              className="job__target truncate"
              onClick={() => onSelectNode(target.nodeId)}
              title={`Select ${target.name}`}
            >
              {target.name}
            </button>
          ) : (
            <span className="job__target truncate">{target.name}</span>
          )
        ) : null}
        <span className="job__label truncate">
          {progress.label}
          {phaseLabel ? ` · ${phaseLabel}` : ''}
        </span>
        <span className="job__count num">{counter}</span>
        <button
          type="button"
          className="job__cancel"
          onClick={onCancel}
          data-testid="cancel-calculation"
        >
          Cancel
        </button>
      </div>
      <div className="job__line job__line--sub">
        <div
          className={`toolbar__progress-bar${indeterminate ? ' toolbar__progress-bar--indeterminate' : ''}`}
          role="progressbar"
          aria-label={phaseLabel ?? progress.label}
          aria-valuemin={indeterminate ? undefined : 0}
          aria-valuenow={indeterminate ? undefined : progress.currentStep}
          aria-valuemax={indeterminate || progress.maxSteps <= 0 ? undefined : progress.maxSteps}
        >
          <div
            className="toolbar__progress-fill"
            style={{ width: indeterminate ? undefined : `${fraction}%` }}
          />
        </div>
        <span className="job__meta truncate">
          {meta.map((entry) => (
            <span key={entry}>{entry}</span>
          ))}
        </span>
      </div>
    </div>
  )
}

function SettingsMenu({
  themePreference,
  onThemeChange,
  onResetFork,
}: {
  themePreference: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  onResetFork: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const themes: Array<{ value: ThemePreference; label: string }> = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ]

  return (
    <div className="toolbar__settings" ref={rootRef}>
      <button
        type="button"
        className={`icon-btn${open ? ' is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="open-settings"
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="settings" />
      </button>
      {open ? (
        <div className="menu-surface toolbar__menu">
          <div className="section-head">Theme</div>
          <div className="segmented" role="group" aria-label="Color scheme">
            {themes.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={themePreference === entry.value ? 'is-active' : ''}
                aria-pressed={themePreference === entry.value}
                onClick={() => {
                  onThemeChange(entry.value)
                  setOpen(false)
                }}
                data-testid={`theme-${entry.value}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <hr />
          <a
            className="menu-item"
            href="https://github.com/hinsley/Fork/tree/main/tutorial"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="help" size={15} />
            Docs
            <Icon name="external" size={12} className="toolbar__menu-trail" />
          </a>
          <a
            className="menu-item"
            href="https://patreon.com/ForkDynamics"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-patreon"
          >
            <Icon name="fork" size={15} />
            Patreon
            <Icon name="external" size={12} className="toolbar__menu-trail" />
          </a>
          <hr />
          <button
            type="button"
            className="menu-item toolbar__menu-danger"
            onClick={() => {
              if (!window.confirm(RESET_MESSAGE)) return
              setOpen(false)
              onResetFork()
            }}
            data-testid="reset-fork"
          >
            <Icon name="trash" size={15} />
            Reset Fork
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function Toolbar({
  system,
  busy,
  progress,
  onHome,
  onOpenSystems,
  onOpenSystemSettings,
  onOpenCommandPalette,
  onSelectNode,
  panels,
  themePreference,
  onThemeChange,
  onResetFork,
  onCancelCalculation,
}: ToolbarProps) {
  return (
    <header className="toolbar" data-testid="toolbar">
      <button
        type="button"
        className="toolbar__home"
        onClick={onHome}
        aria-label="Go to Fork home"
        title="Home"
        data-testid="go-home"
      >
        <Icon name="fork" size={20} />
        <span className="toolbar__logo">Fork</span>
      </button>
      {system ? (
        <div className="toolbar__context">
          <button
            type="button"
            className="toolbar__switch"
            onClick={onOpenSystems}
            aria-label={`Systems: ${system.name}`}
            title="Switch system"
            data-testid="open-systems"
          >
            <span className="toolbar__system-name truncate">{system.name}</span>
            <Icon name="chevron-down" size={14} />
          </button>
          <button
            type="button"
            className="toolbar__chip"
            onClick={onOpenSystemSettings}
            title="System settings"
            data-testid="open-system-settings"
          >
            {formatSystemChip(system)}
          </button>
        </div>
      ) : null}
      <div className="toolbar__job">
        <JobStatus
          busy={busy}
          progress={progress}
          onCancel={onCancelCalculation}
          onSelectNode={onSelectNode}
        />
      </div>
      <div className="toolbar__actions">
        {panels ? (
          <>
            <button
              type="button"
              className={`icon-btn${panels.objectsOpen ? ' is-active' : ''}`}
              onClick={panels.onToggleObjects}
              aria-pressed={panels.objectsOpen}
              aria-label="Objects panel"
              title={`Objects panel (${shortcutLabel('[')})`}
              data-testid="toggle-objects-panel"
            >
              <Icon name="panel-left" />
            </button>
            <button
              type="button"
              className={`icon-btn${panels.inspectorOpen ? ' is-active' : ''}`}
              onClick={panels.onToggleInspector}
              aria-pressed={panels.inspectorOpen}
              aria-label="Inspector panel"
              title={`Inspector panel (${shortcutLabel(']')})`}
              data-testid="toggle-inspector-panel"
            >
              <Icon name="panel-right" />
            </button>
          </>
        ) : null}
        {onOpenCommandPalette ? (
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenCommandPalette}
            aria-label="Command palette"
            title={`Go to… (${shortcutLabel('K', { mod: true })})`}
            data-testid="open-command-palette"
          >
            <Icon name="search" />
          </button>
        ) : null}
        <SettingsMenu
          themePreference={themePreference}
          onThemeChange={onThemeChange}
          onResetFork={onResetFork}
        />
      </div>
    </header>
  )
}
