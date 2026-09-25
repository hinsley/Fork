/**
 * Pure digests of objects and branches for single-line tree rows.
 *
 * Summaries are written onto index entries (see model.ts / opfs.ts / indexedDb.ts)
 * so the tree can show real data for entities whose payloads are not hydrated.
 * Keep them small: short strings and a handful of bifurcation codes only.
 */
import type {
  AnalysisObject,
  ContinuationEigenvalue,
  ContinuationObject,
  ManifoldCurveGeometry,
  ManifoldGeometry,
  ManifoldSurfaceGeometry,
  ParameterRef,
  RowSummary,
  RowSummaryTone,
  System,
  SystemConfig,
} from './types'
import { fmt, fmtCompactCount } from '../utils/format'
import {
  bifurcationCode,
  bifurcationTone,
  classifyEquilibrium,
  type BifurcationTone,
} from './stability'
import { interpretLimitCycleStability, normalizeEigenvalueArray } from './continuation'
import {
  formatContinuationParameterDisplayLabel,
  formatParameterRefLabel,
} from './subsystemGateway'

type SummaryConfig = Pick<SystemConfig, 'type'>

const MAX_WARN_LENGTH = 160

/** Exact counts below 10 000, compact above (`1000`, `10k`, `1.2M`). */
function count(value: number): string {
  return Math.abs(value) < 1e4 ? String(Math.trunc(value)) : fmtCompactCount(value)
}

function short(value: number): string {
  return fmt(value, { digits: 3 })
}

function clip(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  return trimmed.length > MAX_WARN_LENGTH ? `${trimmed.slice(0, MAX_WARN_LENGTH - 1)}…` : trimmed
}

function compact(summary: RowSummary): RowSummary {
  const out: RowSummary = {}
  if (summary.text) out.text = summary.text
  if (summary.status) out.status = summary.status
  if (summary.tone) out.tone = summary.tone
  if (summary.bifs && summary.bifs.length > 0) out.bifs = summary.bifs
  if (summary.warn) out.warn = summary.warn
  return out
}

/** Stability chip for a cycle from its Floquet multipliers (`stable`, `unstable 1u`, `unstable (torus)`). */
export function describeLimitCycleStability(
  multipliers: ContinuationEigenvalue[] | undefined
): { label: string; tone: RowSummaryTone } | null {
  const label = interpretLimitCycleStability(multipliers)
  if (label === 'unknown') return null
  return { label, tone: label === 'stable' ? 'stable' : 'unstable' }
}

/** Stability chip for a forced periodic response from its strobe-map multipliers. */
export function describeForcedResponseStability(
  multipliers: ContinuationEigenvalue[] | undefined
): { label: string; tone: RowSummaryTone } | null {
  const stability = classifyEquilibrium(multipliers, 'map')
  return stability.kind === 'unknown' ? null : { label: stability.label, tone: stability.kind }
}

function isFiniteRow(row: number[] | undefined): boolean {
  if (!row || row.length === 0) return false
  for (const value of row) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
  }
  return true
}

/**
 * Index of the first orbit sample whose time or state is non-finite (the orbit
 * blew up), or -1 when the final sample is finite. Non-finite values persist
 * once reached, so a binary search suffices.
 */
export function findOrbitDivergenceIndex(data: number[][] | undefined): number {
  const rows = data ?? []
  if (rows.length === 0 || isFiniteRow(rows[rows.length - 1])) return -1
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (isFiniteRow(rows[mid])) lo = mid + 1
    else hi = mid
  }
  return lo
}

function summarizeOrbit(
  object: Extract<AnalysisObject, { type: 'orbit' }>,
  config: SummaryConfig
): RowSummary {
  const samples = object.data?.length ?? 0
  if (samples === 0) return { text: '—', tone: 'muted' }
  let text: string
  if (config.type === 'map') {
    const span = object.t_end - object.t_start
    const iterations = Number.isFinite(span) && span > 0 ? Math.round(span) : samples - 1
    text = `n ${count(iterations)}`
  } else {
    text = `t ${short(object.t_start)}–${short(object.t_end)} · ${count(samples)}`
  }
  const leading = object.lyapunovExponents?.[0]
  if (typeof leading === 'number' && Number.isFinite(leading)) {
    text += ` · λ₁ ${short(leading)}`
  }
  if (findOrbitDivergenceIndex(object.data) >= 0) {
    return { text, status: 'diverged', tone: 'unstable' }
  }
  return { text }
}

