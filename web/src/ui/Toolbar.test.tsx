import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toolbar } from './Toolbar'

const handlers = {
  onHome: vi.fn(),
  onOpenSystems: vi.fn(),
  onThemeChange: vi.fn(),
  onResetFork: vi.fn(),
  onCancelCalculation: vi.fn(),
}

describe('Toolbar invariant-measure progress', () => {
  it('shows dynamic cover counts without claiming a percentage', () => {
    render(
      <Toolbar
        system={{ name: 'Map', type: 'map', dimension: 2, solver: 'discrete' }}
        busy
        themePreference="light"
        {...handlers}
        progress={{
          label: 'Invariant measure',
          currentStep: 320,
          maxSteps: 0,
          points: 1280,
          bifurcations: 0,
          phase: 'exploring_cover',
          discoveredBoxes: 481,
          frontierBoxes: 161,
        }}
      />
    )

    expect(screen.getByText('Invariant measure · Exploring cover')).toBeInTheDocument()
    expect(screen.getByText('320 cells explored')).toBeInTheDocument()
    expect(screen.getByText('481 discovered · 161 queued')).toBeInTheDocument()
    expect(screen.getByText('1,280 dynamics steps')).toBeInTheDocument()
    const progressbar = screen.getByRole('progressbar', { name: 'Exploring cover' })
    expect(progressbar).not.toHaveAttribute('aria-valuenow')
    expect(progressbar).not.toHaveAttribute('aria-valuemax')
    expect(progressbar).toHaveClass('toolbar__progress-bar--indeterminate')
    expect(screen.queryByText(/pts$/)).not.toBeInTheDocument()
  })

  it('shows stationary iteration and residual convergence', () => {
    render(
      <Toolbar
        system={{ name: 'Flow', type: 'flow', dimension: 3, solver: 'rk4' }}
        busy
        themePreference="dark"
        {...handlers}
        progress={{
          label: 'Invariant measure',
          currentStep: 640,
          maxSteps: 2000,
          points: 640,
          bifurcations: 0,
          phase: 'solving_stationary',
          discoveredBoxes: 30802,
          edgesBuilt: 91145,
          residual: 4.63e-8,
          tolerance: 1e-10,
        }}
      />
    )

    expect(screen.getByText('Invariant measure · Solving stationary mode')).toBeInTheDocument()
    expect(screen.getByText('640 / 2,000 iterations')).toBeInTheDocument()
    expect(screen.getByText('residual 4.63e-8')).toBeInTheDocument()
    expect(screen.getByText('target 1.00e-10')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Solving stationary mode' })).toHaveAttribute(
      'aria-valuenow',
      '640'
    )
  })

  it('shows bounded sparse-product, basis, restart, and convergence progress', () => {
    render(
      <Toolbar
        system={{ name: 'Flow', type: 'flow', dimension: 3, solver: 'rk4' }}
        busy
        themePreference="dark"
        {...handlers}
        progress={{
          label: 'Eigenmodes',
          currentStep: 41,
          maxSteps: 312,
          points: 41,
          bifurcations: 0,
          phase: 'restarting_krylov',
          restartCount: 2,
          maxRestarts: 12,
          subspaceDimension: 24,
          maxSubspaceDimension: 24,
          convergedModes: 4,
          requestedModes: 6,
          residual: 3e-7,
          tolerance: 1e-8,
        }}
      />
    )

    expect(screen.getByText('Eigenmodes · Restarting Arnoldi solve')).toBeInTheDocument()
    expect(screen.getByText('41 / 312 sparse products')).toBeInTheDocument()
    expect(screen.getByText('4 / 6 modes converged')).toBeInTheDocument()
    expect(screen.getByText('basis 24 / 24 · restart 2 / 12')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Restarting Arnoldi solve' })).toHaveAttribute(
      'aria-valuenow',
      '41'
    )
  })

  it('names the job target and selects it on click', () => {
    const onSelectNode = vi.fn()
    render(
      <Toolbar
        system={{ name: 'Lorenz', type: 'flow', dimension: 3, solver: 'rk4' }}
        busy
        themePreference="light"
        {...handlers}
        onSelectNode={onSelectNode}
        progress={{
          label: 'Limit Cycle',
          target: { name: 'lc1_p1', nodeId: 'branch-7' },
          currentStep: 12,
          maxSteps: 40,
          points: 21,
          bifurcations: 2,
        }}
      />
    )

    expect(screen.getByText('Limit Cycle')).toBeInTheDocument()
    expect(screen.getByText('12 / 40')).toBeInTheDocument()
    expect(screen.getByText('21 pts')).toBeInTheDocument()
    expect(screen.getByText('2 bif')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'lc1_p1' }))
    expect(onSelectNode).toHaveBeenCalledWith('branch-7')
    fireEvent.click(screen.getByTestId('cancel-calculation'))
    expect(handlers.onCancelCalculation).toHaveBeenCalled()
  })
})

describe('Toolbar system chip and menus', () => {
  it('shows the system chip and opens system settings from it', () => {
    const onOpenSystemSettings = vi.fn()
    render(
      <Toolbar
        system={{ name: 'Lorenz', type: 'flow', dimension: 3, solver: 'rk4' }}
        busy={false}
        themePreference="light"
        {...handlers}
        onOpenSystemSettings={onOpenSystemSettings}
      />
    )

    const chip = screen.getByTestId('open-system-settings')
    expect(chip).toHaveTextContent('Flow · 3D · rk4')
    fireEvent.click(chip)
    expect(onOpenSystemSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('open-systems')).toHaveTextContent('Lorenz')
    expect(screen.getByText('Ready')).toHaveClass('sr-only')
  })

  it('omits the solver for maps and hides system controls on home', () => {
    const { rerender } = render(
      <Toolbar
        system={{ name: 'Henon', type: 'map', dimension: 2, solver: 'discrete' }}
        busy={false}
        themePreference="light"
        {...handlers}
      />
    )
    expect(screen.getByTestId('open-system-settings')).toHaveTextContent(/^Map · 2D$/)

    rerender(<Toolbar system={null} busy={false} themePreference="light" {...handlers} />)
    expect(screen.queryByTestId('open-system-settings')).toBeNull()
    expect(screen.queryByTestId('open-systems')).toBeNull()
  })

  it('offers light, dark, and system themes plus docs and Patreon in the settings menu', () => {
    const onThemeChange = vi.fn()
    render(
      <Toolbar
        system={null}
        busy={false}
        themePreference="system"
        {...handlers}
        onThemeChange={onThemeChange}
      />
    )

    fireEvent.click(screen.getByTestId('open-settings'))
    expect(screen.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('open-patreon')).toHaveAttribute(
      'href',
      'https://patreon.com/ForkDynamics'
    )
    expect(screen.getByRole('link', { name: /Docs/ })).toHaveAttribute(
      'href',
      'https://github.com/hinsley/Fork/tree/main/tutorial'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
    expect(screen.queryByTestId('theme-light')).toBeNull()
  })
})
