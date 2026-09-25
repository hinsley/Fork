import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  addAnalysisViewport,
  createSystem,
  updateAnalysisViewport
} from '../system/model'
import type { SystemConfig } from '../system/types'
import { createDemoSystem } from '../system/fixtures'
import { AnalysisViewportInspector } from './AnalysisViewportInspector'

function renderInspector(options?: {
  config?: SystemConfig
  viewportUpdate?: Parameters<typeof updateAnalysisViewport>[2]
  onValidateAnalysisExpression?: (
    request: {
      system: SystemConfig
      expression: string
      role: 'event' | 'observable'
    },
    opts?: { signal?: AbortSignal }
  ) => Promise<void>
}) {
  const onValidateAnalysisExpression =
    options?.onValidateAnalysisExpression ?? vi.fn(() => Promise.resolve())
  const base = createSystem({
    name: options?.config?.name ?? 'Lorenz',
    config: options?.config ?? {
      name: 'Lorenz',
      equations: ['sigma * (y - x)', 'x * (rho - z) - y', 'x * y - beta * z'],
      params: [10, 28, 8 / 3],
      paramNames: ['sigma', 'rho', 'beta'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow'
    }
  })
  const added = addAnalysisViewport(base, 'Event_Map_1')
  const initialSystem = options?.viewportUpdate
    ? updateAnalysisViewport(added.system, added.nodeId, options.viewportUpdate)
    : added.system

  function Wrapper() {
    const [state, setState] = useState(initialSystem)
    const viewport = state.analysisViewports.find(
      (entry) => entry.id === added.nodeId
    )
    if (!viewport) throw new Error('Missing analysis viewport')
    return (
      <AnalysisViewportInspector
        system={state}
        viewport={viewport}
        onUpdateAnalysisViewport={(id, update) => {
          setState((prev) => updateAnalysisViewport(prev, id, update))
        }}
        onValidateAnalysisExpression={onValidateAnalysisExpression}
      />
    )
  }

  render(<Wrapper />)
  return { onValidateAnalysisExpression }
}

describe('AnalysisViewportInspector', () => {
  it('pins selected sources under filtering and removes unavailable selections without dropping others', () => {
    const { system, objectNodeId, branchNodeId } = createDemoSystem()
    const added = addAnalysisViewport(system, 'Sources')
    const initialViewport = {
      ...added.system.analysisViewports[0],
      sourceNodeIds: [branchNodeId, 'missing-source', objectNodeId]
    }
    function Wrapper() {
      const [viewport, setViewport] = useState(initialViewport)
      return (
        <AnalysisViewportInspector
          system={added.system}
          viewport={viewport}
          onUpdateAnalysisViewport={(_, update) => setViewport((prev) => ({ ...prev, ...update }))}
        />
      )
    }
    render(<Wrapper />)
    fireEvent.change(screen.getByLabelText('Search compatible sources'), {
      target: { value: 'no matching source' }
    })
    const incompatible = screen.getByRole('checkbox', { name: /Incompatible source/ })
    const unavailable = screen.getByRole('checkbox', { name: /missing-source/ })
    const orbit = screen.getByRole('checkbox', { name: /Orbit A/ })
    expect(incompatible).toBeChecked()
    expect(unavailable).toBeChecked()
    expect(orbit).toBeChecked()
    const sources = screen.getByRole('heading', { name: /^Sources/ }).parentElement!
    expect(within(sources).getAllByRole('checkbox')).toEqual([incompatible, unavailable, orbit])
    fireEvent.click(unavailable)
    expect(screen.queryByRole('checkbox', { name: /missing-source/ })).toBeNull()
    expect(incompatible).toBeChecked()
    expect(orbit).toBeChecked()
    fireEvent.click(incompatible)
    expect(screen.queryByRole('checkbox', { name: /Incompatible source/ })).toBeNull()
    expect(orbit).toBeChecked()
    fireEvent.change(screen.getByLabelText('Search compatible sources'), {
      target: { value: '' }
    })
    expect(screen.getAllByRole('checkbox', { name: /Orbit A/ })).toHaveLength(1)
  })

  it('retains advanced values while collapsed and reopened', async () => {
    const user = userEvent.setup()
    renderInspector()
    const skipHits = screen.getByLabelText('Skip hits')
    expect(skipHits).not.toBeVisible()
    await user.click(screen.getByTestId('analysis-advanced-toggle'))
    fireEvent.change(skipHits, { target: { value: '7' } })
    await user.click(screen.getByTestId('analysis-advanced-toggle'))
    expect(skipHits).not.toBeVisible()
    await user.click(screen.getByTestId('analysis-advanced-toggle'))
    expect(skipHits).toBeVisible()
    expect(skipHits).toHaveValue(7)
  })

  it('keeps blank custom event expressions blank and shows local validation errors', async () => {
    const onValidateAnalysisExpression = vi.fn(
      async ({
        expression,
        role
      }: {
        expression: string
        role: 'event' | 'observable'
      }) => {
        if (role === 'event' && expression === 'xyy') {
          throw new Error(
            'Event expression error: Unknown variable or parameter: xyy'
          )
        }
      }
    )
    renderInspector({ onValidateAnalysisExpression })

    const input = screen.getByTestId(
      'analysis-event-expression'
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-event-expression-error')
      ).toHaveTextContent('Expression is required.')
    })

    fireEvent.change(input, { target: { value: 'xyy' } })
    expect(input.value).toBe('xyy')
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-event-expression-error')
      ).toHaveTextContent('Unknown variable or parameter: xyy')
    })
  })

  it('adds removable positivity constraints with local validation', async () => {
    const onValidateAnalysisExpression = vi.fn(
      async ({ expression }: { expression: string }) => {
        if (expression === 'xyy') {
          throw new Error(
            'Event expression error: Unknown variable or parameter: xyy'
          )
        }
      }
    )
    renderInspector({ onValidateAnalysisExpression })

    fireEvent.click(screen.getByTestId('analysis-add-constraint'))
    const input = await screen.findByTestId('analysis-constraint-expression-0')
    expect(screen.queryByTestId('analysis-constraints-empty')).toBeNull()

    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-constraint-expression-error-0')
      ).toHaveTextContent('Expression is required.')
    })

    fireEvent.change(input, { target: { value: 'xyy' } })
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-constraint-expression-error-0')
      ).toHaveTextContent('Unknown variable or parameter: xyy')
    })

    fireEvent.click(screen.getByTestId('analysis-remove-constraint-0'))
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-constraints-empty')
      ).toBeInTheDocument()
    })
  })

  it('supports derived event sources and arbitrary delta-n hit offsets', async () => {
    renderInspector()

    fireEvent.change(screen.getByTestId('analysis-event-source-kind'), {
      target: { value: 'flow_derivative' }
    })
    await waitFor(() => {
      expect(
        screen.getByTestId('analysis-event-resolved-expression')
      ).toHaveTextContent('sigma * (y - x)')
    })

    const axisSelectors = screen.getAllByLabelText(
      'Axis value'
    ) as HTMLSelectElement[]
    fireEvent.change(axisSelectors[0], { target: { value: 'delta_time' } })

    const offsetInput = await screen.findByTestId('analysis-axis-hit-offset-x')
    fireEvent.change(offsetInput, { target: { value: '3' } })

    expect((offsetInput as HTMLInputElement).value).toBe('3')
    expect(screen.queryByText(/Using hit /)).not.toBeInTheDocument()
  })

  it('shows cobweb and identity-line controls for same-observable 2D event maps', async () => {
    renderInspector({
      config: {
        name: 'Logistic',
        equations: ['r * x * (1 - x)'],
        params: [3.2],
        paramNames: ['r'],
        varNames: ['x'],
        solver: 'rk4',
        type: 'map'
      }
    })
    await userEvent.setup().click(screen.getByTestId('analysis-advanced-toggle'))

    expect(screen.queryByText('Connect plotted hits')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show cobweb')).toBeInTheDocument()

    const identityToggle = screen.getByTestId(
      'analysis-show-identity-line'
    ) as HTMLInputElement
    expect(identityToggle.checked).toBe(true)
    expect(
      (screen.getByTestId('analysis-identity-line-color') as HTMLInputElement)
        .value
    ).toBe('#787878')
    expect(screen.getByTestId('analysis-identity-line-opacity')).toHaveValue(100)
    expect(
      (screen.getByTestId('analysis-identity-line-style') as HTMLSelectElement)
        .value
    ).toBe('dotted')

    fireEvent.click(identityToggle)
    fireEvent.change(screen.getByTestId('analysis-identity-line-color'), {
      target: { value: '#112233' }
    })
    fireEvent.change(screen.getByTestId('analysis-identity-line-opacity'), {
      target: { value: '45' }
    })
    fireEvent.change(screen.getByTestId('analysis-identity-line-style'), {
      target: { value: 'dashed' }
    })

    expect(identityToggle.checked).toBe(false)
    expect(
      (screen.getByTestId('analysis-identity-line-color') as HTMLInputElement)
        .value
    ).toBe('#112233')
    expect(screen.getByTestId('analysis-identity-line-opacity')).toHaveValue(45)
    expect(
      (screen.getByTestId('analysis-identity-line-style') as HTMLSelectElement)
        .value
    ).toBe('dashed')
  })

  it('shows cobweb and identity-line controls for delta-t axes at different hit offsets', async () => {
    renderInspector({
      viewportUpdate: {
        axes: {
          x: { kind: 'delta_time', hitOffset: 0, label: 'Delta t@n' },
          y: { kind: 'delta_time', hitOffset: 2, label: 'Delta t@n+2' },
          z: null
        }
      }
    })
    await userEvent.setup().click(screen.getByTestId('analysis-advanced-toggle'))

    expect(screen.queryByText('Connect plotted hits')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show cobweb')).toBeInTheDocument()
    expect(screen.getByLabelText('Show identity line')).toBeInTheDocument()
  })
})
