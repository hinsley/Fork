import type { Data, Layout } from 'plotly.js'

export type PlotlyFigureSnapshot = {
  data: Data[]
  layout: Partial<Layout>
}

export type PlotlyFigureCaptureState =
  | { plotId: string; status: 'rendering' }
  | { plotId: string; status: 'ready'; figure: PlotlyFigureSnapshot }
  | { plotId: string; status: 'error'; message: string }

type PlotlyGraphDiv = HTMLElement & {
  data?: Data[]
  layout?: Partial<Layout>
}

function serializePlotlyValue(value: unknown): unknown {
  const encoded = JSON.stringify(value, (key, entry) => {
    if (key === 'uirevision' || key === 'uid') return undefined
    if (typeof entry === 'number' && !Number.isFinite(entry)) return null
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(entry)) {
      return Array.from(entry as unknown as ArrayLike<number>)
    }
    return entry
  })
  if (encoded === undefined) return null
  return JSON.parse(encoded) as unknown
}

export function capturePlotlyFigure(node: HTMLElement): PlotlyFigureSnapshot {
  const graph = node as PlotlyGraphDiv
  if (!Array.isArray(graph.data) || !graph.layout || typeof graph.layout !== 'object') {
    throw new Error('The Plotly figure is not ready to export.')
  }
  const snapshot = serializePlotlyValue({ data: graph.data, layout: graph.layout }) as {
    data: Data[]
    layout: Partial<Layout>
  }
  return snapshot
}
