import type {
  ContinuationEigenvalue,
  ContinuationObject,
  ContinuationPoint,
} from '../../../../system/types'
import {
  extractHopfOmega,
  formatBifurcationType,
  interpretLimitCycleStability,
  normalizeEigenvalueArray,
  resolveContinuationPointParam2Value,
} from '../../../../system/continuation'
import { resolveTrivialFloquetModeIndex } from '../../../../system/floquetModes'
import {
  bifurcationCode,
  bifurcationTone,
  classifyEquilibrium,
  unstableDimension,
  type BifurcationTone,
  type StabilityKind,
} from '../../../../system/stability'
import { fmt } from '../../../../utils/format'

export type SystemKind = 'flow' | 'map'

/**
 * How a branch's per-point spectrum maps to stability:
 * - `equilibrium`: eigenvalues of an equilibrium (flows) or fixed point / cycle (maps)
 * - `cycle`: Floquet multipliers of a periodic orbit (skip the trivial multiplier)
 * - `strobe`: multipliers of a stroboscopic map (forced periodic response)
 * - `null`: curves and manifolds, where the stored spectrum is not a stability verdict.
 */
export type StabilityModel = 'equilibrium' | 'cycle' | 'strobe' | null

export function branchStabilityModel(branchType: string | undefined): StabilityModel {
  if (branchType === 'equilibrium') return 'equilibrium'
  if (branchType === 'limit_cycle' || branchType === 'isoperiodic_curve') return 'cycle'
  if (branchType === 'forced_periodic_response') return 'strobe'
  return null
}

/** Spectrum flavour used by the eigenvalue table and plot. */
export function branchSpectrumKind(
  branchType: string | undefined,
  systemType: SystemKind
): 'flow' | 'map' | 'cycle' {
  if (
    branchType === 'limit_cycle' ||
    branchType === 'isoperiodic_curve' ||
    branchType === 'lpc_curve' ||
    branchType === 'pd_curve' ||
    branchType === 'ns_curve'
  ) {
    return 'cycle'
  }
  if (branchType === 'forced_periodic_response') return 'map'
  return systemType
}

const CYCLE_TOLERANCE = 1e-6

function cycleUnstableCount(eigenvalues: ContinuationEigenvalue[]): number | null {
  if (eigenvalues.length === 0) return null
  const trivialIndex = resolveTrivialFloquetModeIndex(eigenvalues)
  if (trivialIndex === null) return null
  let count = 0
  for (let index = 0; index < eigenvalues.length; index += 1) {
    if (index === trivialIndex) continue
    const value = eigenvalues[index]
    if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return null
    if (Math.hypot(value.re, value.im) > 1 + CYCLE_TOLERANCE) count += 1
  }
  return count
}

/** Number of unstable directions at a point, or null when unknown. */
export function pointUnstableCount(
  point: ContinuationPoint | null | undefined,
  model: StabilityModel,
  systemType: SystemKind
): number | null {
  if (!point || !model) return null
  const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
  if (model === 'cycle') return cycleUnstableCount(eigenvalues)
  return unstableDimension(eigenvalues, model === 'strobe' ? 'map' : systemType)
}

export type PointStability = { kind: StabilityKind; label: string }

/** Real stability of a point (not the bifurcation tag). */
export function pointStability(
  point: ContinuationPoint | null | undefined,
  model: StabilityModel,
  systemType: SystemKind
): PointStability | null {
  if (!point || !model) return null
  const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
  if (eigenvalues.length === 0) return null
  if (model === 'cycle') {
    const label = interpretLimitCycleStability(eigenvalues)
    if (label === 'unknown') return null
    return { kind: label === 'stable' ? 'stable' : 'unstable', label }
  }
  const classified = classifyEquilibrium(eigenvalues, model === 'strobe' ? 'map' : systemType)
  if (classified.kind === 'unknown') return null
  return { kind: classified.kind, label: classified.label }
}

