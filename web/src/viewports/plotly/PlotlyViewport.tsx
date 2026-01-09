import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Layout, Data } from 'plotly.js'
import { isPlotlyLoaded, preloadPlotly, purgePlot, renderPlot, resizePlot } from './plotlyAdapter'

type PlotlyClickEvent = {
  points?: Array<{
    data?: {
      uid?: string
    }
  }>
}

type PlotlyEventTarget = HTMLDivElement & {
  on?: (event: string, handler: (event: PlotlyClickEvent) => void) => void
  removeListener?: (event: string, handler: (event: PlotlyClickEvent) => void) => void
  removeAllListeners?: (event: string) => void
}

function bindPlotlyClick(
  node: HTMLDivElement,
  onPointClickRef: MutableRefObject<((nodeId: string) => void) | undefined>,
  clickHandlerRef: MutableRefObject<((event: PlotlyClickEvent) => void) | null>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  clearPlotlyClick(node, clickHandlerRef)
  if (!onPointClickRef.current) return

  const handler = (event: PlotlyClickEvent) => {
    const id = event?.points?.[0]?.data?.uid
    if (typeof id === 'string') {
      onPointClickRef.current?.(id)
    }
  }
  clickHandlerRef.current = handler
  target.on('plotly_click', handler)
}

function clearPlotlyClick(
  node: HTMLDivElement,
  clickHandlerRef: MutableRefObject<((event: PlotlyClickEvent) => void) | null>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  if (target.removeAllListeners) {
    target.removeAllListeners('plotly_click')
  } else if (target.removeListener && clickHandlerRef.current) {
    target.removeListener('plotly_click', clickHandlerRef.current)
  }
  clickHandlerRef.current = null
}

export function PlotlyViewport({
  data,
  layout,
  testId = 'plotly-viewport',
  onPointClick,
}: {
  data: Data[]
  layout: Partial<Layout>
  testId?: string
  onPointClick?: (nodeId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(!isPlotlyLoaded())
  const [error, setError] = useState<string | null>(null)
  const onPointClickRef = useRef(onPointClick)
  const clickHandlerRef = useRef<((event: PlotlyClickEvent) => void) | null>(null)

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    preloadPlotly()
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const controller = new AbortController()
    const runRender = async () => {
      if (controller.signal.aborted) return
      setError(null)
      setLoading(!isPlotlyLoaded())
      try {
        await renderPlot(node, data, layout, { signal: controller.signal })
        if (controller.signal.aborted) return
        setLoading(false)
        bindPlotlyClick(node, onPointClickRef, clickHandlerRef)
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setLoading(false)
      }
    }
    void runRender()
    return () => {
      controller.abort()
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

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    return () => {
      clearPlotlyClick(node, clickHandlerRef)
      purgePlot(node)
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
