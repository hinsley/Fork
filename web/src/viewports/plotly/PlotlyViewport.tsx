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

type PlotlyRelayoutEvent = Record<string, unknown>

type PlotlyEventTarget = HTMLDivElement & {
  on?: {
    (event: 'plotly_click', handler: (event: PlotlyClickEvent) => void): void
    (event: 'plotly_relayout', handler: (event: PlotlyRelayoutEvent) => void): void
  }
  removeListener?: {
    (event: 'plotly_click', handler: (event: PlotlyClickEvent) => void): void
    (event: 'plotly_relayout', handler: (event: PlotlyRelayoutEvent) => void): void
  }
  removeAllListeners?: (event: 'plotly_click' | 'plotly_relayout') => void
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

function bindPlotlyRelayout(
  node: HTMLDivElement,
  onRelayoutRef: MutableRefObject<((event: PlotlyRelayoutEvent) => void) | undefined>,
  relayoutHandlerRef: MutableRefObject<((event: PlotlyRelayoutEvent) => void) | null>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  clearPlotlyRelayout(node, relayoutHandlerRef)
  if (!onRelayoutRef.current) return

  const handler = (event: PlotlyRelayoutEvent) => {
    onRelayoutRef.current?.(event)
  }
  relayoutHandlerRef.current = handler
  target.on('plotly_relayout', handler)
}

function clearPlotlyRelayout(
  node: HTMLDivElement,
  relayoutHandlerRef: MutableRefObject<((event: PlotlyRelayoutEvent) => void) | null>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  if (target.removeAllListeners) {
    target.removeAllListeners('plotly_relayout')
  } else if (target.removeListener && relayoutHandlerRef.current) {
    target.removeListener('plotly_relayout', relayoutHandlerRef.current)
  }
  relayoutHandlerRef.current = null
}

export function PlotlyViewport({
  data,
  layout,
  testId = 'plotly-viewport',
  onPointClick,
  onRelayout,
  onResize,
}: {
  data: Data[]
  layout: Partial<Layout>
  testId?: string
  onPointClick?: (nodeId: string) => void
  onRelayout?: (event: PlotlyRelayoutEvent) => void
  onResize?: (size: { width: number; height: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(!isPlotlyLoaded())
  const [error, setError] = useState<string | null>(null)
  const onPointClickRef = useRef(onPointClick)
  const onRelayoutRef = useRef(onRelayout)
  const onResizeRef = useRef(onResize)
  const clickHandlerRef = useRef<((event: PlotlyClickEvent) => void) | null>(null)
  const relayoutHandlerRef = useRef<((event: PlotlyRelayoutEvent) => void) | null>(null)

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    onRelayoutRef.current = onRelayout
  }, [onRelayout])

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

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
        bindPlotlyRelayout(node, onRelayoutRef, relayoutHandlerRef)
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
        if (onResizeRef.current) {
          const rect = node.getBoundingClientRect()
          onResizeRef.current({ width: rect.width, height: rect.height })
        }
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
      clearPlotlyRelayout(node, relayoutHandlerRef)
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
