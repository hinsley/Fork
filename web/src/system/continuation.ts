import type {
  ContinuationBranchData,
  ContinuationEndpointSeed,
  ContinuationEigenvalue,
  ContinuationObject,
  ContinuationPoint,
  System,
} from './types'
import { isValidParameterSet } from './parameters'

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

export type LimitCycleProfileLayout = 'mesh-first' | 'stage-first'

export function extractLimitCycleProfile(
  flatState: number[],
  dim: number,
  ntst: number,
  ncol: number,
  options?: { layout?: LimitCycleProfileLayout; allowPackedTail?: boolean }
): { profilePoints: number[][]; period: number; closurePoint?: number[] } {
  const period = flatState.length > 0 ? flatState[flatState.length - 1] : Number.NaN
  const profilePoints: number[][] = []
  if (dim <= 0) {
    return { profilePoints, period }
  }

  const rawState = flatState.slice(0, Math.max(flatState.length - 1, 0))
  if (rawState.length === dim) {
    return { profilePoints: [rawState], period }
  }

  const stageCount = Math.max(ntst * ncol, 0)
  const implicitMeshCount = Math.max(ntst, 0)
  const explicitMeshCount = Math.max(ntst + 1, 0)
  const implicitLen = (stageCount + implicitMeshCount) * dim
  const explicitLen = (stageCount + explicitMeshCount) * dim
  if (rawState.length === implicitLen || rawState.length === explicitLen) {
    const meshCount = rawState.length === explicitLen ? explicitMeshCount : implicitMeshCount
    const layout = options?.layout ?? 'mesh-first'
    const meshStart = layout === 'mesh-first' ? 0 : stageCount * dim
    const stageStart = layout === 'mesh-first' ? meshCount * dim : 0
    const meshSlice = rawState.slice(meshStart, meshStart + meshCount * dim)
    const stageSlice = rawState.slice(stageStart, stageStart + stageCount * dim)
    const meshPoints: number[][] = []
    const stagePoints: number[][] = []

    for (let i = 0; i < meshCount; i += 1) {
      const offset = i * dim
      meshPoints.push(meshSlice.slice(offset, offset + dim))
    }
    for (let i = 0; i < stageCount; i += 1) {
      const offset = i * dim
      stagePoints.push(stageSlice.slice(offset, offset + dim))
    }

    if (meshPoints.length > 0) {
      profilePoints.push(meshPoints[0])
    }
    for (let interval = 0; interval < ntst; interval += 1) {
      const stageOffset = interval * ncol
      for (let stage = 0; stage < ncol; stage += 1) {
        const point = stagePoints[stageOffset + stage]
        if (point) {
          profilePoints.push(point)
        }
      }
      const nextMesh =
        interval + 1 < meshPoints.length ? meshPoints[interval + 1] : meshPoints[0]
      if (nextMesh) {
        profilePoints.push(nextMesh)
      }
    }

    const closurePoint = options?.allowPackedTail
      ? readPackedEndpoint(rawState, dim, meshCount * dim, stageCount * dim)
      : undefined
    return { profilePoints, period, closurePoint }
  }

  if (options?.allowPackedTail && rawState.length > explicitLen && explicitLen > 0) {
    const layout = options?.layout ?? 'mesh-first'
    const meshCount = explicitMeshCount
    const meshLen = meshCount * dim
    const stageRawLen = stageCount * dim
    const meshStart = layout === 'mesh-first' ? 0 : stageRawLen
    const stageStart = layout === 'mesh-first' ? meshLen : 0
    const meshSlice = rawState.slice(meshStart, meshStart + meshLen)
    const stageSlice = rawState.slice(stageStart, stageStart + stageRawLen)
    if (meshSlice.length === meshLen && stageSlice.length === stageRawLen) {
      const meshPoints: number[][] = []
      const stagePoints: number[][] = []

      for (let i = 0; i < meshCount; i += 1) {
        const offset = i * dim
        meshPoints.push(meshSlice.slice(offset, offset + dim))
      }
      for (let i = 0; i < stageCount; i += 1) {
        const offset = i * dim
        stagePoints.push(stageSlice.slice(offset, offset + dim))
      }

      if (meshPoints.length > 0) {
        profilePoints.push(meshPoints[0])
      }
      for (let interval = 0; interval < ntst; interval += 1) {
        const stageOffset = interval * ncol
        for (let stage = 0; stage < ncol; stage += 1) {
          const point = stagePoints[stageOffset + stage]
          if (point) {
            profilePoints.push(point)
          }
        }
        const nextMesh =
          interval + 1 < meshPoints.length ? meshPoints[interval + 1] : meshPoints[0]
        if (nextMesh) {
          profilePoints.push(nextMesh)
        }
      }
      const closurePoint = readPackedEndpoint(rawState, dim, meshLen, stageRawLen)
      return { profilePoints, period: Number.NaN, closurePoint }
    }
  }

  const profilePointCount = Math.max(ntst * ncol + 1, 0)
  const profileLen = profilePointCount * dim
  if (profilePointCount > 0 && rawState.length === profileLen) {
    for (let i = 0; i < profilePointCount; i += 1) {
      const offset = i * dim
      profilePoints.push(rawState.slice(offset, offset + dim))
    }
  }

  const meshLen = implicitMeshCount * dim
  const stageLen = stageCount * dim
  const closurePoint = readPackedEndpoint(rawState, dim, meshLen, stageLen)
  return { profilePoints, period, closurePoint }
}

