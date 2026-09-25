import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { InspectorSelectionController } from '../../../InspectorDetailsPanel'
import { BranchNavigatorContent } from '../../../BranchNavigator'
import { Icon } from '../../../Icon'
import { bifurcationCode, bifurcationTone } from '../../../../system/stability'
import { extractHopfOmega } from '../../../../system/continuation'
import { fmt } from '../../../../utils/format'
import { BranchPointDiagnostics } from './BranchPointDiagnostics'
import {
  bifurcationLabel,
  branchParamNames,
  branchSpectrumKind,
  branchStabilityModel,
  buildEigenRows,
  formatPointTsv,
  pointStability,
  resolvePointParam2,
  resolvePointTag,
} from './branchInsights'

function Kv({ rows }: { rows: Array<{ label: string; value: ReactNode; title?: string }> }) {
  if (rows.length === 0) return null
  return (
    <dl className="branch-kv">
      {rows.map((row, index) => (
        <div className="branch-kv__pair" key={`${row.label}-${index}`}>
          <dt title={row.title ?? row.label}>{row.label}</dt>
          <dd title={typeof row.value === 'string' ? row.value : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Magnitude below which values print as 0 (floating-point noise). */
function noiseFloor(values: number[]): number {
  const scale = values.reduce(
    (max, value) => (Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max),
    1
  )
  return 1e-12 * scale
}

// Bifurcation-specific next steps first, generic continuation last.
const POINT_ACTION_ORDER = [
  'limit-cycle-from-hopf-toggle',
  'limit-cycle-from-pd-toggle',
  'codim1-curve-toggle',
  'limit-cycle-codim1-curve-toggle',
  'codim2-branch-switch-toggle',
  'branch-continue-toggle',
]

function orderPointActions<T extends { id: string }>(entries: T[]): T[] {
  const rank = (id: string) => {
    const index = POINT_ACTION_ORDER.indexOf(id)
    return index < 0 ? POINT_ACTION_ORDER.length : index
  }
  return [...entries].sort((left, right) => rank(left.id) - rank(right.id))
}

/** Selected-point panel: stepper, key values, spectrum, point actions, and More. */
export function BranchPointPanel({ scope }: { scope: InspectorSelectionController }) {
  const {
    PlotlyViewport,
    branch,
    branchCyclePoints,
    branchEigenPlot,
    branchEigenvalues,
    branchIndices,
    branchMultiplierPlot,
    branchPointActions,
    branchPointError,
    branchPointIndex,
    branchPointInput,
    branchPointRevealToken,
    branchSortedIndex,
    branchSortedOrder,
    branchStateDimension,
    formatFixed,
    formatPointValues,
    frozenVariableHeaderNames,
    handleJumpToBranchPoint,
    isBranchRenderTarget,
    limitCyclePointMetrics,
    onSetLimitCycleRenderTarget,
    periodicOrbitParentId,
    selectedBranchPoint,
    selectedBranchPointParams,
    selectedBranchPointState,
    selectedNodeId,
    setBranchPoint,
    setBranchPointInput,
    systemDraft,
    workflowFocus,
    writeClipboardText,
  } = scope
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (branchPointRevealToken === 0) return
    const panel = panelRef.current
    if (!panel) return
    panel.scrollIntoView?.({ block: 'nearest' })
    panel.classList.remove('is-flash')
    // Force a reflow so the flash animation restarts on every reveal.
    void panel.offsetWidth
    panel.classList.add('is-flash')
  }, [branchPointRevealToken])

  const systemType = systemDraft.type === 'map' ? 'map' : 'flow'
  const spectrumKind = branchSpectrumKind(branch?.branchType, systemType)
  // Curves sit on a bifurcation by construction; tinting their critical
  // eigenvalues as "unstable" would only show solver noise.
  const tintUnstable = branchStabilityModel(branch?.branchType) !== null
  const eigenRows = useMemo(
    () => buildEigenRows(branchEigenvalues, spectrumKind, tintUnstable),
    [branchEigenvalues, spectrumKind, tintUnstable]
  )

  if (!branch || branch.data.points.length === 0) return null

  const point = selectedBranchPoint ?? null
  const model = branchStabilityModel(branch.branchType)
  const stability = pointStability(point, model, systemType)
  const tag = resolvePointTag(point)
  const code = bifurcationCode(tag, systemType)
  const tagLabel = bifurcationLabel(tag, code)
  const names = branchParamNames(branch)
  const isCycle = spectrumKind === 'cycle' && model === 'cycle'
  const eigenSymbol = spectrumKind === 'cycle' || branch.branchType === 'forced_periodic_response'
    ? 'μ'
    : 'λ'

  const logicalValues = branchSortedOrder.map((arrayIndex) => branchIndices[arrayIndex])
  const indexRange =
    logicalValues.length > 1
      ? `${fmt(logicalValues[0])}…${fmt(logicalValues[logicalValues.length - 1])}`
      : undefined

  const param2 = point ? resolvePointParam2(branch, point, branchStateDimension) : null
  const paramRows: Array<{ label: string; value: string }> = []
  if (point && Number.isFinite(point.param_value)) {
    paramRows.push({ label: names.param1 || 'p', value: fmt(point.param_value) })
  }
  if (names.param2 && param2 !== null) {
    paramRows.push({ label: names.param2, value: fmt(param2) })
  }

  const period =
    limitCyclePointMetrics?.metrics.period ??
    (isCycle && point ? point.state[point.state.length - 1] : undefined)
  const stateFloor = noiseFloor(selectedBranchPointState)
  const stateRows: Array<{ label: string; value: string }> = isCycle
    ? typeof period === 'number' && Number.isFinite(period)
      ? [{ label: 'T', value: fmt(period) }]
      : []
    : frozenVariableHeaderNames
        .map((name, index) => ({
          label: name,
          value: selectedBranchPointState[index],
        }))
        .filter((row) => typeof row.value === 'number')
        .map((row) => ({ label: row.label, value: fmt(row.value, { zeroBelow: stateFloor }) }))
  if (
    point &&
    systemType === 'flow' &&
    (branch.branchType === 'hopf_curve' ||
      (branch.branchType === 'equilibrium' && tag === 'Hopf'))
  ) {
    stateRows.push({ label: 'ω', value: fmt(extractHopfOmega(point)) })
  }
  if (branch.branchType === 'forced_periodic_response' && point?.forcing_period) {
    stateRows.push({ label: 'T', value: fmt(point.forcing_period) })
  }
  if (systemType === 'map' && (branch.mapIterations ?? 1) > 1) {
    stateRows.push({ label: 'k', value: String(branch.mapIterations) })
  }

  const eigenFloor = noiseFloor(eigenRows.map((row) => row.modulus))
  const showModulus = spectrumKind !== 'flow'
  const showArg = spectrumKind === 'map'

  const renderTargetAction =
    branchPointIndex !== null &&
    selectedNodeId &&
    periodicOrbitParentId &&
    onSetLimitCycleRenderTarget &&
    !isBranchRenderTarget
      ? () =>
          onSetLimitCycleRenderTarget(periodicOrbitParentId, {
            type: 'branch',
            branchId: selectedNodeId,
            pointIndex: branchPointIndex,
          })
      : null

  const copyPoint = () => {
    if (!point || branchPointIndex === null) return
    const params = systemDraft.paramNames.map(
      (name, index) =>
        [name || `p${index + 1}`, selectedBranchPointParams[index] ?? Number.NaN] as [
          string,
          number,
        ]
    )
    const state = isCycle
      ? []
      : frozenVariableHeaderNames.map(
          (name, index) =>
            [name, selectedBranchPointState[index] ?? Number.NaN] as [string, number]
        )
    const extras: Array<[string, number | string]> = []
    if (isCycle && typeof period === 'number') extras.push(['period', period])
    if (isCycle && point.state.length > 0) extras.push(['state', point.state.join('\t')])
    void writeClipboardText(
      formatPointTsv({
        index: branchIndices[branchPointIndex] ?? branchPointIndex,
        params,
        state,
        extras,
        eigenvalues: branchEigenvalues,
        eigenLabel: eigenSymbol,
      })
    )
  }

  const eigenPlot = branchMultiplierPlot ?? branchEigenPlot
  const shownParams = new Set(paramRows.map((row) => row.label))
  const otherParamRows = systemDraft.paramNames
    .map((name, index) => ({
      label: name || `p${index + 1}`,
      value: fmt(selectedBranchPointParams[index]),
    }))
    .filter((row) => !shownParams.has(row.label))

  return (
    <section
      className="branch-point"
      data-testid="branch-point-panel"
      ref={(node) => {
        panelRef.current = node
      }}
      onAnimationEnd={(event) => event.currentTarget.classList.remove('is-flash')}
    >
      <BranchNavigatorContent
        branchSortedOrder={branchSortedOrder}
        branchSortedIndex={branchSortedIndex}
        branchPointIndex={branchPointIndex}
        branchPointInput={branchPointInput}
        branchPointError={branchPointError}
        indexRange={indexRange}
        onPointSelect={setBranchPoint}
        onPointInputChange={setBranchPointInput}
        onJumpToPoint={handleJumpToBranchPoint}
        trailing={
          point ? (
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={copyPoint}
              title="Copy point as TSV (full precision)"
              aria-label="Copy point"
              data-testid="branch-point-copy"
            >
              <Icon name="copy" size={14} />
            </button>
          ) : null
        }
      >
        {code ? (
          <span
            className="branch-point__bif"
            title={tagLabel}
            data-tag={tag ?? undefined}
            data-testid="branch-point-bif-chip"
          >
            <span className={`bif bif--${bifurcationTone(code)}`}>{code}</span>
            <span className="branch-point__bif-label">{tagLabel}</span>
          </span>
        ) : null}
        {stability ? (
          <span
            className={`chip chip--${stability.kind}`}
            data-testid="branch-point-stability"
          >
            {stability.label}
          </span>
        ) : null}
      </BranchNavigatorContent>

      {point ? (
        <>
          {paramRows.length + stateRows.length > 0 ? (
            <div className="branch-point__values">
              <Kv rows={paramRows} />
              <Kv rows={stateRows} />
            </div>
          ) : null}

          {eigenRows.length > 0 ? (
            <div className="branch-eig-table">
              <table className="data-table" data-testid="branch-point-eigenvalues">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">{eigenSymbol}</span>
                    </th>
                    <th scope="col">Re</th>
                    <th scope="col">Im</th>
                    {showModulus ? <th scope="col">|{eigenSymbol}|</th> : null}
                    {showArg ? <th scope="col">arg</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {eigenRows.map((row, position) => (
                    <tr
                      key={`eig-${row.index}`}
                      className={`${row.unstable ? 'is-unstable' : ''}${row.trivial ? ' is-trivial' : ''}`}
                      title={row.trivial ? 'Trivial multiplier' : undefined}
                    >
                      <td>
                        {eigenSymbol}
                        <sub>{position + 1}</sub>
                      </td>
                      <td>{fmt(row.re, { zeroBelow: eigenFloor })}</td>
                      <td>{fmt(row.im, { zeroBelow: eigenFloor })}</td>
                      {showModulus ? <td>{fmt(row.modulus, { zeroBelow: eigenFloor })}</td> : null}
                      {showArg ? (
                        <td>{row.modulus < eigenFloor ? '—' : fmt(row.arg, { digits: 4 })}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {branchPointActions.length > 0 || renderTargetAction ? (
          <div className="branch-point__actions">
            <div className="action-bar">
              {orderPointActions(branchPointActions).map((entry) => (
                <button
                  type="button"
                  className="btn"
                  key={entry.id}
                  onClick={() => workflowFocus?.openWorkflow(entry.id)}
                  disabled={entry.disabled}
                  title={entry.description}
                  data-testid={`action-${entry.id}`}
                >
                  {entry.label}
                </button>
              ))}
              {renderTargetAction ? (
                <button
                  type="button"
                  className="btn"
                  onClick={renderTargetAction}
                  title="Render this point on the parent object"
                  data-testid="branch-point-render-lc"
                >
                  {branch.branchType === 'forced_periodic_response'
                    ? 'Show response'
                    : 'Show cycle'}
                </button>
              ) : null}
            </div>
          </div>
          ) : null}

          <details className="branch-more">
            <summary data-testid="branch-point-details-toggle">More</summary>
            <div className="branch-more__content">
              {otherParamRows.length > 0 ? (
                <div className="branch-more__block">
                  <h4 className="section-head">Parameters</h4>
                  <Kv rows={otherParamRows} />
                </div>
              ) : null}
              {isCycle && limitCyclePointMetrics ? (
                <div className="branch-more__block" data-testid="branch-point-cycle-metrics">
                  <h4 className="section-head">Cycle</h4>
                  <div className="branch-table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="sr-only">Variable</span>
                          </th>
                          <th scope="col">min</th>
                          <th scope="col">max</th>
                          <th scope="col">mean</th>
                          <th scope="col">rms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {limitCyclePointMetrics.metrics.ranges.map((range, index) => {
                          const floor = noiseFloor([range.min, range.max])
                          return (
                            <tr key={`cycle-metric-${index}`}>
                              <td>{frozenVariableHeaderNames[index] || `x${index + 1}`}</td>
                              <td>{fmt(range.min, { digits: 4, zeroBelow: floor })}</td>
                              <td>{fmt(range.max, { digits: 4, zeroBelow: floor })}</td>
                              <td>
                                {fmt(limitCyclePointMetrics.metrics.means[index], {
                                  digits: 4,
                                  zeroBelow: floor,
                                })}
                              </td>
                              <td>
                                {fmt(limitCyclePointMetrics.metrics.rmsAmplitudes[index], {
                                  digits: 4,
                                  zeroBelow: floor,
                                })}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              {branchCyclePoints && branchCyclePoints.length > 0 ? (
                <div className="branch-more__block">
                  <h4 className="section-head">
                    Cycle points
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm"
                      title="Copy cycle points"
                      aria-label="Copy cycle points"
                      onClick={() =>
                        void writeClipboardText(
                          branchCyclePoints.map((row) => formatPointValues(row)).join('\n')
                        )
                      }
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  </h4>
                  <div
                    className="orbit-preview__table branch-table-scroll"
                    role="region"
                    aria-label="Cycle point data"
                  >
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          {frozenVariableHeaderNames.map((name, index) => (
                            <th key={`branch-cycle-col-${index}`}>{name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {branchCyclePoints.map((row, rowIndex) => (
                          <tr key={`branch-cycle-row-${rowIndex}`}>
                            <td>{rowIndex}</td>
                            {frozenVariableHeaderNames.map((_, varIndex) => (
                              <td key={`branch-cycle-cell-${rowIndex}-${varIndex}`}>
                                {formatFixed(row[varIndex] ?? Number.NaN, 4)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              <div className="branch-more__block branch-more__diagnostics">
                <BranchPointDiagnostics scope={scope} />
              </div>
              {eigenPlot ? (
                <div className="branch-more__block inspector-plot branch-eig-plot">
                  <PlotlyViewport
                    plotId={branchMultiplierPlot ? 'branch-multiplier-plot' : 'branch-eigenvalue-plot'}
                    data={eigenPlot.data}
                    layout={eigenPlot.layout}
                    testId="branch-eigenvalue-plot"
                  />
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </section>
  )
}
