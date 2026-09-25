import { isSubsystemSnapshotCompatible } from '../../../system/subsystemGateway'
import type {
  InvariantMeasureEigenmode,
  InvariantMeasureObject,
  System,
} from '../../../system/types'
import { hasCurrentEigenmodeAnalysis } from '../../../system/invariantMeasureEigenmodes'

export function computeInvariantMeasureStats(
  invariantMeasure: InvariantMeasureObject,
  system: System
) {
  const result = invariantMeasure.result
  const source = system.objects[invariantMeasure.sourceStateGridId]
  const sourceIndex = system.index.objects[invariantMeasure.sourceStateGridId]
  const sourceExists =
    source?.type === 'state_grid' ||
    (!source && sourceIndex?.objectType === 'state_grid')
  const sourceName =
    source?.type === 'state_grid'
      ? source.name
      : !source && sourceIndex?.objectType === 'state_grid'
        ? sourceIndex.name
        : invariantMeasure.sourceStateGridName
  const occupiedCells = result.stationaryDistribution.filter((mass) => mass > 0).length
  const ambientBoxCount = result.ambientBoxCount ?? result.axes.reduce(
    (total, axis) => total * axis.resolution,
    1
  )
  const dominantEigenvalue = result.dominantEigenvalue ?? 1
  const massPreserving = Math.abs(dominantEigenvalue - 1) <= 1e-8
  const totalModeMass = result.stationaryDistribution.reduce((sum, mass) => sum + mass, 0)
  const squaredModeMass = result.stationaryDistribution.reduce(
    (sum, mass) => sum + mass * mass,
    0
  )
  const participationSupport = squaredModeMass > 0 ? 1 / squaredModeMass : 0
  const peakCellMass = result.stationaryDistribution.reduce(
    (peak, mass) => Math.max(peak, mass),
    0
  )
  const stationaryConverged =
    totalModeMass > 0 && result.residual <= result.settings.tolerance
  const snapshotCompatible =
    !result.subsystemSnapshot ||
    isSubsystemSnapshotCompatible(system.config, result.subsystemSnapshot)
  const storedAnalysis = invariantMeasure.eigenmodeAnalysis
  const currentAnalysis =
    storedAnalysis && hasCurrentEigenmodeAnalysis(result, storedAnalysis.sourceComputedAt)
      ? storedAnalysis
      : null
  return {
    sourceExists,
    sourceName,
    occupiedCells,
    ambientBoxCount,
    dominantEigenvalue,
    massPreserving,
    totalModeMass,
    participationSupport,
    peakCellMass,
    stationaryConverged,
    snapshotCompatible,
    currentAnalysis,
  }
}

export type EigenmodeRow = {
  /** 1-based position in the displayed table. */
  index: number
  /** The mode shown for this row (its vector drives the overlay). */
  mode: InvariantMeasureEigenmode
  /** Ranks of all computed modes merged into this row. */
  ranks: number[]
  /** A genuine complex-conjugate pair (λ and λ̄). */
  complex: boolean
}

/** Relative size below which an imaginary part is treated as rounding noise. */
const REAL_IMAG_TOLERANCE = 1e-4

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function isEffectivelyReal(mode: InvariantMeasureEigenmode): boolean {
  if (!mode.conjugatePair) return true
  const im = Math.abs(mode.eigenvalueIm)
  const modulus = Math.hypot(mode.eigenvalueRe, mode.eigenvalueIm)
  return im <= Math.max(REAL_IMAG_TOLERANCE * modulus, finiteOrZero(mode.ritzResidual))
}

function sameEigenvalue(a: InvariantMeasureEigenmode, b: InvariantMeasureEigenmode): boolean {
  const scale = Math.max(Math.hypot(a.eigenvalueRe, a.eigenvalueIm), 1e-12)
  const residuals = finiteOrZero(a.ritzResidual) + finiteOrZero(b.ritzResidual)
  const tolerance = Math.min(Math.max(1e-6 * scale, 10 * residuals), 1e-3 * scale)
  return (
    Math.hypot(
      a.eigenvalueRe - b.eigenvalueRe,
      Math.abs(a.eigenvalueIm) - Math.abs(b.eigenvalueIm)
    ) <= tolerance
  )
}

/**
 * Table rows for computed transfer-operator modes: each conjugate pair once
 * (the solver can return two Ritz approximations of the same pair), and
 * imaginary parts within rounding noise shown as real.
 */
export function groupEigenmodes(modes: InvariantMeasureEigenmode[]): {
  rows: EigenmodeRow[]
  eigenvalueCount: number
} {
  const rows: EigenmodeRow[] = []
  for (const mode of modes) {
    const complex = !isEffectivelyReal(mode)
    // Only solver-flagged pairs can be duplicates; equal real modes are a
    // genuine repeated eigenvalue with distinct vectors.
    const existing = mode.conjugatePair
      ? rows.find(
          (row) =>
            row.mode.conjugatePair && row.complex === complex && sameEigenvalue(row.mode, mode)
        )
      : undefined
    if (existing) {
      existing.ranks.push(mode.rank)
      if (!existing.mode.converged && mode.converged) existing.mode = mode
      continue
    }
    rows.push({ index: rows.length + 1, mode, ranks: [mode.rank], complex })
  }
  const eigenvalueCount = rows.reduce((total, row) => total + (row.complex ? 2 : 1), 0)
  return { rows, eigenvalueCount }
}

