import type { ComplexValue } from './types'

const FLOQUET_REAL_IMAG_REL_TOL = 1e-3

function normalizeComplex(value: ComplexValue): ComplexValue {
  return {
    re: Number.isFinite(value.re) ? value.re : 0,
    im: Number.isFinite(value.im) ? value.im : 0,
  }
}

export function resolveTrivialFloquetModeIndex(
  multipliers: ComplexValue[]
): number | null {
  if (!Array.isArray(multipliers) || multipliers.length === 0) {
    return null
  }
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  multipliers.forEach((value, index) => {
    const normalized = normalizeComplex(value)
    const dx = normalized.re - 1
    const dy = normalized.im
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex >= 0 ? bestIndex : null
}

export function normalizeFloquetMultipliersForRendering(
  multipliers: ComplexValue[]
): ComplexValue[] {
  const trivialIndex = resolveTrivialFloquetModeIndex(multipliers)
  return multipliers.map((value, index) => {
    const normalized = normalizeComplex(value)
    if (trivialIndex !== null && index === trivialIndex) {
      return { ...normalized, im: 0 }
    }
    const scale = Math.max(1, Math.abs(normalized.re))
    if (Math.abs(normalized.im) <= FLOQUET_REAL_IMAG_REL_TOL * scale) {
      return { ...normalized, im: 0 }
    }
    return normalized
  })
}
