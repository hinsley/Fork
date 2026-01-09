import type {
  ContinuationBranchData,
  ContinuationEigenvalue,
  ContinuationObject,
  System,
} from './types'

type EigenvalueWire = [number, number]

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

export function normalizeBranchEigenvalues(data: ContinuationBranchData): ContinuationBranchData {
  return {
    ...data,
    points: data.points.map((point) => ({
      ...point,
      eigenvalues: normalizeEigenvalueArray(point.eigenvalues),
    })),
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
