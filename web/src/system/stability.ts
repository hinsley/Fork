import type { ContinuationEigenvalue } from './types'
import { formatBifurcationType } from './continuation'

export type StabilityKind = 'stable' | 'unstable' | 'saddle' | 'nonhyperbolic' | 'unknown'

export type EquilibriumStability = {
  kind: StabilityKind
  /** Compact human label, e.g. `stable focus`, `saddle 1u`, `unstable node`. */
  label: string
  unstable: number
  stable: number
  center: number
}

/** Absolute floor: below this, Re λ (or |μ| − 1) is zero at any scale. */
const ABSOLUTE_TOLERANCE = 1e-8
/** Relative resolution of a computed spectrum near the stability boundary. */
const RELATIVE_TOLERANCE = 1e-5

type SpectrumValue = Pick<ContinuationEigenvalue, 're' | 'im'>

function finiteSpectrum(
  eigenvalues: ContinuationEigenvalue[] | null | undefined
): ContinuationEigenvalue[] {
  return (eigenvalues ?? []).filter(
    (value) => Number.isFinite(value?.re) && Number.isFinite(value?.im)
  )
}

/**
 * Distance below which an eigenvalue counts as sitting on the stability
 * boundary (Re λ = 0 for flows, |μ| = 1 for maps).
 *
 * Eigenvalues at a located bifurcation are only as accurate as the locator:
 * the continuation core stops refining once its test function is ~1e-6, and
 * dense eigensolvers add errors proportional to the Jacobian's norm. A fixed
 * 1e-8 therefore reports a Hopf point with Re λ = 4e-7 (next to |λ| ≈ 14) as
 * unstable. We use a relative tolerance on the boundary's natural scale:
 * - flows: `max(1e-8, 1e-5 · max|λ|)` — the imaginary axis has no scale of its
 *   own, so the spectral radius sets it;
 * - maps: `max(1e-8, 1e-5)` on `|μ| − 1` — the unit circle fixes the scale,
 *   and a large multiplier elsewhere must not blur a multiplier near 1.
 * Genuinely unstable points (Re λ well above 1e-5 of the spectrum) still count.
 */
export function stabilityTolerance(
  eigenvalues: SpectrumValue[] | null | undefined,
  systemType: 'flow' | 'map'
): number {
  if (systemType === 'map') return Math.max(ABSOLUTE_TOLERANCE, RELATIVE_TOLERANCE)
  let radius = 0
  for (const value of eigenvalues ?? []) {
    const modulus = Math.hypot(value.re, value.im)
    if (Number.isFinite(modulus) && modulus > radius) radius = modulus
  }
  return Math.max(ABSOLUTE_TOLERANCE, RELATIVE_TOLERANCE * radius)
}

/**
 * Classifies an equilibrium (flow) or fixed point / cycle (map) from its
 * eigenvalues. Flows use the sign of Re(λ); maps use |λ| relative to 1.
 * Values within {@link stabilityTolerance} of the boundary are neutral, so a
 * located Hopf / fold point reads `non-hyperbolic`.
 */
export function classifyEquilibrium(
  eigenvalues: ContinuationEigenvalue[] | null | undefined,
  systemType: 'flow' | 'map',
  tolerance?: number
): EquilibriumStability {
  const values = finiteSpectrum(eigenvalues)
  if (values.length === 0) {
    return { kind: 'unknown', label: 'unknown', unstable: 0, stable: 0, center: 0 }
  }
  const tol = tolerance ?? stabilityTolerance(values, systemType)
  let unstable = 0
  let stable = 0
  let center = 0
  let complex = false
  for (const value of values) {
    const measure =
      systemType === 'map' ? Math.hypot(value.re, value.im) - 1 : value.re
    if (measure > tol) unstable += 1
    else if (measure < -tol) stable += 1
    else center += 1
    if (Math.abs(value.im) > tol) complex = true
  }
  const shape = systemType === 'flow' ? (complex ? 'focus' : 'node') : null
  let kind: StabilityKind
  let label: string
  if (center > 0) {
    kind = 'nonhyperbolic'
    label = 'non-hyperbolic'
  } else if (unstable === 0) {
    kind = 'stable'
    label = shape ? `stable ${shape}` : 'stable'
  } else if (stable === 0) {
    kind = 'unstable'
    label = shape ? `unstable ${shape}` : 'unstable'
  } else {
    kind = 'saddle'
    label = `${systemType === 'flow' && complex ? 'saddle-focus' : 'saddle'} ${unstable}u`
  }
  return { kind, label, unstable, stable, center }
}

