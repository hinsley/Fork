import { describe, expect, it } from 'vitest'
import {
  capturePlotlyFigure,
  figureNeedsStaticWebGlFallback,
  makeBundledFigureWebGlCompatible,
} from './figureCapture'

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

  it('converts 2D scattergl traces to SVG scatter without mutating the capture', () => {
    const figure = {
      data: [
        {
          type: 'scattergl' as const,
          mode: 'lines+markers' as const,
          x: [1, 2],
          y: [3, 4],
          customdata: ['a', 'b'],
        },
      ],
      layout: { title: { text: 'Event map' } },
    }

    const compatible = makeBundledFigureWebGlCompatible(figure)

    expect(compatible.data[0]).toMatchObject({
      type: 'scatter',
      mode: 'lines+markers',
      x: [1, 2],
      y: [3, 4],
      customdata: ['a', 'b'],
    })
    expect(figure.data[0]?.type).toBe('scattergl')
  })

  it('identifies true 3D traces that need a static fallback without WebGL', () => {
    expect(
      figureNeedsStaticWebGlFallback({
        data: [{ type: 'scatter3d', x: [1], y: [2], z: [3] }],
        layout: {},
      })
    ).toBe(true)
    expect(
      figureNeedsStaticWebGlFallback({
        data: [{ type: 'scattergl', x: [1], y: [2] }],
        layout: {},
      })
    ).toBe(false)
  })
})
