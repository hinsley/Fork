import { render, screen } from '@testing-library/react'
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
        systemName="Map"
        busy
        theme="light"
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
        systemName="Flow"
        busy
        theme="dark"
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
})
