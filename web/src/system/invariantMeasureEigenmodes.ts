import type {
  InvariantMeasureEigenmode,
  InvariantMeasureEigenmodeInterpretation,
  InvariantMeasureEigenmodeView,
  InvariantMeasureSpectralGapStatus,
  TransferOperatorResult,
} from './types'

export const DEFAULT_EIGENMODE_COUNT = 6
export const DEFAULT_EIGENMODE_TOLERANCE = 1e-8
export const DEFAULT_EIGENMODE_MAX_RESTARTS = 12
export const MAX_EIGENMODE_COUNT = 48

const MAX_KRYLOV_DIMENSION = 96
const MAX_KRYLOV_BASIS_BYTES = 64 * 1024 * 1024
const MAX_PERSISTED_MODE_COMPONENTS = 2_000_000

function recommendedSubspaceDimension(
  operatorDimension: number,
  requestedModes: number
): number | null {
  const rawTarget = Math.min(requestedModes * 2 + 3, operatorDimension)
  const desired = Math.min(
    Math.max(rawTarget + 6, Math.min(12, operatorDimension)),
    MAX_KRYLOV_DIMENSION,
    operatorDimension
  )
  const bytesPerColumn = operatorDimension * 16
  const memoryDimension = Math.min(
    Math.max(0, Math.floor(MAX_KRYLOV_BASIS_BYTES / bytesPerColumn) - 1),
    MAX_KRYLOV_DIMENSION
  )
  const dimension = Math.min(desired, memoryDimension, operatorDimension)
  return dimension >= Math.min(rawTarget + 2, operatorDimension) ? dimension : null
}

export function maxSupportedEigenmodeCount(operatorDimension: number): number {
  if (!Number.isInteger(operatorDimension) || operatorDimension < 2) return 0
  const resultLimit = Math.floor(
    MAX_PERSISTED_MODE_COMPONENTS / (operatorDimension * 2)
  )
  const upper = Math.min(MAX_EIGENMODE_COUNT, operatorDimension - 1, resultLimit)
  let supported = 0
  for (let requested = 1; requested <= upper; requested += 1) {
    if (recommendedSubspaceDimension(operatorDimension, requested) === null) break
    supported = requested
  }
  return supported
}

export function flattenEigenmodeWarmStart(
  modes: InvariantMeasureEigenmode[],
  operatorDimension: number
): { real: number[]; imaginary: number[] } {
  const real: number[] = []
  const imaginary: number[] = []
  for (const mode of modes) {
    if (mode.vectorReal.length !== operatorDimension) continue
    const hasImaginary = mode.vectorImaginary.length === operatorDimension
    for (let index = 0; index < operatorDimension; index += 1) {
      real.push(mode.vectorReal[index])
      imaginary.push(hasImaginary ? mode.vectorImaginary[index] : 0)
    }
  }
  return { real, imaginary }
}

export function eigenmodeScalarValues(
  mode: InvariantMeasureEigenmode,
  view: InvariantMeasureEigenmodeView
): number[] {
  if (view.component === 'real') return mode.vectorReal
  if (view.component === 'imaginary') {
    return mode.vectorImaginary.length === mode.vectorReal.length
      ? mode.vectorImaginary
      : mode.vectorReal.map(() => 0)
  }
  const cosine = Math.cos(view.phase)
  const sine = Math.sin(view.phase)
  return mode.vectorReal.map(
    (real, index) =>
      real * cosine + (mode.vectorImaginary[index] ?? 0) * sine
  )
}

export function hasCurrentEigenmodeAnalysis(
  result: TransferOperatorResult,
  sourceComputedAt: string | undefined
): boolean {
  return sourceComputedAt === result.computedAt
}

export function eigenmodeInterpretationLabel(
  interpretation: InvariantMeasureEigenmodeInterpretation
): string {
  switch (interpretation) {
    case 'density_relaxation':
      return 'Density relaxation'
    case 'alternating_density_relaxation':
      return 'Alternating density relaxation'
    case 'oscillatory_density_relaxation':
      return 'Oscillatory density relaxation'
    case 'approximate_unconverged':
      return 'Approximate, unconverged'
  }
}

export function spectralGapStatusLabel(
  status: InvariantMeasureSpectralGapStatus
): string {
  switch (status) {
    case 'available':
      return 'Available'
    case 'operator_not_mass_preserving':
      return 'Unavailable: finite-box operator loses mass'
    case 'reducible_operator':
      return 'Unavailable: transfer graph is reducible'
    case 'non_unique_stationary_mode':
      return 'Unavailable: stationary mode is not unique'
    case 'periodic_operator':
      return 'Unavailable: transfer graph is periodic'
    case 'stationary_mode_not_converged':
      return 'Unavailable: stationary mode did not converge'
    case 'subdominant_mode_unavailable':
      return 'Unavailable: no usable subdominant mode'
    case 'subdominant_mode_not_converged':
      return 'Unavailable: subdominant mode did not converge'
  }
}
