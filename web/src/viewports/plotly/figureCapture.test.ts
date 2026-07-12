import { describe, expect, it } from 'vitest'
import { capturePlotlyFigure } from './figureCapture'

describe('Plotly figure capture', () => {
  it('uses public graph fields and strips Fork-only identity and revision values', () => {
    const node = document.createElement('div') as HTMLDivElement & {
      data: unknown[]
      layout: object
      _fullData: unknown[]
    }
    node.data = [
      {
        type: 'scatter',
        uid: 'private-object-id',
        x: new Float64Array([1, 2]),
        y: [3, Number.NaN],
      },
    ]
    node.layout = {
      uirevision: 'fork-preview:1',
      scene: { uirevision: 'fork-preview:1', aspectmode: 'data' },
    }
    node._fullData = [{ secret: 'internal Plotly state' }]

    expect(capturePlotlyFigure(node)).toEqual({
      data: [{ type: 'scatter', x: [1, 2], y: [3, null] }],
      layout: { scene: { aspectmode: 'data' } },
    })
  })

  it('rejects a graph that has not rendered', () => {
    expect(() => capturePlotlyFigure(document.createElement('div'))).toThrow(
      'not ready to export'
    )
  })
})