function readPackedEndpoint(
  rawState: number[],
  dim: number,
  meshLen: number,
  stageLen: number
): number[] | undefined {
  const endpointStart = meshLen + stageLen
  if (rawState.length < endpointStart + dim) return undefined
  const closure = rawState.slice(endpointStart, endpointStart + dim)
  return closure.length === dim && closure.every(Number.isFinite) ? closure : undefined
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
  data: ContinuationBranchDataInput,
  options?: { stateDimension?: number }
): ContinuationBranchData {
  const stateDimension = options?.stateDimension
  return {
    ...data,
    points: data.points.map((point) => {
      const inferredParam2 =
        typeof stateDimension === 'number' && Number.isFinite(stateDimension)
          ? resolveContinuationPointParam2Value(
              point,
              data.branch_type,
              Math.max(1, Math.round(stateDimension))
            )
          : undefined
      const param2_value = Number.isFinite(point.param2_value)
        ? point.param2_value
        : inferredParam2
      return {
        ...point,
        param2_value,
        eigenvalues: normalizeEigenvalueArray(point.eigenvalues),
      }
    }),
  }
}

export function resolveContinuationPointParam2Value(
  point: Pick<ContinuationPoint, 'state' | 'param2_value'>,
  branchType: ContinuationBranchData['branch_type'] | undefined,
  stateDimension: number
): number | undefined {
  if (Number.isFinite(point.param2_value)) {
    return point.param2_value
  }
  if (!branchType || typeof branchType !== 'object' || !('type' in branchType)) {
    return undefined
  }
  if (!Number.isFinite(stateDimension) || stateDimension < 1) {
    return undefined
  }
  const offsets = resolveHomoclinicPackedOffsets(branchType, stateDimension)
  if (!offsets) {
    return undefined
  }
  if (!Array.isArray(point.state) || point.state.length === 0) {
    return undefined
  }

  const p2Index = offsets.param2Index
  if (p2Index < 0 || p2Index >= point.state.length) {
    return undefined
  }
  const value = point.state[p2Index]
  return Number.isFinite(value) ? value : undefined
}

export function resolveContinuationPointEquilibriumState(
  point: Pick<ContinuationPoint, 'state'>,
  branchType: ContinuationBranchData['branch_type'] | undefined,
  stateDimension: number
): number[] | undefined {
  const offsets = resolveHomoclinicPackedOffsets(branchType, stateDimension)
  if (!offsets) return undefined
  if (!Array.isArray(point.state) || point.state.length === 0) {
    return undefined
  }
  const start = offsets.equilibriumStart
  const end = start + offsets.dim
  if (start < 0 || end > point.state.length) {
    return undefined
  }
  const values = point.state.slice(start, end)
  return values.every((value) => Number.isFinite(value)) ? values : undefined
}

