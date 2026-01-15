import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlotViewport } from './usePlotViewport'
import { relayoutPlot, resizePlot } from './plotlyAdapter'

describe('usePlotViewport', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns a stable uirevision key and skips restore when disabled', () => {
    const container = document.createElement('div')
    const containerRef = { current: container }
    const { result } = renderHook(() => usePlotViewport('plot-basic', { containerRef }))

    expect(result.current.uirevision).toBe('plot-basic:0')
    expect(result.current.onRelayout).toBeUndefined()

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).not.toHaveBeenCalled()
  })

  it('captures relayout snapshots and restores once', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const containerRef = { current: container }
    const { result } = renderHook(() =>
      usePlotViewport('plot-snapshot', {
        containerRef,
        persistView: true,
        snapshotDebounceMs: 0,
      })
    )

    act(() => {
      result.current.onRelayout?.({ 'xaxis.range': [0, 1] })
    })

    act(() => {
      vi.runAllTimers()
    })

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).toHaveBeenCalledWith(container, { 'xaxis.range': [0, 1] })
    vi.mocked(relayoutPlot).mockClear()

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).not.toHaveBeenCalled()
  })

  it('does not restore snapshots from a different viewRevision', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const containerRef = { current: container }

    const { result, rerender } = renderHook(
      ({ revision }) =>
        usePlotViewport('plot-revision', {
          containerRef,
          persistView: true,
          snapshotDebounceMs: 0,
          viewRevision: revision,
        }),
      { initialProps: { revision: 0 } }
    )

    act(() => {
      result.current.onRelayout?.({ 'xaxis.range': [1, 2] })
    })

    act(() => {
      vi.runAllTimers()
    })

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).toHaveBeenCalledTimes(1)
    vi.mocked(relayoutPlot).mockClear()

    rerender({ revision: 1 })

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).not.toHaveBeenCalled()
  })

  it('applies initialView once and ignores pre-restore relayout', () => {
    const container = document.createElement('div')
    const containerRef = { current: container }
    const initialView = { 'xaxis.range': [0, 1] }
    const { result } = renderHook(() =>
      usePlotViewport('plot-initial', {
        containerRef,
        persistView: true,
        initialView,
      })
    )

    act(() => {
      result.current.onRelayout?.({ 'xaxis.range': [2, 3] })
    })

    act(() => {
      result.current.onPlotReady?.(container)
    })

    expect(relayoutPlot).toHaveBeenCalledTimes(1)
    expect(relayoutPlot).toHaveBeenCalledWith(container, initialView)
  })

  it('resizes the plot when the container changes size', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    const observers: Array<{ callback: ResizeObserverCallback }> = []

    class MockResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observers.push(this)
      }

      observe = vi.fn()
      disconnect = vi.fn()
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

    try {
      const container = document.createElement('div')
      container.getBoundingClientRect = (() =>
        ({ width: 640, height: 480 } as DOMRect)) as typeof container.getBoundingClientRect
      const containerRef = { current: container }
      const onResize = vi.fn()

      renderHook(() =>
        usePlotViewport('plot-resize', {
          containerRef,
          persistView: false,
          onResize,
        })
      )

      act(() => {
        observers[0]?.callback([], observers[0] as unknown as ResizeObserver)
      })

      expect(resizePlot).toHaveBeenCalledWith(container)
      expect(onResize).toHaveBeenCalledWith({ width: 640, height: 480 })
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
    }
  })

  it('skips resize when the container size is unchanged', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    const observers: Array<{ callback: ResizeObserverCallback }> = []

    class MockResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        observers.push(this)
      }

      observe = vi.fn()
      disconnect = vi.fn()
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

    try {
      vi.mocked(resizePlot).mockClear()
      const container = document.createElement('div')
      container.getBoundingClientRect = (() =>
        ({ width: 720, height: 480 } as DOMRect)) as typeof container.getBoundingClientRect
      const containerRef = { current: container }
      const onResize = vi.fn()

      renderHook(() =>
        usePlotViewport('plot-resize-skip', {
          containerRef,
          persistView: false,
          onResize,
        })
      )

      act(() => {
        observers[0]?.callback([], observers[0] as unknown as ResizeObserver)
      })
      act(() => {
        observers[0]?.callback([], observers[0] as unknown as ResizeObserver)
      })

      expect(resizePlot).toHaveBeenCalledTimes(1)
      expect(onResize).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
    }
  })
})
