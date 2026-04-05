import { beforeEach, describe, expect, it, vi } from 'vitest'

type PlotlyMock = {
  react: ReturnType<typeof vi.fn>
  relayout: ReturnType<typeof vi.fn>
  purge: ReturnType<typeof vi.fn>
  Plots: {
    resize: ReturnType<typeof vi.fn>
  }
}

type PlotlyMockBundle = {
  plotly: PlotlyMock
  reactSpy: PlotlyMock['react']
  relayoutSpy: PlotlyMock['relayout']
}

const makeContainer = (uirevision: string, scene: Record<string, unknown> = {}) => {
  const container = document.createElement('div') as HTMLDivElement & {
    _fullLayout?: Record<string, unknown>
    layout?: Record<string, unknown>
  }
  container._fullLayout = {
    uirevision,
    scene,
  }
  return container
}

const mockPlotly = (): PlotlyMockBundle => {
  const reactSpy = vi.fn(() => Promise.resolve())
  const relayoutSpy = vi.fn(() => Promise.resolve())
  const plotly = {
    react: reactSpy,
    relayout: relayoutSpy,
    purge: vi.fn(),
    Plots: {
      resize: vi.fn(() => Promise.resolve()),
    },
  }
  vi.doMock('plotly.js-dist-min', () => ({ default: plotly }))
  return { plotly, reactSpy, relayoutSpy }
}

const loadAdapter = async () => {
  const module = await import('./plotlyAdapter')
  return module
}

describe('plotlyAdapter camera guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unmock('./plotlyAdapter')
    delete (window as Window & { MathJax?: unknown }).MathJax
  })

  it('injects camera into react when uirevision is stable and layout omits camera', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const camera = { eye: { x: 1, y: 2, z: 3 } }
    const container = makeContainer('plot-1', { camera })

    await renderPlot(container, [], { uirevision: 'plot-1', scene: { aspectmode: 'data' } })

    expect(reactSpy).toHaveBeenCalledTimes(1)
    expect(relayoutSpy).not.toHaveBeenCalled()
    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    const configArg = reactSpy.mock.calls[0]?.[3] as { typesetMath?: boolean }
    const injected = layoutArg?.scene?.camera as { eye?: { x?: number; y?: number; z?: number } }
    expect(injected?.eye).toEqual(camera.eye)
    expect(configArg?.typesetMath).toBe(true)
  })

  it('does not override explicit camera in layout', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const camera = { eye: { x: 4, y: 5, z: 6 } }
    const container = makeContainer('plot-1', { camera: { eye: { x: 1, y: 2, z: 3 } } })

    await renderPlot(container, [], { uirevision: 'plot-1', scene: { camera } })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    expect(layoutArg?.scene?.camera).toEqual(camera)
    expect(relayoutSpy).not.toHaveBeenCalled()
  })

  it('does not reapply camera when uirevision changes', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const container = makeContainer('plot-1', { camera: { eye: { x: 1, y: 2, z: 3 } } })

    await renderPlot(container, [], { uirevision: 'plot-2', scene: { aspectmode: 'data' } })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    expect(layoutArg?.scene?.camera).toBeUndefined()
    expect(relayoutSpy).not.toHaveBeenCalled()
  })

  it('normalizes mixed MathJax text in 2D titles before rendering', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const container = makeContainer('plot-1')

    await renderPlot(container, [], {
      xaxis: { title: { text: '$z_{n+1}$+2' } },
      yaxis: { title: { text: 'plain y' } },
    })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as {
      xaxis?: { title?: { text?: string } }
      yaxis?: { title?: { text?: string } }
    }
    expect(layoutArg?.xaxis?.title?.text).toBe('$z_{n+1}+2$')
    expect(layoutArg?.yaxis?.title?.text).toBe('plain y')
    expect(relayoutSpy).not.toHaveBeenCalled()
  })

  it('replaces 3D scene titles containing MathJax markup with scene annotations', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const container = makeContainer('plot-1', {
      xaxis: { range: [0, 10] },
      yaxis: { range: [-2, 2] },
      zaxis: { range: [5, 9] },
    })

    await renderPlot(container, [], {
      scene: {
        xaxis: { title: { text: 'value \\(y\\)', font: { color: '#123456', size: 17 } } },
        yaxis: { title: { text: 'plain y' } },
        zaxis: { title: { text: '$z_{n+1}$+2' } },
      },
    })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as {
      scene?: {
        xaxis?: { title?: { text?: string } }
        yaxis?: { title?: { text?: string } }
        zaxis?: { title?: { text?: string } }
        annotations?: unknown[]
      }
    }
    expect(layoutArg?.scene?.xaxis?.title?.text).toBe('')
    expect(layoutArg?.scene?.yaxis?.title?.text).toBe('plain y')
    expect(layoutArg?.scene?.zaxis?.title?.text).toBe('')
    expect(layoutArg?.scene?.annotations).toEqual([])

    expect(relayoutSpy).toHaveBeenCalledTimes(1)
    const relayoutArg = relayoutSpy.mock.calls[0]?.[1] as Record<string, unknown>
    const annotations = relayoutArg['scene.annotations'] as Array<Record<string, unknown>>
    expect(annotations).toHaveLength(2)
    expect(annotations[0]).toMatchObject({
      text: '$\\text{value }y$',
      showarrow: false,
      font: { color: '#123456', size: 17 },
      x: 10.8,
      y: -2,
      z: 5,
    })
    expect(annotations[1]).toMatchObject({
      text: '$z_{n+1}+2$',
      showarrow: false,
      x: 0,
      y: -2,
      z: 9.32,
    })
  })
})
