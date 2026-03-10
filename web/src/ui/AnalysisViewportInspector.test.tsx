import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { addAnalysisViewport, createSystem, updateAnalysisViewport } from '../system/model'
import { AnalysisViewportInspector } from './AnalysisViewportInspector'

function renderInspector(
  onValidateAnalysisExpression = vi.fn(() => Promise.resolve())
) {
  const base = createSystem({
    name: 'Lorenz',
    config: {
      name: 'Lorenz',
      equations: ['sigma * (y - x)', 'x * (rho - z) - y', 'x * y - beta * z'],
      params: [10, 28, 8 / 3],
      paramNames: ['sigma', 'rho', 'beta'],
      varNames: ['x', 'y', 'z'],
      solver: 'rk4',
      type: 'flow',
    },
  })
  const added = addAnalysisViewport(base, 'Event_Map_1')

  function Wrapper() {
    const [state, setState] = useState(added.system)
    const viewport = state.analysisViewports.find((entry) => entry.id === added.nodeId)
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
      async ({ expression, role }: { expression: string; role: 'event' | 'observable' }) => {
        if (role === 'event' && expression === 'xyy') {
          throw new Error('Event expression error: Unknown variable or parameter: xyy')
        }
      }
    )
    renderInspector(onValidateAnalysisExpression)

    const input = screen.getByTestId('analysis-event-expression') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    await waitFor(() => {
      expect(screen.getByTestId('analysis-event-expression-error')).toHaveTextContent(
        'Expression is required.'
      )
    })

    fireEvent.change(input, { target: { value: 'xyy' } })
    expect(input.value).toBe('xyy')
    await waitFor(() => {
      expect(screen.getByTestId('analysis-event-expression-error')).toHaveTextContent(
        'Unknown variable or parameter: xyy'
      )
    })
  })

  it('supports derived event sources and arbitrary delta-n hit offsets', async () => {
    renderInspector()

    fireEvent.change(screen.getByTestId('analysis-event-source-kind'), {
      target: { value: 'flow_derivative' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('analysis-event-resolved-expression')).toHaveTextContent(
        'sigma * (y - x)'
      )
    })

    const axisSelectors = screen.getAllByLabelText('Axis value') as HTMLSelectElement[]
    fireEvent.change(axisSelectors[0], { target: { value: 'delta_time' } })

    const offsetInput = await screen.findByTestId('analysis-axis-hit-offset-x')
    fireEvent.change(offsetInput, { target: { value: '3' } })

    expect((offsetInput as HTMLInputElement).value).toBe('3')
    expect(screen.queryByText(/Using hit /)).not.toBeInTheDocument()
  })
})
