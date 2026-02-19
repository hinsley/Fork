import type { ComplexValue, EquilibriumEigenPair, EquilibriumEigenvectorRenderStyle } from './types'

export const EIGENVECTOR_COLOR_PALETTE = [
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

export const DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER: EquilibriumEigenvectorRenderStyle = {
  enabled: false,
  stride: 10,
  vectorIndices: [0],
  colors: [EIGENVECTOR_COLOR_PALETTE[0]],
  lineLengthScale: 0.2,
  lineThickness: 2,
  discRadiusScale: 0.1,
  discThickness: 2,
}

const REAL_EIGENVALUE_EPS = 1e-6

export function isRealEigenvalue(value: ComplexValue, eps = REAL_EIGENVALUE_EPS): boolean {
  if (!Number.isFinite(value.im)) return true
  return Math.abs(value.im) <= eps
}

export function resolveEquilibriumEigenspaceIndices(
  eigenpairs: EquilibriumEigenPair[],
  eps = REAL_EIGENVALUE_EPS
): number[] {
  const indices: number[] = []
  eigenpairs.forEach((pair, index) => {
    const imag = pair.value?.im ?? 0
    if (!Number.isFinite(imag)) return
    if (Math.abs(imag) <= eps) {
      indices.push(index)
      return
    }
    if (imag > eps) {
      indices.push(index)
    }
  })
  return indices
}

export function defaultEquilibriumEigenvectorIndices(
  eigenspaceIndices?: number[]
): number[] {
  if (Array.isArray(eigenspaceIndices)) {
    return [...eigenspaceIndices]
  }
  return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.vectorIndices
}

function defaultEigenvectorColor(index: number): string {
  const paletteIndex = index % EIGENVECTOR_COLOR_PALETTE.length
  return EIGENVECTOR_COLOR_PALETTE[paletteIndex]
}

function normalizeEigenvectorColorOverrides(
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

function applyEigenvectorColorOverrides(
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

function normalizeLineLengthScale(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.lineLengthScale
  }
  return Math.max(0, value)
}

function normalizeStride(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.stride
  }
  return Math.max(1, Math.trunc(value))
}

function normalizeLineThickness(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.lineThickness
  }
  return Math.max(0.5, value)
}

function normalizeDiscRadiusScale(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.discRadiusScale
  }
  return Math.max(0, value)
}

function normalizeDiscThickness(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.discThickness
  }
  return Math.max(0.5, value)
}

export function normalizeEquilibriumEigenvectorIndices(
  indices: number[],
  allowed: number[]
): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const allowedSet = new Set(allowed)

  for (const raw of indices) {
    if (!Number.isFinite(raw)) continue
    const value = Math.trunc(raw)
    if (value < 0 || !allowedSet.has(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

export function resolveEquilibriumEigenvectorColors(
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

  return indices.map((index) => colorMap.get(index) ?? defaultEigenvectorColor(index))
}

function findConjugateEigenspaceIndex(
  eigenpairs: EquilibriumEigenPair[],
  index: number,
  candidateIndices: number[],
  eps: number
): number | null {
  const value = eigenpairs[index]?.value
  if (!value) return null
  for (const candidateIndex of candidateIndices) {
    if (candidateIndex === index) continue
    const candidate = eigenpairs[candidateIndex]?.value
    if (!candidate) continue
    if (!Number.isFinite(candidate.re) || !Number.isFinite(candidate.im)) continue
    if (candidate.im <= eps) continue
    if (Math.abs(candidate.re - value.re) > eps) continue
    if (Math.abs(candidate.im + value.im) > eps) continue
    return candidateIndex
  }
  return null
}

export function resolveEquilibriumEigenvalueMarkerColors(
  eigenpairs: EquilibriumEigenPair[],
  eigenspaceIndices: number[],
  eigenspaceColors: string[],
  options?: {
    fallbackColor?: string
    eps?: number
  }
): string[] {
  const fallbackColor = options?.fallbackColor ?? 'var(--accent)'
  const eps = options?.eps ?? REAL_EIGENVALUE_EPS
  if (eigenpairs.length === 0) return []
  const colorByIndex = new Map<number, string>()
  eigenspaceIndices.forEach((index, idx) => {
    const color = eigenspaceColors[idx]
    if (typeof color === 'string' && color) {
      colorByIndex.set(index, color)
    }
  })
  const fallbackIndices = resolveEquilibriumEigenspaceIndices(eigenpairs, eps)
  const candidateIndices = eigenspaceIndices.length > 0 ? eigenspaceIndices : fallbackIndices

  return eigenpairs.map((pair, index) => {
    const value = pair.value
    if (!value || !Number.isFinite(value.re) || !Number.isFinite(value.im)) {
      return colorByIndex.get(index) ?? fallbackColor
    }
    if (value.im < -eps) {
      const conjugateIndex = findConjugateEigenspaceIndex(
        eigenpairs,
        index,
        candidateIndices,
        eps
      )
      if (conjugateIndex !== null) {
        return colorByIndex.get(conjugateIndex) ?? fallbackColor
      }
    }
    return colorByIndex.get(index) ?? fallbackColor
  })
}

export function resolveEquilibriumEigenvectorRender(
  render: Partial<EquilibriumEigenvectorRenderStyle> | undefined,
  eigenspaceIndices?: number[]
): EquilibriumEigenvectorRenderStyle {
  const hasIndices = Array.isArray(render?.vectorIndices)
  const fallbackIndices = defaultEquilibriumEigenvectorIndices(eigenspaceIndices)
  const allowedIndices = Array.isArray(eigenspaceIndices)
    ? eigenspaceIndices
    : fallbackIndices
  const previousIndices = hasIndices ? render?.vectorIndices ?? [] : fallbackIndices
  const previousColors = render?.colors ?? DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.colors
  const rawIndices = hasIndices ? render?.vectorIndices ?? [] : fallbackIndices
  const indices = normalizeEquilibriumEigenvectorIndices(rawIndices, allowedIndices)
  const baseOverrides = normalizeEigenvectorColorOverrides(render?.colorOverrides)
  const mergedOverrides = applyEigenvectorColorOverrides(
    baseOverrides,
    previousIndices,
    previousColors
  )
  const colors = resolveEquilibriumEigenvectorColors(
    indices,
    previousIndices,
    previousColors,
    mergedOverrides
  )
  const colorOverrides = applyEigenvectorColorOverrides(mergedOverrides, indices, colors)

  return {
    enabled: Boolean(render?.enabled ?? DEFAULT_EQUILIBRIUM_EIGENVECTOR_RENDER.enabled),
    stride: normalizeStride(render?.stride),
    vectorIndices: indices,
    colors,
    colorOverrides,
    lineLengthScale: normalizeLineLengthScale(render?.lineLengthScale),
    lineThickness: normalizeLineThickness(render?.lineThickness),
    discRadiusScale: normalizeDiscRadiusScale(render?.discRadiusScale),
    discThickness: normalizeDiscThickness(render?.discThickness),
  }
}
