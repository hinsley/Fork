import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { Layout, Data } from 'plotly.js'
import {
  capturePlotImage,
  isPlotlyLoaded,
  preloadPlotly,
  purgePlot,
  renderPlot,
} from './plotlyAdapter'
import { usePlotViewport, type PlotlyRelayoutEvent } from './usePlotViewport'
import {
  capturePlotlyFigure,
  figureNeedsStaticWebGlFallback,
  type PlotlyFigureCaptureState,
} from './figureCapture'

type PlotlyClickEvent = {
  points?: Array<{
    data?: {
      uid?: string
    }
    pointIndex?: number
    pointNumber?: number
    customdata?: unknown
    x?: number
    y?: number
    z?: number
  }>
}

export type PlotlyPointClick = {
  uid?: string
  pointIndex?: number
  customdata?: unknown
  x?: number
  y?: number
  z?: number
}

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
  onPointClickRef: MutableRefObject<((point: PlotlyPointClick) => void) | undefined>,
  clickHandlerRef: MutableRefObject<((event: PlotlyClickEvent) => void) | null>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  clearPlotlyClick(node, clickHandlerRef)
  if (!onPointClickRef.current) return

  const handler = (event: PlotlyClickEvent) => {
    const point = event?.points?.[0]
    if (!point) return
    const pointIndex =
      typeof point.pointIndex === 'number'
        ? point.pointIndex
        : typeof point.pointNumber === 'number'
          ? point.pointNumber
          : undefined
    onPointClickRef.current?.({
      uid: point.data?.uid,
      pointIndex,
      customdata: point.customdata,
      x: point.x,
      y: point.y,
      z: point.z,
    })
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
  relayoutHandlerRef: MutableRefObject<((event: PlotlyRelayoutEvent) => void) | null>,
  ignoreRef?: MutableRefObject<boolean>
) {
  const target = node as PlotlyEventTarget
  if (!target.on) return
  clearPlotlyRelayout(node, relayoutHandlerRef)
  if (!onRelayoutRef.current) return

  const handler = (event: PlotlyRelayoutEvent) => {
    if (ignoreRef?.current) return
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
  plotId,
  data,
  layout,
  viewRevision = 0,
  persistView = false,
  initialView = null,
  testId = 'plotly-viewport',
  onPointClick,
  onResize,
  captureEnabled = false,
  captureStaticFallback = false,
  onFigureCapture,
}: {
  plotId: string
  data: Data[]
  layout: Partial<Layout>
  viewRevision?: number | string
  persistView?: boolean
  initialView?: PlotlyRelayoutEvent | null
  testId?: string
  onPointClick?: (point: PlotlyPointClick) => void
  onResize?: (size: { width: number; height: number }) => void
  captureEnabled?: boolean
  captureStaticFallback?: boolean
  onFigureCapture?: (state: PlotlyFigureCaptureState) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(!isPlotlyLoaded())
  const [error, setError] = useState<string | null>(null)
  const onPointClickRef = useRef(onPointClick)
  const onRelayoutRef = useRef<((event: PlotlyRelayoutEvent) => void) | undefined>(undefined)
  const onPlotReadyRef = useRef<((node: HTMLDivElement) => Promise<void>) | undefined>(undefined)
  const onFigureCaptureRef = useRef(onFigureCapture)
  const clickHandlerRef = useRef<((event: PlotlyClickEvent) => void) | null>(null)
  const relayoutHandlerRef = useRef<((event: PlotlyRelayoutEvent) => void) | null>(null)
  const renderInFlightRef = useRef(false)
  const { uirevision, onRelayout, onPlotReady } = usePlotViewport(plotId, {
    containerRef,
    viewRevision,
    persistView,
    initialView,
    onResize,
  })
  const layoutWithUirevision = useMemo(() => {
    const nextLayout: Partial<Layout> = { ...layout, uirevision }
    if (layout.scene) {
      nextLayout.scene = {
        ...layout.scene,
        uirevision,
      } as Partial<Layout['scene']> & { uirevision?: string }
    }
    return nextLayout
  }, [layout, uirevision])

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    onFigureCaptureRef.current = onFigureCapture
  }, [onFigureCapture])

  useEffect(() => {
    onRelayoutRef.current = onRelayout
  }, [onRelayout])

  useEffect(() => {
    onPlotReadyRef.current = onPlotReady
  }, [onPlotReady])

  useEffect(() => {
    preloadPlotly()
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const controller = new AbortController()
    const runRender = async () => {
      if (controller.signal.aborted) return
      renderInFlightRef.current = true
      if (captureEnabled) {
        onFigureCaptureRef.current?.({ plotId, status: 'rendering' })
      }
      setError(null)
      setLoading(!isPlotlyLoaded())
      try {
        await renderPlot(node, data, layoutWithUirevision, { signal: controller.signal })
        if (controller.signal.aborted) return
        setLoading(false)
        bindPlotlyClick(node, onPointClickRef, clickHandlerRef)
        bindPlotlyRelayout(node, onRelayoutRef, relayoutHandlerRef, renderInFlightRef)
        await onPlotReadyRef.current?.(node)
        if (controller.signal.aborted) return
        if (captureEnabled) {
          const figure = capturePlotlyFigure(node)
          const fallbackImage =
            captureStaticFallback && figureNeedsStaticWebGlFallback(figure)
              ? await capturePlotImage(node)
              : undefined
          if (controller.signal.aborted) return
          onFigureCaptureRef.current?.({
            plotId,
            status: 'ready',
            figure,
            ...(fallbackImage ? { fallbackImage } : {}),
          })
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setLoading(false)
        if (captureEnabled) {
          onFigureCaptureRef.current?.({ plotId, status: 'error', message })
        }
      } finally {
        renderInFlightRef.current = false
      }
    }
    void runRender()
    return () => {
      controller.abort()
    }
  }, [captureEnabled, captureStaticFallback, data, layoutWithUirevision, plotId])

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
