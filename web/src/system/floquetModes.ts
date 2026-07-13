import type { ComplexValue, SubsystemSnapshot } from './types'

const FLOQUET_REAL_IMAG_REL_TOL = 1e-3
const FLOQUET_TRIVIAL_MODE_TOL = 1e-2
const MANIFOLD_REAL_TOL = 1e-8
const MANIFOLD_TRIVIAL_TOL = 1e-3
const MANIFOLD_SIDE_TOL = 1e-6

function normalizeComplex(value: ComplexValue): ComplexValue {
  return {
    re: value.re,
    im: value.im,
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
    if (!Number.isFinite(normalized.re) || !Number.isFinite(normalized.im)) return
    const dx = normalized.re - 1
    const dy = normalized.im
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex >= 0 && bestDistance <= FLOQUET_TRIVIAL_MODE_TOL ** 2
    ? bestIndex
    : null
}

export function normalizeFloquetMultipliersForRendering(
  multipliers: ComplexValue[]
): ComplexValue[] {
  const trivialIndex = resolveTrivialFloquetModeIndex(multipliers)
  return multipliers.map((value, index) => {
    const normalized = normalizeComplex(value)
    if (!Number.isFinite(normalized.re) || !Number.isFinite(normalized.im)) {
      return normalized
    }
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

export function liftReducedFloquetVectorsForDisplay(
  snapshot: SubsystemSnapshot,
  vectors: ComplexValue[][][]
): ComplexValue[][][] {
  return vectors.map((pointVectors) =>
    pointVectors.map((modeVector) => {
      if (modeVector.length === snapshot.baseVarNames.length) {
        return modeVector.map((component) => ({ re: component.re, im: component.im }))
      }
      if (modeVector.length !== snapshot.freeVariableIndices.length) {
        // Preserve malformed/legacy data for diagnostics instead of silently
        // assigning components to the wrong coordinates.
        return modeVector.map((component) => ({ re: component.re, im: component.im }))
      }
      const fullVector = snapshot.baseVarNames.map(() => ({ re: 0, im: 0 }))
      for (
        let reducedIndex = 0;
        reducedIndex < snapshot.freeVariableIndices.length;
        reducedIndex += 1
      ) {
        const fullIndex = snapshot.freeVariableIndices[reducedIndex]
        const component = modeVector[reducedIndex]
        if (fullIndex < 0 || fullIndex >= fullVector.length || !component) continue
        fullVector[fullIndex] = { re: component.re, im: component.im }
      }
      return fullVector
    })
  )
}

export type CycleManifoldFloquetEligibilityReason =
  | 'complex'
  | 'trivial'
  | 'wrong_side'
  | 'non_finite'

export type CycleManifoldFloquetEligibility = {
  eligible: boolean
  reason?: CycleManifoldFloquetEligibilityReason
}

export function cycleManifoldFloquetEligibility(
  value: ComplexValue,
  stability: 'Stable' | 'Unstable'
): CycleManifoldFloquetEligibility {
  const normalized = normalizeComplex(value)
  if (!Number.isFinite(normalized.re) || !Number.isFinite(normalized.im)) {
    return { eligible: false, reason: 'non_finite' }
  }
  if (Math.abs(normalized.im) > MANIFOLD_REAL_TOL) {
    return { eligible: false, reason: 'complex' }
  }
  if (Math.abs(normalized.re - 1) <= MANIFOLD_TRIVIAL_TOL) {
    return { eligible: false, reason: 'trivial' }
  }
  const modulus = Math.hypot(normalized.re, normalized.im)
  const matches =
    stability === 'Unstable'
      ? modulus > 1 + MANIFOLD_SIDE_TOL
      : modulus < 1 - MANIFOLD_SIDE_TOL
  if (!matches) {
    return { eligible: false, reason: 'wrong_side' }
  }
  return { eligible: true }
}
