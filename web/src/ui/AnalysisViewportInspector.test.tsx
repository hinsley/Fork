import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  addAnalysisViewport,
  createSystem,
  updateAnalysisViewport
} from '../system/model'
import type { SystemConfig } from '../system/types'
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

  it('shows cobweb and identity-line controls for same-observable 2D event maps', () => {
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
    expect(
      (screen.getByTestId('analysis-identity-line-style') as HTMLSelectElement)
        .value
    ).toBe('dotted')

    fireEvent.click(identityToggle)
    fireEvent.change(screen.getByTestId('analysis-identity-line-color'), {
      target: { value: '#112233' }
    })
    fireEvent.change(screen.getByTestId('analysis-identity-line-style'), {
      target: { value: 'dashed' }
    })

    expect(identityToggle.checked).toBe(false)
    expect(
      (screen.getByTestId('analysis-identity-line-color') as HTMLInputElement)
        .value
    ).toBe('#112233')
    expect(
      (screen.getByTestId('analysis-identity-line-style') as HTMLSelectElement)
        .value
    ).toBe('dashed')
  })

  it('shows cobweb and identity-line controls for delta-t axes at different hit offsets', () => {
    renderInspector({
      viewportUpdate: {
        axes: {
          x: { kind: 'delta_time', hitOffset: 0, label: 'Delta t@n' },
          y: { kind: 'delta_time', hitOffset: 2, label: 'Delta t@n+2' },
          z: null
        }
      }
    })

    expect(screen.queryByText('Connect plotted hits')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show cobweb')).toBeInTheDocument()
    expect(screen.getByLabelText('Show identity line')).toBeInTheDocument()
  })
})
