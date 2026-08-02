import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { isSubsystemSnapshotCompatible } from '../../../system/subsystemGateway'

export function InvariantMeasureInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const {
    InspectorDisclosure,
    formatScientific,
    invariantMeasure,
    selectionKey,
    system,
  } = scope

  if (!invariantMeasure) return null

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
  const resolution = result.axes.map((axis) => axis.resolution).join(' × ')
  const dominantEigenvalue = result.dominantEigenvalue ?? 1
  const massPreserving = Math.abs(dominantEigenvalue - 1) <= 1e-8
  const snapshotCompatible =
    !result.subsystemSnapshot ||
    isSubsystemSnapshotCompatible(system.config, result.subsystemSnapshot)

  return (
    <InspectorDisclosure
      key={`${selectionKey}-invariant-measure-data`}
      title={massPreserving ? 'Invariant measure data' : 'Finite-box mode data'}
      testId="invariant-measure-data-toggle"
      actionOnly
    >
      <div className="inspector-section" data-testid="invariant-measure-data-section">
        <div className="inspector-metrics">
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Source State Grid</span>
            <strong className="inspector-metrics__value" data-testid="invariant-measure-source">
              {sourceName}
            </strong>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Occupied cells</span>
            <strong
              className="inspector-metrics__value"
              data-testid="invariant-measure-occupied-cells"
            >
              {occupiedCells.toLocaleString()} / {result.totalBoxes.toLocaleString()}
            </strong>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Retained sample mass</span>
            <span className="inspector-metrics__value">
              {(100 * result.retainedMass).toPrecision(6)}%
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Excluded source cells</span>
            <span className="inspector-metrics__value">
              {result.zeroSurvivorSources.toLocaleString()}
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Leading eigenvalue</span>
            <span
              className="inspector-metrics__value"
              data-testid="invariant-measure-leading-eigenvalue"
            >
              {formatScientific(dominantEigenvalue)}
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Stationary residual</span>
            <span className="inspector-metrics__value" data-testid="invariant-measure-residual">
              {formatScientific(result.residual)}
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Stationary iterations</span>
            <span className="inspector-metrics__value">
              {result.stationaryIterations.toLocaleString()}
            </span>
          </div>
        </div>

        <h4 className="inspector-subheading">Grid snapshot</h4>
        <p className="inspector-help">
          {result.axes.map((axis) => `${axis.variableName} ∈ [${axis.min}, ${axis.max}]`).join('; ')}
          {resolution ? ` · resolution ${resolution}` : ''}
        </p>
        <p className="inspector-help">
          {result.settings.samplesPerCell} deterministic samples per cell,{' '}
          {result.dynamicsType === 'flow'
            ? `${result.settings.timeStep ?? 0} flow time-step per transition`
            : `${result.settings.iterations} map iteration${result.settings.iterations === 1 ? '' : 's'} per transition`}, tolerance{' '}
          {formatScientific(result.settings.tolerance)}. Computed {result.computedAt}.
        </p>
        {result.dynamicsType === 'flow' ? (
          <p className="inspector-help">
            This result uses the fixed-time sampled flow map for the autonomous system; it is not a
            Poincaré return-map measure.
          </p>
        ) : null}
        <p className="inspector-help">
          Marker opacity encodes positive mode mass logarithmically. Zero-mass cells are omitted.
          The stored result is a snapshot and does not change when its source grid is edited.
        </p>
        {massPreserving ? (
          <p className="inspector-help">
            The leading eigenvalue is approximately one, so this result is mass-preserving on the
            retained grid.
          </p>
        ) : (
          <p className="inspector-error" data-testid="invariant-measure-leakage-warning">
            This finite-box mode is not mass-preserving: its leading eigenvalue is{' '}
            {formatScientific(dominantEigenvalue)}. Retained sample mass is{' '}
            {(100 * result.retainedMass).toPrecision(6)}%.
          </p>
        )}
        {!sourceExists ? (
          <p className="inspector-error">
            The source State Grid is no longer available. This stored measure remains renderable.
          </p>
        ) : null}
        {result.axes.length > 3 ? (
          <p className="inspector-error">
            Measures with more than three active grid axes are stored but not projected into a
            Scene.
          </p>
        ) : null}
        {!snapshotCompatible ? (
          <p className="inspector-error">
            The stored subsystem snapshot no longer matches this system, so Fork does not render
            this measure in a Scene.
          </p>
        ) : null}
      </div>
    </InspectorDisclosure>
  )
}
