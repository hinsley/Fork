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
  } | null
  onOpenSystems: () => void
  theme: 'light' | 'dark'
  onThemeChange: (theme: 'light' | 'dark') => void
}

export function Toolbar({
  systemName,
  busy,
  progress,
  onOpenSystems,
  theme,
  onThemeChange,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement | null>(null)

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
        <span className="toolbar__logo">Fork</span>
        <span className="toolbar__system">{systemName ?? 'No System'}</span>
      </div>
      <div className="toolbar__actions">
        <button onClick={onOpenSystems} data-testid="open-systems">
          Systems
        </button>
        <button
          onClick={() => {
            window.open('https://patreon.com/ForkDynamics', '_blank', 'noopener,noreferrer')
          }}
          data-testid="open-patreon"
        >
          Patreon
        </button>
        <div className="toolbar__settings" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            aria-haspopup="menu"
            data-testid="open-settings"
          >
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
            </div>
          ) : null}
        </div>
      </div>
      <div className="toolbar__status">
        {progress ? (
          <div className="toolbar__progress">
            <div className="toolbar__progress-header">
              <span>{progress.label}</span>
              <span>
                {progress.currentStep} / {progress.maxSteps}
              </span>
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
              <span>{progress.points} pts</span>
              <span>{progress.bifurcations} bifurcations</span>
            </div>
          </div>
        ) : (
          <span>{busy ? 'Computing…' : 'Ready'}</span>
        )}
      </div>
    </header>
  )
}
