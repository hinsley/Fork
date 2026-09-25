import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js'
import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import type { InvariantMeasureObject } from '../../../system/types'
import {
  DEFAULT_EIGENMODE_COUNT,
  eigenmodeInterpretationLabel,
  hasCurrentEigenmodeAnalysis,
  maxSupportedEigenmodeCount,
  spectralGapStatusLabel,
} from '../../../system/invariantMeasureEigenmodes'
import {
  fmt,
  fmtCount,
  fmtEigenvalues,
  fmtPercent,
  fmtRelativeTime,
  fmtSci,
} from '../../../utils/format'
import { computeInvariantMeasureStats, groupEigenmodes } from './invariantMeasureStats'
import { InlineSection, KeyValues } from '../InspectorChrome'

export function InvariantMeasureInspectorSections({
  scope,
}: {
  scope: InspectorSelectionController
}) {
  const { invariantMeasure, system } = scope

  if (!invariantMeasure) return null

  const result = invariantMeasure.result
  const stats = computeInvariantMeasureStats(invariantMeasure, system)
  const startingPoint = result.settings.startingPoint
  const transition =
    result.dynamicsType === 'flow'
      ? result.settings.integrationStep !== undefined
        ? `fixed-time sampled flow map, t ${fmt(result.settings.timeStep ?? 0)} (dt ≤ ${fmt(result.settings.integrationStep)})`
        : `legacy single-step flow map, t ${fmt(result.settings.timeStep ?? 0)}`
      : `${result.settings.iterations} map iteration${result.settings.iterations === 1 ? '' : 's'}`

  return (
    <InvariantMeasureEigenmodeAnalysis
      scope={scope}
      invariantMeasure={invariantMeasure}
    >
      <InlineSection title="Data" testId="invariant-measure-data-section">
        {!stats.massPreserving ? (
          <p className="inspector-error" data-testid="invariant-measure-leakage-warning">
            Not mass-preserving: λ₀ = {fmt(stats.dominantEigenvalue)}, retained{' '}
            {fmtPercent(result.retainedMass)}.
          </p>
        ) : null}
        {!stats.sourceExists ? (
          <p className="inspector-error">Source State Grid deleted.</p>
        ) : null}
        {result.axes.length > 3 ? (
          <p className="inspector-error">More than 3 active axes — not shown in Scenes.</p>
        ) : null}
        {!stats.snapshotCompatible ? (
          <p className="inspector-error">Subsystem snapshot mismatch — not shown in Scenes.</p>
        ) : null}
        <KeyValues
          rows={[
            {
              label: 'Source',
              value: stats.sourceName,
              testId: 'invariant-measure-source',
            },
            {
              label: 'Solve',
              value: stats.stationaryConverged
                ? 'Converged'
                : stats.totalModeMass > 0
                  ? 'Iteration limit reached'
                  : 'No surviving mode',
              testId: 'invariant-measure-convergence-status',
            },
            {
              label: 'Iterations',
              value: fmtCount(result.stationaryIterations),
              title: 'Stationary iterations',
            },
            result.coverGrowthIterations !== undefined
              ? { label: 'Cover passes', value: fmtCount(result.coverGrowthIterations) }
              : null,
            { label: 'Peak mass', value: fmtPercent(stats.peakCellMass), title: 'Peak cell mass' },
            {
              label: 'Excluded',
              value: fmtCount(result.zeroSurvivorSources),
              title: 'Excluded source cells',
            },
            ...result.axes.map((axis) => ({
              label: axis.variableName,
              value: `[${fmt(axis.min)}, ${fmt(axis.max)}] × ${fmtCount(axis.resolution)}`,
            })),
            {
              label: 'Samples',
              value: `${fmtCount(result.settings.samplesPerCell)} / cell`,
            },
            { label: 'Transition', value: transition, title: transition },
            { label: 'Tolerance', value: fmtSci(result.settings.tolerance) },
            startingPoint
              ? {
                  label: 'Start',
                  value: `[${result.axes
                    .map((axis) => startingPoint[axis.variableName])
                    .join(', ')}]`,
                  title: 'Initial cover cell contains this point',
                }
              : null,
            {
              label: 'Computed',
              value: <span title={result.computedAt}>{fmtRelativeTime(result.computedAt)}</span>,
            },
          ]}
        />
      </InlineSection>
    </InvariantMeasureEigenmodeAnalysis>
  )
}

