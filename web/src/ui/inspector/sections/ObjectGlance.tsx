import type { ReactNode } from 'react'
import type { InspectorSelectionController } from '../../InspectorDetailsPanel'
import type { ComplexValue } from '../../../system/types'
import { classifyEquilibrium } from '../../../system/stability'
import { interpretLimitCycleStability } from '../../../system/continuation'
import { resolveTrivialFloquetModeIndex } from '../../../system/floquetModes'
import {
  fmt,
  fmtCompactCount,
  fmtComplex,
  fmtCount,
  fmtEigenvalues,
  fmtPercent,
  fmtRange,
  fmtRelativeTime,
  fmtSci,
} from '../../../utils/format'
import { Icon } from '../../Icon'
import { KeyValues, type HeaderChip } from '../InspectorChrome'
import { computeInvariantMeasureStats } from './invariantMeasureStats'
import { RenderTargetChip, StateVector, ValueList } from './GlanceParts'

export type ObjectHeaderModel = {
  chip: HeaderChip | null
  meta: string[]
  glance: ReactNode
  barExtra?: ReactNode
}

/** Moduli for merged conjugate pairs, in the same order as `fmtEigenvalues`. */
function mergedModuli(values: ComplexValue[]): string[] {
  const used = new Set<number>()
  const out: string[] = []
  values.forEach((value, index) => {
    if (used.has(index)) return
    used.add(index)
    if (Math.abs(value.im) >= 1e-12) {
      const scale = Math.max(1, Math.hypot(value.re, value.im))
      const partner = values.findIndex(
        (candidate, candidateIndex) =>
          !used.has(candidateIndex) &&
          Math.abs(candidate.re - value.re) <= 1e-9 * scale &&
          Math.abs(candidate.im + value.im) <= 1e-9 * scale
      )
      if (partner >= 0) used.add(partner)
    }
    out.push(fmt(Math.hypot(value.re, value.im)))
  })
  return out
}

function stabilityChipFromLabel(label: string): HeaderChip {
  if (label === 'stable') return { label, tone: 'stable' }
  if (label.startsWith('unstable')) return { label, tone: 'unstable' }
  return { label, tone: 'unknown' }
}



function equilibriumModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const {
    equilibrium,
    equilibriumDisplayState,
    frozenVariableHeaderNames,
    isDiscreteMap,
    systemDraft,
    writeClipboardText,
    formatPointValues,
    equilibriumCyclePoints,
  } = scope
  if (!equilibrium) return null
  const solution = equilibrium.solution
  const failed = Boolean(equilibrium.lastRun && !equilibrium.lastRun.success)
  if (!solution) {
    return {
      chip: failed
        ? { label: 'failed', tone: 'warning', title: 'Last solve attempt failed' }
        : { label: 'unsolved', tone: 'muted' },
      meta: ['Not solved'],
      glance: null,
    }
  }
  const eigenvalues = solution.eigenpairs.map((pair) => pair.value)
  const stability = classifyEquilibrium(eigenvalues, systemDraft.type)
  const cycleLength = isDiscreteMap ? equilibriumCyclePoints?.length ?? 1 : 1
  const meta = [
    'Solved',
    `${fmtCount(solution.iterations)} it`,
    `‖F‖ ${fmtSci(solution.residual_norm)}`,
  ]
  if (cycleLength > 1) meta.push(`period ${cycleLength}`)
  if (failed) meta.push('last attempt failed')
  return {
    chip: {
      label: stability.label,
      tone: stability.kind,
      title: `${stability.unstable} unstable · ${stability.stable} stable${
        stability.center ? ` · ${stability.center} center` : ''
      }`,
    },
    meta,
    glance: (
      <>
        {equilibriumDisplayState ? (
          <StateVector
            names={frozenVariableHeaderNames}
            values={equilibriumDisplayState}
            onCopy={() => void writeClipboardText(formatPointValues(equilibriumDisplayState))}
            testId="equilibrium-glance-state"
          />
        ) : null}
        <ValueList
          title="Eigenvalues"
          values={fmtEigenvalues(eigenvalues)}
          testId="equilibrium-glance-eigenvalues"
        />
        {isDiscreteMap && eigenvalues.length > 0 ? (
          <ValueList title="|λ|" values={mergedModuli(eigenvalues)} />
        ) : null}
      </>
    ),
  }
}

function orbitModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const {
    orbit,
    orbitPreviewVarNames,
    frozenVariableHeaderNames,
    isDiscreteMap,
    lyapunovDimension,
    writeClipboardText,
    formatPointValues,
    handleExtendOrbit,
    runDisabled,
  } = scope
  if (!orbit) return null
  const count = orbit.data.length
  if (count === 0) {
    return {
      chip: { label: 'empty', tone: 'muted' },
      meta: ['0 points'],
      glance: null,
    }
  }
  const last = orbit.data[count - 1] ?? []
  const finalState = last.slice(1)
  const names = orbitPreviewVarNames.length > 0 ? orbitPreviewVarNames : frozenVariableHeaderNames
  const meta = [
    `${fmtCount(count)} points`,
    isDiscreteMap
      ? `n ${fmtRange(orbit.t_start, orbit.t_end)}`
      : `t ${fmtRange(orbit.t_start, orbit.t_end)}`,
  ]
  if (!isDiscreteMap) meta.push(`dt ${fmt(orbit.dt)}`)
  const exponents = orbit.lyapunovExponents ?? []
  return {
    chip: { label: `${fmtCompactCount(count)} pts`, tone: 'neutral' },
    meta,
    glance: (
      <>
        <StateVector
          title="Final state"
          names={names}
          values={finalState}
          onCopy={() => void writeClipboardText(formatPointValues(finalState))}
          testId="orbit-glance-final-state"
        />
        {exponents.length > 0 ? (
          <div className="inspector-glance__group" data-testid="orbit-glance-lyapunov">
            <div className="section-head">
              <span>Lyapunov</span>
            </div>
            <KeyValues
              columns={2}
              rows={[
                ...exponents.map((value, index) => ({
                  label: `λ${index + 1}`,
                  value: fmt(value),
                })),
                lyapunovDimension !== null
                  ? { label: 'D_KY', value: fmt(lyapunovDimension), title: 'Kaplan–Yorke dimension' }
                  : null,
              ]}
            />
          </div>
        ) : null}
      </>
    ),
    barExtra: (
      <button
        type="button"
        className="btn"
        onClick={handleExtendOrbit}
        disabled={runDisabled}
        title={
          isDiscreteMap
            ? `Extend from n = ${orbit.t_end}`
            : `Extend from t = ${fmt(orbit.t_end)}`
        }
        data-testid="orbit-extend-quick"
      >
        Extend
      </button>
    ),
  }
}

function limitCycleModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const {
    limitCycle,
    limitCycleDisplayMultipliers,
    limitCycleDisplayParamValue,
    limitCycleRenderLabel,
    limitCycleRenderPoint,
    isStoredCycleTarget,
    canRenderStoredCycle,
    onSetLimitCycleRenderTarget,
    selectedNodeId,
    formatLimitCycleOrigin,
  } = scope
  if (!limitCycle) return null
  const stability = interpretLimitCycleStability(limitCycleDisplayMultipliers)
  const renderedState = limitCycleRenderPoint?.state
  const renderedPeriod =
    renderedState && renderedState.length > 0 ? renderedState[renderedState.length - 1] : undefined
  const period =
    !isStoredCycleTarget && typeof renderedPeriod === 'number' && Number.isFinite(renderedPeriod)
      ? renderedPeriod
      : limitCycle.period
  const trivialIndex = resolveTrivialFloquetModeIndex(limitCycleDisplayMultipliers)
  const nontrivial = limitCycleDisplayMultipliers.filter((_, index) => index !== trivialIndex)
  return {
    chip: stabilityChipFromLabel(stability),
    meta: [formatLimitCycleOrigin(limitCycle.origin)],
    glance: (
      <>
        {!isStoredCycleTarget ? (
          <RenderTargetChip
            label={limitCycleRenderLabel}
            onReset={
              onSetLimitCycleRenderTarget && canRenderStoredCycle && selectedNodeId
                ? () => onSetLimitCycleRenderTarget(selectedNodeId, { type: 'object' })
                : undefined
            }
            resetTitle="Render the stored cycle"
            testId="limit-cycle-render-target"
            resetTestId="limit-cycle-render-stored"
          />
        ) : null}
        <KeyValues
          columns={2}
          testId="limit-cycle-glance"
          rows={[
            { label: 'T', value: fmt(period), title: 'Period', testId: 'limit-cycle-glance-period' },
            {
              label: 'Mesh',
              value: `${limitCycle.ntst}×${limitCycle.ncol}`,
              title: 'NTST × NCOL',
            },
            limitCycle.parameterName
              ? {
                  label: limitCycle.parameterName,
                  value: fmt(limitCycleDisplayParamValue),
                  title: 'Continuation parameter',
                }
              : null,
          ]}
        />
        <ValueList
          title="Multipliers"
          values={nontrivial.map(
            (value) =>
              Math.abs(value.im) < 1e-12
                ? fmtComplex(value)
                : `${fmtComplex(value)}  |μ| ${fmt(Math.hypot(value.re, value.im))}`
          )}
          testId="limit-cycle-glance-multipliers"
        />
      </>
    ),
  }
}

function forcedResponseModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const {
    forcedPeriodicResponse,
    forcedPeriodicResponseStale,
    forcedPeriodicResponseRenderLabel,
    isStoredForcedPeriodicResponseTarget,
    onSetLimitCycleRenderTarget,
    selectedNodeId,
    systemDraft,
    writeClipboardText,
    formatPointValues,
  } = scope
  if (!forcedPeriodicResponse) return null
  const solution = forcedPeriodicResponse.solution
  const renderTarget = !isStoredForcedPeriodicResponseTarget ? (
    <RenderTargetChip
      label={forcedPeriodicResponseRenderLabel}
      onReset={
        onSetLimitCycleRenderTarget && selectedNodeId
          ? () => onSetLimitCycleRenderTarget(selectedNodeId, { type: 'object' })
          : undefined
      }
      resetTitle="Render the stored response"
      testId="forced-response-render-target"
      resetTestId="forced-response-render-stored"
    />
  ) : null
  if (!solution) {
    return {
      chip: { label: 'unsolved', tone: 'muted' },
      meta: ['Not solved'],
      glance: renderTarget,
    }
  }
  const maxModulus = solution.multipliers.reduce(
    (max, value) => Math.max(max, Math.hypot(value.re, value.im)),
    0
  )
  const chip: HeaderChip =
    solution.multipliers.length === 0
      ? { label: 'unknown', tone: 'unknown' }
      : maxModulus > 1 + 1e-9
        ? { label: 'unstable', tone: 'unstable' }
        : maxModulus < 1 - 1e-9
          ? { label: 'stable', tone: 'stable' }
          : { label: 'non-hyperbolic', tone: 'nonhyperbolic' }
  return {
    chip,
    meta: [
      'Solved',
      `${fmtCount(solution.iterations)} it`,
      `‖F‖ ${fmtSci(solution.residual_norm)}`,
    ],
    glance: (
      <>
        {renderTarget}
        {forcedPeriodicResponseStale ? (
          <span
            className="chip chip--warning"
            title="Settings changed since this response was solved"
            data-testid="forced-response-stale"
          >
            stale
          </span>
        ) : null}
        <KeyValues
          columns={2}
          testId="forced-response-glance"
          rows={[
            { label: 'Forcing period', value: fmt(solution.forcing_period) },
            {
              label: 'Response period',
              value: fmt(solution.forcing_period * solution.response_multiple),
            },
            { label: 'Multiple', value: String(solution.response_multiple) },
            { label: 'max |μ|', value: fmt(maxModulus) },
            { label: 'Points', value: fmtCount(solution.cycle_points.length), title: 'Trajectory points' },
          ]}
        />
        {solution.minimal_response_multiple < solution.response_multiple ? (
          <span
            className="chip chip--warning"
            title={`This solution has the lower response multiple ${solution.minimal_response_multiple}`}
            data-testid="forced-response-lower-period"
          >
            minimal multiple {solution.minimal_response_multiple}
          </span>
        ) : null}
        <StateVector
          title="Strobe state"
          names={systemDraft.varNames}
          values={solution.state}
          onCopy={() => void writeClipboardText(formatPointValues(solution.state))}
        />
        <ValueList
          title="Multipliers"
          values={solution.multipliers.map((value, index) => `μ${index + 1} = ${fmtComplex(value)}`)}
          testId="forced-response-glance-multipliers"
        />
      </>
    ),
  }
}

function isoclineModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const {
    isocline,
    isoclineStale,
    isoclineResolvedExpression,
    isoclineComputing,
    handleComputeIsocline,
  } = scope
  if (!isocline) return null
  const computedAt = isocline.lastComputed?.computedAt
  const chip: HeaderChip = !computedAt
    ? { label: 'not computed', tone: 'muted', testId: 'isocline-not-computed' }
    : isoclineStale
      ? {
          label: 'stale',
          tone: 'warning',
          title: 'Settings changed since the last compute',
          testId: 'isocline-stale-indicator',
        }
      : { label: 'computed', tone: 'stable', title: computedAt, testId: 'isocline-last-computed' }
  const needsCompute = !computedAt || isoclineStale
  return {
    chip,
    meta: computedAt ? [`computed ${fmtRelativeTime(computedAt)}`] : [],
    glance: (
      <KeyValues
        testId="isocline-glance"
        rows={[
          {
            label: 'f',
            value: `${isoclineResolvedExpression || '∅'} = ${fmt(isocline.level)}`,
            testId: 'isocline-resolved-expression',
          },
          ...isocline.axes.map((axis) => ({
            label: axis.variableName,
            value: `[${fmt(axis.min)}, ${fmt(axis.max)}] × ${fmtCount(axis.samples)}`,
          })),
        ]}
      />
    ),
    barExtra: needsCompute ? (
      <button
        type="button"
        className="btn"
        onClick={() => void handleComputeIsocline()}
        disabled={isoclineComputing}
        data-testid="isocline-quick-compute"
      >
        <Icon name="play" size={13} />
        {isoclineComputing ? 'Computing…' : 'Compute'}
      </button>
    ) : null,
  }
}

function invariantMeasureModel(scope: InspectorSelectionController): ObjectHeaderModel | null {
  const { invariantMeasure, system } = scope
  if (!invariantMeasure) return null
  const stats = computeInvariantMeasureStats(invariantMeasure, system)
  const result = invariantMeasure.result
  const analysis = stats.currentAnalysis
  const chip: HeaderChip = !stats.massPreserving
    ? { label: 'leaking', tone: 'warning', title: 'Leading eigenvalue differs from 1' }
    : stats.stationaryConverged
      ? { label: 'converged', tone: 'stable' }
      : { label: 'not converged', tone: 'warning' }
  return {
    chip,
    meta: [
      stats.massPreserving ? 'Invariant measure' : 'Finite-box mode',
      `${fmtCount(stats.occupiedCells)} / ${fmtCount(result.totalBoxes)} occupied cells`,
    ],
    glance: (
      <KeyValues
        columns={2}
        testId="invariant-measure-glance"
        rows={[
          {
            label: 'Cover',
            value: `${fmtCount(result.totalBoxes)} / ${fmtCount(stats.ambientBoxCount)}`,
            title: 'Reachable cover / ambient cells',
            testId: 'invariant-measure-cover-size',
          },
          {
            label: 'Occupied',
            value: `${fmtCount(stats.occupiedCells)} / ${fmtCount(result.totalBoxes)}`,
            testId: 'invariant-measure-occupied-cells',
          },
          {
            label: 'λ₀',
            value: fmt(stats.dominantEigenvalue),
            title: 'Leading eigenvalue',
            testId: 'invariant-measure-leading-eigenvalue',
          },
          {
            label: 'Residual',
            value: fmtSci(result.residual),
            title: 'Stationary residual',
            testId: 'invariant-measure-residual',
          },
          {
            label: 'Retained',
            value: fmtPercent(result.retainedMass),
            title: 'Retained sample mass',
          },
          {
            label: 'Support',
            value: fmt(stats.participationSupport, { digits: 4 }),
            title: 'Participation support 1 / Σp² (cells)',
            testId: 'invariant-measure-effective-support',
          },
          analysis
            ? {
                label: 'Gap',
                value:
                  analysis.spectralGapStatus === 'available' && analysis.spectralGap !== undefined
                    ? fmt(analysis.spectralGap)
                    : '—',
                title: 'Spectral gap 1 − |λ₂|',
                testId: 'invariant-spectral-gap',
              }
            : null,
        ]}
      />
    ),
  }
}

export function buildObjectHeaderModel(
  scope: InspectorSelectionController
): ObjectHeaderModel | null {
  return (
    equilibriumModel(scope) ??
    orbitModel(scope) ??
    limitCycleModel(scope) ??
    forcedResponseModel(scope) ??
    isoclineModel(scope) ??
    invariantMeasureModel(scope)
  )
}
