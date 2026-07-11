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
  } | null
  onOpenSystems: () => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
  onResetFork: () => void
}

export function Toolbar({
  systemName,
  busy,
  progress,
  onOpenSystems,
  theme,
  onThemeChange,
  onResetFork,
}: ToolbarProps) {
  const formatArclength = (value: number) => {
    if (!Number.isFinite(value)) return 'n/a'
    if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) {
      return value.toExponential(3)
    }
    return value.toFixed(3)
  }

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
        <span className="toolbar__brand-copy">
          <span className="toolbar__logo">Fork</span>
          <span className="toolbar__tagline">Dynamical systems workbench</span>
        </span>
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
              <span>{progress.label}</span>
              {progress.showArclength ? (
                <span>
                  {formatArclength(progress.arclength ?? progress.currentStep)} /{' '}
                  {formatArclength(progress.arclengthTarget ?? progress.maxSteps)}
                </span>
              ) : (
                <span>
                  {progress.currentStep} / {progress.maxSteps}
                </span>
              )}
            </div>
            <div className="toolbar__progress-bar" role="progressbar">
              <div
                className="toolbar__progress-fill"
                style={{
                  width: `${
                    progress.maxSteps > 0
                      ? Math.min(100, (progress.currentStep / progress.maxSteps) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="toolbar__progress-meta">
              {typeof progress.ringsComputed === 'number' ? (
                <span>{progress.ringsComputed} rings</span>
              ) : null}
              <span>{progress.points} pts</span>
              {progress.showArclength ? (
                <span>radius {formatArclength(progress.radius ?? 0)}</span>
              ) : (
                <span>{progress.bifurcations} bifurcations</span>
              )}
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