function summarizeEquilibrium(
  object: Extract<AnalysisObject, { type: 'equilibrium' }>,
  config: SummaryConfig
): RowSummary {
  const solution = object.solution
  if (solution) {
    const stability = classifyEquilibrium(
      (solution.eigenpairs ?? []).map((pair) => pair.value),
      config.type
    )
    const period = config.type === 'map' ? solution.cycle_points?.length ?? 1 : 1
    return compact({
      text: period > 1 ? `${period}-cycle` : undefined,
      status: stability.kind === 'unknown' ? 'solved' : stability.label,
      tone: stability.kind,
    })
  }
  if (object.lastRun && !object.lastRun.success) {
    return compact({
      status: 'failed',
      tone: 'unstable',
      warn: clip(object.lastRun.diagnostic?.message),
    })
  }
  return { status: 'unsolved', tone: 'muted' }
}

/**
 * The branch point a limit cycle or forced response is rendered at (its
 * "@ branch #i" target). The inspector glance shows this point's values, so
 * the tree row summarizes the same point.
 */
export type RenderedPointSummary = {
  period?: number
  multipliers?: ContinuationEigenvalue[]
  forcingPeriod?: number
  responseMultiple?: number
}

export function resolveRenderedPointSummary(
  renderTargets: System['ui']['limitCycleRenderTargets'],
  branches: System['branches'],
  objectId: string,
  objectType: AnalysisObject['type']
): RenderedPointSummary | undefined {
  if (objectType !== 'limit_cycle' && objectType !== 'forced_periodic_response') return undefined
  const target = renderTargets?.[objectId]
  if (target?.type !== 'branch') return undefined
  const branch = branches[target.branchId]
  const point = branch?.data.points[target.pointIndex]
  if (!branch || !point) return undefined
  const multipliers = normalizeEigenvalueArray(point.eigenvalues)
  if (objectType === 'limit_cycle') {
    const period = point.state[point.state.length - 1]
    return { period: Number.isFinite(period) ? period : undefined, multipliers }
  }
  const metadata = branch.data.branch_type
  return {
    forcingPeriod:
      typeof point.forcing_period === 'number' && Number.isFinite(point.forcing_period)
        ? point.forcing_period
        : undefined,
    responseMultiple:
      metadata?.type === 'ForcedPeriodicResponse' ? metadata.response_multiple : undefined,
    multipliers,
  }
}

function summarizeLimitCycle(
  object: Extract<AnalysisObject, { type: 'limit_cycle' }>,
  rendered?: RenderedPointSummary
): RowSummary {
  const stability = describeLimitCycleStability(
    rendered
      ? rendered.multipliers
      : object.floquetMultipliers ?? object.floquetModes?.multipliers
  )
  const period = rendered ? rendered.period : object.period
  return compact({
    text:
      typeof period === 'number' && Number.isFinite(period)
        ? `T ${fmt(period, { digits: 4 })}`
        : undefined,
    status: stability?.label,
    tone: stability?.tone,
  })
}

function summarizeForcedResponse(
  object: Extract<AnalysisObject, { type: 'forced_periodic_response' }>,
  rendered?: RenderedPointSummary
): RowSummary {
  const solution = object.solution
  if (rendered) {
    const stability = describeForcedResponseStability(rendered.multipliers)
    const multiple = rendered.responseMultiple ?? solution?.response_multiple ?? 1
    let text: string | undefined
    if (typeof rendered.forcingPeriod === 'number') {
      text = `T ${fmt(rendered.forcingPeriod, { digits: 4 })}`
      if (multiple > 1) text += ` ×${multiple}`
    }
    return compact({ text, status: stability?.label, tone: stability?.tone })
  }
  if (!solution) return { status: 'unsolved', tone: 'muted' }
  let text = `T ${fmt(solution.forcing_period, { digits: 4 })}`
  if (solution.response_multiple > 1) text += ` ×${solution.response_multiple}`
  const stability = describeForcedResponseStability(solution.multipliers)
  return stability ? { text, status: stability.label, tone: stability.tone } : { text }
}

