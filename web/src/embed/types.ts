import type { PlotlyFigureSnapshot } from '../viewports/plotly/figureCapture'

export type EmbedTheme = 'light' | 'dark'
export type EmbedHeaders = 'auto' | 'show' | 'hide'
export type EmbedInteraction = 'plot' | 'none'

export type StandaloneViewport = {
  id: string
  name: string
  type: string
  height: number
  figure: PlotlyFigureSnapshot
  fallbackImage?: string
}

export type StandaloneEmbed = {
  title: string
  theme: EmbedTheme
  headers: EmbedHeaders
  interaction: EmbedInteraction
  viewports: StandaloneViewport[]
}
