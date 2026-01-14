import type {
  ContinuationBranchData,
  ContinuationEigenvalue,
  ContinuationObject,
  ContinuationPoint,
  System,
} from './types'

type EigenvalueWire = [number, number]

type EigenvalueInput = ContinuationEigenvalue | EigenvalueWire | { re?: number; im?: number }

type ContinuationPointInput = Omit<ContinuationPoint, 'eigenvalues'> & {
  eigenvalues?: EigenvalueInput[]
}

type ContinuationBranchDataInput = Omit<ContinuationBranchData, 'points'> & {
  points: ContinuationPointInput[]
}

type ContinuationPointWire = Omit<ContinuationPoint, 'eigenvalues'> & {
  eigenvalues: EigenvalueWire[]
}

export type ContinuationBranchDataWire = Omit<ContinuationBranchData, 'points'> & {
  points: ContinuationPointWire[]
}

export function normalizeEigenvalueArray(raw: unknown): ContinuationEigenvalue[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw.map((value) => {
    if (Array.isArray(value)) {
      const tuple = value as EigenvalueWire
      return { re: tuple[0] ?? 0, im: tuple[1] ?? 0 }
    }
    const entry = value as { re?: number; im?: number }
    return {
      re: typeof entry?.re === 'number' ? entry.re : Number(entry?.re ?? 0),
      im: typeof entry?.im === 'number' ? entry.im : Number(entry?.im ?? 0),
    }
  })
}

export function extractHopfOmega(point: ContinuationPoint): number {
  const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
  if (eigenvalues.length === 0) return 1.0

  let maxAbsIm = 0
  for (const eig of eigenvalues) {
    if (!Number.isFinite(eig.re) || !Number.isFinite(eig.im)) continue
    maxAbsIm = Math.max(maxAbsIm, Math.abs(eig.im))
  }
  if (maxAbsIm <= 0) return 1.0

  const minImag = maxAbsIm * 1e-3
  let bestRe = Number.POSITIVE_INFINITY
  let bestIm = 0
  for (const eig of eigenvalues) {
    if (!Number.isFinite(eig.re) || !Number.isFinite(eig.im)) continue
    const absRe = Math.abs(eig.re)
    const absIm = Math.abs(eig.im)
    if (absIm < minImag) continue
    if (absRe < bestRe || (absRe === bestRe && absIm > Math.abs(bestIm))) {
      bestRe = absRe
      bestIm = eig.im
    }
  }

  if (bestIm === 0) {
    bestIm = maxAbsIm
  }

  return Math.abs(bestIm) || 1.0
}

export type LimitCycleMetrics = {
  period: number
  ranges: { min: number; max: number; range: number }[]
  means: number[]
  rmsAmplitudes: number[]
}

export function extractLimitCycleProfile(
  flatState: number[],
  dim: number,
  ntst: number,
  ncol: number
): { profilePoints: number[][]; period: number } {
  const profilePointCount = Math.max(ntst * ncol + 1, 0)
  const period = flatState[flatState.length - 1]
  const profilePoints: number[][] = []

  if (dim <= 0 || profilePointCount === 0) {
    return { profilePoints, period }
  }

  for (let i = 0; i < profilePointCount; i += 1) {
    const offset = i * dim
    profilePoints.push(flatState.slice(offset, offset + dim))
  }

  return { profilePoints, period }
}

export function computeLimitCycleMetrics(
  profilePoints: number[][],
  period: number
): LimitCycleMetrics {
  const dim = profilePoints[0]?.length || 0
  const n = profilePoints.length

  const ranges: { min: number; max: number; range: number }[] = []
  const means: number[] = []
  const rmsAmplitudes: number[] = []

  for (let d = 0; d < dim; d += 1) {
    const values = profilePoints.map((pt) => pt[d])
    const min = Math.min(...values)
    const max = Math.max(...values)
    const mean = values.reduce((sum, value) => sum + value, 0) / n
    const rms = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n
    )

    ranges.push({ min, max, range: max - min })
    means.push(mean)
    rmsAmplitudes.push(rms)
  }

  return { period, ranges, means, rmsAmplitudes }
}

export function interpretLimitCycleStability(
  eigenvalues: ContinuationEigenvalue[] | undefined
): string {
  if (!eigenvalues || eigenvalues.length === 0) return 'unknown'

  let unstableCount = 0
  let hasNeimarkSacker = false

  for (const eig of eigenvalues) {
    const magnitude = Math.hypot(eig.re, eig.im)
    if (Math.abs(magnitude - 1.0) < 0.01 && Math.abs(eig.im) < 0.01) continue

    if (magnitude > 1.0 + 1e-6) {
      unstableCount += 1
      if (Math.abs(eig.im) > 1e-6) hasNeimarkSacker = true
    }
  }

  if (unstableCount === 0) return 'stable'
  if (hasNeimarkSacker) return 'unstable (torus)'
  return `unstable (${unstableCount}D)`
}

export function normalizeBranchEigenvalues(
  data: ContinuationBranchDataInput
): ContinuationBranchData {
  return {
    ...data,
    points: data.points.map((point) => ({
      ...point,
      eigenvalues: normalizeEigenvalueArray(point.eigenvalues),
    })),
  }
}

