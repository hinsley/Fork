import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystem } from '../../system/model'
import { SystemEditorPanel } from './SystemEditorPanel'
import type { SystemEditorActions } from './types'

function renderEditor(options: { withParameter?: boolean; forcedFlow?: boolean } = {}) {
  const system = createSystem({ name: 'Editor_Test' })
  if (options.withParameter) {
    system.config.paramNames = ['old_parameter']
    system.config.params = [99]
  }
  if (options.forcedFlow) {
    system.config.equations[0] = 'y + cos(omega*t)'
    system.config.paramNames = ['omega']
    system.config.params = [2]
    system.config.periodicForcing = { symbol: 't', periodExpression: 'tau / omega' }
  }
  const actions: SystemEditorActions = {
    updateSystem: vi.fn().mockResolvedValue(undefined),
    validateSystem: vi.fn().mockResolvedValue({ ok: true, equationErrors: [] }),
  }
  render(<SystemEditorPanel systemId={system.id} config={system.config} actions={actions} />)
  return { system, actions }
}

describe('SystemEditorPanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('keeps major editor sections independently open', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.getByTestId('system-toggle-model')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('system-toggle-variables')).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByTestId('system-toggle-model'))
    expect(screen.getByTestId('system-toggle-model')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('system-toggle-variables')).toHaveAttribute('aria-expanded', 'true')
  })

  it('only renders a period input when periodic wrapping is enabled', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.queryByTestId('system-periodic-period-0')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('system-periodic-enabled-0'))
    expect(screen.getByTestId('system-periodic-period-0')).toBeVisible()
  })

  it('conditionally renders and persists the forcing-period declaration', async () => {
    const user = userEvent.setup()
    const { actions } = renderEditor({ forcedFlow: true })

    expect(screen.getByTestId('system-forcing-period-expression')).toHaveValue('tau / omega')
    await user.clear(screen.getByTestId('system-forcing-period-expression'))
    await user.type(screen.getByTestId('system-forcing-period-expression'), 'tau / (2*omega)')
    await user.click(screen.getByTestId('system-apply'))

    await waitFor(() => expect(actions.updateSystem).toHaveBeenCalledOnce())
    expect(actions.updateSystem).toHaveBeenCalledWith(expect.objectContaining({
      periodicForcing: { symbol: 't', periodExpression: 'tau / (2*omega)' },
    }))

    await user.click(screen.getByTestId('system-periodic-forcing-enabled'))
    expect(screen.queryByTestId('system-forcing-period-expression')).not.toBeInTheDocument()
  })

  it('documents the expression language and its piecewise autodiff caveat', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByText('Expression syntax and functions'))

    expect(screen.getByText('atan2(y, x)')).toBeVisible()
    expect(screen.getByText('log(x, base)')).toBeVisible()
    expect(screen.getByText('min(x, y, ...)')).toBeVisible()
    expect(screen.getByText('pi')).toBeVisible()
    expect(screen.getByText('erf(x)')).toBeVisible()
    expect(screen.getByText('logaddexp(x, y)')).toBeVisible()
    expect(screen.getByText('clamp(x, min, max)')).toBeVisible()
    expect(screen.getByText('if(condition, then, else)')).toBeVisible()
    expect(screen.getByText('==')).toBeVisible()
    expect(screen.getByText(/not differentiable at jumps, ties, or corners/i)).toBeVisible()
  })

  it('validates and applies a changed configuration', async () => {
    const user = userEvent.setup()
    const { actions } = renderEditor()

    await user.clear(screen.getByTestId('system-name'))
    await user.type(screen.getByTestId('system-name'), 'Updated_System')
    await user.click(screen.getByTestId('system-apply'))

    await waitFor(() => expect(actions.updateSystem).toHaveBeenCalledOnce())
    expect(actions.updateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated_System' })
    )
  })

  it('evaluates mathematical constants in parameter value expressions', async () => {
    const user = userEvent.setup()
    const { actions } = renderEditor({ withParameter: true })

    const value = screen.getByTestId('system-param-value-0')
    await user.clear(value)
    await user.type(value, 'tau / 4')
    await user.click(screen.getByTestId('system-apply'))

    await waitFor(() => expect(actions.updateSystem).toHaveBeenCalledOnce())
    expect(actions.updateSystem).toHaveBeenCalledWith(
      expect.objectContaining({ params: [Math.PI / 2] })
    )
  })

  it('evaluates constant expressions pasted into parameter values', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('tau / 4'),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    renderEditor({ withParameter: true })

    await user.click(screen.getByRole('button', { name: 'Paste values' }))

    await waitFor(() =>
      expect(screen.getByTestId('system-param-value-0')).toHaveValue(String(Math.PI / 2))
    )
  })

  it('copies the current draft in the canonical system string format', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderEditor({ withParameter: true })

    await user.click(screen.getByTestId('copy-system-string'))

    expect(writeText).toHaveBeenCalledWith("x' = y\ny' = -x\nold_parameter = 99")
    expect(screen.getByRole('status')).toHaveTextContent('System string copied.')
  })

  it('imports a system string as an atomic replacement draft', async () => {
    const user = userEvent.setup()
    const { actions } = renderEditor({ withParameter: true })

    await user.click(screen.getByTestId('system-periodic-enabled-0'))
    expect(screen.getByTestId('system-periodic-period-0')).toBeVisible()

    await user.click(screen.getByTestId('import-system-string'))
    await user.type(
      screen.getByTestId('system-string-input'),
      "u' = alpha * u\nalpha = 2.5"
    )
    await user.click(screen.getByTestId('replace-from-system-string'))

    expect(screen.getByTestId('system-var-0')).toHaveValue('u')
    expect(screen.queryByTestId('system-var-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('system-eq-0')).toHaveValue('alpha * u')
    expect(screen.getByTestId('system-param-0')).toHaveValue('alpha')
    expect(screen.getByTestId('system-param-value-0')).toHaveValue('2.5')
    expect(screen.queryByText('old_parameter')).not.toBeInTheDocument()
    expect(screen.queryByTestId('system-periodic-period-0')).not.toBeInTheDocument()
    expect(actions.updateSystem).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('system-apply'))

    await waitFor(() => expect(actions.updateSystem).toHaveBeenCalledOnce())
    expect(actions.updateSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        varNames: ['u'],
        equations: ['alpha * u'],
        paramNames: ['alpha'],
        params: [2.5],
        periodicVariables: [{ enabled: false, period: Math.PI * 2 }],
      })
    )
  })

  it('rejects an ambiguous import without changing any draft field', async () => {
    const user = userEvent.setup()
    renderEditor({ withParameter: true })

    await user.click(screen.getByTestId('import-system-string'))
    await user.type(screen.getByTestId('system-string-input'), "z' = -z\nz = 1")
    await user.click(screen.getByTestId('replace-from-system-string'))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Line 2: "z" is already defined as a variable on line 1.'
    )
    expect(screen.getByTestId('system-var-0')).toHaveValue('x')
    expect(screen.getByTestId('system-var-1')).toHaveValue('y')
    expect(screen.getByTestId('system-param-0')).toHaveValue('old_parameter')
    expect(screen.getByTestId('system-param-value-0')).toHaveValue('99')
  })
})
