import { isSubsystemSnapshotCompatible } from '../../../system/subsystemGateway'
import type { InvariantMeasureObject, System } from '../../../system/types'
import { hasCurrentEigenmodeAnalysis } from '../../../system/invariantMeasureEigenmodes'

export function computeInvariantMeasureStats(
  invariantMeasure: InvariantMeasureObject,
  system: System
) {
  const result = invariantMeasure.result
  const source = system.objects[invariantMeasure.sourceStateGridId]
  const sourceIndex = system.index.objects[invariantMeasure.sourceStateGridId]
  const sourceExists =
    source?.type === 'state_grid' ||
    (!source && sourceIndex?.objectType === 'state_grid')
  const sourceName =
    source?.type === 'state_grid'
      ? source.name
      : !source && sourceIndex?.objectType === 'state_grid'
        ? sourceIndex.name
        : invariantMeasure.sourceStateGridName
  const occupiedCells = result.stationaryDistribution.filter((mass) => mass > 0).length
  const ambientBoxCount = result.ambientBoxCount ?? result.axes.reduce(
    (total, axis) => total * axis.resolution,
    1
  )
  const dominantEigenvalue = result.dominantEigenvalue ?? 1
  const massPreserving = Math.abs(dominantEigenvalue - 1) <= 1e-8
  const totalModeMass = result.stationaryDistribution.reduce((sum, mass) => sum + mass, 0)
  const squaredModeMass = result.stationaryDistribution.reduce(
    (sum, mass) => sum + mass * mass,
    0
  )
  const participationSupport = squaredModeMass > 0 ? 1 / squaredModeMass : 0
  const peakCellMass = result.stationaryDistribution.reduce(
    (peak, mass) => Math.max(peak, mass),
    0
  )
  const stationaryConverged =
    totalModeMass > 0 && result.residual <= result.settings.tolerance
  const snapshotCompatible =
    !result.subsystemSnapshot ||
    isSubsystemSnapshotCompatible(system.config, result.subsystemSnapshot)
  const storedAnalysis = invariantMeasure.eigenmodeAnalysis
  const currentAnalysis =
    storedAnalysis && hasCurrentEigenmodeAnalysis(result, storedAnalysis.sourceComputedAt)
      ? storedAnalysis
      : null
  return {
    sourceExists,
    sourceName,
    occupiedCells,
    ambientBoxCount,
    dominantEigenvalue,
    massPreserving,
    totalModeMass,
    participationSupport,
    peakCellMass,
    stationaryConverged,
    snapshotCompatible,
    currentAnalysis,
  }
}

