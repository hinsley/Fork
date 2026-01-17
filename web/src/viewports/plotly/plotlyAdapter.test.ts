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

const makeContainer = (uirevision: string, camera?: Record<string, unknown>) => {
  const container = document.createElement('div') as HTMLDivElement & {
    _fullLayout?: Record<string, unknown>
    layout?: Record<string, unknown>
  }
  container._fullLayout = {
    uirevision,
    scene: camera ? { camera } : {},
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
  })

  it('injects camera into react when uirevision is stable and layout omits camera', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const camera = { eye: { x: 1, y: 2, z: 3 } }
    const container = makeContainer('plot-1', camera)

    await renderPlot(container, [], { uirevision: 'plot-1', scene: { aspectmode: 'data' } })

    expect(reactSpy).toHaveBeenCalledTimes(1)
    expect(relayoutSpy).not.toHaveBeenCalled()
    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    const injected = layoutArg?.scene?.camera as { eye?: { x?: number; y?: number; z?: number } }
    expect(injected?.eye).toEqual(camera.eye)
  })

  it('does not override explicit camera in layout', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const camera = { eye: { x: 4, y: 5, z: 6 } }
    const container = makeContainer('plot-1', { eye: { x: 1, y: 2, z: 3 } })

    await renderPlot(container, [], { uirevision: 'plot-1', scene: { camera } })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    expect(layoutArg?.scene?.camera).toEqual(camera)
    expect(relayoutSpy).not.toHaveBeenCalled()
  })

  it('does not reapply camera when uirevision changes', async () => {
    const { reactSpy, relayoutSpy } = mockPlotly()
    const { renderPlot } = await loadAdapter()
    const container = makeContainer('plot-1', { eye: { x: 1, y: 2, z: 3 } })

    await renderPlot(container, [], { uirevision: 'plot-2', scene: { aspectmode: 'data' } })

    const layoutArg = reactSpy.mock.calls[0]?.[2] as { scene?: { camera?: unknown } }
    expect(layoutArg?.scene?.camera).toBeUndefined()
    expect(relayoutSpy).not.toHaveBeenCalled()
  })
})