export type StabilityRun = {
  /** First and last position in the sorted order (inclusive). */
  start: number
  end: number
  unstable: number | null
}

/** Groups consecutive points (in sorted order) with the same unstable dimension. */
export function buildStabilityRuns(
  points: ContinuationPoint[],
  sortedOrder: number[],
  model: StabilityModel,
  systemType: SystemKind
): StabilityRun[] {
  if (sortedOrder.length === 0) return []
  const runs: StabilityRun[] = []
  sortedOrder.forEach((arrayIndex, position) => {
    const unstable = model
      ? pointUnstableCount(points[arrayIndex], model, systemType)
      : null
    const last = runs[runs.length - 1]
    if (last && last.unstable === unstable) {
      last.end = position
    } else {
      runs.push({ start: position, end: position, unstable })
    }
  })
  return runs
}

export function formatRunLabel(unstable: number | null, model: StabilityModel): string {
  if (unstable === null) return 'unknown'
  if (unstable === 0) return 'stable'
  if (model === 'equilibrium' || model === 'strobe') return `unstable ${unstable}u`
  return `unstable ${unstable}D`
}

export type BifurcationRow = {
  arrayIndex: number
  sortedPosition: number
  logicalIndex: number
  code: string
  tone: BifurcationTone
  /** Type name, e.g. `Hopf`, `Period Doubling`, `Neutral Saddle`. */
  label: string
  /** Full catalogue label including any acronym, e.g. `NNS - Neutral Saddle`. */
  fullLabel: string
  param1: number | null
  param2: number | null
  /** Short per-type extra: Hopf frequency, critical multiplier, … */
  extra: string | null
  candidate: boolean
}

export function resolvePointTag(point: ContinuationPoint | null | undefined): string | null {
  if (!point) return null
  if (point.stability && point.stability !== 'None') return point.stability
  return point.codim2?.type ?? null
}

/** Human label for a bifurcation tag, stripping acronym prefixes (`NNS - Neutral Saddle`). */
export function bifurcationLabel(tag: string | null, code: string): string {
  if (!tag) return ''
  if (code === 'NS' && tag === 'Hopf') return 'Neimark-Sacker'
  const label = formatBifurcationType(tag)
  const split = label.indexOf(' - ')
  return split > 0 ? label.slice(split + 3) : label
}

export function isCodim1CurveBranch(branch: ContinuationObject | null | undefined): boolean {
  const branchType = branch?.data.branch_type
  return Boolean(
    branchType &&
      typeof branchType === 'object' &&
      'param1_name' in branchType &&
      'param2_name' in branchType
  )
}

export function resolvePointParam2(
  branch: ContinuationObject,
  point: ContinuationPoint,
  stateDimension: number
): number | null {
  if (!isCodim1CurveBranch(branch)) return null
  const value =
    typeof point.param2_value === 'number' && Number.isFinite(point.param2_value)
      ? point.param2_value
      : resolveContinuationPointParam2Value(point, branch.data.branch_type, stateDimension)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function criticalMultiplierExtra(code: string, eigenvalues: ContinuationEigenvalue[]): string | null {
  if (eigenvalues.length === 0) return null
  if (code === 'PD') {
    let best: ContinuationEigenvalue | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const value of eigenvalues) {
      const distance = Math.hypot(value.re + 1, value.im)
      if (distance < bestDistance) {
        bestDistance = distance
        best = value
      }
    }
    return best ? `μ ${fmt(best.re, { digits: 4 })}` : null
  }
  if (code === 'NS') {
    let best: ContinuationEigenvalue | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const value of eigenvalues) {
      if (Math.abs(value.im) < 1e-9) continue
      const distance = Math.abs(Math.hypot(value.re, value.im) - 1)
      if (distance < bestDistance) {
        bestDistance = distance
        best = value
      }
    }
    return best ? `θ ${fmt(Math.abs(Math.atan2(best.im, best.re)), { digits: 4 })}` : null
  }
  return null
}

