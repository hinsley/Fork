import { useCallback, useEffect, useMemo, useRef } from 'react'
import { relayoutPlot, resizePlot } from './plotlyAdapter'

export type PlotlyRelayoutEvent = Record<string, unknown>

type PlotViewportOptions = {
  containerRef: React.RefObject<HTMLDivElement>
  viewRevision?: number | string
  persistView?: boolean
  snapshotDebounceMs?: number
  initialView?: PlotlyRelayoutEvent | null
  onResize?: (size: { width: number; height: number }) => void
}

type PlotViewportState = {
  uirevision: string
  onRelayout?: (event: PlotlyRelayoutEvent) => void
  onPlotReady?: (node: HTMLDivElement) => void
}

const SNAPSHOT_STORE = new Map<string, PlotlyRelayoutEvent>()
const DEFAULT_SNAPSHOT_DEBOUNCE_MS = 160

function hasSnapshot(snapshot: PlotlyRelayoutEvent | null): boolean {
  return Boolean(snapshot && Object.keys(snapshot).length > 0)
}

function mergeSnapshots(
  base: PlotlyRelayoutEvent | null,
  next: PlotlyRelayoutEvent
): PlotlyRelayoutEvent {
  return { ...(base ?? {}), ...next }
}

function extractViewSnapshot(event: PlotlyRelayoutEvent): PlotlyRelayoutEvent | null {
  const snapshot: PlotlyRelayoutEvent = {}
  for (const [key, value] of Object.entries(event)) {
    if (key.startsWith('scene.camera')) {
      snapshot[key] = value
      continue
    }
    if (
      key.startsWith('scene.xaxis') ||
      key.startsWith('scene.yaxis') ||
      key.startsWith('scene.zaxis')
    ) {
      if (key.includes('range') || key.endsWith('autorange')) {
        snapshot[key] = value
      }
      continue
    }
    if (key.startsWith('xaxis') || key.startsWith('yaxis')) {
      if (key.includes('range') || key.endsWith('autorange')) {
        snapshot[key] = value
      }
    }
  }
  return hasSnapshot(snapshot) ? snapshot : null
}

export function usePlotViewport(plotId: string, options: PlotViewportOptions): PlotViewportState {
  const {
    containerRef,
    viewRevision = 0,
    persistView = false,
    snapshotDebounceMs = DEFAULT_SNAPSHOT_DEBOUNCE_MS,
    initialView = null,
    onResize,
  } = options
  const snapshotKey = useMemo(() => `${plotId}:${String(viewRevision)}`, [plotId, viewRevision])
  const onResizeRef = useRef(onResize)
  const debounceRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<PlotlyRelayoutEvent | null>(null)
  const initialViewRef = useRef<PlotlyRelayoutEvent | null>(initialView)
  const restorePendingRef = useRef(false)
  const restoredRef = useRef(false)
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  useEffect(() => {
    initialViewRef.current = initialView
  }, [snapshotKey])

  useEffect(() => {
    restoredRef.current = false
    pendingSnapshotRef.current = null
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    restorePendingRef.current =
      persistView && (Boolean(initialViewRef.current) || SNAPSHOT_STORE.has(snapshotKey))
  }, [persistView, snapshotKey])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let frame = 0
    lastSizeRef.current = null
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect()
        const width = rect.width
        const height = rect.height
        const prev = lastSizeRef.current
        if (
          prev &&
          Math.abs(prev.width - width) < 0.5 &&
          Math.abs(prev.height - height) < 0.5
        ) {
          return
        }
        lastSizeRef.current = { width, height }
        void resizePlot(node)
        onResizeRef.current?.({ width, height })
      })
    })
    observer.observe(node)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [containerRef])

  const handleRelayout = useCallback(
    (event: PlotlyRelayoutEvent) => {
      if (!persistView) return
      if (restorePendingRef.current) return
      const snapshot = extractViewSnapshot(event)
      if (!snapshot) return
      const base = pendingSnapshotRef.current ?? SNAPSHOT_STORE.get(snapshotKey) ?? null
      pendingSnapshotRef.current = mergeSnapshots(base, snapshot)
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
      debounceRef.current = window.setTimeout(() => {
        const merged = pendingSnapshotRef.current
        if (hasSnapshot(merged)) {
          SNAPSHOT_STORE.set(snapshotKey, merged)
        }
        pendingSnapshotRef.current = null
        debounceRef.current = null
      }, snapshotDebounceMs)
    },
    [persistView, snapshotDebounceMs, snapshotKey]
  )

  const handlePlotReady = useCallback(
    (node: HTMLDivElement) => {
      if (restoredRef.current) return
      restoredRef.current = true
      restorePendingRef.current = false
      if (!persistView) return
      const snapshot = SNAPSHOT_STORE.get(snapshotKey) ?? initialViewRef.current
      if (!hasSnapshot(snapshot)) return
      void relayoutPlot(node, snapshot)
    },
    [persistView, snapshotKey]
  )

  return {
    uirevision: snapshotKey,
    onRelayout: persistView ? handleRelayout : undefined,
    onPlotReady: handlePlotReady,
  }
}
