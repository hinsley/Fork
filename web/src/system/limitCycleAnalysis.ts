import type { SubsystemSnapshot } from './types'
import { projectStateToReduced } from './subsystemGateway'

export type LimitCyclePackedStateLayout = 'implicit' | 'explicit' | 'auto'

export function projectLimitCyclePackedStateForSnapshot(
  snapshot: SubsystemSnapshot,
  state: number[],
  ntst: number,
  ncol: number,
  label: string,
  layout: LimitCyclePackedStateLayout = 'auto'
): number[] {
  const freeDimension = snapshot.freeVariableNames.length
  const baseDimension = snapshot.baseVarNames.length
  if (freeDimension === baseDimension) {
    return [...state]
  }

  const safeNtst = Number.isFinite(ntst) ? Math.max(1, Math.round(ntst)) : 1
  const safeNcol = Number.isFinite(ncol) ? Math.max(1, Math.round(ncol)) : 1
  const implicitPointCount = safeNtst * (safeNcol + 1)
  const explicitPointCount = implicitPointCount + 1
  const candidatePointCounts =
    layout === 'implicit'
      ? [implicitPointCount]
      : layout === 'explicit'
        ? [explicitPointCount]
        : [implicitPointCount, explicitPointCount]
  const matchingPointCounts = candidatePointCounts.filter(
    (pointCount) =>
      state.length === pointCount * freeDimension + 1 ||
      state.length === pointCount * baseDimension + 1
  )
  if (matchingPointCounts.length > 1) {
    throw new Error(
      `${label} layout is ambiguous for the selected frozen-variable subsystem.`
    )
  }
  const matchingPointCount = matchingPointCounts[0]

  if (matchingPointCount && state.length === matchingPointCount * freeDimension + 1) {
    return [...state]
  }
  if (matchingPointCount && state.length === matchingPointCount * baseDimension + 1) {
    const reduced: number[] = []
    for (let pointIndex = 0; pointIndex < matchingPointCount; pointIndex += 1) {
      const offset = pointIndex * baseDimension
      const fullPoint = state.slice(offset, offset + baseDimension)
      reduced.push(...projectStateToReduced(snapshot, fullPoint))
    }
    reduced.push(state[state.length - 1] ?? Number.NaN)
    return reduced
  }

  if (state.length === freeDimension) {
    return [...state]
  }
  if (state.length === baseDimension) {
    return projectStateToReduced(snapshot, state)
  }
  throw new Error(`${label} dimension mismatch for the selected frozen-variable subsystem.`)
}