function summarizeIsocline(object: Extract<AnalysisObject, { type: 'isocline' }>): RowSummary {
  const level = fmt(object.level)
  const source = object.source
  let text: string
  if (source.kind === 'flow_derivative') text = `${source.variableName}′=${level}`
  else if (source.kind === 'map_increment') text = `Δ${source.variableName}=${level}`
  else text = `${source.expression.trim()}=${level}`
  return object.lastComputed ? { text } : { text, tone: 'muted' }
}

function summarizeStateGrid(object: Extract<AnalysisObject, { type: 'state_grid' }>): RowSummary {
  const parts: string[] = []
  const resolutions = (object.axes ?? []).map((axis) => axis.resolution)
  if (resolutions.length > 0) parts.push(resolutions.join('×'))
  const estimates = object.lastResult?.entropyEstimates ?? []
  for (let index = estimates.length - 1; index >= 0; index -= 1) {
    const value = estimates[index]
    if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(`h ${short(value)}`)
      break
    }
  }
  return compact({ text: parts.join(' · ') || undefined })
}

export function summarizeObject(
  object: AnalysisObject | null | undefined,
  config: SummaryConfig,
  rendered?: RenderedPointSummary
): RowSummary | undefined {
  if (!object) return undefined
  let summary: RowSummary | undefined
  switch (object.type) {
    case 'orbit':
      summary = summarizeOrbit(object, config)
      break
    case 'equilibrium':
      summary = summarizeEquilibrium(object, config)
      break
    case 'limit_cycle':
      summary = summarizeLimitCycle(object, rendered)
      break
    case 'forced_periodic_response':
      summary = summarizeForcedResponse(object, rendered)
      break
    case 'isocline':
      summary = summarizeIsocline(object)
      break
    case 'state_grid':
      summary = summarizeStateGrid(object)
      break
    case 'invariant_measure': {
      const boxes = object.result?.totalBoxes
      summary =
        typeof boxes === 'number' && Number.isFinite(boxes)
          ? { text: `${count(boxes)} boxes` }
          : undefined
      break
    }
    case 'particles':
      summary = object.settings?.playing ? { text: 'playing' } : undefined
      break
    case 'continuation':
      summary = summarizeBranch(object, config)
      break
    default:
      summary = undefined
  }
  if (!summary) return undefined
  const compacted = compact(summary)
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

const CODIM1_BRANCH_TYPES = new Set<ContinuationObject['branchType']>([
  'equilibrium',
  'limit_cycle',
  'forced_periodic_response',
])

function refLabel(ref: ParameterRef | undefined): string | null {
  if (!ref) return null
  return formatContinuationParameterDisplayLabel(formatParameterRefLabel(ref))
}

function nameParts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function codim2ParamNames(branch: ContinuationObject): [string, string] | null {
  const branchType = branch.data?.branch_type
  const typed =
    branchType && typeof branchType === 'object' ? (branchType as Record<string, unknown>) : null
  const typedName = (key: string) =>
    typed && typeof typed[key] === 'string' ? (typed[key] as string).trim() : ''
  const typedRef = (key: string) =>
    typed && typed[key] && typeof typed[key] === 'object'
      ? refLabel(typed[key] as ParameterRef)
      : null
  const parts = nameParts(branch.parameterName)
  const first =
    typedName('param1_name') || typedRef('param1_ref') || refLabel(branch.parameterRef) || parts[0]
  const second =
    typedName('param2_name') || typedRef('param2_ref') || refLabel(branch.parameter2Ref) || parts[1]
  return first && second ? [first, second] : null
}

function collectBifurcations(
  branch: ContinuationObject,
  config: SummaryConfig
): Array<[string, number]> {
  const counts = new Map<string, number>()
  const points = branch.data?.points ?? []
  for (const index of branch.data?.bifurcations ?? []) {
    const code = bifurcationCode(points[index]?.stability, config.type)
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
}

function manifoldText(branch: ContinuationObject): string | null {
  const geometry = branch.data?.manifold_geometry as ManifoldGeometry | undefined
  if (!geometry) return branch.branchType === 'eq_manifold_1d' ? '1d' : '2d'
  if (geometry.type === 'Curve') {
    const curve: ManifoldCurveGeometry | undefined =
      'Curve' in geometry ? geometry.Curve : (geometry as unknown as ManifoldCurveGeometry)
    const dim = curve?.dim ?? 0
    const samples = dim > 0 ? Math.floor((curve?.points_flat?.length ?? 0) / dim) : 0
    return samples > 0 ? `1d · ${count(samples)}` : '1d'
  }
  const surface: ManifoldSurfaceGeometry | undefined =
    'Surface' in geometry ? geometry.Surface : (geometry as unknown as ManifoldSurfaceGeometry)
  const parts = ['2d']
  const rings = surface?.ring_offsets?.length ?? 0
  if (rings > 0) parts.push(`${count(rings)} rings`)
  const reason = surface?.solver_diagnostics?.termination_reason?.trim()
  if (reason) parts.push(reason.replaceAll('_', ' '))
  return parts.join(' · ')
}

export function summarizeBranch(
  branch: ContinuationObject | null | undefined,
  config: SummaryConfig
): RowSummary | undefined {
  if (!branch) return undefined
  const points = branch.data?.points ?? []
  const warn = clip(branch.data?.termination?.message)
  const bifs = collectBifurcations(branch, config)

  let text: string | undefined
  let tone: RowSummaryTone | undefined
  if (branch.branchType.includes('manifold')) {
    text = manifoldText(branch) ?? undefined
  } else if (points.length === 0) {
    text = '—'
    tone = 'muted'
  } else if (CODIM1_BRANCH_TYPES.has(branch.branchType)) {
    const label =
      refLabel(branch.parameterRef) || nameParts(branch.parameterName)[0] || 'param'
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const entry of points) {
      const value = entry.param_value
      if (!Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
    text =
      min <= max
        ? `${label} ${short(min)}…${short(max)} · ${count(points.length)}`
        : `${label} · ${count(points.length)}`
  } else {
    const names = codim2ParamNames(branch)
    text = names
      ? `${names[0]}, ${names[1]} · ${count(points.length)}`
      : count(points.length)
  }
  return compact({ text, tone, bifs, warn })
}

/** Spreadable `{ summary }` for index entries; omits the key when there is nothing to show. */
export function rowSummaryField(summary: RowSummary | undefined): { summary?: RowSummary } {
  return summary ? { summary } : {}
}

export type BifurcationBadge = {
  code: string
  count: number
  label: string
  tone: BifurcationTone
}

/** Deduplicated badges (`LP×2`), capped at `max` with the remainder as overflow. */
export function formatBifurcationBadges(
  bifs: RowSummary['bifs'],
  max = 3
): { shown: BifurcationBadge[]; overflow: number } {
  const entries = bifs ?? []
  const shown = entries.slice(0, max).map(([code, total]) => ({
    code,
    count: total,
    label: total > 1 ? `${code}×${total}` : code,
    tone: bifurcationTone(code),
  }))
  return { shown, overflow: Math.max(0, entries.length - max) }
}

/**
 * Filter predicate for tree rows. Lower-case queries match names and summary
 * text case-insensitively; queries with capitals are case-sensitive and also
 * match bifurcation codes exactly (`H`, `LP`).
 */
export function rowSummaryMatches(
  query: string,
  name: string,
  summary: RowSummary | undefined,
  extra: string[] = []
): boolean {
  const needle = query.trim()
  if (!needle) return true
  const caseSensitive = needle !== needle.toLowerCase()
  const haystacks = [name, summary?.text ?? '', summary?.status ?? '', ...extra]
  if (caseSensitive) {
    if (summary?.bifs?.some(([code]) => code === needle)) return true
    return haystacks.some((value) => value.includes(needle))
  }
  return haystacks.some((value) => value.toLowerCase().includes(needle))
}
