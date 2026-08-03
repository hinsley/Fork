import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import { isSubsystemSnapshotCompatible } from '../../../system/subsystemGateway'
import type { InvariantMeasureObject } from '../../../system/types'
import {
  DEFAULT_EIGENMODE_COUNT,
  eigenmodeInterpretationLabel,
  hasCurrentEigenmodeAnalysis,
  maxSupportedEigenmodeCount,
  spectralGapStatusLabel,
} from '../../../system/invariantMeasureEigenmodes'

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
  const ambientBoxCount = result.ambientBoxCount ?? result.axes.reduce(
    (total, axis) => total * axis.resolution,
    1
  )
  const resolution = result.axes.map((axis) => axis.resolution).join(' × ')
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
            <span className="inspector-metrics__label">Reachable cover</span>
            <span className="inspector-metrics__value" data-testid="invariant-measure-cover-size">
              {result.totalBoxes.toLocaleString()} / {ambientBoxCount.toLocaleString()}
            </span>
          </div>
          {result.coverGrowthIterations !== undefined ? (
            <div className="inspector-metrics__row">
              <span className="inspector-metrics__label">Cover growth passes</span>
              <span className="inspector-metrics__value">
                {result.coverGrowthIterations.toLocaleString()}
              </span>
            </div>
          ) : null}
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Retained sample mass</span>
            <span className="inspector-metrics__value">
              {(100 * result.retainedMass).toPrecision(6)}%
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Participation support</span>
            <span
              className="inspector-metrics__value"
              data-testid="invariant-measure-effective-support"
            >
              {participationSupport.toLocaleString(undefined, { maximumFractionDigits: 3 })} cells
            </span>
          </div>
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Peak cell mass</span>
            <span className="inspector-metrics__value">
              {(100 * peakCellMass).toPrecision(6)}%
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
          <div className="inspector-metrics__row">
            <span className="inspector-metrics__label">Stationary solve</span>
            <span
              className="inspector-metrics__value"
              data-testid="invariant-measure-convergence-status"
            >
              {stationaryConverged
                ? 'Converged'
                : totalModeMass > 0
                  ? 'Iteration limit reached'
                  : 'No surviving mode'}
            </span>
          </div>
        </div>

        <InvariantMeasureEigenmodeAnalysis
          scope={scope}
          invariantMeasure={invariantMeasure}
          stationaryConverged={stationaryConverged}
        />

        <h4 className="inspector-subheading">Grid snapshot</h4>
        <p className="inspector-help">
          {result.axes.map((axis) => `${axis.variableName} ∈ [${axis.min}, ${axis.max}]`).join('; ')}
          {resolution ? ` · resolution ${resolution}` : ''}
        </p>
        <p className="inspector-help">
          {result.settings.samplesPerCell} deterministic samples per cell,{' '}
          {result.dynamicsType === 'flow'
            ? result.settings.integrationStep !== undefined
              ? `${result.settings.timeStep ?? 0} flow-map time per transition with integration steps no larger than ${result.settings.integrationStep}`
              : `${result.settings.timeStep ?? 0} legacy single-step flow transition`
            : `${result.settings.iterations} map iteration${result.settings.iterations === 1 ? '' : 's'} per transition`}, tolerance{' '}
          {formatScientific(result.settings.tolerance)}. Computed {result.computedAt}.
        </p>
        {result.settings.startingPoint ? (
          <p className="inspector-help">
            Starting point: [{result.axes.map((axis) =>
              result.settings.startingPoint?.[axis.variableName]
            ).join(', ')}]. Its containing ambient cell was the only initial cover cell.
          </p>
        ) : null}
        {result.dynamicsType === 'flow' ? (
          <p className="inspector-help">
            This result uses the fixed-time sampled flow map for the autonomous system; it is not a
            Poincaré return-map measure.
          </p>
        ) : null}
        <p className="inspector-help">
          Marker opacity encodes positive mode mass linearly. Zero-mass cells are omitted.
          The stored result is a snapshot and does not change when its source grid is edited.
        </p>
        <p className="inspector-help">
          Participation support is 1 / Σp². It is the number of equally weighted cells that would
          have the same concentration as this normalized mode.
        </p>
        {massPreserving ? (
          <p className="inspector-help">
            The leading eigenvalue is approximately one, so this result is mass-preserving on the
            grown cover.
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

function InvariantMeasureEigenmodeAnalysis({
  scope,
  invariantMeasure,
  stationaryConverged,
}: {
  scope: InspectorSelectionController
  invariantMeasure: InvariantMeasureObject
  stationaryConverged: boolean
}) {
  const {
    PlotlyViewport,
    formatComplexValue,
    formatScientific,
    onComputeInvariantMeasureEigenmodes,
    onUpdateInvariantMeasureObject,
    plotlyTheme,
    selectedNodeId,
    selectionKey,
  } = scope
  const result = invariantMeasure.result
  const storedAnalysis = invariantMeasure.eigenmodeAnalysis
  const analysis =
    storedAnalysis &&
    hasCurrentEigenmodeAnalysis(result, storedAnalysis.sourceComputedAt)
      ? storedAnalysis
      : null
  const maxSupported = maxSupportedEigenmodeCount(
    result.stationaryDistribution.length
  )
  const initialCount = analysis?.requestedModes ?? DEFAULT_EIGENMODE_COUNT
  const [modeCount, setModeCount] = useState(initialCount)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const nextCount = analysis?.requestedModes ?? DEFAULT_EIGENMODE_COUNT
    setModeCount(nextCount)
    setError(null)
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [analysis?.requestedModes, selectionKey])

  const requestedCount = Math.trunc(modeCount)
  const requestValid =
    requestedCount >= 1 && requestedCount <= maxSupported
  const selectedMode = analysis?.modes.find(
    (mode) => mode.rank === invariantMeasure.eigenmodeView?.modeRank
  ) ?? null

  const spectrum = useMemo(() => {
    if (!analysis || analysis.modes.length === 0) return null
    const x: number[] = []
    const y: number[] = []
    const labels: string[] = []
    const ranks: number[] = []
    const colors: string[] = []
    for (const mode of analysis.modes) {
      x.push(mode.eigenvalueRe)
      y.push(mode.eigenvalueIm)
      labels.push(`Mode ${mode.rank}`)
      ranks.push(mode.rank)
      colors.push(mode.rank === selectedMode?.rank ? '#f59e0b' : '#3b82f6')
      if (mode.conjugatePair && Math.abs(mode.eigenvalueIm) > 0) {
        x.push(mode.eigenvalueRe)
        y.push(-mode.eigenvalueIm)
        labels.push(`Mode ${mode.rank} conjugate`)
        ranks.push(mode.rank)
        colors.push(mode.rank === selectedMode?.rank ? '#f59e0b' : '#3b82f6')
      }
    }
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'markers',
        name: 'Stationary mode',
        x: [result.dominantEigenvalue ?? 1],
        y: [0],
        marker: { color: '#22c55e', size: 10, symbol: 'diamond' },
        hovertemplate: 'Stationary mode<br>λ=%{x:.6g}<extra></extra>',
      },
      {
        type: 'scatter',
        mode: 'markers',
        name: 'Nontrivial modes',
        uid: 'invariant-measure-eigenmodes',
        x,
        y,
        text: labels,
        customdata: ranks,
        marker: { color: colors, size: 9 },
        hovertemplate: '%{text}<br>λ=%{x:.6g}%{y:+.6g}i<extra></extra>',
      },
    ]
    const layout: Partial<Layout> = {
      autosize: true,
      height: 220,
      margin: { l: 42, r: 14, t: 16, b: 38 },
      paper_bgcolor: plotlyTheme.background,
      plot_bgcolor: plotlyTheme.background,
      font: { color: plotlyTheme.text, size: 11 },
      showlegend: false,
      xaxis: {
        title: { text: 'Re λ' },
        zerolinecolor: plotlyTheme.muted,
        gridcolor: `${plotlyTheme.muted}33`,
      },
      yaxis: {
        title: { text: 'Im λ' },
        scaleanchor: 'x',
        scaleratio: 1,
        zerolinecolor: plotlyTheme.muted,
        gridcolor: `${plotlyTheme.muted}33`,
      },
      shapes: [
        {
          type: 'circle',
          xref: 'x',
          yref: 'y',
          x0: -1,
          x1: 1,
          y0: -1,
          y1: 1,
          line: { color: `${plotlyTheme.muted}88`, width: 1, dash: 'dot' },
        },
      ],
    }
    return { data, layout }
  }, [analysis, plotlyTheme, result.dominantEigenvalue, selectedMode?.rank])

  const updateView = (
    update: Partial<NonNullable<InvariantMeasureObject['eigenmodeView']>>
  ) => {
    if (!selectedNodeId) return
    onUpdateInvariantMeasureObject(selectedNodeId, {
      eigenmodeView: {
        modeRank: invariantMeasure.eigenmodeView?.modeRank ?? null,
        component: invariantMeasure.eigenmodeView?.component ?? 'real',
        phase: invariantMeasure.eigenmodeView?.phase ?? 0,
        ...update,
      },
    })
  }

  const runAnalysis = async () => {
    if (!selectedNodeId || !requestValid) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    setError(null)
    try {
      await onComputeInvariantMeasureEigenmodes(
        { invariantMeasureId: selectedNodeId, requestedModes: requestedCount },
        { signal: controller.signal }
      )
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setRunning(false)
    }
  }

  return (
    <section
      className="invariant-eigenmodes"
      data-testid="invariant-measure-eigenmodes"
    >
      <h4 className="inspector-subheading">Sparse eigenmodes</h4>
      <p className="inspector-help">
        Enter how many selectable nontrivial modes to compute after the stationary solve. A complex
        conjugate pair is kept together as one oscillatory mode; the stationary mode remains
        separate.
      </p>
      <label>
        Nontrivial modes
        <input
          type="number"
          min={1}
          max={Math.max(1, maxSupported)}
          step={1}
          value={modeCount}
          onChange={(event) => {
            setModeCount(Number(event.target.value))
            setError(null)
          }}
          data-testid="invariant-eigenmode-count"
        />
      </label>
      {requestedCount > 12 ? (
        <p className="inspector-help" data-testid="invariant-eigenmode-deep-warning">
          Deep requests use more sparse products and can persist large mode vectors. Fork caps the
          request at {maxSupported.toLocaleString()} modes for this cover.
        </p>
      ) : null}
      <button
        type="button"
        className="primary"
        onClick={() => void runAnalysis()}
        disabled={running || !stationaryConverged || !requestValid}
        data-testid="invariant-eigenmode-compute"
      >
        {running ? 'Computing modes…' : `Compute ${requestedCount} modes`}
      </button>
      {!stationaryConverged ? (
        <p className="inspector-error">
          Eigenmodes require a converged stationary measure.
        </p>
      ) : null}
      {maxSupported === 0 ? (
        <p className="inspector-error">
          This cover has no nontrivial mode.
        </p>
      ) : null}
      {error ? <p className="inspector-error">{error}</p> : null}
      {storedAnalysis && !analysis ? (
        <p className="inspector-error">
          The cached modes refer to an older transfer-operator snapshot and are not displayed.
        </p>
      ) : null}

      {analysis ? (
        <>
          <div className="inspector-metrics invariant-eigenmodes__summary">
            <div className="inspector-metrics__row">
              <span className="inspector-metrics__label">Stationary mode</span>
              <span className="inspector-metrics__value">
                λ = {formatScientific(result.dominantEigenvalue ?? 1)}
              </span>
            </div>
            <div className="inspector-metrics__row">
              <span className="inspector-metrics__label">Computed subset</span>
              <span className="inspector-metrics__value" data-testid="invariant-eigenmode-subset">
                {analysis.computedModes} modes ({analysis.representedEigenpairs} eigenpairs)
              </span>
            </div>
            <div className="inspector-metrics__row">
              <span className="inspector-metrics__label">Spectral gap</span>
              <span className="inspector-metrics__value" data-testid="invariant-spectral-gap">
                {analysis.spectralGapStatus === 'available' && analysis.spectralGap !== undefined
                  ? formatScientific(analysis.spectralGap)
                  : spectralGapStatusLabel(analysis.spectralGapStatus)}
              </span>
            </div>
          </div>
          <p className="inspector-help">
            Modes are sorted by |λ|. Residuals are ‖Pv − λv‖₂. The gap is 1 − |λ₂| only when the
            stored Markov operator has a simple stationary mode, is irreducible and aperiodic, and
            both required modes converged.
          </p>
          {spectrum ? (
            <div className="inspector-plot">
              <PlotlyViewport
                plotId={`invariant-measure-spectrum-${selectedNodeId}`}
                data={spectrum.data}
                layout={spectrum.layout}
                testId="invariant-measure-spectrum-plot"
                onPointClick={(point) => {
                  const rank = Number(point.customdata)
                  if (Number.isInteger(rank)) updateView({ modeRank: rank })
                }}
              />
            </div>
          ) : null}
          <div className="invariant-eigenmodes__list" role="list">
            {analysis.modes.map((mode) => (
              <button
                key={mode.rank}
                type="button"
                className={mode.rank === selectedMode?.rank ? 'is-selected' : ''}
                onClick={() => updateView({ modeRank: mode.rank })}
                data-testid={`invariant-eigenmode-${mode.rank}`}
              >
                <span>Mode {mode.rank}{mode.conjugatePair ? ' pair' : ''}</span>
                <strong>{formatComplexValue({ re: mode.eigenvalueRe, im: mode.eigenvalueIm })}</strong>
                <span>|λ| {formatScientific(mode.modulus)}</span>
                <span>residual {formatScientific(mode.ritzResidual)}</span>
                <span>{mode.converged ? 'Converged' : 'Not converged'}</span>
                <span>{eigenmodeInterpretationLabel(mode.interpretation)}</span>
              </button>
            ))}
          </div>
          {selectedMode ? (
            <div className="invariant-eigenmodes__view" data-testid="invariant-eigenmode-view-controls">
              <h4 className="inspector-subheading">State-space mode {selectedMode.rank}</h4>
              <p className="inspector-help">
                This right eigenvector describes density relaxation under the column-stochastic
                operator. It is signed and is not a probability density. The overlay uses the same
                marker shape, size, and Appearance color as the invariant measure. Opacity shows
                mode magnitude, and hover values retain sign. Left observable modes are not
                computed in this analysis.
              </p>
              {selectedMode.conjugatePair ? (
                <>
                  <div className="segmented-control" role="group" aria-label="Complex mode component">
                    {(['real', 'imaginary', 'phase'] as const).map((component) => (
                      <button
                        key={component}
                        type="button"
                        className={invariantMeasure.eigenmodeView?.component === component ? 'is-active' : ''}
                        onClick={() => updateView({ component })}
                        data-testid={`invariant-eigenmode-component-${component}`}
                      >
                        {component === 'real' ? 'Real' : component === 'imaginary' ? 'Imaginary' : 'Phase'}
                      </button>
                    ))}
                  </div>
                  {invariantMeasure.eigenmodeView?.component === 'phase' ? (
                    <label>
                      Phase {((invariantMeasure.eigenmodeView?.phase ?? 0) / Math.PI).toFixed(2)}π
                      <input
                        type="range"
                        min={0}
                        max={2 * Math.PI}
                        step={Math.PI / 36}
                        value={invariantMeasure.eigenmodeView?.phase ?? 0}
                        onChange={(event) => updateView({ phase: Number(event.target.value) })}
                        data-testid="invariant-eigenmode-phase"
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                onClick={() => updateView({ modeRank: null })}
                data-testid="invariant-eigenmode-hide"
              >
                Hide mode overlay
              </button>
            </div>
          ) : null}
          <p className="inspector-help">
            Increasing the count reuses this stored sparse operator and saved modes as a warm
            start, but restarts and reorthogonalizes the Arnoldi solve. The Krylov basis is bounded
            to {analysis.maxSubspaceDimension} vectors and is not persisted.
          </p>
        </>
      ) : (
        <p className="empty-state">No sparse eigenmode analysis stored yet.</p>
      )}
    </section>
  )
}