export function buildBifurcationRows(options: {
  branch: ContinuationObject
  branchIndices: number[]
  sortedOrder: number[]
  systemType: SystemKind
  stateDimension: number
}): BifurcationRow[] {
  const { branch, branchIndices, sortedOrder, systemType, stateDimension } = options
  const positions = new Map<number, number>()
  sortedOrder.forEach((arrayIndex, position) => positions.set(arrayIndex, position))
  const rows: BifurcationRow[] = []
  for (const arrayIndex of branch.data.bifurcations ?? []) {
    const point = branch.data.points[arrayIndex]
    if (!point) continue
    const tag = resolvePointTag(point)
    const code = bifurcationCode(tag, systemType) || '?'
    const logical = branchIndices[arrayIndex]
    const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
    let extra: string | null = null
    if (code === 'H' && branch.branchType === 'equilibrium' && systemType === 'flow') {
      extra = `ω ${fmt(extractHopfOmega(point), { digits: 4 })}`
    } else if (code === 'PD' || code === 'NS') {
      extra = criticalMultiplierExtra(code, eigenvalues)
    }
    const candidate = Boolean(point.codim2?.candidate && !point.codim2.refined)
    rows.push({
      arrayIndex,
      sortedPosition: positions.get(arrayIndex) ?? -1,
      logicalIndex: Number.isFinite(logical) ? logical : arrayIndex,
      code,
      tone: bifurcationTone(code),
      label: bifurcationLabel(tag, code),
      fullLabel:
        code === 'NS' && tag === 'Hopf' ? 'Neimark-Sacker' : formatBifurcationType(tag ?? undefined),
      param1: Number.isFinite(point.param_value) ? point.param_value : null,
      param2: resolvePointParam2(branch, point, stateDimension),
      extra,
      candidate,
    })
  }
  return rows.sort((left, right) => left.sortedPosition - right.sortedPosition)
}

export type ParamRange = { start: number; end: number; min: number; max: number }

function rangeOf(values: number[]): ParamRange | null {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  return {
    start: finite[0],
    end: finite[finite.length - 1],
    min: Math.min(...finite),
    max: Math.max(...finite),
  }
}

/** Start/end (and min/max when the branch folds back) of the continuation parameters. */
export function branchParamRanges(
  branch: ContinuationObject,
  sortedOrder: number[],
  stateDimension: number
): { param1: ParamRange | null; param2: ParamRange | null } {
  const points = sortedOrder
    .map((arrayIndex) => branch.data.points[arrayIndex])
    .filter((point): point is ContinuationPoint => Boolean(point))
  const param1 = rangeOf(points.map((point) => point.param_value))
  const param2 = isCodim1CurveBranch(branch)
    ? rangeOf(
        points.map((point) => resolvePointParam2(branch, point, stateDimension) ?? Number.NaN)
      )
    : null
  return { param1, param2 }
}

/** `−0.5 → 3.37`, with `[min, max]` appended when the branch folds back. */
export function formatParamRange(range: ParamRange): string {
  const text = `${fmt(range.start, { digits: 4 })} → ${fmt(range.end, { digits: 4 })}`
  const lo = Math.min(range.start, range.end)
  const hi = Math.max(range.start, range.end)
  // Only report a fold when the branch turns back by a visible amount.
  const margin = Math.max(1e-12, 0.02 * Math.max(hi - lo, range.max - range.min))
  const folds = range.min < lo - margin || range.max > hi + margin
  if (!folds) return text
  return `${text} [${fmt(range.min, { digits: 4 })}, ${fmt(range.max, { digits: 4 })}]`
}

export type EigenRow = {
  index: number
  re: number
  im: number
  modulus: number
  arg: number
  unstable: boolean
  trivial: boolean
}

