import type { Layout, Data } from 'plotly.js'
import { ensureMathJaxReady, preloadMathJax } from './mathJaxLoader'
import { containsMathJaxMarkup, normalizeMathJaxForPlotly } from '../../utils/mathText'

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
      typesetMath: boolean
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
type SceneAxisKey = 'xaxis' | 'yaxis' | 'zaxis'
type SceneMathTitleSpec = {
  axis: SceneAxisKey
  text: string
  fontColor?: string
  fontSize?: number
}
type SceneMathTitleFallback = {
  sceneKey: string
  baseAnnotations: unknown[]
  titles: SceneMathTitleSpec[]
}
type PlotlyContainer = HTMLElement & {
  layout?: { uirevision?: string | number }
  _fullLayout?: Record<string, unknown>
}

const SCENE_AXIS_KEYS: SceneAxisKey[] = ['xaxis', 'yaxis', 'zaxis']
const sceneMathTitleKeys = new WeakMap<HTMLElement, Set<string>>()

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
  console.log('plotly-camera-guard', message, payload)
}

function unwrapPlotly(mod: unknown): PlotlyModule {
  const candidate = (mod as { default?: PlotlyModule }).default ?? mod
  return candidate as PlotlyModule
}

function cloneSceneAnnotations(sceneLayout: Record<string, unknown>): unknown[] {
  const annotations = sceneLayout.annotations
  return Array.isArray(annotations) ? [...annotations] : []
}

function extractSceneAxisTitle(
  sceneLayout: Record<string, unknown>,
  axisKey: SceneAxisKey
): { text: string; font: Record<string, unknown> | null } | null {
  const axis = sceneLayout[axisKey]
  if (!axis || typeof axis !== 'object') return null
  const axisLayout = axis as Record<string, unknown>
  const title = axisLayout.title
  if (typeof title === 'string') {
    return { text: title, font: null }
  }
  if (!title || typeof title !== 'object') return null
  const titleLayout = title as Record<string, unknown>
  if (typeof titleLayout.text !== 'string') return null
  return {
    text: titleLayout.text,
    font:
      titleLayout.font && typeof titleLayout.font === 'object'
        ? (titleLayout.font as Record<string, unknown>)
        : null,
  }
}

function blankSceneAxisTitle(
  sceneLayout: Record<string, unknown>,
  axisKey: SceneAxisKey
): Record<string, unknown> {
  const axis = sceneLayout[axisKey]
  if (!axis || typeof axis !== 'object') return sceneLayout
  const axisLayout = axis as Record<string, unknown>
  const title = axisLayout.title
  return {
    ...sceneLayout,
    [axisKey]: {
      ...axisLayout,
      title:
        title && typeof title === 'object'
          ? { ...(title as Record<string, unknown>), text: '' }
          : { text: '' },
    },
  }
}

function resolveFontColor(font: Record<string, unknown> | null): string | undefined {
  return typeof font?.color === 'string' && font.color.length > 0 ? font.color : undefined
}

function resolveFontSize(font: Record<string, unknown> | null): number | undefined {
  return isFiniteNumber(font?.size) ? font.size : undefined
}

function prepareSceneMathTitleFallback(
  layout: Partial<Layout>,
  managedSceneKeys: ReadonlySet<string>
): { layout: Partial<Layout>; fallbacks: SceneMathTitleFallback[] } {
  const sceneKeys = Object.keys(layout).filter((key) => key.startsWith('scene'))
  if (sceneKeys.length === 0) {
    return { layout, fallbacks: [] }
  }

  let nextLayout: (Partial<Layout> & Record<string, unknown>) | null = null
  const fallbacks: SceneMathTitleFallback[] = []

  for (const sceneKey of sceneKeys) {
    const sceneValue = layout[sceneKey as keyof Layout]
    if (!sceneValue || typeof sceneValue !== 'object') continue
    const sceneLayout = sceneValue as Record<string, unknown>
    let nextSceneLayout: Record<string, unknown> | null = null
    const titles: SceneMathTitleSpec[] = []

    for (const axisKey of SCENE_AXIS_KEYS) {
      const title = extractSceneAxisTitle(sceneLayout, axisKey)
      if (!title || !containsMathJaxMarkup(title.text)) continue
      titles.push({
        axis: axisKey,
        text: title.text,
        fontColor: resolveFontColor(title.font),
        fontSize: resolveFontSize(title.font),
      })
      nextSceneLayout = blankSceneAxisTitle(nextSceneLayout ?? sceneLayout, axisKey)
    }

    if (titles.length === 0 && !managedSceneKeys.has(sceneKey)) continue

    if (!nextLayout) {
      nextLayout = { ...layout }
    }

    nextLayout[sceneKey] = {
      ...(nextSceneLayout ?? sceneLayout),
      annotations: cloneSceneAnnotations(sceneLayout),
    }

    if (titles.length > 0) {
      fallbacks.push({
        sceneKey,
        baseAnnotations: cloneSceneAnnotations(sceneLayout),
        titles,
      })
    }
  }

  return { layout: nextLayout ?? layout, fallbacks }
}

function resolveSceneAxisRange(
  fullScene: Record<string, unknown> | undefined,
  axisKey: SceneAxisKey
): { start: number; end: number; span: number } {
  const axis = fullScene?.[axisKey]
  if (axis && typeof axis === 'object') {
    const range = (axis as Record<string, unknown>).range
    if (
      Array.isArray(range) &&
      range.length >= 2 &&
      isFiniteNumber(range[0]) &&
      isFiniteNumber(range[1])
    ) {
      const start = range[0]
      const end = range[1]
      return { start, end, span: Math.abs(end - start) || 1 }
    }
  }
  return { start: 0, end: 1, span: 1 }
}