/** Whether one eigenvalue lies strictly on the unstable side of the boundary. */
export function isUnstableEigenvalue(
  value: SpectrumValue,
  systemType: 'flow' | 'map',
  tolerance: number
): boolean {
  const measure = systemType === 'map' ? Math.hypot(value.re, value.im) - 1 : value.re
  return measure > tolerance
}

/**
 * Count of unstable directions for a continuation point, used to split a branch
 * into stability runs. Returns null when eigenvalues are missing.
 */
export function unstableDimension(
  eigenvalues: ContinuationEigenvalue[] | null | undefined,
  systemType: 'flow' | 'map',
  tolerance?: number
): number | null {
  const values = finiteSpectrum(eigenvalues)
  if (values.length === 0) return null
  const tol = tolerance ?? stabilityTolerance(values, systemType)
  return values.filter((value) => isUnstableEigenvalue(value, systemType, tol)).length
}

const BIFURCATION_CODES: Record<string, string> = {
  Fold: 'LP',
  BranchPoint: 'BP',
  Hopf: 'H',
  NeutralSaddle: 'NSa',
  CycleFold: 'LPC',
  PeriodDoubling: 'PD',
  NeimarkSacker: 'NS',
  Cusp: 'CP',
  BogdanovTakens: 'BT',
  ZeroHopf: 'ZH',
  DoubleHopf: 'HH',
  GeneralizedHopf: 'GH',
  CuspOfCycles: 'CPC',
  FoldFlip: 'LPPD',
  FoldNeimarkSacker: 'LPNS',
  FlipNeimarkSacker: 'PDNS',
  DoubleNeimarkSacker: 'NSNS',
  GeneralizedPeriodDoubling: 'GPD',
  Chenciner: 'CH',
  Resonance1_1: 'R1',
  Resonance1_2: 'R2',
  Resonance1_3: 'R3',
  Resonance1_4: 'R4',
}

/**
 * Short code for a bifurcation tag (`H`, `LP`, `PD`, `BT`, …). For maps the
 * equilibrium "Hopf" test is a Neimark–Sacker bifurcation and is reported as `NS`.
 */
export function bifurcationCode(
  tag: string | null | undefined,
  systemType: 'flow' | 'map' = 'flow'
): string {
  if (!tag || tag === 'None') return ''
  if (tag === 'Hopf' && systemType === 'map') return 'NS'
  const mapped = BIFURCATION_CODES[tag]
  if (mapped) return mapped
  const label = formatBifurcationType(tag)
  const acronym = label.split(' - ')[0]
  if (acronym && acronym.length <= 4 && acronym === acronym.toUpperCase()) return acronym
  return label
}

export type BifurcationTone = 'fold' | 'hopf' | 'flip' | 'branch' | 'codim2' | 'other'

/** Colour family for a bifurcation code, shared by chips and plot markers. */
export function bifurcationTone(code: string): BifurcationTone {
  switch (code) {
    case 'LP':
    case 'LPC':
      return 'fold'
    case 'H':
    case 'NS':
    case 'NSa':
      return 'hopf'
    case 'PD':
      return 'flip'
    case 'BP':
      return 'branch'
    case '':
      return 'other'
    default:
      return code.length <= 4 && code === code.toUpperCase() ? 'codim2' : 'other'
  }
}