/** Every eigenvalue / multiplier, most unstable first. */
export function buildEigenRows(
  eigenvalues: ContinuationEigenvalue[],
  kind: 'flow' | 'map' | 'cycle',
  markUnstable = true
): EigenRow[] {
  const trivialIndex = kind === 'cycle' ? resolveTrivialFloquetModeIndex(eigenvalues) : null
  const rows = eigenvalues.map((value, index) => {
    const modulus = Math.hypot(value.re, value.im)
    const trivial = index === trivialIndex
    const unstable =
      !markUnstable
        ? false
        : kind === 'flow'
        ? value.re > 1e-8
        : !trivial && modulus > 1 + (kind === 'cycle' ? CYCLE_TOLERANCE : 1e-8)
    return {
      index,
      re: value.re,
      im: value.im,
      modulus,
      arg: Math.atan2(value.im, value.re),
      unstable,
      trivial,
    }
  })
  const key = (row: EigenRow) => (kind === 'flow' ? row.re : row.modulus)
  return rows.sort((left, right) => {
    const delta = key(right) - key(left)
    if (Number.isFinite(delta) && delta !== 0) return delta
    return right.im - left.im
  })
}

/** Parameter name(s) a branch is continued in. */
export function branchParamNames(branch: ContinuationObject): {
  param1: string
  param2: string | null
} {
  const branchType = branch.data.branch_type
  if (
    branchType &&
    typeof branchType === 'object' &&
    'param1_name' in branchType &&
    'param2_name' in branchType
  ) {
    return { param1: branchType.param1_name, param2: branchType.param2_name }
  }
  const parts = (branch.parameterName ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return { param1: parts[0] ?? branch.parameterName ?? '', param2: null }
}

/**
 * Meta line under the branch name: `<type> · N points · p1 −0.5 → 3.37`.
 * The `<type> · N points` prefix is relied on by tests; keep it verbatim.
 */
export function formatBranchSummaryDetail(
  branch: ContinuationObject,
  typeLabel: string,
  sortedOrder: number[],
  stateDimension: number
): string {
  const base = `${typeLabel.toLowerCase()} · ${branch.data.points.length} points`
  if (branch.data.points.length < 2) return base
  const ranges = branchParamRanges(branch, sortedOrder, stateDimension)
  const names = branchParamNames(branch)
  const parts: string[] = [base]
  if (ranges.param1 && names.param1) {
    parts.push(`${names.param1} ${formatParamRange(ranges.param1)}`)
  }
  if (ranges.param2 && names.param2) {
    parts.push(`${names.param2} ${formatParamRange(ranges.param2)}`)
  }
  return parts.join(' · ')
}

// Last selected point per branch, so re-selecting a branch restores the point
// instead of jumping back to the endpoint. Session-only by design.
const branchPointMemory = new Map<string, number>()

export function rememberBranchPoint(systemId: string, branchId: string, arrayIndex: number) {
  branchPointMemory.set(`${systemId}:${branchId}`, arrayIndex)
}

export function recallBranchPoint(
  systemId: string,
  branchId: string,
  pointCount: number
): number | null {
  const value = branchPointMemory.get(`${systemId}:${branchId}`)
  return typeof value === 'number' && value >= 0 && value < pointCount ? value : null
}

/** Tab-separated `label<TAB>value` lines with full precision, for the clipboard. */
export function formatPointTsv(sections: {
  index: number
  params: Array<[string, number]>
  state: Array<[string, number]>
  extras?: Array<[string, number | string]>
  eigenvalues: ContinuationEigenvalue[]
  eigenLabel: string
}): string {
  const lines: string[] = [`index\t${sections.index}`]
  for (const [label, value] of sections.params) lines.push(`${label}\t${value}`)
  for (const [label, value] of sections.state) lines.push(`${label}\t${value}`)
  for (const [label, value] of sections.extras ?? []) lines.push(`${label}\t${value}`)
  sections.eigenvalues.forEach((value, index) => {
    lines.push(`${sections.eigenLabel}${index + 1}\t${value.re}\t${value.im}`)
  })
  return lines.join('\n')
}
