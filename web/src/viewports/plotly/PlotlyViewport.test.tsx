import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlotlyViewport } from './PlotlyViewport'
import { purgePlot, relayoutPlot, renderPlot } from './plotlyAdapter'

describe('PlotlyViewport', () => {
  it('injects uirevision into layout and scene', async () => {
    vi.clearAllMocks()

    render(
      <PlotlyViewport
        plotId="plot-1"
        data={[]}
        layout={{ scene: { aspectmode: 'data' } }}
        viewRevision={3}
        persistView={false}
      />
    )

    await waitFor(() => {
      expect(renderPlot).toHaveBeenCalled()
    })

    const layout = vi.mocked(renderPlot).mock.calls[0]?.[2] as {
      uirevision?: string
      scene?: { uirevision?: string; aspectmode?: string }
    }

    expect(layout.uirevision).toBe('plot-1:3')
    expect(layout.scene?.uirevision).toBe('plot-1:3')
    expect(layout.scene?.aspectmode).toBe('data')
  })

  it('does not reapply initial view on data-only updates', async () => {
    vi.clearAllMocks()
    const initialView = {
      'scene.camera': {
        eye: { x: 1, y: 2, z: 3 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    }

    const { rerender } = render(
      <PlotlyViewport
        plotId="plot-3d"
        data={[{ type: 'scatter3d', x: [0], y: [0], z: [0] }]}
        layout={{ scene: { aspectmode: 'data' } }}
        viewRevision={1}
        persistView
        initialView={initialView}
      />
    )

    await waitFor(() => {
      expect(renderPlot).toHaveBeenCalledTimes(1)
    })
    expect(relayoutPlot).toHaveBeenCalledTimes(1)
    vi.mocked(relayoutPlot).mockClear()

    rerender(
      <PlotlyViewport
        plotId="plot-3d"
        data={[{ type: 'scatter3d', x: [0, 1], y: [0, 1], z: [0, 1] }]}
        layout={{ scene: { aspectmode: 'data' } }}
        viewRevision={1}
        persistView
        initialView={initialView}
      />
    )

    await waitFor(() => {
      expect(renderPlot).toHaveBeenCalledTimes(2)
    })

    const firstLayout = vi.mocked(renderPlot).mock.calls[0]?.[2] as {
      uirevision?: string
      scene?: { uirevision?: string; camera?: unknown }
    }
    const secondLayout = vi.mocked(renderPlot).mock.calls[1]?.[2] as {
      uirevision?: string
      scene?: { uirevision?: string; camera?: unknown }
    }

    expect(firstLayout.scene?.camera).toBeUndefined()
    expect(secondLayout.scene?.camera).toBeUndefined()
    expect(secondLayout.uirevision).toBe(firstLayout.uirevision)
    expect(secondLayout.scene?.uirevision).toBe(firstLayout.scene?.uirevision)
    expect(relayoutPlot).not.toHaveBeenCalled()
  })

  it('keeps the same graph div on style-only updates', async () => {
    vi.clearAllMocks()

    const { rerender } = render(
      <PlotlyViewport
        plotId="plot-node"
        data={[{ type: 'scatter3d', x: [0], y: [0], z: [0] }]}
        layout={{ scene: { aspectmode: 'data' } }}
        viewRevision={0}
        persistView
        testId="plotly-viewport-node"
      />
    )

    const node = await waitFor(() => {
      const target = document.querySelector('[data-testid="plotly-viewport-node"]')
      expect(target).toBeTruthy()
      return target as HTMLElement
    })

    rerender(
      <PlotlyViewport
        plotId="plot-node"
        data={[{ type: 'scatter3d', x: [0, 1], y: [0, 1], z: [0, 1] }]}
        layout={{ scene: { aspectmode: 'data' } }}
        viewRevision={0}
        persistView
        testId="plotly-viewport-node"
      />
    )

    const nextNode = document.querySelector(
      '[data-testid="plotly-viewport-node"]'
    ) as HTMLElement | null

    expect(nextNode).toBe(node)
    expect(purgePlot).not.toHaveBeenCalled()
  })
})
