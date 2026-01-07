import { useEffect, useRef, useState } from 'react'
import type { Layout, Data } from 'plotly.js'
import { isPlotlyLoaded, preloadPlotly, purgePlot, renderPlot, resizePlot } from './plotlyAdapter'

export function PlotlyViewport({
  data,
  layout,
  testId = 'plotly-viewport',
}: {
  data: Data[]
  layout: Partial<Layout>
  testId?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(!isPlotlyLoaded())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    preloadPlotly()
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const controller = new AbortController()
    setError(null)
    setLoading(!isPlotlyLoaded())
    void renderPlot(node, data, layout, { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setLoading(false)
      })
    return () => {
      controller.abort()
      purgePlot(node)
    }
  }, [data, layout])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void resizePlot(node)
      })
    })
    observer.observe(node)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="plotly-viewport plotly-viewport--container">
      <div
        className="plotly-viewport__canvas"
        ref={containerRef}
        data-testid={testId}
        data-trace-count={data.length}
      />
      {loading ? <div className="plotly-viewport__overlay">Loading viewport…</div> : null}
      {error ? <div className="plotly-viewport__overlay is-error">{error}</div> : null}
    </div>
  )
}
