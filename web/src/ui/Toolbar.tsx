import { useEffect, useRef, useState } from 'react'

type ToolbarProps = {
  systemName: string | null
  busy: boolean
  progress?: {
    label: string
    currentStep: number
    maxSteps: number
    points: number
    bifurcations: number
    ringsComputed?: number
    showArclength?: boolean
    arclength?: number
    arclengthTarget?: number
    radius?: number
    phase?:
      | 'exploring_cover'
      | 'building_transitions'
      | 'solving_stationary'
      | 'building_krylov'
      | 'restarting_krylov'
      | 'finalizing_eigenmodes'
      | 'complete'
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
  } | null
  onHome: () => void
  onOpenSystems: () => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  onResetFork: () => void
  onCancelCalculation: () => void
}

export function Toolbar({
  systemName,
  busy,
  progress,
  onHome,
  onOpenSystems,
  theme,
  onThemeChange,
  onResetFork,
  onCancelCalculation,
}: ToolbarProps) {
  const formatArclength = (value: number) => {
    if (!Number.isFinite(value)) return 'n/a'
    if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) {
      return value.toExponential(3)
    }
    return value.toFixed(3)
  }
  const formatCount = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.trunc(value)).toLocaleString() : 'n/a'
  const formatResidual = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toExponential(2) : 'pending'
  const transferPhase = progress?.phase
  const eigenmodeProgress = progress?.label === 'Eigenmodes'
  const transferPhaseLabel =
    transferPhase === 'exploring_cover'
      ? 'Exploring cover'
      : transferPhase === 'building_transitions'
        ? 'Building transitions'
        : transferPhase === 'solving_stationary'
          ? 'Solving stationary mode'
          : transferPhase === 'building_krylov'
            ? 'Building Krylov basis'
            : transferPhase === 'restarting_krylov'
              ? 'Restarting Arnoldi solve'
              : transferPhase === 'finalizing_eigenmodes'
                ? 'Finalizing eigenmodes'
          : transferPhase === 'complete'
            ? 'Complete'
            : null
  const indeterminateProgress = transferPhase === 'exploring_cover'

  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement | null>(null)
  const resetMessage =
    'Are you absolutely 100% sure you want to completely reset everything in Fork? This will delete all systems and any data you have stored. Make sure to export any systems with data you want to preserve.'

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      if (!settingsRef.current) return
      if (!settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false)
      }
    }

    if (settingsOpen) {
      window.addEventListener('pointerdown', handlePointer)
    }
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
    }
  }, [settingsOpen])

  return (
    <header className="toolbar" data-testid="toolbar">
      <div className="toolbar__title">
        <button
          type="button"
          className="toolbar__brand-copy toolbar__home"
          onClick={onHome}
          aria-label="Go to Fork home"
          data-testid="go-home"
        >
          <span className="toolbar__logo">Fork</span>
        </button>
        <span className="toolbar__divider" aria-hidden="true" />
        <span className="toolbar__system">
          <span className="toolbar__system-label">System</span>
          <span className="toolbar__system-name">{systemName ?? 'None selected'}</span>
        </span>
      </div>
      <div className="toolbar__actions">
        <button
          className="toolbar__button toolbar__button--primary"
          onClick={onOpenSystems}
          data-testid="open-systems"
        >
          <span aria-hidden="true">⌘</span>
          Systems
        </button>
        <div className="toolbar__settings" ref={settingsRef}>
          <button
            className="toolbar__button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-haspopup="menu"
            data-testid="open-settings"
          >
            <span aria-hidden="true">◐</span>
            Settings
          </button>
          {settingsOpen ? (
            <div className="toolbar__settings-panel" role="menu">
              <div className="settings-row">
                <span className="settings-label">Color scheme</span>
                <div className="settings-toggle" role="group" aria-label="Color scheme">
                  <button
                    className={theme === 'light' ? 'is-active' : ''}
                    onClick={() => {
                      onThemeChange('light')
                      setSettingsOpen(false)
                    }}
                    data-testid="theme-light"
                  >
                    Light
                  </button>
                  <button
                    className={theme === 'dark' ? 'is-active' : ''}
                    onClick={() => {
                      onThemeChange('dark')
                      setSettingsOpen(false)
                    }}
                    data-testid="theme-dark"
                  >
                    Dark
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <button
                  className="settings-reset"
                  onClick={() => {
                    if (!window.confirm(resetMessage)) return
                    setSettingsOpen(false)
                    onResetFork()
                  }}
                  data-testid="reset-fork"
                >
                  Reset Fork
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <button
          className="toolbar__button toolbar__button--support"
          onClick={() => {
            window.open('https://patreon.com/ForkDynamics', '_blank', 'noopener,noreferrer')
          }}
          data-testid="open-patreon"
        >
          Patreon
        </button>
      </div>
      <div className="toolbar__status">
        {progress ? (
          <div className="toolbar__progress">
            <div className="toolbar__progress-header">
              <span>
                {progress.label}
                {transferPhaseLabel ? ` · ${transferPhaseLabel}` : ''}
              </span>
              <span className="toolbar__progress-controls">
                {transferPhase === 'exploring_cover' ? (
                  <span>{formatCount(progress.currentStep)} cells explored</span>
                ) : transferPhase === 'building_transitions' ? (
                  <span>
                    {formatCount(progress.currentStep)} / {formatCount(progress.maxSteps)} cells
                  </span>
                ) : transferPhase === 'building_krylov' ||
                  transferPhase === 'restarting_krylov' ||
                  transferPhase === 'finalizing_eigenmodes' ||
                  (transferPhase === 'complete' && eigenmodeProgress) ? (
                  <span>
                    {formatCount(progress.currentStep)} / {formatCount(progress.maxSteps)} sparse products
                  </span>
                ) : transferPhase === 'solving_stationary' || transferPhase === 'complete' ? (
                  <span>
                    {formatCount(progress.currentStep)} / {formatCount(progress.maxSteps)} iterations
                  </span>
                ) : progress.showArclength ? (
                  <span>
                  {formatArclength(progress.arclength ?? progress.currentStep)} /{' '}
                  {formatArclength(progress.arclengthTarget ?? progress.maxSteps)}
                  </span>
                ) : (
                  <span>
                  {progress.currentStep} / {progress.maxSteps}
                  </span>
                )}
                <button
                  type="button"
                  className="toolbar__progress-cancel"
                  onClick={onCancelCalculation}
                  data-testid="cancel-calculation"
                >
                  Cancel
                </button>
              </span>
            </div>
            <div
              className={`toolbar__progress-bar${indeterminateProgress ? ' toolbar__progress-bar--indeterminate' : ''}`}
              role="progressbar"
              aria-label={transferPhaseLabel ?? progress.label}
              aria-valuemin={indeterminateProgress ? undefined : 0}
              aria-valuenow={indeterminateProgress ? undefined : progress.currentStep}
              aria-valuemax={
                indeterminateProgress || progress.maxSteps <= 0 ? undefined : progress.maxSteps
              }
            >
              <div
                className="toolbar__progress-fill"
                style={{
                  width: indeterminateProgress
                    ? undefined
                    : `${
                        progress.maxSteps > 0
                          ? Math.min(100, (progress.currentStep / progress.maxSteps) * 100)
                          : 0
                      }%`,
                }}
              />
            </div>
            <div className="toolbar__progress-meta">
              {transferPhase === 'exploring_cover' ? (
                <>
                  <span>
                    {formatCount(progress.discoveredBoxes ?? 0)} discovered ·{' '}
                    {formatCount(progress.frontierBoxes ?? 0)} queued
                  </span>
                  <span>{formatCount(progress.points)} dynamics steps</span>
                </>
              ) : transferPhase === 'building_transitions' ? (
                <>
                  <span>{formatCount(progress.points)} dynamics steps</span>
                  <span>{formatCount(progress.edgesBuilt ?? 0)} edges</span>
                </>
              ) : transferPhase === 'building_krylov' ||
                transferPhase === 'restarting_krylov' ||
                transferPhase === 'finalizing_eigenmodes' ||
                (transferPhase === 'complete' && eigenmodeProgress) ? (
                <>
                  <span>
                    {formatCount(progress.convergedModes ?? 0)} /{' '}
                    {formatCount(progress.requestedModes ?? 0)} modes converged
                  </span>
                  <span>
                    basis {formatCount(progress.subspaceDimension ?? 0)} /{' '}
                    {formatCount(progress.maxSubspaceDimension ?? 0)} · restart{' '}
                    {formatCount(progress.restartCount ?? 0)} /{' '}
                    {formatCount(progress.maxRestarts ?? 0)}
                  </span>
                </>
              ) : transferPhase === 'solving_stationary' || transferPhase === 'complete' ? (
                <>
                  <span>residual {formatResidual(progress.residual)}</span>
                  <span>target {formatResidual(progress.tolerance)}</span>
                </>
              ) : typeof progress.ringsComputed === 'number' ? (
                <span>{progress.ringsComputed} rings</span>
              ) : null}
              {!transferPhase ? <span>{progress.points} pts</span> : null}
              {!transferPhase && progress.showArclength ? (
                <span>radius {formatArclength(progress.radius ?? 0)}</span>
              ) : !transferPhase ? (
                <span>{progress.bifurcations} bifurcations</span>
              ) : null}
            </div>
          </div>
        ) : (
          <span className={`toolbar__ready${busy ? ' toolbar__ready--busy' : ''}`}>
            <span className="toolbar__ready-dot" aria-hidden="true" />
            {busy ? 'Computing…' : 'Ready'}
          </span>
        )}
      </div>
    </header>
  )
}