function buildSceneMathTitleAnnotations(
  fallback: SceneMathTitleFallback,
  fullScene: Record<string, unknown> | undefined
): unknown[] {
  const xRange = resolveSceneAxisRange(fullScene, 'xaxis')
  const yRange = resolveSceneAxisRange(fullScene, 'yaxis')
  const zRange = resolveSceneAxisRange(fullScene, 'zaxis')
  const generated = fallback.titles.map((title) => {
    const font: Record<string, unknown> = {}
    if (title.fontColor) font.color = title.fontColor
    if (title.fontSize) font.size = title.fontSize
    const base = {
      text: title.text,
      showarrow: false,
      font,
    } as Record<string, unknown>
    if (title.axis === 'xaxis') {
      return {
        ...base,
        x: xRange.end + (xRange.end >= xRange.start ? 1 : -1) * xRange.span * 0.08,
        y: yRange.start,
        z: zRange.start,
      }
    }
    if (title.axis === 'yaxis') {
      return {
        ...base,
        x: xRange.start,
        y: yRange.end + (yRange.end >= yRange.start ? 1 : -1) * yRange.span * 0.08,
        z: zRange.start,
      }
    }
    return {
      ...base,
      x: xRange.start,
      y: yRange.start,
      z: zRange.end + (zRange.end >= zRange.start ? 1 : -1) * zRange.span * 0.08,
    }
  })
  return [...fallback.baseAnnotations, ...generated]
}

function normalizePlotlyTitleText(value: unknown, path: string[] = []): unknown {
  if (typeof value === 'string') {
    const leaf = path[path.length - 1]
    const parent = path[path.length - 2]
    if (leaf === 'title' || (leaf === 'text' && parent === 'title')) {
      return normalizeMathJaxForPlotly(value)
    }
    return value
  }

  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((entry, index) => {
      const normalized = normalizePlotlyTitleText(entry, [...path, String(index)])
      if (normalized !== entry) changed = true
      return normalized
    })
    return changed ? next : value
  }

  if (!value || typeof value !== 'object') return value

  const obj = value as Record<string, unknown>
  let next: Record<string, unknown> | null = null
  for (const [key, entry] of Object.entries(obj)) {
    const normalized = normalizePlotlyTitleText(entry, [...path, key])
    if (normalized !== entry) {
      if (!next) next = { ...obj }
      next[key] = normalized
    }
  }
  return next ?? value
}

function clonePlotlyValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlotlyValue(entry)) as T
  }
  if (!value || typeof value !== 'object') return value
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    next[key] = clonePlotlyValue(entry)
  }
  return next as T
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
  preloadMathJax()
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
  const [Plotly] = await Promise.all([loadPlotly(), ensureMathJaxReady()])
  if (opts?.signal?.aborted) return
  const layoutInput = clonePlotlyValue(layout)
  const normalizedLayout = normalizePlotlyTitleText(layoutInput) as Partial<Layout>
  const managedSceneKeys = sceneMathTitleKeys.get(container) ?? new Set<string>()
  const mathTitleFallback =
    Plotly.relayout
      ? prepareSceneMathTitleFallback(normalizedLayout, managedSceneKeys)
      : { layout: normalizedLayout, fallbacks: [] as SceneMathTitleFallback[] }
  const sceneKeys = Object.keys(mathTitleFallback.layout).filter((key) => key.startsWith('scene'))
  const hasScene = sceneKeys.length > 0
  const layoutHasCamera = sceneKeys.some((key) => {
    const value = mathTitleFallback.layout[key as keyof Layout]
    if (!value || typeof value !== 'object') return false
    return 'camera' in (value as Record<string, unknown>)
  })
  const layoutUirevision =
    typeof mathTitleFallback.layout.uirevision === 'string' ||
    typeof mathTitleFallback.layout.uirevision === 'number'
      ? String(mathTitleFallback.layout.uirevision)
      : null
  const existingUirevision = (() => {
    const candidate = container as PlotlyContainer
    const value = candidate.layout?.uirevision ?? candidate._fullLayout?.uirevision
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return null
  })()
  // Plotly.react can reset 3D camera on the first style update even when uirevision is stable.
  // Guard by injecting a valid pre-react camera spec when uirevision matches and layout omits
  // camera. This avoids model persistence or continuous camera injection; remove if Plotly changes.
  const shouldPreserveCamera =
    hasScene &&
    !layoutHasCamera &&
    layoutUirevision &&
    existingUirevision === layoutUirevision
  let layoutToRender = mathTitleFallback.layout
  if (shouldPreserveCamera) {
    try {
      const nextLayout: Partial<Layout> & Record<string, unknown> = { ...layoutToRender }
      let injected = false
      for (const key of sceneKeys) {
        const source = layoutToRender[key as keyof Layout]
        if (!source || typeof source !== 'object') continue
        const candidate = container as PlotlyContainer
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
    typesetMath: true,
  })
  if (opts?.signal?.aborted) return
  if (mathTitleFallback.fallbacks.length > 0 && Plotly.relayout) {
    const candidate = container as PlotlyContainer
    const update = Object.fromEntries(
      mathTitleFallback.fallbacks.map((fallback) => {
        const fullScene = candidate._fullLayout?.[fallback.sceneKey]
        return [
          `${fallback.sceneKey}.annotations`,
          buildSceneMathTitleAnnotations(
            fallback,
            fullScene && typeof fullScene === 'object'
              ? (fullScene as Record<string, unknown>)
              : undefined
          ),
        ]
      })
    )
    await Plotly.relayout(container, update)
    if (opts?.signal?.aborted) return
  }
  sceneMathTitleKeys.set(
    container,
    new Set(mathTitleFallback.fallbacks.map((fallback) => fallback.sceneKey))
  )
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
