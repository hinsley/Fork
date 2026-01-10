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
  if (data.indices && data.indices.length === data.points.length) {
    return data.indices
  }
  return data.points.map((_, index) => index)
}

export function buildSortedArrayOrder(indices: number[]): number[] {
  return indices
    .map((logicalIdx, arrayIdx) => ({ logicalIdx, arrayIdx }))
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
