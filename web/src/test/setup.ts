import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('../viewports/plotly/plotlyAdapter', () => ({
  renderPlot: vi.fn(() => Promise.resolve()),
  purgePlot: vi.fn(),
  preloadPlotly: vi.fn(),
  isPlotlyLoaded: vi.fn(() => true),
  resizePlot: vi.fn(() => Promise.resolve()),
}))
