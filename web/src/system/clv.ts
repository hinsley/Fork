import type { ClvRenderStyle } from './types'

export const CLV_COLOR_PALETTE = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
]

export const DEFAULT_CLV_RENDER: ClvRenderStyle = {
  enabled: false,
  stride: 10,
  lengthScale: 0.15,
  headScale: 1,
  thickness: 2,
  vectorIndices: [0],
  colors: [CLV_COLOR_PALETTE[0]],
}

export function defaultClvIndices(dim?: number): number[] {
  if (typeof dim === 'number' && Number.isFinite(dim) && dim > 0) {
    return Array.from({ length: Math.trunc(dim) }, (_, index) => index)
  }
  return DEFAULT_CLV_RENDER.vectorIndices
}

function defaultClvColor(index: number): string {
  const paletteIndex = index % CLV_COLOR_PALETTE.length
  return CLV_COLOR_PALETTE[paletteIndex]
}

function normalizeClvColorOverrides(
  overrides: Record<number, string> | undefined
): Record<number, string> {
  if (!overrides || typeof overrides !== 'object') {
    return {}
  }
  const result: Record<number, string> = {}
  for (const [key, value] of Object.entries(overrides)) {
    const index = Number.parseInt(key, 10)
    if (!Number.isFinite(index) || index < 0) continue
    if (typeof value !== 'string' || !value) continue
    result[index] = value
  }
  return result
}

function applyClvColorOverrides(
  overrides: Record<number, string>,
  indices: number[],
  colors: string[]
): Record<number, string> {
  const next = { ...overrides }
  indices.forEach((index, idx) => {
    const color = colors[idx]
    if (typeof color === 'string' && color) {
      next[index] = color
    }
  })
  return next
}

function normalizeStride(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CLV_RENDER.stride
  }
  return Math.max(1, Math.floor(value))
}

function normalizeLength(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CLV_RENDER.lengthScale
  }
  return Math.max(0, value)
}

function normalizeHeadScale(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CLV_RENDER.headScale
  }
  return Math.max(0, value)
}

function normalizeThickness(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CLV_RENDER.thickness
  }
  return Math.max(0.5, value)
}

export function normalizeClvIndices(indices: number[], dim?: number): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const limit = typeof dim === 'number' && Number.isFinite(dim) && dim > 0 ? dim : null

  for (const raw of indices) {
    if (!Number.isFinite(raw)) continue
    const value = Math.trunc(raw)
    if (value < 0) continue
    if (limit !== null && value >= limit) continue
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

export function resolveClvColors(
  indices: number[],
  previousIndices: number[],
  previousColors: string[],
  overrides?: Record<number, string>
): string[] {
  const colorMap = new Map<number, string>()
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      const index = Number.parseInt(key, 10)
      if (!Number.isFinite(index) || index < 0) continue
      if (typeof value !== 'string' || !value) continue
      colorMap.set(index, value)
    }
  }
  previousIndices.forEach((index, idx) => {
    const color = previousColors[idx]
    if (typeof color === 'string' && color) {
      colorMap.set(index, color)
    }
  })

  return indices.map((index) => colorMap.get(index) ?? defaultClvColor(index))
}

export function resolveClvRender(
  render: Partial<ClvRenderStyle> | undefined,
  dim?: number
): ClvRenderStyle {
  const hasIndices = Array.isArray(render?.vectorIndices)
  const fallbackIndices = defaultClvIndices(dim)
  const previousIndices = hasIndices ? render?.vectorIndices ?? [] : fallbackIndices
  const previousColors = render?.colors ?? DEFAULT_CLV_RENDER.colors
  const rawIndices = hasIndices ? render?.vectorIndices ?? [] : fallbackIndices
  const indices = normalizeClvIndices(rawIndices, dim)
  const baseOverrides = normalizeClvColorOverrides(render?.colorOverrides)
  const mergedOverrides = applyClvColorOverrides(
    baseOverrides,
    previousIndices,
    previousColors
  )
  const colors = resolveClvColors(
    indices,
    previousIndices,
    previousColors,
    mergedOverrides
  )
  const colorOverrides = applyClvColorOverrides(mergedOverrides, indices, colors)

  return {
    enabled: Boolean(render?.enabled ?? DEFAULT_CLV_RENDER.enabled),
    stride: normalizeStride(render?.stride ?? DEFAULT_CLV_RENDER.stride),
    lengthScale: normalizeLength(render?.lengthScale ?? DEFAULT_CLV_RENDER.lengthScale),
    headScale: normalizeHeadScale(render?.headScale ?? DEFAULT_CLV_RENDER.headScale),
    thickness: normalizeThickness(render?.thickness ?? DEFAULT_CLV_RENDER.thickness),
    vectorIndices: indices,
    colors,
    colorOverrides,
  }
}

export function parseClvIndicesText(value: string, dim?: number): number[] {
  if (!value.trim()) return []
  const tokens = value.split(/[\s,]+/).filter(Boolean)
  const indices = tokens
    .map((token) => Number.parseInt(token, 10))
    .filter((token) => Number.isFinite(token))
  return normalizeClvIndices(indices, dim)
}