function serializeEigenvalueArray(raw: EigenvalueInput[] | undefined): EigenvalueWire[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw.map((value) => {
    if (Array.isArray(value)) {
      return [value[0] ?? 0, value[1] ?? 0]
    }
    return [value?.re ?? 0, value?.im ?? 0]
  })
}

function normalizeLimitCycleBranchType(
  branchType: ContinuationBranchData['branch_type'] | undefined
): ContinuationBranchData['branch_type'] {
  const fallback = { type: 'LimitCycle', ntst: 20, ncol: 4 } as const
  if (!branchType) return fallback

  const branchTypeValue = branchType as unknown
  if (typeof branchTypeValue === 'string') {
    return fallback
  }

  if ('type' in branchType) {
    if (branchType.type === 'LimitCycle') {
      return {
        type: 'LimitCycle',
        ntst: branchType.ntst ?? fallback.ntst,
        ncol: branchType.ncol ?? fallback.ncol,
      }
    }
    return fallback
  }

  const legacy = branchType as { LimitCycle?: { ntst?: number; ncol?: number } }
  if (legacy.LimitCycle) {
    return {
      type: 'LimitCycle',
      ntst: legacy.LimitCycle.ntst ?? fallback.ntst,
      ncol: legacy.LimitCycle.ncol ?? fallback.ncol,
    }
  }

  return fallback
}

export function serializeBranchDataForWasm(
  branch: ContinuationObject
): ContinuationBranchDataWire {
  const data = branch.data
  const indices =
    data.indices && data.indices.length === data.points.length
      ? data.indices
      : data.points.map((_, index) => index)
  const points = data.points.map((point) => ({
    ...point,
    eigenvalues: serializeEigenvalueArray(point.eigenvalues),
  }))

  let branchType = data.branch_type
  if (branch.branchType === 'limit_cycle') {
    branchType = normalizeLimitCycleBranchType(data.branch_type)
  }

  return {
    ...data,
    indices,
    branch_type: branchType,
    points,
  }
}

export function ensureBranchIndices(data: ContinuationBranchData): number[] {
  const raw =
    data.indices && data.indices.length === data.points.length
      ? Array.from(data.indices)
      : data.points.map((_, index) => index)
  return raw.map((value, index) =>
    Number.isFinite(value) ? Number(value) : index
  )
}

export function buildSortedArrayOrder(indices: number[]): number[] {
  return indices
    .map((logicalIdx, arrayIdx) => ({
      logicalIdx: Number.isFinite(logicalIdx) ? logicalIdx : arrayIdx,
      arrayIdx,
    }))
    .sort((a, b) => a.logicalIdx - b.logicalIdx)
    .map((entry) => entry.arrayIdx)
}

export function getBranchParams(system: System, branch: ContinuationObject): number[] {
  if (branch.params && branch.params.length === system.config.params.length) {
    return [...branch.params]
  }
  const parent = Object.values(system.objects).find(
    (obj) => obj.name === branch.parentObject
  )
  const params = parent && 'parameters' in parent ? parent.parameters : undefined
  if (Array.isArray(params) && params.length === system.config.params.length) {
    return [...params]
  }
  return [...system.config.params]
}

const BIFURCATION_TYPE_LABELS: Record<string, string> = {
  Fold: 'Fold',
  Hopf: 'Hopf',
  NeutralSaddle: 'Neutral Saddle',
  CycleFold: 'Cycle Fold',
  PeriodDoubling: 'Period Doubling',
  NeimarkSacker: 'Neimark-Sacker',
  Cusp: 'Cusp',
  BogdanovTakens: 'Bogdanov-Takens',
  ZeroHopf: 'Zero-Hopf',
  DoubleHopf: 'Double-Hopf',
  GeneralizedHopf: 'Generalized Hopf',
  CuspOfCycles: 'Cusp of Cycles',
  FoldFlip: 'Fold-Flip',
  FoldNeimarkSacker: 'Fold-Neimark-Sacker',
  FlipNeimarkSacker: 'Flip-Neimark-Sacker',
  DoubleNeimarkSacker: 'Double Neimark-Sacker',
  GeneralizedPeriodDoubling: 'Generalized Period Doubling',
  Chenciner: 'Chenciner',
  Resonance1_1: 'Resonance 1:1',
  Resonance1_2: 'Resonance 1:2',
  Resonance1_3: 'Resonance 1:3',
  Resonance1_4: 'Resonance 1:4',
}

export function formatBifurcationType(value?: ContinuationPoint['stability']): string {
  if (!value || value === 'None') return 'Unknown'
  const mapped = BIFURCATION_TYPE_LABELS[value]
  if (mapped) return mapped
  const formatted = value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return formatted.length > 0 ? formatted : 'Unknown'
}

export function formatBifurcationLabel(index: number, value?: ContinuationPoint['stability']): string {
  const indexLabel = Number.isFinite(index) ? `Index ${index}` : 'Index ?'
  const typeLabel = formatBifurcationType(value)
  return `${indexLabel} - ${typeLabel}`
}