function InvariantMeasureEigenmodeAnalysis({
  scope,
  invariantMeasure,
  children,
}: {
  scope: InspectorSelectionController
  invariantMeasure: InvariantMeasureObject
  children: ReactNode
}) {
  const {
    InspectorDisclosure,
    invariantEigenmodeUnavailableReason,
    PlotlyViewport,
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
  const grouped = useMemo(
    () => (analysis ? groupEigenmodes(analysis.modes) : { rows: [], eigenvalueCount: 0 }),
    [analysis]
  )
  const selectedRank = invariantMeasure.eigenmodeView?.modeRank
  const selectedRow =
    grouped.rows.find((row) => selectedRank != null && row.ranks.includes(selectedRank)) ?? null
  const selectedMode = selectedRow?.mode ?? null

  const spectrum = useMemo(() => {
    if (!analysis || grouped.rows.length === 0) return null
    const x: number[] = []
    const y: number[] = []
    const labels: string[] = []
    const ranks: number[] = []
    const colors: string[] = []
    for (const row of grouped.rows) {
      const { mode } = row
      const color = mode.rank === selectedMode?.rank ? '#f59e0b' : '#3b82f6'
      x.push(mode.eigenvalueRe)
      y.push(row.complex ? mode.eigenvalueIm : 0)
      labels.push(`Mode ${row.index}`)
      ranks.push(mode.rank)
      colors.push(color)
      if (row.complex) {
        x.push(mode.eigenvalueRe)
        y.push(-mode.eigenvalueIm)
        labels.push(`Mode ${row.index} conjugate`)
        ranks.push(mode.rank)
        colors.push(color)
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
  }, [analysis, grouped.rows, plotlyTheme, result.dominantEigenvalue, selectedMode?.rank])

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
    <>
    <InspectorDisclosure
      key={`${selectionKey}-invariant-measure-eigenmodes`}
      title="Compute eigenmodes"
      testId="invariant-measure-eigenmodes-toggle"
      actionOnly
    >
      <div className="inspector-section">
        <label title="Complex conjugate pairs stay together">
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
          <p className="field-warning" data-testid="invariant-eigenmode-deep-warning">
            Deep request — max {fmtCount(maxSupported)} modes for this cover.
          </p>
        ) : null}
        {invariantEigenmodeUnavailableReason ? (
          <p className="inspector-error">{invariantEigenmodeUnavailableReason}</p>
        ) : null}
        {error ? <p className="inspector-error">{error}</p> : null}
        <button
          type="button"
          className="inspector-primary-action"
          onClick={() => void runAnalysis()}
          disabled={running || Boolean(invariantEigenmodeUnavailableReason) || !requestValid}
          data-testid="invariant-eigenmode-compute"
        >
          {running ? 'Computing…' : 'Compute'}
        </button>
      </div>
    </InspectorDisclosure>
    {children}
    {storedAnalysis && !analysis ? (
      <p className="inspector-error">Cached modes refer to an older operator snapshot.</p>
    ) : null}
    {analysis ? (
      <InlineSection title="Eigenmodes" testId="invariant-measure-eigenmodes">
        <KeyValues
          rows={[
            {
              label: 'Computed',
              value:
                grouped.eigenvalueCount === grouped.rows.length
                  ? `${grouped.rows.length} modes`
                  : `${grouped.rows.length} modes · ${grouped.eigenvalueCount} eigenvalues`,
              title: 'Conjugate pairs count as one mode',
              testId: 'invariant-eigenmode-subset',
            },
            analysis.spectralGapStatus !== 'available'
              ? {
                  label: 'Gap',
                  value: spectralGapStatusLabel(analysis.spectralGapStatus),
                  title: 'Spectral gap 1 − |λ₂|',
                }
              : null,
          ]}
        />
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
        <div className="inspector-table-scroll">
        <table className="data-table invariant-eigenmodes__table">
          <thead>
            <tr>
              <th>#</th>
              <th>λ</th>
              <th>|λ|</th>
            </tr>
          </thead>
          <tbody>
            {grouped.rows.map(({ mode, index, complex }) => (
              <tr
                key={mode.rank}
                role="button"
                tabIndex={0}
                className={mode.rank === selectedMode?.rank ? 'is-selected' : undefined}
                onClick={() => updateView({ modeRank: mode.rank })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    updateView({ modeRank: mode.rank })
                  }
                }}
                title={`${eigenmodeInterpretationLabel(mode.interpretation)} · residual ${fmtSci(
                  mode.ritzResidual
                )}${mode.converged ? '' : ' · not converged'}`}
                data-testid={`invariant-eigenmode-${mode.rank}`}
              >
                <td className={mode.converged ? undefined : 'faint'}>{index}</td>
                <td>
                  {complex
                    ? fmtEigenvalues(
                        [
                          { re: mode.eigenvalueRe, im: mode.eigenvalueIm },
                          { re: mode.eigenvalueRe, im: -mode.eigenvalueIm },
                        ],
                        { digits: 4 }
                      )[0]
                    : fmt(mode.eigenvalueRe, { digits: 4 })}
                </td>
                <td>{fmt(mode.modulus, { digits: 4 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {selectedMode ? (
          <div className="invariant-eigenmodes__view" data-testid="invariant-eigenmode-view-controls">
            <div className="section-head">
              <span
                title="Signed right eigenvector (density relaxation), not a probability density. Opacity shows magnitude."
              >
                Overlay · mode {selectedRow?.index ?? selectedMode.rank}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => updateView({ modeRank: null })}
                data-testid="invariant-eigenmode-hide"
              >
                Hide
              </button>
            </div>
            {selectedRow?.complex ? (
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
          </div>
        ) : null}
      </InlineSection>
    ) : null}
    </>
  )
}
