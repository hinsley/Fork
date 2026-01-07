import type { Layout, Data } from 'plotly.js'

type PlotlyModule = {
  react: (
    container: HTMLElement,
    data: Data[],
    layout: Partial<Layout>,
    config: { displaylogo: boolean; responsive: boolean }
  ) => Promise<void>
  purge: (container: HTMLElement) => void
  Plots?: {
    resize: (container: HTMLElement) => Promise<void> | void
  }
}

let plotlyModule: PlotlyModule | null = null
let plotlyPromise: Promise<PlotlyModule> | null = null

function unwrapPlotly(mod: unknown): PlotlyModule {
  const candidate = (mod as { default?: PlotlyModule }).default ?? mod
  return candidate as PlotlyModule
}

async function loadPlotly(): Promise<PlotlyModule> {
  if (plotlyModule) return plotlyModule
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min').then((mod) => {
      plotlyModule = unwrapPlotly(mod)
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
  await Plotly.react(container, data, layout, { displaylogo: false, responsive: true })
}

export async function resizePlot(container: HTMLElement) {
  const Plotly = await loadPlotly()
  if (Plotly.Plots?.resize) {
    await Plotly.Plots.resize(container)
  }
}

export function purgePlot(container: HTMLElement) {
  if (!plotlyModule) return
  plotlyModule.purge(container)
}
