import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { enableDeterministicMode } from '../utils/determinism'

// Node's web storage warns without --localstorage-file; mock to keep tests deterministic.
const memoryStorage = (() => {
  let entries = new Map<string, string>()
  return {
    clear: () => {
      entries = new Map()
    },
    getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key)
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value))
    },
    get length() {
      return entries.size
    },
  } satisfies Storage
})()

Object.defineProperty(window, 'localStorage', {
  value: memoryStorage,
  configurable: true,
})
Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  configurable: true,
})

enableDeterministicMode()

vi.mock('../viewports/plotly/plotlyAdapter', () => ({
  renderPlot: vi.fn(() => Promise.resolve()),
  purgePlot: vi.fn(),
  preloadPlotly: vi.fn(),
  isPlotlyLoaded: vi.fn(() => true),
  resizePlot: vi.fn(() => Promise.resolve()),
  relayoutPlot: vi.fn(() => Promise.resolve()),
}))
