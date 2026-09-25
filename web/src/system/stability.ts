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

const DEFAULT_TOLERANCE = 1e-8

/**
 * Classifies an equilibrium (flow) or fixed point / cycle (map) from its
 * eigenvalues. Flows use the sign of Re(λ); maps use |λ| relative to 1.
 */
export function classifyEquilibrium(
  eigenvalues: ContinuationEigenvalue[] | null | undefined,
  systemType: 'flow' | 'map',
  tolerance = DEFAULT_TOLERANCE
): EquilibriumStability {
  const values = (eigenvalues ?? []).filter(
    (value) => Number.isFinite(value?.re) && Number.isFinite(value?.im)
  )
  if (values.length === 0) {
    return { kind: 'unknown', label: 'unknown', unstable: 0, stable: 0, center: 0 }
  }
  let unstable = 0
  let stable = 0
  let center = 0
  let complex = false
  for (const value of values) {
    const measure =
      systemType === 'map' ? Math.hypot(value.re, value.im) - 1 : value.re
    if (measure > tolerance) unstable += 1
    else if (measure < -tolerance) stable += 1
    else center += 1
    if (Math.abs(value.im) > tolerance) complex = true
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

/**
 * Count of unstable directions for a continuation point, used to split a branch
 * into stability runs. Returns null when eigenvalues are missing.
 */
export function unstableDimension(
  eigenvalues: ContinuationEigenvalue[] | null | undefined,
  systemType: 'flow' | 'map',
  tolerance = DEFAULT_TOLERANCE
): number | null {
  const values = (eigenvalues ?? []).filter(
    (value) => Number.isFinite(value?.re) && Number.isFinite(value?.im)
  )
  if (values.length === 0) return null
  return values.filter((value) =>
    systemType === 'map'
      ? Math.hypot(value.re, value.im) - 1 > tolerance
      : value.re > tolerance
  ).length
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