function resolveHomoclinicPackedOffsets(
  branchType: ContinuationBranchData['branch_type'] | undefined,
  stateDimension: number
): { dim: number; equilibriumStart: number; param2Index: number } | null {
  if (!branchType || typeof branchType !== 'object' || !('type' in branchType)) {
    return null
  }
  if (!Number.isFinite(stateDimension) || stateDimension < 1) {
    return null
  }
  if (branchType.type !== 'HomoclinicCurve' && branchType.type !== 'HomotopySaddleCurve') {
    return null
  }
  const ntst = branchType.ntst
  const ncol = branchType.ncol
  if (!Number.isInteger(ntst) || !Number.isInteger(ncol) || ntst <= 0 || ncol <= 0) {
    return null
  }
  const dim = Math.max(1, Math.round(stateDimension))
  const meshLen = (ntst + 1) * dim
  const stageLen = ntst * ncol * dim
  const equilibriumStart = meshLen + stageLen
  const param2Index = equilibriumStart + dim
  return { dim, equilibriumStart, param2Index }
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

function requireLimitCycleBranchType(
  branchType: ContinuationBranchData['branch_type'] | undefined
): { type: 'LimitCycle'; ntst: number; ncol: number } {
  if (
    !branchType ||
    typeof branchType !== 'object' ||
    !('type' in branchType) ||
    branchType.type !== 'LimitCycle'
  ) {
    throw new Error('Limit cycle branch is missing branch_type metadata.')
  }

  const { ntst, ncol } = branchType
  if (!Number.isInteger(ntst) || ntst <= 0 || !Number.isInteger(ncol) || ncol <= 0) {
    throw new Error('Limit cycle branch has invalid mesh settings.')
  }

  return { type: 'LimitCycle', ntst, ncol }
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
    branchType = requireLimitCycleBranchType(data.branch_type)
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

function isValidEndpointSeedForIndices(
  seed: ContinuationEndpointSeed | undefined,
  validIndices: Set<number>
): seed is ContinuationEndpointSeed {
  if (!seed) return false
  if (!Number.isFinite(seed.endpoint_index) || !validIndices.has(seed.endpoint_index)) {
    return false
  }
  if (!Array.isArray(seed.aug_state) || seed.aug_state.some((value) => !Number.isFinite(value))) {
    return false
  }
  if (!Array.isArray(seed.tangent) || seed.tangent.some((value) => !Number.isFinite(value))) {
    return false
  }
  if (!Number.isFinite(seed.step_size) || seed.step_size <= 0) return false
  return true
}

function remapTrimmedEndpointSeed(
  seed: ContinuationEndpointSeed | undefined,
  indexBase: number,
  validIndices: Set<number>
): ContinuationEndpointSeed | undefined {
  if (!seed || !Number.isFinite(seed.endpoint_index)) return undefined
  const endpoint_index = seed.endpoint_index - indexBase
  if (!validIndices.has(endpoint_index)) return undefined
  return {
    ...seed,
    endpoint_index,
  }
}

function buildAugmentedSeedState(point: ContinuationPoint): number[] | null {
  if (!Number.isFinite(point.param_value)) return null
  if (!Array.isArray(point.state) || point.state.length === 0) return null
  if (point.state.some((value) => !Number.isFinite(value))) return null
  return [point.param_value, ...point.state]
}

function normalizeSeedVector(values: number[]): number[] | null {
  const norm = Math.hypot(...values)
  if (!Number.isFinite(norm) || norm <= 1e-12) return null
  return values.map((value) => value / norm)
}

function buildTrimmedBoundarySeed(
  originalPoints: ContinuationPoint[],
  trimmedPoints: ContinuationPoint[],
  stepSizeHint: number
): ContinuationEndpointSeed | undefined {
  const retained = trimmedPoints[0]
  if (!retained) return undefined
  const retainedAug = buildAugmentedSeedState(retained)
  if (!retainedAug) return undefined

  let tangent: number[] | null = null
  const prev = originalPoints[0]
  const next = originalPoints[2]
  if (prev && next) {
    const prevAug = buildAugmentedSeedState(prev)
    const nextAug = buildAugmentedSeedState(next)
    if (
      prevAug &&
      nextAug &&
      prevAug.length === retainedAug.length &&
      nextAug.length === retainedAug.length
    ) {
      const centered = nextAug.map((value, index) => value - prevAug[index])
      tangent = normalizeSeedVector(centered)
    }
  }

  if (!tangent && trimmedPoints[1]) {
    const neighborAug = buildAugmentedSeedState(trimmedPoints[1])
    if (neighborAug && neighborAug.length === retainedAug.length) {
      const secant = retainedAug.map((value, index) => value - neighborAug[index])
      tangent = normalizeSeedVector(secant)
    }
  }

  if (!tangent) return undefined
  const step_size = Number.isFinite(stepSizeHint) && stepSizeHint > 0 ? stepSizeHint : 0.01
  return {
    endpoint_index: 0,
    aug_state: retainedAug,
    tangent,
    step_size,
  }
}

function trimHomoclinicSeedPoint(data: ContinuationBranchData): ContinuationBranchData {
  const seedAnchor = buildAugmentedSeedState(data.points[0])
  const points = data.points.slice(1)
  const rawIndices =
    data.indices && data.indices.length === data.points.length
      ? data.indices.slice(1)
      : points.map((_, index) => index)
  const indexBase = rawIndices.length > 0 ? rawIndices[0] : 0
  const indices = rawIndices.map((value, index) =>
    Number.isFinite(value) ? value - indexBase : index
  )
  const validIndices = new Set<number>(indices.filter((idx) => Number.isFinite(idx)))
  const bifurcations = (data.bifurcations ?? [])
    .filter((idx) => idx > 0)
    .map((idx) => idx - 1)
    .filter((idx) => idx >= 0 && idx < points.length)

  const minSeed = remapTrimmedEndpointSeed(data.resume_state?.min_index_seed, indexBase, validIndices)
  const maxSeed = remapTrimmedEndpointSeed(data.resume_state?.max_index_seed, indexBase, validIndices)
  const finiteIndices = indices.filter((idx) => Number.isFinite(idx))
  const minLogicalIndex = finiteIndices.length > 0 ? Math.min(...finiteIndices) : 0
  const maxLogicalIndex = finiteIndices.length > 0 ? Math.max(...finiteIndices) : 0
  const boundaryStepHint =
    data.resume_state?.min_index_seed?.step_size ??
    data.resume_state?.max_index_seed?.step_size ??
    0.01
  const synthesizedBoundarySeed =
    points.length > 1 ? buildTrimmedBoundarySeed(data.points, points, boundaryStepHint) : undefined
  const minBoundarySeed =
    !minSeed && synthesizedBoundarySeed && minLogicalIndex === 0
      ? synthesizedBoundarySeed
      : minSeed
  const maxBoundarySeed =
    !maxSeed && synthesizedBoundarySeed && maxLogicalIndex === 0
      ? synthesizedBoundarySeed
      : maxSeed

  const normalized: ContinuationBranchData & { upoldp?: number[][] } = {
    ...data,
    points,
    indices,
    bifurcations,
    resume_state: minBoundarySeed || maxBoundarySeed
      ? {
          min_index_seed: minBoundarySeed,
          max_index_seed: maxBoundarySeed,
        }
      : undefined,
  }
  if (seedAnchor && seedAnchor.every(Number.isFinite)) {
    normalized.upoldp = [seedAnchor]
  }
  return normalized
}

export function ensureHomoclinicEndpointResumeSeeds(
  data: ContinuationBranchData
): ContinuationBranchData {
  const validIndices = new Set<number>(ensureBranchIndices(data))
  const resume = data.resume_state
  const minSeed = isValidEndpointSeedForIndices(resume?.min_index_seed, validIndices)
    ? resume?.min_index_seed
    : undefined
  const maxSeed = isValidEndpointSeedForIndices(resume?.max_index_seed, validIndices)
    ? resume?.max_index_seed
    : undefined
  if (!minSeed && !maxSeed) {
    return { ...data, resume_state: undefined }
  }
  return {
    ...data,
    resume_state: {
      min_index_seed: minSeed,
      max_index_seed: maxSeed,
    },
  }
}

export function discardHomoclinicInitialApproximationPoint(
  data: ContinuationBranchData
): ContinuationBranchData {
  if (!Array.isArray(data.points) || data.points.length <= 1) {
    return data
  }
  return trimHomoclinicSeedPoint(data)
}

export function trimHomoclinicLargeCycleSeedPoint(
  data: ContinuationBranchData
): ContinuationBranchData {
  if (!Array.isArray(data.points) || data.points.length <= 1) return data
  const hasSeedAnchor =
    Array.isArray(data.upoldp) &&
    data.upoldp.length > 0 &&
    Array.isArray(data.upoldp[0]) &&
    data.upoldp[0].length > 1
  if (hasSeedAnchor) return data
  const indices = ensureBranchIndices(data)
  if (indices.length <= 1) return data
  const firstLogical = indices[0] ?? 0
  const secondLogical = indices[1] ?? firstLogical
  if (!(firstLogical === 0 && secondLogical !== 0)) return data
  return trimHomoclinicSeedPoint(data)
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

export function getBranchParams(
  system: Pick<System, 'config' | 'objects'>,
  branch: ContinuationObject
): number[] {
  if (isValidParameterSet(system.config.params, branch.params)) {
    return [...branch.params]
  }
  const parent =
    (branch.parentObjectId ? system.objects[branch.parentObjectId] : undefined) ??
    Object.values(system.objects).find((obj) => obj.name === branch.parentObject)
  if (parent && parent.type !== 'continuation') {
    if (isValidParameterSet(system.config.params, parent.customParameters)) {
      return [...parent.customParameters]
    }
    if (isValidParameterSet(system.config.params, parent.parameters)) {
      return [...parent.parameters]
    }
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
