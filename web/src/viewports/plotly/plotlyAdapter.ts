import type { Layout, Data } from 'plotly.js'

type PlotlyModule = {
  relayout?: (container: HTMLElement, update: Record<string, unknown>) => MaybePromise<void>
  react: (
    container: HTMLElement,
    data: Data[],
    layout: Partial<Layout>,
    config: {
      displaylogo: boolean
      displayModeBar: boolean
      responsive: boolean
      scrollZoom: boolean
      doubleClick: boolean
    }
  ) => Promise<void>
  purge: (container: HTMLElement) => void
  Plots?: {
    resize: (container: HTMLElement) => MaybePromise<void>
  }
}

let plotlyModule: PlotlyModule | null = null
let plotlyPromise: Promise<PlotlyModule> | null = null

type CameraVector = { x: number; y: number; z: number }
type CameraSpec = { eye: CameraVector; up?: CameraVector; center?: CameraVector }
type MaybePromise<T> = T | Promise<T>
type ArrayLike3 = { 0: unknown; 1: unknown; 2: unknown; length: number }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function vectorShape(value: unknown): string {
  if (!value) return 'missing'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (isFiniteNumber(obj.x) && isFiniteNumber(obj.y) && isFiniteNumber(obj.z)) {
      return 'object'
    }
    if ('0' in obj || '1' in obj || '2' in obj) return 'array-like'
  }
  return typeof value
}

function isArrayLike3(value: unknown): value is ArrayLike3 {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.length >= 3
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    const length = (value as { length?: number }).length
    return typeof length === 'number' && length >= 3
  }
  const obj = value as Record<string, unknown>
  if (!('length' in obj)) return false
  const length = obj.length
  return (
    typeof length === 'number' &&
    length >= 3 &&
    '0' in obj &&
    '1' in obj &&
    '2' in obj
  )
}

function toVector(value: unknown): CameraVector | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (isFiniteNumber(obj.x) && isFiniteNumber(obj.y) && isFiniteNumber(obj.z)) {
    return { x: obj.x, y: obj.y, z: obj.z }
  }
  if (isArrayLike3(value)) {
    const x = value[0]
    const y = value[1]
    const z = value[2]
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z)) {
      return { x, y, z }
    }
  }
  return null
}

function toCameraSpec(camera: unknown): CameraSpec | null {
  if (!camera || typeof camera !== 'object') return null
  const obj = camera as Record<string, unknown>
  const eye = toVector(obj.eye)
  if (!eye) return null
  const up = toVector(obj.up)
  const center = toVector(obj.center)
  const spec: CameraSpec = { eye }
  if (up) spec.up = up
  if (center) spec.center = center
  return spec
}

function cameraShape(camera: unknown) {
  if (!camera || typeof camera !== 'object') {
    return { present: false }
  }
  const obj = camera as Record<string, unknown>
  return {
    present: true,
    eye: vectorShape(obj.eye),
    up: vectorShape(obj.up),
    center: vectorShape(obj.center),
  }
}

function isGuardDebugEnabled() {
  if (typeof window === 'undefined') return false
  const win = window as { __E2E__?: boolean }
  if (win.__E2E__) return true
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
}

function logGuard(message: string, payload: Record<string, unknown>) {
  if (!isGuardDebugEnabled()) return
  if (typeof console === 'undefined') return
  // eslint-disable-next-line no-console
  console.log('plotly-camera-guard', message, payload)
}

function unwrapPlotly(mod: unknown): PlotlyModule {
  const candidate = (mod as { default?: PlotlyModule }).default ?? mod
  return candidate as PlotlyModule
}

async function loadPlotly(): Promise<PlotlyModule> {
  if (plotlyModule) return plotlyModule
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min').then((mod) => {
      plotlyModule = unwrapPlotly(mod)
      if (typeof window !== 'undefined') {
        ;(window as unknown as { Plotly?: PlotlyModule }).Plotly = plotlyModule
      }
      return plotlyModule
    })
  }
  return plotlyPromise
}

export function preloadPlotly() {
  void loadPlotly()
}

export function isPlotlyLoaded() {
  return Boolean(plotlyModule)
}

export async function renderPlot(
  container: HTMLElement,
  data: Data[],
  layout: Partial<Layout>,
  opts?: { signal?: AbortSignal }
) {
  const Plotly = await loadPlotly()
  if (opts?.signal?.aborted) return
  const sceneKeys = Object.keys(layout).filter((key) => key.startsWith('scene'))
  const hasScene = sceneKeys.length > 0
  const layoutHasCamera = sceneKeys.some((key) => {
    const value = layout[key as keyof Layout]
    if (!value || typeof value !== 'object') return false
    return 'camera' in (value as Record<string, unknown>)
  })
  const layoutUirevision =
    typeof layout.uirevision === 'string' || typeof layout.uirevision === 'number'
      ? String(layout.uirevision)
      : null
  const existingUirevision = (() => {
    const candidate = container as HTMLElement & {
      layout?: { uirevision?: string | number }
      _fullLayout?: { uirevision?: string | number }
    }
    const value = candidate.layout?.uirevision ?? candidate._fullLayout?.uirevision
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return null
  })()
  // Plotly.react can reset 3D camera on the first style update even when uirevision is stable.
  // Guard by injecting a valid pre-react camera spec when uirevision matches and layout omits
  // camera. This avoids model persistence or continuous camera injection; remove if Plotly changes.
  const shouldPreserveCamera =
    hasScene && !layoutHasCamera && layoutUirevision && existingUirevision === layoutUirevision
  let layoutToRender = layout
  if (shouldPreserveCamera) {
    try {
      const nextLayout: Partial<Layout> & Record<string, unknown> = { ...layout }
      let injected = false
      for (const key of sceneKeys) {
        const source = layout[key as keyof Layout]
        if (!source || typeof source !== 'object') continue
        const candidate = container as HTMLElement & {
          _fullLayout?: Record<string, unknown>
        }
        const scene = candidate._fullLayout?.[key] as
          | { camera?: Record<string, unknown>; _scene?: { camera?: Record<string, unknown> } }
          | undefined
        const camera = scene?._scene?.camera ?? scene?.camera ?? null
        const spec = toCameraSpec(camera)
        logGuard('inject', {
          sceneKey: key,
          camera: cameraShape(camera),
          valid: Boolean(spec),
        })
        if (!spec) continue
        const sceneLayout = { ...(source as Record<string, unknown>), camera: spec }
        nextLayout[key] = sceneLayout
        injected = true
      }
      if (injected) {
        layoutToRender = nextLayout
      }
    } catch (err) {
      const message = err instanceof Error ? err.stack ?? err.message : String(err)
      logGuard('inject-error', { error: message })
    }
  }
  await Plotly.react(container, data, layoutToRender, {
    displaylogo: false,
    displayModeBar: true,
    responsive: true,
    scrollZoom: true,
    doubleClick: false,
  })
}

export async function resizePlot(container: HTMLElement) {
  const Plotly = await loadPlotly()
  if (Plotly.Plots?.resize) {
    await Plotly.Plots.resize(container)
  }
}

export async function relayoutPlot(container: HTMLElement, update: Record<string, unknown>) {
  const Plotly = await loadPlotly()
  if (Plotly.relayout) {
    await Plotly.relayout(container, update)
  }
}

export function purgePlot(container: HTMLElement) {
  if (!plotlyModule) return
  plotlyModule.purge(container)
}
